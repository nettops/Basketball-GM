// Where the ball is, and how far off the floor a player is, on any given
// frame of the watched game.
//
// WHY THIS IS ITS OWN FILE. All of this used to live inside the 400-line
// render closure in ui/pixelGameView.js, where nothing in Node could reach it.
// Three separate defects lived in there undetected — the ball teleporting into
// the dunker's hand, the ball riding at his feet through the whole leap, and
// the dunker planted a full reach from the rim — and every one of them was
// found by eye rather than by a test, because no test could see this code at
// all. It is pure now: keyframes and numbers in, positions out. The view, the
// Node probes and any preview page all call the SAME function, so a preview
// can no longer disagree with the game about what the game does.
//
// COORDINATE CONVENTION, which is the source of most of the bugs this file
// has had. The court is drawn in a fake top-down projection: a keyframe's
// position is a FLOOR position, and height is faked by drawing the sprite
// further up-screen. So `y` means two different things depending on who is
// asking, and the two must never be mixed:
//   - kf.pos[id]   -> floor. Always.
//   - kf.ball.x/y  -> floor, EXCEPT on a release keyframe, where the
//                     choreographer bakes the launch height into y.
//   - bx/by out of here -> screen. Draw here.
//   - groundY out of here -> floor. The shadow and the handler ring go here.

// How high off the floor the dunker's sprite sits at each dunk beat, in stage
// pixels. The choreographer marks the beats; the height lives here so the
// timeline stays pure positions. Interpolated between keyframes like
// everything else, so seeking mid-leap lands at the right height.
const DUNK_LIFT = { gather: -2, rise: 16, slam: 13, land: 0 };
function dunkLiftAt(kf) {
  const d = kf && kf.dunk;
  return (d && DUNK_LIFT[d.phase] !== undefined) ? DUNK_LIFT[d.phase] : 0;
}

// Jump shot. Smaller than a dunk on purpose — a pull-up is not a leap — but a
// three gets more of everything, because a deep shot is a bigger effort.
const JUMP_LIFT = { gather: -3, rise: 9, release: 9, follow: 0 };
// How long the shooter holds his hand up after the release. Shorter than a
// three's flight time on purpose — the pose should end while the ball is still
// up, not carry into the rebound.
const JUMP_FOLLOW_MAX_MS = 520;
function jumpLiftAt(kf) {
  const j = kf && kf.jump;
  if (!j || JUMP_LIFT[j.phase] === undefined) return 0;
  const base = JUMP_LIFT[j.phase];
  return j.three ? Math.round(base * 1.35) : base;
}

// How far above his own feet a player holds the ball at full extension, by
// shot kind. These are the numbers the finished poses already used and they do
// not move — what changed is how the ball GETS here (see heldBallOffset).
const JUMP_BALL_HIGH = 26;
const DUNK_BALL_HIGH = 30;
// A shot that is neither a dunk nor a jumper — a layup, a floater, a putback.
const CLOSE_BALL_HIGH = 24;

function motionLerp(a, b, f) { return a + (b - a) * f; }

// Who is airborne on this frame and by how much.
//
// Resolved for the whole frame rather than per sprite because the ball needs
// it too: after the slam the holder is null, so the dunker's id has to come
// off the keyframe rather than off the ball.
function resolveLifts(a, b, f, reduceMotion) {
  const dunkA = a.dunk, dunkB = b.dunk;
  const dunkerId = (dunkA && dunkA.id) || (dunkB && dunkB.id) || null;
  let dunkerLift = 0;
  if (dunkerId && !reduceMotion) {
    const la = dunkLiftAt(a), lb = dunkLiftAt(b);
    // snap up, fall away — a symmetric ease makes the leap look weightless
    const ef = lb > la ? 1 - Math.pow(1 - f, 2) : Math.pow(f, 1.6);
    dunkerLift = Math.round(la + (lb - la) * ef);
  }

  // The jumper. The descent is deliberately NOT spread across the beat: the
  // last beat of a jump shot is the ball's whole flight (650-850ms), and
  // easing him down over all of it would leave him hanging in the air until
  // the ball reached the rim. He comes down in a fixed 170ms whatever the beat
  // length, then stands in his follow-through.
  const jumpA = a.jump, jumpB = b.jump;
  const jumperId = (jumpA && jumpA.id) || (jumpB && jumpB.id) || null;
  let jumperLift = 0, jumpFollow = false;
  if (jumperId && !reduceMotion) {
    const la = jumpLiftAt(a), lb = jumpLiftAt(b);
    const spanMs = Math.max(1, b.t - a.t);
    const jf = lb < la ? Math.min(1, f * (spanMs / 170)) : f;
    const ef = lb > la ? 1 - Math.pow(1 - jf, 2) : Math.pow(jf, 1.4);
    jumperLift = Math.round(la + (lb - la) * ef);
    // Follow-through runs from the release, for as long as the ball is in the
    // air — but capped. Left uncapped it rode the 'follow' keyframe into the
    // rebound beat as well, so shooters stood posing with their hand up for
    // 1.6s while the board was being fought for.
    jumpFollow = !!(jumpA && jumpA.phase === 'release' && f * spanMs < JUMP_FOLLOW_MAX_MS);
  }

  return {
    dunkerId: dunkerId, dunkerLift: dunkerLift,
    jumperId: jumperId, jumperLift: jumperLift, jumpFollow: jumpFollow
  };
}

