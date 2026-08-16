// THE DUNK CATALOGUE.
//
// WHY THIS IS A DESCRIPTOR TABLE AND NOT A LIST OF ANIMATIONS.
//
// There are no sprite sheets in this game — ui/pixelSprites.js draws a 10x24
// body out of rectangles, procedurally. So "add thirty dunk animations" cannot
// mean "author thirty sequences"; it has to mean "make the motion a function of
// parameters, and pick the parameters". The alternative — thirty hand-placed
// pose sets — is exactly the copy/paste variation the brief rules out, because
// at this size the second and third would inevitably be the first with a limb
// moved a pixel.
//
// So each entry here is a DESCRIPTION of a motion, and ui/pixelMotion.js and
// ui/pixelSprites.js derive the ball path, the body and the timing from it. Two
// entries cannot be the same animation under different names, because there is
// no animation stored anywhere to duplicate — only the parameters, and
// scripts/validate-pixel-posture.js asserts that no two of them draw the same
// pixels.
//
// WHAT IS ACTUALLY DISTINGUISHABLE on a body ten pixels across. This is the
// honest constraint, and it is what the axes below were chosen from:
//
//   hands     one arm up with the other trailing reads very differently from
//             both arms up. Two clear silhouettes.
//   path      the BIGGEST lever by far. The ball is a free 3px object with the
//             whole frame to move through, so where it travels between the
//             gather and the rim is the thing the eye actually follows.
//   spin      180 and 360 are drawn by rotating `facing` through the flight,
//             which flips the whole body. Unmistakable.
//   reverse   he finishes with his back to the approach. Changes the arm side
//             and the head lean together.
//   takeoff   one foot vs two is visible on the FLOOR, before the leap — a
//             single planted leg with the other knee driving, against a
//             two-footed gather that compresses both.
//   hang      timing. A dunk that hangs 200ms at the top is a different
//             experience from one that snaps through in 60.
//
// Things deliberately NOT modelled, because they are not visible here and
// pretending otherwise would be the "slightly rotated version" failure: wrist
// angle, finger position, precise shoulder rotation, and the difference between
// (say) a cradle and a cock-back, which at 10px is the same two rectangles.
// Where the brief names several dunks that collapse to one silhouette, they are
// folded into one honest entry rather than shipped as near-duplicates.

