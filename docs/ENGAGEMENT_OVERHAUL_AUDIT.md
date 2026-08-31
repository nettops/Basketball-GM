# Engagement Overhaul — Repository Audit

Phase 0. Everything below was traced in the code and, where a number is
quoted, measured by running it. Nothing here is inferred from a filename.

## Method

Two passes. First, every export of the named narrative/career modules was
grepped for call sites outside its own file and outside `scripts/`. That pass
**over-reported death** — this codebase calls across modules through captured
data blocks (`_ROLLOVER_DATA.owner.reviewSeason(...)`), so a bare-name grep
misses real callers. Corrected by re-checking each module for `require`/
reference from app files. The findings below survived the correction.

Second, a full regular season was simulated through `league.simulateDate` and
the league-wide event inventory counted, because the design constants tell you
the ceiling and only a run tells you the floor.

## The headline finding

**Four of the five systems this overhaul is meant to build on are unreachable
in the only mode you can play.**

`script.js:1172` parks Player Career mode by passing `null` as
`renderTeamSelect`'s fifth argument. The comment there is honest about why:
`createCustomPlayer` leaves `hiddenTraits` empty forever and assigns `overall`
as a literal instead of ratings.js's derived getter, so a created player never
progresses. Fine as a decision — but these four classes are constructed
**only** inside `initPlayerCareerMode` or its offseason follow-up:

| system | constructed at | reachable in GM mode |
|---|---|---|
| `NarrativeSystem` | `script.js:1076` | **no** |
| `RandomEventSystem` | `script.js:817` | **no** |
| `PlayerCareerController` | `script.js:1075` | **no** |
| `PlayerAwarenessModule` | `ui/playerDashboard.js:100` | **no** |

So GM mode — the game people actually play — currently has **no narrative
system, no random events, and no player awareness**. The brief's instruction to
"extend rather than duplicate" holds, but extending these means first giving
them a GM-mode entry point that does not depend on a parked mode.

## What GM mode actually has

Wired and working, via `seasonRollover.js` and `ui/simControls.js`:

- **Owner mandates** — `owner.js` is called from `seasonRollover.js`. One
  mandate set per season, judged at the next rollover.
- **Dialogue scenes** — `dialogueScenes.js` + `dialogueContext.js`, called from
  `ui/simControls.js` (postgame, halftime, season) and `ui/dialogueBox.js`.
- **Rivalries** — `rivalries.js`, called from `seasonRollover.js`.
- **League news, feats, history, GM career** — all live.

## CORRECTED: the GM's season is not capped at three

This section claimed roughly three narrative touchpoints a season. Wrong, and
wrong the same way as the others: by reading a constant's NAME instead of the
code that uses it.

`SEASON_SCENE_MAX_PER_SEASON = 2` is a cap **per scene id**, not per season.
`recentSeasonScenes` blocks an id once its own count hits two; every other
scene stays available. There are 14 season scenes, so up to **28 season
conversations** are permitted in a year, plus postgame and halftime.

Verified by driving the gate directly: stamp scene A twice and scene B once,
and at day 100 only A is blocked.

The cap exists for a good reason the comment records — a playtester got the
owner asking about the tax bill four times, word for word, in one season.

**MEASURED, and the hypothesis is dead.** `scripts/probe-sceneVolume.js`
replicates the gate exactly and reports **13.0 mid-season conversations a
season**, not 3.

The binding constraint is neither constant this audit looked at. It is
`MID_SEASON_SCENE_GAP_DAYS = 8` in `ui/simControls.js`, which caps a ~128-day
season at about 16. Thirteen against a ceiling of sixteen is a system working.

Variety is team-shaped and that is the design working, not a gap. A contender
(BOS) hears career-year, race-is-tight and outside-looking-in. A rebuild (BKN)
hears young-core-rising, tanking-question and losing-slide. Neither hears the
other's. Across both, 12 of 14 season scenes fire.

Two remain unreached, and only one is a defect:

- `running-hot` (priority 50) needs a five-game winning run, but `rivalry-heat`
  (priority 58) triggers on `!!c.rivalName` — unconditional once any rivalry
  exists. Every other scene keys off something that just happened; this one
  keys off a standing fact, so it outranks anything below 58 whenever it has
  cap left. That is worth fixing.
- `mandate-slipping` needs a wins-type mandate being badly missed. Rare by
  design, not broken.

**Conclusion: the GM's narrative volume needs no work.** The audit's "boredom
cause" was wrong three times over — wrong constant, wrong reading of it, and
wrong conclusion.

## Superseded: the original volume claim

Design constants (`dialogueContext.js`):

```
SEASON_SCENE_MAX_PER_SEASON = 2
SEASON_SCENE_COOLDOWN_DAYS  = 21
```

One simulated regular season, seed 4242, league-wide:

```
feats            85      (~2.8 per team)
takeovers      1274      (in-game, never surfaced to the GM)
trades            0
retiredPlayers    0
awardsHistory     0
champions         0
```

So across 82 games a GM receives roughly **three discrete narrative
touchpoints**: one owner mandate and at most two season scenes. Postgame scenes
exist but only fire on games you sit and watch.

The original conclusion drawn from this — "that is the boredom cause" — does
not survive the correction above. The ceiling is 28, not 3. Whether the floor
is anywhere near it is unmeasured.

