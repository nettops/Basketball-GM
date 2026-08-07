# Live Game Sim (Tier 0 + Timeouts & Substitutions) — Design

**Date:** 2026-08-06
**Status:** Approved

## Summary

Convert the possession engine from a batch function into a steppable state
machine, give it a real on-court five with rotations and a real game clock,
and let the user call timeouts and make substitutions while watching. A
shared auto-coach makes those same decisions for every team in every game,
so watching never confers a free advantage. The possession engine becomes
the league default.

This is the foundation that turns the pixel game view from a replay you
watch into a game you coach.

## Design principles

These come from the project owner and constrain every decision below:

1. **It must be fun**, not merely accurate.
2. **It should bring players back** for future sessions.
3. **Minimize micromanagement.** Agency is an opportunity, never an
   obligation. A user must be able to watch a full game hands-off.

## Motivating analysis

The four pixel view modules total 2,039 lines (2,436 with their tests); the
possession engine feeding them is 348. The choreographer already consumes
all seven event types the engine emits — there is nothing left to extract.
Further improvement to what is on screen is blocked by what the engine knows.

Three specific gaps, verified in the code:

- **No on-court five.** `eligibleRoster()` returns the whole healthy roster
  and every possession weight-picks from all ~15 players. Minutes are
  distributed separately by `distributeInt(240, …)` and never interact with
  possessions, so minutes are a post-hoc label and the 13th man can shoot on
  any possession. The view papers over this by fielding the five most-used
  players and swapping a sprite in when an event names someone else.
- **No game state.** Quarters are index slices of a fixed 90 possessions.
  There is no clock, so no end-of-quarter or end-of-game situations exist.
- **No agency.** The current watch flow sims the whole game before playback
  begins, so no decision can affect anything.

## Architecture

### `GameSim` — an explicit state machine

```js
createGameSim(homeTeamId, awayTeamId, rng, opts) → sim

sim.step()             // advance ONE possession; returns that possession's events
sim.done               // true when regulation/OT is complete and not tied
sim.applyDecision(d)   // queue a timeout or substitution; takes effect at the
                       // next possession boundary, never mid-possession
sim.result()           // { homeScore, awayScore, boxScore, playByPlay, events }
```

`simulatePossessionGame` is reimplemented as:

```js
function simulatePossessionGame(homeTeamId, awayTeamId, rng, opts) {
  const sim = createGameSim(homeTeamId, awayTeamId, rng, opts);
  while (!sim.done) sim.step();
  return sim.result();
}
```

**One code path.** Watched and unwatched games run identical math; the only
difference is who supplies decisions and whether anything renders between
steps. This is what makes the fairness guarantee real rather than
aspirational.

Alternatives rejected:

- **Generator/coroutine.** Less restructuring, but generator state cannot be
  inspected or driven step-wise from a Node test, and cannot be serialized.
- **Re-sim on decision.** Sim the whole game, then re-sim from possession N
  when the user decides. Rejected: it would retroactively change possessions
  the user already watched.

### Live stepping stays on the main thread

`simWorker.js` exchanges one whole game per `postMessage` round trip, which
suits batch simming and not per-possession stepping. Only the single watched
game steps live, on the main thread, so the worker path is unchanged.

## Components

### On-court five and rotations (engine)

`sim.onCourt = { home: [5 playerIds], away: [5 playerIds] }`. Possessions
draw **only** from these five. Substitutions are evaluated between
possessions.

Minutes become emergent — accumulated from time actually spent on court.
`simulateTeamMinutes` and its `distributeInt(240, …)` distribution are
deleted; box-score `minutes` is now a real measurement.

Starters are the five highest-rated healthy players by the existing
`minutesWeight` ordering, preserving current behaviour's intent.

### Game clock and overtime (engine)

Each possession consumes variable time: a 14s base with ±6s variance,
halved on fast breaks, and the clock is not advanced by the free-throw
portion of a shooting foul. Quarters run until their clock expires rather
than slicing a fixed possession count, so end-of-quarter and end-of-game
situations exist for later tiers to use.

At 14s per possession a 12-minute (720s) quarter holds ~51 possessions
shared between both teams — about 26 each per quarter, so **~103 per team
per game**. That is close to real NBA pace but ~14% above the current fixed
90, which would inflate scoring by roughly the same margin.

Implementation must check the resulting scoring against
`validate-possession.js`'s existing range assertions and retune the base
possession length upward if totals drift high. Getting this wrong silently
re-scales every score in the league, so it is a required verification step,
not a nice-to-have.

Regulation is 4 × 12 minutes. **A tie after Q4 plays real 5-minute overtime
periods**, replacing the current tiebreak that awards a phantom point to
whichever team had more field goals.

### `coach.js` — shared decision-maker (new module)

```js
decideSubstitutions(sim, team) → [{ out: playerId, in: playerId }]
decideTimeout(sim, team)       → boolean
```

Used automatically by every team in every game, watched or not.

Substitution triggers, with concrete starting values (tunable during
implementation, but specified here so the behaviour is unambiguous):

| Trigger | Condition | Action |
|---|---|---|
| Fatigue | on-court energy < 0.55 and a bench player is > 0.15 fresher | swap |
| Foul trouble | 4+ fouls before the 4th quarter | rest until Q4 |
| Foul out | 6 fouls | hard bench, permanent |
| Garbage time | margin > 20 with < 5 game-minutes left | bench the top 3 by rating |
| Minutes target | projected minutes exceed rating-derived target by 10% | rest |

