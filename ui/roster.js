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

    let html = '<table><thead><tr>';
    ROSTER_COLUMNS.forEach(function (col) {
      html += '<th data-key="' + col.key + '">' + col.label + (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    });
    html += '</tr></thead><tbody>';
    roster.forEach(function (p) {
      const avg = getPlayerAverages(p);
      html += '<tr>' +
        '<td>' + p.name + '</td>' +
        '<td>' + p.position + '</td>' +
        '<td>' + p.age + '</td>' +
        '<td>' + p.overall + '</td>' +
        '<td>' + p.potential + '</td>' +
        '<td>' + avg.ppg.toFixed(1) + '</td>' +
        '<td>' + avg.rpg.toFixed(1) + '</td>' +
        '<td>' + avg.apg.toFixed(1) + '</td>' +
        '<td>' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td>$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td>' + p.contract.yearsRemaining + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('th').forEach(function (th) {
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
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRoster: renderRoster, rosterCellValue: rosterCellValue };
}
