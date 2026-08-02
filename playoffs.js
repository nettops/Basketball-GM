var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), league: require('./league.js'), morale: require('./morale.js') }
  : {
      data: { CONFERENCES: CONFERENCES },
      teams: { TEAMS: TEAMS },
      simEngine: { getActiveEngine: getActiveEngine },
      league: { recordGameResult: recordGameResult, accumulateSeasonStats: accumulateSeasonStats },
      morale: { tickMoraleForTeamGame: tickMoraleForTeamGame }
    };

function getPlayoffSeeds(conference) {
  const confTeams = _PLAYOFF_DATA.teams.TEAMS.filter(function (t) { return t.conference === conference; });
  return confTeams.slice().sort(function (a, b) {
    if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
    const diffA = (a.record.pointsFor || 0) - (a.record.pointsAgainst || 0);
    const diffB = (b.record.pointsFor || 0) - (b.record.pointsAgainst || 0);
    if (diffB !== diffA) return diffB - diffA;
    return a.id.localeCompare(b.id);
  }).slice(0, 8);
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

function generateBracket() {
  const bracket = { first: [], semis: [], confFinals: [], finals: [] };
  _PLAYOFF_DATA.data.CONFERENCES.forEach(function (conf) {
    const seeds = getPlayoffSeeds(conf);
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
    getCurrentRoundSeries: getCurrentRoundSeries
  };
}
