# Phase 5 Batch B — Gameplay Integration & Scouting UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this project's established preference) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Depends on Batch A (`docs/superpowers/plans/2026-08-01-phase-5a-traits-core.md`) being complete.

**Goal:** Wire the Batch A trait/personality/tendency/scouting engine into the actual gameplay systems (sim engine, progression, injuries, fatigue, free agency, trades), then build the scouting UI (watchlist, point allocation, scouting reports) so the user can act on it. Ends with a full browser walkthrough.

**Architecture:** Every gameplay integration point is a small, targeted edit calling `traits.js`'s `getTraitBonus(player, system, stat)` — no per-trait special-casing at call sites except Mentor (cross-player lookup in `progression.js`). The scouting UI is a new `ui/scouting.js` view plus a "Scout Report" button added to the existing `ui/roster.js` table.

**Tech Stack:** Same as Batch A — vanilla JS, dual browser-global/Node-require pattern, Node `assert` validation, `mcp__Claude_Browser__*` for the final live walkthrough.

## Global Constraints

- Same as Batch A's Global Constraints section — no third-party dependencies, dual-module pattern, deterministic seeded randomness, no `git push`/branch changes (working directly on `master`).
- Every integration point must be backward-compatible with existing Node validators (`validate-data.js`, `validate-sim.js`, `validate-trades.js`, `validate-offseason.js`) — their existing test fixtures largely lack `hiddenPersonality`/`hiddenTraits`, so every new code path must guard against those fields being `undefined` and degrade to "no effect" rather than throwing.

---

### Task 1: `simEngineBoxScore.js` — trait & tendency integration

**Files:**
- Modify: `simEngineBoxScore.js`
- Modify: `scripts/validate-traits.js` (append `checkBoxScoreTraitIntegration`)

**Interfaces:**
- Consumes: `traits.js`'s `getTraitBonus` (Batch A Task 1)
- Produces: `computeTeamRating`, `scoringWeight`, `reboundWeight`, `assistWeight`, `stealWeight`, `blockWeight`, `minutesWeight`, `deriveShootingLine` all now trait/tendency-aware; return values are unchanged in shape, just numerically nudged.

- [ ] **Step 1: Add `traits.js` to the dependency block**

Change:
```js
var _ENGINE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js') }
  : { league: { getTeamRoster: getTeamRoster }, teams: { getTeamById: getTeamById }, simEngine: { registerEngine: registerEngine } };
```
to:
```js
var _ENGINE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, teams: { getTeamById: getTeamById }, simEngine: { registerEngine: registerEngine }, traits: { getTraitBonus: getTraitBonus } };
```

- [ ] **Step 2: Add a rotation-wide trait bonus to `computeTeamRating`**

Change:
```js
function computeTeamRating(teamId) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const rotation = roster.slice().sort(function (a, b) { return b.overall - a.overall; }).slice(0, 8);
  if (rotation.length === 0) return 50; // fully depleted roster fallback, shouldn't happen with real data
  const avgOverall = rotation.reduce(function (s, p) { return s + p.overall; }, 0) / rotation.length;
  const avgFatiguePenalty = (rotation.reduce(function (s, p) { return s + p.status.fatigue; }, 0) / rotation.length) * 0.1;
  const team = _ENGINE_DATA.teams.getTeamById(teamId);
  const chemistryBonus = (team.chemistry - 70) * 0.05;
  return avgOverall - avgFatiguePenalty + chemistryBonus;
}
```
to:
```js
function computeTeamRating(teamId) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const rotation = roster.slice().sort(function (a, b) { return b.overall - a.overall; }).slice(0, 8);
  if (rotation.length === 0) return 50; // fully depleted roster fallback, shouldn't happen with real data
  const avgOverall = rotation.reduce(function (s, p) { return s + p.overall; }, 0) / rotation.length;
  const avgFatiguePenalty = (rotation.reduce(function (s, p) { return s + p.status.fatigue; }, 0) / rotation.length) * 0.1;
  const team = _ENGINE_DATA.teams.getTeamById(teamId);
  const chemistryBonus = (team.chemistry - 70) * 0.05;
  // Modest nudge from hidden traits: a rotation stacked with Sharpshooters/Lockdown
  // Defenders plays a little better than raw overall alone would predict.
  const traitBonus = rotation.reduce(function (s, p) {
    return s + _ENGINE_DATA.traits.getTraitBonus(p, 'boxscore', 'scoring') + _ENGINE_DATA.traits.getTraitBonus(p, 'boxscore', 'defense');
  }, 0) / rotation.length * 0.15;
  return avgOverall - avgFatiguePenalty + chemistryBonus + traitBonus;
}
```

- [ ] **Step 3: Add per-player trait bonuses to the weight functions**

Change:
```js
function scoringWeight(player) {
  const a = player.attributes;
  return Math.max(1, (a.insideScoring + a.midRange + a.threePoint + a.postScoring) / 4);
}
function reboundWeight(player) {
  const a = player.attributes;
  return Math.max(1, (a.offReb + a.defReb) / 2);
}
function assistWeight(player) {
  const a = player.attributes;
  return Math.max(1, (a.passing + a.ballHandling) / 2);
}
function stealWeight(player) { return Math.max(1, player.attributes.steal); }
function blockWeight(player) { return Math.max(1, player.attributes.block); }
function minutesWeight(player) { return Math.max(1, player.overall - 40); }
```
to:
```js
function scoringWeight(player) {
  const a = player.attributes;
  const base = (a.insideScoring + a.midRange + a.threePoint + a.postScoring) / 4;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'scoring'));
}
function reboundWeight(player) {
  const a = player.attributes;
  const base = (a.offReb + a.defReb) / 2;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}
function assistWeight(player) {
  const a = player.attributes;
  const base = (a.passing + a.ballHandling) / 2;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'assist'));
}
function stealWeight(player) {
  return Math.max(1, player.attributes.steal + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'steal'));
}
function blockWeight(player) {
  return Math.max(1, player.attributes.block + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'block'));
}
function minutesWeight(player) {
  return Math.max(1, player.overall - 40 + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'usage'));
}
```

- [ ] **Step 4: Nudge three-point shot mix by tendency in `deriveShootingLine`**

