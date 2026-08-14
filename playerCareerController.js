// Maps a career-mode archetype key to the attribute-offset archetype used by
// makeAttributes() (players-2026.js) so custom players get a realistic 20-key
// attribute spread instead of just overall/potential.
const CAREER_ARCHETYPE_ATTR_MAP = {
  scorer: 'primary_scorer',
  defender: 'three_and_d',
  playmaker: 'playmaker',
  rebounder: 'rim_protector',
  all_around: 'veteran_glue'
};

class PlayerCareerController {
  constructor(gameState) {
    this.gameState = gameState;
    this.controlledPlayerId = null;
    this.careerPhase = null;
    this.careerEvents = [];
    this.decisionHistory = [];
    this.randomEventHistory = [];
  }

  // `selectedBadges` is gone: badges now MEAN hiddenTraits, and a second inert
  // array called "badges" was a trap. When career mode is un-parked, badge
  // selection should seed the trait roll instead of living beside it.
  createCustomPlayer(name, position, college, archetype, selectedTraits) {
    const archetypeData = PLAYER_ARCHETYPES[archetype];
    if (!archetypeData) {
      throw new Error(`Invalid archetype: ${archetype}`);
    }

    const attrArchetype = CAREER_ARCHETYPE_ATTR_MAP[archetype] || 'veteran_glue';

    // recordGameResult (league.js) only zero-fills SEASON_STAT_KEYS the first
    // time it sees a falsy player.seasonStats — a pre-set {gamesPlayed: 0}
    // with the rest of the keys missing skips that init and every stat
    // accumulates as NaN, so all keys must start at 0 here.
    const seasonStats = { gamesPlayed: 0 };
    SEASON_STAT_KEYS.forEach(function (k) { seasonStats[k] = 0; });

    // Hoisted out of the literal: makeAttributes now seeds a player's
    // per-attribute variation from their id, so the id has to exist before the
    // attributes are built rather than being assigned alongside them.
    const playerId = this.generatePlayerId();

    const player = {
      id: playerId,
      teamId: null,
      name: name,
      position: position,
      college: college,
      dateOfBirth: null,
      age: 22, // Draft age
      heightIn: 78,
      weightLb: 210,
      jerseyNumber: null,
      yearsPro: 0,
      // startingOverall/startingPotential are authored on the same pre-rescale
      // scale as players-2026.js's 450 judgments, so they go through the same
      // affine map — otherwise a created rookie outranks the whole league.
      // The attributes are anchored on the UNSCALED value, because
      // makeAttributes applies the map itself.
      //
      // `overall` is NOT stored. It was, and that made a career-mode player the
      // one player in the league whose overall could disagree with his own
      // attributes — the exact bug ratings.js exists to prevent. defineOverall
      // installs it (and rawOverall) as getters just below.
      potential: rescaleAnchor(archetypeData.startingPotential),
      attributes: makeAttributes(archetypeData.startingOverall, attrArchetype, playerId),
      traits: selectedTraits, // Array of trait strings
      hiddenTraits: [],
      hiddenPersonality: {},
      hiddenTendencies: {},
      status: { morale: 70, fatigue: 0, injury: null },
      contract: {
        salary: 0,
        yearsRemaining: 0,
        playerOption: false,
        teamOption: false
      },
      seasonStats: seasonStats,
      isCustomPlayer: true,
      careerPhase: "college"
    };
    // Makes the created player a real player: `overall` and `rawOverall` become
    // derived getters over the attributes above, exactly as every generated
    // player gets them. Without this the player has no rawOverall at all, and
    // every sim-facing read of it returns undefined — which surfaced as
    // evaluatePlayerValue returning NaN.
    defineOverall(player);

    // Populates player.careerStats/awardsWon/championshipsWon/peakOverall/etc.
    // using the same shape the rest of the league (history.js, awards.js,
    // roster UI) already reads/writes for every player — a career-mode
    // player must look identical to a generated one to the season/award
    // pipeline, or season rollups and roster display break on field mismatch.
    ensureCareerData([player]);

    PLAYERS_2026.push(player);
    // Browser-only file (reads page globals throughout); the guard keeps any
    // future Node require from tripping on it.
    if (typeof invalidateLeagueAvgCache === 'function') invalidateLeagueAvgCache();

    return player;
  }

  setControlledPlayer(playerId) {
    this.controlledPlayerId = playerId;
  }

  getCurrentCareerPhase() {
    if (!this.controlledPlayerId) return null;
    const player = getPlayerById(this.controlledPlayerId);
    return player ? player.careerPhase : null;
  }

  recordDecision(type, decision, outcome) {
    // type: "contract" | "trade" | "training" | "playoff" | "endorsement"
    const record = {
      season: this.gameState.leagueYear,
      type: type,
      decision: decision,
      outcome: outcome,
      timestamp: Date.now()
    };
    this.decisionHistory.push(record);
  }

  getCareerStats() {
    if (!this.controlledPlayerId) return null;
    const player = getPlayerById(this.controlledPlayerId);
    return player ? player.careerStats : null;
  }

  triggerRetirement() {
    if (!this.controlledPlayerId) return;
    const player = getPlayerById(this.controlledPlayerId);
    if (!player) return;
    player.careerPhase = "retired";

    const hallOfFameEligible = this.calculateHOFEligibility(player);

    this.careerEvents.push({
      type: "retired",
      season: this.gameState.leagueYear,
      hallOfFameEligible: hallOfFameEligible
    });
  }

  calculateHOFEligibility(player) {
    return computeHofScore(player) >= HOF_THRESHOLD;
  }

  generatePlayerId() {
    return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export for use in game
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerCareerController };
}
