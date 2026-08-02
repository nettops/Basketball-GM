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

  container.innerHTML =
    '<h1 style="color:' + team.colors.primary + ';">' + teamLogoImgHtml(team.id, 40) + ' ' + team.name + '</h1>' +
    '<p>Record: ' + team.record.wins + '-' + team.record.losses + '</p>' +
    '<p>Roster size: ' + roster.length + ' players</p>' +
    '<p>Payroll: $' + payroll.toLocaleString() + ' / Cap: $' + CAP_CONSTANTS.SALARY_CAP.toLocaleString() +
      ' (' + (capSpace >= 0 ? '$' + capSpace.toLocaleString() + ' space' : '$' + Math.abs(capSpace).toLocaleString() + ' over') + ')</p>' +
    '<p>Team Chemistry: ' + team.chemistry + '/100</p>' +
    '<p>Fan Happiness: ' + team.fanHappiness + '/100 &nbsp; Owner Happiness: ' + team.ownerHappiness + '/100</p>' +
    '<p>' + nextGameLabel + '</p>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDashboard: renderDashboard };
}
