var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js'), teams: require('./teams.js'), coaches: require('./coaches.js'), ratings: require('./ratings.js'),
      affine: require('./players-2026.js').GENERATION_AFFINE }
  : {
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX },
      traits: { getTraitBonus: getTraitBonus, rollSecretBadgeEvolution: rollSecretBadgeEvolution },
      teams: { getTeamById: getTeamById },
      coaches: { coachFitMultiplier: coachFitMultiplier },
      ratings: { computeOverall: computeOverall, defineOverall: defineOverall },
      // players-2026.js loads before this file in index.html, so the const is
      // already a page global here.
      affine: GENERATION_AFFINE
    };

function clampRating(v) {
  return Math.max(_PROGRESSION_DATA.data.RATING_MIN, Math.min(_PROGRESSION_DATA.data.RATING_MAX, Math.round(v)));
}

function bound(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }

function gaussianRandom(rng) {
  var u1 = rng(), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

function shootingAgeModifier(age) {
  if (age <= 27) return 0;
  if (age <= 29) return 0.5;
  if (age <= 31) return 1.5;
  return 2;
}

function athleticAgeModifier(age) {
  if (age <= 27) return 0;
  if (age <= 30) return -2;
  if (age <= 35) return -3;
  if (age <= 40) return -4;
  return -8;
}

function iqAgeModifier(age) {
  if (age <= 21) return 4;
  if (age <= 23) return 3;
  if (age <= 27) return 0;
  if (age <= 29) return 0.5;
  if (age <= 31) return 1.5;
  return 2;
}

function strengthAgeModifier(age) {
  if (age <= 23) return 2;
  if (age <= 28) return 0;
  if (age <= 33) return -1;
  return -2;
}

function skillAgeModifier(age) {
  return shootingAgeModifier(age);
}

function defenseAgeModifier(age) {
  if (age <= 21) return 2;
  if (age <= 23) return 1;
  if (age <= 28) return 0;
  if (age <= 31) return -1;
  if (age <= 35) return -2;
  return -3;
}

function athleticDefenseAgeModifier(age) {
  if (age <= 26) return 0;
  if (age <= 30) return -2;
  if (age <= 35) return -3;
  return -5;
}

function mentalAgeModifier(age) {
  if (age <= 25) return 1;
  if (age <= 30) return 0;
  return -0.5;
}

var RATING_PROFILES = {
  insideScoring:    { ageModifier: shootingAgeModifier,         changeLimits: [-5, 23] },
  midRange:         { ageModifier: shootingAgeModifier,         changeLimits: [-5, 23] },
  threePoint:       { ageModifier: shootingAgeModifier,         changeLimits: [-5, 23] },
  freeThrow:        { ageModifier: shootingAgeModifier,         changeLimits: [-5, 23] },
  postScoring:      { ageModifier: shootingAgeModifier,         changeLimits: [-5, 23] },
  passing:          { ageModifier: skillAgeModifier,            changeLimits: [-4, 9] },
  ballHandling:     { ageModifier: skillAgeModifier,            changeLimits: [-4, 9] },
  perimeterDefense: { ageModifier: defenseAgeModifier,          changeLimits: [-7, 14] },
  interiorDefense:  { ageModifier: defenseAgeModifier,          changeLimits: [-7, 14] },
  steal:            { ageModifier: defenseAgeModifier,          changeLimits: [-7, 14] },
  block:            { ageModifier: athleticDefenseAgeModifier,   changeLimits: [-21, 7] },
  offReb:           { ageModifier: shootingAgeModifier,         changeLimits: [-4, 9] },
  defReb:           { ageModifier: shootingAgeModifier,         changeLimits: [-4, 9] },
  speed:            { ageModifier: athleticAgeModifier,         changeLimits: [-21, 4] },
  acceleration:     { ageModifier: athleticAgeModifier,         changeLimits: [-21, 4] },
  strength:         { ageModifier: strengthAgeModifier,         changeLimits: [-5, 11] },
  vertical:         { ageModifier: athleticAgeModifier,         changeLimits: [-21, 4] },
  basketballIQ:     { ageModifier: iqAgeModifier,               changeLimits: [-5, 23] },
  leadership:       { ageModifier: iqAgeModifier,               changeLimits: [-4, 14] },
  workEthic:        { ageModifier: mentalAgeModifier,           changeLimits: [-4, 7] }
};

// How fast a young player grows, as one named table instead of eight magic
// numbers inside calcBaseChange.
//
// These are CALIBRATED, not chosen: scripts/probe-superstar-rate.js measures
// how many players in a 60-man draft class ever peak at display 90+, and these
// values are swept to land that rate in the 2-4 band. Changing any of them
// without re-running that probe will silently move how many superstars the
// league produces per decade, which is the single number that decides whether
// a save still feels like the NBA in 2046.
//
// `noise` is drawn from a gaussian scaled by `sd` and then clipped. The clip
// used to be far wider above than below ([-4, 20] against an SD of 5: 0.8
// sigma of downside against 4 sigma of upside). That did two things — it added
// a positive mean to what reads like symmetric noise, and it left a long upside
// tail that compounded over the six or seven growth years a teenager gets. Both
// showed up as 100-OVR players by season 12.
//
// Swept in scripts/sweep-growth-tuning.js. Aimed at 3.23 in that harness rather
// than at the middle of the 2-4 band, because the harness READS LOW: it ages a
// class in isolation with no coach fit and no mentor bonus, both of which the
// real league applies. A first pass calibrated to 3.90 here produced roughly 5
// per class in a full 50-season run — about 25% high. So the harness number is
// deliberately set below target to land inside it live. Re-check against
// scripts/probe-superstar-rate-fullsim.js, not against the fast harness alone.
//
// Only the young brackets moved; the veteran decline curve is untouched, so the
// hand-authored 2026 roster ages exactly as it did before any of this.
// Re-swept for the 2K27 face-value league (the affine scaling below preserves
// attribute-space geometry, but the 2K display curve and the superstar bar at
// 95 both moved what a growth year is worth in display terms): young base
// 0.75/0.25 -> 0.5/0.15 and the under-25 noise upside clipped 5 -> 4, measured
// against probe-superstar-rate.js alongside the pull change above.
var GROWTH_TUNING = {
  // Deterministic part of the yearly change, by age bracket.
  base: [[21, 0.5], [25, 0.15], [27, 0], [29, -1], [31, -2], [34, -3], [40, -4], [43, -5], [Infinity, -6]],
  // Random part: [maxAge, sd, clipLow, clipHigh].
  noise: [[23, 2.2, -5, 4], [25, 2.2, -5, 4], [Infinity, 3, -2, 4]]
};

function calcBaseChange(age, rng) {
  var val = 0;
  for (var i = 0; i < GROWTH_TUNING.base.length; i++) {
    if (age <= GROWTH_TUNING.base[i][0]) { val = GROWTH_TUNING.base[i][1]; break; }
  }
  for (var j = 0; j < GROWTH_TUNING.noise.length; j++) {
    var n = GROWTH_TUNING.noise[j];
    if (age <= n[0]) { val += bound(gaussianRandom(rng) * n[1], n[2], n[3]); break; }
  }
  return val;
}

// A season's worth of affiliate basketball, and what it is worth.
//
// Swept in scripts/probe-development.js — 400 prospects, three seasons, the
// SAME dice down both paths so the only difference is where he spent the year.
// A prospect who sits gains +9.63 overall across three seasons; playing adds:
//
//   0.7   +2.46   (+26%)
//   1.0   +3.45   (+36%)   <- shipped
//   1.4   +4.75   (+49%)
//   2.0   +6.66   (+69%)
//
// 2.0 was the first pass and it is too strong: at +69% sending a prospect down
// stops being a decision and becomes an obligation. 1.0 is plainly worth doing
// and still leaves room to want him on the bench for a playoff push.
//
// This does NOT move the superstar rate the GROWTH_TUNING note above guards:
// the bonus only reaches players carrying a twoWay contract, and no player in a
// fresh league has one until a GM signs it.
// A man who does not want to be there does not get better.
//
// Morale was measured every game (morale.js's tickMoraleForTeamGame) and read
// by nobody who mattered: the audit found no reference to it in
// simEnginePossession, gameSim, gameCoach or this file. It decided how hard he
// was to re-sign and nothing else. So neglect had no cost you could see on the
// floor, and "keep your best young player happy" was not a decision.
//
// PIVOT is the league MEAN morale after a season actually played, measured at
// 62.3 — not 70 (which a reader would guess from moraleTier's "happy" bound
// and which would slow the whole league) and not 57 either, even though 57 is
// the median morale.js documents and the median a fresh season reproduces
// exactly.
//
// The median is the wrong centre for this. Morale's distribution is skewed:
// measured after one season, median 57.1 but p10 39 and p90 92, so the tail
// above the middle is twice as long as the tail below it. Pivoting on the
// median therefore still handed the league a net +0.244 rating points a
// season — every club quietly developing faster, which would have moved every
// balance number the engine was just tuned to, for no design reason at all.
//
// Pivoting on the MEAN makes the change what it should be: a redistribution.
// Happy players develop faster, miserable ones slower, and the league as a
// whole develops exactly as it did before.
//
// SCALE sits deliberately in the same family as the other soft inputs here:
// coachability contributes +/-1.5, the affiliate bonus 1.0, and a breakout
// roll +/-8. Mood should matter about as much as a coach who suits you, and
// nothing like as much as a breakout year.
const MORALE_DEV_PIVOT = 62.3;
const MORALE_DEV_SCALE = 1.2;
const MORALE_DEV_SPAN = 50;

function moraleDevelopmentBonus(player) {
  const m = player && player.status && player.status.morale;
  if (typeof m !== 'number' || !isFinite(m)) return 0;
  return ((m - MORALE_DEV_PIVOT) / MORALE_DEV_SPAN) * MORALE_DEV_SCALE;
}

const AFFILIATE_DEVELOPMENT_BONUS = 1.0;
const AFFILIATE_MINIMUM_GAMES = 10;
const AFFILIATE_DEVELOPMENT_MAX_AGE = 25;

function progressPlayer(player, rng, teammates, options) {
  teammates = teammates || [];
  options = options || {};
  player.age += 1;
  player.yearsPro += 1;

  var baseChange = calcBaseChange(player.age, rng);

  // Potential still acts as a gravitational pull toward each young player's
  // ceiling (tradeEvaluator/draftProspects/scouting all treat potential as a
  // real target, not just flavor text) — layered on top of the per-rating age
  // curves below rather than replacing them. Suppressed during
  // estimatePotentialMonteCarlo's internal simulation runs (see below) since
  // that function's whole purpose is to DISCOVER what potential should be —
  // pulling toward it while estimating it would be circular.
  if (!options.suppressPotentialPull) {
    // `potential` is stored RAW, so it can only be differenced against rawOverall.
    //
    // Pull weakened 0.15/0.05 -> 0.05/0.017 for the 2K27 face-value league.
    // The stored potential is the 75th percentile of NO-PULL simulated
    // futures (estimatePotentialMonteCarlo below), so a strong pull toward it
    // guarantees the median player his optimistic scenario — measured at 0.15
    // the fast harness minted 7.55 superstars per 60-man class against the
    // 2-4 target, and with the pull off entirely it still made 4.50. 0.05
    // keeps potential meaning something on scouting reports without turning
    // the p75 estimate into a promise.
    var potentialGap = player.potential - player.rawOverall;
    if (player.age <= 25) {
      baseChange += potentialGap * 0.05;
    } else if (player.age <= 29) {
      baseChange += potentialGap * 0.017;
    }
  }

  // Minutes beat a seat. A two-way player who actually turned out for the
  // affiliate develops faster than one who spent the year inactive, and that
  // difference is the entire reason the affiliate league is simulated rather
  // than asserted — without it, sending a prospect down is a cap trick and
  // nothing else.
  //
  // Read off the player rather than by requiring affiliates.js: progression is
  // called from the offseason, long after the games, and the count is the only
  // thing it needs to know.
  if (player.twoWay && player.age <= AFFILIATE_DEVELOPMENT_MAX_AGE &&
      (player.twoWay.gamesDown || 0) >= AFFILIATE_MINIMUM_GAMES) {
    baseChange += AFFILIATE_DEVELOPMENT_BONUS;
  }

  var breakoutRoll = rng();
  if (breakoutRoll < 0.03) baseChange += 8;
  else if (breakoutRoll > 0.97) baseChange -= 8;

  var team = (!options.suppressPotentialPull && player.teamId) ? _PROGRESSION_DATA.teams.getTeamById(player.teamId) : null;
  var fit = team ? _PROGRESSION_DATA.coaches.coachFitMultiplier(team.coach, player) : 1;
  baseChange += _PROGRESSION_DATA.traits.getTraitBonus(player, 'progression', 'self') * 0.3;
  if (player.hiddenPersonality && player.hiddenPersonality.coachability !== undefined) {
    baseChange += (player.hiddenPersonality.coachability - 50) / 50 * 1.5 * fit;
  }
  // Suppressed during the Monte Carlo potential estimate for the same reason
  // the potential pull and coach fit are: that run is asking what this player
  // COULD become, and a bad month in November is not part of the answer.
  if (!options.suppressPotentialPull) {
    baseChange += moraleDevelopmentBonus(player);
  }
  if (player.age <= 25 && !options.suppressPotentialPull) {
    var mentorBonus = teammates.reduce(function (sum, tm) {
      return sum + _PROGRESSION_DATA.traits.getTraitBonus(tm, 'progression', 'teammate');
    }, 0);
    baseChange += Math.min(3, mentorBonus * 0.2);
  }

  baseChange *= 1 + (baseChange > 0 ? 1 : -1) * (fit - 1) * 0.3;

  // A busted prospect grows slowly (draftProspects.js's applyBustRoll). Applied
  // to GROWTH only — a bust ages and declines on the normal curve, he just
  // never climbs. Absent on every player who is not a busted draftee, so this
  // is a no-op for the 2026 rosters and for prospects who hit.
  if (baseChange > 0 && typeof player.developmentRate === 'number') {
    baseChange *= player.developmentRate;
  }

  _PROGRESSION_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    var profile = RATING_PROFILES[key];
    var ageMod = profile ? profile.ageModifier(player.age) : 0;
    var limits = profile ? profile.changeLimits : [-5, 10];
    var ratingChange = bound(
      (baseChange + ageMod) * (0.4 + rng() * 1.0),
      limits[0], limits[1]
    );
    // Every delta above — base growth, age curves, changeLimits, breakouts —
    // is sized in OLD-scale attribute points. The 2K27 face-value attributes
    // are far more compressed (GENERATION_AFFINE scales run 0.47-1.29, most
    // well under 1), so applying old-scale deltas raw inflated the league:
    // measured over twenty seasons, median overall drifted 78 -> 85, the 90+
    // population went 22 -> ~190 and league scoring 135.5 -> ~147. Crossing
    // each delta through the same per-attribute affine that generation uses
    // makes a year of growth the same RELATIVE move it was on the old scale.
    var aff = _PROGRESSION_DATA.affine[key];
    if (aff) ratingChange *= aff.scale;
    player.attributes[key] = clampRating(player.attributes[key] + ratingChange);
  });

  // `overall` is derived from the attributes (ratings.js) — there is nothing
  // to update here, and nothing that CAN be updated: it is a getter.
  //
  // This used to be `player.overall = clampRating(player.overall + avgChange)`,
  // where avgChange averaged the change each attribute was ASKED for while the
  // attribute itself stored the change after clampRating truncated it. Any
  // rating pinned at a bound moved overall without moving the attributes, so
  // the two drifted apart — measured at up to 7.3 points over 12 seasons, with
  // 349 attribute-slots sitting at the ceiling and 210 at the floor. Since
  // minutesWeight read `overall` and every other weight read attributes, a
  // drifted player earned star minutes with role-player skills.
  player.potential = Math.max(player.potential, _PROGRESSION_DATA.ratings.computeOverall(player));

  applyCareerModeTraining(player);

  // The one place a badge can CHANGE after a player enters the league. Runs
  // last, so it sees this offseason's finished attributes — a player whose work
  // ethic just grew is judged on the new number, not the old one.
  //
  // Suppressed during estimatePotentialMonteCarlo's internal runs, exactly like
  // the potential pull above: that function simulates many futures to discover
  // a ceiling, and letting it hand out real badges along the way would both
  // corrupt the estimate and give a player a secret badge for a season that
  // never happened.
  if (!options.suppressPotentialPull) {
    const evolved = _PROGRESSION_DATA.traits.rollSecretBadgeEvolution(player);
    if (evolved) return evolved;
  }
  return null;
}

