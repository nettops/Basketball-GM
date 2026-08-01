# Phase 4: Season Transition, Free Agency & Draft — Design

**Status:** Approved, ready for implementation planning.
**Parent roadmap:** `2026-07-31-nba-gm-simulator-roadmap.md`

## Scope

End-of-season progression (aging, breakout/bust rolls, minimal retirement), draft (real 2026 first+second round, lottery, procedural generator for future years), draft pick ownership + trading (extending Phase 3's `trade.js`), and free agency (silent AI-vs-AI resolution for most players, interactive bidding wars for players the user pursues) — ending with a new season generated and ready to simulate.

**Why this phase grew beyond its roadmap one-liner:** the game currently supports only one season end-to-end — nothing decrements contracts, ages players, or starts a new season after the playoffs finish. Free agency and the draft are both offseason systems, so this phase must also build that season-transition lifecycle; it has no independent value built alone, so it isn't split into its own phase.

**Out of scope for this phase:** hidden traits/personality influencing free agent decisions or progression (Phase 5), full retirement/Hall-of-Fame history tracking (Phase 8 — this phase only needs players to leave the league, not be memorialized), automation/Auto-GM handling free agency or the draft on the user's behalf (Phase 7), coach quality as a free-agent decision factor (no coach entities exist in the sim).

## File Structure

```
seasonTransition.js      # offseason orchestrator: progression -> retirement -> contract decrement -> draft -> free agency -> new season
progression.js          # player rating changes between seasons (age curve + breakout/bust rolls)
draftProspects.js         # real 2026 prospect data (60, both rounds) + procedural generator for later years
draft.js                # lottery odds, draft order, pick-by-pick selection (user + AI)
freeAgency.js            # FA pool, AI-vs-AI silent resolution, player decision-weight scoring
freeAgencyBidding.js       # interactive bidding-war loop for user-pursued free agents
draftPickValue.js         # pick value chart, used by both draft.js and tradeEvaluator.js
ui/draft.js              # lottery reveal, draft board, pick-by-pick UI
ui/freeAgency.js          # free agent list, offer UI, bidding-war UI
```

`tradeEvaluator.js`/`trade.js` (Phase 3) are extended, not rewritten: proposals can include pick assignments alongside player assignments, valued via `draftPickValue.js`.

## Season Transition (`seasonTransition.js`, `progression.js`)

Runs once when the user advances past a completed playoff bracket. Order:

1. **Progression** — every player's rating changes: young players (≤25) trend toward `potential` with a random breakout chance; veterans (≥30) decline; a small random bust/breakout roll applies league-wide, formula-driven with randomness (not deterministic).
2. **Retirement** — a low-probability roll removes very old/declined players from active rosters entirely. Full Hall-of-Fame/history tracking is Phase 8; this phase only needs players to *leave*.
3. **Contract decrement** — every contract's `yearsRemaining` drops by 1; hitting 0 makes that player a free agent.
4. **Draft** runs.
5. **Free agency** runs.
6. **New season** — an 82-game season is generated reusing Phase 2's `schedule.js`/`initSeason` unchanged.

## Draft (`draftProspects.js`, `draft.js`, `draftPickValue.js`)

- `draftProspects.js` ships all 60 real 2026 prospects (both rounds, hand-authored with the same schema/realism approach as Phase 1's rosters) for the first draft, and a procedural generator (same archetype-based attribute approach as Phase 1's `mkPlayer`) for every subsequent draft.
- **Lottery:** the 14 non-playoff teams get NBA-style weighted odds for picks 1-4; picks 5-14 follow inverse regular-season record among the remaining lottery teams; picks 15-30 go to playoff teams in reverse order of playoff finish; the second round is straight inverse-standings, no lottery.
- `draftPickValue.js` provides a pick-value curve (pick 1 worth far more than pick 30) combined with the owning team's current timeline/record to estimate a *future* pick's value for trading.
- AI teams draft using the same `tradeEvaluator.js`-style value/need logic already built in Phase 3, applied to prospects instead of rostered players.

## Free Agency (`freeAgency.js`, `freeAgencyBidding.js`)

When free agency opens, every team's newly-expired-contract players (plus any still-unsigned free agents) form the pool.

- **Silent resolution** (players the user doesn't pursue): each interested AI team computes an offer; the player picks the best one using the master spec's factors — money, contention, playing time, market size, prestige (coach quality is dropped; no coach entities exist).
- **Interactive bidding** (a player the user pursues): the user submits years/salary; interested AI team(s) either raise their own offer or drop out, repeating until the user's offer wins, the user withdraws, or an AI offer becomes clearly superior and the player signs elsewhere.

## Pick Trading (extends `trade.js`)

A trade proposal's `assignments` can include pick moves alongside player moves. Each team leg's value calculation sums `adjustedPlayerValue` for players and `draftPickValue` for picks, using the same 0.9-threshold acceptance rule Phase 3 established — no new acceptance logic, just a richer set of tradeable assets feeding the existing formula.

## UI (`ui/draft.js`, `ui/freeAgency.js`)

- **Draft view:** lottery reveal, then a pick-by-pick board that auto-advances through AI picks and pauses for the user's picks.
- **Free Agency view:** sortable free-agent list; "Make Offer" opens the bidding-war UI for that player; a running log shows recently-completed AI-vs-AI signings so the market feels alive even when the user isn't involved.

## Testing Approach

Same approach as Phases 1-3: a Node validation script (`scripts/validate-offseason.js`, plain `assert`, no framework) covering progression math (age-curve direction, breakout/bust bounds), retirement thresholds, contract decrement, lottery odds distribution (statistical, many trials), draft order construction, AI draft-pick selection, free agency silent resolution, and the bidding-war state machine. Manual browser walkthrough for the full season-end → offseason → new-season flow.

## Implementation Sequencing

Given the size, the implementation plan is split into two batches:

- **Batch A:** season transition (progression, retirement, contract decrement) + draft (real prospects, generator, lottery, pick value, AI draft logic, UI) — ends with a fully drafted league and no free agency yet.
- **Batch B:** free agency (silent resolution + bidding-war UI) + pick-trading extension to `trade.js` + final full end-to-end wiring/verification (complete offseason: transition → draft → free agency → new season).

## Open Questions / Ambiguity Resolved

- **Phase sizing:** resolved — kept as one phase (the season-transition lifecycle has no independent value without the draft/FA it exists to support), with the implementation plan split into two batches instead.
- **Progression model:** resolved — formula-driven with randomness (age curve + breakout/bust rolls), not simple deterministic aging.
- **Free agency mechanic:** resolved — sequential bidding war for user-pursued players; silent automatic resolution for the rest of the league's free agents (avoids building interactive negotiation UI for 400+ players).
- **2026 draft class realism:** resolved — fully real 60-prospect class (both rounds hand-authored), not a real-first-round/generated-second-round split.
- **Draft pick trading:** resolved — in scope this phase, extending Phase 3's `trade.js` rather than deferring further.
