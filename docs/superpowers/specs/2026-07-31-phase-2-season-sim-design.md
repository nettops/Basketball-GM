# Phase 2: Season Simulation Engine — Design

**Status:** Approved, ready for implementation planning.
**Parent roadmap:** `2026-07-31-nba-gm-simulator-roadmap.md`

## Scope

Real 82-game schedule generation, a pluggable game-simulation engine architecture (implementing the "team + box score" engine now — score-only and possession-by-possession engines are deferred to their own later phases), fatigue, basic injuries, full per-game box score history, real standings, standard playoffs, and sim-advance controls with a speed setting.

**Out of scope for this phase:** the score-only and possession-by-possession simulation engines (architecture supports adding them later; Settings only offers `boxscore` this phase), the live simulation feed and pause-on-event settings (Phase 7), hidden traits/personality affecting sim outcomes (Phase 5 — this phase's engine uses only visible attributes/overall/chemistry/fatigue), trades/free agency/draft (Phases 3-4), save/load (Phase 6).

## File Structure

```
schedule.js            # 82-game schedule generator (real NBA game-count rules, randomized dates)
simEngine.js            # engine registry/selector + shared game-result contract
simEngineBoxScore.js     # the "team rating + box score" engine (this phase's only implemented engine)
fatigue.js              # fatigue accumulation/decay
injuries.js              # random injury rolls + recovery countdown
playoffs.js              # bracket generation, best-of-7 series tracking
ui/schedule.js            # schedule/results view (real content for the "Schedule" nav item)
ui/simControls.js          # Next Game / Next Day / Sim to End of Season|Playoffs + speed setting
ui/settings.js            # first real content for "Settings" — sim engine picker (others shown
                          #   as "coming later"), speed setting
```

## Schedule Generation (`schedule.js`)

Real NBA game-count structure per team: 4 games vs each of 4 division rivals (16 games), 4 games vs 6 conference non-division opponents + 3 games vs the other 4 conference non-division opponents (36 games), 2 games vs every team in the other conference (30 games) — 82 total per team, 1,230 games league-wide.

The NBA's real assignment of "which 6 of the 10 non-division conference opponents get 4 games" is set by the league using rivalry/travel factors that aren't publicly derivable as a formula — that split is assigned deterministically via seeded RNG instead.

Games are distributed across a season date range (late Oct–mid Apr) using a seeded RNG, constrained so no team plays 3+ games in 3 days, with occasional back-to-backs allowed. Same-day games across all teams are generated and later simulated together, keeping the league's calendar internally consistent (no team's schedule can drift ahead of another's).

The seed is randomized per new game (a different schedule shape each save) but the generator itself is pure/deterministic given a seed, so it stays unit-testable by fixing a seed in tests.

## Simulation Engine Architecture (`simEngine.js` + `simEngineBoxScore.js`)

Shared contract every engine implements:
```js
simulateGame(homeTeamId, awayTeamId) → {
  homeScore, awayScore,
  boxScore: { [playerId]: statLine } | null   // null for engines that don't produce box scores
}
```

`simEngine.js` holds a registry:
```js
{ boxscore: simEngineBoxScore, scoreonly: null, possession: null }
```
`getActiveEngine()` reads `GameState.settings.simEngine` (default `'boxscore'`). The Settings UI only allows selecting engines with a non-null registry entry this phase — `scoreonly` and `possession` appear as disabled "coming later" options, establishing the setting's presence without requiring their implementation yet.

`simEngineBoxScore.js`:
- Computes each team's effective rating from its top-8-by-minutes players' `overall`, adjusted by `chemistry`, each player's current `fatigue`, and a home-court bonus.
- Converts the rating differential plus seeded randomness into a final score in a realistic range (roughly 90-130 per team).
- Distributes team totals (points, rebounds, assists, steals, blocks, minutes) across the roster weighted by role/attributes — e.g. points weighted toward scoring attributes (`insideScoring`, `midRange`, `threePoint`, `postScoring`), boards toward `offReb`/`defReb`, assists toward `passing`/`ballHandling`, steals/blocks toward their matching attributes — producing a full per-player stat line consistent with the team total. FG/3PT/FT makes-attempts are derived to be consistent with each player's points and shooting-attribute profile.
- Injured players (`status.injury` set) are excluded from the rotation.

## Fatigue & Injuries (`fatigue.js`, `injuries.js`)

- `Player.status.fatigue` (0-100, already in the Phase 1 schema) rises with minutes played and with back-to-back games, decays with rest days.
- Fatigue moderately reduces a player's effective rating inside `simEngineBoxScore`.
- After each game, each player who played rolls a small random injury chance — a flat base rate this phase, scaled up slightly by their current fatigue. No hidden-trait modifiers (e.g. "Injury Prone") since Phase 5 doesn't exist yet.
- An injury sets `Player.status.injury = { severity, gamesRemaining }`. Severities: Day-to-Day, Two Weeks, One Month, Season Ending, each mapping to an approximate games-out count derived from the season's game pace.
- Injured players are excluded from that team's engine rotation until `gamesRemaining` reaches 0 (decremented as their team's games are simulated).

