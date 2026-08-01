var _DRAFT_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById } };

function weightedDrawWithoutReplacement(candidates, weightFn, count, rng) {
  let pool = candidates.map(function (c) { return { c: c, w: weightFn(c) }; });
  const picks = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce(function (s, p) { return s + p.w; }, 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    picks.push(pool[idx].c);
    pool.splice(idx, 1);
  }
  return picks;
}

function lotteryWeight(team) {
  return Math.pow(30 - team.record.wins, 2);
}

// Worse playoff finish -> earlier pick. Ties within the same elimination round
// broken by regular-season wins ascending (worse record picks first).
function getPlayoffFinishOrder(bracket) {
  const eliminatedInRound = {};
  bracket.first.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 0; });
  bracket.semis.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 1; });
  bracket.confFinals.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 2; });
  const finals = bracket.finals[0];
  eliminatedInRound[finals.winner === finals.higherSeed ? finals.lowerSeed : finals.higherSeed] = 3;
  eliminatedInRound[finals.winner] = 4;

  return Object.keys(eliminatedInRound).sort(function (a, b) {
    if (eliminatedInRound[a] !== eliminatedInRound[b]) return eliminatedInRound[a] - eliminatedInRound[b];
    return _DRAFT_DATA.teams.getTeamById(a).record.wins - _DRAFT_DATA.teams.getTeamById(b).record.wins;
  });
}

function buildDraftOrder(bracket, rng) {
  const playoffTeamIds = new Set(getPlayoffFinishOrder(bracket));
  const lotteryTeams = _DRAFT_DATA.teams.TEAMS.filter(function (t) { return !playoffTeamIds.has(t.id); });

  const top4 = weightedDrawWithoutReplacement(lotteryTeams, lotteryWeight, 4, rng);
  const top4Ids = new Set(top4.map(function (t) { return t.id; }));
  const remainingLottery = lotteryTeams.filter(function (t) { return !top4Ids.has(t.id); })
    .sort(function (a, b) { return a.record.wins - b.record.wins; });

  const firstRound = top4.map(function (t) { return t.id; })
    .concat(remainingLottery.map(function (t) { return t.id; }))
    .concat(getPlayoffFinishOrder(bracket));

  // Second round: straight reverse full-season record for all 30 teams, no lottery.
  const secondRound = _DRAFT_DATA.teams.TEAMS.slice()
    .sort(function (a, b) { return a.record.wins - b.record.wins; })
    .map(function (t) { return t.id; });

  return { firstRound: firstRound, secondRound: secondRound };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weightedDrawWithoutReplacement: weightedDrawWithoutReplacement,
    lotteryWeight: lotteryWeight,
    getPlayoffFinishOrder: getPlayoffFinishOrder,
    buildDraftOrder: buildDraftOrder
  };
}
