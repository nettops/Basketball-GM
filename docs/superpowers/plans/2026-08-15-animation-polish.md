# Animation Polish Implementation Plan

**Goal:** Anticipation, action, follow-through, contact and recovery in every
animation the watched game plays, without touching the pixel-art identity —
same 10x24 body, same procedural palette, same proportions, no assets.

**Architecture:** New posture channels in `ui/pixelMotion.js` (testable in Node),
new poses in `ui/pixelSprites.js`, phase markers from `ui/pixelChoreographer.js`,
and `ui/pixelGameView.js` reduced to wiring. The ball's math is deliberately
untouched: `resolveLifts` still reports the raw signed lift it always did, and
the new `foot`/`crouch` split rides alongside it.

**Tech Stack:** Vanilla ES5-style JS, no build step. Tests are standalone
`scripts/validate-*.js` run with `node` + built-in `assert`.

---

## What was measured first

Baseline: `node scripts/probe-animations.js 4`. See the design doc for the full
list; the four that drove the work:

| | baseline |
|---|---|
| every shot gather | body drawn up to **4px below its own shadow** |
| layup | **one 200ms beat**, no phases, ball released with feet on the floor |
| `dunk.land` | 130ms, **100% of players frozen**, pose cuts to idle |
| `cross.clear` / `cross.cross` | **76% of players frozen** |

---

## Tasks

- [x] **Split the lift into feet and knees.** `liftToPose(raw)` →
      `{ foot, crouch }`; `resolveLifts` reports both alongside the unchanged
      signed lift. View draws at `y - foot` and passes `crouch`.
- [x] **Make the sprite fold rather than sink.** `crouchSplit(crouch, legLen,
      torsoLen)` distributes the bend between knees and waist with floors on
      each (3px shin, 5px torso), so a 6'0" guard still gets a readable gather.
      Legs shorten, hips drop, torso folds, **feet do not move**.
- [x] **Give the layup phases.** `closeGather` 150 / `closeRise` 130 /
      `closeRelease` 90 + a `land` phase on the flight, stamped by `tagClose`
      (following the `tagHandle` convention — `push` already carries thirteen
      positional parameters). `CLOSE_LIFT` peaks at 9 and holds through the
      release.
- [x] **Give the layup a pose.** Driven knee on the finishing side, trail leg
      hanging, finishing arm extending over the rise, off arm tucked across the
      chest for ball protection. `side` comes off the marker, so a left-side
      finish is not the right-side one mirrored.
- [x] **Gate the layup on identity, not on a heuristic.** `ballMode` now checks
      `closerId` first, the way jump and dunk already did; the old
      `b.ball.holder === null && shotComing` test is kept as the fallback for
      unmarked finishes (tip-ins, putbacks, reduced motion).
- [x] **Land everything.** `landingSquash(ms, kind)` — 70ms in, 190ms out,
      peaking 4px (dunk) / 3px (layup) / 2px (pull-up). Contact is caught by
      `justLanded(prevFoot, foot)` as a transition between drawn frames (see
      below for why the first attempt, solving it from the curve, did not work).
- [x] **Unfreeze the crossover.** `step()` now flows the other eight through
      `flowPositions` with the handler and his victim locked — the treatment the
      dunk and the jump shot already had.
- [x] **Put weight under the dribble.** `dribbleLean(now)` off the same `sign`
      the ball and the dribbling arm share, so the torso cannot disagree with
      which hand has the ball. Continuous through the crossing by construction.
- [x] **Sync the landing to the animation frame.** New `land` / `landHard`
      voices; a dunk landing also drives a vertical camera nudge on its own
      timer and its own axis (the collision shake rings on both, which is wrong
      for a body coming down).
- [x] **Fix the two poses that anchored legs to the shoulders.** `stumbling`
      now anchors to the floor. Found by the validator written for the gather.
