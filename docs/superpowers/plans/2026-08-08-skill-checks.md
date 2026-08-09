# Skill Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three hand-rolled opposed-attribute formulas with one `skillCheck` primitive that returns a structured result, and surface that result to the player.

**Architecture:** A zero-dependency `skillCheck.js` takes a spec (base, attacking side, defending side, itemised modifiers, clamp bounds) and an rng, and returns the spec plus every intermediate term, the roll and pass/fail. The three possession-engine sites are rewritten to build specs — keeping their existing per-site divisors, so outcomes are byte-identical. The result then rides along on play-by-play entries and pixel events so the box score can expand any play and the live view can show the breakdown on impact moments.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Dual `require`/browser-global module pattern. Node-based validators under `scripts/`, run with bare `node`.

## Global Constraints

- **Zero dependencies.** No packages, no build step. `skillCheck.js` must not require `league.js`, `traits.js` or `compositeRatings.js` — it takes plain numbers.
- **Dual module pattern.** Every file ends with `if (typeof module !== 'undefined' && module.exports) { module.exports = { ... }; }` and is reachable as a browser global. New files must be added to `index.html` in dependency order.
- **Outcomes are byte-identical.** Per-site divisors (400 / 250 / 350 / 420) are retained. `scripts/fixtures/gamesim-golden.json` and `rollover-golden.json` MUST NOT be regenerated. A golden that moves means the refactor is wrong.
- **RNG stream is sacred.** `skillCheck` must draw from `rng` exactly once, at the same point in the sequence as the `rng()` call it replaces. One extra or missing draw desynchronises every later possession.
- **Every new assertion is mutation-tested.** A surviving mutant means the assertion is worthless or the code is dead — say which.
- **Never widen a bound to make a change pass.**
- **`git add` explicit paths only.** Never `git add -A`.
- **Commit with `git commit -F <file>`** — PowerShell mangles multi-line `-m`.
- Run the full suite with: `for f in scripts/validate-*.js; do node "$f" || echo "FAIL $f"; done`

---

## File Structure

| File | Responsibility |
|---|---|
| `skillCheck.js` (new) | The primitive. Pure arithmetic + one rng draw. No game knowledge. |
| `scripts/validate-skillCheck.js` (new) | Primitive unit tests, and per-call-site equivalence against retained reference implementations. |
| `simEnginePossession.js` (modify) | Three call sites build specs instead of inline formulas; attach results to log + events. |
| `ui/schedule.js` (modify) | `playByPlayHtml` renders an expandable breakdown for entries that carry a check. |
| `ui/pixelChoreographer.js` (modify) | Impact keyframes carry the check that produced them. |
| `ui/pixelHud.js` (modify) | Commentary lines render the breakdown when a check is attached. |
| `index.html` (modify) | Load `skillCheck.js` before `simEnginePossession.js`. |

---

### Task 1: The skillCheck primitive

**Files:**
- Create: `skillCheck.js`
- Create: `scripts/validate-skillCheck.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `skillCheck(spec, rng)` → result object; `skillCheckProbability(spec)` → `{ attackTerm, defendTerm, modifierTotal, raw, probability }` (exported separately so tests can check the math without consuming rng).
- `spec` shape: `{ kind: string, base: number, attack: {label, value, scale, energy}|null, defend: {label, value, scale, energy}|null, modifiers: [{label, value}], min: number, max: number }`
- `result` shape: `{ kind, base, attack, defend, modifiers, attackTerm, defendTerm, modifierTotal, probability, roll, passed }`

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-skillCheck.js`:

```js
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

checkBareBaseIsTheProbability();
checkSidesAreCentredOnFifty();
checkEnergyScalesOnlyTheSkillTerm();
checkModifiersAreSummedAndItemised();
checkClampBinds();
checkExactlyOneRngDraw();
checkPassedMatchesTheOriginalIdiom();
checkResultCarriesEveryInput();
console.log('All skillCheck validations passed');
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-skillCheck.js
```

Expected: `Error: Cannot find module '.../skillCheck.js'`

- [ ] **Step 3: Write the primitive**

Create `skillCheck.js`:

