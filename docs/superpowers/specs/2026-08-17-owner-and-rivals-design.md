# Owner Mandates, Rivalries, Difficulty and Press Memory — Design

**Goal:** Tier 3. Somebody is watching you, some games matter more than others,
and the game can be made to fight back.

Where Tier 2 gave the GM more levers, Tier 3 gives the league opinions about how
he pulls them.

---

## What was measured first

Four seasons of a real league, correlating each club's owner happiness against
the wins it just produced:

| after | ownerHappiness range | correlation with wins |
|---|---|---|
| 2026 | 37.5 – 72.0 | r = 0.325 |
| 2027 | 25.6 – 67.0 | r = 0.123 |
| 2028 | 20.0 – 69.0 | r = 0.390 |
| 2029 | 20.0 – 71.0 | r = 0.278 |

And the five unhappiest owners in 2029:

| club | happiness | last season |
|---|---|---|
| CHA | 20 | 25W |
| SAC | 20 | 26W |
| NOP | 20 | 20W |
| **TOR** | **22** | **58W** |
| **DET** | **24.9** | **71W** |

**Detroit won 71 games and its owner is the fifth unhappiest in the league.**

The cause is in the code, not the dice: every write to `ownerHappiness` lives in
`finances.js` and is driven by the luxury tax. The owner is a spending
thermostat who does not know the score. So the clubs that spend to win have the
angriest owners, and the correlation with winning is weak and unstable because
it is entirely incidental.

Two other facts shape the work:

- **`gmCareer.js` tenures already carry an `endYear`, and nothing ever sets
  it.** The structure for a tenure that ends exists and is unused. You cannot
  currently be fired.
- **`dialogueScenes.js` is already a pure scene engine** — `when` predicates
  over a flat fact object, choices whose effects are returned rather than
  applied, with `dialogueContext.js` bridging to the game. Press conferences do
  not need a new system. They need a memory.

## The four pieces

### 1. Owner mandates, and being fired

The owner states what he expects before the season: a win total, a playoff
round, staying under the tax, or developing youth — chosen from the club's own
timeline and prestige, so a rebuilding club is not told to win 55.

At season end the mandate is judged and `ownerHappiness` moves on the result,
which is what makes it a signal rather than a spending thermostat. Sustained
failure ends the tenure: `endYear` is set, and that is the firing the structure
has always been shaped for.

**Patience, not a cliff.** One bad year against a mandate is a warning; the
second is the sack. A single-season trigger would make the game a coin flip on
the dice, and a mandate you cannot see coming is a punishment rather than a
goal.

### 2. Rivalries

Nothing rivalry-shaped exists today. A rivalry is a pair of clubs and a heat
value that rises when they meet often, meet in the playoffs, or trade blows near
the top of the table, and decays when they stop mattering to each other.

What it buys: a rivalry game is worth more to fan happiness and morale in both
directions, and losing to a rival costs the owner's patience more than losing to
anyone else. The point is that not all sixty-eight losses are equal.

### 3. Difficulty modes

Nothing exists. A single named setting that scales the things already tuned by
constants — AI trade shrewdness, free agent preference for other clubs, the
owner's patience — rather than a new subsystem. It multiplies existing dials; it
does not invent new ones.

**It must never cheat the sim.** Difficulty adjusts what the league does around
you, never what happens once the ball is in the air. A difficulty that quietly
moves shot percentages makes every result unreadable.

### 4. Press conferences with memory

`dialogueScenes.js` provides scenes; what it has no concept of is having been
asked before. Memory means a small record of what the GM has said, which scenes
can then read in their `when` predicates — so a reporter can bring up the
promise you made in November, and a scene can decline to repeat itself.

The engine stays pure: memory arrives as more facts in the same flat object,
never as a new import.

## What this does not do

- **No owner personalities.** One patience model, varied by club prestige and
  timeline. A per-owner temperament is a second tuning surface for a mechanic
  that has yet to prove it needs one.
- **No rivalry-specific scheduling.** Rivalries emerge from the schedule that
  exists; they do not rewrite it.
- **Difficulty does not touch the sim.** See above.
- **No branching press storylines.** Memory changes which questions get asked,
  not the plot.

## Verification

- `scripts/validate-ownerMandates.js` — mandate selection fits the club, the
  judgement matches the season, patience runs out on the second failure and not
  the first, and a tenure that ends sets `endYear`.
- `scripts/validate-rivalries.js` — heat rises on meetings and playoff series,
  decays without them, and is symmetric between the pair.
- `scripts/validate-difficulty.js` — every mode moves the dials it claims to,
  and **no mode changes a simulated result from a fixed seed**.
- `scripts/validate-pressMemory.js` — a remembered answer reaches a `when`
  predicate, and the engine stays pure.
- `scripts/probe-firings.js` — how often a GM is sacked over twenty seasons.
  **Near zero means the owner is decoration; near every year means the game is
  unplayable.** This is the number the feature lives by.
