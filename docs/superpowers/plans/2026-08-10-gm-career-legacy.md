# GM Career & Legacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player a permanent, public GM career — a record, a chase-list of milestones, a chronicle of what happened, and a banner raising when they win — so the league finally reacts to them.

**Architecture:** One new stored fact (a tenure log plus a per-season row); everything else on the career page is derived on read from archives `LEAGUE_HISTORY` already keeps. Logic lives in two dependency-light root modules (`gmCareer.js`, `gmMilestones.js`) that take the league archive as a parameter rather than importing it, so they stay cycle-free and fully testable under Node. All recording hangs off `finalizeSeasonHistory`, already the single season-end write point shared by the manual and fast-forward paths.

**Tech Stack:** Vanilla ES5-style JavaScript, no build step, no dependencies. Browser files load as globals via `<script>` tags in `index.html`; the same files export via `module.exports` for Node. Verification is the existing `scripts/validate-*.js` Node suite plus a live browser check.

**Spec:** `docs/superpowers/specs/2026-08-10-gm-career-legacy-design.md`

## Global Constraints

- **No third-party dependencies.** Classic `<script>` tags only; Node used only for `scripts/*.js`.
- **Dual module pattern.** Every root `.js` file must work both as a browser global and under `require`. Follow the `var _X_DATA = (typeof require !== 'undefined') ? {...} : {...}` idiom already in `history.js`, and use a **lazy** dep function (`history.js`'s `_commissionerDep()`) for any dependency whose `<script>` tag loads later.
- **Existing suite must stay green.** Run `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done` — expect only `done`. Any task that changes a validator must justify it in that task.
- **`git add` explicit paths only.** Never `git add -A`.
- **Commit messages via file.** PowerShell mangles multi-line `-m`; use `git commit -F <file>`.
- **Calibrate by measured rate, never by picked values.** Milestone thresholds move to hit the measured rate; sweep tables go in the commit message. Never widen a bound to make a value pass.
- **Every new assertion is mutation-tested.** A surviving mutant means the assertion is worthless OR the code is dead — say which.
- **Two scales, one trap.** `player.overall` is DISPLAY scale; `player.rawOverall` and `player.peakOverall` are RAW. Convert with `ratings.toDisplayRating(raw)`. **Display runs HIGHER than raw** — raw 70→87, 75→90, 78→92, 85→95, 90→97. So comparing a raw field against a display threshold silently *under*-fires: `peakOverall >= 90` demands a display-97 all-time great and misses every ordinary 90-rated star. This codebase has shipped a two-scales bug four times; this is the quiet direction of it.
- **No new micromanagement.** Nothing in this plan may add a required decision, a blocking modal, or a per-season chore. Milestones are feed lines and a Dashboard panel — never a popup.
- **Ignore the `assets/logos/MIA.png` 404** in browser checks; it is known and accepted.

## File Structure

| File | Responsibility |
| --- | --- |
| `gmCareer.js` (new) | Career state shape, season-row recording, chronicle append, and every derived query (titles, totals, tenure predicate, your drafts, your trades). Pure — no live game state. |
| `gmMilestones.js` (new) | The milestone catalogue and its evaluation. Separate from `gmCareer.js` because the table churns during calibration and both files should stay small enough to hold in context. |
| `draft.js` (modify) | Extract `playoffResultByTeam(bracket)` out of `getPlayoffFinishOrder` and export it, so "how the season ended" has exactly one definition. |
| `history.js` (modify) | `finalizeSeasonHistory` calls into the career recorder. |
| `save.js` (modify) | Persist `gmCareer`; `SAVE_FORMAT_VERSION` 2 → 3. |
| `script.js` (modify) | `GameState.gmCareer` field, name capture in `selectTeam`, `BUILT_VIEWS` entry, championship scene on the manual path. |
| `ui/teamSelect.js` (modify) | GM name input. |
| `ui/gmCareerView.js` (new) | The career page: chronicle timeline + trophy room. |
| `ui/dashboard.js` (modify) | Nearest-milestone panel. |
| `ui/championshipScene.js` (new) | The banner raising. |
| `ui/nav.js` (modify) | Nav item + Records hub membership. |
| `ui/simControls.js` (modify) | Trigger the banner on the fast-forward path. |
| `index.html` (modify) | Script tags, in dependency order. |
| `scripts/validate-gmCareer.js` (new) | Career logic invariants, including the independent-re-implementation anti-drift check. |
| `scripts/validate-gmMilestones.js` (new) | Catalogue integrity and evaluation behaviour. |
| `scripts/probe-gm-milestones.js` (new) | 50-season calibration probe across all 30 teams-as-user. |
| `scripts/validate-save.js` (modify) | Career round-trips; a v2 save still loads. |

**Load order in `index.html`:** `gmCareer.js` and `gmMilestones.js` must load **before** `history.js` (line 47), because `history.js` builds its browser-global dep object at file-load time. `gmCareer.js` needs `draft.js`, which loads much later (line 74), so its draft dependency **must** be lazy.

---

### Task 1: Extract the playoff-result classifier

**Files:**
- Modify: `draft.js:33-47`
- Test: `scripts/validate-gmCareer.js` (created here, extended in later tasks)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `draft.playoffResultByTeam(bracket)` → object mapping `teamId` → integer `0..4` (`0` first-round exit, `1` conference semis, `2` conference finals, `3` lost the Finals, `4` champion). Teams that missed the playoffs are **absent from the map**, not present with a sentinel.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-gmCareer.js`:

```js
// The GM career record is a QUERY over history the game already keeps, not a
// parallel set of counters. These tests exist to keep it that way: the moment a
// total is stored rather than derived, one of the anti-drift assertions below
// starts failing.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const draft = rq('draft.js');

// A bracket shaped exactly like playoffs.js builds one, small enough to reason
// about: 4 first-round series, 2 semis, 1 conference final per side, 1 final.
function fakeBracket() {
  const series = function (higher, lower, winner) {
    return { higherSeed: higher, lowerSeed: lower, winner: winner, complete: true };
  };
  return {
    first: [series('BOS', 'MIA', 'BOS'), series('NYK', 'ORL', 'NYK'),
            series('LAL', 'PHX', 'LAL'), series('DEN', 'SAC', 'DEN')],
    semis: [series('BOS', 'NYK', 'BOS'), series('LAL', 'DEN', 'LAL')],
    confFinals: [series('BOS', 'CHI', 'BOS'), series('LAL', 'GSW', 'LAL')],
    finals: [series('BOS', 'LAL', 'BOS')]
  };
}

function checkPlayoffResultByTeamEncodesEveryRound() {
  const byTeam = draft.playoffResultByTeam(fakeBracket());
  assert.strictEqual(byTeam.MIA, 0, 'a first-round loser is round 0');
  assert.strictEqual(byTeam.NYK, 1, 'a team that lost in the semis is round 1');
  assert.strictEqual(byTeam.CHI, 2, 'a team that lost the conference finals is round 2');
  assert.strictEqual(byTeam.LAL, 3, 'the Finals loser is round 3');
  assert.strictEqual(byTeam.BOS, 4, 'the champion is round 4');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(byTeam, 'UTA'), false,
    'a team that missed the playoffs is ABSENT, not present with a sentinel');
  console.log('checkPlayoffResultByTeamEncodesEveryRound: OK');
}
checkPlayoffResultByTeamEncodesEveryRound();

