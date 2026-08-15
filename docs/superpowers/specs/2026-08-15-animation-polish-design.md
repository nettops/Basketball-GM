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

---

## Round two: the remaining sections

### One mechanism for momentum, not three

The brief asks separately for the stepback's upper body fighting the backward
push, the sprint-to-stop plant, and the lean through a change of direction.
They are the same event — a body whose feet have changed what they are doing
before the rest of him has caught up — so they are one rule. Three bespoke ones
would be three chances for a player to lean two ways at once.

The numbers are measured, not chosen. Sampling every player on every frame
through the real spring over three games:

```
acceleration   p50 63    p90 798   p99 2949   p99.9 5443   max 37789 px/s²
speed          p50 13    p90 255   p99 620 (the step ceiling)
```

`LEAN_ACCEL_FULL` sits at p99, so the top 1% of direction changes lean all the
way and the ordinary drift that makes up half of all frames leans by a
thirtieth of a pixel — which rounds to nothing and draws nothing. The plant
threshold sits between p90 and p99.9 for the same reason.

### The stepback, which did not exist

Not one of the existing shapes: it is a finishing move laid on the **end** of
the handle, which is what it is in basketball. Two beats — a 220ms plant where
he drives *in* past the shot spot with his man going with him, then a 120ms
push back to it while his man does not. Going in first is what makes the
retreat legible; a man who walks backwards from where he already stood has not
stepped back from anything.

Its ball path needed a genuinely new idea. Every entry in `dribbleCrossings`
was a hand change with a shape attached, and a stepback's defining feature is
that the ball does **not** change hands — the separation is made with the feet.
Hence `noSwitch`: shape the ball here, but this is not a crossing. `handSwitchCount`
exists because `dribbleClockAfterMove` must count hand changes rather than
crossings, or resuming the free clock re-introduces the uninvited second hand
change that function was written to prevent.

### The slam stays frozen; the landing does not

`dunk.slam` measures 100% of players motionless and stays that way. That 90ms
is the impact hold — the beat where a previous version teleported nine men into
rebounding spots at 209px/s — and it is the one place in the game where a freeze
*is* the effect. The 130ms landing beat after it had no such excuse and now
flows, with the dunker and the man he went over locked so a poster's victim
stays driven back.

### Pose priority, stated once

The order was real but was never written down: half in the if-chain inside
`drawPlayerSprite`, half in a growing pile of negations at the call site
(`!shooting && !isJumperNow && !dunkPose && !layupPose && !jumpFollow`). That is
the shape a state conflict arrives in — not a wrong rule, but one place out of
five that did not get updated. `posePriority` resolves it in one call, and the
validator walks all 128 flag combinations.

### Deformation on a three-pixel ball

There is exactly one honest move at this size: drop a pixel off the axis being
squashed. So the question is entirely *when* to spend it, and the answer is
rarely — above 900px/s (an ordinary catch runs 366) or on the push-off dribble
inside a named move. Every dribble contacts the floor four times a second, and
flattening on all of them is not an accent, it is a flicker.

---

## Round three: the last of the list

### The court has one axis, and finding that out took two wrong versions

Layups needed distinguishable finishes. The first classifier used 26px for
"pulled up short of the rim" — which sounded reasonable and sat below the 10th
percentile, so **88% of every finish in the game came out a floater**. The
second used distance *and* lateral offset as two independent signals and
produced **zero reverses**. Measuring settled it:

```
distance to the rim   p10 16.5   p25 44.0   p50 47.8   p75 50.6   p90 53.5
lateral offset        p10  4.0   p25 41.0   p50 45.0   p75 48.0   p90 51.0
|dx| to the rim       p10 16.0   p25 16.0   p50 16.0   p75 16.0   p90 16.0
```

Every finish at the rim gathers **exactly 16px** from the hoop along the court's
long axis. `dist` is just `hypot(16, lateral)` and carries no information the
lateral offset does not already have — so using both was double-counting one
number, which is why the two rules came out mutually exclusive. What survives is
one geometric signal (wide → reverse) and one situational one (going over a big
→ floater). Settles at 66% standard, 21% reverse, 13% floater.

### Contact was already being measured; nobody was reading it

The view resolves overlapping sprites every frame by shoving them apart, then
drew both as though nothing had touched. That shove *is* a measurement of
contact. Over three games it is nonzero on 8.2% of player-frames, and of those
p50 is 0.1px, p90 0.9px, p99 2.3px — so ordinary crowding is a tenth of a pixel
and a real bump is past about one. The floor sits at p90-of-nonzero, which fires
on ~0.8% of all player-frames.

It is *held* for 180ms rather than drawn on the frame it happened: a shove is
spiky, and a lean that follows it frame for frame is a flicker, not a bump.

### Between the legs, which the lab was lying about

There was no between-the-legs move — the animation lab was labelling the double
move as one, so it looked like there was. It is the exact opposite of
behind-the-back on both axes that matter: that one goes **wide and stays up**
around square shoulders, this one goes **narrow and hard down** through a stance
he has to open. Without the open stance it is a crossover with a lower bounce,
which is the "same rectangles sliding sideways" failure the named moves exist to
escape.

## What this does not do

- No new frames were added to any pose, and no pose was redrawn for its own
  sake. The palette, proportions, outline weight and sprite box are untouched.
- Anticipation on the *dribble* is still carried by the ball (the hesitation
  hold that already existed), not by a wind-up in the body.
- Per-player animation tempo is still uniform; a quick guard and a slow big
  gather at the same speed.
