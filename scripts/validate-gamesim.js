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
const golden = require(path.join(__dirname, 'fixtures', 'gamesim-golden.json'));

function boxChecksum(boxScore) {
  const keys = Object.keys(boxScore).sort();
  let sum = 0;
  keys.forEach(function (id, idx) {
    const line = boxScore[id];
    ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
     'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fouls'].forEach(function (k, ki) {
      sum = (sum + (line[k] || 0) * (idx + 1) * (ki + 3)) % 2147483647;
    });
  });
  return sum;
}

// The whole point of Stage 1: the refactor must not move a single number.
function checkGoldenMaster() {
  golden.forEach(function (g) {
    const result = gameSim.simulateGame(g.home, g.away, makeRng(g.seed));
    assert.strictEqual(result.homeScore, g.homeScore,
      'seed ' + g.seed + ' home score drifted: ' + result.homeScore + ' vs golden ' + g.homeScore);
    assert.strictEqual(result.awayScore, g.awayScore,
      'seed ' + g.seed + ' away score drifted: ' + result.awayScore + ' vs golden ' + g.awayScore);
    assert.strictEqual(boxChecksum(result.boxScore), g.boxChecksum,
      'seed ' + g.seed + ' box score distribution drifted');
    assert.strictEqual(result.playByPlay.length, g.playByPlayLength,
      'seed ' + g.seed + ' play-by-play length drifted');
  });
  console.log('checkGoldenMaster: OK (' + golden.length + ' cases)');
}
checkGoldenMaster();

// If a caller drives step() by hand, it must land on exactly the same game as
// the batch loop. This is the contract the live-stepped watch flow depends on.
function checkManualSteppingMatchesBatch() {
  const cases = [{ seed: 21, home: 'BOS', away: 'MIA' }, { seed: 34, home: 'DEN', away: 'GSW' }];
  cases.forEach(function (c) {
    const batch = gameSim.simulateGame(c.home, c.away, makeRng(c.seed));

    const sim = gameSim.createGameSim(c.home, c.away, makeRng(c.seed));
    let guard = 0;
    while (!sim.done) {
      sim.step();
      assert.ok(guard++ < 5000, 'step() must terminate');
    }
    const stepped = sim.result();

    assert.strictEqual(stepped.homeScore, batch.homeScore, 'stepped home score must equal batch');
    assert.strictEqual(stepped.awayScore, batch.awayScore, 'stepped away score must equal batch');
    assert.strictEqual(boxChecksum(stepped.boxScore), boxChecksum(batch.boxScore), 'stepped box score must equal batch');
    assert.deepStrictEqual(stepped.playByPlay, batch.playByPlay, 'stepped play-by-play must equal batch');
  });
  console.log('checkManualSteppingMatchesBatch: OK');
}
checkManualSteppingMatchesBatch();

// step() after completion must be a no-op, so an over-eager driver cannot
// corrupt a finished game.
function checkStepAfterDoneIsNoop() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(77));
  while (!sim.done) sim.step();
  const before = sim.result();
  sim.step();
  sim.step();
  const after = sim.result();
  assert.strictEqual(after.homeScore, before.homeScore, 'score must not move after done');
  assert.strictEqual(after.awayScore, before.awayScore, 'score must not move after done');
  assert.strictEqual(after.playByPlay.length, before.playByPlay.length, 'play-by-play must not grow after done');
  console.log('checkStepAfterDoneIsNoop: OK');
}
checkStepAfterDoneIsNoop();

// The engine must field five players a side, always — the old behaviour let
// every healthy player on the roster shoot on any possession.
function checkFivePlayersOnCourt() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(41));
  let guard = 0;
  // Math.min guards the degenerate case the spec calls out: a roster with
  // fewer than five healthy bodies fields everyone it has rather than
  // inventing players. Real rosters are 13-15, so this is 5 in practice.
  const homeFive = Math.min(5, sim.homeRoster.length);
  const awayFive = Math.min(5, sim.awayRoster.length);
  while (!sim.done) {
    assert.strictEqual(sim.onCourt.home.length, homeFive, 'home must field five');
    assert.strictEqual(sim.onCourt.away.length, awayFive, 'away must field five');
    assert.strictEqual(new Set(sim.onCourt.home).size, homeFive, 'no duplicate home players on court');
    assert.strictEqual(new Set(sim.onCourt.away).size, awayFive, 'no duplicate away players on court');
    sim.onCourt.home.forEach(function (id) {
      assert.ok(sim.homeBox[id], 'on-court home player must have a box line: ' + id);
    });
    sim.step();
    assert.ok(guard++ < 5000, 'step() must terminate');
  }
  console.log('checkFivePlayersOnCourt: OK');
}
checkFivePlayersOnCourt();

