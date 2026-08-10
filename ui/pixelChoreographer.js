// Turns a possession-engine event log (see simEnginePossession.js's pushEvent
// and the spec's Event Log Format) into a keyframe timeline the pixel game
// view interpolates between. Pure data-in data-out — no canvas, no GameState —
// so scripts/validate-pixel-choreographer.js can exercise it in Node.

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
const BEAT = {
  // Trimmed from 700/650/600. These three are the possession's dead air — the
  // walk up the floor, the flow into the set, the reset after a board — and
  // they were 34% of the game's running time. Now that isolations, live
  // dribbling and screens fill the possession with something to watch, that
  // time is better spent there than on players strolling into position.
  transition: 580, formation: 540, fastBreak: 420, pass: 340, windup: 300, drive: 500,
  release: 60, flight3: 850, flightMid: 650, flightIn: 420,
  // Dunk beats. The rise is short and the hang is shorter — a leap that takes
  // as long as a jump shot's flight reads as floating, not exploding.
  dunkGather: 170, dunkRise: 150, dunkSlam: 90, dunkLand: 130,
  // Crossover beats. The jab has to last long enough for the defender to
  // visibly commit to it, or the cut back reads as a sidestep rather than a
  // player being sent the wrong way.
  crossJab: 200, crossCut: 140, crossClear: 190,
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
  // Fast break. Short beats covering a lot of floor — that ratio IS the break;
  // the same distance over the half-court beats would read as a jog.
  fbOutlet: 300, fbLanes: 400, fbAttack: 340,
  resolve: 500, bounce: 350, ft: 700
};

