# Phase 7A — Play Modes & Automation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this project's established preference) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play modes (GM/Commissioner/Spectator), the 5 real automation toggles (auto free agency, auto draft, auto trade, auto cap, auto scout), a manual draft-pick UI, an AI trade-offer generator, expanded multi-season sim controls, a live event feed, and pause-on-event. Commissioner sandbox tools (edit/create/delete player, force trade, disable cap, expansion teams) are Phase 7B, a separate plan, since they're additive and mostly independent of this batch.

**Architecture:** New `autoGM.js` holds pure automation decision logic, entirely by calling the exact same evaluator functions already driving every AI team (`freeAgency.js`'s `runFreeAgencySilently`, `tradeEvaluator.js`'s `adjustedPlayerValue`/`needMultiplier`, `rosterMoves.js`'s `waivePlayer`, `scouting.js`'s `allocateScoutPoints`) — no separate "Auto GM personality" to design. The draft gets an additive stepwise session API in `draft.js` (mirroring the proven synchronous manual/automatic split `freeAgencyBidding.js` already uses for FA bidding — no Promises anywhere, matching this codebase's existing style) so a manual draft-pick UI can pause between AI-controlled picks without any async/await ripple through existing tests. `league.js`'s `onDayComplete` hook gains two additional (backward-compatible) callback arguments so `script.js` can drive the live feed and pause-on-event without new coupling into `injuries.js` or `league.js`'s internals beyond one call site.

**Tech Stack:** Same as every prior phase — vanilla JS, dual browser-global/Node-require pattern, Node `assert` validation, `mcp__Claude_Browser__*` for the final live walkthrough.

## Global Constraints

- No third-party dependencies; classic `<script>` tags only.
- Every new file follows the `var _XXX_DATA = (typeof require !== 'undefined') ? {...} : {...}` dual-module pattern.
- `docs/superpowers/specs/2026-08-01-phase-7-play-modes-automation-design.md` is the source of truth for the design. Two implementation-detail corrections made during planning, both strictly simpler than what the spec sketched while fully preserving its intent — noted inline in the relevant tasks:
  - The draft-pause mechanism uses a synchronous stepwise session object (like `freeAgencyBidding.js`), not `async`/`Promise`-based `runDraft`. Avoids rewriting every existing draft/offseason test's execution model for no behavioral benefit.
  - "Auto Free Agency" reuses the existing `runFreeAgencySilently` directly (it already treats every team, including the user's, identically) rather than a new bespoke `autoResolveFreeAgencyForTeam` function — the literal simplest form of "reuse the same AI."
  - The design's §5 aside that AI teams already trade with each other the same way `generateTradeOffer` will, so Spectator needs no extra work, isn't accurate — no AI-vs-AI trading exists anywhere in the game today. This plan scopes `generateTradeOffer` to the user's team only (GM/Commissioner mode); emergent AI-vs-AI trading is left as a future enhancement, not silently promised.
- `GameState.settings.pauseOn` and `GameState.settings.capDisabled` live inside the existing `settings` object specifically so `save.js` round-trips them for free (it already fully serializes/restores `gameState.settings` as one blob) — no `save.js` change needed for those two. `playMode`, `automation`, `feed`, and `draftSession` are new top-level `GameState` fields and do need explicit `save.js` additions (Task 7).

---

### Task 1: `trade.js` — `evaluateTrade` gains an `evaluateUserLeg` param

**Files:**
- Modify: `trade.js:46-61` (`evaluateTrade`), `trade.js:79-89` (`proposeTrade`)

**Interfaces:**
- Produces: `evaluateTrade(proposal, userTeamId, evaluateUserLeg)` — when `evaluateUserLeg` is falsy or omitted, behavior is identical to today (the user's leg is always `{ accepted: true, isUser: true }`). When `true`, the user's leg runs through `evaluateTeamLeg` exactly like any other participant's. `proposeTrade(proposal, userTeamId, evaluateUserLeg)` threads the same optional third param through.

- [ ] **Step 1: Add the param**

Change (`trade.js:46-61`):
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
```
to:
```js
// evaluateUserLeg: false (default) preserves today's behavior — the user's
// own leg of a trade they built by hand is never second-guessed by the AI.
// true is used by auto-generated proposals (autoGM.js's generateTradeOffer)
// where the user's team is being decided FOR by the same logic every AI
// team already uses, so its leg needs the same value/salary check as anyone
// else's.
function evaluateTrade(proposal, userTeamId, evaluateUserLeg) {
  const pickAssignments = proposal.pickAssignments || [];
  const legs = {};
  proposal.participants.forEach(function (teamId) {
    if (teamId === userTeamId && !evaluateUserLeg) {
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
```

Change (`trade.js:79-89`):
```js
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
```
to:
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

- [ ] **Step 2: Regression-check existing trade validators**

Run: `node scripts/validate-trades.js`
Expected: `All trade validations passed` (every existing caller omits the third param, so behavior for them is unchanged).

- [ ] **Step 3: Commit**

```bash
git add trade.js
git commit -m "feat: evaluateTrade/proposeTrade gain an evaluateUserLeg param"
```

---

### Task 2: `draft.js` — additive stepwise draft session (manual draft support)

**Files:**
- Modify: `draft.js` (add new exports after the existing `runDraft`, which stays untouched)

**Interfaces:**
- Consumes: `selectAIPick`, `executePick` (both already in this file)
- Produces: `startDraftSession(draftOrder, prospectPool)` → `{ picks, index, available, results }`; `currentPick(session)` → `{ teamId, round, pickNumber } | null`; `resolveCurrentPick(session, prospect)` → the pushed result object, advances `session.index`; `advanceDraftUntilUserTurn(session, userTeamId, autoDraftOn)` → mutates `session` in place, running AI picks until either the draft ends or it's the user's turn and `autoDraftOn` is false.

- [ ] **Step 1: Add the session API**

Insert after `runDraft` (`draft.js`, before the `module.exports` block):
```js
function startDraftSession(draftOrder, prospectPool) {
  const picks = draftOrder.firstRound.map(function (teamId, i) { return { teamId: teamId, round: 1, pickNumber: i + 1 }; })
    .concat(draftOrder.secondRound.map(function (teamId, i) { return { teamId: teamId, round: 2, pickNumber: 30 + i + 1 }; }));
  return { picks: picks, index: 0, available: prospectPool.slice(), results: [] };
}

function currentPick(session) {
  return session.index < session.picks.length ? session.picks[session.index] : null;
}

function resolveCurrentPick(session, prospect) {
  const pick = currentPick(session);
  if (!pick) return null;
  executePick(pick.teamId, prospect, pick.pickNumber);
  session.available = session.available.filter(function (p) { return p.id !== prospect.id; });
  const result = { teamId: pick.teamId, prospect: prospect, pickNumber: pick.pickNumber, round: pick.round };
  session.results.push(result);
  session.index += 1;
  return result;
}

// Advances through AI-controlled picks until either the draft ends or it's
// the user's turn to choose by hand — mirrors the manual/automatic split
// freeAgencyBidding.js already uses for FA bidding: no promises, driven step
// by step by the UI (call this again after resolveCurrentPick to continue).
function advanceDraftUntilUserTurn(session, userTeamId, autoDraftOn) {
  let pick = currentPick(session);
  while (pick && (autoDraftOn || pick.teamId !== userTeamId)) {
    resolveCurrentPick(session, selectAIPick(pick.teamId, session.available));
    pick = currentPick(session);
  }
  return session;
}
```

- [ ] **Step 2: Add the new exports**

Change the `module.exports` block to add the four new functions to the existing list (leave every existing entry untouched).

- [ ] **Step 3: Write and run a Node smoke test**

Run:
```bash
node -e "
const draftModule = require('./draft.js');
const prospectsModule = require('./draftProspects.js');
const teamsModule = require('./teams.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(700);

const order = { firstRound: teamsModule.TEAMS.map(function (t) { return t.id; }), secondRound: teamsModule.TEAMS.slice().reverse().map(function (t) { return t.id; }) };
const pool = prospectsModule.generateProspectClass(rng, 60);
const session = draftModule.startDraftSession(order, pool);

const userTeamId = order.firstRound[5];
draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
console.log('stopped at user pick:', draftModule.currentPick(session).teamId === userTeamId, 'results so far:', session.results.length);

draftModule.resolveCurrentPick(session, session.available[0]);
draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
console.log('resumed past user pick:', draftModule.currentPick(session) === null || draftModule.currentPick(session).teamId !== userTeamId || session.results.filter(function(r){return r.teamId===userTeamId;}).length > 1);

draftModule.advanceDraftUntilUserTurn(session, userTeamId, true);
console.log('full draft complete:', session.results.length === 60, 'no dupes:', new Set(session.results.map(function(r){return r.prospect.id;})).size === 60);
"
```
Expected: all three lines print `true` values (first stops exactly at the user's slot with 5 results so far since `order.firstRound[5]` is the 6th pick, second confirms resuming moves past it, third confirms `autoDraftOn: true` finishes the remaining draft with 60 unique results total).

- [ ] **Step 4: Run existing draft/offseason validators to confirm zero regression**

Run: `node scripts/validate-trades.js && node scripts/validate-offseason.js`
Expected: both print their `All ... validations passed` lines — `runDraft` itself is untouched, so `checkRunDraft` and `checkOffseasonThroughDraft` are unaffected.

- [ ] **Step 5: Commit**

```bash
git add draft.js
git commit -m "feat: additive stepwise draft session API for manual draft-pick UI"
```

---

### Task 3: `seasonTransition.js` — extract `runOffseasonPreDraft`

**Files:**
- Modify: `seasonTransition.js:33-65` (`runOffseasonThroughDraft`)

**Interfaces:**
- Produces: `runOffseasonPreDraft(rng)` → `{ retireeCount }`, running progression/retirement/contract-decrement/status-reset only (no draft). `runOffseasonThroughDraft(bracket, rng, upcomingDraftClass)` keeps its exact existing signature and behavior — internally now just calls `runOffseasonPreDraft` followed by the same draft block as before. This is a pure internal extraction so `script.js`'s manual-draft path (Task 9) can run the pre-draft steps once and then drive the draft itself via Task 2's session API, without duplicating the retirement/contract logic.

- [ ] **Step 1: Extract the function**

Change (`seasonTransition.js:33-65`):
```js
function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass) {
  // 1. Progression — mutate in place, then filter out retirees.
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

  // 2. Contracts.
  decrementContracts();

  // 3. Reset per-season status for everyone still in the league.
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  // 4. Draft. The prospect pool is generated by the caller ahead of time (real
  // 2026 class for the first draft, or the class generateNewSeason produced
  // at the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: retirees.length, draftResults: draftResults };
}
```
to:
```js
// Progression, retirement, contract expiration, and per-season status reset —
// everything the offseason needs BEFORE the draft. Split out from
// runOffseasonThroughDraft (which still calls this internally, so its own
// signature/behavior is unchanged) so the manual-draft path can run these
// steps once and then drive the draft itself via draft.js's session API,
// instead of duplicating this logic.
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

- [ ] **Step 2: Add `runOffseasonPreDraft` to `module.exports`**

Add `runOffseasonPreDraft: runOffseasonPreDraft,` to the existing `module.exports` object in `seasonTransition.js`.

- [ ] **Step 3: Regression-check**

Run: `node scripts/validate-offseason.js`
Expected: `All offseason validations passed` — `runOffseasonThroughDraft`'s public contract is unchanged.

- [ ] **Step 4: Commit**

```bash
git add seasonTransition.js
git commit -m "refactor: extract runOffseasonPreDraft from runOffseasonThroughDraft"
```

---

### Task 4: `autoGM.js` — `autoEnforceRosterSize` + `autoAllocateScoutPoints`

**Files:**
- Create: `autoGM.js`

**Interfaces:**
- Consumes: `league.js`'s `getTeamRoster`; `tradeEvaluator.js`'s `adjustedPlayerValue`; `rosterMoves.js`'s `waivePlayer`; `scouting.js`'s `allocateScoutPoints`
- Produces: `autoEnforceRosterSize(team)` → array of waived player ids; `autoAllocateScoutPoints(scoutingState, ownRosterIds, watchlistedProspectIds, watchlistedOpponentIds)` → mutates `scoutingState` in place

- [ ] **Step 1: Write `autoGM.js`**

```js
var _AUTOGM_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      tradeEvaluator: require('./tradeEvaluator.js'),
      rosterMoves: require('./rosterMoves.js'),
      scouting: require('./scouting.js'),
      trade: require('./trade.js')
    }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, needMultiplier: needMultiplier },
      rosterMoves: { waivePlayer: waivePlayer },
      scouting: { allocateScoutPoints: allocateScoutPoints },
      trade: { validateRosterSizes: validateRosterSizes, evaluateTrade: evaluateTrade }
    };

// The only numeric roster constraint the game enforces today that can leave
// a team stuck with no existing resolution path (rosterMoves.js's own 12-man
// floor already blocks waiving below it; free agency's own >=15 check already
// blocks new AI signings past it — but nothing stops a MANUAL user signing or
// a draft addition from pushing past 15). Waives the lowest adjustedPlayerValue
// player, repeatedly, until back at 15 or waivePlayer itself refuses (roster
// at the 12-man floor).
function autoEnforceRosterSize(team) {
  const waived = [];
  let roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  while (roster.length > 15) {
    const worst = roster.slice().sort(function (a, b) {
      return _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(a, team) - _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(b, team);
    })[0];
    const result = _AUTOGM_DATA.rosterMoves.waivePlayer(worst.id);
    if (!result.success) break;
    waived.push(worst.id);
    roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  }
  return waived;
}

// Spends a weekly scouting point rollover automatically: own roster always
// (confidence there matters regardless of watchlisting), plus any prospect or
// opponent the user has explicitly watchlisted — lowest-confidence targets
// first, split evenly across whatever remains available each pass.
function autoAllocateScoutPoints(scoutingState, ownRosterIds, watchlistedProspectIds, watchlistedOpponentIds) {
  if (scoutingState.pointsAvailable <= 0) return;
  const targetIds = Array.from(new Set(ownRosterIds.concat(watchlistedProspectIds).concat(watchlistedOpponentIds)))
    .sort(function (a, b) {
      const ca = (scoutingState.targets[a] && scoutingState.targets[a].confidence) || 0;
      const cb = (scoutingState.targets[b] && scoutingState.targets[b].confidence) || 0;
      return ca - cb;
    });
  if (targetIds.length === 0) return;
  const perTarget = Math.max(10, Math.floor(scoutingState.pointsAvailable / targetIds.length));
  targetIds.forEach(function (id) {
    if (scoutingState.pointsAvailable <= 0) return;
    _AUTOGM_DATA.scouting.allocateScoutPoints(scoutingState, id, Math.min(perTarget, scoutingState.pointsAvailable));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    autoEnforceRosterSize: autoEnforceRosterSize,
    autoAllocateScoutPoints: autoAllocateScoutPoints
  };
}
```

- [ ] **Step 2: Node smoke test**

Run:
```bash
node -e "
const autoGM = require('./autoGM.js');
const league = require('./league.js');
const teamsModule = require('./teams.js');
const playersModule = require('./players-2026.js');

const team = teamsModule.TEAMS[0];
const roster = league.getTeamRoster(team.id);
console.log('starting roster size:', roster.length);
for (let i = 0; i < 3; i++) {
  playersModule.PLAYERS_2026.push({
    id: 'test-overflow-' + i, name: 'Overflow Guy ' + i, teamId: team.id, position: 'SF', age: 30,
    overall: 40, potential: 40, jerseyNumber: 90 + i,
    contract: { salary: 1500000, yearsRemaining: 1, playerOption: false, teamOption: false },
    status: { fatigue: 0, injury: null, morale: 50 },
    attributes: {}, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {}
  });
}
console.log('overflowed roster size:', league.getTeamRoster(team.id).length);
const waived = autoGM.autoEnforceRosterSize(team);
console.log('waived count:', waived.length, 'final roster size:', league.getTeamRoster(team.id).length);
"
```
Expected: overflowed size is `roster.length + 3`, waived count brings the final roster size back down to `15`.

- [ ] **Step 3: Commit**

```bash
git add autoGM.js
git commit -m "feat: autoGM.js roster-size enforcement + auto scout allocation"
```

---

### Task 5: `autoGM.js` — `generateTradeOffer`

**Files:**
- Modify: `autoGM.js`

**Interfaces:**
- Consumes: `tradeEvaluator.js`'s `needMultiplier`/`adjustedPlayerValue`, `trade.js`'s `validateRosterSizes`/`evaluateTrade` (with Task 1's `evaluateUserLeg`)
- Produces: `generateTradeOffer(team, rng)` → `{ proposal, evaluation } | null`. Scoped to the user's team for this batch (see Global Constraints) — `team` is always `GameState.userTeamId`'s team when called from the UI tasks below, but the function itself doesn't assume that, so it's independently testable.

- [ ] **Step 1: Add the function**

Insert into `autoGM.js`, before `module.exports`:
```js
// Two-team, player-for-player only (no draft picks) — keeps the search
// tractable. Finds a surplus piece on `team` (a position where it's deep
// relative to need) and tries every other team as a partner in rng-shuffled
// order, looking for a return player at a position where `team` is thin and
// whose salary clears the same salaryOk band tradeEvaluator.js already uses
// for every other trade in the game. Returns the first mutually-accepted
// match, or null if none exists this call.
function generateTradeOffer(team, rng) {
  const roster = _AUTOGM_DATA.league.getTeamRoster(team.id);
  if (roster.length <= 12) return null;

  let candidate = null;
  let candidateSurplus = -Infinity;
  roster.forEach(function (p) {
    const need = _AUTOGM_DATA.tradeEvaluator.needMultiplier(p.position, team);
    if (need > 0.95) return; // not a surplus position
    const surplus = (1 - need) - _AUTOGM_DATA.tradeEvaluator.adjustedPlayerValue(p, team) / 200;
    if (surplus > candidateSurplus) { candidate = p; candidateSurplus = surplus; }
  });
  if (!candidate) return null;

  const partners = _AUTOGM_DATA.teams.TEAMS.filter(function (t) { return t.id !== team.id; }).slice();
  for (let i = partners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = partners[i]; partners[i] = partners[j]; partners[j] = tmp;
  }

  for (let pi = 0; pi < partners.length; pi++) {
    const partner = partners[pi];
    const partnerRoster = _AUTOGM_DATA.league.getTeamRoster(partner.id);
    const outgoingSalary = candidate.contract.salary;
    for (let ri = 0; ri < partnerRoster.length; ri++) {
      const returnPlayer = partnerRoster[ri];
      if (_AUTOGM_DATA.tradeEvaluator.needMultiplier(returnPlayer.position, team) < 1.15) continue;
      const salaryIncrease = returnPlayer.contract.salary - outgoingSalary;
      if (salaryIncrease > outgoingSalary * 0.25 + 2000000) continue;

      const proposal = {
        participants: [team.id, partner.id],
        assignments: [
          { playerId: candidate.id, fromTeamId: team.id, toTeamId: partner.id },
          { playerId: returnPlayer.id, fromTeamId: partner.id, toTeamId: team.id }
        ],
        pickAssignments: []
      };
      if (_AUTOGM_DATA.trade.validateRosterSizes(proposal).length > 0) continue;
      const evaluation = _AUTOGM_DATA.trade.evaluateTrade(proposal, team.id, true);
      if (evaluation.accepted) return { proposal: proposal, evaluation: evaluation };
    }
  }
  return null;
}
```

- [ ] **Step 2: Add to `module.exports`**

Add `generateTradeOffer: generateTradeOffer,` to `autoGM.js`'s existing `module.exports`.

- [ ] **Step 3: Node smoke test**

Run:
```bash
node -e "
const autoGM = require('./autoGM.js');
const teamsModule = require('./teams.js');
const { makeRng } = require('./rng.js');
const rng = makeRng(800);

let found = 0;
let attempts = 0;
for (let i = 0; i < teamsModule.TEAMS.length && found === 0; i++) {
  attempts++;
  const offer = autoGM.generateTradeOffer(teamsModule.TEAMS[i], rng);
  if (offer) {
    found++;
    console.log('generated a trade:', offer.proposal.assignments.map(function(a){return a.playerId + ': ' + a.fromTeamId + ' -> ' + a.toTeamId;}));
    console.log('both legs accepted:', offer.evaluation.accepted);
  }
}
console.log('checked', attempts, 'teams, found a valid offer:', found > 0);
"
```
Expected: `both legs accepted: true` whenever an offer is found, and across 30 real rosters at least one team should produce a match (`found > 0`) — if this prints `false`, loosen the `need > 0.95` / `needMultiplier < 1.15` thresholds slightly and re-run before proceeding.

- [ ] **Step 4: Commit**

```bash
git add autoGM.js
git commit -m "feat: autoGM.js trade-offer generator"
```

---

### Task 6: `league.js` — `onDayComplete` gains `todaysGames`/`newInjuries`

**Files:**
- Modify: `league.js:79-122` (`simulateDate`)

**Interfaces:**
- Produces: `onDayComplete(dayIndex, todaysGames, newInjuries)` — existing callers that only read `dayIndex` (`tickScoutingForDay`) are unaffected since JS silently ignores extra call arguments. `todaysGames` is the same array `simulateDate` already builds internally. `newInjuries` is a new array of `{ playerId, teamId, severity }`, one entry per player who transitioned from healthy to injured that day.

- [ ] **Step 1: Track new injuries and pass both through**

Change (`league.js:79-122`), the two touched spots only:
```js
function simulateDate(season, dayIndex, settings, rng, onDayComplete) {
  const deps = _simDeps();
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
```
to:
```js
function simulateDate(season, dayIndex, settings, rng, onDayComplete) {
  const deps = _simDeps();
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
  const newInjuries = [];
```

Change:
```js
    [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
      deps.injuries.decrementInjuriesForTeamGame(teamId);
      getTeamRoster(teamId).forEach(function (p) { deps.injuries.rollInjury(p, rng); });
      playingTeamIds[teamId] = true;
    });
```
to:
```js
    [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
      deps.injuries.decrementInjuriesForTeamGame(teamId);
      getTeamRoster(teamId).forEach(function (p) {
        const wasInjured = !!p.status.injury;
        deps.injuries.rollInjury(p, rng);
        if (!wasInjured && p.status.injury) {
          newInjuries.push({ playerId: p.id, teamId: teamId, severity: p.status.injury.severity });
        }
      });
      playingTeamIds[teamId] = true;
    });
```

Change:
```js
  if (onDayComplete) onDayComplete(dayIndex);
  return todaysGames;
```
to:
```js
  if (onDayComplete) onDayComplete(dayIndex, todaysGames, newInjuries);
  return todaysGames;
```

- [ ] **Step 2: Regression-check**

Run: `node scripts/validate-sim.js`
Expected: `All sim validations passed`.

- [ ] **Step 3: Commit**

```bash
git add league.js
git commit -m "feat: simulateDate reports todaysGames/newInjuries to onDayComplete"
```

---

### Task 7: `save.js` — persist `playMode`/`automation`/`feed`/`draftSession`

**Files:**
- Modify: `save.js:67-85` (`serializeGameState`), `save.js:87-127` (`applySavedState`)

**Interfaces:**
- Produces: save payloads now round-trip `GameState.playMode`, `GameState.automation`, `GameState.feed`, and `GameState.draftSession` (all new fields introduced in Task 9). `GameState.settings.pauseOn`/`.capDisabled` already round-trip for free via the existing `settings` blob.

- [ ] **Step 1: Add the fields to `serializeGameState`**

In the object literal returned by `serializeGameState` (`save.js:67-84`), add after `settings: gameState.settings,`:
```js
    playMode: gameState.playMode,
    automation: gameState.automation,
    feed: gameState.feed || [],
    draftSession: gameState.draftSession || null,
```

- [ ] **Step 2: Restore the fields in `applySavedState`**

In `applySavedState` (`save.js:87-127`), add after `gameState.settings = payload.settings;`:
```js
  gameState.playMode = payload.playMode || 'gm';
  gameState.automation = payload.automation || { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false };
  gameState.feed = payload.feed || [];
  gameState.draftSession = payload.draftSession || null;
```

- [ ] **Step 3: Add a round-trip check to the save validator**

Add to `scripts/validate-save.js` (new check function, called alongside the existing ones — read the file first to match its exact `require(path.join(...))` / assertion style):
```js
function checkPhase7FieldsRoundTrip() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gameState = {
    userTeamId: 'BOS', currentView: 'dashboard', leagueYear: 2026, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: { madePlayoffs: true, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: true }, capDisabled: false },
    playMode: 'commissioner',
    automation: { autoFreeAgency: true, autoDraft: false, autoTrade: true, autoCap: false, autoScout: true },
    feed: [{ day: 5, leagueYear: 2026, text: 'Test entry' }],
    draftSession: null,
    season: null, playoffBracket: null, upcomingDraftClass: [], lastDraftResults: [], scouting: { lastRolloverWeek: -1, pointsAvailable: 0, targets: {} },
    rng: null
  };
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'Round Trip Test')));
  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.strictEqual(restored.playMode, 'commissioner', 'playMode should round-trip');
  assert.deepStrictEqual(restored.automation, gameState.automation, 'automation toggles should round-trip');
  assert.strictEqual(restored.feed.length, 1, 'feed should round-trip');
  assert.strictEqual(restored.settings.pauseOn.keyInjury, true, 'settings.pauseOn should round-trip as part of the existing settings blob');
  console.log('checkPhase7FieldsRoundTrip: OK');
}

checkPhase7FieldsRoundTrip();
```

- [ ] **Step 4: Run the save validator**

Run: `node scripts/validate-save.js`
Expected: all checks print `OK`, including the new one, ending with the file's existing final "all passed" line.

- [ ] **Step 5: Commit**

```bash
git add save.js scripts/validate-save.js
git commit -m "feat: persist playMode/automation/feed/draftSession in saves"
```

---

### Task 8: `scripts/validate-automation.js` — consolidated Node validator suite

**Files:**
- Create: `scripts/validate-automation.js`

**Interfaces:**
- Consumes: everything built in Tasks 1-6, via `require`.

- [ ] **Step 1: Write the validator**

```js
const assert = require('assert');
const path = require('path');

const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const draftModule = require(path.join(__dirname, '..', 'draft.js'));
const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
const seasonTransitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const autoGMModule = require(path.join(__dirname, '..', 'autoGM.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEvaluateUserLeg() {
  const teamA = teamsModule.TEAMS[0];
  const teamB = teamsModule.TEAMS[1];
  const rosterA = leagueModule.getTeamRoster(teamA.id);
  const rosterB = leagueModule.getTeamRoster(teamB.id);
  const best = rosterB.slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(b, teamB) - tradeEvaluatorModule.adjustedPlayerValue(a, teamB); })[0];
  const worst = rosterA.slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(a, teamA) - tradeEvaluatorModule.adjustedPlayerValue(b, teamA); })[0];
  const proposal = {
    participants: [teamA.id, teamB.id],
    assignments: [
      { playerId: worst.id, fromTeamId: teamA.id, toTeamId: teamB.id },
      { playerId: best.id, fromTeamId: teamB.id, toTeamId: teamA.id }
    ],
    pickAssignments: []
  };
  const defaultResult = tradeModule.evaluateTrade(proposal, teamA.id);
  const uncheckedResult = tradeModule.evaluateTrade(proposal, teamA.id, false);
  const checkedResult = tradeModule.evaluateTrade(proposal, teamA.id, true);
  assert.strictEqual(defaultResult.legs[teamA.id].isUser, true, 'omitting the param preserves the isUser bypass');
  assert.strictEqual(uncheckedResult.legs[teamA.id].isUser, true, 'explicit false preserves the isUser bypass');
  assert.strictEqual(checkedResult.legs[teamA.id].isUser, undefined, 'evaluateUserLeg true runs the user leg through evaluateTeamLeg like any other team');
  console.log('checkEvaluateUserLeg: OK');
}

checkEvaluateUserLeg();

function checkDraftSession() {
  const rng = makeRng(900);
  const order = { firstRound: teamsModule.TEAMS.map(function (t) { return t.id; }), secondRound: teamsModule.TEAMS.slice().reverse().map(function (t) { return t.id; }) };
  const pool = prospectsModule.generateProspectClass(rng, 60);
  const session = draftModule.startDraftSession(order, pool);
  const userTeamId = order.firstRound[10];

  draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
  assert.strictEqual(draftModule.currentPick(session).teamId, userTeamId, 'should stop exactly at the user team\'s pick');
  assert.strictEqual(session.results.length, 10, 'should have resolved the 10 picks before the user\'s slot');

  draftModule.resolveCurrentPick(session, session.available[0]);
  draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
  assert.ok(draftModule.currentPick(session) === null || draftModule.currentPick(session).teamId === userTeamId, 'next stop (if any) should again be the user\'s next slot');

  draftModule.advanceDraftUntilUserTurn(session, userTeamId, true);
  assert.strictEqual(session.results.length, 60, 'a full draft should still produce 60 picks total');
  assert.strictEqual(new Set(session.results.map(function (r) { return r.prospect.id; })).size, 60, 'no prospect drafted twice');
  console.log('checkDraftSession: OK');
}

checkDraftSession();

function checkOffseasonPreDraftExtraction() {
  const rng = makeRng(950);
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const bracket = playoffsModule.generateBracket();
  let g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

  const pre = seasonTransitionModule.runOffseasonPreDraft(rng);
  assert.ok(typeof pre.retireeCount === 'number', 'runOffseasonPreDraft should report a retiree count');

  const pool = prospectsModule.generateProspectClass(rng, 60);
  const order = draftModule.buildDraftOrder(bracket, rng);
  const results = draftModule.runDraft(order, pool);
  assert.strictEqual(results.length, 60, 'draft after a manually-run pre-draft step should still produce 60 picks');
  console.log('checkOffseasonPreDraftExtraction: OK');
}

checkOffseasonPreDraftExtraction();

function checkAutoEnforceRosterSize() {
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
  const team = teamsModule.TEAMS[2];
  const before = leagueModule.getTeamRoster(team.id).length;
  for (let i = 0; i < 3; i++) {
    playersModule.PLAYERS_2026.push({
      id: 'validate-automation-overflow-' + i, name: 'Overflow Guy ' + i, teamId: team.id, position: 'SF', age: 30,
      overall: 40, potential: 40, jerseyNumber: 90 + i,
      contract: { salary: 1500000, yearsRemaining: 1, playerOption: false, teamOption: false },
      status: { fatigue: 0, injury: null, morale: 50 },
      attributes: {}, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {}
    });
  }
  assert.strictEqual(leagueModule.getTeamRoster(team.id).length, before + 3, 'roster should be overflowed before enforcement');
  const waived = autoGMModule.autoEnforceRosterSize(team);
  assert.ok(waived.length > 0, 'should have waived at least one player');
  assert.ok(leagueModule.getTeamRoster(team.id).length <= 15, 'roster should be back at or under 15 after enforcement');
  console.log('checkAutoEnforceRosterSize: OK');
}

checkAutoEnforceRosterSize();

function checkAutoAllocateScoutPoints() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const state = scoutingModule.initScoutingState();
  state.pointsAvailable = 100;
  const ownRosterIds = leagueModule.getTeamRoster(teamsModule.TEAMS[3].id).map(function (p) { return p.id; });
  autoGMModule.autoAllocateScoutPoints(state, ownRosterIds, [], []);
  assert.ok(state.pointsAvailable < 100, 'points should have been spent');
  const anySpent = ownRosterIds.some(function (id) { return state.targets[id] && state.targets[id].confidence > 0; });
  assert.ok(anySpent, 'at least one own-roster player should have gained confidence');
  console.log('checkAutoAllocateScoutPoints: OK');
}

checkAutoAllocateScoutPoints();

function checkGenerateTradeOffer() {
  const rng = makeRng(1000);
  let foundValid = false;
  for (let i = 0; i < teamsModule.TEAMS.length && !foundValid; i++) {
    const offer = autoGMModule.generateTradeOffer(teamsModule.TEAMS[i], rng);
    if (offer) {
      assert.strictEqual(offer.evaluation.accepted, true, 'a returned offer must have both legs accepted');
      assert.strictEqual(offer.proposal.assignments.length, 2, 'generator produces exactly a 1-for-1 swap');
      foundValid = true;
    }
  }
  assert.ok(foundValid, 'at least one of the 30 real rosters should produce a valid generated trade offer');
  console.log('checkGenerateTradeOffer: OK');
}

checkGenerateTradeOffer();

function checkSimulateDatePayload() {
  const scheduleModule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(1100);
  const games = scheduleModule.generateSeasonGames(rng, teamsModule.TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  let seenTodaysGames = null;
  let seenNewInjuries = null;
  leagueModule.simulateDate(season, 0, { simEngine: 'boxscore' }, rng, function (dayIndex, todaysGames, newInjuries) {
    seenTodaysGames = todaysGames;
    seenNewInjuries = newInjuries;
  });
  assert.ok(Array.isArray(seenTodaysGames), 'onDayComplete should receive the games played that day');
  assert.ok(Array.isArray(seenNewInjuries), 'onDayComplete should receive a (possibly empty) newInjuries array');
  console.log('checkSimulateDatePayload: OK');
}

checkSimulateDatePayload();

console.log('All automation validations passed');
```

- [ ] **Step 2: Run it**

Run: `node scripts/validate-automation.js`
Expected: every `check...: OK` line, ending with `All automation validations passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-automation.js
git commit -m "test: Phase 7A automation core validation suite"
```

---

### Task 9: `script.js` — GameState fields, mode switching, draft wiring, day-complete composition

**Files:**
- Modify: `script.js` (multiple sections — see steps)

**Interfaces:**
- Consumes: Tasks 1-8's new functions; `renderTeamSelect`'s new signature (Task 12); `currentWeek` from `scouting.js`
- Produces: `GameState.playMode`, `GameState.automation`, `GameState.feed`, `GameState.draftSession`, `GameState.tradeOffers`, `GameState.pauseRequested`; `switchPlayMode(newMode, teamId)`; `spectateLeague()`; `handleUserDraftPick(prospectId)`; `handleDayComplete(dayIndex, todaysGames, newInjuries)` — the new single callback every sim entry point passes instead of `tickScoutingForDay` directly.

- [ ] **Step 1: Extend `GameState`**

Change:
```js
const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
  season: null,
  playoffBracket: null,
  settings: { simEngine: 'boxscore', simSpeed: 'normal' }
};
```
to:
```js
const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
  season: null,
  playoffBracket: null,
  playMode: 'gm', // 'gm' | 'commissioner' | 'spectator'
  automation: { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false },
  feed: [],
  draftSession: null,
  tradeOffers: [],
  pauseRequested: false,
  settings: {
    simEngine: 'boxscore', simSpeed: 'normal',
    pauseOn: { madePlayoffs: false, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: false },
    capDisabled: false
  }
};

function pushToFeed(text) {
  GameState.feed.push({ day: GameState.season ? GameState.season.currentDay : null, leagueYear: GameState.leagueYear || 2026, text: text });
  if (GameState.feed.length > 200) GameState.feed.shift();
}
```

- [ ] **Step 2: Update `tickScoutingForDay` to also drive `autoScout`**

Change the end of the existing `tickScoutingForDay` function — after its final line (`tickPassiveScouting(GameState.scouting, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft);`), add:
```js
  if (GameState.automation.autoScout) {
    autoAllocateScoutPoints(GameState.scouting, ownRosterIds, prospectIds.filter(function (id) { return GameState.scouting.targets[id] && GameState.scouting.targets[id].watchlisted; }), playedOpponentIds.filter(function (id) { return GameState.scouting.targets[id] && GameState.scouting.targets[id].watchlisted; }));
  }
```

- [ ] **Step 3: Add feed/pause-on-event/weekly-trade composition**

Insert a new function right after `tickScoutingForDay`:
```js
function pushGameResultsToFeed(dayIndex, todaysGames) {
  todaysGames.forEach(function (g) {
    if (!g.played) return;
    const isUserGame = g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId;
    if (GameState.playMode !== 'spectator' && !isUserGame) return;
    const home = getTeamById(g.homeTeamId);
    const away = getTeamById(g.awayTeamId);
    pushToFeed(away.name + ' ' + g.awayScore + ', ' + home.name + ' ' + g.homeScore);
  });
}

function pushInjuriesToFeed(newInjuries) {
  newInjuries.forEach(function (inj) {
    const player = getPlayerById(inj.playerId);
    const isUserPlayer = inj.teamId === GameState.userTeamId;
    if (GameState.playMode !== 'spectator' && !isUserPlayer && player.overall < 80) return;
    pushToFeed(player.name + ' (' + getTeamById(inj.teamId).name + ') injured: ' + inj.severity);
    if (isUserPlayer && player.overall >= 80 && GameState.settings.pauseOn.keyInjury) {
      GameState.pauseRequested = true;
    }
  });
}

// Weekly (not daily) trade-offer generation for the user's team only — see
// the plan's Global Constraints for why AI-vs-AI trading isn't in this batch.
function runWeeklyTradeGeneration(dayIndex) {
  if (GameState.playMode === 'spectator' || !GameState.userTeamId) return;
  const week = currentWeek(dayIndex);
  if (GameState.lastTradeGenWeek === week) return;
  GameState.lastTradeGenWeek = week;
  const team = getTeamById(GameState.userTeamId);
  const offer = generateTradeOffer(team, GameState.rng);
  if (!offer) return;
  if (GameState.automation.autoTrade) {
    executeTrade(offer.proposal);
    const partnerId = offer.proposal.participants.find(function (id) { return id !== team.id; });
    pushToFeed('Auto-traded with ' + getTeamById(partnerId).name);
  } else {
    GameState.tradeOffers.push(offer);
    if (GameState.settings.pauseOn.tradeOfferReceived) GameState.pauseRequested = true;
  }
}

function handleDayComplete(dayIndex, todaysGames, newInjuries) {
  tickScoutingForDay(dayIndex);
  pushGameResultsToFeed(dayIndex, todaysGames || []);
  pushInjuriesToFeed(newInjuries || []);
  runWeeklyTradeGeneration(dayIndex);
}
```

- [ ] **Step 4: Mode switching**

Insert after the `GameState`/feed helpers:
```js
function switchPlayMode(newMode, teamId) {
  if (newMode === 'spectator') {
    Object.keys(GameState.automation).forEach(function (k) { GameState.automation[k] = true; });
  } else if (!GameState.userTeamId && teamId) {
    GameState.userTeamId = teamId;
  }
  GameState.playMode = newMode;
  renderView(GameState.currentView);
}

function spectateLeague() {
  GameState.playMode = 'spectator';
  Object.keys(GameState.automation).forEach(function (k) { GameState.automation[k] = true; });
  // Purely cosmetic "camera" team for the feed/dashboard/standings to default
  // to — has zero gameplay effect, so Math.random() here (rather than the
  // seeded rng, which doesn't exist until initSeason() below creates it)
  // doesn't threaten save/load's exact-resume guarantee.
  GameState.userTeamId = TEAMS[Math.floor(Math.random() * TEAMS.length)].id;
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}
```

- [ ] **Step 5: Update `selectTeam` to accept a play mode**

Change:
```js
function selectTeam(teamId) {
  GameState.userTeamId = teamId;
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}
```
to:
```js
function selectTeam(teamId, playMode) {
  GameState.userTeamId = teamId;
  GameState.playMode = playMode || 'gm';
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}
```

- [ ] **Step 6: Split `handleAdvanceToOffseason` for manual vs. auto draft**

Change:
```js
function handleAdvanceToOffseason() {
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
  GameState.lastDraftResults = result.draftResults;
  GameState.offseasonStage = 'draft';
  renderView('draft');
  autosave(GameState);
}
```
to:
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

- [ ] **Step 7: Update `BUILT_VIEWS.draft` to show the picker mid-draft; add `BUILT_VIEWS.feed`**

Change:
```js
  draft: function (container) { renderDraftResults(container, GameState.lastDraftResults || []); },
  scouting: renderScouting,
  saveload: renderSaveLoad
};
```
to:
```js
  draft: function (container) {
    if (GameState.draftSession && currentPick(GameState.draftSession)) {
      renderDraftPicker(container, GameState.draftSession, GameState.userTeamId, handleUserDraftPick);
    } else {
      renderDraftResults(container, GameState.lastDraftResults || []);
    }
  },
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed
};
```

- [ ] **Step 8: Auto-resolve free agency when entering the FA stage with the toggle on**

In `renderView`, change:
```js
  } else if (GameState.offseasonStage === 'draft') {
    simControlsEl.innerHTML += '<button id="advance-to-fa-btn">Go to Free Agency</button>';
    document.getElementById('advance-to-fa-btn').addEventListener('click', function () { GameState.offseasonStage = 'freeagency'; renderView('freeagency'); autosave(GameState); });
```
to:
```js
  } else if (GameState.offseasonStage === 'draft') {
    simControlsEl.innerHTML += '<button id="advance-to-fa-btn">Go to Free Agency</button>';
    document.getElementById('advance-to-fa-btn').addEventListener('click', function () {
      GameState.offseasonStage = 'freeagency';
      if (GameState.playMode === 'spectator' || GameState.automation.autoFreeAgency) {
        runFreeAgencySilently(GameState.rng);
        autoEnforceRosterSize(getTeamById(GameState.userTeamId));
      }
      renderView('freeagency');
      autosave(GameState);
    });
```

- [ ] **Step 9: Wire the Spectate League button and mode-aware team select**

Change `init`:
```js
function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam, loadGame);
}
```
to:
```js
function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam, loadGame, spectateLeague);
}
```

- [ ] **Step 10: Sanity-check sibling modules still load in Node**

Run:
```bash
node -e "
require('./data.js'); require('./rng.js'); require('./teams.js'); require('./traits.js'); require('./scouting.js'); require('./players-2026.js');
console.log('sibling module graph OK — script.js itself needs browser globals and is exercised end-to-end in Task 17');
"
```
Expected: the message prints with no errors.

- [ ] **Step 11: Commit**

```bash
git add script.js
git commit -m "feat: play modes, draft-session wiring, day-complete composition in script.js"
```

---

### Task 10: `ui/draftPicker.js` (new)

**Files:**
- Create: `ui/draftPicker.js`

**Interfaces:**
- Consumes: `getTeamById`, `getRevealedView` (from `scouting.js`), `GameState.scouting`
- Produces: `renderDraftPicker(container, session, userTeamId, onPick)`

- [ ] **Step 1: Write the picker**

```js
function renderDraftPicker(container, session, userTeamId, onPick) {
  const pick = currentPick(session);
  const team = getTeamById(userTeamId);
  const sorted = session.available.slice().sort(function (a, b) { return b.overall - a.overall; });

  let html = '<h2>' + team.name + ' — Round ' + pick.round + ', Pick ' + pick.pickNumber + '</h2>';
  html += '<p>' + session.results.length + ' picks made so far, ' + session.available.length + ' prospects remaining.</p>';
  html += '<table><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Scouted</th><th></th></tr></thead><tbody>';
  sorted.forEach(function (p) {
    const target = GameState.scouting.targets[p.id];
    const confidence = target ? target.confidence : 0;
    const revealed = getRevealedView(p, confidence);
    const scoutedLabel = revealed.level === 'exact' ? 'Fully scouted' : (revealed.level === 'fuzzy' ? 'Partially scouted' : 'Unscouted');
    html += '<tr><td>' + p.name + '</td><td>' + p.position + '</td><td>' + p.age + '</td><td>' + p.overall + '</td><td>' + scoutedLabel + '</td>' +
      '<td><button data-prospect-id="' + p.id + '">Draft</button></td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('button[data-prospect-id]').forEach(function (btn) {
    btn.addEventListener('click', function () { onPick(btn.getAttribute('data-prospect-id')); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftPicker: renderDraftPicker };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/draftPicker.js
git commit -m "feat: manual draft-pick UI"
```

---

### Task 11: `ui/liveFeed.js` (new) + nav entry

**Files:**
- Create: `ui/liveFeed.js`
- Modify: `ui/nav.js:1-16` (`NAV_ITEMS`)

**Interfaces:**
- Produces: `renderLiveFeed(container)`

- [ ] **Step 1: Write the feed view**

```js
function renderLiveFeed(container) {
  let html = '<h2>Live Feed</h2>';
  if (GameState.feed.length === 0) {
    html += '<p>Nothing has happened yet — advance the sim to see events here.</p>';
  } else {
    html += '<ul>';
    GameState.feed.slice().reverse().forEach(function (entry) {
      html += '<li>[Year ' + entry.leagueYear + ', Day ' + (entry.day === null ? '-' : entry.day) + '] ' + entry.text + '</li>';
    });
    html += '</ul>';
  }
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderLiveFeed: renderLiveFeed };
}
```

- [ ] **Step 2: Add the nav entry**

In `ui/nav.js`'s `NAV_ITEMS` array, add `{ id: 'feed', label: 'Live Feed' },` right after the `saveload` entry.

- [ ] **Step 3: Commit**

```bash
git add ui/liveFeed.js ui/nav.js
git commit -m "feat: live event feed view + nav entry"
```

---

### Task 12: `ui/teamSelect.js` — mode picker + Spectate League button

**Files:**
- Modify: `ui/teamSelect.js` (full rewrite of `renderTeamSelect`, small file)

**Interfaces:**
- Produces: `renderTeamSelect(container, onSelect, onLoadGame, onSpectate)` — `onSelect(teamId, playMode)` now receives the chosen mode too.

- [ ] **Step 1: Update the file**

Change:
```js
function renderTeamSelect(container, onSelect, onLoadGame) {
  container.innerHTML = '<h1 style="text-align:center;">Choose Your Team</h1><div id="team-grid" style="text-align:center;"></div><div id="load-game-section"></div>';
  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.backgroundColor = team.colors.primary;
    card.style.border = '3px solid ' + team.colors.secondary;
    card.textContent = team.name;
    card.addEventListener('click', function () { onSelect(team.id); });
    grid.appendChild(card);
  });
  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
```
to:
```js
function renderTeamSelect(container, onSelect, onLoadGame, onSpectate) {
  container.innerHTML =
    '<h1 style="text-align:center;">Choose Your Team</h1>' +
    '<p style="text-align:center;">' +
    '<label><input type="radio" name="play-mode" value="gm" checked> GM (manual control)</label> ' +
    '<label><input type="radio" name="play-mode" value="commissioner"> Commissioner (manual control + sandbox tools)</label>' +
    '</p>' +
    '<div id="team-grid" style="text-align:center;"></div>' +
    '<p style="text-align:center;"><button id="spectate-league-btn">Spectate League (fully automated)</button></p>' +
    '<div id="load-game-section"></div>';

  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.backgroundColor = team.colors.primary;
    card.style.border = '3px solid ' + team.colors.secondary;
    card.textContent = team.name;
    card.addEventListener('click', function () {
      const mode = container.querySelector('input[name="play-mode"]:checked').value;
      onSelect(team.id, mode);
    });
    grid.appendChild(card);
  });

  document.getElementById('spectate-league-btn').addEventListener('click', onSpectate);

  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/teamSelect.js
git commit -m "feat: play-mode picker + Spectate League button on team select"
```

---

### Task 13: `ui/settings.js` — Play Mode, automation toggles, pause-on-event, disable cap

**Files:**
- Modify: `ui/settings.js` (full rewrite, small file)

**Interfaces:**
- Consumes: `switchPlayMode` (script.js, Task 9), `TEAMS`
- Produces: updated `renderSettings(container)`

- [ ] **Step 1: Update the file**

Change:
```js
function renderSettings(container) {
  let html = '<h2>Settings</h2><h3>Simulation Engine</h3>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label style="display:block;"><input type="radio" name="sim-engine" value="' + engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });
  container.innerHTML = html;

  container.querySelectorAll('input[name="sim-engine"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.simEngine = e.target.value;
    });
  });
}
```
to:
```js
const AUTOMATION_LABELS = {
  autoFreeAgency: 'Auto Free Agency (sign external FAs and re-sign your own using AI logic)',
  autoDraft: 'Auto Draft (AI picks for your team)',
  autoTrade: 'Auto Trade (AI-generated trade offers auto-execute instead of landing in your inbox)',
  autoCap: 'Auto Roster-Size Compliance (auto-waives your lowest-value player if you go over 15)',
  autoScout: 'Auto Scout (AI spends your weekly scout points)'
};

const PAUSE_ON_LABELS = {
  madePlayoffs: 'Your team makes the playoffs',
  missedPlayoffs: 'Your team misses the playoffs',
  tradeOfferReceived: 'You receive a trade offer',
  keyInjury: 'A key player (80+ OVR) on your team is injured'
};

function renderSettings(container) {
  let html = '<h2>Settings</h2>';

  html += '<h3>Play Mode</h3><p>Current: ' + GameState.playMode + '</p>';
  ['gm', 'commissioner', 'spectator'].forEach(function (mode) {
    html += '<label style="display:block;"><input type="radio" name="play-mode-switch" value="' + mode + '"' + (GameState.playMode === mode ? ' checked' : '') + '> ' + mode + '</label>';
  });
  if (!GameState.userTeamId) {
    html += '<p>No team selected yet — choose one below before switching out of Spectator.</p>';
    html += '<select id="settings-team-picker">' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select>';
  }

  html += '<h3>Simulation Engine</h3>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label style="display:block;"><input type="radio" name="sim-engine" value="' + engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });

  if (GameState.playMode !== 'spectator') {
    html += '<h3>Automation</h3>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-automation-key="' + key + '"' + (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });

    html += '<h3>Pause Multi-Season Sim On</h3>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-pause-on-key="' + key + '"' + (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });
  }

  container.innerHTML = html;

  container.querySelectorAll('input[name="sim-engine"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.simEngine = e.target.value;
    });
  });

  container.querySelectorAll('input[name="play-mode-switch"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      const picker = document.getElementById('settings-team-picker');
      const teamId = picker ? picker.value : null;
      switchPlayMode(e.target.value, teamId);
    });
  });

  container.querySelectorAll('input[data-automation-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.automation[e.target.getAttribute('data-automation-key')] = e.target.checked;
    });
  });

  container.querySelectorAll('input[data-pause-on-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.pauseOn[e.target.getAttribute('data-pause-on-key')] = e.target.checked;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSettings: renderSettings, ENGINE_LABELS: ENGINE_LABELS, AUTOMATION_LABELS: AUTOMATION_LABELS, PAUSE_ON_LABELS: PAUSE_ON_LABELS };
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/settings.js
git commit -m "feat: Play Mode switch, automation toggles, pause-on-event settings"
```

---

### Task 14: `ui/tradeCenter.js` — Trade Offers inbox

**Files:**
- Modify: `ui/tradeCenter.js` (add a section; existing builder UI untouched)

**Interfaces:**
- Consumes: `GameState.tradeOffers` (script.js, Task 9), `trade.js`'s `executeTrade`

- [ ] **Step 1: Add the inbox section**

In `renderTradeCenter`'s `draw()` function, right after the opening `let html = '<h2>Trade Center</h2>';` line, insert:
```js
    if (GameState.playMode === 'spectator') {
      html += '<p>Spectator mode — teams manage themselves.</p>';
      container.innerHTML = html;
      return;
    }

    if (GameState.tradeOffers.length > 0) {
      html += '<h3>Trade Offers</h3><ul>';
      GameState.tradeOffers.forEach(function (offer, i) {
        const partnerId = offer.proposal.participants.find(function (id) { return id !== userTeamId; });
        const partner = getTeamById(partnerId);
        const mine = offer.proposal.assignments.find(function (a) { return a.fromTeamId === userTeamId; });
        const theirs = offer.proposal.assignments.find(function (a) { return a.fromTeamId === partnerId; });
        html += '<li>' + partner.name + ' offers ' + getPlayerById(theirs.playerId).name + ' for your ' + getPlayerById(mine.playerId).name +
          ' <button data-accept-offer="' + i + '">Accept</button> <button data-decline-offer="' + i + '">Decline</button></li>';
      });
      html += '</ul>';
    }
```

And inside `wireEvents()`, add:
```js
    container.querySelectorAll('button[data-accept-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = Number(btn.getAttribute('data-accept-offer'));
        executeTrade(GameState.tradeOffers[i].proposal);
        GameState.tradeOffers.splice(i, 1);
        draw();
      });
    });
    container.querySelectorAll('button[data-decline-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        GameState.tradeOffers.splice(Number(btn.getAttribute('data-decline-offer')), 1);
        draw();
      });
    });
```

- [ ] **Step 2: Make the manual "Propose Trade" path's `evaluateUserLeg: false` explicit**

In `handlePropose`, change:
```js
  const result = proposeTrade(state, userTeamId);
```
to:
```js
  const result = proposeTrade(state, userTeamId, false); // the user always controls their own accept/reject when building a trade by hand
```

- [ ] **Step 3: Auto-enforce roster size after a user-built trade completes, if the toggle is on**

In `handlePropose`, inside the `if (result.accepted)` branch, after `state.pickAssignments = [];`, add:
```js
    if (GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
```

- [ ] **Step 4: Commit**

```bash
git add ui/tradeCenter.js
git commit -m "feat: Trade Offers inbox + spectator placeholder in Trade Center"
```

---

### Task 15: `capDisabled` guards + FA auto-cap hook + spectator placeholder

**Files:**
- Modify: `freeAgency.js:62-72` (`generateAIOffer`), `tradeEvaluator.js` (`evaluateTeamLeg`'s salary check), `ui/freeAgency.js`

**Interfaces:**
- Consumes: `GameState.settings.capDisabled` — new, narrowly-scoped coupling (a single ternary at each existing check site; both files are pure logic modules with no other `GameState` dependency)

- [ ] **Step 1: Guard `generateAIOffer`'s cap check**

Change (`freeAgency.js:62-72`):
```js
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
```
to:
```js
function generateAIOffer(team, player, rng) {
  if (_FA_DATA.league.getTeamRoster(team.id).length >= 15) return null;
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const capSpace = _FA_DATA.data.CAP_CONSTANTS.SALARY_CAP - _FA_DATA.league.getTeamPayroll(team.id);
  if (!capDisabled && capSpace < 1200000) return null;
  const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
  if (interest < 40) return null;
  const fair = estimateFairSalary(player);
  const salary = Math.max(1200000, Math.min(capDisabled ? Infinity : capSpace, Math.round(fair * (0.85 + rng() * 0.3))));
  const years = 1 + Math.floor(rng() * 4);
  return { teamId: team.id, salary: salary, yearsRemaining: years };
}
```

- [ ] **Step 2: Guard `evaluateTeamLeg`'s salary check**

Change (`tradeEvaluator.js`, inside `evaluateTeamLeg`):
```js
  const salaryIncrease = incomingSalary - outgoingSalary;
  const salaryOk = salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;
```
to:
```js
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const salaryIncrease = incomingSalary - outgoingSalary;
  const salaryOk = capDisabled || salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;
```

- [ ] **Step 3: Auto-enforce roster size after a manual FA signing, if the toggle is on; spectator placeholder**

In `ui/freeAgency.js`'s `renderFreeAgency`, at the very top of `draw()`, add:
```js
    if (GameState.playMode === 'spectator') {
      container.innerHTML = '<h2>Free Agency</h2><p>Spectator mode — teams manage themselves.</p>';
      return;
    }
```

In `renderBiddingPanel`'s `accept-bid-btn` handler, after `if (outcome.signed) signingLog.push(...)`, add:
```js
      if (outcome.signed && GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
```

- [ ] **Step 4: Regression-check**

Run: `node scripts/validate-trades.js && node scripts/validate-automation.js`
Expected: both pass — in Node, `typeof GameState !== 'undefined'` is `false` (no browser globals loaded), so `capDisabled` is always `false` there and every existing Node-side assertion is unaffected.

- [ ] **Step 5: Commit**

```bash
git add freeAgency.js tradeEvaluator.js ui/freeAgency.js
git commit -m "feat: capDisabled guards + auto-cap hook in free agency"
```

---

### Task 16: `ui/simControls.js` — expanded sim controls

**Files:**
- Modify: `ui/simControls.js` (full file — small enough to touch broadly)

**Interfaces:**
- Consumes: `handleDayComplete` (script.js, Task 9), `runFreeAgencySilently`, `runOffseasonThroughDraft`, `generateNewSeason`, `generateBracket`, `simulateNextPlayoffGame`, `autoEnforceRosterSize`

- [ ] **Step 1: Replace `tickScoutingForDay` with `handleDayComplete` at the existing call sites**

In `handleNextGame`, `handleNextDay`, and `handleSimToEnd`, replace every occurrence of `, tickScoutingForDay)` with `, handleDayComplete)` (playoff-branch calls to `simulateNextPlayoffGame` don't take an `onDayComplete` param and are untouched).

- [ ] **Step 2: Add the new sim-to-X buttons and `runMultiSeason`**

Insert before `renderSimControls`:
```js
async function handleSimToTradeDeadline() {
  const container = document.getElementById('sim-controls');
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  const deadlineDay = Math.min(lastDay, Math.round(lastDay * 0.65));
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, deadlineDay, GameState.settings, GameState.rng, handleDayComplete);
  }, 1);
}

async function runRegularSeasonAndPlayoffsToCompletion(container) {
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng, handleDayComplete);
    if (!GameState.playoffBracket && isRegularSeasonComplete(GameState.season)) GameState.playoffBracket = generateBracket();
    if (GameState.playoffBracket) {
      let g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      while (g !== null) g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    }
  }, 1);
}

async function handleSimToDraft() {
  const container = document.getElementById('sim-controls');
  await runRegularSeasonAndPlayoffsToCompletion(container);
  handleAdvanceToOffseason();
}

async function handleSimToFreeAgency() {
  const container = document.getElementById('sim-controls');
  await runRegularSeasonAndPlayoffsToCompletion(container);
  handleAdvanceToOffseason();
  GameState.offseasonStage = 'freeagency';
  if (GameState.playMode === 'spectator' || GameState.automation.autoFreeAgency) {
    runFreeAgencySilently(GameState.rng);
    autoEnforceRosterSize(getTeamById(GameState.userTeamId));
  }
  renderView('freeagency');
  autosave(GameState);
}

// Repeats season -> playoffs -> offseason (always fully auto-driven, regardless
// of individual automation toggles — a 10+ season unattended run can't pause
// for manual draft/FA input at every boundary) until the requested stop
// condition. mode: 'seasons' | 'championship' | 'days'.
async function runMultiSeason(mode, target) {
  const container = document.getElementById('sim-controls');
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
  const delayMs = SIM_SPEED_DELAYS_MS[GameState.settings.simSpeed] || SIM_SPEED_DELAYS_MS.normal;

  let seasonsRun = 0;
  const maxSeasons = mode === 'championship' ? 15 : (mode === 'seasons' ? target : Infinity);
  let daysRemaining = mode === 'days' ? target : Infinity;
  GameState.pauseRequested = false;

  while (seasonsRun < maxSeasons && daysRemaining > 0 && !GameState.pauseRequested) {
    const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
    const stepTarget = mode === 'days' ? Math.min(lastDay, GameState.season.currentDay + daysRemaining) : lastDay;
    const daysBefore = GameState.season.currentDay;
    if (statusEl) statusEl.textContent = 'Simulating season ' + (seasonsRun + 1) + '...';

    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, stepTarget, GameState.settings, GameState.rng, handleDayComplete);
    if (delayMs > 0) await delay(delayMs);
    daysRemaining -= (GameState.season.currentDay - daysBefore);
    if (GameState.pauseRequested) break;
    if (GameState.season.currentDay < lastDay) continue; // 'days' mode hit its limit mid-season

    if (!GameState.playoffBracket) {
      GameState.playoffBracket = generateBracket();
      const madePlayoffs = GameState.playoffBracket.first.some(function (s) { return s.higherSeed === GameState.userTeamId || s.lowerSeed === GameState.userTeamId; });
      if ((madePlayoffs && GameState.settings.pauseOn.madePlayoffs) || (!madePlayoffs && GameState.settings.pauseOn.missedPlayoffs)) {
        GameState.pauseRequested = true;
      }
    }
    let g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    while (g !== null) g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);

    if (mode === 'championship' && GameState.playoffBracket.finals[0].winner === GameState.userTeamId) {
      seasonsRun += 1;
      GameState.pauseRequested = true;
      break;
    }
    if (GameState.pauseRequested) { seasonsRun += 1; break; }

    GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
    const draftResult = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass);
    GameState.lastDraftResults = draftResult.draftResults;
    runFreeAgencySilently(GameState.rng);
    autoEnforceRosterSize(getTeamById(GameState.userTeamId));

    const seasonResult = generateNewSeason(GameState.rng);
    GameState.season = { games: seasonResult.games, currentDay: -1 };
    GameState.upcomingDraftClass = seasonResult.nextDraftClass;
    GameState.playoffBracket = null;
    GameState.offseasonStage = null;
    seasonsRun += 1;
  }

  if (statusEl) statusEl.textContent = '';
  renderView(GameState.currentView);
  autosave(GameState);
}
```

- [ ] **Step 3: Add the buttons in `renderSimControls`**

Change the `container.innerHTML =` block — after the existing `'<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +` line, insert:
```js
    '<button id="sim-to-deadline">Sim to Trade Deadline</button>' +
    '<button id="sim-to-draft">Sim to Draft</button>' +
    '<button id="sim-to-fa">Sim to Free Agency</button>' +
    '<input type="number" id="sim-n-seasons" value="1" min="1" max="15" style="width:3em;"><button id="sim-n-seasons-btn">Sim N Seasons</button>' +
    '<button id="sim-until-championship">Sim Until Championship</button>' +
    '<input type="number" id="sim-n-days" value="7" min="1" style="width:4em;"><button id="sim-n-days-btn">Sim Custom Days</button>' +
```

And after the existing `document.getElementById('sim-to-end').addEventListener('click', handleSimToEnd);` line, add:
```js
  document.getElementById('sim-to-deadline').addEventListener('click', handleSimToTradeDeadline);
  document.getElementById('sim-to-draft').addEventListener('click', handleSimToDraft);
  document.getElementById('sim-to-fa').addEventListener('click', handleSimToFreeAgency);
  document.getElementById('sim-n-seasons-btn').addEventListener('click', function () {
    runMultiSeason('seasons', Number(document.getElementById('sim-n-seasons').value));
  });
  document.getElementById('sim-until-championship').addEventListener('click', function () {
    runMultiSeason('championship', null);
  });
  document.getElementById('sim-n-days-btn').addEventListener('click', function () {
    runMultiSeason('days', Number(document.getElementById('sim-n-days').value));
  });
```

- [ ] **Step 4: Update `module.exports`**

Add the new functions (`handleSimToTradeDeadline`, `handleSimToDraft`, `handleSimToFreeAgency`, `runMultiSeason`) to the existing `module.exports` object.

- [ ] **Step 5: Commit**

```bash
git add ui/simControls.js
git commit -m "feat: Sim to Trade Deadline/Draft/Free Agency + multi-season sim controls"
```

---

### Task 17: Wire `index.html` + end-to-end browser verification

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the new script tags**

After `<script src="save.js"></script>`, add:
```html
  <script src="autoGM.js"></script>
```
After `<script src="ui/saveLoad.js"></script>`, add:
```html
  <script src="ui/liveFeed.js"></script>
  <script src="ui/draftPicker.js"></script>
```

- [ ] **Step 2: Run every Node validator**

Run:
```bash
node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js && node scripts/validate-save.js && node scripts/validate-automation.js
```
Expected: every file prints its own passing summary line, no errors.

- [ ] **Step 3: Live browser verification**

Serve the app (fresh port to avoid stale-JS caching, per this project's established pattern) and drive through `mcp__Claude_Browser__*`:
```bash
python -m http.server 8007 --directory "C:\Users\cory\Desktop\nba"
```
Then, in the browser:
1. Open the team select screen. Confirm the GM/Commissioner radio and "Spectate League" button render.
2. Pick a team in **GM** mode. Confirm Settings shows Play Mode radios, 5 automation checkboxes, and 4 pause-on-event checkboxes, all initially unchecked/GM.
3. Check **Auto Draft**. Advance to the offseason. Confirm the draft resolves immediately with no picker shown, matching pre-Phase-7 behavior.
4. Reload, pick a **fresh** team in GM mode, leave Auto Draft off. Advance to the offseason. Confirm the manual **draft picker** renders at the user's first-round slot with scouted-confidence labels, clicking "Draft" advances through AI-resolved batches to the user's second-round slot, then to full results once complete. Zero console errors throughout.
5. From the draft results, click "Go to Free Agency" with **Auto Free Agency** off — confirm the normal bidding UI still works. Toggle it on for a fresh run and confirm auto-resolution instead.
6. Advance through a live season day. Open the new **Live Feed** nav view — confirm game-result entries appear for the user's games.
7. In Trade Center, confirm the "Propose Trade" flow is unaffected. Verify (checking `GameState.tradeOffers` via the browser console after a few simulated weeks if needed) that a generated trade offer eventually appears in the inbox when Auto Trade is off, and auto-executes (visible in the feed) when on.
8. Start a **fresh Spectator** run via "Spectate League". Confirm Trade Center and Free Agency show the "Spectator mode" placeholder, Settings hides the automation/pause-on-event sections, and "Sim N Seasons" (small N, e.g. 2) runs multiple seasons unattended with zero console errors.
9. Save mid-run, reload the page, load the save, and confirm `playMode`/automation toggles/feed are restored exactly (check via Settings and Live Feed before vs. after).
10. Check the browser console (`mcp__Claude_Browser__read_console_messages`) for errors after every major step above.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: wire Phase 7A automation core into the app shell"
```

- [ ] **Step 5: Invoke `superpowers:finishing-a-development-branch`**

This project works directly on `master` with no feature branches and no git remote — follow that skill's guidance for the no-remote/no-branch case (verify tests, confirm clean `git status`, report completion).
