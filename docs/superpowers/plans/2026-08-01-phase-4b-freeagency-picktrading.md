# Phase 4 Batch B: Free Agency & Pick Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the offseason loop Batch A left unfinished — free agency (silent AI-vs-AI resolution plus interactive bidding wars for players the user pursues), draft-pick trading extending Phase 3's `trade.js`, and a real "Advance to Next Season" flow that takes the league from a finished playoff bracket all the way to a fresh, simulatable new season.

**Architecture:** Same dual browser-global/Node-testable pattern as every prior phase. `freeAgency.js` and `freeAgencyBidding.js` are pure-logic and unit-tested with plain Node `assert`. `tradeEvaluator.js`/`trade.js`/`draft.js` are *extended* (new optional parameters, not rewrites) so Phase 3's and Batch A's existing tests keep passing unchanged. `seasonTransition.js` gains the final orchestration step.

**Tech Stack:** Same as every prior phase — HTML, CSS, vanilla JavaScript, no build step, no external APIs, no frameworks. Node.js used only for development-time validation scripts.

## Global Constraints

- Same constraints as Phases 1-3 and Batch A: vanilla JS only, no frameworks/build step, offline, modular files, comment only non-obvious logic, ratings/attributes stay 25-99, `potential >= overall`, roster size stays in [12, 15].
- No hidden traits/personality in free agent decisions (Phase 5 doesn't exist yet) — decision weights use only money, contention (team timeline), playing time (positional depth), market size, and prestige. Coach quality is dropped (no coach entities exist).
- Backward compatibility is a hard requirement this batch: every function this batch extends (`evaluateTeamLeg`, `buildDraftOrder`, `estimateFuturePickValue`) must keep Phase 3's and Batch A's existing validation scripts passing without modification, except where a task explicitly says to update an existing test (Task 6 is the one deliberate exception, and it says why).

---

## File Structure

```
teams.js                # MODIFIED — each team gains marketSize + an initial draftPicks pair
draftPickValue.js         # MODIFIED — estimateFuturePickValue signature revised (Task 6 explains why)
freeAgency.js             # NEW — decision-weight scoring, AI offers, signing, silent resolution
freeAgencyBidding.js        # NEW — interactive bidding-war state machine for user-pursued players
tradeEvaluator.js          # MODIFIED — evaluateTeamLeg gains optional pick-value parameters
trade.js                 # MODIFIED — evaluateTrade/executeTrade handle proposal.pickAssignments
draft.js                 # MODIFIED — buildDraftOrder remaps slots for traded pick ownership
seasonTransition.js        # MODIFIED — adds generateNewSeason(), the final offseason step
ui/freeAgency.js          # NEW — free agent list, offer UI, bidding UI, AI signing log
ui/tradeCenter.js          # MODIFIED — trade builder can include draft picks
script.js                # MODIFIED — Free Agency view registered, "Advance to Next Season" flow
```

---

### Task 1: `teams.js` — market size + initial draft pick ownership

**Files:**
- Modify: `teams.js`
- Modify: `scripts/validate-data.js`

**Interfaces:**
- Produces: every `Team` gains `marketSize` (1-100, hand-authored like `prestige`/`timeline`) and `draftPicks: [{round, originalTeamId, currentOwnerId}, ...]` (2 entries per team: this team's own upcoming round-1 and round-2 pick, both currently owned by themselves). Consumed by `freeAgency.js` (Task 2) and the pick-trading tasks (7-8).

- [ ] **Step 1: Add `marketSize` and replace the empty `draftPicks: []` in every team object in `teams.js`**

Market size (hand-authored, real-world judgment call): `NYK 98, BKN 95, LAL 97, LAC 90, GSW 88, CHI 85, BOS 78, PHI 75, DAL 72, HOU 70, MIA 70, TOR 68, WAS 60, ATL 58, DEN 55, PHX 55, SAC 52, DET 50, CLE 48, MIN 46, POR 45, SAS 45, ORL 44, IND 40, CHA 38, UTA 36, NOP 35, OKC 32, MEM 30, MIL 42`.

For each team, add `marketSize: N,` after `timeline: '...',` and replace `draftPicks: []` with:
```js
draftPicks: [
  { round: 1, originalTeamId: 'BOS', currentOwnerId: 'BOS' },
  { round: 2, originalTeamId: 'BOS', currentOwnerId: 'BOS' }
]
```
(substituting each team's own id for `'BOS'` on its own line).

- [ ] **Step 2: Extend `checkTeams` in `scripts/validate-data.js`**

Add inside the existing `teams.TEAMS.forEach` loop:

```js
assert.ok(t.marketSize >= 1 && t.marketSize <= 100, 'invalid marketSize on ' + t.id);
assert.strictEqual(t.draftPicks.length, 2, t.id + ' should start with exactly 2 owned picks');
assert.deepStrictEqual(t.draftPicks.map(function (p) { return p.round; }), [1, 2]);
t.draftPicks.forEach(function (p) {
  assert.strictEqual(p.originalTeamId, t.id);
  assert.strictEqual(p.currentOwnerId, t.id);
});
```

- [ ] **Step 3: Run the validator, then commit**

Run: `node scripts/validate-data.js` — all checks pass.

```bash
cd "C:\Users\cory\Desktop\nba"
git add teams.js scripts/validate-data.js
git commit -m "feat: add team market size and initial draft pick ownership"
```

---

### Task 2: `freeAgency.js` — player decision-weight scoring

**Files:**
- Create: `freeAgency.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `getTeamRoster` (from `league.js`).
- Produces: `playingTimeScore(player, team)`, `scoreOffer(player, team, offer)` — consumed by every later task in this file and by `freeAgencyBidding.js` (Task 5).

- [ ] **Step 1: Write `freeAgency.js`**

```js
var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js') }
  : { league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById }, teams: { TEAMS: TEAMS, getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS } };

// Higher score = more playing-time opportunity: wide open at the position,
// clearly the best there, or buried behind better players.
function playingTimeScore(player, team) {
  const roster = _FA_DATA.league.getTeamRoster(team.id).filter(function (p) { return p.id !== player.id; });
  const samePosition = roster.filter(function (p) { return p.position === player.position; });
  if (samePosition.length === 0) return 1.0;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.overall; }, 0) / samePosition.length;
  if (player.overall > avgAtPosition + 5) return 0.9;
  if (player.overall < avgAtPosition - 10) return 0.2;
  return 0.5;
}

