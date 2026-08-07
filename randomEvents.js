class RandomEventSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.eventPool = this.initEventPool();
  }

  // Draws from the seeded league rng (save.js captures and restores its exact
  // position) instead of Math.random, so reloading a save and replaying an
  // offseason produces the same events. Falls back to Math.random only if no
  // rng exists yet, which is the pre-initSeason case.
  _rand() {
    const rng = this.gameState && this.gameState.rng;
    return rng ? rng() : Math.random();
  }

  initEventPool() {
    return [
      {
        type: 'controversy',
        triggers: ['off_court_incident', 'media_blowup', 'teammate_conflict'],
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
        baseDescription: "You're not playing up to your usual level",
        decisions: [
          { option: 'Work harder in practice', outcome: 'recovery', statsPenalty: -1, recoveryChance: 0.7 },
          { option: 'Take time off', outcome: 'rest', statsPenalty: -2, recoveryChance: 0.5 },
          { option: 'Push through', outcome: 'grit', statsPenalty: -3, recoveryChance: 0.3 }
        ]
      }
    ];
  }

  // 10-15% chance per season an event triggers
  triggerRandomEvent(playerId, season) {
    if (this._rand() > 0.12) return null;

    const eventType = this.eventPool[Math.floor(this._rand() * this.eventPool.length)];
    const trigger = eventType.triggers[Math.floor(this._rand() * eventType.triggers.length)];

    return {
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
