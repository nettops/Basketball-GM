// Turns a possession-engine event log (see simEnginePossession.js's pushEvent
// and the spec's Event Log Format) into a keyframe timeline the pixel game
// view interpolates between. Pure data-in data-out — no canvas, no GameState —
// so scripts/validate-pixel-choreographer.js can exercise it in Node.

// The one thing this file takes from outside itself: the opposed-attribute
// check the possession engine settles every contest with. An ankle breaker is a
// contest — his handle against the man in front of him — and it had been the
// only one in the game decided by a bare threshold instead.
var _CHOREO_DATA = (typeof require !== 'undefined')
  ? { skill: require('../skillCheck.js') }
  : { skill: { skillCheckProbability: skillCheckProbability } };

const PIXEL_STAGE = {
  w: 480, h: 270,
  court: { x: 20, y: 64, w: 440, h: 192 },
  hoops: { left: { x: 34, y: 160 }, right: { x: 446, y: 160 } }
};

// Home attacks right, away attacks left, all game — no halftime side switch.
// A watched game is theater; keeping one attack direction per team makes the
// flow readable at a glance and halves the formation math.
function attackingHoop(team) { return team === 'home' ? PIXEL_STAGE.hoops.right : PIXEL_STAGE.hoops.left; }

// Offensive formation offsets from the attacked hoop, keyed by position.
// dx is "toward half court" (sign-flipped for the left hoop); dy from hoop centerline.
const OFFENSE_SPOTS = {
  PG: { dx: 115, dy: 0 },
  SG: { dx: 85, dy: -58 },
  SF: { dx: 85, dy: 58 },
  PF: { dx: 32, dy: -40 },
  C: { dx: 32, dy: 40 }
};
const POSITION_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];

function clampToCourt(x, y) {
  const c = PIXEL_STAGE.court;
  return [
    Math.max(c.x, Math.min(c.x + c.w, Math.round(x))),
    Math.max(c.y, Math.min(c.y + c.h, Math.round(y)))
  ];
}

// Spot on court for the player filling `slotPosition` on `team`, when
// `offenseTeam` has the ball. Defenders sag 14px toward their own hoop.
function formationSpot(team, slotPosition, offenseTeam) {
  const onOffense = team === offenseTeam;
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1; // toward half court from the attacked hoop
  const spot = OFFENSE_SPOTS[slotPosition];
  const x = hoop.x + dir * spot.dx + (onOffense ? 0 : dir * -14);
  const y = hoop.y + spot.dy * (onOffense ? 1 : 0.8);
  return clampToCourt(x, y);
}

// Shot origin by zone, deterministic jitter from a counter so repeated shots
// don't overlap pixel-perfectly.
function shotSpot(offenseTeam, zone, jitterSeed) {
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1;
  const jitter = ((jitterSeed * 37) % 5) - 2; // -2..2
  const dist = zone === 'three' ? 98 : (zone === 'mid' ? 55 : 14);
  const dy = zone === 'inside' ? jitter * 3 : jitter * 14;
  return clampToCourt(hoop.x + dir * dist, hoop.y + dy);
}

// Sort the current five into PG/SG/SF/PF/C display slots: exact position match
// first, remaining players fill leftover slots in order.
function assignSlots(five) {
  const slots = {};
  const unassigned = five.slice();
  POSITION_ORDER.forEach(function (posName) {
    const idx = unassigned.findIndex(function (p) { return p.position === posName; });
    if (idx !== -1) { slots[posName] = unassigned.splice(idx, 1)[0]; }
  });
  POSITION_ORDER.forEach(function (posName) {
    if (!slots[posName]) slots[posName] = unassigned.shift();
  });
  return slots; // { PG: player, SG: player, ... }
}

// Beat durations at 1x (ms). Deliberately unhurried — a possession runs about
// three seconds so half-court sets read as basketball rather than pinball;
// viewers who want tempo have the 2x/4x/8x buttons.
//
// The `release` beat is load-bearing, not cosmetic: the view pins the ball to
// a keyframe's holder for that keyframe's whole span, so without a short
// holder-null keyframe at the moment the ball leaves the hands, a pass or
// shot never flies — it teleports to its destination at the next keyframe.
// How far below the rim a dunker plants, so his raised hand ARRIVES at the
// rim instead of sailing past it. Equals the dunk lift (16) plus the hand
// offset (30) in ui/pixelGameView.js -- the exact gap that view puts
// between a dunker's feet and the ball at full extension. Wrong the moment
// either of those moves, which is why it is named rather than inlined.
const DUNK_REACH = 46;

// The dunk catalogue. Loaded the same dual way the rest of this codebase does:
// a global in the browser (index.html loads ui/pixelDunks.js first), a require
// in Node. Kept as one reference so the choreographer, the view and the probes
// all read the same table.
const _DUNKS = (typeof module !== 'undefined' && module.exports)
  ? require('./pixelDunks.js')
  : { pickDunk: pickDunk, dunkTierFor: dunkTierFor, dunkBeats: dunkBeats,
      dunkRouteMarks: dunkRouteMarks, dunkLanding: dunkLanding };

// How many px taller or shorter than a median body a given height draws. The
// leap has to know, now that the rim is at a fixed height.
//
// Resolved at CALL time, not load time. index.html loads this file BEFORE
// ui/pixelSprites.js, so a `const` captured at load would have found nothing,
// fallen back to zero, and quietly given every player in the league a
// median-height leap forever — with nothing failing.
function _spriteTallness(heightIn) {
  const mod = (typeof module !== 'undefined' && module.exports)
    ? require('./pixelSprites.js')
    : (typeof spriteTallness === 'function' ? { spriteTallness: spriteTallness } : null);
  return mod ? mod.spriteTallness(heightIn) : 0;
}

const BEAT = {
  // Trimmed from 700/650/600. These three are the possession's dead air — the
  // walk up the floor, the flow into the set, the reset after a board — and
  // they were 34% of the game's running time. Now that isolations, live
  // dribbling and screens fill the possession with something to watch, that
  // time is better spent there than on players strolling into position.
  transition: 580, formation: 540, fastBreak: 420, pass: 340, windup: 300, drive: 500,
  release: 60, flight3: 850, flightMid: 650, flightIn: 420,
  // The layup, in three beats, for the same reason the jump shot is in four.
  //
  // It used to be ONE 200ms beat with no phase markers on it, so the finish at
  // the rim that is not a dunk was the only one in the game with no structure:
  // twelve frames carrying the gather, the takeoff, the extension and the
  // release at once, and the shooter's feet back on the floor by the frame the
  // ball left his hand. Gather is the dip and the foot plant, rise is the
  // takeoff, release is the extension the ball leaves from.
  //
  // Quicker than a dunk's 170/150 gather-and-rise on purpose: a layup is laid
  // in off two steps, not exploded into.
  closeGather: 150, closeRise: 130, closeRelease: 90,
  // THE APPROACH. A finish used to begin at the gather, so every layup in the
  // league was a man who arrived at the rim already going up — nothing showed
  // him getting past anybody.
  //
  // The euro's second step is the LONG one and gets the longer beat: the move is
  // a lie in one direction and a commitment in the other, and giving them equal
  // time makes it a shuffle. The spin's turn is slower than its exit for the
  // same reason — you sell the turn and then you are gone.
  euroOne: 130, euroTwo: 190, spinTurn: 210, spinOut: 110,
  // The pro-hop's gather is slow and its landing is quick — you float and then
  // you arrive. The hand-switch is the reverse: a fast duck under the rim and a
  // longer beat coming out of it with the ball on the other hand.
  // hopLand lengthened from 90: the float covers the whole distance in this one
  // beat, and at 90ms it was the fastest floor movement of any approach.
  hopGather: 200, hopLand: 130, switchUnder: 110, switchOut: 190,
  // One bounce of the drive. Short: this is the approach to a finish, not a
  // possession's worth of handle, and a long beat here would put a pause where
  // the gather should already be starting.
  driveStep: 110,
  // Dunk beats. The rise is short and the hang is shorter — a leap that takes
  // as long as a jump shot's flight reads as floating, not exploding.
  dunkGather: 170, dunkRise: 150, dunkSlam: 90, dunkLand: 130,
  // Crossover beats. The jab has to last long enough for the defender to
  // visibly commit to it, or the cut back reads as a sidestep rather than a
  // player being sent the wrong way.
  //
  // Retimed from 200/140/190. The CONTRAST is what sells the move, more than
  // the distance does: a long bite and then a fast punish. The jab now holds
  // half again as long so the commit is unmistakable, the cut is 35% quicker
  // so it snaps, and the clear is longer so the daylight is on screen long
  // enough to register before the shot goes up.
  crossJab: 300, crossCut: 90, crossClear: 220,
  // ...and how many beats that is. NOT the same number as the ankle breaker's
  // dribble count, which is 4: the fourth is the gather he rises out of, and it
  // belongs to the shot rather than to the handle. Telling the ball there were
  // four beats when there are three walks its crossing onto the wrong one.
  //
  // (Declared just below, outside BEAT, since it is a count and not a duration.)
  // Inbound after a made basket. Short — a live ball inbound is quick, and
  // this fires after most made shots, so any longer and it drags the game.
  inboundSet: 340, inboundPass: 260,
  // Jump shot. The whole motion used to live inside the 60ms release beat —
  // three or four frames — so the dip, the rise and the arms never appeared at
  // all. A three is a bigger gather than a pull-up, so it gets longer beats.
  jumpGatherMid: 140, jumpRiseMid: 120,
  jumpGatherThree: 180, jumpRiseThree: 150,
  jumpRelease: 60,
  // Ball screen. The set has to hold long enough to read as a screen being
  // set rather than two players brushing past each other.
  screenSet: 380, screenUse: 300,
  // Isolation, and live dribbling. A size-up beat is short so two of them read
  // as probing rather than as jogging in a circle.
  isoClear: 400, isoSize: 240, isoAttack: 280, liveDribble: 230,
  // The stepback, two beats. The plant is the longer of the two on purpose:
  // the whole move is a lie about where he is going, and the lie needs time to
  // be believed before the push sells it. The push itself is the fastest beat
  // in the isolation — separation is made in an instant or not at all.
  stepbackPlant: 220, stepbackPush: 120,
  // Fast break. Short beats covering a lot of floor — that ratio IS the break;
  // the same distance over the half-court beats would read as a jog.
  fbOutlet: 300, fbLanes: 400, fbAttack: 340,
  resolve: 500, bounce: 350, ft: 700
};

// How many beats the crossJab / crossCut / crossClear string is. See the note
// beside those durations: this is deliberately not the ankle breaker's dribble
// COUNT, which is one higher.
const ANKLE_BEATS = 3;

function flightBeat(zone) {
  return zone === 'three' ? BEAT.flight3 : (zone === 'mid' ? BEAT.flightMid : BEAT.flightIn);
}

// WHICH KIND OF LAY-IN. Every finish at the rim that was not a dunk drew the
// same pose at the same height; only the side he went up on came off the
// timeline. These are the three that are distinguishable on a 24px body, and
// each is chosen from the geometry that would actually produce it rather than
// rolled for variety's sake.
//
//   floater   he pulled up short of the rim, or he is going over somebody
//             materially taller. A touch shot.
//   reverse   he attacked from a wide angle and is under the rim, so he carries
//             it through and finishes on the far side.
//   standard  everything else.
//
// `lateral` is the offset along the baseline-parallel axis (the court runs
// left-right with the hoops on the x extremes, so lateral is y).
// THE GEOMETRY HAS ONE AXIS, WHICH TOOK TWO WRONG VERSIONS TO FIND OUT.
//
// The first cut used 26px for "pulled up short of the rim", which sounded
// reasonable and sat below the 10th percentile: 88% of every finish in the game
// came out a floater. The second used distance AND lateral offset as two
// signals, and produced zero reverses. Measuring is what settled it. Over
// twelve games:
//
//     distance to the rim   p10 16.5   p25 44.0   p50 47.8   p75 50.6   p90 53.5
//     lateral offset        p10  4.0   p25 41.0   p50 45.0   p75 48.0   p90 51.0
//     |dx| to the rim       p10 16.0   p25 16.0   p50 16.0   p75 16.0   p90 16.0
//
// Every finish at the rim gathers EXACTLY 16px from the hoop along the court's
// long axis. The only thing that varies is how far off the centre line he is —
// so `dist` is just `hypot(16, lateral)` and carries no information the lateral
// offset does not already have. Using both was double-counting one number, and
// the two rules ended up mutually exclusive.
//
// What is left is one real geometric signal and one real situational one:
//
//   reverse  he is WIDE — top quartile of lateral offset, coming from deep on
//            the baseline side, so he carries it under and finishes far side.
//   floater  he is going over somebody materially taller. The geometry cannot
//            say this and the height chart can.
//
// `dist` stays in the signature: it is degenerate in today's court, not
// degenerate in principle, and a future shot spot that varies along x should
// not have to rediscover this.
const FLOATER_HEIGHT_EDGE = 4;
const FLOATER_OVER_BIG_ROLL = 0.5;
const REVERSE_LATERAL = 48;

// WHICH APPROACH he uses to get past the man, or none.
//
// Context first, roll second — the same rule the dunk catalogue picks by, and
// for the same reason: an approach that fires on every layup is not variety, it
// is a new default. Most finishes get nothing, which is what a layup mostly is.
//
//   euro   needs a body to go around AND room to go around it. It is a lateral
//          move, so a finish taken straight down the middle has nowhere to put
//          the two steps and they read as a stumble.
//   spin   needs a man close, and it is the move you use when you have NO room —
//          you turn your back on him rather than go round. So it wants the
//          opposite condition to the euro, which is why they do not compete for
//          the same possessions.
//
// A floater is neither: it is a shot you take because you could not get there,
// and putting a euro step in front of one says he beat his man and then settled
// for a runner.
// An oop needs the ball to have been in the AIR. A dish from two feet away is a
// handoff; anything under this is choreographed as one and looks like a man
// being handed a ball he then dunks.
// How close a body has to be for the finish to be through him rather than over
// him. Read off the measured distribution rather than picked: the nearest
// opponent at the gather sits at 11.2px on the tenth percentile and 14.8 on the
// twenty-fifth, and a body is 10px wide — so 13 is "close enough to be touching"
// and lands contact on about one dunk in six. Frequent enough to matter, rare
// enough that it still reads as an event.
// An ANGLE, not a distance: how much of his approach was sideways. A man who
// started forty feet out and ten feet off-centre came down the middle; one who
// started ten feet out and ten feet off-centre came along the baseline, and the
// absolute offset cannot tell them apart.
// He needs somewhere to have driven FROM. Under this he is already at the rim
// and a dribble in front of the gather is a man bouncing the ball on the spot.
const DRIVE_MIN_RUNWAY = 24;
const BASELINE_ANGLE_RATIO = 0.5;
const CONTACT_RIM_PX = 13;