// Only players who were actually on the floor may accrue stats.
function checkBenchPlayersRecordNothing() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(42));
  const everOnCourt = {};
  while (!sim.done) {
    sim.onCourt.home.concat(sim.onCourt.away).forEach(function (id) { everOnCourt[id] = true; });
    sim.step();
  }
  const box = sim.result().boxScore;
  Object.keys(box).forEach(function (id) {
    if (everOnCourt[id]) return;
    const line = box[id];
    assert.strictEqual(line.minutes, 0, 'a player who never played must have 0 minutes: ' + id);
    assert.strictEqual(line.points, 0, 'a player who never played must have 0 points: ' + id);
    assert.strictEqual(line.fga, 0, 'a player who never played must have 0 attempts: ' + id);
  });
  console.log('checkBenchPlayersRecordNothing: OK');
}
checkBenchPlayersRecordNothing();

// Minutes are now measured, not distributed: five players on the floor for a
// 48-minute regulation game is 240 player-minutes, plus 25 per overtime.
function checkMinutesAreEmergent() {
  for (const seed of [43, 44, 45]) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    const box = sim.result().boxScore;
    let homeMin = 0, awayMin = 0;
    Object.keys(box).forEach(function (id) {
      if (box[id].teamId === 'BOS') homeMin += box[id].minutes;
      else awayMin += box[id].minutes;
    });
    // Five players for every minute of every period: 240 in regulation, plus
    // 25 for each overtime. Computed from the periods actually played rather
    // than hardcoded, so a seed that happens to go long doesn't fail this.
    const expected = 240 + Math.max(0, sim.period - 4) * 25;
    // +-4 absorbs per-player rounding to whole minutes across a full roster.
    assert.ok(Math.abs(homeMin - awayMin) <= 4, 'both teams play the same clock: ' + homeMin + ' vs ' + awayMin);
    assert.ok(Math.abs(homeMin - expected) <= 4,
      'home minutes should be ~' + expected + ' after ' + sim.period + ' periods, got ' + homeMin);
  }
  console.log('checkMinutesAreEmergent: OK');
}
checkMinutesAreEmergent();

// The clock must be a real clock: monotonic within a period, never negative,
// and resetting at each period boundary.
function checkClockIsMonotonic() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(51));
  let prevClock = Infinity;
  let prevPeriod = 1;
  while (!sim.done) {
    assert.ok(sim.clock >= 0, 'clock must never go negative, got ' + sim.clock);
    if (sim.period === prevPeriod) {
      assert.ok(sim.clock <= prevClock, 'clock must run down within a period: ' + prevClock + ' -> ' + sim.clock);
    } else {
      assert.ok(sim.period > prevPeriod, 'periods only advance');
      prevPeriod = sim.period;
    }
    prevClock = sim.clock;
    sim.step();
  }
  console.log('checkClockIsMonotonic: OK');
}
checkClockIsMonotonic();

// Pace must stay where it was, or every score in the league silently re-scales.
function checkPaceMatchesLegacy() {
  let total = 0;
  const seeds = [52, 53, 54, 55, 56];
  seeds.forEach(function (seed) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    total += sim.possessionsPlayed;
  });
  const avgPerTeam = total / seeds.length / 2;
  assert.ok(avgPerTeam >= 82 && avgPerTeam <= 98,
    'possessions per team should stay near the legacy 90, got ' + avgPerTeam.toFixed(1));
  console.log('checkPaceMatchesLegacy: OK (' + avgPerTeam.toFixed(1) + ' possessions/team)');
}
checkPaceMatchesLegacy();

// Scoring must land in the same range the possession suite already asserts.
function checkScoringStaysRealistic() {
  for (const seed of [57, 58, 59, 60]) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    const r = sim.result();
    assert.ok(r.homeScore >= 60 && r.homeScore <= 170, 'home score realistic, got ' + r.homeScore);
    assert.ok(r.awayScore >= 60 && r.awayScore <= 170, 'away score realistic, got ' + r.awayScore);
  }
  console.log('checkScoringStaysRealistic: OK');
}
checkScoringStaysRealistic();

