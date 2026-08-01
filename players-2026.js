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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLAYERS_2026: PLAYERS_2026 };
}
