var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), tradeEvaluator: require('./tradeEvaluator.js'), rosterMoves: require('./rosterMoves.js'), careerHistory: require('./careerHistory.js'), finances: require('./finances.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap, getEffectiveSalaryFloor: getEffectiveSalaryFloor },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, basePlayerValue: basePlayerValue },
      rosterMoves: { getFreeAgents: getFreeAgents },
      careerHistory: { recordContractInHistory: recordContractInHistory },
      finances: { budgetSpendMultiplier: budgetSpendMultiplier, ARENA_MAX_TIER: ARENA_MAX_TIER }
    };

// Higher score = more playing-time opportunity: wide open at the position,
// clearly the best there, or buried behind better players.
function playingTimeScore(player, team) {
  const roster = _FA_DATA.league.getTeamRoster(team.id).filter(function (p) { return p.id !== player.id; });
  const samePosition = roster.filter(function (p) { return p.position === player.position; });
  if (samePosition.length === 0) return 1.0;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.rawOverall; }, 0) / samePosition.length;
  if (player.rawOverall > avgAtPosition + 5) return 0.9;
  if (player.rawOverall < avgAtPosition - 10) return 0.2;
  return 0.5;
}

// This team's current-season win% as a "hype" factor — separate from and
// more current than the timeline label below (a "win-now" team mid-slump
// isn't actually the hot destination its timeline classification implies).
function hypeScore(team) {
  const r = team.record;
  const gp = (r.wins || 0) + (r.losses || 0);
  if (gp < 5) return 0.5; // too early in the season to mean anything, stay neutral
  return r.wins / gp;
}

// Arena tier (finances.js's upgrade track, 1-5) as a facilities factor — a
// player choosing between two similar offers leans toward the nicer building.
function facilitiesScore(team) {
  const tier = (team.finances && team.finances.arenaTier) || 1;
  return (tier - 1) / (_FA_DATA.finances.ARENA_MAX_TIER - 1);
}

// A team that traded this player away at some point in his career left a
// mark — re-signing with them isn't the same as signing somewhere fresh.
// Only ever a mild penalty (this isn't meant to make reunions impossible,
// just a little less appealing than a clean-slate offer).
function tradedAwayPenalty(player, team) {
  const trades = player.careerHistory && player.careerHistory.trades;
  if (!trades || trades.length === 0) return 0;
  return trades.some(function (t) { return t.fromTeam === team.id; }) ? 1 : 0;
}

// 8-factor mood model: money, contention (timeline), current-season hype,
// playing time, market size, prestige, facilities, being traded away by this
// exact team before — plus hidden personality modifiers layered on top.
// There's no tracked "previous team" once a contract expires (teamId is
// wiped in decrementContracts), so Loyalty is modeled as "doesn't need max
// money to be satisfied" rather than an incumbent-team discount; Ambition
// amplifies how much contention matters; Ego penalizes offers implying a
// diminished role.
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const hype = hypeScore(team);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);
  const facilities = facilitiesScore(team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.32;
  const marketWeight = 0.08;
  const prestigeWeight = 0.12;
  const facilitiesWeight = 0.06;
  const hypeWeight = 0.08;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight - facilitiesWeight - hypeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  let score = salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight +
    marketScore * marketWeight + prestigeScore * prestigeWeight + facilities * facilitiesWeight + hype * hypeWeight;

  score -= tradedAwayPenalty(player, team) * 0.05;

  const personality = player.hiddenPersonality;
  if (personality && personality.loyalty !== undefined) {
    score += (1 - salaryScore) * (personality.loyalty - 50) / 100 * 0.06;
    score += (contentionScore - 0.5) * (personality.ambition - 50) / 100 * 0.16;
    if (ptScore < 0.5) {
      score -= Math.max(0, (personality.ego - 50) / 100) * 0.10;
    }
  }

  return score;
}

