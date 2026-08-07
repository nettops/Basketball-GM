# Player Career Mode Design Specification

**Date:** 2026-08-02  
**Status:** Design Approved  
**Scope:** Single-player NBA career simulation mode integrated with existing GM simulator

---

## 1. Overview

**Player Career Mode** is a "player-centric POV layer" built on top of the existing NBA GM Simulator's league simulation. Instead of managing a team as GM, you control a single athlete's career decisions, stat progression, and legacy over 10-20 seasons. The full league simulation (30 teams, auto-GM logic, trades, drafts) still runs—you're playing *inside* that world.

**Core Gameplay:** You control one athlete's career arc (college → draft → seasons → retirement) and make five types of decisions: contracts, career path (trades), training/focus, playoff performance, and endorsements/earnings. Your decisions feed into the league simulation, and other teams' AI GMs react to your value and performance.

**Key Innovation:** Seamless hybrid mode—play as a player, then transition to GM mode after retirement with the league state preserved (your retired player becomes historical data).

---

## 2. Architecture

### System Components

**Player Controller** (NEW)
- Manages your player's stats, morale, career phase, contract status
- Tracks career events (draft, all-stars, trades, controversies, retirement)
- Decision history for narrative continuity

**Decision Engine** (NEW)
- Captures 5 decision types: contracts, career path, training, playoff performance, endorsements
- Routes decisions into existing league simulation (trades, FA, auto-GM logic)
- Feeds decisions into narrative system for dialogue/story context

**Narrative System** (NEW)
- Dialogue library with multiple NPC archetypes (agents, coaches, GMs, teammates, media)
- Context-based dialogue: changes based on your stats, career phase, prior choices, relationships
- Milestone scenes: draft night, all-star selection, playoff runs, retirement ceremony
- Random events: controversies, injuries, team drama with decision trees for handling

**AI GM Enhanced Logic** (EXTEND EXISTING)
- Layer "player-awareness" module on top of existing auto-GM
- Teams recognize your value, pursue trades/max contracts, react to your decisions
- Existing auto-GM still runs for other 28 teams

**Career Arc Manager** (NEW)
- Tracks season progression, career phase (college → active → retired)
- Triggers milestone scenes, retirement conditions
- Manages player-to-GM transition on retirement

### Data Flow

```
Your Decision
    ↓
Decision Engine
    ↓
Narrative System (dialogue/choice context)
    ↓
League Simulation (trade logic, auto-GM, FA logic, progression)
    ↓
Other Teams' AI GMs React (trades, offers, interest)
    ↓
Season Outcome + Game Results
    ↓
Narrative Moments Surface (headlines, dialogue follow-ups)
```

---

## 3. Player Career Lifecycle

### College Phase (Customization)
- **Custom Player Creation:**
  - Name, position, college, physical attributes (height, weight)
  - Archetype selection (scorer, defender, playmaker, etc.) determines starting rating distribution
  - Badge selection: Pick 3-5 badges from badge pool (e.g., 3-point threat, defender, playmaker)
  - Trait selection: Pick 2-3 traits defining personality (clutch, leader, volume scorer, streaky)
  - Starting rating set within ranges (elite prospect vs. developmental player)
  - Alternative: Control existing generated/real player instead
  
- **Narrative:** Draft scouts evaluate you, agent offers guidance
  - Dialogue/choice: "Focus on shooting before draft?" (badge boost offered)
  - Dialogue/choice: "Accept predraft deal?" (team offers early contract)

### Draft & Signing (Milestone Scene)
- Draft night plays out as interactive scene with dialogue
- You're selected by a team (or can negotiate which team)
- Agent negotiates rookie contract: "Accept offer" vs. "Negotiate terms"
- Narrative weight: Media reactions, team expectations set

### Regular Seasons (Years 1-15+)
- **Each Season Loop:**
  - Play/sim games through season
  - Offseason: Training choices, contract negotiation, trade responses
  - Narrative beats trigger based on events (all-star selection, trade rumors, controversies)
  
- **Decision Points Throughout Season:**
  - **Contracts:** Negotiate salary, years, team preference (offseason and mid-season)
  - **Career Path:** Respond to trade rumors, request trades, veto moves
  - **Training/Focus:** Choose offseason improvement (shooting, defense, athleticism, playmaking)
  - **Playoff Performance:** Play through playoffs (or sim), real-time decisions in clutch moments
  - **Endorsements:** Accept sponsorship deals (pay vs. team culture fit)
  
