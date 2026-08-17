// The waiver wire. A player released mid-season does not become a free agent
// on the spot — he sits here for two game days with his contract attached, and
// any club with the room and the cap space may claim him and inherit the deal
// whole.
//
// This is the decision dead money exists to pose. A player worth more than he
// is owed gets claimed and costs the waiving club nothing but the player; one
// worth less clears, and the club pays him for years to play somewhere else.
//
// Its own file rather than part of freeAgency.js because freeAgency already
// requires rosterMoves, and the wire needs both — putting it there or in
// rosterMoves would close a require cycle.
var _WAIVERS_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      players: require('./players-2026.js'),
      rosterMoves: require('./rosterMoves.js'),
      freeAgency: require('./freeAgency.js'),
      data: require('./data.js')
    }
  : {
      league: { getActiveRoster: getActiveRoster, getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      players: { PLAYERS_2026: PLAYERS_2026 },
      rosterMoves: { cancelDeadMoney: cancelDeadMoney, WAIVER_WINDOW_DAYS: WAIVER_WINDOW_DAYS },
      freeAgency: { estimateFairSalary: estimateFairSalary, ROSTER_MAX: ROSTER_MAX, isMinimumDeal: isMinimumDeal },
      data: { getEffectiveSalaryCap: getEffectiveSalaryCap }
    };

// A club claims when the player is worth at least what he is owed. That single
// comparison is the whole AI, and it is the right one: a claim is not a signing
// at a price the club chooses, it is taking on somebody else's deal as written.
// Anything cleverer would be inventing a second theory of what a player is
// worth alongside estimateFairSalary.
const CLAIM_VALUE_MARGIN = 1.0;

function playersOnWaivers() {
  return _WAIVERS_DATA.players.PLAYERS_2026.filter(function (p) { return !!p.waivers; });
}

// Worst record first, which is what makes a bad club's cap space worth
// something — the same reason the draft runs in this order.
function claimPriority() {
  return _WAIVERS_DATA.teams.TEAMS.slice().sort(function (a, b) {
    const aw = (a.record && a.record.wins) || 0;
    const bw = (b.record && b.record.wins) || 0;
    if (aw !== bw) return aw - bw;
    return a.id.localeCompare(b.id);
  });
}

// Legality only — whether the club is allowed to take the contract on, with no
// opinion about whether it should. Split from wantsToClaim so the UI can tell a
// user who cannot claim exactly why, which is the interesting half of the answer.
function canClaim(team, player, capLevel) {
  if (!player.waivers) return { ok: false, reason: 'That player is not on waivers.' };
  if (player.waivers.fromTeamId === team.id) {
    return { ok: false, reason: 'You cannot claim a player you just waived.' };
  }
  const roster = _WAIVERS_DATA.league.getActiveRoster(team.id);
  if (roster.length >= _WAIVERS_DATA.freeAgency.ROSTER_MAX) {
    return { ok: false, reason: 'Roster is full (' + _WAIVERS_DATA.freeAgency.ROSTER_MAX + ' players).' };
  }
  // A claim is an inherited contract, not a negotiated one, so there is no
  // room to make it fit — it clears the cap or it does not happen.
  //
  // Except at the minimum, which any club may absorb. That exception is not a
  // convenience: measured on the opening league, exactly 2 of 30 clubs have the
  // space to claim even a $1.2M player, because this cap is soft and 28 clubs
  // are over it (Brooklyn opens $221M against $154M). Without the exception
  // essentially nothing is ever claimed, the wire is a two-day pause on the way
  // to free agency, and dead money has no counterweight. It is also the real
  // rule: over-the-cap clubs claim minimum contracts and nothing else, which is
  // why the good waiver claims go to the clubs with room.
  const cap = _WAIVERS_DATA.data.getEffectiveSalaryCap(capLevel);
  const payroll = _WAIVERS_DATA.league.getTeamPayroll(team.id);
  const salary = player.waivers.salary;
  if (!_WAIVERS_DATA.freeAgency.isMinimumDeal(salary) && payroll + salary > cap) {
    return {
      ok: false,
      reason: 'No cap space: claiming him would put payroll $' +
        (payroll + salary - cap).toLocaleString() + ' over the $' + cap.toLocaleString() + ' cap.'
    };
  }
  return { ok: true };
}

function wantsToClaim(team, player) {
  const worth = _WAIVERS_DATA.freeAgency.estimateFairSalary(player);
  return worth >= player.waivers.salary * CLAIM_VALUE_MARGIN;
}

// Moves the contract to the claiming club and cancels the waiving club's debt.
// The single place a claim is executed, so the user's button and the AI sweep
// cannot drift into two different ideas of what claiming does.
function awardClaim(player, team) {
  const from = _WAIVERS_DATA.teams.getTeamById(player.waivers.fromTeamId);
  _WAIVERS_DATA.rosterMoves.cancelDeadMoney(from, player.id);
  player.contract.salary = player.waivers.salary;
  player.contract.yearsRemaining = player.waivers.yearsRemaining;
  player.teamId = team.id;
  delete player.waivers;
  return { success: true, teamId: team.id, fromTeamId: from ? from.id : null };
}

// The user's claim, taken the moment they ask for it rather than queued until
// the window closes. Real waivers award by record even between two willing
// clubs; here the user simply has to act before the deadline.
//
// ponytail: first-come, not priority-ordered. If AI clubs should be able to
// outrank a user's claim, this becomes a pending-claims list resolved in
// claimPriority order at clearsOnDay.
function claimPlayer(playerId, teamId, capLevel) {
  const player = _WAIVERS_DATA.league.getPlayerById(playerId);
  const team = _WAIVERS_DATA.teams.getTeamById(teamId);
  if (!player || !team) return { success: false, reason: 'Unknown player or team.' };
  const legal = canClaim(team, player, capLevel);
  if (!legal.ok) return { success: false, reason: legal.reason };
  return awardClaim(player, team);
}

// Runs once per game day. Everyone whose window is up is settled now: claimed
// by the neediest club that wants him and can afford him, or cleared to free
// agency with his old club still paying.
function resolveWaiverClaims(dayIndex, excludeTeamId, capLevel) {
  const results = [];
  playersOnWaivers().forEach(function (player) {
    if (player.waivers.clearsOnDay > dayIndex) return;

    const suitor = claimPriority().find(function (team) {
      if (team.id === excludeTeamId) return false;
      return canClaim(team, player, capLevel).ok && wantsToClaim(team, player);
    });

    if (suitor) {
      const from = player.waivers.fromTeamId;
      awardClaim(player, suitor);
      results.push({ playerId: player.id, name: player.name, claimedBy: suitor.id, fromTeamId: from });
      return;
    }

    // Nobody wanted him at that price. He is a free agent now, signable by
    // anyone at whatever the market says — and the club that cut him keeps
    // paying the deal it wrote.
    delete player.waivers;
    results.push({ playerId: player.id, name: player.name, cleared: true });
  });
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playersOnWaivers: playersOnWaivers,
    claimPriority: claimPriority,
    canClaim: canClaim,
    wantsToClaim: wantsToClaim,
    claimPlayer: claimPlayer,
    resolveWaiverClaims: resolveWaiverClaims,
    CLAIM_VALUE_MARGIN: CLAIM_VALUE_MARGIN
  };
}
