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
checkPosesStayWithinTheSpriteBox();
console.log('All pixel posture validations passed');
