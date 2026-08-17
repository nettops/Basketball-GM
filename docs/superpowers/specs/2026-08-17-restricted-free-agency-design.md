# Restricted Free Agency — Design

**Goal:** make a young player's second contract a decision somebody can lose.

First of the Tier 2 "missing GM layer" work identified in the competitive
research: the transactional depth this game is thin on, against presentation and
narrative, where it is strong.

---

## What exists, and what it is missing

The offseason already has an exclusive negotiating window. `decrementContracts`
(`seasonTransition.js:72`) ages every contract, collects everyone at zero years,
and hands them to `runResigningWindow` (`freeAgency.js:420`) before the market
opens. AI teams take or decline first refusal there; the user's own expiring
players are deferred, carrying `player.resignRights` until the user acts or
`releaseUnexercisedResignRights` lets them walk.

That is a good spine and this design builds on it rather than beside it.

What it cannot express is the only interesting thing about restricted free
agency: **a rival deciding what your player is worth, and you having to answer.**
Today every re-signing is a private negotiation between a team and its own
player. Nobody else ever gets a say, so:

- the user can never raid another club's young talent, however badly that club
  has managed its cap;
- the user's own good young players are never threatened, so keeping them is
  paperwork rather than a decision;
- there is no mechanism anywhere in the game that makes a rival's cap space
  *your* problem.

## The shape of the feature

A restricted free agent can be signed to an **offer sheet** by any other team.
His own team then chooses to **match** it — keeping him on exactly those terms,
which may be terms it hates — or to let him go and get nothing.

That single choice is what the whole feature is for. Everything else exists to
make it happen at a believable rate.

## Who is restricted

`yearsPro <= 4`, which is this game's analogue of coming off a rookie deal.
Players carry `yearsPro` already; nothing new is generated.

Measured against the opening league: **10 of 82 expiring players** are
restricted, about 12%. That is the right scale — a handful of genuine decisions
an offseason rather than a second full market to click through. Their ages run
23 to 30, which is correct rather than a bug: a player who reached the league
late is on the same second-contract clock as one who arrived at 19.

An unrestricted player's path through `runResigningWindow` does not change at
all.

## Where it sits in the offseason

Inside the existing window, as a branch rather than a new phase:

```
decrementContracts
  └── runResigningWindow(expiring)
        ├── unrestricted  → first refusal, exactly as today
        └── restricted    → rival teams may write an offer sheet
                              ├── none written  → first refusal, as today
                              └── one written   → incumbent matches or declines
```

Putting it inside the existing window matters: contracts have already been
decremented, rosters and payrolls are real, and `generateAIOffer` /
`scoreOffer` / `estimateFairSalary` already know how to price a player against a
team's cap. An offer sheet is a *reused* AI offer with a matching decision
bolted on, not a new pricing model.

## Who writes an offer sheet, and for how much

Reusing `generateAIOffer` unmodified would produce fair-value offers that the
incumbent almost always matches, and the feature would be a no-op with extra
clicks. A real offer sheet is deliberately uncomfortable — it is priced to make
matching hurt.

So an offer sheet is an AI offer with an **overpay premium** applied, and it is
only written when the rival both has the room and wants him enough to overpay.
The premium is what gives the incumbent a genuine choice: match a good player at
a bad price, or lose him for nothing.

The incumbent's decision compares the player's value *to that team* against the
sheet's cost, using `adjustedPlayerValue`, which already accounts for fit and
roster context. A team over the tax with a full roster should let a good player
walk; a rebuilding team with space should match almost anything.

## What the user does

Two directions, and both are new gameplay:

**Defending.** The user's restricted free agents appear with any offer sheet
against them and a Match / Decline choice. Matching signs the player on the
sheet's terms — the rival's terms, not the user's — and must respect the same
cap rules `checkOffer` already enforces for everyone else.

**Raiding.** The user can write an offer sheet on another team's restricted free
agent. The rival then matches or does not, by the same rule the AI applies to
itself. This is the first mechanism in the game that lets a GM go after a young
player who is not on the market.

## Constraints

- **The unrestricted path must not move.** It is the path 88% of expiring
  players take, and `scripts/validate-resigning.js` already pins its behaviour.
- **No new pricing model.** `estimateFairSalary`, `scoreOffer`, `generateAIOffer`
  and `checkOffer` are the existing vocabulary and the feature is expressed in
  them.
- **Matching follows the existing own-player rule, not `checkOffer`.** The first
  draft of this document said a match must pass `checkOffer`; reading
  `freeAgency.js:313` corrected it. A team may already exceed the cap to
  re-sign its own expiring player and nobody else — that is deliberate, and
  without it the good teams, which are the ones over the cap, would lose every
  player they developed. A restricted free agent is exactly that case, so
  matching inherits the same rule. What still binds is the roster ceiling, and
  that is free here: the player is already on the roster and being kept does not
  add a body.
- **Automated saves must resolve.** `autoExerciseResignRights` exists so a
  spectator-mode or auto-free-agency league does not quietly lose its stars;
  restricted players need the same treatment or automation leaks talent.
- **The rollover golden will move.** Offer sheets change which teams sign whom,
  which changes seasons 2 and 3 of `rollover-golden.json`. Expected, and to be
  justified in the commit that regenerates it — same discipline as the coach
  playbooks change.

## Out of scope

Deliberately, so this ships as one coherent thing:

- **Poison-pill structures** (the third-year balloon payment). Our contracts are
  a flat salary and a length; there is no per-year schedule to make lumpy, and
  adding one is a contract-model change, not a free-agency change.
- **Sign-and-trade.** Needs the trade machinery and free agency to cooperate;
  its own feature.
- **Waivers, buyouts, 10-days, two-way contracts** — the rest of Tier 2, each
  their own spec.

## Verification

- A new `scripts/validate-restrictedFA.js`, covering eligibility, sheet
  generation, the matching decision, cap legality of a match, and the automated
  path.
- `scripts/validate-resigning.js` must stay green **unchanged** — that is the
  proof the unrestricted path did not move.
- A probe reporting, over several offseasons: how many players are restricted,
  how many draw a sheet, and how often the incumbent matches. A match rate near
  100% or near 0% means the premium is mistuned and the decision is fake.
- ui-smoke coverage for the two new user-facing surfaces.
