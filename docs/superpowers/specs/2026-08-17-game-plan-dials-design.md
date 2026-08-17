# Game Plan Dials — Design

**Goal:** make the two controls on the coaching screen do what the screen says
they do.

**Status before this work:** they did nothing. For every save on default
settings, Pace and Three-Point Rate were decorative.

---

## The defect

`ui/coaching.js` renders a Game Plan panel with two dropdowns — Pace
(Slow/Balanced/Fast) and Three-Point Rate (Low/Balanced/High) — under the
caption:

> Nudges how your team plays — a real but modest effect on pace and shot
> selection.

That sentence was false. `strategy` and `threePointRate` appeared **zero times**
in `simEnginePossession.js` and **zero times** in `gameSim.js`. Only
`simEngineBoxScore.js` read them, and `simEngine.js:24` defaults to the
possession engine — so the dials reached the simulation only for a player who
had deliberately switched engines in settings.

Measured proof: sweeping `threePointRate` across all five values over 80 games
produced byte-identical output at every setting — 26.7% three-point share,
10,125 attempts, 111.07 points per game. The same held for pace.

This was invisible until the shot chart made shot mix observable
(`docs/superpowers/plans/2026-08-17-shot-zones-and-recaps.md`), and it was found
by that plan's probe rather than by any validator, because a control that does
nothing passes every test that only asks whether the game still runs.

## Two dials, two different kinds of lever

They are not variations on one control and should not be implemented as one.

**Three-Point Rate is a style lever.** It changes *how* a team scores, not how
much. Real teams that shoot more threes do not thereby score more; they trade
efficiency per shot against volume of value per make, and the two roughly
cancel. If this dial moved scoring materially it would stop being a stylistic
choice and become a difficulty setting, which is not what the screen offers.

**Pace is a volume lever, and therefore a scoring lever.** `gameSim.js`'s
`POSSESSION_BASE_SECONDS` comment already establishes this from measurement:
across 16s down to 11s, points ran 105.8 to 153.0 while points-per-possession
never left 1.186-1.189. Possessions times a constant efficiency is points. There
is no way to make pace move possessions without moving points, and pretending
otherwise would mean secretly making shots harder for a team that chose to run —
punishing the player for using the control.

So the honest design is: the three-point dial must **not** move scoring, and the
pace dial **must**. Both are asserted.

## Where each one attaches

**Three-Point Rate → `pickShotZone`.** That function already takes a
`takeoverBias` multiplier triple and already scales weights rather than
replacing them. The dial becomes one more multiplier on the `three` weight, and
normalisation pays for the extra threes out of the other two zones in
proportion — the same shape the transition bias uses.

It rides on `gameCtx`, alongside `scoreDiff` and `takeovers`, because that
object is already documented as optional: a caller that omits it gets exactly
the behaviour it had before. It is read **per possession**, so a user who
changes the dial mid-game from the coaching screen sees the shot mix follow.

**Pace → `possessionSeconds`.** One call site, and the natural one.

Unlike the three-point dial, pace is **blended between both teams and resolved
once per game**. A possession is not something one team does — the two share a
clock, so a team that wants to run against one that wants to walk gets a
compromise. This matches what `simEngineBoxScore.js` already does
(`(homePace + awayPace) / 2`), which means the two engines agree about what
"Fast" means. Resolving it once rather than per possession also avoids the clock
jumping underneath a live watched game.

## The constraint that shapes the implementation

**A neutral dial must be an exact no-op.**

Every team defaults to `pace: 0, threePointRate: 0`, and under Node they have no
`strategy` object at all — `TEAMS.filter(t => t.strategy).length` is 0 of 30.
`ensureTeamCoach` creates the object flat at zero, and despite its comment
claiming a hired coach "nudges their team's strategy dials", nothing ever
changes them. Only the user's team moves a dial.

So a correct implementation leaves the entire league's simulation untouched, and
**the golden masters do not move**. This was assumed to require regeneration and
does not. That property is worth more than convenience: it means this change
cannot have silently re-scaled the league, and a validator asserts it directly
by comparing a zero dial against an absent one over 5,000 draws.

Consequences that follow, and are tested:

- `three *= 1 + k * dial` must be guarded by `if (dial)`, not left to multiply by
  exactly 1.0 — the guard is the documentation of the requirement.
- The pre-dial four-argument call shape of `pickShotZone` must keep behaving
  identically, since probes and validators use it.

## Sizing

Both magnitudes are matched to what `simEngineBoxScore.js`'s dials are already
worth, so a player switching engines does not find "Fast" means two different
things.

- **Three-point:** that engine adds `0.06` of *share* per unit of dial. The
  possession engine works in weights, so the equivalent multiplier is solved
  rather than guessed: a weight multiplier `m` moves share `s` to
  `m·s / (m·s + 1 − s)`; targeting 0.336 from a league baseline of 0.276 gives
  `m = 1.33`.
- **Pace:** that engine is worth ±4 possessions a team at full blended dial. A
  regulation game is 4 × 9.5 min = 2,280 seconds, which at 12.5s is 182
  possessions, 91 a side; 95 a side needs 11.98s and 87 needs 13.07s. So a shade
  over half a second either way.

## Out of scope

- **Coaches actually using their dials.** `coaches.js` comments that a hired
  coach leans the dials toward their specialty; it does not. Making AI teams set
  dials would change league-wide scoring and shot distribution and needs its own
  measurement pass. Left as it is, which is also what keeps this change confined
  to the user's own games.
- **Any recalibration of the league.** No base rate, shot percentage, or clock
  constant moves.

## Verification

- The golden masters must pass **unregenerated**. This is the primary check.
- A new `scripts/validate-gamePlanDials.js`, every check of which fails against
  the engine as it was.
- `scripts/probe-shotZones.js` section 2 must flip from its recorded failure
  verdict, and a new section 4 must report what pace costs in points.
- All validators green.
