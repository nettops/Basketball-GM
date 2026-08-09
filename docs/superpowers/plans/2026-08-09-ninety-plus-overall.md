# 90+ Overall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution only — this project never uses subagent-driven development.

**Goal:** Put player `overall` on a 2K-style display scale where the league's best player reads 95 and a 90 is rare, without changing how the sim plays, and fix the regression coefficients that currently punish inside scorers.

**Architecture:** `overall` today is one field doing two jobs — a number the player reads, and a proportional weight the sim consumes. Rescaling it for the first silently corrupts the second. This plan splits them: `rawOverall` keeps the fitted value for the five sim-facing reads, `overall` becomes the display value, and every scale-sensitive gate moves out of scattered magic numbers into one `RATING_BANDS` table in `ratings.js`. Then `fit-overall.js` swaps its solver for non-negative least squares.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies, dual `require`/global module pattern. Node for validators and measurement; the browser loads every file as a plain global script in `index.html` order.

**Spec:** `docs/superpowers/specs/2026-08-09-ninety-plus-overall-design.md`

## Global Constraints

- **Zero dependencies.** NNLS is implemented as plain JS coordinate descent, not a library.
- **Dual module pattern.** Browser-global branches list names BY HAND — a missing name is a runtime error only the app shows, never Node.
- **`git add` explicit paths only.** Never `git add -A`.
- **Use `git commit -F <file>`** — PowerShell mangles multi-line `-m`.
- **Every new assertion is mutation-tested.** Break the thing the assertion protects, confirm the validator fails, restore. A surviving mutant means the assertion is worthless or the code is dead — say which, in the commit message.
- **Files are CRLF.** Multi-line mutation patterns never match. Mutate single lines only.
- **Calibrate by measured rate, never by picked values.** Every band value in Task 4 and every constant in Task 5 is chosen by measuring the resulting population share or league rate, with the sweep recorded in the commit message.
- **A/B against a control.** A number without a control is not evidence.
- **Never widen a bound to make a change pass.**
- **Verify from a fresh `git clone --local` of HEAD**, not the working tree.
- **All 42 validators must pass** at the end of every task. Run:
  `for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done`
- **Ignore the `assets/logos/MIA.png` 404.** Expected console output. Do not report it.

## The Central Guarantee

**Goldens must not move in Tasks 2, 3 and 4.** `scripts/fixtures/gamesim-golden.json` and `scripts/fixtures/rollover-golden.json` stay byte-identical, checked by `git diff --exit-code scripts/fixtures/`. If either moves, a sim-facing site was pointed at the display field. The entire risk of this change collapses into that one check.

Task 5 is the only task permitted to regenerate them, once, with before/after league rates in the commit message.

## Traps

Three things will silently corrupt this work if missed:

1. **Coaches have their own `overall`** on a hand-authored 55–95 scale (`coaches.js:74`, `awards.js:118`, `simEngineBoxScore.js:19`, asserted 55–95 in `validate-coaches.js:18`). It is NOT derived from attributes. A blind `.overall` → `.rawOverall` rename corrupts it. Every rename in Task 3 must be checked against its receiver.
2. **`defineOverall`'s idempotence guard** currently tests `overall`. After Task 3 it must test `rawOverall`, or a player carrying the old single getter never gains the new ones.
3. **`simEngineBoxScore.js:111` `minutesWeight`** is the dangerous site. Raw spans 29–78 (2.69x); display spans 60–95 (1.58x). Pointing it at display flattens star usage by 40% — the opposite of the requirement. The file already carries a scar from this exact failure at `simEngineBoxScore.js:89-103`.

## File Structure

| file | change |
|---|---|
| `ratings.js` | **modify** — add `toDisplayRating`, `toRawRating`, `RATING_BANDS`; `defineOverall` gains `rawOverall` and `potentialDisplay`; `scaleAttributesToOverall` takes a display target |
| `scripts/validate-ratingBands.js` | **create** — the tripwire |
| `simEngineBoxScore.js` | **modify** — 3 sim-facing reads move to `rawOverall` |
| `compositeRatings.js` | **modify** — 1 sort moves to `rawOverall` |
| `traits.js` | **modify** — 3 sim-facing reads move to `rawOverall`; superstar gate reads `RATING_BANDS` |
| `tradeEvaluator.js` | **modify** — star gate reads `RATING_BANDS`; kill `LEAGUE_AVG_OVERALL`; re-derive the `±10` band |
| `morale.js` | **modify** — "Limited role" gate reads `RATING_BANDS` |
| `seasonTransition.js` | **modify** — retirement gate reads `RATING_BANDS` |
| `script.js` | **modify** — injury-pause gate reads `RATING_BANDS` |
| `scripts/fit-overall.js` | **modify** — NNLS replaces Gauss-Jordan |
| `scripts/validate-ratings.js` | **modify** — assertions for the curve and the split |

---

### Task 1: The tripwire, red by design

A gate that reads a rating must catch a population that is neither empty nor the whole league. Nothing asserts that today, which is why five gates rot silently. This task adds the assertion and it FAILS — that failure is the deliverable.

**Files:**
- Create: `scripts/validate-ratingBands.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `scripts/validate-ratingBands.js`, run by the suite loop. Later tasks turn it green.

- [ ] **Step 1: Write the tripwire**

Create `scripts/validate-ratingBands.js`. It exercises the REAL code paths, not copies of the predicates — a tripwire that re-implements the gate would pass while the gate stayed dead.

```js
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const ratings = require(path.join(__dirname, '..', 'ratings.js'));
const morale = require(path.join(__dirname, '..', 'morale.js'));
const seasonTransition = require(path.join(__dirname, '..', 'seasonTransition.js'));
const tradeEvaluator = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

