# Phase 7B — Commissioner Sandbox Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this project's established preference) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commissioner-mode-only sandbox tools — edit any player's ratings, force a trade through without evaluation, create a player, delete a player, disable the salary cap, and a simplified expansion-team creation flow. Visible only when `GameState.playMode === 'commissioner'`.

**Architecture:** New `commissioner.js` holds pure sandbox logic, calling straight into existing evaluator/generator functions rather than inventing new ones — `forceTrade` reuses `trade.js`'s `validateRosterSizes`/`executeTrade`, `createPlayer` reuses `draftProspects.js`'s `mkProspect` for procedural attribute derivation and `traits.js`'s `ensureHiddenPlayerData` for hidden traits/personality/tendencies, `createExpansionTeam`'s draft selection reuses `tradeEvaluator.js`'s `adjustedPlayerValue` (the same comparison `draft.js`'s `selectAIPick` already uses). New `ui/commissioner.js` follows the existing `render<X>(container, ...)` / `draw()` / `wireEvents()` convention every other view file uses. One real gap surfaced during planning (not in the original design doc): `save.js`'s `applySavedState` assumes `TEAMS` is a fixed 30-team array and silently drops any team it doesn't already recognize — an expansion team would vanish on the next page reload. Task 5 fixes this by having save/load restore-or-create teams by id instead of only restoring fields onto teams that already exist.

**Tech Stack:** Same as every prior phase — vanilla JS, dual browser-global/Node-require pattern for logic files, plain globals for `ui/*.js` files (no dual-module indirection needed there, matching `ui/tradeCenter.js`/`ui/roster.js`), Node `assert` validation, `mcp__Claude_Browser__*` for the final live walkthrough.

## Global Constraints

- No third-party dependencies; classic `<script>` tags only.
- `commissioner.js` follows the `var _COMMISSIONER_DATA = (typeof require !== 'undefined') ? {...} : {...}` dual-module pattern (it's Node-tested via `scripts/validate-commissioner.js`). `ui/commissioner.js` does not — it references globals directly, exactly like `ui/tradeCenter.js` and `ui/roster.js` already do.
- `docs/superpowers/specs/2026-08-01-roadmap-continuation-handoff.md`'s Phase 7B section is the source of truth for the design (it supersedes `docs/superpowers/specs/2026-08-01-phase-7-play-modes-automation-design.md` §9). Three open questions from that handoff were resolved with the human partner before writing this plan:
  - **Force Trade** skips `evaluateTrade`'s value/salary check but still enforces the 12–15 roster-size band via `validateRosterSizes` — a fully unchecked Force Trade could otherwise drop a team below the floor other systems (box-score sim, `waivePlayer`) assume always holds.
  - **Expansion team conference/division** is auto-balanced (assigned to whichever conference/division currently has the fewest teams), not user-picked.
  - **Disable Cap checkbox** lives in `ui/settings.js` alongside Phase 7A's other toggles, gated to render only when `GameState.playMode === 'commissioner'`.
- Every logic-file task ends with a Node smoke test; UI-file tasks are validated at the end via live browser verification (Task 12), matching this project's established phase-closing pattern.
- Attribute/rating edits always clamp to `data.js`'s `RATING_MIN`/`RATING_MAX` (25/99) rather than rejecting out-of-range input — consistent with how `makeAttributes`/`makeProspectAttributes` already clamp everywhere else in the codebase.

---

### Task 1: `commissioner.js` (new) — `editPlayerRatings` + `deletePlayer`

**Files:**
- Create: `commissioner.js`

**Interfaces:**
- Produces: `editPlayerRatings(playerId, changes)` → `{ success, reason? }`, mutates the player in place. `changes` is `{ overall?, potential?, attributes?: { [key]: number } }`; each provided field is clamped to `[RATING_MIN, RATING_MAX]`, unknown attribute keys are ignored. `deletePlayer(playerId)` → `{ success, reason? }`, removes the player from `PLAYERS_2026` via `splice`-by-index (same mechanism `seasonTransition.js`'s retiree removal already uses).

- [ ] **Step 1: Write the file**

```js
var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS }
    };

function clampRating(v) {
  return Math.max(_COMMISSIONER_DATA.data.RATING_MIN, Math.min(_COMMISSIONER_DATA.data.RATING_MAX, v));
}

function editPlayerRatings(playerId, changes) {
  const player = _COMMISSIONER_DATA.league.getPlayerById(playerId);
  if (!player) return { success: false, reason: 'Player not found.' };
  if (changes.overall !== undefined) player.overall = clampRating(changes.overall);
  if (changes.potential !== undefined) player.potential = clampRating(changes.potential);
  if (changes.attributes) {
    Object.keys(changes.attributes).forEach(function (key) {
      if (_COMMISSIONER_DATA.data.ATTRIBUTE_KEYS.indexOf(key) === -1) return;
      player.attributes[key] = clampRating(changes.attributes[key]);
    });
  }
  return { success: true };
}

function deletePlayer(playerId) {
  const idx = _COMMISSIONER_DATA.players.PLAYERS_2026.findIndex(function (p) { return p.id === playerId; });
  if (idx === -1) return { success: false, reason: 'Player not found.' };
  _COMMISSIONER_DATA.players.PLAYERS_2026.splice(idx, 1);
  return { success: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { editPlayerRatings: editPlayerRatings, deletePlayer: deletePlayer };
}
```

- [ ] **Step 2: Run a Node smoke test**

Run:
```bash
node -e "
const commissioner = require('./commissioner.js');
const teams = require('./teams.js');
const league = require('./league.js');
const player = league.getTeamRoster(teams.TEAMS[0].id)[0];
const result = commissioner.editPlayerRatings(player.id, { overall: 500, potential: -50, attributes: { threePoint: 999, block: -999 } });
console.log('success:', result.success);
console.log('overall clamped to max:', player.overall === 99);
console.log('potential clamped to min:', player.potential === 25);
console.log('attribute clamped to max:', player.attributes.threePoint === 99);
console.log('attribute clamped to min:', player.attributes.block === 25);
const del = commissioner.deletePlayer(player.id);
console.log('delete success:', del.success);
console.log('player gone:', league.getPlayerById(player.id) === undefined);
"
```
Expected: every line prints `true`.

- [ ] **Step 3: Commit**

```bash
git add commissioner.js
git commit -m "feat: commissioner.js editPlayerRatings + deletePlayer"
```

---

### Task 2: `commissioner.js` — `createPlayer`

**Files:**
- Modify: `commissioner.js` (add after `deletePlayer`, before `module.exports`)

**Interfaces:**
- Consumes: `draftProspects.js`'s `mkProspect(name, age, heightIn, weightLb, position, overall, potential, archetype, bustChance, nbaComparison)`, `traits.js`'s `ensureHiddenPlayerData(players)`.
- Produces: `createPlayer(details)` → the created player object. `details = { name, position, age, overall, potential, archetype, teamId? }`. `archetype` must be one of the exported `CREATE_PLAYER_ARCHETYPES`. When `teamId` is omitted the player is pushed as a free agent (`teamId: null`); when provided, the player is assigned a jersey number and a contract and rostered on that team.

- [ ] **Step 1: Add the `_COMMISSIONER_DATA` deps and the function**

Change the top of `commissioner.js`:
```js
var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS }
    };
```
to:
```js
var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData }
    };
```

Add after `deletePlayer`:
```js
// Same 7 archetypes draftProspects.js's PROSPECT_ARCHETYPES defines — kept as
// its own list here (not imported) so the create-player form has a stable,
// explicit set of choices independent of that file's internal keys changing.
const CREATE_PLAYER_ARCHETYPES = ['primary_scorer', 'playmaker', 'three_and_d', 'rim_protector', 'stretch_big', 'slasher', 'raw_prospect'];

function nextAvailableJersey(teamId, excludePlayerId) {
  const roster = _COMMISSIONER_DATA.league.getTeamRoster(teamId).filter(function (p) { return p.id !== excludePlayerId; });
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  return jersey;
}

// Same "fair salary anchor" tradeEvaluator.js's contractBurden uses for a
// given overall, reused here so a commissioner-created rostered player starts
// with a plausible salary instead of $0.
function fairSalaryForOverall(overall) {
  return Math.max(1000000, (overall - 50) * 1000000);
}

// Builds a full player record via draftProspects.js's mkProspect — the same
// procedural attribute derivation (archetype offsets from overall) every
// prospect in the game already gets, so a commissioner-created player never
// has hand-rolled attributes. Hidden traits/personality/tendencies are
// generated the normal way via ensureHiddenPlayerData rather than left as
// empty stubs — this project's recurring "truthy empty object" bug pattern
// starts with exactly that kind of stub.
function createPlayer(details) {
  const overall = clampRating(details.overall);
  const potential = Math.max(overall, clampRating(details.potential));
  const player = _COMMISSIONER_DATA.prospects.mkProspect(
    details.name, details.age, 78, 210, details.position, overall, potential, details.archetype, 0, 'Commissioner-created'
  );
  _COMMISSIONER_DATA.traits.ensureHiddenPlayerData([player]);
  player.yearsPro = Math.max(0, details.age - 19);

  if (details.teamId) {
    player.teamId = details.teamId;
    player.jerseyNumber = nextAvailableJersey(details.teamId, player.id);
    player.contract = { salary: fairSalaryForOverall(overall), yearsRemaining: 2, playerOption: false, teamOption: false };
  }

  _COMMISSIONER_DATA.players.PLAYERS_2026.push(player);
  return player;
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { editPlayerRatings: editPlayerRatings, deletePlayer: deletePlayer };
}
```
to:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const commissioner = require('./commissioner.js');
const teams = require('./teams.js');
const league = require('./league.js');
const freeAgent = commissioner.createPlayer({ name: 'Test Rookie', position: 'SG', age: 19, overall: 70, potential: 85, archetype: 'primary_scorer' });
console.log('free agent has no team:', freeAgent.teamId === null);
console.log('all 20 attributes derived:', Object.keys(freeAgent.attributes).length === 20);
console.log('hidden traits is an array:', Array.isArray(freeAgent.hiddenTraits));
console.log('hidden personality populated:', typeof freeAgent.hiddenPersonality.ego === 'number');
const team = teams.TEAMS[5];
const rostered = commissioner.createPlayer({ name: 'Test Starter', position: 'C', age: 24, overall: 80, potential: 80, archetype: 'rim_protector', teamId: team.id });
console.log('rostered on chosen team:', rostered.teamId === team.id);
console.log('has salary:', rostered.contract.salary > 0);
console.log('has jersey number:', typeof rostered.jerseyNumber === 'number');
console.log('findable via getPlayerById:', league.getPlayerById(rostered.id) === rostered);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add commissioner.js
git commit -m "feat: commissioner.js createPlayer"
```

---

### Task 3: `commissioner.js` — `forceTrade`

**Files:**
- Modify: `commissioner.js`

**Interfaces:**
- Consumes: `trade.js`'s `validateRosterSizes(proposal)`, `executeTrade(proposal)`.
- Produces: `forceTrade(proposal)` → `{ success, rosterErrors: [] }`. Skips `evaluateTrade`'s value/salary check entirely (per the confirmed decision, Force Trade is consequence-free on value) but still runs `validateRosterSizes` first and refuses to execute if any participant would land outside the 12–15 band.

- [ ] **Step 1: Add the trade dep and the function**

Change the `_COMMISSIONER_DATA` block's Node branch and browser branch to add `trade`:
```js
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js')
```
to:
```js
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js'),
      trade: require('./trade.js')
```
and:
```js
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData }
```
to:
```js
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData },
      trade: { validateRosterSizes: validateRosterSizes, executeTrade: executeTrade }
