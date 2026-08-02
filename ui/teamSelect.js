function renderTeamSelect(container, onSelect, onLoadGame, onSpectate) {
  container.innerHTML =
    '<h1 style="text-align:center;">Choose Your Team</h1>' +
    '<p style="text-align:center;">' +
    '<label><input type="radio" name="play-mode" value="gm" checked> GM (manual control)</label> ' +
    '<label><input type="radio" name="play-mode" value="commissioner"> Commissioner (manual control + sandbox tools)</label>' +
    '</p>' +
    '<div id="team-grid" style="text-align:center;"></div>' +
    '<p style="text-align:center;"><button id="spectate-league-btn">Spectate League (fully automated)</button></p>' +
    '<div id="load-game-section"></div>';

  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.backgroundColor = team.colors.primary;
    card.style.border = '3px solid ' + team.colors.secondary;
    card.innerHTML = teamLogoImgHtml(team.id, 48) + '<div>' + team.name + '</div>';
    card.addEventListener('click', function () {
      const mode = container.querySelector('input[name="play-mode"]:checked').value;
      onSelect(team.id, mode);
    });
    grid.appendChild(card);
  });

  document.getElementById('spectate-league-btn').addEventListener('click', onSpectate);

  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
