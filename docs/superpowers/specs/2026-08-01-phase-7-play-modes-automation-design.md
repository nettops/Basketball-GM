# Phase 7 — Play Modes & Automation: Design

**Status:** Approved. Governs Phase 7 of the roadmap (`2026-07-31-nba-gm-simulator-roadmap.md`).

## Goal

Let the player choose how hands-on they want to be — full manual GM, GM-plus-sandbox-tools Commissioner, or fully hands-off Spectator — with per-system automation toggles in between, an Auto GM that reuses the AI logic already driving every non-user team, expanded multi-season sim controls, a live event feed, pause-on-event interrupts, and Commissioner sandbox tools.

## Scope correction from the roadmap

The roadmap's automation list (10 systems) was written before this codebase existed in detail. Checking against the actual code:
- **No mechanic exists** for per-game lineups/minutes, training, or G League/two-way rosters — the sim uses team rating, not individual lineups, and progression is already fully automatic. These stay noted as deferred/future scope (same treatment as historical seasons), not built as no-op toggles.
- **Injuries already resolve with zero manual decisions** — there's nothing to automate away from. Dropped as a toggle.
- **Free agency bidding already treats re-signing your own expiring player identically to bidding on any other free agent** (same pool, same UI) — "Auto Sign FAs" and "Auto Negotiate" are the same mechanic. Merged into one toggle.
- **The draft has always been 100% AI-picked for every team, including the user's** — there's no manual draft-pick UI at all today. Building one is new functionality (§4), not a toggle over existing behavior.
- **There is no AI-initiated trade-offer mechanic** — every trade today is user-constructed via the Trade Center, and the evaluator hard-codes the user's own leg as auto-accepted (`isUser: true` bypasses `evaluateTeamLeg`). A real "Auto Trade" needs a small trade-offer generator (§5), not just a gate.

**Final automation system list:** `autoFreeAgency`, `autoDraft`, `autoTrade`, `autoCap`, `autoScout`.

## 1. Play Modes

`GameState.playMode`: `'gm' | 'commissioner' | 'spectator'`, default `'gm'`.

- **Team-select screen** (`ui/teamSelect.js`) gets a mode radio (GM / Commissioner) next to the team grid, plus a new **Spectate League** button that calls `initSeason()` with `GameState.userTeamId = null` and `playMode = 'spectator'`.
- **Settings view** gets a "Play Mode" section to switch modes anytime post-start:
  - Switching to Spectator keeps `userTeamId` set if one exists (used only to highlight that team in the live feed/standings — cosmetic, no special treatment) and force-sets every entry in `GameState.automation` to `true` for the remainder of Spectator mode.
  - Switching from Spectator back to GM/Commissioner with no `userTeamId` (pure spectator start) prompts a team picker inline in Settings before the switch completes.
  - Switching to Commissioner from GM (or back) just toggles sandbox-tool visibility — no state changes.
- **Spectator mode UI**: `renderView` hides manual-control affordances — Trade Center, Free Agency bidding panel, and the new manual draft picker all render a "Spectator mode — teams manage themselves" placeholder instead of their normal interactive form. Dashboard/Standings/Schedule/Roster/History/Scouting/Live Feed remain fully browsable.

## 2. Automation Toggles

`GameState.automation = { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false }`. Only meaningful for the user's own team — every AI team is already always "automated" by existing game logic. Exposed as checkboxes in Settings (hidden/all-forced-on in Spectator mode per §1).

