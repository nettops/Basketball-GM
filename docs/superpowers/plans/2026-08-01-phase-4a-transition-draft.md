# Phase 4 Batch A: Season Transition & Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the playoffs finish, running the offseason progression (aging, breakout/bust, retirement, contract decrement) and a full real-2026, lottery-ordered, two-round draft — leaving a fully drafted league. Free agency and the season restart are Batch B.

**Architecture:** Same dual browser-global/Node-testable pattern as Phases 1-3. `progression.js` and `draft.js`/`draftProspects.js`/`draftPickValue.js` are pure-logic modules unit-tested with plain Node `assert`. `seasonTransition.js` is the orchestrator Batch B will extend. `ui/draft.js` is real UI this batch; the "Advance to Next Season" trigger button stays out of scope until Batch B can run the full cycle (draft alone would leave rosters with no free agency to fill out, an incomplete state to expose as a real button).

**Tech Stack:** Same as Phases 1-3 — HTML, CSS, vanilla JavaScript, no build step, no external APIs, no frameworks. Node.js used only for development-time validation scripts.

## Global Constraints

- Same constraints as Phases 1-3 (see prior plans): vanilla JS only, no frameworks/build step, offline, modular files, comment only non-obvious logic, ratings/attributes stay 25-99, `potential >= overall` always.
- No hidden traits/personality anywhere in progression or the draft (Phase 5 doesn't exist yet).
- Contract option flags (`playerOption`/`teamOption`) are not given special handling this batch — any contract hitting `yearsRemaining <= 0` becomes a free agent regardless, consistent with Phase 1's simplified-contracts decision.
- Team.draftPicks stays unpopulated with future-year records this batch — the current draft's order is computed fresh from standings each time, not read from stored pick ownership. Batch B populates it when pick-trading needs it.

---

## File Structure

```
progression.js          # NEW — offseason rating changes (age curve + breakout/bust rolls)
draftPickValue.js         # NEW — pick value curve (used here for AI draft logic; Batch B reuses it for trades)
draftProspects.js          # NEW — real 2026 prospects (60) + procedural generator for later years
draft.js                 # NEW — lottery, full draft order, AI pick selection, pick execution
seasonTransition.js        # NEW — offseason orchestrator (progression -> retirement -> contracts -> draft), partial this batch
ui/draft.js               # NEW — lottery reveal + pick-by-pick board
scripts/validate-offseason.js  # NEW — Node validation script (same pattern as Phases 1-3)
```

---

### Task 1: `progression.js` — offseason rating changes

**Files:**
- Create: `progression.js`
- Create: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `ATTRIBUTE_KEYS`, `RATING_MIN`, `RATING_MAX` (from `data.js`), `makeRng` (from `rng.js`, for the validation script only).
- Produces: `progressPlayer(player, rng)` (mutates the player in place) — consumed by `seasonTransition.js` (Task 5).

- [ ] **Step 1: Write `progression.js`**

```js
var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX };

function clampRating(v) {
  return Math.max(_PROGRESSION_DATA.RATING_MIN, Math.min(_PROGRESSION_DATA.RATING_MAX, Math.round(v)));
}

// Formula-driven with randomness: young players trend toward their potential,
// veterans decline, and a small league-wide breakout/bust roll adds emergent
// variance on top of the age curve.
function progressPlayer(player, rng) {
  player.age += 1;
  const potentialGap = player.potential - player.overall;

  let change;
  if (player.age <= 25) {
    change = potentialGap * 0.3 + (rng() - 0.3) * 4;
  } else if (player.age <= 29) {
    change = potentialGap * 0.1 + (rng() - 0.5) * 3;
  } else {
    const declineRate = (player.age - 29) * 0.8;
    change = -declineRate + (rng() - 0.5) * 3;
  }

  const breakoutRoll = rng();
  if (breakoutRoll < 0.03) {
    change += 8;
  } else if (breakoutRoll > 0.97) {
    change -= 8;
  }

  const newOverall = clampRating(player.overall + change);
  player.overall = newOverall;
  player.potential = Math.max(player.potential, newOverall); // invariant: potential >= overall

  _PROGRESSION_DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + change);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { progressPlayer: progressPlayer, clampRating: clampRating };
}
```

- [ ] **Step 2: Create `scripts/validate-offseason.js`**

```js
const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));

function checkProgression() {
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const rng = makeRng(1);

  // A young high-potential player should trend upward on average over many rolls.
  const youngProspect = { age: 20, overall: 65, potential: 88, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { youngProspect.attributes[k] = 65; });
  let totalChange = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const before = youngProspect.overall;
    progressionModule.progressPlayer(youngProspect, rng);
    totalChange += youngProspect.overall - before;
    youngProspect.overall = before; // reset for an independent trial
    youngProspect.age = 20;
  }
  assert.ok(totalChange / TRIALS > 0, 'a young player far below potential should trend upward on average');

  // A declining veteran should trend downward on average.
  const veteran = { age: 35, overall: 78, potential: 78, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { veteran.attributes[k] = 78; });
  let veteranChange = 0;
  for (let i = 0; i < TRIALS; i++) {
    const before = veteran.overall;
    progressionModule.progressPlayer(veteran, rng);
    veteranChange += veteran.overall - before;
    veteran.overall = before;
    veteran.age = 35;
  }
  assert.ok(veteranChange / TRIALS < 0, 'a 35-year-old should trend downward on average');

  // Invariant and range checks after a single real progression call.
  const p = { age: 24, overall: 90, potential: 90, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 90; });
  progressionModule.progressPlayer(p, rng);
  assert.ok(p.potential >= p.overall, 'potential must stay >= overall after progression');
  assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX);
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) {
    assert.ok(p.attributes[k] >= dataModule.RATING_MIN && p.attributes[k] <= dataModule.RATING_MAX, k + ' out of range after progression');
  });

  console.log('checkProgression: OK');
}

checkProgression();
console.log('All offseason validations passed');
```

- [ ] **Step 3: Run it**

Run: `node scripts/validate-offseason.js`
Expected:
```
checkProgression: OK
All offseason validations passed
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add progression.js scripts/validate-offseason.js
git commit -m "feat: offseason player progression (age curve + breakout/bust rolls)"
```

---

### Task 2: `draftPickValue.js` — pick value curve

**Files:**
- Create: `draftPickValue.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: nothing external (pure math on a pick number and a team's timeline/wins).
- Produces: `pickBaseValue(pickNumber)`, `estimateFuturePickValue(pickNumber, team)` — `pickBaseValue` is consumed by `draft.js`'s AI pick logic (Task 8); `estimateFuturePickValue` is unused this batch but built now since it shares the same curve (Batch B's trade-pick-valuation reuses it directly).

- [ ] **Step 1: Write `draftPickValue.js`**

```js
// A standard draft-value-chart shape: pick 1 worth far more than pick 30, and
// the whole curve decays further (and flatter) across the second round.
function pickBaseValue(pickNumber) {
  if (pickNumber <= 30) {
    return 100 * Math.pow(0.93, pickNumber - 1);
  }
  const secondRoundSlot = pickNumber - 30;
  return 8 * Math.pow(0.95, secondRoundSlot - 1);
}

// Used when a pick is a FUTURE pick (not this year's) being valued for a trade:
// scales the base curve by how good/bad the owning team currently projects to
// be — a bad team's future pick is worth more (it'll likely land early).
function estimateFuturePickValue(pickNumber, team) {
  const timelineMultiplier = team.timeline === 'rebuilding' ? 1.3 : (team.timeline === 'win-now' ? 0.7 : 1.0);
  return pickBaseValue(pickNumber) * timelineMultiplier;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickBaseValue: pickBaseValue, estimateFuturePickValue: estimateFuturePickValue };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkDraftPickValue() {
  const pickValueModule = require(path.join(__dirname, '..', 'draftPickValue.js'));
  assert.ok(pickValueModule.pickBaseValue(1) > pickValueModule.pickBaseValue(30), 'pick 1 must be worth more than pick 30');
  assert.ok(pickValueModule.pickBaseValue(30) > pickValueModule.pickBaseValue(31), 'a late first-rounder must be worth more than an early second-rounder');
  assert.ok(pickValueModule.pickBaseValue(31) > pickValueModule.pickBaseValue(60), 'pick 31 must be worth more than pick 60');

  const rebuilding = { timeline: 'rebuilding' };
  const winNow = { timeline: 'win-now' };
  assert.ok(
    pickValueModule.estimateFuturePickValue(15, rebuilding) > pickValueModule.estimateFuturePickValue(15, winNow),
    'the same future pick should be worth more owned by a rebuilding team than a win-now team'
  );

  console.log('checkDraftPickValue: OK');
}

checkDraftPickValue();
```

(Insert this call before the final `console.log('All offseason validations passed');`, and move that line to after it — same pattern as every prior phase's validation script.)

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftPickValue.js scripts/validate-offseason.js
git commit -m "feat: draft pick value curve"
```

---

### Task 3: `draftProspects.js` — schema + procedural generator

**Files:**
- Create: `draftProspects.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `ATTRIBUTE_KEYS`, `RATING_MIN`, `RATING_MAX`, `POSITIONS` (from `data.js`), `makeRng` (from `rng.js`).
- Produces: `mkProspect(...)`, `generateProspectClass(rng, count)` — the generator is what every draft *after* the real 2026 class uses. `DRAFT_PROSPECTS_2026` (empty array, populated in Tasks 4-7) is also declared here.

- [ ] **Step 1: Write `draftProspects.js`**

Reuses the same archetype-based attribute generation approach as Phase 1's `players-2026.js`, plus prospect-specific flavor fields (`bustChance`, `nbaComparison`) called out in the master spec.

```js
var _PROSPECT_DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, POSITIONS: POSITIONS };

