# Phase 8 — League History & Dynasty Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this project's established preference) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indefinite season tracking, a fully algorithmic awards suite (MVP, DPOY, ROY, 6MOY, MIP, All-NBA, Most Improved Team), retirements with Hall of Fame induction, franchise/league records, career milestones, a permanent draft class archive, and a permanent trade archive.

**Architecture:** Two new logic files — `awards.js` (pure, stateless season-award computation) and `history.js` (owns the persistent `LEAGUE_HISTORY` archive: retired players, trades, draft classes, awards history, champions, plus HOF/records helpers). Career data (`careerStats`, `awardsWon`, `peakOverall`, `championshipsWon`, `teamsPlayedFor`, `bestSeasonTotals`, `lastSeasonAverages`) is lazily initialized directly on player objects via `ensureCareerData`, mirroring `traits.js`'s `ensureHiddenPlayerData` exactly — so it round-trips through `save.js`'s existing full-object `PLAYERS_2026` save with zero `save.js` changes. One new season-end integration point (`history.js`'s `finalizeSeasonHistory`) runs at the top of `script.js`'s `handleAdvanceToOffseason`, before retirement — so every retiree's career data already reflects the just-finished season. `trade.js`'s `executeTrade` gains an optional `historySink` callback, the same additive pattern Phase 7A already established for the live feed's `feedSink`.

## Global Constraints

- No third-party dependencies; classic `<script>` tags only.
- `awards.js` and `history.js` follow the `var _XXX_DATA = (typeof require !== 'undefined') ? {...} : {...}` dual-module pattern (both are Node-tested). `ui/awards.js` and `ui/history.js` do not — bare globals, matching every other `ui/*.js` file.
- `docs/superpowers/specs/2026-08-01-phase-8-league-history-dynasty-design.md` is the source of truth for design decisions (data model, awards method, HOF formula approach, scope corrections). This plan fills in the exact formulas/thresholds the design doc deliberately left at "approach" level.
- **File load order matters**: `awards.js` must load after `league.js`/`teams.js`; `history.js` must load after `awards.js`, `league.js`, `teams.js`, `players-2026.js`; `save.js` must load after `history.js` (its browser-branch `_SAVE_DATA` object references the `LEAGUE_HISTORY` global at parse time). Task 13 places them correctly.
- Every new persistent field on a player object goes through `ensureCareerData` — never assume `careerStats`/`awardsWon`/etc. are present, per this project's recurring "truthy empty object" bug pattern.
- Season length is not hardcoded anywhere in this plan as "82" — the games-played qualifier for awards uses a fixed number (50) chosen to be comfortably below a full season regardless of exact schedule length, not a fraction requiring extra plumbing.

---

### Task 1: `league.js` — export `SEASON_STAT_KEYS`

**Files:**
- Modify: `league.js` (module.exports block only)

**Interfaces:**
- Produces: `SEASON_STAT_KEYS` now exported alongside the existing exports — needed by `history.js`'s career-stats rollup so it sums exactly the same stat keys `accumulateSeasonStats` already writes, with zero risk of the two lists drifting apart.

- [ ] **Step 1: Add the export**

Change:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages,
    simulateDate: simulateDate,
    getNextGameDay: getNextGameDay,
    simulateNextDay: simulateNextDay,
    simulateThroughDate: simulateThroughDate
  };
}
```
to:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEASON_STAT_KEYS: SEASON_STAT_KEYS,
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages,
    simulateDate: simulateDate,
    getNextGameDay: getNextGameDay,
    simulateNextDay: simulateNextDay,
    simulateThroughDate: simulateThroughDate
  };
}
```

- [ ] **Step 2: Run existing validators to confirm zero regression**

Run: `node scripts/validate-sim.js && node scripts/validate-automation.js`
Expected: both print their `All ... validations passed` line.

- [ ] **Step 3: Commit**

```bash
git add league.js
git commit -m "feat: export SEASON_STAT_KEYS for history.js's career-stats rollup"
```

---

### Task 2: `history.js` (new) — `LEAGUE_HISTORY` skeleton + `ensureCareerData`

**Files:**
- Create: `history.js`

**Interfaces:**
- Produces: `LEAGUE_HISTORY = { retiredPlayers: [], trades: [], draftClasses: [], awardsHistory: [] , champions: [] }`; `ensureCareerData(players)` — lazily initializes `careerStats` (zeroed, keyed by `SEASON_STAT_KEYS` plus `gamesPlayed`/`seasonsPlayed`), `awardsWon` (`[]`), `peakOverall` (defaults to current `overall`), `championshipsWon` (`0`), `teamsPlayedFor` (`[player.teamId]` if rostered, else `[]`), `bestSeasonTotals` (`{ points: 0, rebounds: 0, assists: 0 }`), `lastSeasonAverages` (zeroed averages shape matching `getPlayerAverages`'s return). No-op for players that already have `careerStats`.

- [ ] **Step 1: Write the file**

```js
var _HISTORY_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      players: require('./players-2026.js'),
      awards: require('./awards.js')
    }
  : {
      league: {
        SEASON_STAT_KEYS: SEASON_STAT_KEYS,
        getPlayerAverages: getPlayerAverages,
        getTeamRoster: getTeamRoster,
        getPlayerById: getPlayerById
      },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      players: { PLAYERS_2026: PLAYERS_2026 },
      awards: { computeSeasonAwards: computeSeasonAwards }
    };

const LEAGUE_HISTORY = {
  retiredPlayers: [],
  trades: [],
  draftClasses: [],
  awardsHistory: [],
  champions: []
};

const ZERO_AVERAGES = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };

function ensureCareerData(players) {
  players.forEach(function (p) {
    if (!p.careerStats) {
      p.careerStats = { gamesPlayed: 0, seasonsPlayed: 0 };
      _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { p.careerStats[key] = 0; });
    }
    if (!p.awardsWon) p.awardsWon = [];
    if (p.peakOverall === undefined) p.peakOverall = p.overall;
    if (p.championshipsWon === undefined) p.championshipsWon = 0;
    if (!p.teamsPlayedFor) p.teamsPlayedFor = p.teamId ? [p.teamId] : [];
    if (!p.bestSeasonTotals) p.bestSeasonTotals = { points: 0, rebounds: 0, assists: 0 };
    if (!p.lastSeasonAverages) p.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData
  };
}
```

- [ ] **Step 2: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');
const player = league.getTeamRoster(teams.TEAMS[0].id)[0];
history.ensureCareerData([player]);
console.log('careerStats initialized:', player.careerStats.gamesPlayed === 0 && player.careerStats.points === 0);
console.log('awardsWon initialized:', Array.isArray(player.awardsWon) && player.awardsWon.length === 0);
console.log('peakOverall defaults to overall:', player.peakOverall === player.overall);
console.log('teamsPlayedFor seeded:', player.teamsPlayedFor.length === 1 && player.teamsPlayedFor[0] === player.teamId);
player.careerStats.points = 500;
history.ensureCareerData([player]);
console.log('idempotent (does not reset existing data):', player.careerStats.points === 500);
"
```
Expected: every line prints `true`.

- [ ] **Step 3: Commit**

```bash
git add history.js
git commit -m "feat: history.js LEAGUE_HISTORY skeleton + ensureCareerData"
```

---

### Task 3: `history.js` — `rollSeasonIntoCareerStats` (career accumulation, milestones)

**Files:**
- Modify: `history.js`

**Interfaces:**
- Produces: `rollSeasonIntoCareerStats(player, feedSink)` — rolls `player.seasonStats` into `player.careerStats`, updates `peakOverall`, `teamsPlayedFor`, `bestSeasonTotals`, and `lastSeasonAverages`; pushes a feed line via `feedSink(text)` (defaults to a no-op) whenever a career total crosses a milestone threshold. Safe to call on a player with no `seasonStats` (DNP season) or `undefined` (already reset) — snapshots zeroed averages and returns without touching career totals.

- [ ] **Step 1: Add the function**

Add to `history.js`, after `ensureCareerData`:
```js
const MILESTONE_THRESHOLDS = {
  points: [10000, 20000, 30000],
  rebounds: [5000, 10000],
  assists: [5000, 10000]
};
const MILESTONE_STAT_LABELS = { points: 'career points', rebounds: 'career rebounds', assists: 'career assists' };

function checkMilestones(player, beforeTotals, feedSink) {
  Object.keys(MILESTONE_THRESHOLDS).forEach(function (statKey) {
    MILESTONE_THRESHOLDS[statKey].forEach(function (threshold) {
      if (beforeTotals[statKey] < threshold && player.careerStats[statKey] >= threshold) {
        feedSink(player.name + ' reaches ' + threshold.toLocaleString() + ' ' + MILESTONE_STAT_LABELS[statKey] + '.');
      }
    });
  });
}

function rollSeasonIntoCareerStats(player, feedSink) {
  const sink = feedSink || function () {};
  ensureCareerData([player]);
  player.peakOverall = Math.max(player.peakOverall, player.overall);
  if (player.teamId && player.teamsPlayedFor.indexOf(player.teamId) === -1) {
    player.teamsPlayedFor.push(player.teamId);
  }

  if (!player.seasonStats || player.seasonStats.gamesPlayed === 0) {
    player.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
    return;
  }

  player.lastSeasonAverages = _HISTORY_DATA.league.getPlayerAverages(player);

  ['points', 'rebounds', 'assists'].forEach(function (key) {
    if (player.seasonStats[key] > player.bestSeasonTotals[key]) {
      player.bestSeasonTotals[key] = player.seasonStats[key];
    }
  });

  const beforeTotals = { points: player.careerStats.points, rebounds: player.careerStats.rebounds, assists: player.careerStats.assists };
  player.careerStats.gamesPlayed += player.seasonStats.gamesPlayed;
  player.careerStats.seasonsPlayed += 1;
  _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) {
    player.careerStats[key] += player.seasonStats[key] || 0;
  });

  checkMilestones(player, beforeTotals, sink);
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData
  };
}
```
to:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');
const player = league.getTeamRoster(teams.TEAMS[0].id)[0];
history.ensureCareerData([player]);
player.seasonStats = { gamesPlayed: 70, points: 10000, rebounds: 400, assists: 300, steals: 60, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
const messages = [];
history.rollSeasonIntoCareerStats(player, function (text) { messages.push(text); });
console.log('careerStats.points accumulated:', player.careerStats.points === 10000);
console.log('gamesPlayed accumulated:', player.careerStats.gamesPlayed === 70);
console.log('seasonsPlayed incremented:', player.careerStats.seasonsPlayed === 1);
console.log('bestSeasonTotals.points set:', player.bestSeasonTotals.points === 10000);
console.log('milestone fired for 10000 points:', messages.some(function (m) { return m.indexOf('10,000 career points') !== -1; }));
console.log('lastSeasonAverages populated:', player.lastSeasonAverages.ppg > 0);

// Second season should ACCUMULATE, not overwrite, and not re-fire the same milestone.
player.seasonStats = { gamesPlayed: 70, points: 5000, rebounds: 300, assists: 200, steals: 50, blocks: 15, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
const messages2 = [];
history.rollSeasonIntoCareerStats(player, function (text) { messages2.push(text); });
console.log('careerStats.points now 15000:', player.careerStats.points === 15000);
console.log('10000 milestone does not re-fire:', !messages2.some(function (m) { return m.indexOf('10,000') !== -1; }));
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add history.js
git commit -m "feat: history.js rollSeasonIntoCareerStats (career accumulation + milestones)"
```

