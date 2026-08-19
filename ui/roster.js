const ROSTER_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'position', label: 'Pos' },
  { key: 'age', label: 'Age' },
  { key: 'college', label: 'College' },
  { key: 'archetype', label: 'Archetype' },
  { key: 'status', label: 'Status' },
  { key: 'morale', label: 'Morale' },
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
  // The DERIVED label, not player.archetype (the internal generation id).
  if (key === 'archetype') { return archetypeLabel(player); }
  if (key === 'salary') { return player.contract.salary; }
  if (key === 'yearsRemaining') { return player.contract.yearsRemaining; }
  if (key === 'status') { return player.status.injury ? player.status.injury.gamesRemaining : 0; }
  if (key === 'morale') { return player.status.morale; }
  if (['ppg', 'rpg', 'apg', 'fgPct'].indexOf(key) !== -1) { return getPlayerAverages(player)[key]; }
  return player[key];
}

function injuryStatusHtml(player) {
  const injury = player.status.injury;
  if (!injury) return '<span class="pill pill-mute">&mdash;</span>';
  const label = injury.gamesRemaining >= 999 ? 'Out (season)' : 'Out ' + injury.gamesRemaining + 'g';
  return '<span class="pill pill-loss" title="' + injury.severity + '">' + label + '</span>';
}

const MORALE_EMOJI = { happy: '😊', neutral: '😐', unhappy: '😞' };

function moraleStatusHtml(player) {
  const morale = player.status.morale;
  const tier = moraleTier(morale);
  return '<span class="morale-chip morale-' + tier + '" title="Morale: ' + Math.round(morale) + '/100">' +
    MORALE_EMOJI[tier] + ' ' + Math.round(morale) + '</span>';
}

// Reads the shared bands rather than carrying its own numbers. The old
// 68/55/42 were written against the RAW scale, where the league averaged 48. On
// the display scale nothing sits below 60, so every one of those thresholds
// would have been cleared by nearly every player and the whole roster would
// have rendered a single colour.
function ratingTier(value) {
  // tier-superstar added with the broadcast re-skin: a filled accent chip,
  // the 2K-card look, reserved for the RATING_BANDS.superstar tier.
  if (value >= RATING_BANDS.superstar) return 'tier-superstar';
  if (value >= RATING_BANDS.star) return 'tier-elite';
  if (value >= RATING_BANDS.rotation) return 'tier-high';
  if (value >= RATING_BANDS.fringe) return 'tier-mid';
  return 'tier-low';
}

// The stored ids, filtered to players still on this roster. A traded or
// released starter leaves a stale id behind, so the list self-heals every time
// the page renders rather than needing a cleanup pass somewhere else.
function currentStarterIds(teamId) {
  const team = getTeamById(teamId);
  const stored = (team && team.startingFive) || [];
  const roster = getTeamRoster(teamId);
  return stored.filter(function (id) {
    return roster.some(function (p) { return p.id === id; });
  }).slice(0, 5);
}

function setStarterIds(teamId, ids) {
  getTeamById(teamId).startingFive = ids.slice(0, 5);
}

