// The roster-move screen: the waiver wire, buyouts, and ten-day contracts.
//
// One screen rather than three, because they are the same decision seen from
// three angles — what a player on this roster is worth against what he is owed.
// Splitting them would mean checking three places to answer one question.

// A qualitative read on how badly a player wants out, rather than the raw
// appetite number. Showing the number would make buyouts a lookup: offer
// exactly his ceiling, every time, and there is nothing to weigh. Showing
// nothing makes it a guessing game the player bisects by hand. A band is the
// honest middle — enough to form a plan, not enough to skip having one.
//
// File scope and exported, per the ui/pixelMotion.js lesson: logic buried in a
// render closure is logic no validator can see.
function buyoutMoodLabel(appetite) {
  if (appetite >= 0.40) return { label: 'Desperate to go', cls: 'pill-win' };
  if (appetite >= 0.28) return { label: 'Wants out', cls: 'pill-win' };
  if (appetite >= 0.18) return { label: 'Open to it', cls: '' };
  return { label: 'Happy where he is', cls: 'pill-loss' };
}

// What the club still owes if he accepts, so the GM can see the saving before
// making the offer rather than after.
function buyoutSavingHtml(player, pct) {
  const owed = Math.round(player.contract.salary * (1 - pct));
  const saved = player.contract.salary - owed;
  return '$' + owed.toLocaleString() + ' dead' +
    (saved > 0 ? ' <span class="kpi-sub">(saves $' + saved.toLocaleString() + ')</span>' : '');
}