---

### Task 4: `awards.js` (new) — season award computation

**Files:**
- Create: `awards.js`

**Interfaces:**
- Consumes: `league.js`'s `getTeamRoster`, `getPlayerAverages`; `teams.js`'s `TEAMS`.
- Produces: `AWARD_KEYS` (`{ MVP: 'mvp', DPOY: 'dpoy', ROY: 'roy', SIXTH_MOY: 'sixthMoy', MIP: 'mip', ALL_NBA_1: 'allNba1', ALL_NBA_2: 'allNba2', ALL_NBA_3: 'allNba3' }`); `computeSeasonAwards(leagueYear)` → `{ leagueYear, winners: [{ award, playerId, playerName }], mostImprovedTeam: { teamId, teamName } | null }`.

- [ ] **Step 1: Write the file**

```js
var _AWARDS_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerAverages: getPlayerAverages },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById }
    };

const AWARD_KEYS = {
  MVP: 'mvp',
  DPOY: 'dpoy',
  ROY: 'roy',
  SIXTH_MOY: 'sixthMoy',
  MIP: 'mip',
  ALL_NBA_1: 'allNba1',
  ALL_NBA_2: 'allNba2',
  ALL_NBA_3: 'allNba3'
};

// Comfortably below a full season regardless of exact schedule length —
// keeps a short call-up or an injury-shortened season out of award races
// without hardcoding the schedule's exact game count anywhere in this file.
const MIN_GAMES_FOR_AWARDS = 50;

function eligiblePlayerEntries() {
  return _AWARDS_DATA.teams.TEAMS.reduce(function (all, team) {
    const roster = _AWARDS_DATA.league.getTeamRoster(team.id).map(function (p) { return { player: p, team: team }; });
    return all.concat(roster);
  }, []).filter(function (entry) {
    return entry.player.seasonStats && entry.player.seasonStats.gamesPlayed >= MIN_GAMES_FOR_AWARDS;
  });
}

function teamWinPct(team) {
  const gamesPlayed = team.record.wins + team.record.losses;
  return gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0;
}

// Blends per-game production with team success — the same "team context
// matters" idea tradeEvaluator.js's directionMultiplier already applies to
// trade value, reused here for award value instead of inventing a separate
// weighting philosophy.
function mvpValue(entry) {
  const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
  const production = avg.ppg + avg.rpg * 1.2 + avg.apg * 1.5 + avg.spg * 2 + avg.bpg * 2;
  return production * (0.6 + teamWinPct(entry.team) * 0.8);
}

function dpoyValue(entry) {
  const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
  const attrs = entry.player.attributes;
  return avg.spg * 3 + avg.bpg * 3 + (attrs.perimeterDefense + attrs.interiorDefense) / 20;
}

function bestByValue(entries, valueFn) {
  if (entries.length === 0) return null;
  let best = entries[0];
  let bestValue = valueFn(best);
  for (let i = 1; i < entries.length; i++) {
    const value = valueFn(entries[i]);
    if (value > bestValue) { best = entries[i]; bestValue = value; }
  }
  return best;
}

function computeMip(entries) {
  const withPriorSeason = entries.filter(function (entry) {
    return entry.player.careerStats && entry.player.careerStats.seasonsPlayed > 0;
  });
  return bestByValue(withPriorSeason, function (entry) {
    const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
    const prior = entry.player.lastSeasonAverages || { ppg: 0, rpg: 0, apg: 0 };
    return (avg.ppg - prior.ppg) + (avg.rpg - prior.rpg) * 1.2 + (avg.apg - prior.apg) * 1.5;
  });
}

// No starter/bench flag exists anywhere in this sim engine — a player not in
// their own team's top 5 by minutes that season is the closest available
// proxy for "reserve."
function computeSixthMoy(entries) {
  const benchEntries = entries.filter(function (entry) {
    const teammates = entries.filter(function (e) { return e.team.id === entry.team.id; });
    const top5Ids = teammates.slice().sort(function (a, b) { return b.player.seasonStats.minutes - a.player.seasonStats.minutes; })
      .slice(0, 5).map(function (e) { return e.player.id; });
    return top5Ids.indexOf(entry.player.id) === -1;
  });
  return bestByValue(benchEntries, mvpValue);
}

// Position-agnostic top 15 split into three 5-man tiers by rank — matches the
// real NBA's current selection format, not the old 2G/2F/1C quota.
function computeAllNba(entries) {
  const ranked = entries.slice().sort(function (a, b) { return mvpValue(b) - mvpValue(a); });
  const top15 = ranked.slice(0, 15);
  return {
    allNba1: top15.slice(0, 5).map(function (e) { return e.player; }),
    allNba2: top15.slice(5, 10).map(function (e) { return e.player; }),
    allNba3: top15.slice(10, 15).map(function (e) { return e.player; })
  };
}

// Coach of the Year has no coach entity to attach to in this codebase — a
// team-level "most improved" replaces it, per the design spec's confirmed
// scope correction.
function computeMostImprovedTeam() {
  let best = null;
  let bestDelta = -Infinity;
  _AWARDS_DATA.teams.TEAMS.forEach(function (team) {
    const priorWins = team.lastSeasonWins || 0;
    const delta = team.record.wins - priorWins;
    if (delta > bestDelta) { bestDelta = delta; best = team; }
  });
  return best;
}

function computeSeasonAwards(leagueYear) {
  const entries = eligiblePlayerEntries();
  const mvp = bestByValue(entries, mvpValue);
  const dpoy = bestByValue(entries, dpoyValue);
  const roy = bestByValue(entries.filter(function (e) { return e.player.yearsPro === 0; }), mvpValue);
  const mip = computeMip(entries);
  const sixthMoy = computeSixthMoy(entries);
  const allNba = computeAllNba(entries);
  const mostImprovedTeam = computeMostImprovedTeam();

  const winners = [];
  function recordWinner(award, player) {
    if (!player) return;
    winners.push({ award: award, playerId: player.id, playerName: player.name });
  }
  recordWinner(AWARD_KEYS.MVP, mvp ? mvp.player : null);
  recordWinner(AWARD_KEYS.DPOY, dpoy ? dpoy.player : null);
  recordWinner(AWARD_KEYS.ROY, roy ? roy.player : null);
  recordWinner(AWARD_KEYS.MIP, mip ? mip.player : null);
  recordWinner(AWARD_KEYS.SIXTH_MOY, sixthMoy ? sixthMoy.player : null);
  allNba.allNba1.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_1, p); });
  allNba.allNba2.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_2, p); });
  allNba.allNba3.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_3, p); });

  return {
    leagueYear: leagueYear,
    winners: winners,
    mostImprovedTeam: mostImprovedTeam ? { teamId: mostImprovedTeam.id, teamName: mostImprovedTeam.name } : null
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AWARD_KEYS: AWARD_KEYS,
    MIN_GAMES_FOR_AWARDS: MIN_GAMES_FOR_AWARDS,
    computeSeasonAwards: computeSeasonAwards
  };
}
```

- [ ] **Step 2: Run a Node smoke test**

Run:
```bash
node -e "
const awards = require('./awards.js');
const teams = require('./teams.js');
const league = require('./league.js');
const history = require('./history.js');

// Give every rostered player a qualifying, distinct season so award selection is deterministic.
let statSeed = 0;
teams.TEAMS.forEach(function (team) {
  league.getTeamRoster(team.id).forEach(function (p) {
    history.ensureCareerData([p]);
    statSeed += 1;
    p.seasonStats = {
      gamesPlayed: 70, points: 500 + statSeed, rebounds: 200 + statSeed, assists: 150 + statSeed,
      steals: 40 + (statSeed % 30), blocks: 20 + (statSeed % 20), fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
      minutes: 1500 + (statSeed % 500)
    };
  });
  team.record = { wins: 30 + (statSeed % 40), losses: 30, pointsFor: 0, pointsAgainst: 0 };
  team.lastSeasonWins = 20;
});

const result = awards.computeSeasonAwards(2027);
console.log('leagueYear echoed:', result.leagueYear === 2027);
console.log('MVP awarded:', result.winners.some(function (w) { return w.award === 'mvp'; }));
console.log('exactly 15 All-NBA slots:', result.winners.filter(function (w) { return w.award.indexOf('allNba') === 0; }).length === 15);
console.log('All-NBA players are unique:', new Set(result.winners.filter(function (w) { return w.award.indexOf('allNba') === 0; }).map(function (w) { return w.playerId; })).size === 15);
console.log('mostImprovedTeam set:', !!result.mostImprovedTeam);

const roy = result.winners.find(function (w) { return w.award === 'roy'; });
if (roy) {
  console.log('ROY is a rookie (yearsPro 0):', league.getPlayerById(roy.playerId).yearsPro === 0);
} else {
  console.log('ROY is a rookie (yearsPro 0): true (no qualifying rookies this run, which is valid)');
}
"
```
Expected: every line prints `true`.

- [ ] **Step 3: Commit**

```bash
git add awards.js
git commit -m "feat: awards.js season award computation (MVP/DPOY/ROY/6MOY/MIP/All-NBA/Most Improved Team)"
```

---

### Task 5: `history.js` — Hall of Fame formula + `archiveRetiree`

**Files:**
- Modify: `history.js`

