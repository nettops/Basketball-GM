# Shot Zones, On/Off, and Game Recaps — Implementation Plan

**Goal:** surface three things the engine already computes and discards — the
zone every shot came from, what a player's team did with him on the floor, and
what happened in the games nobody watched.

**Architecture:** four new keys on the possession engine's box line, added to the
one array (`SEASON_STAT_KEYS`) that already carries a statistic from a single
possession to a career team-by-team total. Recaps are composed when a game is
recorded, not on demand, because box scores do not survive a save.

**Tech Stack:** vanilla ES5-style JS, no build step, no imports. Tests are
standalone `scripts/validate-*.js` run with `node` + built-in `assert`.

Design: `docs/superpowers/specs/2026-08-17-shot-zones-and-recaps-design.md`

---

## What was measured first

Four findings, all read out of the source before any code was written.

1. **The zone is computed and dropped.** `pickShotZone`
   (`simEnginePossession.js:301`) classifies every attempt as inside/mid/three
   and the value is used four times — defender selection, shooting composite,
   block pricing, play-by-play text — then goes out of scope. Only the
   three-point zone reaches a box score, via `tpa`/`tpm`.

2. **It happens for all thirty teams.** `simEngine.js:24` defaults to
   `'possession'`, so this is not user-team-only data.

3. **Adding a key to `SEASON_STAT_KEYS` writes NaN into every existing save.**
   Both accumulation sites — `league.js:144` and `careerHistory.js:111` — do
   `container[key] += line[key] || 0`. The guard covers the incoming line, not
   the accumulator. An old `seasonStats` object or an open `teamHistory` entry
   has no such key, so the first game after loading computes `undefined + 0`.
   Nothing migrates either container.

4. **`plusMinus` already exists per game and dies there.** It is in
   `initBoxLine` (`simEnginePossession.js:234`) and absent from
   `SEASON_STAT_KEYS`.

## Global constraints

- **No rng draw may be added, moved, or removed.** Every number here is
  read-only with respect to simulation. `scripts/validate-gamesim.js` and the
  sim goldens must be byte-identical before and after.
- **No `import`/`export`.** New root-level files need a `<script>` tag in
  `index.html` in dependency order or they do not exist at runtime.
- **A validator that calls a seeded function without its seed is lying.** Every
  possession-level assertion passes an explicit seed.
- Old saves must load and continue without the player triggering anything.

---

### Task 1: A stat spine that survives being extended

Must land before any new key is added, and is independently correct today.

**Files:**
- Modify: `league.js`, `careerHistory.js`
- Test: `scripts/validate-careerTotals.js`, `scripts/validate-careerHistory.js`

**Change:** seed the accumulator, not just the addend, at both sites.

```js
// league.js — accumulateSeasonStats
SEASON_STAT_KEYS.forEach(function (k) {
  player.seasonStats[k] = (player.seasonStats[k] || 0) + (statLine[k] || 0);
});

// careerHistory.js — recordSeasonInHistory
const tk = 'total' + capitalize(key);
entry[tk] = (entry[tk] || 0) + (stats[key] || 0);
```

**Verify:** a test that builds a `seasonStats` object and an open `teamHistory`
entry with the *old* key set, accumulates a line carrying a new key, and asserts
the result is a number rather than NaN. This test must fail against the current
code — run it before the fix and confirm it does.

---

### Task 2: Every attempt records where it came from

**Files:**
- Modify: `simEnginePossession.js`
- Test: `scripts/validate-shotZones.js` (new)

**Interfaces:**
- `initBoxLine()` gains `insideFga`, `insideFgm`, `midFga`, `midFgm`.
- No signature changes. `pickShotZone` already returns the value needed.

**Three increment sites**, all inside `simulatePossession`, all already branching
on `zone`:

| site | line (current) | what to add |
|---|---|---|
| blocked shot | `simEnginePossession.js:1000` | zone attempt |
| shot resolved | `simEnginePossession.js:1028` | zone attempt |
| shot made | `simEnginePossession.js:1034` | zone make |

Write these as bare literal branches beside the existing `if (zone === 'three')`
lines rather than a computed key — the file's own convention is that a static
reader must be able to see the engine's vocabulary without running it.

**Invariants the validator asserts over a seeded game:**

```
insideFga + midFga + tpa === fga     (per player, and summed per team)
insideFgm + midFgm + tpm === fgm
insideFgm <= insideFga, midFgm <= midFga
```

