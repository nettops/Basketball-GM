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

function checkTheSpritePoseIsDrivenByTheBounce() {
  const sprites = require(path.join(__dirname, '..', 'ui', 'pixelSprites.js'));
  function armsFor(phase, side) {
    const calls = [];
    const ctx = { fillStyle: '#000', fillRect: function (x, y, w, h) { calls.push([x, y, w, h]); } };
    sprites.drawPlayerSprite(ctx, 40, 40, { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' },
      7, { heightIn: 78, dribbling: { phase: phase, side: side } });
    return JSON.stringify(calls);
  }
  assert.notStrictEqual(armsFor(0, 1), armsFor(1, 1), 'the arm must move with the bounce');
  assert.notStrictEqual(armsFor(0, 1), armsFor(0, -1), 'the pumping arm must switch sides with the ball');
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
