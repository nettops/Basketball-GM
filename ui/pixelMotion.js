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

// How far above the hand the ball sits at the top of a jump shot, and where it
// starts from at the bottom of the dip. The gap between these two is the whole
// reason the release used to jump: the ball was drawn at the top figure and
// then handed to the flight code, which started it somewhere else entirely.
const JUMP_BALL_HIGH = 26;
const JUMP_BALL_LOW = 17;
// Same pair for a dunk: the hand offset grows from about where a dribble tops
// out to the full cocked reach at the apex.
const DUNK_BALL_LOW = 11;
const DUNK_BALL_RISE = 19;
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

// Where a held ball sits relative to its holder's floor position, in screen
// pixels above it. Split out from ballPosition because the RELEASE needs it
// too: the flight has to start from the hand the ball just left, and the only
// way to guarantee that is for both to ask the same function.
function heldBallOffset(kind, lift, cock) {
  if (kind === 'jump') return lift + (lift > 0 ? JUMP_BALL_HIGH : JUMP_BALL_LOW);
  if (kind === 'dunk') return lift + DUNK_BALL_LOW + DUNK_BALL_RISE * cock;
  if (kind === 'close') return lift + CLOSE_BALL_HIGH;
  return 0;
}

// 0 at the bottom of a dunker's dip, 1 at the apex.
function dunkCock(lift) { return Math.max(0, Math.min(1, (lift + 2) / 18)); }

// Which of the four ball behaviours this frame is in. Named so the probes can
// bucket by it and so the branch order is stated once rather than implied by
// the shape of an if-chain.
function ballMode(s) {
  if (!s.holder || !s.hand) return 'flight';
  if (s.holder === s.lifts.jumperId && s.lifts.jumperLift !== 0) return 'jump';
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

    if (mode === 'jump') {
      // gathered in front of the chest on the dip, raised overhead as he
      // rises — the ball has to travel with the shot, not sit at a fixed
      // offset while the body moves under it
      return {
        bx: hx + face * 2,
        by: hy - heldBallOffset('jump', s.lifts.jumperLift, 0),
        groundY: hy, mode: mode, bouncePhase: null
      };
    }

    if (mode === 'dunk') {
      // Cocked in the raised hand, riding the leap — and RISING WITH HIM, not
      // snapping into place. This was once gated on `dunkerLift > 0`, with the
      // dribble bounce as the fallback, so on the single frame the leap began
      // the ball went from 1px off the floor to 31px overhead: a 30px jump,
      // more than the body is tall, in one frame. It read as the ball
      // teleporting into his hand rather than being carried up, which is most
      // of why the dunk did not look like a dunk.
      const cock = dunkCock(s.lifts.dunkerLift);
      let bx = hx + face * 4;
      let by = hy - heldBallOffset('dunk', s.lifts.dunkerLift, cock);
      // THE SLAM ITSELF. `holder` is read from keyframe a, so the ball stayed
      // in his hand for the whole 90ms slam beat and was simply at the rim on
      // the next frame — a 43px drop between two frames. The hardest motion in
      // a dunk was the one part you never actually saw. Eased so it leaves the
      // hand unhurried and finishes fast, which is the shape of a slam; a
      // linear drop reads as the ball being lowered.
      if (s.b.ball.holder === null && s.b.dunk && s.b.dunk.phase === 'slam') {
        const drive = Math.pow(s.f, 1.8);
        bx += (s.b.ball.x - bx) * drive;
        by += (s.b.ball.y - by) * drive;
      }
      return { bx: bx, by: by, groundY: hy, mode: mode, bouncePhase: null };
    }

    if (mode === 'close') {
      return {
        bx: hx,
        by: hy - heldBallOffset('close', 0, 0),
        groundY: hy, mode: mode, bouncePhase: null
      };
    }

    // dribble
    const holderMoving = Math.sqrt(s.hand.vx * s.hand.vx + s.hand.vy * s.hand.vy) > 6;
    const bouncePeriod = holderMoving ? 95 : 140;
    const bouncePhase = Math.abs(Math.sin(s.playbackMs / bouncePeriod));
    return {
      bx: hx + face * 6,
      by: hy - 1 - bouncePhase * 10,   // dribble: hand to floor
      groundY: hy, mode: mode, bouncePhase: bouncePhase
    };
  }

  // A released ball is a projectile: constant horizontal velocity with a
  // parabolic rise and fall. (Easing the horizontal axis made shots visibly
  // brake in mid-air.)
  const flightDist = Math.abs(s.b.ball.x - s.a.ball.x) + Math.abs(s.b.ball.y - s.a.ball.y);
  // A slam is the one ball path with no arc in it — it goes straight down
  // through the rim. The default floor of 4px would lob it upward.
  const slamming = s.a.dunk && s.a.dunk.phase === 'slam';
  // A pass carries its own arc (see passShape): a dish barely leaves the
  // floor, a skip is a flat line drive. Falling back to the distance formula
  // made every long pass lob at the 32px ceiling.
  const arcHeight = slamming ? 0
    : (typeof s.b.ball.arc === 'number' ? s.b.ball.arc
       : Math.max(4, Math.min(32, flightDist * 0.3)));
  const groundY = motionLerp(s.a.ball.y, s.b.ball.y, s.f);
  return {
    bx: motionLerp(s.a.ball.x, s.b.ball.x, s.f),
    by: groundY - Math.sin(s.f * Math.PI) * arcHeight,
    groundY: groundY, mode: mode, bouncePhase: null
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DUNK_LIFT: DUNK_LIFT,
    JUMP_LIFT: JUMP_LIFT,
    JUMP_FOLLOW_MAX_MS: JUMP_FOLLOW_MAX_MS,
    JUMP_BALL_HIGH: JUMP_BALL_HIGH,
    JUMP_BALL_LOW: JUMP_BALL_LOW,
    DUNK_BALL_LOW: DUNK_BALL_LOW,
    DUNK_BALL_RISE: DUNK_BALL_RISE,
    CLOSE_BALL_HIGH: CLOSE_BALL_HIGH,
    dunkLiftAt: dunkLiftAt,
    jumpLiftAt: jumpLiftAt,
    resolveLifts: resolveLifts,
    heldBallOffset: heldBallOffset,
    dunkCock: dunkCock,
    ballMode: ballMode,
    ballPosition: ballPosition
  };
}