The blocked-shot branch is the one a careless test misses: it increments `fga`
without ever reaching the make path. Assert a game in which at least one block
occurred.

---

### Task 3: The keys reach the season, the career, and the save

**Files:**
- Modify: `league.js`
- Test: `scripts/validate-shotZones.js`, `scripts/validate-careerTotals.js`

Add `insideFga`, `insideFgm`, `midFga`, `midFgm`, and `plusMinus` to
`SEASON_STAT_KEYS` (`league.js:50`).

Nothing else is written: `accumulateSeasonStats`, `makeTeamHistoryEntry`, and
`recordSeasonInHistory` all iterate that array, so season totals, `total<Key>`
team-history fields, and career accumulation follow for free. That is the payoff
for Task 1 and the reason it goes first.

**Watch:** `getPlayerAverages` (`league.js:148`) is a hand-written object and does
*not* iterate the array. It needs the new rate stats added deliberately —
`insideFgPct`, `midFgPct`, and the zone attempt shares — each guarded against a
zero denominator the way `fgPct` already is.

---

### Task 4: The other engine answers the same question

**Files:**
- Modify: `simEngineBoxScore.js`
- Test: `scripts/validate-shotZones.js`

`deriveShootingLine` (`simEngineBoxScore.js:161`) invents a line from a points
total and is selectable in settings (`ui/settings.js:120`). It already derives a
`threeShare` from `hiddenTendencies.threeTendency`; split the two-point
attempts across inside and mid using `insideTendency`/`midTendency` from the same
object, with the same neutral-33 fallback `pickShotZone` uses.

The same two invariants from Task 2 must hold for this engine's output. Assert
them against both engines in one test so neither can drift from the other.

---

### Task 5: The shot chart, and the dial that finally has a readout

**Files:**
- Modify: `ui/playerProfile.js`, `ui/roster.js`, `ui/coaching.js`
- Test: `scripts/ui-smoke.js`

Three zones, drawn as three regions of a half court — not a scatter of dots. The
engine has zones, not coordinates, and inventing positions inside a zone would be
a picture of a model we do not have.

Per player: attempts, makes, and percentage by zone, plus the share of his
attempts each zone accounts for. Per team the same, on the roster view.

**On `ui/coaching.js`:** show the team's actual three-point attempt share beside
the `threePointRate` dial that is supposed to move it. This is the feedback loop
the design document exists to close — a player sets the dial, sims a month, and
can see whether anything happened.

Follow `ui/playerProfile.js`'s existing conventions and use `escapeHtml`
(`ui/util.js`) for any interpolated text.

---

### Task 6: Defensive field-goal percentage comes out of hiding

**Files:**
- Modify: `ui/playerProfile.js`, `ui/roster.js`
- Test: `scripts/ui-smoke.js`

`oppFga`/`oppFgm` have been accumulating to season and career totals since they
were added and no screen reads them. Surface DFG% (`oppFgm / oppFga`) and season
plus/minus, guarded against a zero denominator.

No engine change. This task is a view and nothing else — it is listed separately
because it is shippable on its own and because "the defensive badge is invisible"
is the exact problem the box line comment at `simEnginePossession.js:234` says
these fields were added to solve.

---

### Task 7: The games nobody watched get a sentence

**Files:**
- Modify: `league.js` (`recordGameResult`), `ui/leagueNews.js`
- Test: `scripts/validate-leagueNews.js`

Compose the recap in `recordGameResult` (`league.js:55`), where the box score is
still in memory, and store it as a short string on the game object. It must be
composed there and not on demand: `save.js` prunes box scores and play-by-play to
the user's own games (`save.js:133`, `save.js:314`), so an on-demand recap would
return nothing for twenty-nine teams out of thirty.

Content: the score, the leading performance on each side, and the single most
notable thing that happened — the feat, takeover, or impact moment if one fired,
since `recordGameFeats` and `recordGameTakeovers` already run right there
(`league.js:69-70`).

Render through `ui/leagueNews.js`, which already has `allPlayedLines`,
`computeHighlights`, `computeTopPerformances`, and a category/pill system to
slot into.

**Watch:** a stored string on every game for a full season across many seasons is
the only new storage cost in this plan. Keep it to one line and confirm the save
size against a twenty-season run before calling this done.

---

### Task 8: Measure that the loop actually closed

**Files:**
- New: `scripts/probe-shotZones.js`
- Test: full validator sweep

A probe, not a validator — it reports, it does not assert.

