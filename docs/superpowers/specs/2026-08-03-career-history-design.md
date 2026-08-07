# Career History System Design Specification

**Date:** 2026-08-03  
**Status:** Design Approved  
**Scope:** Complete career history tracking for accurate player comparison across seasons, teams, injuries, and contracts

---

## 1. Overview

**Career History System** enhances player records by tracking granular historical data (season-by-season stats, team history, injury timeline, contract evolution) instead of just aggregate career totals. This enables:

- **Accurate player comparison:** See how two players performed over time, against each other, in specific eras
- **Career narrative:** Follow a player's journey (drafted → teams played for → injuries → contract evolution → retirement)
- **Trade/injury impact analysis:** Understand how trades and injuries affected career trajectory
- **Real player baseline:** Import 2026 Basketball Reference data as starting point for real players; generated players accumulate from game start

**Key Innovation:** Hybrid initialization—real players begin with historical context, generated players start fresh. Both accumulate history as seasons simulate.

---

## 2. Architecture

### Data Model

Each player object gains a new `careerHistory` property alongside existing `careerStats`:

```javascript
player.careerHistory = {
  seasonByYear: {
    // Season-by-season breakdown: year => stats object
    2024: {
      season: 2024,
      team: "LAL",
      gamesPlayed: 72,
      points: 1800,
      rebounds: 600,
      assists: 400,
      steals: 120,
      blocks: 80,
      fieldGoals: 650,
      fieldGoalsAttempted: 1420,
      threePointers: 180,
      threePointersAttempted: 520,
      // ... all SEASON_STAT_KEYS
      minutesPlayed: 2400,
      personalFouls: 140,
      turnovers: 320
    },
    2025: { /* similar structure */ },
    2026: { /* current season */ }
  },

  teamHistory: [
    // Team tenure with aggregated stats
    {
      team: "LAL",
      teamId: "lal",
      startSeason: 2024,
      endSeason: 2025,
      seasons: 2,
      totalGames: 150,
      totalPoints: 3900,
      totalRebounds: 1280,
      totalAssists: 850,
      totalMinutes: 4950,
      // ... aggregates for all seasons on this team
    },
    {
      team: "MIA",
      teamId: "mia",
      startSeason: 2026,
      endSeason: null, // Currently active
      seasons: 1,
      totalGames: 45,
      totalPoints: 1100,
      // ...
    }
  ],

  contractHistory: [
    // Contract changes over career
    {
      season: 2024,
      salary: 25000000,
      yearsRemaining: 4,
      teamId: "lal",
      type: "rookie_scale"
    },
    {
      season: 2025,
      salary: 28000000,
      yearsRemaining: 3,
      teamId: "lal",
      type: "extension"
    },
    {
      season: 2026,
      salary: 32000000,
      yearsRemaining: 3,
      teamId: "mia",
      type: "free_agency"
    }
  ],

  injuryHistory: [
    // Chronological injury log
    {
      season: 2025,
      date: "2025-03-15",
      type: "ACL sprain",
      severity: "major",
      estimatedRecoveryDays: 45,
      actualRecoveryDays: 48,
      gamesOut: 16,
      returnDate: "2025-05-02",
      notes: "Returned for playoffs"
    },
    {
      season: 2026,
      date: "2026-01-22",
      type: "ankle sprain",
      severity: "minor",
      estimatedRecoveryDays: 14,
      actualRecoveryDays: 14,
      gamesOut: 3,
      returnDate: "2026-02-04"
    }
  ],

  careerHighs: {
    singleGame: {
      points: 52,
      rebounds: 18,
      assists: 15,
      steals: 8,
      blocks: 7,
      minutesPlayed: 48
    },
    singleSeason: {
      points: 2100,
      rebounds: 850,
      assists: 520,
      ppg: 27.0,
      rpg: 10.9,
      apg: 6.7
    }
  },

  trades: [
    // Trade record with dates and details
    {
      season: 2026,
      date: "2026-07-01",
      fromTeam: "LAL",
      toTeam: "MIA",
      details: "Traded for 2 first-round picks + role player"
    }
  ]
}
```

### Initialization Strategy

**Real Players (imported from Basketball Reference 2026 data):**
- Pre-populated `seasonByYear` for 2024-2025 seasons
- Pre-populated `teamHistory` based on real career (may span earlier years)
- Pre-populated `contractHistory` starting from recent contracts
- Pre-populated `injuryHistory` for known injuries
- Pre-populated `careerHighs` from real stats
- Starting point: Season 2026 simulation adds to existing history

**Generated Players:**
- Empty `seasonByYear` until first season simulates
- Empty `teamHistory` until first team assignment
- Empty `contractHistory` until first contract signed
- Empty `injuryHistory` until first injury occurs
- Empty `careerHighs` until first game (will populate as games are played)
- Starting point: Season 1, accumulate from there

