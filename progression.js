var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js'), teams: require('./teams.js'), coaches: require('./coaches.js'), ratings: require('./ratings.js') }
  : {
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX },
      traits: { getTraitBonus: getTraitBonus },
      teams: { getTeamById: getTeamById },
      coaches: { coachFitMultiplier: coachFitMultiplier },
      ratings: { computeOverall: computeOverall }
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

function calcBaseChange(age, rng) {
  var val;
  if (age <= 21)      val = 2;
  else if (age <= 25) val = 1;
  else if (age <= 27) val = 0;
  else if (age <= 29) val = -1;
  else if (age <= 31) val = -2;
  else if (age <= 34) val = -3;
  else if (age <= 40) val = -4;
  else if (age <= 43) val = -5;
  else                val = -6;

  if (age <= 23)      val += bound(gaussianRandom(rng) * 5, -4, 20);
  else if (age <= 25) val += bound(gaussianRandom(rng) * 5, -4, 10);
  else                val += bound(gaussianRandom(rng) * 3, -2, 4);

  return val;
}

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
    var potentialGap = player.potential - player.rawOverall;
    if (player.age <= 25) {
      baseChange += potentialGap * 0.15;
    } else if (player.age <= 29) {
      baseChange += potentialGap * 0.05;
    }
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
  if (player.age <= 25 && !options.suppressPotentialPull) {
    var mentorBonus = teammates.reduce(function (sum, tm) {
      return sum + _PROGRESSION_DATA.traits.getTraitBonus(tm, 'progression', 'teammate');
    }, 0);
    baseChange += Math.min(3, mentorBonus * 0.2);
  }

  baseChange *= 1 + (baseChange > 0 ? 1 : -1) * (fit - 1) * 0.3;

  _PROGRESSION_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    var profile = RATING_PROFILES[key];
    var ageMod = profile ? profile.ageModifier(player.age) : 0;
    var limits = profile ? profile.changeLimits : [-5, 10];
    var ratingChange = bound(
      (baseChange + ageMod) * (0.4 + rng() * 1.0),
      limits[0], limits[1]
    );
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
  module.exports = { progressPlayer: progressPlayer, clampRating: clampRating, estimatePotentialMonteCarlo: estimatePotentialMonteCarlo };
}