// Distance to the nearest man on the other team. `defenderIds` is the five on
// the floor for the defence, which is the right set: help comes from anywhere.
function nearestOpponentPx(positions, defenderIds, at) {
  let best = Infinity;
  (defenderIds || []).forEach(function (id) {
    const p = positions && positions[id];
    if (!p) return;
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < best) best = d;
  });
  return best;
}
const ALLEY_MIN_PASS = 14;
// One in five assisted dunks from range. An oop is a specific play, and firing
// on every assisted dunk would make it the default rather than the highlight.
const ALLEY_RATE = 0.2;
// Lobs arc. Left to the distance formula a short lob tops out at the 32px
// ceiling and reads as a moon ball; this is a lob you can catch above the rim.
const ALLEY_ARC = 18;
const APPROACH_EURO_LATERAL = 6;
// Measured, not guessed. The first split gated the spin on there being NO
// lateral room, which is true of the move and turned out to be true of almost no
// possessions: it fired 11 times against the euro's 79 over eight games, so half
// the work was effectively shelf art. A spin is available from anywhere — it is
// just the only thing available when you are walled off — so it keeps a base
// rate everywhere and a much higher one when he is hemmed in.
const APPROACH_RATE = { euro: 0.18, spinWide: 0.10, spinTight: 0.26,
  // The other two members of the family. A pro-hop wants room to land into, so
  // it goes with the euro's wide condition; a hand-switch is what you do when
  // you have gone UNDER the rim and come out the far side, which is the tight
  // one. Rates chosen so the four together still leave most finishes plain —
  // an approach on every layup is a new default, not variety.
  // `switch` was tight-only at first and fired twice in eight games — the same
  // shape of mistake the spin made, and the reason both checks now assert a
  // real rate rather than mere correctness. Going under the rim is available
  // from anywhere; it is just the obvious thing when you are walled off.
  hop: 0.12, switchTight: 0.20, switchWide: 0.09 };

function approachFor(ctx, seed) {
  if (!ctx || !ctx.defended) return null;
  if (ctx.finish === 'floater') return null;
  const roll = roll01(seed);
  const wide = Math.abs(ctx.lateral || 0) >= APPROACH_EURO_LATERAL;
  if (!wide) {
    if (roll < APPROACH_RATE.spinTight) return 'spin';
    return roll < APPROACH_RATE.spinTight + APPROACH_RATE.switchTight ? 'switch' : null;
  }
  if (roll < APPROACH_RATE.euro) return 'euro';
  let cut = APPROACH_RATE.euro + APPROACH_RATE.hop;
  if (roll < cut) return 'hop';
  cut += APPROACH_RATE.spinWide;
  if (roll < cut) return 'spin';
  return roll < cut + APPROACH_RATE.switchWide ? 'switch' : null;
}

function approachBeats(kind) {
  if (kind === 'euro') return ['euroOne', 'euroTwo'];
  if (kind === 'hop') return ['hopGather', 'hopLand'];
  if (kind === 'switch') return ['switchUnder', 'switchOut'];
  return ['spinTurn', 'spinOut'];
}

// Where each step puts him, relative to where he gathers. `away` is the side the
// rim is on, so the first move is always AGAINST it — that is the lie.
function approachStep(kind, index, away) {
  const s = away >= 0 ? 1 : -1;
  if (kind === 'euro') {
    // out one way, then a longer stride back across. The second step ends
    // closer to the rim than the first, or he has gone sideways for nothing.
    return index === 0 ? [-3 * s, -4 * s] : [2 * s, 5 * s];
  }
  if (kind === 'hop') {
    // A PRO-HOP is not a step, it is a GATHER and a two-footed landing — he
    // picks the ball up, floats, and comes down square somewhere else. So the
    // first beat barely moves him (he is collecting) and the second covers the
    // whole distance at once, which is the opposite shape to a euro.
    return index === 0 ? [0, -1 * s] : [3 * s, 8 * s];
  }
  if (kind === 'switch') {
    // A HAND-SWITCH goes UNDER the rim and out the other side. Mostly lateral
    // and barely forward: the point is to change which side of the basket he
    // is on, and the ball changes hands doing it.
    return index === 0 ? [-2 * s, 2 * s] : [-6 * s, 4 * s];
  }
  // The spin carries him AROUND: away from the man, then back in on the far
  // side. More LATERAL than forward, which is what separates it from a euro —
  // the two finished 1.4px apart at first and the separation check caught it,
  // the same way it caught cradle and tomahawk. A euro commits at the rim; a
  // spin comes out beside it.
  return index === 0 ? [-2 * s, -3 * s] : [5 * s, 3 * s];
}

function layupFinish(dist, lateral, shooterHeightIn, defenderHeightIn, seed) {
  const sh = shooterHeightIn || 78, dh = defenderHeightIn || 78;
  // Going over a big. Rolled rather than automatic — a guard who CAN rise
  // through a centre sometimes does, and a finish fully determined by the
  // height chart stops being a decision.
  if (dh - sh >= FLOATER_HEIGHT_EDGE && roll01(seed) < FLOATER_OVER_BIG_ROLL) return 'floater';
  if (Math.abs(lateral) > REVERSE_LATERAL) return 'reverse';
  return 'standard';
}

// Deterministic per-possession jitter for off-ball cuts — same idea as
// shotSpot's jitter: variety without touching any rng.
function cutJitter(seed, spread) {
  return (((seed * 31) % (2 * spread + 1)) - spread);
}

// A roll in [0,1) from an integer seed.
function roll01(seed) {
  let x = ((seed | 0) * 1103515245 + 12345) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = (Math.imul(x, 2246822519) ^ (x >>> 13)) >>> 0;
  return (x >>> 8) / 16777216;
}

// How long a man holds the ball, which is what a viewer actually reads, rather
// than which named move he reaches for. 88a0ee3 gated three moves behind
// ball-handling thresholds and 83% of them came out as the same crossover
// default — two new moves accounting for one possession in six. Rolling the
// COUNT and letting the move follow from it cannot produce that failure,
// because the shares are the thing being picked.
const DRIBBLE_TABLE = [
  { share: 0.543, counts: [0] },
  { share: 0.256, counts: [2] },
  { share: 0.116, counts: [4, 5, 6] },
  { share: 0.085, counts: [7, 8] }
];
// Skill shifts the roll toward the longer buckets. Deliberately gentle: at
// 0.12 a 95-rated handler moves the roll +0.108 and a 40-rated one -0.024, so
// the elite guard works long about twice as often as the poor one without EVER
// being locked out of a simple catch and shoot. The cliff is what went wrong
// last time — ballHandling 79 got a crossover and 80 got a double move.
const DRIBBLE_SKILL_SHIFT = 0.12;

function dribbleCount(seed, handleSkill) {
  const h = typeof handleSkill === 'number' ? handleSkill : 50;
  const r = roll01(seed) + ((h - 50) / 50) * DRIBBLE_SKILL_SHIFT;
  const clamped = r < 0 ? 0 : (r >= 1 ? 0.999999 : r);
  let acc = 0;
  for (let i = 0; i < DRIBBLE_TABLE.length; i++) {
    acc += DRIBBLE_TABLE[i].share;
    if (clamped < acc) {
      const counts = DRIBBLE_TABLE[i].counts;
      // a second, independent roll picks WITHIN the bucket, so 4/5/6 are not
      // decided by how close the first roll happened to sit to the bucket edge
      return counts[Math.floor(roll01(seed * 31 + 7) * counts.length)];
    }
  }
  return DRIBBLE_TABLE[DRIBBLE_TABLE.length - 1].counts[0];
}

// Pass character. Every pass in the game used to be the same 340ms beat with
// the same distance-scaled arc, so a 30px dish and a 343px cross-court skip
// took identical time and the skip lobbed at the 32px arc ceiling. Real passes
// differ by what they are for.
//
// Duration grows with distance but sub-linearly, so long passes are FASTER in
// px/s (a skip is a line drive, not a rainbow): a 30px dish covers 166px/s, a
// 343px skip covers ~800px/s.
//
// `arc` rides on the ball object rather than a 14th push parameter — it is a
// property of the ball's flight, and the view already reads fr.b.ball.
function passShape(fromPt, toPt, isFeed) {
  const dist = Math.hypot(toPt[0] - fromPt[0], toPt[1] - fromPt[1]);
  const ms = Math.max(170, Math.min(430, Math.round(150 + dist * 1.05)));
  let arc;
  // Thresholds calibrated against the real distribution rather than picked:
  // chain passes run p10 41 / p50 74 / p90 112 / max 129 before skips existed,
  // so a ">150" skip branch was unreachable dead code.
  if (dist < 46) arc = 2;          // dish / handoff — barely leaves the floor
  else if (dist > 105) arc = 5;    // skip pass — flat and hard across the floor
  else arc = 9;                    // ordinary chest pass
  // the feed that sets up the shot floats a touch more, so the eye catches it
  return { ms: isFeed ? ms + 70 : ms, arc: isFeed ? arc + 6 : arc };
}

// Off-ball flow. Measured across a full game, 66% of all frozen player-beats
// sat in three beats — the ball swing (78% frozen), the windup (98%) and the
// rebound bounce (100%) — where the choreographer hands the SAME positions to
// consecutive keyframes and everyone away from the ball stands like furniture.
//
// Each off-ball player orbits the spot he was given, on his own phase,
// advancing once per beat. Anchored rather than cumulative so nobody wanders
// off his assignment, and derived from a beat seed rather than rng so a replay
// reproduces the same floor exactly.
//
// Amplitude is deliberately above the view's `moving` threshold: ~7px across a
// 340ms beat is ~20px/timeline-second, which trips the leg cycle, so these
// players actually jog rather than sliding.
// Distance from `id` to the closest member of `others`. 999 when there is
// nobody to measure against, so an unguarded player reads as maximally open
// rather than as an error.
function nearestOf(pos, id, others) {
  const me = pos[id];
  if (!me) return 999;
  let best = Infinity;
  others.forEach(function (o) {
    const q = pos[o];
    if (!q || o === id) return;
    const d = Math.hypot(q[0] - me[0], q[1] - me[1]);
    if (d < best) best = d;
  });
  return best === Infinity ? 999 : best;
}

function flowPositions(pos, lockedIds, beatSeed, defIds) {
  const locked = {};
  (lockedIds || []).forEach(function (id) { if (id) locked[id] = true; });
  const isDef = {};
  (defIds || []).forEach(function (id) { isDef[id] = true; });
  const offIds = defIds ? Object.keys(pos).filter(function (id) { return !isDef[id]; }) : null;
  const out = {};
  let i = 0;
  Object.keys(pos).forEach(function (pid) {
    i += 1;
    const p = pos[pid];
    if (locked[pid]) { out[pid] = [p[0], p[1]]; return; }
    const phase = beatSeed * 0.9 + i * 2.3;
    let dx = Math.sin(phase) * 7, dy = Math.cos(phase * 1.3) * 5;

    // Read the floor. Given both rosters, players stop orbiting blindly and
    // move for a reason: an offensive player works away from whoever is
    // nearest him, a defender closes the man he is nearest to. It is a purely
    // local rule — nobody plans — but ten of them running at once is what
    // reads as spacing and rotation rather than milling about.
    if (defIds) {
      const foes = isDef[pid] ? offIds : defIds;
      let near = null, nearD = Infinity;
      foes.forEach(function (o) {
        const q = pos[o];
        if (!q) return;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < nearD) { nearD = d; near = q; }
      });
      if (near && nearD > 0.5) {
        const ux = (p[0] - near[0]) / nearD, uy = (p[1] - near[1]) / nearD;
        // offense pushes off, defense closes — and only while the gap is worth
        // reacting to, so nobody chases a man already 60px away
        const urge = Math.max(0, Math.min(1, (34 - nearD) / 34));
        const step = isDef[pid] ? -6.5 * urge : 6.5 * urge;
        dx = dx * 0.45 + ux * step;
        dy = dy * 0.45 + uy * step;
      }
    }
    out[pid] = clampToCourt(p[0] + dx, p[1] + dy);
  });
  return out;
}

// Off-ball movement: everyone except the ball handler/shooter drifts to a
// slightly different spot mid-possession (a cut, a relocation, a defensive
// shadow-step), so the floor is never a frozen diorama between events.
function cutPositions(pos, excludeId, seed) {
  const moved = {};
  let i = 0;
  Object.keys(pos).forEach(function (pid) {
    i += 1;
    if (pid === excludeId) { moved[pid] = pos[pid]; return; }
    moved[pid] = clampToCourt(
      pos[pid][0] + cutJitter(seed + i, 10),
      pos[pid][1] + cutJitter(seed + i * 7, 8)
    );
  });
  return moved;
}

// Finishing flavor for made inside shots. Explosive leapers dunk it, ground
// finishers lay it in — same information the sim already has (vertical,
// strength, height), just surfaced on screen.
const DUNK_FINISHES = ['Slams it home!', 'Throws it down!', 'Rises up and JAMS it!'];
const LAYUP_FINISHES = ['Lays it in!', 'Finishes inside!', 'Kisses it off the glass'];

// The threshold is calibrated against the ACTUAL player pool, not read off the
// rating numbers: an absolute cutoff picked by eye once marked ~95% of the
// league as dunkers (30 dunks to 1 layup in a test game). The rule is "the
// pool's 65th percentile", so roughly the top third of finishers throw it down
// and the rest lay it in — and that rule is what survives a scale change.
//
// Was 82 on the old 48-99 attributes. The 0-100 rescale dropped vertical and
// strength by ~24 each, taking dunkLift down with them; left at 82 it gated
// nearly everyone out and poster impacts fell to 0.39/game. Re-solved against
// the new pool: p35 53.5, p50 58.6, p65 63.6, p80 69.3.
const DUNK_LIFT_THRESHOLD = 64;

function dunkLift(player) {
  const a = player.attributes;
  return (a.vertical || 50) * 0.6 + (a.strength || 50) * 0.25 + ((player.heightIn || 78) - 72) * 2;
}

function isDunker(player) {
  if (!player || !player.attributes) return false;
  return dunkLift(player) >= DUNK_LIFT_THRESHOLD;
}

