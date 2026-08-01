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

  let html = '<h3>Scouting Report: ' + player.name + '</h3>';
  html += '<p>Confidence: ' + Math.round(confidence) + '% (' + view.level + ')</p>';

  html += '<h4>Traits</h4>';
  if (view.level === 'hidden') {
    html += '<p>???</p>';
  } else if (view.level === 'fuzzy') {
    html += view.traits.length === 0 ? '<p>(none detected)</p>' : '<ul>' + view.traits.map(function (t) {
      return '<li>' + t.name + ': ' + t.rangeLabel + '?</li>';
    }).join('') + '</ul>';
  } else {
    html += view.traits.length === 0 ? '<p>(none)</p>' : '<ul>' + view.traits.map(function (t) {
      const def = TRAIT_TAXONOMY_BY_KEY[t.key];
      return '<li>' + (def ? def.name : t.key) + ': ' + t.tier + '</li>';
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

  container.innerHTML = html;
}

function renderScouting(container, userTeamId) {
  function draw() {
    const state = GameState.scouting;
    let html = '<h2>Scouting</h2>';
    html += '<p>Scout points available this week: ' + Math.round(state.pointsAvailable) + '</p>';

    const watchlistIds = Object.keys(state.targets).filter(function (id) { return state.targets[id].watchlisted; });
    html += '<h3>Watchlist</h3>';
    if (watchlistIds.length === 0) {
      html += '<p>No players watchlisted yet. Add players below.</p>';
    } else {
      html += '<table><thead><tr><th>Name</th><th>Team</th><th>Confidence</th><th>Allocate Points</th><th></th></tr></thead><tbody>';
      watchlistIds.forEach(function (id) {
        const player = findScoutableById(id);
        if (!player) return;
        const conf = state.targets[id].confidence;
        html += '<tr><td>' + player.name + '</td><td>' + (player.teamId ? getTeamById(player.teamId).name : 'Draft Prospect') + '</td>' +
          '<td>' + Math.round(conf) + '%</td>' +
          '<td><input type="number" min="0" max="' + Math.round(state.pointsAvailable) + '" value="10" data-alloc-id="' + id + '" style="width:60px"> <button data-spend-id="' + id + '">Spend</button></td>' +
          '<td><button data-report-id="' + id + '">View Report</button> <button data-unwatch-id="' + id + '">Remove</button></td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h3>Add to Watchlist</h3>';
    html += '<select id="scouting-add-select"><option value="">Choose a player or prospect...</option>';
    scoutablePool().forEach(function (p) {
      if (state.targets[p.id] && state.targets[p.id].watchlisted) return;
      html += '<option value="' + p.id + '">' + p.name + (p.teamId ? ' (' + getTeamById(p.teamId).name + ')' : ' (Prospect)') + '</option>';
    });
    html += '</select> <button id="scouting-add-btn">Add</button>';

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
