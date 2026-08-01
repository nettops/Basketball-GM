# Phase 2: Season Simulation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real 82-game schedule simulates end-to-end — regular season through a standard 8-team-per-conference best-of-7 playoff bracket — with a pluggable sim-engine architecture, fatigue, basic injuries, full box scores, and sim-advance controls with a speed setting, all browsable in the existing UI shell from Phase 1.

**Architecture:** Pure-logic modules (`schedule.js`, `simEngine.js`, `simEngineBoxScore.js`, `fatigue.js`, `injuries.js`, `playoffs.js`, `league.js`) hold all season-simulation logic and are dual browser-global/Node-`require`-able (same pattern Phase 1 established in `players-2026.js`), so they're unit-testable with plain Node `assert` scripts. `script.js` stays thin — DOM glue and `GameState` only. New `ui/*.js` files render the schedule, sim controls, and settings.

**Tech Stack:** Same as Phase 1 — HTML, CSS, vanilla JavaScript, no build step, no external APIs, no frameworks. Node.js used only for development-time validation scripts.

## Global Constraints

- Same constraints as Phase 1 (see `2026-07-31-phase-1-foundation.md`): vanilla JS only, no frameworks/build step, offline, ratings/attributes stay 25-99, modular files, comment only non-obvious logic.
- No hidden traits/personality influence on simulation this phase (Phase 5 doesn't exist yet) — the engine uses only `overall`, `attributes`, `chemistry`, and `status.fatigue`/`status.injury`.
- Score-only and possession-by-possession sim engines are NOT implemented this phase — only their registry slots (`null`) exist, so the architecture supports adding them later without changing the registry contract.
- The season's RNG seed is randomized per new game (`Date.now()`-based default) but every RNG-consuming function takes the RNG instance as a parameter, never reads global randomness directly — this is what keeps the same functions callable with a fixed seed in tests.

---

## File Structure

```
league.js                # NEW — derived-data helpers moved out of script.js (getTeamRoster,
                          #   getTeamPayroll, getPlayerById): Node-testable, browser-global too
rng.js                    # NEW — seeded PRNG (mulberry32), dual browser/Node
schedule.js                # NEW — 82-game matchup + date generation
simEngine.js                # NEW — engine registry + active-engine lookup
simEngineBoxScore.js         # NEW — the "team rating + box score" engine
fatigue.js                  # NEW — fatigue gain/decay
injuries.js                  # NEW — injury rolls, recovery countdown
playoffs.js                  # NEW — seeding, bracket, series/game progression
script.js                  # MODIFIED — now just GameState + view routing; derived-data
                          #   helpers moved to league.js; season init wired into selectTeam
ui/schedule.js              # NEW — schedule/results view + box score expansion
ui/simControls.js            # NEW — Next Game/Next Day/Sim to End of ... + speed setting
ui/settings.js              # NEW — sim engine picker + speed setting
ui/standings.js            # MODIFIED — add pointsFor/pointsAgainst/differential columns
ui/dashboard.js            # MODIFIED — live record + next-game info instead of the 0-0 stub
ui/roster.js                # MODIFIED — add PPG/RPG/APG/FG% columns from season stats
ui/nav.js                  # MODIFIED — mark 'schedule' and 'settings' as real views
index.html                # MODIFIED — new script tags, in dependency order
scripts/validate-sim.js      # NEW — Node validation script for all pure-logic modules above
                          #   (same pattern as scripts/validate-data.js from Phase 1)
```

**Script tag load order** (dependency order, `index.html`): `data.js`, `teams.js`, `players-2026.js`, `league.js`, `rng.js`, `schedule.js`, `simEngine.js`, `simEngineBoxScore.js`, `fatigue.js`, `injuries.js`, `playoffs.js`, `ui/nav.js`, `ui/teamSelect.js`, `ui/dashboard.js`, `ui/roster.js`, `ui/standings.js`, `ui/schedule.js`, `ui/simControls.js`, `ui/settings.js`, `script.js`.

**Verified algorithms:** the schedule-pairing and date-assignment algorithms below were prototyped and verified correct in Node before writing this plan (exactly 82 games/team, exactly 1,230 games total, exact 6-four-game/4-three-game non-division split per team, zero unassigned games, "no 3 games in 3 days" constraint holds). The code in Tasks 3-4 is that verified code, adapted to this project's data shapes.

---

### Task 1: `league.js` — extract derived-data helpers from `script.js`

Phase 1's `script.js` defined `getTeamRoster`/`getTeamPayroll` directly, with no Node-compat guard, because nothing needed to test them outside the browser. Every module in this phase does. Moving them into a dual browser/Node module (matching the pattern `players-2026.js` already established) avoids duplicating this logic and unblocks Node testing for everything else.

**Files:**
- Create: `league.js`
- Modify: `script.js`

**Interfaces:**
- Consumes: `PLAYERS_2026` (from `players-2026.js`).
- Produces: `getTeamRoster(teamId)`, `getTeamPayroll(teamId)`, `getPlayerById(playerId)` — used by every task in this plan.

- [ ] **Step 1: Create `league.js`**

```js
var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? require('./players-2026.js')
  : { PLAYERS_2026: PLAYERS_2026 };

function getTeamRoster(teamId) {
  return _LEAGUE_DATA.PLAYERS_2026.filter(function (p) { return p.teamId === teamId; });
}

function getTeamPayroll(teamId) {
  return getTeamRoster(teamId).reduce(function (sum, p) { return sum + p.contract.salary; }, 0);
}

function getPlayerById(playerId) {
  return _LEAGUE_DATA.PLAYERS_2026.find(function (p) { return p.id === playerId; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById };
}
```

- [ ] **Step 2: Remove the now-duplicated functions from `script.js`**

In `script.js`, delete the `getTeamRoster` and `getTeamPayroll` function definitions (now provided by `league.js`, loaded earlier in `index.html`). Leave everything else in `script.js` unchanged for this task.

- [ ] **Step 3: Add `league.js` to `index.html`, before `script.js` and after `players-2026.js`**

```html
<script src="players-2026.js"></script>
<script src="league.js"></script>
```

- [ ] **Step 4: Manual verification**

Open `index.html` in a browser (or reload if already open), select a team, confirm the Dashboard still renders payroll/roster size correctly and the browser console has no errors (`getTeamRoster`/`getTeamPayroll` still resolve, now from `league.js`).

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add league.js script.js index.html
git commit -m "refactor: extract derived-data helpers into league.js for Node testability"
```

---

### Task 2: `rng.js` — seeded PRNG

**Files:**
- Create: `rng.js`
- Create: `scripts/validate-sim.js`

**Interfaces:**
- Produces: `makeRng(seed)` returning a `() => number` function producing values in `[0, 1)` — consumed by every module that needs randomness (schedule, sim engine, injuries).

- [ ] **Step 1: Create `rng.js`**

```js
// mulberry32 — small, fast, deterministic given a seed. Every caller passes its
// own rng instance explicitly (never reads global randomness), which is what
// keeps schedule/sim/injury functions testable with a fixed seed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRng: makeRng };
}
```

- [ ] **Step 2: Create `scripts/validate-sim.js` with a determinism check**

```js
const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkRng() {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB, 'same seed must produce same sequence');
  seqA.forEach(function (v) { assert.ok(v >= 0 && v < 1, 'rng output out of [0,1) range'); });
  const c = makeRng(43);
  assert.notStrictEqual(a(), c(), 'different seeds should (almost certainly) differ');
  console.log('checkRng: OK');
}

checkRng();
console.log('All sim validations passed');
```

- [ ] **Step 3: Run it**

Run: `node scripts/validate-sim.js`
Expected:
```
checkRng: OK
All sim validations passed
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add rng.js scripts/validate-sim.js
git commit -m "feat: seeded PRNG for deterministic-when-needed simulation"
```

---

### Task 3: `schedule.js` — matchup generation (game counts)

**Files:**
- Create: `schedule.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `TEAMS` (from `teams.js`), `CONFERENCES`, `DIVISIONS` (from `data.js`), `makeRng` (from `rng.js`).
- Produces: `generateMatchupCounts(rng)` → returns a `gamesCount` object keyed `gamesCount[teamIdA][teamIdB] = n` (symmetric) giving how many games each pair of teams plays. Consumed by Task 4's date-assignment step.

- [ ] **Step 1: Write `schedule.js` with the matchup-count generator**

This is the verified circulant construction: division rivals get 4 games each; for each pair of divisions within a conference, a seeded rotation offset picks exactly 3 of 5 teams-across-divisions as 4-game partners and 2 as 3-game partners (guaranteeing every team ends with exactly 6 four-game and 4 three-game non-division conference opponents — the two numbers that must both hold exactly, since `4×6 + 3×4 = 36` is required for the 82-game-per-team total); inter-conference opponents get 2 games each.

