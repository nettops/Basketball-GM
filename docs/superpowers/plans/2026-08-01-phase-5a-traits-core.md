# Phase 5 Batch A — Hidden Traits Core Data Model & Scouting Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this project's established preference) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless data/logic layer for Phase 5 — the 48-trait taxonomy, deterministic procedural generators for traits/personality/tendencies, the one-time retrofit of existing players, and the scouting confidence/reveal engine. No UI, no gameplay integration yet (that's Batch B). Fully covered by a new `scripts/validate-traits.js`.

**Architecture:** `traits.js` is a new, dependency-light file (only `rng.js`) holding the taxonomy and pure generator functions. `scouting.js` holds the scout-points economy and confidence/reveal logic, depending only on `traits.js`. A small, targeted fix to `seasonTransition.js`/`draft.js`/`script.js` moves next-draft-class generation earlier so there's something to scout mid-season in year 2+.

**Tech Stack:** Vanilla JS, dual browser-global/Node-require module pattern (see `CLAUDE.md`/existing files), Node `assert` for validation — matches every prior phase.

## Global Constraints

- No third-party dependencies; classic `<script>` tags only, Node used only for `scripts/validate-*.js`.
- Every new file follows the `var _XXX_DATA = (typeof require !== 'undefined') ? {...} : {...}` dual-module pattern.
- Deterministic seeded randomness via `rng.js`'s `makeRng` — no bare `Math.random()` in gameplay logic (existing `draftProspects.js` prospect `id` generation is a known pre-existing exception, not something this plan touches).
- `docs/superpowers/specs/2026-08-01-phase-5-traits-scouting-design.md` is the source of truth for the design; this plan implements it exactly, with the one architecture addendum (next-class-generation timing) the user approved during planning.

---

### Task 1: `traits.js` — trait taxonomy + generic bonus lookup

**Files:**
- Create: `traits.js`
- Modify: `data.js` (retire the Phase 1 `TRAIT_TAXONOMY_STUB` placeholder)
- Test: inline in `scripts/validate-traits.js` (created in Task 7)

**Interfaces:**
- Produces: `TRAIT_TAXONOMY` (array of 48 defs), `TRAIT_TAXONOMY_BY_KEY` (object keyed by `key`), `TRAIT_TIERS` (`['bronze','silver','gold','hof','legendary']`), `getTraitBonus(player, system, stat)` — sums `tierValues[tier] * direction` over every trait in `player.hiddenTraits` whose `effect.system === system && effect.stat === stat`.

- [ ] **Step 1: Write `traits.js` with the taxonomy and bonus lookup**

