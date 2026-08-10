# Dribble Counts — Design Note

**Date:** 2026-08-10
**Status:** Approved, NOT implemented
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

## Still to decide

- Whether ball-handling shifts the distribution and by how much. The 50/25/15/10
  figures are the league-wide shape; how much a 95 handler differs from a 60 is
  not yet specified.
- Where the count is chosen. `isoPlay` currently gates isolations at
  `(pi * 7 + ei) % 5 === 0`; the dribble count likely replaces that gate rather
  than sitting inside it, since a 0-dribble possession is the common case and
  should not require an isolation to be selected first.

## Verification this needs

- Measure the realised distribution against 50/25/15/10 over 40+ games. The
  lopsided mix above is exactly what goes unnoticed without this.
- The owner asked to SEE the moves rendered before sign-off, referring to a
  format used in an earlier session that is not recoverable from the current
  one. Confirm the format before building the preview.
- Browser verification is mandatory and cannot be done from Node —
  `scripts/ui-smoke.js` is a browser script that exits 0 under Node and proves
  nothing.
