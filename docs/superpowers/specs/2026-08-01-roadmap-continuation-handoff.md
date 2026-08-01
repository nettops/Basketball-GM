# NBA GM Simulator — Roadmap Continuation Handoff (Phase 7B + Phase 8)

**Status:** Written to be read cold, in a fresh chat with no memory of prior sessions. If you are that fresh chat: read this whole document before touching code. It replaces the conversation history you don't have.

## How to use this document

1. Read **Project State** and **Architecture Primer** below fully — they contain hard-won context (recurring bug patterns, established conventions) that isn't otherwise written down anywhere in the code comments.
2. **Phase 7B** is fully designed and ready to move straight to `superpowers:writing-plans`. Read its section, confirm with your human partner it still matches their intent (roadmaps drift), then write the implementation plan and execute it exactly like Phase 7A was executed (see **Process Reminders**).
3. **Phase 8** is *not* designed yet — only scoped from the original roadmap plus grounding notes on what the current codebase already has in place for it. Run a full `superpowers:brainstorming` session for it before writing any plan or code. Do not skip that just because this document exists.
4. This project has **no git remote and no feature branches** — every phase lands as a sequence of small commits directly on `master`. Follow that pattern; do not create a branch unless your human partner asks for one.
5. This project's established preference (confirmed repeatedly) is **inline execution** of implementation plans (`superpowers:executing-plans`), not subagent-driven execution. Don't ask — just do it this way unless told otherwise.

---

## Project State

**Location:** `C:\Users\cory\Desktop\nba` (a git repo, `master` branch, no remote).

**Roadmap:** `docs/superpowers/specs/2026-07-31-nba-gm-simulator-roadmap.md` — governs all 8 phases. Read it for the full vision/constraints (vanilla JS only, no frameworks, no build step, `localStorage` persistence, real NBA teams/players for personal use).

**Completed phases** (1 through 7A), each with its own spec + plan doc(s) in `docs/superpowers/specs/` and `docs/superpowers/plans/`:

1. Foundation — file structure, 30 real teams with real 2025-26 rosters, dashboard/nav shell.
2. Season sim engine — schedule, box-score sim, standings, playoffs, sim controls.
3. Roster management + trades — manual trades, AI trade evaluation (`tradeEvaluator.js`, `trade.js`).
4. Free agency + draft (split 4A/4B) — draft/lottery, free agency bidding, real 2026 draft class.
5. Hidden traits, personality & scouting (split 5A/5B) — `traits.js`, `scouting.js`, confidence-gated reveal.
6. Save/load — `save.js`, 5 manual slots + autosave, exact RNG resume.
7A. Play modes & automation core — GM/Commissioner/Spectator modes, 5 automation toggles, manual draft-pick UI, AI trade-offer generator, expanded sim controls (Sim to Trade Deadline/Draft/FA, Sim N Seasons/Until Championship/Custom), live feed, pause-on-event.

**Remaining:**

- **Phase 7B** — Commissioner sandbox tools. *Fully designed below.*
- **Phase 8** — League history & dynasty tracking. *Scoped, not designed, below.*

