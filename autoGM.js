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
      trade: { validateRosterSizes: validateRosterSizes, evaluateTrade: evaluateTrade, findPick: findPick }
    };

// The only numeric roster constraint the game enforces today that can leave
// a team stuck with no existing resolution path (rosterMoves.js's own 12-man
// floor already blocks waiving below it; free agency's own >=15 check already
// blocks new AI signings past it — but nothing stops a MANUAL user signing or
// a draft addition from pushing past 15). Waives the lowest adjustedPlayerValue
// player, repeatedly, until back at 15 or waivePlayer itself refuses (roster
// at the 12-man floor).
// AI teams get the same treatment league-wide from enforceRosterCeilings
// (freeAgency.js), which runs whenever the silent market does; this per-team
// version serves the USER paths — the autoCap setting and the rollover.
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

// Two-team, player-for-player only (no draft picks) — keeps the search
// tractable. Finds a surplus piece on `team` (a position where it's deep
// relative to need) and tries every other team as a partner in rng-shuffled
// order, looking for a return player at a position where `team` is thin and
// whose salary clears the same salaryOk band tradeEvaluator.js already uses
// for every other trade in the game. Returns the first mutually-accepted
// match, or null if none exists this call.
//
// excludeTeamId lets the AI-to-AI autonomous pass (script.js's
// runWeeklyAIToAITradeGeneration) keep the user's team out of the partner
// search entirely — that path auto-executes whatever it finds with no
// inbox/approval step, so a mutually-accepted match involving the user's
// roster would otherwise trade their players away without them ever seeing
// an offer. The user-initiated path (runWeeklyTradeGeneration) doesn't pass
// this — it calls generateTradeOffer with `team` already the user's own
// team, so evaluateTrade's evaluateUserLeg=true is what keeps that one honest.
// needMultiplier only takes 4 discrete values (1.3/1.15/1.0/0.9 — see
// tradeEvaluator.js), and the "genuinely desperate" 1.3/1.15 bands are rare
// on real, mostly-balanced rosters. Treating "not a screaming need" (<=1.0)
// as surplus, and "not already well-stocked" (>=1.0) as a real target for
// the return side, keeps the generator directionally sound (never trades
// away an actual need, never targets a position already deep) without
// being so narrow it almost never finds a match. Exported separately from
// generateTradeOffer so the onTradeBlock bias is unit-testable without
// depending on a full partner match also being found.
function selectSurplusCandidate(team, roster) {
  let candidate = null;
  let candidateSurplus = -Infinity;
  roster.forEach(function (p) {
    const need = _AUTOGM_DATA.tradeEvaluator.needMultiplier(p.position, team);
    if (need > 1.0) return; // this position is a real need — don't trade it away
    let surplus = (1 - need) - _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(p, team) / 200;
    // A player the team has explicitly shopped (ui/tradeCenter.js's Trading
    // Block toggle) is strongly preferred as the outgoing piece.
    if (p.onTradeBlock) surplus += 0.5;
    if (surplus > candidateSurplus) { candidate = p; candidateSurplus = surplus; }
  });
  return candidate;
}

// Greedy fallback (ZenGM's makeItWork.ts adds assets one at a time until a
// deal balances, up to 5; ours is a two-team-only market so it's bounded to
// exactly one extra asset). Only tried once the straight one-for-one loop
// above has already failed for every partner — this never changes the
// straight-swap outcome, it only recovers deals that were close but not
// quite there, by sweetening `team`'s side with its own 2nd-round pick
// (round 1 stays off the table; that's a bigger commitment than a bench
// surplus-vs-need swap should cost).
function trySweetenedOffer(team, candidate, partner, partnerRoster, rng) {
  const ownPick = _AUTOGM_DATA.trade.findPick(team.id, 2);
  if (!ownPick) return null;
  for (let ri = 0; ri < partnerRoster.length; ri++) {
    const returnPlayer = partnerRoster[ri];
    if (_AUTOGM_DATA.tradeEvaluator.needMultiplier(returnPlayer.position, team) < 1.0) continue;
    const proposal = {
      participants: [team.id, partner.id],
      assignments: [
        { playerId: candidate.id, fromTeamId: team.id, toTeamId: partner.id },
        { playerId: returnPlayer.id, fromTeamId: partner.id, toTeamId: team.id }
      ],
      pickAssignments: [{ round: 2, fromTeamId: team.id, toTeamId: partner.id }]
    };
    if (_AUTOGM_DATA.trade.validateRosterSizes(proposal).length > 0) continue;
    const evaluation = _AUTOGM_DATA.trade.evaluateTrade(proposal, team.id, true);
    if (evaluation.accepted) return { proposal: proposal, evaluation: evaluation };
  }
  return null;
}

function generateTradeOffer(team, rng, excludeTeamId) {
  const roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  if (roster.length <= 12) return null;

  const candidate = selectSurplusCandidate(team, roster);
  if (!candidate) return null;

  const partners = _AUTOGM_DATA.teams.TEAMS.filter(function (t) { return t.id !== team.id && t.id !== excludeTeamId; }).slice();
  for (let i = partners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = partners[i]; partners[i] = partners[j]; partners[j] = tmp;
  }

  for (let pi = 0; pi < partners.length; pi++) {
    const partner = partners[pi];
    const partnerRoster = _AUTOGM_DATA.league.getTeamRoster(partner.id);
    const outgoingSalary = candidate.contract.salary;
    for (let ri = 0; ri < partnerRoster.length; ri++) {
      const returnPlayer = partnerRoster[ri];
      if (_AUTOGM_DATA.tradeEvaluator.needMultiplier(returnPlayer.position, team) < 1.0) continue; // not a position we're thin at
      const salaryIncrease = returnPlayer.contract.salary - outgoingSalary;
      if (salaryIncrease > outgoingSalary * 0.25 + 2000000) continue;

      const proposal = {
        participants: [team.id, partner.id],
        assignments: [
          { playerId: candidate.id, fromTeamId: team.id, toTeamId: partner.id },
          { playerId: returnPlayer.id, fromTeamId: partner.id, toTeamId: team.id }
        ],
        pickAssignments: []
      };
      if (_AUTOGM_DATA.trade.validateRosterSizes(proposal).length > 0) continue;
      const evaluation = _AUTOGM_DATA.trade.evaluateTrade(proposal, team.id, true);
      if (evaluation.accepted) return { proposal: proposal, evaluation: evaluation };
    }
  }

  for (let pi = 0; pi < partners.length; pi++) {
    const partner = partners[pi];
    const sweetened = trySweetenedOffer(team, candidate, partner, _AUTOGM_DATA.league.getTeamRoster(partner.id), rng);
    if (sweetened) return sweetened;
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    autoEnforceRosterSize: autoEnforceRosterSize,
    autoAllocateScoutPoints: autoAllocateScoutPoints,
    generateTradeOffer: generateTradeOffer,
    selectSurplusCandidate: selectSurplusCandidate,
    trySweetenedOffer: trySweetenedOffer
  };
}
