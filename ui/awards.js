const AWARD_LABELS = {
  mvp: 'MVP',
  dpoy: 'Defensive Player of the Year',
  roy: 'Rookie of the Year',
  sixthMoy: 'Sixth Man of the Year',
  mip: 'Most Improved Player',
  allNba1: 'All-NBA First Team',
  allNba2: 'All-NBA Second Team',
  allNba3: 'All-NBA Third Team'
};

const AWARD_DISPLAY_ORDER = ['mvp', 'dpoy', 'roy', 'sixthMoy', 'mip', 'allNba1', 'allNba2', 'allNba3'];

function renderAwards(container) {
  let html = '<h2>Awards</h2>';

  if (LEAGUE_HISTORY.awardsHistory.length === 0) {
    html += '<p>No seasons completed yet — awards appear here once a season ends.</p>';
    container.innerHTML = html;
    return;
  }

  LEAGUE_HISTORY.awardsHistory.slice().reverse().forEach(function (season) {
    html += '<h3>' + season.leagueYear + '</h3><ul>';
    AWARD_DISPLAY_ORDER.forEach(function (awardKey) {
      const winners = season.winners.filter(function (w) { return w.award === awardKey; });
      if (winners.length === 0) return;
      html += '<li>' + AWARD_LABELS[awardKey] + ': ' + winners.map(function (w) { return w.playerName; }).join(', ') + '</li>';
    });
    if (season.mostImprovedTeam) {
      html += '<li>Most Improved Team: ' + season.mostImprovedTeam.teamName + '</li>';
    }
    html += '</ul>';
  });

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAwards: renderAwards, AWARD_LABELS: AWARD_LABELS };
}
