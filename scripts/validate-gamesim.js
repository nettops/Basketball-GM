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

// Minutes are now measured, not distributed: five players on the floor for
// every minute of every period. Both the regulation figure and the overtime
// one are DERIVED from gameSim's own clock rather than written down, because
// the quarter is 9:30 now and was 12:00 when this was first written.
const ON_COURT = 5;
const REG_MINUTES = ON_COURT * gameSim.REGULATION_PERIODS * gameSim.PERIOD_SECONDS / 60;
const OT_MINUTES = ON_COURT * gameSim.OVERTIME_SECONDS / 60;
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
    // Computed from the periods actually played rather than hardcoded, so a
    // seed that happens to go long doesn't fail this.
    const expected = REG_MINUTES +
      Math.max(0, sim.period - gameSim.REGULATION_PERIODS) * OT_MINUTES;
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
  // Pace is a deliberate design lever, re-anchored twice now: 16s/90 guarded
  // the legacy count, 12.5s/115 chased a 130-140 point band, and 15.4s/94.7
  // holds the current one — 99-115 points at 47.5-49% FG. The window keeps the
  // SAME relative width it has always had (+/-9%), so each move re-anchors it
  // rather than loosening it.
  assert.ok(avgPerTeam >= 86 && avgPerTeam <= 103,
    'possessions per team should match the 15.4s possession clock, got ' + avgPerTeam.toFixed(1));
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

  // Level it and keep it level until the period actually ends.
  //
  // This used to level once and take a SINGLE step, which worked only because a
  // possession was 16 seconds long: from a clock of 20 or less, one step always
  // ran out regulation. At 12.5s a possession can be as short as 7.5s, so one
  // step left 9.5s on the clock and the game — correctly — kept playing, and
  // the assertion below fired at a machine that had done nothing wrong. The
  // test's assumption was the casualty of the pace change, not the behaviour it
  // is guarding, so the assertion is unchanged and only the setup is fixed.
  let guard = 0;
  while (sim.period === 4 && !sim.done && guard++ < 200) {
    sim.awayScore = sim.homeScore;   // still tied going into each possession
    sim.step();
  }
  assert.ok(guard < 200, 'regulation should have ended within the guard');

  assert.ok(sim.period >= 5 || sim.homeScore !== sim.awayScore,
    'a tie at the buzzer must go to overtime rather than ending');
  if (sim.period >= 5) {
    assert.ok(sim.clock > 0 && sim.clock <= 5 * 60, 'an overtime period is five minutes, got ' + sim.clock);
    while (!sim.done) sim.step();
    const r = sim.result();
    assert.notStrictEqual(r.homeScore, r.awayScore, 'the overtime game still resolves');
    // Period headers are pushed by gameSim.js as bare strings; plays produced by
    // a skillCheck are { text, check } (see simEnginePossession.js's logPlay).
    // Both shapes are permanent, so anything reading the log has to normalise —
    // this line used to call .indexOf straight on the entry and threw the moment
    // checks started riding along.
    const otLines = r.playByPlay.filter(function (l) {
      const text = typeof l === 'string' ? l : l.text;
      return text.indexOf('--- OT') === 0;
    });
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

// --- Task 1: queued user decisions ---------------------------------------

function checkDecisionsQueueUntilNextStep() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(41));
  sim.step();
  const before = sim.onCourt.home.slice();
  const benchId = sim.homeRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  const ok = sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: before[0], in: benchId }] });
  assert.strictEqual(ok, true, 'a valid decision is accepted');
  assert.deepStrictEqual(sim.onCourt.home, before, 'queued decisions do NOT apply immediately');
  sim.step();
  assert.ok(sim.onCourt.home.indexOf(benchId) !== -1, 'the substitute is on the floor after the next step');
  assert.ok(sim.onCourt.home.indexOf(before[0]) === -1, 'the replaced player came off');
  console.log('checkDecisionsQueueUntilNextStep: OK');
}
checkDecisionsQueueUntilNextStep();

function checkUserSubSurvivesTheCoach() {
  // The coach runs on every step. A user substitution must not be undone by
  // the coach in the SAME step that applied it.
  const sim = gameSim.createGameSim('DEN', 'MIA', makeRng(42));
  for (let i = 0; i < 60; i++) sim.step();
  const before = sim.onCourt.away.slice();
  const benchId = sim.awayRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  sim.applyDecision({ type: 'substitution', team: 'away', swaps: [{ out: before[0], in: benchId }] });
  sim.step();
  assert.ok(sim.onCourt.away.indexOf(benchId) !== -1, 'the coach did not reverse the user substitution');
  console.log('checkUserSubSurvivesTheCoach: OK');
}
checkUserSubSurvivesTheCoach();

