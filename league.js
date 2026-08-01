var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? require('./players-2026.js')
  : { PLAYERS_2026: PLAYERS_2026 };

function getTeamRoster(teamId) {
  return _LEAGUE_DATA.PLAYERS_2026.filter(function (p) { return p.teamId === teamId; });
}

function getTeamPayroll(teamId) {
  return getTeamRoster(teamId).reduce(function (sum, p) { return sum + p.contract.salary; }, 0);
}

function getPlayerById(playerId) {
  return _LEAGUE_DATA.PLAYERS_2026.find(function (p) { return p.id === playerId; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById };
}
