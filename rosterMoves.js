var _ROSTER_MOVES_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), players: require('./players-2026.js'), teams: require('./teams.js') }
  : { league: { getTeamRoster: getTeamRoster, getActiveRoster: getActiveRoster, getPlayerById: getPlayerById }, players: { PLAYERS_2026: PLAYERS_2026 }, teams: { getTeamById: getTeamById } };

const ROSTER_MINIMUM = 12;

// Two game days on the wire. Long enough that the decision is a decision and
// short enough that a useful player is not stranded for a week of a season the
// user is fast-forwarding through.
const WAIVER_WINDOW_DAYS = 2;

// A player on the waiver wire has no team, but he is not signable — his old
// contract is still attached and another club may claim it. Excluding him here
// covers nearly everything, because getFreeAgents is the door: AI free agency,
// roster-floor signings and the commissioner's pool all come through it. Miss
// this and the wire is decoration, because the pool would offer him a day
// early at whatever price it liked.
function getFreeAgents() {
  return _ROSTER_MOVES_DATA.players.PLAYERS_2026.filter(function (p) {
    return p.teamId === null && !p.waivers;
  });
}

// The money a club still owes a player it released. Waiving used to set
// teamId = null and return, which deleted the contract along with the player:
// see league.js's getTeamDeadMoney for what that was worth. Recorded per team
// rather than per player because the debt belongs to the club and outlives the
// player's stay anywhere — he may be signed, waived again and retired while it
// is still being paid.
function addDeadMoney(team, player, salary) {
  if (!team.deadMoney) team.deadMoney = [];
  // A fully forgiven contract is not a debt. Recording a zero would show an
  // empty row on the cap sheet and survive every offseason tick until its
  // years ran out, which reads as a bug even though it costs nothing.
  if (salary <= 0) return null;
  const entry = {
    playerId: player.id,
    name: player.name,
    salary: salary,
    yearsRemaining: Math.max(1, player.contract.yearsRemaining)
  };
  team.deadMoney.push(entry);
  return entry;
}

// Ticks each club's dead money down a year and retires what is paid off.
// Called from seasonTransition.js's decrementContracts alongside the live
// contracts, so a debt ages at exactly the rate the deal it came from would
// have — anything else and dead money either outlives the contract or vanishes
// early, both of which make the cap sheet lie.
function decrementDeadMoney(teams) {
  teams.forEach(function (team) {
    if (!team.deadMoney || team.deadMoney.length === 0) return;
    team.deadMoney.forEach(function (d) { d.yearsRemaining -= 1; });
    team.deadMoney = team.deadMoney.filter(function (d) { return d.yearsRemaining > 0; });
  });
}

// A claim cancels the debt, because the claiming club inherits the contract
// whole. Matched by playerId and taken from the end: a club can waive the same
// man twice across a career, and the entry being cancelled is always the one
// just created. An object reference would be exact but would not survive a
// save round-trip, which serializes deadMoney as plain rows.
function cancelDeadMoney(team, playerId) {
  if (!team || !team.deadMoney) return null;
  for (let i = team.deadMoney.length - 1; i >= 0; i--) {
    if (team.deadMoney[i].playerId === playerId) return team.deadMoney.splice(i, 1)[0];
  }
  return null;
}

// dayIndex is the game day the waive happens on, and passing it is what puts
// the player on the wire for waivers.js to resolve. Omitting it releases him
// outright — which is correct for every offseason caller (enforceRosterCeilings,
// the rollover, career mode's roster shuffling), because between seasons there
// are no game days for a window to run on.
function waivePlayer(playerId, dayIndex) {
  const player = _ROSTER_MOVES_DATA.league.getPlayerById(playerId);
  if (!player.teamId) {
    return { success: false, reason: 'Player is already a free agent.' };
  }
  const roster = _ROSTER_MOVES_DATA.league.getActiveRoster(player.teamId);
  if (roster.length <= ROSTER_MINIMUM) {
    return { success: false, reason: 'Waiving would drop the roster below the ' + ROSTER_MINIMUM + '-player minimum.' };
  }
  const team = _ROSTER_MOVES_DATA.teams.getTeamById(player.teamId);
  const owed = addDeadMoney(team, player, player.contract.salary);
  if (dayIndex !== undefined && dayIndex !== null) {
    player.waivers = {
      fromTeamId: player.teamId,
      salary: player.contract.salary,
      yearsRemaining: player.contract.yearsRemaining,
      clearsOnDay: dayIndex + WAIVER_WINDOW_DAYS
    };
  }
  player.teamId = null;
  return { success: true, deadMoney: owed, onWaivers: !!player.waivers };
}

