# Live Game Sim — Engine Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the possession engine into a steppable state machine with a real on-court five, rotations, a game clock, overtime, and a shared auto-coach — then make it the league default.

**Architecture:** `createGameSim()` returns an object whose `step()` advances exactly one possession. `simulatePossessionGame()` becomes `while (!sim.done) sim.step()`, so batch and (later) live-stepped games run identical math through one code path. A new `coach.js` supplies substitution and timeout decisions for every team in every game.

**Tech Stack:** Vanilla ES5-style JavaScript, no dependencies. Dual module pattern (`require` in Node, globals in browser) as used throughout this repo. Tests are plain Node scripts under `scripts/` using `assert`, run individually.

## Scope

This plan implements **Stages 1–3** of `docs/superpowers/specs/2026-08-06-live-game-sim-tier0-design.md`, all of which are verifiable in Node with no browser.

**Stage 4** (user-facing timeouts/substitutions, nudges, incremental playback, `pixelGameView.js` split) is deliberately **not** in this plan. It depends on the interfaces produced here and requires browser verification. It gets its own plan after this one lands.

## Global Constraints

- No new third-party dependencies. This project is zero-dependency by design.
- Every new module uses the repo's dual require/global pattern (see the `_POSS_DATA` block at the top of `simEnginePossession.js` for the exact shape).
- Browser files must be added to BOTH `index.html` and `simWorker.js`'s `importScripts` list, in dependency order.
- Existing `scripts/validate-*.js` tests must pass at every commit unless a task explicitly changes one, and any such change must be justified in that task.
- Sim results must stay deterministic: same seed + same decisions ⇒ identical result.
- Regulation is 4 × 12 minutes. Overtime periods are 5 minutes.
- Timeouts: 7 per team per game, +0.12 energy (capped at 1.0) to on-court players, clears the opponent's run counter, consumes no game clock.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `simEnginePossession.js` | modify | Possession-level math only: shot selection, make probability, rebounds, fouls. Exports helpers. |
| `gameSim.js` | create (Task 4) | Game-level state machine: clock, periods, on-court five, rotations, overtime, `simulatePossessionGame`, engine registration. |
| `coach.js` | create (Task 8) | Pure decision functions: `decideSubstitutions`, `decideTimeout`. No state of its own. |
| `simEngine.js` | modify (Task 10) | Default engine becomes `possession`. |
| `index.html` | modify (Task 4) | Load `gameSim.js` after `simEnginePossession.js`; `coach.js` before both. |
| `simWorker.js` | modify (Task 4, 8) | Same additions to `importScripts`. |
| `scripts/gen-gamesim-golden.js` | create (Task 1) | One-shot generator for the characterization fixture. |
| `scripts/fixtures/gamesim-golden.json` | create (Task 1) | Golden-master outputs of the pre-refactor engine. |
| `scripts/validate-gamesim.js` | create (Task 1) | Characterization + state-machine tests. |
| `scripts/validate-possession.js` | modify (Task 5, 6) | Minutes and possession-count assertions updated for emergent minutes. |
| `scripts/validate-coach.js` | create (Task 8) | Coach decision tests. |

---

## Stage 1 — GameSim state machine (no behaviour change)

### Task 1: Golden-master characterization test

Refactoring a stochastic engine without a characterization test is unverifiable. This task locks the current behaviour into a fixture **before** anything changes, so Tasks 2–3 can prove they changed nothing.

**Files:**
- Create: `scripts/gen-gamesim-golden.js`
- Create: `scripts/fixtures/gamesim-golden.json` (generated)
- Create: `scripts/validate-gamesim.js`

**Interfaces:**
- Consumes: `simEnginePossession.js`'s current `simulateGame(homeTeamId, awayTeamId, rng, options)`.
- Produces: `scripts/fixtures/gamesim-golden.json`, an array of `{ seed, home, away, homeScore, awayScore, boxChecksum }`; and `scripts/validate-gamesim.js`, which later tasks extend.

- [ ] **Step 1: Write the generator**

Create `scripts/gen-gamesim-golden.js`:

```js
// One-shot generator for the pre-refactor characterization fixture used by
// scripts/validate-gamesim.js. Run this ONCE, before the GameSim refactor,
// and commit the JSON it writes. Re-running it after a deliberate behaviour
// change is how the fixture gets updated (and that must be justified in the
// commit that does it).
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
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));

// A stable digest of every stat line, so the fixture catches distribution
// changes and not just the final score.
function boxChecksum(boxScore) {
  const keys = Object.keys(boxScore).sort();
  let sum = 0;
  keys.forEach(function (id, idx) {
    const line = boxScore[id];
    ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
     'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fouls'].forEach(function (k, ki) {
      sum = (sum + (line[k] || 0) * (idx + 1) * (ki + 3)) % 2147483647;
    });
  });
  return sum;
}

const CASES = [
  { seed: 1, home: 'BOS', away: 'LAL' },
  { seed: 2, home: 'DEN', away: 'MIA' },
  { seed: 3, home: 'OKC', away: 'NYK' },
  { seed: 4, home: 'MIL', away: 'PHI' },
  { seed: 5, home: 'GSW', away: 'DAL' },
  { seed: 6, home: 'CLE', away: 'MEM' },
  { seed: 7, home: 'SAS', away: 'HOU' },
  { seed: 8, home: 'ORL', away: 'IND' }
];

const out = CASES.map(function (c) {
  const result = possEngine.simulateGame(c.home, c.away, makeRng(c.seed));
  return {
    seed: c.seed, home: c.home, away: c.away,
    homeScore: result.homeScore, awayScore: result.awayScore,
    boxChecksum: boxChecksum(result.boxScore),
    playByPlayLength: result.playByPlay.length
  };
});

const dir = path.join(__dirname, 'fixtures');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'gamesim-golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + out.length + ' golden cases');
```

- [ ] **Step 2: Generate and inspect the fixture**

Run: `node scripts/gen-gamesim-golden.js`
Expected: `wrote 8 golden cases`, and `scripts/fixtures/gamesim-golden.json` exists with 8 entries, each having non-zero `homeScore` and `awayScore` in the 60–170 range.

- [ ] **Step 3: Write the characterization test**

Create `scripts/validate-gamesim.js`:

```js
const assert = require('assert');
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
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const golden = require(path.join(__dirname, 'fixtures', 'gamesim-golden.json'));

function boxChecksum(boxScore) {
  const keys = Object.keys(boxScore).sort();
  let sum = 0;
  keys.forEach(function (id, idx) {
    const line = boxScore[id];
    ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
     'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fouls'].forEach(function (k, ki) {
      sum = (sum + (line[k] || 0) * (idx + 1) * (ki + 3)) % 2147483647;
    });
  });
  return sum;
}

// The whole point of Stage 1: the refactor must not move a single number.
function checkGoldenMaster() {
  golden.forEach(function (g) {
    const result = possEngine.simulateGame(g.home, g.away, makeRng(g.seed));
    assert.strictEqual(result.homeScore, g.homeScore,
      'seed ' + g.seed + ' home score drifted: ' + result.homeScore + ' vs golden ' + g.homeScore);
    assert.strictEqual(result.awayScore, g.awayScore,
      'seed ' + g.seed + ' away score drifted: ' + result.awayScore + ' vs golden ' + g.awayScore);
    assert.strictEqual(boxChecksum(result.boxScore), g.boxChecksum,
      'seed ' + g.seed + ' box score distribution drifted');
    assert.strictEqual(result.playByPlay.length, g.playByPlayLength,
      'seed ' + g.seed + ' play-by-play length drifted');
  });
  console.log('checkGoldenMaster: OK (' + golden.length + ' cases)');
}
checkGoldenMaster();

console.log('All game sim validations passed');
```

- [ ] **Step 4: Run the test against unchanged code**

