const ENGINE_LABELS = {
  boxscore: 'Team Rating + Box Score',
  scoreonly: 'Score Only (coming in a later phase)',
  possession: 'Possession-by-Possession (coming in a later phase)'
};

function renderSettings(container) {
  let html = '<h2>Settings</h2><h3>Simulation Engine</h3>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label style="display:block;"><input type="radio" name="sim-engine" value="' + engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });
  container.innerHTML = html;

  container.querySelectorAll('input[name="sim-engine"]').forEach(function (input) {
    input.addEventListener('change', function (e) {
      GameState.settings.simEngine = e.target.value;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSettings: renderSettings, ENGINE_LABELS: ENGINE_LABELS };
}