```js
var _SCHED_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js') }
  : { data: { CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS }, teams: { TEAMS: TEAMS } };

function generateMatchupCounts(rng) {
  const TEAMS_LIST = _SCHED_DATA.teams.TEAMS;
  const CONFS = _SCHED_DATA.data.CONFERENCES;
  const DIVS = _SCHED_DATA.data.DIVISIONS;

  const gamesCount = {};
  TEAMS_LIST.forEach(function (t) { gamesCount[t.id] = {}; });

  function setGames(a, b, n) {
    gamesCount[a][b] = n;
    gamesCount[b][a] = n;
  }

  // 1. Division rivals: 4 games each.
  CONFS.forEach(function (conf) {
    DIVS[conf].forEach(function (div) {
      const divTeams = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === div; });
      for (let i = 0; i < divTeams.length; i++) {
        for (let j = i + 1; j < divTeams.length; j++) {
          setGames(divTeams[i].id, divTeams[j].id, 4);
        }
      }
    });
  });

  // 2. Non-division conference opponents: circulant construction per division-pair,
  // guaranteeing exactly 3 four-game + 2 three-game partners per team per other division
  // (6 four-game + 4 three-game total across both other divisions).
  CONFS.forEach(function (conf) {
    const divs = DIVS[conf];
    for (let d1 = 0; d1 < divs.length; d1++) {
      for (let d2 = d1 + 1; d2 < divs.length; d2++) {
        const teamsA = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d1]; });
        const teamsB = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d2]; });
        const r = Math.floor(rng() * 5);
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            const isFourGame = (b - a - r + 25) % 5 <= 2;
            setGames(teamsA[a].id, teamsB[b].id, isFourGame ? 4 : 3);
          }
        }
      }
    }
  });

  // 3. Inter-conference: 2 games each.
  TEAMS_LIST.forEach(function (a) {
    TEAMS_LIST.forEach(function (b) {
      if (a.conference !== b.conference && a.id < b.id) {
        setGames(a.id, b.id, 2);
      }
    });
  });

  return gamesCount;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateMatchupCounts: generateMatchupCounts };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

Add before the final `console.log('All sim validations passed');` line (and add the new `require`s near the top with the others):

```js
const { generateMatchupCounts } = require(path.join(__dirname, '..', 'schedule.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

function checkMatchupCounts() {
  const rng = makeRng(42);
  const gamesCount = generateMatchupCounts(rng);

  let totalGames = 0;
  const bad = [];
  teamsModule.TEAMS.forEach(function (t) {
    const total = Object.values(gamesCount[t.id]).reduce(function (s, n) { return s + n; }, 0);
    totalGames += total;
    if (total !== 82) bad.push([t.id, total]);
  });
  assert.strictEqual(bad.length, 0, 'teams with wrong total games: ' + JSON.stringify(bad));
  assert.strictEqual(totalGames, 82 * 30, 'sum of all teams total games must be 82*30');

  teamsModule.TEAMS.forEach(function (t) {
    const nonDivConfOpponents = teamsModule.TEAMS.filter(function (o) {
      return o.conference === t.conference && o.division !== t.division;
    });
    const fourGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 4; }).length;
    const threeGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 3; }).length;
    assert.strictEqual(fourGameCount, 6, t.id + ' should have 6 four-game non-division opponents, got ' + fourGameCount);
    assert.strictEqual(threeGameCount, 4, t.id + ' should have 4 three-game non-division opponents, got ' + threeGameCount);
  });

  console.log('checkMatchupCounts: OK');
}

checkMatchupCounts();
```

Also move the final `console.log('All sim validations passed');` to after this new check (keep it last).

- [ ] **Step 3: Run it**

Run: `node scripts/validate-sim.js`
Expected: `checkRng: OK`, `checkMatchupCounts: OK`, `All sim validations passed`.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add schedule.js scripts/validate-sim.js
git commit -m "feat: schedule matchup-count generator (real NBA game-count rules)"
```

---

### Task 4: `schedule.js` — date assignment

**Files:**
- Modify: `schedule.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `generateMatchupCounts` (own module, Task 3), `TEAMS`.
- Produces: `generateSeasonGames(rng, seasonStartDayIndex)` → returns an array of `{ id, home, away, day }` (1,230 entries, `day` a 0-based offset from season start) covering every game with a home/away assignment and a date. Consumed by Task 14 (season initialization), which converts `day` into a real calendar date string.

- [ ] **Step 1: Add the game-list expansion and date-assignment functions to `schedule.js`**

Add above the `module.exports` block:

```js
const SEASON_DAYS = 175; // late-Oct to mid-Apr, generously bounds the ~127 days the
                          // verified prototype actually needed to fit all 1,230 games

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

function expandToGameList(gamesCount, teamsList, rng) {
  const gameList = [];
  let gid = 0;
  teamsList.forEach(function (a) {
    teamsList.forEach(function (b) {
      if (a.id < b.id) {
        const n = gamesCount[a.id][b.id];
        const aHome = Math.floor(n / 2) + (n % 2 === 1 ? Math.round(rng()) : 0);
        const bHome = n - aHome;
        for (let i = 0; i < aHome; i++) gameList.push({ id: gid++, home: a.id, away: b.id });
        for (let i = 0; i < bHome; i++) gameList.push({ id: gid++, home: b.id, away: a.id });
      }
    });
  });
  return gameList;
}

// Greedily assigns each game to the earliest day where neither team would end up
// with 2 games in the trailing 3-day window (i.e. no team plays 3 games in 3 days).
function assignDates(gameList, teamsList, rng) {
  shuffle(gameList, rng);
  const teamIdx = {};
  teamsList.forEach(function (t, i) { teamIdx[t.id] = i; });
  const lastGameDays = teamsList.map(function () { return []; });

  function eligible(teamId, day) {
    const recent = lastGameDays[teamIdx[teamId]].filter(function (d) { return d >= day - 2; });
    return recent.length < 2;
  }

  let pending = gameList.slice();
  const assigned = [];

  for (let day = 0; day < SEASON_DAYS && pending.length > 0; day++) {
    const scheduledToday = {};
    const stillPending = [];
    pending.forEach(function (g) {
      if (!scheduledToday[g.home] && !scheduledToday[g.away] && eligible(g.home, day) && eligible(g.away, day)) {
        assigned.push({ id: g.id, home: g.home, away: g.away, day: day });
        scheduledToday[g.home] = true;
        scheduledToday[g.away] = true;
        [g.home, g.away].forEach(function (teamId) {
          lastGameDays[teamIdx[teamId]] = lastGameDays[teamIdx[teamId]].filter(function (d) { return d >= day - 2; }).concat([day]);
        });
      } else {
        stillPending.push(g);
      }
    });
    pending = stillPending;
  }

  if (pending.length > 0) {
    throw new Error('assignDates: ' + pending.length + ' games could not be scheduled within ' + SEASON_DAYS + ' days');
  }
  return assigned;
}

function generateSeasonGames(rng, teamsList) {
  const gamesCount = generateMatchupCounts(rng);
  const gameList = expandToGameList(gamesCount, teamsList, rng);
  return assignDates(gameList, teamsList, rng);
}
```

- [ ] **Step 2: Update the `module.exports` block in `schedule.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateMatchupCounts: generateMatchupCounts, generateSeasonGames: generateSeasonGames };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

Insert before the final `console.log('All sim validations passed');`:

```js
function checkSeasonGames() {
  const rng = makeRng(42);
  const games = require(path.join(__dirname, '..', 'schedule.js')).generateSeasonGames(rng, teamsModule.TEAMS);

  assert.strictEqual(games.length, 1230, 'expected exactly 1230 games');

  const perTeamCount = {};
  teamsModule.TEAMS.forEach(function (t) { perTeamCount[t.id] = 0; });
  games.forEach(function (g) {
    perTeamCount[g.home]++;
    perTeamCount[g.away]++;
  });
  teamsModule.TEAMS.forEach(function (t) {
    assert.strictEqual(perTeamCount[t.id], 82, t.id + ' should have 82 games, got ' + perTeamCount[t.id]);
  });

  // No team plays 3+ games within any 3-day window.
  const daysByTeam = {};
  teamsModule.TEAMS.forEach(function (t) { daysByTeam[t.id] = []; });
  games.forEach(function (g) {
    daysByTeam[g.home].push(g.day);
    daysByTeam[g.away].push(g.day);
  });
  Object.keys(daysByTeam).forEach(function (teamId) {
    const days = daysByTeam[teamId].slice().sort(function (a, b) { return a - b; });
    for (let i = 0; i + 2 < days.length; i++) {
      assert.ok(days[i + 2] - days[i] > 2, teamId + ' has 3 games within a 3-day window around day ' + days[i]);
    }
  });

  console.log('checkSeasonGames: OK');
}

checkSeasonGames();
```

- [ ] **Step 4: Run it**

Run: `node scripts/validate-sim.js`
Expected: `checkRng: OK`, `checkMatchupCounts: OK`, `checkSeasonGames: OK`, `All sim validations passed`.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add schedule.js scripts/validate-sim.js
git commit -m "feat: schedule date assignment respecting no-3-games-in-3-days"
```

---

### Task 5: `simEngine.js` — engine registry + settings defaults

**Files:**
- Create: `simEngine.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: nothing yet (registry entries besides `boxscore` are `null` until Task 6 fills one in — this task defines the registry shape and lookup function first).
- Produces: `SIM_ENGINES` (registry object), `getActiveEngine(settings)` — consumed by Task 9 (`simulateDate`).

- [ ] **Step 1: Write `simEngine.js`**

