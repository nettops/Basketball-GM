const COMPARISON_SLOT_COUNT = 4;
const COMPARISON_COLORS = ['#58A6FF', '#D4A94E', '#3FB950', '#F85149'];
const COMPARISON_STAT_OPTIONS = [
  { key: 'ppg', label: 'PPG' }, { key: 'rpg', label: 'RPG' }, { key: 'apg', label: 'APG' }, { key: 'minutesPerGame', label: 'Minutes/G' }
];

function getComparisonPlayers(ids) {
  return ids.map(function (id) { return id ? getPlayerById(id) : null; }).filter(Boolean);
}

function unionSeasons(players) {
  const seasons = new Set();
  players.forEach(function (p) { Object.keys(p.careerHistory.seasonByYear).forEach(function (y) { seasons.add(Number(y)); }); });
  return Array.from(seasons).sort(function (a, b) { return a - b; });
}

function renderComparisonOverviewTab(players) {
  let html = '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th class="num">Seasons</th>' +
    '<th class="num">Career Pts</th><th class="num">Career Reb</th><th class="num">Career Ast</th><th class="num">PPG</th>' +
    '<th class="num">RPG</th><th class="num">APG</th><th class="num">Titles</th><th class="num">Peak OVR</th><th class="num">Awards</th></tr></thead><tbody>';
  players.forEach(function (p) {
    ensureCareerData([p]);
    // Career to date: comparing two players mid-season on stored careerStats
    // alone ranked every active player identically at zero.
    const cs = careerTotalsToDate(p);
    const gp = cs.gamesPlayed || 1;
    html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td><td class="num">' + cs.seasonsPlayed + '</td>' +
      '<td class="num">' + cs.points + '</td><td class="num">' + cs.rebounds + '</td><td class="num">' + cs.assists +
      '</td><td class="num">' + (cs.points / gp).toFixed(1) + '</td><td class="num">' + (cs.rebounds / gp).toFixed(1) +
      '</td><td class="num">' + (cs.assists / gp).toFixed(1) + '</td><td class="num">' + p.championshipsWon +
      '</td><td class="num">' + p.peakOverall + '</td><td class="num">' + p.awardsWon.length + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderComparisonSeasonsTab(players) {
  const seasons = unionSeasons(players);
  if (seasons.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No recorded seasons for these players yet.</div></div></div>';
  let html = '<div class="panel"><table class="data-table"><thead><tr><th class="num">Year</th>';
  players.forEach(function (p) { html += '<th class="num">' + escapeHtml(p.name) + '</th>'; });
  html += '</tr></thead><tbody>';
  seasons.forEach(function (year) {
    html += '<tr><td class="num">' + year + '</td>';
    players.forEach(function (p) {
      const s = p.careerHistory.seasonByYear[year];
      if (!s) { html += '<td class="num">—</td>'; return; }
      const injured = p.careerHistory.injuryHistory.some(function (i) { return i.season === year; });
      const contract = p.careerHistory.contractHistory.filter(function (c) { return c.season === year; }).pop();
      const title = (s.team || '—') + (injured ? ' · injured' : '') + (contract ? ' · $' + contract.salary.toLocaleString() : '');
      html += '<td class="num" title="' + title + '">' + (s.points / (s.gamesPlayed || 1)).toFixed(1) + ' ppg' + (injured ? ' ⚕' : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderComparisonTeamsTab(players) {
  let html = '<div class="kpi-grid">';
  players.forEach(function (p, i) {
    html += '<div class="panel"><div class="panel-header" style="border-left:3px solid ' + COMPARISON_COLORS[i] + ';">' + escapeHtml(p.name) + '</div><div class="panel-body">';
    if (p.careerHistory.teamHistory.length === 0) {
      html += '<div class="empty-state">No team history yet.</div>';
    } else {
      html += '<ul class="timeline-list">';
      p.careerHistory.teamHistory.forEach(function (t) {
        const gp = t.totalGames || 1;
        html += '<li>' + (t.team || t.teamId) + ' (' + t.startSeason + '–' + (t.endSeason || 'present') + '): ' +
          (t.totalPoints / gp).toFixed(1) + ' ppg over ' + t.seasons + ' season' + (t.seasons === 1 ? '' : 's') + '</li>';
      });
      html += '</ul>';
    }
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

function renderComparisonProgressionTab(players, statKey) {
  const seasons = unionSeasons(players);
  let html = '<div class="panel"><div class="panel-body toolbar">';
  html += '<span>Stat:</span><select id="compare-stat-select">';
  COMPARISON_STAT_OPTIONS.forEach(function (opt) {
    html += '<option value="' + opt.key + '"' + (opt.key === statKey ? ' selected' : '') + '>' + opt.label + '</option>';
  });
  html += '</select></div></div>';

  if (seasons.length === 0) {
    html += '<div class="panel"><div class="panel-body"><div class="empty-state">No recorded seasons yet.</div></div></div>';
    return html;
  }

  const trends = players.map(function (p) { return getCareerProgressionTrend(p); });
  const allValues = [].concat.apply([], trends.map(function (t) { return t.map(function (row) { return row[statKey] || 0; }); }));
  const maxVal = Math.max(1, Math.max.apply(null, allValues.concat([1])));

  const width = 700, height = 260, padL = 40, padB = 30, padT = 10, padR = 10;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  function xFor(season) { return padL + (seasons.length === 1 ? plotW / 2 : (seasons.indexOf(season) / (seasons.length - 1)) * plotW); }
  function yFor(val) { return padT + plotH - (val / maxVal) * plotH; }

  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:auto;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--r-md);">';
  svg += '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '" stroke="var(--line-strong,#3a4454)" />';
  seasons.forEach(function (s) {
    svg += '<text x="' + xFor(s) + '" y="' + (height - 8) + '" font-size="10" fill="var(--text-mute,#64748B)" text-anchor="middle">' + s + '</text>';
  });
  [0, 0.5, 1].forEach(function (frac) {
    const val = maxVal * frac;
    svg += '<text x="4" y="' + (yFor(val) + 3) + '" font-size="10" fill="var(--text-mute,#64748B)">' + val.toFixed(0) + '</text>';
  });

  players.forEach(function (p, i) {
    const points = trends[i].map(function (row) { return xFor(row.season) + ',' + yFor(row[statKey] || 0); }).join(' ');
    svg += '<polyline points="' + points + '" fill="none" stroke="' + COMPARISON_COLORS[i] + '" stroke-width="2" />';
    trends[i].forEach(function (row) {
      svg += '<circle cx="' + xFor(row.season) + '" cy="' + yFor(row[statKey] || 0) + '" r="3" fill="' + COMPARISON_COLORS[i] + '">' +
        '<title>' + escapeHtml(p.name) + ' ' + row.season + ': ' + (row[statKey] || 0).toFixed(1) + '</title></circle>';
    });
    (p.careerHistory.injuryHistory || []).forEach(function (inj) {
      if (seasons.indexOf(inj.season) === -1) return;
      svg += '<text x="' + xFor(inj.season) + '" y="' + (yFor(0) - 6 - i * 12) + '" font-size="11" fill="' + COMPARISON_COLORS[i] + '" text-anchor="middle">⚕</text>';
    });
  });
  svg += '</svg>';

  html += '<div class="panel"><div class="panel-body">' + svg;
  html += '<div class="toolbar" style="margin-top:10px;">';
  players.forEach(function (p, i) {
    html += '<span><span style="display:inline-block;width:10px;height:10px;background:' + COMPARISON_COLORS[i] + ';border-radius:2px;margin-right:4px;"></span>' + escapeHtml(p.name) + '</span>';
  });
  html += '</div></div></div>';
  return html;
}

function renderComparisonHeadToHeadTab(players) {
  const seasons = unionSeasons(players);
  const commonSeasons = seasons.filter(function (year) { return players.every(function (p) { return p.careerHistory.seasonByYear[year]; }); });
  if (commonSeasons.length === 0) {
    return '<div class="panel"><div class="panel-body"><div class="empty-state">These players haven\'t shared a season on record yet.</div></div></div>';
  }
  let html = '<div class="panel"><table class="data-table"><thead><tr><th class="num">Year</th><th>Points Leader</th><th>Rebounds Leader</th><th>Assists Leader</th></tr></thead><tbody>';
  commonSeasons.forEach(function (year) {
    function leader(statKey) {
      let best = null, bestVal = -1;
      players.forEach(function (p) {
        const s = p.careerHistory.seasonByYear[year];
        const val = s[statKey] / (s.gamesPlayed || 1);
        if (val > bestVal) { bestVal = val; best = p; }
      });
      return escapeHtml(best.name) + ' (' + bestVal.toFixed(1) + ')';
    }
    html += '<tr><td class="num">' + year + '</td><td>' + leader('points') + '</td><td>' + leader('rebounds') + '</td><td>' + leader('assists') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

const COMPARISON_TABS = [
  { id: 'overview', label: 'Career Overview' },
  { id: 'seasons', label: 'Season-by-Season' },
  { id: 'teams', label: 'Team History' },
  { id: 'progression', label: 'Stat Progression' },
  { id: 'headtohead', label: 'Head-to-Head' }
];

function renderPlayerComparison(container) {
  const slots = (GameState.comparisonPlayerIds || []).slice(0, COMPARISON_SLOT_COUNT);
  while (slots.length < 2) slots.push('');
  let activeTab = 'overview';
  let statKey = 'ppg';

  function draw() {
    GameState.comparisonPlayerIds = slots;
    let html = '<div class="view-header"><h2>Compare Players</h2><span class="view-sub">Select 2–4 players to compare career arcs</span></div>';

    html += '<div class="panel"><div class="panel-body compare-picker">';
    for (let i = 0; i < COMPARISON_SLOT_COUNT; i++) {
      html += '<select data-slot="' + i + '"><option value="">' + (i < 2 ? 'Select player ' + (i + 1) : 'None') + '</option>';
      PLAYERS_2026.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
        html += '<option value="' + p.id + '"' + (slots[i] === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
      });
      html += '</select>';
    }
    html += '</div></div>';

    const players = getComparisonPlayers(slots);
    players.forEach(function (p) { ensureCareerData([p]); });

    if (players.length < 2) {
      html += '<div class="empty-state">Select at least two players to compare.</div>';
      container.innerHTML = html;
      wireSlotSelects();
      return;
    }

    html += '<div class="tab-bar">';
    COMPARISON_TABS.forEach(function (t) {
      html += '<button class="tab-btn' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    });
    html += '</div>';

    if (activeTab === 'overview') html += renderComparisonOverviewTab(players);
    else if (activeTab === 'seasons') html += renderComparisonSeasonsTab(players);
    else if (activeTab === 'teams') html += renderComparisonTeamsTab(players);
    else if (activeTab === 'progression') html += renderComparisonProgressionTab(players, statKey);
    else if (activeTab === 'headtohead') html += renderComparisonHeadToHeadTab(players);

    container.innerHTML = html;
    wireSlotSelects();

    container.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.getAttribute('data-tab'); draw(); });
    });
    const statSelect = document.getElementById('compare-stat-select');
    if (statSelect) statSelect.addEventListener('change', function (e) { statKey = e.target.value; draw(); });
  }

  function wireSlotSelects() {
    container.querySelectorAll('select[data-slot]').forEach(function (sel) {
      sel.addEventListener('change', function (e) {
        slots[Number(sel.getAttribute('data-slot'))] = e.target.value;
        draw();
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getComparisonPlayers: getComparisonPlayers,
    unionSeasons: unionSeasons,
    renderPlayerComparison: renderPlayerComparison
  };
}
