function injuryLabel(injury) {
  return injury.gamesRemaining >= 999 ? 'Out (season) — ' + injury.severity : 'Out ' + injury.gamesRemaining + 'g — ' + injury.severity;
}

function topLeaders(players, statKey, n) {
  return players
    .filter(function (p) { return p.seasonStats && p.seasonStats.gamesPlayed > 0; })
    .slice()
    .sort(function (a, b) { return getPlayerAverages(b)[statKey] - getPlayerAverages(a)[statKey]; })
    .slice(0, n);
}

// Score-result feed lines ("Team A 120, Team B 117") are already fully
// browsable in the Live Feed tab — headlines surface everything ELSE (trades,
// injuries, signings, offseason news) so the dashboard reads as "what
// happened" rather than a running scoreboard. The feed has no structured
// event types (see script.js's pushToFeed), so this is a text-shape heuristic
// rather than a real classification.
const SCORE_LINE_PATTERN = /^.+\s\d+,\s.+\s\d+$/;

function recentHeadlines(feed, n) {
  return feed.filter(function (entry) { return !SCORE_LINE_PATTERN.test(entry.text); })
    .slice(-n)
    .reverse();
}


// One game reduced to the user's side of it. `opp` is the full team object so
// callers can reach the id (which IS the display abbreviation) or the name.
function teamGameRow(g, teamId) {
  const home = g.homeTeamId === teamId;
  const opp = getTeamById(home ? g.awayTeamId : g.homeTeamId);
  return { day: g.day, opp: opp, home: home,
    ownScore: home ? g.homeScore : g.awayScore,
    oppScore: home ? g.awayScore : g.homeScore,
    won: home ? g.homeScore > g.awayScore : g.awayScore > g.homeScore };
}

// Read from the live schedule the same way powerRankings' recentFormWinPct
// does — no separately tracked form/streak state to drift. Played playoff
// games appended to season.games carry day: null; the ascending sort parks
// them at the front, so slicing from the TAIL still yields the most recent
// regular-season games, and the day > currentDay guard keeps nulls out of
// "upcoming" entirely.
function lastPlayedGames(teamId, season, n) {
  if (!season) return [];
  return season.games
    .filter(function (g) { return g.played && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return (a.day || 0) - (b.day || 0); })
    .slice(-n)
    .map(function (g) { return teamGameRow(g, teamId); });
}

