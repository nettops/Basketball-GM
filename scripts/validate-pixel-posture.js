// The posture channels: knee bend, landing recovery, the layup's phases and
// the handler's weight.
//
// These exist because the animation polish pass added three things the sprite
// had never had — a crouch that folds instead of sinking, a landing that
// outlives the beat it happened on, and a layup with phases — and every one of
// them is the kind of geometry that can look fine in one pose and be broken in
// the next. ui/pixelMotion.js exists so this file can reach them; see the note
// at the top of that file for why the render closure could not be tested.
//
// Run: node scripts/validate-pixel-posture.js

const assert = require('assert');
const path = require('path');

const motion = require(path.join(__dirname, '..', 'ui', 'pixelMotion.js'));
const sprites = require(path.join(__dirname, '..', 'ui', 'pixelSprites.js'));
const dunks = require(path.join(__dirname, '..', 'ui', 'pixelDunks.js'));

const COLORS = { skin: '#a06', hair: '#111', jersey: '#28f', trim: '#fff' };

// Draws a sprite and reports the extremes it painted. The real defect this
// catches — a body drawn below its own shadow — is invisible to any check that
// only looks at the numbers going in.
function spriteBounds(opts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const ctx = {
    fillStyle: '',
    fillRect: function (x, y, w, h) {
      assert.ok(w > 0 && h > 0,
        'sprite painted a zero or negative rect: ' + [x, y, w, h].join(','));
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y + h);
    }
  };
  sprites.drawPlayerSprite(ctx, 50, 100, COLORS, '23', opts);
  return { left: minX, right: maxX, top: minY, foot: maxY };
}

// A player is 24px tall at a standard height, and the shadow is drawn at his
// feet. Every height in the league, at every bend the game can ask for.
const HEIGHTS = [72, 76, 79, 84, 91];

function checkACrouchNeverSinksThePlayer() {
  // THE DEFECT THIS FILE WAS WRITTEN FOR. Anticipation used to be drawn as
  // `y - lift` with a negative lift, which slides the whole sprite — feet
  // included — below the shadow that stays at y. For the entire gather of
  // every shot in the game the player stood underneath the floor.
  let deepest = 0;
  HEIGHTS.forEach(function (h) {
    const flat = spriteBounds({ heightIn: h });
    for (let c = 0; c <= 8; c++) {
      const bent = spriteBounds({ heightIn: h, crouch: c });
      assert.strictEqual(bent.foot, flat.foot,
        'crouch ' + c + ' at ' + h + '" moved the feet from ' + flat.foot + ' to ' + bent.foot);
      assert.ok(bent.top >= flat.top,
        'crouch ' + c + ' at ' + h + '" made the player TALLER');
      deepest = Math.max(deepest, bent.top - flat.top);
    }
  });
  // ...and the bend has to actually be visible, or planting the feet has simply
  // deleted the anticipation instead of fixing it.
  HEIGHTS.forEach(function (h) {
    const flat = spriteBounds({ heightIn: h });
    const bent = spriteBounds({ heightIn: h, crouch: 4 });
    assert.ok(bent.top - flat.top >= 2,
      'a 4px gather at ' + h + '" only lowered the head ' + (bent.top - flat.top) + 'px');
  });
  console.log('checkACrouchNeverSinksThePlayer: OK (deepest head drop ' + deepest + 'px, feet never moved)');
}

function checkTheCrouchFoldsAtBothJoints() {
  // Legs are 4px on a 6'0" guard. Taking the whole bend out of them leaves the
  // players who take most of the shots with a 1px gather, which is why the
  // split exists — see crouchSplit.
  const short = sprites.crouchSplit(4, 4, 7);
  assert.ok(short.hip < short.head,
    'a short body took the whole bend in the knees: ' + JSON.stringify(short));
  assert.ok(short.head >= 3, 'a short body barely bent: ' + JSON.stringify(short));
  // Neither joint may fold past its floor, at any depth.
  for (let legLen = 3; legLen <= 9; legLen++) {
    for (let torso = 5; torso <= 11; torso++) {
      for (let c = 0; c <= 12; c++) {
        const s = sprites.crouchSplit(c, legLen, torso);
        assert.ok(s.hip <= legLen - sprites.CROUCH_MIN_LEG,
          'knees folded past the shin floor');
        assert.ok(s.head - s.hip <= torso - sprites.CROUCH_MIN_TORSO,
          'waist folded past the torso floor');
        assert.ok(s.head >= s.hip && s.hip >= 0, 'negative or inverted fold');
      }
    }
  }
  console.log('checkTheCrouchFoldsAtBothJoints: OK');
}

function checkALandingCompressesThenRecovers() {
  const peak = motion.landingSquashPx('dunk');
  assert.strictEqual(motion.landingSquash(0, 'dunk'), 0,
    'the squash starts part-way in, so it pops on the contact frame');
  assert.ok(Math.abs(motion.landingSquash(motion.LANDING_COMPRESS_MS, 'dunk') - peak) < 0.01,
    'the squash does not reach its peak at the end of the compression');
  assert.strictEqual(motion.landingSquash(motion.LANDING_TOTAL_MS, 'dunk'), 0,
    'the squash has not recovered by the end of its window');
  assert.strictEqual(motion.landingSquash(5000, 'dunk'), 0,
    'a stale landing stamp still bends the knees');
  assert.strictEqual(motion.landingSquash(-20, 'dunk'), 0, 'squash before contact');

  // Compression is FASTER than recovery. That ratio is the difference between
  // absorbing a landing and bouncing off the floor, and it is the one property
  // of this curve that carries the weight.
  assert.ok(motion.LANDING_COMPRESS_MS < motion.LANDING_RECOVER_MS,
    'recovery is quicker than compression, so landings read as bounces');

  // TWO different budgets, because the two halves of this curve are doing two
  // different jobs.
  //
  // The compression is an IMPACT and is supposed to be abrupt — that is the
  // accent frame the brief asks for, and smoothing it out would be removing the
  // very thing it exists to deliver. It still gets a ceiling, because past
  // about 2px on a 24px body an accent stops reading as weight and starts
  // reading as the sprite snapping.
  //
  // The recovery is the opposite: it is the body settling, and any step the eye
  // can catch there reads as a stutter on the way back up.
  let worstIn = 0, worstOut = 0;
  for (let ms = 0; ms < motion.LANDING_TOTAL_MS + 60; ms += 1000 / 60) {
    const a = motion.landingSquash(ms, 'dunk');
    const b = motion.landingSquash(ms + 1000 / 60, 'dunk');
    const step = Math.abs(b - a);
    if (ms < motion.LANDING_COMPRESS_MS) worstIn = Math.max(worstIn, step);
    else worstOut = Math.max(worstOut, step);
  }
  assert.ok(worstIn <= 2.0,
    'the landing impact steps ' + worstIn.toFixed(2) + 'px in one frame, past the accent budget');
  assert.ok(worstOut < 0.7,
    'the landing RECOVERY steps ' + worstOut.toFixed(2) + 'px in one frame — that is a stutter, not a settle');
  assert.ok(worstIn > worstOut,
    'the landing recovers faster than it compresses, so it reads as a bounce');
  const worst = worstIn;

  // A dunk lands harder than a pull-up.
  assert.ok(motion.landingSquashPx('dunk') > motion.landingSquashPx('jump'),
    'a dunk lands no harder than a jump shot');
  console.log('checkALandingCompressesThenRecovers: OK (peak ' + peak +
    'px, impact ' + worst.toFixed(2) + 'px/frame, settle ' + worstOut.toFixed(2) + 'px/frame)');
}