```

Add after `createPlayer`:
```js
// Skips evaluateTrade's value/salary check entirely (Commissioner sandbox is
// explicitly consequence-free on trade fairness) but still enforces the same
// 12-15 roster-size band every other trade path enforces — an unchecked
// Force Trade could otherwise drop a team below the floor other systems
// (box-score sim, waivePlayer) assume always holds.
function forceTrade(proposal) {
  const rosterErrors = _COMMISSIONER_DATA.trade.validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { success: false, rosterErrors: rosterErrors };
  }
  _COMMISSIONER_DATA.trade.executeTrade(proposal);
  return { success: true, rosterErrors: [] };
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES
  };
```
to:
```js
module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES,
    forceTrade: forceTrade
  };
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const commissioner = require('./commissioner.js');
const teams = require('./teams.js');
const league = require('./league.js');
const trade = require('./trade.js');
const tradeEvaluator = require('./tradeEvaluator.js');

const teamA = teams.TEAMS[10];
const teamB = teams.TEAMS[11];
const rosterA = league.getTeamRoster(teamA.id).slice().sort(function (a, b) { return tradeEvaluator.adjustedPlayerValue(b, teamA) - tradeEvaluator.adjustedPlayerValue(a, teamA); });
const rosterB = league.getTeamRoster(teamB.id).slice().sort(function (a, b) { return tradeEvaluator.adjustedPlayerValue(a, teamB) - tradeEvaluator.adjustedPlayerValue(b, teamB); });
const best = rosterA[0];
const worst = rosterB[0];
const lopsided = { participants: [teamA.id, teamB.id], assignments: [{ playerId: best.id, fromTeamId: teamA.id, toTeamId: teamB.id }, { playerId: worst.id, fromTeamId: teamB.id, toTeamId: teamA.id }], pickAssignments: [] };
console.log('normal evaluation would reject:', trade.evaluateTrade(lopsided, null, true).accepted === false);
const forced = commissioner.forceTrade(lopsided);
console.log('forceTrade succeeds anyway:', forced.success === true);
console.log('player actually moved:', league.getPlayerById(best.id).teamId === teamB.id);

