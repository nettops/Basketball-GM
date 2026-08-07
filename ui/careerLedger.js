function collectLedgerSeasons() {
  const seasons = new Set();
  PLAYERS_2026.forEach(function (p) {
    ensureCareerHistory(p);
    Object.keys(p.careerHistory.seasonByYear).forEach(function (y) { seasons.add(Number(y)); });
  });
  return Array.from(seasons).sort(function (a, b) { return b - a; });
}

function downloadCsv(filename, rows) {
  const csv = rows.map(function (row) {
    return row.map(function (cell) {
      const str = String(cell === undefined || cell === null ? '' : cell);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    }).join(',');
  }).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const LEDGER_EVENT_LABELS = {
  // ui-safety: not-markup — these return PLAIN TEXT, escaped once at the render
  // site below. Escaping inside just one of them meant the other two shipped
  // raw while that one risked double-escaping.
  trade: function (e) { const from = getTeamById(e.fromTeam), to = getTeamById(e.toTeam); return e.details || ((from ? from.name : e.fromTeam) + ' → ' + (to ? to.name : e.toTeam)); },
  contract: function (e) { return '$' + e.salary.toLocaleString() + '/yr × ' + e.yearsRemaining + ' (' + e.type + ')'; },
  injury: function (e) { return e.type + ' (' + e.severity + ')' + (e.actualRecoveryDays !== null ? ', ' + e.actualRecoveryDays + 'd out' : ''); }
};

function collectLedgerEvents(filters) {
  const events = [];
  PLAYERS_2026.forEach(function (p) {
    ensureCareerHistory(p);
    if (filters.teamId && p.teamId !== filters.teamId) {
      const touchesTeam = p.careerHistory.teamHistory.some(function (t) { return t.teamId === filters.teamId; });
      if (!touchesTeam) return;
    }
    if (filters.search && p.name.toLowerCase().indexOf(filters.search.toLowerCase()) === -1) return;
    queryHistoryByFilters(p, { season: filters.season || undefined, teamId: filters.teamId || undefined }).forEach(function (e) {
      events.push({ playerId: p.id, playerName: p.name, season: e.season, eventType: e.eventType, description: LEDGER_EVENT_LABELS[e.eventType](e) });
    });
  });
  return events.sort(function (a, b) { return b.season - a.season; });
}

const LEDGER_STAT_COLUMNS = [
  { key: 'season', label: 'Year' }, { key: 'team', label: 'Team' }, { key: 'gamesPlayed', label: 'GP' },
  { key: 'ppg', label: 'PPG' }, { key: 'rpg', label: 'RPG' }, { key: 'apg', label: 'APG' }, { key: 'minutes', label: 'Minutes' }
];

function collectLedgerStatRows(filters) {
  const rows = [];
  PLAYERS_2026.forEach(function (p) {
    ensureCareerHistory(p);
    if (filters.teamId && p.teamId !== filters.teamId) return;
    if (filters.search && p.name.toLowerCase().indexOf(filters.search.toLowerCase()) === -1) return;
    const season = filters.season || Math.max.apply(null, Object.keys(p.careerHistory.seasonByYear).map(Number).concat([0]));
    const s = p.careerHistory.seasonByYear[season];
    if (!s) return;
    const hadInjuryThisSeason = p.careerHistory.injuryHistory.some(function (i) { return i.season === season; });
    const contractThisSeason = p.careerHistory.contractHistory.filter(function (c) { return c.season === season; }).pop();
    rows.push({
      playerId: p.id, playerName: p.name, season: s.season, team: s.team, gamesPlayed: s.gamesPlayed,
      ppg: s.points / (s.gamesPlayed || 1), rpg: s.rebounds / (s.gamesPlayed || 1), apg: s.assists / (s.gamesPlayed || 1),
      minutes: s.minutes, hadInjury: hadInjuryThisSeason, contract: contractThisSeason ? ('$' + contractThisSeason.salary.toLocaleString()) : '—'
    });
  });
  return rows;
}

function renderCareerLedger(container) {
  const filters = { search: '', teamId: '', season: '', statSort: 'ppg' };
  let sortKey = 'ppg';
  let sortDir = -1;

  function draw() {
    const seasons = collectLedgerSeasons();
    let html = '<div class="view-header"><h2>Career Ledger</h2><span class="view-sub">Search, filter, and export career history</span></div>';

    html += '<div class="panel"><div class="panel-body toolbar">';
    html += '<input type="text" id="ledger-search" placeholder="Search player..." value="' + filters.search + '">';
    html += '<select id="ledger-team"><option value="">All Teams</option>';
    TEAMS.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (t) {
      html += '<option value="' + t.id + '"' + (filters.teamId === t.id ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>';
    });
    html += '</select>';
    html += '<select id="ledger-season"><option value="">All Seasons</option>';
    seasons.forEach(function (y) {
      html += '<option value="' + y + '"' + (String(filters.season) === String(y) ? ' selected' : '') + '>' + y + '</option>';
    });
    html += '</select>';
    html += '<button class="btn-ghost" id="ledger-export-season">Export Season Stats CSV</button>';
    html += '<button class="btn-ghost" id="ledger-export-career">Export Career Totals CSV</button>';
    html += '</div></div>';

    const statRows = collectLedgerStatRows(filters);
    statRows.sort(function (a, b) { return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * sortDir; });

    html += '<div class="panel"><div class="panel-header">Statistics Table</div><table class="data-table"><thead><tr><th>Player</th>';
    LEDGER_STAT_COLUMNS.forEach(function (col) {
      const numeric = col.key !== 'team' && col.key !== 'season';
      html += '<th data-sort-key="' + col.key + '"' + (numeric ? ' class="num"' : '') + '>' + col.label +
        (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    });
    html += '<th>Injury</th><th>Contract</th></tr></thead><tbody>';
    if (statRows.length === 0) {
      html += '<tr><td colspan="10"><div class="empty-state">No players match these filters.</div></td></tr>';
    }
    statRows.forEach(function (r) {
      const rowClass = r.hadInjury ? ' class="row-highlight"' : '';
      html += '<tr' + rowClass + '><td class="col-name"><button class="player-link" data-profile-id="' + r.playerId + '">' + escapeHtml(r.playerName) + '</button></td>' +
        '<td class="num">' + r.season + '</td><td>' + (r.team || '—') + '</td><td class="num">' + r.gamesPlayed +
        '</td><td class="num">' + r.ppg.toFixed(1) + '</td><td class="num">' + r.rpg.toFixed(1) + '</td><td class="num">' + r.apg.toFixed(1) +
        '</td><td class="num">' + r.minutes + '</td><td>' + (r.hadInjury ? '<span class="pill pill-loss">Yes</span>' : '—') +
        '</td><td>' + r.contract + '</td></tr>';
    });
    html += '</tbody></table></div>';

    const events = collectLedgerEvents(filters);
    html += '<div class="panel"><div class="panel-header">Timeline</div>';
    if (events.length === 0) {
      html += '<div class="panel-body"><div class="empty-state">No career events match these filters.</div></div>';
    } else {
      html += '<ul class="timeline-list">';
      events.forEach(function (e) {
        html += '<li><span class="pill pill-mute">' + e.season + '</span> <span class="pill pill-pos">' + e.eventType + '</span> ' +
          '<button class="player-link" data-profile-id="' + e.playerId + '">' + escapeHtml(e.playerName) + '</button> — ' + escapeHtml(e.description) + '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';

    container.innerHTML = html;

    document.getElementById('ledger-search').addEventListener('input', function (e) { filters.search = e.target.value; draw(); });
    document.getElementById('ledger-team').addEventListener('change', function (e) { filters.teamId = e.target.value; draw(); });
    document.getElementById('ledger-season').addEventListener('change', function (e) { filters.season = e.target.value ? Number(e.target.value) : ''; draw(); });
    document.getElementById('ledger-export-season').addEventListener('click', function () {
      const rows = [['Player', 'Year', 'Team', 'GP', 'PPG', 'RPG', 'APG', 'Minutes', 'Injury', 'Contract']];
      statRows.forEach(function (r) { rows.push([r.playerName, r.season, r.team, r.gamesPlayed, r.ppg.toFixed(1), r.rpg.toFixed(1), r.apg.toFixed(1), r.minutes, r.hadInjury ? 'Yes' : 'No', r.contract]); });
      downloadCsv('season-stats.csv', rows);
    });
    document.getElementById('ledger-export-career').addEventListener('click', function () {
      const rows = [['Player', 'Seasons', 'Games', 'Points', 'Rebounds', 'Assists', 'Championships', 'Peak OVR']];
      PLAYERS_2026.forEach(function (p) {
        ensureCareerData([p]);
        if (filters.teamId && p.teamId !== filters.teamId) return;
        if (filters.search && p.name.toLowerCase().indexOf(filters.search.toLowerCase()) === -1) return;
        // Career to date, matching what the Career Totals panels show — an
        // export that disagreed with the screen it was exported from would be
        // worse than one that is merely stale.
        const cs = careerTotalsToDate(p);
        rows.push([p.name, cs.seasonsPlayed, cs.gamesPlayed, cs.points, cs.rebounds, cs.assists, p.championshipsWon, p.peakOverall]);
      });
      downloadCsv('career-totals.csv', rows);
    });
    container.querySelectorAll('th[data-sort-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-sort-key');
        if (key === sortKey) { sortDir = -sortDir; } else { sortKey = key; sortDir = -1; }
        draw();
      });
    });
    container.querySelectorAll('button[data-profile-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPlayerProfile(btn.getAttribute('data-profile-id')); });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectLedgerSeasons: collectLedgerSeasons,
    collectLedgerEvents: collectLedgerEvents,
    collectLedgerStatRows: collectLedgerStatRows,
    renderCareerLedger: renderCareerLedger
  };
}
