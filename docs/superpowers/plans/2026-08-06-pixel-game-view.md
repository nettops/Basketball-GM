# Pixel Game View ("Watch Game") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Watch Next Game" button that sims the user's next game through the possession engine with a structured event log, then plays it back as a Hoop Land–style pixel-art court animation.

**Architecture:** Pre-sim + animated replay. The possession engine gains an optional structured-event collector (no RNG drift). A pure choreographer converts the event log into a keyframe timeline; a canvas view interpolates between keyframes and draws procedural pixel sprites. Result is recorded through the existing `applyGameResult` path before playback starts.

**Tech Stack:** Vanilla JS (dual require-or-globals module pattern), Canvas 2D, Node `assert` validate scripts. Zero dependencies, zero image assets except existing `assets/logos/<ID>.png`.

**Spec:** `docs/superpowers/specs/2026-08-06-pixel-game-view-design.md`

## Global Constraints

- Repo pattern: every module is `var X = (typeof require !== 'undefined') ? require(...) : { globals }` at top, `if (typeof module !== 'undefined' && module.exports)` at bottom. ES5-style (`function`, `var`/`const`, no arrow functions in game code — match surrounding files).
- No change to sim math or RNG consumption: capture-on and capture-off runs with the same seed must produce identical results.
- Event log is playback-only: never stored in `GameState` or saves.
- No new dependencies, no image assets beyond existing team logo PNGs.
- Regular season only (playoffs out of scope v1).
- Tests are `scripts/validate-*.js` run via `node`, using `assert` + `console.log('checkX: OK')` pattern.
- All game-facing paths use Windows-safe relative paths; scripts run from repo root `C:\Users\cory\Desktop\nba`.

## Event Log Format (contract between Tasks 1, 2, 5)

Every event has `team: 'home'|'away'` (offensive team except `rebound`, where it is the rebounder's side) and `quarter: 1..4`. Types:

```js
{ type: 'possession', team, quarter, playerId }                                  // possession start; playerId = ball handler
{ type: 'turnover',   team, quarter, playerId, defenderId|null }                 // defenderId set when stolen
{ type: 'block',      team, quarter, playerId, defenderId, zone }                // playerId = shooter, defenderId = blocker
{ type: 'shot',       team, quarter, playerId, defenderId, zone, made, points, assistPlayerId|null } // points = 2|3 if made else 0
{ type: 'rebound',    team, quarter, playerId, offensive }                       // team = rebounder's side
{ type: 'foul-ft',    team, quarter, playerId, defenderId, made, attempts, points } // FT trip; points === made
{ type: 'tiebreak',   team, quarter: 4, playerId, points: 1 }                    // engine's no-tie nudge, keeps score invariant
```

`zone` is `'three'|'mid'|'inside'`. Invariant: per team, sum of `points` over all events === final score.

---

### Task 1: Structured event capture in the possession engine

**Files:**
- Modify: `simEnginePossession.js` (thread optional event context through `simulatePossession` / `simulatePossessionGame`)
- Test: `scripts/validate-pixel-events.js`

**Interfaces:**
- Consumes: existing `simulatePossessionGame(homeTeamId, awayTeamId, rng)`.
- Produces: `simulatePossessionGame(homeTeamId, awayTeamId, rng, options)` where `options = { events: [] }` fills the array with the Event Log Format above. `simulatePossession(offense, offenseBox, defense, defenseBox, rng, synergy, log, eventCtx)` gains optional 8th param `eventCtx = { events, team, quarter }`.

- [ ] **Step 1: Write the failing test**

`scripts/validate-pixel-events.js`:

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
const league = require(path.join(__dirname, '..', 'league.js'));

const EVENT_TYPES = ['possession', 'turnover', 'block', 'shot', 'rebound', 'foul-ft', 'tiebreak'];

function checkNoRngDrift() {
  // Same seed, capture on vs off: identical results.
  for (let seed = 1; seed <= 10; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const plain = possEngine.simulateGame(home.id, away.id, makeRng(seed));
    const events = [];
    const captured = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });
    assert.strictEqual(captured.homeScore, plain.homeScore, 'homeScore drift at seed ' + seed);
    assert.strictEqual(captured.awayScore, plain.awayScore, 'awayScore drift at seed ' + seed);
    assert.strictEqual(JSON.stringify(captured.boxScore), JSON.stringify(plain.boxScore), 'boxScore drift at seed ' + seed);
    assert.ok(events.length > 0, 'events should have been captured');
  }
  console.log('checkNoRngDrift: OK');
}
checkNoRngDrift();

function checkEventIntegrity() {
  for (let seed = 20; seed < 35; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 13) % TEAMS.length];
    if (home.id === away.id) continue;
    const events = [];
    const result = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });

    const homeIds = league.getTeamRoster(home.id).map(function (p) { return p.id; });
    const awayIds = league.getTeamRoster(away.id).map(function (p) { return p.id; });

    let homePts = 0, awayPts = 0, lastQuarter = 1;
    events.forEach(function (ev) {
      assert.ok(EVENT_TYPES.indexOf(ev.type) !== -1, 'unknown event type ' + ev.type);
      assert.ok(ev.team === 'home' || ev.team === 'away', 'event team must be home/away');
      assert.ok(ev.quarter >= lastQuarter, 'quarters must be monotonic');
      lastQuarter = ev.quarter;
      assert.ok(ev.quarter >= 1 && ev.quarter <= 4, 'quarter in range');

      const ownIds = ev.team === 'home' ? homeIds : awayIds;
      const oppIds = ev.team === 'home' ? awayIds : homeIds;
      // rebound team is the rebounder's own side; all types put playerId on ev.team's roster
      assert.ok(ownIds.indexOf(ev.playerId) !== -1, ev.type + ' playerId ' + ev.playerId + ' not on ' + ev.team + ' roster');
      if (ev.defenderId) {
        assert.ok(oppIds.indexOf(ev.defenderId) !== -1, ev.type + ' defenderId not on opposing roster');
      }
      if (ev.type === 'shot' && ev.assistPlayerId) {
        assert.ok(ownIds.indexOf(ev.assistPlayerId) !== -1, 'assistPlayerId not on own roster');
        assert.notStrictEqual(ev.assistPlayerId, ev.playerId, 'no self-assists');
      }
      if (ev.type === 'foul-ft') {
        assert.strictEqual(ev.points, ev.made, 'foul-ft points must equal made');
        assert.ok(ev.made >= 0 && ev.made <= ev.attempts, 'made within attempts');
      }
      const pts = ev.points || 0;
      if (ev.team === 'home') homePts += pts; else awayPts += pts;
    });

    assert.strictEqual(homePts, result.homeScore, 'event points must sum to home score');
    assert.strictEqual(awayPts, result.awayScore, 'event points must sum to away score');

    // Every possession event is eventually followed by a terminal event before the next possession
    let openPossession = false;
    events.forEach(function (ev) {
      if (ev.type === 'possession') {
        assert.ok(!openPossession, 'possession opened while previous still unterminated');
        openPossession = true;
      } else if (ev.type === 'turnover' || ev.type === 'block' || ev.type === 'shot') {
        openPossession = false;
      }
    });
  }
  console.log('checkEventIntegrity: OK');
}
checkEventIntegrity();

