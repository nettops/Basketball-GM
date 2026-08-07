// Renders a team's logo image over a colored fallback badge (team primary/secondary
// colors), so missing logo files (see assets/logos/README.md) degrade to a colored
// circle instead of a broken-image icon.
function teamLogoImgHtml(teamId, sizePx) {
  const team = getTeamById(teamId);
  const size = sizePx || 32;
  return '<span class="team-logo" style="width:' + size + 'px;height:' + size + 'px;background:' +
    team.colors.primary + ';border-color:' + team.colors.secondary + ';">' +
    '<img src="' + getTeamLogoUrl(teamId) + '" alt="' + escapeHtml(team.name) + ' logo" onerror="this.style.display=\'none\'">' +
    '</span>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { teamLogoImgHtml: teamLogoImgHtml };
}
