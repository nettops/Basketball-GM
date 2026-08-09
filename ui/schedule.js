function renderSchedule(container, teamId) {
  const games = GameState.season.games
    .filter(function (g) { return g.homeTeamId === teamId || g.awayTeamId === teamId; })
    .slice()
    .sort(function (a, b) { return a.day - b.day; });

  let expandedGameId = null;

  function draw() {
    let html = '<div class="view-header"><h2>Schedule</h2><span class="view-sub">Click a played game to expand its box score</span></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Day</th><th>Opponent</th><th>Result</th><th class="num"></th></tr></thead><tbody>';
    games.forEach(function (g) {
      const isHome = g.homeTeamId === teamId;
      const oppId = isHome ? g.awayTeamId : g.homeTeamId;
      const opp = getTeamById(oppId);
      const oppLabel = '<span class="pill pill-mute">' + (isHome ? 'VS' : '@') + '</span> ' + teamLogoImgHtml(oppId, 18) + ' ' + escapeHtml(opp.name);
      let resultLabel = '<span class="pill pill-mute">Scheduled</span>';
      if (g.played) {
        const teamScore = isHome ? g.homeScore : g.awayScore;
        const oppScore = isHome ? g.awayScore : g.homeScore;
        const won = teamScore > oppScore;
        resultLabel = '<span class="pill ' + (won ? 'pill-win' : 'pill-loss') + '">' + (won ? 'W' : 'L') + '</span> ' +
          teamScore + '-' + oppScore;
      }
      const isExpanded = g.id === expandedGameId;
      const rowClasses = 'is-clickable schedule-row' + (g.played ? ' is-playable' : '') + (isExpanded ? ' is-expanded' : '');
      const title = g.played ? 'Click to view box score' : 'Not played yet';
      // Unplayed games get a Watch button so a specific future matchup can be
      // watched in the pixel view, not just the very next game. Everything up
      // to that day sims normally first (ui/simControls.js's watchGameOnDay).
      const actionCell = g.played
        ? (isExpanded ? '▾' : '▸')
        : (GameState.playoffBracket ? '' : '<button class="btn-ghost schedule-watch-btn" data-watch-day="' + g.day + '">Watch</button>');
      html += '<tr class="' + rowClasses + '" data-game-id="' + g.id + '" title="' + title + '"><td class="num">' + g.day + '</td>' +
        '<td class="col-name">' + oppLabel + '</td><td>' + resultLabel + '</td>' +
        '<td class="num schedule-chevron">' + actionCell + '</td></tr>';

      // The box score goes IMMEDIATELY BELOW the row that was clicked, as a
      // full-width detail row. It used to render into a single <div> after the
      // whole table: with a full 82-game schedule that put it ~3,200px below
      // the click, so clicking a game near the top highlighted the row and
      // flipped its chevron while the actual box score appeared far off-screen
      // — indistinguishable from "nothing happened". The chevron and the
      // is-expanded row highlight both promise inline expansion; this delivers it.
      if (isExpanded) {
        let detailHtml;
        try {
          detailHtml = boxScoreDetailHtml(g);
        } catch (e) {
          console.error('boxScoreDetailHtml failed', e);
          detailHtml = '<div class="empty-state">This box score could not be displayed.</div>';
        }
        html += '<tr class="schedule-detail-row"><td colspan="4">' + detailHtml + '</td></tr>';
      }
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Bound before the row handler so the Watch click doesn't also toggle the
    // row's box-score expansion.
    container.querySelectorAll('.schedule-watch-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        watchGameOnDay(Number(btn.getAttribute('data-watch-day')));
      });
    });

    container.querySelectorAll('tr[data-game-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        const gameId = Number(row.getAttribute('data-game-id'));
        expandedGameId = expandedGameId === gameId ? null : gameId;
        draw();
        if (expandedGameId !== null) scrollDetailIntoView();
      });
    });
  }

  // Clicking a row sitting near the bottom of the viewport opens the box score
  // below the fold, which reads as "nothing happened" for the same reason the
  // old bottom-of-page panel did. Only scrolls when the panel actually runs off
  // the bottom, so a click near the top of the list doesn't jump the page.
  function scrollDetailIntoView() {
    const detail = container.querySelector('tr.schedule-detail-row');
    if (!detail) return;
    const rect = detail.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  draw();
}

