const assert = require('assert');
const path = require('path');

const news = require(path.join(__dirname, '..', 'ui', 'leagueNews.js'));

function checkCategorizeFeedEntry() {
  assert.strictEqual(news.categorizeFeedEntry('Trade: Boston Harbormen get Player A; Sacramento Gold get Player B'), 'trade');
  assert.strictEqual(news.categorizeFeedEntry('Auto-traded with Sacramento Gold'), 'trade');
  assert.strictEqual(news.categorizeFeedEntry("Player X signs with Boston Harbormen ($5,000,000/yr, 2 yrs)"), 'freeagency');
  assert.strictEqual(news.categorizeFeedEntry('Jayson Tatum (Boston Harbormen) injured: Two Weeks'), 'injury');
  assert.strictEqual(news.categorizeFeedEntry('Brooklyn Ironworks 117, Boston Harbormen 120'), 'game');
  assert.strictEqual(news.categorizeFeedEntry('Boston Harbormen wins the 2026 championship!'), 'league');
  assert.strictEqual(news.categorizeFeedEntry('Jayson Tatum wins MVP for 2026.'), 'league');
  console.log('checkCategorizeFeedEntry: OK');
}

checkCategorizeFeedEntry();

function checkHighlightsFilterToOwnTeamOnly() {
  global.GameState = {
    season: {
      games: [
        {
          played: true, homeTeamId: 'BOS', awayTeamId: 'LAL', day: 5,
          boxScore: {
            'bos-jayson-tatum': { points: 40, rebounds: 5, assists: 3, steals: 1, blocks: 0, fgm: 15, fga: 25, tpm: 3, tpa: 8, ftm: 7, fta: 8, minutes: 36 },
            'lal-luka-doncic': { points: 38, rebounds: 8, assists: 9, steals: 1, blocks: 0, fgm: 14, fga: 24, tpm: 2, tpa: 7, ftm: 8, fta: 9, minutes: 37 }
          }
        }
      ]
    }
  };
  global.getPlayerById = function (id) {
    if (id === 'bos-jayson-tatum') return { id: id, name: 'Jayson Tatum', teamId: 'BOS' };
    if (id === 'lal-luka-doncic') return { id: id, name: 'Luka Doncic', teamId: 'LAL' };
    return null;
  };
  delete require.cache[require.resolve(path.join(__dirname, '..', 'ui', 'leagueNews.js'))];
  const freshNews = require(path.join(__dirname, '..', 'ui', 'leagueNews.js'));

  const bosOnly = freshNews.computeHighlights('BOS');
  assert.strictEqual(bosOnly.length, 1, 'only Tatum (35pt threshold) should qualify, and only for BOS');
  assert.strictEqual(bosOnly[0].playerName, 'Jayson Tatum');

  const allTeams = freshNews.computeHighlights(null);
  assert.strictEqual(allTeams.length, 2, 'with no team filter both 35+ performances should count, across both teams');

  const bosTop = freshNews.computeTopPerformances('BOS', 10);
  assert.ok(bosTop.every(function (h) { return h.teamId === 'BOS'; }), 'computeTopPerformances(teamId) must not leak the opponent\'s players from the same game');

  delete global.GameState;
  delete global.getPlayerById;
  console.log('checkHighlightsFilterToOwnTeamOnly: OK');
}

checkHighlightsFilterToOwnTeamOnly();

console.log('All league news validations passed');

// ~1,278 takeovers a season league-wide. A feed line for each is wallpaper, so
// the bar is measured (see TAKEOVER_NEWS_POINTS) and your own team bypasses it.
function checkTakeoverFeedIsFiltered() {
  const bar = news.TAKEOVER_NEWS_POINTS;
  const ordinary = { teamId: 'LAL', points: bar - 1, ultimateKey: 'heatCheck', playerName: 'A' };
  const extreme = { teamId: 'LAL', points: bar, ultimateKey: 'heatCheck', playerName: 'B' };
  assert.strictEqual(news.takeoverIsNewsworthy(ordinary, 'BOS'), false,
    'an ordinary takeover by another team is not news');
  assert.strictEqual(news.takeoverIsNewsworthy(ordinary, 'LAL'), true,
    'but your own team always gets through, however ordinary');
  assert.strictEqual(news.takeoverIsNewsworthy(extreme, 'BOS'), true,
    'exactly at the bar is news regardless of team');
  assert.strictEqual(news.takeoverIsNewsworthy(null, 'BOS'), false,
    'a missing row is not news rather than a crash');
  console.log('checkTakeoverFeedIsFiltered: OK (bar ' + bar + ')');
}
checkTakeoverFeedIsFiltered();
