// Fun, low-stakes cross-league stats built entirely from data the game
// already records (LEAGUE_HISTORY, careerHistory, retiredNumbers) — nothing
// new tracked just for this page.

function computeTradeFrequencyByTeam() {
  const counts = {};
  LEAGUE_HISTORY.trades.forEach(function (t) {
    t.participants.forEach(function (teamId) { counts[teamId] = (counts[teamId] || 0) + 1; });
  });
  return TEAMS.map(function (t) { return { team: t, count: counts[t.id] || 0 }; })
    .sort(function (a, b) { return b.count - a.count; });
}

function computeMostTradedPlayers(n) {
  const counts = {};
  const names = {};
  LEAGUE_HISTORY.trades.forEach(function (t) {
    t.players.forEach(function (p) {
      counts[p.playerId] = (counts[p.playerId] || 0) + 1;
      names[p.playerId] = p.playerName;
    });
  });
  return Object.keys(counts)
    .map(function (id) { return { playerId: id, name: names[id], count: counts[id] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, n);
}

// "Hit" = ended up (or currently sits) at 75+ overall/peak — a rough "became
// a quality starter" bar, not a precise scouting grade.
const DRAFT_HIT_THRESHOLD = 75;

function computeDraftClassHitRates() {
  return LEAGUE_HISTORY.draftClasses.map(function (dc) {
    let hits = 0;
    let resolved = 0;
    dc.picks.forEach(function (pick) {
      const active = getPlayerById(pick.playerId);
      const retired = LEAGUE_HISTORY.retiredPlayers.find(function (r) { return r.id === pick.playerId; });
      const peak = active ? active.overall : (retired ? retired.peakOverall : null);
      if (peak === null) return; // no longer traceable (shouldn't normally happen)
      resolved += 1;
      if (peak >= DRAFT_HIT_THRESHOLD) hits += 1;
    });
    return { leagueYear: dc.leagueYear, hits: hits, resolved: resolved, total: dc.picks.length };
  }).sort(function (a, b) { return b.leagueYear - a.leagueYear; });
}

function computeJerseyNumberPopularity() {
  const counts = {};
  PLAYERS_2026.forEach(function (p) {
    if (p.jerseyNumber === null || p.jerseyNumber === undefined) return;
    counts[p.jerseyNumber] = (counts[p.jerseyNumber] || 0) + 1;
  });
  return Object.keys(counts).map(function (num) { return { number: Number(num), count: counts[num] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 10);
}

// Longest current tenure with one team, read off careerHistory's open
// (endSeason: null) teamHistory entries.
function computeLongestCurrentTenures(n) {
  const rows = [];
  PLAYERS_2026.forEach(function (p) {
    ensureCareerHistory(p);
    const openEntry = p.careerHistory.teamHistory.find(function (t) { return t.endSeason === null && t.teamId === p.teamId; });
    if (openEntry && openEntry.seasons > 0) rows.push({ player: p, seasons: openEntry.seasons, teamId: p.teamId });
  });
  return rows.sort(function (a, b) { return b.seasons - a.seasons; }).slice(0, n);
}

function computeTotalRetiredNumbers() {
  return TEAMS.reduce(function (sum, t) { return sum + ((t.retiredNumbers && t.retiredNumbers.length) || 0); }, 0);
}

function renderFrivolities(container) {
  const tradeFrequency = computeTradeFrequencyByTeam().slice(0, 10);
  const mostTraded = computeMostTradedPlayers(10);
  const draftHitRates = computeDraftClassHitRates();
  const jerseyPopularity = computeJerseyNumberPopularity();
  const longestTenures = computeLongestCurrentTenures(10);

  let html = '<div class="view-header"><h2>Frivolities</h2><span class="view-sub">Fun, low-stakes stats built from the league\'s own history</span></div>';

  html += '<div class="kpi-grid">' +
    '<div class="kpi-tile"><div class="kpi-label">Total Trades</div><div class="kpi-value">' + LEAGUE_HISTORY.trades.length + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Draft Classes</div><div class="kpi-value">' + LEAGUE_HISTORY.draftClasses.length + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Numbers Retired Leaguewide</div><div class="kpi-value">' + computeTotalRetiredNumbers() + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Hall of Famers</div><div class="kpi-value">' + LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; }).length + '</div></div>' +
  '</div>';

  html += '<div class="panel"><div class="panel-header">Most Active Trade Partners</div><div class="panel-body">' +
    (tradeFrequency.every(function (r) { return r.count === 0; })
      ? '<div class="empty-state">No trades yet.</div>'
      : '<table class="data-table"><thead><tr><th>Team</th><th class="num">Trades</th></tr></thead><tbody>' +
        tradeFrequency.filter(function (r) { return r.count > 0; }).map(function (r) {
          return '<tr><td class="col-name">' + teamLogoImgHtml(r.team.id, 18) + ' ' + escapeHtml(r.team.name) + '</td><td class="num">' + r.count + '</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Most-Traded Players</div><div class="panel-body">' +
    (mostTraded.length === 0
      ? '<div class="empty-state">No trades yet.</div>'
      : '<table class="data-table"><thead><tr><th>Player</th><th class="num">Times Traded</th></tr></thead><tbody>' +
        mostTraded.map(function (r) { return '<tr><td class="col-name">' + escapeHtml(r.name) + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Draft Class Hit Rates <span class="kpi-sub">(' + DRAFT_HIT_THRESHOLD + '+ overall/peak)</span></div><div class="panel-body">' +
    (draftHitRates.length === 0
      ? '<div class="empty-state">No drafts completed yet.</div>'
      : '<table class="data-table"><thead><tr><th class="num">Class</th><th class="num">Hits</th><th class="num">Resolved</th><th class="num">Hit Rate</th></tr></thead><tbody>' +
        draftHitRates.map(function (r) {
          const pct = r.resolved > 0 ? Math.round((r.hits / r.resolved) * 100) : 0;
          return '<tr><td class="num">' + r.leagueYear + '</td><td class="num">' + r.hits + '</td><td class="num">' + r.resolved + ' / ' + r.total + '</td><td class="num">' + pct + '%</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Most Popular Jersey Numbers</div><div class="panel-body">' +
    '<table class="data-table"><thead><tr><th class="num">Number</th><th class="num">Players Wearing It</th></tr></thead><tbody>' +
    jerseyPopularity.map(function (r) { return '<tr><td class="num">#' + r.number + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>' +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Longest Current Tenures</div><div class="panel-body">' +
    (longestTenures.length === 0
      ? '<div class="empty-state">No multi-season tenures yet.</div>'
      : '<table class="data-table"><thead><tr><th>Player</th><th>Team</th><th class="num">Seasons</th></tr></thead><tbody>' +
        longestTenures.map(function (r) {
          const team = getTeamById(r.teamId);
          return '<tr><td class="col-name">' + escapeHtml(r.player.name) + '</td><td>' + (team ? teamLogoImgHtml(team.id, 16) + ' ' + escapeHtml(team.name) : '—') + '</td><td class="num">' + r.seasons + '</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeTradeFrequencyByTeam: computeTradeFrequencyByTeam,
    computeMostTradedPlayers: computeMostTradedPlayers,
    computeDraftClassHitRates: computeDraftClassHitRates,
    computeJerseyNumberPopularity: computeJerseyNumberPopularity,
    computeLongestCurrentTenures: computeLongestCurrentTenures,
    computeTotalRetiredNumbers: computeTotalRetiredNumbers,
    renderFrivolities: renderFrivolities,
    DRAFT_HIT_THRESHOLD: DRAFT_HIT_THRESHOLD
  };
}
