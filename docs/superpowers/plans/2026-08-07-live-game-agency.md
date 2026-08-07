# Live Game Sim — Stage 4: User Agency and Incremental Playback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pixel game view from a replay of an already-decided game into a game the user coaches live — stepping the sim possession-by-possession while it plays, with timeouts, substitutions, and non-blocking nudges that actually change the recorded result.

**Architecture:** The view owns a `GameSim` and steps it a few possessions ahead of playback. Each stepped possession's events are choreographed incrementally and appended to a live-growing timeline. User decisions are queued through `sim.applyDecision` and land at the next possession boundary, overriding the auto-coach for that boundary only. The league defers applying the watched game's result until the sim completes — on the final buzzer, on Skip to Final, or on Exit (which steps the remainder under the coach), so a half-played game is never recorded.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Dual module pattern (`require` in Node, globals in browser). Node tests are plain scripts under `scripts/` using `assert`. Browser verification via `scripts/devserver.py` plus the in-app `UI_SMOKE` harness.

## Scope

This plan implements **Stage 4** of `docs/superpowers/specs/2026-08-06-live-game-sim-tier0-design.md`. It builds directly on the `live-game-sim` branch (Stages 1–3, 10 commits, ending at `c9c5231`). **Work continues on that same branch** — do not branch off `master`, which does not have `gameSim.js` or `gameCoach.js`.

### Two scope decisions made in this plan, and why

1. **Playoff games get the live path too** (Task 10). The spec does not mention playoffs in Stage 4, and it would be cheaper to leave them as pre-simmed replays. But the playoffs are exactly when a user most wants agency, and shipping a version where the regular season is coachable and the postseason is a cutscene is a worse product than either option alone. `simulateSeriesGame` splits along the same deferral seam as `simulateDate`, so the marginal cost is one task.

2. **The clock displayed on a keyframe is the engine's clock at the start of that possession**, held constant for the whole possession, rather than interpolated down to the possession's end. Interpolating requires knowing when the possession ends, which is not known until the *next* possession is stepped — that lookahead is exactly what makes incremental choreography impossible. Holding it constant is the same display granularity the current build already has (today's choreographer assigns one synthetic clock value per possession) while sourcing it from a real clock instead of dividing 720s by the possession count.

## Global Constraints

- No new third-party dependencies. This project is zero-dependency by design.
- Every new module uses the repo's dual require/global pattern (see the `_GAMESIM_DATA` block at the top of `gameSim.js` for the exact shape).
- **Browser files must be added to `index.html` in dependency order.** Node resolves `require` by dependency; the browser runs `<script>` tags in file order in one shared global scope. Stage 3 lost time to both failure modes this creates — a file that read a constant from a later-loaded module threw at load and left its own `const` declarations permanently uninitialized, and a `var _COACH_DATA` collided with the one `coaches.js` already declared and silently broke coach hiring. Before adding any top-level `var`/`const`/`function` name, grep the whole repo for it.
- Only `simWorker.js`'s `importScripts` list needs engine files. The new `ui/*.js` files are view-only and must **not** be added to the worker.
- Existing `scripts/validate-*.js` tests must pass at every commit unless a task explicitly changes one, and any such change must be justified in that task.
- `scripts/fixtures/gamesim-golden.json` must remain byte-identical through this entire plan. Stage 4 adds no RNG draws to the batch path. If a task makes it change, that task has a bug — do not regenerate the fixture.
- Sim results must stay deterministic: same seed + same decision sequence ⇒ identical result.
- The user must be able to watch a full game hands-off. Every control added here is an opportunity, never an obligation; nothing blocks playback waiting for input.
- Timeouts: 7 per team per game, +0.12 energy (capped at 1.0) to on-court players, clears the opponent's run counter, consumes no game clock.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `gameSim.js` | modify (Tasks 1, 2) | Adds `applyDecision` queue; stamps clock/period/lineups onto captured events. |
| `simEnginePossession.js` | modify (Task 2) | `pushEvent` copies the new context fields onto every event. |
| `ui/pixelChoreographer.js` | modify (Task 3) | Gains `createChoreographer` incremental API; `buildTimeline` reimplemented on top of it. Loses `startingFive`/`ensureOnCourt` — the engine now supplies real lineups. |
| `ui/pixelAudio.js` | create (Task 4) | WebAudio graph, crowd bed, sfx synthesis. Pure move out of `pixelGameView.js`. |
| `ui/pixelHud.js` | create (Task 5) | DOM chrome: replay list, controls markup, commentary feed, info strip, post-game card. Later gains the nudge card and substitution panel. |
| `ui/pixelGameView.js` | modify (Tasks 4, 5, 7, 8, 9) | Playback loop, motion model, and driving the live sim. |
| `league.js` | modify (Task 6) | `simulateDate` can defer the watched game and hand back a live sim plus a `finish()`. |
| `playoffs.js` | modify (Task 10) | Same deferral for `simulateSeriesGame` / `simulateNextPlayoffGame`. |
| `ui/simControls.js` | modify (Tasks 6, 10) | Watch handlers open the view on a live sim instead of a finished result. |
| `index.html` | modify (Tasks 4, 5) | Load `ui/pixelAudio.js` and `ui/pixelHud.js` before `ui/pixelGameView.js`. |
| `style.css` | modify (Tasks 8, 9) | Styles for the sub panel and nudge card. |
| `scripts/validate-gamesim.js` | modify (Tasks 1, 2) | Decision-queue tests; event-stamp tests. |
| `scripts/validate-pixel-events.js` | modify (Task 2) | Asserts the new stamps and that capture stays drift-free. |
| `scripts/validate-pixel-choreographer.js` | modify (Task 3) | Incremental-equals-batch test; drops `startingFive` coverage. |
| `scripts/validate-liveWatch.js` | create (Task 6) | League-side deferral: rng isolation, result application, no half-played games. |
| `scripts/ui-smoke.js` | modify (Task 11) | A `live` group asserting the live controls are visible and reachable. |

---

## Stage 4a — Engine and choreographer (Node-verifiable)

### Task 1: `sim.applyDecision` — queued decisions at possession boundaries

The engine currently applies substitutions and timeouts the instant they are called, and runs the coach unconditionally at the top of every `step()`. Both are wrong for a live game: a substitution applied mid-possession would change who was on the floor for math that already ran, and a user substitution applied between steps would be evaluated and immediately reversed by the coach on the very next step.

**Files:**
- Modify: `gameSim.js`
- Modify: `scripts/validate-gamesim.js`

**Interfaces:**
- Consumes: `sim.applySubstitutions(team, swaps)`, `sim.callTimeout(team)`, `sim.timeoutsLeft`, `sim.done` (all existing on `createGameSim`).
- Produces: `sim.applyDecision(decision) → boolean`, where `decision` is either
  `{ type: 'timeout', team: 'home'|'away' }` or
  `{ type: 'substitution', team: 'home'|'away', swaps: [{ out: playerId, in: playerId }] }`.
  Returns `true` if queued, `false` if rejected. Every later task in this plan submits decisions through this one function.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-gamesim.js`, immediately before its final `console.log` summary line:

```js
// --- Task 1: queued user decisions ---------------------------------------

function checkDecisionsQueueUntilNextStep() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(41));
  sim.step();
  const before = sim.onCourt.home.slice();
  const benchId = sim.homeRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  const ok = sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: before[0], in: benchId }] });
  assert.strictEqual(ok, true, 'a valid decision is accepted');
  assert.deepStrictEqual(sim.onCourt.home, before, 'queued decisions do NOT apply immediately');
  sim.step();
  assert.ok(sim.onCourt.home.indexOf(benchId) !== -1, 'the substitute is on the floor after the next step');
  assert.ok(sim.onCourt.home.indexOf(before[0]) === -1, 'the replaced player came off');
  console.log('checkDecisionsQueueUntilNextStep: OK');
}
checkDecisionsQueueUntilNextStep();

function checkUserSubSurvivesTheCoach() {
  // The coach runs on every step. A user substitution must not be undone by
  // the coach in the SAME step that applied it.
  const sim = gameSim.createGameSim('DEN', 'MIA', makeRng(42));
  for (let i = 0; i < 60; i++) sim.step();
  const before = sim.onCourt.away.slice();
  const benchId = sim.awayRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  sim.applyDecision({ type: 'substitution', team: 'away', swaps: [{ out: before[0], in: benchId }] });
  sim.step();
  assert.ok(sim.onCourt.away.indexOf(benchId) !== -1, 'the coach did not reverse the user substitution');
  console.log('checkUserSubSurvivesTheCoach: OK');
}
checkUserSubSurvivesTheCoach();

function checkTimeoutDecision() {
  const sim = gameSim.createGameSim('OKC', 'NYK', makeRng(43));
  sim.step();
  const left = sim.timeoutsLeft.home;
  assert.strictEqual(sim.applyDecision({ type: 'timeout', team: 'home' }), true, 'a timeout is accepted');
  assert.strictEqual(sim.timeoutsLeft.home, left, 'not spent until the next step');
  sim.step();
  assert.strictEqual(sim.timeoutsLeft.home, left - 1, 'spent at the next possession boundary');
  console.log('checkTimeoutDecision: OK');
}
checkTimeoutDecision();

function checkInvalidDecisionsRejected() {
  const sim = gameSim.createGameSim('MIL', 'PHI', makeRng(44));
  sim.step();
  assert.strictEqual(sim.applyDecision(null), false, 'null is rejected');
  assert.strictEqual(sim.applyDecision({ type: 'nonsense', team: 'home' }), false, 'unknown type is rejected');
  assert.strictEqual(sim.applyDecision({ type: 'timeout', team: 'nobody' }), false, 'unknown team is rejected');

  // Timeouts exhausted: the spec says the control disables; the engine must
  // refuse regardless of what any caller believes.
  const drained = gameSim.createGameSim('GSW', 'DAL', makeRng(45));
  drained.step();
  for (let i = 0; i < 7; i++) { drained.applyDecision({ type: 'timeout', team: 'home' }); drained.step(); }
  assert.strictEqual(drained.timeoutsLeft.home, 0, 'all seven spent');
  assert.strictEqual(drained.applyDecision({ type: 'timeout', team: 'home' }), false, 'an eighth is rejected');
  console.log('checkInvalidDecisionsRejected: OK');
}
checkInvalidDecisionsRejected();

function checkDecisionsAfterGameOverIgnored() {
  const sim = gameSim.createGameSim('CLE', 'MEM', makeRng(46));
  while (!sim.done) sim.step();
  const before = sim.onCourt.home.slice();
  const benchId = sim.homeRoster.find(function (p) { return before.indexOf(p.id) === -1; }).id;
  assert.strictEqual(sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: before[0], in: benchId }] }), false,
    'decisions after the final buzzer are refused');
  sim.step();
  assert.deepStrictEqual(sim.onCourt.home, before, 'and change nothing');
  console.log('checkDecisionsAfterGameOverIgnored: OK');
}
checkDecisionsAfterGameOverIgnored();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/validate-gamesim.js`
Expected: FAIL — `TypeError: sim.applyDecision is not a function`.

- [ ] **Step 3: Implement the decision queue**

In `gameSim.js`, insert this block immediately after the `const sim = { ... };` object literal (before `sim.step = function ()`):

```js
  // External decisions (the user watching, or a test), queued and drained at
  // the top of the next step(). Never applied mid-possession: a substitution
  // landing halfway through would change who was on the floor for math that
  // had already run.
  const pendingDecisions = [];

  sim.applyDecision = function (decision) {
    if (sim.done) return false;                     // spec: ignored after the final buzzer
    if (!decision) return false;
    if (decision.type !== 'timeout' && decision.type !== 'substitution') return false;
    if (decision.team !== 'home' && decision.team !== 'away') return false;
    if (decision.type === 'timeout' && sim.timeoutsLeft[decision.team] <= 0) return false;
    pendingDecisions.push(decision);
    return true;
  };

  // Applies everything queued and reports which teams were decided for by a
  // caller rather than by the coach. The coach is then skipped for those
  // teams for THIS boundary only — otherwise it would evaluate the floor the
  // user just changed and swap the substitute straight back off, making user
  // agency look broken when it is actually being overwritten one line later.
  function drainDecisions() {
    const decided = {};
    while (pendingDecisions.length > 0) {
      const d = pendingDecisions.shift();
      if (d.type === 'timeout') {
        if (sim.callTimeout(d.team)) decided[d.team] = true;
      } else {
        sim.applySubstitutions(d.team, d.swaps);
        decided[d.team] = true;
      }
    }
    return decided;
  }
```

Then replace the two `forEach` blocks at the top of `sim.step` — currently:

```js
    ['home', 'away'].forEach(function (t) {
      sim.applySubstitutions(t, _GAMESIM_DATA.coach.decideSubstitutions(sim, t));
    });
    ['home', 'away'].forEach(function (t) {
      if (_GAMESIM_DATA.coach.decideTimeout(sim, t)) sim.callTimeout(t);
    });
