const COACH_SPECIALTY_LABELS = { offense: 'Offense', defense: 'Defense', development: 'Player Development' };

const PACE_DIAL_OPTIONS = [
  { value: -1, label: 'Slow' },
  { value: 0, label: 'Balanced' },
  { value: 1, label: 'Fast' }
];

const THREE_RATE_DIAL_OPTIONS = [
  { value: -1, label: 'Low' },
  { value: 0, label: 'Balanced' },
  { value: 1, label: 'High' }
];

function coachCardHtml(coach) {
  if (!coach) return '<div class="empty-state">No coach hired.</div>';
  return '<div class="kpi-grid">' +
    '<div class="kpi-tile"><div class="kpi-label">Coach</div><div class="kpi-value">' + escapeHtml(coach.name) + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Overall</div><div class="kpi-value">' + coach.overall + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Specialty</div><div class="kpi-value">' + COACH_SPECIALTY_LABELS[coach.specialty] + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Tenure</div><div class="kpi-value">' + coach.seasonsWithTeam + '</div><div class="kpi-sub">seasons with this team</div></div>' +
    // Hiring a coach sets the game plan below, so what he believes in has to be
    // on the card BEFORE the decision rather than discovered afterwards.
    '<div class="kpi-tile"><div class="kpi-label">Playbook</div><div class="kpi-value">' + escapeHtml(coachLeanLabel(coach)) + '</div></div>' +
  '</div>';
}

// The reason this whole feature exists. Before it, a GM could set the
// three-point dial to its highest setting and there was no screen anywhere in
// the game that would tell them whether the shot mix moved. The dial had no
// readout, so it may as well not have been connected.
//
// League share is computed from the same season lines rather than hardcoded,
// so it stays honest as the league drifts.
function shotDietReadoutHtml(userTeamId) {
  const mine = teamShotTotals(getTeamRoster(userTeamId));
  const mineFga = mine.insideFga + mine.midFga + mine.tpa;
  if (!mineFga) {
    return '<p class="kpi-sub" style="margin-top:10px;">Play some games to see what your game plan is actually producing.</p>';
  }
  let leagueThree = 0, leagueFga = 0;
  TEAMS.forEach(function (t) {
    const s = teamShotTotals(getTeamRoster(t.id));
    leagueThree += s.tpa;
    leagueFga += s.insideFga + s.midFga + s.tpa;
  });
  const mineShare = mine.tpa / mineFga;
  const leagueShare = leagueFga > 0 ? leagueThree / leagueFga : 0;
  const gap = (mineShare - leagueShare) * 100;
  const gapClass = Math.abs(gap) < 1 ? 'text-dim' : (gap > 0 ? 'stat-up' : 'stat-down');
  return '<p class="kpi-sub" style="margin-top:10px;">Your team takes ' +
    '<strong>' + (mineShare * 100).toFixed(1) + '%</strong> of its shots from three ' +
    '&mdash; league average is ' + (leagueShare * 100).toFixed(1) + '%, ' +
    '<span class="' + gapClass + '">' + (gap >= 0 ? '+' : '') + gap.toFixed(1) + ' pts</span>.</p>';
}

function renderCoaching(container, userTeamId) {
  let candidates = null;

  function draw() {
    const team = getTeamById(userTeamId);
    // Only auto-fill a coach on first load (never had one yet) — mid-flow
    // between firing and hiring, team.coach is deliberately null and should
    // stay that way until the user picks a candidate below.
    if (!team.coach && !candidates) ensureTeamCoach(team, GameState.rng);
    if (!team.strategy) team.strategy = { pace: 0, threePointRate: 0 };

    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Coaching</h2>' +
      '<span class="view-sub">Head coach, staff, and game plan</span></div>';

    html += '<div class="panel"><div class="panel-header">Head Coach</div><div class="panel-body">' +
      coachCardHtml(team.coach) +
      // btn-danger, not the btn-secondary that was here: that class has no rule
      // in style.css and never had one, so this button silently rendered as a
      // plain default button. Firing a coach is destructive, and btn-danger is
      // what Waive, Delete Player and Rewind already use.
      '<div class="toolbar" style="margin-top:10px;"><button id="coaching-fire-btn" class="btn-danger">Fire Coach</button></div>' +
    '</div></div>';

    if (candidates) {
      html += '<div class="panel"><div class="panel-header">Coaching Candidates</div><div class="panel-body">' +
        '<table class="data-table"><thead><tr><th>Name</th><th class="num">Overall</th><th>Specialty</th><th>Playbook</th><th></th></tr></thead><tbody>' +
        candidates.map(function (c, i) {
          return '<tr><td class="col-name">' + escapeHtml(c.name) + '</td><td class="num">' + c.overall + '</td><td>' + COACH_SPECIALTY_LABELS[c.specialty] + '</td>' +
            '<td>' + escapeHtml(coachLeanLabel(c)) + '</td>' +
            '<td><button class="btn-primary" data-hire-index="' + i + '">Hire</button></td></tr>';
        }).join('') + '</tbody></table>' +
      '</div></div>';
    }

    html += '<div class="panel"><div class="panel-header">Game Plan</div><div class="panel-body">' +
      '<p class="kpi-sub">Nudges how your team plays — a real but modest effect on pace and shot selection.</p>' +
      '<label class="toggle-row" style="display:block;">Pace<br><select id="coaching-pace-select">' +
      PACE_DIAL_OPTIONS.map(function (opt) {
        return '<option value="' + opt.value + '"' + (team.strategy.pace === opt.value ? ' selected' : '') + '>' + opt.label + '</option>';
      }).join('') + '</select></label>' +
      '<label class="toggle-row" style="display:block;">Three-Point Rate<br><select id="coaching-three-select">' +
      THREE_RATE_DIAL_OPTIONS.map(function (opt) {
        return '<option value="' + opt.value + '"' + (team.strategy.threePointRate === opt.value ? ' selected' : '') + '>' + opt.label + '</option>';
      }).join('') + '</select></label>' +
      shotDietReadoutHtml(userTeamId) +
    '</div></div>';

    container.innerHTML = html;

    document.getElementById('coaching-fire-btn').addEventListener('click', function () {
      team.coach = null;
      candidates = generateCoachCandidates(GameState.rng, 3);
      draw();
    });

    container.querySelectorAll('button[data-hire-index]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = Number(btn.getAttribute('data-hire-index'));
        hireCoach(team, candidates[idx], GameState.leagueYear || 2026);
        candidates = null;
        draw();
      });
    });

    document.getElementById('coaching-pace-select').addEventListener('change', function (e) {
      team.strategy.pace = Number(e.target.value);
    });
    document.getElementById('coaching-three-select').addEventListener('change', function (e) {
      team.strategy.threePointRate = Number(e.target.value);
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderCoaching: renderCoaching };
}
