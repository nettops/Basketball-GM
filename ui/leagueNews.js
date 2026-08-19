// Named distinctly from ui/dashboard.js's SCORE_LINE_PATTERN — every ui/*.js
// file shares one global scope (classic <script> tags, no modules), so a
// same-named top-level const in two files would be a SyntaxError.
const NEWS_SCORE_LINE_PATTERN = /^.+\s\d+,\s.+\s\d+$/;

function categorizeFeedEntry(text) {
  if (/injured:/.test(text)) return 'injury';
  if (/^Trade:/.test(text) || /Auto-traded with/.test(text)) return 'trade';
  if (/ signs with /.test(text)) return 'freeagency';
  if (NEWS_SCORE_LINE_PATTERN.test(text)) return 'game';
  return 'league';
}

const NEWS_CATEGORY_LABELS = {
  trade: 'Trades', freeagency: 'Free Agency', injury: 'Injuries',
  highlight: 'Highlights', morale: 'Morale', game: 'Game Results', league: 'League'
};
const NEWS_CATEGORY_PILL_CLASS = {
  trade: 'pill-gold', freeagency: 'pill-win', injury: 'pill-loss',
  highlight: 'pill-gold', morale: 'pill-mute', game: 'pill-mute', league: 'pill-mute'
};

function feedEntryInvolvesTeam(text, teamName) {
  return text.indexOf(teamName) !== -1;
}

// Scans this season's already-played games for standout individual
// performances — there's no dedicated feed event for this, so it's computed
// straight from box scores rather than relying on logged text. Absolute
// thresholds (35pts, a real triple-double) are tuned for the more variable
// possession engine; the flatter box-score engine rarely reaches them, so
// renderLeagueNews falls back to computeTopPerformances when this comes up empty.
function allPlayedLines(teamId) {
  if (!GameState.season) return [];
  const lines = [];
  GameState.season.games.filter(function (g) { return g.played && g.boxScore; }).forEach(function (g) {
    if (teamId && g.homeTeamId !== teamId && g.awayTeamId !== teamId) return;
    Object.keys(g.boxScore).forEach(function (playerId) {
      const player = getPlayerById(playerId);
      if (!player) return;
      if (teamId && player.teamId !== teamId) return; // only this team's own players, not the opponent's
      lines.push({ day: g.day, playerId: playerId, playerName: player.name, teamId: player.teamId, line: g.boxScore[playerId] });
    });
  });
  return lines;
}

function computeHighlights(teamId) {
  return allPlayedLines(teamId).filter(function (entry) {
    const line = entry.line;
    entry.isTripleDouble = [line.points, line.rebounds, line.assists, line.steals, line.blocks].filter(function (v) { return v >= 10; }).length >= 3;
    return line.points >= 35 || entry.isTripleDouble;
  }).sort(function (a, b) { return b.day - a.day; });
}

function computeTopPerformances(teamId, n) {
  return allPlayedLines(teamId)
    .sort(function (a, b) { return b.line.points - a.line.points; })
    .slice(0, n);
}

function highlightLabel(h) {
  if (h.isTripleDouble) return escapeHtml(h.playerName) + ' — triple-double (' + h.line.points + ' pts, ' + h.line.rebounds + ' reb, ' + h.line.assists + ' ast)';
  return escapeHtml(h.playerName) + ' drops ' + h.line.points + ' points';
}

// Morale has no historical event log (see morale.js), so this section is a
// live snapshot of currently-unhappy players leaguewide, same approach as
// the dashboard's Team Morale panel.
function computeMoraleNews(teamId) {
  const pool = teamId ? getTeamRoster(teamId) : PLAYERS_2026;
  return pool.filter(function (p) { return p.teamId && moraleTier(p.status.morale) === 'unhappy'; })
    .sort(function (a, b) { return a.status.morale - b.status.morale; })
    .slice(0, 25);
}

