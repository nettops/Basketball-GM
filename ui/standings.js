function renderStandings(container) {
  let html = '';
  CONFERENCES.forEach(function (conf) {
    html += '<h2>' + conf + ' Conference</h2>';
    DIVISIONS[conf].forEach(function (div) {
      html += '<h3>' + div + '</h3><table><thead><tr><th>Team</th><th>W</th><th>L</th></tr></thead><tbody>';
      const divTeams = TEAMS.filter(function (t) { return t.conference === conf && t.division === div; })
        .slice()
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      divTeams.forEach(function (t) {
        html += '<tr><td>' + t.name + '</td><td>' + t.record.wins + '</td><td>' + t.record.losses + '</td></tr>';
      });
      html += '</tbody></table>';
    });
  });
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderStandings: renderStandings };
}
