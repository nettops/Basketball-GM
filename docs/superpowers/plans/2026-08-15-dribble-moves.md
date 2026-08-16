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

- [x] **Step 1:** Write the failing test — a handler whose speed wobbles across
      the moving/standing gate, asserting the ball never jumps >1.5px in a frame.
- [x] **Step 2:** Run it, watch it fail at 12px.
- [x] **Step 3:** Extract `DRIBBLE_PERIOD_SET`/`DRIBBLE_PERIOD_MOVING`, add
      `stepDribbleClock`, re-express `dribbleHand` in bounces.
- [x] **Step 4:** Advance the clock once per frame in the view and thread it
      through every caller.
- [x] **Step 5:** Run the dribble validator and the animation probes. Commit.

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

- [x] **Step 1:** Write failing tests — each move's widest reach, its crossing
      count, and the no-teleport bound across the free↔scripted handoff.
- [x] **Step 2:** Run, watch them fail.
- [x] **Step 3:** Implement, widening at the *edges* of the crossing window and
      dropping the ball to the floor at its centre.
- [x] **Step 4:** Run. Commit.

### Task 3: The choreographer says which move is playing

**Files:**
- Modify: `ui/pixelChoreographer.js` (stamp `drib` per beat; delete the dead
  `ballLat`), `ui/pixelGameView.js` (read it)
- Test: `scripts/validate-pixel-choreographer.js`, `scripts/probe-iso-moves.js`

- [x] **Step 1:** Failing test — every beat of a dribble string carries a marker
      naming the move and its index.
- [x] **Step 2:** Stamp it; remove `ballLat` and correct the comment that claims
      it does something.
- [x] **Step 3:** Read it in the view for both the ball and the arm.
- [x] **Step 4:** Re-run `probe-iso-moves.js` — the five moves must now differ.
      Commit.

### Task 4: He sells it (treatment C)

**Files:**
- Modify: `ui/pixelMotion.js`, `ui/pixelSprites.js`
- Test: `scripts/validate-dribble.js`, `scripts/validate-pixel-sprites.js`

- [x] **Step 1:** Failing test — the ball hangs near the top of the bounce
      through the half-beat before a crossing, then drops into it.
- [x] **Step 2:** Implement the hesitation and the body's sink into the move.
- [x] **Step 3:** Run. Commit.

### Task 5: The ankle breaker becomes a skill check

**Files:**
- Modify: `ui/pixelChoreographer.js`, `index.html` if load order needs it
- Test: `scripts/validate-impactMoments.js`, `scripts/probe-ankle-breakers.js`
- Modify: `scripts/validate-browserBridges.js` — extend it to cover `ui/`, which
  it does not scan today. That gap is what let `selectSegment is not defined`
  reach the browser earlier in this work.

- [x] **Step 1:** Failing test — the same matchup must not always produce the
      same verdict, and neither the best nor the worst matchup may be certain.
- [x] **Step 2:** Replace the cutoff with `skillCheckProbability` plus a
      `roll01` draw seeded off the possession.
- [x] **Step 3:** Calibrate base/scale to hold ~4.5 ankle breakers per game.
- [x] **Step 4:** Run the impact-moment validator and the ankle probe. Commit.

### Task 6: Verify live, and tidy up

- [x] **Step 1:** Watch a real game in the browser and confirm the moves read.
- [x] **Step 2:** Full validator suite.
- [x] **Step 3:** Delete the preview page. Commit.


---

## Outcome

All six tasks done. 62 validators pass, 0 fail.

**The tempo snap:** 446 twelve-pixel hand-swaps a game -> 0. Pinned by
`checkChangingTempoDoesNotRewriteThePast`, which wobbles a handler's speed
across the moving/standing gate, and by a whole-game counter in
`probe-iso-moves.js`.

**The moves, measured over twelve real games through the drawing path.** Hand
changes per string: put-down 0 (was 2), crossover 1, behind-the-back 1, double
move 2. Widest the ball reaches from his centre: put-down 6px, crossover 10px,
double move 12px, ankle breaker 12px, behind-the-back 15px. Before this every
one of them measured 6.0px.

**The hesitation** holds the ball at 0.72 of its bounce through the half-beat
before a crossing, then drops it to 0.00 at the plant. The ankle breaker
deliberately has none — its fake is the jab — and that is asserted, not
commented.

**The ankle breaker** is now a `skillCheck.js` contest drawn on a `roll01`
possession seed: 4.40/game against the 1.5-6.0 band, where the cutoff gave
4.50. Chance runs 2% at worst, 8.5% median, 41% at best, against a threshold
under which 100% of repeated matchups were all-or-nothing.

**Live in a real game** (Portland at Boston, watched at 4x then 1x): named
moves reach the view — crossover, behind-the-back, double move and put-down all
observed — the ball reaches 14.8px from the body, and its offset from his hand
never steps more than **0.69px per frame**.

### Two measuring tools were lying

Both `validate-impactMoments.js` and `probe-ankle-breakers.js` called
`classifyImpact` without a seed, which hands every event in the league the same
roll. They read 7.42 and 8.02 per game against a true 4.40. Worth remembering
when any deterministic rule becomes a check: every caller that omits the seed
silently becomes all-or-nothing rather than failing.

### A gap closed on the way past

`validate-browserBridges.js` scanned only the repo root, never `ui/`. That is
the exact gap that let `selectSegment is not defined` reach a real page with
every validator green. It now covers both.

### Not done

~~Per-player dribble tempo (treatment D from the previous round) is still
unbuilt.~~ **Built in the animation polish pass** — see
`2026-08-15-animation-polish.md`. Tempo now responds to handle skill and to
pressure, measured at 0.798 for an elite handler under pressure against 0.970
for a poor one with room, and `checkTempoRespondsToSkillAndPressure` holds it
there. This note sat here stale for three rounds, which is its own small lesson
about "not done" lists.
