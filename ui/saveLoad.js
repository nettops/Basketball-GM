function formatSavedAt(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function saveSlotLabel(slot) {
  if (slot.empty) return 'Slot ' + slot.slotId + ': (empty)';
  const label = slot.slotId === 'autosave' ? 'Autosave' : 'Slot ' + slot.slotId;
  return label + ': ' + escapeHtml(slot.name) + ' — ' + escapeHtml(slot.teamName) + ' (' + slot.wins + '-' + slot.losses + ', ' + (slot.leagueYear || 2026) + ') — saved ' + formatSavedAt(slot.savedAt);
}

function downloadSaveFile(slotId, teamNameForFilename) {
  const raw = getRawSlotPayload(slotId);
  if (!raw) return;
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'letshoop-save-' + (teamNameForFilename || 'league').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderSaveSlotRow(slot, opts) {
  const label = slot.slotId === 'autosave' ? 'Autosave' : 'Slot ' + slot.slotId;
  let html = '<div class="save-slot' + (slot.empty ? ' is-empty' : '') + '"><div class="save-slot-info">';
  if (slot.empty) {
    html += '<div class="save-slot-name">' + label + ' — empty</div>';
  } else {
    html += '<div class="save-slot-name">' + label + ' · ' + escapeHtml(slot.name) + '</div>' +
      '<div class="save-slot-meta">' + escapeHtml(slot.teamName) + ' · ' + slot.wins + '-' + slot.losses +
      ' · ' + (slot.leagueYear || 2026) + ' · saved ' + formatSavedAt(slot.savedAt) + '</div>';
  }
  html += '</div>';
  html += '<button data-load-slot="' + slot.slotId + '"' + (slot.empty ? ' disabled' : '') + '>Load</button>';
  if (opts.showSaveButton) {
    html += '<button class="btn-primary" data-save-slot="' + slot.slotId + '">' + (slot.empty ? 'Save' : 'Overwrite') + '</button>';
  }
  if (opts.showDeleteButton && !slot.empty) {
    html += '<button class="btn-danger" data-delete-slot="' + slot.slotId + '">Delete</button>';
  }
  if (opts.showFileButtons && !slot.empty) {
    html += '<button class="btn-ghost" data-export-slot="' + slot.slotId + '">Export</button>' +
      '<button class="btn-ghost" data-clone-slot="' + slot.slotId + '">Clone</button>';
  }
  html += '</div>';
  return html;
}

function renderSaveList(container, onLoad) {
  const slots = listSaves();
  let html = '<div class="panel"><div class="panel-header">Load Game</div>';
  slots.forEach(function (slot) { html += renderSaveSlotRow(slot, { showSaveButton: false, showDeleteButton: false }); });
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('button[data-load-slot]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const raw = btn.getAttribute('data-load-slot');
      onLoad(raw === 'autosave' ? 'autosave' : Number(raw));
    });
  });
}

