function renderDraftPicker(container, session, userTeamId, onPick) {
  const pick = currentPick(session);
  const team = getTeamById(userTeamId);
  const sorted = session.available.slice().sort(function (a, b) { return b.overall - a.overall; });

  let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Round ' + pick.round + ', Pick ' + pick.pickNumber + '</h2>' +
    '<span class="view-sub">' + session.results.length + ' picks made · ' + session.available.length + ' prospects left</span></div>';
  html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
    '<th class="num">OVR</th><th>Scouted</th><th class="num"></th></tr></thead><tbody>';
  sorted.forEach(function (p) {
    const target = GameState.scouting.targets[p.id];
    const confidence = target ? target.confidence : 0;
    const revealed = getRevealedView(p, confidence);
    const scoutPill = revealed.level === 'exact'
      ? '<span class="pill pill-win">Fully scouted</span>'
      : (revealed.level === 'fuzzy' ? '<span class="pill pill-gold">Partial</span>' : '<span class="pill pill-mute">Unscouted</span>');
    html += '<tr><td class="col-name">' + p.name + '</td>' +
      '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
      '<td class="num">' + p.age + '</td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
      '<td>' + scoutPill + '</td>' +
      '<td class="actions"><button class="btn-primary" data-prospect-id="' + p.id + '">Draft</button></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;

  container.querySelectorAll('button[data-prospect-id]').forEach(function (btn) {
    btn.addEventListener('click', function () { onPick(btn.getAttribute('data-prospect-id')); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftPicker: renderDraftPicker };
}