```js
// One opposed-attribute check, used everywhere the possession engine decides
// whether something happened. Before this, each contest was hand-rolled with
// its own divisor and centring convention — turnover used a raw difference over
// 400, shot-make used two centred terms over 250 and 350, block used one over
// 420. Three shapes meant badges had to be bolted on in three places and the
// math was invisible to the UI.
//
// Zero dependencies BY DESIGN: this takes plain numbers, never players or
// ratings modules, so it can be unit-tested without loading a league and reused
// by anything. The caller resolves composites and trait bonuses; this does the
// arithmetic and the roll.
//
// `attack` is whoever WANTS THE CHECK TO PASS, not whoever has the ball. On a
// turnover check the defender is the attacking side. Naming by outcome rather
// than by possession is what lets one function cover contests running in both
// directions instead of needing an inverted twin.

// 50 is the middle of the rating scale (data.js RATING_MIN 0 / RATING_MAX 100),
// so an average player contributes exactly nothing and `base` means what it says.
const SKILL_CHECK_CENTRE = 50;

function skillCheckSideTerm(side) {
  if (!side || !side.scale) return 0;
  const energy = side.energy === undefined ? 1 : side.energy;
  return (side.value - SKILL_CHECK_CENTRE) / side.scale * energy;
}

// Split out from skillCheck so the arithmetic can be tested without consuming
// an rng draw, and so a caller that only wants the probability (a UI preview,
// a calibration sweep) does not perturb the stream.
function skillCheckProbability(spec) {
  const attackTerm = skillCheckSideTerm(spec.attack);
  const defendTerm = skillCheckSideTerm(spec.defend);
  let modifierTotal = 0;
  const mods = spec.modifiers || [];
  for (let i = 0; i < mods.length; i++) modifierTotal += mods[i].value;
  const raw = spec.base + attackTerm - defendTerm + modifierTotal;
  const min = spec.min === undefined ? 0 : spec.min;
  const max = spec.max === undefined ? 1 : spec.max;
  return {
    attackTerm: attackTerm,
    defendTerm: defendTerm,
    modifierTotal: modifierTotal,
    // raw is kept UNCLAMPED so a consumer can show that a value was capped
    // rather than silently presenting the cap as if it were the calculation.
    raw: raw,
    probability: Math.max(min, Math.min(max, raw))
  };
}

// Draws from rng EXACTLY ONCE, replacing the `rng() < chance` it stands in for.
// Two draws or zero draws desynchronises every later possession in the game,
// which is why validate-skillCheck.js counts them.
function skillCheck(spec, rng) {
  const p = skillCheckProbability(spec);
  const roll = rng();
  return {
    kind: spec.kind,
    base: spec.base,
    attack: spec.attack || null,
    defend: spec.defend || null,
    modifiers: spec.modifiers || [],
    attackTerm: p.attackTerm,
    defendTerm: p.defendTerm,
    modifierTotal: p.modifierTotal,
    raw: p.raw,
    probability: p.probability,
    roll: roll,
    // `<` not `<=`, matching the rng() < chance idiom this replaces exactly.
    passed: roll < p.probability
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKILL_CHECK_CENTRE: SKILL_CHECK_CENTRE,
    skillCheckSideTerm: skillCheckSideTerm,
    skillCheckProbability: skillCheckProbability,
    skillCheck: skillCheck
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
node scripts/validate-skillCheck.js
```

Expected: eight `OK` lines, then `All skillCheck validations passed`.

- [ ] **Step 5: Load it in the browser**

In `index.html`, add the script tag immediately **before** `simEnginePossession.js`:

```html
  <script src="skillCheck.js"></script>
```

Verify the order is right:

```bash
grep -n "skillCheck.js\|simEnginePossession.js" index.html
```

Expected: `skillCheck.js` on a lower line number than `simEnginePossession.js`.

- [ ] **Step 6: Mutation-test the new assertions**

Apply each mutant to `skillCheck.js`, run `node scripts/validate-skillCheck.js`, confirm exit code 1, then restore with `git checkout -- skillCheck.js`.

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `- defendTerm` → `+ defendTerm` | `checkSidesAreCentredOnFifty` |
| 2 | `SKILL_CHECK_CENTRE = 50` → `0` | `checkSidesAreCentredOnFifty` |
| 3 | Delete `* energy` from `skillCheckSideTerm` | `checkEnergyScalesOnlyTheSkillTerm` |
| 4 | `modifierTotal += mods[i].value` → `modifierTotal += 0` | `checkModifiersAreSummedAndItemised` |
| 5 | Return `raw` instead of the clamped value | `checkClampBinds` |
| 6 | Call `rng()` twice | `checkExactlyOneRngDraw` |
| 7 | `roll < p.probability` → `roll <= p.probability` | `checkPassedMatchesTheOriginalIdiom` |

**Verify each mutant actually applied** before believing it survived — read the file back after editing. A substitution that silently fails to match looks exactly like a surviving mutant.

If any mutant survives, the assertion is worthless or the code is dead. Fix the assertion; do not weaken it.

- [ ] **Step 7: Run the full suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: no `FAIL` lines. (Nothing consumes the primitive yet, so nothing else can move.)

- [ ] **Step 8: Commit**

```bash
git add skillCheck.js scripts/validate-skillCheck.js index.html
git commit -F commit-msg.txt
```

Commit message: `feat: skillCheck primitive for opposed attribute contests`, body covering the attack/defend naming rationale, the single-rng-draw constraint, and the 7/7 mutation results.

