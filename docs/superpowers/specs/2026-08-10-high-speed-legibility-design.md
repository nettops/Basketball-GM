# Watching at Speed — Legibility Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Branch:** `live-game-sim`

## The problem

Watching a game at 4x or 8x, two things stop working:

1. **You cannot follow the ball.** Players and the ball move too fast to track.
2. **Big moments blur past.** A dunk, a block, a crossover gets the same
   treatment as a routine possession and is gone before you register it.

Notably NOT a problem, per the person watching: the text feed and unexplained
score jumps. This design does not touch either.

## What is already there, and why it works against us

The watch view already degrades on the **audio** side as speed rises — sound
effects stop above 4x, dribble sounds above 2x. Nothing adapts visually.

Worse, the one visual emphasis that exists is switched OFF exactly where it is
needed. `ui/pixelImpact.js`:

```js
function impactFreezeMs(marker, opts) {
  if (o.reduceMotion) return 0;
  if (o.speed >= 8) return 0;                    // no freeze at all
  if (o.speed >= 4) return Math.round(base / 2); // half freeze
  return base;
}
```

and `armImpactZoom` likewise returns early at `speed >= 8`, so the camera push
is disabled too.

The original reasoning was presumably "someone who chose 8x wants to go fast,
do not interrupt them." That gets the need backwards: **the faster the game
runs, the more it has to tell you something mattered.** At 1x you can see the
dunk perfectly well without help. At 8x it is a smear.

## Goals

1. At any speed, you can see where the ball is.
2. At any speed, the moments worth watching announce themselves.
3. High speed becomes the *preferred* way to watch, not a compromise —
   skip the routine, land on the highlight.

## Non-goals

- The text feed and commentary are untouched.
- No new visual system. Everything lands in the existing effects module and the
  existing court renderer.
- Reduced motion continues to disable every freeze, zoom and trail. It is an
  accessibility setting and it wins over all of this.

## The measurement that shaped the design

The classifier (`classifyImpact` in `ui/pixelChoreographer.js`) tags three
kinds: `poster` (a dunk over someone), `ankle` (a crossover into a made
jumper), and `block`. Measured over 60 games:

| kind | per game |
| --- | --- |
| block | 4.5 |
| poster | 2.0 |
| ankle | 1.7 |
| **total** | **8.3** (median 8, range 2-17) |

At 8x a full game plays in well under a minute. **8.3 freezes in that window is
a stutter every few seconds, not emphasis.** And the bulk of them are blocks —
simultaneously the most common and the least spectacular of the three, which is
why they were already excluded from the camera push.

So the answer is not "freeze at 8x". It is that **the bar for what earns a
freeze rises with speed.**

## Part 1 — Emphasis that scales with speed

Two changes to the same function, replacing the current fade-out.

**a) The bar rises with speed.** Which kinds qualify:

| speed | qualifies |
| --- | --- |
| 1x, 2x | poster, ankle, block (unchanged from today) |
| 4x | poster, ankle |
| 8x | poster only |

At 8x that is ~2.0 freezes per game — the game rips through possessions and
stops dead on the dunk. That is the experience being bought.

**b) For what does qualify, emphasis grows rather than shrinks.** A freeze is
measured in real milliseconds, but at 8x each real second consumes eight times
the game. The same freeze therefore buys proportionally less emphasis. Freeze
duration scales UP with speed for the kinds that still qualify, and the camera
push is enabled at every speed.

Precisely, so this cannot be read two ways: the freeze is a pause in playback
measured in REAL milliseconds. Today a poster freezes for a fixed base at 1x.
The new duration is `base × min(speed, 4)` — so 1x is unchanged, 4x and 8x both
land at four times the base and nothing exceeds that ceiling. The cap exists
because past roughly a second of real time a freeze stops reading as emphasis
and starts reading as a hang; capping at 4 rather than letting 8x scale freely
is what keeps it the right side of that line.

That multiplier is a starting point to be confirmed by watching, not a derived
constant — but it is written down as an exact expression so the implementer has
something to test against rather than a judgement call.

**Interaction rules, so it never fights the viewer:**
- A viewer action always wins. Changing speed or hitting pause during a freeze
  cancels it immediately rather than queueing.
- Freezes never stack. If two qualifying moments land close together, the
  second is dropped rather than extending the first.

## Part 2 — Never lose the ball

**A trail behind the ball.** A short fading tail of recent ball positions,
drawn under the sprites so it never obscures a player.

**A ring under the ball handler.** Every frame carries the ball's position and
who is holding it, so this needs no new data.

Both scale with speed: barely present at 1x, prominent at 8x. The slow game
stays clean; the fast game stays followable. Both are suppressed entirely under
reduced motion, alongside the freezes and zooms.

## Where the code goes

| File | Change |
| --- | --- |
| `ui/pixelImpact.js` | `impactFreezeMs` and `armImpactZoom` — the speed relationship inverts, and a qualifying-kind check by speed is added. |
| `ui/pixelCourt.js` | Draws the ball trail and the handler ring. |
| `ui/pixelGameView.js` | Feeds recent ball positions to the renderer; passes speed through. |
| `scripts/validate-impactMoments.js` | Existing assertions on the old speed behaviour must be REPLACED, not deleted — they currently assert the exact behaviour being inverted. |

No new files. No new systems.

## Testing

- **`scripts/validate-impactMoments.js`** — the existing tests assert
  `impactFreezeMs(poster, {speed: 8}) === 0` and that 4x is half. Those encode
  the behaviour being deliberately reversed, so each is rewritten to assert the
  new relationship: freeze at 8x is non-zero for a poster, zero for a block,
  and grows with speed rather than shrinking. Reduced motion still returns 0 at
  every speed — that assertion stands unchanged.
- **New assertions** for the qualifying bar: a block qualifies at 2x and not at
  8x; a poster qualifies at every speed.
- **Mutation testing.** Every new assertion is mutation-tested; a surviving
  mutant means the assertion is worthless or the code is dead, and the finding
  must say which.
- **Browser verification is mandatory and cannot be skipped.** This is a
  feature about how something *looks*, and no Node assertion can see it.
  `scripts/ui-smoke.js` is a BROWSER script — running it under Node exits 0 and
  proves nothing. Verification means watching a real game at 1x, 4x and 8x on a
  served page and confirming: the ball is trackable at 8x, a poster stops the
  game and reads clearly, a block does not interrupt at 8x, and reduced motion
  produces none of it.

## Risks

- **Stutter.** The whole design rests on the qualifying bar keeping 8x at ~2
  freezes a game. If the measured rate drifts (a balance change moves dunk
  frequency), the bar has to move with it. The rate probe is cheap to re-run.
- **The trail obscuring play.** Drawn beneath the sprites and kept short
  specifically to avoid this; if it still reads as clutter at 8x, shorten it
  rather than fading it out, since fading defeats the purpose.
- **An inverted freeze feeling like a bug.** A game that stops dead could read
  as a hang rather than emphasis. The camera push landing at the same moment is
  what distinguishes "this is a moment" from "it froze" — which is why the zoom
  is enabled at 8x rather than left disabled.
