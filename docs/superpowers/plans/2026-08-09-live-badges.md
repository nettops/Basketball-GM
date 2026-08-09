# Live Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 48 traits affect the default engine — wiring the 15 that are currently byte-identical to no-trait — and surface defensive impact as a real stat.

**Architecture:** Badges become named entries in `skillCheck` `modifiers[]` arrays rather than terms bolted onto hand-rolled formulas, so each is calibrated in one place and displayed for free by the breakdowns already shipped. Defence mirrors the scoring pattern exactly: `defenseQualityBonus(player, zone)` routed by the trait's own `affinity`, plus an allocation path so good defenders draw more assignments. Chemistry feeds `computeTeamSynergy`, which already reaches the engine.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Dual `require`/browser-global module pattern. Node validators under `scripts/`.

## Global Constraints

- **Zero dependencies.** No packages, no build step.
- **Dual module pattern.** Every file ends with `if (typeof module !== 'undefined' && module.exports) { ... }`. Browser-global branches list globals BY HAND — a function used in `simEnginePossession.js` must be added to its `_POSS_DATA` else-branch or it is a browser-only runtime error Node cannot catch.
- **Rate-neutral.** League FG% **46.8**, 3P% **36.6**, 3PA share **30.0%**, pts/team **103.3** must hold within ±0.4 / ±0.4 / ±1.0pp / ±1.5 after calibration. These are the locked targets from `scripts/measure-identity.js`.
- **Goldens WILL move.** Unlike the skill-check refactor, this changes behaviour on purpose. Regenerate both at Task 6 and **only** at Task 6, after calibration settles.
- **Block rate stays parked.** Do not change `BLOCK_BASE`. Wiring block badges is in scope; rebalancing the block rate is not.
- **Calibrate by measured rate, never by picked values.** Record every sweep in the commit message.
- **Never widen a bound to make a change pass.**
- **Every new assertion is mutation-tested.** Verify each mutant is actually on disk before believing it survived — a substitution that fails to match looks identical to a survivor. Use single-line patterns; the files are CRLF.
- **`git add` explicit paths only.** Never `git add -A`.
- **Commit with `git commit -F <file>`** — PowerShell mangles multi-line `-m`.
- Full suite: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/validate-traitsAreLive.js` (new) | The tripwire. Every `(system, stat)` family must move a player's line. No exemptions. |
| `traits.js` (modify) | `defenseQualityBonus(player, zone)`, `foulProneness(player)`, `chemistryBonus(roster)`. Pure, no engine knowledge. |
| `simEnginePossession.js` (modify) | Rate paths (defence/steal/block/foul) as modifiers; allocation paths as named weight functions. |
| `compositeRatings.js` (modify) | `computeTeamSynergy(roster, team)` gains the chemistry term. |
| `simEngineBoxScore.js` (modify) | `initBoxLine` gains `oppFga` / `oppFgm`. |
| `league.js` (modify) | `SEASON_STAT_KEYS` gains the two new keys. |
| `ui/schedule.js`, `ui/playerProfile.js` (modify) | DFG% column; badge rename and reveal. |
| `scouting.js` (modify) | Badges leave the confidence gate; prospects stay fuzzy. |

---

### Task 1: The tripwire that fails on 15 traits

**Files:**
- Create: `scripts/validate-traitsAreLive.js`

**Interfaces:**
- Produces: nothing consumed by later tasks. This is the test that drives every task after it.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-traitsAreLive.js`:

```js
// THE TRIPWIRE. The bug this exists for is not "defense is unwired" — it is
// "a trait family can be silently dead and nothing notices". Fifteen traits sat
// dead through seven calibration tasks without a single test complaining,
// because every test asserted on league rates and a dead trait moves no rate.
//
// For each (system, stat) family in the taxonomy, give ONE player a legendary
// trait from that family and assert their own line moves against a seed-matched
// control. Byte-identical output means the code path never consulted the trait.
//
// NO EXEMPTIONS. The family list is derived from TRAIT_TAXONOMY itself, so a
// family cannot be dropped from coverage by deleting a row here, and a family
// added to the taxonomy is covered the day it appears.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

const fatigue = require(path.join(__dirname, '..', 'fatigue.js'));
const injuries = require(path.join(__dirname, '..', 'injuries.js'));
const progression = require(path.join(__dirname, '..', 'progression.js'));

const SUBJECT_TEAM = 'BOS';
const GAMES = 400;
const SEED = 31337;

// EACH FAMILY NEEDS THE RIGHT PROBE. An earlier draft of this file measured
// every family through a season's box-score lines, which would have reported
// injury, fatigue and progression as DEAD — not because they are unwired, but
// because none of them writes a box-score stat. A test that cannot observe a
// system will always call it dead, and "the test was looking in the wrong
// place" is indistinguishable from a real bug until someone checks.
//
// So each family declares HOW it is observed. Box-score families share the
// season probe; the rest are measured where they actually act.
const PROBES = {
  boxscore: 'season',
  fatigue: 'fatigue',
  injury: 'injury',
  chemistry: 'season',        // reaches the sim through team synergy
  progression: 'progression'
};

// Every distinct (system, stat) pair the taxonomy declares, each paired with a
// representative trait key. Derived, not hand-listed, so a family added to the
// taxonomy is covered the day it appears and fails until it is wired.
function familiesFromTaxonomy() {
  const byFamily = {};
  traits.TRAIT_TAXONOMY.forEach(function (t) {
    const key = t.effect.system + '/' + t.effect.stat;
    // Prefer a POSITIVE trait as the representative: a negative one proves the
    // same wiring but reads confusingly in a failure message.
    if (!byFamily[key] || (byFamily[key].direction < 0 && t.effect.direction > 0)) {
      byFamily[key] = { key: t.key, name: t.name, direction: t.effect.direction, system: t.effect.system };
    }
  });
  return byFamily;
}

// A mid-rotation player has room to move in both directions; the best player on
// the roster already takes every shot and the worst never plays.
function pickSubject() {
  return league.getTeamRoster(SUBJECT_TEAM)
    .slice().sort(function (a, b) { return b.overall - a.overall; })[4];
}

function withTrait(subject, traitKey, fn) {
  const saved = subject.hiddenTraits;
  subject.hiddenTraits = traitKey === null ? [] : [{ key: traitKey, tier: 'legendary' }];
  try { return fn(); } finally { subject.hiddenTraits = saved; }
}

// Box-score probe: the subject's own season line.
function probeSeason(subject) {
  const rng = makeRng(SEED);
  const t = { min: 0, pts: 0, fga: 0, fgm: 0, ast: 0, reb: 0, stl: 0, blk: 0, oppFga: 0, oppFgm: 0, fouls: 0 };
  const FIELD = { min: 'minutes', pts: 'points', ast: 'assists', reb: 'rebounds', stl: 'steals', blk: 'blocks' };
  let games = 0;
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length], away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    if (home.id !== SUBJECT_TEAM && away.id !== SUBJECT_TEAM) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    const l = r.boxScore[subject.id];
    if (!l) continue;
    games += 1;
    Object.keys(t).forEach(function (k) { t[k] += l[FIELD[k] || k] || 0; });
  }
  t.games = games;
  return t;
}

// Fatigue probe: run one team-game of fatigue accumulation and read the result.
function probeFatigue(subject) {
  subject.status.fatigue = 0;
  const minutes = {};
  league.getTeamRoster(SUBJECT_TEAM).forEach(function (p) { minutes[p.id] = 30; });
  fatigue.applyFatigueForGame(SUBJECT_TEAM, minutes, false);
  const out = { fatigue: subject.status.fatigue };
  subject.status.fatigue = 0;
  return out;
}

// Injury probe: injuries are rare, so roll many times at a fixed seed and count.
// Both chance and recovery show up here — chance in how many injuries land,
// recovery in how long they last.
function probeInjury(subject) {
  const rng = makeRng(SEED);
  const savedInjury = subject.status.injury;
  let count = 0, totalGamesOut = 0;
  for (let i = 0; i < 40000; i++) {
    subject.status.injury = null;
    injuries.rollInjury(subject, rng);
    if (subject.status.injury) {
      count += 1;
      totalGamesOut += Math.min(200, subject.status.injury.gamesRemaining);
    }
  }
  subject.status.injury = savedInjury;
  return { injuries: count, gamesOut: totalGamesOut };
}

// Progression probe: one offseason of development at a fixed seed. Sums the
// attributes, because which attribute moves is not the point — that it moves is.
function probeProgression(subject) {
  const copy = JSON.parse(JSON.stringify({ attributes: subject.attributes, status: subject.status,
    age: subject.age, potential: subject.potential, teamId: null, id: subject.id, name: subject.name }));
  copy.hiddenTraits = subject.hiddenTraits;
  copy.hiddenPersonality = subject.hiddenPersonality;
  progression.progressPlayer(copy, makeRng(SEED), [], { suppressPotentialPull: false });
  let sum = 0;
  Object.keys(copy.attributes).forEach(function (k) { sum += copy.attributes[k]; });
  return { attributeSum: sum };
}

const PROBE_FN = {
  season: probeSeason,
  fatigue: probeFatigue,
  injury: probeInjury,
  progression: probeProgression
};

function checkEveryFamilyIsLive() {
  const subject = pickSubject();
  const families = familiesFromTaxonomy();
  const dead = [];
  const live = [];

  Object.keys(families).sort().forEach(function (family) {
    const rep = families[family];
    const probeName = PROBES[rep.system];
    assert.ok(probeName, 'no probe declared for system "' + rep.system +
      '" — a new trait system needs a way to observe it, or this test cannot tell wired from dead');
    const probe = PROBE_FN[probeName];

    const control = withTrait(subject, null, function () { return probe(subject); });
    const treated = withTrait(subject, rep.key, function () { return probe(subject); });
    const moved = Object.keys(control).some(function (k) {
      return k !== 'games' && Math.abs(treated[k] - control[k]) > 1e-9;
    });
    if (moved) live.push(family); else dead.push(family + ' (' + rep.name + ', probe: ' + probeName + ')');
  });

  assert.strictEqual(dead.length, 0,
    dead.length + ' trait families are byte-identical to no-trait — the traits exist, ' +
    'the sim never reads them:\n  ' + dead.join('\n  '));
  console.log('checkEveryFamilyIsLive: OK (' + live.length + ' families, subject ' + subject.name + ')');
}

checkEveryFamilyIsLive();
console.log('All traits-are-live validations passed');
```