Change:
```js
function deriveShootingLine(player, points, rng) {
  if (points === 0) return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
  const a = player.attributes;
  const ftShare = Math.min(0.35, 0.10 + (a.freeThrow - 50) / 300);
  const ftPoints = Math.round(points * Math.max(0, ftShare));
  const threeShare = Math.min(0.6, Math.max(0, (a.threePoint - 50) / 120));
```
to:
```js
function deriveShootingLine(player, points, rng) {
  if (points === 0) return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
  const a = player.attributes;
  const ftShare = Math.min(0.35, 0.10 + (a.freeThrow - 50) / 300);
  const ftPoints = Math.round(points * Math.max(0, ftShare));
  // hiddenTendencies.threeTendency is a ~0-100 share of a player's shot mix
  // (see traits.js's generateTendencies); nudge the visible-attribute-driven
  // three-point share by how far it sits from a neutral one-third split.
  const tendencyNudge = player.hiddenTendencies ? (player.hiddenTendencies.threeTendency - 33) / 300 : 0;
  const threeShare = Math.min(0.6, Math.max(0, (a.threePoint - 50) / 120 + tendencyNudge));
```

- [ ] **Step 5: Append `checkBoxScoreTraitIntegration` to `scripts/validate-traits.js`**

Insert before the final `console.log('All trait/scouting validations passed');` line:
```js
function checkComputeTeamRatingTraitBonus() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const before = engineModule.computeTeamRating('BOS');

  const roster = leagueModule.getTeamRoster('BOS');
  const originalTraits = roster.map(function (p) { return p.hiddenTraits; });
  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'sharpshooter', tier: 'legendary' }, { key: 'iceInVeins', tier: 'legendary' }]; });

  const after = engineModule.computeTeamRating('BOS');
  roster.forEach(function (p, i) { p.hiddenTraits = originalTraits[i]; }); // restore

  assert.ok(after > before, 'stacking every player with elite offensive traits should raise team rating');

  console.log('checkComputeTeamRatingTraitBonus: OK');
}

checkComputeTeamRatingTraitBonus();

// scoringWeight/reboundWeight/stealWeight/blockWeight/etc aren't exported
// individually, so exercise their trait bias indirectly through simulateGame's
// box score output: give one team's whole roster a legendary Rim Protector
// trait and confirm they out-block a normal roster over many simulated games.
function checkWeightFunctionTraitBias() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const rng = makeRng(55);

  const boostedRoster = leagueModule.getTeamRoster('BOS');
  const plainRoster = leagueModule.getTeamRoster('MIA');
  const originalBoosted = boostedRoster.map(function (p) { return p.hiddenTraits; });
  const originalPlain = plainRoster.map(function (p) { return p.hiddenTraits; });
  boostedRoster.forEach(function (p) { p.hiddenTraits = [{ key: 'rimProtector', tier: 'legendary' }]; });
  plainRoster.forEach(function (p) { p.hiddenTraits = []; });

  let boostedBlocks = 0;
  let plainBlocks = 0;
  const TRIALS = 20;
  for (let i = 0; i < TRIALS; i++) {
    const result = engineModule.simulateGame('BOS', 'MIA', rng);
    boostedRoster.forEach(function (p) { boostedBlocks += (result.boxScore[p.id] || { blocks: 0 }).blocks; });
    plainRoster.forEach(function (p) { plainBlocks += (result.boxScore[p.id] || { blocks: 0 }).blocks; });
  }

  boostedRoster.forEach(function (p, i) { p.hiddenTraits = originalBoosted[i]; });
  plainRoster.forEach(function (p, i) { p.hiddenTraits = originalPlain[i]; });

  assert.ok(boostedBlocks > plainBlocks, 'a roster of legendary Rim Protectors should out-block a plain roster over ' + TRIALS + ' games (' + boostedBlocks + ' vs ' + plainBlocks + ')');

  console.log('checkWeightFunctionTraitBias: OK');
}

checkWeightFunctionTraitBias();
```

- [ ] **Step 6: Run the validator**

Run: `node scripts/validate-traits.js`
Expected: all checks pass including the two new ones.

- [ ] **Step 7: Run the full sim validator to confirm no regression**

Run: `node scripts/validate-sim.js`
Expected: `All sim validations passed` (existing test player fixtures there lack `hiddenTraits`/`hiddenTendencies`; `getTraitBonus`'s `(player.hiddenTraits || [])` guard and `deriveShootingLine`'s `player.hiddenTendencies ?` guard mean they're unaffected).

- [ ] **Step 8: Commit**

```bash
git add simEngineBoxScore.js scripts/validate-traits.js
git commit -m "feat: wire hidden traits/tendencies into the box score sim engine"
```

---

### Task 2: `progression.js` — trait/personality/mentor integration

**Files:**
- Modify: `progression.js`
- Modify: `seasonTransition.js:33-42` (pass teammates into `progressPlayer`)
- Modify: `scripts/validate-traits.js` (append `checkProgressionTraitIntegration`)

**Interfaces:**
- Consumes: `traits.js`'s `getTraitBonus` (Batch A Task 1)
- Produces: `progressPlayer(player, rng, teammates)` — `teammates` is a new optional 3rd param (defaults to `[]`, so every existing call site without it keeps working); Coachable/Film Junkie/Stubborn and the `coachability` personality axis nudge the player's own progression, Mentor on any teammate nudges progression for players 25 or younger.

- [ ] **Step 1: Add `traits.js` to the dependency block and extend `progressPlayer`**

Change:
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
  player.yearsPro += 1;
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
```
to:
```js
var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js') }
  : { data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX }, traits: { getTraitBonus: getTraitBonus } };

function clampRating(v) {
  return Math.max(_PROGRESSION_DATA.data.RATING_MIN, Math.min(_PROGRESSION_DATA.data.RATING_MAX, Math.round(v)));
}

