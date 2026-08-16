# Phase 3: Roster Management & Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Trade Center where the player can build a 2-4 team trade proposal, get it evaluated against each AI team's own value/salary needs, negotiate through rejections, and see accepted trades execute — plus a waive action that releases a player to an unsigned free-agent pool.

**Architecture:** Pure-logic modules (`rosterMoves.js`, `tradeEvaluator.js`, `trade.js`) follow the same dual browser-global/Node-testable pattern established in Phase 2, so trade math is unit-tested with plain Node `assert` before any UI exists. `ui/tradeCenter.js` is the only new UI file; `ui/roster.js` gains a Waive button.

**Tech Stack:** Same as Phases 1-2 — HTML, CSS, vanilla JavaScript, no build step, no external APIs, no frameworks. Node.js used only for development-time validation scripts.

## Global Constraints

- Same constraints as Phases 1-2 (see prior plans): vanilla JS only, no frameworks/build step, offline, modular files, comment only non-obvious logic.
- No hidden traits/personality in trade value (Phase 5 doesn't exist yet) — value comes only from `overall`, `potential`, `age`, `contract`, and team `timeline`/positional need.
- No draft picks as trade assets (`Team.draftPicks` stays an empty stub until Phase 4).
- Roster size must stay in [12, 15] for every trade/waive participant, matching Phase 1's validated data range.
- `FREE_AGENTS` is a derived view (`PLAYERS_2026.filter(p => p.teamId === null)`), not a separately maintained array — same "derive, don't duplicate" principle Phase 1 used for team rosters.

---

## File Structure

```
teams.js               # MODIFIED — each team gains a `timeline` field
rosterMoves.js           # NEW — getFreeAgents(), waivePlayer()
tradeEvaluator.js          # NEW — player value, team-leg evaluation, counteroffer suggestions
trade.js                 # NEW — multi-team proposal evaluation, roster-size checks, execution
ui/roster.js             # MODIFIED — adds a Waive button per row
ui/tradeCenter.js          # NEW — team picker, player picker, running value panel, propose/negotiate
ui/nav.js                # unchanged — 'trade' already exists in NAV_ITEMS from Phase 1
script.js                # MODIFIED — registers BUILT_VIEWS.trade
index.html               # MODIFIED — new script tags
scripts/validate-trades.js   # NEW — Node validation script (same pattern as Phases 1-2)
```

**Script tag load order addition** (after `playoffs.js`, before `ui/nav.js`): `rosterMoves.js`, `tradeEvaluator.js`, `trade.js`.

---

### Task 1: `teams.js` — add `timeline` field to all 30 teams

**Files:**
- Modify: `teams.js`
- Modify: `scripts/validate-data.js`

**Interfaces:**
- Produces: every `Team` object now has `timeline: 'rebuilding' | 'retooling' | 'win-now'` — consumed by `tradeEvaluator.js`'s `directionMultiplier` (Task 4).

- [ ] **Step 1: Add a `timeline` field to each of the 30 team objects in `teams.js`**

Add `timeline: '...'` to each team literal (hand-authored judgment call, same process as `prestige` in Phase 1):

```
BOS win-now, BKN rebuilding, NYK win-now, PHI win-now, TOR retooling,
CHI retooling, CLE win-now, DET retooling, IND win-now, MIL win-now,
ATL retooling, CHA rebuilding, MIA win-now, ORL retooling, WAS rebuilding,
DEN win-now, MIN win-now, OKC win-now, POR rebuilding, UTA rebuilding,
GSW win-now, LAC win-now, LAL win-now, PHX retooling, SAC retooling,
DAL win-now, HOU win-now, MEM retooling, NOP rebuilding, SAS rebuilding
```

For each team object, add the field, e.g.:
```js
{ id: 'BOS', name: 'Boston Harbormen', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#007A33', secondary: '#BA9653' }, prestige: 88, fanHappiness: 80, ownerHappiness: 80, chemistry: 75, timeline: 'win-now', record: { wins: 0, losses: 0 }, draftPicks: [] },
```
(Insert `timeline: '...'` after `chemistry` and before `record` on all 30 lines, using the assignments listed above.)

- [ ] **Step 2: Extend `checkTeams` in `scripts/validate-data.js`**

Add inside the `teams.TEAMS.forEach(function (t) { ... })` loop in `checkTeams`, alongside the existing field checks:

```js
assert.ok(['rebuilding', 'retooling', 'win-now'].includes(t.timeline), 'invalid timeline on ' + t.id);
```

- [ ] **Step 3: Run the validator**

Run: `node scripts/validate-data.js`
Expected: all four checks still pass (`checkTeams: OK` now also covers `timeline`).

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add teams.js scripts/validate-data.js
git commit -m "feat: add team timeline field for trade evaluation"
```

---

### Task 2: `rosterMoves.js` — waiving players

**Files:**
- Create: `rosterMoves.js`
- Create: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: `getTeamRoster`, `getPlayerById` (from `league.js`).
- Produces: `getFreeAgents()`, `waivePlayer(playerId)` — consumed by `ui/roster.js` (Task 7).

- [ ] **Step 1: Write `rosterMoves.js`**

```js
var _ROSTER_MOVES_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), players: require('./players-2026.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById }, players: { PLAYERS_2026: PLAYERS_2026 } };

function getFreeAgents() {
  return _ROSTER_MOVES_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId === null; });
}

