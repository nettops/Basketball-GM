# Ratings and Overall Implementation Plan

> **STATUS: DONE.** Shipped 2026-08-08 in seven commits, `f849879..87a89ef` on
> `live-game-sim`. This file is kept as the record of what was planned; the
> commit messages are the record of what was measured and why. Where the two
> disagree, **the commits are right** — read them first.
>
> Corrections applied to this file after execution, so it does not mislead:
>
> | the plan said | actually |
> |---|---|
> | goldens live in `docs/superpowers/` | `scripts/fixtures/` |
> | pts/team target 108–118 | unreachable at this engine's pace — see the Target Rates note |
> | Task 7 touches `ui/playerProfile.js` | only `ui/roster.js` had rating bands |
> | 38 validators | 40 by the end (two added) |
>
> **The numeric constants in Tasks 2, 4, 5 and 6 are deliberately left as the
> starting points they were written as.** Every one of them carries a
> calibration step, and all of them moved when swept — `PICK_POWER.shooter` was
> written 2.2 and shipped 1.4, `SCALE_SD` was written 14 and shipped 9. Editing
> them to the shipped values would erase the thing this plan was most right
> about: that they had to be measured, not picked. The shipped values and their
> sweeps are in the commit messages.
>
> Tasks 5 and 6 shipped as one commit (`be29249`). They are not separable: the
> shot-volume calibration cannot be judged while league scoring is low enough
> that the bottom tail of team scores trips validate-possession's floor.
>
> One regression escaped this plan and was fixed afterwards in `87a89ef`:
> `minutesWeight` still subtracted a hard 40 from `overall`, which collapsed
> 158 players onto an identical rotation weight once Task 3 moved overall's
> mean. Nothing here asserted that a value DOWNSTREAM of overall still had a
> usable range — that is the gap worth carrying into the next plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution only — this project never uses subagent-driven development.

**Goal:** Give players real individual identity by generating attributes for real on a true 0–100 scale, and make `overall` a derived measurement of what the sim actually rewards instead of a stored number the attributes are built from.

**Architecture:** Today the causality runs backwards: a hand-picked `overall` plus a fixed per-archetype offset table *produces* the 20 attributes (`players-2026.js:29`). That makes `overall` an input and the attributes a deterministic function of it, so the league contains 8 distinct players replicated 380 times at different scales. This plan inverts it. Attributes become the seed — generated from the existing hand-picked (overall, archetype) judgments plus deterministic per-player variation, mapped onto a true 0–100 scale. `overall` then becomes a read-only derived value, fitted by linear regression against the sim's own plus/minus per minute, exactly as ZenGM derives its `ovr` (`reference/zengm/analysis/player-ovr-basketball/process.py`). Finally the two missing nonlinearities are added: an amplifier on shot tendency and a power exponent on event allocation.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies, dual `require`/global module pattern. Node for validators and measurement; the browser loads every file as a plain global script in `index.html` order.

## Global Constraints

- **Zero dependencies.** No npm packages, no build step. The regression in Task 4 must be implemented as plain JS (normal equations via Gauss-Jordan), not scikit-learn.
- **Dual module pattern.** Every new file follows the existing `var _X_DATA = (typeof require !== 'undefined') ? {...} : {...}` shape and ends with `if (typeof module !== 'undefined' && module.exports)`. New browser files must be added to `index.html` in dependency order.
- **`git add` explicit paths only.** Never `git add -A`.
- **Every new assertion is mutation-tested.** Break the thing the assertion protects, confirm the validator fails, restore. A surviving mutant means the assertion is worthless or the code is dead — say which, in the commit message.
- **Calibrate by measured rate, never by picked values.** Any constant introduced here (`OFFSET_AMP`, `JITTER_SD`, `TENDENCY_*`, `PICK_POWER_*`, threshold values) must be chosen by sweeping it and reading the resulting league rate, with the sweep recorded in the commit message.
- **A/B against a control.** Measure the same seeds with the change off and on. A number without a control is not evidence.
- **Verify from a fresh `git clone --local` of HEAD**, not the working tree.
- **All 38 validators in `scripts/validate-*.js` must pass** at the end of every task. Run: `for f in scripts/validate-*.js; do node "$f" || echo "FAIL $f"; done` *(40 by the end: `validate-ratings.js` and `validate-identity.js` were added.)*
- **Golden masters** (`scripts/fixtures/gamesim-golden.json`, `scripts/fixtures/rollover-golden.json`) will change. Regeneration is correct here, but only in Task 7, only once, and the commit that does it must justify it with measured before/after league rates.

## Target Rates

Every task is judged against these. Baseline column is measured at HEAD (Task 1 records it); NBA column is measured from `reference/zengm/data/real-player-stats.basketball.json`, 2025 season, min 300 FGA.

| metric | baseline (HEAD) | target | real NBA 2025 |
|---|---|---|---|
| distinct attribute shapes | **17** (8 archetypes + 9 clamp artifacts) | ≥ 370 of 380 | n/a |
| per-player 3PA share p05→p95 | 22.8% → 35.5% (13 pts) | **~48 pts** | 4.5% → 71.6% (67 pts) |
| shot volume spread, FGA/36 best:worst | **1.4x** | **~2.5x** | 2.9x (usage%) |
| league 3P% | 38.8% | ~~35–37%~~ **36–38%** | 36.3% |
| league FG% | 49.2% | ~~46–49%~~ **47.5–49%** | — |
| pts/game/team | 101.4 | ~~108–118~~ ~~96–112~~ **99–115** | 114 (at ~100 poss) |
| synergy "shooter" qualifying share | **61.6%** | 15–25% | — |
| synergy "rebounder" qualifying share | **70.8%** | 15–25% | — |
| `overall` → minutes | saturating (correct, keep) | keep | saturating |
| `overall` → production convexity | mild | convex at the top | 6x from mid-scale to top |

**The pts/team target above was wrong as written, and Task 6 corrected it.**
108–118 imported NBA scoring without NBA pace. Measured, this engine runs
**90.9 possessions per team-game** against the real league's ~100, so matching
NBA scoring would demand 1.19 points per possession against the real 1.15 —
i.e. the target could only have been hit by making the basketball *less*
realistic. Shipped at 103.3 on 1.13 points per possession, which is internally
consistent. Closing the remaining gap means raising `POSSESSIONS_PER_TEAM`, and
that is a game-LENGTH decision (every watched game gets longer), not an
arithmetic one. Left open deliberately.

The lesson generalises: a target copied from a real-world number is only valid
if the *denominator* it implies also matches. Check pace before importing rate.

**Reopened and settled, 2026-08-16.** The paragraph above left the pace question
open. It is closed now, and the answer was **not** pace: the target is 99–115
points, 47.5–49% FG, 36–38% from three, and a **9:30 quarter** carries it. A
regulation game is 38 minutes. Measured on a full season: **109.8 / 48.63 /
37.21**.

Three things are worth carrying forward.

**Scoring has two levers and they are not interchangeable.** Points are
possessions times efficiency, and possessions are game-seconds over
seconds-per-possession — so slowing the game and shortening it buy the identical
points. Pace was tried first (12.5s → 15.4s) and reverted, because the two are
only equivalent on the spreadsheet. This engine draws a live animated
possession, and stretching each one by 23% to fix a season total makes every
play worse to watch in order to fix a number nobody watches. Length costs
nothing that way. Prefer it.

**Neither lever touches the percentages, so those are a separate solve.** Across
the whole quarter-length sweep (8:30 → 10:30) FG% stayed 48.2–48.5 and 3P%
36.9–37.6. That is why the shot bases had to be re-solved independently — the
clock alone left FG% at 47.0 and 3P% at 36.1, both under their floor. Three
bands at once is a two-step.

**A shorter game is not a scaled-down game.** This was the surprise, and it is
where most of the follow-on work went. Rotations do not shrink with the clock:
the team total falls 239.8 → 190.1 player-minutes (−21%) while the leading
minute-getter falls only 38.0 → 33.3 (−12%), so his share rises 15.9% → 17.5%.
Same team scoring, divided less evenly. Big individual nights therefore got
*more* common even as the league scored less, and the feat bars had to move
**up** against a falling league. Anything calibrated per-game rather than
per-minute needs re-measuring after a clock change — including
`CHARGE_TUNING.full`, since a meter that fills over a game has the game's
length baked into it.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `gameSim.js` | game loop, on-court five | **modify** — accumulate plus/minus |
| `simEnginePossession.js` | possession outcomes | **modify** — box line gains `plusMinus`; `weightedPick` gains a power |
| `simEngineBoxScore.js` | fast box-score engine, shared weight fns | **modify** — box line gains `plusMinus`; pick powers |
| `scripts/measure-identity.js` | **create** — the single measurement harness every task reads |
| `players-2026.js` | the 380 seeded players | **modify** — `makeAttributes` becomes real generation |
| `data.js` | rating scale constants | **modify** — `RATING_MIN`/`RATING_MAX` |
| `compositeRatings.js` | composites + synergy | **modify** — thresholds recalibrated to the new scale |
| `progression.js` | yearly development | **modify** — stops writing `overall`; change limits rescaled |
| `draftProspects.js` | prospect generation | **modify** — same generator as `players-2026.js` |
| `ratings.js` | **create** — the derived `overall` formula and its coefficients |
| `scripts/fit-overall.js` | **create** — one-shot regression that produces `ratings.js`'s coefficients |
| `traits.js` | hidden tendencies | **modify** — `generateTendencies` gains the amplifier |
| `godMode.js`, `commissioner.js` | rating editors | **modify** — respect the new scale and derived `overall` |
| `scripts/validate-ratings.js` | **create** — the derived-overall and scale invariants |
| `scripts/validate-identity.js` | **create** — the spread targets above, as assertions |

