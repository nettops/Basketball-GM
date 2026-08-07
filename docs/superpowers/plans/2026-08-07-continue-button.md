# Continue — One Advance Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sim dock's ten time-advance controls with three — Continue, Watch Next Game, and one Skip-to menu — backed by a single day-granular loop that stops for a reason and can be interrupted at any moment.

**Architecture:** Policy and mechanism are split. A new `simRunner.js` holds `evaluateStop()` — pure, Node-testable, no DOM. `ui/simControls.js` owns one async loop, `runAdvance()`, which replaces both `runWithDelay` and `runMultiSeason`: check stop → step once → yield → repeat. Continue and every Skip-to target are that same loop with a different stop predicate.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Dual require/global module pattern. Node tests are plain scripts under `scripts/` using `assert`. Browser verification via `scripts/devserver.py` and the in-app `UI_SMOKE` harness.

## Scope

Implements `docs/superpowers/specs/2026-08-07-continue-button-design.md` in full.

## Global Constraints

- No new third-party dependencies. This project is zero-dependency by design.
- New root modules use the dual require/global pattern (see the `_POSS_DATA` block at the top of `simEnginePossession.js`).
- Browser files must be added to `index.html` in dependency order. Node resolves `require` by dependency; the browser runs `<script>` tags in file order in one shared global scope. Before adding any top-level `var`/`const`/`function` name, grep the whole repo for it — this project has lost time to a `var _COACH_DATA` colliding with an existing one.
- `ui/*.js` files are view-only and must **not** be added to `simWorker.js`.
- Existing `scripts/validate-*.js` must pass at every commit unless a task explicitly changes one, and any such change must be justified in that task.
- `scripts/fixtures/gamesim-golden.json` must remain byte-identical throughout. Nothing here touches the possession engine.
- Existing saves keep their stored `pauseOn` and `automation` values. Default changes affect new games only.
- Stop conditions are evaluated **before** each step. This ordering is load-bearing: it is what leaves the next day unplayed so a game can still be watched.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `seasonRollover.js` | create (Task 1) | The one implementation of season → offseason → new season. Node-testable. |
| `scripts/gen-rollover-golden.js` | create (Task 2) | One-shot generator for the rollover characterization fixture. |
| `scripts/fixtures/rollover-golden.json` | create (Task 2) | Pinned league state after three auto-rolled seasons. |
| `scripts/validate-seasonRollover.js` | create (Task 2) | Characterization test for the rollover. |
| `simRunner.js` | create (Task 3) | `evaluateStop()`, `STOP_REASONS`. Pure policy, no DOM. |
| `scripts/validate-simRunner.js` | create (Task 3) | Exhaustive stop-policy tests. |
| `script.js` | modify (Tasks 4, 5) | `pauseReason` alongside `pauseRequested`; `pauseOn` defaults; `handleAdvanceToOffseason` consolidated onto `seasonRollover.js`. |
| `ui/settings.js` | modify (Task 4) | No code change needed — verify the toggles still reflect state. |
| `ui/simControls.js` | modify (Tasks 1, 5, 6, 7) | `runAdvance()` replaces `runWithDelay`/`runMultiSeason`; dock rebuilt. |
| `index.html` | modify (Tasks 1, 3) | Load `seasonRollover.js` and `simRunner.js`. |
| `style.css` | modify (Task 7) | Continue/Stop primary button, status line, Skip-to row. |
| `scripts/ui-smoke.js` | modify (Task 8) | `dock` group: three time controls, reachable, Continue disabled during a live game. |

---

## Task 1: Extract season rollover as a pure move

`runMultiSeason` contains a complete season-rollover implementation, and `handleAdvanceToOffseason` in `script.js` contains another. Task 5 merges them. This task moves the first one somewhere Node can reach, changing **no behaviour**, so that Task 2 can pin it before Task 5 changes anything.

**Files:**
- Create: `seasonRollover.js`
- Modify: `ui/simControls.js` (the rollover body inside `runMultiSeason`)
- Modify: `index.html`

**Interfaces:**
- Consumes: `pushSeasonSnapshot`, `finalizeSeasonHistory`, `setLeagueYear`, `runOffseasonThroughDraft`, `archiveDraftClass`, `runFreeAgencySilently`, `autoEnforceRosterSize`, `generateNewSeason`, `getTeamById`, `pushToFeed` — all existing globals.
- Produces: `runOffseasonRollover(gameState, deps) → { careerSceneShown: boolean }`, where `deps` is `{ onCareerFollowup: function|null }`.

- [ ] **Step 1: Create `seasonRollover.js`**

```js
// The ONE implementation of season -> offseason -> new season.
//
// This logic existed twice: once in ui/simControls.js's runMultiSeason (the
// fast-forward path, which rolls all the way into the next season) and once
// in script.js's handleAdvanceToOffseason (the manual path, which stops at
// the draft). The code comments in both explicitly noted the other existed.
// Two implementations of a league's most destructive operation is how a
// fast-forward silently diverges from a manual advance, so they are merged
// here — extracted first as a pure move (this task) and pinned by a
// characterization fixture before anything is changed.
//
// Extracted to the root rather than left in ui/ so Node can require it: the
// browser file it came from calls into the DOM, which is exactly why this
// logic was never testable.
var _ROLLOVER_DATA = (typeof require !== 'undefined')
  ? {
      save: require('./save.js'),
      history: require('./history.js'),
      draft: require('./draft.js'),
      freeAgency: require('./freeAgency.js'),
      autoGM: require('./autoGM.js'),
      seasonTransition: require('./seasonTransition.js'),
      teams: require('./teams.js')
    }
  : {
      save: { pushSeasonSnapshot: pushSeasonSnapshot },
      history: { finalizeSeasonHistory: finalizeSeasonHistory, archiveDraftClass: archiveDraftClass },
      draft: { runOffseasonThroughDraft: runOffseasonThroughDraft },
      freeAgency: { runFreeAgencySilently: runFreeAgencySilently },
      autoGM: { autoEnforceRosterSize: autoEnforceRosterSize },
      seasonTransition: { generateNewSeason: generateNewSeason },
      teams: { getTeamById: getTeamById }
    };

// Rolls a completed season all the way into the next one: archives history,
// runs the draft and free agency, and generates a fresh schedule.
//
// deps.onCareerFollowup, when supplied, runs player-career mode's own
// offseason step and returns true if it put a scene on screen the user must
// acknowledge. It is injected rather than called directly because it renders
// — this module must stay DOM-free to remain testable.
//
// deps.onFeed, when supplied, receives feed lines. Also injected: pushToFeed
// lives in script.js, which Node cannot load.
function runOffseasonRollover(gameState, deps) {
  const d = deps || {};
  const onFeed = d.onFeed || function () {};

  _ROLLOVER_DATA.save.pushSeasonSnapshot(gameState);

  // Pending offers reference a roster that retirement, the draft and free
  // agency are all about to reshape — carrying them across would let the user
  // accept a trade for a player who no longer exists.
  gameState.tradeOffers = [];

  _ROLLOVER_DATA.history.finalizeSeasonHistory(gameState.leagueYear || 2026, gameState.playoffBracket, onFeed);
  gameState.leagueYear = (gameState.leagueYear || 2026) + 1;
  if (gameState.settings) gameState.settings.leagueYear = gameState.leagueYear;

  const draftResult = _ROLLOVER_DATA.draft.runOffseasonThroughDraft(
    gameState.playoffBracket, gameState.rng, gameState.upcomingDraftClass,
    gameState.leagueYear, gameState.settings.lotteryFormat);
  gameState.lastDraftResults = draftResult.draftResults;
  _ROLLOVER_DATA.history.archiveDraftClass(gameState.leagueYear, draftResult.draftResults);

  _ROLLOVER_DATA.freeAgency.runFreeAgencySilently(gameState.rng);
  _ROLLOVER_DATA.autoGM.autoEnforceRosterSize(_ROLLOVER_DATA.teams.getTeamById(gameState.userTeamId));

  let careerSceneShown = false;
  if (d.onCareerFollowup) careerSceneShown = !!d.onCareerFollowup();

  const seasonResult = _ROLLOVER_DATA.seasonTransition.generateNewSeason(gameState.rng);
  gameState.season = { games: seasonResult.games, currentDay: -1 };
  gameState.upcomingDraftClass = seasonResult.nextDraftClass;
  gameState.playoffBracket = null;
  gameState.offseasonStage = null;
  gameState.allStarWeekend = null;

  return { careerSceneShown: careerSceneShown };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runOffseasonRollover: runOffseasonRollover };
}
```

