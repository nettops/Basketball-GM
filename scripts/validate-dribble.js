// The default dribble: the ball's path, and the arm that has to agree with it.
//
// The load-bearing check is checkTheBallNeverTeleportsAcrossTheBody. Switching
// hands at an INSTANT is the obvious implementation and it moves the ball 12px
// sideways in a single frame — the "prop snaps at a branch change" defect
// ui/pixelMotion.js exists to prevent. The crossover therefore happens across a
// whole bounce, and this asserts the path stays continuous.
const assert = require('assert');
const path = require('path');
const motion = require(path.join(__dirname, '..', 'ui', 'pixelMotion.js'));

const FRAME_MS = 1000 / 60;

// Every check below used to pass milliseconds straight in. The clock is in
// bounces now, so a test that wants "20 seconds at a standing tempo" has to
// integrate it the way the view does.
function clockAt(ms, moving) {
  return motion.stepDribbleClock(0, ms, moving);
}

function checkTheBounceStillBounces() {
  // Unchanged behaviour: the ball reaches the floor and reaches full height.
  [true, false].forEach(function (moving) {
    let low = Infinity, high = -Infinity;
    for (let ms = 0; ms < 4000; ms += 4) {
      const b = motion.dribbleBall(clockAt(ms, moving));
      low = Math.min(low, b.up);
      high = Math.max(high, b.up);
    }
    assert.ok(low <= 1.05, (moving ? 'moving' : 'standing') + ': the ball must reach the floor, got ' + low.toFixed(2));
    assert.ok(high >= motion.DRIBBLE_RISE, (moving ? 'moving' : 'standing') +
      ': the ball must reach full height, got ' + high.toFixed(2));
  });
  console.log('checkTheBounceStillBounces: OK');
}
checkTheBounceStillBounces();

function checkItActuallyChangesHands() {
  // The whole point of the change. Before this the ball sat on one side for
  // every dribble ever played.
  const sides = new Set();
  for (let ms = 0; ms < 6000; ms += 8) sides.add(Math.sign(motion.dribbleBall(clockAt(ms, false)).side));
  assert.ok(sides.has(1) && sides.has(-1), 'the ball must appear on BOTH sides of the body');
  console.log('checkItActuallyChangesHands: OK');
}
checkItActuallyChangesHands();

function checkTheBallNeverTeleportsAcrossTheBody() {
  // Frame to frame, at the frame rate the view actually draws at.
  [true, false].forEach(function (moving) {
    let worst = 0, worstAt = 0;
    let prev = motion.dribbleBall(clockAt(0, moving)).side;
    for (let ms = FRAME_MS; ms < 20000; ms += FRAME_MS) {
      const side = motion.dribbleBall(clockAt(ms, moving)).side;
      const jump = Math.abs(side - prev);
      if (jump > worst) { worst = jump; worstAt = ms; }
      prev = side;
    }
    // One bounce carries the ball the full 2 * DRIBBLE_SIDE across. At 60fps a
    // standing bounce is ~440ms, so a frame should move it well under a pixel.
    assert.ok(worst < 1.5, (moving ? 'moving' : 'standing') +
      ': the ball jumped ' + worst.toFixed(2) + 'px sideways in one frame at ' +
      Math.round(worstAt) + 'ms — it is teleporting across the body, not being carried');
    console.log('  ' + (moving ? 'moving ' : 'standing') + ' worst sideways step: ' + worst.toFixed(3) + 'px/frame');
  });
  console.log('checkTheBallNeverTeleportsAcrossTheBody: OK');
}
checkTheBallNeverTeleportsAcrossTheBody();

function checkTheCrossHappensAtTheFloor() {
  // A crossover that starts or ends mid-air reads as the ball passing THROUGH
  // him. The sign must be at its extremes when the ball is up, and passing
  // through zero when the ball is near the floor.
  for (let ms = 0; ms < 20000; ms += 4) {
    const h = motion.dribbleHand(clockAt(ms, false));
    if (!h.crossing) continue;
    // While crossing, whenever the ball is high the sign must be committed to
    // one side rather than hovering in front of him.
    if (h.phase > 0.75) {
      assert.ok(Math.abs(h.sign) > 0.35,
        'at ' + Math.round(ms) + 'ms the ball is high (' + h.phase.toFixed(2) +
        ') but only ' + h.sign.toFixed(2) + ' to one side — it is crossing through his chest');
    }
  }
  console.log('checkTheCrossHappensAtTheFloor: OK');
}
checkTheCrossHappensAtTheFloor();

