const ROSTER_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'position', label: 'Pos' },
  { key: 'age', label: 'Age' },
  { key: 'overall', label: 'OVR' },
  { key: 'potential', label: 'POT' },
  { key: 'ppg', label: 'PPG' },
  { key: 'rpg', label: 'RPG' },
  { key: 'apg', label: 'APG' },
  { key: 'fgPct', label: 'FG%' },
  { key: 'salary', label: 'Salary' },
  { key: 'yearsRemaining', label: 'Yrs Left' }
];

function rosterCellValue(player, key) {
  if (key === 'salary') { return player.contract.salary; }
  if (key === 'yearsRemaining') { return player.contract.yearsRemaining; }
  if (['ppg', 'rpg', 'apg', 'fgPct'].indexOf(key) !== -1) { return getPlayerAverages(player)[key]; }
  return player[key];
}

function ratingTier(value) {
  if (value >= 90) return 'tier-elite';
  if (value >= 80) return 'tier-high';
  if (value >= 70) return 'tier-mid';
  return 'tier-low';
}

function renderRoster(container, teamId) {
  let roster = getTeamRoster(teamId).slice();
  let sortKey = 'overall';
  let sortDir = -1; // descending by default

  function draw() {
    roster.sort(function (a, b) {
      const av = rosterCellValue(a, sortKey);
      const bv = rosterCellValue(b, sortKey);
      if (av < bv) { return -1 * sortDir; }
      if (av > bv) { return 1 * sortDir; }
      return 0;
    });

    let html = '<div class="view-header"><h2>Roster</h2><span class="view-sub">' + roster.length + ' players</span></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr>';
    ROSTER_COLUMNS.forEach(function (col) {
      const numeric = col.key !== 'name' && col.key !== 'position';
      html += '<th data-key="' + col.key + '"' + (numeric ? ' class="num"' : '') + '>' +
        col.label + (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    });
    html += '<th class="num">Action</th>';
    html += '</tr></thead><tbody>';
    roster.forEach(function (p) {
      const avg = getPlayerAverages(p);
      html += '<tr>' +
        '<td class="col-name">' + p.name + '</td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.potential) + '">' + p.potential + '</span></td>' +
        '<td class="num">' + avg.ppg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.rpg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.apg.toFixed(1) + '</td>' +
        '<td class="num">' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td class="num">$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td class="num">' + p.contract.yearsRemaining + '</td>' +
        '<td class="actions"><button class="btn-ghost" data-scout-id="' + p.id + '">Scout</button> ' +
          '<button class="btn-danger" data-waive-id="' + p.id + '">Waive</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="panel"><div class="panel-header">Career Totals</div>' +
      '<table class="data-table"><thead><tr><th>Name</th><th class="num">Seasons</th><th class="num">Pts</th>' +
      '<th class="num">Reb</th><th class="num">Ast</th><th class="num">Titles</th></tr></thead><tbody>';
    roster.forEach(function (p) {
      ensureCareerData([p]);
      html += '<tr><td class="col-name">' + p.name + '</td><td class="num">' + p.careerStats.seasonsPlayed +
        '</td><td class="num">' + p.careerStats.points + '</td><td class="num">' + p.careerStats.rebounds +
        '</td><td class="num">' + p.careerStats.assists + '</td><td class="num">' +
        (p.championshipsWon > 0 ? '<span class="pill pill-gold">' + p.championshipsWon + '</span>' : '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('th[data-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-key');
        if (key === sortKey) {
          sortDir = -sortDir;
        } else {
          sortKey = key;
          sortDir = -1;
        }
        draw();
      });
    });

    container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const playerId = btn.getAttribute('data-waive-id');
        const result = waivePlayer(playerId);
        if (!result.success) {
          alert(result.reason);
          return;
        }
        roster = getTeamRoster(teamId).slice();
        draw();
      });
    });

    container.querySelectorAll('button[data-scout-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        GameState.pendingScoutReportId = btn.getAttribute('data-scout-id');
        renderView('scouting');
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRoster: renderRoster, rosterCellValue: rosterCellValue };
}
