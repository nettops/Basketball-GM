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

// ...AND THE SAME TABLE FOR A DUNK THAT KNOWS WHICH DUNK IT IS.
//
// Every dunk in the game used to be this one table: dip 2, rise 16, slam 13,
// land. Now the peak comes off the catalogue entry (a quick finish tops out at
// 11, a hang windmill at 20) and two phases have been added under it:
//
//   plant   the deepest point of the load, BELOW the gather. This is the frame
//           where his foot is actually against the floor and everything is
//           about to reverse — the brief calls it out as its own phase and it
//           was the one part of the ten-phase structure with nowhere to live.
//   hang    the top, HELD. A dunk that hangs is not a dunk that rises higher;
//           it is one that stops rising for a while, which needs a phase of its
//           own or the peak is a single frame the eye never lands on.
// `tall` is the sprite's height delta from the league-median body (see
// spriteTallness): -3 for a 6'0" guard, +5 for a 7'7" centre.
//
// IT HAS TO CHANGE THE LEAP, now that the rim is at a fixed height. The catalogue
// says how high each dunk leaps, and those numbers were written for a median
// body — so applied unchanged, a short guard came up 2px under the rim and
// finished with the ball hanging off the end of his fingers, while a seven-footer
// went well past it. A shorter man jumps higher to reach the same hoop; that is
// not a fudge, it is the reason short players who dunk are the best leapers in
// the building.
function dunkLiftTable(dunk, tall) {
  const peak = ((dunk && dunk.lift) || DUNK_LIFT.rise) - (tall || 0);
  const twoFoot = dunk && dunk.takeoff === 'two';
  return {
    // A two-foot gather loads deeper — that is what two feet are for.
    gather: twoFoot ? -3 : -2,
    plant: twoFoot ? -5 : -3,
    rise: peak,
    hang: peak,
    // He is already coming down as he puts it through.
    slam: Math.round(peak * 0.82),
    land: 0
  };
}

// HOW FAR INTO THE AIRBORNE POSE HE IS — its own channel, on the phase clock.
//
// First written as a function of the instantaneous lift, which does not work:
// the lift snaps up 4px on the first frame of the rise (that is the leap, and it
// is meant to), so a pose derived from it swept the arm 10px in that same frame
// and the takeoff still read as a switch rather than a movement.
//
// On its own clock the arm starts coming up during the GATHER, which is what a
// man actually does — he brings the ball to his chest before he brings it over
// his head — and the sweep is spread across the whole windup and rise instead of
// being crammed into the frame where the body is already doing the most.
//
// It comes back DOWN on the land beat so the limbs return to a standing pose
// before his feet arrive, rather than the sprite popping out of the dunk.
const DUNK_RISE = {
  ready: 0, gather: 0.12, plant: 0.26, rise: 1, hang: 1, slam: 1, land: 0
};

// SECONDARY MOTION IN THE AIR — its own channel again, running rise to slam.
//
// `rising` is pinned at 1 for the whole airborne phase (that is what being
// airborne means), so with nothing else moving, 7% of airborne frames were
// measured with the body, the pose AND the ball all identical to the frame
// before. A man at the top of a dunk is not a held cel.
//
// It is deliberately small: 2px of leg over the whole hang. Section 15's own
// caveat is that every movement has to serve readability, and on a 10px body
// anything larger stops being secondary and starts competing with the route.
const DUNK_AIR = { rise: 0, hang: 0.55, slam: 1, land: 1 };

function dunkAirAt(kf) {
  const d = kf && kf.dunk;
  if (!d) return 0;
  return DUNK_AIR[d.phase] !== undefined ? DUNK_AIR[d.phase] : 0;
}

function dunkRiseAt(kf) {
  const d = kf && kf.dunk;
  if (!d) return 0;
  return DUNK_RISE[d.phase] !== undefined ? DUNK_RISE[d.phase] : 0;
}

// THE TAKEOFF, which is two movements sharing one beat and used to share one
// curve as well.
//
// The plant keyframe is a NEGATIVE lift — knees folded, feet planted — and the
// rise keyframe is the apex. A single ease across that whole span decides for
// itself how long the extension gets, and it decided on almost nothing: solving
// `1 - (1-f)^2` for the zero crossing of a -5 to +16 span puts it at f=0.13, so
// the man went from fully compressed to off the floor inside ONE frame of a
// nine-frame beat, and 4px of body — a sixth of his height — moved in 16ms.
// Compression with no visible extension is a pose change, not a jump.
//
// So the beat is split at the floor. The extension gets a guaranteed share and
// eases OUT of the crouch; the leap gets the rest and snaps up. Two movements,
// two curves, and the moment his feet leave the ground is a moment you can see.
// Solved, not picked. Swept share x exponent against two budgets — the
// extension must last at least 2 frames on the SHORTEST rise beat in the
// catalogue, and no frame of the leap may move the body more than 4px (the step
// the takeoff already ran to, so the explosiveness is not being paid for). 0.30
// and 1.4 is the pair that meets both with the longest extension.
const EXTEND_SHARE = 0.3;
const LEAP_EASE = 1.4;

function dunkTakeoff(la, lb, f) {
  // Only a beat that actually crosses the floor is a takeoff; everything else
  // (rise to hang, hang to slam, slam to land) keeps the old behaviour.
  if (!(la < 0 && lb > 0)) {
    return la + (lb - la) * (lb > la ? 1 - Math.pow(1 - f, 2) : Math.pow(f, 1.6));
  }
  if (f <= EXTEND_SHARE) {
    // Driving out of the crouch: fast off the bottom, easing as he reaches full
    // extension. This is the part that was missing.
    const u = f / EXTEND_SHARE;
    return la * Math.pow(1 - u, 2);
  }
  const u = (f - EXTEND_SHARE) / (1 - EXTEND_SHARE);
  return lb * (1 - Math.pow(1 - u, LEAP_EASE));
}

// HOW FAR THROUGH PICKING THE BALL UP HE IS, at file scope so Node can reach it.
//
// It lived inside ballPos, which needs a whole render state to call, so nothing
// tested it — and the defect it was hiding (the ball falling back out of his
// hands at the takeoff) needed exactly this curve next to the route's origin to
// be visible at all. CLAUDE.md's rule: if Node cannot reach it, it is not
// covered.
//
// Most of the gather happens in the gather beat and it finishes on the plant,
// so the ball is settled in his hands BEFORE he drives out of the crouch —
// a man does not still be collecting the ball as his feet leave the floor.
function dunkGatherProgress(phase, f) {
  const u = Math.max(0, Math.min(1, f));
  if (phase === 'gather') return u * 0.55;
  if (phase === 'plant') return 0.55 + u * 0.45;
  return phase === 'rise' ? 1 : 0;
}

// THE HIT, taken in mid-air, which is what a contact dunk actually is.
//
// Contact was modelled only as a floor bump — a crouch and a lean between two
// men standing on the ground — so a dunk THROUGH somebody was drawn exactly like
// a dunk past nobody, with a shove played on the beat before it. `contact` has
// been stamped on every keyframe of the string and read by no one.
//
// Section 10's sequence is takeoff -> contact -> compression -> CONTINUED
// elevation -> finish, and the continued elevation is the whole point: he gets
// checked and goes anyway. So this is a dip in the climb rather than a cap on
// it — he still reaches the same rim, he just gets there having been hit.
const CONTACT_CHECK_PX = 2.4;
const CONTACT_CHECK_AT = 0.45;      // how far up the rise it lands
const CONTACT_CHECK_WIDTH = 0.28;

