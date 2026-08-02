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

const MILESTONE_THRESHOLDS = {
  points: [10000, 20000, 30000],
  rebounds: [5000, 10000],
  assists: [5000, 10000]
};
const MILESTONE_STAT_LABELS = { points: 'career points', rebounds: 'career rebounds', assists: 'career assists' };

function checkMilestones(player, beforeTotals, feedSink) {
  Object.keys(MILESTONE_THRESHOLDS).forEach(function (statKey) {
    MILESTONE_THRESHOLDS[statKey].forEach(function (threshold) {
      if (beforeTotals[statKey] < threshold && player.careerStats[statKey] >= threshold) {
        feedSink(player.name + ' reaches ' + threshold.toLocaleString() + ' ' + MILESTONE_STAT_LABELS[statKey] + '.');
      }
    });
  });
}

function rollSeasonIntoCareerStats(player, feedSink) {
  const sink = feedSink || function () {};
  ensureCareerData([player]);
  player.peakOverall = Math.max(player.peakOverall, player.overall);
  if (player.teamId && player.teamsPlayedFor.indexOf(player.teamId) === -1) {
    player.teamsPlayedFor.push(player.teamId);
  }

  if (!player.seasonStats || player.seasonStats.gamesPlayed === 0) {
    player.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
    return;
  }

  player.lastSeasonAverages = _HISTORY_DATA.league.getPlayerAverages(player);

  ['points', 'rebounds', 'assists'].forEach(function (key) {
    if (player.seasonStats[key] > player.bestSeasonTotals[key]) {
      player.bestSeasonTotals[key] = player.seasonStats[key];
    }
  });

  const beforeTotals = { points: player.careerStats.points, rebounds: player.careerStats.rebounds, assists: player.careerStats.assists };
  player.careerStats.gamesPlayed += player.seasonStats.gamesPlayed;
  player.careerStats.seasonsPlayed += 1;
  _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) {
    player.careerStats[key] += player.seasonStats[key] || 0;
  });

  checkMilestones(player, beforeTotals, sink);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats
  };
}