// Master-spec factors: money, contention, playing time, market size, prestige.
// Coach quality is dropped (no coach entities exist). Weights shift with age:
// veterans care relatively more about contention, young players about minutes.
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.35;
  const marketWeight = 0.10;
  const prestigeWeight = 0.15;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  return salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight + marketScore * marketWeight + prestigeScore * prestigeWeight;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { playingTimeScore: playingTimeScore, scoreOffer: scoreOffer };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkScoreOffer() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const player = { id: 'test-fa-player', age: 34, overall: 82, position: 'SF' };
  const winNowTeam = teamsModule.getTeamById('LAL');
  const rebuildingTeam = teamsModule.getTeamById('WAS');

  const sameOffer = { salary: 20000000, yearsRemaining: 2 };
  const winNowScore = freeAgencyModule.scoreOffer(player, winNowTeam, sameOffer);
  const rebuildingScore = freeAgencyModule.scoreOffer(player, rebuildingTeam, sameOffer);
  assert.ok(winNowScore > rebuildingScore, 'an aging star should score an identical offer higher from a win-now team than a rebuilding one');

  const bigOffer = { salary: 40000000, yearsRemaining: 2 };
  const smallOffer = { salary: 5000000, yearsRemaining: 2 };
  assert.ok(
    freeAgencyModule.scoreOffer(player, winNowTeam, bigOffer) > freeAgencyModule.scoreOffer(player, winNowTeam, smallOffer),
    'more money should score higher, all else equal'
  );

  console.log('checkScoreOffer: OK');
}

checkScoreOffer();
```

(Insert before the final `console.log('All offseason validations passed');`, matching every prior task's pattern in this file.)

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add freeAgency.js scripts/validate-offseason.js
git commit -m "feat: free agent decision-weight scoring (money, contention, playing time, market, prestige)"
```

---

### Task 3: `freeAgency.js` — AI offers + signing

**Files:**
- Modify: `freeAgency.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `adjustedPlayerValue` (from `tradeEvaluator.js`), `CAP_CONSTANTS` (from `data.js`), `getTeamPayroll`/`getTeamRoster` (from `league.js`).
- Produces: `estimateFairSalary(player)`, `generateAIOffer(team, player, rng)`, `signPlayer(player, offer)` — consumed by Task 4 (silent resolution) and `freeAgencyBidding.js` (Task 5).

- [ ] **Step 1: Add to `freeAgency.js`**

Update `_FA_DATA` and add above `module.exports`:

```js
var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), tradeEvaluator: require('./tradeEvaluator.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }
    };
```

```js
function estimateFairSalary(player) {
  return Math.max(1200000, (player.overall - 45) * 900000);
}

function generateAIOffer(team, player, rng) {
  if (_FA_DATA.league.getTeamRoster(team.id).length >= 15) return null;
  const capSpace = _FA_DATA.data.CAP_CONSTANTS.SALARY_CAP - _FA_DATA.league.getTeamPayroll(team.id);
  if (capSpace < 1200000) return null;
  const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
  if (interest < 40) return null;
  const fair = estimateFairSalary(player);
  const salary = Math.max(1200000, Math.min(capSpace, Math.round(fair * (0.85 + rng() * 0.3))));
  const years = 1 + Math.floor(rng() * 4);
  return { teamId: team.id, salary: salary, yearsRemaining: years };
}

function signPlayer(player, offer) {
  const roster = _FA_DATA.league.getTeamRoster(offer.teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  player.teamId = offer.teamId;
  player.jerseyNumber = jersey;
  player.contract = { salary: offer.salary, yearsRemaining: offer.yearsRemaining, playerOption: false, teamOption: false };
}
```

- [ ] **Step 2: Update `module.exports` in `freeAgency.js`**

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playingTimeScore: playingTimeScore,
    scoreOffer: scoreOffer,
    estimateFairSalary: estimateFairSalary,
    generateAIOffer: generateAIOffer,
    signPlayer: signPlayer
  };
}
```

- [ ] **Step 3: Add validation to `scripts/validate-offseason.js`**

```js
function checkAIOfferAndSigning() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const rng = makeRng(700);

  const testPlayer = { id: 'test-fa-sign', name: 'Test Player', age: 27, overall: 76, potential: 78, position: 'SG', teamId: null, jerseyNumber: null, contract: { salary: 0, yearsRemaining: 0, playerOption: false, teamOption: false } };
  const team = teamsModule.getTeamById('MIA');

  const offer = freeAgencyModule.generateAIOffer(team, testPlayer, rng);
  if (offer) {
    assert.strictEqual(offer.teamId, 'MIA');
    assert.ok(offer.salary > 0);
    assert.ok(offer.yearsRemaining >= 1 && offer.yearsRemaining <= 4);

    freeAgencyModule.signPlayer(testPlayer, offer);
    assert.strictEqual(testPlayer.teamId, 'MIA');
    assert.strictEqual(testPlayer.contract.salary, offer.salary);
    assert.ok(typeof testPlayer.jerseyNumber === 'number');

    const roster = leagueModule.getTeamRoster('MIA');
    assert.ok(roster.some(function (p) { return p.id === testPlayer.id; }), 'signed player must appear on the roster');
  }

  console.log('checkAIOfferAndSigning: OK');
}

checkAIOfferAndSigning();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add freeAgency.js scripts/validate-offseason.js
git commit -m "feat: AI free agent offers and player signing"
```

---

### Task 4: `freeAgency.js` — silent AI-vs-AI resolution

**Files:**
- Modify: `freeAgency.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `getFreeAgents` (from `rosterMoves.js`), `basePlayerValue` (from `tradeEvaluator.js`), everything from Tasks 2-3 (own file).
- Produces: `resolveFreeAgentSilently(player, rng)`, `runFreeAgencySilently(rng)` — consumed by `seasonTransition.js` (Task 9) and the "Resolve Remaining Free Agents" UI action (Task 10).

- [ ] **Step 1: Add to `freeAgency.js`**

Update `_FA_DATA` and add above `module.exports`:

```js
var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), tradeEvaluator: require('./tradeEvaluator.js'), rosterMoves: require('./rosterMoves.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, basePlayerValue: basePlayerValue },
      rosterMoves: { getFreeAgents: getFreeAgents }
    };
```

```js
function resolveFreeAgentSilently(player, rng) {
  const offers = _FA_DATA.teams.TEAMS.map(function (t) { return generateAIOffer(t, player, rng); }).filter(Boolean);
  if (offers.length === 0) return null;
  let best = offers[0];
  let bestScore = scoreOffer(player, _FA_DATA.teams.getTeamById(best.teamId), best);
  for (let i = 1; i < offers.length; i++) {
    const score = scoreOffer(player, _FA_DATA.teams.getTeamById(offers[i].teamId), offers[i]);
    if (score > bestScore) { best = offers[i]; bestScore = score; }
  }
  signPlayer(player, best);
  return best;
}