function contactCheck(phase, f, hit) {
  if (!hit || phase !== 'rise') return 0;
  const d = (f - CONTACT_CHECK_AT) / CONTACT_CHECK_WIDTH;
  if (d <= -1 || d >= 1) return 0;
  // A cosine lobe: he is checked into it and drives back out of it, and neither
  // edge is a frame the eye can catch as a step.
  return CONTACT_CHECK_PX * Math.cos(d * Math.PI * 0.5);
}

function dunkLiftAt(kf, dunk) {
  const d = kf && kf.dunk;
  if (!d) return 0;
  const table = dunk ? dunkLiftTable(dunk, d.tall) : DUNK_LIFT;
  return table[d.phase] !== undefined ? table[d.phase] : 0;
}

// HOW FAR THROUGH ITS ROUTE THE BALL IS, which is not the same as how high he
// is and cannot be derived from it.
//
// The obvious shortcut is to drive the ball off the body's lift — it was how
// the single old dunk worked, via dunkCock(). It breaks the moment `hang`
// exists: the whole point of a hang is that the lift stops changing, so a ball
// driven off lift stops dead at the top of every dunk and then jumps to the rim.
// A windmill hanging 240ms would freeze mid-circle.
//
// So the route has its own clock, keyed off the phases. It only ever moves
// forward, which is what lets a 360 and a quick finish share one function.
// The choreographer stamps `route` on each phase from that dunk's own beat
// lengths (see dunkRouteMarks). This table is only the fallback for a dunk that
// carries no marks — an un-stamped keyframe, or an older save.
const DUNK_ROUTE_T = { gather: 0, plant: 0, rise: 0.62, hang: 0.85, slam: 1, land: 1 };
function dunkRouteAt(kf) {
  const d = kf && kf.dunk;
  if (!d) return 0;
  if (typeof d.route === 'number') return d.route;
  return DUNK_ROUTE_T[d.phase] !== undefined ? DUNK_ROUTE_T[d.phase] : 0;
}

// A NEGATIVE LIFT IS A KNEE BEND, NOT A MAN SINKING THROUGH THE FLOOR.
//
// The gather beats carry negative lifts (-2 on a dunk, -3 on a pull-up, -4 on a
// three) and the view drew them as `y - lift`, which translates the WHOLE
// sprite down — feet included. The shadow is drawn at `y` and does not move, so
// for the entire anticipation of every shot in the game the player stood up to
// four pixels BELOW his own shadow, with his feet under the floor. It reads as
// the court swallowing him rather than as him loading up.
//
// The two halves of that number mean different things and have to be drawn
// differently: the positive part lifts the feet off the ground, the negative
// part is compression with the feet planted. Splitting it here rather than in
// the view keeps it testable and keeps the BALL untouched — the ball hangs off
// the shoulders, which really do drop with the hips, so ball math still reads
// the raw signed lift exactly as before.
function liftToPose(raw) {
  return { foot: Math.max(0, raw), crouch: Math.max(0, -raw) };
}

// Jump shot. Smaller than a dunk on purpose — a pull-up is not a leap — but a
// three gets more of everything, because a deep shot is a bigger effort.
const JUMP_LIFT = { gather: -3, rise: 9, release: 9, follow: 0 };
// How long the shooter holds his hand up after the release. Shorter than a
// three's flight time on purpose — the pose should end while the ball is still
// up, not carry into the rebound.
const JUMP_FOLLOW_MAX_MS = 520;
// ...AND WHAT HE DOES WHEN HE SEES IT GO IN OR NOT.
//
// A made three and an air ball produced identical body language: the
// follow-through timed out after the same 520ms either way and he went back to
// standing. The shooter is the one man on the floor guaranteed to be watching
// the ball, and he was the one man with no opinion about it.
//
// Timing, not a new pose — section 25's rule. A shooter who knows it is in
// holds the follow-through; one who knows it is not drops out of it and his
// shoulders go. Same two poses the game already has, played for different
// lengths, which is most of what body language is.
const FOLLOW_MADE_MS = 900;
const FOLLOW_MISS_MS = 340;
const SLUMP_MS = 520;
const SLUMP_PX = 2;

function followWindow(made) {
  return made ? FOLLOW_MADE_MS : FOLLOW_MISS_MS;
}

// The shoulders going after a miss: in fast, out slow, gone by SLUMP_MS. Same
// shape as a landing, because it is the same thing — weight arriving somewhere
// it was not before.
function shotSlump(ms, made) {
  if (made || typeof ms !== 'number' || ms < 0 || ms >= SLUMP_MS) return 0;
  const f = ms / SLUMP_MS;
  return SLUMP_PX * Math.sin(f * Math.PI) * (1 - f * 0.4);
}
function jumpLiftAt(kf) {
  const j = kf && kf.jump;
  if (!j || JUMP_LIFT[j.phase] === undefined) return 0;
  const base = JUMP_LIFT[j.phase];
  return j.three ? Math.round(base * 1.35) : base;
}

// THE LAYUP, which used to be the one finish at the rim with no phases in it.
//
// A dunk has gather/rise/slam/land and a jumper has gather/rise/release/follow;
// a layup had a single 200ms beat and `closeLift(f)`, a sine hump that returned
// to ZERO at the end of the beat — which is the frame the ball leaves. So the
// game released every layup at the instant the shooter's feet were back on the
// floor, and the whole finish was a 12-frame bump with the generic both-arms-up
// jump-shot pose on top of it.
//
// Now it is built like the other two. Lower than a dunk, quicker than a jumper,
// and — the point of the whole exercise — STILL IN THE AIR at the release, with
// the descent handled after the ball has gone.
const CLOSE_LIFT = { gather: -3, rise: 8, release: 9, land: 0 };

// ...and the three ways of finishing one, which until now were one way drawn
// three times. A reverse, a floater and a standard lay-in were the same pose at
// the same height; only which side he went up on was read from the timeline.
//
// The differences are the ones that survive at this size:
//   standard  the baseline.
//   floater   a TOUCH shot. Deeper gather (he has to get under it), lower rise
//             and an earlier release — he is lofting it over somebody, not
//             rising through them, and a floater that jumps as high as a
//             standard lay-in is just a standard lay-in.
//   reverse   HIGHER and later. He carries it under the rim and finishes on
//             the far side, so he is in the air longer and extends further.
const CLOSE_LIFT_BY_FINISH = {
  standard: CLOSE_LIFT,
  floater: { gather: -4, rise: 6, release: 6, land: 0 },
  reverse: { gather: -3, rise: 9, release: 11, land: 0 }
};

function closeLiftTable(finish) {
  return CLOSE_LIFT_BY_FINISH[finish] || CLOSE_LIFT;
}

// THE APPROACH — how he got past the man, which the game had no animation for
// at all. A finish used to begin at the gather, so every layup in the league was
// a man who materialised at the rim already going up.
//
// Two of them, and they are different movements rather than one mirrored:
//
//   euro   TWO STEPS, opposite ways. The whole move is the weight going one
//          direction and then the other, so it is worth two beats and the second
//          step is the long one. He stays low: a euro that leaves the floor is a
//          jump, and the reason it works is that it does not.
//   spin   ONE continuous rotation, and it is his own momentum carrying him
//          round rather than a step. He dips as he turns his back and comes out
//          of it rising, which is the beat a spin actually has.
//
// The lifts are small and NEGATIVE on purpose — an approach is played out on the
// floor, and anything airborne here would fight the finish that follows it.
const APPROACH_LIFT = {
  euroOne: -2, euroTwo: -4, spinTurn: -3, spinOut: -1,
  // A pro-hop is the one approach that LEAVES the floor — that is what makes it
  // a hop rather than a step — but only just, and it lands two-footed and deep.
  // The hand-switch stays down: he is ducking under the rim, not rising.
  hopGather: 3, hopLand: -5, switchUnder: -4, switchOut: -2
};

function approachLiftAt(kf) {
  const c = kf && kf.close;
  if (!c) return 0;
  return APPROACH_LIFT[c.phase] !== undefined ? APPROACH_LIFT[c.phase] : null;
}