function flightBeat(zone) {
  return zone === 'three' ? BEAT.flight3 : (zone === 'mid' ? BEAT.flightMid : BEAT.flightIn);
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
  { share: 0.50, counts: [0] },
  { share: 0.25, counts: [2] },
  { share: 0.15, counts: [4, 5, 6] },
  { share: 0.10, counts: [7, 8] }
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
const IMPACT_THRESHOLDS = { poster: 47, ankle: 26 };

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
function classifyImpact(ev, shooter, defender) {
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
    return handleEdge(shooter, defender) >= IMPACT_THRESHOLDS.ankle ? 'ankle' : null;
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

  // `sfx` names the sound this beat should trigger (see ui/pixelAudio.js's
  // synth). Naming it here rather than sniffing the display text keeps the
  // audio honest: a miss and a make are different events even though both
  // end with the ball at the rim.
  function push(dt, pos, ball, period, quarter, clock, text, commentary, sfx, impact, dunk, cross, jump) {
    t += dt;
    // Every keyframe goes through the collision pass so sprites never stack;
    // the current ball holder is the protected (immovable) body.
    const resolved = separatePositions(pos, ball.holder);
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
      // index into timeline.snapshots (running leaders / foul trouble) and
      // which possession this beat belongs to, used to derive a shot clock
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
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

    const plays = events.slice(1);
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
      const from = deep ? transPos[deep] : transHandler;

      push(BEAT.release, transPos, { x: from[0], y: from[1] - 6, holder: null },
        period, quarter, clock, '');
      push(BEAT.fbOutlet, flowPositions(transPos, [h, deep], pi * 31, defendersOf(poss.team, transPos)),
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
        const isoPlay = shooterOn && ev.defenderId && shotPos[ev.defenderId] &&
          ev.zone !== 'inside' && (pi * 7 + ei) % 5 === 0;

        const chain = [poss.handlerId];
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
        for (let c = 0; c < chain.length - 1; c++) {
          const from = shotPos[chain[c]] || pos[chain[c]] || handlerPos;
          const to = shotPos[chain[c + 1]];
          if (!to) continue;
          // the last pass of the chain is the feed to the shooter
          const isFeed = (c === chain.length - 2) && !!ev.assistPlayerId;
          const shape = passShape(from, to, isFeed);
          push(BEAT.release, shotPos, { x: from[0], y: from[1] - 8, holder: null }, period, quarter, clock, '');
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
        // The isolation itself: clear the side, then let him work. Two size-up
        // dribbles that actually MOVE him — a stationary "dribble" draws no
        // bounce and no leg cycle, so probing has to be real displacement.
        if (isoPlay) {
          const me = ev.playerId, him = ev.defenderId;
          const toRimX = hoop.x - sp[0], toRimY = hoop.y - sp[1];
          const rl = Math.sqrt(toRimX * toRimX + toRimY * toRimY) || 1;
          const lx = -toRimY / rl, ly = toRimX / rl;   // lateral, across his man
          const dir = ((pi + ei) % 2) ? 1 : -1;

          // everyone else vacates toward the weak side so the lane is his
          const clear = Object.assign({}, shotPos);
          five[poss.team].forEach(function (p) {
            if (p.id === me || !clear[p.id]) return;
            clear[p.id] = clampToCourt(clear[p.id][0] - lx * dir * 20, clear[p.id][1] - ly * dir * 20);
          });
          push(BEAT.isoClear, clear, { x: sp[0], y: sp[1], holder: me },
            period, quarter, clock, '',
            (pi % 3 === 0) ? fillT(COMMENT.bringUp, pi + ei, { h: ln(me), team: teamNames[poss.team] }) : '');

          // ballLat offsets the BALL laterally from the handler. It is what makes
          // a behind-the-back look different from a crossover at this size: in a
          // crossover the body and the ball go the same way, so only the body
          // reads; behind the back, the ball swings wide of a handler whose
          // shoulders stay square. Without a separate ball path the two moves
          // are the same three rectangles moving sideways.
          function probe(offLat, offRim, seed, ballLat) {
            const spot = clampToCourt(sp[0] + lx * dir * offLat + (toRimX / rl) * offRim,
              sp[1] + ly * dir * offLat + (toRimY / rl) * offRim);
            const p = Object.assign({}, clear);
            p[me] = spot;
            // his man mirrors, a beat late and a step short
            if (p[him]) p[him] = clampToCourt(p[him][0] + lx * dir * offLat * 0.6,
              p[him][1] + ly * dir * offLat * 0.6);
            // the four men who cleared out do not stand and watch him work
            const flowed = flowPositions(p, [me, him], pi * 37 + seed, defenderIds);
            const bl = ballLat || 0;
            const ball = bl
              ? clampToCourt(spot[0] + lx * dir * bl, spot[1] + ly * dir * bl)
              : spot;
            push(BEAT.isoSize, flowed, { x: ball[0], y: ball[1], holder: me }, period, quarter, clock, '');
            return flowed;
          }

          // WHICH move he reaches for. Keyed to ball-handling so a guard visibly
          // has more in the bag than a big — the whole point of adding a
          // vocabulary rather than making everyone do the same shimmy. The
          // possession index breaks ties so the same player does not repeat one
          // move all night.
          const handleSkill = (playerById[me] && playerById[me].attributes)
            ? playerById[me].attributes.ballHandling : 50;
          const moveRoll = (pi + ei) % 3;
          const moveKind = (handleSkill >= 80 && moveRoll === 0) ? 'double'
            : (handleSkill >= 65 && moveRoll === 1) ? 'behind'
            : 'cross';

          let back;
          if (moveKind === 'double') {
            // Jab, cross back, cross AGAIN. Six beats where a crossover is four,
            // so it is gated to elite handlers — on everyone else it would just
            // read as dithering.
            probe(11, 6, 1);
            probe(-9, 2, 2);
            back = probe(7, 4, 3);
          } else if (moveKind === 'behind') {
            // Body barely moves; the BALL takes the long way round behind him.
            probe(6, 5, 1, -12);
            back = probe(-7, 2, 2, 11);
          } else {
            probe(11, 6, 1);
            back = probe(-9, 2, 2);
          }
          // and back to the spot the sim says he shot from
          const attack = Object.assign({}, back);
          attack[me] = sp;
          push(BEAT.isoAttack, attack, { x: sp[0], y: sp[1], holder: me }, period, quarter, clock, '');
          shotPos[me] = sp;
          if (back[him]) shotPos[him] = back[him];
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

        // Classification is hoisted above the windup because an ankle breaker
        // has to be choreographed BEFORE the shot goes up — the move is what
        // creates the shot, not a decoration on top of it.
        const shooterPlayer = playerById[ev.playerId];
        const dunking = ev.zone === 'inside' && isDunker(shooterPlayer);
        const impactKind = ev.made
          ? classifyImpact(ev, shooterPlayer, playerById[ev.defenderId])
          : null;

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

          function step(hOff, dOff) {
            const p = Object.assign({}, shotPos);
            p[handler] = clampToCourt(sp[0] + lx * dir * hOff, sp[1] + ly * dir * hOff);
            p[victim] = clampToCourt(dstart[0] + lx * dir * dOff, dstart[1] + ly * dir * dOff);
            return p;
          }
          // jab one way — the defender bites HARDER than the jab, which is the
          // whole trick: he has to be further across than the man he guards
          const jab = step(7, 13);
          push(BEAT.crossJab, jab, { x: jab[handler][0], y: jab[handler][1], holder: handler },
            period, quarter, clock, '', '', '', null, null, { phase: 'jab', by: handler, on: victim });
          // cut back hard; he keeps going the wrong way
          const cut = step(-8, 17);
          push(BEAT.crossCut, cut, { x: cut[handler][0], y: cut[handler][1], holder: handler },
            period, quarter, clock, '', '', 'squeak', null, null, { phase: 'cross', by: handler, on: victim });
          // and rise into the shot with the separation already open
          const clear = step(0, 19);
          push(BEAT.crossClear, clear, { x: sp[0], y: sp[1], holder: handler },
            period, quarter, clock, '', '', '', null, null, { phase: 'clear', by: handler, on: victim });
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
          const rimSpot = clampToCourt(hoop.x + (poss.team === 'home' ? -8 : 8), hoop.y + cutJitter(pi + ei, 6));
          releasePos = Object.assign({}, shotPos);
          releasePos[ev.playerId] = rimSpot;
          relSpot = rimSpot;
          // the driver and his man hold; the weak side rotates
          push(BEAT.drive, flowPositions(releasePos, [ev.playerId, ev.defenderId], pi * 13 + ei, defenderIds),
            { x: rimSpot[0], y: rimSpot[1], holder: ev.playerId }, period, quarter, clock, '');
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
          const apexPos = Object.assign({}, releasePos);
          apexPos[ev.playerId] = clampToCourt(rimX, hoop.y);
          const landPos = Object.assign({}, crashPos);
          landPos[ev.playerId] = apexPos[ev.playerId];  // he stays at the rim, not crashing the glass
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
          const dunkBy = ev.playerId;
          // `zoomTo` rides the GATHER beat, not the rise. Keyframes sit at beat
          // ENDS, so the rise keyframe is the apex — arming there put the camera
          // in only after he was already up. On the gather it covers the whole
          // ascent, which is the part worth magnifying.
          // The weak side keeps moving through the dunk. Without this the
          // whole floor froze for the four beats of every finish at the rim,
          // which got worse the moment transition started producing more of
          // them — frozen player-beats went 12% to 24% on that change alone.
          const dunkLock = [ev.playerId, ev.defenderId];
          push(BEAT.dunkGather, flowPositions(releasePos, dunkLock, pi * 19 + ei, defenderIds),
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', '', null,
            { phase: 'gather', id: dunkBy, zoomTo: impactKind === 'poster' ? impactAt : null });
          push(BEAT.dunkRise, flowPositions(apexPos, dunkLock, pi * 23 + ei, defenderIds),
            { x: rimX, y: hoop.y, holder: ev.playerId },
            period, quarter, clock, '', '', '', null, { phase: 'rise', id: dunkBy });
          push(BEAT.dunkSlam, landPos, { x: hoop.x, y: hoop.y, holder: null },
            period, quarter, clock, madeLabel, shotComment, 'dunk', impactMarker, { phase: 'slam', id: dunkBy });
          push(BEAT.dunkLand, landPos, { x: hoop.x, y: hoop.y + 7, holder: null },
            period, quarter, clock, '', '', '', null, { phase: 'land', id: dunkBy });
          curPos = landPos;
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
          push(three ? BEAT.jumpGatherThree : BEAT.jumpGatherMid, releasePos,
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'gather', id: jumpBy, three: three });
          push(three ? BEAT.jumpRiseThree : BEAT.jumpRiseMid, releasePos,
            { x: relSpot[0], y: relSpot[1], holder: ev.playerId },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'rise', id: jumpBy, three: three });
          // the ball leaves at the apex, not from a standing sprite
          push(BEAT.jumpRelease, releasePos, { x: relSpot[0], y: relSpot[1] - 20, holder: null },
            period, quarter, clock, '', '', '', null, null, null, { phase: 'release', id: jumpBy, three: three });
          // ...and he holds the follow-through while it is in the air
          push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
            ev.made ? madeLabel : '', shotComment,
            ev.made ? 'swish' : 'clang', impactMarker, null, null,
            { phase: 'follow', id: jumpBy, three: three });
          curPos = crashPos;
        } else {
          // release: ball leaves the hands...
          push(BEAT.release, releasePos, { x: relSpot[0], y: relSpot[1] - 12, holder: null }, period, quarter, clock, '');
          // ...and flies to the rim while everyone crashes the glass — the
          // floor keeps moving for the whole flight instead of freezing
          push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
            ev.made ? madeLabel : '', shotComment,
            ev.made ? (dunking ? 'dunk' : 'swish') : 'clang',
            impactMarker);
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
        curPos = rpos;
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
    IMPACT_THRESHOLDS: IMPACT_THRESHOLDS,
    roll01: roll01,
    dribbleCount: dribbleCount,
    DRIBBLE_TABLE: DRIBBLE_TABLE,
    posterEdge: posterEdge,
    handleEdge: handleEdge,
    classifyImpact: classifyImpact
  };
}
