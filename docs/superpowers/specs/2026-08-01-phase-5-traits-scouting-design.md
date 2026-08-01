# Phase 5 — Hidden Traits, Personality & Scouting: Design

**Status:** Approved. Governs Phase 5 of the roadmap (`2026-07-31-nba-gm-simulator-roadmap.md`).

## Goal

Populate the `hiddenTraits: []` / `hiddenPersonality: {}` stubs every player has carried since Phase 1, add a new `hiddenTendencies` field, and build a scouting system that gradually reveals all three to the user. Traits/personality/tendencies are not flavor text — they plug into the sim engine, progression, injuries, and free agency/trade logic built in Phases 2-4, so scouting genuinely changes what the user knows about a player's likely future value.

## 1. Trait Taxonomy

`traits.js` defines `TRAIT_TAXONOMY`: 48 traits across 6 categories, 8 per category. Every trait has 5 tiers: Bronze, Silver, Gold, HOF, Legendary.

**Data shape:**
```js
{
  key: 'sharpshooter',
  name: 'Sharpshooter',
  category: 'offensive', // offensive | defensive | athletic | mental | negative | superstar
  effectType: 'boxscore', // boxscore | progression | injury | chemistry | freeagency
  tierValues: { bronze: 1, silver: 2, gold: 3, hof: 5, legendary: 8 }
}
```
Superstar traits use a bigger scale (`{ bronze: 2, silver: 4, gold: 6, hof: 9, legendary: 14 }`) since they're rarer and meant to matter more. Negative traits use the same `tierValues` shape, but the tier represents *severity* — Legendary is the worst version of the flaw, not the best.

A player's `hiddenTraits` field is an array of `{ key, tier }` pairs, e.g. `[{ key: 'sharpshooter', tier: 'gold' }, { key: 'clutchGene', tier: 'silver' }]`.

### Full trait list

**Offensive:** Sharpshooter (3PT efficiency), Post Threat (post scoring vs smaller/weaker defenders), Finisher (inside scoring through contact), Playmaker (assists, fewer pressure turnovers), Pick & Roll Maestro (team offensive rating bump while on court), Off-Ball Mover (efficiency boost off-ball), Free Throw Ace (FT% + late-game reliability), High Motor Scorer (usage tolerance without efficiency loss).

**Defensive:** Lockdown Defender (perimeter defense vs top scorers), Rim Protector (interior defense/blocks), Pickpocket (steals), Defensive Anchor (team defensive rating bump while on court), Charge Taker (hustle/defensive fouls drawn), Switchable (less penalty guarding multiple positions), Glass Cleaner (defensive rebounds), Point-of-Attack Menace (forces extra opponent turnovers).

**Athletic:** Elite Speed (transition scoring), Explosive Vertical (rim finishing/blocks), Iron Man (reduced injury probability), Quick Twitch (steals/deflections), Strength Advantage (post/rebounding vs weaker players), High Motor (reduced fatigue accumulation), Springy Rebounder (offensive rebounds), Fast Healer (reduced injury recovery time).

**Mental:** High IQ (small all-around efficiency bump, fewer mistakes), Clutch Gene (late/close-game performance), Coachable (better progression trajectory), Natural Leader (team chemistry/morale bump), Big-Game Competitor (playoff performance), Film Junkie (faster in-season progression ticks), Poise (fewer pressure turnovers, no road penalty), Mentor (boosts progression of younger teammates).

**Negative:** Injury Prone (higher injury probability), Streaky (higher game-to-game variance), Turnover Prone (higher turnover rate), Foul Prone (higher foul-out risk), Poor Conditioning (faster fatigue), Locker Room Cancer (team chemistry/morale penalty), Stubborn (resists coaching, worse progression regardless of fit), Choke Artist (worse late-game/clutch performance).

