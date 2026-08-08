const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

// Plus/minus is the value signal the derived `overall` is fitted against
// (scripts/fit-overall.js). A box score cannot see defense, which is why
// ZenGM regresses its ovr against plus/minus per minute rather than against
// production — see reference/zengm/analysis/player-ovr-basketball/process.py.
// If plus/minus does not balance, that fit is measuring noise.
function checkPlusMinusBalances() {
  const rng = makeRng(31);
  let games = 0;
  for (let i = 0; i < 12; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 9) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = gameSim.simulateGame(home.id, away.id, rng);
    games += 1;

    const side = {};
    league.getTeamRoster(home.id).forEach(function (p) { side[p.id] = 'home'; });
    league.getTeamRoster(away.id).forEach(function (p) { side[p.id] = 'away'; });

    let homePm = 0, awayPm = 0, played = 0;
    Object.keys(result.boxScore).forEach(function (id) {
      const line = result.boxScore[id];
      assert.ok(typeof line.plusMinus === 'number',
        'every box-score line needs a numeric plusMinus, missing for ' + id);
      if (line.minutes > 0) played += 1;
      if (side[id] === 'home') homePm += line.plusMinus;
      if (side[id] === 'away') awayPm += line.plusMinus;
    });

    assert.ok(played >= 10, 'at least both fives should have played, got ' + played);
    // Five players are on the floor for every point scored, so a team's summed
    // plus/minus is exactly five times its final margin. That identity is what
    // makes this a real check rather than a smoke test: it fails if the credit
    // goes to the wrong five, the wrong sign, or the post-substitution lineup.
    const margin = result.homeScore - result.awayScore;
    assert.strictEqual(homePm, 5 * margin,
      'home plus/minus should be 5x the margin, got ' + homePm + ' vs ' + (5 * margin));
    assert.strictEqual(awayPm, -5 * margin,
      'away plus/minus should be -5x the margin, got ' + awayPm + ' vs ' + (-5 * margin));
  }
  console.log('checkPlusMinusBalances: OK (' + games + ' games)');
}

checkPlusMinusBalances();

console.log('All ratings validations passed');