---

## Task 1: Plus/minus in the box score, and the measurement harness

The regression in Task 4 needs a value signal that sees defense; the box score we record today does not. ZenGM chose plus/minus per minute for exactly this reason. `gameSim.js` already tracks the on-court five and already knows the points scored on each possession, so this is an insertion, not a redesign. It also gives the box score a stat players expect to see.

The measurement harness comes with it because every later task is judged against it, and it must exist *before* the first change so the baseline is real rather than reconstructed.

**Files:**
- Modify: `simEnginePossession.js:53` (the box line factory)
- Modify: `simEngineBoxScore.js` (its own box line construction)
- Modify: `gameSim.js:206-219` (possession loop)
- Create: `scripts/measure-identity.js`
- Create: `scripts/validate-ratings.js`

**Interfaces:**
- Produces: every box-score line gains `plusMinus: number`, summing to zero across both teams within a game.
- Produces: `scripts/measure-identity.js` prints a fixed-format report and, with `--json`, writes `{shapes, threePaShare, volumeRatio, leagueRates, ovrCurve}` to stdout. Tasks 3–7 diff against it.

- [ ] **Step 1: Write the failing assertion**

Create `scripts/validate-ratings.js`:

```js
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

// Plus/minus is the value signal the derived `overall` is fitted against
// (scripts/fit-overall.js). If it does not balance, the fit is measuring noise.
function checkPlusMinusBalances() {
  const rng = makeRng(31);
  for (let i = 0; i < 12; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 9) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = gameSim.simulateGame(home.id, away.id, rng);

    const ids = { home: {}, away: {} };
    league.getTeamRoster(home.id).forEach(function (p) { ids.home[p.id] = true; });
    league.getTeamRoster(away.id).forEach(function (p) { ids.away[p.id] = true; });

    let homePm = 0, awayPm = 0, seen = 0;
    Object.keys(result.boxScore).forEach(function (id) {
      const line = result.boxScore[id];
      assert.ok(typeof line.plusMinus === 'number',
        'every box-score line needs a numeric plusMinus, missing for ' + id);
      if (line.minutes > 0) seen += 1;
      if (ids.home[id]) homePm += line.plusMinus;
      if (ids.away[id]) awayPm += line.plusMinus;
    });

    assert.ok(seen >= 10, 'at least both fives should have played, got ' + seen);
    // Five players are on the floor for every point, so the team's summed
    // plus/minus is exactly five times its margin.
    const margin = result.homeScore - result.awayScore;
    assert.strictEqual(homePm, 5 * margin,
      'home plus/minus should be 5x the margin, got ' + homePm + ' vs ' + (5 * margin));
    assert.strictEqual(awayPm, -5 * margin,
      'away plus/minus should be -5x the margin, got ' + awayPm + ' vs ' + (-5 * margin));
  }
  console.log('checkPlusMinusBalances: OK');
}

checkPlusMinusBalances();

console.log('All ratings validations passed');
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/validate-ratings.js
```

Expected: `AssertionError: every box-score line needs a numeric plusMinus, missing for bos-jayson-tatum`

- [ ] **Step 3: Add the field to both engines' box lines**

In `simEnginePossession.js`, line 53, add `plusMinus: 0` to the returned line:

```js
  return { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, energy: 1, fouls: 0, plusMinus: 0 };
```

Find the equivalent line-construction in `simEngineBoxScore.js` (grep for `fta: 0`) and add `plusMinus: 0` there too, so a box-score-engine game produces the same shape.

- [ ] **Step 4: Accumulate it in the possession loop**

In `gameSim.js`, the possession loop already computes `points` and already has `onCourt`. Immediately after the `secondsPlayed` accumulation at line 219, add:

```js
    // Five players are on the floor for every point, so each team's summed
    // plus/minus comes to exactly five times the final margin — which is what
    // scripts/validate-ratings.js asserts. Credited to the five who were on
    // the floor for THIS possession, before any substitution below.
    if (points !== 0) {
      const other = team === 'home' ? 'away' : 'home';
      const offBoxPm = team === 'home' ? homeBox : awayBox;
      const defBoxPm = team === 'home' ? awayBox : homeBox;
      onCourt[team].forEach(function (id) {
        if (offBoxPm[id]) offBoxPm[id].plusMinus += points;
      });
      onCourt[other].forEach(function (id) {
        if (defBoxPm[id]) defBoxPm[id].plusMinus -= points;
      });
    }
```

Check the surrounding code for the actual local names of the two box objects and the `team`/`other` variables — reuse whatever the loop already binds rather than introducing new names.

- [ ] **Step 5: Run it to verify it passes**

```bash
node scripts/validate-ratings.js
```

Expected: `checkPlusMinusBalances: OK` then `All ratings validations passed`

- [ ] **Step 6: Mutation-test the assertion**

Change the `-= points` to `+= points` in the step-4 block. Re-run. Expected: FAIL on the away-team assertion. Restore.

Then delete the `if (points !== 0)` guard's body entirely. Re-run. Expected: FAIL on the home-team assertion (0 vs 5×margin). Restore.

Record both in the commit message.

- [ ] **Step 7: Write the measurement harness**

Create `scripts/measure-identity.js`. It must report every row of the Target Rates table. Structure:

```js
// The single measurement every task in the ratings-and-overall plan is judged
// against. Prints a fixed-format report; `--json` emits the same numbers as
// JSON so a task can diff its before and after mechanically.
//
// This is a MEASUREMENT, not a validator: it never asserts, it only reports.
// The assertions live in scripts/validate-identity.js (Task 7).
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));

const GAMES = 300;
const SEED = 2026;

function pct(arr, p) {
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// 1. How many genuinely distinct players does the league contain? A "shape" is
// the attribute vector with the player's own mean subtracted, so two players
// who differ only in scale collapse onto the same shape. At HEAD this is 17.
function attributeShapes() {
  const seen = {};
  PLAYERS_2026.forEach(function (p) {
    const mean = ATTRIBUTE_KEYS.reduce(function (s, k) { return s + p.attributes[k]; }, 0) / ATTRIBUTE_KEYS.length;
    seen[ATTRIBUTE_KEYS.map(function (k) { return Math.round(p.attributes[k] - mean); }).join(',')] = true;
  });
  return Object.keys(seen).length;
}

// 2. What fraction of the league clears each synergy threshold? Synergy is
// meant to reward roster construction; if most of the league qualifies it
// cannot distinguish anything. At HEAD: shooter 61.6%, rebounder 70.8%.
function synergyShares() {
  const out = {};
  [['shootingThree', composite.SHOOTER_THRESHOLD],
   ['defensePerimeter', composite.DEFENDER_THRESHOLD],
   ['rebounding', composite.REBOUNDER_THRESHOLD]].forEach(function (pair) {
    const vals = PLAYERS_2026.map(function (p) { return composite.computeComposite(p, pair[0]); });
    out[pair[0]] = vals.filter(function (v) { return v >= pair[1]; }).length / vals.length;
  });
  return out;
}

// 3. Realized league rates and per-player spread over GAMES simulated games.
function simulated() {
  const rng = makeRng(SEED);
  const byId = {};
  PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
  let fgm = 0, fga = 0, tpm = 0, tpa = 0, pts = 0, g = 0;
  const acc = {};
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    g += 1;
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      fgm += l.fgm; fga += l.fga; tpm += l.tpm; tpa += l.tpa; pts += l.points;
      const q = acc[id] || (acc[id] = { g: 0, min: 0, pts: 0, fga: 0, tpa: 0, pm: 0 });
      q.g += 1; q.min += l.minutes; q.pts += l.points; q.fga += l.fga; q.tpa += l.tpa;
      q.pm += (l.plusMinus || 0);
    });
  }
  // NOTE (corrected during execution): gate on MINUTES, not on attempts.
  // Filtering by FGA and then measuring FGA spread selects on the very quantity
  // being measured and truncates the low end — the same league read 2.05x under
  // an FGA>=150 filter and 2.85x under a minutes filter. Shipped as
  // `acc[id].min >= 400`.
  const qual = Object.keys(acc).filter(function (id) { return byId[id] && acc[id].min >= 400; });
  const share = qual.map(function (id) { return 100 * acc[id].tpa / acc[id].fga; });
  const vol = qual.map(function (id) { return acc[id].fga / acc[id].min * 36; });
  return {
    games: g,
    fgPct: 100 * fgm / fga,
    tpPct: 100 * tpm / tpa,
    tpaShare: 100 * tpa / fga,
    ptsPerTeam: pts / g / 2,
    threePaP05: pct(share, 0.05), threePaP95: pct(share, 0.95),
    volumeRatio: pct(vol, 0.95) / pct(vol, 0.05),
    n: qual.length,
  };
}

const report = {
  shapes: attributeShapes(),
  synergy: synergyShares(),
  sim: simulated(),
};

if (process.argv.indexOf('--json') !== -1) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('distinct attribute shapes      ' + report.shapes + ' / ' + PLAYERS_2026.length);
  console.log('synergy qualifying share');
  Object.keys(report.synergy).forEach(function (k) {
    console.log('  ' + k.padEnd(20) + (report.synergy[k] * 100).toFixed(1) + '%');
  });
  const s = report.sim;
  console.log('league (' + s.games + ' games, n=' + s.n + ' qualified players)');
  console.log('  FG%                          ' + s.fgPct.toFixed(1));
  console.log('  3P%                          ' + s.tpPct.toFixed(1));
  console.log('  3PA share                    ' + s.tpaShare.toFixed(1) + '%');
  console.log('  pts/game/team                ' + s.ptsPerTeam.toFixed(1));
  console.log('  per-player 3PA share p05-p95 ' + s.threePaP05.toFixed(1) + '% - ' + s.threePaP95.toFixed(1) +
    '%  (' + (s.threePaP95 - s.threePaP05).toFixed(1) + ' pts)');
  console.log('  shot volume p95:p05          ' + s.volumeRatio.toFixed(2) + 'x');
}
```

