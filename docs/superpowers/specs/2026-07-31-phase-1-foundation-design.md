# Phase 1: Foundation — Design

**Status:** Approved, ready for implementation planning.
**Parent roadmap:** `2026-07-31-nba-gm-simulator-roadmap.md`

## Scope

File structure, data schemas, all 30 real NBA teams with real 2025-26 rosters, dashboard + navigation shell. Browse-only — no game simulation (Phase 2), no trades/free agency/draft (later phases), no hidden traits/personality assigned yet (Phase 5 populates the stubs this phase creates).

**Out of scope for this phase:** anything requiring simulation, persistence (save/load is Phase 6), or hidden information systems. Standings show static 0-0 records. Nav links to not-yet-built sections render a placeholder rather than dead-ending.

## File Structure

```
/
├── index.html
├── style.css
├── script.js            # app init, view routing/navigation
├── data.js              # shared constants: attribute keys, position enum,
│                         #   trait taxonomy stub list, contract rules, cap constants
├── teams.js              # 30 teams' shell metadata
├── players-2026.js        # real 2025-26 roster dataset (~450 players)
├── ui/
│   ├── dashboard.js
│   ├── roster.js
│   ├── standings.js      # static display this phase — real simulation is Phase 2
│   └── nav.js
└── assets/
```

Files for later systems (`sim.js`, `save.js`, `traits.js`, `draft.js`, `trade.js`, `freeagency.js`, `league.js`, `automation.js`) are created in their respective phases, not stubbed out now.

## Data Model

```js
Team {
  id, name, abbreviation, conference, division,
  colors: { primary, secondary },
  prestige, fanHappiness, ownerHappiness,
  salaryCap, luxuryTaxLine, payroll,        // payroll derived from roster contracts
  chemistry,
  record: { wins, losses },                  // static 0-0 until Phase 2
  roster: [playerId, ...],
  draftPicks: []                             // empty stub, populated Phase 4
}

Player {
  id, name, age, heightIn, weightLb, position, jerseyNumber, yearsPro,
  overall, potential,
  contract: { salary, yearsRemaining, playerOption, teamOption },
  status: { morale, fatigue, injury: null },
  attributes: {
    insideScoring, midRange, threePoint, freeThrow, passing, ballHandling,
    postScoring, perimeterDefense, interiorDefense, steal, block,
    offReb, defReb, speed, acceleration, strength, vertical,
    basketballIQ, leadership, workEthic
  },                                          // each 25-99
  hiddenTraits: [],                           // empty stub, populated Phase 5
  hiddenPersonality: {}                       // empty stub, populated Phase 5
}
```

## Real Player Data

- Real 2025-26 rosters (30 teams, ~15 players each) hardcoded in `players-2026.js`.
- Attributes/ratings are estimated from basketball knowledge, not sourced from any live database or API (none is used, per project constraints).
- Contracts use simplified/approximate values derived from overall/age/position, **not** real dollar figures.
- No real logo image assets — teams are branded with real names/colors only, rendered via CSS.
- For personal/local use only; not distributed.

## UI

- **Team select screen** — grid/list of all 30 teams; player picks one to be "their" team.
- **Navigation bar** (per original spec): Dashboard, Roster, Standings, Schedule, Trade Center, Free Agency, Draft, Salary Cap, League News, Awards, History, Settings. Only Dashboard, Roster, and Standings render real content this phase; the rest show a "Coming in a later phase" placeholder.
- **Dashboard** — team identity, record (0-0 stub), roster summary, payroll vs. cap.
- **Roster view** — sortable table of the selected team's players: name, position, age, overall, key attributes, contract. No hidden info (doesn't exist yet).
- **Standings view** — all 30 teams by conference/division, static 0-0 records.

## Testing Approach

No automated test framework — this is a local vanilla-JS game with no build step. Verification is manual: launch `index.html` in a browser, walk team select → dashboard → roster → standings, and spot-check real data (a handful of teams/players) for correctness and rendering.

## Open Questions / Ambiguity Resolved

- **File split vs. single `data.js`:** resolved — split into `data.js` (schemas/constants), `teams.js` (team shells), `players-2026.js` (roster data), to keep files focused and make future season data (`players-YYYY.js`) an additive, non-invasive change.
- **Contract realism:** resolved — simplified/approximate, not real dollar figures.
- **Historical seasons:** resolved — deferred to future scope (see roadmap doc); Phase 1 only ships 2025-26.
