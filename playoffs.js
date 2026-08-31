var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), league: require('./league.js'), morale: require('./morale.js'), godMode: require('./godMode.js'), gameSim: require('./gameSim.js'), rng: require('./rng.js') }
  : {
      data: { CONFERENCES: CONFERENCES },
      teams: { TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      league: { recordGameResult: recordGameResult, accumulateSeasonStats: accumulateSeasonStats },
      morale: { tickMoraleForTeamGame: tickMoraleForTeamGame },
      godMode: { applyAutoWin: applyAutoWin },
      // Unlike league.js, the eager block is correct here: nothing gameSim.js
      // pulls in requires playoffs.js back, so there is no cycle to defer.
      gameSim: { createGameSim: createGameSim },
      rng: { makeRng: makeRng }
    };

// FINISHED PLAYOFF GAMES, waiting to be filed into the season.
//
// Every playoff game was being simulated, counted towards records and season
// stats, and then dropped on the floor: nothing kept the game object, so there
// was no playoff box score anywhere in the app to show. save.js has always
// round-tripped `isPlayoff` and `seriesId` on season games and always pruned
// box scores to the user's own — the format expected these all along; nothing
// ever put one there.
//
// A drain buffer rather than a season reference because playoffs.js has no
// business knowing about GameState, and because it covers all three paths that
// finish a game with one mechanism: an ordinary series game, a play-in game,
// and a live-watched game that finishes minutes later when the user stops
// coaching it.
let _finishedPlayoffGames = [];

function filePlayoffGame(game) {
  // No id here on purpose. Ids have to be unique across the whole season and
  // numeric like the schedule's own, and only the caller filing these into the
  // season can see the ids already in use. A first version minted 'po-1' here
  // and the Schedule view silently stopped expanding: its click handler reads
  // the id with Number(), which turns 'po-1' into NaN, and NaN matches nothing
  // — not even itself.
  game.played = true;
  _finishedPlayoffGames.push(game);
}

// Hands over everything finished since the last call, and forgets it. The
// caller appends them to the season so the schedule (which already expands any
// played game into a box score) picks them up with no new UI.
function drainFinishedPlayoffGames() {
  const out = _finishedPlayoffGames;
  _finishedPlayoffGames = [];
  return out;
}

function getPlayoffSeeds(conference, count) {
  const confTeams = _PLAYOFF_DATA.teams.TEAMS.filter(function (t) { return t.conference === conference; });
  return confTeams.slice().sort(function (a, b) {
    if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
    const diffA = (a.record.pointsFor || 0) - (a.record.pointsAgainst || 0);
    const diffB = (b.record.pointsFor || 0) - (b.record.pointsAgainst || 0);
    if (diffB !== diffA) return diffB - diffA;
    return a.id.localeCompare(b.id);
  }).slice(0, count || 8);
}

// Single-game (not best-of-7) sim, reusing the same result/stats/morale
// plumbing as simulateSeriesGame but with no series object to update.
function simulatePlayInGame(homeTeamId, awayTeamId, settings, rng) {
  const engine = _PLAYOFF_DATA.simEngine.getActiveEngine(settings);
  const result = engine.simulateGame(homeTeamId, awayTeamId, rng);
  const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, homeScore: result.homeScore, awayScore: result.awayScore, boxScore: result.boxScore, isPlayoff: true, isPlayIn: true, seriesId: null };

  _PLAYOFF_DATA.league.recordGameResult(game, {
    leagueYear: (settings && settings.leagueYear) || 2026, day: null
  });
  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      _PLAYOFF_DATA.league.accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
    const minutesByPlayerId = {};
    Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
    const homeWon = result.homeScore > result.awayScore;
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(homeTeamId, homeWon, minutesByPlayerId);
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(awayTeamId, !homeWon, minutesByPlayerId);
  }
  game.round = 'Play-In';
  filePlayoffGame(game);
  return game;
}

// Real NBA play-in format: 7 seed hosts 8 seed, winner takes the 7 seed
// outright; 9 seed hosts 10 seed, loser is eliminated; the 7-vs-8 loser then
// hosts the 9-vs-10 winner for the final 8 seed. All three games are single
// elimination, not best-of-7 series.
function resolvePlayInForConference(conference, settings, rng) {
  const seeds = getPlayoffSeeds(conference, 10);
  const seed7 = seeds[6], seed8 = seeds[7], seed9 = seeds[8], seed10 = seeds[9];

  const game1 = simulatePlayInGame(seed7.id, seed8.id, settings, rng);
  const winner1 = game1.homeScore > game1.awayScore ? seed7 : seed8;
  const loser1 = winner1 === seed7 ? seed8 : seed7;

  const game2 = simulatePlayInGame(seed9.id, seed10.id, settings, rng);
  const winner2 = game2.homeScore > game2.awayScore ? seed9 : seed10;

  const game3 = simulatePlayInGame(loser1.id, winner2.id, settings, rng);
  const finalEighth = game3.homeScore > game3.awayScore ? loser1 : winner2;

  return { seventhSeed: winner1, eighthSeed: finalEighth, games: [game1, game2, game3] };
}

