# User-Selected Starting Five Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline —
> this project never uses subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick their starting five on the Roster page, and have that
pick drive BOTH who tips off and each player's minute target, per
docs/superpowers/specs/2026-08-14-starting-five-design.md.

**Architecture:** One new pure function, `lineupOrder(roster, team)`, in
simEngineBoxScore.js beside the `minutesWeight` it sorts on. gameSim.js's
`pickStarters` and gameCoach.js's `rotationRanks` both read it, so starters
inherit starter minute targets automatically. The pick lives on
`team.startingFive` and is persisted via `TEAM_SAVE_FIELDS`.

**Tech stack:** Vanilla JS globals + dual Node/browser bridges. No new files
except one validator. No new module (avoids a new browser bridge).

## Global constraints

- **With no pick, `lineupOrder` must return exactly today's sort.** The gamesim
  and rollover goldens must pass **UNREGENERATED**. That is the opt-in proof.
- gameCoach.js must NOT gain a `teams` dependency: gameSim already resolves both
  team objects for synergy, so it hangs `homeTeam`/`awayTeam` on the sim and
  gameCoach reads `sim[team + 'Team']`.
- Both hand-written browser branches (`box: { minutesWeight: minutesWeight }` in
  gameSim.js line ~25 and gameCoach.js line ~8) must gain `lineupOrder`.
- Escape every player name rendered; the injection smoke check walks Roster.
- Commit per task; never push.

---

### Task 1: `lineupOrder` and its validator

**Files:** Create: `scripts/validate-lineup.js`; Modify: `simEngineBoxScore.js`

- [x] **Step 1: Write the failing validator.** Create `scripts/validate-lineup.js`:

```js
const assert = require('assert');
const box = require('../simEngineBoxScore.js');
require('../data.js');
const { PLAYERS_2026 } = require('../players-2026.js');
const { TEAMS } = require('../teams.js');
const { getTeamRoster } = require('../league.js');

function weightSort(roster) {
  return roster.slice().sort(function (a, b) {
    return box.minutesWeight(b) - box.minutesWeight(a);
  });
}

// The opt-in guarantee: no pick means the exact ordering the sim used before.
function checkNoPickIsIdentical() {
  TEAMS.forEach(function (t) {
    const roster = getTeamRoster(t.id);
    const expected = weightSort(roster).map(function (p) { return p.id; });
    assert.deepStrictEqual(box.lineupOrder(roster, t).map(function (p) { return p.id; }),
      expected, t.id + ' drifted with no startingFive');
    assert.deepStrictEqual(box.lineupOrder(roster, Object.assign({}, t, { startingFive: [] }))
      .map(function (p) { return p.id; }), expected, t.id + ' drifted with an empty startingFive');
  });
  console.log('checkNoPickIsIdentical: OK');
}

// A pick leads, in the user's order, and everyone else keeps relative order.
function checkPickLeads() {
  const t = TEAMS[0];
  const roster = getTeamRoster(t.id);
  const auto = weightSort(roster).map(function (p) { return p.id; });
  const picks = [auto[auto.length - 1], auto[auto.length - 2]];   // two worst
  const out = box.lineupOrder(roster, Object.assign({}, t, { startingFive: picks }))
    .map(function (p) { return p.id; });
  assert.deepStrictEqual(out.slice(0, 2), picks, 'picked players must lead, in order');
  const rest = auto.filter(function (id) { return picks.indexOf(id) === -1; });
  assert.deepStrictEqual(out.slice(2), rest, 'remaining players must keep relative order');
  console.log('checkPickLeads: OK');
}

// Stale ids (traded away), duplicates and overlong lists must not corrupt it.
function checkJunkIdsIgnored() {
  const t = TEAMS[0];
  const roster = getTeamRoster(t.id);
  const auto = weightSort(roster).map(function (p) { return p.id; });
  const last = auto[auto.length - 1];
  const out = box.lineupOrder(roster,
    Object.assign({}, t, { startingFive: ['nope-not-a-player', last, last] }))
    .map(function (p) { return p.id; });
  assert.strictEqual(out[0], last, 'valid pick still leads');
  assert.strictEqual(out.length, roster.length, 'no duplicates, no dropped players');
  assert.deepStrictEqual(out.slice().sort(), auto.slice().sort(), 'same set of players');
  console.log('checkJunkIdsIgnored: OK');
}

// Never promotes more than five, however many ids are stored.
function checkCapsAtFive() {
  const t = TEAMS[0];
  const roster = getTeamRoster(t.id);
  const auto = weightSort(roster).map(function (p) { return p.id; });
  const picks = auto.slice(-6);                       // six worst players
  const out = box.lineupOrder(roster, Object.assign({}, t, { startingFive: picks }))
    .map(function (p) { return p.id; });
  assert.deepStrictEqual(out.slice(0, 5), picks.slice(0, 5), 'only the first five are promoted');
  assert.strictEqual(out.indexOf(picks[5]) >= 5, true, 'the sixth id is not promoted');
  console.log('checkCapsAtFive: OK');
}

checkNoPickIsIdentical();
checkPickLeads();
checkJunkIdsIgnored();
checkCapsAtFive();
console.log('All lineup validations passed');
```