function waivePlayer(playerId) {
  const player = _ROSTER_MOVES_DATA.league.getPlayerById(playerId);
  if (!player.teamId) {
    return { success: false, reason: 'Player is already a free agent.' };
  }
  const roster = _ROSTER_MOVES_DATA.league.getTeamRoster(player.teamId);
  if (roster.length <= 12) {
    return { success: false, reason: 'Waiving would drop the roster below the 12-player minimum.' };
  }
  player.teamId = null;
  return { success: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getFreeAgents: getFreeAgents, waivePlayer: waivePlayer };
}
```

- [ ] **Step 2: Create `scripts/validate-trades.js`**

```js
const assert = require('assert');
const path = require('path');

const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

function checkWaivePlayer() {
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const before = leagueModule.getTeamRoster('BOS').length;
  const target = leagueModule.getTeamRoster('BOS')[before - 1]; // last player, arbitrary pick

  const result = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(result.success, true);
  assert.strictEqual(target.teamId, null);
  assert.strictEqual(leagueModule.getTeamRoster('BOS').length, before - 1);
  assert.ok(rosterMovesModule.getFreeAgents().some(function (p) { return p.id === target.id; }));

  const alreadyFa = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(alreadyFa.success, false);

  // restore state for later checks in this file
  target.teamId = 'BOS';

  console.log('checkWaivePlayer: OK');
}

checkWaivePlayer();
console.log('All trade validations passed');
```

- [ ] **Step 3: Run it**

Run: `node scripts/validate-trades.js`
Expected:
```
checkWaivePlayer: OK
All trade validations passed
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add rosterMoves.js scripts/validate-trades.js
git commit -m "feat: waive players to a derived free-agent pool"
```

---

### Task 3: `tradeEvaluator.js` — base player value

**Files:**
- Create: `tradeEvaluator.js`
- Modify: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: nothing external yet (pure math on a `Player` object passed in).
- Produces: `youthFactor(age)`, `contractBurden(salary, overall)`, `basePlayerValue(player)` — consumed by Task 4's `adjustedPlayerValue`.

- [ ] **Step 1: Write `tradeEvaluator.js`**

```js
// Weights unrealized potential more heavily for younger players, tapering to
// near-zero by the mid-30s (a 34-year-old's potential gap isn't going anywhere).
function youthFactor(age) {
  if (age <= 23) return 1.0;
  if (age >= 34) return 0.1;
  return 1.0 - ((age - 23) / 11) * 0.9;
}

// "Fair" salary scales roughly linearly with overall; burden is how far actual
// salary exceeds that anchor, converted to value-scale penalty points.
function contractBurden(salary, overall) {
  const fairSalary = Math.max(1000000, (overall - 50) * 1000000);
  const excess = Math.max(0, salary - fairSalary);
  return excess / 2000000;
}

function basePlayerValue(player) {
  const potentialGap = Math.max(0, player.potential - player.overall);
  return player.overall * 2 + potentialGap * youthFactor(player.age) - contractBurden(player.contract.salary, player.overall);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { youthFactor: youthFactor, contractBurden: contractBurden, basePlayerValue: basePlayerValue };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-trades.js`**

Insert before `console.log('All trade validations passed');`:

```js
function checkBasePlayerValue() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

  assert.ok(evaluatorModule.youthFactor(20) > evaluatorModule.youthFactor(33), 'younger players should weight potential more');
  assert.ok(evaluatorModule.youthFactor(34) <= 0.1);

  assert.strictEqual(evaluatorModule.contractBurden(1000000, 60), 0, 'a below-market salary should have no burden');
  assert.ok(evaluatorModule.contractBurden(50000000, 60) > 0, 'a max contract on a 60-overall should carry burden');

  const star = { overall: 95, potential: 96, age: 25, contract: { salary: 30000000 } };
  const bustContract = { overall: 60, potential: 61, age: 30, contract: { salary: 45000000 } };
  assert.ok(evaluatorModule.basePlayerValue(star) > evaluatorModule.basePlayerValue(bustContract), 'a star should be worth clearly more than an overpaid low-overall player');

  console.log('checkBasePlayerValue: OK');
}

