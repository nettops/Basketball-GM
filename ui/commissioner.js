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
    html += ' <span id="commissioner-edit-result"></span>';
  }
  html += '</section>';
  return html;
}

function wireEditPlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-edit-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.editPlayerId = e.target.value || null;
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
      document.getElementById('commissioner-edit-result').textContent = 'Saved.';
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
  html += ' <span id="commissioner-delete-result"></span>';
  html += '</section>';
  return html;
}

function wireDeletePlayerEvents(state, redraw) {
  const select = document.getElementById('commissioner-delete-select');
  if (select) {
    select.addEventListener('change', function (e) {
      state.deletePlayerId = e.target.value || null;
      state.deleteConfirming = false;
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
      document.getElementById('commissioner-delete-result').textContent = 'Deleted.';
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
