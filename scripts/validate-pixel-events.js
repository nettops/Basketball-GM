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
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

// takeover-start/end carry no `points` field ON PURPOSE — see gameSim.js. Every
// other type's `points` is summed against the final score below, so a takeover
// reporting its total there would double-count it.
const EVENT_TYPES = ['possession', 'turnover', 'block', 'shot', 'rebound', 'foul-ft',
  'takeover-start', 'takeover-end'];

function checkNoRngDrift() {
  // Same seed, capture on vs off: identical results.
  for (let seed = 1; seed <= 10; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const plain = gameSim.simulateGame(home.id, away.id, makeRng(seed));
    const events = [];
    const captured = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
    assert.strictEqual(captured.homeScore, plain.homeScore, 'homeScore drift at seed ' + seed);
    assert.strictEqual(captured.awayScore, plain.awayScore, 'awayScore drift at seed ' + seed);
    assert.strictEqual(JSON.stringify(captured.boxScore), JSON.stringify(plain.boxScore), 'boxScore drift at seed ' + seed);
    assert.ok(events.length > 0, 'events should have been captured');
  }
  console.log('checkNoRngDrift: OK');
}
checkNoRngDrift();

function checkEventIntegrity() {
  for (let seed = 20; seed < 35; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 13) % TEAMS.length];
    if (home.id === away.id) continue;
    const events = [];
    const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });

    const homeIds = league.getTeamRoster(home.id).map(function (p) { return p.id; });
    const awayIds = league.getTeamRoster(away.id).map(function (p) { return p.id; });

    let homePts = 0, awayPts = 0, lastQuarter = 1;
    events.forEach(function (ev) {
      assert.ok(EVENT_TYPES.indexOf(ev.type) !== -1, 'unknown event type ' + ev.type);
      assert.ok(ev.team === 'home' || ev.team === 'away', 'event team must be home/away');
      assert.ok(ev.quarter >= lastQuarter, 'quarters must be monotonic');
      lastQuarter = ev.quarter;
      assert.ok(ev.quarter >= 1 && ev.quarter <= 4, 'quarter in range');

      const ownIds = ev.team === 'home' ? homeIds : awayIds;
      const oppIds = ev.team === 'home' ? awayIds : homeIds;
      // rebound team is the rebounder's own side; all types put playerId on ev.team's roster
      assert.ok(ownIds.indexOf(ev.playerId) !== -1, ev.type + ' playerId ' + ev.playerId + ' not on ' + ev.team + ' roster');
      if (ev.defenderId) {
        assert.ok(oppIds.indexOf(ev.defenderId) !== -1, ev.type + ' defenderId not on opposing roster');
      }
      if (ev.type === 'shot' && ev.assistPlayerId) {
        assert.ok(ownIds.indexOf(ev.assistPlayerId) !== -1, 'assistPlayerId not on own roster');
        assert.notStrictEqual(ev.assistPlayerId, ev.playerId, 'no self-assists');
      }
      if (ev.type === 'foul-ft') {
        assert.strictEqual(ev.points, ev.made, 'foul-ft points must equal made');
        assert.ok(ev.made >= 0 && ev.made <= ev.attempts, 'made within attempts');
      }
      // A takeover event must never carry a scoring `points` field. This is the
      // assertion, not a courtesy: without it, naming the takeover's total
      // `points` would inflate the summed score and the failure would look like
      // a scoring bug rather than a field-name collision.
      if (ev.type === 'takeover-start' || ev.type === 'takeover-end') {
        assert.strictEqual(ev.points, undefined, ev.type + ' must not carry a scoring points field');
      }
      const pts = ev.points || 0;
      if (ev.team === 'home') homePts += pts; else awayPts += pts;
    });

    assert.strictEqual(homePts, result.homeScore, 'event points must sum to home score');
    assert.strictEqual(awayPts, result.awayScore, 'event points must sum to away score');

    // Every possession event is eventually followed by a terminal event before the next possession
    let openPossession = false;
    events.forEach(function (ev) {
      if (ev.type === 'possession') {
        assert.ok(!openPossession, 'possession opened while previous still unterminated');
        openPossession = true;
      } else if (ev.type === 'turnover' || ev.type === 'block' || ev.type === 'shot') {
        openPossession = false;
      }
    });
  }
  console.log('checkEventIntegrity: OK');
}
checkEventIntegrity();

