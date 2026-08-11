var _BIDDING_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), freeAgency: require('./freeAgency.js') }
  : {
      league: { getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap },
      freeAgency: { scoreOffer: scoreOffer, generateAIOffer: generateAIOffer, signPlayer: signPlayer, checkOffer: checkOffer }
    };

function startBidding(playerId, userTeamId, rng) {
  const player = _BIDDING_DATA.league.getPlayerById(playerId);
  const aiOffers = [];
  // Iterate every team except the user's; generateAIOffer already screens out
  // teams with no room or no real interest.
  _BIDDING_DATA.teams.TEAMS
    .filter(function (t) { return t.id !== userTeamId; })
    .forEach(function (t) {
      const offer = _BIDDING_DATA.freeAgency.generateAIOffer(t, player, rng);
      if (offer) aiOffers.push(offer);
    });
  return { playerId: playerId, userTeamId: userTeamId, aiOffers: aiOffers, userOffer: null, rounds: 0 };
}

function bestAIOffer(state) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  const sorted = state.aiOffers.slice().sort(function (a, b) {
    return _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(b.teamId), b)
      - _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(a.teamId), a);
  });
  return sorted[0] || null;
}

function evaluateBiddingRound(state, userSalary, userYears) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  const userTeam = _BIDDING_DATA.teams.getTeamById(state.userTeamId);

  // The user's team is bound by the same rule as every AI team's — the cap
  // check that used to live only inside generateAIOffer, which this path does
  // not call. An illegal offer is not recorded at all, so state.userOffer
  // still holds whatever legal offer preceded it (or null) and finalizeBidding
  // cannot award the player on the strength of a bid that was refused.
  const legality = _BIDDING_DATA.freeAgency.checkOffer(userTeam, userSalary, userYears);
  if (!legality.ok) {
    const stillBest = bestAIOffer(state);
    return {
      offerAccepted: false, rejectedReason: legality.reason, offerLimit: legality.limit,
      userWinning: false, bestAIOffer: stillBest
    };
  }

  const userOffer = { teamId: state.userTeamId, salary: userSalary, yearsRemaining: userYears };
  state.userOffer = userOffer;
  const userScore = _BIDDING_DATA.freeAgency.scoreOffer(player, userTeam, userOffer);

  state.aiOffers = state.aiOffers.map(function (o) {
    const aiTeam = _BIDDING_DATA.teams.getTeamById(o.teamId);
    const currentScore = _BIDDING_DATA.freeAgency.scoreOffer(player, aiTeam, o);
    if (currentScore >= userScore) return o; // already winning, no need to raise
    const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
    const capSpace = _BIDDING_DATA.data.getEffectiveSalaryCap(capLevel) - _BIDDING_DATA.league.getTeamPayroll(o.teamId) + o.salary;
    const raisedSalary = Math.min(capSpace, Math.round(o.salary * 1.1));
    if (raisedSalary <= o.salary) return null; // no room to raise, drops out
    const raised = { teamId: o.teamId, salary: raisedSalary, yearsRemaining: o.yearsRemaining };
    const raisedScore = _BIDDING_DATA.freeAgency.scoreOffer(player, aiTeam, raised);
    if (raisedScore < userScore * 0.95) return null; // still clearly behind, gives up
    return raised;
  }).filter(Boolean);

  state.rounds += 1;

  const best = bestAIOffer(state);
  const bestScore = best ? _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(best.teamId), best) : -Infinity;
  // Recorded on the state, not merely reported: finalizeBidding has to know
  // whether he actually chose you. It used to be returned for display and then
  // discarded, which made the whole contest decorative.
  state.userWinning = userScore >= bestScore;
  return { offerAccepted: true, rejectedReason: null, offerLimit: legality.limit,
    userWinning: state.userWinning, bestAIOffer: best };
}

function finalizeBidding(state, userAccepts) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  if (userAccepts && state.userOffer) {
    // Re-checked at signing rather than trusted from the bidding round: cap
    // space can move between the two (another signing, a trade), and a guard
    // that only runs on the path the UI happens to take is the same mistake
    // that created this bug. If the offer is no longer legal the player goes
    // to the best AI bid instead, exactly as if the user had withdrawn.
    //
    // The CAP half of this is reachable and tested (validate-freeAgencyCap's
    // checkCapSpaceLostBetweenBidAndSigning). The YEARS half is not: term
    // cannot change between bidding and signing, so state.userOffer can only
    // ever hold a term evaluateBiddingRound already accepted. It is passed
    // anyway, as belt and braces against anything that later mutates
    // state.userOffer — but it is unreachable today, so do not "prove" it with
    // a test that only appears to exercise it.
    const userTeam = _BIDDING_DATA.teams.getTeamById(state.userTeamId);
    // He has to have CHOSEN you. Pressing Sign Player used to hand him over
    // regardless of what the bidding said, so a 91-overall could be had for the
    // $1,200,000 league minimum while eleven teams bid up to $31,833,686 and
    // the panel read "Behind". Losing now behaves exactly like withdrawing:
    // he signs with whoever actually won.
    if (state.userWinning &&
        _BIDDING_DATA.freeAgency.checkOffer(userTeam, state.userOffer.salary, state.userOffer.yearsRemaining).ok) {
      _BIDDING_DATA.freeAgency.signPlayer(player, state.userOffer);
      return { signed: true, teamId: state.userTeamId };
    }
  }
  const best = bestAIOffer(state);
  if (best) {
    _BIDDING_DATA.freeAgency.signPlayer(player, best);
    return { signed: true, teamId: best.teamId };
  }
  return { signed: false, teamId: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startBidding: startBidding, evaluateBiddingRound: evaluateBiddingRound, finalizeBidding: finalizeBidding };
}
