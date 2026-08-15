# Dunk & Finishing Expansion — Design

**Goal:** enough dunk variety that a viewer thinks "that was a different dunk"
rather than "that animation played again" — at 55 dunks a game, which is where
the repetition actually bites.

**Constraint that shapes everything below:** there are no sprite sheets. The
body is drawn procedurally from rectangles, 10px across and 24 tall.

---

## Why this is a descriptor table, not thirty animations

"Add thirty dunk animations" cannot mean "author thirty sequences" here, because
there is nothing to author into. It has to mean *make the motion a function of
parameters, and pick the parameters*. The alternative — thirty hand-placed pose
sets — is exactly the copy/paste variation the brief rules out, because at this
size the second and third would inevitably be the first with a limb moved a
pixel.

So `ui/pixelDunks.js` stores **descriptions**, and `pixelMotion` / `pixelSprites`
derive the ball path, the body and the timing from them. Two entries cannot be
the same animation renamed, because there is no animation stored anywhere to
duplicate.

## What is actually distinguishable on a 10px body

This is the honest constraint, and it is what the axes were chosen from:

| axis | why it reads |
|---|---|
| **path** | the biggest lever by far — the ball is a free 3px object with the whole frame to travel through, and it is what the eye follows |
| **hands** | one arm up with the other trailing vs both arms up: two clear silhouettes |
| **spin** | 180/360 flip the whole body, with a back-of-the-head frame at the quarter turns |
| **reverse** | finishes on the far hand, back to the approach |
| **takeoff** | one foot vs two is visible *on the floor*, before the leap |
| **hang** | timing. 240ms at the top is a different experience from 40 |

**Deliberately not modelled**, because they are not visible and pretending
otherwise would be the near-duplicate failure: wrist angle, finger position,
precise shoulder rotation, and the difference between a cradle and a cock-back —
which at 10px is the same two rectangles. Where the brief names several dunks
that collapse to one silhouette, they are folded into one honest entry.

**The measured consequence, stated plainly:** the 23 entries produce only **5
distinct frozen silhouettes**. That is not a failure — a windmill and a tomahawk
*do* have the same body at any given instant; what differs is where the ball is
and how long it takes. The variety is in the route and the timing, and the
validator tests the route separation rather than the frozen pose, because the
frozen pose is not where the difference lives.

## Three things measurement changed

**Every route has to end in the same place.** Written by hand they did not: the
windmill's circle came back round to up=25 side=0 — below the rim and on the
wrong side of him — and the double clutch overshot to 40. A dunk finishes with
the ball at the rim, and the view hands it to the slam on the last frame, so any
other terminal puts a jump exactly where the eye is. Rather than hand-tuning
seven functions until they happened to agree, the terminal is enforced with a
correction that ramps in as *t²* — zero through the first half, where the route's
character lives.

**`Math.pow(t, 0.7)` has an infinite derivative at zero.** The tomahawk used it
to mean "rises fast early". Its measured peak ball speed came out at 220px per
unit of route against a windmill's 74, and sizing the beat off that demanded
715ms of hang for a tomahawk. The shape wanted was expressible with a derivative
that is merely large.

**The route clock has to run on time, not on phase index.** The first version
gave fixed fractions to each phase (rise 0.62, hang 0.85). A quick finish hangs
40ms, and handing that 40ms a fixed 23% of the route moved the ball 5.8px per
frame at the instant it reached the rim. Derived from the beats now, so a short
phase simply gets less of the route.

## The rim is a fixed height, and both ends of the route are stated

Originally each route carried its own beginning and the terminal was measured
from the finisher's feet. Both were wrong in the same way: **nobody was
responsible for saying where a dunk starts and finishes**, so seven functions
each answered it separately and none of them agreed.

The consequences were invisible in the game and obvious the moment the routes
were drawn side by side. The ball began at `up: 0` on four of the seven — on the
floor — and stayed there through the whole windup, because the route clock does
not start until the rise. And the finish rode on the leap, so the hoop was 40px
up for a quick finish and 48px for a 360 windmill.

So both ends are stated once, and every route is remapped affinely from its own
`[start, end]` onto `[hands, rim]`. The shape is untouched — the eastbay still
dips as far below its start, the double clutch still reverses — but no route can
have an opinion about where a dunk begins or ends, because that is not a property
of the route.

Three things follow, and each of them is more honest than what it replaced:

- **The leap depends on the player's height.** A fixed rim means a 6'0" guard has
  to jump higher than a 7'7" centre to put his hand in the same place. The
  catalogue's lifts are written for a median body and the height delta is applied
  on top.
- **The arm reaches.** The hand is no longer assumed to be where the ball is; it
  goes to the rim, bounded, so a small leaper finishes at full stretch and a big
  one barely extended.
- **Two entries turned out to be near-duplicates** once they shared an origin.
  `cradle` and `tomahawk` were separated mainly by starting at different heights,
  which is not a difference in the dunk. Fixing the origin exposed it, and the
  cradle earned its shape back.

## Computed and thrown away

The polish pass found the same shape of defect four times, and it is worth
naming because it is not a bug in any one place: **a channel gets designed,
computed, stamped on every keyframe, and then nothing reads it.** Everything
looks right — the code is there, the values are correct, a probe can print them
— and none of it reaches the screen.

`landing` classified four ways and drew one. `contact` made a dunk through a
body identical to a dunk past nobody. `alley` had pool rules and no detector.
`tall` was captured at load time from a file that had not loaded yet, so every
player in the league got a median-height leap.

The lesson for the checks: asserting that a function returns the right answer is
not the same as asserting the answer is used. Three of the new checks assert
that a thing actually *fires* — that the euro and the spin appear at a real
rate, that an oop's route does not start until the catch — because "correct and
invisible" passed every test this codebase had.

## Beat lengths are computed, not chosen

`PATH_RISE_MS` comes from each route's own peak speed against a 3.2px/frame
budget — the same budget the dribble moves run to. A windmill sweeping an 11px
circle through a power dunk's 145ms beat moves the ball 4.7px a frame, which is
not a circle, it is a smear. So the elaborate routes are longer in the air, which
is also what they look like in life.

## Selection is context first, roll second

Contact rules out rotation and elaborate routes; a putback rules out anything
with a windup; an alley-oop rules out routes that start below the waist; a short
runway rules out anything needing momentum; tier gates on how high he can get.
Only then does a weighted roll break the tie — and it drops whatever he did last
time, which is the single loudest form of repetition.