```

with:

```js
    const userDecided = drainDecisions();
    ['home', 'away'].forEach(function (t) {
      if (userDecided[t]) return;
      sim.applySubstitutions(t, _GAMESIM_DATA.coach.decideSubstitutions(sim, t));
    });
    ['home', 'away'].forEach(function (t) {
      if (userDecided[t]) return;
      if (_GAMESIM_DATA.coach.decideTimeout(sim, t)) sim.callTimeout(t);
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/validate-gamesim.js`
Expected: PASS, including the pre-existing golden-master check. `drainDecisions` returns `{}` on the batch path, so every branch behaves exactly as before and the fixture must still match. If `gamesim-golden` fails here, the queue is leaking into the batch path — fix that rather than regenerating the fixture.

- [ ] **Step 5: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 6: Commit**

```bash
git add gameSim.js scripts/validate-gamesim.js
git commit -m "feat: queued user decisions applied at possession boundaries"
```

---

### Task 2: Stamp clock, period, and lineups onto captured events

The choreographer currently invents a clock by dividing each quarter's 720 seconds across however many possessions it happens to contain, and infers each team's five by sorting the final box score by minutes — both artifacts of an engine that had neither. The engine now has a real clock and a real on-court five, so the event log should carry them. This also unblocks Task 3: without the lineups on the log, incremental choreography would need the finished box score, which a live game does not have.

**Files:**
- Modify: `simEnginePossession.js` (`pushEvent`)
- Modify: `gameSim.js` (the `ctx` object built in `step`)
- Modify: `scripts/validate-pixel-events.js`

**Interfaces:**
- Consumes: `sim.period`, `sim.clock`, `sim.onCourt` (existing).
- Produces: every captured event gains `period` (1-based; 5+ is overtime) and `clock` (whole seconds remaining in the period at the START of the possession the event belongs to). `possession`-type events additionally gain `lineups: { home: [5 ids], away: [5 ids] }`. The existing `team` and `quarter` fields are unchanged, so nothing that reads them breaks.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-pixel-events.js`, before its final summary line:

```js
// --- Task 2: clock / period / lineup stamps ------------------------------

function checkEventStamps() {
  const events = [];
  gameSim.simulateGame('BOS', 'LAL', makeRng(21), { events: events });

  events.forEach(function (ev) {
    assert.ok(typeof ev.period === 'number' && ev.period >= 1, 'every event carries a period');
    assert.ok(typeof ev.clock === 'number' && ev.clock >= 0, 'every event carries a clock');
    assert.strictEqual(ev.clock, Math.round(ev.clock), 'clock is whole seconds');
    const periodLength = ev.period <= 4 ? 720 : 300;
    assert.ok(ev.clock <= periodLength, 'clock fits inside its period: ' + ev.clock + ' in period ' + ev.period);
  });

  const possessions = events.filter(function (ev) { return ev.type === 'possession'; });
  assert.ok(possessions.length > 100, 'a full game has many possessions');
  possessions.forEach(function (ev) {
    assert.ok(ev.lineups, 'possession events carry lineups');
    assert.strictEqual(ev.lineups.home.length, 5, 'five home players on court');
    assert.strictEqual(ev.lineups.away.length, 5, 'five away players on court');
    assert.strictEqual(new Set(ev.lineups.home.concat(ev.lineups.away)).size, 10, 'ten distinct players');
  });

  // The clock only ever runs down within a period.
  let prev = null;
  possessions.forEach(function (ev) {
    if (prev && prev.period === ev.period) {
      assert.ok(ev.clock <= prev.clock, 'clock is non-increasing within a period');
    }
    prev = ev;
  });

  // Lineups must actually change over a game — a stamp that never moves would
  // pass every assertion above while silently reporting the starters all night.
  const distinct = new Set(possessions.map(function (ev) { return ev.lineups.home.slice().sort().join(','); }));
  assert.ok(distinct.size >= 4, 'the home five changes over the game, saw ' + distinct.size + ' distinct lineups');

  console.log('checkEventStamps: OK');
}
checkEventStamps();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-pixel-events.js`
Expected: FAIL on `every event carries a period` (currently `undefined`).

- [ ] **Step 3: Implement the stamps**

In `simEnginePossession.js`, replace `pushEvent`:

```js
function pushEvent(eventCtx, ev) {
  if (!eventCtx) return;
  ev.team = eventCtx.team;
  ev.quarter = eventCtx.quarter;
  // period distinguishes overtime (5+) from Q4, which `quarter` clamps away;
  // clock is the real game clock at the start of this possession.
  ev.period = eventCtx.period;
  ev.clock = eventCtx.clock;
  // Only on the possession event: the five cannot change mid-possession, so
  // repeating them on every play would be ten ids of pure duplication.
  if (ev.type === 'possession') ev.lineups = eventCtx.lineups;
  eventCtx.events.push(ev);
}
```

In `gameSim.js`, replace the `ctx` assignment inside `sim.step`:

```js
    const ctx = captureEvents ? {
      events: captureEvents,
      team: team,
      quarter: sim.quarter,
      period: sim.period,
      clock: Math.round(sim.clock),
      lineups: { home: onCourt.home.slice(), away: onCourt.away.slice() }
    } : null;
```

The `.slice()` calls are load-bearing: `onCourt.home` is mutated in place by `applySubstitutions`, so storing the array itself would leave every possession event pointing at the same live array and reporting the FINAL lineup for the whole game.

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/validate-pixel-events.js`
Expected: PASS, including the pre-existing capture-on/capture-off equivalence check. Capture still draws no RNG, so that must still hold.

- [ ] **Step 5: Confirm the golden fixture is untouched**

Run: `node scripts/validate-gamesim.js && git diff --stat scripts/fixtures/gamesim-golden.json`
Expected: PASS, and `git diff --stat` prints nothing. This task adds fields to an optional debug log; if the fixture moved, something in the stamping path is consuming RNG.

- [ ] **Step 6: Commit**

```bash
git add simEnginePossession.js gameSim.js scripts/validate-pixel-events.js
git commit -m "feat: stamp real clock, period, and lineups onto captured events"
```

---

### Task 3: Incremental choreographer

`buildTimeline` is a whole-game function: it groups all events, counts each quarter's possessions to derive a clock, then runs post-passes for shot clock and line score. Live playback needs to choreograph one possession at a time, as it is stepped. Rather than write a second implementation and let the two drift, `buildTimeline` is reimplemented as a loop over the incremental API — so replay and live are the same code by construction, and a test can assert they produce identical timelines.

**Files:**
- Modify: `ui/pixelChoreographer.js`
- Modify: `scripts/validate-pixel-choreographer.js`

**Interfaces:**
- Consumes: events stamped with `period`, `clock`, and (on `possession` events) `lineups` from Task 2.
- Produces:
  - `createChoreographer(session) → choreo`, where `session = { homeRoster, awayRoster, homeName, awayName, homeAbbr, awayAbbr }` (note: **no `boxScore`** — it is no longer needed).
  - `choreo.appendEvents(possessionEvents)` — takes the events of exactly one possession (a `possession` event followed by its plays) and appends that possession's keyframes.
  - `choreo.finish()` — closes out the line score. Idempotent.
  - `choreo.timeline` — the same shape `buildTimeline` returns today (`{ keyframes, durationMs, snapshots, lineScore, finalStats }`), mutated in place as possessions are appended, so a playback loop can read it every frame.
  - `buildTimeline(session)` keeps its existing signature and return value; `session.events` is still required for that path.
  - `startingFive` and `ensureOnCourt` are **deleted** — the engine now supplies real lineups.
  - Keyframes gain a `period` field alongside the existing `quarter`.

- [ ] **Step 1: Write the failing tests**

In `scripts/validate-pixel-choreographer.js`, delete any test that references `choreo.startingFive` (it is being removed), then append:

```js
// --- Task 3: incremental choreography ------------------------------------

function possessionSlices(events) {
  const slices = [];
  events.forEach(function (ev) {
    if (ev.type === 'possession') slices.push([ev]);
    else if (slices.length) slices[slices.length - 1].push(ev);
  });
  return slices;
}

function checkIncrementalEqualsBatch() {
  const built = buildSession(11);
  const batch = choreo.buildTimeline(built.session);

  const live = choreo.createChoreographer({
    homeRoster: built.session.homeRoster,
    awayRoster: built.session.awayRoster
  });
  possessionSlices(built.session.events).forEach(function (slice) { live.appendEvents(slice); });
  live.finish();

  assert.deepStrictEqual(live.timeline.keyframes, batch.keyframes, 'incremental keyframes match batch exactly');
  assert.strictEqual(live.timeline.durationMs, batch.durationMs, 'durations match');
  assert.deepStrictEqual(live.timeline.lineScore, batch.lineScore, 'line scores match');
  assert.deepStrictEqual(live.timeline.snapshots, batch.snapshots, 'snapshots match');
  assert.deepStrictEqual(live.timeline.finalStats, batch.finalStats, 'final stats match');
  console.log('checkIncrementalEqualsBatch: OK');
}
checkIncrementalEqualsBatch();

function checkTimelineGrowsAsAppended() {
  const built = buildSession(12);
  const live = choreo.createChoreographer({
    homeRoster: built.session.homeRoster,
    awayRoster: built.session.awayRoster
  });
  const slices = possessionSlices(built.session.events);
  let lastDuration = 0;
  let lastCount = 0;
  slices.slice(0, 10).forEach(function (slice) {
    live.appendEvents(slice);
    assert.ok(live.timeline.keyframes.length > lastCount, 'each possession adds keyframes');
    assert.ok(live.timeline.durationMs > lastDuration, 'duration grows monotonically');
    assert.strictEqual(live.timeline.durationMs, live.timeline.keyframes[live.timeline.keyframes.length - 1].t,
      'durationMs always equals the last keyframe time');
    lastCount = live.timeline.keyframes.length;
    lastDuration = live.timeline.durationMs;
  });
  console.log('checkTimelineGrowsAsAppended: OK');
}
checkTimelineGrowsAsAppended();

function checkClockComesFromTheEngine() {
  const built = buildSession(13);
  const tl = choreo.buildTimeline(built.session);
  const byPossession = {};
  built.session.events.filter(function (ev) { return ev.type === 'possession'; })
    .forEach(function (ev, i) { byPossession[i] = ev; });

  tl.keyframes.forEach(function (kf) {
    const src = byPossession[kf.possIdx];
    assert.ok(src, 'every keyframe maps to a possession');
    assert.strictEqual(kf.clock, src.clock, 'keyframe clock is the engine clock for its possession');
    assert.strictEqual(kf.period, src.period, 'keyframe period is the engine period');
  });
  console.log('checkClockComesFromTheEngine: OK');
}
checkClockComesFromTheEngine();

function checkOvertimeIsRepresented() {
  // Force a tie at the buzzer, then confirm the extra period reaches the
  // keyframes as period 5 rather than being flattened into Q4.
  const events = [];
  const sim = gameSim.createGameSim('SAS', 'HOU', makeRng(31), { events: events });
  while (!sim.done) {
    sim.step();
    if (sim.period === 4 && sim.clock <= 60 && sim.homeScore !== sim.awayScore) {
      // nudge the score to a tie so regulation ends level
      if (sim.homeScore > sim.awayScore) sim.awayScore = sim.homeScore;
      else sim.homeScore = sim.awayScore;
    }
  }
  assert.ok(sim.period > 4, 'the game reached overtime');

  const tl = choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster('SAS'),
    awayRoster: league.getTeamRoster('HOU')
  });
  assert.ok(tl.keyframes.some(function (kf) { return kf.period > 4; }), 'overtime keyframes carry period > 4');
  assert.ok(tl.keyframes.every(function (kf) { return kf.quarter >= 1 && kf.quarter <= 4; }), 'quarter still clamps to 1-4');
  console.log('checkOvertimeIsRepresented: OK');
}
checkOvertimeIsRepresented();

function checkLineupsDriveTheFloor() {
  const built = buildSession(14);
  const tl = choreo.buildTimeline(built.session);
  tl.keyframes.forEach(function (kf) {
    assert.strictEqual(Object.keys(kf.pos).length, 10, 'exactly ten sprites on the floor every keyframe');
  });
  console.log('checkLineupsDriveTheFloor: OK');
}
checkLineupsDriveTheFloor();
```

`buildSession` at the top of that file currently returns `boxScore` in the session — leave it; the choreographer simply stops reading it. Also ensure the file requires `gameSim` and `league` (it already does).

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: FAIL — `choreo.createChoreographer is not a function`.

- [ ] **Step 3: Restructure `buildTimeline` into `createChoreographer`**

In `ui/pixelChoreographer.js`:

**3a.** Delete the `startingFive` and `ensureOnCourt` functions entirely (currently around lines 62–100), along with the comment block above `startingFive` that explains the old sprite-swapping hack — it describes behaviour that no longer exists.

**3b.** Replace the whole `function buildTimeline(session) { ... }` body with the incremental version below. This is a restructure, not a rewrite: the per-possession beat construction inside `appendEvents` is the existing possession loop body, unchanged except that `five` comes from `ev.lineups` and the clock comes from `ev.clock`.

```js
// Groups a flat event log into per-possession slices. A `possession` event
// opens one; everything until the next `possession` belongs to it.
function groupPossessions(events) {
  const slices = [];
  events.forEach(function (ev) {
    if (ev.type === 'possession') slices.push([ev]);
    else if (slices.length > 0) slices[slices.length - 1].push(ev);
  });
  return slices;
}

