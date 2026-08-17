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

_(filled in as the work lands)_
