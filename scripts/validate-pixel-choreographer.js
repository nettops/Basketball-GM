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
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

function buildSession(seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed + 9) % TEAMS.length];
  const events = [];
  const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
  return {
    session: {
      events: events,
      homeRoster: league.getTeamRoster(home.id),
      awayRoster: league.getTeamRoster(away.id),
      boxScore: result.boxScore
    },
    result: result
  };
}

function checkTimelineShape() {
  const built = buildSession(3);
  const tl = choreo.buildTimeline(built.session);
  assert.ok(tl.keyframes.length > 100, 'a full game should produce many keyframes');
  assert.ok(tl.durationMs > 60000, 'a full game at 1x should exceed a minute');
  let lastT = -1;
  tl.keyframes.forEach(function (kf) {
    assert.ok(kf.t > lastT, 'keyframe t must be strictly increasing');
    lastT = kf.t;
    assert.ok(Array.isArray(kf.score) && kf.score.length === 2, 'score is [home, away]');
    assert.ok(kf.quarter >= 1 && kf.quarter <= 4, 'quarter in range');
    assert.ok(kf.clock >= 0 && kf.clock <= 720, 'clock within a 12-minute quarter');
  });
  assert.strictEqual(tl.keyframes[tl.keyframes.length - 1].t, tl.durationMs, 'duration matches last keyframe');
  console.log('checkTimelineShape: OK');
}
checkTimelineShape();

function checkPositionsInBounds() {
  const built = buildSession(7);
  const tl = choreo.buildTimeline(built.session);
  const c = choreo.PIXEL_STAGE.court;
  tl.keyframes.forEach(function (kf) {
    Object.keys(kf.pos).forEach(function (pid) {
      const p = kf.pos[pid];
      assert.ok(p[0] >= c.x && p[0] <= c.x + c.w, 'x in court bounds: ' + p[0]);
      assert.ok(p[1] >= c.y && p[1] <= c.y + c.h, 'y in court bounds: ' + p[1]);
    });
    assert.strictEqual(Object.keys(kf.pos).length, 10, 'exactly 10 players on court');
  });
  console.log('checkPositionsInBounds: OK');
}
checkPositionsInBounds();

function checkBallCustodyAndScore() {
  const built = buildSession(12);
  const tl = choreo.buildTimeline(built.session);
  const onCourtIds = {};
  built.session.homeRoster.concat(built.session.awayRoster).forEach(function (p) { onCourtIds[p.id] = true; });
  let lastScore = [0, 0];
  tl.keyframes.forEach(function (kf) {
    if (kf.ball.holder !== null) {
      assert.ok(onCourtIds[kf.ball.holder], 'ball holder must be a rostered player');
      assert.ok(kf.pos[kf.ball.holder], 'ball holder must be on court in this keyframe');
    }
    assert.ok(kf.score[0] >= lastScore[0] && kf.score[1] >= lastScore[1], 'score never decreases');
    lastScore = kf.score;
  });
  const last = tl.keyframes[tl.keyframes.length - 1];
  assert.strictEqual(last.score[0], built.result.homeScore, 'final home score matches sim');
  assert.strictEqual(last.score[1], built.result.awayScore, 'final away score matches sim');
  console.log('checkBallCustodyAndScore: OK');
}
checkBallCustodyAndScore();

function checkClockNeverRunsBackward() {
  const built = buildSession(21);
  const tl = choreo.buildTimeline(built.session);
  // Keyed on PERIOD, not quarter. gameSim sets quarter = min(period, 4), so
  // in overtime the quarter stays 4 while the clock resets to 300 — against
  // `quarter` that reads as the clock running backward. This check keyed on
  // quarter from the day it was written and only ever passed because seed 21
  // finished in regulation; the first change that pushed it to OT failed it.
  let lastPeriod = 1, lastClock = 720;
  tl.keyframes.forEach(function (kf) {
    if (kf.period === lastPeriod) {
      assert.ok(kf.clock <= lastClock, 'clock must not run backward within a period');
    } else {
      assert.ok(kf.period > lastPeriod, 'period only advances');
    }
    lastPeriod = kf.period;
    lastClock = kf.clock;
  });
  console.log('checkClockNeverRunsBackward: OK');
}
checkClockNeverRunsBackward();

