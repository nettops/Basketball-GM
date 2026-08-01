# Phase 8 — League History & Dynasty Tracking (Design Spec)

**Status:** Design complete, approved by human partner section-by-section during brainstorming. Ready for `superpowers:writing-plans`.

## Goal

Indefinite season tracking, a full algorithmic awards suite (MVP, DPOY, ROY, 6MOY, MIP, All-NBA, Most Improved Team in place of Coach of the Year), retirements with Hall of Fame induction, franchise/league records, career milestones, a permanent draft class archive, and a permanent trade archive. This is what Spectator mode and long unattended multi-season sims (Phase 7) are ultimately browsing.

Built as a **single phase** (not split into 8A/8B) — confirmed with the human partner despite the roadmap bundling 7 sub-features; if the resulting plan runs past this project's usual ~15-18 task threshold, it can still be split into sub-plans (8a/8b) at planning time without needing a second design pass.

## Scope corrections from the roadmap (surfaced during brainstorming)

- **Coach of the Year has no entity to attach to.** This codebase has never had a coach concept (no `coaches.js`, no coach field on teams). Confirmed with human partner: award it to the **team** instead — "Most Improved Team" by win-total year-over-year jump, not a person.
- **All-NBA is position-agnostic** (top 15 by value formula, split into three 5-man tiers), not the old 2G/2F/1C quota format — matches the real NBA's current selection format and avoids inventing positional-balance logic for a simulation nicety.
- **6th Man of the Year** has no starter/bench flag to key off (this sim engine has no possession-level lineup tracking). Proxy: MVP-formula-eligible players who are **not** in their team's top 5 by minutes played that season.
- **"Major" trade archive** is not filtered by value threshold — every executed trade is archived (confirmed with human partner), relying on compact per-trade records (not full player snapshots) for size discipline instead of a fuzzy "major" cutoff.
- **`teams.js`'s `prestige` field starts getting adjusted** based on season results (championship/deep-playoff-run bump, bad-season decay) — previously static, confirmed in scope for this phase.

## 1. Data Model

### Career stats
Every player gains a `careerStats` object — same stat keys as the existing `seasonStats` (`league.js`'s `SEASON_STAT_KEYS`), but never reset. At the season-end integration point (§2), before `generateNewSeason` wipes `seasonStats`, that season's totals get rolled into `careerStats`. Because it's a plain field on the player object, it:
- Survives trades/signings for free (unaffected by `teamId` changes).
- Round-trips through save/load with **zero `save.js` changes** — `save.js` already saves/restores the full `PLAYERS_2026` array object-for-object (unlike `teams.js`, which extracts specific fields), so any new player-level field is automatically covered.

### `awardsWon`
Each player gains an `awardsWon` array (`[{ award, leagueYear }]`), populated by `awards.js`'s season-end computation (§2). Read by `archiveRetiree` at retirement time so a player's full award history survives into their permanent record.

### Backward-compat guard
New fields are **lazily initialized**, never assumed present. A new `history.js` function `ensureCareerData(players)` mirrors `traits.js`'s existing `ensureHiddenPlayerData(players)` exactly — if `careerStats`/`awardsWon` are missing, set them to zeroed/empty. This guards against the recurring "truthy empty object" bug pattern that has bitten this project three times already (old saves, and players created via Commissioner Mode's `createPlayer`, would otherwise have neither field).

### Retirement → permanent archive
In `seasonTransition.js`'s existing retiree-removal loop, **before** the `splice` that already discards a retiring player, call `history.js`'s `archiveRetiree(player, leagueYear)`:
1. Computes Hall of Fame eligibility via a **deterministic formula** — weighted combination of career totals (points/rebounds/assists thresholds), award count, All-NBA selections, championships won, and peak overall rating reached, compared against a fixed cutoff score. No voter pool, no percentile comparisons (a thin early-save population would make percentile cutoffs meaningless).
2. Snapshots a **compact** record into `LEAGUE_HISTORY.retiredPlayers` (§5): id, name, position, draft info, retirement year, `teamsPlayedFor`, career totals + derived averages, `awardsWon`, All-NBA selection count, championships won, peak overall, HOF flag + score.
3. Full season-by-season box scores are never stored — consistent with Phase 6's existing size discipline (per-game box scores are already dropped from saves).

### `teamsPlayedFor`
A lightweight array on each player, checked (not continuously tracked) at two points: the season-boundary rollup (§2) and at retirement. This is an explicitly-scoped approximation — a player traded twice within the same season could have an intermediate team missed. Accepted trade-off to avoid touching every team-assignment call site (draft, free agency, trade, Commissioner tools) individually.

## 2. Season-End Integration Point

One new call, `history.js`'s `finalizeSeasonHistory(leagueYear, playoffBracket, rng)`, inserted at the very top of `script.js`'s `handleAdvanceToOffseason` — **before** the existing `runOffseasonThroughDraft`/`runOffseasonPreDraft` call, so retirement (which runs immediately after, in the same offseason transition) sees each retiree's fully-updated `careerStats`/`awardsWon`.

