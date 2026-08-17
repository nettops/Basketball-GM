# Owner Mandates, Rivalries, Difficulty and Press Memory — Implementation Plan

**Goal:** Tier 3. Somebody is watching you, some games matter more than others,
and the game can be made to fight back.

Design: `docs/superpowers/specs/2026-08-17-owner-and-rivals-design.md`

**Tech Stack:** vanilla ES5-style JS, no build step, no imports. Tests are
standalone `scripts/validate-*.js` run with `node` + `assert`.

---

## Global constraints

- No `import`/`export`. New root file → a `<script>` tag in `index.html` in
  dependency order.
- Every seeded call passes its seed.
- **Difficulty never touches the sim.** A fixed seed must produce the same game
  on every mode, and a validator asserts it.
- `dialogueScenes.js` stays pure — memory arrives as facts, never as an import.

---

### Task 1: The owner watches the season

**Files:** `owner.js` (new), `scripts/validate-ownerMandates.js` (new)

`chooseMandate(team, rng)` from timeline and prestige. `judgeMandate(mandate,
team, bracket)` returns met/missed and the happiness delta. Pure, file scope,
testable with no league.

### Task 2: Patience, and the sack

**Files:** `owner.js`, `gmCareer.js`

Consecutive misses run patience down. When it is gone the tenure ends —
`endYear` set, the field that has always existed and never been written.
Second failure, not the first.

### Task 3: The owner learns the score

**Files:** `owner.js`, `seasonRollover.js`

Wire the judgement into the season rollover so happiness moves on results, not
only on the tax bill. Re-measure the correlation from the spec; it should stop
being incidental.

### Task 4: The user sees it coming

**Files:** `ui/dashboard.js` or `ui/gmCareerView.js`

A mandate nobody can see is a punishment. The standing mandate, progress against
it, and how much patience is left.

### Task 5: Rivalries

**Files:** `rivalries.js` (new), `scripts/validate-rivalries.js` (new)

Heat per club pair, rising on meetings and playoff series, decaying without
them, symmetric by construction.

### Task 6: A rivalry game is worth more

**Files:** `league.js` or `morale.js`, `finances.js`

Fan happiness and morale swing harder; losing to a rival costs more patience.

### Task 7: Difficulty modes

**Files:** `difficulty.js` (new), `ui/settings.js`,
`scripts/validate-difficulty.js` (new)

One named setting scaling existing constants. The validator's real job is the
negative: **a fixed seed produces an identical game on every mode.**

### Task 8: Press memory

**Files:** `dialogueContext.js`, `scripts/validate-pressMemory.js` (new)

A bounded record of what the GM has said, surfaced as facts a `when` predicate
can read. Bounded because it is saved.

### Task 9: Measure the sack rate

**Files:** `scripts/probe-firings.js` (new)

Twenty seasons. Near zero means the owner is decoration; near every year means
the game is unplayable. **This is the number the feature lives by.**

### Task 10: Sweep

Full validator sweep, ui-smoke, both goldens, browser check.

---

## What was measured and what was left undone

Tasks 1-7 and 9 shipped. **76 validators green**, both goldens untouched
throughout — the rollover fixture carries no `gmCareer`, so the owner review
declines and consumes no rng.

### The owner did not know the score

Four seasons, correlating each club's owner happiness against the wins it had
just produced: **r = 0.325, 0.123, 0.390, 0.278**. And the five unhappiest
owners in 2029 included Toronto at 58 wins and **Detroit at 71**.

Every write to `ownerHappiness` lived in `finances.js` and came from the luxury
tax. The owner was a spending thermostat, so the clubs that spent to win had the
angriest owners, entirely by accident.

### Four rounds of tuning, one bug

The firing probe took five runs to land, and every failed round was the same
mistake wearing a different hat: **a mandate handed to a club with no route to
it.**

| | develop | budget | contend | wins |
|---|---|---|---|---|
| the ask | ratings must rise | stay under the tax | win a series | hit a number |
| why it could not be met | progression runs only in the offseason, so no rating could move between a mandate being set and judged | 7 clubs of 30 are under the line, median payroll $233M against a $187M line | unreachable for a club that missed the playoffs | the target read the club's self-image, never its strength |
| the fix | judge on minutes | only ask clubs already under | only ask clubs that got there | anchor 65% to last season |

Boston, prestige 88 and a 40-win team, was asked for 52 wins every season and
sacked for failing its own reputation.

**The instrument was there the whole time.** The probe collected per-mandate hit
rates in a `byType` object from the first version and never printed them. Two
rounds of tuning were spent reasoning about which mandate *looked* hard. Printed,
it named the problem in one line.

### Where it landed

| | first run | shipped |
|---|---|---|
| firings a season | 22.9% | **12.5%** |
| one sacking every | 4.4 years | **8.0 years** |
| mandates met | 39.4% | **54.2%** |
| contend miss rate | 100% | 40% |
| budget miss rate | 20% | 0% |

A job that is genuinely losable and usually kept. Stopped here deliberately: at
48 judged seasons with per-mandate samples of 5-21, further tuning would be
fitting noise.

### Rivalries converge, and the tests could not see it

Heat from routine meetings converges to `perSeason / (1 - decay)` — about 19.
The first threshold was 10, so after a few seasons **all 435 possible pairs in a
thirty-club league were rivals**, which is the same as none of them being one.
Measured in the browser: 435 pairs carrying heat, nobody with a rival.

The validator missed it because it tested a single season and never saw the
equilibrium. There is now a twenty-season check asserting the calendar never
reaches the bar. At a threshold of 35 the same run gives **14 pairs of 435** over
the bar, and Boston finishes with two rivals, both playoff opponents.

One fixture was wrong rather than one constant: the fade test decayed in
silence, which measures a situation the game cannot produce, because two clubs
in one league never stop playing each other.

### Difficulty admits what it does not touch

Four modes scaling what the league does *around* the player. The validator's
real job is the negative — the same seeded game under every mode must produce an
identical box score (97-105 on all four). It passes by construction today and
exists to stop passing the moment somebody wires difficulty into the sim.

### Left undone

- **Press conferences with memory** — task 8, not started. `dialogueScenes.js`
  is already a pure scene engine with `when` predicates over a flat fact object,
  so this is a memory to feed it rather than a system to build.
- **Difficulty's other two dials.** `aiTradeShrewdness` and `rivalFreeAgentPull`
  are defined and consumed by nothing. Wiring them means touching calibrated
  constants in `tradeEvaluator.js` and `freeAgency.js`.
- **Rivalries do not affect morale**, only fan happiness. The spec asked for
  both.
- **No firing consequence in the UI.** `firedAtEndOfSeason` is set and saved,
  and nothing reads it — being sacked currently ends nothing.