## CORRECTED: the league DOES move on its own

This section first claimed the league was transactionally inert, on the
strength of "zero trades in a full simulated season". That was wrong, and the
error is worth keeping written down because it is the same shape as the trap
this audit warns about elsewhere.

`runWeeklyAIToAITradeGeneration` (`script.js:310`) exists, is called every
simulated day from `afterDaySimulated` (`script.js:423`), and is carefully
tuned: `AI_TRADES_PER_SEASON = 2` per club (~30 leaguewide), an 8% weekly
chance that rises to 45% in the fortnight either side of the deadline, and a
budget added after a playtest measured 493 trades in one offseason with one
player moving 24 times.

Verified directly: **28 of 30 clubs produce a viable offer in a single
`generateTradeOffer` pass.**

Why the first measurement said zero: it drove the season through
`league.simulateDate`, which is the SIM layer. The weekly trade hooks live in
`afterDaySimulated`, which is the CONTROLLER layer in `script.js`. Everything
`script.js` does — trades, waivers, affiliates, scouting ticks, feed pushes,
rivalry recording — is invisible to a Node probe that calls the sim directly.

**Rule for anyone auditing this repo next: a Node probe over `league.js`
measures the simulation, not the game.** To measure the game you must drive
`afterDaySimulated`, which means a browser.

## CORRECTED: relatives are generated

Also wrong. This section claimed `relatives.js` had no caller, on the strength
of grepping for `ensureRelatives` — a function name guessed from the pattern
`ensureHiddenPlayerData`/`ensurePlayerFace` used elsewhere. The real entry
point is `assignFamilies`, called from `draftProspects.js:312`, so draft
classes do get family ties.

**Grepping for a name you assumed rather than one you read is how three of
these findings went wrong.** Read the exports first, then grep.

## What survived re-checking

- **The narrative systems are unreachable in GM mode.** Verified at
  `script.js:1172`. Still the headline finding.
- **The GM's event budget is ~3 a season**, set by constants
  (`SEASON_SCENE_MAX_PER_SEASON = 2`) rather than by game state. Verified.
- **Morale never reaches the floor.** It IS ticked — `league.js:418` calls
  `tickMoraleForTeamGame` after every game — but no reference to it exists in
  `simEnginePossession.js`, `simEngineBoxScore.js`, `gameSim.js`,
  `gameCoach.js` or `progression.js`. An unhappy player does not play worse or
  develop slower. He is only harder to re-sign and cheaper to trade.

## Ranked weaknesses

1. Narrative/event systems unreachable in GM mode (parked-mode dependency).
2. Event volume UNKNOWN. The ceiling is 28 season conversations, not 3; how
   many fire has never been measured. Measure before building.
3. Consequence has no memory: decisions do not persist into later seasons.
4. Morale changes nothing on the floor — it ticks, and no engine reads it.
5. The league transacts, but silently: ~30 AI trades a season happen and the
   GM is told about none of them beyond a feed line.

Struck from this list after re-checking: "the league is transactionally
inert" and "relatives are never generated". Both were false. See the two
CORRECTED sections above.

## Implementation order

Deliberately narrower than the brief's 20 phases, and ordered so each step has
something to stand on.

**P0.1 — GM Agenda (the keystone.)** A read-only derivation over existing state
that answers "what should I care about right now". It invents no new
simulation; it reads roster, contracts, morale, owner patience, standings,
injuries, rivalries and finances and ranks what it finds. This is the surface
every later phase publishes into, which is why it goes first.

**P0.2 — Event memory.** A persisted, queryable ledger of what the GM did and
what happened, so later seasons can refer back. Extends `history.js` rather
than starting a parallel store.

**P0.3 — WITHDRAWN. Do not un-park those two for GM mode.** The finding that
they are unreachable is true, but the fix is wrong. Both are written for a
PLAYER: `triggerRandomEvent(playerId)`, decisions like "Request trade", and a
dialogue library of agents saying "let us get you max money". None of it is
addressed to a general manager. Forcing them into GM mode means replacing
their content wholesale, which is not extending an existing system, it is
writing a new one wearing its name.

The GM-facing narrative system already exists and is good: `dialogueScenes.js`
holds 24 scenes, 23 of them tagged `roles: ['gm']`, with reporters, token
interpolation and real choices, wired through `ui/simControls.js`. If GM mode
needs more narrative, that is the system to grow.

**P0.4 — Make morale bite.** Route it into progression and/or the sim so the
relationship layer has stakes.

**P0.5 — SURFACE the AI trades that already happen.** Not build them: they
exist and work. ~30 a season execute and the GM learns nothing about them
beyond a feed line. Trade Drama (Phase 8) does not need a trade engine, it
needs the existing one to be noticed — which is an agenda/news job.

## Testing strategy

Per the repo's conventions: `scripts/validate-*.js`, plain node + assert, no
framework. Agenda items are derived from state, so they are testable without a
UI — construct a game state with a known problem, assert the agenda names it.
Persisted state gets a save/load round-trip test. Anything seeded gets a
determinism test. The full 80-validator suite runs before every commit.

Performance: the agenda derives per-request from live objects and must not
scan league history. Where history is needed, summaries get maintained
incrementally at rollover rather than recomputed.
