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
  assert.ok('possession' in simEngineModule.SIM_ENGINES);
  simEngineModule.registerEngine('boxscore', { simulateGame: function () { return { homeScore: 1, awayScore: 0, boxScore: null }; } });
  const engine = simEngineModule.getActiveEngine({ simEngine: 'boxscore' });
  assert.strictEqual(typeof engine.simulateGame, 'function');
  assert.throws(function () { simEngineModule.registerEngine('scoreonly', {}); }, /unknown engine name/);
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

function checkInjuries() {
  const injuriesModule = require(path.join(__dirname, '..', 'injuries.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const roster = leagueModule.getTeamRoster('BOS');
  const player = roster[0];
  player.status.injury = null;
  player.status.fatigue = 0;

  const rng = makeRng(123);
  let injuredCount = 0;
  const TRIALS = 2000;
  for (let i = 0; i < TRIALS; i++) {
    player.status.injury = null;
    injuriesModule.rollInjury(player, rng);
    if (player.status.injury) injuredCount++;
  }
  const rate = injuredCount / TRIALS;
  assert.ok(rate > 0.001 && rate < 0.02, 'injury rate should be low but nonzero, got ' + rate);

  player.status.injury = { severity: 'Two Weeks', gamesRemaining: 2 };
  injuriesModule.decrementInjuriesForTeamGame('BOS');
  assert.strictEqual(player.status.injury.gamesRemaining, 1);
  injuriesModule.decrementInjuriesForTeamGame('BOS');
  assert.strictEqual(player.status.injury, null, 'injury should clear once gamesRemaining hits 0');

  console.log('checkInjuries: OK');
}

checkInjuries();

function checkStandingsAndStats() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const team = teamsModule.getTeamById('BOS');
  const oppTeam = teamsModule.getTeamById('LAL');
  team.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
  oppTeam.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };

  leagueModule.recordGameResult({ homeTeamId: 'BOS', awayTeamId: 'LAL', homeScore: 110, awayScore: 100 });
  assert.strictEqual(team.record.wins, 1);
  assert.strictEqual(oppTeam.record.losses, 1);
  assert.strictEqual(team.record.pointsFor, 110);
  assert.strictEqual(oppTeam.record.pointsAgainst, 110);

  const player = leagueModule.getTeamRoster('BOS')[0];
  player.seasonStats = undefined;
  leagueModule.accumulateSeasonStats(player.id, { points: 20, rebounds: 5, assists: 3, steals: 1, blocks: 0, fgm: 8, fga: 15, tpm: 2, tpa: 5, ftm: 2, fta: 2, minutes: 32 });
  leagueModule.accumulateSeasonStats(player.id, { points: 30, rebounds: 7, assists: 5, steals: 2, blocks: 1, fgm: 11, fga: 20, tpm: 3, tpa: 6, ftm: 5, fta: 6, minutes: 36 });
  const avg = leagueModule.getPlayerAverages(player);
  assert.strictEqual(player.seasonStats.gamesPlayed, 2);
  assert.strictEqual(avg.ppg, 25);
  assert.strictEqual(player.seasonStats.points, 50);

  console.log('checkStandingsAndStats: OK');
}

checkStandingsAndStats();

function checkSimulateDate() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers the boxscore engine as a side effect

  const season = {
    games: [
      { id: 0, homeTeamId: 'BOS', awayTeamId: 'LAL', day: 0, played: false },
      { id: 1, homeTeamId: 'MIA', awayTeamId: 'DEN', day: 0, played: false },
      { id: 2, homeTeamId: 'CHI', awayTeamId: 'DAL', day: 5, played: false }
    ]
  };
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(55);

  const simulatedToday = leagueModule.simulateDate(season, 0, settings, rng);
  assert.strictEqual(simulatedToday.length, 2, 'should simulate both games scheduled on day 0');
  assert.strictEqual(season.games[0].played, true);
  assert.strictEqual(season.games[1].played, true);
  assert.strictEqual(season.games[2].played, false, 'day 5 game should not simulate on day 0');
  assert.ok(typeof season.games[0].homeScore === 'number');

  const simulatedAgain = leagueModule.simulateDate(season, 0, settings, rng);
  assert.strictEqual(simulatedAgain.length, 0, 'already-played games should not simulate again');

  console.log('checkSimulateDate: OK');
}

