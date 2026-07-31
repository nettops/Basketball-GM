const assert = require('assert');
const path = require('path');

const data = require(path.join(__dirname, '..', 'data.js'));

function checkDataConstants() {
  assert.strictEqual(data.ATTRIBUTE_KEYS.length, 20, 'expected 20 attribute keys');
  assert.strictEqual(new Set(data.ATTRIBUTE_KEYS).size, 20, 'attribute keys must be unique');
  assert.deepStrictEqual(data.POSITIONS, ['PG', 'SG', 'SF', 'PF', 'C']);
  assert.deepStrictEqual(data.CONFERENCES, ['Eastern', 'Western']);
  assert.strictEqual(data.DIVISIONS.Eastern.length, 3);
  assert.strictEqual(data.DIVISIONS.Western.length, 3);
  assert.strictEqual(data.RATING_MIN, 25);
  assert.strictEqual(data.RATING_MAX, 99);
  console.log('checkDataConstants: OK');
}

checkDataConstants();
console.log('All validations passed');