```js
var _TRAITS_DATA = (typeof require !== 'undefined')
  ? { rng: require('./rng.js') }
  : { rng: { makeRng: makeRng } };

const TRAIT_TIER_SCALE = { bronze: 1, silver: 2, gold: 3, hof: 5, legendary: 8 };
const SUPERSTAR_TIER_SCALE = { bronze: 2, silver: 4, gold: 6, hof: 9, legendary: 14 };
const TRAIT_TIERS = ['bronze', 'silver', 'gold', 'hof', 'legendary'];

// 48 traits, 8 per category. `affinity` is the attribute key (from data.js's
// ATTRIBUTE_KEYS) that makes a player more likely to roll this trait; null for
// traits with no clean attribute proxy. `effect.system`/`effect.stat` are the
// exact (system, stat) pair Batch B's integration points query via
// getTraitBonus — every trait maps to exactly one, no per-trait special-casing
// needed at call sites except Mentor (cross-player, see progression.js).
const TRAIT_TAXONOMY = [
  // --- Offensive ---
  { key: 'sharpshooter', name: 'Sharpshooter', category: 'offensive', affinity: 'threePoint', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'postThreat', name: 'Post Threat', category: 'offensive', affinity: 'postScoring', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'finisher', name: 'Finisher', category: 'offensive', affinity: 'insideScoring', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'playmaker', name: 'Playmaker', category: 'offensive', affinity: 'passing', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pickRollMaestro', name: 'Pick & Roll Maestro', category: 'offensive', affinity: 'ballHandling', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'offBallMover', name: 'Off-Ball Mover', category: 'offensive', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'freeThrowAce', name: 'Free Throw Ace', category: 'offensive', affinity: 'freeThrow', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'highMotorScorer', name: 'High Motor Scorer', category: 'offensive', affinity: 'workEthic', effect: { system: 'boxscore', stat: 'usage', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Defensive ---
  { key: 'lockdownDefender', name: 'Lockdown Defender', category: 'defensive', affinity: 'perimeterDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'rimProtector', name: 'Rim Protector', category: 'defensive', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'block', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pickpocket', name: 'Pickpocket', category: 'defensive', affinity: 'steal', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'defensiveAnchor', name: 'Defensive Anchor', category: 'defensive', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'chargeTaker', name: 'Charge Taker', category: 'defensive', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'switchable', name: 'Switchable', category: 'defensive', affinity: 'perimeterDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'glassCleaner', name: 'Glass Cleaner', category: 'defensive', affinity: 'defReb', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pointOfAttackMenace', name: 'Point-of-Attack Menace', category: 'defensive', affinity: 'steal', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Athletic ---
  { key: 'eliteSpeed', name: 'Elite Speed', category: 'athletic', affinity: 'speed', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'explosiveVertical', name: 'Explosive Vertical', category: 'athletic', affinity: 'vertical', effect: { system: 'boxscore', stat: 'block', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'ironMan', name: 'Iron Man', category: 'athletic', affinity: 'strength', effect: { system: 'injury', stat: 'chance', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'quickTwitch', name: 'Quick Twitch', category: 'athletic', affinity: 'acceleration', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'strengthAdvantage', name: 'Strength Advantage', category: 'athletic', affinity: 'strength', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'highMotor', name: 'High Motor', category: 'athletic', affinity: 'workEthic', effect: { system: 'fatigue', stat: 'accumulation', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'springyRebounder', name: 'Springy Rebounder', category: 'athletic', affinity: 'offReb', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'fastHealer', name: 'Fast Healer', category: 'athletic', affinity: 'strength', effect: { system: 'injury', stat: 'recovery', direction: -1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Mental ---
  { key: 'highIQ', name: 'High IQ', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'clutchGene', name: 'Clutch Gene', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'coachable', name: 'Coachable', category: 'mental', affinity: 'workEthic', effect: { system: 'progression', stat: 'self', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'naturalLeader', name: 'Natural Leader', category: 'mental', affinity: 'leadership', effect: { system: 'chemistry', stat: 'team', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'bigGameCompetitor', name: 'Big-Game Competitor', category: 'mental', affinity: 'leadership', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'filmJunkie', name: 'Film Junkie', category: 'mental', affinity: 'workEthic', effect: { system: 'progression', stat: 'self', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'poise', name: 'Poise', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'mentor', name: 'Mentor', category: 'mental', affinity: 'leadership', effect: { system: 'progression', stat: 'teammate', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Negative (tier = severity; Legendary is the WORST version of the flaw) ---
  { key: 'injuryProne', name: 'Injury Prone', category: 'negative', affinity: null, effect: { system: 'injury', stat: 'chance', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'streaky', name: 'Streaky', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'scoring', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'turnoverProne', name: 'Turnover Prone', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'assist', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'foulProne', name: 'Foul Prone', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'defense', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'poorConditioning', name: 'Poor Conditioning', category: 'negative', affinity: null, effect: { system: 'fatigue', stat: 'accumulation', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'lockerRoomCancer', name: 'Locker Room Cancer', category: 'negative', affinity: null, effect: { system: 'chemistry', stat: 'team', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'stubborn', name: 'Stubborn', category: 'negative', affinity: null, effect: { system: 'progression', stat: 'self', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'chokeArtist', name: 'Choke Artist', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'scoring', direction: -1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Superstar (rare; gated to overall>=85 or potential>=88 in generateHiddenTraits) ---
  { key: 'alphaDog', name: 'Alpha Dog', category: 'superstar', affinity: 'leadership', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'iceInVeins', name: 'Ice in Veins', category: 'superstar', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'twoWayStar', name: 'Two-Way Star', category: 'superstar', affinity: null, effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'floorGeneral', name: 'Floor General', category: 'superstar', affinity: 'passing', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'unstoppableForce', name: 'Unstoppable Force', category: 'superstar', affinity: 'strength', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'dpoyCaliber', name: 'DPOY Caliber', category: 'superstar', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'franchiseCornerstone', name: 'Franchise Cornerstone', category: 'superstar', affinity: 'leadership', effect: { system: 'chemistry', stat: 'team', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'humanHighlightReel', name: 'Human Highlight Reel', category: 'superstar', affinity: 'vertical', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE }
];

const TRAIT_TAXONOMY_BY_KEY = {};
TRAIT_TAXONOMY.forEach(function (t) { TRAIT_TAXONOMY_BY_KEY[t.key] = t; });

function getTraitBonus(player, system, stat) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== system || def.effect.stat !== stat) return sum;
    return sum + def.tierValues[t.tier] * def.effect.direction;
  }, 0);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAIT_TAXONOMY: TRAIT_TAXONOMY,
    TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY,
    TRAIT_TIERS: TRAIT_TIERS,
    getTraitBonus: getTraitBonus
  };
}
```

- [ ] **Step 2: Sanity-check the array in Node**

Run: `node -e "const t = require('./traits.js'); console.log(t.TRAIT_TAXONOMY.length, Object.keys(t.TRAIT_TAXONOMY_BY_KEY).length);"`
Expected: `48 48`

- [ ] **Step 3: Retire the Phase 1 stub in `data.js`**

`traits.js`'s `TRAIT_TAXONOMY` is now the real taxonomy — the Phase 1 placeholder is dead weight. Change:
```js
const RATING_MIN = 25;
const RATING_MAX = 99;

// Populated in Phase 5 (hidden traits & personality system). Empty here by design.
const TRAIT_TAXONOMY_STUB = [];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATTRIBUTE_KEYS, POSITIONS, CONFERENCES, DIVISIONS,
    CAP_CONSTANTS, RATING_MIN, RATING_MAX, TRAIT_TAXONOMY_STUB
  };
}
```
to:
```js
const RATING_MIN = 25;
const RATING_MAX = 99;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATTRIBUTE_KEYS, POSITIONS, CONFERENCES, DIVISIONS,
    CAP_CONSTANTS, RATING_MIN, RATING_MAX
  };
}
```

- [ ] **Step 4: Run `validate-data.js` to confirm nothing referenced the stub**

Run: `node scripts/validate-data.js`
Expected: ends with `All data validations passed` (a `grep` during planning confirmed nothing outside `data.js` itself references `TRAIT_TAXONOMY_STUB`).

- [ ] **Step 5: Commit**

```bash
git add traits.js data.js
git commit -m "feat: Phase 5 trait taxonomy (48 traits, 6 categories, 5 tiers)"
```

---

### Task 2: `traits.js` — procedural generators (traits, personality, tendencies)

**Files:**
- Modify: `traits.js`

