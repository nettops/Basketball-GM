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

// Fitted by scripts/fit-overall.js against 3000 games and 345 players (ridge 1, in-sample r 0.705).
// Re-run that script to regenerate after a deliberate sim change.
// Refitted for the 2K27 import: the authored roster's attribute sheets are
// now real 2K sheets (quantile-mapped), which are less one-dimensional than
// the archetype-generated ones the 0.789 fit learned on — richer sheets,
// honestly lower r. 1200 games was noise-limited (r 0.552); 3000 stabilised
// both the r and the coefficient pattern (defense non-zero again).
const OVERALL_COEFFICIENTS = {
  insideScoring: { coef: 0.06206, mean: 50.3 },
  midRange: { coef: 0.05852, mean: 49.4 },
  threePoint: { coef: 0.02075, mean: 51.1 },
  freeThrow: { coef: 0.09092, mean: 49.1 },
  passing: { coef: 0.05967, mean: 48.6 },
  ballHandling: { coef: 0.23145, mean: 48.3 },
  postScoring: { coef: 0.09905, mean: 42.3 },
  perimeterDefense: { coef: 0.00000, mean: 54.1 },
  interiorDefense: { coef: 0.11135, mean: 45.4 },
  steal: { coef: 0.32691, mean: 54.3 },
  block: { coef: 0.21508, mean: 45.1 },
  offReb: { coef: 0.00000, mean: 44.3 },
  defReb: { coef: 0.00000, mean: 52.1 },
  speed: { coef: 0.00000, mean: 52.9 },
  acceleration: { coef: 0.00000, mean: 54.2 },
  strength: { coef: 0.00000, mean: 53.3 },
  vertical: { coef: 0.00000, mean: 54.3 },
  basketballIQ: { coef: 0.18216, mean: 56.6 },
  leadership: { coef: 0.00000, mean: 51.9 },
  workEthic: { coef: 0.02466, mean: 53.7 },
};
const OVERALL_INTERCEPT = 50.0000;

// THE DISPLAY CURVE. The fit above targets mean 50 / SD 9, which puts a 90 at
// +4.4 standard deviations — unreachable in a 380-player league, where the
// measured maximum is 85. This maps the fitted value onto the scale players
// actually read: worst player 60, median 74, best player 95.
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
// Re-derived twice now: the NNLS refit moved the raw distribution from 29-78 to
// 23-79, and signature attributes for 42 stars moved the top to 85. The knots
// are anchored on the league's actual raw extremes, so they have to be
// re-measured whenever the attributes or the fit change — leaving them stale
// silently compresses or clips the ends of the display scale, and
// checkTheKnotsAreCalibratedToTheLeague fails loudly when they are.
// Re-measured for the 2K27 import + 3000-game refit. The knots anchor on
// the POSITIONAL raw extremes (computePositionalOverall — the value the
// display getter actually feeds through this curve), which run 23-91 over
// the imported 435. First cut anchored on the position-blind extremes
// (20-83) and put the best player at 97 instead of on the top knot.
const DISPLAY_KNOT = { rawLo: 23, dispLo: 60, rawHi: 91, dispHi: 95 };
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
  // Re-anchored for the 2K27 import (the third re-derivation — every one of
  // these is a measurement against the CURRENT league, not a taste):
  // 2K rates more players 90+ than the old authored roster did (14 vs 9), so
  // the elite gate moved up to hold the holder share inside 1-4%.
  superstar: 94,           // the genuine elite — gates the 8 superstar traits
  // ...or the potential to become one. Measured over the imported league:
  // (94, 94) is the pair where holder share is 3.2% AND the arm still
  // reaches genuine upside the overall gate misses — 11 players, the lowest
  // a 19-year-old at 84, a full 10 points below the gate. The import
  // age-discounts 2K's pedigree-flavored potential grades (LeBron carries an
  // A+ at 41) or this arm fills with veterans; see GRADE_HEADROOM in
  // scripts/import-2k-rosters.js.
  superstarPotential: 94,
  star: 86,                // stars: trade premium, worth pausing the sim for (3.7% of the league)
  rotation: 79,            // good enough that a bench role is worth complaining about
  fringe: 71               // fringe: likelier to retire (re-measured: 28.7% of the league)
};