- [ ] **Step 2: Run it and record exactly which families are dead**

```bash
node scripts/validate-traitsAreLive.js
```

Expected: FAIL listing four families —
`boxscore/block`, `boxscore/defense`, `boxscore/steal`, `chemistry/team`.

Copy the exact failure text into the commit message. It is the before-state this whole plan is judged against.

- [ ] **Step 3: Commit the failing test**

Commit the test on its own, red, so the wiring commits each show it going greener.

```bash
git add scripts/validate-traitsAreLive.js
git commit -F commit-msg.txt
```

Message: `test: assert every trait family actually reaches the sim (currently 4 do not)`. Note in the body that the suite is intentionally red at this commit.

---

### Task 2: The pure routing functions

**Files:**
- Modify: `traits.js` (add after `shotQualityBonus`, currently ends line 233)
- Modify: `scripts/validate-traits.js` (append)

**Interfaces:**
- Produces: `defenseQualityBonus(player, zone)` → number ≥ 0 (points to SUBTRACT from a shooter's chance); `foulProneness(player)` → number ≥ 0 (points of foul-drawing); `chemistryBonus(roster)` → number (summed team chemistry badge points, may be negative). All exported.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-traits.js`, above its final `console.log`:

```js
// Defence mirrors shotQualityBonus: routed by the trait's own affinity so a
// perimeter stopper does not suddenly protect the rim.
function checkDefenseQualityBonusRoutesByZone() {
  const lockdown = { hiddenTraits: [{ key: 'lockdownDefender', tier: 'legendary' }] };   // perimeterDefense
  const anchor = { hiddenTraits: [{ key: 'defensiveAnchor', tier: 'legendary' }] };      // interiorDefense

  assert.ok(traitsModule.defenseQualityBonus(lockdown, 'three') > 0, 'a perimeter stopper must affect threes');
  assert.ok(traitsModule.defenseQualityBonus(lockdown, 'mid') > 0, 'a perimeter stopper must affect mid-range');
  assert.strictEqual(traitsModule.defenseQualityBonus(lockdown, 'inside'), 0,
    'a PERIMETER defender must not protect the rim — that is what routing is for');

  assert.ok(traitsModule.defenseQualityBonus(anchor, 'inside') > 0, 'an interior anchor must affect inside shots');
  assert.strictEqual(traitsModule.defenseQualityBonus(anchor, 'three'), 0,
    'an INTERIOR defender must not contest threes');
  console.log('checkDefenseQualityBonusRoutesByZone: OK');
}

// Positives with no defensive-zone meaning are allocation-only, exactly as
// unrouted scoring traits are volume-only. Charge Taker (basketballIQ) and
// Two-Way Star (no affinity) earn more assignments; they do not improve the
// contest itself.
function checkUnroutedDefendersAreAllocationOnly() {
  ['chargeTaker', 'twoWayStar'].forEach(function (key) {
    const p = { hiddenTraits: [{ key: key, tier: 'legendary' }] };
    ['three', 'mid', 'inside'].forEach(function (zone) {
      assert.strictEqual(traitsModule.defenseQualityBonus(p, zone), 0,
        key + ' has no defensive zone and must contribute nothing to shot quality');
    });
  });
  console.log('checkUnroutedDefendersAreAllocationOnly: OK');
}

// Foul Prone is the ONE deliberate break from the scoring precedent. Under that
// precedent a negative applies to every zone — which for a defence trait would
// mean opponents SHOOT BETTER against you, a poor model of what fouling is. It
// routes to the foul rate instead, so it must contribute nothing to shot quality.
function checkFoulProneRoutesToFoulsNotShotQuality() {
  const p = { hiddenTraits: [{ key: 'foulProne', tier: 'legendary' }] };
  ['three', 'mid', 'inside'].forEach(function (zone) {
    assert.strictEqual(traitsModule.defenseQualityBonus(p, zone), 0,
      'Foul Prone must not make opponents shoot better — it makes you foul');
  });
  assert.ok(traitsModule.foulProneness(p) > 0, 'Foul Prone must raise foul-drawing');
  assert.strictEqual(traitsModule.foulProneness({ hiddenTraits: [{ key: 'lockdownDefender', tier: 'legendary' }] }), 0,
    'a clean defender must not draw extra fouls');
  console.log('checkFoulProneRoutesToFoulsNotShotQuality: OK');
}

// Chemistry is a TEAM property, so it sums across the roster and both signs count.
function checkChemistryBonusSumsAcrossTheRoster() {
  const leaderA = { hiddenTraits: [{ key: 'naturalLeader', tier: 'legendary' }] };
  const leaderB = { hiddenTraits: [{ key: 'naturalLeader', tier: 'legendary' }] };
  const cancer = { hiddenTraits: [{ key: 'lockerRoomCancer', tier: 'legendary' }] };
  const plain = { hiddenTraits: [] };

  assert.strictEqual(traitsModule.chemistryBonus([plain, plain]), 0);
  const one = traitsModule.chemistryBonus([leaderA, plain]);
  assert.ok(one > 0, 'a Natural Leader must raise team chemistry');
  assert.ok(traitsModule.chemistryBonus([leaderA, leaderB]) > one, 'two leaders must beat one');
  assert.ok(traitsModule.chemistryBonus([cancer, plain]) < 0, 'a Locker Room Cancer must lower it');
  assert.strictEqual(traitsModule.chemistryBonus([leaderA, cancer]), 0, 'equal and opposite must cancel');
  console.log('checkChemistryBonusSumsAcrossTheRoster: OK');
}

checkDefenseQualityBonusRoutesByZone();
checkUnroutedDefendersAreAllocationOnly();
checkFoulProneRoutesToFoulsNotShotQuality();
checkChemistryBonusSumsAcrossTheRoster();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-traits.js
```

Expected: `TypeError: traitsModule.defenseQualityBonus is not a function`

- [ ] **Step 3: Add the three functions to `traits.js`**

Insert immediately after `shotQualityBonus` (which currently ends at line 233):

```js
// Which shot a DEFENSIVE badge contests, routed by the trait's own affinity —
// the exact mirror of SHOT_ZONE_BY_AFFINITY above, and for the same reason. A
// flat `boxscore/defense` bonus would have a perimeter stopper protecting the
// rim, which is the error shotQualityBonus was created to avoid on offence.
const DEFENSE_ZONES_BY_AFFINITY = {
  perimeterDefense: ['three', 'mid'],
  interiorDefense: ['inside']
};

// Points a defender takes OFF the shooter's chance in this zone. Always >= 0;
// the caller subtracts it.
//
// Positives with no defensive zone (Charge Taker's basketballIQ, Two-Way Star's
// absent affinity) return 0 here on purpose and earn their keep through the
// ALLOCATION path instead — they draw tougher assignments rather than making
// each contest better. Same shape as unrouted scoring traits being volume-only.
//
// NEGATIVES ARE EXCLUDED ENTIRELY. Foul Prone is the only one, and under the
// scoring precedent it would apply to every zone — meaning opponents shoot
// BETTER against a foul-prone defender. That is a poor model of what fouling
// is, so it routes to the foul rate through foulProneness() instead. This is
// the one place the offence/defence mirror is deliberately broken.
function defenseQualityBonus(player, zone) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== 'boxscore' || def.effect.stat !== 'defense') return sum;
    if (def.effect.direction < 0) return sum;                 // -> foulProneness
    const zones = DEFENSE_ZONES_BY_AFFINITY[def.affinity];
    if (!zones || zones.indexOf(zone) === -1) return sum;     // -> allocation only
    return sum + def.tierValues[t.tier];
  }, 0);
}

// Magnitude of a defender's foul-drawing badges. Always >= 0; the caller adds
// it to the shooting-foul rate. Only negative `boxscore/defense` traits count —
// a good defender is not rewarded with fewer fouls here, because that would
// quietly make every positive defence badge a second, hidden effect.
function foulProneness(player) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== 'boxscore' || def.effect.stat !== 'defense') return sum;
    if (def.effect.direction > 0) return sum;
    return sum + def.tierValues[t.tier];
  }, 0);
}

// Team chemistry badges, summed across a roster. Signed: Natural Leader and
// Franchise Cornerstone raise it, Locker Room Cancer lowers it. Team-level by
// nature, which is why it feeds computeTeamSynergy rather than any per-player
// weight.
function chemistryBonus(roster) {
  return (roster || []).reduce(function (total, p) {
    return total + getTraitBonus(p, 'chemistry', 'team');
  }, 0);
}
```

- [ ] **Step 4: Export them**

In `traits.js`'s `module.exports`, add alongside `shotQualityBonus`:

```js
    defenseQualityBonus: defenseQualityBonus,
    DEFENSE_ZONES_BY_AFFINITY: DEFENSE_ZONES_BY_AFFINITY,
    foulProneness: foulProneness,
    chemistryBonus: chemistryBonus,
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
node scripts/validate-traits.js
```

Expected: four new `OK` lines.

- [ ] **Step 6: Mutation-test**

| # | Mutation to `traits.js` | Must be caught by |
|---|---|---|
| 1 | `perimeterDefense: ['three', 'mid', 'inside']` | `checkDefenseQualityBonusRoutesByZone` |
| 2 | Delete `if (def.effect.direction < 0) return sum;` from `defenseQualityBonus` | `checkFoulProneRoutesToFoulsNotShotQuality` |
| 3 | `if (!zones \|\| zones.indexOf(zone) === -1) return sum;` → `if (false) return sum;` | `checkUnroutedDefendersAreAllocationOnly` |
| 4 | `foulProneness` returns 0 | `checkFoulProneRoutesToFoulsNotShotQuality` |
| 5 | `chemistryBonus` returns 0 | `checkChemistryBonusSumsAcrossTheRoster` |

- [ ] **Step 7: Commit**

```bash
git add traits.js scripts/validate-traits.js
git commit -F commit-msg.txt
```

---

### Task 3: The four rate paths

**Files:**
- Modify: `simEnginePossession.js` — `shotSpec`, `turnoverSpec`, `blockSpec`, the shooting-foul roll
- Modify: `scripts/validate-skillCheck.js` (its equivalence sweeps must learn the new arguments)

**Interfaces:**
- Consumes: `defenseQualityBonus`, `foulProneness` from Task 2.
- Produces: `shotSpec(zone, shootComposite, defComposite, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult, traitBonus, defTraitBonus)`; `turnoverSpec(defenderSteal, handlerBallHandling, defSynergyDefense, offSynergyOffense, stealTraitBonus)`; `blockSpec(defenderBlock, zone, blockTraitBonus)`.

- [ ] **Step 1: Update the equivalence sweeps to pass zero for the new arguments**

The sweeps in `scripts/validate-skillCheck.js` compare against the ORIGINAL formulas, which had no badge terms. Passing 0 keeps them meaningful — they now prove the refactor is still faithful *when no badges are present*, which is exactly the right invariant.

In `checkTurnoverSpecMatchesTheOriginal`, change the call to:

```js
        const got = skillCheckProbability(poss.turnoverSpec(d, h, 1 + s, 1, 0)).probability;
```

In `checkBlockSpecMatchesTheOriginal`, change both calls to:

```js
    worst = Math.max(worst, Math.abs(skillCheckProbability(poss.blockSpec(b, 'inside', 0)).probability - referenceBlock(b)));
```
```js
  assert.strictEqual(skillCheckProbability(poss.blockSpec(99, 'three', 0)).probability, 0.008);
```

In `checkShotSpecMatchesTheOriginal`, change the call to:

```js
        const got = skillCheckProbability(poss.shotSpec(z[0], s, d, 1.02, 0.98, e, 1, t, 0)).probability;
```

- [ ] **Step 2: Write the failing test**

Append to `scripts/validate-skillCheck.js`, above the final `console.log`:

```js
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

  // The badge term must be a NAMED modifier, not folded into base — the whole
  // point of the modifiers array is that the UI can print "Lockdown Defender".
  const spec = poss.shotSpec('three', 70, 60, 1, 1, 1, 1, 0, 8);
  const labels = spec.modifiers.map(function (m) { return m.label; });
  assert.ok(labels.indexOf('defensive badges') !== -1,
    'the defensive term must be a named modifier, got: ' + labels.join(', '));
  console.log('checkBadgeModifiersReachTheSpecs: OK');
}

checkBadgeModifiersReachTheSpecs();
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
node scripts/validate-skillCheck.js
```

Expected: `AssertionError: a defensive badge must LOWER the shooter's chance` (the extra argument is currently ignored).

- [ ] **Step 4: Add the badge terms to the three specs**

Replace the constants block and `turnoverSpec` signature:

```js
const TURNOVER_BASE = 0.11, TURNOVER_DIV = 400;
const TURNOVER_MIN = 0.04, TURNOVER_MAX = 0.22;
const TURNOVER_SYNERGY_WEIGHT = 0.3;
// Steal badges are worth their points over the same 400 the steal rating uses,
// so a legendary Pickpocket is worth exactly +8 rating points of steal — the
// badge is a modifier on the skill, deliberately not a bigger lever than it.
const STEAL_TRAIT_DIV = TURNOVER_DIV;

function turnoverSpec(defenderSteal, handlerBallHandling, defSynergyDefense, offSynergyOffense, stealTraitBonus) {
  return {
    kind: 'turnover',
    base: TURNOVER_BASE,
    attack: { label: 'steal', value: defenderSteal, scale: TURNOVER_DIV, energy: 1 },
    defend: { label: 'ballHandling', value: handlerBallHandling, scale: TURNOVER_DIV, energy: 1 },
    modifiers: [
      { label: 'team synergy', value: (defSynergyDefense - offSynergyOffense) * TURNOVER_SYNERGY_WEIGHT },
      { label: 'steal badges', value: (stealTraitBonus || 0) / STEAL_TRAIT_DIV }
    ],
    min: TURNOVER_MIN, max: TURNOVER_MAX
  };
}
```

In `blockSpec`, add the parameter and modifier — note the three-point branch gets it too, so a rim protector is not literally unable to block a three:

```js
const BLOCK_TRAIT_DIV = BLOCK_DIV;

function blockSpec(defenderBlock, zone, blockTraitBonus) {
  const badge = { label: 'block badges', value: (blockTraitBonus || 0) / BLOCK_TRAIT_DIV };
  if (zone === 'three') {
    return { kind: 'block', base: BLOCK_THREE_CHANCE, attack: null, defend: null, modifiers: [badge], min: 0, max: 1 };
  }
  return {
    kind: 'block',
    base: BLOCK_BASE,
    attack: { label: 'block', value: defenderBlock, scale: BLOCK_DIV, energy: 1 },
    defend: null,
    modifiers: [badge],
    min: BLOCK_MIN, max: BLOCK_MAX
  };
}
```

In `shotSpec`, add the parameter and the subtracting modifier. `DEF_TRAIT_DIV` starts equal to `SHOT_TRAIT_DIV` so offence and defence badges are symmetric; Task 6 sweeps it:

```js
// Symmetric with SHOT_TRAIT_DIV by default: a legendary defensive badge takes
// off about what a legendary offensive one puts on (~2.7pp on its zone). Swept
// in Task 6 against the locked league rates.
const DEF_TRAIT_DIV = SHOT_TRAIT_DIV;

function shotSpec(zone, shootComposite, defComposite, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult, traitBonus, defTraitBonus) {
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
      { label: 'badges', value: traitBonus / SHOT_TRAIT_DIV },
      // NEGATIVE: this is the defender's contribution, so it comes off.
      { label: 'defensive badges', value: -(defTraitBonus || 0) / DEF_TRAIT_DIV }
    ],
    min: SHOT_MIN, max: SHOT_MAX
  };
}
```

- [ ] **Step 5: Feed the real bonuses at the call sites**

In `shotMakeSpecFor`, add the defensive lookup as the final argument:

```js
    _POSS_DATA.traits.shotQualityBonus(shooter, zone),
    _POSS_DATA.traits.defenseQualityBonus(defender, zone));
```

At the turnover call site:

```js
  const turnoverCheck = _POSS_DATA.check.skillCheck(
    turnoverSpec(onBallDefender.attributes.steal, handler.attributes.ballHandling, defSyn.defense, offSyn.offense,
      _POSS_DATA.traits.getTraitBonus(onBallDefender, 'boxscore', 'steal')), rng);
```

At the block call site:

```js
  const blockCheck = _POSS_DATA.check.skillCheck(
    blockSpec(shotDefender.attributes.block, zone,
      _POSS_DATA.traits.getTraitBonus(shotDefender, 'boxscore', 'block')), rng);
```

For the shooting foul, replace `if (rng() < SHOOTING_FOUL_RATE) {`:

```js
  // Foul Prone routes HERE rather than into shot quality — see traits.js's
  // defenseQualityBonus. A legendary Foul Prone adds 8/FOUL_TRAIT_DIV to the
  // rate, which at 400 is +2pp on a 14% base.
  const foulRate = SHOOTING_FOUL_RATE +
    _POSS_DATA.traits.foulProneness(shotDefender) / FOUL_TRAIT_DIV;
  if (rng() < foulRate) {
```

and add beside `SHOOTING_FOUL_RATE` at line 66:

```js
const FOUL_TRAIT_DIV = 400;
```

- [ ] **Step 6: Add the new traits functions to the browser-global branch**

`simEnginePossession.js`'s `_POSS_DATA` else-branch lists globals BY HAND. Node resolves the whole module; the browser only gets what is listed, so a missing name is a runtime error visible only in the app. Change the traits line to:

```js
      traits: { getTraitBonus: getTraitBonus, shotQualityBonus: shotQualityBonus,
                defenseQualityBonus: defenseQualityBonus, foulProneness: foulProneness },
```

- [ ] **Step 7: Run both validators**

```bash
node scripts/validate-skillCheck.js && node scripts/validate-traitsAreLive.js
```

Expected: `checkBadgeModifiersReachTheSpecs: OK`, the equivalence sweeps still at drift < 1e-12, and `validate-traitsAreLive` now failing on **one** family only — `chemistry/team`.

- [ ] **Step 8: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `value: -(defTraitBonus \|\| 0) / DEF_TRAIT_DIV` → drop the minus | `checkBadgeModifiersReachTheSpecs` |
| 2 | `'defensive badges'` label → `'x'` | the named-modifier assertion |
| 3 | steal badge modifier value → `0` | `checkBadgeModifiersReachTheSpecs` |
| 4 | block badge modifier value → `0` | `checkBadgeModifiersReachTheSpecs` |
| 5 | `foulProneness(shotDefender)` → `0` at the foul site | `validate-traitsAreLive` (defense family) |

- [ ] **Step 9: Commit**

```bash
git add simEnginePossession.js scripts/validate-skillCheck.js
git commit -F commit-msg.txt
```

---

### Task 4: The two allocation paths

**Files:**
- Modify: `simEnginePossession.js` — `perimDefenseWeight`, and the inline shot-defender lambda
- Modify: `scripts/validate-ratings.js` (append)

**Interfaces:**
- Produces: `shotDefenseWeight(player, zone)` exported from `simEnginePossession.js`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-ratings.js`, above its final `console.log`:

```js
// Defensive badges buy ASSIGNMENTS as well as quality: a lockdown defender
// should draw the tough matchup more often, not merely be better when he
// happens to draw it. Without this the badges only ever act on shots the
// defender was already picked for, which is half a mechanic.
function checkDefensiveBadgesDrawAssignments() {
  const poss = require(path.join(__dirname, '..', 'simEnginePossession.js'));
  const traits = require(path.join(__dirname, '..', 'traits.js'));
  const base = { attributes: { perimeterDefense: 60, interiorDefense: 60, steal: 60, block: 60,
    speed: 50, acceleration: 50, strength: 50, basketballIQ: 50, defReb: 50, offReb: 50,
    insideScoring: 50, midRange: 50, threePoint: 50, postScoring: 50, freeThrow: 50,
    passing: 50, ballHandling: 50, vertical: 50, stamina: 50, durability: 50,
    workEthic: 50, leadership: 50 }, hiddenTraits: [] };
  const badged = JSON.parse(JSON.stringify(base));
  badged.hiddenTraits = [{ key: 'lockdownDefender', tier: 'legendary' }];

  assert.ok(poss.shotDefenseWeight(badged, 'three') > poss.shotDefenseWeight(base, 'three'),
    'a perimeter badge must raise the shot-defender pick weight on threes');
  assert.strictEqual(poss.shotDefenseWeight(badged, 'inside'), poss.shotDefenseWeight(base, 'inside'),
    'a PERIMETER badge must not raise the pick weight for inside shots');

  const stealer = JSON.parse(JSON.stringify(base));
  stealer.hiddenTraits = [{ key: 'pickpocket', tier: 'legendary' }];
  assert.ok(poss.perimDefenseWeight(stealer) > poss.perimDefenseWeight(base),
    'a steal badge must raise the on-ball defender pick weight');
  console.log('checkDefensiveBadgesDrawAssignments: OK');
}

checkDefensiveBadgesDrawAssignments();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-ratings.js
```

Expected: `TypeError: poss.shotDefenseWeight is not a function`

- [ ] **Step 3: Add the allocation terms**

Replace `perimDefenseWeight` (currently a one-liner):

```js
// On-ball assignment. Steal badges buy assignments here as well as raising the
// turnover chance in turnoverSpec — a pickpocket both guards the ball more and
// is better at it, which is what the badge name promises.
function perimDefenseWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'defensePerimeter') +
    _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'steal'));
}

