function renderChampionsSection() {
  let html = '<div class="panel"><div class="panel-header">Champions</div>';
  if (LEAGUE_HISTORY.champions.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No champion crowned yet.</div></div></div>';
  }
  html += '<ul class="stack-list">';
  LEAGUE_HISTORY.champions.slice().reverse().forEach(function (c) {
    const team = getTeamById(c.teamId);
    html += '<li><span class="pill pill-gold">' + c.leagueYear + '</span> ' +
      (team ? teamLogoImgHtml(team.id, 18) + ' ' + escapeHtml(team.name) : 'Unknown') + '</li>';
  });
  return html + '</ul></div>';
}

function renderHallOfFameSection() {
  const inducted = LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; });
  let html = '<div class="panel"><div class="panel-header">Hall of Fame</div>';
  if (inducted.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No one inducted yet.</div></div></div>';
  }
  html += '<table class="data-table"><thead><tr><th>Name</th><th class="num">Retired</th><th class="num">Pts</th>' +
    '<th class="num">Reb</th><th class="num">Ast</th><th class="num">Titles</th></tr></thead><tbody>';
  inducted.forEach(function (r) {
    html += '<tr><td class="col-name">' + escapeHtml(r.name) + '</td><td class="num">' + r.retiredYear + '</td><td class="num">' +
      r.careerStats.points + '</td><td class="num">' + r.careerStats.rebounds + '</td><td class="num">' +
      r.careerStats.assists + '</td><td class="num">' + r.championshipsWon + '</td></tr>';
  });
  return html + '</tbody></table></div>';
}

function renderRetiredNumbersSection() {
  const teamsWithNumbers = TEAMS.filter(function (t) { return t.retiredNumbers && t.retiredNumbers.length > 0; });
  let html = '<div class="panel"><div class="panel-header">Retired Numbers</div>';
  if (teamsWithNumbers.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No numbers retired yet — a Hall of Fame induction retires the player\'s number with their last team.</div></div></div>';
  }
  html += '<ul class="stack-list">';
  teamsWithNumbers.forEach(function (t) {
    const owners = t.retiredNumbers.map(function (num) {
      const retiree = LEAGUE_HISTORY.retiredPlayers.find(function (r) { return r.lastTeamId === t.id && r.jerseyNumber === num && r.hallOfFame; });
      return '#' + num + (retiree ? ' (' + escapeHtml(retiree.name) + ')' : '');
    }).join(', ');
    html += '<li>' + teamLogoImgHtml(t.id, 18) + ' <strong>' + escapeHtml(t.name) + '</strong>: ' + owners + '</li>';
  });
  return html + '</ul></div>';
}

const RECORD_STAT_LABELS = { points: 'Points', rebounds: 'Rebounds', assists: 'Assists' };

function renderRecordsSection() {
  let html = '<div class="panel"><div class="panel-header">Records</div><div class="panel-body">';
  html += '<h4>Career Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += careerLeaders(statKey, 5).map(function (l) { return escapeHtml(l.name) + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Single-Season Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += singleSeasonLeaders(statKey, 5).map(function (l) { return escapeHtml(l.name) + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Most Franchise Wins</h4><p>';
  html += franchiseWinLeaders(5).map(function (l) { return escapeHtml(l.name) + ' (' + l.allTimeWins + ')'; }).join(', ');
  return html + '</p></div></div>';
}

function renderDraftArchiveSection() {
  let html = '<div class="panel"><div class="panel-header">Draft Archive</div>';
  if (LEAGUE_HISTORY.draftClasses.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No drafts completed yet.</div></div></div>';
  }
  html += '<div class="panel-body">';
  LEAGUE_HISTORY.draftClasses.slice().reverse().forEach(function (dc) {
    html += '<h4>' + dc.leagueYear + '</h4><ol>';
    dc.picks.slice().sort(function (a, b) { return a.pickNumber - b.pickNumber; }).forEach(function (p) {
      const team = getTeamById(p.teamId);
      html += '<li>' + escapeHtml(p.playerName) + ' — ' + (team ? escapeHtml(team.name) : 'Unknown') + '</li>';
    });
    html += '</ol>';
  });
  return html + '</div></div>';
}

function renderTradeArchiveSection() {
  let html = '<div class="panel"><div class="panel-header">Trade Archive</div>';
  if (LEAGUE_HISTORY.trades.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No trades executed yet.</div></div></div>';
  }
  html += '<ul class="stack-list">';
  LEAGUE_HISTORY.trades.slice().reverse().forEach(function (t) {
    const teamNames = t.participants.map(function (id) { const team = getTeamById(id); return escapeHtml(team ? team.name : 'Unknown'); }).join(' / ');
    const playerNames = t.players.map(function (p) { return escapeHtml(p.playerName); }).join(', ');
    html += '<li><span class="pill pill-mute">' + t.leagueYear + '</span> ' + teamNames + ': ' + playerNames + '</li>';
  });
  return html + '</ul></div>';
}

function renderHistory(container) {
  let html = '<div class="view-header"><h2>League History</h2></div>';
  html += renderChampionsSection();
  html += renderHallOfFameSection();
  html += renderRetiredNumbersSection();
  html += renderRecordsSection();
  html += renderDraftArchiveSection();
  html += renderTradeArchiveSection();
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderHistory: renderHistory };
}