// Resolves every current free agent, best (highest base value) first — so
// stars sign before the depth-piece market resolves against whatever cap
// space is left, same as how real free agency tends to play out.
function runFreeAgencySilently(rng) {
  const pool = _FA_DATA.rosterMoves.getFreeAgents().slice()
    .sort(function (a, b) { return _FA_DATA.tradeEvaluator.basePlayerValue(b) - _FA_DATA.tradeEvaluator.basePlayerValue(a); });
  const results = [];
  pool.forEach(function (player) {
    const offer = resolveFreeAgentSilently(player, rng);
    if (offer) results.push({ playerId: player.id, teamId: offer.teamId, salary: offer.salary });
  });
  return results;
}
```

- [ ] **Step 2: Update `module.exports` in `freeAgency.js`**

Add `resolveFreeAgentSilently: resolveFreeAgentSilently, runFreeAgencySilently: runFreeAgencySilently` to the exported object.

- [ ] **Step 3: Add validation to `scripts/validate-offseason.js`**

```js
function checkSilentFreeAgencyResolution() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const rng = makeRng(800);

  // Manufacture a small, deterministic free agent pool via waiving.
  const roster = leagueModule.getTeamRoster('BOS');
  const waivedIds = [];
  for (let i = 0; i < 2 && roster.length - waivedIds.length > 12; i++) {
    const target = roster[i];
    rosterMovesModule.waivePlayer(target.id);
    waivedIds.push(target.id);
  }

  const before = rosterMovesModule.getFreeAgents().length;
  const results = freeAgencyModule.runFreeAgencySilently(rng);
  const after = rosterMovesModule.getFreeAgents().length;

  assert.ok(results.length >= 0, 'should return an array of signings (possibly empty if no team had room)');
  assert.ok(after <= before, 'free agent pool should shrink or stay the same, never grow, after resolution');
  results.forEach(function (r) {
    const player = leagueModule.getPlayerById(r.playerId);
    assert.strictEqual(player.teamId, r.teamId, 'a resolved signing must actually be reflected on the player record');
  });

  console.log('checkSilentFreeAgencyResolution: OK (' + results.length + ' signed of ' + before + ' free agents)');
}

checkSilentFreeAgencyResolution();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add freeAgency.js scripts/validate-offseason.js
git commit -m "feat: silent AI-vs-AI free agency resolution"
```

---

### Task 5: `freeAgencyBidding.js` — interactive bidding war

**Files:**
- Create: `freeAgencyBidding.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `getPlayerById` (from `league.js`), `getTeamById` (from `teams.js`), `CAP_CONSTANTS` (from `data.js`), `getTeamPayroll` (from `league.js`), `scoreOffer`/`generateAIOffer`/`signPlayer` (from `freeAgency.js`).
- Produces: `startBidding(playerId, userTeamId, rng)`, `evaluateBiddingRound(state, userSalary, userYears)`, `finalizeBidding(state, userAccepts)` — consumed by `ui/freeAgency.js` (Task 10).

- [ ] **Step 1: Write `freeAgencyBidding.js`**

```js
var _BIDDING_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), freeAgency: require('./freeAgency.js') }
  : {
      league: { getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS },
      freeAgency: { scoreOffer: scoreOffer, generateAIOffer: generateAIOffer, signPlayer: signPlayer }
    };

function startBidding(playerId, userTeamId, rng) {
  const player = _BIDDING_DATA.league.getPlayerById(playerId);
  const aiOffers = [];
  // Iterate every team except the user's; generateAIOffer already screens out
  // teams with no room or no real interest.
  _BIDDING_DATA.teams.TEAMS
    .filter(function (t) { return t.id !== userTeamId; })
    .forEach(function (t) {
      const offer = _BIDDING_DATA.freeAgency.generateAIOffer(t, player, rng);
      if (offer) aiOffers.push(offer);
    });
  return { playerId: playerId, userTeamId: userTeamId, aiOffers: aiOffers, userOffer: null, rounds: 0 };
}

function bestAIOffer(state) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  const sorted = state.aiOffers.slice().sort(function (a, b) {
    return _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(b.teamId), b)
      - _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(a.teamId), a);
  });
  return sorted[0] || null;
}

function evaluateBiddingRound(state, userSalary, userYears) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  const userTeam = _BIDDING_DATA.teams.getTeamById(state.userTeamId);
  const userOffer = { teamId: state.userTeamId, salary: userSalary, yearsRemaining: userYears };
  state.userOffer = userOffer;
  const userScore = _BIDDING_DATA.freeAgency.scoreOffer(player, userTeam, userOffer);

  state.aiOffers = state.aiOffers.map(function (o) {
    const aiTeam = _BIDDING_DATA.teams.getTeamById(o.teamId);
    const currentScore = _BIDDING_DATA.freeAgency.scoreOffer(player, aiTeam, o);
    if (currentScore >= userScore) return o; // already winning, no need to raise
    const capSpace = _BIDDING_DATA.data.CAP_CONSTANTS.SALARY_CAP - _BIDDING_DATA.league.getTeamPayroll(o.teamId) + o.salary;
    const raisedSalary = Math.min(capSpace, Math.round(o.salary * 1.1));
    if (raisedSalary <= o.salary) return null; // no room to raise, drops out
    const raised = { teamId: o.teamId, salary: raisedSalary, yearsRemaining: o.yearsRemaining };
    const raisedScore = _BIDDING_DATA.freeAgency.scoreOffer(player, aiTeam, raised);
    if (raisedScore < userScore * 0.95) return null; // still clearly behind, gives up
    return raised;
  }).filter(Boolean);

  state.rounds += 1;

  const best = bestAIOffer(state);
  const bestScore = best ? _BIDDING_DATA.freeAgency.scoreOffer(player, _BIDDING_DATA.teams.getTeamById(best.teamId), best) : -Infinity;
  return { userWinning: userScore >= bestScore, bestAIOffer: best };
}

function finalizeBidding(state, userAccepts) {
  const player = _BIDDING_DATA.league.getPlayerById(state.playerId);
  if (userAccepts && state.userOffer) {
    _BIDDING_DATA.freeAgency.signPlayer(player, state.userOffer);
    return { signed: true, teamId: state.userTeamId };
  }
  const best = bestAIOffer(state);
  if (best) {
    _BIDDING_DATA.freeAgency.signPlayer(player, best);
    return { signed: true, teamId: best.teamId };
  }
  return { signed: false, teamId: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startBidding: startBidding, evaluateBiddingRound: evaluateBiddingRound, finalizeBidding: finalizeBidding };
}
```

