# Sprite Height Variation — Design Note

**Date:** 2026-08-10
**Status:** Implemented
**Branch:** `live-game-sim`

## The problem

Every player on the floor was the same 24px body. A 7'7" centre and a 6'0"
point guard had identical silhouettes, so nothing on the court told you who was
big — the one physical fact basketball is most obviously about.

The data was already there and unused: `heightIn` on every player, 72" to 91",
spread by position (PG mean 75.1, C mean 83.1).

## The model

`spriteTallness(heightIn)` returns pixels taller or shorter than the standard
body:

```js
const SPRITE_HEIGHT = { base: 79, perInch: 0.45, cap: 5 };
```

Baseline at 79" — the league median body — rather than the midpoint of the
range. Anchoring at the midpoint would make the whole league read as short,
because there are far more guards than seven-footers.

The result is an 8px spread from shortest to tallest on a 24px body. The owner
chose this deliberately over 3px and 5px alternatives, having been shown all
three and told what the largest one costs.

## Feet stay on the floor

All growth is upward from `y`. Growing downward would sink a tall man through
the court; growing from the middle would leave a short one hovering.

## The difference is split, not dumped in the legs

First cut put the whole delta into leg length, because that is where a 24px
sprite has room. At an 8px spread that gave a 6'0" guard **3px legs** — half
the standard 6 — and he read as *stubby* rather than as *short*, which is a
different and much worse thing.

Sixty per cent now goes to the legs and forty to the torso, so both scale:

| | legs | torso |
| --- | --- | --- |
| 6'0" | 4px | 7px |
| standard | 6px | 8px |
| 7'7" | 9px | 10px |

Tall people are leggy, so the legs keep the larger share — but nobody gets
halved.

## Mutation testing

Six mutants. Two survived the first pass, and neither was dead code in the
usual sense:

| mutant | first pass | why |
| --- | --- | --- |
| all the delta into the legs | KILLED | |
| variation switched off | KILLED | |
| grows downward | KILLED | |
| cap removed | **SURVIVED** | the cap is genuinely unexercised |
| legs never change | **SURVIVED** | assertion gap |

**The cap does not bind anywhere in the real league.** The tallest player is
91", which gives 5.4 and rounds to 5 — the cap value itself. It exists for the
tuning knob above it and for a future outlier. Rather than delete a guard rail
or leave it unexercised, it is now asserted directly (`spriteTallness(120)`).

**Legs never changing passed everything else.** A floor of 4px was not enough:
sending the whole difference into the torso keeps every leg at the standard
6px, clears the floor, and produces a seven-footer with a guard's legs and an
enormous chest. Now asserted to grow.

## Verification

- `checkSpriteHeightVariation` measures the DRAWN silhouette — it collects
  every rect the sprite emits and reads the real body — rather than
  re-deriving geometry from the same constants the code uses, which would pass
  no matter what the sprite looked like.
- Monotonic across 60"-100": an inch taller is never a shorter sprite.
- Missing height must not throw or distort. Several call sites draw a sprite
  with no player attached (the referee, a leaver mid-substitution).
- Suite 46/46.
- Browser: two real starting fives drawn from real rosters through the game's
  own renderer; every roster player carries `heightIn`, and one 14-man roster
  produces five distinct sprite heights.

## Worth knowing

A single team rarely shows the full 8px. The roster checked in the browser
spanned -2px to +2px, because it had no true seven-footer. The 8px figure is
the league extreme, not the typical sight.

## Not done

Width. `weightLb` exists and is unused, so a heavy centre is as narrow as a
wiry guard. That is a separate change and was not asked for.