// DELIBERATE, NOT A BUG: simulatePlayInGame above and simulateSeriesGame below
// both route through league.js's recordGameResult and accumulateSeasonStats, so
// postseason results roll into team.record and player.seasonStats rather than
// into separate playoff totals. That means standings, allTimeWins, prestige,
// next year's lastSeasonWins, draft lottery weights, and the award races in
// awards.js all reflect regular season PLUS postseason. This is the intended
// simplification for this project — there is no separate playoffRecord /
// playoffStats anywhere. Don't "fix" it without changing that decision first.
let _seriesIdCounter = 0;
function createSeries(higherSeedTeamId, lowerSeedTeamId, roundName) {
  _seriesIdCounter += 1;
  return {
    id: 'series-' + _seriesIdCounter,
    // Carried so a finished game can say which round it belongs to without
    // anything having to search the bracket for its own series.
    round: roundName || 'Playoffs',
    higherSeed: higherSeedTeamId,
    lowerSeed: lowerSeedTeamId,
    winsHigher: 0,
    winsLower: 0,
    winner: null,
    complete: false
  };
}

// Standard bracket pairing by seed index (0 = 1-seed .. 7 = 8-seed):
// Round 1: 0v7, 3v4, 2v5, 1v6 — keeps the 1 and 2 seeds apart until the conference finals.
const ROUND1_SEED_PAIRS = [[0, 7], [3, 4], [2, 5], [1, 6]];

// rng/settings are optional and only needed when settings.playInEnabled is
// set — every existing caller that omits them keeps the original
// straight-top-8-seeds behavior unchanged.
function generateBracket(rng, settings) {
  const bracket = { first: [], semis: [], confFinals: [], finals: [], playIn: null };
  const playInEnabled = !!(settings && settings.playInEnabled && rng);
  _PLAYOFF_DATA.data.CONFERENCES.forEach(function (conf) {
    let seeds;
    if (playInEnabled) {
      // Snapshot the top 6 BEFORE playing any play-in games — those games
      // mutate the participating teams' win/loss records via recordGameResult,
      // which could otherwise reshuffle a seed-6/seed-7 team that was close
      // in the standings if queried again afterward.
      const topSix = getPlayoffSeeds(conf, 10).slice(0, 6);
      const resolved = resolvePlayInForConference(conf, settings, rng);
      seeds = topSix.concat([resolved.seventhSeed, resolved.eighthSeed]);
      if (!bracket.playIn) bracket.playIn = {};
      bracket.playIn[conf] = resolved;
    } else {
      seeds = getPlayoffSeeds(conf);
    }
    ROUND1_SEED_PAIRS.forEach(function (pair) {
      bracket.first.push(createSeries(seeds[pair[0]].id, seeds[pair[1]].id, 'Round 1'));
    });
  });
  return bracket;
}

// Higher seed hosts games 1, 2, 5, 7; lower seed hosts games 3, 4, 6 (standard 2-2-1-1-1 format).
const HOME_PATTERN = ['higher', 'higher', 'lower', 'lower', 'higher', 'lower', 'higher'];

function isSeriesComplete(series) {
  return series.winsHigher === 4 || series.winsLower === 4;
}

// watchOptions, when supplied as { teamId, events }, makes THIS game sim
// through the possession engine with structured event capture if it involves
// teamId — the playoff twin of league.js's simulateDate watch path, and the
// same reasoning applies: a game simmed without possessions can't be watched.
function simulateSeriesGame(series, settings, rng, watchOptions) {
  const gameNumber = series.winsHigher + series.winsLower; // 0-indexed into HOME_PATTERN
  const homeIsHigher = HOME_PATTERN[gameNumber] === 'higher';
  const homeTeamId = homeIsHigher ? series.higherSeed : series.lowerSeed;
  const awayTeamId = homeIsHigher ? series.lowerSeed : series.higherSeed;

  const watched = !!(watchOptions && watchOptions.events &&
    (homeTeamId === watchOptions.teamId || awayTeamId === watchOptions.teamId));

  // Live-watched: hand back an unstepped sim and defer everything that
  // records the game. The series (and therefore the bracket) must not move
  // until the game is actually decided, so all of it goes in finish().
  if (watched && watchOptions.live) {
    const watchRng = _PLAYOFF_DATA.rng.makeRng(Math.floor(rng() * 2147483647));
    const sim = _PLAYOFF_DATA.gameSim.createGameSim(homeTeamId, awayTeamId, watchRng,
      { events: watchOptions.events });
    const pending = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, isPlayoff: true, seriesId: series.id };
    let finished = false;
    watchOptions.liveGame = {
      sim: sim,
      game: pending,
      finish: function () {
        if (finished) return false;
        finished = true;
        recordSeriesGameResult(series, pending, sim.result(), homeIsHigher, rng,
          (settings && settings.leagueYear) || 2026);
        return true;
      }
    };
    return null;
  }

  const engine = watched
    ? _PLAYOFF_DATA.simEngine.getActiveEngine({ simEngine: 'possession' })
    : _PLAYOFF_DATA.simEngine.getActiveEngine(settings);
  const result = watched
    ? engine.simulateGame(homeTeamId, awayTeamId, rng, { events: watchOptions.events })
    : engine.simulateGame(homeTeamId, awayTeamId, rng);
  const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, isPlayoff: true, seriesId: series.id };
  recordSeriesGameResult(series, game, result, homeIsHigher, rng,
    (settings && settings.leagueYear) || 2026);
  return game;
}