// Which plays earn the comic-panel treatment (see ui/pixelImpact.js).
//
// Calibrated by target rate against the whole league, NOT by reading rating
// numbers — see the DUNK_LIFT_THRESHOLD comment above for why that fails here.
//
// Measured 2026-08-07 over 240 games across all 30 teams: poster fires
// 2.00/game and ankle 1.38/game, a tier-1 total of 3.38 against ~3.94 blocks.
// The two numbers differ because the rating spread for leaping finishers is
// wider than for handles — at a shared cutoff of 20, posters fire 3.67/game
// against ankle's 1.70, so one threshold for both would misfire on one of them.
//
// checkRateStaysInBand in scripts/validate-impactMoments.js holds these to
// 0.5-4/game so progression cannot silently turn them into confetti.
// Recalibrated for the 0-100 rating scale. These were 24/21, chosen by rate on
// the old 48-99 attributes; the same edges are roughly twice as large now that
// the ratings use the whole scale, and at 24/21 ankle breakers fired 6.92 per
// game against a 0.5-4 band. Re-solved the same way — measured over 40 games
// (1661 inside makes, 1296 jumpers) and read off the edge that yields the
// target rate, rather than scaled by eye:
//   1.0/game -> poster 51.3, ankle 37.8
//   2.0/game -> poster 46.7, ankle 33.5
//   2.5/game -> poster 44.3, ankle 32.0
// ankle 34 -> 26, roughly doubling crossovers. Measured over 60 games on the
// 1974 outside makes with a resolvable matchup (32.9/game):
//
//   threshold  crossovers/game
//      34          1.72   <- was
//      30          2.70
//      26          3.77   <- now, ~11% of outside makes
//      22          4.92
//      18          6.87   <- a fifth of all jumpers; stops being special
//
// Chosen for how often it should feel like a moment, not to match any real
// league. Knock-on: crossovers freeze the game at 1x-4x, so highlights per
// game at 4x rise from ~3.7 to ~5.8. Still comfortable; at 8x the bar excludes
// ankle breakers entirely so nothing changes there.
// ankle was 26. Two things pushed it to 22.
//
// First, it had drifted without anyone noticing: 26 measured 3.65/game when it
// was set on 2026-08-10, and 2.91/game after the real 2K27 rosters landed on
// 08-13 — actual NBA ratings cross this edge less often than the generated ones
// did. The band is wide enough that nothing failed.
//
// Second, more of them is wanted. Measured over the same 120 games, 22 gives
// 4.50/game — half again what you see now, and comfortably under the band's
// ceiling of 6. 20 was the next step down at 5.67 and was rejected: it leaves
// no headroom for the next roster swap to drift into.
//
// Posters are unaffected at every candidate (1.59/game throughout) — the two
// edges are independent, which is worth knowing before touching either.
const IMPACT_THRESHOLDS = { poster: 47, ankle: 22 };

// THE ANKLE BREAKER IS A CONTEST, NOT A LOOKUP.
//
// `handleEdge >= 22` is a hard cutoff, and a hard cutoff on two fixed rating
// sets is fully deterministic: the same two players always produce the same
// verdict. Measured over 30 games, of every matchup that came up three or more
// times, 100% were all-or-nothing. A handler sitting at edge 22.5 broke his
// man's ankles on 3 of 3 made jumpers; one at 21.5 would never do it, in any
// game, all season. Roughly one matchup in twenty sits within three points of
// the line, and the line decides them absolutely.
//
// So it goes through skillCheck.js like every other contest in the game — same
// centring, same conventions, so a badge or a fatigue term can be added here
// later in the one place they are added everywhere else.
//
// THE DRAW IS roll01, NOT AN RNG. This file is replayed: the same event log has
// to produce the same timeline every time it is built, or seeking and
// re-watching a game would deal a different highlight reel. roll01 hashes a
// possession seed, so the result is fixed for a given game and still
// uncorrelated between possessions.
//
// Calibrated to hold the fire rate the threshold produced — 4.40/game against
// the 1.5-6.0 band, where the cutoff gave 4.50 — while turning every certainty
// into a probability. Solved by sweeping `base` over the real population of
// 1291 outside makes across 30 games rather than picked by eye:
//
//   base    rate/game
//   0.055      4.20
//   0.065      4.40   <- here
//   0.070      4.60
//   0.090      5.03
//   0.115      5.97   <- the band's ceiling is 6.0
//
// `scale` is deliberately gentle, so an elite guard against a poor defender is
// several times likelier than the reverse without either being a foregone
// conclusion. Across those matchups the chance runs 2% at worst, 8.5% median,
// 41% at best.
//
// `min` matters as much as the rest. Without a floor the arithmetic clamps a
// third of all matchups to exactly zero, which reintroduces the very thing
// being fixed at the other end of the scale — a poor handler who can NEVER do
// it, in any game, all season. He can; rarely.
const ANKLE_CHECK = { base: 0.065, scale: 150, min: 0.02, max: 0.45 };

// How badly the handler beat his man, as a probability rather than a verdict.
// Split out from the roll so a UI or a sweep can read the chance without
// consuming anything.
function ankleChance(shooter, defender) {
  if (!shooter || !shooter.attributes || !defender || !defender.attributes) return 0;
  const a = shooter.attributes, d = defender.attributes;
  return _CHOREO_DATA.skill.skillCheckProbability({
    base: ANKLE_CHECK.base,
    // the same composite handleEdge weighs: handle first, then getting past him
    attack: { value: (a.ballHandling * 2 + a.acceleration + a.speed) / 4, scale: ANKLE_CHECK.scale },
    defend: { value: d.perimeterDefense, scale: ANKLE_CHECK.scale },
    min: ANKLE_CHECK.min,
    max: ANKLE_CHECK.max
  }).probability;
}

// How badly the finisher beat the man protecting the rim.
function posterEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.vertical * 2 + a.insideScoring) / 3 - d.interiorDefense;
}

// How badly the ball-handler beat the man in front of him.
function handleEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.ballHandling * 2 + a.acceleration + a.speed) / 4 - d.perimeterDefense;
}

// → 'poster' | 'ankle' | 'block' | null
//
// Zone is what keeps poster and ankle disjoint: inside makes can only ever be
// posters, outside makes only ever ankle breakers. There is no precedence rule
// to get wrong, and validate-impactMoments.js pins that as a property.
// `seed` is the possession seed the caller is already using for its other
// rolls. Deterministic, so a replayed game deals the same highlights.
function classifyImpact(ev, shooter, defender, seed) {
  if (!ev) return null;
  if (ev.type === 'block') return 'block';
  if (ev.type !== 'shot' || !ev.made) return null;
  // A shot whose shooter or defender could not be resolved is not a highlight.
  if (!shooter || !shooter.attributes || !defender || !defender.attributes) return null;

  if (ev.zone === 'inside') {
    if (!isDunker(shooter)) return null;
    return posterEdge(shooter, defender) >= IMPACT_THRESHOLDS.poster ? 'poster' : null;
  }
  if (ev.zone === 'mid' || ev.zone === 'three') {
    return roll01((seed || 0) * 613 + 29) < ankleChance(shooter, defender) ? 'ankle' : null;
  }
  return null;
}

// Broadcast commentary templates. Picked deterministically by possession
// seed — variety without touching any rng. {s}=shooter, {h}=handler,
// {d}=defender, {r}=rebounder, {a}=assister, {team}=team name.
const COMMENT = {
  bringUp: [
    '{h} brings it up the floor',
    '{h} walks it up, surveying the defense',
    '{h} pushes the pace for the {team}',
    '{h} calls the set at the top of the key'
  ],
  threeMake: [
    '{s} drills the three! The bench loves it',
    '{s} lets it fly from deep... BANG!',
    '{s} splashes one from beyond the arc',
    'Kick-out to {s} — knocks down the triple'
  ],
  midMake: [
    '{s} pulls up from the elbow... good!',
    '{s} rises and fires — count it',
    'Smooth midrange jumper from {s}',
    '{s} with the pull-up, right in rhythm'
  ],
  insideMake: [
    '{s} muscles it in at the rim!',
    '{s} finishes strong through contact',
    '{s} with the slick finish inside',
    '{s} throws it DOWN!'
  ],
  miss: [
    "{s}'s shot rims out",
    '{s} misfires — no good',
    "Can't connect — {s} leaves it short",
    "{s}'s look rattles in and out"
  ],
  block: [
    '{d} says NOT TODAY — huge rejection!',
    '{d} swats it away!',
    '{s} gets stuffed by {d} at the summit',
    '{d} with the emphatic block'
  ],
  steal: [
    '{d} picks his pocket! Turnover',
    '{d} jumps the passing lane for the steal',
    'Careless from {h} — {d} takes it away',
    '{d} with the takeaway, going the other way'
  ],
  fastBreak: [
    '{h} pushes it in transition — numbers advantage!',
    'Out on the break, {h} leading it',
    '{h} is off to the races',
    'The {team} get out and run'
  ],
  turnover: [
    '{h} coughs it up',
    '{h} loses the handle — turnover',
    'Sloppy possession — they give it away'
  ],
  oreb: [
    '{r} crashes the glass — second chance!',
    '{r} keeps the possession alive',
    'Offensive board! {r} out-works everybody'
  ],
  dreb: [
    '{r} cleans the glass',
    '{r} boxes out and secures it',
    '{r} ends the possession with the board'
  ],
  ft: [
    '{s} knocks down {made} of {att} at the line',
    '{s} goes {made}-for-{att} from the stripe'
  ]
};

function fillT(arr, seed, vars) {
  let line = arr[((seed % arr.length) + arr.length) % arr.length];
  Object.keys(vars).forEach(function (k) {
    line = line.split('{' + k + '}').join(vars[k]);
  });
  return line;
}

// Minimum center-to-center spacing between sprites (~sprite width) — keeps
// drives and paint scrums from stacking players on the same pixels.
const MIN_PLAYER_DIST = 11;

// Collision pass run on every keyframe: pairs closer than MIN_PLAYER_DIST
// repel each other over a few relaxation iterations. The ball handler (or
// shooter) is immovable so a drive still arrives exactly at the rim — the
// defenders yield around him, which is also what real bodies do.
function separatePositions(pos, protectedId) {
  const out = {};
  const ids = Object.keys(pos);
  ids.forEach(function (pid) { out[pid] = [pos[pid][0], pos[pid][1]]; });
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = out[ids[i]];
        const b = out[ids[j]];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d >= MIN_PLAYER_DIST) continue;
        if (d < 0.01) { dx = ((i + j) % 2) ? 1 : -1; dy = ((i * 3 + j) % 2) ? 1 : -1; d = 1.4; }
        const need = (MIN_PLAYER_DIST - d) / d;
        const aShare = ids[i] === protectedId ? 0 : (ids[j] === protectedId ? 1 : 0.5);
        const bShare = ids[j] === protectedId ? 0 : (ids[i] === protectedId ? 1 : 0.5);
        a[0] -= dx * need * aShare; a[1] -= dy * need * aShare;
        b[0] += dx * need * bShare; b[1] += dy * need * bShare;
      }
    }
  }
  ids.forEach(function (pid) { out[pid] = clampToCourt(out[pid][0], out[pid][1]); });
  return out;
}

// While a shot is in the air nobody stands and watches: players near the
// paint crash hard toward the rim (boxing out / chasing the board), players
// farther out drift in a step. The shooter holds his follow-through.
function crashPositions(pos, shooterId, hoop, seed) {
  const out = {};
  let i = 0;
  Object.keys(pos).forEach(function (pid) {
    i += 1;
    if (pid === shooterId) { out[pid] = pos[pid]; return; }
    const dx = hoop.x - pos[pid][0];
    const dy = hoop.y - pos[pid][1];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = d < 130 ? Math.min(24, d * 0.3) : 8;
    out[pid] = clampToCourt(
      pos[pid][0] + (dx / d) * step + cutJitter(seed + i, 4),
      pos[pid][1] + (dy / d) * step + cutJitter(seed + i * 3, 4)
    );
  });
  return out;
}

// Groups a flat event log into per-possession slices. A `possession` event
// opens one; everything until the next `possession` belongs to it.
function groupPossessions(events) {
  const slices = [];
  events.forEach(function (ev) {
    if (ev.type === 'possession') slices.push([ev]);
    else if (slices.length > 0) slices[slices.length - 1].push(ev);
  });
  return slices;
}