function upcomingGames(teamId, season, n) {
  if (!season) return [];
  return season.games
    .filter(function (g) { return !g.played && g.day > season.currentDay &&
      (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; })
    .slice(0, n)
    .map(function (g) { return teamGameRow(g, teamId); });
}

function teamStreak(teamId, season) {
  const played = lastPlayedGames(teamId, season, 82);
  if (played.length === 0) return '—';
  const lastWon = played[played.length - 1].won;
  let run = 0;
  for (let i = played.length - 1; i >= 0 && played[i].won === lastWon; i--) run++;
  return (lastWon ? 'W' : 'L') + run;
}

// Seeding comes from getPlayoffSeeds (playoffs.js) — wins, then point diff —
// not the standings page's wins-only divisional sort, so the number shown here
// is the seed the bracket would actually hand out today.
function seedLabel(team) {
  const seeds = getPlayoffSeeds(team.conference, 15);
  const idx = seeds.findIndex(function (t) { return t.id === team.id; });
  return ordinal(idx + 1) + ' ' + team.conference;
}

function divisionLabel(team) {
  const div = TEAMS.filter(function (t) { return t.division === team.division; })
    .slice()
    .sort(function (a, b) { return b.record.wins - a.record.wins; });
  const idx = div.findIndex(function (t) { return t.id === team.id; });
  return idx === 0 ? team.division + ' leaders' : ordinal(idx + 1) + ' ' + team.division;
}

// The "what do I do next" answer, on the screen you already land on. Three
// clicks away and it stops answering the question.
//
// gmNearestMilestone excludes hidden and binary milestones — the first would
// spoil a surprise, the second has no honest halfway point — and also anything
// already satisfied. When nothing qualifies it returns null and this renders
// the remaining COUNT rather than an empty panel.
function careerHintHtml() {
  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const ctx = gmBuildMilestoneContext(career, LEAGUE_HISTORY, PLAYERS_2026,
    LEAGUE_HISTORY.retiredPlayers, toDisplayRating);
  const near = gmNearestMilestone(career, ctx);

  const summary = '<div class="kpi-sub">' + totals.seasons + ' season' + (totals.seasons === 1 ? '' : 's') +
    ' &middot; ' + totals.wins + '-' + totals.losses +
    ' &middot; ' + totals.titles + (totals.titles === 1 ? ' title' : ' titles') + '</div>';

  if (!near) {
    const remaining = GM_MILESTONES.filter(function (m) {
      return !m.hidden && !gmMilestoneIsUnlocked(career, m.id);
    }).length;
    return summary + '<div class="kpi-value" style="font-size:1.05rem;">' +
      (remaining > 0 ? remaining + ' milestones left to chase' : 'Every milestone earned.') + '</div>';
  }

  const pct = Math.min(100, Math.round((near.current / near.target) * 100));
  return summary +
    '<div class="kpi-label" style="margin-top:10px;">Closest milestone</div>' +
    '<div class="kpi-value" style="font-size:1.05rem;">' + escapeHtml(near.milestone.label) + '</div>' +
    '<div class="kpi-sub">' + escapeHtml(near.milestone.description) + '</div>' +
    '<div class="meter" style="margin:8px 0 6px;"><div class="meter-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="kpi-sub">' + near.current + ' of ' + near.target + '</div>';
}

// One .lead-cols column: the team's top 3 in a stat plus the league's best,
// so "how do my guys stack up" needs no second panel.
function leaderColHtml(title, roster, statKey, statLabel) {
  const mine = topLeaders(roster, statKey, 3);
  const league = topLeaders(PLAYERS_2026, statKey, 1)[0];
  let html = '<div><div class="k">' + title + '</div>';
  if (mine.length === 0) {
    html += '<div class="empty-state">No games played yet.</div>';
  } else {
    html += mine.map(function (p, i) {
      return '<div class="lead-row' + (i > 0 ? ' dim2' : '') + '"><span>' + escapeHtml(p.name) + '</span>' +
        '<span class="num">' + (i > 0 ? '' : '<b>') + getPlayerAverages(p)[statKey].toFixed(1) + (i > 0 ? '' : '</b>') + '</span></div>';
    }).join('');
  }
  if (league) {
    const leagueTeam = getTeamById(league.teamId);
    html += '<div class="lead-league">League: ' + escapeHtml(league.name) +
      (leagueTeam ? ' <span>' + leagueTeam.id + '</span>' : '') +
      ' ' + getPlayerAverages(league)[statKey].toFixed(1) + '</div>';
  }
  return html + '</div>';
}

function foCellHtml(label, value, meterPct, over) {
  return '<div class="fo-cell"><div class="k">' + label + '</div><div class="v">' + value + '</div>' +
    (meterPct === null ? '' :
      '<div class="meter"><div class="meter-fill' + (over ? ' is-over' : '') + '" style="width:' + Math.min(100, Math.round(meterPct)) + '%"></div></div>') +
    '</div>';
}

function heroStatHtml(label, value) {
  return '<div class="dash-hero-stat"><div class="v">' + value + '</div><div class="k">' + label + '</div></div>';
}

function formBugHtml(row) {
  return '<div class="form-bug ' + (row.won ? 'win' : 'loss') + '">' +
    '<div class="opp">' + (row.home ? 'vs ' : '@ ') + row.opp.id + '</div>' +
    '<div class="score">' + row.ownScore + '–' + row.oppScore + '</div>' +
    '<div class="res ' + (row.won ? 'w' : 'l') + '">' + (row.won ? 'W' : 'L') + '</div></div>';
}

// The conference race: top 5 seeds, or top 4 plus the user's row at its true
// rank when they sit lower — the page always shows where YOU are.
function raceRowsHtml(team, season) {
  const seeds = getPlayoffSeeds(team.conference, 15);
  const leader = seeds[0];
  const userIdx = seeds.findIndex(function (t) { return t.id === team.id; });
  let rows = seeds.slice(0, 5).map(function (t, i) { return { t: t, rank: i + 1 }; });
  if (userIdx >= 5) rows = rows.slice(0, 4).concat([{ t: team, rank: userIdx + 1 }]);
  return rows.map(function (r) {
    const gb = ((leader.record.wins - r.t.record.wins) + (r.t.record.losses - leader.record.losses)) / 2;
    const isUser = r.t.id === team.id;
    return '<tr class="' + (isUser ? 'row-user ' : '') + 'is-clickable" data-team-id="' + r.t.id + '"' +
      ' title="View ' + escapeHtml(r.t.name) + '\'s roster">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="col-name">' + teamLogoImgHtml(r.t.id, 18) + ' ' + escapeHtml(r.t.name) + '</td>' +
      '<td class="num">' + r.t.record.wins + '-' + r.t.record.losses + '</td>' +
      '<td class="num">' + (gb === 0 ? '—' : gb.toFixed(1)) + '</td>' +
      '<td class="num">' + teamStreak(r.t.id, season) + '</td></tr>';
  }).join('');
}

// The owner's standing demand, as one line directly under the hero.
//
// All of this already existed on the Records > My Career page and a playtester
// found it BY ACCIDENT, after a losing season, having managed a whole year
// without knowing a job was on the line. Stakes you have to go looking for are
// not stakes. This is deliberately a strip and not a second copy of the career
// panel: it has to sit in the corner of your eye on the screen you actually
// manage from, not be a page you visit.
function ownerStakesStripHtml(teamId) {
  if (GameState.gameMode === 'playerCareer') return '';
  const career = GameState.gmCareer;
  const mandate = GameState.ownerMandate;
  if (!career || !mandate) return '';

  const team = getTeamById(teamId);
  const patience = currentPatience(career, teamId);
  const label = patienceLabel(patience);
  const warn = patience < OWNER_PATIENCE;
  const note = patience === 0
    ? 'the next miss is the last'
    : patience + ' more miss' + (patience === 1 ? '' : 'es') + ' costs you the job';

  return '<div class="stakes-strip' + (warn ? ' is-warn' : '') + '">' +
    '<span class="stakes-label">The owner wants</span>' +
    '<span class="stakes-mandate">' + escapeHtml(mandate.label) + '</span>' +
    '<span class="stakes-sep">&middot;</span>' +
    '<span class="stakes-label">Job security</span>' +
    '<span class="stakes-job">' + escapeHtml(label) + '</span>' +
    '<span class="stakes-note">' + escapeHtml(note) + '</span>' +
    '<span class="stakes-happy">Owner ' + Math.round((team && team.ownerHappiness) || 0) + '</span>' +
    '</div>';
}

function renderDashboard(container, teamId) {
  const team = getTeamById(teamId);
  const roster = getTeamRoster(teamId);
  const season = GameState.season;
  const payroll = getTeamPayroll(teamId);
  const effectiveCap = getEffectiveSalaryCap(GameState.settings && GameState.settings.capLevel);
  const overCap = payroll > effectiveCap;
  const gp = team.record.wins + team.record.losses;

  const injuredPlayers = roster.filter(function (p) { return p.status.injury; })
    .sort(function (a, b) { return b.overall - a.overall; });
  const unhappyPlayers = roster.filter(function (p) { return moraleTier(p.status.morale) === 'unhappy'; })
    .sort(function (a, b) { return a.status.morale - b.status.morale; });
  const headlines = recentHeadlines(GameState.feed || [], 6);
  const last5 = lastPlayedGames(teamId, season, 5);
  const nextGames = upcomingGames(teamId, season, 3);

  // The spotlight mirrors the dock: whatever state disables Watch Next Game
  // down there disables Play up here, so the two never disagree about whether
  // there is a game to play (ui/simControls.js's noGameToWatch rule).
  const noGameToWatch = !!GameState.offseasonStage ||
    (!GameState.playoffBracket && season &&
      getNextGameDay(season, teamId, season.currentDay) === null);
  let spotTitle, spotSub;
  if (!season) {
    spotTitle = 'No season in progress'; spotSub = '';
  } else if (GameState.offseasonStage) {
    spotTitle = 'Offseason'; spotSub = 'see the dock below';
  } else if (GameState.playoffBracket) {
    spotTitle = 'Playoffs'; spotSub = 'next series game';
  } else if (nextGames.length > 0) {
    const nx = nextGames[0];
    spotTitle = (nx.home ? 'vs ' : '@ ') + escapeHtml(nx.opp.name);
    spotSub = 'Day ' + nx.day + ' · ' + nx.opp.record.wins + '-' + nx.opp.record.losses +
      ' · ' + seedLabel(nx.opp);
  } else {
    spotTitle = 'No games remaining'; spotSub = '';
  }

  const heroSub = season
    ? seedLabel(team) + ' · ' + divisionLabel(team)
    : team.conference + ' Conference · ' + team.division;

  const comingUpBug = nextGames.length === 0 ? '' :
    '<div class="form-bug"><div class="opp">then</div>' +
    '<div class="score" style="color:var(--text-dim)">' +
      nextGames.map(function (r) { return (r.home ? 'vs ' : '@ ') + r.opp.id; }).join(' · ') + '</div>' +
    '<div class="res" style="color:var(--text-mute)">Day ' +
      nextGames.map(function (r) { return r.day; }).join(' · ') + '</div></div>';

  // The agenda goes at the top of the screen you manage from, because that is
  // the whole point of it: the state was always full of situations nobody was
  // reading (see docs/ENGAGEMENT_OVERHAUL_AUDIT.md). Guarded on typeof because
  // gmAgenda.js is a plain script tag like everything else, and a dashboard
  // that throws when one file fails to load is worse than one without a panel.
  const agendaItems = (typeof buildAgenda === 'function') ? buildAgenda(GameState) : [];
  const agendaHtml = (typeof agendaPanelHtml === 'function') ? agendaPanelHtml(agendaItems) : '';

  container.innerHTML =
    '<div class="dash-hero">' +
      teamLogoImgHtml(team.id, 44) +
      '<div class="dash-hero-rec">' + team.record.wins + '-' + team.record.losses +
        '<small>' + escapeHtml(team.name) + ' · ' + heroSub + '</small></div>' +
      heroStatHtml('Streak', teamStreak(teamId, season)) +
      heroStatHtml('PPG', gp > 0 ? ((team.record.pointsFor || 0) / gp).toFixed(1) : '—') +
      heroStatHtml('Opp PPG', gp > 0 ? ((team.record.pointsAgainst || 0) / gp).toFixed(1) : '—') +
      '<div class="dash-next">' +
        '<div><div class="sub">Next up</div><div class="vs">' + spotTitle + '</div>' +
          '<div class="sub">' + spotSub + '</div></div>' +
        '<button id="dash-play"' + (noGameToWatch ? ' disabled' : '') + '>Play Next Game</button>' +
      '</div>' +
    '</div>' +

    ownerStakesStripHtml(teamId) +

    // After the hero and the owner strip, before the columns. It sat above the
    // hero first, and on a 900px screen five items pushed the record and Play
    // Next Game clean off the bottom — the desk is what matters, but it is not
    // what you came to click.
    agendaHtml +

    '<div class="dash-grid"><div class="dash-col">' +

      ((last5.length > 0 || comingUpBug) ?
        '<div class="form-strip">' + last5.map(formBugHtml).join('') + comingUpBug + '</div>' : '') +

      '<div class="panel"><div class="panel-header">' + team.conference + ' Race</div>' +
        '<table class="data-table"><thead><tr><th class="num">#</th><th>Team</th>' +
        '<th class="num">W-L</th><th class="num">GB</th><th class="num">Streak</th></tr></thead><tbody>' +
        (season ? raceRowsHtml(team, season) : '') + '</tbody></table></div>' +

      '<div class="panel"><div class="panel-header">Leaders</div><div class="panel-body lead-cols">' +
        leaderColHtml('Points', roster, 'ppg', 'PPG') +
        leaderColHtml('Rebounds', roster, 'rpg', 'RPG') +
        leaderColHtml('Assists', roster, 'apg', 'APG') +
      '</div></div>' +

    '</div><div class="dash-col">' +

      '<div class="panel"><div class="panel-header">Front Office</div><div class="panel-body fo-grid">' +
        foCellHtml('Payroll', '$' + Math.round(payroll / 1e6) + 'M <span class="cap-of">/ $' +
          Math.round(effectiveCap / 1e6) + 'M</span>', (payroll / effectiveCap) * 100, overCap) +
        foCellHtml('Chemistry', team.chemistry, team.chemistry, false) +
        foCellHtml('Fans', Math.round(team.fanHappiness), team.fanHappiness, false) +
        foCellHtml('Owner', team.ownerHappiness, team.ownerHappiness, false) +
      '</div></div>' +

      '<div class="panel"><div class="panel-header">Injuries &amp; Morale' +
        (injuredPlayers.length > 0 ? ' <span class="pill pill-loss">' + injuredPlayers.length + '</span>' : '') +
        '</div><div class="panel-body">' +
        ((injuredPlayers.length === 0 && unhappyPlayers.length === 0)
          ? '<div class="empty-state">All healthy, nobody unhappy.</div>'
          : '<table class="data-table"><tbody>' +
            injuredPlayers.map(function (p) {
              return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
                '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
                '<td><span class="pill pill-loss">' + injuryLabel(p.status.injury) + '</span></td></tr>';
            }).join('') +
            unhappyPlayers.map(function (p) {
              const reasons = moraleFactors(p, team);
              return '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
                '<td class="num">' + moraleStatusHtml(p) + '</td>' +
                '<td>' + (reasons.length > 0 ? reasons.join(', ') : '—') + '</td></tr>';
            }).join('') + '</tbody></table>') +
      '</div></div>' +

      '<div class="panel"><div class="panel-header">Your Career</div><div class="panel-body">' +
        careerHintHtml() +
      '</div></div>' +

      '<div class="panel"><div class="panel-header">Headlines</div><div class="panel-body">' +
        (headlines.length === 0
          ? '<div class="empty-state">No news yet.</div>'
          : '<ul class="headline-list">' + headlines.map(function (h) {
              // Same reason ui/liveFeed.js escapes this: feed text is built in
              // the sim layer and embeds user-supplied player and team names.
              return '<li><span class="pill pill-mute">Day ' + dayLabel(h.day) + '</span> ' + escapeHtml(h.text) + '</li>';
            }).join('') + '</ul>') +
      '</div></div>' +

    '</div></div>';

  if (typeof bindAgendaPanel === 'function') {
    bindAgendaPanel(container, function (view) { renderView(view); });
  }

  const playBtn = container.querySelector('#dash-play');
  if (playBtn && !playBtn.disabled && typeof handleWatchNextGame === 'function') {
    playBtn.addEventListener('click', handleWatchNextGame);
  }
  container.querySelectorAll('tr[data-team-id]').forEach(function (row) {
    row.addEventListener('click', function () {
      GameState.inspectTeamId = row.getAttribute('data-team-id');
      renderView('roster');
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDashboard: renderDashboard };
}