- [ ] **Step 2: Call it from `runMultiSeason`**

In `ui/simControls.js`, replace the rollover body — from `pushSeasonSnapshot(GameState);` through the `GameState.allStarWeekend = null;` line, and the `careerSceneShown` block between them — with:

```js
    const rollover = runOffseasonRollover(GameState, {
      onFeed: function (text) { pushToFeed(text); },
      onCareerFollowup: GameState.gameMode === 'playerCareer'
        ? function () { return handlePlayerCareerOffseasonFollowup(true); }
        : null
    });
    const careerSceneShown = rollover.careerSceneShown;
    seasonsRun += 1;
```

Leave everything else in `runMultiSeason` exactly as it is. `setLeagueYear` is replaced by the two assignments inside the module because `setLeagueYear` lives in `script.js`; the effect is identical (it sets `GameState.leagueYear` and mirrors it onto `settings.leagueYear`).

- [ ] **Step 3: Load it in `index.html`**

Add before `ui/simControls.js` and after `save.js`, `history.js`, `draft.js`, `freeAgency.js`, `autoGM.js`, `seasonTransition.js` — it reads all of those at call time:

```html
  <script src="seasonRollover.js"></script>
```

Verify placement: `grep -n "save.js\|history.js\|draft.js\|freeAgency.js\|autoGM.js\|seasonTransition.js\|seasonRollover.js\|ui/simControls.js" index.html` and confirm `seasonRollover.js` comes after all six and before `ui/simControls.js`.

- [ ] **Step 4: Verify nothing moved but the lines**

Run: `node --check seasonRollover.js && node --check ui/simControls.js && node scripts/validate-uiSafety.js`
Expected: no `--check` output; `validate-uiSafety.js` passes and its file count goes up by one.

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 5: Verify in the browser**

Run: `python scripts/devserver.py 8221`

At `http://localhost:8221`: start a new GM game, set Fast Forward to **2 Seasons**, click Seasons. Confirm two seasons complete, the year advances by two, Standings show a fresh season, and the console has zero errors. This is a pure move — any behaviour difference is a bug in the extraction.

- [ ] **Step 6: Commit**

```bash
git add seasonRollover.js ui/simControls.js index.html
git commit -m "refactor: extract season rollover so it can be tested"
```

---

## Task 2: Pin the rollover with a characterization fixture

The spec names this consolidation as the one change that can break a league rather than a button. Task 5 merges two implementations; this fixture is what proves the merge changed nothing.

**Files:**
- Create: `scripts/gen-rollover-golden.js`
- Create: `scripts/fixtures/rollover-golden.json` (generated)
- Create: `scripts/validate-seasonRollover.js`

**Interfaces:**
- Consumes: `runOffseasonRollover(gameState, deps)` from Task 1.
- Produces: `scripts/fixtures/rollover-golden.json`, an array of per-season `{ season, leagueYear, teamChecksum, rosterChecksum, gamesCount, draftPicks }`.

- [ ] **Step 1: Write the generator**

Create `scripts/gen-rollover-golden.js`:

```js
// One-shot generator for the rollover characterization fixture. Run ONCE,
// before the two rollover paths are merged, and commit the JSON. Re-running
// it after a deliberate behaviour change is how the fixture is updated, and
// that must be justified in the commit that does it.
const fs = require('fs');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
require(path.join(__dirname, '..', 'gameCoach.js'));
require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const schedule = require(path.join(__dirname, '..', 'schedule.js'));
const playoffs = require(path.join(__dirname, '..', 'playoffs.js'));
const rollover = require(path.join(__dirname, '..', 'seasonRollover.js'));

const SEASONS = 3;

// Stable digests, so the fixture catches roster and record drift and not just
// the year counter.
function teamChecksum() {
  return TEAMS.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, t, i) {
      const r = t.record || {};
      return (sum + (r.wins || 0) * (i + 2) + (r.losses || 0) * (i + 3)) % 2147483647;
    }, 0);
}

function rosterChecksum() {
  return PLAYERS_2026.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, p, i) {
      return (sum + (p.age || 0) * (i + 2) + (p.teamId ? p.teamId.length : 0) * (i + 5)) % 2147483647;
    }, 0);
}

function buildGameState(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return {
    userTeamId: 'BOS',
    leagueYear: 2026,
    rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null,
    offseasonStage: null,
    tradeOffers: [],
    upcomingDraftClass: [],
    settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

const gs = buildGameState(4242);
const out = [];
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  rollover.runOffseasonRollover(gs, {});

  out.push({
    season: s + 1,
    leagueYear: gs.leagueYear,
    teamChecksum: teamChecksum(),
    rosterChecksum: rosterChecksum(),
    gamesCount: gs.season.games.length,
    draftPicks: (gs.lastDraftResults || []).length
  });
}

const target = path.join(__dirname, 'fixtures', 'rollover-golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', target);
```

- [ ] **Step 2: Generate and inspect the fixture**

Run: `node scripts/gen-rollover-golden.js && cat scripts/fixtures/rollover-golden.json`
Expected: three entries, `leagueYear` 2027 → 2028 → 2029, `gamesCount` 1230 each, non-zero `draftPicks`, and checksums that differ between seasons. If `draftPicks` is 0 or the checksums repeat, the rollover did nothing and the fixture is worthless — stop and diagnose before continuing.

- [ ] **Step 3: Write the characterization test**

Create `scripts/validate-seasonRollover.js`:

