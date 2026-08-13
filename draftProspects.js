var _PROSPECT_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js'), faces: require('./faces.js'), progression: require('./progression.js'), players: require('./players-2026.js'), ratings: require('./ratings.js'), relatives: require('./relatives.js'), names: require('./names.js') }
  : {
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, POSITIONS: POSITIONS },
      traits: { generateHiddenTraits: generateHiddenTraits, generatePersonality: generatePersonality, generateTendencies: generateTendencies },
      faces: { generateFace: generateFace },
      progression: { estimatePotentialMonteCarlo: estimatePotentialMonteCarlo },
      players: { makeAttributes: makeAttributes, ANCHOR_SD_RATIO: ANCHOR_SD_RATIO, PLAYERS_2026: PLAYERS_2026 },
      ratings: { defineOverall: defineOverall, toRawRating: toRawRating },
      relatives: { assignFamilies: assignFamilies },
      names: { takenNameSet: takenNameSet, pickUniqueName: pickUniqueName }
    };

// The retiree archive lives in history.js, which loads long after this file in
// the browser and pulls in most of the league under Node — so it is resolved
// lazily, only when a class is actually being generated. A prospect arriving
// with a Hall of Famer's exact name is the same defect as two prospects sharing
// one, just spread over more seasons.
function _prospectHistoryDep() {
  if (typeof require !== 'undefined') return require('./history.js');
  return (typeof LEAGUE_HISTORY !== 'undefined') ? { LEAGUE_HISTORY: LEAGUE_HISTORY } : null;
}

function retiredPlayers() {
  const history = _prospectHistoryDep();
  return (history && history.LEAGUE_HISTORY && history.LEAGUE_HISTORY.retiredPlayers) || [];
}

function existingPlayerNames() {
  return _PROSPECT_DATA.names.takenNameSet(_PROSPECT_DATA.players.PLAYERS_2026, retiredPlayers());
}

// Everyone who has ever played in this league. relatives.js decides who is
// actually eligible; this only has to make sure it is shown all the candidates.
function possibleFathers() {
  return _PROSPECT_DATA.players.PLAYERS_2026.concat(retiredPlayers());
}

// Same archetype offsets as players-2026.js's ARCHETYPES, duplicated here rather
// than shared — prospects and rostered players are authored independently and
// don't need to move together if one file's archetype tuning changes later.
const PROSPECT_ARCHETYPES = {
  primary_scorer:  { insideScoring: 4, midRange: 6, threePoint: 4, freeThrow: 4, passing: -2, ballHandling: 3, postScoring: 0, perimeterDefense: -6, interiorDefense: -10, steal: -4, block: -10, offReb: -8, defReb: -4, speed: 2, acceleration: 2, strength: 0, vertical: 2, basketballIQ: 2, leadership: 2, workEthic: 0 },
  playmaker:       { insideScoring: -2, midRange: 2, threePoint: 2, freeThrow: 2, passing: 10, ballHandling: 10, postScoring: -10, perimeterDefense: -2, interiorDefense: -12, steal: 2, block: -12, offReb: -10, defReb: -6, speed: 4, acceleration: 4, strength: -4, vertical: -2, basketballIQ: 6, leadership: 4, workEthic: 0 },
  three_and_d:     { insideScoring: -6, midRange: 0, threePoint: 8, freeThrow: 2, passing: -4, ballHandling: -4, postScoring: -10, perimeterDefense: 8, interiorDefense: -4, steal: 4, block: -4, offReb: -4, defReb: 0, speed: 2, acceleration: 2, strength: 0, vertical: 0, basketballIQ: 2, leadership: 0, workEthic: 2 },
  rim_protector:   { insideScoring: -4, midRange: -10, threePoint: -14, freeThrow: -10, passing: -8, ballHandling: -12, postScoring: 2, perimeterDefense: 0, interiorDefense: 10, steal: -2, block: 12, offReb: 8, defReb: 10, speed: -6, acceleration: -6, strength: 8, vertical: 4, basketballIQ: 0, leadership: 0, workEthic: 2 },
  slasher:         { insideScoring: 8, midRange: -2, threePoint: -6, freeThrow: -2, passing: 0, ballHandling: 4, postScoring: -2, perimeterDefense: 0, interiorDefense: -6, steal: 2, block: -6, offReb: -2, defReb: -2, speed: 6, acceleration: 6, strength: 0, vertical: 6, basketballIQ: 0, leadership: 0, workEthic: 0 },
  // Was missing while commissioner.js's CREATE_PLAYER_ARCHETYPES already offered
  // it in the Create Player dropdown (ui/commissioner.js), so picking "stretch_big"
  // threw in makeProspectAttributes on an undefined offset table. Offsets mirror
  // players-2026.js's ARCHETYPES entry of the same name.
  stretch_big:     { insideScoring: -2, midRange: 4, threePoint: 6, freeThrow: 4, passing: -4, ballHandling: -8, postScoring: 0, perimeterDefense: -4, interiorDefense: 2, steal: -4, block: 4, offReb: 0, defReb: 4, speed: -4, acceleration: -4, strength: 4, vertical: 0, basketballIQ: 0, leadership: 0, workEthic: 0 },
  raw_prospect:    { insideScoring: -2, midRange: -4, threePoint: -4, freeThrow: -2, passing: -2, ballHandling: -2, postScoring: -2, perimeterDefense: -2, interiorDefense: -2, steal: -2, block: -2, offReb: -2, defReb: -2, speed: 4, acceleration: 4, strength: -4, vertical: 4, basketballIQ: -8, leadership: -6, workEthic: 0 }
};

