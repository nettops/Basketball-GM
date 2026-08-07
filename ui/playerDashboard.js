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
      <div class="panel-header">Offseason Decisions</div>
      <p><strong>Training Focus</strong> (applied at the next offseason progression):</p>
      <div style="margin: 10px 0;">
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_shooting')">Focus Shooting</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_defense')">Focus Defense</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_athleticism')">Focus Athleticism</button>
        <button class="btn btn-ghost" onclick="recordTrainingDecision('focus_playmaking')">Focus Playmaking</button>
      </div>
      ${pendingTrainingHtml(player)}
    </div>

    <div class="panel">
      <div class="panel-header">Quick Actions</div>
      <button class="btn btn-primary" onclick="simulateSeason()">Simulate to End of Season</button>
      <button class="btn btn-ghost" onclick="renderView('dashboard')">Team Dashboard</button>
      ${player.age >= 34 ? '<button class="btn btn-ghost" onclick="retireCareerPlayer()">Retire</button>' : ''}
    </div>
  `;

  container.innerHTML = html;
}

function pendingTrainingHtml(player) {
  const pending = GameState.playerCareerController.decisionHistory
    .filter(function (d) { return d.type === 'training' && !d.applied; })
    .slice(-1)[0];
  if (!pending) return '<small>No training focus selected for next offseason.</small>';
  return '<small>Selected: ' + pending.decision.replace(/_/g, ' ') + ' (applies next offseason)</small>';
}

function recordTrainingDecision(trainingType) {
  GameState.playerCareerController.recordDecision('training', trainingType, 'selected');
  renderPlayerDashboard(document.getElementById('view-content'), GameState.controlledPlayerId);
}

// Calls the advance loop directly rather than hunting the dock for a button.
// This used to match on the button's label text, which only worked during the
// regular season — the dock renamed it once a bracket existed. The dock no
// longer has that button at all, so the coupling is gone entirely:
// handleSkipTo is the actual interface.
function simulateSeason() {
  if (isAdvanceRunning()) return;
  handleSkipTo('seasonEnd');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerDashboard };
}
