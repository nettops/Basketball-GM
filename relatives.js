// Family lines between players.
//
// Links are ALWAYS written in both directions, so answering "does this player
// have relatives" never requires scanning the league. A father gets a son entry
// and the son gets a father entry, in the same call.
var _RELATIVES_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js'), names: require('./names.js') }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      names: {
        takenNameSet: takenNameSet, isNameTaken: isNameTaken, claimName: claimName,
        normalizeName: normalizeName, firstNameOfName: firstNameOfName,
        surnameOfName: surnameOfName, PLAYER_FIRST_NAMES: PLAYER_FIRST_NAMES
      }
    };

// A father must have entered the league at least this many seasons before his
// son's draft, so the timeline is never absurd.
//
// Lowered from 18 to 13 after measuring what 18 actually cost. The gap is
// counted from the father's OWN arrival, and the first generated class does not
// enter until 2028 — so 18 put the first father-son pair in 2049, season 24 of
// a save. Measured, not estimated: scripts/probe-families.js over 25 seasons.
// A feature nobody reaches is not a feature.
//
// 13 puts a father at roughly 32-35 when his son is drafted, which is still an
// entirely ordinary age to have a nineteen-year-old. Below about 11 it starts
// producing fathers who would have been in their teens, so this is close to the
// floor rather than an arbitrary reduction.
//
// It still means a fresh save generates no sons for its first several years —
// that is the expected result, not a failure.
const ELIGIBLE_FATHER_GAP = 13;

function ensureRelatives(player) {
  if (!player.relatives) player.relatives = [];
  return player.relatives;
}

function addOne(player, type, other) {
  const list = ensureRelatives(player);
  const already = list.some(function (r) { return r.playerId === other.id && r.type === type; });
  if (already) return;
  list.push({ type: type, playerId: other.id, name: other.name });
}

// type 'father' means a IS b's father. type 'brother' is symmetric.
function link(a, b, type) {
  if (!a || !b || a.id === b.id) return;
  if (type === 'father') {
    addOne(a, 'son', b);
    addOne(b, 'father', a);
  } else {
    addOne(a, 'brother', b);
    addOne(b, 'brother', a);
  }
}

function relativesOf(player) {
  return (player && player.relatives) || [];
}

// Rates set by measurement and asserted in band by validate-relatives.js — a
// family link should be a pleasant surprise, not routine.
//
// Swept over 2000 draft classes of 60 prospects against 40 eligible fathers.
// The rate reported is the share of CLASSES containing at least one such link,
// which is what a player actually experiences — not the per-prospect chance:
//
//   sonChance      0.0020 -> 11.4%   0.0040 -> 21.4%   0.0060 -> 30.9%
//                  0.0030 -> 17.4%   0.0050 -> 26.6%   0.0080 -> 37.9%
//     target band 15-35%
//
//   brotherChance  0.0008 ->  4.5%   0.0018 -> 10.6%   0.0030 -> 16.6%
//                  0.0012 ->  6.6%   0.0024 -> 13.2%   0.0040 -> 21.4%
//     target band 5-15%
//
// Both chosen values sit near the middle of their band rather than against an
// edge, so an incidental change to class size does not immediately push them
// out. Mutable so a later sweep can move them without editing committed source.
var RELATIVE_TUNING = { sonChance: 0.004, brotherChance: 0.0018, inheritance: 0.15 };

// Delegated to names.js so there is one definition of where a surname ends.
// The version that used to live here only knew about "Jr."; now that a son who
// shares his father's first name earns a Jr. and a third generation earns a
// III, the suffix list has to be shared with the code that appends them.
function surnameOf(name) { return _RELATIVES_DATA.names.surnameOfName(name); }
function firstNameOf(name) { return _RELATIVES_DATA.names.firstNameOfName(name); }

// Family names are the one place two players can legitimately want the same
// name: a son taking his father's surname may land exactly on his father's full
// name. That is what "Jr." is for. Anything else that collides gets a fresh
// first name rather than a suffix, because a suffix would assert a relationship
// that isn't there.
const GENERATION_SUFFIXES = ['Jr.', 'III', 'IV', 'V'];

