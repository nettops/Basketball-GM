var _PROSPECT_DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, POSITIONS: POSITIONS };

// Same archetype offsets as players-2026.js's ARCHETYPES, duplicated here rather
// than shared — prospects and rostered players are authored independently and
// don't need to move together if one file's archetype tuning changes later.
const PROSPECT_ARCHETYPES = {
  primary_scorer:  { insideScoring: 4, midRange: 6, threePoint: 4, freeThrow: 4, passing: -2, ballHandling: 3, postScoring: 0, perimeterDefense: -6, interiorDefense: -10, steal: -4, block: -10, offReb: -8, defReb: -4, speed: 2, acceleration: 2, strength: 0, vertical: 2, basketballIQ: 2, leadership: 2, workEthic: 0 },
  playmaker:       { insideScoring: -2, midRange: 2, threePoint: 2, freeThrow: 2, passing: 10, ballHandling: 10, postScoring: -10, perimeterDefense: -2, interiorDefense: -12, steal: 2, block: -12, offReb: -10, defReb: -6, speed: 4, acceleration: 4, strength: -4, vertical: -2, basketballIQ: 6, leadership: 4, workEthic: 0 },
  three_and_d:     { insideScoring: -6, midRange: 0, threePoint: 8, freeThrow: 2, passing: -4, ballHandling: -4, postScoring: -10, perimeterDefense: 8, interiorDefense: -4, steal: 4, block: -4, offReb: -4, defReb: 0, speed: 2, acceleration: 2, strength: 0, vertical: 0, basketballIQ: 2, leadership: 0, workEthic: 2 },
  rim_protector:   { insideScoring: -4, midRange: -10, threePoint: -14, freeThrow: -10, passing: -8, ballHandling: -12, postScoring: 2, perimeterDefense: 0, interiorDefense: 10, steal: -2, block: 12, offReb: 8, defReb: 10, speed: -6, acceleration: -6, strength: 8, vertical: 4, basketballIQ: 0, leadership: 0, workEthic: 2 },
  slasher:         { insideScoring: 8, midRange: -2, threePoint: -6, freeThrow: -2, passing: 0, ballHandling: 4, postScoring: -2, perimeterDefense: 0, interiorDefense: -6, steal: 2, block: -6, offReb: -2, defReb: -2, speed: 6, acceleration: 6, strength: 0, vertical: 6, basketballIQ: 0, leadership: 0, workEthic: 0 },
  raw_prospect:    { insideScoring: -2, midRange: -4, threePoint: -4, freeThrow: -2, passing: -2, ballHandling: -2, postScoring: -2, perimeterDefense: -2, interiorDefense: -2, steal: -2, block: -2, offReb: -2, defReb: -2, speed: 4, acceleration: 4, strength: -4, vertical: 4, basketballIQ: -8, leadership: -6, workEthic: 0 }
};

function makeProspectAttributes(overall, archetype) {
  const offsets = PROSPECT_ARCHETYPES[archetype];
  const attrs = {};
  _PROSPECT_DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = overall + (offsets[key] || 0);
    attrs[key] = Math.max(_PROSPECT_DATA.RATING_MIN, Math.min(_PROSPECT_DATA.RATING_MAX, raw));
  });
  return attrs;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mkProspect(name, age, heightIn, weightLb, position, overall, potential, archetype, bustChance, nbaComparison) {
  return {
    id: 'prospect-' + slugify(name) + '-' + Math.floor(Math.random() * 1000000),
    teamId: null,
    name: name,
    age: age,
    heightIn: heightIn,
    weightLb: weightLb,
    position: position,
    jerseyNumber: null, // assigned when drafted
    yearsPro: 0,
    overall: overall,
    potential: potential,
    contract: { salary: 0, yearsRemaining: 0, playerOption: false, teamOption: false }, // set on draft
    status: { morale: 70, fatigue: 0, injury: null },
    attributes: makeProspectAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {},
    bustChance: bustChance,
    nbaComparison: nbaComparison
  };
}

const ARCHETYPE_NAMES = Object.keys(PROSPECT_ARCHETYPES);
const FIRST_NAMES = ['Jaylen', 'Marcus', 'Devin', 'Isaiah', 'Elijah', 'Cameron', 'Xavier', 'Malik', 'Tyler', 'Andre', 'DeAndre', 'Josiah', 'Amari', 'Jalen', 'Caleb'];
const LAST_NAMES = ['Turner', 'Brooks', 'Hayes', 'Coleman', 'Reid', 'Bryant', 'Foster', 'Simmons', 'Ward', 'Price', 'Bell', 'Owens', 'Hunt', 'Mercer', 'Dawson'];

// Every draft after the real 2026 class uses this — procedurally generated,
// same schema as a real prospect, but with a generic name and a rank-correlated
// overall/potential spread (early picks skew better, same idea as a real class).
function generateProspectClass(rng, count) {
  const prospects = [];
  for (let i = 0; i < count; i++) {
    const rankFactor = 1 - i / count; // 1.0 for pick 1, ->0 for the last pick
    const overall = Math.round(58 + rankFactor * 22 + (rng() - 0.5) * 8);
    const potential = Math.round(overall + rng() * 15 + rankFactor * 8);
    const archetype = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)];
    const position = _PROSPECT_DATA.POSITIONS[Math.floor(rng() * _PROSPECT_DATA.POSITIONS.length)];
    const name = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)] + ' ' + LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] + ' Jr.'.slice(0, rng() < 0.15 ? 4 : 0);
    const age = 18 + Math.floor(rng() * 4);
    const heightIn = 74 + Math.floor(rng() * 10);
    const weightLb = 180 + Math.floor(rng() * 60);
    const bustChance = Math.round((0.15 + (1 - rankFactor) * 0.35) * 100) / 100;
    prospects.push(mkProspect(name.trim(), age, heightIn, weightLb, position, Math.max(40, Math.min(90, overall)), Math.max(overall, Math.min(99, potential)), archetype, bustChance, 'Unproven'));
  }
  return prospects;
}

const DRAFT_PROSPECTS_2026 = [];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mkProspect: mkProspect,
    generateProspectClass: generateProspectClass,
    DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026
  };
}