```js
// Registry of available sim engines. Only `boxscore` is implemented this phase;
// `scoreonly` and `possession` are reserved slots for later phases — keeping them
// present (rather than omitted) is what lets ui/settings.js show them as disabled
// "coming later" options without special-casing missing keys.
const SIM_ENGINES = {
  boxscore: null,   // filled in by simEngineBoxScore.js once it loads
  scoreonly: null,
  possession: null
};

function registerEngine(name, engine) {
  if (!(name in SIM_ENGINES)) {
    throw new Error('registerEngine: unknown engine name ' + name);
  }
  SIM_ENGINES[name] = engine;
}

function getActiveEngine(settings) {
  const name = (settings && settings.simEngine) || 'boxscore';
  const engine = SIM_ENGINES[name];
  if (!engine) {
    throw new Error('getActiveEngine: engine "' + name + '" is not implemented yet');
  }
  return engine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIM_ENGINES: SIM_ENGINES, registerEngine: registerEngine, getActiveEngine: getActiveEngine };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

```js
function checkEngineRegistry() {
  const simEngineModule = require(path.join(__dirname, '..', 'simEngine.js'));
  assert.ok('boxscore' in simEngineModule.SIM_ENGINES);
  assert.ok('scoreonly' in simEngineModule.SIM_ENGINES);
  assert.ok('possession' in simEngineModule.SIM_ENGINES);
  simEngineModule.registerEngine('boxscore', { simulateGame: function () { return { homeScore: 1, awayScore: 0, boxScore: null }; } });
  const engine = simEngineModule.getActiveEngine({ simEngine: 'boxscore' });
  assert.strictEqual(typeof engine.simulateGame, 'function');
  assert.throws(function () { simEngineModule.getActiveEngine({ simEngine: 'possession' }); }, /not implemented yet/);
  console.log('checkEngineRegistry: OK');
}

checkEngineRegistry();
```

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-sim.js` — expect the new `checkEngineRegistry: OK` line among the others, all passing.

```bash
cd "C:\Users\cory\Desktop\nba"
git add simEngine.js scripts/validate-sim.js
git commit -m "feat: pluggable sim engine registry"
```

---

### Task 6: `simEngineBoxScore.js` — team rating + score generation

**Files:**
- Create: `simEngineBoxScore.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getTeamRoster` (from `league.js`), `getTeamById` (from `teams.js`), `registerEngine` (from `simEngine.js`).
- Produces: `computeTeamRating(teamId)`, `simulateScore(homeRating, awayRating, rng)` — consumed by this same file's `simulateGame` (Task 7) and by validation.

- [ ] **Step 1: Write the rating and score functions in `simEngineBoxScore.js`**

```js
var _ENGINE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js') }
  : { league: { getTeamRoster: getTeamRoster }, teams: { getTeamById: getTeamById }, simEngine: { registerEngine: registerEngine } };

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

function simulateScore(homeRating, awayRating, rng) {
  const BASE_PACE = 112;
  const HOME_COURT_BONUS = 3;
  const diff = homeRating - awayRating;
  const homeExpected = BASE_PACE + diff * 0.6 + HOME_COURT_BONUS;
  const awayExpected = BASE_PACE - diff * 0.6;
  let homeScore = Math.round(homeExpected + (rng() - 0.5) * 24);
  let awayScore = Math.round(awayExpected + (rng() - 0.5) * 24);
  homeScore = Math.max(70, homeScore);
  awayScore = Math.max(70, awayScore);
  if (homeScore === awayScore) {
    // NBA games can't end in a tie — nudge whichever team had the rating edge.
    if (homeRating >= awayRating) homeScore += 1; else awayScore += 1;
  }
  return { homeScore: homeScore, awayScore: awayScore };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeTeamRating: computeTeamRating, simulateScore: simulateScore };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

```js
function checkScoreSimulation() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(99);
  let homeWins = 0;
  const TRIALS = 500;
  for (let i = 0; i < TRIALS; i++) {
    const result = engineModule.simulateScore(95, 80, rng); // clear home rating edge
    assert.ok(result.homeScore >= 70 && result.homeScore <= 160, 'home score out of realistic range');
    assert.ok(result.awayScore >= 70 && result.awayScore <= 160, 'away score out of realistic range');
    assert.notStrictEqual(result.homeScore, result.awayScore, 'games must not end in a tie');
    if (result.homeScore > result.awayScore) homeWins++;
  }
  assert.ok(homeWins / TRIALS > 0.7, 'a 15-point rating edge plus home court should win clearly more than 70% of the time, got ' + (homeWins / TRIALS));
  console.log('checkScoreSimulation: OK');
}

checkScoreSimulation();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add simEngineBoxScore.js scripts/validate-sim.js
git commit -m "feat: team rating computation and score generation"
```

---

### Task 7: `simEngineBoxScore.js` — box score distribution

**Files:**
- Modify: `simEngineBoxScore.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `computeTeamRating`, `simulateScore` (own file, Task 6).
- Produces: `distributeInt(total, weights)`, `simulateGame(homeTeamId, awayTeamId, rng)` — the latter is this engine's implementation of the shared `simEngine.js` contract, registered via `registerEngine('boxscore', ...)`. Consumed by Task 9 (`simulateDate`).

- [ ] **Step 1: Add the distribution helper and full `simulateGame` to `simEngineBoxScore.js`**

Add above the `module.exports` block:

```js
// Largest-remainder distribution: splits `total` across `weights` proportionally,
// as integers that sum to exactly `total` (never over/under by rounding drift).
// Reused for points, rebounds, assists, steals, blocks, and minutes.
function distributeInt(total, weights) {
  const sumW = weights.reduce(function (a, b) { return a + b; }, 0);
  if (sumW <= 0) {
    // No positive weights (shouldn't happen with real rosters) — split evenly.
    const even = weights.map(function () { return Math.floor(total / weights.length); });
    let leftover = total - even.reduce(function (a, b) { return a + b; }, 0);
    for (let i = 0; leftover > 0; i = (i + 1) % even.length, leftover--) even[i]++;
    return even;
  }
  const raw = weights.map(function (w) { return (total * w) / sumW; });
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce(function (a, b) { return a + b; }, 0);
  const order = raw.map(function (v, i) { return { i: i, frac: v - Math.floor(v) }; })
    .sort(function (a, b) { return b.frac - a.frac; });
  const result = floors.slice();
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].i] += 1;
  }
  return result;
}

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

// Splits a player's points into approximate FG/3PT/FT makes+attempts, weighted by
// their shooting attributes. This is a flavor-stat approximation, not a precise
// possession-level shot model (that's the possession-by-possession engine, later).
function deriveShootingLine(player, points, rng) {
  if (points === 0) return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
  const a = player.attributes;
  const ftShare = Math.min(0.35, 0.10 + (a.freeThrow - 50) / 300);
  const ftPoints = Math.round(points * Math.max(0, ftShare));
  const threeShare = Math.min(0.6, Math.max(0, (a.threePoint - 50) / 120));
  const remainderAfterFt = points - ftPoints;
  let threeMade = Math.round((remainderAfterFt * threeShare) / 3);
  let threePoints = threeMade * 3;
  if (threePoints > remainderAfterFt) { threeMade = Math.floor(remainderAfterFt / 3); threePoints = threeMade * 3; }
  const twoPointRemainder = remainderAfterFt - threePoints;
  const twoMade = Math.round(twoPointRemainder / 2);

  const twoPct = Math.max(0.30, Math.min(0.65, ((a.insideScoring + a.midRange) / 2) / 150));
  const threePct = Math.max(0.20, Math.min(0.50, a.threePoint / 180));
  const ftPct = Math.max(0.55, Math.min(0.95, a.freeThrow / 105));

  const twoAttempts = twoMade > 0 ? Math.max(twoMade, Math.round(twoMade / twoPct)) : (rng() < 0.15 ? 1 : 0);
  const threeAttempts = threeMade > 0 ? Math.max(threeMade, Math.round(threeMade / threePct)) : (rng() < 0.1 ? 1 : 0);
  const ftAttempts = ftPoints > 0 ? Math.max(Math.round(ftPoints / 1), Math.round(ftPoints / ftPct)) : 0;

  return {
    fgm: twoMade + threeMade,
    fga: twoAttempts + threeAttempts,
    tpm: threeMade,
    tpa: threeAttempts,
    ftm: ftPoints,
    fta: ftAttempts
  };
}

function simulateTeamBoxScore(teamId, teamScore, rng) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const minutes = distributeInt(240, roster.map(minutesWeight));
  const points = distributeInt(teamScore, roster.map(scoringWeight));
  const rebounds = distributeInt(Math.round(teamScore * 0.42), roster.map(reboundWeight)); // ~42 total rebounds/team is a realistic NBA average
  const assists = distributeInt(Math.round(teamScore * 0.22), roster.map(assistWeight));
  const steals = distributeInt(7, roster.map(stealWeight));
  const blocks = distributeInt(5, roster.map(blockWeight));

  const boxScore = {};
  roster.forEach(function (p, i) {
    const shooting = deriveShootingLine(p, points[i], rng);
    boxScore[p.id] = {
      minutes: minutes[i],
      points: points[i],
      rebounds: rebounds[i],
      assists: assists[i],
      steals: steals[i],
      blocks: blocks[i],
      fgm: shooting.fgm,
      fga: shooting.fga,
      tpm: shooting.tpm,
      tpa: shooting.tpa,
      ftm: shooting.ftm,
      fta: shooting.fta
    };
  });
  return boxScore;
}

function simulateGame(homeTeamId, awayTeamId, rng) {
  const homeRating = computeTeamRating(homeTeamId);
  const awayRating = computeTeamRating(awayTeamId);
  const score = simulateScore(homeRating, awayRating, rng);
  const homeBox = simulateTeamBoxScore(homeTeamId, score.homeScore, rng);
  const awayBox = simulateTeamBoxScore(awayTeamId, score.awayScore, rng);
  return {
    homeScore: score.homeScore,
    awayScore: score.awayScore,
    boxScore: Object.assign({}, homeBox, awayBox)
  };
}

_ENGINE_DATA.simEngine.registerEngine('boxscore', { simulateGame: simulateGame });
```

- [ ] **Step 2: Update the `module.exports` block**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeTeamRating: computeTeamRating,
    simulateScore: simulateScore,
    distributeInt: distributeInt,
    simulateGame: simulateGame
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