- [x] **Validators.** `scripts/validate-pixel-posture.js`, 11 checks.
- [x] **Debug harness.** `animation-lab.html` — every animation looping side by
      side with speed control and frame stepping, drawn by the game's own
      `drawPlayerSprite` and driven by the game's own curves. `BEAT` is now
      exported so the lab reads the real beat lengths rather than a copy.

---

## What was measured after

`node scripts/probe-animations.js 4`, same four seeds.

### The frozen beats

| family | before | after |
|---|---|---|
| `cross.clear` | **76%** frozen | **5%** |
| `cross.cross` | **76%** | **5%** |
| `cross.jab` | 29% | **3%** |

The layup's own beats land at 18-24% frozen, against a 23.2% game-wide average —
i.e. the floor keeps playing through them, which it did not before because they
did not exist.

### The ball

- Ball jump at the branch change into a layup (`dribble->close`): mean
  **1.5px → 0.9px**, max **3.1px → 1.3px**.
- Ball jump at the layup release: **0.0px, 100% still** — the same figure the
  jump shot already scored, and the layup previously had no separate reading at
  all.
- Every other geometry figure is unchanged, which is the point: `releaseFromHand`
  7.7 → 7.8px, `catchIntoHand` 9.8 → 9.9px, `dunkBallToRim` 4.0 → 4.0px.

### In the real game

Driven with Playwright against `python scripts/devserver.py 8137`: took a job,
opened a live game, played ~10s at 1x — no page errors, no console errors.
Stepping the animation lab frame by frame and measuring drawn sprite bounds:

```
        gather (feet / head)      airborne      landing
dunk     foot=44  top=25          top=0         top=23 foot=44
layup    foot=44  top=26          top=1         releases at top=10, foot=36
3PT      foot=44  top=27          top=5         releases at top=5,  foot=32
```

Feet hold at 44 through every gather (they used to leave it), the crouch depths
land exactly on the designed −2 / −3 / −4, and both the layup and the three
release while still airborne.

### Cost

`probe-dribbles`: timeline 1004.1s/game. The three-beat layup adds ~170ms to
each of ~39 layups a game — about 6.6s, or 0.7% of a game's running time. Move
distribution and dribble-count shares are unchanged.

### Full suite

All 63 `scripts/validate-*.js` pass, plus `ui-smoke.js` and
`validate-browserBridges.js`.

---

## Three things the validator caught that the eye had not

**The dunk landing would have fired one time in five.** The first design had the
lift curve report how long ago the feet touched, solved from its own easing —
`round(13 * (1 - f^1.6))` over a 130ms beat. Correct arithmetic, and the check
written to confirm it found the problem immediately: the window in which that
expression reads zero is **3.1ms wide**, narrower than a frame at 60fps. A
renderer stepping 16.7ms walks straight over it. Worse, the first version of the
formula handed back 65ms of age on the contact frame, which skipped almost the
whole 70ms compression — so the one animation the squash was built for was the
one that would never have played it. Replaced with a frame-to-frame transition
test, which is now checked at 60fps *and* 30fps: a landing that only exists at
one frame rate is a landing that vanishes on a slow machine.


**The landing squash steps 1.68px on the contact frame.** That is deliberate —
it is the accent — but it needed saying out loud rather than being an accident,
so the check now asserts two separate budgets: an impact ceiling of 2.0px on the
compression and a much tighter 0.7px on the recovery, where a visible step would
read as a stutter on the way back up.

**`stumbling` drew a short player 3px through the floor.** Written to check the
gather, `checkPosesStayWithinTheSpriteBox` immediately found the same defect
class in a pose nobody was looking at: its splayed legs hung off `topU`, which
moves with height, so short players punched through the court and tall ones
floated above it.

---

## Round two — the remaining sections

- [x] **Unfreeze the dunk landing** (§6). The 90ms slam stays frozen on purpose
      — it is the impact hold, and the beat where an earlier version teleported
      nine men into rebounding spots at 209px/s. The 130ms landing beat after it
      had no such excuse. Measured **100% frozen → 21%**.
