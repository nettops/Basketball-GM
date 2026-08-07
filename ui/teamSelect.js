function renderTeamSelect(container, onSelect, onLoadGame, onSpectate, onPlayerCareer) {
  container.innerHTML =
    '<div class="select-screen">' +
    '<div class="select-title">Choose Your Franchise</div>' +
    '<div class="select-sub">Take control of any team in the league.</div>' +
    '<div class="segmented">' +
    '<label><input type="radio" name="play-mode" value="gm" checked> GM <span class="kpi-sub">manual control</span></label>' +
    '<label><input type="radio" name="play-mode" value="commissioner"> Commissioner <span class="kpi-sub">+ sandbox tools</span></label>' +
    '</div>' +
    '<div id="team-grid" class="team-grid"></div>' +
    '<div class="select-actions">' +
    '<button id="spectate-league-btn" class="btn-ghost">Spectate League (fully automated)</button>' +
    (onPlayerCareer ? '<button id="player-career-btn" class="btn-ghost">Player Career (control one athlete)</button>' : '') +
    '</div>' +
    '<div id="load-game-section"></div>' +
    '</div>';

  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.background = 'linear-gradient(150deg, ' + team.colors.primary + ' 0%, ' + team.colors.secondary + ' 190%)';
    card.style.borderColor = team.colors.secondary;
    card.innerHTML = teamLogoImgHtml(team.id, 46) +
      '<div class="team-card-name">' + escapeHtml(team.name) + '</div>' +
      '<div class="team-card-meta">' + team.division + '</div>';
    card.addEventListener('click', function () {
      const mode = container.querySelector('input[name="play-mode"]:checked').value;
      onSelect(team.id, mode);
    });
    grid.appendChild(card);
  });

  document.getElementById('spectate-league-btn').addEventListener('click', onSpectate);

  if (onPlayerCareer) {
    document.getElementById('player-career-btn').addEventListener('click', onPlayerCareer);
  }

  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