// The incremental choreographer. Playback needs to draw a possession while
// the ones after it have not been simulated yet, so every whole-game pass the
// old buildTimeline did has been made per-possession:
//
//   - the clock is now the engine's own (Task 2) instead of 720s divided by a
//     possession count that isn't known until the game ends;
//   - the on-court five is now the engine's own instead of being inferred by
//     sorting the final box score by minutes;
//   - the shot-clock pass only ever needed one possession's bounds, so it
//     runs at the end of each append;
//   - the line score accumulates at period boundaries and is closed by
//     finish().
//
// buildTimeline() below is a loop over this, so a replayed game and a live
// game cannot produce different timelines.
function createChoreographer(session) {
  const rosters = { home: session.homeRoster, away: session.awayRoster };
  const teamNames = { home: session.homeName || 'home side', away: session.awayName || 'road side' };
  const abbrs = { home: session.homeAbbr || 'HOME', away: session.awayAbbr || 'AWAY' };

  const nameById = {};
  const playerById = {};
  session.homeRoster.concat(session.awayRoster).forEach(function (p) {
    nameById[p.id] = p.name;
    playerById[p.id] = p;
  });
  function ln(pid) {
    return nameById[pid] ? nameById[pid].split(' ').pop() : 'the big man';
  }
  function teamOfPlayer(id) {
    return session.homeRoster.some(function (p) { return p.id === id; }) ? 'home' : 'away';
  }

  const keyframes = [];
  const snapshots = [];
  const lineScore = [];
  const runPts = {};
  const runFouls = {};
  const score = [0, 0];

  let t = 0;
  let possCounter = -1;
  let prevPoss = null;          // for fast-break detection
  let five = { home: [], away: [] };   // players (not ids) currently on court
  let linePeriod = null;        // period the line score is currently accruing
  let atPeriodStart = [0, 0];
  let finished = false;

  const timeline = {
    keyframes: keyframes,
    durationMs: 0,
    snapshots: snapshots,
    lineScore: lineScore,
    finalStats: { points: runPts, fouls: runFouls }
  };

  function snapshot() {
    const scorers = Object.keys(runPts)
      .map(function (id) { return { id: id, pts: runPts[id], team: teamOfPlayer(id) }; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 4);
    const trouble = Object.keys(runFouls)
      .filter(function (id) { return runFouls[id] >= 4; })
      .map(function (id) { return { id: id, fouls: runFouls[id] }; })
      .sort(function (a, b) { return b.fouls - a.fouls; });
    snapshots.push({ leaders: scorers, foulTrouble: trouble });
  }

  function addPoints(id, n) {
    if (!n) return;
    runPts[id] = (runPts[id] || 0) + n;
    snapshot();
  }

  function addFoul(id) {
    if (!id) return;
    runFouls[id] = (runFouls[id] || 0) + 1;
    if (runFouls[id] >= 4) snapshot();
  }

  snapshot(); // index 0: empty board at tip-off

  function push(dt, pos, ball, period, quarter, clock, text, commentary, sfx) {
    t += dt;
    const resolved = separatePositions(pos, ball.holder);
    keyframes.push({
      t: t, pos: resolved, ball: ball, score: score.slice(),
      period: period, quarter: quarter,
      clock: Math.max(0, Math.round(clock)), text: text || '', commentary: commentary || '',
      sfx: sfx || '',
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
  }

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

  function transitionFor(offenseTeam, fastBreak) {
    const pos = {};
    const hoop = attackingHoop(offenseTeam);
    const dir = offenseTeam === 'home' ? -1 : 1;
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        const spot = OFFENSE_SPOTS[posName];
        if (side === offenseTeam) {
          const trail = fastBreak
            ? (posName === 'PG' ? 55 : 20)
            : (posName === 'PG' ? 140 : 95);
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + trail), hoop.y + spot.dy);
        } else if (fastBreak) {
          const behind = (posName === 'PG' || posName === 'SG') ? 40 : 105;
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + behind), hoop.y + spot.dy * 0.8);
        } else {
          pos[p.id] = formationSpot(side, posName, offenseTeam);
        }
      });
    });
    return pos;
  }

  // Shot clock for ONE possession: 24 at the inbound, ticking to 0 at the
  // terminal beat. Only ever needed this possession's own bounds, which is
  // why it can run per-append instead of as a whole-game post-pass.
  function applyShotClock(fromIndex) {
    const start = keyframes[fromIndex].t;
    const end = keyframes[keyframes.length - 1].t;
    const span = Math.max(1, end - start);
    for (let i = fromIndex; i < keyframes.length; i++) {
      keyframes[i].shotClock = Math.max(0, Math.round(24 - 24 * ((keyframes[i].t - start) / span)));
    }
  }

  function appendEvents(events) {
    if (finished) throw new Error('appendEvents after finish()');
    const head = events[0];
    if (!head || head.type !== 'possession') return;

    const pi = possCounter + 1;
    possCounter = pi;
    const firstKf = keyframes.length;

    const plays = events.slice(1);
    const period = head.period;
    const quarter = head.quarter;
    const clock = head.clock;

    // Close the previous period's line-score row the moment the period turns
    // over, so a live timeline always has every completed period's row.
    if (linePeriod === null) {
      linePeriod = period;
    } else if (period !== linePeriod) {
      lineScore.push({
        quarter: linePeriod,
        home: score[0] - atPeriodStart[0],
        away: score[1] - atPeriodStart[1]
      });
      atPeriodStart = score.slice();
      linePeriod = period;
    }

    // Real substitutions: the engine's five, not an inference from minutes.
    five = {
      home: head.lineups.home.map(function (id) { return playerById[id]; }).filter(Boolean),
      away: head.lineups.away.map(function (id) { return playerById[id]; }).filter(Boolean)
    };

    // A possession that begins right after the other team lost the ball live
    // — a steal or a defensive board — is a fast break: the defense has NOT
    // had time to set.
    let fastBreak = false;
    if (prevPoss && prevPoss.team !== head.team && prevPoss.plays.length > 0) {
      const lastPlay = prevPoss.plays[prevPoss.plays.length - 1];
      fastBreak = (lastPlay.type === 'turnover' && !!lastPlay.defenderId) ||
                  (lastPlay.type === 'rebound' && !lastPlay.offensive);
    }
    prevPoss = { team: head.team, plays: plays };

    const poss = { team: head.team, quarter: quarter, period: period, handlerId: head.playerId, plays: plays, fastBreak: fastBreak };

    const pos = positionsFor(poss.team);
    const handlerPos = pos[poss.handlerId] || formationSpot(poss.team, 'PG', poss.team);
    const transPos = transitionFor(poss.team, poss.fastBreak);
    const transHandler = transPos[poss.handlerId] || handlerPos;

    let transComment = '';
    if (pi % 9 === 4) {
      const mins = Math.floor(clock / 60);
      const secs = Math.round(clock % 60);
      transComment = abbrs.home + ' ' + score[0] + ', ' + abbrs.away + ' ' + score[1] +
        ' — ' + mins + ':' + (secs < 10 ? '0' : '') + secs + ' to go in ' +
        (period <= 4 ? 'Q' + period : 'OT' + (period - 4));
    } else if (pi % 4 === 1) {
      transComment = fillT(COMMENT.bringUp, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }
    if (poss.fastBreak) {
      transComment = transComment || fillT(COMMENT.fastBreak, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }

    push(poss.fastBreak ? BEAT.fastBreak : BEAT.transition, transPos,
      { x: transHandler[0], y: transHandler[1], holder: poss.handlerId }, period, quarter, clock, '', transComment);
    push(poss.fastBreak ? BEAT.fastBreak : BEAT.formation, pos,
      { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, period, quarter, clock, '');

    const hoop = attackingHoop(poss.team);
    let curPos = pos;

    poss.plays.forEach(function (ev, ei) {
      if (ev.type === 'turnover') {
        const cutPos = cutPositions(pos, poss.handlerId, pi + ei);
        const handlerCut = cutPos[poss.handlerId] || handlerPos;
        const stealer = ev.defenderId && cutPos[ev.defenderId] ? ev.defenderId : null;
        if (stealer) {
          push(BEAT.release, cutPos, { x: handlerCut[0], y: handlerCut[1] - 6, holder: null }, period, quarter, clock, '');
          push(BEAT.pass, cutPos, { x: cutPos[stealer][0], y: cutPos[stealer][1], holder: stealer }, period, quarter, clock, 'Steal!',
            fillT(COMMENT.steal, pi + ei, { d: ln(stealer), h: ln(poss.handlerId) }), 'squeak');
        } else {
          push(BEAT.resolve, cutPos, { x: handlerCut[0], y: handlerCut[1], holder: null }, period, quarter, clock, 'Turnover',
            fillT(COMMENT.turnover, pi + ei, { h: ln(poss.handlerId) }));
        }
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, period, quarter, clock, '');
        push(BEAT.release, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, period, quarter, clock, '');
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, period, quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block');
      } else if (ev.type === 'shot') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        const shooterOn = !!shotPos[ev.playerId];
        if (ev.defenderId && shotPos[ev.defenderId]) {
          const cdx = hoop.x - sp[0];
          const cdy = hoop.y - sp[1];
          const cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          shotPos[ev.defenderId] = clampToCourt(sp[0] + (cdx / cd) * 9, sp[1] + (cdy / cd) * 9);
        }
        const offenseIds = five[poss.team].map(function (p) { return p.id; }).filter(function (id) { return shotPos[id]; });
        const chain = [poss.handlerId];
        const swings = 1 + ((pi + ei) % 2);
        for (let s = 0; s < swings; s++) {
          const cands = offenseIds.filter(function (id) {
            return id !== chain[chain.length - 1] && id !== ev.playerId && id !== ev.assistPlayerId;
          });
          if (cands.length === 0) break;
          chain.push(cands[(pi * 7 + ei * 3 + s * 5) % cands.length]);
        }
        if (ev.assistPlayerId && shotPos[ev.assistPlayerId] && chain[chain.length - 1] !== ev.assistPlayerId) {
          chain.push(ev.assistPlayerId);
        }
        if (shooterOn && chain[chain.length - 1] !== ev.playerId) {
          chain.push(ev.playerId);
        }
        for (let c = 0; c < chain.length - 1; c++) {
          const from = shotPos[chain[c]] || pos[chain[c]] || handlerPos;
          const to = shotPos[chain[c + 1]];
          if (!to) continue;
          push(BEAT.release, shotPos, { x: from[0], y: from[1] - 8, holder: null }, period, quarter, clock, '');
          push(BEAT.pass, shotPos, { x: to[0], y: to[1] - 8, holder: chain[c + 1] }, period, quarter, clock, '');
        }
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shooterOn ? ev.playerId : null }, period, quarter, clock, '');
        let releasePos = shotPos;
        let relSpot = sp;
        if (ev.zone === 'inside' && shooterOn) {
          const rimSpot = clampToCourt(hoop.x + (poss.team === 'home' ? -8 : 8), hoop.y + cutJitter(pi + ei, 6));
          releasePos = Object.assign({}, shotPos);
          releasePos[ev.playerId] = rimSpot;
          relSpot = rimSpot;
          push(BEAT.drive, releasePos, { x: rimSpot[0], y: rimSpot[1], holder: ev.playerId }, period, quarter, clock, '');
        }
        if (ev.made) {
          score[ev.team === 'home' ? 0 : 1] += ev.points;
          addPoints(ev.playerId, ev.points);
        }
        const shooterPlayer = playerById[ev.playerId];
        const dunking = ev.zone === 'inside' && isDunker(shooterPlayer);
        const madeLabel = ev.zone === 'inside'
          ? (dunking
              ? DUNK_FINISHES[(pi + ei) % DUNK_FINISHES.length]
              : LAYUP_FINISHES[(pi + ei) % LAYUP_FINISHES.length])
          : (ev.points === 3 ? 'Three-pointer!' : 'It\'s good!');
        push(BEAT.release, releasePos, { x: relSpot[0], y: relSpot[1] - 12, holder: null }, period, quarter, clock, '');
        const crashPos = crashPositions(releasePos, ev.playerId, hoop, pi + ei);
        const shotTemplates = ev.zone === 'three' ? COMMENT.threeMake : (ev.zone === 'mid' ? COMMENT.midMake : COMMENT.insideMake);
        let shotComment = ev.made
          ? fillT(shotTemplates, pi + ei, { s: ln(ev.playerId) })
          : fillT(COMMENT.miss, pi + ei, { s: ln(ev.playerId) });
        if (ev.made && ev.assistPlayerId && (pi + ei) % 2 === 0) {
          shotComment += ' (' + ln(ev.assistPlayerId) + ' with the dime)';
        }
        push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          ev.made ? madeLabel : '', shotComment,
          ev.made ? (dunking ? 'dunk' : 'swish') : 'clang');
        curPos = crashPos;
        if (!ev.made) {
          push(BEAT.bounce, crashPos, { x: hoop.x + (poss.team === 'home' ? -6 : 6), y: hoop.y - 8, holder: null }, period, quarter, clock, '');
        }
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, curPos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        const rebComment = ev.offensive
          ? fillT(COMMENT.oreb, pi + ei, { r: ln(ev.playerId) })
          : (pi % 3 === 0 ? fillT(COMMENT.dreb, pi + ei, { r: ln(ev.playerId) }) : '');
        push(BEAT.resolve, rpos, { x: rp[0], y: rp[1], holder: rpos[ev.playerId] ? ev.playerId : null }, period, quarter, clock,
          ev.offensive ? 'Offensive board' : '', rebComment);
        curPos = rpos;
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, curPos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        addFoul(ev.defenderId);
        addPoints(ev.playerId, ev.points);
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts,
          fillT(COMMENT.ft, pi + ei, { s: ln(ev.playerId), made: ev.made, att: ev.attempts }), 'whistle');
        curPos = fpos;
      }
    });

    applyShotClock(firstKf);
    timeline.durationMs = t;
  }

  function finish() {
    if (finished) return timeline;
    finished = true;
    lineScore.push({
      quarter: linePeriod === null ? 1 : linePeriod,
      home: score[0] - atPeriodStart[0],
      away: score[1] - atPeriodStart[1]
    });
    timeline.durationMs = t;
    return timeline;
  }

  return {
    timeline: timeline,
    appendEvents: appendEvents,
    finish: finish
  };
}

// Whole-game entry point, retained for replaying a completed game from its
// stored event log. Implemented as a loop over the incremental API so the two
// paths cannot drift (scripts/validate-pixel-choreographer.js asserts they
// produce identical timelines).
function buildTimeline(session) {
  const choreo = createChoreographer(session);
  groupPossessions(session.events).forEach(function (slice) { choreo.appendEvents(slice); });
  return choreo.finish();
}
```

**3c.** Update the export block at the bottom of the file:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PIXEL_STAGE: PIXEL_STAGE,
    buildTimeline: buildTimeline,
    createChoreographer: createChoreographer,
    groupPossessions: groupPossessions,
    assignSlots: assignSlots
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: PASS, including `checkIncrementalEqualsBatch`.

If `checkIncrementalEqualsBatch` fails, some whole-game state is still leaking across the two paths — do not "fix" it by loosening the assertion. It is the only thing standing between this design and two silently divergent choreographers.

- [ ] **Step 5: Update the pre-existing clock assertion**

`checkTimelineShape` in the same file asserts `kf.clock >= 0 && kf.clock <= 720`. That still holds (overtime clocks are ≤ 300). But it also asserts `kf.quarter >= 1 && kf.quarter <= 4`, which is still correct because `quarter` is clamped. No change needed — confirm by re-reading the assertions rather than assuming.

- [ ] **Step 6: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 7: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-pixel-choreographer.js
git commit -m "feat: incremental choreographer, with real lineups and a real clock"
```

