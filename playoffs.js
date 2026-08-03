var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), league: require('./league.js'), morale: require('./morale.js') }
  : {
      data: { CONFERENCES: CONFERENCES },
      teams: { TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      league: { recordGameResult: recordGameResult, accumulateSeasonStats: accumulateSeasonStats },
      morale: { tickMoraleForTeamGame: tickMoraleForTeamGame }
    };

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

  _PLAYOFF_DATA.league.recordGameResult(game);
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

let _seriesIdCounter = 0;
function createSeries(higherSeedTeamId, lowerSeedTeamId) {
  _seriesIdCounter += 1;
  return {
    id: 'series-' + _seriesIdCounter,
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
      bracket.first.push(createSeries(seeds[pair[0]].id, seeds[pair[1]].id));
    });
  });
  return bracket;
}

// Higher seed hosts games 1, 2, 5, 7; lower seed hosts games 3, 4, 6 (standard 2-2-1-1-1 format).
const HOME_PATTERN = ['higher', 'higher', 'lower', 'lower', 'higher', 'lower', 'higher'];

function isSeriesComplete(series) {
  return series.winsHigher === 4 || series.winsLower === 4;
}

function simulateSeriesGame(series, settings, rng) {
  const gameNumber = series.winsHigher + series.winsLower; // 0-indexed into HOME_PATTERN
  const homeIsHigher = HOME_PATTERN[gameNumber] === 'higher';
  const homeTeamId = homeIsHigher ? series.higherSeed : series.lowerSeed;
  const awayTeamId = homeIsHigher ? series.lowerSeed : series.higherSeed;

  const engine = _PLAYOFF_DATA.simEngine.getActiveEngine(settings);
  const result = engine.simulateGame(homeTeamId, awayTeamId, rng);
  const game = { homeTeamId: homeTeamId, awayTeamId: awayTeamId, homeScore: result.homeScore, awayScore: result.awayScore, boxScore: result.boxScore, isPlayoff: true, seriesId: series.id };

  _PLAYOFF_DATA.league.recordGameResult(game);
  const homeWon = result.homeScore > result.awayScore;
  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      _PLAYOFF_DATA.league.accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
    const minutesByPlayerId = {};
    Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(homeTeamId, homeWon, minutesByPlayerId);
    _PLAYOFF_DATA.morale.tickMoraleForTeamGame(awayTeamId, !homeWon, minutesByPlayerId);
  }

  const higherWonThisGame = homeWon === homeIsHigher;
  if (higherWonThisGame) series.winsHigher += 1; else series.winsLower += 1;

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
      bracket.semis.push(createSeries(bracket.first[confStart].winner, bracket.first[confStart + 1].winner));
      bracket.semis.push(createSeries(bracket.first[confStart + 2].winner, bracket.first[confStart + 3].winner));
    }
  } else if (bracket.confFinals.length === 0 && allComplete(bracket.semis)) {
    for (let confStart = 0; confStart < 4; confStart += 2) {
      bracket.confFinals.push(createSeries(bracket.semis[confStart].winner, bracket.semis[confStart + 1].winner));
    }
  } else if (bracket.finals.length === 0 && allComplete(bracket.confFinals)) {
    bracket.finals.push(createSeries(bracket.confFinals[0].winner, bracket.confFinals[1].winner));
  }
}

function getCurrentRoundSeries(bracket) {
  if (bracket.finals.length > 0 && !bracket.finals[0].complete) return bracket.finals;
  if (bracket.finals.length > 0 && bracket.finals[0].complete) return null; // whole bracket done
  if (bracket.confFinals.length > 0 && !bracket.confFinals.every(function (s) { return s.complete; })) return bracket.confFinals;
  if (bracket.semis.length > 0 && !bracket.semis.every(function (s) { return s.complete; })) return bracket.semis;
  return bracket.first;
}

function simulateNextPlayoffGame(bracket, settings, rng) {
  const round = getCurrentRoundSeries(bracket);
  if (!round) return null; // champion already crowned

  const activeSeries = round.find(function (s) { return !s.complete; });
  if (!activeSeries) {
    advanceBracketIfRoundComplete(bracket);
    return simulateNextPlayoffGame(bracket, settings, rng);
  }

  const game = simulateSeriesGame(activeSeries, settings, rng);
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
    getCurrentRoundSeries: getCurrentRoundSeries,
    resolvePlayInForConference: resolvePlayInForConference,
    simulatePlayInGame: simulatePlayInGame
  };
}