// HOW FAR ROUND HE IS, 0..1 over the whole spin.
//
// Section 14's rule is that the rotation starts in the lower body and arrives in
// the torso, so this returns BOTH and they are deliberately out of step. Give
// them the same number and every part of the sprite turns on the same frame,
// which is the rigid-sprite look the section exists to rule out.
// How far the torso leans into a euro's weight transfer. 2px on a 10px body:
// the same budget MOMENTUM_LEAN_PX runs to, because past that a lean stops
// reading as weight and starts reading as a man falling over.
const EURO_LEAN_PX = 2;
const SPIN_TORSO_LAG = 0.16;

function spinTurn(u) {
  const legs = Math.max(0, Math.min(1, u));
  const torso = Math.max(0, Math.min(1, (u - SPIN_TORSO_LAG) / (1 - SPIN_TORSO_LAG)));
  return { legs: legs, torso: torso };
}

// A turn drawn on a body ten pixels across is four states, not an angle: facing
// one way, back to the camera, facing the other, back again. `back` is what
// sells it — without the back-of-the-head frame a spin is a sprite flipping,
// which reads as a glitch rather than as a man turning.
function turnFacing(u, from) {
  const q = (Math.max(0, Math.min(1, u)) * 4) % 4;
  const back = (q >= 0.75 && q < 1.25) || (q >= 2.75 && q < 3.25);
  const flipped = q >= 1.25 && q < 2.75;
  return { facing: flipped ? -(from || 1) : (from || 1), back: back };
}

function closeLiftAt(kf) {
  const c = kf && kf.close;
  if (!c) return 0;
  // The approach phases come first and have their own (floor-level) heights.
  const ap = approachLiftAt(kf);
  if (ap !== null) return ap;
  const table = closeLiftTable(c.finish);
  return table[c.phase] !== undefined ? table[c.phase] : 0;
}

// How far above his own feet a player holds the ball at full extension, by
// shot kind. These are the numbers the finished poses already used and they do
// not move — what changed is how the ball GETS here (see heldBallOffset).
const JUMP_BALL_HIGH = 26;
const DUNK_BALL_HIGH = 30;
// A shot that is neither a dunk nor a jumper — a layup, a floater, a putback.
const CLOSE_BALL_HIGH = 24;

function motionLerp(a, b, f) { return a + (b - a) * f; }

// How long a leaper takes to come down, in real ms, regardless of how long the
// beat he comes down on happens to be.
//
// The descent is deliberately NOT spread across the beat. The last beat of a
// jump shot is the ball's whole flight (650-850ms), and easing him down over
// all of it would leave him hanging in the air until the ball reached the rim.
// A layup has the same problem for the same reason; a dunk does not, because
// its landing beat is already short and shaped for it.
const DESCENT_MS = { jump: 170, close: 200 };

// One leaper, resolved. Factored out because the layup needs precisely what the
// jumper already had, and a third copy of this arithmetic is a third place for
// the descent to be got subtly wrong.
function resolveLeaper(a, b, f, liftAt, markerKey, descentMs) {
  const ma = a[markerKey], mb = b[markerKey];
  const id = (ma && ma.id) || (mb && mb.id) || null;
  if (!id) return { id: null, lift: 0 };
  const la = liftAt(a), lb = liftAt(b);
  const spanMs = Math.max(1, b.t - a.t);
  const falling = lb < la;
  // Descent runs on its own clock; the rise still uses beat progress.
  const jf = (falling && descentMs) ? Math.min(1, f * (spanMs / descentMs)) : f;
  const ef = lb > la ? 1 - Math.pow(1 - jf, 2) : Math.pow(jf, 1.4);
  const lift = Math.round(la + (lb - la) * ef);
  return { id: id, lift: lift };
}

// Who is airborne on this frame and by how much.
//
// Resolved for the whole frame rather than per sprite because the ball needs
// it too: after the slam the holder is null, so the dunker's id has to come
// off the keyframe rather than off the ball.
function resolveLifts(a, b, f, reduceMotion) {
  const dunkA = a.dunk, dunkB = b.dunk;
  const dunkerId = (dunkA && dunkA.id) || (dunkB && dunkB.id) || null;
  // WHICH dunk. The choreographer stamps the catalogue id on every phase of the
  // string; `dunkStyleOf` is injected rather than required so this file keeps no
  // dependency on ui/pixelDunks.js and the probes can load it alone.
  const dunkMark = (dunkA && dunkA.id ? dunkA : (dunkB || null));
  const dunk = dunkMark && dunkMark.dunk ? dunkMark.dunk : null;
  let dunkerLift = 0, dunkerRoute = 0, dunkerRising = 0, dunkerAir = 0;
  if (dunkerId && !reduceMotion) {
    const la = dunkLiftAt(a, dunk), lb = dunkLiftAt(b, dunk);
    // ...minus whatever the body in his way cost him. Subtracted from the climb
    // rather than capping it: he is checked and keeps going, which is the
    // difference between a contact dunk and a blocked one.
    dunkerLift = Math.round(dunkTakeoff(la, lb, f) -
      contactCheck((b.dunk && b.dunk.phase) || null, f, dunkMark && dunkMark.contact));
    // The ball's own clock through the route. Linear: the route functions carry
    // their own easing, and easing this too would double it.
    const ra = dunkRouteAt(a), rb = dunkRouteAt(b);
    dunkerRoute = ra + (rb - ra) * f;
    // The pose's own clock. Eased slightly against the lift rather than with it:
    // the body snaps up, the limbs sweep. Moving every part on one curve is what
    // makes a sprite read as one rigid object.
    const sa = dunkRiseAt(a), sb = dunkRiseAt(b);
    dunkerRising = sa + (sb - sa) * (sb > sa ? 1 - Math.pow(1 - f, 1.5) : Math.pow(f, 1.3));
    const aa = dunkAirAt(a), ab = dunkAirAt(b);
    dunkerAir = aa + (ab - aa) * f;
  }

  const jumper = reduceMotion ? { id: null, lift: 0 }
    : resolveLeaper(a, b, f, jumpLiftAt, 'jump', DESCENT_MS.jump);
  const jumpA = a.jump;
  const spanMs = Math.max(1, b.t - a.t);
  const jumperId = (jumpA && jumpA.id) || (b.jump && b.jump.id) || null;
  const jumperLift = jumper.lift;
  // Follow-through runs from the release, for as long as the ball is in the
  // air — but capped. Left uncapped it rode the 'follow' keyframe into the
  // rebound beat as well, so shooters stood posing with their hand up for
  // 1.6s while the board was being fought for.
  const jumpFollow = !reduceMotion &&
    !!(jumpA && jumpA.phase === 'release' &&
       f * spanMs < followWindow(jumpA.made));

  // The layup, on exactly the machinery the jumper uses.
  const closer = reduceMotion ? { id: null, lift: 0 }
    : resolveLeaper(a, b, f, closeLiftAt, 'close', DESCENT_MS.close);
  const closeMark = (a.close && a.close.id ? a.close : (b.close || null));

  // The signed lifts stay exactly as they were — the ball reads them and its
  // path must not move. `*Foot` and `*Crouch` are the same numbers split for
  // the sprite: feet off the floor, and knees bent with the feet down.
  const dunkPose = liftToPose(dunkerLift);
  const jumpPose = liftToPose(jumperLift);
  const closePose = liftToPose(closer.lift);
  return {
    dunkerId: dunkerId, dunkerLift: dunkerLift,
    dunkerFoot: dunkPose.foot, dunkerCrouch: dunkPose.crouch,
    dunkerRoute: dunkerRoute,
    dunkerRising: dunkerRising,
    dunkerAir: dunkerAir,
    dunkerStyle: (dunk && dunk.path) || 'power',
    dunkerDunk: dunk,
    jumperId: jumperId, jumperLift: jumperLift, jumpFollow: jumpFollow,
    jumperFoot: jumpPose.foot, jumperCrouch: jumpPose.crouch,
    closerId: closer.id, closerLift: closer.lift,
    closerFoot: closePose.foot, closerCrouch: closePose.crouch,
    closerFinish: (closeMark && closeMark.finish) || 'standard',
    closerSide: (closeMark && closeMark.side) || 1
  };
}