// POSITION WEIGHTING, in the 2K sense: a point guard is not judged on boxing
// out, and a centre is not judged on his handle.
//
// THIS IS A DESIGN DECISION, NOT A MEASUREMENT, and the distinction matters.
// The obvious way to derive it — fit the regression separately per position —
// was tried (scripts/probe-position-fit.js) and cannot answer the question.
// Split into groups of 69-144 against 20 predictors, the within-group
// collinearity is WORSE than league-wide (block/interiorDefense correlate 0.905
// inside the bigs against 0.807 inside the guards), so NNLS hands the shared
// signal to one attribute and clamps its partners to zero. That fit reports
// rebounding as worth exactly 0% to a centre, which is not a finding, it is the
// same non-identification that forced NNLS in the first place.
//
// So these are chosen, not measured. Discounts rather than zeroes: a guard who
// genuinely rebounds still gets some credit for it, because Westbrook exists.
//
// Steal and perimeterDefense are deliberately NOT discounted for guards. They
// are guard defence, and flattening them would make a lockdown point guard
// indistinguishable from a turnstile — which is a worse lie than the one being
// fixed.
const POSITION_WEIGHTS = {
  PG: { defReb: 0.15, offReb: 0.15, block: 0.15, interiorDefense: 0.20 },
  SG: { defReb: 0.15, offReb: 0.15, block: 0.15, interiorDefense: 0.20 },
  SF: {},
  PF: { ballHandling: 0.20, threePoint: 0.35 },
  C:  { ballHandling: 0.20, threePoint: 0.35 }
};

// Each position's weights are RENORMALISED back to the global coefficient sum.
// Without this, discounting four attributes would simply make every guard worse
// than every big, which is not position weighting, it is a penalty. Normalised,
// the weight taken off a guard's rebounding is redistributed onto the things a
// guard IS judged on, and the positions stay comparable to each other.
//
// It also keeps sum(coef) identical for every position, which is what
// scaleAttributesToOverall solves against — so "make this player a 90" behaves
// the same regardless of where he plays.
const POSITION_COEFFICIENTS = (function () {
  const keys = _RATINGS_DATA.data.ATTRIBUTE_KEYS;
  let globalTotal = 0;
  keys.forEach(function (k) {
    if (OVERALL_COEFFICIENTS[k]) globalTotal += OVERALL_COEFFICIENTS[k].coef;
  });
  const out = {};
  Object.keys(POSITION_WEIGHTS).forEach(function (pos) {
    const w = POSITION_WEIGHTS[pos];
    const scaled = {};
    let total = 0;
    keys.forEach(function (k) {
      const base = OVERALL_COEFFICIENTS[k] ? OVERALL_COEFFICIENTS[k].coef : 0;
      scaled[k] = base * (w[k] === undefined ? 1 : w[k]);
      total += scaled[k];
    });
    const norm = total > 0 ? globalTotal / total : 1;
    keys.forEach(function (k) { scaled[k] *= norm; });
    out[pos] = scaled;
  });
  return out;
})();

// Precomputed at load rather than per call: computeOverall runs behind a getter
// that the UI and the sim hit constantly, and rebuilding a 20-key table on every
// read is the kind of thing that only shows up as a mysterious frame drop.
function coefficientsFor(position) {
  return POSITION_COEFFICIENTS[position] || null;
}

// The GLOBAL fit — unweighted, position-blind. This is what the SIM consumes
// through rawOverall: minutesWeight is asking "how much does this player help",
// and that question has nothing to do with positional fairness. Leaving it
// alone is what lets position weighting cost the sim exactly nothing.
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