// Same generation as players-2026.js's makeAttributes — anchor on the authored
// (overall, archetype), amplify the archetype shape, then add deterministic
// per-attribute variation seeded from the prospect's own id. Kept in step with
// that file deliberately: a draft class built the old `overall + offset` way
// would arrive on a different scale from the league it is joining, and every
// prospect of a given archetype and overall would be the same person.
//
// The constants are imported rather than duplicated. The archetype OFFSETS
// stay duplicated above, as they always were, so prospect and veteran
// archetype tuning can diverge — but the scale cannot.
function makeProspectAttributes(overall, archetype, prospectId) {
  return _PROSPECT_DATA.players.makeAttributes(overall, archetype, prospectId, PROSPECT_ARCHETYPES);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Per-position physical distributions, measured off the real 2K27 league
// (data/2k27-rosters.json, ~90 players per position): height and weight as
// mean/sd, wingspan as a mean/sd DELTA over height. These replaced a flat
// uniform 74-83in roll that made 6'2" centers as likely as 6'11" ones.
const POSITION_PHYSICALS = {
  PG: { h: 74.9, hSd: 2.0, w: 194, wSd: 13, ws: 3.5, wsSd: 2.0 },
  SG: { h: 76.7, hSd: 1.4, w: 203, wSd: 13, ws: 3.8, wsSd: 2.2 },
  SF: { h: 78.6, hSd: 1.7, w: 212, wSd: 15, ws: 4.0, wsSd: 2.3 },
  PF: { h: 80.3, hSd: 1.6, w: 224, wSd: 17, ws: 4.3, wsSd: 1.8 },
  C:  { h: 82.8, hSd: 1.9, w: 245, wSd: 18, ws: 4.7, wsSd: 2.1 }
};

// Approximately normal from the module's own seeded rng (sum of three
// uniforms — deterministic, no Box-Muller state to carry).
function gaussish(rng) {
  return ((rng() + rng() + rng()) - 1.5) * 2;
}

function samplePhysicals(position, rng) {
  const d = POSITION_PHYSICALS[position] || POSITION_PHYSICALS.SF;
  const heightIn = Math.round(d.h + gaussish(rng) * d.hSd);
  return {
    heightIn: heightIn,
    weightLb: Math.round(d.w + gaussish(rng) * d.wSd),
    wingspanIn: Math.round(heightIn + d.ws + gaussish(rng) * d.wsSd)
  };
}

// Sequence for the fixed real-2026 class below, which is built at module load
// where no rng exists. A counter rather than Math.random so those ids are
// identical on every page load: they are fixed data, and an id that changes
// each time the file is parsed is a hazard for anything that stores one.
let _staticProspectSeq = 0;

function mkProspect(name, age, heightIn, weightLb, position, overall, potential, archetype, bustChance, nbaComparison, opts) {
  opts = opts || {};
  const autoData = PROSPECT_DATA_MAP[name] || {};
  // Hoisted out of the literal: makeProspectAttributes seeds a prospect's
  // per-attribute variation from his id, so the id has to exist first.
  const prospectId = 'prospect-' + slugify(name) + '-' +
    (opts.rng ? Math.floor(opts.rng() * 1000000) : (++_staticProspectSeq));
  const prospect = {
    // Deterministic either way. Every other value a generated prospect gets
    // comes from the seeded league rng; the id was the one exception, and it
    // defeated reproducibility outright — save.js captures the rng position
    // precisely so reloading replays a season identically, but downstream
    // code sorts and keys by player id, so unseeded ids made the same seed
    // produce a different league. Two runs from one seed diverged inside the
    // very first offseason.
    //
    // The suffix exists to separate GENERATED prospects, whose names repeat
    // from a small pool; the fixed class below has unique real names and just
    // needs a stable counter.
    id: prospectId,
    teamId: null,
    name: name,
    age: age,
    heightIn: heightIn,
    weightLb: weightLb,
    position: position,
    jerseyNumber: null, // assigned when drafted
    yearsPro: 0,
    // No `overall` — it is a derived getter (ratings.js), installed below.
    // `potential` is likewise set below, since it is expressed relative to the
    // derived overall.
    contract: { salary: 0, yearsRemaining: 0, playerOption: false, teamOption: false }, // set on draft
    status: { morale: 70, fatigue: 0, injury: null },
    attributes: makeProspectAttributes(overall, archetype, prospectId),
    hiddenTraits: [],
    hiddenPersonality: {},
    hiddenTendencies: {},
    bustChance: bustChance,
    nbaComparison: nbaComparison,
    college: opts.college || autoData.college || null,
    dateOfBirth: opts.dateOfBirth || autoData.dateOfBirth || null
  };
  _PROSPECT_DATA.ratings.defineOverall(prospect);
  // Same headroom-preserving rule as players-2026.js's mkPlayer: the authored
  // gap re-expressed on the new scale, so `potential - overall` still drives
  // progression's development pull and potential >= overall holds.
  prospect.potential = Math.max(_PROSPECT_DATA.data.RATING_MIN, Math.min(_PROSPECT_DATA.data.RATING_MAX,
    prospect.rawOverall + Math.round(Math.max(0, potential - overall) * _PROSPECT_DATA.players.ANCHOR_SD_RATIO)));
  return prospect;
}

// College and estimated birth date for the real 2026 mock draft class (see
// DRAFT_PROSPECTS_2026 below). Some names below carry a disambiguating " Jr."
// suffix in the roster array where they'd otherwise collide with an existing
// NBA player's name — that suffix is kept here as part of the lookup key.
const PROSPECT_DATA_MAP = {
  'A.J. Dybantsa': { college: 'BYU', dateOfBirth: '2006-05-09' },
  'Cameron Boozer': { college: 'Duke', dateOfBirth: '2006-11-01' },
  'Darryn Peterson': { college: 'Kansas', dateOfBirth: '2006-08-27' },
  'Chris Cenac Jr.': { college: 'Houston', dateOfBirth: '2006-08-15' },
  'Nate Ament': { college: 'Tennessee', dateOfBirth: '2006-07-22' },
  'Caleb Wilson': { college: 'North Carolina', dateOfBirth: '2006-05-10' },
  'Koa Peat': { college: 'Arizona', dateOfBirth: '2006-08-01' },
  'Tounde Yessoufou': { college: 'Baylor', dateOfBirth: '2006-09-05' },
  'Cayden Boozer': { college: 'Duke', dateOfBirth: '2006-11-01' },
  'Jasper Johnson': { college: 'Kentucky', dateOfBirth: '2006-06-15' },
  'Alijah Arenas': { college: 'USC', dateOfBirth: '2006-12-01' },
  'Meleek Thomas': { college: 'Arkansas', dateOfBirth: '2006-04-20' },
  'Isiah Harwell': { college: 'Houston', dateOfBirth: '2006-05-01' },
  'Braylon Mullins': { college: 'UConn', dateOfBirth: '2005-09-01' },
  'Mikel Brown Jr.': { college: 'Louisville', dateOfBirth: '2006-08-01' },
  'Kiyan Anthony': { college: 'Syracuse', dateOfBirth: '2006-06-07' },
  'Labaron Philon': { college: 'Alabama', dateOfBirth: '2005-11-01' },
  'Dwayne Aristode': { college: 'Florida', dateOfBirth: '2006-01-01' },
  'Jerry Easter II': { college: 'Louisville', dateOfBirth: '2006-05-01' },
  'Sadiq White Jr.': { college: 'Auburn', dateOfBirth: '2006-03-01' },
  'Karim Lopez': { college: 'Overtime Elite', dateOfBirth: '2006-06-01' },
  'Christian Anderson': { college: 'Virginia', dateOfBirth: '2005-10-01' },
  'Roman Hall': { college: 'Nebraska', dateOfBirth: '2006-01-01' },
  'Jamier Jones': { college: 'South Florida', dateOfBirth: '2006-02-01' },
  'Sebastian Wilkins': { college: 'Rutgers', dateOfBirth: '2005-12-01' },
  'Vertrail Vaughns': { college: 'San Francisco', dateOfBirth: '2003-01-01' },
  'Bryson Stiggers': { college: 'Wichita State', dateOfBirth: '2005-06-01' },
  'Immanuel Sheppard': { college: 'Illinois', dateOfBirth: '2006-02-01' },
  'Elzie Harrington': { college: 'San Diego State', dateOfBirth: '2005-09-01' },
  'Traylen Roberts': { college: 'Louisville', dateOfBirth: '2006-01-01' },
  'Nique Clifford Jr.': { college: 'Iowa State', dateOfBirth: '2003-06-01' },
  'Boogie Fland': { college: 'Florida', dateOfBirth: '2005-08-06' },
  'Tre Johnson Jr.': { college: 'Kentucky', dateOfBirth: '2005-04-01' },
  'Milos Uzan': { college: 'Houston', dateOfBirth: '2003-05-01' },
  'Chance Westry': { college: 'Syracuse', dateOfBirth: '2003-01-01' },
  'Aday Mara': { college: 'UCLA', dateOfBirth: '2005-01-01' },
  'Tounde Zogbo': { college: 'Marquette', dateOfBirth: '2004-06-01' },
  'Rob Wright III': { college: 'Baylor', dateOfBirth: '2004-01-01' },
  'Jayden Quaintance': { college: 'Arizona State', dateOfBirth: '2006-01-01' },
  'Alex Condon Jr.': { college: 'Florida', dateOfBirth: '2004-03-01' },
  'Donovan Dent': { college: 'UCLA', dateOfBirth: '2003-11-01' },
  'Elliot Cadeau': { college: 'Michigan', dateOfBirth: '2005-06-01' },
  'Nate Bittle': { college: 'Oregon', dateOfBirth: '2003-01-01' },
  'Curtis Givens III': { college: 'Kentucky', dateOfBirth: '2004-01-01' },
  'Isaiah Elohim': { college: 'G League Ignite', dateOfBirth: '2004-01-01' },
  'Grant Nelson Jr.': { college: 'Alabama', dateOfBirth: '2001-01-01' },
  'Chaz Lanier': { college: 'Tennessee', dateOfBirth: '2000-01-01' },
  'Javon Small Jr.': { college: 'West Virginia', dateOfBirth: '2001-11-09' },
  'Rasheer Fleming Jr.': { college: "Saint Joseph's", dateOfBirth: '2004-08-10' },
  'Yaxel Lendeborg': { college: 'Michigan', dateOfBirth: '2002-01-01' },
  'Kobe Sanders Jr.': { college: 'Nevada', dateOfBirth: '2002-06-15' },
  'Kam Williams': { college: 'Notre Dame', dateOfBirth: '2003-01-01' },
  'Jamie Kaiser Jr.': { college: 'Villanova', dateOfBirth: '2003-01-01' },
  'Enrique Freeman Jr.': { college: 'Michigan State', dateOfBirth: '2001-01-01' },
  'Adou Thiero': { college: 'Arkansas', dateOfBirth: '2003-01-01' },
  'Silas Demary Jr.': { college: 'Georgia', dateOfBirth: '2004-01-01' },
  'Bennett Stirtz': { college: 'Drake', dateOfBirth: '2003-01-01' },
  'Zvonimir Ivisic Jr.': { college: 'Illinois', dateOfBirth: '2002-01-01' },
  'Otega Oweh': { college: 'Kentucky', dateOfBirth: '2003-01-01' },
  'Great Osobor': { college: 'Washington', dateOfBirth: '2002-01-01' }
};

const ARCHETYPE_NAMES = Object.keys(PROSPECT_ARCHETYPES);

// Every draft after the real 2026 class uses this — procedurally generated,
// same schema as a real prospect, but with a generic name. Overall is still
// rank-correlated (early picks skew better, same idea as a real class), but
// potential is no longer a flat formula — see estimatePotentialMonteCarlo
// (progression.js): it actually simulates the prospect's likely career
// forward and reports the 75th-percentile ceiling reached, which naturally
// tracks age/attributes/personality instead of just draft slot.
// leagueYear is the season this class is generated during — the class is
// drafted in the offseason that follows, so it is also the year every prospect
// in it enters the league. It is stamped on each prospect as firstLeagueYear,
// which is the ONLY thing that ever makes a player eligible to be someone's
// father eighteen seasons later. The real 2026 players never get one, and so
// can never be fathers: inventing a child for a real person is a different
// thing from generating a fictional lineage.
function generateProspectClass(rng, count, leagueYear) {
  const prospects = [];
  // One set for the whole class, seeded with everyone who already has a name —
  // the active league and the retiree archive — and added to as each prospect
  // is named, so no two members of a class collide either.
  const takenNames = existingPlayerNames();
  for (let i = 0; i < count; i++) {
    const rankFactor = 1 - i / count; // 1.0 for pick 1, ->0 for the last pick
    // 55 + 20, down from 58 + 22 for the 2K27 face-value league: the target
    // here is a DISPLAY overall, and on the 2K grading curve the old band let
    // a top pick enter at 84-88 — an All-NBA rookie, where real 2K rookies
    // top out around 79-81. Entering that high, seven growth years minted
    // four 99s in a single measured class. The trimmed band tops out at 79.
    const overall = Math.round(55 + rankFactor * 20 + (rng() - 0.5) * 8);
    const archetype = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)];
    const position = _PROSPECT_DATA.data.POSITIONS[Math.floor(rng() * _PROSPECT_DATA.data.POSITIONS.length)];
    // No random " Jr." any more. It used to be tacked on 15% of the time to a
    // player with no father in the league, which invented a second near-copy of
    // an existing name for no reason. A Jr. is now earned: relatives.js appends
    // it when a generated son shares his father's first name.
    const name = _PROSPECT_DATA.names.pickUniqueName(rng, takenNames);
    const age = 18 + Math.floor(rng() * 4);
    const phys = samplePhysicals(position, rng);
    const heightIn = phys.heightIn;
    const weightLb = phys.weightLb;
    const bustChance = Math.round((0.15 + (1 - rankFactor) * 0.35) * 100) / 100;
    const clampedOverall = Math.max(40, Math.min(80, overall));
    const prospect = mkProspect(name.trim(), age, heightIn, weightLb, position, clampedOverall, clampedOverall, archetype, bustChance, 'Unproven', { rng: rng });
    prospect.wingspanIn = phys.wingspanIn;
    prospect.hiddenTraits = _PROSPECT_DATA.traits.generateHiddenTraits(prospect, rng);
    prospect.hiddenPersonality = _PROSPECT_DATA.traits.generatePersonality(prospect, rng);
    prospect.hiddenTendencies = _PROSPECT_DATA.traits.generateTendencies(prospect, rng);
    prospect.face = _PROSPECT_DATA.faces.generateFace(rng);
    // `potential` is stored RAW — progression.js:138 differences it against
    // rawOverall. Both guards here used to be on the AUTHORED scale, which runs
    // roughly thirty points higher, so both were nonsense in this field:
    //
    //   Math.max(clampedOverall, ...)  floored every prospect's ceiling at his
    //     authored number (58-90). The league's median raw overall is 47 and its
    //     best player is 85, so the WORST pick in every draft was handed a
    //     ceiling above the median NBA player and the top pick a ceiling above
    //     anyone alive. Measured: 0 of 64 prospects had a ceiling below the
    //     league median, and the floor was overriding the Monte Carlo estimate
    //     it was supposed to be a backstop for by +30.4 raw on average.
    //   Math.min(99, ...)  capped at raw 99, which the display curve maps off
    //     the top of the scale; it never bound anything.
    //
    // The floor is now the prospect's own rawOverall (potential >= overall, the
    // invariant it was always meant to express) and the cap is display 99
    // translated into raw, preserving the original intent on the right scale.
    prospect.potential = Math.max(prospect.rawOverall,
      Math.min(_PROSPECT_DATA.ratings.toRawRating(99),
        _PROSPECT_DATA.progression.estimatePotentialMonteCarlo(prospect, rng)));
    // Rolled here, right after the ceiling is set and before anyone can read
    // it, so no part of the game ever sees the un-busted ceiling of a prospect
    // who busts. See applyBustRoll for why this existed but never ran.
    applyBustRoll(prospect, rng);
    prospect.firstLeagueYear = leagueYear;
    prospects.push(prospect);
  }

  // Only NEW generations get families. Names and attributes are settled here,
  // after the whole class exists, because a son takes his father's surname and
  // leans toward his ratings — both of which have to happen before anyone
  // scouts him, and neither of which can be decided one prospect at a time.
  // Active players AND retirees. A father needs eighteen seasons of service
  // before his son can be drafted, which is longer than almost anyone plays —
  // so passing only the active league meant the eligible pool was nearly always
  // empty and twenty seasons produced zero sons. The spec always said "retired
  // or active"; this is the half that was missing.
  _PROSPECT_DATA.relatives.assignFamilies(
    prospects, possibleFathers(), leagueYear, rng, takenNames);

  return prospects;
}

