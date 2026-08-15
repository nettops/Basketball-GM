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
