const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const golden = require(path.join(__dirname, 'fixtures', 'gamesim-golden.json'));

function boxChecksum(boxScore) {
  const keys = Object.keys(boxScore).sort();
  let sum = 0;
  keys.forEach(function (id, idx) {
    const line = boxScore[id];
    ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
     'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fouls'].forEach(function (k, ki) {
      sum = (sum + (line[k] || 0) * (idx + 1) * (ki + 3)) % 2147483647;
    });
  });
  return sum;
}

// The whole point of Stage 1: the refactor must not move a single number.
function checkGoldenMaster() {
  golden.forEach(function (g) {
    const result = possEngine.simulateGame(g.home, g.away, makeRng(g.seed));
    assert.strictEqual(result.homeScore, g.homeScore,
      'seed ' + g.seed + ' home score drifted: ' + result.homeScore + ' vs golden ' + g.homeScore);
    assert.strictEqual(result.awayScore, g.awayScore,
      'seed ' + g.seed + ' away score drifted: ' + result.awayScore + ' vs golden ' + g.awayScore);
    assert.strictEqual(boxChecksum(result.boxScore), g.boxChecksum,
      'seed ' + g.seed + ' box score distribution drifted');
    assert.strictEqual(result.playByPlay.length, g.playByPlayLength,
      'seed ' + g.seed + ' play-by-play length drifted');
  });
  console.log('checkGoldenMaster: OK (' + golden.length + ' cases)');
}
checkGoldenMaster();

console.log('All game sim validations passed');
