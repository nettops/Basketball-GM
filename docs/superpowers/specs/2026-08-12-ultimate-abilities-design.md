# Ultimate Abilities — Design

**Date:** 2026-08-12
**Goal:** Give the league's stars a charged takeover — a meter that fills as they
play well, and a stretch of dominance when it fills. League-wide, in every game,
visible in the box score of a game you never watched.

## Why

The game has 48 badges across six tiers, and they are all *always on*: a
Sharpshooter shoots better on every possession of every game. Nothing in the
simulation has a **moment**. A star's great night and a star's ordinary night
differ only in how the dice fell.

An ultimate is the missing shape: a thing that builds during a game, arrives
because of what the player did, changes the game for a stretch, and ends. It
gives a watched game something to anticipate and a simmed game something to
report.

Out of scope, decided and recorded so it is not re-litigated:

- **The user does not trigger it.** Takeovers fire automatically for all thirty
  teams. There is no button, no hold, no fourth-quarter save-it-for-later. This
  was considered and rejected: automatic is the only version that behaves
  identically in a watched game and a simmed one.
- **Feats integration is deferred.** Recording the most extreme takeovers
  permanently in `LEAGUE_HISTORY.feats` is easy and desirable, but it is not in
  this build. Calibration should not chase a moving target.

---

## Constraints established before design

Verified against the code, not assumed.

1. **Ultimates exist only in the possession engine.** `simEngine.js:24` defaults
   to `'possession'`, and `league.js:271` forces `'possession'` for any watched
   game. But `ui/settings.js:116` lets the user select the box-score engine for
   season sims. A league run on the box-score engine has no takeovers, the same
   way it already has no play-by-play. This is a stated limitation, not a bug to
   fix here.

2. **The per-game box line is the natural home for meter state.**
   `initBoxLine()` (`simEnginePossession.js:199`) already carries per-game,
   per-player mutable state — `energy`, `fouls`, `plusMinus` — created fresh
   each game and threaded through every possession. Charge belongs beside them.

3. **`skillCheck` already accepts a modifier list.** `skillCheck.js` takes
   `spec.modifiers`, sums their values into the probability, and returns them on
   the result. The expandable play-by-play (SC-4) and the live impact breakdown
   (SC-5) already render that list. A takeover modifier therefore explains
   itself through machinery that exists.

4. **A player's shot share is hard-capped at 50%.** `PICK_CEILING.shooter = 0.50`
   (`simEnginePossession.js:161`) is applied inside `weightedPick`. A usage boost
   that does not lift this ceiling silently saturates, and the calibration target
   below is unreachable. The ceiling must be raised **for the taking-over player
   only, for the duration only**.

5. **Box scores do not survive a save.** `save.js` prunes `boxScore` and
   `playByPlay` to the user's own games (established in the feats design,
   2026-08-11). Anything about a takeover that must persist has to be stored in
   its own right, not mined from a box score later.

6. **`decideSubstitutions` (`gameCoach.js:120`) will bench a tired star.** With
   no change, a coach pulls a player mid-takeover for rest or minutes pacing.

7. **Golden masters will move, legitimately.** This is a simulation change:
   `scripts/validate-gamesim.js` and `scripts/validate-seasonRollover.js` both
   change and must be regenerated, with league behaviour re-verified rather than
   just re-recorded.

---

## The twelve ultimates

Every star has exactly one, **derived** from their strongest composite rating
relative to the league, with badges breaking ties. Nothing is authored per
player and nothing is rolled at birth: a player who develops in a new direction
grows into a different ultimate, and every generated draft pick gets a sensible
one for free.

| Ultimate | Derived from | Dials it turns |
|---|---|---|
| **Heat Check** | `shootingThree` | Shot share up, zone bias to three, three-point make up |
| **Silky** | `shootingMid` | Shot share up, zone bias to mid, mid-range make up |
| **Paint Beast** | `shootingInside` | Shot share up, zone bias to inside, inside make up, shooting-foul rate up |
| **Downhill** | `ballHandling` + speed | Shot share up, zone bias to inside, turnover chance down |
| **Above the Rim** | `vertical` + `acceleration` | Shot share up, zone bias to inside, inside make up, offensive rebound share up, block chance up |
| **And-One** | `strength` + `freeThrow` | Shot share up, zone bias to inside, shooting-foul rate sharply up, free-throw make up |
| **Glass Wrecker** | `rebounding` | Rebound share up on both ends, put-back shot share up |
| **Cold Blooded** | `basketballIQ`, or a clutch badge | Shot share up from every zone, make up from every zone |
| **Clamps** | `defensePerimeter` | As on-ball defender, turnover chance sharply up |
| **Motor Never Stops** | `workEthic` + conditioning | His energy stops draining; his matchup's drains faster. No make bonus at all |
| **Floor General** *(team)* | `passing` | All five on the floor: make up, turnover chance down |
| **The Wall** *(team)* | `defenseInterior` | Opponent's five: make down, block chance up |