// Nobody signs away more than half of what they are owed. Past that the player
// is better off sitting on the bench and collecting, which is exactly the
// situation a buyout exists to end.
const BUYOUT_MAX_FORGIVENESS = 0.5;

// How badly the player wants out, 0..1, which is also the largest share of his
// money he will give up to go. A buyout is the one negotiation in the game
// where the club's leverage is bad news for the club: the worse the team, the
// more the player will pay to leave it.
//
// Pure and at file scope so it can be tested without a league — the whole
// decision is four numbers and it should be readable as four numbers.
function buyoutAppetite(player, team) {
  const record = (team && team.record) || { wins: 0, losses: 0 };
  const played = (record.wins || 0) + (record.losses || 0);

  // Baseline: even on a good team, some money is worth freedom.
  let want = 0.12;

  // Losing. Weighted by games played so a 2-6 start does not read as a lost
  // season — early on, nobody knows yet.
  if (played > 0) {
    const winPct = (record.wins || 0) / played;
    const confidence = Math.min(1, played / 20);
    want += Math.max(0, 0.5 - winPct) * 0.7 * confidence;
  }

  // A veteran has fewer years left to spend chasing something, and knows it.
  if (player.age >= 32) want += 0.18;
  else if (player.age >= 29) want += 0.09;

  // Unhappy men leave for less.
  const morale = (player.status && player.status.morale !== undefined) ? player.status.morale : 70;
  if (morale < 40) want += 0.20;
  else if (morale < 60) want += 0.10;

  return Math.min(BUYOUT_MAX_FORGIVENESS, want);
}

// pctForgiven is the share of his remaining salary the player gives up. Split
// from the execution so the UI can show what an offer would do before making
// it, and so the decision is testable without moving anybody.
function buyoutDecision(player, team, pctForgiven) {
  const appetite = buyoutAppetite(player, team);
  return {
    accepted: pctForgiven <= appetite,
    appetite: appetite,
    // What the club would still owe. This is the number that matters to the
    // GM, and it is why a buyout beats a waive: same player gone, smaller bill.
    deadMoney: Math.round(player.contract.salary * (1 - pctForgiven))
  };
}

// A bought-out player goes straight to free agency rather than onto the wire.
// The real rule sends him through waivers first; at a salary he has just agreed
// to cut, nobody claims him, so the window would be a formality that costs him
// two days of the market and the contender chasing him two days of his legs.
function buyoutPlayer(playerId, pctForgiven) {
  const player = _ROSTER_MOVES_DATA.league.getPlayerById(playerId);
  if (!player || !player.teamId) {
    return { success: false, reason: 'That player is not under contract.' };
  }
  const team = _ROSTER_MOVES_DATA.teams.getTeamById(player.teamId);
  const roster = _ROSTER_MOVES_DATA.league.getActiveRoster(player.teamId);
  if (roster.length <= ROSTER_MINIMUM) {
    return { success: false, reason: 'A buyout would drop the roster below the ' + ROSTER_MINIMUM + '-player minimum.' };
  }
  if (pctForgiven < 0 || pctForgiven > 1) {
    return { success: false, reason: 'A buyout forgives between none and all of the contract.' };
  }

  const decision = buyoutDecision(player, team, pctForgiven);
  if (!decision.accepted) {
    return {
      success: false,
      reason: player.name + ' turned it down. He will not give up ' +
        Math.round(pctForgiven * 100) + '% of what he is owed to leave.',
      appetite: decision.appetite
    };
  }

  const owed = addDeadMoney(team, player, decision.deadMoney);
  player.teamId = null;
  return { success: true, deadMoney: owed, forgiven: player.contract.salary - decision.deadMoney };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getFreeAgents: getFreeAgents,
    waivePlayer: waivePlayer,
    addDeadMoney: addDeadMoney,
    cancelDeadMoney: cancelDeadMoney,
    decrementDeadMoney: decrementDeadMoney,
    buyoutAppetite: buyoutAppetite,
    buyoutDecision: buyoutDecision,
    buyoutPlayer: buyoutPlayer,
    ROSTER_MINIMUM: ROSTER_MINIMUM,
    WAIVER_WINDOW_DAYS: WAIVER_WINDOW_DAYS,
    BUYOUT_MAX_FORGIVENESS: BUYOUT_MAX_FORGIVENESS
  };
}
