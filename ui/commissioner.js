function renderCommissioner(container, userTeamId) {
  if (GameState.playMode !== 'commissioner') {
    container.innerHTML = '<div class="view-header"><h2>Commissioner Tools</h2></div>' +
      '<div class="empty-state">Commissioner tools are only available in Commissioner mode.</div>';
    return;
  }

  const state = {
    editPlayerId: null,
    editMessage: null,
    deletePlayerId: null,
    deleteConfirming: false,
    deleteMessage: null,
    createMessage: null,
    expansionResult: null
  };

  function draw() {
    let html = '<div class="view-header"><h2>Commissioner Tools</h2></div>';
    html += renderEditPlayerSection(state);
    html += renderDeletePlayerSection(state);
    html += renderCreatePlayerSection(state);
    html += renderExpansionTeamSection(state);
    container.innerHTML = html;
    wireEditPlayerEvents(state, draw);
    wireDeletePlayerEvents(state, draw);
    wireCreatePlayerEvents(state, draw);
    wireExpansionTeamEvents(state, draw);
  }

  draw();
}

function renderEditPlayerSection(state) {
  let html = '<div class="panel"><div class="panel-header">Edit Player</div><div class="panel-body">';
  html += '<div class="toolbar"><select id="commissioner-edit-select" style="min-width:280px;"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.editPlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select></div>';

  if (state.editPlayerId) {
    const player = getPlayerById(state.editPlayerId);
    html += '<table class="data-table"><tbody>';
    html += '<tr><td class="col-name">Overall</td><td class="num"><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="overall" value="' + player.overall + '" style="width:80px;"></td></tr>';
    html += '<tr><td class="col-name">Potential</td><td class="num"><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="potential" value="' + player.potential + '" style="width:80px;"></td></tr>';
    ATTRIBUTE_KEYS.forEach(function (key) {
      html += '<tr><td>' + key + '</td><td class="num"><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-attribute="' + key + '" value="' + player.attributes[key] + '" style="width:80px;"></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="toolbar" style="margin:14px 0 0;"><button id="commissioner-edit-save-btn" class="btn-primary">Save Changes</button>';
    if (state.editMessage) {
      html += '<span class="kpi-sub">' + state.editMessage + '</span>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function wireEditPlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-edit-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.editPlayerId = e.target.value || null;
      state.editMessage = null;
      redraw();
    });
  }
  const saveBtn = document.getElementById('commissioner-edit-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      const changes = {
        overall: Number(document.querySelector('input[data-edit-field="overall"]').value),
        potential: Number(document.querySelector('input[data-edit-field="potential"]').value),
        attributes: {}
      };
      document.querySelectorAll('input[data-edit-attribute]').forEach(function (input) {
        changes.attributes[input.getAttribute('data-edit-attribute')] = Number(input.value);
      });
      editPlayerRatings(state.editPlayerId, changes);
      state.editMessage = 'Saved.';
      redraw();
    });
  }
}

// A native confirm() dialog is deliberately avoided here (untestable via
// browser automation, and no precedent for it elsewhere in this codebase) in
// favor of an inline two-click confirm, tracked in state.
function renderDeletePlayerSection(state) {
  let html = '<div class="panel"><div class="panel-header">Delete Player</div><div class="panel-body"><div class="toolbar">';
  html += '<select id="commissioner-delete-select" style="min-width:280px;"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.deletePlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select>';
  if (state.deletePlayerId && state.deleteConfirming) {
    html += '<button id="commissioner-delete-confirm-btn" class="btn-danger">Confirm Delete — Cannot Be Undone</button>';
    html += '<button id="commissioner-delete-cancel-btn" class="btn-ghost">Cancel</button>';
  } else {
    html += '<button id="commissioner-delete-btn" class="btn-danger"' + (state.deletePlayerId ? '' : ' disabled') + '>Delete Player</button>';
  }
  if (state.deleteMessage) {
    html += '<span class="kpi-sub">' + state.deleteMessage + '</span>';
  }
  html += '</div></div></div>';
  return html;
}

function wireDeletePlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-delete-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.deletePlayerId = e.target.value || null;
      state.deleteConfirming = false;
      state.deleteMessage = null;
      redraw();
    });
  }
  const deleteBtn = document.getElementById('commissioner-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      state.deleteConfirming = true;
      redraw();
    });
  }
  const confirmBtn = document.getElementById('commissioner-delete-confirm-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      deletePlayer(state.deletePlayerId);
      state.deletePlayerId = null;
      state.deleteConfirming = false;
      state.deleteMessage = 'Deleted.';
      redraw();
    });
  }
  const cancelBtn = document.getElementById('commissioner-delete-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      state.deleteConfirming = false;
      redraw();
    });
  }
}

function renderCreatePlayerSection(state) {
  let html = '<div class="panel"><div class="panel-header">Create Player</div><div class="panel-body"><div class="form-grid">';
  html += '<label>Name</label><input type="text" id="commissioner-create-name">';
  html += '<label>Position</label><select id="commissioner-create-position">' + POSITIONS.map(function (pos) { return '<option value="' + pos + '">' + pos + '</option>'; }).join('') + '</select>';
  html += '<label>Age</label><input type="number" id="commissioner-create-age" min="18" max="45" value="22">';
  html += '<label>Overall</label><input type="number" id="commissioner-create-overall" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="60">';
  html += '<label>Potential</label><input type="number" id="commissioner-create-potential" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="70">';
  html += '<label>Archetype</label><select id="commissioner-create-archetype">' + CREATE_PLAYER_ARCHETYPES.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select>';
  html += '<label>Team</label><select id="commissioner-create-team"><option value="">Free Agent</option>' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select>';
  html += '</div><div class="toolbar" style="margin:14px 0 0;"><button id="commissioner-create-btn" class="btn-primary">Create Player</button>';
  if (state.createMessage) {
    html += '<span class="kpi-sub">' + state.createMessage + '</span>';
  }
  html += '</div></div></div>';
  return html;
}

function wireCreatePlayerEvents(state, redraw) {
  const btn = document.getElementById('commissioner-create-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const name = document.getElementById('commissioner-create-name').value.trim();
    if (!name) {
      state.createMessage = 'Name is required.';
      redraw();
      return;
    }
    const details = {
      name: name,
      position: document.getElementById('commissioner-create-position').value,
      age: Number(document.getElementById('commissioner-create-age').value),
      overall: Number(document.getElementById('commissioner-create-overall').value),
      potential: Number(document.getElementById('commissioner-create-potential').value),
      archetype: document.getElementById('commissioner-create-archetype').value,
      teamId: document.getElementById('commissioner-create-team').value || null
    };
    const player = createPlayer(details);
    state.createMessage = 'Created ' + player.name + '.';
    redraw();
  });
}

function renderExpansionTeamSection(state) {
  let html = '<div class="panel"><div class="panel-header">Create Expansion Team</div><div class="panel-body"><div class="form-grid">';
  html += '<label>Name</label><input type="text" id="commissioner-expansion-name">';
  html += '<label>Primary Color</label><input type="color" id="commissioner-expansion-primary" value="#1D1160">';
  html += '<label>Secondary Color</label><input type="color" id="commissioner-expansion-secondary" value="#FFFFFF">';
  html += '<label>Market Size (1-100)</label><input type="number" id="commissioner-expansion-market" min="1" max="100" value="50">';
  html += '</div><div class="toolbar" style="margin:14px 0 0;"><button id="commissioner-expansion-btn" class="btn-primary">Create Expansion Team</button></div>';
  if (state.expansionResult) {
    html += '<p class="kpi-sub">Created ' + state.expansionResult.name + ' (' + state.expansionResult.conference + ' — ' + state.expansionResult.division + '), roster of ' +
      getTeamRoster(state.expansionResult.id).length + ' via expansion draft. Takes effect next season.</p>';
  }
  html += '</div></div>';
  return html;
}

function wireExpansionTeamEvents(state, redraw) {
  const btn = document.getElementById('commissioner-expansion-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const name = document.getElementById('commissioner-expansion-name').value.trim();
    if (!name) return;
    const details = {
      name: name,
      primaryColor: document.getElementById('commissioner-expansion-primary').value,
      secondaryColor: document.getElementById('commissioner-expansion-secondary').value,
      marketSize: Number(document.getElementById('commissioner-expansion-market').value)
    };
    state.expansionResult = createExpansionTeam(details, GameState.rng);
    redraw();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderCommissioner: renderCommissioner };
}