// Shot-defender assignment, zone-aware. Extracted from an anonymous inline
// lambda at the pick site: leaving it anonymous is exactly what made this path
// easy to miss when auditing which weights read traits, and it was one of the
// five places the badges had to reach.
//
// Uses the FULL defense bonus rather than defenseQualityBonus's zone-routed
// value, so Charge Taker and Two-Way Star — which contribute nothing to shot
// quality — earn their keep here instead.
function shotDefenseWeight(player, zone) {
  const composite = zone === 'inside' ? 'defenseInterior' : 'defensePerimeter';
  const routed = _POSS_DATA.traits.defenseQualityBonus(player, zone);
  const unrouted = _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'defense') -
    _POSS_DATA.traits.defenseQualityBonus(player, 'three') -
    _POSS_DATA.traits.defenseQualityBonus(player, 'inside');
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, composite) + routed + Math.max(0, unrouted));
}
```

Replace the inline lambda at the shot-defender pick:

```js
  const shotDefender = weightedPick(defense, energyAware(function (p) { return shotDefenseWeight(p, zone); }, defenseBox, true), rng, PICK_POWER.shotDefender);
```

and delete the now-unused `defComposite` line above it.

- [ ] **Step 4: Export both**

Add to `simEnginePossession.js`'s `module.exports`:

```js
    perimDefenseWeight: perimDefenseWeight,
    shotDefenseWeight: shotDefenseWeight,