// A tie at the end of regulation must be settled by playing basketball, not
// by awarding a phantom point to whoever made more field goals.
function checkNoFinishedGameIsTied() {
  for (let seed = 100; seed < 260; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 5) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, makeRng(seed));
    assert.notStrictEqual(r.homeScore, r.awayScore, 'a finished game is never tied (seed ' + seed + ')');
  }
  console.log('checkNoFinishedGameIsTied: OK');
}
checkNoFinishedGameIsTied();

// Overtime is rare (a couple of percent of games), so sampling random seeds
// and hoping one ties is a flaky way to test it. Force the tie instead: run
// regulation out, level the score, and assert the machine keeps playing.
function checkOvertimeIsPlayedWhenTied() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(101));
  // Run to the last possession of regulation.
  while (!sim.done && !(sim.period === 4 && sim.clock <= 20)) sim.step();
  assert.strictEqual(sim.done, false, 'should still be live at the end of regulation');

  // Level it, then take the possession that ends the period.
  sim.awayScore = sim.homeScore;
  sim.step();

  assert.ok(sim.period >= 5 || sim.homeScore !== sim.awayScore,
    'a tie at the buzzer must go to overtime rather than ending');
  if (sim.period >= 5) {
    assert.ok(sim.clock > 0 && sim.clock <= 5 * 60, 'an overtime period is five minutes, got ' + sim.clock);
    while (!sim.done) sim.step();
    const r = sim.result();
    assert.notStrictEqual(r.homeScore, r.awayScore, 'the overtime game still resolves');
    const otLines = r.playByPlay.filter(function (l) { return l.indexOf('--- OT') === 0; });
    assert.ok(otLines.length >= 1, 'an overtime game must log an OT period header');
    let homeMin = 0;
    Object.keys(r.boxScore).forEach(function (id) {
      if (r.boxScore[id].teamId === 'BOS') homeMin += r.boxScore[id].minutes;
    });
    assert.ok(homeMin > 243, 'an overtime game must exceed regulation minutes, got ' + homeMin);
  }
  console.log('checkOvertimeIsPlayedWhenTied: OK');
}
checkOvertimeIsPlayedWhenTied();

// The tiebreak hack must be gone entirely.
function checkNoTiebreakEvents() {
  for (let seed = 300; seed < 340; seed++) {
    const events = [];
    gameSim.simulateGame('BOS', 'LAL', makeRng(seed), { events: events });
    const tiebreaks = events.filter(function (e) { return e.type === 'tiebreak'; });
    assert.strictEqual(tiebreaks.length, 0, 'no tiebreak events should be emitted (seed ' + seed + ')');
  }
  console.log('checkNoTiebreakEvents: OK');
}
checkNoTiebreakEvents();

// A timeout must do something mechanical, or the agency built on it is hollow.
function checkTimeoutRestoresEnergyAndClearsRun() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(71));
  sim.onCourt.home.forEach(function (id) { sim.homeBox[id].energy = 0.5; });
  sim.run = { team: 'away', points: 10 };
  const before = sim.timeoutsLeft.home;

  const ok = sim.callTimeout('home');
  assert.strictEqual(ok, true, 'a timeout with one in hand must succeed');
  assert.strictEqual(sim.timeoutsLeft.home, before - 1, 'a timeout must be consumed');
  sim.onCourt.home.forEach(function (id) {
    assert.ok(Math.abs(sim.homeBox[id].energy - 0.62) < 1e-9,
      'on-court energy must rise by 0.12, got ' + sim.homeBox[id].energy);
  });
  assert.strictEqual(sim.run.points, 0, 'a timeout must clear the opponent run');
  console.log('checkTimeoutRestoresEnergyAndClearsRun: OK');
}
checkTimeoutRestoresEnergyAndClearsRun();

// Energy is a multiplier ceiling-ed at 1.0; a timeout must not exceed it.
function checkTimeoutEnergyIsCapped() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(72));
  sim.onCourt.home.forEach(function (id) { sim.homeBox[id].energy = 0.95; });
  sim.callTimeout('home');
  sim.onCourt.home.forEach(function (id) {
    assert.ok(sim.homeBox[id].energy <= 1.0, 'energy must never exceed 1.0');
  });
  console.log('checkTimeoutEnergyIsCapped: OK');
}
checkTimeoutEnergyIsCapped();