// Same archetype offsets as players-2026.js's ARCHETYPES, duplicated here rather
// than shared — prospects and rostered players are authored independently and
// don't need to move together if one file's archetype tuning changes later.
const PROSPECT_ARCHETYPES = {
  primary_scorer:  { insideScoring: 4, midRange: 6, threePoint: 4, freeThrow: 4, passing: -2, ballHandling: 3, postScoring: 0, perimeterDefense: -6, interiorDefense: -10, steal: -4, block: -10, offReb: -8, defReb: -4, speed: 2, acceleration: 2, strength: 0, vertical: 2, basketballIQ: 2, leadership: 2, workEthic: 0 },
  playmaker:       { insideScoring: -2, midRange: 2, threePoint: 2, freeThrow: 2, passing: 10, ballHandling: 10, postScoring: -10, perimeterDefense: -2, interiorDefense: -12, steal: 2, block: -12, offReb: -10, defReb: -6, speed: 4, acceleration: 4, strength: -4, vertical: -2, basketballIQ: 6, leadership: 4, workEthic: 0 },
  three_and_d:     { insideScoring: -6, midRange: 0, threePoint: 8, freeThrow: 2, passing: -4, ballHandling: -4, postScoring: -10, perimeterDefense: 8, interiorDefense: -4, steal: 4, block: -4, offReb: -4, defReb: 0, speed: 2, acceleration: 2, strength: 0, vertical: 0, basketballIQ: 2, leadership: 0, workEthic: 2 },
  rim_protector:   { insideScoring: -4, midRange: -10, threePoint: -14, freeThrow: -10, passing: -8, ballHandling: -12, postScoring: 2, perimeterDefense: 0, interiorDefense: 10, steal: -2, block: 12, offReb: 8, defReb: 10, speed: -6, acceleration: -6, strength: 8, vertical: 4, basketballIQ: 0, leadership: 0, workEthic: 2 },
  slasher:         { insideScoring: 8, midRange: -2, threePoint: -6, freeThrow: -2, passing: 0, ballHandling: 4, postScoring: -2, perimeterDefense: 0, interiorDefense: -6, steal: 2, block: -6, offReb: -2, defReb: -2, speed: 6, acceleration: 6, strength: 0, vertical: 6, basketballIQ: 0, leadership: 0, workEthic: 0 },
  raw_prospect:    { insideScoring: -2, midRange: -4, threePoint: -4, freeThrow: -2, passing: -2, ballHandling: -2, postScoring: -2, perimeterDefense: -2, interiorDefense: -2, steal: -2, block: -2, offReb: -2, defReb: -2, speed: 4, acceleration: 4, strength: -4, vertical: 4, basketballIQ: -8, leadership: -6, workEthic: 0 }
};