PLAYERS_2026.forEach(function (p) { ratings.defineOverall(p); });
const N = PLAYERS_2026.length;

// A gate that catches nobody is dead code. A gate that catches everybody is not
// a gate. Both failed silently for five separate gates when `overall` became a
// regression and its mean fell from 74.7 to 47.8 — three caught 0/380, and the
// retirement penalty INVERTED to catch 356/380. This asserts the shape of each
// population, so the next rescale cannot repeat it.
function assertShare(label, count, lo, hi) {
  const share = count / N;
  assert.ok(count > 0, label + ' catches NOBODY (' + count + '/' + N + ') — the gate is dead');
  assert.ok(count < N, label + ' catches EVERYBODY (' + count + '/' + N + ') — the gate is not a gate');
  assert.ok(share >= lo && share <= hi,
    label + ' catches ' + count + '/' + N + ' = ' + (100 * share).toFixed(1) +
    '%, intended ' + (100 * lo).toFixed(0) + '-' + (100 * hi).toFixed(0) + '%');
}

// Superstar traits: exercised through real trait generation, because the gate
// lives inside traitWeight and a re-implementation here would not see it.
function checkSuperstarTraitsAreReachable() {
  const superstarKeys = {};
  traits.TRAIT_TAXONOMY.forEach(function (t) {
    if (t.category === 'superstar') superstarKeys[t.key] = true;
  });
  assert.ok(Object.keys(superstarKeys).length === 8, 'expected 8 superstar traits');
  let holders = 0;
  PLAYERS_2026.forEach(function (p) {
    if ((p.hiddenTraits || []).some(function (h) { return superstarKeys[h.key]; })) holders += 1;
  });
  assertShare('superstar traits', holders, 0.005, 0.10);
  console.log('checkSuperstarTraitsAreReachable: OK (' + holders + '/' + N + ' hold one)');
}

function checkStarTradePremiumFires() {
  const team = { id: PLAYERS_2026[0].teamId, timeline: 'win-now' };
  let premium = 0;
  PLAYERS_2026.forEach(function (p) {
    if (tradeEvaluator.directionMultiplier(p, 'win-now') === 1.2) premium += 1;
  });
  assertShare('star trade premium', premium, 0.02, 0.20);
  console.log('checkStarTradePremiumFires: OK (' + premium + '/' + N + ')');
}

function checkLimitedRoleGripeFires() {
  let gripes = 0;
  PLAYERS_2026.forEach(function (p) {
    const saved = p.seasonStats;
    p.seasonStats = { gamesPlayed: 40, minutes: 40 * 10 };  // 10 mpg: under-used
    const reasons = morale.getMoraleReasons(p, null);
    if (reasons.indexOf('Limited role') !== -1) gripes += 1;
    p.seasonStats = saved;
  });
  assertShare('Limited role gripe', gripes, 0.10, 0.50);
  console.log('checkLimitedRoleGripeFires: OK (' + gripes + '/' + N + ' at 10 mpg)');
}

// The retirement penalty is the one that INVERTED. Measured by whether the
// penalty applies, not by whether the player retires, so age does not confound.
function checkRetirementPenaltyTargetsFringe() {
  let penalised = 0;
  PLAYERS_2026.forEach(function (p) {
    if (seasonTransition.hasRetirementPenalty(p)) penalised += 1;
  });
  assertShare('retirement penalty', penalised, 0.10, 0.40);
  console.log('checkRetirementPenaltyTargetsFringe: OK (' + penalised + '/' + N + ')');
}

checkSuperstarTraitsAreReachable();
checkStarTradePremiumFires();
checkLimitedRoleGripeFires();
checkRetirementPenaltyTargetsFringe();
console.log('validate-ratingBands: OK');
```

- [ ] **Step 2: Export the two predicates the tripwire needs**

`morale.getMoraleReasons` and `tradeEvaluator.directionMultiplier` may not be exported, and `seasonTransition` has no penalty predicate at all — the penalty is inline in `rollRetirement`. Extract it so it is testable without rolling dice:

In `seasonTransition.js`, replace the inline penalty:

```js
function hasRetirementPenalty(player) {
  return player.overall < 65;
}

