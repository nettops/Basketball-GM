// players.js/teams.js don't require league.js back, so these are safe to load eagerly.
var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js'), teams: require('./teams.js') }
  : { players: { PLAYERS_2026: PLAYERS_2026 }, teams: { getTeamById: getTeamById, TEAMS: TEAMS } };

// simEngine.js/fatigue.js/injuries.js all require league.js back (for getTeamRoster),
// so eagerly requiring them here at module-load time would deadlock on the cycle —
// whichever side loads first gets an incomplete, still-empty module.exports from the
// other. Resolving them lazily, only when simulateDate() actually runs, sidesteps the
// cycle entirely: by call time every module has finished loading.
function _simDeps() {
  return (typeof require !== 'undefined')
    ? { simEngine: require('./simEngine.js'), fatigue: require('./fatigue.js'), injuries: require('./injuries.js') }
    : {
        simEngine: { getActiveEngine: getActiveEngine },
        fatigue: { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest },
        injuries: { rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame }
      };
}

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

function simulateDate(season, dayIndex, settings, rng, onDayComplete) {
  const deps = _simDeps();
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
  const newInjuries = [];

  todaysGames.forEach(function (game) {
    const engine = deps.simEngine.getActiveEngine(settings);
    const result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);

    game.played = true;
    game.homeScore = result.homeScore;
    game.awayScore = result.awayScore;
    game.boxScore = result.boxScore;

    recordGameResult(game);

    if (result.boxScore) {
      Object.keys(result.boxScore).forEach(function (playerId) {
        accumulateSeasonStats(playerId, result.boxScore[playerId]);
      });
      const minutesByPlayerId = {};
      Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
      const isBackToBackHome = season.games.some(function (g) { return g.played && (g.homeTeamId === game.homeTeamId || g.awayTeamId === game.homeTeamId) && g.day === dayIndex - 1; });
      const isBackToBackAway = season.games.some(function (g) { return g.played && (g.homeTeamId === game.awayTeamId || g.awayTeamId === game.awayTeamId) && g.day === dayIndex - 1; });
      deps.fatigue.applyFatigueForGame(game.homeTeamId, minutesByPlayerId, isBackToBackHome);
      deps.fatigue.applyFatigueForGame(game.awayTeamId, minutesByPlayerId, isBackToBackAway);
    }

    [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
      deps.injuries.decrementInjuriesForTeamGame(teamId);
      getTeamRoster(teamId).forEach(function (p) {
        const wasInjured = !!p.status.injury;
        deps.injuries.rollInjury(p, rng);
        if (!wasInjured && p.status.injury) {
          newInjuries.push({ playerId: p.id, teamId: teamId, severity: p.status.injury.severity });
        }
      });
      playingTeamIds[teamId] = true;
    });
  });

  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      deps.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  if (onDayComplete) onDayComplete(dayIndex, todaysGames, newInjuries);
  return todaysGames;
}

function getNextGameDay(season, teamId, afterDay) {
  const upcoming = season.games
    .filter(function (g) { return !g.played && g.day > afterDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; });
  return upcoming.length > 0 ? upcoming[0].day : null;
}

function simulateNextDay(season, currentDay, settings, rng, onDayComplete) {
  const nextDay = currentDay + 1;
  simulateDate(season, nextDay, settings, rng, onDayComplete);
  return nextDay;
}

function simulateThroughDate(season, currentDay, targetDay, settings, rng, onDayComplete) {
  let day = currentDay;
  while (day < targetDay) {
    day += 1;
    simulateDate(season, day, settings, rng, onDayComplete);
  }
  return day;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEASON_STAT_KEYS: SEASON_STAT_KEYS,
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages,
    simulateDate: simulateDate,
    getNextGameDay: getNextGameDay,
    simulateNextDay: simulateNextDay,
    simulateThroughDate: simulateThroughDate
  };
}