function familyName(prospect, surname, taken, rng, relativeName) {
  const names = _RELATIVES_DATA.names;
  const base = firstNameOf(prospect.name) + ' ' + surname;
  if (!names.isNameTaken(taken, base)) return names.claimName(taken, base);

  // Collided with the relative himself — father and son share a first name.
  if (relativeName && names.normalizeName(base) === names.normalizeName(relativeName)) {
    for (let i = 0; i < GENERATION_SUFFIXES.length; i++) {
      const suffixed = base + ' ' + GENERATION_SUFFIXES[i];
      if (!names.isNameTaken(taken, suffixed)) return names.claimName(taken, suffixed);
    }
  }

  // Collided with somebody unrelated. Keep the surname, change the first name.
  const pool = names.PLAYER_FIRST_NAMES;
  const start = Math.floor(rng() * pool.length);
  for (let k = 0; k < pool.length; k++) {
    const candidate = pool[(start + k) % pool.length] + ' ' + surname;
    if (!names.isNameTaken(taken, candidate)) return names.claimName(taken, candidate);
  }
  // Every first name in the pool is already paired with this surname. Leave the
  // prospect's own unique name alone rather than hand back a duplicate.
  return prospect.name;
}

// A father has to have been in this league long enough to have a son old enough
// to be drafted. Anyone without a firstLeagueYear — which is every real 2026
// player — is not eligible at all: a son link writes a `son` entry onto the
// father, and inventing a child for a real person is a different thing from
// generating a fictional lineage.
function eligibleFathers(allPlayers, leagueYear) {
  return (allPlayers || []).filter(function (p) {
    const first = p.firstLeagueYear;
    return typeof first === 'number' && leagueYear - first >= ELIGIBLE_FATHER_GAP;
  });
}

// Moves each of the son's attributes a fraction of the way toward his father's,
// so the resemblance is visible in the ratings without a star's son simply
// becoming a star. It pulls downward as readily as up.
function inheritAttributes(son, father) {
  if (!son.attributes || !father.attributes) return;
  Object.keys(son.attributes).forEach(function (key) {
    const dadValue = father.attributes[key];
    if (typeof dadValue !== 'number') return;
    son.attributes[key] = Math.round(
      son.attributes[key] + (dadValue - son.attributes[key]) * RELATIVE_TUNING.inheritance);
  });
}

// Mutates prospects in place. Returns how many of each link were made, so the
// caller can report and the rate can be measured.
// `taken` is the class's name set, threaded in from generateProspectClass so a
// rename cannot recreate the duplicate the unique-name generator just avoided.
// Callers that don't have one (the tests) get a set built from the players and
// prospects they passed.
function assignFamilies(prospects, allPlayers, leagueYear, rng, taken) {
  const fathers = eligibleFathers(allPlayers, leagueYear);
  const names = _RELATIVES_DATA.names;
  const takenNames = taken || names.takenNameSet(allPlayers, prospects);
  let sons = 0, brothers = 0;

  prospects.forEach(function (prospect) {
    if (fathers.length === 0) return;
    if (rng() >= RELATIVE_TUNING.sonChance) return;
    const father = fathers[Math.floor(rng() * fathers.length)];
    if (!father) return;
    prospect.name = familyName(prospect, surnameOf(father.name), takenNames, rng, father.name);
    inheritAttributes(prospect, father);
    link(father, prospect, 'father');
    sons++;
  });

  // The already-linked check is what actually keeps a player to one family: it
  // stops a son from also being made someone's brother, and it stops the
  // second half of a pair from being re-used. The extra i++ is NOT the
  // guarantee — deleting it changes no link, only how many rolls the loop
  // makes, because the check catches the same case one step later. It stays
  // because skipping a roll we know cannot fire is cheaper and clearer.
  for (let i = 0; i + 1 < prospects.length; i++) {
    if (rng() >= RELATIVE_TUNING.brotherChance) continue;
    const a = prospects[i], b = prospects[i + 1];
    if (relativesOf(a).length || relativesOf(b).length) continue;
    // No relativeName passed: brothers share a surname, never a full name, so a
    // collision here is never a generational one and must not earn a "Jr.".
    b.name = familyName(b, surnameOf(a.name), takenNames, rng, null);
    link(a, b, 'brother');
    brothers++;
    i++;
  }

  return { sons: sons, brothers: brothers };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    link: link,
    relativesOf: relativesOf,
    ensureRelatives: ensureRelatives,
    assignFamilies: assignFamilies,
    eligibleFathers: eligibleFathers,
    surnameOf: surnameOf,
    firstNameOf: firstNameOf,
    inheritAttributes: inheritAttributes,
    RELATIVE_TUNING: RELATIVE_TUNING,
    ELIGIBLE_FATHER_GAP: ELIGIBLE_FATHER_GAP
  };
}