checkBasePlayerValue();
```

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-trades.js` — expect `checkWaivePlayer: OK`, `checkBasePlayerValue: OK`, `All trade validations passed`.

```bash
cd "C:\Users\cory\Desktop\nba"
git add tradeEvaluator.js scripts/validate-trades.js
git commit -m "feat: base player trade value (overall, potential, age, contract burden)"
```

---

### Task 4: `tradeEvaluator.js` — team-adjusted player value

**Files:**
- Modify: `tradeEvaluator.js`
- Modify: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: `getTeamRoster` (from `league.js`), `basePlayerValue` (own file, Task 3).
- Produces: `directionMultiplier(player, timeline)`, `needMultiplier(position, team)`, `adjustedPlayerValue(player, team)` — consumed by Task 5's `evaluateTeamLeg`.

- [ ] **Step 1: Add to `tradeEvaluator.js`**

Update the top of the file and add above `module.exports`:

```js
var _EVAL_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js') }
  : { league: { getTeamRoster: getTeamRoster } };
```

```js
function directionMultiplier(player, timeline) {
  if (timeline === 'rebuilding') {
    if (player.age <= 25) return 1.2;
    if (player.age >= 30) return 0.8;
    return 1.0;
  }
  if (timeline === 'win-now') {
    if (player.overall >= 80) return 1.2;
    if (player.age <= 22) return 0.85;
    return 1.0;
  }
  return 1.0; // retooling: roughly neutral
}

const LEAGUE_AVG_OVERALL = 75;

function needMultiplier(position, team) {
  const roster = _EVAL_DATA.league.getTeamRoster(team.id);
  const samePosition = roster.filter(function (p) { return p.position === position; });
  if (samePosition.length === 0) return 1.3;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.overall; }, 0) / samePosition.length;
  if (avgAtPosition < LEAGUE_AVG_OVERALL - 10) return 1.15;
  if (avgAtPosition > LEAGUE_AVG_OVERALL + 10) return 0.9;
  return 1.0;
}

function adjustedPlayerValue(player, team) {
  return basePlayerValue(player) * directionMultiplier(player, team.timeline) * needMultiplier(player.position, team);
}
```

- [ ] **Step 2: Update `module.exports` in `tradeEvaluator.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    youthFactor: youthFactor,
    contractBurden: contractBurden,
    basePlayerValue: basePlayerValue,
    directionMultiplier: directionMultiplier,
    needMultiplier: needMultiplier,
    adjustedPlayerValue: adjustedPlayerValue
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-trades.js`**

```js
function checkAdjustedPlayerValue() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
  const rebuildingTeam = { id: 'BKN', timeline: 'rebuilding' };
  const winNowTeam = { id: 'LAL', timeline: 'win-now' };

  const youngPlayer = { overall: 78, potential: 88, age: 22, position: 'SF', contract: { salary: 6000000 } };
  const oldVeteran = { overall: 78, potential: 78, age: 33, position: 'SF', contract: { salary: 6000000 } };

  assert.ok(
    evaluatorModule.adjustedPlayerValue(youngPlayer, rebuildingTeam) > evaluatorModule.adjustedPlayerValue(oldVeteran, rebuildingTeam),
    'a rebuilding team should value the young player over an equal-overall veteran'
  );

  const centerHeavyTeam = teamsModule.getTeamById('DEN'); // real roster, has real centers
  const needMultiplierForGuard = evaluatorModule.needMultiplier('PG', centerHeavyTeam);
  assert.ok(typeof needMultiplierForGuard === 'number' && needMultiplierForGuard > 0);

  console.log('checkAdjustedPlayerValue: OK');
}

checkAdjustedPlayerValue();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add tradeEvaluator.js scripts/validate-trades.js
git commit -m "feat: team-adjusted trade value (direction and positional need)"
```

---

### Task 5: `tradeEvaluator.js` — team-leg evaluation + counteroffer suggestion