// Formula-driven with randomness: young players trend toward their potential,
// veterans decline, and a small league-wide breakout/bust roll adds emergent
// variance on top of the age curve. `teammates` (optional) lets a Mentor on
// the roster nudge development for players 25 and under.
function progressPlayer(player, rng, teammates) {
  teammates = teammates || [];
  player.age += 1;
  player.yearsPro += 1;
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

  // Trait/personality modifiers. No coach entities exist yet, so Coachable/
  // Stubborn apply unconditionally rather than being gated by coach fit.
  change += _PROGRESSION_DATA.traits.getTraitBonus(player, 'progression', 'self') * 0.3;
  if (player.hiddenPersonality) {
    change += (player.hiddenPersonality.coachability - 50) / 50 * 1.5;
  }
  if (player.age <= 25) {
    const mentorBonus = teammates.reduce(function (sum, tm) {
      return sum + _PROGRESSION_DATA.traits.getTraitBonus(tm, 'progression', 'teammate');
    }, 0);
    change += Math.min(3, mentorBonus * 0.2);
  }

  const newOverall = clampRating(player.overall + change);
```

- [ ] **Step 2: Update the remaining `_PROGRESSION_DATA.ATTRIBUTE_KEYS` reference and `module.exports`**

Change:
```js
  _PROGRESSION_DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + change);
  });
}
```
to:
```js
  _PROGRESSION_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + change);
  });
}
```
(`module.exports` block is unchanged — `progressPlayer`/`clampRating` are still the only exports.)

- [ ] **Step 3: Pass teammates in from `seasonTransition.js`**

Change:
```js
  // 1. Progression — mutate in place, then filter out retirees.
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) { _TRANSITION_DATA.progression.progressPlayer(p, rng); });
```
to:
```js
  // 1. Progression — mutate in place, then filter out retirees.
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) {
    const teammates = rosterPlayers.filter(function (tp) { return tp.teamId === p.teamId && tp.id !== p.id; });
    _TRANSITION_DATA.progression.progressPlayer(p, rng, teammates);
  });
```

- [ ] **Step 4: Run `validate-offseason.js` to confirm the existing progression tests still pass**

Run: `node scripts/validate-offseason.js`
Expected: `checkProgression: OK` and the file's final `All offseason validations passed` — the existing test fixtures there have no `hiddenTraits`/`hiddenPersonality` fields, so `getTraitBonus` returns 0 and the `if (player.hiddenPersonality)` guard skips the coachability nudge; behavior is numerically identical to before this task.

- [ ] **Step 5: Append `checkProgressionTraitIntegration` to `scripts/validate-traits.js`**

Insert before `console.log('All trait/scouting validations passed');`:
```js
function checkProgressionTraitIntegration() {
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const dataModule = require(path.join(__dirname, '..', 'data.js'));
  const rng = makeRng(33);

  function freshPlayer(overrides) {
    const p = { age: 22, yearsPro: 2, overall: 70, potential: 80, attributes: {} };
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 70; });
    return Object.assign(p, overrides || {});
  }

  const coachable = freshPlayer({ hiddenTraits: [{ key: 'coachable', tier: 'legendary' }], hiddenPersonality: { coachability: 100 } });
  const stubborn = freshPlayer({ hiddenTraits: [{ key: 'stubborn', tier: 'legendary' }], hiddenPersonality: { coachability: 0 } });

  let coachableTotal = 0;
  let stubbornTotal = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const c = freshPlayer({ hiddenTraits: coachable.hiddenTraits, hiddenPersonality: coachable.hiddenPersonality });
    const s = freshPlayer({ hiddenTraits: stubborn.hiddenTraits, hiddenPersonality: stubborn.hiddenPersonality });
    const cBefore = c.overall;
    const sBefore = s.overall;
    progressionModule.progressPlayer(c, rng, []);
    progressionModule.progressPlayer(s, rng, []);
    coachableTotal += c.overall - cBefore;
    stubbornTotal += s.overall - sBefore;
  }
  assert.ok(coachableTotal > stubbornTotal, 'a legendary-Coachable/high-coachability player should out-develop a legendary-Stubborn/low-coachability player on average');

  // Mentor: a young player with a Mentor teammate should progress at least as
  // well on average as one without, all else equal.
  let withMentorTotal = 0;
  let withoutMentorTotal = 0;
  const mentorTeammate = freshPlayer({ hiddenTraits: [{ key: 'mentor', tier: 'legendary' }] });
  for (let i = 0; i < TRIALS; i++) {
    const young = freshPlayer({ age: 21, hiddenTraits: [], hiddenPersonality: undefined });
    const youngAlone = freshPlayer({ age: 21, hiddenTraits: [], hiddenPersonality: undefined });
    const beforeWith = young.overall;
    const beforeWithout = youngAlone.overall;
    progressionModule.progressPlayer(young, rng, [mentorTeammate]);
    progressionModule.progressPlayer(youngAlone, rng, []);
    withMentorTotal += young.overall - beforeWith;
    withoutMentorTotal += youngAlone.overall - beforeWithout;
  }
  assert.ok(withMentorTotal >= withoutMentorTotal, 'a legendary Mentor teammate should never hurt a young player\'s average development');

  console.log('checkProgressionTraitIntegration: OK');
}

checkProgressionTraitIntegration();
```

- [ ] **Step 6: Run the validator**

Run: `node scripts/validate-traits.js`
Expected: all checks pass including the new one.

- [ ] **Step 7: Commit**

```bash
git add progression.js seasonTransition.js scripts/validate-traits.js
git commit -m "feat: wire Coachable/Stubborn/Mentor traits and coachability into progression"
```

---

### Task 3: `injuries.js` + `fatigue.js` — durability trait integration

**Files:**
- Modify: `injuries.js`
- Modify: `fatigue.js`
- Modify: `scripts/validate-traits.js` (append `checkInjuryFatigueTraitIntegration`)

**Interfaces:**
- Consumes: `traits.js`'s `getTraitBonus` (Batch A Task 1)
- Produces: `rollInjury` now trait/personality-aware (Iron Man/Injury Prone/`durabilityMindset` adjust chance, Fast Healer shortens non-season-ending recovery); `applyFatigueForGame` now trait-aware (High Motor/Poor Conditioning adjust accumulation rate).

- [ ] **Step 1: Update `injuries.js`**

Replace the whole file with:
```js
var _INJURY_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, traits: { getTraitBonus: getTraitBonus } };

const INJURY_SEVERITIES = [
  { name: 'Day-to-Day', gamesOut: 1 },
  { name: 'Two Weeks', gamesOut: 6 },
  { name: 'One Month', gamesOut: 13 },
  { name: 'Season Ending', gamesOut: 999 }
];