function checkSimulateDateWatchPath() {
  const schedule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'fatigue.js'));
  require(path.join(__dirname, '..', 'injuries.js'));
  require(path.join(__dirname, '..', 'morale.js'));
  const rng = makeRng(777);
  const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const day0Games = games.filter(function (g) { return g.day === 0; });
  assert.ok(day0Games.length > 0, 'day 0 should have games');
  const watched = day0Games[0];
  const events = [];
  // Active engine is boxscore — the watched game must still go through possession.
  league.simulateDate(season, 0, { simEngine: 'boxscore' }, rng, null, { gameId: watched.id, events: events });
  assert.ok(watched.played, 'watched game was played');
  assert.ok(events.length > 0, 'watched game captured events');
  assert.ok(watched.playByPlay && watched.playByPlay.length > 0, 'watched game has possession play-by-play');
  const others = day0Games.filter(function (g) { return g.id !== watched.id; });
  others.forEach(function (g) {
    assert.ok(g.played, 'other games still played');
    assert.strictEqual(g.playByPlay, null, 'other games used the boxscore engine (no play-by-play)');
  });
  let homePts = 0;
  events.forEach(function (ev) { if (ev.team === 'home') homePts += (ev.points || 0); });
  assert.strictEqual(homePts, watched.homeScore, 'watched game event points match recorded score');
  console.log('checkSimulateDateWatchPath: OK');
}
checkSimulateDateWatchPath();

function checkPlayoffWatchPath() {
  const playoffs = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'morale.js'));
  const rng = makeRng(4242);
  // Give every team a record so seeding is deterministic enough to build a bracket.
  TEAMS.forEach(function (t, i) { t.record.wins = 60 - i; t.record.losses = 22 + i; });
  const bracket = playoffs.generateBracket(rng, { playIn: false });
  const firstSeries = bracket.first[0];
  const watchTeam = firstSeries.higherSeed;

  const events = [];
  const game = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng,
    { teamId: watchTeam, events: events });

  assert.ok(game, 'a playoff game should have been simulated');
  assert.ok(game.homeTeamId === watchTeam || game.awayTeamId === watchTeam, 'first game involves the watched team');
  assert.ok(events.length > 0, 'watched playoff game captured events even though the active engine is boxscore');
  assert.ok(game.playByPlay && game.playByPlay.length > 0, 'watched playoff game has possession play-by-play');

  let homePts = 0, awayPts = 0;
  events.forEach(function (ev) {
    if (ev.team === 'home') homePts += (ev.points || 0); else awayPts += (ev.points || 0);
  });
  assert.strictEqual(homePts, game.homeScore, 'playoff event points match the recorded home score');
  assert.strictEqual(awayPts, game.awayScore, 'playoff event points match the recorded away score');

  // A game NOT involving the watched team must not capture into the same array.
  const before = events.length;
  let other = null, guard = 0;
  while (guard++ < 40) {
    other = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng, { teamId: watchTeam, events: [] });
    if (!other) break;
    if (other.homeTeamId !== watchTeam && other.awayTeamId !== watchTeam) break;
  }
  assert.strictEqual(events.length, before, 'other teams\' playoff games do not append to the watched log');
  console.log('checkPlayoffWatchPath: OK');
}
checkPlayoffWatchPath();

// --- Task 2: clock / period / lineup stamps ------------------------------

function checkEventStamps() {
  const events = [];
  gameSim.simulateGame('BOS', 'LAL', makeRng(21), { events: events });

  events.forEach(function (ev) {
    assert.ok(typeof ev.period === 'number' && ev.period >= 1, 'every event carries a period');
    assert.ok(typeof ev.clock === 'number' && ev.clock >= 0, 'every event carries a clock');
    assert.strictEqual(ev.clock, Math.round(ev.clock), 'clock is whole seconds');
    const periodLength = ev.period <= 4 ? 720 : 300;
    assert.ok(ev.clock <= periodLength, 'clock fits inside its period: ' + ev.clock + ' in period ' + ev.period);
  });

  const possessions = events.filter(function (ev) { return ev.type === 'possession'; });
  assert.ok(possessions.length > 100, 'a full game has many possessions');
  possessions.forEach(function (ev) {
    assert.ok(ev.lineups, 'possession events carry lineups');
    assert.strictEqual(ev.lineups.home.length, 5, 'five home players on court');
    assert.strictEqual(ev.lineups.away.length, 5, 'five away players on court');
    assert.strictEqual(new Set(ev.lineups.home.concat(ev.lineups.away)).size, 10, 'ten distinct players');
  });

  // The clock only ever runs down within a period.
  let prev = null;
  possessions.forEach(function (ev) {
    if (prev && prev.period === ev.period) {
      assert.ok(ev.clock <= prev.clock, 'clock is non-increasing within a period');
    }
    prev = ev;
  });

  // Lineups must actually change over a game — a stamp that never moves would
  // pass every assertion above while silently reporting the starters all night.
  const distinct = new Set(possessions.map(function (ev) { return ev.lineups.home.slice().sort().join(','); }));
  assert.ok(distinct.size >= 4, 'the home five changes over the game, saw ' + distinct.size + ' distinct lineups');

  console.log('checkEventStamps: OK');
}
checkEventStamps();

console.log('All pixel event validations passed');