**Interfaces:**
- Consumes: `TRAIT_TAXONOMY`, `TRAIT_TIERS` (Task 1), `_TRAITS_DATA.rng.makeRng` (`rng.js`)
- Produces: `generateHiddenTraits(player, rng)` → array of `{key, tier}`; `generatePersonality(player, rng)` → `{loyalty, ambition, ego, coachability, durabilityMindset}`; `generateTendencies(player, rng)` → 10-key tendency object. All pure functions of `(player.attributes/overall/potential, rng)` — no hidden state, so identical inputs always produce identical outputs.

- [ ] **Step 1: Add the weighted-sampling helper and generators to `traits.js`**

Append before the `module.exports` block:

```js
function weightedSampleWithoutReplacement(items, weightFn, count, rng) {
  const pool = items.slice();
  const result = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const weights = pool.map(weightFn);
    const total = weights.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

function traitWeight(player, def) {
  if (def.category === 'superstar') {
    return (player.overall >= 85 || player.potential >= 88) ? 1 : 0;
  }
  let w = 1;
  if (def.affinity) {
    const attr = player.attributes[def.affinity] || 50;
    w = Math.max(0.1, (attr - 40) / 20);
  }
  if (def.category === 'negative') {
    const flawProxy = 100 - (player.attributes.workEthic + player.attributes.basketballIQ) / 2;
    w *= Math.max(0.3, flawProxy / 50);
  }
  return w;
}

function pickPositiveTier(player, rng) {
  const skill = (player.overall + player.potential) / 2;
  const roll = rng() * 100 + (skill - 60);
  if (roll < 30) return 'bronze';
  if (roll < 55) return 'silver';
  if (roll < 78) return 'gold';
  if (roll < 92) return 'hof';
  return 'legendary';
}

function pickNegativeTier(rng) {
  const roll = rng() * 100;
  if (roll < 45) return 'bronze';
  if (roll < 75) return 'silver';
  if (roll < 92) return 'gold';
  if (roll < 98) return 'hof';
  return 'legendary';
}

// Trait count scales with overall: ~1 at bench-level (45 OVR), ~2 at a solid
// rotation player (60 OVR), up to 5-6 for a top-tier star (95+ OVR). Superstar
// traits are only reachable via traitWeight's overall/potential gate above,
// and even then a candidate has to win the weighted draw against everything else.
function generateHiddenTraits(player, rng) {
  const traitCount = Math.max(1, Math.min(6, Math.round((player.overall - 45) / 9)));
  const candidates = TRAIT_TAXONOMY.filter(function (def) { return traitWeight(player, def) > 0; });
  const selected = weightedSampleWithoutReplacement(candidates, function (def) { return traitWeight(player, def); }, Math.min(traitCount, candidates.length), rng);
  return selected.map(function (def) {
    const tier = def.category === 'negative' ? pickNegativeTier(rng) : pickPositiveTier(player, rng);
    return { key: def.key, tier: tier };
  });
}

function personalityAxis(base, spread, rng) {
  return Math.max(0, Math.min(100, Math.round(base + (rng() - 0.5) * spread)));
}

function generatePersonality(player, rng) {
  const a = player.attributes;
  return {
    loyalty: personalityAxis(50, 90, rng),
    ambition: personalityAxis(50, 90, rng),
    ego: personalityAxis(30 + player.overall * 0.4, 50, rng),
    coachability: personalityAxis((a.workEthic + a.basketballIQ) / 2, 60, rng),
    durabilityMindset: personalityAxis((a.strength + a.workEthic) / 2, 60, rng)
  };
}

// Shot-mix values are an approximate normalized split (they won't sum to
// exactly 100 after independent rounding — that's fine, they're a bias input
// to simEngineBoxScore.js, not a precise possession accounting).
function generateTendencies(player, rng) {
  const a = player.attributes;
  const rawThree = a.threePoint;
  const rawMid = a.midRange;
  const rawInside = a.insideScoring + a.postScoring / 2;
  const shotTotal = rawThree + rawMid + rawInside;
  return {
    threeTendency: Math.round((rawThree / shotTotal) * 100),
    midTendency: Math.round((rawMid / shotTotal) * 100),
    insideTendency: Math.round((rawInside / shotTotal) * 100),
    isoTendency: personalityAxis(a.ballHandling, 60, rng),
    catchAndShootTendency: personalityAxis(a.threePoint, 60, rng),
    postTendency: personalityAxis(a.postScoring, 60, rng),
    transitionTendency: personalityAxis(a.speed, 60, rng),
    clutchUsage: personalityAxis(a.basketballIQ, 70, rng),
    gambleTendency: personalityAxis(a.steal, 70, rng),
    reboundAggression: personalityAxis((a.offReb + a.defReb) / 2, 70, rng)
  };
}
```

