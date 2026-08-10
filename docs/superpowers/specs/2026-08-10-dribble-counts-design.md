# Dribble Counts — Design Note

**Date:** 2026-08-10
**Status:** Implemented (d246db2, 0e8e767, 55fc088)
**Branch:** `live-game-sim`

## Why this replaces what just shipped

`88a0ee3` added a move vocabulary — crossover, behind-the-back, double move —
picked by hard ball-handling thresholds (65 / 80) and a three-sided roll.
Measured over 40 games afterwards, the mix was badly lopsided:

| move | per game |
| --- | --- |
| isolations, total | 15.85 |
| crossover | **13.13 (83%)** |
| behind-the-back | 1.68 |
| double move | 1.05 |

Two new moves accounting for one in six. Two causes, both in that commit:
the skill gates are high enough that most isolating players fall through to the
crossover default, and a three-sided roll leaves even a 95-rated handler doing
plain crossovers a third of the time.

The volume was fine — 15.85 isolations a game is dribbling on roughly one
possession in six. Only the MIX was wrong.

## The model

Replace "which named move" with **how many dribbles**, which maps to how long a
player holds the ball rather than to an animation name. Distribution, given
directly by the project owner:

| dribbles | share |
| --- | --- |
| 0 | 50% |
| 2 | 25% |
| 4-6 | 15% |
| 7+ | 10% |

Sums to 100. The owner's first draft totalled 95% and the remainder was
assigned to the 7+ bucket.

## Moves attach to the count

The count DRIVES the choreography — one system rather than two picked
independently:

| dribbles | choreography |
| --- | --- |
| 0 | no dribble beats; ball moves on |
| 2 | plain put-down, no named move |
| 4-6 | a crossover OR a behind-the-back |
| 7+ | the double move |

This removes the ball-handling thresholds that caused the lopsided mix. Skill
should instead bias the DISTRIBUTION — a great handler draws from the longer
buckets more often — rather than gating individual moves behind a cliff.

## Decided during implementation

**Ball-handling shifts the distribution**, by `DRIBBLE_SKILL_SHIFT = 0.12`
applied to the roll. A 95-rated handler works long (4+ dribbles) on 31% of his
possessions against 18% for a 40-rated one — a real difference with no cliff.
The old model's cliff (79 gets a crossover, 80 gets a double move) is what
produced the lopsided mix, so the replacement must never reintroduce one; the
validator asserts both a floor and a ceiling on the elite rate.

**The count replaces the gate.** Eligibility is unchanged — a man working on
the ball against a defender, outside — but it now only earns a roll instead of
deciding. The probe re-derives eligibility from the event log independently and
reads 82.5 possessions/game both before and after, which is how we know the
change did not disturb it.

**A five-dribble ceiling on the ankle-breaker's own string.** Forcing the count
up on an ankle-breaker made the size-up string and the crossover block run
together on every such possession. Both displace the defender along the same
axis, and they cancelled — separation measured 11.3px at the jab and 11.0px at
the clear, i.e. the crossover closing the gap it exists to open. The
ankle-breaker's four phases ARE its four dribbles; it no longer gets a second
string.

## Realised

`GAMES=40 node scripts/probe-dribbles.js`:

| dribbles | share | target |
| --- | --- | --- |
| 0 | 49.6% | 50% |
| 2 | 24.6% | 25% |
| 4-6 | 16.0% | 15% |
| 7+ | 9.7% | 10% |

The table shares (0.543 / 0.256 / 0.116 / 0.085) are NOT the target and must
not be "corrected" to it. Shots are weighted toward good handlers and skill
shifts the roll long, so a table set to 50/25/15/10 overshoots to
46.1/22.5/19.6/11.8. The table is the correction.

Move mix, against the 83%-crossover failure this replaced: put-down 813,
double 321, crossover 205, behind-the-back 165, ankle-breaker 158.

Cost: timeline 732.4s → 753.6s/game at 1x, +2.9%, against a +10% ceiling.

## Verified

- Suite 46/46, and 46/46 again from a fresh clone.
- Four mutants on the new assertions; two survived the first pass and both were
  inadequate assertions rather than dead code. Recorded in d246db2.
- Browser: all five string types build in a real page, counts land on 2/4/5/6/7/8
  with no 1s or 3s, and each move was rendered beat by beat through the game's
  own sprite renderer. Every request 200 except the known and accepted
  `assets/logos/MIA.png` 404.
