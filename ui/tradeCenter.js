function handlePropose(state, userTeamId, redraw) {
  if (state.assignments.length === 0 && state.pickAssignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player or draft pick to the trade first.</p>';
    return;
  }
  const result = proposeTrade(state, userTeamId, false, function (p) { archiveTrade(p, GameState.leagueYear || 2026); }); // the user always controls their own accept/reject when building a trade by hand
  const resultEl = document.getElementById('trade-result');

  if (result.rosterErrors.length > 0) {
    resultEl.innerHTML = '<p>Trade invalid: ' + result.rosterErrors.join('; ') + '</p>';
    return;
  }

  if (result.accepted) {
    // A message written directly to #trade-result would be wiped instantly —
    // redraw() below replaces the whole container's innerHTML synchronously.
    // Route it through state.resultMessage instead (draw() renders it once,
    // then clears it, so it survives exactly one redraw).
    state.resultMessage = '<p>Trade accepted and executed!</p>';
    state.assignments = [];
    state.pickAssignments = [];
    if (GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
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

function handleForceTrade(state, redraw) {
  if (state.assignments.length === 0 && state.pickAssignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player or draft pick to the trade first.</p>';
    return;
  }
  const result = forceTrade(state, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
  const resultEl = document.getElementById('trade-result');
  if (!result.success) {
    resultEl.innerHTML = '<p>Force trade blocked: ' + result.rosterErrors.join('; ') + '</p>';
    return;
  }
  // Same redraw-wipes-the-message issue as handlePropose's accepted branch
  // above — route through state.resultMessage rather than a direct DOM write.
  state.resultMessage = '<p>Trade forced through — no value/salary checks applied.</p>';
  state.assignments = [];
  state.pickAssignments = [];
  redraw();
}

function renderTradeCenter(container, userTeamId) {
  const state = {
    participants: [userTeamId],
    assignments: [], // { playerId, fromTeamId, toTeamId }
    pickAssignments: [], // { round, fromTeamId, toTeamId }
    resultMessage: null // one-shot: rendered into #trade-result once, then cleared
  };

  function draw() {
    let html = '<div class="view-header"><h2>Trade Center</h2></div>';

    if (GameState.playMode === 'spectator') {
      html += '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      container.innerHTML = html;
      return;
    }

    if (GameState.tradeOffers.length > 0) {
      html += '<div class="panel"><div class="panel-header">Incoming Offers <span class="pill pill-gold">' +
        GameState.tradeOffers.length + '</span></div><ul class="stack-list">';
      GameState.tradeOffers.forEach(function (offer, i) {
        const partnerId = offer.proposal.participants.find(function (id) { return id !== userTeamId; });
        const partner = getTeamById(partnerId);
        const mine = offer.proposal.assignments.find(function (a) { return a.fromTeamId === userTeamId; });
        const theirs = offer.proposal.assignments.find(function (a) { return a.fromTeamId === partnerId; });
        html += '<li>' + teamLogoImgHtml(partnerId, 18) + ' <strong>' + partner.name + '</strong> offers ' +
          getPlayerById(theirs.playerId).name + ' for your ' + getPlayerById(mine.playerId).name +
          ' <button class="btn-primary" data-accept-offer="' + i + '">Accept</button> ' +
          '<button class="btn-ghost" data-decline-offer="' + i + '">Decline</button></li>';
      });
      html += '</ul></div>';
    }

    html += '<div class="toolbar"><span class="dock-label">Add participant</span>' +
      '<select id="add-team-select"><option value="">Add a team...</option>';
    TEAMS.forEach(function (t) {
      if (state.participants.indexOf(t.id) === -1) {
        html += '<option value="' + t.id + '">' + t.name + '</option>';
      }
    });
    html += '</select></div>';

    html += '<div class="trade-grid">';

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

      html += '<div class="trade-team-panel panel" data-team-id="' + teamId + '">';
      html += '<div class="panel-header">' + teamLogoImgHtml(teamId, 20) + ' ' + team.name +
        (teamId === userTeamId ? ' <span class="pill pill-mute">You</span>' : '') + '</div>';
      html += '<div class="balance">' +
        '<div class="balance-item"><div class="balance-label">Value Out / In</div>' +
        '<div class="balance-value">' + (outgoingValue + outgoingPickValue).toFixed(1) + ' → ' + (incomingValue + incomingPickValue).toFixed(1) + '</div></div>' +
        '<div class="balance-item"><div class="balance-label">Salary Out / In</div>' +
        '<div class="balance-value">$' + Math.round(outgoingSalary / 1e6) + 'M → $' + Math.round(incomingSalary / 1e6) + 'M</div></div>' +
        '</div>';

      html += '<table class="data-table"><thead><tr><th>Player</th><th class="num">In</th><th>Send to</th></tr></thead><tbody>';
      roster.forEach(function (p) {
        const assignment = state.assignments.find(function (a) { return a.playerId === p.id; });
        html += '<tr><td class="col-name">' + p.name + ' <span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="num"><input type="checkbox" data-player-id="' + p.id + '" data-from-team="' + teamId + '"' + (assignment ? ' checked' : '') + '></td>' +
          '<td><select data-dest-for="' + p.id + '"' + (assignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></td></tr>';
      });
      html += '</tbody></table>';

      html += '<div class="panel-body"><div class="kpi-label">Draft Picks</div>';
      [1, 2].forEach(function (round) {
        const pick = findPick(teamId, round);
        if (!pick) return; // already traded away earlier in this same proposal
        const pickAssignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === teamId && pa.round === round; });
        html += '<div class="field-row"><label style="margin:0;"><input type="checkbox" data-pick-round="' + round +
          '" data-pick-from="' + teamId + '"' + (pickAssignment ? ' checked' : '') + '> Round ' + round + '</label>';
        html += '<select data-pick-dest-round="' + round + '" data-pick-dest-from="' + teamId + '"' + (pickAssignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = pickAssignment && pickAssignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></div>';
      });
      html += '</div></div>';
    });

    html += '</div>';
    html += '<div id="trade-result">' + (state.resultMessage || '') + '</div>';
    state.resultMessage = null;
    html += '<div class="toolbar"><button id="propose-trade-btn" class="btn-primary">Propose Trade</button>';
    if (GameState.playMode === 'commissioner') {
      html += '<button id="force-trade-btn" class="btn-danger">Force Trade</button>';
    }
    html += '</div>';

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
    const forceBtn = document.getElementById('force-trade-btn');
    if (forceBtn) {
      forceBtn.addEventListener('click', function () {
        handleForceTrade(state, draw);
      });
    }

    container.querySelectorAll('button[data-accept-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = Number(btn.getAttribute('data-accept-offer'));
        executeTrade(GameState.tradeOffers[i].proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
        GameState.tradeOffers.splice(i, 1);
        draw();
      });
    });
    container.querySelectorAll('button[data-decline-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        GameState.tradeOffers.splice(Number(btn.getAttribute('data-decline-offer')), 1);
        draw();
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTradeCenter: renderTradeCenter };
}