**Superstar** (gated — see §4): Alpha Dog (all-around bump as clear usage leader), Ice in Veins (extreme clutch/game-winner bump), Two-Way Star (simultaneous offense+defense bump), Floor General (bumps whole starting five's efficiency), Unstoppable Force (scoring bump that partially ignores defender rating), DPOY Caliber (large two-end defensive bump), Franchise Cornerstone (chemistry bump + reduces own trade-request likelihood), Human Highlight Reel (athletic scoring bump + team fan happiness bump).

## 2. Hidden Personality

Five axes, each 0-100, stored as `player.hiddenPersonality = { loyalty, ambition, ego, coachability, durabilityMindset }`.

- **Loyalty** — discounts the value of an incumbent-team offer during free agency (high loyalty players need less money/role to stay).
- **Ambition** — weights contention/timeline fit more heavily than money in `scoreOffer`.
- **Ego** — penalizes offers implying a diminished role (bench, low touches) for players who were previously stars; also scales a morale hit when the player is traded.
- **Coachability** — modifies `progression.js` breakout/bust odds alongside the Coachable/Stubborn traits.
- **Durability Mindset** — modifies injury/fatigue interactions alongside Iron Man/Injury Prone/Poor Conditioning traits.

## 3. Hidden Tendencies

Ten values, each 0-100, stored as `player.hiddenTendencies`:

- Shot mix: `threeTendency`, `midTendency`, `insideTendency`
- Creation style: `isoTendency`, `catchAndShootTendency`, `postTendency`, `transitionTendency`
- `clutchUsage` — late-game shot/possession share preference
- `gambleTendency` — steal-attempt aggressiveness vs. disciplined defense
- `reboundAggression` — crashes offensive glass vs. gets back on defense

These bias the per-player weighting already used by `simEngineBoxScore.js`'s `distributeInt`-based stat distribution (a player with high `threeTendency` gets a larger share of team 3PA distributed to them), rather than adding new flat rating boosts. This is a targeted extension of existing weighting logic, not a rewrite of the sim engine.

## 4. Generation

`traits.js` exports three seeded, deterministic generator functions:

- `generateHiddenTraits(player, rng)` — trait count scales with `overall` (roughly 2 traits at overall 60, up to 5-6 at overall 95+). Each candidate trait's probability is weighted by relevant existing attributes (high `threePoint` → likely Sharpshooter, high `steal` → likely Pickpocket, high `workEthic`/`basketballIQ` → likely Mental-category traits, low `workEthic`/erratic archetype → more likely to roll a Negative trait). Tier within a rolled trait is weighted toward the player's overall/potential (a 99 OVR player rolling Sharpshooter skews toward Gold/HOF/Legendary; a 65 OVR bench player skews Bronze/Silver). Superstar traits are only rollable when `overall >= 85 or potential >= 88`, and even then there's only a ~20% chance the roll produces one at all.
- `generatePersonality(player, rng)` — each axis is a base random roll loosely correlated with existing visible attributes (e.g. `coachability` correlates with `workEthic`/`basketballIQ`) plus enough independent randomness that personality isn't fully predictable from the box score attributes alone.
- `generateTendencies(player, rng)` — shot-mix values derived from the player's archetype offsets (a `primary_scorer` skews `threeTendency`/`midTendency` up, a `rim_protector` skews `insideTendency` up), creation-style and defensive tendencies given plausible archetype-weighted randomness.

All three are seeded off the player's `id` (via `makeRng` from `rng.js`), so results are stable and reproducible — the same player always generates the same hidden profile.

**Retrofitting the 380 real players:** no hand-editing of `players-2026.js`. At game start, a one-time pass (`ensureHiddenPlayerData()`, called from `selectTeam`/`initSeason` in `script.js`) walks `PLAYERS_2026` and, for any player whose `hiddenTraits` is still empty, calls the three generators and fills in `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies`. Future procedurally generated players (draft prospects from `draftProspects.js`'s `generateProspectClass`, and any player created after Phase 5) call the same generators at creation time.

## 5. Scouting System

**Points economy:** each team has `weeklyScoutPoints = 100 + floor(team.prestige / 2)`. Points are a per-week allowance (not stockpiled indefinitely — unspent points are lost at week rollover, keeping the mechanic "use it or lose it" simple). The codebase has no existing "week" concept — the sim is day-indexed (`GameState.season.currentDay`). Phase 5 defines a week as a 7-day block: `currentWeek = Math.floor(currentDay / 7)`. `GameState.scouting.lastRolloverWeek` tracks the last week the allowance was refreshed; each time `tickPassiveScouting` runs (called daily from `simulateDate`) it checks whether `currentWeek > lastRolloverWeek` and, if so, resets `pointsAvailable` to the formula above and updates `lastRolloverWeek`.

**State:** `GameState.scouting` is `{ lastRolloverWeek: 0, pointsAvailable: 0, targets: { [id]: { confidence: 0-100, watchlisted: bool } } }`. This lives in game state (not on the player object), since it represents the *user's team's* knowledge, not a global fact — AI teams continue to use true hidden values under the hood for their own evaluators, unchanged from Phases 3-4.

**Passive confidence gain** (ticked daily from `league.js`'s existing `simulateDate` loop, via a new `scouting.js` function):
- Own roster: +0.4/day
- Opposing roster player, only on days your team plays them: +0.2/day
- Draft prospects: +0.15/day baseline, +0.3/day inside the final 30 days before the draft

**Active scouting:** the user allocates a subset of `GameState.scouting.pointsAvailable` across watchlisted targets via `allocateScoutPoints(targetId, points)`, which decrements `pointsAvailable` and applies `confidence += 4 * sqrt(points / 10)` immediately (diminishing returns, so spreading points thin across many targets is a real trade-off against focusing on a few).

**Reveal thresholds** (applied only to `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies` — visible `attributes`/`overall`/`potential` are unaffected and already fully shown, as built in Phase 1):
- `confidence < 30`: shows `???` for every hidden trait/personality axis/tendency
- `30 <= confidence < 70`: shows a fuzzy range per known-candidate trait (e.g. "Sharpshooter: Gold-HOF?") and personality axes as a wide bucket (e.g. "Loyalty: Medium-High")
- `confidence >= 70`: exact trait + tier, exact personality values, exact tendency values

## 6. Integration Points (targeted edits to existing files)

- `simEngineBoxScore.js` — apply trait/tendency modifiers when computing team rating and distributing box score stats.
- `progression.js` — Coachable/Stubborn/Mentor/Film Junkie traits and the `coachability` personality axis modify breakout/bust odds.
- `injuries.js` — Iron Man/Fast Healer/Injury Prone/Poor Conditioning traits and `durabilityMindset` modify injury probability and recovery time.
- `freeAgency.js` (`scoreOffer`) — `loyalty`/`ambition`/`ego` personality axes adjust offer scoring; a morale hit on trade scales with `ego`/`loyalty`.
- `data.js` — retire `TRAIT_TAXONOMY_STUB`; `traits.js` becomes the source of truth.
- `draftProspects.js` — `generateProspectClass` calls the new generators for every procedurally generated prospect (real hand-authored 2026 prospects still get hidden data via the same retrofit pass as real NBA players).

## 7. New Files

- `traits.js` — `TRAIT_TAXONOMY`, `generateHiddenTraits`, `generatePersonality`, `generateTendencies`, `ensureHiddenPlayerData`.
- `scouting.js` — `weeklyScoutPointsForTeam`, `allocateScoutPoints`, `tickPassiveScouting`, `getRevealedView(player, confidence)` (produces the exact/fuzzy/hidden display object consumed by the UI).
- `ui/scouting.js` — watchlist manager (add/remove any NBA player or draft prospect), weekly point allocation controls, and a scouting report panel showing confidence + revealed/fuzzy/hidden traits, personality, and tendencies.

## 8. Existing Files Touched (UI wiring)

- `ui/roster.js` — add a "Scout Report" button per player, opening the report panel from `ui/scouting.js`.
- `script.js` — add `BUILT_VIEWS.scouting`, call `ensureHiddenPlayerData()` once during `selectTeam`/`initSeason`, wire the daily scouting tick into the existing day-advance flow.
- `ui/nav.js` — add a Scouting nav entry.

## Out of Scope for Phase 5

- Save/load of `GameState.scouting` (Phase 6 — this phase just needs the in-memory state to work correctly within a single session).
- Scouting staff upgrades / facility investment (would extend `weeklyScoutPoints` beyond the flat prestige-based formula; not needed for a playable Phase 5).
- Any UI for AI teams' scouting (AI continues to use true hidden values directly, as it already does for trade/FA evaluation).
