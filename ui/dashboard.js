function injuryLabel(injury) {
  return injury.gamesRemaining >= 999 ? 'Out (season) — ' + injury.severity : 'Out ' + injury.gamesRemaining + 'g — ' + injury.severity;
}

function topLeaders(players, statKey, n) {
  return players
    .filter(function (p) { return p.seasonStats && p.seasonStats.gamesPlayed > 0; })
    .slice()
    .sort(function (a, b) { return getPlayerAverages(b)[statKey] - getPlayerAverages(a)[statKey]; })
    .slice(0, n);
}

function leadersTableHtml(title, players, statKey, statLabel) {
  const leaders = topLeaders(players, statKey, 3);
  if (leaders.length === 0) return '<div><div class="kpi-label">' + title + '</div><div class="empty-state">No games played yet.</div></div>';
  return '<div><div class="kpi-label">' + title + '</div><table class="data-table"><tbody>' +
    leaders.map(function (p, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td class="col-name">' + p.name + '</td>' +
        '<td class="num">' + getPlayerAverages(p)[statKey].toFixed(1) + ' ' + statLabel + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

// Score-result feed lines ("Team A 120, Team B 117") are already fully
// browsable in the Live Feed tab — headlines surface everything ELSE (trades,
// injuries, signings, offseason news) so the dashboard reads as "what
// happened" rather than a running scoreboard. The feed has no structured
// event types (see script.js's pushToFeed), so this is a text-shape heuristic
// rather than a real classification.
const SCORE_LINE_PATTERN = /^.+\s\d+,\s.+\s\d+$/;

function recentHeadlines(feed, n) {
  return feed.filter(function (entry) { return !SCORE_LINE_PATTERN.test(entry.text); })
    .slice(-n)
    .reverse();
}

function renderDashboard(container, teamId) {
  const team = getTeamById(teamId);
  const roster = getTeamRoster(teamId);
  const payroll = getTeamPayroll(teamId);
  const effectiveCap = getEffectiveSalaryCap(GameState.settings && GameState.settings.capLevel);
  const capSpace = effectiveCap - payroll;
  const injuredPlayers = roster.filter(function (p) { return p.status.injury; })
    .sort(function (a, b) { return b.overall - a.overall; });

  const avgMorale = roster.length > 0
    ? roster.reduce(function (s, p) { return s + p.status.morale; }, 0) / roster.length
    : 70;
  const unhappyPlayers = roster.filter(function (p) { return moraleTier(p.status.morale) === 'unhappy'; })
    .sort(function (a, b) { return a.status.morale - b.status.morale; });

  const headlines = recentHeadlines(GameState.feed || [], 8);

  const nextDay = GameState.season ? getNextGameDay(GameState.season, teamId, GameState.season.currentDay) : null;
  let nextGameLabel = 'No season in progress.';
  if (nextDay !== null) {
    const nextGame = GameState.season.games.find(function (g) { return g.day === nextDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); });
    const isHome = nextGame.homeTeamId === teamId;
    const opp = getTeamById(isHome ? nextGame.awayTeamId : nextGame.homeTeamId);
    nextGameLabel = 'Next game: ' + (isHome ? 'vs ' : '@ ') + opp.name + ' (day ' + nextDay + ')';
  } else if (GameState.season) {
    nextGameLabel = 'No games remaining.';
  }

  const capPct = Math.min(100, Math.round((payroll / effectiveCap) * 100));
  const capClass = capSpace >= 0 ? 'is-good' : 'is-warn';
  const capText = capSpace >= 0
    ? '$' + capSpace.toLocaleString() + ' space'
    : '$' + Math.abs(capSpace).toLocaleString() + ' over';

  container.innerHTML =
    '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 28) + ' ' + team.name + '</h2>' +
      '<span class="view-sub">' + team.conference + ' Conference · ' + team.division + '</span></div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div>' +
        '<div class="kpi-value">' + team.record.wins + '-' + team.record.losses + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Roster</div>' +
        '<div class="kpi-value">' + roster.length + '</div><div class="kpi-sub">players under contract</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Chemistry</div>' +
        '<div class="kpi-value">' + team.chemistry + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.chemistry + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Fan Happiness</div>' +
        '<div class="kpi-value">' + team.fanHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.fanHappiness + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Owner Happiness</div>' +
        '<div class="kpi-value">' + team.ownerHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.ownerHappiness + '%"></div></div></div>' +
    '</div>' +

    '<div class="panel"><div class="panel-header">Salary Cap</div><div class="panel-body">' +
      '<div class="kpi-label">Payroll</div>' +
      '<div class="kpi-value ' + capClass + '">$' + payroll.toLocaleString() + '</div>' +
      '<div class="meter" style="margin:8px 0 6px;"><div class="meter-fill ' + (capSpace < 0 ? 'is-over' : '') + '" style="width:' + capPct + '%"></div></div>' +
      '<div class="kpi-sub">Cap $' + effectiveCap.toLocaleString() + ' · ' + capText + '</div>' +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Next Up</div><div class="panel-body">' +
      '<div class="kpi-value" style="font-size:1.05rem;">' + nextGameLabel + '</div>' +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Key Injuries' +
      (injuredPlayers.length > 0 ? ' <span class="pill pill-loss">' + injuredPlayers.length + '</span>' : '') +
      '</div><div class="panel-body">' +
      (injuredPlayers.length === 0
        ? '<div class="empty-state">No players currently injured.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">OVR</th><th>Status</th></tr></thead><tbody>' +
          injuredPlayers.map(function (p) {
            return '<tr><td class="col-name">' + p.name + '</td><td><span class="pill pill-pos">' + p.position + '</span></td>' +
              '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
              '<td><span class="pill pill-loss">' + injuryLabel(p.status.injury) + '</span></td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Your Team Leaders</div><div class="panel-body leaders-grid">' +
      leadersTableHtml('Points', roster, 'ppg', 'PPG') +
      leadersTableHtml('Rebounds', roster, 'rpg', 'RPG') +
      leadersTableHtml('Assists', roster, 'apg', 'APG') +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">League Leaders</div><div class="panel-body leaders-grid">' +
      leadersTableHtml('Points', PLAYERS_2026, 'ppg', 'PPG') +
      leadersTableHtml('Rebounds', PLAYERS_2026, 'rpg', 'RPG') +
      leadersTableHtml('Assists', PLAYERS_2026, 'apg', 'APG') +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Team Morale</div><div class="panel-body">' +
      '<div class="kpi-label">Average Morale</div>' +
      '<div class="kpi-value">' + Math.round(avgMorale) + '</div>' +
      '<div class="meter" style="margin:8px 0 16px;"><div class="meter-fill" style="width:' + Math.round(avgMorale) + '%"></div></div>' +
      (unhappyPlayers.length === 0
        ? '<div class="empty-state">No unhappy players right now.</div>'
        : '<div class="kpi-label">Unhappy Players</div><table class="data-table"><thead><tr><th>Player</th><th class="num">Morale</th><th>Why</th></tr></thead><tbody>' +
          unhappyPlayers.map(function (p) {
            const reasons = moraleFactors(p, team);
            return '<tr><td class="col-name">' + p.name + '</td>' +
              '<td class="num">' + moraleStatusHtml(p) + '</td>' +
              '<td>' + (reasons.length > 0 ? reasons.join(', ') : '—') + '</td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Headlines</div><div class="panel-body">' +
      (headlines.length === 0
        ? '<div class="empty-state">No news yet.</div>'
        : '<ul class="headline-list">' + headlines.map(function (h) {
            return '<li><span class="pill pill-mute">Day ' + h.day + '</span> ' + h.text + '</li>';
          }).join('') + '</ul>') +
    '</div></div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDashboard: renderDashboard };
}