// Morale nudges what a player considers a fair asking price: an unhappy
// player (low morale, wherever it came from — bench time, a losing record,
// an unwanted trade) just wants a good situation and will take less; a happy
// player knows their worth and holds out for a premium. `roundsUnsigned`
// (0 by default) is how many resolution rounds this player has already gone
// through the open market without a deal — each round shaves a bit more off
// the ask, so a name still unsigned after several rounds gets realistic
// about their market rather than holding out forever (see
// runFreeAgencySilently's multi-round loop).
function estimateFairSalary(player, roundsUnsigned) {
  const base = Math.max(1200000, (player.rawOverall - 45) * 900000);
  const morale = (player.status && player.status.morale !== undefined) ? player.status.morale : 70;
  const moraleMultiplier = 0.85 + (morale / 100) * 0.3;
  const decayMultiplier = Math.max(0.6, 1 - (roundsUnsigned || 0) * 0.08);
  return Math.round(base * moraleMultiplier * decayMultiplier);
}

// Rebuilding teams shouldn't behave like a win-now team's free agency
// department — a young core doesn't need veteran depth crowding out
// developmental minutes. Skipped only for players who don't fit a youth
// movement (established veterans); a young free agent still gets a normal
// look even from a rebuilding team.
const REBUILDING_SKIP_CHANCE = 0.9;
const REBUILDING_SKIP_AGE_THRESHOLD = 27;

function generateAIOffer(team, player, rng, roundsUnsigned) {
  if (_FA_DATA.league.getTeamRoster(team.id).length >= 15) return null;
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
  const payroll = _FA_DATA.league.getTeamPayroll(team.id);
  const capSpace = _FA_DATA.data.getEffectiveSalaryCap(capLevel) - payroll;
  if (!capDisabled && capSpace < 1200000) return null;

  // A team still below the salary floor needs to keep spending regardless of
  // owner mood or marginal interest — it's on the hook for the shortfall as
  // a floor tax at season end either way (finances.js's applySeasonEndFinances),
  // so it may as well spend that money on a roster spot instead.
  const belowFloor = payroll < _FA_DATA.data.getEffectiveSalaryFloor(capLevel);
  const spendMultiplier = belowFloor ? 1 : _FA_DATA.finances.budgetSpendMultiplier(team);

  if (!belowFloor && team.timeline === 'rebuilding' && player.age >= REBUILDING_SKIP_AGE_THRESHOLD && rng() < REBUILDING_SKIP_CHANCE) return null;

  const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
  if (interest < (belowFloor ? 25 : 40)) return null;
  const fair = estimateFairSalary(player, roundsUnsigned);
  const budgetCappedSpace = capDisabled ? Infinity : capSpace * spendMultiplier;
  // Clamped to the space actually available. The old Math.max(1200000, ...)
  // ran last, so when budgetCappedSpace came in under the minimum it handed
  // back a $1.2M offer the team couldn't fit — the one place the cap check
  // above could be silently overrun.
  const desired = Math.min(budgetCappedSpace, Math.round(fair * (0.85 + rng() * 0.3)));
  const salary = capDisabled ? Math.max(1200000, desired) : Math.max(1200000, Math.min(desired, capSpace));
  const years = 1 + Math.floor(rng() * 4);
  return { teamId: team.id, salary: salary, yearsRemaining: years };
}

const ROSTER_FLOOR = 12;

// Nothing else guarantees an AI team ends free agency legal. decrementContracts
// can drop a team to any size, generateAIOffer above declines anyone under its
// interest bar, and autoEnforceRosterSize only ever ran against the user's team
// — so a team could sit below 12 indefinitely, at which point validateRosterSizes
// (trade.js) rejects every trade it proposes for the rest of the save.
// Minimum-salary signings, interest bar bypassed, worst-off teams served first.
function enforceRosterFloors() {
  const signings = [];
  const short = _FA_DATA.teams.TEAMS
    .filter(function (t) { return _FA_DATA.league.getTeamRoster(t.id).length < ROSTER_FLOOR; })
    .sort(function (a, b) {
      return _FA_DATA.league.getTeamRoster(a.id).length - _FA_DATA.league.getTeamRoster(b.id).length;
    });

  short.forEach(function (team) {
    while (_FA_DATA.league.getTeamRoster(team.id).length < ROSTER_FLOOR) {
      const pool = _FA_DATA.rosterMoves.getFreeAgents();
      if (pool.length === 0) return;
      const best = pool.slice().sort(function (a, b) {
        return _FA_DATA.tradeEvaluator.adjustedPlayerValue(b, team) - _FA_DATA.tradeEvaluator.adjustedPlayerValue(a, team);
      })[0];
      signPlayer(best, { teamId: team.id, salary: 1200000, yearsRemaining: 1 });
      signings.push({ playerId: best.id, teamId: team.id });
    }
  });
  return signings;
}