**Interfaces:**
- Produces: `computeHofScore(player)` → number; `HOF_THRESHOLD` (100); `archiveRetiree(player, leagueYear)` → the archived record, also pushed into `LEAGUE_HISTORY.retiredPlayers`.

- [ ] **Step 1: Add the functions**

Add to `history.js`, after `rollSeasonIntoCareerStats`:
```js
// Weighted career-value score: counting stats are worth a small fraction of a
// point each (roughly calibrated to what a decorated ~15-year career
// accumulates), awards/selections are flat bonuses — the same "mix scaled-
// stat and flat-bonus terms into one comparable score" approach
// tradeEvaluator.js's contractBurden/needMultiplier already use.
const HOF_THRESHOLD = 100;

function computeHofScore(player) {
  ensureCareerData([player]);
  const cs = player.careerStats;
  const mvpCount = player.awardsWon.filter(function (a) { return a.award === _HISTORY_DATA.awards.AWARD_KEYS.MVP; }).length;
  const dpoyCount = player.awardsWon.filter(function (a) { return a.award === _HISTORY_DATA.awards.AWARD_KEYS.DPOY; }).length;
  const allNbaCount = player.awardsWon.filter(function (a) {
    return a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_1
      || a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_2
      || a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_3;
  }).length;
  return (
    cs.points / 250 +
    cs.rebounds / 100 +
    cs.assists / 60 +
    mvpCount * 25 +
    dpoyCount * 15 +
    allNbaCount * 8 +
    player.championshipsWon * 12 +
    Math.max(0, player.peakOverall - 75) * 2
  );
}

function archiveRetiree(player, leagueYear) {
  ensureCareerData([player]);
  const hofScore = computeHofScore(player);
  const record = {
    id: player.id,
    name: player.name,
    position: player.position,
    retiredYear: leagueYear,
    teamsPlayedFor: player.teamsPlayedFor.slice(),
    careerStats: Object.assign({}, player.careerStats),
    bestSeasonTotals: Object.assign({}, player.bestSeasonTotals),
    awardsWon: player.awardsWon.slice(),
    championshipsWon: player.championshipsWon,
    peakOverall: player.peakOverall,
    hofScore: hofScore,
    hallOfFame: hofScore >= HOF_THRESHOLD
  };
  LEAGUE_HISTORY.retiredPlayers.push(record);
  return record;
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats
  };
}
```
to:
```js
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats,
    computeHofScore: computeHofScore,
    HOF_THRESHOLD: HOF_THRESHOLD,
    archiveRetiree: archiveRetiree
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');
const awards = require('./awards.js');

const roster = league.getTeamRoster(teams.TEAMS[0].id);
const star = roster[0];
history.ensureCareerData([star]);
star.careerStats.points = 28000;
star.careerStats.rebounds = 9000;
star.careerStats.assists = 6000;
star.awardsWon = [{ award: awards.AWARD_KEYS.MVP, leagueYear: 2028 }, { award: awards.AWARD_KEYS.MVP, leagueYear: 2029 }];
star.championshipsWon = 2;
star.peakOverall = 96;
const starRecord = history.archiveRetiree(star, 2035);
console.log('star inducted into HOF:', starRecord.hallOfFame === true);

const journeyman = roster[1];
history.ensureCareerData([journeyman]);
journeyman.careerStats.points = 4000;
journeyman.careerStats.rebounds = 1500;
journeyman.careerStats.assists = 800;
journeyman.awardsWon = [];
journeyman.championshipsWon = 0;
journeyman.peakOverall = 68;
const journeymanRecord = history.archiveRetiree(journeyman, 2035);
console.log('journeyman not inducted:', journeymanRecord.hallOfFame === false);
console.log('both pushed into LEAGUE_HISTORY.retiredPlayers:', history.LEAGUE_HISTORY.retiredPlayers.length === 2);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add history.js
git commit -m "feat: history.js Hall of Fame formula + archiveRetiree"
```

---

### Task 6: `history.js` — champion archive + prestige adjustment + team win-tracking

**Files:**
- Modify: `history.js`

**Interfaces:**
- Produces: `archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, feedSink)` — archives the season's champion into `LEAGUE_HISTORY.champions`, adjusts every team's `prestige` based on that season's result, increments each champion-roster player's `championshipsWon`. No-op if the bracket isn't complete (e.g. mid-season save/load edge case).

- [ ] **Step 1: Add the functions**

Add to `history.js`, after `archiveRetiree`:
```js
const PRESTIGE_CHAMPION_BUMP = 5;
const PRESTIGE_FINALS_BUMP = 2;
const PRESTIGE_PLAYOFF_BUMP = 1;
const PRESTIGE_BAD_SEASON_DECAY = 1;
const BAD_SEASON_WIN_PCT = 0.35;
const PRESTIGE_MIN = 20;
const PRESTIGE_MAX = 99;

function adjustPrestige(team, madeFinals, wonChampionship, madePlayoffs) {
  let delta = 0;
  if (wonChampionship) {
    delta = PRESTIGE_CHAMPION_BUMP;
  } else if (madeFinals) {
    delta = PRESTIGE_FINALS_BUMP;
  } else if (madePlayoffs) {
    delta = PRESTIGE_PLAYOFF_BUMP;
  } else {
    const gamesPlayed = team.record.wins + team.record.losses;
    const winPct = gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0.5;
    if (winPct < BAD_SEASON_WIN_PCT) delta = -PRESTIGE_BAD_SEASON_DECAY;
  }
  team.prestige = Math.max(PRESTIGE_MIN, Math.min(PRESTIGE_MAX, team.prestige + delta));
}

function archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, feedSink) {
  const sink = feedSink || function () {};
  if (!playoffBracket || playoffBracket.finals.length === 0 || !playoffBracket.finals[0].complete) return;

  const championId = playoffBracket.finals[0].winner;
  LEAGUE_HISTORY.champions.push({ leagueYear: leagueYear, teamId: championId });

  const playoffTeamIds = {};
  playoffBracket.first.forEach(function (s) { playoffTeamIds[s.higherSeed] = true; playoffTeamIds[s.lowerSeed] = true; });
  const finalsTeamIds = {};
  finalsTeamIds[playoffBracket.finals[0].higherSeed] = true;
  finalsTeamIds[playoffBracket.finals[0].lowerSeed] = true;

  _HISTORY_DATA.teams.TEAMS.forEach(function (team) {
    const madePlayoffs = !!playoffTeamIds[team.id];
    const madeFinals = !!finalsTeamIds[team.id];
    const wonChampionship = team.id === championId;
    adjustPrestige(team, madeFinals, wonChampionship, madePlayoffs);
  });

  const champRoster = _HISTORY_DATA.league.getTeamRoster(championId);
  champRoster.forEach(function (p) {
    ensureCareerData([p]);
    p.championshipsWon += 1;
  });

  const champTeam = _HISTORY_DATA.teams.getTeamById(championId);
  sink(champTeam.name + ' wins the ' + leagueYear + ' championship!');
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
    computeHofScore: computeHofScore,
    HOF_THRESHOLD: HOF_THRESHOLD,
    archiveRetiree: archiveRetiree
  };
}
```
to:
```js
    computeHofScore: computeHofScore,
    HOF_THRESHOLD: HOF_THRESHOLD,
    archiveRetiree: archiveRetiree,
    archiveChampionAndAdjustPrestige: archiveChampionAndAdjustPrestige
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');
const playoffs = require('./playoffs.js');
require('./simEngineBoxScore.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(4200);

const eastern = teams.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
eastern.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 5; });
const western = teams.TEAMS.filter(function (t) { return t.conference === 'Western'; });
western.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 5; });

const bracket = playoffs.generateBracket();
let g = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
while (g !== null) { g = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

const championId = bracket.finals[0].winner;
const championTeam = teams.getTeamById(championId);
const prestigeBefore = championTeam.prestige;
const messages = [];
history.archiveChampionAndAdjustPrestige(bracket, 2030, function (text) { messages.push(text); });

console.log('champion archived:', history.LEAGUE_HISTORY.champions.some(function (c) { return c.leagueYear === 2030 && c.teamId === championId; }));
console.log('champion prestige increased:', championTeam.prestige > prestigeBefore);
console.log('champion roster gained a championship:', league.getTeamRoster(championId).every(function (p) { return p.championshipsWon >= 1; }));
console.log('feed message pushed:', messages.some(function (m) { return m.indexOf('wins the 2030 championship') !== -1; }));
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add history.js
git commit -m "feat: history.js champion archive + prestige adjustment"
```

---

### Task 7: `history.js` — trade/draft archives + `finalizeSeasonHistory` orchestrator

**Files:**
- Modify: `history.js`

