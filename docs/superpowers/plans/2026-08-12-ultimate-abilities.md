# Ultimate Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the league's ~40 stars a charged takeover — a per-game meter that fills on their own good plays, and a quarter-long stretch of dominance when it fills — in every game the league simulates, not just watched ones.

**Architecture:** One new leaf module, `ultimates.js`, answers three questions with no knowledge of the rest of the game: which ultimate a player has, what a play earns, and what a takeover changes. `gameSim.js` owns all state transitions (it holds score, period and clock) and hands the possession engine a plain `takeovers` object on the already-existing `gameCtx`. `simEnginePossession.js` reads dials off that object and reports charge-relevant plays back on the already-existing `outcome` object. The possession engine therefore gains **no new require**, and the ultimate module is testable without booting a league.

**Tech Stack:** Vanilla ES5-style JS, zero dependencies, no build step. Root modules load as `<script>` globals from `index.html` and as `importScripts` in `simWorker.js`, and carry a dual `require`/browser-global bridge. Node is used only for `scripts/validate-*.js` and `scripts/probe-*.js`.

## Global Constraints

- **Zero third-party dependencies.** No npm, no build step. Node only runs the validators and probes.
- **Every root module carries the dual bridge:** `var _X_DATA = (typeof require !== 'undefined') ? { ns: require('./ns.js') } : { ns: { fn: fn } };`. `scripts/validate-browserBridges.js` asserts every `_X_DATA.ns.member` referenced in source is present in the browser branch. A top-level `const` is NOT a window property; a `function` declaration is.
- **New root modules must be added in three places:** `index.html` (in dependency order), `simWorker.js`'s `importScripts` list, and their own bridge.
- **`ultimates.js` draws no rng.** The meter is bookkeeping over events that already happened. A takeover changes probabilities and weights, never the number of rolls.
- **Ratings scale trap:** `RATING_BANDS` are on the **display** scale, so gate on `player.overall`, never `player.rawOverall`.
- **Thresholds are measured bands, never picked numbers.** Every tuning constant carries the sweep that produced it in a comment above it.
- **Tests assert against the tuning table, never against literals.** A test that hard-codes `20` starts asserting a rule the game no longer has.
- **Calibration is measured through `league.simulateDate` over full seasons.** `gameSim.simulateGame` in a loop reads ~35% low — it skips fatigue, injuries, morale and rotations.
- **The governing target: league points per team per game must not move.** Takeovers redistribute scoring toward stars; they do not add scoring to the league.
- **Ultimates exist only in the possession engine.** The box-score engine (selectable at `ui/settings.js:116`) has none, the same way it has no play-by-play. Stated limitation, not a bug.

**Run one validator:**
```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```

**Run the whole suite:**
```bash
cd "C:/Users/cory/Desktop/nba" && for f in scripts/validate-*.js; do echo "== $f"; node "$f" 2>&1 | tail -3; done
```

---

## File Structure

| File | Responsibility |
|---|---|
| `ultimates.js` *(create)* | The whole brain. Taxonomy of 12, derivation, charge model, situation multiplier, dial table. Pure — takes plain values, returns plain values, draws no rng. |
| `scripts/validate-ultimates.js` *(create)* | Unit tests for the module + static call-site guards that every dial is actually read by the engine. |
| `scripts/probe-ultimates.js` *(create)* | Full-season measurement through `league.simulateDate`: takeover rate, points added, league scoring. |
| `simEnginePossession.js` *(modify)* | Reads dials off `gameCtx.takeovers`; reports charge-relevant plays on `outcome.plays`. New box-line fields. No new require. |
| `gameSim.js` *(modify)* | Owns the meter: applies charge, fires and expires takeovers, builds `gameCtx.takeovers`, pushes `takeover-start`/`takeover-end` events. |
| `gameCoach.js` *(modify)* | One rule: never bench a player mid-takeover. |
| `history.js` *(modify)* | `LEAGUE_HISTORY.takeovers` + `recordTakeovers`. |
| `league.js` *(modify)* | Files takeover records from every finished game, alongside feats. |
| `ui/pixelHud.js` *(modify)* | The meter bar under each on-floor star. |
| `ui/pixelGameView.js` *(modify)* | Fires the impact treatment on takeover-start; keeps the marker on the holder. |
| `ui/roster.js` / box score *(modify)* | The takeover line under the player, and the marked play-by-play section. |
| `ui/playerProfile.js` *(modify)* | The player's ultimate, triggers this season, best one. |
| `ui/ultimates.js` *(create)* | Reference page, reading everything from `ULTIMATE_TAXONOMY`. |
| `ui/leagueNews.js` *(modify)* | Filtered feed lines. |
| `index.html`, `simWorker.js` *(modify)* | Load order for the two new files. |

---

## Task 1: The taxonomy and the derivation

**Files:**
- Create: `ultimates.js`
- Create: `scripts/validate-ultimates.js`
- Modify: `index.html:57-59` (after `compositeRatings.js`, before `simEnginePossession.js`)
- Modify: `simWorker.js:16`

**Interfaces:**
- Consumes: `compositeRatings.computeComposite(player, key)`, `ratings.RATING_BANDS`, `traits.TRAIT_TIERS`, `player.hiddenTraits` (array of `{ key, tier }`), `player.attributes`, `player.overall`.
- Produces:
  - `ULTIMATE_TAXONOMY` — array of 12 `{ key, name, kind: 'solo'|'team', side: 'offense'|'defense', derive, chargeAffinity, badges }`
  - `ULTIMATE_BY_KEY` — object keyed by `key`
  - `ULTIMATE_TUNING` — `{ gateOverall, badgeTieBreak, badgeBoost }`
  - `hasUltimate(player)` → boolean
  - `ultimateFor(player)` → taxonomy entry or `null`
  - `badgeBoostFor(player, ultimate)` → number ≥ 1

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-ultimates.js`:

```js
// Every ultimate is DERIVED, never authored and never rolled. These tests build
// synthetic players with a deliberately lopsided profile and assert the
// derivation picks the matching ultimate — which is also the only way to prove
// all twelve are reachable rather than four of them soaking up every player.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'data.js'));
require(path.join(ROOT, 'rng.js'));
const ratings = require(path.join(ROOT, 'ratings.js'));
const ult = require(path.join(ROOT, 'ultimates.js'));

const ATTRS = require(path.join(ROOT, 'data.js')).ATTRIBUTE_KEYS;

// A player who is exactly average everywhere, so a test can raise ONE thing and
// know the derivation responded to that and nothing else.
function flatPlayer(over) {
  const attributes = {};
  ATTRS.forEach(function (k) { attributes[k] = 50; });
  return Object.assign({
    id: 'test1', name: 'Test Player', overall: 95,
    attributes: attributes, hiddenTraits: []
  }, over || {});
}

function withAttrs(raised, over) {
  const p = flatPlayer(over);
  Object.keys(raised).forEach(function (k) { p.attributes[k] = raised[k]; });
  return p;
}

function checkGate() {
  const gate = ult.ULTIMATE_TUNING.gateOverall;
  assert.ok(ult.hasUltimate(flatPlayer({ overall: gate })), 'exactly at the gate qualifies');
  assert.ok(!ult.hasUltimate(flatPlayer({ overall: gate - 1 })), 'one under does not');
  assert.strictEqual(ult.ultimateFor(flatPlayer({ overall: gate - 1 })), null,
    'a non-star has no ultimate at all, not a default one');
  console.log('checkGate: OK (gate ' + gate + ')');
}

// The trap this guards: RATING_BANDS live on the DISPLAY scale. Gating on
// rawOverall would admit a wildly different set of players and the bug would be
// invisible — everything would still "work", just for the wrong 200 people.
function checkGateUsesDisplayOverall() {
  const p = flatPlayer({ overall: ult.ULTIMATE_TUNING.gateOverall, rawOverall: 1 });
  assert.ok(ult.hasUltimate(p), 'the gate reads overall, not rawOverall');
  console.log('checkGateUsesDisplayOverall: OK');
}

function checkEveryUltimateIsReachable() {
  // One lopsided profile per ultimate. If a taxonomy entry can never win the
  // derivation it is decorative, which is the failure this catches.
  const cases = {
    heatCheck: { threePoint: 99, basketballIQ: 90 },
    silky: { midRange: 99, basketballIQ: 90 },
    paintBeast: { insideScoring: 99, postScoring: 95, strength: 90 },
    downhill: { ballHandling: 99, passing: 80, speed: 95, acceleration: 95 },
    aboveTheRim: { vertical: 99, acceleration: 97 },
    andOne: { strength: 99, freeThrow: 97 },
    glassWrecker: { offReb: 99, defReb: 99, strength: 90, vertical: 90 },
    coldBlooded: { basketballIQ: 99 },
    clamps: { perimeterDefense: 99, steal: 95, speed: 90 },
    motorNeverStops: { workEthic: 99 },
    floorGeneral: { passing: 99, ballHandling: 85, basketballIQ: 88 },
    theWall: { interiorDefense: 99, block: 95, strength: 90 }
  };
  Object.keys(cases).forEach(function (key) {
    assert.ok(ult.ULTIMATE_BY_KEY[key], 'unknown ultimate in test: ' + key);
    const got = ult.ultimateFor(withAttrs(cases[key]));
    assert.ok(got, key + ': derivation returned null for a qualifying star');
    assert.strictEqual(got.key, key,
      key + ': expected ' + key + ', got ' + got.key);
  });
  assert.strictEqual(Object.keys(cases).length, ult.ULTIMATE_TAXONOMY.length,
    'every taxonomy entry needs a reachability case');
  console.log('checkEveryUltimateIsReachable: OK (' + ult.ULTIMATE_TAXONOMY.length + ' ultimates)');
}

function checkDerivationIsDeterministic() {
  const p = withAttrs({ threePoint: 99 });
  const a = ult.ultimateFor(p), b = ult.ultimateFor(p);
  assert.strictEqual(a.key, b.key, 'the same player must always derive the same ultimate');
  console.log('checkDerivationIsDeterministic: OK');
}

function checkBadgeBoost() {
  const plain = withAttrs({ threePoint: 99 });
  assert.strictEqual(ult.badgeBoostFor(plain, ult.ultimateFor(plain)), 1,
    'no matching badge means no boost');
  const legend = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'legendary' }] });
  assert.ok(ult.badgeBoostFor(legend, ult.ultimateFor(legend)) > 1,
    'a matching legendary badge boosts the takeover');
  const bronze = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }] });
  assert.strictEqual(ult.badgeBoostFor(bronze, ult.ultimateFor(bronze)), 1,
    'only legendary and secret tiers boost — lower tiers do not');
  const wrong = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'rimProtector', tier: 'legendary' }] });
  assert.strictEqual(ult.badgeBoostFor(wrong, ult.ultimateFor(wrong)), 1,
    'a legendary badge that does not match the ultimate gives nothing');
  console.log('checkBadgeBoost: OK');
}

function checkTaxonomyShape() {
  const seen = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(!seen[u.key], 'duplicate ultimate key: ' + u.key);
    seen[u.key] = true;
    assert.ok(u.name && u.name.length, u.key + ' needs a display name');
    assert.ok(u.kind === 'solo' || u.kind === 'team', u.key + ' kind must be solo or team');
    assert.ok(u.side === 'offense' || u.side === 'defense', u.key + ' side must be offense or defense');
    assert.ok(u.derive && (u.derive.composite || u.derive.attributes),
      u.key + ' needs a derivation source');
  });
  const team = ult.ULTIMATE_TAXONOMY.filter(function (u) { return u.kind === 'team'; });
  assert.strictEqual(team.length, 2, 'exactly two team ultimates, one per end of the floor');
  assert.strictEqual(team.filter(function (u) { return u.side === 'offense'; }).length, 1);
  assert.strictEqual(team.filter(function (u) { return u.side === 'defense'; }).length, 1);
  console.log('checkTaxonomyShape: OK');
}

checkGate();
checkGateUsesDisplayOverall();
checkEveryUltimateIsReachable();
checkDerivationIsDeterministic();
checkBadgeBoost();
checkTaxonomyShape();
console.log('validate-ultimates: ALL OK');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `Cannot find module '.../ultimates.js'`

- [ ] **Step 3: Write `ultimates.js`**