function checkTimeoutDecision() {
  const sim = gameSim.createGameSim('OKC', 'NYK', makeRng(43));
  sim.step();
  const left = sim.timeoutsLeft.home;
  assert.strictEqual(sim.applyDecision({ type: 'timeout', team: 'home' }), true, 'a timeout is accepted');
  assert.strictEqual(sim.timeoutsLeft.home, left, 'not spent until the next step');
  sim.step();
  assert.strictEqual(sim.timeoutsLeft.home, left - 1, 'spent at the next possession boundary');
  console.log('checkTimeoutDecision: OK');
}
checkTimeoutDecision();

function checkInvalidDecisionsRejected() {
  const sim = gameSim.createGameSim('MIL', 'PHI', makeRng(44));
  sim.step();
  assert.strictEqual(sim.applyDecision(null), false, 'null is rejected');
  assert.strictEqual(sim.applyDecision({ type: 'nonsense', team: 'home' }), false, 'unknown type is rejected');
  assert.strictEqual(sim.applyDecision({ type: 'timeout', team: 'nobody' }), false, 'unknown team is rejected');

  // Timeouts exhausted: the spec says the control disables; the engine must
  // refuse regardless of what any caller believes.
  const drained = gameSim.createGameSim('GSW', 'DAL', makeRng(45));
  drained.step();
  for (let i = 0; i < 7; i++) { drained.applyDecision({ type: 'timeout', team: 'home' }); drained.step(); }
  assert.strictEqual(drained.timeoutsLeft.home, 0, 'all seven spent');
  assert.strictEqual(drained.applyDecision({ type: 'timeout', team: 'home' }), false, 'an eighth is rejected');
  console.log('checkInvalidDecisionsRejected: OK');
}
checkInvalidDecisionsRejected();

function checkDecisionsAfterGameOverIgnored() {
  const sim = gameSim.createGameSim('CLE', 'MEM', makeRng(46));
  while (!sim.done) sim.step();
  const before = sim.onCourt.home.slice();
  const benchId = sim.homeRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  assert.strictEqual(sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: before[0], in: benchId }] }), false,
    'decisions after the final buzzer are refused');
  sim.step();
  assert.deepStrictEqual(sim.onCourt.home, before, 'and change nothing');
  console.log('checkDecisionsAfterGameOverIgnored: OK');
}
checkDecisionsAfterGameOverIgnored();

function checkUserTeamKeepsItsTimeoutDecision() {
  // Without this, the coach spends the watched team's timeout at the very
  // boundary the run becomes qualifying — before any view could render a
  // frame — and clears sim.run, so the human is never actually offered the
  // decision the whole nudge system exists to offer.
  // This test needs a PRECONDITION to hold — an 8-point run against the home
  // team while it still has timeouts, and an away coach who spends one — and a
  // hard-coded seed keeps failing to provide it. 77 stopped working when the
  // shot balance changed, then 72 stopped working when the possession clock
  // moved to 15.4s. Both times nothing about timeout handling had regressed:
  // the fixture simply stopped setting up the situation it asserts on, and both
  // times the fix was to go seed-hunting by hand.
  //
  // So it hunts for itself now. The scan is deterministic (first qualifying
  // seed from 1 upward, which is 2 at the time of writing) and it does NOT
  // weaken anything — the preconditions it scans for are the same conditions
  // the assertions below need, and if no seed in the range can produce them,
  // that is a real regression and the assert says so rather than a later
  // assertion failing for a misleading reason.
  function runOut(seed, userTeam) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    sim.userTeam = userTeam;
    let sawQualifyingRunAgainstHome = false;
    while (!sim.done) {
      if (sim.run.team === 'away' && sim.run.points >= 8 && sim.timeoutsLeft.home > 0) {
        sawQualifyingRunAgainstHome = true;
      }
      sim.step();
    }
    return { sim: sim, sawRun: sawQualifyingRunAgainstHome };
  }

  let SEED = 0;
  for (let s = 1; s <= 40 && !SEED; s++) {
    const u = runOut(s, null), w = runOut(s, 'home');
    if (u.sim.timeoutsLeft.home < 7 && w.sim.timeoutsLeft.home === 7 &&
        w.sim.timeoutsLeft.away < 7 && w.sawRun) SEED = s;
  }
  assert.ok(SEED, 'no seed in 1-40 produces an 8-point run against a team that ' +
    'still has timeouts — the timeout/run machinery itself has regressed');

  const unwatched = runOut(SEED, null);
  assert.ok(unwatched.sim.timeoutsLeft.home < 7,
    'with no user team, the coach spends home timeouts as before');

  const watched = runOut(SEED, 'home');
  assert.strictEqual(watched.sim.timeoutsLeft.home, 7,
    'a watched team\'s timeouts are left entirely to its view');
  assert.ok(watched.sim.timeoutsLeft.away < 7,
    'the OTHER team\'s coach is unaffected');
  assert.ok(watched.sawRun,
    'a qualifying run against the watched team actually survives to be seen');

  // The view still gets to spend them through the normal decision path.
  const decided = gameSim.createGameSim('BOS', 'LAL', makeRng(78));
  decided.userTeam = 'home';
  decided.step();
  decided.applyDecision({ type: 'timeout', team: 'home' });
  decided.step();
  assert.strictEqual(decided.timeoutsLeft.home, 6, 'the view can still call one');

  console.log('checkUserTeamKeepsItsTimeoutDecision: OK');
}
checkUserTeamKeepsItsTimeoutDecision();