Run: `node scripts/validate-gamesim.js`
Expected: `checkGoldenMaster: OK (8 cases)` then `All game sim validations passed`. It must pass now — it is describing code that has not changed yet.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-gamesim-golden.js scripts/fixtures/gamesim-golden.json scripts/validate-gamesim.js
git commit -m "test: characterization fixture for the possession engine before GameSim refactor"
```

---

### Task 2: Extract `createGameSim` and reimplement the batch path as a loop

**Files:**
- Modify: `simEnginePossession.js:279-335` (replace `simulatePossessionGame`)

**Interfaces:**
- Consumes: existing module-private `simulatePossession`, `eligibleRoster`, `initBoxLine`, `simulateTeamMinutes`, `POSSESSIONS_PER_TEAM`, and `_POSS_DATA.composite.computeTeamSynergy`.
- Produces:
  - `createGameSim(homeTeamId, awayTeamId, rng, options) → sim`
  - `sim.step()` — advances one possession pair (home then away), returns `undefined`
  - `sim.done` — boolean getter
  - `sim.result()` — `{ homeScore, awayScore, boxScore, playByPlay }`
  - Exported as `createGameSim` from `simEnginePossession.js`.

Stage 1 keeps everything in `simEnginePossession.js` deliberately: with no import churn, the existing test suite passing **unmodified** is itself the proof that behaviour did not change. The file is extracted to `gameSim.js` in Task 4, once that proof exists.

`step()` advances a possession **pair** in this task, exactly matching the current loop body, so the RNG consumption order is byte-identical. Task 6 splits it into single possessions once the clock exists.

- [ ] **Step 1: Replace `simulatePossessionGame` with the state machine**

In `simEnginePossession.js`, replace the whole `simulatePossessionGame` function (currently lines 279–335) with:

```js
// The game-level state machine. step() advances exactly one possession pair
// (home, then away) — the same unit the old for-loop body covered, so RNG
// consumption order is unchanged. simulatePossessionGame below is now just a
// loop over it, which means batch sims and (later) live-stepped watched games
// run through ONE code path and cannot drift apart.
function createGameSim(homeTeamId, awayTeamId, rng, options) {
  const homeRoster = eligibleRoster(homeTeamId);
  const awayRoster = eligibleRoster(awayTeamId);

  // teamId stamps which side each line belongs to — see simEngineBoxScore.js's
  // comment for why the player's current teamId isn't good enough.
  const homeBox = {};
  homeRoster.forEach(function (p) { homeBox[p.id] = Object.assign(initBoxLine(), { teamId: homeTeamId }); });
  const awayBox = {};
  awayRoster.forEach(function (p) { awayBox[p.id] = Object.assign(initBoxLine(), { teamId: awayTeamId }); });

  const homeMinutes = simulateTeamMinutes(homeRoster);
  const awayMinutes = simulateTeamMinutes(awayRoster);
  homeRoster.forEach(function (p) { homeBox[p.id].minutes = homeMinutes[p.id]; });
  awayRoster.forEach(function (p) { awayBox[p.id].minutes = awayMinutes[p.id]; });

  // Synergy depends only on roster composition, not anything that changes
  // possession-to-possession, so it's computed once per game.
  const homeSynergy = _POSS_DATA.composite.computeTeamSynergy(homeRoster);
  const awaySynergy = _POSS_DATA.composite.computeTeamSynergy(awayRoster);

  const playByPlay = [];
  const POSSESSIONS_PER_QUARTER = Math.ceil(POSSESSIONS_PER_TEAM / 4);
  const captureEvents = options && options.events ? options.events : null;

  const sim = {
    homeTeamId: homeTeamId,
    awayTeamId: awayTeamId,
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    homeBox: homeBox,
    awayBox: awayBox,
    homeScore: 0,
    awayScore: 0,
    possessionIndex: 0,
    quarter: 1,
    done: false,
    playByPlay: playByPlay
  };

  sim.step = function () {
    if (sim.done) return;
    const i = sim.possessionIndex;
    const quarter = Math.floor(i / POSSESSIONS_PER_QUARTER) + 1;
    sim.quarter = quarter;
    if (i % POSSESSIONS_PER_QUARTER === 0) {
      playByPlay.push('--- Q' + quarter + ' ---');
    }
    const homeCtx = captureEvents ? { events: captureEvents, team: 'home', quarter: quarter } : null;
    const awayCtx = captureEvents ? { events: captureEvents, team: 'away', quarter: quarter } : null;
    sim.homeScore += simulatePossession(homeRoster, homeBox, awayRoster, awayBox, rng, { offense: homeSynergy, defense: awaySynergy }, playByPlay, homeCtx);
    sim.awayScore += simulatePossession(awayRoster, awayBox, homeRoster, homeBox, rng, { offense: awaySynergy, defense: homeSynergy }, playByPlay, awayCtx);

    sim.possessionIndex += 1;
    if (sim.possessionIndex >= POSSESSIONS_PER_TEAM) {
      resolveTie();
      sim.done = true;
    }
  };

  function resolveTie() {
    if (sim.homeScore !== sim.awayScore) return;
    // NBA games can't end in a tie — nudge whichever team had more makes.
    // (Task 7 replaces this with real overtime.)
    const homeMakes = Object.keys(homeBox).reduce(function (s, id) { return s + homeBox[id].fgm; }, 0);
    const awayMakes = Object.keys(awayBox).reduce(function (s, id) { return s + awayBox[id].fgm; }, 0);
    if (homeMakes >= awayMakes) {
      homeBox[homeRoster[0].id].points += 1; sim.homeScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'home', quarter: 4, playerId: homeRoster[0].id, points: 1 });
    } else {
      awayBox[awayRoster[0].id].points += 1; sim.awayScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'away', quarter: 4, playerId: awayRoster[0].id, points: 1 });
    }
  }

  sim.result = function () {
    return {
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
      boxScore: Object.assign({}, homeBox, awayBox),
      playByPlay: playByPlay
    };
  };

  return sim;
}

// Named distinctly from simEngineBoxScore.js's own simulateGame — see that
// file's comment on this same function name for why. Play-by-play is always
// generated (the string-building cost is negligible next to the possession
// math that already runs regardless) rather than gated behind a flag —
// storage is what's expensive, and that's pruned at save time the same way
// save.js already prunes box scores down to just the user's own games.
function simulatePossessionGame(homeTeamId, awayTeamId, rng, options) {
  const sim = createGameSim(homeTeamId, awayTeamId, rng, options);
  while (!sim.done) sim.step();
  return sim.result();
}
```

- [ ] **Step 2: Export `createGameSim`**

In `simEnginePossession.js`, change the `module.exports` block to add the new function:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
    weightedPick: weightedPick,
    pickShotZone: pickShotZone,
    shotMakeProbability: shotMakeProbability,
    simulatePossession: simulatePossession,
    createGameSim: createGameSim,
    simulateGame: simulatePossessionGame
  };
}
```

- [ ] **Step 3: Verify no behaviour changed**

Run: `node scripts/validate-gamesim.js`
Expected: `checkGoldenMaster: OK (8 cases)`. Any drift here means the refactor changed RNG consumption order — do not proceed past a failure.

- [ ] **Step 4: Verify the rest of the suite is untouched**

Run: `node scripts/validate-possession.js && node scripts/validate-pixel-events.js && node scripts/validate-sim.js`
Expected: all three print their `All ... validations passed` line, with no edits to any test file.

- [ ] **Step 5: Commit**

```bash
git add simEnginePossession.js
git commit -m "refactor: reimplement possession game as a steppable GameSim loop"
```

---

### Task 3: Prove manual stepping equals the batch loop

**Files:**
- Modify: `scripts/validate-gamesim.js`

**Interfaces:**
- Consumes: `createGameSim(homeTeamId, awayTeamId, rng, options)` from Task 2.
- Produces: no new production interface; this task adds the test that makes the state machine's contract explicit.

- [ ] **Step 1: Add the stepping-equivalence test**

In `scripts/validate-gamesim.js`, insert before the final `console.log`:

```js
// If a caller drives step() by hand, it must land on exactly the same game as
// the batch loop. This is the contract the live-stepped watch flow depends on.
function checkManualSteppingMatchesBatch() {
  const cases = [{ seed: 21, home: 'BOS', away: 'MIA' }, { seed: 34, home: 'DEN', away: 'GSW' }];
  cases.forEach(function (c) {
    const batch = possEngine.simulateGame(c.home, c.away, makeRng(c.seed));

    const sim = possEngine.createGameSim(c.home, c.away, makeRng(c.seed));
    let guard = 0;
    while (!sim.done) {
      sim.step();
      assert.ok(guard++ < 5000, 'step() must terminate');
    }
    const stepped = sim.result();

    assert.strictEqual(stepped.homeScore, batch.homeScore, 'stepped home score must equal batch');
    assert.strictEqual(stepped.awayScore, batch.awayScore, 'stepped away score must equal batch');
    assert.strictEqual(boxChecksum(stepped.boxScore), boxChecksum(batch.boxScore), 'stepped box score must equal batch');
    assert.deepStrictEqual(stepped.playByPlay, batch.playByPlay, 'stepped play-by-play must equal batch');
  });
  console.log('checkManualSteppingMatchesBatch: OK');
}
checkManualSteppingMatchesBatch();

// step() after completion must be a no-op, so an over-eager driver cannot
// corrupt a finished game.
function checkStepAfterDoneIsNoop() {
  const sim = possEngine.createGameSim('BOS', 'LAL', makeRng(77));
  while (!sim.done) sim.step();
  const before = sim.result();
  sim.step();
  sim.step();
  const after = sim.result();
  assert.strictEqual(after.homeScore, before.homeScore, 'score must not move after done');
  assert.strictEqual(after.awayScore, before.awayScore, 'score must not move after done');
  assert.strictEqual(after.playByPlay.length, before.playByPlay.length, 'play-by-play must not grow after done');
  console.log('checkStepAfterDoneIsNoop: OK');
}
checkStepAfterDoneIsNoop();
```

- [ ] **Step 2: Run the tests**

Run: `node scripts/validate-gamesim.js`
Expected: `checkGoldenMaster: OK (8 cases)`, `checkManualSteppingMatchesBatch: OK`, `checkStepAfterDoneIsNoop: OK`, `All game sim validations passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-gamesim.js
git commit -m "test: assert manual stepping matches the batch loop exactly"
```

---

## Stage 2 — Real basketball structure