### Data Collection Flow

**During Season Simulation:**
1. Games generate box scores with per-game stats
2. Stats accumulate in `player.seasonStats` (existing, per-player per-season aggregate)
3. Individual games checked for `careerHighs` updates
4. At season end:
   - `rollSeasonIntoCareerStats()` enhanced to call `recordSeasonInHistory(player, season)`
   - Records full season stats into `careerHistory.seasonByYear[season]`
   - Updates `careerHistory.teamHistory` for current team with season totals
   - Updates peak overall, best season totals (existing behavior preserved)

**When Trade Occurs:**
- Call `recordTradeInHistory(player, fromTeamId, toTeamId, season, details)`
- Finalizes current team entry in `teamHistory` (sets `endSeason`)
- Creates new team entry with `startSeason`
- Logs trade in `trades` array

**When Injury Occurs (Phase 2 integration):**
- Call `recordInjuryInHistory(player, injuryType, severity, estimatedRecoveryDays, season)`
- Creates entry in `injuryHistory` with initial estimate
- Updates recovery data when player returns to play
- Records games missed

**When Contract Changes:**
- Call `recordContractInHistory(player, season, salary, yearsRemaining, teamId, contractType)`
- Adds entry to `contractHistory`

**Career Highs Tracking:**
- After each game result: check if single-game stats beat `careerHighs.singleGame`
- After each season: check if season stats beat `careerHighs.singleSeason`
- Update accordingly

---

## 3. UI Presentation

### View 1: Enhanced Player Profile (Extended Existing)

**New tabs added to player profile:**

**Current Season Tab:**
- Season stats so far (games, minutes, points, etc.)
- Injury status if applicable
- Current team and contract info

**Career Stats Tab:**
- Aggregate career totals (existing `careerStats` display)
- Career averages (PPG, RPG, APG, etc.)
- Career highs (single game, single season)
- Peak overall rating, championships, awards

**Season Breakdown Tab:**
- Table: Year | Team | GP | Points | Rebounds | Assists | FG% | 3P% | FT% | Minutes
- Sortable by any column
- Visual highlight: best season (PPG, rebounds, etc.)
- Shows injuries for that season if any

**Team History Tab:**
- Table: Team | Years | Seasons | Games | Total Points | PPG Avg | Rebounds Avg | Assists Avg
- Timeline view: visual representation of career with team blocks (colored by team)
- Hover shows contract details for that team

**Injury Timeline Tab:**
- Chronological injury log
- Date | Type | Severity | Duration | Games Out | Return Date
- Color coding: minor/moderate/major
- Notes field for context

### View 2: Career Ledger / Statistics Page (New Dedicated Tab)

**Location:** Roster view → new "Career Ledger" tab

**Main Features:**

**Search & Filters:**
- Player name search
- Filter by team (dropdown)
- Filter by season (range slider)
- Filter by stat category (points, rebounds, assists, etc.)

**Timeline View:**
- Chronological log of all career events
- Event types: contract change, trade, injury, milestone, award
- Each row shows: Date | Event Type | Description | Season | Team
- Click to expand for details

**Statistics Table:**
- Season-by-season breakdown
- Columns: Year | Team | GP | PPG | RPG | APG | Minutes | Injury Status | Contract
- Sortable by any column
- Color coding for injury seasons or milestone seasons

**Export:**
- Download season stats as CSV
- Download career totals as CSV

### View 3: Player Comparison Tool (New UI)

**Location:** Roster view → new "Compare Players" button

**Comparison Interface:**

**Setup:**
- Select 2-4 players from dropdown
- Display selected players with headshots/ratings

**Comparison Tabs:**

**Career Overview:**
- Side-by-side career stats
- Career totals, PPG, RPG, APG, championships, MVP awards, all-stars
- Peak overall rating, seasons played

**Season-by-Season:**
- Table showing each player's stats for same season range
- Years as rows, players as columns
- Hover shows that season's team, injuries, contract

**Team History:**
- Compare team tenures
- Player A: LAL (2024-2025), MIA (2026-) vs. Player B: BOS (2024-), etc.
- Stats per team for each player

**Stat Progression:**
- Line charts showing career trajectory
- X-axis: seasons
- Y-axis: PPG, RPG, APG, minutes played (user selectable)
- Visual comparison of career arcs

**Injury Impact:**
- Injury timeline overlaid on stat progression
- Visual dots showing injury dates
- Shows stat dips corresponding to injuries

**Head-to-Head Stats:**
- When both played same season
- Who outperformed in which stat

---

## 4. Integration Points

### Existing System Extensions

**history.js:**
- Extend `ensureCareerData()` to initialize empty `careerHistory` for new players
- Extend `rollSeasonIntoCareerStats()` to call new `recordSeasonInHistory()` function
- Keep existing `careerStats` logic (aggregate totals) unchanged

