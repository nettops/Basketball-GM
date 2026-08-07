# Player Career Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a player-centric career simulation mode where one athlete makes decisions that feed into the existing league simulation, with narrative branching, AI GM reactions, and seamless transition to GM mode after retirement.

**Architecture:** Player Career Mode is a "POV layer" on top of existing league simulation. Custom player creation → college phase → draft → regular seasons with 5 decision types → retirement with league state preservation. Decisions feed into existing trade/FA/progression logic. Narrative system overlays dialogue and milestone scenes. AI GMs recognize player value and react.

**Tech Stack:** Vanilla JavaScript (existing codebase), existing morale/trade/FA/progression systems, new narrative/decision/random-event modules

## Global Constraints

- **No new dependencies** — use existing badge/trait/morale systems
- **Reuse existing patterns** — follow ui/roster.js, ui/draft.js, trade.js structure
- **Backward compatible** — GM mode must remain unaffected
- **Frequent commits** — one per task minimum
- **Three phases sequential:** A (Foundation), B (Depth), C (Polish)

---

# PHASE A: FOUNDATION (Player Creation, Basic Decisions, Basic Narrative)

## File Structure (Phase A)

**New Files:**
- `playerCareerController.js` — Career phase management, decision routing, career lifecycle
- `ui/playerCareer.js` — Main player career UI entry point and mode selector
- `ui/playerCreation.js` — College phase character customization (name, position, college, badges, traits, archetype)
- `ui/playerDashboard.js` — Player career stats, current season summary, decision prompts
- `narrativeSystem.js` — Dialogue library management, NPC dialogue lookup, context-based selection
- `ui/narrativeDialogues.js` — Render dialogue choices, store response handling

**Modified Files:**
- `script.js` — Add "playerCareer" game mode entry point
- `league.js` — Add career decision hooks (to be called from player controller)
- `data.js` — Add archetype definitions and starter badges/traits

---

## Phase A Tasks

### Task A1: Create Archetype Definitions

**Files:**
- Create: `data.js` (extend existing)

**Interfaces:**
- Produces: `PLAYER_ARCHETYPES` object with archetype definitions
  - Properties: `name`, `description`, `startingOverall` (60-75), `startingPotential` (75-99), `badge_affinity` (array of likely badges)

**Implementation:**

- [ ] **Step 1: Add archetype definitions to data.js**

Open `data.js` and add after existing constants:

```javascript
const PLAYER_ARCHETYPES = {
  scorer: {
    name: "Scorer",
    description: "Volume scorer who takes over games",
    startingOverall: 70,
    startingPotential: 88,
    badge_affinity: ["scorer", "3pt_threat", "ball_handler"]
  },
  defender: {
    name: "Defender",
    description: "Elite defender, lockdown mentality",
    startingOverall: 68,
    startingPotential: 85,
    badge_affinity: ["defender", "steal_artist", "shot_blocker"]
  },
  playmaker: {
    name: "Playmaker",
    description: "Pass-first point guard",
    startingOverall: 69,
    startingPotential: 86,
    badge_affinity: ["playmaker", "ball_handler", "assists"]
  },
  rebounder: {
    name: "Rebounder",
    description: "Elite rebounder and interior presence",
    startingOverall: 68,
    startingPotential: 84,
    badge_affinity: ["rebounder", "shot_blocker", "interior_defense"]
  },
  all_around: {
    name: "All-Around",
    description: "Balanced player with versatile skills",
    startingOverall: 66,
    startingPotential: 82,
    badge_affinity: ["defender", "scorer", "playmaker"]
  }
};
```

- [ ] **Step 2: Verify archetypes defined**

Open `data.js` and confirm `PLAYER_ARCHETYPES` is defined with all 5 archetypes.

- [ ] **Step 3: Commit**

```bash
git add data.js
git commit -m "feat(archetypes): add player archetype definitions for career mode"
```

---

### Task A2: Create Career Controller Core Structure

**Files:**
- Create: `playerCareerController.js`

**Interfaces:**
- Consumes: `PLAYER_ARCHETYPES` from data.js, existing player object structure
- Produces: 
  - `PlayerCareerController` class with methods:
    - `createCustomPlayer(name, position, college, archetype, selectedBadges, selectedTraits)` → player object
    - `getCurrentCareerPhase()` → "college" | "rookie" | "active" | "retired"
    - `recordDecision(type, decision, outcome)` → void
    - `getCareerStats()` → object with career totals
    - `triggerRetirement()` → void

**Implementation:**

- [ ] **Step 1: Create playerCareerController.js**

Create new file `C:\Users\cory\Desktop\nba\playerCareerController.js`:

```javascript
class PlayerCareerController {
  constructor(gameState) {
    this.gameState = gameState;
    this.controlledPlayerId = null;
    this.careerPhase = null;
    this.careerEvents = [];
    this.decisionHistory = [];
    this.randomEventHistory = [];
  }

  createCustomPlayer(name, position, college, archetype, selectedBadges, selectedTraits) {
    const archetypeData = PLAYER_ARCHETYPES[archetype];
    if (!archetypeData) {
      throw new Error(`Invalid archetype: ${archetype}`);
    }

    const player = {
      id: this.generatePlayerId(),
      name: name,
      position: position,
      college: college,
      age: 22, // Draft age
      overall: archetypeData.startingOverall,
      potential: archetypeData.startingPotential,
      badges: selectedBadges, // Array of badge strings
      traits: selectedTraits, // Array of trait strings
      contract: {
        salary: 0,
        yearsRemaining: 0
      },
      careerStats: {
        seasonsPlayed: 0,
        totalPoints: 0,
        totalRebounds: 0,
        totalAssists: 0,
        championships: 0,
        mvpAwards: 0,
        allStarSelections: 0,
        careerHighScore: 0,
        hallOfFameEligible: false
      },
      isCustomPlayer: true,
      careerPhase: "college"
    };

    return player;
  }

  setControlledPlayer(playerId) {
    this.controlledPlayerId = playerId;
  }

  getCurrentCareerPhase() {
    if (!this.controlledPlayerId) return null;
    const player = this.gameState.players[this.controlledPlayerId];
    return player ? player.careerPhase : null;
  }

  recordDecision(type, decision, outcome) {
    // type: "contract" | "trade" | "training" | "playoff" | "endorsement"
    const record = {
      season: this.gameState.currentSeason,
      type: type,
      decision: decision,
      outcome: outcome,
      timestamp: Date.now()
    };
    this.decisionHistory.push(record);
  }

  getCareerStats() {
    if (!this.controlledPlayerId) return null;
    const player = this.gameState.players[this.controlledPlayerId];
    return player ? player.careerStats : null;
  }

  triggerRetirement() {
    if (!this.controlledPlayerId) return;
    const player = this.gameState.players[this.controlledPlayerId];
    player.careerPhase = "retired";
    
    // Calculate Hall of Fame eligibility
    player.careerStats.hallOfFameEligible = this.calculateHOFEligibility(player);
    
    this.careerEvents.push({
      type: "retired",
      season: this.gameState.currentSeason,
      hallOfFameEligible: player.careerStats.hallOfFameEligible
    });
  }

  calculateHOFEligibility(player) {
    return (
      player.careerStats.totalPoints >= 10000 ||
      player.careerStats.championships >= 2 ||
      player.careerStats.mvpAwards >= 1 ||
      player.careerStats.allStarSelections >= 5
    );
  }

  generatePlayerId() {
    return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export for use in game
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerCareerController };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c playerCareerController.js` (syntax check)
Expected: No output (valid syntax)

