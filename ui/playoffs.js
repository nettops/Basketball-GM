// Seed labels for bracket.first, in array-index order — fixed because
// generateBracket() builds bracket.first from ROUND1_SEED_PAIRS
// ([[0,7],[3,4],[2,5],[1,6]]) in that exact order, once per conference.
const PLAYOFFS_ROUND1_SEED_LABELS = [[1, 8], [4, 5], [3, 6], [2, 7]];

function buildSeedLookup(bracket) {
  const lookup = {};
  bracket.first.forEach(function (series, i) {
    const labels = PLAYOFFS_ROUND1_SEED_LABELS[i % 4];
    lookup[series.higherSeed] = labels[0];
    lookup[series.lowerSeed] = labels[1];
  });
  return lookup;
}

function playoffSeriesRowHtml(series, seedLookup, userTeamId) {
  if (!series) return '<div class="playoff-series playoff-series-tbd">TBD</div>';
  const higher = getTeamById(series.higherSeed);
  const lower = getTeamById(series.lowerSeed);
  const higherSeed = seedLookup[series.higherSeed];
  const lowerSeed = seedLookup[series.lowerSeed];

  function sideHtml(team, seed, teamId, wins, isWinner) {
    const isUser = teamId === userTeamId;
    let cls = 'playoff-side';
    if (isWinner) cls += ' is-winner';
    if (isUser) cls += ' is-user-team';
    return '<div class="' + cls + '">' +
      '<span class="pill pill-mute">' + (seed !== undefined ? seed : '?') + '</span> ' +
      teamLogoImgHtml(teamId, 18) + ' ' + escapeHtml(team.name) +
      '<span class="num playoff-wins">' + wins + '</span></div>';
  }

  const higherWon = series.winner === series.higherSeed;
  const lowerWon = series.winner === series.lowerSeed;
  return '<div class="playoff-series' + (series.complete ? ' is-complete' : '') + '">' +
    sideHtml(higher, higherSeed, series.higherSeed, series.winsHigher, higherWon) +
    sideHtml(lower, lowerSeed, series.lowerSeed, series.winsLower, lowerWon) +
    '</div>';
}

function playoffRoundColumnHtml(title, series, expectedCount, seedLookup, userTeamId) {
  const padded = series.slice();
  while (padded.length < expectedCount) padded.push(null);
  return '<div class="playoff-round">' +
    '<div class="playoff-round-title">' + title + '</div>' +
    padded.map(function (s) { return playoffSeriesRowHtml(s, seedLookup, userTeamId); }).join('') +
    '</div>';
}

function playInResultsHtml(bracket) {
  if (!bracket.playIn) return '';
  let html = '<div class="panel"><div class="panel-header">Play-In Tournament</div><div class="panel-body">';
  CONFERENCES.forEach(function (conf) {
    const result = bracket.playIn[conf];
    if (!result) return;
    html += '<div class="playoff-conf-label">' + conf + ' Conference</div><ul class="stack-list">';
    result.games.forEach(function (g, i) {
      const home = getTeamById(g.homeTeamId);
      const away = getTeamById(g.awayTeamId);
      const label = i === 0 ? '7-8 Game' : (i === 1 ? '9-10 Game' : 'Final Spot');
      html += '<li><span class="feed-day" style="min-width:110px;display:inline-block;">' + label + '</span>' +
        escapeHtml(away.name) + ' ' + g.awayScore + ' @ ' + escapeHtml(home.name) + ' ' + g.homeScore + '</li>';
    });
    html += '</ul>';
  });
  html += '</div></div>';
  return html;
}

function renderBracketView(container, bracket, userTeamId) {
  const seedLookup = buildSeedLookup(bracket);
  const championId = bracket.finals.length > 0 && bracket.finals[0].complete ? bracket.finals[0].winner : null;

  let html = '<div class="view-header"><h2>Playoffs</h2><span class="view-sub">' +
    (bracket.playIn ? 'Play-in tournament + standard 2-2-1-1-1 best-of-7' : 'Standard 2-2-1-1-1 best-of-7, 8 seeds per conference') + '</span></div>';

  html += playInResultsHtml(bracket);

  if (championId) {
    const champ = getTeamById(championId);
    html += '<div class="panel"><div class="panel-body"><div class="kpi-value">' +
      '🏆 ' + teamLogoImgHtml(champ.id, 26) + ' ' + escapeHtml(champ.name) + ' are NBA Champions' +
      '</div></div></div>';
  }

  html += '<div class="panel"><div class="panel-body"><div class="playoff-bracket-grid">';
  html += '<div class="playoff-conf-column">';
  html += '<div class="playoff-conf-label">Eastern Conference</div>';
  html += playoffRoundColumnHtml('First Round', bracket.first.slice(0, 4), 4, seedLookup, userTeamId);
  html += playoffRoundColumnHtml('Conf. Semifinals', bracket.semis.slice(0, 2), 2, seedLookup, userTeamId);
  html += playoffRoundColumnHtml('Conf. Finals', bracket.confFinals.slice(0, 1), 1, seedLookup, userTeamId);
  html += '</div>';

  html += '<div class="playoff-conf-column playoff-finals-column">';
  html += playoffRoundColumnHtml('NBA Finals', bracket.finals, 1, seedLookup, userTeamId);
  html += '</div>';

  html += '<div class="playoff-conf-column">';
  html += '<div class="playoff-conf-label">Western Conference</div>';
  html += playoffRoundColumnHtml('First Round', bracket.first.slice(4, 8), 4, seedLookup, userTeamId);
  html += playoffRoundColumnHtml('Conf. Semifinals', bracket.semis.slice(2, 4), 2, seedLookup, userTeamId);
  html += playoffRoundColumnHtml('Conf. Finals', bracket.confFinals.slice(1, 2), 1, seedLookup, userTeamId);
  html += '</div>';
  html += '</div></div></div>';

  container.innerHTML = html;
}

function renderProjectedPicture(container, userTeamId) {
  let html = '<div class="view-header"><h2>Playoffs</h2><span class="view-sub">Projected seeding — locks in once the regular season ends</span></div>';
  html += '<div class="panel"><div class="panel-body"><div class="playoff-bracket-grid">';

  CONFERENCES.forEach(function (conf) {
    const seeds = getPlayoffSeeds(conf);
    html += '<div class="playoff-conf-column"><div class="playoff-conf-label">' + conf + ' Conference</div>';
    html += '<table class="data-table"><thead><tr><th class="num">Seed</th><th>Team</th><th class="num">W</th><th class="num">L</th></tr></thead><tbody>';
    seeds.forEach(function (team, i) {
      const isUser = team.id === userTeamId;
      html += '<tr' + (isUser ? ' class="row-user"' : '') + '><td class="num">' + (i + 1) + '</td>' +
        '<td class="col-name">' + teamLogoImgHtml(team.id, 18) + ' ' + escapeHtml(team.name) + '</td>' +
        '<td class="num">' + team.record.wins + '</td><td class="num">' + team.record.losses + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });

  html += '</div></div></div>';
  container.innerHTML = html;
}

function renderPlayoffs(container, teamId) {
  if (GameState.playoffBracket) {
    renderBracketView(container, GameState.playoffBracket, teamId);
  } else if (GameState.season) {
    renderProjectedPicture(container, teamId);
  } else {
    container.innerHTML = '<div class="view-header"><h2>Playoffs</h2></div><div class="empty-state">No season in progress.</div>';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPlayoffs: renderPlayoffs, buildSeedLookup: buildSeedLookup };
}