**Files:**
- Modify: `tradeEvaluator.js`
- Modify: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: `getTeamById` (from `teams.js`), `getPlayerById`, `getTeamPayroll` (from `league.js`), `CAP_CONSTANTS` (from `data.js`), `adjustedPlayerValue` (own file, Task 4).
- Produces: `evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds)` → `{ accepted, valueOk, salaryOk, outgoingValue, incomingValue, suggestion }` — consumed by `trade.js`'s `evaluateTrade` (Task 6).

- [ ] **Step 1: Add to `tradeEvaluator.js`**

Update `_EVAL_DATA` and add above `module.exports`:

```js
var _EVAL_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll }, teams: { getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS } };
```

```js
function generateSuggestion(team, outgoing, valueOk, salaryOk) {
  if (!valueOk) {
    const worst = outgoing.slice().sort(function (a, b) { return adjustedPlayerValue(b, team) - adjustedPlayerValue(a, team); })[0];
    return worst
      ? 'Not enough value coming back for ' + team.name + '. Consider removing ' + worst.name + ' from the outgoing side, or adding another player to the incoming side.'
      : 'Not enough value coming back for ' + team.name + '. Add another player to the incoming side.';
  }
  if (!salaryOk) {
    return 'Salaries do not match closely enough for ' + team.name + ' and it lacks the cap space to absorb the difference. Add a lower-salaried player to balance the deal.';
  }
  return null;
}

function evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds) {
  const team = _EVAL_DATA.teams.getTeamById(teamId);
  const outgoing = outgoingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const incoming = incomingPlayerIds.map(_EVAL_DATA.league.getPlayerById);

  const outgoingValue = outgoing.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0);
  const incomingValue = incoming.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0);
  const valueOk = incomingValue >= 0.9 * outgoingValue;

  const outgoingSalary = outgoing.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const incomingSalary = incoming.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const payroll = _EVAL_DATA.league.getTeamPayroll(teamId);
  const capSpace = _EVAL_DATA.data.CAP_CONSTANTS.SALARY_CAP - payroll;
  const salaryIncrease = incomingSalary - outgoingSalary;
  const salaryOk = salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;

  const accepted = valueOk && salaryOk;
  return {
    accepted: accepted,
    valueOk: valueOk,
    salaryOk: salaryOk,
    outgoingValue: outgoingValue,
    incomingValue: incomingValue,
    suggestion: accepted ? null : generateSuggestion(team, outgoing, valueOk, salaryOk)
  };
}
```

- [ ] **Step 2: Update `module.exports` in `tradeEvaluator.js`**

Add `evaluateTeamLeg: evaluateTeamLeg` to the exported object.

- [ ] **Step 3: Add validation to `scripts/validate-trades.js`**

```js
function checkEvaluateTeamLeg() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

  // A star-for-scrub swap should be rejected for the team giving up the star.
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const star = bosRoster.slice().sort(function (a, b) { return b.overall - a.overall; })[0];
  const scrub = bosRoster.slice().sort(function (a, b) { return a.overall - b.overall; })[0];

  const badLeg = evaluatorModule.evaluateTeamLeg('BOS', [star.id], [scrub.id]);
  assert.strictEqual(badLeg.accepted, false, 'giving up a star for a scrub should be rejected');
  assert.ok(badLeg.suggestion, 'a rejected leg should include a suggestion');

  // An even swap between two similar players should be accepted.
  const sortedByOverall = bosRoster.slice().sort(function (a, b) { return b.overall - a.overall; });
  const mid1 = sortedByOverall[Math.floor(sortedByOverall.length / 2)];
  const mid2 = sortedByOverall[Math.floor(sortedByOverall.length / 2) + 1] || sortedByOverall[Math.floor(sortedByOverall.length / 2) - 1];
  const evenLeg = evaluatorModule.evaluateTeamLeg('BOS', [mid1.id], [mid1.id]); // trading a player for themself is a trivial exact-value check
  assert.strictEqual(evenLeg.accepted, true, 'a player traded for themself must be an exact value/salary match');

  console.log('checkEvaluateTeamLeg: OK');
}

checkEvaluateTeamLeg();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add tradeEvaluator.js scripts/validate-trades.js
git commit -m "feat: per-team trade leg evaluation with counteroffer suggestions"
```

---

### Task 6: `trade.js` — multi-team proposal evaluation, roster checks, execution

**Files:**
- Create: `trade.js`
- Modify: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: `evaluateTeamLeg` (from `tradeEvaluator.js`), `getTeamRoster`, `getPlayerById` (from `league.js`).
- Produces: `evaluateTrade(proposal, userTeamId)`, `validateRosterSizes(proposal)`, `executeTrade(proposal)`, `proposeTrade(proposal, userTeamId)` — consumed by `ui/tradeCenter.js` (Task 8-9).