- [ ] **Step 2: Add validation to `scripts/validate-offseason.js`**

```js
function checkBiddingWar() {
  const biddingModule = require(path.join(__dirname, '..', 'freeAgencyBidding.js'));
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const rng = makeRng(900);

  const roster = leagueModule.getTeamRoster('DAL');
  const target = roster[roster.length - 1];
  rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(target.teamId, null);

  const state = biddingModule.startBidding(target.id, 'DAL', rng);
  assert.strictEqual(state.playerId, target.id);
  assert.strictEqual(state.userTeamId, 'DAL');

  // A lowball offer should not obviously beat every competing AI bid.
  const lowResult = biddingModule.evaluateBiddingRound(state, 1300000, 1);
  assert.ok(typeof lowResult.userWinning === 'boolean');

  // A near-max offer should win outright against any remaining competition.
  const highResult = biddingModule.evaluateBiddingRound(state, 45000000, 4);
  assert.strictEqual(highResult.userWinning, true, 'a near-max offer should beat any remaining AI bid');

  const outcome = biddingModule.finalizeBidding(state, true);
  assert.strictEqual(outcome.signed, true);
  assert.strictEqual(outcome.teamId, 'DAL');
  assert.strictEqual(target.teamId, 'DAL');

  console.log('checkBiddingWar: OK');
}

checkBiddingWar();
```

- [ ] **Step 3: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add freeAgencyBidding.js scripts/validate-offseason.js
git commit -m "feat: interactive free agency bidding war for user-pursued players"
```

---

### Task 6: `draftPickValue.js` — revise future-pick valuation for trade-time use

**Files:**
- Modify: `draftPickValue.js`
- Modify: `scripts/validate-offseason.js`

**Why this changes a Batch A function:** Batch A's `estimateFuturePickValue(pickNumber, team)` needed an exact future pick *number* as input — but at trade time, a future pick's exact slot is unknown (it depends on standings that haven't happened yet). The only thing known at trade time is the *round* and the *owning team's current trajectory*. This task revises the function to take `(round, team)` and project a representative slot from the team's timeline, which is what pick-trading (Task 7) actually needs. This is the one deliberate exception to this batch's "don't touch existing tests" rule — the old call shape didn't fit its real use case.

**Interfaces:**
- Consumes: `pickBaseValue` (own file, unchanged).
- Produces: `estimateFuturePickValue(round, team)` (signature changed from `(pickNumber, team)`) — consumed by Task 7.

- [ ] **Step 1: Replace `estimateFuturePickValue` in `draftPickValue.js`**

```js
// Projects roughly where a team's NEXT pick in a given round will land, based
// on its current timeline, then values it on the standard pick curve. Used at
// trade time, when the exact future pick number isn't knowable yet — only the
// round and who currently projects to be good or bad.
function estimateFuturePickValue(round, team) {
  let projectedSlotWithinRound;
  if (team.timeline === 'rebuilding') projectedSlotWithinRound = 5;
  else if (team.timeline === 'retooling') projectedSlotWithinRound = 15;
  else projectedSlotWithinRound = 26;
  const pickNumber = round === 1 ? projectedSlotWithinRound : 30 + projectedSlotWithinRound;
  return pickBaseValue(pickNumber);
}
```

- [ ] **Step 2: Update the existing test in `scripts/validate-offseason.js`**

Find `checkDraftPickValue` (from Batch A) and replace its two `estimateFuturePickValue` calls:

```js
assert.ok(
  pickValueModule.estimateFuturePickValue(1, rebuilding) > pickValueModule.estimateFuturePickValue(1, winNow),
  'the same future first-round pick should be worth more owned by a rebuilding team than a win-now team'
);
assert.ok(
  pickValueModule.estimateFuturePickValue(1, rebuilding) > pickValueModule.estimateFuturePickValue(2, rebuilding),
  'a future first-round pick should be worth more than a future second-round pick from the same team'
);
```

- [ ] **Step 3: Run it, then commit**

Run: `node scripts/validate-offseason.js` — all checks (including the updated `checkDraftPickValue`) pass.

```bash
cd "C:\Users\cory\Desktop\nba"
git add draftPickValue.js scripts/validate-offseason.js
git commit -m "refactor: value future picks by round+timeline instead of an unknowable exact pick number"
```

---

### Task 7: `tradeEvaluator.js` + `trade.js` — pick-aware trade evaluation and execution

**Files:**
- Modify: `tradeEvaluator.js`
- Modify: `trade.js`
- Modify: `scripts/validate-trades.js`

**Interfaces:**
- Consumes: `estimateFuturePickValue` (from `draftPickValue.js`).
- Produces: `evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds, outgoingPickValue, incomingPickValue)` (the last two parameters are new and optional, defaulting to 0 — Phase 3's existing 3-argument call sites keep working unchanged); `trade.js`'s `evaluateTrade`/`executeTrade`/`proposeTrade` now read an optional `proposal.pickAssignments` array (`[{round, fromTeamId, toTeamId}, ...]`) alongside the existing `proposal.assignments` (players).

- [ ] **Step 1: Extend `evaluateTeamLeg` in `tradeEvaluator.js`**

```js
function evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds, outgoingPickValue, incomingPickValue) {
  outgoingPickValue = outgoingPickValue || 0;
  incomingPickValue = incomingPickValue || 0;

  const team = _EVAL_DATA.teams.getTeamById(teamId);
  const outgoing = outgoingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const incoming = incomingPlayerIds.map(_EVAL_DATA.league.getPlayerById);

  const outgoingValue = outgoing.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0) + outgoingPickValue;
  const incomingValue = incoming.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0) + incomingPickValue;
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

(This replaces the Batch-3 version of the function — identical body except the two new parameters and the `+ outgoingPickValue`/`+ incomingPickValue` terms. Every existing 3-argument call site is unaffected since the new parameters default to 0.)

- [ ] **Step 2: Add pick-finding and pick-valuation helpers to `trade.js`, and extend `evaluateTrade`/`executeTrade`**

Update `_TRADE_DATA` and add above `validateRosterSizes`:

