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
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

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
  // ACROSS ALL FOUR LANDING STYLES, not just the default. The styles multiply
  // the depth, so testing the unstyled curve alone measures a landing the game
  // only sometimes draws — the same blindness as calling a route without the
  // foot, and `heavy` is 35% deeper than the number this check used to see.
  let worstIn = 0, worstOut = 0, worstStyle = '';
  Object.keys(motion.LANDING_STYLE).forEach(function (style) {
    for (let ms = 0; ms < motion.LANDING_TOTAL_MS * 2 + 60; ms += 1000 / 60) {
      const a = motion.landingSquash(ms, 'dunk', style);
      const b = motion.landingSquash(ms + 1000 / 60, 'dunk', style);
      const step = Math.abs(b - a);
      if (ms < motion.LANDING_COMPRESS_MS) {
        if (step > worstIn) { worstIn = step; worstStyle = style; }
      } else worstOut = Math.max(worstOut, step);
    }
  });
  assert.ok(worstIn <= 2.4,
    'the landing impact steps ' + worstIn.toFixed(2) + 'px in one frame on a ' + worstStyle +
    ' landing, past the accent budget');
  assert.ok(worstOut < 0.7,
    'the landing RECOVERY steps ' + worstOut.toFixed(2) + 'px in one frame — that is a stutter, not a settle');
  assert.ok(worstIn > worstOut,
    'the landing recovers faster than it compresses, so it reads as a bounce');
  const worst = worstIn;

  // A dunk lands harder than a pull-up.
  assert.ok(motion.landingSquashPx('dunk') > motion.landingSquashPx('jump'),
    'a dunk lands no harder than a jump shot');
  // ...and the four have to actually be four. A landing table whose entries all
  // land the same depth is one landing with four names.
  const depths = Object.keys(motion.LANDING_STYLE).map(function (st) {
    return motion.landingSquashPx('dunk', st);
  }).sort(function (a, b) { return a - b; });
  assert.ok(depths[depths.length - 1] - depths[0] >= 2,
    'the deepest and shallowest landings differ by ' +
    (depths[depths.length - 1] - depths[0]).toFixed(1) + 'px — that is one landing, four names');
  assert.strictEqual(motion.landingLean(0, 'dunk', 'balance', 1), 0,
    'a balanced landing staggers');
  assert.ok(Math.abs(motion.landingLean(80, 'dunk', 'stumble', 1)) > 1,
    'a stumble does not stagger');
  console.log('checkALandingCompressesThenRecovers: OK (peak ' + peak +
    'px, impact ' + worst.toFixed(2) + 'px/frame on a ' + worstStyle +
    ' landing, settle ' + worstOut.toFixed(2) + 'px/frame, depths ' +
    depths[0].toFixed(1) + '-' + depths[depths.length - 1].toFixed(1) + 'px)');
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
  // Every flag in POSE_ORDER, not a hand-kept subset — the list drifted the
  // moment `defending` was added and the check went on passing over 128
  // combinations of the seven it still knew about.
  const FLAGS = motion.POSE_ORDER.filter(function (n) { return n !== 'idle'; });
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

