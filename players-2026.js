// In Node (used only by scripts/validate-data.js) this file is its own module
// scope, so the globals data.js defines via classic <script> tags in the
// browser aren't visible here automatically — pull them in explicitly via a
// distinctly-named local (`_DATA`), not by redeclaring ATTRIBUTE_KEYS/etc.
// directly, since re-declaring an identifier that's already a page-global
// `const` from an earlier <script> tag would be a SyntaxError in the browser.
var _DATA = (typeof require !== 'undefined')
  ? Object.assign({}, require('./data.js'), {
      makeRng: require('./rng.js').makeRng,
      defineOverall: require('./ratings.js').defineOverall
    })
  : {
      ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX,
      makeRng: makeRng, defineOverall: defineOverall
    };

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

// The ~450 hand-picked (overall, archetype) judgments in this file are the
// ANCHOR, not the whole player. `overall` positions him on the curve and the
// archetype gives him a shape; deterministic per-attribute variation, seeded
// from his own id, makes him an individual.
//
// This used to be, in full, `attrs[key] = overall + offsets[key]`. That gave
// the league SEVENTEEN distinct attribute shapes across 380 players — the 8
// archetypes plus 9 single-player clamp artifacts — so two players with the
// same overall and archetype were byte-identical, and `threePoint minus
// insideScoring`, the number that governs shot mix, took 9 distinct values
// league-wide. Every compressed spread in identity-baseline.txt (3PA share
// over 13 points against the NBA's 67, shot volume 1.44x against 2.9x) is
// downstream of that, not a separate problem.
//
// Three sources of variance, each doing a different job:
//   SCALE_SD    - between players. How far apart a star and a scrub are.
//   OFFSET_AMP  - between archetypes. Why a rim protector cannot shoot.
//   JITTER_SD   - within an archetype. Why two rim protectors differ.
// All three calibrated by measured rate against scripts/measure-identity.js;
// the sweep is in the commit that introduced them.
const OLD_MEAN = 74.67, OLD_SD = 7.60;   // measured over the 450 authored `overall` values
const SCALE_MEAN = 50, SCALE_SD = 9;
const OFFSET_AMP = 2.4;
// How an authored headroom (`potential - overall`, written on the old scale)
// converts to the new one. Exported so draftProspects.js expresses a
// prospect's ceiling the same way.
const ANCHOR_SD_RATIO = SCALE_SD / OLD_SD;
const JITTER_SD = 6;

// Deterministic string -> uint32, same shape as traits.js's hashId, so a
// player's attributes are a pure function of his id and survive a reload,
// a save, and a golden-master regeneration.
function attrHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Box-Muller. The jitter has to be normal rather than flat: a flat jitter
// would put as many players at +2sd on a skill as at their own mean, which
// reads as noise instead of as a player having a strength.
function gauss(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// `potential` is authored on the same 62-98 scale the old `overall` used, and
// progression pulls young players toward it via `potential - overall`. Once
// overall is derived from the rescaled attributes (ratings.js) that gap would
// be ~30 points for every player in the league instead of ~3-20, and everyone
// would develop like a lottery pick. Mapped through the same affine transform
// as the attribute anchor so the two stay commensurate.
function rescaleAnchor(v) {
  return Math.max(_DATA.RATING_MIN, Math.min(_DATA.RATING_MAX,
    Math.round(SCALE_MEAN + ((v - OLD_MEAN) / OLD_SD) * SCALE_SD)));
}

// `offsetTable` lets draftProspects.js reuse this generator with its own
// archetype offsets — the offsets are allowed to diverge, the SCALE is not.
function makeAttributes(overall, archetype, playerId, offsetTable) {
  const offsets = (offsetTable || ARCHETYPES)[archetype] || {};
  const rng = _DATA.makeRng(attrHash(playerId));
  const z = (overall - OLD_MEAN) / OLD_SD;
  const attrs = {};
  _DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = SCALE_MEAN + z * SCALE_SD
      + (offsets[key] || 0) * OFFSET_AMP
      + gauss(rng) * JITTER_SD;
    attrs[key] = Math.max(_DATA.RATING_MIN, Math.min(_DATA.RATING_MAX, Math.round(raw)));
  });
  return attrs;
}