function boxScoreLineHeaderHtml(game) {
  const home = getTeamById(game.homeTeamId);
  const away = getTeamById(game.awayTeamId);
  return '<div class="box-score-line">' +
    teamLogoImgHtml(game.awayTeamId, 22) + ' <strong>' + escapeHtml(away ? away.name : game.awayTeamId) + '</strong> ' + game.awayScore +
    ' <span style="color:var(--text-mute)">@</span> ' +
    teamLogoImgHtml(game.homeTeamId, 22) + ' <strong>' + escapeHtml(home ? home.name : game.homeTeamId) + '</strong> ' + game.homeScore +
    '</div>';
}

// One table per team, best performance first. The previous version dumped both
// rosters into a single unlabelled table in whatever order the boxScore object
// happened to enumerate, so you couldn't tell which team a player was on.
function boxScoreTeamTableHtml(game, teamId) {
  const team = getTeamById(teamId);
  const lines = Object.keys(game.boxScore)
    .map(function (playerId) {
      const p = getPlayerById(playerId);
      return { playerId: playerId, player: p, stats: game.boxScore[playerId] };
    })
    // Prefer the teamId stamped on the line at sim time; fall back to the
    // player's current team only for box scores saved before engines recorded
    // it. Filtering on the current teamId alone dropped every player traded
    // since the game was played.
    .filter(function (e) {
      if (e.stats.teamId !== undefined) return e.stats.teamId === teamId;
      return e.player && e.player.teamId === teamId;
    })
    .sort(function (a, b) { return b.stats.points - a.stats.points || b.stats.minutes - a.stats.minutes; });

  if (lines.length === 0) return { count: 0, html: '' };

  let html = '<div class="box-score-team"><div class="box-score-team-name">' +
    teamLogoImgHtml(teamId, 18) + ' ' + escapeHtml(team ? team.name : teamId) + '</div>' +
    '<table class="data-table"><thead><tr><th>Player</th><th class="num">MIN</th><th class="num">PTS</th>' +
    '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th></tr></thead><tbody>';
  lines.forEach(function (e) {
    const s = e.stats;
    // Retired or commissioner-deleted players still have a stat line worth showing.
    html += '<tr><td class="col-name">' + escapeHtml(e.player ? e.player.name : 'Former player') + '</td><td class="num">' + s.minutes + '</td><td class="num">' + s.points +
      '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists + '</td><td class="num">' + s.steals +
      '</td><td class="num">' + s.blocks + '</td></tr>';
  });
  return { count: lines.length, html: html + '</tbody></table></div>' };
}

// Returns markup rather than writing to a container so renderSchedule can drop
// it into a detail row inside the table, right under the game that was clicked.
function boxScoreDetailHtml(game) {
  if (!game || !game.played) {
    return '<div class="empty-state">This game hasn\'t been played yet.</div>';
  }
  // Older saves (and any game not involving the user's team) carry no box
  // score — save.js only persists the user's own games. Object.keys(null)
  // threw here before this guard existed.
  if (!game.boxScore || Object.keys(game.boxScore).length === 0) {
    return '<div class="box-score-detail">' + boxScoreLineHeaderHtml(game) +
      '<p class="kpi-sub">Player-by-player stats for this game weren\'t stored in the save file — only the final score was. ' +
      'Games you play from here on will keep their full box score.</p></div>';
  }

  const awayTable = boxScoreTeamTableHtml(game, game.awayTeamId);
  const homeTable = boxScoreTeamTableHtml(game, game.homeTeamId);
  // Exact accounting: every line in the box score must land on one of the two
  // tables. Anything short means the split couldn't attribute someone (an old
  // save with no per-line teamId, plus a trade since the game), so fall back to
  // one combined table rather than silently dropping stat lines.
  const totalLines = Object.keys(game.boxScore).length;
  if (awayTable.count + homeTable.count !== totalLines || awayTable.count === 0 || homeTable.count === 0) {
    let html = '<div class="box-score-detail">' + boxScoreLineHeaderHtml(game) +
      '<table class="data-table"><thead><tr><th>Player</th><th class="num">MIN</th><th class="num">PTS</th>' +
      '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th></tr></thead><tbody>';
    Object.keys(game.boxScore).forEach(function (playerId) {
      const p = getPlayerById(playerId);
      const s = game.boxScore[playerId];
      html += '<tr><td class="col-name">' + escapeHtml(p ? p.name : 'Former player') + '</td><td class="num">' + s.minutes +
        '</td><td class="num">' + s.points + '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists +
        '</td><td class="num">' + s.steals + '</td><td class="num">' + s.blocks + '</td></tr>';
    });
    return html + '</tbody></table>' + playByPlayHtml(game) + '</div>';
  }

  return '<div class="box-score-detail">' + boxScoreLineHeaderHtml(game) +
    '<div class="box-score-teams">' + awayTable.html + homeTable.html + '</div>' + playByPlayHtml(game) + '</div>';
}