// Ball routes. Each is a function of `t` (0..1 through the airborne phase) and
// returns an offset in sprite pixels from the finisher's feet: `up` is height,
// `side` is lateral (+1 is the direction he is facing), `back` rides up-screen
// so a ball can pass behind him in the fake top-down projection.
//
// They all END at roughly the same place — up at the rim, on the finishing
// side — because that is where a dunk has to finish. What differs is the route,
// which is the whole point.
const DUNK_PATHS = {
  // Straight up the side. The baseline, and what every dunk in the game used
  // to be.
  power: function (t) {
    // Slightly front-loaded, not linear. The ball comes up WITH the leap, so it
    // is moving fastest early and easing as he reaches — and being above the
    // diagonal is also what buys the separation from `straight`, which is below
    // it. Straight lines through the middle are what made these two collide.
    return { up: 30 * (1 - Math.pow(1 - t, 1.25)),
             side: 4 * (1 - Math.pow(1 - t, 1.25)), back: 0 };
  },
  // QUICK. Differs from `power` in TIME, not in amplitude — the first version
  // differed only in how far it went and the two routes separated by 0.7px over
  // the whole flight, which is the near-duplicate the brief rules out.
  //
  // A quick finish has no time to bring the ball out, so it stays down with him
  // and gets punched up at the last moment. Power rises steadily from the
  // gather; this one is still low at the halfway point and then goes.
  straight: function (t) {
    // 1.8, not 2.4. The steeper version concentrated the whole climb into the
    // last few frames of an already-short dunk. Steepening it further to win
    // back the separation lost when every route started sharing an origin just
    // drove it into `cradle` instead — both became "flat, then late". The
    // separation is bought on `power`'s side of the gap now.
    const late = Math.pow(t, 1.8);
    return { up: 31 * late, side: 4 * late, back: 0 };
  },
  // TOMAHAWK. Pulled back and BEHIND the head, then chopped forward. The
  // signature is the ball going backwards before it goes forwards, so the
  // lateral offset is negative through the middle.
  tomahawk: function (t) {
    const cock = Math.sin(Math.min(1, t / 0.55) * Math.PI * 0.5);
    return {
      // NOT `pow(t, 0.7)`, which is what this was. That curve has an INFINITE
      // derivative at t=0 — it leaves the origin vertically — so the ball's
      // measured peak speed was 220px per unit of route against a windmill's 74,
      // and sizing the beat off it demanded 715ms of hang for a tomahawk. The
      // shape wanted here is "rises fast early and eases out", which this says
      // with a derivative that is merely large rather than unbounded.
      up: 34 * (1 - Math.pow(1 - t, 1.8)),
      side: -7 * cock * (1 - t) + 5 * t * t,
      back: 4 * cock * (1 - t)
    };
  },
  // WINDMILL. A full circle: out and DOWN away from the body, around, and up.
  // The downward dip at the start is what separates it from a tomahawk — one
  // pulls back, the other drops out and sweeps.
  windmill: function (t) {
    const a = t * Math.PI * 1.85 - Math.PI * 0.35;
    const r = 11 * Math.sin(Math.min(1, t / 0.85) * Math.PI * 0.85) + 3;
    return {
      up: 15 * t + 14 * t * t + r * Math.sin(a) * 0.55,
      side: Math.cos(a) * r * 0.8,
      back: 0
    };
  },
  // EASTBAY. Down BETWEEN THE LEGS and back up the other side. The ball has to
  // get genuinely low — below the hips of an airborne body — or it reads as a
  // narrow windmill.
  eastbay: function (t) {
    const dip = Math.sin(Math.min(1, t / 0.45) * Math.PI);
    return {
      up: 8 + 30 * Math.pow(t, 1.5) - 11 * dip,
      side: -5 * dip + 5 * t * t,
      back: 0
    };
  },
  // CRADLE. Rocked in to the chest and held there, then thrown out at the last
  // moment. Reads as the ball disappearing into him and reappearing.
  cradle: function (t) {
    const tuck = Math.sin(Math.min(1, t / 0.6) * Math.PI);
    // HELD, then thrown. This used to climb steadily — `12 + 20t + 4t²` — and
    // was only distinguishable from a tomahawk because the two began at
    // different heights, the tomahawk on the floor and this at the chest. Once
    // every route started in his hands they collapsed to 3.9px apart, which is
    // the near-duplicate the brief rules out, and the check caught it.
    //
    // So the difference is in the shape now, where it belongs: a cradle rocks
    // the ball IN and keeps it there. Flat through the first half — the ball
    // does not climb with him, which is the thing you notice — and then it goes.
    // The rock is DOWN and IN, not just in: the ball drops toward the chest as
    // he gathers it, which is what separates a cradle from a quick finish that
    // also stays low. Held flat, then thrown.
    const hold = Math.max(0, (t - 0.45) / 0.55);
    return {
      up: 12 - 6 * tuck + 5 * t + 26 * Math.pow(hold, 1.4),
      side: -5 * tuck + 6 * t * t,
      back: 3 * tuck
    };
  },
  // DOUBLE CLUTCH. Up, pulled back DOWN, then up again. The only path that
  // reverses its vertical direction, which is what makes it readable.
  double: function (t) {
    const first = Math.sin(Math.min(1, t / 0.4) * Math.PI * 0.5);
    const pull = Math.sin(Math.max(0, Math.min(1, (t - 0.35) / 0.3)) * Math.PI);
    return {
      // The pull has to be DEEP. Rebasing every route onto a shared origin
      // scales each one's excursions down, and at -9 the reversal — the entire
      // point of a double clutch — shrank to 4.3px and read as a hesitation.
      up: 24 * first - 14 * pull + 16 * Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.4),
      side: 3 * first + 3 * t * t,
      back: 0
    };
  }
};

const DUNK_PATH_NAMES = Object.keys(DUNK_PATHS);