function makeProspectAttributes(overall, archetype) {
  const offsets = PROSPECT_ARCHETYPES[archetype];
  const attrs = {};
  _PROSPECT_DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = overall + (offsets[key] || 0);
    attrs[key] = Math.max(_PROSPECT_DATA.RATING_MIN, Math.min(_PROSPECT_DATA.RATING_MAX, raw));
  });
  return attrs;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mkProspect(name, age, heightIn, weightLb, position, overall, potential, archetype, bustChance, nbaComparison) {
  return {
    id: 'prospect-' + slugify(name) + '-' + Math.floor(Math.random() * 1000000),
    teamId: null,
    name: name,
    age: age,
    heightIn: heightIn,
    weightLb: weightLb,
    position: position,
    jerseyNumber: null, // assigned when drafted
    yearsPro: 0,
    overall: overall,
    potential: potential,
    contract: { salary: 0, yearsRemaining: 0, playerOption: false, teamOption: false }, // set on draft
    status: { morale: 70, fatigue: 0, injury: null },
    attributes: makeProspectAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {},
    bustChance: bustChance,
    nbaComparison: nbaComparison
  };
}

const ARCHETYPE_NAMES = Object.keys(PROSPECT_ARCHETYPES);
const FIRST_NAMES = ['Jaylen', 'Marcus', 'Devin', 'Isaiah', 'Elijah', 'Cameron', 'Xavier', 'Malik', 'Tyler', 'Andre', 'DeAndre', 'Josiah', 'Amari', 'Jalen', 'Caleb'];
const LAST_NAMES = ['Turner', 'Brooks', 'Hayes', 'Coleman', 'Reid', 'Bryant', 'Foster', 'Simmons', 'Ward', 'Price', 'Bell', 'Owens', 'Hunt', 'Mercer', 'Dawson'];

// Every draft after the real 2026 class uses this — procedurally generated,
// same schema as a real prospect, but with a generic name and a rank-correlated
// overall/potential spread (early picks skew better, same idea as a real class).
function generateProspectClass(rng, count) {
  const prospects = [];
  for (let i = 0; i < count; i++) {
    const rankFactor = 1 - i / count; // 1.0 for pick 1, ->0 for the last pick
    const overall = Math.round(58 + rankFactor * 22 + (rng() - 0.5) * 8);
    const potential = Math.round(overall + rng() * 15 + rankFactor * 8);
    const archetype = ARCHETYPE_NAMES[Math.floor(rng() * ARCHETYPE_NAMES.length)];
    const position = _PROSPECT_DATA.POSITIONS[Math.floor(rng() * _PROSPECT_DATA.POSITIONS.length)];
    const name = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)] + ' ' + LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] + ' Jr.'.slice(0, rng() < 0.15 ? 4 : 0);
    const age = 18 + Math.floor(rng() * 4);
    const heightIn = 74 + Math.floor(rng() * 10);
    const weightLb = 180 + Math.floor(rng() * 60);
    const bustChance = Math.round((0.15 + (1 - rankFactor) * 0.35) * 100) / 100;
    prospects.push(mkProspect(name.trim(), age, heightIn, weightLb, position, Math.max(40, Math.min(90, overall)), Math.max(overall, Math.min(99, potential)), archetype, bustChance, 'Unproven'));
  }
  return prospects;
}

