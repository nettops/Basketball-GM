var _TRADE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), tradeEvaluator: require('./tradeEvaluator.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById }, tradeEvaluator: { evaluateTeamLeg: evaluateTeamLeg } };

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
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId) {
      legs[teamId] = { accepted: true, isUser: true };
      return;
    }
    const outgoing = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).map(function (a) { return a.playerId; });
    const incoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).map(function (a) { return a.playerId; });
    legs[teamId] = _TRADE_DATA.tradeEvaluator.evaluateTeamLeg(teamId, outgoing, incoming);
  });
  const accepted = Object.keys(legs).every(function (teamId) { return legs[teamId].accepted; });
  return { accepted: accepted, legs: legs };
}

function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
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
    proposeTrade: proposeTrade
  };
}
