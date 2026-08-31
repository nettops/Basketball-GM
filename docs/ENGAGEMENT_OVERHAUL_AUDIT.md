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

## Measured: the GM's season is nearly empty

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

**That is the boredom cause.** It is not that the events are bad — the dialogue
writing is good. There are almost none of them, and the cap is a hard constant,
not a consequence of anything the player did.

## Measured: the league does not move on its own

`proposeTrade` (`trade.js:186`) has exactly one app caller:
`ui/tradeCenter.js:33` — the human pressing a button. `autoGM.js` exposes
`generateTradeOffer`, but nothing runs an AI-to-AI trade pass during a season.

Zero trades in a full simulated season is not a tuning problem. Rival teams
never reshape themselves, never call you, and never compete for a player. Every
transaction in the league is one you initiated. Phases 7 and 8 (Rival GMs,
Trade Drama) have no substrate to sit on until this exists.

## Systems that compute and are thrown away

The recurring failure shape in this repo, and it recurs here:

- **`relatives.js`** — `ensureRelatives` has **no app caller**. Family ties are
  never generated, so `relatives.js` (204 lines) affects nothing. Phase 2's
  "you drafted his younger brother" has no data behind it today.
- **`morale.js`** — read by UI, `freeAgency.js` and `playoffs.js`, but **never
  by `simEnginePossession.js`, `gameSim.js`, or `progression.js`**. An unhappy
  player does not play worse or develop slower; he is only harder to re-sign.
- **`gmMilestones.js`** — `MILESTONES`, `nearestMilestone`, `isUnlocked` have no
  app caller. The milestone ladder exists and is never shown.

## Ranked weaknesses

1. Narrative/event systems unreachable in GM mode (parked-mode dependency).
2. Event volume capped at ~3/season by constant, unrelated to game state.
3. League is transactionally inert — no AI trades.
4. Consequence has no memory: decisions do not persist into later seasons.
5. Relationships have no substrate (relatives never generated, morale inert).
6. Morale is a number that changes nothing on the floor.

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

**P0.3 — Un-park the narrative layer for GM mode.** Give `NarrativeSystem` and
`RandomEventSystem` a GM entry point driven by agenda state, not by the parked
career mode. Do not fix `createCustomPlayer` here; that is career mode's bug
and a separate job.

**P0.4 — Make morale bite.** Route it into progression and/or the sim so the
relationship layer has stakes.

**P0.5 — AI trade pass.** Give the league its own transaction heartbeat so
Rival GMs and Trade Drama have substrate.

## Testing strategy

Per the repo's conventions: `scripts/validate-*.js`, plain node + assert, no
framework. Agenda items are derived from state, so they are testable without a
UI — construct a game state with a known problem, assert the agenda names it.
Persisted state gets a save/load round-trip test. Anything seeded gets a
determinism test. The full 80-validator suite runs before every commit.

Performance: the agenda derives per-request from live objects and must not
scan league history. Where history is needed, summaries get maintained
incrementally at rollover rather than recomputed.