function checkPlayerSeparation() {
  // Collision pass invariant: no two sprites ever stack. 8px (not the full
  // 11px separation target) because clampToCourt can pinch pairs at the
  // court edges after separation runs.
  const built = buildSession(12);
  const tl = choreo.buildTimeline(built.session);
  tl.keyframes.forEach(function (kf) {
    const ids = Object.keys(kf.pos);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = kf.pos[ids[i]];
        const b = kf.pos[ids[j]];
        const d = Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
        assert.ok(d >= 8, 'players must not stack: ' + ids[i] + ' and ' + ids[j] + ' at distance ' + d.toFixed(1));
      }
    }
  });
  console.log('checkPlayerSeparation: OK');
}
checkPlayerSeparation();

function checkStatsAndLineScore() {
  const built = buildSession(9);
  const tl = choreo.buildTimeline(built.session);

  // Running leaders must agree with the engine's own box score at the end.
  const finalSnap = tl.snapshots[tl.keyframes[tl.keyframes.length - 1].snap];
  const enginePts = built.result.boxScore;
  finalSnap.leaders.forEach(function (l) {
    assert.ok(enginePts[l.id], 'leader ' + l.id + ' should be in the box score');
    assert.strictEqual(l.pts, enginePts[l.id].points,
      'leader points must match the engine box score for ' + l.id);
  });
  for (let i = 1; i < finalSnap.leaders.length; i++) {
    assert.ok(finalSnap.leaders[i - 1].pts >= finalSnap.leaders[i].pts, 'leaders are sorted');
  }

  // Line score must add up to the final score, quarter by quarter.
  const sumHome = tl.lineScore.reduce(function (s, r) { return s + r.home; }, 0);
  const sumAway = tl.lineScore.reduce(function (s, r) { return s + r.away; }, 0);
  assert.strictEqual(sumHome, built.result.homeScore, 'line score sums to the home final');
  assert.strictEqual(sumAway, built.result.awayScore, 'line score sums to the away final');
  tl.lineScore.forEach(function (r) {
    assert.ok(r.home >= 0 && r.away >= 0, 'no negative quarter scores');
  });

  // Shot clock stays in a legal range and resets between possessions.
  let sawReset = false;
  tl.keyframes.forEach(function (kf, i) {
    assert.ok(kf.shotClock >= 0 && kf.shotClock <= 24, 'shot clock within 0-24: ' + kf.shotClock);
    if (i > 0 && kf.shotClock > tl.keyframes[i - 1].shotClock) sawReset = true;
  });
  assert.ok(sawReset, 'the shot clock must reset on a new possession');
  console.log('checkStatsAndLineScore: OK');
}
checkStatsAndLineScore();

// --- Task 3: incremental choreography ------------------------------------

function possessionSlices(events) {
  const slices = [];
  events.forEach(function (ev) {
    if (ev.type === 'possession') slices.push([ev]);
    else if (slices.length) slices[slices.length - 1].push(ev);
  });
  return slices;
}

function checkIncrementalEqualsBatch() {
  const built = buildSession(11);
  const batch = choreo.buildTimeline(built.session);

  const live = choreo.createChoreographer({
    homeRoster: built.session.homeRoster,
    awayRoster: built.session.awayRoster
  });
  possessionSlices(built.session.events).forEach(function (slice) { live.appendEvents(slice); });
  live.finish();

  assert.deepStrictEqual(live.timeline.keyframes, batch.keyframes, 'incremental keyframes match batch exactly');
  assert.strictEqual(live.timeline.durationMs, batch.durationMs, 'durations match');
  assert.deepStrictEqual(live.timeline.lineScore, batch.lineScore, 'line scores match');
  assert.deepStrictEqual(live.timeline.snapshots, batch.snapshots, 'snapshots match');
  assert.deepStrictEqual(live.timeline.finalStats, batch.finalStats, 'final stats match');
  console.log('checkIncrementalEqualsBatch: OK');
}
checkIncrementalEqualsBatch();

function checkTimelineGrowsAsAppended() {
  const built = buildSession(12);
  const live = choreo.createChoreographer({
    homeRoster: built.session.homeRoster,
    awayRoster: built.session.awayRoster
  });
  const slices = possessionSlices(built.session.events);
  let lastDuration = 0;
  let lastCount = 0;
  slices.slice(0, 10).forEach(function (slice) {
    live.appendEvents(slice);
    assert.ok(live.timeline.keyframes.length > lastCount, 'each possession adds keyframes');
    assert.ok(live.timeline.durationMs > lastDuration, 'duration grows monotonically');
    assert.strictEqual(live.timeline.durationMs, live.timeline.keyframes[live.timeline.keyframes.length - 1].t,
      'durationMs always equals the last keyframe time');
    lastCount = live.timeline.keyframes.length;
    lastDuration = live.timeline.durationMs;
  });
  console.log('checkTimelineGrowsAsAppended: OK');
}
checkTimelineGrowsAsAppended();

