# Feats, History Toys and Family Trees — Design

**Date:** 2026-08-11
**Goal:** Make accumulated league history worth reading. Three features that turn
data the game already produces into stories: single-game feats, history
superlatives, and player family lines.

## Why

Compared against ZenGM (vendored at `reference/zengm/`), the largest gap is not
simulation — it is that our history is inert. ZenGM ships 42 "frivolities"
mining league history, a permanent feat log, and family relationships. We
simulate every game, keep every retiree with career stats, awards, rings and
peak rating, archive every draft pick and every trade — and ask almost none of
it.

Out of scope, decided and recorded so it is not re-litigated: an owner who
reacts to winning and can fire you (the other large gap found in the same
comparison) is a separate feature and a separate spec.

---

## Constraints established before design

These were verified against the code, not assumed.

1. **Box scores do not survive a save.** `save.js` prunes `boxScore` and
   `playByPlay` to the user's own games. A 60-point night by another team is
   unrecoverable after a save/load, so feats **cannot** be mined retroactively.
   They must be detected as games are played and stored in their own right.

2. **`LEAGUE_HISTORY` persists automatically.** `save.js` serialises the whole
   object as `leagueHistory` and restores it key by key. New arrays on it save
   and load with no `save.js` change, and an older save missing a key simply
   leaves the default empty array in place — backwards compatible.

3. **`recordGameResult` is the one function every finished game passes
   through**, and `game.boxScore` is already attached before it is called. But
   it is called from **three** sites: `league.js` (regular season),
   `playoffs.js` (series games) and `playoffs.js` (play-in). It receives only
   `game`, which carries no league year and — in the playoff paths — no day.

4. **Season snapshots cannot back all-time team records.** They are capped by
   `SEASON_SNAPSHOT_LIMIT` and shift off the front, so the oldest seasons
   disappear. All-time team superlatives need their own durable record.

5. **Draft position and trade participation are already archived.**
   `LEAGUE_HISTORY.draftClasses[].picks[]` maps pick number to player, and
   `LEAGUE_HISTORY.trades[].players[]` records every player moved. Per-season
   player stats exist in `careerHistory.seasonByYear`. Most toys need no new
   data.

---

## Architecture

Three new root modules, each with the dual `require`/browser-global bridge every
root module uses. `validate-browserBridges.js` covers them automatically once
they carry the bridge.

| Module | Responsibility | Depends on |
|---|---|---|
| `feats.js` | Detect feats from a box-score line; hold the thresholds | `ratings.js` for nothing; pure |
| `historyToys.js` | Pure ranked-list queries over `LEAGUE_HISTORY` | `history.js`, `teams.js` |
| `relatives.js` | Generate and query family links | `players-2026.js`, `rng.js` |

UI: one new view (`ui/feats.js`), two extended (`ui/frivolities.js`,
`ui/playerProfile.js`).

Each toy is a separate exported function returning a ranked array. That is the
unit boundary: a toy can be understood, tested and changed without touching any
other toy or any rendering code.

---

## Feature 1 — Feats

### Detection

`feats.detectFeats(line, context)` takes one box-score line plus context and
returns zero or more feat records. It is pure: no globals, no dates, no storage.
That makes every threshold testable directly.

`recordGameResult` gains a second parameter carrying the context the feat record
needs:

```
recordGameResult(game, context)   // context: { leagueYear, day }
```

All three call sites pass it. **A static call-site guard asserts all three do**,
in the manner of `validate-userPathRules.js`'s existing check on the two
offseason routes. This is deliberate: the single most repeated defect in this
codebase is a rule reaching one call site and not its siblings, and this change
creates exactly that risk.

Detection runs inside `recordGameResult`, over every line in `game.boxScore`, so
it covers regular season, playoffs, play-in, and the game the user watches
live — every path, because they all call this function.

### Feat kinds

Four, in ascending rarity:

- **Big scoring night** — points at or above the scoring bar
- **Huge scoring night** — a second, higher scoring bar
- **Triple-double** — three of {points, rebounds, assists, steals, blocks} at 10+
- **Five-by-five** — all five of those at 5+

Rebounds are the box score's single `rebounds` field.

### Thresholds are measured, not chosen

A new `scripts/probe-feats.js` sims a few hundred games and reports how often
each candidate bar would fire, league-wide, per season. The bars are then set so
the measured rates land in these bands:

| Feat | Target rate, league-wide per season |
|---|---|
| Big scoring night | 15–40 |
| Huge scoring night | 1–6 |
| Triple-double | 40–120 |
| Five-by-five | 0–3 |

The bands, not the bar values, are the specification. `validate-feats.js`
asserts the measured rate stays inside them, so a later change to scoring pace
fails the test rather than silently making feats commonplace. This mirrors how
the impact-moment thresholds and the league identity bands were set.

Our league scores ~135 a team, so the scoring bars are expected to land well
above basketball's traditional 50. The measurement decides; no traditional
number is assumed.

### Storage

`LEAGUE_HISTORY.feats` — one flat array, newest last:

```
{ leagueYear, day, playerId, playerName, teamId, oppTeamId,
  kind, points, rebounds, assists, steals, blocks }
```

League-wide, kept for the life of the save. Roughly 200 bytes each; at the
target rates above that is a few hundred per season — tens of kilobytes,
against a save that already carries 14MB of play-by-play. `validate-feats.js`
asserts the per-season byte cost stays under a stated ceiling so this cannot
quietly become a second play-by-play.

### Surfacing

- **Feats page** under the Records hub: filterable by season, team and player.
- **Live feed**: a line when one happens, so you notice it in the moment.
- **Player profile**: that player's feats.

---

## Feature 2 — History toys

### The one new record

`LEAGUE_HISTORY.teamSeasons` — one row per team per completed season, written in
`finalizeSeasonHistory` where `allTimeWins` is already being folded in:

```
{ leagueYear, teamId, wins, losses, playoffResult, champion }
```

`playoffResult` reuses `draft.js`'s `playoffResultByTeam` classifier — the same
one the draft order is built from — rather than a second reading of the bracket.
Thirty rows a season.

### The toys

Every function returns a ranked array with a stated ordering. No shared state.

**Draft**
- `biggestBusts()` — top-10 picks, ranked by lowest career production
- `biggestSteals()` — picks outside the top 10, ranked by highest career production
- `bestPlayerAtEveryPick()` — for each pick number, the best career at it
- `draftClassRankings()` — classes ranked by total career production

**Career**
- `bestWithoutARing()` — highest career production, zero championships
- `bestWithoutAnMvp()` — highest career production, zero MVPs
- `mostYearsOneTeam()` — longest unbroken spell
- `mostTeams()` — most distinct franchises
- `careerEarnings()` — summed from `careerHistory.contractHistory`
- `hallOfVeryGood()` — highest Hall of Fame scores that fell short of induction

**Team seasons**
- `bestTeams()` / `worstTeams()` — by wins
- `bestToMissThePlayoffs()` — most wins with `playoffResult` of "missed"
- `worstToWinIt()` — fewest wins among champions

**Trades**
- `biggestTrades()` — most combined production moved
- `mostLopsidedTrades()` — see the rule below

**Career production** means points + rebounds + assists, summed from career
stats. It is a plain counting proxy, chosen because we have it for every player.
It is not a claim about value, and the UI labels it "production" rather than
implying otherwise.

**Every toy reads active players AND retirees.** `LEAGUE_HISTORY.retiredPlayers`
alone would leave every one of these lists empty for the first fifteen seasons
of a save, which is most of the time anyone will look at them. `historyToys.js`
therefore builds its candidate pool by concatenating `PLAYERS_2026` (each of
which carries `careerStats` via `history.ensureCareerData`) with the retiree
archive, keyed by player id so nobody is counted twice. `validate-historyToys.js`
asserts a league one season old already returns non-empty lists.

