function renderDashboard(container, teamId) {
  const team = getTeamById(teamId);
  const roster = getTeamRoster(teamId);
  const payroll = getTeamPayroll(teamId);
  const capSpace = CAP_CONSTANTS.SALARY_CAP - payroll;

  const nextDay = GameState.season ? getNextGameDay(GameState.season, teamId, GameState.season.currentDay) : null;
  let nextGameLabel = 'No season in progress.';
  if (nextDay !== null) {
    const nextGame = GameState.season.games.find(function (g) { return g.day === nextDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); });
    const isHome = nextGame.homeTeamId === teamId;
    const opp = getTeamById(isHome ? nextGame.awayTeamId : nextGame.homeTeamId);
    nextGameLabel = 'Next game: ' + (isHome ? 'vs ' : '@ ') + opp.name + ' (day ' + nextDay + ')';
  } else if (GameState.season) {
    nextGameLabel = 'No games remaining.';
  }

  const capPct = Math.min(100, Math.round((payroll / CAP_CONSTANTS.SALARY_CAP) * 100));
  const capClass = capSpace >= 0 ? 'is-good' : 'is-warn';
  const capText = capSpace >= 0
    ? '$' + capSpace.toLocaleString() + ' space'
    : '$' + Math.abs(capSpace).toLocaleString() + ' over';

  container.innerHTML =
    '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 28) + ' ' + team.name + '</h2>' +
      '<span class="view-sub">' + team.conference + ' Conference · ' + team.division + '</span></div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div>' +
        '<div class="kpi-value">' + team.record.wins + '-' + team.record.losses + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Roster</div>' +
        '<div class="kpi-value">' + roster.length + '</div><div class="kpi-sub">players under contract</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Chemistry</div>' +
        '<div class="kpi-value">' + team.chemistry + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.chemistry + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Fan Happiness</div>' +
        '<div class="kpi-value">' + team.fanHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.fanHappiness + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Owner Happiness</div>' +
        '<div class="kpi-value">' + team.ownerHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.ownerHappiness + '%"></div></div></div>' +
    '</div>' +

    '<div class="panel"><div class="panel-header">Salary Cap</div><div class="panel-body">' +
      '<div class="kpi-label">Payroll</div>' +
      '<div class="kpi-value ' + capClass + '">$' + payroll.toLocaleString() + '</div>' +
      '<div class="meter" style="margin:8px 0 6px;"><div class="meter-fill ' + (capSpace < 0 ? 'is-over' : '') + '" style="width:' + capPct + '%"></div></div>' +
      '<div class="kpi-sub">Cap $' + CAP_CONSTANTS.SALARY_CAP.toLocaleString() + ' · ' + capText + '</div>' +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Next Up</div><div class="panel-body">' +
      '<div class="kpi-value" style="font-size:1.05rem;">' + nextGameLabel + '</div>' +
    '</div></div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDashboard: renderDashboard };
}