// EVERY ROUTE ENDS IN THE SAME PLACE, and this is not a tidiness point.
//
// A dunk finishes with the ball at the rim. The view hands the ball off to the
// slam on the last frame of the airborne phase, so a path that ends anywhere
// else puts a jump at exactly the moment the eye is nailed to the hoop — the
// defect class this whole animation system is shaped to prevent.
//
// Written by hand, the routes did not converge: the windmill's circle came back
// round to up=25 side=0 (below the rim and on the wrong side of him) and the
// double clutch overshot to up=40. Rather than hand-tuning seven functions
// until they happened to agree — which would break again the first time one was
// retuned — the terminal is enforced here. The correction ramps in as t²  so it
// is zero for the whole first half of the flight, where the route's character
// lives, and takes over only as it closes on the rim.
const DUNK_TERMINAL = { up: 31, side: 4 };

// THE RIM, at a FIXED height above the floor.
//
// `DUNK_TERMINAL.up` above measures from his FEET, which quietly meant the
// hoop moved: the ball finished 40px up on a quickTwo and 48px up on a
// threeSixtyWindmill, because the terminal rode on how high he had jumped.
// Every dunk in a basketball game finishes at the same height — that is what a
// rim is — so the terminal is now solved against the floor and the feet are
// subtracted out. The relative terminal is kept as the fallback for callers
// that cannot say where his feet are (an un-marked dunk, a probe).
//
// 47 is not a free choice. The hand tops out `tall + 6` above the feet, the
// slam happens at 0.82 of peak lift, and the arm may stretch a few px — so the
// rim has to sit where the LOWEST dunk in the catalogue can still reach it.
// See MIN_DUNK_LIFT, which is the same constraint written from the other side.
const RIM_ABOVE_FLOOR = 47;

// WHERE THE BALL STARTS: in his hands, not on the floor.
//
// Every route was written as an offset from the feet and most of them began at
// up=0 — so the ball sat on the floor through the entire gather and plant and
// only left it once he was already climbing. He never picked it up. The routes
// each describe a shape, and none of them was responsible for saying where the
// shape begins, so nobody did.
//
// NOT a decaying correction, which is how this was first written and was wrong.
// Adding `(ORIGIN - start) * fadeOut` starts the ball at 12 and then lets it
// FALL back onto the raw route — and `straight` is deliberately still near zero
// at the halfway point, so the ball dropped 8px out of his hands right after he
// gathered it. The readability check caught it as the ball's worst frame going
// from 3.2px to 4.1px, on `quickOne`, where nothing had got faster.
//
// The routes were all authored as a climb starting from zero. The fix is to say
// so: remap each one affinely from its own [start, end] onto [origin, rim]. The
// shape is preserved exactly — the eastbay still dips as far below its start,
// the double clutch still reverses — but both ends are pinned, and no route can
// disagree about where a dunk begins or finishes.
const DUNK_ORIGIN = { up: 12 };

function dunkBallPath(style, t, foot) {
  const fn = DUNK_PATHS[style] || DUNK_PATHS.power;
  const c = Math.max(0, Math.min(1, t));
  const raw = fn(c);
  const end = fn(1);
  const start = fn(0);
  const k = c * c;
  // Absolute when the caller can say where his feet are, relative when not.
  const termUp = typeof foot === 'number' ? RIM_ABOVE_FLOOR - foot : DUNK_TERMINAL.up;
  const span = end.up - start.up;
  const scale = Math.abs(span) < 1 ? 1 : (termUp - DUNK_ORIGIN.up) / span;
  return {
    up: DUNK_ORIGIN.up + (raw.up - start.up) * scale,
    side: raw.side + (DUNK_TERMINAL.side - end.side) * k,
    // He cannot finish behind himself either.
    back: (raw.back || 0) * (1 - k)
  };
}

// The lowest a dunk may leap and still reach a fixed rim. Solved, not picked:
// the slam sits at 0.82 of peak lift and the hand reaches `tall + 6` above the
// feet (30 on a 6'7" body), so 0.82*16 + 30 = 43.1, and the arm covers the last
// few px. Anything lower and he finishes visibly under the rim, which is what
// the old 11px quick dunks were doing.
const MIN_DUNK_LIFT = 16;