// Flat base rate, scaled up by current fatigue and nudged by Iron Man/Injury
// Prone traits and the durabilityMindset personality axis.
function rollInjury(player, rng) {
  if (player.status.injury) return;
  const baseChance = 0.003;
  const fatigueMultiplier = 1 + player.status.fatigue / 100;
  const traitBonus = _INJURY_DATA.traits.getTraitBonus(player, 'injury', 'chance');
  const durabilityFactor = player.hiddenPersonality ? (50 - player.hiddenPersonality.durabilityMindset) / 100 : 0;
  const chanceMultiplier = Math.max(0.2, 1 + traitBonus * 0.08 + durabilityFactor * 0.3);
  if (rng() < baseChance * fatigueMultiplier * chanceMultiplier) {
    const roll = rng();
    let severity;
    if (roll < 0.5) severity = INJURY_SEVERITIES[0];
    else if (roll < 0.8) severity = INJURY_SEVERITIES[1];
    else if (roll < 0.95) severity = INJURY_SEVERITIES[2];
    else severity = INJURY_SEVERITIES[3];

    // Fast Healer shortens recovery, but a torn-season-ending injury stays
    // season-ending regardless — recovery speed doesn't erase the injury.
    const recoveryBonus = _INJURY_DATA.traits.getTraitBonus(player, 'injury', 'recovery');
    const gamesOut = severity.gamesOut >= 999
      ? 999
      : Math.max(1, Math.round(severity.gamesOut * Math.max(0.4, 1 + recoveryBonus * 0.06)));
    player.status.injury = { severity: severity.name, gamesRemaining: gamesOut };
  }
}

function decrementInjuriesForTeamGame(teamId) {
  _INJURY_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    if (p.status.injury) {
      p.status.injury.gamesRemaining -= 1;
      if (p.status.injury.gamesRemaining <= 0) p.status.injury = null;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { INJURY_SEVERITIES: INJURY_SEVERITIES, rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame };
}
```

- [ ] **Step 2: Update `fatigue.js`**

Replace the whole file with:
```js
var _FATIGUE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, traits: { getTraitBonus: getTraitBonus } };

function applyFatigueForGame(teamId, minutesByPlayerId, isBackToBack) {
  _FATIGUE_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    const minutes = minutesByPlayerId[p.id] || 0;
    const traitBonus = _FATIGUE_DATA.traits.getTraitBonus(p, 'fatigue', 'accumulation');
    const fatigueMultiplier = Math.max(0.5, 1 + traitBonus * 0.05);
    const gain = (minutes * 0.3 + (isBackToBack ? 8 : 0)) * fatigueMultiplier;
    p.status.fatigue = Math.min(100, p.status.fatigue + gain);
  });
}

