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

// --- Real 2026 NBA Draft class, mock slots 1-15 ---
DRAFT_PROSPECTS_2026.push(mkProspect('A.J. Dybantsa', 19, 80, 210, 'SF', 74, 92, 'primary_scorer', 0.20, 'Kevin Durant'));
DRAFT_PROSPECTS_2026.push(mkProspect('Cameron Boozer', 19, 81, 235, 'PF', 73, 89, 'primary_scorer', 0.20, 'Chris Bosh'));
DRAFT_PROSPECTS_2026.push(mkProspect('Darryn Peterson', 19, 77, 200, 'SG', 73, 90, 'primary_scorer', 0.22, 'Anthony Edwards'));
DRAFT_PROSPECTS_2026.push(mkProspect('Chris Cenac Jr.', 19, 82, 240, 'C', 71, 87, 'rim_protector', 0.25, 'Jarrett Allen'));
DRAFT_PROSPECTS_2026.push(mkProspect('Nate Ament', 19, 81, 195, 'SF', 71, 86, 'three_and_d', 0.25, 'Michael Porter Jr.'));
DRAFT_PROSPECTS_2026.push(mkProspect('Caleb Wilson', 19, 81, 210, 'PF', 70, 86, 'rim_protector', 0.27, 'Jaren Jackson Jr.'));
DRAFT_PROSPECTS_2026.push(mkProspect('Koa Peat', 19, 80, 235, 'PF', 70, 85, 'slasher', 0.27, 'Julius Randle'));
DRAFT_PROSPECTS_2026.push(mkProspect('Tounde Yessoufou', 19, 78, 215, 'SG', 69, 85, 'slasher', 0.28, 'Dyson Daniels'));
DRAFT_PROSPECTS_2026.push(mkProspect('Cayden Boozer', 19, 75, 190, 'PG', 68, 83, 'playmaker', 0.28, 'Tre Jones'));
DRAFT_PROSPECTS_2026.push(mkProspect('Jasper Johnson', 19, 76, 190, 'SG', 68, 84, 'three_and_d', 0.30, 'Malik Monk'));
DRAFT_PROSPECTS_2026.push(mkProspect('Alijah Arenas', 19, 77, 205, 'SG', 68, 85, 'primary_scorer', 0.32, 'Devin Booker'));
DRAFT_PROSPECTS_2026.push(mkProspect('Meleek Thomas', 19, 75, 185, 'PG', 67, 83, 'playmaker', 0.30, 'Ja Morant'));
DRAFT_PROSPECTS_2026.push(mkProspect('Isiah Harwell', 19, 78, 200, 'SG', 67, 82, 'slasher', 0.32, 'Jalen Green'));
DRAFT_PROSPECTS_2026.push(mkProspect('Braylon Mullins', 20, 77, 195, 'SG', 67, 81, 'three_and_d', 0.32, 'Grayson Allen'));
DRAFT_PROSPECTS_2026.push(mkProspect('Mikel Brown Jr.', 19, 74, 175, 'PG', 66, 82, 'playmaker', 0.33, 'Tyus Jones'));

// --- Real 2026 NBA Draft class, mock slots 16-30 (round 1 complete) ---
DRAFT_PROSPECTS_2026.push(mkProspect('Kiyan Anthony', 19, 77, 190, 'SG', 66, 80, 'primary_scorer', 0.35, 'Bradley Beal'));
DRAFT_PROSPECTS_2026.push(mkProspect('Labaron Philon', 20, 75, 195, 'PG', 67, 81, 'playmaker', 0.32, 'Marcus Smart'));
DRAFT_PROSPECTS_2026.push(mkProspect('Dwayne Aristode', 19, 80, 210, 'SF', 65, 80, 'three_and_d', 0.35, 'OG Anunoby'));
DRAFT_PROSPECTS_2026.push(mkProspect('Jerry Easter II', 19, 76, 185, 'SG', 65, 79, 'slasher', 0.36, 'Terrance Mann'));
DRAFT_PROSPECTS_2026.push(mkProspect('Sadiq White Jr.', 19, 79, 200, 'SF', 65, 79, 'three_and_d', 0.36, 'Kelly Oubre Jr.'));
DRAFT_PROSPECTS_2026.push(mkProspect('Karim Lopez', 19, 79, 205, 'SG', 64, 80, 'slasher', 0.38, 'Josh Giddey'));
DRAFT_PROSPECTS_2026.push(mkProspect('Christian Anderson', 20, 74, 180, 'PG', 64, 77, 'playmaker', 0.35, 'Immanuel Quickley'));
DRAFT_PROSPECTS_2026.push(mkProspect('Roman Hall', 19, 79, 205, 'SF', 64, 78, 'slasher', 0.37, 'Franz Wagner'));
DRAFT_PROSPECTS_2026.push(mkProspect('Jamier Jones', 19, 82, 225, 'PF', 63, 78, 'rim_protector', 0.38, 'Bobby Portis'));
DRAFT_PROSPECTS_2026.push(mkProspect('Sebastian Wilkins', 19, 76, 190, 'SG', 63, 77, 'three_and_d', 0.38, 'Josh Hart'));
DRAFT_PROSPECTS_2026.push(mkProspect('Vertrail Vaughns', 20, 77, 195, 'SG', 63, 76, 'primary_scorer', 0.40, 'Malik Beasley'));
DRAFT_PROSPECTS_2026.push(mkProspect('Bryson Stiggers', 19, 75, 180, 'PG', 62, 77, 'playmaker', 0.40, 'Payton Pritchard'));
DRAFT_PROSPECTS_2026.push(mkProspect('Immanuel Sheppard', 19, 78, 200, 'SF', 62, 76, 'slasher', 0.40, 'Herbert Jones'));
DRAFT_PROSPECTS_2026.push(mkProspect('Elzie Harrington', 19, 83, 245, 'C', 62, 77, 'rim_protector', 0.40, 'Isaiah Hartenstein'));
DRAFT_PROSPECTS_2026.push(mkProspect('Traylen Roberts', 19, 76, 190, 'SG', 61, 75, 'three_and_d', 0.42, 'Duncan Robinson'));