// WHERE A HELD BALL SITS, and the one idea that governs all of it.
//
// A ball a player is about to shoot has exactly two anchor points: it is in
// his dribble, or it is up at full extension. Every defect this file has had
// came from treating the second as a place to JUMP to rather than a place to
// ARRIVE at. So there is now one rule for all three shot kinds: the offset is
// a blend from wherever the dribble had it to wherever the shot needs it, and
// `cock` (0..1) is how far through the gather he is. At cock 0 the ball is
// exactly where the previous frame drew it, so the branch can change without
// the ball moving at all.
//
// Full extension, in screen pixels above the shooter's feet.
function overheadBallOffset(kind, lift) {
  if (kind === 'jump') return lift + JUMP_BALL_HIGH;
  if (kind === 'dunk') return lift + DUNK_BALL_HIGH;
  if (kind === 'close') return lift + CLOSE_BALL_HIGH;
  return lift;
}
// ...and how far to the side of the body, which had its own smaller snap: a
// dribble is carried 6px out and every shot pose brings it in, so the ball
// stepped sideways on the same frame it stepped up.
function overheadBallSide(kind) {
  if (kind === 'jump') return 2;
  if (kind === 'dunk') return 4;
  return 0;
}

// Where the dribble has the ball right now. The bounce is a function of the
// clock, not of the beat, which is why a gather has to blend out of the ACTUAL
// current height rather than out of an average: the ball can be anywhere
// between the floor and the top of the bounce when the shooter decides to go.
const DRIBBLE_SIDE = 6;
const DRIBBLE_RISE = 10;
function dribbleBall(playbackMs, holderMoving) {
  const bouncePhase = Math.abs(Math.sin(playbackMs / (holderMoving ? 95 : 140)));
  return { up: 1 + bouncePhase * DRIBBLE_RISE, side: DRIBBLE_SIDE, bouncePhase: bouncePhase };
}

// How far through his gather a leaper is: 0 with his feet down, 1 at the top.
//
// Anchored at lift ZERO, not at the bottom of the dip. A shooter ENTERS these
// branches at lift 0, straight out of a dribble, so a cock above zero there is
// a step the eye sees on the very first frame — measured at 2.5px on a dunk
// with the old `(lift + 2) / 18`. Saturating at the pull-up apex also means a
// three, which goes higher, simply holds full extension through the last of
// its rise rather than over-extending past it.
function cockTo(lift, apex) { return Math.max(0, Math.min(1, lift / apex)); }
function dunkCock(lift) { return cockTo(lift, DUNK_LIFT.rise); }
function jumpCock(lift) { return cockTo(lift, JUMP_LIFT.rise); }
// A layup has no phase markers — it is a plain beat that happens to end with
// the ball gone — so its gather runs on beat progress instead.
function closeCock(f) { return Math.max(0, Math.min(1, f)); }

// The body lift for a close shot: a dip into the legs, then a rise into the
// finish. Lives here rather than in the view's sprite loop because the BALL
// has to ride it — while this was view-only, a layup lifted the body up to 5px
// and left the ball at a flat 24, so the ball hung still while the man rose
// under it.
function closeLift(f) {
  return Math.round(f < 0.18 ? -(f / 0.18) * 1.5 : Math.sin(((f - 0.18) / 0.82) * Math.PI) * 5);
}

