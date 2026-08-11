function renderFreeAgency(container, userTeamId) {
  const signingLog = [];

  function draw() {
    if (GameState.playMode === 'spectator') {
      container.innerHTML = '<div class="view-header"><h2>Free Agency</h2></div>' +
        '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      return;
    }

    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });
    // Your own expiring players, held back from the market so you get first
    // refusal. Every other team already made this call for itself during the
    // offseason; these are the ones nobody decided for you.
    const expiring = getTeamRoster(userTeamId)
      .filter(function (p) { return p.resignRights; })
      .sort(function (a, b) { return b.overall - a.overall; });

    let html = '<div class="view-header"><h2>Free Agency</h2><span class="view-sub">' + pool.length + ' available</span></div>';

    if (expiring.length) {
      html += '<div class="panel"><div class="panel-header">Your Expiring Contracts — ' +
        expiring.length + ' to decide</div>' +
        '<div class="kpi-sub" style="padding:0 14px 8px;">First refusal is yours. Anyone you do not re-sign walks when the market opens.</div>' +
        '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
        '<th class="num">OVR</th><th class="num">Asking</th><th class="num">Action</th></tr></thead><tbody>';
      expiring.forEach(function (p) {
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="num">$' + p.resignRights.salary.toLocaleString() + ' &times; ' +
          p.resignRights.yearsRemaining + 'y</td>' +
          '<td class="actions"><button data-resign-id="' + p.id + '">Re-Sign</button> ' +
          '<button data-letgo-id="' + p.id + '" class="btn-ghost">Let Go</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    // Nothing to resolve when the pool is empty. Disabled rather than removed
    // so the screen still says what it does, matching the dock's Watch/Undo.
    html += '<div class="toolbar"><button id="resolve-remaining-btn" class="btn-ghost"' +
      (pool.length === 0 ? ' disabled' : '') + '>Resolve Remaining Free Agents</button></div>';
    if (pool.length === 0) {
      // A header row over an empty tbody reads as a table that failed to load.
      // Spectator mode above already uses empty-state for exactly this reason.
      html += '<div class="empty-state">No free agents available — players reach free agency when their contracts expire in the offseason.</div>';
    } else {
      html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
        '<th class="num">OVR</th><th class="num">Action</th></tr></thead><tbody>';
      pool.forEach(function (p) {
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="actions"><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<div id="bidding-panel"></div>';
    // Same stranded-header problem: this panel titled itself before there was
    // anything to list, so a mid-season visit showed "Recent Signings" over
    // blank space. It appears once there is a signing to report.
    if (signingLog.length) {
      html += '<div class="panel"><div class="panel-header">Recent Signings</div><ul class="stack-list" id="signing-log">' +
        signingLog.slice(-15).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';
    }

    container.innerHTML = html;

    document.getElementById('resolve-remaining-btn').addEventListener('click', function () {
      const rng = GameState.rng;
      const results = runFreeAgencySilently(rng);
      results.forEach(function (r) {
        // signingLog entries are rendered as raw <li> markup above, so the
        // player name needs escaping here just like the team name — and like
        // the two sibling pushes in renderBiddingPanel already do.
        signingLog.push(escapeHtml(getTeamById(r.teamId).name) + ' signed ' + escapeHtml(getPlayerById(r.playerId).name) + ' ($' + r.salary.toLocaleString() + ')');
      });
      draw();
    });

    container.querySelectorAll('button[data-offer-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderBiddingPanel(document.getElementById('bidding-panel'), btn.getAttribute('data-offer-id'), userTeamId, draw, signingLog);
      });
    });

    container.querySelectorAll('button[data-resign-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-resign-id'));
        const team = getTeamById(userTeamId);
        const ask = { salary: player.resignRights.salary, yearsRemaining: player.resignRights.yearsRemaining };
        // He can still say no — that is the point of a window rather than a
        // button. Rights are spent either way, so a refusal sends him to the
        // market exactly as letting him go would.
        const verdict = evaluateResign(player, team, ask, GameState.rng);
        if (verdict.accepted) {
          delete player.resignRights;
          applyResign(player, team, ask);
          signingLog.push(escapeHtml(team.name) + ' re-signed ' + escapeHtml(player.name) +
            ' ($' + ask.salary.toLocaleString() + '/yr, ' + ask.yearsRemaining + ' yr' +
            (ask.yearsRemaining === 1 ? '' : 's') + ')');
        } else {
          delete player.resignRights;
          player.teamId = null;
          signingLog.push(escapeHtml(player.name) + ' turned down your offer and will test the market');
        }
        draw();
      });
    });

    container.querySelectorAll('button[data-letgo-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-letgo-id'));
        delete player.resignRights;
        player.teamId = null;
        signingLog.push(escapeHtml(player.name) + ' was let go and enters free agency');
        draw();
      });
    });
  }

  draw();
}