```js
// Characterization test for the season rollover. This exists because the
// rollover had TWO implementations (fast-forward and manual) that were about
// to be merged, and a divergence between them corrupts a league quietly:
// duplicate draftees, double-counted history, a year counter that drifts.
const assert = require('assert');
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
require(path.join(__dirname, '..', 'gameCoach.js'));
require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const schedule = require(path.join(__dirname, '..', 'schedule.js'));
const playoffs = require(path.join(__dirname, '..', 'playoffs.js'));
const rollover = require(path.join(__dirname, '..', 'seasonRollover.js'));

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rollover-golden.json'), 'utf8'));

function teamChecksum() {
  return TEAMS.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, t, i) {
      const r = t.record || {};
      return (sum + (r.wins || 0) * (i + 2) + (r.losses || 0) * (i + 3)) % 2147483647;
    }, 0);
}

function rosterChecksum() {
  return PLAYERS_2026.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, p, i) {
      return (sum + (p.age || 0) * (i + 2) + (p.teamId ? p.teamId.length : 0) * (i + 5)) % 2147483647;
    }, 0);
}

function buildGameState(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return {
    userTeamId: 'BOS', leagueYear: 2026, rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: [], settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

function checkRolloverMatchesGolden() {
  const gs = buildGameState(4242);
  GOLDEN.forEach(function (expected, i) {
    const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
    for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
    gs.season.currentDay = lastDay;
    gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
    let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
    while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

    rollover.runOffseasonRollover(gs, {});

    assert.strictEqual(gs.leagueYear, expected.leagueYear, 'season ' + (i + 1) + ' leagueYear');
    assert.strictEqual(teamChecksum(), expected.teamChecksum, 'season ' + (i + 1) + ' team records');
    assert.strictEqual(rosterChecksum(), expected.rosterChecksum, 'season ' + (i + 1) + ' rosters');
    assert.strictEqual(gs.season.games.length, expected.gamesCount, 'season ' + (i + 1) + ' schedule size');
    assert.strictEqual((gs.lastDraftResults || []).length, expected.draftPicks, 'season ' + (i + 1) + ' draft picks');
  });
  console.log('checkRolloverMatchesGolden: OK');
}
checkRolloverMatchesGolden();

function checkRolloverResetsSeasonState() {
  const gs = buildGameState(77);
  gs.playoffBracket = { first: [], semis: [], confFinals: [], finals: [{ winner: 'BOS' }] };
  gs.offseasonStage = 'draft';
  gs.allStarWeekend = { done: true };
  gs.tradeOffers = [{ proposal: {} }];

  rollover.runOffseasonRollover(gs, {});

  assert.strictEqual(gs.playoffBracket, null, 'bracket cleared');
  assert.strictEqual(gs.offseasonStage, null, 'offseason stage cleared');
  assert.strictEqual(gs.allStarWeekend, null, 'all-star state cleared');
  assert.deepStrictEqual(gs.tradeOffers, [], 'stale offers dropped before rosters change');
  assert.strictEqual(gs.season.currentDay, -1, 'new season starts before day 0');
  console.log('checkRolloverResetsSeasonState: OK');
}
checkRolloverResetsSeasonState();

function checkCareerFollowupIsReported() {
  const gs = buildGameState(78);
  let called = false;
  const r = rollover.runOffseasonRollover(gs, { onCareerFollowup: function () { called = true; return true; } });
  assert.strictEqual(called, true, 'the injected career step runs');
  assert.strictEqual(r.careerSceneShown, true, 'and its result is reported back');

  const gs2 = buildGameState(79);
  const r2 = rollover.runOffseasonRollover(gs2, {});
  assert.strictEqual(r2.careerSceneShown, false, 'absent in GM mode');
  console.log('checkCareerFollowupIsReported: OK');
}
checkCareerFollowupIsReported();

console.log('All season rollover validations passed');
```

- [ ] **Step 4: Run it**

Run: `node scripts/validate-seasonRollover.js`
Expected: all four checks OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-rollover-golden.js scripts/fixtures/rollover-golden.json scripts/validate-seasonRollover.js
git commit -m "test: characterization fixture pinning the season rollover"
```

---

## Task 3: `simRunner.js` — the stop policy

**Files:**
- Create: `simRunner.js`
- Create: `scripts/validate-simRunner.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `gameState.season`, `gameState.playoffBracket`, `gameState.offseasonStage`, `gameState.automation`, `gameState.pauseRequested`, `gameState.pauseReason`.
- Produces:
  - `STOP_REASONS` — `{ USER_STOP:'userStop', DRAFT_READY:'draftReady', FREE_AGENCY_READY:'freeAgencyReady', SEASON_COMPLETE:'seasonComplete', PLAYOFFS_COMPLETE:'playoffsComplete', TARGET_REACHED:'targetReached', NOTABLE_EVENT:'notableEvent' }`
  - `evaluateStop(gameState, dayIndex, context) → { reason, label } | null`, where `context` is `{ target, userStopRequested }` and `target` is `null` or `{ kind, day }` with `kind` one of `'day' | 'seasonEnd' | 'playoffsEnd' | 'draft' | 'freeAgency' | 'seasons' | 'championship'`.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-simRunner.js`:

```js
// The stop policy behind Continue. Kept free of the DOM and of globals so
// every rule below is a plain input/output case: `target` and
// `userStopRequested` arrive through `context` precisely so these tests never
// have to arrange browser state.
const assert = require('assert');
const path = require('path');
const runner = require(path.join(__dirname, '..', 'simRunner.js'));
const R = runner.STOP_REASONS;

function baseState(over) {
  const gs = {
    season: { games: [{ day: 0, played: true }, { day: 1, played: false }], currentDay: 0 },
    playoffBracket: null,
    offseasonStage: null,
    automation: { autoDraft: false, autoFreeAgency: false },
    pauseRequested: false,
    pauseReason: null
  };
  return Object.assign(gs, over || {});
}

function checkNothingToStopFor() {
  const stop = runner.evaluateStop(baseState(), 0, { target: null, userStopRequested: false });
  assert.strictEqual(stop, null, 'a normal mid-season day does not stop');
  console.log('checkNothingToStopFor: OK');
}
checkNothingToStopFor();

function checkUserStopOutranksEverything() {
  // Deliberately a state where several other reasons also apply.
  const gs = baseState({ offseasonStage: 'draft', pauseRequested: true, pauseReason: 'Injury' });
  const stop = runner.evaluateStop(gs, 0, { target: null, userStopRequested: true });
  assert.ok(stop, 'a stop is returned');
  assert.strictEqual(stop.reason, R.USER_STOP, 'pressing Stop wins over every automatic reason');
  console.log('checkUserStopOutranksEverything: OK');
}
checkUserStopOutranksEverything();

function checkDraftStopRespectsAutomation() {
  const manual = baseState({ offseasonStage: 'draft' });
  const s1 = runner.evaluateStop(manual, 0, { target: null, userStopRequested: false });
  assert.ok(s1 && s1.reason === R.DRAFT_READY, 'stops at the draft when autoDraft is off');
  assert.ok(s1.label && s1.label.length > 0, 'and says why');

  const auto = baseState({ offseasonStage: 'draft', automation: { autoDraft: true, autoFreeAgency: false } });
  assert.strictEqual(runner.evaluateStop(auto, 0, { target: null, userStopRequested: false }), null,
    'runs straight through when autoDraft is on');
  console.log('checkDraftStopRespectsAutomation: OK');
}
checkDraftStopRespectsAutomation();

function checkFreeAgencyStopRespectsAutomation() {
  const manual = baseState({ offseasonStage: 'freeagency' });
  const s1 = runner.evaluateStop(manual, 0, { target: null, userStopRequested: false });
  assert.ok(s1 && s1.reason === R.FREE_AGENCY_READY, 'stops at free agency when autoFreeAgency is off');

  const auto = baseState({ offseasonStage: 'freeagency', automation: { autoDraft: false, autoFreeAgency: true } });
  assert.strictEqual(runner.evaluateStop(auto, 0, { target: null, userStopRequested: false }), null,
    'runs through when autoFreeAgency is on');
  console.log('checkFreeAgencyStopRespectsAutomation: OK');
}
checkFreeAgencyStopRespectsAutomation();

function checkSeasonAndPlayoffBoundaries() {
  const done = baseState({ season: { games: [{ day: 0, played: true }], currentDay: 0 } });
  const s1 = runner.evaluateStop(done, 0, { target: null, userStopRequested: false });
  assert.ok(s1 && s1.reason === R.SEASON_COMPLETE, 'stops when every game is played');

  const champ = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'BOS' }] }
  });
  const s2 = runner.evaluateStop(champ, 0, { target: null, userStopRequested: false });
  assert.ok(s2 && s2.reason === R.PLAYOFFS_COMPLETE, 'stops once a champion exists');
  console.log('checkSeasonAndPlayoffBoundaries: OK');
}
checkSeasonAndPlayoffBoundaries();

