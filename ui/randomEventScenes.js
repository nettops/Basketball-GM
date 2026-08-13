function renderRandomEventScene(container, event) {
  if (!event) {
    container.innerHTML = '<div class="panel">No event to display</div>';
    return;
  }

  // The decision text is carried in a data-* attribute and read back on click,
  // rather than interpolated into an inline onclick="...('${dec.option}')".
  // That string sits inside a single-quoted JS argument inside a double-quoted
  // HTML attribute — one apostrophe in an option label ("Don't respond") breaks
  // the handler outright, and the index is the stable key anyway.
  const decisionButtons = event.decisions.map((dec, idx) => `
    <button
      class="btn-primary"
      data-decision-index="${idx}"
      style="display: block; width: 100%; margin: 10px 0; text-align: left; padding: 15px;"
    >
      ${escapeHtml(dec.option)}
      <br><small>${escapeHtml(getDecisionOutcome(dec.outcome))}</small>
    </button>
  `).join('');

  const html = `
    <div class="view-header"><h2>Season ${escapeHtml(event.season)} Event</h2></div>
    <div class="panel" style="max-width: 600px;">
      <h3 style="color: #FF6600;">${escapeHtml(event.type.replace(/_/g, ' ').toUpperCase())}</h3>
      <p style="font-size: 16px; margin: 20px 0;">${escapeHtml(event.description)}</p>

      <div style="background: #F5F5F5; padding: 15px; border-left: 4px solid #FF6600; margin: 20px 0;">
        <p>${escapeHtml(getEventDetailText(event))}</p>
      </div>

      <p style="font-weight: bold; margin: 20px 0;">How do you respond?</p>
      <div>${decisionButtons}</div>
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll('[data-decision-index]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = Number(btn.getAttribute('data-decision-index'));
      handleEventDecision(event.id, idx);
    });
  });
}

function getEventDetailText(event) {
  const details = {
    controversy: 'The media is scrutinizing your actions. How you respond will shape your reputation.',
    team_drama: "There's tension in the locker room. Your leadership could help resolve it.",
    player_struggle: "You're not performing at your usual level. Time to figure out what's wrong."
  };
  return details[event.type] || 'An important decision point has arrived.';
}

function getDecisionOutcome(outcome) {
  const descriptions = {
    reputation_recovery: 'Recover reputation, low morale hit',
    media_ignores: 'Media moves on, morale damage',
    media_conflict: 'Escalates the situation',
    resolved: 'Team chemistry improves',
    trade_request: 'Facilitate your own trade',
    coached_through: 'Coach supports you',
    recovery: '70% chance to recover this season',
    rest: '50% chance to recover next season',
    grit: '30% chance but shows leadership'
  };
  return descriptions[outcome] || 'Outcome TBD';
}

function handleEventDecision(eventId, decisionIdx) {
  const event = GameState.pendingRandomEvent;
  if (!event || event.id !== eventId) {
    console.error('Event mismatch');
    return;
  }
  const decision = event.decisions[decisionIdx];
  if (!decision || !GameState.randomEventSystem) return;

  const statusEffect = GameState.randomEventSystem.resolveEventDecision(event, decision.option);

  if (statusEffect) {
    const player = getPlayerById(event.playerId);
    if (player) {
      // `overall` is derived from the attributes now, so a stats penalty has
      // to land on the attributes — writing to overall would throw.
      scaleAttributesToOverall(player, Math.max(0, Math.min(100, player.overall + statusEffect.statsPenalty)));
      if (player.status) {
        player.status.morale = Math.max(0, Math.min(100, player.status.morale + statusEffect.moralePenalty));
      }
    }

    if (GameState.playerCareerController) {
      GameState.playerCareerController.recordDecision('event', decision.option, statusEffect.outcome);
    }
  }

  GameState.pendingRandomEvent = null;
  renderView('playerDashboard');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRandomEventScene };
}