// A keyframe carrying a layup phase and nothing else this file needs.
function closeKf(t, phase, id) {
  return { t: t, close: phase ? { phase: phase, id: id || 'p1', side: 1 } : null };
}

function checkTheLayupIsStillInTheAirWhenTheBallLeaves() {
  // THE DEFECT. `closeLift(f)` was a sine hump that returned to ZERO at the end
  // of the beat — and the end of that beat is the frame the ball leaves the
  // hand. So the game released every layup at the instant the finisher's feet
  // were back on the floor.
  const rise = closeKf(0, 'rise');
  const release = closeKf(90, 'release');
  const land = closeKf(510, 'land');

  const atRelease = motion.resolveLifts(rise, release, 1, false);
  assert.ok(atRelease.closerLift > 0,
    'the finisher is on the floor at the release (lift ' + atRelease.closerLift + ')');
  // ...and still up on the first frame after it, which is when the ball is
  // actually gone.
  const justAfter = motion.resolveLifts(release, land, 0, false);
  assert.ok(justAfter.closerLift > 0,
    'the finisher is on the floor the frame the ball leaves');
  assert.strictEqual(justAfter.closerFoot, justAfter.closerLift,
    'a positive lift leaked into the crouch channel');
  console.log('checkTheLayupIsStillInTheAirWhenTheBallLeaves: OK (lift ' +
    atRelease.closerLift + 'px at the release)');
}

function checkTheGatherBendsRatherThanSinks() {
  // Every phase that carries a negative lift has to arrive as crouch, never as
  // a foot lift — that is the contract the sprite relies on to keep the feet
  // planted.
  [['close', closeKf, motion.CLOSE_LIFT],
   ['jump', function (t, phase) { return { t: t, jump: phase ? { phase: phase, id: 'p1' } : null }; }, motion.JUMP_LIFT],
   ['dunk', function (t, phase) { return { t: t, dunk: phase ? { phase: phase, id: 'p1' } : null }; }, motion.DUNK_LIFT]
  ].forEach(function (row) {
    const name = row[0], mk = row[1], table = row[2];
    assert.ok(table.gather < 0, name + ' has no dip in its gather at all');
    const lifts = motion.resolveLifts(mk(0, 'gather'), mk(150, 'gather'), 0.5, false);
    const foot = lifts[name === 'close' ? 'closerFoot' : name === 'jump' ? 'jumperFoot' : 'dunkerFoot'];
    const crouch = lifts[name === 'close' ? 'closerCrouch' : name === 'jump' ? 'jumperCrouch' : 'dunkerCrouch'];
    assert.strictEqual(foot, 0, name + ' lifted the feet during its gather');
    assert.ok(crouch > 0, name + ' gathers without bending anything');
  });
  console.log('checkTheGatherBendsRatherThanSinks: OK');
}

function checkTheDescentRunsOnRealTimeNotBeatProgress() {
  // The beat a leaper comes down on is the ball's whole flight — 420ms for a
  // layup, up to 850 for a three. Easing the descent across it leaves him
  // hanging in the air until the ball reaches the rim. He must reach the floor
  // at the same wall-clock moment whatever the beat length is.
  const short = motion.resolveLeaper(
    closeKf(0, 'release'), closeKf(420, 'land'), 0, motion.closeLiftAt, 'close', motion.DESCENT_MS.close);
  assert.ok(short.lift > 0, 'the descent starts already landed');

  function msToFloor(spanMs) {
    const a = closeKf(0, 'release'), b = closeKf(spanMs, 'land');
    for (let ms = 0; ms <= spanMs; ms += 2) {
      const r = motion.resolveLeaper(a, b, ms / spanMs, motion.closeLiftAt, 'close', motion.DESCENT_MS.close);
      if (r.lift <= 0) return ms;
    }
    return spanMs;
  }
  const a = msToFloor(420), b = msToFloor(850);
  assert.ok(Math.abs(a - b) <= 8,
    'the descent stretches with the beat: floor at ' + a + 'ms vs ' + b + 'ms');
  assert.ok(a <= motion.DESCENT_MS.close + 20,
    'the descent takes ' + a + 'ms, past its stated ' + motion.DESCENT_MS.close);
  console.log('checkTheDescentRunsOnRealTimeNotBeatProgress: OK (floor at ' +
    a + 'ms and ' + b + 'ms across a 2x beat span)');
}

