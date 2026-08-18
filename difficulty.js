// Difficulty. One named setting that scales dials the game already has, and
// touches nothing else.
//
// The hard rule, and the reason this file is as small as it is: DIFFICULTY MUST
// NEVER REACH THE SIM. A mode that quietly moved shot percentages or nudged a
// close game would make every result in the save unreadable — you could never
// tell whether a team lost because it was worse or because the setting decided
// it should. So difficulty adjusts what the league DOES AROUND you: how shrewdly
// rivals trade, how much free agents prefer somebody else, how long the owner
// waits. Never what happens once the ball is in the air.
//
// scripts/validate-difficulty.js asserts exactly that, by simulating the same
// seeded game under every mode and requiring an identical box score. That test
// is the point of the file.
//
// Pure and at file scope: a mode is a lookup and a multiply.

// Every mode is expressed as a multiplier on 1 (or an offset from 0), so
// `normal` is provably a no-op — a difficulty system whose default is not
// exactly neutral silently changes every existing save.
const DIFFICULTY_MODES = {
  relaxed: {
    label: 'Relaxed',
    blurb: 'Rivals trade poorly, free agents like you, and the owner is patient.',
    ownerPatienceOffset: 1,
    aiTradeShrewdness: 0.85,
    rivalFreeAgentPull: 0.85
  },
  normal: {
    label: 'Normal',
    blurb: 'The league as designed.',
    ownerPatienceOffset: 0,
    aiTradeShrewdness: 1,
    rivalFreeAgentPull: 1
  },
  tough: {
    label: 'Tough',
    blurb: 'Rivals drive harder bargains and the owner watches more closely.',
    ownerPatienceOffset: 0,
    aiTradeShrewdness: 1.15,
    rivalFreeAgentPull: 1.15
  },
  brutal: {
    label: 'Brutal',
    blurb: 'Every other club is sharp, every free agent has options, and one bad season is enough.',
    ownerPatienceOffset: -1,
    aiTradeShrewdness: 1.3,
    rivalFreeAgentPull: 1.3
  }
};

const DEFAULT_DIFFICULTY = 'normal';

function getDifficulty(key) {
  return DIFFICULTY_MODES[key] || DIFFICULTY_MODES[DEFAULT_DIFFICULTY];
}

// Never below 1. A patience of zero would sack the GM at the first review he
// ever faced, before he had taken a single decision — which is not a difficulty
// setting, it is a broken save.
function patienceFor(basePatience, key) {
  return Math.max(1, basePatience + getDifficulty(key).ownerPatienceOffset);
}

function tradeShrewdnessFor(key) {
  return getDifficulty(key).aiTradeShrewdness;
}

function rivalFreeAgentPullFor(key) {
  return getDifficulty(key).rivalFreeAgentPull;
}

// Writes the two mutable tuning holders the rest of the game already reads.
// Called whenever the setting changes, a save loads, or a season starts —
// wherever the mode could differ from what the holders currently say.
//
// Passed in rather than required, so this file keeps its one useful property:
// it depends on nothing, which is what makes "difficulty cannot reach the sim"
// checkable by reading it.
function applyDifficulty(key, tradeTuning, marketTuning) {
  const mode = getDifficulty(key);
  if (tradeTuning) tradeTuning.shrewdness = mode.aiTradeShrewdness;
  if (marketTuning) marketTuning.rivalPull = mode.rivalFreeAgentPull;
  return mode;
}

function difficultyKeys() {
  return Object.keys(DIFFICULTY_MODES);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIFFICULTY_MODES: DIFFICULTY_MODES,
    DEFAULT_DIFFICULTY: DEFAULT_DIFFICULTY,
    getDifficulty: getDifficulty,
    patienceFor: patienceFor,
    tradeShrewdnessFor: tradeShrewdnessFor,
    rivalFreeAgentPullFor: rivalFreeAgentPullFor,
    difficultyKeys: difficultyKeys,
    applyDifficulty: applyDifficulty
  };
}
