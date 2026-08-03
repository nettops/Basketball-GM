function renderRandomEventScene(container, event) {
  if (!event) {
    container.innerHTML = '<div class="panel">No event to display</div>';
    return;
  }

  const decisionButtons = event.decisions.map((dec, idx) => `
    <button
      class="btn btn-primary"
      onclick="handleEventDecision('${event.id}', ${idx}, '${dec.option}')"
      style="display: block; width: 100%; margin: 10px 0; text-align: left; padding: 15px;"
    >
      ${dec.option}
      <br><small>${getDecisionOutcome(dec.outcome)}</small>
    </button>
  `).join('');

  const html = `
    <div class="view-header"><h2>Season ${event.season} Event</h2></div>
    <div class="panel" style="max-width: 600px;">
      <h3 style="color: #FF6600;">${event.type.replace(/_/g, ' ').toUpperCase()}</h3>
      <p style="font-size: 16px; margin: 20px 0;">${event.description}</p>

      <div style="background: #F5F5F5; padding: 15px; border-left: 4px solid #FF6600; margin: 20px 0;">
        <p>${getEventDetailText(event)}</p>
      </div>

      <p style="font-weight: bold; margin: 20px 0;">How do you respond?</p>
      <div>${decisionButtons}</div>
    </div>
  `;

  container.innerHTML = html;
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

function handleEventDecision(eventId, decisionIdx, decisionText) {
  const event = GameState.pendingRandomEvent;
  if (!event || event.id !== eventId) {
    console.error('Event mismatch');
    return;
  }

  const statusEffect = GameState.randomEventSystem.resolveEventDecision(event, decisionText);

  if (statusEffect) {
    const player = getPlayerById(event.playerId);
    if (player) {
      player.overall = Math.max(25, Math.min(99, player.overall + statusEffect.statsPenalty));
      if (player.status) {
        player.status.morale = Math.max(0, Math.min(100, player.status.morale + statusEffect.moralePenalty));
      }
    }

    GameState.playerCareerController.recordDecision('event', decisionText, statusEffect.outcome);
  }

  GameState.pendingRandomEvent = null;
  renderView('playerDashboard');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRandomEventScene };
}
