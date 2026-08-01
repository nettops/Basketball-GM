const ENGINE_LABELS = {
  boxscore: 'Team Rating + Box Score',
  scoreonly: 'Score Only (coming in a later phase)',
  possession: 'Possession-by-Possession (coming in a later phase)'
};

const AUTOMATION_LABELS = {
  autoFreeAgency: 'Auto Free Agency (sign external FAs and re-sign your own using AI logic)',
  autoDraft: 'Auto Draft (AI picks for your team)',
  autoTrade: 'Auto Trade (AI-generated trade offers auto-execute instead of landing in your inbox)',
  autoCap: 'Auto Roster-Size Compliance (auto-waives your lowest-value player if you go over 15)',
  autoScout: 'Auto Scout (AI spends your weekly scout points)'
};

const PAUSE_ON_LABELS = {
  madePlayoffs: 'Your team makes the playoffs',
  missedPlayoffs: 'Your team misses the playoffs',
  tradeOfferReceived: 'You receive a trade offer',
  keyInjury: 'A key player (80+ OVR) on your team is injured'
};

function renderSettings(container) {
  let html = '<h2>Settings</h2>';

  html += '<h3>Play Mode</h3><p>Current: ' + GameState.playMode + '</p>';
  ['gm', 'commissioner', 'spectator'].forEach(function (mode) {
    html += '<label style="display:block;"><input type="radio" name="play-mode-switch" value="' + mode + '"' + (GameState.playMode === mode ? ' checked' : '') + '> ' + mode + '</label>';
  });
  if (!GameState.userTeamId) {
    html += '<p>No team selected yet — choose one below before switching out of Spectator.</p>';
    html += '<select id="settings-team-picker">' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select>';
  }

  html += '<h3>Simulation Engine</h3>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label style="display:block;"><input type="radio" name="sim-engine" value="' + engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });

  if (GameState.playMode !== 'spectator') {
    html += '<h3>Automation</h3>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-automation-key="' + key + '"' + (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });

    html += '<h3>Pause Multi-Season Sim On</h3>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label style="display:block;"><input type="checkbox" data-pause-on-key="' + key + '"' + (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });
  }

  container.innerHTML = html;

  container.querySelectorAll('input[name="sim-engine"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.simEngine = e.target.value;
    });
  });

  container.querySelectorAll('input[name="play-mode-switch"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      const picker = document.getElementById('settings-team-picker');
      const teamId = picker ? picker.value : null;
      switchPlayMode(e.target.value, teamId);
    });
  });

  container.querySelectorAll('input[data-automation-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.automation[e.target.getAttribute('data-automation-key')] = e.target.checked;
    });
  });

  container.querySelectorAll('input[data-pause-on-key]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.pauseOn[e.target.getAttribute('data-pause-on-key')] = e.target.checked;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSettings: renderSettings, ENGINE_LABELS: ENGINE_LABELS, AUTOMATION_LABELS: AUTOMATION_LABELS, PAUSE_ON_LABELS: PAUSE_ON_LABELS };
}
