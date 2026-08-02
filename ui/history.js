function renderChampionsSection() {
  let html = '<section><h3>Champions</h3>';
  if (LEAGUE_HISTORY.champions.length === 0) {
    html += '<p>No champion crowned yet.</p></section>';
    return html;
  }
  html += '<ul>';
  LEAGUE_HISTORY.champions.slice().reverse().forEach(function (c) {
    const team = getTeamById(c.teamId);
    html += '<li>' + c.leagueYear + ': ' + (team ? team.name : 'Unknown') + '</li>';
  });
  html += '</ul></section>';
  return html;
}

function renderHallOfFameSection() {
  const inducted = LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; });
  let html = '<section><h3>Hall of Fame</h3>';
  if (inducted.length === 0) {
    html += '<p>No one inducted yet.</p></section>';
    return html;
  }
  html += '<table><thead><tr><th>Name</th><th>Retired</th><th>Career Pts</th><th>Career Reb</th><th>Career Ast</th><th>Championships</th></tr></thead><tbody>';
  inducted.forEach(function (r) {
    html += '<tr><td>' + r.name + '</td><td>' + r.retiredYear + '</td><td>' + r.careerStats.points + '</td><td>' + r.careerStats.rebounds + '</td><td>' + r.careerStats.assists + '</td><td>' + r.championshipsWon + '</td></tr>';
  });
  html += '</tbody></table></section>';
  return html;
}

const RECORD_STAT_LABELS = { points: 'Points', rebounds: 'Rebounds', assists: 'Assists' };

function renderRecordsSection() {
  let html = '<section><h3>Records</h3>';
  html += '<h4>Career Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += careerLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Single-Season Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += singleSeasonLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Most Franchise Wins</h4><p>';
  html += franchiseWinLeaders(5).map(function (l) { return l.name + ' (' + l.allTimeWins + ')'; }).join(', ');
  html += '</p></section>';
  return html;
}

function renderDraftArchiveSection() {
  let html = '<section><h3>Draft Archive</h3>';
  if (LEAGUE_HISTORY.draftClasses.length === 0) {
    html += '<p>No drafts completed yet.</p></section>';
    return html;
  }
  LEAGUE_HISTORY.draftClasses.slice().reverse().forEach(function (dc) {
    html += '<h4>' + dc.leagueYear + '</h4><ol>';
    dc.picks.slice().sort(function (a, b) { return a.pickNumber - b.pickNumber; }).forEach(function (p) {
      const team = getTeamById(p.teamId);
      html += '<li>' + p.playerName + ' — ' + (team ? team.name : 'Unknown') + '</li>';
    });
    html += '</ol>';
  });
  html += '</section>';
  return html;
}

function renderTradeArchiveSection() {
  let html = '<section><h3>Trade Archive</h3>';
  if (LEAGUE_HISTORY.trades.length === 0) {
    html += '<p>No trades executed yet.</p></section>';
    return html;
  }
  html += '<ul>';
  LEAGUE_HISTORY.trades.slice().reverse().forEach(function (t) {
    const teamNames = t.participants.map(function (id) { const team = getTeamById(id); return team ? team.name : 'Unknown'; }).join(' / ');
    const playerNames = t.players.map(function (p) { return p.playerName; }).join(', ');
    html += '<li>' + t.leagueYear + ' — ' + teamNames + ': ' + playerNames + '</li>';
  });
  html += '</ul></section>';
  return html;
}

function renderHistory(container) {
  let html = '<h2>League History</h2>';
  html += renderChampionsSection();
  html += renderHallOfFameSection();
  html += renderRecordsSection();
  html += renderDraftArchiveSection();
  html += renderTradeArchiveSection();
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderHistory: renderHistory };
}