---

### Task 2: Route the three call sites through it, byte-identically

**Files:**
- Modify: `simEnginePossession.js:263-264` (turnover), `:303-306` (block), `:197-212` (shot make)
- Modify: `scripts/validate-skillCheck.js` (append equivalence checks)

**Interfaces:**
- Consumes: `skillCheck(spec, rng)` and `skillCheckProbability(spec)` from Task 1.
- Produces: `simulatePossession` unchanged externally — same signature, same return, same rng consumption.

- [ ] **Step 1: Write the failing equivalence test**

Append to `scripts/validate-skillCheck.js`, above the final `console.log`:

```js
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

checkTurnoverSpecMatchesTheOriginal();
checkBlockSpecMatchesTheOriginal();
checkShotSpecMatchesTheOriginal();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-skillCheck.js
```

Expected: `TypeError: poss.turnoverSpec is not a function`

- [ ] **Step 3: Add the three spec builders to `simEnginePossession.js`**

Insert immediately above `function shotMakeProbability` (currently line 197). Note `BLOCK_BASE`/`BLOCK_DIV`/`BLOCK_MIN`/`BLOCK_MAX` currently live *inside* `simulatePossession` at line 303 — hoist them to module scope here, keeping the full existing comment block with them.

```js
// Spec builders for the three contests this engine resolves. Each takes plain
// numbers rather than players so it can be swept against the original formula
// in scripts/validate-skillCheck.js without constructing a league.
//
// The divisors below are deliberately NOT normalised onto a single scale. They
// were calibrated independently and normalising them would change outcomes,
// move both goldens and need a full recalibration sweep — a balance change has
// no business riding along inside a refactor. That is its own later pass.

const TURNOVER_BASE = 0.11, TURNOVER_DIV = 400;
const TURNOVER_MIN = 0.04, TURNOVER_MAX = 0.22;
const TURNOVER_SYNERGY_WEIGHT = 0.3;

// ATTACK is the DEFENDER: a turnover is the defence's check to pass. Both sides
// divide by the same 400 because the original was a raw difference over one
// divisor — (d - h)/400 is algebraically (d-50)/400 - (h-50)/400.
function turnoverSpec(defenderSteal, handlerBallHandling, defSynergyDefense, offSynergyOffense) {
  return {
    kind: 'turnover',
    base: TURNOVER_BASE,
    attack: { label: 'steal', value: defenderSteal, scale: TURNOVER_DIV, energy: 1 },
    defend: { label: 'ballHandling', value: handlerBallHandling, scale: TURNOVER_DIV, energy: 1 },
    modifiers: [
      { label: 'team synergy', value: (defSynergyDefense - offSynergyOffense) * TURNOVER_SYNERGY_WEIGHT }
    ],
    min: TURNOVER_MIN, max: TURNOVER_MAX
  };
}

// This was `max(0, (block - 50) / 900)`, which assumed 50 was the BOTTOM of
// the rating scale rather than its middle — on the old 48-99 attributes
// nobody was ever clipped, but on a true 0-100 scale it zeroed half the
// league and blocks fell from 1.86 to 0.87 per team-game. Reshaped to a base
// plus a deviation so a below-average shot-blocker is merely unlikely to
// block rather than literally unable to.
//
// BLOCK_BASE calibrated to RESTORE the pre-rescale rate (1.86 blocks per
// team-game; 0.020 measures 1.78), deliberately NOT to the real NBA's ~4.9.
//
// This rescale's job is to not break anything, and the block rate was
// already 2.6x under the real league before it. Fixing that is a balance
// change, and it is not free: validate-impactMoments.js gates the block
// comic-panel population at 2-7 per game, so an NBA-realistic block rate
// (BLOCK_BASE 0.085 measures 4.73/team, 9.5/game) would roughly triple the
// tier-2 impact effects. How many comic panels a game should carry is a
// feel decision, not an arithmetic one. Left for the recalibration task with
// the sweep already measured:
//   0.020 -> 1.78/team   0.030 -> 2.20   0.055 -> 3.28
//   0.070 -> 4.38        0.085 -> 4.73 (NBA-realistic)
const BLOCK_BASE = 0.020, BLOCK_DIV = 420, BLOCK_MIN = 0.004, BLOCK_MAX = 0.20;
const BLOCK_THREE_CHANCE = 0.008;

// A three is not a contest — nobody meaningfully blocks a jump shot from 24
// feet — so that branch is a flat constant with no attacking side. It still
// goes through skillCheck so it draws its one rng value in the same order.
function blockSpec(defenderBlock, zone) {
  if (zone === 'three') {
    return { kind: 'block', base: BLOCK_THREE_CHANCE, attack: null, defend: null, modifiers: [], min: 0, max: 1 };
  }
  return {
    kind: 'block',
    base: BLOCK_BASE,
    attack: { label: 'block', value: defenderBlock, scale: BLOCK_DIV, energy: 1 },
    defend: null,
    modifiers: [],
    min: BLOCK_MIN, max: BLOCK_MAX
  };
}

const SHOT_BASE_BY_ZONE = { three: 0.330, mid: 0.42, inside: 0.56 };
const SHOT_SKILL_DIV = 250, SHOT_DEF_DIV = 350;
const SHOT_MIN = 0.18, SHOT_MAX = 0.72;

function shotSpec(zone, shootComposite, defComposite, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult, traitBonus) {
  return {
    kind: 'shot',
    base: SHOT_BASE_BY_ZONE[zone],
    attack: {
      label: zone === 'three' ? 'shootingThree' : (zone === 'mid' ? 'shootingMid' : 'shootingInside'),
      value: shootComposite, scale: SHOT_SKILL_DIV,
      energy: shooterEnergyMult === undefined ? 1 : shooterEnergyMult
    },
    defend: {
      label: zone === 'inside' ? 'defenseInterior' : 'defensePerimeter',
      value: defComposite, scale: SHOT_DEF_DIV,
      energy: defenderEnergyMult === undefined ? 1 : defenderEnergyMult
    },
    modifiers: [
      { label: 'team synergy', value: (offenseSynergy || 1) - (defenseSynergy || 1) },
      { label: 'badges', value: traitBonus / SHOT_TRAIT_DIV }
    ],
    min: SHOT_MIN, max: SHOT_MAX
  };
}
```