// Everything that turns a simulated result into a recorded playoff game.
// Extracted so the live-watched path can run it later — after the user has
// finished coaching the game — without duplicating any of it.
function recordSeriesGameResult(series, game, result, homeIsHigher, rng, leagueYear) {
  _PLAYOFF_DATA.godMode.applyAutoWin(game.homeTeamId, game.awayTeamId, result, rng);
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.boxScore = result.boxScore;
  game.playByPlay = result.playByPlay || null;

  // day is null on every playoff path: there is no schedule day index once the
  // regular season is over, and inventing one would put a wrong number on a
  // permanent record. The season year is what the Feats page reads.
  _PLAYOFF_DATA.league.recordGameResult(game, { leagueYear: leagueYear || 2026, day: null });
  const homeWon = result.homeScore > result.awayScore;
  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      _PLAYOFF_DATA.league.accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
    const minutesByPlayerId = {};
    Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(game.homeTeamId, homeWon, minutesByPlayerId);
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(game.awayTeamId, !homeWon, minutesByPlayerId);
  }

  const higherWonThisGame = homeWon === homeIsHigher;
  if (higherWonThisGame) series.winsHigher += 1; else series.winsLower += 1;

  // After the win counts move, so gameNumber reads 1..7 for this series.
  game.round = series.round;
  game.gameNumber = series.winsHigher + series.winsLower;
  filePlayoffGame(game);

  if (isSeriesComplete(series)) {
    series.complete = true;
    series.winner = series.winsHigher === 4 ? series.higherSeed : series.lowerSeed;
  }

  return game;
}

function advanceBracketIfRoundComplete(bracket) {
  function allComplete(round) { return round.length > 0 && round.every(function (s) { return s.complete; }); }

  if (bracket.semis.length === 0 && allComplete(bracket.first)) {
    // Winners of series 0&1 face each other, winners of series 2&3 face each other,
    // within each conference (bracket.first is [E0,E1,E2,E3, W0,W1,W2,W3]).
    for (let confStart = 0; confStart < 8; confStart += 4) {
      bracket.semis.push(createSeries(bracket.first[confStart].winner, bracket.first[confStart + 1].winner, 'Conf Semis'));
      bracket.semis.push(createSeries(bracket.first[confStart + 2].winner, bracket.first[confStart + 3].winner, 'Conf Semis'));
    }
  } else if (bracket.confFinals.length === 0 && allComplete(bracket.semis)) {
    for (let confStart = 0; confStart < 4; confStart += 2) {
      bracket.confFinals.push(createSeries(bracket.semis[confStart].winner, bracket.semis[confStart + 1].winner, 'Conf Finals'));
    }
  } else if (bracket.finals.length === 0 && allComplete(bracket.confFinals)) {
    bracket.finals.push(createSeries(bracket.confFinals[0].winner, bracket.confFinals[1].winner, 'Finals'));
  }
}

function getCurrentRoundSeries(bracket) {
  if (bracket.finals.length > 0 && !bracket.finals[0].complete) return bracket.finals;
  if (bracket.finals.length > 0 && bracket.finals[0].complete) return null; // whole bracket done
  if (bracket.confFinals.length > 0 && !bracket.confFinals.every(function (s) { return s.complete; })) return bracket.confFinals;
  if (bracket.semis.length > 0 && !bracket.semis.every(function (s) { return s.complete; })) return bracket.semis;
  return bracket.first;
}

function simulateNextPlayoffGame(bracket, settings, rng, watchOptions) {
  const round = getCurrentRoundSeries(bracket);
  if (!round) return null; // champion already crowned

  const activeSeries = round.find(function (s) { return !s.complete; });
  if (!activeSeries) {
    advanceBracketIfRoundComplete(bracket);
    return simulateNextPlayoffGame(bracket, settings, rng, watchOptions);
  }

  const game = simulateSeriesGame(activeSeries, settings, rng, watchOptions);
  if (watchOptions && watchOptions.liveGame) {
    // The bracket cannot advance past a game that has not been played yet.
    // The caller advances it after calling liveGame.finish().
    return null;
  }
  advanceBracketIfRoundComplete(bracket);
  return game;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPlayoffSeeds: getPlayoffSeeds,
    createSeries: createSeries,
    generateBracket: generateBracket,
    ROUND1_SEED_PAIRS: ROUND1_SEED_PAIRS,
    simulateNextPlayoffGame: simulateNextPlayoffGame,
    drainFinishedPlayoffGames: drainFinishedPlayoffGames,
    simulateSeriesGame: simulateSeriesGame,
    advanceBracketIfRoundComplete: advanceBracketIfRoundComplete,
    getCurrentRoundSeries: getCurrentRoundSeries,
    resolvePlayInForConference: resolvePlayInForConference,
    simulatePlayInGame: simulatePlayInGame
  };
}
