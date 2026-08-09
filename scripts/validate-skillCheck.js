const assert = require('assert');
const path = require('path');
const { skillCheck, skillCheckProbability } = require(path.join(__dirname, '..', 'skillCheck.js'));

// A spec with no attack/defend sides is just its base — the degenerate case the
// three-point block branch uses, where the outcome is a flat constant.
function checkBareBaseIsTheProbability() {
  const p = skillCheckProbability({ kind: 'test', base: 0.25, attack: null, defend: null, modifiers: [], min: 0, max: 1 });
  assert.strictEqual(p.probability, 0.25);
  assert.strictEqual(p.attackTerm, 0);
  assert.strictEqual(p.defendTerm, 0);
  console.log('checkBareBaseIsTheProbability: OK');
}

// Both sides are centred on 50 and divided by their own scale. 50 is the MIDDLE
// of the rating scale (data.js RATING_MIN 0 / RATING_MAX 100), so an average
// player contributes exactly nothing and the base is what it says it is.
function checkSidesAreCentredOnFifty() {
  const spec = {
    kind: 'test', base: 0.5,
    attack: { label: 'atk', value: 50, scale: 100, energy: 1 },
    defend: { label: 'def', value: 50, scale: 100, energy: 1 },
    modifiers: [], min: 0, max: 1
  };
  assert.strictEqual(skillCheckProbability(spec).probability, 0.5, 'two average players must leave the base untouched');

  spec.attack.value = 75;
  assert.ok(Math.abs(skillCheckProbability(spec).probability - 0.75) < 1e-9, '+25 over scale 100 must add 0.25');

  spec.attack.value = 50;
  spec.defend.value = 75;
  assert.ok(Math.abs(skillCheckProbability(spec).probability - 0.25) < 1e-9, 'the defender term must SUBTRACT');
  console.log('checkSidesAreCentredOnFifty: OK');
}

// Energy scales how much of a side's skill edge shows up, without moving the
// base. A fully drained attacker falls back to the base, not to zero.
function checkEnergyScalesOnlyTheSkillTerm() {
  const spec = {
    kind: 'test', base: 0.4,
    attack: { label: 'atk', value: 90, scale: 100, energy: 0 },
    defend: null, modifiers: [], min: 0, max: 1
  };
  assert.ok(Math.abs(skillCheckProbability(spec).probability - 0.4) < 1e-9, 'zero energy must erase the edge, not the base');
  spec.attack.energy = 0.5;
  assert.ok(Math.abs(skillCheckProbability(spec).probability - 0.6) < 1e-9, 'half energy must halve the edge');
  console.log('checkEnergyScalesOnlyTheSkillTerm: OK');
}

// Modifiers are itemised so a display consumer can name each one. The total is
// their plain sum, and an empty list contributes nothing.
function checkModifiersAreSummedAndItemised() {
  const spec = {
    kind: 'test', base: 0.5, attack: null, defend: null,
    modifiers: [{ label: 'Sharpshooter (gold)', value: 0.01 }, { label: 'synergy', value: -0.004 }],
    min: 0, max: 1
  };
  const p = skillCheckProbability(spec);
  assert.ok(Math.abs(p.modifierTotal - 0.006) < 1e-9);
  assert.ok(Math.abs(p.probability - 0.506) < 1e-9);
  console.log('checkModifiersAreSummedAndItemised: OK');
}

// The clamp is a guard, not a value-producing path — but it must actually bind,
// because every real call site relies on it to keep probabilities sane.
function checkClampBinds() {
  const hi = skillCheckProbability({ kind: 'test', base: 0.99, attack: null, defend: null, modifiers: [{ label: 'x', value: 0.5 }], min: 0.18, max: 0.72 });
  assert.strictEqual(hi.probability, 0.72);
  assert.ok(hi.raw > 0.72, 'raw must be preserved unclamped so a consumer can show what was capped');
  const lo = skillCheckProbability({ kind: 'test', base: 0.01, attack: null, defend: null, modifiers: [], min: 0.18, max: 0.72 });
  assert.strictEqual(lo.probability, 0.18);
  console.log('checkClampBinds: OK');
}

// EXACTLY ONE rng draw. The engine replaces `rng() < chance` with this call, so
// two draws (or zero) desynchronises every subsequent possession in the game.
function checkExactlyOneRngDraw() {
  let draws = 0;
  const rng = function () { draws += 1; return 0.5; };
  skillCheck({ kind: 'test', base: 0.5, attack: null, defend: null, modifiers: [], min: 0, max: 1 }, rng);
  assert.strictEqual(draws, 1, 'skillCheck must consume exactly one rng draw');
  console.log('checkExactlyOneRngDraw: OK');
}

// passed is `roll < probability`, matching the `rng() < chance` idiom it
// replaces. The boundary case matters: a roll exactly equal to the probability
// must FAIL, or the replacement is off by one ulp from the original.
function checkPassedMatchesTheOriginalIdiom() {
  const spec = { kind: 'test', base: 0.5, attack: null, defend: null, modifiers: [], min: 0, max: 1 };
  assert.strictEqual(skillCheck(spec, function () { return 0.49; }).passed, true);
  assert.strictEqual(skillCheck(spec, function () { return 0.5; }).passed, false, 'roll === probability must fail, exactly as rng() < chance does');
  assert.strictEqual(skillCheck(spec, function () { return 0.51; }).passed, false);
  console.log('checkPassedMatchesTheOriginalIdiom: OK');
}

