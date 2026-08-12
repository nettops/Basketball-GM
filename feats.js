// Single-game feats: the moments worth remembering, detected from one
// box-score line and nothing else.
//
// Pure by design. Detection takes a line and a context and returns records; it
// reads no globals, opens no storage and knows no dates. That is what lets
// every threshold be tested directly instead of by simulating games until one
// happens to fire.
//
// The bars in FEAT_TUNING are placeholders until Task 2 measures them. They are
// a mutable holder rather than bare consts so the calibration probe can move
// them for one run without editing committed source — the same shape as
// freeAgency.js's RESIGN_TUNING and seasonTransition.js's RETIREMENT_TUNING.
var FEAT_TUNING = { bigScoring: 50, hugeScoring: 60, doubleAt: 10, fiveAt: 5 };

const FEAT_KINDS = ['bigScoring', 'hugeScoring', 'tripleDouble', 'fiveByFive'];

// The five categories a double or a five counts across.
const FEAT_CATEGORIES = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

function featCategoryCount(line, bar) {
  return FEAT_CATEGORIES.reduce(function (n, key) {
    return (line[key] || 0) >= bar ? n + 1 : n;
  }, 0);
}

function makeFeat(kind, line, context) {
  return {
    leagueYear: context.leagueYear,
    day: context.day,
    playerId: context.playerId,
    playerName: context.playerName,
    teamId: context.teamId,
    oppTeamId: context.oppTeamId,
    kind: kind,
    points: line.points || 0,
    rebounds: line.rebounds || 0,
    assists: line.assists || 0,
    steals: line.steals || 0,
    blocks: line.blocks || 0
  };
}

// Zero or more feats for one line. A huge scoring night reports ONLY as huge:
// listing it as both would double-count it in every rate measurement and make
// the page read as though the player did two remarkable things.
function detectFeats(line, context) {
  if (!line) return [];
  const out = [];
  const points = line.points || 0;

  if (points >= FEAT_TUNING.hugeScoring) {
    out.push(makeFeat('hugeScoring', line, context));
  } else if (points >= FEAT_TUNING.bigScoring) {
    out.push(makeFeat('bigScoring', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.doubleAt) >= 3) {
    out.push(makeFeat('tripleDouble', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.fiveAt) === FEAT_CATEGORIES.length) {
    out.push(makeFeat('fiveByFive', line, context));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectFeats: detectFeats,
    featCategoryCount: featCategoryCount,
    FEAT_TUNING: FEAT_TUNING,
    FEAT_KINDS: FEAT_KINDS,
    FEAT_CATEGORIES: FEAT_CATEGORIES
  };
}
