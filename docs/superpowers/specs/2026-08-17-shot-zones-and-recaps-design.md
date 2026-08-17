# Shot Zones, On/Off, and Game Recaps — Design

**Goal:** stop throwing away three things the engine already computes — where
every shot came from, what a player's team did with him on the floor, and what
happened in the 1,230 games a season the player never watches.

**The one-line version:** no new simulation. Every number below is already
produced, per possession, for all thirty teams, and discarded microseconds
later. This is a plumbing and surfacing job.

---

## What the genre says is missing

The most useful document in the competitive research was not a feature list, it
was the *criticism* section of a Basketball GM review: no shot charts, no
lineup or on/off statistics, no game recaps, an empty news section, and "everyone
is playing the same style". Draft Day Sports 26 sells a modernized dashboard and
AI that "creates unique league storylines"; Football Manager 26 sells journalists
who remember what you told them last week.

We are on the opposite side of that ledger. `coaches.js` gives every team a pace
and three-point-rate dial. `simEnginePossession.js` routes defense by zone,
prices traits and badges per zone, and tracks what a player allowed as the shot
defender. `ui/leagueNews.js` exists and has a feed.

**And none of it is visible.** A player can set their three-point-rate dial to
its highest setting and there is no screen in the game that will tell them
whether the shot mix moved. That is the actual defect: not that we lack a
feature, but that an existing feature has no feedback loop.

---

## What is already there

Three measurements, all read out of the source before any of this was designed.

1. **Every shot already knows its zone.** `pickShotZone`
   (`simEnginePossession.js:301`) returns `inside`, `mid`, or `three` for every
   field-goal attempt, driven by the shooter's hidden tendencies, transition
   state, and any active takeover bias. The zone is used to pick the defender,
   choose the shooting composite, price the block, and write the play-by-play
   line — and is then dropped on the floor. Only `tpa`/`tpm` survive, so the
   three-point zone is the *only* one that reaches a box score.

2. **The possession engine is the league default, not a spectator mode.**
   `simEngine.js:24` defaults to `'possession'`, and the comment there is
   explicit that this is what "keeps unwatched games under the same rules". Every
   game in the league is resolved shot by shot. This is what makes league-wide
   zone data free rather than user-team-only.

3. **Defensive field-goal data is already banked.** `initBoxLine`
   (`simEnginePossession.js:234`) carries `oppFga`/`oppFgm` — what a player
   allowed as the assigned shot defender — and both are already in
   `SEASON_STAT_KEYS` (`league.js:50`), so they accumulate to season and career
   totals today. Nothing in the UI reads them.

---

## Two findings that changed the design

### The stat spine is one array, and it is load-bearing

`SEASON_STAT_KEYS` (`league.js:50`) is consumed by four separate systems:
`accumulateSeasonStats` seeds and sums season lines from it,
`makeTeamHistoryEntry` derives `total<Key>` fields from it, `recordSeasonInHistory`
writes both the season record and the team-history totals through it.

Adding a key to that one array therefore carries a new statistic all the way
from a single possession to a player's career team-by-team splits, with no other
accumulation code written. That is the whole reason this work is cheap.

### Adding a key to that array corrupts every existing save

Both accumulation sites use `+=` against a value seeded when the container was
created:

```js
// league.js:144
SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] += statLine[k] || 0; });

// careerHistory.js:111
entry['total' + capitalize(key)] += stats[key] || 0;
```

The `|| 0` guards the *incoming* line. It does nothing for the *accumulator*. A
save made before this change has a `seasonStats` object and open `teamHistory`
entries that predate the new keys, so the first game simmed after loading it
computes `undefined + 0` and writes **NaN** — into season stats, and into career
team totals, permanently.

**And the corruption hides.** `JSON.stringify` writes NaN as `null`, so the bad
value does not survive a save/load round trip as anything that looks wrong — it
comes back as `null`, and `null + 0` is `0`. The visible symptom is therefore not
a NaN on screen but a statistic that quietly resets to zero every time the game
is loaded, which is considerably harder to trace back to here.