// THE LANDING, which until now did not exist.
//
// Measured over four games, the dunk's `land` beat is 130ms during which 100%
// of players hold a keyframe position exactly — and the sprite cuts from the
// airborne pose (legs tucked, arm over the head) straight back to standing on
// one frame. A leap that ends by snapping to idle throws away the whole leap:
// there is no contact, no compression, no recovery, so nothing on screen says
// the man just came down off the rim carrying his own weight.
//
// This is a curve on REAL time since the feet touched, not on beat progress,
// for the same reason the jump-shot descent is: the beat that follows a landing
// is whatever the possession does next and can be four times as long as the
// landing should be. Compression is fast and recovery is slower — that ratio is
// what makes it read as weight rather than as a bounce.
const LANDING_COMPRESS_MS = 70;
const LANDING_RECOVER_MS = 190;
const LANDING_SQUASH_PX = { dunk: 4, jump: 2, close: 3 };

// HOW HE CAME DOWN, which the game has been deciding and then throwing away.
//
// ui/pixelDunks.js's dunkLanding() has been classifying every dunk into one of
// these four since it was written, the choreographer stamps the answer on every
// keyframe of the string — and nothing has ever read it. Four landings were
// computed and one landing was drawn, which is section 18's complaint exactly.
//
// The multipliers are on the DEPTH and the RECOVERY, not on new poses: a heavy
// landing is the same movement absorbed harder and held longer, and that is
// what actually separates them at this size. `lean` is the only addition, and
// only two of the four have one — a man who lands balanced does not stagger.
const LANDING_STYLE = {
  heavy: { depth: 1.35, recover: 1.30, lean: 0 },
  balance: { depth: 1.0, recover: 1.0, lean: 0 },
  light: { depth: 0.6, recover: 0.7, lean: 0 },
  // He did not get his feet under him: shallower into the floor because he never
  // set to absorb it, longer to sort out, and carried sideways while he does.
  stumble: { depth: 0.85, recover: 1.7, lean: 2 }
};

function landingStyle(style) {
  return LANDING_STYLE[style] || LANDING_STYLE.balance;
}

function landingSquashPx(kind, style) {
  const base = LANDING_SQUASH_PX[kind] !== undefined
    ? LANDING_SQUASH_PX[kind] : LANDING_SQUASH_PX.jump;
  return base * landingStyle(style).depth;
}

// Which way the stagger carries him, decaying over the recovery. Zero for the
// two landings that are under control, which is most of them.
function landingLean(ms, kind, style, dirX) {
  const st = landingStyle(style);
  if (!st.lean || typeof ms !== 'number' || ms < 0) return 0;
  const total = LANDING_COMPRESS_MS + LANDING_RECOVER_MS * st.recover;
  if (ms >= total) return 0;
  return st.lean * (1 - ms / total) * ((dirX || 0) >= 0 ? 1 : -1);
}

// Returns the knee bend, in pixels, `ms` after the feet touched. Zero before
// contact and zero once recovered, so a caller can hold a stale stamp forever
// and simply get nothing — which is what makes it safe to seek into.
function landingSquash(ms, kind, style) {
  if (typeof ms !== 'number' || ms < 0) return 0;
  const peak = landingSquashPx(kind, style);
  if (ms < LANDING_COMPRESS_MS) {
    // Into the floor. Eased out so the deepest point is approached rather than
    // hit on one frame — a linear ramp here reads as a stutter at this size.
    const f = ms / LANDING_COMPRESS_MS;
    return peak * (1 - Math.pow(1 - f, 2));
  }
  const g = (ms - LANDING_COMPRESS_MS) / (LANDING_RECOVER_MS * landingStyle(style).recover);
  if (g >= 1) return 0;
  // Back up, unhurried. Slower out than in is the whole point: it is the
  // difference between absorbing a landing and rebounding off the floor.
  return peak * Math.pow(1 - g, 1.7);
}

const LANDING_TOTAL_MS = LANDING_COMPRESS_MS + LANDING_RECOVER_MS;

// HAS HE JUST LANDED? Compares the foot lift on the previous drawn frame with
// this one.
//
// This is a frame-to-frame test rather than something the lift curve reports,
// and that is not a stylistic choice — the first version had `resolveLeaper`
// hand back "how long ago the feet touched", solved from the easing. It was
// correct and it was useless: a dunk's fall is `round(13 * (1 - f^1.6))` over a
// 130ms beat, so the window between the lift rounding to zero and the beat
// ending is **3.1ms wide**. A renderer stepping 16.7ms at a time walks straight
// over it about four times in five, and the landing simply never fires.
//
// A transition test cannot miss, because the view asks it on every frame it
// actually draws — whatever the beat lengths, whatever the playback speed.
function justLanded(prevFoot, foot) {
  return typeof prevFoot === 'number' && prevFoot > 0 && foot <= 0;
}

// RIM CONTACT. The one impact in the game that happens in mid-air.
//
// A dunk's slam beat already drops the body 3px (lift 16 -> 13) and rattles the
// rim, but the DUNKER did not react to the thing he just hit — he descended at
// the same rate whether he had thrown it down or floated past. This is his
// half of that collision: a fast fold as he catches the rim and pulls down
// through it, gone before he starts to fall.
//
// Much shorter than a landing and not a landing curve reused, because the two
// are opposite events. A landing is weight arriving on a fixed floor and has to
// settle out of it slowly. This is weight being driven THROUGH something, and
// the recovery is the leap continuing — so it snaps back rather than easing.
const RIM_HIT_MS = 120;
const RIM_HIT_PX = 3;

function rimHitSquash(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms >= RIM_HIT_MS) return 0;
  const f = ms / RIM_HIT_MS;
  // A single hump: nothing at contact, hardest a third of the way in, gone by
  // the end. Starting at zero is what keeps it from popping on the frame it
  // arms, the same rule the landing follows.
  return RIM_HIT_PX * Math.sin(Math.pow(f, 0.6) * Math.PI);
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
// EVERY PLAYER DRIBBLED AT THE SAME RHYTHM, which sat oddly beside the idle
// breathing three files away that deliberately gives each man his own period so
// ten sprites never pulse in unison. A quick guard and a slow big pounding it
// out at an identical 140ms metronome is the same tell, on the beat the eye
// actually watches.
//
// Derived from the player id rather than rolled, for the reason everything in
// this file is: a replay has to look like the game it is replaying, and an rng
// draw here would make the same possession dribble differently on a second
// viewing. It also never touches the game rng, which decides outcomes.
//
// Deliberately narrow. ±12% is a fifth of the gap between the set and moving
// tempos, so it reads as personality rather than as the tempo gate flickering —
// and the gate is what put a 12px teleport in the ball's path once already.
const DRIBBLE_TEMPO_SPREAD = 0.12;

function dribbleTempoFor(playerId) {
  if (!playerId) return 1;
  const s = String(playerId);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  // AVALANCHE, and it is not optional. A plain rolling hash of a short string
  // like "p12" leaves the high bits nearly constant, so the first version of
  // this produced tempos spanning 0.880 to 0.941 across four hundred ids —
  // every player slower than the baseline, and the whole league within six
  // percent of each other. The variation existed in the arithmetic and not on
  // the screen. Same mixing the choreographer's roll01 uses, for the same
  // reason.
  h = (Math.imul(h ^ (h >>> 16), 2246822507) ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h ^ (h >>> 15), 3266489909)) >>> 0;
  const u = (h >>> 8) / 16777216;
  return 1 + (u * 2 - 1) * DRIBBLE_TEMPO_SPREAD;
}

