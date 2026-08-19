var _MORALE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), ratings: require('./ratings.js') }
  : { league: { getTeamRoster: getTeamRoster }, ratings: { RATING_BANDS: RATING_BANDS } };

// Called once per team per game (mirrors fatigue.js's applyFatigueForGame).
// Small, game-by-game nudges rather than one big end-of-season jump: winning
// and getting a fair share of minutes trend morale up, losing and riding the
// bench trend it down, and an expiring deal adds a little background anxiety.
// Trade-day and free-agency-day morale swings are handled separately, in
// trade.js's executeTrade and freeAgency.js's signPlayer/estimateFairSalary.
// Sitting out is the WORST outcome for a player's mood, not a neutral one.
//
// This used to read `if (minutes > 0) delta += ...`, which skipped the minutes
// term entirely for anyone who did not play — so the men with the most to be
// unhappy about, the five who are out of the rotation and get a hard zero from
// gameCoach.js, were the only ones the rule never touched. A DNP is the
// complaint, not the absence of one.
// Swept over a full simulated season, reading the SHAPE rather than the count.
// The old numbers produced a league where morale barely moved: 10 unhappy
// players in 435, all of them on one 15-67 club, and a median of 69 that a
// losing season could not shift. These give a median of 57, 12% unhappy, and —
// the part that matters — a real spread: starters average 85 against a bench
// of 45, and the best club in the league averages 83 against the worst on 43.
// Mood now tracks the standings and the rotation instead of drifting.
const MORALE_DNP = -0.25;
const MORALE_BELOW_SHARE = -0.12;
const MORALE_FAIR_SHARE = 0.3;

function tickMoraleForTeamGame(teamId, won, minutesByPlayerId) {
  const roster = _MORALE_DATA.league.getTeamRoster(teamId);
  if (roster.length === 0) return;

  // Averaged over the men who actually DRESSED, not the whole roster. Dividing
  // 240 minutes by fifteen gives a 16-minute bar that a ten-man rotation
  // clears almost to a man, so nearly everybody who played collected the
  // fair-share bonus and "am I getting my minutes" stopped discriminating
  // between a starter and the last man off the bench.
  let playedCount = 0, playedMinutes = 0;
  roster.forEach(function (p) {
    const m = minutesByPlayerId[p.id] || 0;
    if (m > 0) { playedCount += 1; playedMinutes += m; }
  });
  const avgMinutes = playedCount > 0 ? playedMinutes / playedCount : 0;

  roster.forEach(function (p) {
    let delta = won ? 0.35 : -0.45;
    const minutes = minutesByPlayerId[p.id] || 0;
    if (minutes <= 0) delta += MORALE_DNP;
    else delta += minutes >= avgMinutes ? MORALE_FAIR_SHARE : MORALE_BELOW_SHARE;
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
  module.exports = { tickMoraleForTeamGame: tickMoraleForTeamGame, moraleTier: moraleTier,
    moraleFactors: moraleFactors, MORALE_DNP: MORALE_DNP };
}