### Task 4: Extract `gameSim.js`

Now that Stage 1 has proven the state machine is behaviour-identical, move it to its own module before it grows with rotations, a clock, and overtime. `simEnginePossession.js` keeps possession-level math; `gameSim.js` owns game-level state and the engine registration. No circular dependency, because `simEnginePossession.js` no longer references the game level at all.

**Files:**
- Modify: `simEnginePossession.js` (remove `createGameSim`, `simulatePossessionGame`, `registerEngine` call)
- Create: `gameSim.js`
- Modify: `index.html:45`
- Modify: `simWorker.js:16`
- Modify: `scripts/validate-possession.js:15`, `scripts/validate-gamesim.js`, `scripts/validate-pixel-events.js:15`, `scripts/validate-pixel-choreographer.js`

**Interfaces:**
- Consumes: `simEnginePossession.js` exports `simulatePossession`, `eligibleRoster`, `initBoxLine`, `simulateTeamMinutes`, `POSSESSIONS_PER_TEAM`.
- Produces: `gameSim.js` exporting `createGameSim(homeTeamId, awayTeamId, rng, options)` and `simulateGame(homeTeamId, awayTeamId, rng, options)`, and registering the `possession` engine.

- [ ] **Step 1: Widen `simEnginePossession.js`'s exports**

`gameSim.js` needs helpers that are currently module-private. In `simEnginePossession.js`, change `module.exports` to:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
    weightedPick: weightedPick,
    pickShotZone: pickShotZone,
    shotMakeProbability: shotMakeProbability,
    simulatePossession: simulatePossession,
    eligibleRoster: eligibleRoster,
    initBoxLine: initBoxLine,
    simulateTeamMinutes: simulateTeamMinutes,
    energyMultiplier: energyMultiplier
  };
}
```

- [ ] **Step 2: Create `gameSim.js`**

Create `gameSim.js` with the dual-module header this repo uses, containing the `createGameSim` and `simulatePossessionGame` bodies moved verbatim from `simEnginePossession.js`:

```js
// Game-level state machine for the possession engine. simEnginePossession.js
// owns what happens WITHIN a possession; this file owns everything about the
// game around it — score, periods, and (from Task 5 onward) the on-court five,
// the clock, and overtime. Split out once the state machine was proven
// behaviour-identical, so it had room to grow without turning
// simEnginePossession.js into a grab bag.
var _GAMESIM_DATA = (typeof require !== 'undefined')
  ? { poss: require('./simEnginePossession.js'), simEngine: require('./simEngine.js'), composite: require('./compositeRatings.js') }
  : {
      poss: {
        POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
        simulatePossession: simulatePossession,
        eligibleRoster: eligibleRoster,
        initBoxLine: initBoxLine,
        simulateTeamMinutes: simulateTeamMinutes
      },
      simEngine: { registerEngine: registerEngine },
      composite: { computeTeamSynergy: computeTeamSynergy }
    };

function createGameSim(homeTeamId, awayTeamId, rng, options) {
  // ... body moved verbatim from simEnginePossession.js, with these renames:
  //   eligibleRoster(...)          -> _GAMESIM_DATA.poss.eligibleRoster(...)
  //   initBoxLine()                -> _GAMESIM_DATA.poss.initBoxLine()
  //   simulateTeamMinutes(...)     -> _GAMESIM_DATA.poss.simulateTeamMinutes(...)
  //   simulatePossession(...)      -> _GAMESIM_DATA.poss.simulatePossession(...)
  //   POSSESSIONS_PER_TEAM         -> _GAMESIM_DATA.poss.POSSESSIONS_PER_TEAM
  //   _POSS_DATA.composite.computeTeamSynergy -> _GAMESIM_DATA.composite.computeTeamSynergy
}

function simulatePossessionGame(homeTeamId, awayTeamId, rng, options) {
  const sim = createGameSim(homeTeamId, awayTeamId, rng, options);
  while (!sim.done) sim.step();
  return sim.result();
}

_GAMESIM_DATA.simEngine.registerEngine('possession', { simulateGame: simulatePossessionGame });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGameSim: createGameSim,
    simulateGame: simulatePossessionGame
  };
}
```

Then delete `createGameSim`, `simulatePossessionGame`, and the `_POSS_DATA.simEngine.registerEngine('possession', ...)` line from `simEnginePossession.js`, and drop `simEngine` from its `_POSS_DATA` block since it no longer registers anything.

- [ ] **Step 3: Update browser and worker load order**

In `index.html`, after line 45 (`<script src="simEnginePossession.js"></script>`), add:

```html
  <script src="gameSim.js"></script>
```

In `simWorker.js` line 16, append `'gameSim.js'` to the end of the `importScripts` list:

```js
importScripts('data.js', 'rng.js', 'traits.js', 'compositeRatings.js', 'simEngine.js', 'simEngineBoxScore.js', 'simEnginePossession.js', 'gameSim.js');
```

- [ ] **Step 4: Update the test imports**

In each of `scripts/validate-possession.js`, `scripts/validate-gamesim.js`, `scripts/validate-pixel-events.js`, and `scripts/validate-pixel-choreographer.js`, keep the existing `simEnginePossession.js` require and add below it:

```js
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
```

Then replace every `possEngine.simulateGame(` call with `gameSim.simulateGame(`, and every `possEngine.createGameSim(` with `gameSim.createGameSim(`.

- [ ] **Step 5: Run the whole suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines. The golden master must still match — this task moved code, it did not change it.

- [ ] **Step 6: Commit**

```bash
git add simEnginePossession.js gameSim.js index.html simWorker.js scripts/
git commit -m "refactor: extract GameSim into gameSim.js ahead of rotations and clock work"
```

---

### Task 5: On-court five with rotations and emergent minutes

**Files:**
- Modify: `gameSim.js`
- Modify: `simEnginePossession.js` (delete `simulateTeamMinutes`)
- Modify: `scripts/validate-possession.js:53-54`
- Modify: `scripts/validate-gamesim.js`
- Modify: `scripts/gen-gamesim-golden.js` (regenerate fixture)

**Interfaces:**
- Consumes: `createGameSim` from Task 4.
- Produces: `sim.onCourt` — `{ home: [5 playerIds], away: [5 playerIds] }`; `sim.secondsPlayed` — `{ playerId: number }`; `sim.applySubstitutions(team, swaps)` where `swaps` is `[{ out: playerId, in: playerId }]`.

This is the first deliberate behaviour change, so the golden fixture is regenerated as part of it.

- [ ] **Step 1: Write the failing tests**

In `scripts/validate-gamesim.js`, add before the final `console.log`:

```js
// The engine must field five players a side, always — the old behaviour let
// every healthy player on the roster shoot on any possession.
function checkFivePlayersOnCourt() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(41));
  let guard = 0;
  // Math.min guards the degenerate case the spec calls out: a roster with
  // fewer than five healthy bodies fields everyone it has rather than
  // inventing players. Real rosters are 13-15, so this is 5 in practice.
  const homeFive = Math.min(5, sim.homeRoster.length);
  const awayFive = Math.min(5, sim.awayRoster.length);
  while (!sim.done) {
    assert.strictEqual(sim.onCourt.home.length, homeFive, 'home must field five');
    assert.strictEqual(sim.onCourt.away.length, awayFive, 'away must field five');
    assert.strictEqual(new Set(sim.onCourt.home).size, homeFive, 'no duplicate home players on court');
    assert.strictEqual(new Set(sim.onCourt.away).size, awayFive, 'no duplicate away players on court');
    sim.onCourt.home.forEach(function (id) {
      assert.ok(sim.homeBox[id], 'on-court home player must have a box line: ' + id);
    });
    sim.step();
    assert.ok(guard++ < 5000, 'step() must terminate');
  }
  console.log('checkFivePlayersOnCourt: OK');
}
checkFivePlayersOnCourt();

// Only players who were actually on the floor may accrue stats.
function checkBenchPlayersRecordNothing() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(42));
  const everOnCourt = {};
  while (!sim.done) {
    sim.onCourt.home.concat(sim.onCourt.away).forEach(function (id) { everOnCourt[id] = true; });
    sim.step();
  }
  const box = sim.result().boxScore;
  Object.keys(box).forEach(function (id) {
    if (everOnCourt[id]) return;
    const line = box[id];
    assert.strictEqual(line.minutes, 0, 'a player who never played must have 0 minutes: ' + id);
    assert.strictEqual(line.points, 0, 'a player who never played must have 0 points: ' + id);
    assert.strictEqual(line.fga, 0, 'a player who never played must have 0 attempts: ' + id);
  });
  console.log('checkBenchPlayersRecordNothing: OK');
}
checkBenchPlayersRecordNothing();

