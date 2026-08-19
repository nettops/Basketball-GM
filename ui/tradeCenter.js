// Browsable list of every player leaguewide flagged onTradeBlock (toggled
// per-team below, in the trade grid) — AI teams' generateTradeOffer
// (autoGM.js) already weighs these players more favorably as trade targets,
// so this panel is what lets the user see what's actually available before
// building a proposal.
function leagueTradingBlockHtml(userTeamId) {
  const flagged = TEAMS.reduce(function (all, t) { return all.concat(getTeamRoster(t.id)); }, [])
    .filter(function (p) { return p.onTradeBlock; })
    .sort(function (a, b) { return b.overall - a.overall; });
  if (flagged.length === 0) return '';
  return '<div class="panel"><div class="panel-header">League Trading Block <span class="pill pill-mute">' + flagged.length + '</span></div>' +
    '<table class="data-table"><thead><tr><th>Player</th><th>Team</th><th class="num">OVR</th><th class="num">Salary</th></tr></thead><tbody>' +
    flagged.map(function (p) {
      const rowClass = p.teamId === userTeamId ? ' class="row-user"' : '';
      const pTeam = getTeamById(p.teamId);
      // No player picture here. This is a comparison table -- name, team,
      // rating, salary -- and a 14px figure does not help anyone decide a
      // trade, it just costs a column.
      return '<tr' + rowClass + '><td class="col-name">' + escapeHtml(p.name) + '</td><td>' + teamLogoImgHtml(p.teamId, 16) + ' ' + escapeHtml(pTeam.name) + '</td>' +
        '<td class="num">' + p.overall + '</td><td class="num">$' + p.contract.salary.toLocaleString() + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function handlePropose(state, userTeamId, redraw) {
  if (state.assignments.length === 0 && state.pickAssignments.length === 0) {
    document.getElementById('trade-result').innerHTML = '<p>Add at least one player or draft pick to the trade first.</p>';
    return;
  }
  pushUndoSnapshot(GameState); // before the (possibly irreversible) trade executes
  // evaluateUserLeg false: a hand-built trade is never second-guessed on
  // VALUE — but the user's leg still runs the salary-matching law (see
  // trade.js's evaluateTrade), so a rejection below can now be OURS.
  const result = proposeTrade(state, userTeamId, false, function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
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
    // The user's own leg can refuse too now — on salary only — and hiding
    // that reason would leave a "rejected" verdict with an empty list.
    if (!leg.accepted) {
      html += '<li>' + escapeHtml(getTeamById(teamId).name) + (leg.isUser ? ' (your side)' : '') + ': ' +
        (leg.suggestion || 'not enough value or salary mismatch') + '</li>';
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
  pushUndoSnapshot(GameState);
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
        // An offer with no side belonging to the user cannot be described, let
        // alone accepted. initSeason now clears the inbox for a new league, but
        // a save written before that fix still carries the old league's offers,
        // and one of them used to take the entire Trade screen down with a
        // TypeError. Skip it rather than throw.
        if (!partner || !mine || !theirs ||
            !getPlayerById(mine.playerId) || !getPlayerById(theirs.playerId)) return;
        // Offers lapse after TRADE_OFFER_EXPIRY_DAYS (trade.js). Showing the
        // countdown is what makes ignoring one a decision rather than an
        // accident — the offer disappears silently, so the deadline has to be
        // visible while it still matters.
        const daysLeft = typeof offer.dayReceived === 'number'
          ? TRADE_OFFER_EXPIRY_DAYS - (GameState.season.currentDay - offer.dayReceived)
          : TRADE_OFFER_EXPIRY_DAYS;
        const expiryHtml = ' <span class="offer-expiry' + (daysLeft <= 2 ? ' is-urgent' : '') + '">' +
          (daysLeft <= 1 ? 'expires today' : 'expires in ' + daysLeft + ' days') + '</span>';
        html += '<li>' + teamLogoImgHtml(partnerId, 18) + ' <strong>' + escapeHtml(partner.name) + '</strong> offers ' +
          escapeHtml(getPlayerById(theirs.playerId).name) + ' for your ' + escapeHtml(getPlayerById(mine.playerId).name) +
          expiryHtml +
          ' <button class="btn-primary" data-accept-offer="' + i + '">Accept</button> ' +
          '<button class="btn-ghost" data-decline-offer="' + i + '">Decline</button></li>';
      });
      html += '</ul></div>';
    }

    html += leagueTradingBlockHtml(userTeamId);

    html += '<div class="toolbar"><span class="dock-label">Add participant</span>' +
      '<select id="add-team-select"><option value="">Add a team...</option>';
    TEAMS.forEach(function (t) {
      if (state.participants.indexOf(t.id) === -1) {
        html += '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>';
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

      // Was `class="trade-team-panel panel" data-team-id=...`. Both the extra
      // class and the attribute were written and never read anywhere in the
      // repo — no rule styled the class, no selector looked either up. `panel`
      // is what actually draws this.
      html += '<div class="panel">';
      html += '<div class="panel-header">' + teamLogoImgHtml(teamId, 20) + ' ' + escapeHtml(team.name) +
        (teamId === userTeamId ? ' <span class="pill pill-mute">You</span>' : '') + '</div>';
      html += '<div class="balance">' +
        '<div class="balance-item"><div class="balance-label">Value Out / In</div>' +
        '<div class="balance-value">' + (outgoingValue + outgoingPickValue).toFixed(1) + ' → ' + (incomingValue + incomingPickValue).toFixed(1) + '</div></div>' +
        '<div class="balance-item"><div class="balance-label">Salary Out / In</div>' +
        '<div class="balance-value">$' + Math.round(outgoingSalary / 1e6) + 'M → $' + Math.round(incomingSalary / 1e6) + 'M</div></div>' +
        '</div>';

      html += '<table class="data-table"><thead><tr><th>Player</th>' +
        (teamId === userTeamId ? '<th class="num">Block</th>' : '') +
        '<th class="num">In</th><th>Send to</th></tr></thead><tbody>';
      roster.forEach(function (p) {
        const assignment = state.assignments.find(function (a) { return a.playerId === p.id; });
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + ' <span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span>' +
          (p.onTradeBlock && teamId !== userTeamId ? ' <span class="pill pill-gold">On Block</span>' : '') + '</td>' +
          (teamId === userTeamId ? '<td class="num"><input type="checkbox" data-trade-block-id="' + p.id + '"' + (p.onTradeBlock ? ' checked' : '') + '></td>' : '') +
          '<td class="num"><input type="checkbox" data-player-id="' + p.id + '" data-from-team="' + teamId + '"' + (assignment ? ' checked' : '') + '></td>' +
          '<td><select data-dest-for="' + p.id + '"' + (assignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + escapeHtml(getTeamById(destId).name) + '</option>';
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
          html += '<option value="' + destId + '"' + selected + '>' + escapeHtml(getTeamById(destId).name) + '</option>';
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

    container.querySelectorAll('input[type="checkbox"][data-trade-block-id]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const player = getPlayerById(cb.getAttribute('data-trade-block-id'));
        player.onTradeBlock = cb.checked;
        draw();
      });
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
        pushUndoSnapshot(GameState);
        // An offer can go stale in the inbox — legal when it arrived, illegal
        // by the time you accept it. Left unchecked this was the one trade
        // path in the game that could leave a roster outside 12-15.
        const accept = acceptTradeOffer(GameState.tradeOffers[i].proposal,
          function (p) { archiveTrade(p, GameState.leagueYear || 2026); });
        if (!accept.executed) {
          const why = (accept.staleAssignments || []).concat(accept.rosterErrors || []);
          state.resultMessage = '<p>Cannot accept: ' + escapeHtml(why.join('; ')) + '</p>';
          draw();
          return;
        }
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
