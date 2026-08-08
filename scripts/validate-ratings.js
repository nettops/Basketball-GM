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
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
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

// The league must contain individuals, not 8 archetypes at different scales.
// Before the rescale this was 17 shapes across 380 players: makeAttributes was
// literally `overall + archetypeOffset[key]`, so two players with the same
// overall and archetype were byte-identical, and `threePoint - insideScoring`
// — the number that governs shot mix — took 9 distinct values league-wide.
// Every compressed spread in docs/superpowers/identity-baseline.txt is
// downstream of this one fact.
function checkPlayersAreIndividuals() {
  const seen = {};
  PLAYERS_2026.forEach(function (p) {
    const mean = ATTRIBUTE_KEYS.reduce(function (s, k) { return s + p.attributes[k]; }, 0) / ATTRIBUTE_KEYS.length;
    seen[ATTRIBUTE_KEYS.map(function (k) { return Math.round(p.attributes[k] - mean); }).join(',')] = true;
  });
  const shapes = Object.keys(seen).length;
  assert.ok(shapes >= PLAYERS_2026.length * 0.97,
    'attribute shapes should be nearly all distinct, got ' + shapes + ' for ' + PLAYERS_2026.length + ' players');
  console.log('checkPlayersAreIndividuals: OK (' + shapes + '/' + PLAYERS_2026.length + ' distinct)');
}

// Every downstream formula is written against a scale where 50 is average —
// shotMakeProbability's `(composite - 50) / 250`, turnoverChance's `/ 400`,
// blockChance's `(block - 50) / 900`. Before the rescale the attributes lived
// in 48-99 with a mean of 74.2, so all of those were being read at the wrong
// point on their own curves. The offensive and defensive inflations happened
// to cancel in aggregate, which is why nothing looked broken.
function checkRatingsUseTheWholeScale() {
  const all = [];
  PLAYERS_2026.forEach(function (p) {
    ATTRIBUTE_KEYS.forEach(function (k) { all.push(p.attributes[k]); });
  });
  const mean = all.reduce(function (a, b) { return a + b; }, 0) / all.length;
  const sd = Math.sqrt(all.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / all.length);
  assert.ok(mean >= 44 && mean <= 56, 'league attribute mean should be near 50, got ' + mean.toFixed(1));
  assert.ok(sd >= 11 && sd <= 18, 'league attribute sd should be 11-18, got ' + sd.toFixed(1));
  assert.ok(Math.min.apply(null, all) <= 20,
    'somebody should be genuinely bad at something, league min was ' + Math.min.apply(null, all));
  assert.ok(Math.max.apply(null, all) >= 90,
    'somebody should be genuinely elite at something, league max was ' + Math.max.apply(null, all));
  console.log('checkRatingsUseTheWholeScale: OK (mean ' + mean.toFixed(1) + ', sd ' + sd.toFixed(1) +
    ', range ' + Math.min.apply(null, all) + '-' + Math.max.apply(null, all) + ')');
}

// Generation must be a pure function of the player's id. Attributes seeded
// from a shared or ambient rng would make the league different on every load,
// which silently invalidates saves and both golden masters.
function checkGenerationIsDeterministic() {
  const modPath = require.resolve(path.join(__dirname, '..', 'players-2026.js'));
  delete require.cache[modPath];
  const second = require(modPath).PLAYERS_2026;
  assert.strictEqual(second.length, PLAYERS_2026.length, 'regeneration changed the roster size');
  for (let i = 0; i < second.length; i++) {
    assert.strictEqual(second[i].id, PLAYERS_2026[i].id, 'regeneration reordered the roster');
    ATTRIBUTE_KEYS.forEach(function (k) {
      assert.strictEqual(second[i].attributes[k], PLAYERS_2026[i].attributes[k],
        'regeneration changed ' + second[i].id + '.' + k);
    });
  }
  console.log('checkGenerationIsDeterministic: OK');
}

// Synergy exists to reward roster CONSTRUCTION — stacking shooters compounds
// floor spacing. If most of the league clears every bar it cannot distinguish
// anything: at baseline 65.5% of players counted as shooters, 76.3% as
// defenders and 70.8% as rebounders. Tested against computeTeamSynergy's own
// ORs, not a single composite, because the ORs are what actually fire.
function checkSynergyThresholdsAreSelective() {
  const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));
  const c = function (p, k) { return composite.computeComposite(p, k); };
  const groups = {
    shooter: PLAYERS_2026.filter(function (p) {
      return c(p, 'shootingThree') >= composite.SHOOTER_THRESHOLD ||
             c(p, 'shootingMid') >= composite.SHOOTER_THRESHOLD;
    }).length,
    defender: PLAYERS_2026.filter(function (p) {
      return c(p, 'defenseInterior') >= composite.DEFENDER_THRESHOLD ||
             c(p, 'defensePerimeter') >= composite.DEFENDER_THRESHOLD;
    }).length,
    rebounder: PLAYERS_2026.filter(function (p) {
      return c(p, 'rebounding') >= composite.REBOUNDER_THRESHOLD;
    }).length
  };
  Object.keys(groups).forEach(function (k) {
    const share = groups[k] / PLAYERS_2026.length;
    assert.ok(share >= 0.10 && share <= 0.32,
      k + ' threshold selects ' + (share * 100).toFixed(1) + '% of the league, want 10-32%');
  });
  console.log('checkSynergyThresholdsAreSelective: OK (' +
    Object.keys(groups).map(function (k) {
      return k + ' ' + (groups[k] / PLAYERS_2026.length * 100).toFixed(1) + '%';
    }).join(', ') + ')');
}

checkPlusMinusBalances();
checkPlayersAreIndividuals();
checkRatingsUseTheWholeScale();
checkGenerationIsDeterministic();
checkSynergyThresholdsAreSelective();

console.log('All ratings validations passed');