// Minutes are now measured, not distributed: five players on the floor for a
// 48-minute regulation game is 240 player-minutes, plus 25 per overtime.
function checkMinutesAreEmergent() {
  for (const seed of [43, 44, 45]) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    const box = sim.result().boxScore;
    let homeMin = 0, awayMin = 0;
    Object.keys(box).forEach(function (id) {
      if (box[id].teamId === 'BOS') homeMin += box[id].minutes;
      else awayMin += box[id].minutes;
    });
    // +-3 absorbs per-player rounding to whole minutes.
    assert.ok(Math.abs(homeMin - awayMin) <= 3, 'both teams play the same clock: ' + homeMin + ' vs ' + awayMin);
    assert.ok(homeMin >= 237 && homeMin <= 243, 'regulation home minutes should be ~240, got ' + homeMin);
  }
  console.log('checkMinutesAreEmergent: OK');
}
checkMinutesAreEmergent();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL at `checkFivePlayersOnCourt` with a message like `Cannot read properties of undefined (reading 'home')`, because `sim.onCourt` does not exist yet.

- [ ] **Step 3: Implement the on-court five and rotations**

In `gameSim.js`, inside `createGameSim`, after the box-score setup and before the synergy calculation, replace the `simulateTeamMinutes` block with:

```js
  // Starters are the five highest by the same weighting that used to decide
  // minutes, so "who plays most" is unchanged in spirit — it is now expressed
  // by actually being on the floor rather than by a post-hoc number.
  function pickStarters(roster) {
    return roster.slice()
      .sort(function (a, b) { return _GAMESIM_DATA.box.minutesWeight(b) - _GAMESIM_DATA.box.minutesWeight(a); })
      .slice(0, 5)
      .map(function (p) { return p.id; });
  }

  const secondsPlayed = {};
  homeRoster.concat(awayRoster).forEach(function (p) { secondsPlayed[p.id] = 0; });

  const onCourt = { home: pickStarters(homeRoster), away: pickStarters(awayRoster) };
  const byId = {};
  homeRoster.concat(awayRoster).forEach(function (p) { byId[p.id] = p; });

  function lineup(team) {
    return onCourt[team].map(function (id) { return byId[id]; });
  }
```

Add these to the `sim` object literal: `onCourt: onCourt`, `secondsPlayed: secondsPlayed`, `byId: byId`.

Change the two `simulatePossession` calls inside `sim.step()` to pass lineups instead of full rosters:

```js
    sim.homeScore += _GAMESIM_DATA.poss.simulatePossession(lineup('home'), homeBox, lineup('away'), awayBox, rng, { offense: homeSynergy, defense: awaySynergy }, playByPlay, homeCtx);
    sim.awayScore += _GAMESIM_DATA.poss.simulatePossession(lineup('away'), awayBox, lineup('home'), homeBox, rng, { offense: awaySynergy, defense: homeSynergy }, playByPlay, awayCtx);
```

At the end of `sim.step()`, before the completion check, accrue time and record minutes. Until Task 6 supplies a real clock, each possession pair is a fixed slice of the 2880-second regulation game:

```js
    // Until Task 6 introduces the clock, a possession pair is a fixed slice of
    // regulation: 2880 seconds over POSSESSIONS_PER_TEAM pairs.
    const pairSeconds = 2880 / _GAMESIM_DATA.poss.POSSESSIONS_PER_TEAM;
    onCourt.home.concat(onCourt.away).forEach(function (id) { secondsPlayed[id] += pairSeconds; });
```

Add the substitution entry point and wire minutes into `result()`:

```js
  sim.applySubstitutions = function (team, swaps) {
    if (!swaps || swaps.length === 0) return;
    swaps.forEach(function (swap) {
      const idx = onCourt[team].indexOf(swap.out);
      if (idx === -1) return;                                  // not on the floor
      if (onCourt[team].indexOf(swap.in) !== -1) return;       // already on the floor
      if (!byId[swap.in]) return;                              // not on this roster
      onCourt[team][idx] = swap.in;
    });
  };

  function writeMinutes() {
    Object.keys(secondsPlayed).forEach(function (id) {
      const line = homeBox[id] || awayBox[id];
      if (line) line.minutes = Math.round(secondsPlayed[id] / 60);
    });
  }
```

Call `writeMinutes()` at the top of `sim.result()`, and delete the `homeMinutes`/`awayMinutes` lines that used `simulateTeamMinutes`.

Add `box: require('./simEngineBoxScore.js')` to the Node branch of `_GAMESIM_DATA`, and `box: { minutesWeight: minutesWeight }` to the browser branch.

- [ ] **Step 4: Delete the dead minutes distributor**

Remove `simulateTeamMinutes` from `simEnginePossession.js` (currently lines 266–271) and from its `module.exports`, and remove `simulateTeamMinutes` from `gameSim.js`'s `_GAMESIM_DATA.poss` browser branch. It has no remaining callers — verify with:

Run: `grep -rn "simulateTeamMinutes" --include=*.js .`
Expected: no output.

- [ ] **Step 5: Update the possession test's minutes assertion**

`scripts/validate-possession.js` asserts minutes sum to exactly 240 (lines 53–54). That assertion described the old fixed distribution; measured minutes round per player. Replace those two lines with:

```js
    // Minutes are now measured from time actually spent on court rather than
    // distributed after the fact, so per-player rounding moves the total a
    // little. Overtime adds 5 minutes x 5 players per extra period.
    assert.ok(Math.abs(homeMinutes - 240) <= 3 || homeMinutes > 240,
      'home minutes should be ~240 in regulation (or more with OT), got ' + homeMinutes);
    assert.ok(Math.abs(awayMinutes - 240) <= 3 || awayMinutes > 240,
      'away minutes should be ~240 in regulation (or more with OT), got ' + awayMinutes);
```

- [ ] **Step 6: Regenerate the golden fixture**

Behaviour has deliberately changed: only five players a side now play. Update the generator's import to use `gameSim` (replace the `possEngine.simulateGame` call in `scripts/gen-gamesim-golden.js` with `gameSim.simulateGame`, adding the `gameSim` require as in Task 4 Step 4), then:

Run: `node scripts/gen-gamesim-golden.js`
Expected: `wrote 8 golden cases`, and `git diff scripts/fixtures/gamesim-golden.json` shows changed scores — confirming the rotation change had a real effect.

- [ ] **Step 7: Run the full suite**

Run: `node scripts/validate-gamesim.js && node scripts/validate-possession.js`
Expected: `checkFivePlayersOnCourt: OK`, `checkBenchPlayersRecordNothing: OK`, `checkMinutesAreEmergent: OK`, and all possession validations passing.

- [ ] **Step 8: Commit**

```bash
git add gameSim.js simEnginePossession.js scripts/
git commit -m "feat: real on-court five with substitutions and emergent minutes"
```

---

### Task 6: Real game clock

**Files:**
- Modify: `gameSim.js`
- Modify: `scripts/validate-gamesim.js`
- Modify: `scripts/gen-gamesim-golden.js` (regenerate fixture)

**Interfaces:**
- Consumes: `createGameSim` with `onCourt`/`secondsPlayed` from Task 5.
- Produces: `sim.clock` (seconds remaining in the current period), `sim.period` (1-based; 5+ are overtimes), `sim.possessionsPlayed` (total across both teams). `sim.step()` now advances a **single** possession, alternating teams, instead of a pair.

**Pace calibration.** The spec proposed a 14s base, which yields 2880/14 ≈ 206 total possessions, or ~103 per team — about 14% above today's fixed 90, which would inflate every score in the league by roughly the same margin. To hold scoring where it is, this plan uses a **16s base**: 2880/16 = 180 total, i.e. 90 per team, matching `POSSESSIONS_PER_TEAM` exactly. Variance is ±5s, floored at 4s.

- [ ] **Step 1: Write the failing tests**

In `scripts/validate-gamesim.js`, add before the final `console.log`:

```js
// The clock must be a real clock: monotonic within a period, never negative,
// and resetting at each period boundary.
function checkClockIsMonotonic() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(51));
  let prevClock = Infinity;
  let prevPeriod = 1;
  while (!sim.done) {
    assert.ok(sim.clock >= 0, 'clock must never go negative, got ' + sim.clock);
    if (sim.period === prevPeriod) {
      assert.ok(sim.clock <= prevClock, 'clock must run down within a period: ' + prevClock + ' -> ' + sim.clock);
    } else {
      assert.ok(sim.period > prevPeriod, 'periods only advance');
      prevPeriod = sim.period;
    }
    prevClock = sim.clock;
    sim.step();
  }
  console.log('checkClockIsMonotonic: OK');
}
checkClockIsMonotonic();

// Pace must stay where it was, or every score in the league silently re-scales.
function checkPaceMatchesLegacy() {
  let total = 0;
  const seeds = [52, 53, 54, 55, 56];
  seeds.forEach(function (seed) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    total += sim.possessionsPlayed;
  });
  const avgPerTeam = total / seeds.length / 2;
  assert.ok(avgPerTeam >= 82 && avgPerTeam <= 98,
    'possessions per team should stay near the legacy 90, got ' + avgPerTeam.toFixed(1));
  console.log('checkPaceMatchesLegacy: OK (' + avgPerTeam.toFixed(1) + ' possessions/team)');
}
checkPaceMatchesLegacy();

// Scoring must land in the same range the possession suite already asserts.
function checkScoringStaysRealistic() {
  for (const seed of [57, 58, 59, 60]) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    const r = sim.result();
    assert.ok(r.homeScore >= 60 && r.homeScore <= 170, 'home score realistic, got ' + r.homeScore);
    assert.ok(r.awayScore >= 60 && r.awayScore <= 170, 'away score realistic, got ' + r.awayScore);
  }
  console.log('checkScoringStaysRealistic: OK');
}
checkScoringStaysRealistic();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL at `checkClockIsMonotonic`, because `sim.clock` is `undefined` and `undefined >= 0` is false.

- [ ] **Step 3: Implement the clock**

In `gameSim.js`, add near the top of the file:

```js
const REGULATION_PERIODS = 4;
const PERIOD_SECONDS = 12 * 60;
const OVERTIME_SECONDS = 5 * 60;