// The blend itself. `kind` is the shot, `lift` the body height, `cock` the
// gather progress, and the dribble is where it came from.
function heldBallOffset(kind, lift, cock, drib) {
  const from = drib || { up: 1 + DRIBBLE_RISE, side: DRIBBLE_SIDE };
  const c = Math.max(0, Math.min(1, cock));
  return {
    up: from.up + (overheadBallOffset(kind, lift) - from.up) * c,
    side: from.side + (overheadBallSide(kind) - from.side) * c
  };
}

// Which of the four ball behaviours this frame is in. Named so the probes can
// bucket by it and so the branch order is stated once rather than implied by
// the shape of an if-chain.
function ballMode(s) {
  if (!s.holder || !s.hand) return 'flight';
  // Gated on WHO he is, not on how high he happens to be. The old gate was
  // `jumperLift !== 0`, and a shooter's lift passes through zero twice on the
  // way up — so mid-gather the ball flickered back to the dribble bounce and
  // out again, jumping a mean 7.8px each way. Same defect the dunk had, same
  // fix: identity decides the branch, height only decides the offset.
  if (s.holder === s.lifts.jumperId && !s.reduceMotion) return 'jump';
  if (s.holder === s.lifts.dunkerId && !s.reduceMotion) return 'dunk';
  if (s.b.ball.holder === null && s.shotComing) return 'close';
  return 'dribble';
}

// THE function. Everything above exists to serve it.
//
// s = {
//   a, b, f          the bracketing keyframes and the 0..1 position between
//   holder           id holding the ball on keyframe a, or null
//   hand             smoothed {x, y, vx, vy} of the holder, or null
//   facing           -1 or 1; which way the holder is turned
//   lifts            the resolveLifts() result for this frame
//   shotComing       is the next ball sequence a shot at a rim
//   reduceMotion     the accessibility setting
//   playbackMs       timeline clock, for the dribble bounce
// }
//
// Returns { bx, by, groundY, mode, bouncePhase }. bx/by are where to draw the
// ball; groundY is the floor beneath it, for the shadow and the handler ring.
function ballPosition(s) {
  const mode = ballMode(s);

  if (mode !== 'flight') {
    // attach to the SMOOTHED hand position, or the ball detaches from the body
    // it belongs to
    const hx = s.hand.x, hy = s.hand.y;
    const face = (s.facing || 1) >= 0 ? 1 : -1;
    // Where the dribble has it RIGHT NOW. Every held branch blends out of
    // this, so no branch change can move the ball on its own.
    const holderMoving = Math.sqrt(s.hand.vx * s.hand.vx + s.hand.vy * s.hand.vy) > 6;
    const drib = dribbleBall(s.playbackMs, holderMoving);

    if (mode === 'dribble') {
      return {
        bx: hx + face * drib.side,
        by: hy - drib.up,
        groundY: hy, mode: mode, bouncePhase: drib.bouncePhase
      };
    }

    // One gather for all three shot kinds: how high the body is, how far
    // through the gather he is, and where the dribble left the ball.
    const lift = mode === 'jump' ? s.lifts.jumperLift
      : mode === 'dunk' ? s.lifts.dunkerLift
      : closeLift(s.f);
    const cock = mode === 'jump' ? jumpCock(s.lifts.jumperLift)
      : mode === 'dunk' ? dunkCock(s.lifts.dunkerLift)
      : closeCock(s.f);
    const off = heldBallOffset(mode, lift, cock, drib);
    let bx = hx + face * off.side;
    let by = hy - off.up;

    // THE SLAM ITSELF. `holder` is read from keyframe a, so the ball stayed in
    // his hand for the whole 90ms slam beat and was simply at the rim on the
    // next frame — a 43px drop between two frames. The hardest motion in a dunk
    // was the one part you never actually saw. Eased so it leaves the hand
    // unhurried and finishes fast, which is the shape of a slam; a linear drop
    // reads as the ball being lowered.
    if (mode === 'dunk' && s.b.ball.holder === null && s.b.dunk && s.b.dunk.phase === 'slam') {
      const drive = Math.pow(s.f, 1.8);
      bx += (s.b.ball.x - bx) * drive;
      by += (s.b.ball.y - by) * drive;
    }
    return { bx: bx, by: by, groundY: hy, mode: mode, bouncePhase: null };
  }

  // A released ball is a projectile: constant horizontal velocity with a
  // parabolic rise and fall. (Easing the horizontal axis made shots visibly
  // brake in mid-air.)
  //
  // WHERE IT STARTS FROM. The choreographer bakes a launch height into the
  // release keyframe -- 20px up for a jump shot, 12 for a layup, 8 for a pass.
  // Those were guesses, and none of them matched where the hand actually had
  // the ball. Measured over 6 games, the gap between the last held frame and
  // the first airborne one:
  //
  //     free throw  32.8px mean      jump shot   15-19px
  //     pass        16.0px           layup        8.8px
  //
  // ~550 times a game the ball jumped at the exact instant it should have been
  // launching. `s.launch` is the ball's real position on the last held frame
  // (see launchPoint), so the flight now begins where the hand let go.
  const from = s.launch || { bx: s.a.ball.x, by: s.a.ball.y, groundY: s.a.ball.y };
  const flightDist = Math.abs(s.b.ball.x - from.bx) + Math.abs(s.b.ball.y - from.groundY);
  // A slam is the one ball path with no arc in it — it goes straight down
  // through the rim. The default floor of 4px would lob it upward.
  const slamming = s.a.dunk && s.a.dunk.phase === 'slam';
  // A pass carries its own arc (see passShape): a dish barely leaves the
  // floor, a skip is a flat line drive. Falling back to the distance formula
  // made every long pass lob at the 32px ceiling.
  const arcHeight = slamming ? 0
    : (typeof s.b.ball.arc === 'number' ? s.b.ball.arc
       : Math.max(4, Math.min(32, flightDist * 0.3)));
  // Two separate lines: the SHADOW runs along the floor from the thrower's
  // feet to the target's, while the BALL runs from the height it left the hand
  // at down to the target, with the arc on top. Sharing one line was what put
  // the ball on the floor for the first frame of every shot.
  // ...AND WHERE IT ENDS, which is the same problem run backwards and was
  // never measured until the release was fixed. The flight's target is the
  // catcher's keyframe position, which is his FEET. So the ball landed on the
  // floor in front of him and jumped up into his hand on the next frame:
  // measured at 7.8px mean and 12.6px max, on every catch, rebound and
  // handoff in the game -- ~575 a game, more often than the release it
  // mirrors. `s.arrival` is where the hand will actually hold it.
  const to = s.arrival || { bx: s.b.ball.x, by: s.b.ball.y, groundY: s.b.ball.y };
  const groundY = motionLerp(from.groundY, to.groundY, s.f);
  return {
    bx: motionLerp(from.bx, to.bx, s.f),
    by: motionLerp(from.by, to.by, s.f) - Math.sin(s.f * Math.PI) * arcHeight,
    groundY: groundY, mode: mode, bouncePhase: null
  };
}