// Recaps for every game in the league, newest first. Unlike computeHighlights
// this does NOT read box scores — recaps are composed in league.js when the
// game is played, precisely so the twenty-nine teams whose box scores get
// pruned at save time still have something to say.
function computeRecaps(teamId, n) {
  if (!GameState.season) return [];
  return GameState.season.games.filter(function (g) {
    if (!g.played || !g.recap) return false;
    return !teamId || g.homeTeamId === teamId || g.awayTeamId === teamId;
  }).sort(function (a, b) { return (b.day || 0) - (a.day || 0); }).slice(0, n);
}

function renderLeagueNews(container, userTeamId) {
  let scopeTeamId = 'all';
  let viewMode = 'category';

  function draw() {
    const filterTeamId = scopeTeamId === 'all' ? null : (scopeTeamId === 'mine' ? userTeamId : scopeTeamId);
    const filterTeamName = filterTeamId ? getTeamById(filterTeamId).name : null;

    const feed = (GameState.feed || []).filter(function (entry) {
      if (categorizeFeedEntry(entry.text) === 'game') return false; // covered by Highlights/Schedule instead
      if (!filterTeamName) return true;
      return feedEntryInvolvesTeam(entry.text, filterTeamName);
    });

    // The box-score engine's flatter stat distribution rarely produces a real
    // 35-point game or triple-double — fall back to the best-available lines
    // this season so Highlights isn't just permanently empty under that engine.
    const highlights = computeHighlights(filterTeamId);
    const highlightsAreFallback = highlights.length === 0;
    const highlightsToShow = highlightsAreFallback ? computeTopPerformances(filterTeamId, 10) : highlights;
    const moraleNews = computeMoraleNews(filterTeamId);

    let html = '<div class="view-header"><h2>League News</h2><span class="view-sub">Trades, signings, injuries, and highlights</span></div>';

    html += '<div class="panel"><div class="panel-body toolbar">' +
      '<label>Show: <select id="news-scope">' +
        '<option value="all"' + (scopeTeamId === 'all' ? ' selected' : '') + '>All Teams</option>' +
        '<option value="mine"' + (scopeTeamId === 'mine' ? ' selected' : '') + '>My Team</option>' +
        TEAMS.map(function (t) { return '<option value="' + t.id + '"' + (scopeTeamId === t.id ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>'; }).join('') +
      '</select></label> ' +
      '<label>View: <select id="news-view">' +
        '<option value="category"' + (viewMode === 'category' ? ' selected' : '') + '>By Category</option>' +
        '<option value="chronological"' + (viewMode === 'chronological' ? ' selected' : '') + '>Chronological</option>' +
      '</select></label>' +
    '</div></div>';

    if (viewMode === 'chronological') {
      const combined = feed.map(function (entry) {
        return { day: entry.day, category: categorizeFeedEntry(entry.text), text: entry.text };
      }).concat(highlightsToShow.map(function (h) {
        return { day: h.day, category: 'highlight', text: highlightLabel(h) };
      })).concat(computeRecaps(filterTeamId, 25).map(function (g) {
        return { day: g.day, category: 'game', text: g.recap };
      })).sort(function (a, b) { return (b.day || 0) - (a.day || 0); });

      html += '<div class="panel"><div class="panel-body">' +
        (combined.length === 0 ? '<div class="empty-state">No news yet.</div>' :
          '<ul class="headline-list">' + combined.map(function (e) {
            return '<li><span class="pill pill-mute">Day ' + dayLabel(e.day) + '</span> ' +
              '<span class="pill ' + NEWS_CATEGORY_PILL_CLASS[e.category] + '">' + NEWS_CATEGORY_LABELS[e.category] + '</span> ' + escapeHtml(e.text) + '</li>';
          }).join('') + '</ul>') +
      '</div></div>';
    } else {
      html += '<div class="panel"><div class="panel-header">Highlights' +
        (highlightsAreFallback && highlightsToShow.length > 0 ? ' <span class="pill pill-mute">top performances</span>' : '') +
        '</div><div class="panel-body">' +
        (highlightsToShow.length === 0 ? '<div class="empty-state">No games played yet.</div>' :
          '<ul class="headline-list">' + highlightsToShow.slice(0, 20).map(function (h) {
            return '<li><span class="pill pill-mute">Day ' + dayLabel(h.day) + '</span> ' + highlightLabel(h) + '</li>';
          }).join('') + '</ul>') +
      '</div></div>';

      const recaps = computeRecaps(filterTeamId, 25);
      html += '<div class="panel"><div class="panel-header">Around the League</div><div class="panel-body">' +
        (recaps.length === 0 ? '<div class="empty-state">No games played yet.</div>' :
          '<ul class="headline-list">' + recaps.map(function (g) {
            return '<li><span class="pill pill-mute">Day ' + dayLabel(g.day) + '</span> ' + escapeHtml(g.recap) + '</li>';
          }).join('') + '</ul>') +
      '</div></div>';

      ['trade', 'freeagency', 'injury'].forEach(function (cat) {
        const items = feed.filter(function (entry) { return categorizeFeedEntry(entry.text) === cat; });
        html += '<div class="panel"><div class="panel-header">' + NEWS_CATEGORY_LABELS[cat] + '</div><div class="panel-body">' +
          (items.length === 0 ? '<div class="empty-state">Nothing yet.</div>' :
            '<ul class="headline-list">' + items.slice(-20).reverse().map(function (entry) {
              return '<li><span class="pill pill-mute">Day ' + entry.day + '</span> ' + escapeHtml(entry.text) + '</li>';
            }).join('') + '</ul>') +
        '</div></div>';
      });

      html += '<div class="panel"><div class="panel-header">Morale</div><div class="panel-body">' +
        (moraleNews.length === 0 ? '<div class="empty-state">No unhappy players right now.</div>' :
          '<ul class="headline-list">' + moraleNews.map(function (p) {
            const team = getTeamById(p.teamId);
            const reasons = moraleFactors(p, team);
            return '<li>' + escapeHtml(p.name) + ' (' + escapeHtml(team.name) + ') — ' + Math.round(p.status.morale) + '/100' +
              (reasons.length > 0 ? ': ' + reasons.join(', ') : '') + '</li>';
          }).join('') + '</ul>') +
      '</div></div>';

      const leagueItems = feed.filter(function (entry) { return categorizeFeedEntry(entry.text) === 'league'; });
      if (leagueItems.length > 0) {
        html += '<div class="panel"><div class="panel-header">League</div><div class="panel-body">' +
          '<ul class="headline-list">' + leagueItems.slice(-20).reverse().map(function (entry) {
            return '<li><span class="pill pill-mute">Day ' + entry.day + '</span> ' + escapeHtml(entry.text) + '</li>';
          }).join('') + '</ul>' +
        '</div></div>';
      }
    }

    container.innerHTML = html;

    document.getElementById('news-scope').addEventListener('change', function (e) {
      scopeTeamId = e.target.value;
      draw();
    });
    document.getElementById('news-view').addEventListener('change', function (e) {
      viewMode = e.target.value;
      draw();
    });
  }

  draw();
}

// 1,278 takeovers a season league-wide. A feed line for every one is wallpaper,
// so the bar is measured rather than picked. Counting a real season's
// LEAGUE_HISTORY.takeovers by the points added during each:
//
//   bar   lines a season   roughly
//    12        390         fifteen a week
//    15        229         nine a week
//    18        130         five a week
//    20         85         three a week      <- shipped
//    25         23         one a week
//    30          3         three a season
//
// 20 keeps the league-wide chatter to about three a week, which is a thing you
// notice rather than scroll past.
//
// Your own team is never filtered — those are the ones you actually want, and
// there are only about 58 of them a season, roughly two a week.
const TAKEOVER_NEWS_POINTS = 20;

function takeoverIsNewsworthy(row, userTeamId) {
  if (!row) return false;
  if (row.teamId === userTeamId) return true;
  return (row.points || 0) >= TAKEOVER_NEWS_POINTS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderLeagueNews: renderLeagueNews, categorizeFeedEntry: categorizeFeedEntry,
    computeHighlights: computeHighlights, computeTopPerformances: computeTopPerformances,
    computeRecaps: computeRecaps,
    TAKEOVER_NEWS_POINTS: TAKEOVER_NEWS_POINTS, takeoverIsNewsworthy: takeoverIsNewsworthy
  };
}
