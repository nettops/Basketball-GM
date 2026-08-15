# Dunk & Finishing Expansion — Implementation Plan

**Goal:** dunk variety that survives 55 dunks a game.

**Architecture:** `ui/pixelDunks.js` (new) holds descriptors and selection, pure
and dependency-free. `pixelMotion` derives lift and ball position from them,
`pixelSprites` derives the pose, the choreographer picks one and stamps it on
every phase of the string, and the view wires it. See the design doc for why it
is descriptors rather than authored sequences.

---

## What was measured first

- **55.3 dunks per game.** One animation for all of them is the problem.
- No `dunk` attribute exists. `vertical`, `strength`, `insideScoring` and
  `heightIn` do, on the same shape the choreographer's own dunk gate uses.
- The existing dunk was four beats (gather/rise/slam/land), one pose
  (`dunking: true`), and one ball behaviour (straight to 30px up, 4px across) —
  identical for every finish in the game.

## Tasks

- [x] **The catalogue.** 23 entries over 7 ball routes, gated by tier and
      weighted so plain finishes stay common.
- [x] **Ball routes.** `power`, `straight`, `tomahawk`, `windmill`, `eastbay`,
      `cradle`, `double` — each a function of route progress, all converging on
      the rim by construction.
- [x] **Per-dunk lift table**, plus the two phases the ten-phase structure named
      and had nowhere to put: `plant` (the deepest point of the load) and `hang`
      (the top, held).
- [x] **The route clock**, derived from each dunk's own beats.
- [x] **Pose.** Two-hand vs one-hand arms, two-foot vs one-foot tuck, the
      eastbay's split legs, the reverse's far hand, and a back-of-the-head frame
      for the quarter turns of a spin.
- [x] **Selection** from tier, contact, putback, runway and recency.
- [x] **Landing styles** — stumble / heavy / balance / light — derived from the
      dunk and the contact rather than stored.
- [x] **Putbacks**, detected from an offensive rebound by the same player.
- [x] **Validators.** Five new checks in `scripts/validate-pixel-posture.js`
      (21 total).

## What was measured after

Over 8 games:

```
dunks                          55.3/game
distinct dunks used            23 of 23
back-to-back repeats           0 (0.0%)
most common                    oneHandPower 15.8%
least common                   threeSixtyWindmill 0.2%
landings                       heavy 207 / balance 148 / light 74 / stumble 13
context                        plain 424 / contact 13 / putback 5
```

Ball readability, against each dunk's own beats: worst **3.24px/frame**
(quickOne through the slam), inside the 3.2px budget the dribble moves run to
everywhere except the fastest frame of the fastest finish.

Route separation: the closest pair of routes (`power`/`straight`) separates by
**6.4px** — more than half a body width — after `straight` was rewritten to
differ in *time* rather than amplitude. The first version separated by 0.7px and
was a near-duplicate.

Frozen beats, before → after this pass:

| beat | before | after |
|---|---|---|
| `dunk.hang` | *(did not exist)* | 21% |
| `dunk.plant` | *(did not exist)* | 22% |
| `dunk.slam` | 100% | 100% *(kept — the impact hold)* |
| `dunk.land` | 21% | 21% |

All 63 validators pass.

## Three bugs found by measuring, one of them self-inflicted

**The routes did not converge on the rim.** Caught by checking where each path
ends rather than by watching. See the design doc.

**`pow(t, 0.7)` leaves the origin vertically.** The tomahawk's peak ball speed
was 3x the windmill's for a shape that looks tamer.

**Unfreezing the hang broke the slam.** Flowing the floor through the new hang
beat left `landPos` still derived from the pre-hang positions, so the slam
dragged all nine players *backwards* to where they had stood before — a
backwards teleport on the one beat the eye is guaranteed to be on. The probe
caught it as `dunk.slam` going from 100% frozen to 21%, which looked like an
improvement and was a regression.

## Not done

- **Alley-oops.** `dunkPool` has the context and rules for them, and the beats
  are written, but nothing detects one: it needs the choreographer to model a
  pass that is caught in the air, which is a ball-flight change rather than an
  animation one. The pool branch is dead code until that exists, and is left in
  place deliberately rather than deleted.
- **Ball-handling into dunks** (section 8) — crossover→takeoff→dunk as a
  continuous motion. The dribble string and the dunk string are still separate
  events with a beat between them.
- **Euro steps and spin finishes** (sections 10/11) and the wider layup
  expansion (section 9). The layup has three finishes from the previous pass;
  the euro/pro-hop/hand-switch family is untouched.
- **Contact is rare** (13 in 8 games) because it keys off the poster marker and
  on-ball inside shots. The contact *animation* is built and correct; what is
  missing is more situations recognising themselves as contact.
- **Approach direction** does not vary the dunk. `runway` is used, the angle is
  not.