- [ ] **Step 4: Export the builders and add the skillCheck dependency**

In `simEnginePossession.js`, extend `_POSS_DATA` (line 9-19) — add to the `require` branch:

```js
      check: require('./skillCheck.js'),
```

and to the browser-global branch:

```js
      check: { skillCheck: skillCheck, skillCheckProbability: skillCheckProbability },
```

Then add to `module.exports` (line 408):

```js
    turnoverSpec: turnoverSpec,
    blockSpec: blockSpec,
    shotSpec: shotSpec,
```

- [ ] **Step 5: Run the equivalence test to confirm it passes**

```bash
node scripts/validate-skillCheck.js
```

Expected: three new `OK` lines with `max drift 0.00e+0`. If drift is non-zero, the algebra is wrong — fix the spec, never the tolerance.

- [ ] **Step 6: Rewrite the three call sites to use the specs**

Replace `shotMakeProbability` (lines 197-212) body:

```js
function shotMakeProbability(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult) {
  return _POSS_DATA.check.skillCheckProbability(shotMakeSpecFor(
    shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult)).probability;
}

// Resolves composites and the badge bonus, then hands plain numbers to shotSpec.
function shotMakeSpecFor(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult) {
  const shootKey = zone === 'three' ? 'shootingThree' : (zone === 'mid' ? 'shootingMid' : 'shootingInside');
  const defKey = zone === 'inside' ? 'defenseInterior' : 'defensePerimeter';
  return shotSpec(zone,
    _POSS_DATA.composite.computeComposite(shooter, shootKey),
    _POSS_DATA.composite.computeComposite(defender, defKey),
    offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult,
    _POSS_DATA.traits.shotQualityBonus(shooter, zone));
}
```

Replace the turnover block (lines 263-265) — note the rng draw moves inside `skillCheck`:

```js
  const turnoverCheck = _POSS_DATA.check.skillCheck(
    turnoverSpec(onBallDefender.attributes.steal, handler.attributes.ballHandling, defSyn.defense, offSyn.offense), rng);
  if (turnoverCheck.passed) {
```

Replace the block section (lines 303-307), deleting the now-hoisted constants and their comment:

```js
  const blockCheck = _POSS_DATA.check.skillCheck(blockSpec(shotDefender.attributes.block, zone), rng);
  if (blockCheck.passed) {
```

Replace the make roll (lines 316-318):

```js
  const shotCheck = _POSS_DATA.check.skillCheck(shotMakeSpecFor(shooter, shotDefender, zone,
    offSyn.offense, defSyn.defense,
    energyMultiplier(offenseBox[shooter.id].energy),
    energyMultiplier(defenseBox[shotDefender.id].energy) * foulTroubleMultiplier(defenseBox[shotDefender.id].fouls)), rng);
  const made = shotCheck.passed;
```

- [ ] **Step 7: Prove the goldens have not moved**

```bash
node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js && git diff --stat scripts/fixtures/
```

Expected: both validators pass AND `git diff --stat scripts/fixtures/` prints **nothing**.

If a golden moved, the refactor is wrong. Do **not** regenerate. The most likely cause is an rng draw added, removed or reordered — check that each `skillCheck` call sits exactly where its `rng()` used to.