console.log('All gmCareer validations passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-gmCareer.js`
Expected: FAIL — `TypeError: draft.playoffResultByTeam is not a function`

- [ ] **Step 3: Extract the function**

In `draft.js`, replace the body of `getPlayoffFinishOrder` (lines 33-47) with:

```js
// The elimination round each playoff team reached: 0 first round, 1 conference
// semis, 2 conference finals, 3 lost the Finals, 4 champion. Teams that missed
// the playoffs are absent from the map entirely.
//
// Extracted from getPlayoffFinishOrder so gmCareer.js can classify a season the
// same way the lottery orders one. Two copies of this would be two definitions
// of "how the season ended", and they would disagree the first time either
// changed.
function playoffResultByTeam(bracket) {
  const eliminatedInRound = {};
  bracket.first.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 0; });
  bracket.semis.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 1; });
  bracket.confFinals.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 2; });
  const finals = bracket.finals[0];
  eliminatedInRound[finals.winner === finals.higherSeed ? finals.lowerSeed : finals.higherSeed] = 3;
  eliminatedInRound[finals.winner] = 4;
  return eliminatedInRound;
}

// Worse playoff finish -> earlier pick. Ties within the same elimination round
// broken by regular-season wins ascending (worse record picks first).
function getPlayoffFinishOrder(bracket) {
  const eliminatedInRound = playoffResultByTeam(bracket);
  return Object.keys(eliminatedInRound).sort(function (a, b) {
    if (eliminatedInRound[a] !== eliminatedInRound[b]) return eliminatedInRound[a] - eliminatedInRound[b];
    return _DRAFT_DATA.teams.getTeamById(a).record.wins - _DRAFT_DATA.teams.getTeamById(b).record.wins;
  });
}
```

Add `playoffResultByTeam` to `draft.js`'s `module.exports` object.

- [ ] **Step 4: Run both the new test and the full suite**

Run: `node scripts/validate-gmCareer.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `checkPlayoffResultByTeamEncodesEveryRound: OK`, then `done` with no FAIL lines. The draft-order tests in `scripts/validate-offseason.js` are the proof this extraction was behaviour-preserving.

- [ ] **Step 5: Mutation-test the new assertion**

Temporarily change `eliminatedInRound[finals.winner] = 4;` to `= 3;` in `draft.js`. Run `node scripts/validate-gmCareer.js`.
Expected: FAIL on `the champion is round 4`. Revert the mutation.

If it does NOT fail, the assertion is worthless — say so and fix it rather than moving on.

- [ ] **Step 6: Commit**

```bash
git add draft.js scripts/validate-gmCareer.js
git commit -m "refactor: one definition of how a season ended"
```

---

### Task 2: Career state and the per-season row

**Files:**
- Create: `gmCareer.js`
- Modify: `history.js` (dep object, `finalizeSeasonHistory`, exports)
- Modify: `index.html` (script tag)
- Modify: `script.js` (`GameState.gmCareer` field)
- Test: `scripts/validate-gmCareer.js`

**Interfaces:**
- Consumes: `draft.playoffResultByTeam(bracket)` from Task 1.
- Produces:
  - `gmCareer.SEASON_RESULT` → `{ MISSED: -1, FIRST_ROUND: 0, CONF_SEMIS: 1, CONF_FINALS: 2, FINALS_LOSS: 3, CHAMPION: 4 }`
  - `gmCareer.SEASON_RESULT_LABEL` → object keyed by the same values, string labels
  - `gmCareer.createGmCareer(name, teamId, startYear)` → career object
  - `gmCareer.ensureGmCareer(gameState)` → career object (creates and repairs in place)
  - `gmCareer.recordSeason(career, leagueYear, teamId, wins, losses, bracket)` → the season row, or the existing row if that year is already recorded
  - `gmCareer.tenureCovers(career, teamId, leagueYear)` → boolean

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-gmCareer.js`, before the final `console.log`:

```js
const gmCareer = rq('gmCareer.js');

function checkCareerStartsEmptyWithOneOpenTenure() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  assert.strictEqual(c.name, 'Cory');
  assert.deepStrictEqual(c.tenures, [{ teamId: 'BOS', startYear: 2026, endYear: null }]);
  assert.deepStrictEqual(c.seasons, []);
  assert.deepStrictEqual(c.milestones, []);
  assert.deepStrictEqual(c.chronicle, []);
  console.log('checkCareerStartsEmptyWithOneOpenTenure: OK');
}
checkCareerStartsEmptyWithOneOpenTenure();

function checkTenureCoversIsInclusiveAndOpenEnded() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2026), true, 'the start year is inside the tenure');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2099), true, 'an open tenure has no end');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2025), false, 'before the start year is outside');
  assert.strictEqual(gmCareer.tenureCovers(c, 'LAL', 2030), false, 'another team is never covered');

  c.tenures = [{ teamId: 'BOS', startYear: 2026, endYear: 2030 },
               { teamId: 'LAL', startYear: 2031, endYear: null }];
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2030), true, 'the end year is INSIDE the tenure');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2031), false, 'the year after the end is outside');
  assert.strictEqual(gmCareer.tenureCovers(c, 'LAL', 2031), true, 'a second stint is covered');
  console.log('checkTenureCoversIsInclusiveAndOpenEnded: OK');
}
checkTenureCoversIsInclusiveAndOpenEnded();

function checkRecordSeasonClassifiesAndIsIdempotent() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const row = gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  assert.deepStrictEqual(row, { leagueYear: 2026, teamId: 'BOS', wins: 58, losses: 24,
    result: gmCareer.SEASON_RESULT.CHAMPION });
  assert.strictEqual(c.seasons.length, 1);

  // The manual advance and the fast-forward reach finalizeSeasonHistory by
  // different routes. A duplicate row would silently double every derived
  // total, so the guard lives with the data rather than at one call site.
  gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  assert.strictEqual(c.seasons.length, 1, 'recording the same year twice must not append');
  console.log('checkRecordSeasonClassifiesAndIsIdempotent: OK');
}
checkRecordSeasonClassifiesAndIsIdempotent();

function checkMissingThePlayoffsIsRecordedAsMissed() {
  const c = gmCareer.createGmCareer('Cory', 'UTA', 2026);
  const row = gmCareer.recordSeason(c, 2026, 'UTA', 19, 63, fakeBracket());
  assert.strictEqual(row.result, gmCareer.SEASON_RESULT.MISSED,
    'a team absent from the bracket missed the playoffs');

  // A season abandoned before the Finals resolve must not read as a title.
  const c2 = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const row2 = gmCareer.recordSeason(c2, 2026, 'BOS', 58, 24, null);
  assert.strictEqual(row2.result, gmCareer.SEASON_RESULT.MISSED,
    'no bracket at all is MISSED, never CHAMPION');
  console.log('checkMissingThePlayoffsIsRecordedAsMissed: OK');
}
checkMissingThePlayoffsIsRecordedAsMissed();

function checkEnsureRepairsAPartialCareer() {
  const gs = { userTeamId: 'BOS', leagueYear: 2031 };
  const created = gmCareer.ensureGmCareer(gs);
  assert.strictEqual(created.name, 'GM', 'a career with no name defaults rather than blocking');
  assert.strictEqual(created.tenures[0].startYear, 2031,
    'a career created mid-save starts at the CURRENT year, not 2026 — it does not invent a past');

  const gs2 = { userTeamId: 'BOS', leagueYear: 2026, gmCareer: { name: 'Cory' } };
  const repaired = gmCareer.ensureGmCareer(gs2);
  assert.deepStrictEqual(repaired.seasons, [], 'missing arrays are repaired, not left undefined');
  assert.deepStrictEqual(repaired.chronicle, []);
  assert.deepStrictEqual(repaired.milestones, []);
  console.log('checkEnsureRepairsAPartialCareer: OK');
}
checkEnsureRepairsAPartialCareer();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-gmCareer.js`
Expected: FAIL — `Cannot find module '.../gmCareer.js'`

- [ ] **Step 3: Create `gmCareer.js`**

```js
// The GM's career record.
//
// The design rule this file exists to enforce: NOTHING here is stored if it can
// be computed. LEAGUE_HISTORY already permanently archives champions, trades,
// draft classes, awards and retirees; the only fact missing was WHICH TEAM WAS
// THE USER'S IN WHICH YEARS. Add that and the whole career record becomes a
// query, which is why the trophy room can never disagree with the timeline —
// there is only one copy of the truth.
//
// Two things genuinely cannot be derived and so are stored:
//   1. The tenure log itself.
//   2. A per-season row. LEAGUE_HISTORY.champions keeps only the WINNER and
//      team.lastSeasonWins is overwritten every year, so how a past season
//      ended for a non-champion is otherwise unrecoverable.
//
// draft.js is resolved LAZILY (the same reason history.js resolves
// commissioner.js lazily): this file's <script> tag must load before
// history.js's, which is far above draft.js's, so referencing
// playoffResultByTeam at file-load time in the browser would throw a
// ReferenceError and abort the rest of this file.
function _gmCareerDraftDep() {
  return (typeof require !== 'undefined')
    ? require('./draft.js')
    : { playoffResultByTeam: playoffResultByTeam };
}

// -1 is ours; 0-4 are draft.js's elimination-round encoding, reused rather than
// redefined so "how the season ended" has one definition.
const SEASON_RESULT = {
  MISSED: -1,
  FIRST_ROUND: 0,
  CONF_SEMIS: 1,
  CONF_FINALS: 2,
  FINALS_LOSS: 3,
  CHAMPION: 4
};

const SEASON_RESULT_LABEL = {
  '-1': 'Missed the playoffs',
  '0': 'Lost in the first round',
  '1': 'Lost in the conference semifinals',
  '2': 'Lost in the conference finals',
  '3': 'Lost the Finals',
  '4': 'Won the championship'
};

function createGmCareer(name, teamId, startYear) {
  return {
    name: name || 'GM',
    // A LIST from day one. Shipping with a single stint, but multi-team careers
    // are a planned follow-up and this shape means they need no save migration.
    tenures: [{ teamId: teamId, startYear: startYear, endYear: null }],
    seasons: [],
    milestones: [],
    chronicle: []
  };
}

function ensureGmCareer(gameState) {
  if (!gameState) return null;
  if (!gameState.gmCareer) {
    // Deliberately starts at the CURRENT year. A career attached to an
    // in-progress save does not know what happened before it existed, and
    // inventing a record back to 2026 would be a lie the trophy room repeats.
    gameState.gmCareer = createGmCareer('GM', gameState.userTeamId, gameState.leagueYear || 2026);
  }
  const c = gameState.gmCareer;
  if (!Array.isArray(c.tenures)) c.tenures = [];
  if (!Array.isArray(c.seasons)) c.seasons = [];
  if (!Array.isArray(c.milestones)) c.milestones = [];
  if (!Array.isArray(c.chronicle)) c.chronicle = [];
  if (!c.name) c.name = 'GM';
  return c;
}

// Inclusive at BOTH ends: a tenure ending in 2030 includes the 2030 season,
// because endYear names the last season worked, not the first season away.
function tenureCovers(career, teamId, leagueYear) {
  if (!career || !career.tenures) return false;
  return career.tenures.some(function (t) {
    if (t.teamId !== teamId) return false;
    if (leagueYear < t.startYear) return false;
    return t.endYear === null || t.endYear === undefined || leagueYear <= t.endYear;
  });
}

function seasonResultFor(teamId, bracket) {
  // An unresolved or absent bracket is NOT a title. finalizeSeasonHistory can
  // be reached with a null bracket (a save abandoned mid-season, a commissioner
  // rewind), and defaulting the champion case would hand out a ring for it.
  if (!bracket || !bracket.finals || !bracket.finals[0] || !bracket.finals[0].winner) {
    return SEASON_RESULT.MISSED;
  }
  const byTeam = _gmCareerDraftDep().playoffResultByTeam(bracket);
  return Object.prototype.hasOwnProperty.call(byTeam, teamId) ? byTeam[teamId] : SEASON_RESULT.MISSED;
}

function recordSeason(career, leagueYear, teamId, wins, losses, bracket) {
  if (!career) return null;
  const existing = career.seasons.find(function (s) { return s.leagueYear === leagueYear; });
  if (existing) return existing;
  const row = {
    leagueYear: leagueYear,
    teamId: teamId,
    wins: wins,
    losses: losses,
    result: seasonResultFor(teamId, bracket)
  };
  career.seasons.push(row);
  return row;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEASON_RESULT: SEASON_RESULT,
    SEASON_RESULT_LABEL: SEASON_RESULT_LABEL,
    createGmCareer: createGmCareer,
    ensureGmCareer: ensureGmCareer,
    tenureCovers: tenureCovers,
    recordSeason: recordSeason
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/validate-gmCareer.js`
Expected: all six `check...: OK` lines, then `All gmCareer validations passed`.

- [ ] **Step 5: Wire it into the season-end hook**

In `history.js`, add to the `_HISTORY_DATA` object — **both** branches:

```js
// require branch, alongside coaches:
gmCareer: require('./gmCareer.js')
```
```js
// browser-global branch, alongside coaches:
gmCareer: {
  ensureGmCareer: ensureGmCareer,
  recordSeason: recordSeason,
  SEASON_RESULT: SEASON_RESULT,
  SEASON_RESULT_LABEL: SEASON_RESULT_LABEL
}
```

This is safe eagerly because `gmCareer.js`'s `<script>` tag is placed before `history.js`'s in Step 7.

In `finalizeSeasonHistory`, insert immediately **after** the `archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, sink);` line:

```js
  // The GM's own season row. Recorded here rather than at the two call sites
  // because this function is already the single shared season-end write point
  // for both the manual advance and the fast-forward; recording at the call
  // sites would give the two paths two chances to disagree.
  //
  // Read BEFORE the TEAMS loop above would matter — but that loop only adds to
  // allTimeWins and does not clear team.record, so wins/losses are still this
  // season's here. Guarded on GameState because history.js also runs standalone
  // under Node in scripts/validate-*.js.
  if (typeof GameState !== 'undefined' && GameState && GameState.userTeamId) {
    const career = _HISTORY_DATA.gmCareer.ensureGmCareer(GameState);
    const userTeam = _HISTORY_DATA.teams.getTeamById(GameState.userTeamId);
    if (userTeam) {
      _HISTORY_DATA.gmCareer.recordSeason(career, leagueYear, userTeam.id,
        userTeam.record.wins, userTeam.record.losses, playoffBracket);
    }
  }
```

**Ordering hazard, stated explicitly:** this must run *before* `_HISTORY_DATA.teams.TEAMS.forEach` resets anything and *after* the champion is archived. In the current file the TEAMS loop runs earlier and only accumulates `allTimeWins`; it does not zero `team.record`. Verify with Step 6's assertion, which reads real wins off a real season.

- [ ] **Step 6: Add the `GameState` field and the script tag**

In `script.js`, add to the `GameState` object literal, immediately after the `feed: [],` line:

```js
  // The GM's permanent career record — tenures, per-season rows, milestone
  // unlocks and the chronicle. See gmCareer.js for why almost nothing here is
  // stored. Created lazily by ensureGmCareer so a save from before it existed
  // repairs itself on load rather than crashing.
  gmCareer: null,
```

In `index.html`, insert **between** line 46 (`awards.js`) and line 47 (`history.js`):

```html
  <script src="gmCareer.js"></script>
```

Order matters: `history.js` builds its browser-global dep object at load time and references `ensureGmCareer`.

- [ ] **Step 7: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`, no FAIL lines.

- [ ] **Step 8: Mutation-test the idempotence guard**

In `gmCareer.js`, temporarily delete the two lines:
```js
  const existing = career.seasons.find(function (s) { return s.leagueYear === leagueYear; });
  if (existing) return existing;
```
Run `node scripts/validate-gmCareer.js`.
Expected: FAIL on `recording the same year twice must not append`. Restore the lines.

- [ ] **Step 9: Commit**

```bash
git add gmCareer.js history.js script.js index.html scripts/validate-gmCareer.js
git commit -m "feat: the league starts keeping a record of you"
```

---

### Task 3: Derived career queries

**Files:**
- Modify: `gmCareer.js`
- Test: `scripts/validate-gmCareer.js`

**Interfaces:**
- Consumes: `SEASON_RESULT`, `tenureCovers` from Task 2.
- Produces:
  - `gmCareer.careerTotals(career)` → `{ seasons, wins, losses, winPct, playoffAppearances, finalsAppearances, titles }`
  - `gmCareer.titleYears(career)` → array of `leagueYear`, ascending
  - `gmCareer.longestTitleRun(career)` → integer (consecutive championship seasons)
  - `gmCareer.longestPlayoffStreak(career)` → integer
  - `gmCareer.userDraftPicks(career, leagueHistory)` → array of `{ leagueYear, round, pickNumber, playerId, playerName }`
  - `gmCareer.userTrades(career, leagueHistory)` → array of `LEAGUE_HISTORY.trades` records
  - `gmCareer.playersAcquiredByTrade(career, leagueHistory)` → array of `{ leagueYear, playerId, playerName }` (players who arrived at a team the user held that year)

`leagueHistory` is passed **in**, never imported. `history.js` requires `gmCareer.js`; importing it back would be a cycle, and passing it makes every query testable against a hand-built archive.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-gmCareer.js`:

```js
// A career with a known, hand-checkable shape: 6 seasons, 2 titles (one of them
// back-to-back with the next), 1 Finals loss, 4 playoff appearances.
function sixSeasonCareer() {
  const R = gmCareer.SEASON_RESULT;
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  c.seasons = [
    { leagueYear: 2026, teamId: 'BOS', wins: 41, losses: 41, result: R.MISSED },
    { leagueYear: 2027, teamId: 'BOS', wins: 50, losses: 32, result: R.FIRST_ROUND },
    { leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION },
    { leagueYear: 2029, teamId: 'BOS', wins: 58, losses: 24, result: R.CHAMPION },
    { leagueYear: 2030, teamId: 'BOS', wins: 55, losses: 27, result: R.FINALS_LOSS },
    { leagueYear: 2031, teamId: 'BOS', wins: 30, losses: 52, result: R.MISSED }
  ];
  return c;
}

function checkCareerTotalsAreDerivedFromSeasonRows() {
  const t = gmCareer.careerTotals(sixSeasonCareer());
  assert.strictEqual(t.seasons, 6);
  assert.strictEqual(t.wins, 296);
  assert.strictEqual(t.losses, 196);
  assert.strictEqual(t.titles, 2);
  assert.strictEqual(t.finalsAppearances, 3, 'two titles plus one Finals loss');
  assert.strictEqual(t.playoffAppearances, 4);
  assert.strictEqual(Math.round(t.winPct * 1000) / 1000, 0.602);
  console.log('checkCareerTotalsAreDerivedFromSeasonRows: OK');
}
checkCareerTotalsAreDerivedFromSeasonRows();

function checkStreaksCountConsecutiveSeasonsOnly() {
  const c = sixSeasonCareer();
  assert.deepStrictEqual(gmCareer.titleYears(c), [2028, 2029]);
  assert.strictEqual(gmCareer.longestTitleRun(c), 2, 'back-to-back is a run of 2');
  assert.strictEqual(gmCareer.longestPlayoffStreak(c), 4, '2027-2030 is four straight');

  // A gap must break the run, not be skipped over.
  const R = gmCareer.SEASON_RESULT;
  c.seasons[3].result = R.MISSED;
  assert.strictEqual(gmCareer.longestTitleRun(c), 1, 'a missed year between titles breaks the run');
  assert.strictEqual(gmCareer.longestPlayoffStreak(c), 2, 'and breaks the playoff streak');
  console.log('checkStreaksCountConsecutiveSeasonsOnly: OK');
}
checkStreaksCountConsecutiveSeasonsOnly();

function checkArchiveQueriesRespectTheTenureWindow() {
  const c = sixSeasonCareer();
  const leagueHistory = {
    champions: [],
    draftClasses: [
      // Inside the tenure, the user's team: counts.
      { leagueYear: 2027, picks: [{ round: 1, pickNumber: 3, teamId: 'BOS', playerId: 'p1', playerName: 'Real Pick' }] },
      // Inside the tenure, ANOTHER team: does not count.
      { leagueYear: 2027, picks: [{ round: 1, pickNumber: 4, teamId: 'LAL', playerId: 'p2', playerName: 'Not Yours' }] },
      // The user's team, but BEFORE the tenure started: does not count.
      { leagueYear: 2020, picks: [{ round: 1, pickNumber: 1, teamId: 'BOS', playerId: 'p3', playerName: 'Before You' }] }
    ],
    trades: [
      { leagueYear: 2028, participants: ['BOS', 'LAL'],
        players: [{ playerId: 'p4', playerName: 'Arrived', fromTeamId: 'LAL', toTeamId: 'BOS' },
                  { playerId: 'p5', playerName: 'Departed', fromTeamId: 'BOS', toTeamId: 'LAL' }], picks: [] },
      { leagueYear: 2028, participants: ['NYK', 'MIA'],
        players: [{ playerId: 'p6', playerName: 'Elsewhere', fromTeamId: 'NYK', toTeamId: 'MIA' }], picks: [] }
    ]
  };

  const picks = gmCareer.userDraftPicks(c, leagueHistory);
  assert.strictEqual(picks.length, 1, 'only picks made by your team, during your years');
  assert.strictEqual(picks[0].playerName, 'Real Pick');

  const trades = gmCareer.userTrades(c, leagueHistory);
  assert.strictEqual(trades.length, 1, 'only trades your team took part in');

  const arrivals = gmCareer.playersAcquiredByTrade(c, leagueHistory);
  assert.deepStrictEqual(arrivals.map(function (a) { return a.playerName; }), ['Arrived'],
    'a player LEAVING your team is not an acquisition');
  console.log('checkArchiveQueriesRespectTheTenureWindow: OK');
}
checkArchiveQueriesRespectTheTenureWindow();

// THE ANTI-DRIFT ASSERTION.
//
// Comparing the career page's title count against the trophy room's banner
// count would be VACUOUS: both read careerTotals, so the test passes no matter
// how wrong careerTotals is. It has to be checked against an INDEPENDENT
// re-implementation — the same idiom validate-skillCheck.js's referenceShot
// uses. That means a future change to careerTotals must be mirrored here by
// hand. That is the point, not an inconvenience.
function checkTitlesAgreeWithAnIndependentWalkOfTheArchive() {
  const c = sixSeasonCareer();
  const leagueHistory = {
    champions: [
      { leagueYear: 2028, teamId: 'BOS' },
      { leagueYear: 2029, teamId: 'BOS' },
      { leagueYear: 2030, teamId: 'LAL' },
      { leagueYear: 2024, teamId: 'BOS' }   // before the tenure: not yours
    ],
    draftClasses: [], trades: []
  };

  // Independent: walks LEAGUE_HISTORY.champions and the tenure list directly,
  // touching none of gmCareer's derived helpers except the tenure predicate.
  let referenceTitles = 0;
  leagueHistory.champions.forEach(function (ch) {
    if (gmCareer.tenureCovers(c, ch.teamId, ch.leagueYear)) referenceTitles += 1;
  });

  assert.strictEqual(gmCareer.careerTotals(c).titles, referenceTitles,
    'the season rows and the champions archive must tell the same story');
  console.log('checkTitlesAgreeWithAnIndependentWalkOfTheArchive: OK (' + referenceTitles + ' titles)');
}
checkTitlesAgreeWithAnIndependentWalkOfTheArchive();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-gmCareer.js`
Expected: FAIL — `gmCareer.careerTotals is not a function`

- [ ] **Step 3: Implement the queries**

Append to `gmCareer.js`, before the `module.exports` block:

```js
function careerTotals(career) {
  const seasons = (career && career.seasons) || [];
  let wins = 0, losses = 0, playoffAppearances = 0, finalsAppearances = 0, titles = 0;
  seasons.forEach(function (s) {
    wins += s.wins;
    losses += s.losses;
    if (s.result >= SEASON_RESULT.FIRST_ROUND) playoffAppearances += 1;
    if (s.result >= SEASON_RESULT.FINALS_LOSS) finalsAppearances += 1;
    if (s.result === SEASON_RESULT.CHAMPION) titles += 1;
  });
  return {
    seasons: seasons.length,
    wins: wins,
    losses: losses,
    winPct: (wins + losses) > 0 ? wins / (wins + losses) : 0,
    playoffAppearances: playoffAppearances,
    finalsAppearances: finalsAppearances,
    titles: titles
  };
}

function seasonsAscending(career) {
  return ((career && career.seasons) || []).slice()
    .sort(function (a, b) { return a.leagueYear - b.leagueYear; });
}

function titleYears(career) {
  return seasonsAscending(career)
    .filter(function (s) { return s.result === SEASON_RESULT.CHAMPION; })
    .map(function (s) { return s.leagueYear; });
}

// Consecutive by YEAR, not by array position — a career with a gap in its
// season rows (possible after a commissioner rewind) must not count across it.
function longestRunWhere(career, predicate) {
  let best = 0, run = 0, prevYear = null;
  seasonsAscending(career).forEach(function (s) {
    const consecutive = prevYear !== null && s.leagueYear === prevYear + 1;
    if (predicate(s)) {
      run = consecutive ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prevYear = s.leagueYear;
  });
  return best;
}

function longestTitleRun(career) {
  return longestRunWhere(career, function (s) { return s.result === SEASON_RESULT.CHAMPION; });
}

function longestPlayoffStreak(career) {
  return longestRunWhere(career, function (s) { return s.result >= SEASON_RESULT.FIRST_ROUND; });
}

function userDraftPicks(career, leagueHistory) {
  const out = [];
  ((leagueHistory && leagueHistory.draftClasses) || []).forEach(function (cls) {
    (cls.picks || []).forEach(function (p) {
      if (!tenureCovers(career, p.teamId, cls.leagueYear)) return;
      out.push({ leagueYear: cls.leagueYear, round: p.round, pickNumber: p.pickNumber,
                 playerId: p.playerId, playerName: p.playerName });
    });
  });
  return out;
}

function userTrades(career, leagueHistory) {
  return ((leagueHistory && leagueHistory.trades) || []).filter(function (t) {
    return (t.participants || []).some(function (teamId) {
      return tenureCovers(career, teamId, t.leagueYear);
    });
  });
}

// Only arrivals. A player leaving your team is part of the same trade record,
// and counting him would make every deal look like an acquisition.
function playersAcquiredByTrade(career, leagueHistory) {
  const out = [];
  userTrades(career, leagueHistory).forEach(function (t) {
    (t.players || []).forEach(function (p) {
      if (!tenureCovers(career, p.toTeamId, t.leagueYear)) return;
      out.push({ leagueYear: t.leagueYear, playerId: p.playerId, playerName: p.playerName });
    });
  });
  return out;
}
```

Add all eight to `module.exports`: `careerTotals`, `titleYears`, `longestTitleRun`, `longestPlayoffStreak`, `userDraftPicks`, `userTrades`, `playersAcquiredByTrade`, `seasonsAscending`.

Add the same eight names to `history.js`'s browser-global `gmCareer:` fallback object so the browser path can reach them.

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-gmCareer.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: every `check...: OK`, then `done` with no FAIL lines.

- [ ] **Step 5: Mutation-test the anti-drift assertion**

In `careerTotals`, temporarily change `if (s.result === SEASON_RESULT.CHAMPION) titles += 1;` to `>= SEASON_RESULT.FINALS_LOSS`. Run `node scripts/validate-gmCareer.js`.
Expected: FAIL on `the season rows and the champions archive must tell the same story` (3 vs 2). Revert.

This is the assertion that proves the independent re-implementation is genuinely independent. If it survives, the "reference" is secretly calling the code under test — fix that before continuing.

- [ ] **Step 6: Commit**

```bash
git add gmCareer.js history.js scripts/validate-gmCareer.js
git commit -m "feat: your record, read back out of history"
```

---

### Task 4: The chronicle

**Files:**
- Modify: `gmCareer.js`
- Modify: `history.js` (`finalizeSeasonHistory`)
- Test: `scripts/validate-gmCareer.js`

**Interfaces:**
- Consumes: `SEASON_RESULT_LABEL`, `recordSeason` from Tasks 2-3.
- Produces:
  - `gmCareer.addChronicle(career, leagueYear, kind, text)` → the entry `{ leagueYear, kind, text }`
  - `gmCareer.recordSeasonChronicle(career, row, teamName)` → the entry appended for a season's result
  - Chronicle `kind` values, fixed: `'season'`, `'milestone'`, `'award'`, `'draft'`, `'record'`

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-gmCareer.js`:

```js
function checkChronicleIsAppendOnlyAndDated() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const e = gmCareer.addChronicle(c, 2028, 'milestone', 'Won your first championship.');
  assert.deepStrictEqual(e, { leagueYear: 2028, kind: 'milestone', text: 'Won your first championship.' });
  assert.strictEqual(c.chronicle.length, 1);

  gmCareer.addChronicle(c, 2029, 'award', 'Jayson Tatum wins MVP.');
  assert.strictEqual(c.chronicle.length, 2, 'entries accumulate; nothing is overwritten');
  console.log('checkChronicleIsAppendOnlyAndDated: OK');
}
checkChronicleIsAppendOnlyAndDated();

