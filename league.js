var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js'), teams: require('./teams.js') }
  : { players: { PLAYERS_2026: PLAYERS_2026 }, teams: { getTeamById: getTeamById } };

function getTeamRoster(teamId) {
  return _LEAGUE_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId === teamId; });
}

function getTeamPayroll(teamId) {
  return getTeamRoster(teamId).reduce(function (sum, p) { return sum + p.contract.salary; }, 0);
}

function getPlayerById(playerId) {
  return _LEAGUE_DATA.players.PLAYERS_2026.find(function (p) { return p.id === playerId; });
}

const SEASON_STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'minutes'];

function recordGameResult(game) {
  const homeTeam = _LEAGUE_DATA.teams.getTeamById(game.homeTeamId);
  const awayTeam = _LEAGUE_DATA.teams.getTeamById(game.awayTeamId);
  homeTeam.record.pointsFor = (homeTeam.record.pointsFor || 0) + game.homeScore;
  homeTeam.record.pointsAgainst = (homeTeam.record.pointsAgainst || 0) + game.awayScore;
  awayTeam.record.pointsFor = (awayTeam.record.pointsFor || 0) + game.awayScore;
  awayTeam.record.pointsAgainst = (awayTeam.record.pointsAgainst || 0) + game.homeScore;
  if (game.homeScore > game.awayScore) {
    homeTeam.record.wins += 1;
    awayTeam.record.losses += 1;
  } else {
    awayTeam.record.wins += 1;
    homeTeam.record.losses += 1;
  }
}

function accumulateSeasonStats(playerId, statLine) {
  const player = getPlayerById(playerId);
  if (!player.seasonStats) {
    player.seasonStats = { gamesPlayed: 0 };
    SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] = 0; });
  }
  player.seasonStats.gamesPlayed += 1;
  SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] += statLine[k] || 0; });
}

function getPlayerAverages(player) {
  const s = player.seasonStats;
  if (!s || s.gamesPlayed === 0) {
    return { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };
  }
  return {
    ppg: s.points / s.gamesPlayed,
    rpg: s.rebounds / s.gamesPlayed,
    apg: s.assists / s.gamesPlayed,
    spg: s.steals / s.gamesPlayed,
    bpg: s.blocks / s.gamesPlayed,
    fgPct: s.fga > 0 ? s.fgm / s.fga : 0,
    tpPct: s.tpa > 0 ? s.tpm / s.tpa : 0,
    ftPct: s.fta > 0 ? s.ftm / s.fta : 0,
    mpg: s.minutes / s.gamesPlayed
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages
  };
}