// Only present for games simmed under the possession engine (see
// simEnginePossession.js's module comment) and only for the user's own games
// (save.js prunes everyone else's, same as boxScore) — collapsed by default
// behind <details> since a full game runs ~90+ lines.
// Renders one skillCheck as a breakdown: both rated sides, each modifier named
// individually, and the roll against the number it had to beat. Modifiers are
// itemised rather than summed because "badges +1.0%" is the thing worth seeing —
// a single combined figure would be exactly the opaque float this replaced.
//
// Sub-0.05pp modifiers are dropped. A synergy term of +0.0001 is noise, and
// printing "+0.0%" next to a label reads as a bug rather than as a small number.
function checkBreakdownHtml(check) {
  const parts = [];
  if (check.attack) {
    parts.push('<span class="pbp-check-side">' + escapeHtml(check.attack.label) + ' ' + Math.round(check.attack.value) + '</span>');
  }
  if (check.defend) {
    parts.push('<span class="pbp-check-side">vs ' + escapeHtml(check.defend.label) + ' ' + Math.round(check.defend.value) + '</span>');
  }
  (check.modifiers || []).forEach(function (m) {
    if (Math.abs(m.value) < 0.0005) return;
    const sign = m.value >= 0 ? '+' : '−';
    parts.push('<span class="pbp-check-mod">' + escapeHtml(m.label) + ' ' + sign + (Math.abs(m.value) * 100).toFixed(1) + '%</span>');
  });
  parts.push('<span class="pbp-check-roll">' + (check.probability * 100).toFixed(1) + '% needed, rolled ' +
    (check.roll * 100).toFixed(1) + '%</span>');
  return '<div class="pbp-check">' + parts.join('') + '</div>';
}

function playByPlayHtml(game) {
  if (!game.playByPlay || game.playByPlay.length === 0) return '';
  // An entry is a bare string (period headers, plays with no contest behind
  // them like rebounds, and EVERY save written before skill checks existed) or
  // { text, check }. Both shapes are permanent — this is not a migration — so
  // the normalisation below stays.
  const lines = game.playByPlay.map(function (entry) {
    const text = typeof entry === 'string' ? entry : entry.text;
    const check = typeof entry === 'string' ? null : entry.check;
    if (text.indexOf('--- Q') === 0) return '<div class="pbp-quarter">' + escapeHtml(text.replace(/---/g, '').trim()) + '</div>';
    if (!check) return '<div class="pbp-line">' + escapeHtml(text) + '</div>';
    return '<details class="pbp-line pbp-line-expandable"><summary>' + escapeHtml(text) + '</summary>' +
      checkBreakdownHtml(check) + '</details>';
  }).join('');
  return '<details class="box-score-pbp"><summary>Play-by-Play</summary><div class="pbp-log">' + lines + '</div></details>';
}

// Kept for any caller that still wants this written straight into a container.
function renderBoxScoreDetail(container, game) {
  container.innerHTML = boxScoreDetailHtml(game);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSchedule: renderSchedule, renderBoxScoreDetail: renderBoxScoreDetail, boxScoreDetailHtml: boxScoreDetailHtml, playByPlayHtml: playByPlayHtml, checkBreakdownHtml: checkBreakdownHtml };
}
