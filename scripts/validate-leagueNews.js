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

// Recaps are composed when the game is played and stored as text, so they
// survive save.js pruning box scores down to the user's own games. This checks
// the news view reads them without needing a box score at all — the whole
// point of the design.
function checkRecapsSurviveWithoutBoxScores() {
  global.GameState = {
    season: {
      games: [
        // No boxScore: this is what twenty-nine teams' games look like after a
        // save/load round trip.
        { played: true, day: 3, homeTeamId: 'BOS', awayTeamId: 'NYK', recap: 'Boston edge New York 101-99.' },
        { played: true, day: 7, homeTeamId: 'LAL', awayTeamId: 'GSW', recap: 'Los Angeles rout Golden State 130-98.' },
        { played: true, day: 5, homeTeamId: 'BOS', awayTeamId: 'MIA', recap: 'Miami beat Boston 110-102.' },
        { played: false, day: 9, homeTeamId: 'BOS', awayTeamId: 'CHI', recap: null }
      ]
    }
  };

  const all = news.computeRecaps(null, 25);
  assert.strictEqual(all.length, 3, 'every played game with a recap should appear, box score or not');
  assert.strictEqual(all[0].day, 7, 'recaps come newest first');
  assert.strictEqual(all[2].day, 3, 'oldest last');

  const bos = news.computeRecaps('BOS', 25);
  assert.strictEqual(bos.length, 2, 'a team filter should match either side of the game');
  assert.ok(bos.every(function (g) { return g.homeTeamId === 'BOS' || g.awayTeamId === 'BOS'; }),
    'filtered recaps must involve the team asked for');

  assert.strictEqual(news.computeRecaps(null, 2).length, 2, 'the limit is respected');

  global.GameState = { season: null };
  assert.deepStrictEqual(news.computeRecaps(null, 5), [], 'no season is an empty list, not a crash');
  console.log('checkRecapsSurviveWithoutBoxScores: OK');
}
checkRecapsSurviveWithoutBoxScores();

// The composition, end to end: sim a real game, record it, read the sentence.
// recordGameResult is the one function every finished game passes through --
// regular season, playoff, play-in and the game the user watches live -- so a
// recap written here reaches all of them.
function checkEveryFinishedGameGetsASentence() {
  require(path.join(__dirname, '..', 'data.js'));
  const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngine.js'));
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));

  let sawTakeoverMention = 0;
  [11, 404, 1987, 60613, 777001].forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[0].id, TEAMS[1].id, makeRng(seed));
    const game = {
      id: 'g' + seed, homeTeamId: TEAMS[0].id, awayTeamId: TEAMS[1].id, day: 1, played: true,
      homeScore: result.homeScore, awayScore: result.awayScore,
      boxScore: result.boxScore, takeovers: result.takeovers
    };
    leagueModule.recordGameResult(game, { leagueYear: 2026, day: 1 });

    assert.ok(typeof game.recap === 'string' && game.recap.length > 20,
      'seed ' + seed + ' should get a real sentence, got ' + JSON.stringify(game.recap));
    // The score in the sentence must be the score that was played. A recap
    // that disagrees with the box score is worse than no recap.
    const high = Math.max(result.homeScore, result.awayScore);
    const low = Math.min(result.homeScore, result.awayScore);
    assert.ok(game.recap.indexOf(high + '-' + low) !== -1,
      'seed ' + seed + ' recap should carry the real final score: ' + game.recap);
    assert.ok(/ (edge|beat|rout) /.test(game.recap),
      'seed ' + seed + ' recap should describe the shape of the game: ' + game.recap);
    assert.ok(game.recap.indexOf('undefined') === -1 && game.recap.indexOf('NaN') === -1,
      'seed ' + seed + ' recap leaked a placeholder: ' + game.recap);
    if (game.recap.indexOf('took the game over') !== -1) sawTakeoverMention += 1;
  });
  assert.ok(sawTakeoverMention > 0,
    'at least one of these games had a takeover worth mentioning, or that branch is untested');

  // A game with no box score -- a forfeit, or one recorded before the sim ran
  // -- gets no recap rather than a broken one.
  const empty = { id: 'x', homeTeamId: TEAMS[0].id, awayTeamId: TEAMS[1].id, day: 2, played: true, homeScore: 0, awayScore: 0 };
  leagueModule.recordGameResult(empty, { leagueYear: 2026, day: 2 });
  assert.strictEqual(empty.recap, null, 'no box score means no recap, not a crash');
  console.log('checkEveryFinishedGameGetsASentence: OK (' + sawTakeoverMention + '/5 mentioned a takeover)');
}
checkEveryFinishedGameGetsASentence();