- [ ] **Step 2: Update `module.exports`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAIT_TAXONOMY: TRAIT_TAXONOMY,
    TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY,
    TRAIT_TIERS: TRAIT_TIERS,
    getTraitBonus: getTraitBonus,
    generateHiddenTraits: generateHiddenTraits,
    generatePersonality: generatePersonality,
    generateTendencies: generateTendencies
  };
}
```

- [ ] **Step 3: Smoke-test in Node**

Run:
```bash
node -e "
const t = require('./traits.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(42);
const star = { overall: 96, potential: 97, attributes: { threePoint: 90, midRange: 70, insideScoring: 80, postScoring: 40, ballHandling: 85, passing: 60, steal: 55, offReb: 40, defReb: 60, basketballIQ: 88, workEthic: 80, strength: 75, speed: 70 } };
console.log(JSON.stringify(t.generateHiddenTraits(star, rng)));
console.log(JSON.stringify(t.generatePersonality(star, rng)));
console.log(JSON.stringify(t.generateTendencies(star, rng)));
"
```
Expected: three JSON lines print without error — an array of `{key,tier}` objects (1-6 entries), a 5-key object with values 0-100, and a 10-key object with numeric values.

- [ ] **Step 4: Commit**

```bash
git add traits.js
git commit -m "feat: procedural trait/personality/tendency generators"
```

---

### Task 3: `traits.js` — one-time retrofit for existing players + stub field additions

**Files:**
- Modify: `traits.js`
- Modify: `players-2026.js:40-65` (`mkPlayer`)
- Modify: `draftProspects.js:31-52` (`mkProspect`)

**Interfaces:**
- Produces: `ensureHiddenPlayerData(players)` — for every player in the array whose `hiddenTraits` is still empty, deterministically (seeded off `player.id`) fills `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies` in place. No-op for players that already have trait data (idempotent).

- [ ] **Step 1: Add `hiddenTendencies: {}` stub to `mkPlayer` in `players-2026.js`**

In `players-2026.js`, change:
```js
    attributes: makeAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {}
  };
```
to:
```js
    attributes: makeAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {},
    hiddenTendencies: {}
  };
```

- [ ] **Step 2: Add the same stub to `mkProspect` in `draftProspects.js`**

Change:
```js
    attributes: makeProspectAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {},
    bustChance: bustChance,
```
to:
```js
    attributes: makeProspectAttributes(overall, archetype),
    hiddenTraits: [],
    hiddenPersonality: {},
    hiddenTendencies: {},
    bustChance: bustChance,
```

- [ ] **Step 3: Add `ensureHiddenPlayerData` to `traits.js`**

Append before `module.exports`:

```js
// Cheap deterministic string->uint32 hash so ensureHiddenPlayerData can seed a
// per-player rng purely from the player's stable id — no external rng needed,
// and re-running it twice on the same roster always produces the same result.
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function ensureHiddenPlayerData(players) {
  players.forEach(function (p) {
    if (p.hiddenTraits && p.hiddenTraits.length > 0) return;
    const playerRng = _TRAITS_DATA.rng.makeRng(hashId(p.id));
    p.hiddenTraits = generateHiddenTraits(p, playerRng);
    p.hiddenPersonality = generatePersonality(p, playerRng);
    p.hiddenTendencies = generateTendencies(p, playerRng);
  });
}
```

- [ ] **Step 4: Add `ensureHiddenPlayerData` to `module.exports`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAIT_TAXONOMY: TRAIT_TAXONOMY,
    TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY,
    TRAIT_TIERS: TRAIT_TIERS,
    getTraitBonus: getTraitBonus,
    generateHiddenTraits: generateHiddenTraits,
    generatePersonality: generatePersonality,
    generateTendencies: generateTendencies,
    ensureHiddenPlayerData: ensureHiddenPlayerData
  };
}
```

- [ ] **Step 5: Smoke-test retrofit + determinism in Node**

Run:
```bash
node -e "
const t = require('./traits.js');
const { PLAYERS_2026 } = require('./players-2026.js');
t.ensureHiddenPlayerData(PLAYERS_2026);
const before = JSON.stringify(PLAYERS_2026[0].hiddenTraits);
t.ensureHiddenPlayerData(PLAYERS_2026); // idempotent second pass
const after = JSON.stringify(PLAYERS_2026[0].hiddenTraits);
console.log(before === after, PLAYERS_2026.filter(p => p.hiddenTraits.length === 0).length);
"
```
Expected: `true 0` — data is unchanged by the second pass, and zero players are left with empty trait arrays.

- [ ] **Step 6: Commit**

```bash
git add traits.js players-2026.js draftProspects.js
git commit -m "feat: hiddenTendencies stub + ensureHiddenPlayerData retrofit"
```

---

### Task 4: `draftProspects.js` — populate hidden data at generation time

**Files:**
- Modify: `draftProspects.js`

**Interfaces:**
- Consumes: `traits.js`'s `generateHiddenTraits`/`generatePersonality`/`generateTendencies` (Task 2)
- Produces: every prospect `generateProspectClass` creates already has real `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies` (not the `[]`/`{}` stubs) by the time it's returned — no retrofit pass needed for procedurally generated classes.

- [ ] **Step 1: Add `traits.js` to `draftProspects.js`'s dependency block**

Change:
```js
var _PROSPECT_DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, POSITIONS: POSITIONS };
```
to:
```js
var _PROSPECT_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js') }
  : {
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, POSITIONS: POSITIONS },
      traits: { generateHiddenTraits: generateHiddenTraits, generatePersonality: generatePersonality, generateTendencies: generateTendencies }
    };
```

- [ ] **Step 2: Update the two `_PROSPECT_DATA.ATTRIBUTE_KEYS`/`RATING_MIN`/`RATING_MAX`/`POSITIONS` references to go through `.data`**

In `makeProspectAttributes`:
```js
function makeProspectAttributes(overall, archetype) {
  const offsets = PROSPECT_ARCHETYPES[archetype];
  const attrs = {};
  _PROSPECT_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = overall + (offsets[key] || 0);
    attrs[key] = Math.max(_PROSPECT_DATA.data.RATING_MIN, Math.min(_PROSPECT_DATA.data.RATING_MAX, raw));
  });
  return attrs;
}
```
And in `generateProspectClass`, change `_PROSPECT_DATA.POSITIONS` to `_PROSPECT_DATA.data.POSITIONS`.

