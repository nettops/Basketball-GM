function renderDraftPicker(container, session, userTeamId, onPick) {
  const pick = currentPick(session);
  const team = getTeamById(userTeamId);
  const sorted = session.available.slice().sort(function (a, b) { return b.overall - a.overall; });

  let html = '<h2>' + team.name + ' — Round ' + pick.round + ', Pick ' + pick.pickNumber + '</h2>';
  html += '<p>' + session.results.length + ' picks made so far, ' + session.available.length + ' prospects remaining.</p>';
  html += '<table><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Scouted</th><th></th></tr></thead><tbody>';
  sorted.forEach(function (p) {
    const target = GameState.scouting.targets[p.id];
    const confidence = target ? target.confidence : 0;
    const revealed = getRevealedView(p, confidence);
    const scoutedLabel = revealed.level === 'exact' ? 'Fully scouted' : (revealed.level === 'fuzzy' ? 'Partially scouted' : 'Unscouted');
    html += '<tr><td>' + p.name + '</td><td>' + p.position + '</td><td>' + p.age + '</td><td>' + p.overall + '</td><td>' + scoutedLabel + '</td>' +
      '<td><button data-prospect-id="' + p.id + '">Draft</button></td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('button[data-prospect-id]').forEach(function (btn) {
    btn.addEventListener('click', function () { onPick(btn.getAttribute('data-prospect-id')); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftPicker: renderDraftPicker };
}