// 16s base over a 2880s regulation gives 180 total possessions — 90 per team,
// matching the legacy POSSESSIONS_PER_TEAM exactly, so switching from a fixed
// possession count to a real clock does not re-scale scoring.
const POSSESSION_BASE_SECONDS = 16;
const POSSESSION_VARIANCE_SECONDS = 5;

function possessionSeconds(rng) {
  const jitter = (rng() * 2 - 1) * POSSESSION_VARIANCE_SECONDS;
  return Math.max(4, POSSESSION_BASE_SECONDS + jitter);
}
```

Inside `createGameSim`, add to the `sim` object literal: `clock: PERIOD_SECONDS`, `period: 1`, `possessionsPlayed: 0`, and `offenseTeam: 'home'`. Delete `quarter` and `possessionIndex` from the literal, and add a derived `quarter` for the event contexts that already depend on it.

Replace `sim.step()` entirely with the single-possession version:

```js
  sim.step = function () {
    if (sim.done) return;

    if (sim.possessionsPlayed === 0 || sim.clock >= (sim.period <= REGULATION_PERIODS ? PERIOD_SECONDS : OVERTIME_SECONDS)) {
      playByPlay.push('--- ' + (sim.period <= REGULATION_PERIODS ? 'Q' + sim.period : 'OT' + (sim.period - REGULATION_PERIODS)) + ' ---');
    }

    const team = sim.offenseTeam;
    const other = team === 'home' ? 'away' : 'home';
    sim.quarter = Math.min(sim.period, REGULATION_PERIODS);
    const ctx = captureEvents ? { events: captureEvents, team: team, quarter: sim.quarter } : null;

    const offBox = team === 'home' ? homeBox : awayBox;
    const defBox = team === 'home' ? awayBox : homeBox;
    const offSyn = team === 'home' ? homeSynergy : awaySynergy;
    const defSyn = team === 'home' ? awaySynergy : homeSynergy;

    const points = _GAMESIM_DATA.poss.simulatePossession(
      lineup(team), offBox, lineup(other), defBox, rng,
      { offense: offSyn, defense: defSyn }, playByPlay, ctx);

    if (team === 'home') sim.homeScore += points; else sim.awayScore += points;

    const elapsed = Math.min(sim.clock, possessionSeconds(rng));
    sim.clock -= elapsed;
    onCourt.home.concat(onCourt.away).forEach(function (id) { secondsPlayed[id] += elapsed; });
    sim.possessionsPlayed += 1;
    sim.offenseTeam = other;

    if (sim.clock <= 0) endPeriod();
  };

  function endPeriod() {
    if (sim.period < REGULATION_PERIODS) {
      sim.period += 1;
      sim.clock = PERIOD_SECONDS;
      return;
    }
    // Task 7 replaces this with real overtime.
    resolveTie();
    sim.done = true;
  }
```

Remove the old `POSSESSIONS_PER_QUARTER` constant and the `sim.possessionIndex >= POSSESSIONS_PER_TEAM` completion check, which the clock now supersedes.

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-gamesim.js`
Expected: `checkClockIsMonotonic: OK`, `checkPaceMatchesLegacy: OK (~90.0 possessions/team)`, `checkScoringStaysRealistic: OK`.

If `checkPaceMatchesLegacy` reports a number outside 82–98, adjust `POSSESSION_BASE_SECONDS` — raise it to reduce possessions, lower it to add them — and re-run until it lands. Do not proceed with a failing pace check; it is the guard against silently re-scaling the whole league's scoring.

- [ ] **Step 5: Regenerate the fixture and run the suite**

Run: `node scripts/gen-gamesim-golden.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `wrote 8 golden cases` then `done` with no `FAIL:` lines.

- [ ] **Step 6: Commit**

```bash
git add gameSim.js scripts/
git commit -m "feat: real game clock with variable possession length, calibrated to legacy pace"
```

---

### Task 7: Overtime

**Files:**
- Modify: `gameSim.js`
- Modify: `scripts/validate-gamesim.js`
- Modify: `scripts/gen-gamesim-golden.js` (regenerate fixture)

**Interfaces:**
- Consumes: `sim.period`, `sim.clock`, `endPeriod()` from Task 6.
- Produces: no new public members; `sim.period` may now exceed 4, and the `tiebreak` event type is no longer emitted.

- [ ] **Step 1: Write the failing test**

In `scripts/validate-gamesim.js`, add before the final `console.log`:

```js
// A tie at the end of regulation must be settled by playing basketball, not
// by awarding a phantom point to whoever made more field goals.
function checkOvertimeResolvesTies() {
  let sawOvertime = false;
  for (let seed = 100; seed < 260; seed++) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!sim.done) sim.step();
    const r = sim.result();
    assert.notStrictEqual(r.homeScore, r.awayScore, 'a finished game is never tied (seed ' + seed + ')');
    if (sim.period > 4) {
      sawOvertime = true;
      const otLines = r.playByPlay.filter(function (l) { return l.indexOf('--- OT') === 0; });
      assert.ok(otLines.length >= 1, 'an overtime game must log an OT period header');
      // Five players for five extra minutes is 25 extra player-minutes a side.
      let homeMin = 0;
      Object.keys(r.boxScore).forEach(function (id) {
        if (r.boxScore[id].teamId === 'BOS') homeMin += r.boxScore[id].minutes;
      });
      assert.ok(homeMin > 243, 'an overtime game must exceed regulation minutes, got ' + homeMin);
    }
  }
  assert.ok(sawOvertime, 'at least one of 160 seeded games should have reached overtime');
  console.log('checkOvertimeResolvesTies: OK');
}
checkOvertimeResolvesTies();

// The tiebreak hack must be gone entirely.
function checkNoTiebreakEvents() {
  for (let seed = 300; seed < 340; seed++) {
    const events = [];
    gameSim.simulateGame('BOS', 'LAL', makeRng(seed), { events: events });
    const tiebreaks = events.filter(function (e) { return e.type === 'tiebreak'; });
    assert.strictEqual(tiebreaks.length, 0, 'no tiebreak events should be emitted (seed ' + seed + ')');
  }
  console.log('checkNoTiebreakEvents: OK');
}
checkNoTiebreakEvents();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL at `checkOvertimeResolvesTies` on `at least one of 160 seeded games should have reached overtime`, because `endPeriod` still ends the game at the fourth period.

- [ ] **Step 3: Implement overtime**

In `gameSim.js`, replace `endPeriod` and delete `resolveTie` entirely:

```js
  function endPeriod() {
    const regulationOver = sim.period >= REGULATION_PERIODS;
    if (!regulationOver) {
      sim.period += 1;
      sim.clock = PERIOD_SECONDS;
      return;
    }
    if (sim.homeScore === sim.awayScore) {
      // Real overtime, rather than awarding a phantom point. Each extra
      // period is a full five minutes and both teams keep playing.
      sim.period += 1;
      sim.clock = OVERTIME_SECONDS;
      return;
    }
    sim.done = true;
  }
```

Because a tie can now only be broken by scoring, `sim.done` is reached solely through `endPeriod`, and a finished game can never be tied.

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-gamesim.js`
Expected: `checkOvertimeResolvesTies: OK` and `checkNoTiebreakEvents: OK`.

- [ ] **Step 5: Remove tiebreak handling from the choreographer**

The `tiebreak` event type is now dead. In `ui/pixelChoreographer.js`, delete the `} else if (ev.type === 'tiebreak') {` branch and its body from the event-grouping loop, and remove `tiebreak` from any comment listing event types.

Run: `grep -rn "tiebreak" --include=*.js . | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Run the full suite and regenerate the fixture**

Run: `node scripts/gen-gamesim-golden.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `wrote 8 golden cases` then `done` with no `FAIL:` lines.

- [ ] **Step 7: Commit**

```bash
git add gameSim.js ui/pixelChoreographer.js scripts/
git commit -m "feat: real overtime periods, replacing the phantom-point tiebreak"
```

---

## Stage 3 — The coach

### Task 8: `coach.js` — substitution decisions

**Files:**
- Create: `coach.js`
- Create: `scripts/validate-coach.js`
- Modify: `gameSim.js`
- Modify: `index.html`
- Modify: `simWorker.js:16`

**Interfaces:**
- Consumes: `sim.onCourt`, `sim.byId`, `sim.homeBox`/`sim.awayBox`, `sim.period`, `sim.clock`, `sim.homeScore`/`sim.awayScore`, `sim.secondsPlayed`.
- Produces: `decideSubstitutions(sim, team) → [{ out: playerId, in: playerId }]`.

Thresholds are exactly those specified in the design doc.

- [ ] **Step 1: Write the failing tests**

Create `scripts/validate-coach.js`:

```js
const assert = require('assert');
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
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const coach = require(path.join(__dirname, '..', 'coach.js'));

// Six fouls means out, with no exceptions and no ambiguity.
function checkFouledOutPlayerIsBenched() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(61));
  const victim = sim.onCourt.home[0];
  sim.homeBox[victim].fouls = 6;
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === victim; }),
    'a player with 6 fouls must be substituted out');
  console.log('checkFouledOutPlayerIsBenched: OK');
}
checkFouledOutPlayerIsBenched();

