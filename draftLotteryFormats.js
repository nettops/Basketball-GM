// Configurable draft lottery formats, inspired by the odds tables and format
// history catalogued in ZenGM's universal-draft-lottery-simulator
// (reference/universal-draft-lottery-simulator). That project computes exact
// probabilities via dynamic programming + bitmasks + a hypergeometric
// fallback because it supports arbitrary team counts and pick counts. Our
// scale is fixed and small (<=16 lottery teams, <=4 drawn picks), so exact
// probabilities here are just brute-force recursion over every draw order —
// no DP/Monte-Carlo needed, and it's exact rather than approximate.
var _LOTTERY_FMT_DATA = (typeof require !== 'undefined')
  ? {}
  : {};

// Real NBA 2019-2026 combination odds (out of 1000) for the 14 lottery
// teams, worst record first. If a league has more/fewer lottery teams than
// 14 (custom league size, expansion), the table is truncated/padded with its
// last value rather than requiring an exact 14-team league.
const NBA_2019_ODDS_TABLE = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

function tableWeights(table, count) {
  const weights = [];
  for (let i = 0; i < count; i++) {
    weights.push(table[i] !== undefined ? table[i] : table[table.length - 1]);
  }
  return weights;
}

const LOTTERY_FORMATS = {
  // Preserves this project's original behavior exactly (worse record ->
  // quadratically better odds, no hard cap on how many teams can win big).
  // Kept as the default so existing saves/tests see no behavior change.
  classicCurve: {
    key: 'classicCurve',
    label: 'Classic Curve (default)',
    description: 'Odds scale with (30 − wins)², no historical odds table. The tank-friendliest option.',
    numLotteryPicks: 4,
    getWeights: function (sortedTeamsWorstFirst) {
      return sortedTeamsWorstFirst.map(function (t) { return Math.pow(Math.max(1, 30 - t.record.wins), 2); });
    }
  },
  nba2019: {
    key: 'nba2019',
    label: 'NBA 2019–2026',
    description: 'Real NBA odds table — the three worst teams are tied at 14% each to discourage race-to-the-bottom tanking.',
    numLotteryPicks: 4,
    getWeights: function (sortedTeamsWorstFirst) {
      return tableWeights(NBA_2019_ODDS_TABLE, sortedTeamsWorstFirst.length);
    }
  },
  equalOdds: {
    key: 'equalOdds',
    label: 'Equal Odds (NBA 1987–1989 style)',
    description: 'Every lottery team has the same chance at each of the top picks.',
    numLotteryPicks: 4,
    getWeights: function (sortedTeamsWorstFirst) {
      return sortedTeamsWorstFirst.map(function () { return 1; });
    }
  },
  coinFlip: {
    key: 'coinFlip',
    label: 'Coin Flip (NBA 1966–1984 style)',
    description: 'Only the two worst teams have a shot at picks 1–2, decided by a straight coin flip. Everyone else picks by standings.',
    numLotteryPicks: 2,
    getWeights: function (sortedTeamsWorstFirst) {
      return sortedTeamsWorstFirst.map(function (t, i) { return i < 2 ? 1 : 0; });
    }
  },
  noLottery: {
    key: 'noLottery',
    label: 'No Lottery',
    description: 'Straight worst-record-first order, no randomness at all.',
    numLotteryPicks: 0,
    getWeights: function (sortedTeamsWorstFirst) {
      return sortedTeamsWorstFirst.map(function () { return 1; });
    }
  }
};

const DEFAULT_LOTTERY_FORMAT = 'classicCurve';

function getLotteryFormat(key) {
  return LOTTERY_FORMATS[key] || LOTTERY_FORMATS[DEFAULT_LOTTERY_FORMAT];
}

// Exact probability of each team landing in each drawn-position (0-indexed)
// via brute-force recursion over the whole draw tree. Tractable at our scale
// (<=16 teams, <=4 picks drawn -> at most 16*15*14*13 ≈ 43.7k leaf branches).
// Returns { [teamId]: [P(pick1), P(pick2), ...] }, one entry per lottery team.
function computeLotteryProbabilities(sortedTeamsWorstFirst, format) {
  const numPicks = format.numLotteryPicks;
  const weights = format.getWeights(sortedTeamsWorstFirst);
  const n = sortedTeamsWorstFirst.length;
  const result = {};
  sortedTeamsWorstFirst.forEach(function (t) { result[t.id] = new Array(numPicks).fill(0); });
  if (numPicks === 0) return result;

  function recurse(remainingIdx, depth, cumProb) {
    if (depth === numPicks || remainingIdx.length === 0) return;
    const totalWeight = remainingIdx.reduce(function (s, idx) { return s + weights[idx]; }, 0);
    if (totalWeight <= 0) return;
    remainingIdx.forEach(function (idx) {
      const w = weights[idx];
      if (w <= 0) return;
      const p = cumProb * (w / totalWeight);
      result[sortedTeamsWorstFirst[idx].id][depth] += p;
      const nextRemaining = remainingIdx.filter(function (i) { return i !== idx; });
      recurse(nextRemaining, depth + 1, p);
    });
  }

  const allIdx = [];
  for (let i = 0; i < n; i++) allIdx.push(i);
  recurse(allIdx, 0, 1);
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LOTTERY_FORMATS: LOTTERY_FORMATS,
    DEFAULT_LOTTERY_FORMAT: DEFAULT_LOTTERY_FORMAT,
    getLotteryFormat: getLotteryFormat,
    computeLotteryProbabilities: computeLotteryProbabilities
  };
}