function checkTheCrossoverIsNotConstant() {
  // He must keep it in one hand for a while — a ball crossing every bounce is
  // a windscreen wiper, not a dribble.
  let crossing = 0, total = 0;
  for (let ms = 0; ms < 40000; ms += 4) {
    total++;
    if (motion.dribbleHand(clockAt(ms, false)).crossing) crossing++;
  }
  const share = crossing / total;
  assert.ok(share > 0.15 && share < 0.45,
    'he is crossing over ' + (share * 100).toFixed(0) + '% of the time; want roughly one bounce in ' +
    motion.DRIBBLE_HAND_BOUNCES);
  console.log('checkTheCrossoverIsNotConstant: OK (' + (share * 100).toFixed(0) + '% of bounces)');
}
checkTheCrossoverIsNotConstant();

function checkTheArmAndTheBallAgree() {
  // The sprite is handed dribbleHand's sign; if the two ever disagreed the
  // hand would pump on the empty side. Same source, so this asserts they stay
  // wired to it rather than drifting apart later.
  for (let ms = 0; ms < 8000; ms += 7) {
    const h = motion.dribbleHand(clockAt(ms, false));
    const ball = motion.dribbleBall(clockAt(ms, false));
    assert.strictEqual(Math.sign(ball.side), Math.sign(h.sign) || Math.sign(ball.side),
      'the ball and the hand disagree about which side it is on at ' + ms + 'ms');
    assert.strictEqual(ball.bouncePhase, h.phase, 'the ball and the arm must share one bounce phase');
  }
  console.log('checkTheArmAndTheBallAgree: OK');
}
checkTheArmAndTheBallAgree();

function checkChangingTempoDoesNotRewriteThePast() {
  // THE defect this clock exists to prevent, and the one every other test in
  // this file was blind to because they all hold `moving` constant.
  //
  // A handler's speed is a springy quantity that wobbles across the
  // moving/standing threshold constantly. When the phase was derived from
  // ABSOLUTE time with a period that changes, crossing that threshold
  // recomputed the whole history and the ball snapped up to 12px into the
  // other hand in a single frame — measured at 446 times a game.
  let clock = 0, prev = motion.dribbleBall(0).side;
  let worst = 0, worstAt = 0;
  for (let ms = FRAME_MS; ms < 20000; ms += FRAME_MS) {
    // speed crossing the gate every few hundred ms, as a real body does
    const moving = Math.sin(ms / 430) > 0;
    clock = motion.stepDribbleClock(clock, FRAME_MS, moving);
    const side = motion.dribbleBall(clock).side;
    const jump = Math.abs(side - prev);
    if (jump > worst) { worst = jump; worstAt = ms; }
    prev = side;
  }
  assert.ok(worst < 1.5,
    'the ball jumped ' + worst.toFixed(2) + 'px sideways at ' + Math.round(worstAt) +
    'ms, on a frame where the handler crossed the moving/standing threshold — ' +
    'changing tempo must change how fast the clock runs from now on, never where ' +
    'the ball already was');
  console.log('  worst step across a tempo change: ' + worst.toFixed(3) + 'px/frame');
  console.log('checkChangingTempoDoesNotRewriteThePast: OK');
}
checkChangingTempoDoesNotRewriteThePast();

function checkAMovingHandlerDribblesFaster() {
  // Unchanged, but worth pinning: the bounce is quicker on the move.
  let movingBounces = 0, standingBounces = 0;
  let pm = 1, ps = 1;
  for (let ms = 0; ms < 10000; ms += 2) {
    const m = motion.dribbleBall(clockAt(ms, true)).bouncePhase;
    const s = motion.dribbleBall(clockAt(ms, false)).bouncePhase;
    if (pm > 0.05 && m <= 0.05) movingBounces++;
    if (ps > 0.05 && s <= 0.05) standingBounces++;
    pm = m; ps = s;
  }
  assert.ok(movingBounces > standingBounces,
    'a moving handler should bounce it more often (' + movingBounces + ' vs ' + standingBounces + ')');
  console.log('checkAMovingHandlerDribblesFaster: OK');
}
checkAMovingHandlerDribblesFaster();

// ---------------------------------------------------------------------------
// THE NAMED MOVES.
//
// Before this, a crossover, a behind-the-back, a double move and an ankle
// breaker drew IDENTICALLY: each slid the body sideways and left the ball on
// its own free-running metronome. Measured over real games, the ball reached
// 6.0px from the handler's centre in all four — the width of an ordinary
// dribble. These pin that they now differ, and differ in the right direction.
// ---------------------------------------------------------------------------

