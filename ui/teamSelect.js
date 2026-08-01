function renderTeamSelect(container, onSelect, onLoadGame) {
  container.innerHTML = '<h1 style="text-align:center;">Choose Your Team</h1><div id="team-grid" style="text-align:center;"></div><div id="load-game-section"></div>';
  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.backgroundColor = team.colors.primary;
    card.style.border = '3px solid ' + team.colors.secondary;
    card.textContent = team.name;
    card.addEventListener('click', function () { onSelect(team.id); });
    grid.appendChild(card);
  });
  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
