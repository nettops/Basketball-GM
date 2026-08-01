var _TRADE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), tradeEvaluator: require('./tradeEvaluator.js'), teams: require('./teams.js'), draftPickValue: require('./draftPickValue.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById },
      tradeEvaluator: { evaluateTeamLeg: evaluateTeamLeg },
      teams: { getTeamById: getTeamById },
      draftPickValue: { estimateFuturePickValue: estimateFuturePickValue }
    };

function findPick(teamId, round) {
  const team = _TRADE_DATA.teams.getTeamById(teamId);
  return team.draftPicks.find(function (p) { return p.round === round && p.currentOwnerId === teamId; });
}

// Value is based on the pick's ORIGINAL team's timeline (whose roster/record
// the pick actually reflects), not whoever currently holds it going into this
// trade — a pick doesn't get more or less valuable just by changing hands.
function pickValueForLeg(teamId, pickAssignments) {
  let outgoing = 0;
  let incoming = 0;
  pickAssignments.forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (!pick) return;
    const originalTeam = _TRADE_DATA.teams.getTeamById(pick.originalTeamId);
    const value = _TRADE_DATA.draftPickValue.estimateFuturePickValue(pa.round, originalTeam);
    if (pa.fromTeamId === teamId) outgoing += value;
    if (pa.toTeamId === teamId) incoming += value;
  });
  return { outgoing: outgoing, incoming: incoming };
}

function validateRosterSizes(proposal) {
  const errors = [];
  proposal.participants.forEach(function (teamId) {
    const currentSize = _TRADE_DATA.league.getTeamRoster(teamId).length;
    const outgoingCount = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).length;
    const incomingCount = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).length;
    const newSize = currentSize - outgoingCount + incomingCount;
    if (newSize < 12 || newSize > 15) {
      errors.push(teamId + ' roster would be ' + newSize + ' players (must stay between 12 and 15)');
    }
  });
  return errors;
}

function evaluateTrade(proposal, userTeamId) {
  const pickAssignments = proposal.pickAssignments || [];
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId) {
      legs[teamId] = { accepted: true, isUser: true };
      return;
    }
    const outgoing = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).map(function (a) { return a.playerId; });
    const incoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).map(function (a) { return a.playerId; });
    const pickValue = pickValueForLeg(teamId, pickAssignments);
    legs[teamId] = _TRADE_DATA.tradeEvaluator.evaluateTeamLeg(teamId, outgoing, incoming, pickValue.outgoing, pickValue.incoming);
  });
  const accepted = Object.keys(legs).every(function (teamId) { return legs[teamId].accepted; });
  return { accepted: accepted, legs: legs };
}

function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
    // High-ego, high-loyalty players take being traded harder.
    if (player.hiddenPersonality && player.hiddenPersonality.ego !== undefined && player.status) {
      const moraleHit = 3 + (player.hiddenPersonality.ego + player.hiddenPersonality.loyalty) / 20;
      player.status.morale = Math.max(0, player.status.morale - Math.round(moraleHit));
    }
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
}

function proposeTrade(proposal, userTeamId) {
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { accepted: false, rosterErrors: rosterErrors, legs: {} };
  }
  const evaluation = evaluateTrade(proposal, userTeamId);
  if (evaluation.accepted) {
    executeTrade(proposal);
  }
  return Object.assign({ rosterErrors: [] }, evaluation);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateRosterSizes: validateRosterSizes,
    evaluateTrade: evaluateTrade,
    executeTrade: executeTrade,
    proposeTrade: proposeTrade,
    findPick: findPick,
    pickValueForLeg: pickValueForLeg
  };
}
