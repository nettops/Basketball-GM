function renderCommissioner(container, userTeamId) {
  if (GameState.playMode !== 'commissioner') {
    container.innerHTML = '<p>Commissioner tools are only available in Commissioner mode.</p>';
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
    let html = '<h2>Commissioner Tools</h2>';
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
  let html = '<section><h3>Edit Player</h3>';
  html += '<select id="commissioner-edit-select"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.editPlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select>';

  if (state.editPlayerId) {
    const player = getPlayerById(state.editPlayerId);
    html += '<table><tbody>';
    html += '<tr><td>Overall</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="overall" value="' + player.overall + '"></td></tr>';
    html += '<tr><td>Potential</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-field="potential" value="' + player.potential + '"></td></tr>';
    ATTRIBUTE_KEYS.forEach(function (key) {
      html += '<tr><td>' + key + '</td><td><input type="number" min="' + RATING_MIN + '" max="' + RATING_MAX + '" data-edit-attribute="' + key + '" value="' + player.attributes[key] + '"></td></tr>';
    });
    html += '</tbody></table>';
    html += '<button id="commissioner-edit-save-btn">Save Changes</button>';
    if (state.editMessage) {
      html += ' <span>' + state.editMessage + '</span>';
    }
  }
  html += '</section>';
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
  let html = '<section><h3>Delete Player</h3>';
  html += '<select id="commissioner-delete-select"><option value="">Choose a player...</option>';
  PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    const teamLabel = p.teamId ? getTeamById(p.teamId).name : 'Free Agent';
    const selected = state.deletePlayerId === p.id ? ' selected' : '';
    html += '<option value="' + p.id + '"' + selected + '>' + p.name + ' (' + teamLabel + ')</option>';
  });
  html += '</select>';
  if (state.deletePlayerId && state.deleteConfirming) {
    html += ' <button id="commissioner-delete-confirm-btn">Confirm Delete — Cannot Be Undone</button>';
    html += ' <button id="commissioner-delete-cancel-btn">Cancel</button>';
  } else {
    html += ' <button id="commissioner-delete-btn"' + (state.deletePlayerId ? '' : ' disabled') + '>Delete Player</button>';
  }
  if (state.deleteMessage) {
    html += ' <span>' + state.deleteMessage + '</span>';
  }
  html += '</section>';
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
  let html = '<section><h3>Create Player</h3>';
  html += '<label>Name <input type="text" id="commissioner-create-name"></label><br>';
  html += '<label>Position <select id="commissioner-create-position">' + POSITIONS.map(function (pos) { return '<option value="' + pos + '">' + pos + '</option>'; }).join('') + '</select></label><br>';
  html += '<label>Age <input type="number" id="commissioner-create-age" min="18" max="45" value="22"></label><br>';
  html += '<label>Overall <input type="number" id="commissioner-create-overall" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="60"></label><br>';
  html += '<label>Potential <input type="number" id="commissioner-create-potential" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="70"></label><br>';
  html += '<label>Archetype <select id="commissioner-create-archetype">' + CREATE_PLAYER_ARCHETYPES.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select></label><br>';
  html += '<label>Team <select id="commissioner-create-team"><option value="">Free Agent</option>' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select></label><br>';
  html += '<button id="commissioner-create-btn">Create Player</button>';
  if (state.createMessage) {
    html += ' <span>' + state.createMessage + '</span>';
  }
  html += '</section>';
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
  let html = '<section><h3>Create Expansion Team</h3>';
  html += '<label>Name <input type="text" id="commissioner-expansion-name"></label><br>';
  html += '<label>Primary Color <input type="color" id="commissioner-expansion-primary" value="#1D1160"></label><br>';
  html += '<label>Secondary Color <input type="color" id="commissioner-expansion-secondary" value="#FFFFFF"></label><br>';
  html += '<label>Market Size (1-100) <input type="number" id="commissioner-expansion-market" min="1" max="100" value="50"></label><br>';
  html += '<button id="commissioner-expansion-btn">Create Expansion Team</button>';
  if (state.expansionResult) {
    html += '<p>Created ' + state.expansionResult.name + ' (' + state.expansionResult.conference + ' — ' + state.expansionResult.division + '), roster of ' +
      getTeamRoster(state.expansionResult.id).length + ' via expansion draft. Takes effect next season.</p>';
  }
  html += '</section>';
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