// `bustChance` was computed on every prospect (line 193, scaled by draft slot
// from 0.15 at the top to 0.50 at the end of the second round), stored on the
// object, surfaced nowhere, and read by NOTHING. Three writes, zero reads —
// the counterweight the draft was designed around was never wired up, so every
// prospect in every class developed as though he had hit.
//
// A bust is not a player who gets worse; he is a player who never reaches the
// ceiling he was scouted at. So the roll collapses `potential` toward what he
// actually is, keeping a fraction of the gap — some busts do develop a little.
// Everything downstream then follows for free: progression.js's gap-pull has
// almost nothing left to pull toward, and tradeEvaluator/scouting stop valuing
// him as a future star.
//
// He is NOT told he is a bust, and neither is the user. `potential` is what
// scouting fuzzes and displays, so a busted prospect simply stops improving —
// which is what busting looks like from the outside.
//
// `retainedGap` is calibrated, not chosen: scripts/sweep-growth-tuning.js sweeps
// it against superstars-per-draft-class. `chanceScale` multiplies the authored
// bustChance so the RATE of busting can be calibrated separately from how hard
// a bust lands. An object rather than two consts so the sweep can vary them
// without reaching into module internals.
// `developmentRate` is the part that actually bites. Collapsing `potential`
// alone barely moved the superstar rate (20.2 -> 17.6 per class, measured)
// because potential only feeds progression's gap-pull — the age curve grows a
// player regardless of what his ceiling says. A bust who still gets the full
// age curve still becomes a star, just later.
//
// So a bust also develops SLOWLY: the multiplier is applied to positive base
// change only (progression.js), so busts stop climbing but still decline
// normally with age. That is what busting actually looks like.
//
// Doing it per-player rather than by damping the global curve is deliberate.
// Lowering everyone's growth would flatten the league and make the 2026
// veterans wrong too; this leaves a prospect who HITS developing exactly as
// fast as before, which is what keeps 2-4 stars a class feeling like stars.
// Swept in scripts/sweep-growth-tuning.js alongside progression's GROWTH_TUNING;
// config D. chanceScale multiplies the authored per-slot bustChance, so the
// realised range is 0.375 at the top of the draft to 1.0 by the end of the
// second round — late second-rounders essentially never pan out, which is both
// what the sweep needed and what the NBA looks like.
var BUST_TUNING = { retainedGap: 0.10, chanceScale: 2.5, developmentRate: 0.20 };