// HOW HIGH HIS HAND IS, which is not a clock — it is wherever the ball has got
// to, and it never goes back down.
//
// The arm was first swept on the pose's own `rising` channel, and that channel
// starts during the gather. Rendered frame by frame the result was plain: the
// arm was fully overhead while the ball was still down at his chest, so for the
// whole rise he was reaching at nothing and the limb read as a pole beside his
// head rather than as an arm holding a basketball.
//
// Driving it off the ball's LIVE height is the other failure — a windmill's ball
// swings down and round, and the arm pumped with it. So it follows the running
// maximum: the hand goes up with the ball and stays there while the ball orbits,
// which is both what an arm does and what is drawable on a body ten px across.
//
// Sampled once per route at load rather than solved per frame; 48 steps is well
// inside a pixel over the whole climb, and this is read for every dunking player
// on every frame.
const ENVELOPE_STEPS = 48;
const DUNK_ENVELOPES = (function () {
  const out = {};
  DUNK_PATH_NAMES.forEach(function (name) {
    const fn = DUNK_PATHS[name];
    const start = fn(0), end = fn(1), span = end.up - start.up;
    const table = [];
    let run = -Infinity;
    for (let i = 0; i <= ENVELOPE_STEPS; i++) {
      const t = i / ENVELOPE_STEPS;
      // the shape's own normalised height, before the rim scaling is applied
      const u = Math.abs(span) < 1 ? 0 : (fn(t).up - start.up) / span;
      run = Math.max(run, u);
      table.push(run);
    }
    out[name] = table;
  });
  return out;
}());

function dunkArmHeight(style, t, foot) {
  const table = DUNK_ENVELOPES[style] || DUNK_ENVELOPES.power;
  const c = Math.max(0, Math.min(1, t)) * ENVELOPE_STEPS;
  const i = Math.min(ENVELOPE_STEPS - 1, Math.floor(c));
  const u = table[i] + (table[i + 1] - table[i]) * (c - i);
  const termUp = typeof foot === 'number' ? RIM_ABOVE_FLOOR - foot : DUNK_TERMINAL.up;
  return DUNK_ORIGIN.up + u * (termUp - DUNK_ORIGIN.up);
}

