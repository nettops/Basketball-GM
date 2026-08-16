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

// Takeovers are STATE, not beats — they carry no positions, so the
// choreographer consumes them into running state rather than choreographing
// them as plays. This asserts the state actually reaches the keyframes, which
// is the only way the view can draw either the banner or the marker.
function checkTakeoversReachTheKeyframes() {
  let starts = 0, stamped = 0, markerFrames = 0, seen = 0;
  for (let seed = 40; seed < 52; seed++) {
    const built = buildSession(seed);
    starts += built.session.events.filter(function (e) { return e.type === 'takeover-start'; }).length;
    const tl = choreo.buildTimeline(built.session);
    tl.keyframes.forEach(function (kf) {
      seen += 1;
      if (kf.takeoverStart) {
        stamped += 1;
        assert.ok(kf.takeoverStart.playerId, 'a takeoverStart keyframe must name the player');
        assert.ok(kf.takeoverStart.ultimateName, 'and the ultimate, for the banner');
      }
      assert.ok(kf.takeovers, 'every keyframe must carry the takeover state, even when empty');
      if (kf.takeovers.home || kf.takeovers.away) markerFrames += 1;
    });
  }
  assert.ok(starts > 0, 'no takeover fired across twelve games — nothing to choreograph');
  assert.strictEqual(stamped, starts,
    'every takeover-start must be stamped on exactly one keyframe (' + stamped + ' of ' + starts + ')');
  assert.ok(markerFrames > 0, 'no keyframe carries a live holder — the on-court marker would never draw');
  // A takeover runs ~20 possessions, so it must mark a real stretch of the
  // game, not one frame. Guards against the state being cleared immediately.
  assert.ok(markerFrames > stamped * 5,
    'holders appear on only ' + markerFrames + ' keyframes for ' + stamped +
    ' takeovers — the marker is not persisting across the stretch');
  console.log('checkTakeoversReachTheKeyframes: OK (' + starts + ' takeovers, ' +
    markerFrames + ' marked keyframes of ' + seen + ')');
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
  //
  // The nudge RACES the final possession: the last step of Q4 both scores and
  // ends the period, so a game whose closing basket lands after the last nudge
  // finishes regulation untied and never reaches overtime. That made this a
  // one-seed fixture — it passed on seed 31 by arithmetic accident, and the
  // first change to the ratings broke it. Searching seeds instead tests the
  // invariant we actually care about (an extra period carries period > 4)
  // without depending on any single game's closing sequence.
  let events = null, sim = null;
  for (let seed = 31; seed < 131 && (!sim || sim.period <= 4); seed++) {
    events = [];
    sim = gameSim.createGameSim('SAS', 'HOU', makeRng(seed), { events: events });
    while (!sim.done) {
      sim.step();
      if (sim.period === 4 && sim.clock <= 60 && sim.homeScore !== sim.awayScore) {
        // nudge the score to a tie so regulation ends level
        if (sim.homeScore > sim.awayScore) sim.awayScore = sim.homeScore;
        else sim.homeScore = sim.awayScore;
      }
    }
  }
  assert.ok(sim.period > 4, 'no seed in 31-130 reached overtime; the fixture can no longer force one');

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

function checkThePasserFindsTheOpenMan() {
  // Measured as SELECTION EDGE: how much more open the receiver is than the
  // average teammate at the moment he catches it. That isolates the passer's
  // choice from how hard the defence happens to be playing.
  //
  // A raw "passes into coverage" count is the wrong measure and was actively
  // misleading here — it counts receivers with a defender nearby, so it
  // improves when the defence stops closing. Switching the defence off scored
  // BETTER on it while making both the basketball and the selection worse.
  //
  // Before the read, the edge was -3.6px: the modular pass target was
  // systematically picking the LESS open teammate, worse than choosing at
  // random. It is now positive.
  const homeIdSets = [];
  let edges = [];
  // Twelve games, not two: at two this check measured whichever fives happened
  // to be on the floor, which is how it stayed green through a real regression
  // and then flipped on an unrelated fix.
  for (let g = 0; g < 12; g++) {
    const seed = 4242 + g;
    const home = TEAMS[seed % TEAMS.length], away = TEAMS[(seed + 9) % TEAMS.length];
    const events = [];
    const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
    const hr = league.getTeamRoster(home.id), ar = league.getTeamRoster(away.id);
    const homeIds = {};
    hr.forEach(function (p) { homeIds[p.id] = true; });
    homeIdSets.push(homeIds);
    const kfs = choreo.buildTimeline({
      events: events, homeRoster: hr, awayRoster: ar, boxScore: result.boxScore
    }).keyframes;
    function openness(kf, id) {
      const me = kf.pos[id];
      if (!me) return null;
      const mine = !!homeIds[id];
      let best = Infinity;
      Object.keys(kf.pos).forEach(function (o) {
        if (!!homeIds[o] === mine) return;
        const q = kf.pos[o];
        const d = Math.hypot(q[0] - me[0], q[1] - me[1]);
        if (d < best) best = d;
      });
      return best === Infinity ? null : best;
    }
    let lastHolder = null;
    for (let i = 1; i < kfs.length; i++) {
      const a = kfs[i - 1], b = kfs[i];
      if (a.ball.holder !== null) lastHolder = a.ball.holder;
      if (!(a.ball.holder === null && b.ball.holder && typeof b.ball.arc === 'number')) continue;
      // Measured on the RELEASE keyframe (a), not the catch keyframe (b).
      //
      // At the catch, flowPositions has locked the passer and the receiver in
      // place while every other offensive player flows toward open space — so
      // the receiver is standing still surrounded by teammates actively getting
      // open, and scores worse than them however well he was chosen. That is an
      // artifact of the locking, not a property of the pass: measured over the
      // same passes, the chosen receiver is +19.2px more open than the average
      // candidate at the moment of the DECISION and -0.4px at the catch, and
      // the two are essentially uncorrelated.
      //
      // The release keyframe has everyone on the same footing, which is where
      // the passer's choice is actually visible. Rewriting this exposed that
      // the old form only passed on a two-game fixture by luck — at twelve
      // games it read -0.41px both before and after the minutes-weight fix.
      const rid = b.ball.holder, mine = !!homeIds[rid];
      const ro = openness(a, rid);
      if (ro === null) continue;
      // The passer is excluded from the baseline: he was never a candidate to
      // receive his own pass, and leaving him in compares the choice against an
      // option that did not exist.
      const mateVals = Object.keys(a.pos)
        .filter(function (id) {
          return !!homeIds[id] === mine && id !== rid && id !== lastHolder;
        })
        .map(function (id) { return openness(a, id); })
        .filter(function (v) { return v !== null; });
      if (!mateVals.length) continue;
      edges.push(ro - mateVals.reduce(function (s, v) { return s + v; }, 0) / mateVals.length);
    }
  }
  assert.ok(edges.length > 200, 'expected a decent sample of passes, got ' + edges.length);
  const mean = edges.reduce(function (s, v) { return s + v; }, 0) / edges.length;
  assert.ok(mean > 0,
    'the passer must favour the OPEN man: selection edge ' + mean.toFixed(2) + 'px (was -3.6 before the read)');
  console.log('checkThePasserFindsTheOpenMan: OK (selection edge +' + mean.toFixed(1) + 'px over ' + edges.length + ' passes)');
}
checkThePasserFindsTheOpenMan();

// The impact panel is the ONLY place a skill check surfaces during live play,
// so the marker has to carry it. A marker without a check renders a caption and
// nothing else — the feature silently degrading back to what it replaced.
//
// Sweeps seeds because impact moments are rare by design (validate-impactMoments
// gates them to 2-7 a game), so a single seed is not guaranteed to produce one.
function checkImpactMarkerCarriesTheCheck() {
  const markers = [];
  for (let seed = 1; seed <= 12; seed++) {
    const built = buildSession(seed);
    const tl = choreo.buildTimeline(built.session);
    tl.keyframes.forEach(function (kf) { if (kf.impact) markers.push(kf.impact); });
  }
  assert.ok(markers.length > 0, 'no impact markers produced across 12 seeds');
  const withCheck = markers.filter(function (m) { return m.check && m.check.kind; });
  assert.strictEqual(withCheck.length, markers.length,
    'only ' + withCheck.length + ' of ' + markers.length + ' impact markers carry their check');
  // Every marker kind must resolve to a contest the HUD can actually render.
  withCheck.forEach(function (m) {
    assert.ok(m.check.kind === 'shot' || m.check.kind === 'block',
      'unexpected check kind on an impact marker: ' + m.check.kind);
    assert.ok(typeof m.check.probability === 'number' && typeof m.check.roll === 'number',
      'an impact check must carry the numbers the breakdown prints');
  });
  console.log('checkImpactMarkerCarriesTheCheck: OK (' + markers.length + ' markers across 12 seeds)');
}
checkImpactMarkerCarriesTheCheck();

function checkEveryBeatOfAStringSaysWhichMoveItIs() {
  // `handle` marks a string ONCE, which is what the count probe wants. The ball
  // needs the answer on every frame instead: it is being drawn between two
  // keyframes and has to know which move it is in the middle of and how far
  // through. Without a per-beat marker the ball can only run its own metronome
  // — which is exactly what it did, so a crossover, a behind-the-back and a
  // double move all drew an identical 6.0px-wide dribble.
  const tl = choreo.buildTimeline(buildSession(31).session);
  const kfs = tl.keyframes;
  let strings = 0;
  kfs.forEach(function (kf, i) {
    if (!kf.handle) return;
    strings += 1;
    assert.ok(kfs[i].drib, 'a ' + kf.handle.move + ' string opens with no move marker');
    // The BEAT count, off the marker. Deliberately not `handle.n`, which is the
    // number of dribbles he put on the floor: an ankle breaker counts four of
    // those but choreographs three beats, the fourth being the gather he rises
    // out of. Reading the dribble count as a beat count walks the crossover
    // onto a beat that does not exist.
    const n = kfs[i].drib.n;
    for (let d = 0; d < n && i + d < kfs.length; d++) {
      const drib = kfs[i + d].drib;
      assert.ok(drib, 'beat ' + d + ' of a ' + kf.handle.move + ' string carries no move marker');
      assert.strictEqual(drib.move, kf.handle.move,
        'beat ' + d + ' says "' + drib.move + '" where the string says "' + kf.handle.move + '"');
      assert.strictEqual(drib.n, n, 'beat ' + d + ' disagrees about the string length');
      assert.strictEqual(drib.i, d, 'beat ' + d + ' is indexed ' + drib.i + ' — the ball reads ' +
        'this as how far through the move it is, so an index that skips lands the crossover ' +
        'on the wrong beat');
    }
    // And the beat after the string must NOT still claim to be in it, or the
    // ball keeps running a move that finished.
    const after = kfs[i + n];
    if (after && after.drib) {
      assert.strictEqual(after.drib.i, 0,
        'the beat after a ' + kf.handle.move + ' string is still marked as beat ' +
        after.drib.i + ' of one');
    }
  });
  assert.ok(strings > 5, 'expected several dribble strings in the fixture, got ' + strings);

  // And the marker must name a move ui/pixelMotion.js knows how to draw. A
  // typo here would fall through to the default crossover silently.
  const motion = require(path.join(__dirname, '..', 'ui', 'pixelMotion.js'));
  // `drive` is the one that is not a MOVE: it is a man carrying the ball to the
  // rim, and it exists so the beat that was already taking him there stops
  // being a slide. dribbleCrossings answers [] for it, deliberately — a
  // crossing in front of a finish would be a move he is not making.
  const known = { putdown: 1, cross: 1, behind: 1, double: 1, ankle: 1,
    stepback: 1, legs: 1, drive: 1 };
  kfs.forEach(function (kf) {
    if (!kf.drib) return;
    assert.ok(known[kf.drib.move], 'unknown move "' + kf.drib.move + '"');
    const crossings = motion.dribbleCrossings(kf.drib.move, kf.drib.n);
    crossings.forEach(function (c) {
      assert.ok(c.at > 0 && c.at < kf.drib.n,
        kf.drib.move + ' with ' + kf.drib.n + ' beats puts a crossing at beat ' + c.at +
        ', outside the string — it would be blended away to nothing');
    });
  });
  console.log('checkEveryBeatOfAStringSaysWhichMoveItIs: OK (' + strings + ' strings)');
}
checkEveryBeatOfAStringSaysWhichMoveItIs();

function checkDribbleRoll() {
  // roll01 must be equidistributed. Everything else in the choreographer picks
  // with modular arithmetic -- `(pi * 7 + ei) % 5` -- which is fine for a coin
  // flip but cannot express 50/25/15/10, and a modulus that happens to land on
  // the right shares for one seed sequence silently correlates with every other
  // modulus in the file.
  const decile = new Array(10).fill(0);
  for (let s = 0; s < 20000; s++) {
    const r = choreo.roll01(s);
    assert.ok(r >= 0 && r < 1, 'roll01 stays in [0,1)');
    decile[Math.floor(r * 10)] += 1;
  }
  decile.forEach(function (n, i) {
    assert.ok(n > 1700 && n < 2300, 'decile ' + i + ' near even, got ' + n);
  });
  // Even deciles are NOT enough, which mutation testing proved: replacing the
  // hash with `((seed * 7) % 100) / 100` is perfectly equidistributed and the
  // decile check above passes it. The real hazard with modular arithmetic is
  // LOCKSTEP -- consecutive seeds move by a fixed step, so consecutive
  // possessions get related rolls and a player's dribble counts march in a
  // pattern instead of varying. The real seed is `pi * 101 + ei`, so adjacent
  // possessions are exactly the adjacent seeds this measures.
  const deltas = {};
  for (let s = 0; s < 2000; s++) {
    deltas[(choreo.roll01(s + 1) - choreo.roll01(s)).toFixed(4)] = true;
  }
  const distinct = Object.keys(deltas).length;
  assert.ok(distinct > 1500, 'consecutive rolls must not move in lockstep, got ' +
    distinct + ' distinct steps in 2000');

  // League-wide shape at the mean skill.
  const seen = { '0': 0, '2': 0, '4-6': 0, '7+': 0 };
  for (let s = 0; s < 20000; s++) {
    const n = choreo.dribbleCount(s, 50);
    assert.ok(n >= 0 && n <= 8 && n !== 1 && n !== 3, 'count is 0, 2, 4-6 or 7-8, got ' + n);
    seen[n === 0 ? '0' : n === 2 ? '2' : n <= 6 ? '4-6' : '7+'] += 1;
  }
  // These are NOT the 50/25/15/10 the game is aimed at, and the gap is the
  // point. Shots are weighted toward good handlers, and skill shifts the roll
  // toward the longer buckets, so a table set to the target overshoots it: it
  // measured 46.1/22.5/19.6/11.8 in-game. The table is the CORRECTION,
  // calibrated by measurement (see scripts/probe-dribbles.js, which lands on
  // 49.6/24.6/15.3/10.5). Asserting the target here instead would be asserting
  // a number the game does not produce.
  const pct = function (k) { return (seen[k] / 20000) * 100; };
  assert.ok(Math.abs(pct('0') - 54.3) < 2, '0 dribbles near 54.3%, got ' + pct('0').toFixed(1));
  assert.ok(Math.abs(pct('2') - 25.6) < 2, '2 dribbles near 25.6%, got ' + pct('2').toFixed(1));
  assert.ok(Math.abs(pct('4-6') - 11.6) < 2, '4-6 near 11.6%, got ' + pct('4-6').toFixed(1));
  assert.ok(Math.abs(pct('7+') - 8.5) < 2, '7+ near 8.5%, got ' + pct('7+').toFixed(1));

  // Skill biases the DISTRIBUTION, not which moves are unlocked. The 88a0ee3
  // failure was a cliff: ballHandling 79 got a crossover and 80 got a double
  // move. A great handler should hold the ball longer MORE OFTEN, not hold it
  // longer every single time.
  let eliteLong = 0, poorLong = 0;
  for (let s = 0; s < 20000; s++) {
    if (choreo.dribbleCount(s, 95) >= 4) eliteLong += 1;
    if (choreo.dribbleCount(s, 40) >= 4) poorLong += 1;
  }
  assert.ok(eliteLong > poorLong * 1.4, 'elite handlers work longer more often');
  assert.ok(poorLong > 20000 * 0.05, 'a poor handler still sometimes works, got ' + poorLong);
  // The upper bound is the one that catches the cliff, which the lower bound
  // alone did not: mutation testing showed a shift of 0.9 leaves a 40-rated
  // handler working long 7% of the time -- above the floor above -- while a
  // 95-rated one does it on 94% of possessions. "Every elite possession is a
  // size-up" is the same failure as 88a0ee3 wearing different clothes.
  assert.ok(eliteLong < 20000 * 0.5,
    'even an elite handler mostly catches and shoots, got ' + (eliteLong / 200).toFixed(1) + '%');
  console.log('checkDribbleRoll: OK');
}
checkDribbleRoll();

checkTakeoversReachTheKeyframes();
console.log('All pixel choreographer validations passed');