function pid(teamId, name) {
  return teamId.toLowerCase() + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mkPlayer(teamId, name, age, heightIn, weightLb, position, jerseyNumber, yearsPro, overall, potential, archetype, salary, yearsRemaining, opts) {
  opts = opts || {};
  // Auto-lookup college and dateOfBirth from mapping if not explicitly provided
  const autoData = PLAYER_DATA_MAP[name] || {};
  const player = {
    id: pid(teamId, name),
    teamId: teamId,
    name: name,
    age: age,
    heightIn: heightIn,
    weightLb: weightLb,
    position: position,
    jerseyNumber: jerseyNumber,
    yearsPro: yearsPro,
    // No `overall` field. It is a derived getter installed by
    // ratings.js's defineOverall at the bottom of this function — the
    // authored `overall` argument survives only as the anchor makeAttributes
    // positions the player with.
    //
    // `potential` is set below rather than here, because it has to be at least
    // the derived overall and the getter does not exist until defineOverall
    // has run.
    potential: 0,
    contract: {
      salary: salary,
      yearsRemaining: yearsRemaining,
      playerOption: !!opts.playerOption,
      teamOption: !!opts.teamOption
    },
    status: { morale: opts.morale || 70, fatigue: 0, injury: null },
    // Kept on the player rather than discarded after generation: it is the
    // shape half of the (overall, archetype) judgment, and without it there
    // is no way to measure whether the 8 archetypes still read as distinct
    // roles once per-player variation is layered on top of them.
    archetype: archetype,
    attributes: makeAttributes(overall, archetype, pid(teamId, name)),
    hiddenTraits: [],
    hiddenPersonality: {},
    hiddenTendencies: {},
    college: opts.college || autoData.college || null,
    dateOfBirth: opts.dateOfBirth || autoData.dateOfBirth || null
  };
  _DATA.defineOverall(player);
  // Potential is the authored HEADROOM re-expressed on the new scale, not the
  // authored level. Mapping the absolute value instead looked right and was
  // wrong: overall is now a regression while potential was an affine map, so
  // the two agreed in distribution but crossed for individual players, and
  // clamping that away with a max() collapsed the gap to ~0 for most of the
  // league. progression.js pulls young players by `potential - overall`, so a
  // zero gap means nobody develops — three development validators caught it.
  //
  // Scaling the gap by SCALE_SD / OLD_SD keeps a 10-point authored ceiling
  // worth the same fraction of a standard deviation as the author intended,
  // and potential >= rawOverall then holds by construction.
  //
  // rawOverall, NOT overall. `potential` is STORED RAW — progression pulls
  // players by `potential - rawOverall`, and every save already holds the raw
  // value. Building it from the display value inflates every player's ceiling
  // by ~19 points, which then feeds trait generation through pickPositiveTier's
  // skill term and the superstar gate.
  player.potential = Math.max(_DATA.RATING_MIN, Math.min(_DATA.RATING_MAX,
    player.rawOverall + Math.round(Math.max(0, potential - overall) * ANCHOR_SD_RATIO)));
  return player;
}

// Player college and birth date mappings for real NBA players
// Format: "FirstName LastName" => { college: "University", dateOfBirth: "YYYY-MM-DD" }
const PLAYER_DATA_MAP = {
  'Jayson Tatum': { college: 'Duke', dateOfBirth: '1998-12-23' },
  'Jaylen Brown': { college: 'California', dateOfBirth: '1996-10-24' },
  'Derrick White': { college: 'Colorado', dateOfBirth: '1994-07-03' },
  'Payton Pritchard': { college: 'Oregon', dateOfBirth: '1998-08-07' },
  'Anfernee Simons': { college: 'Louisville', dateOfBirth: '1999-04-25' },
  'Al Horford': { college: 'Florida', dateOfBirth: '1986-06-03' },
  'Sam Hauser': { college: 'Marquette', dateOfBirth: '1998-01-27' },
  'Luke Kornet': { college: 'Vanderbilt', dateOfBirth: '1995-07-02' },
  'Neemias Queta': { college: 'Utah State', dateOfBirth: '1999-08-30' },
  'Baylor Scheierman': { college: 'Creighton', dateOfBirth: '2002-11-08' },
  'Jordan Walsh': { college: 'Boston College', dateOfBirth: '2004-06-17' },
  'Xavier Tillman': { college: 'Michigan State', dateOfBirth: '1999-05-14' },
  'JD Davison': { college: 'Alabama', dateOfBirth: '2003-02-07' },
  'Josh Minott': { college: 'Memphis', dateOfBirth: '2003-10-17' },
  'Cam Thomas': { college: 'LSU', dateOfBirth: '2001-12-05' },
  'Michael Porter Jr.': { college: 'Missouri', dateOfBirth: '1998-06-29' },
  'Nic Claxton': { college: 'Georgia', dateOfBirth: '1999-12-28' },
  'Ziaire Williams': { college: 'Stanford', dateOfBirth: '2002-10-16' },
  'Jalen Brunson': { college: 'Villanova', dateOfBirth: '1996-11-24' },
  'Karl-Anthony Towns': { college: 'Kentucky', dateOfBirth: '1996-11-15' },
  'OG Anunoby': { college: 'Indiana', dateOfBirth: '1997-09-17' },
  'Mikal Bridges': { college: 'Villanova', dateOfBirth: '1996-08-31' },
  'Josh Hart': { college: 'Villanova', dateOfBirth: '1995-04-06' },
  'Joel Embiid': { college: 'Kansas', dateOfBirth: '1994-03-16' },
  'Tyrese Maxey': { college: 'Kentucky', dateOfBirth: '2000-11-04' },
  'Paul George': { college: 'San Diego State', dateOfBirth: '1990-05-02' },
  'Scottie Barnes': { college: 'Florida State', dateOfBirth: '2001-08-01' },
  'Brandon Ingram': { college: 'Duke', dateOfBirth: '1997-11-02' },
  'RJ Barrett': { college: 'Duke', dateOfBirth: '2000-06-14' },
  'Immanuel Quickley': { college: 'Kentucky', dateOfBirth: '2000-09-23' },
  'Josh Giddey': { college: 'Melbourne United', dateOfBirth: '2003-10-10' },
  'Coby White': { college: 'North Carolina', dateOfBirth: '2000-02-16' },
  'Donovan Mitchell': { college: 'Louisville', dateOfBirth: '1996-09-07' },
  'Evan Mobley': { college: 'USC', dateOfBirth: '2001-06-16' },
  'Darius Garland': { college: 'Vanderbilt', dateOfBirth: '2000-01-26' },
  'Cade Cunningham': { college: 'Oklahoma State', dateOfBirth: '2001-09-25' },
  'Jalen Duren': { college: 'Memphis', dateOfBirth: '2003-02-18' },
  'Tyrese Haliburton': { college: 'Iowa State', dateOfBirth: '2000-02-29' },
  'Pascal Siakam': { college: 'New Mexico State', dateOfBirth: '1994-04-02' },
  'Giannis Antetokounmpo': { college: 'Filathlitikos', dateOfBirth: '1994-12-06' },
  'Trae Young': { college: 'Oklahoma', dateOfBirth: '1998-09-19' },
  'Jalen Johnson': { college: 'North Carolina', dateOfBirth: '2001-07-28' },
  'LaMelo Ball': { college: 'Illawarra Hawks', dateOfBirth: '2001-08-22' },
  'Brandon Miller': { college: 'Alabama', dateOfBirth: '2003-10-01' },
  'Bam Adebayo': { college: 'Kentucky', dateOfBirth: '1997-07-09' },
  'Tyler Herro': { college: 'Kentucky', dateOfBirth: '2000-01-14' },
  'Paolo Banchero': { college: 'Duke', dateOfBirth: '2002-11-06' },
  'Franz Wagner': { college: 'Germany (pro)', dateOfBirth: '2001-09-04' },
  'Jalen Suggs': { college: 'Gonzaga', dateOfBirth: '2001-03-03' },
  'Nikola Jokic': { college: 'ŽAK Ćukarički', dateOfBirth: '1995-11-13' },
  'Jamal Murray': { college: 'Kentucky', dateOfBirth: '1997-02-23' },
  'Anthony Edwards': { college: 'Georgia', dateOfBirth: '2001-08-05' },
  'Shai Gilgeous-Alexander': { college: 'Kentucky', dateOfBirth: '1998-07-26' },
  'Chet Holmgren': { college: 'Gonzaga', dateOfBirth: '2002-05-05' },
  'Deni Avdija': { college: 'Hapoel Tel Aviv', dateOfBirth: '2001-01-03' },
  'Lauri Markkanen': { college: 'Arizona', dateOfBirth: '1997-09-20' },
  'Stephen Curry': { college: 'Davidson', dateOfBirth: '1988-03-14' },
  'Jimmy Butler': { college: 'Marquette', dateOfBirth: '1989-09-14' },
  'Kawhi Leonard': { college: 'San Diego State', dateOfBirth: '1991-06-29' },
  'James Harden': { college: 'Arizona State', dateOfBirth: '1989-08-23' },
  'Luka Doncic': { college: 'Real Madrid', dateOfBirth: '1999-02-28' },
  'LeBron James': { college: 'St. Vincent–St. Mary', dateOfBirth: '1984-12-30' },
  'Devin Booker': { college: 'Kentucky', dateOfBirth: '1996-10-30' },
  'Jalen Green': { college: 'NBA G League', dateOfBirth: '2002-02-09' },
  'Zach LaVine': { college: 'UCLA', dateOfBirth: '1996-03-10' },
  'Domantas Sabonis': { college: 'Gonzaga', dateOfBirth: '1994-05-13' },
  'Anthony Davis': { college: 'Kentucky', dateOfBirth: '1993-03-11' },
  'Kyrie Irving': { college: 'Duke', dateOfBirth: '1992-03-23' },
  'Kevin Durant': { college: 'Texas', dateOfBirth: '1988-09-29' },
  'Alperen Sengun': { college: 'Besiktas', dateOfBirth: '2002-07-25' },
  'Ja Morant': { college: 'Murray State', dateOfBirth: '1999-08-10' },
  'Jaren Jackson Jr.': { college: 'Michigan State', dateOfBirth: '1999-09-17' },
  'Zion Williamson': { college: 'Duke', dateOfBirth: '2000-07-06' },
  'Trey Murphy III': { college: 'Virginia', dateOfBirth: '2000-04-14' },
  'Victor Wembanyama': { college: 'ASVEL', dateOfBirth: '2004-01-15' },
  'De\'Aaron Fox': { college: 'Kentucky', dateOfBirth: '1997-12-20' },
  'Nikola Vucevic': { college: 'Serbia (pro)', dateOfBirth: '1990-10-13' },
  'Myles Turner': { college: 'Texas', dateOfBirth: '1996-05-12' },
  'Jakob Poeltl': { college: 'Utah', dateOfBirth: '1995-10-15' },
  'Jarrett Allen': { college: 'Texas', dateOfBirth: '1996-04-21' },
  'Desmond Bane': { college: 'TCU', dateOfBirth: '1997-06-25' },
  'Zach Edey': { college: 'Purdue', dateOfBirth: '2002-03-22' },
  'Rudy Gobert': { college: 'France (pro)', dateOfBirth: '1992-06-27' },
  'Jaden McDaniels': { college: 'Washington', dateOfBirth: '2000-12-12' },
  'Naz Reid': { college: 'Kentucky', dateOfBirth: '1997-11-14' },
  'Donte DiVincenzo': { college: 'Villanova', dateOfBirth: '1997-02-10' },
  'Julius Randle': { college: 'Kentucky', dateOfBirth: '1994-11-29' },
  'Jalen Williams': { college: 'Santa Clara', dateOfBirth: '2002-09-27' },
  'Isaiah Hartenstein': { college: 'Germany (pro)', dateOfBirth: '1996-05-03' },
  'Alex Caruso': { college: 'Texas A&M', dateOfBirth: '1994-02-28' },
  'Jerami Grant': { college: 'Syracuse', dateOfBirth: '1994-03-23' },
  'Jrue Holiday': { college: 'UCLA', dateOfBirth: '1990-06-12' },
  'Donovan Clingan': { college: 'Connecticut', dateOfBirth: '2003-07-31' },
  'Ivica Zubac': { college: 'Croatia (pro)', dateOfBirth: '1997-03-18' },
  'Brook Lopez': { college: 'Stanford', dateOfBirth: '1988-04-01' },
  'Bogdan Bogdanovic': { college: 'Serbia (pro)', dateOfBirth: '1992-08-18' },
  'Austin Reaves': { college: 'Oklahoma', dateOfBirth: '1998-05-29' },
  'Rui Hachimura': { college: 'Gonzaga', dateOfBirth: '1998-01-08' },
  'Marcus Smart': { college: 'Oklahoma State', dateOfBirth: '1994-03-16' },
  'Jarred Vanderbilt': { college: 'Kentucky', dateOfBirth: '1998-01-27' },
  'Fred VanVleet': { college: 'Wichita State', dateOfBirth: '1992-02-25' },
  'Jabari Smith Jr.': { college: 'Auburn', dateOfBirth: '2003-05-16' },
  'Jonas Valanciunas': { college: 'Lithuania (pro)', dateOfBirth: '1992-05-06' },
  'Tim Hardaway Jr.': { college: 'Michigan', dateOfBirth: '1992-01-02' },
  'Aaron Gordon': { college: 'Arizona', dateOfBirth: '1995-09-16' },
  'Daniel Gafford': { college: 'Arkansas', dateOfBirth: '1998-08-08' },
  'Klay Thompson': { college: 'Washington State', dateOfBirth: '1990-02-08' },
  'Jonathan Kuminga': { college: 'France (pro)', dateOfBirth: '2002-10-06' },
  'Moses Moody': { college: 'Arkansas', dateOfBirth: '2002-03-08' },
  'Buddy Hield': { college: 'Delaware', dateOfBirth: '1992-12-17' },
  'De\'Anthony Melton': { college: 'Louisville', dateOfBirth: '1996-05-30' },
  'Harrison Barnes': { college: 'North Carolina', dateOfBirth: '1992-03-12' },
  'Keldon Johnson': { college: 'Kentucky', dateOfBirth: '1998-11-20' },
  'Devin Vassell': { college: 'Florida State', dateOfBirth: '1999-10-02' },
  'Stephon Castle': { college: 'Connecticut', dateOfBirth: '2004-08-19' },
  'Herbert Jones': { college: 'Alabama', dateOfBirth: '1998-09-24' },
  'Jordan Poole': { college: 'Michigan', dateOfBirth: '1999-06-24' },
  'Yves Missi': { college: 'Baylor', dateOfBirth: '2004-12-09' },
  'Jose Alvarado': { college: 'Georgia Tech', dateOfBirth: '1998-09-05' },
  'Saddiq Bey': { college: 'Villanova', dateOfBirth: '2001-01-23' },
  'Jonathan Isaac': { college: 'Florida State', dateOfBirth: '1997-10-03' },
  'Wendell Carter Jr.': { college: 'Duke', dateOfBirth: '1999-03-06' },
  'Trey Murphy III': { college: 'Virginia', dateOfBirth: '2000-04-14' },
  'Anthony Black': { college: 'North Carolina', dateOfBirth: '2004-05-18' },
  'Tristan da Silva': { college: 'Colorado', dateOfBirth: '2000-08-26' },
  'Bilal Coulibaly': { college: 'France (pro)', dateOfBirth: '2005-01-04' },
  'Alex Sarr': { college: 'France (pro)', dateOfBirth: '2005-06-28' },
  'Bub Carrington': { college: 'Boston College', dateOfBirth: '2005-05-13' },
  'CJ McCollum': { college: 'Lehigh', dateOfBirth: '1991-09-19' },
  'Khris Middleton': { college: 'Texas A&M', dateOfBirth: '1991-08-15' },
  'Corey Kispert': { college: 'Gonzaga', dateOfBirth: '1998-06-25' },
  'Miles Bridges': { college: 'Michigan State', dateOfBirth: '1996-03-18' },
  'Collin Sexton': { college: 'Alabama', dateOfBirth: '1999-01-04' },
  'Nick Richards': { college: 'Kentucky', dateOfBirth: '1999-04-08' },
  'Andrew Wiggins': { college: 'Kansas', dateOfBirth: '1995-02-23' },
  'Norman Powell': { college: 'California', dateOfBirth: '1993-07-22' },
  'Davion Mitchell': { college: 'Baylor', dateOfBirth: '2000-08-29' },
  'Nikola Jovic': { college: 'Serbia (pro)', dateOfBirth: '2003-11-22' },
  'Jaime Jaquez Jr.': { college: 'UCLA', dateOfBirth: '2001-10-27' },
  'Kyle Anderson': { college: 'UCLA', dateOfBirth: '1994-01-20' },
  'Kevin Porter Jr.': { college: 'USC', dateOfBirth: '1998-10-17' },
  'Kyle Kuzma': { college: 'Utah', dateOfBirth: '1995-07-24' },
  'Gary Trent Jr.': { college: 'Duke', dateOfBirth: '1998-07-05' },
  'Bobby Portis': { college: 'Arkansas', dateOfBirth: '1992-06-01' },
  'Cole Anthony': { college: 'North Carolina', dateOfBirth: '2000-05-16' },
  'Onyeka Okongwu': { college: 'USC', dateOfBirth: '1998-12-18' },
  'Dyson Daniels': { college: 'G League Ignite', dateOfBirth: '2003-07-17' },
  'Zaccharie Risacher': { college: 'France (pro)', dateOfBirth: '2005-05-19' },
  'Kristaps Porzingis': { college: 'Spain (pro)', dateOfBirth: '1995-08-02' },
  'Kessler Edwards': { college: 'Pepperdine', dateOfBirth: '2002-02-21' },
  'Keyonte George': { college: 'Baylor', dateOfBirth: '2003-11-11' },
  'Walker Kessler': { college: 'Auburn', dateOfBirth: '2002-01-27' },
  'Ace Bailey': { college: 'Rutgers', dateOfBirth: '2006-10-09' },
  'Svi Mykhailiuk': { college: 'Kansas', dateOfBirth: '1998-06-06' },
  'Taylor Hendricks': { college: 'UCF', dateOfBirth: '2004-06-10' },
  'Brice Sensabaugh': { college: 'Ohio State', dateOfBirth: '2004-07-26' },
  'Jusuf Nurkic': { college: 'Bosnia (pro)', dateOfBirth: '1994-06-24' },
  'John Collins': { college: 'Wake Forest', dateOfBirth: '1997-09-23' },
  'Draymond Green': { college: 'Michigan State', dateOfBirth: '1990-03-04' },
  'Brandin Podziemski': { college: 'Marquette', dateOfBirth: '2001-08-20' },
  'Giannis Antetokounmpo': { college: 'Greece (pro)', dateOfBirth: '1994-12-06' },
  'Derrick Jones Jr.': { college: 'UNLV', dateOfBirth: '1996-12-07' },
  'Kris Dunn': { college: 'Providence', dateOfBirth: '1994-03-20' },
  'Nicolas Batum': { college: 'France (pro)', dateOfBirth: '1988-03-14' },
  'Chris Paul': { college: 'Wake Forest', dateOfBirth: '1985-05-06' },
  'Kevin Durant': { college: 'Texas', dateOfBirth: '1988-09-29' },
  'Bennedict Mathurin': { college: 'Arizona', dateOfBirth: '2002-08-22' },
  'Andrew Nembhard': { college: 'BYU', dateOfBirth: '1999-05-10' },
  'Aaron Nesmith': { college: 'Vanderbilt', dateOfBirth: '1998-07-07' },
  'T.J. McConnell': { college: 'Duquesne', dateOfBirth: '1992-01-15' },
  'Obi Toppin': { college: 'Dayton', dateOfBirth: '1997-12-03' },
  'Jarace Walker': { college: 'Houston', dateOfBirth: '2003-06-28' },
  'Josh Hart': { college: 'Villanova', dateOfBirth: '1995-04-06' },
  'Mitchell Robinson': { college: 'Western Kentucky', dateOfBirth: '1998-12-01' },
  'Miles McBride': { college: 'West Virginia', dateOfBirth: '2000-06-09' },
  'Landry Shamet': { college: 'Kansas', dateOfBirth: '1997-03-13' },
  'Jericho Sims': { college: 'Texas', dateOfBirth: '1999-04-04' },

  // --- Added to complete league-wide college/DOB coverage ---
  "Day'Ron Sharpe": { college: 'North Carolina', dateOfBirth: '2001-01-10' },
  'Noah Clowney': { college: 'Alabama', dateOfBirth: '2004-03-14' },
  'Egor Demin': { college: 'BYU', dateOfBirth: '2006-04-30' },
  'Danny Wolf': { college: 'Michigan', dateOfBirth: '2003-11-21' },
  'Keon Johnson': { college: 'Tennessee', dateOfBirth: '2002-03-10' },
  'Tyrese Martin': { college: 'UConn', dateOfBirth: '1999-11-16' },
  'Jalen Wilson': { college: 'Kansas', dateOfBirth: '2000-11-19' },
  'Trendon Watford': { college: 'LSU', dateOfBirth: '2001-01-24' },
  'Drake Powell': { college: 'North Carolina', dateOfBirth: '2005-08-19' },
  'Tosan Evbuomwan': { college: 'Princeton', dateOfBirth: '2000-11-30' },
  'Guerschon Yabusele': { college: 'France (pro)', dateOfBirth: '1995-12-17' },
  'Delon Wright': { college: 'Utah', dateOfBirth: '1992-04-26' },
  'Ariel Hukporti': { college: 'Germany (pro)', dateOfBirth: '2002-05-17' },
  'Pacome Dadiet': { college: 'Germany (pro)', dateOfBirth: '2005-11-30' },
  'Tyler Kolek': { college: 'Marquette', dateOfBirth: '2000-08-19' },
  'VJ Edgecombe': { college: 'Baylor', dateOfBirth: '2005-11-14' },
  'Jared McCain': { college: 'Duke', dateOfBirth: '2004-08-06' },
  'Quentin Grimes': { college: 'Houston', dateOfBirth: '2000-05-08' },
  'Kelly Oubre Jr.': { college: 'Kansas', dateOfBirth: '1995-12-09' },
  'Andre Drummond': { college: 'UConn', dateOfBirth: '1993-08-10' },
  'Eric Gordon': { college: 'Indiana', dateOfBirth: '1988-12-25' },
  'Adem Bona': { college: 'UCLA', dateOfBirth: '2003-03-25' },
  'Johni Broome': { college: 'Auburn', dateOfBirth: '2001-12-18' },
  'Justin Edwards': { college: 'Kentucky', dateOfBirth: '2005-04-12' },
  'Jeff Dowtin': { college: 'Rhode Island', dateOfBirth: '1997-11-01' },
  'Michael Foster Jr.': { college: 'G League Ignite', dateOfBirth: '2002-12-10' },
  'Gradey Dick': { college: 'Kansas', dateOfBirth: '2003-11-20' },
  'Ochai Agbaji': { college: 'Kansas', dateOfBirth: '1999-04-20' },
  'Jamal Shead': { college: 'Houston', dateOfBirth: '2002-02-13' },
  'Collin Murray-Boyles': { college: 'South Carolina', dateOfBirth: '2005-01-26' },
  "Ja'Kobe Walter": { college: 'Baylor', dateOfBirth: '2004-11-27' },
  'Sandro Mamukelashvili': { college: 'Seton Hall', dateOfBirth: '1999-01-23' },
  'Jonathan Mogbo': { college: 'San Francisco', dateOfBirth: '2001-10-22' },
  'A.J. Lawson': { college: 'South Carolina', dateOfBirth: '2000-11-30' },
  'Ulrich Chomche': { college: 'NBA Academy Africa', dateOfBirth: '2006-08-26' },
  'Matas Buzelis': { college: 'G League Ignite', dateOfBirth: '2004-05-13' },
  'Ayo Dosunmu': { college: 'Illinois', dateOfBirth: '2000-01-17' },
  'Patrick Williams': { college: 'Florida State', dateOfBirth: '2001-08-26' },
  'Kevin Huerter': { college: 'Maryland', dateOfBirth: '1998-08-27' },
  'Tre Jones': { college: 'Duke', dateOfBirth: '1999-12-08' },
  'Jalen Smith': { college: 'Maryland', dateOfBirth: '2000-03-16' },
  'Julian Phillips': { college: 'Tennessee', dateOfBirth: '2003-09-06' },
  'Zach Collins': { college: 'Gonzaga', dateOfBirth: '1997-11-19' },
  'Isaac Okoro': { college: 'Auburn', dateOfBirth: '2001-01-26' },
  'Noa Essengue': { college: 'Germany (pro)', dateOfBirth: '2006-11-06' },
  "De'Andre Hunter": { college: 'Virginia', dateOfBirth: '1997-12-02' },
  'Max Strus': { college: 'DePaul', dateOfBirth: '1996-03-28' },
  'Ty Jerome': { college: 'Virginia', dateOfBirth: '1997-06-08' },
  'Sam Merrill': { college: 'Utah State', dateOfBirth: '1996-08-21' },
  'Craig Porter Jr.': { college: 'Wichita State', dateOfBirth: '2000-09-24' },
  'Larry Nance Jr.': { college: 'Wyoming', dateOfBirth: '1993-01-01' },
  "Nae'Qwan Tomlin": { college: 'Kansas State', dateOfBirth: '2001-09-15' },
  'Tyrese Proctor': { college: 'Duke', dateOfBirth: '2004-05-06' },
  'Dean Wade': { college: 'Kansas State', dateOfBirth: '1996-09-27' },
  'Ausar Thompson': { college: 'Overtime Elite', dateOfBirth: '2003-01-30' },
  'Jaden Ivey': { college: 'Purdue', dateOfBirth: '2002-02-13' },
  'Tobias Harris': { college: 'Tennessee', dateOfBirth: '1992-07-15' },
  'Duncan Robinson': { college: 'Michigan', dateOfBirth: '1994-04-22' },
  'Ron Holland II': { college: 'G League Ignite', dateOfBirth: '2005-07-06' },
  'Isaiah Stewart': { college: 'Washington', dateOfBirth: '2001-05-22' },
  'Dennis Schroder': { college: 'Germany (pro)', dateOfBirth: '1993-09-15' },
  'Caris LeVert': { college: 'Michigan', dateOfBirth: '1994-08-25' },
  'Marcus Sasser': { college: 'Houston', dateOfBirth: '1999-11-25' },
  'Bobi Klintman': { college: 'Wake Forest', dateOfBirth: '2002-04-20' },
  'Paul Reed': { college: 'DePaul', dateOfBirth: '1999-12-14' },
  'Ben Sheppard': { college: 'Belmont', dateOfBirth: '2001-04-20' },
  'Isaiah Jackson': { college: 'Kentucky', dateOfBirth: '2001-09-15' },
  'Tony Bradley': { college: 'North Carolina', dateOfBirth: '1998-01-08' },
  'Quenton Jackson': { college: 'Texas A&M', dateOfBirth: '1999-05-04' },
  'Johnny Furphy': { college: 'Kansas', dateOfBirth: '2005-06-08' },
  'AJ Green': { college: 'Northern Iowa', dateOfBirth: '1999-08-08' },
  'Gary Harris': { college: 'Michigan State', dateOfBirth: '1994-06-14' },
  'Ryan Rollins': { college: 'Toledo', dateOfBirth: '2002-08-08' },
  'Chris Livingston': { college: 'Kentucky', dateOfBirth: '2003-09-15' },
  'Tyler Smith': { college: 'G League Ignite', dateOfBirth: '2005-02-04' },
  'Jamaree Bouyea': { college: 'San Francisco', dateOfBirth: '1999-11-15' },
  'Taurean Prince': { college: 'Baylor', dateOfBirth: '1994-07-22' },
  'Nickeil Alexander-Walker': { college: 'Virginia Tech', dateOfBirth: '1998-09-02' },
  'Luke Kennard': { college: 'Duke', dateOfBirth: '1996-06-24' },
  'Vit Krejci': { college: 'Slovenia (pro)', dateOfBirth: '2000-11-19' },
  'Mouhamed Gueye': { college: 'Washington State', dateOfBirth: '2003-01-08' },
  'Asa Newell': { college: 'Georgia', dateOfBirth: '2005-08-12' },
  'Nikola Djurisic': { college: 'Serbia (pro)', dateOfBirth: '2004-04-19' },
  'Kon Knueppel': { college: 'Duke', dateOfBirth: '2005-08-15' },
  'Ryan Kalkbrenner': { college: 'Creighton', dateOfBirth: '2001-10-19' },
  'Josh Green': { college: 'Arizona', dateOfBirth: '2001-01-16' },
  'Tidjane Salaun': { college: 'France (pro)', dateOfBirth: '2004-08-13' },
  'Moussa Diabate': { college: 'Michigan', dateOfBirth: '2002-12-21' },
  'Sion James': { college: 'Duke', dateOfBirth: '2001-12-25' },
  'Liam McNeeley': { college: 'UConn', dateOfBirth: '2005-08-14' },
  "Kel'el Ware": { college: 'Indiana', dateOfBirth: '2003-08-15' },
  'Pelle Larsson': { college: 'Arizona', dateOfBirth: '2000-10-05' },
  'Vladislav Goldin': { college: 'Michigan', dateOfBirth: '2001-08-30' },
  'Haywood Highsmith': { college: 'Wheeling', dateOfBirth: '1997-11-11' },
  'Jett Howard': { college: 'Michigan', dateOfBirth: '2003-08-25' },
  'Goga Bitadze': { college: 'Georgia (pro)', dateOfBirth: '1999-07-20' },
  'Noah Penda': { college: 'France (pro)', dateOfBirth: '2005-06-21' },
  'Tyus Jones': { college: 'Duke', dateOfBirth: '1996-05-10' },
  'Kyshawn George': { college: 'Miami', dateOfBirth: '2003-12-02' },
  'Marvin Bagley III': { college: 'Duke', dateOfBirth: '1999-03-14' },
  'Tristan Vukcevic': { college: 'Serbia (pro)', dateOfBirth: '2003-01-10' },
  'Justin Champagnie': { college: 'Pittsburgh', dateOfBirth: '2001-05-22' },
  'Cam Whitmore': { college: 'Villanova', dateOfBirth: '2004-07-08' },
  'Tre Johnson': { college: 'Texas', dateOfBirth: '2006-04-30' },
  'Will Riley': { college: 'Illinois', dateOfBirth: '2006-07-21' },
  'Cameron Johnson': { college: 'North Carolina', dateOfBirth: '1996-03-03' },
  'Christian Braun': { college: 'Kansas', dateOfBirth: '2001-04-17' },
  'Bruce Brown': { college: 'Miami', dateOfBirth: '1996-08-15' },
  'Julian Strawther': { college: 'Gonzaga', dateOfBirth: '2002-01-04' },
  'Peyton Watson': { college: 'UCLA', dateOfBirth: '2003-01-11' },
  'Jalen Pickett': { college: 'Penn State', dateOfBirth: '1999-04-25' },
  'DaRon Holmes II': { college: 'Dayton', dateOfBirth: '2003-01-06' },
  'Mike Conley': { college: 'Ohio State', dateOfBirth: '1987-10-11' },
  'Jaylen Clark': { college: 'UCLA', dateOfBirth: '2001-11-01' },
  'Terrence Shannon Jr.': { college: 'Illinois', dateOfBirth: '2000-12-02' },
  'Rob Dillingham': { college: 'Kentucky', dateOfBirth: '2005-01-11' },
  'Joe Ingles': { college: 'Australia (pro)', dateOfBirth: '1987-10-02' },
  'Leonard Miller': { college: 'G League Ignite', dateOfBirth: '2004-01-06' },
  'Luguentz Dort': { college: 'Arizona State', dateOfBirth: '1999-04-19' },
  'Cason Wallace': { college: 'Kentucky', dateOfBirth: '2004-11-08' },
  'Aaron Wiggins': { college: 'Maryland', dateOfBirth: '1999-08-13' },
  'Ajay Mitchell': { college: 'UC Santa Barbara', dateOfBirth: '2002-11-19' },
  'Jaylin Williams': { college: 'Arkansas', dateOfBirth: '2002-04-13' },
  'Kenrich Williams': { college: 'TCU', dateOfBirth: '1994-08-17' },
  'Nikola Topic': { college: 'Serbia (pro)', dateOfBirth: '2005-08-27' },
  'Thomas Sorber': { college: 'Georgetown', dateOfBirth: '2006-04-01' },
  'Scoot Henderson': { college: 'G League Ignite', dateOfBirth: '2004-02-03' },
  'Shaedon Sharpe': { college: 'Kentucky', dateOfBirth: '2003-06-06' },
  'Toumani Camara': { college: 'Dayton', dateOfBirth: '2000-06-08' },
  'Robert Williams III': { college: 'Texas A&M', dateOfBirth: '1997-10-17' },
  'Kris Murray': { college: 'Iowa', dateOfBirth: '2000-08-19' },
  'Jabari Walker': { college: 'Colorado', dateOfBirth: '2002-02-13' },
  'Duop Reath': { college: 'LSU', dateOfBirth: '1996-06-19' },
  'Sidy Cissoko': { college: 'G League Ignite', dateOfBirth: '2004-05-19' },
  'Isaiah Collier': { college: 'USC', dateOfBirth: '2004-08-07' },
  'Kyle Filipowski': { college: 'Duke', dateOfBirth: '2003-11-15' },
  'Cody Williams': { college: 'Colorado', dateOfBirth: '2005-01-18' },
  'Quinten Post': { college: 'Boston College', dateOfBirth: '2001-09-08' },
  'Gui Santos': { college: 'Brazil (pro)', dateOfBirth: '2002-06-19' },
  'Will Richard': { college: 'Florida', dateOfBirth: '2002-12-05' },
  'Pat Spencer': { college: 'Villanova', dateOfBirth: '1997-08-27' },
  'Kobe Sanders': { college: 'Nevada', dateOfBirth: '2002-06-15' },
  'Brandon Boston Jr.': { college: 'Kentucky', dateOfBirth: '2001-11-28' },
  'Yanic Konan Niederhauser': { college: 'Penn State', dateOfBirth: '2001-11-07' },
  'Deandre Ayton': { college: 'Arizona', dateOfBirth: '1998-07-23' },
  'Gabe Vincent': { college: 'UC Santa Barbara', dateOfBirth: '1996-06-14' },
  'Jaxson Hayes': { college: 'Texas', dateOfBirth: '2000-05-23' },
  'Jake LaRavia': { college: 'Wake Forest', dateOfBirth: '2001-11-01' },
  'Maxi Kleber': { college: 'Germany (pro)', dateOfBirth: '1992-01-29' },
  'Dalton Knecht': { college: 'Tennessee', dateOfBirth: '2000-09-19' },
  'Bronny James': { college: 'USC', dateOfBirth: '2004-10-06' },
  'Dillon Brooks': { college: 'Oregon', dateOfBirth: '1996-01-22' },
  'Mark Williams': { college: 'Duke', dateOfBirth: '2002-12-04' },
  'Grayson Allen': { college: 'Duke', dateOfBirth: '1995-10-08' },
  "Royce O'Neale": { college: 'Baylor', dateOfBirth: '1993-05-05' },
  'Collin Gillespie': { college: 'Villanova', dateOfBirth: '1999-01-19' },
  'Ryan Dunn': { college: 'Virginia', dateOfBirth: '2004-03-19' },
  'Oso Ighodaro': { college: 'Marquette', dateOfBirth: '2002-06-11' },
  'Jordan Goodwin': { college: 'Saint Louis', dateOfBirth: '1999-07-19' },
  'Rasheer Fleming': { college: "Saint Joseph's", dateOfBirth: '2004-08-10' },
  'Koby Brea': { college: 'Kentucky', dateOfBirth: '2001-11-07' },
  'Malik Monk': { college: 'Kentucky', dateOfBirth: '1998-02-04' },
  'Keegan Murray': { college: 'Iowa', dateOfBirth: '1999-08-19' },
  'Devin Carter': { college: 'Providence', dateOfBirth: '2002-01-25' },
  'Maxime Raynaud': { college: 'Stanford', dateOfBirth: '2003-05-04' },
  'Nique Clifford': { college: 'Colorado State', dateOfBirth: '2001-11-16' },
  'Trey Lyles': { college: 'Kentucky', dateOfBirth: '1995-11-05' },
  'Isaac Jones': { college: 'Washington State', dateOfBirth: '2001-11-25' },
  'Precious Achiuwa': { college: 'Memphis', dateOfBirth: '2000-09-19' },
  'DeMar DeRozan': { college: 'USC', dateOfBirth: '1989-08-07' },
  'Doug McDermott': { college: 'Creighton', dateOfBirth: '1992-01-03' },
  'PJ Washington': { college: 'Kentucky', dateOfBirth: '1998-08-23' },
  'Cooper Flagg': { college: 'Duke', dateOfBirth: '2006-12-21' },
  'Naji Marshall': { college: 'Xavier', dateOfBirth: '1998-01-08' },
  "D'Angelo Russell": { college: 'Ohio State', dateOfBirth: '1996-02-23' },
  'Max Christie': { college: 'Michigan State', dateOfBirth: '2003-02-10' },
  'Dereck Lively II': { college: 'Duke', dateOfBirth: '2004-02-12' },
  'Brandon Williams': { college: 'Arizona', dateOfBirth: '2001-04-16' },
  'Ryan Nembhard': { college: 'Gonzaga', dateOfBirth: '2003-06-21' },
  'Olivier-Maxence Prosper': { college: 'Marquette', dateOfBirth: '2002-09-11' },
  'Amen Thompson': { college: 'Overtime Elite', dateOfBirth: '2003-01-30' },
  'Steven Adams': { college: 'Pittsburgh', dateOfBirth: '1993-07-20' },
  'Tari Eason': { college: 'LSU', dateOfBirth: '2001-08-15' },
  'Reed Sheppard': { college: 'Kentucky', dateOfBirth: '2004-12-24' },
  'Josh Okogie': { college: 'Georgia Tech', dateOfBirth: '1998-09-01' },
  'Aaron Holiday': { college: 'UCLA', dateOfBirth: '1996-09-30' },
  "Jae'Sean Tate": { college: 'Ohio State', dateOfBirth: '1996-07-28' },
  "N'Faly Dante": { college: 'Oregon', dateOfBirth: '2000-08-11' },
  'Cedric Coward': { college: 'Eastern Washington', dateOfBirth: '2002-10-30' },
  'Jaylen Wells': { college: 'Washington State', dateOfBirth: '2002-11-27' },
  'Santi Aldama': { college: 'Loyola Maryland', dateOfBirth: '2001-01-10' },
  'Vince Williams Jr.': { college: 'VCU', dateOfBirth: '2000-08-06' },
  'Scotty Pippen Jr.': { college: 'Vanderbilt', dateOfBirth: '2000-11-27' },
  'John Konchar': { college: 'Purdue Fort Wayne', dateOfBirth: '1996-09-08' },
  'Jock Landale': { college: 'Saint Mary\'s', dateOfBirth: '1996-08-10' },
  'Javon Small': { college: 'West Virginia', dateOfBirth: '2001-11-09' },
  'PJ Haggerty': { college: 'Tulsa', dateOfBirth: '2004-04-03' },
  'Derik Queen': { college: 'Maryland', dateOfBirth: '2005-02-27' },
  'Jeremiah Fears': { college: 'Oklahoma', dateOfBirth: '2006-06-07' },
  'Karlo Matkovic': { college: 'Serbia (pro)', dateOfBirth: '2001-03-11' },
  'Micah Peavy': { college: 'TCU', dateOfBirth: '2001-11-08' },
  'Bryce McGowens': { college: 'Nebraska', dateOfBirth: '2003-01-08' },
  'Dylan Harper': { college: 'Rutgers', dateOfBirth: '2006-06-08' },
  'Carter Bryant': { college: 'Arizona', dateOfBirth: '2006-05-15' },
  'Julian Champagnie': { college: 'St. John\'s', dateOfBirth: '2001-05-22' },
  'Jeremy Sochan': { college: 'Baylor', dateOfBirth: '2003-05-01' },
  'Bismack Biyombo': { college: 'Congo (pro)', dateOfBirth: '1992-08-28' },
  'Charles Bassey': { college: 'Western Kentucky', dateOfBirth: '2000-11-28' }
};

const PLAYERS_2026 = [];

// --- Atlantic Division ---

// Boston Celtics
PLAYERS_2026.push(mkPlayer('BOS', 'Jayson Tatum', 27, 80, 210, 'SF', 0, 8, 96, 97, 'primary_scorer', 34800000, 4, { college: 'Duke', dateOfBirth: '1998-12-23' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Jaylen Brown', 29, 78, 223, 'SG', 7, 9, 92, 92, 'slasher', 49000000, 4, { college: 'California', dateOfBirth: '1996-10-24' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Derrick White', 31, 76, 190, 'PG', 9, 8, 87, 87, 'three_and_d', 28000000, 3, { college: 'Colorado', dateOfBirth: '1994-07-03' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Payton Pritchard', 27, 74, 195, 'PG', 11, 5, 82, 84, 'primary_scorer', 15000000, 3, { college: 'Oregon', dateOfBirth: '1998-08-07' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Anfernee Simons', 26, 74, 181, 'SG', 1, 7, 83, 84, 'primary_scorer', 25000000, 2, { college: 'Louisville', dateOfBirth: '1999-04-25' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Al Horford', 39, 81, 240, 'C', 42, 18, 76, 76, 'stretch_big', 5000000, 1, { college: 'Florida', dateOfBirth: '1986-06-03' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Sam Hauser', 27, 79, 217, 'SF', 30, 4, 76, 78, 'three_and_d', 8000000, 3, { college: 'Marquette', dateOfBirth: '1998-01-27' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Luke Kornet', 30, 84, 250, 'C', 40, 7, 73, 74, 'rim_protector', 5000000, 2, { college: 'Vanderbilt', dateOfBirth: '1995-07-02' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Neemias Queta', 26, 83, 254, 'C', 88, 3, 74, 78, 'rim_protector', 4000000, 3, { college: 'Utah State', dateOfBirth: '1999-08-30' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Baylor Scheierman', 23, 78, 205, 'SG', 55, 2, 72, 78, 'three_and_d', 3200000, 3, { college: 'Creighton', dateOfBirth: '2002-11-08' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Jordan Walsh', 21, 79, 195, 'SF', 27, 3, 70, 80, 'raw_prospect', 2200000, 2, { college: 'Boston College', dateOfBirth: '2004-06-17' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Xavier Tillman', 26, 79, 245, 'PF', 26, 5, 71, 73, 'rim_protector', 4400000, 2, { college: 'Michigan State', dateOfBirth: '1999-05-14' }));
PLAYERS_2026.push(mkPlayer('BOS', 'JD Davison', 22, 74, 200, 'PG', 8, 3, 68, 74, 'playmaker', 2000000, 2, { college: 'Alabama', dateOfBirth: '2003-02-07' }));
PLAYERS_2026.push(mkPlayer('BOS', 'Josh Minott', 22, 80, 210, 'PF', 45, 3, 69, 76, 'slasher', 2000000, 2, { college: 'Memphis', dateOfBirth: '2003-10-17' }));

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

// --- Southwest Division ---

// Dallas Mavericks
PLAYERS_2026.push(mkPlayer('DAL', 'Anthony Davis', 32, 82, 253, 'PF', 3, 13, 88, 88, 'rim_protector', 43000000, 2));
PLAYERS_2026.push(mkPlayer('DAL', 'Kyrie Irving', 33, 74, 195, 'PG', 11, 14, 87, 87, 'primary_scorer', 43000000, 2));
PLAYERS_2026.push(mkPlayer('DAL', 'Klay Thompson', 35, 78, 220, 'SG', 31, 13, 76, 76, 'three_and_d', 15200000, 2));
PLAYERS_2026.push(mkPlayer('DAL', 'PJ Washington', 27, 80, 230, 'PF', 25, 6, 78, 79, 'three_and_d', 24700000, 3));
PLAYERS_2026.push(mkPlayer('DAL', 'Daniel Gafford', 27, 82, 234, 'C', 21, 6, 78, 79, 'rim_protector', 14400000, 3));
PLAYERS_2026.push(mkPlayer('DAL', 'Cooper Flagg', 19, 81, 205, 'SF', 32, 0, 78, 96, 'slasher', 13800000, 4));
PLAYERS_2026.push(mkPlayer('DAL', 'Naji Marshall', 27, 78, 220, 'SF', 13, 5, 74, 76, 'three_and_d', 6900000, 2));
PLAYERS_2026.push(mkPlayer('DAL', 'D\'Angelo Russell', 29, 76, 193, 'PG', 8, 10, 76, 76, 'primary_scorer', 6300000, 1));
PLAYERS_2026.push(mkPlayer('DAL', 'Max Christie', 22, 77, 190, 'SG', 5, 3, 74, 81, 'three_and_d', 8000000, 3));
PLAYERS_2026.push(mkPlayer('DAL', 'Dereck Lively II', 21, 84, 235, 'C', 2, 2, 76, 85, 'rim_protector', 5700000, 2));
PLAYERS_2026.push(mkPlayer('DAL', 'Brandon Williams', 24, 74, 180, 'PG', 20, 1, 66, 72, 'playmaker', 1900000, 1));
PLAYERS_2026.push(mkPlayer('DAL', 'Ryan Nembhard', 22, 72, 180, 'PG', 4, 0, 62, 70, 'playmaker', 1800000, 1));
PLAYERS_2026.push(mkPlayer('DAL', 'Olivier-Maxence Prosper', 22, 80, 226, 'SF', 6, 2, 66, 76, 'three_and_d', 2600000, 2));

// Houston Rockets
PLAYERS_2026.push(mkPlayer('HOU', 'Kevin Durant', 37, 82, 240, 'SF', 7, 18, 89, 89, 'primary_scorer', 28000000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Alperen Sengun', 23, 83, 243, 'C', 28, 4, 85, 89, 'playmaker', 37000000, 5));
PLAYERS_2026.push(mkPlayer('HOU', 'Fred VanVleet', 31, 73, 197, 'PG', 5, 9, 78, 78, 'playmaker', 25000000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Amen Thompson', 23, 78, 190, 'SG', 1, 2, 84, 91, 'slasher', 8700000, 2));
PLAYERS_2026.push(mkPlayer('HOU', 'Steven Adams', 32, 83, 265, 'C', 12, 12, 74, 74, 'rim_protector', 12600000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Jabari Smith Jr.', 22, 82, 220, 'PF', 10, 3, 79, 86, 'stretch_big', 11200000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Tari Eason', 24, 80, 215, 'PF', 17, 3, 76, 82, 'three_and_d', 6700000, 2));
PLAYERS_2026.push(mkPlayer('HOU', 'Reed Sheppard', 21, 74, 182, 'PG', 15, 1, 73, 85, 'playmaker', 8700000, 3));
PLAYERS_2026.push(mkPlayer('HOU', 'Josh Okogie', 27, 76, 213, 'SG', 3, 6, 68, 70, 'three_and_d', 2100000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Aaron Holiday', 29, 73, 185, 'PG', 2, 7, 70, 70, 'playmaker', 4300000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'Jae\'Sean Tate', 30, 76, 230, 'SF', 8, 5, 71, 71, 'slasher', 7000000, 1));
PLAYERS_2026.push(mkPlayer('HOU', 'N\'Faly Dante', 25, 83, 245, 'C', 25, 1, 66, 72, 'rim_protector', 1900000, 2));

// Memphis Grizzlies
PLAYERS_2026.push(mkPlayer('MEM', 'Ja Morant', 26, 75, 174, 'PG', 12, 6, 88, 89, 'slasher', 39000000, 3));
PLAYERS_2026.push(mkPlayer('MEM', 'Jaren Jackson Jr.', 26, 82, 242, 'PF', 13, 7, 85, 85, 'rim_protector', 24000000, 2));
PLAYERS_2026.push(mkPlayer('MEM', 'Zach Edey', 23, 91, 300, 'C', 15, 1, 74, 82, 'rim_protector', 6200000, 3));
PLAYERS_2026.push(mkPlayer('MEM', 'Cedric Coward', 22, 80, 210, 'SG', 6, 0, 71, 84, 'three_and_d', 4200000, 4));
PLAYERS_2026.push(mkPlayer('MEM', 'Jaylen Wells', 21, 79, 205, 'SG', 3, 1, 73, 82, 'three_and_d', 2100000, 2));
PLAYERS_2026.push(mkPlayer('MEM', 'Santi Aldama', 24, 83, 215, 'PF', 7, 4, 75, 80, 'stretch_big', 9000000, 3));
PLAYERS_2026.push(mkPlayer('MEM', 'Vince Williams Jr.', 25, 78, 200, 'SF', 5, 3, 72, 77, 'three_and_d', 4400000, 2));
PLAYERS_2026.push(mkPlayer('MEM', 'Scotty Pippen Jr.', 25, 73, 175, 'PG', 1, 3, 71, 76, 'playmaker', 2100000, 2));
PLAYERS_2026.push(mkPlayer('MEM', 'John Konchar', 29, 78, 210, 'SG', 46, 6, 65, 65, 'veteran_glue', 2100000, 1));
PLAYERS_2026.push(mkPlayer('MEM', 'Jock Landale', 30, 83, 255, 'C', 34, 6, 68, 68, 'stretch_big', 2100000, 1));
PLAYERS_2026.push(mkPlayer('MEM', 'Javon Small', 23, 74, 185, 'PG', 4, 0, 62, 72, 'playmaker', 1800000, 1));
PLAYERS_2026.push(mkPlayer('MEM', 'PJ Haggerty', 21, 76, 190, 'SG', 24, 0, 63, 75, 'primary_scorer', 2200000, 2));

// New Orleans Pelicans
PLAYERS_2026.push(mkPlayer('NOP', 'Zion Williamson', 25, 78, 284, 'PF', 1, 6, 84, 88, 'slasher', 36700000, 2));
PLAYERS_2026.push(mkPlayer('NOP', 'Trey Murphy III', 25, 80, 206, 'SF', 8, 4, 82, 86, 'three_and_d', 25000000, 4));
PLAYERS_2026.push(mkPlayer('NOP', 'Herbert Jones', 27, 79, 206, 'SF', 5, 4, 76, 78, 'three_and_d', 16000000, 3));
PLAYERS_2026.push(mkPlayer('NOP', 'Jordan Poole', 26, 76, 194, 'PG', 3, 6, 76, 78, 'primary_scorer', 28500000, 2));
PLAYERS_2026.push(mkPlayer('NOP', 'Yves Missi', 21, 83, 235, 'C', 21, 1, 73, 82, 'rim_protector', 4400000, 2));
PLAYERS_2026.push(mkPlayer('NOP', 'Derik Queen', 20, 82, 245, 'C', 9, 0, 71, 84, 'stretch_big', 6600000, 4));
PLAYERS_2026.push(mkPlayer('NOP', 'Jose Alvarado', 27, 73, 179, 'PG', 15, 4, 73, 75, 'three_and_d', 8800000, 2));
PLAYERS_2026.push(mkPlayer('NOP', 'Saddiq Bey', 26, 79, 215, 'SF', 41, 5, 70, 74, 'three_and_d', 4100000, 1));
PLAYERS_2026.push(mkPlayer('NOP', 'Jeremiah Fears', 19, 76, 185, 'PG', 0, 0, 70, 86, 'playmaker', 11800000, 4));
PLAYERS_2026.push(mkPlayer('NOP', 'Karlo Matkovic', 23, 83, 235, 'PF', 12, 1, 65, 74, 'stretch_big', 2000000, 2));
PLAYERS_2026.push(mkPlayer('NOP', 'Micah Peavy', 23, 78, 220, 'SF', 27, 1, 64, 70, 'three_and_d', 1900000, 1));
PLAYERS_2026.push(mkPlayer('NOP', 'Bryce McGowens', 23, 78, 190, 'SG', 6, 2, 65, 72, 'slasher', 1900000, 1));

// San Antonio Spurs
PLAYERS_2026.push(mkPlayer('SAS', 'Victor Wembanyama', 22, 88, 235, 'C', 1, 2, 94, 99, 'rim_protector', 13000000, 3));
PLAYERS_2026.push(mkPlayer('SAS', 'De\'Aaron Fox', 28, 75, 185, 'PG', 4, 8, 87, 87, 'primary_scorer', 37000000, 3));
PLAYERS_2026.push(mkPlayer('SAS', 'Stephon Castle', 21, 78, 210, 'SG', 5, 1, 79, 89, 'playmaker', 10800000, 3));
PLAYERS_2026.push(mkPlayer('SAS', 'Devin Vassell', 25, 78, 200, 'SG', 24, 5, 80, 83, 'three_and_d', 27000000, 4));
PLAYERS_2026.push(mkPlayer('SAS', 'Harrison Barnes', 33, 80, 225, 'SF', 8, 13, 74, 74, 'three_and_d', 18000000, 1));
PLAYERS_2026.push(mkPlayer('SAS', 'Keldon Johnson', 26, 78, 220, 'SF', 3, 6, 76, 76, 'slasher', 18700000, 1));
PLAYERS_2026.push(mkPlayer('SAS', 'Dylan Harper', 19, 78, 215, 'PG', 2, 0, 74, 92, 'playmaker', 13400000, 4));
PLAYERS_2026.push(mkPlayer('SAS', 'Carter Bryant', 19, 80, 200, 'SF', 30, 0, 66, 82, 'raw_prospect', 4900000, 4));
PLAYERS_2026.push(mkPlayer('SAS', 'Julian Champagnie', 24, 79, 210, 'SF', 32, 3, 68, 74, 'three_and_d', 2100000, 1));
PLAYERS_2026.push(mkPlayer('SAS', 'Jeremy Sochan', 22, 80, 230, 'PF', 10, 3, 75, 82, 'slasher', 6700000, 2));
PLAYERS_2026.push(mkPlayer('SAS', 'Bismack Biyombo', 33, 81, 255, 'C', 18, 13, 65, 65, 'rim_protector', 2100000, 1));
PLAYERS_2026.push(mkPlayer('SAS', 'Charles Bassey', 25, 82, 234, 'C', 28, 5, 66, 70, 'rim_protector', 2100000, 1));

if (typeof module !== 'undefined' && module.exports) {
  // makeAttributes/ARCHETYPES are exported so Node validation scripts can build
  // a player the same way the browser does — playerCareerController.js reads
  // makeAttributes as a page global, which doesn't exist under require().
  // rescaleAnchor is exported for the same reason: playerCareerController.js
  // authors its custom players' startingOverall/startingPotential on the same
  // pre-rescale scale this file's 450 judgments use, so it needs the identical
  // affine map or a created player lands 25 points above the league.
  module.exports = {
    PLAYERS_2026: PLAYERS_2026,
    makeAttributes: makeAttributes,
    ARCHETYPES: ARCHETYPES,
    rescaleAnchor: rescaleAnchor,
    ANCHOR_SD_RATIO: ANCHOR_SD_RATIO
  };
}
