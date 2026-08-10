// The banner raising. Deliberately CHEAP: it reuses the existing panel styling
// rather than introducing a visual system of its own. The point is the pause
// and the acknowledgement, not spectacle.
//
// Only the championship gets a full scene. Milestones are feed lines and a
// Dashboard change — a banner raising plus a milestone popup plus an award
// ceremony in the same offseason is an interruption, not a reward.
function maybeShowChampionshipScene(championTeamId, leagueYear, onContinue) {
  if (!championTeamId || championTeamId !== GameState.userTeamId) return false;

  const container = document.getElementById('view-content');
  if (!container) return false;

  const career = ensureGmCareer(GameState);
  const totals = gmCareerTotals(career);
  const team = getTeamById(championTeamId);
  if (!team) return false;
  const nth = totals.titles;

  // A first title should not read like a fourth.
  const headline = nth <= 1 ? 'Your first championship.' : 'Championship number ' + nth + '.';
  const sub = nth <= 1
    ? 'They will remember where they were.'
    : gmCareerTitleYears(career).join(' · ');

  container.innerHTML =
    '<div class="panel champ-scene"><div class="panel-body" style="text-align:center;">' +
      '<div class="banner banner-large"><div class="banner-year">' + leagueYear + '</div>' +
        '<div class="banner-label">CHAMPIONS</div></div>' +
      '<h2 style="margin-top:14px;">' + teamLogoImgHtml(team.id, 32) + ' ' + escapeHtml(team.name) + '</h2>' +
      '<div class="kpi-value" style="font-size:1.15rem;">' + escapeHtml(headline) + '</div>' +
      '<div class="kpi-sub" style="margin-bottom:14px;">' + escapeHtml(sub) + '</div>' +
      '<button id="champ-continue" class="btn-primary">Raise the banner</button>' +
    '</div></div>';

  const btn = document.getElementById('champ-continue');
  if (btn) {
    btn.addEventListener('click', function () {
      if (typeof onContinue === 'function') onContinue();
    });
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { maybeShowChampionshipScene: maybeShowChampionshipScene };
}
