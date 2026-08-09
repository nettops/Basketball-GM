// A gate that reads a rating must catch a population that is neither empty nor
// the whole league. Nothing asserted that, and five separate gates rotted
// silently when `overall` became a regression and its mean fell from 74.7 to
// 47.8 — three caught 0/380 players, and the retirement penalty INVERTED to
// catch 356/380. Eight superstar traits were authored and never once held.
//
// Every check here exercises the REAL code path. A tripwire that re-implements
// the predicate it is guarding would have stayed green through the entire
// outage it exists to catch — that is the whole lesson of validate-traitsAreLive.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const ratings = require(path.join(__dirname, '..', 'ratings.js'));
const morale = require(path.join(__dirname, '..', 'morale.js'));
const seasonTransition = require(path.join(__dirname, '..', 'seasonTransition.js'));
const tradeEvaluator = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

PLAYERS_2026.forEach(function (p) { ratings.defineOverall(p); });
const N = PLAYERS_2026.length;

function assertShare(label, count, lo, hi) {
  const share = count / N;
  assert.ok(count > 0, label + ' catches NOBODY (' + count + '/' + N + ') — the gate is dead');
  assert.ok(count < N, label + ' catches EVERYBODY (' + count + '/' + N + ') — the gate is not a gate');
  assert.ok(share >= lo && share <= hi,
    label + ' catches ' + count + '/' + N + ' = ' + (100 * share).toFixed(1) +
    '%, intended ' + (100 * lo).toFixed(0) + '-' + (100 * hi).toFixed(0) + '%');
}

// Exercised through real trait generation, because the gate lives inside
// traitWeight and a re-implementation here would not see it.
function checkSuperstarTraitsAreReachable() {
  const superstarKeys = {};
  traits.TRAIT_TAXONOMY.forEach(function (t) {
    if (t.category === 'superstar') superstarKeys[t.key] = true;
  });
  assert.strictEqual(Object.keys(superstarKeys).length, 8, 'expected 8 superstar traits');
  let holders = 0;
  PLAYERS_2026.forEach(function (p) {
    if ((p.hiddenTraits || []).some(function (h) { return superstarKeys[h.key]; })) holders += 1;
  });
  assertShare('superstar traits', holders, 0.005, 0.10);
  console.log('checkSuperstarTraitsAreReachable: OK (' + holders + '/' + N + ' hold one)');
}

function checkStarTradePremiumFires() {
  let premium = 0;
  PLAYERS_2026.forEach(function (p) {
    if (tradeEvaluator.directionMultiplier(p, 'win-now') === 1.2) premium += 1;
  });
  assertShare('star trade premium', premium, 0.02, 0.20);
  console.log('checkStarTradePremiumFires: OK (' + premium + '/' + N + ')');
}

// Every player is given the same under-used season line, so the only thing
// that can vary the answer is the rating gate.
function checkLimitedRoleGripeFires() {
  let gripes = 0;
  PLAYERS_2026.forEach(function (p) {
    const saved = p.seasonStats;
    p.seasonStats = { gamesPlayed: 40, minutes: 40 * 10 };
    const reasons = morale.moraleFactors(p, null);
    if (reasons.indexOf('Limited role') !== -1) gripes += 1;
    p.seasonStats = saved;
  });
  assertShare('Limited role gripe', gripes, 0.10, 0.50);
  console.log('checkLimitedRoleGripeFires: OK (' + gripes + '/' + N + ' at 10 mpg)');
}

// Measured by whether the PENALTY applies, not by whether the player retires,
// so age does not confound the reading.
function checkRetirementPenaltyTargetsFringe() {
  let penalised = 0;
  PLAYERS_2026.forEach(function (p) {
    if (seasonTransition.hasRetirementPenalty(p)) penalised += 1;
  });
  assertShare('retirement penalty', penalised, 0.10, 0.40);
  console.log('checkRetirementPenaltyTargetsFringe: OK (' + penalised + '/' + N + ')');
}

const CHECKS = [
  checkSuperstarTraitsAreReachable,
  checkStarTradePremiumFires,
  checkLimitedRoleGripeFires,
  checkRetirementPenaltyTargetsFringe
];

// Runs every check and reports ALL failures rather than stopping at the first.
// Four gates are broken in four different ways; discovering them one run at a
// time would mean four rounds of edit-and-rerun to learn what is already known.
let failures = 0;
CHECKS.forEach(function (check) {
  try {
    check();
  } catch (e) {
    failures += 1;
    console.error('FAIL ' + check.name + ': ' + e.message);
  }
});
if (failures) {
  console.error('validate-ratingBands: ' + failures + ' of ' + CHECKS.length + ' gates broken');
  process.exit(1);
}
console.log('validate-ratingBands: OK');
