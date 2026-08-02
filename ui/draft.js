function renderDraftResults(container, draftResults) {
  let html = '<div class="view-header"><h2>Draft Results</h2><span class="view-sub">' + draftResults.length + ' picks</span></div>';
  if (draftResults.length === 0) {
    container.innerHTML = html + '<div class="empty-state">No draft has been completed yet.</div>';
    return;
  }
  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Pick</th><th class="num">Rd</th>' +
    '<th>Team</th><th>Player</th><th>College</th><th>Pos</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>';
  draftResults.forEach(function (r) {
    const team = getTeamById(r.teamId);
    html += '<tr><td class="num">' + r.pickNumber + '</td><td class="num">' + r.round + '</td>' +
      '<td class="col-name">' + teamLogoImgHtml(team.id, 18) + ' ' + team.name + '</td>' +
      '<td class="col-name">' + r.prospect.name + '</td>' +
      '<td>' + (r.prospect.college || '—') + '</td>' +
      '<td><span class="pill pill-pos">' + r.prospect.position + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.overall) + '">' + r.prospect.overall + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.potential) + '">' + r.prospect.potential + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftResults: renderDraftResults };
}
