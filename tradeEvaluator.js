// Weights unrealized potential more heavily for younger players, tapering to
// near-zero by the mid-30s (a 34-year-old's potential gap isn't going anywhere).
function youthFactor(age) {
  if (age <= 23) return 1.0;
  if (age >= 34) return 0.1;
  return 1.0 - ((age - 23) / 11) * 0.9;
}

// "Fair" salary scales roughly linearly with overall; burden is how far actual
// salary exceeds that anchor, converted to value-scale penalty points.
function contractBurden(salary, overall) {
  const fairSalary = Math.max(1000000, (overall - 50) * 1000000);
  const excess = Math.max(0, salary - fairSalary);
  return excess / 2000000;
}

var _EVAL_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), players: require('./players-2026.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll }, teams: { getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap }, players: { PLAYERS_2026: PLAYERS_2026 } };

// Raw per-game "production" for stat-blended valuation — deliberately NOT a
// real PER formula with real-NBA constants. This engine's simulated box
// scores run far below real NBA scale (season highs around 17 ppg, not
// 30+), so any fixed real-world normalization constant would misjudge every
// player. Instead this is z-scored against THIS LEAGUE's own current
// distribution (computeLeagueStatBaseline), which is scale-invariant — it
// doesn't matter that the raw numbers are compressed, only how a player's
// production compares to their actual leaguemates'.
function rawProductionPerGame(player) {
  const s = player.seasonStats;
  if (!s || s.gamesPlayed < 5) return null;
  return (s.points + s.rebounds + s.assists * 1.5 + s.steals * 2 + s.blocks * 2) / s.gamesPlayed;
}

// Call once per trade-evaluation session (not once per player — evaluateTeamLeg
// does this and passes the result down) so scanning the full player pool
// doesn't happen once per player compared.
function computeLeagueStatBaseline() {
  const allPlayers = _EVAL_DATA.players.PLAYERS_2026;
  const values = [];
  allPlayers.forEach(function (p) {
    const v = rawProductionPerGame(p);
    if (v !== null) values.push(v);
  });
  if (values.length < 10) return null; // too early in a season for a meaningful distribution
  const mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  const variance = values.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / values.length;
  return { mean: mean, std: Math.max(1, Math.sqrt(variance)) };
}

// Converts a player's production to a rating-scale (roughly 20-99, same
// range as `overall`) number via z-score against the league baseline, so it
// can be blended directly with `overall` below.
function computeStatRating(player, leagueBaseline) {
  if (!leagueBaseline) return null;
  const raw = rawProductionPerGame(player);
  if (raw === null) return null;
  const z = (raw - leagueBaseline.mean) / leagueBaseline.std;
  return Math.max(20, Math.min(99, 50 + z * 10));
}

// Blends rating-based value with actual on-court performance — a player
// outproducing their rating (or underproducing it) shows up here, not just
// in ratings a scout assigned at the start of the season. Falls back to pure
// `overall` when there's no meaningful sample yet (new season, injury,
// rookie) or no leagueBaseline was supplied — existing callers that don't
// pass one keep the exact old rating-only behavior.
function basePlayerValue(player, leagueBaseline) {
  const potentialGap = Math.max(0, player.potential - player.rawOverall);
  const statRating = computeStatRating(player, leagueBaseline);
  const effectiveOverall = statRating !== null ? 0.8 * player.rawOverall + 0.2 * statRating : player.rawOverall;
  return effectiveOverall * 2 + potentialGap * youthFactor(player.age) - contractBurden(player.contract.salary, player.rawOverall);
}

function directionMultiplier(player, timeline) {
  if (timeline === 'rebuilding') {
    if (player.age <= 25) return 1.2;
    if (player.age >= 30) return 0.8;
    return 1.0;
  }
  if (timeline === 'win-now') {
    if (player.rawOverall >= 80) return 1.2;
    if (player.age <= 22) return 0.85;
    return 1.0;
  }
  return 1.0; // retooling: roughly neutral
}

const LEAGUE_AVG_OVERALL = 75;

// Live league-wide average overall, replacing the old hardcoded 75 — recomputed
// per call (cheap: one pass over ~450 players) so needMultiplier reacts to
// however the player pool has actually drifted, rather than assuming a fixed
// baseline that could go stale as ratings shift over many simulated seasons.
function currentLeagueAvgOverall() {
  const allPlayers = _EVAL_DATA.players.PLAYERS_2026;
  if (allPlayers.length === 0) return LEAGUE_AVG_OVERALL;
  return allPlayers.reduce(function (s, p) { return s + p.rawOverall; }, 0) / allPlayers.length;
}

function needMultiplier(position, team) {
  const roster = _EVAL_DATA.league.getTeamRoster(team.id);
  const samePosition = roster.filter(function (p) { return p.position === position; });
  if (samePosition.length === 0) return 1.3;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.rawOverall; }, 0) / samePosition.length;
  const leagueAvg = currentLeagueAvgOverall();
  if (avgAtPosition < leagueAvg - 10) return 1.15;
  if (avgAtPosition > leagueAvg + 10) return 0.9;
  return 1.0;
}