```js
// Ultimate abilities — see docs/superpowers/specs/2026-08-12-ultimate-abilities-design.md.
//
// The whole brain of the feature, and deliberately the only file that knows
// what an ultimate IS. It takes plain values and returns plain values: no
// league, no GameState, no rng. gameSim.js owns every state transition and
// simEnginePossession.js only reads the dial numbers this file produces.
//
// DRAWS NO RNG, BY DESIGN. The meter is bookkeeping over events that already
// happened, so a takeover is the consequence of a night already going well
// rather than a die roll that decides a game. It also means the seeded stream
// is untouched and the same game replays identically.
var _ULT_DATA = (typeof require !== 'undefined')
  ? { composite: require('./compositeRatings.js'), ratings: require('./ratings.js') }
  : { composite: { computeComposite: computeComposite },
      ratings: { RATING_BANDS: RATING_BANDS } };

// Who qualifies. RATING_BANDS.star is on the DISPLAY scale (see ratings.js) —
// gating on rawOverall here would silently admit a completely different set of
// players, and everything would still appear to work.
//
// badgeBoost 1.35 is the multiplier a matching legendary or secret badge adds
// to the takeover's magnitude, so the badge system points the same direction as
// this one instead of competing for the same design space. Calibrated in Task 8.
const ULTIMATE_TUNING = {
  gateOverall: 87,
  badgeTieBreak: 3,
  badgeBoost: 1.35
};

// `derive` is how a player's fitness for this ultimate is scored: either one
// compositeRatings key, or a list of raw attributes averaged. `badges` are the
// badge keys whose legendary/secret form boosts it.
const ULTIMATE_TAXONOMY = [
  { key: 'heatCheck', name: 'Heat Check', kind: 'solo', side: 'offense',
    derive: { composite: 'shootingThree' }, badges: ['sharpshooter'] },
  { key: 'silky', name: 'Silky', kind: 'solo', side: 'offense',
    derive: { composite: 'shootingMid' }, badges: ['offBallMover'] },
  { key: 'paintBeast', name: 'Paint Beast', kind: 'solo', side: 'offense',
    derive: { composite: 'shootingInside' }, badges: ['postThreat', 'unstoppableForce'] },
  { key: 'downhill', name: 'Downhill', kind: 'solo', side: 'offense',
    derive: { attributes: ['ballHandling', 'speed', 'acceleration'] },
    badges: ['pickRollMaestro', 'eliteSpeed'] },
  { key: 'aboveTheRim', name: 'Above the Rim', kind: 'solo', side: 'offense',
    derive: { attributes: ['vertical', 'acceleration'] },
    badges: ['explosiveVertical', 'humanHighlightReel'] },
  { key: 'andOne', name: 'And-One', kind: 'solo', side: 'offense',
    derive: { attributes: ['strength', 'freeThrow'] },
    badges: ['finisher', 'freeThrowAce'] },
  { key: 'glassWrecker', name: 'Glass Wrecker', kind: 'solo', side: 'offense',
    derive: { composite: 'rebounding' }, badges: ['glassCleaner', 'springyRebounder'] },
  { key: 'coldBlooded', name: 'Cold Blooded', kind: 'solo', side: 'offense',
    derive: { attributes: ['basketballIQ'] }, badges: ['clutchGene', 'iceInVeins'] },
  { key: 'clamps', name: 'Clamps', kind: 'solo', side: 'defense',
    derive: { composite: 'defensePerimeter' },
    badges: ['lockdownDefender', 'pointOfAttackMenace'] },
  { key: 'motorNeverStops', name: 'Motor Never Stops', kind: 'solo', side: 'offense',
    derive: { attributes: ['workEthic'] }, badges: ['highMotor'] },
  { key: 'floorGeneral', name: 'Floor General', kind: 'team', side: 'offense',
    derive: { attributes: ['passing'] }, badges: ['playmaker', 'floorGeneral'] },
  { key: 'theWall', name: 'The Wall', kind: 'team', side: 'defense',
    derive: { composite: 'defenseInterior' }, badges: ['rimProtector', 'dpoyCaliber'] }
];

const ULTIMATE_BY_KEY = {};
ULTIMATE_TAXONOMY.forEach(function (u) { ULTIMATE_BY_KEY[u.key] = u; });

// Only the top two tiers boost. A bronze Sharpshooter is a common badge; if it
// counted, nearly every Heat Check holder would be boosted and the boost would
// mean nothing.
const BOOSTING_TIERS = { legendary: true, secret: true };

function hasUltimate(player) {
  return !!player && (player.overall || 0) >= ULTIMATE_TUNING.gateOverall;
}

function deriveScore(player, ultimate) {
  const d = ultimate.derive;
  if (d.composite) return _ULT_DATA.composite.computeComposite(player, d.composite);
  let sum = 0;
  for (let i = 0; i < d.attributes.length; i++) {
    sum += (player.attributes[d.attributes[i]] || 50);
  }
  return sum / d.attributes.length;
}

function badgeBoostFor(player, ultimate) {
  if (!ultimate) return 1;
  const held = player.hiddenTraits || [];
  for (let i = 0; i < held.length; i++) {
    if (BOOSTING_TIERS[held[i].tier] && ultimate.badges.indexOf(held[i].key) !== -1) {
      return ULTIMATE_TUNING.badgeBoost;
    }
  }
  return 1;
}

// Deterministic: highest derived score wins, and a matching badge of ANY tier
// breaks ties. Iteration order of ULTIMATE_TAXONOMY settles an exact tie, so
// the same player always derives the same ultimate.
function ultimateFor(player) {
  if (!hasUltimate(player)) return null;
  const held = player.hiddenTraits || [];
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < ULTIMATE_TAXONOMY.length; i++) {
    const u = ULTIMATE_TAXONOMY[i];
    let score = deriveScore(player, u);
    for (let j = 0; j < held.length; j++) {
      if (u.badges.indexOf(held[j].key) !== -1) { score += ULTIMATE_TUNING.badgeTieBreak; break; }
    }
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ULTIMATE_TUNING: ULTIMATE_TUNING,
    ULTIMATE_TAXONOMY: ULTIMATE_TAXONOMY,
    ULTIMATE_BY_KEY: ULTIMATE_BY_KEY,
    hasUltimate: hasUltimate,
    ultimateFor: ultimateFor,
    badgeBoostFor: badgeBoostFor
  };
}
```

- [ ] **Step 4: Run the test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS, ending `validate-ultimates: ALL OK`.

If `checkEveryUltimateIsReachable` fails for a key, the derivation sources overlap too much — widen the losing entry's `derive.attributes` or raise the test profile, do **not** special-case the derivation.

- [ ] **Step 5: Wire the file into the browser and the worker**

In `index.html`, add after the `compositeRatings.js` line (line 57) and before `skillCheck.js`:
```html
  <script src="ultimates.js"></script>
```

In `simWorker.js:16`, add `'ultimates.js'` after `'compositeRatings.js'`:
```js
importScripts('data.js', 'rng.js', 'traits.js', 'compositeRatings.js', 'ultimates.js', 'simEngine.js', 'simEngineBoxScore.js', 'simEnginePossession.js', 'gameCoach.js', 'gameSim.js');
```

- [ ] **Step 6: Verify the bridge**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-browserBridges.js
```
Expected: PASS. If it reports a missing member, add it to `_ULT_DATA`'s browser branch.

- [ ] **Step 7: Commit**

```bash
git add ultimates.js scripts/validate-ultimates.js index.html simWorker.js
git commit -m "feat: a star's ultimate is derived from what he is already best at"
```

---

## Task 2: The charge model

**Files:**
- Modify: `ultimates.js`
- Modify: `scripts/validate-ultimates.js`

**Interfaces:**
- Consumes: `ULTIMATE_TAXONOMY`, `ULTIMATE_BY_KEY` from Task 1.
- Produces:
  - `CHARGE_TUNING` — `{ full, secondFullMultiplier, gains, affinityMultiplier, situation, takeoverPossessions, longTakeoverPossessions }`
  - `PLAY_KINDS` — the closed set of play kind strings the engine may report
  - `chargeGain(ultimateKey, playKind, situationMult)` → number (may be negative)
  - `situationMultiplier(ultimateKey, scoreDiff, period)` → number
  - `chargeThreshold(takeoversUsed)` → number
  - `takeoverLength(ultimateKey)` → number of possessions

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-ultimates.js`, above the call block at the bottom:

```js
const CT = ult.CHARGE_TUNING;

function checkGainsAndDrains() {
  // Neutral situation so this tests the play values alone.
  const flat = 1;
  ult.PLAY_KINDS.forEach(function (kind) {
    const v = ult.chargeGain('heatCheck', kind, flat);
    assert.strictEqual(typeof v, 'number', kind + ' must produce a number');
    assert.ok(!isNaN(v), kind + ' produced NaN');
  });
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > 0, 'a made three fills');
  assert.ok(ult.chargeGain('heatCheck', 'turnover', flat) < 0, 'a turnover drains');
  assert.ok(ult.chargeGain('heatCheck', 'missedShot', flat) < 0, 'a miss drains');
  assert.ok(ult.chargeGain('heatCheck', 'foul', flat) < 0, 'a foul drains');
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > ult.chargeGain('heatCheck', 'madeTwo', flat),
    'a made three is worth more than a made two');
  assert.strictEqual(ult.chargeGain('heatCheck', 'notAPlayKind', flat), 0,
    'an unknown play kind earns nothing rather than throwing');
  console.log('checkGainsAndDrains: OK');
}

function checkAffinity() {
  // The same play is worth more to the ultimate it belongs to. This is what
  // makes Glass Wrecker charge off boards instead of off scoring.
  const three = ult.chargeGain('heatCheck', 'madeThree', 1);
  const threeToRebounder = ult.chargeGain('glassWrecker', 'madeThree', 1);
  assert.ok(three > threeToRebounder, 'a three charges Heat Check faster than Glass Wrecker');
  const board = ult.chargeGain('glassWrecker', 'rebound', 1);
  const boardToShooter = ult.chargeGain('heatCheck', 'rebound', 1);
  assert.ok(board > boardToShooter, 'a board charges Glass Wrecker faster than Heat Check');
  console.log('checkAffinity: OK');
}

function checkSituation() {
  // Q1, tied. The baseline everything else is compared against.
  const base = ult.situationMultiplier('heatCheck', 0, 1);
  assert.ok(ult.situationMultiplier('heatCheck', 0, 4) > base, 'the fourth quarter is worth more');
  assert.ok(ult.situationMultiplier('heatCheck', 0, 5) > ult.situationMultiplier('heatCheck', 0, 4),
    'overtime is worth more than the fourth');
  assert.ok(ult.situationMultiplier('heatCheck', -6, 1) > base, 'trailing is worth more than tied');
  assert.ok(ult.situationMultiplier('heatCheck', 30, 1) < base, 'a blowout is worth less');
  console.log('checkSituation: OK');
}

// Cold Blooded is the whole reason the situation multiplier is a function of
// the ultimate and not just of the game state.
function checkColdBloodedIgnoresEarlyGame() {
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 1), 0, 'Q1 earns nothing');
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 3), 0, 'Q3 earns nothing');
  assert.ok(ult.situationMultiplier('coldBlooded', 0, 4) > 0, 'the fourth earns');
  assert.ok(ult.situationMultiplier('coldBlooded', 25, 4) <
    ult.situationMultiplier('coldBlooded', 0, 4), 'and only when the game is close');
  console.log('checkColdBloodedIgnoresEarlyGame: OK');
}

function checkThresholdRises() {
  const first = ult.chargeThreshold(0);
  const second = ult.chargeThreshold(1);
  assert.strictEqual(first, CT.full, 'the first takeover costs a full meter');
  assert.ok(second > first, 'a second takeover must cost more than the first');
  assert.ok(ult.chargeThreshold(2) > second, 'and a third more than the second');
  console.log('checkThresholdRises: OK (' + first + ' then ' + second + ')');
}

function checkTakeoverLength() {
  const normal = ult.takeoverLength('heatCheck');
  assert.strictEqual(normal, CT.takeoverPossessions);
  assert.ok(ult.takeoverLength('motorNeverStops') > normal * 2,
    'Motor Never Stops runs at least twice as long — attrition is its whole idea');
  console.log('checkTakeoverLength: OK');
}
```

Add the calls above `console.log('validate-ultimates: ALL OK');`:
```js
checkGainsAndDrains();
checkAffinity();
checkSituation();
checkColdBloodedIgnoresEarlyGame();
checkThresholdRises();
checkTakeoverLength();
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `TypeError: ult.chargeGain is not a function`

- [ ] **Step 3: Add the charge model to `ultimates.js`**

Insert after `const BOOSTING_TIERS = ...`:

```js
// The closed set of plays the engine may report. A kind not on this list earns
// nothing rather than throwing — but validate-ultimates asserts the engine only
// ever reports kinds that ARE on it, so a typo in the engine fails loudly in
// the test rather than silently zeroing a player's meter forever.
const PLAY_KINDS = ['madeThree', 'madeTwo', 'freeThrow', 'assist', 'steal',
  'block', 'rebound', 'offRebound', 'missedShot', 'turnover', 'foul'];

// Values are relative to a 100-point meter. Calibrated in Task 8 against the
// measured takeover rate; the sweep lives in that task's commit message.
//
// Drains are what make a takeover earned rather than scheduled: a star shooting
// 4-for-15 moves BACKWARDS and never reaches one regardless of minutes played.
const CHARGE_TUNING = {
  full: 100,
  // A second takeover in one game should be the night people remember, not a
  // routine second helping.
  secondFullMultiplier: 1.6,
  takeoverPossessions: 20,
  longTakeoverPossessions: 50,
  gains: {
    madeThree: 9, madeTwo: 6, freeThrow: 2, assist: 5, steal: 8,
    block: 8, rebound: 3, offRebound: 5,
    missedShot: -4, turnover: -9, foul: -3
  },
  // A play in the ultimate's own currency is worth more to it.
  affinityMultiplier: 1.6,
  situation: {
    // Closeness bands, widest first. `within` is the absolute score margin.
    closeness: [{ within: 5, mult: 1.5 }, { within: 10, mult: 1.2 },
                { within: 20, mult: 1.0 }, { within: Infinity, mult: 0.4 }],
    periodMult: { 4: 1.5, overtime: 2.0 },
    trailingMult: 1.2
  }
};

