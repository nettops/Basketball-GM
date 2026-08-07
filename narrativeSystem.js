class NarrativeSystem {
  constructor(gameState) {
    this.gameState = gameState;
    this.dialogueLibrary = this.initDialogueLibrary();
    this.npcRelationships = {}; // Track NPC relationships
  }

  // Seeded league rng rather than Math.random, so the same save replays the
  // same lines. See RandomEventSystem._rand for the same reasoning.
  _rand() {
    const rng = this.gameState && this.gameState.rng;
    return rng ? rng() : Math.random();
  }

  initDialogueLibrary() {
    return {
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
        "Every team in the league wants you. Pick your destination and the money follows.",
        "You earned this opportunity. Don't settle.",
        "Smart teams are terrified of losing you. That's our advantage."
      ],
      agent_cautious: [
        "Let's be smart about this long-term.",
        "Security matters more than peak salary.",
        "I want to make sure your career is protected.",
        "We should see what the market looks like first.",
        "Five-year deal gives us stability.",
        "I want to make sure your legacy is protected.",
        "Let's not overreach and price ourselves out of a good fit.",
        "A guaranteed deal beats chasing a bigger number.",
        "We should think about where you'll be happiest, not just paid the most.",
        "Injuries happen. Let's lock something in now.",
        "This isn't the year to gamble on free agency.",
        "Consistency builds a legacy. Let's be patient."
      ],
      coach_demanding: [
        "I need more from you out there.",
        "110% effort every single possession.",
        "You're not playing up to your potential.",
        "Let's get to work in the offseason.",
        "You played soft tonight. We need more.",
        "Effort is a choice. Choose better.",
        "I don't care about the box score, I care about winning.",
        "You're better than that performance.",
        "We need a leader out there, not a passenger.",
        "Get in the gym. This isn't good enough yet."
      ],
      coach_supportive: [
        "You showed great effort out there.",
        "Keep your head up—we'll bounce back.",
        "I believe in you. Keep improving.",
        "That was solid. Let's build on it.",
        "Tough loss. We'll make adjustments and come back stronger.",
        "You're growing every game. Keep at it.",
        "I love the fight you showed tonight.",
        "This team believes in you.",
        "One bad night doesn't define your season.",
        "Proud of how you responded out there."
      ],
      gm_friendly: [
        "We want to build around you here.",
        "You're a centerpiece of our future.",
        "Let's talk about what you need.",
        "You matter to this organization.",
        "We see you as part of this franchise's future.",
        "Whatever it takes to keep you happy here.",
        "You've earned real say in where this team goes.",
        "This city loves you. Let's make it permanent.",
        "We're building the roster around your strengths.",
        "I want you to retire in this jersey."
      ],
      gm_shrewd: [
        "We can make this work for both sides.",
        "Your market value is what it is.",
        "Let's be realistic about numbers.",
        "This is a fair offer based on market.",
        "The cap doesn't lie. Here's what we can do.",
        "We have to balance the whole roster, not just one contract.",
        "This offer reflects your production, not your potential.",
        "Take it or the market decides for you.",
        "Business is business. Let's find the number that works.",
        "We respect what you bring, but there are limits."
      ],
      media_standard: [
        "How are you feeling about your performance?",
        "What's your take on the team's direction?",
        "Big game coming up—ready?",
        "Any thoughts on your playoff chances?",
        "What's been the biggest challenge this season?",
        "How's the chemistry with your new teammates?",
        "Any message for the fans tonight?",
        "What changed for you out there in the second half?",
        "Is there added pressure being the face of this franchise?",
        "What would a championship mean to you right now?"
      ]
    };
  }

  getDialogue(npcType, situation, context = {}) {
    return this.getContextualDialogue(npcType, situation, context);
  }

  // Context-aware pick: falls back to the plain archetype pool, but when the
  // situation and player context line up (e.g. negotiating fresh off a big
  // season) it narrows to lines that actually reference that context so the
  // same NPC doesn't sound identical in every scenario.
  getContextualDialogue(npcType, situation, playerStats) {
    playerStats = playerStats || {};
    const key = situation ? `${npcType}_${situation}` : npcType;
    const dialogues = this.dialogueLibrary[key] || this.dialogueLibrary[npcType];

    if (!dialogues || dialogues.length === 0) {
      return `[${npcType} has nothing to say about ${situation}]`;
    }

    if (playerStats.isStarSeason && situation === 'contract_negotiation') {
      const starDialogues = dialogues.filter(d => /star|market|franchise|earned/i.test(d));
      if (starDialogues.length > 0) {
        return starDialogues[Math.floor(this._rand() * starDialogues.length)];
      }
    }

    return dialogues[Math.floor(this._rand() * dialogues.length)];
  }

  getDialogueOptions(situation) {
    // Return generic options for now; expanded per-situation branching is a
    // future pass — Phase C only needed dialogue variety, not full trees.
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
      lastInteraction: this.gameState.leagueYear,
      topic: topic
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NarrativeSystem };
}
