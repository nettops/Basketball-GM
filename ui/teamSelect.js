function renderTeamSelect(container, onSelect) {
  container.innerHTML = '<h1 style="text-align:center;">Choose Your Team</h1><div style="text-align:center;"></div>';
  const grid = container.querySelector('div');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.backgroundColor = team.colors.primary;
    card.style.border = '3px solid ' + team.colors.secondary;
    card.textContent = team.name;
    card.addEventListener('click', function () { onSelect(team.id); });
    grid.appendChild(card);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamSelect: renderTeamSelect };
}
