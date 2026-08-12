// Family lines between players. Links are always written in both directions,
// so the invariants worth asserting are structural: both ends present, no
// self-links, no duplicates, and a timeline that is never absurd.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const relatives = require(path.join(ROOT, 'relatives.js'));

function mk(id, name) { return { id: id, name: name }; }

function checkLinksAreAlwaysBothWays() {
  const dad = mk('p1', 'Big Name'), kid = mk('p2', 'Small Name');
  relatives.link(dad, kid, 'father');
  assert.deepStrictEqual(dad.relatives, [{ type: 'son', playerId: 'p2', name: 'Small Name' }],
    'the father must record a son');
  assert.deepStrictEqual(kid.relatives, [{ type: 'father', playerId: 'p1', name: 'Big Name' }],
    'the son must record a father');

  const b1 = mk('p3', 'One'), b2 = mk('p4', 'Two');
  relatives.link(b1, b2, 'brother');
  assert.strictEqual(b1.relatives[0].type, 'brother');
  assert.strictEqual(b2.relatives[0].type, 'brother');
  assert.strictEqual(b1.relatives[0].playerId, 'p4');
  assert.strictEqual(b2.relatives[0].playerId, 'p3');
  console.log('checkLinksAreAlwaysBothWays: OK');
}

function checkNoSelfLinksAndNoDuplicates() {
  const p = mk('p5', 'Solo');
  relatives.link(p, p, 'brother');
  assert.deepStrictEqual(p.relatives || [], [], 'a player cannot be his own relative');

  const a = mk('p6', 'A'), b = mk('p7', 'B');
  relatives.link(a, b, 'brother');
  relatives.link(a, b, 'brother');
  assert.strictEqual(a.relatives.length, 1, 'linking twice must not duplicate');
  assert.strictEqual(b.relatives.length, 1, 'on either side');

  // The same pair CAN hold two different kinds of link without one erasing the
  // other; what must never happen is the same kind twice.
  relatives.link(a, b, 'father');
  assert.strictEqual(a.relatives.length, 2);
  assert.strictEqual(relatives.relativesOf(a).filter(function (r) { return r.type === 'brother'; }).length, 1);
  console.log('checkNoSelfLinksAndNoDuplicates: OK');
}

function checkRelativesOfIsSafeOnAnyone() {
  assert.deepStrictEqual(relatives.relativesOf(null), []);
  assert.deepStrictEqual(relatives.relativesOf(mk('p8', 'Nobody')), [],
    'a player with no family must return an empty list, not undefined');
  console.log('checkRelativesOfIsSafeOnAnyone: OK');
}

checkLinksAreAlwaysBothWays();
checkNoSelfLinksAndNoDuplicates();
checkRelativesOfIsSafeOnAnyone();
console.log('All relatives validations passed');
