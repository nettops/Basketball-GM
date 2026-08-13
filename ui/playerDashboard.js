function renderPlayerDashboard(container, playerId) {
  const player = getPlayerById(playerId);
  if (!player) {
    // Reached whenever there is no controlled player — normal in GM mode, not
    // an error. Matches ui/legacyView.js, the other half of the Career hub,
    // which uses the same empty-state treatment rather than a bare panel.
    container.innerHTML = '<div class="empty-state">No player career to display.</div>';
    return;
  }

  const avg = getPlayerAverages(player);
  const season = GameState.leagueYear || 2026;

  const html = `
    <div class="view-header">
      <h2>${escapeHtml(player.name)}</h2>
      <span class="view-sub">${escapeHtml(player.position)} | Age ${player.age} | Season ${season}</span>
    </div>

    <div class="panel">
      <div class="panel-header">Career Stats</div>
      <table style="width: 100%;">
        <tr>
          <td><strong>Career Points:</strong> ${careerTotalsToDate(player).points}</td>
          <td><strong>Championships:</strong> ${player.championshipsWon}</td>
        </tr>
        <tr>
          <td><strong>Seasons Played:</strong> ${careerTotalsToDate(player).seasonsPlayed}</td>
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
      <div style="margin-top: 10px;">
        <strong>Traits:</strong> ${escapeHtml((player.traits || []).join(', ')) || 'None'}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">Offseason Decisions</div>
      <p><strong>Training Focus</strong> (applied at the next offseason progression):</p>
      <div style="margin: 10px 0;">
        <button class="btn-ghost" onclick="recordTrainingDecision('focus_shooting')">Focus Shooting</button>
        <button class="btn-ghost" onclick="recordTrainingDecision('focus_defense')">Focus Defense</button>
        <button class="btn-ghost" onclick="recordTrainingDecision('focus_athleticism')">Focus Athleticism</button>
        <button class="btn-ghost" onclick="recordTrainingDecision('focus_playmaking')">Focus Playmaking</button>
      </div>
      ${pendingTrainingHtml(player)}
    </div>

    ${leagueInterestHtml(player)}

    ${aroundTheTeamHtml(player)}

    <div class="panel">
      <div class="panel-header">Quick Actions</div>
      <button class="btn-primary" onclick="simulateSeason()">Simulate to End of Season</button>
      <button class="btn-ghost" onclick="renderView('dashboard')">Team Dashboard</button>
      ${player.age >= 34 ? '<button class="btn-ghost" onclick="retireCareerPlayer()">Retire</button>' : ''}
    </div>
  `;

  container.innerHTML = html;
}

// Surfaces PlayerAwarenessModule (aiGmPlayerAwareness.js), which had no caller
// anywhere in the app — the whole "how does the rest of the league value you"
// model was unreachable. Instantiated lazily and cached on GameState so its
// teamInterest tracking accumulates across a career rather than resetting on
// every re-render.
function leagueInterestHtml(player) {
  if (typeof PlayerAwarenessModule === 'undefined') return '';
  if (!GameState.playerAwareness) {
    GameState.playerAwareness = new PlayerAwarenessModule(GameState);
  }
  const awareness = GameState.playerAwareness;
  const value = awareness.evaluatePlayerValue(player.id);
  const offers = awareness.generateTradeOffers(player.id);

  const offerRows = offers.length === 0
    ? '<tr><td colspan="2" class="kpi-sub">No teams are circling yet — keep producing.</td></tr>'
    : offers.map(function (o) {
        const team = getTeamById(o.fromTeamId);
        return '<tr><td>' + escapeHtml(team ? team.name : o.fromTeamId) + '</td>' +
          '<td>$' + o.contractOffer.salary.toLocaleString() + '/yr &times; ' + o.contractOffer.years + ' yrs</td></tr>';
      }).join('');

  return '<div class="panel"><div class="panel-header">League Interest</div>' +
    '<div class="panel-body"><p><strong>Your market value:</strong> <span class="rating-chip">' + value + '</span></p></div>' +
    '<table class="data-table"><tbody>' + offerRows + '</tbody></table></div>';
}

// Surfaces NarrativeSystem, which was constructed by initPlayerCareerMode but
// had no caller anywhere — the whole dialogue library was unreachable content.
// Each NPC's line is picked for the player's current standing: a star season
// (by the same production blend awards.js's mvpValue uses) gets the aggressive
// agent and the friendly GM; a quiet one gets the cautious and shrewd versions.
const NARRATIVE_NPCS = [
  { key: 'agent', label: 'Your Agent', hot: 'agent_aggressive', cold: 'agent_cautious' },
  { key: 'coach', label: 'Head Coach', hot: 'coach_supportive', cold: 'coach_demanding' },
  { key: 'gm', label: 'General Manager', hot: 'gm_friendly', cold: 'gm_shrewd' },
  { key: 'media', label: 'Beat Reporter', hot: 'media_standard', cold: 'media_standard' }
];

function isStarSeason(player) {
  const avg = getPlayerAverages(player);
  return (avg.ppg + avg.rpg * 1.2 + avg.apg * 1.5) >= 25;
}

function aroundTheTeamHtml(player) {
  const narrative = GameState.narrativeSystem;
  if (!narrative) return '';
  const star = isStarSeason(player);

  const rows = NARRATIVE_NPCS.map(function (npc) {
    const line = narrative.getContextualDialogue(
      star ? npc.hot : npc.cold,
      'contract_negotiation',
      { isStarSeason: star }
    );
    narrative.recordNPCInteraction(npc.key, player.id, star ? 'star_season' : 'steady_season');
    return '<tr><td style="white-space:nowrap;"><strong>' + escapeHtml(npc.label) + '</strong></td>' +
      '<td>' + escapeHtml(line) + '</td></tr>';
  }).join('');

  return '<div class="panel"><div class="panel-header">Around the Team</div>' +
    '<table class="data-table"><tbody>' + rows + '</tbody></table></div>';
}

// The controller is null outside player-career mode (and was null after any
// reload before save.js started persisting it), so every read of it is guarded
// rather than assumed.
function pendingTrainingHtml(player) {
  const controller = GameState.playerCareerController;
  if (!controller) return '<small>Training focus is unavailable outside player-career mode.</small>';
  const pending = (controller.decisionHistory || [])
    .filter(function (d) { return d.type === 'training' && !d.applied; })
    .slice(-1)[0];
  if (!pending) return '<small>No training focus selected for next offseason.</small>';
  return '<small>Selected: ' + escapeHtml(pending.decision.replace(/_/g, ' ')) + ' (applies next offseason)</small>';
}

function recordTrainingDecision(trainingType) {
  if (!GameState.playerCareerController) return;
  GameState.playerCareerController.recordDecision('training', trainingType, 'selected');
  renderPlayerDashboard(document.getElementById('view-content'), GameState.controlledPlayerId);
}

// Calls the advance loop directly rather than reaching into the dock for a
// button. This used to click #sim-to-end, and before that matched on the
// button's label text — both broke silently when the dock changed, which is
// twice now. handleSkipTo is the actual interface and cannot be renamed out
// from under this without a load-time error.
function simulateSeason() {
  if (isAdvanceRunning()) return;
  handleSkipTo('seasonEnd');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerDashboard };
}