---

## Stage 4b — File split (no behaviour change)

### Task 4: Extract `ui/pixelAudio.js`

`ui/pixelGameView.js` is 982 lines and Tasks 7–9 all add to it. Splitting first means those changes land in focused files. The audio code is already a set of module-level functions with one module-level `_audio`, so this is a mechanical move — do it as a pure move and resist the urge to improve anything in transit, so a diff review can confirm nothing changed.

**Files:**
- Create: `ui/pixelAudio.js`
- Modify: `ui/pixelGameView.js` (delete the moved code)
- Modify: `index.html`

**Interfaces:**
- Produces (browser globals, and Node exports): `ensurePixelAudio()`, `playPixelSfx(name)`, `pixelAudioExcitement(level)`, `suspendPixelAudio()`. `sfxNoise` and `sfxTone` are internal helpers of the new module and are not called from outside it.

- [ ] **Step 1: Create `ui/pixelAudio.js`**

Move lines 11–117 of `ui/pixelGameView.js` verbatim — the `_audio` declaration and its comment block, `ensurePixelAudio`, `sfxNoise`, `sfxTone`, `playPixelSfx`, `pixelAudioExcitement`, and `suspendPixelAudio` — into a new file with this header and this footer:

```js
// Procedural arena audio for the pixel game view: a filtered noise bed for
// the crowd murmur, a bandpass branch that swells on big plays, and one-shot
// synthesized effects. Zero assets, zero dependencies. Math.random here is
// fine: audio is decoration and never touches the game rng.
//
// Split out of ui/pixelGameView.js, which was carrying playback, motion,
// audio, HUD chrome, and rendering in one 982-line file.

<the moved code, unchanged>

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensurePixelAudio: ensurePixelAudio,
    playPixelSfx: playPixelSfx,
    pixelAudioExcitement: pixelAudioExcitement,
    suspendPixelAudio: suspendPixelAudio
  };
}
```

- [ ] **Step 2: Delete the moved code from `ui/pixelGameView.js`**

Remove exactly those lines. `renderPixelGame` and `stopPixelPlayback` call `ensurePixelAudio`, `playPixelSfx`, `pixelAudioExcitement`, and `suspendPixelAudio` as bare globals; in the browser they resolve across files in one shared scope, so no call site changes.

- [ ] **Step 3: Load it before `ui/pixelGameView.js`**

In `index.html`, insert immediately before the `ui/pixelGameView.js` tag:

```html
  <script src="ui/pixelAudio.js"></script>
```

Do **not** add it to `simWorker.js` — the worker has no DOM, no `window`, and never renders.

- [ ] **Step 4: Verify nothing moved but the lines**

Run: `node --check ui/pixelAudio.js && node --check ui/pixelGameView.js && node scripts/validate-uiSafety.js`
Expected: no output from `--check`, and `validate-uiSafety.js` passes.

Run: `grep -n "ensurePixelAudio\|playPixelSfx\|pixelAudioExcitement\|suspendPixelAudio\|sfxNoise\|sfxTone" ui/pixelGameView.js`
Expected: only call sites remain — no `function` definitions.

- [ ] **Step 5: Commit**

```bash
git add ui/pixelAudio.js ui/pixelGameView.js index.html
git commit -m "refactor: extract ui/pixelAudio.js from the game view"
```

---

### Task 5: Extract `ui/pixelHud.js`

The DOM chrome — replay list, control bar, commentary feed, info strip, post-game card — is interleaved with the render loop. Tasks 8 and 9 add two more pieces of chrome (a substitution panel and a nudge card), so it gets its own module first. Unlike Task 4 this is not a pure move: the extracted pieces currently close over `renderPixelGame`'s locals, so each becomes a function with explicit parameters.

**Files:**
- Create: `ui/pixelHud.js`
- Modify: `ui/pixelGameView.js`
- Modify: `index.html`

**Interfaces:**
- Produces:
  - `pixelReplayListHtml(history, getTeamById)` → HTML string for the no-session empty state.
  - `pixelShellHtml(homeTeam, awayTeam, stageW, stageH, speeds)` → the whole `.pixel-game` markup string (scoreboard, canvas, ticker, info strip, commentary, controls).
  - `pixelPushCommentary(feedEl, text)` → appends a line, keeps the newest six.
  - `pixelRenderInfoStrip(stripEl, snap, playerById, teamColorFor)` → writes the leaders/foul-trouble strip. `teamColorFor(side)` returns a CSS colour for `'home'`/`'away'`.
  - `pixelRenderFinalCard(stripEl, ctxData)` where `ctxData = { homeTeam, awayTeam, homeScore, awayScore, lineScore, topScorers, playerById }`.

- [ ] **Step 1: Create `ui/pixelHud.js`**

```js
// DOM chrome for the pixel game view: everything rendered as HTML around the
// canvas — the recently-watched list, the control bar, the commentary feed,
// the broadcast info strip, and the post-game card. Kept apart from
// ui/pixelGameView.js so the playback loop and the motion model stay readable
// on their own, and so the live controls added on top of them have somewhere
// to live that isn't a 1,000-line file.
//
// Every function takes the elements and data it needs as parameters — none of
// it reads the view's playback state — so a change here can only ever affect
// what is on screen, never what happens in the game.

function pixelReplayListHtml(history, getTeamByIdFn) {
  if (history.length === 0) {
    return '<div class="empty-state">No game to watch. Use "Watch Next Game" in the sim dock.</div>';
  }
  return '<div class="panel"><div class="panel-header">Recently Watched</div><div class="panel-body">' +
    '<table class="data-table"><tbody>' + history.map(function (s, i) {
      const h = getTeamByIdFn(s.homeTeamId), a = getTeamByIdFn(s.awayTeamId);
      return '<tr><td class="col-name">' + escapeHtml(h.id) + ' ' + s.homeScore +
        ' — ' + escapeHtml(a.id) + ' ' + s.awayScore + '</td>' +
        '<td>' + (s.isPlayoff ? '<span class="pill pill-gold">Playoffs</span>' : '') + '</td>' +
        '<td><button class="pixel-replay-btn" data-idx="' + i + '">Replay</button></td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

function pixelShellHtml(homeTeam, awayTeam, stageW, stageH, speeds) {
  return '<div class="pixel-game">' +
      // The real scoreboard is drawn inside the canvas; this copy stays in
      // the DOM (visually hidden) so screen readers still get the score.
      '<div class="pixel-scoreboard pixel-sr-only">' +
        '<span class="pixel-score-team" style="border-color:' + homeTeam.colors.primary + '">' + escapeHtml(homeTeam.id) + ' <span id="pixel-score-home">0</span></span>' +
        '<span class="pixel-clock"><span id="pixel-quarter">Q1</span> <span id="pixel-clock">12:00</span></span>' +
        '<span class="pixel-score-team" style="border-color:' + awayTeam.colors.primary + '">' + escapeHtml(awayTeam.id) + ' <span id="pixel-score-away">0</span></span>' +
      '</div>' +
      '<div class="pixel-canvas-wrap"><canvas id="pixel-canvas" width="' + stageW + '" height="' + stageH + '"></canvas></div>' +
      '<div class="pixel-nudge-slot" id="pixel-nudge-slot"></div>' +
      '<div class="pixel-ticker" id="pixel-ticker">&nbsp;</div>' +
      '<div class="pixel-infostrip" id="pixel-infostrip"></div>' +
      '<div class="pixel-commentary" id="pixel-commentary"></div>' +
      '<div class="pixel-controls">' +
        '<button id="pixel-play-pause">Pause</button>' +
        speeds.map(function (s) {
          return '<button class="pixel-speed' + (s === 1 ? ' active' : '') + '" data-speed="' + s + '">' + s + '×</button>';
        }).join('') +
        '<button id="pixel-timeout">Timeout</button>' +
        '<button id="pixel-subs">Subs</button>' +
        '<button id="pixel-skip">Skip to Final</button>' +
        '<button id="pixel-replay">Replay</button>' +
        '<button id="pixel-mute">Sound: On</button>' +
        '<button id="pixel-exit">Exit</button>' +
      '</div>' +
      '<div class="pixel-subpanel" id="pixel-subpanel" hidden></div>' +
    '</div>';
}

function pixelPushCommentary(feedEl, text) {
  const line = document.createElement('div');
  line.className = 'pixel-commentary-line';
  line.textContent = text;
  feedEl.insertBefore(line, feedEl.firstChild);
  while (feedEl.children.length > 6) feedEl.removeChild(feedEl.lastChild);
}

function pixelRenderInfoStrip(stripEl, snap, playerById, teamColorFor) {
  const leadHtml = snap.leaders.map(function (l) {
    const p = playerById[l.id];
    return '<span class="pixel-leader"><i style="background:' + teamColorFor(l.team) + '"></i>' +
      escapeHtml(p ? p.name : l.id) + ' <b>' + l.pts + '</b></span>';
  }).join('');
  const troubleHtml = snap.foulTrouble.map(function (f) {
    const p = playerById[f.id];
    return '<span class="pixel-foul' + (f.fouls >= 6 ? ' is-out' : '') + '">' +
      escapeHtml(p ? p.name : f.id) + ' ' + f.fouls + (f.fouls >= 6 ? ' — FOULED OUT' : ' fouls') + '</span>';
  }).join('');
  stripEl.innerHTML = '<span class="pixel-strip-label">Leaders</span>' + leadHtml +
    (troubleHtml ? '<span class="pixel-strip-label">Foul trouble</span>' + troubleHtml : '');
}

function pixelRenderFinalCard(stripEl, d) {
  const homeWon = d.homeScore > d.awayScore;
  stripEl.innerHTML =
    '<div class="pixel-final">' +
      '<div class="pixel-final-head">' + escapeHtml(d.homeTeam.name) + ' ' + d.homeScore +
        ' — ' + escapeHtml(d.awayTeam.name) + ' ' + d.awayScore +
        ' <span class="pill ' + (homeWon ? 'pill-win' : 'pill-loss') + '">' +
        escapeHtml((homeWon ? d.homeTeam : d.awayTeam).id) + ' win</span></div>' +
      '<table class="data-table pixel-linescore"><thead><tr><th></th>' +
        d.lineScore.map(function (r) { return '<th class="num">' + (r.quarter <= 4 ? 'Q' + r.quarter : 'OT' + (r.quarter - 4)) + '</th>'; }).join('') +
        '<th class="num">F</th></tr></thead><tbody>' +
        '<tr><td class="col-name">' + escapeHtml(d.homeTeam.id) + '</td>' +
          d.lineScore.map(function (r) { return '<td class="num">' + r.home + '</td>'; }).join('') +
          '<td class="num"><b>' + d.homeScore + '</b></td></tr>' +
        '<tr><td class="col-name">' + escapeHtml(d.awayTeam.id) + '</td>' +
          d.lineScore.map(function (r) { return '<td class="num">' + r.away + '</td>'; }).join('') +
          '<td class="num"><b>' + d.awayScore + '</b></td></tr>' +
      '</tbody></table>' +
      '<div class="pixel-final-top">' + d.topScorers.map(function (t) {
        const p = d.playerById[t.id];
        return '<span class="pixel-leader">' + escapeHtml(p ? p.name : t.id) + ' <b>' + t.pts + '</b></span>';
      }).join('') + '</div>' +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pixelReplayListHtml: pixelReplayListHtml,
    pixelShellHtml: pixelShellHtml,
    pixelPushCommentary: pixelPushCommentary,
    pixelRenderInfoStrip: pixelRenderInfoStrip,
    pixelRenderFinalCard: pixelRenderFinalCard
  };
}
```

Note the shell markup already includes the `#pixel-timeout`, `#pixel-subs`, `#pixel-nudge-slot`, and `#pixel-subpanel` elements that Tasks 8 and 9 wire up. They are inert until then — disable the two new buttons in Step 2 so nothing looks clickable-but-dead in the interim.

- [ ] **Step 2: Rewrite the corresponding parts of `ui/pixelGameView.js`**

In `renderPixelGame`:

Replace the no-session branch's `container.innerHTML = ...` expression with:

```js
    container.innerHTML = '<div class="view-header"><h2>Watch Game</h2></div>' +
      pixelReplayListHtml(_replayHistory, getTeamById);
```

Replace the big `container.innerHTML = '<div class="pixel-game">' ... ;` assignment with:

```js
  container.innerHTML = pixelShellHtml(homeTeam, awayTeam, PIXEL_STAGE.w, PIXEL_STAGE.h, PIXEL_SPEEDS);
  // Wired up in the live-controls task; inert (and visibly so) until then.
  document.getElementById('pixel-timeout').disabled = true;
  document.getElementById('pixel-subs').disabled = true;
```

Replace the body of `pushCommentary` with:

```js
  function pushCommentary(kf) {
    if (!kf.commentary || kf.t === lastCommentaryKfT) return;
    lastCommentaryKfT = kf.t;
    pixelPushCommentary(document.getElementById('pixel-commentary'), kf.commentary);
  }
```

Replace the info-strip block inside `draw` with:

```js
    const snap = timeline.snapshots[fr.a.snap] || timeline.snapshots[0];
    if (snap && snap !== lastSnapRendered) {
      lastSnapRendered = snap;
      pixelRenderInfoStrip(document.getElementById('pixel-infostrip'), snap, playerById, function (side) {
        return getTeamById(side === 'home' ? session.homeTeamId : session.awayTeamId).colors.primary;
      });
    }
```

Replace the post-game card block at the end of `showFinal` with:

```js
    const pts = timeline.finalStats.points;
    const top = Object.keys(pts)
      .map(function (id) { return { id: id, pts: pts[id] }; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 5);
    pixelRenderFinalCard(document.getElementById('pixel-infostrip'), {
      homeTeam: homeTeam, awayTeam: awayTeam,
      homeScore: session.homeScore, awayScore: session.awayScore,
      lineScore: timeline.lineScore, topScorers: top, playerById: playerById
    });
```

- [ ] **Step 3: Load it before `ui/pixelGameView.js`**

In `index.html`, insert immediately before the `ui/pixelGameView.js` tag (after `ui/pixelAudio.js`):

```html
  <script src="ui/pixelHud.js"></script>
```

`pixelHud.js` calls `escapeHtml` from `ui/util.js`, which already loads far earlier in the tag order — verify that with `grep -n "ui/util.js\|ui/pixelHud.js" index.html` and confirm util comes first.

- [ ] **Step 4: Verify**

Run: `node --check ui/pixelHud.js && node --check ui/pixelGameView.js && node scripts/validate-uiSafety.js`
Expected: no `--check` output, `validate-uiSafety.js` passes.

Run: `grep -c "" ui/pixelGameView.js`
Expected: meaningfully under 982 — roughly 780 lines. If it did not shrink, code was copied rather than moved.

- [ ] **Step 5: Commit**

```bash
git add ui/pixelHud.js ui/pixelGameView.js index.html
git commit -m "refactor: extract ui/pixelHud.js from the game view"
```

---

## Stage 4c — Live stepping

### Task 6: League-side deferral of the watched game

Today the watched game is fully simulated before the view opens, which is precisely why no decision can affect it. The league must instead hand the view an unstarted `GameSim` and defer applying its result until the sim finishes.

Two things make this subtle, and both must be handled or the save file will be wrong:

1. **The watched game gets its own RNG**, seeded by a single draw from the league RNG at creation. Otherwise the shared league RNG would be consumed over minutes of wall-clock while the user watches — and `autosave` runs immediately after the day is simmed, so a reload mid-watch would restore an RNG state from the middle of a game that no longer exists. With a derived seed, the league RNG advances by exactly one draw at creation and the rest of the day is bit-identical no matter when, or whether, the user finishes watching.
2. **Day-complete news fires twice**, once for the day's other games and once for the watched game when it finishes. The alternative — holding the entire day's news until the user finishes watching — would leave the feed empty behind the view and is worse.

**Files:**
- Modify: `league.js`
- Modify: `ui/simControls.js`
- Create: `scripts/validate-liveWatch.js`

**Interfaces:**
- Consumes: `createGameSim(homeTeamId, awayTeamId, rng, options)` from `gameSim.js`; `makeRng(seed)` from `rng.js`.
- Produces: `simulateDate(season, dayIndex, settings, rng, onDayComplete, watchOptions)` where `watchOptions` may now be `{ gameId, events, live: true }`. When `live` is set, `simulateDate` returns its normal `todaysGames` array and additionally sets `watchOptions.liveGame = { sim, game, finish }`:
  - `sim` — an unstepped `GameSim` capturing into `watchOptions.events`.
  - `game` — the schedule game object it will be recorded against.
  - `finish()` — steps nothing; applies `sim.result()` to the league and fires `onDayComplete(dayIndex, [game], injuries)`. Safe to call exactly once; a second call is a no-op returning `false`. Callers must run the sim to `done` themselves before calling it.

- [ ] **Step 1: Write the failing tests**

Create `scripts/validate-liveWatch.js`:

```js
// The live watch path defers the user's game so their decisions can change
// it. That deferral is where a save file gets silently corrupted if the rng
// or the result application is wrong, so it gets its own test file.
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
require(path.join(__dirname, '..', 'gameCoach.js'));
require(path.join(__dirname, '..', 'gameSim.js'));
const schedule = require(path.join(__dirname, '..', 'schedule.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

function freshSeason(seed) {
  return schedule.generateSchedule(TEAMS, makeRng(seed));
}

function firstDayWithGames(season) {
  return season.games.reduce(function (min, g) { return Math.min(min, g.day); }, Infinity);
}

function checkWatchedGameIsDeferred() {
  const season = freshSeason(101);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };

  league.simulateDate(season, day, {}, makeRng(5), null, watch);

  assert.ok(watch.liveGame, 'a live game handle is returned');
  assert.strictEqual(watch.liveGame.game.id, target.id, 'it is the requested game');
  assert.strictEqual(target.played, false, 'the watched game is NOT recorded yet');
  assert.strictEqual(watch.liveGame.sim.done, false, 'the sim has not been stepped');
  assert.strictEqual(watch.events.length, 0, 'no events captured before stepping');

  season.games.filter(function (g) { return g.day === day && g.id !== target.id; })
    .forEach(function (g) { assert.strictEqual(g.played, true, 'every other game that day IS recorded'); });

  console.log('checkWatchedGameIsDeferred: OK');
}
checkWatchedGameIsDeferred();

function checkFinishRecordsTheResult() {
  const season = freshSeason(102);
  const day = firstDayWithGames(season);
  const target = season.games.find(function (g) { return g.day === day; });
  const watch = { gameId: target.id, events: [], live: true };
  league.simulateDate(season, day, {}, makeRng(6), null, watch);

  const sim = watch.liveGame.sim;
  while (!sim.done) sim.step();
  assert.strictEqual(watch.liveGame.finish(), true, 'finish applies the result');

  assert.strictEqual(target.played, true, 'the game is now recorded');
  assert.ok(target.homeScore > 0 && target.awayScore > 0, 'with real scores');
  assert.notStrictEqual(target.homeScore, target.awayScore, 'and no tie');
  assert.ok(target.boxScore, 'and a box score');
  assert.ok(watch.events.length > 100, 'events were captured while stepping');
  assert.strictEqual(watch.liveGame.finish(), false, 'a second finish is a no-op');

  console.log('checkFinishRecordsTheResult: OK');
}
checkFinishRecordsTheResult();

function checkLeagueRngIsIsolatedFromWatching() {
  // The rest of the day must be identical whether the user finishes watching
  // immediately, or much later, or not at all.
  function otherGameScores(finishStyle) {
    const season = freshSeason(103);
    const day = firstDayWithGames(season);
    const target = season.games.find(function (g) { return g.day === day; });
    const watch = { gameId: target.id, events: [], live: true };
    const rng = makeRng(7);
    league.simulateDate(season, day, {}, rng, null, watch);
    if (finishStyle === 'now') {
      while (!watch.liveGame.sim.done) watch.liveGame.sim.step();
      watch.liveGame.finish();
    }
    // Sim the following day off the SAME rng: if watching consumed league rng,
    // these will differ.
    league.simulateDate(season, day + 1, {}, rng, null, null);
    return season.games.filter(function (g) { return g.day === day + 1; })
      .map(function (g) { return g.homeScore + ':' + g.awayScore; }).join('|');
  }
  assert.strictEqual(otherGameScores('now'), otherGameScores('never'),
    'stepping the watched game must not advance the league rng');
  console.log('checkLeagueRngIsIsolatedFromWatching: OK');
}
checkLeagueRngIsIsolatedFromWatching();

function checkDecisionsChangeTheRecordedResult() {
  // The whole point: a different decision sequence must produce a different
  // recorded game from the same seed.
  function play(withDecisions) {
    const season = freshSeason(104);
    const day = firstDayWithGames(season);
    const target = season.games.find(function (g) { return g.day === day; });
    const watch = { gameId: target.id, events: [], live: true };
    league.simulateDate(season, day, {}, makeRng(8), null, watch);
    const sim = watch.liveGame.sim;
    let n = 0;
    while (!sim.done) {
      if (withDecisions && n % 20 === 0) sim.applyDecision({ type: 'timeout', team: 'home' });
      sim.step();
      n++;
    }
    watch.liveGame.finish();
    return target.homeScore + ':' + target.awayScore;
  }
  assert.notStrictEqual(play(true), play(false), 'user decisions change the recorded result');
  assert.strictEqual(play(true), play(true), 'and the same decisions reproduce exactly');
  console.log('checkDecisionsChangeTheRecordedResult: OK');
}
checkDecisionsChangeTheRecordedResult();

console.log('validate-liveWatch: all checks passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-liveWatch.js`
Expected: FAIL on `a live game handle is returned` — `watch.liveGame` is `undefined`.

- [ ] **Step 3: Implement the deferral in `league.js`**

First add `gameSim` and `rng` to `_simDeps()` — the **lazy** block, not the eager `_LEAGUE_DATA` one. This is not a style preference: `gameSim.js` requires `simEnginePossession.js`, which requires `league.js` back for `getTeamRoster`. Putting it in the eager block would deadlock exactly the way `_simDeps`'s own comment describes — whichever side loaded first would get a still-empty `module.exports` from the other.

```js
function _simDeps() {
  return (typeof require !== 'undefined')
    ? { simEngine: require('./simEngine.js'), fatigue: require('./fatigue.js'), injuries: require('./injuries.js'), morale: require('./morale.js'), finances: require('./finances.js'), gameSim: require('./gameSim.js'), rng: require('./rng.js') }
    : {
        simEngine: { getActiveEngine: getActiveEngine },
        fatigue: { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest },
        injuries: { rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame, INJURY_SEVERITY_TIER: INJURY_SEVERITY_TIER, GAMES_TO_DAYS: GAMES_TO_DAYS },
        morale: { tickMoraleForTeamGame: tickMoraleForTeamGame },
        finances: { tickFinancesForTeamGame: tickFinancesForTeamGame },
        gameSim: { createGameSim: createGameSim },
        rng: { makeRng: makeRng }
      };
}
```

Then in `simulateDate`, replace the `todaysGames.forEach` body's watched-game branch:

```js
  todaysGames.forEach(function (game) {
    let result;
    if (watchOptions && watchOptions.live && game.id === watchOptions.gameId) {
      // Live-watched: create the sim, do NOT step it, do NOT record anything.
      // The view steps it (under user decisions) and calls finish() below.
      //
      // Its own rng, seeded by ONE draw from the league rng: stepping happens
      // over minutes of wall clock, interleaved with autosaves, so a watched
      // game sharing the league rng would make the league's future depend on
      // when the user happened to click, and would let a mid-watch save
      // capture an rng state from inside a game that was never recorded.
      const watchRng = deps.rng.makeRng(Math.floor(rng() * 2147483647));
      const sim = deps.gameSim.createGameSim(game.homeTeamId, game.awayTeamId, watchRng,
        { events: watchOptions.events });
      let finished = false;
      watchOptions.liveGame = {
        sim: sim,
        game: game,
        finish: function () {
          if (finished) return false;
          finished = true;
          const lateInjuries = [];
          const latePlaying = {};
          applyGameResult(game, sim.result(), deps, season, dayIndex, leagueYear, latePlaying, lateInjuries, rng);
          // The day's other results already went to the feed when this
          // function's caller returned; this game's news lands when it is
          // actually decided, which is also when the user learns it.
          if (onDayComplete) onDayComplete(dayIndex, [game], lateInjuries);
          return true;
        }
      };
      playingTeamIds[game.homeTeamId] = true;
      playingTeamIds[game.awayTeamId] = true;
      return;
    }
    if (watchOptions && !watchOptions.live && game.id === watchOptions.gameId) {
      const watchEngine = deps.simEngine.getActiveEngine({ simEngine: 'possession' });
      result = watchEngine.simulateGame(game.homeTeamId, game.awayTeamId, rng, { events: watchOptions.events });
    } else {
      const engine = deps.simEngine.getActiveEngine(settings);
      result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);
    }
    applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng);
  });
```

The non-live watch branch is retained deliberately: `handleWatchNextPlayoffGame` still uses it until Task 10, and removing it now would break the playoff watch flow mid-plan.

- [ ] **Step 4: Point `watchGameOnDay` at the live path**

In `ui/simControls.js`, replace the body of `watchGameOnDay` from the `const events = [];` line through `renderView('pixelGame');` with:

```js
  const events = [];
  const watch = userGame ? { gameId: userGame.id, events: events, live: true } : null;
  simulateDate(GameState.season, targetDay, GameState.settings, GameState.rng, handleDayComplete, watch);
  GameState.season.currentDay = targetDay;

  if (statusEl) statusEl.textContent = '';
  if (!watch || !watch.liveGame) {
    // Graceful fallback (spec): behave like a normal Next Game click.
    if (statusEl) statusEl.textContent = 'Game could not be watched — simmed normally.';
    renderView(GameState.currentView);
    autosave(GameState);
    return;
  }

  // Saving here records the day's OTHER games and the advanced day. The
  // watched game is still unplayed and is not in the save: if the user
  // reloads mid-watch it simply has not happened yet, which is the only
  // consistent state available (playback lives in memory by design — see the
  // module comment in ui/pixelGameView.js).
  autosave(GameState);

  setLiveWatchSession({
    homeTeamId: watch.liveGame.game.homeTeamId,
    awayTeamId: watch.liveGame.game.awayTeamId,
    events: events,
    sim: watch.liveGame.sim,
    userTeamId: GameState.userTeamId,
    onFinish: function () {
      watch.liveGame.finish();
      autosave(GameState);
    }
  });
  renderView('pixelGame');
```

`setLiveWatchSession` does not exist yet — it arrives in Task 7. **This step therefore leaves the app broken in the browser until Task 7 lands**, which is why Tasks 6 and 7 must be executed back to back and neither is a release point. The Node suite still passes throughout, because it never calls `watchGameOnDay`.

- [ ] **Step 5: Run the tests**

Run: `node scripts/validate-liveWatch.js`
Expected: PASS, all five checks.

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 6: Commit**

```bash
git add league.js ui/simControls.js scripts/validate-liveWatch.js
git commit -m "feat: defer the watched game so the user's decisions can decide it"
```

---

### Task 7: The view drives the live sim

The view currently receives a finished game and builds one timeline up front. It now receives a `GameSim` and keeps the timeline a few seconds ahead of playback by stepping and choreographing as it goes.

**Files:**
- Modify: `ui/pixelGameView.js`

