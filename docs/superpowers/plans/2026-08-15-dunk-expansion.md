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

## Follow-up: a fixed rim, and a ball he actually picks up

Two defects found by watching the reel rather than by any check.

**The ball started on the floor.** `dunkBallPath(style, 0)` returned `up: 0` for
`power`, `straight`, `tomahawk` and `double` — the ball's route began at his
feet. The route clock is pinned at 0 through the gather and the plant (that is
deliberate; a gather is not ball travel), so for the whole windup nothing moved
the ball at all and it sat on the ground bouncing until he was already climbing.
He never picked it up.

The check that should have caught it read `start.up < 14` — a **one-sided
bound**, written to catch a route starting too high, and perfectly happy with
0.0. Bounded both ways now.

**The rim moved.** `DUNK_TERMINAL.up` measured from his FEET, so the finishing
height rode on how high he jumped: 40px above the floor on a quickTwo, 48px on a
threeSixtyWindmill. An 8px spread — a third of a body — on the one thing in the
building that cannot move.

What that took:

- `RIM_ABOVE_FLOOR = 47`, and the terminal solved against the floor. Not a free
  choice: the hand tops out `tall + 6` above the feet, the slam is at 0.82 of
  peak lift, and the arm stretches a bounded few px.
- `DUNK_ORIGIN = 12` — his hands — with each route **affinely remapped** from its
  own `[start, end]` onto `[origin, rim]`. The first version added a decaying
  correction instead, which started the ball at 12 and then let it *fall* back
  onto the raw route; `straight` is deliberately near zero at halfway, so the
  ball dropped 8px out of his hands right after he gathered it.
- **The leap compensates for height.** A 6'0" guard finished 2px under a fixed
  rim off the catalogue's median-body lifts. He jumps higher now and a 7'7"
  centre jumps lower, which is why short players who dunk are the best leapers
  in the gym.
- **The arm reaches for the rim**, so the hand meets the ball instead of the
  ball being assumed to sit on the hand. Driven off the ball's *live* position
  first, which made a windmill's arm pump as the ball swung past — it tracks the
  rim now, and on the slam frame they are the same place.
- `MIN_DUNK_LIFT = 16`; `quickOne`, `quickTwo` and `twoHandPower` raised to it.
  Quick is expressed in beats and hang, not in finishing under the hoop.

Measured over 442 dunks in 8 games:

```
finish height above floor      47 min, 47 max   (rim 47)
hand-to-ball gap               0.00px max
ball at the gather             12.0px — his hands, never the floor
height compensation            live across 6 body sizes (-2 to +3)
distinct dunks / repeats       23 of 23 / 0
```

Two more near-duplicates fell out of sharing an origin, both caught by the
separation check and both real: **cradle/tomahawk at 3.9px** — they were only
ever distinguished by starting at different heights, so the cradle is a genuine
hold-then-throw now — and **power/straight at 4.1px**, since re-basing every
route shortened the vertical travel they had to differ in. `power` is
front-loaded rather than linear, which is also what a ball coming up with the
leap does. `double`'s pull deepened for the same reason; at −9 the reversal that
is the entire point of a double clutch had shrunk to 4.3px.

Closest pair is now **power/tomahawk at 5.6px**. Ball readability **3.16px/frame**
— and that check was measuring the fallback path rather than the one the game
draws, because it called `dunkBallPath` without the foot. Same failure as calling
a seeded function without its seed.

Three new checks: `checkEveryDunkFinishesAtTheSameRim`, `checkTheHandMeetsTheBall`,
and the two-sided origin bound. 63 validators pass.

One load-order trap worth recording: the choreographer is loaded by `index.html`
*before* `ui/pixelSprites.js`, so a `const` capturing `spriteTallness` at load
time would have found nothing, fallen back to zero, and given every player in the
league a median-height leap forever with nothing failing. Resolved at call time.

## Follow-up: the polish pass, and four channels nobody was reading

Started with an audit rather than a change: every dunk walked on its real
timeline at 60fps, measuring per-frame body movement, per-frame ball movement,
pose change as *drawn pixels*, and airborne frames where nothing moved at all.

Four defects came out of it, none of which any existing check was looking for:

| | before | after |
|---|---|---|
| worst pose change in one frame | **179px** of a ~240px sprite | 123px, and it is the body moving |
| takeoff extension | **1 frame** of 9 | 2+ frames, on the shortest beat in the catalogue |
| ball at the takeoff | **fell 5px** out of his hands | continuous by construction |
| airborne frames with nothing moving | **20%** | 1% |

**Leaving the floor was a switch.** The airborne pose engaged the instant the
lift crossed 3px. `rising` is a channel on the phase clock now and the pose is
drawn *at* it; arms and legs ride different curves off it, so going up the arms
lead and coming down the legs reach for the floor first.

**There was no extension.** One ease spanned the folded plant and the apex and
decided for itself how long he spends driving off the floor. Split at the floor,
with the share swept against two budgets (extension ≥2 frames, body ≤4px/frame)
rather than picked.

**The arm was on the wrong clock** — fully overhead while the ball was still at
his chest. Rendered frame by frame it read as a pole beside his head. It follows
the ball's *running maximum* now, which is also why a windmill's arm no longer
pumps as the ball orbits.

**The ball fell out of his hands.** Two blends fought at the takeoff: the windup
had carried it up from the dribble, and the first frame of the rise re-blended
*from the dribble* at nearly full weight and yanked it back down.

### Four things that were computed and thrown away

This turned out to be the theme. Each had been written, stamped on every
keyframe, and read by nobody:

- **`landing`** — four landing styles classified per dunk, one landing drawn.
  They differ by depth and recovery now (2.4px/183ms light to 5.4px/300ms
  heavy), and a stumble staggers 2px while the other three do not.
- **`contact`** — a dunk *through* a man was drawn exactly like a dunk past
  nobody. It costs him 3px mid-climb and he finishes at the same rim, which is
  the difference between a contact dunk and a blocked one.
- **`alley`** — `dunkPool` has known how to filter for an oop since it was
  written. The ball is in the *air* now: passer → flight → flight → caught at
  the hang → slam. 12.9% of dunks, and the pool rules are live at last.
- **`tall`** — see the fixed-rim section above.

### Built, because they did not exist

The brief listed Euro steps and spin finishes among "animations I have added";
they were not in the codebase. Both are now, as an **approach** on the layup
string — a finish used to begin at the gather, so every layup in the league was
a man who arrived at the rim already going up.

- **Euro**: two steps, opposite ways, the second one longer and on the longer
  beat. The torso leans into each.
- **Spin**: the rotation starts in the legs and reaches the torso 16% later, and
  the legs are drawn as a stride so that offset has something to show.

Both stay on the floor by construction — the moment either leaves the ground it
stops being footwork.

Measured over 8 games: **66 euro / 52 spin** in 366 finishes, worst floor
movement 1.30 units/frame — *less* than the stepback (1.58) or the dunk rise
(2.04) that already shipped.

The first version of the selector shipped as near-dead code: it gated the spin on
there being no lateral room, which is true of the move and true of almost no
possessions, so it fired 11 times against the euro's 79. The check asserts both
fire now, because "computed and never read" is the failure this whole section is
about.

### Checks added

`checkHePicksTheBallUpBeforeHeLeavesTheFloor`,
`checkTheHandGoesUpWithTheBallAndStaysThere`,
`checkTheApproachIsFootworkAndNotAHop`,
`checkTheAlleyOopIsCaughtInTheAir`,
`checkAContactDunkIsHitAndKeepsGoing`.

Two existing checks were **measuring paths the game does not draw**: the ball
readability check called `dunkBallPath` without the foot (the relative fallback,
not the rendered route), and the landing check tested only the unstyled curve
while `heavy` is 35% deeper. Both now test what ships. Same class as
CLAUDE.md's "a validator that calls a seeded function without its seed is lying."

## Not done

- **Ball-handling into dunks** (section 8) — crossover→takeoff→dunk as a
  continuous motion. The dribble string and the dunk string are still separate
  events with a beat between them.
- **The pro-hop and the hand-switch.** The euro and the spin are built; the rest
  of that family is not.
- **Contact is still rare** (13 in 8 games) because it keys off the poster
  marker and on-ball inside shots. The animation is built, correct and now
  actually drawn — what is missing is more situations recognising themselves as
  contact.
- **Approach direction** does not vary the dunk. `runway` is used, the angle is
  not.
