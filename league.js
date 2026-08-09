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
    ? { simEngine: require('./simEngine.js'), fatigue: require('./fatigue.js'), injuries: require('./injuries.js'), morale: require('./morale.js'), finances: require('./finances.js'), gameSim: require('./gameSim.js'), rng: require('./rng.js') }
    : {
        simEngine: { getActiveEngine: getActiveEngine },
        fatigue: { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest },
        injuries: { rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame, INJURY_SEVERITY_TIER: INJURY_SEVERITY_TIER, GAMES_TO_DAYS: GAMES_TO_DAYS },
        morale: { tickMoraleForTeamGame: tickMoraleForTeamGame },
        finances: { tickFinancesForTeamGame: tickFinancesForTeamGame },
        // gameSim.js requires simEnginePossession.js, which requires this
        // file back for getTeamRoster — so it belongs here in the LAZY block
        // for exactly the reason described above, not in _LEAGUE_DATA.
        gameSim: { createGameSim: createGameSim },
        rng: { makeRng: makeRng }
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

// oppFga/oppFgm accumulate across the season because DFG% is meaningless per
// game — five defended shots is noise. Season totals are what make it readable.
const SEASON_STAT_KEYS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'minutes', 'oppFga', 'oppFgm'];

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

// Lazily required for the same reason _simDeps() is: careerHistory.js
// requires league.js back (for SEASON_STAT_KEYS/getPlayerAverages), so an
// eager require here would deadlock on the cycle at module-load time.
function _historyDeps() {
  return (typeof require !== 'undefined')
    ? { careerHistory: require('./careerHistory.js') }
    : {
        careerHistory: {
          checkAndUpdateCareerHighs: checkAndUpdateCareerHighs,
          recordInjuryInHistory: recordInjuryInHistory,
          recordInjuryReturn: recordInjuryReturn
        }
      };
}

function accumulateSeasonStats(playerId, statLine) {
  const player = getPlayerById(playerId);
  if (!player.seasonStats) {
    player.seasonStats = { gamesPlayed: 0 };
    SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] = 0; });
    // A brand-new season's stats have not been banked into careerStats yet.
    // generateNewSeason clears this too; belt and braces, because whichever
    // runs first, a fresh stat line must never be treated as already counted.
    player.seasonStatsRolled = false;
  }
  player.seasonStats.gamesPlayed += 1;
  SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] += statLine[k] || 0; });
  _historyDeps().careerHistory.checkAndUpdateCareerHighs(player, statLine);
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

// godMode.js requires league.js back (getTeamRoster), so this is resolved
// lazily like _simDeps()/_workerDeps() to avoid a load-order deadlock.
function _godModeDeps() {
  return (typeof require !== 'undefined')
    ? require('./godMode.js')
    : { applyAutoWin: applyAutoWin };
}

// Shared by simulateDate (sync) and simulateDateAsync (worker-backed) —
// everything AFTER a game's result is known (bookkeeping: score recording,
// finances, season stats, fatigue, morale, injuries) is identical either
// way; only HOW `result` was obtained differs between the two callers. A
// single shared implementation means the two paths can't drift out of sync
// with each other over time.
function applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng) {
  _godModeDeps().applyAutoWin(game.homeTeamId, game.awayTeamId, result, rng);
  game.played = true;
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.boxScore = result.boxScore;
  // Only the possession engine produces this (simEngineBoxScore.js's
  // simulateGame result has no playByPlay field, so this is undefined —
  // and stays undefined — for games simmed under that engine).
  game.playByPlay = result.playByPlay || null;

  recordGameResult(game);

  const homeWon = game.homeScore > game.awayScore;
  deps.finances.tickFinancesForTeamGame(game.homeTeamId, homeWon, _LEAGUE_DATA.teams.getTeamById);
  deps.finances.tickFinancesForTeamGame(game.awayTeamId, !homeWon, _LEAGUE_DATA.teams.getTeamById);

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
    deps.morale.tickMoraleForTeamGame(game.homeTeamId, homeWon, minutesByPlayerId);
    deps.morale.tickMoraleForTeamGame(game.awayTeamId, !homeWon, minutesByPlayerId);
  }

  [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
    const rosterBeforeDecrement = getTeamRoster(teamId).map(function (p) {
      return { player: p, injuryBefore: p.status.injury };
    });
    deps.injuries.decrementInjuriesForTeamGame(teamId);
    rosterBeforeDecrement.forEach(function (entry) {
      if (entry.injuryBefore && !entry.player.status.injury) {
        const actualRecoveryDays = entry.injuryBefore.gamesOut * deps.injuries.GAMES_TO_DAYS;
        _historyDeps().careerHistory.recordInjuryReturn(entry.player, leagueYear, actualRecoveryDays);
      }
    });
    getTeamRoster(teamId).forEach(function (p) {
      const wasInjured = !!p.status.injury;
      deps.injuries.rollInjury(p, rng);
      if (!wasInjured && p.status.injury) {
        newInjuries.push({ playerId: p.id, teamId: teamId, severity: p.status.injury.severity });
        const tier = deps.injuries.INJURY_SEVERITY_TIER[p.status.injury.severity] || 'minor';
        const estimatedRecoveryDays = p.status.injury.gamesOut >= 999 ? null : p.status.injury.gamesOut * deps.injuries.GAMES_TO_DAYS;
        const record = _historyDeps().careerHistory.recordInjuryInHistory(p, 'In-game injury', tier, estimatedRecoveryDays, leagueYear);
        if (record) record.gamesOut = p.status.injury.gamesOut;
      }
    });
    playingTeamIds[teamId] = true;
  });
}

