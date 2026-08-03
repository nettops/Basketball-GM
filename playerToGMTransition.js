// Handles career-mode retirement archival and the switch back to GM mode.
// There's no separate "league snapshot" to copy: PLAYERS_2026/TEAMS/LEAGUE_HISTORY
// are the same live objects GM mode already reads, so "transition" just means
// archiving the retiree into league history and flipping GameState's mode flags.
class PlayerToGMTransition {
  constructor(gameState) {
    this.gameState = gameState;
  }

  retirePlayer(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return null;

    const record = archiveRetiree(player, this.gameState.leagueYear || 2026);
    player.careerPhase = 'retired';

    const idx = PLAYERS_2026.indexOf(player);
    if (idx !== -1) PLAYERS_2026.splice(idx, 1);

    this.gameState.playerLegacy = record;
    return record;
  }

  transitionToGMMode() {
    this.gameState.gameMode = null;
    this.gameState.playerCareerController = null;
    this.gameState.narrativeSystem = null;
    this.gameState.playMode = this.gameState.userTeamId ? 'gm' : 'spectator';
    return true;
  }

  getPlayerLegacySummary() {
    if (!this.gameState.playerLegacy) return null;
    const legacy = this.gameState.playerLegacy;
    return {
      name: legacy.name,
      points: legacy.careerStats.points,
      rebounds: legacy.careerStats.rebounds,
      assists: legacy.careerStats.assists,
      championships: legacy.championshipsWon,
      hallOfFame: legacy.hallOfFame
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerToGMTransition };
}
