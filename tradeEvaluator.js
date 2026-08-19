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
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), players: require('./players-2026.js'), ratings: require('./ratings.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll }, teams: { getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap }, players: { PLAYERS_2026: PLAYERS_2026 }, ratings: { RATING_BANDS: RATING_BANDS, OVERALL_INTERCEPT: OVERALL_INTERCEPT } };

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
    if (player.overall >= _EVAL_DATA.ratings.RATING_BANDS.star) return 1.2;
    if (player.age <= 22) return 0.85;
    return 1.0;
  }
  return 1.0; // retooling: roughly neutral
}


// Live league-wide average overall, replacing the old hardcoded 75 — so
// needMultiplier reacts to however the player pool has actually drifted,
// rather than assuming a fixed baseline that could go stale as ratings shift
// over many simulated seasons.
//
// CACHED, invalidated explicitly. The original "recomputed per call (cheap:
// one pass over ~450 players)" was written when rawOverall was a stored
// field; it is a derived getter now (a 20-attribute dot product per read),
// and trade evaluation reaches this through nested loops — measured at a
// 3.4-second freeze on the weekly AI-to-AI pass, which is what made ultra
// sim speed hitch once every simulated week. The average only actually
// moves when the POOL moves: progression at rollover, draft/retirement
// churn, a commissioner rating edit. Those sites call
// invalidateLeagueAvgCache() below — the same snapshot-at-the-boundary
// pattern setLeagueGate already uses. A missed site costs a slightly stale
// 1.15/0.9 need threshold on AI trade appetite, not a correctness
// invariant; overall itself stays derived and uncached.
var _leagueAvgCache = null;
function invalidateLeagueAvgCache() { _leagueAvgCache = null; }
function currentLeagueAvgOverall() {
  if (_leagueAvgCache !== null) return _leagueAvgCache;
  const allPlayers = _EVAL_DATA.players.PLAYERS_2026;
  // Scale-free: the fit centres the league on OVERALL_INTERCEPT by
  // construction, so this fallback cannot drift the way a literal 75 did.
  if (allPlayers.length === 0) return _EVAL_DATA.ratings.OVERALL_INTERCEPT;
  _leagueAvgCache = allPlayers.reduce(function (s, p) { return s + p.rawOverall; }, 0) / allPlayers.length;
  return _leagueAvgCache;
}

// `leagueAvg` is optional: one-off callers (UI, validators) omit it and get
// the live recompute; hot loops pass a value hoisted once per pass. The
// "cheap: one pass over ~450 players" claim on currentLeagueAvgOverall was
// written when rawOverall was a stored field — it is a derived GETTER now
// (20-attribute dot product), and autoGM's weekly AI-to-AI pass called this
// ~435 times per team, which multiplied out to ~5.6 million getter
// evaluations and a measured 3.4-second freeze every simulated week at
// ultra speed. Hoisting the average is what fixed that; do not remove the
// parameter without re-measuring the weekly pass.
function needMultiplier(position, team, leagueAvg) {
  const roster = _EVAL_DATA.league.getTeamRoster(team.id);
  const samePosition = roster.filter(function (p) { return p.position === position; });
  if (samePosition.length === 0) return 1.3;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.rawOverall; }, 0) / samePosition.length;
  if (leagueAvg === undefined) leagueAvg = currentLeagueAvgOverall();
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

// The salary-matching LAW, separated from the value JUDGMENT above it so the
// two can bind independently: an AI-decided leg gets both, while a hand-built
// user trade keeps its freedom on value but is still subject to this (see
// evaluateSalaryLeg below and trade.js's evaluateTrade). A team may take on
// more salary than it sends only within the matching band (25% + $2M) or
// within its cap space; Disable Salary Cap is the one way past it, same as
// free agency.
function salaryMatchOk(teamId, outgoingSalary, incomingSalary) {
  const payroll = _EVAL_DATA.league.getTeamPayroll(teamId);
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
  const capSpace = _EVAL_DATA.data.getEffectiveSalaryCap(capLevel) - payroll;
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const salaryIncrease = incomingSalary - outgoingSalary;
  return capDisabled || salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;
}

