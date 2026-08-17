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

_(filled in as the work lands)_