## Standings & Box Scores

- `Team.record` gains `pointsFor` and `pointsAgainst` alongside the existing `wins`/`losses`, used as a playoff-seeding tiebreaker (point differential, then team id alphabetically) since win-count ties are otherwise possible.
- Every simulated game is stored in full in a global `SEASON.games` array:
  ```js
  { id, date, homeTeamId, awayTeamId, played, homeScore, awayScore, boxScore, isPlayoff, seriesId }
  ```
- `Player.seasonStats` accumulates running totals each game the player appears in: games played, points, rebounds, assists, steals, blocks, FG/3PT/FT makes and attempts, minutes. PPG/RPG/APG/FG%/3PT%/FT% are derived for display from these totals, not stored separately.

## Playoffs (`playoffs.js`)

Once every regular-season game is played, the top 8 seeds per conference are set (by wins, tiebroken by point differential then team id) and a standard best-of-7 bracket is generated: 1st Round → Conference Semifinals → Conference Finals → NBA Finals. Each round's matchups depend on the previous round's winners, so only the first round's series exist until that round completes — subsequent rounds are generated as prior rounds finish.

## Sim Controls & Speed (`ui/simControls.js`)

- **Next Game** — simulates all league-wide games through the date of the user's team's next scheduled game.
- **Next Day** — simulates whatever's scheduled today, if anything.
- **Sim to End of Regular Season / Sim to End of Playoffs** — label depends on current stage.

All three operate uniformly on "the next unplayed game(s)," regardless of whether the league is in the regular season or playoffs — no special-casing between the two.

A **Slow/Normal/Fast/Ultra Fast** speed setting controls the delay between simulated days during a multi-game batch. There's no live event feed to watch yet (that arrives in Phase 7), so this setting only paces how long a "Simulating…" indicator shows before results render.

## Testing Approach

Same approach as Phase 1: Node-based validation scripts (no framework, plain `assert`) covering:
- Schedule generation: correct total game count (1,230), correct per-team game count (82) and opponent-count breakdown (16/36/30), no team scheduled for 3+ games in any 3-day window — all run with a fixed RNG seed for determinism.
- Simulation math: scores land in a realistic range, a game's box score stat totals sum to that game's final score, standings and season stats update correctly after N simulated games.
- Playoffs: bracket seeding matches standings + tiebreaker rules, each round only generates once its predecessor round is complete.

Manual browser walkthrough (same as Phase 1's Task 16 pattern) for the UI: schedule/results view, sim controls advancing the season, standings updating with real records, Settings' engine picker, and the playoff bracket once reached.

## Open Questions / Ambiguity Resolved

- **Simulation engine scope:** resolved — build the pluggable architecture and the "team + box score" engine now; score-only and possession-by-possession engines are explicitly deferred to their own later phases, not built as stubs.
- **Schedule date assignment:** resolved — randomized within constraints (seeded RNG, deterministic for tests, varied per save), not the NBA's true rivalry-based assignment (undocumented) and not a fully deterministic fixed schedule.
- **Fatigue & injuries:** resolved — both in scope this phase, with injuries using a flat/fatigue-scaled probability (no hidden-trait modifiers, since those don't exist until Phase 5).
- **Box score retention:** resolved — full per-game box scores stored for the season, not just running totals.
- **Playoff format:** resolved — standard 8-per-conference, best-of-7, matching the original master spec.
- **Sim controls & speed:** resolved — Next Game/Next Day/Sim to End of Season|Playoffs plus a Slow/Normal/Fast/Ultra Fast speed setting, even though there's no live feed yet to visualize it against.
- **Phase sizing:** resolved — kept as a single phase rather than split, per explicit confirmation; expect a larger task count than Phase 1 (roughly 25-30+ tasks).
