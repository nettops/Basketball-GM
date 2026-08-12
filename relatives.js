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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    link: link,
    relativesOf: relativesOf,
    ensureRelatives: ensureRelatives,
    ELIGIBLE_FATHER_GAP: ELIGIBLE_FATHER_GAP
  };
}
