// `overall` is DERIVED, never stored. It is a fitted summary of what this sim
// actually rewards — the coefficients below come from regressing the 20
// attributes against PLUS/MINUS PER MINUTE (scripts/fit-overall.js), which is
// the method ZenGM uses for its `ovr`
// (reference/zengm/analysis/player-ovr-basketball/process.py).
//
// It is deliberately NOT a hand-weighted average. A hand-weighted average is a
// guess about what the sim rewards; this is a measurement of it. The old
// stored overall was worse than a guess: players-2026.js generated every
// attribute AS `overall + archetypeOffset`, so overall could not disagree with
// the attributes — it explained itself, and correlated r=0.998 with their mean
// by construction.
//
// Plus/minus rather than a box-score metric because a box score cannot see
// defense, and a formula fitted on production undervalues interiorDefense and
// perimeterDefense.
//
// Deriving it also removes a whole bug class. When overall was stored,
// progression.js accumulated the change REQUESTED while each attribute stored
// the change CLAMPED, so the two drifted apart by up to 7.3 points over 12
// seasons — while simEngineBoxScore's minutesWeight read `overall` and every
// other weight read attributes. A drifted player drew star minutes with
// role-player skills. There is now nothing to drift.
var _RATINGS_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js') }
  : { data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS } };

// Fitted by scripts/fit-overall.js against 1800 games and 324 players (ridge 1, in-sample r 0.823).
// Re-run that script to regenerate after a deliberate sim change.
const OVERALL_COEFFICIENTS = {
  insideScoring: { coef: -0.08588, mean: 49.8 },
  midRange: { coef: 0.04721, mean: 50.2 },
  threePoint: { coef: 0.13786, mean: 51.9 },
  freeThrow: { coef: -0.03565, mean: 51.1 },
  passing: { coef: -0.01731, mean: 48.7 },
  ballHandling: { coef: 0.15393, mean: 48.6 },
  postScoring: { coef: 0.15631, mean: 41.4 },
  perimeterDefense: { coef: 0.05849, mean: 53.8 },
  interiorDefense: { coef: 0.10265, mean: 44.4 },
  steal: { coef: 0.10273, mean: 53.6 },
  block: { coef: 0.03275, mean: 44.7 },
  offReb: { coef: 0.12080, mean: 45.1 },
  defReb: { coef: 0.09662, mean: 52.6 },
  speed: { coef: 0.03145, mean: 54.0 },
  acceleration: { coef: 0.10946, mean: 54.2 },
  strength: { coef: 0.00721, mean: 53.9 },
  vertical: { coef: -0.01020, mean: 55.2 },
  basketballIQ: { coef: 0.09948, mean: 55.5 },
  leadership: { coef: 0.03177, mean: 53.8 },
  workEthic: { coef: -0.03708, mean: 54.6 },
};
const OVERALL_INTERCEPT = 50.0000;

// THE DISPLAY CURVE. The fit above targets mean 50 / SD 9, which puts a 90 at
// +4.4 standard deviations — unreachable in a 380-player league, where the
// measured maximum is 78. This maps the fitted value onto the scale players
// actually read: worst player 60, median 73, best player 95.
//
// The knots are ABSOLUTE, never league-relative. A percentile mapping would
// re-rate every player the moment a draft class arrived, and "I signed a 90"
// would stop meaning anything from one season to the next.
//
// The slope above the top knot is deliberately flatter, reserving 96-100 for a
// player genuinely better than anyone alive today. The cost is real and
// accepted: only 5 display points remain above the current best player, so
// progression at the very top compresses. This is how 2K behaves — the best
// player is a 96-97 and nobody is a 99.
const DISPLAY_KNOT = { rawLo: 29, dispLo: 60, rawHi: 78, dispHi: 95 };
const DISPLAY_SLOPE_LO = (DISPLAY_KNOT.dispHi - DISPLAY_KNOT.dispLo) / (DISPLAY_KNOT.rawHi - DISPLAY_KNOT.rawLo);
const DISPLAY_SLOPE_HI = (100 - DISPLAY_KNOT.dispHi) / (100 - DISPLAY_KNOT.rawHi);