// Walk a whole move at the frame rate, through the same entry point the view
// uses, and report what the ball did.
function walkMove(move, n, startClock) {
  const samples = [];
  // The free clock is HELD for the duration of a string, exactly as the view
  // holds it. Advancing it here would let the starting hand drift underneath
  // the move — the bug this arrangement exists to prevent.
  const clock = startClock || 0;
  const STEPS = 600;
  for (let k = 0; k <= STEPS; k++) {
    samples.push(motion.dribbleNow(clock, { move: move, n: n, u: (k / STEPS) * n }));
  }
  return samples;
}
function widest(s) { return Math.max.apply(null, s.map(function (x) { return Math.abs(x.side * x.sign); })); }
function handChanges(s) {
  let n = 0, sign = 0;
  s.forEach(function (x) {
    const v = x.sign * x.side;
    const g = v > 1 ? 1 : v < -1 ? -1 : 0;
    if (g && g !== sign) { if (sign) n++; sign = g; }
  });
  return n;
}

function checkEachMoveHasItsOwnShape() {
  const want = {
    putdown: { changes: 0, minWide: 5,  maxWide: 7 },
    cross:   { changes: 1, minWide: 8,  maxWide: 12 },
    behind:  { changes: 1, minWide: 12, maxWide: 17 },
    double:  { changes: 2, minWide: 10, maxWide: 14 },
    ankle:   { changes: 1, minWide: 10, maxWide: 14 }
  };
  const N = { putdown: 2, cross: 5, behind: 5, double: 7, ankle: 4 };
  Object.keys(want).forEach(function (move) {
    const s = walkMove(move, N[move]);
    const w = widest(s), c = handChanges(s);
    assert.strictEqual(c, want[move].changes,
      move + ' should change hands ' + want[move].changes + ' time(s), got ' + c);
    assert.ok(w >= want[move].minWide && w <= want[move].maxWide,
      move + ' reaches ' + w.toFixed(1) + 'px from his centre, want ' +
      want[move].minWide + '-' + want[move].maxWide);
    console.log('  ' + move.padEnd(9) + c + ' hand change(s), widest ' + w.toFixed(1) + 'px');
  });
  console.log('checkEachMoveHasItsOwnShape: OK');
}

function checkTheMovesAreActuallyDistinguishable() {
  // The failure this replaces was four moves that measured identically. A
  // crossover must not be a behind-the-back, and a put-down must not be either.
  const N = { putdown: 2, cross: 5, behind: 5, double: 7, ankle: 4 };
  const w = {};
  Object.keys(N).forEach(function (m) { w[m] = widest(walkMove(m, N[m])); });
  assert.ok(w.behind - w.cross > 3,
    'behind the back (' + w.behind.toFixed(1) + 'px) must swing visibly wider than a ' +
    'crossover (' + w.cross.toFixed(1) + 'px) — otherwise they are the same rectangles sliding sideways');
  assert.ok(w.cross - w.putdown > 2,
    'a crossover must reach wider than a put-down');
  console.log('checkTheMovesAreActuallyDistinguishable: OK');
}

function checkACrossoverGoesThroughTheFloorAndBehindGoesOverIt() {
  // The two are opposites and that is the whole point: a crossover is a hard
  // low dribble through the middle; behind the back stays UP and swings around
  // him. Sampled at the instant the ball is passing his centre line.
  function atTheMiddle(move, n) {
    let best = null, bestAbs = Infinity;
    walkMove(move, n).forEach(function (x) {
      const lat = Math.abs(x.sign * x.side);
      if (x.crossing && lat < bestAbs) { bestAbs = lat; best = x; }
    });
    return best;
  }
  const cross = atTheMiddle('cross', 5);
  const behind = atTheMiddle('behind', 5);
  assert.ok(cross && cross.phase < 0.25,
    'a crossover must reach the floor as it passes his centre, got phase ' +
    (cross ? cross.phase.toFixed(2) : 'no crossing at all'));
  assert.ok(behind && behind.phase > 0.6,
    'behind the back must stay UP as it passes him — a ball on the floor in the ' +
    'middle of his stance is a crossover, got phase ' + (behind ? behind.phase.toFixed(2) : 'none'));
  console.log('checkACrossoverGoesThroughTheFloorAndBehindGoesOverIt: OK (cross ' +
    cross.phase.toFixed(2) + ' vs behind ' + behind.phase.toFixed(2) + ')');
}

