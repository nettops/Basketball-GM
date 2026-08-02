function renderSchedule(container, teamId) {
  const games = GameState.season.games
    .filter(function (g) { return g.homeTeamId === teamId || g.awayTeamId === teamId; })
    .slice()
    .sort(function (a, b) { return a.day - b.day; });

  let html = '<div class="view-header"><h2>Schedule</h2><span class="view-sub">Click a game for its box score</span></div>';
  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Day</th><th>Opponent</th><th>Result</th></tr></thead><tbody>';
  games.forEach(function (g) {
    const isHome = g.homeTeamId === teamId;
    const oppId = isHome ? g.awayTeamId : g.homeTeamId;
    const opp = getTeamById(oppId);
    const oppLabel = '<span class="pill pill-mute">' + (isHome ? 'VS' : '@') + '</span> ' + teamLogoImgHtml(oppId, 18) + ' ' + opp.name;
    let resultLabel = '<span class="pill pill-mute">Scheduled</span>';
    if (g.played) {
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      const won = teamScore > oppScore;
      resultLabel = '<span class="pill ' + (won ? 'pill-win' : 'pill-loss') + '">' + (won ? 'W' : 'L') + '</span> ' +
        teamScore + '-' + oppScore;
    }
    html += '<tr class="is-clickable" data-game-id="' + g.id + '"><td class="num">' + g.day + '</td>' +
      '<td class="col-name">' + oppLabel + '</td><td>' + resultLabel + '</td></tr>';
  });
  html += '</tbody></table></div><div id="box-score-detail"></div>';
  container.innerHTML = html;

  container.querySelectorAll('tr[data-game-id]').forEach(function (row) {
    row.addEventListener('click', function () {
      const gameId = Number(row.getAttribute('data-game-id'));
      const game = games.find(function (g) { return g.id === gameId; });
      renderBoxScoreDetail(document.getElementById('box-score-detail'), game);
    });
  });
}

function renderBoxScoreDetail(container, game) {
  if (!game.played) {
    container.innerHTML = '<div class="empty-state">This game hasn\'t been played yet.</div>';
    return;
  }
  const home = getTeamById(game.homeTeamId);
  const away = getTeamById(game.awayTeamId);
  let html = '<div class="panel"><div class="panel-header">Box Score</div><div class="panel-body">' +
    '<div class="kpi-value">' + teamLogoImgHtml(away.id, 22) + ' ' + away.name + ' ' + game.awayScore +
    ' <span style="color:var(--text-mute)">@</span> ' +
    teamLogoImgHtml(home.id, 22) + ' ' + home.name + ' ' + game.homeScore + '</div></div>' +
    '<table class="data-table"><thead><tr><th>Player</th><th class="num">MIN</th><th class="num">PTS</th>' +
    '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th></tr></thead><tbody>';
  Object.keys(game.boxScore).forEach(function (playerId) {
    const p = getPlayerById(playerId);
    const s = game.boxScore[playerId];
    html += '<tr><td class="col-name">' + p.name + '</td><td class="num">' + s.minutes + '</td><td class="num">' + s.points +
      '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists + '</td><td class="num">' + s.steals +
      '</td><td class="num">' + s.blocks + '</td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSchedule: renderSchedule, renderBoxScoreDetail: renderBoxScoreDetail };
}