const teamC = teams.TEAMS[15];
const rosterC = league.getTeamRoster(teamC.id);
const dump = { participants: [teamC.id, teamA.id], assignments: rosterC.slice(0, rosterC.length - 5).map(function (p) { return { playerId: p.id, fromTeamId: teamC.id, toTeamId: teamA.id }; }), pickAssignments: [] };
const blocked = commissioner.forceTrade(dump);
console.log('roster-floor-violating trade blocked:', blocked.success === false && blocked.rosterErrors.length > 0);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add commissioner.js
git commit -m "feat: commissioner.js forceTrade"
```

---

### Task 4: `commissioner.js` — `createExpansionTeam`

**Files:**
- Modify: `commissioner.js`

**Interfaces:**
- Consumes: `tradeEvaluator.js`'s `adjustedPlayerValue(player, team)`, `data.js`'s `CONFERENCES`/`DIVISIONS`.
- Produces: `createExpansionTeam(details, rng)` → the created team object, already pushed onto `TEAMS` with a roster of ~14 players assembled via a simplified expansion draft. `details = { name, primaryColor, secondaryColor, marketSize }`. Conference/division is auto-assigned to whichever currently has the fewest teams.

- [ ] **Step 1: Add the tradeEvaluator dep and the function**

Change the `_COMMISSIONER_DATA` block to add `tradeEvaluator`:
```js
      trade: require('./trade.js')
```
to:
```js
      trade: require('./trade.js'),
      tradeEvaluator: require('./tradeEvaluator.js')
```
and:
```js
      trade: { validateRosterSizes: validateRosterSizes, executeTrade: executeTrade }
```
to:
```js
      trade: { validateRosterSizes: validateRosterSizes, executeTrade: executeTrade },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }
```

Add after `forceTrade`:
```js
function shuffleTeamIds(ids, rng) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Same "highest adjustedPlayerValue wins" selection draft.js's selectAIPick
// already uses for the real draft, reused here so the expansion team's picks
// are evaluated the same way every other roster decision in the game is.
function pickBestAvailable(available, team) {
  let best = available[0];
  let bestValue = _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(best, team);
  for (let i = 1; i < available.length; i++) {
    const value = _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(available[i], team);
    if (value > bestValue) { best = available[i]; bestValue = value; }
  }
  return best;
}

// Auto-balanced: a 31st team unbalances the existing 3-division/5-team-per-
// conference structure no matter where it lands, so this just picks
// whichever conference+division currently has the fewest teams.
function balancedConferenceDivision() {
  const counts = {};
  _COMMISSIONER_DATA.teams.TEAMS.forEach(function (t) {
    const key = t.conference + '|' + t.division;
    counts[key] = (counts[key] || 0) + 1;
  });
  let bestKey = null;
  let bestCount = Infinity;
  _COMMISSIONER_DATA.data.CONFERENCES.forEach(function (conf) {
    _COMMISSIONER_DATA.data.DIVISIONS[conf].forEach(function (div) {
      const key = conf + '|' + div;
      const count = counts[key] || 0;
      if (count < bestCount) { bestCount = count; bestKey = key; }
    });
  });
  const parts = bestKey.split('|');
  return { conference: parts[0], division: parts[1] };
}

const EXPANSION_ROSTER_TARGET = 14;
const EXPANSION_PROTECTED_COUNT = 8;
const EXPANSION_DONOR_FLOOR = 12; // never take a donor team below the game's existing roster-size floor

// 1. Appends a new team (fresh id, prestige 40, rebuilding, empty record).
// 2. Simplified expansion draft: every existing team auto-protects its top 8
//    by overall; the new team drafts one unprotected player from each other
//    team per round (rng-shuffled order) via pickBestAvailable, until it
//    reaches EXPANSION_ROSTER_TARGET. Donor teams already at the 12-player
//    floor are skipped so no other team's roster-size invariant breaks.
// 3. Takes effect starting the next generateNewSeason() call — schedule
//    generation already reads TEAMS fresh each time, so this is picked up
//    automatically; no retroactive mid-season schedule regeneration.
function createExpansionTeam(details, rng) {
  const placement = balancedConferenceDivision();
  const id = 'EXP-' + details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();

  const team = {
    id: id, name: details.name, conference: placement.conference, division: placement.division,
    colors: { primary: details.primaryColor, secondary: details.secondaryColor },
    prestige: 40, fanHappiness: 60, ownerHappiness: 60, chemistry: 60,
    timeline: 'rebuilding', marketSize: clampRating(details.marketSize),
    record: { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 },
    draftPicks: [
      { round: 1, originalTeamId: id, currentOwnerId: id },
      { round: 2, originalTeamId: id, currentOwnerId: id }
    ]
  };
  _COMMISSIONER_DATA.teams.TEAMS.push(team);

  const donorIds = _COMMISSIONER_DATA.teams.TEAMS
    .filter(function (t) { return t.id !== id; })
    .map(function (t) { return t.id; });

  let guardCounter = 0; // safety valve — real 30-team rosters always satisfy the target well within a few rounds
  while (_COMMISSIONER_DATA.league.getTeamRoster(id).length < EXPANSION_ROSTER_TARGET && guardCounter < 10) {
    guardCounter += 1;
    let draftedThisRound = false;
    shuffleTeamIds(donorIds, rng).forEach(function (donorId) {
      if (_COMMISSIONER_DATA.league.getTeamRoster(id).length >= EXPANSION_ROSTER_TARGET) return;
      const donorRoster = _COMMISSIONER_DATA.league.getTeamRoster(donorId);
      if (donorRoster.length <= EXPANSION_DONOR_FLOOR) return;
      const byOverall = donorRoster.slice().sort(function (a, b) { return b.overall - a.overall; });
      const protectedIds = {};
      byOverall.slice(0, EXPANSION_PROTECTED_COUNT).forEach(function (p) { protectedIds[p.id] = true; });
      const available = byOverall.filter(function (p) { return !protectedIds[p.id]; });
      if (available.length === 0) return;
      const picked = pickBestAvailable(available, team);
      picked.teamId = id;
      picked.jerseyNumber = nextAvailableJersey(id, picked.id);
      draftedThisRound = true;
    });
    if (!draftedThisRound) break;
  }

  return team;
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES,
    forceTrade: forceTrade
  };
