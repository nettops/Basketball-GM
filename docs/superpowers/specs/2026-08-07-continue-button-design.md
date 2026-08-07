# Continue — One Advance Control — Design

**Date:** 2026-08-07
**Status:** Approved

## Summary

Replace the sim dock's ten time-advance controls with three: **Continue**, **Watch Next Game**, and a single **Skip to…** menu. Underneath, retire the two divergent advance loops in favour of one day-granular runner that can stop for a reason, be interrupted at any moment, and be tested in isolation.

## Design principles

From the project owner, and the reason this project exists:

1. **It must be fun**, not merely accurate.
2. **It should bring players back** for future sessions.
3. **Minimise micromanagement.** Agency is an opportunity, never an obligation.

Continue serves the third directly: today the player must decide *how far to skip* before every advance, which is itself a micro-decision, repeated constantly.

## Motivating analysis

The dock currently carries ten time controls — `sim-next-game`, `sim-watch-game`, `sim-next-day`, `sim-to-end`, `sim-to-deadline`, `sim-to-draft`, `sim-to-fa`, `sim-n-seasons-btn`, `sim-until-championship`, `sim-n-days-btn` — plus two number inputs. (`sim-undo-btn` / `sim-redo-btn` are not time controls and are out of scope.) None of them is the one that matters: *advance until something actually needs me.*

Three specific problems, verified in the code:

- **A stop system exists but barely works.** `GameState.pauseRequested` and `settings.pauseOn` (`madePlayoffs`, `missedPlayoffs`, `tradeOfferReceived`, `keyInjury`) are honoured **only** by `runMultiSeason`, and only *between whole seasons* — `simulateThroughDate` is handed a target of `lastDay`, so a key injury on day 12 does not stop anything until the season ends.
- **Runs cannot be interrupted.** `runWithDelay` and `runMultiSeason` only `await` when `delayMs > 0`. At `ultra` speed the loop never yields, so the tab is frozen and no Stop button could be clicked.
- **Two independent advance loops.** `runWithDelay` (single step) and `runMultiSeason` (fast-forward) have different stopping rules, which is why the ten controls behave inconsistently.

## Architecture

Policy and mechanism split, following the existing `league.js` / `ui/` division.

### `simRunner.js` — pure policy (new, root)

Node-testable, dual require/global module pattern, no DOM and no promises.

```js
evaluateStop(gameState, dayIndex, context) → { reason, label } | null
STOP_REASONS                       // the reason constants below
```

`context` carries the two things that are *not* derivable from league state:
`{ target }` — the Skip-to destination, if any — and `{ userStopRequested }`.
Passing them in rather than reading them from globals is what keeps this
function pure and exhaustively testable: every row in the table below becomes
a case with an explicit input.

### `ui/simControls.js` — the single loop

`runAdvance(opts)` replaces **both** `runWithDelay` and `runMultiSeason`. Each iteration:

1. Evaluate stop conditions. If any fires, halt — **before** anything is simulated.
2. Step once: one day in the regular season, one game in the playoffs.
3. Yield to the browser.
4. Repeat.

Stepping one day at a time (rather than handing `simulateThroughDate` a distant target) is what makes per-day stopping possible at all.

The loop **always** yields, including at `ultra` speed, where it yields a zero-delay macrotask. No slower in practice, and the Stop button stays live.

Continue and every Skip-to target are the same loop with a different stop predicate. One code path, one set of rules.

## Stop conditions

Evaluated **before** each step, so nothing is simulated past the stop:

| Reason | Condition |
|---|---|
| `userStop` | Stop was pressed. Outranks everything. |
| `draftReady` | Draft stage reached and `automation.autoDraft` is off |
| `freeAgencyReady` | Free-agency stage reached and `automation.autoFreeAgency` is off |
| `seasonComplete` | Regular season finished |
| `playoffsComplete` | Champion crowned |
| `targetReached` | The chosen Skip-to destination |

Evaluated **after** each step, via the existing `pauseRequested` flag set in `handleDayComplete`: key injury, and making or missing the playoffs.

### `pauseRequested` needs to carry a reason

Today it is a bare boolean, set in four places with no record of why. The status line below promises `Stopped: Jayson Tatum injured`, which that cannot support. A parallel `GameState.pauseReason` (a short human-readable string, cleared whenever `pauseRequested` is cleared) must be set at each of those four sites. Without it the stop is silent and the player is left to work out for themselves why the game stopped — which is exactly the kind of small mystery that makes an interface feel arbitrary.

