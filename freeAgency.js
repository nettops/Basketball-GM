var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), tradeEvaluator: require('./tradeEvaluator.js'), rosterMoves: require('./rosterMoves.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, basePlayerValue: basePlayerValue },
      rosterMoves: { getFreeAgents: getFreeAgents }
    };

// Higher score = more playing-time opportunity: wide open at the position,
// clearly the best there, or buried behind better players.
function playingTimeScore(player, team) {
  const roster = _FA_DATA.league.getTeamRoster(team.id).filter(function (p) { return p.id !== player.id; });
  const samePosition = roster.filter(function (p) { return p.position === player.position; });
  if (samePosition.length === 0) return 1.0;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.overall; }, 0) / samePosition.length;
  if (player.overall > avgAtPosition + 5) return 0.9;
  if (player.overall < avgAtPosition - 10) return 0.2;
  return 0.5;
}

// Master-spec factors: money, contention, playing time, market size, prestige.
// Coach quality is dropped (no coach entities exist). Weights shift with age:
// veterans care relatively more about contention, young players about minutes.
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.35;
  const marketWeight = 0.10;
  const prestigeWeight = 0.15;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  return salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight + marketScore * marketWeight + prestigeScore * prestigeWeight;
}

function estimateFairSalary(player) {
  return Math.max(1200000, (player.overall - 45) * 900000);
}

function generateAIOffer(team, player, rng) {
  if (_FA_DATA.league.getTeamRoster(team.id).length >= 15) return null;
  const capSpace = _FA_DATA.data.CAP_CONSTANTS.SALARY_CAP - _FA_DATA.league.getTeamPayroll(team.id);
  if (capSpace < 1200000) return null;
  const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
  if (interest < 40) return null;
  const fair = estimateFairSalary(player);
  const salary = Math.max(1200000, Math.min(capSpace, Math.round(fair * (0.85 + rng() * 0.3))));
  const years = 1 + Math.floor(rng() * 4);
  return { teamId: team.id, salary: salary, yearsRemaining: years };
}

function signPlayer(player, offer) {
  const roster = _FA_DATA.league.getTeamRoster(offer.teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  player.teamId = offer.teamId;
  player.jerseyNumber = jersey;
  player.contract = { salary: offer.salary, yearsRemaining: offer.yearsRemaining, playerOption: false, teamOption: false };
}

function resolveFreeAgentSilently(player, rng) {
  const offers = _FA_DATA.teams.TEAMS.map(function (t) { return generateAIOffer(t, player, rng); }).filter(Boolean);
  if (offers.length === 0) return null;
  let best = offers[0];
  let bestScore = scoreOffer(player, _FA_DATA.teams.getTeamById(best.teamId), best);
  for (let i = 1; i < offers.length; i++) {
    const score = scoreOffer(player, _FA_DATA.teams.getTeamById(offers[i].teamId), offers[i]);
    if (score > bestScore) { best = offers[i]; bestScore = score; }
  }
  signPlayer(player, best);
  return best;
}

// Resolves every current free agent, best (highest base value) first — so
// stars sign before the depth-piece market resolves against whatever cap
// space is left, same as how real free agency tends to play out.
function runFreeAgencySilently(rng) {
  const pool = _FA_DATA.rosterMoves.getFreeAgents().slice()
    .sort(function (a, b) { return _FA_DATA.tradeEvaluator.basePlayerValue(b) - _FA_DATA.tradeEvaluator.basePlayerValue(a); });
  const results = [];
  pool.forEach(function (player) {
    const offer = resolveFreeAgentSilently(player, rng);
    if (offer) results.push({ playerId: player.id, teamId: offer.teamId, salary: offer.salary });
  });
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playingTimeScore: playingTimeScore,
    scoreOffer: scoreOffer,
    estimateFairSalary: estimateFairSalary,
    generateAIOffer: generateAIOffer,
    signPlayer: signPlayer,
    resolveFreeAgentSilently: resolveFreeAgentSilently,
    runFreeAgencySilently: runFreeAgencySilently
  };
}