// A gassed player gets a rest, provided someone fresher is available.
function checkTiredPlayerIsRested() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(62));
  const tired = sim.onCourt.home[0];
  sim.homeBox[tired].energy = 0.40;
  Object.keys(sim.homeBox).forEach(function (id) {
    if (sim.onCourt.home.indexOf(id) === -1) sim.homeBox[id].energy = 1.0;
  });
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === tired; }),
    'a player below the energy floor must be rested when a fresher body exists');
  console.log('checkTiredPlayerIsRested: OK');
}
checkTiredPlayerIsRested();

// Without a minutes budget nothing would sit a healthy starter, and one
// player would soak up all 48 minutes.
function checkStarterIsRestedOnMinutesPace() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(66));
  // Halfway through the game, with a starter who has never come off.
  sim.period = 3;
  sim.clock = 12 * 60;
  const hog = sim.onCourt.home[0];
  sim.secondsPlayed[hog] = 24 * 60;   // 24 minutes played at the half
  sim.homeBox[hog].energy = 1.0;      // not tired, not in foul trouble
  sim.homeBox[hog].fouls = 0;
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === hog; }),
    'a starter well past his minutes pace must sit even when fresh');
  console.log('checkStarterIsRestedOnMinutesPace: OK');
}
checkStarterIsRestedOnMinutesPace();

// Nobody should approach a full 48 once the budget is enforced.
function checkNoPlayerSoaksTheWholeGame() {
  for (const seed of [67, 68, 69]) {
    const r = gameSim.simulateGame('BOS', 'LAL', makeRng(seed));
    Object.keys(r.boxScore).forEach(function (id) {
      assert.ok(r.boxScore[id].minutes <= 44,
        'no player should play essentially the whole game, got ' + r.boxScore[id].minutes + ' for ' + id);
    });
  }
  console.log('checkNoPlayerSoaksTheWholeGame: OK');
}
checkNoPlayerSoaksTheWholeGame();

// Every swap must be legal: out is on the floor, in is on the bench and healthy.
function checkSwapsAreAlwaysLegal() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(63));
  let guard = 0;
  while (!sim.done) {
    ['home', 'away'].forEach(function (team) {
      const swaps = coach.decideSubstitutions(sim, team);
      const outs = {}, ins = {};
      swaps.forEach(function (s) {
        assert.ok(sim.onCourt[team].indexOf(s.out) !== -1, 'sub-out must be on the floor');
        assert.ok(sim.onCourt[team].indexOf(s.in) === -1, 'sub-in must not already be on the floor');
        assert.ok(sim.byId[s.in], 'sub-in must be on this roster');
        assert.ok(!outs[s.out], 'no player subbed out twice in one batch');
        assert.ok(!ins[s.in], 'no player subbed in twice in one batch');
        outs[s.out] = true; ins[s.in] = true;
      });
      sim.applySubstitutions(team, swaps);
    });
    sim.step();
    assert.ok(guard++ < 5000, 'must terminate');
  }
  console.log('checkSwapsAreAlwaysLegal: OK');
}
checkSwapsAreAlwaysLegal();

// With no bench available the coach must field five, not four.
function checkNeverFieldsFewerThanFive() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(64));
  Object.keys(sim.homeBox).forEach(function (id) { sim.homeBox[id].fouls = 6; });
  const swaps = coach.decideSubstitutions(sim, 'home');
  sim.applySubstitutions('home', swaps);
  assert.strictEqual(sim.onCourt.home.length, 5, 'must still field five with everyone in foul trouble');
  console.log('checkNeverFieldsFewerThanFive: OK');
}
checkNeverFieldsFewerThanFive();