### `pauseOn` defaults change

All four currently default to `false`, which would make notable-event stopping inert out of the box.

| Flag | New default | Why |
|---|---|---|
| `madePlayoffs` | **on** | Once a season; the game telling you something |
| `missedPlayoffs` | **on** | Once a season |
| `keyInjury` | **on** | Rare, and materially changes your plans |
| `tradeOfferReceived` | **off** | Offers generate *weekly* — this would stop Continue ~26 times a season. Offers now expire with a visible countdown, so the inbox no longer needs to interrupt to be noticed. |

Existing saves keep their stored `pauseOn` values; this changes new games only.

## Stopping to watch

The requirement is that games sim automatically, but the player can stop at any moment to watch one.

Because stop conditions are evaluated *before* each step, pressing Stop always leaves the next day unplayed. That ordering is the whole mechanism — stopping after a step would mean the game the player wanted to see had already been decided.

- While running, **Continue** becomes **Stop**.
- Stop halts the loop and returns the dock to rest. It does **not** prompt.
- **Watch Next Game** is then simply available. If the next game is several days out, the existing `watchGameOnDay` already sims the intervening days and opens on the user's game — no new machinery.

Context lives in a status line rather than a dialog: `Day 34 · Next game: vs MIA in 2 days`, and when relevant `Stopped: Jayson Tatum injured`.

## The dock

Three time controls. `sim-speed` stays (it governs how fast Continue runs); Undo/Redo stay.

1. **Continue** — primary, and stage-aware. At a boundary the label states the destination: `Continue → Playoffs`, `Continue → Offseason`, `Continue → Next Season`. This absorbs the three ceremonial offseason clicks (*Advance to Offseason → Go to Free Agency → Start New Season*) into the same button.
2. **Watch Next Game** — behaviour unchanged.
3. **Skip to…** — a select plus Go: Trade Deadline, Draft, Free Agency, End of Regular Season, End of Playoffs, Until Title. The two quantity-taking targets (Seasons, Days) reveal a number input only when selected, so at most three elements are visible at once. Already-passed targets are disabled, as today.

Every Skip-to entry runs through the same loop, with the target as an *additional* stop predicate — so a skip still halts early for an unautomated draft or a key injury rather than blowing past it.

## Edge cases

- **Playoffs do not advance days.** `season.currentDay` stops moving once a bracket exists; the postseason advances through `simulateNextPlayoffGame`. The loop has two step modes behind one interface — step-a-day and step-a-game — with stop conditions evaluated identically in both.
- **A live watched game is pending.** Continue and Skip-to are disabled. Without this the dock would sim days out from under a game still on screen. This sits alongside the existing leave-confirm, which handles navigation.
- **No game remains.** Watch Next Game disables.
- **A step throws.** The loop halts and surfaces the error rather than spinning.
- **The user navigates away mid-run.** The run continues — it is league state, not view state — and the status line reflects it on return.

## The real risk: season rollover

`runMultiSeason` contains its own season-rollover implementation, and the code comments explicitly note it runs *alongside* `handleAdvanceToOffseason` as a second independent path. Retiring `runMultiSeason` means those two must become one.

That consolidation, not the button, is where this project can break a league. It is the reason the plan must characterization-test rollover rather than eyeball it.

## Testing

- **`scripts/validate-simRunner.js`** — `evaluateStop` in isolation: the correct reason for each state; priority ordering (`userStop` outranks all); `draftReady` only when `autoDraft` is off; each Skip-to target; and `null` when nothing applies. Because `target` and `userStopRequested` arrive through `context`, every one of these is a plain input/output case with no globals to arrange.
- **`pauseReason` coverage** — each of the four sites that sets `pauseRequested` also sets a non-empty reason, and clearing one clears the other.
- **Rollover characterization** — capture league state after a three-season fast-forward on the current code, then assert the consolidated path reproduces it exactly. Same technique as `scripts/fixtures/gamesim-golden.json`, which caught every unintended change during the engine work.
- **Smoke group additions** — the dock exposes exactly three time controls and they are hit-testable; Continue is disabled while a live game is pending; Stop leaves the next day unplayed.

## Out of scope

- The wider UI simplification (25-item sidebar, dense topbar, app chrome remaining visible during a watched game). Parked at the owner's request.
- Automating coaching hires (`autoCoaching`), noted in the feature scan as the one chore with no opt-out.
- Serialising an in-progress watched game so it can be suspended and resumed.
- Any change to Undo/Redo.