function simulateDate(season, dayIndex, settings, rng, onDayComplete, watchOptions) {
  const deps = _simDeps();
  const leagueYear = (settings && settings.leagueYear) || 2026;
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
  const newInjuries = [];

  todaysGames.forEach(function (game) {
    // The watched game (Watch Next Game — ui/pixelGameView.js) always sims
    // through the possession engine regardless of the active engine setting:
    // a game simmed without possessions can't be watched. Event capture is
    // proven drift-free by scripts/validate-pixel-events.js, so the recorded
    // result is a normal possession-engine result.
    let result;
    if (watchOptions && watchOptions.live && game.id === watchOptions.gameId) {
      // Live-watched: create the sim, do NOT step it, do NOT record anything.
      // The view steps it (under user decisions) and calls finish() below.
      //
      // Its own rng, seeded by ONE draw from the league rng: stepping happens
      // over minutes of wall clock, interleaved with autosaves, so a watched
      // game sharing the league rng would make the league's future depend on
      // when the user happened to click, and would let a mid-watch save
      // capture an rng state from inside a game that was never recorded.
      const watchRng = deps.rng.makeRng(Math.floor(rng() * 2147483647));
      const sim = deps.gameSim.createGameSim(game.homeTeamId, game.awayTeamId, watchRng,
        { events: watchOptions.events });
      let finished = false;
      watchOptions.liveGame = {
        sim: sim,
        game: game,
        finish: function () {
          if (finished) return false;
          finished = true;
          const lateInjuries = [];
          const latePlaying = {};
          applyGameResult(game, sim.result(), deps, season, dayIndex, leagueYear, latePlaying, lateInjuries, rng);
          // The day's other results already went to the feed when this
          // function's caller returned; this game's news lands when it is
          // actually decided, which is also when the user learns it.
          if (onDayComplete) onDayComplete(dayIndex, [game], lateInjuries);
          return true;
        }
      };
      playingTeamIds[game.homeTeamId] = true;
      playingTeamIds[game.awayTeamId] = true;
      return;
    }
    if (watchOptions && !watchOptions.live && game.id === watchOptions.gameId) {
      const watchEngine = deps.simEngine.getActiveEngine({ simEngine: 'possession' });
      result = watchEngine.simulateGame(game.homeTeamId, game.awayTeamId, rng, { events: watchOptions.events });
    } else {
      const engine = deps.simEngine.getActiveEngine(settings);
      result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);
    }
    applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng);
  });

  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      deps.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  if (onDayComplete) onDayComplete(dayIndex, todaysGames, newInjuries);
  return todaysGames;
}

// Worker-backed twin of simulateDate — see simWorkerClient.js's module
// comment for the full rationale and the correctness argument for why
// dispatching games to the worker strictly one-at-a-time (never in
// parallel) keeps this bit-for-bit equivalent to the synchronous path.
// Browser-only (simWorkerClient.js's isWorkerSimAvailable/simulateGameViaWorker
// aren't defined for Node) and always opt-in — ui/simControls.js only calls
// this when GameState.settings.useWorkerSim is on AND a Worker is available;
// every existing caller of simulateDate/simulateThroughDate is completely
// unaffected by this function's mere existence.
function _workerDeps() {
  return (typeof require !== 'undefined')
    ? require('./simWorkerClient.js')
    : { simulateGameViaWorker: simulateGameViaWorker };
}

async function simulateDateAsync(season, dayIndex, settings, rng, onDayComplete) {
  const deps = _simDeps();
  const worker = _workerDeps();
  const leagueYear = (settings && settings.leagueYear) || 2026;
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
  const newInjuries = [];

  for (let i = 0; i < todaysGames.length; i++) {
    const game = todaysGames[i];
    const result = await worker.simulateGameViaWorker(game.homeTeamId, game.awayTeamId, rng, settings, getTeamRoster, _LEAGUE_DATA.teams.getTeamById);
    applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng);
  }

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

// Worker-backed twin of simulateThroughDate — see simulateDateAsync above.
async function simulateThroughDateAsync(season, currentDay, targetDay, settings, rng, onDayComplete) {
  let day = currentDay;
  while (day < targetDay) {
    day += 1;
    await simulateDateAsync(season, day, settings, rng, onDayComplete);
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
    simulateDateAsync: simulateDateAsync,
    getNextGameDay: getNextGameDay,
    simulateNextDay: simulateNextDay,
    simulateThroughDate: simulateThroughDate,
    simulateThroughDateAsync: simulateThroughDateAsync
  };
}