// Player-career-mode-only: applies the most recent unconsumed "training"
// decision (recorded via PlayerCareerController.recordDecision) as a small
// bonus to the attributes that focus covers, then marks it consumed so it
// only ever applies once. Guarded by isCustomPlayer + a runtime GameState
// check so this is a no-op for every generated player and for the node
// validation scripts, which never define GameState.
function applyCareerModeTraining(player) {
  if (!player.isCustomPlayer) return;
  if (typeof GameState === 'undefined' || !GameState.playerCareerController) return;

  const history = GameState.playerCareerController.decisionHistory;
  const pending = history.find(function (d) { return d.type === 'training' && !d.applied; });
  if (!pending) return;

  const TRAINING_FOCUS_ATTRS = {
    focus_shooting: ['midRange', 'threePoint', 'freeThrow'],
    focus_defense: ['perimeterDefense', 'interiorDefense'],
    focus_athleticism: ['speed', 'acceleration', 'vertical'],
    focus_playmaking: ['passing', 'ballHandling']
  };
  const TRAINING_BONUS = 2;

  const attrs = TRAINING_FOCUS_ATTRS[pending.decision] || [];
  attrs.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + TRAINING_BONUS);
  });
  pending.applied = true;
}

const MONTE_CARLO_SIMULATIONS = 20; // ZenGM's develop.ts uses the same count — enough samples without being slow
const MONTE_CARLO_TARGET_AGE = 29; // player.js:develop's own convention: aging is simulated up to (not including) 29

