# Phase 6 — Save/Load: Design

**Status:** Approved. Governs Phase 6 of the roadmap (`2026-07-31-nba-gm-simulator-roadmap.md`).

## Goal

`localStorage` persistence with 5 named manual save slots plus one autosave slot, a dedicated Save/Load view, and a "Load Game" entry point from the team-select screen — so a long-running dynasty (potentially spanning many simulated seasons) is never at risk of being lost, and multiple concurrent playthroughs can coexist.

## 1. Exact RNG Resume

`rng.js`'s `makeRng` returns a plain callable function today; every caller across the codebase (~15+ files) invokes it as `rng()`. Changing that calling convention is out of scope — instead, `makeRng` attaches `getState()`/`setState()` methods directly onto the returned function object:

```js
function makeRng(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.getState = function () { return a; };
  fn.setState = function (state) { a = state; };
  return fn;
}
```

Every existing call site (`rng()`) is unaffected. `save.js` captures `GameState.rng.getState()` into the save payload, and on load creates `GameState.rng = makeRng(0)` then calls `.setState(savedState)` — resuming the exact point in the sequence. Everything already generated before a save (players, current season's results, the current draft class) is preserved as-is regardless; this only matters for *future* randomness (next games, next injuries, next procedural draft class), which is now bit-for-bit identical to what it would have been without the save/load round-trip.

## 2. What Gets Serialized

**Included in every save payload:**
- `version` — save format version (starts at `1`; no migration logic yet, just a safety net for future hardening)
- `savedAt` — timestamp
- `name` — user-provided save name
- `players` — full contents of `PLAYERS_2026` (every player currently in the league, with attributes, hidden traits/personality/tendencies, contract, status, season stats)
- `teams` — every team's mutable fields (record, chemistry, fanHappiness, ownerHappiness, prestige, marketSize, timeline, draftPicks) keyed by team id
- `season` — `{ games, currentDay }`, where each game entry drops `boxScore` (see size rationale below) but keeps `played`/`homeScore`/`awayScore`/`day`/`isPlayoff`/`seriesId`
- `playoffBracket` — as-is (small, no box scores embedded there either — confirmed by reading `playoffs.js`)
- `upcomingDraftClass` — the full prospect array (only meaningful to save for year 2+, where it's freshly procedurally generated and has no other source of truth; for year 1 this is just `DRAFT_PROSPECTS_2026`, cheap to include either way)
- `lastDraftResults` — stored as `{ teamId, playerId, pickNumber, round }` (an id reference, not the full prospect object — the object is already fully present in `players` post-draft, so this avoids duplicating ~60 player records)
- `scouting` — `GameState.scouting` as-is (small: a confidence/watchlist map keyed by player id)
- `userTeamId`, `currentView`, `leagueYear`, `offseasonStage`, `settings`
- `rngState` — `GameState.rng.getState()`

**Excluded / not serialized:**
- `game.boxScore` for every game in `season.games` — measured at ~700KB per save *without* box scores; a fully-played season *with* box scores for every game would run several MB (~6-7MB) per slot, risking the 5-10MB/origin `localStorage` quota across 6 slots. Season/career stat averages are unaffected (already accumulated separately per-player via `accumulateSeasonStats`); only "view an old game's individual box score after a save/load round-trip" is lost.
- `DRAFT_PROSPECTS_2026` — static hardcoded data, deterministically re-populated by `ensureHiddenPlayerData` on every load exactly as it already is on every fresh game start. Never needs saving.
- `pendingScoutReportId` — purely transient UI navigation state, meaningless across a reload.

## 3. Storage Scheme

- `localStorage` keys: `nba-gm-save-1` through `nba-gm-save-5` (manual slots), `nba-gm-save-autosave` (the single autosave slot).
- `nba-gm-save-index` — a separate lightweight JSON array (`[{ slotId, name, teamId, teamName, leagueYear, day, wins, losses, savedAt }, ...]`) updated on every save/delete, so the Save/Load view can render the slot list without parsing up to 6 full ~700KB payloads.
- Every `localStorage.setItem` call for a save is wrapped in `try/catch` — a `QuotaExceededError` surfaces as a user-facing message ("Save failed: storage is full. Delete an old save and try again.") rather than crashing.

## 4. Autosave

Fires once per **user-triggered sim action** (the `Next Game`/`Next Day`/`Sim to End of ...` button handlers in `ui/simControls.js`) and once at the end of each offseason stage transition (`handleAdvanceToOffseason`, "Go to Free Agency", `handleAdvanceToNewSeason`) — never once per individual simulated day inside a bulk multi-day sim, which would mean ~170 synchronous ~700KB writes during a single "Sim to End of Season" click and visibly freeze the UI. This still guarantees you never lose more than one user action's worth of progress, without the performance cost.

## 5. Restoring State

`PLAYERS_2026` and `TEAMS` are shared array/object references held by many modules (`league.js`'s `getTeamRoster`, `getTeamById`, etc.) — load must mutate their existing contents in place, not reassign the `const` bindings:
- `TEAMS`: fixed set of 30 team objects that never get added/removed — restore is a field-by-field copy onto each existing team object (matched by id), preserving object identity for anything already holding a reference.
- `PLAYERS_2026`: grows/shrinks over a save's lifetime (draft picks added, retirements removed) — restore clears the array (`.length = 0`) and pushes fresh copies of every saved player. No code holds a long-lived reference to an individual player object across a load boundary (the currently-rendered view is always fully re-rendered after loading).
- `lastDraftResults`'s `{ teamId, playerId, pickNumber, round }` entries are rehydrated back into `{ teamId, prospect, pickNumber, round }` via `getPlayerById(playerId)` against the just-restored `PLAYERS_2026`, matching the shape `ui/draft.js`'s `renderDraftResults` already expects.

## 6. New Files

- `save.js` — `SAVE_SLOT_COUNT` (5), key-scheme constants, `serializeGameState()`, `applySavedState(payload)`, `saveToSlot(slotId, name)`, `loadFromSlot(slotId)`, `deleteSlot(slotId)`, `listSaves()`, `autosave()`.
- `ui/saveLoad.js` — `renderSaveLoad(container)` for the dedicated nav view (all 5 manual slots + autosave slot, each showing name/team/date/season-day when filled, with Save/Load/Delete/Overwrite actions) and a shared `renderSaveList(container, onLoad)` helper reused by the team-select screen's "Load Game" section.

## 7. Existing Files Touched

- `rng.js` — `getState`/`setState` on the returned function (§1).
- `ui/teamSelect.js` — adds a "Load Game" section above/below the team grid, using `ui/saveLoad.js`'s shared list-rendering helper; loading jumps straight to the dashboard (bypassing `initSeason()`, since state comes entirely from the save).
- `ui/simControls.js` — `autosave()` call at the end of each button handler.
- `script.js` — new `loadGame(slotId)` function (parallels `selectTeam` but applies a save instead of generating a fresh season); `BUILT_VIEWS.saveload`; autosave calls in the three offseason-transition handlers.
- `ui/nav.js` — new "Save/Load" nav entry.
- `index.html` — `save.js`/`ui/saveLoad.js` script tags.

## Out of Scope for Phase 6

- Save file export/import (downloading a save as a file, or importing one) — everything stays in `localStorage` for this phase.
- Cloud sync / cross-device saves.
- Any migration logic for `version` beyond the field existing as a placeholder.
