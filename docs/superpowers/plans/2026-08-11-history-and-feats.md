# Feats, History Toys and Family Trees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn history the game already produces into stories — a permanent
league-wide feat log, fifteen history superlatives, and player family lines.

**Architecture:** Three new root modules (`feats.js`, `historyToys.js`,
`relatives.js`), each pure and independently testable, storing into
`LEAGUE_HISTORY` (which already saves and loads whole). Detection hooks the one
function every finished game passes through; every toy is a standalone ranked
query; families are generated only for new draft classes.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Every root
module carries the dual `require`/browser-global bridge. Node validators under
`scripts/`, browser smoke via `scripts/ui-smoke.js`.

## Global Constraints

- **Zero dependencies.** No packages, no build step.
- **Dual bridge on every root module.** `var _X_DATA = (typeof require !== 'undefined') ? {...requires...} : {...bare globals...};` — `scripts/validate-browserBridges.js` fails the build if the browser branch misses a member the source uses.
- **Top-level `const` is NOT a window property** in a classic script; `function` declarations are. Anything the browser must reach across files is a `function` or is exported through a bridge.
- **`git add` explicit paths. Never `git add -A`.**
- **Commit BEFORE mutation testing.** `git checkout --` restores to HEAD, not to uncommitted work.
- **Every new assertion is mutation-tested.** A surviving mutant means the assertion is worthless OR the code is dead — say which.
- **Thresholds are set by measured rate, never picked.** Record the sweep in the commit message.
- **Never widen a bound to make a change pass.** Move the value, not the bound.
- **Both golden masters must stay unmoved.** `scripts/validate-gamesim.js` and `scripts/validate-seasonRollover.js`. Nothing here changes simulation.
- **Use `git commit -F <file>`** for multi-line messages (PowerShell mangles `-m`).
- Full suite: `for f in scripts/validate-*.js; do node "$f" || echo "FAILED: $f"; done` — currently 50 files, all passing.

## File Structure

| File | Responsibility |
|---|---|
| `feats.js` (create) | Pure feat detection + threshold constants. No storage, no globals. |
| `historyToys.js` (create) | One exported function per toy, each returning a ranked array. Pure reads. |
| `relatives.js` (create) | Family link data shape, both-direction linking, generation, queries. |
| `ui/feats.js` (create) | The Feats page. |
| `league.js` (modify) | `recordGameResult` gains context; calls feat detection and files results. |
| `playoffs.js` (modify) | Two call sites pass the new context. |
| `history.js` (modify) | `LEAGUE_HISTORY.feats` / `.teamSeasons` init; `teamSeasons` written at season end. |
| `draftProspects.js` (modify) | Prospect classes may contain sons and brothers. |
| `ui/frivolities.js` (modify) | Becomes an index of toys above the existing glance panels. |
| `ui/playerProfile.js` (modify) | Shows relatives and that player's feats. |
| `ui/nav.js`, `script.js`, `index.html` (modify) | Register the Feats view and load the new modules. |
| `scripts/probe-feats.js` (create) | Measures feat rates so the bars are chosen, not guessed. |
| `scripts/validate-feats.js` (create) | Detection, rates in band, storage cost, call-site guard. |
| `scripts/validate-historyToys.js` (create) | Each toy against a constructed history with a known answer. |
| `scripts/validate-relatives.js` (create) | Link invariants, timeline rule, generation rate in band. |

---

# FEATURE 1 — FEATS

### Task 1: Pure feat detection

**Files:**
- Create: `feats.js`
- Create: `scripts/validate-feats.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `feats.detectFeats(line, context)` → array of feat records. `line` is a box-score line (`{points, rebounds, assists, steals, blocks, ...}`). `context` is `{leagueYear, day, playerId, playerName, teamId, oppTeamId}`. Each record is `{leagueYear, day, playerId, playerName, teamId, oppTeamId, kind, points, rebounds, assists, steals, blocks}`. `kind` is one of `'bigScoring' | 'hugeScoring' | 'tripleDouble' | 'fiveByFive'`. Also produces `feats.FEAT_TUNING` (mutable holder) and `feats.FEAT_KINDS` (array of the four kind strings).

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-feats.js`:

```js
// Feats are detected from a box-score line and nothing else, so every
// threshold is testable directly without simulating a game.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const feats = require(path.join(ROOT, 'feats.js'));

const CTX = { leagueYear: 2026, day: 12, playerId: 'p1', playerName: 'Test Player', teamId: 'BOS', oppTeamId: 'LAL' };

function line(over) {
  return Object.assign({ points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0 }, over);
}
function kinds(l) {
  return feats.detectFeats(l, CTX).map(function (f) { return f.kind; }).sort();
}

function checkTripleDouble() {
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: 10, assists: 10 })), ['tripleDouble']);
  // Two categories is not a triple-double.
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: 10, assists: 9 })), []);
  // Steals and blocks count toward it, not just the classic three.
  assert.deepStrictEqual(kinds(line({ points: 10, rebounds: 10, blocks: 10 })), ['tripleDouble']);
  console.log('checkTripleDouble: OK');
}

function checkFiveByFive() {
  const l = line({ points: 5, rebounds: 5, assists: 5, steals: 5, blocks: 5 });
  assert.ok(kinds(l).indexOf('fiveByFive') !== -1, 'all five at 5 is a five-by-five');
  // One short in a single category is not.
  const short = line({ points: 5, rebounds: 5, assists: 5, steals: 5, blocks: 4 });
  assert.strictEqual(kinds(short).indexOf('fiveByFive'), -1);
  console.log('checkFiveByFive: OK');
}

function checkScoringBoundaries() {
  const big = feats.FEAT_TUNING.bigScoring;
  assert.ok(kinds(line({ points: big })).indexOf('bigScoring') !== -1, 'exactly at the bar counts');
  assert.strictEqual(kinds(line({ points: big - 1 })).indexOf('bigScoring'), -1, 'one under does not');
  const huge = feats.FEAT_TUNING.hugeScoring;
  assert.ok(huge > big, 'the huge bar must be above the big one');
  const h = kinds(line({ points: huge }));
  assert.ok(h.indexOf('hugeScoring') !== -1, 'exactly at the huge bar counts');
  assert.ok(h.indexOf('bigScoring') === -1, 'a huge night reports as huge only, not both');
  console.log('checkScoringBoundaries: OK');
}

function checkRecordCarriesContext() {
  const out = feats.detectFeats(line({ points: 30, rebounds: 10, assists: 10 }), CTX);
  assert.strictEqual(out.length, 1);
  const f = out[0];
  ['leagueYear', 'day', 'playerId', 'playerName', 'teamId', 'oppTeamId'].forEach(function (k) {
    assert.strictEqual(f[k], CTX[k], k + ' must be carried onto the record');
  });
  assert.strictEqual(f.points, 30);
  assert.strictEqual(f.rebounds, 10);
  assert.strictEqual(f.assists, 10);
  console.log('checkRecordCarriesContext: OK');
}

function checkEmptyLineProducesNothing() {
  assert.deepStrictEqual(feats.detectFeats(line({}), CTX), []);
  assert.deepStrictEqual(feats.detectFeats(null, CTX), []);
  console.log('checkEmptyLineProducesNothing: OK');
}

checkTripleDouble();
checkFiveByFive();
checkScoringBoundaries();
checkRecordCarriesContext();
checkEmptyLineProducesNothing();
console.log('All feat validations passed');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/validate-feats.js`
Expected: FAIL — `Cannot find module '.../feats.js'`

- [ ] **Step 3: Write `feats.js`**

```js
// Single-game feats: the moments worth remembering, detected from one
// box-score line and nothing else.
//
// Pure by design. Detection takes a line and a context and returns records; it
// reads no globals, opens no storage and knows no dates. That is what lets
// every threshold be tested directly instead of by simulating games until one
// happens to fire.
//
// The bars in FEAT_TUNING are placeholders until Task 2 measures them. They are
// a mutable holder rather than bare consts so the calibration probe can move
// them for one run without editing committed source — the same shape as
// freeAgency.js's RESIGN_TUNING and seasonTransition.js's RETIREMENT_TUNING.
var FEAT_TUNING = { bigScoring: 50, hugeScoring: 60, doubleAt: 10, fiveAt: 5 };

const FEAT_KINDS = ['bigScoring', 'hugeScoring', 'tripleDouble', 'fiveByFive'];

// The five categories a double or a five counts across.
const FEAT_CATEGORIES = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

function featCategoryCount(line, bar) {
  return FEAT_CATEGORIES.reduce(function (n, key) {
    return (line[key] || 0) >= bar ? n + 1 : n;
  }, 0);
}

function makeFeat(kind, line, context) {
  return {
    leagueYear: context.leagueYear,
    day: context.day,
    playerId: context.playerId,
    playerName: context.playerName,
    teamId: context.teamId,
    oppTeamId: context.oppTeamId,
    kind: kind,
    points: line.points || 0,
    rebounds: line.rebounds || 0,
    assists: line.assists || 0,
    steals: line.steals || 0,
    blocks: line.blocks || 0
  };
}

// Zero or more feats for one line. A huge scoring night reports ONLY as huge:
// listing it as both would double-count it in every rate measurement and make
// the page read as though the player did two remarkable things.
function detectFeats(line, context) {
  if (!line) return [];
  const out = [];
  const points = line.points || 0;

  if (points >= FEAT_TUNING.hugeScoring) {
    out.push(makeFeat('hugeScoring', line, context));
  } else if (points >= FEAT_TUNING.bigScoring) {
    out.push(makeFeat('bigScoring', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.doubleAt) >= 3) {
    out.push(makeFeat('tripleDouble', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.fiveAt) === FEAT_CATEGORIES.length) {
    out.push(makeFeat('fiveByFive', line, context));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectFeats: detectFeats,
    featCategoryCount: featCategoryCount,
    FEAT_TUNING: FEAT_TUNING,
    FEAT_KINDS: FEAT_KINDS,
    FEAT_CATEGORIES: FEAT_CATEGORIES
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node scripts/validate-feats.js`
Expected: PASS — five OK lines then `All feat validations passed`

- [ ] **Step 5: Commit**

```bash
git add feats.js scripts/validate-feats.js
git commit -m "feat: pure single-game feat detection"
```

---

### Task 2: Calibrate the bars by measurement

**Files:**
- Create: `scripts/probe-feats.js`
- Modify: `feats.js` (the four numbers in `FEAT_TUNING`)
- Modify: `scripts/validate-feats.js` (add the rate-band assertion)