function checkPeriodScoresAreRecorded() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(12345));
  while (!sim.done) sim.step();

  assert.ok(Array.isArray(sim.periodScores), 'periodScores is an array');
  assert.ok(sim.periodScores.length >= 4, 'at least four periods ended, got ' + sim.periodScores.length);

  sim.periodScores.forEach(function (row, i) {
    assert.strictEqual(row.period, i + 1, 'periods are recorded in order');
    assert.ok(Number.isFinite(row.home) && Number.isFinite(row.away), 'scores are numbers');
    if (i > 0) {
      assert.ok(row.home >= sim.periodScores[i - 1].home, 'home score never decreases');
      assert.ok(row.away >= sim.periodScores[i - 1].away, 'away score never decreases');
    }
  });

  const last = sim.periodScores[sim.periodScores.length - 1];
  assert.strictEqual(last.home, sim.homeScore, 'final period row matches the final home score');
  assert.strictEqual(last.away, sim.awayScore, 'final period row matches the final away score');
  console.log('checkPeriodScoresAreRecorded: OK');
}
checkPeriodScoresAreRecorded();

// An offensive rebound has to actually mean something.
//
// It did not, for a long time: the engine produced a realistic ten offensive
// rebounds a team a night, credited them to the box score, and then gameSim's
// loop handed the ball to the defence anyway because it flipped sides
// unconditionally. Measured over 60 games, the whole league scored ONE
// second-chance point per team-game against a real-world 13.
//
// So this asserts the consequence, not the flag: after an offensive rebound,
// the next thing that happens in the event stream is the same team playing on.
function checkAnOffensiveReboundKeepsTheBall() {
  let boards = 0, kept = 0, secondChancePoints = 0;

  for (let g = 0; g < 6; g++) {
    const events = [];
    gameSim.simulateGame(TEAMS[g].id, TEAMS[(g + 5) % TEAMS.length].id, makeRng(4400 + g),
      { settings: { simEngine: 'possession' }, events: events });

    // Two windows, because they close at different moments. `handoff` asks
    // who plays the NEXT possession and is answered the instant one starts;
    // `chance` stays open until the ball actually changes hands, so a board
    // rebounded, missed and rebounded again still scores as one second chance.
    let handoff = null, chance = null;
    events.forEach(function (ev) {
      if (ev.type === 'possession' && handoff !== null) {
        boards += 1;
        if (ev.team === handoff) kept += 1;
        handoff = null;
      } else if (ev.type === 'shot') {
        if (ev.made) {
          if (chance === ev.team) secondChancePoints += ev.points;
          chance = null;
        }
      } else if (ev.type === 'foul-ft') {
        // A shooting foul on the same miss sends the offence to the line,
        // which IS that trip's reward — so the board is dropped from the
        // handoff count rather than scored as a failure to keep the ball.
        if (chance === ev.team) secondChancePoints += ev.points;
        handoff = null;
        chance = null;
      } else if (ev.type === 'turnover') {
        chance = null;
      } else if (ev.type === 'rebound') {
        handoff = ev.offensive ? ev.team : null;
        chance = ev.offensive ? ev.team : null;
      }
    });
  }

  assert.ok(boards > 60, 'only ' + boards + ' offensive rebounds in six games — too few to judge');
  // Not 100%: a board on the last shot of a period has no next possession to
  // hand it to. Trips to the line are excluded above rather than counted as
  // failures.
  assert.ok(kept / boards > 0.9,
    'only ' + (100 * kept / boards).toFixed(0) + '% of offensive rebounds kept the ball — ' +
    'the possession loop is flipping sides through them');
  assert.ok(secondChancePoints > 0,
    'six games produced no second-chance points at all');
  console.log('checkAnOffensiveReboundKeepsTheBall: OK (' + boards + ' boards, ' +
    (100 * kept / boards).toFixed(0) + '% kept, ' + secondChancePoints + ' second-chance pts)');
}
checkAnOffensiveReboundKeepsTheBall();

console.log('All game sim validations passed');
