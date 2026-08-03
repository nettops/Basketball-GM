function renderLegacyView(container) {
  if (!GameState.playerLegacy) {
    container.innerHTML = '<div class="panel">No player career to display</div>';
    return;
  }

  const legacy = GameState.playerLegacy;
  const hof = legacy.hallOfFame ? 'Hall of Fame Eligible' : '';

  const html = `
    <div class="view-header"><h2>${legacy.name}</h2><span class="view-sub">${hof}</span></div>

    <div class="panel">
      <div class="panel-header">Career Summary</div>
      <table style="width: 100%;">
        <tr>
          <td><strong>Retired:</strong></td>
          <td>Season ${legacy.retiredYear}</td>
        </tr>
        <tr>
          <td><strong>Teams:</strong></td>
          <td>${legacy.teamsPlayedFor.join(', ') || 'None'}</td>
        </tr>
        <tr>
          <td><strong>Career Points:</strong></td>
          <td>${legacy.careerStats.points}</td>
        </tr>
        <tr>
          <td><strong>Career Rebounds:</strong></td>
          <td>${legacy.careerStats.rebounds}</td>
        </tr>
        <tr>
          <td><strong>Career Assists:</strong></td>
          <td>${legacy.careerStats.assists}</td>
        </tr>
        <tr>
          <td><strong>Championships:</strong></td>
          <td>${legacy.championshipsWon}</td>
        </tr>
        <tr>
          <td><strong>Peak Overall:</strong></td>
          <td>${legacy.peakOverall}</td>
        </tr>
        <tr>
          <td><strong>Hall of Fame Score:</strong></td>
          <td>${legacy.hofScore.toFixed(1)}</td>
        </tr>
      </table>
    </div>

    <div class="panel">
      <p style="text-align: center; font-size: 18px;">Your playing career has concluded.</p>
      <p style="text-align: center; margin-top: 20px;">
        <button class="btn btn-primary" onclick="startGMModeFromLegacy()">Continue as GM</button>
      </p>
    </div>
  `;

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderLegacyView };
}