function checkSeasonChronicleTextIsFrozenAtWriteTime() {
  const R = gmCareer.SEASON_RESULT;
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const row = { leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION };
  const e = gmCareer.recordSeasonChronicle(c, row, 'Boston Harbormen');
  assert.strictEqual(e.kind, 'season');
  assert.strictEqual(e.text, '62-20. Won the championship.',
    'the line reads as a sentence and carries the record');

  // The reason text is stored rather than rendered lazily: commissioner.js can
  // rename a franchise and expansion teams appear mid-save, so a lazily
  // rendered line could claim you won the 2028 title with a team that did not
  // exist until 2034.
  const miss = gmCareer.recordSeasonChronicle(c,
    { leagueYear: 2031, teamId: 'BOS', wins: 30, losses: 52, result: R.MISSED }, 'Boston Harbormen');
  assert.strictEqual(miss.text, '30-52. Missed the playoffs.');
  console.log('checkSeasonChronicleTextIsFrozenAtWriteTime: OK');
}
checkSeasonChronicleTextIsFrozenAtWriteTime();

function checkChronicleGetsOneSeasonLinePerYear() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  gmCareer.recordSeasonChronicle(c, c.seasons[0], 'Boston Harbormen');
  // Re-running the same season must not double the line, the same way
  // recordSeason does not double the row.
  const again = gmCareer.recordSeasonChronicle(c, c.seasons[0], 'Boston Harbormen');
  assert.strictEqual(again, null, 'a year already chronicled returns null');
  assert.strictEqual(c.chronicle.filter(function (e) { return e.kind === 'season'; }).length, 1);
  console.log('checkChronicleGetsOneSeasonLinePerYear: OK');
}
checkChronicleGetsOneSeasonLinePerYear();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-gmCareer.js`
Expected: FAIL — `gmCareer.addChronicle is not a function`

- [ ] **Step 3: Implement the chronicle**

Append to `gmCareer.js`, before `module.exports`:

```js
// The permanent, SELECTIVE timeline. Not a copy of the news feed — the feed is
// noise, which is exactly why script.js caps it at 200 entries and throws the
// rest away. This keeps only career-grade moments, so fifty seasons is a few
// hundred short strings.
const CHRONICLE_KINDS = { SEASON: 'season', MILESTONE: 'milestone', AWARD: 'award', DRAFT: 'draft', RECORD: 'record' };