function adjustedPlayerValue(player, team, leagueBaseline) {
  return basePlayerValue(player, leagueBaseline) * directionMultiplier(player, team.timeline) * needMultiplier(player.position, team);
}

function generateSuggestion(team, outgoing, valueOk, salaryOk, leagueBaseline) {
  if (!valueOk) {
    const worst = outgoing.slice().sort(function (a, b) { return adjustedPlayerValue(b, team, leagueBaseline) - adjustedPlayerValue(a, team, leagueBaseline); })[0];
    return worst
      ? 'Not enough value coming back for ' + team.name + '. Consider removing ' + worst.name + ' from the outgoing side, or adding another player to the incoming side.'
      : 'Not enough value coming back for ' + team.name + '. Add another player to the incoming side.';
  }
  if (!salaryOk) {
    return 'Salaries do not match closely enough for ' + team.name + ' and it lacks the cap space to absorb the difference. Add a lower-salaried player to balance the deal.';
  }
  return null;
}

function evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds, outgoingPickValue, incomingPickValue) {
  outgoingPickValue = outgoingPickValue || 0;
  incomingPickValue = incomingPickValue || 0;

  const team = _EVAL_DATA.teams.getTeamById(teamId);
  const outgoing = outgoingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const incoming = incomingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  // Computed once per evaluation (not once per player) — see computeLeagueStatBaseline.
  const leagueBaseline = computeLeagueStatBaseline();

  const outgoingValue = outgoing.reduce(function (s, p) { return s + adjustedPlayerValue(p, team, leagueBaseline); }, 0) + outgoingPickValue;
  const incomingValue = incoming.reduce(function (s, p) { return s + adjustedPlayerValue(p, team, leagueBaseline); }, 0) + incomingPickValue;
  const valueOk = incomingValue >= 0.9 * outgoingValue;

  const outgoingSalary = outgoing.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const incomingSalary = incoming.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const payroll = _EVAL_DATA.league.getTeamPayroll(teamId);
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
  const capSpace = _EVAL_DATA.data.getEffectiveSalaryCap(capLevel) - payroll;
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const salaryIncrease = incomingSalary - outgoingSalary;
  const salaryOk = capDisabled || salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;

  const accepted = valueOk && salaryOk;
  return {
    accepted: accepted,
    valueOk: valueOk,
    salaryOk: salaryOk,
    outgoingValue: outgoingValue,
    incomingValue: incomingValue,
    suggestion: accepted ? null : generateSuggestion(team, outgoing, valueOk, salaryOk, leagueBaseline)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    youthFactor: youthFactor,
    contractBurden: contractBurden,
    rawProductionPerGame: rawProductionPerGame,
    computeLeagueStatBaseline: computeLeagueStatBaseline,
    computeStatRating: computeStatRating,
    basePlayerValue: basePlayerValue,
    directionMultiplier: directionMultiplier,
    currentLeagueAvgOverall: currentLeagueAvgOverall,
    needMultiplier: needMultiplier,
    adjustedPlayerValue: adjustedPlayerValue,
    evaluateTeamLeg: evaluateTeamLeg
  };
}