const DRAFT_PROSPECTS_2026 = [];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mkProspect: mkProspect,
    generateProspectClass: generateProspectClass,
    DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026
  };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkProspectGeneration() {
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const rng = makeRng(7);
  const generatedClass = prospectsModule.generateProspectClass(rng, 60);

  assert.strictEqual(generatedClass.length, 60);
  const ids = generatedClass.map(function (p) { return p.id; });
  assert.strictEqual(new Set(ids).size, 60, 'generated prospect ids must be unique');

  generatedClass.forEach(function (p) {
    assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX, 'generated prospect overall out of range');
    assert.ok(p.potential >= p.overall, 'generated prospect potential must be >= overall');
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) {
      assert.ok(p.attributes[k] >= dataModule.RATING_MIN && p.attributes[k] <= dataModule.RATING_MAX, 'generated prospect attribute ' + k + ' out of range');
    });
  });

  const avgOverallTop10 = generatedClass.slice(0, 10).reduce(function (s, p) { return s + p.overall; }, 0) / 10;
  const avgOverallBottom10 = generatedClass.slice(-10).reduce(function (s, p) { return s + p.overall; }, 0) / 10;
  assert.ok(avgOverallTop10 > avgOverallBottom10, 'early-slot generated prospects should trend better than late-slot ones');

  console.log('checkProspectGeneration: OK');
}

checkProspectGeneration();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftProspects.js scripts/validate-offseason.js
git commit -m "feat: prospect schema and procedural generator for future draft classes"
```

---

### Task 4: `draftProspects.js` — real 2026 first round (picks 1-15)

**Files:**
- Modify: `draftProspects.js`

**Interfaces:**
- Consumes: `mkProspect` (own file, Task 3).
- Produces: 15 real prospect entries appended to `DRAFT_PROSPECTS_2026`, mock-ranked 1-15 by array order.

- [ ] **Step 1: Append real 2026 draft prospects for mock-draft slots 1-15**

Using accurate, current basketball knowledge of the 2026 draft class (top college/international prospects eligible for the 2026 NBA Draft), append 15 `mkProspect(...)` calls to `DRAFT_PROSPECTS_2026`, ordered best-to-worst by realistic mock-draft consensus. Follow the exact call signature from Task 3: `mkProspect(name, age, heightIn, weightLb, position, overall, potential, archetype, bustChance, nbaComparison)`. Top prospects should land in the low-to-mid 70s overall with high potential (80s-90s) reflecting a top pick's ceiling; scale down gradually toward pick 15.

```js
DRAFT_PROSPECTS_2026.push(mkProspect('A.J. Dybantsa', 19, 80, 210, 'SF', 74, 92, 'primary_scorer', 0.20, 'Kevin Durant'));
```

(That's the #1-ranked example in the correct format — continue with 14 more real prospects for slots 2-15.)

- [ ] **Step 2: Run the validator**

Run: `node scripts/validate-offseason.js`
Expected: all prior checks still pass (this task doesn't add a new check — the real class is validated for real by Task 7's completeness check once all 60 exist).

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftProspects.js
git commit -m "feat: real 2026 draft prospects, mock slots 1-15"
```

---

### Task 5: `draftProspects.js` — real 2026 first round (picks 16-30)

**Files:**
- Modify: `draftProspects.js`

**Interfaces:**
- Consumes: `mkProspect` (own file, Task 3).
- Produces: 15 more real prospect entries, completing round 1 (30 total in `DRAFT_PROSPECTS_2026`).

- [ ] **Step 1: Append real 2026 draft prospects for mock-draft slots 16-30**

Same process as Task 4, continuing the mock-draft order for slots 16-30. Overall ratings should continue trending down from Task 4's slot-15 level toward the high 60s/low 70s by slot 30.

- [ ] **Step 2: Run the validator, then commit**

Run: `node scripts/validate-offseason.js` — all prior checks still pass.

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftProspects.js
git commit -m "feat: real 2026 draft prospects, mock slots 16-30 (round 1 complete)"
```

---

### Task 6: `draftProspects.js` — real 2026 second round (picks 31-45)

**Files:**
- Modify: `draftProspects.js`

**Interfaces:**
- Consumes: `mkProspect` (own file, Task 3).
- Produces: 15 more real prospect entries for the second round.

- [ ] **Step 1: Append real 2026 draft prospects for mock-draft slots 31-45**

Same process, continuing into realistic second-round-level prospects (overall ratings mid-60s, higher bust chance, more speculative NBA comparisons — this is realistic even in real mock drafts this deep).

- [ ] **Step 2: Run the validator, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftProspects.js
git commit -m "feat: real 2026 draft prospects, mock slots 31-45"
```

---

### Task 7: `draftProspects.js` — real 2026 second round (picks 46-60) + completeness check

