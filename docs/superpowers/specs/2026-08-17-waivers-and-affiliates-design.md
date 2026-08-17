# Waivers, Buyouts and the Affiliate League — Design

**Goal:** the rest of Tier 2. Releasing a player should cost something, another
club should be able to take him off your hands, and the fifteenth and sixteenth
men should have somewhere to play.

Completes the Tier 2 "missing GM layer" begun in
`2026-08-17-restricted-free-agency-design.md`.

---

## What was measured first

| | |
|---|---|
| free agents at rest | **0** |
| roster sizes | 13–15 |
| median rostered salary | $11,500,000 |
| every team cuts its two worst | 60 players, **$962M**, $32M per team |
| that, as a share of the cap | **20.8%** |

The last row is the whole problem. `rosterMoves.js`'s `waivePlayer` sets
`teamId = null` and returns, and `getTeamPayroll` sums the current roster only —
so a GM in cap trouble can release his two worst contracts and free a fifth of
the cap at no cost, this afternoon, with no downside at all. Every other
financial rule in the game is negotiated against a number that can be deleted.

That also explains why buyouts have nothing to be about. A buyout is a
negotiation over guaranteed money; with no guaranteed money there is no
negotiation.

And "free agents at rest: 0" is why the affiliate league is not merely
decoration: today there is nowhere for a fringe player to be. A waived player
is instantly signable by anyone, and nobody is developing out of sight.

## The four pieces, in dependency order

### 1. Dead money — the spine

`team.deadMoney`: a list of `{ playerId, name, salary, yearsRemaining }`.
`waivePlayer` moves the contract there instead of vaporising it, and
`getTeamPayroll` adds it. `decrementContracts` ticks it down each offseason and
drops entries that reach zero.

One function is the whole coupling: everything that already asks "what does this
team owe" goes through `getTeamPayroll`, so cap checks, trade legality and free
agency inherit dead money without being touched.

**All contracts are guaranteed.** Real basketball has partial guarantees; this
game does not model them and does not need to. The decision being restored is
"can I afford to be wrong about this player", which a flat guarantee poses
perfectly well.

### 2. Waivers — somebody else's problem, maybe

A waived player does not become a free agent. He sits on the wire for **two game
days** with his contract attached. Any team with room under the cap and a roster
spot may claim him and **inherits the contract**, which cancels the original
team's dead money.

Claims resolve in reverse-standings order: worst record gets first call, which
is what makes a bad team's cap space worth something.

Unclaimed, he clears to free agency and the waiving team keeps the dead money.
This is the shape of the decision: a good contract gets claimed and costs you
nothing but the player; a bad one clears, and you pay for it for years.

`getFreeAgents` must exclude players on the wire, or the pool sees them a day
early and the window means nothing.

### 3. Buyouts — negotiating the guarantee down

A player under contract may be offered a buyout: he forgives a share of what he
is owed in exchange for immediate release. He weighs the money against how much
he wants out — a deep bench role on a losing team is worth paying to escape;
a starter's minutes are not.

Accepted, the team's dead money is the reduced figure and he goes straight to
free agency rather than the wire. That is a deliberate simplification of the
real rule (bought-out players do pass through waivers), and it is the right one:
at a reduced salary nobody claims him, so the wire would be a formality that
costs the player two days of the market.

The contender's side is the point — a useful veteran appears mid-season for the
minimum, and the clubs with cap room are usually not the clubs who want him.

### 4. Ten-day contracts

Minimum salary, expires after ten game days, counts against the roster ceiling
while it runs. A team may sign the same player to at most two before it must
either sign him for the rest of the season or let him go.

Injury cover with a deadline attached. Small, and it is the piece that gives the
affiliate league somewhere to send its players.

### 5. Two-way contracts and the affiliate league

Thirty affiliate clubs, one per team, each with its own roster, schedule and
simulated games.

- **Two-way contracts** do not count against the fifteen-man limit and pay a
  fixed fraction of the minimum. A two-way player may be recalled and sent down
  freely.
- **Affiliate rosters** are the parent club's two-way players plus generated
  filler, so a game always has ten men.
- **Affiliate games** run on the existing sim. They are simulated, not watched:
  box scores exist, the pixel view does not open on them.
- **Call-ups and send-downs** are the daily decision. A two-way player who is up
  is on the parent roster for as long as he is up.

Development is the reason to care: minutes in the affiliate league progress a
young player faster than a seat on the parent bench, so the choice between
keeping a prospect close and letting him play is a real one.

**This is the largest piece by a distance** — a second league to schedule,
simulate, save and render. It is built last, on top of the transaction layer,
because two-way contracts are contracts and call-ups are roster moves.

## What this does not do

- **Partial guarantees.** See above.
- **The stretch provision.** Spreading dead money over more years is a second
  lever on a mechanic that has yet to prove it needs one.
- **Affiliate playoffs, awards or history.** The affiliate league is a
  development environment, not a second career.
- **Watching an affiliate game in the pixel view.** Box scores only.

## Verification

- `scripts/validate-deadMoney.js` — payroll includes it, waiving creates it, a
  claim cancels it, the offseason ticks it down and retires it.
- `scripts/validate-waivers.js` — the window, claim priority, cap and roster
  legality of a claim, clearing, and the free-agent pool excluding the wire.
- `scripts/validate-buyouts.js` — the accept/refuse decision, the reduced
  figure, and that a bought-out player reaches free agency.
- `scripts/validate-tenDay.js` — expiry, the two-contract limit, roster
  accounting.
- `scripts/validate-affiliates.js` — roster construction, a simulated affiliate
  day, call-up/send-down legality, two-way players outside the fifteen.
- `scripts/probe-waivers.js` — claim rate. **Near 100% or near 0% means the
  wire is fake**, the same measure restricted free agency lives by.
- `scripts/probe-development.js` — that affiliate minutes actually beat bench
  minutes for a young player, and by how much.
- Both goldens, the full validator sweep, and ui-smoke.