```js
var _TRADE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), tradeEvaluator: require('./tradeEvaluator.js'), teams: require('./teams.js'), draftPickValue: require('./draftPickValue.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById },
      tradeEvaluator: { evaluateTeamLeg: evaluateTeamLeg },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      draftPickValue: { estimateFuturePickValue: estimateFuturePickValue }
    };

function findPick(teamId, round) {
  const team = _TRADE_DATA.teams.getTeamById(teamId);
  return team.draftPicks.find(function (p) { return p.round === round && p.currentOwnerId === teamId; });
}

// Value is based on the pick's ORIGINAL team's timeline (whose roster/record
// the pick actually reflects), not whoever currently holds it going into this
// trade — a pick doesn't get more or less valuable just by changing hands.
function pickValueForLeg(teamId, pickAssignments) {
  let outgoing = 0;
  let incoming = 0;
  pickAssignments.forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (!pick) return;
    const originalTeam = _TRADE_DATA.teams.getTeamById(pick.originalTeamId);
    const value = _TRADE_DATA.draftPickValue.estimateFuturePickValue(pa.round, originalTeam);
    if (pa.fromTeamId === teamId) outgoing += value;
    if (pa.toTeamId === teamId) incoming += value;
  });
  return { outgoing: outgoing, incoming: incoming };
}
```

Replace `evaluateTrade` and `executeTrade`:

```js
function evaluateTrade(proposal, userTeamId) {
  const pickAssignments = proposal.pickAssignments || [];
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId) {
      legs[teamId] = { accepted: true, isUser: true };
      return;
    }
    const outgoing = proposal.assignments.filter(function (a) { return a.fromTeamId === teamId; }).map(function (a) { return a.playerId; });
    const incoming = proposal.assignments.filter(function (a) { return a.toTeamId === teamId; }).map(function (a) { return a.playerId; });
    const pickValue = pickValueForLeg(teamId, pickAssignments);
    legs[teamId] = _TRADE_DATA.tradeEvaluator.evaluateTeamLeg(teamId, outgoing, incoming, pickValue.outgoing, pickValue.incoming);
  });
  const accepted = Object.keys(legs).every(function (teamId) { return legs[teamId].accepted; });
  return { accepted: accepted, legs: legs };
}

function executeTrade(proposal) {
  proposal.assignments.forEach(function (a) {
    const player = _TRADE_DATA.league.getPlayerById(a.playerId);
    player.teamId = a.toTeamId;
  });
  (proposal.pickAssignments || []).forEach(function (pa) {
    const pick = findPick(pa.fromTeamId, pa.round);
    if (pick) pick.currentOwnerId = pa.toTeamId;
  });
}
```

`validateRosterSizes` and `proposeTrade` are unchanged — picks don't affect roster headcount.

- [ ] **Step 3: Update `module.exports` in `trade.js`**

Add `findPick: findPick, pickValueForLeg: pickValueForLeg` to the exported object.

- [ ] **Step 4: Add validation to `scripts/validate-trades.js`**

```js
function checkPickTrading() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  const proposal = {
    participants: ['SAS', 'LAL'],
    assignments: [],
    pickAssignments: [
      { round: 1, fromTeamId: 'SAS', toTeamId: 'LAL' }
    ]
  };

  const beforeOwner = tradeModule.findPick('SAS', 1).currentOwnerId;
  assert.strictEqual(beforeOwner, 'SAS');

  const result = tradeModule.proposeTrade(proposal, 'LAL');
  assert.strictEqual(typeof result.accepted, 'boolean');

  if (result.accepted) {
    assert.strictEqual(tradeModule.findPick('SAS', 1), undefined, 'the pick is no longer owned by SAS once traded');
    const nowOwnedByLal = teamsModule.getTeamById('SAS').draftPicks.find(function (p) { return p.round === 1; });
    assert.strictEqual(nowOwnedByLal.currentOwnerId, 'LAL');
    // restore state for any later checks in this file
    nowOwnedByLal.currentOwnerId = 'SAS';
  }

  // Existing 3-argument evaluateTeamLeg calls (Phase 3 style) must still work unchanged.
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const anyPlayer = bosRoster[0];
  const backwardCompatLeg = evaluatorModule.evaluateTeamLeg('BOS', [anyPlayer.id], [anyPlayer.id]);
  assert.strictEqual(backwardCompatLeg.accepted, true, 'a player traded for themself with no pick args must still be an exact match');

  console.log('checkPickTrading: OK');
}

checkPickTrading();
```

(Insert before the final `console.log('All trade validations passed');`.)

- [ ] **Step 5: Run both validation suites, then commit**

Run: `node scripts/validate-trades.js` — all checks (including `checkPickTrading`) pass.
Run: `node scripts/validate-offseason.js` — confirm no regression from Task 6's `draftPickValue.js` change.

```bash
cd "C:\Users\cory\Desktop\nba"
git add tradeEvaluator.js trade.js scripts/validate-trades.js
git commit -m "feat: draft picks as tradeable trade assets, valued and moved alongside players"
```

---

### Task 8: `draft.js` — draft order respects traded pick ownership

**Files:**
- Modify: `draft.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `Team.draftPicks` (from `teams.js`, Task 1).
- Produces: `buildDraftOrder` now remaps each standings-based slot to whichever team currently owns that original team's pick — same return shape (`{firstRound, secondRound}`) as Batch A, so `seasonTransition.js`'s existing call site needs no changes.

- [ ] **Step 1: Add a remapping step to `buildDraftOrder` in `draft.js`**

```js
function remapForPickOwnership(order, round) {
  return order.map(function (originalTeamId) {
    const originalTeam = _DRAFT_DATA.teams.getTeamById(originalTeamId);
    const pick = originalTeam.draftPicks.find(function (p) { return p.round === round; });
    return pick ? pick.currentOwnerId : originalTeamId;
  });
}
```

Update the end of `buildDraftOrder` to apply it:

```js
function buildDraftOrder(bracket, rng) {
  const playoffTeamIds = new Set(getPlayoffFinishOrder(bracket));
  const lotteryTeams = _DRAFT_DATA.teams.TEAMS.filter(function (t) { return !playoffTeamIds.has(t.id); });

  const top4 = weightedDrawWithoutReplacement(lotteryTeams, lotteryWeight, 4, rng);
  const top4Ids = new Set(top4.map(function (t) { return t.id; }));
  const remainingLottery = lotteryTeams.filter(function (t) { return !top4Ids.has(t.id); })
    .sort(function (a, b) { return a.record.wins - b.record.wins; });

  const rawFirstRound = top4.map(function (t) { return t.id; })
    .concat(remainingLottery.map(function (t) { return t.id; }))
    .concat(getPlayoffFinishOrder(bracket));

  const rawSecondRound = _DRAFT_DATA.teams.TEAMS.slice()
    .sort(function (a, b) { return a.record.wins - b.record.wins; })
    .map(function (t) { return t.id; });

  return {
    firstRound: remapForPickOwnership(rawFirstRound, 1),
    secondRound: remapForPickOwnership(rawSecondRound, 2)
  };
}
```

- [ ] **Step 2: Update `module.exports` in `draft.js`**

Add `remapForPickOwnership: remapForPickOwnership` to the exported object.

- [ ] **Step 3: Add validation to `scripts/validate-offseason.js`**

```js
function checkDraftOrderRespectsTradedPicks() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));

  // Give SAS's 2027 first-round pick to LAL, then confirm whichever slot the
  // draft order would have given SAS instead goes to LAL.
  const sasPick = teamsModule.getTeamById('SAS').draftPicks.find(function (p) { return p.round === 1; });
  const originalOwner = sasPick.currentOwnerId;
  sasPick.currentOwnerId = 'LAL';

  const rawOrder = ['SAS', 'BOS', 'MIA']; // a fake raw order; only SAS's slot should remap
  const remapped = draftModule.remapForPickOwnership(rawOrder, 1);
  assert.deepStrictEqual(remapped, ['LAL', 'BOS', 'MIA'], 'SAS\'s slot should now belong to LAL, others unchanged');

  sasPick.currentOwnerId = originalOwner; // restore

  console.log('checkDraftOrderRespectsTradedPicks: OK');
}