**Interfaces:**
- Consumes: `createChoreographer` / `groupPossessions` (Task 3), `sim.step()` / `sim.done` / `sim.result()` (existing), the live session shape produced by Task 6.
- Produces:
  - `setLiveWatchSession(liveSession)` where `liveSession = { homeTeamId, awayTeamId, events, sim, userTeamId, onFinish }`.
  - `setWatchSession(session)` unchanged, for replays of completed games.
  - Both are exported; `ui/simControls.js` calls the live one and the replay list calls neither (it re-renders from `_replayHistory`).

- [ ] **Step 1: Add the live session entry point**

In `ui/pixelGameView.js`, alongside `setWatchSession`:

```js
// A live session is a game that has NOT happened yet: the view steps it while
// playing it back. It only enters the replay history once it is complete,
// because until then there is no result to replay.
function setLiveWatchSession(liveSession) {
  _watchSession = Object.assign({}, liveSession, { live: true, homeScore: 0, awayScore: 0 });
}
```

and add it to the `module.exports` block at the bottom of the file.

- [ ] **Step 2: Branch `renderPixelGame` on live vs replay**

Replace the block that builds rosters and the timeline (currently the `homeRoster`/`awayRoster` derivation from `session.boxScore`, and the `buildTimeline({...})` call) with:

```js
  // Live: the rosters come from the sim, which is the authority on who is
  // eligible tonight. Replay: rebuild them from the box score (teamId stamped
  // per line — see simEngineBoxScore.js) rather than live team rosters, so a
  // trade or injury after the fact can't desync the replay from what happened.
  const homeRoster = session.live
    ? session.sim.homeRoster
    : Object.keys(session.boxScore)
        .map(function (id) { return getPlayerById(id); })
        .filter(function (p) { return p && session.boxScore[p.id].teamId === session.homeTeamId; });
  const awayRoster = session.live
    ? session.sim.awayRoster
    : Object.keys(session.boxScore)
        .map(function (id) { return getPlayerById(id); })
        .filter(function (p) { return p && session.boxScore[p.id].teamId === session.awayTeamId; });

  const choreographer = createChoreographer({
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    homeName: homeTeam.name,
    awayName: awayTeam.name,
    homeAbbr: homeTeam.id,
    awayAbbr: awayTeam.id
  });

  // Replay feeds the whole stored log in immediately; live feeds it one
  // possession at a time from stepAhead() below.
  if (!session.live) {
    groupPossessions(session.events).forEach(function (slice) { choreographer.appendEvents(slice); });
    choreographer.finish();
  }
  const timeline = choreographer.timeline;
```

`const kfs = timeline.keyframes;` still works: `keyframes` is the same array object throughout, mutated in place as possessions are appended.

- [ ] **Step 3: Step the sim ahead of playback**

Add near the other playback state in `renderPixelGame`:

```js
  // How far ahead of the playhead the choreographed timeline is kept. Two
  // seconds is roughly three possessions of beats — enough that a slow frame
  // never starves playback, small enough that a decision made now still lands
  // within a few seconds of game time rather than a minute later.
  const STEP_AHEAD_MS = 2000;
  // A hard per-frame cap. Without it, a tab that was backgrounded (or a Skip
  // to Final on a game that has barely started) would try to choreograph the
  // entire remaining game inside one animation frame and drop the tab.
  const MAX_STEPS_PER_FRAME = 12;

  let liveFinished = false;

  function stepAhead(budget) {
    if (!session.live) return;
    let steps = 0;
    while (!session.sim.done &&
           timeline.durationMs - playbackMs < STEP_AHEAD_MS &&
           steps < budget) {
      const before = session.events.length;
      session.sim.step();
      choreographer.appendEvents(session.events.slice(before));
      steps += 1;
    }
    if (session.sim.done) finishLiveGame();
  }

  // Closes the game out exactly once: the choreographer is sealed, the
  // session becomes an ordinary completed session (so Replay works on it and
  // it joins the replay history), and the league records the result.
  function finishLiveGame() {
    if (liveFinished || !session.live) return;
    liveFinished = true;
    choreographer.finish();
    const result = session.sim.result();
    session.homeScore = result.homeScore;
    session.awayScore = result.awayScore;
    session.boxScore = result.boxScore;
    session.live = false;
    if (session.onFinish) session.onFinish();
    _replayHistory.unshift(session);
    if (_replayHistory.length > REPLAY_LIMIT) _replayHistory.length = REPLAY_LIMIT;
  }

  // Runs whatever is left under the auto-coach and choreographs it. Used by
  // Skip to Final and by Exit: the spec is explicit that a half-played game is
  // never recorded, so leaving the view completes the game rather than
  // discarding it.
  function runOutLiveGame() {
    if (!session.live) return;
    while (!session.sim.done) {
      const before = session.events.length;
      session.sim.step();
      choreographer.appendEvents(session.events.slice(before));
    }
    finishLiveGame();
  }
```

`_replayHistory` and `REPLAY_LIMIT` are module-level and already in scope. `setWatchSession` pushes to the history for replays; live sessions are pushed here instead, once they are real.

- [ ] **Step 4: Drive it from the animation loop**

Replace `tick`:

```js
  function tick(ts) {
    if (lastFrameTs === null) lastFrameTs = ts;
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;

    // Step BEFORE advancing the playhead, so the frame about to be drawn is
    // never past the end of the choreographed timeline.
    stepAhead(MAX_STEPS_PER_FRAME);

    if (!paused) {
      // hitchMs freezes the whole scene (make freeze-frames, quarter cards)
      if (hitchMs > 0) hitchMs -= dt;
      else playbackMs += dt * speed;
    }
    // A live game is only over when the SIM is done and playback has caught
    // up to it. Checking durationMs alone would show the final card during
    // the first frame, when the timeline is still empty.
    if (playbackMs >= timeline.durationMs && (!session.live || liveFinished)) {
      showFinal();
      _rafId = null;
      return;
    }
    // Playback outran the sim (very high speed, or a slow step): hold the
    // playhead at the end of what exists rather than interpolating past it.
    if (playbackMs > timeline.durationMs) playbackMs = timeline.durationMs;

    if (kfs.length === 0) { _rafId = requestAnimationFrame(tick); return; }
    draw(dt);
    _rafId = requestAnimationFrame(tick);
  }
```

- [ ] **Step 5: Make quarter/period display handle overtime**

In `draw`, replace the quarter-advance block's label and the two display sites so overtime reads as OT rather than Q4. Add near the other helpers in `renderPixelGame`:

```js
  function periodLabel(period) {
    return period <= 4 ? 'Q' + period : 'OT' + (period - 4);
  }
```

Then in `draw`, change the quarter-card trigger from `fr.a.quarter > lastQuarterSeen` to `fr.a.period > lastQuarterSeen`, its card text to `'END OF ' + periodLabel(lastQuarterSeen)`, and `lastQuarterSeen = fr.a.period`. Change the canvas scoreboard's `const qText = 'Q' + fr.a.quarter;` to `const qText = periodLabel(fr.a.period);`, and the DOM mirror `document.getElementById('pixel-quarter').textContent = 'Q' + fr.a.quarter;` to `= periodLabel(fr.a.period);`.

- [ ] **Step 6: Wire Skip to Final and Exit to run the game out**

In the `#pixel-skip` handler, add `runOutLiveGame();` as the first statement (before `stopPixelPlayback()`), so the timeline is complete before `showFinal()` reads `timeline.lineScore`.

In the `#pixel-exit` handler, add `runOutLiveGame();` as the first statement, so leaving mid-game still records a complete game.

In the `#pixel-replay` handler, guard against replaying a game that is still being played:

```js
  document.getElementById('pixel-replay').addEventListener('click', function () {
    if (session.live) return;   // nothing to replay yet — the game is still happening
    stopPixelPlayback();
    renderPixelGame(container); // same session, fresh from tip-off
  });
```

and disable that button while live, right after the shell is inserted:

```js
  if (session.live) document.getElementById('pixel-replay').disabled = true;
```

- [ ] **Step 7: Use the live score in `showFinal`**

`showFinal` reads `session.homeScore` / `session.awayScore`, which `finishLiveGame` sets before it can ever be called. No change needed — confirm by reading `showFinal` rather than assuming.

- [ ] **Step 8: Verify in Node what can be verified in Node**

Run: `node --check ui/pixelGameView.js && node scripts/validate-uiSafety.js`
Expected: no `--check` output, `validate-uiSafety.js` passes.

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 9: Verify in the browser**

Start a server on a **fresh port with caching disabled** — this project has repeatedly served stale JS from a warm port, producing "fixes that didn't work" that were actually never loaded:

```bash
python scripts/devserver.py 8211
```

Then, in the preview browser at `http://localhost:8211`: start a new GM game, click **Watch Next Game**, and confirm all of the following before moving on:

1. The court renders and play begins within a second — it is not waiting for a whole game to simulate.
2. The scoreboard clock counts down and the score changes.
3. The console has **zero errors** (`read_console_messages`).
4. Let it run to the final buzzer: the post-game card shows a line score and top scorers.
5. Navigate to Schedule: the watched game is recorded with the same final score shown on the card.
6. Click **Watch Next Game** again: a second game plays.
7. On a third game, click **Exit** at roughly the midpoint, then check Schedule: that game is recorded, complete, with a plausible full-game score (both teams above 80).

- [ ] **Step 10: Commit**

```bash
git add ui/pixelGameView.js
git commit -m "feat: the view steps the sim live instead of replaying a finished game"
```

---

### Task 8: Timeout and substitution controls

The user can now watch a live game but cannot touch it. This task connects the two controls the shell already renders. Both act only on the user's own team, and both are entirely optional — the auto-coach continues to run the team if they are never clicked.

**Files:**
- Modify: `ui/pixelHud.js`
- Modify: `ui/pixelGameView.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `sim.applyDecision` (Task 1), `sim.onCourt`, `sim.homeRoster` / `sim.awayRoster`, `sim.homeBox` / `sim.awayBox`, `sim.timeoutsLeft`, `sim.secondsPlayed`.
- Produces: `pixelRenderSubPanel(panelEl, data)` where
  `data = { onCourt: [player], bench: [player], lineFor(playerId) → boxLine, selectedOutId }`.
  The panel emits clicks through standard DOM events on `.pixel-sub-out` / `.pixel-sub-in` buttons carrying `data-pid`; the view owns the selection state.

- [ ] **Step 1: Add the substitution panel renderer to `ui/pixelHud.js`**

```js
// The substitution panel. Two columns: who is on the floor, and who is
// available. Click a player on the floor, then a player on the bench, and the
// swap is queued. Minutes and fouls are shown because those are the only two
// numbers that actually drive the decision.
function pixelRenderSubPanel(panelEl, data) {
  function row(p, side) {
    const line = data.lineFor(p.id) || {};
    const mins = Math.round((line.secondsPlayed || 0) / 60);
    const selected = side === 'out' && p.id === data.selectedOutId;
    const fouledOut = (line.fouls || 0) >= 6;
    return '<button class="pixel-sub-' + side + (selected ? ' is-selected' : '') + '"' +
      (fouledOut ? ' disabled title="Fouled out"' : '') +
      ' data-pid="' + escapeHtml(p.id) + '">' +
      '<span class="pixel-sub-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="pixel-sub-stat">' + mins + '′ · ' + (line.points || 0) + 'p · ' +
        (line.fouls || 0) + 'f</span>' +
      '</button>';
  }
  panelEl.innerHTML =
    '<div class="pixel-sub-col"><div class="pixel-sub-head">On the floor</div>' +
      data.onCourt.map(function (p) { return row(p, 'out'); }).join('') + '</div>' +
    '<div class="pixel-sub-col"><div class="pixel-sub-head">' +
      (data.selectedOutId ? 'Bring in for the selected player' : 'Bench') + '</div>' +
      data.bench.map(function (p) { return row(p, 'in'); }).join('') + '</div>';
}
```

Add it to that file's `module.exports`.

- [ ] **Step 2: Wire the controls in `ui/pixelGameView.js`**

Add inside `renderPixelGame`, after the shell is inserted (replacing the two `disabled = true` lines from Task 5):

```js
  // Which side the user coaches. A replayed game and any game the user's team
  // is not in are watch-only: the controls stay disabled rather than being
  // hidden, so the view has one layout instead of two.
  const userSide = session.live && session.userTeamId === session.homeTeamId ? 'home'
    : (session.live && session.userTeamId === session.awayTeamId ? 'away' : null);

  const timeoutBtn = document.getElementById('pixel-timeout');
  const subsBtn = document.getElementById('pixel-subs');
  const subPanel = document.getElementById('pixel-subpanel');
  let selectedOutId = null;

  function userLineFor(pid) {
    const box = userSide === 'home' ? session.sim.homeBox : session.sim.awayBox;
    const line = box[pid];
    if (!line) return null;
    // secondsPlayed lives on the sim, not the box line (box `minutes` is only
    // written at result() time), so it is merged in for display here.
    return Object.assign({}, line, { secondsPlayed: session.sim.secondsPlayed[pid] || 0 });
  }

  function refreshTimeoutBtn() {
    if (!userSide) { timeoutBtn.disabled = true; timeoutBtn.textContent = 'Timeout'; return; }
    const left = session.sim.timeoutsLeft[userSide];
    timeoutBtn.textContent = 'Timeout (' + left + ')';
    timeoutBtn.disabled = left <= 0 || liveFinished;
  }

  function refreshSubPanel() {
    if (!userSide) return;
    const roster = userSide === 'home' ? session.sim.homeRoster : session.sim.awayRoster;
    const onIds = session.sim.onCourt[userSide];
    const byId = {};
    roster.forEach(function (p) { byId[p.id] = p; });
    pixelRenderSubPanel(subPanel, {
      onCourt: onIds.map(function (id) { return byId[id]; }).filter(Boolean),
      bench: roster.filter(function (p) { return onIds.indexOf(p.id) === -1; }),
      lineFor: userLineFor,
      selectedOutId: selectedOutId
    });
  }

  if (!userSide) {
    timeoutBtn.disabled = true;
    subsBtn.disabled = true;
  } else {
    refreshTimeoutBtn();
    timeoutBtn.addEventListener('click', function () {
      if (!session.sim.applyDecision({ type: 'timeout', team: userSide })) return;
      // Queued, not spent: it lands at the next possession boundary. Say so,
      // rather than decrementing a counter the engine has not decremented.
      timeoutBtn.textContent = 'Timeout called';
      timeoutBtn.disabled = true;
      pixelPushCommentary(document.getElementById('pixel-commentary'),
        'You call timeout — the team gathers at the bench');
    });

    subsBtn.addEventListener('click', function () {
      subPanel.hidden = !subPanel.hidden;
      subsBtn.classList.toggle('active', !subPanel.hidden);
      if (!subPanel.hidden) refreshSubPanel();
    });

    subPanel.addEventListener('click', function (e) {
      const out = e.target.closest('.pixel-sub-out');
      if (out) { selectedOutId = out.getAttribute('data-pid'); refreshSubPanel(); return; }
      const inBtn = e.target.closest('.pixel-sub-in');
      if (!inBtn || !selectedOutId) return;
      const inId = inBtn.getAttribute('data-pid');
      session.sim.applyDecision({ type: 'substitution', team: userSide, swaps: [{ out: selectedOutId, in: inId }] });
      selectedOutId = null;
      refreshSubPanel();
    });
  }