- **`autoFreeAgency`** — when the FA period is active (or a bulk multi-season sim is running one), the user's team's free-agency decisions (both signing external free agents and re-signing its own expiring players) are resolved by the same `generateAIOffer`/`scoreOffer` logic already used for every AI team, instead of the user's own bidding panel. Implemented in `autoGM.js` as `autoResolveFreeAgencyForTeam(team, rng)`: pulls `getFreeAgents()`, generates an offer via `generateAIOffer(team, player, rng)` for any player where `adjustedPlayerValue` clears the same `interest < 40` bar the function already enforces, and signs via `signPlayer` if that offer would win against the field (compare with `scoreOffer` the same way `resolveFreeAgentSilently` does for AI teams). Reuses `freeAgency.js` entirely — no new evaluation logic.
- **`autoDraft`** — when it's the user's turn in the draft (manual UI from §4), `selectAIPick(teamId, availableProspects)` is called instead of presenting the picker. Zero new logic; just a gate around the existing function.
- **`autoTrade`** — a weekly tick (see §5) runs the trade-offer generator for the user's team and auto-executes any proposal that evaluates as accepted on both legs.
- **`autoCap`** — the *only* numeric constraint the game currently enforces that can leave a team stuck (roster outside the 12–15 band, e.g. after a trade's `validateRosterSizes` rejection, or free agency pushing past 15) gets auto-resolved: `autoGM.js`'s `autoEnforceRosterSize(team)` waives the team's lowest-`adjustedPlayerValue` player via the existing `waivePlayer` from `rosterMoves.js` until the roster is back in range. This is roster-size assistance, not a new salary-cap-dollar enforcement system (none exists today, and building one is out of scope — see Out of Scope).
- **`autoScout`** — each week's scout-point rollover (already ticking passively via `tickPassiveScouting`) also auto-spends `state.pointsAvailable` through `allocateScoutPoints`, prioritizing the user's own roster's lowest-confidence players first, then watchlisted prospects, then watchlisted opponents — instead of requiring the user to click through `ui/scouting.js`'s allocation UI.

## 3. Auto GM decision logic

New `autoGM.js` — a thin orchestration layer, not new AI. Every decision function it exports directly calls the exact same evaluator already driving AI teams (`freeAgency.js`, `tradeEvaluator.js`, `trade.js`, `draft.js`, `rosterMoves.js`, `scouting.js`). This keeps the user's automated team behaviorally identical to how every AI team already behaves — no separate "Auto GM personality" to design or tune.

```
autoGM.js
  autoResolveFreeAgencyForTeam(team, rng)   // §2 autoFreeAgency
  autoEnforceRosterSize(team)                // §2 autoCap
  autoAllocateScoutPoints(scoutingState, team, ownRosterIds, prospectIds, opponentIds) // §2 autoScout
  generateTradeOffer(team, rng)              // §5, used by both autoTrade and the manual "Trade Offers" inbox
```

## 4. Manual Draft UI (new)

New `ui/draftPicker.js`. When the draft reaches the user's slot in `runDraft`'s loop and `automation.autoDraft` is false:
- `seasonTransition.js`'s `runOffseasonThroughDraft` needs a callback hook (`onUserPick`) mirroring the existing `onDayComplete` pattern from `league.js`: when the current pick's `teamId === userTeamId` and auto-draft is off, it pauses the loop, invokes the UI to render the remaining `available` prospect pool (sorted by overall, using `getRevealedView`/scouting confidence from Phase 5 for the fuzzy/hidden display), and resumes `runDraft` with the user's chosen prospect once picked — otherwise it falls through to `selectAIPick` immediately, exactly as it does for every other team today.
- Concretely: `runDraft` gets a new optional `pickResolver(teamId, available)` param that defaults to `selectAIPick` (so existing callers/tests are unaffected); `seasonTransition.js` passes a resolver that either returns a Promise the UI resolves on user click (when it's the user's pick and auto-draft is off) or calls `selectAIPick` synchronously otherwise. `runDraft` becomes `async`; its two existing call sites (`seasonTransition.js`, and test code) are updated to `await` it.
- Draft results render exactly as today (`ui/draft.js`'s `renderDraftResults`) once the full draft (all 60 picks) completes.

## 5. Trade Offer Generation (new, backs `autoTrade`)

New function `autoGM.js`'s `generateTradeOffer(team, rng)`, plus a small **Trade Offers** inbox surfaced in GM/Commissioner mode regardless of the `autoTrade` toggle (a real "another team wants to talk trade" feature, not automation-only):

1. Find a candidate outgoing player: among `team`'s roster, the one with the lowest `adjustedPlayerValue(p, team)` relative to `needMultiplier` at their position (i.e. a position of surplus for this team) — skip if the team has no surplus position (roster too thin everywhere, no trade generated this week).
2. Try every other team as a partner, in `rng`-shuffled order, stopping at the first match: within that partner's roster, find a player at a position where `team` (the generator's team) is thin (`needMultiplier(position, team) >= 1.15`) whose salary satisfies the existing `salaryOk` band from `evaluateTeamLeg` (`salaryIncrease <= outgoingSalary * 0.25 + 2000000`) relative to the candidate outgoing player.
3. Build a 2-team, 1-for-1 proposal (no draft picks — keeps the generator tractable) and evaluate it through `evaluateTrade`, but with a new `evaluateUserLeg` param: when `true`, the user's own leg runs through `evaluateTeamLeg` exactly like any AI team's leg instead of the current hard-coded `isUser: true` bypass. `evaluateTrade(proposal, userTeamId, evaluateUserLeg)` — existing callers (Trade Center) pass `false`/omit it, preserving today's "the user always controls their own accept/reject" behavior.
4. If both legs evaluate as accepted: with `autoTrade` on, auto-execute via `executeTrade` and log to the feed. With `autoTrade` off (GM/Commissioner manual play), surface it in the Trade Offers inbox instead for the user to accept/decline by hand (accept calls `executeTrade` directly since it's already evaluated; decline discards it).
5. Runs once per simulated week (piggybacking on the existing `currentWeek(dayIndex)` rollover check already used by scouting) via a new `onDayComplete` consumer in `script.js`'s day-tick handling, gated to GM/Commissioner mode only (no trade generation needed in Spectator — every team there already trades exactly this way via the same generator applied to itself, but nothing needs to surface in an inbox no one reads).

## 6. Expanded Sim Controls

New buttons/logic in `ui/simControls.js` (existing Next Game/Next Day/Sim to End of Season/speed selector unchanged):

- **Sim to Trade Deadline** — a new marker at `Math.round(lastDay * 0.65)` (65% through the season's day range, computed the same way `handleSimToEnd` already computes `lastDay`). Informational stop only — no trade lockout mechanic is added (none exists today; inventing one is out of scope).
- **Sim to Draft** / **Sim to Free Agency** — macros: run to end of regular season, generate the playoff bracket if needed, run every remaining playoff game, then run `runOffseasonThroughDraft` (stopping right after for "Sim to Draft", or additionally opening the Free Agency view for "Sim to Free Agency"). Note: "Sim to Lottery" from the roadmap isn't a separately-stoppable moment in this architecture — the lottery computes instantly inside `runOffseasonThroughDraft` — so it's folded into "Sim to Draft."
- **Sim N Seasons** (numeric input) / **Sim Until Championship** / **Sim Custom** (numeric day count) — a new `runMultiSeason(targetSeasons | untilChampionship | customDays)` loop that repeats: finish current season + playoffs → offseason-through-draft → free agency → new season, always auto-driving every offseason stage transition (per your answer — bulk multi-season controls always auto-advance regardless of individual toggle state, using each toggle's *current* setting for what happens inside each stage: `autoFreeAgency`/`autoDraft` on means AI decides those stages even mid-multi-season-run; off still means the AI decides them too *for this bulk run only*, since there's no way to pause a 10-season loop for manual input at every draft — the toggle only gates whether *single-season* play requires the manual UI). Stops early on: reaching the target season count (Sim N Seasons) / a championship for `userTeamId` (Sim Until Championship) / the target day count (Sim Custom) / any checked pause-on-event (§7). "Sim Until Championship" additionally hard-stops after 15 simulated seasons regardless, to prevent an accidental unbounded loop if the user's team is simply never going to win one.
- Single-season controls (Next Day/Game/Sim to End of Season) are unchanged — they still stop at the offseason boundary and require the existing "Advance to Offseason" / "Go to Free Agency" / "Start New Season" buttons, exactly as today.

## 7. Live Feed

New `ui/liveFeed.js` rendering `GameState.feed` (array of `{ day, leagueYear, text }`, capped at the 200 most recent entries via `.shift()` when exceeded). Feed view added to `BUILT_VIEWS` and `NAV_ITEMS`. Entries pushed from:
- `league.js`'s existing `onDayComplete` hook — one entry per day summarizing that day's games (`"Monarchs 112, Harbormen 108"`) for games involving the user's team (GM/Commissioner) or all games (Spectator, capped to a "N games played" summary line per day to avoid flooding 15 games/day into the feed).
- `trade.js`'s `executeTrade` — one entry per executed trade.
- `freeAgency.js`'s `signPlayer` / `freeAgencyBidding.js`'s `finalizeBidding` — one entry per signing.
- `draft.js`'s `runDraft` (per pick) — one entry per pick.
- `injuries.js`'s `rollInjury` — one entry when a player on the user's team (GM/Commissioner) or any notable player (overall ≥ 80, Spectator) gets hurt.

Each hook site takes an optional `feedSink` callback param (defaulting to a no-op) rather than importing `script.js`'s `GameState` directly, keeping these modules free of a hard dependency on app-shell state — `script.js` wires `function (text) { GameState.feed.push({ day: ..., leagueYear: ..., text: text }); if (GameState.feed.length > 200) GameState.feed.shift(); }` in at each call site.

## 8. Pause-on-Event

`GameState.settings.pauseOn = { madePlayoffs: false, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: false }`, checkboxes in Settings (meaningless/hidden in Spectator — no user team to pause for). Checked once per day-tick and once per season-boundary inside `runMultiSeason` (§6):
- `madePlayoffs` / `missedPlayoffs` — checked once, at the moment the playoff bracket is generated for the season.
- `tradeOfferReceived` — checked whenever `generateTradeOffer` (§5) produces an offer for the user's team.
- `keyInjury` — checked whenever `rollInjury` injures a player on the user's team with `overall >= 80`.

Any checked-and-triggered event stops `runMultiSeason` (or the day-by-day bulk sim) after that day/season completes, same "stop early, leave the user in control" behavior as `handleSimToEnd`'s current gating on `isRegularSeasonAndPlayoffsComplete()`.

## 9. Commissioner Sandbox Tools

New `commissioner.js` (logic) + `ui/commissioner.js` (view), added to `BUILT_VIEWS`/`NAV_ITEMS` but only rendered/linked when `GameState.playMode === 'commissioner'`.

- **Edit player**: pick any player, adjust `overall`/`potential`/individual attributes directly, bounded by `data.js`'s existing `RATING_MIN`/`RATING_MAX`.
- **Force trade**: reuses the Trade Center's proposal-building UI, but its "Propose Trade" button calls a new `commissioner.js`'s `forceTrade(proposal)` — which calls `executeTrade(proposal)` directly, skipping `evaluateTrade` entirely (no value/salary/roster-size checks — Commissioner sandbox is explicitly consequence-free).
- **Create player**: form (name, position, age, overall, potential) → builds a full player record via the same shape Phase 1's schema defines, hidden traits/personality/tendencies generated the normal procedural way via `ensureHiddenPlayerData`, pushed to `PLAYERS_2026` as a free agent (or directly onto a chosen team if a roster spot is picked).
- **Delete player**: removes a player from `PLAYERS_2026` entirely (same mechanism `runOffseasonThroughDraft` already uses for retirees — `splice` by index).
- **Disable cap**: `GameState.settings.capDisabled` (boolean). Existing cap-check sites get a guard: `freeAgency.js`'s `generateAIOffer`'s `capSpace < 1200000` check, `trade.js`'s `evaluateTeamLeg`'s `salaryOk` check, and the bidding panel's implicit reliance on `capSpace` — each short-circuits to "always OK" when `capDisabled` is true. Small, targeted guards at existing checkpoints, not a parallel code path.
- **Expansion team (simplified)**: form (name, city, primary/secondary color, market size 1–100) → `commissioner.js`'s `createExpansionTeam(details, rng)`:
  1. Appends a new team object to `TEAMS` (fresh id, `record: {0,0,0,0}`, `prestige: 40` starting value, `timeline: 'rebuilding'`, empty `draftPicks` for the following year same shape as any team).
  2. Runs a simplified expansion draft: every existing team "protects" its top 8 players by `overall` (auto, not user-chosen — keeps this a one-click action); the expansion team then drafts one unprotected player from each of the other teams in turn (round-robin, `rng`-shuffled team order), selected via the same `adjustedPlayerValue` used everywhere else, until its roster reaches 14 players.
  3. Takes effect starting the *next* `generateNewSeason()` call — schedule generation already reads from `TEAMS` fresh each time, so a new team entering that array is picked up automatically; **not** applied retroactively to a schedule already in progress (regenerating a live mid-season schedule is out of scope and would be jarring).

## New Files

- `autoGM.js` — §3.
- `ui/draftPicker.js` — §4.
- `ui/liveFeed.js` — §7.
- `commissioner.js` — §9 logic (edit/create/delete player, disable-cap guard helper, `createExpansionTeam`).
- `ui/commissioner.js` — §9 view.

## Existing Files Touched

- `script.js` — `GameState.playMode`, `GameState.automation`, `GameState.feed`; mode-switch handling; feed-sink wiring passed into hook sites; `runMultiSeason` orchestration; `onUserPick`/draft resolver wiring.
- `ui/teamSelect.js` — mode picker + Spectate League button.
- `ui/settings.js` — Play Mode section, automation toggles, pause-on-event checkboxes.
- `ui/simControls.js` — new sim-to-X buttons and multi-season controls (§6).
- `ui/nav.js` — Live Feed and Commissioner nav entries (Commissioner conditional on play mode).
- `ui/tradeCenter.js` — Trade Offers inbox section; `handlePropose` passes `evaluateUserLeg: false` explicitly (documents the existing behavior is intentional, not accidental).
- `trade.js` — `evaluateTrade(proposal, userTeamId, evaluateUserLeg)` new optional param.
- `draft.js` — `runDraft` becomes `async`, accepts optional `pickResolver` param.
- `seasonTransition.js` — `runOffseasonThroughDraft` passes a resolver to `runDraft`, becomes `async`; its one call site in `script.js`'s `handleAdvanceToOffseason` is updated to `await` it.
- `freeAgency.js` — `capDisabled` guard in `generateAIOffer`.
- `tradeEvaluator.js` — `capDisabled` guard in `evaluateTeamLeg`'s salary check.
- `league.js` — `onDayComplete` hook gains feed-sink and pause-on-event consumers (additive, existing `tickScoutingForDay` consumer unaffected).
- `injuries.js`, `freeAgency.js`/`freeAgencyBidding.js`, `trade.js`'s `executeTrade`, `draft.js`'s `runDraft` — optional `feedSink` param at each (§7).
- `index.html` — new script tags for all new files.

## Out of Scope for Phase 7

- A real salary-cap-dollar enforcement engine (exceptions, tax aprons, etc.) — `autoCap` stays scoped to the existing 12–15 roster-size band.
- Multi-team (3+) or pick-inclusive auto-generated trade offers — the generator (§5) is 2-team, player-for-player only. The existing manual Trade Center already supports arbitrarily complex multi-team, pick-inclusive deals for anyone who wants to build one by hand.
- User-directed player protection lists for expansion drafts (protection is automatic: top 8 by overall).
- Retroactive/mid-season schedule regeneration for a newly created expansion team.
- Auto lineups, auto injuries-management, auto training, auto G League — no underlying mechanic exists; noted as deferred/future scope in the roadmap.
