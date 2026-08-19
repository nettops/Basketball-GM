// The career page. Two faces of ONE derived record: the chronicle timeline and
// the trophy room. Neither stores anything — both read gmCareer's queries — so
// the banner count can never disagree with the title count above it.
function careerTrophyRoomHtml(career, totals) {
  const years = gmCareerTitleYears(career);
  if (years.length === 0) {
    return '<div class="empty-state">No banners yet. The rafters are waiting.</div>';
  }
  return '<div class="trophy-room">' +
    years.map(function (y) {
      return '<div class="banner"><div class="banner-year">' + y + '</div>' +
             '<div class="banner-label">CHAMPIONS</div></div>';
    }).join('') +
    '</div><div class="kpi-sub" style="margin-top:8px;">' +
      years.length + (years.length === 1 ? ' championship' : ' championships') +
      ' &middot; ' + totals.finalsAppearances + ' Finals appearance' + (totals.finalsAppearances === 1 ? '' : 's') +
    '</div>';
}

function careerChronicleHtml(career) {
  const entries = (career.chronicle || []).slice().reverse();
  if (entries.length === 0) {
    return '<div class="empty-state">Your career starts here. Finish a season and it will have something to say.</div>';
  }
  return '<ul class="headline-list">' + entries.map(function (e) {
    // Same reason ui/liveFeed.js escapes feed text: chronicle lines embed
    // player and team names, which are user-editable via commissioner tools.
    return '<li><span class="pill pill-mute">' + e.leagueYear + '</span> ' +
      '<span class="pill ' + (e.kind === 'milestone' ? 'pill-win' : 'pill-mute') + '">' + escapeHtml(e.kind) + '</span> ' +
      escapeHtml(e.text) + '</li>';
  }).join('') + '</ul>';
}

function careerMilestoneListHtml(career, ctx) {
  const visible = GM_MILESTONES.filter(function (m) { return !m.hidden; });
  const hiddenAll = GM_MILESTONES.filter(function (m) { return m.hidden; });
  const hiddenFound = hiddenAll.filter(function (m) { return gmMilestoneIsUnlocked(career, m.id); });

  const rows = visible.map(function (m) {
    const done = gmMilestoneIsUnlocked(career, m.id);
    const unlock = (career.milestones || []).find(function (u) { return u.id === m.id; });
    let progressCell = done ? (unlock && unlock.leagueYear ? String(unlock.leagueYear) : 'done') : '—';
    if (!done && m.progress) {
      const p = m.progress(ctx);
      if (p && p.target) progressCell = p.current + ' / ' + p.target;
    }
    return '<tr><td>' + (done ? '<span class="pill pill-win">&#10003;</span>' : '<span class="pill pill-mute">&middot;</span>') + '</td>' +
      '<td class="col-name">' + escapeHtml(m.label) + '</td>' +
      '<td>' + escapeHtml(m.description) + '</td>' +
      '<td class="num">' + escapeHtml(progressCell) + '</td></tr>';
  }).join('');

  // Hidden ones are never NAMED until earned — a locked count, not a spoiler.
  const undiscovered = hiddenAll.length - hiddenFound.length;
  const hiddenHtml = hiddenFound.map(function (m) {
    return '<tr><td><span class="pill pill-win">&#10003;</span></td><td class="col-name">' + escapeHtml(m.label) + '</td>' +
      '<td>' + escapeHtml(m.description) + '</td><td class="num">&mdash;</td></tr>';
  }).join('') +
    (undiscovered > 0
      ? '<tr><td><span class="pill pill-mute">?</span></td><td class="col-name">' + undiscovered +
        ' undiscovered</td><td>Something is still out there.</td><td class="num">&mdash;</td></tr>'
      : '');

  return '<table class="data-table"><thead><tr><th></th><th>Milestone</th><th>How</th><th class="num">Progress</th></tr></thead>' +
    '<tbody>' + rows + hiddenHtml + '</tbody></table>';
}

// The owner's standing demand and how much rope is left.
//
// File scope and exported rather than inline in the renderer, per the
// ui/pixelMotion.js lesson — and because "on notice" is exactly the sort of
// string that ends up subtly wrong with no test able to see it.
// What being sacked actually looks like. Without this the owner fires you and
// the game carries on as though he had not, which is worse than not having a
// firing at all.
function firedPanelHtml(career, fired) {
  if (!fired) return '';
  const oldTeam = getTeamById(fired.teamId);
  const suitors = clubsWillingToHire(career, TEAMS, fired.teamId).slice(0, 5);
  return '<div class="panel"><div class="panel-header">You Were Fired</div><div class="panel-body">' +
    '<p class="kpi-sub">The ' + escapeHtml(oldTeam ? oldTeam.name : fired.teamId) +
    ' relieved you of your duties after the ' + fired.leagueYear + ' season.</p>' +
    (suitors.length === 0
      ? '<div class="empty-state">Nobody is interested. Your reputation precedes you.</div>'
      : '<table class="data-table"><thead><tr><th>Club</th><th class="num">Prestige</th><th></th></tr></thead><tbody>' +
        suitors.map(function (t) {
          return '<tr><td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + escapeHtml(t.name) + '</td>' +
            '<td class="num">' + (t.prestige || 50) + '</td>' +
            '<td><button class="btn-primary" data-hire-id="' + t.id + '">Take the job</button></td></tr>';
        }).join('') + '</tbody></table>') +
    '</div></div>';
}

