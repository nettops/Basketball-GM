function renderLiveFeed(container) {
  let html = '<h2>Live Feed</h2>';
  if (GameState.feed.length === 0) {
    html += '<p>Nothing has happened yet — advance the sim to see events here.</p>';
  } else {
    html += '<ul>';
    GameState.feed.slice().reverse().forEach(function (entry) {
      html += '<li>[Year ' + entry.leagueYear + ', Day ' + (entry.day === null ? '-' : entry.day) + '] ' + entry.text + '</li>';
    });
    html += '</ul>';
  }
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderLiveFeed: renderLiveFeed };
}
