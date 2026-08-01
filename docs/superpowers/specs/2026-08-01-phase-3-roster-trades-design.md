# Phase 3: Roster Management & Trades — Design

**Status:** Approved, ready for implementation planning.
**Parent roadmap:** `2026-07-31-nba-gm-simulator-roadmap.md`

## Scope

Waiving players (to a placeholder free-agent pool, unsigned until Phase 4), multi-team (2-4) trade construction, salary-matching validation, AI trade evaluation computed per team's own net gain/loss, and multi-round counteroffer negotiation.

**Out of scope for this phase:** hidden traits/personality influencing trade value (Phase 5 doesn't exist yet), real draft picks as trade assets (`Team.draftPicks` stays an empty stub until Phase 4), free agent signing logic (Phase 4 — waived players just sit unsigned), autonomous AI-vs-AI trading (Phase 7's Auto GM reuses this phase's evaluation logic, but Phase 3 itself is user-initiated trades only).

## File Structure

```
rosterMoves.js         # waive/release logic, FREE_AGENTS pool
tradeEvaluator.js        # player trade-value scoring, team-leg evaluation, counteroffer generation
trade.js               # trade proposal construction/validation/execution (multi-team)
ui/tradeCenter.js         # Trade Center view: pick teams -> pick players -> propose -> negotiate
```

`teams.js` gains one new hand-authored field per team: `timeline` (`'rebuilding' | 'retooling' | 'win-now'`), set the same way `prestige` was in Phase 1 (no formula, judgment call per real team).

## Player Trade Value (`tradeEvaluator.js`)

```
baseValue = overall * 2 + (potential - overall) * youthFactor(age) - contractBurden(salary, overall)
```

- `youthFactor(age)`: weights unrealized potential (`potential - overall`) more heavily for younger players, tapering toward zero for players past their prime.
- `contractBurden(salary, overall)`: penalizes salary that's high relative to production — an expensive low-producer is worth less than a cheap one at the same overall.

This base value is then adjusted per evaluating team:

```
adjustedValue = baseValue * directionMultiplier(player, team.timeline) * needMultiplier(player.position, team)
```

- `directionMultiplier`: rebuilding teams value youth/potential/cheap contracts more; win-now teams value proven overall more; retooling is roughly neutral.
- `needMultiplier`: computed dynamically from the team's current positional depth (not stored — recalculated from the live roster each time), so a team thin at a position values a player there more.

## Trade Evaluation

Generalizes to 2-4 team trades without pairwise logic: for each non-user participating team, `outgoing` = that team's players going to any other participant, `incoming` = players coming from any participant(s). A team's leg passes if both hold:

1. **Value:** `sum(adjustedValue(incoming)) >= 0.9 * sum(adjustedValue(outgoing))`
2. **Salary matching:** simplified — outgoing salary must be within a generous band of incoming salary, unless the team has enough cap space to absorb the difference outright.

The whole trade executes only if every non-user team's leg passes. Roster size (12-15, the same range Phase 1's data validator enforces) is a hard constraint on every participant, checked both before and after the trade.

## Counteroffers & Negotiation (`tradeEvaluator.js` + `ui/tradeCenter.js`)

A rejected leg returns a reason (`'value'` and/or `'salary'`, with the shortfall amount) and one concrete suggested fix (add a specific player, or drop the most-overvalued outgoing player from that leg). The user edits the proposal in the Trade Center and resubmits — "negotiation" is repeated evaluation against an edited proposal, not separate negotiation-state machinery.

## Waiving Players (`rosterMoves.js`)

Sets `player.teamId = null`, adds the player to a `FREE_AGENTS` array, and removes their salary from the team's payroll entirely (simplified — no dead-cap modeling, consistent with Phase 1's simplified-contracts decision). Blocked if it would drop the team below 12 players. Free agents sit unsigned with no pickup logic until Phase 4 builds free agency.

## Trade Center UI (`ui/tradeCenter.js`)

1. Select 2-4 participating teams from a list.
2. For each team, pick which of its players go to which other participant.
3. A running panel per team shows outgoing/incoming value and salary as the proposal is built.
4. Propose → evaluation runs. Accepted trades execute immediately (roster/payroll updates). Rejected trades show each rejecting team's reason and suggestion; the proposal stays editable for another round.

## Testing Approach

Same approach as Phases 1-2: a Node validation script (`scripts/validate-trades.js`, plain `assert`, no framework) covering player value calculation, team-leg evaluation (accept/reject cases), salary-matching edge cases, multi-team net calculation, roster-size enforcement, and waive mechanics. Manual browser walkthrough for the Trade Center UI and negotiation flow.

## Open Questions / Ambiguity Resolved

- **Roster moves beyond trades:** resolved — waiving is in scope this phase; waived players land in an unsigned `FREE_AGENTS` pool (no signing logic until Phase 4).
- **Salary matching:** resolved — simplified band-based matching (not the NBA's full trade-exception/apron rules).
- **Trade partner count:** resolved — 2-4 teams supported, using a per-team net-value/net-salary evaluation that generalizes without pairwise special-casing.
- **Team direction:** resolved — explicit hand-authored `Team.timeline` field, not derived from record/roster each time.
- **Counteroffer depth:** resolved — multi-round negotiation via edit-and-resubmit, not a one-shot suggestion.
- **Trade Center construction flow:** resolved — teams-first, then players, with a running value/salary panel.