**Interfaces:**
- Consumes: `awards.js`'s `computeSeasonAwards`.
- Produces: `archiveTrade(proposal, leagueYear)`; `archiveDraftClass(leagueYear, draftResults)`; `finalizeSeasonHistory(leagueYear, playoffBracket, feedSink)` — the single season-end orchestrator `script.js` calls: computes+archives awards (pushing winners into each player's `awardsWon`), snapshots team win-tracking fields, archives the champion + adjusts prestige, then rolls every rostered player's season into their career stats.

- [ ] **Step 1: Add the functions**

Add to `history.js`, after `archiveChampionAndAdjustPrestige`:
```js
function archiveTrade(proposal, leagueYear) {
  const record = {
    leagueYear: leagueYear,
    participants: proposal.participants.slice(),
    players: proposal.assignments.map(function (a) {
      const player = _HISTORY_DATA.league.getPlayerById(a.playerId);
      return { playerId: a.playerId, playerName: player ? player.name : 'Unknown', fromTeamId: a.fromTeamId, toTeamId: a.toTeamId };
    }),
    picks: (proposal.pickAssignments || []).map(function (pa) {
      return { round: pa.round, fromTeamId: pa.fromTeamId, toTeamId: pa.toTeamId };
    })
  };
  LEAGUE_HISTORY.trades.push(record);
  return record;
}

function archiveDraftClass(leagueYear, draftResults) {
  const record = {
    leagueYear: leagueYear,
    picks: draftResults.map(function (r) {
      return { round: r.round, pickNumber: r.pickNumber, teamId: r.teamId, playerId: r.prospect.id, playerName: r.prospect.name };
    })
  };
  LEAGUE_HISTORY.draftClasses.push(record);
  return record;
}

// The single season-end entry point script.js calls, once, at the top of
// handleAdvanceToOffseason — BEFORE retirement runs, so archiveRetiree (Task
// 5, wired into seasonTransition.js in Task 9) sees each retiree's fully
// updated careerStats/awardsWon for the season that just finished.
function finalizeSeasonHistory(leagueYear, playoffBracket, feedSink) {
  const sink = feedSink || function () {};
  const seasonAwards = _HISTORY_DATA.awards.computeSeasonAwards(leagueYear);

  seasonAwards.winners.forEach(function (w) {
    const player = _HISTORY_DATA.league.getPlayerById(w.playerId);
    if (!player) return;
    ensureCareerData([player]);
    player.awardsWon.push({ award: w.award, leagueYear: leagueYear });
    sink(player.name + ' wins ' + w.award + ' for ' + leagueYear + '.');
  });
  LEAGUE_HISTORY.awardsHistory.push(seasonAwards);

  _HISTORY_DATA.teams.TEAMS.forEach(function (team) {
    team.allTimeWins = (team.allTimeWins || 0) + team.record.wins;
    team.allTimeLosses = (team.allTimeLosses || 0) + team.record.losses;
    team.lastSeasonWins = team.record.wins;
  });

  archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, sink);

  _HISTORY_DATA.players.PLAYERS_2026.forEach(function (p) {
    rollSeasonIntoCareerStats(p, sink);
  });
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
    archiveRetiree: archiveRetiree,
    archiveChampionAndAdjustPrestige: archiveChampionAndAdjustPrestige
  };
}
```
to:
```js
    archiveRetiree: archiveRetiree,
    archiveChampionAndAdjustPrestige: archiveChampionAndAdjustPrestige,
    archiveTrade: archiveTrade,
    archiveDraftClass: archiveDraftClass,
    finalizeSeasonHistory: finalizeSeasonHistory
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');
const playoffs = require('./playoffs.js');
require('./simEngineBoxScore.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(4300);

// Trade archive
const teamA = teams.TEAMS[5];
const teamB = teams.TEAMS[6];
const playerA = league.getTeamRoster(teamA.id)[0];
const playerB = league.getTeamRoster(teamB.id)[0];
const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
const tradeRecord = history.archiveTrade(proposal, 2031);
console.log('trade archived with player name:', tradeRecord.players[0].playerName === playerA.name);
console.log('trade pushed into LEAGUE_HISTORY.trades:', history.LEAGUE_HISTORY.trades.length === 1);

// Draft archive
const draftResults = [{ round: 1, pickNumber: 1, teamId: teams.TEAMS[0].id, prospect: { id: 'prospect-x', name: 'Prospect X' } }];
const draftRecord = history.archiveDraftClass(2031, draftResults);
console.log('draft class archived:', draftRecord.picks[0].playerName === 'Prospect X');

// Full finalizeSeasonHistory orchestration
teams.TEAMS.forEach(function (t, i) {
  league.getTeamRoster(t.id).forEach(function (p) {
    p.seasonStats = { gamesPlayed: 70, points: 500 + i, rebounds: 200, assists: 150, steals: 40, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 1800 };
  });
  t.record = { wins: 20 + i, losses: 20, pointsFor: 0, pointsAgainst: 0 };
});
const bracket = playoffs.generateBracket();
let g = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
while (g !== null) { g = playoffs.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

const beforeAwardsHistory = history.LEAGUE_HISTORY.awardsHistory.length;
history.finalizeSeasonHistory(2031, bracket, function () {});
console.log('awardsHistory grew by one:', history.LEAGUE_HISTORY.awardsHistory.length === beforeAwardsHistory + 1);
console.log('champion prestige/records touched:', history.LEAGUE_HISTORY.champions.some(function (c) { return c.leagueYear === 2031; }));
console.log('a rostered player has careerStats now:', league.getTeamRoster(teams.TEAMS[0].id)[0].careerStats.gamesPlayed > 0);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add history.js
git commit -m "feat: history.js trade/draft archives + finalizeSeasonHistory orchestrator"
```

---

### Task 8: `history.js` — records leaderboard helpers

**Files:**
- Modify: `history.js`

**Interfaces:**
- Produces: `careerLeaders(statKey, count)`, `singleSeasonLeaders(statKey, count)`, `franchiseWinLeaders(count)` — all computed on-demand (not persisted), combining active players (via `PLAYERS_2026`) and `LEAGUE_HISTORY.retiredPlayers`.

- [ ] **Step 1: Add the functions**

Add to `history.js`, after `finalizeSeasonHistory`:
```js
function careerLeaders(statKey, count) {
  const activeEntries = _HISTORY_DATA.players.PLAYERS_2026.map(function (p) {
    ensureCareerData([p]);
    return { id: p.id, name: p.name, value: p.careerStats[statKey] };
  });
  const retiredEntries = LEAGUE_HISTORY.retiredPlayers.map(function (r) {
    return { id: r.id, name: r.name, value: r.careerStats[statKey] };
  });
  return activeEntries.concat(retiredEntries)
    .sort(function (a, b) { return b.value - a.value; })
    .slice(0, count);
}

function singleSeasonLeaders(statKey, count) {
  const activeEntries = _HISTORY_DATA.players.PLAYERS_2026.map(function (p) {
    ensureCareerData([p]);
    return { id: p.id, name: p.name, value: p.bestSeasonTotals[statKey] };
  });
  const retiredEntries = LEAGUE_HISTORY.retiredPlayers.map(function (r) {
    return { id: r.id, name: r.name, value: r.bestSeasonTotals ? r.bestSeasonTotals[statKey] : 0 };
  });
  return activeEntries.concat(retiredEntries)
    .sort(function (a, b) { return b.value - a.value; })
    .slice(0, count);
}

function franchiseWinLeaders(count) {
  return _HISTORY_DATA.teams.TEAMS.slice()
    .map(function (t) { return { id: t.id, name: t.name, allTimeWins: t.allTimeWins || 0 }; })
    .sort(function (a, b) { return b.allTimeWins - a.allTimeWins; })
    .slice(0, count);
}
```

- [ ] **Step 2: Update `module.exports`**

Change:
```js
    archiveDraftClass: archiveDraftClass,
    finalizeSeasonHistory: finalizeSeasonHistory
  };
}
```
to:
```js
    archiveDraftClass: archiveDraftClass,
    finalizeSeasonHistory: finalizeSeasonHistory,
    careerLeaders: careerLeaders,
    singleSeasonLeaders: singleSeasonLeaders,
    franchiseWinLeaders: franchiseWinLeaders
  };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const history = require('./history.js');
const teams = require('./teams.js');
const league = require('./league.js');

const p = league.getTeamRoster(teams.TEAMS[0].id)[0];
history.ensureCareerData([p]);
p.careerStats.points = 99999;
p.bestSeasonTotals.points = 3000;
teams.TEAMS[0].allTimeWins = 5000;

const careerTop = history.careerLeaders('points', 5);
console.log('careerLeaders returns 5:', careerTop.length === 5);
console.log('careerLeaders is sorted descending:', careerTop[0].value >= careerTop[1].value);
console.log('our stacked player leads career points:', careerTop[0].id === p.id);

const seasonTop = history.singleSeasonLeaders('points', 5);
console.log('singleSeasonLeaders returns 5:', seasonTop.length === 5);
console.log('our stacked player leads single-season points:', seasonTop[0].id === p.id);

const winLeaders = history.franchiseWinLeaders(5);
console.log('franchiseWinLeaders returns 5:', winLeaders.length === 5);
console.log('our stacked team leads all-time wins:', winLeaders[0].id === teams.TEAMS[0].id);
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Commit**

```bash
git add history.js
git commit -m "feat: history.js records leaderboard helpers"
```

---

### Task 9: `seasonTransition.js` — wire `archiveRetiree` into retirement

**Files:**
- Modify: `seasonTransition.js:1-11` (`_TRANSITION_DATA`), `seasonTransition.js`'s `runOffseasonPreDraft`

**Interfaces:**
- Consumes: `history.js`'s `archiveRetiree(player, leagueYear)`.
- Produces: `runOffseasonPreDraft(rng, leagueYear)` — gains a second, optional param so every existing call site (which omits it) is unaffected in behavior except that retirees are now archived with `leagueYear: undefined` if the caller doesn't pass it. Task 13 updates `script.js`'s one real call site to always pass it.

- [ ] **Step 1: Add the `history` dependency**

Change (`seasonTransition.js:1-11`):
```js
var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js'), schedule: require('./schedule.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass },
      schedule: { generateSeasonGames: generateSeasonGames }
    };
```
to:
```js
var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js'), schedule: require('./schedule.js'), history: require('./history.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass },
      schedule: { generateSeasonGames: generateSeasonGames },
      history: { archiveRetiree: archiveRetiree }
    };