function decayFatigueForRest(teamId, restDays) {
  _FATIGUE_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    p.status.fatigue = Math.max(0, p.status.fatigue - restDays * 15);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest };
}
```

- [ ] **Step 3: Run `validate-sim.js` to confirm no regression**

Run: `node scripts/validate-sim.js`
Expected: `All sim validations passed` — existing fixtures lack `hiddenTraits`/`hiddenPersonality`, so both new multipliers evaluate to their neutral baseline (`chanceMultiplier` ≈ 1, `fatigueMultiplier` = 1).

- [ ] **Step 4: Append `checkInjuryFatigueTraitIntegration` to `scripts/validate-traits.js`**

Insert before `console.log('All trait/scouting validations passed');`:
```js
function checkInjuryFatigueTraitIntegration() {
  const injuriesModule = require(path.join(__dirname, '..', 'injuries.js'));
  const fatigueModule = require(path.join(__dirname, '..', 'fatigue.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));

  const roster = leagueModule.getTeamRoster('BOS');
  const target = roster[0];
  const originalTraits = target.hiddenTraits;
  const originalPersonality = target.hiddenPersonality;
  const originalStatus = target.status;

  // Iron Man + max durabilityMindset should roll injuries less often than
  // Injury Prone + min durabilityMindset, over many trials.
  const rng = makeRng(44);
  let ironManInjuries = 0;
  let injuryProneInjuries = 0;
  const TRIALS = 3000;
  for (let i = 0; i < TRIALS; i++) {
    target.status = { morale: 70, fatigue: 80, injury: null };
    target.hiddenTraits = [{ key: 'ironMan', tier: 'legendary' }];
    target.hiddenPersonality = { durabilityMindset: 100 };
    injuriesModule.rollInjury(target, rng);
    if (target.status.injury) ironManInjuries++;

    target.status = { morale: 70, fatigue: 80, injury: null };
    target.hiddenTraits = [{ key: 'injuryProne', tier: 'legendary' }];
    target.hiddenPersonality = { durabilityMindset: 0 };
    injuriesModule.rollInjury(target, rng);
    if (target.status.injury) injuryProneInjuries++;
  }
  assert.ok(injuryProneInjuries > ironManInjuries, 'Injury Prone + low durabilityMindset should roll more injuries than Iron Man + high durabilityMindset over ' + TRIALS + ' trials');

  target.hiddenTraits = originalTraits;
  target.hiddenPersonality = originalPersonality;
  target.status = originalStatus;

  // High Motor should accumulate less fatigue per game than Poor Conditioning.
  const highMotorPlayer = { id: 'hm-1', status: { fatigue: 0 }, hiddenTraits: [{ key: 'highMotor', tier: 'legendary' }] };
  const poorConditioningPlayer = { id: 'pc-1', status: { fatigue: 0 }, hiddenTraits: [{ key: 'poorConditioning', tier: 'legendary' }] };
  const teamId = 'BOS';
  const originalRoster = teamsModule.getTeamById(teamId); // sanity the team exists
  assert.ok(originalRoster);

  const fakeLeagueModule = require(path.join(__dirname, '..', 'fatigue.js'));
  // applyFatigueForGame reads the roster via league.getTeamRoster(teamId), so
  // exercise the trait math directly through two real BOS players instead of
  // needing to inject a fake roster.
  const realA = roster[0];
  const realB = roster[1];
  const savedA = { traits: realA.hiddenTraits, status: realA.status };
  const savedB = { traits: realB.hiddenTraits, status: realB.status };
  realA.hiddenTraits = [{ key: 'highMotor', tier: 'legendary' }];
  realA.status = { fatigue: 0 };
  realB.hiddenTraits = [{ key: 'poorConditioning', tier: 'legendary' }];
  realB.status = { fatigue: 0 };

  const minutesByPlayerId = {};
  minutesByPlayerId[realA.id] = 36;
  minutesByPlayerId[realB.id] = 36;
  fatigueModule.applyFatigueForGame(teamId, minutesByPlayerId, false);

  assert.ok(realA.status.fatigue < realB.status.fatigue, 'High Motor should accumulate less fatigue than Poor Conditioning for the same minutes');

  realA.hiddenTraits = savedA.traits; realA.status = savedA.status;
  realB.hiddenTraits = savedB.traits; realB.status = savedB.status;

  console.log('checkInjuryFatigueTraitIntegration: OK');
}

checkInjuryFatigueTraitIntegration();
```

- [ ] **Step 5: Run the validator**

Run: `node scripts/validate-traits.js`
Expected: all checks pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add injuries.js fatigue.js scripts/validate-traits.js
git commit -m "feat: wire durability traits/personality into injuries and fatigue"
```

---

### Task 4: `freeAgency.js` + `trade.js` — personality integration

**Files:**
- Modify: `freeAgency.js`
- Modify: `trade.js`
- Modify: `scripts/validate-traits.js` (append `checkFreeAgencyTradeTraitIntegration`)

**Interfaces:**
- Consumes: nothing new from `traits.js` — this task uses `hiddenPersonality` directly (already present on every player after Batch A's retrofit).
- Produces: `scoreOffer(player, team, offer)` now nudges its score by loyalty/ambition/ego; `executeTrade(proposal)` now applies a small morale hit scaled by ego/loyalty to every traded player.

- [ ] **Step 1: Update `scoreOffer` in `freeAgency.js`**

Change:
```js
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.35;
  const marketWeight = 0.10;
  const prestigeWeight = 0.15;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  return salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight + marketScore * marketWeight + prestigeScore * prestigeWeight;
}
```
to:
```js
// Master-spec factors: money, contention, playing time, market size, prestige,
// plus hidden personality. There's no tracked "previous team" once a contract
// expires (teamId is wiped in decrementContracts), so Loyalty is modeled as
// "doesn't need max money to be satisfied" rather than an incumbent-team
// discount; Ambition amplifies how much contention matters; Ego penalizes
// offers implying a diminished role.
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.35;
  const marketWeight = 0.10;
  const prestigeWeight = 0.15;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  let score = salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight + marketScore * marketWeight + prestigeScore * prestigeWeight;

  const personality = player.hiddenPersonality;
  if (personality) {
    score += (1 - salaryScore) * (personality.loyalty - 50) / 100 * 0.06;
    score += (contentionScore - 0.5) * (personality.ambition - 50) / 100 * 0.16;
    if (ptScore < 0.5) {
      score -= Math.max(0, (personality.ego - 50) / 100) * 0.10;
    }
  }

  return score;
}
```

- [ ] **Step 2: Add a trade morale hit in `trade.js`**

Change:
```js
function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
}
```
to:
```js
function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
    // High-ego, high-loyalty players take being traded harder.
    if (player.hiddenPersonality && player.status) {
      const moraleHit = 3 + (player.hiddenPersonality.ego + player.hiddenPersonality.loyalty) / 20;
      player.status.morale = Math.max(0, player.status.morale - Math.round(moraleHit));
    }
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
}
```

- [ ] **Step 3: Run `validate-trades.js` and `validate-offseason.js` to confirm no regression**

Run: `node scripts/validate-trades.js && node scripts/validate-offseason.js`
Expected: both end with their `All ... validations passed` line — existing fixtures without `hiddenPersonality`/`status` are untouched by the new guarded code paths.

- [ ] **Step 4: Append `checkFreeAgencyTradeTraitIntegration` to `scripts/validate-traits.js`**

Insert before `console.log('All trait/scouting validations passed');`:
```js
function checkFreeAgencyTradeTraitIntegration() {
  const faModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  const team = teamsModule.getTeamById('BOS');
  const offer = { teamId: 'BOS', salary: 10000000, yearsRemaining: 3 };
  const basePlayer = { age: 27, position: 'SF', teamId: null, attributes: {} };

  const roster = leagueModule.getTeamRoster('BOS');
  const proxyForPlayingTime = Object.assign({}, roster[0], { position: 'SF' });

  const ambitiousOnLosingTeam = Object.assign({}, proxyForPlayingTime, { hiddenPersonality: { loyalty: 50, ambition: 100, ego: 50, coachability: 50, durabilityMindset: 50 } });
  const apatheticOnLosingTeam = Object.assign({}, proxyForPlayingTime, { hiddenPersonality: { loyalty: 50, ambition: 0, ego: 50, coachability: 50, durabilityMindset: 50 } });
  const losingTeam = Object.assign({}, teamsModule.getTeamById('BKN'), { timeline: 'rebuilding' });

  const ambitiousScore = faModule.scoreOffer(ambitiousOnLosingTeam, losingTeam, offer);
  const apatheticScore = faModule.scoreOffer(apatheticOnLosingTeam, losingTeam, offer);
  assert.ok(ambitiousScore < apatheticScore, 'a highly ambitious player should score a rebuilding-team offer lower than an unambitious player, all else equal');

  // Trade morale hit: high-ego/high-loyalty player should lose more morale than a low one.
  const highEgoPlayer = leagueModule.getPlayerById(roster[0].id);
  const savedPersonality = highEgoPlayer.hiddenPersonality;
  const savedStatus = highEgoPlayer.status;
  const savedTeamId = highEgoPlayer.teamId;

  highEgoPlayer.hiddenPersonality = { loyalty: 100, ambition: 50, ego: 100, coachability: 50, durabilityMindset: 50 };
  highEgoPlayer.status = { morale: 70, fatigue: 0, injury: null };
  const destTeamId = highEgoPlayer.teamId === 'BOS' ? 'MIA' : 'BOS';
  tradeModule.executeTrade({ assignments: [{ playerId: highEgoPlayer.id, fromTeamId: savedTeamId, toTeamId: destTeamId }], pickAssignments: [] });
  assert.ok(highEgoPlayer.status.morale < 70, 'trading a high-ego/high-loyalty player should reduce morale');

  highEgoPlayer.teamId = savedTeamId;
  highEgoPlayer.hiddenPersonality = savedPersonality;
  highEgoPlayer.status = savedStatus;

  console.log('checkFreeAgencyTradeTraitIntegration: OK');
}

checkFreeAgencyTradeTraitIntegration();
```

- [ ] **Step 5: Run the validator**

Run: `node scripts/validate-traits.js`
Expected: all checks pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add freeAgency.js trade.js scripts/validate-traits.js
git commit -m "feat: wire loyalty/ambition/ego personality into free agency and trades"
```

---

### Task 5: Day-tick scouting hook — `league.js`, `script.js`, `ui/simControls.js`

**Files:**
- Modify: `league.js:79-121,130-143` (`simulateDate`, `simulateNextDay`, `simulateThroughDate`)
- Modify: `ui/simControls.js` (3 call sites)
- Modify: `script.js` (`initSeason`, `handleAdvanceToOffseason`, `handleAdvanceToNewSeason`, add `tickScoutingForDay`)
- Modify: `ui/nav.js` (add Scouting nav item)

**Interfaces:**
- Produces: `simulateDate(season, dayIndex, settings, rng, onDayComplete)` — new optional 5th param, a callback invoked once per real day processed (fires exactly once even inside `simulateThroughDate`'s multi-day loop). `script.js`'s new `tickScoutingForDay(dayIndex)` reads `GameState` directly and calls `scouting.js`'s `tickPassiveScouting`.

- [ ] **Step 1: Add the `onDayComplete` hook to `league.js`**

Change:
```js
function simulateDate(season, dayIndex, settings, rng) {
  const deps = _simDeps();
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
```
to:
```js
function simulateDate(season, dayIndex, settings, rng, onDayComplete) {
  const deps = _simDeps();
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
```
Change the end of the function:
```js
  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      deps.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  return todaysGames;
}
```
to:
```js
  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      deps.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  if (onDayComplete) onDayComplete(dayIndex);
  return todaysGames;
}
```
And thread the param through the two callers:
```js
function simulateNextDay(season, currentDay, settings, rng, onDayComplete) {
  const nextDay = currentDay + 1;
  simulateDate(season, nextDay, settings, rng, onDayComplete);
  return nextDay;
}

function simulateThroughDate(season, currentDay, targetDay, settings, rng, onDayComplete) {
  let day = currentDay;
  while (day < targetDay) {
    day += 1;
    simulateDate(season, day, settings, rng, onDayComplete);
  }
  return day;
}
```

- [ ] **Step 2: Add `tickScoutingForDay` to `script.js` and update `initSeason`**

Change:
```js
function initSeason() {
  GameState.rng = makeRng(Date.now());
  const games = generateSeasonGames(GameState.rng, TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  GameState.season = { games: games, currentDay: -1 };
}
```
to:
```js
function initSeason() {
  GameState.rng = makeRng(Date.now());
  const games = generateSeasonGames(GameState.rng, TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  GameState.season = { games: games, currentDay: -1 };

  ensureHiddenPlayerData(PLAYERS_2026);
  ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
  GameState.upcomingDraftClass = DRAFT_PROSPECTS_2026;
  GameState.scouting = initScoutingState();
}

// Ticked once per real day advanced (see league.js's onDayComplete hook,
// threaded through simulateNextDay/simulateThroughDate). Playoff series don't
// advance GameState.season.currentDay, so scouting doesn't tick during
// playoffs — a deliberate simplification, since rosters are effectively
// locked in by then anyway.
function tickScoutingForDay(dayIndex) {
  if (!GameState.scouting) return;
  const team = getTeamById(GameState.userTeamId);
  const ownRosterIds = getTeamRoster(GameState.userTeamId).map(function (p) { return p.id; });
  const todaysGames = GameState.season.games.filter(function (g) {
    return g.day === dayIndex && g.played && (g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId);
  });
  let playedOpponentIds = [];
  todaysGames.forEach(function (g) {
    const oppId = g.homeTeamId === GameState.userTeamId ? g.awayTeamId : g.homeTeamId;
    playedOpponentIds = playedOpponentIds.concat(getTeamRoster(oppId).map(function (p) { return p.id; }));
  });
  const prospectIds = (GameState.upcomingDraftClass || []).map(function (p) { return p.id; });
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  const daysUntilDraft = lastDay - dayIndex;
  tickPassiveScouting(GameState.scouting, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft);
}
```

- [ ] **Step 3: Update `handleAdvanceToOffseason`/`handleAdvanceToNewSeason` in `script.js`**

Change:
```js
function handleAdvanceToOffseason() {
  const isFirstDraft = GameState.leagueYear === undefined;
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, isFirstDraft);
  GameState.lastDraftResults = result.draftResults;
  GameState.offseasonStage = 'draft';
  renderView('draft');
}

function handleAdvanceToNewSeason() {
  const games = generateNewSeason(GameState.rng);
  GameState.season = { games: games, currentDay: -1 };
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  renderView('dashboard');
}
```
to:
```js
function handleAdvanceToOffseason() {
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
  GameState.lastDraftResults = result.draftResults;
  GameState.offseasonStage = 'draft';
  renderView('draft');
}

function handleAdvanceToNewSeason() {
  const result = generateNewSeason(GameState.rng);
  GameState.season = { games: result.games, currentDay: -1 };
  GameState.upcomingDraftClass = result.nextDraftClass;
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  renderView('dashboard');
}
```

- [ ] **Step 4: Update the three `ui/simControls.js` call sites to pass `tickScoutingForDay`**

Change:
```js
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay, GameState.settings, GameState.rng);
    }, 1);
```
(inside `handleNextGame`) to:
```js
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay, GameState.settings, GameState.rng, tickScoutingForDay);
    }, 1);
