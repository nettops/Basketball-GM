# Restricted Free Agency — Implementation Plan

**Goal:** a rival can put a price on your young player, and you have to answer it.

**Architecture:** a branch inside the existing `runResigningWindow`, not a new
offseason phase. An offer sheet is `generateAIOffer` plus an overpay premium;
the matching decision reuses `adjustedPlayerValue` and `checkOffer`.

**Tech Stack:** vanilla ES5-style JS, no build step, no imports. Tests are
standalone `scripts/validate-*.js` run with `node` + `assert`.

Design: `docs/superpowers/specs/2026-08-17-restricted-free-agency-design.md`

---

## What was measured first

1. **The pool is the right size already.** Of 82 expiring players in the opening
   league, **10 have `yearsPro <= 4`** — 12%. A handful of real decisions an
   offseason, not a second market.
2. **The window to hook into already exists.** `decrementContracts`
   (`seasonTransition.js:72`) → `runResigningWindow` (`freeAgency.js:420`), with
   the user's own players deferred via `player.resignRights`.
3. **The pricing vocabulary already exists.** `estimateFairSalary`,
   `generateAIOffer`, `scoreOffer`, `checkOffer`, `adjustedPlayerValue`. Nothing
   new needs inventing to price a sheet or judge a match.

## Global constraints

- The unrestricted path must not move; `validate-resigning.js` stays green
  **unedited**.
- No `import`/`export`.
- Every seeded call passes its seed.
- A match obeys `checkOffer` like any other signing.

---

### Task 1: Who is restricted

**Files:** `freeAgency.js`, `scripts/validate-restrictedFA.js` (new)

`isRestrictedFreeAgent(player)` — `yearsPro <= 4` and under contract to a team.
Pure, file scope, exported.

### Task 2: An offer sheet a team would regret matching

**Files:** `freeAgency.js`

`generateOfferSheet(team, player, rng)`: `generateAIOffer` with an overpay
premium, returning null when the rival cannot fit it or does not want him
enough. Reuses `checkOffer` so a sheet is never illegal for the team writing it.

### Task 3: Match or let him go

**Files:** `freeAgency.js`

`evaluateMatch(team, player, sheet)`: compares `adjustedPlayerValue` against the
sheet's cost, and refuses when matching would be illegal. Pure and testable
without a league.

### Task 4: Wire it into the window

**Files:** `freeAgency.js`

Restricted players branch inside `runResigningWindow`. The user's restricted
players defer as they do today, but carry the sheet alongside their
`resignRights` so the UI can present the real decision.

### Task 5: The user's two surfaces

**Files:** `ui/freeAgency.js`

Defending: the sheet against each of the user's restricted players, with Match /
Decline. Raiding: write a sheet on another team's restricted free agent.

### Task 6: Automation must not leak talent

**Files:** `freeAgency.js`

`autoExerciseResignRights` has to answer sheets too, or an automated save loses
exactly the players it exists to keep.

### Task 7: Measure the match rate

**Files:** `scripts/probe-restrictedFA.js` (new)

Over several offseasons: how many restricted, how many drew a sheet, how often
matched. **Near 100% or near 0% means the premium is mistuned and the decision
is fake** — that is the number this feature lives or dies by.

### Task 8: Goldens and the sweep

Regenerate `rollover-golden.json` with justification. Full validator sweep,
ui-smoke.

---

## What was measured and what was left undone

67 validators green, ui-smoke 200/0, `gamesim-golden.json` untouched,
`rollover-golden.json` regenerated with justification below.

### The decision is live, first try

Over five offseasons:

| | |
|---|---|
| expiring players | 410 |
| of those, restricted | 50 (12.2%) |
| drew an offer sheet | 50 (100%) |
| **matched (kept)** | **36 (72.0%)** |
| poached (lost) | 14 (28.0%) |
| mean overpay | 1.31x fair value |

72% matched sits in the target band and matches the real thing, where most
sheets are matched but not all. The premium landed at 1.3 without needing a
sweep.

**Every restricted player draws a sheet**, which is higher than real life and is
a deliberate keep. The sheet is the best of 29 rivals, so somebody always wants
a decent young player; and at ten to twelve restricted players a league-year,
each one being a real decision is the point rather than a nuisance. If it ever
reads as mechanical, the lever is a wanting-him bar inside `generateOfferSheet`.

### The unrestricted path did not move

`scripts/validate-resigning.js` passes **unedited** — 88% of expiring players
take that path and it is byte-for-byte the code it was.