function checkEveryLeapIsSeenToLand() {
  // THE BUG THIS CATCHES, which cost a rewrite of how landings are detected.
  //
  // The first version had the lift curve report "how long ago the feet
  // touched", solved from the easing. For a dunk that is
  // `round(13 * (1 - f^1.6))` over a 130ms beat, and the window between the
  // curve rounding to zero and the beat ending is **3.1ms wide** — narrower
  // than a frame. A renderer stepping 16.7ms walks straight over it about four
  // times in five and the landing never fires at all.
  //
  // So the test is now a transition between drawn frames, and this check walks
  // each leap at a real frame rate to prove the transition is actually seen.
  const cases = [
    // Each fixture runs PAST its landing keyframe, because a real timeline
    // always does — and the dunk in particular reaches the floor in the last
    // 3ms of its land beat, so the frame that actually sees foot = 0 is the
    // first frame of whatever comes next. A fixture that stops at the landing
    // keyframe never samples that frame and reports no landing at all.
    ['dunk', [{ t: 0, dunk: { phase: 'rise', id: 'p1' } },
              { t: 150, dunk: { phase: 'slam', id: 'p1' } },
              { t: 240, dunk: { phase: 'land', id: 'p1' } },
              { t: 640, dunk: { phase: 'land', id: 'p1' } }], 'dunkerFoot'],
    ['jump', [{ t: 0, jump: { phase: 'rise', id: 'p1' } },
              { t: 120, jump: { phase: 'release', id: 'p1' } },
              { t: 180, jump: { phase: 'follow', id: 'p1' } },
              { t: 1030, jump: { phase: 'follow', id: 'p1' } }], 'jumperFoot'],
    ['close', [closeKf(0, 'rise'), closeKf(130, 'release'),
               closeKf(220, 'land'), closeKf(640, 'land')], 'closerFoot']
  ];
  cases.forEach(function (c) {
    const kind = c[0], kfs = c[1], key = c[2];
    const end = kfs[kfs.length - 1].t;
    let prev = null, landings = 0, wasUp = false;
    // Sampled at 60fps AND at 30fps: a landing that only exists at one frame
    // rate is a landing that vanishes on a slow machine.
    [1000 / 60, 1000 / 30].forEach(function (step) {
      prev = null; landings = 0; wasUp = false;
      for (let ms = 0; ms <= end; ms += step) {
        let i = 0;
        while (i < kfs.length - 2 && kfs[i + 1].t <= ms) i++;
        const a = kfs[i], b = kfs[i + 1] || kfs[i];
        const span = Math.max(1, b.t - a.t);
        const f = Math.max(0, Math.min(1, (ms - a.t) / span));
        const foot = motion.resolveLifts(a, b, f, false)[key];
        if (foot > 0) wasUp = true;
        if (motion.justLanded(prev, foot)) landings++;
        prev = foot;
      }
      assert.ok(wasUp, kind + ' never left the floor at ' + Math.round(1000 / step) + 'fps');
      assert.strictEqual(landings, 1,
        kind + ' produced ' + landings + ' landings at ' +
        Math.round(1000 / step) + 'fps — expected exactly one');
    });
  });
  // ...and the detector itself only fires on a real transition.
  assert.strictEqual(motion.justLanded(0, 0), false, 'a man standing still "landed"');
  assert.strictEqual(motion.justLanded(undefined, 0), false, 'the first frame ever counted as a landing');
  assert.strictEqual(motion.justLanded(5, 3), false, 'still airborne but counted as landed');
  assert.strictEqual(motion.justLanded(3, 0), true, 'a real landing was missed');
  console.log('checkEveryLeapIsSeenToLand: OK (dunk, jump and layup each land exactly once at 60fps and 30fps)');
}

function checkTheWeightFollowsTheBallAndNeverTeleports() {
  // The lean is derived from the same `sign` the ball and the dribbling arm
  // share, so it cannot disagree with which hand has the ball. What it CAN do
  // is jump, and a torso that jumps is worse than one that never moves.
  let worst = 0, prev = null, sawLeft = false, sawRight = false;
  // A real crossover string, walked at 60fps on the beat clock.
  const n = 4;
  for (let u = 0; u <= n; u += 0.02) {
    const now = motion.dribbleNow(1, { move: 'cross', n: n, u: u });
    const lean = motion.dribbleLean(now);
    // sign agreement: the body is never leaning away from the ball's hand
    if (Math.abs(now.sign) > 0.3) {
      assert.ok(lean === 0 || (lean > 0) === (now.sign > 0),
        'the torso leaned away from the hand the ball is in at u=' + u.toFixed(2));
    }
    if (lean < -0.5) sawLeft = true;
    if (lean > 0.5) sawRight = true;
    if (prev !== null) worst = Math.max(worst, Math.abs(lean - prev));
    prev = lean;
  }
  assert.ok(sawLeft && sawRight, 'the weight never actually crossed over');
  assert.ok(worst < 1.0,
    'the torso jumped ' + worst.toFixed(2) + 'px between frames of a crossover');
  assert.strictEqual(motion.dribbleLean(null), 0, 'a man with no ball is leaning');
  console.log('checkTheWeightFollowsTheBallAndNeverTeleports: OK (worst step ' +
    worst.toFixed(2) + 'px, crossed both ways)');
}

function checkALeanNeverMovesTheFeet() {
  const flat = spriteBounds({ heightIn: 79 });
  [-2, -1, 1, 2].forEach(function (lean) {
    const leaned = spriteBounds({ heightIn: 79, lean: lean });
    assert.strictEqual(leaned.foot, flat.foot, 'leaning moved the feet');
    assert.notStrictEqual(leaned.left, flat.left, 'a lean of ' + lean + ' drew nothing different');
  });
  console.log('checkALeanNeverMovesTheFeet: OK');
}

function checkTheLayupPoseIsItsOwnSilhouette() {
  // A layup that draws the same pixels as a dunk is a dunk at a lower height,
  // which is what it was before it had a pose of its own.
  function trace(opts) {
    const out = [];
    const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { out.push([x, y, w, h].join(',')); } };
    sprites.drawPlayerSprite(ctx, 50, 100, COLORS, '23', opts);
    return out.join('|');
  }
  const layupR = trace({ heightIn: 79, layup: { side: 1, extend: 1 } });
  const layupL = trace({ heightIn: 79, layup: { side: -1, extend: 1 } });
  const dunk = trace({ heightIn: 79, dunking: true, facing: 1 });
  const shoot = trace({ heightIn: 79, shooting: true });
  assert.notStrictEqual(layupR, dunk, 'the layup pose is identical to the dunk pose');
  assert.notStrictEqual(layupR, shoot, 'the layup pose is identical to the jump-shot pose');
  assert.notStrictEqual(layupR, layupL, 'a left-side layup draws the same as a right-side one');
  // The reach has to actually animate, or the arm appears at full stretch on
  // the frame the pose switches on.
  const early = trace({ heightIn: 79, layup: { side: 1, extend: 0 } });
  assert.notStrictEqual(early, layupR, 'the layup arm does not extend');
  // ...and extending has to raise the silhouette rather than just redraw it.
  assert.ok(spriteBounds({ heightIn: 79, layup: { side: 1, extend: 1 } }).top <
            spriteBounds({ heightIn: 79, layup: { side: 1, extend: 0 } }).top,
    'full extension does not reach any higher than no extension');
  console.log('checkTheLayupPoseIsItsOwnSilhouette: OK');
}

