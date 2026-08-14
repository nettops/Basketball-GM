# User-Selected Starting Five — Design

**Date:** 2026-08-14

## Goal

Let the user choose their team's starting five, and have that choice actually
hold up during the game rather than being undone at the first substitution.

## The problem this has to solve

One number — `minutesWeight(player)` (`rawOverall` + the `usage` trait bonus,
simEngineBoxScore.js) — currently does two separate jobs:

1. `pickStarters(roster)` in gameSim.js sorts by it and takes the top five.
2. `rotationRanks(sim, team)` in gameCoach.js sorts by it to assign each
   player a rank, and `targetMinutes` maps rank to `ROTATION_MINUTES`
   (`[36, 34, 32, 30, 28, 24, 20, 16, 12, 8]`, zero past tenth).

`decideSubstitutions` rule 5 benches anyone running ahead of their target. So
overriding only job 1 would be a lie: a user-picked 12th man has a target of
**zero minutes** and is pulled at the first opportunity. Any honest version of
this feature must change the ordering both jobs read.

## Decisions taken

- **Starters set their minutes too.** Picking a five promotes those players to
  the top of the rotation, so they receive the starter minute targets. Bench
  order stays automatic.
- **Positions are shown, not enforced.** Position has *zero* effect on the
  simulation today — the only occurrences of the word in the engine files are
  inside comments, and team synergy is computed once from the whole roster, not
  from who is on the floor. Enforcing a PG/SG/SF/PF/C rule would impose a
  restriction the sim does not back up. The UI displays positions and shows an
  informational note for an unusual five; it never blocks.
- **Roster page, not a new view.** Toggles live where the ratings and injury
  info already are.
- **User's team only.** AI teams leave `startingFive` unset and behave exactly
  as today. Applies in the playoffs automatically (same code path).

## Non-goals

- No engine change making position or lineup fit affect play. That is a
  separate, larger piece of work and is explicitly out of scope here.
- No bench/rotation ordering UI (no "set your 6th man"). Bench order remains
  automatic by rating.
- No per-game or in-game lineup editing beyond the substitution controls that
  already exist in the live watch view.

## Architecture

**Stored state.** `team.startingFive` — an array of up to five player ids in
the user's chosen order, living on the team object. Absent or empty means
automatic. Two consequences make this the right home:

- The sim reaches it with `getTeamById(teamId)`, which both engine files can
  already do, so no new plumbing into `simulateGame` is needed.
- It must be added to `TEAM_SAVE_FIELDS` in save.js. A new team field missing
  from that list is silently dropped on reload — a failure this project has hit
  before, and the reason persistence is called out as its own task.

**One shared ordering.** A new pure function in simEngineBoxScore.js, beside
the `minutesWeight` it sorts on:

```
lineupOrder(roster, team) -> roster ordered: the team's valid startingFive
picks first, in the user's order, then every remaining player by
minutesWeight descending.
```

- gameSim.js's `pickStarters` becomes `lineupOrder(roster, team).slice(0, 5)`.
- gameCoach.js's `rotationRanks` ranks from `lineupOrder` instead of its own
  sort, so rank — and therefore `targetMinutes` — follows the same list.

Because both consumers read one ordering, the user's starters inherit the
starter minute targets automatically. No change to `ROTATION_MINUTES`,
`targetMinutes`, or any substitution rule.

**The safety property.** With `startingFive` absent or empty, `lineupOrder`
returns exactly the existing sort. The gamesim and rollover golden masters must
therefore pass **unregenerated**; that is the proof the feature is opt-in and
that no existing league changes.

**Bridge parity.** gameSim.js and gameCoach.js each hand-write a browser
branch (`box: { minutesWeight: minutesWeight }`). Both must gain `lineupOrder`.
scripts/validate-browserBridges.js guards this; drift here is invisible to Node
tests, so it is called out explicitly.

## Edge cases

- **Injured starter.** `eligibleRoster` (simEnginePossession.js) filters
  injured players out before the sim sees the roster, so an injured pick is
  simply absent from the list and the next player slides up for that game. The
  stored pick is untouched — he returns to the five when healthy. No special
  handling required.
- **Traded/released player.** `lineupOrder` ignores ids not present in the
  roster it was handed. The Roster page prunes stale ids when it renders, so
  the stored list self-heals.
- **Fewer than five picked.** Legal. The picks lead, the rest of the five fills
  in by rating.
- **All five injured.** Degenerate case handled by the same filtering: the
  ordering simply contains none of them and the top five available play.
- **Another team's roster.** Viewing via `inspectTeamId` shows that team's
  automatic five read-only, with no toggles and no Auto button.

## UI

On the Roster page, for the user's own team only:

- A **Starting Five** strip above the filter toolbar: five slots showing name,
  position and rating chip; unfilled slots read "Auto".
- A **Start** toggle in each roster row. Toggling a sixth player is refused
  with an inline hint to remove one first — predictable beats clever.
- An **Auto** button clearing the pick and returning to the coach's choice.
- An informational note for an unusual five (for example "no true center"),
  never a block.

## Testing

- **New Node validator** (`scripts/validate-lineup.js`):
  - With no pick, `lineupOrder` output is identical to the old sort for all 30
    teams (the byte-for-byte opt-in guarantee).
  - With a pick, the chosen players lead in the user's order and the remaining
    players keep their previous relative order.
  - Stale ids (traded away) and duplicate ids are ignored.
  - Fewer than five picks fills in by rating.
- **Goldens unregenerated.** gamesim and rollover fixtures must pass untouched.
- **Measured effect test.** Start a deliberately weak five and assert their
  simulated minutes actually rise versus the automatic lineup. "The pick
  silently does nothing" is the real failure mode and no structural test
  catches it.
- **Persistence.** Save/load round-trip preserves `startingFive`.
- **UI smoke** (`dashboard`-style group in scripts/ui-smoke.js): the strip
  renders five slots, a toggle survives a re-render, the sixth toggle is
  refused, Auto clears, and no toggles appear on another team's roster.