// ...AND THE SITUATION, not just the man.
//
// Per-player tempo fixed one tell and left another: a handler being picked up
// full-court pounded it out at exactly the rhythm of one walking it up, and
// `ballHandling` fed the dribble COUNT and nothing about how it looked. Both
// pull the same way in real basketball — a good handler keeps it quicker and
// tighter, and a man being pressured keeps it quicker and lower — so both feed
// the same number.
//
// Small on purpose, and smaller than the per-player spread. The tempo gate
// between the set and moving periods is what put a 12px teleport in the ball's
// path once already (see stepDribbleClock); anything that moves the period
// around a lot is walking back toward that.
const HANDLE_TEMPO_SPREAD = 0.08;
const PRESSURE_TEMPO_SPREAD = 0.10;
// How close a defender has to be to count as pressure, in stage px. A body is
// 10px wide and the separation pass holds men 11px apart, so 26 is roughly
// "close enough to reach in" without firing on everyone in the half-court.
const PRESSURE_NEAR_PX = 26;
const PRESSURE_FAR_PX = 60;

// 0 when the nearest defender is off him, 1 when he is right up on him.
function pressureFrom(distPx) {
  if (typeof distPx !== 'number') return 0;
  if (distPx <= PRESSURE_NEAR_PX) return 1;
  if (distPx >= PRESSURE_FAR_PX) return 0;
  return (PRESSURE_FAR_PX - distPx) / (PRESSURE_FAR_PX - PRESSURE_NEAR_PX);
}

// The whole tempo for a handler right now: who he is, how good he is, and how
// hard he is being guarded. Multiplied rather than added so each factor is a
// proportion of the period and none of them can drive it to zero.
function handlerTempo(playerId, handleSkill, pressure) {
  const h = typeof handleSkill === 'number' ? handleSkill : 50;
  const p = Math.max(0, Math.min(1, pressure || 0));
  // A 95-rated handler runs 7% quicker than the baseline, a 40-rated one 1.6%
  // slower. Same gentleness as DRIBBLE_SKILL_SHIFT, and for the same reason:
  // a cliff between two adjacent ratings is what went wrong last time.
  const skill = 1 - ((h - 50) / 50) * HANDLE_TEMPO_SPREAD;
  const press = 1 - p * PRESSURE_TEMPO_SPREAD;
  return dribbleTempoFor(playerId) * skill * press;
}

// `tempo` scales the period: above 1 is a slower, heavier handle. Passed in
// rather than looked up so this stays a pure function of its arguments.
function stepDribbleClock(u, dtMs, holderMoving, tempo) {
  const base = holderMoving ? DRIBBLE_PERIOD_MOVING : DRIBBLE_PERIOD_SET;
  const t = typeof tempo === 'number' && tempo > 0 ? tempo : 1;
  return u + dtMs / (Math.PI * base * t);
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
  // A DRIVE is the same answer for the same reason: he is going somewhere, not
  // beating anybody. The ball stays on one hand and travels with him — a
  // crossing here would put a move in front of a finish that is not a move, it
  // is an approach.
  if (move === 'drive') return [];
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
  // BETWEEN THE LEGS, which the game did not have — and which the animation lab
  // was mislabelling the double move as, so it looked like it did.
  //
  // The opposite extreme from behind-the-back on both axes that matter: that
  // one goes WIDE and stays UP, around a handler whose shoulders stay square.
  // This one goes NARROW and hard DOWN, through the middle of a stance he has
  // to open to make room for. `legs` is what tells the sprite to open it —
  // without that it is a crossover with a lower bounce, which is exactly the
  // "same rectangles sliding sideways" failure the named moves exist to escape.
  if (move === 'legs') return [{ at: Math.floor(n / 2), wide: 5, low: 0.95, legs: true }];
  // THE STEPBACK, and the one thing that makes it different in kind from every
  // move above: the ball does NOT change hands. He rides it, plants, and pushes
  // away from the man — the separation is made with his feet, not by moving the
  // ball across his body. Every other entry in this table is a hand change with
  // a shape attached, so `noSwitch` exists to say "shape the ball here, but
  // this is not a crossing".
  //
  // Driven hard into the floor (`low` 0.85, the hardest in the table) because
  // that push-off dribble is what he shoves against to go backwards, and kept
  // narrow — a stepback that swings the ball wide is a crossover.
  if (move === 'stepback') return [{ at: Math.floor(n / 2), wide: 7, low: 0.85, noSwitch: true }];
  return [{ at: Math.floor(n / 2), wide: 10, low: 0.65 }];
}

// How many of a move's crossings actually change hands. `dribbleClockAfterMove`
// needs this rather than the raw count: resuming the free clock in the wrong
// hand is the "second, uninvited hand change" defect that function exists to
// prevent, and a stepback would trigger it by having a crossing that is not one.
function handSwitchCount(move, n) {
  const cs = dribbleCrossings(move, n);
  let k = 0;
  for (let i = 0; i < cs.length; i++) if (!cs[i].noSwitch) k += 1;
  return k;
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
// ...and how much of the BACK of it the body spends uncoiling into the move.
// The ball has no equivalent: it drops out of the hold in one frame, and that
// snap is the point. See where `hesi` is computed.
const HESITATION_RELEASE = 0.1;

// How much of the string is spent easing into and out of the scripted path.
// The move must not simply replace the free dribble: the ball is somewhere when
// the string starts, and teleporting it to wherever the script wants it is the
// branch-change snap this file exists to prevent.
const MOVE_BLEND_BEATS = 0.5;

// How deep the coil goes at the top of a hesitation. Small — he is gathering,
// not squatting — but on a 24px body one pixel of sink under a held ball is
// the difference between a man waiting and a man about to go.
const HESI_CROUCH_PX = 1.5;

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
  // How deep into the hesitation he is, 0..1. Reported out so the BODY can
  // coil with the ball instead of standing straight through it: the hold was
  // only ever a ball behaviour, so a defender watched a man stand perfectly
  // upright while the ball hung in front of him, which is not what a hesitation
  // looks like from either end.
  let hesi = 0;
  // How far through his own stance the ball is being driven, 0..1. Only a move
  // that says `legs` reports it — a crossover goes across his front and a
  // behind-the-back goes round his back, and opening the stance for either
  // would be the pose contradicting the ball.
  let through = 0;

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
    if (u > c.at && !c.noSwitch) passed += 1;
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
      // The BALL's hold ends abruptly — it simply drops into the move, and that
      // snap is the move starting. The BODY cannot: `ease` goes 0 -> 1 and then
      // cliffs to zero the instant the switch window opens, so a crouch driven
      // straight off it would coil, hold, and then straighten in a single
      // frame. Fading the last tenth of a beat is the uncoil, which is the half
      // of "slow, pause, explode" that a hold on its own cannot say.
      const releaseFade = Math.min(1, backFromSwitch / HESITATION_RELEASE);
      hesi = ease * releaseFade;
    }
  }

  if (active) {
    const mid = 1 - Math.abs(2 * d);   // 1 at the plant, 0 at the edges of the switch
    if (active.noSwitch) {
      // A stepback drives the ball down without moving it across him. `sign`
      // holds the hand it is already in, which is also exactly what the bounces
      // either side of this window hold — so the path stays continuous without
      // the sweep the other moves need.
      sign = hand;
    } else {
      // The hand this crossing ENDS in. Before the plant `hand` is still the old
      // one and after it is already the new one, so the target flips with d --
      // which is what keeps sign continuous across the middle.
      const to = d > 0 ? hand : -hand;
      sign = to * (2 * d);
    }
    phase = Math.max(0, Math.min(1, phase - active.low * mid * phase));
    if (active.legs) through = mid;
    if (active.behind) {
      phase = Math.max(phase, 0.5 + 0.35 * mid);
      behind = active.behind * mid;
    }
  } else {
    sign = hand;
  }
  return { sign: sign, side: side, phase: phase, behind: behind, crossing: !!active, hesi: hesi, through: through };
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
  // Counted over HAND SWITCHES, not crossings. A stepback has a crossing that
  // deliberately does not change hands, and counting it here would resume the
  // free clock in the wrong hand — the uninvited second hand change this
  // function exists to prevent, arriving through the back door.
  const odd = handSwitchCount(move, n) % 2;
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
  if (!move || !move.move) return { sign: free.sign, side: DRIBBLE_SIDE, phase: free.phase, behind: 0, crossing: free.crossing, hesi: 0, through: 0 };
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
    // Blended at the ends like everything else, so the coil eases in with the
    // move rather than switching on when the string opens.
    hesi: scripted.hesi * w,
    through: scripted.through * w,
    crossing: scripted.crossing && w > 0.5
  };
}