function renderTransactions(container, userTeamId) {
  function draw() {
    const teamId = userTeamId || GameState.userTeamId;
    const team = getTeamById(teamId);
    const capLevel = GameState.settings && GameState.settings.capLevel;
    const day = GameState.season ? GameState.season.currentDay : 0;
    const wire = playersOnWaivers();
    const roster = getTeamRoster(teamId);
    const deadMoney = getTeamDeadMoney(teamId);

    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(teamId, 26) + ' Transactions</h2>' +
      '<span class="view-sub">Waivers · Buyouts · 10-day contracts</span></div>';

    html += '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Roster</div><div class="kpi-value">' +
        getActiveRoster(teamId).length + '</div><div class="kpi-sub">of 15 — two-way players excluded</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Dead Money</div><div class="kpi-value ' +
        (deadMoney > 0 ? 'is-warn' : '') + '">$' + deadMoney.toLocaleString() + '</div>' +
        '<div class="kpi-sub">owed to players who left</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">On Waivers</div><div class="kpi-value">' +
        wire.length + '</div><div class="kpi-sub">league-wide</div></div>' +
    '</div>';

    // ---- The wire -------------------------------------------------------
    html += '<div class="panel"><div class="panel-header">Waiver Wire</div><div class="panel-body">' +
      '<p class="kpi-sub">A claim takes on the contract exactly as written. Claim him and his old club owes nothing; leave him and he clears to free agency.</p>';

    if (wire.length === 0) {
      html += '<div class="empty-state">Nobody is on waivers.</div>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Owed</th>' +
        '<th class="num">Yrs</th><th>Waived by</th><th class="num">Clears</th><th></th></tr></thead><tbody>';
      wire.forEach(function (p) {
        const legal = canClaim(team, p, capLevel);
        const from = getTeamById(p.waivers.fromTeamId);
        const daysLeft = Math.max(0, p.waivers.clearsOnDay - day);
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">$' + p.waivers.salary.toLocaleString() + '</td>' +
          '<td class="num">' + p.waivers.yearsRemaining + '</td>' +
          '<td>' + escapeHtml(from ? from.name : '—') + '</td>' +
          '<td class="num">' + (daysLeft === 0 ? 'today' : daysLeft + 'd') + '</td>' +
          '<td>' + (legal.ok
            ? '<button class="btn-primary" data-claim-id="' + p.id + '">Claim</button>'
            : '<span class="kpi-sub">' + escapeHtml(legal.reason) + '</span>') +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div></div>';

    // ---- Buyouts --------------------------------------------------------
    html += '<div class="panel"><div class="panel-header">Buy Out a Contract</div><div class="panel-body">' +
      '<p class="kpi-sub">He gives up a share of what he is owed to leave. A losing season, age and unhappiness all make him cheaper to move — nobody gives up more than half.</p>' +
      '<table class="data-table"><thead><tr><th>Player</th><th class="num">Salary</th><th class="num">Yrs</th>' +
      '<th>Mood</th><th class="num">Forgive</th><th class="num">You would owe</th><th></th></tr></thead><tbody>';

    roster.slice().sort(function (a, b) { return b.contract.salary - a.contract.salary; }).forEach(function (p) {
      const mood = buyoutMoodLabel(buyoutAppetite(p, team));
      const pct = 25;
      html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
        '<td class="num">$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td class="num">' + p.contract.yearsRemaining + '</td>' +
        '<td><span class="pill ' + mood.cls + '">' + mood.label + '</span></td>' +
        '<td class="num"><input type="number" class="buyout-pct" data-pct-for="' + p.id +
          '" min="0" max="100" value="' + pct + '"> %</td>' +
        '<td class="num" data-owed-for="' + p.id + '">' + buyoutSavingHtml(p, pct / 100) + '</td>' +
        '<td><button class="btn-ghost" data-buyout-id="' + p.id + '">Offer</button> ' +
        '<button class="btn-danger" data-waive-id="' + p.id + '">Waive</button></td></tr>';
    });
    html += '</tbody></table></div></div>';

    // ---- Ten-day contracts ---------------------------------------------
    const pool = getFreeAgents().slice()
      .sort(function (a, b) { return b.rawOverall - a.rawOverall; })
      .slice(0, 20);
    html += '<div class="panel"><div class="panel-header">10-Day Contracts</div><div class="panel-body">' +
      '<p class="kpi-sub">Minimum salary, ten game days, and no dead money when it lapses. Two with the same club, then sign him for the season or let him go.</p>' +
      (pool.length === 0
        ? '<div class="empty-state">No free agents available.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
          '<th class="num">Ovr</th><th class="num">Used</th><th></th></tr></thead><tbody>' +
          pool.map(function (p) {
            const used = tenDayCountFor(p, teamId);
            return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
              '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
              '<td class="num">' + p.age + '</td>' +
              '<td class="num">' + p.overall + '</td>' +
              '<td class="num">' + used + ' of 2</td>' +
              '<td><button class="btn-ghost" data-tenday-id="' + p.id + '">Sign 10-Day</button></td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    // ---- What the club owes --------------------------------------------
    html += '<div class="panel"><div class="panel-header">Dead Money</div><div class="panel-body">' +
      ((!team.deadMoney || team.deadMoney.length === 0)
        ? '<div class="empty-state">You owe nothing to anyone who has left.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th class="num">Owed / yr</th><th class="num">Yrs Left</th></tr></thead><tbody>' +
          team.deadMoney.map(function (d) {
            return '<tr><td class="col-name">' + escapeHtml(d.name) + '</td>' +
              '<td class="num">$' + d.salary.toLocaleString() + '</td>' +
              '<td class="num">' + d.yearsRemaining + '</td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    container.innerHTML = html;

    // A refusal is the interesting half of the answer, so it is shown rather
    // than swallowed — same rule the free agency screen follows.
    function report(result, successText) {
      if (result.success) pushToFeed(successText);
      else pushToFeed(result.reason);
      draw();
      renderTopBar(document.getElementById('app-topbar'));
    }

    container.querySelectorAll('button[data-claim-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-claim-id'));
        // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
        report(claimPlayer(p.id, teamId, capLevel), 'Claimed ' + p.name + ' off waivers.');
      });
    });

    container.querySelectorAll('input.buyout-pct').forEach(function (input) {
      input.addEventListener('input', function () {
        const p = getPlayerById(input.getAttribute('data-pct-for'));
        const cell = container.querySelector('[data-owed-for="' + p.id + '"]');
        const pct = Math.max(0, Math.min(100, parseInt(input.value, 10) || 0));
        if (cell) cell.innerHTML = buyoutSavingHtml(p, pct / 100);
      });
    });

    container.querySelectorAll('button[data-buyout-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-buyout-id');
        const p = getPlayerById(id);
        const input = container.querySelector('[data-pct-for="' + id + '"]');
        const pct = Math.max(0, Math.min(100, parseInt(input ? input.value : '0', 10) || 0)) / 100;
        // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
        report(buyoutPlayer(id, pct), p.name + ' agreed to a buyout and is a free agent.');
      });
    });

    container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-waive-id'));
        // The day index is what puts him on the wire rather than releasing him
        // outright — see rosterMoves.js.
        report(waivePlayer(p.id, GameState.season ? GameState.season.currentDay : undefined),
          // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
          p.name + ' was placed on waivers. You still owe his contract unless somebody claims him.');
      });
    });

    container.querySelectorAll('button[data-tenday-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-tenday-id'));
        report(signTenDayContract(p, teamId, GameState.season ? GameState.season.currentDay : 0),
          // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
          p.name + ' signed a 10-day contract.');
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderTransactions: renderTransactions,
    buyoutMoodLabel: buyoutMoodLabel,
    buyoutSavingHtml: buyoutSavingHtml
  };
}