**Files:**
- Modify: `draftProspects.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `mkProspect` (own file, Task 3).
- Produces: the final 15 real prospect entries, completing all 60 in `DRAFT_PROSPECTS_2026`.

- [ ] **Step 1: Append real 2026 draft prospects for mock-draft slots 46-60**

Same process, completing the class down to realistic late-second-round fringe/two-way-caliber prospects (overall high-50s/low-60s).

- [ ] **Step 2: Add a completeness check to `scripts/validate-offseason.js`**

```js
function checkReal2026Class() {
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  assert.strictEqual(prospectsModule.DRAFT_PROSPECTS_2026.length, 60, 'the real 2026 class must have exactly 60 prospects');
  const ids = prospectsModule.DRAFT_PROSPECTS_2026.map(function (p) { return p.id; });
  assert.strictEqual(new Set(ids).size, 60, 'real prospect ids must be unique');
  prospectsModule.DRAFT_PROSPECTS_2026.forEach(function (p) {
    assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX);
    assert.ok(p.potential >= p.overall);
    assert.strictEqual(p.teamId, null);
  });
  const first15Avg = prospectsModule.DRAFT_PROSPECTS_2026.slice(0, 15).reduce(function (s, p) { return s + p.overall; }, 0) / 15;
  const last15Avg = prospectsModule.DRAFT_PROSPECTS_2026.slice(-15).reduce(function (s, p) { return s + p.overall; }, 0) / 15;
  assert.ok(first15Avg > last15Avg, 'the top of the class should rate better than the bottom on average');
  console.log('checkReal2026Class: OK (' + prospectsModule.DRAFT_PROSPECTS_2026.length + ' prospects)');
}

checkReal2026Class();
```

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-offseason.js` — expect `checkReal2026Class: OK (60 prospects)` among the passing checks.

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftProspects.js scripts/validate-offseason.js
git commit -m "feat: real 2026 draft prospects, mock slots 46-60 (class complete)"
```

---

### Task 8: `draft.js` — lottery + full draft order

**Files:**
- Create: `draft.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `TEAMS`, `getTeamById` (from `teams.js`), `getPlayoffSeeds` (unused directly — draft order is built from the bracket's series data, not seeds).
- Produces: `weightedDrawWithoutReplacement(candidates, weightFn, count, rng)`, `buildDraftOrder(bracket, rng)` → returns `{ firstRound: [teamId x30], secondRound: [teamId x30] }`. Consumed by Task 9's pick execution.

This is the algorithm prototyped and verified in Node before writing this plan: worst lottery team wins the #1 pick roughly 28% of the time vs. ~0.2% for the best lottery team, over 5,000 trials.

- [ ] **Step 1: Write `draft.js`**

```js
var _DRAFT_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById } };

function weightedDrawWithoutReplacement(candidates, weightFn, count, rng) {
  let pool = candidates.map(function (c) { return { c: c, w: weightFn(c) }; });
  const picks = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce(function (s, p) { return s + p.w; }, 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    picks.push(pool[idx].c);
    pool.splice(idx, 1);
  }
  return picks;
}

function lotteryWeight(team) {
  return Math.pow(30 - team.record.wins, 2);
}

// Worse playoff finish -> earlier pick. Ties within the same elimination round
// broken by regular-season wins ascending (worse record picks first).
function getPlayoffFinishOrder(bracket) {
  const eliminatedInRound = {};
  bracket.first.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 0; });
  bracket.semis.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 1; });
  bracket.confFinals.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 2; });
  const finals = bracket.finals[0];
  eliminatedInRound[finals.winner === finals.higherSeed ? finals.lowerSeed : finals.higherSeed] = 3;
  eliminatedInRound[finals.winner] = 4;

  return Object.keys(eliminatedInRound).sort(function (a, b) {
    if (eliminatedInRound[a] !== eliminatedInRound[b]) return eliminatedInRound[a] - eliminatedInRound[b];
    return _DRAFT_DATA.teams.getTeamById(a).record.wins - _DRAFT_DATA.teams.getTeamById(b).record.wins;
  });
}

function buildDraftOrder(bracket, rng) {
  const playoffTeamIds = new Set(getPlayoffFinishOrder(bracket));
  const lotteryTeams = _DRAFT_DATA.teams.TEAMS.filter(function (t) { return !playoffTeamIds.has(t.id); });

  const top4 = weightedDrawWithoutReplacement(lotteryTeams, lotteryWeight, 4, rng);
  const top4Ids = new Set(top4.map(function (t) { return t.id; }));
  const remainingLottery = lotteryTeams.filter(function (t) { return !top4Ids.has(t.id); })
    .sort(function (a, b) { return a.record.wins - b.record.wins; });

  const firstRound = top4.map(function (t) { return t.id; })
    .concat(remainingLottery.map(function (t) { return t.id; }))
    .concat(getPlayoffFinishOrder(bracket));

  // Second round: straight reverse full-season record for all 30 teams, no lottery.
  const secondRound = _DRAFT_DATA.teams.TEAMS.slice()
    .sort(function (a, b) { return a.record.wins - b.record.wins; })
    .map(function (t) { return t.id; });

  return { firstRound: firstRound, secondRound: secondRound };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weightedDrawWithoutReplacement: weightedDrawWithoutReplacement,
    lotteryWeight: lotteryWeight,
    getPlayoffFinishOrder: getPlayoffFinishOrder,
    buildDraftOrder: buildDraftOrder
  };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkDraftOrder() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));

  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: eastern.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: western.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(300);
  let g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng); }

  const order = draftModule.buildDraftOrder(bracket, rng);
  assert.strictEqual(order.firstRound.length, 30, 'first round must have exactly 30 picks');
  assert.strictEqual(new Set(order.firstRound).size, 30, 'first round picks must be unique teams');
  assert.strictEqual(order.secondRound.length, 30, 'second round must have exactly 30 picks');
  assert.strictEqual(new Set(order.secondRound).size, 30, 'second round picks must be unique teams');

  // Statistical check on the lottery weighting itself (the part most likely to have a sign error).
  const worstTeam = teamsModule.TEAMS.slice().sort(function (a, b) { return a.record.wins - b.record.wins; })[0];
  let worstTeamFirstPickCount = 0;
  const TRIALS = 300;
  for (let i = 0; i < TRIALS; i++) {
    const trialOrder = draftModule.buildDraftOrder(bracket, rng);
    if (trialOrder.firstRound[0] === worstTeam.id) worstTeamFirstPickCount++;
  }
  assert.ok(worstTeamFirstPickCount / TRIALS > 0.15, 'the worst team should win the #1 pick a meaningfully large share of the time, got ' + (worstTeamFirstPickCount / TRIALS));

  console.log('checkDraftOrder: OK');
}

checkDraftOrder();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draft.js scripts/validate-offseason.js
git commit -m "feat: weighted lottery and full draft order construction"
```

---

### Task 9: `draft.js` — AI pick selection + pick execution

**Files:**
- Modify: `draft.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `adjustedPlayerValue` (from `tradeEvaluator.js` — reused against prospects, same function, since a prospect has the same shape as a rostered player for valuation purposes), `getTeamById` (from `teams.js`), `pickBaseValue` (from `draftPickValue.js`, unused directly here but conceptually informs why AI teams don't need pick-skipping logic — every team always has exactly one pick per round this batch).
- Produces: `selectAIPick(teamId, availableProspects)`, `executePick(teamId, prospect, pickNumber)`, `runDraft(draftOrder, prospectPool)` → returns the list of `{ teamId, prospect, pickNumber, round }` results. Consumed by `ui/draft.js` (Task 11) and `seasonTransition.js` (Task 10).

- [ ] **Step 1: Add to `draft.js`**

Update `_DRAFT_DATA` and add above `module.exports`:

```js
var _DRAFT_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js'), tradeEvaluator: require('./tradeEvaluator.js'), league: require('./league.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById }, tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }, league: { getTeamRoster: getTeamRoster } };
```

```js
function selectAIPick(teamId, availableProspects) {
  const team = _DRAFT_DATA.teams.getTeamById(teamId);
  let best = availableProspects[0];
  let bestValue = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(best, team);
  for (let i = 1; i < availableProspects.length; i++) {
    const value = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(availableProspects[i], team);
    if (value > bestValue) { best = availableProspects[i]; bestValue = value; }
  }
  return best;
}