```
to:
```js
module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES,
    forceTrade: forceTrade,
    createExpansionTeam: createExpansionTeam
  };
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const commissioner = require('./commissioner.js');
const teams = require('./teams.js');
const league = require('./league.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(2026);
const beforeCount = teams.TEAMS.length;
const team = commissioner.createExpansionTeam({ name: 'Vegas Aces', primaryColor: '#111111', secondaryColor: '#EEEEEE', marketSize: 60 }, rng);
console.log('team added to TEAMS:', teams.TEAMS.length === beforeCount + 1);
console.log('conference/division assigned:', !!team.conference && !!team.division);
const roster = league.getTeamRoster(team.id);
console.log('roster within 12-15 band:', roster.length >= 12 && roster.length <= 15);
console.log('no duplicate jersey numbers:', new Set(roster.map(function (p) { return p.jerseyNumber; })).size === roster.length);
const noDonorBelowFloor = teams.TEAMS.filter(function (t) { return t.id !== team.id; }).every(function (t) { return league.getTeamRoster(t.id).length >= 12; });
console.log('no donor team dropped below 12:', noDonorBelowFloor);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add commissioner.js
git commit -m "feat: commissioner.js createExpansionTeam"
```

---

### Task 5: `save.js` — restore-or-create teams by id (expansion-team fix)

**Files:**
- Modify: `save.js:42-89` (`serializeGameState`), `save.js:91-135` (`applySavedState`)

**Interfaces:**
- Produces: `serializeGameState` now saves each team's identity fields (`id`, `name`, `conference`, `division`, `colors`) alongside the existing mutable fields. `applySavedState` now iterates the saved payload's teams (not just the live `TEAMS` array) and creates a new team object for any id not already present in `TEAMS`, instead of silently skipping it. This is a real gap the original design didn't cover: `TEAMS` starts as a fixed 30-team array on every fresh page load, so without this fix an expansion team created in a prior session would vanish the instant the page reloads, even though the save file "succeeded."

- [ ] **Step 1: Save team identity fields too**

Change (`save.js:42-48`):
```js
function serializeGameState(gameState, name) {
  const teamsOut = {};
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const out = {};
    TEAM_SAVE_FIELDS.forEach(function (key) { out[key] = t[key]; });
    teamsOut[t.id] = out;
  });
```
to:
```js
// Only used by createTeamFromSave below, for teams applySavedState doesn't
// already have a live object for (i.e. an expansion team created in a prior
// session). Original teams' identity fields are still never round-tripped
// onto an existing object — teams.js's hardcoded values remain authoritative
// for those, same as before this fix.
const TEAM_IDENTITY_FIELDS = ['id', 'name', 'conference', 'division', 'colors'];

function serializeGameState(gameState, name) {
  const teamsOut = {};
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const out = {};
    TEAM_IDENTITY_FIELDS.concat(TEAM_SAVE_FIELDS).forEach(function (key) { out[key] = t[key]; });
    teamsOut[t.id] = out;
  });
```

- [ ] **Step 2: Restore-or-create teams by id**

Change (`save.js:91-99`):
```js
function applySavedState(payload, gameState) {
  // TEAMS is a fixed 30-team array — restore mutable fields in place so any
  // code already holding a team object reference (e.g. via getTeamById)
  // sees the restored values rather than a stale object.
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const saved = payload.teams[t.id];
    if (!saved) return;
    TEAM_SAVE_FIELDS.forEach(function (key) { t[key] = saved[key]; });
  });