- [ ] **Step 8: Run the full suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: no `FAIL` lines.

- [ ] **Step 9: Mutation-test the equivalence assertions**

| # | Mutation to `simEnginePossession.js` | Must be caught by |
|---|---|---|
| 1 | `TURNOVER_DIV` 400 → 350 | `checkTurnoverSpecMatchesTheOriginal` |
| 2 | Swap `attack`/`defend` in `turnoverSpec` | `checkTurnoverSpecMatchesTheOriginal` |
| 3 | `SHOT_DEF_DIV` 350 → 250 | `checkShotSpecMatchesTheOriginal` |
| 4 | `blockSpec` three-branch returns `BLOCK_BASE` | `checkBlockSpecMatchesTheOriginal` |
| 5 | Drop the `badges` modifier from `shotSpec` | `checkShotSpecMatchesTheOriginal` |

Restore with `git checkout -- simEnginePossession.js` after each. Verify each mutant applied before believing it survived.

- [ ] **Step 10: Commit**

```bash
git add simEnginePossession.js scripts/validate-skillCheck.js
git commit -F commit-msg.txt
```

Message: `refactor: route the three possession contests through skillCheck`, body stating the goldens did not move by a byte, the turnover algebra `(d-h)/400 == (d-50)/400 - (h-50)/400`, and the 5/5 mutation results.

---

### Task 3: Carry the check on play-by-play entries and events

**Files:**
- Modify: `simEnginePossession.js` (`logPlay`, the three call sites)
- Modify: `scripts/validate-skillCheck.js` (append)

**Interfaces:**
- Consumes: the three `*Check` results from Task 2.
- Produces: play-by-play entries are now `string | { text: string, check: object }`. Pixel events for `turnover`, `block` and shot outcomes carry `check`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-skillCheck.js`, above the final `console.log`:

```js
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

checkPlayByPlayCarriesChecks();
checkQuarterHeadersStayPlainStrings();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-skillCheck.js
```

Expected: `AssertionError: expected most plays to carry a check, got 0 of 287`

- [ ] **Step 3: Teach `logPlay` to carry a check**

Replace `logPlay` (line 217-219):

```js
// Appends a play-by-play entry if `log` was supplied (simulatePossessionGame
// always supplies one — see the module comment there on why play-by-play is
// always generated and pruned at save time instead of gated behind a flag).
//
// An entry is a bare string when there is nothing to show, or { text, check }
// when a skillCheck produced it. Both shapes coexist deliberately: gameSim.js
// pushes quarter headers as plain strings, and every save written before this
// change contains strings only, so ui/schedule.js must handle both forever.
function logPlay(log, text, check) {
  if (!log) return;
  log.push(check ? { text: text, check: check } : text);
}
```

- [ ] **Step 4: Pass the checks at the three call sites**

Turnover — add `turnoverCheck` as the third argument:

```js
    logPlay(log, handler.name + ' turns it over' + (stolen ? ', stolen by ' + onBallDefender.name : ''), turnoverCheck);
    pushEvent(eventCtx, { type: 'turnover', playerId: handler.id, defenderId: stolen ? onBallDefender.id : null, check: turnoverCheck });
```

Block:

```js
    logPlay(log, shooter.name + '\'s ' + zoneLabel + ' is blocked by ' + shotDefender.name, blockCheck);
    pushEvent(eventCtx, { type: 'block', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, check: blockCheck });
