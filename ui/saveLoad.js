function formatSavedAt(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function saveSlotLabel(slot) {
  if (slot.empty) return 'Slot ' + slot.slotId + ': (empty)';
  const label = slot.slotId === 'autosave' ? 'Autosave' : 'Slot ' + slot.slotId;
  return label + ': ' + slot.name + ' — ' + slot.teamName + ' (' + slot.wins + '-' + slot.losses + ', ' + (slot.leagueYear || 2026) + ') — saved ' + formatSavedAt(slot.savedAt);
}

function renderSaveSlotRow(slot, opts) {
  let html = '<div class="save-slot"><span>' + saveSlotLabel(slot) + '</span>';
  html += ' <button data-load-slot="' + slot.slotId + '"' + (slot.empty ? ' disabled' : '') + '>Load</button>';
  if (opts.showSaveButton) {
    html += ' <button data-save-slot="' + slot.slotId + '">' + (slot.empty ? 'Save' : 'Overwrite') + '</button>';
  }
  if (opts.showDeleteButton && !slot.empty) {
    html += ' <button data-delete-slot="' + slot.slotId + '">Delete</button>';
  }
  html += '</div>';
  return html;
}

function renderSaveList(container, onLoad) {
  const slots = listSaves();
  let html = '<h3>Load Game</h3>';
  slots.forEach(function (slot) { html += renderSaveSlotRow(slot, { showSaveButton: false, showDeleteButton: false }); });
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
    const defaultName = GameState.userTeamId ? getTeamById(GameState.userTeamId).name + ' Save' : 'My Save';

    let html = '<h2>Save / Load</h2>';
    html += '<label>Save name: <input type="text" id="save-name-input" value="' + defaultName + '"></label>';
    html += '<div id="save-slots">';
    slots.forEach(function (slot) {
      html += renderSaveSlotRow(slot, { showSaveButton: slot.slotId !== 'autosave', showDeleteButton: slot.slotId !== 'autosave' });
    });
    html += '</div>';
    html += '<div id="save-message"></div>';

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
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSaveList: renderSaveList, renderSaveLoad: renderSaveLoad };
}