A `proposal` looks like: `{ participants: [teamId, ...], assignments: [{ playerId, fromTeamId, toTeamId }, ...] }`.

- [ ] **Step 1: Write `trade.js`**

```js
var _TRADE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), tradeEvaluator: require('./tradeEvaluator.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById }, tradeEvaluator: { evaluateTeamLeg: evaluateTeamLeg } };

function validateRosterSizes(proposal) {
  const errors = [];
  proposal.participants.forEach(function (teamId) {
    const currentSize = _TRADE_DATA.league.getTeamRoster(teamId).length;
    const outgoingCount = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).length;
    const incomingCount = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).length;
    const newSize = currentSize - outgoingCount + incomingCount;
    if (newSize < 12 || newSize > 15) {
      errors.push(teamId + ' roster would be ' + newSize + ' players (must stay between 12 and 15)');
    }
  });
  return errors;
}

function evaluateTrade(proposal, userTeamId) {
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId) {
      legs[teamId] = { accepted: true, isUser: true };
      return;
    }
    const outgoing = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).map(function (a) { return a.playerId; });
    const incoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).map(function (a) { return a.playerId; });
    legs[teamId] = _TRADE_DATA.tradeEvaluator.evaluateTeamLeg(teamId, outgoing, incoming);
  });
  const accepted = Object.keys(legs).every(function (teamId) { return legs[teamId].accepted; });
  return { accepted: accepted, legs: legs };
}

function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
  });
}

function proposeTrade(proposal, userTeamId) {
  const rosterErrors = validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { accepted: false, rosterErrors: rosterErrors, legs: {} };
  }
  const evaluation = evaluateTrade(proposal, userTeamId);
  if (evaluation.accepted) {
    executeTrade(proposal);
  }
  return Object.assign({ rosterErrors: [] }, evaluation);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateRosterSizes: validateRosterSizes,
    evaluateTrade: evaluateTrade,
    executeTrade: executeTrade,
    proposeTrade: proposeTrade
  };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-trades.js`**

```js
function checkProposeTrade() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  // 2-team trade: two GSW/LAC bench players swapped 1-for-1 across teams that
  // both need bodies at that position should be evaluated (accept or reject is
  // fine — the point is the plumbing runs end to end without throwing, and a
  // rejected trade must not mutate any player).
  const gswRoster = leagueModule.getTeamRoster('GSW');
  const lacRoster = leagueModule.getTeamRoster('LAC');
  const gswPlayer = gswRoster[gswRoster.length - 1];
  const lacPlayer = lacRoster[lacRoster.length - 1];

  const twoTeamProposal = {
    participants: ['GSW', 'LAC'],
    assignments: [
      { playerId: gswPlayer.id, fromTeamId: 'GSW', toTeamId: 'LAC' },
      { playerId: lacPlayer.id, fromTeamId: 'LAC', toTeamId: 'GSW' }
    ]
  };
  const result = tradeModule.proposeTrade(twoTeamProposal, 'GSW');
  assert.strictEqual(typeof result.accepted, 'boolean');
  if (!result.accepted) {
    assert.strictEqual(gswPlayer.teamId, 'GSW', 'a rejected trade must not move any player');
    assert.strictEqual(lacPlayer.teamId, 'LAC', 'a rejected trade must not move any player');
  } else {
    assert.strictEqual(gswPlayer.teamId, 'LAC');
    assert.strictEqual(lacPlayer.teamId, 'GSW');
    // restore state for later checks
    gswPlayer.teamId = 'GSW';
    lacPlayer.teamId = 'LAC';
  }

  // Roster-size guard: proposing to send a player away without receiving anyone
  // back must never be allowed to push a team below 12.
  const smallTeam = 'CHA'; // any real team works; this just needs an outgoing-only leg
  const chaRoster = leagueModule.getTeamRoster(smallTeam);
  const oneWayProposal = {
    participants: [smallTeam, 'LAL'],
    assignments: chaRoster.slice(0, chaRoster.length - 11).map(function (p) {
      return { playerId: p.id, fromTeamId: smallTeam, toTeamId: 'LAL' };
    })
  };
  const rosterErrors = tradeModule.validateRosterSizes(oneWayProposal);
  assert.ok(rosterErrors.length > 0, 'sending most of a roster away with nothing back should fail the roster-size check');

  // 3-team trade: plumbing must handle 3 participants without special-casing.
  const denPlayer = leagueModule.getTeamRoster('DEN')[leagueModule.getTeamRoster('DEN').length - 1];
  const minPlayer = leagueModule.getTeamRoster('MIN')[leagueModule.getTeamRoster('MIN').length - 1];
  const okcPlayer = leagueModule.getTeamRoster('OKC')[leagueModule.getTeamRoster('OKC').length - 1];
  const threeTeamProposal = {
    participants: ['DEN', 'MIN', 'OKC'],
    assignments: [
      { playerId: denPlayer.id, fromTeamId: 'DEN', toTeamId: 'MIN' },
      { playerId: minPlayer.id, fromTeamId: 'MIN', toTeamId: 'OKC' },
      { playerId: okcPlayer.id, fromTeamId: 'OKC', toTeamId: 'DEN' }
    ]
  };
  const threeTeamResult = tradeModule.proposeTrade(threeTeamProposal, 'DEN');
  assert.strictEqual(typeof threeTeamResult.accepted, 'boolean');
  assert.strictEqual(Object.keys(threeTeamResult.legs).length, 3, 'a 3-team trade should evaluate all 3 legs');

  console.log('checkProposeTrade: OK');
}

checkProposeTrade();
console.log('All trade validations passed');
```

