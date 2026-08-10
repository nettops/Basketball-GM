# GM Career & Legacy — Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Branch:** `live-game-sim`

## The problem

The simulator has depth — 30 views, watchable games, badges, traits, awards, a
50-season-stable league — and no stakes. Measured, not assumed:

- **Nothing judges you.** There is no owner mandate, no firing, no expectations,
  no goals, no failure state. A search of the whole project for `fired`,
  `expectation`, `hotSeat`, `jobSecurity`, `objective` returns nothing outside of
  unrelated comments. You can miss the playoffs for fifty consecutive years and
  the game will never react.
- **Nothing remembers you.** `GameState.feed` is a rolling window capped at 200
  entries (`script.js:90`); older news is discarded. Win a title in season 3 and
  by season 5 no trace of it exists in any feed the player can read.
- **Nothing knows who you are.** There is no GM identity in `GameState` at all.
  `ui/legacyView.js` reads `GameState.playerLegacy`, which belongs to the parked
  player-career mode, not to the GM.
- **The story machinery is aimed elsewhere.** `narrativeSystem.js` is a canned
  dialogue library written in the second person to a *player* ("You're a star
  now. Let's get you max money."), consumed only by `ui/playerDashboard.js` —
  part of the parked career mode. For a GM it is dead weight.

The user's own framing, choosing three of four offered gaps: nothing is at
stake; seasons are numbers, not story; there is no sense of what to do next.

These are one problem. **The game never reacts to you.**

## Goals

1. You are a person with a name and a permanent, public career record.
2. There is always something to work toward, without anything nagging you.
3. Your career reads back as a story, not a stat table.
4. Winning is marked as a moment, not a line of text that scrolls away.

## Non-goals

Explicitly rejected during design, and not to be reintroduced:

- **No firing, no job loss, no game over.** The user chose consequence-free
  permanence: "Nothing, but it's on your record." Failure is recorded, never
  punished.
- **No owner mandates or assigned season goals.** The user rejected both the
  owner-sets-a-goal and declare-your-own-plan options. Direction comes from a
  chase-list the player browses at will.
- **No new nagging.** Nothing here may add a required decision, a modal that
  blocks progress, or a per-season chore. The project's standing constraint is
  to minimise micromanagement.

## Architecture: one new fact, everything else derived

The game already permanently archives nearly everything needed:

| Already kept | Where |
| --- | --- |
| Champion each year | `LEAGUE_HISTORY.champions` |
| Every trade ever made | `LEAGUE_HISTORY.trades` (via `archiveTrade`) |
| Every draft class and pick | `LEAGUE_HISTORY.draftClasses` (via `archiveDraftClass`) |
| Every season's award winners | `LEAGUE_HISTORY.awardsHistory` |
| Every retiree's full career | `LEAGUE_HISTORY.retiredPlayers` (via `archiveRetiree`) |
| Per-player career totals, awards, teams played for | `player.careerStats`, `awardsWon`, `teamsPlayedFor` |
| All-time franchise wins/losses | `team.allTimeWins` / `allTimeLosses` |

The single missing fact is **which team was the user's, in which years**.

Add that, and the career record is a *query over history the game already
keeps* rather than a parallel set of counters. This is the load-bearing
decision. Parallel counters are how "3 titles" on one screen ends up
disagreeing with a four-banner trophy room on another; a derived record cannot
drift because there is only one copy of the truth.

This directly addresses a defect pattern this codebase has hit four times
(`level`/`traitsAreFuzzy`, `rawOverall`/`overall`,
`computeOverall`/`computePositionalOverall`, `potential` floored by
`clampedOverall`): two fields carrying one meaning. The rule here is that no
career statistic is ever stored if it can be computed.

### What must be stored, and why

Two things cannot be derived and so must be recorded.

**1. The tenure log** — the missing fact itself.

```js
GameState.gmCareer = {
  name: 'Cory Williams',          // entered at team select, defaults to 'GM'
  tenures: [                       // a LIST from day one: multi-stint ready
    { teamId: 'BOS', startYear: 2026, endYear: null }   // null = current
  ],
  seasons: [ /* see below */ ],
  milestones: [ /* see below */ ],
  chronicle: [ /* see below */ ]
};
```

Ships with exactly one open tenure. Changing teams mid-career is deliberately
out of scope (see below), but the shape is a list so adding it later requires
no migration.

**2. The per-season row** — the one genuine gap in the existing archive.

`LEAGUE_HISTORY.champions` records only the winner. `team.lastSeasonWins` is a
single value overwritten every year. So **how a past season ended for a
non-champion is not recoverable** — there is no archive of "eliminated in the
conference finals, 2031".

```js
// one row appended per season, from finalizeSeasonHistory
{ leagueYear: 2031, teamId: 'BOS', wins: 54, losses: 28, result: 3 }
```

`result` uses the round encoding **already implemented** in `draft.js:36-45`
for lottery ordering — `0` first-round exit, `1` conference semis, `2`
conference finals, `3` lost the Finals, `4` champion — plus `-1` for missed the
playoffs. That classifier is extracted into a shared, named function rather
than duplicated, so there is exactly one definition of how a season ended.

Everything else on the career page is computed on read: titles, Finals
appearances, playoff rate, total wins, your draft picks, your trades, players
who peaked under you.

### The single write point

`history.js`'s `finalizeSeasonHistory(leagueYear, playoffBracket, feedSink)` is
already the one place season-end history is written, called once from
`script.js` at the top of `handleAdvanceToOffseason`. All career recording
hangs off it, in this order:

1. Append the season row (needs `playoffBracket` before it is discarded).
2. Evaluate milestones against the now-updated history.
3. Append chronicle entries for anything notable, including newly unlocked
   milestones.

No new hook, no new call site, no ordering hazard introduced.

## The chase list

A browsable list of career achievements, in five families, evaluated once a
season. It mirrors the existing player-milestone pattern
(`MILESTONE_THRESHOLDS` + `checkMilestones` in `history.js:77`), which already
converts a crossed threshold into a feed line — the same mechanism, applied to
the GM.

| Family | Examples |
| --- | --- |
| Winning | First title; back-to-back; three-peat; 60-win season; sweep the Finals |
| Building | Draft a Hall of Famer; develop an MVP; a player spends his whole career with you |
| Dealing | Acquire a player who becomes an All-Star; turn a second-round pick into a star |
| Endurance | 10 seasons; 25 seasons; 1,000 career wins |
| Absurd | 70-win season; five titles; a player wins MVP five times under you |

**Visibility.** Most are listed from day one so there is always a stated next
thing to work toward. The rarest tier stays hidden and appears only when
achieved, so something is still discoverable twenty seasons in. Each milestone
carries an explicit `hidden: true|false` flag; hidden ones render as a locked
placeholder count ("4 legendary achievements undiscovered"), never as a
spoiler.

**Storage.** Only the *unlock* is stored — `{ id, leagueYear }`. Whether a
milestone is currently satisfied is always recomputed; the stored row exists so
that "when did this happen" survives, and so an achievement cannot be silently
revoked by a later rules change.

**Calibration is a requirement, not a polish pass.** The thresholds above are
starting points, not decisions. A list where half the entries are unreachable
discourages; one cleared by season eight is empty. Per this project's standing
rule — calibrate by measured rate, never by picked values — a probe must run 50
simulated seasons and report, for every milestone, the season it first fires
and how many times it fires. Targets:

- Every non-hidden milestone fires at least once across 50 seasons of
  competent play, or its threshold moves.
- No milestone fires in more than ~60% of seasons, or it is not an achievement.
- The hidden tier fires rarely — roughly once per 20+ seasons each.

Thresholds move to hit the measured rate. Bounds are never widened to make a
value pass.

"Competent play" is defined operationally, not left to judgement: the probe runs
the user's team under `autoGM.js`, the same automation an unattended team already
gets. That is a deliberately *average* baseline — a real player should clear
milestones somewhat faster than the probe does, so tuning against it errs toward
the list being achievable rather than punishing. The probe reports across all 30
teams-as-user, not one, so a milestone is not calibrated against a single lucky
franchise.

## The chronicle

A permanent, deliberately **selective** timeline — not a copy of the feed. The
feed is noise, which is exactly why it is disposable at 200 entries. The
chronicle takes only career-grade moments:

- How each season ended (from the season row)
- Every milestone unlocked, dated
- Awards won by your players
- Your draft picks, recorded on draft night and again the season they first
  reach stardom
- Franchise records set (best record in franchise history, longest playoff
  streak)

Roughly 3-8 lines per season. Fifty seasons is a few hundred short strings —
trivial to store, and it reads as a career instead of 200 stale trade notices.

Each entry: `{ leagueYear, kind, text }`. `kind` drives grouping and iconography
in the view.

`text` is the one deliberate exception to "never store what can be computed",
and the reason is specific: team names are mutable. `commissioner.js` can rename
and edit franchises, and expansion teams appear mid-save, so a line rendered
lazily could claim you won the 2031 title with a franchise that did not exist
until 2034. The chronicle is a historical record, so each line is frozen in the
words that were true when it happened. Nothing numeric is stored — no counts,
no totals — only the sentence.

## The trophy room

The same derived record, presented as an object rather than a table: a banner
per championship, a shelf that fills as you win, rings you can count. It reads
the derived title list — no separate storage, so it cannot disagree with the
timeline sitting above it.

**The banner raising.** Winning the championship currently produces one feed
line that scrolls away. Instead, on winning a title, the player gets a marked
beat — a banner raising — before being returned to the offseason. It reuses the
existing pixel/scene presentation style rather than introducing a new visual
system; the point is the pause and the acknowledgement, not spectacle. A first
title is presented differently from a fourth.

This must respect the existing pause machinery: it is a scene, shown on the
same footing as the existing narrative and random-event scenes, and it must not
block or stall a long fast-forward beyond the way `madePlayoffs` already does.

## Where it lives

- **Career page** — new view in the existing **Records** hub (`hub-records`,
  `ui/nav.js:62`), alongside History, Awards and Season Recap. Two faces:
  the chronicle timeline, and the trophy room.
- **Dashboard** — the milestone you are *closest to* surfaces on the screen the
  player already lands on. This is the "what do I do next" answer, and it fails
  if it is three clicks away.

  "Closest" is defined, not left to taste: among visible, not-yet-unlocked
  milestones that expose a numeric progress fraction (`current / threshold`),
  the highest fraction wins; ties break toward the lower threshold, then by
  declaration order, so the choice is deterministic and a save reloads showing
  the same one. Milestones with no meaningful fraction — "sweep the Finals" is
  binary — are excluded from this pick rather than assigned a fake progress
  number. If nothing qualifies, the slot renders the count of remaining
  milestones instead of an empty panel.
- **Team select** — a name field. Defaults to `GM` so it is never a blocking
  prompt.

## Persistence

`gmCareer` is a plain JSON-safe object, added to the save payload in `save.js`
alongside `leagueHistory`. `SAVE_FORMAT_VERSION` goes 2 → 3. Loading a version-2
save produces a career seeded with a single tenure starting at that save's
current `leagueYear` — honest about not knowing the past rather than
fabricating a record.

## Testing

Everything here is bookkeeping over data the game already keeps, so nearly all
of it is testable in Node alongside the existing 43-validator suite.

- **`scripts/validate-gmCareer.js`** — new validator. Tenure and season rows
  append exactly once per season; the result classifier agrees with the bracket
  for all six outcomes; milestone unlock is idempotent across a re-run of the
  same season.

  The anti-drift assertion needs care. Checking the career page's title count
  against the trophy room's banner count is **vacuous** — both read the same
  derived function, so the test passes no matter how wrong that function is. It
  must instead compare against an *independent re-implementation* that walks
  `LEAGUE_HISTORY.champions` and the tenure list directly, the same idiom
  `validate-skillCheck.js`'s `referenceShot` already uses. That means a future
  change to the career logic has to be mirrored in the validator by hand — which
  is the point, not an inconvenience.
- **`scripts/validate-save.js`** — extend: a career round-trips through save and
  load unchanged, and a version-2 save loads without throwing.
- **`scripts/probe-gm-milestones.js`** — new calibration probe. 50 seasons,
  reports first-fire season and fire count per milestone. Its output table goes
  into the commit message, per the standing rule that sweeps are recorded.
- **Mutation testing.** Every new assertion is mutation-tested. A surviving
  mutant means either the assertion is worthless or the code under it is dead —
  the finding must state which.
- **Browser check.** The career page and the banner raising are verified live,
  served from a fresh port with no-store, per the standing requirement that
  stale JS otherwise stays pinned.

## Risks

- **The chase list is a balance problem wearing a coding problem's clothes.**
  Getting the thresholds wrong is the most likely way this ships and still
  isn't fun. Mitigated by making calibration a required, measured step with
  stated targets — not a follow-up.
- **A record nothing references is a trophy shelf in a closet.** Mitigated by
  surfacing the nearest milestone on the Dashboard and routing every unlock
  through the news feed, so the record intrudes on normal play rather than
  waiting to be visited.
- **Scene fatigue.** A banner raising is a beat; a banner raising plus a
  milestone popup plus an award ceremony in the same offseason is an
  interruption. Only the championship gets a full scene. Milestones are feed
  lines and a Dashboard change, never a modal.

## Deliberately out of scope

Recorded so they are not lost, and not built here:

- **Changing teams mid-career.** The tenure log is a list specifically to
  support this later. Shipping with one tenure; adding job changes needs its own
  design (who hires you, do you choose, what happens to the team you left).
- **The owner speaking to you.** `team.ownerHappiness` is *already alive* — it
  sets your spending posture (`finances.js:58`), moves with your luxury-tax
  outcome (`finances.js:126`), and is already displayed as a Dashboard KPI tile
  (`ui/dashboard.js`). So the owner is visible; what it lacks is a *voice* — the
  number never explains why it moved or reacts in words. Giving it one is a
  cheap future win, but the user explicitly rejected owner-set goals, so nothing
  here reads or writes it.
- **Storylines and rivalries** (approach B) and a broader ceremony system
  (the rest of approach C). Both become cheap once the chronicle exists, since
  the chronicle is where a storyline would be recorded.
- **Player-career mode.** Parked, unrelated, and untouched by this work.
  `narrativeSystem.js` and `ui/legacyView.js` are not modified.