```

- [ ] **Step 5: Run the test**

```bash
node scripts/validate-ratings.js
```

Expected: `checkDefensiveBadgesDrawAssignments: OK`

- [ ] **Step 6: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | Drop `+ routed` from `shotDefenseWeight` | the threes assertion |
| 2 | `Math.max(0, unrouted)` → `unrouted` where routed is subtracted twice | the inside-unchanged assertion |
| 3 | Drop the steal bonus from `perimDefenseWeight` | the on-ball assertion |

- [ ] **Step 7: Commit**

```bash
git add simEnginePossession.js scripts/validate-ratings.js
git commit -F commit-msg.txt
```

---

### Task 5: Chemistry reaches the engine

**Files:**
- Modify: `compositeRatings.js` — `computeTeamSynergy`
- Modify: `simEnginePossession.js` — the two `computeTeamSynergy` call sites
- Modify: `scripts/validate-ratings.js` (append)

**Interfaces:**
- Consumes: `chemistryBonus(roster)` from Task 2.
- Produces: `computeTeamSynergy(roster, team)` — `team` optional; omitting it behaves as chemistry 70 (neutral).

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-ratings.js`:

```js
// Chemistry badges are TEAM-level, so they ride the team-level channel that
// already reaches shotMakeProbability. team.chemistry itself folds into the
// same term: it is authored 55-78 per team in teams.js but was read only by the
// non-default engine, so in normal play it was decorative.
function checkChemistryReachesSynergy() {
  const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));
  const roster = require(path.join(__dirname, '..', 'league.js')).getTeamRoster('BOS');
  const saved = roster.map(function (p) { return p.hiddenTraits; });

  roster.forEach(function (p) { p.hiddenTraits = []; });
  const neutral = composite.computeTeamSynergy(roster, { chemistry: 70 });

  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'naturalLeader', tier: 'legendary' }]; });
  const led = composite.computeTeamSynergy(roster, { chemistry: 70 });

  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'lockerRoomCancer', tier: 'legendary' }]; });
  const toxic = composite.computeTeamSynergy(roster, { chemistry: 70 });

  roster.forEach(function (p, i) { p.hiddenTraits = saved[i]; });

  assert.ok(led.offense > neutral.offense, 'Natural Leaders must raise offensive synergy');
  assert.ok(toxic.offense < neutral.offense, 'a toxic room must lower it');
  assert.ok(led.defense > neutral.defense && toxic.defense < neutral.defense,
    'chemistry must move BOTH sides of the ball, not just offence');

  // The authored field must be live too, independently of badges.
  roster.forEach(function (p) { p.hiddenTraits = []; });
  const goodRoom = composite.computeTeamSynergy(roster, { chemistry: 78 });
  const badRoom = composite.computeTeamSynergy(roster, { chemistry: 55 });
  roster.forEach(function (p, i) { p.hiddenTraits = saved[i]; });
  assert.ok(goodRoom.offense > badRoom.offense,
    'team.chemistry must stop being decorative in the default engine');

  // Omitting `team` must be neutral, so every existing caller is unaffected.
  const noTeam = composite.computeTeamSynergy(roster);
  const explicit70 = composite.computeTeamSynergy(roster, { chemistry: 70 });
  assert.ok(Math.abs(noTeam.offense - explicit70.offense) < 1e-9,
    'omitting team must behave as chemistry 70');
  console.log('checkChemistryReachesSynergy: OK');
}

checkChemistryReachesSynergy();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-ratings.js
```