Move the pre-existing final `console.log('All trade validations passed');` (currently after `checkEvaluateTeamLeg()`) so it appears only once, at the very end, after this new check.

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-trades.js` — expect all six checks (`checkWaivePlayer`, `checkBasePlayerValue`, `checkAdjustedPlayerValue`, `checkEvaluateTeamLeg`, `checkProposeTrade`) to print `OK`, then `All trade validations passed`.

```bash
cd "C:\Users\cory\Desktop\nba"
git add trade.js scripts/validate-trades.js
git commit -m "feat: multi-team trade proposal evaluation, roster checks, and execution"
```

---

### Task 7: `ui/roster.js` — Waive button

**Files:**
- Modify: `ui/roster.js`

**Interfaces:**
- Consumes: `waivePlayer` (from `rosterMoves.js`).
- Produces: same `renderRoster(container, teamId)` signature, with one new column.

- [ ] **Step 1: Add a Waive column to `ROSTER_COLUMNS`-driven table in `ui/roster.js`**

In the `draw()` function's header-building loop, after the existing `ROSTER_COLUMNS.forEach(...)` block, append one more `<th>`:

```js
html += '<th>Action</th>';
```

In the row-building loop, change the closing of each row from `'</tr>';` to include an action cell before the closing tag:

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
    '<td><button data-waive-id="' + p.id + '">Waive</button></td>' +
    '</tr>';
});
```

After `container.innerHTML = html;` and the existing `th` sort-listener wiring, add a listener for waive buttons:

```js
container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const playerId = btn.getAttribute('data-waive-id');
    const result = waivePlayer(playerId);
    if (!result.success) {
      alert(result.reason);
      return;
    }
    roster = getTeamRoster(teamId).slice();
    draw();
  });
});
```

- [ ] **Step 2: Manual verification note**