function checkTheApproachIsFootworkAndNotAHop() {
  // The euro step and the spin finish did not exist — a layup began at the
  // gather, so every finish in the league was a man who arrived at the rim
  // already going up with nothing showing how he got past anybody.
  //
  // Both are FLOOR moves, and that is the property worth pinning: the moment
  // either one leaves the ground it stops being footwork and becomes a jump,
  // which is a different move that already exists.
  // "Never leaves the floor" was the first version of this rule and it was too
  // blunt: it failed the pro-hop, which leaves the floor BY DEFINITION — that
  // is the difference between a hop and a step. The property that actually
  // matters is that an approach stays LOW, well under the layup it hands over
  // to, so it never competes with the finish for the same beat.
  const APPROACH_CEILING = Math.round(motion.CLOSE_LIFT.rise / 2);
  Object.keys(motion.APPROACH_LIFT).forEach(function (phase) {
    assert.ok(motion.APPROACH_LIFT[phase] <= APPROACH_CEILING,
      phase + ' rises ' + motion.APPROACH_LIFT[phase] + 'px, past the ' +
      APPROACH_CEILING + 'px an approach may use before it is a jump');
    assert.strictEqual(motion.approachLiftAt({ close: { phase: phase } }),
      motion.APPROACH_LIFT[phase], phase + ' is not routed to the approach table');
  });
  // Exactly one of them may leave the ground, and it has to be the hop.
  const airborne = Object.keys(motion.APPROACH_LIFT).filter(function (p) {
    return motion.APPROACH_LIFT[p] > 0;
  });
  assert.deepStrictEqual(airborne, ['hopGather'],
    'the approaches that leave the floor are ' + JSON.stringify(airborne) +
    ' — only the pro-hop is a hop');

  // ...and a normal finish must be untouched by any of it.
  ['gather', 'rise', 'release', 'land'].forEach(function (phase) {
    assert.strictEqual(motion.approachLiftAt({ close: { phase: phase } }), null,
      phase + ' was captured by the approach table — the ordinary layup has changed');
  });

  // THE SPIN'S ROTATION STARTS IN THE LEGS. Section 14's rule, and the thing
  // that separates a man turning from a sprite being flipped: give the legs and
  // the torso the same number and every part rotates on one frame.
  let sawLead = false;
  for (let u = 0; u <= 1.0001; u += 1 / 60) {
    const t = motion.spinTurn(u);
    assert.ok(t.legs >= t.torso - 1e-9,
      'the torso is ahead of the legs at u=' + u.toFixed(2) + ' — the spin is being led from the wrong end');
    if (t.legs - t.torso > 0.05) sawLead = true;
  }
  assert.ok(sawLead, 'the legs never actually lead the torso — the offset is too small to draw');
  assert.strictEqual(motion.spinTurn(1).torso, 1, 'the torso never finishes the turn');

  // A turn on a 10px body is four states, and the back-of-the-head frame is what
  // sells it. Without one, a spin is a sprite flipping.
  let backs = 0, flips = 0, prev = motion.turnFacing(0, 1).facing;
  for (let u = 0; u <= 1.0001; u += 1 / 120) {
    const s = motion.turnFacing(u, 1);
    if (s.back) backs++;
    if (s.facing !== prev) { flips++; prev = s.facing; }
  }
  assert.ok(backs > 0, 'a full turn never shows his back');
  assert.strictEqual(flips, 2, 'a full turn flips ' + flips + ' times instead of twice');
  assert.strictEqual(motion.turnFacing(1, 1).facing, 1,
    'he does not come out of a 360 facing the way he went in');

  // THE STEPS HAVE TO GO SOMEWHERE. A euro whose second step does not end
  // closer to the rim than its first is a sideways shuffle.
  [1, -1].forEach(function (away) {
    const one = choreo.approachStep('euro', 0, away);
    const two = choreo.approachStep('euro', 1, away);
    assert.ok(one[1] * away < 0, 'the euro first step goes TOWARD the rim — there is no lie in it');
    assert.ok(two[1] * away > 0, 'the euro second step does not commit to the rim');
    assert.ok(Math.abs(two[1]) > Math.abs(one[1]),
      'the euro second step is not the long one');
  });
  // ...AND BOTH HAVE TO ACTUALLY FIRE. The alley-oop's pool rules have sat in
  // this codebase as dead code since they were written because nothing ever
  // detects one, and the first version of this selector shipped the same way:
  // it gated the spin on there being no lateral room, which is true of the move
  // and true of almost no possessions, so it fired 11 times against the euro's
  // 79. A move that never plays is not an animation.
  const KINDS = ['euro', 'spin', 'hop', 'switch'];
  const seen = { euro: 0, spin: 0, hop: 0, switch: 0, none: 0 };
  for (let seed = 0; seed < 4000; seed++) {
    const wide = seed % 3 !== 0;      // roughly the mix real finishes produce
    const got = choreo.approachFor({ defended: true, lateral: wide ? 9 : 2,
      finish: 'standard' }, seed);
    seen[got || 'none']++;
  }
  KINDS.forEach(function (k) {
    assert.ok(seen[k] > 150,
      'the ' + k + ' fires ' + seen[k] + ' times in 4000 — effectively never. ' +
      'This has now happened twice: the spin shipped tight-only and played 11 ' +
      'times against the euro 79, and the hand-switch shipped the same way and ' +
      'played twice in eight games.');
    // ...and each has to be its own move on the floor, not a relabelling.
    const one = choreo.approachStep(k, 0, 1), two = choreo.approachStep(k, 1, 1);
    assert.ok(Math.hypot(two[0] - one[0], two[1] - one[1]) >= 3,
      k + ' barely moves between its two beats');
    assert.strictEqual(choreo.approachBeats(k).length, 2,
      k + ' does not have two beats');
  });
  // No two of them may walk the same path, or they are one move with four names.
  for (let i = 0; i < KINDS.length; i++) {
    for (let j = i + 1; j < KINDS.length; j++) {
      const a = choreo.approachStep(KINDS[i], 1, 1), b = choreo.approachStep(KINDS[j], 1, 1);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 2,
        KINDS[i] + ' and ' + KINDS[j] + ' finish in the same place');
    }
  }
  assert.ok(seen.none > 1600,
    'an approach fires on ' + (100 - seen.none / 40).toFixed(0) +
    '% of finishes — that is a new default, not variety');
  console.log('checkTheApproachIsFootworkAndNotAHop: OK (' +
    Object.keys(motion.APPROACH_LIFT).length + ' phases, legs lead by ' +
    (motion.SPIN_TORSO_LAG * 100).toFixed(0) + '% of the turn, ' +
    KINDS.map(function (k) { return k + ' ' + (seen[k] / 40).toFixed(0) + '%'; }).join(' / ') + ')');
}