// THE BODY SPRING. Same reason as everything else in this file: it lived
// inside the render closure, so nothing outside the browser could run it --
// which meant every floor measurement in the audit was of TARGET positions,
// and any preview page had to re-implement it and drift.
//
// Players chase their keyframe target on a critically damped spring rather
// than snapping to it, which is what turns a discrete timeline into motion.
const SNAP_DIST = 260;
// Players sprint a little when they have ground to cover, but only a little:
// stiffness is what converts gap into per-frame movement, so an aggressive
// ramp turns a long run into its own teleport (a 3x boost here moved players
// 113px in a single frame). This tops out around 1.7x.
function omegaFor(base, dist) {
  return base * (1 + Math.min(0.7, dist / 220));
}
// Hard ceiling on how far a sprite may move in one frame. Even a correct
// spring can outrun the eye when a beat asks for a lot of ground in very
// little time; clamping displacement (rather than snapping position) keeps
// motion continuous and simply lets the player arrive a beat late.
const MAX_STEP_PX_PER_SEC = 620;
const SPRING_STEP = 1 / 90;   // fixed integration step, in timeline seconds

function springAxis(x, v, target, omega, h) {
  const f = 1 + 2 * h * omega;
  const oo = omega * omega;
  const hoo = h * oo;
  const hhoo = h * hoo;
  const detInv = 1 / (f + hhoo);
  return [(f * x + h * v + hhoo * target) * detInv, (v + hoo * (target - x)) * detInv];
}

