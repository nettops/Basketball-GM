var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js') }
  : { league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById }, teams: { TEAMS: TEAMS, getTeamById: getTeamById }, data: { CAP_CONSTANTS: CAP_CONSTANTS } };

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { playingTimeScore: playingTimeScore, scoreOffer: scoreOffer };
}
