# Pixel Game View ("Watch Game") — Design

**Date:** 2026-08-06
**Status:** Approved

## Summary

A watchable 2D pixel-art rendition of the user's next game, in the style of
Hoop Land: a fixed full-court top-down view with upright front-facing pixel
sprites, a crowd strip, and a scoreboard overlay. A new **"Watch Next Game"**
button in the sim dock sims forward to the user's next game day as usual, but
the user's game runs through the possession engine with a structured event log
captured. A fullscreen pixel view then plays that log back as choreographed
sprite animation. The game result is official (recorded through the existing
`applyGameResult` path) the moment simming finishes; playback is pure theater
over real data.

## Visual style (from user-approved references)

- **Mixed perspective:** court drawn top-down (lines, paint, center logo
  readable from above); players are upright, front-facing pixel sprites
  standing "on" the court. No isometric projection.
- **Fixed full court:** the entire court fits in one frame, no camera
  movement — all 10 players always visible (Hoop Land framing, not the
  scrolling Full Court Heroes camera).
- **Chunky sprites** ~24px tall with identity cues: skin tone and hair color
  from the player's existing face data (`faces.js`), jersey in team
  primary/secondary colors with the player's real `jerseyNumber`, name label
  under the ball handler.
- **Atmosphere:** crowd strip across the top (randomized pixel people),
  scoreboard bar (team abbreviations, score, quarter, game clock), painted
  keys in home-team colors, center-court logo built from the team
  abbreviation lettering.
- Flat palette, hard pixel edges: canvas at a fixed logical resolution,
  integer-scaled with `image-rendering: pixelated`. No anti-aliasing, no
  image assets (procedural drawing only, matching the repo's zero-asset
  style).

## Architecture

Approach chosen: **pre-sim + animated replay of an event log** (Approach A of
three considered). The game is fully simmed instantly, producing a structured
event log; the renderer performs the log. Rejected alternatives: live-stepping
the engine (restructures working sim code for an imperceptible difference) and
cosmetic theater loosely synced to the box score (play-by-play would not match
reality).

Consequences:

- Sim correctness untouched — the official result is identical to a normal
  possession-engine sim.
- Engine and renderer are fully decoupled; the event log is the interface.
- Pause, speed, and skip-to-end are trivial since the outcome already exists.
- Closing the tab mid-watch can never corrupt state.
- Known caveat: score lines reach the Live Feed as soon as simming completes,
  so navigating away mid-watch can spoil the ending. The watch view is a
  fullscreen overlay precisely so this doesn't happen in normal use.

## Components

### Engine change: structured event capture (`simEnginePossession.js`)

An optional structured-event collector threaded through
`simulatePossession` / `simulatePossessionGame` alongside the existing text
`log` parameter — same pattern, richer records:

```js
{ type: 'shot' | 'turnover' | 'block' | 'rebound' | 'foul-ft',
  team: 'home' | 'away', playerId, defenderId, zone, made, points,
  assistPlayerId, quarter }
```

Constraints:

- No change to sim math or RNG consumption: a capture-on run and a capture-off
  run with the same seed produce identical results.
- All existing callers unchanged; text play-by-play unchanged.
- The event log is playback-only: held in memory for the watch session, never
  written into `GameState` or saves.

### Watch flow (`ui/simControls.js` + `script.js`)

- New **"Watch Next Game"** button in the sim dock's primary group, enabled
  under the same conditions as "Next Game" (regular season only in v1).
- Handler: sim intervening days normally; on the user's game day, sim all
  other games under the active engine, sim the user's game via the possession
  engine with capture on, apply the result through the normal bookkeeping
  path, then open the pixel view with the event log.
- Fallback: if event capture yields no events, behave exactly like "Next
  Game" and show a status message instead of breaking the sim flow.
- Watch mode always uses the possession engine for the watched game even when
  the active engine setting is `boxscore` — a game simmed without possessions
  cannot be watched. All other games respect the user's engine setting.
- One new `BUILT_VIEWS` entry in `script.js` for the view.

### `ui/pixelCourt.js` — static scene

Draws once to an offscreen canvas: parquet floor, top-down court lines,
painted keys in home-team colors, center-court logo lettering, two hoops,
crowd strip. Pure drawing; no game state.

### `ui/pixelSprites.js` — procedural sprites

Player sprite (~24px): skin tone + hair color from `faces.js` face data,
jersey in team colors with jersey number, 2-frame leg bob for running,
arms-up shooting pose. Plus the ball. Pure drawing; no game state.

### `ui/pixelChoreographer.js` — event log → keyframe timeline

Pure functions, Node-testable. Each possession becomes a beat sequence:

- Teams flow to offensive/defensive formation spots by position (PG top,
  wings, corners/post for bigs).
- Ball-handler dribble beat; optional pass beat to the shooter (pass from the
  recorded assister on assisted makes).
- Shot arc to the hoop: make → net flash + score tick; miss → rebound
  scramble resolving to the actual recorded rebounder.
- Turnovers/steals flip floor direction immediately.
- Free throws: shooter at the line, others along the key.
- Game clock derived from possession index (~14 s per possession, 12-minute
  quarters, quarter boundaries from the engine's possessions-per-quarter
  split).
- The engine has no bench/rotation concept, so the view fields each team's
  five most-used players (by minutes) and subs a sprite in at possession
  start whenever an event names a player not currently shown.

### `ui/pixelGameView.js` — view shell

Canvas mount + integer scaling, scoreboard bar, ball-handler name label,
scrolling play-by-play ticker reusing the existing text log, playback
controls: play/pause, 1×/2×/4×/8× speed, "Skip to Final". Default speed plays
a full game in roughly 4–5 minutes. All playback state is view-local; leaving
the view or reloading never touches `GameState` beyond what the normal sim
already did.

## Error handling

- Capture failure → graceful fallback to normal sim (above).
- Events referencing a player missing from the roster snapshot (should not
  happen; guarded anyway) → skip the beat, keep the score authoritative from
  the event's points field.
- The view never mutates sim state; the animation cannot desync the recorded
  result because the result is written before playback begins.

## Testing

Follows the repo's `scripts/validate-*.js` Node pattern:

- **`scripts/validate-pixel-events.js`** — run a captured game: event points
  sum to the final score; every referenced player is on the correct roster;
  quarters are monotonic; same-seed capture-on vs capture-off results are
  identical (no RNG drift).
- **`scripts/validate-pixel-choreographer.js`** — feed a real captured log
  through the choreographer: all keyframe positions within court bounds; ball
  custody chains correctly between beats; the game clock never runs backward.
- Canvas rendering verified in-browser via the project's usual workflow
  (fresh-port no-store threaded server).

## Out of scope (v1)

- Playoff games (natural follow-up; the playoff sim path is separate).
- Replaying past games (would require persisting event logs).
- Mid-game coaching decisions (timeouts, subs) — the event-log interface is
  the right foundation if this is ever wanted, but it is not part of this
  design.
- Refs, sponsor boards, camera movement, sprite likeness beyond skin/hair
  color.