// The result must carry every input forward. A display consumer reconstructs
// the whole calculation from this object alone — if a field is dropped here the
// breakdown silently loses a line instead of failing loudly.
function checkResultCarriesEveryInput() {
  const r = skillCheck({
    kind: 'shot', base: 0.33,
    attack: { label: 'shootingThree', value: 80, scale: 250, energy: 0.95 },
    defend: { label: 'defensePerimeter', value: 60, scale: 350, energy: 1 },
    modifiers: [{ label: 'Sharpshooter (gold)', value: 0.01 }],
    min: 0.18, max: 0.72
  }, function () { return 0.1; });
  ['kind', 'base', 'attack', 'defend', 'modifiers', 'attackTerm', 'defendTerm', 'modifierTotal', 'probability', 'roll', 'passed']
    .forEach(function (k) {
      assert.ok(r[k] !== undefined && r[k] !== null, 'result is missing ' + k);
    });
  assert.strictEqual(r.attack.label, 'shootingThree');
  assert.strictEqual(r.modifiers[0].label, 'Sharpshooter (gold)');
  console.log('checkResultCarriesEveryInput: OK');
}

// EQUIVALENCE. The original expressions are retained here verbatim as reference
// implementations and swept across the input range. This is what catches an
// algebra slip in the turnover rewrite — the only non-obvious transformation in
// the refactor, because the original is a RAW DIFFERENCE over one divisor while
// every other site uses two terms each centred on 50.
//
// simEnginePossession.js reads league/traits/composite as browser globals under
// its dual-module pattern, so Node needs the same bootstrap every other
// validator does (copied from scripts/validate-possession.js:4-16). Requiring it
// without this throws on load.
require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const poss = require(path.join(__dirname, '..', 'simEnginePossession.js'));

// Original: 0.11 + (defenderSteal - handlerBallHandling) / 400 + (defSyn - offSyn) * 0.3,
// clamped to [0.04, 0.22].
function referenceTurnover(defenderSteal, handlerBallHandling, defSyn, offSyn) {
  return Math.max(0.04, Math.min(0.22,
    0.11 + (defenderSteal - handlerBallHandling) / 400 + (defSyn - offSyn) * 0.3));
}

function checkTurnoverSpecMatchesTheOriginal() {
  let worst = 0;
  for (let d = 0; d <= 100; d += 5) {
    for (let h = 0; h <= 100; h += 5) {
      for (let s = -0.1; s <= 0.1001; s += 0.05) {
        const expected = referenceTurnover(d, h, 1 + s, 1);
        const got = skillCheckProbability(poss.turnoverSpec(d, h, 1 + s, 1)).probability;
        worst = Math.max(worst, Math.abs(got - expected));
      }
    }
  }
  assert.ok(worst < 1e-12, 'turnover spec drifts from the original by ' + worst);
  console.log('checkTurnoverSpecMatchesTheOriginal: OK (max drift ' + worst.toExponential(2) + ')');
}

// Original: BLOCK_BASE + (block - 50) / BLOCK_DIV, clamped to [BLOCK_MIN, BLOCK_MAX].
function referenceBlock(blockAttr) {
  return Math.max(0.004, Math.min(0.20, 0.020 + (blockAttr - 50) / 420));
}

function checkBlockSpecMatchesTheOriginal() {
  let worst = 0;
  for (let b = 0; b <= 100; b += 1) {
    worst = Math.max(worst, Math.abs(skillCheckProbability(poss.blockSpec(b, 'inside')).probability - referenceBlock(b)));
  }
  assert.ok(worst < 1e-12, 'block spec drifts from the original by ' + worst);
  // The three-point branch is a flat constant, not a contest.
  assert.strictEqual(skillCheckProbability(poss.blockSpec(99, 'three')).probability, 0.008);
  console.log('checkBlockSpecMatchesTheOriginal: OK (max drift ' + worst.toExponential(2) + ')');
}

// Original: base + (shoot - 50)/250*shooterEnergy - (def - 50)/350*defenderEnergy
//           + (offSyn - defSyn) + shotQualityBonus/300, clamped to [0.18, 0.72].
function referenceShot(base, shoot, def, offSyn, defSyn, shooterEnergy, defenderEnergy, traitBonus) {
  const skillAdj = (shoot - 50) / 250 * shooterEnergy;
  const defAdj = (def - 50) / 350 * defenderEnergy;
  return Math.max(0.18, Math.min(0.72, base + skillAdj - defAdj + (offSyn - defSyn) + traitBonus / 300));
}

function checkShotSpecMatchesTheOriginal() {
  const zones = [['three', 0.330], ['mid', 0.42], ['inside', 0.56]];
  let worst = 0;
  zones.forEach(function (z) {
    for (let s = 0; s <= 100; s += 10) {
      for (let d = 0; d <= 100; d += 10) {
        for (let e = 0.85; e <= 1.001; e += 0.05) {
          for (let t = -8; t <= 8; t += 4) {
            const expected = referenceShot(z[1], s, d, 1.02, 0.98, e, 1, t);
            const got = skillCheckProbability(poss.shotSpec(z[0], s, d, 1.02, 0.98, e, 1, t)).probability;
            worst = Math.max(worst, Math.abs(got - expected));
          }
        }
      }
    }
  });
  assert.ok(worst < 1e-12, 'shot spec drifts from the original by ' + worst);
  console.log('checkShotSpecMatchesTheOriginal: OK (max drift ' + worst.toExponential(2) + ')');
}

checkBareBaseIsTheProbability();
checkSidesAreCentredOnFifty();
checkEnergyScalesOnlyTheSkillTerm();
checkModifiersAreSummedAndItemised();
checkClampBinds();
checkExactlyOneRngDraw();
checkPassedMatchesTheOriginalIdiom();
checkResultCarriesEveryInput();
checkTurnoverSpecMatchesTheOriginal();
checkBlockSpecMatchesTheOriginal();
checkShotSpecMatchesTheOriginal();
console.log('All skillCheck validations passed');