// The POSITION-WEIGHTED fit, which feeds the number the player reads.
//
// Applying position weights to the value the sim consumes was the first
// attempt, and it pushed shot-volume spread to 3.55x against a 3.4 ceiling —
// because rawOverall drives minutesWeight, so reweighting it reallocated who
// takes shots. Turning the effect down until the bound passed left it at 25%
// strength, which is barely a feature.
//
// Splitting it instead gives the full effect for free: the sim keeps the
// position-blind answer, the user reads the positional one, and the golden
// masters do not move at all.
//
// Players with no position — hand-built test fixtures — fall back to the global
// fit rather than throwing.
function computePositionalOverall(player) {
  const attrs = player && player.attributes;
  if (!attrs) return 0;
  const posCoef = coefficientsFor(player.position);
  if (!posCoef) return computeOverall(player);
  let v = OVERALL_INTERCEPT;
  _RATINGS_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    const c = OVERALL_COEFFICIENTS[key];
    if (c) v += posCoef[key] * ((attrs[key] || 0) - c.mean);
  });
  return Math.max(0, Math.min(100, Math.round(v)));
}

// TWO GETTERS, TWO MEANINGS.
//
//   rawOverall  - the fitted value, ~23-85. What the SIM consumes, as a
//                 proportional weight.
//   overall     - the display value, 60-95. What the PLAYER reads.
//
// One field cannot do both. `overall` used to, and rescaling it for the reader
// would have flattened star usage by 40%: minutesWeight divides by it, raw
// spans 3.4x and display spans 1.58x, so stars would have taken proportionally
// FEWER shots. simEngineBoxScore.js:89-103 records this exact failure happening
// once already, when a hard `overall - 40` offset collapsed 158 players onto an
// identical rotation weight.
//
// Non-enumerable is load-bearing on all three: JSON.stringify must NOT
// serialise them into a save, or a loaded league carries a frozen value that
// never updates again — the stored-overall bug rebuilt through the back door.
//
// THE IDEMPOTENCE GUARD TESTS `rawOverall`, NOT `overall`. A player carrying the
// older single-getter shape — anything deserialised from a save written before
// this change — still has an `overall` getter, so guarding on that name would
// return early and it would never gain the other two.
function defineOverall(player) {
  const existing = Object.getOwnPropertyDescriptor(player, 'rawOverall');
  if (existing && existing.get) return player;
  delete player.overall;
  delete player.rawOverall;
  delete player.potentialDisplay;
  function derived(name, get) {
    Object.defineProperty(player, name, {
      get: get,
      // A getter with no setter makes `p.overall = x` a SILENT no-op in sloppy
      // mode, which is a worse bug than the one being fixed — six call sites
      // across the codebase were assigning to it. Throwing turns every one of
      // them into a stack trace instead of a value that quietly never changes.
      set: function () {
        throw new Error(
          name + ' is derived from the attributes (ratings.js) and cannot be assigned. ' +
          'Change the attributes instead — see scaleAttributesToOverall.');
      },
      enumerable: false,
      configurable: true
    });
  }
  // rawOverall is POSITION-BLIND and feeds the sim; overall is POSITION-WEIGHTED
  // and feeds the reader. A guard's rebounding still counts toward how much he
  // actually helps the team — it just stops counting toward whether he is good
  // at being a guard.
  derived('rawOverall', function () { return computeOverall(this); });
  derived('overall', function () { return toDisplayRating(computePositionalOverall(this)); });
  // `potential` stays STORED and RAW, because progression pulls players by
  // `potential - rawOverall` and every existing save already holds the raw
  // value. That asymmetry is a trap — raw potential rendered beside display
  // overall reads as potential BELOW overall for every player in the league —
  // so the UI must read this instead, and a validator enforces it.
  derived('potentialDisplay', function () { return toDisplayRating(this.potential); });
  return player;
}