```

Shot outcome — the made branch (currently lines 339-340) and the missed branch (342-343). Note the two `rebound` plays below the miss get **no** check: a rebound is decided by `offReboundChance`, which is a synergy ratio and not an opposed attribute contest, so it has no `skillCheck` to attach.

```js
    logPlay(log, shooter.name + ' makes ' + zoneLabel + assistLine, shotCheck);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: true, points: shotValue, assistPlayerId: assistPlayerId, check: shotCheck });
  } else {
    logPlay(log, shooter.name + ' misses ' + zoneLabel, shotCheck);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: false, points: 0, assistPlayerId: null, check: shotCheck });
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
node scripts/validate-skillCheck.js
```

Expected: `checkPlayByPlayCarriesChecks: OK (…)` and `checkQuarterHeadersStayPlainStrings: OK (4 headers)`.

- [ ] **Step 6: Prove the goldens still have not moved**

The golden pins `playByPlayLength`, not content — changing entries from strings to objects must not change the count.

```bash
node scripts/validate-gamesim.js && node scripts/validate-pixel-events.js && git diff --stat scripts/fixtures/
```

Expected: both pass, `git diff --stat scripts/fixtures/` prints nothing.

`validate-pixel-events.js` proves capture-on and capture-off runs are bit-identical — adding `check` to events must not touch the rng.

- [ ] **Step 7: Run the full suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: no `FAIL` lines. Pay attention to `validate-save.js` — play-by-play round-trips through the save.

- [ ] **Step 8: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `logPlay` ignores its `check` argument | `checkPlayByPlayCarriesChecks` |
| 2 | `logPlay` wraps quarter headers too (drop the `check ?` ternary) | `checkQuarterHeadersStayPlainStrings` |
| 3 | Drop `modifiers` from the result in `skillCheck.js` | `checkPlayByPlayCarriesChecks` |

- [ ] **Step 9: Commit**

```bash
git add simEnginePossession.js scripts/validate-skillCheck.js
git commit -F commit-msg.txt
```

---

### Task 4: Expandable play-by-play in the box score

**Files:**
- Modify: `ui/schedule.js:184-189` (`playByPlayHtml`)
- Modify: `style.css` (breakdown styling)
- Modify: `scripts/ui-smoke.js` (assert a breakdown renders)

**Interfaces:**
- Consumes: play-by-play entries of shape `string | { text, check }` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing check**

In `scripts/ui-smoke.js`, add to the box-score group — a game's play-by-play must render at least one expandable breakdown naming both sides:

```js
    {
      name: 'play-by-play breakdown renders a contest',
      run: function () {
        const html = playByPlayHtml({ playByPlay: [
          '--- Q1 ---',
          { text: 'Tatum drills a 3-pointer', check: {
            kind: 'shot', base: 0.33,
            attack: { label: 'shootingThree', value: 82, scale: 250, energy: 1 },
            defend: { label: 'defensePerimeter', value: 61, scale: 350, energy: 1 },
            modifiers: [{ label: 'Sharpshooter (gold)', value: 0.01 }],
            probability: 0.41, roll: 0.22, passed: true
          } }
        ] });
        assertContains(html, 'shootingThree', 'breakdown must name the attacking rating');
        assertContains(html, 'defensePerimeter', 'breakdown must name the defending rating');
        assertContains(html, 'Sharpshooter (gold)', 'breakdown must itemise each modifier');
        assertContains(html, 'pbp-quarter', 'plain-string quarter headers must still render');
        assertContains(html, 'Tatum drills a 3-pointer', 'the play text must still render');
      }
    },
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/ui-smoke.js
```

Expected: failure reporting the breakdown does not name the attacking rating. (Today `escapeHtml(line)` on an object yields `[object Object]`.)

- [ ] **Step 3: Rewrite `playByPlayHtml`**

Replace lines 184-189 of `ui/schedule.js`:

```js
// Only present for games simmed under the possession engine (see
// simEnginePossession.js's module comment) and only for the user's own games
// (save.js prunes everyone else's, same as boxScore) — collapsed by default
// behind <details> since a full game runs ~90+ lines.
//
// An entry is either a bare string (quarter headers, and every save written
// before skill checks existed) or { text, check }. Both shapes are permanent:
// old saves must keep rendering.
function checkBreakdownHtml(check) {
  const rows = [];
  if (check.attack) {
    rows.push('<span class="pbp-check-side">' + escapeHtml(check.attack.label) + ' ' + Math.round(check.attack.value) + '</span>');
  }
  if (check.defend) {
    rows.push('<span class="pbp-check-side">vs ' + escapeHtml(check.defend.label) + ' ' + Math.round(check.defend.value) + '</span>');
  }
  const mods = (check.modifiers || []).filter(function (m) { return Math.abs(m.value) >= 0.0005; })
    .map(function (m) {
      const sign = m.value >= 0 ? '+' : '−';
      return '<span class="pbp-check-mod">' + escapeHtml(m.label) + ' ' + sign + (Math.abs(m.value) * 100).toFixed(1) + '%</span>';
    }).join('');
  return '<div class="pbp-check">' + rows.join('') + mods +
    '<span class="pbp-check-roll">' + (check.probability * 100).toFixed(1) + '% needed, rolled ' +
    (check.roll * 100).toFixed(1) + '%</span></div>';
}

