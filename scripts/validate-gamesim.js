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

// If a caller drives step() by hand, it must land on exactly the same game as
// the batch loop. This is the contract the live-stepped watch flow depends on.
function checkManualSteppingMatchesBatch() {
  const cases = [{ seed: 21, home: 'BOS', away: 'MIA' }, { seed: 34, home: 'DEN', away: 'GSW' }];
  cases.forEach(function (c) {
    const batch = possEngine.simulateGame(c.home, c.away, makeRng(c.seed));

    const sim = possEngine.createGameSim(c.home, c.away, makeRng(c.seed));
    let guard = 0;
    while (!sim.done) {
      sim.step();
      assert.ok(guard++ < 5000, 'step() must terminate');
    }
    const stepped = sim.result();

    assert.strictEqual(stepped.homeScore, batch.homeScore, 'stepped home score must equal batch');
    assert.strictEqual(stepped.awayScore, batch.awayScore, 'stepped away score must equal batch');
    assert.strictEqual(boxChecksum(stepped.boxScore), boxChecksum(batch.boxScore), 'stepped box score must equal batch');
    assert.deepStrictEqual(stepped.playByPlay, batch.playByPlay, 'stepped play-by-play must equal batch');
  });
  console.log('checkManualSteppingMatchesBatch: OK');
}
checkManualSteppingMatchesBatch();

// step() after completion must be a no-op, so an over-eager driver cannot
// corrupt a finished game.
function checkStepAfterDoneIsNoop() {
  const sim = possEngine.createGameSim('BOS', 'LAL', makeRng(77));
  while (!sim.done) sim.step();
  const before = sim.result();
  sim.step();
  sim.step();
  const after = sim.result();
  assert.strictEqual(after.homeScore, before.homeScore, 'score must not move after done');
  assert.strictEqual(after.awayScore, before.awayScore, 'score must not move after done');
  assert.strictEqual(after.playByPlay.length, before.playByPlay.length, 'play-by-play must not grow after done');
  console.log('checkStepAfterDoneIsNoop: OK');
}
checkStepAfterDoneIsNoop();

console.log('All game sim validations passed');
