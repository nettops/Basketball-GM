// Sourced from data.js's CAP_CONSTANTS so finances.js's season-end tax
// deduction and this mid-season estimate never drift apart.
const LUXURY_TAX_RATE = CAP_CONSTANTS.LUXURY_TAX_RATE;

function estimateLuxuryTax(payroll, capLevel) {
  const taxLine = getEffectiveLuxuryTaxLine(capLevel);
  return payroll > taxLine ? Math.round((payroll - taxLine) * LUXURY_TAX_RATE) : 0;
}

function capSpaceHtml(capSpace) {
  return capSpace >= 0
    ? '<span class="is-good">$' + capSpace.toLocaleString() + ' space</span>'
    : '<span class="is-warn">$' + Math.abs(capSpace).toLocaleString() + ' over</span>';
}

function renderSalaryCap(container, userTeamId) {
  let sortKey = 'payroll';
  let sortDir = -1;
  let checkAmount = '';

  function draw() {
    const team = getTeamById(userTeamId);
    const roster = getTeamRoster(userTeamId);
    const payroll = getTeamPayroll(userTeamId);
    const capLevel = GameState.settings && GameState.settings.capLevel;
    const effectiveCap = getEffectiveSalaryCap(capLevel);
    const effectiveTaxLine = getEffectiveLuxuryTaxLine(capLevel);
    const capSpace = effectiveCap - payroll;
    const deadMoney = getTeamDeadMoney(userTeamId);
    const tax = estimateLuxuryTax(payroll, capLevel);
    const expiring = roster.filter(function (p) { return p.contract.yearsRemaining <= 1; })
      .sort(function (a, b) { return b.contract.salary - a.contract.salary; });

    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Salary Cap</h2>' +
      '<span class="view-sub">Cap $' + effectiveCap.toLocaleString() + ' · Luxury tax line $' + effectiveTaxLine.toLocaleString() + '</span></div>';

    html += '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Payroll</div>' +
        '<div class="kpi-value ' + (capSpace < 0 ? 'is-warn' : '') + '">$' + payroll.toLocaleString() + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Cap Space</div>' +
        '<div class="kpi-value">' + capSpaceHtml(capSpace) + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Est. Luxury Tax</div>' +
        '<div class="kpi-value ' + (tax > 0 ? 'is-warn' : '') + '">$' + tax.toLocaleString() + '</div>' +
        (tax > 0 ? '<div class="kpi-sub">' + LUXURY_TAX_RATE + 'x over the tax line (approximate)</div>' : '<div class="kpi-sub">Under the tax line</div>') +
      '</div>' +
      '<div class="kpi-tile"><div class="kpi-label">Roster Size</div>' +
        '<div class="kpi-value">' + roster.length + '</div><div class="kpi-sub">players under contract</div></div>' +
      // The payroll tile above already includes this, which is exactly why it
      // needs its own: a GM who cannot see the debt reads the payroll as the
      // roster and concludes the cap sheet is wrong.
      '<div class="kpi-tile"><div class="kpi-label">Dead Money</div>' +
        '<div class="kpi-value ' + (deadMoney > 0 ? 'is-warn' : '') + '">$' + deadMoney.toLocaleString() + '</div>' +
        '<div class="kpi-sub">' + (deadMoney > 0 ? 'owed to players who left' : 'nobody is being paid to leave') + '</div></div>' +
    '</div>';

    html += '<div class="panel"><div class="panel-header">Dead Money</div><div class="panel-body">' +
      '<p class="kpi-sub">Salary still owed to players you released. It counts against the cap in full until it runs out.</p>' +
      ((!team.deadMoney || team.deadMoney.length === 0)
        ? '<div class="empty-state">You owe nothing to anyone who has left.</div>'
        : '<table class="data-table"><thead><tr><th>Player</th><th class="num">Owed / yr</th><th class="num">Yrs Left</th></tr></thead><tbody>' +
          team.deadMoney.slice().sort(function (a, b) { return b.salary - a.salary; }).map(function (d) {
            return '<tr><td class="col-name">' + escapeHtml(d.name) + '</td>' +
              '<td class="num">$' + d.salary.toLocaleString() + '</td>' +
              '<td class="num">' + d.yearsRemaining + '</td></tr>';
          }).join('') + '</tbody></table>') +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Your Team Contracts</div><div class="panel-body">' +
      '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Salary</th><th class="num">Yrs Left</th><th></th></tr></thead><tbody>' +
      roster.slice().sort(function (a, b) { return b.contract.salary - a.contract.salary; }).map(function (p) {
        return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td><td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">$' + p.contract.salary.toLocaleString() + '</td>' +
          '<td class="num">' + p.contract.yearsRemaining + '</td>' +
          '<td>' + (p.contract.yearsRemaining <= 1 ? '<span class="pill pill-loss">Expiring</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Upcoming Expiring Contracts</div><div class="panel-body">' +
      (expiring.length === 0 ? '<div class="empty-state">No contracts expiring after this season.</div>' :
        '<table class="data-table"><thead><tr><th>Player</th><th class="num">Salary</th></tr></thead><tbody>' +
        expiring.map(function (p) {
          return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td><td class="num">$' + p.contract.salary.toLocaleString() + '</td></tr>';
        }).join('') + '</tbody></table>') +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Cap Space Checker</div><div class="panel-body">' +
      '<p class="kpi-sub">Could you absorb a contract of this salary without exceeding the cap?</p>' +
      '<div class="toolbar"><input type="number" id="cap-check-input" placeholder="e.g. 20000000" min="0" value="' + checkAmount + '" style="width:180px"> ' +
      '<button id="cap-check-btn" class="btn-primary">Check</button></div>' +
      (checkAmount !== '' ? renderCapCheckResult(Number(checkAmount), capSpace, team) : '') +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">League-Wide Payroll</div><div class="panel-body">' +
      '<table class="data-table"><thead><tr>' +
      ['team', 'payroll', 'capSpace', 'tax'].map(function (key) {
        const labels = { team: 'Team', payroll: 'Payroll', capSpace: 'Cap Space', tax: 'Est. Tax' };
        const numeric = key !== 'team';
        return '<th data-key="' + key + '"' + (numeric ? ' class="num"' : '') + '>' + labels[key] +
          (sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      TEAMS.map(function (t) {
        const p = getTeamPayroll(t.id);
        return { team: t, payroll: p, capSpace: effectiveCap - p, tax: estimateLuxuryTax(p, capLevel) };
      }).sort(function (a, b) {
        const av = sortKey === 'team' ? a.team.name : a[sortKey];
        const bv = sortKey === 'team' ? b.team.name : b[sortKey];
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      }).map(function (row) {
        const rowClass = row.team.id === userTeamId ? ' class="row-user"' : '';
        return '<tr' + rowClass + '><td class="col-name">' + teamLogoImgHtml(row.team.id, 18) + ' ' + escapeHtml(row.team.name) + '</td>' +
          '<td class="num">$' + row.payroll.toLocaleString() + '</td>' +
          '<td class="num">' + capSpaceHtml(row.capSpace) + '</td>' +
          '<td class="num">' + (row.tax > 0 ? '$' + row.tax.toLocaleString() : '—') + '</td></tr>';
      }).join('') + '</tbody></table>' +
    '</div></div>';

    container.innerHTML = html;

    container.querySelectorAll('th[data-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-key');
        if (key === sortKey) { sortDir = -sortDir; } else { sortKey = key; sortDir = -1; }
        draw();
      });
    });

    document.getElementById('cap-check-btn').addEventListener('click', function () {
      checkAmount = document.getElementById('cap-check-input').value;
      draw();
    });
  }

  draw();
}

function renderCapCheckResult(amount, capSpace, team) {
  if (!(amount > 0)) return '<div class="empty-state">Enter a positive salary amount.</div>';
  const canAfford = amount <= capSpace || (typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled);
  return '<div class="kpi-value ' + (canAfford ? 'is-good' : 'is-warn') + '" style="margin-top:10px;font-size:1rem;">' +
    (canAfford
      ? escapeHtml(team.name) + ' could absorb a $' + amount.toLocaleString() + ' salary within cap space.'
      : escapeHtml(team.name) + ' would need $' + (amount - capSpace).toLocaleString() + ' more cap space to absorb a $' + amount.toLocaleString() + ' salary.') +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSalaryCap: renderSalaryCap, estimateLuxuryTax: estimateLuxuryTax, LUXURY_TAX_RATE: LUXURY_TAX_RATE };
}
