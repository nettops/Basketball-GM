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

// How many bounces he keeps it in one hand before crossing it over.
const DRIBBLE_HAND_BOUNCES = 3;

// How long one bounce takes, set and on the move. A handler pushing the ball
// ahead of him dribbles quicker than one sizing his man up.
const DRIBBLE_PERIOD_SET = 140;
const DRIBBLE_PERIOD_MOVING = 95;

// THE DRIBBLE CLOCK, and why it is a clock rather than a formula.
//
// This used to be `playbackMs`, with the period chosen per frame from whether
// the holder was moving. That is fine until the tempo changes — and then it is
// catastrophic, because the phase was `playbackMs / period`, so a new period
// retroactively rewrote the ENTIRE history. A springy body's speed wobbles
// across the 6px/s threshold constantly, and every crossing snapped the ball up
// to 12px into the other hand in a single frame. Measured over real games at
// 446 times a game: the largest remaining teleport in the ball's path, and one
// that no test in validate-dribble.js could see, because they all held the
// tempo constant.
//
// A clock cannot have that bug. It only ever moves forward, and the tempo
// decides how fast it runs FROM NOW ON. The unit is bounces, not milliseconds,
// so the rest of this file can talk about "half a bounce either side" and mean
// it whatever the tempo is doing.
function stepDribbleClock(u, dtMs, holderMoving) {
  return u + dtMs / (Math.PI * (holderMoving ? DRIBBLE_PERIOD_MOVING : DRIBBLE_PERIOD_SET));
}

// Which side of the body the ball is on, and how far through the bounce it is.
//
// Exported and used by BOTH the ball and the sprite's arm, because they have to
// agree about which hand has it — an arm pumping on the left while the ball
// bounces on the right is worse than no arm animation at all.
//
// The crossover is CENTRED ON A FLOOR CONTACT, and takes half a bounce either
// side of it. The ball therefore goes down on one hand, touches the floor as it
// passes the middle of his body, and comes up on the other — which is what a
// crossover is.
//
// The first version spread the crossing across a whole bounce instead, from one
// floor contact to the next. That put the ball dead centre at the TOP of the
// bounce, i.e. floating at chest height in front of his sternum, and it read as
// the ball passing through him. checkTheCrossHappensAtTheFloor catches exactly
// that and was written before this was right.
//
// Doing it over half a bounce either side also keeps the path continuous: at
// the edges of the window the sign already equals the steady value the bounces
// outside it hold, so nothing snaps. An instant switch would move the ball 12px
// sideways in one frame — the "prop snaps at a branch change" defect this file
// exists to prevent.
//
// `u` is the dribble clock, in bounces: abs(sin(pi*u)) is zero at every whole u
// (the floor) and one at every half (the top).
function dribbleHand(u) {
  const N = DRIBBLE_HAND_BOUNCES;
  const cycle = Math.round(u / N);      // which hand era we are nearest
  const d = u - cycle * N;              // bounces from that era's crossing
  const to = (cycle % 2) ? -1 : 1;      // the hand this era ends up in
  const crossing = cycle > 0 && Math.abs(d) <= 0.5;
  // Inside the window sign sweeps -to -> 0 -> +to, hitting zero exactly on the
  // floor contact. Outside it, it is whichever side this era holds.
  //
  // The first era is special: there is no previous hand to cross from, so it
  // starts already committed. Without this the very first frame reads d === 0
  // with crossing suppressed and flips 12px on frame two — the teleport this
  // whole function is shaped to avoid, reintroduced by the guard against it.
  let sign;
  if (crossing) sign = to * (2 * d);
  else if (cycle === 0 && d <= 0) sign = to;
  else sign = d > 0 ? to : -to;
  return {
    sign: sign,
    crossing: crossing,
    phase: Math.abs(Math.sin(Math.PI * u))
  };
}

function dribbleBall(u) {
  const h = dribbleHand(u);
  return { up: 1 + h.phase * DRIBBLE_RISE, side: DRIBBLE_SIDE * h.sign, bouncePhase: h.phase };
}