// ---------------------------------------------------------------------------
// THE CATALOGUE.
//
// `tier` gates the entry on how good a leaper he is — see dunkPool. `hang` is
// how long he holds at the top in ms; `lift` is the peak height in sprite px
// (the old single dunk was 16). `weight` biases the roll among everything
// legal, so the plain finishes stay common and the spectacular ones stay rare.
//
// Kept to a curated set. Every entry below is a silhouette you can tell from
// every other entry at 4x zoom; the moment one is only distinguishable by
// reading the name, it does not belong here.
// ---------------------------------------------------------------------------
const DUNKS = [
  // --- ordinary finishes. The bulk of the 57 dunks a game. ----------------
  { id: 'oneHandPower', hands: 1, path: 'power', takeoff: 'one', lift: 16, hang: 90, tier: 0, weight: 10 },
  { id: 'twoHandPower', hands: 2, path: 'power', takeoff: 'two', lift: 16, hang: 100, tier: 0, weight: 10 },
  { id: 'quickOne', hands: 1, path: 'straight', takeoff: 'one', lift: 16, hang: 40, tier: 0, weight: 8, quick: true },
  { id: 'quickTwo', hands: 2, path: 'straight', takeoff: 'two', lift: 16, hang: 40, tier: 0, weight: 8, quick: true },
  { id: 'straightArm', hands: 1, path: 'straight', takeoff: 'one', lift: 17, hang: 120, tier: 0, weight: 5 },

  // --- tomahawks. The ball goes back before it goes forward. --------------
  { id: 'tomahawk', hands: 1, path: 'tomahawk', takeoff: 'one', lift: 18, hang: 130, tier: 1, weight: 7 },
  { id: 'twoHandTomahawk', hands: 2, path: 'tomahawk', takeoff: 'two', lift: 17, hang: 140, tier: 1, weight: 5 },
  { id: 'longArmTomahawk', hands: 1, path: 'tomahawk', takeoff: 'one', lift: 20, hang: 190, tier: 2, weight: 3 },

  // --- windmills. The ball sweeps a circle. -------------------------------
  { id: 'windmill', hands: 1, path: 'windmill', takeoff: 'one', lift: 19, hang: 150, tier: 2, weight: 5 },
  { id: 'twoHandWindmill', hands: 2, path: 'windmill', takeoff: 'two', lift: 18, hang: 160, tier: 2, weight: 3 },
  { id: 'hangWindmill', hands: 1, path: 'windmill', takeoff: 'one', lift: 20, hang: 240, tier: 3, weight: 2 },

  // --- the hard ones. -----------------------------------------------------
  { id: 'eastbay', hands: 1, path: 'eastbay', takeoff: 'one', lift: 20, hang: 170, tier: 3, weight: 3 },
  { id: 'cradle', hands: 1, path: 'cradle', takeoff: 'one', lift: 18, hang: 160, tier: 2, weight: 4 },
  { id: 'doubleClutch', hands: 1, path: 'double', takeoff: 'two', lift: 19, hang: 200, tier: 2, weight: 3 },

  // --- rotation. Drawn by turning the body through the flight. ------------
  { id: 'threeSixty', hands: 1, path: 'power', spin: 360, takeoff: 'one', lift: 19, hang: 170, tier: 3, weight: 3 },
  { id: 'threeSixtyTwo', hands: 2, path: 'power', spin: 360, takeoff: 'two', lift: 18, hang: 180, tier: 3, weight: 2 },
  { id: 'threeSixtyWindmill', hands: 1, path: 'windmill', spin: 360, takeoff: 'one', lift: 21, hang: 220, tier: 4, weight: 1 },
  { id: 'oneEighty', hands: 2, path: 'power', spin: 180, takeoff: 'two', lift: 17, hang: 150, tier: 2, weight: 4 },

  // --- reverses. Finishes with his back to the approach. ------------------
  { id: 'reverseOne', hands: 1, path: 'power', reverse: true, takeoff: 'one', lift: 17, hang: 130, tier: 1, weight: 5 },
  { id: 'reverseTwo', hands: 2, path: 'power', reverse: true, takeoff: 'two', lift: 16, hang: 140, tier: 1, weight: 4 },
  { id: 'reverseTomahawk', hands: 1, path: 'tomahawk', reverse: true, takeoff: 'one', lift: 19, hang: 170, tier: 3, weight: 2 },
  { id: 'reverseWindmill', hands: 1, path: 'windmill', reverse: true, takeoff: 'one', lift: 20, hang: 200, tier: 4, weight: 1 },
  { id: 'reverse180', hands: 2, path: 'power', reverse: true, spin: 180, takeoff: 'two', lift: 18, hang: 160, tier: 3, weight: 2 }
];

const DUNK_BY_ID = {};
DUNKS.forEach(function (d) { DUNK_BY_ID[d.id] = d; });

function dunkById(id) { return DUNK_BY_ID[id] || DUNKS[0]; }

// ---------------------------------------------------------------------------
// SELECTION.
//
// HOW HIGH HE CAN GET, on the same shape the choreographer's own dunk gate
// uses. Not a new rating: vertical carries it, strength and height fill in.
function dunkTierFor(player) {
  if (!player || !player.attributes) return 0;
  const a = player.attributes;
  const lift = (a.vertical || 50) * 0.62 + (a.strength || 50) * 0.2 +
    (a.insideScoring || 50) * 0.18 + ((player.heightIn || 78) - 78) * 0.9;
  // Cutoffs picked against the league's real spread rather than as round
  // numbers — see the measured distribution in the plan doc. Roughly: everyone
  // who dunks at all gets tier 1, about half get tier 2, the top quarter get
  // tier 3, and tier 4 is the handful of genuine leapers.
  if (lift >= 78) return 4;
  if (lift >= 70) return 3;
  if (lift >= 62) return 2;
  if (lift >= 54) return 1;
  return 0;
}

// A roll in [0,1) from an integer seed. Same mixer the choreographer uses; kept
// local so this file has no dependencies and the probes can load it alone.
function dunkRoll(seed) {
  let x = ((seed | 0) * 1103515245 + 12345) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = (Math.imul(x, 2246822519) ^ (x >>> 13)) >>> 0;
  return (x >>> 8) / 16777216;
}