// Seven per game, and no more.
function checkTimeoutsAreFinite() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(73));
  assert.strictEqual(sim.timeoutsLeft.home, 7, 'teams start with 7 timeouts');
  for (let i = 0; i < 7; i++) {
    assert.strictEqual(sim.callTimeout('home'), true, 'timeout ' + (i + 1) + ' should succeed');
  }
  assert.strictEqual(sim.callTimeout('home'), false, 'the 8th timeout must be refused');
  assert.strictEqual(sim.timeoutsLeft.home, 0, 'timeouts cannot go negative');
  console.log('checkTimeoutsAreFinite: OK');
}
checkTimeoutsAreFinite();

// The run tracker is what nudges and coach timeout logic read.
function checkRunTracking() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(74));
  let sawRun = false;
  while (!sim.done) {
    sim.step();
    assert.ok(sim.run.points >= 0, 'run points are never negative');
    if (sim.run.points >= 6) sawRun = true;
    if (sim.run.team) assert.ok(sim.run.team === 'home' || sim.run.team === 'away', 'run team is a side');
  }
  assert.ok(sawRun, 'some team should go on a 6+ point run in a full game');
  console.log('checkRunTracking: OK');
}
checkRunTracking();

// The spec's core claim: agency is real, not cosmetic. Same seed, different
// decisions, different game. (Calling a timeout consumes no rng, so the
// random stream is identical — only the energy state the draws are applied
// against differs, which is exactly what makes this a fair comparison.)
function checkDecisionsChangeOutcomes() {
  let anyDiffered = false;
  for (const seed of [81, 82, 83, 84, 85, 86]) {
    const control = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!control.done) control.step();

    const withTimeouts = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    let n = 0;
    while (!withTimeouts.done) {
      if (n === 12 || n === 40) withTimeouts.callTimeout('home');
      withTimeouts.step();
      n += 1;
    }

    if (control.result().homeScore !== withTimeouts.result().homeScore ||
        control.result().awayScore !== withTimeouts.result().awayScore) {
      anyDiffered = true;
    }
  }
  assert.ok(anyDiffered,
    'calling timeouts must change at least one of six games, or agency is cosmetic');
  console.log('checkDecisionsChangeOutcomes: OK');
}
checkDecisionsChangeOutcomes();

// ...and the same decisions must still reproduce exactly, or nothing is
// debuggable.
function checkSameDecisionsReproduce() {
  function play(seed) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    let n = 0;
    while (!sim.done) {
      if (n === 12 || n === 40) sim.callTimeout('home');
      sim.step();
      n += 1;
    }
    return sim.result();
  }
  const a = play(91);
  const b = play(91);
  assert.strictEqual(a.homeScore, b.homeScore, 'same seed + same decisions must reproduce');
  assert.strictEqual(a.awayScore, b.awayScore, 'same seed + same decisions must reproduce');
  assert.strictEqual(boxChecksum(a.boxScore), boxChecksum(b.boxScore), 'box scores must reproduce');
  console.log('checkSameDecisionsReproduce: OK');
}
checkSameDecisionsReproduce();

// The league must run under the same rules the user watches, or the coach's
// decisions only exist in games that happen to be observed.
function checkPossessionIsDefaultEngine() {
  const simEngineModule = require(path.join(__dirname, '..', 'simEngine.js'));
  const defaulted = simEngineModule.getActiveEngine({});
  assert.strictEqual(defaulted, simEngineModule.SIM_ENGINES.possession,
    'an empty settings object must select the possession engine');
  const undefinedSettings = simEngineModule.getActiveEngine(undefined);
  assert.strictEqual(undefinedSettings, simEngineModule.SIM_ENGINES.possession,
    'undefined settings must select the possession engine');
  // boxscore stays available for anyone who selects it explicitly.
  const explicit = simEngineModule.getActiveEngine({ simEngine: 'boxscore' });
  assert.strictEqual(explicit, simEngineModule.SIM_ENGINES.boxscore,
    'boxscore must remain selectable');
  console.log('checkPossessionIsDefaultEngine: OK');
}
checkPossessionIsDefaultEngine();

console.log('All game sim validations passed');