checkDraftOrderRespectsTradedPicks();
```

- [ ] **Step 4: Run it, then commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add draft.js scripts/validate-offseason.js
git commit -m "feat: draft order remaps slots for traded pick ownership"
```

---

### Task 9: `seasonTransition.js` — `generateNewSeason`, the final offseason step

**Files:**
- Modify: `seasonTransition.js`
- Modify: `scripts/validate-offseason.js`

**Interfaces:**
- Consumes: `generateSeasonGames` (from `schedule.js`), `TEAMS` (from `teams.js`), `PLAYERS_2026` (from `players-2026.js`).
- Produces: `generateNewSeason(rng)` → returns a fresh `games` array in the same shape `script.js`'s `initSeason` already produces, and resets every team's record, every player's season stats, and renews each team's next-round-1/round-2 draft pick ownership back to themselves (this year's picks were just consumed by the draft; next year's slots open fresh, subject to being traded again before the next draft). Consumed by `script.js`'s "Advance to Next Season" handler (Task 11).

- [ ] **Step 1: Add to `seasonTransition.js`**

Update `_TRANSITION_DATA` and add above `module.exports`:

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

```js
function generateNewSeason(rng) {
  _TRANSITION_DATA.teams.TEAMS.forEach(function (t) {
    t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    // This year's picks were just used in the draft; next year's slots reset
    // to their original owner, ready to be traded again before the next draft.
    t.draftPicks = [
      { round: 1, originalTeamId: t.id, currentOwnerId: t.id },
      { round: 2, originalTeamId: t.id, currentOwnerId: t.id }
    ];
  });

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.seasonStats = undefined;
  });

  const games = _TRANSITION_DATA.schedule.generateSeasonGames(rng, _TRANSITION_DATA.teams.TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return games;
}
```

- [ ] **Step 2: Update `module.exports` in `seasonTransition.js`**

Add `generateNewSeason: generateNewSeason` to the exported object.

- [ ] **Step 3: Add validation to `scripts/validate-offseason.js`**

```js
function checkGenerateNewSeason() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const team = teamsModule.getTeamById('BOS');
  team.record = { wins: 55, losses: 27, pointsFor: 9000, pointsAgainst: 8700 };
  const player = leagueModule.getTeamRoster('BOS')[0];
  player.seasonStats = { gamesPlayed: 82, points: 2000 };

  const rng = makeRng(1000);
  const games = transitionModule.generateNewSeason(rng);

  assert.strictEqual(games.length, 1230, 'a new season should have exactly 1230 games');
  assert.strictEqual(team.record.wins, 0, 'records should reset for the new season');
  assert.strictEqual(player.seasonStats, undefined, 'season stats should clear for the new season');
  assert.strictEqual(teamsModule.getTeamById('BOS').draftPicks.length, 2, 'every team should have fresh draft picks after generating a new season');
  assert.strictEqual(teamsModule.getTeamById('BOS').draftPicks[0].currentOwnerId, 'BOS', 'a fresh pick is owned by its original team until traded again');

  console.log('checkGenerateNewSeason: OK');
}

checkGenerateNewSeason();
console.log('All offseason validations passed');
```

Remove the now-duplicated final `console.log('All offseason validations passed');` that previously followed the last Batch A check — keep only one, at the very end, after this new check.

- [ ] **Step 4: Run it, then commit**

Run: `node scripts/validate-offseason.js` — every check from Batch A and Batch B Tasks 2-9 passes.

```bash
cd "C:\Users\cory\Desktop\nba"
git add seasonTransition.js scripts/validate-offseason.js
git commit -m "feat: generate a fresh new season (records, stats, draft picks reset) to close the offseason loop"
```

---

### Task 10: `ui/freeAgency.js` — free agent list, offers, bidding UI

**Files:**
- Create: `ui/freeAgency.js`

**Interfaces:**
- Consumes: `getFreeAgents` (from `rosterMoves.js`), `startBidding`/`evaluateBiddingRound`/`finalizeBidding` (from `freeAgencyBidding.js`), `runFreeAgencySilently` (from `freeAgency.js`).
- Produces: `renderFreeAgency(container, userTeamId)` — registered into `script.js`'s `BUILT_VIEWS.freeagency` in Task 12.

- [ ] **Step 1: Write `ui/freeAgency.js`**