function checkTheAlleyOopIsCaughtInTheAir() {
  // `dunkPool` has known how to filter for an alley-oop since it was written and
  // NOTHING EVER SET THE FLAG — the branch has been dead code, and the plan doc
  // said so. The reason it stayed dead is that an oop is not a pose, it is a
  // ball that is somewhere else: he cannot be holding it through the gather.
  //
  // So the property worth pinning is the one that was missing: the route does
  // not start until he catches it. An oop whose route runs from the gather is a
  // man carrying a ball he has not been thrown yet.
  const marks = { gather: 0, plant: 0, rise: 0, hang: 0, slam: 1, land: 1 };
  ['gather', 'plant', 'rise', 'hang'].forEach(function (phase) {
    assert.strictEqual(marks[phase], 0,
      'an oop is already moving the ball at ' + phase + ', before it reaches him');
  });
  assert.strictEqual(marks.slam, 1, 'an oop never finishes its route');

  // The pool has to actually honour the flag now that something sets it. These
  // are the routes that start below the waist or need a windup — a man catching
  // a lob has neither the ball nor the time.
  for (let seed = 0; seed < 400; seed++) {
    const a = dunks.pickDunk({ tier: 4, alley: true }, seed);
    assert.ok(a.path !== 'eastbay' && a.path !== 'double',
      'an oop took a route that starts at the floor: ' + a.id);
    assert.ok(!a.reverse, 'an oop finished reverse: ' + a.id);
  }
  // ...and it must be RARE. Every assisted dunk becoming an oop is a new
  // default, which is the failure this whole pass is about.
  assert.ok(choreo.ALLEY_RATE > 0 && choreo.ALLEY_RATE <= 0.35,
    'the alley-oop rate is ' + choreo.ALLEY_RATE + ' — an oop is a highlight, not a default');
  assert.ok(choreo.ALLEY_MIN_PASS >= 10,
    'an oop fires on a ' + choreo.ALLEY_MIN_PASS + '-unit pass, which is a handoff');
  console.log('checkTheAlleyOopIsCaughtInTheAir: OK (route starts at the catch, ' +
    (choreo.ALLEY_RATE * 100) + '% of assisted dunks past ' + choreo.ALLEY_MIN_PASS + ' units)');
}