function rollRetirement(player, rng) {
  if (player.age < 34) return false;
  const baseChance = (player.age - 33) * 0.08;
  const overallPenalty = hasRetirementPenalty(player) ? 0.15 : 0;
  return rng() < Math.min(0.9, baseChance + overallPenalty);
}
```

Add `hasRetirementPenalty` to `seasonTransition.js`'s exports, and add `getMoraleReasons` / `directionMultiplier` to their modules' exports if absent. Check the browser-global branch of each — a name added to `module.exports` but not to the global list is a browser-only crash.

- [ ] **Step 3: Run it and confirm it fails for the right reasons**

Run: `node scripts/validate-ratingBands.js`
Expected: FAIL on `checkSuperstarTraitsAreReachable` — "superstar traits catches NOBODY (0/380) — the gate is dead".

Comment out that check and re-run to confirm each of the others in turn. Expected:
- star trade premium: **0/380**, dead
- Limited role gripe: 24/380 = 6.3%, below the 10% floor
- retirement penalty: **356/380 = 93.7%**, above the 40% ceiling

Record all four numbers — they are the before-column for Task 4.

- [ ] **Step 4: Confirm the rest of the suite is unaffected**

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done`
Expected: only `FAIL scripts/validate-ratingBands.js`.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-ratingBands.js seasonTransition.js morale.js tradeEvaluator.js
git commit -F commit-msg.txt
```

The message states all four measured populations and that the validator is red by design.

---

### Task 2: The display curve as a pure function

Add the curve and its assertions with nothing consuming it. Pure, isolated, and green — so if a later task breaks something, the curve itself is already proven.

**Files:**
- Modify: `ratings.js`
- Modify: `scripts/validate-ratings.js`

**Interfaces:**
- Produces: `toDisplayRating(raw) -> int 0..100`, `toRawRating(display) -> float 0..100`, `RATING_BANDS` object. Task 3 consumes the first two; Task 4 consumes `RATING_BANDS`.

- [ ] **Step 1: Write the failing assertions**

Append to `scripts/validate-ratings.js`, and add the calls at the bottom of the file next to the existing ones:

```js
// The curve maps the fitted value onto the scale players actually read. Three
// properties make it safe, and all three are load-bearing:
//   monotone   - a better player never reads worse
//   bounded    - nothing escapes 0..100, including a hypothetical all-100 player
//   ABSOLUTE   - the same attributes give the same number regardless of who
//                else is in the league. A percentile-based mapping would fail
//                this, and would silently re-rate the whole league every time
//                a draft class arrived.
function checkDisplayCurveIsMonotoneAndBounded() {
  let prev = -1;
  for (let raw = 0; raw <= 100; raw += 0.25) {
    const d = ratings.toDisplayRating(raw);
    assert.ok(d >= 0 && d <= 100, 'display escaped 0..100 at raw ' + raw + ': ' + d);
    assert.ok(d >= prev, 'display curve went DOWN at raw ' + raw + ': ' + prev + ' -> ' + d);
    prev = d;
  }
  assert.strictEqual(ratings.toDisplayRating(78), 95, 'raw 78 anchors the top knot at 95');
  assert.strictEqual(ratings.toDisplayRating(29), 60, 'raw 29 anchors the bottom knot at 60');
  assert.strictEqual(ratings.toDisplayRating(100), 100, 'a perfect player reads 100');
  console.log('checkDisplayCurveIsMonotoneAndBounded: OK');
}

function checkDisplayCurveIsAbsolute() {
  // Same attributes, two different "leagues". The number must not move.
  const solo = { attributes: {} };
  const crowd = { attributes: {} };
  ATTRIBUTE_KEYS.forEach(function (k) { solo.attributes[k] = 62; crowd.attributes[k] = 62; });
  ratings.defineOverall(solo);
  ratings.defineOverall(crowd);
  assert.strictEqual(solo.overall, crowd.overall,
    'display must depend only on the player, never on the league around them');
  const before = PLAYERS_2026[0].overall;
  assert.strictEqual(ratings.toDisplayRating(ratings.computeOverall(PLAYERS_2026[0])), before,
    'display must be a pure function of the raw value');
  console.log('checkDisplayCurveIsAbsolute: OK (' + solo.overall + ')');
}

