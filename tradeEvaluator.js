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

function basePlayerValue(player) {
  const potentialGap = Math.max(0, player.potential - player.overall);
  return player.overall * 2 + potentialGap * youthFactor(player.age) - contractBurden(player.contract.salary, player.overall);
}

var _EVAL_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js') }
  : { league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById, getTeamPayroll: getTeamPayroll }, teams: { getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS } };

function directionMultiplier(player, timeline) {
  if (timeline === 'rebuilding') {
    if (player.age <= 25) return 1.2;
    if (player.age >= 30) return 0.8;
    return 1.0;
  }
  if (timeline === 'win-now') {
    if (player.overall >= 80) return 1.2;
    if (player.age <= 22) return 0.85;
    return 1.0;
  }
  return 1.0; // retooling: roughly neutral
}

const LEAGUE_AVG_OVERALL = 75;

function needMultiplier(position, team) {
  const roster = _EVAL_DATA.league.getTeamRoster(team.id);
  const samePosition = roster.filter(function (p) { return p.position === position; });
  if (samePosition.length === 0) return 1.3;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.overall; }, 0) / samePosition.length;
  if (avgAtPosition < LEAGUE_AVG_OVERALL - 10) return 1.15;
  if (avgAtPosition > LEAGUE_AVG_OVERALL + 10) return 0.9;
  return 1.0;
}

function adjustedPlayerValue(player, team) {
  return basePlayerValue(player) * directionMultiplier(player, team.timeline) * needMultiplier(player.position, team);
}

function generateSuggestion(team, outgoing, valueOk, salaryOk) {
  if (!valueOk) {
    const worst = outgoing.slice().sort(function (a, b) { return adjustedPlayerValue(b, team) - adjustedPlayerValue(a, team); })[0];
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

  const outgoingValue = outgoing.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0) + outgoingPickValue;
  const incomingValue = incoming.reduce(function (s, p) { return s + adjustedPlayerValue(p, team); }, 0) + incomingPickValue;
  const valueOk = incomingValue >= 0.9 * outgoingValue;

  const outgoingSalary = outgoing.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const incomingSalary = incoming.reduce(function (s, p) { return s + p.contract.salary; }, 0);
  const payroll = _EVAL_DATA.league.getTeamPayroll(teamId);
  const capSpace = _EVAL_DATA.data.CAP_CONSTANTS.SALARY_CAP - payroll;
  const salaryIncrease = incomingSalary - outgoingSalary;
  const salaryOk = salaryIncrease <= outgoingSalary * 0.25 + 2000000 || salaryIncrease <= capSpace;

  const accepted = valueOk && salaryOk;
  return {
    accepted: accepted,
    valueOk: valueOk,
    salaryOk: salaryOk,
    outgoingValue: outgoingValue,
    incomingValue: incomingValue,
    suggestion: accepted ? null : generateSuggestion(team, outgoing, valueOk, salaryOk)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    youthFactor: youthFactor,
    contractBurden: contractBurden,
    basePlayerValue: basePlayerValue,
    directionMultiplier: directionMultiplier,
    needMultiplier: needMultiplier,
    adjustedPlayerValue: adjustedPlayerValue,
    evaluateTeamLeg: evaluateTeamLeg
  };
}