console.log('All coach validations passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-coach.js`
Expected: FAIL with `Cannot find module '.../coach.js'`.

- [ ] **Step 3: Implement `coach.js`**

Create `coach.js`:

```js
// Shared decision-maker. Every team in every game runs through this, watched
// or not, so watching a game can never confer an advantage the rest of the
// league does not also get. Pure functions over sim state: no state of its
// own, which is what makes it testable in isolation and safe to call from
// both the batch loop and (later) the live-stepped view.
var _COACH_DATA = (typeof require !== 'undefined')
  ? { box: require('./simEngineBoxScore.js') }
  : { box: { minutesWeight: minutesWeight } };

const ENERGY_FLOOR = 0.55;          // below this, look for a rest
const ENERGY_EDGE = 0.15;           // a replacement must be at least this much fresher
const FOUL_TROUBLE = 4;             // 4+ fouls before Q4 means sit
const FOUL_OUT = 6;
const GARBAGE_MARGIN = 20;
const GARBAGE_SECONDS_LEFT = 5 * 60;
const MINUTES_OVER_TARGET = 1.10;   // 10% past the pro-rata target means sit
const REGULATION_SECONDS = 48 * 60;
const TEAM_MINUTES = 240;

function lineFor(sim, team, id) {
  return (team === 'home' ? sim.homeBox : sim.awayBox)[id];
}

function rosterFor(sim, team) {
  return team === 'home' ? sim.homeRoster : sim.awayRoster;
}

// Bench players who could legally come in, freshest first.
function availableBench(sim, team, alreadyUsed) {
  return rosterFor(sim, team)
    .filter(function (p) {
      if (sim.onCourt[team].indexOf(p.id) !== -1) return false;
      if (alreadyUsed[p.id]) return false;
      return lineFor(sim, team, p.id).fouls < FOUL_OUT;
    })
    .sort(function (a, b) {
      return lineFor(sim, team, b.id).energy - lineFor(sim, team, a.id).energy;
    });
}

function isGarbageTime(sim) {
  const margin = Math.abs(sim.homeScore - sim.awayScore);
  const lateEnough = sim.period >= 4 && sim.clock <= GARBAGE_SECONDS_LEFT;
  return margin > GARBAGE_MARGIN && lateEnough;
}

// Each player's share of the 240 team minutes, from the same weighting that
// used to hand out minutes directly. This is what stops a starter from
// playing all 48: without it, nothing but fatigue would ever sit them.
function targetMinutes(sim, team, id) {
  const roster = rosterFor(sim, team);
  let total = 0;
  roster.forEach(function (p) { total += _COACH_DATA.box.minutesWeight(p); });
  if (total <= 0) return TEAM_MINUTES / Math.max(1, roster.length);
  return TEAM_MINUTES * (_COACH_DATA.box.minutesWeight(sim.byId[id]) / total);
}

// Seconds of game time elapsed so far, derived from the clock rather than
// tracked separately, so it cannot drift out of sync with it.
function elapsedSeconds(sim) {
  const completed = Math.min(sim.period - 1, 4) * 12 * 60 + Math.max(0, sim.period - 5) * 5 * 60;
  const periodLength = sim.period <= 4 ? 12 * 60 : 5 * 60;
  return completed + (periodLength - sim.clock);
}

// True when a player is running ahead of his minutes budget for this point in
// the game by more than the allowed margin.
function isOverMinutesPace(sim, team, id) {
  const elapsed = elapsedSeconds(sim);
  if (elapsed < 6 * 60) return false;           // too early to judge pace
  const played = (sim.secondsPlayed[id] || 0) / 60;
  const paceTarget = targetMinutes(sim, team, id) * (elapsed / REGULATION_SECONDS);
  return played > paceTarget * MINUTES_OVER_TARGET;
}

// Returns the swaps this team should make right now. Order of checks is
// deliberate: a fouled-out player MUST come off, so that runs before the
// discretionary reasons and claims the freshest replacement first.
function decideSubstitutions(sim, team) {
  const swaps = [];
  const used = {};
  const onFloor = sim.onCourt[team].slice();

  function trySwap(outId) {
    const bench = availableBench(sim, team, used);
    if (bench.length === 0) return;                    // never field fewer than five
    const inPlayer = bench[0];
    used[inPlayer.id] = true;
    swaps.push({ out: outId, in: inPlayer.id });
  }

  // 1. Fouled out — mandatory.
  onFloor.forEach(function (id) {
    if (lineFor(sim, team, id).fouls >= FOUL_OUT) trySwap(id);
  });

  const swappedOut = {};
  swaps.forEach(function (s) { swappedOut[s.out] = true; });

  // 2. Foul trouble before the fourth quarter — protective.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    const line = lineFor(sim, team, id);
    if (line.fouls >= FOUL_TROUBLE && sim.period < 4) {
      trySwap(id);
      swappedOut[id] = true;
    }
  });

  // 3. Garbage time — rest the best players once the result is decided.
  if (isGarbageTime(sim)) {
    rosterFor(sim, team).slice()
      .sort(function (a, b) { return _COACH_DATA.box.minutesWeight(b) - _COACH_DATA.box.minutesWeight(a); })
      .slice(0, 3)
      .forEach(function (p) {
        if (swappedOut[p.id]) return;
        if (sim.onCourt[team].indexOf(p.id) === -1) return;
        trySwap(p.id);
        swappedOut[p.id] = true;
      });
  }

  // 4. Fatigue — only if a meaningfully fresher body is on the bench.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    const line = lineFor(sim, team, id);
    if (line.energy >= ENERGY_FLOOR) return;
    const bench = availableBench(sim, team, used);
    if (bench.length === 0) return;
    if (lineFor(sim, team, bench[0].id).energy < line.energy + ENERGY_EDGE) return;
    trySwap(id);
    swappedOut[id] = true;
  });

  // 5. Minutes budget — the reason a healthy, un-tired starter still sits.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    if (!isOverMinutesPace(sim, team, id)) return;
    trySwap(id);
    swappedOut[id] = true;
  });

  return swaps;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decideSubstitutions: decideSubstitutions,
    ENERGY_FLOOR: ENERGY_FLOOR,
    FOUL_TROUBLE: FOUL_TROUBLE,
    FOUL_OUT: FOUL_OUT
  };
}
```

- [ ] **Step 4: Run the coach tests**

Run: `node scripts/validate-coach.js`
Expected: all four checks OK, then `All coach validations passed`.

- [ ] **Step 5: Wire the coach into every game**

In `gameSim.js`, add `coach: require('./coach.js')` to the Node branch of `_GAMESIM_DATA` and `coach: { decideSubstitutions: decideSubstitutions }` to the browser branch. Then at the very top of `sim.step()`, after the `if (sim.done) return;` guard, add:

```js
    // Every team, every game — this is what makes watching a game no better
    // than not watching it, other than the decisions a human chooses to make.
    ['home', 'away'].forEach(function (t) {
      sim.applySubstitutions(t, _GAMESIM_DATA.coach.decideSubstitutions(sim, t));
    });
```

- [ ] **Step 6: Register the new file for browser and worker**

In `index.html`, add before the `simEngine.js` script tag (line 42):

```html
  <script src="coach.js"></script>
```

In `simWorker.js` line 16, add `'coach.js'` before `'gameSim.js'`:

```js
importScripts('data.js', 'rng.js', 'traits.js', 'compositeRatings.js', 'simEngine.js', 'simEngineBoxScore.js', 'simEnginePossession.js', 'coach.js', 'gameSim.js');
```

- [ ] **Step 7: Regenerate the fixture and run the full suite**

Run: `node scripts/gen-gamesim-golden.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `wrote 8 golden cases` then `done` with no `FAIL:` lines. Minutes will now be spread across more than five players per team — confirm by checking that at least 7 players per team have non-zero minutes in one sampled game:

Run: `node -e "require('./data.js');require('./rng.js');const{TEAMS}=require('./teams.js');require('./traits.js');require('./scouting.js');const{PLAYERS_2026}=require('./players-2026.js');require('./traits.js').ensureHiddenPlayerData(PLAYERS_2026);const{makeRng}=require('./rng.js');require('./simEngine.js');require('./simEngineBoxScore.js');require('./simEnginePossession.js');const g=require('./gameSim.js');const r=g.simulateGame('BOS','LAL',makeRng(5));const n=Object.keys(r.boxScore).filter(id=>r.boxScore[id].teamId==='BOS'&&r.boxScore[id].minutes>0).length;console.log('BOS players with minutes:',n);"`
Expected: a number of at least 7.

- [ ] **Step 8: Commit**

```bash
git add coach.js gameSim.js index.html simWorker.js scripts/
git commit -m "feat: shared auto-coach handling substitutions for every team in every game"
```

---

### Task 9: Timeouts and the scoring-run tracker

**Files:**
- Modify: `gameSim.js`
- Modify: `coach.js`
- Modify: `scripts/validate-coach.js`
- Modify: `scripts/validate-gamesim.js`

**Interfaces:**
- Consumes: `sim` from Task 8.
- Produces: `sim.timeoutsLeft` — `{ home: number, away: number }`; `sim.run` — `{ team: 'home'|'away'|null, points: number }`; `sim.callTimeout(team) → boolean`; `coach.decideTimeout(sim, team) → boolean`.

- [ ] **Step 1: Write the failing tests**

In `scripts/validate-gamesim.js`, add before the final `console.log`:

```js
// A timeout must do something mechanical, or the agency built on it is hollow.
function checkTimeoutRestoresEnergyAndClearsRun() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(71));
  sim.onCourt.home.forEach(function (id) { sim.homeBox[id].energy = 0.5; });
  sim.run = { team: 'away', points: 10 };
  const before = sim.timeoutsLeft.home;

  const ok = sim.callTimeout('home');
  assert.strictEqual(ok, true, 'a timeout with one in hand must succeed');
  assert.strictEqual(sim.timeoutsLeft.home, before - 1, 'a timeout must be consumed');
  sim.onCourt.home.forEach(function (id) {
    assert.ok(Math.abs(sim.homeBox[id].energy - 0.62) < 1e-9,
      'on-court energy must rise by 0.12, got ' + sim.homeBox[id].energy);
  });
  assert.strictEqual(sim.run.points, 0, 'a timeout must clear the opponent run');
  console.log('checkTimeoutRestoresEnergyAndClearsRun: OK');
}
checkTimeoutRestoresEnergyAndClearsRun();

// Energy is a multiplier ceiling-ed at 1.0; a timeout must not exceed it.
function checkTimeoutEnergyIsCapped() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(72));
  sim.onCourt.home.forEach(function (id) { sim.homeBox[id].energy = 0.95; });
  sim.callTimeout('home');
  sim.onCourt.home.forEach(function (id) {
    assert.ok(sim.homeBox[id].energy <= 1.0, 'energy must never exceed 1.0');
  });
  console.log('checkTimeoutEnergyIsCapped: OK');
}
checkTimeoutEnergyIsCapped();

// Seven per game, and no more.
function checkTimeoutsAreFinite() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(73));
  assert.strictEqual(sim.timeoutsLeft.home, 7, 'teams start with 7 timeouts');
  for (let i = 0; i < 7; i++) {
    assert.strictEqual(sim.callTimeout('home'), true, 'timeout ' + (i + 1) + ' should succeed');
  }
  assert.strictEqual(sim.callTimeout('home'), false, 'the 8th timeout must be refused');
  assert.strictEqual(sim.timeoutsLeft.home, 0, 'timeouts cannot go negative');
  console.log('checkTimeoutsAreFinite: OK');
}
checkTimeoutsAreFinite();

// The run tracker is what nudges and coach timeout logic read.
function checkRunTracking() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(74));
  let sawRun = false;
  while (!sim.done) {
    sim.step();
    assert.ok(sim.run.points >= 0, 'run points are never negative');
    if (sim.run.points >= 6) sawRun = true;
    if (sim.run.team) assert.ok(sim.run.team === 'home' || sim.run.team === 'away', 'run team is a side');
  }
  assert.ok(sawRun, 'some team should go on a 6+ point run in a full game');
  console.log('checkRunTracking: OK');
}
checkRunTracking();

// The spec's core claim: agency is real, not cosmetic. Same seed, different
// decisions, different game. (Calling a timeout consumes no rng, so the
// random stream is identical — only the energy state the draws are applied
// against differs, which is exactly what makes this a fair comparison.)
function checkDecisionsChangeOutcomes() {
  let anyDiffered = false;
  for (const seed of [81, 82, 83, 84, 85, 86]) {
    const control = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    while (!control.done) control.step();

    const withTimeouts = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    let n = 0;
    while (!withTimeouts.done) {
      if (n === 12 || n === 40) withTimeouts.callTimeout('home');
      withTimeouts.step();
      n += 1;
    }

    if (control.result().homeScore !== withTimeouts.result().homeScore ||
        control.result().awayScore !== withTimeouts.result().awayScore) {
      anyDiffered = true;
    }
  }
  assert.ok(anyDiffered,
    'calling timeouts must change at least one of six games, or agency is cosmetic');
  console.log('checkDecisionsChangeOutcomes: OK');
}
checkDecisionsChangeOutcomes();