- [ ] **Step 3: Populate hidden data inline in `generateProspectClass`**

Change the loop body's final line from:
```js
    prospects.push(mkProspect(name.trim(), age, heightIn, weightLb, position, Math.max(40, Math.min(90, overall)), Math.max(overall, Math.min(99, potential)), archetype, bustChance, 'Unproven'));
```
to:
```js
    const prospect = mkProspect(name.trim(), age, heightIn, weightLb, position, Math.max(40, Math.min(90, overall)), Math.max(overall, Math.min(99, potential)), archetype, bustChance, 'Unproven');
    prospect.hiddenTraits = _PROSPECT_DATA.traits.generateHiddenTraits(prospect, rng);
    prospect.hiddenPersonality = _PROSPECT_DATA.traits.generatePersonality(prospect, rng);
    prospect.hiddenTendencies = _PROSPECT_DATA.traits.generateTendencies(prospect, rng);
    prospects.push(prospect);
```

- [ ] **Step 4: Smoke-test in Node**

Run:
```bash
node -e "
const { generateProspectClass } = require('./draftProspects.js');
const { makeRng } = require('./rng.js');
const cls = generateProspectClass(makeRng(7), 60);
console.log(cls.length, cls.filter(p => p.hiddenTraits.length > 0).length, cls[0].hiddenTendencies.threeTendency !== undefined);
"
```
Expected: `60 60 true` — every procedurally generated prospect already has trait data.

- [ ] **Step 5: Commit**

```bash
git add draftProspects.js
git commit -m "feat: populate hidden trait data at prospect generation time"
```

---

### Task 5: `scouting.js` — points economy, passive/active confidence, reveal thresholds

**Files:**
- Create: `scouting.js`

**Interfaces:**
- Consumes: `traits.js`'s `TRAIT_TAXONOMY_BY_KEY`/`TRAIT_TIERS` (Task 1)
- Produces: `weeklyScoutPointsForTeam(team)`, `currentWeek(dayIndex)`, `initScoutingState()`, `setWatchlisted(state, targetId, watchlisted)`, `tickPassiveScouting(state, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft)`, `allocateScoutPoints(state, targetId, points)`, `getRevealedView(player, confidence)`.

- [ ] **Step 1: Write `scouting.js`**

```js
var _SCOUTING_DATA = (typeof require !== 'undefined')
  ? { traits: require('./traits.js') }
  : { traits: { TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY, TRAIT_TIERS: TRAIT_TIERS } };

function weeklyScoutPointsForTeam(team) {
  return 100 + Math.floor(team.prestige / 2);
}

// The sim is day-indexed (no existing week concept) — a week is a fixed 7-day
// block, so passive rollover can trigger purely from the day counter.
function currentWeek(dayIndex) {
  return Math.floor(Math.max(0, dayIndex) / 7);
}

function initScoutingState() {
  return { lastRolloverWeek: -1, pointsAvailable: 0, targets: {} };
}

function ensureTarget(state, targetId) {
  if (!state.targets[targetId]) state.targets[targetId] = { confidence: 0, watchlisted: false };
  return state.targets[targetId];
}

function setWatchlisted(state, targetId, watchlisted) {
  ensureTarget(state, targetId).watchlisted = watchlisted;
}

function bumpConfidence(state, targetId, amount) {
  const target = ensureTarget(state, targetId);
  target.confidence = Math.max(0, Math.min(100, target.confidence + amount));
}

// Called once per real day advanced (see league.js's simulateDate onDayComplete
// hook, wired up in Batch B). Own roster gains confidence fastest, opponents
// only on days you actually play them, and draft prospects get a "draft buzz"
// speed-up inside the final 30 days before the draft.
function tickPassiveScouting(state, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft) {
  const week = currentWeek(dayIndex);
  if (week > state.lastRolloverWeek) {
    state.pointsAvailable = weeklyScoutPointsForTeam(team);
    state.lastRolloverWeek = week;
  }
  ownRosterIds.forEach(function (id) { bumpConfidence(state, id, 0.4); });
  playedOpponentIds.forEach(function (id) { bumpConfidence(state, id, 0.2); });
  const prospectGain = (daysUntilDraft !== null && daysUntilDraft !== undefined && daysUntilDraft <= 30) ? 0.3 : 0.15;
  prospectIds.forEach(function (id) { bumpConfidence(state, id, prospectGain); });
}

function allocateScoutPoints(state, targetId, points) {
  const spend = Math.max(0, Math.min(points, state.pointsAvailable));
  if (spend <= 0) return 0;
  state.pointsAvailable -= spend;
  const gain = 4 * Math.sqrt(spend / 10);
  bumpConfidence(state, targetId, gain);
  return gain;
}

function personalityBucket(value) {
  if (value < 35) return 'Low';
  if (value < 65) return 'Medium';
  return 'High';
}

function fuzzyPersonality(personality) {
  const out = {};
  Object.keys(personality).forEach(function (k) { out[k] = personalityBucket(personality[k]); });
  return out;
}

function fuzzyTraitLabel(traitInfo) {
  const tiers = _SCOUTING_DATA.traits.TRAIT_TIERS;
  const idx = tiers.indexOf(traitInfo.tier);
  const lo = tiers[Math.max(0, idx - 1)];
  const hi = tiers[Math.min(tiers.length - 1, idx + 1)];
  const def = _SCOUTING_DATA.traits.TRAIT_TAXONOMY_BY_KEY[traitInfo.key];
  return { key: traitInfo.key, name: def ? def.name : traitInfo.key, rangeLabel: lo + '-' + hi };
}

function getRevealedView(player, confidence) {
  if (confidence < 30) {
    return { level: 'hidden', traits: null, personality: null, tendencies: null };
  }
  if (confidence < 70) {
    return {
      level: 'fuzzy',
      traits: (player.hiddenTraits || []).map(fuzzyTraitLabel),
      personality: fuzzyPersonality(player.hiddenPersonality || {}),
      tendencies: null
    };
  }
  return { level: 'exact', traits: player.hiddenTraits, personality: player.hiddenPersonality, tendencies: player.hiddenTendencies };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weeklyScoutPointsForTeam: weeklyScoutPointsForTeam,
    currentWeek: currentWeek,
    initScoutingState: initScoutingState,
    setWatchlisted: setWatchlisted,
    tickPassiveScouting: tickPassiveScouting,
    allocateScoutPoints: allocateScoutPoints,
    getRevealedView: getRevealedView,
    personalityBucket: personalityBucket
  };
}
```

