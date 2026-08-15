# Dribble Moves Implementation Plan

**Goal:** Make the named dribble moves — put-down, crossover, behind-the-back,
double move, ankle breaker — actually move the ball, and make the ankle breaker
a skill check rather than a fixed rating cutoff.

**Architecture:** One scripted dribble in `ui/pixelMotion.js` that both the ball
and the sprite's arm read, driven by a per-beat marker the choreographer stamps
on each beat of a dribble string. The free-running dribble keeps its shape but
moves onto a continuously integrated clock so a change of tempo can no longer
rewrite where the ball already was.

**Tech Stack:** Vanilla ES5-style JS, no build step. Tests are standalone
`scripts/validate-*.js` run with `node` + built-in `assert`.

---

## What was measured first

Four findings, all reproduced before any code was written.

1. **The named moves never moved the ball.** Over real games the ball reaches
   6.0px from the handler's centre during a crossover, 6.0px during a
   behind-the-back, 6.0px during a double move, 6.0px during an ankle breaker.
   Only the body slides; the ball keeps an independent metronome.
   (`scripts/probe-iso-moves.js`)

2. **Behind-the-back's ball path is dead code.** The choreographer computes a
   12px lateral swing for it — `kf ball off` reads 12.2 for `behind` and 0.0 for
   every other move — and `ballPosition` discards it: a held ball is drawn at
   `hand ± dribble side` and never reads its own keyframe. Moving the keyframe
   ball 800px changes the drawn ball by 0.0000px.

3. **The tempo gate teleports the ball, 446 times a game.** `dribbleHand` takes
   its period from whether the holder is moving (95ms vs 140ms) and derives the
   phase from *absolute* time, so the instant a springy body crosses the 6px/s
   threshold the whole history is recomputed and the ball snaps up to 12px into
   the other hand in one frame. Shipped in the crossover work; every existing
   test holds `moving` constant, which is why none of them saw it.

4. **The ankle breaker is not a skill check.** It is `handleEdge >= 22`, a hard
   cutoff with no roll, no fatigue, no traits. Over 30 games, **100% of matchups
   seen three or more times were all-or-nothing** — a handler at edge 22.5 broke
   his man's ankles on 3 of 3 made jumpers; one at 21.5 never would, all season.

## Global constraints

- `ui/pixelMotion.js` stays pure: numbers in, numbers out, no canvas, no
  GameState. Probes, previews and the view all call the same functions.
- The choreographer stays deterministic — replay and seek must reproduce a
  timeline exactly, so any roll uses `roll01(seed)`, never an rng stream.
- Ankle breakers must stay inside the 1.5–6.0 per game band asserted by
  `scripts/validate-impactMoments.js`.
- The ball may never move more than ~1.5px sideways in a single frame, at 60fps,
  under any tempo or move.

---

### Task 1: A dribble clock that cannot rewrite the past

**Files:**
- Modify: `ui/pixelMotion.js`, `ui/pixelGameView.js`
- Modify: `scripts/export-animation-frames.js`, `scripts/probe-animations.js`,
  `scripts/probe-iso-moves.js`
- Test: `scripts/validate-dribble.js`

**Interfaces:**
- Produces: `stepDribbleClock(u, dtMs, holderMoving)` → new clock in *bounces*;
  `dribbleHand(u)` and `dribbleBall(u)` now take bounces, not milliseconds;
  `ballPosition` takes `s.dribbleU` in place of using `s.playbackMs` for the bounce.

- [ ] **Step 1:** Write the failing test — a handler whose speed wobbles across
      the moving/standing gate, asserting the ball never jumps >1.5px in a frame.
- [ ] **Step 2:** Run it, watch it fail at 12px.
- [ ] **Step 3:** Extract `DRIBBLE_PERIOD_SET`/`DRIBBLE_PERIOD_MOVING`, add
      `stepDribbleClock`, re-express `dribbleHand` in bounces.
- [ ] **Step 4:** Advance the clock once per frame in the view and thread it
      through every caller.
- [ ] **Step 5:** Run the dribble validator and the animation probes. Commit.

### Task 2: The move drives the ball

**Files:**
- Modify: `ui/pixelMotion.js`
- Test: `scripts/validate-dribble.js`

**Interfaces:**
- Consumes: `dribbleHand` from Task 1.
- Produces: `dribbleCrossings(move, n)` → the crossings a move carries;
  `moveDribble(move, u, n, opts)` → `{ sign, side, phase, behind, crossing }`;
  `dribbleNow(clock, move)` → the blend of free and scripted.

Shape per move, in bounces, one bounce per beat:

| move | crossings | widest | through the middle |
|---|---|---|---|
| put-down | none | 6px | — |
| crossover | 1, at the halfway beat | 10px | low and hard |
| behind the back | 1, at the halfway beat | 15px | stays high, swings around |
| double move | 2, the second late | 8px then 12px | low |
| ankle breaker | 1, on the cut-back beat | 12px | lowest |

- [ ] **Step 1:** Write failing tests — each move's widest reach, its crossing
      count, and the no-teleport bound across the free↔scripted handoff.
- [ ] **Step 2:** Run, watch them fail.
- [ ] **Step 3:** Implement, widening at the *edges* of the crossing window and
      dropping the ball to the floor at its centre.
- [ ] **Step 4:** Run. Commit.

### Task 3: The choreographer says which move is playing

**Files:**
- Modify: `ui/pixelChoreographer.js` (stamp `drib` per beat; delete the dead
  `ballLat`), `ui/pixelGameView.js` (read it)
- Test: `scripts/validate-pixel-choreographer.js`, `scripts/probe-iso-moves.js`

- [ ] **Step 1:** Failing test — every beat of a dribble string carries a marker
      naming the move and its index.
- [ ] **Step 2:** Stamp it; remove `ballLat` and correct the comment that claims
      it does something.
- [ ] **Step 3:** Read it in the view for both the ball and the arm.
- [ ] **Step 4:** Re-run `probe-iso-moves.js` — the five moves must now differ.
      Commit.

### Task 4: He sells it (treatment C)

**Files:**
- Modify: `ui/pixelMotion.js`, `ui/pixelSprites.js`
- Test: `scripts/validate-dribble.js`, `scripts/validate-pixel-sprites.js`

- [ ] **Step 1:** Failing test — the ball hangs near the top of the bounce
      through the half-beat before a crossing, then drops into it.
- [ ] **Step 2:** Implement the hesitation and the body's sink into the move.
- [ ] **Step 3:** Run. Commit.

### Task 5: The ankle breaker becomes a skill check

**Files:**
- Modify: `ui/pixelChoreographer.js`, `index.html` if load order needs it
- Test: `scripts/validate-impactMoments.js`, `scripts/probe-ankle-breakers.js`
- Modify: `scripts/validate-browserBridges.js` — extend it to cover `ui/`, which
  it does not scan today. That gap is what let `selectSegment is not defined`
  reach the browser earlier in this work.

- [ ] **Step 1:** Failing test — the same matchup must not always produce the
      same verdict, and neither the best nor the worst matchup may be certain.
- [ ] **Step 2:** Replace the cutoff with `skillCheckProbability` plus a
      `roll01` draw seeded off the possession.
- [ ] **Step 3:** Calibrate base/scale to hold ~4.5 ankle breakers per game.
- [ ] **Step 4:** Run the impact-moment validator and the ankle probe. Commit.

### Task 6: Verify live, and tidy up

- [ ] **Step 1:** Watch a real game in the browser and confirm the moves read.
- [ ] **Step 2:** Full validator suite.
- [ ] **Step 3:** Delete the preview page. Commit.