**Latest relevant docs to read before starting:**
- `docs/superpowers/specs/2026-08-01-phase-7-play-modes-automation-design.md` — the original Phase 7 design (§9 covers Commissioner tools; this handoff's Phase 7B section supersedes/expands it with details worked out during 7A execution).
- `docs/superpowers/plans/2026-08-02-phase-7a-automation-core.md` — the just-completed plan, useful as a template for task granularity/style when writing Phase 7B's plan.

**Verify current state before assuming anything above is still accurate:**
```bash
cd "C:\Users\cory\Desktop\nba" && git log --oneline -20 && git status
```

---

## Architecture Primer

Things a fresh chat needs to know that aren't self-evident from reading individual files:

### Conventions (apply to every new file)
- Dual browser-global/Node-require pattern in every file: `var _XXX_DATA = (typeof require !== 'undefined') ? {...} : {...}`.
- Node is dev-time only (validation scripts), never a runtime dependency — no `import`/`export`, no build step, no `package.json` dependencies.
- Every logic module gets a `scripts/validate-<area>.js` Node validator (assert-based, sequential `checkX(); checkY();` calls, ending with a `console.log('All ... validations passed')` line). Run ALL of them before considering a phase done — the full list as of Phase 7A:
  ```bash
  node scripts/validate-data.js && node scripts/validate-sim.js && node scripts/validate-trades.js && node scripts/validate-offseason.js && node scripts/validate-traits.js && node scripts/validate-save.js && node scripts/validate-automation.js
  ```
- Every phase ends with a **live browser verification pass** using `mcp__Claude_Browser__*` tools: `preview_start` on a fresh port (avoid stale-JS caching from a prior server), navigate, click through the actual feature, check `read_console_messages(onlyErrors: true)` after every meaningful step. Node validators check logic; only the browser catches wiring/rendering bugs. Phase 7A caught two real bugs this way that no validator would have found (a trade-offer generator with unreachable thresholds, and live-feed entries all tagged "Day -1" from a stale-state read) — don't skip this step.
- Commit after each task, with a message describing what shipped (not "task 5"). If a task deviates from the written plan (a threshold turns out too narrow, a design assumption was wrong), fix it and say so in the commit message — this has happened in nearly every phase so far and is normal, not a failure.

### Key modules and what they own
- `data.js` — shared constants (`ATTRIBUTE_KEYS`, `POSITIONS`, `CONFERENCES`, `DIVISIONS`, `CAP_CONSTANTS`, `RATING_MIN`/`RATING_MAX` = 25/99).
- `teams.js` — `TEAMS` array, 30 real teams: `{ id, name, conference, division, colors, prestige, fanHappiness, ownerHappiness, chemistry, timeline, marketSize, record, draftPicks }`.
- `players-2026.js` — `PLAYERS_2026` array, the single source of truth for every player in the league (grows/shrinks via draft/retirement/free agency).
- `league.js` — cross-cutting queries (`getTeamRoster`, `getTeamById`, `getPlayerById`, `getTeamPayroll`) and `simulateDate`/`simulateNextDay`/`simulateThroughDate` (the sim orchestrator; `onDayComplete(dayIndex, todaysGames, newInjuries)` callback, extended in Phase 7A).
- `rng.js` — `makeRng(seed)` returns a callable function with `.getState()`/`.setState()` attached for exact save/load resume. Every RNG-consuming function takes `rng` as an explicit param — never reach for `Math.random()` in anything that affects gameplay determinism (the one sanctioned exception so far: Phase 7A's `spectateLeague()` picks a purely cosmetic "camera" team via `Math.random()`, since it has zero gameplay effect).
- `traits.js` / `scouting.js` — hidden trait/personality/tendency generation and the confidence-gated scouting reveal system.
- `tradeEvaluator.js` — `adjustedPlayerValue(player, team)`, `needMultiplier(position, team)`. **Important gotcha:** `needMultiplier` only returns 4 discrete values (1.3 empty position / 1.15 far below league avg / 1.0 normal / 0.9 well above avg) — code that filters on it (e.g. Phase 7A's trade-offer generator) needs to account for how narrow the 1.3/1.15 "desperate need" band actually is on real, balanced rosters. This bit Phase 7A once already.
- `trade.js` — `evaluateTrade(proposal, userTeamId, evaluateUserLeg)`, `executeTrade`, `proposeTrade`. `evaluateUserLeg` (added Phase 7A) lets code other than the user's own hand-built proposals have the user's leg evaluated like any AI team's.
- `freeAgency.js` / `freeAgencyBidding.js` — `generateAIOffer`, `scoreOffer`, `signPlayer`, `runFreeAgencySilently` (resolves every free agent for every team uniformly — reused directly for "auto free agency" rather than writing bespoke logic), the manual bidding-war state machine.
- `draft.js` — `runDraft` (fully automatic, unchanged since Phase 4) plus Phase 7A's additive stepwise session API: `startDraftSession`, `currentPick`, `resolveCurrentPick`, `advanceDraftUntilUserTurn` — a synchronous, promise-free pause/resume pattern (mirrors `freeAgencyBidding.js`'s existing manual/automatic split). **If Phase 8 or 7B ever needs another "pause mid-automatic-process for user input" flow, follow this exact pattern rather than introducing async/await** — Phase 7A deliberately avoided promises to prevent rewriting every existing test's execution model, and it paid off.
- `seasonTransition.js` — `runOffseasonPreDraft(rng)` (progression, retirement, contract expiration, status reset — extracted in Phase 7A so it's independently callable), `runOffseasonThroughDraft` (calls the above + the draft), `generateNewSeason(rng)`. **Retirement currently just removes a player from `PLAYERS_2026` entirely with no record kept** — this is the exact seam Phase 8 needs to hook (see below).
- `rosterMoves.js` — `waivePlayer` (blocks below the 12-man floor), `getFreeAgents`.
- `save.js` — `serializeGameState`/`applySavedState`/`saveToSlot`/`loadFromSlot`/`listSaves`/`autosave`. Whenever you add a new top-level `GameState` field that should survive a save, add it to both functions explicitly (fields nested inside the already-serialized `GameState.settings` blob round-trip for free; new sibling fields do not).
- `autoGM.js` (Phase 7A) — `autoEnforceRosterSize(team)`, `autoAllocateScoutPoints(...)`, `generateTradeOffer(team, rng)`. The established philosophy: **automation reuses the exact same evaluator functions already driving AI teams** — never write a separate "Auto GM personality." Follow this same philosophy for any Phase 7B/8 automation.
- `script.js` — `GameState` (see current shape below), `BUILT_VIEWS` (view-name → render-function map; anything not in this map falls back to a placeholder), `renderView`, mode-switching (`switchPlayMode`, `spectateLeague`), the day-complete composition (`handleDayComplete` → `tickScoutingForDay` + `pushGameResultsToFeed` + `pushInjuriesToFeed` + `runWeeklyTradeGeneration`).
- `ui/*.js` — one file per view, `render<ViewName>(container, ...)` convention. `ui/nav.js`'s `NAV_ITEMS` currently includes `salarycap`, `news`, `awards`, `history` entries with **no `BUILT_VIEWS` renderer yet** — they fall to the placeholder. Phase 8 is what's expected to fill in `awards` and `history`.

### Current `GameState` shape (script.js)
```js
{
  userTeamId, currentView, season, playoffBracket,
  playMode,          // 'gm' | 'commissioner' | 'spectator'
  automation,        // { autoFreeAgency, autoDraft, autoTrade, autoCap, autoScout } — all boolean
  feed,              // [{ day, leagueYear, text }], capped at 200
  draftSession,      // null, or an in-progress draft.js session object
  tradeOffers,       // [{ proposal, evaluation }] — pending inbox for the user's team
  pauseRequested,    // transient loop-control flag for runMultiSeason
  settings: {
    simEngine, simSpeed,
    pauseOn,         // { madePlayoffs, missedPlayoffs, tradeOfferReceived, keyInjury } — all boolean
    capDisabled       // boolean, Phase 7B will read/write this
  },
  rng, scouting, upcomingDraftClass, leagueYear, offseasonStage, lastDraftResults, lastTradeGenWeek
}
```

### Recurring bug pattern (has bitten this project 3 times — twice in Phase 5, once conceptually similar in Phase 7A)
Empty object stubs (`{}`) are truthy in JS. `if (player.hiddenX)` does NOT protect against `player.hiddenX.someField` being `undefined`. Always guard the specific field you're about to read (`player.hiddenX && player.hiddenX.someField !== undefined`), not just the container object. Watch for this in any new code that reads `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies`, and in any new per-player state Phase 8 introduces (e.g. a `careerStats` or `awards` field that starts as an empty stub before being populated).

---

## Phase 7B — Commissioner Sandbox Tools (Design Spec — Ready to Plan)

**Status:** Design complete. Go straight to `superpowers:writing-plans` for this phase (after confirming with your human partner it's still what they want — check in before writing code, per this project's standing pattern of confirming before each phase transition).

### Goal
Commissioner-mode-only sandbox tools: edit any player's ratings, force a trade through without evaluation, create a player, delete/retire a player, disable the salary cap entirely, and a simplified expansion-team creation flow. Visible only when `GameState.playMode === 'commissioner'`.

### 1. Nav & gating
New `commissioner` entry in `ui/nav.js`'s `NAV_ITEMS`. `BUILT_VIEWS.commissioner = renderCommissioner`. Both the nav button and the view itself should be hidden/inert when `GameState.playMode !== 'commissioner'` — follow the existing pattern from Phase 7A's Trade Center/Free Agency spectator placeholders (check play mode at the top of the render function), OR filter `NAV_ITEMS` itself when rendering the nav bar (`renderNav` in `ui/nav.js` — check its current signature before deciding which approach fits more cleanly; it wasn't touched in Phase 7A).

### 2. Edit Player
Form: pick any player (search/select by name), adjust `overall`, `potential`, and individual attributes (`ATTRIBUTE_KEYS` from `data.js`) directly. Bound every value to `RATING_MIN`/`RATING_MAX` (25/99). New `commissioner.js` function: `editPlayerRatings(playerId, changes)` — validates each changed field against the min/max bounds, mutates the player object in place (same "mutate in place, don't reassign" discipline `save.js`'s `applySavedState` already established for `PLAYERS_2026`/`TEAMS`).

### 3. Force Trade
Reuse `ui/tradeCenter.js`'s existing proposal-building UI wholesale (team/player pickers, the running value/salary display) — do not rebuild it. Add a second "Force Trade" button next to "Propose Trade" that's only rendered when `GameState.playMode === 'commissioner'`. Its handler calls a new `commissioner.js` function `forceTrade(proposal)` → `executeTrade(proposal)` directly, skipping `evaluateTrade`/`validateRosterSizes` entirely (explicitly consequence-free, per the original design). Decide during planning whether roster-size limits (12-15) should still apply even in Force Trade — the original Phase 7 design said skip all checks, but consider flagging this choice to your human partner during the plan review since letting a team drop to e.g. 3 players could break other systems (box-score sim, `waivePlayer`'s assumptions) in ways not yet tested.

### 4. Create Player
Form: name, position, age, overall, potential (bounded by `RATING_MIN`/`RATING_MAX`). New `commissioner.js` function `createPlayer(details)` builds a full player record matching the schema every other player has — cross-reference `players-2026.js` or `draftProspects.js`'s `generateProspectClass` for the exact current field list (id, name, position, age, overall, potential, jerseyNumber, contract, status, attributes, hiddenTraits, hiddenPersonality, hiddenTendencies) — **do not hand-roll attribute values**; procedurally derive individual `attributes` from `overall` the same way other player-generation code does, and generate `hiddenTraits`/`hiddenPersonality`/`hiddenTendencies` via `traits.js`'s existing `ensureHiddenPlayerData` (or the specific generator functions it calls) rather than leaving them as empty stubs — empty stubs are exactly the bug pattern flagged above. Push onto `PLAYERS_2026` as a free agent (`teamId: null`) by default, or directly onto a chosen team's roster if one is picked in the form (assign a contract the same way `executePick`/`signPlayer` do).

### 5. Delete Player
Removes a player from `PLAYERS_2026` entirely — same `splice`-by-index mechanism `runOffseasonPreDraft`'s retiree-removal already uses. New `commissioner.js` function `deletePlayer(playerId)`.

### 6. Disable Cap
`GameState.settings.capDisabled` already exists as a field (added in Phase 7A, currently always `false`, with guards already wired at both existing cap-check sites: `freeAgency.js`'s `generateAIOffer` and `tradeEvaluator.js`'s `evaluateTeamLeg`). **Phase 7B's only remaining work here is the UI checkbox** in `ui/commissioner.js` (or `ui/settings.js`, if that's a better fit — Phase 7A put automation toggles in Settings; decide during planning whether cap-disable belongs there for consistency, or in the Commissioner view since it's Commissioner-only) that toggles it. No further guard code needed — verify this by grepping for `capDisabled` before assuming otherwise, in case that changes before Phase 7B starts.

### 7. Expansion Team (simplified)
Form: name, city, primary/secondary color, market size (1-100). New `commissioner.js` function `createExpansionTeam(details, rng)`:
1. Append a new team object to `TEAMS` — fresh unique id, `record: { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }`, `prestige: 40` (starting value), `timeline: 'rebuilding'`, `chemistry`/`fanHappiness`/`ownerHappiness` at reasonable defaults (check what other teams' starting values look like in `teams.js` for a sane baseline), `draftPicks` in the same `[{round:1,...},{round:2,...}]` shape every team has. Conference/division assignment: needs a decision during planning — the original design didn't pin this down (options: let the user pick, or auto-assign to balance conference/division sizes; check `CONFERENCES`/`DIVISIONS` in `data.js` for the current 3-division-per-conference, 5-team-per-division structure, which a 31st team will unbalance no matter what).
2. Simplified expansion draft: every existing team "protects" its top 8 players by `overall` (fully automatic, no user choice); the new team drafts one unprotected player from each of the other teams in `rng`-shuffled order, using `adjustedPlayerValue` to pick the best available each time, until its roster reaches ~14 players.
3. Takes effect starting the *next* `generateNewSeason()` call — `TEAMS` is read fresh each time a schedule generates, so a new entry is picked up automatically. **Do not** attempt to regenerate an in-progress schedule.

### 8. New files
- `commissioner.js` — `editPlayerRatings`, `forceTrade`, `createPlayer`, `deletePlayer`, `createExpansionTeam`.
- `ui/commissioner.js` — the sandbox view, following the same `render<X>(container, ...)` convention as every other `ui/*.js` file.

### 9. Out of scope (confirmed in the original Phase 7 design, still applies)
- User-directed player protection lists for expansion drafts (protection is automatic).
- Retroactive/mid-season schedule regeneration for a new expansion team.
- Any deeper salary-cap-dollar enforcement system beyond the existing roster-size-band check.

### Open questions to resolve during plan-writing (flag to your human partner, don't just guess)
- Force Trade: keep the 12-15 roster-size floor/ceiling, or truly skip everything?
- Expansion team conference/division assignment: user-picked or auto-balanced?
- Disable Cap checkbox location: `ui/settings.js` or `ui/commissioner.js`?

---

## Phase 8 — League History & Dynasty Tracking (Scope Outline — Needs Brainstorming)

**Status:** Not designed. This section is a starting point for a `superpowers:brainstorming` session, not a spec to implement directly. It exists so the brainstorming session doesn't have to rediscover the roadmap's original intent or re-derive what the codebase already has in place.

### Roadmap's original scope (verbatim intent, from `2026-07-31-nba-gm-simulator-roadmap.md`)
> Indefinite season tracking, full awards suite (MVP, Finals MVP, DPOY, ROY, 6MOY, COY, MIP, All-NBA), retirements, Hall of Fame, franchise/league records, career milestones, draft class archives, major trade archive. What Spectator mode and long unattended multi-season sims (Phase 7) are ultimately browsing.

### What the codebase already has in place for this (grounding, not design)
- **Season stat accumulation already exists**: `league.js`'s `accumulateSeasonStats`/`getPlayerAverages` track per-player season totals/averages already, reset each `generateNewSeason` call (`p.seasonStats = undefined`). Career totals across seasons are **not** currently accumulated anywhere — that's new Phase 8 territory.
- **Retirement currently discards the player entirely** — `seasonTransition.js`'s `runOffseasonPreDraft` splices a retiring player straight out of `PLAYERS_2026` with only a count (`retireeCount`) surviving. A Hall of Fame / career-record system needs this to instead snapshot the player's career record somewhere before deletion — this is the most concrete, unambiguous integration point for Phase 8's first design question.
- **Champion is already determinable**: `playoffs.js`'s `bracket.finals[0].winner` gives the champion team id once `bracket.finals[0].complete` is true — no new plumbing needed to know who won a title, just somewhere to persist it across seasons.
- **`teams.js`'s `prestige` field already exists** and could plausibly feed "storied franchise" flavor, but nothing currently changes it based on results — whether Phase 8 should start adjusting `prestige` based on championships/records is an open design question, not decided.
- **Draft results already exist per-season** (`GameState.lastDraftResults`) but aren't archived across seasons — `GameState.upcomingDraftClass`/`lastDraftResults` get overwritten every offseason with no history kept.
- **Trade execution already has a natural hook**: `trade.js`'s `executeTrade` is the single call site every trade (user-built, forced, or auto-generated) already funnels through — a major-trade archive would hook here.
- **`nav.js` already reserves `awards` and `history` nav slots** with no `BUILT_VIEWS` renderer — Phase 8 is expected to fill these in, plus decide whether it needs additional nav entries (e.g. a separate Hall of Fame view, a Records view, a Draft Archive view) or consolidates into those two.
- **No season-count limit exists anywhere** — `GameState.leagueYear` just increments forever already (Phase 7A's `runMultiSeason` already exercises this across multiple seasons without issue), so "indefinite season tracking" mostly means *persisting historical data* across those seasons, not removing an existing cap.

### Real, unresolved design questions for the brainstorming session to work through
- **Data model**: does career/historical data live as new fields directly on the (still-active) player object, or in a separate `history.js`-style archive keyed by player/season/team, decoupled from the mutable `PLAYERS_2026` array? Given retired players are currently deleted outright, this is the central architectural decision — get it right before anything else in this phase.
- **Awards computation**: end-of-season, algorithmically from accumulated stats (MVP = highest some-formula-of stats among playoff-team players, etc.) — same "AI reuses existing evaluators" philosophy that's served every prior phase well, or does it need new formulas? All-NBA teams (5-man, 3 tiers) in particular need a selection algorithm that doesn't exist anywhere yet.
- **Hall of Fame induction criteria**: automatic threshold (career stats/awards-based formula) vs. some other mechanism? A real NBA HOF has human voters; this game has none — needs a deterministic replacement.
- **Save file size**: Phase 6's design already hit a real constraint here (per-game box scores were dropped from saves for size reasons — see `docs/superpowers/specs/2026-08-02-phase-6-save-load-design.md` §2). Decades of accumulated career/franchise history will need the same kind of size discipline from day one, not bolted on later.
- **UI scope**: how much of this needs to be *browsable* (a full stats-website-style career page per player) vs. just *tracked* (numbers exist, minimal display)? This should follow from what Spectator mode actually needs to be worth watching, per the roadmap's own framing ("what Spectator mode... is ultimately browsing").
- **Interaction with Phase 7's automation**: does an Auto-something toggle need to exist for anything Phase 8 introduces, or is this phase purely observational (no new decisions for the user or AI to make, just records of decisions already made elsewhere)? Current read: purely observational, but confirm during brainstorming rather than assuming.

### Suggested first brainstorming question
Given the roadmap lists 7 distinct sub-features (season tracking, awards, retirements, HOF, records, milestones, archives), consider whether this needs the same "flag oversized scope, split into sub-specs" treatment Phase 4 and Phase 5 got (both split into A/B batches). A reasonable first split to propose: **8A — career/franchise record-keeping infrastructure + retirement/HOF** (the data-model-heavy, foundational half) and **8B — awards suite + browsable history UI** (built on top of 8A's data model). But this is a suggestion for the brainstorming session to validate with the user, not a decision made here.

---

## Process Reminders

For **both** remaining phases, follow the exact cycle every prior phase in this project used:

1. `superpowers:brainstorming` (Phase 7B can likely skip most of this since it's pre-designed above — but still confirm scope with your human partner before jumping to planning; Phase 8 needs the real thing).
2. Write the design spec to `docs/superpowers/specs/YYYY-MM-DD-phase-<N>-<topic>-design.md`, commit it.
3. `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-phase-<N>-<topic>.md`. Split into sub-plans (7Ba/7Bb, 8A/8B, etc.) if the task count runs past ~15-18, matching how every multi-batch phase so far has been split.
4. `superpowers:executing-plans`, **inline execution** (not subagent-driven — this is a confirmed, repeated preference for this specific project).
5. Full Node validator suite + live browser verification pass before calling a phase done.
6. Report completion, ask before moving to the next phase.

Always confirm before starting a new phase, even with this document in hand — a fresh chat should still check in with the user rather than assuming this handoff is authorization to proceed unattended through both remaining phases.
