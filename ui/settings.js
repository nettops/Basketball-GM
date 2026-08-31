const ENGINE_LABELS = {
  boxscore: 'Team Rating + Box Score',
  possession: 'Possession-by-Possession (slower, more granular)'
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
  tradeOfferReceived: 'You receive a trade offer'
};

const CAP_LEVEL_OPTIONS = [
  { value: 0.75, label: 'Low (75% of standard cap)' },
  { value: 1, label: 'Standard' },
  { value: 1.25, label: 'High (125% of standard cap)' },
  { value: 1.5, label: 'Very High (150% of standard cap)' }
];

const INJURY_FREQUENCY_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 0.5, label: 'Low' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Very High' }
];

function renderSettings(container) {
  let html = '<div class="view-header"><h2>Settings</h2></div>';

  html += '<div class="panel"><div class="panel-header">Play Mode <span class="pill pill-mute">' + GameState.playMode + '</span></div>';
  ['gm', 'commissioner', 'spectator'].forEach(function (mode) {
    html += '<label class="toggle-row"><input type="radio" name="play-mode-switch" value="' + mode + '"' +
      (GameState.playMode === mode ? ' checked' : '') + '> ' + mode + '</label>';
  });
  if (!GameState.userTeamId) {
    html += '<div class="panel-body"><p class="kpi-sub">No team selected yet — choose one before switching out of Spectator.</p>';
    html += '<select id="settings-team-picker">' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>'; }).join('') + '</select></div>';
  }
  html += '</div>';

  html += '<div class="panel"><div class="panel-header">Simulation Engine</div>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label class="toggle-row' + (available ? '' : ' is-disabled') + '"><input type="radio" name="sim-engine" value="' +
      engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });
  html += '</div>';

  html += '<div class="panel"><div class="panel-header">League Rules</div><div class="panel-body">' +
    // Difficulty adjusts what the league does AROUND you — never the sim. The
    // blurb says so, because a setting people suspect of rigging games is worse
    // than no setting.
    '<label class="toggle-row" style="display:block;">Difficulty<br><select id="settings-difficulty">' +
    difficultyKeys().map(function (key) {
      const mode = getDifficulty(key);
      const selected = (GameState.settings.difficulty || DEFAULT_DIFFICULTY) === key ? ' selected' : '';
      return '<option value="' + key + '"' + selected + '>' + escapeHtml(mode.label) + '</option>';
    }).join('') + '</select><span class="kpi-sub">' +
    escapeHtml(getDifficulty(GameState.settings.difficulty).blurb) +
    ' Never changes how a game is simulated.</span></label>' +
    '<label class="toggle-row" style="display:block;">Cap Level<br><select id="settings-cap-level">' +
    CAP_LEVEL_OPTIONS.map(function (opt) {
      return '<option value="' + opt.value + '"' + (GameState.settings.capLevel === opt.value ? ' selected' : (opt.value === 1 && GameState.settings.capLevel === undefined ? ' selected' : '')) + '>' + opt.label + '</option>';
    }).join('') + '</select></label>' +
    '<label class="toggle-row" style="display:block;">Injury Frequency<br><select id="settings-injury-frequency">' +
    INJURY_FREQUENCY_OPTIONS.map(function (opt) {
      return '<option value="' + opt.value + '"' + (GameState.settings.injuryFrequency === opt.value ? ' selected' : (opt.value === 1 && GameState.settings.injuryFrequency === undefined ? ' selected' : '')) + '>' + opt.label + '</option>';
    }).join('') + '</select></label>' +
    '<label class="toggle-row" style="display:block;">Draft Lottery Format<br><select id="settings-lottery-format">' +
    Object.keys(LOTTERY_FORMATS).map(function (key) {
      const fmt = LOTTERY_FORMATS[key];
      const selected = (GameState.settings.lotteryFormat || DEFAULT_LOTTERY_FORMAT) === key ? ' selected' : '';
      return '<option value="' + key + '"' + selected + ' title="' + escapeHtml(fmt.description) + '">' + fmt.label + '</option>';
    }).join('') + '</select><span class="kpi-sub">' +
    escapeHtml((LOTTERY_FORMATS[GameState.settings.lotteryFormat] || LOTTERY_FORMATS[DEFAULT_LOTTERY_FORMAT]).description) + '</span></label>' +
    '<label class="toggle-row"><input type="checkbox" id="settings-play-in-enabled"' +
    (GameState.settings.playInEnabled ? ' checked' : '') +
    '> Play-In Tournament (7-10 seeds play in for the final two spots, instead of a straight top-8 cutoff)</label>' +
    '<label class="toggle-row"><input type="checkbox" id="settings-auto-expansion-enabled"' +
    (GameState.settings.autoExpansionEnabled ? ' checked' : '') +
    '> Auto-Expansion (a new team can occasionally join the league once every market is healthy)</label>' +
    // Tested for `=== false` rather than truthiness: an absent setting means
    // ON, so an existing save gets the feature without a migration.
    '<label class="toggle-row"><input type="checkbox" id="settings-dialogue-scenes"' +
    (GameState.settings.dialogueScenes === false ? '' : ' checked') +
    '> Interviews (a halftime word with your coach, and a reporter after the final buzzer)</label>' +
  '</div></div>';

  if (GameState.playMode !== 'spectator') {
    html += '<div class="panel"><div class="panel-header">Automation</div>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label class="toggle-row"><input type="checkbox" data-automation-key="' + key + '"' +
        (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });
    html += '</div>';

    html += '<div class="panel"><div class="panel-header">Pause Multi-Season Sim On</div>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label class="toggle-row"><input type="checkbox" data-pause-on-key="' + key + '"' +
        (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });
    html += '</div>';

    if (GameState.playMode === 'commissioner') {
      html += '<div class="panel"><div class="panel-header">Commissioner</div>';
      html += '<label class="toggle-row"><input type="checkbox" id="settings-disable-cap"' +
        (GameState.settings.capDisabled ? ' checked' : '') +
        '> Disable Salary Cap (free agency and trades ignore cap space entirely)</label></div>';
    }
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

  const dialogueScenesInput = document.getElementById('settings-dialogue-scenes');
  if (dialogueScenesInput) {
    dialogueScenesInput.addEventListener('change', function (e) {
      GameState.settings.dialogueScenes = e.target.checked;
    });
  }

  const disableCapInput = document.getElementById('settings-disable-cap');
  if (disableCapInput) {
    disableCapInput.addEventListener('change', function (e) {
      GameState.settings.capDisabled = e.target.checked;
    });
  }

  document.getElementById('settings-difficulty').addEventListener('change', function (e) {
    GameState.settings.difficulty = e.target.value;
    applyDifficulty(GameState.settings.difficulty, TRADE_TUNING, MARKET_TUNING);
    renderSettings(document.getElementById('view-content'));
  });

  document.getElementById('settings-cap-level').addEventListener('change', function (e) {
    GameState.settings.capLevel = Number(e.target.value);
  });

  document.getElementById('settings-injury-frequency').addEventListener('change', function (e) {
    GameState.settings.injuryFrequency = Number(e.target.value);
  });

  document.getElementById('settings-play-in-enabled').addEventListener('change', function (e) {
    GameState.settings.playInEnabled = e.target.checked;
  });

  document.getElementById('settings-auto-expansion-enabled').addEventListener('change', function (e) {
    GameState.settings.autoExpansionEnabled = e.target.checked;
  });

  document.getElementById('settings-lottery-format').addEventListener('change', function (e) {
    GameState.settings.lotteryFormat = e.target.value;
  });

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSettings: renderSettings, ENGINE_LABELS: ENGINE_LABELS, AUTOMATION_LABELS: AUTOMATION_LABELS, PAUSE_ON_LABELS: PAUSE_ON_LABELS };
}
