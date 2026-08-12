// Family lines between players.
//
// Links are ALWAYS written in both directions, so answering "does this player
// have relatives" never requires scanning the league. A father gets a son entry
// and the son gets a father entry, in the same call.
var _RELATIVES_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js') }
  : { players: { PLAYERS_2026: PLAYERS_2026 } };

// A father must have entered the league at least this many seasons before his
// son's draft, so the timeline is never absurd. It also means a fresh save
// generates no sons at all for its first eighteen years — that is the expected
// result, not a failure.
const ELIGIBLE_FATHER_GAP = 18;

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

function surnameOf(name) {
  const parts = String(name).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  // "Jr." is a suffix, not a surname.
  return (last === 'Jr.' && parts.length > 2) ? parts[parts.length - 2] : last;
}

function firstNameOf(name) { return String(name).trim().split(/\s+/)[0]; }

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
function assignFamilies(prospects, allPlayers, leagueYear, rng) {
  const fathers = eligibleFathers(allPlayers, leagueYear);
  let sons = 0, brothers = 0;

  prospects.forEach(function (prospect) {
    if (fathers.length === 0) return;
    if (rng() >= RELATIVE_TUNING.sonChance) return;
    const father = fathers[Math.floor(rng() * fathers.length)];
    if (!father) return;
    prospect.name = firstNameOf(prospect.name) + ' ' + surnameOf(father.name);
    inheritAttributes(prospect, father);
    link(father, prospect, 'father');
    sons++;
  });

  for (let i = 0; i + 1 < prospects.length; i++) {
    if (rng() >= RELATIVE_TUNING.brotherChance) continue;
    const a = prospects[i], b = prospects[i + 1];
    if (relativesOf(a).length || relativesOf(b).length) continue;
    b.name = firstNameOf(b.name) + ' ' + surnameOf(a.name);
    link(a, b, 'brother');
    brothers++;
    i++;   // a player is in at most one brother pair
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
