# Waivers, Buyouts and the Affiliate League — Implementation Plan

**Goal:** finish Tier 2. Releasing a player costs something, another club can
take him off your hands, and the fringe of the roster has somewhere to play.

Design: `docs/superpowers/specs/2026-08-17-waivers-and-affiliates-design.md`

**Tech Stack:** vanilla ES5-style JS, no build step, no imports. Tests are
standalone `scripts/validate-*.js` run with `node` + `assert`.

---

## Global constraints

- No `import`/`export`. New root file → a `<script>` tag in `index.html` in
  dependency order.
- Every seeded call passes its seed.
- `getTeamPayroll` is the one coupling point for money; do not add a second.
- Existing validators stay green. Where one encodes the old free-waive
  behaviour, changing it is a finding to report, not a silent edit.

---

### Task 1: Dead money

**Files:** `league.js`, `rosterMoves.js`, `seasonTransition.js`, `save.js`,
`scripts/validate-deadMoney.js` (new)

`getTeamPayroll` adds `team.deadMoney`. `waivePlayer` records the released
contract there. `decrementContracts` ticks it and drops zeros. `deadMoney`
joins `TEAM_SAVE_FIELDS`.

Expect fallout: cap checks across trades and free agency now see a bigger
number. That is the feature. Measure what it does to AI signing behaviour.

### Task 2: The waiver wire

**Files:** `rosterMoves.js`, `scripts/validate-waivers.js` (new)

`waivePlayer` puts the player on the wire with his contract rather than
releasing him. `getFreeAgents` excludes the wire. `resolveWaiverClaims(dayIndex)`
walks teams in reverse-standings order, claims what fits under the cap and the
roster ceiling, and clears the rest to free agency.

### Task 3: Wire it to the day

**Files:** `script.js`, `league.js` or the day hook, `ui/` as needed

The wire has to resolve on a schedule or the window is fiction. Hook the daily
tick. The user's claim window is the two days before resolution.

### Task 4: Buyouts

**Files:** `freeAgency.js` or a new `buyouts.js`, `scripts/validate-buyouts.js`

`buyoutDecision(player, team, pctForgiven)` — pure, testable without a league.
Accepted, dead money is the reduced figure and the player goes straight to free
agency.

### Task 5: Ten-day contracts

**Files:** `rosterMoves.js`, `scripts/validate-tenDay.js` (new)

Minimum salary, ten game days, at most two per player per team, then sign or
release.

### Task 6: The user's surfaces

**Files:** `ui/roster.js` / `ui/freeAgency.js` / new panel

Dead money visible on the cap sheet — an invisible cost teaches nobody
anything. The wire with a Claim button. Buyout on a rostered player. Ten-day
signings from the free agent pool.

### Task 7: Two-way contracts

**Files:** `rosterMoves.js`, contract model

Outside the fifteen, fixed fraction of the minimum, freely recalled and sent
down. Built before the affiliate league because it is the contract the league
is made of.

### Task 8: The affiliate league

**Files:** `affiliates.js` (new), `schedule.js`, `save.js`,
`scripts/validate-affiliates.js` (new)

Thirty clubs, one per team. Rosters are two-way players plus generated filler.
Own schedule, simulated on the existing engine. Call-ups and send-downs.

### Task 9: Development

**Files:** `progression.js`, `scripts/probe-development.js` (new)

Affiliate minutes progress a young player faster than bench minutes. Probe the
gap — if it is not visible, the league is scenery.

### Task 10: Measure and sweep

**Files:** `scripts/probe-waivers.js` (new)

Claim rate; near 100% or near 0% means the wire is fake. Full validator sweep,
ui-smoke, both goldens, browser check.

---

## What was measured and what was left undone

All ten tasks shipped. **72 validators green, ui-smoke 206/0**,
`gamesim-golden.json` untouched, `rollover-golden.json` regenerated once with
justification below.

### The soft cap nearly killed two mechanics

Twice, a rule that reads correctly on paper turned out to be impossible in this
league. Measured on the opening roster: **2 of 30 clubs** have room to absorb
even a $1.2M contract, because this cap is soft and 28 clubs are over it
(Boston opens $232M against $154M).

So requiring cap space for a waiver claim meant nothing would ever be claimed,
and requiring it to convert a ten-day meant a ten-day could never become the
season deal it exists to lead to. Both mechanics would have shipped dead and
passed every test that did not measure the league.