// The inverse operation, for the places that legitimately want to say "make
// this player a 90": commissioner edits, god mode, and the random-event status
// effects that used to write straight to `overall`. Shifts every attribute by
// a constant and solves for the shift, which is exact because computeOverall
// is linear in the attributes — a uniform +d moves overall by d * sum(coef).
// Clamping at the scale bounds can leave it short of an extreme target, so it
// iterates a few times and settles for the closest reachable value.
//
// TARGET IS A DISPLAY VALUE. Every caller means "make this player a 90" on the
// scale the user is looking at. Convergence is therefore checked in display
// space, where targets are integers and a hit is exact; the SHIFT is computed
// in raw space, where the model is linear and the arithmetic works.
function scaleAttributesToOverall(player, target) {
  const keys = _RATINGS_DATA.data.ATTRIBUTE_KEYS;
  let totalCoef = 0;
  keys.forEach(function (k) {
    if (OVERALL_COEFFICIENTS[k]) totalCoef += OVERALL_COEFFICIENTS[k].coef;
  });
  if (!totalCoef) return player;
  const rawTarget = toRawRating(target);
  // Solved against the POSITION-WEIGHTED value, because that is what `overall`
  // is. Converging on the global fit instead overshot every target by exactly
  // one: the solver was landing on a different quantity from the one the caller
  // reads. Renormalisation means totalCoef is identical for every position, so
  // the shift arithmetic above needs no per-position variant.
  const positional = function () { return computePositionalOverall(player); };
  // Iterates rather than solving once, because clamping at the scale bounds
  // shrinks the effective slope: as attributes pin at 100 a further uniform
  // shift moves only the ones still free, so one pass undershoots an extreme
  // target. Runs until it stops making progress — six passes was not enough to
  // drive a mid-league player to 100.
  for (let pass = 0; pass < 40; pass++) {
    if (toDisplayRating(positional()) === target) break;
    const shift = (rawTarget - positional()) / totalCoef;
    let moved = false;
    keys.forEach(function (k) {
      const next = Math.max(0, Math.min(100, Math.round(player.attributes[k] + shift)));
      if (next !== player.attributes[k]) { player.attributes[k] = next; moved = true; }
    });
    if (!moved) break;   // every attribute is pinned; this target is unreachable
  }
  // REFINEMENT. The uniform shift above moves overall in steps of sum(coef),
  // and since the NNLS refit seven coefficients are exactly zero — shifting
  // those attributes does nothing at all. The reachable set became coarse
  // enough to step straight over a display value: asking for 65 landed on 66.
  //
  // This walks one attribute at a time to close the last point. It works down
  // from the highest-leverage attribute so it converges quickly, and skips to
  // the next when one pins at a bound, so an extreme target still lands.
  // Ranked by the coefficient for THIS position, so the lever chosen is the
  // one with the most leverage on the number actually being solved for.
  const posCoef = coefficientsFor(player.position);
  const weightOf = function (k) {
    return posCoef ? posCoef[k] : (OVERALL_COEFFICIENTS[k] ? OVERALL_COEFFICIENTS[k].coef : 0);
  };
  const levers = keys.filter(function (k) { return weightOf(k) > 0; })
    .sort(function (a, b) { return weightOf(b) - weightOf(a); });
  for (let step = 0; step < 400; step++) {
    const current = toDisplayRating(positional());
    if (current === target) break;
    const dir = current < target ? 1 : -1;
    let moved = false;
    for (let i = 0; i < levers.length; i++) {
      const k = levers[i];
      const next = Math.max(0, Math.min(100, player.attributes[k] + dir));
      if (next !== player.attributes[k]) { player.attributes[k] = next; moved = true; break; }
    }
    if (!moved) break;   // every lever is pinned; this target is unreachable
  }
  return player;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OVERALL_COEFFICIENTS: OVERALL_COEFFICIENTS,
    OVERALL_INTERCEPT: OVERALL_INTERCEPT,
    DISPLAY_KNOT: DISPLAY_KNOT,
    RATING_BANDS: RATING_BANDS,
    POSITION_WEIGHTS: POSITION_WEIGHTS,
    POSITION_COEFFICIENTS: POSITION_COEFFICIENTS,
    toDisplayRating: toDisplayRating,
    toRawRating: toRawRating,
    computeOverall: computeOverall,
    computePositionalOverall: computePositionalOverall,
    defineOverall: defineOverall,
    scaleAttributesToOverall: scaleAttributesToOverall
  };
}
