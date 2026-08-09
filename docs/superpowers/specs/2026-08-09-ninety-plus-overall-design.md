# 90+ Overall — Design

**Status:** design approved 2026-08-09, not yet planned.

**Goal:** Put player `overall` on a 2K-style scale where the best player in the
league reads 95 and a 90 is genuinely rare — without changing how the sim plays,
and while fixing the coefficient signs that currently punish inside scorers.

---

## The problem

Three separate things are wrong, and only the first one was asked for.

### 1. The ceiling is unreachable

`overall` is derived by regressing the 20 attributes against plus/minus per
minute (ZenGM's method, `scripts/fit-overall.js`), then scaled to mean 50 /
SD 9. On a normal distribution with SD 9, a 90 is +4.4 SD. In a 380-player
league that never happens.

Measured at HEAD:

```
n=380   mean=47.8   sd=9.89   max=78 (Luka)   min=29
>=80: 0     >=85: 0     >=90: 0
```

### 2. Five thresholds downstream of `overall` are dead or inverted

These were written for the OLD authored 62–98 scale. When `overall` became a
regression with mean 48, none were re-anchored:

| site | intent | catches now |
|---|---|---|
| `traits.js:107` superstar traits `>=85` \|\| pot `>=88` | the elite | **0 / 380** |
| `tradeEvaluator.js:82` star premium `>=80` | stars | **0 / 380** |
| `script.js:170` pause on star injury `>=80` | stars | **0 / 380** |
| `morale.js:41` "Limited role" gripe `>=65` | rotation-quality | 24 / 380 |
| `seasonTransition.js:21` retirement penalty `<65` | fringe players | **356 / 380 (94%)** |

Three are dead code. One is nearly dead. The retirement penalty has **inverted**
— written for fringe players, it now taxes 94% of the league.

Two more surfaced while planning, both in `tradeEvaluator.js`:

- **`LEAGUE_AVG_OVERALL = 75`** (`tradeEvaluator.js:89`) — a sixth constant from
  the old scale, against a real mean of 47.8. Only a fallback for an empty
  league, so harmless today, but it is the same rot.
- **`needMultiplier`'s `leagueAvg ± 10` band** (`tradeEvaluator.js:107-108`) —
  scale-sensitive. Raw SD is 9.89, display SD is ~7.06, so a literal 10 widens
  from 1.01 SD to 1.42 SD and the multiplier fires less often. A threshold is not
  the only thing a rescale breaks; **any constant compared against a rating is.**

The dead superstar gate means **eight authored traits have never once been
held by any player**: Alpha Dog, Ice in Veins, Two-Way Star, Floor General,
Unstoppable Force, DPOY Caliber, Franchise Cornerstone, Human Highlight Reel.
This is the same bug class as the 15 dead traits fixed in the live-badges work,
and it is exactly the gap the ratings plan named on its way out: *"Nothing here
asserted that a value DOWNSTREAM of overall still had a usable range."*

### 3. Five coefficients are negative

`insideScoring` at **−0.086** is the second-largest magnitude in the set, so
making a big man better at inside scoring *lowers* his overall. Also negative:
`freeThrow`, `passing`, `vertical`, `workEthic`.

These are collinearity artifacts, not signal. Every negative attribute has a
strongly-correlated partner carrying a large positive coefficient:

| negative | coef | correlated partner | partner's coef |
|---|---|---|---|
| `insideScoring` | −0.086 | `vertical` r=.71, `acceleration` r=.68 | acceleration **+0.109** |
| `freeThrow` | −0.036 | `midRange` r=.85, `threePoint` r=.81 | threePoint **+0.138** |
| `passing` | −0.017 | `ballHandling` r=.85 | ballHandling **+0.154** |
| `vertical` | −0.010 | `postScoring` r=.65 | postScoring **+0.156** |
| `workEthic` | −0.037 | `basketballIQ` r=.62 | basketballIQ **+0.099** |

Max correlation anywhere in the matrix is **0.910** (`interiorDefense`↔`block`).
At that level the individual coefficients are not identified — only sums along
correlated directions are.

**Direct evidence of non-identification:** the shipped fit (1800 games, 324
players, in-sample r 0.823) has five negatives. A re-run on 900 games of
different data has **two**
(`insideScoring`, `freeThrow`) — `passing`, `vertical` and `workEthic` flipped
sign purely from re-sampling. Coefficients that change sign run-to-run are not
measuring anything.

---

## What is NOT wrong

Both checked before designing, because the fix would differ:

**Star separation is healthy.** 600 games, by overall band:

| band | n | mpg | ppg | pts/36 | +/− per 36 |
|---|---|---|---|---|---|
| 70–99 | 9 | 36.1 | 26.0 | 25.9 | +10.75 |
| 62–69 | 30 | 35.2 | 20.2 | 20.7 | +5.62 |
| 55–61 | 51 | 33.2 | 16.4 | 17.8 | +2.91 |
| 48–54 | 100 | 26.5 | 9.5 | 12.9 | −1.49 |
| 40–47 | 88 | 14.5 | 4.5 | 11.2 | −5.99 |
| 0–39 | 22 | 9.3 | 2.4 | 9.2 | −13.09 |

Monotone across all six bands. Stars already play like stars.

**Aging works.** The game sim never reads `age` — aging happens entirely through
`progression.js` eroding attributes between seasons, which is correct and is
also how ZenGM does it. Luka averaged over 200 careers: peak **78.7 at age 28**,
declining to **58.5 at 40**. Under the display curve that 19.5-point arc becomes
~30 points, so a prime player and a faded one read as clearly different players.

---

## Design

### Two fields, two meanings

`overall` is currently one field carrying two jobs: a number the player reads,
and a proportional weight the sim consumes. Rescaling it for the first job
silently corrupts the second. This is the same failure as `level` in the
live-badges work, where one field meaning two things caused two crashes.

`ratings.js` defines both as non-enumerable getters:

- **`player.rawOverall`** — the raw fitted value (~29–78). Every **sim-facing**
  read uses this.
- **`player.overall`** — the **display** value, 2K-scaled 60–95. All UI, and all
  five thresholds.

Non-enumerable remains load-bearing: neither may serialise into a save, or a
loaded league carries a frozen value that never updates — the stored-overall bug
rebuilt through the back door.

**The sim-facing sites that must move to `rawOverall`:**

| site | what it does | why raw |
|---|---|---|
| `simEngineBoxScore.js:111` | `usageWeight = overall + traitBonus` | raw spans 29–78 = **2.69x** proportional spread; display spans 60–95 = **1.58x**. Display would flatten star usage by 40%. |
| `simEngineBoxScore.js:9` | `avgOverall` of top-8, team strength | level-sensitive; display shifts it +25 |
| `traits.js:187` | trait count `(overall − 45) / 9` | display would give every player ~3 extra traits |
| `traits.js:146` | `skill = (overall + potential) / 2` | feeds trait weighting; level-sensitive |
| `traits.js:300` | `ego = 30 + overall * 0.4` | display would inflate every ego |

`simEngineBoxScore.js:7` and `compositeRatings.js:106` sort by overall. The curve
is monotone, so order is preserved and either field works — they move to
`rawOverall` anyway, for one rule with no exceptions.

**Coaches carry their own `overall` and must not be touched.** It is
hand-authored on a 55–95 scale (`coaches.js:74`, `awards.js:118`,
`simEngineBoxScore.js:19`, asserted 55–95 in `validate-coaches.js:18`) and is not
derived from attributes. A blind `.overall` → `.rawOverall` rename corrupts it,
so every rename is checked against its receiver and a validator asserts no coach
ever gains a `rawOverall`.

Worth noting for confidence in the chosen scale: that coach scale was authored by
hand, from intuition about what a rating should look like, and it landed on
55–95. The new player display scale is 60–95. Players and coaches end up
comparable for the first time — today a 75 coach and a 75 player mean entirely
different things.

`simEngineBoxScore.js:111` is the dangerous one. Flattening usage from 2.69x to
1.58x would make stars take proportionally fewer shots — the exact opposite of
the requirement that stars perform like stars. The file already carries a scar
from this failure mode at `simEngineBoxScore.js:89-103`.

### `potential`

`potential` stays a **stored raw** value, because `progression.js` pulls players
by `potential − rawOverall` and save files already contain it.

A `player.potentialDisplay` getter is added for the UI. This is deliberately
asymmetric with `overall` (where the bare name is the display value) and that
asymmetry is a trap: a UI showing raw `potential` beside display `overall` would
render potential *below* overall for every player. **A validator asserts no file
under `ui/` reads `.potential` directly.**

### The curve

Piecewise linear with **absolute** knots. Never league-relative — a player's
number must not change because someone else joined the league.

```
display = 60 + (raw − 29) × 0.7143      for raw ≤ 78
display = 95 + (raw − 78) × 0.2273      for raw > 78
                                        clamped to [0, 100]
```

Resulting league:

```
Luka 95 | Jokic, SGA, Wembanyama 92 | Tatum, Giannis 91
starters 78-85 | rotation 70-77 | end of bench 60-68
mean 73   median 73   min 60   max 95
>=95: 1   >=90: 7   >=85: 27   >=80: 70   >=70: 259
```

The flatter slope above raw 78 is deliberate: it reserves 96–100 for a player
genuinely better than anyone currently alive. The cost is real and accepted —
only **5 points of display headroom** remain above today's best player, so
progression at the very top compresses. This matches 2K, where the best player
is 96–97 and nobody is a 99.

The knots are calibrated against today's raw distribution and **must be
re-derived after the NNLS refit**, which shifts every raw value.

### Non-negative coefficients

`scripts/fit-overall.js` swaps Gauss-Jordan for **NNLS by coordinate descent** —
clamp each slope at 0 each pass, leave the intercept unconstrained. Roughly 15
lines, still zero-dependency.

Measured on 900 games / 293 players:

| | in-sample r | negative coefficients |
|---|---|---|
| ridge (ships today) | 0.7333 | 2 |
| NNLS | 0.7204 | **0** |

Both columns are at 900 games, so they are a valid A/B against each other but
not against the shipped r of 0.823 (1800 games). The real refit runs at the full
game count, and the plan compares it to a ridge control at that same count.

Cost of the constraint: **1.8% relative r**. The top 10 reshuffles toward bigs —
Jokic 4th→2nd, Giannis 9th→6th, Tatum 10th→7th, Chet Holmgren out, Karl-Anthony
Towns in. 133 of 293 players move more than 10 league ranks, so this is a real
correction rather than a cosmetic one.

**This is a sim change, unavoidably.** `usageWeight` reads `rawOverall`, so
changing the coefficients changes who shoots. It gets its own calibration
against the target rates and its own golden regeneration.

### Re-anchoring the gates

Every gate moves out of its magic number into one **`RATING_BANDS` table in
`ratings.js`**, named by intent rather than by value:

```js
const RATING_BANDS = {
  superstar: 90, superstarPotential: 92, star: 85, rotation: 78, fringe: 68
};
```

Five scattered literals across five files is what allowed five separate gates to
rot unnoticed. One table means the next rescale is one edit — and it is what
makes the tripwire's mutation test meaningful: reverting a single call site to a
literal must fail the validator, which proves the site reads the table rather
than carrying its own copy. Without the table that property is unprovable.

Each band gets a stated *intent* and a target population share. The plan
**measures and solves** for the value; the numbers below are starting points, not
picked values.

| site | intent | proposed | catches |
|---|---|---|---|
| `traits.js:107` superstar traits | the genuine elite | `>= 90` \|\| pot `>= 92` | 7 (2%) |
| `tradeEvaluator.js:82` star premium | stars | `>= 85` | 27 (~1/team) |
| `script.js:170,172` pause on injury | worth interrupting for | `>= 85` | 27 |
| `morale.js:41` "Limited role" | good enough to deserve minutes | `>= 78` | 102 (27%) |
| `seasonTransition.js:21` retirement | fringe players | `<= 68` | 97 (26%) |

This revives the eight dead superstar traits and un-inverts the retirement
penalty.

### `scaleAttributesToOverall`

Commissioner edits and god mode call this to say "make this player a 90". The
target is now a **display** value. The fix is one line at the top: invert the
curve to a raw target, then run the existing solve unchanged. The existing
iterate-until-converged loop needs no other change, because it recomputes the
gap against `rawOverall` each pass.

---

## Sequencing

Order matters, because two of these tasks move the goldens and confounding them
would make both unmeasurable.

1. **Tripwire.** Assert every threshold catches a non-empty, non-total
   population. RED on arrival: three dead, one inverted.
2. **The split.** Add `rawOverall` + the display curve; repoint the five
   sim-facing sites. Thresholds untouched, so the tripwire stays red.
   **Goldens must not move.**
3. **Re-anchor the thresholds.** Tripwire goes green. Goldens still must not
   move.
4. **NNLS refit.** Goldens regenerate — once, here, with before/after league
   rates in the commit. Re-derive the curve knots against the new raw
   distribution and re-check every threshold's share.
5. **UI and verification.** Browser check that ratings read correctly wherever
   they are shown, full validator suite, fresh-clone verification.

Doing the split before the refit is what makes the containment claim testable:
task 2 proves the rescale changed nothing, so when task 4 moves the goldens,
that movement is attributable entirely to the coefficients.

---

## How this is verified

**The central guarantee: the goldens must not move in tasks 2 and 3.**
`scripts/fixtures/gamesim-golden.json` and `rollover-golden.json` stay
byte-identical. If either changes, a sim-facing site was pointed at the display
field. The whole risk class of this change collapses into one failing assertion.

**The tripwire — `scripts/validate-thresholdsAreLive.js`**, in the same spirit as
`validate-traitsAreLive.js`. For every threshold that reads a rating, assert the
population it catches is neither empty nor the entire league, and that its share
falls in the band its intent implies. This is the assertion that was missing when
the regression landed and left five gates dead; without it, the next rescale
silently kills them again.

**Additional assertions:**
- The curve is monotone and maps into [0, 100] across the full raw domain.
- The curve is absolute: the same attributes yield the same display value under
  a league with different membership.
- Every fitted coefficient is >= 0.
- No file under `ui/` reads `.potential` directly.
- `scaleAttributesToOverall(p, 90)` yields `p.overall === 90`.
- Neither `overall` nor `rawOverall` appears in `JSON.stringify(player)`.
- Star separation by band stays monotone in pts/36 and +/−36 (guards against a
  usage-flattening regression).

**Mutation testing**, per the standing rule — every new assertion gets its
protected behaviour broken to confirm the validator fails. Specifically: point
`usageWeight` at the display field and confirm the goldens move; revert one
threshold to its old value and confirm the tripwire fails.

**Fresh `git clone --local` of HEAD** for final verification, not the working
tree.

---

## Out of scope

- **League possessions** — 90.9/team vs NBA ~100, which is why scoring is 102.7
  rather than 108–118. Deferred, user's call.
- **Block rate** — `BLOCK_BASE 0.020` gives 1.78/team vs NBA 4.9. Sweep recorded
  in the code.
- **`player.status.morale`** ticks every game and no engine reads it. Same bug
  class as the dead traits and the dead thresholds; recorded in the live-badges
  spec and still unfixed.
- **A block badge is worth nothing below roughly `block` 50** — `BLOCK_MIN`
  swallows it. Defensible, since badge generation is skill-anchored, but real.
- **Widening the raw talent distribution** so 90s are earned by genuinely extreme
  attributes rather than by the axis. Explicitly declined: the ask was to
  renumber, not to re-balance. Revisit only if star impact per game measures too
  flat, which today it does not.