```
Change (inside `handleNextDay`):
```js
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateNextDay(GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng);
  }, 1);
```
to:
```js
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateNextDay(GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng, tickScoutingForDay);
  }, 1);
```
Change (inside `handleSimToEnd`):
```js
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng);
    }, 1);
```
to:
```js
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng, tickScoutingForDay);
    }, 1);
```

- [ ] **Step 5: Add a Scouting nav entry in `ui/nav.js`**

Change:
```js
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'roster', label: 'Roster' },
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'trade', label: 'Trade Center' },
  { id: 'freeagency', label: 'Free Agency' },
  { id: 'draft', label: 'Draft' },
  { id: 'salarycap', label: 'Salary Cap' },
  { id: 'news', label: 'League News' },
  { id: 'awards', label: 'Awards' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
];
```
to:
```js
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'roster', label: 'Roster' },
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'trade', label: 'Trade Center' },
  { id: 'freeagency', label: 'Free Agency' },
  { id: 'draft', label: 'Draft' },
  { id: 'scouting', label: 'Scouting' },
  { id: 'salarycap', label: 'Salary Cap' },
  { id: 'news', label: 'League News' },
  { id: 'awards', label: 'Awards' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
];
```

- [ ] **Step 6: Run every Node validator to confirm nothing broke (no browser yet — `renderScouting` doesn't exist until Task 6, so `BUILT_VIEWS.scouting` isn't wired up yet either)**

Run: `node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js`
Expected: all five end with their `All ... validations passed` line. (`league.js`'s existing Node tests call `simulateDate`/`simulateNextDay`/`simulateThroughDate` without a 5th argument — backward compatible since `onDayComplete` is optional.)

- [ ] **Step 7: Commit**

```bash
git add league.js script.js ui/simControls.js ui/nav.js
git commit -m "feat: daily scouting tick hook + Scouting nav entry"
```

---

### Task 6: `ui/scouting.js` — watchlist, point allocation, scouting reports

**Files:**
- Create: `ui/scouting.js`

**Interfaces:**
- Consumes: `scouting.js` (`setWatchlisted`, `allocateScoutPoints`, `getRevealedView`), `traits.js` (`TRAIT_TAXONOMY_BY_KEY`), `league.js` (`getPlayerById`), `teams.js` (`getTeamById`), `players-2026.js` (`PLAYERS_2026`), `GameState` (global).
- Produces: `renderScouting(container, userTeamId)` — matches the signature every other `BUILT_VIEWS.*` renderer uses (`function (container, userTeamId) {...}`, see `renderRoster`/`renderTradeCenter`).

- [ ] **Step 1: Write `ui/scouting.js`**

```js
function scoutablePool() {
  // Everyone leaguewide is scoutable, not just your own roster — matches the
  // "Prospects + full league scouting" scope decided during brainstorming.
  return PLAYERS_2026.concat(GameState.upcomingDraftClass || []);
}