`compositeRatings.js` must export its three threshold constants for this to work. Add them to its `module.exports`:

```js
    SHOOTER_THRESHOLD: SHOOTER_THRESHOLD,
    DEFENDER_THRESHOLD: DEFENDER_THRESHOLD,
    REBOUNDER_THRESHOLD: REBOUNDER_THRESHOLD,
```

- [ ] **Step 8: Record the baseline**

```bash
node scripts/measure-identity.js | tee docs/superpowers/identity-baseline.txt
```

Expected, matching the Target Rates table: 17 shapes, shooter ~61.6%, 3PA share spread ~13 pts, volume ratio ~1.4x.

**Paste the real output into the commit message.** Every later task quotes its before/after against this file.

- [ ] **Step 9: Run the full suite**

```bash
for f in scripts/validate-*.js; do node "$f" > /dev/null || echo "FAIL $f"; done
```

Expected: no FAIL lines. The goldens are untouched — plus/minus is additive and consumes no rng.

If `validate-gamesim.js` fails, the plus/minus insertion has moved the rng. It must not: it reads `points` after the possession resolves and calls nothing random. Fix the insertion, don't regenerate the golden.

- [ ] **Step 10: Commit**

```bash
git add gameSim.js simEnginePossession.js simEngineBoxScore.js compositeRatings.js scripts/validate-ratings.js scripts/measure-identity.js docs/superpowers/identity-baseline.txt docs/superpowers/plans/2026-08-08-ratings-and-overall.md
git commit -F <commit message file>
```

Use `git commit -F`, not `-m` — PowerShell mangles multi-line `-m` strings in this environment.

---

## Task 2: Real attribute generation on a true 0–100 scale

The root cause. `players-2026.js:29` builds every player as `overall + archetypeOffset[key]`, so the league has 17 distinct attribute shapes across 380 players (8 archetypes plus 9 single-player clamp artifacts), and `overall` correlates r=0.998 with the attribute mean by construction. Two players with the same overall and archetype are byte-identical.

This task replaces that with real generation while preserving every one of the ~450 hand-picked (overall, archetype) judgments — those stay exactly as authored and become the *anchor* rather than the whole story.

**Files:**
- Modify: `players-2026.js:29-37` (`makeAttributes`)
- Modify: `data.js:44-45` (`RATING_MIN`, `RATING_MAX`)
- Modify: `compositeRatings.js:48-50` (synergy thresholds)
- Modify: `draftProspects.js:32` (same generator)
- Modify: `progression.js` (change limits rescaled)
- Modify: `scripts/validate-ratings.js` (new assertions)

**Interfaces:**
- Consumes: `plusMinus` from Task 1 (not directly, but the measurement harness reports it).
- Produces: `makeAttributes(overall, archetype, playerId)` — note the new third parameter, a stable id used to seed deterministic variation. `players-2026.js` and `draftProspects.js` both call it.
- Produces: attributes distributed with mean ≈ 50 and sd ≈ 14 over [0, 100].

- [ ] **Step 1: Write the failing assertions**

Append to `scripts/validate-ratings.js`:

```js
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
const dataMod = require(path.join(__dirname, '..', 'data.js'));

// The league must contain individuals, not 8 archetypes at different scales.
// At HEAD this was 17 shapes across 380 players: two players with the same
// overall and archetype were byte-identical, which is why per-player 3PA
// share spanned only 13 points against the NBA's 67.
function checkPlayersAreIndividuals() {
  const seen = {};
  PLAYERS_2026.forEach(function (p) {
    const mean = ATTRIBUTE_KEYS.reduce(function (s, k) { return s + p.attributes[k]; }, 0) / ATTRIBUTE_KEYS.length;
    seen[ATTRIBUTE_KEYS.map(function (k) { return Math.round(p.attributes[k] - mean); }).join(',')] = true;
  });
  const shapes = Object.keys(seen).length;
  assert.ok(shapes >= PLAYERS_2026.length * 0.97,
    'attribute shapes should be nearly all distinct, got ' + shapes + ' for ' + PLAYERS_2026.length + ' players');
  console.log('checkPlayersAreIndividuals: OK (' + shapes + '/' + PLAYERS_2026.length + ' distinct)');
}

// Every downstream formula is written against a scale where 50 is average.
// At HEAD the attributes lived in 57-99, so `(composite - 50) / K` was being
// read at the wrong point on its own curve everywhere.
function checkRatingsUseTheWholeScale() {
  const all = [];
  PLAYERS_2026.forEach(function (p) {
    ATTRIBUTE_KEYS.forEach(function (k) { all.push(p.attributes[k]); });
  });
  const mean = all.reduce(function (a, b) { return a + b; }, 0) / all.length;
  const sd = Math.sqrt(all.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / all.length);
  assert.ok(mean >= 44 && mean <= 56, 'league attribute mean should be near 50, got ' + mean.toFixed(1));
  assert.ok(sd >= 11 && sd <= 18, 'league attribute sd should be 11-18, got ' + sd.toFixed(1));
  assert.ok(Math.min.apply(null, all) <= 20, 'somebody should be genuinely bad at something, min was ' + Math.min.apply(null, all));
  assert.ok(Math.max.apply(null, all) >= 90, 'somebody should be genuinely elite at something, max was ' + Math.max.apply(null, all));
  console.log('checkRatingsUseTheWholeScale: OK (mean ' + mean.toFixed(1) + ', sd ' + sd.toFixed(1) + ')');
}

// Regenerating the league twice must produce identical players, or saves and
// golden masters mean nothing.
function checkGenerationIsDeterministic() {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'players-2026.js'))];
  const second = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026;
  assert.strictEqual(second.length, PLAYERS_2026.length);
  for (let i = 0; i < second.length; i++) {
    ATTRIBUTE_KEYS.forEach(function (k) {
      assert.strictEqual(second[i].attributes[k], PLAYERS_2026[i].attributes[k],
        'regeneration changed ' + second[i].id + '.' + k);
    });
  }
  console.log('checkGenerationIsDeterministic: OK');
}

// The synergy system exists to reward roster construction. If most of the
// league qualifies for every skill it cannot distinguish anything. At HEAD:
// 61.6% shooters, 64.7% perimeter defenders, 70.8% rebounders.
function checkSynergyThresholdsAreSelective() {
  const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));
  [['shootingThree', composite.SHOOTER_THRESHOLD],
   ['defensePerimeter', composite.DEFENDER_THRESHOLD],
   ['rebounding', composite.REBOUNDER_THRESHOLD]].forEach(function (pair) {
    const vals = PLAYERS_2026.map(function (p) { return composite.computeComposite(p, pair[0]); });
    const share = vals.filter(function (v) { return v >= pair[1]; }).length / vals.length;
    assert.ok(share >= 0.10 && share <= 0.30,
      pair[0] + ' threshold selects ' + (share * 100).toFixed(1) + '% of the league, want 10-30%');
  });
  console.log('checkSynergyThresholdsAreSelective: OK');
}

checkPlayersAreIndividuals();
checkRatingsUseTheWholeScale();
checkGenerationIsDeterministic();
checkSynergyThresholdsAreSelective();
```

Move the existing final `console.log('All ratings validations passed')` to the bottom of the file.

- [ ] **Step 2: Run to confirm all four fail**

```bash
node scripts/validate-ratings.js
```

Expected: FAIL at `checkPlayersAreIndividuals` — `attribute shapes should be nearly all distinct, got 17 for 380 players`.

Comment out each check in turn to confirm the other three also fail before the fix. Expected: mean ~74.2 (not 44–56), and shooter share 61.6% (not 10–30%).

- [ ] **Step 3: Widen the rating scale**

In `data.js`, lines 44–45:

```js
const RATING_MIN = 0;
const RATING_MAX = 100;
```

- [ ] **Step 4: Replace the generator**

In `players-2026.js`, replace `makeAttributes` (lines 29–37) with:

```js
// The 450 hand-picked (overall, archetype) judgments in this file are the
// ANCHOR, not the whole player. `overall` positions him on the curve and the
// archetype gives him a shape; deterministic per-attribute variation, seeded
// from his own id, makes him an individual.
//
// Before this, attributes were literally `overall + offset`, which gave the
// league 17 distinct attribute shapes across 380 players — 8 archetypes plus
// 9 clamp artifacts. Two players with the same overall and archetype were
// byte-identical, and per-player 3PA share spanned 13 points against the real
// NBA's 67. See docs/superpowers/identity-baseline.txt.
//
// OLD_MEAN/OLD_SD are measured over the 450 authored `overall` values on the
// old 65-94 scale; SCALE_MEAN/SCALE_SD are the target distribution. OFFSET_AMP
// and JITTER_SD are calibrated by measured rate in Task 7, not picked.
const OLD_MEAN = 74.7, OLD_SD = 7.6;
const SCALE_MEAN = 50, SCALE_SD = 14;
const OFFSET_AMP = 2.4;
const JITTER_SD = 6;

// Deterministic string -> uint32, same shape as traits.js's hashId so a
// player's generated attributes are stable across sessions and saves.
function attrHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Box-Muller from a uniform rng, so the jitter is normal rather than flat —
// a flat jitter would put as many players at +2sd as at the mean.
function gauss(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function makeAttributes(overall, archetype, playerId) {
  const offsets = ARCHETYPES[archetype];
  const rng = _DATA.makeRng ? _DATA.makeRng(attrHash(playerId)) : null;
  const z = (overall - OLD_MEAN) / OLD_SD;
  const attrs = {};
  _DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    const raw = SCALE_MEAN + z * SCALE_SD
      + (offsets[key] || 0) * OFFSET_AMP
      + (rng ? gauss(rng) * JITTER_SD : 0);
    attrs[key] = Math.max(_DATA.RATING_MIN, Math.min(_DATA.RATING_MAX, Math.round(raw)));
  });
  return attrs;
}
```