function checkDisplayCurveRoundTrips() {
  // toRawRating is the inverse used by scaleAttributesToOverall. Display is
  // rounded, so the round trip is exact only to within one display step.
  for (let d = 40; d <= 100; d++) {
    const raw = ratings.toRawRating(d);
    assert.strictEqual(ratings.toDisplayRating(raw), d,
      'round trip failed at display ' + d + ' (raw ' + raw.toFixed(3) + ')');
  }
  console.log('checkDisplayCurveRoundTrips: OK');
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/validate-ratings.js`
Expected: FAIL — `TypeError: ratings.toDisplayRating is not a function`.

- [ ] **Step 3: Implement the curve**

In `ratings.js`, after `OVERALL_INTERCEPT`:

```js
// THE DISPLAY CURVE. `overall` is fitted to mean 50 / SD 9, which puts a 90 at
// +4.4 SD — unreachable in a 380-player league, where the measured max is 78.
// This maps the fitted value onto the scale players actually read.
//
// The knots are ABSOLUTE, never league-relative. A percentile mapping would
// re-rate every player the moment a draft class arrived, and "I signed a 90"
// would stop meaning anything across seasons.
//
// The slope above the top knot is deliberately flatter: it reserves 96-100 for
// a player genuinely better than anyone alive today. The cost is real and
// accepted — only 5 display points remain above the current best player, so
// progression at the very top compresses. This is how 2K behaves; nobody is a 99.
const DISPLAY_KNOT = { rawLo: 29, dispLo: 60, rawHi: 78, dispHi: 95 };
const DISPLAY_SLOPE_LO = (DISPLAY_KNOT.dispHi - DISPLAY_KNOT.dispLo) / (DISPLAY_KNOT.rawHi - DISPLAY_KNOT.rawLo);
const DISPLAY_SLOPE_HI = (100 - DISPLAY_KNOT.dispHi) / (100 - DISPLAY_KNOT.rawHi);

function toDisplayRating(raw) {
  const v = raw <= DISPLAY_KNOT.rawHi
    ? DISPLAY_KNOT.dispLo + (raw - DISPLAY_KNOT.rawLo) * DISPLAY_SLOPE_LO
    : DISPLAY_KNOT.dispHi + (raw - DISPLAY_KNOT.rawHi) * DISPLAY_SLOPE_HI;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Deliberately NOT rounded — scaleAttributesToOverall solves against it, and
// rounding here would make the solver chase a target it can never hit exactly.
function toRawRating(display) {
  const v = display <= DISPLAY_KNOT.dispHi
    ? DISPLAY_KNOT.rawLo + (display - DISPLAY_KNOT.dispLo) / DISPLAY_SLOPE_LO
    : DISPLAY_KNOT.rawHi + (display - DISPLAY_KNOT.dispHi) / DISPLAY_SLOPE_HI;
  return Math.max(0, Math.min(100, v));
}

// Every gate that reads a rating lives here, named by INTENT rather than by
// number. Five gates were scattered as magic numbers across five files, all
// written for the old authored 62-98 scale, and all silently rotted when
// `overall` became a regression — three caught nobody at all. One table means
// the next rescale is one edit, and validate-ratingBands.js can assert the
// population each one catches.
const RATING_BANDS = {
  superstar: 90,           // the genuine elite — gates the 8 superstar traits
  superstarPotential: 92,  // ...or the potential to become one
  star: 85,                // stars: trade premium, worth pausing the sim for
  rotation: 78,            // good enough that a bench role is worth complaining about
  fringe: 68               // fringe: likelier to retire
};
```

Add all five names to both branches of `module.exports` and the browser-global object.

- [ ] **Step 4: Run to verify they pass**

Run: `node scripts/validate-ratings.js`
Expected: PASS, including the three new checks.

- [ ] **Step 5: Confirm the goldens did not move**

Run: `git diff --exit-code scripts/fixtures/`
Expected: no output, exit 0. Nothing consumes the curve yet, so anything else is a bug.

- [ ] **Step 6: Mutation-test the three new assertions**

Confirm each fails when its property is broken. One line at a time — the files are CRLF.

| mutant | expected to fail |
|---|---|
| `dispHi: 95` → `dispHi: 90` | `checkDisplayCurveIsMonotoneAndBounded` (top knot) |
| `DISPLAY_SLOPE_HI` → `-0.2273` | monotonicity |
| drop the `Math.min(100, ...)` clamp | boundedness at raw 100 |
| `toRawRating` uses `DISPLAY_SLOPE_LO` for both branches | `checkDisplayCurveRoundTrips` |

A survivor means the assertion is worthless or the code is dead — say which, in the commit.

- [ ] **Step 7: Commit**

```bash
git add ratings.js scripts/validate-ratings.js
git commit -F commit-msg.txt
```

---

### Task 3: The split — `rawOverall`, and the sim keeps the raw value

The containment proof. Everything the sim reads moves to `rawOverall`; `overall` becomes display. The goldens must not move.

**Files:**
- Modify: `ratings.js`, `simEngineBoxScore.js`, `compositeRatings.js`, `traits.js`, `scripts/validate-ratings.js`

**Interfaces:**
- Consumes: `toDisplayRating` from Task 2.
- Produces: `player.rawOverall` (raw fitted, sim-facing), `player.overall` (display), `player.potentialDisplay`.

- [ ] **Step 1: Write the failing assertions**

Append to `scripts/validate-ratings.js`:

```js
// One field cannot mean two things. `overall` was both the number a player
// reads and a proportional weight the sim consumes, and rescaling it for the
// first would have flattened star usage by 40% — raw spans 29-78 (2.69x),
// display spans 60-95 (1.58x). Stars would have taken proportionally FEWER
// shots. simEngineBoxScore.js:89-103 already records this failure happening once.
function checkRawAndDisplayAreBothPresent() {
  const p = PLAYERS_2026[0];
  assert.ok(typeof p.rawOverall === 'number', 'rawOverall must exist');
  assert.ok(typeof p.overall === 'number', 'overall must exist');
  assert.strictEqual(p.overall, ratings.toDisplayRating(p.rawOverall),
    'overall must be the display of rawOverall');
  assert.ok(typeof p.potentialDisplay === 'number', 'potentialDisplay must exist');
  assert.strictEqual(p.potentialDisplay, ratings.toDisplayRating(p.potential),
    'potentialDisplay must be the display of the stored raw potential');
  console.log('checkRawAndDisplayAreBothPresent: OK (raw ' + p.rawOverall + ' -> ' + p.overall + ')');
}

// Neither may serialise. A saved league that carries a frozen rating rebuilds
// the stored-overall drift bug through the back door.
function checkNeitherRatingSerialises() {
  const json = JSON.stringify(PLAYERS_2026[0]);
  assert.ok(json.indexOf('"overall"') === -1, 'overall must not serialise');
  assert.ok(json.indexOf('"rawOverall"') === -1, 'rawOverall must not serialise');
  assert.ok(json.indexOf('"potentialDisplay"') === -1, 'potentialDisplay must not serialise');
  assert.ok(json.indexOf('"potential"') !== -1, 'the STORED raw potential must still serialise');
  console.log('checkNeitherRatingSerialises: OK');
}

// The proportional spread minutesWeight depends on. If this narrows, stars are
// taking fewer shots than they should and the sim has been quietly rebalanced.
function checkUsageSpreadStaysWide() {
  const weights = PLAYERS_2026.map(function (p) { return p.rawOverall; });
  const spread = Math.max.apply(null, weights) / Math.min.apply(null, weights);
  assert.ok(spread >= 2.4,
    'usage spread collapsed to ' + spread.toFixed(2) + 'x — minutesWeight is reading the display field');
  console.log('checkUsageSpreadStaysWide: OK (' + spread.toFixed(2) + 'x)');
}

// Coaches carry their own hand-authored overall on a 55-95 scale. It is not
// derived from attributes and must never be routed through the player curve.
function checkCoachOverallIsUntouched() {
  const coaches = require(path.join(__dirname, '..', 'coaches.js'));
  const all = coaches.COACHES || coaches.getAllCoaches();
  all.forEach(function (c) {
    assert.ok(c.overall >= 55 && c.overall <= 95,
      'coach ' + c.name + ' overall ' + c.overall + ' left the authored 55-95 band');
    assert.ok(c.rawOverall === undefined, 'a coach must never gain rawOverall');
  });
  console.log('checkCoachOverallIsUntouched: OK (' + all.length + ' coaches)');
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/validate-ratings.js`
Expected: FAIL — "rawOverall must exist".

- [ ] **Step 3: Split the getters**

Replace `defineOverall` in `ratings.js`:

```js
// Two getters, two meanings. `rawOverall` is the fitted value the SIM consumes
// as a proportional weight; `overall` is the number the PLAYER reads. Splitting
// them is what lets the display scale change without touching how the game plays.
//
// The idempotence guard tests `rawOverall`, NOT `overall`: a player carrying the
// older single-getter shape must still gain the new ones, and guarding on
// `overall` would skip them forever.
function defineOverall(player) {
  const existing = Object.getOwnPropertyDescriptor(player, 'rawOverall');
  if (existing && existing.get) return player;
  delete player.overall;
  delete player.rawOverall;
  delete player.potentialDisplay;
  function derived(name, get) {
    Object.defineProperty(player, name, {
      get: get,
      set: function () {
        throw new Error(name + ' is derived from the attributes (ratings.js) and cannot be ' +
          'assigned. Change the attributes instead — see scaleAttributesToOverall.');
      },
      enumerable: false,
      configurable: true
    });
  }
  derived('rawOverall', function () { return computeOverall(this); });
  derived('overall', function () { return toDisplayRating(computeOverall(this)); });
  derived('potentialDisplay', function () { return toDisplayRating(this.potential); });
  return player;
}
```

- [ ] **Step 4: Point `scaleAttributesToOverall` at a display target**

Its callers (commissioner, god mode, random events) mean "make this player a 90" on the scale the user sees. Convergence is checked in display space so it terminates on an integer; the shift is computed in raw space where the model is linear:

```js
function scaleAttributesToOverall(player, target) {
  const keys = _RATINGS_DATA.data.ATTRIBUTE_KEYS;
  let totalCoef = 0;
  keys.forEach(function (k) {
    if (OVERALL_COEFFICIENTS[k]) totalCoef += OVERALL_COEFFICIENTS[k].coef;
  });
  if (!totalCoef) return player;
  const rawTarget = toRawRating(target);
  for (let pass = 0; pass < 40; pass++) {
    if (toDisplayRating(computeOverall(player)) === target) break;
    const shift = (rawTarget - computeOverall(player)) / totalCoef;
    let moved = false;
    keys.forEach(function (k) {
      const next = Math.max(0, Math.min(100, Math.round(player.attributes[k] + shift)));
      if (next !== player.attributes[k]) { player.attributes[k] = next; moved = true; }
    });
    if (!moved) break;   // every attribute is pinned; this target is unreachable
  }
  return player;
}
```

- [ ] **Step 5: Repoint the five sim-facing reads**

Each one individually — check the receiver before every edit, because `team.coach.overall` must NOT change.

`simEngineBoxScore.js:7` and `:9` (inside `computeTeamRating`):
```js
  const rotation = roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).slice(0, 8);
  if (rotation.length === 0) return 50; // fully depleted roster fallback, shouldn't happen with real data
  const avgOverall = rotation.reduce(function (s, p) { return s + p.rawOverall; }, 0) / rotation.length;
```
**Leave `simEngineBoxScore.js:19` `team.coach.overall` exactly as it is.**

`simEngineBoxScore.js:111`:
```js
function minutesWeight(player) {
  return Math.max(1, player.rawOverall + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'usage'));
}
```

`compositeRatings.js:106`:
```js
  const rotation = roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).slice(0, 8);
