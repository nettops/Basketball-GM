const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkRng() {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB, 'same seed must produce same sequence');
  seqA.forEach(function (v) { assert.ok(v >= 0 && v < 1, 'rng output out of [0,1) range'); });
  const c = makeRng(43);
  assert.notStrictEqual(a(), c(), 'different seeds should (almost certainly) differ');
  console.log('checkRng: OK');
}

checkRng();
console.log('All sim validations passed');