function checkOnlyOnePoseCanEverWin() {
  // Section 11 of the brief asks for an explicit priority. The risk it is
  // guarding against is not a wrong order — it is FIVE call sites having to
  // agree, which is how the view used to do it: every pose was gated behind a
  // growing pile of `!shooting && !isJumperNow && !dunkPose && ...`, so adding
  // a sixth pose meant remembering to exclude it from all five.
  //
  // Every combination of flags, exhaustively: exactly one pose out, and it is
  // always the highest-priority flag that is set.
  const FLAGS = ['dunking', 'layup', 'following', 'shooting', 'stumbling', 'dribbling', 'moving'];
  for (let mask = 0; mask < (1 << FLAGS.length); mask++) {
    const bag = {};
    FLAGS.forEach(function (f, i) { if (mask & (1 << i)) bag[f] = true; });
    const won = motion.posePriority(bag);
    assert.ok(motion.POSE_ORDER.indexOf(won) !== -1, 'posePriority invented "' + won + '"');
    if (mask === 0) {
      assert.strictEqual(won, 'idle', 'a player with no flags is not idle');
      continue;
    }
    // The winner must be set...
    assert.ok(bag[won], 'posePriority chose "' + won + '", which was not set');
    // ...and nothing above it in the order may be.
    for (let i = 0; i < motion.POSE_ORDER.indexOf(won); i++) {
      assert.ok(!bag[motion.POSE_ORDER[i]],
        '"' + motion.POSE_ORDER[i] + '" outranks "' + won + '" but lost');
    }
  }
  // The order the brief specifies: DUNK > SHOOT > LAYUP > DRIBBLE > WALK > IDLE.
  // Layup sits above the generic shooting pose here rather than below it, and
  // that is deliberate — "SHOOT" in the brief means the jump shot, and a layup
  // that lost to it would be drawn with the two-arms-up pose it spent this
  // whole pass escaping.
  const order = motion.POSE_ORDER;
  const rank = function (n) { return order.indexOf(n); };
  assert.ok(rank('dunking') < rank('layup'), 'a dunk does not outrank a layup');
  assert.ok(rank('layup') < rank('shooting'), 'the layup pose lost to the generic shooting pose');
  assert.ok(rank('shooting') < rank('dribbling'), 'a man rising into a shot is still dribbling');
  assert.ok(rank('dribbling') < rank('moving'), 'a running handler drops his dribble');
  assert.strictEqual(order[order.length - 1], 'idle', 'idle is not the fallback');
  console.log('checkOnlyOnePoseCanEverWin: OK (' + (1 << FLAGS.length) +
    ' flag combinations, one winner each)');
}

function checkTheThreeLayupFinishesAreThreeDifferentPictures() {
  // A reverse, a floater and a standard lay-in used to be one pose at one
  // height with only the side read off the timeline. If any two of them still
  // draw the same pixels, the variety is nominal.
  function trace(finish, side) {
    const out = [];
    const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { out.push([x, y, w, h].join(',')); } };
    sprites.drawPlayerSprite(ctx, 50, 100, COLORS, '23',
      { heightIn: 79, layup: { side: side, finish: finish, extend: 1 } });
    return out.join('|');
  }
  const kinds = ['standard', 'floater', 'reverse'];
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      assert.notStrictEqual(trace(kinds[i], 1), trace(kinds[j], 1),
        kinds[i] + ' and ' + kinds[j] + ' draw identical pixels');
    }
  }
  // A REVERSE finishes on the FAR side — he has carried it under the rim —
  // which means that for the same drive direction the ball hand is the
  // opposite one from a standard lay-in. That, and not the extra pixel of
  // reach, is what makes it a different move rather than a taller one.
  function ballArmX(finish, side) {
    // The reaching arm is the tallest rect drawn; its x is the hand.
    let best = null;
    const ctx = {
      fillStyle: '',
      fillRect: function (x, y, w, h) {
        if (w === 2 && (!best || h > best.h)) best = { x: x, h: h };
      }
    };
    sprites.drawPlayerSprite(ctx, 50, 100, COLORS, '23',
      { heightIn: 79, layup: { side: side, finish: finish, extend: 1 } });
    return best.x;
  }
  const stdRight = ballArmX('standard', 1);
  const revRight = ballArmX('reverse', 1);
  assert.notStrictEqual(stdRight, revRight,
    'a reverse finishes on the same hand as a standard lay-in from the same drive');
  assert.strictEqual(revRight, ballArmX('standard', -1),
    'a reverse should finish on the hand a standard lay-in from the other side uses');

  // Each finish reaches its own height, and the ordering is the point: a
  // floater is a touch shot and must not rise as high as a lay-in, a reverse
  // carries under and rises higher.
  const rise = {};
  kinds.forEach(function (k) { rise[k] = motion.closeLiftTable(k).rise; });
  assert.ok(rise.floater < rise.standard,
    'a floater rises as high as a standard lay-in — it is a touch shot');
  assert.ok(rise.reverse > rise.standard, 'a reverse does not rise higher than a standard lay-in');
  // ...and a floater gathers DEEPER, because it is lofted rather than driven.
  assert.ok(motion.closeLiftTable('floater').gather < motion.closeLiftTable('standard').gather,
    'a floater does not gather deeper than a standard lay-in');
  // Every finish must still be airborne at its release, which is the defect
  // the layup work existed to fix and is easy to reintroduce in a new table.
  kinds.forEach(function (k) {
    assert.ok(motion.closeLiftTable(k).release > 0,
      'a ' + k + ' releases with its feet on the floor');
  });
  console.log('checkTheThreeLayupFinishesAreThreeDifferentPictures: OK (rise ' +
    kinds.map(function (k) { return k + ' ' + rise[k]; }).join(', ') + ')');
}