function renderSaveLoad(container) {
  function draw() {
    const slots = listSaves();
    const defaultName = GameState.userTeamId ? escapeHtml(getTeamById(GameState.userTeamId).name) + ' Save' : 'My Save';

    let html = '<div class="view-header"><h2>Save / Load</h2></div>';
    html += '<div class="panel"><div class="panel-header">Save Name</div><div class="panel-body">' +
      '<input type="text" id="save-name-input" value="' + defaultName + '" style="width:320px;"></div></div>';
    html += '<div class="panel"><div class="panel-header">Slots</div><div id="save-slots">';
    slots.forEach(function (slot) {
      html += renderSaveSlotRow(slot, { showSaveButton: slot.slotId !== 'autosave', showDeleteButton: slot.slotId !== 'autosave', showFileButtons: slot.slotId !== 'autosave' });
    });
    html += '</div></div>';

    html += '<div class="panel"><div class="panel-header">Import League File</div><div class="panel-body">' +
      '<p class="kpi-sub">Load a league exported from this game (or another session) into an empty slot below.</p>' +
      '<div class="toolbar"><input type="file" id="save-import-input" accept="application/json,.json"> ' +
      '<select id="save-import-target">' +
      slots.filter(function (s) { return s.slotId !== 'autosave'; }).map(function (s) {
        return '<option value="' + s.slotId + '">Slot ' + s.slotId + (s.empty ? ' (empty)' : ' (overwrite ' + escapeHtml(s.name) + ')') + '</option>';
      }).join('') + '</select> ' +
      '<button id="save-import-btn" class="btn-primary">Import</button></div></div></div>';

    html += '<div id="save-message" class="kpi-sub"></div>';

    container.innerHTML = html;

    container.querySelectorAll('button[data-save-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const slotId = Number(btn.getAttribute('data-save-slot'));
        const existing = slots.find(function (s) { return s.slotId === slotId; });
        if (existing && !existing.empty && !confirm('Overwrite this save slot?')) return;
        const nameInput = document.getElementById('save-name-input');
        const name = (nameInput.value || '').trim() || 'Save ' + slotId;
        const result = saveToSlot(slotId, name, GameState);
        document.getElementById('save-message').textContent = result.success ? 'Saved.' : result.reason;
        draw();
      });
    });

    container.querySelectorAll('button[data-load-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const raw = btn.getAttribute('data-load-slot');
        const slotId = raw === 'autosave' ? 'autosave' : Number(raw);
        const result = loadFromSlot(slotId, GameState);
        if (!result.success) {
          document.getElementById('save-message').textContent = result.reason;
          return;
        }
        renderView(GameState.currentView || 'dashboard');
      });
    });

    container.querySelectorAll('button[data-delete-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const slotId = Number(btn.getAttribute('data-delete-slot'));
        if (!confirm('Delete this save?')) return;
        deleteSlot(slotId);
        draw();
      });
    });

    container.querySelectorAll('button[data-export-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const slotId = Number(btn.getAttribute('data-export-slot'));
        const slot = slots.find(function (s) { return s.slotId === slotId; });
        downloadSaveFile(slotId, slot ? slot.teamName : null);
      });
    });

    container.querySelectorAll('button[data-clone-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const sourceSlotId = Number(btn.getAttribute('data-clone-slot'));
        const emptySlot = slots.find(function (s) { return s.slotId !== 'autosave' && s.slotId !== sourceSlotId && s.empty; });
        if (!emptySlot) {
          document.getElementById('save-message').textContent = 'No empty slot available to clone into — delete one first.';
          return;
        }
        const source = slots.find(function (s) { return s.slotId === sourceSlotId; });
        // ui-safety: not-markup — this builds the stored save NAME, not HTML.
        // Escaping here would persist "&#39;" into the slot's actual name.
        const result = cloneSlot(sourceSlotId, emptySlot.slotId, source ? source.name + ' (Copy)' : undefined);
        document.getElementById('save-message').textContent = result.success ? 'Cloned into Slot ' + emptySlot.slotId + '.' : result.reason;
        draw();
      });
    });

    document.getElementById('save-import-btn').addEventListener('click', function () {
      const fileInput = document.getElementById('save-import-input');
      const targetSlotId = Number(document.getElementById('save-import-target').value);
      const file = fileInput.files[0];
      if (!file) {
        document.getElementById('save-message').textContent = 'Choose a file to import first.';
        return;
      }
      const existing = slots.find(function (s) { return s.slotId === targetSlotId; });
      if (existing && !existing.empty && !confirm('Overwrite this save slot?')) return;
      const reader = new FileReader();
      reader.onload = function () {
        let payload;
        try {
          payload = JSON.parse(reader.result);
        } catch (e) {
          document.getElementById('save-message').textContent = 'That file is not valid JSON.';
          return;
        }
        const result = importPayloadToSlot(targetSlotId, payload);
        document.getElementById('save-message').textContent = result.success ? 'Imported into Slot ' + targetSlotId + '.' : result.reason;
        draw();
      };
      reader.readAsText(file);
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSaveList: renderSaveList, renderSaveLoad: renderSaveLoad };
}
