var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS }
    };

function clampRating(v) {
  return Math.max(_COMMISSIONER_DATA.data.RATING_MIN, Math.min(_COMMISSIONER_DATA.data.RATING_MAX, v));
}

function editPlayerRatings(playerId, changes) {
  const player = _COMMISSIONER_DATA.league.getPlayerById(playerId);
  if (!player) return { success: false, reason: 'Player not found.' };
  if (changes.overall !== undefined) player.overall = clampRating(changes.overall);
  if (changes.potential !== undefined) player.potential = clampRating(changes.potential);
  if (changes.attributes) {
    Object.keys(changes.attributes).forEach(function (key) {
      if (_COMMISSIONER_DATA.data.ATTRIBUTE_KEYS.indexOf(key) === -1) return;
      player.attributes[key] = clampRating(changes.attributes[key]);
    });
  }
  return { success: true };
}

function deletePlayer(playerId) {
  const idx = _COMMISSIONER_DATA.players.PLAYERS_2026.findIndex(function (p) { return p.id === playerId; });
  if (idx === -1) return { success: false, reason: 'Player not found.' };
  _COMMISSIONER_DATA.players.PLAYERS_2026.splice(idx, 1);
  return { success: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { editPlayerRatings: editPlayerRatings, deletePlayer: deletePlayer };
}