function checkContactIsRareAndDecays() {
  // Measured: the separator shoves somebody on 8.2% of player-frames, and of
  // those p50 is 0.1px. Ordinary crowding must draw nothing at all or the
  // whole floor is permanently flinching.
  assert.strictEqual(motion.contactStrength(0.1), 0, 'ordinary crowding registers as contact');
  assert.strictEqual(motion.contactStrength(0.9), 0, 'a p90 nudge registers as contact');
  assert.ok(motion.contactStrength(2.3) > 0, 'a p99 shove does not register as contact');
  assert.strictEqual(motion.contactStrength(8), 1, 'the hardest shove is not full strength');
  // Decays to nothing, and starts at full — a bump is hardest when it lands.
  assert.strictEqual(motion.contactDecay(0), 1, 'contact does not start at full strength');
  assert.strictEqual(motion.contactDecay(motion.CONTACT_MS), 0, 'contact never ends');
  assert.strictEqual(motion.contactDecay(9999), 0, 'a stale bump still leans the body');
  let worst = 0, prev = motion.contactDecay(0);
  for (let ms = 0; ms <= motion.CONTACT_MS; ms += 1000 / 60) {
    const v = motion.contactDecay(ms);
    worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(worst * motion.CONTACT_LEAN_PX < 0.6,
    'the contact lean steps ' + (worst * motion.CONTACT_LEAN_PX).toFixed(2) + 'px in one frame');
  console.log('checkContactIsRareAndDecays: OK (fires above ' + motion.CONTACT_MIN_PX +
    'px, worst step ' + (worst * motion.CONTACT_LEAN_PX).toFixed(2) + 'px/frame)');
}

function checkOnlyTheLegsMoveGoesThroughTheLegs() {
  // A crossover goes across his front and a behind-the-back goes round his
  // back. Opening the stance for either is the pose contradicting the ball.
  ['cross', 'behind', 'double', 'putdown', 'ankle', 'stepback'].forEach(function (mv) {
    for (let u = 0; u <= 4; u += 0.02) {
      const now = motion.dribbleNow(1, { move: mv, n: 4, u: u });
      assert.strictEqual(now.through, 0,
        mv + ' opens the stance at u=' + u.toFixed(2) + ' — only "legs" may');
    }
  });
  let peak = 0, worst = 0, prev = null;
  for (let u = 0; u <= 4; u += 1 / 60) {
    const now = motion.dribbleNow(1, { move: 'legs', n: 4, u: u });
    peak = Math.max(peak, now.through);
    if (prev !== null) worst = Math.max(worst, Math.abs(now.through - prev));
    prev = now.through;
  }
  assert.ok(peak > 0.9, 'the between-the-legs stance never fully opens (' + peak.toFixed(2) + ')');
  assert.ok(worst < 0.2, 'the stance snaps open ' + worst.toFixed(2) + ' in one frame');
  // ...and the ball genuinely goes low through the middle on that beat, or the
  // open stance is a pose with nothing passing through it.
  let lowest = 1;
  for (let u = 1.5; u <= 2.5; u += 0.01) {
    lowest = Math.min(lowest, motion.dribbleNow(1, { move: 'legs', n: 4, u: u }).phase);
  }
  assert.ok(lowest < 0.1, 'the ball never gets low enough to pass through the stance');
  // The stance opening must actually change the drawn sprite.
  function trace(through) {
    const out = [];
    const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { out.push([x, y, w, h].join(',')); } };
    sprites.drawPlayerSprite(ctx, 50, 100, COLORS, '23',
      { heightIn: 79, dribbling: { phase: 0.05, side: 1, crossing: true, through: through } });
    return out.join('|');
  }
  assert.notStrictEqual(trace(0), trace(1), 'opening the stance draws nothing different');
  console.log('checkOnlyTheLegsMoveGoesThroughTheLegs: OK (peak ' + peak.toFixed(2) +
    ', worst step ' + worst.toFixed(2) + ')');
}