function renderRoster(container, teamId) {
  let sortKey = 'overall';
  let sortDir = -1; // descending by default
  const filters = { position: 'all', minOverall: 0, injuredOnly: false };
  // Waiving is a roster-management action, only ever valid for the user's
  // own team — inspecting an opponent's roster from Standings/Power
  // Rankings (see ui/standings.js) is read-only browsing, not control.
  // Scouting stays available either way (scouting an opponent is already a
  // normal, supported GM action elsewhere — see autoAllocateScoutPoints).
  const isOwnTeam = teamId === GameState.userTeamId;

  function draw() {
    let roster = getTeamRoster(teamId).slice().filter(function (p) {
      if (filters.position !== 'all' && p.position !== filters.position) return false;
      if (p.overall < filters.minOverall) return false;
      if (filters.injuredOnly && !p.status.injury) return false;
      return true;
    });
    roster.sort(function (a, b) {
      const av = rosterCellValue(a, sortKey);
      const bv = rosterCellValue(b, sortKey);
      if (av < bv) { return -1 * sortDir; }
      if (av > bv) { return 1 * sortDir; }
      return 0;
    });

    const fullRosterSize = getTeamRoster(teamId).length;
    const viewedTeam = getTeamById(teamId);
    let html = '<div class="view-header"><h2>' + (isOwnTeam ? 'Roster' : escapeHtml(viewedTeam.name) + ' Roster') + '</h2><span class="view-sub">' +
      (roster.length === fullRosterSize ? roster.length + ' players' : roster.length + ' of ' + fullRosterSize + ' players') + '</span></div>';
    if (!isOwnTeam) {
      html += '<div class="panel"><div class="panel-body toolbar" style="justify-content:space-between;align-items:center;">' +
        '<span class="kpi-sub">Viewing ' + teamLogoImgHtml(teamId, 18) + ' <strong>' + escapeHtml(viewedTeam.name) + '</strong> — browsing only, no roster moves available.</span>' +
        '<button class="btn-ghost" id="roster-back-to-mine">&larr; Back to My Roster</button></div></div>';
    }

    // Broadcast stat-chip strip: everything here already lives on the team
    // record — no new aggregates, and a 0-game season honestly shows '—'.
    const rec = getTeamById(teamId).record;
    const gp = rec.wins + rec.losses;
    const chip = function (label, value) {
      return '<div class="stat-chip"><span class="tick-k">' + label + '</span>' +
        '<span class="tick-v">' + value + '</span></div>';
    };
    html += '<div class="stat-chips">' +
      chip('Record', rec.wins + '–' + rec.losses) +
      chip('PPG', gp ? (rec.pointsFor / gp).toFixed(1) : '—') +
      chip('Opp PPG', gp ? (rec.pointsAgainst / gp).toFixed(1) : '—') +
      chip('Payroll', '$' + Math.round(getTeamPayroll(teamId) / 1e6) + 'M') +
      '</div>';

    // The starting five picker, own team only. Whoever is listed here leads
    // the shared lineup ordering (simEngineBoxScore's lineupOrder), so these
    // five both tip off AND carry starter minute targets.
    if (isOwnTeam) {
      const starterIds = currentStarterIds(teamId);
      const fullRoster = getTeamRoster(teamId);
      const byId = {};
      fullRoster.forEach(function (p) { byId[p.id] = p; });

      let slots = '';
      for (let i = 0; i < 5; i++) {
        const p = byId[starterIds[i]];
        slots += p
          ? '<div class="lineup-slot"><div class="nm">' + escapeHtml(p.name) + '</div>' +
            '<div class="mt">' + p.position + ' · ' +
            '<span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></div></div>'
          : '<div class="lineup-slot is-empty"><div class="nm">Auto</div>' +
            '<div class="mt">coach picks</div></div>';
      }

      // Informational only: position genuinely does not affect the simulation,
      // so blocking an unusual five would enforce a rule the engine ignores.
      const hasCenter = starterIds.some(function (id) { return byId[id] && byId[id].position === 'C'; });
      const note = (starterIds.length === 5 && !hasCenter)
        ? '<span class="lineup-note">No true center — the sim does not mind, but you might.</span>'
        : '';

      html += '<div class="lineup-strip" id="lineup-strip">' + slots +
        (starterIds.length > 0
          ? '<button class="btn-ghost" id="lineup-auto">Auto</button>'
          : '') +
        note + '<span class="lineup-note" id="lineup-hint"></span></div>';
    }

    html += '<div class="panel"><div class="panel-body toolbar">' +
      '<label>Position: <select id="roster-filter-position">' +
      ['all'].concat(POSITIONS).map(function (pos) {
        return '<option value="' + pos + '"' + (filters.position === pos ? ' selected' : '') + '>' + (pos === 'all' ? 'All' : pos) + '</option>';
      }).join('') + '</select></label> ' +
      '<label>Min OVR: <input type="number" id="roster-filter-min-overall" value="' + filters.minOverall + '" min="0" max="99" style="width:60px;"></label> ' +
      '<label><input type="checkbox" id="roster-filter-injured"' + (filters.injuredOnly ? ' checked' : '') + '> Injured only</label>' +
      '</div></div>';

    const rosterTeam = getTeamById(teamId);
    html += '<div class="panel"><table class="data-table"><thead><tr>';
    html += '<th></th>';
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
        '<td>' + playerSpriteHtml(p, rosterTeam, 32) + '</td>' +
        '<td class="col-name"><button class="player-link" data-profile-id="' + p.id + '">' + escapeHtml(p.name) + '</button></td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td>' + (p.college || '—') + '</td>' +
        '<td>' + archetypeLabel(p) + '</td>' +
        '<td>' + injuryStatusHtml(p) + '</td>' +
        '<td>' + moraleStatusHtml(p) + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.potentialDisplay) + '">' + p.potentialDisplay + '</span></td>' +
        '<td class="num">' + avg.ppg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.rpg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.apg.toFixed(1) + '</td>' +
        '<td class="num">' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td class="num">$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td class="num">' + p.contract.yearsRemaining + '</td>' +
        '<td class="actions">' +
          (isOwnTeam ? '<button class="btn-ghost lineup-toggle' +
            (currentStarterIds(teamId).indexOf(p.id) !== -1 ? ' is-on' : '') +
            '" data-lineup-id="' + p.id + '">' +
            (currentStarterIds(teamId).indexOf(p.id) !== -1 ? 'Starting' : 'Start') + '</button> ' : '') +
          '<button class="btn-ghost" data-scout-id="' + p.id + '">Scout</button>' +
          (isOwnTeam ? ' <button class="btn-danger" data-waive-id="' + p.id + '">Waive</button>' : '') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    // GP and the per-game columns exist so this table's units line up with the
    // roster table above it. Previously it showed Tatum as "82" directly under
    // a row saying "16.4" — the same player over the same five games, with no
    // denominator anywhere on screen to reconcile them. Totals are kept
    // alongside rather than replaced: career points is the headline career
    // number, and dropping it to fix the units would trade one problem for
    // another.
    // The team's shot diet, summed from the same season lines a player's own
    // chart is drawn from — one code path, so a roster chart and the sum of
    // its players can never disagree.
    html += shotChartPanelHtml('Team Shot Chart', teamShotTotals(roster));
    html += lineupsPanelHtml(viewedTeam, getPlayerById, GameState.settings && GameState.settings.simEngine);

    html += '<div class="panel"><div class="panel-header">Career Totals</div>' +
      '<table class="data-table"><thead><tr><th>Name</th><th class="num">Seasons</th><th class="num">GP</th>' +
      '<th class="num">Pts</th><th class="num">PPG</th><th class="num">RPG</th><th class="num">APG</th>' +
      '<th class="num">Titles</th></tr></thead><tbody>';
    roster.forEach(function (p) {
      ensureCareerData([p]);
      // Career to date, including the season being played — otherwise this
      // whole table is a column of zeros for a league's entire first year.
      const cs = careerTotalsToDate(p);
      // Guarded: a player who has never appeared would divide by zero and
      // render every rate as NaN.
      const gp = cs.gamesPlayed || 0;
      const per = function (total) { return gp > 0 ? (total / gp).toFixed(1) : '—'; };
      // A button, not plain text, so a name opens the profile here exactly as
      // it does in the table above — the delegated data-profile-id handler
      // below is bound container-wide and picks these up unchanged.
      html += '<tr><td class="col-name"><button class="player-link" data-profile-id="' + p.id + '">' +
        escapeHtml(p.name) + '</button></td><td class="num">' + cs.seasonsPlayed +
        '</td><td class="num">' + gp +
        '</td><td class="num">' + cs.points +
        '</td><td class="num">' + per(cs.points) +
        '</td><td class="num">' + per(cs.rebounds) +
        '</td><td class="num">' + per(cs.assists) + '</td><td class="num">' +
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

    // Toggling reads and writes the STORED list, then redraws from it — never
    // from a local copy — so the strip, the row buttons and what the sim will
    // actually do can never disagree.
    container.querySelectorAll('button[data-lineup-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-lineup-id');
        const ids = currentStarterIds(teamId);
        const at = ids.indexOf(id);
        if (at !== -1) {
          ids.splice(at, 1);
          setStarterIds(teamId, ids);
        } else if (ids.length >= 5) {
          // Refuse rather than silently swapping somebody out: predictable
          // beats clever when five things are already chosen.
          const hint = document.getElementById('lineup-hint');
          if (hint) hint.textContent = 'Five already chosen — remove one first.';
          return;
        } else {
          ids.push(id);
          setStarterIds(teamId, ids);
        }
        draw();
      });
    });

    const autoBtn = document.getElementById('lineup-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', function () {
        setStarterIds(teamId, []);
        draw();
      });
    }

    container.querySelectorAll('button[data-waive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const playerId = btn.getAttribute('data-waive-id');
        const result = waivePlayer(playerId);
        if (!result.success) {
          alert(result.reason);
          return;
        }
        draw();
      });
    });

    document.getElementById('roster-filter-position').addEventListener('change', function (e) {
      filters.position = e.target.value;
      draw();
    });
    document.getElementById('roster-filter-min-overall').addEventListener('change', function (e) {
      filters.minOverall = Number(e.target.value) || 0;
      draw();
    });
    document.getElementById('roster-filter-injured').addEventListener('change', function (e) {
      filters.injuredOnly = e.target.checked;
      draw();
    });

    container.querySelectorAll('button[data-scout-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        GameState.pendingScoutReportId = btn.getAttribute('data-scout-id');
        renderView('scouting');
      });
    });

    container.querySelectorAll('button[data-profile-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPlayerProfile(btn.getAttribute('data-profile-id')); });
    });

    const backBtn = document.getElementById('roster-back-to-mine');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        GameState.inspectTeamId = null;
        renderView('roster');
      });
    }
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderRoster: renderRoster, rosterCellValue: rosterCellValue };
}