function checkAMoveNeverSnapsTheBallSideways() {
  // Across the handoff BETWEEN the free dribble and the move: the move takes
  // over at the top of the string and hands it back at the end, and both
  // boundaries are branch changes — where every snap in this file has lived.
  //
  // Two bounds, because one is not enough. An absolute cap alone invites
  // loosening it a little each time a move gets wider, which is how a 12px
  // teleport gets waved through. The SHAPE bound is the one that actually
  // states the invariant: a continuous path's biggest frame step is a small
  // multiple of its typical one, while a snap is an enormous multiple of it
  // however wide the move is.
  const N = { putdown: 2, cross: 5, behind: 5, double: 7, ankle: 4 };
  Object.keys(N).forEach(function (move) {
    const n = N[move];
    const steps = [];
    let clock = 0, prev = null, worst = 0, worstAt = 0, wasInMove = false;
    // half a second of free dribble, the move, then half a second free again —
    // driving the clock the way the view drives it, holds and all, because both
    // handoffs are branch changes and branch changes are where this snaps.
    for (let ms = 0; ms < 500 + n * 240 + 500; ms += FRAME_MS) {
      const into = ms - 500;
      const inMove = into >= 0 && into <= n * 240;
      if (inMove && !wasInMove) wasInMove = true;
      else if (!inMove && wasInMove) { clock = motion.dribbleClockAfterMove(clock, move, n); wasInMove = false; }
      else if (!inMove) clock = motion.stepDribbleClock(clock, FRAME_MS, false);
      const b = motion.dribbleNow(clock, inMove ? { move: move, n: n, u: into / 240 } : null);
      const lat = b.sign * b.side;
      if (prev !== null) {
        const jump = Math.abs(lat - prev);
        steps.push(jump);
        if (jump > worst) { worst = jump; worstAt = ms; }
      }
      prev = lat;
    }
    // 1) An absolute ceiling, well clear of a 12px hand-swap. Looser than the
    //    free dribble's 1.5px on purpose: a scripted crossover carries the ball
    //    across in about 240ms where the idle dribble takes a 440ms bounce, and
    //    that quickness is the point of the move.
    assert.ok(worst < 4,
      move + ': the ball jumped ' + worst.toFixed(2) + 'px sideways in one frame at ' +
      Math.round(worstAt) + 'ms — the move must blend into and out of the free dribble, not replace it');
    // 2) The shape bound, which does not care how wide the move is. Compared
    //    against the busiest tenth of the frames rather than the mean, so the
    //    long quiet stretches between crossings cannot flatter it.
    const busy = steps.slice().sort(function (a, b) { return b - a; });
    const typicalWhenMoving = busy[Math.floor(busy.length * 0.1)] || 1e-6;
    const ratio = worst / typicalWhenMoving;
    assert.ok(ratio < 3,
      move + ': one frame moved the ball ' + ratio.toFixed(1) + 'x further than the ' +
      'busiest frames around it (' + worst.toFixed(2) + 'px against ' +
      typicalWhenMoving.toFixed(2) + 'px) — that is a snap, not a fast move');
    console.log('  ' + move.padEnd(9) + 'worst step ' + worst.toFixed(3) +
      'px/frame, ' + ratio.toFixed(1) + 'x the busy-frame typical');
  });
  console.log('checkAMoveNeverSnapsTheBallSideways: OK');
}

