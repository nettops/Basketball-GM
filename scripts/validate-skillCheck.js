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
        // Zero badge bonus: these sweeps prove the refactor stays faithful to
        // the ORIGINAL formulas, which had no badge terms. That invariant is
        // still the right one — badges are additive on top of it.
        const got = skillCheckProbability(poss.turnoverSpec(d, h, 1 + s, 1, 0)).probability;
        worst = Math.max(worst, Math.abs(got - expected));
      }
    }
  }
  assert.ok(worst < 1e-12, 'turnover spec drifts from the original by ' + worst);
  console.log('checkTurnoverSpecMatchesTheOriginal: OK (max drift ' + worst.toExponential(2) + ')');
}

// Original: BLOCK_BASE + (block - 50) / BLOCK_DIV, clamped to [BLOCK_MIN, BLOCK_MAX].
// Mirrored BY HAND when BLOCK_BASE was re-based 0.020 -> 0.0055 for the 2K27
// face-value roster, whose block mean is 56.1 rather than 50.
function referenceBlock(blockAttr) {
  return Math.max(0.004, Math.min(0.20, 0.0055 + (blockAttr - 50) / 420));
}

function checkBlockSpecMatchesTheOriginal() {
  let worst = 0;
  for (let b = 0; b <= 100; b += 1) {
    worst = Math.max(worst, Math.abs(skillCheckProbability(poss.blockSpec(b, 'inside', 0)).probability - referenceBlock(b)));
  }
  assert.ok(worst < 1e-12, 'block spec drifts from the original by ' + worst);
  // The three-point branch is a flat constant, not a contest.
  assert.strictEqual(skillCheckProbability(poss.blockSpec(99, 'three', 0)).probability, 0.008);
  console.log('checkBlockSpecMatchesTheOriginal: OK (max drift ' + worst.toExponential(2) + ')');
}

// Original: base + (shoot - 50)/250*shooterEnergy - (def - 50)/350*defenderEnergy
//           + (offSyn - defSyn) + shotQualityBonus/300, clamped to [0.18, 0.72].
// Deliberately an INDEPENDENT re-implementation with the constants written out
// rather than read from SHOT_TUNING — reading them would make both sides move
// together and the check would prove nothing. The cost is that a deliberate
// balance change has to be mirrored here, which is the point: this fires when
// the shot formula moves, so the move has to be intentional.
//
// Updated when defence was given parity with offence: the divisors were 250
// (shooting) and 350 (defence), which let the league's absolute rating level
// leak into scoring. Both are now 292 — equal, so a league-wide lift cancels,
// and chosen so a one-point swing moves a shot exactly as much as it always did
// (2/292 = 0.00685 against the old 1/250 + 1/350 = 0.00686).
// The synergy divisor is mirrored here BY HAND, deliberately. Team synergy used
// to be added raw — a multiplier dropped straight onto a probability, worth up
// to ~12-15pp when every other modifier in the spec was worth 1-3. It is now
// divided by 8. This reference is an independent re-implementation, so a
// balance change has to be repeated here or this test fails; that is the point
// of it, and it is what caught this change rather than letting it through.
const REFERENCE_SYNERGY_DIV = 14;

function referenceShot(base, shoot, def, offSyn, defSyn, shooterEnergy, defenderEnergy, traitBonus) {
  const skillAdj = (shoot - 50) / 400 * shooterEnergy;
  const defAdj = (def - 50) / 1000 * defenderEnergy;
  const synAdj = (offSyn - defSyn) / REFERENCE_SYNERGY_DIV;
  return Math.max(0.18, Math.min(0.72, base + skillAdj - defAdj + synAdj + traitBonus / 300));
}