// The user's leg of a hand-built trade: salary law only, no value judgment.
// Shaped like evaluateTeamLeg's result so trade.js and the Trade Center can
// treat every leg alike.
function evaluateSalaryLeg(teamId, outgoingPlayerIds, incomingPlayerIds) {
  const team = _EVAL_DATA.teams.getTeamById(teamId);
  const outgoing = outgoingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const incoming = incomingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const outgoingSalary = outgoing.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const incomingSalary = incoming.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const salaryOk = salaryMatchOk(teamId, outgoingSalary, incomingSalary);
  return {
    accepted: salaryOk,
    valueOk: true,
    salaryOk: salaryOk,
    suggestion: salaryOk ? null : generateSuggestion(team, outgoing, true, false, null)
  };
}

// How hard the AI bargains, as a multiplier on the value it demands back.
//
// A mutable holder rather than a threaded parameter, the same shape
// RESIGN_TUNING uses in freeAgency.js: evaluateTeamLeg is called from the Trade
// Center, the AI-to-AI generator and the offer inbox, and a difficulty setting
// is not worth a new argument at three call sites. difficulty.js writes it;
// the shipped default is exactly 1, so a save with no difficulty set behaves
// precisely as it always did.
var TRADE_TUNING = { shrewdness: 1 };

// What a PACKAGE of players is worth, as opposed to what they are worth added up.
//
// This used to be a plain sum, and a plain sum says three replacement-level
// bodies are worth more than one star. Measured across all 870 club pairs,
// 6.8% of them would hand over their best player for a bundle of the worst
// players on your roster — an average upgrade of +28 OVR, including Victor
// Wembanyama at 82 for three men whose best was 36.
//
// A sum is the wrong model because a roster is not a warehouse: there are five
// places on the floor and one ball, and the fourth-best piece in a package
// plays almost none of the minutes the star he replaced was playing. So the
// pieces are ranked and discounted — the headline player counts in full, the
// next a little over half, and it falls away from there.
//
// This is deliberately NOT a cap on package size. Two good players for one
// great one is a real trade and still goes through; what stops working is
// paying for quality with quantity.
const PACKAGE_DIMINISH = 0.55;

function packageValue(players, team, leagueBaseline) {
  const values = players.map(function (p) { return adjustedPlayerValue(p, team, leagueBaseline); })
    .sort(function (a, b) { return b - a; });
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i] * Math.pow(PACKAGE_DIMINISH, i);
  }
  return total;
}

function evaluateTeamLeg(teamId, outgoingPlayerIds, incomingPlayerIds, outgoingPickValue, incomingPickValue) {
  outgoingPickValue = outgoingPickValue || 0;
  incomingPickValue = incomingPickValue || 0;

  const team = _EVAL_DATA.teams.getTeamById(teamId);
  const outgoing = outgoingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  const incoming = incomingPlayerIds.map(_EVAL_DATA.league.getPlayerById);
  // Computed once per evaluation (not once per player) — see computeLeagueStatBaseline.
  const leagueBaseline = computeLeagueStatBaseline();

  const outgoingValue = packageValue(outgoing, team, leagueBaseline) + outgoingPickValue;
  const incomingValue = packageValue(incoming, team, leagueBaseline) + incomingPickValue;
  // At shrewdness 1 the AI accepts getting back 90% of what it gives — its
  // long-standing tolerance. On brutal (1.3) it demands 17% MORE than it gives;
  // on relaxed (0.85) it will hand over rather more than it gets.
  const valueOk = incomingValue >= 0.9 * TRADE_TUNING.shrewdness * outgoingValue;

  const outgoingSalary = outgoing.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const incomingSalary = incoming.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const salaryOk = salaryMatchOk(teamId, outgoingSalary, incomingSalary);

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
    TRADE_TUNING: TRADE_TUNING,
    PACKAGE_DIMINISH: PACKAGE_DIMINISH,
    packageValue: packageValue,
    youthFactor: youthFactor,
    contractBurden: contractBurden,
    rawProductionPerGame: rawProductionPerGame,
    computeLeagueStatBaseline: computeLeagueStatBaseline,
    computeStatRating: computeStatRating,
    basePlayerValue: basePlayerValue,
    directionMultiplier: directionMultiplier,
    currentLeagueAvgOverall: currentLeagueAvgOverall,
    invalidateLeagueAvgCache: invalidateLeagueAvgCache,
    needMultiplier: needMultiplier,
    adjustedPlayerValue: adjustedPlayerValue,
    salaryMatchOk: salaryMatchOk,
    evaluateSalaryLeg: evaluateSalaryLeg,
    evaluateTeamLeg: evaluateTeamLeg
  };
}