The minimum-salary exception is now one function, `isMinimumDeal`, asked by both
sites. It is also the real rule — over-the-cap clubs claim minimum contracts and
nothing else, which is exactly why the good claims go to clubs with room.

### Dead money, measured over six seasons

| year | clubs in debt | league total | worst club | % of cap |
|---|---|---|---|---|
| 2026 | 11 | $66M | MEM $28M | 18.1% |
| 2028 | 5 | $56M | GSW $29M | 18.8% |
| 2031 | 9 | $72M | NYK $41M | 26.6% |

Median indebted club owes $2-8M — a nuisance. The worst owes up to a quarter of
the cap. The league total holds rather than compounding, so it is self-limiting.

Before this existed, every club cutting its two worst players cleared **$32M
each, 20.8% of the cap, for free**.

### The claim rate is a gradient, not a coin flip

| owed | claimed | rate |
|---|---|---|
| minimum $1.2M | 30/30 | 100% |
| cheap $4M | 9/30 | 30% |
| mid $12M | 5/30 | 17% |
| expensive $30M | 0/30 | 0% |

Overall 36.7%. That shape is the feature: cutting a bargain costs you the
player, cutting a bad deal costs you for years.

### Development, swept rather than guessed

400 prospects, three seasons, the **same dice down both paths**. A prospect who
sits gains +9.63 overall; playing for the affiliate adds:

| bonus | gap | |
|---|---|---|
| 0.7 | +2.46 | +26% |
| **1.0** | **+3.45** | **+36% — shipped** |
| 1.4 | +4.75 | +49% |
| 2.0 | +6.66 | +69% — first pass, too strong |

At +69% sending a prospect down stops being a decision and becomes an
obligation.

### The affiliate league simulates itself, deliberately

`simulateBoxScoreGame` reaches rosters through `getTeamRoster` and clubs through
`getTeamById`. Reusing it would have meant putting 30 affiliate clubs in `TEAMS`
and 300 filler players in `PLAYERS_2026` — the two arrays every league-wide
sweep walks: standings, stat leaders, awards, the draft, free agency, trades,
the save file. Sixty lines of self-contained simulator cannot perturb the parent
league at all, and `checkFillerStaysOutOfTheLeaguePool` asserts it never does.

It takes its own rng for the same reason: the parent season's determinism and
both goldens depend on the reserves never touching the parent league's dice.

### Golden regenerated, once

`rollover-golden.json`, for dead money only: clubs now carry debt into free
agency and sign differently from the first offseason onward. Season 1's **team
checksum is unchanged at 44672** — those games were played before dead money
could act. `gamesim-golden.json` never moved.

### Two follow-ups, both since fixed

**The AI did not weigh dead money before cutting anyone.** The ceiling sweep
ranked cuts purely by `adjustedPlayerValue`, which was correct while releasing a
player was free and wrong the moment it was not: it would release a $35M
contract to save a spot it could have saved by releasing a $1.2M one. Cuts are
now ranked by `releaseCost` — value lost plus money still owed — and a buyout is
preferred to a release when the player will take one.

| | before | after |
|---|---|---|
| league dead money | $53-72M | **$40-50M** |
| worst club, % of cap | 14-27% | **10-18%** |
| median indebted club | $2-8M | **$1-4M** |

`DEAD_MONEY_AVERSION` is 0.35, which is deliberately not enough to talk a club
out of releasing a star on the minimum — the value gap from a fringe player to a
star dwarfs any contract, and it should. The flip happens where the sweep
actually chooses, at the bottom of the roster.

**A fresh league had exactly zero free agents.** 435 players across thirty
rosters of 13-15 consumes the pool precisely, so ten-days, two-way deals and the
roster-floor sweep all opened on an empty table. The market now carries 24
unsigned journeymen, built from the tail of a generated class — an unsigned free
agent is the man who did not get drafted, so no new generation code was needed.

`rollover-golden.json` was regenerated a second time for the sweep change.
Season 1's team checksum is unchanged at 44672 both times.

### Still left undone

- **No affiliate playoffs, awards or history**, per the design. It is a
  development environment, not a second career.
- **Affiliate games are not watchable** in the pixel view. Box scores only.
- **Waiver claims are first-come for the user**, not priority-ordered against AI
  clubs. Marked `ponytail:` at the site in `waivers.js` with the upgrade path.