// WHICH DUNKS ARE EVEN LEGAL HERE. Context first, roll second — the brief's
// "do not randomly select animations with no consideration".
//
// ctx = {
//   tier        how good a leaper he is (dunkTierFor)
//   contact     a defender is on him at the rim
//   putback     he just got his own miss back
//   alley       the ball is arriving in the air
//   runway      px of approach he had — a standing dunk cannot be a windmill
//   lastId      what he did last time, so he does not repeat himself
// }
function dunkPool(ctx) {
  const c = ctx || {};
  const tier = typeof c.tier === 'number' ? c.tier : 1;
  return DUNKS.filter(function (d) {
    if ((d.tier || 0) > tier) return false;
    // CONTACT. Going through a body is not the moment for a windmill — both
    // hands or a short path, and nothing that rotates.
    if (c.contact) return !d.spin && !d.reverse &&
      (d.path === 'power' || d.path === 'straight' || d.path === 'tomahawk');
    // A PUTBACK is caught and finished in one motion off a rebound. No runway,
    // no windup: quick paths only, and never a rotation.
    if (c.putback) return !d.spin && (d.path === 'straight' || d.path === 'power');
    // AN ALLEY-OOP is caught in the air, so the ball starts high and the hands
    // have to meet it. Paths that begin below the waist cannot happen.
    if (c.alley) return d.path !== 'eastbay' && d.path !== 'double' && !d.reverse;
    // NO ANGLE TERM, and it is worth saying why rather than leaving the gap
    // silent. A reverse is a baseline finish and it would be right to gate it
    // on having arrived from the side — but the drive positions the sim hands
    // over carry no lateral component at all. Measured over 442 dunks, the
    // start of the drive sits on the rim's own line every single time, so
    // `|sideways| / runway` came out at zero for the whole sample.
    //
    // A filter on a signal that does not exist is not a filter, it is a ban:
    // the first version of this cost five of the twenty-three finishes and
    // bought nothing. Giving drives a real approach angle is a change to the
    // sim's geometry, not to the animation, so it is left undone and recorded
    // rather than faked.
    // A SHORT RUNWAY rules out everything that needs momentum to carry.
    if (typeof c.runway === 'number' && c.runway < 30) {
      return d.quick || d.path === 'power' || d.path === 'straight';
    }
    return true;
  });
}

// Pick one. `seed` makes it deterministic — a replay has to dunk the way the
// game did, and an rng draw here would also touch the game's own stream.
function pickDunk(ctx, seed) {
  const c = ctx || {};
  let pool = dunkPool(c);
  if (!pool.length) pool = [DUNKS[0]];
  // RECENCY. Drop what he did last time, so a player cannot throw the same
  // dunk twice running — the single loudest form of the repetition the brief is
  // about. Only if something else is available; a one-entry pool wins anyway.
  if (c.lastId && pool.length > 1) {
    const fresh = pool.filter(function (d) { return d.id !== c.lastId; });
    if (fresh.length) pool = fresh;
  }
  let total = 0;
  for (let i = 0; i < pool.length; i++) total += pool[i].weight || 1;
  let r = dunkRoll(seed) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].weight || 1;
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// LANDINGS. How he comes down, which the brief rightly calls the overlooked
// half. Derived rather than stored: the dunk and the contact already say what
// kind of landing it has to be.
//
//   stumble   he was hit in the air and does not have his feet under him
//   heavy     a big leap, or a two-footed power finish — he absorbs it
//   balance   a one-foot takeoff at speed lands on one foot and takes a step
//   light     a quick finish that barely left the floor
function dunkLanding(dunk, ctx) {
  const c = ctx || {};
  if (c.contact) return 'stumble';
  if (dunk.quick) return 'light';
  if ((dunk.lift || 16) >= 19 || dunk.hands === 2) return 'heavy';
  if (dunk.takeoff === 'one') return 'balance';
  return 'heavy';
}