function findScoutableById(id) {
  return getPlayerById(id) || (GameState.upcomingDraftClass || []).find(function (p) { return p.id === id; });
}

function renderScoutingReport(container, playerId) {
  const player = findScoutableById(playerId);
  if (!player) { container.innerHTML = ''; return; }
  const target = GameState.scouting.targets[playerId];
  const confidence = target ? target.confidence : 0;
  const view = getRevealedView(player, confidence);

  let html = '<h3>Scouting Report: ' + player.name + '</h3>';
  html += '<p>Confidence: ' + Math.round(confidence) + '% (' + view.level + ')</p>';

  html += '<h4>Traits</h4>';
  if (view.level === 'hidden') {
    html += '<p>???</p>';
  } else if (view.level === 'fuzzy') {
    html += view.traits.length === 0 ? '<p>(none detected)</p>' : '<ul>' + view.traits.map(function (t) {
      return '<li>' + t.name + ': ' + t.rangeLabel + '?</li>';
    }).join('') + '</ul>';
  } else {
    html += view.traits.length === 0 ? '<p>(none)</p>' : '<ul>' + view.traits.map(function (t) {
      const def = TRAIT_TAXONOMY_BY_KEY[t.key];
      return '<li>' + (def ? def.name : t.key) + ': ' + t.tier + '</li>';
    }).join('') + '</ul>';
  }

  html += '<h4>Personality</h4>';
  if (view.level === 'hidden') {
    html += '<p>???</p>';
  } else {
    html += '<ul>' + Object.keys(view.personality).map(function (k) {
      return '<li>' + k + ': ' + view.personality[k] + '</li>';
    }).join('') + '</ul>';
  }

  html += '<h4>Tendencies</h4>';
  if (view.level !== 'exact') {
    html += '<p>???</p>';
  } else {
    html += '<ul>' + Object.keys(view.tendencies).map(function (k) {
      return '<li>' + k + ': ' + view.tendencies[k] + '</li>';
    }).join('') + '</ul>';
  }

  container.innerHTML = html;
}

function renderScouting(container, userTeamId) {
  function draw() {
    const state = GameState.scouting;
    let html = '<h2>Scouting</h2>';
    html += '<p>Scout points available this week: ' + Math.round(state.pointsAvailable) + '</p>';

    const watchlistIds = Object.keys(state.targets).filter(function (id) { return state.targets[id].watchlisted; });
    html += '<h3>Watchlist</h3>';
    if (watchlistIds.length === 0) {
      html += '<p>No players watchlisted yet. Add players below.</p>';
    } else {
      html += '<table><thead><tr><th>Name</th><th>Team</th><th>Confidence</th><th>Allocate Points</th><th></th></tr></thead><tbody>';
      watchlistIds.forEach(function (id) {
        const player = findScoutableById(id);
        if (!player) return;
        const conf = state.targets[id].confidence;
        html += '<tr><td>' + player.name + '</td><td>' + (player.teamId ? getTeamById(player.teamId).name : 'Draft Prospect') + '</td>' +
          '<td>' + Math.round(conf) + '%</td>' +
          '<td><input type="number" min="0" max="' + Math.round(state.pointsAvailable) + '" value="10" data-alloc-id="' + id + '" style="width:60px"> <button data-spend-id="' + id + '">Spend</button></td>' +
          '<td><button data-report-id="' + id + '">View Report</button> <button data-unwatch-id="' + id + '">Remove</button></td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h3>Add to Watchlist</h3>';
    html += '<select id="scouting-add-select"><option value="">Choose a player or prospect...</option>';
    scoutablePool().forEach(function (p) {
      if (state.targets[p.id] && state.targets[p.id].watchlisted) return;
      html += '<option value="' + p.id + '">' + p.name + (p.teamId ? ' (' + getTeamById(p.teamId).name + ')' : ' (Prospect)') + '</option>';
    });
    html += '</select> <button id="scouting-add-btn">Add</button>';

    html += '<div id="scouting-report"></div>';

    container.innerHTML = html;

    document.getElementById('scouting-add-btn').addEventListener('click', function () {
      const select = document.getElementById('scouting-add-select');
      if (!select.value) return;
      setWatchlisted(state, select.value, true);
      draw();
    });

    container.querySelectorAll('button[data-unwatch-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setWatchlisted(state, btn.getAttribute('data-unwatch-id'), false);
        draw();
      });
    });

    container.querySelectorAll('button[data-spend-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-spend-id');
        const input = container.querySelector('input[data-alloc-id="' + id + '"]');
        const points = Number(input.value) || 0;
        allocateScoutPoints(state, id, points);
        draw();
      });
    });

    container.querySelectorAll('button[data-report-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderScoutingReport(document.getElementById('scouting-report'), btn.getAttribute('data-report-id'));
      });
    });

    if (GameState.pendingScoutReportId) {
      const pendingId = GameState.pendingScoutReportId;
      GameState.pendingScoutReportId = null;
      renderScoutingReport(document.getElementById('scouting-report'), pendingId);
    }
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderScouting: renderScouting, renderScoutingReport: renderScoutingReport };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/scouting.js
git commit -m "feat: scouting UI (watchlist, point allocation, reports)"
```

---

### Task 7: Wire the Scouting view into the app + "Scout Report" button on the roster

**Files:**
- Modify: `script.js` (`BUILT_VIEWS`)
- Modify: `ui/roster.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `ui/scouting.js`'s `renderScouting`/`renderScoutingReport` (Task 6)