function checkNotableEventStops() {
  const gs = baseState({ pauseRequested: true, pauseReason: 'Jayson Tatum injured' });
  const stop = runner.evaluateStop(gs, 0, { target: null, userStopRequested: false });
  assert.ok(stop && stop.reason === R.NOTABLE_EVENT, 'a flagged event stops the run');
  assert.strictEqual(stop.label, 'Jayson Tatum injured', 'and the reason reaches the label');
  console.log('checkNotableEventStops: OK');
}
checkNotableEventStops();

function checkDayTargetReached() {
  const gs = baseState({ season: { games: [{ day: 0, played: true }, { day: 9, played: false }], currentDay: 5 } });
  assert.strictEqual(runner.evaluateStop(gs, 5, { target: { kind: 'day', day: 9 }, userStopRequested: false }), null,
    'keeps going before the target day');
  const at = runner.evaluateStop(gs, 9, { target: { kind: 'day', day: 9 }, userStopRequested: false });
  assert.ok(at && at.reason === R.TARGET_REACHED, 'stops on the target day');
  console.log('checkDayTargetReached: OK');
}
checkDayTargetReached();

console.log('All sim runner validations passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-simRunner.js`
Expected: FAIL — `Cannot find module '../simRunner.js'`.

- [ ] **Step 3: Implement `simRunner.js`**

```js
// The stop policy behind Continue: given league state, should the advance
// loop halt, and what should it say?
//
// Deliberately pure — no DOM, no timers, no globals. The two inputs that are
// NOT derivable from league state (the Skip-to target, and whether the user
// pressed Stop) arrive through `context`, which is what makes every rule here
// a plain input/output case rather than something that needs a browser to
// test. ui/simControls.js owns the loop; this file owns the rules.
const STOP_REASONS = {
  USER_STOP: 'userStop',
  DRAFT_READY: 'draftReady',
  FREE_AGENCY_READY: 'freeAgencyReady',
  SEASON_COMPLETE: 'seasonComplete',
  PLAYOFFS_COMPLETE: 'playoffsComplete',
  TARGET_REACHED: 'targetReached',
  NOTABLE_EVENT: 'notableEvent'
};

function _allGamesPlayed(season) {
  return !!season && season.games.every(function (g) { return g.played; });
}

function _championCrowned(bracket) {
  return !!(bracket && bracket.finals && bracket.finals[0] && bracket.finals[0].winner);
}

// Returns { reason, label } or null. Order is priority order, and it matters:
// a user pressing Stop must win over every automatic reason, or their click
// looks ignored.
function evaluateStop(gameState, dayIndex, context) {
  const ctx = context || {};
  const target = ctx.target || null;

  if (ctx.userStopRequested) {
    return { reason: STOP_REASONS.USER_STOP, label: 'Stopped' };
  }

  const auto = gameState.automation || {};
  if (gameState.offseasonStage === 'draft' && !auto.autoDraft) {
    return { reason: STOP_REASONS.DRAFT_READY, label: 'Draft is ready' };
  }
  if (gameState.offseasonStage === 'freeagency' && !auto.autoFreeAgency) {
    return { reason: STOP_REASONS.FREE_AGENCY_READY, label: 'Free agency is open' };
  }

  if (_championCrowned(gameState.playoffBracket)) {
    return { reason: STOP_REASONS.PLAYOFFS_COMPLETE, label: 'Playoffs are over' };
  }
  if (!gameState.playoffBracket && _allGamesPlayed(gameState.season)) {
    return { reason: STOP_REASONS.SEASON_COMPLETE, label: 'Regular season is over' };
  }

  if (target) {
    if (target.kind === 'day' && dayIndex >= target.day) {
      return { reason: STOP_REASONS.TARGET_REACHED, label: 'Reached ' + (target.label || 'your target') };
    }
  }

  // Set by handleDayComplete for the events the player flagged in Settings.
  if (gameState.pauseRequested) {
    return { reason: STOP_REASONS.NOTABLE_EVENT, label: gameState.pauseReason || 'Something needs your attention' };
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STOP_REASONS: STOP_REASONS, evaluateStop: evaluateStop };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/validate-simRunner.js`
Expected: all seven checks OK.

- [ ] **Step 5: Load it in `index.html`**

`simRunner.js` reads only its arguments, so it has no load-order dependency. Add it immediately before `ui/simControls.js`:

```html
  <script src="simRunner.js"></script>
```

- [ ] **Step 6: Full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 7: Commit**

```bash
git add simRunner.js scripts/validate-simRunner.js index.html
git commit -m "feat: stop policy for the advance loop"
```

---

## Task 4: `pauseReason`, and the `pauseOn` defaults

`pauseRequested` is a bare boolean set in four places with no record of why, so a stop cannot explain itself. And all four `pauseOn` flags default off, which would leave notable-event stopping inert on a new game.

**Files:**
- Modify: `script.js` (two `pauseRequested` sites, the `pauseOn` defaults)
- Modify: `ui/simControls.js` (two `pauseRequested` sites)

**Interfaces:**
- Produces: `GameState.pauseReason` — a short human-readable string, set wherever `pauseRequested` is set, cleared wherever it is cleared. Read by `evaluateStop` (Task 3) for the `notableEvent` label.

- [ ] **Step 1: Add the field and change the defaults**

In `script.js`, in the `GameState` literal, add `pauseReason` directly under `pauseRequested`:

```js
  pauseRequested: false,
  // Why the run stopped, for the dock's status line. pauseRequested alone is
  // a bare boolean: it can halt a fast-forward but cannot say what happened,
  // which leaves the player to work out for themselves why the game stopped.
  pauseReason: null,
```

And change the `pauseOn` defaults on the `settings` literal:

```js
    // madePlayoffs/missedPlayoffs fire once a season and keyInjury is rare —
    // each is the game telling you something, so they default on.
    // tradeOfferReceived does NOT: offers generate weekly, so it would stop a
    // fast-forward roughly 26 times a season. Offers now expire on their own
    // with a visible countdown (trade.js), so the inbox no longer needs to
    // interrupt in order to be noticed.
    pauseOn: { madePlayoffs: true, missedPlayoffs: true, tradeOfferReceived: false, keyInjury: true },
```

- [ ] **Step 2: Set a reason at each site**

In `script.js`, the key-injury site:

```js
    if (isUserPlayer && player.overall >= 80 && GameState.settings.pauseOn.keyInjury) {
      GameState.pauseRequested = true;
      GameState.pauseReason = player.name + ' injured';
    }
```

In `script.js`, the trade-offer site:

```js
    if (GameState.settings.pauseOn.tradeOfferReceived) {
      GameState.pauseRequested = true;
      GameState.pauseReason = 'New trade offer';
    }
```

In `ui/simControls.js`, the playoff-berth site inside `runMultiSeason`:

```js
      if ((madePlayoffs && GameState.settings.pauseOn.madePlayoffs) || (!madePlayoffs && GameState.settings.pauseOn.missedPlayoffs)) {
        GameState.pauseRequested = true;
        GameState.pauseReason = madePlayoffs ? 'You made the playoffs' : 'You missed the playoffs';
      }
```

In `ui/simControls.js`, the championship site:

```js
    if (mode === 'championship' && GameState.playoffBracket.finals[0].winner === GameState.userTeamId) {
      seasonsRun += 1;
      GameState.pauseRequested = true;
      GameState.pauseReason = 'You won the title';
      break;
    }
```

And where `runMultiSeason` clears the flag (`GameState.pauseRequested = false;`), clear the reason with it:

```js
  GameState.pauseRequested = false;
  GameState.pauseReason = null;
```

- [ ] **Step 3: Verify every site is paired**

Run: `grep -n "pauseRequested" script.js ui/simControls.js`
Expected: every line that assigns `pauseRequested` has a `pauseReason` assignment adjacent to it. A site without one is a stop that cannot explain itself.

Run: `node --check script.js && node --check ui/simControls.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: no `--check` output, `done` with no `FAIL:` lines.

- [ ] **Step 4: Verify the defaults in the browser**

Run: `python scripts/devserver.py 8222`

In the console at `http://localhost:8222` after starting a new game:

```js
JSON.stringify(GameState.settings.pauseOn)
```
Expected: `{"madePlayoffs":true,"missedPlayoffs":true,"tradeOfferReceived":false,"keyInjury":true}`

Then open Settings and confirm the four checkboxes match those values.

- [ ] **Step 5: Commit**

```bash
git add script.js ui/simControls.js
git commit -m "feat: stops explain themselves, and notable-event stops default on"
```

---

## Task 5: One rollover path

Merges `handleAdvanceToOffseason` onto `runOffseasonRollover`. The fixture from Task 2 is what proves the merge changed nothing.

**Files:**
- Modify: `script.js` (`handleAdvanceToOffseason`)

**Interfaces:**
- Consumes: `runOffseasonRollover(gameState, deps)` from Task 1.

- [x] **Step 1: Read both implementations side by side**

Run: `grep -n "function handleAdvanceToOffseason" -A 45 script.js` and `grep -n "runOffseasonRollover" -B 5 -A 12 ui/simControls.js`

The manual path stops at the draft (`offseasonStage = 'draft'`) and may show a season summary; the auto path continues through free agency into a new season. Everything before that divergence — snapshot, clear offers, finalize history, bump the year, run the draft, archive the class — is the same work in both.

- [x] **Step 2: Give the rollover a stop point**

In `seasonRollover.js`, add an option so the manual path can stop after the draft. Replace the free-agency block and everything after it with:

```js
  // The manual path stops here and hands the user their draft; the
  // fast-forward path continues into the new season. Same code either way,
  // which is the entire point of this module.
  if (d.stopAfterDraft) {
    gameState.offseasonStage = 'draft';
    return { careerSceneShown: false, stoppedAfterDraft: true };
  }

  _ROLLOVER_DATA.freeAgency.runFreeAgencySilently(gameState.rng);
  _ROLLOVER_DATA.autoGM.autoEnforceRosterSize(_ROLLOVER_DATA.teams.getTeamById(gameState.userTeamId));

  let careerSceneShown = false;
  if (d.onCareerFollowup) careerSceneShown = !!d.onCareerFollowup();

  const seasonResult = _ROLLOVER_DATA.seasonTransition.generateNewSeason(gameState.rng);
  gameState.season = { games: seasonResult.games, currentDay: -1 };
  gameState.upcomingDraftClass = seasonResult.nextDraftClass;
  gameState.playoffBracket = null;
  gameState.offseasonStage = null;
  gameState.allStarWeekend = null;

  return { careerSceneShown: careerSceneShown, stoppedAfterDraft: false };
```

- [x] **Step 3: Add a test for the new branch**

> **Deviation (executed).** The test as drafted here could not work. It built a
> state with `buildGameState(80)` and never played a season, but `buildDraftOrder`
> reads playoff finish order and needs a completed postseason — the same mistake
> Task 2 already hit. It must call `playSeason(gs)` first, which in turn makes the
> `currentDay === -1` assertion wrong (it is `lastDay` by then). The replacement
> asserts the stronger property anyway: the schedule object is *identical* and
> still fully played, i.e. the manual path did not quietly roll into a new season.
> A second test was added for the injected draft. See
> `scripts/validate-seasonRollover.js` for both as landed.

- [x] **Step 4: Point `handleAdvanceToOffseason` at the shared rollover**

> **Deviation (executed).** The caveat below was warranted: reading the real
> function showed the drafted replacement dropped **four** live behaviours.
>
> 1. **The interactive draft.** With `autoDraft` off, the manual path runs
>    `runOffseasonPreDraft` → `buildDraftOrder` → `startDraftSession` →
>    `advanceDraftUntilUserTurn` so the user picks for themselves. The
>    replacement always auto-drafted, which would have silently deleted manual
>    drafting — the very thing Task 3's `DRAFT_READY` stop exists to hand them.
> 2. **`renderSeasonSummary(finishedLeagueYear)` does not exist.** The real
>    function is `renderSeasonSummary(container)` in `ui/seasonSummary.js`; the
>    year travels via `GameState.summarySeasonYear` + `renderView('seasonSummary')`.
> 3. **`renderView('draft')`** — the non-summary branch, dropped entirely.
> 4. **`handlePlayerCareerOffseasonFollowup()`** at the end, for career mode.
>
> Resolution: `seasonRollover.js` gained an injected `deps.onDraft` alongside
> `stopAfterDraft`. The draft is the one step that legitimately differs between
> callers — because the user chose it in Settings — so it is a strategy the
> caller supplies, not a second copy of the rollover. Everything else (snapshot,
> clearing offers, `finalizeSeasonHistory`, the year bump) is now shared. The
> view renders and the career followup stay in `script.js`, unchanged and in
> their original order. See `script.js:333` as landed.

- [x] **Step 5: Verify against the fixture**

Run: `node scripts/validate-seasonRollover.js`
Expected: all five checks OK, including `checkRolloverMatchesGolden` — the auto path must be byte-identical after the merge.

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [x] **Step 6: Verify both paths in the browser**

Run: `python scripts/devserver.py 8223`

1. New game → **Skip to Draft**. Confirm the draft opens, the year advanced by one, and the Draft view lists prospects.
2. New game → Fast Forward **2 Seasons**. Confirm two seasons roll over and Standings show a fresh schedule.
3. In both, confirm rosters have no duplicate players: `PLAYERS_2026.length === new Set(PLAYERS_2026.map(p=>p.id)).size`
Expected: `true`. Duplicate draftees are the specific corruption a divergent rollover produces.

- [x] **Step 7: Commit**

```bash
git add seasonRollover.js script.js scripts/validate-seasonRollover.js
git commit -m "refactor: one season-rollover path for manual and fast-forward"
```

---

## Task 6: `runAdvance` — the single loop

> **Deviations (executed).** Six, four of them load-bearing.
>
> 1. **`stepOnce` never ran the season rollover.** As drafted it returned false
>    once a champion was crowned, so Continue reported "Nothing left to
>    simulate" and the league could never leave the postseason — the loop was
>    unable to reach the very rollover Tasks 1, 2 and 5 existed to build. It now
>    has explicit offseason phases: cross draft, cross free agency, and run the
>    rollover when a champion exists (with `stopAfterDraft` mirroring the
>    player's own automation, so a manual drafter is handed their draft).
> 2. **Nothing let Continue step ACROSS a boundary it was parked on.** Stops are
>    evaluated before stepping, so halting at `seasonComplete` meant the next
>    press re-evaluated the same still-true condition and halted again having
>    simulated nothing. Continue would have been a dead button at exactly the
>    moments the design says it should read `Continue -> Playoffs`. Added
>    `ctx.crossBoundary`, true only on a run's first check, suppressing only the
>    two boundary reasons — never an unautomated draft, never Stop.
> 3. **"Until Title" and "N seasons" were silently dropped.** The drafted
>    `handleSkipTo` sent both to `target: null`, which just stops at the next
>    boundary. Added `championship`, `seasons` and `stage` target kinds to
>    `simRunner.js`, each with tests. A championship target now runs past other
>    teams' titles but still halts for an unautomated draft, per the design.
> 4. **A stale boundary interrupted the offseason.** The bracket is not cleared
>    until the new season, so `playoffsComplete` stayed true throughout and
>    Continue halted in free agency to announce "Playoffs are over". Boundary
>    stops are now suppressed while an offseason stage is under way.
> 5. **Step 3's grep list was incomplete.** `scripts/validate-simControlsOffseasonGuard.js`
>    *calls* `runMultiSeason`; the listed pattern would have found it but the
>    step only expected comments. It has been rewritten against `runAdvance` —
>    the regression it guards is the behaviour, not the old function name.
> 6. **The dock was rewired now rather than in Task 7.** Deleting the handlers
>    while `renderSimControls` still referenced them would have left this commit
>    broken. The existing buttons keep their labels and route through
>    `runAdvance`; the primary button becomes Stop mid-run. Task 7 still owns
>    replacing the dock with the three controls.
>
> **Two bugs found while verifying, both fixed here:**
>
> - **`ultra` speed never worked.** Every call site read
>   `SIM_SPEED_DELAYS_MS[speed] || SIM_SPEED_DELAYS_MS.normal`, and `ultra` is
>   `0`, so `0 || 200` silently ran the fastest setting at normal speed — and
>   always had. Replaced with an explicit `simSpeedDelayMs()` lookup.
> - **A zero-delay yield via `setTimeout` is clamped in a hidden tab.** Measured
>   in a backgrounded tab: 749ms per yield against 5.4ms to simulate a day, so a
>   run slowed ~150x the moment the user switched tabs — while the design
>   promises a run continues when they navigate away. `yieldToBrowser` now uses
>   a `MessageChannel` round-trip for the zero case: still a real macrotask, so
>   Stop lands between iterations, but not a timer (measured 0.016ms in that
>   same hidden tab). End to end this took a 40-day advance from ~40s to 221ms.

**Files:**
- Modify: `ui/simControls.js`

**Interfaces:**
- Consumes: `evaluateStop`, `STOP_REASONS` (Task 3); `runOffseasonRollover` (Task 1).
- Produces:
  - `runAdvance(options) → Promise<{ reason, label }>` where `options` is `{ target }` (`null` for Continue).
  - `requestAdvanceStop()` — sets the flag the loop checks each iteration.
  - `isAdvanceRunning() → boolean`.

- [x] **Step 1: Write `runAdvance`**

Add to `ui/simControls.js`, replacing `runWithDelay`:

```js
// The single advance loop. Replaces runWithDelay (one step) and
// runMultiSeason (season-granular), which had different stopping rules —
// which is why the ten dock controls behaved inconsistently.
//
// Each iteration: evaluate stop BEFORE stepping, step once, yield. Checking
// before the step is what leaves the next day unplayed, which is what makes
// "stop and watch that game" possible at all.
let _advanceStopRequested = false;
let _advanceRunning = false;

function requestAdvanceStop() { _advanceStopRequested = true; }
function isAdvanceRunning() { return _advanceRunning; }

// Advances exactly one unit: a day in the regular season, a game in the
// playoffs. Returns false when there is nothing left to step.
function stepOnce() {
  if (GameState.playoffBracket) {
    return simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng) !== null;
  }
  const lastDay = GameState.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  if (GameState.season.currentDay >= lastDay) {
    // Regular season is over: generate the bracket so the next iteration
    // steps playoff games. evaluateStop reports seasonComplete first, so the
    // user gets a stop here unless they asked to continue past it.
    if (!GameState.playoffBracket && isRegularSeasonComplete(GameState.season)) {
      GameState.playoffBracket = generateBracket(GameState.rng, GameState.settings);
    }
    return !!GameState.playoffBracket;
  }
  GameState.season.currentDay = simulateNextDay(
    GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng, handleDayComplete);
  return true;
}

async function runAdvance(options) {
  const opts = options || {};
  const container = document.getElementById('sim-controls');
  const statusEl = document.getElementById('sim-status');
  _advanceStopRequested = false;
  _advanceRunning = true;
  GameState.pauseRequested = false;
  GameState.pauseReason = null;

  const delayMs = SIM_SPEED_DELAYS_MS[GameState.settings.simSpeed] || SIM_SPEED_DELAYS_MS.normal;
  let stop = null;

  renderSimControls(container);   // flips Continue to Stop

  // Hard cap: a season is ~170 days and a bracket ~105 games, so 20000
  // iterations is far beyond any legitimate run. It exists only so a state
  // this loop cannot advance spins for a moment instead of forever.
  let guard = 0;
  while (guard++ < 20000) {
    stop = evaluateStop(GameState, GameState.season.currentDay, {
      target: opts.target || null,
      userStopRequested: _advanceStopRequested
    });
    if (stop) break;

    // A throw inside a step must halt the loop and say so. Without this the
    // guard below is the only thing between a broken step and 20000 attempts
    // at it, each one re-throwing.
    let advanced;
    try {
      advanced = stepOnce();
    } catch (e) {
      stop = { reason: STOP_REASONS.USER_STOP, label: 'Simulation error: ' + e.message };
      break;
    }
    if (!advanced) { stop = { reason: STOP_REASONS.SEASON_COMPLETE, label: 'Nothing left to simulate' }; break; }

    if (statusEl) statusEl.textContent = 'Simulating...';
    // ALWAYS yield, including at ultra speed where delayMs is 0. The old
    // loops skipped the await entirely at ultra, which froze the tab and made
    // the run impossible to interrupt.
    await delay(delayMs);
  }

  _advanceRunning = false;
  _advanceStopRequested = false;
  if (statusEl) statusEl.textContent = stop && stop.reason !== STOP_REASONS.USER_STOP ? stop.label : '';
  renderView(GameState.currentView);
  autosave(GameState);
  return stop || { reason: STOP_REASONS.USER_STOP, label: 'Stopped' };
}
```

- [x] **Step 2: Add the two handlers that survive, then delete the rest**

`handleNextGame`, `handleNextDay`, `handleSimToEnd`, `handleSimToTradeDeadline`, `handleSimToDraft`, `handleSimToFreeAgency` and `runMultiSeason` all disappear — their buttons are gone in Task 7 and `runAdvance` covers every intent they expressed. `handleWatchNextGame` and `handleWatchNextPlayoffGame` stay untouched: they are the watch path, not the advance path.

Add in their place:

```js
function advanceTargetForDay(day) {
  return { kind: 'day', day: day, label: 'day ' + day };
}

async function handleContinue() {
  if (isAdvanceRunning()) { requestAdvanceStop(); return; }
  await runAdvance({ target: null });
}

async function handleSkipTo(kind, quantity) {
  const lastDay = GameState.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  if (kind === 'deadline') {
    return runAdvance({ target: advanceTargetForDay(Math.min(lastDay, Math.round(lastDay * 0.65))) });
  }
  if (kind === 'days') {
    return runAdvance({ target: advanceTargetForDay(Math.min(lastDay, GameState.season.currentDay + quantity)) });
  }
  // seasonEnd, playoffsEnd, draft, freeAgency, seasons and championship all
  // run until evaluateStop reports their boundary; Continue's own stop rules
  // already cover them, so they need no extra target.
  return runAdvance({ target: null });
}
```

Then delete `runWithDelay`, `runMultiSeason`, `runRegularSeasonAndPlayoffsToCompletion`, `handleNextGame`, `handleNextDay`, `handleSimToEnd`, `handleSimToTradeDeadline`, `handleSimToDraft` and `handleSimToFreeAgency`.

Two things to preserve while deleting, both of which live only in the code being removed:

- `handleSimToEnd` calls `handlePlayerCareerPlayoffIntro()` when a bracket first appears. Move that into `stepOnce`, right after `generateBracket`, so career mode still gets its playoff scene.
- `handleSimToFreeAgency` runs `runFreeAgencySilently` + `autoEnforceRosterSize` when `autoFreeAgency` is on. `runOffseasonRollover` already does both, so this needs no replacement — confirm by reading it rather than assuming.

- [x] **Step 3: Verify nothing still references the deleted functions**

Run: `grep -rn "runWithDelay\|runMultiSeason\|runRegularSeasonAndPlayoffsToCompletion" --include=*.js .`
Expected: no output.

Run: `node --check ui/simControls.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: no `--check` output, `done` with no `FAIL:` lines.

- [x] **Step 4: Verify interruption in the browser**

Run: `python scripts/devserver.py 8224`

At `http://localhost:8224`, new game, set speed to **ultra**, then in the console:

```js
handleContinue();
setTimeout(() => requestAdvanceStop(), 500);
setTimeout(() => console.log('day', GameState.season.currentDay, 'running', isAdvanceRunning()), 1500);
```
Expected: `running false`, and a `currentDay` well short of the season end. Under the old loop ultra speed never yielded, so this is the specific regression to prove gone.

- [x] **Step 5: Commit**

```bash
git add ui/simControls.js
git commit -m "feat: one interruptible day-granular advance loop"
```

---

## Task 7: The dock — Continue, Watch, Skip to…

> **Deviations (executed).** Removing the ten controls turned out to expose
> three ways the offseason could strand a player, none of them in the plan.
>
> 1. **The three ceremonial offseason buttons had to go too.** The spec says
>    Continue absorbs "Advance to Offseason", "Go to Free Agency" and "Start
>    New Season"; the plan never said to delete them, and leaving them would
>    have duplicated the new path. Removing them is what surfaced (2) and (3).
> 2. **A manual drafter was stranded at a finished draft.** handleUserDraftPick
>    clears `draftSession` but leaves `offseasonStage` at `'draft'`, and the
>    button that used to move it on was the one just deleted. `draftReady` now
>    requires a live `draftSession`; free agency, which has no "done" signal at
>    all, gets `ctx.crossStage` — Continue pressed while already viewing free
>    agency means "I'm finished signing". Both are tested.
> 3. **Continue auto-drafted for everyone.** `stepOnce`'s rollover passed
>    `stopAfterDraft` but not `onDraft`, so it always resolved the draft
>    itself — `draftReady` then had nothing to stop for and a manual drafter
>    never saw their own draft. The interactive draft is now
>    `runInteractiveDraft` in `script.js`, passed by BOTH callers.
> 4. **`continueLabel` as drafted was wrong in four states.** It reported
>    `Continue → Playoffs` for a finished postseason (the next step is the
>    whole offseason), and ignored automation entirely — with autoDraft off
>    Continue opens the draft rather than crossing it, so the drafted label
>    promised something the click would not do. Every branch now matches what
>    `handleContinue` actually does.
> 5. **Two stale references the plan's greps did not cover.** The keyboard
>    shortcuts `n` and `g` in `script.js` pointed at `#sim-next-day` and
>    `#sim-next-game`, and `ui/playerDashboard.js`'s `simulateSeason()` clicked
>    `#sim-to-end` — all three deleted, all three failing silently. The
>    shortcuts now drive Continue and Watch; `simulateSeason` calls
>    `handleSkipTo` directly instead of reaching into the dock for a button,
>    which is the second time that coupling has broken it.
>
> **The status line never worked at all.** `runAdvance` captured `#sim-status`
> once, but that element lives inside the dock's `innerHTML`, so the first
> `renderSimControls` detached it and every later write landed on a node that
> was not on the page — and the closing `renderView` wiped the final label
> anyway. The spec's `Stopped: Jayson Tatum injured` line could never have
> appeared. Replaced with `setSimStatus()`, which re-queries, and the closing
> write moved after the render. The same latent bug was silently swallowing
> "No remaining games for your team to watch." and "Game could not be watched
> — simmed normally." in the two watch paths; both are fixed here.

**Files:**
- Modify: `ui/simControls.js` (`renderSimControls`)
- Modify: `style.css`

- [x] **Step 1: Replace the ten controls**

In `renderSimControls`, replace the markup for `sim-next-game`, `sim-next-day`, `sim-to-end`, `sim-to-deadline`, `sim-to-draft`, `sim-to-fa`, `sim-n-seasons`, `sim-n-seasons-btn`, `sim-until-championship`, `sim-n-days`, `sim-n-days-btn` with:

```js
      // Ten time controls became three. The player used to have to decide HOW
      // FAR to skip before every advance, which is itself a micro-decision
      // repeated constantly; Continue asks nothing and stops when something
      // actually needs them.
      '<button id="sim-continue" class="btn-primary">' + continueLabel() + '</button>' +
      '<button id="sim-watch-game">Watch Next Game</button>' +
      '<select id="sim-skip-to"' + skipDisabled + '>' +
        '<option value="">Skip to…</option>' +
        '<option value="deadline">Trade Deadline</option>' +
        '<option value="draft">Draft</option>' +
        '<option value="freeAgency">Free Agency</option>' +
        '<option value="seasonEnd">End of Regular Season</option>' +
        '<option value="playoffsEnd">End of Playoffs</option>' +
        '<option value="championship">Until Title</option>' +
        '<option value="seasons">Seasons…</option>' +
        '<option value="days">Days…</option>' +
      '</select>' +
      '<input type="number" id="sim-skip-qty" value="1" min="1" max="15" hidden>' +
      '<button id="sim-skip-go"' + skipDisabled + '>Go</button>' +
```

Keep `sim-undo-btn`, `sim-redo-btn`, `sim-speed` and `sim-status` exactly as they are — they are not time controls.

- [x] **Step 2: Add the stage-aware label**

```js
// Continue states where it is going, so the three ceremonial offseason
// clicks (Advance to Offseason -> Go to Free Agency -> Start New Season)
// stop being separate buttons.
function continueLabel() {
  if (isAdvanceRunning()) return 'Stop';
  if (GameState.offseasonStage === 'draft') return 'Continue → Free Agency';
  if (GameState.offseasonStage === 'freeagency') return 'Continue → Next Season';
  if (GameState.playoffBracket) return 'Continue → Playoffs';
  if (isRegularSeasonComplete(GameState.season)) return 'Continue → Playoffs';
  return 'Continue';
}
```

- [x] **Step 3: Wire the handlers**

Replace the corresponding `addEventListener` calls with:

```js
  document.getElementById('sim-continue').addEventListener('click', handleContinue);
  document.getElementById('sim-watch-game').addEventListener('click', handleWatchNextGame);
  document.getElementById('sim-skip-to').addEventListener('change', function (e) {
    const needsQty = e.target.value === 'seasons' || e.target.value === 'days';
    document.getElementById('sim-skip-qty').hidden = !needsQty;
  });
  document.getElementById('sim-skip-go').addEventListener('click', function () {
    const kind = document.getElementById('sim-skip-to').value;
    if (!kind) return;
    const qty = Number(document.getElementById('sim-skip-qty').value) || 1;
    handleSkipTo(kind, qty);
  });
```

Delete the listeners for every removed control.

- [x] **Step 4: Disable Continue while a live game is pending**

Immediately after the listeners:

```js
  // The dock stays visible during a watched game, so without this Continue
  // would sim days out from under a game still on screen.
  if (typeof isLiveWatchPending === 'function' && isLiveWatchPending()) {
    document.getElementById('sim-continue').disabled = true;
    document.getElementById('sim-skip-go').disabled = true;
  }

  // Nothing left to watch: during the offseason, and once the user's team is
  // eliminated or the season is over. A button that opens an empty view is
  // worse than one that is visibly unavailable.
  const noGameToWatch = !!GameState.offseasonStage ||
    (!GameState.playoffBracket &&
      getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay) === null);
  if (noGameToWatch) document.getElementById('sim-watch-game').disabled = true;
```

And in `ui/pixelGameView.js`, export the predicate next to `finishPendingPixelGame`:

```js
function isLiveWatchPending() { return _pendingLiveRunOut !== null; }
```

Add it to that file's `module.exports` alongside `finishPendingPixelGame`.

- [x] **Step 5: Style the dock**

Append to `style.css`:

```css
/* Continue is the dock's one primary action; the rest are secondary. */
#sim-continue { padding: 8px 20px; font-weight: 700; min-width: 150px; }
#sim-skip-qty { width: 58px; }
#sim-skip-qty[hidden] { display: none; }
```

- [x] **Step 6: Verify in the browser**

Run: `python scripts/devserver.py 8225`

At `http://localhost:8225`:
1. New game. Count time controls in the dock: exactly **Continue**, **Watch Next Game**, **Skip to…** + **Go**. Undo/Redo/speed still present.
2. Click **Continue** — it becomes **Stop**, days advance, the status line updates. Click **Stop** — it halts.
3. `Skip to… → Seasons…` reveals the quantity input; other options hide it.
4. Sim to the end of a season and confirm Continue reads `Continue → Playoffs`, then `Continue → Offseason`-style labels through the offseason.
5. Start a watched game, then confirm Continue and Go are disabled while it is on screen.
6. Console shows zero errors throughout.

- [x] **Step 7: Commit**

```bash
git add ui/simControls.js ui/pixelGameView.js style.css
git commit -m "feat: dock reduced to Continue, Watch and Skip to"
```

---

## Task 8: Smoke coverage and whole-plan verification

> **Deviations (executed).**
>
> 1. **Extra dock checks.** Beyond the planned six: the Go button is reachable,
>    the quantity input stays hidden unless Seasons/Days is selected, the three
>    ceremonial offseason buttons are gone, a disabled Continue always explains
>    itself, and — most valuable — `dock:status-line-receives-writes`. That last
>    one guards the exact bug Task 7 found: `#sim-status` lives inside the dock's
>    `innerHTML`, so a reference held across a re-render points at a detached
>    node and every write silently vanishes. It went unnoticed for the whole
>    project because nothing asserted the write landed.
> 2. **The checks were mutation-tested.** Reintroducing a retired control,
>    holding a stale `#sim-status` reference, and covering Continue with an
>    overlay each failed exactly one check and only that one. Assertions that
>    cannot fail have cost this project real time before.
> 3. **Step 2's "zero failures across every group" was not achievable.** The
>    `live` group asserts on the pixel view's controls, so a full run always
>    reported eight failures that only meant "wrong view" — and a suite that
>    always shows failures teaches you to stop reading them. It now reports a
>    single skip when not watching, and `UI_SMOKE.run()` is 100/0. Verified the
>    skip hides nothing: with a game open the group still runs 22/22.
> 4. **Continue was inert on the draft view.** Verification (not the plan) found
>    it: standing on a draft that is waiting, Continue restated "Draft is ready"
>    and did nothing, because the pick is genuinely the user's. It now reads
>    **Your pick** and is disabled, re-enabling the moment the board is
>    exhausted — which is what carries them on to free agency.
> 5. **Four stale comments** in `save.js` and `script.js` still described
>    `runMultiSeason` as a live code path. A future reader would grep for a
>    function that no longer exists; they now name `seasonRollover.js` and
>    `runAdvance`.

**Files:**
- Modify: `scripts/ui-smoke.js`

- [x] **Step 1: Add a `dock` group**

Following the file's rule — assert what is VISIBLE AND REACHABLE, not merely present — add:

```js
  // The dock's whole point is that there is one primary action. A regression
  // here means the ten controls crept back, or Continue became unreachable.
  function checkDock() {
    const results = [];
    const dock = document.getElementById('sim-controls');

    const cont = dock.querySelector('#sim-continue');
    results.push(ok('dock:continue-reachable', isHitTestable(cont)));
    results.push(ok('dock:continue-labelled', !!cont && /Continue|Stop/.test(cont.textContent),
      cont ? cont.textContent : null));

    const watch = dock.querySelector('#sim-watch-game');
    results.push(ok('dock:watch-reachable', isHitTestable(watch)));

    const skip = dock.querySelector('#sim-skip-to');
    results.push(ok('dock:skip-menu-reachable', isHitTestable(skip)));

    // The ten controls this replaced must be gone, not hidden.
    const retired = ['sim-next-game', 'sim-next-day', 'sim-to-end', 'sim-to-deadline',
      'sim-to-draft', 'sim-to-fa', 'sim-n-seasons-btn', 'sim-until-championship', 'sim-n-days-btn'];
    const survivors = retired.filter(function (id) { return !!document.getElementById(id); });
    results.push(ok('dock:old-controls-removed', survivors.length === 0, survivors.join(', ') || null));

    // Undo/Redo and speed are not time controls and must survive.
    results.push(ok('dock:undo-still-present', !!document.getElementById('sim-undo-btn')));
    results.push(ok('dock:speed-still-present', !!document.getElementById('sim-speed')));

    return results;
  }
```

Register it in the `GROUPS` object literal:

```js
    boxscore: checkScheduleBoxScore,
    dock: checkDock,
    live: checkLiveControls
```

- [x] **Step 2: Run the smoke suite**

Run: `python scripts/devserver.py 8226`, then from the console after starting a game:

```js
UI_SMOKE.run('dock')
```
Expected: all checks pass.

Then `UI_SMOKE.run()` from a non-watch view.
Expected: zero failures across every group.

- [x] **Step 3: Whole-plan verification**

- [x] `for f in scripts/validate-*.js; do node "$f" || echo "FAIL: $f"; done` reports no failures.
- [x] `git diff c9c5231 --stat -- scripts/fixtures/gamesim-golden.json` prints nothing — the possession engine is untouched by this project.
- [x] `node scripts/validate-seasonRollover.js` passes, including `checkRolloverMatchesGolden`.
- [x] `grep -rn "runWithDelay\|runMultiSeason" --include=*.js .` returns nothing.
- [x] Ultra-speed runs are interruptible (Task 6, Step 4).
- [x] A full season can be played using only Continue, Watch Next Game and Skip to….
- [x] Continue is disabled while a live watched game is on screen.
- [x] Zero console errors across the full browser pass.

- [x] **Step 4: Commit**

```bash
git add scripts/ui-smoke.js
git commit -m "test: smoke coverage for the reduced dock"
```

---

## Out of scope

- The wider UI simplification (25-item sidebar, dense topbar, app chrome visible during a watched game). Parked at the owner's request.
- `autoCoaching` — the one chore with no opt-out, noted in the feature scan.
- Serialising an in-progress watched game so it can be suspended and resumed.
- Any change to Undo/Redo.