// Estimates a prospect's realistic ceiling by actually simulating their
// career forward with progressPlayer, rather than a flat rank-based formula.
// Only meaningful for players who HAVEN'T developed yet (procedurally
// generated future draft prospects) — real players-2026.js rosters and the
// hand-authored 2026 draft class already carry scouting-judgment potential
// values that this would be wrong to overwrite. Runs MONTE_CARLO_SIMULATIONS
// independent trajectories on throwaway copies (never touches the real
// player object) up to age 29, takes the max overall reached in each one,
// and returns the 75th percentile across runs — same "high but not the
// absolute ceiling of luck" percentile ZenGM's monteCarloPot uses.
function estimatePotentialMonteCarlo(player, rng) {
  if (player.age >= MONTE_CARLO_TARGET_AGE) return player.rawOverall;

  const maxOveralls = [];
  for (let sim = 0; sim < MONTE_CARLO_SIMULATIONS; sim++) {
    // The copy needs the DERIVED overall getter, not a plain snapshot of the
    // number. With a plain field, progressPlayer — which now only moves
    // attributes — would leave copy.overall frozen at its starting value, and
    // every trajectory would report zero growth: every prospect's estimated
    // potential would come back equal to his current overall.
    const copy = _PROGRESSION_DATA.ratings.defineOverall({
      age: player.age,
      yearsPro: player.yearsPro,
      attributes: Object.assign({}, player.attributes),
      teamId: null,
      hiddenPersonality: player.hiddenPersonality || {},
      isCustomPlayer: false
    });
    // Unused while suppressPotentialPull is set, but keeps the
    // potential >= overall invariant valid for anything that reads the copy.
    copy.potential = copy.rawOverall;
    let maxOverall = copy.rawOverall;
    while (copy.age < MONTE_CARLO_TARGET_AGE) {
      progressPlayer(copy, rng, [], { suppressPotentialPull: true });
      if (copy.rawOverall > maxOverall) maxOverall = copy.rawOverall;
    }
    maxOveralls.push(maxOverall);
  }

  maxOveralls.sort(function (a, b) { return a - b; });
  return maxOveralls[Math.floor(0.75 * MONTE_CARLO_SIMULATIONS)];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { progressPlayer: progressPlayer, clampRating: clampRating, estimatePotentialMonteCarlo: estimatePotentialMonteCarlo, GROWTH_TUNING: GROWTH_TUNING, calcBaseChange: calcBaseChange, moraleDevelopmentBonus: moraleDevelopmentBonus, MORALE_DEV_PIVOT: MORALE_DEV_PIVOT, MORALE_DEV_SCALE: MORALE_DEV_SCALE };
}
