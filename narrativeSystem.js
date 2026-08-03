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
      lastInteraction: this.gameState.leagueYear,
      topic: topic
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NarrativeSystem };
}
