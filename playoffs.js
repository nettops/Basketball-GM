var _PLAYOFF_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js') }
  : { data: { CONFERENCES: CONFERENCES }, teams: { TEAMS: TEAMS } };

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getPlayoffSeeds: getPlayoffSeeds, createSeries: createSeries, generateBracket: generateBracket, ROUND1_SEED_PAIRS: ROUND1_SEED_PAIRS };
}