### One design correction from reading the source

The spec first said matching must pass `checkOffer`. `freeAgency.js:313`
corrected it: a team may already exceed the cap to re-sign its own expiring
player and nobody else, deliberately, because otherwise the good teams — which
are the ones over the cap — lose everyone they develop. A restricted free agent
is exactly that case, so matching inherits the rule. The roster ceiling is free
here, since the player is already rostered.

### An unmatched sheet is a signing, not a release

Both the automated path and the never-answered path send the player to the club
that wrote the sheet rather than into free agency. Getting this wrong would have
made ignoring the panel strictly better for the user than declining on it, and
would have given the rest of the league a second bite at a player who was never
on the market. Asserted in `checkAnUnansweredSheetSignsHimAway`.

### Golden regenerated, deliberately

`rollover-golden.json`. Offer sheets redirect 28% of restricted players to
different clubs, which changes rosters and therefore every season after.

Season 1's **team checksum is unchanged** (44672) while its roster checksum
moves — exactly right, since sheets act in the offseason after those games were
played. `probe-invariants.js` holds over 10 seasons and the league pool
oscillates 533-553 as it always has, so the small player-count shift is churn,
not a leak. `gamesim-golden.json` is untouched.

### The raiding half (added after the first pass)

Shipped. The flow change it needed:

`runResigningWindow` no longer settles other clubs' restricted players on the
spot. It **parks** them — rights held, sheet attached, roster spot kept — and a
new `resolveLeagueRestrictedFA` answers for all of them when the market opens,
from both paths (`script.js`'s manual advance and `seasonRollover.js`'s
unattended one). In between sits the GM's window to write a competing sheet.

The player keeps whichever sheet **he** prefers, scored through the existing
`scoreOffer`, so outbidding is not merely a matter of being last to speak — a
contender with minutes can hold off more money from somewhere he does not want
to go, the same rule the open market already runs on.

Verified end to end in the browser: Chicago ($101M payroll, real space) wrote
$12M x 4 on Indiana's Quenton Jackson, Indiana declined to match, and he moved
to Chicago on Chicago's terms with nobody left parked. Boston, $77.8M over the
cap, is refused with exactly that sentence — the refusal is shown rather than
swallowed, because "you have no room" is the interesting half of the answer.

### Two test defects this pass exposed

**A test that passed without reaching its subject.** The first
`checkAWinningRaidLandsThePlayer` raided from Boston, which opens $232M against
a $154M cap — every `writeOfferSheet` was refused, the loop fell through, and it
printed "every incumbent matched" having never raided anyone. It now picks the
lowest-payroll club and asserts the sheet is accepted before going further.

**A fixture that skipped the step it was asserting about.** `parkedFixture` ran
the window but not `decrementContracts`'s release pass, so "nobody is stranded"
failed by construction on 94 players. It now mirrors the real pipeline, and
snapshots the league so successive checks do not decrement contracts
cumulatively.

### A pre-existing duplicate this uncovered

`resolveLeagueRestrictedFA` crashed inside `validate-seasonRollover.js` on a
player whose rights were already spent. The cause was a **duplicate id in
`PLAYERS_2026`** — `prospect-jamier-jones-24` appearing twice in a 22-entry
list, so the same player was answered twice.

Nothing in this feature writes to the player pool, and the validator's own
header notes it deliberately runs several offseasons against one shared
`PLAYERS_2026`. So this is either a harness artifact of that reuse or an older
draft bug; it is **not** caused by restricted free agency, and chasing it inside
this change would have been scope creep.

What this change owes is robustness, and it now has it: the list is a snapshot,
resolving one player moves the world, and an entry whose rights are already
spent is skipped. Worth a separate look.

### Superseded: what was left undone in the first pass

The spec called for two directions and **only defending shipped**. The user can
answer sheets written against their own players; they cannot yet write one on
another club's restricted free agent.

This is not more typing — it needs a flow change. `runResigningWindow` resolves
AI teams synchronously, so by the time the user reaches the free agency screen
every other club's restricted player is already settled. Letting the user raid
means deferring AI restricted resolution until after the user has had a chance
to write sheets, which reorders a window that currently processes best-players-
first for a reason (a club facing two expiring stars and one roster spot keeps
the better one).

That is its own change with its own ordering risk, and bolting it on here would
have put an untested reordering inside a feature that is otherwise measured.

### Rest of Tier 2, still untouched

Waivers and buyouts, 10-day contracts, two-way contracts and a development
league. Each its own spec.