### The lopsided-trade rule

The only toy needing a judgement rather than a sort, so it is stated explicitly:

> For each side of a trade, sum the production its incoming players recorded in
> the seasons **strictly after** the trade year, taken from
> `careerHistory.seasonByYear`. Lopsidedness is the absolute difference. Trades
> less than three seasons old are excluded, because a verdict needs time.

### Presentation

Frivolities becomes an index of toys — pick one, see its list. The six panels
already on that page (Most Active Trade Partners, Most-Traded Players, Draft
Class Hit Rates, Most Popular Jersey Numbers, Longest Current Tenures, and the
counters strip) stay at the top as a league-at-a-glance section. Most-Traded
Players and Draft Class Hit Rates already exist and are **not** duplicated by
the new toys.

---

## Feature 3 — Family trees

### Data

Players gain one field:

```
relatives: [ { type: 'father' | 'son' | 'brother', playerId, name } ]
```

Always written in both directions — a son gets a `father` entry and the father
gets a `son` entry — so no query has to search the whole league to answer "does
this player have relatives".

### Generation

At draft-class generation only. Real 2026 players receive nothing invented; the
decision was explicit, because asserting that two real people are brothers is a
different thing from generating a fictional lineage.

- **Sons**: a new prospect may be the son of a player who actually played in
  this league — retired or active — inheriting the surname and a nudge toward
  the father's strengths: each of the son's attributes moves 15% of the way
  toward the father's value in that attribute, before the usual per-player
  variation. Enough that the resemblance is visible in the ratings; not enough
  to make a star's son a star.
- **Brothers**: two prospects in the same class may share a surname and a link.

Rates are set by measurement, not taste, and asserted in band the same way the
feat thresholds are — a link should be a pleasant surprise, not routine:

| Link | Target rate |
|---|---|
| Draft classes containing at least one son | 15–35% |
| Draft classes containing a pair of brothers | 5–15% |

A father must have entered the league at least 18 seasons before his son's
draft, so the timeline is never absurd. If no eligible father exists — which is
every draft for the first eighteen seasons — no son is generated that year, and
that is the expected result rather than a failure.

### Surfacing

- **Player profile**: "Son of Jayson Tatum (2026–2041)", linked.
- **A Relatives toy** in Frivolities listing every known family.

This pays off slowest — a fresh save shows nothing for roughly fifteen seasons —
which is why it is built last.

---

## Testing

A validator per feature, in the established style: `validate-feats.js`,
`validate-historyToys.js`, `validate-relatives.js`.

- **Feats**: detection asserted per kind against hand-built lines including
  boundary cases at each bar; measured league rates asserted inside the target
  bands; the per-season byte cost asserted under its ceiling; the call-site
  guard asserting all three `recordGameResult` sites pass context.
- **Toys**: each toy asserted against a small constructed `LEAGUE_HISTORY` with
  a known right answer, so a ranking bug is caught by the ordering rather than
  by a crash. Empty history returns empty lists rather than throwing — a brand
  new league opens these pages.
- **Relatives**: both directions of every link present; no self-links; no
  cycles; the timeline rule holds; generation rate in band.
- Every new guard **mutation-tested** — broken deliberately, confirmed red.
- A **save round-trip** asserting feats, team seasons and relatives all survive,
  plus a load of a save written before these fields existed.
- **Browser smoke** for the new and changed views.
- Both golden masters must be **unmoved**. None of this changes simulation.

---

## Scope

Three features in one spec because they share a home, a data store and a theme.
Each is independently shippable and independently useful: feats need nothing
from the toys, the toys need nothing from families, and families are themselves
one more toy. If the plan proves too large, splitting it at the numbered
boundaries below costs nothing.

## Build order

1. **Feats** — self-contained, pays off from the first game played.
2. **History toys** — largest surface, and the `teamSeasons` record it adds is
   useful on its own.
3. **Family trees** — smallest, slowest to pay off, and is itself a toy.