**Interfaces:**
- Consumes: `feats.detectFeats(line, context)`, `feats.FEAT_TUNING` from Task 1.
- Produces: calibrated `FEAT_TUNING` values, and `scripts/probe-feats.js` reporting per-season league-wide rates for a range of candidate bars.

- [ ] **Step 1: Write the probe**

Create `scripts/probe-feats.js`:

```js
// What bar makes a feat rare enough to mean something?
//
// Our league scores ~135 a team, so basketball's traditional 50-point night is
// far less remarkable here than it is in a 115-point league. The bars are
// therefore chosen from measured rates, not from tradition. Reports how often
// each candidate would fire, league-wide, per season.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');
const feats = rq('feats.js');

const GAMES = Number(process.env.GAMES || 400);
// A full league season is 30 teams x 82 games / 2.
const GAMES_PER_SEASON = 1230;

const rng = makeRng(Number(process.env.SEED || 4242));
const lines = [];
for (let i = 0; i < GAMES; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 7) % TEAMS.length];
  if (home.id === away.id) continue;
  const r = gameSim.simulateGame(home.id, away.id, rng);
  Object.keys(r.boxScore).forEach(function (id) { lines.push(r.boxScore[id]); });
}
const gamesSimmed = GAMES;
const scale = GAMES_PER_SEASON / gamesSimmed;

function perSeason(count) { return count * scale; }

console.log('sampled ' + gamesSimmed + ' games, ' + lines.length + ' player-lines');
console.log('rates below are LEAGUE-WIDE PER SEASON (' + GAMES_PER_SEASON + ' games)');
console.log('');
console.log('points bar   nights at or above');
[40, 45, 50, 55, 60, 65, 70, 75, 80].forEach(function (bar) {
  const n = lines.filter(function (l) { return (l.points || 0) >= bar; }).length;
  console.log('  ' + String(bar).padStart(3) + '        ' + perSeason(n).toFixed(1).padStart(8));
});
console.log('');
['tripleDouble', 'fiveByFive'].forEach(function (kind) {
  const bar = kind === 'tripleDouble' ? feats.FEAT_TUNING.doubleAt : feats.FEAT_TUNING.fiveAt;
  const need = kind === 'tripleDouble' ? 3 : feats.FEAT_CATEGORIES.length;
  const n = lines.filter(function (l) { return feats.featCategoryCount(l, bar) >= need; }).length;
  console.log(kind + ' (at ' + bar + '+): ' + perSeason(n).toFixed(1) + ' per season');
});
```

- [ ] **Step 2: Run it and read the rates**

Run: `GAMES=400 node scripts/probe-feats.js`
Expected: a points-bar table and two lines for triple-doubles and five-by-fives.
No assertion — this step is a measurement.

- [ ] **Step 3: Set the bars from the measurement**

Edit `feats.js`. Replace the `FEAT_TUNING` line and its comment with the chosen
values and the recorded table. Pick `bigScoring` as the lowest bar whose measured
rate lands inside **15–40 per season**, and `hugeScoring` as the lowest bar
inside **1–6 per season**. Leave `doubleAt: 10` and `fiveAt: 5` unless the
measured triple-double rate falls outside **40–120** or the five-by-five rate
outside **0–3**, in which case raise the relevant bar by 1 and re-measure.

Write the comment in this shape, substituting the real numbers:

```js
// Chosen by measured rate, not tradition. scripts/probe-feats.js over 400 games,
// scaled to a 1230-game season, nights at or above each points bar:
//
//   40 -> <n>    50 -> <n>    60 -> <n>    70 -> <n>
//   45 -> <n>    55 -> <n>    65 -> <n>    75 -> <n>
//
// Target bands: big 15-40 a season, huge 1-6, triple-double 40-120,
// five-by-five 0-3. Our league scores ~135 a team, so the traditional 50-point
// night is NOT rare here and the bar lands well above it.
var FEAT_TUNING = { bigScoring: <n>, hugeScoring: <n>, doubleAt: 10, fiveAt: 5 };
```

- [ ] **Step 4: Add the rate-band assertion to the validator**

Append to `scripts/validate-feats.js`, before the final `console.log`:

```js
// The BANDS are the specification, not the bar values. If scoring pace moves
// again, this fails rather than quietly making feats commonplace.
const TARGET_RATES = {
  bigScoring: [15, 40],
  hugeScoring: [1, 6],
  tripleDouble: [40, 120],
  fiveByFive: [0, 3]
};

function checkRatesAreInBand() {
  const rq2 = function (f) { return require(path.join(ROOT, f)); };
  rq2('data.js'); rq2('rng.js');
  const TEAMS = rq2('teams.js').TEAMS;
  const traits = rq2('traits.js');
  rq2('scouting.js');
  const PLAYERS = rq2('players-2026.js').PLAYERS_2026;
  traits.ensureHiddenPlayerData(PLAYERS);
  const makeRng = rq2('rng.js').makeRng;
  rq2('simEngine.js'); rq2('simEngineBoxScore.js'); rq2('simEnginePossession.js');
  rq2('gameCoach.js');
  const gameSim = rq2('gameSim.js');

  const GAMES = 200, GAMES_PER_SEASON = 1230;
  const rng = makeRng(31337);
  const counts = { bigScoring: 0, hugeScoring: 0, tripleDouble: 0, fiveByFive: 0 };
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length], away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    Object.keys(r.boxScore).forEach(function (id) {
      feats.detectFeats(r.boxScore[id], CTX).forEach(function (f) { counts[f.kind] += 1; });
    });
  }
  const scale = GAMES_PER_SEASON / GAMES;
  feats.FEAT_KINDS.forEach(function (kind) {
    const rate = counts[kind] * scale;
    const band = TARGET_RATES[kind];
    assert.ok(rate >= band[0] && rate <= band[1],
      kind + ' fires ' + rate.toFixed(1) + ' times a season, outside the ' +
      band[0] + '-' + band[1] + ' target band');
  });
  console.log('checkRatesAreInBand: OK (' + feats.FEAT_KINDS.map(function (k) {
    return k + ' ' + (counts[k] * scale).toFixed(1);
  }).join(', ') + ')');
}

checkRatesAreInBand();
```

- [ ] **Step 5: Run the validator**

Run: `node scripts/validate-feats.js`
Expected: PASS including `checkRatesAreInBand: OK (...)`. If a band fails, adjust
the bar in `feats.js` — **do not widen the band**.

- [ ] **Step 6: Commit**

```bash
git add feats.js scripts/probe-feats.js scripts/validate-feats.js
git commit -F <message file recording the full measured table and the chosen bars>
```

---

### Task 3: File feats from every finished game

**Files:**
- Modify: `history.js` (`LEAGUE_HISTORY` init, add `recordFeats`)
- Modify: `league.js:44` (`recordGameResult` signature and body), `league.js:133` (call site)
- Modify: `playoffs.js:75`, `playoffs.js:232` (two call sites)
- Modify: `index.html` (load `feats.js`)
- Modify: `scripts/validate-feats.js` (call-site guard + integration case)

**Interfaces:**
- Consumes: `feats.detectFeats(line, context)` from Task 1.
- Produces: `LEAGUE_HISTORY.feats` (array of feat records) and
  `history.recordFeats(featRecords)` which appends them. `recordGameResult(game, context)` where `context` is `{leagueYear, day}`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-feats.js`, before the final `console.log`:

```js
// Feats must be filed from EVERY finished game, and the three call sites of
// recordGameResult must all pass the context the record needs. A rule reaching
// one call site and not its siblings is the single most repeated defect in this
// codebase — see validate-userPathRules.js for the same guard on the offseason.
function checkAllCallSitesPassContext() {
  const fs = require('fs');
  function callArgs(file, name) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const out = [];
    let i = 0;
    while ((i = src.indexOf(name + '(', i)) !== -1) {
      const before = src.slice(Math.max(0, i - 9), i);
      if (!/function\s*$/.test(before)) {
        const open = src.indexOf('(', i + name.length - 1);
        let depth = 0;
        for (let j = open; j < src.length; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')') { depth--; if (depth === 0) { out.push(src.slice(open + 1, j)); break; } }
        }
      }
      i += name.length;
    }
    return out;
  }
  const sites = callArgs('league.js', 'recordGameResult')
    .concat(callArgs('playoffs.js', '_PLAYOFF_DATA.league.recordGameResult'));
  assert.strictEqual(sites.length, 3,
    'expected exactly 3 recordGameResult call sites, found ' + sites.length);
  sites.forEach(function (args) {
    assert.ok(args.split(',').length >= 2,
      'recordGameResult called with one argument — feats need {leagueYear, day}: (' + args.trim() + ')');
  });
  console.log('checkAllCallSitesPassContext: OK (3 sites)');
}