Expected: `AssertionError: Natural Leaders must raise offensive synergy`

- [ ] **Step 3: Add the chemistry term**

In `compositeRatings.js`, add above `computeTeamSynergy`:

```js
// Chemistry rides the synergy channel because both are team-level and synergy
// already reaches shotMakeProbability. Two inputs feed one term: the rotation's
// summed chemistry badges, and team.chemistry centred on 70 — the same constant
// simEngineBoxScore's computeTeamRating already uses, so the two engines agree
// on what an average locker room is.
//
// CHEM_DIV is deliberately large. This term lands on a whole-team multiplier
// applied to EVERY shot, so it moves league scoring far harder per point than a
// per-defender term does. Swept against the locked rates; see the plan's Task 6.
const CHEMISTRY_CENTRE = 70;
const CHEM_DIV = 900;

function chemistryTerm(roster, team) {
  const authored = (team && typeof team.chemistry === 'number' ? team.chemistry : CHEMISTRY_CENTRE) - CHEMISTRY_CENTRE;
  const badges = _COMPOSITE_DATA.traits.chemistryBonus(roster);
  return (authored + badges) / CHEM_DIV;
}
```

Change `computeTeamSynergy` to take `team` and apply the term to offense and defense (not rebound — chemistry is about playing together, and rebounding is the least cooperative of the three):