function renderBiddingPanel(container, playerId, userTeamId, redrawParent, signingLog) {
  const player = getPlayerById(playerId);
  const state = startBidding(playerId, userTeamId, GameState.rng);

  function draw(lastResult) {
    // The same function the model enforces with, so the ceiling shown here and
    // the ceiling applied at signing cannot drift apart.
    const limit = offerLimit(getTeamById(userTeamId));
    const canBid = !limit.reason;

    let html = '<div class="bid-panel"><h3>Bidding for ' + escapeHtml(player.name) + '</h3>';
    html += '<div class="kpi-sub">Competing offers: ' + state.aiOffers.length + '</div>';
    html += limit.capDisabled
      ? '<div class="kpi-sub">Salary cap disabled — offer anything.</div>'
      : '<div class="kpi-sub">Cap space: ' + capSpaceHtml(limit.capSpace) + '</div>';
    if (limit.reason) {
      html += '<p><span class="pill pill-loss">Cannot sign</span> ' + escapeHtml(limit.reason) + '</p>';
    }
    if (lastResult && lastResult.offerAccepted === false) {
      html += '<p><span class="pill pill-loss">Offer rejected</span> ' +
        escapeHtml(lastResult.rejectedReason) + '</p>';
    } else if (lastResult) {
      html += lastResult.userWinning
        ? '<p><span class="pill pill-win">Leading</span> Your offer is currently winning — you can sign him.</p>'
        : '<p><span class="pill pill-loss">Behind</span> A competing offer is ahead' +
          (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') +
          '. Raise your offer — he will not sign while he prefers someone else.</p>';
    }
    const startingBid = canBid ? Math.min(5000000, limit.max) : 0;
    html += '<div class="field-row"><label style="margin:0;">Salary $</label><input type="number" id="bid-salary" value="' +
      startingBid + '" step="100000" min="' + limit.min + '"' +
      (limit.capDisabled ? '' : ' max="' + limit.max + '"') +
      (canBid ? '' : ' disabled') + ' style="width:140px;"></div>';
    // Bounds read from the model rather than typed in here, so the box and the
    // rule it is checked against cannot drift apart — the salary box beside it
    // was hardened while this one silently accepted 99.
    html += '<div class="field-row"><label style="margin:0;">Years</label><input type="number" id="bid-years" value="2" min="1" max="' +
      MAX_CONTRACT_YEARS + '" step="1"' + (canBid ? '' : ' disabled') + ' style="width:70px;"></div>';
    // Only a WINNING bid can be closed. The button used to be live the moment
    // any legal offer had been submitted, which is how a superstar could be had
    // at the league minimum while the panel next to the button read "Behind".
    const canSign = canBid && !!(lastResult && lastResult.offerAccepted && lastResult.userWinning);
    html += '<div class="toolbar" style="margin:14px 0 0;">' +
      '<button id="submit-bid-btn"' + (canBid ? '' : ' disabled') + '>Submit Offer</button>' +
      '<button id="accept-bid-btn" class="btn-primary"' + (canSign ? '' : ' disabled') + '>Sign Player</button>' +
      '<button id="withdraw-bid-btn" class="btn-ghost">Withdraw</button></div>';
    html += '</div>';
    container.innerHTML = html;

    document.getElementById('submit-bid-btn').addEventListener('click', function () {
      const salary = Number(document.getElementById('bid-salary').value);
      const years = Number(document.getElementById('bid-years').value);
      const result = evaluateBiddingRound(state, salary, years);
      draw(result);
    });
    document.getElementById('accept-bid-btn').addEventListener('click', function () {
      pushUndoSnapshot(GameState);
      const outcome = finalizeBidding(state, true);
      // finalizeBidding re-checks the cap and can hand the player to the best
      // rival bid instead, so say which happened rather than implying you got him.
      if (outcome.signed) {
        signingLog.push(escapeHtml(getTeamById(outcome.teamId).name) + ' signed ' + escapeHtml(player.name) +
          (outcome.teamId === userTeamId ? '' : ' (your offer no longer fit under the cap)'));
      }
      if (outcome.signed && GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
      container.innerHTML = '';
      redrawParent();
    });
    document.getElementById('withdraw-bid-btn').addEventListener('click', function () {
      pushUndoSnapshot(GameState);
      const outcome = finalizeBidding(state, false);
      if (outcome.signed) signingLog.push(escapeHtml(getTeamById(outcome.teamId).name) + ' signed ' + escapeHtml(player.name) + ' (you withdrew)');
      container.innerHTML = '';
      redrawParent();
    });
  }

  draw(null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFreeAgency: renderFreeAgency, renderBiddingPanel: renderBiddingPanel };
}