// ...and the same decisions must still reproduce exactly, or nothing is
// debuggable.
function checkSameDecisionsReproduce() {
  function play(seed) {
    const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(seed));
    let n = 0;
    while (!sim.done) {
      if (n === 12 || n === 40) sim.callTimeout('home');
      sim.step();
      n += 1;
    }
    return sim.result();
  }
  const a = play(91);
  const b = play(91);
  assert.strictEqual(a.homeScore, b.homeScore, 'same seed + same decisions must reproduce');
  assert.strictEqual(a.awayScore, b.awayScore, 'same seed + same decisions must reproduce');
  assert.strictEqual(boxChecksum(a.boxScore), boxChecksum(b.boxScore), 'box scores must reproduce');
  console.log('checkSameDecisionsReproduce: OK');
}
checkSameDecisionsReproduce();
```

And in `scripts/validate-coach.js`, add before its final `console.log`:

```js
// The coach calls a timeout when it is being run off the floor, and not
// otherwise.
function checkCoachTimeoutOnRun() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(65));
  sim.run = { team: 'away', points: 10 };
  assert.strictEqual(coach.decideTimeout(sim, 'home'), true, 'conceding a 10-0 run should draw a timeout');

  sim.run = { team: 'away', points: 4 };
  assert.strictEqual(coach.decideTimeout(sim, 'home'), false, 'a 4-0 run is not worth a timeout');

  sim.run = { team: 'away', points: 10 };
  sim.timeoutsLeft.home = 0;
  assert.strictEqual(coach.decideTimeout(sim, 'home'), false, 'cannot call a timeout with none left');
  console.log('checkCoachTimeoutOnRun: OK');
}
checkCoachTimeoutOnRun();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL at `checkTimeoutRestoresEnergyAndClearsRun` because `sim.timeoutsLeft` is `undefined`.

- [ ] **Step 3: Implement timeouts and run tracking in `gameSim.js`**

Add near the top of `gameSim.js`:

```js
const TIMEOUTS_PER_GAME = 7;
const TIMEOUT_ENERGY_RESTORE = 0.12;
```

Add to the `sim` object literal: `timeoutsLeft: { home: TIMEOUTS_PER_GAME, away: TIMEOUTS_PER_GAME }` and `run: { team: null, points: 0 }`.

Add the timeout method inside `createGameSim`:

```js
  // Consumes no game clock: the stoppage is represented by its effects, not
  // by advancing time (see the design doc).
  sim.callTimeout = function (team) {
    if (sim.done) return false;
    if (sim.timeoutsLeft[team] <= 0) return false;
    sim.timeoutsLeft[team] -= 1;
    const box = team === 'home' ? homeBox : awayBox;
    onCourt[team].forEach(function (id) {
      box[id].energy = Math.min(1, box[id].energy + TIMEOUT_ENERGY_RESTORE);
    });
    // Whoever was running now isn't.
    sim.run = { team: null, points: 0 };
    return true;
  };
```

In `sim.step()`, immediately after the score is added, update the run tracker:

```js
    if (points > 0) {
      if (sim.run.team === team) sim.run.points += points;
      else sim.run = { team: team, points: points };
    }
```

And after the substitution block at the top of `sim.step()`, let the coach call timeouts:

```js
    ['home', 'away'].forEach(function (t) {
      if (_GAMESIM_DATA.coach.decideTimeout(sim, t)) sim.callTimeout(t);
    });
```

- [ ] **Step 4: Implement `decideTimeout` in `coach.js`**

Add to `coach.js`, before the exports:

```js
const RUN_TRIGGER_POINTS = 8;

// Call a timeout when the other side is running away with it and we still
// have one in hand. Deliberately simple: the human watching gets the same
// signal through a nudge, and can act sooner if they read it better.
function decideTimeout(sim, team) {
  if (sim.timeoutsLeft[team] <= 0) return false;
  const other = team === 'home' ? 'away' : 'home';
  if (sim.run.team !== other) return false;
  return sim.run.points >= RUN_TRIGGER_POINTS;
}
```

Add `decideTimeout: decideTimeout` and `RUN_TRIGGER_POINTS: RUN_TRIGGER_POINTS` to `coach.js`'s `module.exports`, and `decideTimeout: decideTimeout` to `gameSim.js`'s browser-branch `coach` object.

- [ ] **Step 5: Run the tests**

Run: `node scripts/validate-gamesim.js && node scripts/validate-coach.js`
Expected: all timeout and run checks OK in both files.

- [ ] **Step 6: Regenerate the fixture and run the full suite**

Run: `node scripts/gen-gamesim-golden.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `wrote 8 golden cases` then `done` with no `FAIL:` lines.

- [ ] **Step 7: Commit**

```bash
git add gameSim.js coach.js scripts/
git commit -m "feat: timeouts with energy restore and coach-driven run response"
```

---

### Task 10: Make `possession` the league default

**Files:**
- Modify: `simEngine.js:19`
- Modify: `scripts/validate-sim.js:96`
- Modify: `scripts/validate-gamesim.js`

**Interfaces:**
- Consumes: the registered `possession` engine from Task 4.
- Produces: `getActiveEngine(settings)` returns the possession engine when `settings.simEngine` is absent.

- [ ] **Step 1: Write the failing test**

In `scripts/validate-gamesim.js`, add before the final `console.log`:

```js
// The league must run under the same rules the user watches, or the coach's
// decisions only exist in games that happen to be observed.
function checkPossessionIsDefaultEngine() {
  const simEngineModule = require(path.join(__dirname, '..', 'simEngine.js'));
  const defaulted = simEngineModule.getActiveEngine({});
  assert.strictEqual(defaulted, simEngineModule.SIM_ENGINES.possession,
    'an empty settings object must select the possession engine');
  const undefinedSettings = simEngineModule.getActiveEngine(undefined);
  assert.strictEqual(undefinedSettings, simEngineModule.SIM_ENGINES.possession,
    'undefined settings must select the possession engine');
  // boxscore stays available for anyone who selects it explicitly.
  const explicit = simEngineModule.getActiveEngine({ simEngine: 'boxscore' });
  assert.strictEqual(explicit, simEngineModule.SIM_ENGINES.boxscore,
    'boxscore must remain selectable');
  console.log('checkPossessionIsDefaultEngine: OK');
}
checkPossessionIsDefaultEngine();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL at `an empty settings object must select the possession engine`.

- [ ] **Step 3: Change the default**

In `simEngine.js`, change line 19 from:

```js
  const name = (settings && settings.simEngine) || 'boxscore';
```

to:

```js
  // The possession engine is the league default: it is the one that models an
  // on-court five, rotations, a clock, and coaching decisions, so making it
  // the default is what keeps unwatched games under the same rules as the
  // game the user is watching. `boxscore` remains selectable in settings and
  // is roughly 30x faster for anyone who wants raw fast-forward speed.
  const name = (settings && settings.simEngine) || 'possession';
```

- [ ] **Step 4: Confirm `validate-sim.js` needs no change**

`scripts/validate-sim.js:96` asserts that `getActiveEngine({ simEngine: 'possession' })` throws "not implemented yet". That assertion stays true and must NOT be edited: that file never loads `simEnginePossession.js` or `gameSim.js`, so the `possession` slot really is unregistered in its module graph. The default change cannot affect it either, because every `getActiveEngine` and league call in that file passes `{ simEngine: 'boxscore' }` explicitly (lines 94, 246, 273, 329).

Verify both facts rather than trusting this note:

Run: `grep -c "simEnginePossession\|gameSim" scripts/validate-sim.js; grep -n "getActiveEngine(\|const settings" scripts/validate-sim.js`
Expected: the count is `0`, and every `settings` shown is `{ simEngine: 'boxscore' }`.

Run: `node scripts/validate-sim.js`
Expected: `All sim validations passed`, with the file unmodified.

- [ ] **Step 5: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 6: Confirm the season-sim cost is what the design predicted**

Run: `node -e "require('./data.js');require('./rng.js');const{TEAMS}=require('./teams.js');require('./traits.js');require('./scouting.js');const{PLAYERS_2026}=require('./players-2026.js');require('./traits.js').ensureHiddenPlayerData(PLAYERS_2026);const{makeRng}=require('./rng.js');const se=require('./simEngine.js');require('./simEngineBoxScore.js');require('./simEnginePossession.js');require('./coach.js');require('./gameSim.js');const e=se.getActiveEngine({});const rng=makeRng(7);const t0=Date.now();for(let i=0;i<1230;i++)e.simulateGame('BOS','LAL',rng);console.log('full season:',Date.now()-t0,'ms');"`
Expected: a figure under 6000ms. The design budgeted ~2.2s before rotations and coaching were added; if this exceeds 6s, note the measured number in the commit message so the Stage 4 plan can decide whether fast-forward needs the worker by default.

- [ ] **Step 7: Commit**

```bash
git add simEngine.js scripts/
git commit -m "feat: make the possession engine the league default"
```

---

## Verification of the whole plan

After Task 10, the following must all hold:

- [ ] `for f in scripts/validate-*.js; do node "$f" || echo "FAIL: $f"; done` reports no failures.
- [ ] A full season sims in under 6 seconds.
- [ ] `grep -rn "simulateTeamMinutes\|tiebreak" --include=*.js .` returns nothing.
- [ ] The app still loads and a game is still watchable end to end at `http://localhost:8200` (the Stage 4 plan replaces this flow, but it must not be broken in the meantime).

## Out of scope

Everything in Stage 4 of the spec: user-facing timeout and substitution controls, nudges, live stepping from the view, incremental choreography, and the `ui/pixelGameView.js` split. Those depend on the interfaces this plan produces and require browser verification, so they get their own plan.
