# Game Plan Dials — Implementation Plan

**Goal:** wire the coaching screen's Pace and Three-Point Rate dials into the
possession engine, which is the only engine anybody runs.

**Architecture:** the three-point dial rides on `gameCtx` into `pickShotZone` as
one more weight multiplier; the pace dial is blended between both teams once per
game and subtracted from `POSSESSION_BASE_SECONDS`. Both are guarded so a
neutral dial is an exact no-op.

**Tech Stack:** vanilla ES5-style JS, no build step, no imports. Tests are
standalone `scripts/validate-*.js` run with `node` + `assert`.

Design: `docs/superpowers/specs/2026-08-17-game-plan-dials-design.md`

---

## What was measured first

1. **Both dials were inert.** Sweeping `threePointRate` over five settings
   across 80 games gave byte-identical output every time: 26.7% three-point
   share, 10,125 attempts, 111.07 points a game. Same for pace.
2. **Root cause, by grep.** `strategy` and `threePointRate` appear zero times in
   `simEnginePossession.js` and zero times in `gameSim.js`. Only
   `simEngineBoxScore.js` reads them; `simEngine.js:24` defaults to the other
   engine.
3. **The whole league sits at neutral.** `TEAMS.filter(t => t.strategy).length`
   is **0 of 30** — teams have no strategy object at all until
   `ensureTeamCoach` makes one, flat at zero. Nothing ever moves an AI team's
   dial, despite `coaches.js:36` claiming a hired coach leans them.

Finding 3 is what made the goldens survivable, and it inverted the plan: this
was expected to require regenerating `gamesim-golden.json` and did not.

## Global constraints

- **A neutral dial is an exact no-op**, so the golden masters must pass
  unregenerated. If they move, the guard is wrong.
- No rng draw added, moved, or removed.
- No `import`/`export`.
- No base rate, shot percentage, or clock constant is recalibrated.

---

### Task 1: The three-point dial reaches the shot

**Files:** `simEnginePossession.js`, `gameSim.js`

- `pickShotZone` gains a fifth parameter, `threeRateDial`, applied as
  `three *= 1 + THREE_RATE_DIAL_STRENGTH * threeRateDial` behind an
  `if (threeRateDial)` guard.
- `THREE_RATE_DIAL_STRENGTH = 0.33`, solved from `simEngineBoxScore`'s `0.06` of
  share per unit — see the design doc.
- `simulatePossession` reads `gameCtx.threeRate`, same shape as `scoreDiff`.
- `gameSim.js` supplies the **shooting** team's dial, read per possession so a
  live watched game follows a change made mid-game.

**Status: done.** Measured 20.6% → 26.7% → 32.4% across the three offered
settings, an 11.9-point swing.

---

### Task 2: The pace dial reaches the clock

**Files:** `gameSim.js`

- `possessionSeconds(rng, paceBlend)`; `PACE_DIAL_SECONDS = 0.55`, subtracted so
  Fast shortens the possession.
- `sim.paceBlend` is `(paceFor(home) + paceFor(away)) / 2`, resolved once at
  `createGameSim` rather than per possession — the clock must not jump under a
  live watched game.
- `paceFor` / `threeRateFor` read a dial off a team that may have no `strategy`
  object at all.

**Status: done.** Measured below.

---

### Task 3: A validator that fails against the old engine

**Files:** `scripts/validate-gamePlanDials.js` (new)

Six checks. Every one of them fails against the engine as it was, which is the
point — a control that does nothing passes any test that only asks whether the
game still runs.

**Status: done.** All six pass; see the table below for what they report.

---

### Task 4: Goldens and the probe

**Status: done.** Goldens passed unregenerated. `probe-shotZones.js` section 2
flipped, and a section 4 was added for pace.

---

## What was measured and what was left undone

64 → 65 validators, all green. Golden masters **unregenerated and passing**.
ui-smoke 200/0. Zero console errors.

### The three-point dial is a style lever

| setting | three share | rim share | mid share | points |
|---|---|---|---|---|
| Low (−1) | 20.6% | 52.5% | 26.9% | 108.8 |
| Balanced (0) | 26.7% | 48.8% | 24.5% | 109.0 |
| High (+1) | 32.4% | 45.5% | 22.1% | 110.0 |

An 11.9-point swing in shot mix for **1.2 points** of scoring. That is the
result the design asked for: it changes how a team scores, not how much. The
extra threes are paid for out of both other zones in proportion, which is what
the weight-multiplier approach buys over adding to a share.

Landed at 32.4% against a solved-for target of 33.6% — the difference is that
the target arithmetic assumed a fixed baseline share, while every player's own
tendencies shift under the multiplier by different amounts.

### The pace dial is a volume lever, and the bill is stated

| setting | home points | team FGA |
|---|---|---|
| both slow | 103.9 | 6,452 |
| user slow, league neutral | 107.4 | 6,593 |
| neutral | 109.0 | 6,732 |
| user fast, league neutral | 112.5 | 6,959 |
| both fast | 115.4 | 7,134 |
| opposed | 109.0 | 6,732 |

**The middle rows are the ones that happen.** Every AI team sits at 0, so a real
save only ever reaches the ±0.5 blend — about ±3 points, comfortably inside the
99-115 band `PERIOD_SECONDS` was calibrated to hold.

"Both fast" at 115.4 grazes the top of that band, and is reachable only if AI
teams ever start setting dials. That is the first thing to re-measure if the
out-of-scope item below is ever picked up.

**Opposed dials cancel to exactly the neutral game** — same 6,732 attempts, not
merely a similar number. The validator asserts strict equality, which is a
stronger statement than a tolerance and only holds because the blend is
arithmetic rather than a per-team override.

### The goldens did not move, and that is load-bearing

The task this came from assumed `gamesim-golden.json` would need regenerating.
It did not, because the whole league is neutral by default and both dials are
guarded to be exact no-ops there. `checkNeutralDialsAreByteIdentical` asserts
this directly: 5,000 draws with a zero dial against 5,000 with an absent one,
identical sequences, plus 500 paired draws proving the pre-dial four-argument
call shape is unchanged.

Not regenerating is the better outcome. A regenerated golden proves nothing
about what changed; a surviving one proves the league nobody configured plays
exactly the game it did before.

### Left undone

- **AI coaches still never set their dials**, despite `coaches.js:36` saying a
  hired coach leans them toward their specialty. Doing it would move league-wide
  scoring and shot distribution and needs its own measurement pass. Leaving it
  is also what confines this change to the user's own games.
- **The two engines still disagree on shot diet** (27.6% vs 21.5% from three).
  Both now respond to the dials; they are simply different models.
- `ui/coaching.js`'s caption — "a real but modest effect on pace and shot
  selection" — is now true. It was the only claim in the panel that needed
  fixing, and it needed the engine to change rather than the text.