```

`traits.js:146`, `:187`, `:300`:
```js
  const skill = (player.rawOverall + player.potential) / 2;
```
```js
  const traitCount = Math.max(1, Math.min(6,
    Math.round((player.rawOverall - TRAIT_COUNT_FLOOR) / TRAIT_COUNT_STEP)));
```
```js
    ego: personalityAxis(30 + player.rawOverall * 0.4, 50, rng),
```

Leave `traits.js:107`'s superstar gate alone — Task 4 owns it.

- [ ] **Step 6: Run the assertions and the full suite**

Run: `node scripts/validate-ratings.js` — expected PASS.
Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done`
Expected: only `FAIL scripts/validate-ratingBands.js`, still red from Task 1.

- [ ] **Step 7: THE CENTRAL CHECK — the goldens must not have moved**

Run: `git diff --exit-code scripts/fixtures/`
Expected: no output, exit 0.

If this fails, a sim-facing site is reading the display field. Do NOT regenerate the goldens. Find the site. `git diff scripts/fixtures/ | head -40` shows which scores moved; work backwards from the teams involved.

- [ ] **Step 8: Mutation-test**

| mutant | expected to fail |
|---|---|
| `minutesWeight` reads `player.overall` | `checkUsageSpreadStaysWide` AND `git diff --exit-code scripts/fixtures/` |
| `overall` getter returns the raw value | `checkRawAndDisplayAreBothPresent` |
| `rawOverall` declared `enumerable: true` | `checkNeitherRatingSerialises` |
| guard reverted to test `overall` | run `defineOverall` twice on a player shaped the old way; `rawOverall` never appears |
| `traits.js:187` reads `player.overall` | trait-count assertions in `validate-traits.js` |

The first row is the important one: it must fail BOTH ways. An assertion that catches it and a golden that does not means the golden check is not actually wired.

- [ ] **Step 9: Commit**

```bash
git add ratings.js simEngineBoxScore.js compositeRatings.js traits.js scripts/validate-ratings.js
git commit -F commit-msg.txt
```

The message must state plainly that the goldens did not move, and that this is the evidence the sim is unchanged.

---

### Task 4: Re-anchor every gate, tripwire goes green

**Files:**
- Modify: `traits.js`, `tradeEvaluator.js`, `morale.js`, `seasonTransition.js`, `script.js`

**Interfaces:**
- Consumes: `RATING_BANDS` from Task 2, `player.overall` (display) from Task 3.
- Produces: tripwire green.

- [ ] **Step 1: Measure the population each candidate band catches**

Before editing anything, run and record:

