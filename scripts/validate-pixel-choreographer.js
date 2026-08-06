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
const league = require(path.join(__dirname, '..', 'league.js'));
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

function buildSession(seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed + 9) % TEAMS.length];
  const events = [];
  const result = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });
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
  let lastQuarter = 1, lastClock = 720;
  tl.keyframes.forEach(function (kf) {
    if (kf.quarter === lastQuarter) {
      assert.ok(kf.clock <= lastClock, 'clock must not run backward within a quarter');
    } else {
      assert.ok(kf.quarter > lastQuarter, 'quarter only advances');
    }
    lastQuarter = kf.quarter;
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

console.log('All pixel choreographer validations passed');