Two are team ultimates, one on each end of the floor, so an elite passer and an
elite rim protector each have a way to take over a game that is not scoring.
Their per-player effect is deliberately smaller than any solo ultimate, because
it is multiplied by five.

Three are deliberately built on a different mechanic so twelve ultimates do not
collapse into twelve accuracy boosts:

- **Cold Blooded** charges only late in a close game (below). It is the rarest
  thing in the game and always arrives at the worst possible moment for the
  opponent.
- **Motor Never Stops** touches no shooting probability. It moves `energy`,
  runs two to three times longer than any other takeover, and shows up as a
  fourth-quarter collapse rather than a highlight.
- **The Wall** and **Clamps** act on the *opponent's* possessions, so their
  window is counted in opponent possessions rather than the holder's team's.

### Who qualifies

Roughly the top 30-60 players in the league — one or two per team, and some
teams with none. The gate is a rating band, set the same way
`RATING_BANDS.superstar` gates the superstar badge category, and calibrated so
the count lands in that range rather than picked as a raw number.

### Badge interaction

A **legendary** or **secret** badge whose effect matches the ultimate's dial
increases the takeover's magnitude. The badge system and the ultimate system
therefore point the same direction rather than competing for the same design
space.

---

## The meter

One per star, per game, starting at zero. **Not persisted between games** — each
night is its own story.

**Fills on:** that player's own made shot, assist, steal, block, rebound, and
trip to the line. Weighted by event value — a made three earns more than a made
layup, a block more than a defensive board — and weighted again by *his* ultimate,
so Heat Check charges off threes and Glass Wrecker charges off boards.

**Drains on:** missed shots, turnovers, fouls. A star shooting badly moves
backwards, and a 4-for-15 night never reaches a takeover regardless of minutes
played. This is what makes the takeover earned rather than scheduled.

**Frozen on the bench.** Neither fills nor drains while off the floor. Losing
charge to a substitution would punish the player for a decision he did not make.

**Multiplied by the situation.** The same play earns more charge when the game
is close, when the period is the fourth or overtime, and when his team trails.
A bucket in a blowout barely registers. This is what pushes takeovers into the
part of the game that matters, and it is the same rule that produces **Cold
Blooded** — with the first three quarters multiplied to zero.

**No rng draws.** The meter is bookkeeping over events that already happened. A
takeover is never a die roll that decides a game; it is the consequence of a
night already going well. This also means the meter cannot desynchronise the
rng stream, and the same seed replays identically.

**Duration:** approximately twenty possessions of the applicable side — one
team's quarter. Ends early if the holder leaves the floor (fouled out, injured,
substituted). Motor Never Stops runs two to three times longer.

**A second takeover is much harder.** After one ends the meter refills from zero
against a raised threshold. One takeover is a good night; two is a night people
remember; three should effectively not happen.

**Simultaneous takeovers stack and fight.** The Wall against Heat Check is one
modifier against another in the same skill check. No special-case rule.

---

## Calibration targets

Bands to calibrate *to*, measured through `league.simulateDate` over full
seasons — never `gameSim.simulateGame` in a loop, which reads roughly 35% low
because it skips fatigue, injuries, morale and rotations.

| Target | Band |
|---|---|
| Takeovers per game, both teams | ~1.0 |
| Share of star-games producing one | ~50% |
| Two takeovers by one player in one game | ~1 game in 15 |
| Points added to the holder over the stretch | **10-15** |
| League points per team per game | **unchanged** |

**The last row is the governing constraint.** Takeovers *redistribute* scoring
toward stars; they do not add scoring to the league. Every balance property
already measured and recorded — a superstar worth ~10 wins alone but ~6 beside
another star, champions ranking 2nd-3rd on average, league-best records at 68-76
wins, 2-4 superstars per draft class — is measured against league scoring. Holding
scoring flat is what protects all of it. If total scoring rises, the tuning is
wrong; ordinary offense comes down until it does not.