checkSimulateDate();

function checkSimControls() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const season = {
    games: [
      { id: 0, homeTeamId: 'BOS', awayTeamId: 'LAL', day: 0, played: false },
      { id: 1, homeTeamId: 'BOS', awayTeamId: 'MIA', day: 3, played: false },
      { id: 2, homeTeamId: 'DEN', awayTeamId: 'PHX', day: 1, played: false }
    ]
  };
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(11);

  const nextGameDay = leagueModule.getNextGameDay(season, 'BOS', -1);
  assert.strictEqual(nextGameDay, 0);

  let currentDay = leagueModule.simulateNextDay(season, -1, settings, rng);
  assert.strictEqual(currentDay, 0);
  assert.strictEqual(season.games[0].played, true);

  const nextBosGame = leagueModule.getNextGameDay(season, 'BOS', currentDay);
  assert.strictEqual(nextBosGame, 3);

  currentDay = leagueModule.simulateThroughDate(season, currentDay, nextBosGame, settings, rng);
  assert.strictEqual(currentDay, 3);
  assert.strictEqual(season.games[1].played, true, 'BOS game on day 3 should be simulated');
  assert.strictEqual(season.games[2].played, true, 'DEN game on day 1 should also be simulated while passing through');

  console.log('checkSimControls: OK');
}

checkSimControls();

function checkPlayoffSeeding() {
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  teamsModule.TEAMS.forEach(function (t) { t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  // Deterministic standings for this test: rank Eastern teams by array order.
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record.wins = eastern.length - i; });

  const seeds = playoffsModule.getPlayoffSeeds('Eastern');
  assert.strictEqual(seeds.length, 8);
  assert.strictEqual(seeds[0].id, eastern[0].id, 'highest win total should be the 1-seed');

  const bracket = playoffsModule.generateBracket();
  assert.strictEqual(bracket.first.length, 8, '4 series per conference x 2 conferences');
  assert.strictEqual(bracket.semis.length, 0, 'later rounds do not exist until earlier rounds complete');
  bracket.first.forEach(function (series) {
    assert.strictEqual(series.winsHigher, 0);
    assert.strictEqual(series.complete, false);
  });

  console.log('checkPlayoffSeeding: OK');
}

checkPlayoffSeeding();

function checkPlayoffProgression() {
  require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers boxscore engine
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: eastern.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: western.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(200);

  let gamesSimulated = 0;
  let game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  while (game !== null && gamesSimulated < 500) {
    gamesSimulated += 1;
    game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  }

  // A full bracket is 15 series total (8 in round 1, 4 in semis, 2 in conf finals, 1 in
  // the finals); each series needs at least 4 games (a sweep), so the true minimum is
  // 15 * 4 = 60 games for the whole bracket to complete.
  assert.ok(gamesSimulated >= 60, 'a full bracket needs at least 60 games (15 series x 4-game minimum), got ' + gamesSimulated);
  assert.strictEqual(bracket.first.every(function (s) { return s.complete; }), true);
  assert.strictEqual(bracket.semis.length, 4);
  assert.strictEqual(bracket.confFinals.length, 2);
  assert.strictEqual(bracket.finals.length, 1);
  assert.ok(bracket.finals[0].complete, 'finals series should be complete once the loop exits');
  assert.ok(bracket.finals[0].winner, 'a champion should be crowned');

  console.log('checkPlayoffProgression: OK (champion: ' + bracket.finals[0].winner + ', ' + gamesSimulated + ' games)');
}

checkPlayoffProgression();
console.log('All sim validations passed');