```js
function computeTeamSynergy(roster, team) {
  const rotation = roster.slice().sort(function (a, b) { return b.overall - a.overall; }).slice(0, 8);
  if (rotation.length === 0) return { offense: 1, defense: 1, rebound: 1 };

  const shooters = rotation.filter(function (p) {
    return computeComposite(p, 'shootingThree') >= SHOOTER_THRESHOLD || computeComposite(p, 'shootingMid') >= SHOOTER_THRESHOLD;
  }).length;
  const defenders = rotation.filter(function (p) {
    return computeComposite(p, 'defenseInterior') >= DEFENDER_THRESHOLD || computeComposite(p, 'defensePerimeter') >= DEFENDER_THRESHOLD;
  }).length;
  const reboundThreats = rotation.filter(function (p) { return computeComposite(p, 'rebounding') >= REBOUNDER_THRESHOLD; }).length;

  const chem = chemistryTerm(rotation, team);
  return {
    offense: synergyRamp(shooters, 3, 0.06) + chem,
    defense: synergyRamp(defenders, 3, 0.06) + chem,
    rebound: synergyRamp(reboundThreats, 2, 0.05)
  };
}
```

`compositeRatings.js` currently has no `_COMPOSITE_DATA`. Add one at the top of the file, matching the codebase's dual pattern:

```js
var _COMPOSITE_DATA = (typeof require !== 'undefined')
  ? { traits: require('./traits.js') }
  : { traits: { chemistryBonus: chemistryBonus } };
```

- [ ] **Step 4: Pass the team at the call sites**

The calls are in **`gameSim.js:79-80`**, not `simEnginePossession.js` — synergy is computed once per game by `createGameSim`, not per possession. Replace both lines:

```js
  const homeSynergy = _GAMESIM_DATA.composite.computeTeamSynergy(homeRoster, _GAMESIM_DATA.teams.getTeamById(homeTeamId));
  const awaySynergy = _GAMESIM_DATA.composite.computeTeamSynergy(awayRoster, _GAMESIM_DATA.teams.getTeamById(awayTeamId));
```

`_GAMESIM_DATA` does not yet carry `teams`. Add it to BOTH branches of the dual-module block at the top of `gameSim.js` — the browser branch lists globals by hand, and a missing name there is a runtime error only the app will show:

```js
      teams: { getTeamById: getTeamById },
```

- [ ] **Step 5: Run both validators**

```bash
node scripts/validate-ratings.js && node scripts/validate-traitsAreLive.js
```

Expected: `checkChemistryReachesSynergy: OK`, and **`validate-traitsAreLive` now PASSES all 13 families.** This is the moment the plan's headline goal is met.

- [ ] **Step 6: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `chemistryTerm` returns 0 | `checkChemistryReachesSynergy` and `validate-traitsAreLive` |
| 2 | Drop `authored` from `chemistryTerm` | the `team.chemistry` assertion |
| 3 | Drop `badges` from `chemistryTerm` | the Natural Leader assertion |
| 4 | Apply `chem` to `offense` only | the both-sides assertion |
| 5 | `CHEMISTRY_CENTRE` 70 → 0 | the omitting-team assertion |

- [ ] **Step 7: Commit**

```bash
git add compositeRatings.js simEnginePossession.js scripts/validate-ratings.js
git commit -F commit-msg.txt
```

---

### Task 6: Rate-neutral calibration, and regenerate the goldens

**Files:**
- Modify: `simEnginePossession.js` (`DEF_TRAIT_DIV`), `compositeRatings.js` (`CHEM_DIV`)
- Regenerate: `scripts/fixtures/gamesim-golden.json`, `scripts/fixtures/rollover-golden.json`

**Interfaces:** none new.

- [ ] **Step 1: Measure where the league landed**

```bash
node scripts/measure-identity.js
```

Record FG%, 3P%, 3PA share and pts/team. The targets to hold: **FG% 46.8 ±0.4, 3P% 36.6 ±0.4, 3PA share 30.0% ±1.0, pts/team 103.3 ±1.5.**

- [ ] **Step 2: Sweep `DEF_TRAIT_DIV` and `CHEM_DIV`**

Write `scripts/sweep-badges.js`:

```js
// Throwaway sweep. Prints league rates for a grid of divisors so the constants
// are chosen by MEASURED RATE rather than picked. Delete after Task 6.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const POSS = path.join(__dirname, '..', 'simEnginePossession.js');
const COMP = path.join(__dirname, '..', 'compositeRatings.js');

function setConst(file, name, value) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp('(const ' + name + ' = )[^;,]+');
  const out = src.replace(re, '$1' + value);
  if (out === src) throw new Error('did not find ' + name + ' in ' + file);
  fs.writeFileSync(file, out);
}

const origPoss = fs.readFileSync(POSS, 'utf8');
const origComp = fs.readFileSync(COMP, 'utf8');
console.log('DEF_DIV  CHEM_DIV  FG%    3P%    3PAshare  pts');
[200, 300, 450, 600].forEach(function (defDiv) {
  [600, 900, 1400].forEach(function (chemDiv) {
    setConst(POSS, 'DEF_TRAIT_DIV', defDiv);
    setConst(COMP, 'CHEM_DIV', chemDiv);
    const out = execFileSync('node', [path.join(__dirname, 'measure-identity.js'), '--json'], { encoding: 'utf8' });
    // buildReport() returns { shapes, players, attributes, synergy, sim }.
    const s = JSON.parse(out.slice(out.indexOf('{'))).sim;
    console.log([defDiv, chemDiv, s.fgPct.toFixed(2), s.tpPct.toFixed(2),
      s.tpaShare.toFixed(1), s.ptsPerTeam.toFixed(1)].join('  '));
  });
});
fs.writeFileSync(POSS, origPoss);
fs.writeFileSync(COMP, origComp);
```

```bash
node scripts/sweep-badges.js
```