```
to:
```js
function applySavedState(payload, gameState) {
  // TEAMS starts as the fixed 30-team array from teams.js on every fresh
  // page load. Iterate the SAVED teams (not the live array) so an expansion
  // team (Phase 7B) that doesn't have a matching object yet gets created,
  // not silently dropped — then restore mutable fields in place either way,
  // so any code already holding a team object reference (e.g. via
  // getTeamById) sees the restored values rather than a stale object.
  Object.keys(payload.teams).forEach(function (teamId) {
    const saved = payload.teams[teamId];
    let t = _SAVE_DATA.teams.TEAMS.find(function (team) { return team.id === teamId; });
    if (!t) {
      t = { id: saved.id, name: saved.name, conference: saved.conference, division: saved.division, colors: saved.colors };
      _SAVE_DATA.teams.TEAMS.push(t);
    }
    TEAM_SAVE_FIELDS.forEach(function (key) { t[key] = saved[key]; });
  });
```

- [ ] **Step 3: Run Node smoke tests — regression + the actual bug fix**

Run:
```bash
node scripts/validate-save.js
```
Expected: `All save/load validations passed` (existing 30-team round-trip is unaffected — every original team already has a matching object in `TEAMS` before `applySavedState` runs, so the `find` always succeeds and the new create-path never triggers for them).

Run:
```bash
node -e "
const teams = require('./teams.js');
const commissioner = require('./commissioner.js');
const save = require('./save.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(77);
const team = commissioner.createExpansionTeam({ name: 'Portland Pines', primaryColor: '#004400', secondaryColor: '#FFFFFF', marketSize: 45 }, rng);
const gameState = {
  userTeamId: teams.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
  upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2026, offseasonStage: null,
  settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: rng,
  playMode: 'commissioner', automation: {}, feed: [], draftSession: null
};
const payload = save.serializeGameState(gameState, 'test');

// Simulate a fresh page reload: the expansion team never existed in a fresh
// process's TEAMS array (only the hardcoded 30 from teams.js would).
const idx = teams.TEAMS.findIndex(function (t) { return t.id === team.id; });
teams.TEAMS.splice(idx, 1);
console.log('expansion team absent (simulated reload):', teams.TEAMS.findIndex(function (t) { return t.id === team.id; }) === -1);

const freshState = {};
save.applySavedState(payload, freshState);
const restored = teams.TEAMS.find(function (t) { return t.id === team.id; });
console.log('expansion team recreated on load:', !!restored);
console.log('identity fields restored:', restored.name === 'Portland Pines' && restored.conference === team.conference && restored.division === team.division);
console.log('mutable fields restored:', restored.marketSize === team.marketSize && restored.timeline === 'rebuilding');
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add save.js
git commit -m "fix: save/load restores-or-creates teams by id (expansion teams survive reload)"
```

---

### Task 6: `scripts/validate-commissioner.js` — consolidated Node validator

**Files:**
- Create: `scripts/validate-commissioner.js`

- [ ] **Step 1: Write the consolidated validator**

```js
const assert = require('assert');
const path = require('path');

const commissionerModule = require(path.join(__dirname, '..', 'commissioner.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEditPlayerRatings() {
  const team = teamsModule.TEAMS[0];
  const player = leagueModule.getTeamRoster(team.id)[0];
  const result = commissionerModule.editPlayerRatings(player.id, { overall: 500, potential: -50, attributes: { threePoint: 999, block: -999 } });
  assert.strictEqual(result.success, true, 'edit should report success for a real player');
  assert.strictEqual(player.overall, 99, 'overall should clamp to RATING_MAX');
  assert.strictEqual(player.potential, 25, 'potential should clamp to RATING_MIN');
  assert.strictEqual(player.attributes.threePoint, 99, 'attribute should clamp to RATING_MAX');
  assert.strictEqual(player.attributes.block, 25, 'attribute should clamp to RATING_MIN');
  const missing = commissionerModule.editPlayerRatings('not-a-real-id', { overall: 80 });
  assert.strictEqual(missing.success, false, 'editing an unknown player id should fail cleanly');
  console.log('checkEditPlayerRatings: OK');
}

checkEditPlayerRatings();

function checkDeletePlayer() {
  const team = teamsModule.TEAMS[1];
  const player = leagueModule.getTeamRoster(team.id)[0];
  const result = commissionerModule.deletePlayer(player.id);
  assert.strictEqual(result.success, true, 'delete should report success for a real player');
  assert.strictEqual(leagueModule.getPlayerById(player.id), undefined, 'deleted player should no longer be findable');
  const missing = commissionerModule.deletePlayer('not-a-real-id');
  assert.strictEqual(missing.success, false, 'deleting an unknown player id should fail cleanly');
  console.log('checkDeletePlayer: OK');
}

checkDeletePlayer();

function checkCreatePlayer() {
  const freeAgent = commissionerModule.createPlayer({ name: 'Validator Rookie', position: 'SG', age: 19, overall: 70, potential: 88, archetype: 'primary_scorer' });
  assert.strictEqual(freeAgent.teamId, null, 'a player created with no teamId should be a free agent');
  assert.strictEqual(Object.keys(freeAgent.attributes).length, 20, 'attributes should be fully derived, not left empty');
  assert.ok(Array.isArray(freeAgent.hiddenTraits), 'hiddenTraits should be an array');
  assert.strictEqual(typeof freeAgent.hiddenPersonality.ego, 'number', 'hiddenPersonality should be populated, not an empty stub');
  assert.strictEqual(typeof freeAgent.hiddenTendencies.threeTendency, 'number', 'hiddenTendencies should be populated, not an empty stub');

  const team = teamsModule.TEAMS[3];
  const rostered = commissionerModule.createPlayer({ name: 'Validator Starter', position: 'C', age: 24, overall: 82, potential: 82, archetype: 'rim_protector', teamId: team.id });
  assert.strictEqual(rostered.teamId, team.id, 'a player created with a teamId should be rostered on that team');
  assert.ok(rostered.contract.salary > 0, 'a rostered created player should have a nonzero salary');
  assert.strictEqual(typeof rostered.jerseyNumber, 'number', 'a rostered created player should get a jersey number');
  assert.strictEqual(leagueModule.getPlayerById(rostered.id), rostered, 'created player should be findable via getPlayerById');
  console.log('checkCreatePlayer: OK');
}

checkCreatePlayer();

function checkForceTrade() {
  const teamA = teamsModule.TEAMS[10];
  const teamB = teamsModule.TEAMS[11];
  const rosterA = leagueModule.getTeamRoster(teamA.id).slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(b, teamA) - tradeEvaluatorModule.adjustedPlayerValue(a, teamA); });
  const rosterB = leagueModule.getTeamRoster(teamB.id).slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(a, teamB) - tradeEvaluatorModule.adjustedPlayerValue(b, teamB); });
  const best = rosterA[0];
  const worst = rosterB[0];
  const lopsided = {
    participants: [teamA.id, teamB.id],
    assignments: [
      { playerId: best.id, fromTeamId: teamA.id, toTeamId: teamB.id },
      { playerId: worst.id, fromTeamId: teamB.id, toTeamId: teamA.id }
    ],
    pickAssignments: []
  };
  const normalEval = tradeModule.evaluateTrade(lopsided, null, true);
  assert.strictEqual(normalEval.accepted, false, 'test setup should produce a trade normal evaluation would reject');
  const forced = commissionerModule.forceTrade(lopsided);
  assert.strictEqual(forced.success, true, 'forceTrade should execute a trade normal evaluation would reject');
  assert.strictEqual(leagueModule.getPlayerById(best.id).teamId, teamB.id, 'forceTrade should actually move the players');

  const teamC = teamsModule.TEAMS[15];
  const rosterC = leagueModule.getTeamRoster(teamC.id);
  const dumpAssignments = rosterC.slice(0, rosterC.length - 5).map(function (p) { return { playerId: p.id, fromTeamId: teamC.id, toTeamId: teamA.id }; });
  const dumpEveryone = { participants: [teamC.id, teamA.id], assignments: dumpAssignments, pickAssignments: [] };
  const blocked = commissionerModule.forceTrade(dumpEveryone);
  assert.strictEqual(blocked.success, false, 'forceTrade should still block a trade that would break the 12-15 roster-size band');
  assert.ok(blocked.rosterErrors.length > 0, 'a blocked forceTrade should report why');
  console.log('checkForceTrade: OK');
}

checkForceTrade();

function checkCreateExpansionTeam() {
  const rng = makeRng(2026);
  const beforeCount = teamsModule.TEAMS.length;
  const team = commissionerModule.createExpansionTeam({ name: 'Vegas Aces', primaryColor: '#111111', secondaryColor: '#EEEEEE', marketSize: 60 }, rng);
  assert.strictEqual(teamsModule.TEAMS.length, beforeCount + 1, 'expansion team should be appended to TEAMS');
  assert.ok(team.conference === 'Eastern' || team.conference === 'Western', 'expansion team should get a valid conference');
  const roster = leagueModule.getTeamRoster(team.id);
  assert.ok(roster.length >= 12 && roster.length <= 15, 'expansion roster should land within the standard 12-15 band');
  assert.strictEqual(new Set(roster.map(function (p) { return p.jerseyNumber; })).size, roster.length, 'expansion roster should have no duplicate jersey numbers');
  const noDonorBelowFloor = teamsModule.TEAMS
    .filter(function (t) { return t.id !== team.id; })
    .every(function (t) { return leagueModule.getTeamRoster(t.id).length >= 12; });
  assert.ok(noDonorBelowFloor, 'no donor team should drop below the 12-player floor during an expansion draft');
  console.log('checkCreateExpansionTeam: OK');
}

checkCreateExpansionTeam();

function checkExpansionTeamSurvivesSaveLoad() {
  const rng = makeRng(78);
  const team = commissionerModule.createExpansionTeam({ name: 'Portland Pines', primaryColor: '#004400', secondaryColor: '#FFFFFF', marketSize: 45 }, rng);
  const gameState = {
    userTeamId: teamsModule.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
    upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2026, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: rng,
    playMode: 'commissioner', automation: {}, feed: [], draftSession: null
  };
  const payload = saveModule.serializeGameState(gameState, 'validator-test');

  const idx = teamsModule.TEAMS.findIndex(function (t) { return t.id === team.id; });
  teamsModule.TEAMS.splice(idx, 1);
  assert.strictEqual(teamsModule.TEAMS.findIndex(function (t) { return t.id === team.id; }), -1, 'test setup should simulate a fresh reload with the expansion team absent');

  const freshState = {};
  saveModule.applySavedState(payload, freshState);
  const restored = teamsModule.TEAMS.find(function (t) { return t.id === team.id; });
  assert.ok(restored, 'expansion team should be recreated in TEAMS on load');
  assert.strictEqual(restored.name, 'Portland Pines', 'restored expansion team should keep its identity fields');
  assert.strictEqual(restored.conference, team.conference, 'restored expansion team should keep its assigned conference');
  assert.strictEqual(restored.marketSize, team.marketSize, 'restored expansion team should keep its mutable fields');
  console.log('checkExpansionTeamSurvivesSaveLoad: OK');
}

