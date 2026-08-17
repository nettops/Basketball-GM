// Who your club actually has history with. Heat nobody can see is heat that
// does not exist — and a rivalry is the one piece of league state that is
// supposed to remember last year, so it earns a place next to the table it
// grew out of.
//
// File scope and exported, so the ordering and the "nobody yet" case are
// testable without a DOM.
function rivalriesPanelHtml(state, teamId) {
  const rivals = (typeof rivalsOf === 'function' && state) ? rivalsOf(state, teamId) : [];
  if (rivals.length === 0) {
    return '<div class="panel"><div class="panel-header">Rivalries</div><div class="panel-body">' +
      '<div class="empty-state">No rivalries yet. They are made in the playoffs.</div>' +
      '</div></div>';
  }
  return '<div class="panel"><div class="panel-header">Rivalries</div><div class="panel-body">' +
    '<table class="data-table"><thead><tr><th>Club</th><th class="num">Heat</th><th>Meaning</th></tr></thead><tbody>' +
    rivals.map(function (r) {
      const team = getTeamById(r.teamId);
      const mult = rivalryMultiplier(state, teamId, r.teamId);
      return '<tr><td class="col-name">' + teamLogoImgHtml(r.teamId, 18) + ' ' +
        escapeHtml(team ? team.name : r.teamId) + '</td>' +
        '<td class="num">' + Math.round(r.heat) + '</td>' +
        '<td>wins and losses count ' + mult.toFixed(1) + 'x against them</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

function renderStandings(container) {
  let html = '<div class="view-header"><h2>Standings</h2><span class="view-sub">Click a team to view its roster</span></div><div class="conf-grid">';
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
        const rowClass = (t.id === GameState.userTeamId ? ' row-user' : '') + ' is-clickable';
        html += '<tr class="' + rowClass.trim() + '" data-team-id="' + t.id + '" title="View ' + escapeHtml(t.name) + '\'s roster">' +
          '<td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + escapeHtml(t.name) + '</td>' +
          '<td class="num">' + t.record.wins + '</td><td class="num">' + t.record.losses + '</td>' +
          '<td class="num"' + diffStyle + '>' + diffLabel + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '</div>';
  });
  html += '</div>';
  html += rivalriesPanelHtml(GameState.rivalries, GameState.userTeamId);
  container.innerHTML = html;

  container.querySelectorAll('tr[data-team-id]').forEach(function (row) {
    row.addEventListener('click', function () {
      GameState.inspectTeamId = row.getAttribute('data-team-id');
      renderView('roster');
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    rivalriesPanelHtml: rivalriesPanelHtml, renderStandings: renderStandings };
}
