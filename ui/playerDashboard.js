function renderPlayerDashboard(container, playerId) {
  const player = getPlayerById(playerId);
  if (!player) {
    container.innerHTML = '<div class="panel">Player not found</div>';
    return;
  }

  const avg = getPlayerAverages(player);
  const season = GameState.leagueYear || 2026;

  const html = `
    <div class="view-header">
      <h2>${player.name}</h2>
      <span class="view-sub">${player.position} | Age ${player.age} | Season ${season}</span>
    </div>

    <div class="panel">
      <div class="panel-header">Career Stats</div>
      <table style="width: 100%;">
        <tr>
          <td><strong>Career Points:</strong> ${player.careerStats.points}</td>
          <td><strong>Championships:</strong> ${player.championshipsWon}</td>
        </tr>
        <tr>
          <td><strong>Seasons Played:</strong> ${player.careerStats.seasonsPlayed}</td>
          <td><strong>MVPs:</strong> ${player.awardsWon.filter(a => a.award === AWARD_KEYS.MVP).length}</td>
        </tr>
      </table>
    </div>

    <div class="panel">
      <div class="panel-header">This Season</div>
      <table class="data-table">
        <tbody>
          <tr>
            <td><strong>Overall Rating:</strong></td>
            <td><span class="rating-chip">${player.overall}</span></td>
          </tr>
          <tr>
            <td><strong>PPG:</strong></td>
            <td>${avg.ppg.toFixed(1)}</td>
          </tr>
          <tr>
            <td><strong>RPG:</strong></td>
            <td>${avg.rpg.toFixed(1)}</td>
          </tr>
          <tr>
            <td><strong>APG:</strong></td>
            <td>${avg.apg.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-header">Badges & Traits</div>
      <div>
        <strong>Badges:</strong> ${player.badges.join(', ') || 'None'}
      </div>
      <div style="margin-top: 10px;">
        <strong>Traits:</strong> ${player.traits.join(', ') || 'None'}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">Quick Actions</div>
      <button class="btn btn-primary" onclick="simulateSeason()">Simulate Season</button>
      <button class="btn btn-ghost" onclick="renderView('dashboard')">Back to Main</button>
    </div>
  `;

  container.innerHTML = html;
}

function simulateSeason() {
  // Placeholder for season simulation
  alert('Season simulation not yet implemented');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerDashboard };
}