```js
function checkDistributeInt() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const result = engineModule.distributeInt(100, [1, 2, 3, 4]);
  assert.strictEqual(result.reduce(function (a, b) { return a + b; }, 0), 100);
  assert.strictEqual(result.length, 4);
  result.forEach(function (v) { assert.ok(v >= 0); });
  console.log('checkDistributeInt: OK');
}

function checkBoxScoreGeneration() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(7);
  const result = engineModule.simulateGame('BOS', 'LAL', rng);

  assert.ok(result.homeScore > 0 && result.awayScore > 0);

  const homeRoster = new Set(require(path.join(__dirname, '..', 'league.js')).getTeamRoster('BOS').map(function (p) { return p.id; }));
  let homePointsSum = 0;
  let homeMinutesSum = 0;
  Object.keys(result.boxScore).forEach(function (playerId) {
    if (homeRoster.has(playerId)) {
      homePointsSum += result.boxScore[playerId].points;
      homeMinutesSum += result.boxScore[playerId].minutes;
      assert.ok(result.boxScore[playerId].points >= 0);
      assert.ok(result.boxScore[playerId].fga >= result.boxScore[playerId].fgm);
      assert.ok(result.boxScore[playerId].tpa >= result.boxScore[playerId].tpm);
      assert.ok(result.boxScore[playerId].fta >= result.boxScore[playerId].ftm);
    }
  });
  assert.strictEqual(homePointsSum, result.homeScore, 'home box score points must sum to home team score');
  assert.strictEqual(homeMinutesSum, 240, 'home team minutes must sum to 240');

  console.log('checkBoxScoreGeneration: OK');
}

checkDistributeInt();
checkBoxScoreGeneration();
```

- [ ] **Step 4: Run it, then commit**

Run: `node scripts/validate-sim.js` — all checks including `checkDistributeInt: OK` and `checkBoxScoreGeneration: OK` should pass.

```bash
cd "C:\Users\cory\Desktop\nba"
git add simEngineBoxScore.js scripts/validate-sim.js
git commit -m "feat: box score distribution across roster, registered as the boxscore engine"
```

---

### Task 8: `fatigue.js`

**Files:**
- Create: `fatigue.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getTeamRoster` (from `league.js`).
- Produces: `applyFatigueForGame(teamId, minutesByPlayerId, isBackToBack)`, `decayFatigueForRest(teamId, restDays)` — consumed by Task 9 (`simulateDate`).

- [ ] **Step 1: Write `fatigue.js`**