```bash
node -e "
require('./data.js'); require('./rng.js'); require('./traits.js'); require('./scouting.js');
const {PLAYERS_2026}=require('./players-2026.js'); const R=require('./ratings.js');
PLAYERS_2026.forEach(p=>R.defineOverall(p));
const d=PLAYERS_2026.map(p=>p.overall).sort((a,b)=>b-a); const n=d.length;
[95,92,90,88,85,82,80,78,75,72,70,68,65].forEach(t=>console.log('>='+t+'  '+d.filter(v=>v>=t).length+'  ('+(100*d.filter(v=>v>=t).length/n).toFixed(0)+'%)'));
console.log('<=68: '+d.filter(v=>v<=68).length+'   <=70: '+d.filter(v=>v<=70).length);
"
```

Expected at the current coefficients:
`>=90: 7 (2%)` · `>=85: 27 (7%)` · `>=78: 102 (27%)` · `<=68: 97 (26%)`

If a band's measured share falls outside the tripwire's intended range, **move the band, never the range.** Widening a bound to make a change pass is forbidden.

- [ ] **Step 2: Wire each gate to the table**

`traits.js:107` — requires adding `ratings` to `_TRAITS_DATA`. `ratings.js` loads 3rd in `index.html` and depends only on `data.js`, so there is no cycle:

```js
var _TRAITS_DATA = (typeof require !== 'undefined')
  ? { rng: require('./rng.js'), ratings: require('./ratings.js') }
  : { rng: { makeRng: makeRng }, ratings: { RATING_BANDS: RATING_BANDS } };
```
```js
    return (player.overall >= _TRAITS_DATA.ratings.RATING_BANDS.superstar ||
            player.potentialDisplay >= _TRAITS_DATA.ratings.RATING_BANDS.superstarPotential) ? 1 : 0;
```
Update the comment on `traits.js:66` — it names the old `overall>=85 or potential>=88` gate.

`tradeEvaluator.js:82`:
```js
    if (player.overall >= _EVAL_DATA.ratings.RATING_BANDS.star) return 1.2;
```

`tradeEvaluator.js:89` — delete `LEAGUE_AVG_OVERALL` and use a scale-free fallback. A hardcoded 75 is a bet on where the scale sits, and that bet has now been wrong twice:
```js
function currentLeagueAvgOverall() {
  const allPlayers = _EVAL_DATA.players.PLAYERS_2026;
  if (allPlayers.length === 0) return _EVAL_DATA.ratings.toDisplayRating(50);  // the fitted mean
  return allPlayers.reduce(function (s, p) { return s + p.overall; }, 0) / allPlayers.length;
}
```

`tradeEvaluator.js:107-108` — the `±10` band is scale-sensitive. Raw SD is 9.89; display SD is 9.89 × 0.7143 ≈ 7.06, so a literal `10` widens from 1.01 SD to 1.42 SD and `needMultiplier` fires less often. Re-derive it to hold the same fraction of a standard deviation:
```js
  // 10 on the raw scale was 1.01 SD. Display SD is 7.06, so 7 holds the same width.
  const POSITION_GAP = 7;
  if (avgAtPosition < leagueAvg - POSITION_GAP) return 1.15;
  if (avgAtPosition > leagueAvg + POSITION_GAP) return 0.9;
```
Measure it: count how many (team, position) pairs return 1.15 or 0.9 before and after. The count must be within 10% of the pre-change count. If it is not, solve for the gap that holds it and record the sweep.

`morale.js:41`:
```js
    if (mpg < 15 && player.overall >= _MORALE_DATA.ratings.RATING_BANDS.rotation) reasons.push('Limited role');
```

`seasonTransition.js`:
```js
function hasRetirementPenalty(player) {
  return player.overall < _TRANSITION_DATA.ratings.RATING_BANDS.fringe;
}
```

`script.js:170,172` — browser-only, so `RATING_BANDS` arrives as a global:
```js
    if (GameState.playMode !== 'spectator' && !isUserPlayer && player.overall < RATING_BANDS.star) return;
    pushToFeed(player.name + ' (' + getTeamById(inj.teamId).name + ') injured: ' + inj.severity, dayIndex);
    if (isUserPlayer && player.overall >= RATING_BANDS.star && GameState.settings.pauseOn.keyInjury) {
```

For every module that gains a `ratings` dependency, add it to BOTH branches of its `_X_DATA` and confirm the browser-global branch names it. A name present in `module.exports` but missing from the global list is a browser-only crash Node never sees.

- [ ] **Step 3: Run the tripwire**

Run: `node scripts/validate-ratingBands.js`
Expected: PASS, all four checks. Superstar traits should now be held by roughly 7–20 players (the gate admits them; the weighted draw decides how many actually take one).

