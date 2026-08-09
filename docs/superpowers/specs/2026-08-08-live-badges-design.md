# Live Badges — Wiring Defense/Steal/Block and Surfacing the Trait System

**Date:** 2026-08-08
**Status:** Approved for planning
**Depends on:** `2026-08-08-skill-checks-design.md`, which ships first

Because the skill-check primitive lands first, the wiring below changes shape: the
five consumption sites become **modifier entries on `skillCheck` specs**, not terms
bolted onto five hand-rolled formulas. Each badge contributes
`{ label: 'Lockdown Defender (gold)', value: −3 }` to the relevant check's
`modifiers[]`, which means it is calibrated in one place and displayed for free by
the check breakdown. The attachment table and routing rules are unchanged; only the
insertion mechanism is.

## Problem

Fifteen of the 48 hidden traits have no effect on the default (possession) engine.
This was found by giving one mid-rotation player (Payton Pritchard, BOS) each
legendary trait and running a 400-game schedule against a no-trait control at a
matched seed — 27 of those games involved his team, and those are the ones measured:

```
case                   MIN    PTS    FGA    FG%    AST    REB   moved?
control              29.93  17.70  11.44  58.90   3.44   2.52   —
scoring              30.15  19.56  12.85  60.23   3.15   2.26   yes
assist               30.04  18.78  12.81  57.80   6.37   2.22   yes
rebound              29.93  17.70  11.44  58.90   3.44   3.30   yes
usage                32.19  17.30  12.89  54.02   3.26   2.96   yes
defense              29.93  17.70  11.44  58.90   3.44   2.52   byte-identical
steal                29.93  17.70  11.44  58.90   3.44   2.52   byte-identical
block                29.93  17.70  11.44  58.90   3.44   2.52   byte-identical
chemistry            29.93  17.70  11.44  58.90   3.44   2.52   byte-identical
```

Byte-identical across nine metrics is not a weak signal — it means the code path
never consulted the trait. The cause: `boxscore/defense`, `steal` and `block` are
read only by `simEngineBoxScore`'s weight functions, which the possession engine
does not call for those stats. Steals come from `onBallDefender.attributes.steal`
and blocks from `shotDefender.attributes.block` — raw attributes, no trait term
(`simEnginePossession.js:264`, `:306`). Defense has no consumer anywhere in the
possession path.

Affected: 7 defense traits, 3 steal, 2 block, 3 chemistry. Including two superstar
badges, DPOY Caliber and Two-Way Star, each worth 14 at legendary and doing nothing.

A second, smaller problem: `player.badges` is a display-only array of seven
hardcoded strings, written once in the parked career mode and read once in
`ui/playerDashboard.js`. `badge_affinity` on the five archetypes is read by nothing.
The system badges were meant to be already exists — it is called `hiddenTraits`, and
its tier ladder (bronze/silver/gold/hof/legendary) is 2K's badge ladder with one
extra rung.

## Decisions

| Question | Decision |
|---|---|
| What are badges? | The existing 48 traits, made visible. No new mechanics, no second system. |
| How does defense show its work? | Both rate and allocation, plus a new DFG% stat so it is not invisible. |
| League rates | Rate-neutral. FG% 46.8 / 3P% 36.6 / 103.3 points hold. |
| Block rate | Stays parked at `BLOCK_BASE 0.020`. Not resolved here. |
| Badge visibility | No scouting gate for rostered players. Prospects show fuzzy tiers. |
| Chemistry | Scoped in, not exempted. Badges feed `computeTeamSynergy` directly. |

## Architecture

Mirror the pattern scoring already uses: `scoringWeight` decides *who shoots*
(allocation), `shotQualityBonus` decides *how well* (rate), routed by `affinity` so
a trait only fires on the shot it is about. Defense gets the same two paths.

Rejected alternatives:

- **Flat bonus, no routing** — a Lockdown Defender would suppress threes and rim
  attempts equally. This is the exact mistake `shotQualityBonus` was created to
  avoid, where a blanket `boxscore/scoring` bonus had Elite Speed fixing jump shots.
- **Allocation only** — defense traits change who guards but never how well.
  Combined with rate-neutrality this would be nearly invisible, and a badge that
  cannot make anyone better is not a badge.

### New function

`defenseQualityBonus(player, zone)` in `traits.js`, sibling to `shotQualityBonus`,
routed by the `affinity` field that already exists:

| Zone | Routed from affinity |
|---|---|
| `three`, `mid` | `perimeterDefense` |
| `inside` | `interiorDefense` |

Positives without a defensive-zone affinity are allocation-only, matching how
unrouted scoring traits are volume-only.