console.log('All pixel event validations passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/validate-pixel-events.js`
Expected: FAIL — `events.length` is 0 (`simulateGame` ignores the 4th argument today), so `checkNoRngDrift` asserts `'events should have been captured'`.

- [ ] **Step 3: Implement event capture**

In `simEnginePossession.js`:

Add after `logPlay` (line ~139):

```js
// Structured-event twin of logPlay for the pixel game view (see
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md). eventCtx is
// { events, team, quarter } or null; pushing events never touches the rng,
// so capture-on and capture-off runs are bit-identical.
function pushEvent(eventCtx, ev) {
  if (!eventCtx) return;
  ev.team = eventCtx.team;
  ev.quarter = eventCtx.quarter;
  eventCtx.events.push(ev);
}
```

Modify `simulatePossession` signature to accept the optional 8th param:

```js
function simulatePossession(offense, offenseBox, defense, defenseBox, rng, synergy, log, eventCtx) {
```

Insert `pushEvent` calls parallel to each existing `logPlay` (no reordering of any rng() call):

- Right after `handler`/`onBallDefender` are picked and energy drained:
  ```js
  pushEvent(eventCtx, { type: 'possession', playerId: handler.id });
  ```
- In the turnover branch, before `return 0`:
  ```js
  pushEvent(eventCtx, { type: 'turnover', playerId: handler.id, defenderId: stolen ? onBallDefender.id : null });
  ```
- In the block branch, before `return 0`:
  ```js
  pushEvent(eventCtx, { type: 'block', playerId: shooter.id, defenderId: shotDefender.id, zone: zone });
  ```
- For the shot (made or missed) — in the made branch after the assist roll resolves, and in the missed branch before the rebound roll:
  ```js
  // made branch (assistLine already resolved; capture the passer id):
  pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: true, points: shotValue, assistPlayerId: assistPlayerId });
  // missed branch:
  pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: false, points: 0, assistPlayerId: null });
  ```
  To capture the passer id, hoist a variable in the made branch: `var assistPlayerId = null;` and set `assistPlayerId = passer.id;` where `passer` is picked (keep the existing `assistLine` string logic unchanged).
- In each rebound branch:
  ```js
  pushEvent(eventCtx, { type: 'rebound', playerId: rebounder.id, offensive: true });   // offensive branch — note team below
  pushEvent(eventCtx, { type: 'rebound', playerId: rebounder.id, offensive: false });
  ```
  **Important:** `pushEvent` stamps `ev.team = eventCtx.team` (the offense's side). For the *defensive* rebound the rebounder is on the other side, so pass a flipped context:
  ```js
  pushEvent(eventCtx && { events: eventCtx.events, team: eventCtx.team === 'home' ? 'away' : 'home', quarter: eventCtx.quarter }, { type: 'rebound', playerId: rebounder.id, offensive: false });
  ```
- In the shooting-foul branch after FTs resolve:
  ```js
  pushEvent(eventCtx, { type: 'foul-ft', playerId: shooter.id, defenderId: shotDefender.id, made: made2, attempts: ftAttempts, points: made2 });
  ```

Modify `simulatePossessionGame` to accept and thread options:

```js
function simulatePossessionGame(homeTeamId, awayTeamId, rng, options) {
```

In the possession loop, build per-side contexts (quarter recomputed each iteration):

```js
  const captureEvents = options && options.events ? options.events : null;
  ...
  for (let i = 0; i < POSSESSIONS_PER_TEAM; i++) {
    const quarter = Math.floor(i / POSSESSIONS_PER_QUARTER) + 1;
    if (i % POSSESSIONS_PER_QUARTER === 0) {
      playByPlay.push('--- Q' + quarter + ' ---');
    }
    const homeCtx = captureEvents ? { events: captureEvents, team: 'home', quarter: quarter } : null;
    const awayCtx = captureEvents ? { events: captureEvents, team: 'away', quarter: quarter } : null;
    homeScore += simulatePossession(homeRoster, homeBox, awayRoster, awayBox, rng, { offense: homeSynergy, defense: awaySynergy }, playByPlay, homeCtx);
    awayScore += simulatePossession(awayRoster, awayBox, homeRoster, homeBox, rng, { offense: awaySynergy, defense: homeSynergy }, playByPlay, awayCtx);
  }
```

In the tie-break block, mirror the nudge into the event stream:

```js
    if (homeMakes >= awayMakes) {
      homeBox[homeRoster[0].id].points += 1; homeScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'home', quarter: 4, playerId: homeRoster[0].id, points: 1 });
    } else {
      awayBox[awayRoster[0].id].points += 1; awayScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'away', quarter: 4, playerId: awayRoster[0].id, points: 1 });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/validate-pixel-events.js`
Expected: `checkNoRngDrift: OK`, `checkEventIntegrity: OK`, `All pixel event validations passed`

Also run the existing engine suite to prove nothing regressed:
Run: `node scripts/validate-possession.js && node scripts/validate-sim.js`
Expected: both end with their existing "All ... passed" lines.

- [ ] **Step 5: Commit**

```bash
git add simEnginePossession.js scripts/validate-pixel-events.js
git commit -m "feat: structured event capture in possession engine for pixel game view"
```

---

### Task 2: Choreographer — event log → keyframe timeline

**Files:**
- Create: `ui/pixelChoreographer.js`
- Test: `scripts/validate-pixel-choreographer.js`

**Interfaces:**
- Consumes: the Event Log Format; player objects with `id`, `position` (`'PG'|'SG'|'SF'|'PF'|'C'`), and a box score with per-player `minutes`.
- Produces (globals + module exports):
  - `PIXEL_STAGE = { w: 480, h: 270, court: { x: 20, y: 64, w: 440, h: 192 }, hoops: { left: { x: 34, y: 160 }, right: { x: 446, y: 160 } } }`
  - `buildTimeline(session)` → `{ keyframes, durationMs }` where `session = { events, homeRoster, awayRoster, boxScore }` (rosters are arrays of player objects). Each keyframe: `{ t, pos: { [playerId]: [x, y] }, ball: { x, y, holder }, score: [home, away], quarter, clock, text }`. `t` in ms at 1× speed, strictly increasing. `holder` is a playerId or `null` (ball in flight). `clock` is seconds remaining in the quarter. `text` is a short play description or `''`.

Home always attacks the **right** hoop; away attacks the left (documented simplification — no halftime side switch).

- [ ] **Step 1: Write the failing test**

`scripts/validate-pixel-choreographer.js`:

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
const league = require(path.join(__dirname, '..', 'league.js'));
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

function buildSession(seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed + 9) % TEAMS.length];
  const events = [];
  const result = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });
  return {
    session: {
      events: events,
      homeRoster: league.getTeamRoster(home.id),
      awayRoster: league.getTeamRoster(away.id),
      boxScore: result.boxScore
    },
    result: result
  };
}

function checkTimelineShape() {
  const built = buildSession(3);
  const tl = choreo.buildTimeline(built.session);
  assert.ok(tl.keyframes.length > 100, 'a full game should produce many keyframes');
  assert.ok(tl.durationMs > 60000, 'a full game at 1x should exceed a minute');
  let lastT = -1;
  tl.keyframes.forEach(function (kf) {
    assert.ok(kf.t > lastT, 'keyframe t must be strictly increasing');
    lastT = kf.t;
    assert.ok(Array.isArray(kf.score) && kf.score.length === 2, 'score is [home, away]');
    assert.ok(kf.quarter >= 1 && kf.quarter <= 4, 'quarter in range');
    assert.ok(kf.clock >= 0 && kf.clock <= 720, 'clock within a 12-minute quarter');
  });
  assert.strictEqual(tl.keyframes[tl.keyframes.length - 1].t, tl.durationMs, 'duration matches last keyframe');
  console.log('checkTimelineShape: OK');
}
checkTimelineShape();