- [x] **Step 2: Run it, expect failure.**

Run: `node scripts/validate-lineup.js`
Expected: `TypeError: box.lineupOrder is not a function`

- [x] **Step 3: Implement.** In simEngineBoxScore.js, directly below
  `minutesWeight`:

```js
// The single ordering that decides BOTH who starts (gameSim's pickStarters)
// and each player's minute target (gameCoach's rotationRanks -> targetMinutes).
// They must read the same list: promoting a user's pick to the starting five
// without also promoting his rotation rank gives him a target of zero minutes,
// and decideSubstitutions rule 5 pulls him at the first whistle.
//
// With no startingFive this is byte-for-byte the sort both callers used before,
// which is what lets the goldens pass unregenerated.
const STARTERS = 5;

function lineupOrder(roster, team) {
  const byWeight = roster.slice().sort(function (a, b) {
    return minutesWeight(b) - minutesWeight(a);
  });
  const picks = (team && team.startingFive) || [];
  if (picks.length === 0) return byWeight;

  const inRoster = {};
  roster.forEach(function (p) { inRoster[p.id] = p; });

  const chosen = [];
  const taken = {};
  picks.forEach(function (id) {
    if (chosen.length >= STARTERS) return;   // never promote more than a five
    if (taken[id]) return;                   // duplicate id
    const p = inRoster[id];
    if (!p) return;                          // traded, released, or injured out
    taken[id] = true;
    chosen.push(p);
  });
  if (chosen.length === 0) return byWeight;

  return chosen.concat(byWeight.filter(function (p) { return !taken[p.id]; }));
}
```

  Add `lineupOrder: lineupOrder` to the `module.exports` block.

- [x] **Step 4: Run it, expect pass.**

Run: `node scripts/validate-lineup.js`
Expected: `All lineup validations passed`

- [x] **Step 5: Commit** `feat: lineupOrder, one ordering for starters and minutes`.

### Task 2: The sim reads it (goldens must not move)

**Files:** Modify: `gameSim.js`, `gameCoach.js`

**Interfaces consumed:** `lineupOrder(roster, team)` from Task 1.

- [x] **Step 1: gameSim.** Replace `pickStarters` with:

```js
  function pickStarters(roster, team) {
    return _GAMESIM_DATA.box.lineupOrder(roster, team)
      .slice(0, 5)
      .map(function (p) { return p.id; });
  }
```

  gameSim already resolves both team objects for synergy; hoist those above
  `onCourt` so starters can use them:

```js
  const homeTeam = _GAMESIM_DATA.teams.getTeamById(homeTeamId);
  const awayTeam = _GAMESIM_DATA.teams.getTeamById(awayTeamId);
  const onCourt = { home: pickStarters(homeRoster, homeTeam), away: pickStarters(awayRoster, awayTeam) };
```

  Reuse `homeTeam`/`awayTeam` in the existing `computeTeamSynergy` calls rather
  than calling `getTeamById` twice. Expose them on the returned sim object
  beside `homeTeamId`: `homeTeam: homeTeam, awayTeam: awayTeam` — this is what
  keeps gameCoach from needing a `teams` dependency.

- [x] **Step 2: gameCoach.** `rotationRanks` ranks from the shared ordering:

```js
function rotationRanks(sim, team) {
  if (!sim._rotationRanks) sim._rotationRanks = {};
  if (sim._rotationRanks[team]) return sim._rotationRanks[team];
  const ranks = {};
  _GAMECOACH_DATA.box.lineupOrder(rosterFor(sim, team), sim[team + 'Team'])
    .forEach(function (p, i) { ranks[p.id] = i; });
  sim._rotationRanks[team] = ranks;
  return ranks;
}
```

  The existing caching comment stays: this is still called from inside a sort
  comparator on every possession.

