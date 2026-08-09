// Player-value evaluation and trade-interest tracking for teams reacting to
// the career-mode controlled player. Reads directly off the live PLAYERS_2026/
// TEAMS globals (same objects GM mode operates on) rather than a private copy.
class PlayerAwarenessModule {
  constructor(gameState) {
    this.gameState = gameState;
    this.teamInterest = {}; // teamId -> 0-1 interest score
  }

  evaluatePlayerValue(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return 0;

    // rawOverall: the age adjustments below are additive constants tuned
    // against the raw scale, and the display scale would silently reweight them.
    let value = player.rawOverall;

    if (player.age >= 24 && player.age <= 28) {
      value += 10;
    } else if (player.age > 32) {
      value -= 15;
    }

    const mvpCount = (player.awardsWon || []).filter(a => a.award === AWARD_KEYS.MVP).length;
    const allNbaCount = (player.awardsWon || []).filter(a =>
      a.award === AWARD_KEYS.ALL_NBA_1 || a.award === AWARD_KEYS.ALL_NBA_2 || a.award === AWARD_KEYS.ALL_NBA_3
    ).length;
    value += mvpCount * 10 + allNbaCount * 5 + (player.championshipsWon || 0) * 8;

    return Math.min(Math.max(Math.round(value), 0), 100);
  }

  generateTradeOffers(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return [];

    const playerValue = this.evaluatePlayerValue(playerId);
    const offers = [];
    const nTeams = Math.floor(playerValue / 20); // higher value = more suitors

    const candidates = TEAMS.filter(t => t.id !== player.teamId).slice(0, nTeams);
    candidates.forEach(team => {
      offers.push({
        fromTeamId: team.id,
        playerId: playerId,
        contractOffer: {
          salary: 15000000 + playerValue * 100000,
          years: 3 + Math.floor(playerValue / 25)
        },
        chance: Math.min(1, 0.5 + playerValue / 100)
      });
    });

    return offers;
  }

  reactToPlayerDecision(playerId, decision) {
    const player = getPlayerById(playerId);
    if (!player) return;

    if (decision.type === 'playoff_performance' && decision.outcome === 'excellent') {
      Object.keys(this.teamInterest).forEach(teamId => {
        this.teamInterest[teamId] = Math.min((this.teamInterest[teamId] || 0) + 0.10, 1.0);
      });
    }

    if (decision.type === 'morale' && decision.outcome === 'unhappy' && player.teamId) {
      this.teamInterest[player.teamId] = Math.max((this.teamInterest[player.teamId] || 0.5) - 0.20, 0);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerAwarenessModule };
}
