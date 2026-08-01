var _DRAFT_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js'), tradeEvaluator: require('./tradeEvaluator.js'), league: require('./league.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById }, tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }, league: { getTeamRoster: getTeamRoster } };

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

function selectAIPick(teamId, availableProspects) {
  const team = _DRAFT_DATA.teams.getTeamById(teamId);
  let best = availableProspects[0];
  let bestValue = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(best, team);
  for (let i = 1; i < availableProspects.length; i++) {
    const value = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(availableProspects[i], team);
    if (value > bestValue) { best = availableProspects[i]; bestValue = value; }
  }
  return best;
}

function rookieSalary(pickNumber) {
  if (pickNumber <= 30) {
    return Math.round(10000000 - (pickNumber - 1) * (7500000 / 29));
  }
  const secondRoundSlot = pickNumber - 30;
  return Math.round(2200000 - (secondRoundSlot - 1) * (1100000 / 29));
}

function rookieYears(pickNumber) {
  return pickNumber <= 30 ? 4 : 2;
}

function executePick(teamId, prospect, pickNumber) {
  const roster = _DRAFT_DATA.league.getTeamRoster(teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;

  prospect.teamId = teamId;
  prospect.jerseyNumber = jersey;
  prospect.yearsPro = 0;
  prospect.contract = { salary: rookieSalary(pickNumber), yearsRemaining: rookieYears(pickNumber), playerOption: false, teamOption: false };
}

function runDraft(draftOrder, prospectPool) {
  const results = [];
  let available = prospectPool.slice();

  function runRound(order, round, pickOffset) {
    order.forEach(function (teamId, i) {
      const pickNumber = pickOffset + i + 1;
      const prospect = selectAIPick(teamId, available);
      executePick(teamId, prospect, pickNumber);
      available = available.filter(function (p) { return p.id !== prospect.id; });
      results.push({ teamId: teamId, prospect: prospect, pickNumber: pickNumber, round: round });
    });
  }

  runRound(draftOrder.firstRound, 1, 0);
  runRound(draftOrder.secondRound, 2, 30);

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weightedDrawWithoutReplacement: weightedDrawWithoutReplacement,
    lotteryWeight: lotteryWeight,
    getPlayoffFinishOrder: getPlayoffFinishOrder,
    buildDraftOrder: buildDraftOrder,
    selectAIPick: selectAIPick,
    rookieSalary: rookieSalary,
    rookieYears: rookieYears,
    executePick: executePick,
    runDraft: runDraft
  };
}
