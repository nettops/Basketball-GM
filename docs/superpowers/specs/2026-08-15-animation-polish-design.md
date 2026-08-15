# Animation Polish — Design

**Goal:** Make the watched game read as animation rather than as a sequence of
sprite states — anticipation, action, follow-through, contact, recovery — while
changing nothing about the pixel-art identity: same 10x24 body, same procedural
palette, same proportions, no assets, no interpolation, no smoothing.

**Non-goal:** More frames. The sprite is 10px wide and the poses are hand-placed
rectangles; the lever here is *timing, spacing and which pose exists at all*,
not frame count.

---

## What was measured first

Everything below was reproduced before any code was written, over four
simulated games (`scripts/probe-animations.js 4`, baseline kept in the plan).

1. **Every gather in the game drew the player below the floor.** The shot
   phases carry negative lifts — `DUNK_LIFT.gather = -2`, `JUMP_LIFT.gather =
   -3`, a three `-4` — and `ui/pixelGameView.js` applied them as
   `drawPlayerSprite(ctx, x, y - jumpLift, …)`. That translates the *whole*
   sprite, feet included. The shadow is drawn at `y` and does not move, so for
   the entire anticipation of every shot in the game the player stood up to four
   pixels underneath his own shadow. The dip was real; it was just being drawn
   as the court swallowing him.

2. **The layup had no phases and released on the floor.** A dunk has
   gather/rise/slam/land and a jumper has gather/rise/release/follow. A layup
   was a single 200ms beat with no marker at all, and `closeLift(f)` was a sine
   hump that returned to **zero at the end of the beat** — which is the frame
   the ball leaves the hand. The game released every layup at the instant the
   finisher's feet were back on the ground, wearing the generic both-arms-up
   jump-shot pose.

3. **Nothing landed.** `dunk.land` measured **130ms with 100% of players
   frozen**, and the sprite cut from the airborne pose straight back to
   standing on a single frame. No contact, no compression, no recovery — the
   leap simply stopped being true.

4. **The crossover's payoff beat was a freeze frame.** `cross.clear` measured
   **76% of players motionless** across 220ms, and `cross.cross` the same. The
   handler and his victim moved; the other eight held a keyframe exactly. The
   beat whose entire job is "explode into the daylight you just made" was
   mostly a still image.

5. **The dribble animated arms and nothing else.** A behind-the-back swings the
   ball 15px around the handler; his torso never moved a pixel. The ball
   travelled past a statue.

6. **Two poses anchored their legs to the shoulders.** `stumbling` drew its
   splayed legs from `topU`, which shifts with player height — so a 6'0" guard's
   legs punched 3px through the court and a 7'7" centre's floated 5px above it.
   Same defect class as (1), found by the validator written for (1).

---

## The shape of the fix

### A lift is two different numbers

The single signed `lift` conflates "feet off the floor" with "knees bent". They
are drawn completely differently and only one of them may move the feet.
`liftToPose(raw)` splits it into `{ foot, crouch }` in `ui/pixelMotion.js`, and
the sprite absorbs `crouch` by **folding** — legs shorten, hips drop, torso
folds at the waist, feet stay exactly where they were.

The split is deliberately *additive to the existing ball math*: `resolveLifts`
still reports the raw signed lift, because the ball hangs off the shoulders and
the shoulders really do drop with the hips. So the ball's path is byte-identical
and only the body changed. That is what kept a large pose change off the ball's
regression surface entirely.

The bend is split between knees and waist for the same reason `spriteLegDelta`
splits height: legs are 4px on a short guard, and taking the whole bend out of
them either eats the shins or leaves the players who take most of the shots with
a 1px gather.

### The layup gets the structure the other two finishes already had

Three beats (`closeGather` 150 / `closeRise` 130 / `closeRelease` 90) plus a
`land` phase on the flight, marked with `close: { phase, id, side }`, resolved
through the same `resolveLeaper` the jump shot uses. `CLOSE_LIFT` peaks at 9 and
**stays there through the release**, so the ball leaves at the top of the finish.
The descent then runs on its own real-time clock rather than on beat progress —
the beat he comes down on is the ball's whole flight, and easing across it
leaves him hanging until the ball reaches the rim.

`side` (the direction of the rim from where he gathers) is what makes a
left-side finish something other than the right-side one drawn backwards: the
finishing hand, the driven knee and the tucked off arm all key off it.

### Landing is a curve on real time, not on a beat

`landingSquash(ms, kind)` — 70ms of compression, 190ms of recovery, peaking at
4px for a dunk, 3 for a layup, 2 for a pull-up. Compression is *faster* than
recovery on purpose: that ratio is the difference between absorbing a landing
and bouncing off the floor. It runs on time since contact rather than beat
progress so it can outlive the 130ms beat it happens on.

**Contact is detected as a transition between drawn frames**, not solved from
the curve. The first design had `resolveLeaper` report "how long ago the feet
touched", derived from the easing — correct arithmetic, and useless in practice:
a dunk's fall is `round(13 * (1 - f^1.6))` over a 130ms beat, so the window in
which that expression reads zero is **3.1ms wide**. A renderer stepping 16.7ms
walks over it about four times in five, and the landing never fires. `justLanded(prevFoot, foot)`
cannot miss, because the view asks it on every frame it actually draws —
whatever the beat lengths and whatever the playback speed.

### Impact and audio hang off the animation frame, not the keyframe

A landing is announced on the frame the feet touch, not on the beat boundary
near it: two new voices (`land`, `landHard`) and, for a dunk only, a **vertical**
camera nudge on a half sine. It gets its own timer and its own axis rather than
reusing the collision shake, because a collision rings on both axes and a body
coming down drives the picture down once and lets it settle.

---

## What this does not do

- No new frames were added to any pose, and no pose was redrawn for its own
  sake. The palette, proportions, outline weight and sprite box are untouched.
- Anticipation on the *dribble* is still carried by the ball (the hesitation
  hold that already existed), not by a wind-up in the body.
- Per-player animation tempo is still uniform; a quick guard and a slow big
  gather at the same speed.