function checkFeatsAreFiledFromRealGames() {
  const rq3 = function (f) { return require(path.join(ROOT, f)); };
  const history = rq3('history.js');
  const league = rq3('league.js');
  const TEAMS = rq3('teams.js').TEAMS;
  const makeRng = rq3('rng.js').makeRng;
  const gameSim = rq3('gameSim.js');

  history.LEAGUE_HISTORY.feats.length = 0;
  const rng = makeRng(7);
  for (let i = 0; i < 120; i++) {
    const home = TEAMS[i % TEAMS.length], away = TEAMS[(i + 5) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = gameSim.simulateGame(home.id, away.id, rng);
    const game = {
      homeTeamId: home.id, awayTeamId: away.id,
      homeScore: result.homeScore, awayScore: result.awayScore,
      boxScore: result.boxScore
    };
    league.recordGameResult(game, { leagueYear: 2026, day: i });
  }
  const filed = history.LEAGUE_HISTORY.feats;
  assert.ok(filed.length > 0, '120 games produced no feats at all — detection is not wired in');
  filed.forEach(function (f) {
    assert.strictEqual(f.leagueYear, 2026, 'every feat must carry the league year');
    assert.ok(typeof f.day === 'number', 'every feat must carry the day');
    assert.ok(f.playerId && f.playerName, 'every feat must name its player');
    assert.ok(f.teamId && f.oppTeamId && f.teamId !== f.oppTeamId,
      'a feat must name both teams and they must differ');
    assert.ok(feats.FEAT_KINDS.indexOf(f.kind) !== -1, 'unknown feat kind ' + f.kind);
  });
  console.log('checkFeatsAreFiledFromRealGames: OK (' + filed.length + ' from 120 games)');
}

checkAllCallSitesPassContext();
checkFeatsAreFiledFromRealGames();
```

- [ ] **Step 2: Run to confirm both fail**

Run: `node scripts/validate-feats.js`
Expected: FAIL — `expected exactly 3 recordGameResult call sites` passes but the
argument assertion fails with `recordGameResult called with one argument`.

- [ ] **Step 3: Add the store to `history.js`**

Change the `LEAGUE_HISTORY` literal (currently at `history.js:71`) to:

```js
const LEAGUE_HISTORY = {
  retiredPlayers: [],
  trades: [],
  draftClasses: [],
  awardsHistory: [],
  champions: [],
  // Single-game feats, league-wide, for the life of the save. They cannot be
  // recovered later: save.js prunes box scores to the user's own games, so a
  // 60-point night by another team is unrecoverable once written to disk.
  feats: [],
  // One row per team per completed season. Season snapshots are capped and
  // roll off the front, so they cannot back all-time team records.
  teamSeasons: []
};
```

Add near `archiveTrade`:

```js
// Appends detected feats. Separate from detection so feats.js stays pure and
// this file stays the only thing that owns LEAGUE_HISTORY.
function recordFeats(featRecords) {
  if (!featRecords || featRecords.length === 0) return [];
  featRecords.forEach(function (f) { LEAGUE_HISTORY.feats.push(f); });
  return featRecords;
}
```

Add `recordFeats: recordFeats,` to the `module.exports` block.

- [ ] **Step 4: Wire detection into `recordGameResult`**

In `league.js`, add to the `_LEAGUE_DATA` eager bridge — both branches:

```js
// require branch: add to the object
feats: require('./feats.js'), history: require('./history.js')
// browser branch: add to the object
feats: { detectFeats: detectFeats }, history: { recordFeats: recordFeats }
```

Replace `recordGameResult` (currently `league.js:44`) with:

```js
// context carries { leagueYear, day } — the two things a feat record needs and
// the game object does not have. All three call sites pass it; the call-site
// guard in scripts/validate-feats.js asserts they do.
function recordGameResult(game, context) {
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
  recordGameFeats(game, context);
}

// Every finished game in the league passes through here — regular season,
// playoff series, play-in, and the game the user watches live — which is why
// detection hangs off this function rather than off any one caller.
function recordGameFeats(game, context) {
  if (!game.boxScore || !context) return;
  const homeIds = getTeamRoster(game.homeTeamId).map(function (p) { return p.id; });
  Object.keys(game.boxScore).forEach(function (playerId) {
    const player = getPlayerById(playerId);
    if (!player) return;
    const onHome = homeIds.indexOf(playerId) !== -1;
    const found = _LEAGUE_DATA.feats.detectFeats(game.boxScore[playerId], {
      leagueYear: context.leagueYear,
      day: context.day,
      playerId: playerId,
      playerName: player.name,
      teamId: onHome ? game.homeTeamId : game.awayTeamId,
      oppTeamId: onHome ? game.awayTeamId : game.homeTeamId
    });
    _LEAGUE_DATA.history.recordFeats(found);
  });
}
```

- [ ] **Step 5: Pass context from all three call sites**

`league.js:133` — replace `recordGameResult(game);` with:

```js
  recordGameResult(game, { leagueYear: settings.leagueYear || 2026, day: dayIndex });
```

`playoffs.js:75` (play-in) — replace `_PLAYOFF_DATA.league.recordGameResult(game);` with:

```js
  _PLAYOFF_DATA.league.recordGameResult(game, {
    leagueYear: (settings && settings.leagueYear) || 2026, day: null
  });
```

`playoffs.js:232` (series game) — same replacement, using that function's
`settings` parameter.

- [ ] **Step 6: Load `feats.js` in the browser**

In `index.html`, add before `<script src="league.js"></script>`:

```html
  <script src="feats.js"></script>
```

- [ ] **Step 7: Run the validator and the full suite**

Run: `node scripts/validate-feats.js`
Expected: PASS including `checkAllCallSitesPassContext: OK (3 sites)` and
`checkFeatsAreFiledFromRealGames: OK (N from 120 games)`.

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done`
Expected: no output. **Both goldens must still pass** — nothing here changes simulation.

- [ ] **Step 8: Commit, then mutation-test**

```bash
git add history.js league.js playoffs.js index.html scripts/validate-feats.js
git commit -m "feat: feats are filed from every finished game"
```

Then break each guard and confirm the test goes red, restoring after each:
`detectFeats` call removed from `recordGameFeats`; `context` dropped at
`league.js:133`; `recordFeats` made a no-op. Report any survivor and say whether
the assertion is worthless or the code is dead.

---

### Task 4: The Feats page, feed line and profile section

**Files:**
- Create: `ui/feats.js`
- Modify: `ui/nav.js` (hub-records views), `script.js` (VIEWS entry), `index.html` (load `ui/feats.js`)
- Modify: `league.js` (`recordGameFeats` pushes a feed line)
- Modify: `ui/playerProfile.js` (a feats panel)
- Modify: `scripts/ui-smoke.js` (a feats group)

**Interfaces:**
- Consumes: `LEAGUE_HISTORY.feats` from Task 3.
- Produces: `renderFeats(container)`; `featsForPlayer(playerId)` exported from `ui/feats.js` for the profile.

- [ ] **Step 1: Write `ui/feats.js`**

```js
// The Feats page: every remarkable single game in league history, newest first.
const FEAT_LABELS = {
  hugeScoring: 'Huge scoring night',
  bigScoring: 'Big scoring night',
  tripleDouble: 'Triple-double',
  fiveByFive: 'Five-by-five'
};

function featsForPlayer(playerId) {
  return LEAGUE_HISTORY.feats.filter(function (f) { return f.playerId === playerId; });
}

function featLineHtml(f) {
  return escapeHtml(f.points + ' pts, ' + f.rebounds + ' reb, ' + f.assists + ' ast, ' +
    f.steals + ' stl, ' + f.blocks + ' blk');
}

function renderFeats(container) {
  const all = LEAGUE_HISTORY.feats.slice().reverse();
  let html = '<div class="view-header"><h2>Feats</h2><span class="view-sub">' +
    all.length + ' in league history</span></div>';

  if (all.length === 0) {
    html += '<div class="empty-state">No feats yet — they are recorded as games are played.</div>';
    container.innerHTML = html;
    return;
  }

  const years = [];
  all.forEach(function (f) { if (years.indexOf(f.leagueYear) === -1) years.push(f.leagueYear); });
  html += '<div class="toolbar"><label>Season <select id="feat-year"><option value="">All</option>' +
    years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('') +
    '</select></label></div>';

  html += '<div class="panel"><table class="data-table"><thead><tr><th>Season</th><th>Player</th>' +
    '<th>Team</th><th>Feat</th><th>Line</th></tr></thead><tbody id="feat-rows">';
  html += all.map(function (f) {
    const opp = getTeamById(f.oppTeamId);
    return '<tr data-feat-year="' + f.leagueYear + '"><td class="num">' + f.leagueYear + '</td>' +
      '<td class="col-name">' + escapeHtml(f.playerName) + '</td>' +
      '<td>' + escapeHtml((getTeamById(f.teamId) || {}).name || f.teamId) +
      ' <span class="kpi-sub">vs ' + escapeHtml((opp || {}).name || f.oppTeamId) + '</span></td>' +
      '<td><span class="pill">' + FEAT_LABELS[f.kind] + '</span></td>' +
      '<td>' + featLineHtml(f) + '</td></tr>';
  }).join('');
  html += '</tbody></table></div>';
  container.innerHTML = html;

  document.getElementById('feat-year').addEventListener('change', function (e) {
    const want = e.target.value;
    container.querySelectorAll('#feat-rows tr').forEach(function (tr) {
      tr.style.display = (!want || tr.getAttribute('data-feat-year') === want) ? '' : 'none';
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFeats: renderFeats, featsForPlayer: featsForPlayer, FEAT_LABELS: FEAT_LABELS };
}
```

- [ ] **Step 2: Register the view**

`ui/nav.js` — change the records hub line to:

```js
  { id: 'hub-records', label: 'Records',
    views: ['gmCareer', 'history', 'awards', 'feats', 'seasonSummary', 'frivolities'] },
```

`script.js` — add to the `VIEWS` object, next to `history`:

```js
  feats: renderFeats,
```

`index.html` — add after `<script src="ui/history.js"></script>`:

```html
  <script src="ui/feats.js"></script>
```

- [ ] **Step 3: Announce feats in the feed**

In `league.js`, inside `recordGameFeats`, replace
`_LEAGUE_DATA.history.recordFeats(found);` with:

```js
    _LEAGUE_DATA.history.recordFeats(found);
    // pushToFeed is a browser global from script.js — guarded because league.js
    // also runs standalone under Node in every validate script.
    if (typeof pushToFeed === 'function') {
      found.forEach(function (f) {
        pushToFeed(f.playerName + ': ' + f.points + ' pts, ' + f.rebounds + ' reb, ' +
          f.assists + ' ast' + (f.kind === 'fiveByFive' ? ' — a five-by-five!' :
          f.kind === 'tripleDouble' ? ' — a triple-double.' : '.'), context.day);
      });
    }
```

- [ ] **Step 4: Add the profile panel**

In `ui/playerProfile.js`, immediately before the final `container.innerHTML = html;`:

```js
  const myFeats = featsForPlayer(player.id);
  if (myFeats.length) {
    html += '<div class="panel"><div class="panel-header">Feats (' + myFeats.length + ')</div>' +
      '<ul class="stack-list">' + myFeats.slice().reverse().slice(0, 10).map(function (f) {
        return '<li>' + f.leagueYear + ' — ' + escapeHtml(FEAT_LABELS[f.kind]) + ': ' +
          escapeHtml(f.points + ' pts, ' + f.rebounds + ' reb, ' + f.assists + ' ast') + '</li>';
      }).join('') + '</ul></div>';
  }
```

- [ ] **Step 5: Add a browser smoke group**

In `scripts/ui-smoke.js`, add to the groups object:

```js
  feats: function (t) {
    renderView('feats');
    const view = document.getElementById('view-content');
    t.ok('feats:renders', view.innerText.indexOf('Feats') !== -1, '');
    const rows = view.querySelectorAll('#feat-rows tr');
    const empty = view.querySelector('.empty-state');
    t.ok('feats:rows-or-empty-state', rows.length > 0 || !!empty,
      'a page with neither rows nor an empty state failed to render');
    if (rows.length > 0) {
      const r = rows[0].getBoundingClientRect();
      t.ok('feats:first-row-visible', r.height > 0 && r.top < window.innerHeight, '');
    }
  },
```

- [ ] **Step 6: Verify in the browser**

Start the preview, play at least one full season so feats exist, open Records →
Feats, confirm rows are visible and the season filter narrows them. Then run
`UI_SMOKE.run()` and confirm no failures.

- [ ] **Step 7: Commit**

```bash
git add ui/feats.js ui/nav.js script.js index.html league.js ui/playerProfile.js scripts/ui-smoke.js
git commit -m "feat: the Feats page, feed line and profile section"
```

---

# FEATURE 2 — HISTORY TOYS

### Task 5: The per-season team record

**Files:**
- Modify: `history.js` (`finalizeSeasonHistory`)
- Create: `scripts/validate-historyToys.js`

**Interfaces:**
- Consumes: `LEAGUE_HISTORY.teamSeasons` (declared in Task 3), `draft.playoffResultByTeam(bracket)`.
- Produces: rows of `{leagueYear, teamId, wins, losses, playoffResult, champion}` where `playoffResult` is one of `'missed' | 'lostR1' | 'lostCSF' | 'lostCF' | 'lostFinals' | 'champion'`.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-historyToys.js`:

```js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const history = rq('history.js');

function checkTeamSeasonsAreRecorded() {
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  TEAMS.forEach(function (t, i) { t.record = { wins: 20 + i, losses: 62 - i }; });
  const bracket = null;   // no playoffs played
  history.finalizeSeasonHistory(2026, bracket, function () {});

  const rows = history.LEAGUE_HISTORY.teamSeasons.filter(function (r) { return r.leagueYear === 2026; });
  assert.strictEqual(rows.length, TEAMS.length,
    'expected one row per team, got ' + rows.length + ' for ' + TEAMS.length + ' teams');
  rows.forEach(function (r) {
    assert.ok(typeof r.wins === 'number' && typeof r.losses === 'number', 'wins/losses must be numbers');
    assert.ok(r.playoffResult, 'every row needs a playoff result');
    assert.strictEqual(typeof r.champion, 'boolean');
  });
  assert.strictEqual(rows.filter(function (r) { return r.champion; }).length, 0,
    'no bracket means no champion');
  console.log('checkTeamSeasonsAreRecorded: OK (' + rows.length + ' rows)');
}

checkTeamSeasonsAreRecorded();
console.log('All history toy validations passed');
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-historyToys.js`
Expected: FAIL — `expected one row per team, got 0 for 30 teams`

- [ ] **Step 3: Write the rows in `finalizeSeasonHistory`**

In `history.js`, inside `finalizeSeasonHistory`, in the existing
`_HISTORY_DATA.teams.TEAMS.forEach` loop that folds `allTimeWins`, add a
`teamSeasons` push. The loop currently reads `team.allTimeWins = ... + team.record.wins;`
— add immediately before that line:

```js
    // Recorded here because team.record is about to be folded into allTime and
    // reset. Season snapshots are capped and roll off, so this is the only
    // durable per-season team record in the game.
    LEAGUE_HISTORY.teamSeasons.push({
      leagueYear: leagueYear,
      teamId: team.id,
      wins: team.record.wins,
      losses: team.record.losses,
      playoffResult: playoffResultLabel(playoffBracket, team.id),
      champion: !!(playoffBracket && playoffBracket.finals[0] && playoffBracket.finals[0].winner === team.id)
    });
```

Add above `finalizeSeasonHistory`:

```js
// Reuses draft.js's playoffResultByTeam — the same classifier the draft order
// is built from — rather than a second reading of the bracket that could
// disagree with it. Index 0 is "lost round 1" and 4 is "won it all".
const PLAYOFF_RESULT_LABELS = ['lostR1', 'lostCSF', 'lostCF', 'lostFinals', 'champion'];

function playoffResultLabel(bracket, teamId) {
  if (!bracket || !bracket.finals || !bracket.finals[0]) return 'missed';
  const byTeam = _HISTORY_DATA.draft.playoffResultByTeam(bracket);
  const r = byTeam[teamId];
  return r === undefined ? 'missed' : PLAYOFF_RESULT_LABELS[r];
}
```

`history.js` already resolves `draft` lazily (see the comment at its top about
`playoffResultByTeam`); use that same accessor rather than adding an eager
require. If the existing lazy accessor is named differently, use whichever name
`archiveChampionAndAdjustPrestige` already uses to reach draft.

- [ ] **Step 4: Run the test**

Run: `node scripts/validate-historyToys.js`
Expected: PASS — `checkTeamSeasonsAreRecorded: OK (30 rows)`

- [ ] **Step 5: Commit**

```bash
git add history.js scripts/validate-historyToys.js
git commit -m "feat: a durable per-season record for every team"
```

---

### Task 6: The candidate pool and the draft toys

**Files:**
- Create: `historyToys.js`
- Modify: `scripts/validate-historyToys.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `LEAGUE_HISTORY.draftClasses`, `.retiredPlayers`, `PLAYERS_2026`.
- Produces: `historyToys.candidatePool()` → array of `{playerId, name, production, championships, mvps, hofScore, retired}`; `historyToys.careerProduction(careerStats)` → number; `biggestBusts(limit)`, `biggestSteals(limit)`, `bestPlayerAtEveryPick()`, `draftClassRankings()`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-historyToys.js` before the final log:

```js
const toys = rq('historyToys.js');

// Reading only retiredPlayers would leave every toy empty for the first fifteen
// seasons of a save — which is most of the time anyone will look at them. The
// pool is active players PLUS retirees, keyed by id so nobody is double-counted.
function checkPoolIncludesActivePlayers() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  PLAYERS_2026[0].careerStats.points = 5000;
  const pool = toys.candidatePool();
  assert.ok(pool.length >= PLAYERS_2026.length,
    'pool of ' + pool.length + ' is smaller than the ' + PLAYERS_2026.length + ' active players');
  const ids = pool.map(function (p) { return p.playerId; });
  assert.strictEqual(new Set(ids).size, ids.length, 'no player may appear twice in the pool');
  const first = pool.find(function (p) { return p.playerId === PLAYERS_2026[0].id; });
  assert.ok(first && first.production > 0, 'an active player with stats must carry production');
  console.log('checkPoolIncludesActivePlayers: OK (' + pool.length + ')');
}