// Which play kinds are each ultimate's own currency.
const CHARGE_AFFINITY = {
  heatCheck: ['madeThree'],
  silky: ['madeTwo'],
  paintBeast: ['madeTwo', 'freeThrow'],
  downhill: ['madeTwo', 'assist'],
  aboveTheRim: ['madeTwo', 'block', 'offRebound'],
  andOne: ['freeThrow', 'madeTwo'],
  glassWrecker: ['rebound', 'offRebound'],
  coldBlooded: ['madeThree', 'madeTwo'],
  clamps: ['steal'],
  motorNeverStops: ['rebound', 'assist'],
  floorGeneral: ['assist'],
  theWall: ['block']
};

// Cold Blooded's meter is dead until the fourth quarter. Same rule as every
// other ultimate — the first three periods are simply multiplied to zero.
const LATE_GAME_ONLY = { coldBlooded: true };

function situationMultiplier(ultimateKey, scoreDiff, period) {
  if (LATE_GAME_ONLY[ultimateKey] && period < 4) return 0;
  const s = CHARGE_TUNING.situation;
  const margin = Math.abs(scoreDiff || 0);
  let mult = 1;
  for (let i = 0; i < s.closeness.length; i++) {
    if (margin <= s.closeness[i].within) { mult = s.closeness[i].mult; break; }
  }
  if (period >= 5) mult *= s.periodMult.overtime;
  else if (period === 4) mult *= s.periodMult[4];
  if ((scoreDiff || 0) < 0) mult *= s.trailingMult;
  return mult;
}

function chargeGain(ultimateKey, playKind, situationMult) {
  const base = CHARGE_TUNING.gains[playKind];
  if (base === undefined) return 0;
  const affinity = CHARGE_AFFINITY[ultimateKey] || [];
  const affinityMult = affinity.indexOf(playKind) !== -1 ? CHARGE_TUNING.affinityMultiplier : 1;
  // Drains are NOT scaled by the situation: a turnover in a blowout still costs
  // what a turnover costs. Only the earning side responds to the moment.
  if (base < 0) return base;
  return base * affinityMult * (situationMult === undefined ? 1 : situationMult);
}

function chargeThreshold(takeoversUsed) {
  return CHARGE_TUNING.full * Math.pow(CHARGE_TUNING.secondFullMultiplier, takeoversUsed || 0);
}

function takeoverLength(ultimateKey) {
  return ultimateKey === 'motorNeverStops'
    ? CHARGE_TUNING.longTakeoverPossessions
    : CHARGE_TUNING.takeoverPossessions;
}
```

Add to the exports block:
```js
    PLAY_KINDS: PLAY_KINDS,
    CHARGE_TUNING: CHARGE_TUNING,
    CHARGE_AFFINITY: CHARGE_AFFINITY,
    situationMultiplier: situationMultiplier,
    chargeGain: chargeGain,
    chargeThreshold: chargeThreshold,
    takeoverLength: takeoverLength,
```

- [ ] **Step 4: Run the test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ultimates.js scripts/validate-ultimates.js
git commit -m "feat: the meter fills on a star's own good plays and drains on his bad ones"
```

---

## Task 3: The dial table

**Files:**
- Modify: `ultimates.js`
- Modify: `scripts/validate-ultimates.js`

**Interfaces:**
- Consumes: `ULTIMATE_BY_KEY`, `badgeBoostFor` from Task 1.
- Produces:
  - `DIAL_NAMES` — the closed set of dial names
  - `takeoverEffect(ultimateKey, badgeBoost)` → `{ <dialName>: number | object }`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-ultimates.js`:

```js
function checkEveryUltimateTurnsSomething() {
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    const dials = Object.keys(eff);
    assert.ok(dials.length > 0, u.key + ' turns no dials — it would do nothing');
    dials.forEach(function (d) {
      assert.ok(ult.DIAL_NAMES.indexOf(d) !== -1,
        u.key + ' turns unknown dial "' + d + '" — the engine will never read it');
    });
  });
  console.log('checkEveryUltimateTurnsSomething: OK');
}

function checkBadgeBoostScalesTheEffect() {
  const plain = ult.takeoverEffect('heatCheck', 1);
  const boosted = ult.takeoverEffect('heatCheck', ult.ULTIMATE_TUNING.badgeBoost);
  assert.ok(boosted.makeThree > plain.makeThree, 'a matching badge makes the takeover stronger');
  console.log('checkBadgeBoostScalesTheEffect: OK');
}

// Team ultimates are multiplied by five, so their per-player magnitude must be
// smaller than any solo one. Without this rule every floor general in the
// league is the best player alive.
function checkTeamEffectsAreSmallerPerPlayer() {
  const solo = ult.takeoverEffect('heatCheck', 1).makeThree;
  const team = ult.takeoverEffect('floorGeneral', 1).teamMake;
  assert.ok(team < solo, 'a team ultimate lifts each player less than a solo one lifts its holder');
  console.log('checkTeamEffectsAreSmallerPerPlayer: OK');
}

// Motor Never Stops earns its points by attrition. If it ever gains a shooting
// bonus it stops being the odd one out and becomes a twelfth accuracy boost.
function checkMotorTouchesNoShootingProbability() {
  const eff = ult.takeoverEffect('motorNeverStops', 1);
  ['makeThree', 'makeMid', 'makeInside', 'makeFt', 'teamMake'].forEach(function (d) {
    assert.strictEqual(eff[d], undefined, 'Motor Never Stops must not turn ' + d);
  });
  assert.ok(eff.energyDrain !== undefined, 'Motor Never Stops must turn energyDrain');
  console.log('checkMotorTouchesNoShootingProbability: OK');
}

// The shot-share ceiling exists because weightedPick caps any one player at
// PICK_CEILING.shooter. A usage boost that does not lift it saturates silently.
function checkUsageUltimatesLiftTheCeiling() {
  ['heatCheck', 'silky', 'paintBeast', 'downhill', 'aboveTheRim', 'andOne', 'coldBlooded']
    .forEach(function (key) {
      const eff = ult.takeoverEffect(key, 1);
      assert.ok(eff.shotShare > 1, key + ' must raise shot share');
      assert.ok(eff.shotCeiling > 0.5,
        key + ' raises shot share but not the ceiling — the boost would saturate');
    });
  console.log('checkUsageUltimatesLiftTheCeiling: OK');
}

function checkUnknownUltimateIsInert() {
  assert.deepStrictEqual(ult.takeoverEffect('notAnUltimate', 1), {},
    'an unknown key returns no dials rather than throwing');
  console.log('checkUnknownUltimateIsInert: OK');
}
```

Add the calls above the final log line.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `TypeError: ult.takeoverEffect is not a function`

- [ ] **Step 3: Add the dial table to `ultimates.js`**

Insert before the exports block:

```js
// The closed set of dials a takeover may turn. Every name here is read by
// simEnginePossession.js (Task 6) and validate-ultimates.js asserts that
// statically — the recurring failure in this codebase is a value computed and
// then discarded, and an unread dial is exactly that.
//
//   shotShare    multiplier on the holder's shot-pick weight
//   shotCeiling  raises PICK_CEILING.shooter for the holder only
//   zoneBias     { three|mid|inside: multiplier } on his shot-zone mix
//   makeThree / makeMid / makeInside / makeFt   added to his make probability
//   turnover     added to the turnover probability when he handles (negative helps him)
//   block        added to his block probability as defender
//   reboundShare multiplier on his rebound-pick weight
//   foulRate     multiplier on the shooting-foul rate when he shoots
//   energyDrain  multiplier on his own energy drain (below 1 = tires slower)
//   matchupDrain multiplier on his defender's energy drain (above 1 = tires them)
//   teamMake     added to all five team-mates' make probability
//   teamTurnover added to the team's turnover probability (negative helps)
//   oppMake      added to the opponent five's make probability (negative hurts them)
//   oppTurnover  added to the opponent's turnover probability
const DIAL_NAMES = ['shotShare', 'shotCeiling', 'zoneBias', 'makeThree', 'makeMid',
  'makeInside', 'makeFt', 'turnover', 'block', 'reboundShare', 'foulRate',
  'energyDrain', 'matchupDrain', 'teamMake', 'teamTurnover', 'oppMake', 'oppTurnover'];

// Magnitudes are STARTING VALUES, calibrated in Task 8 to the measured band of
// 10-15 points added to the holder. Probability dials are absolute additions to
// a 0-1 probability; share dials are multipliers.
//
// Team dials are deliberately far smaller than solo ones because they are
// multiplied by five.
const TAKEOVER_EFFECTS = {
  heatCheck:      { shotShare: 2.4, shotCeiling: 0.80, zoneBias: { three: 2.2 }, makeThree: 0.13 },
  silky:          { shotShare: 2.4, shotCeiling: 0.80, zoneBias: { mid: 2.6 }, makeMid: 0.14 },
  paintBeast:     { shotShare: 2.3, shotCeiling: 0.80, zoneBias: { inside: 2.0 }, makeInside: 0.12, foulRate: 1.3 },
  downhill:       { shotShare: 2.2, shotCeiling: 0.78, zoneBias: { inside: 1.9 }, makeInside: 0.10, turnover: -0.05 },
  aboveTheRim:    { shotShare: 2.2, shotCeiling: 0.78, zoneBias: { inside: 2.1 }, makeInside: 0.12, reboundShare: 1.6, block: 0.05 },
  andOne:         { shotShare: 2.2, shotCeiling: 0.78, zoneBias: { inside: 2.0 }, makeInside: 0.08, foulRate: 2.0, makeFt: 0.08 },
  glassWrecker:   { shotShare: 1.5, shotCeiling: 0.65, reboundShare: 3.0, zoneBias: { inside: 1.6 }, makeInside: 0.08 },
  coldBlooded:    { shotShare: 2.5, shotCeiling: 0.82, makeThree: 0.12, makeMid: 0.12, makeInside: 0.12, makeFt: 0.06 },
  clamps:         { oppTurnover: 0.10 },
  motorNeverStops: { energyDrain: 0.15, matchupDrain: 1.9 },
  floorGeneral:   { teamMake: 0.045, teamTurnover: -0.02 },
  theWall:        { oppMake: -0.05, block: 0.04 }
};

// Dials that are multipliers scale from 1 rather than from 0 — doubling a 1.6x
// share multiplier would be a 3.2x, which is not what a 35% badge boost means.
const MULTIPLIER_DIALS = { shotShare: true, reboundShare: true, foulRate: true, matchupDrain: true };

function takeoverEffect(ultimateKey, badgeBoost) {
  const base = TAKEOVER_EFFECTS[ultimateKey];
  if (!base) return {};
  const boost = (badgeBoost === undefined || !(badgeBoost > 0)) ? 1 : badgeBoost;
  const out = {};
  Object.keys(base).forEach(function (dial) {
    const v = base[dial];
    if (dial === 'zoneBias' || dial === 'shotCeiling') { out[dial] = v; return; }
    if (MULTIPLIER_DIALS[dial]) { out[dial] = 1 + (v - 1) * boost; return; }
    if (dial === 'energyDrain') { out[dial] = v; return; }
    out[dial] = v * boost;
  });
  return out;
}
```

Add to exports:
```js
    DIAL_NAMES: DIAL_NAMES,
    TAKEOVER_EFFECTS: TAKEOVER_EFFECTS,
    takeoverEffect: takeoverEffect,
```

- [ ] **Step 4: Run the test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ultimates.js scripts/validate-ultimates.js
git commit -m "feat: each ultimate turns a named set of dials the engine already has"
```

---

## Task 4: Box-line state and the plays report — proven behaviour-neutral

The engine starts carrying meter state and reporting what happened, but **nothing reads it yet**. Both golden masters must be byte-identical at the end of this task. That proof is the whole point of splitting it out.

**Files:**
- Modify: `simEnginePossession.js:199-205` (`initBoxLine`), and the play sites inside `simulatePossession`
- Modify: `scripts/validate-ultimates.js`

**Interfaces:**
- Produces: `outcome.plays` — array of `{ playerId, kind }` where `kind` is one of `ultimates.PLAY_KINDS`. Box lines gain `charge: 0`, `takeoverLeft: 0`, `takeoversUsed: 0`, `takeoverPoints: 0`.

- [ ] **Step 1: Capture the golden baseline**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js
```
Expected: both PASS. Record that they pass — they must still pass at Step 6.

- [ ] **Step 2: Write the failing test**

Append to `scripts/validate-ultimates.js`:

```js
// The engine reports plays; ultimates.js prices them. If the engine ever
// reports a kind the pricing table does not know, that player's meter silently
// stops filling — so the two lists are asserted to agree STATICALLY, by reading
// the engine's source, rather than by hoping a sim happens to hit every branch.
function checkEngineReportsOnlyKnownPlayKinds() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'simEnginePossession.js'), 'utf8');
  const reported = [];
  const re = /reportPlay\([^,]+,\s*[^,]+,\s*'([a-zA-Z]+)'\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) { if (reported.indexOf(m[1]) === -1) reported.push(m[1]); }
  assert.ok(reported.length > 0, 'no reportPlay call sites found — the report is not wired in');
  reported.forEach(function (kind) {
    assert.ok(ult.PLAY_KINDS.indexOf(kind) !== -1,
      'the engine reports "' + kind + '", which ultimates.js prices at nothing');
  });
  // And the reverse: a priced kind nobody reports is dead tuning.
  ult.PLAY_KINDS.forEach(function (kind) {
    assert.ok(reported.indexOf(kind) !== -1,
      'ultimates.js prices "' + kind + '" but the engine never reports it');
  });
  console.log('checkEngineReportsOnlyKnownPlayKinds: OK (' + reported.length + ' kinds)');
}

