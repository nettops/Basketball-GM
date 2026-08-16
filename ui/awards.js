const AWARD_LABELS = {
  mvp: 'MVP',
  dpoy: 'Defensive Player of the Year',
  roy: 'Rookie of the Year',
  sixthMoy: 'Sixth Man of the Year',
  mip: 'Most Improved Player',
  // Labels only. The KEYS stay 'allNba1'..'allNba3' on purpose — they are
  // written into player.awardsWon and every save ever made holds them, so
  // renaming the key would erase the award history of anyone who has already
  // played a season. What a player reads is this string; what the save holds
  // is an internal id nobody sees.
  allNba1: 'All-League First Team',
  allNba2: 'All-League Second Team',
  allNba3: 'All-League Third Team'
};

const AWARD_DISPLAY_ORDER = ['mvp', 'dpoy', 'roy', 'sixthMoy', 'mip', 'allNba1', 'allNba2', 'allNba3'];

function renderAwards(container) {
  let html = '<div class="view-header"><h2>Awards</h2></div>';

  if (LEAGUE_HISTORY.awardsHistory.length === 0) {
    html += '<div class="empty-state">No seasons completed yet — awards appear here once a season ends.</div>';
    container.innerHTML = html;
    return;
  }

  LEAGUE_HISTORY.awardsHistory.slice().reverse().forEach(function (season) {
    html += '<div class="panel"><div class="panel-header">' + season.leagueYear + ' Season</div><ul class="stack-list">';
    AWARD_DISPLAY_ORDER.forEach(function (awardKey) {
      const winners = season.winners.filter(function (w) { return w.award === awardKey; });
      if (winners.length === 0) return;
      html += '<li><span class="feed-day" style="min-width:210px;display:inline-block;">' + AWARD_LABELS[awardKey] +
        '</span>' + winners.map(function (w) { return escapeHtml(w.playerName); }).join(', ') + '</li>';
    });
    if (season.coachOfTheYear) {
      html += '<li><span class="feed-day" style="min-width:210px;display:inline-block;">Coach of the Year</span>' +
        escapeHtml(season.coachOfTheYear.coach.name) + ' (' + escapeHtml(season.coachOfTheYear.teamName) + ')</li>';
    }
    if (season.mostImprovedTeam) {
      html += '<li><span class="feed-day" style="min-width:210px;display:inline-block;">Most Improved Team</span>' +
        escapeHtml(season.mostImprovedTeam.teamName) + '</li>';
    }
    html += '</ul></div>';
  });

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAwards: renderAwards, AWARD_LABELS: AWARD_LABELS };
}
