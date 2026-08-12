// The Feats page: every remarkable single game in league history, newest first.
//
// The labels carry their bars. Our league scores ~135 a team, so the bars are
// measured rather than traditional (see feats.js) and a night of 14/14/14 is
// what a triple-double costs here. Showing the number beside the word is the
// difference between a label and a lie, and reading it off FEAT_TUNING means
// it can never drift from the rule actually being applied.
function featLabel(kind) {
  const t = FEAT_TUNING;
  if (kind === 'hugeScoring') return 'Huge scoring night (' + t.hugeScoring + '+)';
  if (kind === 'bigScoring') return 'Big scoring night (' + t.bigScoring + '+)';
  if (kind === 'tripleDouble') return 'Triple-double (' + t.doubleAt + '+)';
  if (kind === 'fiveByFive') return 'Five-by-five (' + t.fiveAt + '+)';
  return kind;
}

// Short form for the live feed and the player profile, where the bar is noise.
function featShortLabel(kind) {
  if (kind === 'hugeScoring') return 'Huge scoring night';
  if (kind === 'bigScoring') return 'Big scoring night';
  if (kind === 'tripleDouble') return 'Triple-double';
  if (kind === 'fiveByFive') return 'Five-by-five';
  return kind;
}

const FEAT_PILL_CLASS = {
  hugeScoring: 'pill',
  bigScoring: 'pill pill-mute',
  tripleDouble: 'pill',
  fiveByFive: 'pill'
};

function featsForPlayer(playerId) {
  return LEAGUE_HISTORY.feats.filter(function (f) { return f.playerId === playerId; });
}

function featStatLine(f) {
  return f.points + ' pts, ' + f.rebounds + ' reb, ' + f.assists + ' ast, ' +
    f.steals + ' stl, ' + f.blocks + ' blk';
}

function teamLabel(teamId) {
  const team = typeof getTeamById === 'function' ? getTeamById(teamId) : null;
  return (team && team.name) || teamId;
}

function renderFeats(container) {
  const all = LEAGUE_HISTORY.feats.slice().reverse();
  let html = '<div class="view-header"><h2>Feats</h2><span class="view-sub">' +
    all.length + ' in league history</span></div>';

  if (all.length === 0) {
    html += '<div class="panel"><div class="panel-body"><div class="empty-state">' +
      'No feats yet — they are recorded as games are played, across the whole league. ' +
      'Box scores are not kept after a save, so these cannot be filled in later.' +
      '</div></div></div>';
    container.innerHTML = html;
    return;
  }

  const years = [];
  all.forEach(function (f) { if (years.indexOf(f.leagueYear) === -1) years.push(f.leagueYear); });
  const kinds = [];
  all.forEach(function (f) { if (kinds.indexOf(f.kind) === -1) kinds.push(f.kind); });
  const teamIds = [];
  all.forEach(function (f) { if (teamIds.indexOf(f.teamId) === -1) teamIds.push(f.teamId); });
  teamIds.sort(function (a, b) { return teamLabel(a).localeCompare(teamLabel(b)); });

  html += '<div class="panel"><div class="panel-body"><div class="toolbar">' +
    '<label>Season <select id="feat-year"><option value="">All</option>' +
    years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('') +
    '</select></label> ' +
    '<label>Team <select id="feat-team"><option value="">All</option>' +
    teamIds.map(function (t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(teamLabel(t)) + '</option>';
    }).join('') +
    '</select></label> ' +
    '<label>Feat <select id="feat-kind"><option value="">All</option>' +
    kinds.map(function (k) {
      return '<option value="' + k + '">' + escapeHtml(featLabel(k)) + '</option>';
    }).join('') +
    '</select></label> ' +
    '<label>Player <input id="feat-player" type="search" placeholder="name"></label> ' +
    '<span class="kpi-sub" id="feat-count">' + all.length + ' shown</span>' +
    '</div></div></div>';

  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Season</th>' +
    '<th>Player</th><th>Team</th><th>Feat</th><th>Line</th></tr></thead><tbody id="feat-rows">';
  html += all.map(function (f) {
    return '<tr data-feat-year="' + f.leagueYear + '" data-feat-kind="' + f.kind + '"' +
      ' data-feat-team="' + escapeHtml(f.teamId) + '"' +
      ' data-feat-player="' + escapeHtml(f.playerName.toLowerCase()) + '">' +
      '<td class="num">' + f.leagueYear + '</td>' +
      '<td class="col-name"><button class="player-link" data-profile-id="' + f.playerId + '">' +
      escapeHtml(f.playerName) + '</button></td>' +
      '<td>' + escapeHtml(teamLabel(f.teamId)) +
      ' <span class="kpi-sub">vs ' + escapeHtml(teamLabel(f.oppTeamId)) + '</span></td>' +
      '<td><span class="' + (FEAT_PILL_CLASS[f.kind] || 'pill') + '">' +
      escapeHtml(featShortLabel(f.kind)) + '</span></td>' +
      '<td>' + escapeHtml(featStatLine(f)) + '</td></tr>';
  }).join('');
  html += '</tbody></table></div>';
  container.innerHTML = html;

  function applyFilters() {
    const wantYear = document.getElementById('feat-year').value;
    const wantTeam = document.getElementById('feat-team').value;
    const wantKind = document.getElementById('feat-kind').value;
    const wantPlayer = document.getElementById('feat-player').value.trim().toLowerCase();
    let shown = 0;
    container.querySelectorAll('#feat-rows tr').forEach(function (tr) {
      const ok = (!wantYear || tr.getAttribute('data-feat-year') === wantYear) &&
        (!wantTeam || tr.getAttribute('data-feat-team') === wantTeam) &&
        (!wantKind || tr.getAttribute('data-feat-kind') === wantKind) &&
        (!wantPlayer || tr.getAttribute('data-feat-player').indexOf(wantPlayer) !== -1);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    document.getElementById('feat-count').textContent = shown + ' shown';
  }

  document.getElementById('feat-year').addEventListener('change', applyFilters);
  document.getElementById('feat-team').addEventListener('change', applyFilters);
  document.getElementById('feat-kind').addEventListener('change', applyFilters);
  document.getElementById('feat-player').addEventListener('input', applyFilters);
  container.querySelectorAll('button[data-profile-id]').forEach(function (btn) {
    btn.addEventListener('click', function () { openPlayerProfile(btn.getAttribute('data-profile-id')); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderFeats: renderFeats,
    featsForPlayer: featsForPlayer,
    featLabel: featLabel,
    featShortLabel: featShortLabel,
    featStatLine: featStatLine
  };
}
