const BUDGET_TIER_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

function financeMetricHtml(label, value, sub) {
  return '<div class="kpi-tile"><div class="kpi-label">' + label + '</div>' +
    '<div class="kpi-value">' + value + '</div>' +
    (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
}

function renderTeamFinances(container, userTeamId) {
  function draw() {
    const team = getTeamById(userTeamId);
    const finances = ensureTeamFinances(team);
    const capacity = arenaCapacity(team);
    const tier = budgetTier(team);
    const upgradeCost = upgradeArenaCost(team);
    const cashClass = finances.cash >= 0 ? 'is-good' : 'is-warn';

    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Team Finances</h2>' +
      '<span class="view-sub">Budget tier: ' + BUDGET_TIER_LABELS[tier] + ' · Arena capacity ' + capacity.toLocaleString() + '</span></div>';

    html += '<div class="kpi-grid">' +
      financeMetricHtml('Cash Balance', '<span class="' + cashClass + '">$' + finances.cash.toLocaleString() + '</span>') +
      financeMetricHtml('Last Game Attendance', finances.lastAttendance.toLocaleString(), capacity > 0 ? Math.round((finances.lastAttendance / capacity) * 100) + '% of capacity' : '') +
      financeMetricHtml('Last Game Gate Revenue', '$' + finances.lastGateRevenue.toLocaleString()) +
      financeMetricHtml('Season Gate Revenue', '$' + finances.seasonGateRevenue.toLocaleString()) +
    '</div>';

    html += '<div class="panel"><div class="panel-header">Last Season</div><div class="panel-body">' +
      (finances.seasonLuxuryTaxPaid > 0
        ? '<p class="kpi-sub is-warn">Paid $' + finances.seasonLuxuryTaxPaid.toLocaleString() + ' in luxury tax.</p>'
        : finances.seasonFloorTaxPaid > 0
          ? '<p class="kpi-sub is-warn">Paid $' + finances.seasonFloorTaxPaid.toLocaleString() + ' in floor-shortfall tax for finishing under the salary floor.</p>'
          : '<p class="kpi-sub is-good">Finished between the salary floor and luxury tax line — no penalty owed.</p>') +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Arena</div><div class="panel-body">' +
      '<p class="kpi-sub">Tier ' + finances.arenaTier + ' of ' + ARENA_MAX_TIER + ' · Capacity ' + capacity.toLocaleString() + '</p>' +
      (upgradeCost === null
        ? '<p class="kpi-sub">Arena is fully upgraded.</p>'
        : '<button id="finances-upgrade-arena-btn" class="btn-primary"' + (finances.cash < upgradeCost ? ' disabled' : '') + '>Upgrade Arena — $' + Math.round(upgradeCost).toLocaleString() + '</button>' +
          (finances.cash < upgradeCost ? '<p class="kpi-sub">Not enough cash on hand.</p>' : '')) +
    '</div></div>';

    html += '<div class="panel"><div class="panel-header">Budget Tier</div><div class="panel-body">' +
      '<p class="kpi-sub">Driven by Owner Happiness (' + team.ownerHappiness + '). A higher tier means the AI spends more aggressively in free agency; ' +
      'this only affects AI-controlled teams — your own offers are never capped by it.</p>' +
    '</div></div>';

    container.innerHTML = html;

    const upgradeBtn = document.getElementById('finances-upgrade-arena-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function () {
        upgradeArena(team);
        draw();
      });
    }
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTeamFinances: renderTeamFinances };
}