- [ ] **Step 4: Full suite and the golden check**

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done`
Expected: no failures. 43 validators now.

Run: `git diff --exit-code scripts/fixtures/`
Expected: no output. Gates feed UI and front-office logic, not the possession engine.

**Exception to check for:** `traits.js`'s superstar gate feeds trait GENERATION, and traits feed the sim. If the goldens move here, it is because eight previously-unreachable traits are now being drawn. That is legitimate and expected — but it must be confirmed as the cause rather than assumed. Verify by temporarily reverting only the superstar gate and re-running the golden check.

- [ ] **Step 5: Mutation-test**

| mutant | expected to fail |
|---|---|
| `superstar: 90` → `superstar: 85` (the old value) | `checkSuperstarTraitsAreReachable` share ceiling |
| `star: 85` → `star: 80` | `checkStarTradePremiumFires` share ceiling |
| `fringe: 68` → `fringe: 65` (the old value) | `checkRetirementPenaltyTargetsFringe` |
| `rotation: 78` → `rotation: 65` (the old value) | `checkLimitedRoleGripeFires` share floor |
| `morale.js` reverted to a literal `65` | `checkLimitedRoleGripeFires` |

The last row matters most: it proves each call site actually reads the table rather than carrying its own copy. A survivor there means the table is decorative.

- [ ] **Step 6: Commit**

```bash
git add traits.js tradeEvaluator.js morale.js seasonTransition.js script.js
git commit -F commit-msg.txt
```

Record the before/after population for all five gates, and state that eight superstar traits are now reachable for the first time.

---

### Task 5: Non-negative coefficients

The only task allowed to move the goldens.

**Files:**
- Modify: `scripts/fit-overall.js`, `ratings.js` (pasted coefficients + re-derived knots)
- Regenerate: `scripts/fixtures/gamesim-golden.json`, `scripts/fixtures/rollover-golden.json`

**Interfaces:**
- Produces: a coefficient set with every slope >= 0, and re-derived `DISPLAY_KNOT` values.

- [ ] **Step 1: Write the failing assertion**

Append to `scripts/validate-ratings.js`:

```js
// A rating where being BETTER at something makes you WORSE is broken as a
// rating. Five coefficients were negative, insideScoring worst at -0.086, so
// improving a big man's inside game lowered his overall.
//
// They were collinearity artifacts, not signal. Max |r| in the attribute matrix
// is 0.910 (interiorDefense/block), and every negative had a strongly
// correlated partner carrying a large positive: insideScoring/acceleration
// r=.71, freeThrow/threePoint r=.81, passing/ballHandling r=.85. At that level
// the individual coefficients are not identified — only sums along correlated
// directions are. The proof: the shipped fit had FIVE negatives and a re-fit on
// different data had TWO, three having flipped sign purely from resampling.
function checkNoCoefficientPunishesSkill() {
  const negative = ATTRIBUTE_KEYS.filter(function (k) {
    return ratings.OVERALL_COEFFICIENTS[k] && ratings.OVERALL_COEFFICIENTS[k].coef < 0;
  });
  assert.strictEqual(negative.length, 0,
    'these attributes LOWER overall when improved: ' + negative.join(', '));
  console.log('checkNoCoefficientPunishesSkill: OK (all 20 >= 0)');
}
```

Run: `node scripts/validate-ratings.js` — expected FAIL, listing five attributes.

- [ ] **Step 2: Replace the solver with NNLS**

In `scripts/fit-overall.js`, add alongside `solve` (keep `solve` — Step 3 needs it as the control):

```js
// Non-negative least squares by coordinate descent on the normal equations.
// Each pass sets one coefficient to its optimum given the others and clamps it
// at zero; the intercept stays unconstrained. Converges reliably here because
// the ridge penalty makes the Gram matrix strictly diagonally dominant.
//
// Constraining the sign discards nothing real: with |r| up to 0.910 between
// attributes, the negative coefficients were arbitrary splits of shared signal,
// not evidence that inside scoring loses games.
function solveNonNegative(A, b, iters) {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let maxDelta = 0;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (k !== j) s += A[j][k] * x[k];
      const v = (b[j] - s) / A[j][j];
      const next = (j === n - 1) ? v : Math.max(0, v);   // intercept unconstrained
      if (Math.abs(next - x[j]) > maxDelta) maxDelta = Math.abs(next - x[j]);
      x[j] = next;
    }
    if (maxDelta < 1e-12) break;
  }
  return x;
}
```

Replace `const coef = solve(A, b);` with `const coef = solveNonNegative(A, b, 5000);`

- [ ] **Step 3: Run the A/B at full game count**

Both arms on identical data — same seed, same game count, same ridge. A number without a control is not evidence.

```bash
FIT_GAMES=1800 node scripts/fit-overall.js > /tmp/nnls.txt 2>/tmp/nnls.err
cat /tmp/nnls.err
```

Record: player count, in-sample r, and the count of negative coefficients (must be 0). Compare against the shipped `r 0.823` at the same 1800 games. Expected cost is roughly 1–2% relative r, measured at 900 games as 0.7333 → 0.7204.

**If the cost exceeds 5% relative r, stop and report.** That would mean the negatives were carrying real signal and the premise needs revisiting.

- [ ] **Step 4: Paste the coefficients and re-derive the knots**

Paste the generated `OVERALL_COEFFICIENTS` and `OVERALL_INTERCEPT` into `ratings.js`.

The knots were calibrated against the OLD raw distribution and are now stale. Re-measure and update `DISPLAY_KNOT`:

```bash
node -e "
require('./data.js'); require('./rng.js'); require('./traits.js'); require('./scouting.js');
const {PLAYERS_2026}=require('./players-2026.js'); const R=require('./ratings.js');
PLAYERS_2026.forEach(p=>R.defineOverall(p));
const raw=PLAYERS_2026.map(p=>R.computeOverall(p)).sort((a,b)=>b-a);
console.log('raw max='+raw[0]+'  min='+raw[raw.length-1]+'  mean='+(raw.reduce((a,c)=>a+c,0)/raw.length).toFixed(1));
"
```

Set `rawHi` to the new maximum and `rawLo` to the new minimum, keeping `dispLo: 60` and `dispHi: 95`. Re-run `node scripts/validate-ratings.js` — the knot assertions in Task 2 hardcode 78 and 29, so **update those two assertions to the new knots** in the same commit. This is the one place changing an assertion is correct: it pins a calibration, and the calibration legitimately moved.

- [ ] **Step 5: Measure the league before and after**

```bash
node scripts/measure-identity.js
```

Record FG%, 3P%, 3PA share, pts/team, distinct shapes, shot volume, assist rate — the 5-seed averages. Compare against the Task 4 values.

Because `minutesWeight` reads `rawOverall`, lifting bigs' coefficients gives bigs more usage and more inside shots. FG% should rise slightly and 3PA share should fall slightly. **Every rate must stay inside the bounds in `validate-possession.js` and `validate-identity.js`.** If one does not, do not widen the bound — report it, with the measured direction and size, and stop.

- [ ] **Step 6: Regenerate the goldens, once**

```bash
node scripts/gen-gamesim-golden.js
node scripts/gen-rollover-golden.js
git diff --stat scripts/fixtures/
```

- [ ] **Step 7: Full suite**

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done`
Expected: no failures.