checkExpansionTeamSurvivesSaveLoad();

console.log('All commissioner validations passed');
```

- [ ] **Step 2: Run it**

Run: `node scripts/validate-commissioner.js`
Expected: each `checkX: OK` line prints, followed by `All commissioner validations passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-commissioner.js
git commit -m "test: Phase 7B commissioner sandbox validation suite"
```

---

### Task 7: `ui/nav.js` — Commissioner nav entry, play-mode-gated

**Files:**
- Modify: `ui/nav.js` (full file, small)

**Interfaces:**
- Produces: `renderNav(container, activeView, onNavigate, playMode)` — new optional 4th param. The `commissioner` `NAV_ITEMS` entry is skipped entirely (not just disabled) unless `playMode === 'commissioner'`.

- [ ] **Step 1: Add the nav entry and the gating param**

Change the whole file to:
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
  { id: 'saveload', label: 'Save/Load' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'commissioner', label: 'Commissioner' },
  { id: 'salarycap', label: 'Salary Cap' },
  { id: 'news', label: 'League News' },
  { id: 'awards', label: 'Awards' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
];

function renderNav(container, activeView, onNavigate, playMode) {
  container.innerHTML = '';
  NAV_ITEMS.forEach(function (item) {
    if (item.id === 'commissioner' && playMode !== 'commissioner') return;
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.id === activeView) {
      btn.className = 'active';
    }
    btn.addEventListener('click', function () { onNavigate(item.id); });
    container.appendChild(btn);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, renderNav: renderNav };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/nav.js
git commit -m "feat: Commissioner nav entry, gated to commissioner play mode"
```

---

### Task 8: `ui/commissioner.js` (new) — Edit Player + Delete Player sections

**Files:**
- Create: `ui/commissioner.js`

**Interfaces:**
- Consumes: `GameState` (playMode, rng), `PLAYERS_2026`, `getPlayerById`, `getTeamById`, `RATING_MIN`/`RATING_MAX`, `ATTRIBUTE_KEYS` (all existing globals), `editPlayerRatings`/`deletePlayer` (Task 1).
- Produces: `renderCommissioner(container, userTeamId)` (assembled fully in Task 10 — this task writes the Edit/Delete section helpers it will call).

- [ ] **Step 1: Write the Edit Player section**

```js
function renderEditPlayerSection(state) {
  let html = '<section><h3>Edit Player</h3>';
  html += '<select id="commissioner-edit-select"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.editPlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select>';

  if (state.editPlayerId) {
    const player = getPlayerById(state.editPlayerId);
    html += '<table><tbody>';
    html += '<tr><td>Overall</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="overall" value="' + player.overall + '"></td></tr>';
    html += '<tr><td>Potential</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="potential" value="' + player.potential + '"></td></tr>';
    ATTRIBUTE_KEYS.forEach(function (key) {
      html += '<tr><td>' + key + '</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-attribute="' + key + '" value="' + player.attributes[key] + '"></td></tr>';
    });
    html += '</tbody></table>';
    html += '<button id="commissioner-edit-save-btn">Save Changes</button>';
    html += ' <span id="commissioner-edit-result"></span>';
  }
  html += '</section>';
  return html;
}

function wireEditPlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-edit-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.editPlayerId = e.target.value || null;
      redraw();
    });
  }
  const saveBtn = document.getElementById('commissioner-edit-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      const changes = {
        overall: Number(document.querySelector('input[data-edit-field="overall"]').value),
        potential: Number(document.querySelector('input[data-edit-field="potential"]').value),
        attributes: {}
      };
      document.querySelectorAll('input[data-edit-attribute]').forEach(function (input) {
        changes.attributes[input.getAttribute('data-edit-attribute')] = Number(input.value);
      });
      editPlayerRatings(state.editPlayerId, changes);
      document.getElementById('commissioner-edit-result').textContent = 'Saved.';
      redraw();
    });
  }
}
```

- [ ] **Step 2: Write the Delete Player section**

A native `confirm()` dialog is deliberately avoided here (untestable via browser automation, and no precedent for it elsewhere in this codebase) in favor of an inline two-click confirm, tracked in `state`.

```js
function renderDeletePlayerSection(state) {
  let html = '<section><h3>Delete Player</h3>';
  html += '<select id="commissioner-delete-select"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.deletePlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select>';
  if (state.deletePlayerId && state.deleteConfirming) {
    html += ' <button id="commissioner-delete-confirm-btn">Confirm Delete — Cannot Be Undone</button>';
    html += ' <button id="commissioner-delete-cancel-btn">Cancel</button>';
  } else {
    html += ' <button id="commissioner-delete-btn"' + (state.deletePlayerId ? '' : ' disabled') + '>Delete Player</button>';
  }
  html += ' <span id="commissioner-delete-result"></span>';
  html += '</section>';
  return html;
}

function wireDeletePlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-delete-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.deletePlayerId = e.target.value || null;
      state.deleteConfirming = false;
      redraw();
    });
  }
  const deleteBtn = document.getElementById('commissioner-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      state.deleteConfirming = true;
      redraw();
    });
  }
  const confirmBtn = document.getElementById('commissioner-delete-confirm-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      deletePlayer(state.deletePlayerId);
      state.deletePlayerId = null;
      state.deleteConfirming = false;
      document.getElementById('commissioner-delete-result').textContent = 'Deleted.';
      redraw();
    });
  }
  const cancelBtn = document.getElementById('commissioner-delete-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      state.deleteConfirming = false;
      redraw();
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/commissioner.js
git commit -m "feat: ui/commissioner.js Edit Player + Delete Player sections"
```

---

### Task 9: `ui/commissioner.js` — Create Player + Expansion Team sections, assembled `renderCommissioner`

**Files:**
- Modify: `ui/commissioner.js` (add sections, add the top-level render function + `module.exports`)

**Interfaces:**
- Produces: `renderCommissioner(container, userTeamId)` — the full Commissioner view. Renders a placeholder message and returns early when `GameState.playMode !== 'commissioner'` (defense in depth alongside the nav gating from Task 7).

- [ ] **Step 1: Write the Create Player section**

