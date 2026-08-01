function handlePropose(state, userTeamId, redraw) {
  if (state.assignments.length === 0 && state.pickAssignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player or draft pick to the trade first.</p>';
    return;
  }
  const result = proposeTrade(state, userTeamId);
  const resultEl = document.getElementById('trade-result');

  if (result.rosterErrors.length > 0) {
    resultEl.innerHTML = '<p>Trade invalid: ' + result.rosterErrors.join('; ') + '</p>';
    return;
  }

  if (result.accepted) {
    resultEl.innerHTML = '<p>Trade accepted and executed!</p>';
    state.assignments = [];
    state.pickAssignments = [];
    redraw();
    return;
  }

  let html = '<h4>Trade rejected</h4><ul>';
  Object.keys(result.legs).forEach(function (teamId) {
    const leg = result.legs[teamId];
    if (!leg.accepted && !leg.isUser) {
      html += '<li>' + getTeamById(teamId).name + ': ' + (leg.suggestion || 'not enough value or salary mismatch') + '</li>';
    }
  });
  html += '</ul><p>Adjust the proposal above and propose again.</p>';
  resultEl.innerHTML = html;
}

function renderTradeCenter(container, userTeamId) {
  const state = {
    participants: [userTeamId],
    assignments: [], // { playerId, fromTeamId, toTeamId }
    pickAssignments: [] // { round, fromTeamId, toTeamId }
  };

  function draw() {
    let html = '<h2>Trade Center</h2>';

    html += '<h3>Participants</h3><select id="add-team-select"><option value="">Add a team...</option>';
    TEAMS.forEach(function (t) {
      if (state.participants.indexOf(t.id) === -1) {
        html += '<option value="' + t.id + '">' + t.name + '</option>';
      }
    });
    html += '</select>';

    state.participants.forEach(function (teamId) {
      const team = getTeamById(teamId);
      const roster = getTeamRoster(teamId);
      const outgoing = state.assignments.filter(function (a) { return a.fromTeamId === teamId; });
      const incoming = state.assignments.filter(function (a) { return a.toTeamId === teamId; });
      const outgoingValue = outgoing.reduce(function (s, a) { return s + adjustedPlayerValue(getPlayerById(a.playerId), team); }, 0);
      const incomingValue = incoming.reduce(function (s, a) { return s + adjustedPlayerValue(getPlayerById(a.playerId), team); }, 0);
      const outgoingSalary = outgoing.reduce(function (s, a) { return s + getPlayerById(a.playerId).contract.salary; }, 0);
      const incomingSalary = incoming.reduce(function (s, a) { return s + getPlayerById(a.playerId).contract.salary; }, 0);

      const outgoingPickValue = state.pickAssignments
        .filter(function (pa) { return pa.fromTeamId === teamId; })
        .reduce(function (s, pa) { const pick = findPick(pa.fromTeamId, pa.round); return s + (pick ? estimateFuturePickValue(pa.round, getTeamById(pick.originalTeamId)) : 0); }, 0);
      const incomingPickValue = state.pickAssignments
        .filter(function (pa) { return pa.toTeamId === teamId; })
        .reduce(function (s, pa) { const pick = findPick(pa.fromTeamId, pa.round); return s + (pick ? estimateFuturePickValue(pa.round, getTeamById(pick.originalTeamId)) : 0); }, 0);

      html += '<div class="trade-team-panel" data-team-id="' + teamId + '">';
      html += '<h3>' + team.name + (teamId === userTeamId ? ' (You)' : '') + '</h3>';
      html += '<p>Outgoing value: ' + (outgoingValue + outgoingPickValue).toFixed(1) + ' / Incoming value: ' + (incomingValue + incomingPickValue).toFixed(1) + '</p>';
      html += '<p>Outgoing salary: $' + outgoingSalary.toLocaleString() + ' / Incoming salary: $' + incomingSalary.toLocaleString() + '</p>';

      html += '<table><thead><tr><th>Player</th><th>In trade?</th><th>Send to</th></tr></thead><tbody>';
      roster.forEach(function (p) {
        const assignment = state.assignments.find(function (a) { return a.playerId === p.id; });
        html += '<tr><td>' + p.name + ' (' + p.overall + ' OVR)</td>' +
          '<td><input type="checkbox" data-player-id="' + p.id + '" data-from-team="' + teamId + '"' + (assignment ? ' checked' : '') + '></td>' +
          '<td><select data-dest-for="' + p.id + '"' + (assignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></td></tr>';
      });
      html += '</tbody></table>';

      html += '<p>Draft Picks:</p>';
      [1, 2].forEach(function (round) {
        const pick = findPick(teamId, round);
        if (!pick) return; // already traded away earlier in this same proposal
        const pickAssignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === teamId && pa.round === round; });
        html += '<label><input type="checkbox" data-pick-round="' + round + '" data-pick-from="' + teamId + '"' + (pickAssignment ? ' checked' : '') + '> Round ' + round + ' pick</label> ';
        html += '<select data-pick-dest-round="' + round + '" data-pick-dest-from="' + teamId + '"' + (pickAssignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = pickAssignment && pickAssignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select><br>';
      });
      html += '</div>';
    });

    html += '<div id="trade-result"></div>';
    html += '<button id="propose-trade-btn">Propose Trade</button>';

    container.innerHTML = html;
    wireEvents();
  }

  function wireEvents() {
    document.getElementById('add-team-select').addEventListener('change', function (e) {
      if (e.target.value) {
        state.participants.push(e.target.value);
        draw();
      }
    });

    container.querySelectorAll('input[type="checkbox"][data-player-id]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const playerId = cb.getAttribute('data-player-id');
        const fromTeam = cb.getAttribute('data-from-team');
        if (cb.checked) {
          const destSelect = container.querySelector('select[data-dest-for="' + playerId + '"]');
          const toTeam = destSelect.value || state.participants.filter(function (t) { return t !== fromTeam; })[0];
          state.assignments.push({ playerId: playerId, fromTeamId: fromTeam, toTeamId: toTeam });
        } else {
          state.assignments = state.assignments.filter(function (a) { return a.playerId !== playerId; });
        }
        draw();
      });
    });

    container.querySelectorAll('select[data-dest-for]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const playerId = sel.getAttribute('data-dest-for');
        const assignment = state.assignments.find(function (a) { return a.playerId === playerId; });
        if (assignment) assignment.toTeamId = sel.value;
      });
    });

    container.querySelectorAll('input[type="checkbox"][data-pick-round]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const round = Number(cb.getAttribute('data-pick-round'));
        const fromTeam = cb.getAttribute('data-pick-from');
        if (cb.checked) {
          const destSelect = container.querySelector('select[data-pick-dest-round="' + round + '"][data-pick-dest-from="' + fromTeam + '"]');
          const toTeam = destSelect.value || state.participants.filter(function (t) { return t !== fromTeam; })[0];
          state.pickAssignments.push({ round: round, fromTeamId: fromTeam, toTeamId: toTeam });
        } else {
          state.pickAssignments = state.pickAssignments.filter(function (pa) { return !(pa.fromTeamId === fromTeam && pa.round === round); });
        }
        draw();
      });
    });

    container.querySelectorAll('select[data-pick-dest-round]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const round = Number(sel.getAttribute('data-pick-dest-round'));
        const fromTeam = sel.getAttribute('data-pick-dest-from');
        const assignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === fromTeam && pa.round === round; });
        if (assignment) assignment.toTeamId = sel.value;
      });
    });

    document.getElementById('propose-trade-btn').addEventListener('click', function () {
      handlePropose(state, userTeamId, draw);
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTradeCenter: renderTradeCenter };
}