```

`refreshTimeoutBtn` and `refreshSubPanel` must be called again once the decision actually lands. Add to the end of `stepAhead`, inside the `while` loop body after `steps += 1;`:

```js
      if (userSide) {
        refreshTimeoutBtn();
        if (!subPanel.hidden) refreshSubPanel();
      }
```

Because `stepAhead` is defined before these, hoisting matters: `refreshTimeoutBtn`/`refreshSubPanel` are function declarations and are hoisted within `renderPixelGame`'s scope, but `userSide` is a `const` in the temporal dead zone until its declaration runs. `stepAhead` is only *called* from `tick`, which starts after everything is declared, so this is safe — but declare `userSide` above `stepAhead` anyway rather than relying on that reasoning.

- [ ] **Step 3: Style the panel**

Append to `style.css`:

```css
.pixel-subpanel { display: flex; gap: 12px; width: 100%; max-width: 640px; }
.pixel-subpanel[hidden] { display: none; }
.pixel-sub-col { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.pixel-sub-head { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-mute); margin-bottom: 2px; }
.pixel-sub-out, .pixel-sub-in {
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
  width: 100%; text-align: left; padding: 4px 7px; font-size: 0.82rem;
}
.pixel-sub-out.is-selected { outline: 2px solid #4a90d9; }
.pixel-sub-stat { color: var(--text-mute); font-variant-numeric: tabular-nums; font-size: 0.74rem; }
.pixel-controls #pixel-subs.active { outline: 2px solid #4a90d9; }
```

- [ ] **Step 4: Verify in the browser**

Run: `python scripts/devserver.py 8212`

At `http://localhost:8212`, start a new GM game and click **Watch Next Game**, then confirm:

1. The **Timeout** button shows a count (`Timeout (7)`).
2. Clicking it changes the label to `Timeout called`, and within a few seconds of playback the button returns showing `Timeout (6)` — proving the decision reached the engine at a possession boundary.
3. **Subs** opens a two-column panel showing exactly five players on the floor and the rest on the bench, with minutes/points/fouls on each.
4. Selecting a player on the floor outlines them; then clicking a bench player queues the swap. Within a few seconds the panel updates to show the substitute on the floor, and the sprite for the outgoing player jogs off the court while the substitute jogs on (the run-on/run-off animation already exists — this is the first time it fires on a real substitution).
5. Console shows zero errors.
6. Let the game finish and confirm the recorded box score gives the substituted-in player non-zero minutes.

- [ ] **Step 5: Commit**

```bash
git add ui/pixelHud.js ui/pixelGameView.js style.css
git commit -m "feat: live timeout and substitution controls"
```

---

### Task 9: Non-blocking nudges

The design principle is explicit: agency is an opportunity, never an obligation, and a user must be able to watch a full game hands-off. Nudges surface the two moments where a decision is actually available, without ever pausing playback. An ignored nudge expires and the auto-coach decides exactly as it otherwise would.

**Files:**
- Modify: `ui/pixelHud.js`
- Modify: `ui/pixelGameView.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `sim.run` (`{ team, points }`), `sim.timeoutsLeft`, `sim.onCourt`, box lines' `fouls`, and `RUN_TRIGGER_POINTS` / `FOUL_TROUBLE` from `gameCoach.js` (already exported).
- Produces: `pixelRenderNudge(slotEl, nudge)` where `nudge = { text, actionLabel, kind }` or `null` to clear. The action button is `#pixel-nudge-action`; the view owns what it does.

- [ ] **Step 1: Add the nudge renderer to `ui/pixelHud.js`**

```js
// A nudge is a suggestion, never a prompt: it renders in a reserved slot
// under the court, playback keeps running behind it, and it disappears on its
// own. There is deliberately no "dismiss" — ignoring it IS dismissing it, and
// a button whose only job is to make the user act is the micromanagement this
// whole design is trying to avoid.
function pixelRenderNudge(slotEl, nudge) {
  if (!nudge) { slotEl.innerHTML = ''; return; }
  slotEl.innerHTML =
    '<div class="pixel-nudge pixel-nudge-' + escapeHtml(nudge.kind) + '">' +
      '<span class="pixel-nudge-text">' + escapeHtml(nudge.text) + '</span>' +
      '<button id="pixel-nudge-action">' + escapeHtml(nudge.actionLabel) + '</button>' +
    '</div>';
}
```

Add it to that file's `module.exports`.

- [ ] **Step 2: Drive nudges from the view**

Add to `renderPixelGame`, after the substitution wiring from Task 8:

```js
  // Nudges live on the playback clock, not the wall clock, so they last the
  // same number of possessions at 1x and at 8x.
  const NUDGE_LIFETIME_MS = 6000;
  const nudgeSlot = document.getElementById('pixel-nudge-slot');
  let activeNudge = null;        // { kind, key, expiresAt, apply }
  let lastNudgeKey = null;       // so one situation nudges once, not every step

  function showNudge(nudge) {
    if (!nudge || nudge.key === lastNudgeKey) return;
    lastNudgeKey = nudge.key;
    activeNudge = nudge;
    activeNudge.expiresAt = playbackMs + NUDGE_LIFETIME_MS;
    pixelRenderNudge(nudgeSlot, nudge);
    const btn = document.getElementById('pixel-nudge-action');
    if (btn) btn.addEventListener('click', function () {
      nudge.apply();
      clearNudge();
    });
  }

  function clearNudge() {
    activeNudge = null;
    pixelRenderNudge(nudgeSlot, null);
  }

  function checkNudges() {
    if (!userSide || liveFinished) return;
    if (activeNudge) {
      if (playbackMs >= activeNudge.expiresAt) clearNudge();
      return;
    }
    const sim = session.sim;
    const other = userSide === 'home' ? 'away' : 'home';

    // 1. The opponent is on a run and we still have a timeout.
    if (sim.run.team === other && sim.run.points >= RUN_TRIGGER_POINTS && sim.timeoutsLeft[userSide] > 0) {
      const oppName = (userSide === 'home' ? awayTeam : homeTeam).name;
      showNudge({
        kind: 'run',
        key: 'run:' + other + ':' + sim.run.points,
        text: oppName + ' on a ' + sim.run.points + '-0 run',
        actionLabel: 'Call timeout',
        apply: function () { sim.applyDecision({ type: 'timeout', team: userSide }); refreshTimeoutBtn(); }
      });
      return;
    }

    // 2. A player on the floor is in foul trouble before the fourth quarter.
    // The coach will sit him anyway on its own schedule; this just gives the
    // user the chance to do it first, or to leave him in.
    if (sim.period < 4) {
      const box = userSide === 'home' ? sim.homeBox : sim.awayBox;
      const introuble = sim.onCourt[userSide].find(function (id) {
        return box[id] && box[id].fouls >= FOUL_TROUBLE && box[id].fouls < 6;
      });
      if (introuble) {
        const p = playerById[introuble];
        showNudge({
          kind: 'fouls',
          key: 'fouls:' + introuble + ':' + box[introuble].fouls,
          text: (p ? p.name : 'A starter') + ' has ' + box[introuble].fouls + ' fouls',
          actionLabel: 'Open subs',
          apply: function () {
            subPanel.hidden = false;
            subsBtn.classList.add('active');
            selectedOutId = introuble;
            refreshSubPanel();
          }
        });
      }
    }
  }
```

Call it once per frame from `tick`, immediately after `stepAhead(MAX_STEPS_PER_FRAME);`:

```js
    checkNudges();
```

`RUN_TRIGGER_POINTS` and `FOUL_TROUBLE` are browser globals from `gameCoach.js`, which `index.html` loads long before the `ui/` files — verify with `grep -n "gameCoach.js\|ui/pixelGameView.js" index.html` and confirm the ordering rather than assuming it.

- [ ] **Step 3: Style the nudge**

Append to `style.css`:

```css
.pixel-nudge-slot { min-height: 30px; display: flex; justify-content: center; align-items: center; }
.pixel-nudge {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 5px 10px; border-radius: 4px;
  background: rgba(10, 12, 16, 0.9); border: 1px solid #4a5262;
  font-size: 0.85rem;
}
.pixel-nudge-run { border-color: #d8a13c; }
.pixel-nudge-fouls { border-color: #ff6b5c; }
.pixel-nudge-text { color: var(--text, #e8e8e8); }
```

The slot reserves its height whether or not a nudge is showing, so a nudge appearing never shifts the canvas or the controls under the user's cursor.

- [ ] **Step 4: Verify in the browser**

Run: `python scripts/devserver.py 8213`

At `http://localhost:8213`, watch a game at 4× and confirm:

1. A nudge card appears during the game (an 8-0 opponent run is common; if none appears within a full game, watch a second one before concluding the trigger is broken).
2. **Playback does not pause or slow when it appears** — this is the single most important assertion in this task.
3. Ignoring it: the card disappears on its own after about six seconds of playback time, and the game continues.
4. Clicking **Call timeout** on a run nudge: the card clears, and the timeout counter in the control bar drops within a few seconds.
5. Clicking **Open subs** on a foul-trouble nudge: the panel opens with the player in trouble already selected.
6. Console shows zero errors.
7. The canvas does not jump when a nudge appears or clears.

- [ ] **Step 5: Commit**

```bash
git add ui/pixelHud.js ui/pixelGameView.js style.css
git commit -m "feat: non-blocking nudges for opponent runs and foul trouble"
```

---

### Task 10: The playoff watch path goes live

Playoff games still pre-sim and replay. Since the postseason is when a user most wants to coach, it gets the same treatment. `simulateSeriesGame` splits along the same seam as `simulateDate`: everything from the `applyAutoWin` call to the series-win bookkeeping becomes a deferred `finish()`.

**Files:**
- Modify: `playoffs.js`
- Modify: `ui/simControls.js`
- Modify: `scripts/validate-liveWatch.js`

**Interfaces:**
- Produces:
  - `simulateSeriesGame(series, settings, rng, watchOptions)` — unchanged signature and return value when `watchOptions.live` is not set.
  - When `watchOptions.live` is set **and this game involves `watchOptions.teamId`**, it sets `watchOptions.liveGame = { sim, game, finish }` and returns `null` without touching the series. `game` is the partially-built game object (team ids and `isPlayoff` set, scores filled in by `finish`).
  - `simulateNextPlayoffGame` returns `null` in that case too, and does **not** call `advanceBracketIfRoundComplete` — that moves into `finish()`, because a bracket cannot advance past a game that has not been decided.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-liveWatch.js`, before its final summary line:

```js
// --- Task 10: the playoff path ------------------------------------------

const playoffs = require(path.join(__dirname, '..', 'playoffs.js'));

function checkPlayoffGameIsDeferred() {
  const season = freshSeason(105);
  // Play the whole regular season so a real bracket can be generated.
  const lastDay = season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  const rng = makeRng(9);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(season, d, {}, rng, null, null);
  const bracket = playoffs.generateBracket(season);

  // Whoever is in the very first series is the "user" for this test.
  const firstSeries = playoffs.getCurrentRoundSeries(bracket)[0];
  const teamId = firstSeries.higherSeed;

  const watch = { teamId: teamId, events: [], live: true };
  let guard = 0;
  let game = null;
  while (guard++ < 200) {
    game = playoffs.simulateNextPlayoffGame(bracket, {}, rng, watch);
    if (watch.liveGame) break;
    if (game === null) break;
  }
  assert.ok(watch.liveGame, 'a live playoff game handle is returned');
  assert.strictEqual(watch.liveGame.sim.done, false, 'the sim has not been stepped');

  const seriesBefore = firstSeries.winsHigher + firstSeries.winsLower;
  while (!watch.liveGame.sim.done) watch.liveGame.sim.step();
  assert.strictEqual(watch.liveGame.finish(), true, 'finish applies the result');
  const foundSeries = playoffs.getCurrentRoundSeries(bracket).concat(bracket.first)
    .find(function (s) { return s.id === firstSeries.id; }) || firstSeries;
  assert.strictEqual(foundSeries.winsHigher + foundSeries.winsLower, seriesBefore + 1,
    'the series advanced by exactly one game, and only after finish()');
  assert.ok(watch.events.length > 100, 'events were captured');
  console.log('checkPlayoffGameIsDeferred: OK');
}
checkPlayoffGameIsDeferred();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-liveWatch.js`
Expected: FAIL on `a live playoff game handle is returned`.

- [ ] **Step 3: Split `simulateSeriesGame`**

In `playoffs.js`, replace `simulateSeriesGame` with:

```js
function simulateSeriesGame(series, settings, rng, watchOptions) {
  const gameNumber = series.winsHigher + series.winsLower; // 0-indexed into HOME_PATTERN
  const homeIsHigher = HOME_PATTERN[gameNumber] === 'higher';
  const homeTeamId = homeIsHigher ? series.higherSeed : series.lowerSeed;
  const awayTeamId = homeIsHigher ? series.lowerSeed : series.higherSeed;

  const watched = !!(watchOptions && watchOptions.events &&
    (homeTeamId === watchOptions.teamId || awayTeamId === watchOptions.teamId));

  // Live-watched: hand back an unstepped sim and defer everything that
  // records the game. The series (and therefore the bracket) must not move
  // until the game is actually decided, so all of it goes in finish().
  if (watched && watchOptions.live) {
    const watchRng = _PLAYOFF_DATA.rng.makeRng(Math.floor(rng() * 2147483647));
    const sim = _PLAYOFF_DATA.gameSim.createGameSim(homeTeamId, awayTeamId, watchRng,
      { events: watchOptions.events });
    const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, isPlayoff: true, seriesId: series.id };
    let finished = false;
    watchOptions.liveGame = {
      sim: sim,
      game: game,
      finish: function () {
        if (finished) return false;
        finished = true;
        recordSeriesGameResult(series, game, sim.result(), homeIsHigher, rng);
        return true;
      }
    };
    return null;
  }

  const engine = watched
    ? _PLAYOFF_DATA.simEngine.getActiveEngine({ simEngine: 'possession' })
    : _PLAYOFF_DATA.simEngine.getActiveEngine(settings);
  const result = watched
    ? engine.simulateGame(homeTeamId, awayTeamId, rng, { events: watchOptions.events })
    : engine.simulateGame(homeTeamId, awayTeamId, rng);
  const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, isPlayoff: true, seriesId: series.id };
  recordSeriesGameResult(series, game, result, homeIsHigher, rng);
  return game;
}