`_DATA` must now also carry `makeRng`. Update the header at `players-2026.js:7-9`:

```js
var _DATA = (typeof require !== 'undefined')
  ? Object.assign({}, require('./data.js'), { makeRng: require('./rng.js').makeRng })
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, makeRng: makeRng };
```

In the browser, `rng.js` must load before `players-2026.js`. Check `index.html` and move the `<script>` tag if it does not already.

- [ ] **Step 5: Pass the id through**

In `mkPlayer` (`players-2026.js:44`), the `id` is computed before the attributes. Change the `attributes:` line to:

```js
    attributes: makeAttributes(overall, archetype, pid(teamId, name)),
```

- [ ] **Step 6: Run and read the new distribution**

```bash
node scripts/measure-identity.js
```

Expected: shapes now ≈ 380/380. The other rows will be wrong — synergy thresholds and league rates are still on the old scale. That is what Steps 7–8 fix.

- [ ] **Step 7: Recalibrate the synergy thresholds by measured rate**

The thresholds are currently 72/72/70, selecting 61.6%/64.7%/70.8% of the league — a "shooter" bonus that more than half the league earns. Sweep to find the values that select 15–25%:

```bash
node -e "
require('./data.js');require('./rng.js');
const {PLAYERS_2026}=require('./players-2026.js');
require('./traits.js').ensureHiddenPlayerData(PLAYERS_2026);
const c=require('./compositeRatings.js');
['shootingThree','defensePerimeter','defenseInterior','rebounding'].forEach(function(k){
  const v=PLAYERS_2026.map(function(p){return c.computeComposite(p,k);}).sort(function(a,b){return b-a;});
  console.log(k.padEnd(18)+'  top10% >= '+v[Math.floor(v.length*0.10)].toFixed(1)+
    '   top20% >= '+v[Math.floor(v.length*0.20)].toFixed(1)+
    '   top25% >= '+v[Math.floor(v.length*0.25)].toFixed(1));
});
"
```

Set `SHOOTER_THRESHOLD`, `DEFENDER_THRESHOLD` and `REBOUNDER_THRESHOLD` in `compositeRatings.js:48-50` to the measured top-20% values. **Record the sweep output in the commit message** — these are calibrated, not picked.

- [ ] **Step 8: Rescale progression's change limits**

`progression.js:79-98` has per-attribute `changeLimits` tuned for the old compressed scale — e.g. `speed: [-12, 2]`. On a scale that is now roughly twice as wide in sd terms, those become half as impactful in relative terms. Multiply every limit by `SCALE_SD / OLD_SD` = 14 / 7.6 ≈ 1.84, rounding to integers:

```js
  insideScoring:    { ageModifier: shootingAgeModifier,          changeLimits: [-6, 24] },
  midRange:         { ageModifier: shootingAgeModifier,          changeLimits: [-6, 24] },
  threePoint:       { ageModifier: shootingAgeModifier,          changeLimits: [-6, 24] },
  freeThrow:        { ageModifier: shootingAgeModifier,          changeLimits: [-6, 24] },
  postScoring:      { ageModifier: shootingAgeModifier,          changeLimits: [-6, 24] },
  passing:          { ageModifier: skillAgeModifier,             changeLimits: [-4, 9] },
  ballHandling:     { ageModifier: skillAgeModifier,             changeLimits: [-4, 9] },
  perimeterDefense: { ageModifier: defenseAgeModifier,           changeLimits: [-7, 15] },
  interiorDefense:  { ageModifier: defenseAgeModifier,           changeLimits: [-7, 15] },
  steal:            { ageModifier: defenseAgeModifier,           changeLimits: [-7, 15] },
  block:            { ageModifier: athleticDefenseAgeModifier,   changeLimits: [-22, 7] },
  offReb:           { ageModifier: shootingAgeModifier,          changeLimits: [-4, 9] },
  defReb:           { ageModifier: shootingAgeModifier,          changeLimits: [-4, 9] },
  speed:            { ageModifier: athleticAgeModifier,          changeLimits: [-22, 4] },
  acceleration:     { ageModifier: athleticAgeModifier,          changeLimits: [-22, 4] },
  strength:         { ageModifier: strengthAgeModifier,          changeLimits: [-6, 11] },
  vertical:         { ageModifier: athleticAgeModifier,          changeLimits: [-22, 4] },
  basketballIQ:     { ageModifier: iqAgeModifier,                changeLimits: [-6, 24] },
  leadership:       { ageModifier: iqAgeModifier,                changeLimits: [-4, 15] },
  workEthic:        { ageModifier: mentalAgeModifier,            changeLimits: [-4, 7] }
```

Then verify the resulting career arcs are still sane rather than trusting the arithmetic:

```bash
node scripts/validate-progression.js 2>/dev/null || node -e "
require('./data.js');require('./rng.js');require('./teams.js');require('./traits.js');require('./coaches.js');
const {PLAYERS_2026}=require('./players-2026.js');
require('./traits.js').ensureHiddenPlayerData(PLAYERS_2026);
const {makeRng}=require('./rng.js');const prog=require('./progression.js');
const {ATTRIBUTE_KEYS:K}=require('./data.js');
const ps=JSON.parse(JSON.stringify(PLAYERS_2026));const rng=makeRng(5);
const am=p=>K.reduce((s,k)=>s+p.attributes[k],0)/K.length;
console.log('season  league attr mean');
for(let y=0;y<=10;y++){
  if(y) ps.forEach(p=>{if(p.age<38)prog.progressPlayer(p,rng,[],{});});
  console.log(String(y).padStart(4)+'   '+(ps.reduce((s,p)=>s+am(p),0)/ps.length).toFixed(1));
}
"
```

Expected: the league mean stays within a few points of 50 across 10 seasons. If it runs away, the limits are wrong — adjust and re-measure, don't proceed.

- [ ] **Step 9: Update the other generators and editors**

`draftProspects.js:32` clamps with `RATING_MIN`/`RATING_MAX` and generates its own raw values; it must produce the same distribution as `players-2026.js` or drafted players will look alien next to veterans. Read the surrounding function and route it through the same `SCALE_MEAN`/`SCALE_SD` shape.

`godMode.js:20-23` sets `p.overall` and every attribute to `RATING_MAX`. With `RATING_MAX` now 100 this still works, but `p.overall` becomes derived in Task 3 — leave the line for now, Task 3 removes it.

- [ ] **Step 10: Run the new assertions**

```bash
node scripts/validate-ratings.js
```

Expected: all four checks OK.

- [ ] **Step 11: Mutation-test all four**

| mutation | expected failure |
|---|---|
| set `JITTER_SD = 0` | `checkPlayersAreIndividuals` — back to ~17 shapes |
| set `SCALE_MEAN = 74` | `checkRatingsUseTheWholeScale` — mean out of band |
| seed the rng from `Math.random()` instead of `attrHash(playerId)` | `checkGenerationIsDeterministic` |
| restore `SHOOTER_THRESHOLD = 72` | `checkSynergyThresholdsAreSelective` |

Run each, confirm the named check fails, restore. **Any mutation that survives means that assertion is worthless — say so and fix the assertion, don't move on.**

- [ ] **Step 12: Run the full suite and expect damage**

```bash
for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL $f"; done
```

Expected FAILs: `validate-gamesim.js` and `validate-rollover.js` (golden masters — every player changed), and likely `validate-possession.js` (league rates moved), `validate-data.js`, `validate-trades.js`, `validate-commissioner.js` (which asserts clamping to the old 25/99).

**Do not regenerate the goldens here.** Fix the non-golden failures — `validate-commissioner.js:55-58` needs its expected clamp values updated to 0/100. The goldens and the league rates are Task 7's job, after the shot-mix work has also landed, so they are regenerated exactly once.

- [ ] **Step 13: Measure and commit**

```bash
node scripts/measure-identity.js
```

Record before/after against `docs/superpowers/identity-baseline.txt` in the commit message: shapes 17 → ~380, synergy shares, and the league rates *with the note that they are not yet recalibrated*.

```bash
git add players-2026.js data.js compositeRatings.js progression.js draftProspects.js scripts/validate-ratings.js scripts/validate-commissioner.js
git commit -F <commit message file>
```

---

## Task 3: `overall` becomes derived

With Task 2 done, `overall` can no longer be the seed — the attributes are. It becomes what ZenGM's `ovr` is: a fitted summary of what the sim actually rewards, computed by regressing the 20 attributes against plus/minus per minute over a few hundred simulated games.

This also kills the drift measured at HEAD, where `progression.js:177` accumulated the change *requested* while attributes stored the change *clamped*, letting `overall` diverge from the attributes by up to 7.3 points over 12 seasons — while `minutesWeight` read `overall` and everything else read attributes.

**Files:**
- Create: `scripts/fit-overall.js` (one-shot, like `gen-gamesim-golden.js`)
- Create: `ratings.js`
- Modify: `players-2026.js` (stop storing `overall`)
- Modify: `progression.js:177-178` (stop writing `overall`)
- Modify: `godMode.js:20-21`, `commissioner.js`
- Modify: `scripts/validate-ratings.js`