```js
function renderFreeAgency(container, userTeamId) {
  const signingLog = [];

  function draw() {
    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });

    let html = '<h2>Free Agency</h2>';
    html += '<button id="resolve-remaining-btn">Resolve Remaining Free Agents</button>';
    html += '<table><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Action</th></tr></thead><tbody>';
    pool.forEach(function (p) {
      html += '<tr><td>' + p.name + '</td><td>' + p.position + '</td><td>' + p.age + '</td><td>' + p.overall + '</td>' +
        '<td><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div id="bidding-panel"></div>';
    html += '<h3>Recent Signings</h3><ul id="signing-log">' + signingLog.slice(-15).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';

    container.innerHTML = html;

    document.getElementById('resolve-remaining-btn').addEventListener('click', function () {
      const rng = GameState.rng;
      const results = runFreeAgencySilently(rng);
      results.forEach(function (r) {
        signingLog.push(getTeamById(r.teamId).name + ' signed ' + getPlayerById(r.playerId).name + ' ($' + r.salary.toLocaleString() + ')');
      });
      draw();
    });

    container.querySelectorAll('button[data-offer-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderBiddingPanel(document.getElementById('bidding-panel'), btn.getAttribute('data-offer-id'), userTeamId, draw, signingLog);
      });
    });
  }

  draw();
}

function renderBiddingPanel(container, playerId, userTeamId, redrawParent, signingLog) {
  const player = getPlayerById(playerId);
  const state = startBidding(playerId, userTeamId, GameState.rng);

  function draw(lastResult) {
    let html = '<h3>Bidding for ' + player.name + '</h3>';
    html += '<p>Competing offers: ' + state.aiOffers.length + '</p>';
    if (lastResult) {
      html += '<p>' + (lastResult.userWinning ? 'Your offer is currently winning.' : 'A competing offer is ahead' + (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') + '.') + '</p>';
    }
    html += '<label>Salary: $<input type="number" id="bid-salary" value="5000000" step="100000"></label><br>';
    html += '<label>Years: <input type="number" id="bid-years" value="2" min="1" max="5"></label><br>';
    html += '<button id="submit-bid-btn">Submit Offer</button> ';
    html += '<button id="accept-bid-btn"' + (lastResult ? '' : ' disabled') + '>Sign Player</button> ';
    html += '<button id="withdraw-bid-btn">Withdraw</button>';
    container.innerHTML = html;

    document.getElementById('submit-bid-btn').addEventListener('click', function () {
      const salary = Number(document.getElementById('bid-salary').value);
      const years = Number(document.getElementById('bid-years').value);
      const result = evaluateBiddingRound(state, salary, years);
      draw(result);
    });
    document.getElementById('accept-bid-btn').addEventListener('click', function () {
      const outcome = finalizeBidding(state, true);
      if (outcome.signed) signingLog.push(getTeamById(outcome.teamId).name + ' signed ' + player.name);
      container.innerHTML = '';
      redrawParent();
    });
    document.getElementById('withdraw-bid-btn').addEventListener('click', function () {
      const outcome = finalizeBidding(state, false);
      if (outcome.signed) signingLog.push(getTeamById(outcome.teamId).name + ' signed ' + player.name + ' (you withdrew)');
      container.innerHTML = '';
      redrawParent();
    });
  }

  draw(null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFreeAgency: renderFreeAgency, renderBiddingPanel: renderBiddingPanel };
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/freeAgency.js
git commit -m "feat: free agency view with offer and bidding-war UI"
```

---

### Task 11: `ui/tradeCenter.js` — include picks in the trade builder

**Files:**
- Modify: `ui/tradeCenter.js`

**Interfaces:**
- Consumes: `findPick` (from `trade.js`), `estimateFuturePickValue` (from `draftPickValue.js`).
- Produces: same `renderTradeCenter(container, userTeamId)` signature; the internal `state` object gains `pickAssignments`, and each team's panel gets a pick-selection UI alongside its player table.

- [ ] **Step 1: Add `pickAssignments` to the trade builder's state and value panel in `ui/tradeCenter.js`**

In `renderTradeCenter`, update the `state` initializer:

```js
const state = {
  participants: [userTeamId],
  assignments: [], // { playerId, fromTeamId, toTeamId }
  pickAssignments: [] // { round, fromTeamId, toTeamId }
};
```

In `draw()`, after computing `outgoingSalary`/`incomingSalary` for each team panel, add pick value into the existing value totals and render a pick-selection block:

```js
const outgoingPickValue = state.pickAssignments
  .filter(function (pa) { return pa.fromTeamId === teamId; })
  .reduce(function (s, pa) { const pick = findPick(pa.fromTeamId, pa.round); return s + (pick ? estimateFuturePickValue(pa.round, getTeamById(pick.originalTeamId)) : 0); }, 0);
const incomingPickValue = state.pickAssignments
  .filter(function (pa) { return pa.toTeamId === teamId; })
  .reduce(function (s, pa) { const pick = findPick(pa.fromTeamId, pa.round); return s + (pick ? estimateFuturePickValue(pa.round, getTeamById(pick.originalTeamId)) : 0); }, 0);
```

Update the existing value line to include picks:

```js
html += '<p>Outgoing value: ' + (outgoingValue + outgoingPickValue).toFixed(1) + ' / Incoming value: ' + (incomingValue + incomingPickValue).toFixed(1) + '</p>';
```

Add a pick-selection block right after the player table for each team panel:

```js
html += '<p>Draft Picks:</p>';
[1, 2].forEach(function (round) {
  const pick = findPick(teamId, round);
  if (!pick) return; // already traded away earlier in this same proposal
  const assignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === teamId && pa.round === round; });
  html += '<label><input type="checkbox" data-pick-round="' + round + '" data-pick-from="' + teamId + '"' + (assignment ? ' checked' : '') + '> Round ' + round + ' pick</label> ';
  html += '<select data-pick-dest-round="' + round + '" data-pick-dest-from="' + teamId + '"' + (assignment ? '' : ' disabled') + '>';
  state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
    const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
    html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
  });
  html += '</select><br>';
});
```

- [ ] **Step 2: Wire the pick checkboxes/selects in `wireEvents()`**

Add alongside the existing player checkbox/select wiring:

```js
container.querySelectorAll('input[type="checkbox"][data-pick-round]').forEach(function (cb) {
  cb.addEventListener('change', function () {
    const round = Number(cb.getAttribute('data-pick-round'));
    const fromTeam = cb.getAttribute('data-pick-from');
    if (cb.checked) {
      const destSelect = container.querySelector('select[data-pick-dest-round="' + round + '"][data-pick-dest-from="' + fromTeam + '"]');
      const toTeam = destSelect.value || state.participants.filter(function (t) { return t !== fromTeam; })[0];
      state.pickAssignments.push({ round: round, fromTeamId: fromTeam, toTeamId: toTeam });
    } else {
      state.pickAssignments = state.pickAssignments.filter(function (pa) { return !(pa.fromTeamId === fromTeam && pa.round === round); });
    }
    draw();
  });
});

container.querySelectorAll('select[data-pick-dest-round]').forEach(function (sel) {
  sel.addEventListener('change', function () {
    const round = Number(sel.getAttribute('data-pick-dest-round'));
    const fromTeam = sel.getAttribute('data-pick-dest-from');
    const assignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === fromTeam && pa.round === round; });
    if (assignment) assignment.toTeamId = sel.value;
  });
});
```

- [ ] **Step 3: Update `handlePropose` to reset `pickAssignments` alongside `assignments` on acceptance**

In `handlePropose` (same file), change:

```js
if (result.accepted) {
  resultEl.innerHTML = '<p>Trade accepted and executed!</p>';
  state.assignments = [];
  state.pickAssignments = [];
  redraw();
  return;
}
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add ui/tradeCenter.js
git commit -m "feat: include draft picks in the trade builder"
```