- [ ] **Step 3: Commit**

```bash
git add playerCareerController.js
git commit -m "feat(playerCareerController): create core career controller with player creation"
```

---

### Task A3: Create Player Creation UI

**Files:**
- Create: `ui/playerCreation.js`

**Interfaces:**
- Consumes: `PLAYER_ARCHETYPES` from data.js, `PlayerCareerController` class
- Produces: `renderPlayerCreation(container, onPlayerCreated)` function
  - Displays form with: name, position, college, archetype selection, badge picker, trait picker
  - Calls `onPlayerCreated(playerObject)` when form submitted

**Implementation:**

- [ ] **Step 1: Create playerCreation.js**

Create `C:\Users\cory\Desktop\nba\ui\playerCreation.js`:

```javascript
function renderPlayerCreation(container, onPlayerCreated) {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  const colleges = ['Duke', 'California', 'Kansas', 'UCLA', 'North Carolina', 'Kentucky', 'Arizona', 'Other'];
  
  // Available badges (sample - extend based on existing badge system)
  const availableBadges = ['scorer', '3pt_threat', 'defender', 'playmaker', 'rebounder', 'ball_handler', 'leader'];
  const availableTraits = ['clutch', 'leader', 'volume_scorer', 'streaky', 'hard_worker', 'confident'];

  let selectedBadges = [];
  let selectedTraits = [];

  const html = `
    <div class="view-header"><h2>Create Your Player</h2></div>
    <div class="panel" style="max-width: 600px;">
      <form id="playerCreationForm">
        <!-- Name -->
        <div class="form-group">
          <label>Name:</label>
          <input type="text" id="playerName" required placeholder="e.g., LeBron James">
        </div>

        <!-- Position -->
        <div class="form-group">
          <label>Position:</label>
          <select id="playerPosition" required>
            <option value="">Select Position</option>
            ${positions.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>

        <!-- College -->
        <div class="form-group">
          <label>College:</label>
          <select id="playerCollege" required>
            <option value="">Select College</option>
            ${colleges.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>

        <!-- Archetype -->
        <div class="form-group">
          <label>Archetype:</label>
          <div id="archetypeSelect">
            ${Object.entries(PLAYER_ARCHETYPES).map(([key, arch]) => `
              <label style="display: block; margin: 8px 0;">
                <input type="radio" name="archetype" value="${key}" required>
                <strong>${arch.name}:</strong> ${arch.description}
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Badges -->
        <div class="form-group">
          <label>Select up to 5 badges:</label>
          <div id="badgeSelect">
            ${availableBadges.map(badge => `
              <label style="display: inline-block; margin-right: 12px;">
                <input type="checkbox" class="badgeCheckbox" value="${badge}">
                ${badge.replace(/_/g, ' ')}
              </label>
            `).join('')}
          </div>
          <small>Selected: <span id="badgeCount">0</span>/5</small>
        </div>

        <!-- Traits -->
        <div class="form-group">
          <label>Select up to 3 traits:</label>
          <div id="traitSelect">
            ${availableTraits.map(trait => `
              <label style="display: inline-block; margin-right: 12px;">
                <input type="checkbox" class="traitCheckbox" value="${trait}">
                ${trait.replace(/_/g, ' ')}
              </label>
            `).join('')}
          </div>
          <small>Selected: <span id="traitCount">0</span>/3</small>
        </div>

        <button type="submit" class="btn btn-primary" style="margin-top: 20px;">Create Player</button>
      </form>
    </div>
  `;

  container.innerHTML = html;

  // Badge selection logic
  const badgeCheckboxes = container.querySelectorAll('.badgeCheckbox');
  badgeCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = Array.from(badgeCheckboxes).filter(c => c.checked);
      if (checked.length > 5) {
        cb.checked = false;
        alert('Maximum 5 badges allowed');
      } else {
        selectedBadges = checked.map(c => c.value);
        container.querySelector('#badgeCount').textContent = selectedBadges.length;
      }
    });
  });

  // Trait selection logic
  const traitCheckboxes = container.querySelectorAll('.traitCheckbox');
  traitCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = Array.from(traitCheckboxes).filter(c => c.checked);
      if (checked.length > 3) {
        cb.checked = false;
        alert('Maximum 3 traits allowed');
      } else {
        selectedTraits = checked.map(c => c.value);
        container.querySelector('#traitCount').textContent = selectedTraits.length;
      }
    });
  });

  // Form submission
  const form = container.querySelector('#playerCreationForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = container.querySelector('#playerName').value;
    const position = container.querySelector('#playerPosition').value;
    const college = container.querySelector('#playerCollege').value;
    const archetype = container.querySelector('input[name="archetype"]:checked').value;

    if (!selectedBadges.length) {
      alert('Select at least 1 badge');
      return;
    }
    if (!selectedTraits.length) {
      alert('Select at least 1 trait');
      return;
    }

    const controller = new PlayerCareerController(GameState);
    const player = controller.createCustomPlayer(name, position, college, archetype, selectedBadges, selectedTraits);
    
    onPlayerCreated(player);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerCreation };
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -c ui/playerCreation.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add ui/playerCreation.js
git commit -m "feat(ui/playerCreation): add player customization form"
```

---

### Task A4: Create Basic Narrative System

**Files:**
- Create: `narrativeSystem.js`

**Interfaces:**
- Produces: `NarrativeSystem` class with methods:
  - `getDialogue(npcType, situation, context)` → string (dialogue line)
  - `getDialogueOptions(situation)` → array of choice objects with `text` and `onSelect` callback

**Implementation:**

- [ ] **Step 1: Create narrativeSystem.js**

Create `C:\Users\cory\Desktop\nba\narrativeSystem.js`:

```javascript
class NarrativeSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.dialogueLibrary = this.initDialogueLibrary();
    this.npcRelationships = {}; // Track NPC relationships
  }

  initDialogueLibrary() {
    return {
      agent_aggressive: [
        "You're a star now. Let's get you max money.",
        "Teams are fighting for you. Capitalize on it.",
        "Time to get paid. You've earned it.",
        "We should be aggressive in negotiations."
      ],
      agent_cautious: [
        "Let's be smart about this long-term.",
        "Security matters more than peak salary.",
        "I want to make sure your career is protected.",
        "We should see what the market looks like first."
      ],
      coach_demanding: [
        "I need more from you out there.",
        "110% effort every single possession.",
        "You're not playing up to your potential.",
        "Let's get to work in the offseason."
      ],
      coach_supportive: [
        "You showed great effort out there.",
        "Keep your head up—we'll bounce back.",
        "I believe in you. Keep improving.",
        "That was solid. Let's build on it."
      ],
      gm_friendly: [
        "We want to build around you here.",
        "You're a centerpiece of our future.",
        "Let's talk about what you need.",
        "You matter to this organization."
      ],
      gm_shrewd: [
        "We can make this work for both sides.",
        "Your market value is what it is.",
        "Let's be realistic about numbers.",
        "This is a fair offer based on market."
      ],
      media_standard: [
        "How are you feeling about your performance?",
        "What's your take on the team's direction?",
        "Big game coming up—ready?",
        "Any thoughts on your playoff chances?"
      ]
    };
  }

  getDialogue(npcType, situation, context = {}) {
    const key = `${npcType}_${situation}` || npcType;
    const dialogues = this.dialogueLibrary[key] || this.dialogueLibrary[npcType];
    
    if (!dialogues || dialogues.length === 0) {
      return `[${npcType} has nothing to say about ${situation}]`;
    }

    // Return random dialogue from pool
    return dialogues[Math.floor(Math.random() * dialogues.length)];
  }

  getDialogueOptions(situation) {
    // Return generic options for now; will expand in Phase B
    const options = [
      { text: "Continue", value: "continue" },
      { text: "Ask for clarification", value: "clarify" }
    ];
    return options;
  }

  recordNPCInteraction(npcType, playerId, topic) {
    if (!this.npcRelationships[npcType]) {
      this.npcRelationships[npcType] = {};
    }
    this.npcRelationships[npcType][playerId] = {
      lastInteraction: this.gameState.currentSeason,
      topic: topic
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NarrativeSystem };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c narrativeSystem.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add narrativeSystem.js
git commit -m "feat(narrativeSystem): create narrative system with dialogue library"
```

---

### Task A5: Add Player Career Mode Entry Point to script.js

**Files:**
- Modify: `script.js`

**Interfaces:**
- Consumes: `PlayerCareerController`, `renderPlayerCreation`, `NarrativeSystem`
- Produces: New game mode "playerCareer" callable from main menu

**Implementation:**

- [ ] **Step 1: Find game mode entry in script.js**

Open `script.js` and locate where game modes are defined (search for "gm_mode" or similar). Note the exact line numbers.

- [ ] **Step 2: Add playerCareer mode to mode list**

In the section where game modes are listed (typically in GAME_MODES or similar), add:

```javascript
const GAME_MODES = {
  "gm_mode": { label: "Team GM", description: "Manage an NBA team" },
  "player_career": { label: "Player Career", description: "Control one athlete's career" }
  // ... existing modes
};
```

- [ ] **Step 3: Add mode handler**

Find where game mode selection is handled (likely in a function that checks mode selection). Add:

```javascript
if (selectedMode === "player_career") {
  initPlayerCareerMode();
}
```

- [ ] **Step 4: Create initPlayerCareerMode function in script.js**

Add after other mode initializers:

```javascript
function initPlayerCareerMode() {
  // Initialize player career components
  gameState.playerCareerController = new PlayerCareerController(gameState);
  gameState.narrativeSystem = new NarrativeSystem(gameState);
  gameState.gameMode = "playerCareer";

  // Show player creation screen
  const mainContainer = document.querySelector('#mainContent');
  renderPlayerCreation(mainContainer, (player) => {
    // Player created
    gameState.players[player.id] = player;
    gameState.playerCareerController.setControlledPlayer(player.id);
    
    // Move to draft phase
    gameState.currentSeason = 1;
    renderDraftPhase();
  });
}

function renderDraftPhase() {
  const mainContainer = document.querySelector('#mainContent');
  mainContainer.innerHTML = `
    <div class="view-header"><h2>Draft Night</h2></div>
    <div class="panel">
      <p>You are selected by a team...</p>
      <p style="margin-top: 20px;"><button class="btn btn-primary" onclick="startFirstSeason()">Accept Draft</button></p>
    </div>
  `;
}

function startFirstSeason() {
  gameState.playerCareerController.getCurrentCareerPhase();
  // TODO: Transition to first season
  renderView('dashboard');
}
```

- [ ] **Step 5: Verify mode selection works**

Test: Open game, see "Player Career" option in mode selector. Verify it doesn't error when clicked (may not fully work yet, that's OK for Phase A).

- [ ] **Step 6: Commit**

```bash
git add script.js
git commit -m "feat(script): add playerCareer game mode entry point"
```

---

### Task A6: Create Player Dashboard UI

**Files:**
- Create: `ui/playerDashboard.js`

**Interfaces:**
- Consumes: `PlayerCareerController` instance, current player object
- Produces: `renderPlayerDashboard(container, playerId)` function

**Implementation:**

- [ ] **Step 1: Create playerDashboard.js**

Create `C:\Users\cory\Desktop\nba\ui\playerDashboard.js`:

```javascript
function renderPlayerDashboard(container, playerId) {
  const player = gameState.players[playerId];
  if (!player) {
    container.innerHTML = '<div class="panel">Player not found</div>';
    return;
  }

  const avg = getPlayerAverages(player);
  const season = gameState.currentSeason;

  const html = `
    <div class="view-header">
      <h2>${player.name}</h2>
      <span class="view-sub">${player.position} | Age ${player.age} | Season ${season}</span>
    </div>

    <div class="panel">
      <div class="panel-header">Career Stats</div>
      <table style="width: 100%;">
        <tr>
          <td><strong>Career Points:</strong> ${player.careerStats.totalPoints}</td>
          <td><strong>Championships:</strong> ${player.careerStats.championships}</td>
        </tr>
        <tr>
          <td><strong>All-Stars:</strong> ${player.careerStats.allStarSelections}</td>
          <td><strong>MVPs:</strong> ${player.careerStats.mvpAwards}</td>
        </tr>
      </table>
    </div>

    <div class="panel">
      <div class="panel-header">This Season</div>
      <table class="data-table">
        <tbody>
          <tr>
            <td><strong>Overall Rating:</strong></td>
            <td><span class="rating-chip">${player.overall}</span></td>
          </tr>
          <tr>
            <td><strong>PPG:</strong></td>
            <td>${avg.ppg.toFixed(1)}</td>
          </tr>
          <tr>
            <td><strong>RPG:</strong></td>
            <td>${avg.rpg.toFixed(1)}</td>
          </tr>
          <tr>
            <td><strong>APG:</strong></td>
            <td>${avg.apg.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-header">Badges & Traits</div>
      <div>
        <strong>Badges:</strong> ${player.badges.join(', ') || 'None'}
      </div>
      <div style="margin-top: 10px;">
        <strong>Traits:</strong> ${player.traits.join(', ') || 'None'}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">Quick Actions</div>
      <button class="btn btn-primary" onclick="simulateSeason()">Simulate Season</button>
      <button class="btn btn-ghost" onclick="renderView('dashboard')">Back to Main</button>
    </div>
  `;

  container.innerHTML = html;
}

function simulateSeason() {
  // Placeholder for season simulation
  alert('Season simulation not yet implemented');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerDashboard };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c ui/playerDashboard.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add ui/playerDashboard.js
git commit -m "feat(ui/playerDashboard): add player career stats dashboard"
```

---

### Task A7: Add Player Career Navigation to Main UI

**Files:**
- Modify: `ui/nav.js`

**Implementation:**

- [ ] **Step 1: Open ui/nav.js and locate nav rendering**

Search for where navigation items are built (likely in a function that builds tabs/menu).

- [ ] **Step 2: Add Player Career nav item (conditional)**

In the navigation building section, add conditional item that only shows when in playerCareer mode:

```javascript
// Add after existing nav items:
if (gameState.gameMode === 'playerCareer') {
  navHtml += '<button onclick="renderView(\'playerDashboard\')" class="nav-item">Career</button>';
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/nav.js
git commit -m "feat(ui/nav): add Player Career nav item"
```

---

## Phase A Verification

- [ ] **Create custom player:** Start player career mode, create player with name, position, college, archetype, badges, traits. Verify player object is created with correct values.
- [ ] **Player appears in dashboard:** Player Dashboard shows correct name, season, career stats (initially 0).
- [ ] **Navigation works:** Click "Career" in nav shows player dashboard.
- [ ] **No GM mode regression:** Start GM mode still works, shows team selection.

---

# PHASE B: DEPTH (Random Events, AI GM Enhancements, Milestone Scenes)

## File Structure (Phase B)

**New Files:**
- `randomEvents.js` — Controversy/challenge system with decision trees
- `aiGmPlayerAwareness.js` — Enhance auto-GM to recognize and pursue player
- `ui/narrativeScenes.js` — Milestone scene rendering (draft, all-star, etc.)
- `ui/randomEventScenes.js` — Render random event dialogue + decision trees

**Modified Files:**
- `league.js` — Integrate random event triggers into season progression
- `trade.js` — Feed player preferences into trade evaluation
- `freeAgency.js` — Feed player morale into contract offers
- `progression.js` — Apply training decision to stat growth

---

## Phase B Tasks

### Task B1: Create Random Events System

**Files:**
- Create: `randomEvents.js`

**Interfaces:**
- Produces: `RandomEventSystem` class with methods:
  - `triggerRandomEvent(playerId, season)` → event object or null
  - `getEventDecisions(eventType)` → array of decision objects
  - `resolveEventDecision(eventId, decision)` → status effect object

**Implementation:**

- [ ] **Step 1: Create randomEvents.js**

Create `C:\Users\cory\Desktop\nba\randomEvents.js`:

```javascript
class RandomEventSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.eventPool = this.initEventPool();
  }

  initEventPool() {
    return [
      {
        type: 'controversy',
        triggers: ['off_court_incident', 'media_blowup', 'teammate_conflict'],
        chance: 0.05,
        baseDescription: 'A controversy has emerged in the media',
        decisions: [
          { option: 'Apologize publicly', outcome: 'reputation_recovery', moralePenalty: -5, reputationChange: +20 },
          { option: 'Stay quiet', outcome: 'media_ignores', moralePenalty: -15, reputationChange: 0 },
          { option: 'Blame media', outcome: 'media_conflict', moralePenalty: -25, reputationChange: -30 }
        ]
      },
      {
        type: 'team_drama',
        triggers: ['locker_room_tension', 'coach_conflict'],
        chance: 0.03,
        baseDescription: 'Team chemistry is suffering',
        decisions: [
          { option: 'Make peace with team', outcome: 'resolved', moralePenalty: -5, teamMoraleChange: +10 },
          { option: 'Request trade', outcome: 'trade_request', moralePenalty: 0, teamMoraleChange: -20 },
          { option: 'Go to coach', outcome: 'coached_through', moralePenalty: -10, teamMoraleChange: +5 }
        ]
      },
      {
        type: 'player_struggle',
        triggers: ['shooting_slump', 'confidence_crisis', 'overtraining'],
        chance: 0.08,
        baseDescription: 'You\'re not playing up to your usual level',
        decisions: [
          { option: 'Work harder in practice', outcome: 'recovery', statsPenalty: -0.05, recoveryChance: 0.7 },
          { option: 'Take time off', outcome: 'rest', statsPenalty: -0.10, recoveryChance: 0.5 },
          { option: 'Push through', outcome: 'grit', statsPenalty: -0.15, recoveryChance: 0.3 }
        ]
      }
    ];
  }

  triggerRandomEvent(playerId, season) {
    // 10-15% chance per season an event triggers
    if (Math.random() > 0.12) return null;

    const eventType = this.eventPool[Math.floor(Math.random() * this.eventPool.length)];
    const trigger = eventType.triggers[Math.floor(Math.random() * eventType.triggers.length)];

    const event = {
      id: `event_${playerId}_${season}_${Date.now()}`,
      type: eventType.type,
      trigger: trigger,
      season: season,
      playerId: playerId,
      description: eventType.baseDescription,
      decisions: eventType.decisions,
      handled: false,
      outcome: null
    };

    return event;
  }

  getEventDecisions(eventType) {
    const eventDef = this.eventPool.find(e => e.type === eventType);
    return eventDef ? eventDef.decisions : [];
  }

  resolveEventDecision(event, decisionText) {
    const decision = event.decisions.find(d => d.option === decisionText);
    if (!decision) return null;

    const statusEffect = {
      eventId: event.id,
      decision: decisionText,
      outcome: decision.outcome,
      statsPenalty: decision.statsPenalty || 0,
      moralePenalty: decision.moralePenalty || 0,
      reputationChange: decision.reputationChange || 0,
      teamMoraleChange: decision.teamMoraleChange || 0,
      applied: false
    };

    event.handled = true;
    event.outcome = decision.outcome;

    return statusEffect;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RandomEventSystem };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c randomEvents.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add randomEvents.js
git commit -m "feat(randomEvents): add random event system with controversy/team drama"
```

---

### Task B2: Enhance Auto-GM with Player-Awareness

**Files:**
- Create: `aiGmPlayerAwareness.js`

**Interfaces:**
- Produces: `PlayerAwarenessModule` class with methods:
  - `evaluatePlayerValue(playerId)` → marketValue (0-100)
  - `generateTradeOffers(playerId)` → array of trade offer objects
  - `reactToPlayerDecision(playerId, decision)` → void (updates team interest)

**Implementation:**

- [ ] **Step 1: Create aiGmPlayerAwareness.js**

Create `C:\Users\cory\Desktop\nba\aiGmPlayerAwareness.js`:

```javascript
class PlayerAwarenessModule {
  constructor(gameState) {
    this.gameState = gameState;
    this.teamInterest = {}; // Track which teams want which players
  }

  evaluatePlayerValue(playerId) {
    const player = this.gameState.players[playerId];
    if (!player) return 0;

    let value = 0;

    // Base: current overall rating
    value += player.overall;

    // Age multiplier (prime years 24-28 are most valuable)
    if (player.age >= 24 && player.age <= 28) {
      value += 10;
    } else if (player.age > 32) {
      value -= 15;
    }

    // All-Star bonus
    if (player.careerStats.allStarSelections > 0) {
      value += player.careerStats.allStarSelections * 5;
    }

    // Championship bonus
    if (player.careerStats.championships > 0) {
      value += player.careerStats.championships * 10;
    }

    return Math.min(Math.max(value, 0), 100);
  }

  generateTradeOffers(playerId) {
    const player = this.gameState.players[playerId];
    if (!player) return [];

    const playerValue = this.evaluatePlayerValue(playerId);
    const offers = [];

    // Generate offers from interested teams
    const nTeams = Math.floor(playerValue / 20); // Higher value = more offers

    for (let i = 0; i < nTeams; i++) {
      const teamId = this.gameState.teams[i].id;
      
      // Don't offer from current team
      if (player.contract.teamId === teamId) continue;

      const offer = {
        fromTeamId: teamId,
        playerId: playerId,
        contractOffer: {
          salary: 15000000 + (playerValue * 100000),
          years: 3 + Math.floor(playerValue / 25)
        },
        chance: 0.5 + (playerValue / 100)
      };

      offers.push(offer);
    }

    return offers;
  }

  reactToPlayerDecision(playerId, decision) {
    // When player makes major decision, update team interest
    // e.g., if player performs well in playoffs, increase trade interest
    // If player is unhappy with team, increase likelihood of trade request
    
    const player = this.gameState.players[playerId];
    if (!player) return;

    if (decision.type === 'playoff_performance' && decision.outcome === 'excellent') {
      // Increase all team interest by 10%
      Object.keys(this.teamInterest).forEach(teamId => {
        this.teamInterest[teamId] = Math.min(this.teamInterest[teamId] + 0.10, 1.0);
      });
    }

    if (decision.type === 'morale' && decision.outcome === 'unhappy') {
      // Decrease current team loyalty
      const currentTeamId = player.contract.teamId;
      this.teamInterest[currentTeamId] = Math.max(this.teamInterest[currentTeamId] - 0.20, 0);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerAwarenessModule };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c aiGmPlayerAwareness.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add aiGmPlayerAwareness.js
git commit -m "feat(aiGmPlayerAwareness): add player value evaluation and trade offer generation"
```

---

### Task B3: Create Milestone Scene Rendering

**Files:**
- Create: `ui/narrativeScenes.js`

**Interfaces:**
- Produces: `renderMilestoneScene(container, sceneType, context)` function
  - sceneType: "draft_night", "all_star", "playoff", "retirement"
  - context: data object with scene-specific info

**Implementation:**

- [ ] **Step 1: Create narrativeScenes.js**

Create `C:\Users\cory\Desktop\nba\ui\narrativeScenes.js`:

```javascript
function renderMilestoneScene(container, sceneType, context) {
  let html = '';

  if (sceneType === 'draft_night') {
    html = renderDraftNightScene(context);
  } else if (sceneType === 'all_star') {
    html = renderAllStarScene(context);
  } else if (sceneType === 'playoff') {
    html = renderPlayoffScene(context);
  } else if (sceneType === 'retirement') {
    html = renderRetirementScene(context);
  }

  container.innerHTML = html;
}

function renderDraftNightScene(context) {
  const { playerName, teamName, draftPick } = context;
  return `
    <div class="view-header"><h2>Draft Night 2026</h2></div>
    <div class="panel" style="text-align: center; padding: 40px;">
      <h3 style="font-size: 24px;">${teamName}</h3>
      <p style="font-size: 18px; margin: 20px 0;">With the ${draftPick} pick, selects...</p>
      <h2 style="font-size: 36px; color: #00AA00; margin: 30px 0;">${playerName}</h2>
      <p>Congratulations! You are drafted by ${teamName}.</p>
      <p style="margin-top: 30px;">
        <button class="btn btn-primary" onclick="proceedFromDraft()">Continue</button>
      </p>
    </div>
  `;
}

function renderAllStarScene(context) {
  const { playerName, season } = context;
  return `
    <div class="view-header"><h2>All-Star Selection - Season ${season}</h2></div>
    <div class="panel" style="text-align: center; padding: 40px;">
      <p style="font-size: 18px; margin: 20px 0;">This year's All-Star selections are in...</p>
      <h2 style="font-size: 36px; color: #FFD700; margin: 30px 0;">🌟 ${playerName}</h2>
      <p>You've been selected as an All-Star!</p>
      <p>Your career just reached a new level.</p>
      <p style="margin-top: 30px;">
        <button class="btn btn-primary" onclick="dismissNarrativeScene()">Continue</button>
      </p>
    </div>
  `;
}

function renderPlayoffScene(context) {
  const { playerName, season, opponent, round } = context;
  return `
    <div class="view-header"><h2>Playoff ${round} - Season ${season}</h2></div>
    <div class="panel" style="padding: 30px;">
      <p style="font-size: 18px;">Your team faces ${opponent} in ${round}.</p>
      <p style="margin: 20px 0;">This is your chance to prove yourself on the biggest stage.</p>
      <p style="margin-top: 30px;">
        <button class="btn btn-primary" onclick="startPlayoffSeries()">Start Series</button>
      </p>
    </div>
  `;
}

function renderRetirementScene(context) {
  const { playerName, careerStats, hallOfFameEligible } = context;
  return `
    <div class="view-header"><h2>Retirement Ceremony</h2></div>
    <div class="panel" style="text-align: center; padding: 40px;">
      <h2 style="font-size: 32px;">${playerName}</h2>
      <p style="font-size: 18px; margin: 20px 0;">A legendary career comes to an end</p>
      
      <div style="margin: 30px 0; text-align: left; display: inline-block;">
        <p><strong>Career Points:</strong> ${careerStats.totalPoints}</p>
        <p><strong>All-Stars:</strong> ${careerStats.allStarSelections}</p>
        <p><strong>Championships:</strong> ${careerStats.championships}</p>
        <p><strong>MVPs:</strong> ${careerStats.mvpAwards}</p>
      </div>

      ${hallOfFameEligible ? `<p style="font-size: 20px; color: #FFD700; margin-top: 20px;">🏆 Hall of Fame Eligible 🏆</p>` : ''}

      <p style="margin-top: 40px;">
        <button class="btn btn-primary" onclick="transitionToGMMode()">Transition to GM Mode</button>
        <button class="btn btn-ghost" onclick="returnToMenu()">Return to Menu</button>
      </p>
    </div>
  `;
}

function proceedFromDraft() {
  // Placeholder
  renderView('dashboard');
}

function dismissNarrativeScene() {
  renderView('dashboard');
}

function startPlayoffSeries() {
  // Placeholder for playoff gameplay
  alert('Playoff gameplay not yet implemented');
}

function transitionToGMMode() {
  gameState.gameMode = 'gm_mode';
  // Save current league state
  // TODO: Implement full transition
  renderView('teamSelect');
}

function returnToMenu() {
  gameState.gameMode = null;
  renderView('modeSelect');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMilestoneScene };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c ui/narrativeScenes.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add ui/narrativeScenes.js
git commit -m "feat(ui/narrativeScenes): add milestone scene rendering"
```

---

### Task B4: Integrate Random Events into Season Progression

**Files:**
- Modify: `league.js`

**Implementation:**

- [ ] **Step 1: Find season progression function in league.js**

Search for function that handles season end/offseason (likely `advanceSeason()` or `progressSeason()`).

- [ ] **Step 2: Add random event trigger**

In the season progression function, add (around offseason processing):

```javascript
// After season simulation, check for random events for player career mode
if (gameState.gameMode === 'playerCareer' && gameState.playerCareerController) {
  const playerId = gameState.playerCareerController.controlledPlayerId;
  
  if (!gameState.randomEventSystem) {
    gameState.randomEventSystem = new RandomEventSystem(gameState);
  }

  const event = gameState.randomEventSystem.triggerRandomEvent(playerId, gameState.currentSeason);
  if (event) {
    gameState.pendingRandomEvent = event;
    // Will be shown to player in next UI update
  }
}
```

- [ ] **Step 3: Add random event system initialization**

Find where GameState is initialized. Add:

```javascript
GameState.randomEventSystem = null; // Will be created when player career mode starts
GameState.pendingRandomEvent = null; // Current event awaiting player decision
```

- [ ] **Step 4: Commit**

```bash
git add league.js
git commit -m "feat(league): integrate random event system into season progression"
```

---

### Task B5: Create Decision Routing for Training Choices

**Files:**
- Modify: `progression.js`

**Implementation:**

- [ ] **Step 1: Find player progression function in progression.js**

Search for where player ratings are updated each season (likely `progressPlayer()` or similar).

- [ ] **Step 2: Check for training decision**

In the progression function, add before rating updates:

```javascript
// Check for training decisions from player career mode
let trainingBonus = 0;
if (gameState.gameMode === 'playerCareer') {
  const recentDecisions = gameState.playerCareerController.decisionHistory.filter(
    d => d.season === gameState.currentSeason && d.type === 'training'
  );
  
  if (recentDecisions.length > 0) {
    const trainingFocus = recentDecisions[0].decision; // e.g., "focus_shooting"
    
    if (trainingFocus === 'focus_shooting' && player.position !== 'C') {
      trainingBonus = 2; // +2 to shooting rating
    } else if (trainingFocus === 'focus_defense') {
      trainingBonus = 2; // +2 to defense rating
    }
    // ... etc for other training types
  }
}

// Apply bonus to rating progression
player.overall = Math.min(player.overall + trainingBonus, 99);
```

- [ ] **Step 3: Commit**

```bash
git add progression.js
git commit -m "feat(progression): integrate training decisions into player progression"
```

---

## Phase B Verification

- [ ] **Random events trigger:** Play through 5+ seasons, verify at least one random event occurs. Event has decision options.
- [ ] **Decisions affect outcome:** Choose different decisions for similar events, verify different outcomes occur.
- [ ] **AI GM offers visible:** When player is drafted/becomes star, verify trade offers are generated (check gameState).
- [ ] **Milestone scenes render:** Reach all-star, retirement, verify scenes display correctly.
- [ ] **Training affects progression:** Choose "focus_shooting" training, verify shooting-related stats increase more than normal.

---

# PHASE C: POLISH (Dialogue Variety, Playoff Gameplay, Transition & Legacy)

## File Structure (Phase C)

**New Files:**
- `ui/randomEventScenes.js` — Render random event dialogue + choices
- `ui/playoffGameplay.js` — Playoff game playing/simming with decision points
- `playerToGMTransition.js` — Manage career-to-GM transition, league state preservation

**Modified Files:**
- `narrativeSystem.js` — Expand dialogue library significantly
- `script.js` — Add playoff gameplay routing
- `ui/nav.js` — Add legacy tracking view (Hall of Fame status, retired player history)

---

## Phase C Tasks

### Task C1: Expand Narrative Dialogue Library

**Files:**
- Modify: `narrativeSystem.js`

**Implementation:**

- [ ] **Step 1: Open narrativeSystem.js**

Find the `initDialogueLibrary()` method.

- [ ] **Step 2: Expand dialogue pools (sample expansion)**

Replace simple dialogue arrays with much larger pools. Example for agent_aggressive:

```javascript
agent_aggressive: [
  "You're a star now. Let's get you max money.",
  "Teams are fighting for you. Capitalize on it.",
  "Time to get paid. You've earned it.",
  "We should be aggressive in negotiations.",
  "Your market value is at an all-time high.",
  "Don't leave money on the table—demand max contract.",
  "Three teams are ready to bid against each other. Let's make them pay.",
  "You proved yourself. Now get compensated.",
  "This is our leverage point. Use it.",
  "Other GMs are calling me daily about you. We're in control.",
  "You're a franchise player now. Act like it.",
  "The market says you're worth $35M+. Let's get it.",
  "Every team in the league wants you. Pick your destination and the money follows.",
  "You earned this opportunity. Don't settle.",
  "Smart teams are terrified of losing you. That's our advantage."
],
```

Continue this pattern for other NPC types (agent_cautious, coach_demanding, coach_supportive, gm_friendly, gm_shrewd, media_standard).

- [ ] **Step 3: Add context-aware dialogue methods**

In NarrativeSystem class, add:

```javascript
getContextualDialogue(npcType, situation, playerStats) {
  // Select dialogue based on player performance and situation
  const key = `${npcType}_${situation}` || npcType;
  const dialogues = this.dialogueLibrary[key] || this.dialogueLibrary[npcType];
  
  if (!dialogues || dialogues.length === 0) {
    return `[${npcType} has nothing to say]`;
  }

  // For better context: if player just had MVP season, pick from different dialogue pool
  if (playerStats.isAllStar && situation === 'contract_negotiation') {
    const starDialogues = dialogues.filter(d => d.includes('star') || d.includes('champion'));
    if (starDialogues.length > 0) {
      return starDialogues[Math.floor(Math.random() * starDialogues.length)];
    }
  }

  return dialogues[Math.floor(Math.random() * dialogues.length)];
}
```

- [ ] **Step 4: Commit**

```bash
git add narrativeSystem.js
git commit -m "feat(narrativeSystem): expand dialogue library with 15+ lines per NPC archetype"
```

---

### Task C2: Create Random Event Scene Renderer

**Files:**
- Create: `ui/randomEventScenes.js`

**Implementation:**

- [ ] **Step 1: Create randomEventScenes.js**

Create `C:\Users\cory\Desktop\nba\ui\randomEventScenes.js`:

```javascript
function renderRandomEventScene(container, event) {
  if (!event) {
    container.innerHTML = '<div class="panel">No event to display</div>';
    return;
  }

  const decisionButtons = event.decisions.map((dec, idx) => `
    <button 
      class="btn btn-primary" 
      onclick="handleEventDecision('${event.id}', ${idx}, '${dec.option}')"
      style="display: block; width: 100%; margin: 10px 0; text-align: left; padding: 15px;"
    >
      ${dec.option}
      <br><small>${getDecisionOutcome(dec.outcome)}</small>
    </button>
  `).join('');

  const html = `
    <div class="view-header"><h2>Season ${event.season} Event</h2></div>
    <div class="panel" style="max-width: 600px;">
      <h3 style="color: #FF6600;">${event.type.replace('_', ' ').toUpperCase()}</h3>
      <p style="font-size: 16px; margin: 20px 0;">${event.description}</p>
      
      <div style="background: #F5F5F5; padding: 15px; border-left: 4px solid #FF6600; margin: 20px 0;">
        <p>${getEventDetailText(event)}</p>
      </div>

      <p style="font-weight: bold; margin: 20px 0;">How do you respond?</p>
      <div>${decisionButtons}</div>
    </div>
  `;

  container.innerHTML = html;
}

function getEventDetailText(event) {
  const details = {
    'controversy': 'The media is scrutinizing your actions. How you respond will shape your reputation.',
    'team_drama': 'There\'s tension in the locker room. Your leadership could help resolve it.',
    'player_struggle': 'You\'re not performing at your usual level. Time to figure out what\'s wrong.'
  };
  return details[event.type] || 'An important decision point has arrived.';
}

function getDecisionOutcome(outcome) {
  const descriptions = {
    'reputation_recovery': 'Recover reputation, low morale hit',
    'media_ignores': 'Media moves on, morale damage',
    'media_conflict': 'Escalates the situation',
    'resolved': 'Team chemistry improves',
    'trade_request': 'Facilitate your own trade',
    'coached_through': 'Coach supports you',
    'recovery': '70% chance to recover this season',
    'rest': '50% chance to recover next season',
    'grit': '30% chance but shows leadership'
  };
  return descriptions[outcome] || 'Outcome TBD';
}

function handleEventDecision(eventId, decisionIdx, decisionText) {
  const event = gameState.pendingRandomEvent;
  if (!event || event.id !== eventId) {
    console.error('Event mismatch');
    return;
  }

  const statusEffect = gameState.randomEventSystem.resolveEventDecision(event, decisionText);
  
  if (statusEffect) {
    // Apply status effects
    const player = gameState.players[event.playerId];
    if (player) {
      player.overall = Math.max(player.overall + statusEffect.statsPenalty, 40);
      // TODO: Apply morale penalty, reputation change, etc.
    }

    // Record decision
    gameState.playerCareerController.recordDecision('event', decisionText, statusEffect.outcome);
  }

  gameState.pendingRandomEvent = null;
  renderView('dashboard');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRandomEventScene };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c ui/randomEventScenes.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add ui/randomEventScenes.js
git commit -m "feat(ui/randomEventScenes): render random event decisions with outcomes"
```

---

### Task C3: Create Player-to-GM Transition Manager

**Files:**
- Create: `playerToGMTransition.js`

**Implementation:**

- [ ] **Step 1: Create playerToGMTransition.js**

Create `C:\Users\cory\Desktop\nba\playerToGMTransition.js`:

```javascript
class PlayerToGMTransition {
  constructor(gameState) {
    this.gameState = gameState;
  }

  prepareTransition(retiredPlayerId) {
    // Called when player retires
    const player = this.gameState.players[retiredPlayerId];
    if (!player) return false;

    // Mark player as retired in league history
    player.careerPhase = 'retired';
    player.contract.teamId = null;
    player.contract.salary = 0;

    // Add to Hall of Fame if eligible
    if (player.careerStats.hallOfFameEligible) {
      if (!this.gameState.hallOfFame) {
        this.gameState.hallOfFame = [];
      }
      this.gameState.hallOfFame.push({
        playerId: retiredPlayerId,
        name: player.name,
        careerStats: player.careerStats,
        retiredInSeason: this.gameState.currentSeason
      });
    }

    // Create legacy record
    this.gameState.playerLegacy = {
      playerId: retiredPlayerId,
      playerName: player.name,
      careerSpan: `Years 1-${this.gameState.currentSeason}`,
      careerStats: player.careerStats,
      hallOfFameEligible: player.careerStats.hallOfFameEligible
    };

    return true;
  }

  transitionToGMMode() {
    // Preserve league state
    const leagueSnapshot = {
      currentSeason: this.gameState.currentSeason,
      teams: JSON.parse(JSON.stringify(this.gameState.teams)),
      players: JSON.parse(JSON.stringify(this.gameState.players)),
      playoffBracket: this.gameState.playoffBracket,
      hallOfFame: this.gameState.hallOfFame,
      playerLegacy: this.gameState.playerLegacy
    };

    // Store for GM mode
    this.gameState.leagueSnapshotFromCareerMode = leagueSnapshot;

    // Switch mode
    this.gameState.gameMode = 'gm_mode';
    this.gameState.playerCareerController = null; // Clear career mode

    return true;
  }

  restoreLeagueSnapshot() {
    // Load league state from career mode into GM mode
    if (!this.gameState.leagueSnapshotFromCareerMode) {
      return false;
    }

    const snapshot = this.gameState.leagueSnapshotFromCareerMode;
    this.gameState.currentSeason = snapshot.currentSeason;
    this.gameState.teams = snapshot.teams;
    this.gameState.players = snapshot.players;
    this.gameState.playoffBracket = snapshot.playoffBracket;
    this.gameState.hallOfFame = snapshot.hallOfFame;
    this.gameState.playerLegacy = snapshot.playerLegacy;

    return true;
  }

  getPlayerLegacySummary() {
    if (!this.gameState.playerLegacy) return null;

    const legacy = this.gameState.playerLegacy;
    return {
      name: legacy.playerName,
      points: legacy.careerStats.totalPoints,
      championships: legacy.careerStats.championships,
      allStars: legacy.careerStats.allStarSelections,
      mvps: legacy.careerStats.mvpAwards,
      hallOfFame: legacy.hallOfFameEligible
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerToGMTransition };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c playerToGMTransition.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add playerToGMTransition.js
git commit -m "feat(playerToGMTransition): implement seamless player-to-GM transition with league state preservation"
```

---

### Task C4: Create Hall of Fame / Legacy View

**Files:**
- Create: `ui/legacyView.js`

**Implementation:**

- [ ] **Step 1: Create legacyView.js**

Create `C:\Users\cory\Desktop\nba\ui\legacyView.js`:

```javascript
function renderLegacyView(container) {
  if (!gameState.playerLegacy) {
    container.innerHTML = '<div class="panel">No player career to display</div>';
    return;
  }

  const legacy = gameState.playerLegacy;
  const hof = legacy.hallOfFameEligible ? '🏆 Hall of Fame Eligible' : '';

  const html = `
    <div class="view-header"><h2>${legacy.playerName}</h2><span class="view-sub">${hof}</span></div>
    
    <div class="panel">
      <div class="panel-header">Career Summary</div>
      <table style="width: 100%;">
        <tr>
          <td><strong>Career Span:</strong></td>
          <td>${legacy.careerSpan}</td>
        </tr>
        <tr>
          <td><strong>Career Points:</strong></td>
          <td>${legacy.careerStats.totalPoints}</td>
        </tr>
        <tr>
          <td><strong>Championships:</strong></td>
          <td>${legacy.careerStats.championships}</td>
        </tr>
        <tr>
          <td><strong>All-Star Selections:</strong></td>
          <td>${legacy.careerStats.allStarSelections}</td>
        </tr>
        <tr>
          <td><strong>MVP Awards:</strong></td>
          <td>${legacy.careerStats.mvpAwards}</td>
        </tr>
      </table>
    </div>

    <div class="panel">
      <p style="text-align: center; font-size: 18px;">A legendary career has concluded.</p>
      <p style="text-align: center; margin-top: 20px;">
        <button class="btn btn-primary" onclick="startGMMode()">Start GM Career</button>
      </p>
    </div>
  `;

  container.innerHTML = html;
}

function startGMMode() {
  const transition = new PlayerToGMTransition(gameState);
  transition.transitionToGMMode();
  transition.restoreLeagueSnapshot();
  renderView('teamSelect');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderLegacyView };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c ui/legacyView.js`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add ui/legacyView.js
git commit -m "feat(ui/legacyView): add player legacy and Hall of Fame display"
```

---

### Task C5: Add Decision UI to Player Dashboard

**Files:**
- Modify: `ui/playerDashboard.js`

**Implementation:**

- [ ] **Step 1: Enhance playerDashboard.js**

Add section for offseason decisions. In the `renderPlayerDashboard()` function, add before closing panel:

```javascript
    <div class="panel">
      <div class="panel-header">Offseason Decisions</div>
      <p><strong>Training Focus:</strong></p>
      <div style="margin: 10px 0;">
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_shooting')">Focus Shooting</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_defense')">Focus Defense</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_athleticism')">Focus Athleticism</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_playmaking')">Focus Playmaking</button>
      </div>

      <p style="margin-top: 20px;"><strong>Contract:</strong></p>
      <div style="margin: 10px 0;">
        <button class="btn btn-ghost" onclick="openContractNegotiation()">Negotiate Contract</button>
      </div>
    </div>
```

Then add handlers at end of file:

```javascript
function recordTrainingDecision(trainingType) {
  const playerId = Object.keys(gameState.players).find(pid => gameState.players[pid].careerPhase !== 'retired');
  gameState.playerCareerController.recordDecision('training', trainingType, 'selected');
  alert(`Training focus: ${trainingType}`);
  // Refresh dashboard
  renderPlayerDashboard(document.querySelector('#mainContent'), playerId);
}

function openContractNegotiation() {
  alert('Contract negotiation UI not yet implemented');
  // TODO: Create contract negotiation scene
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/playerDashboard.js
git commit -m "feat(ui/playerDashboard): add offseason decision buttons"
```

---

## Phase C Verification

- [ ] **Dialogue variety:** Play multiple games/seasons, verify NPC dialogue changes (not identical repeats).
- [ ] **Random events with decisions:** Trigger random event, make decision, verify status effect applied (check player stats before/after).
- [ ] **Playoff gameplay:** (Placeholder OK for now) Verify playoff scene renders when team makes playoffs.
- [ ] **Retirement & transition:** Reach retirement age, trigger retirement scene, verify Hall of Fame eligibility calculated correctly.
- [ ] **GM transition:** Choose "Start GM Career" from legacy view, verify league state is preserved (teams/players have correct state from career mode).
- [ ] **Legacy display:** Hall of Fame section shows retired player correctly.

---

## Full Implementation Verification (End-to-End)

- [ ] **Complete career playthrough:** Create player → play through 10+ seasons → retire → transition to GM → confirm league state is correct
- [ ] **Career stats accumulate:** Career points, all-stars, championships tracked and displayed correctly
- [ ] **Random events don't break game:** Trigger 10+ random events, handle all decision types, no crashes
- [ ] **Narrative moments feel integrated:** Dialogue, scenes, and events flow naturally
- [ ] **GM mode unaffected:** Playing as GM does not show career mode UI; player career mode does not interfere with team management

---

## Success Criteria (Phase A-C Complete)

✅ Custom player creation with badges/traits integration  
✅ College phase narrative with draft night milestone  
✅ Regular seasons with 5 decision types (contracts, trades, training, playoffs, endorsements)  
✅ Random events/controversies with decision trees and status effects  
✅ Varied NPC dialogue (15+ lines per archetype, context-aware)  
✅ Milestone scenes (draft, all-star, playoff, retirement) rendering correctly  
✅ AI GMs recognize player value and generate trade offers  
✅ Training decisions affect stat progression  
✅ Career stats accumulate throughout career (points, all-stars, championships)  
✅ Seamless player-to-GM transition with league state preservation  
✅ Hall of Fame eligibility calculated and displayed  
✅ No regressions to existing GM mode  
✅ Frequent commits (30+ tasks, 30+ commits)

---

## Notes for Implementer

- **Reuse existing patterns:** Study `ui/roster.js`, `ui/tradeCenter.js`, `league.js` structure before implementing new files
- **DRY principle:** Don't duplicate dialogue, event handling, or stat calculation logic
- **Test frequently:** After each task, verify the feature works in isolation (create test player, check if decision properly feeds into league logic, etc.)
- **Commit often:** One commit per task minimum; more for complex logic
- **Context matters:** NPC dialogue and event handling should consider player performance, morale, age, position