**Interfaces:**
- Consumes: `plusMinus` per box line (Task 1); the new attribute distribution (Task 2).
- Produces: `ratings.js` exporting `computeOverall(player) -> number` in 0–100, and `OVERALL_COEFFICIENTS` (the fitted table). Every one of the 27 files that reads `.overall` keeps working, because `overall` becomes a getter returning `computeOverall(this)`.

- [ ] **Step 1: Write the failing assertions**

Append to `scripts/validate-ratings.js`:

```js
// `overall` must be a pure function of the attributes. At HEAD it was a stored
// field that progression updated separately, and it drifted up to 7.3 points
// away from what the attributes supported over 12 seasons — while
// simEngineBoxScore's minutesWeight read `overall` and every other weight read
// attributes, so a drifted player got star minutes with role-player skills.
function checkOverallIsDerived() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const p = PLAYERS_2026[0];
  const before = p.overall;
  const original = p.attributes.threePoint;
  p.attributes.threePoint = Math.min(100, original + 25);
  assert.notStrictEqual(p.overall, before,
    'overall must react to an attribute change; it is still a stored field');
  p.attributes.threePoint = original;
  assert.strictEqual(p.overall, before, 'overall must return to its prior value');
  assert.strictEqual(p.overall, ratings.computeOverall(p),
    'p.overall and computeOverall must agree');
  console.log('checkOverallIsDerived: OK');
}

// Progression must not be able to separate them, however many seasons run.
function checkOverallNeverDriftsFromAttributes() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  require(path.join(__dirname, '..', 'coaches.js'));
  const prog = require(path.join(__dirname, '..', 'progression.js'));
  const rng = makeRng(777);
  const players = JSON.parse(JSON.stringify(PLAYERS_2026));
  // JSON round-trip drops the getter, so re-derive through computeOverall.
  for (let y = 0; y < 12; y++) {
    players.forEach(function (p) { if (p.age < 38) prog.progressPlayer(p, rng, [], {}); });
  }
  players.forEach(function (p) {
    assert.strictEqual(p.overall, undefined,
      'progression must not write a stored overall onto ' + p.id);
  });
  console.log('checkOverallNeverDriftsFromAttributes: OK');
}

// The fit has to be worth having. Against the sim's own plus/minus per minute,
// ZenGM's ovr reaches r ~= 0.7 against real production; ours should clear 0.6
// against the sim it was fitted on or the coefficients are noise.
function checkOverallPredictsProduction() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const rng = makeRng(2026);
  const byId = {};
  PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
  const acc = {};
  for (let i = 0; i < 200; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      const q = acc[id] || (acc[id] = { min: 0, pm: 0 });
      q.min += l.minutes; q.pm += (l.plusMinus || 0);
    });
  }
  const ids = Object.keys(acc).filter(function (id) { return byId[id] && acc[id].min >= 300; });
  const x = ids.map(function (id) { return ratings.computeOverall(byId[id]); });
  const y = ids.map(function (id) { return acc[id].pm / acc[id].min; });
  const n = x.length;
  const mx = x.reduce(function (a, b) { return a + b; }, 0) / n;
  const my = y.reduce(function (a, b) { return a + b; }, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
  const r = sxy / Math.sqrt(sxx * syy);
  assert.ok(n >= 100, 'need a real sample, got ' + n);
  assert.ok(r >= 0.6, 'overall should predict plus/minus per minute, r was ' + r.toFixed(3));
  console.log('checkOverallPredictsProduction: OK (r ' + r.toFixed(3) + ', n ' + n + ')');
}

checkOverallIsDerived();
checkOverallNeverDriftsFromAttributes();
checkOverallPredictsProduction();
```

- [ ] **Step 2: Run to confirm they fail**

```bash
node scripts/validate-ratings.js
```

Expected: `Cannot find module '../ratings.js'`.

- [ ] **Step 3: Write the one-shot fitter**

Create `scripts/fit-overall.js`. It sims games, accumulates plus/minus per minute per player, solves the normal equations by Gauss-Jordan (zero dependencies — no scikit-learn available), rescales the prediction to a 0–100 distribution matching the current `overall` mean and sd, and prints a ready-to-paste `OVERALL_COEFFICIENTS` block.

```js
// One-shot generator for ratings.js's coefficients, in the same spirit as
// scripts/gen-gamesim-golden.js: run it, paste the output, commit. Re-running
// it after a deliberate change to the sim is how the fit gets updated, and
// that must be justified in the commit that does it.
//
// Method is ZenGM's (reference/zengm/analysis/player-ovr-basketball/process.py):
// regress the raw attributes against PLUS/MINUS PER MINUTE, because a box
// score cannot see defense and a formula fitted on box-score value would
// undervalue interiorDefense and perimeterDefense the way our old hand-picked
// overall did. Implemented here as normal equations solved by Gauss-Jordan,
// since this project takes no dependencies.
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));

const GAMES = 1200;      // enough that per-player plus/minus is signal, not noise
const MIN_MINUTES = 400;

function solve(A, b) {
  const n = b.length;
  const M = A.map(function (row, i) { return row.concat([b[i]]); });
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
    if (Math.abs(M[col][col]) < 1e-12) throw new Error('singular matrix at column ' + col);
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(function (row) { return row[n]; });
}

const rng = makeRng(1);
const byId = {};
PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
const acc = {};
for (let i = 0; i < GAMES; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
  if (home.id === away.id) continue;
  const r = gameSim.simulateGame(home.id, away.id, rng);
  Object.keys(r.boxScore).forEach(function (id) {
    const l = r.boxScore[id];
    const q = acc[id] || (acc[id] = { min: 0, pm: 0 });
    q.min += l.minutes; q.pm += (l.plusMinus || 0);
  });
}

const ids = Object.keys(acc).filter(function (id) { return byId[id] && acc[id].min >= MIN_MINUTES; });
console.error('fitting on ' + ids.length + ' players, ' + GAMES + ' games');

// centre each attribute so the intercept is the league-average player
const means = {};
ATTRIBUTE_KEYS.forEach(function (k) {
  means[k] = ids.reduce(function (s, id) { return s + byId[id].attributes[k]; }, 0) / ids.length;
});

const K = ATTRIBUTE_KEYS.length;
const X = ids.map(function (id) {
  return ATTRIBUTE_KEYS.map(function (k) { return byId[id].attributes[k] - means[k]; }).concat([1]);
});
const y = ids.map(function (id) { return acc[id].pm / acc[id].min; });

const A = [], b = [];
for (let i = 0; i <= K; i++) {
  A.push([]);
  for (let j = 0; j <= K; j++) {
    let s = 0;
    for (let r = 0; r < X.length; r++) s += X[r][i] * X[r][j];
    A[i].push(s);
  }
  let s2 = 0;
  for (let r = 0; r < X.length; r++) s2 += X[r][i] * y[r];
  b.push(s2);
}
const coef = solve(A, b);

// scale the raw prediction onto a 0-100 overall with the distribution the rest
// of the game already expects
const pred = X.map(function (row) {
  let s = 0;
  for (let i = 0; i <= K; i++) s += row[i] * coef[i];
  return s;
});
const pm = pred.reduce(function (a, c) { return a + c; }, 0) / pred.length;
const psd = Math.sqrt(pred.reduce(function (s, v) { return s + (v - pm) * (v - pm); }, 0) / pred.length);
const TARGET_MEAN = 55, TARGET_SD = 12;
const mult = TARGET_SD / psd;

console.log('// Fitted by scripts/fit-overall.js against ' + GAMES + ' games, ' + ids.length + ' players.');
console.log('// Re-run that script to regenerate after a deliberate sim change.');
console.log('const OVERALL_COEFFICIENTS = {');
ATTRIBUTE_KEYS.forEach(function (k, i) {
  console.log('  ' + k + ': { coef: ' + (coef[i] * mult).toFixed(5) + ', mean: ' + means[k].toFixed(1) + ' },');
});
console.log('};');
console.log('const OVERALL_INTERCEPT = ' + (TARGET_MEAN + (coef[K] - pm) * mult).toFixed(4) + ';');
```

- [ ] **Step 4: Run it and capture the output**

```bash
node scripts/fit-overall.js > /tmp_scratch_coefficients.txt
```

Use the session scratchpad path rather than `/tmp` — on Windows, Git Bash's `/tmp` and Node's `/tmp` are different directories, which has silently swallowed output in this project before.

Read the printed coefficients before pasting them. Sanity check: defensive attributes should carry real weight (that is the whole reason for using plus/minus), and no coefficient should be wildly larger than the others — if one is, the design matrix is near-singular because two attributes are collinear, which Task 2's independent jitter should have prevented.

- [ ] **Step 5: Write `ratings.js`**

```js
// `overall` is DERIVED, never stored. It is a fitted summary of what this
// sim actually rewards — the coefficients below come from regressing the 20
// attributes against plus/minus per minute over 1200 simulated games
// (scripts/fit-overall.js), which is the method ZenGM uses for its `ovr`
// (reference/zengm/analysis/player-ovr-basketball/process.py).
//
// It is deliberately NOT a hand-weighted average. A hand-weighted average is a
// guess about what the sim rewards; this is a measurement of it. The old
// stored `overall` was worse than a guess: the attributes were generated FROM
// it, so it explained itself.
var _RATINGS_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js') }
  : { data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS } };

<paste the OVERALL_COEFFICIENTS and OVERALL_INTERCEPT block from Step 4 here>

function computeOverall(player) {
  const attrs = player.attributes;
  if (!attrs) return 0;
  let v = OVERALL_INTERCEPT;
  _RATINGS_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    const c = OVERALL_COEFFICIENTS[key];
    if (c) v += c.coef * ((attrs[key] || 0) - c.mean);
  });
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Installs `overall` as a non-enumerable getter so the ~27 files that read
// `player.overall` keep working unchanged, while nothing can assign to it.
// Non-enumerable matters: JSON.stringify must not serialise it into saves, or
// a loaded save would carry a stale value that never updates again.
function defineOverall(player) {
  if (Object.getOwnPropertyDescriptor(player, 'overall') &&
      Object.getOwnPropertyDescriptor(player, 'overall').get) return player;
  delete player.overall;
  Object.defineProperty(player, 'overall', {
    get: function () { return computeOverall(this); },
    enumerable: false,
    configurable: true
  });
  return player;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OVERALL_COEFFICIENTS: OVERALL_COEFFICIENTS,
    OVERALL_INTERCEPT: OVERALL_INTERCEPT,
    computeOverall: computeOverall,
    defineOverall: defineOverall
  };
}
```

