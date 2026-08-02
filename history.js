var _HISTORY_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      players: require('./players-2026.js'),
      awards: require('./awards.js')
    }
  : {
      league: {
        SEASON_STAT_KEYS: SEASON_STAT_KEYS,
        getPlayerAverages: getPlayerAverages,
        getTeamRoster: getTeamRoster,
        getPlayerById: getPlayerById
      },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      players: { PLAYERS_2026: PLAYERS_2026 },
      awards: { computeSeasonAwards: computeSeasonAwards }
    };

const LEAGUE_HISTORY = {
  retiredPlayers: [],
  trades: [],
  draftClasses: [],
  awardsHistory: [],
  champions: []
};

const ZERO_AVERAGES = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };

function ensureCareerData(players) {
  players.forEach(function (p) {
    if (!p.careerStats) {
      p.careerStats = { gamesPlayed: 0, seasonsPlayed: 0 };
      _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { p.careerStats[key] = 0; });
    }
    if (!p.awardsWon) p.awardsWon = [];
    if (p.peakOverall === undefined) p.peakOverall = p.overall;
    if (p.championshipsWon === undefined) p.championshipsWon = 0;
    if (!p.teamsPlayedFor) p.teamsPlayedFor = p.teamId ? [p.teamId] : [];
    if (!p.bestSeasonTotals) p.bestSeasonTotals = { points: 0, rebounds: 0, assists: 0 };
    if (!p.lastSeasonAverages) p.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData
  };
}