// The incremental choreographer. Playback needs to draw a possession while
// the ones after it have not been simulated yet, so every whole-game pass the
// old buildTimeline did has been made per-possession:
//
//   - the clock is now the engine's own instead of 720s divided by a
//     possession count that isn't known until the game ends;
//   - the on-court five is now the engine's own instead of being inferred by
//     sorting the final box score by minutes;
//   - the shot-clock pass only ever needed one possession's bounds, so it
//     runs at the end of each append;
//   - the line score accumulates at period boundaries and is closed by
//     finish().
//
// buildTimeline() below is a loop over this, so a replayed game and a live
// game cannot produce different timelines.
function createChoreographer(session) {
  const teamNames = { home: session.homeName || 'home side', away: session.awayName || 'road side' };
  const abbrs = { home: session.homeAbbr || 'HOME', away: session.awayAbbr || 'AWAY' };

  const nameById = {};
  const playerById = {};
  session.homeRoster.concat(session.awayRoster).forEach(function (p) {
    nameById[p.id] = p.name;
    playerById[p.id] = p;
  });
  function ln(pid) {
    return nameById[pid] ? nameById[pid].split(' ').pop() : 'the big man';
  }
  function teamOfPlayer(id) {
    return session.homeRoster.some(function (p) { return p.id === id; }) ? 'home' : 'away';
  }

  const keyframes = [];
  const snapshots = [];
  const lineScore = [];
  const runPts = {};
  const runFouls = {};
  const score = [0, 0];

  let t = 0;
  let possCounter = -1;
  let prevPoss = null;          // for fast-break detection
  let five = { home: [], away: [] };   // players (not ids) currently on court
  // Did the previous possession end with the ball going in? Drives the
  // inbound: after a make the other team walks it in from the endline, after a
  // live rebound or a steal they are already playing.
  let prevMade = false;
  let linePeriod = null;        // period the line score is currently accruing
  let atPeriodStart = [0, 0];
  let finished = false;

  const timeline = {
    keyframes: keyframes,
    durationMs: 0,
    snapshots: snapshots,
    lineScore: lineScore,
    // HOW TIRED EVERYBODY ENDED UP. The sim has tracked energy all along and
    // the sprite has never once looked at it: a man in his fortieth minute
    // moves exactly like one who just checked in.
    //
    // The END state, not a per-possession one — the box score handed to this
    // function is final, and threading live energy through would be a sim
    // change rather than an animation one. The view interpolates from fresh at
    // the tip to this at the buzzer, which gets the visible thing right (men
    // wear down through a game, and the ones who played heavy minutes wear
    // down further) without pretending to a precision it does not have.
    energyById: (function () {
      const out = {};
      const box = session.boxScore || {};
      Object.keys(box).forEach(function (id) {
        const e = box[id] && box[id].energy;
        if (typeof e === 'number') out[id] = Math.max(0, Math.min(1, e));
      });
      return out;
    }()),
    finalStats: { points: runPts, fouls: runFouls }
  };

  function snapshot() {
    const scorers = Object.keys(runPts)
      .map(function (id) { return { id: id, pts: runPts[id], team: teamOfPlayer(id) }; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 4);
    const trouble = Object.keys(runFouls)
      .filter(function (id) { return runFouls[id] >= 4; })
      .map(function (id) { return { id: id, fouls: runFouls[id] }; })
      .sort(function (a, b) { return b.fouls - a.fouls; });
    snapshots.push({ leaders: scorers, foulTrouble: trouble });
  }

  function addPoints(id, n) {
    if (!n) return;
    runPts[id] = (runPts[id] || 0) + n;
    snapshot();
  }

  function addFoul(id) {
    if (!id) return;
    runFouls[id] = (runFouls[id] || 0) + 1;
    if (runFouls[id] >= 4) snapshot();
  }

  snapshot(); // index 0: empty board at tip-off

  // Running takeover state, threaded through the whole timeline. Survives
  // across possessions by design: a takeover lasts about twenty of them.
  const takeoverHolders = { home: null, away: null };
  // What each player dunked last time, so pickDunk can avoid repeating it. The
  // single loudest form of the repetition this expansion is about.
  const lastDunkById = {};
  // Whether the previous play was this player's own offensive rebound, which is
  // what makes the next finish a putback rather than a drive.
  let lastOrebBy = null;
  let pendingTakeover = null;
  function consumePendingTakeover() {
    const p = pendingTakeover;
    pendingTakeover = null;
    return p;
  }

  // `sfx` names the sound this beat should trigger (see ui/pixelAudio.js's
  // synth). Naming it here rather than sniffing the display text keeps the
  // audio honest: a miss and a make are different events even though both
  // end with the ball at the rim.
  function push(dt, pos, ball, period, quarter, clock, text, commentary, sfx, impact, dunk, cross, jump) {
    t += dt;
    // Every keyframe goes through the collision pass so sprites never stack;
    // the protected (immovable) body is the ball holder — or, when the ball
    // has already left his hands, whoever is mid-dunk.
    //
    // A man hanging on the rim is the immovable object in that picture, not
    // the one who gives way. On the slam and the landing `ball.holder` is null
    // (the ball is through the net), so nothing was protecting him: once the
    // floor started HOLDING near the rim instead of scattering to rebound
    // spots, the bodies around him overlapped and the resolver shoved him
    // 8.1px off the hoop — far enough that validate-impactMoments caught the
    // camera framing empty court.
    const resolved = separatePositions(pos, ball.holder || (dunk && dunk.id) || null);
    keyframes.push({
      t: t, pos: resolved, ball: ball, score: score.slice(),
      period: period, quarter: quarter,
      clock: Math.max(0, Math.round(clock)), text: text || '', commentary: commentary || '',
      sfx: sfx || '',
      // Dunk phase ('gather' | 'rise' | 'slam' | 'land') or null. The view
      // turns this into sprite lift and the airborne pose; the height lives
      // there rather than here so the timeline stays pure positions.
      dunk: dunk || null,
      // Jump-shot phase ('gather' | 'rise' | 'release' | 'follow') plus who is
      // shooting. Same split as `dunk`: the beats live here, the height and the
      // pose live in the view.
      jump: jump || null,
      // Crossover phase ('jab' | 'cross' | 'clear' | 'recover') plus who did it
      // to whom, or null. Positions carry the separation; this carries who is
      // off balance, which is not derivable from coordinates alone.
      cross: cross || null,
      // Structured highlight marker, or null. ui/pixelGameView.js reads this
      // field rather than matching on `text` — see classifyImpact above.
      impact: impact || null,
      // Who is mid-takeover on each side as of this beat, and — on the one beat
      // where a takeover begins — the announcement. Both are stamped here
      // rather than passed in, because push already takes thirteen positional
      // parameters and these are running state, not per-beat arguments (the
      // same reasoning as the dribble count below).
      takeovers: { home: takeoverHolders.home, away: takeoverHolders.away },
      takeoverStart: consumePendingTakeover(),
      // index into timeline.snapshots (running leaders / foul trouble) and
      // which possession this beat belongs to, used to derive a shot clock
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
  }

  // Stamp the dribble count on the beat just pushed. Kept off `push`'s argument
  // list, which is already thirteen positional parameters and where a
  // fourteenth would be a bug waiting to happen.
  function tagHandle(meta) {
    if (keyframes.length) keyframes[keyframes.length - 1].handle = meta;
  }

  // Layup phase ('gather' | 'rise' | 'release' | 'land') plus who is finishing
  // and which side of the rim he is going up on. Stamped rather than passed for
  // the same reason `handle` is: push already carries thirteen positional
  // parameters and the note beside it calls a fourteenth a bug waiting to
  // happen. The view turns this into lift, crouch and the finishing hand.
  function tagClose(meta) {
    if (keyframes.length) keyframes[keyframes.length - 1].close = meta;
  }

  // Stepback phase ('plant' | 'push') plus who is stepping back and which way.
  // Its own channel rather than a new phase on `cross`, because the view reads
  // `cross` to decide who is stumbling and who leaves streaks, and a stepback
  // beats nobody — it makes space against a man who is still on his feet.
  function tagStep(meta) {
    if (keyframes.length) keyframes[keyframes.length - 1].step = meta;
  }

  // Which move is playing, on EVERY beat of a string rather than only the
  // first. `handle` stays a once-per-string marker because that is what
  // scripts/probe-dribbles.js counts; this is the per-frame one, because the
  // view is interpolating between two keyframes and has to know, on any frame,
  // which move it is in the middle of and how far through.
  //
  // Without it the ball could only ever run its own metronome, which is exactly
  // what it did: every named move drew the same 6.0px-wide dribble.
  function tagDribble(move, n, i) {
    if (keyframes.length) keyframes[keyframes.length - 1].drib = { move: move, n: n, i: i };
  }

  // Where the ball is right now, if somebody is holding it.
  //
  // Every pass in the game used to be drawn as leaving from whoever the code
  // DECIDED should throw it — the possession's handler, or the deepest man on
  // a break — regardless of who actually had the ball a beat earlier. When
  // those differed the ball simply appeared in the thrower's hands: measured
  // at ~10 a game and up to 139px in a single 60ms beat, a third of the court.
  // A rebounder is the commonest case; he catches it under one basket and the
  // next beat opens a pass from a man standing at half court.
  //
  // Anything that starts a pass asks this first, so a pass always leaves from
  // where the ball is.
  function heldBallSpot() {
    const last = keyframes.length ? keyframes[keyframes.length - 1].ball : null;
    return (last && last.holder) ? [last.x, last.y] : null;
  }
  function heldBallHolder() {
    const last = keyframes.length ? keyframes[keyframes.length - 1].ball : null;
    return (last && last.holder) || null;
  }
  // The floor as it stands right now.
  //
  // A pass is two beats: a 60ms release and a 170-430ms flight. The whole new
  // formation was being installed on the RELEASE -- measured at 8.1px per
  // player per frame, the largest floor movement anywhere in the game, ~440
  // times a game -- while the flight that follows sat at 0.5px, nearly frozen.
  // Exactly backwards: the eye is yanked sideways in the instant the ball
  // leaves the hand, then given a still picture for the four times longer it
  // spends in the air. Holding here moves that same travel onto the flight,
  // where players are supposed to be cutting anyway.
  function lastPositions() {
    return keyframes.length ? keyframes[keyframes.length - 1].pos : null;
  }

  function positionsFor(offenseTeam) {
    const pos = {};
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        pos[p.id] = formationSpot(side, posName, offenseTeam);
      });
    });
    return pos;
  }

  // Possession-start snapshot: the DEFENSE is already back at its formation
  // spots (they hold those same spots through the formation beat, so they
  // read as a set defense waiting), while the offense is still strung out
  // toward its own half, about to flow in.
  // On a fast break the roles invert: the OFFENSE is already streaking toward
  // the rim while the DEFENSE is the group scrambling back from the other
  // end, which is what makes a break read as a break rather than a walk-up.
  // A fast break, laid out as three lanes running at a retreating defense.
  // `advance` is 0 at the outlet and 1 at the rim, so the same function draws
  // the whole break and the players genuinely travel between beats rather than
  // teleporting into a set.
  //
  // Before this a break was the half-court possession with two shorter beats:
  // 2.3 passes against 2.2, 3.5s against 4.4s, and no lanes, no outlet, no
  // numbers advantage. 35% of possessions looked like something they weren't.
  const FB_LANE = { PG: 0, SG: -54, SF: 54, PF: 24, C: -24 };
  // Separate start and end depths. A single constant trail made the bigs only
  // ~54px behind the ball at the outlet, so the outlet pass came out SHORTER
  // than an ordinary perimeter swing — backwards for what should be the
  // longest pass in the game. They now start deep and close the gap as the
  // break runs, which is also what makes the trailer arrive late.
  const FB_START = { PG: 0, SG: 14, SF: 14, PF: 88, C: 112 };
  const FB_END   = { PG: 0, SG: 4, SF: 4, PF: 40, C: 50 };
  function fastBreakLanes(offenseTeam, advance) {
    const pos = {};
    const hoop = attackingHoop(offenseTeam);
    const dir = offenseTeam === 'home' ? -1 : 1;
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        if (!p) return;
        if (side === offenseTeam) {
          const startDx = 175 + FB_START[posName];
          const endDx = 30 + FB_END[posName];
          const dx = startDx + (endDx - startDx) * advance;
          pos[p.id] = clampToCourt(hoop.x + dir * dx, hoop.y + FB_LANE[posName]);
        } else {
          // only the two quickest get back in time; the bigs are still running
          const late = (posName === 'PG' || posName === 'SG') ? 0 : 58;
          const dx = 128 + (26 - 128) * advance + late;
          pos[p.id] = clampToCourt(hoop.x + dir * dx, hoop.y + FB_LANE[posName] * 0.55);
        }
      });
    });
    return separatePositions(pos, null);
  }

  // The five defending `offenseTeam`, restricted to whoever is actually in the
  // supplied position map.
  function defendersOf(offenseTeam, pos) {
    return five[offenseTeam === 'home' ? 'away' : 'home']
      .map(function (p) { return p.id; })
      .filter(function (id) { return pos[id]; });
  }

  function transitionFor(offenseTeam, fastBreak) {
    const pos = {};
    const hoop = attackingHoop(offenseTeam);
    const dir = offenseTeam === 'home' ? -1 : 1;
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        const spot = OFFENSE_SPOTS[posName];
        if (side === offenseTeam) {
          // half-court: strung out behind the ball. break: already ahead of it.
          const trail = fastBreak
            ? (posName === 'PG' ? 55 : 20)
            : (posName === 'PG' ? 140 : 95);
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + trail), hoop.y + spot.dy);
        } else if (fastBreak) {
          // scrambling back: still well behind their spots, and only the two
          // quickest are close enough to contest
          const behind = (posName === 'PG' || posName === 'SG') ? 40 : 105;
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + behind), hoop.y + spot.dy * 0.8);
        } else {
          pos[p.id] = formationSpot(side, posName, offenseTeam);
        }
      });
    });
    return pos;
  }

  // Shot clock for ONE possession: 24 at the inbound, ticking to 0 at the
  // terminal beat. Only ever needed this possession's own bounds, which is
  // why it can run per-append instead of as a whole-game post-pass.
  function applyShotClock(fromIndex) {
    const start = keyframes[fromIndex].t;
    const end = keyframes[keyframes.length - 1].t;
    const span = Math.max(1, end - start);
    for (let i = fromIndex; i < keyframes.length; i++) {
      keyframes[i].shotClock = Math.max(0, Math.round(24 - 24 * ((keyframes[i].t - start) / span)));
    }
  }

  function appendEvents(events) {
    if (finished) throw new Error('appendEvents after finish()');
    const head = events[0];
    if (!head || head.type !== 'possession') return;

    const pi = possCounter + 1;
    possCounter = pi;
    const firstKf = keyframes.length;

    // Takeover events are STATE, not beats. They carry no positions and nothing
    // happens on the floor at the instant one fires, so they are consumed here
    // and stamped onto every keyframe by push() rather than being choreographed
    // as plays of their own. Kept off `plays` for the same reason: the play loop
    // below would have no idea what to draw for one.
    const plays = [];
    events.slice(1).forEach(function (ev) {
      if (ev.type === 'takeover-start') {
        takeoverHolders[ev.team] = { playerId: ev.playerId, ultimateKey: ev.ultimateKey };
        // Consumed by the next pushed beat, which is where the view fires the
        // comic-panel treatment and the banner.
        pendingTakeover = { playerId: ev.playerId, ultimateKey: ev.ultimateKey,
                            ultimateName: ev.ultimateName, team: ev.team };
      } else if (ev.type === 'takeover-end') {
        takeoverHolders[ev.team] = null;
      } else {
        plays.push(ev);
      }
    });
    const period = head.period;
    const quarter = head.quarter;
    const clock = head.clock;

    // Close the previous period's line-score row the moment the period turns
    // over, so a live timeline always has every completed period's row.
    if (linePeriod === null) {
      linePeriod = period;
    } else if (period !== linePeriod) {
      lineScore.push({
        quarter: linePeriod,
        home: score[0] - atPeriodStart[0],
        away: score[1] - atPeriodStart[1]
      });
      atPeriodStart = score.slice();
      linePeriod = period;
    }

    // Real substitutions: the engine's five, not an inference from minutes.
    five = {
      home: head.lineups.home.map(function (id) { return playerById[id]; }).filter(Boolean),
      away: head.lineups.away.map(function (id) { return playerById[id]; }).filter(Boolean)
    };

    // A possession that begins right after the other team lost the ball live
    // — a steal or a defensive board — is a fast break: the defense has NOT
    // had time to set, so the transition beat plays differently.
    let fastBreak = false;
    if (prevPoss && prevPoss.team !== head.team && prevPoss.plays.length > 0) {
      const lastPlay = prevPoss.plays[prevPoss.plays.length - 1];
      fastBreak = (lastPlay.type === 'turnover' && !!lastPlay.defenderId) ||
                  (lastPlay.type === 'rebound' && !lastPlay.offensive);
    }
    prevPoss = { team: head.team, plays: plays };

    const poss = { team: head.team, quarter: quarter, period: period, handlerId: head.playerId, plays: plays, fastBreak: fastBreak };

    // On a break the possession ENDS at the rim end of the lanes, not in a
    // half-court set — otherwise the shot yanks everyone back into formation
    // and undoes the break that just ran.
    const pos = poss.fastBreak ? fastBreakLanes(poss.team, 1) : positionsFor(poss.team);
    const handlerPos = pos[poss.handlerId] || formationSpot(poss.team, 'PG', poss.team);
    const transPos = poss.fastBreak ? fastBreakLanes(poss.team, 0) : transitionFor(poss.team, false);
    const transHandler = transPos[poss.handlerId] || handlerPos;

    // Broadcast color on the way up the floor: usually nothing (dead air is
    // realistic), sometimes a bring-up line, periodically the score.
    let transComment = '';
    if (pi % 9 === 4) {
      const mins = Math.floor(clock / 60);
      const secs = Math.round(clock % 60);
      transComment = abbrs.home + ' ' + score[0] + ', ' + abbrs.away + ' ' + score[1] +
        ' — ' + mins + ':' + (secs < 10 ? '0' : '') + secs + ' to go in ' +
        (period <= 4 ? 'Q' + period : 'OT' + (period - 4));
    } else if (pi % 4 === 1) {
      transComment = fillT(COMMENT.bringUp, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }
    if (poss.fastBreak) {
      transComment = transComment || fillT(COMMENT.fastBreak, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }

    // Beat 0: the inbound. After a made basket the ball does not change hands
    // by teleporting — somebody steps to the endline and puts it in play. Only
    // after a make: a rebound or a steal is a live ball and running one of
    // these would be wrong as well as slow.
    if (prevMade && !poss.fastBreak) {
      const crt = PIXEL_STAGE.court;
      const scoredOn = attackingHoop(poss.team === 'home' ? 'away' : 'home');
      const leftEnd = scoredOn.x < crt.x + crt.w / 2;
      // separatePositions() clamps every player back inside the court, so the
      // inbounder stands ON the endline rather than behind it. At a 10px sprite
      // width he still reads as out of bounds, and exempting him would mean
      // loosening a clamp every other position in the game depends on.
      const outX = leftEnd ? crt.x : crt.x + crt.w;
      const inX = leftEnd ? crt.x + 30 : crt.x + crt.w - 30;
      const mates = five[poss.team]
        .map(function (p) { return p.id; })
        .filter(function (id) { return id !== poss.handlerId && transPos[id]; });
      const inbounder = mates.length ? mates[pi % mates.length] : null;
      if (inbounder) {
        const setPos = Object.assign({}, transPos);
        setPos[inbounder] = [outX, scoredOn.y + cutJitter(pi, 14)];
        setPos[poss.handlerId] = clampToCourt(inX, scoredOn.y + cutJitter(pi + 3, 24));
        push(BEAT.inboundSet, setPos,
          { x: setPos[inbounder][0], y: setPos[inbounder][1], holder: inbounder },
          period, quarter, clock, '',
          pi % 5 === 2 ? fillT(COMMENT.bringUp, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] }) : '');
        // everyone but the two men on the ball spreads out to receive
        push(BEAT.inboundPass, flowPositions(setPos, [inbounder, poss.handlerId], pi * 17, defendersOf(poss.team, setPos)),
          { x: setPos[poss.handlerId][0], y: setPos[poss.handlerId][1], holder: poss.handlerId },
          period, quarter, clock, '');
      }
    }

    if (poss.fastBreak) {
      // Outlet, then run. The ball is thrown AHEAD to the man already gone
      // rather than walked up: the deepest offensive player makes the outlet,
      // which is the long flat pass the half-court set never produces.
      const midPos = fastBreakLanes(poss.team, 0.55);
      const h = poss.handlerId;
      const dir = poss.team === 'home' ? -1 : 1;
      const deep = Object.keys(transPos)
        .filter(function (id) { return id !== h && pos[id]; })
        .sort(function (a, b) { return (transPos[b][0] - transPos[a][0]) * dir; })[0];
      // The outlet leaves from the ball, not from the man the code picked to
      // throw it. On a break off a defensive rebound those are almost never
      // the same player, and the difference was the whole width of the floor.
      const outletBy = heldBallHolder() || deep;
      const from = heldBallSpot() || (deep ? transPos[deep] : transHandler);

      push(BEAT.release, lastPositions() || transPos, { x: from[0], y: from[1] - 6, holder: null },
        period, quarter, clock, '');
      push(BEAT.fbOutlet, flowPositions(transPos, [h, deep, outletBy], pi * 31, defendersOf(poss.team, transPos)),
        { x: transHandler[0], y: transHandler[1] - 6, holder: h, arc: 5 },
        period, quarter, clock, '', transComment);
      // filling the lanes — everyone actually travels, so the leg cycle runs
      push(BEAT.fbLanes, midPos,
        { x: midPos[h][0], y: midPos[h][1], holder: h }, period, quarter, clock, '');
      push(BEAT.fbAttack, pos,
        { x: handlerPos[0], y: handlerPos[1], holder: h }, period, quarter, clock, '');
    } else {
      // Beat 1: transition. The defense is already set and the offense walks
      // into it.
      push(BEAT.transition, transPos,
        { x: transHandler[0], y: transHandler[1], holder: poss.handlerId }, period, quarter, clock, '', transComment);
      // Beat 2: the offense flows into its set against the waiting defense.
      // Flowed: at 540ms this is the longest beat in a half-court possession
      // and half the floor was holding still through it.
      push(BEAT.formation, flowPositions(pos, [poss.handlerId], pi * 29, defendersOf(poss.team, pos)),
        { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, period, quarter, clock, '');
    }

    const hoop = attackingHoop(poss.team);

    // Positions carried between beats within this possession, so a rebound
    // scramble continues from the crashed-glass positions rather than
    // yanking everyone back to their formation spots.
    let curPos = pos;

    poss.plays.forEach(function (ev, ei) {
      if (ev.type === 'turnover') {
        const cutPos = cutPositions(pos, poss.handlerId, pi + ei);
        const handlerCut = cutPos[poss.handlerId] || handlerPos;
        const stealer = ev.defenderId && cutPos[ev.defenderId] ? ev.defenderId : null;
        if (stealer) {
          // pocket picked: ball pops loose, then the stealer collects it
          push(BEAT.release, cutPos, { x: handlerCut[0], y: handlerCut[1] - 6, holder: null }, period, quarter, clock, '');
          push(BEAT.pass, cutPos, { x: cutPos[stealer][0], y: cutPos[stealer][1], holder: stealer }, period, quarter, clock, 'Steal!',
            fillT(COMMENT.steal, pi + ei, { d: ln(stealer), h: ln(poss.handlerId) }), 'squeak');
        } else {
          push(BEAT.resolve, cutPos, { x: handlerCut[0], y: handlerCut[1], holder: null }, period, quarter, clock, 'Turnover',
            fillT(COMMENT.turnover, pi + ei, { h: ln(poss.handlerId) }));
        }
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, period, quarter, clock, '');
        push(BEAT.release, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, period, quarter, clock, '');
        // swatted sideways, not through the net
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, period, quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block',
          { kind: 'block', at: { x: sp[0], y: sp[1] }, byId: ev.defenderId, onId: ev.playerId, check: ev.check || null });
      } else if (ev.type === 'shot') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        const shooterOn = !!shotPos[ev.playerId];
        // who the offense is reading, and who is reading them
        const defenderIds = five[poss.team === 'home' ? 'away' : 'home']
          .map(function (p) { return p.id; })
          .filter(function (id) { return shotPos[id]; });
        // the shot defender closes out to contest — collision keeps him a
        // body's width off the shooter instead of inside him
        if (ev.defenderId && shotPos[ev.defenderId]) {
          const cdx = hoop.x - sp[0];
          const cdy = hoop.y - sp[1];
          const cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          shotPos[ev.defenderId] = clampToCourt(sp[0] + (cdx / cd) * 9, sp[1] + (cdy / cd) * 9);
        }
        // Ball movement: swing it around the perimeter before the look. The
        // chain runs handler -> 1-2 teammates -> (recorded assister) ->
        // shooter, so an assisted make's final pass always comes from the
        // player the box score credits.
        const offenseIds = five[poss.team].map(function (p) { return p.id; }).filter(function (id) { return shotPos[id]; });
        // Isolation. Every possession used to be the same play — swing it
        // around the perimeter and shoot — and the pass count was only ever
        // 2, 3 or 4, never fewer and never more. An iso clears the side out
        // and lets one man work, which is a different SHAPE, not just
        // different timing. Outside shots only; a big posting up is not this.
        // Classification is hoisted above the dribble roll because an
        // ankle-breaker is a statement that the man PUT THE BALL ON THE FLOOR,
        // and the count has to know that before it picks. classifyImpact reads
        // only the event and the two players, so moving it earlier changes
        // nothing about what it returns.
        const shooterPlayer = playerById[ev.playerId];
        const dunking = ev.zone === 'inside' && isDunker(shooterPlayer);
        const impactKind = ev.made
          ? classifyImpact(ev, shooterPlayer, playerById[ev.defenderId], pi * 101 + ei)
          : null;

        // Eligibility is unchanged — someone working on the ball against a
        // defender, outside; a big sealing his man under the rim is not this
        // and never was. What changed is that eligibility no longer DECIDES,
        // it only earns a roll. The old `% 5 === 0` made every fifth eligible
        // possession an isolation and the other four identical.
        const onBall = shooterOn && ev.defenderId && shotPos[ev.defenderId] && ev.zone !== 'inside';
        const handleSkill = (onBall && playerById[ev.playerId] && playerById[ev.playerId].attributes)
          ? playerById[ev.playerId].attributes.ballHandling : 50;
        let dribbles = onBall ? dribbleCount(pi * 101 + ei, handleSkill) : 0;
        // The sim already said this shot came out of a breakdown, and a man
        // cannot break his defender down without dribbling — so an ankle-breaker
        // counts as four rather than the count silently contradicting it.
        //
        // But it does NOT also get the size-up string below. The ankle-breaker
        // block further down renders jab / cross / clear / recover, which is
        // four beats and therefore exactly those four dribbles. Running both
        // stacked two lateral-displacement systems on the same axis with the
        // same `dir`, and they cancelled: separation measured 11.3px at the jab
        // and 11.0px at the clear, i.e. the crossover closed the gap instead of
        // opening it. Caught by validate-impactMoments.js.
        const ankle = onBall && impactKind === 'ankle';
        if (ankle) dribbles = 4;
        const isoPlay = dribbles > 0 && !ankle;

        // The chain starts with whoever is ACTUALLY holding the ball, which is
        // not always the possession's designated handler. A defensive rebounder
        // catches it under his own basket and the next beat used to open a pass
        // from the handler standing 130px away — so the ball simply appeared in
        // the handler's hands, having crossed a third of the court in the 60ms
        // release beat. Measured at ~10 a game, up to 139px in one frame: the
        // single biggest teleport left in the ball's path.
        //
        // Prepending him turns that into the outlet pass it always was.
        const chain = [poss.handlerId];
        const lastHolder = heldBallHolder();
        if (lastHolder && lastHolder !== poss.handlerId &&
            shotPos[lastHolder] && offenseIds.indexOf(lastHolder) >= 0) {
          chain.unshift(lastHolder);
        }
        // 0-3 rather than always 1-2, so possessions differ in how much the
        // ball moves and not just in how long each beat lasts
        // A break that swings the ball three times is not a break any more —
        // it has become a half-court set that happened to start quickly.
        const swings = isoPlay ? 0 : (poss.fastBreak ? (pi % 2) : ((pi * 3 + ei) % 4));
        for (let s = 0; s < swings; s++) {
          const cands = offenseIds.filter(function (id) {
            return id !== chain[chain.length - 1] && id !== ev.playerId && id !== ev.assistPlayerId;
          });
          if (cands.length === 0) break;
          // Look for the open man. The target used to be a modular index —
          // whoever happened to sit at (pi*7+ei*3+s*5) % n — so a third of all
          // passes went to a receiver with a defender inside 12px. Now the ball
          // goes to whoever actually has separation, which is what makes the
          // off-ball movement mean something: getting open earns you the ball.
          const prev = shotPos[chain[chain.length - 1]];
          const skip = prev && ((pi * 5 + ei + s) % 4 === 0);
          let pick = cands[0], bestScore = -Infinity;
          cands.forEach(function (id, idx) {
            const q = shotPos[id];
            if (!q) return;
            const open = nearestOf(shotPos, id, defenderIds);
            // a skip looks for the open man on the FAR side; an ordinary swing
            // just wants the open man
            const reach = prev ? Math.hypot(q[0] - prev[0], q[1] - prev[1]) : 0;
            const score = open + (skip ? reach * 0.6 : 0) +
              ((pi * 7 + ei * 3 + s * 5 + idx) % 3);   // tie-break, keeps it from being one fixed answer
            if (score > bestScore) { bestScore = score; pick = id; }
          });
          chain.push(pick);
        }
        if (ev.assistPlayerId && shotPos[ev.assistPlayerId] && chain[chain.length - 1] !== ev.assistPlayerId) {
          chain.push(ev.assistPlayerId);
        }
        if (shooterOn && chain[chain.length - 1] !== ev.playerId) {
          chain.push(ev.playerId);
        }
        // Where the ball actually is as this possession opens. Prepending the
        // rebounder above covers the case where he is still on the floor; this
        // covers the rest, because a player can be SUBSTITUTED OUT while
        // holding the ball, and then he is in no formation to pass from. The
        // first pass leaves from the ball's real position either way, so the
        // ball never crosses the floor without a pass under it.
        const openFrom = heldBallSpot();
        for (let c = 0; c < chain.length - 1; c++) {
          const from = (c === 0 && openFrom) || shotPos[chain[c]] || pos[chain[c]] || handlerPos;
          const to = shotPos[chain[c + 1]];
          if (!to) continue;
          // the last pass of the chain is the feed to the shooter
          const isFeed = (c === chain.length - 2) && !!ev.assistPlayerId;
          const shape = passShape(from, to, isFeed);
          // Only the FIRST release holds: from c=1 on, the previous pass beat has
          // already installed shotPos, so holding and passing shotPos are the
          // same thing. And the ball is at `from`, which for c=0 is now the
          // ball's real previous position -- so the body it leaves is the body
          // that had it.
          push(BEAT.release, (c === 0 ? lastPositions() : null) || shotPos,
            { x: from[0], y: from[1] - 8, holder: null }, period, quarter, clock, '');
          // The ball swing is the single biggest pocket of frozen players in
          // the game. The passer and receiver stay put; everyone else cuts.
          push(shape.ms, flowPositions(shotPos, [chain[c], chain[c + 1]], pi * 3 + c, defenderIds),
            { x: to[0], y: to[1] - 8, holder: chain[c + 1], arc: shape.arc }, period, quarter, clock, '');
          // Live dribble. The receiver puts it on the floor and moves before
          // moving it on, so the ball handler is not a statue between passes —
          // measured at 48% of beats stationary while holding. He has to
          // actually MOVE for the view to draw a dribble at all: the bounce is
          // gated on the holder, and the leg cycle on his velocity.
          const rec = chain[c + 1];
          if (rec !== ev.playerId && shotPos[rec] && (pi * 3 + ei + c) % 3 !== 0) {
            const toRim = [hoop.x - to[0], hoop.y - to[1]];
            const rl = Math.hypot(toRim[0], toRim[1]) || 1;
            const step = clampToCourt(
              to[0] + (toRim[0] / rl) * 12 + cutJitter(pi + c, 6),
              to[1] + (toRim[1] / rl) * 12 + cutJitter(pi + c * 3, 8)
            );
            const dribPos = Object.assign({}, shotPos);
            dribPos[rec] = step;
            push(BEAT.liveDribble, dribPos, { x: step[0], y: step[1], holder: rec },
              period, quarter, clock, '');
            shotPos[rec] = step;   // he passes on from where he dribbled to
          }
        }
        // Working on the ball: one beat per dribble, each one MOVING him — a
        // stationary "dribble" draws no bounce and no leg cycle, so probing has
        // to be real displacement. The side clears out only for the long
        // strings; nobody clears a side for a two-dribble put-down.
        if (isoPlay) {
          const me = ev.playerId, him = ev.defenderId;
          const toRimX = hoop.x - sp[0], toRimY = hoop.y - sp[1];
          const rl = Math.sqrt(toRimX * toRimX + toRimY * toRimY) || 1;
          const lx = -toRimY / rl, ly = toRimX / rl;   // lateral, across his man
          const dir = ((pi + ei) % 2) ? 1 : -1;

          // Everyone else vacates toward the weak side so the lane is his — but
          // only when he is actually going to work. A put-down is not an
          // isolation; clearing a side for two dribbles would turn half the
          // game's possessions into the same set piece.
          let clear = shotPos;
          if (dribbles >= 4) {
            clear = Object.assign({}, shotPos);
            five[poss.team].forEach(function (p) {
              if (p.id === me || !clear[p.id]) return;
              clear[p.id] = clampToCourt(clear[p.id][0] - lx * dir * 20, clear[p.id][1] - ly * dir * 20);
            });
            push(BEAT.isoClear, clear, { x: sp[0], y: sp[1], holder: me },
              period, quarter, clock, '',
              (pi % 3 === 0) ? fillT(COMMENT.bringUp, pi + ei, { h: ln(me), team: teamNames[poss.team] }) : '');
          }

          // THE BALL IS NOT POSITIONED HERE, and a previous version of this
          // spent twenty lines pretending otherwise.
          //
          // It carried a `ballLat` argument that pushed the ball 12px sideways
          // for a behind-the-back, with a comment explaining that without a
          // separate ball path a behind-the-back and a crossover are the same
          // rectangles sliding sideways. The reasoning was right; the code did
          // nothing at all. ui/pixelMotion.js draws a HELD ball at the holder's
          // hand plus the dribble's own offset and never reads the keyframe —
          // move the keyframe ball 800px and the drawn ball does not shift by
          // 0.0001px. So the swing was computed, stored, and discarded, every
          // behind-the-back in the game.
          //
          // The ball's path through a move now lives in pixelMotion, where the
          // thing that draws it can see it, and the choreographer says only
          // WHICH move is playing (see tagDribble below).
          function probe(offLat, offRim, seed) {
            const spot = clampToCourt(sp[0] + lx * dir * offLat + (toRimX / rl) * offRim,
              sp[1] + ly * dir * offLat + (toRimY / rl) * offRim);
            const p = Object.assign({}, clear);
            p[me] = spot;
            // his man mirrors, a beat late and a step short
            if (p[him]) p[him] = clampToCourt(p[him][0] + lx * dir * offLat * 0.6,
              p[him][1] + ly * dir * offLat * 0.6);
            // the four men who cleared out do not stand and watch him work
            const flowed = flowPositions(p, [me, him], pi * 37 + seed, defenderIds);
            push(BEAT.isoSize, flowed, { x: spot[0], y: spot[1], holder: me }, period, quarter, clock, '');
            return flowed;
          }

          // The shape falls out of the count rather than being picked beside
          // it. Two dribbles cannot be a double move and eight cannot be a
          // put-down, so there is nothing left to get out of step.
          // Three shapes share the middle band now: a crossover across his
          // front, a behind-the-back around his back, and a between-the-legs
          // through his stance. They are the three genuinely different pictures
          // available at this size, so they split it evenly.
          const midRoll = roll01(pi * 17 + ei);
          const moveKind = dribbles <= 2 ? 'putdown'
            : dribbles >= 7 ? 'double'
              : (midRoll < 0.37 ? 'cross' : (midRoll < 0.71 ? 'behind' : 'legs'));

          // THE STEPBACK is a finishing move laid on the END of the handle, not
          // one of the shapes above — which is what it is in basketball too: he
          // works, then he steps back into the shot. So it does not compete with
          // moveKind for the string; it appends two beats after it.
          //
          // Only off a real string (he has to have driven the man somewhere to
          // step back FROM) and only into a jumper. A stepback layup is not a
          // thing, and a stepback in front of a man who never moved is just a
          // player wandering backwards.
          const stepBack = dribbles >= 4 &&
            (ev.zone === 'mid' || ev.zone === 'three') &&
            him && clear[him] &&
            roll01(pi * 23 + ei * 5) < 0.35;

          // One beat per dribble, so the marker is not a claim the beats fail
          // to back up. The string alternates sides on a decaying amplitude and
          // creeps toward the rim.
          let back = clear;
          for (let d = 0; d < dribbles; d++) {
            const side = (d % 2) ? -1 : 1;
            // the double move's signature is that the LAST pair is the biggest,
            // after the defender has already ridden out three smaller ones
            const late = (moveKind === 'double' && d >= dribbles - 2);
            const amp = (moveKind === 'putdown' ? 5 : 11 - (d % 3) * 2) + (late ? 4 : 0);
            const rim = 2 + (d % 3) * 2;
            back = probe(side * amp, rim, d + 1);
            // the marker goes on the first beat of the string, one per string,
            // which is what scripts/probe-dribbles.js counts
            if (d === 0) tagHandle({ n: dribbles, move: moveKind });
            // ...and this one goes on every beat, because the ball's path is a
            // per-frame question
            tagDribble(moveKind, dribbles, d);
          }
          if (stepBack) {
            // PLANT. He drives IN past the spot the sim says he shot from, and
            // his man goes with him — that closing step is the thing the push
            // is about to punish. Going in first is what makes the retreat
            // legible: a man who simply walks backwards from where he already
            // stood has not stepped back from anything.
            const driveIn = Object.assign({}, back);
            driveIn[me] = clampToCourt(sp[0] + (toRimX / rl) * 11, sp[1] + (toRimY / rl) * 11);
            if (driveIn[him]) {
              driveIn[him] = clampToCourt(driveIn[me][0] + (toRimX / rl) * 7,
                driveIn[me][1] + (toRimY / rl) * 7);
            }
            push(BEAT.stepbackPlant,
              flowPositions(driveIn, [me, him], pi * 47 + ei * 3, defenderIds),
              { x: driveIn[me][0], y: driveIn[me][1], holder: me }, period, quarter, clock, '');
            // DELIBERATELY NO `tagHandle` HERE, and the reason is a metric.
            //
            // `handle` is the possession's dribble-COUNT marker — one per
            // possession, and what scripts/probe-dribbles.js divides by to
            // report the 50/25/15/10 distribution the sim rolls. Marking the
            // stepback as a second string made every stepback possession count
            // twice, which pushed the no-dribble share from 44.3% to 36.5%
            // against a 50% target: a reporting artefact that looked exactly
            // like the roll having drifted.
            //
            // The stepback is choreography laid on top of the handle, not a
            // second handle. It is counted off its own `step` marker instead.
            tagStep({ phase: 'plant', id: me, on: him });
            // The ball rides its own path across these two beats — one hard
            // push-off dribble that never changes hands. See the `stepback`
            // entry in dribbleCrossings for why that is the whole point.
            tagDribble('stepback', 2, 0);

            // PUSH. He goes back to the shot spot; his man does NOT come with
            // him, and that gap is the move. `squeak` is the foot plant, the
            // same voice the ankle breaker's cut uses.
            const away = Object.assign({}, driveIn);
            away[me] = sp;
            push(BEAT.stepbackPush,
              flowPositions(away, [me, him], pi * 53 + ei * 7, defenderIds),
              { x: sp[0], y: sp[1], holder: me }, period, quarter, clock, '', '', 'squeak');
            tagStep({ phase: 'push', id: me, on: him });
            tagDribble('stepback', 2, 1);
            // He is already standing on the shot spot, so the attack beat below
            // would be a beat of nothing. The separation persists into the shot,
            // which is the point of having made it.
            back = away;
            shotPos[me] = sp;
            if (away[him]) shotPos[him] = away[him];
          } else {
            // and back to the spot the sim says he shot from
            const attack = Object.assign({}, back);
            attack[me] = sp;
            push(BEAT.isoAttack, attack, { x: sp[0], y: sp[1], holder: me }, period, quarter, clock, '');
            shotPos[me] = sp;
            if (back[him]) shotPos[him] = back[him];
          }
        }

        // Ball screen. There was no screen anywhere in the timeline — the one
        // structure that makes a half-court possession read as a designed play
        // rather than five men passing. The screener steps into the handler's
        // defender, the handler comes off it with separation, and the screener
        // rolls to the rim.
        //
        // Not on every possession: a screen on all of them would be as
        // characterless as none. Skipped on fast breaks (nobody screens in
        // transition) and when the shooter already has a crossover coming, so
        // the two moves never stack on the same shot.
        if (!poss.fastBreak && shooterOn && (pi + ei) % 3 === 0 && ev.defenderId && shotPos[ev.defenderId]) {
          const bigs = five[poss.team]
            .map(function (p) { return p.id; })
            .filter(function (id) { return id !== ev.playerId && shotPos[id]; });
          const screener = bigs.length ? bigs[(pi + ei) % bigs.length] : null;
          if (screener) {
            const dOn = shotPos[ev.defenderId];
            const toHoopX = hoop.x - sp[0], toHoopY = hoop.y - sp[1];
            const hl = Math.sqrt(toHoopX * toHoopX + toHoopY * toHoopY) || 1;
            // set the pick on the defender's up-court shoulder
            const setPos = Object.assign({}, shotPos);
            setPos[screener] = clampToCourt(dOn[0] - (toHoopX / hl) * 11, dOn[1] - (toHoopY / hl) * 11);
            push(BEAT.screenSet, setPos, { x: sp[0], y: sp[1], holder: ev.playerId },
              period, quarter, clock, '');
            // handler comes off it; the defender is a step behind; big rolls
            const usePos = Object.assign({}, setPos);
            usePos[ev.defenderId] = clampToCourt(dOn[0] - (toHoopX / hl) * 7, dOn[1] - (toHoopY / hl) * 7);
            usePos[screener] = clampToCourt(setPos[screener][0] + (toHoopX / hl) * 26,
              setPos[screener][1] + (toHoopY / hl) * 26);
            push(BEAT.screenUse, usePos, { x: sp[0], y: sp[1], holder: ev.playerId },
              period, quarter, clock, '');
            // the roll and the recovery stand for the rest of the possession
            shotPos[screener] = usePos[screener];
            shotPos[ev.defenderId] = usePos[ev.defenderId];
          }
        }

        // `shooterPlayer`, `dunking` and `impactKind` are computed above the
        // dribble roll — an ankle breaker has to be choreographed BEFORE the
        // shot goes up, because the move is what creates the shot rather than a
        // decoration on top of it, and the dribble count has to know about it.

        // The crossover. Worked ACROSS the defender rather than at him: the
        // lateral axis is perpendicular to the line to the rim, so the jab and
        // the cut back read as side-to-side even on a corner three.
        let crossMeta = null;
        if (impactKind === 'ankle' && shooterOn && ev.defenderId && shotPos[ev.defenderId]) {
          const vx = hoop.x - sp[0], vy = hoop.y - sp[1];
          const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
          const lx = -vy / vlen, ly = vx / vlen;
          const dir = ((pi + ei) % 2) ? 1 : -1;
          const handler = ev.playerId, victim = ev.defenderId;
          const dstart = shotPos[victim];
          crossMeta = { by: handler, on: victim };

          // The other eight keep playing. Measured over four games, 76% of
          // players were motionless through the clear and the cross — the beat
          // where the handler is supposed to be exploding into daylight was a
          // ten-man freeze frame with two men moving in it. The dunk and the
          // jump shot both had this and both were fixed the same way: flow the
          // floor, lock the two the moment belongs to.
          //
          // Locking matters here more than anywhere else. The beaten defender
          // has to STAY beaten, and a flowed victim would quietly drift back
          // into the man who just crossed him.
          function step(hOff, dOff, seed) {
            const p = flowPositions(shotPos, [handler, victim], seed, defenderIds);
            p[handler] = clampToCourt(sp[0] + lx * dir * hOff, sp[1] + ly * dir * hOff);
            p[victim] = clampToCourt(dstart[0] + lx * dir * dOff, dstart[1] + ly * dir * dOff);
            return p;
          }
          // jab one way — the defender bites HARDER than the jab, which is the
          // whole trick: he has to be further across than the man he guards.
          //
          // Displacement was 7/13 -> -8/17 -> 0/19, which left two body widths
          // of daylight on a 10px sprite. Now 10/20 -> -12/26 -> 0/30: three
          // body widths, chosen from four treatments played side by side.
          const jab = step(10, 20, pi * 31 + ei);
          push(BEAT.crossJab, jab, { x: jab[handler][0], y: jab[handler][1], holder: handler },
            period, quarter, clock, '', '', '', null, null, { phase: 'jab', by: handler, on: victim });
          // This string is the possession's dribbles — see the `ankle` branch
          // at the roll. Marked here so the probe counts it once, in the same
          // place it counts every other string.
          tagHandle({ n: dribbles, move: 'ankle' });
          // The ball's own path across these three beats. The move is named for
          // a crossover and, until this, the ball stayed in one hand through
          // most of them: measured at 0.64 hand changes per ankle breaker.
          tagDribble('ankle', ANKLE_BEATS, 0);
          // cut back hard; he keeps going the wrong way
          const cut = step(-12, 26, pi * 37 + ei * 3);
          push(BEAT.crossCut, cut, { x: cut[handler][0], y: cut[handler][1], holder: handler },
            period, quarter, clock, '', '', 'squeak', null, null, { phase: 'cross', by: handler, on: victim });
          tagDribble('ankle', ANKLE_BEATS, 1);
          // and rise into the shot with the separation already open
          const clear = step(0, 30, pi * 41 + ei * 5);
          push(BEAT.crossClear, clear, { x: sp[0], y: sp[1], holder: handler },
            period, quarter, clock, '', '', '', null, null, { phase: 'clear', by: handler, on: victim });
          tagDribble('ankle', ANKLE_BEATS, 2);
          // the defender STAYS beaten for the rest of the possession — leaving
          // him displaced is what makes the shot look uncontested
          shotPos[victim] = clear[victim];
        }

        // windup: shooter gathers, everyone else finishes their cuts. 98% of
        // players were frozen through this beat — the comment described cuts
        // the positions never actually contained. The shooter and his defender
        // hold; after a crossover the beaten defender especially must not drift
        // back into him, which is why he is locked rather than flowed.
        push(BEAT.windup,
          flowPositions(shotPos, [ev.playerId, ev.defenderId], pi * 5 + 1, defenderIds),
          { x: sp[0], y: sp[1], holder: shooterOn ? ev.playerId : null },
          period, quarter, clock, '', '', '', null, null,
          crossMeta ? { phase: 'recover', by: crossMeta.by, on: crossMeta.on } : null);
        // inside shots drive to the rim before finishing
        let releasePos = shotPos;
        let relSpot = sp;
        if (ev.zone === 'inside' && shooterOn) {
          // He gathers a body-and-a-half out, not on top of the rim. At 8px the
          // whole leap covered 6.2px -- less than the 10px sprite is wide -- so a
          // dunk read as a man standing under the basket who briefly got taller.
          // Measured travel by approach distance: 8px->6.2, 12px->9.7, 16px->13.5,
          // 20px->17.4. 16 clears a full body width across the 150ms rise (90
          // px/sec) without turning the drive into a slide.
          // A dunker drives along the line he will jump FROM, so the leap is
          // straight up rather than a lurch toward the hoop at the last moment.
          const rimSpot = clampToCourt(hoop.x + (poss.team === 'home' ? -16 : 16),
            hoop.y + (dunking ? DUNK_REACH : 0) + cutJitter(pi + ei, 6));
          releasePos = Object.assign({}, shotPos);
          releasePos[ev.playerId] = rimSpot;
          relSpot = rimSpot;
          // the driver and his man hold; the weak side rotates
          push(BEAT.drive, flowPositions(releasePos, [ev.playerId, ev.defenderId], pi * 13 + ei, defenderIds),
            { x: rimSpot[0], y: rimSpot[1], holder: ev.playerId }, period, quarter, clock,
            // HE IS DRIBBLING IT IN, which this beat never said.
            //
            // Section 8 asks for the dribble to flow into the takeoff, and the
            // reason it never did is not a rough seam — a dunk never followed a
            // dribble AT ALL. The string is gated on the shot being outside and
            // every dunk is inside, so measured over a game not one dunk had a
            // dribble keyframe behind it.
            //
            // The drive was already here, though: this beat has always carried
            // him from where the sim shot from to where he gathers. It simply
            // said nothing about the ball, so he crossed that ground holding it
            // still. Marking it costs no beats — section 25's rule — and the
            // last bounce now hands over to the gather.
            '', '', 'dribble');
          // The ball's path, not the possession's dribble COUNT. `tagHandle` is
          // the counted one and this is deliberately not it: the stepback made
          // that mistake and moved a reported metric by eight points.
          tagDribble('drive', 1, 0);
        }
        if (ev.made) {
          score[ev.team === 'home' ? 0 : 1] += ev.points;
          addPoints(ev.playerId, ev.points);
        }
        const madeLabel = ev.zone === 'inside'
          ? (dunking
              ? DUNK_FINISHES[(pi + ei) % DUNK_FINISHES.length]
              : LAYUP_FINISHES[(pi + ei) % LAYUP_FINISHES.length])
          : (ev.points === 3 ? 'Three-pointer!' : 'It\'s good!');
        const crashPos = crashPositions(releasePos, ev.playerId, hoop, pi + ei);
        const shotTemplates = ev.zone === 'three' ? COMMENT.threeMake : (ev.zone === 'mid' ? COMMENT.midMake : COMMENT.insideMake);
        let shotComment = ev.made
          ? fillT(shotTemplates, pi + ei, { s: ln(ev.playerId) })
          : fillT(COMMENT.miss, pi + ei, { s: ln(ev.playerId) });
        if (ev.made && ev.assistPlayerId && (pi + ei) % 2 === 0) {
          shotComment += ' (' + ln(ev.assistPlayerId) + ' with the dime)';
        }
        // Posters resolve at the rim, ankle breakers where the shot went up.
        // (impactKind is classified above the windup — see the crossover.)
        const impactAt = impactKind === 'poster'
          ? { x: hoop.x, y: hoop.y }
          : { x: relSpot[0], y: relSpot[1] };
        // `check` rides along so ui/pixelHud.js can show the contest that
        // produced the highlight. Without it the panel renders a caption and
        // nothing else, which is the feature silently degrading to what it
        // replaced — see validate-pixel-choreographer's marker assertion.
        const impactMarker = impactKind
          ? { kind: impactKind, at: impactAt, byId: ev.playerId, onId: ev.defenderId, check: ev.check || null }
          : null;
        if (ev.made && dunking && shooterOn) {
          // A dunk is not a release and a flight — the ball never leaves the
          // hand until it goes through. Gather, rise to the rim carrying it,
          // slam, land. Drawn as four beats so the view can hang the sprite at
          // the top instead of sliding it past the rim at constant speed.
          const rimX = hoop.x + (poss.team === 'home' ? -3 : 3);
          // HE HAS TO STAND BACK BY HIS OWN REACH, or the leap carries his hand
          // AWAY from the rim. This put his feet on the hoop's own floor spot,
          // so once the view lifted him 16px and hung the ball 30px above that,
          // the ball sat 46px clear of the rim at the top of the dunk -- nearly
          // two body heights on a 24px sprite. He was dunking on nothing.
          const apexPos = Object.assign({}, releasePos);
          apexPos[ev.playerId] = clampToCourt(rimX, hoop.y + DUNK_REACH);
          // THE FLOOR HOLDS. This used to be built from crashPos, the rebound
          // formation — so on the slam, the one beat that is supposed to be
          // the moment, all nine other players teleported into rebounding
          // spots. Measured across 325 dunks: 18.8px mean and 29.3px max in a
          // 90ms beat, 209 px/sec, against 30 px/sec on the rise. Two body
          // widths, seven times faster than anything around it, pulling the
          // eye off the rim exactly when it should be nailed to it. Then they
          // stood perfectly still for the landing: 0.0px. Backwards on both
          // beats.
          //
          // Nobody crashes the glass on a MADE dunk anyway. The next
          // possession's transition beat is 580ms and moves everyone with room
          // to spare, so holding here costs nothing and buys the whole moment.
          const dunkBy = ev.playerId;
          // The weak side keeps moving through the dunk. Without this the
          // whole floor froze for the four beats of every finish at the rim,
          // which got worse the moment transition started producing more of
          // them — frozen player-beats went 12% to 24% on that change alone.
          const dunkLock = [ev.playerId, ev.defenderId];
          // Computed here rather than at the rise push, because the slam and
          // the landing both HOLD this exact frame and need it in hand first.
          const risePos = flowPositions(apexPos, dunkLock, pi * 23 + ei, defenderIds);
          // Where the floor has got to by the END of the hang. The slam and the
          // landing both hold this frame, so it has to be computed before them —
          // and it has to come from the HANG rather than from the rise, or the
          // slam drags all nine of them back to where they stood before the hang
          // flowed them. That is a backwards teleport on the one beat the eye is
          // guaranteed to be watching.
          const hangPos = flowPositions(risePos, dunkLock, pi * 73 + ei * 11, defenderIds);
          const landPos = Object.assign({}, hangPos);
          // Posterized: the defender is driven back off the rim. Without this
          // the victim stands politely still and it reads as an uncontested
          // dunk — the defender's reaction IS the poster.
          const victim = ev.defenderId;
          if (impactKind === 'poster' && victim && landPos[victim]) {
            const away = (poss.team === 'home' ? 1 : -1);   // back away from this hoop
            landPos[victim] = clampToCourt(
              landPos[victim][0] + away * 9,
              landPos[victim][1] + ((pi + ei) % 2 ? 5 : -5)
            );
          }
          // WHICH DUNK. Context first: how much runway he had, whether a body is
          // in the way, whether he is finishing his own miss, how high he can
          // actually get, and what he did last time.
          const runway = Math.hypot(relSpot[0] - sp[0], relSpot[1] - sp[1]);
          const dunkCtx = {
            tier: _DUNKS.dunkTierFor(shooterPlayer),
            // A DEAD CLAUSE, and it is why contact fired on 2.9% of dunks.
            //
            // This read `impactKind === 'poster' || (onBall && ev.zone ===
            // 'inside')` — and `onBall` is defined above as, among other
            // things, `ev.zone !== 'inside'`. The second half could never be
            // true. Every contact dunk in the game came from the poster marker
            // alone; the clause meant to catch "defended at the rim" caught
            // nothing at all, which is exactly the shape of thing this whole
            // pass keeps turning up.
            //
            // Said properly: a body between him and the rim. Not every defended
            // inside shot — a man contesting from a step away is a contest, not
            // contact — so it wants him CLOSE, which is what the distance is.
            // WHOEVER IS ACTUALLY IN THE WAY, not the nominal defender.
            //
            // Keying on `ev.defenderId` was the second version of this and it
            // fired zero times: the man the sim charged with the shot is often
            // not the man standing under the rim, and on an inside finish it is
            // usually a help defender who gets run through. Measured over 442
            // dunks, the nearest OPPONENT is inside 14px on 22% of them while
            // the nominal defender almost never is.
            // THE SIM'S ANSWER, when it has one. It rolls contact now and puts
            // it on the event, so the finish that is drawn through a body is the
            // same finish that was resolved through one — these used to be two
            // independent guesses that agreed only by accident.
            //
            // The positional fallback stays for events that predate the flag
            // (a replayed save, a fixture) rather than being deleted.
            contact: typeof ev.contact === 'boolean'
              ? (ev.contact || impactKind === 'poster')
              : (impactKind === 'poster' ||
                 nearestOpponentPx(shotPos, defenderIds, relSpot) <= CONTACT_RIM_PX),
            putback: lastOrebBy === ev.playerId,
            runway: runway,
            // The ANGLE he attacked from, not just the distance. Lateral
            // separation between where he started and the rim: a big number is
            // a baseline drive, a small one is straight down the middle.
            baseline: runway > 1 &&
              Math.abs(sp[1] - hoop.y) / runway >= BASELINE_ANGLE_RATIO,
            // THE ALLEY-OOP, which has been dead code since the pool rules for
            // it were written: `dunkPool` has known how to filter for one all
            // along and nothing ever set the flag.
            //
            // The signal is an assisted dunk where the passer is far enough away
            // for the ball to have been in the air — a dish from two feet is a
            // handoff, not a lob. Not every assisted dunk: an oop is a specific
            // play, and firing on all of them would make it the new default.
            alley: !!(ev.assistPlayerId && shotPos[ev.assistPlayerId] &&
              Math.hypot(shotPos[ev.assistPlayerId][0] - relSpot[0],
                shotPos[ev.assistPlayerId][1] - relSpot[1]) >= ALLEY_MIN_PASS &&
              roll01(pi * 97 + ei * 11) < ALLEY_RATE),
            lastId: lastDunkById[ev.playerId] || null
          };
          const theDunk = _DUNKS.pickDunk(dunkCtx, pi * 67 + ei * 13 + 5);
          lastDunkById[ev.playerId] = theDunk.id;
          const dunkBeatsMs = _DUNKS.dunkBeats(theDunk, dunkCtx);
          // An oop's route does not start until he CATCHES it. Through the
          // gather, the plant and the rise the ball is not in his hands at all —
          // it is in the air — so the whole route is spent between the catch and
          // the rim rather than being a climb he never made.
          const routeMarks = dunkCtx.alley
            ? { gather: 0, plant: 0, rise: 0, hang: 0, slam: 1, land: 1 }
            : _DUNKS.dunkRouteMarks(dunkBeatsMs);
          const landing = _DUNKS.dunkLanding(theDunk, dunkCtx);
          // Everything the view needs to draw THIS dunk, stamped on every phase
          // of the string so a seek into the middle of one still knows what it
          // is watching.
          const dunkMeta = {
            id: dunkBy, dunk: theDunk, landing: landing,
            contact: !!dunkCtx.contact, putback: !!dunkCtx.putback,
            // How much taller or shorter than a median body he is, so the leap
            // can compensate. The rim is at a fixed height and the catalogue's
            // lifts are written for a median frame, so without this a short
            // guard finishes under the hoop and a centre finishes over it.
            tall: _spriteTallness(shooterPlayer && shooterPlayer.heightIn),
            alley: !!dunkCtx.alley,
            baseline: !!dunkCtx.baseline
          };
          function dunkPhase(phase) {
            return Object.assign({ phase: phase, route: routeMarks[phase] }, dunkMeta);
          }

          // `zoomTo` rides the GATHER beat, not the rise. Keyframes sit at beat
          // ENDS, so the rise keyframe is the apex — arming there put the camera
          // in only after he was already up. On the gather it covers the whole
          // ascent, which is the part worth magnifying.
          // WHO HAS THE BALL, and where it is. On an oop it is not him: the
          // passer still has it through the gather, it is in the air across the
          // plant and the rise, and he catches it at the top. `s.arrival` in
          // ui/pixelMotion.js already lands a caught ball in the HAND rather
          // than at the catcher's feet, so the catch needs no special case —
          // it needs the holder to change on the right keyframe, which is the
          // whole thing that was missing.
          const oopFrom = dunkCtx.alley && shotPos[ev.assistPlayerId]
            ? shotPos[ev.assistPlayerId] : null;
          const oopMid = oopFrom
            ? [(oopFrom[0] + relSpot[0]) / 2, (oopFrom[1] + relSpot[1]) / 2] : null;
          push(dunkBeatsMs.gather, flowPositions(releasePos, dunkLock, pi * 19 + ei, defenderIds),
            oopFrom
              ? { x: oopFrom[0], y: oopFrom[1], holder: ev.assistPlayerId }
              : { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', oopFrom ? 'lob' : '', null,
            // The camera goes to an OOP as well as to a poster. It is the other
            // finish that is worth leaning in for, and it is the one where the
            // interesting thing (a ball crossing the lane) happens somewhere
            // other than under the rim.
            Object.assign(dunkPhase('gather'),
              { zoomTo: impactKind === 'poster' ? impactAt
                  : (oopFrom ? { x: relSpot[0], y: relSpot[1] } : null) }));
          // THE PLANT. His foot against the floor, at the deepest point of the
          // load — the frame everything is about to reverse from. The ten-phase
          // structure named it and there was nowhere for it to live.
          push(dunkBeatsMs.plant, flowPositions(releasePos, dunkLock, pi * 71 + ei, defenderIds),
            oopMid
              // in the air, halfway, carrying its own arc so the distance
              // formula does not lob a short lob at the 32px ceiling
              ? { x: oopMid[0], y: oopMid[1], holder: null, arc: ALLEY_ARC }
              : { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', 'squeak', null, dunkPhase('plant'));
          push(dunkBeatsMs.rise, risePos,
            oopFrom
              // still in the air, arriving at him. The holder changes on the
              // HANG, which is the catch.
              ? { x: relSpot[0], y: relSpot[1], holder: null, arc: ALLEY_ARC }
              : { x: rimX, y: hoop.y, holder: ev.playerId },
            period, quarter, clock, '', '', '', null, dunkPhase('rise'));
          // THE HANG. The top, held. A peak that lasts one frame is a peak the
          // eye never lands on, and how long he holds it is most of what makes a
          // windmill feel different from a quick finish.
          //
          // HE hangs; the other nine do not. Built from risePos the first time,
          // which held every player on the floor for up to 240ms and measured
          // 100% frozen — the same defect the landing beat had, arriving through
          // a new phase. The finisher and the man under him are locked (he is
          // the still point the shot is about, and a flowed victim would drift
          // out from under him); everybody else keeps playing.
          push(dunkBeatsMs.hang, hangPos,
            { x: rimX, y: hoop.y, holder: ev.playerId },
            // THE CATCH. The hang is the keyframe the ball changes hands on for
            // an oop — that is what makes it an oop rather than a dunk with a
            // pass in front of it — so the slap of hands on ball belongs here
            // and nowhere else.
            period, quarter, clock, '', '', oopFrom ? 'catch' : '', null,
            dunkPhase('hang'));
          // THE SLAM STAYS FROZEN, and that is not an oversight to be tidied up
          // later. 90ms with the whole floor held is the impact hold: the eye
          // is nailed to the rim, and this beat is where the previous version
          // teleported nine men into rebounding spots at 209px/sec — two body
          // widths, seven times faster than the rise around it. It is the one
          // beat in the game where a freeze is the effect.
          push(dunkBeatsMs.slam, landPos, { x: hoop.x, y: hoop.y, holder: null },
            period, quarter, clock, madeLabel, shotComment, 'dunk', impactMarker, dunkPhase('slam'));
          // THE LANDING DOES NOT. By here the ball is through the net and play
          // is restarting, and holding a second beat merely because the slam
          // before it is held turns a 90ms accent into a 220ms stall — measured
          // at 100% of players motionless for the whole 130ms. The dunker and
          // the man he went over stay locked (a poster's victim has to STAY
          // driven back, or the reaction that made it a poster quietly undoes
          // itself); everybody else gets on with the game.
          const dunkLandPos = flowPositions(landPos, dunkLock, pi * 43 + ei * 7, defenderIds);
          push(dunkBeatsMs.land, dunkLandPos, { x: hoop.x, y: hoop.y + 7, holder: null },
            period, quarter, clock, '', '', '', null, dunkPhase('land'));
          curPos = dunkLandPos;
        } else if (ev.zone === 'mid' || ev.zone === 'three') {
          // The jump shot, with an actual jump in it. Measured before this: the
          // whole motion occupied 3-4 frames (48-64ms) because it lived inside
          // the 60ms release beat, so the dip and the rise were never visible.
          // A three gets a deeper gather than a pull-up.
          const three = ev.zone === 'three';
          const jumpBy = ev.playerId;
          // Positions do NOT change through the jump — only height, which lives
          // in the view. That matters: an ankle breaker's camera is aimed at
          // relSpot, and the shooter has to still be standing on it.
          // The SHOOTER holds his spot -- his height is what moves, and an
          // ankle breaker's camera is aimed at relSpot, so he has to still be
          // standing on it. Everyone else keeps playing.
          //
          // All three beats used to hand out the identical `releasePos`, which
          // measured 100% of players motionless for the whole rise and 81-84%
          // through the release: 180-210ms of a ten-man freeze frame on every
          // jump shot in the game, ~85 a game. The dunk already solved this --
          // flow the floor, lock the two men the moment belongs to -- and the
          // jump shot never got the same treatment.
          const jumpLock = [ev.playerId, ev.defenderId];
          push(three ? BEAT.jumpGatherThree : BEAT.jumpGatherMid,
            flowPositions(releasePos, jumpLock, pi * 13 + ei, defenderIds),
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'gather', id: jumpBy, three: three });
          push(three ? BEAT.jumpRiseThree : BEAT.jumpRiseMid,
            flowPositions(releasePos, jumpLock, pi * 17 + ei * 3, defenderIds),
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'rise', id: jumpBy, three: three });
          // the ball leaves at the apex, not from a standing sprite
          push(BEAT.jumpRelease, releasePos, { x: relSpot[0], y: relSpot[1] - 20, holder: null },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'release', id: jumpBy, three: three,
              // He is watching it. Whether it went in decides how long he holds
              // the follow-through and whether his shoulders go afterwards —
              // the one man on the floor guaranteed to have an opinion about
              // the shot had none.
              made: !!ev.made });
          // ...and he holds the follow-through while it is in the air
          push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
            ev.made ? madeLabel : '', shotComment,
            ev.made ? 'swish' : 'clang', impactMarker, null, null,
            { phase: 'follow', id: jumpBy, three: three });
          curPos = crashPos;
        } else {
          // The layup, in the three beats the jump shot and the dunk have had
          // all along. One 200ms beat carried the gather, the takeoff, the
          // extension and the release together, which is why the finish read as
          // a bump rather than as a man going up.
          //
          // `closeSide` is the direction of the rim from where he gathers, and
          // it is what stops a left-side finish being the right-side one drawn
          // backwards: the view puts the ball on the leading hand and angles the
          // body from it.
          const closeBy = ev.playerId;
          const closeSide = hoop.x >= relSpot[0] ? 1 : -1;
          const closeLock = [ev.playerId, ev.defenderId];
          // Which kind of lay-in, from where he is and who is in front of him.
          const closeFinish = layupFinish(
            Math.hypot(hoop.x - relSpot[0], hoop.y - relSpot[1]),
            hoop.y - relSpot[1],
            playerById[ev.playerId] && playerById[ev.playerId].heightIn,
            playerById[ev.defenderId] && playerById[ev.defenderId].heightIn,
            pi * 59 + ei);
          const closeMeta = { id: closeBy, side: closeSide, finish: closeFinish };
          // WHICH APPROACH, if any. Context first, the same way the dunk
          // catalogue picks: a euro needs a body to go around and room to go
          // around it, a spin needs a man close enough to turn his back on.
          // Most finishes get neither, which is correct — a layup that euro-steps
          // every time is the repetition this pass exists to remove.
          const closeApproach = approachFor({
            defended: !!ev.defenderId,
            zone: ev.zone,
            lateral: Math.abs(hoop.y - relSpot[1]),
            finish: closeFinish
          }, pi * 71 + ei * 7);
          if (closeApproach) {
            // He has to actually MOVE, or this is a pose change rather than
            // getting past someone. The steps go out and then across, and the
            // defender holds his ground — which is what being beaten looks like.
            const beats = approachBeats(closeApproach);
            const away = closeSide;
            beats.forEach(function (ph, k) {
              const step = approachStep(closeApproach, k, away);
              const at = Object.assign({}, releasePos);
              at[closeBy] = clampToCourt(relSpot[0] + step[0], relSpot[1] + step[1]);
              push(BEAT[ph],
                flowPositions(at, closeLock, pi * 83 + ei * 5 + k, defenderIds),
                { x: at[closeBy][0], y: at[closeBy][1], holder: ev.playerId },
                // FOOTWORK HAS A SOUND, and both of these are footwork — a
                // euro's plant and a pivot are shoe against floor, which is
                // exactly what `squeak` is for. Built silent first, which put
                // a mute move next to a dunk that squeaks on its own plant.
                period, quarter, clock, '', '', 'squeak');
              tagClose(Object.assign({ phase: ph, approach: closeApproach,
                step: (k + 1) / beats.length }, closeMeta));
            });
          }
          // The floor keeps playing through all three, locked on the two men the
          // moment belongs to — the same treatment the jump shot needed when it
          // measured a ten-man freeze frame through its rise.
          push(BEAT.closeGather,
            flowPositions(releasePos, closeLock, pi * 23 + ei, defenderIds),
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '');
          tagClose(Object.assign({ phase: 'gather' }, closeMeta));
          push(BEAT.closeRise,
            flowPositions(releasePos, closeLock, pi * 29 + ei * 3, defenderIds),
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '');
          tagClose(Object.assign({ phase: 'rise' }, closeMeta));
          // release: ball leaves the hands, at the top of the finish rather than
          // with his feet already back on the floor
          push(BEAT.closeRelease, releasePos, { x: relSpot[0], y: relSpot[1] - 12, holder: null }, period, quarter, clock, '');
          tagClose(Object.assign({ phase: 'release' }, closeMeta));
          // ...and flies to the rim while everyone crashes the glass — the
          // floor keeps moving for the whole flight instead of freezing
          push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
            ev.made ? madeLabel : '', shotComment,
            ev.made ? (dunking ? 'dunk' : 'swish') : 'clang',
            impactMarker);
          // ...and he comes down on it. Without a 'land' phase the finisher was
          // still at full lift when the release beat ended and simply cut to
          // standing on the next frame.
          tagClose(Object.assign({ phase: 'land' }, closeMeta));
          curPos = crashPos;
        }
        // missed shots rattle off the rim before the board scramble
        if (!ev.made) {
          // 100% of players were frozen through the rim rattle. A live ball off
          // the iron is the one moment everybody SHOULD be moving.
          push(BEAT.bounce, flowPositions(crashPos, [], pi * 7 + ei, defenderIds),
            { x: hoop.x + (poss.team === 'home' ? -6 : 6), y: hoop.y - 8, holder: null }, period, quarter, clock, '');
        }
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, curPos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        const rebComment = ev.offensive
          ? fillT(COMMENT.oreb, pi + ei, { r: ln(ev.playerId) })
          : (pi % 3 === 0 ? fillT(COMMENT.dreb, pi + ei, { r: ln(ev.playerId) }) : '');
        push(BEAT.resolve, flowPositions(rpos, [ev.playerId], pi * 11 + ei),
          { x: rp[0], y: rp[1], holder: rpos[ev.playerId] ? ev.playerId : null }, period, quarter, clock,
          ev.offensive ? 'Offensive board' : '', rebComment);
        // Remembered so the NEXT finish knows it is a putback: caught off the
        // glass and put straight back, which is a different animation from a
        // man who drove the length of the floor to get there.
        lastOrebBy = ev.offensive ? ev.playerId : null;
        curPos = rpos;
        if (ev.type !== 'rebound') lastOrebBy = null;
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, curPos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        addFoul(ev.defenderId);
        addPoints(ev.playerId, ev.points);
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts,
          fillT(COMMENT.ft, pi + ei, { s: ln(ev.playerId), made: ev.made, att: ev.attempts }), 'whistle');
        curPos = fpos;
      }
    });

    // Record how this possession ENDED, for the next one's inbound. Walked in
    // order and last-write-wins: an offensive rebound that turns a miss into a
    // putback has to end up counting as a make.
    plays.forEach(function (ev) {
      if (ev.type === 'shot') prevMade = !!ev.made;
      else if (ev.type === 'ft') prevMade = ev.made > 0;
      else if (ev.type === 'turnover') prevMade = false;
    });

    applyShotClock(firstKf);
    timeline.durationMs = t;
  }

  function finish() {
    if (finished) return timeline;
    finished = true;
    lineScore.push({
      quarter: linePeriod === null ? 1 : linePeriod,
      home: score[0] - atPeriodStart[0],
      away: score[1] - atPeriodStart[1]
    });
    timeline.durationMs = t;
    return timeline;
  }

  return {
    timeline: timeline,
    appendEvents: appendEvents,
    finish: finish
  };
}

