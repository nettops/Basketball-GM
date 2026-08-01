var _ENGINE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js') }
  : { league: { getTeamRoster: getTeamRoster }, teams: { getTeamById: getTeamById }, simEngine: { registerEngine: registerEngine } };

function computeTeamRating(teamId) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const rotation = roster.slice().sort(function (a, b) { return b.overall - a.overall; }).slice(0, 8);
  if (rotation.length === 0) return 50; // fully depleted roster fallback, shouldn't happen with real data
  const avgOverall = rotation.reduce(function (s, p) { return s + p.overall; }, 0) / rotation.length;
  const avgFatiguePenalty = (rotation.reduce(function (s, p) { return s + p.status.fatigue; }, 0) / rotation.length) * 0.1;
  const team = _ENGINE_DATA.teams.getTeamById(teamId);
  const chemistryBonus = (team.chemistry - 70) * 0.05;
  return avgOverall - avgFatiguePenalty + chemistryBonus;
}

function simulateScore(homeRating, awayRating, rng) {
  const BASE_PACE = 112;
  const HOME_COURT_BONUS = 3;
  const diff = homeRating - awayRating;
  const homeExpected = BASE_PACE + diff * 0.6 + HOME_COURT_BONUS;
  const awayExpected = BASE_PACE - diff * 0.6;
  let homeScore = Math.round(homeExpected + (rng() - 0.5) * 24);
  let awayScore = Math.round(awayExpected + (rng() - 0.5) * 24);
  homeScore = Math.max(70, homeScore);
  awayScore = Math.max(70, awayScore);
  if (homeScore === awayScore) {
    // NBA games can't end in a tie — nudge whichever team had the rating edge.
    if (homeRating >= awayRating) homeScore += 1; else awayScore += 1;
  }
  return { homeScore: homeScore, awayScore: awayScore };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeTeamRating: computeTeamRating, simulateScore: simulateScore };
}