- [x] **Step 3: Both browser bridges.** gameSim.js's browser branch and
  gameCoach.js's browser branch each hand-write `box: { minutesWeight: minutesWeight }`.
  Change both to `box: { minutesWeight: minutesWeight, lineupOrder: lineupOrder }`.
  Node cannot see a mistake here — scripts/validate-browserBridges.js is what does.

- [x] **Step 4: Goldens, UNREGENERATED.**

Run: `node scripts/validate-gamesim.js && node scripts/validate-seasonRollover.js`
Expected: both print their `All ... validations passed` lines. If either
drifts, the ordering is not identical for an unpicked team — fix
`lineupOrder`, do NOT regenerate the fixtures.

- [x] **Step 5: Bridge parity.**

Run: `node scripts/validate-browserBridges.js`
Expected: passes.

- [x] **Step 6: Commit** `feat: starters and rotation read one ordering`.

### Task 3: The pick survives a save

**Files:** Modify: `save.js`; Test: `scripts/validate-save.js`

- [x] **Step 1: Write the failing assertion.** In scripts/validate-save.js, inside
  the existing round-trip check, set a pick before saving and assert it returns:

```js
  // A team field missing from TEAM_SAVE_FIELDS is silently dropped on reload;
  // startingFive is exactly that shape of field.
  TEAMS[0].startingFive = ['a-player-id', 'another-player-id'];
```

  and after the round-trip:

```js
  assert.deepStrictEqual(TEAMS[0].startingFive, ['a-player-id', 'another-player-id'],
    'startingFive must survive a save/load round-trip');
```

- [x] **Step 2: Run it, expect failure.**

Run: `node scripts/validate-save.js`
Expected: AssertionError — `startingFive` comes back `undefined`.

- [x] **Step 3: Implement.** Append `'startingFive'` to `TEAM_SAVE_FIELDS` in
  save.js (line ~49).

- [x] **Step 4: Run it, expect pass.**

Run: `node scripts/validate-save.js`
Expected: passes.

- [x] **Step 5: Commit** `feat: persist the starting five`.

### Task 4: Prove the pick actually changes minutes

**Files:** Modify: `scripts/validate-lineup.js`

This is the failure mode no structural test catches: the pick is stored, the
UI shows it, and the coach quietly plays whoever he likes anyway.

- [x] **Step 1: Add the measured check** to scripts/validate-lineup.js:

```js
const { createRng } = require('../rng.js');
const gameSim = require('../gameSim.js');

// Start the five WORST available players and assert their minutes actually
// rise. Uses league.simulateDate's engine entry point rather than asserting on
// targetMinutes, so this fails if any later substitution rule quietly undoes
// the promotion.
function checkPickChangesMinutes() {
  const home = TEAMS[0], away = TEAMS[1];
  const roster = getTeamRoster(home.id).filter(function (p) { return !p.status.injury; });
  const auto = weightSort(roster).map(function (p) { return p.id; });
  const worstFive = auto.slice(-5);

  function minutesFor(ids) {
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const res = gameSim.simulateGame(home.id, away.id, createRng(seed));
      ids.forEach(function (id) {
        const line = res.boxScore[id];
        if (line) total += line.minutes;
      });
    }
    return total / 12;
  }

  delete home.startingFive;
  const before = minutesFor(worstFive);
  home.startingFive = worstFive;
  const after = minutesFor(worstFive);
  delete home.startingFive;

  assert.ok(after > before * 1.5,
    'starting the worst five must raise their minutes: ' +
    before.toFixed(1) + ' -> ' + after.toFixed(1));
  console.log('checkPickChangesMinutes: OK (' + before.toFixed(1) + ' -> ' + after.toFixed(1) + ')');
}
```

  Call it from the bottom of the file alongside the other checks.

- [x] **Step 2: Run it.**

Run: `node scripts/validate-lineup.js`
Expected: `checkPickChangesMinutes: OK (<small> -> <large>)`. If the two numbers
are close, the promotion is not reaching `targetMinutes` — root-cause it in
gameCoach before continuing; do NOT weaken the threshold.

- [x] **Step 3: Commit** `test: prove a picked five actually plays`.

