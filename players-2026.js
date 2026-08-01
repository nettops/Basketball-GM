// In Node (used only by scripts/validate-data.js) this file is its own module
// scope, so the globals data.js defines via classic <script> tags in the
// browser aren't visible here automatically — pull them in explicitly via a
// distinctly-named local (`_DATA`), not by redeclaring ATTRIBUTE_KEYS/etc.
// directly, since re-declaring an identifier that's already a page-global
// `const` from an earlier <script> tag would be a SyntaxError in the browser.
var _DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX };

// Archetype attribute offsets applied to a player's overall rating to produce
// a realistic 20-attribute spread, clamped to [RATING_MIN, RATING_MAX].
// This keeps ~450 hand-picked (overall, archetype) real-player judgments
// internally consistent instead of hand-typing 9000 individual numbers.
const ARCHETYPES = {
  primary_scorer:  { insideScoring: 4, midRange: 6, threePoint: 4, freeThrow: 4, passing: -2, ballHandling: 3, postScoring: 0, perimeterDefense: -6, interiorDefense: -10, steal: -4, block: -10, offReb: -8, defReb: -4, speed: 2, acceleration: 2, strength: 0, vertical: 2, basketballIQ: 2, leadership: 2, workEthic: 0 },
  playmaker:       { insideScoring: -2, midRange: 2, threePoint: 2, freeThrow: 2, passing: 10, ballHandling: 10, postScoring: -10, perimeterDefense: -2, interiorDefense: -12, steal: 2, block: -12, offReb: -10, defReb: -6, speed: 4, acceleration: 4, strength: -4, vertical: -2, basketballIQ: 6, leadership: 4, workEthic: 0 },
  three_and_d:     { insideScoring: -6, midRange: 0, threePoint: 8, freeThrow: 2, passing: -4, ballHandling: -4, postScoring: -10, perimeterDefense: 8, interiorDefense: -4, steal: 4, block: -4, offReb: -4, defReb: 0, speed: 2, acceleration: 2, strength: 0, vertical: 0, basketballIQ: 2, leadership: 0, workEthic: 2 },
  rim_protector:   { insideScoring: -4, midRange: -10, threePoint: -14, freeThrow: -10, passing: -8, ballHandling: -12, postScoring: 2, perimeterDefense: 0, interiorDefense: 10, steal: -2, block: 12, offReb: 8, defReb: 10, speed: -6, acceleration: -6, strength: 8, vertical: 4, basketballIQ: 0, leadership: 0, workEthic: 2 },
  stretch_big:     { insideScoring: -2, midRange: 4, threePoint: 6, freeThrow: 4, passing: -4, ballHandling: -8, postScoring: 0, perimeterDefense: -4, interiorDefense: 2, steal: -4, block: 4, offReb: 0, defReb: 4, speed: -4, acceleration: -4, strength: 4, vertical: 0, basketballIQ: 0, leadership: 0, workEthic: 0 },
  slasher:         { insideScoring: 8, midRange: -2, threePoint: -6, freeThrow: -2, passing: 0, ballHandling: 4, postScoring: -2, perimeterDefense: 0, interiorDefense: -6, steal: 2, block: -6, offReb: -2, defReb: -2, speed: 6, acceleration: 6, strength: 0, vertical: 6, basketballIQ: 0, leadership: 0, workEthic: 0 },
  veteran_glue:    { insideScoring: -4, midRange: -2, threePoint: 0, freeThrow: 0, passing: 2, ballHandling: 0, postScoring: -4, perimeterDefense: 2, interiorDefense: 0, steal: 0, block: 0, offReb: 0, defReb: 0, speed: -6, acceleration: -6, strength: 0, vertical: -6, basketballIQ: 4, leadership: 6, workEthic: 4 },
  raw_prospect:    { insideScoring: -2, midRange: -4, threePoint: -4, freeThrow: -2, passing: -2, ballHandling: -2, postScoring: -2, perimeterDefense: -2, interiorDefense: -2, steal: -2, block: -2, offReb: -2, defReb: -2, speed: 4, acceleration: 4, strength: -4, vertical: 4, basketballIQ: -8, leadership: -6, workEthic: 0 }
};

function makeAttributes(overall, archetype) {
  const offsets = ARCHETYPES[archetype];
  const attrs = {};
  _DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = overall + (offsets[key] || 0);
    attrs[key] = Math.max(_DATA.RATING_MIN, Math.min(_DATA.RATING_MAX, raw));
  });
  return attrs;
}

