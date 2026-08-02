function renderFreeAgency(container, userTeamId) {
  const signingLog = [];

  function draw() {
    if (GameState.playMode === 'spectator') {
      container.innerHTML = '<div class="view-header"><h2>Free Agency</h2></div>' +
        '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      return;
    }

    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });

    let html = '<div class="view-header"><h2>Free Agency</h2><span class="view-sub">' + pool.length + ' available</span></div>';
    html += '<div class="toolbar"><button id="resolve-remaining-btn" class="btn-ghost">Resolve Remaining Free Agents</button></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
      '<th class="num">OVR</th><th class="num">Action</th></tr></thead><tbody>';
    pool.forEach(function (p) {
      html += '<tr><td class="col-name">' + p.name + '</td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
        '<td class="actions"><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div id="bidding-panel"></div>';
    html += '<div class="panel"><div class="panel-header">Recent Signings</div><ul class="stack-list" id="signing-log">' +
      signingLog.slice(-15).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';

    container.innerHTML = html;

    document.getElementById('resolve-remaining-btn').addEventListener('click', function () {
      const rng = GameState.rng;
      const results = runFreeAgencySilently(rng);
      results.forEach(function (r) {
        signingLog.push(getTeamById(r.teamId).name + ' signed ' + getPlayerById(r.playerId).name + ' ($' + r.salary.toLocaleString() + ')');
      });
      draw();
    });

    container.querySelectorAll('button[data-offer-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderBiddingPanel(document.getElementById('bidding-panel'), btn.getAttribute('data-offer-id'), userTeamId, draw, signingLog);
      });
    });
  }

  draw();
}

function renderBiddingPanel(container, playerId, userTeamId, redrawParent, signingLog) {
  const player = getPlayerById(playerId);
  const state = startBidding(playerId, userTeamId, GameState.rng);

  function draw(lastResult) {
    let html = '<div class="bid-panel"><h3>Bidding for ' + player.name + '</h3>';
    html += '<div class="kpi-sub">Competing offers: ' + state.aiOffers.length + '</div>';
    if (lastResult) {
      html += lastResult.userWinning
        ? '<p><span class="pill pill-win">Leading</span> Your offer is currently winning.</p>'
        : '<p><span class="pill pill-loss">Behind</span> A competing offer is ahead' +
          (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') + '.</p>';
    }
    html += '<div class="field-row"><label style="margin:0;">Salary $</label><input type="number" id="bid-salary" value="5000000" step="100000" style="width:140px;"></div>';
    html += '<div class="field-row"><label style="margin:0;">Years</label><input type="number" id="bid-years" value="2" min="1" max="5" style="width:70px;"></div>';
    html += '<div class="toolbar" style="margin:14px 0 0;">' +
      '<button id="submit-bid-btn">Submit Offer</button>' +
      '<button id="accept-bid-btn" class="btn-primary"' + (lastResult ? '' : ' disabled') + '>Sign Player</button>' +
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
      const outcome = finalizeBidding(state, true);
      if (outcome.signed) signingLog.push(getTeamById(outcome.teamId).name + ' signed ' + player.name);
      if (outcome.signed && GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
      container.innerHTML = '';
      redrawParent();
    });
    document.getElementById('withdraw-bid-btn').addEventListener('click', function () {
      const outcome = finalizeBidding(state, false);
      if (outcome.signed) signingLog.push(getTeamById(outcome.teamId).name + ' signed ' + player.name + ' (you withdrew)');
      container.innerHTML = '';
      redrawParent();
    });
  }

  draw(null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFreeAgency: renderFreeAgency, renderBiddingPanel: renderBiddingPanel };
}
