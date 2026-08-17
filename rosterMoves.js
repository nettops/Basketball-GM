var _ROSTER_MOVES_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), players: require('./players-2026.js'), teams: require('./teams.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById }, players: { PLAYERS_2026: PLAYERS_2026 }, teams: { getTeamById: getTeamById } };

const ROSTER_MINIMUM = 12;

function getFreeAgents() {
  return _ROSTER_MOVES_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId === null; });
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

function waivePlayer(playerId) {
  const player = _ROSTER_MOVES_DATA.league.getPlayerById(playerId);
  if (!player.teamId) {
    return { success: false, reason: 'Player is already a free agent.' };
  }
  const roster = _ROSTER_MOVES_DATA.league.getTeamRoster(player.teamId);
  if (roster.length <= ROSTER_MINIMUM) {
    return { success: false, reason: 'Waiving would drop the roster below the ' + ROSTER_MINIMUM + '-player minimum.' };
  }
  const team = _ROSTER_MOVES_DATA.teams.getTeamById(player.teamId);
  const owed = addDeadMoney(team, player, player.contract.salary);
  player.teamId = null;
  return { success: true, deadMoney: owed };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getFreeAgents: getFreeAgents,
    waivePlayer: waivePlayer,
    addDeadMoney: addDeadMoney,
    decrementDeadMoney: decrementDeadMoney,
    ROSTER_MINIMUM: ROSTER_MINIMUM
  };
}
