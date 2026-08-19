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
      const oppLabel = '<span class="pill pill-mute">' + (isHome ? 'VS' : '@') + '</span> ' + teamLogoImgHtml(oppId, 18) + ' ' + escapeHtml(opp.name) +
        (g.isPlayoff ? ' <span class="pill pill-playoff">' + escapeHtml(g.round || 'Playoffs') + '</span>' : '');
      // A playoff game's day number is a bookkeeping value that keeps the list
      // in order (see collectFinishedPlayoffGames); showing it would read as a
      // 100-something "day" of a season that ended. The game number within the
      // series is what a reader actually wants there.
      const dayCell = g.isPlayoff
        ? (g.gameNumber ? 'G' + g.gameNumber : '—')
        : g.day;
      let resultLabel = '<span class="pill pill-mute">Scheduled</span>';
      if (g.played) {
        const teamScore = isHome ? g.homeScore : g.awayScore;
        const oppScore = isHome ? g.awayScore : g.homeScore;
        const won = teamScore > oppScore;
        resultLabel = '<span class="pill ' + (won ? 'pill-win' : 'pill-loss') + '">' + (won ? 'W' : 'L') + '</span> ' +
          teamScore + '-' + oppScore;
      }
      const isExpanded = String(g.id) === expandedGameId;
      const rowClasses = 'is-clickable schedule-row' + (g.played ? ' is-playable' : '') + (isExpanded ? ' is-expanded' : '');
      const title = g.played ? 'Click to view box score' : 'Not played yet';
      // Unplayed games get a Watch button so a specific future matchup can be
      // watched in the pixel view, not just the very next game. Everything up
      // to that day sims normally first (ui/simControls.js's watchGameOnDay).
      const actionCell = g.played
        ? (isExpanded ? '▾' : '▸')
        : (GameState.playoffBracket ? '' : '<button class="btn-ghost schedule-watch-btn" data-watch-day="' + g.day + '">Watch</button>');
      html += '<tr class="' + rowClasses + '" data-game-id="' + g.id + '" title="' + title + '"><td class="num">' + dayCell + '</td>' +
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
        // Compared as STRINGS. Number() was the old reading, and any id that
        // is not a plain number became NaN — which never equals the row it came
        // from, so the row simply refused to open with no error anywhere.
        const gameId = row.getAttribute('data-game-id');
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
// Field-goal percentage a player ALLOWED as the shot defender. The em-dash
// fallback is load-bearing: every box score saved before oppFga existed has no
// such field, and 0/0 would render NaN across a whole career of history.
function defensiveFgText(s) {
  return s.oppFga ? (100 * s.oppFgm / s.oppFga).toFixed(1) : '—';
}

// ONE header and ONE row, shared by the split view and the combined fallback
// below. They carried identical copies of this markup, which is how a column
// added to one and not the other ends up shifting every cell in the other by a
// place — the header says STL over a column of blocks and nothing throws.
const BOX_SCORE_COLUMNS = ['MIN', 'PTS', 'REB', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'DFG%'];

function boxScoreHeaderHtml() {
  return '<thead><tr><th>Player</th>' + BOX_SCORE_COLUMNS.map(function (c) {
    return '<th class="num">' + c + '</th>';
  }).join('') + '</tr></thead>';
}

// oreb/dreb are shown from the line, never derived from the other two: a box
// score saved before the split existed has neither, and `rebounds - dreb`
// would quietly print the whole total in the OREB column. An em dash says
// "this game does not know" and is the truth.
function boxScoreRowHtml(name, s) {
  const board = function (v) { return v === undefined || v === null ? '—' : v; };
  return '<tr><td class="col-name">' + escapeHtml(name) + '</td>' +
    '<td class="num">' + s.minutes + '</td>' +
    '<td class="num">' + s.points + '</td>' +
    '<td class="num">' + s.rebounds + '</td>' +
    '<td class="num">' + board(s.oreb) + '</td>' +
    '<td class="num">' + board(s.dreb) + '</td>' +
    '<td class="num">' + s.assists + '</td>' +
    '<td class="num">' + s.steals + '</td>' +
    '<td class="num">' + s.blocks + '</td>' +
    '<td class="num">' + defensiveFgText(s) + '</td></tr>';
}

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
    '<table class="data-table">' + boxScoreHeaderHtml() + '<tbody>';
  lines.forEach(function (e) {
    // Retired or commissioner-deleted players still have a stat line worth showing.
    html += boxScoreRowHtml(e.player ? e.player.name : 'Former player', e.stats);
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
      '<table class="data-table">' + boxScoreHeaderHtml() + '<tbody>';
    Object.keys(game.boxScore).forEach(function (playerId) {
      const p = getPlayerById(playerId);
      html += boxScoreRowHtml(p ? p.name : 'Former player', game.boxScore[playerId]);
    });
    return html + '</tbody></table>' + playByPlayHtml(game) + '</div>';
  }

  return '<div class="box-score-detail">' + boxScoreLineHeaderHtml(game) +
    '<div class="box-score-teams">' + awayTable.html + homeTable.html + '</div>' +
    takeoverSummaryHtml(game) + playByPlayHtml(game) + '</div>';
}

// What the takeovers in this game did, for a game you never watched. Reads
// game.takeovers, which league.js attaches to every finished game — the live
// view is not the only place a takeover is allowed to be visible, and for 29
// teams out of 30 it is the only place you would ever learn one happened.
//
// Returns nothing at all when the game had none, rather than an empty box: a
// "no takeovers" panel on most games is noise.
function takeoverSummaryHtml(game) {
  const rows = (game && game.takeovers) || [];
  if (!rows.length) return '';
  const items = rows.map(function (t) {
    const def = typeof ULTIMATE_BY_KEY !== 'undefined' ? ULTIMATE_BY_KEY[t.ultimateKey] : null;
    const label = def ? def.name : t.ultimateKey;
    // A takeover now usually spans two periods — it starts late in the third
    // and closes the fourth — so showing only where it ENDED loses the part
    // that reads like a story. Rows saved before takeovers recorded their start
    // have no startPeriod, so they fall back to the single period.
    const label1 = function (p) { return p > 4 ? 'OT' + (p - 4) : 'Q' + p; };
    const when = t.startPeriod && t.startPeriod !== t.period
      ? label1(t.startPeriod) + '–' + label1(t.period)
      : label1(t.period);
    return '<li><strong>' + escapeHtml(t.playerName) + '</strong> — ' +
      escapeHtml(label) + ' · ' + when + ' · ' +
      (t.points > 0 ? t.points + ' pts during it' : 'no points, but it changed the floor') +
      '</li>';
  }).join('');
  return '<div class="takeover-summary"><h4>Takeovers</h4><ul>' + items + '</ul></div>';
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
  module.exports = { renderSchedule: renderSchedule, takeoverSummaryHtml: takeoverSummaryHtml, renderBoxScoreDetail: renderBoxScoreDetail, boxScoreDetailHtml: boxScoreDetailHtml, playByPlayHtml: playByPlayHtml, checkBreakdownHtml: checkBreakdownHtml };
}