function applyBustRoll(prospect, rng) {
  if (!prospect || typeof prospect.bustChance !== 'number') return false;
  // Clamped: chanceScale pushes the late-round values past 1.0, and a
  // probability above 1 that reads as "1.25" invites someone to believe the
  // extra 0.25 means something.
  if (rng() >= Math.min(1, prospect.bustChance * BUST_TUNING.chanceScale)) return false;
  prospect.developmentRate = BUST_TUNING.developmentRate;
  const gap = prospect.potential - prospect.rawOverall;
  if (gap <= 0) return true;
  prospect.potential = Math.round(prospect.rawOverall + gap * BUST_TUNING.retainedGap);
  return true;
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

// --- Real 2026 NBA Draft class, mock slots 46-60 (round 2, part 2 — class complete) ---
DRAFT_PROSPECTS_2026.push(mkProspect('Grant Nelson Jr.', 22, 82, 230, 'PF', 57, 66, 'rim_protector', 0.48, 'PJ Tucker'));
DRAFT_PROSPECTS_2026.push(mkProspect('Chaz Lanier', 22, 77, 200, 'SG', 57, 65, 'three_and_d', 0.48, 'Duncan Robinson'));
DRAFT_PROSPECTS_2026.push(mkProspect('Javon Small Jr.', 22, 74, 185, 'PG', 56, 65, 'playmaker', 0.49, 'Monte Morris'));
DRAFT_PROSPECTS_2026.push(mkProspect('Rasheer Fleming Jr.', 21, 81, 225, 'PF', 56, 67, 'three_and_d', 0.48, 'PJ Washington'));
DRAFT_PROSPECTS_2026.push(mkProspect('Yaxel Lendeborg', 22, 80, 220, 'PF', 56, 66, 'rim_protector', 0.49, 'Nic Claxton'));
DRAFT_PROSPECTS_2026.push(mkProspect('Kobe Sanders Jr.', 23, 79, 195, 'SG', 55, 63, 'slasher', 0.50, 'Josh Okogie'));
DRAFT_PROSPECTS_2026.push(mkProspect('Kam Williams', 20, 76, 190, 'SG', 55, 68, 'three_and_d', 0.48, 'Sam Hauser'));
DRAFT_PROSPECTS_2026.push(mkProspect('Jamie Kaiser Jr.', 21, 78, 205, 'SF', 55, 65, 'three_and_d', 0.50, 'Corey Kispert'));
DRAFT_PROSPECTS_2026.push(mkProspect('Enrique Freeman Jr.', 23, 80, 220, 'PF', 55, 62, 'rim_protector', 0.51, 'Bruce Brown'));
DRAFT_PROSPECTS_2026.push(mkProspect('Adou Thiero', 21, 79, 210, 'SF', 54, 66, 'slasher', 0.50, 'Herbert Jones'));
DRAFT_PROSPECTS_2026.push(mkProspect('Silas Demary Jr.', 20, 76, 190, 'SG', 54, 67, 'primary_scorer', 0.50, 'Anfernee Simons'));
DRAFT_PROSPECTS_2026.push(mkProspect('Bennett Stirtz', 22, 74, 180, 'PG', 54, 63, 'playmaker', 0.51, 'T.J. McConnell'));
DRAFT_PROSPECTS_2026.push(mkProspect('Zvonimir Ivisic Jr.', 22, 85, 235, 'C', 53, 63, 'rim_protector', 0.52, 'Walker Kessler'));
DRAFT_PROSPECTS_2026.push(mkProspect('Otega Oweh', 22, 77, 205, 'SG', 53, 61, 'slasher', 0.52, 'Josh Okogie'));
DRAFT_PROSPECTS_2026.push(mkProspect('Great Osobor', 22, 80, 245, 'PF', 52, 60, 'rim_protector', 0.53, 'Steven Adams'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mkProspect: mkProspect,
    generateProspectClass: generateProspectClass,
    applyBustRoll: applyBustRoll,
    BUST_TUNING: BUST_TUNING,
    DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026
  };
}