- [ ] **Step 2: Smoke-test in Node**

Run:
```bash
node -e "
const s = require('./scouting.js');
const team = { prestige: 80 };
const state = s.initScoutingState();
s.tickPassiveScouting(state, team, 0, ['p1'], [], [], null);
console.log(state.pointsAvailable, state.targets.p1.confidence);
s.allocateScoutPoints(state, 'p1', 40);
console.log(Math.round(state.targets.p1.confidence * 100) / 100, state.pointsAvailable);
"
```
Expected: `140 0.4` then a confidence value near `8.4` (0.4 + 4*sqrt(4)) and `100` remaining points.

- [ ] **Step 3: Commit**

```bash
git add scouting.js
git commit -m "feat: scouting points economy + confidence-gated reveal"
```

---

### Task 6: Prospect-timing fix — generate next draft class at season start

**Files:**
- Modify: `seasonTransition.js:33-60,62-85` (`runOffseasonThroughDraft`, `generateNewSeason`)
- Modify: `scripts/validate-offseason.js` (update the two call sites this signature change affects)

**Interfaces:**
- Consumes: `draftProspects.js`'s `generateProspectClass` (already used here, unchanged signature)
- Produces: `runOffseasonThroughDraft(bracket, rng, upcomingDraftClass)` — drops the `isFirstDraft` boolean, takes the prospect pool directly. `generateNewSeason(rng)` now returns `{ games, nextDraftClass }` instead of a bare games array, so the class for the *next* offseason's draft exists as soon as the season that precedes it starts.

- [ ] **Step 1: Update `runOffseasonThroughDraft` in `seasonTransition.js`**

Change:
```js
function runOffseasonThroughDraft(bracket, rng, isFirstDraft) {
```
to:
```js
function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass) {
```
And change:
```js
  // 4. Draft.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const prospectPool = isFirstDraft ? _TRANSITION_DATA.prospects.DRAFT_PROSPECTS_2026 : _TRANSITION_DATA.prospects.generateProspectClass(rng, 60);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, prospectPool);
```
to:
```js
  // 4. Draft. The prospect pool is generated by the caller ahead of time (real
  // 2026 class for the first draft, or the class generateNewSeason produced
  // at the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
```

- [ ] **Step 2: Update `generateNewSeason` in `seasonTransition.js`**

Change:
```js
function generateNewSeason(rng) {
  _TRANSITION_DATA.teams.TEAMS.forEach(function (t) {
    t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    // This year's picks were just used in the draft; next year's slots reset
    // to their original owner, ready to be traded again before the next draft.
    t.draftPicks = [
      { round: 1, originalTeamId: t.id, currentOwnerId: t.id },
      { round: 2, originalTeamId: t.id, currentOwnerId: t.id }
    ];
  });

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.seasonStats = undefined;
  });

  const games = _TRANSITION_DATA.schedule.generateSeasonGames(rng, _TRANSITION_DATA.teams.TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return games;
}
```
to:
```js
function generateNewSeason(rng) {
  _TRANSITION_DATA.teams.TEAMS.forEach(function (t) {
    t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    // This year's picks were just used in the draft; next year's slots reset
    // to their original owner, ready to be traded again before the next draft.
    t.draftPicks = [
      { round: 1, originalTeamId: t.id, currentOwnerId: t.id },
      { round: 2, originalTeamId: t.id, currentOwnerId: t.id }
    ];
  });

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.seasonStats = undefined;
  });

  const games = _TRANSITION_DATA.schedule.generateSeasonGames(rng, _TRANSITION_DATA.teams.TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });

  // Generated now (not at draft time) so it exists to be scouted all season.
  const nextDraftClass = _TRANSITION_DATA.prospects.generateProspectClass(rng, 60);

  return { games: games, nextDraftClass: nextDraftClass };
}
```

- [ ] **Step 3: Update `scripts/validate-offseason.js`'s two affected call sites**

Change (near line 211):
```js
  const rng = makeRng(600);
  const result = transitionModule.runOffseasonThroughDraft(bracket, rng, true);
```
to:
```js
  const rng = makeRng(600);
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const result = transitionModule.runOffseasonThroughDraft(bracket, rng, prospectsModule.DRAFT_PROSPECTS_2026);
```

Change (near line 391-394):
```js
  const rng = makeRng(1000);
  const games = transitionModule.generateNewSeason(rng);

  assert.strictEqual(games.length, 1230, 'a new season should have exactly 1230 games');
```
to:
```js
  const rng = makeRng(1000);
  const result = transitionModule.generateNewSeason(rng);

  assert.strictEqual(result.games.length, 1230, 'a new season should have exactly 1230 games');
  assert.strictEqual(result.nextDraftClass.length, 60, 'generateNewSeason should also produce next year\'s 60-prospect draft class');
```