function pid(teamId, name) {
  return teamId.toLowerCase() + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mkPlayer(teamId, name, age, heightIn, weightLb, position, jerseyNumber, yearsPro, overall, potential, archetype, salary, yearsRemaining, opts) {
  opts = opts || {};
  return {
    id: pid(teamId, name),
    teamId: teamId,
    name: name,
    age: age,
    heightIn: heightIn,
    weightLb: weightLb,
    position: position,
    jerseyNumber: jerseyNumber,
    yearsPro: yearsPro,
    overall: overall,
    potential: potential,
    contract: {
      salary: salary,
      yearsRemaining: yearsRemaining,
      playerOption: !!opts.playerOption,
      teamOption: !!opts.teamOption
    },
    status: { morale: opts.morale || 70, fatigue: 0, injury: null },
    attributes: makeAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {}
  };
}

const PLAYERS_2026 = [];

// --- Atlantic Division ---

// Boston Celtics
PLAYERS_2026.push(mkPlayer('BOS', 'Jayson Tatum', 27, 80, 210, 'SF', 0, 8, 96, 97, 'primary_scorer', 34800000, 4));
PLAYERS_2026.push(mkPlayer('BOS', 'Jaylen Brown', 29, 78, 223, 'SG', 7, 9, 92, 92, 'slasher', 49000000, 4));
PLAYERS_2026.push(mkPlayer('BOS', 'Derrick White', 31, 76, 190, 'PG', 9, 8, 87, 87, 'three_and_d', 28000000, 3));
PLAYERS_2026.push(mkPlayer('BOS', 'Payton Pritchard', 27, 74, 195, 'PG', 11, 5, 82, 84, 'primary_scorer', 15000000, 3));
PLAYERS_2026.push(mkPlayer('BOS', 'Anfernee Simons', 26, 74, 181, 'SG', 1, 7, 83, 84, 'primary_scorer', 25000000, 2));
PLAYERS_2026.push(mkPlayer('BOS', 'Al Horford', 39, 81, 240, 'C', 42, 18, 76, 76, 'stretch_big', 5000000, 1));
PLAYERS_2026.push(mkPlayer('BOS', 'Sam Hauser', 27, 79, 217, 'SF', 30, 4, 76, 78, 'three_and_d', 8000000, 3));
PLAYERS_2026.push(mkPlayer('BOS', 'Luke Kornet', 30, 84, 250, 'C', 40, 7, 73, 74, 'rim_protector', 5000000, 2));
PLAYERS_2026.push(mkPlayer('BOS', 'Neemias Queta', 26, 83, 254, 'C', 88, 3, 74, 78, 'rim_protector', 4000000, 3));
PLAYERS_2026.push(mkPlayer('BOS', 'Baylor Scheierman', 23, 78, 205, 'SG', 55, 2, 72, 78, 'three_and_d', 3200000, 3));
PLAYERS_2026.push(mkPlayer('BOS', 'Jordan Walsh', 21, 79, 195, 'SF', 27, 3, 70, 80, 'raw_prospect', 2200000, 2));
PLAYERS_2026.push(mkPlayer('BOS', 'Xavier Tillman', 26, 79, 245, 'PF', 26, 5, 71, 73, 'rim_protector', 4400000, 2));
PLAYERS_2026.push(mkPlayer('BOS', 'JD Davison', 22, 74, 200, 'PG', 8, 3, 68, 74, 'playmaker', 2000000, 2));
PLAYERS_2026.push(mkPlayer('BOS', 'Josh Minott', 22, 80, 210, 'PF', 45, 3, 69, 76, 'slasher', 2000000, 2));

// Brooklyn Nets
PLAYERS_2026.push(mkPlayer('BKN', 'Cam Thomas', 24, 74, 210, 'SG', 24, 4, 82, 86, 'primary_scorer', 12000000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Michael Porter Jr.', 27, 82, 218, 'SF', 1, 6, 81, 82, 'stretch_big', 34000000, 3));
PLAYERS_2026.push(mkPlayer('BKN', 'Nic Claxton', 26, 83, 215, 'C', 33, 5, 79, 81, 'rim_protector', 20000000, 3));
PLAYERS_2026.push(mkPlayer('BKN', 'Ziaire Williams', 24, 79, 185, 'SF', 8, 4, 73, 78, 'three_and_d', 6000000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Day\'Ron Sharpe', 24, 82, 265, 'C', 20, 4, 72, 76, 'rim_protector', 4500000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Noah Clowney', 21, 82, 220, 'PF', 15, 2, 71, 80, 'stretch_big', 3200000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Egor Demin', 19, 80, 195, 'PG', 3, 0, 66, 82, 'playmaker', 9200000, 4));
PLAYERS_2026.push(mkPlayer('BKN', 'Danny Wolf', 21, 83, 250, 'PF', 5, 0, 65, 79, 'raw_prospect', 4800000, 4));
PLAYERS_2026.push(mkPlayer('BKN', 'Keon Johnson', 23, 76, 175, 'SG', 45, 4, 70, 75, 'slasher', 3500000, 1));
PLAYERS_2026.push(mkPlayer('BKN', 'Tyrese Martin', 25, 77, 218, 'SG', 4, 2, 68, 72, 'three_and_d', 2100000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Jalen Wilson', 24, 79, 220, 'SF', 10, 2, 69, 73, 'three_and_d', 2200000, 3));
PLAYERS_2026.push(mkPlayer('BKN', 'Trendon Watford', 24, 80, 237, 'PF', 9, 3, 70, 74, 'slasher', 3300000, 2));
PLAYERS_2026.push(mkPlayer('BKN', 'Drake Powell', 20, 78, 205, 'SF', 21, 0, 65, 78, 'raw_prospect', 2800000, 3));
PLAYERS_2026.push(mkPlayer('BKN', 'Tosan Evbuomwan', 24, 80, 218, 'PF', 31, 2, 64, 68, 'veteran_glue', 1900000, 1));

// New York Knicks
PLAYERS_2026.push(mkPlayer('NYK', 'Jalen Brunson', 29, 73, 190, 'PG', 11, 7, 93, 93, 'primary_scorer', 34000000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Karl-Anthony Towns', 30, 83, 248, 'C', 32, 10, 89, 89, 'stretch_big', 49000000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'OG Anunoby', 28, 79, 232, 'SF', 8, 8, 86, 87, 'three_and_d', 36000000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Mikal Bridges', 29, 79, 209, 'SF', 25, 7, 85, 85, 'three_and_d', 24000000, 2));
PLAYERS_2026.push(mkPlayer('NYK', 'Josh Hart', 30, 76, 215, 'SG', 3, 8, 81, 81, 'veteran_glue', 18000000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Mitchell Robinson', 27, 83, 240, 'C', 23, 7, 76, 78, 'rim_protector', 14000000, 2));
PLAYERS_2026.push(mkPlayer('NYK', 'Miles McBride', 25, 74, 195, 'PG', 2, 4, 76, 80, 'three_and_d', 8000000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Guerschon Yabusele', 29, 80, 240, 'PF', 21, 4, 74, 75, 'stretch_big', 6000000, 2));
PLAYERS_2026.push(mkPlayer('NYK', 'Delon Wright', 33, 77, 185, 'PG', 55, 10, 69, 69, 'veteran_glue', 3200000, 1));
PLAYERS_2026.push(mkPlayer('NYK', 'Ariel Hukporti', 23, 83, 255, 'C', 34, 1, 68, 76, 'rim_protector', 2100000, 2));
PLAYERS_2026.push(mkPlayer('NYK', 'Pacome Dadiet', 20, 80, 190, 'SF', 5, 1, 65, 79, 'raw_prospect', 3400000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Tyler Kolek', 23, 73, 195, 'PG', 6, 1, 66, 74, 'playmaker', 2200000, 3));
PLAYERS_2026.push(mkPlayer('NYK', 'Landry Shamet', 28, 76, 190, 'SG', 44, 7, 68, 69, 'three_and_d', 2100000, 1));
PLAYERS_2026.push(mkPlayer('NYK', 'Jericho Sims', 26, 81, 244, 'C', 45, 4, 68, 71, 'rim_protector', 2600000, 1));

// Philadelphia 76ers
PLAYERS_2026.push(mkPlayer('PHI', 'Joel Embiid', 31, 84, 280, 'C', 21, 9, 90, 90, 'primary_scorer', 51000000, 2));
PLAYERS_2026.push(mkPlayer('PHI', 'Tyrese Maxey', 25, 74, 200, 'PG', 0, 5, 90, 92, 'primary_scorer', 35000000, 4));
PLAYERS_2026.push(mkPlayer('PHI', 'Paul George', 35, 80, 220, 'SF', 8, 14, 82, 82, 'three_and_d', 49000000, 3));
PLAYERS_2026.push(mkPlayer('PHI', 'VJ Edgecombe', 19, 76, 193, 'SG', 4, 0, 74, 88, 'slasher', 12500000, 4));
PLAYERS_2026.push(mkPlayer('PHI', 'Jared McCain', 22, 75, 195, 'SG', 15, 1, 78, 86, 'primary_scorer', 4500000, 3));
PLAYERS_2026.push(mkPlayer('PHI', 'Quentin Grimes', 25, 77, 210, 'SG', 5, 4, 76, 80, 'three_and_d', 8800000, 1));
PLAYERS_2026.push(mkPlayer('PHI', 'Kelly Oubre Jr.', 30, 79, 203, 'SF', 9, 10, 76, 76, 'slasher', 8500000, 1));
PLAYERS_2026.push(mkPlayer('PHI', 'Andre Drummond', 32, 82, 279, 'C', 3, 13, 75, 75, 'rim_protector', 5500000, 1));
PLAYERS_2026.push(mkPlayer('PHI', 'Eric Gordon', 37, 76, 215, 'SG', 10, 17, 70, 70, 'veteran_glue', 3200000, 1));
PLAYERS_2026.push(mkPlayer('PHI', 'Adem Bona', 22, 82, 234, 'C', 20, 1, 68, 76, 'rim_protector', 2200000, 3));
PLAYERS_2026.push(mkPlayer('PHI', 'Johni Broome', 22, 81, 226, 'PF', 33, 0, 67, 78, 'rim_protector', 3100000, 4));
PLAYERS_2026.push(mkPlayer('PHI', 'Justin Edwards', 21, 80, 215, 'SF', 44, 1, 66, 75, 'three_and_d', 2000000, 2));
PLAYERS_2026.push(mkPlayer('PHI', 'Jeff Dowtin', 27, 75, 175, 'PG', 11, 3, 63, 65, 'playmaker', 1900000, 1));
PLAYERS_2026.push(mkPlayer('PHI', 'Michael Foster Jr.', 22, 81, 240, 'PF', 25, 2, 65, 71, 'raw_prospect', 1900000, 1));

// Toronto Raptors
PLAYERS_2026.push(mkPlayer('TOR', 'Scottie Barnes', 24, 80, 237, 'SF', 4, 4, 88, 92, 'playmaker', 38000000, 5));
PLAYERS_2026.push(mkPlayer('TOR', 'Brandon Ingram', 28, 80, 190, 'SF', 14, 9, 84, 84, 'primary_scorer', 32000000, 2));
PLAYERS_2026.push(mkPlayer('TOR', 'RJ Barrett', 25, 78, 214, 'SG', 9, 6, 82, 84, 'slasher', 27000000, 3));
PLAYERS_2026.push(mkPlayer('TOR', 'Immanuel Quickley', 26, 74, 190, 'PG', 5, 5, 81, 83, 'playmaker', 25000000, 3));
PLAYERS_2026.push(mkPlayer('TOR', 'Jakob Poeltl', 30, 83, 245, 'C', 19, 8, 78, 78, 'rim_protector', 20000000, 2));
PLAYERS_2026.push(mkPlayer('TOR', 'Gradey Dick', 22, 78, 205, 'SG', 1, 2, 75, 82, 'three_and_d', 5200000, 2));
PLAYERS_2026.push(mkPlayer('TOR', 'Ochai Agbaji', 25, 78, 216, 'SG', 20, 3, 72, 75, 'three_and_d', 4200000, 2));
PLAYERS_2026.push(mkPlayer('TOR', 'Jamal Shead', 23, 73, 195, 'PG', 23, 1, 70, 77, 'playmaker', 2000000, 2));
PLAYERS_2026.push(mkPlayer('TOR', 'Collin Murray-Boyles', 20, 79, 241, 'PF', 22, 0, 68, 82, 'rim_protector', 6100000, 4));
PLAYERS_2026.push(mkPlayer('TOR', 'Ja\'Kobe Walter', 21, 77, 190, 'SG', 18, 1, 69, 78, 'slasher', 4200000, 3));
PLAYERS_2026.push(mkPlayer('TOR', 'Sandro Mamukelashvili', 26, 82, 242, 'PF', 54, 4, 68, 71, 'stretch_big', 3200000, 1));
PLAYERS_2026.push(mkPlayer('TOR', 'Jonathan Mogbo', 23, 80, 219, 'PF', 21, 1, 67, 75, 'raw_prospect', 2200000, 3));
PLAYERS_2026.push(mkPlayer('TOR', 'A.J. Lawson', 25, 78, 179, 'SG', 12, 2, 65, 69, 'slasher', 1900000, 1));
PLAYERS_2026.push(mkPlayer('TOR', 'Ulrich Chomche', 20, 83, 230, 'C', 35, 1, 62, 74, 'rim_protector', 2400000, 3));

// --- Central Division ---

// Chicago Bulls
PLAYERS_2026.push(mkPlayer('CHI', 'Josh Giddey', 23, 80, 216, 'PG', 3, 3, 82, 87, 'playmaker', 19400000, 3));
PLAYERS_2026.push(mkPlayer('CHI', 'Coby White', 25, 76, 195, 'PG', 0, 6, 82, 84, 'primary_scorer', 20000000, 3));
PLAYERS_2026.push(mkPlayer('CHI', 'Nikola Vucevic', 35, 83, 260, 'C', 9, 14, 78, 78, 'stretch_big', 21000000, 1));
PLAYERS_2026.push(mkPlayer('CHI', 'Matas Buzelis', 21, 81, 210, 'PF', 14, 1, 76, 87, 'slasher', 5200000, 3));
PLAYERS_2026.push(mkPlayer('CHI', 'Ayo Dosunmu', 25, 76, 200, 'SG', 12, 4, 76, 79, 'three_and_d', 8600000, 2));
PLAYERS_2026.push(mkPlayer('CHI', 'Patrick Williams', 24, 80, 220, 'PF', 44, 5, 74, 78, 'three_and_d', 18000000, 3));
PLAYERS_2026.push(mkPlayer('CHI', 'Kevin Huerter', 27, 79, 190, 'SG', 30, 8, 74, 75, 'three_and_d', 16000000, 2));
PLAYERS_2026.push(mkPlayer('CHI', 'Tre Jones', 25, 73, 185, 'PG', 33, 5, 72, 74, 'playmaker', 5300000, 1));
PLAYERS_2026.push(mkPlayer('CHI', 'Jalen Smith', 25, 82, 220, 'PF', 8, 5, 71, 73, 'stretch_big', 5500000, 2));
PLAYERS_2026.push(mkPlayer('CHI', 'Julian Phillips', 22, 80, 210, 'SF', 2, 2, 69, 77, 'three_and_d', 2100000, 2));
PLAYERS_2026.push(mkPlayer('CHI', 'Zach Collins', 28, 83, 250, 'C', 32, 7, 71, 72, 'rim_protector', 8600000, 1));
PLAYERS_2026.push(mkPlayer('CHI', 'Isaac Okoro', 24, 78, 225, 'SG', 35, 5, 71, 74, 'three_and_d', 11000000, 3));
PLAYERS_2026.push(mkPlayer('CHI', 'Noa Essengue', 19, 81, 210, 'PF', 13, 0, 65, 82, 'raw_prospect', 4100000, 3));

// Cleveland Cavaliers
PLAYERS_2026.push(mkPlayer('CLE', 'Donovan Mitchell', 29, 73, 205, 'SG', 45, 8, 92, 92, 'primary_scorer', 35000000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'Evan Mobley', 24, 83, 215, 'PF', 4, 4, 89, 93, 'rim_protector', 38000000, 5));
PLAYERS_2026.push(mkPlayer('CLE', 'Darius Garland', 26, 74, 192, 'PG', 10, 6, 85, 86, 'playmaker', 34000000, 3));
PLAYERS_2026.push(mkPlayer('CLE', 'Jarrett Allen', 27, 82, 243, 'C', 31, 8, 82, 82, 'rim_protector', 20000000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'De\'Andre Hunter', 28, 80, 221, 'SF', 12, 6, 80, 81, 'three_and_d', 22000000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'Max Strus', 29, 78, 215, 'SG', 1, 6, 76, 77, 'three_and_d', 16000000, 3));
PLAYERS_2026.push(mkPlayer('CLE', 'Ty Jerome', 28, 78, 195, 'PG', 2, 5, 76, 77, 'playmaker', 14000000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'Sam Merrill', 29, 77, 200, 'SG', 5, 4, 73, 74, 'three_and_d', 6000000, 3));
PLAYERS_2026.push(mkPlayer('CLE', 'Craig Porter Jr.', 24, 74, 195, 'PG', 9, 2, 68, 73, 'playmaker', 2100000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'Larry Nance Jr.', 32, 81, 235, 'PF', 22, 9, 70, 70, 'veteran_glue', 4000000, 1));
PLAYERS_2026.push(mkPlayer('CLE', 'Nae\'Qwan Tomlin', 23, 81, 200, 'PF', 25, 1, 67, 76, 'raw_prospect', 2000000, 2));
PLAYERS_2026.push(mkPlayer('CLE', 'Tyrese Proctor', 22, 76, 180, 'PG', 24, 1, 65, 74, 'three_and_d', 2000000, 3));
PLAYERS_2026.push(mkPlayer('CLE', 'Dean Wade', 28, 80, 220, 'PF', 32, 6, 68, 69, 'three_and_d', 6500000, 2));

// Detroit Pistons
PLAYERS_2026.push(mkPlayer('DET', 'Cade Cunningham', 24, 78, 220, 'PG', 2, 4, 91, 94, 'playmaker', 38000000, 4));
PLAYERS_2026.push(mkPlayer('DET', 'Jalen Duren', 22, 83, 250, 'C', 0, 3, 84, 89, 'rim_protector', 9200000, 3));
PLAYERS_2026.push(mkPlayer('DET', 'Ausar Thompson', 23, 79, 205, 'SF', 9, 2, 80, 87, 'slasher', 6800000, 2));
PLAYERS_2026.push(mkPlayer('DET', 'Jaden Ivey', 23, 76, 195, 'SG', 23, 3, 79, 85, 'slasher', 8300000, 2));
PLAYERS_2026.push(mkPlayer('DET', 'Tobias Harris', 33, 80, 226, 'PF', 12, 14, 78, 78, 'primary_scorer', 15000000, 1));
PLAYERS_2026.push(mkPlayer('DET', 'Duncan Robinson', 31, 80, 215, 'SF', 20, 6, 78, 78, 'three_and_d', 15000000, 3));
PLAYERS_2026.push(mkPlayer('DET', 'Ron Holland II', 20, 79, 205, 'SF', 7, 1, 72, 84, 'slasher', 4400000, 3));
PLAYERS_2026.push(mkPlayer('DET', 'Isaiah Stewart', 24, 81, 250, 'C', 28, 5, 75, 77, 'rim_protector', 17000000, 3));
PLAYERS_2026.push(mkPlayer('DET', 'Dennis Schroder', 32, 73, 172, 'PG', 17, 12, 76, 76, 'playmaker', 9000000, 1));
PLAYERS_2026.push(mkPlayer('DET', 'Caris LeVert', 31, 78, 205, 'SG', 22, 9, 75, 75, 'slasher', 7900000, 1));
PLAYERS_2026.push(mkPlayer('DET', 'Marcus Sasser', 24, 74, 195, 'PG', 25, 2, 68, 72, 'three_and_d', 2400000, 2));
PLAYERS_2026.push(mkPlayer('DET', 'Bobi Klintman', 22, 80, 216, 'PF', 4, 1, 66, 76, 'raw_prospect', 2200000, 2));
PLAYERS_2026.push(mkPlayer('DET', 'Paul Reed', 26, 80, 210, 'C', 44, 4, 69, 72, 'rim_protector', 7700000, 2));

// Indiana Pacers
PLAYERS_2026.push(mkPlayer('IND', 'Tyrese Haliburton', 25, 76, 185, 'PG', 0, 5, 89, 91, 'playmaker', 42000000, 4));
PLAYERS_2026.push(mkPlayer('IND', 'Pascal Siakam', 31, 81, 230, 'PF', 43, 9, 87, 87, 'primary_scorer', 39000000, 3));
PLAYERS_2026.push(mkPlayer('IND', 'Bennedict Mathurin', 23, 78, 210, 'SG', 32, 3, 82, 87, 'slasher', 8700000, 1));
PLAYERS_2026.push(mkPlayer('IND', 'Andrew Nembhard', 25, 76, 193, 'PG', 2, 3, 79, 82, 'playmaker', 18000000, 4));
PLAYERS_2026.push(mkPlayer('IND', 'Aaron Nesmith', 26, 78, 215, 'SF', 23, 5, 76, 78, 'three_and_d', 12000000, 3));
PLAYERS_2026.push(mkPlayer('IND', 'T.J. McConnell', 33, 73, 190, 'PG', 9, 10, 75, 75, 'playmaker', 9300000, 2));
PLAYERS_2026.push(mkPlayer('IND', 'Obi Toppin', 27, 80, 220, 'PF', 1, 5, 75, 76, 'slasher', 14000000, 2));
PLAYERS_2026.push(mkPlayer('IND', 'Jarace Walker', 22, 80, 243, 'PF', 5, 2, 72, 80, 'rim_protector', 6500000, 2));
PLAYERS_2026.push(mkPlayer('IND', 'Ben Sheppard', 24, 78, 190, 'SG', 26, 2, 69, 74, 'three_and_d', 2200000, 2));
PLAYERS_2026.push(mkPlayer('IND', 'Isaiah Jackson', 24, 82, 210, 'C', 22, 4, 71, 76, 'rim_protector', 3400000, 1));
PLAYERS_2026.push(mkPlayer('IND', 'Tony Bradley', 28, 83, 248, 'C', 13, 7, 64, 65, 'rim_protector', 2100000, 1));
PLAYERS_2026.push(mkPlayer('IND', 'Quenton Jackson', 26, 76, 200, 'PG', 7, 2, 65, 68, 'slasher', 1900000, 1));
PLAYERS_2026.push(mkPlayer('IND', 'Johnny Furphy', 20, 80, 195, 'SF', 25, 1, 66, 78, 'raw_prospect', 2000000, 3));

// Milwaukee Bucks
PLAYERS_2026.push(mkPlayer('MIL', 'Giannis Antetokounmpo', 31, 83, 243, 'PF', 34, 12, 97, 97, 'primary_scorer', 51000000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'Myles Turner', 29, 83, 250, 'C', 3, 10, 80, 80, 'rim_protector', 22000000, 3));
PLAYERS_2026.push(mkPlayer('MIL', 'Kevin Porter Jr.', 25, 76, 203, 'PG', 5, 6, 76, 78, 'playmaker', 8100000, 1));
PLAYERS_2026.push(mkPlayer('MIL', 'Kyle Kuzma', 30, 80, 221, 'PF', 8, 8, 77, 77, 'slasher', 18000000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'Gary Trent Jr.', 26, 77, 209, 'SG', 11, 7, 76, 77, 'three_and_d', 10000000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'Bobby Portis', 30, 81, 250, 'PF', 9, 10, 78, 78, 'stretch_big', 13000000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'AJ Green', 26, 76, 180, 'SG', 20, 4, 73, 75, 'three_and_d', 5100000, 3));
PLAYERS_2026.push(mkPlayer('MIL', 'Gary Harris', 31, 76, 210, 'SG', 14, 10, 71, 71, 'three_and_d', 6000000, 1));
PLAYERS_2026.push(mkPlayer('MIL', 'Ryan Rollins', 22, 75, 175, 'PG', 7, 2, 73, 79, 'playmaker', 4200000, 3));
PLAYERS_2026.push(mkPlayer('MIL', 'Cole Anthony', 25, 74, 185, 'PG', 21, 5, 74, 76, 'primary_scorer', 8200000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'Chris Livingston', 22, 78, 219, 'SF', 24, 2, 66, 72, 'slasher', 2100000, 2));
PLAYERS_2026.push(mkPlayer('MIL', 'Tyler Smith', 20, 80, 218, 'PF', 15, 0, 64, 78, 'raw_prospect', 3200000, 3));
PLAYERS_2026.push(mkPlayer('MIL', 'Jamaree Bouyea', 25, 74, 180, 'PG', 30, 2, 65, 69, 'playmaker', 1900000, 1));
PLAYERS_2026.push(mkPlayer('MIL', 'Taurean Prince', 31, 78, 218, 'SF', 12, 9, 70, 70, 'three_and_d', 5000000, 1));

// --- Southeast Division ---

// Atlanta Hawks
PLAYERS_2026.push(mkPlayer('ATL', 'Trae Young', 27, 73, 164, 'PG', 11, 7, 87, 87, 'playmaker', 43000000, 2));
PLAYERS_2026.push(mkPlayer('ATL', 'Jalen Johnson', 24, 80, 220, 'PF', 1, 4, 85, 90, 'slasher', 21000000, 4));
PLAYERS_2026.push(mkPlayer('ATL', 'Onyeka Okongwu', 25, 81, 240, 'C', 17, 5, 81, 84, 'rim_protector', 17000000, 4));
PLAYERS_2026.push(mkPlayer('ATL', 'Nickeil Alexander-Walker', 27, 77, 205, 'SG', 3, 6, 78, 79, 'three_and_d', 10500000, 3));
PLAYERS_2026.push(mkPlayer('ATL', 'Dyson Daniels', 22, 79, 199, 'SG', 5, 3, 80, 86, 'three_and_d', 8300000, 3));
PLAYERS_2026.push(mkPlayer('ATL', 'Zaccharie Risacher', 20, 81, 205, 'SF', 10, 1, 75, 87, 'three_and_d', 12300000, 3));
PLAYERS_2026.push(mkPlayer('ATL', 'Kristaps Porzingis', 30, 87, 240, 'C', 8, 10, 82, 82, 'stretch_big', 30000000, 2));
PLAYERS_2026.push(mkPlayer('ATL', 'Luke Kennard', 29, 78, 206, 'SG', 26, 8, 74, 74, 'three_and_d', 5500000, 1));
PLAYERS_2026.push(mkPlayer('ATL', 'Vit Krejci', 25, 80, 190, 'SF', 27, 3, 68, 73, 'three_and_d', 2200000, 2));
PLAYERS_2026.push(mkPlayer('ATL', 'Mouhamed Gueye', 22, 82, 210, 'PF', 18, 2, 68, 78, 'rim_protector', 2100000, 2));
PLAYERS_2026.push(mkPlayer('ATL', 'Asa Newell', 20, 81, 220, 'PF', 14, 0, 66, 80, 'raw_prospect', 4200000, 4));
PLAYERS_2026.push(mkPlayer('ATL', 'Nikola Djurisic', 21, 79, 200, 'SF', 21, 0, 64, 76, 'raw_prospect', 2000000, 2));

// Charlotte Hornets
PLAYERS_2026.push(mkPlayer('CHA', 'LaMelo Ball', 24, 79, 180, 'PG', 1, 5, 89, 91, 'playmaker', 36000000, 4));
PLAYERS_2026.push(mkPlayer('CHA', 'Brandon Miller', 23, 80, 200, 'SF', 24, 2, 82, 88, 'primary_scorer', 11700000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Miles Bridges', 27, 79, 225, 'PF', 0, 6, 79, 79, 'slasher', 24000000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Kon Knueppel', 20, 78, 200, 'SG', 8, 0, 76, 87, 'three_and_d', 8500000, 4));
PLAYERS_2026.push(mkPlayer('CHA', 'Ryan Kalkbrenner', 23, 84, 260, 'C', 22, 0, 72, 80, 'rim_protector', 2100000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Josh Green', 25, 77, 200, 'SG', 9, 5, 73, 76, 'three_and_d', 8900000, 3));
PLAYERS_2026.push(mkPlayer('CHA', 'Collin Sexton', 27, 73, 190, 'PG', 2, 7, 78, 78, 'primary_scorer', 19000000, 1));
PLAYERS_2026.push(mkPlayer('CHA', 'Tidjane Salaun', 20, 81, 220, 'PF', 10, 1, 68, 79, 'raw_prospect', 4600000, 3));
PLAYERS_2026.push(mkPlayer('CHA', 'Nick Richards', 27, 83, 245, 'C', 4, 5, 73, 74, 'rim_protector', 5000000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Moussa Diabate', 23, 81, 210, 'PF', 14, 3, 68, 74, 'raw_prospect', 1900000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Sion James', 22, 78, 210, 'SG', 13, 0, 64, 74, 'three_and_d', 2000000, 2));
PLAYERS_2026.push(mkPlayer('CHA', 'Liam McNeeley', 20, 79, 215, 'SF', 30, 0, 65, 78, 'raw_prospect', 3600000, 4));

// Miami Heat
PLAYERS_2026.push(mkPlayer('MIA', 'Bam Adebayo', 28, 81, 255, 'C', 13, 8, 87, 87, 'rim_protector', 34000000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Tyler Herro', 26, 77, 195, 'SG', 14, 6, 85, 85, 'primary_scorer', 31000000, 3));
PLAYERS_2026.push(mkPlayer('MIA', 'Andrew Wiggins', 30, 79, 197, 'SF', 22, 11, 79, 79, 'slasher', 26000000, 1));
PLAYERS_2026.push(mkPlayer('MIA', 'Norman Powell', 32, 76, 215, 'SG', 24, 10, 80, 80, 'primary_scorer', 21000000, 1));
PLAYERS_2026.push(mkPlayer('MIA', 'Davion Mitchell', 27, 74, 200, 'PG', 45, 4, 75, 77, 'three_and_d', 8600000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Kel\'el Ware', 22, 84, 230, 'C', 7, 1, 76, 86, 'stretch_big', 5300000, 3));
PLAYERS_2026.push(mkPlayer('MIA', 'Nikola Jovic', 22, 82, 220, 'SF', 5, 3, 74, 82, 'playmaker', 4200000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Pelle Larsson', 24, 76, 190, 'SG', 16, 1, 68, 74, 'three_and_d', 1900000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Jaime Jaquez Jr.', 24, 78, 225, 'SF', 11, 2, 75, 79, 'slasher', 3400000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Kyle Anderson', 32, 81, 230, 'SF', 23, 11, 68, 68, 'veteran_glue', 2100000, 1));
PLAYERS_2026.push(mkPlayer('MIA', 'Vladislav Goldin', 23, 84, 250, 'C', 50, 0, 66, 74, 'rim_protector', 1900000, 2));
PLAYERS_2026.push(mkPlayer('MIA', 'Haywood Highsmith', 28, 78, 220, 'SF', 20, 4, 68, 70, 'three_and_d', 4300000, 2));

// Orlando Magic
PLAYERS_2026.push(mkPlayer('ORL', 'Paolo Banchero', 23, 82, 250, 'PF', 5, 3, 89, 93, 'primary_scorer', 12200000, 4));
PLAYERS_2026.push(mkPlayer('ORL', 'Franz Wagner', 24, 81, 220, 'SF', 22, 4, 87, 89, 'slasher', 34000000, 5));
PLAYERS_2026.push(mkPlayer('ORL', 'Jalen Suggs', 24, 76, 205, 'PG', 4, 4, 81, 84, 'three_and_d', 22500000, 4));
PLAYERS_2026.push(mkPlayer('ORL', 'Desmond Bane', 27, 77, 215, 'SG', 1, 6, 85, 86, 'primary_scorer', 38000000, 4));
PLAYERS_2026.push(mkPlayer('ORL', 'Wendell Carter Jr.', 26, 82, 270, 'C', 34, 7, 76, 77, 'rim_protector', 13000000, 2));
PLAYERS_2026.push(mkPlayer('ORL', 'Jonathan Isaac', 28, 82, 230, 'PF', 44, 8, 75, 76, 'rim_protector', 17000000, 3));
PLAYERS_2026.push(mkPlayer('ORL', 'Anthony Black', 22, 78, 200, 'PG', 0, 2, 74, 82, 'playmaker', 6600000, 2));
PLAYERS_2026.push(mkPlayer('ORL', 'Tristan da Silva', 24, 80, 220, 'SF', 23, 1, 72, 78, 'three_and_d', 3700000, 3));
PLAYERS_2026.push(mkPlayer('ORL', 'Jett Howard', 22, 79, 205, 'SG', 13, 2, 68, 76, 'three_and_d', 4100000, 2));
PLAYERS_2026.push(mkPlayer('ORL', 'Goga Bitadze', 26, 83, 250, 'C', 35, 6, 71, 73, 'rim_protector', 6800000, 2));
PLAYERS_2026.push(mkPlayer('ORL', 'Noah Penda', 20, 79, 210, 'SF', 11, 0, 64, 77, 'raw_prospect', 3300000, 3));
PLAYERS_2026.push(mkPlayer('ORL', 'Tyus Jones', 29, 73, 196, 'PG', 21, 10, 76, 76, 'playmaker', 7300000, 1));

// Washington Wizards
PLAYERS_2026.push(mkPlayer('WAS', 'Bilal Coulibaly', 21, 80, 195, 'SG', 0, 2, 74, 84, 'three_and_d', 7900000, 3));
PLAYERS_2026.push(mkPlayer('WAS', 'Alex Sarr', 20, 84, 220, 'C', 20, 1, 73, 88, 'rim_protector', 12000000, 3));
PLAYERS_2026.push(mkPlayer('WAS', 'Bub Carrington', 20, 77, 180, 'PG', 8, 1, 71, 84, 'playmaker', 6300000, 3));
PLAYERS_2026.push(mkPlayer('WAS', 'Kyshawn George', 21, 80, 208, 'SF', 3, 1, 70, 82, 'three_and_d', 4200000, 3));
PLAYERS_2026.push(mkPlayer('WAS', 'CJ McCollum', 34, 76, 190, 'SG', 12, 12, 78, 78, 'primary_scorer', 30000000, 1));
PLAYERS_2026.push(mkPlayer('WAS', 'Khris Middleton', 34, 79, 222, 'SF', 22, 13, 77, 77, 'primary_scorer', 15000000, 1));
PLAYERS_2026.push(mkPlayer('WAS', 'Marvin Bagley III', 26, 82, 235, 'PF', 35, 7, 71, 71, 'slasher', 4200000, 1));
PLAYERS_2026.push(mkPlayer('WAS', 'Corey Kispert', 26, 79, 224, 'SF', 24, 4, 74, 76, 'three_and_d', 8300000, 2));
PLAYERS_2026.push(mkPlayer('WAS', 'Tristan Vukcevic', 22, 83, 220, 'C', 15, 1, 66, 76, 'stretch_big', 2100000, 2));
PLAYERS_2026.push(mkPlayer('WAS', 'Justin Champagnie', 24, 78, 210, 'SF', 11, 3, 67, 71, 'three_and_d', 2000000, 1));
PLAYERS_2026.push(mkPlayer('WAS', 'Cam Whitmore', 21, 78, 232, 'SF', 7, 2, 72, 82, 'slasher', 3600000, 2));
PLAYERS_2026.push(mkPlayer('WAS', 'Tre Johnson', 19, 78, 190, 'SG', 6, 0, 70, 85, 'primary_scorer', 10200000, 4));
PLAYERS_2026.push(mkPlayer('WAS', 'Will Riley', 19, 80, 190, 'SF', 21, 0, 65, 80, 'raw_prospect', 4600000, 4));

// --- Northwest Division ---

// Denver Nuggets
PLAYERS_2026.push(mkPlayer('DEN', 'Nikola Jokic', 30, 83, 284, 'C', 15, 10, 98, 98, 'playmaker', 55000000, 3));
PLAYERS_2026.push(mkPlayer('DEN', 'Jamal Murray', 28, 76, 215, 'PG', 27, 9, 87, 87, 'primary_scorer', 36000000, 2));
PLAYERS_2026.push(mkPlayer('DEN', 'Cameron Johnson', 29, 80, 210, 'SF', 1, 6, 80, 80, 'three_and_d', 22500000, 2));
PLAYERS_2026.push(mkPlayer('DEN', 'Aaron Gordon', 30, 80, 235, 'PF', 32, 11, 82, 82, 'slasher', 24000000, 2));
PLAYERS_2026.push(mkPlayer('DEN', 'Christian Braun', 24, 78, 220, 'SG', 0, 3, 78, 82, 'slasher', 8100000, 3));
PLAYERS_2026.push(mkPlayer('DEN', 'Jonas Valanciunas', 33, 83, 265, 'C', 17, 13, 74, 74, 'stretch_big', 10000000, 1));
PLAYERS_2026.push(mkPlayer('DEN', 'Tim Hardaway Jr.', 33, 78, 205, 'SG', 10, 11, 74, 74, 'three_and_d', 5000000, 1));
PLAYERS_2026.push(mkPlayer('DEN', 'Bruce Brown', 29, 77, 202, 'SG', 11, 6, 73, 73, 'slasher', 7200000, 1));
PLAYERS_2026.push(mkPlayer('DEN', 'Julian Strawther', 23, 78, 195, 'SG', 3, 2, 71, 78, 'three_and_d', 2200000, 2));
PLAYERS_2026.push(mkPlayer('DEN', 'Peyton Watson', 23, 80, 200, 'SF', 8, 3, 74, 82, 'slasher', 8700000, 3));
PLAYERS_2026.push(mkPlayer('DEN', 'Jalen Pickett', 25, 74, 200, 'PG', 22, 2, 66, 70, 'playmaker', 2100000, 1));
PLAYERS_2026.push(mkPlayer('DEN', 'DaRon Holmes II', 22, 81, 235, 'PF', 14, 1, 68, 78, 'rim_protector', 3600000, 2));

// Minnesota Timberwolves
PLAYERS_2026.push(mkPlayer('MIN', 'Anthony Edwards', 24, 76, 225, 'SG', 5, 5, 93, 96, 'primary_scorer', 42000000, 4));
PLAYERS_2026.push(mkPlayer('MIN', 'Julius Randle', 31, 80, 250, 'PF', 30, 11, 82, 82, 'primary_scorer', 30000000, 1));
PLAYERS_2026.push(mkPlayer('MIN', 'Rudy Gobert', 33, 85, 258, 'C', 27, 12, 82, 82, 'rim_protector', 24000000, 2));
PLAYERS_2026.push(mkPlayer('MIN', 'Jaden McDaniels', 25, 81, 200, 'SF', 3, 5, 81, 84, 'three_and_d', 24000000, 4));
PLAYERS_2026.push(mkPlayer('MIN', 'Mike Conley', 38, 73, 175, 'PG', 10, 18, 72, 72, 'playmaker', 10000000, 1));
PLAYERS_2026.push(mkPlayer('MIN', 'Naz Reid', 26, 81, 264, 'C', 11, 6, 79, 80, 'stretch_big', 15000000, 3));
PLAYERS_2026.push(mkPlayer('MIN', 'Donte DiVincenzo', 28, 76, 203, 'SG', 0, 7, 78, 78, 'three_and_d', 10800000, 2));
PLAYERS_2026.push(mkPlayer('MIN', 'Jaylen Clark', 23, 76, 205, 'SG', 15, 2, 68, 75, 'three_and_d', 2100000, 2));
PLAYERS_2026.push(mkPlayer('MIN', 'Terrence Shannon Jr.', 24, 78, 215, 'SG', 8, 1, 72, 80, 'slasher', 3200000, 3));
PLAYERS_2026.push(mkPlayer('MIN', 'Rob Dillingham', 20, 74, 165, 'PG', 4, 1, 70, 84, 'playmaker', 6800000, 3));
PLAYERS_2026.push(mkPlayer('MIN', 'Joe Ingles', 38, 80, 226, 'SF', 7, 12, 65, 65, 'veteran_glue', 2100000, 1));
PLAYERS_2026.push(mkPlayer('MIN', 'Leonard Miller', 22, 81, 225, 'PF', 18, 2, 66, 76, 'raw_prospect', 2100000, 2));

// Oklahoma City Thunder
PLAYERS_2026.push(mkPlayer('OKC', 'Shai Gilgeous-Alexander', 27, 78, 195, 'PG', 2, 6, 97, 97, 'primary_scorer', 40000000, 4));
PLAYERS_2026.push(mkPlayer('OKC', 'Chet Holmgren', 23, 84, 208, 'C', 7, 2, 89, 94, 'rim_protector', 12500000, 3));
PLAYERS_2026.push(mkPlayer('OKC', 'Jalen Williams', 24, 78, 211, 'SF', 8, 3, 88, 92, 'slasher', 10000000, 3));
PLAYERS_2026.push(mkPlayer('OKC', 'Luguentz Dort', 26, 76, 220, 'SG', 5, 5, 79, 80, 'three_and_d', 20500000, 3));
PLAYERS_2026.push(mkPlayer('OKC', 'Isaiah Hartenstein', 27, 84, 250, 'C', 55, 6, 78, 78, 'rim_protector', 15000000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Cason Wallace', 22, 76, 193, 'SG', 22, 2, 76, 83, 'three_and_d', 5300000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Aaron Wiggins', 27, 78, 200, 'SG', 21, 4, 74, 76, 'three_and_d', 8200000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Alex Caruso', 31, 76, 186, 'SG', 9, 8, 79, 79, 'three_and_d', 10000000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Ajay Mitchell', 23, 77, 200, 'PG', 3, 1, 73, 81, 'playmaker', 2200000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Jaylin Williams', 23, 81, 240, 'PF', 6, 3, 72, 78, 'rim_protector', 4400000, 2));
PLAYERS_2026.push(mkPlayer('OKC', 'Kenrich Williams', 30, 78, 210, 'PF', 34, 6, 70, 70, 'veteran_glue', 7300000, 1));
PLAYERS_2026.push(mkPlayer('OKC', 'Nikola Topic', 20, 77, 200, 'PG', 17, 0, 68, 82, 'raw_prospect', 8900000, 4));
PLAYERS_2026.push(mkPlayer('OKC', 'Thomas Sorber', 20, 82, 260, 'C', 33, 0, 66, 79, 'rim_protector', 4200000, 4));

// Portland Trail Blazers
PLAYERS_2026.push(mkPlayer('POR', 'Deni Avdija', 24, 80, 210, 'SF', 8, 5, 83, 87, 'slasher', 32000000, 4));
PLAYERS_2026.push(mkPlayer('POR', 'Scoot Henderson', 21, 74, 195, 'PG', 0, 2, 76, 87, 'playmaker', 12200000, 2));
PLAYERS_2026.push(mkPlayer('POR', 'Shaedon Sharpe', 22, 77, 200, 'SG', 17, 3, 79, 88, 'slasher', 13600000, 4));
PLAYERS_2026.push(mkPlayer('POR', 'Jerami Grant', 31, 80, 210, 'PF', 9, 10, 78, 78, 'primary_scorer', 30000000, 2));
PLAYERS_2026.push(mkPlayer('POR', 'Toumani Camara', 25, 79, 220, 'SF', 33, 2, 74, 79, 'three_and_d', 8000000, 3));
PLAYERS_2026.push(mkPlayer('POR', 'Donovan Clingan', 21, 85, 280, 'C', 32, 1, 76, 88, 'rim_protector', 10200000, 3));
PLAYERS_2026.push(mkPlayer('POR', 'Jrue Holiday', 35, 76, 205, 'PG', 4, 15, 80, 80, 'three_and_d', 32000000, 2));
PLAYERS_2026.push(mkPlayer('POR', 'Robert Williams III', 28, 81, 237, 'C', 44, 7, 73, 74, 'rim_protector', 10000000, 1));
PLAYERS_2026.push(mkPlayer('POR', 'Kris Murray', 24, 79, 215, 'SF', 20, 2, 66, 72, 'three_and_d', 2200000, 2));
PLAYERS_2026.push(mkPlayer('POR', 'Jabari Walker', 22, 80, 220, 'PF', 34, 3, 67, 73, 'slasher', 2100000, 2));
PLAYERS_2026.push(mkPlayer('POR', 'Duop Reath', 26, 82, 230, 'C', 13, 2, 65, 69, 'stretch_big', 2000000, 1));
PLAYERS_2026.push(mkPlayer('POR', 'Sidy Cissoko', 21, 78, 205, 'SG', 15, 2, 65, 74, 'slasher', 2000000, 2));

// Utah Jazz
PLAYERS_2026.push(mkPlayer('UTA', 'Lauri Markkanen', 28, 84, 240, 'PF', 23, 8, 85, 85, 'primary_scorer', 30000000, 3));
PLAYERS_2026.push(mkPlayer('UTA', 'Keyonte George', 22, 76, 185, 'PG', 3, 2, 76, 84, 'playmaker', 4600000, 2));
PLAYERS_2026.push(mkPlayer('UTA', 'Walker Kessler', 24, 84, 245, 'C', 24, 3, 78, 84, 'rim_protector', 8000000, 3));
PLAYERS_2026.push(mkPlayer('UTA', 'Ace Bailey', 19, 81, 200, 'SF', 5, 0, 72, 88, 'slasher', 11500000, 4));
PLAYERS_2026.push(mkPlayer('UTA', 'Isaiah Collier', 20, 75, 210, 'PG', 1, 1, 68, 80, 'playmaker', 4300000, 3));
PLAYERS_2026.push(mkPlayer('UTA', 'Svi Mykhailiuk', 28, 78, 205, 'SG', 19, 7, 68, 68, 'three_and_d', 2100000, 1));
PLAYERS_2026.push(mkPlayer('UTA', 'Taylor Hendricks', 21, 81, 210, 'PF', 0, 2, 70, 82, 'stretch_big', 6600000, 2));
PLAYERS_2026.push(mkPlayer('UTA', 'Brice Sensabaugh', 21, 78, 235, 'SF', 13, 2, 68, 76, 'primary_scorer', 2600000, 2));
PLAYERS_2026.push(mkPlayer('UTA', 'Jusuf Nurkic', 31, 83, 290, 'C', 27, 11, 68, 68, 'rim_protector', 8100000, 1));
PLAYERS_2026.push(mkPlayer('UTA', 'John Collins', 28, 81, 226, 'PF', 20, 8, 73, 73, 'slasher', 26500000, 1));
PLAYERS_2026.push(mkPlayer('UTA', 'Kyle Filipowski', 21, 83, 248, 'C', 22, 1, 68, 78, 'stretch_big', 3200000, 2));
PLAYERS_2026.push(mkPlayer('UTA', 'Cody Williams', 21, 80, 190, 'SF', 12, 1, 65, 78, 'raw_prospect', 4900000, 3));

// --- Pacific Division ---

// Golden State Warriors
PLAYERS_2026.push(mkPlayer('GSW', 'Stephen Curry', 37, 75, 185, 'PG', 30, 16, 92, 92, 'primary_scorer', 55000000, 1));
PLAYERS_2026.push(mkPlayer('GSW', 'Jimmy Butler', 36, 79, 230, 'SF', 10, 14, 87, 87, 'slasher', 48000000, 1));
PLAYERS_2026.push(mkPlayer('GSW', 'Draymond Green', 35, 79, 230, 'PF', 23, 13, 79, 79, 'playmaker', 24000000, 2));
PLAYERS_2026.push(mkPlayer('GSW', 'Jonathan Kuminga', 23, 80, 210, 'PF', 0, 3, 79, 87, 'slasher', 7900000, 1));
PLAYERS_2026.push(mkPlayer('GSW', 'Brandin Podziemski', 22, 76, 205, 'SG', 2, 2, 76, 83, 'playmaker', 3300000, 2));
PLAYERS_2026.push(mkPlayer('GSW', 'Moses Moody', 23, 78, 215, 'SG', 4, 4, 76, 81, 'three_and_d', 12700000, 3));
PLAYERS_2026.push(mkPlayer('GSW', 'Buddy Hield', 32, 76, 214, 'SG', 7, 9, 76, 76, 'three_and_d', 8200000, 1));
PLAYERS_2026.push(mkPlayer('GSW', 'Quinten Post', 23, 84, 245, 'C', 21, 1, 68, 76, 'stretch_big', 1900000, 2));
PLAYERS_2026.push(mkPlayer('GSW', 'Gui Santos', 23, 79, 200, 'SF', 20, 2, 65, 72, 'slasher', 1900000, 2));
PLAYERS_2026.push(mkPlayer('GSW', 'De\'Anthony Melton', 27, 74, 200, 'PG', 8, 6, 73, 74, 'three_and_d', 8000000, 1));
PLAYERS_2026.push(mkPlayer('GSW', 'Will Richard', 22, 76, 195, 'SG', 43, 0, 65, 74, 'three_and_d', 1900000, 3));
PLAYERS_2026.push(mkPlayer('GSW', 'Pat Spencer', 27, 74, 185, 'PG', 55, 1, 62, 65, 'playmaker', 1900000, 1));

// LA Clippers
PLAYERS_2026.push(mkPlayer('LAC', 'Kawhi Leonard', 34, 79, 225, 'SF', 2, 13, 87, 87, 'three_and_d', 49000000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'James Harden', 36, 77, 220, 'PG', 1, 16, 85, 85, 'playmaker', 36000000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Ivica Zubac', 28, 84, 240, 'C', 40, 8, 82, 82, 'rim_protector', 21000000, 3));
PLAYERS_2026.push(mkPlayer('LAC', 'Brook Lopez', 37, 84, 282, 'C', 11, 17, 74, 74, 'rim_protector', 6900000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Derrick Jones Jr.', 28, 78, 210, 'SF', 55, 6, 76, 76, 'three_and_d', 12500000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Kris Dunn', 31, 76, 205, 'PG', 3, 9, 74, 74, 'three_and_d', 5300000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Bogdan Bogdanovic', 33, 78, 225, 'SG', 8, 9, 75, 75, 'three_and_d', 6900000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Nicolas Batum', 36, 80, 230, 'SF', 33, 17, 68, 68, 'veteran_glue', 3300000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Chris Paul', 40, 73, 175, 'PG', 21, 20, 70, 70, 'playmaker', 3600000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Kobe Sanders', 24, 79, 190, 'SG', 20, 0, 64, 74, 'raw_prospect', 2000000, 2));
PLAYERS_2026.push(mkPlayer('LAC', 'Brandon Boston Jr.', 24, 78, 188, 'SG', 25, 3, 68, 74, 'slasher', 2100000, 1));
PLAYERS_2026.push(mkPlayer('LAC', 'Yanic Konan Niederhauser', 24, 84, 245, 'C', 26, 0, 63, 72, 'rim_protector', 1900000, 2));

// Los Angeles Lakers
PLAYERS_2026.push(mkPlayer('LAL', 'Luka Doncic', 26, 79, 230, 'PG', 77, 7, 96, 96, 'playmaker', 43000000, 3));
PLAYERS_2026.push(mkPlayer('LAL', 'LeBron James', 41, 81, 250, 'SF', 23, 22, 91, 91, 'playmaker', 52000000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Austin Reaves', 27, 77, 197, 'SG', 15, 4, 84, 86, 'playmaker', 14000000, 2));
PLAYERS_2026.push(mkPlayer('LAL', 'Deandre Ayton', 27, 83, 250, 'C', 5, 7, 79, 80, 'stretch_big', 16600000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Rui Hachimura', 27, 80, 230, 'PF', 28, 6, 78, 78, 'slasher', 17000000, 3));
PLAYERS_2026.push(mkPlayer('LAL', 'Marcus Smart', 31, 76, 220, 'PG', 36, 11, 76, 76, 'three_and_d', 12000000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Jarred Vanderbilt', 26, 79, 214, 'PF', 2, 7, 73, 74, 'rim_protector', 10700000, 2));
PLAYERS_2026.push(mkPlayer('LAL', 'Gabe Vincent', 29, 74, 200, 'PG', 7, 6, 72, 72, 'three_and_d', 7600000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Jaxson Hayes', 25, 83, 220, 'C', 11, 6, 71, 74, 'rim_protector', 4300000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Jake LaRavia', 23, 79, 235, 'SF', 12, 3, 71, 78, 'slasher', 6200000, 3));
PLAYERS_2026.push(mkPlayer('LAL', 'Maxi Kleber', 33, 82, 240, 'PF', 42, 8, 68, 68, 'stretch_big', 3300000, 1));
PLAYERS_2026.push(mkPlayer('LAL', 'Dalton Knecht', 24, 78, 213, 'SG', 4, 1, 73, 80, 'three_and_d', 3300000, 2));
PLAYERS_2026.push(mkPlayer('LAL', 'Bronny James', 21, 75, 210, 'PG', 9, 1, 64, 72, 'slasher', 2100000, 2));

// Phoenix Suns
PLAYERS_2026.push(mkPlayer('PHX', 'Devin Booker', 29, 77, 206, 'SG', 1, 10, 90, 90, 'primary_scorer', 49000000, 3));
PLAYERS_2026.push(mkPlayer('PHX', 'Jalen Green', 23, 77, 186, 'SG', 23, 4, 80, 85, 'slasher', 30000000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Dillon Brooks', 29, 77, 225, 'SF', 9, 8, 78, 78, 'three_and_d', 22500000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Mark Williams', 24, 84, 242, 'C', 5, 3, 78, 84, 'rim_protector', 8900000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Grayson Allen', 30, 76, 198, 'SG', 8, 7, 78, 78, 'three_and_d', 15800000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Royce O\'Neale', 32, 78, 226, 'SF', 44, 9, 74, 74, 'three_and_d', 9600000, 1));
PLAYERS_2026.push(mkPlayer('PHX', 'Collin Gillespie', 25, 74, 185, 'PG', 2, 2, 70, 74, 'playmaker', 2100000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Ryan Dunn', 21, 79, 210, 'SF', 28, 1, 71, 82, 'three_and_d', 3200000, 3));
PLAYERS_2026.push(mkPlayer('PHX', 'Oso Ighodaro', 22, 82, 235, 'C', 25, 1, 68, 76, 'rim_protector', 2200000, 2));
PLAYERS_2026.push(mkPlayer('PHX', 'Jordan Goodwin', 26, 75, 195, 'PG', 3, 3, 68, 71, 'slasher', 2100000, 1));
PLAYERS_2026.push(mkPlayer('PHX', 'Rasheer Fleming', 21, 81, 225, 'PF', 32, 0, 65, 78, 'raw_prospect', 3800000, 4));
PLAYERS_2026.push(mkPlayer('PHX', 'Koby Brea', 23, 78, 200, 'SG', 4, 0, 64, 71, 'three_and_d', 1900000, 2));

// Sacramento Kings
PLAYERS_2026.push(mkPlayer('SAC', 'Zach LaVine', 30, 77, 200, 'SG', 8, 11, 82, 82, 'primary_scorer', 43000000, 2));
PLAYERS_2026.push(mkPlayer('SAC', 'Domantas Sabonis', 29, 83, 240, 'C', 10, 9, 87, 87, 'rim_protector', 42000000, 3));
PLAYERS_2026.push(mkPlayer('SAC', 'Malik Monk', 27, 75, 200, 'SG', 0, 8, 79, 79, 'primary_scorer', 19800000, 2));
PLAYERS_2026.push(mkPlayer('SAC', 'Keegan Murray', 25, 80, 224, 'SF', 13, 3, 78, 82, 'three_and_d', 7300000, 2));
PLAYERS_2026.push(mkPlayer('SAC', 'Devin Carter', 23, 75, 195, 'SG', 2, 1, 71, 82, 'three_and_d', 4400000, 3));
PLAYERS_2026.push(mkPlayer('SAC', 'Maxime Raynaud', 22, 84, 235, 'C', 30, 0, 66, 78, 'stretch_big', 2000000, 3));
PLAYERS_2026.push(mkPlayer('SAC', 'Nique Clifford', 23, 78, 210, 'SG', 5, 0, 65, 76, 'slasher', 2000000, 2));
PLAYERS_2026.push(mkPlayer('SAC', 'Trey Lyles', 29, 81, 234, 'PF', 41, 10, 68, 68, 'stretch_big', 2400000, 1));
PLAYERS_2026.push(mkPlayer('SAC', 'Isaac Jones', 23, 80, 220, 'PF', 15, 1, 65, 73, 'raw_prospect', 1900000, 2));
PLAYERS_2026.push(mkPlayer('SAC', 'Precious Achiuwa', 26, 80, 243, 'PF', 55, 6, 71, 73, 'rim_protector', 6000000, 1));
PLAYERS_2026.push(mkPlayer('SAC', 'DeMar DeRozan', 36, 79, 220, 'SF', 6, 16, 79, 79, 'primary_scorer', 24000000, 1));
PLAYERS_2026.push(mkPlayer('SAC', 'Doug McDermott', 33, 80, 225, 'SF', 17, 11, 71, 71, 'three_and_d', 3300000, 1));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLAYERS_2026: PLAYERS_2026 };
}
