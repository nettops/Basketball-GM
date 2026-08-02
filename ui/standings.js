function renderStandings(container) {
  let html = '<div class="view-header"><h2>Standings</h2></div><div class="conf-grid">';
  CONFERENCES.forEach(function (conf) {
    html += '<div class="conf-col"><h3>' + conf + ' Conference</h3>';
    DIVISIONS[conf].forEach(function (div) {
      html += '<div class="panel"><div class="panel-header">' + div + '</div>' +
        '<table class="data-table"><thead><tr><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">Diff</th></tr></thead><tbody>';
      const divTeams = TEAMS.filter(function (t) { return t.conference === conf && t.division === div; })
        .slice()
        .sort(function (a, b) { return b.record.wins - a.record.wins; });
      divTeams.forEach(function (t) {
        const diff = (t.record.pointsFor || 0) - (t.record.pointsAgainst || 0);
        const diffLabel = (diff > 0 ? '+' : '') + diff;
        const diffStyle = diff > 0 ? ' style="color:var(--win)"' : (diff < 0 ? ' style="color:var(--loss)"' : '');
        const rowClass = t.id === GameState.userTeamId ? ' class="row-user"' : '';
        html += '<tr' + rowClass + '><td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + t.name + '</td>' +
          '<td class="num">' + t.record.wins + '</td><td class="num">' + t.record.losses + '</td>' +
          '<td class="num"' + diffStyle + '>' + diffLabel + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderStandings: renderStandings };
}
