// The live watch path defers the user's game so their decisions can change
// it. That deferral is where a save file gets silently corrupted if the rng
// or the result application is wrong, so it gets its own test file.
//
// A note on what these assert and what they deliberately do NOT: TEAMS
// records, player season stats, fatigue and morale all accumulate on
// module-level globals across checks in one process. So comparing the SCORES
// of two separate full runs proves nothing — they can differ because the
// league drifted between them, not because of anything under test. Each check
// below therefore asserts against state captured inside a single run (an rng
// state, a sim's own result) rather than across runs. The "different
// decisions produce a different game" claim is proven at the sim level, where
// it is isolated, by validate-gamesim.js's checkDecisionsChangeOutcomes.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
require(path.join(__dirname, '..', 'gameCoach.js'));
require(path.join(__dirname, '..', 'gameSim.js'));
const schedule = require(path.join(__dirname, '..', 'schedule.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

// Same shape script.js's initSeason builds, so these exercise the real thing.
function freshSeason(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return { games: games, currentDay: -1 };
}

function firstDayWithGames(season) {
  return season.games.reduce(function (min, g) { return Math.min(min, g.day); }, Infinity);
}

function checkWatchedGameIsDeferred() {
  const season = freshSeason(101);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };

  league.simulateDate(season, day, {}, makeRng(5), null, watch);

  assert.ok(watch.liveGame, 'a live game handle is returned');
  assert.strictEqual(watch.liveGame.game.id, target.id, 'it is the requested game');
  assert.strictEqual(target.played, false, 'the watched game is NOT recorded yet');
  assert.strictEqual(watch.liveGame.sim.done, false, 'the sim has not been stepped');
  assert.strictEqual(watch.events.length, 0, 'no events captured before stepping');

  season.games.filter(function (g) { return g.day === day && g.id !== target.id; })
    .forEach(function (g) { assert.strictEqual(g.played, true, 'every other game that day IS recorded'); });

  console.log('checkWatchedGameIsDeferred: OK');
}
checkWatchedGameIsDeferred();

function checkFinishRecordsTheResult() {
  const season = freshSeason(102);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };
  league.simulateDate(season, day, {}, makeRng(6), null, watch);

  const sim = watch.liveGame.sim;
  while (!sim.done) sim.step();
  assert.strictEqual(watch.liveGame.finish(), true, 'finish applies the result');

  assert.strictEqual(target.played, true, 'the game is now recorded');
  assert.ok(target.homeScore > 0 && target.awayScore > 0, 'with real scores');
  assert.notStrictEqual(target.homeScore, target.awayScore, 'and no tie');
  assert.ok(target.boxScore, 'and a box score');
  assert.ok(watch.events.length > 100, 'events were captured while stepping');
  assert.strictEqual(watch.liveGame.finish(), false, 'a second finish is a no-op');

  console.log('checkFinishRecordsTheResult: OK');
}
checkFinishRecordsTheResult();

function checkLeagueRngIsIsolatedFromWatching() {
  // The watched game runs on its own derived rng. Stepping it happens over
  // minutes of wall clock, interleaved with autosaves, so if it consumed the
  // LEAGUE rng then the league's future would depend on when the user
  // happened to click — and a mid-watch save would capture an rng state from
  // inside a game that was never recorded.
  const season = freshSeason(103);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };
  const rng = makeRng(7);

  league.simulateDate(season, day, {}, rng, null, watch);
  const stateAfterDay = JSON.stringify(rng.getState());

  const sim = watch.liveGame.sim;
  let steps = 0;
  while (!sim.done) { sim.step(); steps++; }
  assert.ok(steps > 100, 'the game actually ran');
  assert.strictEqual(JSON.stringify(rng.getState()), stateAfterDay,
    'stepping the watched game must not advance the league rng');

  console.log('checkLeagueRngIsIsolatedFromWatching: OK');
}
checkLeagueRngIsIsolatedFromWatching();

function checkRecordedResultIsTheGameThatWasPlayed() {
  // The integration claim: what gets written into the schedule is exactly the
  // game the user coached, decisions included — not a re-sim, not the coach's
  // version of it.
  const season = freshSeason(104);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };
  league.simulateDate(season, day, {}, makeRng(8), null, watch);

  const sim = watch.liveGame.sim;
  let n = 0;
  while (!sim.done) {
    if (n % 20 === 0) sim.applyDecision({ type: 'timeout', team: 'home' });
    sim.step();
    n++;
  }
  assert.ok(sim.timeoutsLeft.home < 7, 'the queued timeouts were actually spent');

  const expected = sim.result();
  watch.liveGame.finish();

  assert.strictEqual(target.homeScore, expected.homeScore, 'recorded home score is the sim\'s');
  assert.strictEqual(target.awayScore, expected.awayScore, 'recorded away score is the sim\'s');
  assert.deepStrictEqual(
    Object.keys(target.boxScore).sort(),
    Object.keys(expected.boxScore).sort(),
    'recorded box score covers the same players');
  const totalMinutes = Object.keys(target.boxScore)
    .reduce(function (s, id) { return s + target.boxScore[id].minutes; }, 0);
  assert.ok(totalMinutes >= 460 && totalMinutes <= 500,
    'a complete game was recorded, not a partial one (total minutes ' + totalMinutes + ')');

  console.log('checkRecordedResultIsTheGameThatWasPlayed: OK');
}
checkRecordedResultIsTheGameThatWasPlayed();

console.log('validate-liveWatch: all checks passed');
