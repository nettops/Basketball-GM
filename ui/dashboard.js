function renderDashboard(container, teamId) {
  const team = getTeamById(teamId);
  const roster = getTeamRoster(teamId);
  const payroll = getTeamPayroll(teamId);
  const capSpace = CAP_CONSTANTS.SALARY_CAP - payroll;

  container.innerHTML =
    '<h1 style="color:' + team.colors.primary + ';">' + team.name + '</h1>' +
    '<p>Record: ' + team.record.wins + '-' + team.record.losses + '</p>' +
    '<p>Roster size: ' + roster.length + ' players</p>' +
    '<p>Payroll: $' + payroll.toLocaleString() + ' / Cap: $' + CAP_CONSTANTS.SALARY_CAP.toLocaleString() +
      ' (' + (capSpace >= 0 ? '$' + capSpace.toLocaleString() + ' space' : '$' + Math.abs(capSpace).toLocaleString() + ' over') + ')</p>' +
    '<p>Team Chemistry: ' + team.chemistry + '/100</p>' +
    '<p>Fan Happiness: ' + team.fanHappiness + '/100 &nbsp; Owner Happiness: ' + team.ownerHappiness + '/100</p>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDashboard: renderDashboard };
}