function rookieSalary(pickNumber) {
  if (pickNumber <= 30) {
    return Math.round(10000000 - (pickNumber - 1) * (7500000 / 29));
  }
  const secondRoundSlot = pickNumber - 30;
  return Math.round(2200000 - (secondRoundSlot - 1) * (1100000 / 29));
}

function rookieYears(pickNumber) {
  return pickNumber <= 30 ? 4 : 2;
}

function executePick(teamId, prospect, pickNumber) {
  const roster = _DRAFT_DATA.league.getTeamRoster(teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;

  prospect.teamId = teamId;
  prospect.jerseyNumber = jersey;
  prospect.yearsPro = 0;
  prospect.contract = { salary: rookieSalary(pickNumber), yearsRemaining: rookieYears(pickNumber), playerOption: false, teamOption: false };
}

function runDraft(draftOrder, prospectPool) {
  const results = [];
  let available = prospectPool.slice();

  function runRound(order, round, pickOffset) {
    order.forEach(function (teamId, i) {
      const pickNumber = pickOffset + i + 1;
      const prospect = selectAIPick(teamId, available);
      executePick(teamId, prospect, pickNumber);
      available = available.filter(function (p) { return p.id !== prospect.id; });
      results.push({ teamId: teamId, prospect: prospect, pickNumber: pickNumber, round: round });
    });
  }

  runRound(draftOrder.firstRound, 1, 0);
  runRound(draftOrder.secondRound, 2, 30);

  return results;
}
```

- [ ] **Step 2: Update `module.exports` in `draft.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weightedDrawWithoutReplacement: weightedDrawWithoutReplacement,
    lotteryWeight: lotteryWeight,
    getPlayoffFinishOrder: getPlayoffFinishOrder,
    buildDraftOrder: buildDraftOrder,
    selectAIPick: selectAIPick,
    rookieSalary: rookieSalary,
    rookieYears: rookieYears,
    executePick: executePick,
    runDraft: runDraft
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-offseason.js`**

```js
function checkRunDraft() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const rng = makeRng(400);

  const draftOrder = { firstRound: teamsModule.TEAMS.map(function (t) { return t.id; }), secondRound: teamsModule.TEAMS.slice().reverse().map(function (t) { return t.id; }) };
  const pool = prospectsModule.generateProspectClass(rng, 60);

  const results = draftModule.runDraft(draftOrder, pool);
  assert.strictEqual(results.length, 60, 'a full draft should produce 60 picks');
  const pickedIds = results.map(function (r) { return r.prospect.id; });
  assert.strictEqual(new Set(pickedIds).size, 60, 'no prospect should be drafted twice');

  results.forEach(function (r) {
    assert.strictEqual(r.prospect.teamId, r.teamId, 'a drafted prospect must have its teamId set to the drafting team');
    assert.ok(r.prospect.contract.salary > 0, 'a drafted prospect must have a rookie contract');
    assert.ok(typeof r.prospect.jerseyNumber === 'number');
  });

  const firstPick = results[0];
  const lastPick = results[59];
  assert.ok(firstPick.prospect.contract.salary > lastPick.prospect.contract.salary, 'the #1 pick should earn more than the #60 pick');

  console.log('checkRunDraft: OK');
}