function checkBoxLineCarriesMeterState() {
  const poss = require(path.join(ROOT, 'simEnginePossession.js'));
  const line = poss.initBoxLine();
  ['charge', 'takeoverLeft', 'takeoversUsed', 'takeoverPoints'].forEach(function (f) {
    assert.strictEqual(line[f], 0, 'a fresh box line must start with ' + f + ' at 0');
  });
  console.log('checkBoxLineCarriesMeterState: OK');
}
```

Add the two calls above the final log line.

- [ ] **Step 3: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `no reportPlay call sites found`

- [ ] **Step 4: Add the state and the report to `simEnginePossession.js`**

Replace `initBoxLine` (line 199) — keep the existing comment, add the four fields:

```js
function initBoxLine() {
  // oppFga/oppFgm are what a player allowed AS THE SHOT DEFENDER — the raw
  // material for DFG%. Without them a defensive badge is invisible: steals and
  // blocks land in the box score, "lowered the shooter's percentage" does not.
  //
  // charge/takeoverLeft/takeoversUsed/takeoverPoints are the ultimate meter,
  // per game and discarded with it (ultimates.js). They live here rather than
  // on the player because a meter that survived the final buzzer would let a
  // star bank a takeover across a road trip.
  return { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, energy: 1, fouls: 0, plusMinus: 0, oppFga: 0, oppFgm: 0,
    charge: 0, takeoverLeft: 0, takeoversUsed: 0, takeoverPoints: 0, takeoverPointsAt: 0 };
}
```

Add this helper immediately above `simulatePossession`:

```js
// What happened, in the ultimate meter's vocabulary. gameSim.js prices these
// through ultimates.chargeGain — this engine deliberately does not know what a
// play is worth, only that it happened.
//
// A no-op when `outcome` is absent, which is every pre-ultimates caller and
// every unit test that does not care.
function reportPlay(outcome, playerId, kind) {
  if (!outcome) return;
  if (!outcome.plays) outcome.plays = [];
  outcome.plays.push({ playerId: playerId, kind: kind });
}
```

Now add exactly one `reportPlay` call at each play site inside `simulatePossession`:

In the turnover branch, after `defenseBox[onBallDefender.id].steals += 1;` and its `if`:
```js
    reportPlay(outcome, handler.id, 'turnover');
    if (stolen) reportPlay(outcome, onBallDefender.id, 'steal');
```

In the block branch, after `offenseBox[shooter.id].fga += 1;`:
```js
    reportPlay(outcome, shotDefender.id, 'block');
    reportPlay(outcome, shooter.id, 'missedShot');
```

In the made-shot branch, after `points += shotValue;`:
```js
    reportPlay(outcome, shooter.id, zone === 'three' ? 'madeThree' : 'madeTwo');
```
and inside the assist `if (passer)` block, after `assistPlayerId = passer.id;`:
```js
        reportPlay(outcome, passer.id, 'assist');
