function renderPlayerCreation(container, onPlayerCreated) {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  const colleges = ['Duke', 'California', 'Kansas', 'UCLA', 'North Carolina', 'Kentucky', 'Arizona', 'Other'];

  const availableTraits = ['clutch', 'leader', 'volume_scorer', 'streaky', 'hard_worker', 'confident'];

  let selectedTraits = [];

  const html = `
    <div class="view-header"><h2>Create Your Player</h2></div>
    <div class="panel" style="max-width: 600px;">
      <form id="playerCreationForm">
        <!-- Name -->
        <div class="form-group">
          <label>Name:</label>
          <input type="text" id="playerName" required placeholder="e.g., LeBron James">
        </div>

        <!-- Position -->
        <div class="form-group">
          <label>Position:</label>
          <select id="playerPosition" required>
            <option value="">Select Position</option>
            ${positions.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>

        <!-- College -->
        <div class="form-group">
          <label>College:</label>
          <select id="playerCollege" required>
            <option value="">Select College</option>
            ${colleges.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>

        <!-- Archetype -->
        <div class="form-group">
          <label>Archetype:</label>
          <div id="archetypeSelect">
            ${Object.entries(PLAYER_ARCHETYPES).map(([key, arch]) => `
              <label style="display: block; margin: 8px 0;">
                <input type="radio" name="archetype" value="${key}" required>
                <strong>${escapeHtml(arch.name)}:</strong> ${escapeHtml(arch.description)}
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Traits -->
        <div class="form-group">
          <label>Select up to 3 traits:</label>
          <div id="traitSelect">
            ${availableTraits.map(trait => `
              <label style="display: inline-block; margin-right: 12px;">
                <input type="checkbox" class="traitCheckbox" value="${trait}">
                ${trait.replace(/_/g, ' ')}
              </label>
            `).join('')}
          </div>
          <small>Selected: <span id="traitCount">0</span>/3</small>
        </div>

        <button type="submit" class="btn-primary" style="margin-top: 20px;">Create Player</button>
      </form>
    </div>
  `;

  container.innerHTML = html;

  // Trait selection logic
  const traitCheckboxes = container.querySelectorAll('.traitCheckbox');
  traitCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = Array.from(traitCheckboxes).filter(c => c.checked);
      if (checked.length > 3) {
        cb.checked = false;
        alert('Maximum 3 traits allowed');
      } else {
        selectedTraits = checked.map(c => c.value);
        container.querySelector('#traitCount').textContent = selectedTraits.length;
      }
    });
  });

  // Form submission
  const form = container.querySelector('#playerCreationForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = container.querySelector('#playerName').value.trim();
    const position = container.querySelector('#playerPosition').value;
    const college = container.querySelector('#playerCollege').value;
    const archetype = container.querySelector('input[name="archetype"]:checked').value;

    if (!name) {
      alert('Enter a name');
      return;
    }
    if (!selectedTraits.length) {
      alert('Select at least 1 trait');
      return;
    }

    // Uses the controller initPlayerCareerMode already built and stored on
    // GameState. Constructing a second one here worked only by accident: its
    // decisionHistory (training focus, event choices) would have been written
    // to an object nothing else ever read.
    const controller = GameState.playerCareerController || new PlayerCareerController(GameState);
    GameState.playerCareerController = controller;
    const player = controller.createCustomPlayer(name, position, college, archetype, selectedTraits);

    onPlayerCreated(player);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayerCreation };
}