function ownerMandatePanelHtml(career, team, mandate) {
  if (!mandate) {
    return '<div class="panel"><div class="panel-header">The Owner</div><div class="panel-body">' +
      '<div class="empty-state">No standing mandate. The owner will set one before next season.</div>' +
      '</div></div>';
  }

  const patience = currentPatience(career, team ? team.id : '');
  const label = patienceLabel(patience);
  const warn = patience < OWNER_PATIENCE;

  return '<div class="panel"><div class="panel-header">The Owner</div><div class="panel-body">' +
    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">This Season You Must</div>' +
        '<div class="kpi-value">' + escapeHtml(mandate.label) + '</div>' +
        '<div class="kpi-sub">set for ' + (mandate.leagueYear || '') + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Job Security</div>' +
        '<div class="kpi-value ' + (warn ? 'is-warn' : '') + '">' + escapeHtml(label) + '</div>' +
        '<div class="kpi-sub">' + (patience === 0 ? 'the next miss is the last'
          : patience + ' more miss' + (patience === 1 ? '' : 'es') + ' costs you the job') + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Owner Happiness</div>' +
        '<div class="kpi-value">' + Math.round((team && team.ownerHappiness) || 0) + '</div>' +
        '<div class="kpi-sub">out of 99</div></div>' +
    '</div></div></div>';
}

function renderGmCareer(container) {
  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const team = getTeamById(GameState.userTeamId);
  const ctx = gmBuildMilestoneContext(career, LEAGUE_HISTORY, PLAYERS_2026,
    LEAGUE_HISTORY.retiredPlayers, toDisplayRating);

  const pct = totals.seasons > 0 ? (totals.winPct * 100).toFixed(1) : '0.0';

  container.innerHTML =
    '<div class="view-header"><h2>' + escapeHtml(career.name) + '</h2>' +
      '<span class="view-sub">General Manager &middot; ' + escapeHtml(team ? team.name : '') + '</span></div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Seasons</div><div class="kpi-value">' + totals.seasons + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div><div class="kpi-value">' + totals.wins + '-' + totals.losses + '</div>' +
        '<div class="kpi-sub">' + pct + '% won</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Championships</div><div class="kpi-value">' + totals.titles + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Playoff Trips</div><div class="kpi-value">' + totals.playoffAppearances + '</div></div>' +
      // Banded, with the raw number underneath: the band is what the value
      // MEANS, and nothing in the simulation reads either one.
      '<div class="kpi-tile"><div class="kpi-label">Reputation</div>' +
        '<div class="kpi-value">' + escapeHtml(reputationBand(career.reputation)) + '</div>' +
        '<div class="kpi-sub">' + Math.round(career.reputation) + ' / 100</div></div>' +
    '</div>' +

    firedPanelHtml(career, GameState.firedAtEndOfSeason) +

    // A mandate nobody can see before it is failed is a punishment, not a goal.
    ownerMandatePanelHtml(career, team, GameState.ownerMandate) +

    '<div class="panel"><div class="panel-header">Trophy Room</div><div class="panel-body">' +
      careerTrophyRoomHtml(career, totals) + '</div></div>' +

    '<div class="panel"><div class="panel-header">Milestones</div><div class="panel-body">' +
      careerMilestoneListHtml(career, ctx) + '</div></div>' +

    '<div class="panel"><div class="panel-header">Career Chronicle</div><div class="panel-body">' +
      careerChronicleHtml(career) + '</div></div>';

  container.querySelectorAll('button[data-hire-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const teamId = btn.getAttribute('data-hire-id');
      startTenure(career, teamId, GameState.leagueYear || 2026);
      GameState.userTeamId = teamId;
      GameState.firedAtEndOfSeason = null;
      // A new employer sets his own terms straight away, rather than leaving
      // the GM judged next year against the club he no longer works for.
      setMandate(GameState, getTeamById(teamId), getTeamRoster(teamId), GameState.rng,
        { payroll: getTeamPayroll(teamId), capLevel: GameState.settings.capLevel });
      // ui-safety: not-markup — feed text, escaped once at render (ui/liveFeed.js).
      pushToFeed('You have been hired by the ' + getTeamById(teamId).name + '.');
      renderGmCareer(container);
      renderTopBar(document.getElementById('app-topbar'));
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ownerMandatePanelHtml: ownerMandatePanelHtml,
    firedPanelHtml: firedPanelHtml, renderGmCareer: renderGmCareer };
}
