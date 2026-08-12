// Feats are detected from a box-score line and nothing else, so every
// threshold is testable directly without simulating a game.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const feats = require(path.join(ROOT, 'feats.js'));

const CTX = { leagueYear: 2026, day: 12, playerId: 'p1', playerName: 'Test Player', teamId: 'BOS', oppTeamId: 'LAL' };

function line(over) {
  return Object.assign({ points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0 }, over);
}
function kinds(l) {
  return feats.detectFeats(l, CTX).map(function (f) { return f.kind; }).sort();
}

// Written against the TUNING, never against a literal. The bars are measured
// and will move again; a test that hard-codes 10 would start asserting a rule
// the game no longer has, and would pass or fail for the wrong reason.
const DBL = feats.FEAT_TUNING.doubleAt;
const FIVE = feats.FEAT_TUNING.fiveAt;

function checkTripleDouble() {
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: DBL, assists: DBL })), ['tripleDouble']);
  // Two categories at the bar is not a triple-double.
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: DBL, assists: DBL - 1 })), []);
  // Steals and blocks count toward it, not just the classic three.
  assert.deepStrictEqual(kinds(line({ points: DBL, rebounds: DBL, blocks: DBL })), ['tripleDouble']);
  console.log('checkTripleDouble: OK (bar ' + DBL + ')');
}

function checkFiveByFive() {
  const l = line({ points: FIVE, rebounds: FIVE, assists: FIVE, steals: FIVE, blocks: FIVE });
  assert.ok(kinds(l).indexOf('fiveByFive') !== -1, 'all five at the bar is a five-by-five');
  // One short in a single category is not.
  const short = line({ points: FIVE, rebounds: FIVE, assists: FIVE, steals: FIVE, blocks: FIVE - 1 });
  assert.strictEqual(kinds(short).indexOf('fiveByFive'), -1);
  console.log('checkFiveByFive: OK (bar ' + FIVE + ')');
}

function checkScoringBoundaries() {
  const big = feats.FEAT_TUNING.bigScoring;
  assert.ok(kinds(line({ points: big })).indexOf('bigScoring') !== -1, 'exactly at the bar counts');
  assert.strictEqual(kinds(line({ points: big - 1 })).indexOf('bigScoring'), -1, 'one under does not');
  const huge = feats.FEAT_TUNING.hugeScoring;
  assert.ok(huge > big, 'the huge bar must be above the big one');
  const h = kinds(line({ points: huge }));
  assert.ok(h.indexOf('hugeScoring') !== -1, 'exactly at the huge bar counts');
  assert.ok(h.indexOf('bigScoring') === -1, 'a huge night reports as huge only, not both');
  console.log('checkScoringBoundaries: OK');
}

function checkRecordCarriesContext() {
  const out = feats.detectFeats(line({ points: 30, rebounds: DBL, assists: DBL }), CTX);
  assert.strictEqual(out.length, 1);
  const f = out[0];
  ['leagueYear', 'day', 'playerId', 'playerName', 'teamId', 'oppTeamId'].forEach(function (k) {
    assert.strictEqual(f[k], CTX[k], k + ' must be carried onto the record');
  });
  assert.strictEqual(f.points, 30);
  assert.strictEqual(f.rebounds, DBL);
  assert.strictEqual(f.assists, DBL);
  console.log('checkRecordCarriesContext: OK');
}

function checkEmptyLineProducesNothing() {
  assert.deepStrictEqual(feats.detectFeats(line({}), CTX), []);
  assert.deepStrictEqual(feats.detectFeats(null, CTX), []);
  console.log('checkEmptyLineProducesNothing: OK');
}

// The BANDS are the specification, not the bar values. If scoring pace moves
// again, this fails rather than quietly making feats commonplace.
//
// fiveByFive's band floor is 0 and its measured rate is 0, so its lower bound
// is vacuous by construction — checkFiveByFive above is what proves that
// detection works. Every other kind's lower bound has teeth.
const TARGET_RATES = {
  bigScoring: [15, 40],
  hugeScoring: [1, 6],
  tripleDouble: [40, 120],
  fiveByFive: [0, 3]
};

// 3000 games, not a few hundred. hugeScoring fires about 4 times per 1230-game
// season, so a 200-game sample would expect 0.65 of them and report a rate of
// 0.0 half the time — an assertion that fails for sampling reasons rather than
// for the reason it was written. At 3000 games the expected count is ~10 and
// the band has real resolution. The seed is fixed, so the result is the same
// on every run; it is a regression tripwire, not a statistical estimate.
const RATE_GAMES = 3000;
const RATE_SEED = 31337;
const GAMES_PER_SEASON = 1230;

function checkRatesAreInBand() {
  const rq2 = function (f) { return require(path.join(ROOT, f)); };
  rq2('data.js'); rq2('rng.js');
  const TEAMS = rq2('teams.js').TEAMS;
  const traits = rq2('traits.js');
  rq2('scouting.js');
  const PLAYERS = rq2('players-2026.js').PLAYERS_2026;
  traits.ensureHiddenPlayerData(PLAYERS);
  const makeRng = rq2('rng.js').makeRng;
  rq2('simEngine.js'); rq2('simEngineBoxScore.js'); rq2('simEnginePossession.js');
  rq2('gameCoach.js');
  const gameSim = rq2('gameSim.js');
  global.GameState = global.GameState ||
    { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };

  const rng = makeRng(RATE_SEED);
  const counts = { bigScoring: 0, hugeScoring: 0, tripleDouble: 0, fiveByFive: 0 };
  let lines = 0;
  for (let i = 0; i < RATE_GAMES; i++) {
    const home = TEAMS[i % TEAMS.length], away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng, {});
    Object.keys(r.boxScore).forEach(function (id) {
      lines++;
      feats.detectFeats(r.boxScore[id], CTX).forEach(function (f) { counts[f.kind] += 1; });
    });
  }
  const scale = GAMES_PER_SEASON / RATE_GAMES;
  feats.FEAT_KINDS.forEach(function (kind) {
    const rate = counts[kind] * scale;
    const band = TARGET_RATES[kind];
    assert.ok(rate >= band[0] && rate <= band[1],
      kind + ' fires ' + rate.toFixed(1) + ' times a season, outside the ' +
      band[0] + '-' + band[1] + ' target band');
  });
  // The sample has to be big enough for the bands to mean anything.
  assert.ok(lines > 50000, 'rate sample of ' + lines + ' player-lines is too small to resolve a rare feat');
  console.log('checkRatesAreInBand: OK (' + feats.FEAT_KINDS.map(function (k) {
    return k + ' ' + (counts[k] * scale).toFixed(1);
  }).join(', ') + ')');
}

checkTripleDouble();
checkFiveByFive();
checkScoringBoundaries();
checkRecordCarriesContext();
checkEmptyLineProducesNothing();
checkRatesAreInBand();
console.log('All feat validations passed');
