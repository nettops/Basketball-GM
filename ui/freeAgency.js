function renderFreeAgency(container, userTeamId) {
  const signingLog = [];

  function draw() {
    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });

    let html = '<h2>Free Agency</h2>';
    html += '<button id="resolve-remaining-btn">Resolve Remaining Free Agents</button>';
    html += '<table><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Action</th></tr></thead><tbody>';
    pool.forEach(function (p) {
      html += '<tr><td>' + p.name + '</td><td>' + p.position + '</td><td>' + p.age + '</td><td>' + p.overall + '</td>' +
        '<td><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div id="bidding-panel"></div>';
    html += '<h3>Recent Signings</h3><ul id="signing-log">' + signingLog.slice(-15).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';

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
    let html = '<h3>Bidding for ' + player.name + '</h3>';
    html += '<p>Competing offers: ' + state.aiOffers.length + '</p>';
    if (lastResult) {
      html += '<p>' + (lastResult.userWinning ? 'Your offer is currently winning.' : 'A competing offer is ahead' + (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') + '.') + '</p>';
    }
    html += '<label>Salary: $<input type="number" id="bid-salary" value="5000000" step="100000"></label><br>';
    html += '<label>Years: <input type="number" id="bid-years" value="2" min="1" max="5"></label><br>';
    html += '<button id="submit-bid-btn">Submit Offer</button> ';
    html += '<button id="accept-bid-btn"' + (lastResult ? '' : ' disabled') + '>Sign Player</button> ';
    html += '<button id="withdraw-bid-btn">Withdraw</button>';
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