function checkAContactDunkIsHitAndKeepsGoing() {
  // `contact` has been stamped on every keyframe of every dunk string and read
  // by nobody. A dunk THROUGH a man was drawn exactly like a dunk past nobody,
  // with a floor shove played on the beat before it.
  //
  // Section 10's sequence is takeoff -> contact -> compression -> CONTINUED
  // elevation, and the last part is what makes it a contact dunk rather than a
  // blocked shot. So: the climb must visibly suffer, and it must still finish.
  const d = dunks.DUNKS.find(function (x) { return x.id === 'oneHandPower'; });
  function climb(hit) {
    const a = { t: 0, dunk: { phase: 'plant', id: 'p', dunk: d, route: 0, tall: 0, contact: hit } };
    const b = { t: 145, dunk: { phase: 'rise', id: 'p', dunk: d, route: 0.5, tall: 0, contact: hit } };
    const out = [];
    for (let k = 0; k <= 12; k++) out.push(motion.resolveLifts(a, b, k / 12, false).dunkerFoot);
    return out;
  }
  const clean = climb(false), hit = climb(true);
  assert.strictEqual(clean[clean.length - 1], hit[hit.length - 1],
    'a contact dunk finishes ' + (clean[clean.length - 1] - hit[hit.length - 1]) +
    'px lower — that is a block, not a contact dunk');
  let held = 0;
  for (let i = 0; i < clean.length; i++) held = Math.max(held, clean[i] - hit[i]);
  assert.ok(held >= 2, 'the contact only costs him ' + held + 'px — it does not read');
  // ...and it must not become a step. He is checked, not stopped dead.
  let worst = 0;
  for (let i = 1; i < hit.length; i++) worst = Math.max(worst, Math.abs(hit[i] - hit[i - 1]));
  assert.ok(worst <= 4, 'the contact check steps ' + worst + 'px in one frame');
  // It only applies to the climb. A check on the hang or the slam would be the
  // rim moving, not a defender.
  ['hang', 'slam', 'land', 'gather', 'plant'].forEach(function (phase) {
    assert.strictEqual(motion.contactCheck(phase, 0.45, true), 0,
      'the contact check fires on the ' + phase + ', where there is nothing to run into');
  });
  // ...and the thing that decides WHETHER it fires has to be reachable. The
  // clause that was meant to catch "defended at the rim" read
  // `onBall && ev.zone === 'inside'` while `onBall` was itself defined as
  // `... && ev.zone !== 'inside'` — a contradiction, dead from the day it was
  // written, and the reason every contact dunk in the game came from the poster
  // marker alone. It keys off the nearest opponent now, which is measurable.
  const five = ['a', 'b', 'c', 'd', 'e'];
  const near = {}; five.forEach(function (id, i) { near[id] = [100 + i * 40, 0]; });
  assert.strictEqual(choreo.nearestOpponentPx(near, five, [100, 0]), 0,
    'a man standing on the spot is not detected');
  near.a = [200, 0];
  assert.ok(choreo.nearestOpponentPx(near, five, [140, 0]) <= 20,
    'the nearest opponent is not being found');
  assert.strictEqual(choreo.nearestOpponentPx({}, five, [0, 0]), Infinity,
    'an empty floor reports contact');
  assert.strictEqual(choreo.nearestOpponentPx(near, [], [0, 0]), Infinity,
    'contact is detected with nobody on defence');
  console.log('checkAContactDunkIsHitAndKeepsGoing: OK (costs him ' + held +
    'px mid-climb, finishes at the same rim, fires off the nearest body)');
}