function checkHeSellsItBeforeHeCrosses() {
  // The hesitation. A crossover that simply happens is a ball changing hands;
  // a crossover a defender BITES on has a beat of stillness in front of it,
  // where the ball hangs high and nothing else moves. So through the half-beat
  // before a crossing the ball must stay up near the top of its bounce rather
  // than carrying on with the metronome — and then drop into the move.
  const N = { cross: 5, behind: 5, double: 7 };
  Object.keys(N).forEach(function (move) {
    const n = N[move];
    const crossings = motion.dribbleCrossings(move, n);
    crossings.forEach(function (c) {
      // The window the hesitation declares for itself, minus the ease-in at its
      // far edge. Read off the module rather than hard-coded, so retuning the
      // pause cannot silently move the goalposts this is checking against.
      const from = c.at - 0.5 - (motion.HESITATION_BEATS - motion.HESITATION_EASE);
      let lowest = 1;
      for (let u = from; u < c.at - 0.5; u += 0.01) {
        if (u <= 0) continue;
        lowest = Math.min(lowest, motion.dribbleNow(0, { move: move, n: n, u: u }).phase);
      }
      assert.ok(lowest > 0.5,
        move + ': through the half-beat before the crossing at ' + c.at + ' the ball drops to ' +
        lowest.toFixed(2) + ' of its bounce — it should HANG there, which is the fake');
    });
    // And it must actually let go afterwards, or the "hesitation" is just a
    // ball that never comes down.
    const atPlant = motion.dribbleNow(0, { move: move, n: n, u: crossings[0].at }).phase;
    if (move !== 'behind') {
      assert.ok(atPlant < 0.25,
        move + ': the ball is at ' + atPlant.toFixed(2) + ' of its bounce as he plants — ' +
        'the hold has to break INTO the move, not carry through it');
    }
    console.log('  ' + move.padEnd(9) + 'holds at ' + lowestOf(move, n).toFixed(2) +
      ', plants at ' + atPlant.toFixed(2));
  });

  // And the ankle breaker deliberately does NOT hesitate. Its fake is the jab —
  // a 300ms beat that exists to make the defender commit — and the cut back is
  // the 90ms punish. A ball hanging in front of the cut is a second fake
  // stacked on the first, slowing the one beat in the game that has to snap.
  // Asserted rather than left to comment, because "we chose not to" and "we
  // forgot" look identical in a diff.
  const ankleHold = lowestOf('ankle', 4);
  assert.ok(ankleHold < 0.4,
    'an ankle breaker must not hesitate before the cut back — it holds at ' +
    ankleHold.toFixed(2) + ', which is a second fake on top of the jab');
  console.log('  ankle    deliberately does not hesitate (' + ankleHold.toFixed(2) + ')');
  console.log('checkHeSellsItBeforeHeCrosses: OK');
}
function lowestOf(move, n) {
  const c = motion.dribbleCrossings(move, n)[0];
  const from = c.at - 0.5 - (motion.HESITATION_BEATS - motion.HESITATION_EASE);
  let lowest = 1;
  for (let u = Math.max(0.01, from); u < c.at - 0.5; u += 0.01) {
    lowest = Math.min(lowest, motion.dribbleNow(0, { move: move, n: n, u: u }).phase);
  }
  return lowest;
}

checkEachMoveHasItsOwnShape();
checkHeSellsItBeforeHeCrosses();
checkTheMovesAreActuallyDistinguishable();
checkACrossoverGoesThroughTheFloorAndBehindGoesOverIt();
checkAMoveNeverSnapsTheBallSideways();

function checkTheSpritePoseIsDrivenByTheBounce() {
  const sprites = require(path.join(__dirname, '..', 'ui', 'pixelSprites.js'));
  function armsFor(phase, side, crossing) {
    const calls = [];
    const ctx = { fillStyle: '#000', fillRect: function (x, y, w, h) { calls.push([x, y, w, h]); } };
    sprites.drawPlayerSprite(ctx, 40, 40, { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' },
      7, { heightIn: 78, dribbling: { phase: phase, side: side, crossing: !!crossing } });
    return JSON.stringify(calls);
  }
  assert.notStrictEqual(armsFor(0, 1), armsFor(1, 1), 'the arm must move with the bounce');
  assert.notStrictEqual(armsFor(0, 1), armsFor(0, -1), 'the pumping arm must switch sides with the ball');
  // Mid-crossover both arms are working, because the ball is being driven from
  // one hand to the other and neither is idle.
  const still = armsFor(0.3, 1), crossing = armsFor(0.3, 1, true);
  assert.notStrictEqual(still, crossing,
    'a man mid-crossover must not be drawn with one arm hanging at his side');
  // And a dribbling sprite must differ from a plain standing one.
  const plain = (function () {
    const calls = [];
    const ctx = { fillStyle: '#000', fillRect: function (x, y, w, h) { calls.push([x, y, w, h]); } };
    sprites.drawPlayerSprite(ctx, 40, 40, { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' },
      7, { heightIn: 78 });
    return JSON.stringify(calls);
  })();
  assert.notStrictEqual(armsFor(0, 1), plain, 'a dribbling player must not draw as a standing one');
  console.log('checkTheSpritePoseIsDrivenByTheBounce: OK');
}
checkTheSpritePoseIsDrivenByTheBounce();

console.log('All dribble validations passed');
