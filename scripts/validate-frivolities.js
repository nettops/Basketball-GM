const assert = require('assert');
const path = require('path');

// ui/frivolities.js is a browser-global-style file (same pattern as
// ui/salaryCap.js/ui/powerRankings.js) — set its dependencies as globals
// before requiring it.
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const careerHistoryModule = require(path.join(__dirname, '..', 'careerHistory.js'));
const historyModule = require(path.join(__dirname, '..', 'history.js'));

global.TEAMS = teamsModule.TEAMS;
global.PLAYERS_2026 = playersModule.PLAYERS_2026;
global.getPlayerById = leagueModule.getPlayerById;
global.getTeamById = teamsModule.getTeamById;
global.ensureCareerHistory = careerHistoryModule.ensureCareerHistory;
global.LEAGUE_HISTORY = historyModule.LEAGUE_HISTORY;

const frivolitiesModule = require(path.join(__dirname, '..', 'ui', 'frivolities.js'));

function checkTradeFrequencyByTeam() {
  historyModule.LEAGUE_HISTORY.trades.length = 0;
  historyModule.LEAGUE_HISTORY.trades.push({ leagueYear: 2050, participants: ['BOS', 'LAL'], players: [{ playerId: 'p1', playerName: 'Test Player One' }], picks: [] });
  historyModule.LEAGUE_HISTORY.trades.push({ leagueYear: 2051, participants: ['BOS', 'MIA'], players: [{ playerId: 'p2', playerName: 'Test Player Two' }], picks: [] });

  const freq = frivolitiesModule.computeTradeFrequencyByTeam();
  assert.strictEqual(freq.length, teamsModule.TEAMS.length, 'every team should appear exactly once');
  const bos = freq.find(function (r) { return r.team.id === 'BOS'; });
  assert.strictEqual(bos.count, 2, 'BOS appears in both trades');
  assert.strictEqual(freq[0].team.id, 'BOS', 'the team with the most trades should sort first');

  console.log('checkTradeFrequencyByTeam: OK');
}

checkTradeFrequencyByTeam();

function checkMostTradedPlayers() {
  historyModule.LEAGUE_HISTORY.trades.length = 0;
  historyModule.LEAGUE_HISTORY.trades.push({ leagueYear: 2050, participants: ['BOS', 'LAL'], players: [{ playerId: 'p1', playerName: 'Frequently Traded' }], picks: [] });
  historyModule.LEAGUE_HISTORY.trades.push({ leagueYear: 2051, participants: ['LAL', 'MIA'], players: [{ playerId: 'p1', playerName: 'Frequently Traded' }], picks: [] });
  historyModule.LEAGUE_HISTORY.trades.push({ leagueYear: 2052, participants: ['MIA', 'DEN'], players: [{ playerId: 'p3', playerName: 'Traded Once' }], picks: [] });

  const top = frivolitiesModule.computeMostTradedPlayers(5);
  assert.strictEqual(top[0].playerId, 'p1');
  assert.strictEqual(top[0].count, 2);

  console.log('checkMostTradedPlayers: OK');
}

checkMostTradedPlayers();

function checkDraftClassHitRates() {
  historyModule.LEAGUE_HISTORY.draftClasses.length = 0;
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const highOverallPlayer = bosRoster[0];
  const lowOverallPlayer = bosRoster[1];
  // `overall` is derived from the attributes (ratings.js) and cannot be
  // assigned; move the attributes that produce it instead.
  const ratingsModule = require(path.join(__dirname, '..', 'ratings.js'));
  ratingsModule.scaleAttributesToOverall(highOverallPlayer, 85);
  ratingsModule.scaleAttributesToOverall(lowOverallPlayer, 60);

  historyModule.LEAGUE_HISTORY.draftClasses.push({
    leagueYear: 2050,
    picks: [
      { round: 1, pickNumber: 1, teamId: 'BOS', playerId: highOverallPlayer.id, playerName: highOverallPlayer.name },
      { round: 1, pickNumber: 2, teamId: 'BOS', playerId: lowOverallPlayer.id, playerName: lowOverallPlayer.name },
      { round: 1, pickNumber: 3, teamId: 'BOS', playerId: 'not-a-real-player-anymore', playerName: 'Untraceable' }
    ]
  });

  const rates = frivolitiesModule.computeDraftClassHitRates();
  const cls2050 = rates.find(function (r) { return r.leagueYear === 2050; });
  assert.strictEqual(cls2050.total, 3);
  assert.strictEqual(cls2050.resolved, 2, 'the untraceable pick should not count toward resolved');
  assert.strictEqual(cls2050.hits, 1, 'only the 85-overall pick should count as a hit at the 75+ threshold');

  console.log('checkDraftClassHitRates: OK');
}

checkDraftClassHitRates();

function checkJerseyNumberPopularity() {
  playersModule.PLAYERS_2026.forEach(function (p, i) { p.jerseyNumber = i % 3 === 0 ? 23 : (i % 3 === 1 ? 7 : i); });
  const popularity = frivolitiesModule.computeJerseyNumberPopularity();
  assert.ok(popularity.length > 0);
  assert.ok(popularity[0].count >= popularity[popularity.length - 1].count, 'should be sorted descending by popularity');

  console.log('checkJerseyNumberPopularity: OK');
}

checkJerseyNumberPopularity();

function checkLongestCurrentTenures() {
  const player = leagueModule.getTeamRoster('BOS')[0];
  const history = careerHistoryModule.ensureCareerHistory(player);
  history.teamHistory = [{ team: 'Boston Harbormen', teamId: 'BOS', startSeason: 2040, endSeason: null, seasons: 12, totalGames: 900 }];

  const tenures = frivolitiesModule.computeLongestCurrentTenures(5);
  assert.ok(tenures.some(function (t) { return t.player.id === player.id && t.seasons === 12; }));

  console.log('checkLongestCurrentTenures: OK');
}

checkLongestCurrentTenures();

function checkTotalRetiredNumbers() {
  teamsModule.TEAMS.forEach(function (t) { t.retiredNumbers = []; });
  teamsModule.getTeamById('BOS').retiredNumbers = [6, 33];
  teamsModule.getTeamById('LAL').retiredNumbers = [24];
  assert.strictEqual(frivolitiesModule.computeTotalRetiredNumbers(), 3);
  console.log('checkTotalRetiredNumbers: OK');
}

checkTotalRetiredNumbers();

console.log('All frivolities validations passed');