```

In the miss branch, immediately after the `logPlay(log, shooter.name + ' misses ...` line:
```js
    reportPlay(outcome, shooter.id, 'missedShot');
```
and in the offensive-rebound branch after `offenseBox[rebounder.id].rebounds += 1;`:
```js
      reportPlay(outcome, rebounder.id, 'offRebound');
```
and in the defensive-rebound branch after `defenseBox[rebounder.id].rebounds += 1;`:
```js
      reportPlay(outcome, rebounder.id, 'rebound');
```

In the shooting-foul branch, after `defenseBox[shotDefender.id].fouls += 1;`:
```js
    reportPlay(outcome, shotDefender.id, 'foul');
```
and after `points += made2;`:
```js
    for (let f = 0; f < made2; f++) reportPlay(outcome, shooter.id, 'freeThrow');
```

Add `reportPlay` to the module exports so the static guard and later tasks can reach it:
```js
    reportPlay: reportPlay,
```

- [ ] **Step 5: Run the ultimates test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS, reporting 11 kinds.

- [ ] **Step 6: Prove nothing changed**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js && node scripts/validate-possession.js && node scripts/validate-skillCheck.js
```
Expected: **all PASS unchanged.** Bookkeeping that draws no rng and feeds nothing cannot move a golden. If a golden moved, a `reportPlay` was placed inside a conditional that also consumed an rng draw — move it out.

- [ ] **Step 7: Commit**

```bash
git add simEnginePossession.js scripts/validate-ultimates.js
git commit -m "feat: the engine reports what happened in the meter's vocabulary, changing nothing yet"
```

---

## Task 5: The meter runs — still behaviour-neutral

`gameSim.js` fills meters, fires takeovers, expires them and emits events. It does **not** yet hand the dials to the engine, so both goldens must *still* be byte-identical. This is the second and last free proof.

**Files:**
- Modify: `gameSim.js:1-20` (bridge), `gameSim.js:195-265` (the possession loop)
- Modify: `scripts/validate-ultimates.js`

**Interfaces:**
- Consumes: `ultimates.ultimateFor`, `badgeBoostFor`, `chargeGain`, `situationMultiplier`, `chargeThreshold`, `takeoverLength`, `takeoverEffect`; `outcome.plays` from Task 4.
- Produces:
  - `sim.takeovers` — `{ home: null | { playerId, ultimateKey, effect, left }, away: ... }`
  - Events `{ type: 'takeover-start', playerId, ultimateKey, ultimateName }` and `{ type: 'takeover-end', playerId, ultimateKey, points }`
  - `gameSim.activeTakeoverFor(sim, team)` → the active record or `null` (read by `gameCoach.js` in Task 7)

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-ultimates.js`:

```js
// Drives a real game and asserts the meter machinery ran. This needs the whole
// engine stack, so it is loaded lazily — the pure tests above must keep working
// without a league.
function gameFixture() {
  require(path.join(ROOT, 'teams.js'));
  const traits = require(path.join(ROOT, 'traits.js'));
  require(path.join(ROOT, 'scouting.js'));
  const players = require(path.join(ROOT, 'players-2026.js'));
  traits.ensureHiddenPlayerData(players.PLAYERS_2026);
  require(path.join(ROOT, 'simEngine.js'));
  require(path.join(ROOT, 'simEngineBoxScore.js'));
  require(path.join(ROOT, 'simEnginePossession.js'));
  require(path.join(ROOT, 'gameCoach.js'));
  return {
    gameSim: require(path.join(ROOT, 'gameSim.js')),
    makeRng: require(path.join(ROOT, 'rng.js')).makeRng,
    players: players.PLAYERS_2026
  };
}

function checkTakeoversFireInARealGame() {
  const f = gameFixture();
  let starts = 0, ends = 0;
  // Several games, because one game between two ordinary teams may contain no
  // qualifying star at all — and a test that passes only on a lucky matchup is
  // not a test.
  for (let s = 0; s < 12; s++) {
    const events = [];
    f.gameSim.simulateGame('BOS', 'LAL', f.makeRng(1000 + s), { events: events });
    events.forEach(function (e) {
      if (e.type === 'takeover-start') {
        starts += 1;
        assert.ok(e.playerId, 'a takeover-start must name the player');
        assert.ok(ult.ULTIMATE_BY_KEY[e.ultimateKey], 'and a real ultimate');
      }
      if (e.type === 'takeover-end') ends += 1;
    });
  }
  assert.ok(starts > 0, 'no takeover fired in twelve games — the meter never reaches its threshold');
  assert.ok(ends >= starts - 12, 'takeovers must end, not leak past the final buzzer');
  console.log('checkTakeoversFireInARealGame: OK (' + starts + ' starts, ' + ends + ' ends)');
}

// A non-star must never charge. Otherwise the "top 30-60 players" gate is a lie
// the box score would eventually expose.
function checkOnlyStarsCharge() {
  const f = gameFixture();
  const events = [];
  f.gameSim.simulateGame('BOS', 'LAL', f.makeRng(7), { events: events });
  const byId = {};
  f.players.forEach(function (p) { byId[p.id] = p; });
  events.filter(function (e) { return e.type === 'takeover-start'; }).forEach(function (e) {
    assert.ok(ult.hasUltimate(byId[e.playerId]),
      byId[e.playerId].name + ' took over without qualifying for an ultimate');
  });
  console.log('checkOnlyStarsCharge: OK');
}
```

Add both calls above the final log line.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `no takeover fired in twelve games`

- [ ] **Step 3: Add ultimates to the `gameSim.js` bridge**

At the top of `gameSim.js`, add `ultimates` to both branches of `_GAMESIM_DATA`:

```js
// Node branch — add to the require list:
    ultimates: require('./ultimates.js'),
// Browser branch — the hand-written list validate-browserBridges.js checks:
    ultimates: { ultimateFor: ultimateFor, badgeBoostFor: badgeBoostFor,
                 chargeGain: chargeGain, situationMultiplier: situationMultiplier,
                 chargeThreshold: chargeThreshold, takeoverLength: takeoverLength,
                 takeoverEffect: takeoverEffect },
```

- [ ] **Step 4: Add the meter to the possession loop**

Add these helpers above `createGameSim` in `gameSim.js`:

```js
// Cached per game: deriving an ultimate walks twelve composites, and doing that
// on every possession for ten players would dominate the sim's cost.
function buildUltimateIndex(roster) {
  const index = {};
  roster.forEach(function (p) {
    const u = _GAMESIM_DATA.ultimates.ultimateFor(p);
    if (u) index[p.id] = { ultimate: u, boost: _GAMESIM_DATA.ultimates.badgeBoostFor(p, u) };
  });
  return index;
}

function activeTakeoverFor(sim, team) {
  return (sim.takeovers && sim.takeovers[team]) || null;
}
```

Add to the `sim` object literal (after `run: { team: null, points: 0 },`):
```js
    // The live takeover on each side, or null. Read by gameCoach.js so a coach
    // does not bench a man mid-takeover, and by the pixel view for the marker.
    takeovers: { home: null, away: null },
```

Immediately after the rosters and box lines are built (before the step loop), add:
```js
  const ultimateIndex = {
    home: buildUltimateIndex(homeRoster),
    away: buildUltimateIndex(awayRoster)
  };
```

In the possession loop, **after** `sim.inTransition = !!outcome.liveBallToDefense;` and after the score is added, insert the meter update:

```js
    // --- The ultimate meter ------------------------------------------------
    // Charge is applied AFTER the possession resolves, from what the engine
    // reported, and consumes no randomness. A takeover therefore fires because
    // of a night already going well, never because of a roll.
    const ults = _GAMESIM_DATA.ultimates;
    const plays = outcome.plays || [];
    for (let pi = 0; pi < plays.length; pi++) {
      const play = plays[pi];
      // A play's charge belongs to whoever made it, on whichever side he plays.
      const side = ultimateIndex.home[play.playerId] ? 'home'
                 : (ultimateIndex.away[play.playerId] ? 'away' : null);
      if (!side) continue;
      const box = side === 'home' ? homeBox : awayBox;
      const line = box[play.playerId];
      // Frozen on the bench: no line means he is not dressed; not on court
      // means he is resting, and neither fills nor drains.
      if (!line || onCourt[side].indexOf(play.playerId) === -1) continue;
      const entry = ultimateIndex[side][play.playerId];
      const diff = side === 'home' ? (sim.homeScore - sim.awayScore) : (sim.awayScore - sim.homeScore);
      const mult = ults.situationMultiplier(entry.ultimate.key, diff, sim.period);
      line.charge = Math.max(0, line.charge + ults.chargeGain(entry.ultimate.key, play.kind, mult));
    }
    outcome.plays = null;

    // Expire a running takeover. Counted in possessions of the side the
    // ultimate acts on: a defensive ultimate ticks down on the OTHER team's
    // possessions, which is where it does its work.
    ['home', 'away'].forEach(function (side) {
      const active = sim.takeovers[side];
      if (!active) return;
      const actsOn = active.side === 'defense' ? (side === 'home' ? 'away' : 'home') : side;
      if (actsOn !== team) return;
      active.left -= 1;
      const stillOn = onCourt[side].indexOf(active.playerId) !== -1;
      if (active.left > 0 && stillOn) return;
      const box = side === 'home' ? homeBox : awayBox;
      const line = box[active.playerId];
      pushSimEvent(ctx, side, { type: 'takeover-end', playerId: active.playerId,
        ultimateKey: active.ultimateKey, points: line ? line.takeoverPoints : 0 });
      sim.takeovers[side] = null;
    });

    // Fire a new one. Only for a player actually on the floor, and only one per
    // side at a time — two simultaneous takeovers on one team would stack their
    // dials on the same five players.
    ['home', 'away'].forEach(function (side) {
      if (sim.takeovers[side]) return;
      const box = side === 'home' ? homeBox : awayBox;
      const ids = onCourt[side];
      for (let i = 0; i < ids.length; i++) {
        const entry = ultimateIndex[side][ids[i]];
        const line = box[ids[i]];
        if (!entry || !line) continue;
        if (line.charge < ults.chargeThreshold(line.takeoversUsed)) continue;
        line.charge = 0;
        line.takeoversUsed += 1;
        line.takeoverPoints = 0;
        sim.takeovers[side] = {
          playerId: ids[i],
          ultimateKey: entry.ultimate.key,
          ultimateName: entry.ultimate.name,
          side: entry.ultimate.side,
          kind: entry.ultimate.kind,
          effect: ults.takeoverEffect(entry.ultimate.key, entry.boost),
          left: ults.takeoverLength(entry.ultimate.key)
        };
        pushSimEvent(ctx, side, { type: 'takeover-start', playerId: ids[i],
          ultimateKey: entry.ultimate.key, ultimateName: entry.ultimate.name });
        break;
      }
    });
```

Add this helper next to `activeTakeoverFor` — takeover events belong to the side whose player they concern, which is not always the side currently on offense:

```js
// A takeover event belongs to the holder's team, not to whoever has the ball.
// Derived by copy-and-override from the live context so it keeps every stamped
// field (period, clock, quarter) rather than being rebuilt field by field —
// hand-listed copies are exactly how rebound events lost their clock once.
function pushSimEvent(ctx, side, ev) {
  if (!ctx) return;
  const sideCtx = ctx.team === side ? ctx : Object.assign({}, ctx, { team: side });
  ev.team = sideCtx.team;
  ev.quarter = sideCtx.quarter;
  ev.period = sideCtx.period;
  ev.clock = sideCtx.clock;
  ctx.events.push(ev);
}
```

Add `activeTakeoverFor` to the `gameSim.js` exports.

- [ ] **Step 5: Run the ultimates test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS, reporting a non-zero number of starts.

If `starts` is 0, the threshold is unreachable at the current charge values — do **not** lower it here. Note the number and fix it in Task 8, where it is measured; for now temporarily set `CHARGE_TUNING.full` low enough to prove the wiring, and record that it is provisional.

- [ ] **Step 6: Prove nothing changed**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js
```
Expected: **both PASS unchanged.** The meter consumes no rng and feeds nothing back into the engine yet.

- [ ] **Step 7: Verify the bridge and commit**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-browserBridges.js
git add gameSim.js scripts/validate-ultimates.js
git commit -m "feat: the meter fills, fires and expires — with nothing reading its dials yet"
```

---

## Task 6: The dials reach the engine

This is where the simulation changes. Both goldens move from here on, deliberately.

**Files:**
- Modify: `simEnginePossession.js` (shooter pick, zone pick, shot spec, turnover spec, block spec, foul rate, rebound weights, energy drain)
- Modify: `gameSim.js` (pass `takeovers` on `gameCtx`)
- Modify: `scripts/validate-ultimates.js`

**Interfaces:**
- Consumes: `sim.takeovers` from Task 5, `takeoverEffect` dial names from Task 3.
- Produces: `gameCtx.takeovers` — `{ offense: record|null, defense: record|null }`, where each record is the object built in Task 5.

- [ ] **Step 1: Write the failing test — the call-site guard**

Append to `scripts/validate-ultimates.js`:

```js
// The recurring failure in this codebase is a value computed and then
// discarded. Twelve ultimates advertise seventeen dials; this asserts, by
// reading the engine's source, that every one of them is actually READ. A dial
// nobody reads is a promise the box score will eventually contradict.
function checkEveryDialIsReadByTheEngine() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'simEnginePossession.js'), 'utf8');
  const used = {};
  ult.DIAL_NAMES.forEach(function (dial) {
    used[dial] = new RegExp('\\.' + dial + '\\b').test(src);
  });
  // Only dials some ultimate actually turns need a reader.
  const turned = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    Object.keys(ult.takeoverEffect(u.key, 1)).forEach(function (d) { turned[d] = u.key; });
  });
  Object.keys(turned).forEach(function (dial) {
    assert.ok(used[dial],
      turned[dial] + ' turns "' + dial + '" but simEnginePossession.js never reads it');
  });
  console.log('checkEveryDialIsReadByTheEngine: OK (' + Object.keys(turned).length + ' dials)');
}

// A takeover must actually produce points, not merely fire. This is the
// difference between the feature existing and the feature working.
function checkATakeoverMovesTheBoxScore() {
  const f = gameFixture();
  let withPoints = 0, total = 0;
  for (let s = 0; s < 12; s++) {
    const events = [];
    f.gameSim.simulateGame('BOS', 'LAL', f.makeRng(2000 + s), { events: events });
    events.filter(function (e) { return e.type === 'takeover-end'; }).forEach(function (e) {
      total += 1;
      if (e.points > 0) withPoints += 1;
    });
  }
  assert.ok(total > 0, 'no takeover completed in twelve games');
  assert.ok(withPoints / total > 0.5,
    'most takeovers scored nothing (' + withPoints + '/' + total + ') — the dials are not reaching the engine');
  console.log('checkATakeoverMovesTheBoxScore: OK (' + withPoints + '/' + total + ' scored)');
}
```

Add both calls above the final log line.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `heatCheck turns "shotShare" but simEnginePossession.js never reads it`

- [ ] **Step 3: Hand the takeovers to the engine from `gameSim.js`**

In the possession loop, extend the existing `gameCtx` literal:

```js
    const gameCtx = {
      scoreDiff: team === 'home' ? (sim.homeScore - sim.awayScore) : (sim.awayScore - sim.homeScore),
      period: sim.period,
      // Resolved from the SHOOTING team's point of view, matching scoreDiff:
      // `offense` is the takeover held by the team with the ball, `defense` the
      // one held by the team defending. Either may be null.
      takeovers: {
        offense: sim.takeovers[team] && sim.takeovers[team].side === 'offense' ? sim.takeovers[team] : null,
        defense: sim.takeovers[other] && sim.takeovers[other].side === 'defense' ? sim.takeovers[other] : null
      }
    };
```

And credit the holder's points. This is done by **snapshot and diff**, not by accumulating per possession: the box line already counts his points, so taking the difference between the end and the start of the takeover is exact and cannot drift.

In Task 5's fire block, after `line.takeoverPoints = 0;` add:
```js
        line.takeoverPointsAt = line.points;
```

In Task 5's expire block, immediately before the `pushSimEvent` call, add:
```js
      if (line) line.takeoverPoints = line.points - (line.takeoverPointsAt || 0);
```

`takeoverPointsAt` is initialised to `0` by `initBoxLine` in Task 4, so a line that never takes over reports `0` rather than `undefined`.

- [ ] **Step 4: Read the dials in `simEnginePossession.js`**

At the top of `simulatePossession`, after the `gamePeriod` line:

```js
  // The two live takeovers, already resolved to offense/defense by gameSim.js.
  // Absent for every caller that does not pass gameCtx, which is what keeps
  // pre-ultimates callers behaving exactly as before.
  const tkOff = gameCtx && gameCtx.takeovers ? gameCtx.takeovers.offense : null;
  const tkDef = gameCtx && gameCtx.takeovers ? gameCtx.takeovers.defense : null;
  const offDial = tkOff ? tkOff.effect : {};
  const defDial = tkDef ? tkDef.effect : {};
  // A solo takeover names one player; a team takeover applies to all five.
  const soloId = tkOff && tkOff.kind === 'solo' ? tkOff.playerId : null;
  const teamOn = !!(tkOff && tkOff.kind === 'team');
```

**Shooter pick** — replace the existing `const shooter = weightedPick(...)` line:
```js
  // shotShare and shotCeiling: the holder is picked far more often, and the
  // 50% ceiling lifts FOR HIM ONLY, for the duration only. Without the ceiling
  // lift the boost saturates silently and no amount of tuning reaches the band.
  const shooterWeight = soloId && offDial.shotShare
    ? function (p) {
        const w = _POSS_DATA.box.scoringWeight(p);
        return p.id === soloId ? w * offDial.shotShare : w;
      }
    : _POSS_DATA.box.scoringWeight;
  const shooterCeiling = soloId && offDial.shotCeiling
    ? Math.max(PICK_CEILING.shooter, offDial.shotCeiling)
    : PICK_CEILING.shooter;
  const shooter = weightedPick(offense, energyAware(shooterWeight, offenseBox, false), rng, PICK_POWER.shooter, shooterCeiling);
```

**Zone pick** — replace `const zone = pickShotZone(shooter, rng, inTransition);`:
```js
  const zoneBias = (soloId && shooter.id === soloId) ? offDial.zoneBias : null;
  const zone = pickShotZone(shooter, rng, inTransition, zoneBias);
```

And extend `pickShotZone`'s signature (line 269) to accept and apply the bias. Inside it, after the zone weights are computed and before they are normalised, multiply each by its bias:
```js
  if (bias) {
    if (bias.three) weights.three *= bias.three;
    if (bias.mid) weights.mid *= bias.mid;
    if (bias.inside) weights.inside *= bias.inside;
  }
```
(Use the actual local variable names in `pickShotZone`; the three zone keys are `'three'`, `'mid'`, `'inside'` as used by `pickShotZone`'s existing return values.)

**Shot make** — pass the dials into `shotMakeSpecFor` and push a named modifier. Extend the call:
```js
  const shotCheck = _POSS_DATA.check.skillCheck(shotMakeSpecFor(shooter, shotDefender, zone,
    offSyn.offense, defSyn.defense,
    energyMultiplier(offenseBox[shooter.id].energy),
    energyMultiplier(defenseBox[shotDefender.id].energy) * foulTroubleMultiplier(defenseBox[shotDefender.id].fouls),
    scoreDiff, gamePeriod, takeoverShotModifiers(shooter, zone, soloId, teamOn, offDial, defDial)), rng);
```

Add the modifier builder above `shotMakeSpecFor`:
```js
// The takeover's contribution to a shot, as a NAMED modifier. skillCheck sums
// modifiers into the probability and returns them on the result, and the
// expandable play-by-play already renders that list — so a takeover explains
// itself on screen through machinery that already exists, rather than being an
// invisible thumb on the scale.
const ZONE_MAKE_DIAL = { three: 'makeThree', mid: 'makeMid', inside: 'makeInside' };

function takeoverShotModifiers(shooter, zone, soloId, teamOn, offDial, defDial) {
  const mods = [];
  if (soloId && shooter.id === soloId) {
    const v = offDial[ZONE_MAKE_DIAL[zone]];
    if (v) mods.push({ label: 'Takeover', value: v });
  }
  if (teamOn && offDial.teamMake) mods.push({ label: 'Team takeover', value: offDial.teamMake });
  if (defDial.oppMake) mods.push({ label: 'Opponent takeover', value: defDial.oppMake });
  return mods;
}
```

In `shotSpec`/`shotMakeSpecFor`, accept the new trailing `extraModifiers` argument and concatenate it onto the `modifiers` array the spec already builds. Default it to `[]` so every existing caller is byte-identical.

**Turnover** — extend the call:
```js
  const turnoverCheck = _POSS_DATA.check.skillCheck(
    turnoverSpecFor(onBallDefender, handler, defSyn.defense, offSyn.offense,
      takeoverTurnoverModifiers(handler, soloId, teamOn, offDial, defDial)), rng);
```
with:
```js
function takeoverTurnoverModifiers(handler, soloId, teamOn, offDial, defDial) {
  const mods = [];
  if (soloId && handler.id === soloId && offDial.turnover) {
    mods.push({ label: 'Takeover', value: offDial.turnover });
  }
  if (teamOn && offDial.teamTurnover) mods.push({ label: 'Team takeover', value: offDial.teamTurnover });
  // Clamps: the defending side's holder forces the ball loose. Applies whoever
  // is handling, because he is the one guarding the ball.
  if (defDial.oppTurnover) mods.push({ label: 'Clamps', value: defDial.oppTurnover });
  return mods;
}
```
and the same `extraModifiers` treatment on `turnoverSpec`/`turnoverSpecFor`.

**Block** — extend `blockSpecFor(shotDefender, zone)` with a modifiers argument, and pass:
```js
  const blockCheck = _POSS_DATA.check.skillCheck(
    blockSpecFor(shotDefender, zone,
      (tkDef && tkDef.effect.block && (tkDef.kind === 'team' || shotDefender.id === tkDef.playerId))
        ? [{ label: 'Takeover', value: tkDef.effect.block }] : []), rng);
```

**Foul rate** — replace `if (rng() < shootingFoulRate(shotDefender)) {`:
```js
  const foulMult = (soloId && shooter.id === soloId && offDial.foulRate) ? offDial.foulRate : 1;
  if (rng() < shootingFoulRate(shotDefender) * foulMult) {
```
and inside, apply `makeFt` to the free-throw percentage by adding it to `ftPct` before the clamp:
```js
    const ftBoost = (soloId && shooter.id === soloId && offDial.makeFt) ? offDial.makeFt : 0;
    const ftPct = Math.max(0.45, Math.min(0.95,
      FT_BASE + (shooter.attributes.freeThrow - 50) / FT_DIV +
      _POSS_DATA.traits.shotQualityBonus(shooter, 'ft') / SHOT_TRAIT_DIV + ftBoost));
```

**Rebounds** — in both rebound picks, multiply the holder's weight:
```js
  const reboundWeightFor = (soloId && offDial.reboundShare)
    ? function (p) {
        const w = reboundCompositeWeight(p);
        return p.id === soloId ? w * offDial.reboundShare : w;
      }
    : reboundCompositeWeight;
```
Use `reboundWeightFor` in the offensive-rebound pick. For the defensive-rebound pick the holder is on the defending side, so use the `tkDef`-derived equivalent — build a second closure `defReboundWeightFor` keyed off `tkDef.playerId` and `tkDef.effect.reboundShare`.

**Energy** — replace the two `drainEnergy(offenseBox[...], ...)` calls for the shooter and handler so the holder's drain scales:
```js
function drainEnergyScaled(box, player, mult) {
  if (mult === 1 || mult === undefined) return drainEnergy(box, player);
  const before = box.energy;
  drainEnergy(box, player);
  box.energy = before - (before - box.energy) * mult;
}
```
Apply `offDial.energyDrain` to the holder and `offDial.matchupDrain` to his on-ball defender:
```js
  drainEnergyScaled(offenseBox[handler.id], handler,
    (soloId && handler.id === soloId && offDial.energyDrain !== undefined) ? offDial.energyDrain : 1);
  drainEnergyScaled(defenseBox[onBallDefender.id], onBallDefender,
    (soloId && handler.id === soloId && offDial.matchupDrain) ? offDial.matchupDrain : 1);
```

- [ ] **Step 5: Run the test**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: PASS, with `checkEveryDialIsReadByTheEngine` reporting every turned dial and `checkATakeoverMovesTheBoxScore` above 50%.

- [ ] **Step 6: Confirm the goldens moved, and only for this reason**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gamesim.js; node scripts/validate-seasonRollover.js
```
Expected: **both FAIL.** That is correct — this is a simulation change. They are regenerated in Task 10, after calibration, not now. Do not regenerate them here; a golden regenerated before the tuning settles has to be regenerated again anyway and hides what moved.

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-skillCheck.js && node scripts/validate-possession.js && node scripts/validate-browserBridges.js
```
Expected: PASS. `validate-skillCheck.js` counts rng draws — if it fails, a dial added or removed a roll, which is the one thing this design forbids.

- [ ] **Step 7: Commit**

```bash
git add simEnginePossession.js gameSim.js scripts/validate-ultimates.js
git commit -m "feat: a takeover leans on the dials the engine already had

Goldens move from here — this is a simulation change. They are regenerated
in the calibration task, not now, so what moved stays visible."
```

---

## Task 7: The coach does not bench a man mid-takeover

**Files:**
- Modify: `gameCoach.js:120` (`decideSubstitutions`)
- Modify: `scripts/validate-gameCoach.js`

**Interfaces:**
- Consumes: `sim.takeovers` from Task 5.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-gameCoach.js` (matching the fixture style already in that file):

```js
// A coach pulling a star mid-takeover for routine rest would be maddening to
// watch and would silently cap the takeover's measured value, which is the
// number Task 8 calibrates against.
function checkNoSubDuringTakeover() {
  const sim = buildCoachFixture();
  const starId = sim.onCourt.home[0];
  // Gas him and push him past his minutes target — every ordinary reason to sit.
  sim.homeBox[starId].energy = 0.10;
  sim.secondsPlayed[starId] = 40 * 60;

  sim.takeovers = { home: null, away: null };
  const without = decideSubstitutions(sim, 'home');
  assert.ok(without.some(function (s) { return s.out === starId; }),
    'fixture is wrong: an exhausted, over-minutes player should normally be subbed');

  sim.takeovers = { home: { playerId: starId, ultimateKey: 'heatCheck', side: 'offense', kind: 'solo', left: 9 }, away: null };
  const during = decideSubstitutions(sim, 'home');
  assert.ok(!during.some(function (s) { return s.out === starId; }),
    'a player mid-takeover must not be benched');

  // But a foul-out is not negotiable.
  sim.homeBox[starId].fouls = 6;
  const fouledOut = decideSubstitutions(sim, 'home');
  assert.ok(fouledOut.some(function (s) { return s.out === starId; }),
    'a fouled-out player leaves the floor regardless of his takeover');
  console.log('checkNoSubDuringTakeover: OK');
}
```

Call it alongside the file's existing checks. If `gameCoach.js` does not already export `decideSubstitutions` and the file has no `buildCoachFixture`, add the export and build the fixture the way the file's existing tests build theirs.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gameCoach.js
```
Expected: FAIL — `a player mid-takeover must not be benched`

- [ ] **Step 3: Add the rule**

In `decideSubstitutions` (`gameCoach.js:120`), immediately after the function's opening and before the rest/minutes/energy reasons are evaluated, add:

```js
  // A man mid-takeover stays on the floor. Every ordinary reason to sit him —
  // tired, past his minutes target, garbage time — is suspended for the
  // duration. A foul-out is not a reason to rest, it is a rule, so it is
  // deliberately checked BEFORE this and still applies.
  const takingOver = sim.takeovers && sim.takeovers[team] ? sim.takeovers[team].playerId : null;
```

Then, at the point where a candidate is chosen to come out, skip the holder unless he has fouled out:

```js
    if (id === takingOver && lineFor(sim, team, id).fouls < FOUL_OUT) continue;
```

- [ ] **Step 4: Run the tests**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gameCoach.js && node scripts/validate-ultimates.js
```
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add gameCoach.js scripts/validate-gameCoach.js
git commit -m "fix: a coach does not sit a man in the middle of his takeover"
```

---

## Task 8: Calibrate the takeover to its measured bands

**Files:**
- Create: `scripts/probe-ultimates.js`
- Modify: `ultimates.js` (tuning constants only, each gaining its sweep comment)

**Interfaces:**
- Consumes: everything above.
- Produces: measured values for `ULTIMATE_TUNING.gateOverall`, `CHARGE_TUNING.full`, `secondFullMultiplier`, `gains`, `takeoverPossessions`, and the `TAKEOVER_EFFECTS` magnitudes.

**Targets** (from the spec):

| Target | Band |
|---|---|
| Takeovers per game, both teams | ~1.0 |
| Share of star-games producing one | ~50% |
| Two takeovers by one player in one game | ~1 game in 15 |
| Points added to the holder over the stretch | 10-15 |
| Holders league-wide | 30-60 players |

- [ ] **Step 1: Write the probe**

Create `scripts/probe-ultimates.js`:

```js
// Measures the takeover through a REAL season, driven by league.simulateDate.
//
// Never measure this with gameSim.simulateGame in a loop. That path skips
// fatigue, injuries, morale and rotations, and reads roughly 35% low — a rate
// calibrated in the isolated harness lands badly wrong in the actual game.
//
// One season per process. Sweep with:
//   for v in 80 90 100 110; do CHARGE_FULL=$v QUIET=1 node scripts/probe-ultimates.js; done
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const ult = rq('ultimates.js');
const league = rq('league.js');
const schedule = rq('schedule.js');

// Env overrides so a sweep does not need an edit per point.
if (process.env.CHARGE_FULL) ult.CHARGE_TUNING.full = Number(process.env.CHARGE_FULL);
if (process.env.TAKEOVER_POSS) ult.CHARGE_TUNING.takeoverPossessions = Number(process.env.TAKEOVER_POSS);
if (process.env.GATE) ult.ULTIMATE_TUNING.gateOverall = Number(process.env.GATE);

const SEED = Number(process.env.SEED || 4242);
const QUIET = !!process.env.QUIET;

const holders = PLAYERS_2026.filter(function (p) { return ult.hasUltimate(p); });
const byKey = {};
holders.forEach(function (p) {
  const u = ult.ultimateFor(p);
  byKey[u.key] = (byKey[u.key] || 0) + 1;
});

const games = schedule.generateSeasonGames(makeRng(SEED), TEAMS).map(function (g) {
  return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
    played: false, homeScore: null, awayScore: null, boxScore: null,
    isPlayoff: false, seriesId: null };
});
const season = { games: games, currentDay: -1 };
const settings = { leagueYear: 2026 };
const rng = makeRng(SEED);
const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
for (let d = 0; d <= lastDay; d++) league.simulateDate(season, d, settings, rng, null, null);

// Every takeover that happened, mined from the box scores the season produced.
let takeovers = 0, doubles = 0, starGames = 0, starGamesWithOne = 0;
let pointsAdded = [], teamPoints = 0, teamGames = 0;
games.forEach(function (g) {
  if (!g.played || !g.boxScore) return;
  teamPoints += g.homeScore + g.awayScore;
  teamGames += 2;
  ['home', 'away'].forEach(function (side) {
    const lines = g.boxScore[side] || {};
    Object.keys(lines).forEach(function (pid) {
      const line = lines[pid];
      if (!line || line.takeoversUsed === undefined) return;
      const player = PLAYERS_2026.find(function (p) { return p.id === pid; });
      if (!player || !ult.hasUltimate(player)) return;
      starGames += 1;
      if (line.takeoversUsed >= 1) { starGamesWithOne += 1; takeovers += line.takeoversUsed; }
      if (line.takeoversUsed >= 2) doubles += 1;
      if (line.takeoverPoints > 0) pointsAdded.push(line.takeoverPoints);
    });
  });
});

const played = games.filter(function (g) { return g.played; }).length;
const avgAdded = pointsAdded.length
  ? pointsAdded.reduce(function (a, b) { return a + b; }, 0) / pointsAdded.length : 0;

if (QUIET) {
  console.log([process.env.CHARGE_FULL || ult.CHARGE_TUNING.full,
    (takeovers / played).toFixed(3), (starGamesWithOne / Math.max(1, starGames)).toFixed(3),
    (doubles / Math.max(1, played)).toFixed(4), avgAdded.toFixed(1),
    (teamPoints / teamGames).toFixed(2), holders.length].join('\t'));
} else {
  console.log('holders league-wide      ' + holders.length + '  (target 30-60)');
  console.log('  by ultimate            ' + JSON.stringify(byKey));
  console.log('takeovers per game       ' + (takeovers / played).toFixed(3) + '  (target ~1.0)');
  console.log('star-games with one      ' + (100 * starGamesWithOne / Math.max(1, starGames)).toFixed(1) + '%  (target ~50%)');
  console.log('two in one game          1 in ' + (doubles ? (played / doubles).toFixed(1) : '\u221e') + ' games  (target ~15)');
  console.log('points added, average    ' + avgAdded.toFixed(1) + '  (target 10-15)');
  console.log('league pts per team-game ' + (teamPoints / teamGames).toFixed(2) + '  (must not move)');
}
```

- [ ] **Step 2: Record the pre-change baseline for league scoring**

Before tuning anything, get the number the last row must return to. Stash the current build, measure, restore:

```bash
cd "C:/Users/cory/Desktop/nba" && git stash && node scripts/probe-ultimates.js 2>/dev/null | tail -1; git stash pop
```
If the probe cannot run on the stashed build (it requires `ultimates.js`), instead read the league scoring figure from the last recorded balance run and note it in the commit message. Write the baseline number down — Task 9 needs it.

- [ ] **Step 3: Run the probe as built**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-ultimates.js
```
Expected: seven measured lines. None of them will be on target yet.

- [ ] **Step 4: Sweep the gate until holders land in 30-60**

```bash
cd "C:/Users/cory/Desktop/nba" && for g in 85 86 87 88 89; do GATE=$g QUIET=1 node scripts/probe-ultimates.js; done
```
Pick the value whose holder count sits inside 30-60. Set `ULTIMATE_TUNING.gateOverall` to it and replace its comment with the measured table.

- [ ] **Step 5: Sweep the meter size until the rate lands at ~1.0 per game**

```bash
cd "C:/Users/cory/Desktop/nba" && for v in 80 100 120 140 160 200; do CHARGE_FULL=$v QUIET=1 node scripts/probe-ultimates.js; done
```
Columns are: `full`, takeovers/game, star-game share, doubles rate, points added, league scoring, holders. Pick the value giving ~1.0 takeovers per game **and** a star-game share near 50%. If the two disagree, favour the per-game rate and note the divergence.

Set `CHARGE_TUNING.full` and replace its comment with the sweep table.

- [ ] **Step 6: Sweep the effect magnitudes until points added lands in 10-15**

```bash
cd "C:/Users/cory/Desktop/nba" && for p in 14 18 22 26; do TAKEOVER_POSS=$p QUIET=1 node scripts/probe-ultimates.js; done
```
Duration is the cheaper lever and moves points added roughly linearly. Adjust `takeoverPossessions` first; only if it cannot reach the band, scale the `TAKEOVER_EFFECTS` magnitudes.

If points added saturates and will not rise with duration, the shot ceiling is still binding — check that `shotCeiling` is above `PICK_CEILING.shooter` for every usage ultimate (Task 3's `checkUsageUltimatesLiftTheCeiling` guards the table, not the wiring).

Record the sweep in the comment above `TAKEOVER_EFFECTS`.

- [ ] **Step 7: Sweep the second-takeover multiplier to ~1 game in 15**

```bash
cd "C:/Users/cory/Desktop/nba" && for m in 1.3 1.5 1.6 1.8 2.0; do SECOND_MULT=$m QUIET=1 node scripts/probe-ultimates.js; done
```
Add `SECOND_MULT` to the probe's env overrides alongside the others:
```js
if (process.env.SECOND_MULT) ult.CHARGE_TUNING.secondFullMultiplier = Number(process.env.SECOND_MULT);
```

- [ ] **Step 8: Lock the bands into the test suite**

Append to `scripts/validate-ultimates.js`:

```js
// The calibration bands, asserted so a later change cannot quietly break them.
// Bands, not point values — the sim is stochastic and a single-value assertion
// would fail on noise.
function checkHolderCountBand() {
  require(path.join(ROOT, 'teams.js'));
  const traits = require(path.join(ROOT, 'traits.js'));
  require(path.join(ROOT, 'scouting.js'));
  const players = require(path.join(ROOT, 'players-2026.js')).PLAYERS_2026;
  traits.ensureHiddenPlayerData(players);
  const holders = players.filter(function (p) { return ult.hasUltimate(p); });
  assert.ok(holders.length >= 30 && holders.length <= 60,
    'holders league-wide is ' + holders.length + ', outside the 30-60 band');
  // And every ultimate must be held by SOMEBODY, or the taxonomy is decorative.
  const seen = {};
  holders.forEach(function (p) { seen[ult.ultimateFor(p).key] = true; });
  const unheld = ult.ULTIMATE_TAXONOMY.filter(function (u) { return !seen[u.key]; })
    .map(function (u) { return u.key; });
  assert.strictEqual(unheld.length, 0, 'nobody in the league holds: ' + unheld.join(', '));
  console.log('checkHolderCountBand: OK (' + holders.length + ' holders, all 12 held)');
}
```

Add the call above the final log line. If `unheld` is non-empty, widen that ultimate's derivation source rather than deleting the assertion — an ultimate nobody can hold is a promise the reference page would print and the league would never keep.

- [ ] **Step 9: Run the probe and the suite**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-ultimates.js && node scripts/validate-ultimates.js
```
Expected: every probe row on target except `league pts per team-game`, which is still inflated. That is Task 9.

- [ ] **Step 10: Commit**

```bash
git add ultimates.js scripts/probe-ultimates.js scripts/validate-ultimates.js
git commit -m "test: calibrate the takeover to its measured bands

Every tuning constant now carries the sweep that produced it. League
scoring is still inflated — that is the next task, deliberately separate."
```

---

## Task 9: Hold league scoring flat

The governing constraint. Takeovers redistribute scoring toward stars; they must not add scoring to the league.

**Files:**
- Modify: `simEnginePossession.js` (`SHOT_TUNING` base rates only)
- Modify: `scripts/validate-ultimates.js`

- [ ] **Step 1: Measure the gap**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-ultimates.js | tail -2
```
Compare `league pts per team-game` against the baseline recorded in Task 8, Step 2. The difference is what must come back out.

- [ ] **Step 2: Pull ordinary scoring back with the existing sweep tool**

`scripts/sweep-scoring.js` already exists for exactly this. Run it to find the base-rate adjustment that returns league scoring to baseline:

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/sweep-scoring.js
```

Apply the adjustment to `SHOT_TUNING`'s base make rates in `simEnginePossession.js`. Adjust **base rates only** — not the trait divisors, not the urgency table, not the pick powers. Those each carry their own calibration and moving them here would silently invalidate it.

- [ ] **Step 3: Re-measure until scoring returns to baseline**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-ultimates.js
```
Iterate Steps 2-3 until `league pts per team-game` is within 0.5 of the recorded baseline **and** points added is still inside 10-15. If pulling scoring back drags points added below 10, raise `takeoverPossessions` and repeat — the redistribution is the point, so the star's share should rise as the league's total falls.

- [ ] **Step 4: Lock the scoring band**

Append to `scripts/validate-ultimates.js`:

```js
// The governing constraint, asserted. Takeovers redistribute scoring toward
// stars; they do not add scoring to the league. Every balance property already
// measured — a superstar worth ~10 wins alone but ~6 beside another star,
// champions ranking 2nd-3rd, league-best records at 68-76 wins — is measured
// against league scoring, so holding it still is what protects all of them.
//
// The band is +/-1.5 points around the recorded pre-ultimates baseline, which
// is wider than run-to-run noise (measured at +/-0.4 over five seeds) and
// tighter than any change that would move the balance properties.
const LEAGUE_SCORING_BASELINE = null; // <- set to the Task 8 Step 2 figure
const LEAGUE_SCORING_TOLERANCE = 1.5;

function checkLeagueScoringHeldFlat() {
  assert.ok(LEAGUE_SCORING_BASELINE !== null,
    'LEAGUE_SCORING_BASELINE must be set to the measured pre-ultimates figure');
  // Half a season is enough to settle inside the tolerance and keeps the suite
  // fast; the probe runs the full season when a real measurement is wanted.
  const f = gameFixture();
  const league = require(path.join(ROOT, 'league.js'));
  const schedule = require(path.join(ROOT, 'schedule.js'));
  const teams = require(path.join(ROOT, 'teams.js')).TEAMS;
  const games = schedule.generateSeasonGames(f.makeRng(99), teams).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const rng = f.makeRng(99);
  const half = Math.floor(games.reduce(function (m, g) { return Math.max(m, g.day); }, 0) / 2);
  for (let d = 0; d <= half; d++) league.simulateDate(season, d, { leagueYear: 2026 }, rng, null, null);
  let pts = 0, n = 0;
  games.forEach(function (g) { if (g.played) { pts += g.homeScore + g.awayScore; n += 2; } });
  const avg = pts / n;
  assert.ok(Math.abs(avg - LEAGUE_SCORING_BASELINE) <= LEAGUE_SCORING_TOLERANCE,
    'league scoring is ' + avg.toFixed(2) + ', baseline ' + LEAGUE_SCORING_BASELINE +
    ' — takeovers must redistribute scoring, not add it');
  console.log('checkLeagueScoringHeldFlat: OK (' + avg.toFixed(2) + ')');
}
```

Set `LEAGUE_SCORING_BASELINE` to the recorded figure and add the call.

- [ ] **Step 5: Run it**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js && node scripts/probe-ultimates.js
```
Expected: both PASS / on target.

- [ ] **Step 6: Commit**

```bash
git add simEnginePossession.js scripts/validate-ultimates.js
git commit -m "fix: takeovers redistribute scoring toward stars without inflating the league"
```

---

## Task 10: Regenerate the goldens and re-verify the league

The goldens moved for a real reason. Regenerating them records the new truth; re-measuring the balance properties proves the new truth is still a good league.

**Files:**
- Modify: `scripts/fixtures/` (regenerated golden data)

- [ ] **Step 1: Record what the balance properties were**

The recorded bands: a superstar worth ~10 wins alone and ~6 beside another star; champions ranking 2nd-3rd on average; league-best records at 68-76 wins; 2-4 superstars per draft class (the isolated harness reads ~25% low, so aim it at 3.0).

- [ ] **Step 2: Regenerate both goldens**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/gen-gamesim-golden.js && node scripts/gen-rollover-golden.js
```

- [ ] **Step 3: Confirm they now pass**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js
```
Expected: both PASS.

- [ ] **Step 4: Re-measure the balance properties**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-star-value.js && node scripts/probe-superteam.js && node scripts/probe-twenty-seasons.js && node scripts/probe-superstar-rate-fullsim.js
```
Expected: every figure inside its recorded band. Star value should have risen somewhat — that is the feature working — but a superstar worth far more than ~10 wins alone means the takeover is too strong and Task 8's magnitudes come back down.

**Do not proceed past this step with a figure outside its band.** A golden regenerated over a broken league records the break as the new truth.

- [ ] **Step 5: Run the whole suite**

```bash
cd "C:/Users/cory/Desktop/nba" && for f in scripts/validate-*.js; do echo "== $f"; node "$f" 2>&1 | tail -3; done
```
Expected: every validator passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/fixtures
git commit -m "test: regenerate the goldens for the takeover, league re-verified

Star value, superteam returns, twenty-season shape and draft-class quality
all re-measured against their recorded bands, not merely re-recorded."
```

---

## Task 11: Takeovers survive a save

Box scores are pruned to the user's own games at save time, so a takeover that lives only in a box score vanishes for the other 29 teams.

**Files:**
- Modify: `history.js` (`LEAGUE_HISTORY`, `recordTakeovers`)
- Modify: `league.js` (`recordGameResult` — file them alongside feats)
- Modify: `scripts/validate-history.js`

**Interfaces:**
- Produces: `LEAGUE_HISTORY.takeovers` — array of `{ leagueYear, day, playerId, playerName, teamId, ultimateKey, points, period }`; `history.recordTakeovers(boxScore, context)`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-history.js`:

```js
function checkTakeoversAreFiledAndSurvive() {
  const history = require(path.join(ROOT, 'history.js'));
  history.LEAGUE_HISTORY.takeovers.length = 0;
  history.recordTakeovers([
    { playerId: 'p1', playerName: 'Star One', teamId: 'BOS', ultimateKey: 'heatCheck', points: 14, period: 3 }
  ], { leagueYear: 2026, day: 40 });
  assert.strictEqual(history.LEAGUE_HISTORY.takeovers.length, 1);
  const row = history.LEAGUE_HISTORY.takeovers[0];
  assert.strictEqual(row.leagueYear, 2026, 'the season must be stamped on the row');
  assert.strictEqual(row.day, 40, 'and the day');
  assert.strictEqual(row.playerName, 'Star One',
    'the NAME is stored, not just the id — a retired player must still be readable');
  console.log('checkTakeoversAreFiledAndSurvive: OK');
}

// The same failure feats had: a call site that passes no context files rows
// with no season on them, and they are unqueryable forever after.
function checkEveryCallSitePassesContext() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'league.js'), 'utf8');
  const re = /recordTakeovers\(([^;]*?)\)\s*;/g;
  let m, sites = 0;
  while ((m = re.exec(src)) !== null) {
    sites += 1;
    assert.ok(/leagueYear/.test(m[1]), 'a recordTakeovers call site passes no leagueYear');
    assert.ok(/day/.test(m[1]), 'a recordTakeovers call site passes no day');
  }
  assert.ok(sites > 0, 'recordTakeovers is never called — takeovers are not filed at all');
  console.log('checkEveryCallSitePassesContext: OK (' + sites + ' sites)');
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-history.js
```
Expected: FAIL — `Cannot read properties of undefined (reading 'length')`

- [ ] **Step 3: Add the storage**

In `history.js`, add `takeovers: []` to the `LEAGUE_HISTORY` literal alongside `feats: []` and `teamSeasons: []`, and add:

```js
// Filed as games finish, for the same reason feats are: save.js prunes box
// scores to the user's own games, so a takeover by another team is
// unrecoverable after a save/load unless it is stored in its own right.
//
// The player's NAME is stored beside the id because a takeover outlives the
// player — a row that only carries an id becomes unreadable the season he
// retires and the archive stops matching.
function recordTakeovers(rows, context) {
  if (!rows || !rows.length) return;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    LEAGUE_HISTORY.takeovers.push({
      leagueYear: context.leagueYear, day: context.day,
      playerId: r.playerId, playerName: r.playerName, teamId: r.teamId,
      ultimateKey: r.ultimateKey, points: r.points, period: r.period
    });
  }
}
```

Export it. `save.js` needs no change — it serialises the whole `LEAGUE_HISTORY` object and restores it key by key, so a new array saves and loads for free, and an older save missing the key leaves the default empty array in place.

- [ ] **Step 4: File them from every finished game**

`gameSim.js` must surface the takeovers a game produced. In `simulatePossessionGame`'s returned result, add:
```js
    takeovers: sim.takeoverLog,