Sequence:
1. **`awards.js`'s `computeSeasonAwards(leagueYear)`** — pure, stateless formulas over the *not-yet-reset* `seasonStats`, team records, and the just-completed `playoffBracket`:
   - **MVP / DPOY / ROY / MIP**: weighted formulas over `getPlayerAverages`-derived stats. MVP weights scoring/impact stats with a team-success multiplier. DPOY weights steals/blocks plus `perimeterDefense`/`interiorDefense` attributes (no advanced defensive box-score stat exists to lean on further). ROY is the MVP formula restricted to `yearsPro === 0`. MIP is the largest year-over-year average delta: each player gains a `lastSeasonAverages` snapshot (a small object, not a growing history — overwritten every season) captured during the career-stats rollup step below, and MIP compares the just-finished season's averages against it. All four are gated by a games-played qualifier so a short call-up can't win on a small sample.
   - **6th Man of the Year**: MVP-formula-eligible players **not** in their team's top 5 by `seasonStats.minutes` that season.
   - **All-NBA**: top 15 players league-wide by the MVP value formula, split into three 5-man tiers by rank (1st/2nd/3rd team), position-agnostic.
   - **Most Improved Team** (Coach of the Year's replacement): largest year-over-year jump in `team.record.wins`, needing last season's win total snapshotted before `generateNewSeason` resets `team.record`.
   - Winners are pushed into each winning player's `awardsWon`; the full season's results are archived into `LEAGUE_HISTORY.awardsHistory`.
2. **Career stats rollup** — `seasonStats` → `careerStats` for every rostered player, per §1.
3. **Champion archive** — `playoffBracket.finals[0].winner` (already determinable today, per the grounding notes) gets appended to `LEAGUE_HISTORY.champions`.
4. **Prestige adjustment** — each team's `prestige` shifts based on that season's result (championship bump, deep-playoff-run bump, bad-season decay). Small, bounded adjustment — not a new balance subsystem to tune extensively.
5. **Career milestones** — no new system. While rolling career stats (step 2), if a player's cumulative total just crossed a round-number threshold (10k/20k/30k points, 5k/10k rebounds or assists), push a line into the existing `GameState.feed` ("X reaches 10,000 career points"). Reuses Phase 7A's live feed infrastructure entirely.

## 3. Trade Archive

`trade.js`'s `executeTrade` gains an optional `historySink` callback param — the exact same additive, backward-compatible pattern Phase 7A already established for the live feed's `feedSink` (default no-op, so every existing call site is unaffected without passing it). `script.js` wires it to `history.js`'s `archiveTrade(proposal, leagueYear)`. Every executed trade is archived — user-built, forced (Commissioner Mode), or auto-generated — with a compact record (participants, per-player and per-pick assignments, league year/day), not full player snapshots.

## 4. Draft Archive

`history.js`'s `archiveDraftClass(leagueYear, draftResults)` is called at both existing places `script.js` finalizes `GameState.lastDraftResults` — the auto-draft branch of `handleAdvanceToOffseason` and the manual draft-picker completion branch of `handleUserDraftPick` — storing each pick (round, pick number, team, player) permanently in `LEAGUE_HISTORY.draftClasses`, rather than being overwritten every offseason as today.

## 5. Persistence (`LEAGUE_HISTORY`)

`history.js` owns one consolidated module-level object:
```js
const LEAGUE_HISTORY = {
  retiredPlayers: [],   // §1
  trades: [],           // §3
  draftClasses: [],     // §4
  awardsHistory: [],    // §2
  champions: []         // §2
};
```
Same ownership pattern `players-2026.js` uses for `PLAYERS_2026` and `teams.js` uses for `TEAMS` — a plain module-level array/object, not nested inside `GameState`. `save.js` gets exactly **one** new field pair (serialize/restore for `leagueHistory`), following this project's established rule: "whenever you add a new top-level field that should survive a save, add it to both functions explicitly." Per-player `careerStats`/`awardsWon`/`teamsPlayedFor` need no `save.js` changes (§1).

## 6. New Files

- `awards.js` — pure, stateless season-award computation (`computeSeasonAwards`). No persistence of its own; `history.js` owns the archive.
- `history.js` — `LEAGUE_HISTORY` state, `ensureCareerData`, `archiveRetiree`, `finalizeSeasonHistory`, `archiveTrade`, `archiveDraftClass`, HOF formula, prestige adjustment, records-leaderboard helpers (computed on-demand, not persisted).
- `ui/awards.js` — `renderAwards(container)`: past winners by season/category, most recent first.
- `ui/history.js` — `renderHistory(container)`: Champions list, Hall of Fame gallery, Records leaderboard (computed on-demand from `LEAGUE_HISTORY.retiredPlayers` + active players' `careerStats`, matching how Standings already computes live rather than persisting redundant derived state), Draft Archive, Trade Archive.

## 7. Existing Files Touched

- `players-2026.js` / `draftProspects.js` — **not modified**. `careerStats`/`awardsWon`/`teamsPlayedFor` are lazily initialized via `ensureCareerData`, not added to `mkPlayer`/`mkProspect`'s literal construction, so the ~900 existing player-construction call sites are untouched.
- `seasonTransition.js` — retiree-removal loop in `runOffseasonPreDraft` calls `archiveRetiree` before the existing `splice`.
- `trade.js` — `executeTrade` gains an optional `historySink` param.
- `script.js` — new `finalizeSeasonHistory` call at the top of `handleAdvanceToOffseason`; `historySink` wired into every `executeTrade` call site; `archiveDraftClass` wired into both draft-completion call sites; `BUILT_VIEWS` gains `awards`/`history` entries (both nav slots already reserved by `ui/nav.js`, unused since inception).
- `ui/roster.js` — gains a small "Career" section per player (career totals/averages), not a dedicated career page.
- `save.js` — one new field pair for `leagueHistory`.

## 8. Out of Scope

- Full coach entity system (Coach of the Year repurposed to a team-level award instead).
- Positional quotas for All-NBA (position-agnostic top-15 instead).
- A dedicated per-player career page (career data surfaces on the existing Roster view instead).
- Any new Auto-toggle — this phase is purely observational, no new decisions for the user or AI to make.
- Retroactive backfill of history for players who retired before this phase shipped — history starts accumulating from whenever this phase lands, matching how every other Phase 7A feed/archive already works (no attempt to reconstruct past seasons).
- Sub-season-granularity `teamsPlayedFor` tracking (checked at season boundaries + retirement only, per §1).