Timeout trigger: the opponent's active run is 8+ points and the team has
timeouts remaining and has not called one in the last 90 game-seconds.

### Scoring-run tracker (engine)

Points scored by one team since the other last scored. Deliberately far
short of the full momentum model in Tier 2 — it exists to drive coach
timeout logic and user-facing nudges, nothing more.

### Timeouts

Seven per team per game. Effect: restores +0.12 energy (capped at 1.0) to
each on-court player, clears the opponent's active run counter, and opens a
substitution opportunity. Consumes no game clock — the pause is
represented by the energy and run effects, not by advancing time.

### Nudges and user decisions (view)

The coach runs the entire game by default; a user can watch tip-to-final
without touching anything. At high-leverage moments the view shows a
**non-blocking** nudge card (e.g. "Heat on a 12–0 run — timeout?").
Playback never pauses. Ignoring a nudge lets it expire and the coach decides
as it otherwise would.

Substitutions are available on demand through a roster panel, not prompted.
User decisions are queued via `sim.applyDecision` and land at the next
possession boundary.

### Incremental playback (view + choreographer)

Playback changes from "sim whole game → build timeline → play" to "step →
append events → choreograph that possession → play".

`buildTimeline`'s current whole-game passes all decompose per possession:

- Shot clock is already computed from per-possession bounds.
- Line score accumulates at quarter boundaries.
- Stat snapshots already accumulate incrementally.

The choreographer gains an incremental entry point; `buildTimeline` is
retained for replaying a completed game from its stored event log.

### File split

`ui/pixelGameView.js` is 982 lines carrying playback, audio synthesis,
canvas rendering, effects, DOM chrome, and replay history. This project
touches nearly all of it, so it splits along those seams:

- `ui/pixelAudio.js` — WebAudio graph, crowd bed, sfx synthesis
- `ui/pixelHud.js` — scoreboard, info strip, commentary feed, post-game card
- `ui/pixelGameView.js` — playback loop, motion model, sim driving

## Data flow

```
Watched game:   view ──step()──> GameSim ──events──> choreographer ──keyframes──> canvas
                  ^                  |
                  └─applyDecision────┘        coach fills in anything the user doesn't decide

Unwatched game: league.js ─> simulatePossessionGame ─> while(!done) step()  [coach decides everything]
```

## Engine default

`simEngine.getActiveEngine` defaults to `possession` instead of `boxscore`,
so the whole league runs under the same rules the user watches.

Measured cost: 1.76ms/game vs 0.06ms/game, i.e. **2.2s for a 1,230-game
season** (vs 0.07s). A 15-season fast-forward goes from ~1s to ~33s; the
existing opt-in `useWorkerSim` path absorbs it. `boxscore` remains
implemented and selectable in settings.

## Error handling and edge cases

- **Exiting mid-game.** The remaining possessions are stepped to completion
  under the coach before returning to the league, so no half-played game is
  ever recorded.
- **Fewer than five healthy players.** Falls back to the full roster exactly
  as `eligibleRoster` does today.
- **Foul-outs exhausting the bench.** If no eligible substitute exists, the
  fouled-out player stays on rather than fielding four.
- **Decisions applied after the game ends** are ignored.
- **Timeouts exhausted** — the control disables and the coach stops
  considering them.

## Testing

Node tests under `scripts/`, following the existing `validate-*.js` pattern:

- Batch loop (`while (!sim.done) sim.step()`) produces a complete, valid game.
- Exactly five players per team are on court at every possession.
- Accumulated minutes total ~240 per team per regulation game.
- The clock is monotonic within a quarter and never negative.
- A tie at the end of regulation produces overtime, and the final is never tied.
- The coach benches a player at 6 fouls, and rests players below the energy
  threshold.
- A timeout restores energy and clears the run counter.
- Same seed + same decision sequence reproduces an identical result.
- Same seed + different decisions produces a different result (proving
  agency is real, not cosmetic).

## Suggested phasing

This is a large project for one spec. It decomposes into four stages that
each leave the game working and testable, and the implementation plan should
follow them in order:

1. **`GameSim` state machine.** Restructure only — `simulatePossessionGame`
   becomes a loop over `step()`. No behaviour change; existing tests must
   still pass unmodified. This is the riskiest change and the easiest to
   verify, so it goes first and alone.
2. **On-court five, rotations, clock, overtime.** Real basketball structure.
   Scoring is re-verified here against the pace note above.
3. **Coach module and engine default switch.** Every team in every game now
   makes decisions; the league moves to the possession engine.
4. **User agency and incremental playback.** Timeouts, substitutions,
   nudges, live stepping from the view, and the `pixelGameView.js` split.

Stages 1–3 are engine work verifiable entirely in Node. Only stage 4
requires browser verification.

## Out of scope

Deferred to later tiers, explicitly not part of this project:

- Defensive schemes, matchup assignments, play calling, clutch decisions
- Play types (pick-and-roll, iso, post-up, off-ball screens)
- The full momentum model, hot/cold streaks
- Mid-game save/resume of an in-progress game
- Instant replay, highlight reels, commentary booth changes