// Everything that turns a simulated result into a recorded playoff game.
// Extracted so the live-watched path can run it later, after the user has
// finished coaching the game, without duplicating any of it.
function recordSeriesGameResult(series, game, result, homeIsHigher, rng) {
  _PLAYOFF_DATA.godMode.applyAutoWin(game.homeTeamId, game.awayTeamId, result, rng);
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.boxScore = result.boxScore;
  game.playByPlay = result.playByPlay || null;

  _PLAYOFF_DATA.league.recordGameResult(game);
  const homeWon = result.homeScore > result.awayScore;
  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      _PLAYOFF_DATA.league.accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
    const minutesByPlayerId = {};
    Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(game.homeTeamId, homeWon, minutesByPlayerId);
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(game.awayTeamId, !homeWon, minutesByPlayerId);
  }

  const higherWonThisGame = homeWon === homeIsHigher;
  if (higherWonThisGame) series.winsHigher += 1; else series.winsLower += 1;

  if (isSeriesComplete(series)) {
    series.complete = true;
    series.winner = series.winsHigher === 4 ? series.higherSeed : series.lowerSeed;
  }
  return game;
}
```

Add `rng` and `gameSim` to `_PLAYOFF_DATA`. Unlike `league.js`, the eager block is correct here: nothing `gameSim.js` pulls in requires `playoffs.js` back, so there is no cycle to resolve lazily.

```js
var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), league: require('./league.js'), morale: require('./morale.js'), godMode: require('./godMode.js'), gameSim: require('./gameSim.js'), rng: require('./rng.js') }
  : {
      data: { CONFERENCES: CONFERENCES },
      teams: { TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      league: { recordGameResult: recordGameResult, accumulateSeasonStats: accumulateSeasonStats },
      morale: { tickMoraleForTeamGame: tickMoraleForTeamGame },
      godMode: { applyAutoWin: applyAutoWin },
      gameSim: { createGameSim: createGameSim },
      rng: { makeRng: makeRng }
    };
```

Then in `simulateNextPlayoffGame`, defer the bracket advance for a live game:

```js
  const game = simulateSeriesGame(activeSeries, settings, rng, watchOptions);
  if (watchOptions && watchOptions.liveGame) {
    // The bracket cannot advance past a game that has not been played yet;
    // finish() (called by the view) is followed by the caller re-checking.
    return null;
  }
  advanceBracketIfRoundComplete(bracket);
  return game;
```

And in `ui/simControls.js`'s `handleWatchNextPlayoffGame`, replace the loop and session setup:

```js
  const events = [];
  const watch = { teamId: GameState.userTeamId, events: events, live: true };
  let guard = 0;
  // Guard: a full bracket is at most 105 games; the cap only exists so a
  // malformed bracket can't spin forever.
  while (guard++ < 200) {
    const game = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng, watch);
    if (watch.liveGame) break;       // reached the user's game
    if (game === null) break;        // champion already crowned
  }

  if (statusEl) statusEl.textContent = '';
  if (!watch.liveGame) {
    if (statusEl) statusEl.textContent = 'No remaining games for your team to watch.';
    renderView(GameState.currentView);
    autosave(GameState);
    return;
  }

  autosave(GameState);
  setLiveWatchSession({
    homeTeamId: watch.liveGame.game.homeTeamId,
    awayTeamId: watch.liveGame.game.awayTeamId,
    events: events,
    sim: watch.liveGame.sim,
    userTeamId: GameState.userTeamId,
    isPlayoff: true,
    onFinish: function () {
      watch.liveGame.finish();
      // The bracket advance was deferred with the result; do it now that the
      // series actually has this game in it.
      advanceBracketIfRoundComplete(GameState.playoffBracket);
      autosave(GameState);
    }
  });
  renderView('pixelGame');
```

`advanceBracketIfRoundComplete` must be exported from `playoffs.js` for this call — add it to that file's `module.exports` if it is not already there, and verify it is a browser global (it is a top-level `function` in a `<script>`-loaded file, so it is).

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-liveWatch.js && node scripts/validate-playIn.js`
Expected: both PASS.

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 5: Verify in the browser**

Run: `python scripts/devserver.py 8214`

At `http://localhost:8214`: start a new GM game, use **Sim to End** to reach the playoffs (pick a strong team so it makes the bracket — or use the commissioner tools to place one), then click **Watch Next Game** during the postseason and confirm:

1. A playoff game plays live, with the timeout and sub controls enabled.
2. The post-game card shows the result.
3. The Playoffs view shows the series updated by exactly one game, with a matching score.
4. Console shows zero errors.

If the user's team is eliminated, confirm the "No remaining games for your team to watch" message appears rather than an error.

- [ ] **Step 6: Commit**

```bash
git add playoffs.js ui/simControls.js scripts/validate-liveWatch.js
git commit -m "feat: live-coached playoff games"
```

---

### Task 11: Smoke coverage and full verification

The Node suite cannot see the screen and the browser checks so far have been manual. This adds the live controls to the in-app smoke harness — which exists precisely because features have shipped "working" by every assertion that was run while being invisible or unreachable to a user — and runs the whole plan's verification.

**Files:**
- Modify: `scripts/ui-smoke.js`

- [ ] **Step 1: Add a `live` group to `scripts/ui-smoke.js`**

Following the file's existing group structure and its rule — *assert what is VISIBLE AND REACHABLE, not merely what exists in the DOM* — add:

```js
  // The live watch controls. These assert reachability, not just presence:
  // an earlier feature in this app shipped with correct markup rendered
  // 3,200px below the fold, and every DOM-existence assertion passed.
  function liveGroup() {
    const results = [];
    const view = viewContent();

    const canvas = view.querySelector('#pixel-canvas');
    results.push(ok('live: canvas is visible', canvas && isVisible(canvas)));

    const timeout = view.querySelector('#pixel-timeout');
    results.push(ok('live: timeout button is visible', timeout && isVisible(timeout)));
    results.push(ok('live: timeout button shows a count',
      timeout && /Timeout \(\d\)/.test(timeout.textContent), timeout ? timeout.textContent : null));

    const subs = view.querySelector('#pixel-subs');
    results.push(ok('live: subs button is visible and enabled', subs && isVisible(subs) && !subs.disabled));

    if (subs && !subs.disabled) {
      subs.click();
      const panel = viewContent().querySelector('#pixel-subpanel');
      results.push(ok('live: subs panel opens', panel && !panel.hidden && isVisible(panel)));
      const onFloor = viewContent().querySelectorAll('#pixel-subpanel .pixel-sub-out');
      results.push(ok('live: exactly five players on the floor', onFloor.length === 5, onFloor.length));
      const bench = viewContent().querySelectorAll('#pixel-subpanel .pixel-sub-in');
      results.push(ok('live: bench is populated', bench.length > 0, bench.length));
      viewContent().querySelector('#pixel-subs').click(); // close again
    }

    const slot = view.querySelector('#pixel-nudge-slot');
    results.push(ok('live: nudge slot reserves its space', slot && slot.getBoundingClientRect().height > 0));

    return results;
  }
```

`isVisible` is the file's existing "fully inside the viewport, not merely present in the document" helper — use that exact name; there is no `isFullyVisible`.

Register the group by adding one line to the `GROUPS` object literal:

```js
  const GROUPS = {
    views: checkViews,
    injection: checkNoInjection,
    entities: checkNoEntityLeak,
    boxscore: checkScheduleBoxScore,
    // Must be run while a live game is open: `UI_SMOKE.run('live')` from the
    // pixel view. It asserts on that view's controls, so running it from the
    // dashboard reports failures that only mean "wrong view".
    live: liveGroup
  };
```

Note that `run()` with no argument runs every group, so a full `UI_SMOKE.run()` from the dashboard will now report `live` failures. That is why Step 6 below runs the full suite *from the pixel view*.

- [ ] **Step 2: Run the whole Node suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no `FAIL:` lines.

- [ ] **Step 3: Confirm the golden fixture never moved**

Run: `git diff c9c5231 --stat -- scripts/fixtures/gamesim-golden.json`
Expected: no output. Stage 4 adds no RNG draws to the batch path. If this shows a change, find the task that introduced it — do not regenerate the fixture to make it green.

- [ ] **Step 4: Confirm season sim performance did not regress**

Run: `node -e "require('./data.js');require('./rng.js');const{TEAMS}=require('./teams.js');require('./traits.js');require('./scouting.js');const{PLAYERS_2026}=require('./players-2026.js');require('./traits.js').ensureHiddenPlayerData(PLAYERS_2026);const{makeRng}=require('./rng.js');const se=require('./simEngine.js');require('./simEngineBoxScore.js');require('./simEnginePossession.js');require('./gameCoach.js');require('./gameSim.js');const e=se.getActiveEngine({});const rng=makeRng(7);const t0=Date.now();for(let i=0;i<1230;i++)e.simulateGame('BOS','LAL',rng);console.log('full season:',Date.now()-t0,'ms');"`
Expected: under 3500ms (Stage 3 measured 2706ms). The decision queue adds one array check per step; anything much above that means the event stamping is running when capture is off, which it must not.

- [ ] **Step 5: Confirm dead code is gone**

Run: `grep -rn "startingFive\|ensureOnCourt" --include=*.js .`
Expected: no output. Both were inferences the engine now makes unnecessary; leaving them would leave two competing notions of who is on the floor.

- [ ] **Step 6: Full browser pass**

Run: `python scripts/devserver.py 8215`

At `http://localhost:8215`, run through the whole feature once, end to end:

1. New GM game → **Watch Next Game** → play begins within a second.
2. Open devtools console; keep it open for the whole pass. **Zero errors** at the end.
3. Call a timeout; make a substitution; act on one nudge and ignore another.
4. Change speed to 8× and confirm playback stays smooth and the sim keeps up (the timeline never starves — the court keeps moving).
5. Let it run to the final buzzer; confirm the post-game card and the recorded result in Schedule agree.
6. From the pixel view console, run `UI_SMOKE.run('live')` **during a live game** and confirm every assertion passes.
7. From the pixel view console during any game, run `UI_SMOKE.run()` and confirm no pre-existing group regressed.
8. **Exit** mid-game on a fresh game; confirm the game is recorded complete.
9. Reload the page mid-watch on another fresh game; confirm the app boots with no errors and that game is simply unplayed (see the autosave comment in Task 6).
10. Play forward to the playoffs and watch one postseason game live.

- [ ] **Step 7: Commit**

```bash
git add scripts/ui-smoke.js
git commit -m "test: smoke coverage for the live watch controls"
```

---

## Verification of the whole plan

After Task 11, all of the following must hold:

- [ ] `for f in scripts/validate-*.js; do node "$f" || echo "FAIL: $f"; done` reports no failures.
- [ ] `scripts/fixtures/gamesim-golden.json` is unchanged since `c9c5231`.
- [ ] A full season sims in under 3.5 seconds.
- [ ] `grep -rn "startingFive\|ensureOnCourt" --include=*.js .` returns nothing.
- [ ] `ui/pixelGameView.js`, `ui/pixelAudio.js`, and `ui/pixelHud.js` each pass `node --check`, and `ui/pixelGameView.js` is smaller than the 982 lines it started at despite everything added.
- [ ] A regular-season game and a playoff game are both watchable live, with timeouts and substitutions that visibly change the recorded box score.
- [ ] A full game can be watched hands-off — no control is ever required, no nudge ever blocks playback.
- [ ] Exiting mid-game records a complete game.
- [ ] Zero console errors across the full browser pass.

## Out of scope

Deferred to later tiers, explicitly not part of this plan:

- Defensive schemes, matchup assignments, play calling, clutch decisions
- Play types (pick-and-roll, iso, post-up, off-ball screens)
- The full momentum model, hot/cold streaks
- Mid-game save/resume of an in-progress game (a live game lives in memory only; reloading mid-watch means it has not happened yet)
- Instant replay, highlight reels, commentary booth changes
- Watching a game between two other teams live (the Schedule view's per-game Watch button still routes through `watchGameOnDay`, which only defers the *user's* game; other teams' games remain pre-simmed replays)