// ---------------------------------------------------------------------------
// THE NAMED MOVES.
//
// Everything above is the idle dribble: a metronome, three bounces to a hand.
// A crossover, a behind-the-back, a double move and an ankle breaker are not
// that, and until this existed they were not anything — the choreographer slid
// the BODY sideways and the ball kept its own metronome regardless. Measured
// over real games, all four reached exactly 6.0px from the handler's centre,
// which is the width of an ordinary dribble. They were the same animation with
// different footwork.
//
// A move is described in BEATS, one bounce per beat, so the ball meets the
// floor as he plants. `at` is the beat a crossing lands on; `wide` is how far
// the ball gets from him on either side of it; `low` is how hard he drives it
// into the floor as it passes his centre line.
// ---------------------------------------------------------------------------
function dribbleCrossings(move, n) {
  // A put-down is two dribbles in place. Nothing crosses; nothing should.
  if (move === 'putdown') return [];
  // An ankle breaker's beats are the jab, the cut back and the clear. The ball
  // has to change hands ON the cut — that IS the move — so it is pinned to beat
  // 1 rather than to a fraction of the string.
  // NO hesitation on this one, and that is not an oversight. An ankle breaker
  // already has its fake: the jab is a 300ms beat whose entire job is to make
  // the defender commit, and the cut back is the 90ms punish — the fastest beat
  // in the game. Hanging the ball in front of the cut puts a second fake on top
  // of the first and slows down the one beat that has to snap. The
  // choreographer learned the same lesson the hard way when two lateral systems
  // stacked on one axis and cancelled.
  if (move === 'ankle') return [{ at: 1, wide: 12, low: 0.8, hesi: 0 }];
  // A double move's signature is that the second one is the bigger: the
  // defender has already ridden out the first.
  if (move === 'double') {
    return [{ at: 2, wide: 8, low: 0.5 }, { at: n - 1, wide: 12, low: 0.75 }];
  }
  // Behind the back is the crossover's opposite. The ball goes WIDE and stays
  // UP, around a handler whose shoulders stay square; a crossover goes narrow
  // and low, straight through the middle of his stance. Without that contrast
  // the two are the same rectangles sliding sideways at this size, which is
  // what they were.
  if (move === 'behind') return [{ at: Math.floor(n / 2), wide: 15, low: 0, behind: 5 }];
  return [{ at: Math.floor(n / 2), wide: 10, low: 0.65 }];
}

// THE HESITATION. How long the ball hangs at the top of its bounce before a
// crossing, in bounces, and how high it is held while it does.
//
// A crossover that simply happens is a ball changing hands. A crossover a
// defender BITES on has a beat of stillness in front of it: the ball comes up
// and stays up, the handler is doing nothing, and then it goes. Half a bounce
// is about 120ms at a size-up tempo — long enough to read as a pause, short
// enough that it never looks like the animation has stalled.
const HESITATION_BEATS = 0.5;
const HESITATION_HOLD = 0.72;
// ...and how much of the front of that window is spent easing up INTO the hold,
// so the ball rises into it rather than stepping up to it on one frame.
const HESITATION_EASE = 0.12;

// How much of the string is spent easing into and out of the scripted path.
// The move must not simply replace the free dribble: the ball is somewhere when
// the string starts, and teleporting it to wherever the script wants it is the
// branch-change snap this file exists to prevent.
const MOVE_BLEND_BEATS = 0.5;