Add to `ui/commissioner.js`:
```js
function renderCreatePlayerSection(state) {
  let html = '<section><h3>Create Player</h3>';
  html += '<label>Name <input type="text" id="commissioner-create-name"></label><br>';
  html += '<label>Position <select id="commissioner-create-position">' + POSITIONS.map(function (pos) { return '<option value="' + pos + '">' + pos + '</option>'; }).join('') + '</select></label><br>';
  html += '<label>Age <input type="number" id="commissioner-create-age" min="18" max="45" value="22"></label><br>';
  html += '<label>Overall <input type="number" id="commissioner-create-overall" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="60"></label><br>';
  html += '<label>Potential <input type="number" id="commissioner-create-potential" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="70"></label><br>';
  html += '<label>Archetype <select id="commissioner-create-archetype">' + CREATE_PLAYER_ARCHETYPES.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select></label><br>';
  html += '<label>Team <select id="commissioner-create-team"><option value="">Free Agent</option>' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select></label><br>';
  html += '<button id="commissioner-create-btn">Create Player</button>';
  html += ' <span id="commissioner-create-result"></span>';
  html += '</section>';
  return html;
}

function wireCreatePlayerEvents(state, redraw) {
  const btn = document.getElementById('commissioner-create-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const name = document.getElementById('commissioner-create-name').value.trim();
    if (!name) {
      document.getElementById('commissioner-create-result').textContent = 'Name is required.';
      return;
    }
    const details = {
      name: name,
      position: document.getElementById('commissioner-create-position').value,
      age: Number(document.getElementById('commissioner-create-age').value),
      overall: Number(document.getElementById('commissioner-create-overall').value),
      potential: Number(document.getElementById('commissioner-create-potential').value),
      archetype: document.getElementById('commissioner-create-archetype').value,
      teamId: document.getElementById('commissioner-create-team').value || null
    };
    const player = createPlayer(details);
    document.getElementById('commissioner-create-result').textContent = 'Created ' + player.name + '.';
    redraw();
  });
}
```

- [ ] **Step 2: Write the Expansion Team section**

Add to `ui/commissioner.js`:
```js
function renderExpansionTeamSection(state) {
  let html = '<section><h3>Create Expansion Team</h3>';
  html += '<label>Name <input type="text" id="commissioner-expansion-name"></label><br>';
  html += '<label>Primary Color <input type="color" id="commissioner-expansion-primary" value="#1D1160"></label><br>';
  html += '<label>Secondary Color <input type="color" id="commissioner-expansion-secondary" value="#FFFFFF"></label><br>';
  html += '<label>Market Size (1-100) <input type="number" id="commissioner-expansion-market" min="1" max="100" value="50"></label><br>';
  html += '<button id="commissioner-expansion-btn">Create Expansion Team</button>';
  if (state.expansionResult) {
    html += '<p>Created ' + state.expansionResult.name + ' (' + state.expansionResult.conference + ' — ' + state.expansionResult.division + '), roster of ' +
      getTeamRoster(state.expansionResult.id).length + ' via expansion draft. Takes effect next season.</p>';
  }
  html += '</section>';
  return html;
}

function wireExpansionTeamEvents(state, redraw) {
  const btn = document.getElementById('commissioner-expansion-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const name = document.getElementById('commissioner-expansion-name').value.trim();
    if (!name) return;
    const details = {
      name: name,
      primaryColor: document.getElementById('commissioner-expansion-primary').value,
      secondaryColor: document.getElementById('commissioner-expansion-secondary').value,
      marketSize: Number(document.getElementById('commissioner-expansion-market').value)
    };
    state.expansionResult = createExpansionTeam(details, GameState.rng);
    redraw();
  });
}
```

- [ ] **Step 3: Write `renderCommissioner` and the exports block**

Add to the top of `ui/commissioner.js` (above the section functions) and at the bottom:
```js
function renderCommissioner(container, userTeamId) {
  if (GameState.playMode !== 'commissioner') {
    container.innerHTML = '<p>Commissioner tools are only available in Commissioner mode.</p>';
    return;
  }

  const state = {
    editPlayerId: null,
    deletePlayerId: null,
    deleteConfirming: false,
    expansionResult: null
  };

  function draw() {
    let html = '<h2>Commissioner Tools</h2>';
    html += renderEditPlayerSection(state);
    html += renderDeletePlayerSection(state);
    html += renderCreatePlayerSection(state);
    html += renderExpansionTeamSection(state);
    container.innerHTML = html;
    wireEditPlayerEvents(state, draw);
    wireDeletePlayerEvents(state, draw);
    wireCreatePlayerEvents(state, draw);
    wireExpansionTeamEvents(state, draw);
  }

  draw();
}
```
and, at the end of the file:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderCommissioner: renderCommissioner };
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/commissioner.js
git commit -m "feat: ui/commissioner.js Create Player + Expansion Team sections, assembled view"
```

---

### Task 10: `ui/tradeCenter.js` — Force Trade button

**Files:**
- Modify: `ui/tradeCenter.js:1-32` (add `handleForceTrade` near `handlePropose`), `ui/tradeCenter.js:122-128` (draw's button row), `ui/tradeCenter.js:184-188` (wireEvents)

**Interfaces:**
- Consumes: `forceTrade` (Task 3).
- Produces: Force Trade button, rendered only when `GameState.playMode === 'commissioner'`, next to the existing Propose Trade button.

- [ ] **Step 1: Add `handleForceTrade`**

Add above `renderTradeCenter` (after `handlePropose`, `ui/tradeCenter.js:1-32`):
```js
function handleForceTrade(state, redraw) {
  if (state.assignments.length === 0 && state.pickAssignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player or draft pick to the trade first.</p>';
    return;
  }
  const result = forceTrade(state);
  const resultEl = document.getElementById('trade-result');
  if (!result.success) {
    resultEl.innerHTML = '<p>Force trade blocked: ' + result.rosterErrors.join('; ') + '</p>';
    return;
  }
  resultEl.innerHTML = '<p>Trade forced through — no value/salary checks applied.</p>';
  state.assignments = [];
  state.pickAssignments = [];
  redraw();
}
```

- [ ] **Step 2: Render the button conditionally**

Change (`ui/tradeCenter.js:122-124`):
```js
    html += '<div id="trade-result"></div>';
    html += '<button id="propose-trade-btn">Propose Trade</button>';

    container.innerHTML = html;
```
to:
```js
    html += '<div id="trade-result"></div>';
    html += '<button id="propose-trade-btn">Propose Trade</button>';
    if (GameState.playMode === 'commissioner') {
      html += ' <button id="force-trade-btn">Force Trade</button>';
    }

    container.innerHTML = html;
```

- [ ] **Step 3: Wire the button's click handler**

Change (`ui/tradeCenter.js:184-187`):
```js
    document.getElementById('propose-trade-btn').addEventListener('click', function () {
      handlePropose(state, userTeamId, draw);
    });
```
to:
```js
    document.getElementById('propose-trade-btn').addEventListener('click', function () {
      handlePropose(state, userTeamId, draw);
    });
    const forceBtn = document.getElementById('force-trade-btn');
    if (forceBtn) {
      forceBtn.addEventListener('click', function () {
        handleForceTrade(state, draw);
      });
    }