// How long the approach, plant and gather want to be for this dunk. A quick
// finish is not the standard beats with a label on it — the whole point of a
// quick dunk is that the windup is not there.
// HOW LONG THE AIRBORNE BEAT HAS TO BE, per route.
//
// Not a style choice — a measurement. The route clock covers 0.62 of the path
// across the rise beat, so a fixed 150ms beat gives every route the same nine
// frames to travel in. A power dunk's straight line is fine with that; a
// windmill sweeps an 11px circle through the same nine frames and moves the
// ball 4.7px per frame, which on a 3px ball is not a circle, it is a smear.
//
// So the elaborate routes get longer in the air, which is also what they look
// like in life: a windmill hangs, a quick finish does not.
// Each of these is the beat length that keeps that route's ball under 3.2px per
// frame — the budget the dribble moves already run to — computed from the
// route's own peak speed rather than chosen. `cradle` and `power` are given
// more than they need because a cradle that finishes as fast as it could stops
// reading as a cradle; the elaborate ones are at their measured floor.
const PATH_RISE_MS = {
  straight: 130, power: 145, cradle: 175,
  tomahawk: 215, windmill: 240, double: 335, eastbay: 350
};

function dunkRiseMs(dunk) {
  return PATH_RISE_MS[dunk && dunk.path] || 150;
}

// WHERE THE BALL IS ALONG ITS ROUTE AT EACH PHASE BOUNDARY.
//
// The first version used fixed fractions — rise 0.62, hang 0.85, slam 1 — which
// silently made the ball's speed depend on the SHAPE of the beats rather than
// on the clock. A quick finish hangs 40ms, and handing that 40ms a fixed 23% of
// the route made the ball cover seven pixels in two frames at the exact moment
// it reaches the rim.
//
// Derived from the beats instead, so the ball travels at a constant rate
// through wall-clock time and a phase that is short simply gets less of the
// route. Stamped by the choreographer, which is the only place that knows what
// the beats came out as.
function dunkRouteMarks(beats) {
  const air = Math.max(1, beats.rise + beats.hang + beats.slam);
  return {
    gather: 0,
    plant: 0,
    rise: beats.rise / air,
    hang: (beats.rise + beats.hang) / air,
    slam: 1,
    land: 1
  };
}

function dunkBeats(dunk, ctx) {
  const c = ctx || {};
  if (dunk.quick || c.putback) {
    // A quick finish is quick in its WINDUP, not in the air: the gather and the
    // plant are cut to almost nothing, but the ball still has 31px to travel and
    // shortening that too is what made it a blur.
    return { gather: 70, plant: 45, rise: Math.round(dunkRiseMs(dunk) * 0.9),
             hang: Math.max(70, dunk.hang), slam: 90, land: 120 };
  }
  if (c.alley) {
    // He is not gathering off the floor — he is going up to meet a pass, so the
    // gather is short and the rise is the long part.
    return { gather: 90, plant: 60, rise: Math.round(dunkRiseMs(dunk) * 1.1),
             hang: dunk.hang, slam: 90, land: 130 };
  }
  if (c.contact) {
    // Heavier everywhere: a longer load, a longer plant against the body, and a
    // slower recovery on the other side.
    return { gather: 200, plant: 90, rise: dunkRiseMs(dunk), hang: dunk.hang,
             slam: 100, land: 175 };
  }
  return {
    gather: dunk.takeoff === 'two' ? 185 : 150,
    plant: dunk.takeoff === 'two' ? 85 : 60,
    rise: dunkRiseMs(dunk),
    hang: dunk.hang,
    slam: 90,
    land: 130
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DUNKS: DUNKS,
    DUNK_PATHS: DUNK_PATHS,
    DUNK_PATH_NAMES: DUNK_PATH_NAMES,
    dunkBallPath: dunkBallPath,
    DUNK_TERMINAL: DUNK_TERMINAL,
    RIM_ABOVE_FLOOR: RIM_ABOVE_FLOOR,
    DUNK_ORIGIN: DUNK_ORIGIN,
    MIN_DUNK_LIFT: MIN_DUNK_LIFT,
    dunkArmHeight: dunkArmHeight,
    dunkById: dunkById,
    dunkTierFor: dunkTierFor,
    dunkRoll: dunkRoll,
    dunkPool: dunkPool,
    pickDunk: pickDunk,
    dunkLanding: dunkLanding,
    dunkBeats: dunkBeats,
    PATH_RISE_MS: PATH_RISE_MS,
    dunkRiseMs: dunkRiseMs,
    dunkRouteMarks: dunkRouteMarks
  };
}