function checkTempoRespondsToSkillAndPressure() {
  const id = 'p42';
  const base = motion.dribbleTempoFor(id);
  // A better handler is quicker; a pressured one is quicker still.
  assert.ok(motion.handlerTempo(id, 95, 0) < motion.handlerTempo(id, 40, 0),
    'an elite handler does not dribble quicker than a poor one');
  assert.ok(motion.handlerTempo(id, 50, 1) < motion.handlerTempo(id, 50, 0),
    'being picked up does not quicken the dribble');
  // ...but neither may swamp the per-player identity, and nothing may invert
  // the period. A tempo at or below zero would divide by zero in the clock.
  [30, 50, 70, 95].forEach(function (h) {
    [0, 0.5, 1].forEach(function (p) {
      const t = motion.handlerTempo(id, h, p);
      assert.ok(t > 0.5 && t < 1.5, 'tempo out of sane range: ' + t);
      assert.ok(Math.abs(t - base) < 0.3, 'situation swamped the player: ' + t + ' vs ' + base);
    });
  });
  // Pressure is a ramp, not a cliff — a defender crossing an invisible line
  // must not change the dribble's rhythm on one frame.
  let worst = 0, prev = motion.pressureFrom(100);
  for (let d = 100; d >= 0; d -= 1) {
    const v = motion.pressureFrom(d);
    worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(worst < 0.1, 'pressure steps ' + worst.toFixed(2) + ' for one pixel of closing');
  assert.strictEqual(motion.pressureFrom(999), 0, 'a defender across the court is pressure');
  assert.strictEqual(motion.pressureFrom(0), 1, 'a defender on his hip is not full pressure');
  console.log('checkTempoRespondsToSkillAndPressure: OK (elite+pressed ' +
    motion.handlerTempo(id, 95, 1).toFixed(3) + ' vs poor+free ' +
    motion.handlerTempo(id, 40, 0).toFixed(3) + ')');
}

function checkEveryDunkRouteEndsAtTheRim() {
  // A dunk finishes with the ball at the rim, and the view hands it off to the
  // slam on the last frame of the route. Written by hand the routes did NOT
  // converge — the windmill's circle came back to up=25 side=0, below the rim
  // and on the wrong side of him, and the double clutch overshot to 40. Both
  // would put a jump at the exact moment the eye is on the hoop.
  dunks.DUNK_PATH_NAMES.forEach(function (name) {
    const end = dunks.dunkBallPath(name, 1);
    assert.ok(Math.abs(end.up - dunks.DUNK_TERMINAL.up) < 0.01 &&
              Math.abs(end.side - dunks.DUNK_TERMINAL.side) < 0.01,
      name + ' ends at (' + end.up.toFixed(1) + ',' + end.side.toFixed(1) +
      ') instead of the rim');
    assert.ok(Math.abs(end.back || 0) < 0.01, name + ' finishes behind him');
    // ...and starts IN HIS HANDS. This was `start.up < 14`, a one-sided bound
    // that was written to catch a route beginning too high and was therefore
    // perfectly happy with `power`, `straight`, `tomahawk` and `double` all
    // beginning at 0.0 — the ball on the FLOOR. He never picked it up: it lay
    // at his feet through the whole gather and the whole plant and only left
    // the ground once he was already climbing. Bounded both ways now.
    const start = dunks.dunkBallPath(name, 0);
    assert.ok(Math.abs(start.up - dunks.DUNK_ORIGIN.up) < 0.01,
      name + ' starts ' + start.up.toFixed(1) + 'px up, not in his hands at ' +
      dunks.DUNK_ORIGIN.up);
  });
  console.log('checkEveryDunkRouteEndsAtTheRim: OK (' + dunks.DUNK_PATH_NAMES.length +
    ' routes, all from ' + dunks.DUNK_ORIGIN.up + 'px up)');
}

function checkEveryDunkFinishesAtTheSameRim() {
  // A rim is at a fixed height. The terminal used to be measured from his FEET,
  // which quietly meant the hoop moved with him: the ball finished 40px above
  // the floor on a quickTwo and 48px on a threeSixtyWindmill, an 8px spread —
  // a third of a body — on the one thing in the building that cannot move.
  //
  // Solved against the floor now, so this asserts the whole catalogue lands on
  // one number, and that his HAND gets there too. A ball at the rim on the end
  // of an arm that stops 4px short is not a dunk, it is a ball floating.
  const heights = [];
  dunks.DUNKS.forEach(function (d) {
    const beats = dunks.dunkBeats(d, {});
    const marks = dunks.dunkRouteMarks(beats);
    // The slam is where the ball is handed to the rim, and he is already coming
    // down by then — so the finishing foot is the slam's, not the peak.
    const kfs = [{ t: 0, dunk: { phase: 'hang', id: 'p1', dunk: d, route: marks.hang, tall: 0 } },
                 { t: beats.slam, dunk: { phase: 'slam', id: 'p1', dunk: d, route: 1, tall: 0 } }];
    const lifts = motion.resolveLifts(kfs[0], kfs[1], 1, false);
    const ball = dunks.dunkBallPath(d.path, lifts.dunkerRoute, lifts.dunkerFoot);
    heights.push({ id: d.id, up: lifts.dunkerFoot + ball.up, foot: lifts.dunkerFoot });
    // Reach: the hand tops out `tall + 6` above the feet on a 6'7" body, and the
    // arm may stretch a bounded few px to meet the ball. MIN_DUNK_LIFT is what
    // keeps that stretch inside the bound, so assert the catalogue honours it.
    assert.ok(d.lift >= dunks.MIN_DUNK_LIFT,
      d.id + ' leaps ' + d.lift + 'px, under the ' + dunks.MIN_DUNK_LIFT +
      'px a fixed rim can be reached from — it would finish under the hoop');
  });
  const ups = heights.map(function (h) { return h.up; });
  const spread = Math.max.apply(null, ups) - Math.min.apply(null, ups);
  assert.ok(spread < 0.01,
    'the rim moves: dunks finish between ' + Math.min.apply(null, ups).toFixed(1) +
    'px and ' + Math.max.apply(null, ups).toFixed(1) + 'px above the floor');
  assert.ok(Math.abs(ups[0] - dunks.RIM_ABOVE_FLOOR) < 0.01,
    'dunks finish at ' + ups[0].toFixed(1) + ', not at the stated rim of ' +
    dunks.RIM_ABOVE_FLOOR);
  console.log('checkEveryDunkFinishesAtTheSameRim: OK (' + heights.length +
    ' dunks, all at ' + dunks.RIM_ABOVE_FLOOR + 'px, feet ' +
    Math.min.apply(null, heights.map(function (h) { return h.foot; })) + '-' +
    Math.max.apply(null, heights.map(function (h) { return h.foot; })) + 'px)');
}

function checkTheHandMeetsTheBall() {
  // The arm now stretches to wherever the ball is, because with a fixed rim the
  // ball is no longer a fixed distance above his feet. Test the thing that
  // actually matters: the drawn hand and the drawn ball are in the same place,
  // across the height range — a 7'7" centre has to come DOWN to the rim and a
  // 6'0" guard is at full stretch.
  let worst = 0, worstAt = '';
  [72, 79, 91].forEach(function (heightIn) {
    dunks.DUNKS.forEach(function (d) {
      // The leap compensates for height — a shorter man has to jump higher to
      // reach the same rim — so the foot is solved the way resolveLifts does.
      const tall = sprites.spriteTallness(heightIn);
      const foot = Math.round((d.lift - tall) * 0.82);
      const ballUp = dunks.dunkBallPath(d.path, 1, foot).up;
      // Where the sprite puts the top of the reaching arm, in px above the feet.
      const hand = sprites.dunkHandHeight(heightIn, ballUp);
      const gap = Math.abs(hand - ballUp);
      if (gap > worst) { worst = gap; worstAt = d.id + '@' + heightIn + '"'; }
    });
  });
  // Within a pixel. The ball is 3px, so a 1px offset still overlaps the hand;
  // 2px and it is visibly hanging off the end of his fingers.
  assert.ok(worst <= 1.0,
    'the ball is ' + worst.toFixed(1) + 'px off his hand on ' + worstAt);
  console.log('checkTheHandMeetsTheBall: OK (worst gap ' + worst.toFixed(1) +
    'px across 3 heights x ' + dunks.DUNKS.length + ' dunks)');
}

function checkHePicksTheBallUpBeforeHeLeavesTheFloor() {
  // Two blends used to fight over the ball at the takeoff. The windup carried it
  // up from the dribble into his hands; then the first frame of the rise took a
  // different branch that re-blended FROM THE DRIBBLE weighted `t/0.25`, which
  // at t just above zero is nearly all dribble — so the ball fell 5px back out
  // of his hands at the exact instant his feet left the floor, and climbed the
  // same 5px again.
  //
  // The handover is continuous by construction now: the gather finishes at the
  // route's own origin, and the route starts there. This asserts both halves of
  // that sentence, because either one drifting re-opens the gap.
  assert.strictEqual(motion.dunkGatherProgress('plant', 1), 1,
    'the gather does not finish by the end of the plant — he is still collecting the ball as he leaves the floor');
  assert.strictEqual(motion.dunkGatherProgress('rise', 0), 1,
    'the rise does not start with the ball already gathered');
  // ...and it must be MONOTONIC through the windup, or the ball bobs in his
  // hands while he is loading up.
  let prev = -1;
  [['gather', 0], ['gather', 0.5], ['gather', 1], ['plant', 0], ['plant', 0.5], ['plant', 1]]
    .forEach(function (step) {
      const g = motion.dunkGatherProgress(step[0], step[1]);
      assert.ok(g >= prev, 'the gather goes backwards at ' + step[0] + ' ' + step[1]);
      prev = g;
    });
  // The destination is the route's origin, for every route and every leap.
  dunks.DUNK_PATH_NAMES.forEach(function (name) {
    for (let foot = 0; foot <= 21; foot++) {
      const start = dunks.dunkBallPath(name, 0, foot);
      assert.ok(Math.abs(start.up - dunks.DUNK_ORIGIN.up) < 0.01,
        name + ' at foot ' + foot + ' starts at ' + start.up.toFixed(1) +
        ', so the gather hands the ball over to somewhere it is not');
    }
  });
  console.log('checkHePicksTheBallUpBeforeHeLeavesTheFloor: OK (gather ends at the origin ' +
    'for ' + dunks.DUNK_PATH_NAMES.length + ' routes x 22 leaps)');
}

function checkTheHandGoesUpWithTheBallAndStaysThere() {
  // The arm used to sweep on the POSE's clock, which starts during the gather —
  // so it was fully overhead while the ball was still at his chest and he spent
  // the whole rise reaching at nothing. Rendered frame by frame it read as a
  // pole beside his head rather than as an arm holding a basketball.
  //
  // Driving it off the ball's LIVE height is the opposite failure: a windmill's
  // ball swings down and round, and the arm pumped with it. So it follows the
  // running maximum, and this asserts both halves — it starts where the ball
  // starts, and it never retreats.
  assert.strictEqual(sprites.DUNK_CARRY_UP, dunks.DUNK_ORIGIN.up,
    'the sprite carries the ball at ' + sprites.DUNK_CARRY_UP + ' but the routes start it at ' +
    dunks.DUNK_ORIGIN.up + ' — the arm leaves the carry at a different moment than the ball does');
  let worstFall = 0, fellOn = '';
  dunks.DUNK_PATH_NAMES.forEach(function (name) {
    [11, 15, 21].forEach(function (foot) {
      let prev = null;
      for (let t = 0; t <= 1.0001; t += 1 / 120) {
        const h = dunks.dunkArmHeight(name, t, foot);
        if (prev !== null && h < prev - 1e-9) {
          const fall = prev - h;
          if (fall > worstFall) { worstFall = fall; fellOn = name + '@foot' + foot; }
        }
        prev = h;
      }
      assert.ok(Math.abs(dunks.dunkArmHeight(name, 0, foot) - dunks.DUNK_ORIGIN.up) < 0.01,
        name + ' starts its arm somewhere other than the carry position');
      // ...and arrives at the rim, or the hand stops short of the finish.
      assert.ok(Math.abs(dunks.dunkArmHeight(name, 1, foot) -
        (dunks.RIM_ABOVE_FLOOR - foot)) < 0.01,
        name + ' does not finish its arm at the rim');
    });
  });
  assert.strictEqual(worstFall, 0,
    'the dunking arm drops ' + worstFall.toFixed(2) + 'px mid-flight on ' + fellOn +
    ' — that is the pump the envelope exists to prevent');
  console.log('checkTheHandGoesUpWithTheBallAndStaysThere: OK (' +
    dunks.DUNK_PATH_NAMES.length + ' routes x 3 leaps, never retreats)');
}

function checkNoTwoDunkRoutesAreTheSameRoute() {
  // The brief's central rule: no copy/paste variations. Two routes that never
  // separate by more than a body width are one route with two names.
  //
  // This caught `straight`, which differed from `power` only in amplitude and
  // separated by 0.7px across the whole flight. It differs in TIME now.
  const names = dunks.DUNK_PATH_NAMES;
  const traces = {};
  names.forEach(function (n) {
    const tr = [];
    for (let t = 0; t <= 1.0001; t += 1 / 120) tr.push(dunks.dunkBallPath(n, t));
    traces[n] = tr;
  });
  let closest = Infinity, pair = '';
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      let m = 0;
      for (let k = 0; k < traces[names[i]].length; k++) {
        const a = traces[names[i]][k], b = traces[names[j]][k];
        m = Math.max(m, Math.hypot(a.up - b.up, a.side - b.side));
      }
      if (m < closest) { closest = m; pair = names[i] + '/' + names[j]; }
    }
  }
  // A body is 10px wide. Two routes that never get a body width apart are the
  // same route.
  assert.ok(closest >= 5,
    pair + ' never separate by more than ' + closest.toFixed(1) + 'px — same route, two names');
  console.log('checkNoTwoDunkRoutesAreTheSameRoute: OK (closest pair ' + pair +
    ' at ' + closest.toFixed(1) + 'px)');
}