### Task 5: The Roster page picker

**Files:** Modify: `ui/roster.js`, `style.css`

- [x] **Step 1: Helpers** at the top of ui/roster.js:

```js
// The stored ids, filtered to players still on the roster — a traded starter
// leaves a stale id behind and the list self-heals on the next render.
function currentStarterIds(teamId) {
  const team = getTeamById(teamId);
  const ids = (team && team.startingFive) || [];
  const roster = getTeamRoster(teamId);
  return ids.filter(function (id) {
    return roster.some(function (p) { return p.id === id; });
  }).slice(0, 5);
}

function setStarterIds(teamId, ids) {
  getTeamById(teamId).startingFive = ids.slice(0, 5);
}
```

- [x] **Step 2: The strip**, rendered only when `isOwnTeam`, inserted directly
  after the `stat-chips` block and before the filter toolbar. Five slots; a
  filled slot shows sprite-free name, position pill and rating chip, an empty
  one reads `Auto`. Include an `Auto` button (`id="lineup-auto"`) when at least
  one pick exists, and an informational note when the five has no player whose
  position is `C` (text: `No true center — the sim does not mind, but you might.`).
  Wrap in `<div class="lineup-strip" id="lineup-strip">`.

- [x] **Step 3: The toggle.** Add a `Start` control to each roster row's Action
  cell, only when `isOwnTeam`:
  `<button class="btn-ghost lineup-toggle" data-lineup-id="<id>">Start</button>`,
  gaining class `is-on` and text `Starting` when the id is in
  `currentStarterIds`. Handler: if on, remove it; if off and fewer than five are
  picked, append it; if off and five are already picked, do not change state and
  show an inline hint (`Remove a starter first.`) in the strip. Call `draw()`
  after any change so the strip and the row re-render from stored state rather
  than from local variables.

- [x] **Step 4: CSS** appended to style.css:

```css
/* ---- Starting five picker ---- */
.lineup-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: var(--surface-1); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 8px 10px; margin-bottom: 10px; }
.lineup-slot { flex: 1; min-width: 120px; background: var(--surface-2);
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: var(--r-sm); padding: 5px 8px; }
.lineup-slot.is-empty { border-left-color: var(--line-strong); color: var(--text-mute); }
.lineup-slot .nm { font-weight: 700; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.lineup-slot .mt { font-size: 10px; text-transform: uppercase; letter-spacing: .6px;
  color: var(--text-mute); }
.lineup-note { color: var(--text-dim); font-size: 11px; }
.lineup-toggle.is-on { background: var(--accent); color: #06101D; font-weight: 700; }
```

- [x] **Step 5: Browser check.** Load the app, open Roster, toggle a starter,
  confirm the strip updates, the sixth toggle is refused, `Auto` clears, and
  another team's roster (reached from Standings) shows no toggles.

- [x] **Step 6: Commit** `feat: starting five picker on the roster page`.

### Task 6: Smoke coverage and whole-feature verification

**Files:** Modify: `scripts/ui-smoke.js`

- [x] **Step 1: Add a `lineup` group** after `dashboard`, registered in `GROUPS`:
  - `lineup:strip-renders` — Roster for the user's team has a `#lineup-strip`
    with exactly 5 `.lineup-slot`s.
  - `lineup:toggle-persists` — clicking a `.lineup-toggle` puts that id in
    `getTeamById(userTeamId).startingFive` and the slot shows the player's name
    after the re-render.
  - `lineup:caps-at-five` — after picking five, a sixth toggle leaves
    `startingFive.length === 5`.
  - `lineup:auto-clears` — `#lineup-auto` empties `startingFive`.
  - `lineup:other-team-readonly` — rendering another team's roster yields zero
    `.lineup-toggle` elements.
  Restore the pre-existing `startingFive` and view at the end of the group, in a
  `finally`, so the suite never leaves a lineup behind in the user's league.

- [x] **Step 2:** Run `UI_SMOKE.run()` in the browser. Expected: all green,
  including the new group.

- [x] **Step 3:** Full validator suite.

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: no FAIL lines (57 validators now, including validate-lineup.js).

- [x] **Step 4:** Play a game from the Watch button with a deliberately odd five
  and confirm those players are on the floor at tip-off in the live view.

- [x] **Step 5: Commit** `test: starting five smoke coverage`; tick this plan's
  checkboxes and update memory.