// THE WEIGHT UNDER THE DRIBBLE.
//
// The dribble pose animated arms and nothing else: the ball swung 15px around a
// man whose torso never moved, so a crossover was a prop travelling past a
// statue. A handler's weight is over the hand the ball is in, and a crossover
// is that weight crossing — which is why this rides `sign`, the same value the
// ball and the dribbling arm already share. Nothing here can disagree with
// where the ball is, because it is derived from where the ball is.
//
// It is also continuous by construction, which is the property this file cares
// about most. `sign` sweeps -1 -> 0 -> +1 through the floor contact, so the
// lean passes through upright exactly as the ball passes his centre line. An
// instant flip would be the torso teleporting, which is the same defect class
// as the ball teleporting and reads worse.
//
// Small numbers on purpose. The body is 10px wide; 2px of lean is a fifth of
// him, which at this size is a pronounced shift rather than a subtle one.
const DRIBBLE_LEAN_PX = 1;
const CROSS_LEAN_PX = 2;

function dribbleLean(now) {
  if (!now) return 0;
  const amp = now.crossing ? CROSS_LEAN_PX : DRIBBLE_LEAN_PX;
  return amp * now.sign;
}

// CONTACT. Two bodies meeting, which until now happened silently.
//
// The view already resolves overlapping sprites every frame by shoving them
// apart — and then drew both of them as though nothing had touched, so a
// crowded drive was players sliding through each other and popping out the
// far side. That shove is a measurement of contact nobody was reading.
//
// Measured over three games, the shove the separator applies per player-frame:
//
//     nonzero on 8.2% of player-frames
//     of those:  p50 0.1   p75 0.4   p90 0.9   p99 2.3   max 7.72 px
//
// So ordinary crowding is a tenth of a pixel and a real bump is past about one.
// The floor sits at p90-of-nonzero, which is ~0.8% of all player-frames — often
// enough to make the paint feel physical, rare enough to stay an accent.
const CONTACT_MIN_PX = 1.0;
const CONTACT_FULL_PX = 3.0;
const CONTACT_MS = 180;
const CONTACT_LEAN_PX = 2;
const CONTACT_CROUCH_PX = 1.5;

function contactStrength(shovePx) {
  const s = shovePx || 0;
  if (!(s > CONTACT_MIN_PX)) return 0;
  return Math.min(1, (s - CONTACT_MIN_PX) / (CONTACT_FULL_PX - CONTACT_MIN_PX));
}

// Held briefly rather than drawn on the single frame the shove happened. A
// shove is spiky — a body can be pushed hard on one frame and not at all on the
// next — and a lean that follows it frame for frame is a flicker, not a bump.
function contactDecay(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms >= CONTACT_MS) return 0;
  return Math.pow(1 - ms / CONTACT_MS, 1.5);
}

// THE POSE PRIORITY, stated once.
//
// The order was real but it was never written down: it lived half in the
// if-chain inside drawPlayerSprite and half in a growing pile of negations at
// the call site — `!shooting && !isJumperNow && !dunkPose && !layupPose &&
// !jumpFollow` — where every new pose meant remembering to exclude it from
// every earlier one. That is the shape a state conflict arrives in: not as a
// wrong rule, but as one place out of five that did not get updated.
//
// Highest first. A man dunking is not also dribbling; a man in his
// follow-through is not also taking a jump shot.
// THE DEFENSIVE STANCE, which did not exist.
//
// Half of every possession is a man guarding somebody, and all of it was drawn
// with the idle pose and the running pose — the same two shapes as a man
// standing on the weak side with nothing to do. Five sprites per team doing
// nothing recognisable is the largest single block of unanimated basketball in
// the game, and it is on screen the entire time.
//
// Two numbers, both derived rather than stored:
//
//   depth    how far he is sitting down in it. Deepest on the ball, easing off
//            with distance — a man forty feet from the play is not in a stance,
//            he is standing, and drawing him crouched is as wrong as drawing
//            the on-ball defender upright.
//   contest  a hand up. Only when the man he is near is actually going up.
//
// He also has to STOP defending to run: you do not slide the length of the
// floor. Past a jog the stance releases and the running pose takes over, which
// is what the speed term does.
const DEFEND_ON_BALL_PX = 26;      // inside this he is guarding the ball
const DEFEND_FAR_PX = 74;          // beyond this he is just standing
const DEFEND_MAX_SPEED = 70;       // px/s past which he is running, not sliding
const CONTEST_PX = 30;             // near enough for a hand to matter

function defenseStance(distToBall, speed, shooterUp) {
  const d = typeof distToBall === 'number' ? distToBall : Infinity;
  if (d >= DEFEND_FAR_PX) return { depth: 0, contest: 0 };
  // Released by speed: a sprinting defender is a runner.
  const s = Math.max(0, Math.min(1, 1 - (Math.abs(speed || 0) / DEFEND_MAX_SPEED)));
  const near = d <= DEFEND_ON_BALL_PX ? 1
    : 1 - (d - DEFEND_ON_BALL_PX) / (DEFEND_FAR_PX - DEFEND_ON_BALL_PX);
  const depth = Math.max(0, Math.min(1, near * s));
  // The hand goes up only if there is something to contest, and only from
  // close enough that it would bother the shooter.
  const contest = shooterUp && d <= CONTEST_PX ? Math.max(0, Math.min(1, s)) : 0;
  return { depth: depth, contest: contest };
}

// HOW TIRED HE LOOKS, 0 fresh to 1 spent.
//
// The sim has tracked energy since it was written and the sprite has never
// looked at it: a man in his fortieth minute moves exactly like one who checked
// in thirty seconds ago.
//
// Normalised against the range a real game actually produces rather than
// against the full 0..1 the number nominally spans. Measured over a game, the
// tiredest man on the floor ends around 0.74 and nobody goes below it, so
// scaling by the nominal range would turn the whole effect into a rounding
// error — 0.26 of a pixel, drawn as nothing.
const FATIGUE_FLOOR = 0.70;
// A pixel of shoulder. It is small on purpose: this is on every player for the
// whole second half, and anything bigger stops being posture and becomes a
// limp. It rides the WAIST fold, which is where tiredness actually shows.
const FATIGUE_DROOP_PX = 1;

function fatigueLevel(energy) {
  if (typeof energy !== 'number') return 0;
  return Math.max(0, Math.min(1, (1 - energy) / (1 - FATIGUE_FLOOR)));
}