### Attachment table

| Trait | Affinity | Effect |
|---|---|---|
| Lockdown Defender | perimeterDefense | −make% on three/mid, + assignments |
| Switchable | perimeterDefense | −make% on three/mid, + assignments |
| Defensive Anchor | interiorDefense | −make% inside, + assignments |
| DPOY Caliber (14) | interiorDefense | −make% inside, + assignments |
| Charge Taker | basketballIQ | + assignments only |
| Two-Way Star (14) | — | + assignments only |
| Foul Prone | — (negative) | + shooting fouls (see deviation) |
| Pickpocket | steal | + turnover chance, + on-ball assignments |
| Point-of-Attack Menace | steal | + turnover chance, + on-ball assignments |
| Quick Twitch | acceleration | + turnover chance |
| Rim Protector | interiorDefense | + block chance |
| Explosive Vertical | vertical | + block chance |

### Consumption sites

Five additions to formulas that already exist. Note the allocation path needs
**two** sites, not one: the on-ball defender goes through `perimDefenseWeight`, but
the shot defender is picked from an inline composite lambda at
`simEnginePossession.js:278` that does not use that helper.

```
RATE:
  shotMakeProbability()  base + skillAdj − defAdj + synergyAdj + traitAdj − defTraitAdj
  turnoverChance         … + getTraitBonus(onBallDefender, 'boxscore', 'steal') / DIV
  blockChance            … + getTraitBonus(shotDefender, 'boxscore', 'block') / DIV

ALLOCATION:
  perimDefenseWeight     Math.max(1, composite + getTraitBonus(p, 'boxscore', 'steal'))
  shotDefender pick      inline lambda at :278 — extract to a named
                         shotDefenseWeight(player, zone) that adds the defense bonus,
                         so both allocation paths are named functions rather than one
                         helper and one anonymous inline
```

Extracting the inline lambda is not gratuitous: leaving it anonymous is what made
the shot-defender path easy to miss when auditing which weights read traits.

## Chemistry

`computeTeamSynergy(roster)` (`compositeRatings.js:63`) already computes per-game
team multipliers from roster construction and already reaches the possession engine
— `synergyAdj = offenseSynergy − defenseSynergy` sits in `shotMakeProbability`
directly beside the trait term. Chemistry is a team-level property and synergy is
the team-level channel, so that is where the chemistry badges go.

Signature becomes `computeTeamSynergy(roster, team)`. A chemistry term is added to
the `offense` and `defense` multipliers, built from two inputs:

- the rotation's summed `chemistry/team` badge bonuses (Natural Leader +,
  Locker Room Cancer −, Franchise Cornerstone at the 14-point superstar scale)
- `team.chemistry` centred on 70, matching the constant `simEngineBoxScore`'s
  `computeTeamRating` already uses

Folding the authored field in is deliberate. `team.chemistry` is written per team in
`teams.js` (55–78) but read only by the non-default engine, so today it is decorative
in normal play. One term makes both the badges and the field live, and leaves
`computeTeamRating`'s existing use untouched.

**No new state.** Chemistry does not evolve, persist, or tick. It is computed from
the roster each game the same way the shooter/defender/rebounder counts already are,
so there is no save-format change and nothing to migrate. An evolving chemistry
value that drifts with winning and roster churn is a real and more interesting
design, but it is a separate project with its own persistence and calibration.

### One deliberate deviation

Under the scoring precedent, negative traits apply to every zone — so Foul Prone
would make opponents *shoot better*, which is a bad model of what fouling is. It is
routed to `SHOOTING_FOUL_RATE` instead, where the name means something. This is the
only trait not following the mirror, and it is the one place the mirror is wrong.

## Defensive FG%

Without a surfaced stat, the whole defensive path is invisible.

- `initBoxLine()` gains `oppFga` / `oppFgm` — shots defended, and how many fell.
- Incremented at the shot resolution, where `shotDefender` is already in hand.
  A blocked shot counts as a defended miss.
- Added to `SEASON_STAT_KEYS` (`league.js:40`) so it accumulates. One game's five
  defended shots is noise; DFG% only means anything over a few hundred.
- Rendered as **DFG%** in the box score and on the player profile.

Knock-ons: both golden masters encode box-score content and regenerate.
`SEASON_STAT_KEYS` feeds career stats and the save shape, so `validate-save` and the
rollover fixture must see the new keys.

## Badge visibility

- **UI rename only.** "Traits & Badges" → **Badges**. The CSS is already
  `trait-badge`. The internal name `hiddenTraits` stays — renaming the data model
  touches 48 traits, the save format and every validator for zero visible gain.