Add `<script src="ratings.js"></script>` to `index.html` after `data.js` and before `players-2026.js`.

- [ ] **Step 6: Stop storing it**

In `players-2026.js`'s `mkPlayer`, remove `overall: overall,` from the player literal and call `defineOverall` on the finished object before returning it:

```js
  return _DATA.defineOverall ? _DATA.defineOverall(player) : player;
```

adding `defineOverall` to the `_DATA` bundle the same way `makeRng` was added in Task 2. The `overall` parameter stays — it is still the anchor `makeAttributes` uses.

In `progression.js`, delete lines 177–178:

```js
  player.overall = clampRating(player.overall + avgChange);
  player.potential = Math.max(player.potential, player.overall);
```

and replace with:

```js
  // `overall` is derived from the attributes (ratings.js) — there is nothing
  // to update here. It used to be stored and updated separately, which let it
  // drift up to 7.3 points away from the attributes over 12 seasons.
  player.potential = Math.max(player.potential, _PROGRESSION_DATA.ratings.computeOverall(player));
```

Add `ratings: require('./ratings.js')` to `progression.js`'s `_PROGRESSION_DATA` bundle (and the browser branch).

`avgChange` and `changeSum` are now unused — delete them. If anything else reads them, the deletion will fail loudly, which is the point.

In `godMode.js:20-21`, delete the two `p.overall = ...` / `p.potential = ...` assignments; setting every attribute to `RATING_MAX` on the next line already produces a 100 overall. Keep `p.potential = _GODMODE_DATA.data.RATING_MAX;`.

- [ ] **Step 7: Handle save/load**

`save.js` does not reference `overall`, so serialised players simply lose the field — correct, since it is derived. But **loading** must re-install the getter, or every loaded player reports `undefined`.

Find where `save.js` rehydrates players and call `defineOverall` on each. If loading routes through a single function, one call site suffices; if not, add it wherever the roster array is rebuilt. `traits.js`'s `ensureHiddenPlayerData` runs over every player on load and is a natural place — but only if it is genuinely called on the load path. Verify by reading the load code, do not assume.

- [ ] **Step 8: Run**

```bash
node scripts/validate-ratings.js
```

Expected: all seven checks OK, with `checkOverallPredictsProduction` printing an r of roughly 0.6–0.8.

If r is below 0.6, the fit is bad. Do not lower the threshold to make it pass — that is exactly the move this project has refused before. Investigate: too few games, too high a `MIN_MINUTES`, or collinear attributes.

- [ ] **Step 9: Mutation-test**

| mutation | expected failure |
|---|---|
| restore `overall: overall,` in `mkPlayer` | `checkOverallIsDerived` — assignment wins over the getter |
| make the getter return a constant `50` | `checkOverallPredictsProduction` — r collapses |
| restore `player.overall = clampRating(...)` in progression | `checkOverallNeverDriftsFromAttributes` |
| set `enumerable: true` on the getter | no failure — **add an assertion** that `JSON.parse(JSON.stringify(p)).overall === undefined`, then re-mutate |

That last row is the point of mutation testing: a surviving mutant means a missing assertion. Add it.

- [ ] **Step 10: Full suite, then commit**

```bash
for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL $f"; done
```

The goldens still fail (expected, Task 7). Everything else must pass — pay particular attention to `validate-trades.js`, `validate-offseason.js` and `validate-careerMode.js`, which all read `.overall` heavily.

```bash
git add ratings.js players-2026.js progression.js godMode.js save.js index.html scripts/fit-overall.js scripts/validate-ratings.js
git commit -F <commit message file>
```

---

## Task 4: The shot-tendency amplifier

`traits.js:179` computes `threeTendency` as a linear share, `rawThree / (rawThree + rawMid + rawInside)`. Numerator and denominator move together, so the share barely responds. ZenGM instead pushes the composite through a piecewise map with a slope-3.5 segment — a deliberate "you are either a shooter or you are not" cliff.

**Files:**
- Modify: `traits.js:172-190`
- Modify: `scripts/validate-traits.js`

**Interfaces:**
- Consumes: the new attribute distribution (Task 2).
- Produces: `generateTendencies` returns the same keys; `threeTendency`/`midTendency`/`insideTendency` still sum to ~100.

- [ ] **Step 1: Write the failing assertion**

Append to `scripts/validate-traits.js`:

```js
// Player identity in real basketball lives in shot SELECTION, not accuracy:
// the 2025 NBA's per-player 3PA share ran 4.5% to 71.6% (67 points) while
// true 3P% talent spanned about 14. At HEAD ours spanned 13 points of share —
// the ratio was inverted. Measured from reference/zengm/data/real-player-stats.
function checkShotMixSeparatesPlayers() {
  const shares = PLAYERS_2026.map(function (p) { return p.hiddenTendencies.threeTendency; })
    .sort(function (a, b) { return a - b; });
  const p05 = shares[Math.floor(0.05 * shares.length)];
  const p95 = shares[Math.floor(0.95 * shares.length)];
  assert.ok(p95 - p05 >= 40,
    'three-point tendency should span at least 40 points p05-p95, got ' +
    p05 + '% - ' + p95 + '% (' + (p95 - p05) + ')');
  assert.ok(p05 <= 15, 'the least willing shooter in the league should be under 15%, got ' + p05);
  assert.ok(p95 >= 55, 'the most willing should be over 55%, got ' + p95);
  console.log('checkShotMixSeparatesPlayers: OK (' + p05 + '% - ' + p95 + '%)');
}

// The amplifier must not break the invariant the shot picker relies on.
function checkTendenciesStillSumToOneHundred() {
  PLAYERS_2026.forEach(function (p) {
    const t = p.hiddenTendencies;
    const sum = t.threeTendency + t.midTendency + t.insideTendency;
    assert.ok(Math.abs(sum - 100) <= 1,
      'shot tendencies must sum to ~100 for ' + p.id + ', got ' + sum);
    [t.threeTendency, t.midTendency, t.insideTendency].forEach(function (v) {
      assert.ok(v >= 0 && v <= 100, 'tendency out of range for ' + p.id + ': ' + v);
    });
  });
  console.log('checkTendenciesStillSumToOneHundred: OK');
}

checkShotMixSeparatesPlayers();
checkTendenciesStillSumToOneHundred();
```

- [ ] **Step 2: Run to confirm it fails**

```bash
node scripts/validate-traits.js
```

Expected: `three-point tendency should span at least 40 points p05-p95, got ...`

- [ ] **Step 3: Add the amplifier**

Replace the first four lines of the returned object in `traits.js:172-190`:

```js
// Shot selection is where player identity actually lives. A linear share of
// the raw attributes — which is what this used to be — barely responds,
// because the numerator and denominator move together: at HEAD, per-player
// 3PA share spanned 13 points against the real NBA's 67.
//
// amplifyShare pushes a raw share through a piecewise map with a steep middle
// segment, the same shape ZenGM uses (shootingThreePointerScaled2 in
// GameSim.basketball/index.ts): below LOW you are not a shooter and the map
// crushes you toward zero; between LOW and HIGH a small difference in skill
// swings volume hard; above HIGH you are a specialist. Breakpoints are
// calibrated by measured rate in Task 7, not picked.
const SHARE_LOW = 0.28, SHARE_HIGH = 0.38;
const SHARE_LOW_OUT = 0.06, SHARE_HIGH_OUT = 0.52;

function amplifyShare(share) {
  if (share <= 0) return 0;
  if (share < SHARE_LOW) return share * (SHARE_LOW_OUT / SHARE_LOW);
  if (share < SHARE_HIGH) {
    return SHARE_LOW_OUT +
      (share - SHARE_LOW) * ((SHARE_HIGH_OUT - SHARE_LOW_OUT) / (SHARE_HIGH - SHARE_LOW));
  }
  // above the cliff, compress so specialists do not run away to 100%
  return Math.min(0.95, SHARE_HIGH_OUT + (share - SHARE_HIGH) * 0.6);
}

function generateTendencies(player, rng) {
  const a = player.attributes;
  const rawThree = Math.max(1, a.threePoint);
  const rawMid = Math.max(1, a.midRange);
  const rawInside = Math.max(1, a.insideScoring + a.postScoring / 2);
  const shotTotal = rawThree + rawMid + rawInside;

  // Amplify the three-point share, then split what remains between mid and
  // inside in their original proportion — so a stretch big who loses volume
  // to the amplifier loses it from both other zones, not just one.
  const three = amplifyShare(rawThree / shotTotal);
  const restRaw = rawMid + rawInside;
  const mid = (1 - three) * (rawMid / restRaw);
  const inside = (1 - three) * (rawInside / restRaw);

  const t3 = Math.round(three * 100);
  const tm = Math.round(mid * 100);
  return {
    threeTendency: t3,
    midTendency: tm,
    insideTendency: 100 - t3 - tm,   // absorbs rounding so the three always sum to 100
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

- [ ] **Step 4: Calibrate the four breakpoints by measured rate**

The values above are a starting point, not a decision. Sweep `SHARE_LOW_OUT` and `SHARE_HIGH_OUT` and read the resulting league-wide realized 3PA share and per-player spread:

```bash
node scripts/measure-identity.js
```

Target from the Target Rates table: per-player 3PA share spread ≈ 48 points, league 3PA share holding near 29% (the league's identity must not shift just because individuals separated).

Run at least four combinations and put the table in the commit message. If pushing the spread to 48 drags the league share off 29%, adjust `SHARE_LOW` / `SHARE_HIGH` (which move the *centre*) rather than the outputs (which move the *ends*).

- [ ] **Step 5: Run both validators**

```bash
node scripts/validate-traits.js && node scripts/measure-identity.js
```

- [ ] **Step 6: Mutation-test**

Replace `amplifyShare(rawThree / shotTotal)` with the bare `rawThree / shotTotal`. Expected: `checkShotMixSeparatesPlayers` FAILS. Restore.

Change `insideTendency` to `Math.round(inside * 100)`. Expected: `checkTendenciesStillSumToOneHundred` fails on at least one player from rounding. Restore.

- [ ] **Step 7: Commit**

```bash
git add traits.js scripts/validate-traits.js
git commit -F <commit message file>
```

---

## Task 5: The pick-power exponent

`weightedPick` (`simEnginePossession.js:30`) normalizes linear weights, so the best scorer on the floor takes only ~1.4x the shots of the worst — against 2.9x in the real NBA. ZenGM solves this with one number per event type: `ratingArray` raises each composite to a power before normalizing, from `^1.25` for shots up to `^10` for assists and blocks, with a 5% floor so nobody is completely frozen out.

Measured from ZenGM's own constants, five players at 0.70/0.55/0.50/0.45/0.35:

| power | star share | star:worst |
|---|---|---|
| 1.25 (shots) | 29.5% | 2.4x |
| 3 (def. rebounds) | 44.6% | 8.0x |
| 5 (off. rebounds) | 59.6% | 12.3x |
| 10 (assists, blocks) | 79.3% | 17.6x |

**Files:**
- Modify: `simEnginePossession.js:30-40` and its `weightedPick` call sites
- Modify: `simEngineBoxScore.js` (same weights are shared)
- Modify: `scripts/validate-possession.js`

**Interfaces:**
- Produces: `weightedPick(players, weightFn, rng, power)` — `power` optional, defaults to 1 so existing call sites are unchanged until they opt in.

- [ ] **Step 1: Write the failing assertion**

Append to `scripts/validate-possession.js`:

```js
// One number per event type controls whether it is a star event or a
// spread-around event. At HEAD every event was effectively power 1, so the
// best scorer on the floor took 1.4x the shots of the worst against the real
// NBA's 2.9x usage spread, and our stars separated themselves by efficiency
// instead of volume — the inverse of real basketball.
function checkStarsCarryTheVolume() {
  const rng = makeRng(2026);
  const acc = {};
  for (let i = 0; i < 300; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      const q = acc[id] || (acc[id] = { min: 0, fga: 0, ast: 0, blk: 0 });
      q.min += l.minutes; q.fga += l.fga; q.ast += l.assists; q.blk += l.blocks;
    });
  }
  const qual = Object.keys(acc).filter(function (id) { return acc[id].min >= 400; });
  function spread(k) {
    const v = qual.map(function (id) { return acc[id][k] / acc[id].min * 36; })
      .sort(function (a, b) { return a - b; });
    return v[Math.floor(0.95 * v.length)] / Math.max(0.01, v[Math.floor(0.05 * v.length)]);
  }
  const shots = spread('fga');
  const assists = spread('ast');
  assert.ok(qual.length >= 100, 'need a real sample, got ' + qual.length);
  assert.ok(shots >= 2.2 && shots <= 3.2,
    'shot volume p95:p05 should be 2.2-3.2x (NBA usage is 2.9x), got ' + shots.toFixed(2));
  assert.ok(assists >= 4,
    'assists should concentrate on primary creators, p95:p05 was ' + assists.toFixed(2));
  console.log('checkStarsCarryTheVolume: OK (shots ' + shots.toFixed(2) + 'x, assists ' + assists.toFixed(2) + 'x)');
}

checkStarsCarryTheVolume();
```

- [ ] **Step 2: Run to confirm it fails**

```bash
node scripts/validate-possession.js
```

Expected: `shot volume p95:p05 should be 2.2-3.2x ..., got 1.4x` (or nearby — Tasks 2 and 4 will have moved it somewhat).

- [ ] **Step 3: Add the power to `weightedPick`**

Replace `simEnginePossession.js:30-40`:

```js
// `power` raises each weight before normalizing, which is how ZenGM controls
// whether an event concentrates on one player or spreads across the floor
// (ratingArray in GameSim.basketball/index.ts). Power 1 is a flat linear
// share; power 10 gives the best player on the floor ~79% of the events.
// PICK_FLOOR mirrors ZenGM's 5% floor so a role player is never completely
// frozen out — without it, high powers produce players who literally never
// shoot, which reads as broken rather than authentic.
const PICK_FLOOR = 0.05;

function weightedPick(players, weightFn, rng, power) {
  const p = (power === undefined) ? 1 : power;
  let weights = players.map(function (pl) { return Math.pow(Math.max(0, weightFn(pl)), p); });
  const raw = weights.reduce(function (a, b) { return a + b; }, 0);
  if (raw <= 0) return players[Math.floor(rng() * players.length)];
  const floor = PICK_FLOOR * raw;
  weights = weights.map(function (w) { return Math.max(w, floor); });
  const total = weights.reduce(function (a, b) { return a + b; }, 0);
  let r = rng() * total;
  for (let i = 0; i < players.length; i++) {
    r -= weights[i];
    if (r <= 0) return players[i];
  }
  return players[players.length - 1];
}
```

Note this consumes exactly one rng draw, as before — the golden masters will still change (the weights differ) but the rng stream stays aligned, which keeps the diff interpretable.

- [ ] **Step 4: Set a power per event**

Add the table near the top of `simEnginePossession.js`:

```js
// One number per event, calibrated in Task 7 against the measured spread each
// produces. ZenGM's equivalents: usage 1.25, turnovers 2, defensive rebounds
// 3, steals 4, offensive rebounds 5, assists 10, blocks 10.
const PICK_POWER = {
  handler: 2.5,     // who brings it up
  shooter: 2.2,     // who takes the shot  -> target ~2.5x volume spread
  passer: 6,        // who gets the assist -> a recognisable primary creator
  onBallDefender: 2,
  shotDefender: 2,
  blocker: 6,
  rebounder: 3
};
```

Then pass the right power at each `weightedPick` call site. The shooter pick at `simEnginePossession.js:222` becomes:

```js
  const shooter = weightedPick(offense, energyAware(_POSS_DATA.box.scoringWeight, offenseBox, false), rng, PICK_POWER.shooter);