// Energy at a point in the game. The box score is final, so this walks back
// from it: fresh at the tip, wherever he ended up at the buzzer.
function energyAt(finalEnergy, progress) {
  const e = typeof finalEnergy === 'number' ? finalEnergy : 1;
  const p = Math.max(0, Math.min(1, progress || 0));
  return 1 - (1 - e) * p;
}

const POSE_ORDER = [
  'dunking',    // at the rim, ball overhead
  'layup',      // airborne finish, one knee driven
  'following',  // jump-shot follow-through, hand still up
  'shooting',   // rising into a shot, both arms up
  'stumbling',  // beaten off the dribble
  'dribbling',  // working the ball
  // Below dribbling because a defender never has the ball, and ABOVE moving
  // because a man in a stance is doing something more specific than travelling.
  // The speed term in defenseStance is what keeps a sprinting defender out of
  // it — otherwise every man running the floor in transition slides up it.
  'defending',  // in a stance, guarding somebody
  'moving',     // running
  'idle'
];

// Takes a flag bag and returns the ONE pose that wins. Everything the view
// draws is derived from this, so two poses cannot be live at once by
// construction rather than by five call sites agreeing.
function posePriority(flags) {
  const f = flags || {};
  for (let i = 0; i < POSE_ORDER.length; i++) {
    const name = POSE_ORDER[i];
    if (name === 'idle') return 'idle';
    if (f[name]) return name;
  }
  return 'idle';
}

// WHEN THE BALL DEFORMS, which is: rarely.
//
// A 3px ball has exactly one deformation available (see ballShape), so the
// question is entirely about when to spend it. Two moments earn it.
//
// SPEED. Measured over four games, ball travel runs ~366px/s on an ordinary
// catch and ~100px/s through a shot's flight. The threshold sits at 900 so an
// ordinary pass stays round and only a ball genuinely driven across the floor
// flattens — which is the whole discipline the brief asks for: impact reads
// stronger because the normal animation is controlled.
//
// A HARD BOUNCE, and only a hard one. Every dribble contacts the floor about
// four times a second, and flattening on all of them is not an accent, it is a
// flicker the eye reads as a rendering fault. So this is reserved for the
// push-off dribbles inside a named move, where the handler is genuinely driving
// it into the floor.
const BALL_SQUASH_SPEED = 900;
const BALL_BOUNCE_PHASE = 0.12;

function ballSquash(vx, vy, hardBounce, bouncePhase) {
  const speed = Math.sqrt((vx || 0) * (vx || 0) + (vy || 0) * (vy || 0));
  let s = Math.min(1, speed / BALL_SQUASH_SPEED);
  if (hardBounce && typeof bouncePhase === 'number' && bouncePhase < BALL_BOUNCE_PHASE) {
    // Hardest exactly at the floor and easing off it, so the flatten arrives
    // with the contact rather than lingering on the way back up.
    s = Math.max(s, 1 - bouncePhase / BALL_BOUNCE_PHASE);
  }
  return s;
}

// MOMENTUM: the body reacting to its own change of speed.
//
// This is one mechanism doing the job of three things the brief asks for
// separately — the stepback's upper body fighting the backward push, the
// sprint-to-stop plant, and the lean through a change of direction. They are
// all the same event: a body whose feet have changed what they are doing before
// the rest of him has caught up. Writing them as one is not a shortcut; three
// bespoke rules would be three chances for a player to lean two ways at once.
//
// THE NUMBERS ARE MEASURED, not chosen. Over three games, sampling every
// player on every frame through the real spring:
//
//     acceleration   p50 63    p90 798   p99 2949   p99.9 5443   max 37789
//     speed          p50 13    p90 255   p99 620 (the step ceiling)
//
// So `LEAN_ACCEL_FULL` sits at p99: the top 1% of direction changes lean all
// the way, and the ordinary drift that makes up half of all frames leans by
// about a thirtieth of a pixel, which rounds to nothing and draws nothing.
const LEAN_ACCEL_FULL = 3000;
const MOMENTUM_LEAN_PX = 2;

// He leans INTO the acceleration — forward as he pushes off, back as he brakes.
// (Getting this backwards is the classic version of this effect looking wrong
// without anyone being able to say why.)
function momentumLean(ax) {
  const k = Math.max(-1, Math.min(1, (ax || 0) / LEAN_ACCEL_FULL));
  return MOMENTUM_LEAN_PX * k;
}

// How hard he is BRAKING, as opposed to accelerating: the component of
// acceleration opposing the direction he is actually travelling. A plant is a
// deceleration, and using raw acceleration magnitude here would have players
// crouching as they launch into a sprint.
//
// Below a real speed there is nothing to plant against — a man drifting at
// 13px/s who stops has not stopped, he has stood still — so the whole thing is
// gated on moving first.
const PLANT_MIN_SPEED = 40;
const PLANT_ACCEL_MIN = 1800;
const PLANT_ACCEL_FULL = 5000;
const PLANT_CROUCH_PX = 2;

function brakingRate(vx, vy, ax, ay) {
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp < PLANT_MIN_SPEED) return 0;
  return Math.max(0, -((ax * vx + ay * vy) / sp));
}

