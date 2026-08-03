function pctString(made, attempted) {
  return attempted > 0 ? ((made / attempted) * 100).toFixed(1) + '%' : '—';
}

function renderCurrentSeasonPanel(player) {
  const avg = getPlayerAverages(player);
  const team = player.teamId ? getTeamById(player.teamId) : null;
  let html = '<div class="panel"><div class="panel-header">Current Season</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Team</div><div class="kpi-value">' + (team ? team.name : 'Free Agent') + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">GP</div><div class="kpi-value">' + (player.seasonStats ? player.seasonStats.gamesPlayed : 0) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">PPG</div><div class="kpi-value">' + avg.ppg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">RPG</div><div class="kpi-value">' + avg.rpg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">APG</div><div class="kpi-value">' + avg.apg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Salary</div><div class="kpi-value">$' + player.contract.salary.toLocaleString() + '</div></div>';
  if (player.status && player.status.injury) {
    html += '<div class="kpi-tile"><div class="kpi-label">Injury</div><div class="kpi-value">' + injuryStatusHtml(player) + '</div></div>';
  }
  html += '</div></div>';
  return html;
}

function renderCareerStatsTab(player) {
  ensureCareerData([player]);
  const cs = player.careerStats;
  const gp = cs.gamesPlayed || 1;
  const highs = player.careerHistory.careerHighs;
  let html = '<div class="panel"><div class="panel-header">Career Totals</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Seasons</div><div class="kpi-value">' + cs.seasonsPlayed + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Games</div><div class="kpi-value">' + cs.gamesPlayed + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">PPG</div><div class="kpi-value">' + (cs.points / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">RPG</div><div class="kpi-value">' + (cs.rebounds / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">APG</div><div class="kpi-value">' + (cs.assists / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Peak OVR</div><div class="kpi-value">' + player.peakOverall + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Titles</div><div class="kpi-value">' + player.championshipsWon + '</div></div>';
  html += '</div></div>';

  html += '<div class="panel"><div class="panel-header">Career Highs</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Pts</div><div class="kpi-value">' + highs.singleGame.points + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Reb</div><div class="kpi-value">' + highs.singleGame.rebounds + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Ast</div><div class="kpi-value">' + highs.singleGame.assists + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Best Season PPG</div><div class="kpi-value">' + highs.singleSeason.ppg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Best Season Pts</div><div class="kpi-value">' + highs.singleSeason.points + '</div></div>';
  html += '</div></div>';

  if (player.awardsWon.length > 0) {
    html += '<div class="panel"><div class="panel-header">Awards</div><div class="panel-body">';
    html += player.awardsWon.map(function (a) { return a.leagueYear + ' ' + a.award; }).join(', ');
    html += '</div></div>';
  }
  return html;
}

const SEASON_BREAKDOWN_COLUMNS = [
  { key: 'season', label: 'Year' }, { key: 'team', label: 'Team' }, { key: 'gamesPlayed', label: 'GP' },
  { key: 'points', label: 'Points' }, { key: 'rebounds', label: 'Rebounds' }, { key: 'assists', label: 'Assists' },
  { key: 'fgPct', label: 'FG%' }, { key: 'tpPct', label: '3P%' }, { key: 'ftPct', label: 'FT%' }, { key: 'minutes', label: 'Minutes' }
];

function seasonRowsForPlayer(player) {
  ensureCareerHistory(player);
  return Object.keys(player.careerHistory.seasonByYear).map(function (y) {
    const s = player.careerHistory.seasonByYear[y];
    return Object.assign({}, s, { fgPct: s.fga > 0 ? s.fgm / s.fga : 0, tpPct: s.tpa > 0 ? s.tpm / s.tpa : 0, ftPct: s.fta > 0 ? s.ftm / s.fta : 0 });
  });
}

function renderSeasonBreakdownTab(player, sortKey, sortDir, onSort) {
  let rows = seasonRowsForPlayer(player);
  if (rows.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No completed seasons on record yet.</div></div></div>';
  rows.sort(function (a, b) { return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * sortDir; });
  const bestSeasonYear = rows.slice().sort(function (a, b) { return b.points - a.points; })[0].season;

  let html = '<div class="panel"><table class="data-table"><thead><tr>';
  SEASON_BREAKDOWN_COLUMNS.forEach(function (col) {
    const numeric = col.key !== 'team';
    html += '<th data-sort-key="' + col.key + '"' + (numeric ? ' class="num"' : '') + '>' + col.label +
      (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function (s) {
    const rowClass = s.season === bestSeasonYear ? ' class="row-highlight"' : '';
    html += '<tr' + rowClass + '><td class="num">' + s.season + '</td><td>' + (s.team || '—') + '</td><td class="num">' + s.gamesPlayed +
      '</td><td class="num">' + s.points + '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists +
      '</td><td class="num">' + pctString(s.fgm, s.fga) + '</td><td class="num">' + pctString(s.tpm, s.tpa) +
      '</td><td class="num">' + pctString(s.ftm, s.fta) + '</td><td class="num">' + s.minutes + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderTeamHistoryTab(player) {
  ensureCareerHistory(player);
  const teams = player.careerHistory.teamHistory;
  if (teams.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No team history on record yet.</div></div></div>';

  let html = '<div class="panel"><div class="panel-header">Timeline</div><div class="panel-body">';
  html += '<div style="display:flex;height:24px;border-radius:var(--r-sm);overflow:hidden;">';
  const totalSeasons = teams.reduce(function (s, t) { return s + t.seasons; }, 0) || 1;
  teams.forEach(function (t) {
    const team = getTeamById(t.teamId);
    const color = team ? team.colors.primary : '#555';
    const width = (t.seasons / totalSeasons) * 100;
    html += '<div title="' + (t.team || t.teamId) + ' (' + t.startSeason + '-' + (t.endSeason || 'present') + ')" ' +
      'style="width:' + width + '%;background:' + color + ';"></div>';
  });
  html += '</div></div></div>';

  html += '<div class="panel"><table class="data-table"><thead><tr><th>Team</th><th class="num">Years</th>' +
    '<th class="num">Seasons</th><th class="num">Games</th><th class="num">Total Pts</th><th class="num">PPG</th>' +
    '<th class="num">RPG</th><th class="num">APG</th></tr></thead><tbody>';
  teams.forEach(function (t) {
    const gp = t.totalGames || 1;
    html += '<tr><td class="col-name">' + (t.team || t.teamId) + '</td><td class="num">' + t.startSeason + '–' + (t.endSeason || 'present') +
      '</td><td class="num">' + t.seasons + '</td><td class="num">' + t.totalGames + '</td><td class="num">' + t.totalPoints +
      '</td><td class="num">' + (t.totalPoints / gp).toFixed(1) + '</td><td class="num">' + (t.totalRebounds / gp).toFixed(1) +
      '</td><td class="num">' + (t.totalAssists / gp).toFixed(1) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

const SEVERITY_PILL = { minor: 'pill-mute', moderate: 'pill-pos', major: 'pill-loss', severe: 'pill-loss' };

function renderInjuryTimelineTab(player) {
  ensureCareerHistory(player);
  const injuries = player.careerHistory.injuryHistory;
  if (injuries.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No injuries on record.</div></div></div>';

  let html = '<div class="panel"><table class="data-table"><thead><tr><th>Season</th><th>Type</th><th>Severity</th>' +
    '<th class="num">Est. Days</th><th class="num">Actual Days</th><th class="num">Games Out</th><th>Return</th><th>Notes</th></tr></thead><tbody>';
  injuries.slice().reverse().forEach(function (i) {
    const pillClass = SEVERITY_PILL[i.severity] || 'pill-mute';
    html += '<tr><td class="num">' + i.season + '</td><td>' + (i.type || '—') + '</td><td><span class="pill ' + pillClass + '">' + i.severity + '</span></td>' +
      '<td class="num">' + (i.estimatedRecoveryDays === null ? 'Season' : i.estimatedRecoveryDays) + '</td><td class="num">' + (i.actualRecoveryDays === null ? '—' : i.actualRecoveryDays) +
      '</td><td class="num">' + i.gamesOut + '</td><td>' + (i.returnDate || '—') + '</td><td>' + (i.notes || '') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

const PLAYER_PROFILE_TABS = [
  { id: 'overview', label: 'Career Stats' },
  { id: 'seasons', label: 'Season Breakdown' },
  { id: 'teams', label: 'Team History' },
  { id: 'injuries', label: 'Injury Timeline' }
];

function openPlayerProfile(playerId) {
  GameState.profilePlayerId = playerId;
  renderView('playerProfile');
}

function renderPlayerProfile(container) {
  const player = getPlayerById(GameState.profilePlayerId);
  if (!player) {
    container.innerHTML = '<div class="view-header"><h2>Player Profile</h2></div><div class="empty-state">No player selected. Pick one from the Roster or Career Ledger.</div>';
    return;
  }
  ensureCareerData([player]);

  let activeTab = 'overview';
  let sortKey = 'season';
  let sortDir = -1;

  function draw() {
    const team = player.teamId ? getTeamById(player.teamId) : null;
    let html = '<div class="view-header"><h2>' + player.name + '</h2><span class="view-sub">' +
      player.position + ' · Age ' + player.age + (team ? ' · ' + team.name : ' · Free Agent') + '</span></div>';
    html += renderCurrentSeasonPanel(player);
    html += '<div class="tab-bar">';
    PLAYER_PROFILE_TABS.forEach(function (t) {
      html += '<button class="tab-btn' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    });
    html += '</div>';

    if (activeTab === 'overview') html += renderCareerStatsTab(player);
    else if (activeTab === 'seasons') html += renderSeasonBreakdownTab(player, sortKey, sortDir);
    else if (activeTab === 'teams') html += renderTeamHistoryTab(player);
    else if (activeTab === 'injuries') html += renderInjuryTimelineTab(player);

    container.innerHTML = html;

    container.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.getAttribute('data-tab'); draw(); });
    });
    container.querySelectorAll('th[data-sort-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-sort-key');
        if (key === sortKey) { sortDir = -sortDir; } else { sortKey = key; sortDir = -1; }
        draw();
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pctString: pctString,
    seasonRowsForPlayer: seasonRowsForPlayer,
    renderPlayerProfile: renderPlayerProfile,
    openPlayerProfile: openPlayerProfile
  };
}