```

Do the same for the handler, on-ball defender, shot defender, and every rebound/assist/block pick. Grep for `weightedPick(` and cover all of them — a missed call site is a silent revert of this task for that event.

Apply the same treatment to the equivalent picks in `simEngineBoxScore.js`, so the fast engine and the possession engine agree on who does what.

- [ ] **Step 5: Calibrate the powers by measured rate**

Sweep `PICK_POWER.shooter` over at least 1.5 / 2.0 / 2.5 / 3.0 and read the volume spread each produces:

```bash
node scripts/measure-identity.js
```

Pick the value that lands the spread at ~2.5x. Do the same for `passer` against the assist spread. **Put the sweep table in the commit message.**

Watch for a side effect: concentrating shots on better shooters raises league FG%. Record it; Task 7 corrects it.

- [ ] **Step 6: Run and mutation-test**

```bash
node scripts/validate-possession.js
```

Mutations: set `PICK_POWER.shooter = 1` (expect the shots assertion to fail); set `PICK_FLOOR = 0` and check whether any qualified player ends with zero FGA (if the floor is doing nothing, either the powers are too low to need it or the assertion for it is missing — add one).

- [ ] **Step 7: Commit**

```bash
git add simEnginePossession.js simEngineBoxScore.js scripts/validate-possession.js
git commit -F <commit message file>
```

---

## Task 6: Recalibrate the make probabilities to the new scale

`shotMakeProbability` (`simEnginePossession.js:150-158`) is written as `base + (composite - 50) / 250`. Every one of those constants was tuned when composites averaged ~72 on a 57–99 attribute scale. After Task 2 the average composite is ~50, so the offense's inflation is gone — but so is the defense's, and the two used to cancel. Tasks 4 and 5 then moved league FG% again by concentrating shots on better shooters.

This task re-derives those constants against the measured distribution rather than patching them.

**Files:**
- Modify: `simEnginePossession.js:150-158` and the turnover/block probabilities nearby
- Modify: `scripts/validate-possession.js`

- [ ] **Step 1: Measure where the league actually sits**

```bash
node scripts/measure-identity.js
```

Record FG%, 3P%, 3PA share and pts/game/team. Compare against the Target Rates table.

- [ ] **Step 2: Re-derive the constants**

For each zone, the divisor sets how much of the composite spread reaches the scoreboard and the base sets the league level. With composites now centred on 50 with sd ≈ 12 (verify — do not assume), a divisor `D` gives a p05→p95 make-probability spread of about `2 * 1.65 * 12 / D`.

Target spreads, from the earlier three-way measurement: about 13 points of true 3P% talent, 14 points at the rim. So `D ≈ 2 * 1.65 * 12 / 0.13 ≈ 305` for threes.

Set the bases so the league lands on target:

```js
function shotMakeProbability(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult) {
  // Bases and divisors re-derived in Task 6 of the ratings-and-overall plan.
  // The old values (0.36/0.42/0.56 over /250 and /350) were tuned when
  // composites averaged ~72 on a 57-99 attribute scale; after the rescale the
  // average composite is ~50, so both the offensive inflation and the
  // defensive one that used to cancel it are gone. Divisors are set from the
  // measured composite sd so the realized talent spread matches the ~13-14
  // points the real NBA shows; bases are then set by measured league rate.
  let base, shootComposite, defComposite, skillDiv, defDiv;
  if (zone === 'three') {
    base = <measured>; skillDiv = <measured>; defDiv = <measured>;
    shootComposite = _POSS_DATA.composite.computeComposite(shooter, 'shootingThree');
    defComposite = _POSS_DATA.composite.computeComposite(defender, 'defensePerimeter');
  } else if (zone === 'mid') {
    ...
  } else {
    ...
  }
  const skillAdj = (shootComposite - 50) / skillDiv * (shooterEnergyMult !== undefined ? shooterEnergyMult : 1);
  const defAdj = (defComposite - 50) / defDiv * (defenderEnergyMult !== undefined ? defenderEnergyMult : 1);
  const synergyAdj = (offenseSynergy || 1) - (defenseSynergy || 1);
  return Math.max(0.18, Math.min(0.72, base + skillAdj - defAdj + synergyAdj));
}
```

Fill each `<measured>` from a sweep. **Do not guess them** — run `scripts/measure-identity.js` after each candidate and record the table.

Also revisit `turnoverChance` (`simEnginePossession.js:~205`), which divides an attribute difference by 400, and `blockChance`, which uses `(block - 50) / 900`. Both were tuned on the old scale; re-derive both against measured league turnover and block rates.

- [ ] **Step 3: Verify the league lands in the target band**

```bash
node scripts/measure-identity.js
node scripts/validate-possession.js
```

Every row of the Target Rates table must now be inside its band. `validate-possession.js`'s existing distribution check (score bounds, 2% outlier budget, median 90–125) must pass without being widened. **If a bound has to move to make this pass, that is a signal the calibration is wrong, not the bound** — this project has previously refused to widen a floor to make a change pass, and measured that the change had actually improved the percentile it appeared to break.

- [ ] **Step 4: Commit**

```bash
git add simEnginePossession.js scripts/validate-possession.js
git commit -F <commit message file>
```

---

## Task 7: Lock the targets, regenerate the goldens, full verification

**Files:**
- Create: `scripts/validate-identity.js`
- Modify: `scripts/fixtures/gamesim-golden.json`, `scripts/fixtures/rollover-golden.json`
- Modify: `ui/roster.js` (rating colour bands — the plan also listed `ui/playerProfile.js`, which has none)

- [ ] **Step 1: Turn the Target Rates table into assertions**

Create `scripts/validate-identity.js` asserting every row of the table, each with a band rather than an exact value, and each carrying a comment naming the real-NBA number it is anchored to. Reuse `scripts/measure-identity.js`'s functions by requiring it — refactor it to export them rather than duplicating the logic.

- [ ] **Step 2: Mutation-test the whole file**

For each assertion, revert the specific change that satisfies it (the amplifier, the shooter power, a divisor) and confirm that assertion — and ideally only that one — fails. Record the matrix in the commit message.

- [ ] **Step 3: Fix the UI rating bands**

`ui/roster.js` colours ratings on the assumption that ~75 is average and ~90 is elite. On the new scale 50 is average and 80 is elite.

*(As executed: only `ui/roster.js` has rating bands — a single `ratingTier`
function every other screen calls. `ui/playerProfile.js` has none. The
thresholds were converted by z-score rather than re-picked: the old cuts sat at
+2.02/+0.70/-0.61 standard deviations on a mean-74.7 sd-7.6 distribution, which
against the derived overall (mean 47.8, sd 9.9) is 68/55/42 — preserving the
same slices of the league rather than the same literal numbers. Left at 90/80/70
nothing would ever be gold again, because the best player in the league is a
78.)*

- [ ] **Step 4: Regenerate both golden masters — once**

```bash
node scripts/gen-gamesim-golden.js
node scripts/gen-rollover-golden.js
```

The commit that does this must justify it with the measured before/after league rates from `docs/superpowers/identity-baseline.txt`. This is the only permitted regeneration in the whole plan.

- [ ] **Step 5: Full suite from a fresh clone**

```bash
node scripts/measure-identity.js | tee docs/superpowers/identity-after.txt
for f in scripts/validate-*.js; do node "$f" > /dev/null || echo "FAIL $f"; done
```

Then verify in isolation, because the working tree can hide a missing file or a stale require:

```bash
git clone --local . <scratchpad>/verify-clone && cd <scratchpad>/verify-clone && for f in scripts/validate-*.js; do node "$f" > /dev/null || echo "FAIL $f"; done
```

Expected: all 40 validators pass in the clone. Anything that passes in the working tree but fails in the clone is an uncommitted file.

- [ ] **Step 6: Browser verification**

Start the no-store threaded server on a fresh port (a reused port serves stale JS in this project), load the league, and check:

- A star's player profile shows plausible ratings on the new scale.
- Two players of the same archetype and similar overall now have visibly different attribute bars — the whole point of the plan.
- A live game runs to completion with no console errors, and the play-by-play shows the star taking visibly more shots than the bench.
- The box score shows a plus/minus column that sums to five times the margin.

Take a screenshot of a roster page and a live game and share both.

- [ ] **Step 7: Final commit**

```bash
git add scripts/validate-identity.js scripts/measure-identity.js scripts/fixtures/gamesim-golden.json scripts/fixtures/rollover-golden.json docs/superpowers/identity-after.txt ui/roster.js
git commit -F <commit message file>
```

---

## Self-Review

**Spec coverage.** Both halves of the request are covered: `overall` in Task 3 (derived by regression, drift eliminated) and attributes in Task 2 (real generation, true 0–100 scale). The three approved decisions are honoured — plus/minus regression (Tasks 1 and 3), full rescale rather than recentring (Task 2), and "most of the way" identity targets rather than exact NBA (the Target Rates table: 2.5x volume and ~48 points of 3PA spread against the NBA's 2.9x and 67).

**Ordering.** Task 1 must come first: the regression in Task 3 needs plus/minus, and every later task needs the baseline. Task 2 must precede Task 3 because fitting `overall` against attributes that are about to be regenerated would mean fitting twice. Tasks 4 and 5 are independent of each other and could swap. Task 6 must follow both, because both move league FG%. Task 7 is last because the goldens should be regenerated exactly once.

**Known gaps, stated rather than hidden.**

- Task 3, Step 7 (save/load rehydration) says to read `save.js`'s load path rather than giving the exact edit. I could not determine from the current reading whether loading routes through a single function. This is the one place in the plan that requires investigation at execution time rather than following a written edit.
- `draftProspects.js` (Task 2, Step 9) is described directionally rather than with exact code, for the same reason — its generator needs reading first.
- The numeric constants in Tasks 4, 5 and 6 are deliberately left as starting points with a calibration step attached. That is not a placeholder: writing exact final values here would be picking them, which the project's own scar tissue says produces the wrong number. Each has a defined target, a defined measurement, and a requirement to record the sweep.

**Risk.** Task 2 is by far the largest and touches the most-loaded data file in the project. If it goes badly, it reverts cleanly on its own — Task 1 is independently valuable (plus/minus is a stat worth having regardless) and nothing before Task 2 depends on it.

---

## Post-execution review

How the self-review above held up, written after the work shipped.

**The three flagged gaps all resolved, and one was the wrong worry.** `save.js`
did route through a single restore point, so Task 3 Step 7 was a two-line edit.
`draftProspects.js` needed more than expected — it had its own duplicate
generator, which now shares `players-2026.js`'s (the archetype offsets stay
duplicated so prospect and veteran tuning can diverge; the SCALE cannot). The
"deliberately uncalibrated constants" call was correct: every one of them moved
when swept, several by more than a factor of two.

**The risk assessment was wrong about which task was dangerous.** Task 2 was
large but landed cleanly. The damage came from Task 3, which nothing here
flagged as risky: making `overall` a derived getter broke six assignment sites
silently (a getter with no setter is a no-op in sloppy mode), and moved
overall's mean far enough to break `minutesWeight` in a way no validator
noticed until a later audit. Size was the wrong proxy for risk; **the dangerous
change was the one that altered the meaning of a value 27 other files read.**

**What the plan should have contained and did not.** An assertion that values
DOWNSTREAM of a rescaled quantity still have a usable range. The plan carefully
recalibrated `shotMakeProbability`, `turnoverChance` and `blockChance` because
it knew they read `attribute - 50` — but it enumerated those by hand, and
`minutesWeight` (`overall - 40`) and `ftPct` (`freeThrow / 105`) were not on the
list. Two of the three were caught during execution by rates going visibly
wrong; the third survived to production.

The generalisable rule, for the next plan that moves a scale: **grep for every
hard-coded constant that is compared against or subtracted from the quantity
you are rescaling, and assert a range invariant on each — do not enumerate them
from memory.**

**Also corrected during execution:** eight pre-existing test bugs the rescale
exposed rather than caused, including four validators that modelled a player as
`{ overall: N, attributes: {} }` and measured deltas that were structurally
always zero, and three fixtures whose seed or sample size made them pass by
luck. Those are catalogued in the commits for `c745d07`, `ba0c3cd` and
`87a89ef`.