// `u` is beats into the string, `from` the hand the ball is ALREADY in when the
// string opens. Returns the same shape dribbleHand does, plus `behind`, an
// up-screen offset that carries the ball around the far side of him rather than
// across his front.
//
// `from` matters more than it looks. Without it a move always opened in the
// right hand, so half the time the string began by quietly walking the ball
// across from the left — a hand change the move never asked for, on top of the
// one it did. A "crossover" measured two.
function moveDribble(move, u, n, from) {
  let phase = Math.abs(Math.sin(Math.PI * u));
  let side = DRIBBLE_SIDE, sign, behind = 0;

  const crossings = dribbleCrossings(move, n);
  // TWO windows, not one, and the difference is the whole reason the first
  // version of this measured 6.0px — the width of the ordinary dribble it was
  // meant to be louder than.
  //
  // The hand-switch spans half a bounce either side of the plant (`active`).
  // The WIDTH spans a whole bounce either side (`near`). They have to differ,
  // because inside the switch the drawn offset is sign * side and sign is
  // sweeping through zero: any width added there is multiplied by a number on
  // its way to nothing. Widening on the same window as the switch also made the
  // width jump 4px the instant the window opened, since it was at its maximum
  // exactly where the window began.
  //
  // On the wider window the ball swings out to `wide` a bounce before the
  // plant, comes all the way in to his centre line as he plants, and goes back
  // out the other side — which is what the move looks like.
  let active = null, near = null, d = 0, dNear = 0, passed = 0;
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i];
    if (u > c.at) passed += 1;
    const dd = u - c.at;
    if (Math.abs(dd) <= 1) { near = c; dNear = dd; }
    if (Math.abs(dd) <= 0.5) { active = c; d = dd; }
  }
  const start = (from || 0) < 0 ? -1 : 1;
  const hand = (passed % 2) ? -start : start;

  if (near) {
    // Doubled so that `wide` means what it says: at the edge of the switch, the
    // widest point the drawn offset actually reaches, the ramp is at a half.
    side = DRIBBLE_SIDE + (near.wide - DRIBBLE_SIDE) * 2 * (1 - Math.abs(dNear));
    // He sells it. Through the half-bounce leading into the switch the ball is
    // held up rather than carrying on with the metronome, then drops into the
    // move. The hold is FLAT across that window — a hold that merely ramps up
    // to its peak at the last instant is not a hesitation, it is the ball
    // arriving late — with only the far edge eased so it rises into the pause
    // instead of stepping up to it.
    const backFromSwitch = -0.5 - dNear;   // bounces before the hand-switch window
    if (near.hesi !== 0 && backFromSwitch > 0 && backFromSwitch < HESITATION_BEATS) {
      const ease = Math.max(0, Math.min(1,
        (HESITATION_BEATS - backFromSwitch) / HESITATION_EASE));
      phase = Math.max(phase, HESITATION_HOLD * ease);
    }
  }

  if (active) {
    // The hand this crossing ENDS in. Before the plant `hand` is still the old
    // one and after it is already the new one, so the target flips with d --
    // which is what keeps sign continuous across the middle.
    const to = d > 0 ? hand : -hand;
    sign = to * (2 * d);
    const mid = 1 - Math.abs(2 * d);   // 1 at the plant, 0 at the edges of the switch
    phase = Math.max(0, Math.min(1, phase - active.low * mid * phase));
    if (active.behind) {
      phase = Math.max(phase, 0.5 + 0.35 * mid);
      behind = active.behind * mid;
    }
  } else {
    sign = hand;
  }
  return { sign: sign, side: side, phase: phase, behind: behind, crossing: !!active };
}

// Where the free clock has to resume once a string is over.
//
// The clock is HELD while a move plays — the move is the dribble, and a
// metronome running underneath it would drag the starting hand around. But a
// held clock still has the hand it started with, while the move has by then
// carried the ball across once per crossing. Resuming without this makes the
// handoff back its own uninvited hand change: measured as a second hand change
// on every crossover, at the last half-beat of the string.
//
// So the clock is moved to an era whose hand matches the one the move finished
// in. Two details are load-bearing:
//   - it goes FORWARD, one or two eras, never back — a clock that can run
//     backwards is not a clock;
//   - it lands one bounce INTO the era, not on the boundary. The boundary is
//     exactly where dribbleHand puts a crossing, so resuming there would hand
//     the ball back mid-crossover with the sign passing through zero. A whole
//     bounce in is a floor contact, which is also where the move leaves it.
function dribbleClockAfterMove(clock, move, n) {
  const N = DRIBBLE_HAND_BOUNCES;
  const startCycle = Math.round(clock / N);
  const odd = dribbleCrossings(move, n).length % 2;
  return (startCycle + (odd ? 1 : 2)) * N + 1;
}