**league.js:**
- Hook trade events to call `recordTradeInHistory()`
- Ensure trade date, from/to teams, and details logged

**trade.js:**
- After trade execution, trigger history recording

**freeAgency.js:**
- After player signs, record in `contractHistory`

**injuries.js** (Phase 2):
- When injury triggers, call `recordInjuryInHistory()`
- When player returns from injury, update recovery data

**simEngine.js / simEngineBoxScore.js:**
- After each game, check box score against `careerHighs`
- Update if new career high achieved

**save.js / load.js:**
- Include `careerHistory` in save data
- Load `careerHistory` when loading game state

### New Files

**careerHistory.js (Core Logic)**
- `recordSeasonInHistory(player, season)` — record completed season
- `recordTradeInHistory(player, fromTeamId, toTeamId, season, details)` — record trade
- `recordInjuryInHistory(player, injuryType, severity, estimatedDays, season)` — record injury start
- `recordInjuryReturn(player, season, actualRecoveryDays)` — record injury return
- `recordContractInHistory(player, season, salary, years, teamId, type)` — record contract change
- `checkAndUpdateCareerHighs(player, gameStats)` — check if game beat career highs
- `getSeasonBreakdown(player, season)` — query season stats
- `getTeamBreakdown(player, teamId)` — query team stats
- `getCareerProgressionTrend(player)` — get PPG/RPG/etc. over time
- `queryHistoryByFilters(player, filters)` — search/filter history events

**ui/playerProfile.js (Enhanced)**
- New tabs: Season Breakdown, Team History, Injury Timeline
- Render tables and timelines

**ui/careerLedger.js (New)**
- Career ledger page with filters, timeline, exports
- Implement search and filtering logic

**ui/playerComparison.js (New)**
- Comparison tool UI
- Select players, display comparison views
- Chart rendering for progression comparison

### Data Import

**Basketball Reference 2026 Integration** (separate task):
- Parse Basketball Reference data for real NBA players
- Populate `careerHistory` for 2024-2025 seasons
- Load injury history if available
- Load contract data if available
- Seed `careerHighs` from real stats

---

## 5. Accumulation During Simulation

**Season Flow:**
1. Regular season games simulate → individual game stats generated
2. Stats accumulate in `seasonStats` (existing)
3. Each game checked: if any stat beats `careerHighs.singleGame`, update
4. Season ends → `rollSeasonIntoCareerStats()` fires
5. New code: `recordSeasonInHistory()` populates `seasonByYear[season]`
6. New code: `careerHistory.teamHistory` updated with season totals for current team
7. Offseason: trades/injuries/contracts recorded

**Trade Flow:**
1. Trade negotiated and executed
2. New code: `recordTradeInHistory()` called
3. Finalizes old team entry in `teamHistory`
4. Creates new team entry
5. Player moved to new team

**Injury Flow (Phase 2):**
1. Random injury triggered during season
2. New code: `recordInjuryInHistory()` logs injury type, severity, date, estimated recovery
3. Player unavailable for games
4. Player returns to play
5. New code: `recordInjuryReturn()` updates actual recovery days, games out

---

## 6. Data Persistence

**Save Format:**
- `careerHistory` included in full save state
- Serialized as JSON alongside other player data
- No size constraints—history can grow large over multi-season careers

**Load Behavior:**
- Load game state → deserialize `careerHistory` for all players
- Ensures history persists across saves

---

## 7. Implementation Approach

### Phase Structure (Sequential)

**Career History - Phase 1: Foundation**
- Core data structures and initialization
- `recordSeasonInHistory()`, `recordTradeInHistory()`, `recordInjuryInHistory()`, `recordContractInHistory()`
- Career highs tracking
- Save/load integration

**Career History - Phase 2: UI Display**
- Enhanced player profile tabs (Season Breakdown, Team History, Injury Timeline)
- Career Ledger page with filters and export

**Career History - Phase 3: Comparison & Analytics**
- Player Comparison tool with charts and progression views
- Advanced filtering and querying

**Career History - Phase 4: Data Import (Optional)**
- Basketball Reference 2026 data parser
- Populate history for real players

---

## 8. Success Criteria

✅ Every player has complete historical record (season-by-season, team-by-team, injury-by-injury)  
✅ Real players begin with 2024-2025 history baseline; generated players start fresh  
✅ History accumulates accurately as seasons simulate  
✅ Trades, injuries, contracts logged with dates and details  
✅ Career highs tracked and updated  
✅ Three UI views functional: profile tabs, career ledger, comparison tool  
✅ History persists in save/load  
✅ Player comparison reveals career arc differences, team impacts, injury effects  
✅ No performance regression on existing systems  
✅ Export functionality works (CSV download)
