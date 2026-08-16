var _TRADE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), tradeEvaluator: require('./tradeEvaluator.js'), teams: require('./teams.js'), draftPickValue: require('./draftPickValue.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById },
      tradeEvaluator: { evaluateTeamLeg: evaluateTeamLeg, evaluateSalaryLeg: evaluateSalaryLeg },
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

// evaluateUserLeg: false (default) — the user's own leg of a trade they
// built by hand is never second-guessed on VALUE; a lopsided trade is theirs
// to make. The salary-matching rule is different: it is league LAW, the same
// one every AI leg answers to, and skipping it entirely let a team with no
// cap space absorb any salary at all (a $60M star for a minimum contract,
// through the real Propose button). The user's leg now runs the salary check
// alone — evaluateSalaryLeg — with Disable Salary Cap still the one way past
// it, same as free agency.
// true is used by auto-generated proposals (autoGM.js's generateTradeOffer)
// where the user's team is being decided FOR by the same logic every AI
// team already uses, so its leg needs the full value/salary check like
// anyone else's.
function evaluateTrade(proposal, userTeamId, evaluateUserLeg) {
  const pickAssignments = proposal.pickAssignments || [];
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId && !evaluateUserLeg) {
      const userOutgoing = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).map(function (a) { return a.playerId; });
      const userIncoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).map(function (a) { return a.playerId; });
      legs[teamId] = Object.assign(
        { isUser: true },
        _TRADE_DATA.tradeEvaluator.evaluateSalaryLeg(teamId, userOutgoing, userIncoming));
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

// Every team's side of the deal, e.g. "Boston Harbormen get Player A; Sacramento
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

function reassignJerseyIfTaken(player, teamId) {
  const team = _TRADE_DATA.teams.getTeamById(teamId);
  const taken = new Set(
    _TRADE_DATA.league.getTeamRoster(teamId)
      .filter(function (p) { return p.id !== player.id; })
      .map(function (p) { return p.jerseyNumber; })
      .concat((team && team.retiredNumbers) || [])
  );
  if (player.jerseyNumber !== null && player.jerseyNumber !== undefined && !taken.has(player.jerseyNumber)) return;
  let jersey = 0;
  while (taken.has(jersey)) jersey++;
  player.jerseyNumber = jersey;
}

function executeTrade(proposal, historySink, dayIndex) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    // A proposal can outlive the player it names — an offer sitting in the
    // inbox across an offseason references someone who may since have retired
    // (spliced out of PLAYERS_2026 by runOffseasonPreDraft). Same guard
    // archiveTrade already applies on its own pass over these assignments.
    if (!player) return;
    player.teamId = a.toTeamId;
    // A traded player keeps his old number by default, which can collide with a
    // teammate's or with one the new team has retired. Same free-number scan
    // draft.js's executePick and freeAgency.js's signPlayer already use — only
    // applied when the existing number is actually taken, so a player who can
    // keep his number does.
    reassignJerseyIfTaken(player, a.toTeamId);
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

// Accepting an offer out of the inbox is still a trade, and still has to leave
// both rosters legal. Both accept paths — the Trade Center button and the
// autoTrade auto-accept — called executeTrade RAW, so the 12-15 rule was
// enforced when you BUILT a trade and skipped when you accepted one. An offer
// is legal when autoGM generates it and can stop being legal while it sits
// there: sign a free agent, accept another offer, let the offseason retire
// somebody. Reproduced by hand — Boston left at 11 players against a stated
// minimum of 12.
//
// Note the commissioner's own Force Trade — an explicit cheat that skips value
// and salary entirely — still validates roster sizes. This path was the only
// one in the game that did not.
// Every named player must still be where the offer says he is. An offer sits
// in the inbox for days and names SPECIFIC players; executeTrade assigns them
// unconditionally, so waiving the player they asked for and then accepting
// handed him over anyway — from free agency — while their player still came to
// you. A free man for nothing, reproduced through the real Accept button.
//
// Roster-size validation cannot catch this: the counts balance either way,
// because the assignment list claims one out and one in regardless of who
// actually owns whom.
function staleAssignments(proposal) {
  return proposal.assignments.filter(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    return !player || player.teamId !== a.fromTeamId;
  }).map(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    const name = player ? player.name : a.playerId;
    return !player
      ? name + ' is no longer in the league'
      : name + ' is no longer on ' + a.fromTeamId;
  });
}

function acceptTradeOffer(proposal, historySink, dayIndex) {
  const stale = staleAssignments(proposal);
  if (stale.length > 0) {
    return { executed: false, rosterErrors: [], staleAssignments: stale };
  }
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { executed: false, rosterErrors: rosterErrors, staleAssignments: [] };
  }
  executeTrade(proposal, historySink, dayIndex);
  return { executed: true, rosterErrors: [], staleAssignments: [] };
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

// Incoming AI offers used to sit in the inbox forever. They are generated
// weekly, so over a career they accumulated without bound — a list that only
// ever grows is a standing obligation, and the player is never caught up.
// A week matches the generation cadence, so at most one or two are ever live
// and the inbox stays a snapshot of what is actually on the table rather than
// an archive of everything ever offered.
//
// Letting an offer lapse is a real answer, not a failure to answer: the
// Trade Center shows each one's remaining days, so ignoring it is a choice
// the player makes with the deadline in front of them.
const TRADE_OFFER_EXPIRY_DAYS = 7;

// Drops offers whose window has closed. Returns how many were removed.
// Tolerates a missing inbox so callers need no guard.
function pruneExpiredTradeOffers(gameState, dayIndex) {
  if (!gameState || !Array.isArray(gameState.tradeOffers)) return 0;
  const before = gameState.tradeOffers.length;
  gameState.tradeOffers = gameState.tradeOffers.filter(function (offer) {
    // Offers saved before this feature carry no dayReceived. Stamping them on
    // first sight gives them a full window; treating undefined as day 0 would
    // silently bin every pending offer the moment such a save was loaded.
    if (typeof offer.dayReceived !== 'number') {
      offer.dayReceived = dayIndex;
      return true;
    }
    return dayIndex - offer.dayReceived < TRADE_OFFER_EXPIRY_DAYS;
  });
  return before - gameState.tradeOffers.length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRADE_OFFER_EXPIRY_DAYS: TRADE_OFFER_EXPIRY_DAYS,
    pruneExpiredTradeOffers: pruneExpiredTradeOffers,
    validateRosterSizes: validateRosterSizes,
    acceptTradeOffer: acceptTradeOffer,
    staleAssignments: staleAssignments,
    evaluateTrade: evaluateTrade,
    executeTrade: executeTrade,
    proposeTrade: proposeTrade,
    findPick: findPick,
    pickValueForLeg: pickValueForLeg,
    describeTradeForFeed: describeTradeForFeed
  };
}