// --- Real 2026 NBA Draft class, mock slots 31-45 (round 2, part 1) ---
DRAFT_PROSPECTS_2026.push(mkProspect('Nique Clifford Jr.', 21, 78, 205, 'SG', 61, 72, 'three_and_d', 0.45, 'Josh Okogie'));
DRAFT_PROSPECTS_2026.push(mkProspect('Boogie Fland', 20, 74, 175, 'PG', 61, 74, 'playmaker', 0.42, 'Collin Sexton'));
DRAFT_PROSPECTS_2026.push(mkProspect('Tre Johnson Jr.', 20, 78, 195, 'SG', 60, 73, 'primary_scorer', 0.44, 'Norman Powell'));
DRAFT_PROSPECTS_2026.push(mkProspect('Milos Uzan', 21, 75, 190, 'PG', 60, 71, 'playmaker', 0.42, 'Monte Morris'));
DRAFT_PROSPECTS_2026.push(mkProspect('Chance Westry', 20, 78, 200, 'SG', 60, 72, 'slasher', 0.45, 'Jaden McDaniels'));
DRAFT_PROSPECTS_2026.push(mkProspect('Aday Mara', 20, 84, 245, 'C', 60, 74, 'rim_protector', 0.45, 'Walker Kessler'));
DRAFT_PROSPECTS_2026.push(mkProspect('Tounde Zogbo', 20, 82, 230, 'PF', 59, 71, 'rim_protector', 0.46, 'Jalen Smith'));
DRAFT_PROSPECTS_2026.push(mkProspect('Rob Wright III', 20, 74, 180, 'PG', 59, 71, 'playmaker', 0.45, 'Jose Alvarado'));
DRAFT_PROSPECTS_2026.push(mkProspect('Jayden Quaintance', 19, 82, 220, 'PF', 59, 76, 'rim_protector', 0.42, 'Jaren Jackson Jr.'));
DRAFT_PROSPECTS_2026.push(mkProspect('Alex Condon Jr.', 21, 82, 232, 'PF', 58, 69, 'rim_protector', 0.47, 'Kelly Olynyk'));
DRAFT_PROSPECTS_2026.push(mkProspect('Donovan Dent', 21, 73, 175, 'PG', 58, 70, 'playmaker', 0.46, 'Kris Dunn'));
DRAFT_PROSPECTS_2026.push(mkProspect('Elliot Cadeau', 20, 74, 185, 'PG', 58, 71, 'playmaker', 0.46, 'Delon Wright'));
DRAFT_PROSPECTS_2026.push(mkProspect('Nate Bittle', 21, 83, 235, 'C', 58, 70, 'rim_protector', 0.47, 'Brook Lopez'));
DRAFT_PROSPECTS_2026.push(mkProspect('Curtis Givens III', 20, 73, 175, 'PG', 57, 70, 'three_and_d', 0.47, 'Gary Payton II'));
DRAFT_PROSPECTS_2026.push(mkProspect('Isaiah Elohim', 19, 78, 195, 'SG', 57, 74, 'slasher', 0.46, 'Cam Thomas'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mkProspect: mkProspect,
    generateProspectClass: generateProspectClass,
    DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026
  };
}