```js
var _FATIGUE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js') }
  : { league: { getTeamRoster: getTeamRoster } };

function applyFatigueForGame(teamId, minutesByPlayerId, isBackToBack) {
  _FATIGUE_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    const minutes = minutesByPlayerId[p.id] || 0;
    const gain = minutes * 0.3 + (isBackToBack ? 8 : 0);
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

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

```js
function checkFatigue() {
  const fatigueModule = require(path.join(__dirname, '..', 'fatigue.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const roster = leagueModule.getTeamRoster('BOS');
  const starter = roster[0];
  starter.status.fatigue = 0;

  fatigueModule.applyFatigueForGame('BOS', (function () { const m = {}; roster.forEach(function (p) { m[p.id] = 30; }); return m; })(), false);
  assert.ok(starter.status.fatigue > 0, 'fatigue should rise after playing minutes');

  const before = starter.status.fatigue;
  fatigueModule.decayFatigueForRest('BOS', 2);
  assert.ok(starter.status.fatigue < before, 'fatigue should fall after rest days');

  starter.status.fatigue = 0; // reset so later tasks' tests aren't affected by this one's side effects
  console.log('checkFatigue: OK');
}

checkFatigue();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add fatigue.js scripts/validate-sim.js
git commit -m "feat: fatigue gain from minutes/back-to-backs, decay from rest"
```

---

### Task 9: `injuries.js`

**Files:**
- Create: `injuries.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getTeamRoster` (from `league.js`).
- Produces: `INJURY_SEVERITIES`, `rollInjury(player, rng)`, `decrementInjuriesForTeamGame(teamId)` — consumed by Task 10 (`simulateDate`).

- [ ] **Step 1: Write `injuries.js`**

```js
var _INJURY_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js') }
  : { league: { getTeamRoster: getTeamRoster } };

const INJURY_SEVERITIES = [
  { name: 'Day-to-Day', gamesOut: 1 },
  { name: 'Two Weeks', gamesOut: 6 },
  { name: 'One Month', gamesOut: 13 },
  { name: 'Season Ending', gamesOut: 999 }
];

// Flat base rate, scaled up by current fatigue (no hidden-trait modifiers —
// those don't exist until Phase 5).
function rollInjury(player, rng) {
  if (player.status.injury) return;
  const baseChance = 0.003;
  const fatigueMultiplier = 1 + player.status.fatigue / 100;
  if (rng() < baseChance * fatigueMultiplier) {
    const roll = rng();
    let severity;
    if (roll < 0.5) severity = INJURY_SEVERITIES[0];
    else if (roll < 0.8) severity = INJURY_SEVERITIES[1];
    else if (roll < 0.95) severity = INJURY_SEVERITIES[2];
    else severity = INJURY_SEVERITIES[3];
    player.status.injury = { severity: severity.name, gamesRemaining: severity.gamesOut };
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

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

```js
function checkInjuries() {
  const injuriesModule = require(path.join(__dirname, '..', 'injuries.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const roster = leagueModule.getTeamRoster('BOS');
  const player = roster[0];
  player.status.injury = null;
  player.status.fatigue = 0;

  const rng = makeRng(123);
  let injuredCount = 0;
  const TRIALS = 2000;
  for (let i = 0; i < TRIALS; i++) {
    player.status.injury = null;
    injuriesModule.rollInjury(player, rng);
    if (player.status.injury) injuredCount++;
  }
  const rate = injuredCount / TRIALS;
  assert.ok(rate > 0.001 && rate < 0.02, 'injury rate should be low but nonzero, got ' + rate);

  player.status.injury = { severity: 'Two Weeks', gamesRemaining: 2 };
  injuriesModule.decrementInjuriesForTeamGame('BOS');
  assert.strictEqual(player.status.injury.gamesRemaining, 1);
  injuriesModule.decrementInjuriesForTeamGame('BOS');
  assert.strictEqual(player.status.injury, null, 'injury should clear once gamesRemaining hits 0');

  console.log('checkInjuries: OK');
}

checkInjuries();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add injuries.js scripts/validate-sim.js
git commit -m "feat: random injury rolls with severity tiers and recovery countdown"
```

---

### Task 10: Standings + season stats accumulation (`league.js`)

**Files:**
- Modify: `league.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getTeamById` (from `teams.js`), `getPlayerById` (own file, Task 1).
- Produces: `recordGameResult(game)`, `accumulateSeasonStats(playerId, statLine)`, `getPlayerAverages(player)` — consumed by Task 11 (`simulateDate`) and by `ui/roster.js` (Task 20).

- [ ] **Step 1: Add to `league.js`**

Update the `_LEAGUE_DATA` line and add the new functions above `module.exports`:

```js
var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js'), teams: require('./teams.js') }
  : { players: { PLAYERS_2026: PLAYERS_2026 }, teams: { getTeamById: getTeamById } };
```

```js
const SEASON_STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'minutes'];

function recordGameResult(game) {
  const homeTeam = _LEAGUE_DATA.teams.getTeamById(game.homeTeamId);
  const awayTeam = _LEAGUE_DATA.teams.getTeamById(game.awayTeamId);
  homeTeam.record.pointsFor = (homeTeam.record.pointsFor || 0) + game.homeScore;
  homeTeam.record.pointsAgainst = (homeTeam.record.pointsAgainst || 0) + game.awayScore;
  awayTeam.record.pointsFor = (awayTeam.record.pointsFor || 0) + game.awayScore;
  awayTeam.record.pointsAgainst = (awayTeam.record.pointsAgainst || 0) + game.homeScore;
  if (game.homeScore > game.awayScore) {
    homeTeam.record.wins += 1;
    awayTeam.record.losses += 1;
  } else {
    awayTeam.record.wins += 1;
    homeTeam.record.losses += 1;
  }
}

function accumulateSeasonStats(playerId, statLine) {
  const player = getPlayerById(playerId);
  if (!player.seasonStats) {
    player.seasonStats = { gamesPlayed: 0 };
    SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] = 0; });
  }
  player.seasonStats.gamesPlayed += 1;
  SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] += statLine[k] || 0; });
}

function getPlayerAverages(player) {
  const s = player.seasonStats;
  if (!s || s.gamesPlayed === 0) {
    return { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };
  }
  return {
    ppg: s.points / s.gamesPlayed,
    rpg: s.rebounds / s.gamesPlayed,
    apg: s.assists / s.gamesPlayed,
    spg: s.steals / s.gamesPlayed,
    bpg: s.blocks / s.gamesPlayed,
    fgPct: s.fga > 0 ? s.fgm / s.fga : 0,
    tpPct: s.tpa > 0 ? s.tpm / s.tpa : 0,
    ftPct: s.fta > 0 ? s.ftm / s.fta : 0,
    mpg: s.minutes / s.gamesPlayed
  };
}
```

- [ ] **Step 2: Update the `module.exports` block in `league.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

```js
function checkStandingsAndStats() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const team = teamsModule.getTeamById('BOS');
  const oppTeam = teamsModule.getTeamById('LAL');
  team.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
  oppTeam.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };

  leagueModule.recordGameResult({ homeTeamId: 'BOS', awayTeamId: 'LAL', homeScore: 110, awayScore: 100 });
  assert.strictEqual(team.record.wins, 1);
  assert.strictEqual(oppTeam.record.losses, 1);
  assert.strictEqual(team.record.pointsFor, 110);
  assert.strictEqual(oppTeam.record.pointsAgainst, 110);

  const player = leagueModule.getTeamRoster('BOS')[0];
  player.seasonStats = undefined;
  leagueModule.accumulateSeasonStats(player.id, { points: 20, rebounds: 5, assists: 3, steals: 1, blocks: 0, fgm: 8, fga: 15, tpm: 2, tpa: 5, ftm: 2, fta: 2, minutes: 32 });
  leagueModule.accumulateSeasonStats(player.id, { points: 30, rebounds: 7, assists: 5, steals: 2, blocks: 1, fgm: 11, fga: 20, tpm: 3, tpa: 6, ftm: 5, fta: 6, minutes: 36 });
  const avg = leagueModule.getPlayerAverages(player);
  assert.strictEqual(player.seasonStats.gamesPlayed, 2);
  assert.strictEqual(avg.ppg, 25);
  assert.strictEqual(player.seasonStats.points, 50);

  console.log('checkStandingsAndStats: OK');
}

checkStandingsAndStats();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add league.js scripts/validate-sim.js
git commit -m "feat: standings updates and season stat accumulation"
```

---

### Task 11: `simulateDate` orchestrator (`league.js`)

**Files:**
- Modify: `league.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getActiveEngine` (from `simEngine.js`), `applyFatigueForGame`/`decayFatigueForRest` (from `fatigue.js`), `rollInjury`/`decrementInjuriesForTeamGame` (from `injuries.js`), `recordGameResult`/`accumulateSeasonStats` (own file, Task 10).
- Produces: `simulateDate(season, dayIndex, settings, rng)` — simulates every game scheduled for `dayIndex` in `season.games`, records results/stats/fatigue/injuries for every team (playing or resting that day), and marks those games `played = true`. Consumed by Task 12 (sim controls).

`season` is `{ games: [...], startDayIndex: 0 }` where `games` entries look like `{ id, homeTeamId, awayTeamId, day, played, homeScore, awayScore, boxScore, isPlayoff, seriesId }` (this task assumes `season.games` already exists in this shape — Task 14 is what populates it from `schedule.js`'s output).

- [ ] **Step 1: Add to `league.js`**

Update `_LEAGUE_DATA` again and add the orchestrator:

```js
var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? {
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      simEngine: require('./simEngine.js'),
      fatigue: require('./fatigue.js'),
      injuries: require('./injuries.js')
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { getTeamById: getTeamById, TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      fatigue: { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest },
      injuries: { rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame }
    };
```

```js
function simulateDate(season, dayIndex, settings, rng) {
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};

  todaysGames.forEach(function (game) {
    const engine = _LEAGUE_DATA.simEngine.getActiveEngine(settings);
    const result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);

    game.played = true;
    game.homeScore = result.homeScore;
    game.awayScore = result.awayScore;
    game.boxScore = result.boxScore;

    recordGameResult(game);

    if (result.boxScore) {
      Object.keys(result.boxScore).forEach(function (playerId) {
        accumulateSeasonStats(playerId, result.boxScore[playerId]);
      });
      const minutesByPlayerId = {};
      Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
      const isBackToBackHome = season.games.some(function (g) { return g.played && (g.homeTeamId === game.homeTeamId || g.awayTeamId === game.homeTeamId) && g.day === dayIndex - 1; });
      const isBackToBackAway = season.games.some(function (g) { return g.played && (g.homeTeamId === game.awayTeamId || g.awayTeamId === game.awayTeamId) && g.day === dayIndex - 1; });
      _LEAGUE_DATA.fatigue.applyFatigueForGame(game.homeTeamId, minutesByPlayerId, isBackToBackHome);
      _LEAGUE_DATA.fatigue.applyFatigueForGame(game.awayTeamId, minutesByPlayerId, isBackToBackAway);
    }

    [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
      _LEAGUE_DATA.injuries.decrementInjuriesForTeamGame(teamId);
      getTeamRoster(teamId).forEach(function (p) { _LEAGUE_DATA.injuries.rollInjury(p, rng); });
      playingTeamIds[teamId] = true;
    });
  });

  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      _LEAGUE_DATA.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  return todaysGames;
}
```

- [ ] **Step 2: Update the `module.exports` block in `league.js`**

Add `simulateDate: simulateDate` to the exported object.

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

```js
function checkSimulateDate() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const simEngineModule = require(path.join(__dirname, '..', 'simEngine.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers the boxscore engine as a side effect

  const season = {
    games: [
      { id: 0, homeTeamId: 'BOS', awayTeamId: 'LAL', day: 0, played: false },
      { id: 1, homeTeamId: 'MIA', awayTeamId: 'DEN', day: 0, played: false },
      { id: 2, homeTeamId: 'CHI', awayTeamId: 'DAL', day: 5, played: false }
    ]
  };
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(55);

  const simulatedToday = leagueModule.simulateDate(season, 0, settings, rng);
  assert.strictEqual(simulatedToday.length, 2, 'should simulate both games scheduled on day 0');
  assert.strictEqual(season.games[0].played, true);
  assert.strictEqual(season.games[1].played, true);
  assert.strictEqual(season.games[2].played, false, 'day 5 game should not simulate on day 0');
  assert.ok(typeof season.games[0].homeScore === 'number');

  const simulatedAgain = leagueModule.simulateDate(season, 0, settings, rng);
  assert.strictEqual(simulatedAgain.length, 0, 'already-played games should not simulate again');

  console.log('checkSimulateDate: OK');
}

checkSimulateDate();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add league.js scripts/validate-sim.js
git commit -m "feat: simulateDate orchestrator wiring engine, fatigue, injuries, and stats together"
```

---

### Task 12: Regular-season sim controls (`league.js`)

**Files:**
- Modify: `league.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `simulateDate` (own file, Task 11).
- Produces: `simulateNextDay(season, currentDay, settings, rng)` → returns the new current day; `simulateThroughDate(season, currentDay, targetDay, settings, rng)` → simulates every day from `currentDay` to `targetDay` inclusive, returns the new current day; `getNextGameDay(season, teamId, afterDay)` → returns the day index of a team's next unplayed game, or `null`. Consumed by `ui/simControls.js` (Task 17).

- [ ] **Step 1: Add to `league.js`**

```js
function getNextGameDay(season, teamId, afterDay) {
  const upcoming = season.games
    .filter(function (g) { return !g.played && g.day > afterDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; });
  return upcoming.length > 0 ? upcoming[0].day : null;
}

function simulateNextDay(season, currentDay, settings, rng) {
  const nextDay = currentDay + 1;
  simulateDate(season, nextDay, settings, rng);
  return nextDay;
}

function simulateThroughDate(season, currentDay, targetDay, settings, rng) {
  let day = currentDay;
  while (day < targetDay) {
    day += 1;
    simulateDate(season, day, settings, rng);
  }
  return day;
}
```

- [ ] **Step 2: Update the `module.exports` block in `league.js`**

Add `getNextGameDay`, `simulateNextDay`, `simulateThroughDate`.

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

```js
function checkSimControls() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const season = {
    games: [
      { id: 0, homeTeamId: 'BOS', awayTeamId: 'LAL', day: 0, played: false },
      { id: 1, homeTeamId: 'BOS', awayTeamId: 'MIA', day: 3, played: false },
      { id: 2, homeTeamId: 'DEN', awayTeamId: 'PHX', day: 1, played: false }
    ]
  };
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(11);

  const nextGameDay = leagueModule.getNextGameDay(season, 'BOS', -1);
  assert.strictEqual(nextGameDay, 0);

  let currentDay = leagueModule.simulateNextDay(season, -1, settings, rng);
  assert.strictEqual(currentDay, 0);
  assert.strictEqual(season.games[0].played, true);

  const nextBosGame = leagueModule.getNextGameDay(season, 'BOS', currentDay);
  assert.strictEqual(nextBosGame, 3);

  currentDay = leagueModule.simulateThroughDate(season, currentDay, nextBosGame, settings, rng);
  assert.strictEqual(currentDay, 3);
  assert.strictEqual(season.games[1].played, true, 'BOS game on day 3 should be simulated');
  assert.strictEqual(season.games[2].played, true, 'DEN game on day 1 should also be simulated while passing through');

  console.log('checkSimControls: OK');
}

checkSimControls();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add league.js scripts/validate-sim.js
git commit -m "feat: regular-season sim-advance controls (next day, through a target date)"
```

---

### Task 13: `playoffs.js` — seeding + bracket generation

**Files:**
- Create: `playoffs.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `TEAMS`, `CONFERENCES` (from `data.js`/`teams.js`).
- Produces: `getPlayoffSeeds(conference)`, `generateBracket()` → returns `{ first: [series...], semis: [], confFinals: [], finals: [] }` with only `first` populated (4 series per conference, standard 1v8/4v5/3v6/2v7 pairing) — `series` objects consumed by Task 14.

- [ ] **Step 1: Write `playoffs.js`**

```js
var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js') }
  : { data: { CONFERENCES: CONFERENCES }, teams: { TEAMS: TEAMS } };

function getPlayoffSeeds(conference) {
  const confTeams = _PLAYOFF_DATA.teams.TEAMS.filter(function (t) { return t.conference === conference; });
  return confTeams.slice().sort(function (a, b) {
    if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
    const diffA = (a.record.pointsFor || 0) - (a.record.pointsAgainst || 0);
    const diffB = (b.record.pointsFor || 0) - (b.record.pointsAgainst || 0);
    if (diffB !== diffA) return diffB - diffA;
    return a.id.localeCompare(b.id);
  }).slice(0, 8);
}

let _seriesIdCounter = 0;
function createSeries(higherSeedTeamId, lowerSeedTeamId) {
  _seriesIdCounter += 1;
  return {
    id: 'series-' + _seriesIdCounter,
    higherSeed: higherSeedTeamId,
    lowerSeed: lowerSeedTeamId,
    winsHigher: 0,
    winsLower: 0,
    winner: null,
    complete: false
  };
}

// Standard bracket pairing by seed index (0 = 1-seed .. 7 = 8-seed):
// Round 1: 0v7, 3v4, 2v5, 1v6 — keeps the 1 and 2 seeds apart until the conference finals.
const ROUND1_SEED_PAIRS = [[0, 7], [3, 4], [2, 5], [1, 6]];

function generateBracket() {
  const bracket = { first: [], semis: [], confFinals: [], finals: [] };
  _PLAYOFF_DATA.data.CONFERENCES.forEach(function (conf) {
    const seeds = getPlayoffSeeds(conf);
    ROUND1_SEED_PAIRS.forEach(function (pair) {
      bracket.first.push(createSeries(seeds[pair[0]].id, seeds[pair[1]].id));
    });
  });
  return bracket;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getPlayoffSeeds: getPlayoffSeeds, createSeries: createSeries, generateBracket: generateBracket, ROUND1_SEED_PAIRS: ROUND1_SEED_PAIRS };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-sim.js`**

```js
function checkPlayoffSeeding() {
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  teamsModule.TEAMS.forEach(function (t) { t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  // Deterministic standings for this test: rank Eastern teams by array order.
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record.wins = eastern.length - i; });

  const seeds = playoffsModule.getPlayoffSeeds('Eastern');
  assert.strictEqual(seeds.length, 8);
  assert.strictEqual(seeds[0].id, eastern[0].id, 'highest win total should be the 1-seed');

  const bracket = playoffsModule.generateBracket();
  assert.strictEqual(bracket.first.length, 8, '4 series per conference x 2 conferences');
  assert.strictEqual(bracket.semis.length, 0, 'later rounds do not exist until earlier rounds complete');
  bracket.first.forEach(function (series) {
    assert.strictEqual(series.winsHigher, 0);
    assert.strictEqual(series.complete, false);
  });

  console.log('checkPlayoffSeeding: OK');
}

checkPlayoffSeeding();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add playoffs.js scripts/validate-sim.js
git commit -m "feat: playoff seeding and first-round bracket generation"
```

---

### Task 14: `playoffs.js` — series/game simulation + round advancement

**Files:**
- Modify: `playoffs.js`
- Modify: `scripts/validate-sim.js`

**Interfaces:**
- Consumes: `getActiveEngine` (from `simEngine.js`), `recordGameResult`/`accumulateSeasonStats` (from `league.js`), `generateBracket`/`createSeries` (own file, Task 13).
- Produces: `simulateNextPlayoffGame(bracket, settings, rng)` — simulates the next unplayed game in the current active round, advances the series/round state, returns the game result (or `null` if the whole bracket is already complete). Consumed by Task 15 (playoff sim controls) and `ui/simControls.js` (Task 17).

- [ ] **Step 1: Add to `playoffs.js`**

Update `_PLAYOFF_DATA` and add below `generateBracket`:

```js
var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), league: require('./league.js') }
  : {
      data: { CONFERENCES: CONFERENCES },
      teams: { TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      league: { recordGameResult: recordGameResult, accumulateSeasonStats: accumulateSeasonStats }
    };
```

```js
// Higher seed hosts games 1, 2, 5, 7; lower seed hosts games 3, 4, 6 (standard 2-2-1-1-1 format).
const HOME_PATTERN = ['higher', 'higher', 'lower', 'lower', 'higher', 'lower', 'higher'];

function isSeriesComplete(series) {
  return series.winsHigher === 4 || series.winsLower === 4;
}

function simulateSeriesGame(series, settings, rng) {
  const gameNumber = series.winsHigher + series.winsLower; // 0-indexed into HOME_PATTERN
  const homeIsHigher = HOME_PATTERN[gameNumber] === 'higher';
  const homeTeamId = homeIsHigher ? series.higherSeed : series.lowerSeed;
  const awayTeamId = homeIsHigher ? series.lowerSeed : series.higherSeed;

  const engine = _PLAYOFF_DATA.simEngine.getActiveEngine(settings);
  const result = engine.simulateGame(homeTeamId, awayTeamId, rng);
  const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, homeScore: result.homeScore, awayScore: result.awayScore, boxScore: result.boxScore, isPlayoff: true, seriesId: series.id };

  _PLAYOFF_DATA.league.recordGameResult(game);
  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      _PLAYOFF_DATA.league.accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
  }

  const homeWon = result.homeScore > result.awayScore;
  const higherWonThisGame = homeWon === homeIsHigher;
  if (higherWonThisGame) series.winsHigher += 1; else series.winsLower += 1;

  if (isSeriesComplete(series)) {
    series.complete = true;
    series.winner = series.winsHigher === 4 ? series.higherSeed : series.lowerSeed;
  }

  return game;
}