function checkDraftToysRankCorrectly() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  const star = PLAYERS_2026[0], dud = PLAYERS_2026[1];
  star.careerStats.points = 20000; star.careerStats.rebounds = 0; star.careerStats.assists = 0;
  dud.careerStats.points = 10; dud.careerStats.rebounds = 0; dud.careerStats.assists = 0;
  history.LEAGUE_HISTORY.draftClasses.push({
    leagueYear: 2026,
    picks: [
      { round: 1, pickNumber: 1, teamId: 'BOS', playerId: dud.id, playerName: dud.name },
      { round: 1, pickNumber: 40, teamId: 'LAL', playerId: star.id, playerName: star.name }
    ]
  });
  const busts = toys.biggestBusts(5);
  assert.ok(busts.length > 0, 'a top-10 pick with 10 career points must register as a bust');
  assert.strictEqual(busts[0].playerId, dud.id, 'the worst top-10 career should rank first');
  const steals = toys.biggestSteals(5);
  assert.strictEqual(steals[0].playerId, star.id, 'the best late pick should rank first');
  assert.ok(!busts.some(function (b) { return b.playerId === star.id; }),
    'a pick outside the top 10 can never be a bust');
  console.log('checkDraftToysRankCorrectly: OK');
}

function checkEmptyHistoryReturnsEmptyLists() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  assert.deepStrictEqual(toys.biggestBusts(5), []);
  assert.deepStrictEqual(toys.draftClassRankings(), []);
  assert.deepStrictEqual(toys.bestPlayerAtEveryPick(), []);
  console.log('checkEmptyHistoryReturnsEmptyLists: OK');
}

checkPoolIncludesActivePlayers();
checkDraftToysRankCorrectly();
checkEmptyHistoryReturnsEmptyLists();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-historyToys.js`
Expected: FAIL — `Cannot find module '.../historyToys.js'`

- [ ] **Step 3: Write `historyToys.js`**

```js
// History superlatives. Every toy is a standalone function returning a ranked
// array — no shared state, no rendering, so each can be tested against a
// constructed history with a known right answer.
var _TOYS_DATA = (typeof require !== 'undefined')
  ? { history: require('./history.js'), players: require('./players-2026.js'), teams: require('./teams.js') }
  : {
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { getTeamById: getTeamById, TEAMS: TEAMS }
    };

// A plain counting proxy, chosen because it exists for every player including
// retirees. It is NOT a claim about value, and the UI labels it "production".
function careerProduction(careerStats) {
  if (!careerStats) return 0;
  return (careerStats.points || 0) + (careerStats.rebounds || 0) + (careerStats.assists || 0);
}

const AWARD_MVP = 'mvp';

// Active players AND retirees. Retirees alone would leave every list empty for
// the first fifteen seasons of a save.
function candidatePool() {
  const byId = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    byId[p.id] = {
      playerId: p.id,
      name: p.name,
      production: careerProduction(p.careerStats),
      championships: p.championshipsWon || 0,
      mvps: (p.awardsWon || []).filter(function (a) { return a.award === AWARD_MVP; }).length,
      hofScore: 0,
      hallOfFame: false,
      retired: false
    };
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    byId[r.id] = {
      playerId: r.id,
      name: r.name,
      production: careerProduction(r.careerStats),
      championships: r.championshipsWon || 0,
      mvps: (r.awardsWon || []).filter(function (a) { return a.award === AWARD_MVP; }).length,
      hofScore: r.hofScore || 0,
      hallOfFame: !!r.hallOfFame,
      retired: true
    };
  });
  return Object.keys(byId).map(function (id) { return byId[id]; });
}

const BUST_PICK_CUTOFF = 10;

// Every pick ever made, joined to that player's career.
function pickRows() {
  const pool = {};
  candidatePool().forEach(function (c) { pool[c.playerId] = c; });
  const rows = [];
  _TOYS_DATA.history.LEAGUE_HISTORY.draftClasses.forEach(function (cls) {
    cls.picks.forEach(function (pick) {
      const c = pool[pick.playerId];
      rows.push({
        leagueYear: cls.leagueYear,
        pickNumber: pick.pickNumber,
        round: pick.round,
        teamId: pick.teamId,
        playerId: pick.playerId,
        name: pick.playerName,
        production: c ? c.production : 0
      });
    });
  });
  return rows;
}

function biggestBusts(limit) {
  return pickRows()
    .filter(function (r) { return r.pickNumber <= BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return a.production - b.production; })
    .slice(0, limit || 10);
}

