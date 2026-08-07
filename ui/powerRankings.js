// Last-10-games win percentage for a team, read from the live schedule
// (GameState.season.games) rather than any separately tracked streak field.
function recentFormWinPct(teamId, season) {
  if (!season) return 0.5;
  const played = season.games
    .filter(function (g) { return g.played && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return b.day - a.day; })
    .slice(0, 10);
  if (played.length === 0) return 0.5;
  const wins = played.filter(function (g) {
    const isHome = g.homeTeamId === teamId;
    return isHome ? g.homeScore > g.awayScore : g.awayScore > g.homeScore;
  }).length;
  return wins / played.length;
}

// Composite score blending record, point differential, roster talent, and
// recent form — not an official NBA metric, just a reasonable "how good is
// this team right now" blend built entirely from data the sim already
// tracks (no invented stats).
function computePowerRankingScore(team, season) {
  const gamesPlayed = team.record.wins + team.record.losses;
  const winPct = gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0.5;
  const avgPointDiff = gamesPlayed > 0 ? ((team.record.pointsFor || 0) - (team.record.pointsAgainst || 0)) / gamesPlayed : 0;
  const roster = getTeamRoster(team.id);
  const avgOverall = roster.length > 0 ? roster.reduce(function (s, p) { return s + p.overall; }, 0) / roster.length : 65;
  const recentForm = recentFormWinPct(team.id, season);

  return winPct * 50 + avgPointDiff * 1.5 + (avgOverall - 65) * 0.8 + recentForm * 20;
}

function computePowerRankings(season) {
  return TEAMS.slice()
    .map(function (t) { return { team: t, score: computePowerRankingScore(t, season) }; })
    .sort(function (a, b) { return b.score - a.score; });
}

function renderPowerRankings(container) {
  const rankings = computePowerRankings(GameState.season);

  let html = '<div class="view-header"><h2>Power Rankings</h2>' +
    '<span class="view-sub">Composite of record, point differential, roster talent, and last-10 form</span></div>';

  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Rank</th><th>Team</th>' +
    '<th class="num">W-L</th><th class="num">Diff</th><th class="num">Last 10</th><th class="num">Score</th></tr></thead><tbody>';

  rankings.forEach(function (row, i) {
    const t = row.team;
    const gamesPlayed = t.record.wins + t.record.losses;
    const diff = (t.record.pointsFor || 0) - (t.record.pointsAgainst || 0);
    const last10Pct = Math.round(recentFormWinPct(t.id, GameState.season) * 10);
    const rowClass = t.id === GameState.userTeamId ? ' class="row-user"' : '';
    html += '<tr' + rowClass + '><td class="num">' + (i + 1) + '</td><td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + escapeHtml(t.name) + '</td>' +
      '<td class="num">' + t.record.wins + '-' + t.record.losses + '</td>' +
      '<td class="num">' + (diff > 0 ? '+' : '') + diff + '</td>' +
      '<td class="num">' + (gamesPlayed > 0 ? last10Pct + '-' + (10 - last10Pct) : '—') + '</td>' +
      '<td class="num">' + row.score.toFixed(1) + '</td></tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { recentFormWinPct: recentFormWinPct, computePowerRankingScore: computePowerRankingScore, computePowerRankings: computePowerRankings, renderPowerRankings: renderPowerRankings };
}
