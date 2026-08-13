// Games needed before the roster becomes meaningful — mirrors
// allStarWeekend.js's own MIN_GAMES_FOR_ALL_STAR bar for an individual
// player, but checked against the league's furthest-along team so the
// action doesn't appear before anyone actually qualifies.
const ALL_STAR_MIN_LEAGUE_GAMES = MIN_GAMES_FOR_ALL_STAR;

function leagueMaxGamesPlayed() {
  return TEAMS.reduce(function (max, t) { return Math.max(max, t.record.wins + t.record.losses); }, 0);
}

function playerRowHtml(player, extra) {
  return '<li>' + teamLogoImgHtml(player.teamId, 16) + ' ' + escapeHtml(player.name) +
    (extra ? ' <span class="kpi-sub">' + extra + '</span>' : '') + '</li>';
}

function rosterPanelHtml(title, selection) {
  return '<div class="playoff-conf-column"><div class="playoff-conf-label">' + title + '</div>' +
    '<div class="kpi-sub">Starters</div><ul class="stack-list">' +
    selection.starters.map(function (p) { return playerRowHtml(p, allStarValue(p).toFixed(1)); }).join('') +
    '</ul><div class="kpi-sub">Reserves</div><ul class="stack-list">' +
    selection.reserves.map(function (p) { return playerRowHtml(p, allStarValue(p).toFixed(1)); }).join('') +
    '</ul></div>';
}

function gameResultHtml(result) {
  if (!result) return '<div class="empty-state">Not yet played.</div>';
  const mvp = getPlayerById(result.mvpPlayerId);
  return '<div class="kpi-value">West ' + result.westScore + ' — East ' + result.eastScore + '</div>' +
    (mvp ? '<div class="kpi-sub">Game MVP: ' + escapeHtml(mvp.name) + '</div>' : '');
}

function contestResultHtml(result, scoreLabel) {
  if (!result) return '<div class="empty-state">Not yet held.</div>';
  return '<table class="data-table"><thead><tr><th>Player</th><th class="num">' + scoreLabel + '</th></tr></thead><tbody>' +
    result.results.map(function (r, i) {
      const score = r.bestRound !== undefined ? r.bestRound : r.bestDunk;
      return '<tr' + (i === 0 ? ' class="row-highlight"' : '') + '><td class="col-name">' + escapeHtml(r.playerName) + '</td><td class="num">' + score + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderAllStarWeekend(container) {
  function draw() {
    if (leagueMaxGamesPlayed() < ALL_STAR_MIN_LEAGUE_GAMES) {
      container.innerHTML = '<div class="view-header"><h2>All-Star Weekend</h2></div>' +
        '<div class="empty-state">Not enough of the season has been played yet — check back after teams have a few weeks of games in.</div>';
      return;
    }

    if (!GameState.allStarWeekend) GameState.allStarWeekend = {};
    const state = GameState.allStarWeekend;
    if (!state.east) state.east = selectAllStars('Eastern');
    if (!state.west) state.west = selectAllStars('Western');

    let html = '<div class="view-header"><h2>All-Star Weekend</h2><span class="view-sub">Rosters lock in once viewed for the season</span></div>';

    html += '<div class="panel"><div class="panel-header">Rosters</div><div class="panel-body"><div class="playoff-bracket-grid">' +
      rosterPanelHtml('Eastern Conference', state.east) + rosterPanelHtml('Western Conference', state.west) +
      '</div></div></div>';

    html += '<div class="panel"><div class="panel-header">All-Star Game</div><div class="panel-body">' +
      gameResultHtml(state.gameResult) +
      '<div class="toolbar" style="margin-top:10px;"><button id="asw-play-game-btn" class="btn-primary">' + (state.gameResult ? 'Replay Game' : 'Play Game') + '</button></div>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-header">Three-Point Contest</div><div class="panel-body">' +
      contestResultHtml(state.threePointResult, 'Best Round') +
      '<div class="toolbar" style="margin-top:10px;"><button id="asw-three-btn" class="btn-ghost">' + (state.threePointResult ? 'Re-run Contest' : 'Run Contest') + '</button></div>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-header">Dunk Contest</div><div class="panel-body">' +
      contestResultHtml(state.dunkResult, 'Best Dunk') +
      '<div class="toolbar" style="margin-top:10px;"><button id="asw-dunk-btn" class="btn-ghost">' + (state.dunkResult ? 'Re-run Contest' : 'Run Contest') + '</button></div>' +
      '</div></div>';

    container.innerHTML = html;

    document.getElementById('asw-play-game-btn').addEventListener('click', function () {
      const eastRoster = state.east.starters.concat(state.east.reserves);
      const westRoster = state.west.starters.concat(state.west.reserves);
      state.gameResult = simulateAllStarGame(eastRoster, westRoster, GameState.rng);
      draw();
    });

    document.getElementById('asw-three-btn').addEventListener('click', function () {
      const pool = state.east.starters.concat(state.east.reserves, state.west.starters, state.west.reserves)
        .slice().sort(function (a, b) { return b.attributes.threePoint - a.attributes.threePoint; }).slice(0, 8);
      state.threePointResult = simulateThreePointContest(pool, GameState.rng);
      draw();
    });

    document.getElementById('asw-dunk-btn').addEventListener('click', function () {
      const pool = state.east.starters.concat(state.east.reserves, state.west.starters, state.west.reserves)
        .slice().sort(function (a, b) { return (b.attributes.vertical + b.attributes.acceleration) - (a.attributes.vertical + a.attributes.acceleration); }).slice(0, 6);
      state.dunkResult = simulateDunkContest(pool, GameState.rng);
      draw();
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAllStarWeekend: renderAllStarWeekend };
}