- **No gate for rostered players.** `getRevealedView` returns exact badges for
  anyone on an NBA roster, yours and opponents'.
- **Prospects stay fuzzy.** Reuses `fuzzyTraitLabel`, which already emits
  `"gold-legendary?"` range labels, so draft night keeps its risk.
- **Scouting keeps its job.** Personality and tendencies stay behind the 30%/70%
  confidence gates. Only badges come out from behind it.
- **Cleanup.** Delete `player.badges` and `badge_affinity`. Once badges mean traits,
  a second inert thing called "badges" is a trap, and the career-mode park note
  already says badge selection should seed the trait roll instead.

## Calibration

Rate-neutrality in two stages, because one is not enough:

1. **Mean-centre the defensive term** — subtract the league-average defensive badge
   bonus so an average defender contributes exactly 0. Only *relative* defensive
   quality moves a shot. Removes the bulk of the league-wide drop by construction
   rather than by tuning.
2. **Measure the residual and correct it** — centring does not fully close the gap,
   because the allocation path changes who defends: better defenders draw more
   assignments, so league FG% still drifts down. Measure that residual across a
   sweep and adjust the zone bases by the measured amount, with the sweep recorded
   in the commit message.

`DEF_TRAIT_DIV` is swept, not chosen, the same way `SHOT_TRAIT_DIV` was. Target is
symmetry: a legendary Lockdown Defender worth roughly what a legendary Sharpshooter
is (±2.7pp on its zone), putting DPOY Caliber at about −4.7pp on its 14-point scale.

The chemistry term gets the same two-stage treatment, and needs it more: it lands on
`synergyAdj`, which is a whole-team multiplier applied to every shot, so an
uncentred term would move league scoring far harder than a per-defender one. Centre
on the league mean of (rotation badge sum + `team.chemistry` − 70), then measure.
Its swept magnitude should stay below the defensive term — chemistry is a nudge to
how a roster fits, not a bigger lever than guarding somebody.

## Testing

The bug class is not "defense is unwired" — it is **"a trait family can be silently
dead and nothing notices."** Fifteen traits sat dead through seven calibration tasks
without a single test complaining. The deliverable includes the tripwire.

**`scripts/validate-traitsAreLive.js`** — for every `(system, stat)` family in the
taxonomy, give one player a legendary trait from that family and assert their own
line moves against a seed-matched control. Byte-identical means dead. This is the
generalized form of the move `33a2161` made going from guarding `minutesWeight` to
guarding all six weights.

It carries **no exemptions**. All 13 `(system, stat)` families must move a player's
line, chemistry included. The validator asserts the family list it iterates is the
complete set drawn from `TRAIT_TAXONOMY`, so a family cannot be quietly dropped from
coverage by deleting a row — a new family added to the taxonomy is covered the day
it appears, and fails until it is wired.

An earlier draft of this spec exempted `chemistry/team` on the grounds that there
was no system to wire it into. That was wrong: `computeTeamSynergy` was already the
right channel and already reached the engine. The exemption would have preserved
exactly the bug class this validator exists to catch.

Every new assertion is mutation-tested. Required mutants:

| Mutant | Must die on |
|---|---|
| Route every defense trait to every zone | Lockdown Defender suppressing layups |
| Drop zone routing entirely | perimeter/interior badges becoming interchangeable |
| `defenseQualityBonus` returns 0 | DPOY Caliber stopping mattering |
| Un-route Foul Prone from the foul rate | foul rate no longer responding |
| Remove the steal term | the steal family going byte-identical again |
| Remove the block term | the block family going byte-identical again |
| Zero the chemistry term in synergy | Locker Room Cancer costing a team nothing |
| Drop `team.chemistry` from the synergy term | the authored field going decorative again |

A surviving mutant means the assertion is worthless or the code is dead, and the
report must say which.

Plus: a rate-neutrality assertion pinning league FG%/3P%/points to the locked
targets; verification from a fresh `git clone --local` of HEAD rather than the
working tree; and a browser check that the DFG% column renders.

## Out of scope

- **Evolving** chemistry — a `team.chemistry` that drifts with winning, minutes and
  roster churn. The badges are wired here; making the value itself dynamic needs
  persisted state, a season tick and its own calibration.
- Morale reaching the sim. `player.status.morale` ticks every game
  (`morale.js:11`) and no engine reads it. Same bug class as the 15 dead traits,
  found while designing this, and worth its own pass.
- `BLOCK_BASE` / block-rate rebalance (parked, sweep already measured).
- Un-parking career mode.
- Renaming `hiddenTraits` in the data model.