// ...and what that braking does to his knees. Between p90 and p99.9 of the
// measured distribution, so an ordinary change of pace does nothing and a hard
// stop folds him.
function plantCrouch(braking) {
  if (!(braking > PLANT_ACCEL_MIN)) return 0;
  const f = Math.min(1, (braking - PLANT_ACCEL_MIN) / (PLANT_ACCEL_FULL - PLANT_ACCEL_MIN));
  return PLANT_CROUCH_PX * f;
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
// A marked layup gathers on its own rise, exactly like the other two finishes —
// and against ITS OWN apex, because a floater tops out at 6px and a reverse at
// 9. Measuring all three against the standard 8 would leave the floater's ball
// permanently short of full extension and over-extend the reverse.
function closeCock(lift, finish) { return cockTo(lift, closeLiftTable(finish).rise); }
// An UNMARKED finish at the rim — a tip-in, a putback, anything under reduced
// motion — is still a plain beat that happens to end with the ball gone, so its
// gather runs on beat progress. Kept as its own function rather than folded in,
// because the two take different units and mixing them silently saturates the
// blend at one end or never reaches it at the other.
function closeCockAtBeat(f) { return Math.max(0, Math.min(1, f)); }

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
  // Identity first, for the same reason the other two branch on it. The
  // heuristic below it is kept as the fallback for finishes at the rim that
  // carry no phase markers — a tip-in, a putback, and anything under
  // prefers-reduced-motion, where the marker path is switched off entirely.
  if (s.holder === s.lifts.closerId && !s.reduceMotion) return 'close';
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
    // A marked layup rides its own phases like the other two finishes; an
    // unmarked one (tip-in, putback, reduced motion) still rides beat progress.
    const marked = mode === 'close' && s.holder === s.lifts.closerId;
    const lift = mode === 'jump' ? s.lifts.jumperLift
      : mode === 'dunk' ? s.lifts.dunkerLift
      : (marked ? s.lifts.closerLift : closeLift(s.f));
    const cock = mode === 'jump' ? jumpCock(s.lifts.jumperLift)
      : mode === 'dunk' ? dunkCock(s.lifts.dunkerLift)
      : (marked ? closeCock(s.lifts.closerLift, s.lifts.closerFinish) : closeCockAtBeat(s.f));
    let off = heldBallOffset(mode, lift, cock, drib);
    let behind = 0;

    // THE DUNK'S ROUTE. Every dunk used to run the same straight blend from the
    // dribble up to 30px on the finishing side, so a windmill, a tomahawk and a
    // quick lay-in moved the ball along an identical line and differed only in
    // how high the body got.
    //
    // `s.dunkPath` is injected rather than imported: this file has no
    // dependencies and that is worth keeping, so the caller (the view, a probe,
    // the lab) hands in ui/pixelDunks.js's dunkBallPath and there is still only
    // one copy of the routes. Without it the old straight blend still applies,
    // which is what keeps an un-marked dunk working.
    if (mode === 'dunk' && typeof s.dunkPath === 'function') {
      const t = s.lifts.dunkerRoute || 0;
      // The feet are handed over so the route can solve its terminal against the
      // FLOOR — a rim is at a fixed height, and a terminal measured from his feet
      // quietly moved the hoop by how high he jumped.
      const route = s.dunkPath(s.lifts.dunkerStyle || 'power', t, s.lifts.dunkerFoot);
      if (t > 0) {
        // Straight onto the route, with nothing to blend out of.
        //
        // This used to re-blend from the dribble over the first quarter of the
        // route — correct when routes began at his feet, and a defect the moment
        // they began in his hands. The two blends fought: the windup had already
        // carried the ball up to the origin, and then the first frame of the rise
        // weighted `t/0.25` at nearly zero and yanked it back down to dribble
        // height. The ball fell 5px out of his hands at the exact instant he left
        // the floor, and climbed the same 5px again. Continuous by construction
        // now, because the gather ends where the route starts.
        off = { up: route.up, side: route.side };
        behind = route.back || 0;
      } else {
        // THE GATHER, which did not exist. The route clock is pinned at 0 for
        // the whole windup — that is deliberate, a gather is not ball travel —
        // so for those two beats nothing moved the ball at all and it stayed
        // down at dribble height, bouncing, until he was already climbing. He
        // never picked it up.
        //
        // So bring it up into his hands across the gather and the plant, ending
        // exactly where the route begins. The destination is read from the route
        // itself rather than restated here, so the two cannot drift apart.
        const startAt = s.dunkPath(s.lifts.dunkerStyle || 'power', 0, s.lifts.dunkerFoot);
        const g = dunkGatherProgress((s.b.dunk && s.b.dunk.phase) || null, s.f);
        off = {
          up: drib.up + (startAt.up - drib.up) * g,
          side: drib.side + (startAt.side - drib.side) * g
        };
      }
    }

    let bx = hx + face * off.side;
    let by = hy - off.up - behind;

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
    dunkLiftTable: dunkLiftTable,
    DUNK_RISE: DUNK_RISE,
    dunkRiseAt: dunkRiseAt,
    DUNK_AIR: DUNK_AIR,
    dunkAirAt: dunkAirAt,
    dunkTakeoff: dunkTakeoff,
    contactCheck: contactCheck,
    CONTACT_CHECK_PX: CONTACT_CHECK_PX,
    dunkGatherProgress: dunkGatherProgress,
    EXTEND_SHARE: EXTEND_SHARE,
    DUNK_ROUTE_T: DUNK_ROUTE_T,
    dunkRouteAt: dunkRouteAt,
    JUMP_LIFT: JUMP_LIFT,
    CLOSE_LIFT: CLOSE_LIFT,
    CLOSE_LIFT_BY_FINISH: CLOSE_LIFT_BY_FINISH,
    closeLiftTable: closeLiftTable,
    closeLiftAt: closeLiftAt,
    APPROACH_LIFT: APPROACH_LIFT,
    approachLiftAt: approachLiftAt,
    spinTurn: spinTurn,
    turnFacing: turnFacing,
    SPIN_TORSO_LAG: SPIN_TORSO_LAG,
    EURO_LEAN_PX: EURO_LEAN_PX,
    liftToPose: liftToPose,
    resolveLeaper: resolveLeaper,
    DESCENT_MS: DESCENT_MS,
    LANDING_COMPRESS_MS: LANDING_COMPRESS_MS,
    LANDING_RECOVER_MS: LANDING_RECOVER_MS,
    LANDING_TOTAL_MS: LANDING_TOTAL_MS,
    LANDING_SQUASH_PX: LANDING_SQUASH_PX,
    LANDING_STYLE: LANDING_STYLE,
    landingStyle: landingStyle,
    landingLean: landingLean,
    landingSquash: landingSquash,
    justLanded: justLanded,
    RIM_HIT_MS: RIM_HIT_MS,
    RIM_HIT_PX: RIM_HIT_PX,
    rimHitSquash: rimHitSquash,
    landingSquashPx: landingSquashPx,
    closeCockAtBeat: closeCockAtBeat,
    JUMP_FOLLOW_MAX_MS: JUMP_FOLLOW_MAX_MS,
    followWindow: followWindow,
    shotSlump: shotSlump,
    FOLLOW_MADE_MS: FOLLOW_MADE_MS,
    FOLLOW_MISS_MS: FOLLOW_MISS_MS,
    SLUMP_MS: SLUMP_MS,
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
    dribbleTempoFor: dribbleTempoFor,
    handlerTempo: handlerTempo,
    pressureFrom: pressureFrom,
    HANDLE_TEMPO_SPREAD: HANDLE_TEMPO_SPREAD,
    PRESSURE_TEMPO_SPREAD: PRESSURE_TEMPO_SPREAD,
    PRESSURE_NEAR_PX: PRESSURE_NEAR_PX,
    PRESSURE_FAR_PX: PRESSURE_FAR_PX,
    DRIBBLE_TEMPO_SPREAD: DRIBBLE_TEMPO_SPREAD,
    MOVE_BLEND_BEATS: MOVE_BLEND_BEATS,
    HESITATION_BEATS: HESITATION_BEATS,
    HESITATION_HOLD: HESITATION_HOLD,
    HESITATION_EASE: HESITATION_EASE,
    HESITATION_RELEASE: HESITATION_RELEASE,
    HESI_CROUCH_PX: HESI_CROUCH_PX,
    dribbleCrossings: dribbleCrossings,
    handSwitchCount: handSwitchCount,
    moveDribble: moveDribble,
    dribbleNow: dribbleNow,
    dribbleLean: dribbleLean,
    CONTACT_MIN_PX: CONTACT_MIN_PX,
    CONTACT_FULL_PX: CONTACT_FULL_PX,
    CONTACT_MS: CONTACT_MS,
    CONTACT_LEAN_PX: CONTACT_LEAN_PX,
    CONTACT_CROUCH_PX: CONTACT_CROUCH_PX,
    contactStrength: contactStrength,
    contactDecay: contactDecay,
    POSE_ORDER: POSE_ORDER,
    defenseStance: defenseStance,
    fatigueLevel: fatigueLevel,
    energyAt: energyAt,
    FATIGUE_DROOP_PX: FATIGUE_DROOP_PX,
    FATIGUE_FLOOR: FATIGUE_FLOOR,
    DEFEND_ON_BALL_PX: DEFEND_ON_BALL_PX,
    DEFEND_FAR_PX: DEFEND_FAR_PX,
    CONTEST_PX: CONTEST_PX,
    posePriority: posePriority,
    ballSquash: ballSquash,
    BALL_SQUASH_SPEED: BALL_SQUASH_SPEED,
    BALL_BOUNCE_PHASE: BALL_BOUNCE_PHASE,
    momentumLean: momentumLean,
    brakingRate: brakingRate,
    plantCrouch: plantCrouch,
    LEAN_ACCEL_FULL: LEAN_ACCEL_FULL,
    MOMENTUM_LEAN_PX: MOMENTUM_LEAN_PX,
    PLANT_MIN_SPEED: PLANT_MIN_SPEED,
    PLANT_ACCEL_MIN: PLANT_ACCEL_MIN,
    PLANT_ACCEL_FULL: PLANT_ACCEL_FULL,
    PLANT_CROUCH_PX: PLANT_CROUCH_PX,
    DRIBBLE_LEAN_PX: DRIBBLE_LEAN_PX,
    CROSS_LEAN_PX: CROSS_LEAN_PX,
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