function advanceBracketIfRoundComplete(bracket) {
  function allComplete(round) { return round.length > 0 && round.every(function (s) { return s.complete; }); }

  if (bracket.semis.length === 0 && allComplete(bracket.first)) {
    // Winners of series 0&1 face each other, winners of series 2&3 face each other,
    // within each conference (bracket.first is [E0,E1,E2,E3, W0,W1,W2,W3]).
    for (let confStart = 0; confStart < 8; confStart += 4) {
      bracket.semis.push(createSeries(bracket.first[confStart].winner, bracket.first[confStart + 1].winner));
      bracket.semis.push(createSeries(bracket.first[confStart + 2].winner, bracket.first[confStart + 3].winner));
    }
  } else if (bracket.confFinals.length === 0 && allComplete(bracket.semis)) {
    for (let confStart = 0; confStart < 4; confStart += 2) {
      bracket.confFinals.push(createSeries(bracket.semis[confStart].winner, bracket.semis[confStart + 1].winner));
    }
  } else if (bracket.finals.length === 0 && allComplete(bracket.confFinals)) {
    bracket.finals.push(createSeries(bracket.confFinals[0].winner, bracket.confFinals[1].winner));
  }
}

function getCurrentRoundSeries(bracket) {
  if (bracket.finals.length > 0 && !bracket.finals[0].complete) return bracket.finals;
  if (bracket.finals.length > 0 && bracket.finals[0].complete) return null; // whole bracket done
  if (bracket.confFinals.length > 0 && !bracket.confFinals.every(function (s) { return s.complete; })) return bracket.confFinals;
  if (bracket.semis.length > 0 && !bracket.semis.every(function (s) { return s.complete; })) return bracket.semis;
  return bracket.first;
}

function simulateNextPlayoffGame(bracket, settings, rng) {
  const round = getCurrentRoundSeries(bracket);
  if (!round) return null; // champion already crowned

  const activeSeries = round.find(function (s) { return !s.complete; });
  if (!activeSeries) {
    advanceBracketIfRoundComplete(bracket);
    return simulateNextPlayoffGame(bracket, settings, rng);
  }

  const game = simulateSeriesGame(activeSeries, settings, rng);
  advanceBracketIfRoundComplete(bracket);
  return game;
}
```

- [ ] **Step 2: Update the `module.exports` block in `playoffs.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPlayoffSeeds: getPlayoffSeeds,
    createSeries: createSeries,
    generateBracket: generateBracket,
    ROUND1_SEED_PAIRS: ROUND1_SEED_PAIRS,
    simulateNextPlayoffGame: simulateNextPlayoffGame,
    getCurrentRoundSeries: getCurrentRoundSeries
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-sim.js`**

```js
function checkPlayoffProgression() {
  require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers boxscore engine
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: eastern.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: western.length - i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(200);

  let gamesSimulated = 0;
  let game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  while (game !== null && gamesSimulated < 500) {
    gamesSimulated += 1;
    game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  }

  // A full bracket is 15 series total (8 in round 1, 4 in semis, 2 in conf finals, 1 in
  // the finals); each series needs at least 4 games (a sweep), so the true minimum is
  // 15 * 4 = 60 games for the whole bracket to complete.
  assert.ok(gamesSimulated >= 60, 'a full bracket needs at least 60 games (15 series x 4-game minimum), got ' + gamesSimulated);
  assert.strictEqual(bracket.first.every(function (s) { return s.complete; }), true);
  assert.strictEqual(bracket.semis.length, 4);
  assert.strictEqual(bracket.confFinals.length, 2);
  assert.strictEqual(bracket.finals.length, 1);
  assert.ok(bracket.finals[0].complete, 'finals series should be complete once the loop exits');
  assert.ok(bracket.finals[0].winner, 'a champion should be crowned');

  console.log('checkPlayoffProgression: OK (champion: ' + bracket.finals[0].winner + ', ' + gamesSimulated + ' games)');
}

