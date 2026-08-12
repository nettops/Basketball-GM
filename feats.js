// Single-game feats: the moments worth remembering, detected from one
// box-score line and nothing else.
//
// Pure by design. Detection takes a line and a context and returns records; it
// reads no globals, opens no storage and knows no dates. That is what lets
// every threshold be tested directly instead of by simulating games until one
// happens to fire.
//
// Chosen by measured rate, not tradition. scripts/probe-feats.js over 4000
// games (101,341 player-lines), scaled to a 1230-game season. Nights at or
// above each points bar, league-wide per season:
//
//   40 -> 710.6    52 ->  88.3    57 -> 29.5    62 ->  8.0
//   45 -> 343.5    54 ->  58.4    58 -> 22.4    63 ->  6.2
//   48 -> 202.9    55 ->  48.0    59 -> 16.3    65 ->  4.0
//   50 -> 136.2    56 ->  37.8    60 -> 12.3    70 ->  1.2
//
// Three-category nights at each bar:  10 -> 596.5   12 -> 226.0   14 -> 72.9
//                                     11 -> 381.3   13 -> 134.4   15 -> 34.1
//
// All-five nights:  3+ -> 26.1     4+ -> 3.4     5+ -> 0.0 (0 in 101,341)
//
// Target bands: big 15-40 a season, huge 1-6, triple-double 40-120,
// five-by-five 0-3. Each bar is the LOWEST measured value landing in its band.
// Our league scores ~135 a team, so the traditional 50-point night fires 136
// times a season here and the bar lands well above it; the same inflation is
// why the three-category bar is 14 rather than basketball's 10.
//
// The five-by-five is the one bar left at its traditional value, and it is the
// rarest thing in the game: 5 steals AND 5 blocks in the same night did not
// occur once in the 4000-game sample above, but did occur once in a separate
// 3000-game sample (validate-feats.js, seed 31337). One in ~7000 games is
// roughly once every five or six seasons of league play — a genuine
// once-a-save event, which is the point of keeping it. Its rate band floor is
// 0, so the band cannot prove detection works; the hand-built boundary case in
// scripts/validate-feats.js is what does.
//
// Mutable holder rather than bare consts so the calibration probe can move
// them for one run without editing committed source — the same shape as
// freeAgency.js's RESIGN_TUNING and seasonTransition.js's RETIREMENT_TUNING.
var FEAT_TUNING = { bigScoring: 56, hugeScoring: 65, doubleAt: 14, fiveAt: 5 };

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
