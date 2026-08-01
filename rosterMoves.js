var _ROSTER_MOVES_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), players: require('./players-2026.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById }, players: { PLAYERS_2026: PLAYERS_2026 } };

function getFreeAgents() {
  return _ROSTER_MOVES_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId === null; });
}

function waivePlayer(playerId) {
  const player = _ROSTER_MOVES_DATA.league.getPlayerById(playerId);
  if (!player.teamId) {
    return { success: false, reason: 'Player is already a free agent.' };
  }
  const roster = _ROSTER_MOVES_DATA.league.getTeamRoster(player.teamId);
  if (roster.length <= 12) {
    return { success: false, reason: 'Waiving would drop the roster below the 12-player minimum.' };
  }
  player.teamId = null;
  return { success: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getFreeAgents: getFreeAgents, waivePlayer: waivePlayer };
}