function checkClockComesFromTheEngine() {
  const built = buildSession(13);
  const tl = choreo.buildTimeline(built.session);
  const byPossession = {};
  built.session.events.filter(function (ev) { return ev.type === 'possession'; })
    .forEach(function (ev, i) { byPossession[i] = ev; });

  tl.keyframes.forEach(function (kf) {
    const src = byPossession[kf.possIdx];
    assert.ok(src, 'every keyframe maps to a possession');
    assert.strictEqual(kf.clock, src.clock, 'keyframe clock is the engine clock for its possession');
    assert.strictEqual(kf.period, src.period, 'keyframe period is the engine period');
  });
  console.log('checkClockComesFromTheEngine: OK');
}
checkClockComesFromTheEngine();

function checkOvertimeIsRepresented() {
  // Force a tie at the buzzer, then confirm the extra period reaches the
  // keyframes as period 5 rather than being flattened into Q4.
  const events = [];
  const sim = gameSim.createGameSim('SAS', 'HOU', makeRng(31), { events: events });
  while (!sim.done) {
    sim.step();
    if (sim.period === 4 && sim.clock <= 60 && sim.homeScore !== sim.awayScore) {
      // nudge the score to a tie so regulation ends level
      if (sim.homeScore > sim.awayScore) sim.awayScore = sim.homeScore;
      else sim.homeScore = sim.awayScore;
    }
  }
  assert.ok(sim.period > 4, 'the game reached overtime');

  const tl = choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster('SAS'),
    awayRoster: league.getTeamRoster('HOU')
  });
  assert.ok(tl.keyframes.some(function (kf) { return kf.period > 4; }), 'overtime keyframes carry period > 4');
  assert.ok(tl.keyframes.every(function (kf) { return kf.quarter >= 1 && kf.quarter <= 4; }), 'quarter still clamps to 1-4');
  console.log('checkOvertimeIsRepresented: OK');
}
checkOvertimeIsRepresented();

function checkLineupsDriveTheFloor() {
  const built = buildSession(14);
  const tl = choreo.buildTimeline(built.session);
  tl.keyframes.forEach(function (kf) {
    assert.strictEqual(Object.keys(kf.pos).length, 10, 'exactly ten sprites on the floor every keyframe');
  });
  console.log('checkLineupsDriveTheFloor: OK');
}
checkLineupsDriveTheFloor();

function checkFloorIsNotFrozen() {
  // The floor used to be a diorama: 63.7% of all player-beats held an
  // IDENTICAL position across a keyframe pair, with beats averaging 330ms.
  // Two thirds of that sat in three long beats — the ball swing (78% frozen),
  // the windup (98%) and the rebound bounce (100%).
  const tl = choreo.buildTimeline(buildSession(4242).session);
  const kfs = tl.keyframes;
  let still = 0, total = 0, offCourt = 0;
  const crt = { x: 20, y: 64, w: 440, h: 192 };
  for (let i = 0; i < kfs.length - 1; i++) {
    Object.keys(kfs[i].pos).forEach(function (id) {
      if (!kfs[i + 1].pos[id]) return;
      total += 1;
      const a = kfs[i].pos[id], b = kfs[i + 1].pos[id];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) still += 1;
    });
  }
  kfs.forEach(function (k) {
    Object.keys(k.pos).forEach(function (id) {
      const p = k.pos[id];
      if (p[0] < crt.x || p[0] > crt.x + crt.w || p[1] < crt.y || p[1] > crt.y + crt.h) offCourt += 1;
    });
  });
  const frozen = still / total;
  assert.ok(frozen < 0.30,
    'too much of the floor is frozen: ' + (frozen * 100).toFixed(1) + '% of player-beats (was 63.7%, budget 30%)');
  assert.strictEqual(offCourt, 0, 'off-ball flow pushed ' + offCourt + ' player-positions off the court');

  // The ball handler is never flowed — he is where the choreography put him.
  let handlerMoved = 0;
  kfs.forEach(function (k) {
    if (!k.ball.holder || !k.pos[k.ball.holder]) return;
    const h = k.pos[k.ball.holder];
    if (Math.hypot(h[0] - k.ball.x, h[1] - k.ball.y) > 40) handlerMoved += 1;
  });
  assert.ok(handlerMoved < kfs.length * 0.10,
    'the ball drifted away from its holder on ' + handlerMoved + ' keyframes');
  console.log('checkFloorIsNotFrozen: OK (' + (frozen * 100).toFixed(1) + '% frozen)');
}
checkFloorIsNotFrozen();

console.log('All pixel choreographer validations passed');