---

### Task 12: Wire everything into `index.html`/`script.js` + full multi-season end-to-end verification

**Files:**
- Modify: `index.html`
- Modify: `script.js`

**Interfaces:**
- Consumes: every function from Tasks 1-11 plus Batch A.
- Produces: a complete, playable offseason loop — season → playoffs → draft → free agency → new season — reachable entirely from the UI.

- [ ] **Step 1: Add the new script tags to `index.html`**

Add after `ui/tradeCenter.js` and before `ui/draft.js`:

```html
<script src="freeAgency.js"></script>
<script src="freeAgencyBidding.js"></script>
```

Add after `ui/draft.js` and before `script.js`:

```html
<script src="ui/freeAgency.js"></script>
```

(`freeAgency.js` must load after `tradeEvaluator.js` and `rosterMoves.js`, both already earlier in the list; `freeAgencyBidding.js` must load after `freeAgency.js`.)

- [ ] **Step 2: Register the Free Agency view and add the "Advance to Next Season" flow in `script.js`**

Update `BUILT_VIEWS`:

```js
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) { renderDraftResults(container, GameState.lastDraftResults || []); }
};
```

Add an offseason-stage tracker and the advance handler:

```js
function isRegularSeasonAndPlayoffsComplete() {
  return GameState.season && GameState.season.games.every(function (g) { return g.played; })
    && GameState.playoffBracket && GameState.playoffBracket.finals.length > 0 && GameState.playoffBracket.finals[0].complete;
}

function handleAdvanceToOffseason() {
  const isFirstDraft = GameState.leagueYear === undefined;
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, isFirstDraft);
  GameState.lastDraftResults = result.draftResults;
  GameState.offseasonStage = 'draft';
  renderView('draft');
}

function handleAdvanceToNewSeason() {
  const games = generateNewSeason(GameState.rng);
  GameState.season = { games: games, currentDay: -1 };
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  renderView('dashboard');
}
```

In `renderView`, after the existing `renderSimControls(...)` call, add an offseason action button when appropriate:

```js
const simControlsEl = document.getElementById('sim-controls');
if (isRegularSeasonAndPlayoffsComplete() && !GameState.offseasonStage) {
  simControlsEl.innerHTML += '<button id="advance-offseason-btn">Advance to Offseason</button>';
  document.getElementById('advance-offseason-btn').addEventListener('click', handleAdvanceToOffseason);
} else if (GameState.offseasonStage === 'draft') {
  simControlsEl.innerHTML += '<button id="advance-to-fa-btn">Go to Free Agency</button>';
  document.getElementById('advance-to-fa-btn').addEventListener('click', function () { GameState.offseasonStage = 'freeagency'; renderView('freeagency'); });
} else if (GameState.offseasonStage === 'freeagency') {
  simControlsEl.innerHTML += '<button id="start-new-season-btn">Start New Season</button>';
  document.getElementById('start-new-season-btn').addEventListener('click', handleAdvanceToNewSeason);
}
```

- [ ] **Step 3: Run the full Node validation suite**

Run: `node scripts/validate-offseason.js` — every check from Batch A and Batch B passes.
Run: `node scripts/validate-trades.js`, `node scripts/validate-sim.js`, `node scripts/validate-data.js` — confirm zero regressions across all four phases.

- [ ] **Step 4: Manual browser verification — the full multi-season loop**

Using the `run` skill (or a local static server, as in every prior phase):
1. Select a team, sim to end of regular season, sim to end of playoffs (reusing Phase 2's controls) — confirm an "Advance to Offseason" button appears once both are done.
2. Click it — confirm the Draft Results view renders with real 2026 prospects and real teams, and a "Go to Free Agency" button appears.
3. Click it — confirm the Free Agency view lists real free agents (players whose contracts expired). Click "Make Offer" on one — confirm the bidding panel appears, submitting an offer shows whether you're winning, and both "Sign Player" and "Withdraw" resolve the player off the free agent list.
4. Click "Resolve Remaining Free Agents" — confirm the free agent list shrinks and the signing log fills in with real team/player/salary entries.
5. Click "Start New Season" — confirm the Dashboard now shows a fresh 0-0 record, the Schedule view shows a brand-new 82-game slate, and `GameState.season.games.length` is `1230` again.
6. Sim a few games of the new season via the existing controls — confirm no errors and records update normally, proving the new season is fully playable, not just generated.
7. Open Trade Center, add a second team, check one of your team's Round 1 pick checkboxes and assign it to the other team — confirm the value panel includes the pick's value and, on an accepted trade, `getTeamById('<yourTeam>').draftPicks` no longer lists that round as owned by you.
8. Confirm the browser console shows no errors throughout this entire walkthrough.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\cory\Desktop\nba"
git add index.html script.js
git commit -m "chore: wire Phase 4 Batch B into the app shell and verify the full offseason loop end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** free agency with silent AI-vs-AI resolution ✓ Task 4. Interactive bidding wars for user-pursued players ✓ Task 5. Player decision factors (money, contention, playing time, market, prestige; coach quality dropped) ✓ Task 2. Draft pick trading extending Phase 3's `trade.js` ✓ Tasks 6-8. New season generation closing the offseason loop ✓ Task 9. Full UI flow (draft → FA → new season) reachable from the app ✓ Tasks 10-12.
- **Placeholder scan:** no TBD/TODO. Task 6 is an intentional, explained exception to "don't modify existing tests" — the old `estimateFuturePickValue` signature didn't fit its real trade-time use case, so it's fixed here with the reasoning stated inline, not silently changed.
- **Type/interface consistency:** `evaluateTeamLeg`'s two new parameters default to 0, verified by Task 7's explicit backward-compatibility test (`checkPickTrading`'s trailing assertion) rather than just asserted in prose. `buildDraftOrder`'s return shape (`{firstRound, secondRound}`) is unchanged from Batch A, verified by Task 8 reusing the same shape. `generateNewSeason`'s returned `games` array uses the exact same per-game object shape as `script.js`'s existing `initSeason`, so `handleAdvanceToNewSeason` (Task 12) can assign it to `GameState.season.games` directly.
- **Node/browser dual-loading:** every modified or new pure-logic file follows the established `_XXX_DATA` conditional-require pattern. `freeAgency.js` requires `tradeEvaluator.js`/`rosterMoves.js`/`league.js`/`teams.js`/`data.js` — none of which require `freeAgency.js` back, so no circular-require risk. `freeAgencyBidding.js` requires `freeAgency.js` (one-directional) for the same reason.