// Advance one body toward (tx, ty) by dtTimeline seconds. Mutates `s`
// ({x, y, vx, vy, omega}) in place, the way the render loop needs.
//
// Substepped at a fixed step so the spring integrates the same way at 1x and
// 8x: a single big step under-integrates and leaves players trailing their
// targets at high speed.
function stepSpring(s, tx, ty, dtTimeline) {
  const gapX = tx - s.x, gapY = ty - s.y;
  if (Math.sqrt(gapX * gapX + gapY * gapY) > SNAP_DIST) {
    s.x = tx; s.y = ty; s.vx = 0; s.vy = 0;
  }
  let remaining = dtTimeline;
  while (remaining > 0) {
    const h = Math.min(SPRING_STEP, remaining);
    remaining -= h;
    const prevX = s.x, prevY = s.y;
    const dist = Math.sqrt(Math.pow(tx - s.x, 2) + Math.pow(ty - s.y, 2));
    const w = omegaFor(s.omega, dist);
    const rx = springAxis(s.x, s.vx, tx, w, h);
    const ry = springAxis(s.y, s.vy, ty, w, h);
    s.x = rx[0]; s.vx = rx[1];
    s.y = ry[0]; s.vy = ry[1];
    // speed ceiling: scale the step back rather than jumping
    const stepX = s.x - prevX, stepY = s.y - prevY;
    const step = Math.sqrt(stepX * stepX + stepY * stepY);
    const maxStep = MAX_STEP_PX_PER_SEC * h;
    if (step > maxStep) {
      const k = maxStep / step;
      s.x = prevX + stepX * k;
      s.y = prevY + stepY * k;
      s.vx *= k; s.vy *= k;
    }
  }
  return s;
}

// Where the ball was on the last frame it was still in a hand — the point the
// flight that follows has to start from.
//
// RECOMPUTED from the keyframes rather than remembered from the last drawn
// frame. Remembering would be one line shorter and wrong: seeking into the
// middle of a shot, or arriving there after a pause, has no previous frame to
// remember, and the ball would launch from the stale one. This gives the same
// answer whether you played into the moment or jumped straight to it.
//
// Returns null when the previous beat had nobody holding the ball, which is
// every flight segment after the first — a ball already in the air launched a
// while ago and keeps its own path.
function launchPoint(s) {
  if (!s.prev || s.prev.ball.holder === null || !s.hand) return null;
  const lifts = resolveLifts(s.prev, s.a, 1, s.reduceMotion);
  return ballPosition({
    a: s.prev, b: s.a, f: 1,
    holder: s.prev.ball.holder, hand: s.hand, facing: s.facing,
    lifts: lifts, shotComing: s.shotComing,
    reduceMotion: s.reduceMotion,
    // The keyframe's own timestamp, not the live clock: that is the instant
    // the ball left, and it makes the dribble bounce deterministic.
    playbackMs: s.a.t
  });
}

// The mirror of launchPoint: where the ball will be once the hand closes on
// it. Same reasoning for recomputing rather than remembering -- a seek has no
// next frame to look at either.
//
// Returns null when nobody catches it, which is every shot: a ball on its way
// to the rim has no hand to arrive in and keeps the keyframe target.
function arrivalPoint(s) {
  if (!s.b || s.b.ball.holder === null || !s.hand) return null;
  const c = s.c || s.b;
  return ballPosition({
    a: s.b, b: c, f: 0,
    holder: s.b.ball.holder, hand: s.hand, facing: s.facing,
    lifts: resolveLifts(s.b, c, 0, s.reduceMotion),
    shotComing: s.shotComing, reduceMotion: s.reduceMotion,
    playbackMs: s.b.t
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DUNK_LIFT: DUNK_LIFT,
    JUMP_LIFT: JUMP_LIFT,
    JUMP_FOLLOW_MAX_MS: JUMP_FOLLOW_MAX_MS,
    JUMP_BALL_HIGH: JUMP_BALL_HIGH,
    DUNK_BALL_HIGH: DUNK_BALL_HIGH,
    CLOSE_BALL_HIGH: CLOSE_BALL_HIGH,
    dunkLiftAt: dunkLiftAt,
    jumpLiftAt: jumpLiftAt,
    resolveLifts: resolveLifts,
    heldBallOffset: heldBallOffset,
    overheadBallOffset: overheadBallOffset,
    overheadBallSide: overheadBallSide,
    dribbleBall: dribbleBall,
    closeLift: closeLift,
    closeCock: closeCock,
    dunkCock: dunkCock,
    jumpCock: jumpCock,
    ballMode: ballMode,
    ballPosition: ballPosition,
    launchPoint: launchPoint,
    arrivalPoint: arrivalPoint,
    SNAP_DIST: SNAP_DIST,
    MAX_STEP_PX_PER_SEC: MAX_STEP_PX_PER_SEC,
    SPRING_STEP: SPRING_STEP,
    omegaFor: omegaFor,
    springAxis: springAxis,
    stepSpring: stepSpring
  };
}
