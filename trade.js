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

// evaluateUserLeg: false (default) preserves today's behavior — the user's
// own leg of a trade they built by hand is never second-guessed by the AI.
// true is used by auto-generated proposals (autoGM.js's generateTradeOffer)
// where the user's team is being decided FOR by the same logic every AI
// team already uses, so its leg needs the same value/salary check as anyone
// else's.
function evaluateTrade(proposal, userTeamId, evaluateUserLeg) {
  const pickAssignments = proposal.pickAssignments || [];
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId && !evaluateUserLeg) {
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

// Every team's side of the deal, e.g. "Boston Celtics get Player A; Sacramento
// Kings get Player B". Built from proposal.assignments (fromTeamId/toTeamId),
// not the players' now-updated teamId, so it's accurate regardless of when
// it's called relative to the teamId mutation below.
function describeTradeForFeed(proposal) {
  return proposal.participants.map(function (teamId) {
    const team = _TRADE_DATA.teams.getTeamById(teamId);
    const incoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; })
      .map(function (a) { const p = _TRADE_DATA.league.getPlayerById(a.playerId); return p ? p.name : a.playerId; });
    return team.name + ' get ' + (incoming.length > 0 ? incoming.join(', ') : 'draft compensation only');
  }).join('; ');
}

function executeTrade(proposal, historySink, dayIndex) {
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
  // pushToFeed is a browser-global from script.js — guarded since trade.js
  // also runs standalone under Node in scripts/validate-trades.js.
  if (typeof pushToFeed === 'function') {
    pushToFeed('Trade: ' + describeTradeForFeed(proposal), dayIndex);
  }
  if (historySink) historySink(proposal);
}

function proposeTrade(proposal, userTeamId, evaluateUserLeg, historySink) {
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { accepted: false, rosterErrors: rosterErrors, legs: {} };
  }
  const evaluation = evaluateTrade(proposal, userTeamId, evaluateUserLeg);
  if (evaluation.accepted) {
    executeTrade(proposal, historySink);
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
    pickValueForLeg: pickValueForLeg,
    describeTradeForFeed: describeTradeForFeed
  };
}