function checkTheBallStaysReadableThroughEveryDunk() {
  // The ball is 3px. Measured against each dunk's OWN beats, because the beat
  // lengths exist precisely to keep the elaborate routes readable — a windmill
  // sweeping an 11px circle through a power dunk's 145ms beat moves 4.7px a
  // frame, which is not a circle, it is a smear.
  let worst = 0, worstId = '';
  dunks.DUNKS.forEach(function (d) {
    const beats = dunks.dunkBeats(d, {});
    const marks = dunks.dunkRouteMarks(beats);
    const segs = [['rise', 0, marks.rise, beats.rise],
                  ['hang', marks.rise, marks.hang, beats.hang],
                  ['slam', marks.hang, 1, beats.slam]];
    // WITH the foot, because that is the path the game draws. Called without it
    // the route falls back to a terminal measured from his feet — a shorter
    // climb than the real one — so the check was reporting a path nobody sees
    // and was blind by up to a pixel a frame. Same failure as calling a seeded
    // function without its seed.
    const footAt = function (t) {
      const table = { rise: d.lift, hang: d.lift, slam: Math.round(d.lift * 0.82) };
      if (t <= marks.rise) return Math.round(d.lift * (1 - Math.pow(1 - t / Math.max(1e-6, marks.rise), 2)));
      if (t <= marks.hang) return table.hang;
      return Math.round(table.hang + (table.slam - table.hang) *
        Math.pow((t - marks.hang) / Math.max(1e-6, 1 - marks.hang), 1.6));
    };
    segs.forEach(function (seg) {
      const frames = Math.max(1, seg[3] / (1000 / 60));
      for (let k = 0; k < frames; k++) {
        const t1 = seg[1] + (seg[2] - seg[1]) * (k / frames);
        const t2 = seg[1] + (seg[2] - seg[1]) * ((k + 1) / frames);
        const a = dunks.dunkBallPath(d.path, t1, footAt(t1));
        const b = dunks.dunkBallPath(d.path, t2, footAt(t2));
        const step = Math.hypot(b.up - a.up, b.side - a.side);
        if (step > worst) { worst = step; worstId = d.id + '/' + seg[0]; }
      }
    });
  });
  // A slam is the fastest ball motion in the game and gets more room than the
  // 3.2px/frame the dribble moves run to — but not unbounded. Past about five
  // the ball stops being an object and becomes a flicker between two places.
  assert.ok(worst < 4.6,
    'the ball moves ' + worst.toFixed(2) + 'px in one frame during ' + worstId);
  console.log('checkTheBallStaysReadableThroughEveryDunk: OK (worst ' +
    worst.toFixed(2) + 'px/frame, ' + worstId + ')');
}

