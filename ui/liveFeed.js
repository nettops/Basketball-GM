function renderLiveFeed(container) {
  let html = '<div class="view-header"><h2>Live Feed</h2><span class="view-sub">' + GameState.feed.length + ' events</span></div>';
  if (GameState.feed.length === 0) {
    html += '<div class="empty-state">Nothing has happened yet — advance the sim to see events here.</div>';
  } else {
    html += '<div class="panel">';
    GameState.feed.slice().reverse().forEach(function (entry) {
      html += '<div class="feed-item"><span class="feed-day">Y' + entry.leagueYear + ' · D' +
        // Feed text is assembled in the sim layer (trade.js, freeAgency.js,
        // history.js) and embeds player and team names, so it carries whatever
        // a user typed into player creation or the commissioner tools.
        dayLabel(entry.day) + '</span><span>' + escapeHtml(entry.text) + '</span></div>';
    });
    html += '</div>';
  }
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderLiveFeed: renderLiveFeed };
}