checkPlayoffProgression();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add playoffs.js scripts/validate-sim.js
git commit -m "feat: playoff series simulation and automatic round advancement to a champion"
```

---

### Task 15: Season initialization wired into `script.js`

**Files:**
- Modify: `script.js`

**Interfaces:**
- Consumes: `generateSeasonGames` (from `schedule.js`), `makeRng` (from `rng.js`), `generateBracket` (from `playoffs.js`).
- Produces: `GameState.season` (`{ games, currentDay }`), `GameState.settings` (`{ simEngine, simSpeed }`), `GameState.playoffBracket` (`null` until the regular season completes) — consumed by every `ui/*.js` task from here on.

- [ ] **Step 1: Update `GameState` and `selectTeam` in `script.js`**

```js
const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
  season: null,
  playoffBracket: null,
  settings: { simEngine: 'boxscore', simSpeed: 'normal' }
};

function initSeason() {
  const rng = makeRng(Date.now());
  const games = generateSeasonGames(rng, TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  GameState.season = { games: games, currentDay: -1 };
}
```

In `selectTeam`, call `initSeason()` right after setting `GameState.userTeamId`:

```js
function selectTeam(teamId) {
  GameState.userTeamId = teamId;
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}
```

- [ ] **Step 2: Manual verification**

Open `index.html`, select a team, open the browser console, and run `GameState.season.games.length` — expect `1230`. Confirm no console errors on team selection.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add script.js
git commit -m "feat: initialize a real 82-game season on team selection"
```

---

### Task 16: `ui/schedule.js` — schedule/results view

**Files:**
- Create: `ui/schedule.js`

**Interfaces:**
- Consumes: `GameState.season`, `getTeamById` (from `teams.js`), `getPlayerById` (from `league.js`).
- Produces: `renderSchedule(container, teamId)` — registered into `script.js`'s `BUILT_VIEWS.schedule` in Task 21.

- [ ] **Step 1: Write `ui/schedule.js`**

```js
function renderSchedule(container, teamId) {
  const games = GameState.season.games
    .filter(function (g) { return g.homeTeamId === teamId || g.awayTeamId === teamId; })
    .slice()
    .sort(function (a, b) { return a.day - b.day; });

  let html = '<table><thead><tr><th>Day</th><th>Opponent</th><th>Result</th></tr></thead><tbody>';
  games.forEach(function (g) {
    const isHome = g.homeTeamId === teamId;
    const oppId = isHome ? g.awayTeamId : g.homeTeamId;
    const opp = getTeamById(oppId);
    const oppLabel = (isHome ? 'vs ' : '@ ') + opp.name;
    let resultLabel = 'Not yet played';
    if (g.played) {
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      resultLabel = (teamScore > oppScore ? 'W ' : 'L ') + teamScore + '-' + oppScore;
    }
    html += '<tr data-game-id="' + g.id + '"><td>' + g.day + '</td><td>' + oppLabel + '</td><td>' + resultLabel + '</td></tr>';
  });
  html += '</tbody></table><div id="box-score-detail"></div>';
  container.innerHTML = html;

  container.querySelectorAll('tr[data-game-id]').forEach(function (row) {
    row.addEventListener('click', function () {
      const gameId = Number(row.getAttribute('data-game-id'));
      const game = games.find(function (g) { return g.id === gameId; });
      renderBoxScoreDetail(document.getElementById('box-score-detail'), game);
    });
  });
}

function renderBoxScoreDetail(container, game) {
  if (!game.played) {
    container.innerHTML = '<p>This game hasn\'t been played yet.</p>';
    return;
  }
  let html = '<h3>' + getTeamById(game.homeTeamId).name + ' ' + game.homeScore + ' - ' + game.awayScore + ' ' + getTeamById(game.awayTeamId).name + '</h3>';
  html += '<table><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th></tr></thead><tbody>';
  Object.keys(game.boxScore).forEach(function (playerId) {
    const p = getPlayerById(playerId);
    const s = game.boxScore[playerId];
    html += '<tr><td>' + p.name + '</td><td>' + s.minutes + '</td><td>' + s.points + '</td><td>' + s.rebounds + '</td><td>' + s.assists + '</td><td>' + s.steals + '</td><td>' + s.blocks + '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSchedule: renderSchedule, renderBoxScoreDetail: renderBoxScoreDetail };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/schedule.js
git commit -m "feat: schedule/results view with box score detail"
```

---

### Task 17: `ui/simControls.js` — Next Game/Day/Sim-to-end + speed

**Files:**
- Create: `ui/simControls.js`

**Interfaces:**
- Consumes: `GameState`, `getNextGameDay`/`simulateNextDay`/`simulateThroughDate` (from `league.js`), `generateBracket`/`simulateNextPlayoffGame` (from `playoffs.js`), `renderView` (from `script.js`, called after each sim action to refresh whatever's on screen).
- Produces: `renderSimControls(container)`, `SIM_SPEED_DELAYS_MS` — registered as a persistent panel rendered alongside every built view (wired in Task 21).

- [ ] **Step 1: Write `ui/simControls.js`**

```js
const SIM_SPEED_DELAYS_MS = { slow: 500, normal: 200, fast: 50, ultra: 0 };

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isRegularSeasonComplete(season) {
  return season.games.every(function (g) { return g.played; });
}

async function runWithDelay(container, stepFn, stepsToRun) {
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'Simulating...';
  const delayMs = SIM_SPEED_DELAYS_MS[GameState.settings.simSpeed] || SIM_SPEED_DELAYS_MS.normal;

  for (let i = 0; i < stepsToRun; i++) {
    stepFn();
    if (delayMs > 0) await delay(delayMs);
  }

  if (statusEl) statusEl.textContent = '';
  renderView(GameState.currentView);
}

async function handleNextGame() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const targetDay = getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay);
    if (targetDay === null) return;
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay, GameState.settings, GameState.rng);
    }, 1);
  } else {
    await runWithDelay(container, function () {
      simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    }, 1);
  }
}

async function handleNextDay() {
  const container = document.getElementById('sim-controls');
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateNextDay(GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng);
  }, 1);
}

async function handleSimToEnd() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng);
    }, 1);
    if (isRegularSeasonComplete(GameState.season)) {
      GameState.playoffBracket = generateBracket();
    }
  } else {
    await runWithDelay(container, function () {
      let result = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      while (result !== null) {
        result = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      }
    }, 1);
  }
}

function renderSimControls(container) {
  const stageLabel = GameState.playoffBracket ? 'Playoffs' : 'Regular Season';
  container.innerHTML =
    '<button id="sim-next-game">Next Game</button>' +
    '<button id="sim-next-day">Next Day</button>' +
    '<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +
    '<select id="sim-speed">' +
      ['slow', 'normal', 'fast', 'ultra'].map(function (s) {
        return '<option value="' + s + '"' + (GameState.settings.simSpeed === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') +
    '</select>' +
    '<span id="sim-status"></span>';

  document.getElementById('sim-next-game').addEventListener('click', handleNextGame);
  document.getElementById('sim-next-day').addEventListener('click', handleNextDay);
  document.getElementById('sim-to-end').addEventListener('click', handleSimToEnd);
  document.getElementById('sim-speed').addEventListener('change', function (e) {
    GameState.settings.simSpeed = e.target.value;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSimControls: renderSimControls, SIM_SPEED_DELAYS_MS: SIM_SPEED_DELAYS_MS };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/simControls.js
git commit -m "feat: sim-advance controls (Next Game/Day/Sim to End) with speed setting"
```

---

### Task 18: `ui/settings.js` — sim engine picker + speed

**Files:**
- Create: `ui/settings.js`

**Interfaces:**
- Consumes: `GameState.settings`, `SIM_ENGINES` (from `simEngine.js`).
- Produces: `renderSettings(container)` — registered into `script.js`'s `BUILT_VIEWS.settings` in Task 21.

- [ ] **Step 1: Write `ui/settings.js`**

```js
const ENGINE_LABELS = {
  boxscore: 'Team Rating + Box Score',
  scoreonly: 'Score Only (coming in a later phase)',
  possession: 'Possession-by-Possession (coming in a later phase)'
};

function renderSettings(container) {
  let html = '<h2>Settings</h2><h3>Simulation Engine</h3>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label style="display:block;"><input type="radio" name="sim-engine" value="' + engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });
  container.innerHTML = html;

  container.querySelectorAll('input[name="sim-engine"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.simEngine = e.target.value;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSettings: renderSettings, ENGINE_LABELS: ENGINE_LABELS };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/settings.js
git commit -m "feat: settings view with sim engine picker"
```

---

### Task 19: Update `ui/standings.js` — real records + point differential

**Files:**
- Modify: `ui/standings.js`

**Interfaces:**
- Consumes: `TEAMS` (unchanged), now reads `team.record.pointsFor`/`pointsAgainst` (populated since Task 10).
- Produces: same `renderStandings(container)` signature — no callers need to change.

- [ ] **Step 1: Update the table body in `ui/standings.js`**

Replace the `<thead>` row and the per-team row template:

```js
html += '<h3>' + div + '</h3><table><thead><tr><th>Team</th><th>W</th><th>L</th><th>Diff</th></tr></thead><tbody>';
const divTeams = TEAMS.filter(function (t) { return t.conference === conf && t.division === div; })
  .slice()
  .sort(function (a, b) { return b.record.wins - a.record.wins; });
divTeams.forEach(function (t) {
  const diff = (t.record.pointsFor || 0) - (t.record.pointsAgainst || 0);
  const diffLabel = (diff > 0 ? '+' : '') + diff;
  html += '<tr><td>' + t.name + '</td><td>' + t.record.wins + '</td><td>' + t.record.losses + '</td><td>' + diffLabel + '</td></tr>';
});
```

(This replaces the Phase 1 version, which sorted alphabetically and had no Diff column — real records now exist to sort by.)

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/standings.js
git commit -m "feat: standings sorted by real record with point differential"
```

---

### Task 20: Update `ui/dashboard.js` — live record + next game

**Files:**
- Modify: `ui/dashboard.js`

**Interfaces:**
- Consumes: `getNextGameDay` (from `league.js`), `GameState.season`.
- Produces: same `renderDashboard(container, teamId)` signature.

- [ ] **Step 1: Replace the static record line with live data and a next-game line**

The `team.record.wins`/`losses` values are already live (Task 10 updates them in place) — no change needed there. Add a next-game line after the existing chemistry/happiness lines:

```js
const nextDay = GameState.season ? getNextGameDay(GameState.season, teamId, GameState.season.currentDay) : null;
let nextGameLabel = 'No season in progress.';
if (nextDay !== null) {
  const nextGame = GameState.season.games.find(function (g) { return g.day === nextDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); });
  const isHome = nextGame.homeTeamId === teamId;
  const opp = getTeamById(isHome ? nextGame.awayTeamId : nextGame.homeTeamId);
  nextGameLabel = 'Next game: ' + (isHome ? 'vs ' : '@ ') + opp.name + ' (day ' + nextDay + ')';
} else if (GameState.season) {
  nextGameLabel = 'No games remaining.';
}
```

Append `'<p>' + nextGameLabel + '</p>'` to the `container.innerHTML` string.

- [ ] **Step 2: Manual verification**

Select a team, confirm Dashboard shows "Next game: vs/@ <team> (day N)" instead of nothing, and confirm the record line updates to a real W-L after using a sim control (verified fully in Task 22).

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/dashboard.js
git commit -m "feat: dashboard shows live record and next scheduled game"
```

---

### Task 21: Update `ui/roster.js` — season stat columns

**Files:**
- Modify: `ui/roster.js`

**Interfaces:**
- Consumes: `getPlayerAverages` (from `league.js`).
- Produces: same `renderRoster(container, teamId)` signature, with 4 new sortable columns.

- [ ] **Step 1: Extend `ROSTER_COLUMNS` and `rosterCellValue` in `ui/roster.js`**

```js
const ROSTER_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'position', label: 'Pos' },
  { key: 'age', label: 'Age' },
  { key: 'overall', label: 'OVR' },
  { key: 'potential', label: 'POT' },
  { key: 'ppg', label: 'PPG' },
  { key: 'rpg', label: 'RPG' },
  { key: 'apg', label: 'APG' },
  { key: 'fgPct', label: 'FG%' },
  { key: 'salary', label: 'Salary' },
  { key: 'yearsRemaining', label: 'Yrs Left' }
];

function rosterCellValue(player, key) {
  if (key === 'salary') { return player.contract.salary; }
  if (key === 'yearsRemaining') { return player.contract.yearsRemaining; }
  if (['ppg', 'rpg', 'apg', 'fgPct'].indexOf(key) !== -1) { return getPlayerAverages(player)[key]; }
  return player[key];
}
```

- [ ] **Step 2: Update the row-rendering template inside `draw()` in `ui/roster.js`**

```js
roster.forEach(function (p) {
  const avg = getPlayerAverages(p);
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
    '</tr>';
});
```

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/roster.js
git commit -m "feat: roster view shows season averages (PPG/RPG/APG/FG%)"
```

---

### Task 22: Wire everything into `index.html`, `script.js`, `ui/nav.js` — end-to-end verification

**Files:**
- Modify: `index.html`
- Modify: `script.js`
- Modify: `ui/nav.js` (none needed — `NAV_ITEMS` ids already match `schedule`/`settings`; only `BUILT_VIEWS` in `script.js` needs the new entries)

**Interfaces:**
- Consumes: every function from Tasks 1-21.
- Produces: a fully playable Phase 2 game.

- [ ] **Step 1: Update `index.html`'s script tags to the full dependency order**

```html
<script src="data.js"></script>
<script src="teams.js"></script>
<script src="players-2026.js"></script>
<script src="league.js"></script>
<script src="rng.js"></script>
<script src="schedule.js"></script>
<script src="simEngine.js"></script>
<script src="simEngineBoxScore.js"></script>
<script src="fatigue.js"></script>
<script src="injuries.js"></script>
<script src="playoffs.js"></script>
<script src="ui/nav.js"></script>
<script src="ui/teamSelect.js"></script>
<script src="ui/dashboard.js"></script>
<script src="ui/roster.js"></script>
<script src="ui/standings.js"></script>
<script src="ui/schedule.js"></script>
<script src="ui/simControls.js"></script>
<script src="ui/settings.js"></script>
<script src="script.js"></script>
```

Also add a persistent `<div id="sim-controls"></div>` inside `#app-view`, above `#view-content`, so sim controls are visible regardless of which view is active:

```html
<div id="app-view" style="display:none;">
  <div id="nav-bar"></div>
  <div id="sim-controls"></div>
  <div id="view-content"></div>
</div>
```

- [ ] **Step 2: Register the new views and the RNG instance in `script.js`**

Update `BUILT_VIEWS`:

```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings
};
```

Add an RNG instance to `GameState` (used by sim controls) and render sim controls whenever the view changes. In `initSeason`, after `GameState.season = ...`:

```js
GameState.rng = makeRng(Date.now());
```

In `renderView`, after the existing `renderNav(...)` call at the end of the function, add:

```js
if (GameState.season) {
  renderSimControls(document.getElementById('sim-controls'));
}
```

- [ ] **Step 3: Run the full Node validation suite**

Run: `node scripts/validate-sim.js`
Expected: every check listed in Tasks 2-14 (`checkRng`, `checkMatchupCounts`, `checkSeasonGames`, `checkEngineRegistry`, `checkScoreSimulation`, `checkDistributeInt`, `checkBoxScoreGeneration`, `checkFatigue`, `checkInjuries`, `checkStandingsAndStats`, `checkSimulateDate`, `checkSimControls`, `checkPlayoffSeeding`, `checkPlayoffProgression`) prints `OK`, followed by `All sim validations passed`.

Also re-run Phase 1's validator to confirm nothing regressed:

Run: `node scripts/validate-data.js`
Expected: all four Phase 1 checks still pass.

- [ ] **Step 4: Manual browser verification**

Using the `run` skill (or a local static server, as Phase 1's Task 16 did), walk through:
1. Team select → Dashboard: confirm "Next game: ..." line appears and record starts 0-0.
2. Click "Next Game" — confirm the record updates, the sim-controls status briefly shows "Simulating..." then clears, and Dashboard's next-game line advances to a later day.
3. Go to Schedule — confirm played games show a real "W 110-102"-style result and unplayed games show "Not yet played". Click a played game's row — confirm a box score table appears below with real per-player stat lines that look sane (no negative numbers, minutes roughly 0-40).
4. Go to Standings — confirm point differential column appears and teams are sorted by wins.
5. Go to Roster — confirm PPG/RPG/APG/FG% columns show real numbers for players who've played, and 0.0/0.0% for anyone who hasn't yet; click a stat column header to confirm it sorts.
6. Go to Settings — confirm "Team Rating + Box Score" is selected and the other two engines appear disabled with "(coming in a later phase)" labels.
7. Click "Sim to End of Regular Season" — wait for it to finish, confirm every game in Schedule now shows a result, Standings shows full 82-game-equivalent win/loss totals per team (wins+losses should sum to 82 for every team — spot check a couple), and the sim-to-end button's label changes to "Sim to End of Playoffs".
8. Click "Sim to End of Playoffs" — wait for it to finish, confirm no console errors, and (open the console) run `GameState.playoffBracket.finals[0].winner` — expect a real team id, confirming a champion was crowned.
9. Throughout, confirm the browser console shows no errors.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add index.html script.js
git commit -m "chore: wire Phase 2 into the app shell and verify end-to-end (season + playoffs)"
```

---

## Self-Review Notes

- **Spec coverage:** schedule generation (real game-count rules + randomized-within-constraints dates) ✓ Tasks 3-4, verified correct by prototyping before writing the plan. Pluggable sim engine architecture with only `boxscore` implemented ✓ Tasks 5-7. Fatigue ✓ Task 8. Basic injuries ✓ Task 9. Full box score history + season stats ✓ Tasks 10-11, 16. Standings with real records ✓ Tasks 10, 19. Playoffs (standard 8-per-conference, best-of-7) ✓ Tasks 13-14. Sim controls (Next Game/Day/Sim to End of Season|Playoffs) + speed setting ✓ Tasks 12, 17. Settings engine picker showing disabled future engines ✓ Task 18. Dashboard/Roster updated to show real data instead of Phase 1 stubs ✓ Tasks 20-21.
- **Placeholder scan:** no TBD/TODO. The shooting-line approximation in Task 7 is explicitly documented as an approximation (not possession-level), matching the design doc's stated scope, not a hand-wave of unfinished work.
- **Type/interface consistency:** `simulateGame(homeTeamId, awayTeamId, rng)` signature is identical between the `simEngine.js` contract (Task 5) and `simEngineBoxScore.js`'s implementation (Task 7) and `playoffs.js`'s call site (Task 14). `getTeamRoster`/`getPlayerById` are defined once in `league.js` (Task 1) and consumed by name everywhere else, never redefined. `GameState.season`/`GameState.playoffBracket`/`GameState.settings`/`GameState.rng` are established in Task 15 and referenced with the same shape by every later UI task.
- **Node/browser dual-loading:** every new pure-logic file (`league.js`, `rng.js`, `schedule.js`, `simEngine.js`, `simEngineBoxScore.js`, `fatigue.js`, `injuries.js`, `playoffs.js`) follows the `_XXX_DATA` conditional-require pattern established in Phase 1's `players-2026.js`, so `scripts/validate-sim.js` can exercise all of them without a browser.