- [ ] **Step 4: Run the offseason validator to confirm nothing else broke**

Run: `node scripts/validate-offseason.js`
Expected: ends with `All offseason validations passed` (no other test in this file calls `runOffseasonThroughDraft`/`generateNewSeason`, confirmed by the earlier `grep` during planning).

- [ ] **Step 5: Commit**

```bash
git add seasonTransition.js scripts/validate-offseason.js
git commit -m "refactor: generate next draft class at season start, not draft time"
```

---

### Task 7: `scripts/validate-traits.js` + wire `traits.js`/`scouting.js` into `index.html`

**Files:**
- Create: `scripts/validate-traits.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: everything built in Tasks 1-6.

- [ ] **Step 1: Add `traits.js` and `scouting.js` to `index.html`, ahead of everything that will depend on them in Batch B**

`rng.js` has zero dependencies (confirmed: no `_RNG_DATA` needed) — moving it to load first is safe. Replace the `<script>` block:
```html
  <script src="data.js"></script>
  <script src="teams.js"></script>
  <script src="players-2026.js"></script>
  <script src="league.js"></script>
  <script src="rng.js"></script>
  <script src="schedule.js"></script>
```
with:
```html
  <script src="data.js"></script>
  <script src="rng.js"></script>
  <script src="teams.js"></script>
  <script src="traits.js"></script>
  <script src="scouting.js"></script>
  <script src="players-2026.js"></script>
  <script src="league.js"></script>
  <script src="schedule.js"></script>
```
(Every other `<script>` tag stays exactly where it is for now — Batch B adds `ui/scouting.js` near the end and touches several files that will need `traits.js` already loaded, which this ordering satisfies.)

- [ ] **Step 2: Write `scripts/validate-traits.js`**

```js
const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkTaxonomy() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  assert.strictEqual(traitsModule.TRAIT_TAXONOMY.length, 48, 'expected 48 total traits');
  const byCategory = {};
  traitsModule.TRAIT_TAXONOMY.forEach(function (t) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  });
  ['offensive', 'defensive', 'athletic', 'mental', 'negative', 'superstar'].forEach(function (cat) {
    assert.strictEqual(byCategory[cat], 8, cat + ' should have exactly 8 traits');
  });
  assert.strictEqual(Object.keys(traitsModule.TRAIT_TAXONOMY_BY_KEY).length, 48, 'lookup map should have one entry per trait');

  console.log('checkTaxonomy: OK');
}

checkTaxonomy();

function checkGetTraitBonus() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const player = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }, { key: 'chokeArtist', tier: 'bronze' }] };
  const bonus = traitsModule.getTraitBonus(player, 'boxscore', 'scoring');
  assert.strictEqual(bonus, 3 - 1, 'sharpshooter gold (+3) minus chokeArtist bronze (-1) should net to 2');
  assert.strictEqual(traitsModule.getTraitBonus(player, 'boxscore', 'rebound'), 0, 'no matching traits for this stat should return 0');
  assert.strictEqual(traitsModule.getTraitBonus({}, 'boxscore', 'scoring'), 0, 'a player with no hiddenTraits field should not throw');

  console.log('checkGetTraitBonus: OK');
}

checkGetTraitBonus();

function makePlayer(overall, potential, attrOverrides) {
  const attrs = { threePoint: 60, midRange: 60, insideScoring: 60, postScoring: 50, passing: 55, ballHandling: 55, steal: 50, block: 45, offReb: 50, defReb: 50, basketballIQ: 60, workEthic: 60, leadership: 55, strength: 55, speed: 55, acceleration: 55, vertical: 55, freeThrow: 60, perimeterDefense: 50, interiorDefense: 50 };
  Object.assign(attrs, attrOverrides || {});
  return { id: 'test-player', overall: overall, potential: potential, attributes: attrs };
}

function checkGenerateHiddenTraits() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const rng = makeRng(11);

  let lowTotal = 0;
  let highTotal = 0;
  const TRIALS = 100;
  for (let i = 0; i < TRIALS; i++) {
    lowTotal += traitsModule.generateHiddenTraits(makePlayer(50, 55), rng).length;
    highTotal += traitsModule.generateHiddenTraits(makePlayer(97, 98), rng).length;
  }
  assert.ok(highTotal > lowTotal, 'higher-overall players should average more traits than low-overall players');

  let superstarCount = 0;
  for (let i = 0; i < TRIALS; i++) {
    const traits = traitsModule.generateHiddenTraits(makePlayer(60, 65), rng);
    if (traits.some(function (t) { return traitsModule.TRAIT_TAXONOMY_BY_KEY[t.key].category === 'superstar'; })) superstarCount++;
  }
  assert.strictEqual(superstarCount, 0, 'a 60 OVR / 65 POT player should never roll a superstar trait');

  console.log('checkGenerateHiddenTraits: OK');
}

checkGenerateHiddenTraits();

function checkGeneratePersonalityAndTendencies() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const rng = makeRng(22);
  const player = makePlayer(75, 80);

  const personality = traitsModule.generatePersonality(player, rng);
  ['loyalty', 'ambition', 'ego', 'coachability', 'durabilityMindset'].forEach(function (k) {
    assert.ok(personality[k] >= 0 && personality[k] <= 100, k + ' out of 0-100 range');
  });

  const tendencies = traitsModule.generateTendencies(player, rng);
  ['threeTendency', 'midTendency', 'insideTendency', 'isoTendency', 'catchAndShootTendency', 'postTendency', 'transitionTendency', 'clutchUsage', 'gambleTendency', 'reboundAggression'].forEach(function (k) {
    assert.ok(tendencies[k] >= 0 && tendencies[k] <= 100, k + ' out of 0-100 range');
  });

  console.log('checkGeneratePersonalityAndTendencies: OK');
}

