function renderSchedule(container, teamId) {
  const games = GameState.season.games
    .filter(function (g) { return g.homeTeamId === teamId || g.awayTeamId === teamId; })
    .slice()
    .sort(function (a, b) { return a.day - b.day; });

  let html = '<table><thead><tr><th>Day</th><th>Opponent</th><th>Result</th></tr></thead><tbody>';
  games.forEach(function (g) {
    const isHome = g.homeTeamId === teamId;
    const oppId = isHome ? g.awayTeamId : g.homeTeamId;
    const opp = getTeamById(oppId);
    const oppLabel = (isHome ? 'vs ' : '@ ') + opp.name;
    let resultLabel = 'Not yet played';
    if (g.played) {
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      resultLabel = (teamScore > oppScore ? 'W ' : 'L ') + teamScore + '-' + oppScore;
    }
    html += '<tr data-game-id="' + g.id + '"><td>' + g.day + '</td><td>' + oppLabel + '</td><td>' + resultLabel + '</td></tr>';
  });
  html += '</tbody></table><div id="box-score-detail"></div>';
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
    container.innerHTML = '<p>This game hasn\'t been played yet.</p>';
    return;
  }
  let html = '<h3>' + getTeamById(game.homeTeamId).name + ' ' + game.homeScore + ' - ' + game.awayScore + ' ' + getTeamById(game.awayTeamId).name + '</h3>';
  html += '<table><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th></tr></thead><tbody>';
  Object.keys(game.boxScore).forEach(function (playerId) {
    const p = getPlayerById(playerId);
    const s = game.boxScore[playerId];
    html += '<tr><td>' + p.name + '</td><td>' + s.minutes + '</td><td>' + s.points + '</td><td>' + s.rebounds + '</td><td>' + s.assists + '</td><td>' + s.steals + '</td><td>' + s.blocks + '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSchedule: renderSchedule, renderBoxScoreDetail: renderBoxScoreDetail };
}
