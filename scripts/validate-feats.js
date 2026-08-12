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

function checkTripleDouble() {
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: 10, assists: 10 })), ['tripleDouble']);
  // Two categories is not a triple-double.
  assert.deepStrictEqual(kinds(line({ points: 30, rebounds: 10, assists: 9 })), []);
  // Steals and blocks count toward it, not just the classic three.
  assert.deepStrictEqual(kinds(line({ points: 10, rebounds: 10, blocks: 10 })), ['tripleDouble']);
  console.log('checkTripleDouble: OK');
}

function checkFiveByFive() {
  const l = line({ points: 5, rebounds: 5, assists: 5, steals: 5, blocks: 5 });
  assert.ok(kinds(l).indexOf('fiveByFive') !== -1, 'all five at 5 is a five-by-five');
  // One short in a single category is not.
  const short = line({ points: 5, rebounds: 5, assists: 5, steals: 5, blocks: 4 });
  assert.strictEqual(kinds(short).indexOf('fiveByFive'), -1);
  console.log('checkFiveByFive: OK');
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
  const out = feats.detectFeats(line({ points: 30, rebounds: 10, assists: 10 }), CTX);
  assert.strictEqual(out.length, 1);
  const f = out[0];
  ['leagueYear', 'day', 'playerId', 'playerName', 'teamId', 'oppTeamId'].forEach(function (k) {
    assert.strictEqual(f[k], CTX[k], k + ' must be carried onto the record');
  });
  assert.strictEqual(f.points, 30);
  assert.strictEqual(f.rebounds, 10);
  assert.strictEqual(f.assists, 10);
  console.log('checkRecordCarriesContext: OK');
}

function checkEmptyLineProducesNothing() {
  assert.deepStrictEqual(feats.detectFeats(line({}), CTX), []);
  assert.deepStrictEqual(feats.detectFeats(null, CTX), []);
  console.log('checkEmptyLineProducesNothing: OK');
}

checkTripleDouble();
checkFiveByFive();
checkScoringBoundaries();
checkRecordCarriesContext();
checkEmptyLineProducesNothing();
console.log('All feat validations passed');
