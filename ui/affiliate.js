// The affiliate screen: your reserve club's roster, its results, and the
// call-up/send-down decision.
//
// Affiliate players are deliberately NOT in PLAYERS_2026 (see affiliates.js),
// so every lookup here goes through GameState.affiliates rather than
// getPlayerById — a habit worth keeping, because reaching for the league helper
// out of muscle memory returns undefined and renders a blank row.

// Standings need a sort that does not divide by zero on opening day.
function affiliateWinPct(record) {
  const played = (record.wins || 0) + (record.losses || 0);
  return played === 0 ? 0 : record.wins / played;
}

function affiliateStandingsRows(state) {
  return Object.keys(state.records).map(function (id) {
    return { id: id, record: state.records[id] };
  }).sort(function (a, b) {
    const d = affiliateWinPct(b.record) - affiliateWinPct(a.record);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

function renderAffiliate(container, userTeamId) {
  function draw() {
    const teamId = userTeamId || GameState.userTeamId;
    const state = GameState.affiliates;
    const parent = getTeamById(teamId);

    if (!state) {
      container.innerHTML = '<div class="view-header"><h2>Affiliate</h2></div>' +
        '<div class="panel"><div class="panel-body"><div class="empty-state">' +
        'The affiliate league starts with the season.</div></div></div>';
      return;
    }

    const affId = affiliateIdFor(teamId);
    const record = state.records[affId];
    const roster = affiliateRoster(state, affId, PLAYERS_2026);
    const twoWay = getTeamRoster(teamId).filter(function (p) { return p.twoWay; });
    const results = state.games.filter(function (g) {
      return g.played && (g.home === affId || g.away === affId);
    }).slice(-10).reverse();

    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(teamId, 26) + ' ' +
      escapeHtml(affiliateNameFor(parent)) + '</h2>' +
      '<span class="view-sub">Your affiliate club — two-way players and prospects</span></div>';

    html += '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div><div class="kpi-value">' +
        record.wins + '-' + record.losses + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Roster</div><div class="kpi-value">' +
        roster.length + '</div><div class="kpi-sub">including two-way players sent down</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Two-Way Deals</div><div class="kpi-value">' +
        twoWay.length + '</div><div class="kpi-sub">do not count against your 15</div></div>' +
    '</div>';

    // ---- Two-way players, the only ones you move ------------------------
    html += '<div class="panel"><div class="panel-header">Two-Way Players</div><div class="panel-body">' +
      '<p class="kpi-sub">Playing develops a young player faster than sitting on your bench. Call him up and he takes a roster spot; send him down and he plays here.</p>' +
      (twoWay.length === 0
        ? '<div class="empty-state">You have no two-way players. Sign one from the free agent pool below.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
          '<th class="num">Ovr</th><th>Where</th><th class="num">Games Down</th><th></th></tr></thead><tbody>' +
          twoWay.map(function (p) {
            const down = p.twoWay.down;
            return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
              '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
              '<td class="num">' + p.age + '</td>' +
              '<td class="num">' + p.overall + '</td>' +
              '<td><span class="pill ' + (down ? '' : 'pill-win') + '">' +
                (down ? 'Affiliate' : 'Parent club') + '</span></td>' +
              '<td class="num">' + (p.twoWay.gamesDown || 0) + '</td>' +
              '<td><button class="btn-ghost" data-' + (down ? 'callup' : 'senddown') +
                '-id="' + p.id + '">' + (down ? 'Call Up' : 'Send Down') + '</button></td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    // ---- Sign a two-way deal -------------------------------------------
    const pool = getFreeAgents().slice()
      // potentialDisplay, never raw potential: the two are on different
      // scales and validate-ratings.js enforces the distinction for the UI.
      .sort(function (a, b) { return (b.potentialDisplay || b.overall) - (a.potentialDisplay || a.overall); })
      .slice(0, 10);
    html += '<div class="panel"><div class="panel-header">Sign a Two-Way Contract</div><div class="panel-body">' +
      '<p class="kpi-sub">Half the minimum salary, and he sits outside your 15 while he is with the affiliate.</p>' +
      (pool.length === 0
        ? '<div class="empty-state">No free agents available.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
          '<th class="num">Ovr</th><th></th></tr></thead><tbody>' +
          pool.map(function (p) {
            return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
              '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
              '<td class="num">' + p.age + '</td>' +
              '<td class="num">' + p.overall + '</td>' +
              '<td><button class="btn-ghost" data-twoway-id="' + p.id + '">Sign Two-Way</button></td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    // ---- Who else is on the affiliate roster ---------------------------
    html += '<div class="panel"><div class="panel-header">Affiliate Roster</div><div class="panel-body">' +
      '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th><th class="num">Ovr</th></tr></thead><tbody>' +
      roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).map(function (p) {
        return '<tr><td class="col-name">' + escapeHtml(p.name) +
          (p.twoWay ? ' <span class="pill">two-way</span>' : '') + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num">' + p.overall + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // ---- Results and the league table -----------------------------------
    html += '<div class="panel"><div class="panel-header">Recent Results</div><div class="panel-body">' +
      (results.length === 0
        ? '<div class="empty-state">No games played yet.</div>'
        : '<table class="data-table"><thead><tr><th class="num">Day</th><th>Result</th><th>Opponent</th><th class="num">Score</th></tr></thead><tbody>' +
          results.map(function (g) {
            const home = g.home === affId;
            const us = home ? g.homeScore : g.awayScore;
            const them = home ? g.awayScore : g.homeScore;
            const oppId = home ? g.away : g.home;
            const oppParent = getTeamById(parentIdFor(oppId));
            return '<tr><td class="num">' + g.day + '</td>' +
              '<td><span class="pill ' + (us > them ? 'pill-win' : 'pill-loss') + '">' +
                (us > them ? 'W' : 'L') + '</span></td>' +
              '<td>' + escapeHtml(oppParent ? affiliateNameFor(oppParent) : oppId) + '</td>' +
              '<td class="num">' + us + '-' + them + '</td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Affiliate Standings</div><div class="panel-body">' +
      '<table class="data-table"><thead><tr><th>Club</th><th class="num">W</th><th class="num">L</th><th class="num">Pct</th></tr></thead><tbody>' +
      affiliateStandingsRows(state).map(function (row) {
        const rowParent = getTeamById(parentIdFor(row.id));
        const isUs = row.id === affId;
        return '<tr' + (isUs ? ' class="is-expanded"' : '') + '>' +
          '<td class="col-name">' + escapeHtml(rowParent ? affiliateNameFor(rowParent) : row.id) + '</td>' +
          '<td class="num">' + row.record.wins + '</td>' +
          '<td class="num">' + row.record.losses + '</td>' +
          '<td class="num">' + affiliateWinPct(row.record).toFixed(3) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    container.innerHTML = html;

    function report(result, successText) {
      pushToFeed(result.success ? successText : result.reason);
      draw();
      renderTopBar(document.getElementById('app-topbar'));
    }

    container.querySelectorAll('button[data-callup-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-callup-id'));
        // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
        report(callUp(p), p.name + ' was called up to the parent club.');
      });
    });
    container.querySelectorAll('button[data-senddown-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-senddown-id'));
        // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
        report(sendDown(p), p.name + ' was sent down to the affiliate.');
      });
    });
    container.querySelectorAll('button[data-twoway-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = getPlayerById(btn.getAttribute('data-twoway-id'));
        // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
        report(signTwoWay(p, teamId), p.name + ' signed a two-way contract.');
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderAffiliate: renderAffiliate,
    affiliateWinPct: affiliateWinPct,
    affiliateStandingsRows: affiliateStandingsRows
  };
}