// THE entry point the view and the probes call. `move` is null outside a
// dribble string and { move, n, u } inside one.
//
// The blend at each end is not a nicety. A string begins with the ball wherever
// the free clock left it and ends with it wherever the script finished, and
// both of those are branch changes -- the defect class that put a 12px snap in
// the ball's path twice already. Easing over half a bounce at each end costs
// nothing visually (the crossings sit at least a full beat inside) and makes
// the handoff continuous by construction.
function dribbleNow(clock, move) {
  const free = dribbleHand(clock);
  if (!move || !move.move) return { sign: free.sign, side: DRIBBLE_SIDE, phase: free.phase, behind: 0, crossing: free.crossing };
  // The move starts in whichever hand the ball is already in. The free clock is
  // HELD for the duration of a string (see dribbleClockAfterMove), so this is
  // the hand it had when the string opened and it does not drift underneath the
  // move. Deriving it instead — "the string began u bounces ago" — is wrong and
  // was tried: the clock runs on the dribble tempo and u on the beat tempo, so
  // the two diverge and the starting hand flips mid-move.
  const scripted = moveDribble(move.move, move.u, move.n, free.sign);
  const inFromStart = Math.max(0, Math.min(1, move.u / MOVE_BLEND_BEATS));
  const inFromEnd = Math.max(0, Math.min(1, (move.n - move.u) / MOVE_BLEND_BEATS));
  const w = Math.min(inFromStart, inFromEnd);
  // Which free dribble each end blends against. Coming IN, it is the clock as it
  // stands; going OUT, it has to be the clock the caller will resume with, or
  // the last half-beat of every crossover walks the ball back to the hand it
  // started in — a second hand change the move never asked for.
  const base = inFromEnd < inFromStart
    ? dribbleHand(dribbleClockAfterMove(clock, move.move, move.n))
    : free;
  return {
    sign: base.sign + (scripted.sign - base.sign) * w,
    side: DRIBBLE_SIDE + (scripted.side - DRIBBLE_SIDE) * w,
    phase: base.phase + (scripted.phase - base.phase) * w,
    behind: scripted.behind * w,
    crossing: scripted.crossing && w > 0.5
  };
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
//   dribbleU         the dribble clock, in bounces (see stepDribbleClock)
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
    // this, so no branch change can move the ball on its own. `s.dribbleMove`
    // is the named move playing, if any — the SAME value the sprite's arm is
    // handed, so the two cannot disagree about which hand has it.
    const now = dribbleNow(s.dribbleU || 0, s.dribbleMove);
    const drib = {
      up: 1 + now.phase * DRIBBLE_RISE,
      side: now.side * now.sign,
      behind: now.behind,
      bouncePhase: now.phase
    };

    if (mode === 'dribble') {
      // `behind` carries the ball UP-SCREEN, which in this faked top-down
      // projection is the far side of him — so a behind-the-back goes around
      // his back rather than across his front. It moves the shadow with it:
      // this is the ball travelling on the floor, not the ball getting higher,
      // and leaving the shadow put would read as the second.
      return {
        bx: hx + face * drib.side,
        by: hy - drib.behind - drib.up,
        groundY: hy - drib.behind, mode: mode, bouncePhase: drib.bouncePhase
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
    // The LIVE dribble clock. This used to be the keyframe's own timestamp, on
    // the reasoning that a fixed instant makes the bounce deterministic — true
    // of a formula, meaningless for a clock, and actively wrong here: the ball
    // has to leave from where the dribble actually had it, or the flight starts
    // with the snap this whole file exists to prevent.
    dribbleU: s.dribbleU, dribbleMove: s.dribbleMove
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
    dribbleU: s.dribbleU, dribbleMove: s.dribbleMove
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
    dribbleHand: dribbleHand,
    DRIBBLE_SIDE: DRIBBLE_SIDE,
    DRIBBLE_RISE: DRIBBLE_RISE,
    DRIBBLE_HAND_BOUNCES: DRIBBLE_HAND_BOUNCES,
    DRIBBLE_PERIOD_SET: DRIBBLE_PERIOD_SET,
    DRIBBLE_PERIOD_MOVING: DRIBBLE_PERIOD_MOVING,
    stepDribbleClock: stepDribbleClock,
    MOVE_BLEND_BEATS: MOVE_BLEND_BEATS,
    HESITATION_BEATS: HESITATION_BEATS,
    HESITATION_HOLD: HESITATION_HOLD,
    HESITATION_EASE: HESITATION_EASE,
    dribbleCrossings: dribbleCrossings,
    moveDribble: moveDribble,
    dribbleNow: dribbleNow,
    dribbleClockAfterMove: dribbleClockAfterMove,
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