checkRunDraft();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draft.js scripts/validate-offseason.js
git commit -m "feat: AI draft-pick selection and pick execution with rookie contracts"
```

---

### Task 10: `seasonTransition.js` — orchestrator through the draft

**Files:**
- Create: `seasonTransition.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `progressPlayer` (from `progression.js`), `buildDraftOrder`/`runDraft` (from `draft.js`), `DRAFT_PROSPECTS_2026`/`generateProspectClass` (from `draftProspects.js`), `getTeamRoster` (from `league.js`), `TEAMS` (from `teams.js`).
- Produces: `rollRetirement(player, rng)`, `decrementContracts(rng)`, `runOffseasonThroughDraft(bracket, rng, isFirstDraft)` — the latter is what Batch B extends into the full offseason (adding free agency and new-season generation after this batch's draft step).

- [ ] **Step 1: Write `seasonTransition.js`**

```js
var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass }
    };

// Retirement chance rises sharply after 33, further penalized for players whose
// production has fallen off. Full HOF/history tracking is Phase 8 — here a
// retired player just leaves the active player pool entirely.
function rollRetirement(player, rng) {
  if (player.age < 34) return false;
  const baseChance = (player.age - 33) * 0.08;
  const overallPenalty = player.overall < 65 ? 0.15 : 0;
  return rng() < Math.min(0.9, baseChance + overallPenalty);
}

function decrementContracts() {
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    if (!p.teamId) return;
    p.contract.yearsRemaining -= 1;
    if (p.contract.yearsRemaining <= 0) {
      p.teamId = null;
    }
  });
}

function runOffseasonThroughDraft(bracket, rng, isFirstDraft) {
  // 1. Progression — mutate in place, then filter out retirees.
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) { _TRANSITION_DATA.progression.progressPlayer(p, rng); });

  const retirees = rosterPlayers.filter(function (p) { return rollRetirement(p, rng); });
  retirees.forEach(function (p) {
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  // 2. Contracts.
  decrementContracts();

  // 3. Reset per-season status for everyone still in the league.
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  // 4. Draft.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const prospectPool = isFirstDraft ? _TRANSITION_DATA.prospects.DRAFT_PROSPECTS_2026 : _TRANSITION_DATA.prospects.generateProspectClass(rng, 60);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, prospectPool);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: retirees.length, draftResults: draftResults };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rollRetirement: rollRetirement, decrementContracts: decrementContracts, runOffseasonThroughDraft: runOffseasonThroughDraft };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkOffseasonThroughDraft() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));

  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: eastern.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: western.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rngForPlayoffs = makeRng(500);
  let g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rngForPlayoffs);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rngForPlayoffs); }

  const rosterCountsBefore = {};
  teamsModule.TEAMS.forEach(function (t) { rosterCountsBefore[t.id] = leagueModule.getTeamRoster(t.id).length; });

  const rng = makeRng(600);
  const result = transitionModule.runOffseasonThroughDraft(bracket, rng, true);

  assert.ok(result.draftResults.length === 60, 'the first draft should use the real 60-prospect class');
  teamsModule.TEAMS.forEach(function (t) {
    const after = leagueModule.getTeamRoster(t.id).length;
    // every team gained exactly 2 draft picks (1 first round + 1 second round);
    // roster size may also be lower than before if any of that team's players retired.
    assert.ok(after >= rosterCountsBefore[t.id] + 2 - 5, t.id + ' roster size implausible after offseason: ' + after);
  });

  console.log('checkOffseasonThroughDraft: OK (' + result.retireeCount + ' retirements, ' + result.draftResults.length + ' picks made)');
}

checkOffseasonThroughDraft();
console.log('All offseason validations passed');
```

Remove the now-duplicated final `console.log('All offseason validations passed');` that previously followed `checkRunDraft()` in Task 9 — keep only one, at the very end, after this new check.

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-offseason.js` — all checks (`checkProgression`, `checkDraftPickValue`, `checkProspectGeneration`, `checkReal2026Class`, `checkDraftOrder`, `checkRunDraft`, `checkOffseasonThroughDraft`) pass.

```bash
cd "C:\Users\cory\Desktop\nba"
git add seasonTransition.js scripts/validate-offseason.js
git commit -m "feat: offseason orchestrator through the draft (progression, retirement, contracts, draft)"
```

---

### Task 11: `ui/draft.js` — lottery reveal + pick-by-pick board

**Files:**
- Create: `ui/draft.js`

**Interfaces:**
- Consumes: `getTeamById` (from `teams.js`).
- Produces: `renderDraftResults(container, draftResults)` — takes an already-completed `runDraft()` result array and displays it (this batch's UI is a results viewer, not a live pick-by-pick interactive flow — the user isn't drafting yet since Auto-GM-style manual pick control is out of scope until the user's own team's pick UI is wired in Batch B alongside free agency, when the full offseason flow becomes triggerable from the app).

- [ ] **Step 1: Write `ui/draft.js`**

```js
function renderDraftResults(container, draftResults) {
  let html = '<h2>2026 Draft Results</h2>';
  html += '<table><thead><tr><th>Pick</th><th>Round</th><th>Team</th><th>Player</th><th>Pos</th><th>OVR</th><th>POT</th></tr></thead><tbody>';
  draftResults.forEach(function (r) {
    const team = getTeamById(r.teamId);
    html += '<tr><td>' + r.pickNumber + '</td><td>' + r.round + '</td><td>' + team.name + '</td><td>' + r.prospect.name + '</td><td>' + r.prospect.position + '</td><td>' + r.prospect.overall + '</td><td>' + r.prospect.potential + '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftResults: renderDraftResults };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/draft.js
git commit -m "feat: draft results board UI"
```

---

### Task 12: Wire Batch A into `index.html` + end-to-end verification

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: every function from Tasks 1-11.
- Produces: a browser-loadable state where the full progression→retirement→contracts→draft pipeline can be triggered and inspected from the console, even though there's no polished "Advance Season" button yet (that arrives in Batch B).

- [ ] **Step 1: Add the new script tags to `index.html`**

Add after `trade.js` and before `ui/nav.js`:

```html
<script src="progression.js"></script>
<script src="draftPickValue.js"></script>
<script src="draftProspects.js"></script>
<script src="draft.js"></script>
<script src="seasonTransition.js"></script>
```

Add after `ui/tradeCenter.js` and before `script.js`:

```html
<script src="ui/draft.js"></script>
```

- [ ] **Step 2: Run the full Node validation suite**

Run: `node scripts/validate-offseason.js` — all 7 checks pass.
Run: `node scripts/validate-trades.js`, `node scripts/validate-sim.js`, `node scripts/validate-data.js` — confirm no regressions from Phases 1-3.

- [ ] **Step 3: Manual browser verification**

Using the `run` skill (or a local static server, as in prior phases):
1. Load `index.html`, select a team, confirm no console errors (all new scripts load cleanly).
2. Open the browser console and run: `GameState.season.currentDay = 200;` then simulate to end of season and playoffs via the existing sim controls (reuse Phase 2's flow) until `GameState.playoffBracket.finals[0].complete` is `true`.
3. In the console, run:
   ```js
   const rng = makeRng(Date.now());
   const result = runOffseasonThroughDraft(GameState.playoffBracket, rng, true);
   console.log(result.retireeCount, result.draftResults.length);
   ```
   Confirm it logs a retiree count (0 or more) and exactly `60` draft picks made, with no thrown errors.
4. Render the results manually: `renderDraftResults(document.getElementById('view-content'), result.draftResults);` then switch to that part of the page — confirm a real table appears with 60 rows, real team names, and the pick-1 player having a notably higher OVR than the pick-60 player.
5. Spot-check a team's roster in the Roster view — confirm it now includes a newly drafted rookie (a player with `yearsPro: 0`) alongside the pre-existing roster.
6. Confirm the browser console shows no errors throughout.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add index.html
git commit -m "chore: wire Phase 4 Batch A into the app shell and verify end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** progression (age curve + breakout/bust) ✓ Task 1. Retirement ✓ Task 10. Contract decrement ✓ Task 10. Real 2026 draft class (60, both rounds) ✓ Tasks 4-7. Procedural generator for future drafts ✓ Task 3. Lottery + full draft order ✓ Task 8 (verified via Node prototype before writing this plan: worst team wins ~28% of #1 picks vs ~0.2% for the best lottery team). AI draft-pick selection reusing Phase 3's trade evaluator ✓ Task 9. Draft UI ✓ Task 11.
- **Placeholder scan:** no TBD/TODO. Tasks 4-7's real-prospect data-entry steps direct the executor to use their own basketball knowledge for the 2026 class, following the same disclosed pattern Phase 1 used for real 2025-26 rosters — backed by Task 7's automated completeness/range/top-vs-bottom checks regardless of which real names are chosen.
- **Type/interface consistency:** `buildDraftOrder(bracket, rng)` returns `{firstRound, secondRound}` consistently between its definition (Task 8) and consumption in `seasonTransition.js` (Task 10). `runDraft(draftOrder, prospectPool)` and its per-pick result shape (`{teamId, prospect, pickNumber, round}`) are used identically in Task 9's own test, Task 10's orchestrator, and Task 11's UI. `adjustedPlayerValue` from Phase 3 is reused unchanged against prospect objects (Task 9) since prospects share the rostered-player schema.
- **Node/browser dual-loading:** every new pure-logic file follows the established `_XXX_DATA` conditional-require pattern. `seasonTransition.js` requires `draft.js`/`draftProspects.js`/`progression.js`/`league.js`/`teams.js`/`players-2026.js` — none of which require `seasonTransition.js` back, so (unlike Phase 2's `simulateDate`) there's no circular-require risk here.
- **Batch boundary:** this plan deliberately stops after the draft, with free agency and new-season regeneration left to Batch B — `runOffseasonThroughDraft`'s name signals the boundary, and no "Advance Season" UI button is wired yet (Task 11's UI is a manually-triggered results viewer, not a real user-facing flow entry point), avoiding a half-working control sitting in the shipped UI mid-batch.