Pure DOM change — verified end-to-end in Task 9.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/roster.js
git commit -m "feat: waive button on the roster view"
```

---

### Task 8: `ui/tradeCenter.js` — team/player picker with running value panel

**Files:**
- Create: `ui/tradeCenter.js`

**Interfaces:**
- Consumes: `TEAMS` (from `teams.js`), `getTeamRoster` (from `league.js`), `adjustedPlayerValue` (from `tradeEvaluator.js`).
- Produces: `renderTradeCenter(container, userTeamId)` — registered into `script.js`'s `BUILT_VIEWS.trade` in Task 9. Internally builds up a proposal object and hands off to Task 9's propose/negotiate wiring, which is layered on top in the same file.

- [ ] **Step 1: Write the team/player selection UI in `ui/tradeCenter.js`**

```js
function renderTradeCenter(container, userTeamId) {
  const state = {
    participants: [userTeamId],
    assignments: [] // { playerId, fromTeamId, toTeamId }
  };

  function draw() {
    let html = '<h2>Trade Center</h2>';

    html += '<h3>Participants</h3><select id="add-team-select"><option value="">Add a team...</option>';
    TEAMS.forEach(function (t) {
      if (state.participants.indexOf(t.id) === -1) {
        html += '<option value="' + t.id + '">' + t.name + '</option>';
      }
    });
    html += '</select>';

    state.participants.forEach(function (teamId) {
      const team = getTeamById(teamId);
      const roster = getTeamRoster(teamId);
      const outgoing = state.assignments.filter(function (a) { return a.fromTeamId === teamId; });
      const incoming = state.assignments.filter(function (a) { return a.toTeamId === teamId; });
      const outgoingValue = outgoing.reduce(function (s, a) { return s + adjustedPlayerValue(getPlayerById(a.playerId), team); }, 0);
      const incomingValue = incoming.reduce(function (s, a) { return s + adjustedPlayerValue(getPlayerById(a.playerId), team); }, 0);
      const outgoingSalary = outgoing.reduce(function (s, a) { return s + getPlayerById(a.playerId).contract.salary; }, 0);
      const incomingSalary = incoming.reduce(function (s, a) { return s + getPlayerById(a.playerId).contract.salary; }, 0);

      html += '<div class="trade-team-panel" data-team-id="' + teamId + '">';
      html += '<h3>' + team.name + (teamId === userTeamId ? ' (You)' : '') + '</h3>';
      html += '<p>Outgoing value: ' + outgoingValue.toFixed(1) + ' / Incoming value: ' + incomingValue.toFixed(1) + '</p>';
      html += '<p>Outgoing salary: $' + outgoingSalary.toLocaleString() + ' / Incoming salary: $' + incomingSalary.toLocaleString() + '</p>';

      html += '<table><thead><tr><th>Player</th><th>In trade?</th><th>Send to</th></tr></thead><tbody>';
      roster.forEach(function (p) {
        const assignment = state.assignments.find(function (a) { return a.playerId === p.id; });
        html += '<tr><td>' + p.name + ' (' + p.overall + ' OVR)</td>' +
          '<td><input type="checkbox" data-player-id="' + p.id + '" data-from-team="' + teamId + '"' + (assignment ? ' checked' : '') + '></td>' +
          '<td><select data-dest-for="' + p.id + '"' + (assignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></td></tr>';
      });
      html += '</tbody></table></div>';
    });

    html += '<div id="trade-result"></div>';
    html += '<button id="propose-trade-btn">Propose Trade</button>';

    container.innerHTML = html;
    wireEvents();
  }

  function wireEvents() {
    document.getElementById('add-team-select').addEventListener('change', function (e) {
      if (e.target.value) {
        state.participants.push(e.target.value);
        draw();
      }
    });

    container.querySelectorAll('input[type="checkbox"][data-player-id]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const playerId = cb.getAttribute('data-player-id');
        const fromTeam = cb.getAttribute('data-from-team');
        if (cb.checked) {
          const destSelect = container.querySelector('select[data-dest-for="' + playerId + '"]');
          const toTeam = destSelect.value || state.participants.filter(function (t) { return t !== fromTeam; })[0];
          state.assignments.push({ playerId: playerId, fromTeamId: fromTeam, toTeamId: toTeam });
        } else {
          state.assignments = state.assignments.filter(function (a) { return a.playerId !== playerId; });
        }
        draw();
      });
    });

    container.querySelectorAll('select[data-dest-for]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const playerId = sel.getAttribute('data-dest-for');
        const assignment = state.assignments.find(function (a) { return a.playerId === playerId; });
        if (assignment) assignment.toTeamId = sel.value;
      });
    });

    document.getElementById('propose-trade-btn').addEventListener('click', function () {
      handlePropose(state, userTeamId, draw);
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTradeCenter: renderTradeCenter };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/tradeCenter.js
git commit -m "feat: trade center team/player picker with running value panel"
```

---

### Task 9: `ui/tradeCenter.js` — propose/negotiate wiring + full app wiring + end-to-end verification

**Files:**
- Modify: `ui/tradeCenter.js`
- Modify: `script.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `proposeTrade` (from `trade.js`).
- Produces: `handlePropose(state, userTeamId, redraw)`, referenced by Task 8's button handler (which was written expecting this function to exist by the time it's called — both live in the same file, this task completes it).

- [ ] **Step 1: Add `handlePropose` to `ui/tradeCenter.js`**

Add above `renderTradeCenter` (or anywhere at module scope in the same file — function declarations are hoisted, so exact position doesn't matter for the reference from Task 8's `wireEvents`):