**Arithmetic behind the 10-15 band.** A team takes ~90 possessions a game at
roughly a point each. Over twenty possessions the team scores ~23 and the holder
~5-6 of them. Adding 10-15 means he scores ~17 in that window on a bit over half
his team's shots, and the team scores ~30 in that quarter instead of ~23. An
eight-possession window was considered and rejected: the same 12 points would
require the team to more than double its scoring rate for the stretch, which
cannot be pulled back without gutting ordinary offense everywhere else.

Each target lands in the test suite as a rate-band assertion, so a later change
cannot quietly break it.

---

## Architecture

**One new leaf module, `ultimates.js`**, answering three questions with no
knowledge of the rest of the game:

- `ultimateFor(player)` — which ultimate, derived from composites and badges.
- `chargeGain(ultimate, event, situation)` — what a play earns.
- `takeoverEffect(ultimate, badgeBoost)` — what the takeover changes, as a set of
  named dial adjustments. `badgeBoost` is the multiplier earned by a matching
  legendary or secret badge, `1` for a holder with no matching badge.

It takes plain values, not league objects, so all twelve ultimates are testable
without booting a league. This is the shape `skillCheck.js` and `pixelMotion.js`
already use.

**State lives on the per-game box line:** `charge`, `takeoverLeft`,
`takeoversUsed`. Created by `initBoxLine`, discarded with the game.

**The engine asks, the module answers.** `simEnginePossession.js` consults it at
the points it already has: picking the shooter, picking the zone, building the
shot / turnover / block specs, the shooting-foul rate, the rebound split, and
`drainEnergy`. The takeover contributes a **named modifier** to each affected
skill check, so it renders in the existing breakdown as one more line.

**`gameSim.js` owns the transitions** — it holds the score, period and clock, so
it computes the situation multiplier, crosses the threshold, fires the takeover,
counts the window down, and pushes `takeover-start` / `takeover-end` events.

**`gameCoach.js` gains one rule:** `decideSubstitutions` does not bench a player
mid-takeover.

**Persistence:** a compact per-game takeover record (player, ultimate, period,
points added) stored in its own right so it survives a save, given constraint 5.

---

## On screen

**Watching.** A thin meter under each on-floor star's name in the HUD — stars
only, so the panel does not become twelve bars. It glows as it approaches full,
giving a few possessions of anticipation, which is most of the fun.

Firing reuses the existing impact treatment (`ui/pixelImpact.js`): freeze, snap
zoom, flash, speed lines, with the ultimate's name across it. During the stretch
the holder's sprite carries a persistent marker so you can see who is hot without
reading; the team ultimates mark all five. Ending is quiet — marker drops, meter
empties, no fanfare. Endings should not carry a beginning's weight.

`prefers-reduced-motion` is already honored by the impact module; under it the
flash and freeze degrade to a plain banner.

**Not watching — the more important case.** The box score carries a line under
the player: what he did during the takeover and when. The play-by-play carries a
marked-off section, so scrolling a skipped game shows where the run was.

**The feed is filtered, not a firehose.** ~1,230 takeovers a season means a line
for each is wallpaper. The user's own team always; league-wide only the extreme
few, with the bar set by measurement so it stays a few a week. Same principle
already used for feats.

**Player profile** gains a section: the ultimate, what it does, times triggered
this season, and his best one — which answers the real scouting question, *does
this guy take over games?*

**A reference page** built the way `ui/badges.js` is: everything read from the
same definitions the engine consumes, so a retuned ultimate updates its own
documentation and can never describe an effect it does not have.

---

## Verification

- **Unit:** all twelve derivations, charge gains, drains, the bench freeze, the
  situation multiplier, the raised threshold on a second takeover — against the
  tuning table, never against literals.
- **Rng-neutrality:** a proven-identical draw count with takeovers disabled, and
  a static guard that the module consumes no rng.
- **Call-site guard:** every dial the design claims is turned must be reachable —
  the recurring failure in this codebase is a value computed and then discarded,
  or a rule written inside one caller. Each of the twelve must be asserted as
  actually read by the engine.
- **Rate bands:** the calibration table above, measured through
  `league.simulateDate` over full seasons.
- **Balance regression:** league scoring, win distribution, champion quality and
  star-pairing returns re-measured against their recorded bands after tuning.
- **Goldens:** regenerated deliberately, with the league re-verified rather than
  the numbers merely re-recorded.
- **Browser:** verified live in a real game — the meter fills, the takeover
  fires, the marker rides the player, the banner clears. Not asserted from Node.