function biggestSteals(limit) {
  return pickRows()
    .filter(function (r) { return r.pickNumber > BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

function bestPlayerAtEveryPick() {
  const best = {};
  pickRows().forEach(function (r) {
    if (!best[r.pickNumber] || r.production > best[r.pickNumber].production) best[r.pickNumber] = r;
  });
  return Object.keys(best)
    .map(function (n) { return best[n]; })
    .sort(function (a, b) { return a.pickNumber - b.pickNumber; });
}

function draftClassRankings() {
  const byYear = {};
  pickRows().forEach(function (r) {
    if (!byYear[r.leagueYear]) byYear[r.leagueYear] = { leagueYear: r.leagueYear, production: 0, picks: 0 };
    byYear[r.leagueYear].production += r.production;
    byYear[r.leagueYear].picks += 1;
  });
  return Object.keys(byYear)
    .map(function (y) { return byYear[y]; })
    .sort(function (a, b) { return b.production - a.production; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    careerProduction: careerProduction,
    candidatePool: candidatePool,
    pickRows: pickRows,
    biggestBusts: biggestBusts,
    biggestSteals: biggestSteals,
    bestPlayerAtEveryPick: bestPlayerAtEveryPick,
    draftClassRankings: draftClassRankings,
    BUST_PICK_CUTOFF: BUST_PICK_CUTOFF
  };
}
```

- [ ] **Step 4: Load it in the browser**

`index.html` — add after `<script src="history.js"></script>`:

```html
  <script src="historyToys.js"></script>
```

- [ ] **Step 5: Run the tests**

Run: `node scripts/validate-historyToys.js`
Expected: PASS — four OK lines.

Run: `node scripts/validate-browserBridges.js`
Expected: PASS — the new bridge is complete.

- [ ] **Step 6: Commit**

```bash
git add historyToys.js index.html scripts/validate-historyToys.js
git commit -m "feat: the candidate pool and the four draft toys"
```

---

### Task 7: The career toys

**Files:**
- Modify: `historyToys.js`, `scripts/validate-historyToys.js`

**Interfaces:**
- Consumes: `candidatePool()`, `careerProduction()` from Task 6.
- Produces: `bestWithoutARing(limit)`, `bestWithoutAnMvp(limit)`, `mostYearsOneTeam(limit)`, `mostTeams(limit)`, `careerEarnings(limit)`, `hallOfVeryGood(limit)`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-historyToys.js`:

```js
function checkCareerToys() {
  history.ensureCareerData(PLAYERS_2026);
  const ringless = PLAYERS_2026[2], champ = PLAYERS_2026[3];
  ringless.careerStats.points = 30000; ringless.championshipsWon = 0; ringless.awardsWon = [];
  champ.careerStats.points = 31000; champ.championshipsWon = 3; champ.awardsWon = [];

  const noRing = toys.bestWithoutARing(5);
  assert.strictEqual(noRing[0].playerId, ringless.id,
    'the most productive ringless player should rank first');
  assert.ok(!noRing.some(function (r) { return r.playerId === champ.id; }),
    'a player with a ring must never appear');

  champ.awardsWon = [{ award: 'mvp', leagueYear: 2030 }];
  const noMvp = toys.bestWithoutAnMvp(5);
  assert.ok(!noMvp.some(function (r) { return r.playerId === champ.id; }),
    'an MVP winner must never appear in best-without-an-MVP');

  // Earnings come from the contract history, not from the current salary.
  const earner = PLAYERS_2026[4];
  earner.careerHistory = earner.careerHistory || { contractHistory: [] };
  earner.careerHistory.contractHistory = [
    { season: 2026, salary: 10000000, yearsRemaining: 2, teamId: 'BOS', type: 'free_agency' },
    { season: 2028, salary: 20000000, yearsRemaining: 3, teamId: 'BOS', type: 're_signing' }
  ];
  const earnings = toys.careerEarnings(30);
  const row = earnings.find(function (e) { return e.playerId === earner.id; });
  assert.ok(row, 'a player with contracts must appear in career earnings');
  assert.strictEqual(row.earnings, 10000000 * 2 + 20000000 * 3,
    'earnings are salary times years for each contract signed');
  console.log('checkCareerToys: OK');
}

function checkHallOfVeryGood() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.push(
    { id: 'r1', name: 'Just In', careerStats: {}, awardsWon: [], championshipsWon: 0, hofScore: 120, hallOfFame: true },
    { id: 'r2', name: 'Just Out', careerStats: {}, awardsWon: [], championshipsWon: 0, hofScore: 95, hallOfFame: false }
  );
  const list = toys.hallOfVeryGood(5);
  assert.strictEqual(list.length, 1, 'only the non-inducted belong in the Hall of Very Good');
  assert.strictEqual(list[0].playerId, 'r2');
  console.log('checkHallOfVeryGood: OK');
}

checkCareerToys();
checkHallOfVeryGood();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-historyToys.js`
Expected: FAIL — `toys.bestWithoutARing is not a function`

- [ ] **Step 3: Add the career toys to `historyToys.js`**

Insert before the exports block:

```js
function bestWithoutARing(limit) {
  return candidatePool()
    .filter(function (c) { return c.championships === 0; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

function bestWithoutAnMvp(limit) {
  return candidatePool()
    .filter(function (c) { return c.mvps === 0; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

// Longest unbroken spell with one franchise, from careerHistory.teamHistory.
function mostYearsOneTeam(limit) {
  const out = [];
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const spells = (p.careerHistory && p.careerHistory.teamHistory) || [];
    let best = 0, bestTeam = null;
    spells.forEach(function (s) {
      const years = (s.toSeason || s.fromSeason) - s.fromSeason + 1;
      if (years > best) { best = years; bestTeam = s.teamId; }
    });
    if (best > 0) out.push({ playerId: p.id, name: p.name, years: best, teamId: bestTeam });
  });
  return out.sort(function (a, b) { return b.years - a.years; }).slice(0, limit || 10);
}

function mostTeams(limit) {
  const out = [];
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const n = (p.teamsPlayedFor || []).length;
    if (n > 0) out.push({ playerId: p.id, name: p.name, teams: n });
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    const n = (r.teamsPlayedFor || []).length;
    if (n > 0) out.push({ playerId: r.id, name: r.name, teams: n });
  });
  return out.sort(function (a, b) { return b.teams - a.teams; }).slice(0, limit || 10);
}

// Salary times years for every contract ever signed. Reads contractHistory
// rather than the current contract, so a career is summed and not a snapshot.
function careerEarnings(limit) {
  const out = [];
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const contracts = (p.careerHistory && p.careerHistory.contractHistory) || [];
    const total = contracts.reduce(function (sum, c) {
      return sum + (c.salary || 0) * (c.yearsRemaining || 0);
    }, 0);
    if (total > 0) out.push({ playerId: p.id, name: p.name, earnings: total });
  });
  return out.sort(function (a, b) { return b.earnings - a.earnings; }).slice(0, limit || 10);
}

// The nearly-men: highest Hall of Fame scores that fell short of induction.
function hallOfVeryGood(limit) {
  return _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers
    .filter(function (r) { return !r.hallOfFame; })
    .map(function (r) { return { playerId: r.id, name: r.name, hofScore: r.hofScore || 0 }; })
    .sort(function (a, b) { return b.hofScore - a.hofScore; })
    .slice(0, limit || 10);
}
```

Add all six names to `module.exports`.

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-historyToys.js`
Expected: PASS — six OK lines.

- [ ] **Step 5: Commit**

```bash
git add historyToys.js scripts/validate-historyToys.js
git commit -m "feat: the six career toys"
```

---

### Task 8: The team-season and trade toys

**Files:**
- Modify: `historyToys.js`, `scripts/validate-historyToys.js`

**Interfaces:**
- Consumes: `LEAGUE_HISTORY.teamSeasons` from Task 5, `LEAGUE_HISTORY.trades`.
- Produces: `bestTeams(limit)`, `worstTeams(limit)`, `bestToMissThePlayoffs(limit)`, `worstToWinIt(limit)`, `biggestTrades(limit)`, `mostLopsidedTrades(limit)`, `LOPSIDED_MIN_SEASONS`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-historyToys.js`:

```js
function checkTeamSeasonToys() {
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.push(
    { leagueYear: 2030, teamId: 'BOS', wins: 70, losses: 12, playoffResult: 'lostR1', champion: false },
    { leagueYear: 2031, teamId: 'LAL', wins: 41, losses: 41, playoffResult: 'champion', champion: true },
    { leagueYear: 2032, teamId: 'CHI', wins: 60, losses: 22, playoffResult: 'missed', champion: false },
    { leagueYear: 2033, teamId: 'PHX', wins: 9, losses: 73, playoffResult: 'missed', champion: false }
  );
  assert.strictEqual(toys.bestTeams(1)[0].wins, 70);
  assert.strictEqual(toys.worstTeams(1)[0].wins, 9);
  assert.strictEqual(toys.bestToMissThePlayoffs(1)[0].teamId, 'CHI',
    '60 wins and no playoffs is the best team to miss');
  assert.strictEqual(toys.worstToWinIt(1)[0].teamId, 'LAL',
    'a 41-win champion is the worst team to win it');
  console.log('checkTeamSeasonToys: OK');
}

function checkLopsidedTradesNeedTime() {
  history.LEAGUE_HISTORY.trades.length = 0;
  const a = PLAYERS_2026[5], b = PLAYERS_2026[6];
  [a, b].forEach(function (p) {
    p.careerHistory = p.careerHistory || {};
    p.careerHistory.seasonByYear = {};
  });
  // a explodes after the trade; b does nothing.
  a.careerHistory.seasonByYear[2031] = { season: 2031, points: 2000, rebounds: 500, assists: 500 };
  b.careerHistory.seasonByYear[2031] = { season: 2031, points: 10, rebounds: 0, assists: 0 };

  history.LEAGUE_HISTORY.trades.push({
    leagueYear: 2030, participants: ['BOS', 'LAL'],
    players: [
      { playerId: a.id, playerName: a.name, fromTeamId: 'BOS', toTeamId: 'LAL' },
      { playerId: b.id, playerName: b.name, fromTeamId: 'LAL', toTeamId: 'BOS' }
    ],
    picks: []
  });
  // Too recent to judge.
  assert.deepStrictEqual(toys.mostLopsidedTrades(5, 2032), [],
    'a trade less than ' + toys.LOPSIDED_MIN_SEASONS + ' seasons old must not be judged');
  const judged = toys.mostLopsidedTrades(5, 2035);
  assert.strictEqual(judged.length, 1, 'an old enough trade must be judged');
  assert.ok(judged[0].difference > 2000,
    'the lopsidedness must reflect the post-trade gap, got ' + judged[0].difference);
  console.log('checkLopsidedTradesNeedTime: OK');
}

checkTeamSeasonToys();
checkLopsidedTradesNeedTime();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-historyToys.js`
Expected: FAIL — `toys.bestTeams is not a function`

- [ ] **Step 3: Add the toys to `historyToys.js`**

Insert before the exports block:

```js
function teamSeasonRows() {
  return _TOYS_DATA.history.LEAGUE_HISTORY.teamSeasons.slice();
}

function bestTeams(limit) {
  return teamSeasonRows().sort(function (a, b) { return b.wins - a.wins; }).slice(0, limit || 10);
}

function worstTeams(limit) {
  return teamSeasonRows().sort(function (a, b) { return a.wins - b.wins; }).slice(0, limit || 10);
}

function bestToMissThePlayoffs(limit) {
  return teamSeasonRows()
    .filter(function (r) { return r.playoffResult === 'missed'; })
    .sort(function (a, b) { return b.wins - a.wins; })
    .slice(0, limit || 10);
}

function worstToWinIt(limit) {
  return teamSeasonRows()
    .filter(function (r) { return r.champion; })
    .sort(function (a, b) { return a.wins - b.wins; })
    .slice(0, limit || 10);
}

// A verdict on a trade needs time. Anything younger than this is not judged at
// all rather than judged on partial evidence.
const LOPSIDED_MIN_SEASONS = 3;

// Production a player recorded in seasons STRICTLY AFTER the trade year.
function productionAfter(playerId, afterYear) {
  const player = _TOYS_DATA.players.PLAYERS_2026.find(function (p) { return p.id === playerId; });
  const byYear = (player && player.careerHistory && player.careerHistory.seasonByYear) || {};
  return Object.keys(byYear).reduce(function (sum, year) {
    if (Number(year) <= afterYear) return sum;
    const s = byYear[year];
    return sum + (s.points || 0) + (s.rebounds || 0) + (s.assists || 0);
  }, 0);
}

// currentYear is passed rather than read from a global so the rule is testable.
function tradeVerdicts(currentYear) {
  return _TOYS_DATA.history.LEAGUE_HISTORY.trades
    .filter(function (t) { return currentYear - t.leagueYear >= LOPSIDED_MIN_SEASONS; })
    .map(function (t) {
      const bySide = {};
      t.participants.forEach(function (teamId) { bySide[teamId] = 0; });
      t.players.forEach(function (p) {
        if (bySide[p.toTeamId] === undefined) bySide[p.toTeamId] = 0;
        bySide[p.toTeamId] += productionAfter(p.playerId, t.leagueYear);
      });
      const totals = Object.keys(bySide).map(function (k) { return bySide[k]; });
      const combined = totals.reduce(function (a, b) { return a + b; }, 0);
      const difference = totals.length < 2 ? 0 : Math.abs(Math.max.apply(null, totals) - Math.min.apply(null, totals));
      return { trade: t, leagueYear: t.leagueYear, bySide: bySide, combined: combined, difference: difference };
    });
}

function biggestTrades(limit, currentYear) {
  return tradeVerdicts(currentYear).sort(function (a, b) { return b.combined - a.combined; }).slice(0, limit || 10);
}

function mostLopsidedTrades(limit, currentYear) {
  return tradeVerdicts(currentYear).sort(function (a, b) { return b.difference - a.difference; }).slice(0, limit || 10);
}
```

Add all six names plus `LOPSIDED_MIN_SEASONS` to `module.exports`.

- [ ] **Step 4: Run the tests and the full suite**

Run: `node scripts/validate-historyToys.js`
Expected: PASS — eight OK lines.

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done`
Expected: no output.

- [ ] **Step 5: Commit, then mutation-test**

```bash
git add historyToys.js scripts/validate-historyToys.js
git commit -m "feat: the team-season and trade toys"
```

Then break and confirm red, restoring after each: reverse the sort in
`bestTeams`; drop the `champion` filter in `worstToWinIt`; set
`LOPSIDED_MIN_SEASONS` to 0; make `productionAfter` ignore its `afterYear`.

---

### Task 9: Frivolities becomes an index of toys

**Files:**
- Modify: `ui/frivolities.js`, `scripts/ui-smoke.js`

**Interfaces:**
- Consumes: every toy from Tasks 6–8.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the toy index above the existing panels**

In `ui/frivolities.js`, define the catalogue at the top of the file:

```js
// The catalogue. Each entry names a toy, how to render one row, and nothing
// else — adding a toy is one entry, not a new branch in a render function.
const TOY_CATALOGUE = [
  { id: 'busts', name: 'Biggest Busts', blurb: 'Top-10 picks with the worst careers.',
    run: function () { return biggestBusts(15); },
    row: function (r) { return '#' + r.pickNumber + ' (' + r.leagueYear + ') ' + escapeHtml(r.name) + ' — ' + r.production.toLocaleString() + ' production'; } },
  { id: 'steals', name: 'Biggest Steals', blurb: 'Late picks with the best careers.',
    run: function () { return biggestSteals(15); },
    row: function (r) { return '#' + r.pickNumber + ' (' + r.leagueYear + ') ' + escapeHtml(r.name) + ' — ' + r.production.toLocaleString() + ' production'; } },
  { id: 'bestAtPick', name: 'Best at Every Pick', blurb: 'The best career taken at each slot.',
    run: function () { return bestPlayerAtEveryPick(); },
    row: function (r) { return '#' + r.pickNumber + ' ' + escapeHtml(r.name) + ' — ' + r.production.toLocaleString(); } },
  { id: 'classes', name: 'Draft Class Rankings', blurb: 'Every class, best to worst.',
    run: function () { return draftClassRankings(); },
    row: function (r) { return r.leagueYear + ' — ' + r.production.toLocaleString() + ' from ' + r.picks + ' picks'; } },
  { id: 'noRing', name: 'Best Without a Ring', blurb: 'Great careers, no championship.',
    run: function () { return bestWithoutARing(15); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.production.toLocaleString(); } },
  { id: 'noMvp', name: 'Best Without an MVP', blurb: 'Great careers, never the best.',
    run: function () { return bestWithoutAnMvp(15); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.production.toLocaleString(); } },
  { id: 'loyal', name: 'Most Years With One Team', blurb: 'The one-club players.',
    run: function () { return mostYearsOneTeam(15); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.years + ' seasons'; } },
  { id: 'journeymen', name: 'Most Teams', blurb: 'The journeymen.',
    run: function () { return mostTeams(15); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.teams + ' teams'; } },
  { id: 'earnings', name: 'Career Earnings', blurb: 'Who got paid.',
    run: function () { return careerEarnings(15); },
    row: function (r) { return escapeHtml(r.name) + ' — $' + r.earnings.toLocaleString(); } },
  { id: 'veryGood', name: 'Hall of Very Good', blurb: 'The nearly-men.',
    run: function () { return hallOfVeryGood(15); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.hofScore.toFixed(0) + ' Hall of Fame score'; } },
  { id: 'bestTeams', name: 'Best Teams Ever', blurb: 'The greatest seasons.',
    run: function () { return bestTeams(15); },
    row: function (r) { return r.leagueYear + ' ' + escapeHtml((getTeamById(r.teamId) || {}).name || r.teamId) + ' — ' + r.wins + '-' + r.losses; } },
  { id: 'worstTeams', name: 'Worst Teams Ever', blurb: 'The worst seasons.',
    run: function () { return worstTeams(15); },
    row: function (r) { return r.leagueYear + ' ' + escapeHtml((getTeamById(r.teamId) || {}).name || r.teamId) + ' — ' + r.wins + '-' + r.losses; } },
  { id: 'bestMiss', name: 'Best Team to Miss the Playoffs', blurb: 'Good, and not good enough.',
    run: function () { return bestToMissThePlayoffs(15); },
    row: function (r) { return r.leagueYear + ' ' + escapeHtml((getTeamById(r.teamId) || {}).name || r.teamId) + ' — ' + r.wins + '-' + r.losses; } },
  { id: 'worstChamp', name: 'Worst Team to Win It All', blurb: 'Got hot at the right time.',
    run: function () { return worstToWinIt(15); },
    row: function (r) { return r.leagueYear + ' ' + escapeHtml((getTeamById(r.teamId) || {}).name || r.teamId) + ' — ' + r.wins + '-' + r.losses; } },
  { id: 'bigTrades', name: 'Biggest Trades', blurb: 'The most production ever moved.',
    run: function () { return biggestTrades(15, GameState.leagueYear || 2026); },
    row: function (r) { return r.leagueYear + ' — ' + r.combined.toLocaleString() + ' production moved'; } },
  { id: 'lopsided', name: 'Most Lopsided Trades', blurb: 'Judged on what happened next.',
    run: function () { return mostLopsidedTrades(15, GameState.leagueYear || 2026); },
    row: function (r) { return r.leagueYear + ' — ' + r.difference.toLocaleString() + ' production apart'; } }
];
```

Inside `renderFrivolities`, after the existing glance panels are appended and
before `container.innerHTML = html;`, add the index and the selected list:

```js
  html += '<div class="panel"><div class="panel-header">Toys</div><div class="panel-body">' +
    '<div class="toolbar">' + TOY_CATALOGUE.map(function (t) {
      return '<button data-toy="' + t.id + '"' +
        (selectedToyId === t.id ? ' class="btn-primary"' : ' class="btn-ghost"') + '>' +
        escapeHtml(t.name) + '</button>';
    }).join(' ') + '</div>';

  const toy = TOY_CATALOGUE.find(function (t) { return t.id === selectedToyId; });
  if (toy) {
    const rows = toy.run();
    html += '<div class="kpi-sub">' + escapeHtml(toy.blurb) + '</div>';
    html += rows.length === 0
      ? '<div class="empty-state">Nothing here yet — this fills in as the league plays.</div>'
      : '<ol class="stack-list">' + rows.map(function (r) { return '<li>' + toy.row(r) + '</li>'; }).join('') + '</ol>';
  }
  html += '</div></div>';
```

Declare `let selectedToyId = TOY_CATALOGUE[0].id;` in the closure above `draw`,
and after `container.innerHTML = html;` wire the buttons:

```js
    container.querySelectorAll('button[data-toy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedToyId = btn.getAttribute('data-toy');
        draw();
      });
    });
```

- [ ] **Step 2: Add a smoke group**

In `scripts/ui-smoke.js`:

```js
  toys: function (t) {
    renderView('frivolities');
    const view = document.getElementById('view-content');
    const buttons = view.querySelectorAll('button[data-toy]');
    t.ok('toys:index-renders', buttons.length >= 16, buttons.length + ' toys');
    // Every toy must render without throwing, on whatever history exists.
    let broke = null;
    buttons.forEach(function (b) {
      try { b.click(); } catch (e) { broke = b.getAttribute('data-toy') + ': ' + e.message; }
    });
    t.ok('toys:every-toy-opens', broke === null, broke || '');
    const list = view.querySelector('.stack-list, .empty-state');
    t.ok('toys:shows-list-or-empty', !!list, '');
  },
```

- [ ] **Step 3: Verify in the browser**

Open Records → Frivolities on a league several seasons old. Click through every
toy and confirm each renders a list or an honest empty state, and that the
existing glance panels are still above them. Run `UI_SMOKE.run()`.

- [ ] **Step 4: Commit**

```bash
git add ui/frivolities.js scripts/ui-smoke.js
git commit -m "feat: Frivolities becomes an index of sixteen toys"
```

---

# FEATURE 3 — FAMILY TREES

### Task 10: Family links

**Files:**
- Create: `relatives.js`, `scripts/validate-relatives.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `relatives.link(a, b, type)` where `type` is `'father'` (a is b's father) or `'brother'`; `relatives.relativesOf(player)`; `relatives.ELIGIBLE_FATHER_GAP = 18`.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-relatives.js`:

```js
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const relatives = require(path.join(ROOT, 'relatives.js'));

function mk(id, name) { return { id: id, name: name }; }

function checkLinksAreAlwaysBothWays() {
  const dad = mk('p1', 'Big Name'), kid = mk('p2', 'Small Name');
  relatives.link(dad, kid, 'father');
  assert.deepStrictEqual(dad.relatives, [{ type: 'son', playerId: 'p2', name: 'Small Name' }],
    'the father must record a son');
  assert.deepStrictEqual(kid.relatives, [{ type: 'father', playerId: 'p1', name: 'Big Name' }],
    'the son must record a father');

  const b1 = mk('p3', 'One'), b2 = mk('p4', 'Two');
  relatives.link(b1, b2, 'brother');
  assert.strictEqual(b1.relatives[0].type, 'brother');
  assert.strictEqual(b2.relatives[0].type, 'brother');
  console.log('checkLinksAreAlwaysBothWays: OK');
}

function checkNoSelfLinksAndNoDuplicates() {
  const p = mk('p5', 'Solo');
  relatives.link(p, p, 'brother');
  assert.deepStrictEqual(p.relatives || [], [], 'a player cannot be his own relative');

  const a = mk('p6', 'A'), b = mk('p7', 'B');
  relatives.link(a, b, 'brother');
  relatives.link(a, b, 'brother');
  assert.strictEqual(a.relatives.length, 1, 'linking twice must not duplicate');
  console.log('checkNoSelfLinksAndNoDuplicates: OK');
}

checkLinksAreAlwaysBothWays();
checkNoSelfLinksAndNoDuplicates();
console.log('All relatives validations passed');
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-relatives.js`
Expected: FAIL — `Cannot find module '.../relatives.js'`

- [ ] **Step 3: Write `relatives.js`**

```js
// Family lines between players.
//
// Links are ALWAYS written in both directions, so answering "does this player
// have relatives" never requires scanning the league. A father gets a son entry
// and the son gets a father entry, in the same call.
var _RELATIVES_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js') }
  : { players: { PLAYERS_2026: PLAYERS_2026 } };

// A father must have entered the league at least this many seasons before his
// son's draft, so the timeline is never absurd.
const ELIGIBLE_FATHER_GAP = 18;

function ensureRelatives(player) {
  if (!player.relatives) player.relatives = [];
  return player.relatives;
}

function addOne(player, type, other) {
  const list = ensureRelatives(player);
  const already = list.some(function (r) { return r.playerId === other.id && r.type === type; });
  if (already) return;
  list.push({ type: type, playerId: other.id, name: other.name });
}

// type 'father' means a IS b's father. type 'brother' is symmetric.
function link(a, b, type) {
  if (!a || !b || a.id === b.id) return;
  if (type === 'father') {
    addOne(a, 'son', b);
    addOne(b, 'father', a);
  } else {
    addOne(a, 'brother', b);
    addOne(b, 'brother', a);
  }
}

function relativesOf(player) {
  return (player && player.relatives) || [];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    link: link,
    relativesOf: relativesOf,
    ensureRelatives: ensureRelatives,
    ELIGIBLE_FATHER_GAP: ELIGIBLE_FATHER_GAP
  };
}
```

- [ ] **Step 4: Load it and run the test**

`index.html` — add after `<script src="players-2026.js"></script>`:

```html
  <script src="relatives.js"></script>
```

Run: `node scripts/validate-relatives.js`
Expected: PASS — two OK lines.

- [ ] **Step 5: Commit**

```bash
git add relatives.js index.html scripts/validate-relatives.js
git commit -m "feat: two-way family links between players"
```

---

### Task 11: Sons and brothers in new draft classes

**Files:**
- Modify: `relatives.js`, `draftProspects.js`, `scripts/validate-relatives.js`

**Interfaces:**
- Consumes: `link`, `ELIGIBLE_FATHER_GAP` from Task 10.
- Produces: `relatives.assignFamilies(prospects, allPlayers, leagueYear, rng)` which mutates prospects in place and returns `{sons: n, brothers: n}`; `relatives.RELATIVE_TUNING` (mutable holder with `sonChance` and `brotherChance`).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/validate-relatives.js`:

```js
function makeRngSeq(values) {
  let i = 0;
  return function () { const v = values[i % values.length]; i++; return v; };
}

function checkSonInheritsSurnameAndRespectsTheTimeline() {
  const veteran = { id: 'v1', name: 'Marcus Threepwood', firstLeagueYear: 2026,
    attributes: { threePoint: 90, insideScoring: 30 }, teamId: 'BOS' };
  const tooNew = { id: 'v2', name: 'Kid Recent', firstLeagueYear: 2050,
    attributes: { threePoint: 90, insideScoring: 30 }, teamId: 'LAL' };
  const prospect = { id: 'q1', name: 'Andre Jones', attributes: { threePoint: 50, insideScoring: 50 } };

  // rng always 0 -> every roll fires, first candidate chosen.
  const out = relatives.assignFamilies([prospect], [veteran, tooNew], 2050, makeRngSeq([0]));
  assert.strictEqual(out.sons, 1, 'a son should have been created');
  assert.ok(/Threepwood$/.test(prospect.name),
    'the son must inherit the surname, got ' + prospect.name);
  const link = relatives.relativesOf(prospect).find(function (r) { return r.type === 'father'; });
  assert.ok(link, 'the prospect must record his father');
  assert.notStrictEqual(link.playerId, 'v2',
    'a father who entered the league 0 seasons ago is not eligible');
  assert.strictEqual(link.playerId, 'v1');
  assert.ok(prospect.attributes.threePoint > 50,
    'the son must lean toward his father, got ' + prospect.attributes.threePoint);
  assert.ok(prospect.attributes.threePoint < 90,
    'but must not simply become his father, got ' + prospect.attributes.threePoint);
  console.log('checkSonInheritsSurnameAndRespectsTheTimeline: OK');
}

function checkNoEligibleFatherIsNotAFailure() {
  const prospect = { id: 'q2', name: 'Nobody Special', attributes: { threePoint: 50 } };
  const out = relatives.assignFamilies([prospect], [], 2027, makeRngSeq([0]));
  assert.strictEqual(out.sons, 0, 'no eligible father means no son, not a crash');
  assert.deepStrictEqual(relatives.relativesOf(prospect), []);
  console.log('checkNoEligibleFatherIsNotAFailure: OK');
}

function checkGenerationRatesAreInBand() {
  const veterans = [];
  for (let i = 0; i < 40; i++) {
    veterans.push({ id: 'vet' + i, name: 'Vet Surname' + i, firstLeagueYear: 2026,
      attributes: { threePoint: 70 }, teamId: 'BOS' });
  }
  const makeRng = require(path.join(ROOT, 'rng.js')).makeRng;
  const rng = makeRng(99);
  let classesWithSon = 0, classesWithBrothers = 0;
  const TRIALS = 400;
  for (let c = 0; c < TRIALS; c++) {
    const prospects = [];
    for (let p = 0; p < 60; p++) {
      prospects.push({ id: 'c' + c + 'p' + p, name: 'First Last' + p, attributes: { threePoint: 50 } });
    }
    const out = relatives.assignFamilies(prospects, veterans, 2050, rng);
    if (out.sons > 0) classesWithSon++;
    if (out.brothers > 0) classesWithBrothers++;
  }
  const sonRate = 100 * classesWithSon / TRIALS;
  const brotherRate = 100 * classesWithBrothers / TRIALS;
  assert.ok(sonRate >= 15 && sonRate <= 35,
    'classes containing a son: ' + sonRate.toFixed(1) + '%, target 15-35%');
  assert.ok(brotherRate >= 5 && brotherRate <= 15,
    'classes containing brothers: ' + brotherRate.toFixed(1) + '%, target 5-15%');
  console.log('checkGenerationRatesAreInBand: OK (sons ' + sonRate.toFixed(1) +
    '%, brothers ' + brotherRate.toFixed(1) + '%)');
}

checkSonInheritsSurnameAndRespectsTheTimeline();
checkNoEligibleFatherIsNotAFailure();
checkGenerationRatesAreInBand();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/validate-relatives.js`
Expected: FAIL — `relatives.assignFamilies is not a function`

- [ ] **Step 3: Add generation to `relatives.js`**

```js
// Rates set by measurement and asserted in band by validate-relatives.js — a
// family link should be a pleasant surprise, not routine. Mutable so a sweep
// can move them without editing committed source.
var RELATIVE_TUNING = { sonChance: 0.004, brotherChance: 0.0018, inheritance: 0.15 };

function surnameOf(name) {
  const parts = String(name).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  // "Jr." is a suffix, not a surname.
  return (last === 'Jr.' && parts.length > 2) ? parts[parts.length - 2] : last;
}

function firstNameOf(name) { return String(name).trim().split(/\s+/)[0]; }

function eligibleFathers(allPlayers, leagueYear) {
  return allPlayers.filter(function (p) {
    const first = p.firstLeagueYear;
    return typeof first === 'number' && leagueYear - first >= ELIGIBLE_FATHER_GAP;
  });
}

// Moves each of the son's attributes a fraction of the way toward his father's,
// so the resemblance is visible in the ratings without a star's son simply
// becoming a star.
function inheritAttributes(son, father) {
  if (!son.attributes || !father.attributes) return;
  Object.keys(son.attributes).forEach(function (key) {
    const dadValue = father.attributes[key];
    if (typeof dadValue !== 'number') return;
    son.attributes[key] = Math.round(
      son.attributes[key] + (dadValue - son.attributes[key]) * RELATIVE_TUNING.inheritance);
  });
}

// Mutates prospects in place. Returns how many of each link were made, so the
// caller can report and the rate can be measured.
function assignFamilies(prospects, allPlayers, leagueYear, rng) {
  const fathers = eligibleFathers(allPlayers, leagueYear);
  let sons = 0, brothers = 0;

  prospects.forEach(function (prospect) {
    if (fathers.length === 0) return;
    if (rng() >= RELATIVE_TUNING.sonChance) return;
    const father = fathers[Math.floor(rng() * fathers.length)];
    if (!father) return;
    prospect.name = firstNameOf(prospect.name) + ' ' + surnameOf(father.name);
    inheritAttributes(prospect, father);
    link(father, prospect, 'father');
    sons++;
  });

  for (let i = 0; i + 1 < prospects.length; i++) {
    if (rng() >= RELATIVE_TUNING.brotherChance) continue;
    const a = prospects[i], b = prospects[i + 1];
    if (relativesOf(a).length || relativesOf(b).length) continue;
    b.name = firstNameOf(b.name) + ' ' + surnameOf(a.name);
    link(a, b, 'brother');
    brothers++;
    i++;   // a player is in at most one brother pair
  }

  return { sons: sons, brothers: brothers };
}
```

Add `assignFamilies`, `RELATIVE_TUNING`, `surnameOf` and `eligibleFathers` to
`module.exports`.

- [ ] **Step 4: Run the rate test and tune**

Run: `node scripts/validate-relatives.js`
Expected: PASS. If a rate band fails, adjust `sonChance` / `brotherChance` in
`RELATIVE_TUNING` — **never widen the band** — and re-run. Record the values
tried and the resulting rates for the commit message.

- [ ] **Step 5: Call it from prospect generation**

In `draftProspects.js`, add `relatives: require('./relatives.js')` to the require
branch of `_PROSPECT_DATA` and `relatives: { assignFamilies: assignFamilies }` to
the browser branch. Then at the end of `generateProspectClass`, immediately
before it returns `prospects`:

```js
  // Only NEW generations get families. The real 2026 players are left alone:
  // asserting that two real people are brothers is a different thing from
  // generating a fictional lineage.
  _PROSPECT_DATA.relatives.assignFamilies(
    prospects, _PROSPECT_DATA.players.PLAYERS_2026, leagueYear, rng);
```

If `generateProspectClass` does not already receive `leagueYear`, add it as a
third parameter and update its callers in `seasonTransition.js`
(`generateNewSeason`) to pass `gameState.leagueYear`. Players need a
`firstLeagueYear` for eligibility — set it in `draft.js`'s `executePick`
alongside `yearsPro = 0`:

```js
  prospect.firstLeagueYear = leagueYear;
```

threading `leagueYear` into `executePick` from `runDraft` and
`resolveCurrentPick`, both of which already know the season.

- [ ] **Step 6: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done`
Expected: no output. If `validate-seasonRollover.js` fails, the golden has moved
because draft classes now differ — regenerate it with
`node scripts/gen-rollover-golden.js` and say so in the commit message. The
**gamesim** golden must NOT move.

- [ ] **Step 7: Commit, then mutation-test**

```bash
git add relatives.js draftProspects.js draft.js seasonTransition.js scripts/validate-relatives.js scripts/fixtures/rollover-golden.json
git commit -F <message recording the rate sweep and the chosen chances>
```

Then break and confirm red: drop the `ELIGIBLE_FATHER_GAP` filter; make
`inheritAttributes` a no-op; make `link` write only one direction.

---

### Task 12: Families on screen

**Files:**
- Modify: `ui/playerProfile.js`, `ui/frivolities.js`, `scripts/ui-smoke.js`

**Interfaces:**
- Consumes: `relatives.relativesOf(player)` from Task 10.
- Produces: nothing consumed later.

- [ ] **Step 1: Show relatives on the profile**

In `ui/playerProfile.js`, immediately before the feats panel added in Task 4:

```js
  const kin = relativesOf(player);
  if (kin.length) {
    html += '<div class="panel"><div class="panel-header">Family</div><ul class="stack-list">' +
      kin.map(function (r) {
        const label = r.type === 'father' ? 'Son of' : r.type === 'son' ? 'Father of' : 'Brother of';
        return '<li>' + label + ' <a href="#" data-profile-id="' + r.playerId + '">' +
          escapeHtml(r.name) + '</a></li>';
      }).join('') + '</ul></div>';
  }
```

- [ ] **Step 2: Add the Relatives toy**

In `ui/frivolities.js`, append to `TOY_CATALOGUE`:

```js
  { id: 'relatives', name: 'Relatives', blurb: 'Families in the league.',
    run: function () {
      const seen = {};
      const out = [];
      PLAYERS_2026.forEach(function (p) {
        relativesOf(p).forEach(function (r) {
          const key = [p.id, r.playerId].sort().join('|');
          if (seen[key]) return;
          seen[key] = true;
          out.push({ a: p.name, b: r.name, type: r.type });
        });
      });
      return out;
    },
    row: function (r) {
      const verb = r.type === 'father' ? 'is the son of' : r.type === 'son' ? 'is the father of' : 'is the brother of';
      return escapeHtml(r.a) + ' ' + verb + ' ' + escapeHtml(r.b);
    } }
```

- [ ] **Step 3: Extend the smoke group**

In `scripts/ui-smoke.js`, change the `toys:index-renders` threshold from 16 to 17.

- [ ] **Step 4: Verify in the browser**

Sim at least 20 seasons so a son exists, open his profile, confirm the Family
panel shows and the link opens the father's profile. Open Frivolities →
Relatives. Run `UI_SMOKE.run()`.

- [ ] **Step 5: Commit**

```bash
git add ui/playerProfile.js ui/frivolities.js scripts/ui-smoke.js
git commit -m "feat: families on the profile and in the toys"
```

---

### Task 13: Whole-feature verification

**Files:**
- Modify: `scripts/validate-save.js`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add a save round-trip test**

Append to `scripts/validate-save.js` a check that the three new stores survive:

```js
function checkNewHistoryStoresRoundTrip() {
  const history = require(path.join(__dirname, '..', 'history.js'));
  history.LEAGUE_HISTORY.feats.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  history.LEAGUE_HISTORY.feats.push({
    leagueYear: 2030, day: 5, playerId: 'p1', playerName: 'Test', teamId: 'BOS',
    oppTeamId: 'LAL', kind: 'tripleDouble', points: 30, rebounds: 10, assists: 10, steals: 1, blocks: 1
  });
  history.LEAGUE_HISTORY.teamSeasons.push({
    leagueYear: 2030, teamId: 'BOS', wins: 60, losses: 22, playoffResult: 'champion', champion: true
  });

  const gs = makeTestGameState();
  saveToSlot(gs, 'roundtrip-history');
  history.LEAGUE_HISTORY.feats.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  loadFromSlot('roundtrip-history');

  assert.strictEqual(history.LEAGUE_HISTORY.feats.length, 1, 'feats must survive a save/load');
  assert.strictEqual(history.LEAGUE_HISTORY.feats[0].kind, 'tripleDouble');
  assert.strictEqual(history.LEAGUE_HISTORY.teamSeasons.length, 1, 'team seasons must survive');
  console.log('checkNewHistoryStoresRoundTrip: OK');
}

// A save written before these fields existed must still load.
function checkOldSaveWithoutNewFieldsLoads() {
  const history = require(path.join(__dirname, '..', 'history.js'));
  const payload = { leagueHistory: { retiredPlayers: [], trades: [], draftClasses: [], awardsHistory: [], champions: [] } };
  history.LEAGUE_HISTORY.feats.length = 0;
  applyLoadedPayload(payload);
  assert.ok(Array.isArray(history.LEAGUE_HISTORY.feats),
    'an old save must leave feats an empty array, not undefined');
  console.log('checkOldSaveWithoutNewFieldsLoads: OK');
}

checkNewHistoryStoresRoundTrip();
checkOldSaveWithoutNewFieldsLoads();
```

Use whatever helper names `validate-save.js` already defines for building a test
game state and applying a payload; the two above are placeholders for those
existing helpers and must be replaced with the real names when implementing.

- [ ] **Step 2: Run the full suite**

Run: `for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done`
Expected: no output. 54 files.

- [ ] **Step 3: Measure the save cost**

Run a 10-season league and report, in the commit message, the byte size of
`LEAGUE_HISTORY.feats` and `.teamSeasons` against the total save size. Add an
assertion to `scripts/validate-feats.js` that per-season feat bytes stay under
100KB, so this cannot quietly become a second play-by-play.

- [ ] **Step 4: Browser verification**

Play a full season. Confirm: a feat appears in the live feed as it happens; the
Feats page lists it; a player profile shows his feats; every toy in Frivolities
opens. Run `UI_SMOKE.run()` and confirm zero failures.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-save.js scripts/validate-feats.js
git commit -m "test: the new history stores survive a save, old saves still load"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: feats detection (1),
calibration (2), filing from all three call sites plus the static guard (3),
the page/feed/profile (4); the `teamSeasons` record (5), the four toy families
(6, 7, 8) and the Frivolities index (9); family links (10), generation with the
timeline rule and rate bands (11), display (12); save round-trip, old-save
compatibility and byte ceiling (13).

**Placeholder scan.** One deliberate gap remains and is marked as such: Task 13
Step 1 uses `makeTestGameState` / `applyLoadedPayload` as stand-ins for whatever
helpers `validate-save.js` already defines, with an instruction to substitute
the real names. Everything else is complete code.

**Type consistency.** `detectFeats(line, context)` returns records whose fields
are consumed unchanged by `recordFeats`, `ui/feats.js` and the profile panel.
`candidatePool()` entries use `playerId`/`name`/`production` throughout Tasks
6–9. `teamSeasons` rows use `wins`/`losses`/`playoffResult`/`champion` in Tasks
5, 8 and 9. `relatives.link(a, b, type)` and `relativesOf(player)` keep their
signatures across Tasks 10–12. `mostLopsidedTrades(limit, currentYear)` takes
its year as a parameter in both its test and its caller.

**Known risk, called out rather than hidden.** Task 11 changes draft-class
generation, which will move the season-rollover golden. That is expected and the
task says to regenerate it. The **gamesim** golden must not move; if it does,
something has changed simulation and the task is wrong.
