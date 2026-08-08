function scoutablePool() {
  // Everyone leaguewide is scoutable, not just your own roster — matches the
  // "Prospects + full league scouting" scope decided during brainstorming.
  return PLAYERS_2026.concat(GameState.upcomingDraftClass || []);
}

function findScoutableById(id) {
  return getPlayerById(id) || (GameState.upcomingDraftClass || []).find(function (p) { return p.id === id; });
}

function renderScoutingReport(container, playerId) {
  const player = findScoutableById(playerId);
  if (!player) { container.innerHTML = ''; return; }
  const target = GameState.scouting.targets[playerId];
  const confidence = target ? target.confidence : 0;
  const view = getRevealedView(player, confidence);

  let html = '<div class="panel"><div class="panel-header">Scouting Report — ' + escapeHtml(player.name) + '</div><div class="panel-body">';
  html += '<div class="kpi-label">Confidence</div><div class="kpi-value">' + Math.round(confidence) + '% ' +
    '<span class="pill pill-mute">' + view.level + '</span></div>';
  html += '<div class="meter" style="margin:8px 0 16px;"><div class="meter-fill" style="width:' + Math.round(confidence) + '%"></div></div>';

  html += '<h4>Traits</h4>';
  if (view.level === 'hidden') {
    html += '<p>???</p>';
  } else if (view.level === 'fuzzy') {
    html += view.traits.length === 0 ? '<p>(none detected)</p>' : '<ul>' + view.traits.map(function (t) {
      return '<li>' + escapeHtml(t.name) + ': ' + t.rangeLabel + '?</li>';
    }).join('') + '</ul>';
  } else {
    html += view.traits.length === 0 ? '<p>(none)</p>' : '<ul>' + view.traits.map(function (t) {
      const def = TRAIT_TAXONOMY_BY_KEY[t.key];
      return '<li>' + escapeHtml(def ? def.name : t.key) + ': ' + t.tier + '</li>';
    }).join('') + '</ul>';
  }

  html += '<h4>Personality</h4>';
  if (view.level === 'hidden') {
    html += '<p>???</p>';
  } else {
    html += '<ul>' + Object.keys(view.personality).map(function (k) {
      return '<li>' + k + ': ' + view.personality[k] + '</li>';
    }).join('') + '</ul>';
  }

  html += '<h4>Tendencies</h4>';
  if (view.level !== 'exact') {
    html += '<p>???</p>';
  } else {
    html += '<ul>' + Object.keys(view.tendencies).map(function (k) {
      return '<li>' + k + ': ' + view.tendencies[k] + '</li>';
    }).join('') + '</ul>';
  }

  html += '</div></div>';
  container.innerHTML = html;
}

function renderScouting(container, userTeamId) {
  function draw() {
    const state = GameState.scouting;
    // autoScout defaults on, and it spends the week's points the day they
    // arrive — so this counter reads 0 essentially always. Left unexplained it
    // looks like a broken feature rather than a chore already being handled,
    // and nothing on this screen pointed at the setting that governs it.
    const autoScouting = !!(GameState.automation && GameState.automation.autoScout);
    let html = '<div class="view-header"><h2>Scouting</h2><span class="view-sub">' +
      Math.round(state.pointsAvailable) + ' scout points available this week' +
      (autoScouting ? ' — your staff spends these automatically (see Settings)' : '') +
      '</span></div>';

    const watchlistIds = Object.keys(state.targets).filter(function (id) { return state.targets[id].watchlisted; });
    html += '<div class="panel"><div class="panel-header">Watchlist</div>';
    if (watchlistIds.length === 0) {
      html += '<div class="panel-body"><div class="empty-state">No players watchlisted yet. Add players below.</div></div>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Name</th><th>Team</th><th class="num">Confidence</th>' +
        '<th>Allocate</th><th class="num"></th></tr></thead><tbody>';
      watchlistIds.forEach(function (id) {
        const player = findScoutableById(id);
        if (!player) return;
        const conf = state.targets[id].confidence;
        html += '<tr><td class="col-name">' + escapeHtml(player.name) + '</td>' +
          '<td>' + (player.teamId ? teamLogoImgHtml(player.teamId, 18) + ' ' + escapeHtml(getTeamById(player.teamId).name) : '<span class="pill pill-mute">Prospect</span>') + '</td>' +
          '<td class="num">' + Math.round(conf) + '%<div class="meter"><div class="meter-fill" style="width:' + Math.round(conf) + '%"></div></div></td>' +
          '<td><input type="number" min="0" max="' + Math.round(state.pointsAvailable) + '" value="10" data-alloc-id="' + id + '" style="width:64px"> ' +
          '<button class="btn-ghost" data-spend-id="' + id + '">Spend</button></td>' +
          '<td class="actions"><button data-report-id="' + id + '">Report</button> ' +
          '<button class="btn-danger" data-unwatch-id="' + id + '">Remove</button></td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="panel"><div class="panel-header">Add to Watchlist</div><div class="panel-body"><div class="toolbar">';
    html += '<select id="scouting-add-select" style="min-width:280px;"><option value="">Choose a player or prospect...</option>';
    scoutablePool().forEach(function (p) {
      if (state.targets[p.id] && state.targets[p.id].watchlisted) return;
      html += '<option value="' + p.id + '">' + escapeHtml(p.name) + (p.teamId ? ' (' + escapeHtml(getTeamById(p.teamId).name) + ')' : ' (Prospect)') + '</option>';
    });
    html += '</select> <button id="scouting-add-btn" class="btn-primary">Add</button></div></div></div>';

    html += '<div id="scouting-report"></div>';

    container.innerHTML = html;

    document.getElementById('scouting-add-btn').addEventListener('click', function () {
      const select = document.getElementById('scouting-add-select');
      if (!select.value) return;
      setWatchlisted(state, select.value, true);
      draw();
    });

    container.querySelectorAll('button[data-unwatch-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setWatchlisted(state, btn.getAttribute('data-unwatch-id'), false);
        draw();
      });
    });

    container.querySelectorAll('button[data-spend-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-spend-id');
        const input = container.querySelector('input[data-alloc-id="' + id + '"]');
        const points = Number(input.value) || 0;
        allocateScoutPoints(state, id, points);
        draw();
      });
    });

    container.querySelectorAll('button[data-report-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderScoutingReport(document.getElementById('scouting-report'), btn.getAttribute('data-report-id'));
      });
    });

    if (GameState.pendingScoutReportId) {
      const pendingId = GameState.pendingScoutReportId;
      GameState.pendingScoutReportId = null;
      renderScoutingReport(document.getElementById('scouting-report'), pendingId);
    }
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderScouting: renderScouting, renderScoutingReport: renderScoutingReport };
}
