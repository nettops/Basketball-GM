const assert = require('assert');
const path = require('path');

// ui/powerRankings.js is a browser-global-style file (no require/module.exports
// guard pattern for its TEAMS/getTeamRoster dependency) — same pattern as
// ui/salaryCap.js, so its own test sets the globals it needs before requiring.
global.TEAMS = require(path.join(__dirname, '..', 'teams.js')).TEAMS;
global.getTeamRoster = require(path.join(__dirname, '..', 'league.js')).getTeamRoster;
const powerRankingsModule = require(path.join(__dirname, '..', 'ui', 'powerRankings.js'));

function makeSeason(games) {
  return { games: games };
}

function checkRecentFormWinPct() {
  const games = [
    { day: 0, homeTeamId: 'BOS', awayTeamId: 'MIA', played: true, homeScore: 100, awayScore: 90 }, // BOS win
    { day: 1, homeTeamId: 'LAL', awayTeamId: 'BOS', played: true, homeScore: 110, awayScore: 105 }, // BOS loss (away)
    { day: 2, homeTeamId: 'BOS', awayTeamId: 'DEN', played: false, homeScore: null, awayScore: null } // unplayed, excluded
  ];
  const pct = powerRankingsModule.recentFormWinPct('BOS', makeSeason(games));
  assert.strictEqual(pct, 0.5, '1 win out of 2 played games should be 0.5');

  const noSeason = powerRankingsModule.recentFormWinPct('BOS', null);
  assert.strictEqual(noSeason, 0.5, 'no season in progress should default to a neutral 0.5');

  const noGames = powerRankingsModule.recentFormWinPct('BOS', makeSeason([]));
  assert.strictEqual(noGames, 0.5, 'no games played yet should default to a neutral 0.5');

  console.log('checkRecentFormWinPct: OK');
}

checkRecentFormWinPct();

function checkComputePowerRankingScoreOrdering() {
  const strongTeam = { id: 'BOS', record: { wins: 50, losses: 10, pointsFor: 6000, pointsAgainst: 5400 } };
  const weakTeam = { id: 'WAS', record: { wins: 10, losses: 50, pointsFor: 5400, pointsAgainst: 6000 } };

  const strongScore = powerRankingsModule.computePowerRankingScore(strongTeam, null);
  const weakScore = powerRankingsModule.computePowerRankingScore(weakTeam, null);
  assert.ok(strongScore > weakScore, 'a team with a much better record and point differential should score higher');

  console.log('checkComputePowerRankingScoreOrdering: OK (strong=' + strongScore.toFixed(1) + ', weak=' + weakScore.toFixed(1) + ')');
}

checkComputePowerRankingScoreOrdering();

function checkComputePowerRankingsReturnsAllTeamsSorted() {
  const rankings = powerRankingsModule.computePowerRankings(null);
  assert.strictEqual(rankings.length, global.TEAMS.length, 'every team should appear exactly once');
  for (let i = 1; i < rankings.length; i++) {
    assert.ok(rankings[i - 1].score >= rankings[i].score, 'rankings should be sorted best-score-first');
  }
  console.log('checkComputePowerRankingsReturnsAllTeamsSorted: OK');
}

checkComputePowerRankingsReturnsAllTeamsSorted();

console.log('All power rankings validations passed');