function checkDunkSelectionRespectsItsContext() {
  // Section 16's rule: never pick an animation that does not make sense here.
  for (let seed = 0; seed < 400; seed++) {
    // A man going through a body does not windmill.
    const c = dunks.pickDunk({ tier: 4, contact: true }, seed);
    assert.ok(!c.spin && !c.reverse, 'a contact dunk rotated: ' + c.id);
    assert.ok(c.path !== 'windmill' && c.path !== 'eastbay' && c.path !== 'double',
      'a contact dunk took an elaborate route: ' + c.id);
    // A putback is caught and finished in one motion.
    const p = dunks.pickDunk({ tier: 4, putback: true }, seed);
    assert.ok(!p.spin, 'a putback rotated: ' + p.id);
    // An alley-oop is caught in the air — nothing that starts below the waist.
    const a = dunks.pickDunk({ tier: 4, alley: true }, seed);
    assert.ok(a.path !== 'eastbay' && a.path !== 'double' && !a.reverse,
      'an alley-oop used a route that starts at the floor: ' + a.id);
    // A standing finish has no runway to carry anything elaborate.
    const s = dunks.pickDunk({ tier: 4, runway: 5 }, seed);
    assert.ok(s.quick || s.path === 'power' || s.path === 'straight',
      'a standing dunk got a running route: ' + s.id);
    // Nobody is handed a dunk above his tier.
    const low = dunks.pickDunk({ tier: 0 }, seed);
    assert.strictEqual(low.tier || 0, 0, 'a poor leaper got ' + low.id);
  }
  // ...and he never throws the same dunk twice running when another exists.
  for (let seed = 0; seed < 400; seed++) {
    const first = dunks.pickDunk({ tier: 4 }, seed);
    const second = dunks.pickDunk({ tier: 4, lastId: first.id }, seed);
    assert.notStrictEqual(second.id, first.id, 'repeated ' + first.id + ' back to back');
  }
  console.log('checkDunkSelectionRespectsItsContext: OK (400 seeds x 5 contexts)');
}

function checkTheCatalogueIsInternallyHonest() {
  const ids = {};
  dunks.DUNKS.forEach(function (d) {
    assert.ok(!ids[d.id], 'duplicate dunk id ' + d.id);
    ids[d.id] = true;
    assert.ok(dunks.DUNK_PATHS[d.path], d.id + ' names a route that does not exist: ' + d.path);
    assert.ok(d.hands === 1 || d.hands === 2, d.id + ' has ' + d.hands + ' hands');
    assert.ok(d.takeoff === 'one' || d.takeoff === 'two', d.id + ' has no takeoff foot');
    assert.ok(d.lift > 0 && d.lift <= 22, d.id + ' leaps ' + d.lift + 'px');
    assert.ok(d.hang > 0, d.id + ' does not hang at all');
    // Every dunk must be reachable by somebody, or it is dead weight in a table
    // that exists to be varied.
    const pool = dunks.dunkPool({ tier: 4 });
    assert.ok(pool.indexOf(d) !== -1 || d.tier > 4, d.id + ' can never be selected');
  });
  // The lift table must never put the feet through the floor at the peak, and
  // the plant must be the DEEPEST point of the load — that is what makes it a
  // plant rather than a second gather.
  dunks.DUNKS.forEach(function (d) {
    const t = motion.dunkLiftTable(d);
    assert.ok(t.plant < t.gather, d.id + ' plants no deeper than it gathers');
    assert.ok(t.rise === t.hang, d.id + ' changes height through its hang');
    assert.ok(t.slam < t.rise, d.id + ' is still rising as it goes through the rim');
    assert.strictEqual(t.land, 0, d.id + ' lands off the floor');
  });
  console.log('checkTheCatalogueIsInternallyHonest: OK (' + dunks.DUNKS.length + ' entries)');
}

function checkPosesStayWithinTheSpriteBox() {
  // Every pose, at every height, has to stay inside the footprint the court
  // draw order and the collision separator assume. A pose that reaches three
  // body widths sideways would overlap the man being guarded.
  // Airborne poses tuck their legs relative to the shoulders rather than to the
  // floor, so a short player's trail leg can hang a pixel or two below the
  // anchor. That is correct for a body in the air — the anchor is where his
  // feet WOULD be, not a surface he is standing on — so they get their own
  // allowance. A grounded pose has no such excuse: it is standing on the floor
  // the shadow is drawn at.
  const POSES = [
    { p: {}, air: false }, { p: { moving: true }, air: false },
    { p: { shooting: true }, air: false }, { p: { following: true, facing: 1 }, air: false },
    { p: { dunking: true, facing: 1 }, air: true }, { p: { dunking: true, facing: -1 }, air: true },
    { p: { layup: { side: 1, extend: 1 } }, air: true },
    { p: { layup: { side: -1, extend: 0.5 } }, air: true },
    { p: { stumbling: true }, air: false }, { p: { crouch: 5 }, air: false },
    { p: { crouch: 3, lean: 2 }, air: false },
    { p: { dribbling: { phase: 0.5, side: 1, crossing: true }, lean: -2 }, air: false }
  ];
  HEIGHTS.forEach(function (h) {
    POSES.forEach(function (row) {
      const pose = row.p;
      const opts = Object.assign({ heightIn: h }, pose);
      const b = spriteBounds(opts);
      const floor = 100 + (row.air ? 3 : 0);
      assert.ok(b.foot <= floor,
        'a pose drew below the feet by ' + (b.foot - 100) + 'px: ' + JSON.stringify(pose));
      assert.ok(b.left >= 50 - 12 && b.right <= 50 + 12,
        'a pose reached outside the sprite box: ' + JSON.stringify(pose) +
        ' -> [' + b.left + ',' + b.right + ']');
      assert.ok(b.top >= 100 - 40, 'a pose reached absurdly high: ' + JSON.stringify(pose));
    });
  });
  console.log('checkPosesStayWithinTheSpriteBox: OK (' +
    (POSES.length * HEIGHTS.length) + ' pose/height combinations)');
}

checkACrouchNeverSinksThePlayer();
checkTheCrouchFoldsAtBothJoints();
checkALandingCompressesThenRecovers();
checkTheLayupIsStillInTheAirWhenTheBallLeaves();
checkTheGatherBendsRatherThanSinks();
checkTheDescentRunsOnRealTimeNotBeatProgress();
checkEveryLeapIsSeenToLand();
checkTheWeightFollowsTheBallAndNeverTeleports();
checkALeanNeverMovesTheFeet();
checkTheLayupPoseIsItsOwnSilhouette();
checkOnlyOnePoseCanEverWin();
checkTheCatalogueIsInternallyHonest();
checkEveryDunkRouteEndsAtTheRim();
checkHePicksTheBallUpBeforeHeLeavesTheFloor();
checkTheHandGoesUpWithTheBallAndStaysThere();
checkEveryDunkFinishesAtTheSameRim();
checkTheHandMeetsTheBall();
checkNoTwoDunkRoutesAreTheSameRoute();
checkTheBallStaysReadableThroughEveryDunk();
checkDunkSelectionRespectsItsContext();
checkTheThreeLayupFinishesAreThreeDifferentPictures();
checkContactIsRareAndDecays();
checkOnlyTheLegsMoveGoesThroughTheLegs();
checkTempoRespondsToSkillAndPressure();
checkPosesStayWithinTheSpriteBox();
console.log('All pixel posture validations passed');