function checkTheNewMovesAreNotSilent() {
  // I SHIPPED THESE MUTE. The euro step, the spin and the alley-oop were built
  // with '' in the sound slot of every keyframe, which put three silent moves
  // next to a dunk that squeaks on its own plant and thumps on its own slam.
  // Nothing failed, because no check had an opinion about audio.
  //
  // The property is simple and worth pinning: a move that is footwork makes a
  // footwork sound, and a ball that crosses the lane in the air is heard
  // leaving and heard arriving.
  const voices = require('fs').readFileSync(
    path.join(__dirname, '..', 'ui', 'pixelAudio.js'), 'utf8');
  ['lob', 'catch', 'squeak'].forEach(function (name) {
    assert.ok(voices.indexOf("case '" + name + "'") !== -1,
      "ui/pixelAudio.js has no voice for '" + name + "'");
  });
  const cho = require('fs').readFileSync(
    path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'), 'utf8');
  // The approach beats fire a squeak, the lob fires on the throw and the catch
  // on the hang — the keyframe the ball actually changes hands on.
  assert.ok(/period, quarter, clock, '', '', 'squeak'\)/.test(cho),
    'the approach beats are silent again');
  assert.ok(cho.indexOf("oopFrom ? 'lob' : ''") !== -1,
    'the lob leaves the hand in silence');
  assert.ok(cho.indexOf("oopFrom ? 'catch' : ''") !== -1,
    'the catch is silent — and it is the one that has to land on the hands');
  console.log('checkTheNewMovesAreNotSilent: OK (footwork squeaks, the lob is heard both ends)');
}

function checkTheDefenceIsActuallyGuardingSomebody() {
  // Half of every possession is a man guarding somebody and all of it was drawn
  // with the idle pose and the running pose — the same two shapes as a man on
  // the weak side with nothing to do. Five sprites a team, on screen the whole
  // time: the largest block of unanimated basketball in the game.
  //
  // Three properties, and each of them is a way the first version could have
  // been wrong.
  //
  // DEEPEST ON THE BALL. A man forty feet from the play is standing, not
  // crouching, and drawing him sat down is as wrong as drawing the on-ball
  // defender upright.
  const onBall = motion.defenseStance(8, 0, false);
  const help = motion.defenseStance(45, 0, false);
  const far = motion.defenseStance(motion.DEFEND_FAR_PX + 5, 0, false);
  assert.ok(onBall.depth > help.depth && help.depth > far.depth,
    'the stance does not ease off with distance: ' +
    [onBall.depth, help.depth, far.depth].join(' / '));
  assert.strictEqual(far.depth, 0, 'a man on the far side of the floor is in a stance');
  assert.strictEqual(onBall.depth, 1, 'the on-ball defender is not fully in it');

  // IT RELEASES TO RUN. You do not slide the length of the floor, and a
  // transition defender drawn sliding is worse than one drawn running.
  assert.strictEqual(motion.defenseStance(8, 400, true).depth, 0,
    'a sprinting defender is still in a stance');
  let prev = 1;
  for (let sp = 0; sp <= 120; sp += 5) {
    const d = motion.defenseStance(8, sp, false).depth;
    assert.ok(d <= prev + 1e-9, 'the stance deepens as he speeds up');
    prev = d;
  }

  // A HAND ONLY WHEN THERE IS SOMETHING TO CONTEST, and only from close enough
  // to matter. A permanent hand-up is a pose, not a reaction.
  assert.strictEqual(motion.defenseStance(8, 0, false).contest, 0,
    'he contests a man who is not going up');
  assert.ok(motion.defenseStance(8, 0, true).contest > 0, 'he never contests');
  assert.strictEqual(motion.defenseStance(motion.CONTEST_PX + 10, 0, true).contest, 0,
    'he contests from too far away to bother anybody');

  // ...and the pose has to sit BELOW the ball-handling poses and ABOVE running,
  // or a defender who picks the ball up is still drawn guarding.
  const order = motion.POSE_ORDER;
  assert.ok(order.indexOf('defending') > order.indexOf('dribbling'),
    'a man with the ball can be drawn defending');
  assert.ok(order.indexOf('defending') < order.indexOf('moving'),
    'the stance never wins over running, so it never draws');
  console.log('checkTheDefenceIsActuallyGuardingSomebody: OK (deep on the ball, ' +
    'released by speed, hand up only on a shot)');
}