```
and in `createGameSim`, initialise `sim.takeoverLog = []` and push a row in the expire block built in Task 5:
```js
      sim.takeoverLog.push({ playerId: active.playerId,
        playerName: (sim.byId[active.playerId] || {}).name || active.playerId,
        teamId: side === 'home' ? sim.homeTeamId : sim.awayTeamId,
        ultimateKey: active.ultimateKey,
        points: line ? line.takeoverPoints : 0, period: sim.period });
```

In `league.js`'s `recordGameResult`, beside the existing `recordGameFeats` call:
```js
  if (game.takeovers && game.takeovers.length) {
    _historyDeps().history.recordTakeovers(game.takeovers,
      { leagueYear: context.leagueYear, day: context.day });
  }
```

Use the lazy `_historyDeps()` accessor, not the eager `_LEAGUE_DATA` bridge — `history.js` requires `league.js`, so an eager require here is a cycle.

- [ ] **Step 5: Run the tests**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-history.js && node scripts/validate-save.js && node scripts/validate-ultimates.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add history.js league.js gameSim.js scripts/validate-history.js
git commit -m "feat: a takeover is recorded in league history, so it survives a save"
```

---

## Task 12: The takeover on the live court

**Files:**
- Modify: `ui/pixelHud.js` (the meter bar)
- Modify: `ui/pixelGameView.js` (fire the impact treatment, hold the marker)
- Modify: `ui/pixelChoreographer.js` (carry the takeover flag onto keyframes)
- Modify: `scripts/ui-smoke.js` (browser smoke group)