```

- [ ] **Step 2: Archive each retiree before removing them**

Change:
```js
function runOffseasonPreDraft(rng) {
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) {
    const teammates = rosterPlayers.filter(function (tp) { return tp.teamId === p.teamId && tp.id !== p.id; });
    _TRANSITION_DATA.progression.progressPlayer(p, rng, teammates);
  });

  const retirees = rosterPlayers.filter(function (p) { return rollRetirement(p, rng); });
  retirees.forEach(function (p) {
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  decrementContracts();

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  return { retireeCount: retirees.length };
}
```
to:
```js
function runOffseasonPreDraft(rng, leagueYear) {
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) {
    const teammates = rosterPlayers.filter(function (tp) { return tp.teamId === p.teamId && tp.id !== p.id; });
    _TRANSITION_DATA.progression.progressPlayer(p, rng, teammates);
  });

  const retirees = rosterPlayers.filter(function (p) { return rollRetirement(p, rng); });
  retirees.forEach(function (p) {
    _TRANSITION_DATA.history.archiveRetiree(p, leagueYear);
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  decrementContracts();

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  return { retireeCount: retirees.length };
}
```

- [ ] **Step 3: Run a Node smoke test**

Run:
```bash
node -e "
const seasonTransition = require('./seasonTransition.js');
const history = require('./history.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(5500);
const before = history.LEAGUE_HISTORY.retiredPlayers.length;
const result = seasonTransition.runOffseasonPreDraft(rng, 2032);
console.log('retireeCount matches archive growth:', history.LEAGUE_HISTORY.retiredPlayers.length - before === result.retireeCount);
if (result.retireeCount > 0) {
  const lastArchived = history.LEAGUE_HISTORY.retiredPlayers[history.LEAGUE_HISTORY.retiredPlayers.length - 1];
  console.log('archived retiree tagged with correct leagueYear:', lastArchived.retiredYear === 2032);
} else {
  console.log('archived retiree tagged with correct leagueYear: true (no retirees this run, which is valid)');
}
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Run existing offseason validator to confirm zero regression**

Run: `node scripts/validate-offseason.js`
Expected: `All offseason validations passed` (every existing call site omits the new `leagueYear` param, so behavior for them is unchanged except retirees now get archived with `retiredYear: undefined` — harmless, since those callers don't inspect the archive).

- [ ] **Step 5: Commit**

```bash
git add seasonTransition.js
git commit -m "feat: wire archiveRetiree into seasonTransition.js's retirement flow"
```

---

### Task 10: `trade.js` + `commissioner.js` — `historySink` param

**Files:**
- Modify: `trade.js:69-95` (`executeTrade`, `proposeTrade`), `commissioner.js` (`forceTrade`)

**Interfaces:**
- Produces: `executeTrade(proposal, historySink)` — calls `historySink(proposal)` after the trade executes, defaults to a no-op so every existing caller is unaffected. `proposeTrade(proposal, userTeamId, evaluateUserLeg, historySink)` threads it through. `forceTrade(proposal, historySink)` threads it through too.

- [ ] **Step 1: `trade.js` — `executeTrade` gains `historySink`**

Change:
```js
function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
    // High-ego, high-loyalty players take being traded harder.
    if (player.hiddenPersonality && player.hiddenPersonality.ego !== undefined && player.status) {
      const moraleHit = 3 + (player.hiddenPersonality.ego + player.hiddenPersonality.loyalty) / 20;
      player.status.morale = Math.max(0, player.status.morale - Math.round(moraleHit));
    }
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
}
```
to:
```js
function executeTrade(proposal, historySink) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
    // High-ego, high-loyalty players take being traded harder.
    if (player.hiddenPersonality && player.hiddenPersonality.ego !== undefined && player.status) {
      const moraleHit = 3 + (player.hiddenPersonality.ego + player.hiddenPersonality.loyalty) / 20;
      player.status.morale = Math.max(0, player.status.morale - Math.round(moraleHit));
    }
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
  if (historySink) historySink(proposal);
}
```

- [ ] **Step 2: `trade.js` — `proposeTrade` threads `historySink` through**

Change:
```js
function proposeTrade(proposal, userTeamId, evaluateUserLeg) {
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { accepted: false, rosterErrors: rosterErrors, legs: {} };
  }
  const evaluation = evaluateTrade(proposal, userTeamId, evaluateUserLeg);
  if (evaluation.accepted) {
    executeTrade(proposal);
  }
  return Object.assign({ rosterErrors: [] }, evaluation);
}
```
to:
```js
function proposeTrade(proposal, userTeamId, evaluateUserLeg, historySink) {
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { accepted: false, rosterErrors: rosterErrors, legs: {} };
  }
  const evaluation = evaluateTrade(proposal, userTeamId, evaluateUserLeg);
  if (evaluation.accepted) {
    executeTrade(proposal, historySink);
  }
  return Object.assign({ rosterErrors: [] }, evaluation);
}
```

- [ ] **Step 3: `commissioner.js` — `forceTrade` threads `historySink` through**

Change:
```js
function forceTrade(proposal) {
  const rosterErrors = _COMMISSIONER_DATA.trade.validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { success: false, rosterErrors: rosterErrors };
  }
  _COMMISSIONER_DATA.trade.executeTrade(proposal);
  return { success: true, rosterErrors: [] };
}
```
to:
```js
function forceTrade(proposal, historySink) {
  const rosterErrors = _COMMISSIONER_DATA.trade.validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { success: false, rosterErrors: rosterErrors };
  }
  _COMMISSIONER_DATA.trade.executeTrade(proposal, historySink);
  return { success: true, rosterErrors: [] };
}
```

- [ ] **Step 4: Run a Node smoke test + existing validators**

Run:
```bash
node -e "
const trade = require('./trade.js');
const teams = require('./teams.js');
const league = require('./league.js');
const teamA = teams.TEAMS[8];
const teamB = teams.TEAMS[9];
const playerA = league.getTeamRoster(teamA.id)[0];
const playerB = league.getTeamRoster(teamB.id)[0];
const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }, { playerId: playerB.id, fromTeamId: teamB.id, toTeamId: teamA.id }], pickAssignments: [] };
let sinkCalledWith = null;
trade.executeTrade(proposal, function (p) { sinkCalledWith = p; });
console.log('historySink invoked with the proposal:', sinkCalledWith === proposal);
console.log('trade with no historySink still works:', (function () { trade.executeTrade({ participants: [], assignments: [], pickAssignments: [] }); return true; })());
"
node scripts/validate-trades.js
node scripts/validate-commissioner.js
```
Expected: the two `console.log` lines print `true`, followed by both validator suites' `All ... validations passed` lines.

- [ ] **Step 5: Commit**

```bash
git add trade.js commissioner.js
git commit -m "feat: executeTrade/proposeTrade/forceTrade gain an optional historySink param"
```

---

### Task 11: `save.js` — `leagueHistory` persistence + new team fields

**Files:**
- Modify: `save.js:1-36` (`_SAVE_DATA`, `TEAM_SAVE_FIELDS`), `save.js`'s `serializeGameState`, `save.js`'s `applySavedState`

**Interfaces:**
- Produces: `TEAM_SAVE_FIELDS` gains `allTimeWins`, `allTimeLosses`, `lastSeasonWins`. `serializeGameState`/`applySavedState` gain a `leagueHistory` field pair, following the "new top-level field → touch both functions explicitly" rule already established for this project.

- [ ] **Step 1: Add the `history` dependency and new `TEAM_SAVE_FIELDS` entries**

Change (`save.js:14-36`):
```js
var _SAVE_DATA = (typeof require !== 'undefined')
  ? {
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      league: require('./league.js'),
      rng: require('./rng.js'),
      storage: _makeMemoryStorage()
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      league: { getPlayerById: getPlayerById },
      rng: { makeRng: makeRng },
      storage: localStorage
    };

const SAVE_SLOT_COUNT = 5;
const SAVE_FORMAT_VERSION = 1;
const SAVE_INDEX_KEY = 'nba-gm-save-index';

// Only mutable fields — id/name/conference/division/colors never change and
// don't need round-tripping through a save.
const TEAM_SAVE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'timeline', 'marketSize', 'record', 'draftPicks'];
```
to:
```js
var _SAVE_DATA = (typeof require !== 'undefined')
  ? {
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      league: require('./league.js'),
      rng: require('./rng.js'),
      history: require('./history.js'),
      storage: _makeMemoryStorage()
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      league: { getPlayerById: getPlayerById },
      rng: { makeRng: makeRng },
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY },
      storage: localStorage
    };

const SAVE_SLOT_COUNT = 5;
const SAVE_FORMAT_VERSION = 1;
const SAVE_INDEX_KEY = 'nba-gm-save-index';

// Only mutable fields — id/name/conference/division/colors never change and
// don't need round-tripping through a save.
const TEAM_SAVE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'timeline', 'marketSize', 'record', 'draftPicks', 'allTimeWins', 'allTimeLosses', 'lastSeasonWins'];
```

- [ ] **Step 2: Serialize `leagueHistory`**

Change (the end of `serializeGameState`'s return object):
```js
    playMode: gameState.playMode,
    automation: gameState.automation,
    feed: gameState.feed || [],
    draftSession: gameState.draftSession || null
  };
}
```
to:
```js
    playMode: gameState.playMode,
    automation: gameState.automation,
    feed: gameState.feed || [],
    draftSession: gameState.draftSession || null,
    leagueHistory: _SAVE_DATA.history.LEAGUE_HISTORY
  };
}
```

- [ ] **Step 3: Restore `leagueHistory`**

Change (the end of `applySavedState`, before `return gameState;`):
```js
  gameState.lastDraftResults = payload.lastDraftResults.map(function (r) {
    return { teamId: r.teamId, prospect: _SAVE_DATA.league.getPlayerById(r.playerId), pickNumber: r.pickNumber, round: r.round };
  });

  return gameState;
}
```
to:
```js
  gameState.lastDraftResults = payload.lastDraftResults.map(function (r) {
    return { teamId: r.teamId, prospect: _SAVE_DATA.league.getPlayerById(r.playerId), pickNumber: r.pickNumber, round: r.round };
  });

  // Older saves (pre-Phase 8) won't have this field — leave LEAGUE_HISTORY at
  // its default empty-arrays state rather than crashing on a missing key.
  // Matches this phase's explicit "no retroactive backfill" scope decision.
  if (payload.leagueHistory) {
    Object.keys(payload.leagueHistory).forEach(function (key) {
      _SAVE_DATA.history.LEAGUE_HISTORY[key] = payload.leagueHistory[key];
    });
  }

  return gameState;
}
```

- [ ] **Step 4: Run a Node smoke test + existing save validator**

Run:
```bash
node -e "
const save = require('./save.js');
const history = require('./history.js');
const teams = require('./teams.js');

teams.TEAMS[0].allTimeWins = 12345;
history.LEAGUE_HISTORY.trades.push({ leagueYear: 2033, participants: ['BOS', 'LAL'], players: [], picks: [] });

const gameState = {
  userTeamId: teams.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
  upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2033, offseasonStage: null,
  settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: { getState: function () { return null; } },
  playMode: 'gm', automation: {}, feed: [], draftSession: null
};
const payload = save.serializeGameState(gameState, 'history-test');
console.log('leagueHistory serialized:', payload.leagueHistory.trades.length === history.LEAGUE_HISTORY.trades.length);
console.log('team allTimeWins serialized:', payload.teams[teams.TEAMS[0].id].allTimeWins === 12345);

// Simulate a fresh reload: wipe LEAGUE_HISTORY's arrays and the team's field.
history.LEAGUE_HISTORY.trades.length = 0;
teams.TEAMS[0].allTimeWins = 0;

const freshState = {};
save.applySavedState(payload, freshState);
console.log('leagueHistory restored:', history.LEAGUE_HISTORY.trades.length === 1 && history.LEAGUE_HISTORY.trades[0].leagueYear === 2033);
console.log('team allTimeWins restored:', teams.TEAMS[0].allTimeWins === 12345);

// Old-save compatibility: a payload with no leagueHistory key must not crash.
delete payload.leagueHistory;
const freshState2 = {};
console.log('missing leagueHistory does not throw:', (function () { save.applySavedState(payload, freshState2); return true; })());
"
node scripts/validate-save.js
```
Expected: every `console.log` line prints `true`, then `node scripts/validate-save.js` prints `All save/load validations passed`.

- [ ] **Step 5: Commit**

```bash
git add save.js
git commit -m "feat: save/load persists leagueHistory + new team win-tracking fields"
```

---

### Task 12: `scripts/validate-history.js` — consolidated Node validator

**Files:**
- Create: `scripts/validate-history.js`

- [ ] **Step 1: Write the consolidated validator**

```js
const assert = require('assert');
const path = require('path');

const historyModule = require(path.join(__dirname, '..', 'history.js'));
const awardsModule = require(path.join(__dirname, '..', 'awards.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const seasonTransitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));
const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEnsureCareerData() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[20].id)[0];
  historyModule.ensureCareerData([player]);
  assert.strictEqual(player.careerStats.gamesPlayed, 0, 'fresh careerStats should start at zero');
  assert.deepStrictEqual(player.awardsWon, [], 'fresh awardsWon should be empty');
  assert.strictEqual(player.peakOverall, player.overall, 'fresh peakOverall should default to current overall');
  player.careerStats.points = 777;
  historyModule.ensureCareerData([player]);
  assert.strictEqual(player.careerStats.points, 777, 'ensureCareerData must not reset existing data');
  console.log('checkEnsureCareerData: OK');
}

checkEnsureCareerData();

function checkRollSeasonIntoCareerStats() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[21].id)[0];
  historyModule.ensureCareerData([player]);
  player.seasonStats = { gamesPlayed: 70, points: 10000, rebounds: 400, assists: 300, steals: 60, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
  const messages = [];
  historyModule.rollSeasonIntoCareerStats(player, function (text) { messages.push(text); });
  assert.strictEqual(player.careerStats.points, 10000, 'career points should accumulate the season total');
  assert.strictEqual(player.careerStats.seasonsPlayed, 1, 'seasonsPlayed should increment');
  assert.strictEqual(player.bestSeasonTotals.points, 10000, 'bestSeasonTotals should capture this season');
  assert.ok(messages.some(function (m) { return m.indexOf('10,000 career points') !== -1; }), 'crossing 10,000 points should push a milestone feed line');

  player.seasonStats = { gamesPlayed: 70, points: 5000, rebounds: 300, assists: 200, steals: 50, blocks: 15, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
  const messages2 = [];
  historyModule.rollSeasonIntoCareerStats(player, function (text) { messages2.push(text); });
  assert.strictEqual(player.careerStats.points, 15000, 'career points should keep accumulating');
  assert.ok(!messages2.some(function (m) { return m.indexOf('10,000') !== -1; }), 'an already-crossed milestone should not re-fire');
  console.log('checkRollSeasonIntoCareerStats: OK');
}

checkRollSeasonIntoCareerStats();

function checkComputeSeasonAwards() {
  let statSeed = 0;
  teamsModule.TEAMS.forEach(function (team) {
    leagueModule.getTeamRoster(team.id).forEach(function (p) {
      historyModule.ensureCareerData([p]);
      statSeed += 1;
      p.seasonStats = {
        gamesPlayed: 70, points: 500 + statSeed, rebounds: 200 + statSeed, assists: 150 + statSeed,
        steals: 40 + (statSeed % 30), blocks: 20 + (statSeed % 20), fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
        minutes: 1500 + (statSeed % 500)
      };
    });
    team.record = { wins: 30 + (statSeed % 40), losses: 30, pointsFor: 0, pointsAgainst: 0 };
    team.lastSeasonWins = 20;
  });

  const result = awardsModule.computeSeasonAwards(2040);
  assert.strictEqual(result.leagueYear, 2040, 'leagueYear should be echoed back');
  assert.ok(result.winners.some(function (w) { return w.award === awardsModule.AWARD_KEYS.MVP; }), 'an MVP should be selected');
  const allNbaWinners = result.winners.filter(function (w) { return w.award.indexOf('allNba') === 0; });
  assert.strictEqual(allNbaWinners.length, 15, 'exactly 15 All-NBA slots should be filled');
  assert.strictEqual(new Set(allNbaWinners.map(function (w) { return w.playerId; })).size, 15, 'All-NBA selections must be unique players');
  assert.ok(result.mostImprovedTeam, 'a Most Improved Team should be selected');
  console.log('checkComputeSeasonAwards: OK');
}

checkComputeSeasonAwards();

function checkArchiveRetireeAndHof() {
  const roster = leagueModule.getTeamRoster(teamsModule.TEAMS[22].id);
  const star = roster[0];
  historyModule.ensureCareerData([star]);
  star.careerStats.points = 28000;
  star.careerStats.rebounds = 9000;
  star.careerStats.assists = 6000;
  star.awardsWon = [{ award: awardsModule.AWARD_KEYS.MVP, leagueYear: 2038 }, { award: awardsModule.AWARD_KEYS.MVP, leagueYear: 2039 }];
  star.championshipsWon = 2;
  star.peakOverall = 96;
  const starRecord = historyModule.archiveRetiree(star, 2045);
  assert.strictEqual(starRecord.hallOfFame, true, 'a decorated career should clear the HOF threshold');

  const journeyman = roster[1];
  historyModule.ensureCareerData([journeyman]);
  journeyman.careerStats.points = 4000;
  journeyman.careerStats.rebounds = 1500;
  journeyman.careerStats.assists = 800;
  journeyman.awardsWon = [];
  journeyman.championshipsWon = 0;
  journeyman.peakOverall = 68;
  const journeymanRecord = historyModule.archiveRetiree(journeyman, 2045);
  assert.strictEqual(journeymanRecord.hallOfFame, false, 'a modest career should not clear the HOF threshold');
  console.log('checkArchiveRetireeAndHof: OK');
}

checkArchiveRetireeAndHof();

function checkArchiveTradeAndDraftClass() {
  const teamA = teamsModule.TEAMS[23];
  const teamB = teamsModule.TEAMS[24];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
  const beforeTradeCount = historyModule.LEAGUE_HISTORY.trades.length;
  const tradeRecord = historyModule.archiveTrade(proposal, 2041);
  assert.strictEqual(tradeRecord.players[0].playerName, playerA.name, 'archived trade should carry the player name');
  assert.strictEqual(historyModule.LEAGUE_HISTORY.trades.length, beforeTradeCount + 1, 'trade archive should grow by one');

  const draftResults = [{ round: 1, pickNumber: 1, teamId: teamsModule.TEAMS[0].id, prospect: { id: 'prospect-validator', name: 'Validator Prospect' } }];
  const draftRecord = historyModule.archiveDraftClass(2041, draftResults);
  assert.strictEqual(draftRecord.picks[0].playerName, 'Validator Prospect', 'archived draft class should carry the prospect name');
  console.log('checkArchiveTradeAndDraftClass: OK');
}

checkArchiveTradeAndDraftClass();

function checkFinalizeSeasonHistoryEndToEnd() {
  const rng = makeRng(6100);
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 15 + i, losses: 5, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 10; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 15 + i, losses: 5, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 10; });
  teamsModule.TEAMS.forEach(function (t) {
    leagueModule.getTeamRoster(t.id).forEach(function (p) {
      p.seasonStats = { gamesPlayed: 70, points: 800, rebounds: 300, assists: 200, steals: 40, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 1800 };
    });
  });

  const bracket = playoffsModule.generateBracket();
  let g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

  const beforeAwardsHistory = historyModule.LEAGUE_HISTORY.awardsHistory.length;
  const beforeChampions = historyModule.LEAGUE_HISTORY.champions.length;
  const sampleRoster = leagueModule.getTeamRoster(teamsModule.TEAMS[0].id);
  const beforeGamesPlayed = sampleRoster.map(function (p) { historyModule.ensureCareerData([p]); return p.careerStats.gamesPlayed; });

  historyModule.finalizeSeasonHistory(2050, bracket, function () {});

  assert.strictEqual(historyModule.LEAGUE_HISTORY.awardsHistory.length, beforeAwardsHistory + 1, 'awardsHistory should grow by one season');
  assert.strictEqual(historyModule.LEAGUE_HISTORY.champions.length, beforeChampions + 1, 'champions should grow by one season');
  sampleRoster.forEach(function (p, i) {
    assert.ok(p.careerStats.gamesPlayed > beforeGamesPlayed[i], 'every rostered player should have careerStats rolled forward');
  });
  console.log('checkFinalizeSeasonHistoryEndToEnd: OK');
}

checkFinalizeSeasonHistoryEndToEnd();

function checkRecordsLeaders() {
  const p = leagueModule.getTeamRoster(teamsModule.TEAMS[25].id)[0];
  historyModule.ensureCareerData([p]);
  p.careerStats.points = 999999;
  p.bestSeasonTotals.points = 5000;
  teamsModule.TEAMS[25].allTimeWins = 999999;

  const careerTop = historyModule.careerLeaders('points', 5);
  assert.strictEqual(careerTop.length, 5, 'careerLeaders should respect the requested count');
  assert.strictEqual(careerTop[0].id, p.id, 'the stacked player should lead career points');

  const seasonTop = historyModule.singleSeasonLeaders('points', 5);
  assert.strictEqual(seasonTop[0].id, p.id, 'the stacked player should lead single-season points');

  const winLeaders = historyModule.franchiseWinLeaders(5);
  assert.strictEqual(winLeaders[0].id, teamsModule.TEAMS[25].id, 'the stacked team should lead all-time wins');
  console.log('checkRecordsLeaders: OK');
}

checkRecordsLeaders();

function checkRetirementArchivesRetirees() {
  const rng = makeRng(6200);
  const before = historyModule.LEAGUE_HISTORY.retiredPlayers.length;
  const result = seasonTransitionModule.runOffseasonPreDraft(rng, 2051);
  assert.strictEqual(historyModule.LEAGUE_HISTORY.retiredPlayers.length - before, result.retireeCount, 'archived-retiree count should match runOffseasonPreDraft\'s reported count');
  console.log('checkRetirementArchivesRetirees: OK');
}

checkRetirementArchivesRetirees();

function checkTradeHistorySink() {
  const teamA = teamsModule.TEAMS[27];
  const teamB = teamsModule.TEAMS[28];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
  let sinkCalledWith = null;
  tradeModule.executeTrade(proposal, function (p) { sinkCalledWith = p; });
  assert.strictEqual(sinkCalledWith, proposal, 'executeTrade should invoke historySink with the proposal');
  console.log('checkTradeHistorySink: OK');
}

checkTradeHistorySink();

function checkSaveLoadRoundTrip() {
  teamsModule.TEAMS[0].allTimeWins = 54321;
  const gameState = {
    userTeamId: teamsModule.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
    upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2060, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: { getState: function () { return null; } },
    playMode: 'gm', automation: {}, feed: [], draftSession: null
  };
  const payload = saveModule.serializeGameState(gameState, 'validator-history-test');
  assert.ok(Array.isArray(payload.leagueHistory.retiredPlayers), 'serialized payload should include leagueHistory');
  assert.strictEqual(payload.teams[teamsModule.TEAMS[0].id].allTimeWins, 54321, 'serialized team payload should include allTimeWins');

  const savedRetiredCount = payload.leagueHistory.retiredPlayers.length;
  historyModule.LEAGUE_HISTORY.retiredPlayers.length = 0;
  teamsModule.TEAMS[0].allTimeWins = 0;

  const freshState = {};
  saveModule.applySavedState(payload, freshState);
  assert.strictEqual(historyModule.LEAGUE_HISTORY.retiredPlayers.length, savedRetiredCount, 'leagueHistory should be restored on load');
  assert.strictEqual(teamsModule.TEAMS[0].allTimeWins, 54321, 'allTimeWins should be restored on load');
  console.log('checkSaveLoadRoundTrip: OK');
}

checkSaveLoadRoundTrip();

console.log('All history validations passed');
```

- [ ] **Step 2: Run it**

Run: `node scripts/validate-history.js`
Expected: each `checkX: OK` line prints, followed by `All history validations passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-history.js
git commit -m "test: Phase 8 league history & awards validation suite"
```

---

### Task 13: `script.js` — wire everything into the app shell

**Files:**
- Modify: `script.js:29-44` (`initSeason`), `script.js:98-114` (`runWeeklyTradeGeneration`), `script.js:149-168` (`BUILT_VIEWS`), `script.js:175-209` (`handleAdvanceToOffseason`, `handleUserDraftPick`), `ui/tradeCenter.js` (all three of its trade-execution call sites)

**Interfaces:**
- Wires `history.js`'s `finalizeSeasonHistory`, `archiveDraftClass`, `archiveTrade`, `ensureCareerData` and `awards.js` implicitly (via `history.js`) into the app shell. `BUILT_VIEWS` gains `awards`/`history` entries (Task 14/15 supply the renderers). **All four** places a trade can execute get `archiveTrade` wired in — script.js's auto-trade branch (Step 2 below) plus `ui/tradeCenter.js`'s manual Propose Trade, Force Trade, and Accept Offer paths (Step 2.5 below) — matching the design spec's "archive every trade" decision, not just the automated path.

- [ ] **Step 1: `ensureCareerData` in `initSeason`**

Change (`script.js:40-41`):
```js
  ensureHiddenPlayerData(PLAYERS_2026);
  ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
```
to:
```js
  ensureHiddenPlayerData(PLAYERS_2026);
  ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
  ensureCareerData(PLAYERS_2026);
```

- [ ] **Step 2: Wire `historySink` into the auto-trade call site**

Change (`script.js:106-109`):
```js
  if (GameState.automation.autoTrade) {
    executeTrade(offer.proposal);
    const partnerId = offer.proposal.participants.find(function (id) { return id !== team.id; });
    pushToFeed('Auto-traded with ' + getTeamById(partnerId).name, dayIndex);
```
to:
```js
  if (GameState.automation.autoTrade) {
    executeTrade(offer.proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
    const partnerId = offer.proposal.participants.find(function (id) { return id !== team.id; });
    pushToFeed('Auto-traded with ' + getTeamById(partnerId).name, dayIndex);
```

- [ ] **Step 2.5: Wire `archiveTrade` into `ui/tradeCenter.js`'s three manual trade-execution paths**

Change (`handlePropose`, the `result.accepted` branch):
```js
  const result = proposeTrade(state, userTeamId, false); // the user always controls their own accept/reject when building a trade by hand
```
to:
```js
  const result = proposeTrade(state, userTeamId, false, function (p) { archiveTrade(p, GameState.leagueYear || 2026); }); // the user always controls their own accept/reject when building a trade by hand
```

Change (`handleForceTrade`):
```js
  const result = forceTrade(state);
```
to:
```js
  const result = forceTrade(state, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
```

Change (`wireEvents`'s accept-offer button handler):
```js
    container.querySelectorAll('button[data-accept-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = Number(btn.getAttribute('data-accept-offer'));
        executeTrade(GameState.tradeOffers[i].proposal);
        GameState.tradeOffers.splice(i, 1);
        draw();
      });
    });
```
to:
```js
    container.querySelectorAll('button[data-accept-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = Number(btn.getAttribute('data-accept-offer'));
        executeTrade(GameState.tradeOffers[i].proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
        GameState.tradeOffers.splice(i, 1);
        draw();
      });
    });
```

- [ ] **Step 3: Add `awards`/`history` to `BUILT_VIEWS`**

Change (`script.js:149-168`):
```js
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed,
  commissioner: renderCommissioner
};
```
to:
```js
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed,
  commissioner: renderCommissioner,
  awards: renderAwards,
  history: renderHistory
};
```

- [ ] **Step 4: Call `finalizeSeasonHistory` at the top of `handleAdvanceToOffseason`, pass `leagueYear` into retirement, archive both draft-completion paths**

Change (`script.js:175-197`):
```js
function handleAdvanceToOffseason() {
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;

  if (autoDraftEffective) {
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
    GameState.lastDraftResults = result.draftResults;
    GameState.draftSession = null;
  } else {
    runOffseasonPreDraft(GameState.rng);
    const draftOrder = buildDraftOrder(GameState.playoffBracket, GameState.rng);
    GameState.draftSession = startDraftSession(draftOrder, GameState.upcomingDraftClass);
    advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
    if (!currentPick(GameState.draftSession)) {
      GameState.lastDraftResults = GameState.draftSession.results;
      GameState.draftSession = null;
    }
  }

  GameState.offseasonStage = 'draft';
  renderView('draft');
  autosave(GameState);
}

function handleUserDraftPick(prospectId) {
  const prospect = GameState.draftSession.available.find(function (p) { return p.id === prospectId; });
  resolveCurrentPick(GameState.draftSession, prospect);
  advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
  if (!currentPick(GameState.draftSession)) {
    GameState.lastDraftResults = GameState.draftSession.results;
    GameState.draftSession = null;
  }
  renderView('draft');
  autosave(GameState);
}
```
to:
```js
function handleAdvanceToOffseason() {
  // Runs BEFORE the leagueYear increment and before retirement, so
  // finalizeSeasonHistory's award/career-stat rollup reflects the season
  // that just finished, and retirees archived immediately after this see
  // their fully-updated careerStats/awardsWon.
  finalizeSeasonHistory(GameState.leagueYear || 2026, GameState.playoffBracket, function (text) { pushToFeed(text); });

  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;

  if (autoDraftEffective) {
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
    GameState.lastDraftResults = result.draftResults;
    GameState.draftSession = null;
    archiveDraftClass(GameState.leagueYear, result.draftResults);
  } else {
    runOffseasonPreDraft(GameState.rng, GameState.leagueYear);
    const draftOrder = buildDraftOrder(GameState.playoffBracket, GameState.rng);
    GameState.draftSession = startDraftSession(draftOrder, GameState.upcomingDraftClass);
    advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
    if (!currentPick(GameState.draftSession)) {
      GameState.lastDraftResults = GameState.draftSession.results;
      GameState.draftSession = null;
      archiveDraftClass(GameState.leagueYear, GameState.lastDraftResults);
    }
  }

  GameState.offseasonStage = 'draft';
  renderView('draft');
  autosave(GameState);
}

function handleUserDraftPick(prospectId) {
  const prospect = GameState.draftSession.available.find(function (p) { return p.id === prospectId; });
  resolveCurrentPick(GameState.draftSession, prospect);
  advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
  if (!currentPick(GameState.draftSession)) {
    GameState.lastDraftResults = GameState.draftSession.results;
    GameState.draftSession = null;
    archiveDraftClass(GameState.leagueYear, GameState.lastDraftResults);
  }
  renderView('draft');
  autosave(GameState);
}
```

Note: the manual (non-auto-draft) branch's `runOffseasonPreDraft(GameState.rng)` call loses its retirees' `leagueYear` tagging in the auto-draft branch's underlying `runOffseasonThroughDraft` (which internally calls `runOffseasonPreDraft(rng)` with no `leagueYear`, per Task 9's additive signature) — this is an accepted, narrow gap: the auto-draft path's retirees get archived with `retiredYear: undefined`. Flagging it here rather than silently guessing; **Step 5** below closes it properly instead of leaving it as a known gap.

- [ ] **Step 5: Thread `leagueYear` through `runOffseasonThroughDraft` too, so both draft paths tag retirees correctly**

Change (`seasonTransition.js`'s `runOffseasonThroughDraft`):
```js
function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass) {
  const pre = runOffseasonPreDraft(rng);

  // The prospect pool is generated by the caller ahead of time (real 2026
  // class for the first draft, or the class generateNewSeason produced at
  // the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: pre.retireeCount, draftResults: draftResults };
}
```
to:
```js
function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass, leagueYear) {
  const pre = runOffseasonPreDraft(rng, leagueYear);

  // The prospect pool is generated by the caller ahead of time (real 2026
  // class for the first draft, or the class generateNewSeason produced at
  // the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: pre.retireeCount, draftResults: draftResults };
}
```

Then change `script.js`'s auto-draft branch call site (already edited in Step 4 above) from:
```js
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
```
to:
```js
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass, GameState.leagueYear);
```

- [ ] **Step 6: Run existing offseason validator to confirm zero regression**

Run: `node scripts/validate-offseason.js`
Expected: `All offseason validations passed` (the one existing test call site for `runOffseasonThroughDraft` omits the new `leagueYear` param — unaffected).

- [ ] **Step 7: Commit**

```bash
git add script.js seasonTransition.js
git commit -m "feat: wire finalizeSeasonHistory, trade/draft archiving, and awards/history views into the app shell"
```

---

### Task 14: `ui/awards.js` (new)

**Files:**
- Create: `ui/awards.js`

**Interfaces:**
- Produces: `renderAwards(container)` — past winners by season, most recent first.

- [ ] **Step 1: Write the view**

```js
const AWARD_LABELS = {
  mvp: 'MVP',
  dpoy: 'Defensive Player of the Year',
  roy: 'Rookie of the Year',
  sixthMoy: 'Sixth Man of the Year',
  mip: 'Most Improved Player',
  allNba1: 'All-NBA First Team',
  allNba2: 'All-NBA Second Team',
  allNba3: 'All-NBA Third Team'
};

const AWARD_DISPLAY_ORDER = ['mvp', 'dpoy', 'roy', 'sixthMoy', 'mip', 'allNba1', 'allNba2', 'allNba3'];

function renderAwards(container) {
  let html = '<h2>Awards</h2>';

  if (LEAGUE_HISTORY.awardsHistory.length === 0) {
    html += '<p>No seasons completed yet — awards appear here once a season ends.</p>';
    container.innerHTML = html;
    return;
  }

  LEAGUE_HISTORY.awardsHistory.slice().reverse().forEach(function (season) {
    html += '<h3>' + season.leagueYear + '</h3><ul>';
    AWARD_DISPLAY_ORDER.forEach(function (awardKey) {
      const winners = season.winners.filter(function (w) { return w.award === awardKey; });
      if (winners.length === 0) return;
      html += '<li>' + AWARD_LABELS[awardKey] + ': ' + winners.map(function (w) { return w.playerName; }).join(', ') + '</li>';
    });
    if (season.mostImprovedTeam) {
      html += '<li>Most Improved Team: ' + season.mostImprovedTeam.teamName + '</li>';
    }
    html += '</ul>';
  });

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAwards: renderAwards, AWARD_LABELS: AWARD_LABELS };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/awards.js
git commit -m "feat: ui/awards.js season awards view"
```

---

### Task 15: `ui/history.js` (new)

**Files:**
- Create: `ui/history.js`

**Interfaces:**
- Produces: `renderHistory(container)` — Champions, Hall of Fame, Records, Draft Archive, Trade Archive sections, all computed on-demand.

- [ ] **Step 1: Write the view**

```js
function renderChampionsSection() {
  let html = '<section><h3>Champions</h3>';
  if (LEAGUE_HISTORY.champions.length === 0) {
    html += '<p>No champion crowned yet.</p></section>';
    return html;
  }
  html += '<ul>';
  LEAGUE_HISTORY.champions.slice().reverse().forEach(function (c) {
    const team = getTeamById(c.teamId);
    html += '<li>' + c.leagueYear + ': ' + (team ? team.name : 'Unknown') + '</li>';
  });
  html += '</ul></section>';
  return html;
}

function renderHallOfFameSection() {
  const inducted = LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; });
  let html = '<section><h3>Hall of Fame</h3>';
  if (inducted.length === 0) {
    html += '<p>No one inducted yet.</p></section>';
    return html;
  }
  html += '<table><thead><tr><th>Name</th><th>Retired</th><th>Career Pts</th><th>Career Reb</th><th>Career Ast</th><th>Championships</th></tr></thead><tbody>';
  inducted.forEach(function (r) {
    html += '<tr><td>' + r.name + '</td><td>' + r.retiredYear + '</td><td>' + r.careerStats.points + '</td><td>' + r.careerStats.rebounds + '</td><td>' + r.careerStats.assists + '</td><td>' + r.championshipsWon + '</td></tr>';
  });
  html += '</tbody></table></section>';
  return html;
}

const RECORD_STAT_LABELS = { points: 'Points', rebounds: 'Rebounds', assists: 'Assists' };

function renderRecordsSection() {
  let html = '<section><h3>Records</h3>';
  html += '<h4>Career Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += careerLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Single-Season Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += singleSeasonLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Most Franchise Wins</h4><p>';
  html += franchiseWinLeaders(5).map(function (l) { return l.name + ' (' + l.allTimeWins + ')'; }).join(', ');
  html += '</p></section>';
  return html;
}

function renderDraftArchiveSection() {
  let html = '<section><h3>Draft Archive</h3>';
  if (LEAGUE_HISTORY.draftClasses.length === 0) {
    html += '<p>No drafts completed yet.</p></section>';
    return html;
  }
  LEAGUE_HISTORY.draftClasses.slice().reverse().forEach(function (dc) {
    html += '<h4>' + dc.leagueYear + '</h4><ol>';
    dc.picks.slice().sort(function (a, b) { return a.pickNumber - b.pickNumber; }).forEach(function (p) {
      const team = getTeamById(p.teamId);
      html += '<li>' + p.playerName + ' — ' + (team ? team.name : 'Unknown') + '</li>';
    });
    html += '</ol>';
  });
  html += '</section>';
  return html;
}

function renderTradeArchiveSection() {
  let html = '<section><h3>Trade Archive</h3>';
  if (LEAGUE_HISTORY.trades.length === 0) {
    html += '<p>No trades executed yet.</p></section>';
    return html;
  }
  html += '<ul>';
  LEAGUE_HISTORY.trades.slice().reverse().forEach(function (t) {
    const teamNames = t.participants.map(function (id) { const team = getTeamById(id); return team ? team.name : 'Unknown'; }).join(' / ');
    const playerNames = t.players.map(function (p) { return p.playerName; }).join(', ');
    html += '<li>' + t.leagueYear + ' — ' + teamNames + ': ' + playerNames + '</li>';
  });
  html += '</ul></section>';
  return html;
}

function renderHistory(container) {
  let html = '<h2>League History</h2>';
  html += renderChampionsSection();
  html += renderHallOfFameSection();
  html += renderRecordsSection();
  html += renderDraftArchiveSection();
  html += renderTradeArchiveSection();
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderHistory: renderHistory };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/history.js
git commit -m "feat: ui/history.js champions, Hall of Fame, records, draft/trade archive view"
```

---

### Task 16: `ui/roster.js` — Career section

**Files:**
- Modify: `ui/roster.js`

**Interfaces:**
- Produces: a "Career" section rendered below the existing roster table, listing each player's career totals/averages (no dedicated per-player page, per the design spec's confirmed "moderate" UI scope).

- [ ] **Step 1: Add the section**

Change (`ui/roster.js`, end of `draw()`, right before `container.innerHTML = html;`):
```js
    html += '</tbody></table>';
    container.innerHTML = html;
```
to:
```js
    html += '</tbody></table>';
    html += '<h3>Career</h3><table><thead><tr><th>Name</th><th>Seasons</th><th>Career Pts</th><th>Career Reb</th><th>Career Ast</th><th>Championships</th></tr></thead><tbody>';
    roster.forEach(function (p) {
      ensureCareerData([p]);
      html += '<tr><td>' + p.name + '</td><td>' + p.careerStats.seasonsPlayed + '</td><td>' + p.careerStats.points + '</td><td>' + p.careerStats.rebounds + '</td><td>' + p.careerStats.assists + '</td><td>' + p.championshipsWon + '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
```

- [ ] **Step 2: Commit**

```bash
git add ui/roster.js
git commit -m "feat: Roster view gains a per-player Career totals section"
```

---

### Task 17: Wire `index.html` + full validator suite + end-to-end browser verification

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the new script tags in dependency order**

After `<script src="seasonTransition.js"></script>`, add:
```html
  <script src="awards.js"></script>
  <script src="history.js"></script>
```
(These must land before `<script src="save.js"></script>`, which already follows `seasonTransition.js` in the existing file — confirm the insertion lands above the `save.js` tag.)

After `<script src="ui/commissioner.js"></script>`, add:
```html
  <script src="ui/awards.js"></script>
  <script src="ui/history.js"></script>
```

- [ ] **Step 2: Run every Node validator**

Run:
```bash
node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js && node scripts/validate-save.js && node scripts/validate-automation.js && node scripts/validate-commissioner.js && node scripts/validate-history.js
```
Expected: every file prints its own passing summary line, no errors.

- [ ] **Step 3: Live browser verification**

Serve the app on a fresh port:
```bash
python -m http.server 8009 --directory "C:\Users\cory\Desktop\nba"
```
Then, in the browser:
1. Start a fresh game. Open the **Awards** and **History** nav views — confirm they render their empty-state messages ("No seasons completed yet...", "No champion crowned yet...", etc.) with zero console errors.
2. Open **Roster** — confirm the new "Career" section renders below the existing table, all zeros for a fresh roster.
3. Turn on every automation toggle (or use Spectator mode) and **Sim Until Championship** (or several **Sim N Seasons**) to fast-forward through at least 2-3 full seasons, watching the console for errors after each.
4. After at least one season completes, revisit **Awards** — confirm MVP/DPOY/ROY/6MOY/MIP/All-NBA/Most Improved Team all show real player/team names for that season.
5. Revisit **History** — confirm a champion appears, career leaders/single-season leaders/franchise win leaders show real names and non-zero values, and (once any draft has occurred) the Draft Archive shows real picks.
6. Check **Roster** again — confirm rostered players' Career totals accumulated (non-zero) after the season(s) simulated.
7. If any player retired during the simulated seasons, confirm the **History** view's Hall of Fame section reflects them correctly (inducted or not, per the formula) — check via the browser console if none retired naturally: `getTeamRoster(TEAMS[0].id)[0]` then inspect `careerStats`/`awardsWon` directly, or force a retiree by temporarily lowering an age via Commissioner Mode's Edit Player and advancing an offseason.
8. Execute at least one trade (via Trade Center or Commissioner Mode's Force Trade) and confirm it appears in **History**'s Trade Archive.
9. Save mid-run, reload the page, load the save — confirm Awards/History/Roster-Career data all persisted exactly (this is the save/load path Task 11 built).
10. Check the browser console (`mcp__Claude_Browser__read_console_messages`, `onlyErrors: true`) after every step above — zero errors throughout.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: wire Phase 8 league history & dynasty tracking into the app shell"
```

- [ ] **Step 5: Invoke `superpowers:finishing-a-development-branch`**

This project works directly on `master` with no feature branches and no git remote — follow that skill's guidance for the no-remote/no-branch case (verify tests, confirm clean `git status`, report completion).