function checkHeHasAnOpinionAboutHisOwnShot() {
  // A made three and an air ball produced identical body language: the
  // follow-through timed out after the same 520ms either way and he went back
  // to standing. The shooter is the one man on the floor guaranteed to be
  // watching the ball and he was the one man with nothing to say about it.
  //
  // Fixed with TIMING rather than a new pose — section 25's rule — so what this
  // asserts is that the two windows are actually different, and different by
  // enough to see.
  assert.ok(motion.followWindow(true) > motion.followWindow(false),
    'he holds a miss as long as a make');
  assert.ok(motion.followWindow(true) - motion.followWindow(false) >= 300,
    'the two follow-throughs differ by ' +
    (motion.followWindow(true) - motion.followWindow(false)) + 'ms, which is not a tell');

  // The shoulders go on a miss and NOT on a make.
  assert.strictEqual(motion.shotSlump(100, true), 0, 'he slumps after a make');
  assert.ok(motion.shotSlump(120, false) > 0.5, 'he does not slump after a miss');
  assert.strictEqual(motion.shotSlump(motion.SLUMP_MS, false), 0,
    'the slump never lets go, so he stays hunched for the rest of the game');
  assert.strictEqual(motion.shotSlump(-5, false), 0, 'the slump starts before the shot');
  // ...and it must not be a step. It is posture, not an impact.
  let worst = 0;
  for (let ms = 0; ms < motion.SLUMP_MS + 60; ms += 1000 / 60) {
    worst = Math.max(worst, Math.abs(
      motion.shotSlump(ms + 1000 / 60, false) - motion.shotSlump(ms, false)));
  }
  assert.ok(worst < 0.5,
    'the slump steps ' + worst.toFixed(2) + 'px in one frame — that is a flinch, not a shoulder');

  // FATIGUE. Normalised against the range a real game produces (the tiredest
  // man ends around 0.74), because scaling by the nominal 0..1 makes the whole
  // effect a rounding error that draws as nothing.
  assert.strictEqual(motion.fatigueLevel(1), 0, 'a fresh player is drawn tired');
  assert.ok(motion.fatigueLevel(0.74) > 0.8,
    'the tiredest man a game produces reads as only ' +
    motion.fatigueLevel(0.74).toFixed(2) + ' tired');
  assert.strictEqual(motion.energyAt(0.7, 0), 1, 'he tips off already tired');
  assert.ok(Math.abs(motion.energyAt(0.7, 1) - 0.7) < 1e-9,
    'he does not arrive at his final energy by the buzzer');
  assert.ok(motion.energyAt(0.7, 0.5) > motion.energyAt(0.7, 1),
    'fatigue does not grow through the game');
  console.log('checkHeHasAnOpinionAboutHisOwnShot: OK (hold ' +
    motion.followWindow(true) + 'ms made vs ' + motion.followWindow(false) +
    'ms missed, fatigue 0-' + motion.FATIGUE_DROOP_PX + 'px)');
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
    // The stance, at both ends of its range and mid-contest. It is a GROUNDED
    // pose and gets no airborne allowance: a defender is standing on the floor.
    { p: { defending: { depth: 1, contest: 0, side: 1 } }, air: false },
    { p: { defending: { depth: 1, contest: 1, side: 1 } }, air: false },
    { p: { defending: { depth: 1, contest: 1, side: -1 } }, air: false },
    { p: { defending: { depth: 0.2, contest: 0, side: 1 } }, air: false },
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
checkTheApproachIsFootworkAndNotAHop();
checkTheAlleyOopIsCaughtInTheAir();
checkAContactDunkIsHitAndKeepsGoing();
checkTheNewMovesAreNotSilent();
checkTheDefenceIsActuallyGuardingSomebody();
checkHeHasAnOpinionAboutHisOwnShot();
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