- **Random Events (Controversies & Challenges):**
  - Off-court incidents: Injury, teammate feuds, media controversy, personal issues
  - Team drama: Coach conflict, locker room tension, key teammate traded
  - Player struggles: Confidence crisis, slump, overtraining
  - Each event presents decision tree on handling (e.g., apologize publicly, stay quiet, blame media)
  - Mishandling creates status effects: low morale (stat penalties), injury (games out), bad reputation (endorsement loss)
  - Proper handling creates narrative moments (redemption arc, leadership moment)

- **Narrative Moments Throughout Season:**
  - Agent conversations: "Should we pursue that contract?"
  - Coach talks: "Focus on defense this season?"
  - Teammate interactions: "Want to lead this team?"
  - GM negotiations: "We're trading you"
  - Media interactions: Post-game interviews affecting perception
  - News feed: Headlines reflecting your actions and achievements

### Playoff Runs
- Play through playoff games (or sim with your influence)
- Narrative tension: Building through playoff brackets
- Real-time decisions in clutch moments (shoot, pass, defense)
- High performance triggers narrative rewards (highlight moments, media praise, team camaraderie)

### Retirement & Transition
- **Retirement Trigger:** Age threshold, choice, or injury
- **Retirement Scene (Narrative Milestone):**
  - Farewell narrative with reflection on legacy
  - Awards/accolades summarized (championships, MVPs, awards earned)
  - Your player enters Hall of Fame eligibility (if stats qualify)
  
- **Seamless Transition to GM Mode:**
  - Your retired player becomes historical league data
  - League state is *preserved*: All 30 teams in evolved state (trades made, players aged, cap situations evolved)
  - You transition to GM mode with that league snapshot
  - Former teammates/rivals are now in league as you manage your team
  - Your retired player's stats, awards, championships are permanent league history

---

## 4. Decision System

### Five Decision Types

**1. Contract Decisions**
- Offseason negotiation: Salary, years, team preference
- Mid-season: Team offers extension, rival teams make offers
- Dialogue with agent: "Take the money vs. chase a ring?"
- Outcome: Affects your team's cap space, influences trade leverage
- Status effect: If contract unsatisfying, morale drops

**2. Career Path / Trades**
- Trade rumors surface as headline/dialogue ("Team X wants you")
- Choices: Request trade, veto trade, stay put, demand bigger role
- Feeds into league's trade logic (your value, preferences influence deals)
- Outcome: Can change team mid-season or end of season

**3. Training / Focus**
- Offseason: Choose improvement focus (shooting, defense, athleticism, playmaking)
- Affects badge progression + stat growth for next season
- Dialogue: Coach suggests areas, you commit
- Outcome: Next season stats reflect training choices

