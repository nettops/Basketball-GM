const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkRng() {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB, 'same seed must produce same sequence');
  seqA.forEach(function (v) { assert.ok(v >= 0 && v < 1, 'rng output out of [0,1) range'); });
  const c = makeRng(43);
  assert.notStrictEqual(a(), c(), 'different seeds should (almost certainly) differ');
  console.log('checkRng: OK');
}

checkRng();

const { generateMatchupCounts } = require(path.join(__dirname, '..', 'schedule.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

function checkMatchupCounts() {
  const rng = makeRng(42);
  const gamesCount = generateMatchupCounts(rng);

  let totalGames = 0;
  const bad = [];
  teamsModule.TEAMS.forEach(function (t) {
    const total = Object.values(gamesCount[t.id]).reduce(function (s, n) { return s + n; }, 0);
    totalGames += total;
    if (total !== 82) bad.push([t.id, total]);
  });
  assert.strictEqual(bad.length, 0, 'teams with wrong total games: ' + JSON.stringify(bad));
  assert.strictEqual(totalGames, 82 * 30, 'sum of all teams total games must be 82*30');

  teamsModule.TEAMS.forEach(function (t) {
    const nonDivConfOpponents = teamsModule.TEAMS.filter(function (o) {
      return o.conference === t.conference && o.division !== t.division;
    });
    const fourGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 4; }).length;
    const threeGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 3; }).length;
    assert.strictEqual(fourGameCount, 6, t.id + ' should have 6 four-game non-division opponents, got ' + fourGameCount);
    assert.strictEqual(threeGameCount, 4, t.id + ' should have 4 three-game non-division opponents, got ' + threeGameCount);
  });

  console.log('checkMatchupCounts: OK');
}

checkMatchupCounts();

function checkSeasonGames() {
  const rng = makeRng(42);
  const games = require(path.join(__dirname, '..', 'schedule.js')).generateSeasonGames(rng, teamsModule.TEAMS);

  assert.strictEqual(games.length, 1230, 'expected exactly 1230 games');

  const perTeamCount = {};
  teamsModule.TEAMS.forEach(function (t) { perTeamCount[t.id] = 0; });
  games.forEach(function (g) {
    perTeamCount[g.home]++;
    perTeamCount[g.away]++;
  });
  teamsModule.TEAMS.forEach(function (t) {
    assert.strictEqual(perTeamCount[t.id], 82, t.id + ' should have 82 games, got ' + perTeamCount[t.id]);
  });

  // No team plays 3+ games within any 3-day window.
  const daysByTeam = {};
  teamsModule.TEAMS.forEach(function (t) { daysByTeam[t.id] = []; });
  games.forEach(function (g) {
    daysByTeam[g.home].push(g.day);
    daysByTeam[g.away].push(g.day);
  });
  Object.keys(daysByTeam).forEach(function (teamId) {
    const days = daysByTeam[teamId].slice().sort(function (a, b) { return a - b; });
    for (let i = 0; i + 2 < days.length; i++) {
      assert.ok(days[i + 2] - days[i] > 2, teamId + ' has 3 games within a 3-day window around day ' + days[i]);
    }
  });

  console.log('checkSeasonGames: OK');
}

checkSeasonGames();

function checkEngineRegistry() {
  const simEngineModule = require(path.join(__dirname, '..', 'simEngine.js'));
  assert.ok('boxscore' in simEngineModule.SIM_ENGINES);
  assert.ok('scoreonly' in simEngineModule.SIM_ENGINES);
  assert.ok('possession' in simEngineModule.SIM_ENGINES);
  simEngineModule.registerEngine('boxscore', { simulateGame: function () { return { homeScore: 1, awayScore: 0, boxScore: null }; } });
  const engine = simEngineModule.getActiveEngine({ simEngine: 'boxscore' });
  assert.strictEqual(typeof engine.simulateGame, 'function');
  assert.throws(function () { simEngineModule.getActiveEngine({ simEngine: 'possession' }); }, /not implemented yet/);
  console.log('checkEngineRegistry: OK');
}

checkEngineRegistry();

function checkScoreSimulation() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(99);
  let homeWins = 0;
  const TRIALS = 500;
  for (let i = 0; i < TRIALS; i++) {
    const result = engineModule.simulateScore(95, 80, rng); // clear home rating edge
    assert.ok(result.homeScore >= 70 && result.homeScore <= 160, 'home score out of realistic range');
    assert.ok(result.awayScore >= 70 && result.awayScore <= 160, 'away score out of realistic range');
    assert.notStrictEqual(result.homeScore, result.awayScore, 'games must not end in a tie');
    if (result.homeScore > result.awayScore) homeWins++;
  }
  assert.ok(homeWins / TRIALS > 0.7, 'a 15-point rating edge plus home court should win clearly more than 70% of the time, got ' + (homeWins / TRIALS));
  console.log('checkScoreSimulation: OK');
}

checkScoreSimulation();

function checkDistributeInt() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const result = engineModule.distributeInt(100, [1, 2, 3, 4]);
  assert.strictEqual(result.reduce(function (a, b) { return a + b; }, 0), 100);
  assert.strictEqual(result.length, 4);
  result.forEach(function (v) { assert.ok(v >= 0); });
  console.log('checkDistributeInt: OK');
}

function checkBoxScoreGeneration() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(7);
  const result = engineModule.simulateGame('BOS', 'LAL', rng);

  assert.ok(result.homeScore > 0 && result.awayScore > 0);

  const homeRoster = new Set(require(path.join(__dirname, '..', 'league.js')).getTeamRoster('BOS').map(function (p) { return p.id; }));
  let homePointsSum = 0;
  let homeMinutesSum = 0;
  Object.keys(result.boxScore).forEach(function (playerId) {
    if (homeRoster.has(playerId)) {
      homePointsSum += result.boxScore[playerId].points;
      homeMinutesSum += result.boxScore[playerId].minutes;
      assert.ok(result.boxScore[playerId].points >= 0);
      assert.ok(result.boxScore[playerId].fga >= result.boxScore[playerId].fgm);
      assert.ok(result.boxScore[playerId].tpa >= result.boxScore[playerId].tpm);
      assert.ok(result.boxScore[playerId].fta >= result.boxScore[playerId].ftm);
    }
  });
  assert.strictEqual(homePointsSum, result.homeScore, 'home box score points must sum to home team score');
  assert.strictEqual(homeMinutesSum, 240, 'home team minutes must sum to 240');

  console.log('checkBoxScoreGeneration: OK');
}

checkDistributeInt();
checkBoxScoreGeneration();

function checkFatigue() {
  const fatigueModule = require(path.join(__dirname, '..', 'fatigue.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const roster = leagueModule.getTeamRoster('BOS');
  const starter = roster[0];
  starter.status.fatigue = 0;

  fatigueModule.applyFatigueForGame('BOS', (function () { const m = {}; roster.forEach(function (p) { m[p.id] = 30; }); return m; })(), false);
  assert.ok(starter.status.fatigue > 0, 'fatigue should rise after playing minutes');

  const before = starter.status.fatigue;
  fatigueModule.decayFatigueForRest('BOS', 2);
  assert.ok(starter.status.fatigue < before, 'fatigue should fall after rest days');

  starter.status.fatigue = 0; // reset so later tasks' tests aren't affected by this one's side effects
  console.log('checkFatigue: OK');
}

checkFatigue();
console.log('All sim validations passed');