- League-wide zone shares over a simmed season. Expect roughly 30% of attempts
  from three, matching the calibration recorded in `simEnginePossession.js`. A
  number far from that means Task 2 is miscounting, not that the league changed.
- The same split for a team with `threePointRate` at each dial setting. **If the
  share does not move, the feature has failed** regardless of every test passing
  — that is the whole point of the work.
- Transition versus half-court zone shares, which should reproduce the ~63%
  at-the-rim figure the transition multipliers were calibrated to.

Then: all 64 validators green, sim goldens byte-identical, `ui-smoke.js` clean.

---

## Notes for whoever picks this up

- Task 1 is not optional and is not a nicety. It is a live save-corruption bug
  that this feature would trigger; it is worth landing on its own even if the
  rest of the plan is dropped.
- Tasks 5, 6, and 7 are independently shippable once 1–4 are in.
- The temptation in Task 5 will be to draw a real shot chart with scattered
  points. Resist it — three zones is what the engine knows, and a chart that
  implies more precision than the model has is a lie told in pixels.

## What was measured and what was left undone

All eight tasks landed. 64 validators green, sim goldens byte-identical,
ui-smoke 200/0, zero console errors.

### The save-corruption bug was real

Task 1's test failed against the live `accumulateSeasonStats` before the fix,
exactly as predicted, and the same bug was confirmed at the `careerHistory.js`
site. Both are fixed and both tests assert the *property* — they extend
`SEASON_STAT_KEYS` at runtime and put it back — so they keep guarding whatever
key is added next rather than only the four added here.

### The league's shot diet, measured over 600 games

| zone | share | FG% |
|---|---|---|
| at the rim | 49.3% | 56.2% |
| mid-range | 23.1% | 45.5% |
| three | 27.6% | 37.6% |

27.6% from three against the ~30% the engine's own calibration comments claim.
Close enough to confirm the counters are wired to the right branches, and the
gap is a measurement difference rather than a defect: the engine's figure was
taken over a different sample.

### The probe found a real defect, and it is not in this work

**The coaching dials do nothing under the default engine.** Sweeping
`team.strategy.threePointRate` across all five settings over 80 games produced
byte-identical output — 26.7% three-point share at every setting, the same
10,125 attempts and the same 111.07 points per game at the extremes.

Root cause, confirmed by grep and by measurement: `strategy` and
`threePointRate` appear **zero times** in `simEnginePossession.js` and zero
times in `gameSim.js`. Only `simEngineBoxScore.js` reads them, and that is not
the default engine (`simEngine.js:24`). The same is true of the pace dial.

So `ui/coaching.js`'s "a real but modest effect on pace and shot selection" is
false for anyone who has not changed engines in settings — which is everyone by
default. **This predates this plan** and was invisible until the shot chart made
shot mix observable, which is precisely what a probe is for.

It is deliberately **not fixed here**. Wiring the dial into the possession
engine changes shot selection, which moves every golden and needs its own
calibration sweep; this repo's own convention is that a balance change does not
ride along inside another change. It needs its own spec, plan, and golden
regeneration.

The readout added to the coaching screen is still honest — it reports the team's
actual shot share against the league's, which is true regardless of what moved
it. But it currently sits underneath a control that does nothing.

### Transition vs half court

Drawing `pickShotZone` directly, 40,000 draws each:

| | rim | mid | three |
|---|---|---|---|
| half court | 38.0% | 28.7% | 33.3% |
| transition | 58.0% | 9.5% | 32.4% |

The three-point share holds nearly flat (33.3% → 32.4%) while the mid-range
collapses and the rim climbs, which is exactly the behaviour
`TRANSITION_MID_MULT` was introduced to produce. The rim figure reads 58%
against the ~63% recorded in the engine's comment; that comment was measured
in-game, where possession context also selects the shooter, while this draws
zones for a fixed player pool. Different measurement, not a regression.

### Left undone

- **Five-man lineup and on/off-court splits.** Out of scope from the start;
  needs lineup keys maintained across substitutions in `gameSim.js`.
- **The dead coaching dials**, above.
- **Box-score engine divergence.** Its zone split is an approximation over a
  points total and lands at 21.5% from three against the possession engine's
  27.6%. Both are self-consistent and both invariants hold; they simply are not
  the same model. Worth a look if that engine ever becomes the default.
- `README.md` still tells a new player to open `index.html` directly, which
  `CLAUDE.md` explicitly forbids. Untouched, unrelated.
