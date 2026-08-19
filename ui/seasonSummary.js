// Auto-shown right when the Finals wrap up (see ui/simControls.js's
// openSeasonSummary, wired into handleNextGame/handleSimToEnd) — same idea as
// ZenGM's "season summary" screen: champion, best record per conference, and
// the season's award winners, all in one place instead of scattered across
// the Playoffs/Awards/History tabs. Also reachable any time via the League
// nav item, where it always shows the most recently completed season.
// Two of these awards are genuinely unwinnable in a league's first season, and
// a bare em dash made that read as a broken screen. Rookie of the Year has
// nobody to give it to — the 2026 rosters contain no player with yearsPro 0,
// because the first rookie class arrives at the first draft. Most Improved has
// nothing to compare against — improvement is measured between two seasons the
// same engine played, and in year one there is only the one.
//
// Both are correct behaviour, so the fix is to say so rather than to invent a
// winner.
const AWARD_EMPTY_NOTES = {
  roy: ['Not awarded', 'No rookies in the league this season'],
  mip: ['Not awarded', 'Needs a previous season to improve on']
};

function seasonSummaryAwardTile(winners, awardKey, label) {
  const w = winners.find(function (x) { return x.award === awardKey; });
  const player = w ? getPlayerById(w.playerId) : null;
  const team = player && player.teamId ? getTeamById(player.teamId) : null;
  const note = w ? null : AWARD_EMPTY_NOTES[awardKey];
  const value = w
    ? '<a href="javascript:void(0)" data-profile-id="' + w.playerId + '">' + escapeHtml(w.playerName) + '</a>'
    : (note ? '<span class="kpi-muted">' + escapeHtml(note[0]) + '</span>' : '—');
  const sub = team ? escapeHtml(team.name) : (note ? escapeHtml(note[1]) : '');
  return '<div class="kpi-tile"><div class="kpi-label">' + escapeHtml(label) + '</div>' +
    '<div class="kpi-value">' + value + '</div>' +
    (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
}

const SEASON_SUMMARY_SIMPLE_AWARDS = [
  ['mvp', 'MVP'], ['dpoy', 'Defensive Player of the Year'], ['roy', 'Rookie of the Year'],
  ['sixthMoy', 'Sixth Man of the Year'], ['mip', 'Most Improved Player']
];
const SEASON_SUMMARY_ALL_NBA = [['allNba1', 'All-NBA First Team'], ['allNba2', 'All-NBA Second Team'], ['allNba3', 'All-NBA Third Team']];

function renderSeasonSummary(container) {
  const year = GameState.summarySeasonYear ||
    (LEAGUE_HISTORY.champions.length > 0 ? LEAGUE_HISTORY.champions[LEAGUE_HISTORY.champions.length - 1].leagueYear : null);
  const champRecord = year !== null ? LEAGUE_HISTORY.champions.find(function (c) { return c.leagueYear === year; }) : null;
  const awardsRecord = year !== null ? LEAGUE_HISTORY.awardsHistory.find(function (a) { return a.leagueYear === year; }) : null;

  let html = '<div class="view-header"><h2>' + (champRecord ? champRecord.leagueYear + ' Season Recap' : 'Season Recap') +
    '</h2><span class="view-sub">Champion, best records, and award winners for the season that just wrapped</span></div>';

  if (!champRecord) {
    container.innerHTML = html + '<div class="empty-state">No season has finished yet — this fills in once the Finals wrap up.</div>';
    return;
  }

  const champTeam = getTeamById(champRecord.teamId);
  html += '<div class="panel"><div class="panel-body" style="text-align:center;">' +
    '<div class="kpi-label">League Champions</div>' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0;">' +
    teamLogoImgHtml(champTeam.id, 48) + '<span class="kpi-value" style="font-size:28px;">🏆 ' + escapeHtml(champTeam.name) + '</span></div>' +
    '</div></div>';

  if (champRecord.bestRecordByConference) {
    const confs = Object.keys(champRecord.bestRecordByConference);
    if (confs.length > 0) {
      html += '<div class="panel"><div class="panel-header">Best Record</div><div class="panel-body kpi-grid">';
      confs.forEach(function (conf) {
        const r = champRecord.bestRecordByConference[conf];
        const t = getTeamById(r.teamId);
        html += '<div class="kpi-tile"><div class="kpi-label">' + escapeHtml(conf) + '</div>' +
          '<div class="kpi-value">' + (t ? escapeHtml(t.name) : '—') + '</div>' +
          '<div class="kpi-sub">' + r.wins + '-' + r.losses + '</div></div>';
      });
      html += '</div></div>';
    }
  }

  if (awardsRecord) {
    html += '<div class="panel"><div class="panel-header">Awards</div><div class="panel-body kpi-grid">';
    SEASON_SUMMARY_SIMPLE_AWARDS.forEach(function (pair) {
      html += seasonSummaryAwardTile(awardsRecord.winners, pair[0], pair[1]);
    });
    html += '</div></div>';

    if (awardsRecord.coachOfTheYear) {
      html += '<div class="panel"><div class="panel-header">Coach of the Year</div><div class="panel-body">' +
        escapeHtml(awardsRecord.coachOfTheYear.coach.name) + ' (' + escapeHtml(awardsRecord.coachOfTheYear.teamName) + ')</div></div>';
    }

    SEASON_SUMMARY_ALL_NBA.forEach(function (pair) {
      const names = awardsRecord.winners.filter(function (w) { return w.award === pair[0]; });
      if (names.length === 0) return;
      html += '<div class="panel"><div class="panel-header">' + pair[1] + '</div><div class="panel-body">' +
        names.map(function (w) { return '<a href="javascript:void(0)" data-profile-id="' + w.playerId + '">' + escapeHtml(w.playerName) + '</a>'; }).join(', ') +
        '</div></div>';
    });
  }

  const retirees = LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.retiredYear === champRecord.leagueYear; });
  if (retirees.length > 0) {
    html += '<div class="panel"><div class="panel-header">Retiring This Offseason</div><div class="panel-body">' +
      retirees.map(function (r) { return escapeHtml(r.name) + (r.hallOfFame ? ' <span class="pill pill-gold">HOF</span>' : ''); }).join(', ') +
      '</div></div>';
  }

  // Only meaningful right after the auto-trigger (script.js's
  // handleAdvanceToOffseason) — the draft session it built is sitting in
  // GameState ready to go, this just saves a trip through the sidebar nav.
  // Browsing an older recap later (offseasonStage has since moved on or
  // reset to null) hides it rather than linking to a stale/absent session.
  const showContinue = champRecord.leagueYear === GameState.leagueYear - 1 && GameState.offseasonStage === 'draft';
  if (showContinue) {
    html += '<div class="panel"><div class="panel-body" style="text-align:right;">' +
      '<button class="btn-primary" id="season-summary-continue">Continue to Draft →</button></div></div>';
  }

  container.innerHTML = html;
  container.querySelectorAll('[data-profile-id]').forEach(function (el) {
    el.addEventListener('click', function () { openPlayerProfile(el.getAttribute('data-profile-id')); });
  });
  if (showContinue) {
    document.getElementById('season-summary-continue').addEventListener('click', function () { renderView('draft'); });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSeasonSummary: renderSeasonSummary };
}