```

- [ ] **Step 4: Commit**

```bash
git add ui/tradeCenter.js
git commit -m "feat: Trade Center Force Trade button (commissioner mode only)"
```

---

### Task 11: `ui/settings.js` — Disable Cap checkbox (commissioner-gated)

**Files:**
- Modify: `ui/settings.js:42-52`

**Interfaces:**
- Produces: a "Commissioner" settings section with a Disable Cap checkbox, rendered only when `GameState.playMode === 'commissioner'`, wired to `GameState.settings.capDisabled`.

- [ ] **Step 1: Add the section**

Change (`ui/settings.js:42-52`):
```js
  if (GameState.playMode !== 'spectator') {
    html += '<h3>Automation</h3>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-automation-key="' + key + '"' + (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });

    html += '<h3>Pause Multi-Season Sim On</h3>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-pause-on-key="' + key + '"' + (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });
  }
```
to:
```js
  if (GameState.playMode !== 'spectator') {
    html += '<h3>Automation</h3>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-automation-key="' + key + '"' + (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });

    html += '<h3>Pause Multi-Season Sim On</h3>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-pause-on-key="' + key + '"' + (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });

    if (GameState.playMode === 'commissioner') {
      html += '<h3>Commissioner</h3>';
      html += '<label style="display:block;"><input type="checkbox" id="settings-disable-cap"' + (GameState.settings.capDisabled ? ' checked' : '') + '> Disable Salary Cap (free agency and trades ignore cap space entirely)</label>';
    }
  }
```

- [ ] **Step 2: Wire the checkbox**

Change (`ui/settings.js:76-80`, the last handler block before the closing `}`):
```js
  container.querySelectorAll('input[data-pause-on-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.pauseOn[e.target.getAttribute('data-pause-on-key')] = e.target.checked;
    });
  });
}
```
to:
```js
  container.querySelectorAll('input[data-pause-on-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.pauseOn[e.target.getAttribute('data-pause-on-key')] = e.target.checked;
    });
  });

  const disableCapInput = document.getElementById('settings-disable-cap');
  if (disableCapInput) {
    disableCapInput.addEventListener('change', function (e) {
      GameState.settings.capDisabled = e.target.checked;
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/settings.js
git commit -m "feat: Disable Cap checkbox in Settings (commissioner mode only)"
```

---

### Task 12: `script.js` — wire Commissioner into `BUILT_VIEWS` and `renderNav`

**Files:**
- Modify: `script.js:149-167` (`BUILT_VIEWS`), `script.js:233` (`renderNav` call)

**Interfaces:**
- Produces: `commissioner` view routed through `renderCommissioner`; `renderNav` receives `GameState.playMode` so the nav button gates correctly.

- [ ] **Step 1: Add the `BUILT_VIEWS` entry**

Change (`script.js:149-167`):
```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) {
    if (GameState.draftSession && currentPick(GameState.draftSession)) {
      renderDraftPicker(container, GameState.draftSession, GameState.userTeamId, handleUserDraftPick);
    } else {
      renderDraftResults(container, GameState.lastDraftResults || []);
    }
  },
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed
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
  draft: function (container) {
    if (GameState.draftSession && currentPick(GameState.draftSession)) {
      renderDraftPicker(container, GameState.draftSession, GameState.userTeamId, handleUserDraftPick);
    } else {
      renderDraftResults(container, GameState.lastDraftResults || []);
    }
  },
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed,
  commissioner: renderCommissioner
};
```

- [ ] **Step 2: Pass `playMode` into `renderNav`**

Change (`script.js:233`):
```js
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView);
```
to:
```js
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView, GameState.playMode);
```

- [ ] **Step 3: Commit**

```bash
git add script.js
git commit -m "feat: wire Commissioner view into BUILT_VIEWS and nav gating"
```

---

### Task 13: Wire `index.html` + full validator suite + end-to-end browser verification

**Files:**
- Modify: `index.html:16-56`

- [ ] **Step 1: Add the new script tags**

After `<script src="autoGM.js"></script>` (`index.html:38`), add:
```html
  <script src="commissioner.js"></script>
```
After `<script src="ui/tradeCenter.js"></script>` (`index.html:50`), add:
```html
  <script src="ui/commissioner.js"></script>
```

- [ ] **Step 2: Run every Node validator**

Run:
```bash
node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js && node scripts/validate-save.js && node scripts/validate-automation.js && node scripts/validate-commissioner.js
```
Expected: every file prints its own passing summary line, no errors.

- [ ] **Step 3: Live browser verification**

Serve the app on a fresh port (avoid stale-JS caching, per this project's established pattern):
```bash
python -m http.server 8008 --directory "C:\Users\cory\Desktop\nba"
```
Then, in the browser:
1. Start a fresh **GM**-mode game. Confirm no "Commissioner" nav button renders.
2. Go to Settings, switch to **Commissioner** mode. Confirm the "Commissioner" nav button now appears; the "Disable Salary Cap" checkbox appears under a new "Commissioner" section. Click into the Commissioner view.
3. **Edit Player**: pick a player, change Overall to 99 and one attribute, Save. Reselect the same player (or check Roster) and confirm the new values stuck.
4. **Create Player**: create a free agent (no team). Confirm it appears when re-opening the Edit Player or Delete Player dropdown. Create a second player directly onto a team; confirm it shows up in that team's Roster view with a real salary and jersey number.
5. **Delete Player**: pick a player, click Delete Player (button becomes a two-step Confirm/Cancel — confirm Cancel leaves the player intact, then Delete → Confirm actually removes them), confirm they're gone from Roster.
6. **Force Trade**: in Trade Center, confirm the "Force Trade" button is visible (Commissioner only). Build a deliberately lopsided trade (a star for a bench player) and click Force Trade — confirm it executes despite being lopsided. Build a trade that would drop a team below 12 players and confirm Force Trade is blocked with an error message.
7. **Disable Cap**: toggle it on in Settings. Go to Free Agency for a team already near/over the cap and confirm offers are no longer blocked by cap space.
8. **Expansion Team**: fill out the form (name, colors, market size) and submit. Confirm a result message shows the assigned conference/division and roster size. Advance to a new season (or check Standings/Schedule once the next season generates) and confirm the new team appears with a full schedule.
9. **Save/load round-trip**: save mid-session, reload the page, load the save. Confirm the edited player's ratings, the created players, the deletion, `capDisabled`, and — most importantly — the **expansion team** (this is the bug Task 5 fixed) all persisted correctly. Check the expansion team specifically via Standings or Roster, not just that load "succeeded."
10. Check the browser console (`mcp__Claude_Browser__read_console_messages`, `onlyErrors: true`) after every step above — zero errors throughout.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: wire Phase 7B commissioner sandbox into the app shell"
```

- [ ] **Step 5: Invoke `superpowers:finishing-a-development-branch`**

This project works directly on `master` with no feature branches and no git remote — follow that skill's guidance for the no-remote/no-branch case (verify tests, confirm clean `git status`, report completion).