Re-run `node scripts/validate-ratingBands.js` specifically — the raw distribution moved, so every band's population share moved with it. If a share left its intended range, re-derive the band, not the range.

- [ ] **Step 8: Mutation-test**

| mutant | expected to fail |
|---|---|
| restore `solve` in place of `solveNonNegative` and re-fit | `checkNoCoefficientPunishesSkill` |
| flip one pasted coefficient negative | `checkNoCoefficientPunishesSkill` |
| `next = v` (drop the `Math.max(0, ...)` clamp) | `checkNoCoefficientPunishesSkill` after re-fit |

- [ ] **Step 9: Commit**

```bash
git add scripts/fit-overall.js ratings.js scripts/validate-ratings.js scripts/fixtures/gamesim-golden.json scripts/fixtures/rollover-golden.json
git commit -F commit-msg.txt
```

The message MUST justify the golden regeneration with before/after league rates, state the in-sample r for both arms at the same game count, and name the players whose league rank moved most.

---

### Task 6: UI audit, browser verification, full verification

**Files:**
- Modify: `ui/*.js` as the audit finds, `scripts/validate-ratings.js`

- [ ] **Step 1: Assert no UI file reads raw `.potential`**

`potential` stays stored-raw while `overall` is display. A UI showing raw `potential` beside display `overall` renders potential BELOW overall for every player. Append to `scripts/validate-ratings.js`:

```js
// The asymmetry is deliberate — progression pulls players by
// `potential - rawOverall` and save files already store the raw value — but it
// is a trap: raw potential rendered beside display overall reads as potential
// BELOW overall for every player in the league. UI must use potentialDisplay.
function checkUiNeverReadsRawPotential() {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'ui');
  const offenders = [];
  fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    src.split(/\r?\n/).forEach(function (line, i) {
      if (/\.potential\b/.test(line) && !/potentialDisplay/.test(line)) {
        offenders.push(f + ':' + (i + 1) + '  ' + line.trim());
      }
    });
  });
  assert.strictEqual(offenders.length, 0,
    'UI must read potentialDisplay, not raw potential:\n  ' + offenders.join('\n  '));
  console.log('checkUiNeverReadsRawPotential: OK');
}
```

Run it, fix every offender by switching to `potentialDisplay`, re-run until green.

- [ ] **Step 2: Audit the UI for rating bands**

```bash
grep -rn "overall\s*[><]=\?\s*[0-9]\|[0-9]\{2\}\s*[><]=\?\s*.*overall" ui/ script.js
```

`ui/roster.js` is known to carry rating colour bands from the previous ratings work. Every band found must be re-anchored to the display scale or moved to `RATING_BANDS`. Record each one changed.

- [ ] **Step 3: Verify in the browser**

Start the preview (no-store threaded server on a fresh port, or stale JS stays pinned). Check, on screen:

- Roster: Luka reads **95**, Jokic/SGA/Wembanyama **92**, bench players 60–68. No player reads below 60 or above 95.
- Player profile: overall and potential are on the SAME scale — potential >= overall for young players, never inverted.
- Player profile badges: superstar traits now appear on elite players. At least one of the eight is visible somewhere in the league.
- Rating colour bands are not all one colour (the give-away that a band went stale).
- Console is clean apart from the known `MIA.png` 404.

Screenshot the roster and one elite player profile.

- [ ] **Step 4: Full verification from a fresh clone**

```bash
git clone --local . /tmp/nba-verify && cd /tmp/nba-verify
for f in scripts/validate-*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
node scripts/measure-identity.js
```

Expected: 43/43 pass. Verifying the working tree instead of a clone is what let an untracked file hide a broken build before.

- [ ] **Step 5: Commit and clean up**

```bash
git add scripts/validate-ratings.js ui/
git commit -F commit-msg.txt
rm -rf /tmp/nba-verify
```

---

## Self-Review

Checked against the spec:

- **Spec coverage.** Two fields → Task 3. The curve → Task 2. NNLS → Task 5. Threshold re-anchoring → Task 4. `scaleAttributesToOverall` → Task 3 Step 4. Goldens-must-not-move → Tasks 2/3/4. The tripwire → Task 1. `potentialDisplay` and the `ui/` ban → Tasks 3 and 6.
- **Two findings arrived after the spec was written** and are covered here but not there: `LEAGUE_AVG_OVERALL = 75` (a sixth stale constant) and `needMultiplier`'s scale-sensitive `±10` band, both in Task 4 Step 2. The spec should be amended or these will read as unplanned scope.
- **One design refinement:** the spec describes five scattered thresholds; this plan consolidates them into one `RATING_BANDS` table in `ratings.js`. That is what makes the tripwire's mutation test meaningful — without it, "the call site reads the table" is unprovable.
- **Type consistency.** `toDisplayRating` returns a rounded int; `toRawRating` returns an unrounded float, and Task 3 Step 4 depends on that. `player.potential` stays raw everywhere; `player.potentialDisplay` is the only display form.
- **Known ordering risk.** Task 4 Step 4 flags that the superstar gate feeds trait generation, which feeds the sim, so the goldens MAY legitimately move there. The step requires confirming the cause rather than assuming it. This is the one place the central guarantee has a documented exception.
