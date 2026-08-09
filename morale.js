var _MORALE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), ratings: require('./ratings.js') }
  : { league: { getTeamRoster: getTeamRoster }, ratings: { RATING_BANDS: RATING_BANDS } };

// Called once per team per game (mirrors fatigue.js's applyFatigueForGame).
// Small, game-by-game nudges rather than one big end-of-season jump: winning
// and getting a fair share of minutes trend morale up, losing and riding the
// bench trend it down, and an expiring deal adds a little background anxiety.
// Trade-day and free-agency-day morale swings are handled separately, in
// trade.js's executeTrade and freeAgency.js's signPlayer/estimateFairSalary.
function tickMoraleForTeamGame(teamId, won, minutesByPlayerId) {
  const roster = _MORALE_DATA.league.getTeamRoster(teamId);
  if (roster.length === 0) return;
  const avgMinutes = roster.reduce(function (s, p) { return s + (minutesByPlayerId[p.id] || 0); }, 0) / roster.length;
  roster.forEach(function (p) {
    let delta = won ? 0.35 : -0.45;
    const minutes = minutesByPlayerId[p.id] || 0;
    if (minutes > 0) delta += minutes >= avgMinutes ? 0.15 : -0.2;
    if (p.contract.yearsRemaining <= 1) delta -= 0.08;
    p.status.morale = Math.max(0, Math.min(100, p.status.morale + delta));
  });
}

function moraleTier(morale) {
  if (morale >= 70) return 'happy';
  if (morale >= 40) return 'neutral';
  return 'unhappy';
}

// Best-effort, computed live from current state — there's no persisted
// history of *why* morale moved, so this reconstructs plausible causes from
// the player's situation right now rather than logging a real reason trail.
function moraleFactors(player, team) {
  const reasons = [];
  if (team && team.record && (team.record.wins + team.record.losses) >= 5) {
    const winPct = team.record.wins / (team.record.wins + team.record.losses);
    if (winPct < 0.4) reasons.push('Losing record');
  }
  if (player.seasonStats && player.seasonStats.gamesPlayed > 0) {
    const mpg = player.seasonStats.minutes / player.seasonStats.gamesPlayed;
    if (mpg < 15 && player.overall >= _MORALE_DATA.ratings.RATING_BANDS.rotation) reasons.push('Limited role');
  }
  if (player.contract.yearsRemaining <= 1) reasons.push('Contract expiring');
  if (player.status.injury) reasons.push('Injured');
  return reasons;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tickMoraleForTeamGame: tickMoraleForTeamGame, moraleTier: moraleTier, moraleFactors: moraleFactors };
}