function addChronicle(career, leagueYear, kind, text) {
  if (!career) return null;
  if (!Array.isArray(career.chronicle)) career.chronicle = [];
  const entry = { leagueYear: leagueYear, kind: kind, text: text };
  career.chronicle.push(entry);
  return entry;
}

// Returns null when this year already has its season line, mirroring
// recordSeason's guard: the manual and fast-forward paths both reach here.
function recordSeasonChronicle(career, row, teamName) {
  if (!career || !row) return null;
  const already = (career.chronicle || []).some(function (e) {
    return e.kind === CHRONICLE_KINDS.SEASON && e.leagueYear === row.leagueYear;
  });
  if (already) return null;
  const label = SEASON_RESULT_LABEL[String(row.result)] || 'Season complete';
  // teamName is accepted but not interpolated into the default line: the row
  // already carries teamId, and the career page groups by team. It is a
  // parameter so a multi-team career can prefix the line later without
  // changing this signature.
  return addChronicle(career, row.leagueYear, CHRONICLE_KINDS.SEASON,
    row.wins + '-' + row.losses + '. ' + label + '.');
}
```

Export `addChronicle`, `recordSeasonChronicle`, `CHRONICLE_KINDS`; add the same three to `history.js`'s browser-global fallback.

- [ ] **Step 4: Wire the season line into the hook**

In `history.js`'s `finalizeSeasonHistory`, extend the block added in Task 2 so it reads:

```js
  if (typeof GameState !== 'undefined' && GameState && GameState.userTeamId) {
    const career = _HISTORY_DATA.gmCareer.ensureGmCareer(GameState);
    const userTeam = _HISTORY_DATA.teams.getTeamById(GameState.userTeamId);
    if (userTeam) {
      const row = _HISTORY_DATA.gmCareer.recordSeason(career, leagueYear, userTeam.id,
        userTeam.record.wins, userTeam.record.losses, playoffBracket);
      _HISTORY_DATA.gmCareer.recordSeasonChronicle(career, row, userTeam.name);
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `node scripts/validate-gmCareer.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: all OK, then `done` with no FAIL lines.

- [ ] **Step 6: Mutation-test the duplicate guard**

Temporarily change `if (already) return null;` to `if (false) return null;`. Run `node scripts/validate-gmCareer.js`.
Expected: FAIL on `a year already chronicled returns null`. Revert.

- [ ] **Step 7: Commit**

```bash
git add gmCareer.js history.js scripts/validate-gmCareer.js
git commit -m "feat: a career timeline that survives past 200 headlines"
```

---

### Task 5: The chase list

**Files:**
- Create: `gmMilestones.js`
- Create: `scripts/validate-gmMilestones.js`
- Modify: `history.js` (dep object + `finalizeSeasonHistory`)
- Modify: `index.html` (script tag)

**Interfaces:**
- Consumes: everything from `gmCareer.js` (Tasks 2-4).
- Produces:
  - `gmMilestones.MILESTONES` → array of `{ id, label, description, family, hidden, achieved(ctx), progress(ctx)|null }`
  - `gmMilestones.FAMILIES` → `['winning', 'building', 'dealing', 'endurance', 'absurd']`
  - `gmMilestones.buildContext(career, leagueHistory, players, retiredPlayers, toDisplayRating)` → the `ctx` every predicate receives
  - `gmMilestones.evaluate(career, ctx)` → array of newly unlocked milestone objects (and appends `{ id, leagueYear }` to `career.milestones` plus a chronicle line)
  - `gmMilestones.isUnlocked(career, id)` → boolean
  - `gmMilestones.nearestMilestone(career, ctx)` → `{ milestone, current, target, fraction }` or `null`

The context is built by the caller and passed in, so `gmMilestones.js` imports neither `history.js` nor `players-2026.js` — no cycle, and the whole catalogue is testable against a hand-built context.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-gmMilestones.js`:

```js
// The chase-list is a BALANCE problem wearing a coding problem's clothes: a
// list where half the entries are unreachable discourages, and one cleared by
// season eight is empty. These tests cover the mechanics only — whether the
// thresholds are any good is measured by scripts/probe-gm-milestones.js.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const gmCareer = rq('gmCareer.js');
const gmMilestones = rq('gmMilestones.js');
const ratings = rq('ratings.js');

function careerWith(seasons) {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  c.seasons = seasons;
  return c;
}

function emptyContext(career) {
  return gmMilestones.buildContext(career, { champions: [], draftClasses: [], trades: [], awardsHistory: [] },
    [], [], ratings.toDisplayRating);
}

function checkEveryMilestoneIsWellFormed() {
  const seen = {};
  gmMilestones.MILESTONES.forEach(function (m) {
    assert.ok(m.id && typeof m.id === 'string', 'every milestone needs an id');
    assert.strictEqual(seen[m.id], undefined, 'duplicate milestone id: ' + m.id);
    seen[m.id] = true;
    assert.ok(m.label && m.description, m.id + ' needs a label and a description');
    assert.notStrictEqual(gmMilestones.FAMILIES.indexOf(m.family), -1,
      m.id + ' has unknown family ' + m.family);
    assert.strictEqual(typeof m.achieved, 'function', m.id + ' needs an achieved()');
    assert.ok(m.progress === null || typeof m.progress === 'function',
      m.id + ' progress must be a function or explicitly null');
    assert.strictEqual(typeof m.hidden, 'boolean', m.id + ' must declare hidden explicitly');
  });
  assert.ok(gmMilestones.MILESTONES.length >= 15,
    'a chase-list shorter than 15 does not span a career');
  console.log('checkEveryMilestoneIsWellFormed: OK (' + gmMilestones.MILESTONES.length + ' milestones)');
}
checkEveryMilestoneIsWellFormed();

function checkNothingIsAchievedOnAnEmptyCareer() {
  const c = careerWith([]);
  const ctx = emptyContext(c);
  const wrongly = gmMilestones.MILESTONES.filter(function (m) { return m.achieved(ctx); });
  assert.deepStrictEqual(wrongly.map(function (m) { return m.id; }), [],
    'these fire on a career that has done nothing: ' + wrongly.map(function (m) { return m.id; }).join(', '));
  console.log('checkNothingIsAchievedOnAnEmptyCareer: OK');
}
checkNothingIsAchievedOnAnEmptyCareer();

function checkUnlockIsRecordedOnceWithItsYear() {
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION }]);
  const ctx = emptyContext(c);

  const first = gmMilestones.evaluate(c, ctx);
  const ids = first.map(function (m) { return m.id; });
  assert.notStrictEqual(ids.indexOf('first_title'), -1, 'winning a title unlocks first_title');
  assert.strictEqual(gmMilestones.isUnlocked(c, 'first_title'), true);
  const record = c.milestones.find(function (u) { return u.id === 'first_title'; });
  assert.strictEqual(record.leagueYear, 2028, 'the unlock is dated to the latest season');

  const second = gmMilestones.evaluate(c, ctx);
  assert.deepStrictEqual(second, [], 're-evaluating unlocks nothing new');
  assert.strictEqual(c.milestones.filter(function (u) { return u.id === 'first_title'; }).length, 1);
  console.log('checkUnlockIsRecordedOnceWithItsYear: OK');
}
checkUnlockIsRecordedOnceWithItsYear();

function checkUnlockWritesAChronicleLine() {
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION }]);
  gmMilestones.evaluate(c, emptyContext(c));
  const lines = c.chronicle.filter(function (e) { return e.kind === 'milestone'; });
  assert.ok(lines.length >= 1, 'an unlock must reach the chronicle, not just the milestone list');
  assert.strictEqual(lines[0].leagueYear, 2028);
  console.log('checkUnlockWritesAChronicleLine: OK');
}
checkUnlockWritesAChronicleLine();

function checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes() {
  const R = gmCareer.SEASON_RESULT;
  // 9 seasons: ten_seasons sits at 9/10 = 0.9, the highest fraction available.
  const seasons = [];
  for (let i = 0; i < 9; i++) {
    seasons.push({ leagueYear: 2026 + i, teamId: 'BOS', wins: 41, losses: 41, result: R.MISSED });
  }
  const c = careerWith(seasons);
  const near = gmMilestones.nearestMilestone(c, emptyContext(c));
  assert.strictEqual(near.milestone.id, 'ten_seasons');
  assert.strictEqual(near.current, 9);
  assert.strictEqual(near.target, 10);

  // Called twice on identical state it must give the same answer, or the
  // Dashboard changes what it is telling you every time it repaints.
  const again = gmMilestones.nearestMilestone(c, emptyContext(c));
  assert.strictEqual(again.milestone.id, near.milestone.id);

  // Binary achievements have no honest fraction and must be excluded rather
  // than assigned a fake one.
  gmMilestones.MILESTONES.forEach(function (m) {
    if (m.progress === null) {
      assert.notStrictEqual(near.milestone.id, m.id, 'a binary milestone must never be "nearest"');
    }
  });
  console.log('checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes: OK');
}
checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes();

function checkHiddenMilestonesAreNeverTheNearestHint() {
  const R = gmCareer.SEASON_RESULT;
  const seasons = [];
  for (let i = 0; i < 24; i++) {
    seasons.push({ leagueYear: 2026 + i, teamId: 'BOS', wins: 60, losses: 22, result: R.CHAMPION });
  }
  const c = careerWith(seasons);
  const near = gmMilestones.nearestMilestone(c, emptyContext(c));
  if (near) {
    assert.strictEqual(near.milestone.hidden, false,
      'the Dashboard hint must never spoil a hidden milestone');
  }
  console.log('checkHiddenMilestonesAreNeverTheNearestHint: OK');
}
checkHiddenMilestonesAreNeverTheNearestHint();

function checkTheScaleTrap() {
  // peakOverall is RAW; the 90 in "a player you drafted reaches 90" is DISPLAY.
  // On this curve DISPLAY RUNS HIGHER THAN RAW — raw 75 displays as 90, raw 78
  // as 92, raw 90 as 97. So the failure mode of comparing raw against a display
  // threshold is that the milestone SILENTLY UNDER-FIRES: it would demand raw
  // 90, which is really a display-97 all-time great, and genuine 90-rated stars
  // would never trip it. That is the quiet version of this bug and the reason
  // it has survived four times in this codebase.
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2027, teamId: 'BOS', wins: 50, losses: 32, result: R.FIRST_ROUND }]);
  const leagueHistory = {
    champions: [], trades: [], awardsHistory: [],
    draftClasses: [{ leagueYear: 2027, picks: [{ round: 1, pickNumber: 5, teamId: 'BOS', playerId: 'p1', playerName: 'The Kid' }] }]
  };
  const drafted = gmMilestones.MILESTONES.find(function (m) { return m.id === 'drafted_a_star'; });

  // Preconditions. If the curve is ever re-anchored these fail first and say so,
  // rather than the test quietly proving nothing.
  assert.strictEqual(ratings.toDisplayRating(78) >= 90, true,
    'precondition: raw 78 IS a display-90 player on this curve');
  assert.strictEqual(78 >= 90, false,
    'precondition: ...and a naive raw comparison would miss him entirely');

  const realStar = { id: 'p1', name: 'The Kid', peakOverall: 78 };
  const ctxStar = gmMilestones.buildContext(c, leagueHistory, [realStar], [], ratings.toDisplayRating);
  assert.strictEqual(drafted.achieved(ctxStar), true,
    'a raw-78 player displays as 92 and MUST satisfy a display-90 threshold');

  // raw 70 displays as 87 — a good starter, not a star. The threshold must
  // still reject somebody.
  const notAStar = { id: 'p1', name: 'The Kid', peakOverall: 70 };
  const ctxNot = gmMilestones.buildContext(c, leagueHistory, [notAStar], [], ratings.toDisplayRating);
  assert.strictEqual(drafted.achieved(ctxNot), false, 'raw 70 displays as 87 and must not qualify');
  console.log('checkTheScaleTrap: OK');
}
checkTheScaleTrap();

console.log('All gmMilestones validations passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-gmMilestones.js`
Expected: FAIL — `Cannot find module '.../gmMilestones.js'`

- [ ] **Step 3: Create `gmMilestones.js`**

```js
// The chase-list: the answer to "what do I do next" without anything nagging
// you. Every milestone is a pure predicate over a context the CALLER builds, so
// this file imports neither history.js nor players-2026.js — history.js already
// requires gmCareer.js, and importing back would be a cycle. It also makes the
// whole catalogue testable against a hand-built archive.
//
// `progress` returns { current, target } and is used only for the Dashboard's
// "closest" hint. Binary achievements set it to NULL rather than reporting a
// fake fraction — a milestone you either have or do not have has no honest
// halfway point.
//
// THRESHOLDS HERE ARE CALIBRATED, NOT PICKED. scripts/probe-gm-milestones.js
// measures when each one actually fires across 50 seasons on all 30 teams;
// values move to hit the measured rate. Do not hand-tune them to taste.
var _GMMILESTONE_DATA = (typeof require !== 'undefined')
  ? { career: require('./gmCareer.js') }
  : { career: {
        careerTotals: careerTotals, titleYears: titleYears,
        longestTitleRun: longestTitleRun, longestPlayoffStreak: longestPlayoffStreak,
        userDraftPicks: userDraftPicks, playersAcquiredByTrade: playersAcquiredByTrade,
        addChronicle: addChronicle, seasonsAscending: seasonsAscending,
        tenureCovers: tenureCovers, SEASON_RESULT: SEASON_RESULT,
        CHRONICLE_KINDS: CHRONICLE_KINDS
      } };

const FAMILIES = ['winning', 'building', 'dealing', 'endurance', 'absurd'];

// Display-scale thresholds. peakOverall is stored RAW, so every comparison goes
// through ctx.toDisplay first. See the "two scales" constraint.
const STAR_OVERALL = 90;
const SOLID_OVERALL = 85;

function buildContext(career, leagueHistory, players, retiredPlayers, toDisplayRating) {
  const C = _GMMILESTONE_DATA.career;
  const byId = {};
  (players || []).forEach(function (p) { byId[p.id] = p; });
  (retiredPlayers || []).forEach(function (r) { if (!byId[r.id]) byId[r.id] = r; });

  return {
    career: career,
    leagueHistory: leagueHistory || { champions: [], draftClasses: [], trades: [], awardsHistory: [] },
    players: players || [],
    retiredPlayers: retiredPlayers || [],
    playerById: function (id) { return byId[id] || null; },
    toDisplay: toDisplayRating || function (raw) { return raw; },
    totals: C.careerTotals(career),
    seasons: C.seasonsAscending(career),
    draftPicks: C.userDraftPicks(career, leagueHistory),
    acquired: C.playersAcquiredByTrade(career, leagueHistory)
  };
}

function peakDisplay(ctx, playerId) {
  const p = ctx.playerById(playerId);
  if (!p || typeof p.peakOverall !== 'number') return 0;
  return ctx.toDisplay(p.peakOverall);
}

function bestSeasonWins(ctx) {
  return ctx.seasons.reduce(function (m, s) { return Math.max(m, s.wins); }, 0);
}

// A player who was on one of your teams during a season you held it.
function playedForYouIn(ctx, playerId, leagueYear) {
  const p = ctx.playerById(playerId);
  if (!p) return false;
  const history = p.careerHistory;
  const record = history && history.seasonByYear ? history.seasonByYear[leagueYear] : null;
  if (!record || !record.teamId) return false;
  return _GMMILESTONE_DATA.career.tenureCovers(ctx.career, record.teamId, leagueYear);
}

function awardsWonUnderYou(ctx, awardKey) {
  const out = [];
  (ctx.leagueHistory.awardsHistory || []).forEach(function (season) {
    (season.winners || []).forEach(function (w) {
      if (w.award !== awardKey) return;
      if (!playedForYouIn(ctx, w.playerId, season.leagueYear)) return;
      out.push({ leagueYear: season.leagueYear, playerId: w.playerId });
    });
  });
  return out;
}

function count(fn) { return function (ctx) { return fn(ctx); }; }

function atLeast(getter, target) {
  return {
    achieved: function (ctx) { return getter(ctx) >= target; },
    progress: function (ctx) { return { current: Math.min(getter(ctx), target), target: target }; }
  };
}

function milestone(id, family, label, description, hidden, spec) {
  return { id: id, family: family, label: label, description: description,
           hidden: hidden, achieved: spec.achieved, progress: spec.progress || null };
}

const MILESTONES = [
  // --- winning -------------------------------------------------------------
  milestone('first_title', 'winning', 'Ring',
    'Win your first championship', false,
    atLeast(function (ctx) { return ctx.totals.titles; }, 1)),

  milestone('back_to_back', 'winning', 'Back-to-Back',
    'Win the championship in consecutive seasons', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestTitleRun(ctx.career); }, 2)),

  milestone('three_peat', 'winning', 'Three-Peat',
    'Win three championships in a row', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestTitleRun(ctx.career); }, 3)),

  milestone('sixty_win_season', 'winning', 'Sixty',
    'Win 60 games in a season', false,
    atLeast(bestSeasonWins, 60)),

  milestone('first_finals', 'winning', 'On the Big Stage',
    'Reach the Finals', false,
    atLeast(function (ctx) { return ctx.totals.finalsAppearances; }, 1)),

  // --- building ------------------------------------------------------------
  milestone('drafted_a_star', 'building', 'Eye for Talent',
    'Draft a player who peaks at ' + STAR_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) { return peakDisplay(ctx, p.playerId) >= STAR_OVERALL; });
      },
      progress: function (ctx) {
        const best = ctx.draftPicks.reduce(function (m, p) { return Math.max(m, peakDisplay(ctx, p.playerId)); }, 0);
        return { current: Math.min(best, STAR_OVERALL), target: STAR_OVERALL };
      }
    }),

  milestone('drafted_a_hall_of_famer', 'building', 'Immortal',
    'Draft a player who retires Hall of Fame eligible', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) {
          const r = ctx.retiredPlayers.find(function (x) { return x.id === p.playerId; });
          return !!(r && r.hallOfFame);
        });
      },
      progress: null
    }),

  milestone('mvp_under_you', 'building', 'Most Valuable',
    'Have a player win MVP while on your team', false, {
      achieved: function (ctx) { return awardsWonUnderYou(ctx, 'mvp').length >= 1; },
      progress: null
    }),

  // --- dealing -------------------------------------------------------------
  milestone('traded_for_a_star', 'dealing', 'The Deal',
    'Acquire a player by trade who peaks at ' + STAR_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.acquired.some(function (a) { return peakDisplay(ctx, a.playerId) >= STAR_OVERALL; });
      },
      progress: function (ctx) {
        const best = ctx.acquired.reduce(function (m, a) { return Math.max(m, peakDisplay(ctx, a.playerId)); }, 0);
        return { current: Math.min(best, STAR_OVERALL), target: STAR_OVERALL };
      }
    }),

  milestone('second_round_steal', 'dealing', 'Steal',
    'Draft a player outside the first round who peaks at ' + SOLID_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) {
          return p.round > 1 && peakDisplay(ctx, p.playerId) >= SOLID_OVERALL;
        });
      },
      progress: null
    }),

  // --- endurance -----------------------------------------------------------
  milestone('five_seasons', 'endurance', 'Established',
    'Run a team for five seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 5)),

  milestone('ten_seasons', 'endurance', 'A Decade In',
    'Run a team for ten seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 10)),

  milestone('twenty_five_seasons', 'endurance', 'Institution',
    'Run a team for twenty-five seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 25)),

  milestone('five_hundred_wins', 'endurance', 'Five Hundred',
    'Win 500 games', false,
    atLeast(function (ctx) { return ctx.totals.wins; }, 500)),

  milestone('thousand_wins', 'endurance', 'A Thousand',
    'Win 1,000 games', false,
    atLeast(function (ctx) { return ctx.totals.wins; }, 1000)),

  milestone('playoff_decade', 'endurance', 'Perennial',
    'Reach the playoffs ten seasons in a row', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestPlayoffStreak(ctx.career); }, 10)),

  // --- absurd (hidden) -----------------------------------------------------
  milestone('dynasty', 'absurd', 'Dynasty',
    'Win five championships', true,
    atLeast(function (ctx) { return ctx.totals.titles; }, 5)),

  milestone('seventy_win_season', 'absurd', 'Seventy',
    'Win 70 games in a season', true,
    atLeast(bestSeasonWins, 70)),

  milestone('underdog_title', 'absurd', 'No One Saw It Coming',
    'Win the championship with fewer than 50 regular-season wins', true, {
      achieved: function (ctx) {
        return ctx.seasons.some(function (s) {
          return s.result === _GMMILESTONE_DATA.career.SEASON_RESULT.CHAMPION && s.wins < 50;
        });
      },
      progress: null
    }),

  milestone('five_time_mvp', 'absurd', 'The Face of the League',
    'Have one player win MVP five times under you', true, {
      achieved: function (ctx) {
        const byPlayer = {};
        awardsWonUnderYou(ctx, 'mvp').forEach(function (w) {
          byPlayer[w.playerId] = (byPlayer[w.playerId] || 0) + 1;
        });
        return Object.keys(byPlayer).some(function (id) { return byPlayer[id] >= 5; });
      },
      progress: null
    })
];

function isUnlocked(career, id) {
  return ((career && career.milestones) || []).some(function (u) { return u.id === id; });
}

function latestSeasonYear(career) {
  const seasons = _GMMILESTONE_DATA.career.seasonsAscending(career);
  return seasons.length > 0 ? seasons[seasons.length - 1].leagueYear : null;
}

// Returns the milestones unlocked BY THIS CALL. Already-unlocked ones are never
// returned or re-recorded, and nothing is ever revoked: an achievement that a
// later rules change would no longer grant stays earned.
function evaluate(career, ctx) {
  if (!career) return [];
  if (!Array.isArray(career.milestones)) career.milestones = [];
  const year = latestSeasonYear(career);
  const unlocked = [];
  MILESTONES.forEach(function (m) {
    if (isUnlocked(career, m.id)) return;
    if (!m.achieved(ctx)) return;
    career.milestones.push({ id: m.id, leagueYear: year });
    _GMMILESTONE_DATA.career.addChronicle(career, year,
      _GMMILESTONE_DATA.career.CHRONICLE_KINDS.MILESTONE, m.label + ' — ' + m.description + '.');
    unlocked.push(m);
  });
  return unlocked;
}

// The Dashboard hint. Deterministic by construction: highest progress fraction
// wins, ties break toward the LOWER target, then by declaration order. Hidden
// and binary milestones are excluded — the first would spoil a surprise, the
// second has no honest fraction.
function nearestMilestone(career, ctx) {
  let best = null;
  MILESTONES.forEach(function (m, index) {
    if (m.hidden) return;
    if (m.progress === null) return;
    if (isUnlocked(career, m.id)) return;
    const p = m.progress(ctx);
    if (!p || !p.target) return;
    const fraction = p.current / p.target;
    const candidate = { milestone: m, current: p.current, target: p.target, fraction: fraction, index: index };
    if (best === null) { best = candidate; return; }
    if (candidate.fraction > best.fraction) { best = candidate; return; }
    if (candidate.fraction < best.fraction) return;
    if (candidate.target < best.target) { best = candidate; return; }
    if (candidate.target > best.target) return;
    if (candidate.index < best.index) best = candidate;
  });
  if (!best) return null;
  return { milestone: best.milestone, current: best.current, target: best.target, fraction: best.fraction };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAMILIES: FAMILIES,
    MILESTONES: MILESTONES,
    STAR_OVERALL: STAR_OVERALL,
    SOLID_OVERALL: SOLID_OVERALL,
    buildContext: buildContext,
    evaluate: evaluate,
    isUnlocked: isUnlocked,
    nearestMilestone: nearestMilestone
  };
}
```

- [ ] **Step 4: Run the milestone tests**

Run: `node scripts/validate-gmMilestones.js`
Expected: all seven `check...: OK` lines, then `All gmMilestones validations passed`.

- [ ] **Step 5: Wire evaluation into the season-end hook**

In `history.js`, add to `_HISTORY_DATA` — require branch: `gmMilestones: require('./gmMilestones.js')`; browser branch: `gmMilestones: { buildContext: buildContext, evaluate: evaluate, nearestMilestone: nearestMilestone, MILESTONES: MILESTONES, isUnlocked: isUnlocked }`.

Also add `ratings` to `_HISTORY_DATA` — require branch `ratings: require('./ratings.js')`, browser branch `ratings: { toDisplayRating: toDisplayRating }`.

Extend the career block in `finalizeSeasonHistory` so it ends with:

```js
      // Milestones are evaluated AFTER the season row exists, because most of
      // them read it. Unlocks go to the feed as a line — never a modal. The
      // standing constraint is that nothing here adds a decision to make.
      const ctx = _HISTORY_DATA.gmMilestones.buildContext(career, LEAGUE_HISTORY,
        _HISTORY_DATA.players.PLAYERS_2026, LEAGUE_HISTORY.retiredPlayers,
        _HISTORY_DATA.ratings.toDisplayRating);
      _HISTORY_DATA.gmMilestones.evaluate(career, ctx).forEach(function (m) {
        sink('Career milestone: ' + m.label + ' — ' + m.description + '.');
      });
```

In `index.html`, add after the `gmCareer.js` tag:

```html
  <script src="gmMilestones.js"></script>
```

- [ ] **Step 6: Run the full suite**

Run: `node scripts/validate-gmMilestones.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: OK lines, then `done` with no FAIL lines.

- [ ] **Step 7: Mutation-test the scale guard**

In `peakDisplay`, temporarily change `return ctx.toDisplay(p.peakOverall);` to `return p.peakOverall;`. Run `node scripts/validate-gmMilestones.js`.
Expected: FAIL on `a raw-78 player displays as 92 and MUST satisfy a display-90 threshold` — the naive comparison demands raw 90 and so misses him. Revert.

This is the assertion guarding the bug this codebase has shipped four times. If it survives the mutation, it is worthless — rewrite it before continuing.

- [ ] **Step 8: Commit**

```bash
git add gmMilestones.js history.js index.html scripts/validate-gmMilestones.js
git commit -m "feat: a chase-list that spans a career"
```

---

### Task 6: Calibrate the chase list

**Files:**
- Create: `scripts/probe-gm-milestones.js`
- Modify: `gmMilestones.js` (thresholds only, driven by the measurement)

**Interfaces:**
- Consumes: `gmMilestones.MILESTONES`, `gmCareer.recordSeason`, the season pipeline used by `scripts/probe-twenty-seasons.js`.
- Produces: a printed table — per milestone, the median season it first fires and the share of the 30 careers that ever unlock it.

**This task is not optional polish.** The list is the single most likely thing to ship working and still not be fun.

- [ ] **Step 1: Write the probe**

Create `scripts/probe-gm-milestones.js`, modelled on `scripts/probe-twenty-seasons.js`'s real-pipeline construction:

```js
// Calibrates the chase-list by MEASURING it, never by picking values that
// sound right. A list where half the entries are unreachable discourages; one
// cleared by season eight is empty.
//
// "Competent play" is defined operationally: every team is run by autoGM.js,
// the same automation an unattended team already gets. That is a deliberately
// AVERAGE baseline — a real player should clear milestones somewhat faster, so
// tuning against it errs toward the list being achievable rather than
// punishing. All 30 teams are measured as the user, so no milestone is
// calibrated against one lucky franchise.
//
// Targets, from the spec:
//   - every non-hidden milestone fires for at least one of the 30 careers
//   - no milestone fires in more than ~60% of SEASONS (it is an achievement,
//     not a participation award)
//   - hidden milestones stay rare — roughly one per 20+ seasons each
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
const ratings = rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');
const gmCareer = rq('gmCareer.js');
const gmMilestones = rq('gmMilestones.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 50);

function buildGameState(seed, userTeamId) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
             played: false, homeScore: null, awayScore: null, boxScore: null,
             isPlayoff: false, seriesId: null };
  });
  return {
    userTeamId: userTeamId, leagueYear: 2026, rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: DRAFT_PROSPECTS_2026,
    settings: { leagueYear: 2026, lotteryFormat: undefined },
    gmCareer: null
  };
}

