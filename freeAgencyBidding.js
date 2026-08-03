var _BIDDING_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), freeAgency: require('./freeAgency.js') }
  : {
      league: { getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap },
      freeAgency: { scoreOffer: scoreOffer, generateAIOffer: generateAIOffer, signPlayer: signPlayer }
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
  return { userWinning: userScore >= bestScore, bestAIOffer: best };
}

function finalizeBidding(state, userAccepts) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  if (userAccepts && state.userOffer) {
    _BIDDING_DATA.freeAgency.signPlayer(player, state.userOffer);
    return { signed: true, teamId: state.userTeamId };
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