checkGeneratePersonalityAndTendencies();

function checkEnsureHiddenPlayerData() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const players = [
    { id: 'a-1', overall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} },
    { id: 'a-2', overall: 60, potential: 60, attributes: makePlayer(60, 60).attributes, hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }], hiddenPersonality: { loyalty: 50 }, hiddenTendencies: {} }
  ];
  traitsModule.ensureHiddenPlayerData(players);
  assert.ok(players[0].hiddenTraits.length > 0, 'empty-stub player should be populated');
  assert.deepStrictEqual(players[1].hiddenTraits, [{ key: 'sharpshooter', tier: 'bronze' }], 'already-populated player should be left untouched');

  const again = [{ id: 'a-1', overall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} }];
  traitsModule.ensureHiddenPlayerData(again);
  assert.deepStrictEqual(again[0].hiddenTraits, players[0].hiddenTraits, 'same id should deterministically regenerate identical trait data');

  console.log('checkEnsureHiddenPlayerData: OK');
}

checkEnsureHiddenPlayerData();

function checkScoutingEconomy() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const team = { prestige: 80 };
  const state = scoutingModule.initScoutingState();

  scoutingModule.tickPassiveScouting(state, team, 0, ['own-1'], ['opp-1'], ['prospect-1'], 45);
  assert.strictEqual(state.pointsAvailable, 140, 'week 0 rollover should grant 100 + floor(80/2) = 140 points');
  assert.strictEqual(state.targets['own-1'].confidence, 0.4, 'own roster gains 0.4/day');
  assert.strictEqual(state.targets['opp-1'].confidence, 0.2, 'played opponent gains 0.2/day');
  assert.strictEqual(state.targets['prospect-1'].confidence, 0.15, 'prospect gains 0.15/day outside the 30-day pre-draft window');

  // Same week (day 1, still week 0) should not re-grant points.
  scoutingModule.tickPassiveScouting(state, team, 1, [], [], [], 44);
  assert.strictEqual(state.pointsAvailable, 140, 'points should not re-roll within the same week');

  // Crossing into week 1 (day 7) should refresh the allowance.
  const spentFirst = scoutingModule.allocateScoutPoints(state, 'own-1', 40);
  assert.ok(spentFirst > 0 && state.pointsAvailable === 100, 'spending 40 of 140 should leave 100');
  scoutingModule.tickPassiveScouting(state, team, 7, [], [], [], 38);
  assert.strictEqual(state.pointsAvailable, 140, 'crossing into a new week should refresh points to the full weekly amount');

  // Draft-buzz speed-up inside 30 days of the draft.
  const state2 = scoutingModule.initScoutingState();
  scoutingModule.tickPassiveScouting(state2, team, 0, [], [], ['prospect-2'], 10);
  assert.strictEqual(state2.targets['prospect-2'].confidence, 0.3, 'inside 30 days of the draft, prospects gain 0.3/day');

  // Overspending is clamped to what's available.
  const state3 = scoutingModule.initScoutingState();
  scoutingModule.tickPassiveScouting(state3, team, 0, [], [], [], null);
  const spent = scoutingModule.allocateScoutPoints(state3, 'x', 9999);
  assert.strictEqual(state3.pointsAvailable, 0, 'allocateScoutPoints should never let spend exceed pointsAvailable');
  assert.ok(spent > 0);

  console.log('checkScoutingEconomy: OK');
}

checkScoutingEconomy();

function checkRevealThresholds() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const player = {
    hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: { loyalty: 80, ambition: 20, ego: 50, coachability: 50, durabilityMindset: 50 },
    hiddenTendencies: { threeTendency: 40 }
  };

  const hidden = scoutingModule.getRevealedView(player, 10);
  assert.strictEqual(hidden.level, 'hidden');
  assert.strictEqual(hidden.traits, null);

  const fuzzy = scoutingModule.getRevealedView(player, 50);
  assert.strictEqual(fuzzy.level, 'fuzzy');
  assert.strictEqual(fuzzy.traits[0].rangeLabel, 'silver-hof', 'gold should fuzz to the tier band one below and one above');
  assert.strictEqual(fuzzy.personality.loyalty, 'High');
  assert.strictEqual(fuzzy.personality.ambition, 'Low');
  assert.strictEqual(fuzzy.tendencies, null, 'tendencies stay hidden until exact-reveal confidence');

  const exact = scoutingModule.getRevealedView(player, 90);
  assert.strictEqual(exact.level, 'exact');
  assert.deepStrictEqual(exact.traits, player.hiddenTraits);
  assert.deepStrictEqual(exact.tendencies, player.hiddenTendencies);

  console.log('checkRevealThresholds: OK');
}

checkRevealThresholds();

console.log('All trait/scouting validations passed');
```

- [ ] **Step 3: Run the new validator**

Run: `node scripts/validate-traits.js`
Expected: seven `OK` lines followed by `All trait/scouting validations passed`.

- [ ] **Step 4: Run every existing validator to confirm Batch A didn't regress anything**

Run: `node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js`
Expected: all five end with their respective `All ... validations passed` line, no errors.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/validate-traits.js
git commit -m "test: Phase 5 Batch A validation suite + wire traits.js/scouting.js into index.html"
```
