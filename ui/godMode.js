// God Mode panel — a deliberately unrealistic cheat/debug toolkit (see
// godMode.js for the core mutations). Gated behind an explicit "Enable God
// Mode" switch so the cheat buttons are never one accidental click away
// during normal play.
function renderGodMode(container) {
  let message = null;

  function draw() {
    const enabled = GameState.godMode.enabled;
    let html = '<div class="view-header"><h2>God Mode</h2><span class="view-sub">Cheat/debug toolkit — for testing or just messing around, not realistic play</span></div>';

    html += '<div class="panel"><div class="panel-body toolbar" style="justify-content:space-between;align-items:center;">' +
      '<label class="toggle-row"><input type="checkbox" id="godmode-enabled"' + (enabled ? ' checked' : '') +
      '> <strong>Enable God Mode</strong></label>' +
      (message ? '<span class="kpi-sub">' + message + '</span>' : '') +
      '</div></div>';

    if (!enabled) {
      html += '<div class="empty-state">Flip the switch above to unlock the cheat panel.</div>';
      container.innerHTML = html;
      wireEnableToggle();
      return;
    }

    if (!GameState.userTeamId) {
      html += '<div class="empty-state">Select a team first (Spectate mode has no team to cheat for).</div>';
      container.innerHTML = html;
      wireEnableToggle();
      return;
    }

    const team = getTeamById(GameState.userTeamId);
    const roster = getTeamRoster(GameState.userTeamId);

    html += '<div class="panel"><div class="panel-header">Roster</div><div class="panel-body toolbar">' +
      '<button class="btn-primary" id="godmode-max-roster">Max Out My Roster (' + roster.length + ' players &rarr; 99 OVR/POT/all attributes)</button> ' +
      '<button class="btn-primary" id="godmode-heal-roster">Heal &amp; Refresh Team (clear injuries, zero fatigue, full morale)</button>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-header">' + escapeHtml(team.name) + '</div><div class="panel-body toolbar">' +
      '<button class="btn-primary" id="godmode-max-vibes">Max Team Vibes (chemistry/fan/owner happiness/prestige &rarr; 99)</button> ' +
      '<button class="btn-primary" id="godmode-unlimited-money">Unlimited Money (cash &rarr; $' + GODMODE_CASH_GRANT.toLocaleString() + ', max arena)</button>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-header">Simulation</div><div class="panel-body">' +
      '<label class="toggle-row"><input type="checkbox" id="godmode-auto-win"' + (GameState.godMode.autoWinEnabled ? ' checked' : '') + '> ' +
      'Auto-Win: rescue every game your team would otherwise lose (regular season and playoffs)</label>' +
      '<label class="toggle-row"><input type="checkbox" id="godmode-cap-disabled"' + (GameState.settings.capDisabled ? ' checked' : '') + '> ' +
      'Disable Salary Cap (free agency and trades ignore cap space entirely)</label>' +
      '</div></div>';

    container.innerHTML = html;
    wireEnableToggle();

    document.getElementById('godmode-max-roster').addEventListener('click', function () {
      const count = maxOutRoster(GameState.userTeamId);
      message = 'Maxed out ' + count + ' players on ' + escapeHtml(team.name) + '.';
      draw();
    });
    document.getElementById('godmode-heal-roster').addEventListener('click', function () {
      const count = healRoster(GameState.userTeamId);
      message = 'Healed and refreshed ' + count + ' players.';
      draw();
    });
    document.getElementById('godmode-max-vibes').addEventListener('click', function () {
      maxTeamVibes(team);
      message = escapeHtml(team.name) + '\'s chemistry, fan happiness, owner happiness, and prestige are all maxed.';
      draw();
    });
    document.getElementById('godmode-unlimited-money').addEventListener('click', function () {
      grantUnlimitedMoney(team);
      message = escapeHtml(team.name) + ' now has $' + GODMODE_CASH_GRANT.toLocaleString() + ' cash and a maxed-out arena.';
      draw();
    });
    document.getElementById('godmode-auto-win').addEventListener('change', function (e) {
      GameState.godMode.autoWinEnabled = e.target.checked;
    });
    document.getElementById('godmode-cap-disabled').addEventListener('change', function (e) {
      GameState.settings.capDisabled = e.target.checked;
    });
  }

  function wireEnableToggle() {
    document.getElementById('godmode-enabled').addEventListener('change', function (e) {
      GameState.godMode.enabled = e.target.checked;
      message = null;
      draw();
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderGodMode: renderGodMode };
}