function checkPositionsInBounds() {
  const built = buildSession(7);
  const tl = choreo.buildTimeline(built.session);
  const c = choreo.PIXEL_STAGE.court;
  tl.keyframes.forEach(function (kf) {
    Object.keys(kf.pos).forEach(function (pid) {
      const p = kf.pos[pid];
      assert.ok(p[0] >= c.x && p[0] <= c.x + c.w, 'x in court bounds: ' + p[0]);
      assert.ok(p[1] >= c.y && p[1] <= c.y + c.h, 'y in court bounds: ' + p[1]);
    });
    assert.strictEqual(Object.keys(kf.pos).length, 10, 'exactly 10 players on court');
  });
  console.log('checkPositionsInBounds: OK');
}
checkPositionsInBounds();

function checkBallCustodyAndScore() {
  const built = buildSession(12);
  const tl = choreo.buildTimeline(built.session);
  const onCourtIds = {};
  built.session.homeRoster.concat(built.session.awayRoster).forEach(function (p) { onCourtIds[p.id] = true; });
  let lastScore = [0, 0];
  tl.keyframes.forEach(function (kf) {
    if (kf.ball.holder !== null) {
      assert.ok(onCourtIds[kf.ball.holder], 'ball holder must be a rostered player');
      assert.ok(kf.pos[kf.ball.holder], 'ball holder must be on court in this keyframe');
    }
    assert.ok(kf.score[0] >= lastScore[0] && kf.score[1] >= lastScore[1], 'score never decreases');
    lastScore = kf.score;
  });
  const last = tl.keyframes[tl.keyframes.length - 1];
  assert.strictEqual(last.score[0], built.result.homeScore, 'final home score matches sim');
  assert.strictEqual(last.score[1], built.result.awayScore, 'final away score matches sim');
  console.log('checkBallCustodyAndScore: OK');
}
checkBallCustodyAndScore();

function checkClockNeverRunsBackward() {
  const built = buildSession(21);
  const tl = choreo.buildTimeline(built.session);
  let lastQuarter = 1, lastClock = 720;
  tl.keyframes.forEach(function (kf) {
    if (kf.quarter === lastQuarter) {
      assert.ok(kf.clock <= lastClock, 'clock must not run backward within a quarter');
    } else {
      assert.ok(kf.quarter > lastQuarter, 'quarter only advances');
    }
    lastQuarter = kf.quarter;
    lastClock = kf.clock;
  });
  console.log('checkClockNeverRunsBackward: OK');
}
checkClockNeverRunsBackward();