- [ ] **Step 1: Add `scouting` to `BUILT_VIEWS` in `script.js`**

Change:
```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) { renderDraftResults(container, GameState.lastDraftResults || []); }
};
```
to:
```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) { renderDraftResults(container, GameState.lastDraftResults || []); },
  scouting: renderScouting
};
```

- [ ] **Step 2: Add a "Scout Report" button to each roster row in `ui/roster.js`**

Change:
```js
      html += '<tr>' +
        '<td>' + p.name + '</td>' +
        '<td>' + p.position + '</td>' +
        '<td>' + p.age + '</td>' +
        '<td>' + p.overall + '</td>' +
        '<td>' + p.potential + '</td>' +
        '<td>' + avg.ppg.toFixed(1) + '</td>' +
        '<td>' + avg.rpg.toFixed(1) + '</td>' +
        '<td>' + avg.apg.toFixed(1) + '</td>' +
        '<td>' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td>$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td>' + p.contract.yearsRemaining + '</td>' +
        '<td><button data-waive-id="' + p.id + '">Waive</button></td>' +
        '</tr>';
```
to:
```js
      html += '<tr>' +
        '<td>' + p.name + '</td>' +
        '<td>' + p.position + '</td>' +
        '<td>' + p.age + '</td>' +
        '<td>' + p.overall + '</td>' +
        '<td>' + p.potential + '</td>' +
        '<td>' + avg.ppg.toFixed(1) + '</td>' +
        '<td>' + avg.rpg.toFixed(1) + '</td>' +
        '<td>' + avg.apg.toFixed(1) + '</td>' +
        '<td>' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td>$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td>' + p.contract.yearsRemaining + '</td>' +
        '<td><button data-waive-id="' + p.id + '">Waive</button> <button data-scout-id="' + p.id + '">Scout</button></td>' +
        '</tr>';
```
And wire the new buttons — change:
```js
    container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const playerId = btn.getAttribute('data-waive-id');
        const result = waivePlayer(playerId);
        if (!result.success) {
          alert(result.reason);
          return;
        }
        roster = getTeamRoster(teamId).slice();
        draw();
      });
    });
  }

  draw();
}
```
to:
```js
    container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const playerId = btn.getAttribute('data-waive-id');
        const result = waivePlayer(playerId);
        if (!result.success) {
          alert(result.reason);
          return;
        }
        roster = getTeamRoster(teamId).slice();
        draw();
      });
    });

    container.querySelectorAll('button[data-scout-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        GameState.pendingScoutReportId = btn.getAttribute('data-scout-id');
        renderView('scouting');
      });
    });
  }

  draw();
}
```

- [ ] **Step 3: Add `ui/scouting.js` to `index.html`, after `ui/freeAgency.js` and before `script.js`**

Change:
```html
  <script src="freeAgency.js"></script>
  <script src="freeAgencyBidding.js"></script>
  <script src="ui/freeAgency.js"></script>
  <script src="script.js"></script>
```
to:
```html
  <script src="freeAgency.js"></script>
  <script src="freeAgencyBidding.js"></script>
  <script src="ui/freeAgency.js"></script>
  <script src="ui/scouting.js"></script>
  <script src="script.js"></script>
```

- [ ] **Step 4: Run every Node validator one final time**

Run: `node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js`
Expected: all five end with their `All ... validations passed` line.

- [ ] **Step 5: Commit**

```bash
git add script.js ui/roster.js index.html
git commit -m "feat: wire Scouting view into app shell + Scout Report button on roster"
```

---

### Task 8: End-to-end browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the app and open it in the browser**

Start a local server (use a fresh port to avoid stale-JS caching, per this project's established pattern) and open `mcp__Claude_Browser__preview_start`/`navigate` to it. Select any team to start a new game.

- [ ] **Step 2: Verify the Roster view's Scout Report button**

Navigate to Roster, click "Scout" on any player, confirm it navigates to the Scouting view and immediately shows that player's report (should read "Confidence: 0% (hidden)" with `???` for traits/personality/tendencies, since no scouting investment has happened yet).

- [ ] **Step 3: Verify watchlisting and point allocation**

On the Scouting view, add 2-3 players (including at least one draft prospect from the dropdown) to the watchlist, confirm "Scout points available this week" shows a number matching `100 + floor(prestige/2)` for the user's team, spend points on one target, and confirm its confidence percentage rises and the points-available number drops accordingly.

- [ ] **Step 4: Verify passive confidence + reveal thresholds via sim**

Use Sim Controls to advance several days (own roster players on the watchlist should slowly gain confidence with no manual spending). Spend enough points on one watchlisted player to push them past 30% (fuzzy reveal — trait names visible with a tier range and personality as Low/Medium/High buckets) and check the console for zero errors throughout.

- [ ] **Step 5: Verify integration doesn't break the existing full-season loop**

Use "Sim to End of Regular Season", then playoffs, then "Advance to Offseason" → confirm the draft still runs with 60 results, "Go to Free Agency" still works, "Start New Season" still produces a fresh 1230-game season — and confirm the Scouting view's watchlist/prospect dropdown now shows the *new* upcoming draft class (not the just-drafted one) with fresh (reset-to-0) confidence for anyone not previously watchlisted, and zero console errors at any step.

- [ ] **Step 6: Report results to the user**

No commit for this task (verification only) — summarize what was tested and any issues found/fixed.