```js
function handlePropose(state, userTeamId, redraw) {
  if (state.assignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player to the trade first.</p>';
    return;
  }
  const result = proposeTrade(state, userTeamId);
  const resultEl = document.getElementById('trade-result');

  if (result.rosterErrors.length > 0) {
    resultEl.innerHTML = '<p>Trade invalid: ' + result.rosterErrors.join('; ') + '</p>';
    return;
  }

  if (result.accepted) {
    resultEl.innerHTML = '<p>Trade accepted and executed!</p>';
    state.assignments = [];
    redraw();
    return;
  }

  let html = '<h4>Trade rejected</h4><ul>';
  Object.keys(result.legs).forEach(function (teamId) {
    const leg = result.legs[teamId];
    if (!leg.accepted && !leg.isUser) {
      html += '<li>' + getTeamById(teamId).name + ': ' + (leg.suggestion || 'not enough value or salary mismatch') + '</li>';
    }
  });
  html += '</ul><p>Adjust the proposal above and propose again.</p>';
  resultEl.innerHTML = html;
}
```

- [ ] **Step 2: Register the view in `script.js`**

Update `BUILT_VIEWS`:

```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter
};
```

- [ ] **Step 3: Update `index.html`'s script tags**

Add after `playoffs.js` and before `ui/nav.js`:

```html
<script src="rosterMoves.js"></script>
<script src="tradeEvaluator.js"></script>
<script src="trade.js"></script>
```

Add after `ui/settings.js` and before `script.js`:

```html
<script src="ui/tradeCenter.js"></script>
```

- [ ] **Step 4: Run the full Node validation suite**

Run: `node scripts/validate-trades.js` — all checks pass.
Run: `node scripts/validate-sim.js` — confirm no regression (Phase 2 logic untouched).
Run: `node scripts/validate-data.js` — confirm no regression (Phase 1 data + new `timeline` field all valid).

- [ ] **Step 5: Manual browser verification**

Using the `run` skill (or a local static server, as in Phases 1-2):
1. Select a team, go to "Trade Center" in the nav. Confirm your team's roster panel appears with an "Add a team..." dropdown.
2. Add one other team. Confirm its roster panel appears with an outgoing/incoming value and salary readout (both 0 initially).
3. Check a box next to one of your players — confirm the destination dropdown enables and the outgoing value/salary numbers update for your team.
4. Check a box next to one of the other team's players, aimed back at your team — confirm both panels' numbers update.
5. Click "Propose Trade". Confirm you get either "Trade accepted and executed!" (and both players' rosters actually swapped — check the Roster view) or a rejection message naming the specific team and a concrete suggestion.
6. If rejected, follow the suggestion (add/remove a player) and propose again — confirm it can eventually be accepted, or confirm the message updates sensibly on each attempt.
7. Add a third team and confirm the flow still works with 3 participants (no errors, all three panels render).
8. Go to Roster, click "Waive" on a bench player. Confirm they disappear from the roster table and the roster size decreases by one. Try waiving down to 12 players, then attempt one more — confirm it's blocked with an alert instead of silently succeeding.
9. Confirm the browser console shows no errors throughout.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/tradeCenter.js script.js index.html
git commit -m "chore: wire Trade Center into the app shell and verify end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** waiving to a derived free-agent pool ✓ Task 2, 7. Multi-team (2-4) trade construction ✓ Task 8. Salary-matching validation ✓ Task 5. AI evaluation per team's own net value/salary ✓ Tasks 3-6. Multi-round counteroffer negotiation via edit-and-resubmit ✓ Task 9 (`handlePropose` leaves the proposal editable on rejection, no separate negotiation state machine). Team `timeline` field ✓ Task 1.
- **Placeholder scan:** no TBD/TODO. The trade-value formula constants (0.9 value threshold, 25%+$2M salary band, position-need thresholds) are concrete numbers, not hand-waved — chosen to be reasonable and documented inline, consistent with the design doc's "simplified/approximate" framing.
- **Type/interface consistency:** `evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds)` signature is identical between its definition (Task 5) and its call site in `trade.js`'s `evaluateTrade` (Task 6). `proposeTrade(proposal, userTeamId)` return shape (`{ accepted, rosterErrors, legs }`) is consumed consistently by `handlePropose` (Task 9) exactly as defined in Task 6. `adjustedPlayerValue(player, team)` takes a full `Team` object (not just an id) consistently in both `tradeEvaluator.js` internals and `ui/tradeCenter.js`'s running panel.
- **Node/browser dual-loading:** `rosterMoves.js`, `tradeEvaluator.js`, `trade.js` all follow the established `_XXX_DATA` conditional-require pattern. None of them are required back by `league.js`/`teams.js`/`data.js`, so — unlike Phase 2's `simulateDate` — there's no circular-require risk here; all three can require their dependencies eagerly at module load time.