- [ ] **Step 1: Add the meter to the HUD**

In `ui/pixelHud.js`, add beside `pixelRenderInfoStrip`:

```js
// The ultimate meter, drawn only for on-floor players who HAVE one — stars
// only, so the panel does not become twelve bars. It glows near full, which is
// what gives the viewer a few possessions of "he's about to go off". That
// anticipation is most of the fun; the takeover is the payoff for watching.
function pixelRenderUltimateMeters(el, meters) {
  if (!el) return;
  if (!meters || !meters.length) { el.innerHTML = ''; return; }
  el.innerHTML = meters.map(function (m) {
    const pct = Math.max(0, Math.min(100, Math.round(m.pct * 100)));
    const cls = m.active ? ' ult-meter-active' : (pct >= 85 ? ' ult-meter-ready' : '');
    return '<div class="ult-meter' + cls + '">' +
      '<span class="ult-meter-name">' + escapeHtml(m.playerName) + '</span>' +
      '<span class="ult-meter-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="ult-meter-label">' + escapeHtml(m.ultimateName) + '</span>' +
      '</div>';
  }).join('');
}
```

Use the project's existing HTML-escaping helper from `ui/util.js` — every player name reaches the DOM through it, because a generated name is untrusted text (`validate-uiSafety.js` asserts this).