// firstFire[id] = list of "seasons into the career" values, one per team that
// ever unlocked it. fireSeasons[id] = total seasons in which it was unlocked.
const firstFire = {};
const everUnlocked = {};
gmMilestones.MILESTONES.forEach(function (m) { firstFire[m.id] = []; everUnlocked[m.id] = 0; });

let totalSeasons = 0;

TEAMS.forEach(function (userTeam, teamIndex) {
  const gs = buildGameState(4242 + teamIndex, userTeam.id);
  global.GameState = gs;   // history.js reads the browser global at season end

  for (let s = 0; s < SEASONS; s++) {
    const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
    for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
    gs.season.currentDay = lastDay;
    gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
    let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
    while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

    const before = gs.gmCareer ? gs.gmCareer.milestones.length : 0;
    rollover.runOffseasonRollover(gs, {});
    totalSeasons += 1;

    const career = gs.gmCareer;
    if (career) {
      career.milestones.slice(before).forEach(function (u) {
        firstFire[u.id].push(s + 1);
        everUnlocked[u.id] += 1;
      });
    }
  }
});

function median(arr) {
  if (arr.length === 0) return null;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

console.log('GM MILESTONE CALIBRATION — ' + SEASONS + ' seasons x ' + TEAMS.length + ' teams-as-user');
console.log('  autoGM runs every team, so this is AVERAGE play, not skilled play.\n');
console.log('  id                       family      hid  careers  median season  verdict');
gmMilestones.MILESTONES.forEach(function (m) {
  const careers = everUnlocked[m.id];
  const med = median(firstFire[m.id]);
  const sharePerSeason = careers / totalSeasons;
  let verdict = 'ok';
  if (careers === 0) verdict = m.hidden ? 'never (hidden: acceptable if rare by design)' : 'UNREACHABLE — lower it';
  else if (sharePerSeason > 0.6) verdict = 'TOO EASY — raise it';
  else if (m.hidden && sharePerSeason > 0.05) verdict = 'hidden but common — raise it';
  console.log('  ' + m.id.padEnd(24) + ' ' + m.family.padEnd(10) + '  ' +
    (m.hidden ? 'y' : 'n') + '    ' + String(careers).padStart(3) + '/' + TEAMS.length +
    '      ' + String(med === null ? '-' : med).padStart(6) + '        ' + verdict);
});
console.log('\n  total career-seasons simulated: ' + totalSeasons);
```

- [ ] **Step 2: Run the probe and record the table**

Run: `node scripts/probe-gm-milestones.js 2>&1 | tail -30`
Expected: a table with one row per milestone. Runtime is substantial (30 careers × 50 seasons); if it exceeds 10 minutes, re-run with `SEASONS=25` and say so when reporting, rather than reducing the team count — a smaller team count is what re-introduces the lucky-franchise bias this probe exists to remove.

- [ ] **Step 3: Move the thresholds the table says are wrong**

For every row whose verdict is not `ok`, change the threshold in `gmMilestones.js` — **the value, never the bound in the probe**. Re-run the probe after each change.

Concretely: an `UNREACHABLE` row means lowering the number in its `atLeast(...)` call or its `STAR_OVERALL`/`SOLID_OVERALL` constant; a `TOO EASY` row means raising it. Do not delete a milestone to make the table clean — a milestone nobody can reach is a threshold problem, not a concept problem.

- [ ] **Step 4: Re-run both validators**

Run: `node scripts/validate-gmMilestones.js && node scripts/validate-gmCareer.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: OK lines, then `done`. If `checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes` now fails because a threshold moved, fix the **test's fixture**, not the threshold — the calibration is the evidence, the fixture is not.

- [ ] **Step 5: Commit, with the table in the message**

Write the final probe table into `scratchpad/commitmsg-milestones.txt` along with a note of every threshold that moved and why, then:

```bash
git add gmMilestones.js scripts/probe-gm-milestones.js scripts/validate-gmMilestones.js
git commit -F <path-to-scratchpad>/commitmsg-milestones.txt
```

---

### Task 7: Persistence

**Files:**
- Modify: `save.js` (`SAVE_FORMAT_VERSION`, payload, restore)
- Modify: `scripts/validate-save.js`

**Interfaces:**
- Consumes: `gmCareer.ensureGmCareer` from Task 2.
- Produces: `payload.gmCareer`; `SAVE_FORMAT_VERSION === 3`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-save.js`, before its final `console.log`:

```js
function checkGmCareerRoundTrips() {
  const gmCareer = require(path.join(__dirname, '..', 'gmCareer.js'));
  const gs = makeFakeGameState();
  const career = gmCareer.ensureGmCareer(gs);
  career.name = 'Cory';
  gmCareer.recordSeason(career, 2026, gs.userTeamId, 58, 24, null);
  gmCareer.addChronicle(career, 2026, 'season', '58-24. Missed the playoffs.');
  career.milestones.push({ id: 'five_seasons', leagueYear: 2026 });

  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Round Trip Career')));
  assert.strictEqual(payload.version, 3, 'the career is a new field, so the format version moves');

  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.strictEqual(restored.gmCareer.name, 'Cory');
  assert.strictEqual(restored.gmCareer.seasons.length, 1);
  assert.strictEqual(restored.gmCareer.seasons[0].wins, 58);
  assert.strictEqual(restored.gmCareer.chronicle.length, 1);
  assert.deepStrictEqual(restored.gmCareer.milestones, [{ id: 'five_seasons', leagueYear: 2026 }]);
  console.log('checkGmCareerRoundTrips: OK');
}
checkGmCareerRoundTrips();

function checkAVersionTwoSaveStillLoads() {
  const gs = makeFakeGameState();
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Old Save')));
  // Exactly what a save written before this feature looks like.
  delete payload.gmCareer;
  payload.version = 2;

  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.ok(restored.gmCareer, 'a v2 save must come back with a career, not undefined');
  assert.strictEqual(restored.gmCareer.seasons.length, 0,
    'and with NO invented history — it does not know what happened before it existed');
  assert.strictEqual(restored.gmCareer.tenures[0].startYear, restored.leagueYear,
    'the tenure starts at the year the save is actually at');
  console.log('checkAVersionTwoSaveStillLoads: OK');
}
checkAVersionTwoSaveStillLoads();
```

These use the existing file's own helpers — `makeFakeGameState()` and the
`saveModule.serializeGameState` / `saveModule.applySavedState` pair. Do not
introduce a second set; match what is already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-save.js`
Expected: FAIL on `the career is a new field, so the format version moves` (2 vs 3).

- [ ] **Step 3: Implement persistence**

In `save.js`:

1. Change `const SAVE_FORMAT_VERSION = 2;` to `const SAVE_FORMAT_VERSION = 3;`
2. Add to the returned payload object, after the `godMode:` line:

```js
    // v3. The GM career record. Plain JSON — tenures, season rows, milestone
    // unlocks and the chronicle. Everything else on the career page is derived
    // from leagueHistory above, so there is nothing else to save.
    gmCareer: gameState.gmCareer || null
```
3. Add to `applySavedState`, next to the other field assignments:

```js
  // A v2 save has no career. Rather than fabricating one back to 2026,
  // ensureGmCareer opens a tenure at the year the save is actually at — the
  // record is honest about not knowing what happened before it existed.
  gameState.gmCareer = payload.gmCareer || null;
  _SAVE_DATA.gmCareer.ensureGmCareer(gameState);
```

Place this **after** `gameState.leagueYear` and `gameState.userTeamId` are assigned — `ensureGmCareer` reads both, and running it earlier opens the tenure on `undefined`.

4. Add `gmCareer` to `save.js`'s `_SAVE_DATA` dep object, both branches (`require('./gmCareer.js')` / `{ ensureGmCareer: ensureGmCareer }`).

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-save.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: both new OK lines, then `done` with no FAIL lines.

- [ ] **Step 5: Mutation-test the ordering hazard**

In `applySavedState`, temporarily move the two career lines to the very top of the function, before `gameState.leagueYear` is assigned. Run `node scripts/validate-save.js`.
Expected: FAIL on `the tenure starts at the year the save is actually at`. Restore the correct position.

- [ ] **Step 6: Commit**

```bash
git add save.js scripts/validate-save.js
git commit -m "feat: careers survive a save and a reload"
```

---

### Task 8: The career page

**Files:**
- Create: `ui/gmCareerView.js`
- Modify: `ui/nav.js` (`NAV_ITEMS`, `hub-records`)
- Modify: `script.js` (`BUILT_VIEWS`, `selectTeam`)
- Modify: `ui/teamSelect.js` (name field)
- Modify: `index.html` (script tag)
- Test: `scripts/validate-nav.js` (existing — must stay green), `scripts/ui-smoke.js` (existing — picks the view up automatically)

**Interfaces:**
- Consumes: everything from `gmCareer.js` and `gmMilestones.js`.
- Produces: `renderGmCareer(container)`; nav view id `'gmCareer'`, label `'My Career'`.

- [ ] **Step 1: Add the nav entry and run the existing nav test**

In `ui/nav.js`, add to `NAV_ITEMS` after the `history` entry:

```js
  { id: 'gmCareer', label: 'My Career' },
```

and add `'gmCareer'` to `hub-records`'s views, as the **first** entry so clicking Records lands there:

```js
  { id: 'hub-records', label: 'Records',
    views: ['gmCareer', 'history', 'awards', 'seasonSummary', 'frivolities'] },
```

Run: `node scripts/validate-nav.js`
Expected: FAIL on `hub-records lands on gmCareer, which has no renderer in BUILT_VIEWS`. That existing assertion is doing exactly its job — the view is registered but unreachable.

- [ ] **Step 2: Create the view**

Create `ui/gmCareerView.js`:

```js
// The career page. Two faces of ONE derived record: the chronicle timeline, and
// the trophy room. Neither stores anything — both read gmCareer's queries — so
// the banner count can never disagree with the title count above it.
function careerTrophyRoomHtml(career, totals) {
  const years = gmCareerTitleYears(career);
  if (years.length === 0) {
    return '<div class="empty-state">No banners yet. The rafters are waiting.</div>';
  }
  return '<div class="trophy-room">' +
    years.map(function (y) {
      return '<div class="banner"><div class="banner-year">' + y + '</div>' +
             '<div class="banner-label">CHAMPIONS</div></div>';
    }).join('') +
    '</div><div class="kpi-sub" style="margin-top:8px;">' +
      years.length + (years.length === 1 ? ' championship' : ' championships') +
      ' &middot; ' + totals.finalsAppearances + ' Finals appearance' + (totals.finalsAppearances === 1 ? '' : 's') +
    '</div>';
}

function careerChronicleHtml(career) {
  const entries = (career.chronicle || []).slice().reverse();
  if (entries.length === 0) {
    return '<div class="empty-state">Your career starts here. Finish a season and it will have something to say.</div>';
  }
  return '<ul class="headline-list">' + entries.map(function (e) {
    // Same reason ui/liveFeed.js escapes feed text: chronicle lines embed
    // player and team names, which are user-editable via commissioner tools.
    return '<li><span class="pill pill-mute">' + e.leagueYear + '</span> ' +
      '<span class="pill pill-' + (e.kind === 'milestone' ? 'win' : 'mute') + '">' + escapeHtml(e.kind) + '</span> ' +
      escapeHtml(e.text) + '</li>';
  }).join('') + '</ul>';
}

function careerMilestoneListHtml(career, ctx) {
  const visible = GM_MILESTONES.filter(function (m) { return !m.hidden; });
  const hiddenTotal = GM_MILESTONES.length - visible.length;
  const hiddenFound = GM_MILESTONES.filter(function (m) {
    return m.hidden && gmMilestoneIsUnlocked(career, m.id);
  });

  const rows = visible.map(function (m) {
    const done = gmMilestoneIsUnlocked(career, m.id);
    const unlock = (career.milestones || []).find(function (u) { return u.id === m.id; });
    let progressCell = done ? (unlock && unlock.leagueYear ? String(unlock.leagueYear) : 'done') : '—';
    if (!done && m.progress) {
      const p = m.progress(ctx);
      if (p && p.target) progressCell = p.current + ' / ' + p.target;
    }
    return '<tr><td>' + (done ? '<span class="pill pill-win">✓</span>' : '<span class="pill pill-mute">·</span>') + '</td>' +
      '<td class="col-name">' + escapeHtml(m.label) + '</td>' +
      '<td>' + escapeHtml(m.description) + '</td>' +
      '<td class="num">' + escapeHtml(progressCell) + '</td></tr>';
  }).join('');

  // Hidden ones are never named until earned — a locked COUNT, not a spoiler.
  const undiscovered = hiddenTotal - hiddenFound.length;
  const hiddenHtml = hiddenFound.map(function (m) {
    return '<tr><td><span class="pill pill-win">✓</span></td><td class="col-name">' + escapeHtml(m.label) + '</td>' +
      '<td>' + escapeHtml(m.description) + '</td><td class="num">—</td></tr>';
  }).join('') +
    (undiscovered > 0
      ? '<tr><td><span class="pill pill-mute">?</span></td><td class="col-name">' + undiscovered +
        ' undiscovered</td><td>Something is still out there.</td><td class="num">—</td></tr>'
      : '');

  return '<table class="data-table"><thead><tr><th></th><th>Milestone</th><th>How</th><th class="num">Progress</th></tr></thead>' +
    '<tbody>' + rows + hiddenHtml + '</tbody></table>';
}

function renderGmCareer(container) {
  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const team = getTeamById(GameState.userTeamId);
  const ctx = gmBuildMilestoneContext(career, LEAGUE_HISTORY, PLAYERS_2026,
    LEAGUE_HISTORY.retiredPlayers, toDisplayRating);

  const pct = totals.seasons > 0 ? (totals.winPct * 100).toFixed(1) : '0.0';

  container.innerHTML =
    '<div class="view-header"><h2>' + escapeHtml(career.name) + '</h2>' +
      '<span class="view-sub">General Manager · ' + escapeHtml(team ? team.name : '') + '</span></div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Seasons</div><div class="kpi-value">' + totals.seasons + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div><div class="kpi-value">' + totals.wins + '-' + totals.losses + '</div>' +
        '<div class="kpi-sub">' + pct + '% won</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Championships</div><div class="kpi-value">' + totals.titles + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Playoff Trips</div><div class="kpi-value">' + totals.playoffAppearances + '</div></div>' +
    '</div>' +

    '<div class="panel"><div class="panel-header">Trophy Room</div><div class="panel-body">' +
      careerTrophyRoomHtml(career, totals) + '</div></div>' +

    '<div class="panel"><div class="panel-header">Milestones</div><div class="panel-body">' +
      careerMilestoneListHtml(career, ctx) + '</div></div>' +

    '<div class="panel"><div class="panel-header">Career Chronicle</div><div class="panel-body">' +
      careerChronicleHtml(career) + '</div></div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderGmCareer: renderGmCareer };
}
```

**Browser-global naming note:** this view calls `gmCareerTitleYears`, `gmCareerTotals`, `gmMilestoneIsUnlocked`, `gmBuildMilestoneContext` and `GM_MILESTONES`. Those are not the names inside the modules. Add these aliases at the bottom of `gmCareer.js` and `gmMilestones.js`, **outside** the `module.exports` guard so they exist only as browser globals:

```js
// gmCareer.js — browser-global aliases. The bare names (titleYears,
// careerTotals) are far too generic to sit in the global namespace shared by
// every script tag; commissioner.js's clampRating already shadowed
// progression.js's once in this codebase.
if (typeof module === 'undefined' || !module.exports) {
  var gmCareerTitleYears = titleYears;
  var gmCareerTotals = careerTotals;
}
```
```js
// gmMilestones.js — same reasoning.
if (typeof module === 'undefined' || !module.exports) {
  var GM_MILESTONES = MILESTONES;
  var gmMilestoneIsUnlocked = isUnlocked;
  var gmBuildMilestoneContext = buildContext;
  var gmNearestMilestone = nearestMilestone;
}
```

- [ ] **Step 3: Register the renderer and the script tag**

In `script.js`'s `BUILT_VIEWS`, add after the `history: renderHistory,` line:

```js
  gmCareer: renderGmCareer,
```

In `index.html`, add after `<script src="ui/history.js"></script>` (or, if that tag does not exist, immediately before `<script src="script.js"></script>`):

```html
  <script src="ui/gmCareerView.js"></script>
```

- [ ] **Step 4: Capture the GM's name at team select**

In `ui/teamSelect.js`, add a name field inside the `.select-screen` markup, immediately after the `select-sub` div:

```js
    '<div class="select-name"><label for="gm-name-input">Your name</label>' +
    '<input id="gm-name-input" type="text" maxlength="28" placeholder="GM" autocomplete="off"></div>' +
```

In `script.js`'s `selectTeam`, replace the body with:

```js
function selectTeam(teamId, playMode) {
  GameState.userTeamId = teamId;
  GameState.playMode = playMode || 'gm';
  initSeason();

  // Read AFTER initSeason so leagueYear is settled — the tenure opens on the
  // year the career actually starts. Blank is fine and never blocks: the field
  // is a flourish, not a gate, and ensureGmCareer defaults it to 'GM'.
  const nameInput = document.getElementById('gm-name-input');
  const typed = nameInput && nameInput.value ? nameInput.value.trim() : '';
  const career = ensureGmCareer(GameState);
  if (typed) career.name = typed;

  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}
```

- [ ] **Step 5: Run the nav test and the UI smoke test**

Run: `node scripts/validate-nav.js && node scripts/ui-smoke.js 2>&1 | tail -5`
Expected: nav passes (including `checkGmModeShowsSevenHubs`, which must still report 7 — the new view joins an existing hub rather than adding one). The smoke test iterates `NAV_ITEMS`, so it renders `gmCareer` automatically; expect no thrown errors.

- [ ] **Step 6: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`, no FAIL lines.

- [ ] **Step 7: Commit**

```bash
git add ui/gmCareerView.js ui/nav.js ui/teamSelect.js script.js gmCareer.js gmMilestones.js index.html
git commit -m "feat: a career page with a trophy room and a timeline"
```

---

### Task 9: The Dashboard hint

**Files:**
- Modify: `ui/dashboard.js`
- Test: `scripts/validate-gmMilestones.js` (the determinism assertion from Task 5 already covers the pick; this task covers the rendering path via the smoke test)

**Interfaces:**
- Consumes: `gmNearestMilestone(career, ctx)` from Task 5.
- Produces: a "Career" panel on the Dashboard.

The hint has to be on the screen the player already lands on. Three clicks away and it stops answering "what do I do next".

- [ ] **Step 1: Add the panel**

In `ui/dashboard.js`, add this function above `renderDashboard`:

```js
// The "what do I do next" answer, on the screen you already land on.
//
// nearestMilestone excludes hidden and binary milestones — the first would
// spoil a surprise, the second has no honest halfway point. When nothing
// qualifies it returns null, and this renders the remaining COUNT rather than
// an empty panel, so the tile never looks broken.
function careerHintHtml() {
  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const ctx = gmBuildMilestoneContext(career, LEAGUE_HISTORY, PLAYERS_2026,
    LEAGUE_HISTORY.retiredPlayers, toDisplayRating);
  const near = gmNearestMilestone(career, ctx);

  const summary = '<div class="kpi-sub">' + totals.seasons + ' season' + (totals.seasons === 1 ? '' : 's') +
    ' &middot; ' + totals.wins + '-' + totals.losses +
    ' &middot; ' + totals.titles + (totals.titles === 1 ? ' title' : ' titles') + '</div>';

  if (!near) {
    const remaining = GM_MILESTONES.filter(function (m) {
      return !m.hidden && !gmMilestoneIsUnlocked(career, m.id);
    }).length;
    return summary + '<div class="kpi-value" style="font-size:1.05rem;">' +
      (remaining > 0 ? remaining + ' milestones left to chase' : 'Every milestone earned.') + '</div>';
  }

  const pct = Math.min(100, Math.round((near.current / near.target) * 100));
  return summary +
    '<div class="kpi-label" style="margin-top:10px;">Closest milestone</div>' +
    '<div class="kpi-value" style="font-size:1.05rem;">' + escapeHtml(near.milestone.label) + '</div>' +
    '<div class="kpi-sub">' + escapeHtml(near.milestone.description) + '</div>' +
    '<div class="meter" style="margin:8px 0 6px;"><div class="meter-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="kpi-sub">' + near.current + ' of ' + near.target + '</div>';
}
```

In `renderDashboard`'s `container.innerHTML` expression, insert this panel immediately **after** the `Next Up` panel and before `Key Injuries`:

```js
    '<div class="panel"><div class="panel-header">Your Career</div><div class="panel-body">' +
      careerHintHtml() +
    '</div></div>' +
```

- [ ] **Step 2: Verify the smoke test still renders the Dashboard**

Run: `node scripts/ui-smoke.js 2>&1 | tail -5`
Expected: no thrown errors. The Dashboard is the first view the smoke test renders, so a missing global here fails loudly and immediately.

- [ ] **Step 3: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`, no FAIL lines.

- [ ] **Step 4: Commit**

```bash
git add ui/dashboard.js
git commit -m "feat: the dashboard tells you what you're closest to"
```

---

### Task 10: The banner raising

**Files:**
- Create: `ui/championshipScene.js`
- Modify: `ui/simControls.js` (`stepOnce` playoff branch)
- Modify: `script.js` (`handleAdvanceToOffseason`)
- Modify: `index.html` (script tag)

**Interfaces:**
- Consumes: `gmCareerTitleYears`, `gmCareerTotals`.
- Produces: `maybeShowChampionshipScene(championTeamId, leagueYear, onContinue)` → `true` if a scene was rendered into `#view-content`, `false` otherwise.

Winning currently produces one feed line that scrolls away. This makes it a beat.

- [ ] **Step 1: Create the scene**

Create `ui/championshipScene.js`:

```js
// The banner raising. Deliberately CHEAP: it reuses the existing panel styling
// rather than introducing a visual system of its own. The point is the pause
// and the acknowledgement, not spectacle.
//
// Only the championship gets a full scene. Milestones are feed lines and a
// Dashboard change — a banner raising plus a milestone popup plus an award
// ceremony in the same offseason is an interruption, not a reward.
function maybeShowChampionshipScene(championTeamId, leagueYear, onContinue) {
  if (!championTeamId || championTeamId !== GameState.userTeamId) return false;

  const container = document.getElementById('view-content');
  if (!container) return false;

  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const team = getTeamById(championTeamId);
  const nth = totals.titles;

  // A first title should not read like a fourth.
  const headline = nth <= 1
    ? 'Your first championship.'
    : 'Championship number ' + nth + '.';
  const sub = nth <= 1
    ? 'They will remember where they were.'
    : gmCareerTitleYears(career).join(' · ');

  container.innerHTML =
    '<div class="panel champ-scene"><div class="panel-body" style="text-align:center;">' +
      '<div class="banner banner-large"><div class="banner-year">' + leagueYear + '</div>' +
        '<div class="banner-label">CHAMPIONS</div></div>' +
      '<h2 style="margin-top:14px;">' + teamLogoImgHtml(team.id, 32) + ' ' + escapeHtml(team.name) + '</h2>' +
      '<div class="kpi-value" style="font-size:1.15rem;">' + escapeHtml(headline) + '</div>' +
      '<div class="kpi-sub" style="margin-bottom:14px;">' + escapeHtml(sub) + '</div>' +
      '<button id="champ-continue" class="btn-primary">Raise the banner</button>' +
    '</div></div>';

  const btn = document.getElementById('champ-continue');
  if (btn) {
    btn.addEventListener('click', function () {
      if (typeof onContinue === 'function') onContinue();
    });
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { maybeShowChampionshipScene: maybeShowChampionshipScene };
}
```

- [ ] **Step 2: Trigger it on the fast-forward path**

In `ui/simControls.js`'s `stepOnce`, inside the `if (GameState.playoffBracket.finals[0] && GameState.playoffBracket.finals[0].winner)` branch, capture the champion **before** the rollover (which sets `GameState.playoffBracket = null`) and show the scene after:

```js
      // Captured BEFORE runOffseasonRollover, which clears playoffBracket.
      const championId = GameState.playoffBracket.finals[0].winner;
      const championYear = GameState.leagueYear || 2026;

      const rollover = runOffseasonRollover(GameState, {
        // ... existing options unchanged ...
      });
      if (rollover.careerSceneShown) out.sceneShown = true;

      // The career scene wins if both want the screen — only one thing can be
      // in view-content, and player-career mode's scene is the one the user
      // was mid-conversation with.
      if (!out.sceneShown && maybeShowChampionshipScene(championId, championYear, function () {
        renderView(GameState.currentView);
      })) {
        out.sceneShown = true;
      }
      return true;
```

`out.sceneShown` makes the run stop, which the loop already treats as "something asked to be read" — no new stop machinery.

- [ ] **Step 3: Trigger it on the manual path**

In `script.js`'s `handleAdvanceToOffseason`, capture the champion before the rollover and branch on the scene:

```js
  const finishedLeagueYear = GameState.leagueYear || 2026;
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;
  // Captured before runOffseasonRollover clears the bracket.
  const championId = GameState.playoffBracket && GameState.playoffBracket.finals[0]
    ? GameState.playoffBracket.finals[0].winner : null;

  runOffseasonRollover(GameState, {
    // ... existing options unchanged ...
  });

  // The banner takes the screen ahead of the season summary or the draft; both
  // are still one click away behind the button.
  const shown = maybeShowChampionshipScene(championId, finishedLeagueYear, function () {
    if (showSummary === true) {
      GameState.summarySeasonYear = finishedLeagueYear;
      renderView('seasonSummary');
    } else {
      renderView('draft');
    }
  });

  if (!shown) {
    if (showSummary === true) {
      GameState.summarySeasonYear = finishedLeagueYear;
      renderView('seasonSummary');
    } else {
      renderView('draft');
    }
  }
  autosave(GameState);
```

- [ ] **Step 4: Add the script tag and the styles**

In `index.html`, add before `<script src="script.js"></script>`:

```html
  <script src="ui/championshipScene.js"></script>
```

In `style.css`, append:

```css
/* Trophy room and banner raising. Deliberately built from the existing panel
   palette rather than a new visual system. */
.trophy-room { display: flex; flex-wrap: wrap; gap: 10px; }
.banner {
  width: 84px; padding: 10px 6px 14px; text-align: center;
  background: linear-gradient(180deg, var(--accent, #b8860b) 0%, rgba(0,0,0,0.25) 100%);
  clip-path: polygon(0 0, 100% 0, 100% 86%, 50% 100%, 0 86%);
}
.banner-large { width: 150px; margin: 0 auto; }
.banner-year { font-weight: 700; font-size: 1.1rem; }
.banner-label { font-size: 0.62rem; letter-spacing: 0.14em; opacity: 0.85; }
.banner-large .banner-year { font-size: 1.8rem; }
.champ-scene { max-width: 520px; margin: 24px auto; }
.select-name { margin: 10px 0 14px; display: flex; gap: 8px; align-items: center; justify-content: center; }
.select-name input { padding: 6px 8px; }
```

- [ ] **Step 5: Verify in the browser**

Start a no-store server on a fresh port (stale JS otherwise stays pinned — this project has been bitten by it), open the game, use God Mode's auto-win to reach a title, and confirm: the banner appears, the button dismisses it, and the Career page then shows one banner and a `Ring` milestone.

Run: `node scripts/ui-smoke.js 2>&1 | tail -5`
Expected: no thrown errors — the smoke test proves the new globals resolve even though it does not exercise the scene.

- [ ] **Step 6: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`, no FAIL lines.

- [ ] **Step 7: Commit**

```bash
git add ui/championshipScene.js ui/simControls.js script.js index.html style.css
git commit -m "feat: winning a title is a moment, not a line of text"
```

---

### Task 11: Whole-feature verification

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Full suite from a clean tree**

Run: `git status --short && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: no modified tracked files; `done` with no FAIL lines. Count the validators — there should now be 45 (43 existing + `validate-gmCareer.js` + `validate-gmMilestones.js`).

- [ ] **Step 2: Prove it works from a fresh clone**

Run: `git clone . "$TEMP/nba-verify" && cd "$TEMP/nba-verify" && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`. This catches a file that works only because of untracked local state — the "works on my machine" failure this project has hit before.

- [ ] **Step 3: Long-run sanity**

Run: `SEASONS=30 node scripts/probe-gm-milestones.js 2>&1 | tail -30`
Expected: the table, with no `UNREACHABLE` or `TOO EASY` verdicts left after Task 6's calibration. If any reappeared because later tasks changed behaviour, fix the threshold and re-commit — do not accept the drift.

- [ ] **Step 4: Browser check, end to end**

On a fresh no-store port: start a new game, type a name, confirm it appears on the Career page. Sim a full season and confirm the chronicle gains exactly one `season` line, the Dashboard's "Closest milestone" advances, and the milestone table's progress column moves. Reload the page and confirm all of it survives. Ignore the known `assets/logos/MIA.png` 404.

- [ ] **Step 5: Report**

State plainly: validator count and result, fresh-clone result, the final calibration table, and anything measured and left unfixed. Do not report completion with known-failing checks.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task: tenure log + season row → Tasks 1-2; derived queries → Task 3; chronicle → Task 4; chase list incl. visible/hidden split → Task 5; calibration with stated targets → Task 6; persistence + v2 load → Task 7; career page, trophy room, name capture, Records hub placement → Task 8; Dashboard nearest-milestone → Task 9; banner raising → Task 10; validators, probe, mutation testing, browser and fresh-clone checks → distributed through every task plus Task 11. The spec's three non-goals (no firing, no owner mandates, no new nagging) appear as Global Constraints. The spec's out-of-scope list is not implemented anywhere, as intended.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step carries the actual code. Task 6 deliberately does not name final threshold values — that is not a placeholder but the point of the task, and it states exactly which constants move and in which direction based on which verdict.

**3. Type consistency.** `SEASON_RESULT` values are used identically in Tasks 2, 3, 4 and 5. `career.milestones` entries are `{ id, leagueYear }` everywhere. `ctx` is built only by `buildContext` and consumed by `achieved`/`progress`/`nearestMilestone` with the same fields. `playoffResultByTeam` returns a map in Task 1 and is consumed as a map in Task 2. The browser-global aliases introduced in Task 8 (`gmCareerTotals`, `GM_MILESTONES`, `gmNearestMilestone`, `gmBuildMilestoneContext`, `gmMilestoneIsUnlocked`, `gmCareerTitleYears`) are the exact names used in Tasks 8, 9 and 10.

**One gap found and closed during review:** Tasks 8-10 call `ensureGmCareer`, `LEAGUE_HISTORY`, `toDisplayRating` and `PLAYERS_2026` as bare browser globals. Those all exist as globals already (`gmCareer.js`, `history.js`, `ratings.js`, `players-2026.js` each define them at top level), so no alias is needed for them — only for the four generically-named ones, which Task 8 Step 2 adds explicitly and explains.