function signPlayer(player, offer) {
  const roster = _FA_DATA.league.getTeamRoster(offer.teamId);
  const team = _FA_DATA.teams.getTeamById(offer.teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }).concat((team && team.retiredNumbers) || []));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  const contractType = player.teamId === offer.teamId ? 're_signing' : 'free_agency';
  player.teamId = offer.teamId;
  player.jerseyNumber = jersey;
  player.contract = { salary: offer.salary, yearsRemaining: offer.yearsRemaining, playerOption: false, teamOption: false };
  // GameState is a browser global from script.js — guarded since freeAgency.js
  // also runs standalone under Node in scripts/validate-offseason.js.
  const leagueYear = typeof GameState !== 'undefined' ? (GameState.leagueYear || 2026) : undefined;
  _FA_DATA.careerHistory.recordContractInHistory(player, leagueYear, offer.salary, offer.yearsRemaining, offer.teamId, contractType);
  // Landing a new deal is a positive event regardless of whether it's a
  // fresh signing or a re-signing with the incumbent team.
  if (player.status && player.status.morale !== undefined) {
    player.status.morale = Math.min(100, player.status.morale + 4);
  }
  // pushToFeed is a browser-global from script.js — guarded since freeAgency.js
  // also runs standalone under Node in scripts/validate-offseason.js.
  if (typeof pushToFeed === 'function') {
    const team = _FA_DATA.teams.getTeamById(offer.teamId);
    pushToFeed(player.name + ' signs with ' + team.name + ' ($' + offer.salary.toLocaleString() + '/yr, ' +
      offer.yearsRemaining + ' yr' + (offer.yearsRemaining === 1 ? '' : 's') + ')');
  }
}

function resolveFreeAgentSilently(player, rng, roundsUnsigned) {
  const offers = _FA_DATA.teams.TEAMS.map(function (t) { return generateAIOffer(t, player, rng, roundsUnsigned); }).filter(Boolean);
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
// space is left, same as how real free agency tends to play out. Runs
// multiple rounds over whoever's still unsigned: a player who gets no
// offers in round 1 (asking price too high, or every interested team's cap
// space/skip logic passed) comes back in round 2 with estimateFairSalary's
// demand decay already lowering the bar, same as a real free agent
// recalibrating expectations as the market thins out.
const MAX_FREE_AGENCY_ROUNDS = 4;

function runFreeAgencySilently(rng) {
  let pool = _FA_DATA.rosterMoves.getFreeAgents().slice()
    .sort(function (a, b) { return _FA_DATA.tradeEvaluator.basePlayerValue(b) - _FA_DATA.tradeEvaluator.basePlayerValue(a); });
  const results = [];
  for (let round = 0; round < MAX_FREE_AGENCY_ROUNDS && pool.length > 0; round++) {
    const stillUnsigned = [];
    pool.forEach(function (player) {
      const offer = resolveFreeAgentSilently(player, rng, round);
      if (offer) results.push({ playerId: player.id, teamId: offer.teamId, salary: offer.salary });
      else stillUnsigned.push(player);
    });
    pool = stillUnsigned;
  }
  // Runs last, on whoever the open market left behind, so a team that came out
  // of the offseason short still ends up with a legal roster.
  enforceRosterFloors().forEach(function (s) {
    results.push({ playerId: s.playerId, teamId: s.teamId, salary: 1200000, floorSigning: true });
  });
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playingTimeScore: playingTimeScore,
    hypeScore: hypeScore,
    facilitiesScore: facilitiesScore,
    tradedAwayPenalty: tradedAwayPenalty,
    scoreOffer: scoreOffer,
    estimateFairSalary: estimateFairSalary,
    generateAIOffer: generateAIOffer,
    signPlayer: signPlayer,
    resolveFreeAgentSilently: resolveFreeAgentSilently,
    runFreeAgencySilently: runFreeAgencySilently,
    enforceRosterFloors: enforceRosterFloors,
    ROSTER_FLOOR: ROSTER_FLOOR,
    MAX_FREE_AGENCY_ROUNDS: MAX_FREE_AGENCY_ROUNDS
  };
}