function playByPlayHtml(game) {
  if (!game.playByPlay || game.playByPlay.length === 0) return '';
  const lines = game.playByPlay.map(function (entry) {
    const text = typeof entry === 'string' ? entry : entry.text;
    const check = typeof entry === 'string' ? null : entry.check;
    if (text.indexOf('--- Q') === 0) return '<div class="pbp-quarter">' + escapeHtml(text.replace(/---/g, '').trim()) + '</div>';
    if (!check) return '<div class="pbp-line">' + escapeHtml(text) + '</div>';
    return '<details class="pbp-line pbp-line-expandable"><summary>' + escapeHtml(text) + '</summary>' +
      checkBreakdownHtml(check) + '</details>';
  }).join('');
```

Leave the rest of the function (the `<details>` wrapper and return) unchanged.

- [ ] **Step 4: Add the styling**

Append to `style.css`:

```css
/* ---------- Play-by-play skill-check breakdown ---------- */
.pbp-line-expandable > summary { cursor: pointer; list-style: none; }
.pbp-line-expandable > summary::-webkit-details-marker { display: none; }
.pbp-line-expandable > summary:hover { color: var(--text); }
.pbp-check {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin: 4px 0 8px 12px; padding: 6px 8px;
  border-left: 2px solid var(--line); font-size: 11px; color: var(--text-mute);
}
.pbp-check-side { font-weight: 600; }
.pbp-check-mod { opacity: 0.85; }
.pbp-check-roll { margin-left: auto; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run the smoke check to confirm it passes**

```bash
node scripts/ui-smoke.js
```

Expected: all checks pass, including the new one.

- [ ] **Step 6: Verify in the browser**

Start the dev server via the Browser pane (`preview_start` with name `nba-gm` — never `Bash`), pick a team, sim a game, open the box score, expand a play. Confirm the breakdown shows both ratings, the named modifiers and the roll. Take a screenshot.

Then check the console for errors: there must be none other than the known `assets/logos/MIA.png` 404, which is expected and must not be reported.

- [ ] **Step 7: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `checkBreakdownHtml` returns `''` | the new smoke check |
| 2 | Drop the `mods` join from the returned string | `Sharpshooter (gold)` assertion |
| 3 | `typeof entry === 'string' ? entry : entry.text` → always `entry` | `pbp-quarter` assertion |

- [ ] **Step 8: Commit**

```bash
git add ui/schedule.js style.css scripts/ui-smoke.js
git commit -F commit-msg.txt
```

---

### Task 5: Impact-moment breakdown in the live view

**Files:**
- Modify: `ui/pixelChoreographer.js:1144-1146` (impact marker) and the keyframe pushes that carry it
- Modify: `ui/pixelHud.js` (`pixelPushCommentary`)
- Modify: `ui/pixelGameView.js:337-339` (commentary dispatch)
- Modify: `scripts/validate-pixel-choreographer.js` (assert the marker carries the check)
- Modify: `scripts/ui-smoke.js` (assert the HUD renders it)

**Interfaces:**
- Consumes: `check` on `block` and shot events from Task 3.
- Produces: `impactMarker.check`; `pixelPushCommentary(el, text, check)`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-pixel-choreographer.js`:

Uses the file's existing `buildSession(seed)` helper (defined at line 20) and `choreo.buildTimeline`, exactly as every other check in the file does.

```js
// The impact panel is the ONLY place a check surfaces during live play, so the
// marker has to carry it. A marker without a check renders a caption with no
// breakdown — the feature silently degrades to what it replaced.
//
// Sweeps seeds because impact moments are rare by design: validate-impactMoments
// gates them to 2-7 a game, so a single seed is not guaranteed to produce one.
function checkImpactMarkerCarriesTheCheck() {
  const markers = [];
  for (let seed = 1; seed <= 12; seed++) {
    const built = buildSession(seed);
    const tl = choreo.buildTimeline(built.session);
    tl.keyframes.forEach(function (kf) { if (kf.impact) markers.push(kf.impact); });
  }
  assert.ok(markers.length > 0, 'no impact markers produced across 12 seeds');
  const withCheck = markers.filter(function (m) { return m.check && m.check.kind; });
  assert.strictEqual(withCheck.length, markers.length,
    'only ' + withCheck.length + ' of ' + markers.length + ' impact markers carry their check');
  console.log('checkImpactMarkerCarriesTheCheck: OK (' + markers.length + ' markers across 12 seeds)');
}

checkImpactMarkerCarriesTheCheck();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-pixel-choreographer.js
```

Expected: `AssertionError: only 0 of N impact markers carry their check`

- [ ] **Step 3: Attach the check to the marker**

In `ui/pixelChoreographer.js`, change the marker construction at line 1144:

```js
        const impactMarker = impactKind
          ? { kind: impactKind, at: impactAt, byId: ev.playerId, onId: ev.defenderId, check: ev.check || null }
          : null;
```

Blocks build their marker inline in the `ev.type === 'block'` branch (currently line 873) rather than through `impactMarker`. Change it the same way:

```js
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, period, quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block',
          { kind: 'block', at: { x: sp[0], y: sp[1] }, byId: ev.defenderId, onId: ev.playerId, check: ev.check || null });
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
node scripts/validate-pixel-choreographer.js
```

Expected: `checkImpactMarkerCarriesTheCheck: OK (N markers)`.

- [ ] **Step 5: Write the failing HUD check**

In `scripts/ui-smoke.js`, add to the pixel group:

```js
    {
      name: 'commentary renders a check breakdown',
      run: function () {
        const el = document.createElement('div');
        pixelPushCommentary(el, 'Tatum posterizes Davis', {
          kind: 'shot',
          attack: { label: 'shootingInside', value: 88, scale: 250, energy: 1 },
          defend: { label: 'defenseInterior', value: 55, scale: 350, energy: 1 },
          modifiers: [{ label: 'Finisher (hof)', value: 0.017 }],
          probability: 0.66, roll: 0.31, passed: true
        });
        assertContains(el.innerHTML, 'shootingInside', 'commentary breakdown must name the attacking rating');
        assertContains(el.innerHTML, 'Finisher (hof)', 'commentary breakdown must itemise modifiers');
      }
    },
```

- [ ] **Step 6: Render the breakdown in the HUD**

In `ui/pixelHud.js`, extend `pixelPushCommentary` (currently around line 87):

```js
// `check` is the skillCheck that produced this play, present only on impact
// moments — posters, ankle breakers and blocks, which validate-impactMoments
// gates to 2-7 a game. Ordinary possessions pass null: at ~91 possessions a
// side a breakdown on every line would stop being read inside a quarter.
function pixelPushCommentary(el, text, check) {
  if (!el) return;
  const line = document.createElement('div');
  line.className = 'pixel-commentary-line';
  line.textContent = text;
  if (check) {
    const detail = document.createElement('div');
    detail.className = 'pixel-commentary-check';
    const parts = [];
    if (check.attack) parts.push(check.attack.label + ' ' + Math.round(check.attack.value));
    if (check.defend) parts.push('vs ' + check.defend.label + ' ' + Math.round(check.defend.value));
    (check.modifiers || []).forEach(function (m) {
      if (Math.abs(m.value) < 0.0005) return;
      parts.push(m.label + ' ' + (m.value >= 0 ? '+' : '−') + (Math.abs(m.value) * 100).toFixed(1) + '%');
    });
    parts.push((check.probability * 100).toFixed(0) + '% → ' + (check.roll * 100).toFixed(0) + '%');
    detail.textContent = parts.join('  ·  ');
    line.appendChild(detail);
  }
  el.appendChild(line);
```

Keep the rest of the existing function body (scroll/trim handling) unchanged.

- [ ] **Step 7: Pass the check through from the view**

In `ui/pixelGameView.js` around line 337, pass the keyframe's impact check:

```js
    pixelPushCommentary(document.getElementById('pixel-commentary'), kf.commentary,
      kf.impact ? kf.impact.check : null);
```

- [ ] **Step 8: Add the styling**

Append to `style.css`:

```css
.pixel-commentary-check {
  font-size: 10px; color: var(--text-mute); opacity: 0.9;
  margin-top: 2px; font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 9: Run the smoke check and full suite**

```bash
node scripts/ui-smoke.js && for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: smoke passes, no `FAIL` lines.

- [ ] **Step 10: Mutation-test — including the dead-path mutant**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `check: ev.check \|\| null` → `check: null` in the choreographer | `checkImpactMarkerCarriesTheCheck` |
| 2 | **`pixelPushCommentary` ignores `check` entirely** | the new smoke check |
| 3 | Drop the modifiers loop from `pixelPushCommentary` | `Finisher (hof)` assertion |

Mutant 2 is the important one. It is the dead-path failure this whole project exists to prevent: a rich structure built, threaded through three files, and never read. If it survives, the display is decorative and the assertion is worthless.

- [ ] **Step 11: Verify in the browser**

Start the dev server via the Browser pane, watch a game to an impact moment, confirm the commentary line shows the breakdown beneath it. Screenshot it.

- [ ] **Step 12: Verify from a fresh clone**

```bash
rm -rf /tmp/verify-sc && git clone --local -b live-game-sim . /tmp/verify-sc && cd /tmp/verify-sc && for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: no `FAIL` lines. Verifying the working tree instead of a clone is how uncommitted files hide a broken HEAD.

- [ ] **Step 13: Commit**

```bash
git add ui/pixelChoreographer.js ui/pixelHud.js ui/pixelGameView.js style.css scripts/validate-pixel-choreographer.js scripts/ui-smoke.js
git commit -F commit-msg.txt
```

---

## Done when

- `skillCheck.js` exists, is loaded in `index.html` before `simEnginePossession.js`, and has zero dependencies.
- All three possession contests route through it, and **both goldens are byte-identical to their pre-refactor state** — verified with `git diff --stat scripts/fixtures/` printing nothing.
- Every play-by-play entry produced by a contest carries its check; quarter headers remain plain strings.
- A box-score play expands to show both ratings, each named modifier and the roll.
- An impact moment's commentary line shows the same breakdown live.
- Full suite green from a fresh `git clone --local`, including the two new validators.
- Every mutant in the five tables above dies, each verified as actually applied.