**If no pair holds every bound**, the divisors alone are not enough and the zone bases in `SHOT_BASE_BY_ZONE` need the residual correction — raise them by the measured FG% shortfall, then re-sweep. Adjust the constants, never the bounds.

**Note on mean-centring.** The spec proposed mean-centring the defensive term so an average defender contributes zero. That is wrong here and is deliberately not done: most players carry NO defensive badge, so the league mean is near zero and subtracting it would make every badge-less player a *below-average* defender — punishing the majority to normalise the minority. Centring is right for a term everyone has a value for; this is not one. The divisor sweep plus a base correction is the honest mechanism.

- [ ] **Step 3: Set the constants to the swept values**

Pick the pair whose rates land inside every bound, preferring the one that keeps a legendary defensive badge closest to −2.7pp on its zone (symmetry with offence). Update `DEF_TRAIT_DIV` in `simEnginePossession.js` and `CHEM_DIV` in `compositeRatings.js`, replacing the placeholder comments with the measured sweep.

- [ ] **Step 4: Confirm the rates hold**

```bash
node scripts/measure-identity.js
```

Every target inside its bound. **If not, change the divisors — never the bounds.**

- [ ] **Step 5: Delete the sweep script**

```bash
rm scripts/sweep-badges.js
```

It is a one-shot measurement, and leaving it behind means a future reader cannot tell it from a validator.

- [ ] **Step 6: Regenerate both goldens**

This change moves outcomes ON PURPOSE — the opposite of the skill-check refactor, where a moved golden meant a bug.

```bash
node scripts/gen-gamesim-golden.js && node scripts/gen-rollover-golden.js
git diff --stat scripts/fixtures/
```

Expected: both files changed. Record the new scores in the commit message.

- [ ] **Step 7: Run the full suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: no `FAIL` lines, 42 validators.

- [ ] **Step 8: Commit**

```bash
git add simEnginePossession.js compositeRatings.js scripts/fixtures/gamesim-golden.json scripts/fixtures/rollover-golden.json
git commit -F commit-msg.txt
```

Message must contain the full sweep table.

---

### Task 7: Defensive FG% as a real stat

**Files:**
- Modify: `simEnginePossession.js` (`initBoxLine`, the shot resolution), `league.js:40`, `ui/schedule.js`
- Modify: `scripts/validate-ratings.js` (append)

**Interfaces:**
- Produces: box lines carry `oppFga` / `oppFgm`; `SEASON_STAT_KEYS` includes both.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-ratings.js`:

```js
// Without a surfaced stat the whole defensive path is invisible — a lockdown
// defender's contribution would exist only in team results.
function checkDefensiveFgIsRecorded() {
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
  const r = gameSim.simulateGame('BOS', 'LAL', makeRng(5));
  const lines = Object.keys(r.boxScore).map(function (id) { return r.boxScore[id]; });

  const totalOppFga = lines.reduce(function (s, l) { return s + l.oppFga; }, 0);
  const totalFga = lines.reduce(function (s, l) { return s + l.fga; }, 0);
  assert.strictEqual(totalOppFga, totalFga,
    'every shot has exactly one defender, so defended attempts must equal attempts (' +
    totalOppFga + ' vs ' + totalFga + ')');

  const totalOppFgm = lines.reduce(function (s, l) { return s + l.oppFgm; }, 0);
  const totalFgm = lines.reduce(function (s, l) { return s + l.fgm; }, 0);
  assert.strictEqual(totalOppFgm, totalFgm, 'defended makes must equal makes');

  lines.forEach(function (l) {
    assert.ok(l.oppFgm <= l.oppFga, 'a defender cannot allow more makes than attempts');
  });

  const { SEASON_STAT_KEYS } = require(path.join(__dirname, '..', 'league.js'));
  assert.ok(SEASON_STAT_KEYS.indexOf('oppFga') !== -1 && SEASON_STAT_KEYS.indexOf('oppFgm') !== -1,
    'DFG% only means anything over a season — one game of 5 defended shots is noise');
  console.log('checkDefensiveFgIsRecorded: OK (' + totalOppFga + ' defended attempts)');
}

checkDefensiveFgIsRecorded();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-ratings.js
```

Expected: `AssertionError: ... (NaN vs 176)` — `oppFga` does not exist yet.

- [ ] **Step 3: Add the fields and record them**

In `initBoxLine`, add to the returned object:

```js
oppFga: 0, oppFgm: 0,
```

At the block branch (a blocked shot is a defended miss), after `defenseBox[shotDefender.id].blocks += 1;`:

```js
    defenseBox[shotDefender.id].oppFga += 1;
```

At the shot resolution, immediately after `offenseBox[shooter.id].fga += 1;`:

```js
  defenseBox[shotDefender.id].oppFga += 1;
```

and in the `made` branch after `offenseBox[shooter.id].fgm += 1;`:

```js
    defenseBox[shotDefender.id].oppFgm += 1;
```

In `league.js:40`:

```js
const SEASON_STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'minutes', 'oppFga', 'oppFgm'];
```

- [ ] **Step 4: Render DFG% in the box score**

There are **TWO** tables to change, and missing the second leaves a misaligned fallback nobody notices until an old save opens it: the per-team table in `boxScoreTeamTableHtml` (line 128-129) and the combined fallback in `boxScoreDetailHtml` (line 164-165).

In **both**, change the header from:

```js
    '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th></tr></thead><tbody>';
```

to:

```js
    '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th>' +
    '<th class="num">DFG%</th></tr></thead><tbody>';
```

and in **both** row builders, change the trailing cell from:

```js
'</td><td class="num">' + s.steals + '</td><td class="num">' + s.blocks + '</td></tr>';
```

to:

```js
'</td><td class="num">' + s.steals + '</td><td class="num">' + s.blocks +
'</td><td class="num">' + (s.oppFga ? (100 * s.oppFgm / s.oppFga).toFixed(1) : '—') + '</td></tr>';
```

The em-dash fallback matters: box scores saved before this task have no `oppFga`, and `0/0` would render `NaN` across every historical game.

- [ ] **Step 5: Run the suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

`validate-save.js` and `validate-seasonRollover.js` exercise `SEASON_STAT_KEYS`; if either fails, the new keys need adding to whatever fixture it compares against — do that, do not remove the keys.

- [ ] **Step 6: Regenerate the goldens**

The box checksum includes every line's fields.

```bash
node scripts/gen-gamesim-golden.js && node scripts/gen-rollover-golden.js
```

- [ ] **Step 7: Verify in the browser**

Start the dev server via the Browser pane (`preview_start` name `nba-gm` — never `Bash`), sim several days, open a box score, confirm the DFG% column renders with real values and the table is aligned. Screenshot it. Ignore the known `assets/logos/MIA.png` 404.

- [ ] **Step 8: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | Drop `defenseBox[shotDefender.id].oppFga += 1;` at the shot site | attempts-equal-attempts |
| 2 | Drop it at the block site | attempts-equal-attempts |
| 3 | Drop `oppFgm` increment | makes-equal-makes |
| 4 | Remove `oppFga` from `SEASON_STAT_KEYS` | the season-keys assertion |

- [ ] **Step 9: Commit**

```bash
git add simEnginePossession.js league.js ui/schedule.js scripts/validate-ratings.js scripts/fixtures/gamesim-golden.json scripts/fixtures/rollover-golden.json
git commit -F commit-msg.txt
```

---

### Task 8: Badges become visible

**Files:**
- Modify: `scouting.js` (`getRevealedView`), `ui/playerProfile.js`
- Modify: `playerCareerController.js`, `data.js`, `ui/playerCreation.js`, `ui/playerDashboard.js` (dead-badge cleanup)
- Modify: `scripts/validate-traits.js` (append)

**Interfaces:**
- Produces: `getRevealedView(player, confidence, isProspect)` — third argument defaults false.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-traits.js`:

```js
// Badges leave the scouting gate for rostered players. Personality and
// tendencies stay behind it, so scouting keeps a job — it just stops taxing you
// to learn what your own players are.
function checkBadgesAreVisibleForRosteredPlayers() {
  const scouting = require(path.join(__dirname, '..', 'scouting.js'));
  const p = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: { loyalty: 80 }, hiddenTendencies: { threeRate: 0.4 } };

  const unscouted = scouting.getRevealedView(p, 0, false);
  assert.deepStrictEqual(unscouted.traits, p.hiddenTraits,
    'a rostered player\'s badges must be exact at 0% confidence');
  assert.strictEqual(unscouted.personality, null,
    'personality must STAY gated — only badges come out from behind it');
  assert.strictEqual(unscouted.tendencies, null, 'tendencies must stay gated');

  const scouted = scouting.getRevealedView(p, 100, false);
  assert.ok(scouted.personality, 'personality must still unlock with confidence');
  console.log('checkBadgesAreVisibleForRosteredPlayers: OK');
}

// Prospects keep the fuzz: seeing a draft pick's exact tier would remove most
// of draft night's risk. Reuses the fuzzy path that already exists.
function checkProspectBadgesStayFuzzy() {
  const scouting = require(path.join(__dirname, '..', 'scouting.js'));
  const p = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: {}, hiddenTendencies: {} };
  const view = scouting.getRevealedView(p, 0, true);
  assert.ok(view.traits && view.traits.length === 1, 'a prospect must still show WHICH badges');
  assert.ok(!view.traits[0].tier, 'a prospect must NOT show the exact tier');
  assert.ok(view.traits[0].rangeLabel && view.traits[0].rangeLabel.indexOf('-') !== -1,
    'a prospect badge must carry a tier RANGE, got ' + JSON.stringify(view.traits[0]));
  console.log('checkProspectBadgesStayFuzzy: OK');
}

// The dead `badges` array and badge_affinity are gone. Once badges mean traits,
// a second inert thing called "badges" is a trap.
function checkTheDeadBadgeArrayIsGone() {
  const dataModule = require(path.join(__dirname, '..', 'data.js'));
  Object.keys(dataModule.PLAYER_ARCHETYPES).forEach(function (k) {
    assert.strictEqual(dataModule.PLAYER_ARCHETYPES[k].badge_affinity, undefined,
      k + ' still declares badge_affinity, which nothing reads');
  });
  console.log('checkTheDeadBadgeArrayIsGone: OK');
}

checkBadgesAreVisibleForRosteredPlayers();
checkProspectBadgesStayFuzzy();
checkTheDeadBadgeArrayIsGone();
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-traits.js
```

Expected: `AssertionError: a rostered player's badges must be exact at 0% confidence`

- [ ] **Step 3: Ungate badges in `scouting.js`**

Replace `getRevealedView` (currently at line 79):

```js
// Badges are NOT gated for players on an NBA roster. They were, and it meant
// most players never saw most badges — you had to spend scout points to learn
// what your own signings were. Scouting keeps its job: personality and
// tendencies still unlock at 30% and 70%.
//
// PROSPECTS ARE THE EXCEPTION. Seeing a draft pick's exact tier would remove
// most of draft night's risk, so they get the fuzzy path — which badges, and a
// tier range, but never the exact tier.
function getRevealedView(player, confidence, isProspect) {
  const badges = isProspect
    ? (player.hiddenTraits || []).map(fuzzyTraitLabel)
    : (player.hiddenTraits || []);
  if (confidence < 30) {
    return { level: isProspect ? 'fuzzy' : 'badges', traits: badges, personality: null, tendencies: null };
  }
  if (confidence < 70) {
    return {
      level: 'fuzzy',
      traits: badges,
      personality: fuzzyPersonality(player.hiddenPersonality || {}),
      tendencies: null
    };
  }
  return { level: 'exact', traits: badges, personality: player.hiddenPersonality, tendencies: player.hiddenTendencies };
}
```

- [ ] **Step 4: Pass `isProspect` and rename the UI label**

In `ui/playerProfile.js`, `renderTraitsTab` calls `getRevealedView(player, confidence)`. A prospect is one not on an NBA roster — pass `!player.teamId`:

```js
  const view = getRevealedView(player, confidence, !player.teamId);
```

Rename the tab label at `PLAYER_PROFILE_TABS` from `'Traits & Badges'` to `'Badges'`, and the panel header from `'Traits'` to `'Badges'`. Update the lock note text so it no longer promises that badges are hidden — a prospect's note should read: `Draft prospect — exact badge tiers are never shown before the pick.`

- [ ] **Step 5: Delete the dead badge system**

- `data.js`: remove the `badge_affinity` line from all five archetypes.
- `playerCareerController.js`: remove `badges: selectedBadges,` from the player literal and the `selectedBadges` parameter from `createCustomPlayer`'s signature.
- `ui/playerCreation.js`: remove `availableBadges`, `selectedBadges`, the badge checkbox block, its change handler, the `!selectedBadges.length` validation, and the argument at the `createCustomPlayer` call.
- `ui/playerDashboard.js:61`: remove the `Badges:` line.

Career mode is parked, so none of this is user-visible — but leaving a second inert thing called "badges" is exactly the trap the park note warns about.

- [ ] **Step 6: Run the suite**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

`validate-careerMode.js` constructs a custom player and will need its `createCustomPlayer` call updated to the new signature.

- [ ] **Step 7: Verify in the browser**

Open a player profile on your own roster with 0% scouting confidence. Badges show with exact tiers; the Scouting Confidence panel still shows 0%; personality stays locked. Then open a draft prospect and confirm the tiers read as ranges. Screenshot both.

- [ ] **Step 8: Mutation-test**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `getRevealedView` returns `traits: null` when confidence < 30 | the 0%-confidence assertion |
| 2 | Drop the `isProspect` branch so prospects show exact tiers | `checkProspectBadgesStayFuzzy` |
| 3 | Return real personality at 0% confidence | the personality-stays-gated assertion |

- [ ] **Step 9: Commit**

```bash
git add scouting.js ui/playerProfile.js data.js playerCareerController.js ui/playerCreation.js ui/playerDashboard.js scripts/validate-traits.js scripts/validate-careerMode.js
git commit -F commit-msg.txt
```

---

## Done when

- `scripts/validate-traitsAreLive.js` passes with **all 13 families live and zero exemptions**.
- League rates hold: FG% 46.8 ±0.4, 3P% 36.6 ±0.4, 3PA share 30.0% ±1.0, pts/team 103.3 ±1.5, measured by `scripts/measure-identity.js`.
- DFG% appears in the box score and accumulates across a season.
- Your own players' badges are visible at 0% scouting confidence; prospects show tier ranges; personality and tendencies stay gated.
- `player.badges` and `badge_affinity` no longer exist.
- Full suite green (42 validators) from a fresh `git clone --local` of HEAD.
- Every mutant in the eight tables above dies, each verified as actually applied.
