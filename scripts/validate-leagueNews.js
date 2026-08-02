const assert = require('assert');
const path = require('path');

const news = require(path.join(__dirname, '..', 'ui', 'leagueNews.js'));

function checkCategorizeFeedEntry() {
  assert.strictEqual(news.categorizeFeedEntry('Trade: Boston Celtics get Player A; Sacramento Kings get Player B'), 'trade');
  assert.strictEqual(news.categorizeFeedEntry('Auto-traded with Sacramento Kings'), 'trade');
  assert.strictEqual(news.categorizeFeedEntry("Player X signs with Boston Celtics ($5,000,000/yr, 2 yrs)"), 'freeagency');
  assert.strictEqual(news.categorizeFeedEntry('Jayson Tatum (Boston Celtics) injured: Two Weeks'), 'injury');
  assert.strictEqual(news.categorizeFeedEntry('Brooklyn Nets 117, Boston Celtics 120'), 'game');
  assert.strictEqual(news.categorizeFeedEntry('Boston Celtics wins the 2026 championship!'), 'league');
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