**4. Playoff Performance**
- Play through playoff games (or sim with your control)
- Real-time decisions in clutch moments (shoot, pass, defense)
- Badge effects performance options (can't force long 3s if not a 3-point threat)
- Outcome: High performance → narrative rewards, team success improves legacy

**5. Endorsements / Earnings**
- Sponsorship offers based on popularity/stats
- Choose deals: Higher pay vs. team culture fit
- Outcome: Off-court earnings boost finances, affect lifestyle narrative

### Random Events & Controversy System

**Event Types:**
- Off-court incidents: Injury, feuds, media controversy, personal issues, agent problems
- Team drama: Coach conflict, locker room tension, key teammate traded
- Personal struggles: Confidence crisis, slump, overtraining

**Decision Trees:**
Each event presents options on how to handle it. Examples:
- Controversy: "Apologize publicly" | "Stay quiet" | "Blame media" | "Double down"
- Injury: "Aggressive rehab" | "Conservative recovery" | "Play through it"
- Conflict: "Make peace" | "Request trade" | "Go to coach"

**Status Effects (if mishandled):**
- **Low morale:** Stat penalties, increased trade interest (teams sense weakness)
- **Injury:** Out X games, recovery affects stats
- **Bad reputation:** Endorsement deals dry up, lower contract offers
- **Team conflict:** Reduced playing time, team morale decreases

**Positive Outcomes (if handled well):**
- Redemption arc: Media spins narrative positively
- Leadership moment: Team rallies around you
- Comeback story: Overcoming adversity boosts stats/morale

---

## 5. AI GM Behavior & League Reaction

### Team Recognition
- GMs track your performance (stats, awards, leadership)
- High-performing players get pursued: trades, max contracts, franchise-player treatment
- Low-performing players get benched, moved, or ignored
- Your badges/traits affect team interest (defensive team wants defenders)

### Active Pursuit
- Rival teams scout you: "Team X has interest" (dialogue/headline)
- Your team's GM defends your value in trade talks (feeds into existing trade logic)
- Free agency opens → multiple teams pitch you (narrative scenes with different GMs)
- Contract leverage: If star, teams bid against each other; if role player, modest offers

### Reaction to Your Decisions
- Request trade → GM honors or blocks (narrative explanation)
- Controversy → Team's confidence may drop (affects roster decisions around you)
- Performance dips → Team may reduce role or shop you
- Leadership moments → Team invests more (extends you, adds pieces around you)

### Implementation Details
- Existing auto-GM logic still runs for other 28 teams
- Add "player-awareness" module that tracks your value and influences your team's decisions
- Your team's GM gets enhanced logic that considers: your salary cap hit, your value to team, your morale

---

## 6. Narrative System

### Dialogue & Choice Moments

**Multiple NPC Archetypes:**
- **Agents:** Aggressive, cautious, veteran mentor (each has distinct negotiation style)
- **Coaches:** Demanding, supportive, defensive-minded, pace-and-space focused
- **GMs:** Shrewd, friendly, hardball negotiators
- **Teammates:** Various personalities and relationship dynamics
- **Media:** Different reporter approaches and question types

**Context-Based Dialogue:**
- Same interaction changes based on circumstances
  - Example: Negotiating after MVP season vs. injury recovery vs. team rebuild
  - Example: Post-championship vs. playoff loss affects tone
- Relationship-dependent lines: NPCs remember prior choices ("You always wanted to play hard defense")
- Randomized dialogue pools: Each interaction pulls from multiple lines per NPC
- Personality-driven responses: Your traits/badges influence dialogue options and NPC reactions

**Example Dialogue Variety:**
```
AGENT (Aggressive Archetype) after All-Star season:
  "You're top 5 now. Let's get you 30+ million."
  "Max contract or bust. You've earned it."
  "Teams are gonna fight for you. Let's capitalize."

AGENT (Cautious Archetype) same situation:
  "We should be smart. Five-year deal gives stability."
  "I want to make sure your legacy is protected."
  "Let's see what the market looks like first."

COACH (Demanding) after loss:
  "You played soft. We need more next game."
  "I need 110% effort every possession."
  
COACH (Supportive) same loss:
  "Tough loss. We'll bounce back. Keep your head up."
  "You showed good effort. We'll make adjustments."
```

### Milestone Scenes (Interactive)

**Draft Night**
- Multiple branching paths based on draft position, stats, reputation
- Media reactions vary
- Your GM makes pitch about team vision
- Choice: Accept, negotiate, or express concerns

**All-Star Selection**
- Celebration/redemption scene
- Media interviews (choice: humble, confident, emotional)
- Team/coach reactions

**Playoff Runs**
- Building narrative tension through bracket
- Key matchup dialogues with coach/teammates
- Pressure/legacy moments

**Trade Scenarios**
- Drama of leaving/joining team
- Goodbye scene with current team
- Welcome scene with new team
- Legacy implications discussed

**Retirement Ceremony**
- Career capstone with reflection on legacy
- Highlights montage
- Teammates/coaches tribute
- Legacy milestone summary

### Narrative Branching
- Dialogue choices → slightly different outcome text/morale effects
- Controversy handling → positive or negative media spin
- Relationship building → teammates defend/support in hard times
- Stat milestones → trigger narrative moments ("You just reached 10,000 career points!")

### News Feed Integration
- League headlines reflect your actions and achievements
- Other players' storylines weave in (rivalries, teammate achievements, team drama)
- Varied headline templates so stories don't repeat verbatim
- Creates living world feeling

---

## 7. Player-to-GM Transition

### Retirement Mechanics
- **Triggers:** Age threshold (35+), player choice, severe injury, stat decline
- **Retirement Scene:** Interactive milestone with narrative reflection
- **Hall of Fame Eligibility:** Calculated from career stats (10k+ points, championships, MVPs, all-stars)

### League State Preservation
- **Critical:** League state is *preserved* at retirement
- All 30 teams are in their current evolved state (trades made, players aged, cap situations evolved)
- Your retired player becomes permanent league history
- Progression tracking continues (not reset)

### Transitioning to GM Mode
- After retirement scene, prompt: "Continue as GM of your team?" or "Start GM mode elsewhere?"
- Your retired player appears in Hall of Fame (if eligible)
- Former teammates/rivals still in active league
- Can manage your former team (narrative continuity) or join different franchise
- Previous season's league state is jumping-off point for GM career

### Legacy Carries Forward
- Your player's stats, awards, championships are permanent
- Media references your legacy ("Remember when Player X won MVP in 2028?")
- Your former team might have loyalty to/memories of your era
- Rivals you had as player become rival GMs

---

## 8. Data Model Extensions

### Player Career Data (NEW)
```javascript
{
  careerPhase: "college" | "rookie" | "active" | "retired",
  controlledPlayerId: string,
  isCustomPlayer: boolean,
  customPlayerCreationData: {
    name: string,
    position: string,
    college: string,
    height: number,
    weight: number,
    badges: string[],
    traits: string[],
    archetypeId: string,
    startingOverall: number,
    startingPotential: number
  },
  careerEvents: [
    { type: "drafted", season: 1, round: 1, pick: 5, team: "LAL", ... },
    { type: "all-star", season: 3, ... },
    { type: "traded", season: 5, fromTeam: "LAL", toTeam: "MIA", ... },
    { type: "championship", season: 7, team: "MIA", ... },
    { type: "retired", season: 15, age: 35, ... }
  ],
  careerStats: {
    seasonsPlayed: 15,
    totalPoints: 25000,
    totalRebounds: 5000,
    totalAssists: 5000,
    championships: 1,
    mvpAwards: 2,
    allStarSelections: 8,
    allNBASelections: 5,
    careerHighScore: 52,
    hallOfFameEligible: true
  },
  decisionHistory: [
    { season: 1, type: "contract", decision: "negotiate_terms", outcome: "higher_salary", ... },
    { season: 2, type: "training", decision: "focus_shooting", outcome: "shooting_badge_improved", ... },
    { season: 5, type: "trade", decision: "request_trade", outcome: "traded_to_MIA", ... }
  ],
  randomEventHistory: [
    { season: 3, type: "controversy", description: "Locker room conflict", handled: "properly", outcome: "resolved", ... },
    { season: 6, type: "injury", description: "ACL sprain", handled: "conservative_rehab", outcome: "returned_stronger", ... }
  ]
}
```

### Narrative System (NEW)
```javascript
{
  dialogueLibrary: {
    agent_aggressive: [
      "You're a star now. Let's get you max money.",
      "Teams are fighting for you. Capitalize.",
      ... (10+ variations per situation)
    ],
    agent_cautious: [
      "We should prioritize stability.",
      "Long-term security matters more than peak salary.",
      ...
    ],
    coach_demanding: [...],
    coach_supportive: [...],
    gm_shrewd: [...],
    gm_friendly: [...],
    // ... more archetypes
  },
  narrativeEvents: {
    draft_night: { branches: [...], scenes: [...] },
    all_star_selection: { branches: [...] },
    playoff_run: { phases: [...] },
    championship: { scenes: [...] },
    trade_scenario: { branches: [...] },
    retirement_ceremony: { scenes: [...] }
  },
  randomEventPool: [
    { type: "off_court_incident", trigger_chance: 0.05, outcomes: [...] },
    { type: "team_drama", trigger_chance: 0.03, outcomes: [...] },
    { type: "player_struggle", trigger_chance: 0.08, outcomes: [...] },
    ...
  ],
  npcRelationships: {
    [playerId]: {
      agent: { trust: 0-100, history: [...] },
      coach: { respect: 0-100, history: [...] },
      gm: { relationship: 0-100, history: [...] },
      teammates: { [teamMateId]: { respect: 0-100, history: [...] } }
    }
  }
}
```

### AI GM Enhancement (EXTEND EXISTING)
```javascript
// In auto-GM logic, add player-awareness module:
playerAwarenessModule: {
  trackPlayerValue: (playerId) => {
    // Calculate market value based on stats, age, contract, team need
  },
  pursuePlayer: (playerId, teamId) => {
    // Generate trade offers, max contract offers
  },
  reactToDecision: (playerId, decision) => {
    // Adjust team's interest/pursuit based on player's moves
  },
  evaluateTradeOffers: (playerId, offers) => {
    // Team GM decides whether to accept offers
  }
}
```

### Game Flow (NEW ENTRY POINT)
```javascript
// Add to main game start screen:
GAME_MODES: {
  "gm_mode": { label: "Team GM", description: "Manage an NBA team" },
  "player_career": { label: "Player Career", description: "Control one athlete's career" },
  "hybrid": { label: "Hybrid", description: "Start as player, transition to GM" }
}

// Player career flow:
1. selectGameMode("player_career")
2. choosePlayerCreationMethod("custom" | "existing")
3. if custom: runPlayerCreationFlow()
4. playCollegePhase()
5. playDraftPhase()
6. playSeasons() // Loop until retirement
7. playRetirementScene()
8. transitionToGMMode() // Optional
```

### Existing Systems Reused
- **Badge System:** Use existing badge system, customize during college phase
- **Trait System:** Use existing trait system, integrate into dialogue/decisions
- **Morale System:** Use for NPC reactions, player happiness
- **Trade Logic:** Feed player decisions into existing trade engine
- **FA Logic:** Feed player decisions into free agency engine
- **Progression System:** Use for player stat growth based on training choices
- **Simulation Engines:** Use existing boxscore/possession engines for game results

---

## 9. Implementation Approach

### Phase Structure (Sequential)
This feature should be built as separate phases, integrated with existing 8-phase GM plan:

**Player Career Mode - Phase A: Foundation**
- Custom player creation (college phase)
- Draft + rookie season
- Basic decision system (contracts, training)
- Dialogue system (basic)

**Player Career Mode - Phase B: Depth**
- Random events + controversy system
- AI GM enhancements (player-awareness)
- Narrative scenes (draft, all-star, retirement)
- Endorsements/earnings system

**Player Career Mode - Phase C: Polish**
- Dialogue variety and branching
- Playoff gameplay integration
- Player-to-GM transition
- Legacy tracking

### Reuse & Integration
- Leverage existing player data structures (players-2026.js, traits.js, etc.)
- Build on existing morale system (morale.js)
- Extend existing trade/FA logic (trade.js, freeAgency.js)
- Reuse existing UI patterns (ui/roster.js, ui/tradeCenter.js)
- Use existing progression system (progression.js)

---

## 10. Verification & Testing

### College Phase
- [ ] Custom player creation works (all fields populate)
- [ ] Badges/traits persist correctly
- [ ] Draft night scene triggers properly
- [ ] Rookie contract negotiation works

### Regular Seasons
- [ ] Decisions feed into league simulation
- [ ] AI GMs react to player value (recognize stars, ignore role players)
- [ ] Trade rumors surface correctly
- [ ] Random events trigger (~5-10% of seasons have major events)
- [ ] Status effects properly affect stats
- [ ] Morale system reflects decisions

### Narrative System
- [ ] Dialogue varies (not repetitive)
- [ ] NPCs remember prior decisions
- [ ] Milestone scenes trigger at right times
- [ ] News feed reflects player actions
- [ ] Branching dialogue affects outcomes

### Playoffs & Retirement
- [ ] Playoff games play/sim correctly
- [ ] Retirement scene triggers at right age/condition
- [ ] Career stats calculated correctly
- [ ] Hall of Fame eligibility accurate

### Player-to-GM Transition
- [ ] League state preserved on retirement
- [ ] Retired player appears in Hall of Fame (if eligible)
- [ ] Transition to GM mode works seamlessly
- [ ] Former teammates/rivals appear in active league

---

## 11. Success Criteria

- ✅ Player can create custom character during college phase
- ✅ Full career arc playable (draft → 15+ seasons → retirement)
- ✅ All 5 decision types (contracts, trades, training, playoffs, endorsements) implemented
- ✅ Random events create narrative tension and meaningful consequences
- ✅ Dialogue is varied and context-aware (NPCs don't repeat verbatim)
- ✅ Milestone scenes (draft, all-star, retirement) feel narratively significant
- ✅ AI GMs actively pursue/react to player's performance and decisions
- ✅ Player-to-GM transition seamless and preserves league state
- ✅ Badges/traits from Phase 1 foundation fully integrated
- ✅ Existing morale/trade/FA/progression systems leverage successfully
- ✅ Replayability high (different traits/decisions → different stories)