function checkShotSpecMatchesTheOriginal() {
  // The bases are READ, not mirrored. They used to be hand-copied here, and the
  // copy had to be re-typed every time a balance pass moved them — four times
  // so far, each one failing this check first and teaching nothing, because a
  // stale constant in the test is not drift in the formula. What this test is
  // actually for is the SHAPE of shotSpec: base plus skill over 400, minus
  // defence over 1000, plus synergy, plus trait over 300, clamped. The base is
  // an input to that shape, so it comes from the engine and balance passes go
  // through here silently.
  const zones = ['three', 'mid', 'inside'].map(function (z) {
    return [z, poss.SHOT_TUNING.base[z]];
  });
  let worst = 0;
  zones.forEach(function (z) {
    for (let s = 0; s <= 100; s += 10) {
      for (let d = 0; d <= 100; d += 10) {
        for (let e = 0.85; e <= 1.001; e += 0.05) {
          for (let t = -8; t <= 8; t += 4) {
            const expected = referenceShot(z[1], s, d, 1.02, 0.98, e, 1, t);
            const got = skillCheckProbability(poss.shotSpec(z[0], s, d, 1.02, 0.98, e, 1, t, 0)).probability;
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
// The check has to REACH a consumer. A structured result nothing reads is the
// dead-path bug this project has already paid for once — 15 traits sat unread
// through seven calibration tasks. Assert the engine actually attaches it.
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkPlayByPlayCarriesChecks() {
  const r = gameSim.simulateGame('BOS', 'LAL', makeRng(1));
  const withCheck = r.playByPlay.filter(function (e) { return e && e.check; });
  assert.ok(withCheck.length > 50,
    'expected most plays to carry a check, got ' + withCheck.length + ' of ' + r.playByPlay.length);

  const anyShot = withCheck.find(function (e) { return e.check.kind === 'shot'; });
  assert.ok(anyShot, 'no shot check reached the play-by-play');
  assert.ok(typeof anyShot.text === 'string' && anyShot.text.length > 0, 'entry must still carry its text');
  assert.ok(anyShot.check.attack && anyShot.check.defend, 'a shot check must name both sides');
  assert.ok(anyShot.check.modifiers.length > 0, 'a shot check must itemise its modifiers');
  console.log('checkPlayByPlayCarriesChecks: OK (' + withCheck.length + '/' + r.playByPlay.length + ' entries)');
}

// Quarter headers are pushed as bare strings by gameSim.js and must stay that
// way — the renderer keys off them, and old saves contain nothing else.
function checkQuarterHeadersStayPlainStrings() {
  const r = gameSim.simulateGame('BOS', 'LAL', makeRng(1));
  const headers = r.playByPlay.filter(function (e) { return typeof e === 'string' && e.indexOf('--- Q') === 0; });
  assert.ok(headers.length >= 4, 'expected at least four quarter headers, got ' + headers.length);
  console.log('checkQuarterHeadersStayPlainStrings: OK (' + headers.length + ' headers)');
}

// Plays with no contest behind them stay BARE STRINGS. Rebounds are the case:
// offReboundChance is a synergy ratio, not an opposed attribute check, so there
// is no skillCheck to attach and wrapping them would bloat every save with
// { text, check: null } for nothing.
//
// This exists because a mutant that wrapped EVERY entry survived the header
// assertion above — headers come from gameSim directly and never reach logPlay,
// so they proved nothing about logPlay's own branch.
function checkPlaysWithoutAContestStayPlainStrings() {
  const r = gameSim.simulateGame('BOS', 'LAL', makeRng(1));
  const rebounds = r.playByPlay.filter(function (e) {
    const text = typeof e === 'string' ? e : e.text;
    return text.indexOf(' the offensive rebound') !== -1 || text.indexOf(' the defensive rebound') !== -1;
  });
  assert.ok(rebounds.length > 20, 'expected plenty of rebound lines, got ' + rebounds.length);
  rebounds.forEach(function (e) {
    assert.strictEqual(typeof e, 'string',
      'a rebound has no opposed check and must stay a bare string, got ' + JSON.stringify(e));
  });
  console.log('checkPlaysWithoutAContestStayPlainStrings: OK (' + rebounds.length + ' rebounds, all bare)');
}

// The EVENT stream is a separate consumer from the play-by-play, and it is the
// one ui/pixelChoreographer.js reads. Asserting only on playByPlay let a mutant
// that stripped the check off pushEvent survive untouched.
function checkEventsCarryChecks() {
  const events = [];
  gameSim.simulateGame('BOS', 'LAL', makeRng(1), { events: events });
  ['shot', 'block', 'turnover'].forEach(function (type) {
    const ofType = events.filter(function (ev) { return ev.type === type; });
    assert.ok(ofType.length > 0, 'no ' + type + ' events produced at all');
    const missing = ofType.filter(function (ev) { return !ev.check || !ev.check.kind; });
    assert.strictEqual(missing.length, 0,
      missing.length + ' of ' + ofType.length + ' ' + type + ' events lost their check');
  });
  console.log('checkEventsCarryChecks: OK (shot/block/turnover all carry checks)');
}

checkResultCarriesEveryInput();
checkPlayByPlayCarriesChecks();
checkQuarterHeadersStayPlainStrings();
checkPlaysWithoutAContestStayPlainStrings();
checkEventsCarryChecks();
// Badges reach the CONTEST, not just who is in it. Each of these asserts the
// spec's modifier list actually carries the badge term, and in the right
// direction — a defensive badge must make the shot HARDER.
function checkBadgeModifiersReachTheSpecs() {
  const plainShot = skillCheckProbability(poss.shotSpec('three', 70, 60, 1, 1, 1, 1, 0, 0)).probability;
  const defendedShot = skillCheckProbability(poss.shotSpec('three', 70, 60, 1, 1, 1, 1, 0, 8)).probability;
  assert.ok(defendedShot < plainShot,
    'a defensive badge must LOWER the shooter\'s chance (' + defendedShot + ' vs ' + plainShot + ')');

  const plainSteal = skillCheckProbability(poss.turnoverSpec(60, 70, 1, 1, 0)).probability;
  const badgeSteal = skillCheckProbability(poss.turnoverSpec(60, 70, 1, 1, 8)).probability;
  assert.ok(badgeSteal > plainSteal, 'a steal badge must RAISE the turnover chance');

  const plainBlock = skillCheckProbability(poss.blockSpec(60, 'inside', 0)).probability;
  const badgeBlock = skillCheckProbability(poss.blockSpec(60, 'inside', 8)).probability;
  assert.ok(badgeBlock > plainBlock, 'a block badge must RAISE the block chance');

  // A rim protector must not be literally UNABLE to block a three — the flat
  // branch still takes the badge, it just has no rating contest behind it.
  const plainThree = skillCheckProbability(poss.blockSpec(60, 'three', 0)).probability;
  const badgeThree = skillCheckProbability(poss.blockSpec(60, 'three', 8)).probability;
  assert.ok(badgeThree > plainThree, 'a block badge must still help on threes');

  // The badge term must be a NAMED modifier, not folded into base — the whole
  // point of the modifiers array is that the UI can print "Lockdown Defender".
  const spec = poss.shotSpec('three', 70, 60, 1, 1, 1, 1, 0, 8);
  const labels = spec.modifiers.map(function (m) { return m.label; });
  assert.ok(labels.indexOf('defensive badges') !== -1,
    'the defensive term must be a named modifier, got: ' + labels.join(', '));
  console.log('checkBadgeModifiersReachTheSpecs: OK');
}

// Foul Prone is the one badge that reaches the game through the FOUL rate, and
// validate-traitsAreLive structurally cannot cover it: the representative trait
// for boxscore/defense is a POSITIVE one (Lockdown Defender) which reaches the
// sim through shotSpec, so zeroing this term would leave the whole family
// looking live while Foul Prone quietly did nothing. Asserted directly.
function checkFoulProneRaisesTheFoulRate() {
  const clean = { hiddenTraits: [] };
  const proneBronze = { hiddenTraits: [{ key: 'foulProne', tier: 'bronze' }] };
  const proneLegendary = { hiddenTraits: [{ key: 'foulProne', tier: 'legendary' }] };
  const lockdown = { hiddenTraits: [{ key: 'lockdownDefender', tier: 'legendary' }] };

  const base = poss.shootingFoulRate(clean);
  assert.ok(poss.shootingFoulRate(proneBronze) > base, 'a bronze Foul Prone must foul more than a clean defender');
  assert.ok(poss.shootingFoulRate(proneLegendary) > poss.shootingFoulRate(proneBronze),
    'the tier ladder must read through to the foul rate');
  assert.strictEqual(poss.shootingFoulRate(lockdown), base,
    'a POSITIVE defence badge must not change the foul rate — it is not a second hidden effect');
  console.log('checkFoulProneRaisesTheFoulRate: OK (base ' + base.toFixed(3) +
    ' -> legendary ' + poss.shootingFoulRate(proneLegendary).toFixed(3) + ')');
}

checkTurnoverSpecMatchesTheOriginal();
checkBlockSpecMatchesTheOriginal();
checkShotSpecMatchesTheOriginal();
// THE CALL SITES, not just the spec builders. A spec builder can be perfect
// while the code feeding it passes zero — and validate-traitsAreLive cannot
// catch that for defence or steal, because both are ALSO wired through the
// allocation path, so the family stays "live" while the rate path is gone.
// Two mutants survived on exactly that before these existed.
function checkTheCallSitesActuallyLookUpTheBadges() {
  const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
  function defender(hiddenTraits, attrs) {
    const p = { hiddenTraits: hiddenTraits, attributes: {} };
    ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 60; });
    Object.assign(p.attributes, attrs || {});
    return p;
  }
  const shooter = defender([]);
  const plainD = defender([]);
  const lockdown = defender([{ key: 'lockdownDefender', tier: 'legendary' }]);
  const thief = defender([{ key: 'pickpocket', tier: 'legendary' }]);
  const rim = defender([{ key: 'rimProtector', tier: 'legendary' }], { block: 70 });
  const plainBig = defender([], { block: 70 });

  assert.ok(poss.shotMakeProbability(shooter, lockdown, 'three', 1, 1, 1, 1) <
            poss.shotMakeProbability(shooter, plainD, 'three', 1, 1, 1, 1),
    'shotMakeSpecFor must LOOK UP the defender\'s badge, not just accept one');

  assert.ok(skillCheckProbability(poss.turnoverSpecFor(thief, shooter, 1, 1)).probability >
            skillCheckProbability(poss.turnoverSpecFor(plainD, shooter, 1, 1)).probability,
    'turnoverSpecFor must look up the on-ball defender\'s steal badge');

  assert.ok(skillCheckProbability(poss.blockSpecFor(rim, 'inside')).probability >
            skillCheckProbability(poss.blockSpecFor(plainBig, 'inside')).probability,
    'blockSpecFor must look up the shot defender\'s block badge');
  console.log('checkTheCallSitesActuallyLookUpTheBadges: OK');
}

checkBadgeModifiersReachTheSpecs();
checkFoulProneRaisesTheFoulRate();
checkTheCallSitesActuallyLookUpTheBadges();
checkContactCostsSomethingAndSkillPaysItBack();
console.log('All skillCheck validations passed');

function checkContactCostsSomethingAndSkillPaysItBack() {
  // Contact had been DRAWN since the animation pass and never meant anything:
  // the sprite compressed and kept climbing while the sim had already decided
  // the shot went in for reasons that had nothing to do with a body being in
  // the way. Worse, the two disagreed about when — the drawing inferred contact
  // from positions the choreographer invented after the fact.
  //
  // The sim decides it now and the drawing reads the answer, so what is worth
  // pinning is that the decision costs something and that skill answers it.
  const poss = require(path.join(__dirname, '..', 'simEnginePossession.js'));

  // IT HAS TO COST. A contact modifier of zero is the old behaviour with a
  // label on it.
  assert.ok(poss.contactPenalty(50) < -0.02,
    'contact costs a median finisher only ' + (poss.contactPenalty(50) * 100).toFixed(1) +
    'pp — that is a rounding error, not a defender');

  // ...AND SKILL HAS TO ANSWER IT. "Finishes through contact" is a rating in
  // this game; a sim where it does nothing is a sim where the rating is
  // decoration. Monotonic, so there is no band where getting better hurts.
  let prev = -Infinity;
  for (let v = 0; v <= 99; v += 3) {
    const pen = poss.contactPenalty(v);
    assert.ok(pen <= 0, 'contact HELPS a ' + v + ' finisher');
    assert.ok(pen >= prev - 1e-9, 'the penalty is not monotonic in finishing at ' + v);
    prev = pen;
  }
  assert.ok(poss.contactPenalty(95) > poss.contactPenalty(30) * 0.75,
    'an elite finisher is punished nearly as hard as a poor one — the skill does not read');

  // HOW OFTEN, driven by the one rating that means "puts a body on you". Rising
  // in interior defence, bounded, and never a certainty: a defender who forces
  // contact on every single possession is a wall, not a man.
  prev = -Infinity;
  for (let d = 0; d <= 99; d += 3) {
    const c = poss.contactChance(d);
    assert.ok(c >= prev - 1e-9, 'contact chance falls as interior defence rises, at ' + d);
    assert.ok(c > 0 && c < 0.5,
      'contact fires on ' + (c * 100).toFixed(0) + '% against a ' + d + ' defender');
    prev = c;
  }
  assert.ok(poss.contactChance(80) > poss.contactChance(30),
    'a rim protector forces no more contact than a guard');

  // The modifier must actually reach the spec, under its own name, so the check
  // the event carries explains itself and the UI can show it.
  const clean = poss.shotMakeSpecFor({ id: 'a', attributes: {} },
    { id: 'b', attributes: {} }, 'inside', 1, 1, 1, 1, 0, 1, false);
  const hit = poss.shotMakeSpecFor({ id: 'a', attributes: {} },
    { id: 'b', attributes: {} }, 'inside', 1, 1, 1, 1, 0, 1, true);
  const nameOf = function (spec) {
    return (spec.modifiers || []).filter(function (m) { return m.label === 'contact'; })[0];
  };
  assert.ok(nameOf(clean) && nameOf(clean).value === 0,
    'a clean look carries a contact penalty');
  assert.ok(nameOf(hit) && nameOf(hit).value < 0,
    'a contact finish carries no penalty — the flag is decorative');
  // `.probability` — skillCheckProbability returns the whole breakdown, not a
  // number, and reading it as one silently produced NaN comparisons.
  const pHit = skillCheckProbability(hit).probability;
  const pClean = skillCheckProbability(clean).probability;
  assert.ok(pHit < pClean,
    'contact does not lower the make probability: ' +
    pHit.toFixed(4) + ' vs ' + pClean.toFixed(4));

  console.log('checkContactCostsSomethingAndSkillPaysItBack: OK (' +
    (poss.contactPenalty(30) * 100).toFixed(1) + 'pp for a poor finisher, ' +
    (poss.contactPenalty(95) * 100).toFixed(1) + 'pp for an elite one; fires ' +
    (poss.contactChance(50) * 100).toFixed(0) + '% against a median defender)');
}