// Whole-game entry point, retained for replaying a completed game from its
// stored event log. Implemented as a loop over the incremental API so the two
// paths cannot drift (scripts/validate-pixel-choreographer.js asserts they
// produce identical timelines).
function buildTimeline(session) {
  const choreo = createChoreographer(session);
  groupPossessions(session.events).forEach(function (slice) { choreo.appendEvents(slice); });
  return choreo.finish();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PIXEL_STAGE: PIXEL_STAGE,
    buildTimeline: buildTimeline,
    createChoreographer: createChoreographer,
    groupPossessions: groupPossessions,
    assignSlots: assignSlots,
    DUNK_REACH: DUNK_REACH,
    // Exported for the animation lab, which is a local workbench and is not in
    // the repo (see .gitignore). NO COMMITTED CALLER, deliberately: the lab
    // reads these so it cannot hold its own copy of every beat length and drift
    // from the game the first time one of them is retuned. Anything else that
    // wants to assert a timing should read them from here too rather than
    // restating the numbers.
    BEAT: BEAT,
    layupFinish: layupFinish,
    approachFor: approachFor,
    nearestOpponentPx: nearestOpponentPx,
    CONTACT_RIM_PX: CONTACT_RIM_PX,
    ALLEY_MIN_PASS: ALLEY_MIN_PASS,
    ALLEY_RATE: ALLEY_RATE,
    approachBeats: approachBeats,
    approachStep: approachStep,
    APPROACH_RATE: APPROACH_RATE,
    ANKLE_BEATS: ANKLE_BEATS,
    IMPACT_THRESHOLDS: IMPACT_THRESHOLDS,
    roll01: roll01,
    dribbleCount: dribbleCount,
    DRIBBLE_TABLE: DRIBBLE_TABLE,
    posterEdge: posterEdge,
    handleEdge: handleEdge,
    classifyImpact: classifyImpact,
    ankleChance: ankleChance,
    ANKLE_CHECK: ANKLE_CHECK
  };
}