- [ ] **Step 2: Let `'takeover'` qualify for the impact treatment at every speed**

`ui/pixelImpact.js` gates which kinds earn a freeze by playback speed, in `IMPACT_SPEED_BAR` (line 50). The bar RISES with speed — at 8x only a poster still qualifies. A takeover is rarer than a poster (~1 a game against ~2), so it belongs in every band:

```js
const IMPACT_SPEED_BAR = [
  { maxSpeed: 2, kinds: ['takeover', 'poster', 'ankle', 'block'] },
  { maxSpeed: 4, kinds: ['takeover', 'poster', 'ankle'] },
  { maxSpeed: Infinity, kinds: ['takeover', 'poster'] }
];
```

No other change is needed there: `impactFreezeMs` already returns `0` under `opts.reduceMotion`, so the reduced-motion degradation comes for free and the banner is left to carry the moment alone.

- [ ] **Step 3: Fire it, and hold the marker, in `ui/pixelGameView.js`**

The existing call sites are `armImpactZoom(...)` at line 475 and `startImpact(fr.a.impact, impactRealMs, impactOpts)` at line 480. Add module-level state and a branch beside them:

```js
// Who is mid-takeover on each side, and the banner to draw over the freeze.
// Both are view state only — the sim already decided; this just shows it.
let _takeoverHolders = { home: null, away: null };
let _takeoverBanner = null;
```

Where events are consumed, add:

```js
      if (ev.type === 'takeover-start') {
        // Reuses the comic-panel treatment posters and ankle-breakers already
        // get — freeze, snap zoom, flash, speed lines. A new effect here would
        // fight the established visual language for "this mattered".
        startImpact({ kind: 'takeover', at: spritePosition(ev.playerId) }, impactRealMs, impactOpts);
        _takeoverBanner = ev.ultimateName;
        _takeoverHolders[ev.team] = ev.playerId;
      }
      if (ev.type === 'takeover-end') {
        // Endings are quiet. A fanfare at both ends makes neither read as the
        // moment.
        _takeoverHolders[ev.team] = null;
      }
```

`spritePosition(playerId)` is the view's existing court-position lookup — use whatever `fr.a.dunk.zoomTo` is built from at line 475 rather than computing a position independently. **All draw-position maths lives in `ui/pixelMotion.js`**; import from it, never re-derive it here.

While `_takeoverHolders[side]` names a player, draw that player's sprite with the marker. For a team ultimate mark all five of that side's on-court sprites — the event carries `ultimateKey`, so look the `kind` up in `ULTIMATE_BY_KEY` rather than hard-coding which two are team ultimates.

Draw `_takeoverBanner` over the frozen frame and clear it when the freeze expires.

- [ ] **Step 4: Add a browser smoke group**

In `scripts/ui-smoke.js`, add a group asserting: watching a game where a takeover fires renders a meter element, the banner appears with a real ultimate name, and the banner clears after the takeover ends.

**`ui-smoke.js` is browser-only.** Running it under Node exits 0 and proves nothing. It must be run in a real browser.

- [ ] **Step 5: Verify in a real browser**

Serve on a fresh port with no-store headers — a stale cached script pins an old build and the verification silently tests yesterday's code:

```bash
cd "C:/Users/cory/Desktop/nba" && python scripts/devserver.py 8137
```

Watch a game featuring a star. Confirm: the meter appears and fills, it glows before firing, the banner names the ultimate, the marker rides the player for the stretch, and it clears at the end. Take a screenshot of the takeover firing.

- [ ] **Step 6: Commit**

```bash
git add ui/pixelHud.js ui/pixelGameView.js ui/pixelImpact.js ui/pixelChoreographer.js scripts/ui-smoke.js
git commit -m "feat: the meter fills on screen and the takeover earns the comic panel"
```

---

## Task 13: The takeover in a game you did not watch

**Files:**
- Modify: `ui/roster.js` or wherever the box score renders (the takeover line)
- Modify: `ui/leagueNews.js` (filtered feed lines)
- Modify: `scripts/validate-leagueNews.js`

- [ ] **Step 1: Write the failing test for the feed filter**

Append to `scripts/validate-leagueNews.js`:

```js
// ~1,230 takeovers a season. A feed line for each is wallpaper, so the bar is
// measured, not picked: the user's own team always gets through, and league-wide
// only the extreme few.
function checkTakeoverFeedIsFiltered() {
  const news = require(path.join(ROOT, 'leagueNews.js'));
  const ordinary = { teamId: 'LAL', points: 11, ultimateKey: 'heatCheck', playerName: 'A' };
  const extreme = { teamId: 'LAL', points: 28, ultimateKey: 'heatCheck', playerName: 'B' };
  assert.strictEqual(news.takeoverIsNewsworthy(ordinary, 'BOS'), false,
    'an ordinary takeover by another team is not news');
  assert.strictEqual(news.takeoverIsNewsworthy(ordinary, 'LAL'), true,
    'the user\'s own team always gets through');
  assert.strictEqual(news.takeoverIsNewsworthy(extreme, 'BOS'), true,
    'an extreme takeover is news regardless of team');
  console.log('checkTakeoverFeedIsFiltered: OK');
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-leagueNews.js
```
Expected: FAIL — `news.takeoverIsNewsworthy is not a function`

- [ ] **Step 3: Add the filter**

```js
// Measured, not picked: at a 20-point bar the feed carried 41 league-wide lines
// a season (~1 every other week); at 15 it carried 190 (~2-3 a week); at 12 it
// carried 612, which is wallpaper. Set in Task 13 against a full season and
// re-measurable with scripts/probe-ultimates.js.
const TAKEOVER_NEWS_POINTS = 20;

function takeoverIsNewsworthy(row, userTeamId) {
  if (!row) return false;
  if (row.teamId === userTeamId) return true;
  return (row.points || 0) >= TAKEOVER_NEWS_POINTS;
}
```

Measure the bar by counting how many rows a full season's `LEAGUE_HISTORY.takeovers` clears at 12 / 15 / 20 / 25, and set it where the league-wide count lands at a few a week. Replace the comment with the real measured table.

- [ ] **Step 4: Add the box-score line and the marked play-by-play**

Under each player's box-score row, when `line.takeoversUsed > 0`, render what he did during the takeover and when. In the play-by-play, bracket the plays between `takeover-start` and `takeover-end` with a labelled section so a skipped game shows where the run was.

- [ ] **Step 5: Run the tests and verify in the browser**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-leagueNews.js && node scripts/validate-ultimates.js
```

Then in a browser on a fresh port, sim a week and confirm: the feed carries a few takeover lines and not a hundred, and opening a simmed game's box score shows the takeover line and the marked play-by-play section.

- [ ] **Step 6: Commit**

```bash
git add ui/leagueNews.js ui/roster.js scripts/validate-leagueNews.js
git commit -m "feat: a takeover you did not watch still shows up in the box score and the feed"
```

---

## Task 14: The player's ultimate, and the reference page

**Files:**
- Modify: `ui/playerProfile.js`
- Create: `ui/ultimates.js`
- Modify: `ui/nav.js`, `index.html`
- Modify: `scripts/validate-ultimates.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-ultimates.js`:

```js
// The reference page must READ the taxonomy, never restate it. The badge
// reference already works this way, and it is why a retuned badge updates its
// own documentation and can never describe an effect it does not have.
function checkReferencePageRestatesNothing() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'ui', 'ultimates.js'), 'utf8');
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(src.indexOf("'" + u.name + "'") === -1 && src.indexOf('"' + u.name + '"') === -1,
      'ui/ultimates.js hard-codes the name "' + u.name + '" instead of reading the taxonomy');
  });
  assert.ok(/ULTIMATE_TAXONOMY/.test(src), 'ui/ultimates.js must read ULTIMATE_TAXONOMY');
  console.log('checkReferencePageRestatesNothing: OK');
}

// Every ultimate needs a sentence a player can read. A missing one must fail
// here rather than render a blank row.
function checkEveryUltimateHasADescription() {
  const desc = ult.ULTIMATE_DESCRIPTIONS;
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(desc[u.key] && desc[u.key].length > 10,
      u.key + ' has no description — the reference page would render a blank row');
  });
  assert.strictEqual(Object.keys(desc).length, ult.ULTIMATE_TAXONOMY.length,
    'a description exists for an ultimate that does not');
  console.log('checkEveryUltimateHasADescription: OK');
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js
```
Expected: FAIL — `Cannot find module '.../ui/ultimates.js'`

- [ ] **Step 3: Add descriptions to `ultimates.js`**

```js
// One sentence per ultimate, in the player's words. The reference page reads
// these rather than restating what an ultimate does, so an ultimate whose dials
// are retuned cannot end up described as doing something it no longer does.
const ULTIMATE_DESCRIPTIONS = {
  heatCheck: 'Starts hunting threes, and they start dropping.',
  silky: 'Pull-ups from everywhere inside the arc begin to fall.',
  paintBeast: 'Bullies the rim — shots inside, and trips to the line.',
  downhill: 'Gets to the basket at will, and stops coughing the ball up.',
  aboveTheRim: 'Dunks, put-backs and chase-down blocks.',
  andOne: 'Stops settling and goes through people. The free throws pile up.',
  glassWrecker: 'Owns the boards, and cleans up his own team\u2019s misses.',
  coldBlooded: 'The fourth quarter arrives and everything goes in.',
  clamps: 'Takes the other team\u2019s ball-handler out of the game.',
  motorNeverStops: 'He stops getting tired. The man guarding him does not.',
  floorGeneral: 'All five on the floor shoot better and stop turning it over.',
  theWall: 'The other team\u2019s shots stop falling.'
};
```
Export it.

- [ ] **Step 4: Build the reference page**

Create `ui/ultimates.js`, modelled on `ui/badges.js`: every row's name, description, dials and holders read from `ULTIMATE_TAXONOMY`, `ULTIMATE_DESCRIPTIONS`, `TAKEOVER_EFFECTS` and a live count over `PLAYERS_2026`. Nothing about an ultimate's effect is written in prose in this file.

Add it to `index.html` and to the nav beside the badge reference.

- [ ] **Step 5: Add the profile section**

In `ui/playerProfile.js`, for a player with an ultimate: its name, its description, the number of times he has triggered it this season and his best one, both queried from `LEAGUE_HISTORY.takeovers`. For a player without one, render nothing — an empty "no ultimate" box on 400 players is noise.

- [ ] **Step 6: Run the tests and verify in the browser**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/validate-ultimates.js && node scripts/validate-uiSafety.js && node scripts/validate-browserBridges.js
```

Then in a browser: open the reference page and confirm all twelve render with holders; open a star's profile and confirm the ultimate section appears; open a non-star's and confirm it does not.

- [ ] **Step 7: Commit**

```bash
git add ultimates.js ui/ultimates.js ui/playerProfile.js ui/nav.js index.html scripts/validate-ultimates.js
git commit -m "feat: a player's ultimate on his profile, and a reference that reads the taxonomy"
```

---

## Task 15: Whole-feature verification

- [ ] **Step 1: Run the whole suite from a clean tree**

```bash
cd "C:/Users/cory/Desktop/nba" && git status -sb && for f in scripts/validate-*.js; do echo "== $f"; node "$f" 2>&1 | tail -3; done
```
Expected: working tree clean, every validator passes.

- [ ] **Step 2: Verify from a fresh clone**

An uncommitted file that the suite depends on passes locally and fails for everyone else:

```bash
cd /tmp && rm -rf nba-verify && git clone -b live-game-sim "C:/Users/cory/Desktop/nba" nba-verify && cd nba-verify && for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```
Expected: no `FAIL` lines.

- [ ] **Step 3: Re-run every calibration probe**

```bash
cd "C:/Users/cory/Desktop/nba" && node scripts/probe-ultimates.js && node scripts/probe-star-value.js && node scripts/probe-twenty-seasons.js
```
Expected: every figure inside its band, league scoring at baseline.

- [ ] **Step 4: Play it**

On a fresh port with no-store headers, start a new league and play a week:

```bash
cd "C:/Users/cory/Desktop/nba" && python scripts/devserver.py 8141
```

Confirm end to end: a star's meter fills while you watch; the takeover fires with the banner and the marker; the box score of a game you simmed carries a takeover line; the feed carries a few takeover items and not a hundred; the reference page lists twelve ultimates with real holders; a star's profile shows his; saving and reloading keeps the season's takeover history.

- [ ] **Step 5: Commit anything the verification turned up, then report**

Report the measured figures — takeovers per game, points added, league scoring against baseline, star value — not merely that the tests passed.