function toDisplayRating(raw) {
  const v = raw <= DISPLAY_KNOT.rawHi
    ? DISPLAY_KNOT.dispLo + (raw - DISPLAY_KNOT.rawLo) * DISPLAY_SLOPE_LO
    : DISPLAY_KNOT.dispHi + (raw - DISPLAY_KNOT.rawHi) * DISPLAY_SLOPE_HI;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Deliberately NOT rounded. scaleAttributesToOverall solves against this, and
// rounding here would make the solver chase a target it can never land on.
function toRawRating(display) {
  const v = display <= DISPLAY_KNOT.dispHi
    ? DISPLAY_KNOT.rawLo + (display - DISPLAY_KNOT.dispLo) / DISPLAY_SLOPE_LO
    : DISPLAY_KNOT.rawHi + (display - DISPLAY_KNOT.dispHi) / DISPLAY_SLOPE_HI;
  return Math.max(0, Math.min(100, v));
}

// Every gate that reads a rating lives here, named by INTENT rather than by
// number. Five gates were scattered as magic numbers across five files, all
// written for the old authored 62-98 scale, and all rotted silently when
// `overall` became a regression — three ended up catching nobody at all, and
// the retirement penalty inverted to catch 94% of the league.
//
// One table means the next rescale is one edit. It is also what makes the
// mutation test in validate-ratingBands.js meaningful: reverting a single call
// site to a literal must fail, which is the only way to prove a site reads the
// table rather than carrying its own private copy.
const RATING_BANDS = {
  superstar: 90,           // the genuine elite — gates the 8 superstar traits
  superstarPotential: 92,  // ...or the potential to become one
  star: 85,                // stars: trade premium, worth pausing the sim for
  rotation: 78,            // good enough that a bench role is worth complaining about
  fringe: 68               // fringe: likelier to retire
};

function computeOverall(player) {
  const attrs = player && player.attributes;
  if (!attrs) return 0;
  let v = OVERALL_INTERCEPT;
  _RATINGS_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    const c = OVERALL_COEFFICIENTS[key];
    if (c) v += c.coef * ((attrs[key] || 0) - c.mean);
  });
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Installs `overall` as a non-enumerable getter, so the ~27 files that read
// player.overall keep working unchanged while nothing can assign to it.
// Non-enumerable is load-bearing: JSON.stringify must NOT serialise it into a
// save, or a loaded league would carry a frozen value that never updates again
// — which is the stored-overall bug rebuilt through the back door.
function defineOverall(player) {
  const existing = Object.getOwnPropertyDescriptor(player, 'overall');
  if (existing && existing.get) return player;
  delete player.overall;
  Object.defineProperty(player, 'overall', {
    get: function () { return computeOverall(this); },
    // A getter with no setter makes `p.overall = x` a SILENT no-op in sloppy
    // mode, which is a worse bug than the one being fixed — six call sites
    // across the codebase were assigning to it. Throwing turns every one of
    // them into a stack trace instead of a value that quietly never changes.
    set: function () {
      throw new Error(
        'overall is derived from the attributes (ratings.js) and cannot be assigned. ' +
        'Change the attributes instead — see scaleAttributesToOverall.');
    },
    enumerable: false,
    configurable: true
  });
  return player;
}

// The inverse operation, for the places that legitimately want to say "make
// this player a 90": commissioner edits, god mode, and the random-event status
// effects that used to write straight to `overall`. Shifts every attribute by
// a constant and solves for the shift, which is exact because computeOverall
// is linear in the attributes — a uniform +d moves overall by d * sum(coef).
// Clamping at the scale bounds can leave it short of an extreme target, so it
// iterates a few times and settles for the closest reachable value.
function scaleAttributesToOverall(player, target) {
  const keys = _RATINGS_DATA.data.ATTRIBUTE_KEYS;
  let totalCoef = 0;
  keys.forEach(function (k) {
    if (OVERALL_COEFFICIENTS[k]) totalCoef += OVERALL_COEFFICIENTS[k].coef;
  });
  if (!totalCoef) return player;
  // Iterates rather than solving once, because clamping at the scale bounds
  // shrinks the effective slope: as attributes pin at 100 a further uniform
  // shift moves only the ones still free, so one pass undershoots an extreme
  // target. Runs until it stops making progress — six passes was not enough to
  // drive a mid-league player to 100.
  for (let pass = 0; pass < 40; pass++) {
    const gap = target - computeOverall(player);
    if (gap === 0) break;
    const shift = gap / totalCoef;
    let moved = false;
    keys.forEach(function (k) {
      const next = Math.max(0, Math.min(100, Math.round(player.attributes[k] + shift)));
      if (next !== player.attributes[k]) { player.attributes[k] = next; moved = true; }
    });
    if (!moved) break;   // every attribute is pinned; this target is unreachable
  }
  return player;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OVERALL_COEFFICIENTS: OVERALL_COEFFICIENTS,
    OVERALL_INTERCEPT: OVERALL_INTERCEPT,
    DISPLAY_KNOT: DISPLAY_KNOT,
    RATING_BANDS: RATING_BANDS,
    toDisplayRating: toDisplayRating,
    toRawRating: toRawRating,
    computeOverall: computeOverall,
    defineOverall: defineOverall,
    scaleAttributesToOverall: scaleAttributesToOverall
  };
}