Neither container is versioned or migrated; `save.js` keeps a
`SAVE_FORMAT_VERSION` but only refuses saves from the *future* (`save.js:268`).
So the seeding has to be defensive at the accumulation sites rather than handled
by a migration pass — a returning player must not have to trigger anything.

**This is the single highest-risk line of the whole plan** and it is why Task 1
is "make the spine safe to extend" rather than "add zone keys".

---

## Scope

### Four new stat keys, not six

The zone split needs `insideFga`, `insideFgm`, `midFga`, `midFgm`. The third zone
needs nothing: `tpa`/`tpm` already are the three-point attempt and make counts,
incremented at exactly the same two sites as `fga`/`fgm` whenever
`zone === 'three'`.

That leaves a free consistency check, which the validator asserts rather than the
engine assuming:

```
insideFga + midFga + tpa === fga
insideFgm + midFgm + tpm === fgm
```

Mid-range could be derived by subtraction and two keys saved. It is stored
explicitly instead, because the invariant above is worth more than two integers —
a subtraction cannot detect a miscounted attempt, and three of the four
increment sites live in branches (blocked shot, made shot, missed shot) that a
seeded test can easily leave uncovered.

### The box-score engine has to answer too

`simEngineBoxScore.js` is user-selectable (`ui/settings.js:120`), and its
`deriveShootingLine` invents a shooting line from a points total after the fact.
It already computes a `threeShare` from the same `hiddenTendencies.threeTendency`
the possession engine reads. It must split its two-point attempts across inside
and mid by the same tendencies, or a player who switches engines in settings
silently gets a season of empty shot charts.

### On/off means player on/off, not five-man lineups

`plusMinus` is tracked per game in `initBoxLine` and is **not** in
`SEASON_STAT_KEYS`, so it dies with the game. Adding it is one array entry and
gives season and career plus/minus.

True five-man lineup stats are **explicitly out of scope**. They need a lineup
key maintained across every substitution in `gameSim.js`'s rotation code and a
combinatorial store to accumulate into — that is a different size of job and it
belongs in its own plan. What ships here is per-player: plus/minus, and the
defensive field-goal percentage that `oppFga`/`oppFgm` already fund.

### Recaps are written when the game is played

`save.js` prunes box scores and play-by-play down to the user's own games
(`save.js:133`, `save.js:314`). A recap generated on demand from a stored box
score would therefore work for the user's team and return nothing for the other
twenty-nine — which is exactly the empty news section the genre gets criticised
for.

So a recap is composed **at the moment the game is recorded**, from the box score
while it is still in memory, and stored as a short line on the game object. It
survives pruning because it is text, not a box score. `ui/leagueNews.js` already
has `allPlayedLines`, `computeHighlights`, and `computeTopPerformances` to build
on.

---

## Out of scope

- Five-man lineup and on/off-court splits (needs rotation-level tracking).
- Shot *coordinates* — the engine has three zones, not an x/y position. The chart
  is a three-zone split, drawn honestly as three regions, not a scatter of
  invented dots.
- Any change to shot selection, shooting percentages, or the balance of the
  league. Every number this plan touches is read-only with respect to
  simulation; the goldens in `scripts/gen-gamesim-golden.js` must not move.

---

## Verification

- `node scripts/validate-gamesim.js` and the sim goldens must be **byte-identical**
  before and after. Nothing here may consume an rng draw.
- A new `scripts/validate-shotZones.js` asserting the two invariants above over a
  seeded game, the NaN-safety of both accumulation sites against a
  pre-migration container, and that both sim engines populate the keys.
- A probe reporting league-wide zone shares over a simmed season, to confirm the
  chart shows something recognisable (roughly 30% of attempts from three, per
  the calibration already recorded in `simEnginePossession.js`) and that moving
  a team's `threePointRate` dial actually moves its own share — the feedback
  loop this whole document exists to close.
- `scripts/ui-smoke.js` coverage for the three new views, per the "visible AND
  reachable" rule.
