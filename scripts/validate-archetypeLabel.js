// The archetype label must SAY something true. Three claims:
//   1. every player in the league gets a non-empty label (and so will every
//      generated player — same constructor, same attribute anchors)
//   2. the label's skill family cannot contradict the player's 2K identity
//      on a hand-checked set of unmistakable players
//   3. the label is DERIVED — change the attributes and it can change
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js'); rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
rq('ratings.js');
const { archetypeLabel } = rq('archetypeLabel.js');

function byName(name) {
  const p = PLAYERS_2026.find(function (x) { return x.name === name; });
  assert.ok(p, name + ' must be in the imported league');
  return p;
}

function checkEveryPlayerGetsALabel() {
  const counts = {};
  PLAYERS_2026.forEach(function (p) {
    const label = archetypeLabel(p);
    assert.ok(typeof label === 'string' && label.length > 0, p.name + ' got no label');
    counts[label] = (counts[label] || 0) + 1;
  });
  const distinct = Object.keys(counts).length;
  assert.ok(distinct >= 8, 'the league should read as varied — only ' + distinct + ' labels in use');
  const biggest = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  assert.ok(counts[biggest] / PLAYERS_2026.length <= 0.5,
    biggest + ' covers ' + counts[biggest] + '/' + PLAYERS_2026.length + ' — a label most players share says nothing');
  console.log('checkEveryPlayerGetsALabel: OK (' + distinct + ' labels, largest "' + biggest + '" x' + counts[biggest] + ')');
}

// The hand-checked set: unmistakable identities. The assertion is on the
// skill FAMILY, not the exact word — Curry may be a Sharpshooter or a
// Two-Way Guard, but a Rim Protector Curry means the formula is broken.
function checkUnmistakableIdentities() {
  const cases = [
    { name: 'Stephen Curry', anyOf: ['Sharpshooter', '3-and-D', 'Floor General', 'Two-Way Guard', 'Shot Creator', 'Scoring Threat'] },
    { name: 'Nikola Jokic', anyOf: ['Point Center', 'Two-Way Big', 'Post Scorer', 'Stretch Big'] },
    { name: 'Rudy Gobert', anyOf: ['Rim Protector', 'Glass Cleaner', 'Two-Way Big', 'Defensive Specialist'] },
    { name: 'Shai Gilgeous-Alexander', anyOf: ['Shot Creator', 'Slasher', 'Two-Way Guard', 'Floor General', 'Scoring Threat'] },
    { name: 'Victor Wembanyama', anyOf: ['Two-Way Big', 'Rim Protector', 'Stretch Big', 'Point Center'] }
  ];
  cases.forEach(function (c) {
    const label = archetypeLabel(byName(c.name));
    assert.ok(c.anyOf.indexOf(label) !== -1,
      c.name + ' derived "' + label + '" — expected one of: ' + c.anyOf.join(', '));
    console.log('  ' + c.name + ' -> ' + label);
  });
  console.log('checkUnmistakableIdentities: OK');
}

function checkLabelIsDerived() {
  const p = byName('Rudy Gobert');
  const before = archetypeLabel(p);
  const saved = Object.assign({}, p.attributes);
  Object.keys(p.attributes).forEach(function (k) { p.attributes[k] = 30; });
  p.attributes.threePoint = 95; p.attributes.midRange = 90;
  const after = archetypeLabel(p);
  Object.keys(saved).forEach(function (k) { p.attributes[k] = saved[k]; });
  assert.notStrictEqual(after, before, 'a rebuilt skillset must be able to change the label');
  assert.strictEqual(archetypeLabel(p), before, 'restoring the attributes must restore the label');
  console.log('checkLabelIsDerived: OK ("' + before + '" -> "' + after + '" -> back)');
}

checkEveryPlayerGetsALabel();
checkUnmistakableIdentities();
checkLabelIsDerived();
console.log('All archetype label validations passed');