console.log('All pixel choreographer validations passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: FAIL — `Cannot find module '.../ui/pixelChoreographer.js'`

- [ ] **Step 3: Implement the choreographer**

`ui/pixelChoreographer.js` (pure — no dependencies on other modules):

```js
// Turns a possession-engine event log (see simEnginePossession.js's pushEvent
// and the spec's Event Log Format) into a keyframe timeline the pixel game
// view interpolates between. Pure data-in data-out — no canvas, no GameState —
// so scripts/validate-pixel-choreographer.js can exercise it in Node.

const PIXEL_STAGE = {
  w: 480, h: 270,
  court: { x: 20, y: 64, w: 440, h: 192 },
  hoops: { left: { x: 34, y: 160 }, right: { x: 446, y: 160 } }
};

// Home attacks right, away attacks left, all game — no halftime side switch.
// A watched game is theater; keeping one attack direction per team makes the
// flow readable at a glance and halves the formation math.
function attackingHoop(team) { return team === 'home' ? PIXEL_STAGE.hoops.right : PIXEL_STAGE.hoops.left; }

// Offensive formation offsets from the attacked hoop, keyed by position.
// dx is "toward half court" (sign-flipped for the left hoop); dy from hoop centerline.
const OFFENSE_SPOTS = {
  PG: { dx: 115, dy: 0 },
  SG: { dx: 85, dy: -58 },
  SF: { dx: 85, dy: 58 },
  PF: { dx: 32, dy: -40 },
  C: { dx: 32, dy: 40 }
};
const POSITION_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];

function clampToCourt(x, y) {
  const c = PIXEL_STAGE.court;
  return [
    Math.max(c.x, Math.min(c.x + c.w, Math.round(x))),
    Math.max(c.y, Math.min(c.y + c.h, Math.round(y)))
  ];
}

// Spot on court for the i-th on-court player (sorted into POSITION_ORDER) of
// `team`, when `offenseTeam` has the ball. Defenders sag 14px toward their own hoop.
function formationSpot(team, slotPosition, offenseTeam) {
  const onOffense = team === offenseTeam;
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1; // toward half court from the attacked hoop
  const spot = OFFENSE_SPOTS[slotPosition];
  const x = hoop.x + dir * spot.dx + (onOffense ? 0 : dir * -14);
  const y = hoop.y + spot.dy * (onOffense ? 1 : 0.8);
  return clampToCourt(x, y);
}

// Shot origin by zone, deterministic jitter from a counter so repeated shots
// don't overlap pixel-perfectly.
function shotSpot(offenseTeam, zone, jitterSeed) {
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1;
  const jitter = ((jitterSeed * 37) % 5) - 2; // -2..2
  const dist = zone === 'three' ? 98 : (zone === 'mid' ? 55 : 14);
  const dy = zone === 'inside' ? jitter * 3 : jitter * 14;
  return clampToCourt(hoop.x + dir * dist, hoop.y + dy);
}

// The engine has no bench/rotation, so the view fields each team's five
// most-used players (by minutes) and swaps a sprite in whenever an event
// names someone not currently shown (swap out the lowest-minutes non-participant).
function startingFive(roster, boxScore) {
  return roster
    .filter(function (p) { return boxScore[p.id]; })
    .slice()
    .sort(function (a, b) { return boxScore[b.id].minutes - boxScore[a.id].minutes; })
    .slice(0, 5);
}

// Sort the current five into PG/SG/SF/PF/C display slots: exact position match
// first, remaining players fill leftover slots in order.
function assignSlots(five) {
  const slots = {};
  const unassigned = five.slice();
  POSITION_ORDER.forEach(function (posName) {
    const idx = unassigned.findIndex(function (p) { return p.position === posName; });
    if (idx !== -1) { slots[posName] = unassigned.splice(idx, 1)[0]; }
  });
  POSITION_ORDER.forEach(function (posName) {
    if (!slots[posName]) slots[posName] = unassigned.shift();
  });
  return slots; // { PG: player, SG: player, ... }
}

function ensureOnCourt(five, roster, boxScore, neededIds) {
  neededIds.forEach(function (pid) {
    if (!pid) return;
    if (five.some(function (p) { return p.id === pid; })) return;
    const sub = roster.find(function (p) { return p.id === pid; });
    if (!sub) return;
    // Swap out the lowest-minutes player not needed this possession.
    let outIdx = -1, outMin = Infinity;
    five.forEach(function (p, i) {
      if (neededIds.indexOf(p.id) !== -1) return;
      const m = boxScore[p.id] ? boxScore[p.id].minutes : 0;
      if (m < outMin) { outMin = m; outIdx = i; }
    });
    if (outIdx !== -1) five[outIdx] = sub;
  });
}

// Beat durations at 1x (ms). One possession pair ≈ 1.4s → a 90-pair game plays
// in roughly 4–5 minutes including free-throw pauses, matching the spec.
const BEAT = { formation: 550, action: 450, resolve: 400, ft: 500 };

function buildTimeline(session) {
  const events = session.events;
  const rosters = { home: session.homeRoster, away: session.awayRoster };
  const boxScore = session.boxScore;
  const five = {
    home: startingFive(session.homeRoster, boxScore),
    away: startingFive(session.awayRoster, boxScore)
  };

  // Group events into possessions: a 'possession' event opens one; terminal
  // events (turnover/block/shot) close it; rebound/foul-ft trail the terminal.
  const possessions = [];
  let current = null;
  events.forEach(function (ev) {
    if (ev.type === 'possession') {
      current = { team: ev.team, quarter: ev.quarter, handlerId: ev.playerId, plays: [] };
      possessions.push(current);
    } else if (ev.type === 'tiebreak') {
      possessions.push({ team: ev.team, quarter: 4, handlerId: ev.playerId, plays: [ev], tiebreak: true });
    } else if (current) {
      current.plays.push(ev);
    }
  });

  // Clock: divide each quarter's 720s evenly across its possessions.
  const perQuarter = {};
  possessions.forEach(function (p) { perQuarter[p.quarter] = (perQuarter[p.quarter] || 0) + 1; });

  const keyframes = [];
  let t = 0;
  const score = [0, 0];
  const quarterSeen = {};

  function positionsFor(offenseTeam) {
    const pos = {};
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        pos[p.id] = formationSpot(side, posName, offenseTeam);
      });
    });
    return pos;
  }

  function push(dt, pos, ball, quarter, clock, text) {
    t += dt;
    keyframes.push({ t: t, pos: pos, ball: ball, score: score.slice(), quarter: quarter, clock: Math.max(0, Math.round(clock)), text: text || '' });
  }

  possessions.forEach(function (poss, pi) {
    quarterSeen[poss.quarter] = (quarterSeen[poss.quarter] || 0) + 1;
    const clock = 720 - (quarterSeen[poss.quarter] / perQuarter[poss.quarter]) * 720;
    const clockStart = 720 - ((quarterSeen[poss.quarter] - 1) / perQuarter[poss.quarter]) * 720;

    if (poss.tiebreak) {
      const ev = poss.plays[0];
      score[ev.team === 'home' ? 0 : 1] += ev.points;
      const pos = positionsFor(ev.team);
      const hoop = attackingHoop(ev.team);
      push(BEAT.resolve, pos, { x: hoop.x, y: hoop.y, holder: null }, 4, 0, 'Late free throw decides it!');
      return;
    }

    const neededIds = [poss.handlerId];
    poss.plays.forEach(function (ev) {
      neededIds.push(ev.playerId);
      if (ev.defenderId) neededIds.push(ev.defenderId);
      if (ev.assistPlayerId) neededIds.push(ev.assistPlayerId);
    });
    ensureOnCourt(five[poss.team], rosters[poss.team], boxScore,
      neededIds.filter(function (id) { return rosters[poss.team].some(function (p) { return p.id === id; }); }));
    const defSide = poss.team === 'home' ? 'away' : 'home';
    ensureOnCourt(five[defSide], rosters[defSide], boxScore,
      neededIds.filter(function (id) { return rosters[defSide].some(function (p) { return p.id === id; }); }));

    const pos = positionsFor(poss.team);
    const handlerPos = pos[poss.handlerId] || formationSpot(poss.team, 'PG', poss.team);

    // Beat 1: formation — everyone at spots, handler has the ball.
    push(BEAT.formation, pos, { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, poss.quarter, clockStart, '');

    const hoop = attackingHoop(poss.team);

    poss.plays.forEach(function (ev, ei) {
      if (ev.type === 'turnover') {
        const stealerPos = ev.defenderId && pos[ev.defenderId] ? pos[ev.defenderId] : [hoop.x, hoop.y];
        push(BEAT.action, pos, { x: stealerPos[0], y: stealerPos[1], holder: ev.defenderId || null }, poss.quarter, clock,
          ev.defenderId ? 'Steal!' : 'Turnover');
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = Object.assign({}, pos);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.action, shotPos, { x: sp[0], y: sp[1], holder: ev.playerId }, poss.quarter, clock, '');
        push(BEAT.resolve, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, poss.quarter, clock, 'Blocked!');
      } else if (ev.type === 'shot') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = Object.assign({}, pos);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        // pass beat (only when someone else creates the shot)
        if (ev.assistPlayerId || ev.playerId !== poss.handlerId) {
          push(BEAT.action, shotPos, { x: sp[0], y: sp[1], holder: ev.playerId }, poss.quarter, clock, '');
        }
        if (ev.made) score[ev.team === 'home' ? 0 : 1] += ev.points;
        // ball arcs to the hoop
        push(BEAT.resolve, shotPos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          ev.made ? (ev.points === 3 ? 'Three-pointer!' : 'It\'s good!') : '');
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, pos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        push(BEAT.resolve, rpos, { x: rp[0], y: rp[1], holder: ev.playerId }, poss.quarter, clock,
          ev.offensive ? 'Offensive board' : '');
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, pos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts);
      }
    });
  });

  return { keyframes: keyframes, durationMs: t };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PIXEL_STAGE: PIXEL_STAGE, buildTimeline: buildTimeline, startingFive: startingFive, assignSlots: assignSlots };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: all four `check...: OK` lines, then `All pixel choreographer validations passed`. If `checkBallCustodyAndScore` fails on the holder-on-court assertion, the cause is a sub swap that removed a player who still holds the ball in a later beat of the same possession — fix by including every `neededIds` participant in the swap-protection list (already done above via the `neededIds.indexOf` guard in `ensureOnCourt`).

- [ ] **Step 5: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-pixel-choreographer.js
git commit -m "feat: pixel game choreographer - event log to keyframe timeline"
```

---

### Task 3: Procedural sprites and court drawing

**Files:**
- Create: `ui/pixelSprites.js`
- Create: `ui/pixelCourt.js`
- Test: `scripts/validate-pixel-sprites.js` (pure helpers only; canvas output is verified in-browser in Task 6)

**Interfaces:**
- Consumes: `PIXEL_STAGE` from Task 2; players with `face` (`face.body.color` skin, `face.hair.color` hair) and `jerseyNumber`; teams with `colors.primary` / `colors.secondary`.
- Produces:
  - `spriteColorsForPlayer(player, team, isHome)` → `{ skin, hair, jersey, trim }` (home wears `colors.primary` jersey, away wears white with primary trim).
  - `drawPlayerSprite(ctx, x, y, colors, number, opts)` — draws a ~10×24 sprite centered-bottom at (x, y); `opts = { frame: 0|1, shooting: bool, highlight: bool }`.
  - `drawBall(ctx, x, y)` — 3×3 orange ball.
  - `drawPixelNumber(ctx, x, y, number, color)` — 3×5-per-digit bitmap font.
  - `buildCourtCanvas(homeTeam, awayTeam, logoImg|null)` → offscreen `<canvas>` (480×270) with crowd strip, parquet, lines, team-colored keys, center logo.

- [ ] **Step 1: Write the failing test**

`scripts/validate-pixel-sprites.js`:

```js
const assert = require('assert');
const path = require('path');
const sprites = require(path.join(__dirname, '..', 'ui', 'pixelSprites.js'));

function checkSpriteColors() {
  const player = { face: { body: { color: '#bb876f' }, hair: { color: '#272421' } }, jerseyNumber: 7 };
  const team = { colors: { primary: '#007A33', secondary: '#BA9653' } };
  const home = sprites.spriteColorsForPlayer(player, team, true);
  assert.strictEqual(home.skin, '#bb876f');
  assert.strictEqual(home.hair, '#272421');
  assert.strictEqual(home.jersey, '#007A33', 'home wears primary');
  assert.strictEqual(home.trim, '#BA9653');
  const away = sprites.spriteColorsForPlayer(player, team, false);
  assert.strictEqual(away.jersey, '#FFFFFF', 'away wears white');
  assert.strictEqual(away.trim, '#007A33', 'away trim is primary');
  console.log('checkSpriteColors: OK');
}
checkSpriteColors();

function checkSpriteColorsFallback() {
  // Players without a generated face (should not happen, but degrade gracefully).
  const player = { jerseyNumber: 12 };
  const team = { colors: { primary: '#000000', secondary: '#FFFFFF' } };
  const c = sprites.spriteColorsForPlayer(player, team, true);
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.skin), 'fallback skin is a hex color');
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.hair), 'fallback hair is a hex color');
  console.log('checkSpriteColorsFallback: OK');
}
checkSpriteColorsFallback();

function checkDigitFont() {
  for (let d = 0; d <= 9; d++) {
    const glyph = sprites.DIGIT_FONT[String(d)];
    assert.ok(Array.isArray(glyph) && glyph.length === 5, 'digit ' + d + ' is 5 rows');
    glyph.forEach(function (row) { assert.strictEqual(row.length, 3, 'rows are 3 cols'); });
  }
  console.log('checkDigitFont: OK');
}
checkDigitFont();

console.log('All pixel sprite validations passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/validate-pixel-sprites.js`
Expected: FAIL — `Cannot find module '.../ui/pixelSprites.js'`

- [ ] **Step 3: Implement `ui/pixelSprites.js`**

```js
// Procedural pixel sprites for the game view — no image assets, matching the
// repo's zero-asset style. Drawing functions take a canvas 2d context; the
// color/font helpers are pure so scripts/validate-pixel-sprites.js can test
// them in Node.

// 3x5 bitmap digits for jersey numbers ('1' = filled pixel).
const DIGIT_FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
};

const FALLBACK_SKIN = '#bb876f';
const FALLBACK_HAIR = '#272421';

// Home wears primary; away wears white with primary trim (classic home-dark /
// away-white readability so the two sides never share a jersey color).
function spriteColorsForPlayer(player, team, isHome) {
  const face = player.face || {};
  return {
    skin: (face.body && face.body.color) || FALLBACK_SKIN,
    hair: (face.hair && face.hair.color) || FALLBACK_HAIR,
    jersey: isHome ? team.colors.primary : '#FFFFFF',
    trim: isHome ? team.colors.secondary : team.colors.primary
  };
}

function drawPixelNumber(ctx, x, y, number, color) {
  const digits = String(number);
  ctx.fillStyle = color;
  for (let d = 0; d < digits.length; d++) {
    const glyph = DIGIT_FONT[digits[d]];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] === '1') ctx.fillRect(x + d * 4 + col, y + row, 1, 1);
      }
    }
  }
}

// ~10 wide x 24 tall, anchored center-bottom at (x, y). frame toggles the leg
// bob; shooting raises the arms; highlight draws the ball-handler ring.
function drawPlayerSprite(ctx, x, y, colors, number, opts) {
  opts = opts || {};
  const left = Math.round(x) - 5;
  const top = Math.round(y) - 24;

  if (opts.highlight) {
    ctx.fillStyle = 'rgba(255, 235, 59, 0.9)';
    ctx.fillRect(left - 1, Math.round(y) - 1, 12, 2);
  }

  // legs (2-frame bob)
  ctx.fillStyle = colors.skin;
  const bob = opts.frame ? 1 : 0;
  ctx.fillRect(left + 2, top + 18 + bob, 2, 6 - bob);
  ctx.fillRect(left + 6, top + 18 + (1 - bob), 2, 6 - (1 - bob));
  // shorts
  ctx.fillStyle = colors.jersey;
  ctx.fillRect(left + 1, top + 15, 8, 4);
  // torso / jersey
  ctx.fillRect(left + 1, top + 8, 8, 8);
  ctx.fillStyle = colors.trim;
  ctx.fillRect(left + 1, top + 8, 8, 1); // shoulder trim
  // arms
  ctx.fillStyle = colors.skin;
  if (opts.shooting) {
    ctx.fillRect(left, top + 2, 2, 7);
    ctx.fillRect(left + 8, top + 2, 2, 7);
  } else {
    ctx.fillRect(left, top + 9, 2, 6);
    ctx.fillRect(left + 8, top + 9, 2, 6);
  }
  // head + hair
  ctx.fillRect(left + 3, top + 2, 4, 5);
  ctx.fillStyle = colors.hair;
  ctx.fillRect(left + 2, top, 6, 3);
  // jersey number (single digit centered, two digits offset)
  const numStr = String(number == null ? '' : number);
  if (numStr.length > 0) {
    const numX = left + (numStr.length === 1 ? 4 : 2);
    drawPixelNumber(ctx, numX, top + 10, numStr, colors.trim === '#FFFFFF' ? '#FFFFFF' : colors.trim);
  }
}

function drawBall(ctx, x, y) {
  ctx.fillStyle = '#e8760e';
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  ctx.fillStyle = '#8a4207';
  ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIGIT_FONT: DIGIT_FONT,
    spriteColorsForPlayer: spriteColorsForPlayer,
    drawPixelNumber: drawPixelNumber,
    drawPlayerSprite: drawPlayerSprite,
    drawBall: drawBall
  };
}
```

- [ ] **Step 4: Implement `ui/pixelCourt.js`** (browser-only drawing; no Node test — verified in Task 6)

```js
// Builds the static pixel court scene once on an offscreen canvas: crowd
// strip, parquet floor, top-down court lines, team-colored keys, center logo.
// Redrawn only when a new watch session starts, then blitted every frame by
// ui/pixelGameView.js. Depends on PIXEL_STAGE (ui/pixelChoreographer.js).

// Tiny deterministic LCG just for crowd variety — NOT the game rng (the crowd
// is pure decoration and must never touch sim determinism).
function crowdRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const CROWD_SKIN = ['#f2d6cb', '#eab687', '#bb876f', '#74453d'];
const CROWD_SHIRT = ['#3a4a5a', '#6b3f2e', '#4a6b3f', '#7a6a4a', '#5a3a6a', '#333333'];

function buildCourtCanvas(homeTeam, awayTeam, logoImg) {
  const canvas = document.createElement('canvas');
  canvas.width = PIXEL_STAGE.w;
  canvas.height = PIXEL_STAGE.h;
  const ctx = canvas.getContext('2d');
  const c = PIXEL_STAGE.court;

  // arena backdrop + crowd strip (top band above the court)
  ctx.fillStyle = '#1c2026';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rng = crowdRng(0xC0FFEE);
  for (let row = 0; row < 3; row++) {
    for (let cx = 4; cx < canvas.width - 4; cx += 10) {
      const px = cx + Math.floor(rng() * 3);
      const py = 8 + row * 16;
      ctx.fillStyle = CROWD_SHIRT[Math.floor(rng() * CROWD_SHIRT.length)];
      ctx.fillRect(px, py + 4, 6, 8);
      ctx.fillStyle = CROWD_SKIN[Math.floor(rng() * CROWD_SKIN.length)];
      ctx.fillRect(px + 1, py, 4, 4);
    }
  }

  // parquet floor (alternating tan tiles)
  for (let ty = c.y - 8; ty < c.y + c.h + 8; ty += 16) {
    for (let tx = c.x - 12; tx < c.x + c.w + 12; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? '#c9974f' : '#bd8a42';
      ctx.fillRect(tx, ty, 16, 16);
    }
  }

  // boundary + half-court
  ctx.strokeStyle = '#f4ead8';
  ctx.lineWidth = 1;
  ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w, c.h);
  const midX = c.x + c.w / 2;
  ctx.beginPath(); ctx.moveTo(midX + 0.5, c.y); ctx.lineTo(midX + 0.5, c.y + c.h); ctx.stroke();
  ctx.beginPath(); ctx.arc(midX, c.y + c.h / 2, 24, 0, Math.PI * 2); ctx.stroke();

  // keys (painted in home primary, both ends) + hoops + 3pt arcs
  [['left', 1], ['right', -1]].forEach(function (side) {
    const hoop = PIXEL_STAGE.hoops[side[0]];
    const dir = side[1]; // +1 = key extends rightward from left baseline
    const keyW = 56, keyH = 64;
    const keyX = dir === 1 ? c.x : c.x + c.w - keyW;
    ctx.fillStyle = homeTeam.colors.primary;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(keyX, hoop.y - keyH / 2, keyW, keyH);
    ctx.globalAlpha = 1;
    ctx.strokeRect(keyX + 0.5, hoop.y - keyH / 2 + 0.5, keyW, keyH);
    ctx.beginPath();
    ctx.arc(keyX + (dir === 1 ? keyW : 0), hoop.y, 20, dir === 1 ? -Math.PI / 2 : Math.PI / 2, dir === 1 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    // 3pt arc
    ctx.beginPath();
    ctx.arc(hoop.x, hoop.y, 96, dir === 1 ? -Math.PI / 2.4 : Math.PI - Math.PI / 2.4, dir === 1 ? Math.PI / 2.4 : Math.PI + Math.PI / 2.4);
    ctx.stroke();
    // hoop: backboard + rim
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(hoop.x + (dir === 1 ? -6 : 5), hoop.y - 7, 2, 14);
    ctx.fillStyle = '#e05a2b';
    ctx.fillRect(hoop.x - 2, hoop.y - 2, 5, 5);
    ctx.fillStyle = '#c9974f';
    ctx.fillRect(hoop.x - 1, hoop.y - 1, 3, 3);
  });

  // center-court logo: existing team logo PNG, pixel-scaled, subtle
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(logoImg, midX - 20, c.y + c.h / 2 - 20, 40, 40);
    ctx.globalAlpha = 1;
  }

  return canvas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCourtCanvas: buildCourtCanvas };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node scripts/validate-pixel-sprites.js`
Expected: `checkSpriteColors: OK`, `checkSpriteColorsFallback: OK`, `checkDigitFont: OK`, `All pixel sprite validations passed`

- [ ] **Step 6: Commit**

```bash
git add ui/pixelSprites.js ui/pixelCourt.js scripts/validate-pixel-sprites.js
git commit -m "feat: procedural pixel sprites and court renderer"
```

---

### Task 4: Pixel game view shell (playback, scoreboard, controls)

**Files:**
- Create: `ui/pixelGameView.js`
- Modify: `style.css` (append pixel-view styles)

**Interfaces:**
- Consumes: `buildTimeline` / `PIXEL_STAGE` (Task 2), `spriteColorsForPlayer` / `drawPlayerSprite` / `drawBall` (Task 3), `buildCourtCanvas` (Task 3), `getTeamById`, `getPlayerById`, `getTeamLogoUrl`, `escapeHtml`, `renderView`.
- Produces:
  - `setWatchSession(session)` — `session = { homeTeamId, awayTeamId, events, boxScore, homeScore, awayScore }`; stored module-locally (never in `GameState`).
  - `renderPixelGame(container)` — the `BUILT_VIEWS.pixelGame` renderer; empty-state when no session.

- [ ] **Step 1: Implement `ui/pixelGameView.js`**

```js
// The "Watch Game" view: plays a choreographed keyframe timeline
// (ui/pixelChoreographer.js) on a pixel-art canvas (ui/pixelCourt.js,
// ui/pixelSprites.js). Playback state (including the event log) lives in this
// module, never in GameState — a watched game is already recorded via the
// normal applyGameResult path before this view ever opens, so navigating
// away, reloading, or saving mid-watch can't corrupt anything (spec:
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md).

let _watchSession = null;   // set by the Watch Next Game handler, cleared on exit
let _rafId = null;

const PIXEL_SPEEDS = [1, 2, 4, 8];

function setWatchSession(session) { _watchSession = session; }

function stopPixelPlayback() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

function lerp(a, b, f) { return a + (b - a) * f; }

function renderPixelGame(container) {
  stopPixelPlayback();
  if (!_watchSession) {
    container.innerHTML = '<div class="view-header"><h2>Watch Game</h2></div>' +
      '<div class="empty-state">No game to watch. Use "Watch Next Game" in the sim dock.</div>';
    return;
  }
  const session = _watchSession;
  const homeTeam = getTeamById(session.homeTeamId);
  const awayTeam = getTeamById(session.awayTeamId);

  const homeRoster = Object.keys(session.boxScore)
    .map(function (id) { return getPlayerById(id); })
    .filter(function (p) { return p && session.boxScore[p.id].teamId === session.homeTeamId; });
  const awayRoster = Object.keys(session.boxScore)
    .map(function (id) { return getPlayerById(id); })
    .filter(function (p) { return p && session.boxScore[p.id].teamId === session.awayTeamId; });

  const timeline = buildTimeline({
    events: session.events,
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    boxScore: session.boxScore
  });

  const playerById = {};
  const colorsById = {};
  homeRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, homeTeam, true); });
  awayRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, awayTeam, false); });

  container.innerHTML =
    '<div class="pixel-game">' +
      '<div class="pixel-scoreboard">' +
        '<span class="pixel-score-team" style="border-color:' + homeTeam.colors.primary + '">' + escapeHtml(homeTeam.id) + ' <span id="pixel-score-home">0</span></span>' +
        '<span class="pixel-clock"><span id="pixel-quarter">Q1</span> <span id="pixel-clock">12:00</span></span>' +
        '<span class="pixel-score-team" style="border-color:' + awayTeam.colors.primary + '">' + escapeHtml(awayTeam.id) + ' <span id="pixel-score-away">0</span></span>' +
      '</div>' +
      '<div class="pixel-canvas-wrap"><canvas id="pixel-canvas" width="' + PIXEL_STAGE.w + '" height="' + PIXEL_STAGE.h + '"></canvas></div>' +
      '<div class="pixel-ticker" id="pixel-ticker">&nbsp;</div>' +
      '<div class="pixel-controls">' +
        '<button id="pixel-play-pause">Pause</button>' +
        PIXEL_SPEEDS.map(function (s) {
          return '<button class="pixel-speed' + (s === 1 ? ' active' : '') + '" data-speed="' + s + '">' + s + '\u00d7</button>';
        }).join('') +
        '<button id="pixel-skip">Skip to Final</button>' +
        '<button id="pixel-exit">Exit</button>' +
      '</div>' +
    '</div>';

  const canvas = document.getElementById('pixel-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Court background, with the home logo layered in once it loads.
  let courtCanvas = buildCourtCanvas(homeTeam, awayTeam, null);
  const logoImg = new Image();
  logoImg.onload = function () { courtCanvas = buildCourtCanvas(homeTeam, awayTeam, logoImg); };
  logoImg.src = getTeamLogoUrl(session.homeTeamId);

  let playbackMs = 0;
  let speed = 1;
  let paused = false;
  let lastFrameTs = null;
  let kfIndex = 0;
  const kfs = timeline.keyframes;

  function currentFrame() {
    while (kfIndex < kfs.length - 1 && kfs[kfIndex + 1].t <= playbackMs) kfIndex++;
    while (kfIndex > 0 && kfs[kfIndex].t > playbackMs) kfIndex--;
    const a = kfs[kfIndex];
    const b = kfs[Math.min(kfIndex + 1, kfs.length - 1)];
    const span = Math.max(1, b.t - a.t);
    const f = Math.max(0, Math.min(1, (playbackMs - a.t) / span));
    return { a: a, b: b, f: f };
  }

  function fmtClock(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function draw() {
    const fr = currentFrame();
    ctx.drawImage(courtCanvas, 0, 0);

    // players: lerp positions between keyframes; draw top-to-bottom for overlap
    const ids = Object.keys(fr.a.pos).filter(function (id) { return fr.b.pos[id]; });
    ids.sort(function (i1, i2) {
      return lerp(fr.a.pos[i1][1], fr.b.pos[i1][1], fr.f) - lerp(fr.a.pos[i2][1], fr.b.pos[i2][1], fr.f);
    });
    const walkFrame = Math.floor(playbackMs / 180) % 2;
    ids.forEach(function (pid) {
      const x = lerp(fr.a.pos[pid][0], fr.b.pos[pid][0], fr.f);
      const y = lerp(fr.a.pos[pid][1], fr.b.pos[pid][1], fr.f);
      const isHolder = fr.a.ball.holder === pid;
      const p = playerById[pid];
      drawPlayerSprite(ctx, x, y, colorsById[pid], p ? p.jerseyNumber : '', {
        frame: walkFrame,
        shooting: fr.b.ball.holder === null && isHolder,
        highlight: isHolder
      });
    });

    // ball: follows holder, otherwise lerps with a small arc
    let bx, by;
    if (fr.a.ball.holder && fr.a.pos[fr.a.ball.holder]) {
      bx = lerp(fr.a.pos[fr.a.ball.holder][0], (fr.b.pos[fr.a.ball.holder] || fr.a.pos[fr.a.ball.holder])[0], fr.f) + 6;
      by = lerp(fr.a.pos[fr.a.ball.holder][1], (fr.b.pos[fr.a.ball.holder] || fr.a.pos[fr.a.ball.holder])[1], fr.f) - 10;
    } else {
      bx = lerp(fr.a.ball.x, fr.b.ball.x, fr.f);
      by = lerp(fr.a.ball.y, fr.b.ball.y, fr.f) - Math.sin(fr.f * Math.PI) * 18; // flight arc
    }
    drawBall(ctx, bx, by);

    // ball-handler name label
    if (fr.a.ball.holder && playerById[fr.a.ball.holder] && fr.a.pos[fr.a.ball.holder]) {
      const hp = fr.a.pos[fr.a.ball.holder];
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const label = playerById[fr.a.ball.holder].name;
      ctx.font = '8px monospace';
      const w = ctx.measureText(label).width + 4;
      ctx.fillRect(hp[0] - w / 2, hp[1] + 3, w, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, hp[0] - w / 2 + 2, hp[1] + 11);
    }

    document.getElementById('pixel-score-home').textContent = fr.a.score[0];
    document.getElementById('pixel-score-away').textContent = fr.a.score[1];
    document.getElementById('pixel-quarter').textContent = 'Q' + fr.a.quarter;
    document.getElementById('pixel-clock').textContent = fmtClock(fr.a.clock);
    if (fr.a.text) document.getElementById('pixel-ticker').textContent = fr.a.text;
  }

  function showFinal() {
    playbackMs = timeline.durationMs;
    draw();
    document.getElementById('pixel-ticker').textContent =
      'FINAL: ' + homeTeam.id + ' ' + session.homeScore + ' \u2014 ' + awayTeam.id + ' ' + session.awayScore;
    document.getElementById('pixel-play-pause').disabled = true;
  }

  function tick(ts) {
    if (lastFrameTs === null) lastFrameTs = ts;
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;
    if (!paused) playbackMs += dt * speed;
    if (playbackMs >= timeline.durationMs) { showFinal(); _rafId = null; return; }
    draw();
    _rafId = requestAnimationFrame(tick);
  }

  document.getElementById('pixel-play-pause').addEventListener('click', function () {
    paused = !paused;
    this.textContent = paused ? 'Play' : 'Pause';
  });
  Array.prototype.forEach.call(container.querySelectorAll('.pixel-speed'), function (btn) {
    btn.addEventListener('click', function () {
      speed = Number(btn.getAttribute('data-speed'));
      container.querySelectorAll('.pixel-speed').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });
  document.getElementById('pixel-skip').addEventListener('click', function () {
    stopPixelPlayback();
    showFinal();
  });
  document.getElementById('pixel-exit').addEventListener('click', function () {
    stopPixelPlayback();
    _watchSession = null;
    renderView('dashboard');
  });

  _rafId = requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setWatchSession: setWatchSession, renderPixelGame: renderPixelGame, stopPixelPlayback: stopPixelPlayback };
}
```

- [ ] **Step 2: Append styles to `style.css`**

```css
/* ---- Pixel game view (Watch Game) ---- */
.pixel-game { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pixel-scoreboard {
  display: flex; gap: 16px; align-items: center; font-family: monospace;
  font-size: 1.1rem; font-weight: bold; letter-spacing: 1px;
  background: #14171c; padding: 6px 14px; border-radius: 4px;
}
.pixel-score-team { border-bottom: 3px solid; padding: 2px 6px; }
.pixel-clock { opacity: 0.85; }
.pixel-canvas-wrap { width: 100%; display: flex; justify-content: center; }
#pixel-canvas {
  image-rendering: pixelated;
  width: min(100%, 960px);
  border: 2px solid #14171c; border-radius: 2px;
}
.pixel-ticker { font-family: monospace; min-height: 1.2em; opacity: 0.9; }
.pixel-controls { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.pixel-controls .pixel-speed.active { outline: 2px solid #4a90d9; }
```

- [ ] **Step 3: Sanity-run all validate scripts** (view is browser-only; regression check that nothing Node-side broke)

Run: `node scripts/validate-pixel-events.js && node scripts/validate-pixel-choreographer.js && node scripts/validate-pixel-sprites.js`
Expected: all three end with their "All ... passed" lines.

- [ ] **Step 4: Commit**

```bash
git add ui/pixelGameView.js style.css
git commit -m "feat: pixel game view shell with playback controls"
```

---

### Task 5: Watch flow wiring (league, sim dock, view registry, index.html)

**Files:**
- Modify: `league.js` (`simulateDate` optional `watchOptions` param)
- Modify: `ui/simControls.js` (Watch Next Game button + handler)
- Modify: `script.js` (`BUILT_VIEWS.pixelGame`)
- Modify: `index.html` (script tags)
- Test: extend `scripts/validate-pixel-events.js` with a `simulateDate` watch-path check

**Interfaces:**
- Consumes: `setWatchSession` / `renderPixelGame` (Task 4), event capture (Task 1).
- Produces: `simulateDate(season, dayIndex, settings, rng, onDayComplete, watchOptions)` where `watchOptions = { gameId, events }` — the matching game sims via the possession engine with capture; all other games use the active engine.

- [ ] **Step 1: Write the failing test** — append to `scripts/validate-pixel-events.js` (before the final console.log):

```js
function checkSimulateDateWatchPath() {
  const schedule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'fatigue.js'));
  require(path.join(__dirname, '..', 'injuries.js'));
  require(path.join(__dirname, '..', 'morale.js'));
  const rng = makeRng(777);
  const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const day0Games = games.filter(function (g) { return g.day === 0; });
  assert.ok(day0Games.length > 0, 'day 0 should have games');
  const watched = day0Games[0];
  const events = [];
  // Active engine is boxscore — the watched game must still go through possession.
  league.simulateDate(season, 0, { simEngine: 'boxscore' }, rng, null, { gameId: watched.id, events: events });
  assert.ok(watched.played, 'watched game was played');
  assert.ok(events.length > 0, 'watched game captured events');
  assert.ok(watched.playByPlay && watched.playByPlay.length > 0, 'watched game has possession play-by-play');
  const others = day0Games.filter(function (g) { return g.id !== watched.id; });
  others.forEach(function (g) {
    assert.ok(g.played, 'other games still played');
    assert.strictEqual(g.playByPlay, null, 'other games used the boxscore engine (no play-by-play)');
  });
  let homePts = 0;
  events.forEach(function (ev) { if (ev.team === 'home') homePts += (ev.points || 0); });
  assert.strictEqual(homePts, watched.homeScore, 'watched game event points match recorded score');
  console.log('checkSimulateDateWatchPath: OK');
}
checkSimulateDateWatchPath();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/validate-pixel-events.js`
Expected: FAIL — `checkSimulateDateWatchPath` gets 0 events (`simulateDate` ignores the 6th argument today).

- [ ] **Step 3: Implement the `league.js` change**

Replace the game loop in `simulateDate` (line ~168):

```js
function simulateDate(season, dayIndex, settings, rng, onDayComplete, watchOptions) {
  ...
  todaysGames.forEach(function (game) {
    // The watched game (Watch Next Game — ui/pixelGameView.js) always sims
    // through the possession engine regardless of the active engine setting:
    // a game simmed without possessions can't be watched. Event capture is
    // proven drift-free by scripts/validate-pixel-events.js, so the recorded
    // result is a normal possession-engine result.
    let result;
    if (watchOptions && game.id === watchOptions.gameId) {
      const watchEngine = deps.simEngine.getActiveEngine({ simEngine: 'possession' });
      result = watchEngine.simulateGame(game.homeTeamId, game.awayTeamId, rng, { events: watchOptions.events });
    } else {
      const engine = deps.simEngine.getActiveEngine(settings);
      result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);
    }
    applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/validate-pixel-events.js`
Expected: all checks incl. `checkSimulateDateWatchPath: OK`.
Also: `node scripts/validate-possession.js && node scripts/validate-sim.js` — still green.

- [ ] **Step 5: Add the Watch button + handler to `ui/simControls.js`**

Add after `handleNextGame`:

```js
// Watch Next Game: identical day-advance to handleNextGame, except the user's
// game sims through the possession engine with event capture and the pixel
// view opens on the result. Regular season only (the playoff sim path is
// separate — spec lists playoff watching as a follow-up).
async function handleWatchNextGame() {
  const container = document.getElementById('sim-controls');
  if (GameState.playoffBracket) return;
  const targetDay = getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay);
  if (targetDay === null) return;

  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'Simulating...';

  // Days before the user's game day sim exactly as Next Game does.
  if (targetDay - 1 > GameState.season.currentDay) {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay - 1, GameState.settings, GameState.rng, handleDayComplete);
  }
  const userGame = GameState.season.games.find(function (g) {
    return g.day === targetDay && !g.played && (g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId);
  });
  const events = [];
  simulateDate(GameState.season, targetDay, GameState.settings, GameState.rng, handleDayComplete,
    userGame ? { gameId: userGame.id, events: events } : null);
  GameState.season.currentDay = targetDay;

  if (statusEl) statusEl.textContent = '';
  if (!userGame || events.length === 0) {
    // Graceful fallback (spec): behave like a normal Next Game click.
    if (statusEl) statusEl.textContent = 'Game could not be watched — simmed normally.';
    renderView(GameState.currentView);
    autosave(GameState);
    return;
  }

  setWatchSession({
    homeTeamId: userGame.homeTeamId,
    awayTeamId: userGame.awayTeamId,
    events: events,
    boxScore: userGame.boxScore,
    homeScore: userGame.homeScore,
    awayScore: userGame.awayScore
  });
  autosave(GameState);
  renderView('pixelGame');
}
```

In `renderSimControls`, add the button to the primary dock group after `sim-next-game`:

```js
'<button id="sim-watch-game"' + (GameState.playoffBracket ? ' disabled title="Regular season only"' : '') + '>Watch Next Game</button>' +
```

and wire it with the other listeners:

```js
document.getElementById('sim-watch-game').addEventListener('click', handleWatchNextGame);
```

- [ ] **Step 6: Register the view and scripts**

`script.js` — add to `BUILT_VIEWS`:

```js
  pixelGame: renderPixelGame,
```

`index.html` — add before `<script src="script.js">`:

```html
  <script src="ui/pixelChoreographer.js"></script>
  <script src="ui/pixelSprites.js"></script>
  <script src="ui/pixelCourt.js"></script>
  <script src="ui/pixelGameView.js"></script>
```

- [ ] **Step 7: Run the full validate suite**

Run: `for f in scripts/validate-*.js; do node "$f" || break; done` (or run each individually)
Expected: every script ends with its "All ... passed" line.

- [ ] **Step 8: Commit**

```bash
git add league.js ui/simControls.js script.js index.html scripts/validate-pixel-events.js
git commit -m "feat: Watch Next Game flow - watched game sims via possession engine with event capture"
```

---

### Task 6: In-browser verification

**Files:** none created (verification only; fix-and-recommit anything found).

Per project convention (see memory): serve with a **no-store threaded server on a fresh port** so stale JS can never pin.

- [ ] **Step 1: Start a fresh-port no-store server and open the app**

Serve `C:\Users\cory\Desktop\nba` on a previously unused port with `Cache-Control: no-store` (threaded). Open the Browser pane at that port.

- [ ] **Step 2: Reach the watch flow**

Start a new GM game (any team), then click **Watch Next Game** in the sim dock.

- [ ] **Step 3: Verify, in order**

1. Console: zero errors (`read_console_messages`).
2. Pixel view opens: crowd strip, parquet, court lines, team-colored keys, both hoops, center logo visible.
3. 10 sprites in two distinct jersey colors with visible numbers; ball-handler has highlight ring + name label.
4. Scoreboard ticks: score changes only on makes/FTs; clock counts down; quarter advances Q1→Q4.
5. Speed buttons change playback rate; Pause freezes; Skip to Final shows the final line matching the recorded score (cross-check the score against the Schedule view after exiting).
6. Exit returns to dashboard; dashboard/feed reflect the game result; clicking Watch Next Game again works (second game).
7. Reload the page mid-watch (fresh load): app boots normally, no errors, pixelGame view shows the empty state if navigated to.

- [ ] **Step 4: Screenshot proof**

Take a screenshot of mid-game playback for the user.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: pixel game view browser-verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** event capture (T1), choreographer + subbing + clock (T2), sprites/court/crowd/logo (T3), view shell + controls + spoiler-safe overlay (T4), watch flow + engine override + fallback + BUILT_VIEWS (T5), browser verification (T6). Out-of-scope items (playoffs, replays, coaching) have no tasks — correct.
- **Type consistency:** Event Log Format defined once at top; `buildTimeline(session)` consumed in T4 with the same shape produced in T2; `spriteColorsForPlayer(player, team, isHome)` matches between T3 and T4; `watchOptions = { gameId, events }` matches between T5 test and implementation.
- **Known simplifications (documented in code):** home always attacks right; no halftime side switch; away always in white; crowd is decorative LCG, not game rng.