- [x] **Rim contact** (§6/7). `rimHitSquash` — a 120ms fold as he catches the
      iron, on its own curve rather than the landing's, because a landing is
      weight arriving on a fixed floor and this is weight driven *through*
      something. Plus a `rim` audio voice on the frame his hand gets there.
- [x] **The stepback** (§5), which did not exist in any form. Two beats,
      counted at **8.45/game**. Its ball path needed `noSwitch` — the first
      entry in `dribbleCrossings` that shapes the ball without changing hands.
- [x] **Hesitation footwork** (§5). The hold was only ever a ball behaviour, so
      the man selling the fake stood bolt upright through it. `hesi` is now
      reported out of `moveDribble` and coils the body — with its own release
      fade, because the ball's hold ends abruptly (that snap is the move
      starting) and a body driven off the same number would straighten in one
      frame.
- [x] **Momentum, as one mechanism** (§9/10/11). Stepback body English,
      sprint-to-stop plant and direction-change lean are the same event, so
      they are one rule: lean into your own acceleration, fold when braking.
      Thresholds taken from a measured distribution (p99 = 2949px/s²), not
      picked.
- [x] **Ball deformation** (§7/8). One pixel off the squashed axis — the only
      honest move on a 3px ball — spent only above 900px/s or on the push-off
      dribble inside a named move.
- [x] **Per-player tempo** (§12). ±12% off the player id, deterministic so a
      replay dribbles the way the game did.
- [x] **Pose priority** (§11). `posePriority` resolves one winner from a flag
      bag; the validator walks all 128 combinations.
- [x] **Camera** (§14). A directional *drag* on a hard crossover — not a shake,
      because nothing collided — on its own timer and axis, decaying from an
      immediate peak. The opposite shape to the landing's half sine, because a
      landing is an arrival and a cut is a departure.

### Measured after round two

| family | baseline | round one | round two |
|---|---|---|---|
| `dunk.land` frozen | **100%** | 100% | **21%** |
| `dunk.slam` frozen | 100% | 100% | 100% *(deliberate)* |
| `cross.clear` frozen | 76% | 5% | 5% |
| `cross.cross` frozen | 76% | 5% | 5% |
| `cross.jab` frozen | 29% | 3% | 3% |

`probe-dribbles`: distribution unchanged from baseline at 44.3 / 25.4 / 16.7 /
13.6, dribbles on the floor 253.7/game, timeline 1004.6s/game.

### The stepback broke a metric, and that is worth recording

Marking the stepback with `tagHandle` — which looked right, since it is a named
move with beats — made every stepback possession count **twice** in
`probe-dribbles`, because `handle` is the possession's dribble-count marker and
the probe divides by it. The no-dribble share fell from 44.3% to 36.5% against a
50% target, which reads exactly like the sim's roll having drifted. Nothing was
wrong with the roll.

The fix was to stop calling it a handle: a stepback is choreography laid on the
*end* of a handle, not a second one. It is counted off its own `step` marker
instead, and the distribution went back to baseline to the decimal. Worth
remembering that adding a marker to a timeline can move a number that has
nothing to do with the feature.

## Not done

- **`dunk.slam` is still 100% frozen** for its 90ms, and stays that way on
  purpose — see round two. It is the impact hold.
- **The dribble tempo varies per player but not per SITUATION.** A man being
  pressured full-court dribbles at the same rhythm as one walking it up, and
  `ballHandling` does not feed the tempo at all — only the dribble *count*.
- **No between-the-legs pose.** The `double` move's ball path goes through his
  stance, but the legs do not open for it; at 10px wide the two frames that
  would need are a real question rather than an obvious win.
- **Contact on drives is not animated.** Two bodies meeting at the rim is a
  collision the separation pass resolves silently — nobody absorbs a bump, and
  the brief's "contact layup" is not built.
- **No pixel particles beyond the net splash**, and no motion streaks on the
  ball beyond the high-speed trail that already existed.
- **The layup does not vary by finish.** A reverse, a floater and a scoop all
  draw the same pose at the same height; only the side is read from the
  choreographer.
