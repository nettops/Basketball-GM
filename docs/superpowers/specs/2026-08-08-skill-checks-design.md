# Skill Checks — One Opposed-Check Primitive, and Showing It

**Date:** 2026-08-08
**Status:** Approved for planning
**Ships before:** `2026-08-08-live-badges-design.md` (badges hook into this primitive)

## Problem

Every meaningful outcome in the possession engine is an opposed attribute
comparison, but each one is hand-rolled with its own shape, divisor and centring
convention:

```
turnoverChance   0.11 + (defender.steal − handler.ballHandling) / 400 + synergy*0.3
shotMake         base + (shootComposite − 50)/250 − (defComposite − 50)/350 + …
blockChance      BLOCK_BASE + (shotDefender.block − 50) / 420
```

Three divisors, two centring conventions, one raw difference and two centred terms.
Consequences:

1. **Badges have to be bolted on five separate times.** The live-badges work needs
   defense, steal, block and chemistry terms added to five different formulas, each
   with its own scale to calibrate.
2. **The math is invisible.** A shot resolves as a single float. Nothing records
   that Curry's 92 three-point rating met Gobert's 45 perimeter defense, or that a
   gold Sharpshooter contributed +3 of the margin, so nothing can show it.
3. **New contests are expensive.** Every new opposed outcome means inventing another
   divisor and another clamp by hand.

## Decisions

| Question | Decision |
|---|---|
| Scope | One shared primitive **and** surfacing it to the player. |
| Math | Shape now, numbers later. Outcomes byte-identical; per-site divisors retained. |
| Display | Full breakdown on impact moments; every other play line expandable. |
| Ordering | Ships before live-badges, which then hooks in as one modifier. |

## The primitive

`skillCheck.js`, zero dependencies, matching the codebase's dual `require`/global
pattern.

```js
skillCheck(spec, rng) -> result
```

`spec` carries everything the check is made of:

| Field | Meaning |
|---|---|
| `kind` | `'shot'` / `'turnover'` / `'block'` — what contest this is |
| `base` | Starting probability before anyone's rating applies |
| `attack` | `{ player, label, value, scale, energy }` — the side that benefits from success |
| `defend` | `{ player, label, value, scale, energy }` — the side resisting |
| `modifiers` | `[{ label, value }]` — synergy, badges, situational terms |
| `min`, `max` | Clamp bounds |

`attack` is whoever *wants the check to pass*, not whoever has the ball. On a
turnover check the defender is the attacking party. Naming it by outcome rather than
by possession is what lets one function cover both directions.

```
attackTerm  = (attack.value − 50) / attack.scale × attack.energy
defendTerm  = (defend.value − 50) / defend.scale × defend.energy
probability = clamp(base + attackTerm − defendTerm + Σ modifiers, min, max)
passed      = rng() < probability
```

`result` is the spec plus `{ attackTerm, defendTerm, probability, roll, passed }` —
every input preserved, so a consumer can reconstruct and display the whole
calculation without re-deriving anything.

### Why this preserves behaviour exactly

- **shotMake** — `attack.scale = 250`, `defend.scale = 350`, per-zone `base`,
  energy multipliers as they are today, `modifiers` = synergy + shot-quality trait.
- **turnover** — `(defender.steal − handler.ballHandling) / 400` is algebraically
  `(d − 50)/400 − (h − 50)/400`, so both scales are 400. Attacker is the defender.
- **block** — `attack.scale = 420`, defender term absent (`defend.value = 50` is
  identity). The `zone === 'three'` short-circuit to 0.008 stays *outside* the
  primitive; it is a special case, not a contest.

Divisors stay per-site deliberately. Normalising them onto one scale would change
outcomes, move both goldens and require a full recalibration sweep — that is a
balance change and does not belong bundled into a refactor. It becomes its own pass
with its own measured sweep.

## Surfacing it

**The primitive and its first consumer ship together.** A structured `modifiers[]`
that nothing reads would be precisely the dead-path bug this project has just spent
a session removing — 15 traits sat unread through seven calibration tasks. A
structure with no consumer is the same failure with a different name.

- **Impact moments** — posters, ankle breakers and blocks already fire comic panels,
  gated to 2–7 per game by `validate-impactMoments`. Those panels gain the check
  breakdown: both players, both rated attributes, each modifier as its own line,
  and the roll against the number. Reuses `ui/pixelImpact.js`; no new gating.
- **Everything else, on demand** — play-by-play lines become expandable to show the
  check that produced them. Zero noise during play, full auditability after.

Nothing new renders on an ordinary possession. At ~91 possessions a side, a
persistent readout would stop being read inside a quarter.

## Testing

**Behaviour preservation is the whole test.** The existing golden-master
characterization fixtures in `scripts/fixtures/` already pin full-game output. If
the refactor is correct they do not move by a single byte — no regeneration, no
"expected drift". A golden that changes means the refactor is wrong, not that the
golden is stale.

Additionally:

- **Per-call-site equivalence.** For each of the three sites, assert the primitive
  reproduces the original formula across a sweep of the input range, comparing
  against the original expression retained in the test as a reference
  implementation. This is what catches an algebra slip in the turnover rewrite,
  which is the one non-obvious transformation here.
- **Result completeness.** Assert every field a display consumer needs is present
  and non-null on a real check, so the structure cannot silently lose a field.
- **The display actually reads it.** Assert an impact-moment panel renders a
  modifier that was present in the check. A panel that renders while ignoring
  `modifiers[]` is the dead-path failure again.

Mutation-tested, with these required mutants:

| Mutant | Must die on |
|---|---|
| Swap `attackTerm` / `defendTerm` signs | turnover direction inverting |
| Drop `energy` from either term | tired players performing identically |
| Drop `Σ modifiers` | synergy and shot-quality traits going inert |
| Return `probability` without clamping | out-of-range probabilities |
| Panel renders without reading `modifiers[]` | the completeness assertion |

A surviving mutant means the assertion is worthless or the code is dead, and the
report must say which.

Verification from a fresh `git clone --local` of HEAD, plus a browser check that an
impact panel renders a real breakdown.

## Out of scope

- **Normalising the divisors** onto one scale — balance change, own sweep.
- **New contested moments** (post-ups, drives vs help, screen navigation, box-outs).
  The primitive makes these cheap; adding them is a later project.
- **Checks on the player's own decisions** (timeouts, rotation gambles, trade
  pitches). Different feature, different design.
- Everything already out of scope in the live-badges spec.
