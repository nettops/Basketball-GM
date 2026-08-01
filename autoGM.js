var _AUTOGM_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      tradeEvaluator: require('./tradeEvaluator.js'),
      rosterMoves: require('./rosterMoves.js'),
      scouting: require('./scouting.js'),
      trade: require('./trade.js')
    }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, needMultiplier: needMultiplier },
      rosterMoves: { waivePlayer: waivePlayer },
      scouting: { allocateScoutPoints: allocateScoutPoints },
      trade: { validateRosterSizes: validateRosterSizes, evaluateTrade: evaluateTrade }
    };

// The only numeric roster constraint the game enforces today that can leave
// a team stuck with no existing resolution path (rosterMoves.js's own 12-man
// floor already blocks waiving below it; free agency's own >=15 check already
// blocks new AI signings past it — but nothing stops a MANUAL user signing or
// a draft addition from pushing past 15). Waives the lowest adjustedPlayerValue
// player, repeatedly, until back at 15 or waivePlayer itself refuses (roster
// at the 12-man floor).
function autoEnforceRosterSize(team) {
  const waived = [];
  let roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  while (roster.length > 15) {
    const worst = roster.slice().sort(function (a, b) {
      return _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(a, team) - _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(b, team);
    })[0];
    const result = _AUTOGM_DATA.rosterMoves.waivePlayer(worst.id);
    if (!result.success) break;
    waived.push(worst.id);
    roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  }
  return waived;
}

// Spends a weekly scouting point rollover automatically: own roster always
// (confidence there matters regardless of watchlisting), plus any prospect or
// opponent the user has explicitly watchlisted — lowest-confidence targets
// first, split evenly across whatever remains available each pass.
function autoAllocateScoutPoints(scoutingState, ownRosterIds, watchlistedProspectIds, watchlistedOpponentIds) {
  if (scoutingState.pointsAvailable <= 0) return;
  const targetIds = Array.from(new Set(ownRosterIds.concat(watchlistedProspectIds).concat(watchlistedOpponentIds)))
    .sort(function (a, b) {
      const ca = (scoutingState.targets[a] && scoutingState.targets[a].confidence) || 0;
      const cb = (scoutingState.targets[b] && scoutingState.targets[b].confidence) || 0;
      return ca - cb;
    });
  if (targetIds.length === 0) return;
  const perTarget = Math.max(10, Math.floor(scoutingState.pointsAvailable / targetIds.length));
  targetIds.forEach(function (id) {
    if (scoutingState.pointsAvailable <= 0) return;
    _AUTOGM_DATA.scouting.allocateScoutPoints(scoutingState, id, Math.min(perTarget, scoutingState.pointsAvailable));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    autoEnforceRosterSize: autoEnforceRosterSize,
    autoAllocateScoutPoints: autoAllocateScoutPoints
  };
}
