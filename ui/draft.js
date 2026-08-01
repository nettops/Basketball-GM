function renderDraftResults(container, draftResults) {
  let html = '<h2>2026 Draft Results</h2>';
  html += '<table><thead><tr><th>Pick</th><th>Round</th><th>Team</th><th>Player</th><th>Pos</th><th>OVR</th><th>POT</th></tr></thead><tbody>';
  draftResults.forEach(function (r) {
    const team = getTeamById(r.teamId);
    html += '<tr><td>' + r.pickNumber + '</td><td>' + r.round + '</td><td>' + team.name + '</td><td>' + r.prospect.name + '</td><td>' + r.prospect.position + '</td><td>' + r.prospect.overall + '</td><td>' + r.prospect.potential + '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftResults: renderDraftResults };
}
