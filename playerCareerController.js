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
