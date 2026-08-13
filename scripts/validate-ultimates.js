// Every ultimate is DERIVED, never authored and never rolled. These tests build
// synthetic players with a deliberately lopsided profile and assert the
// derivation picks the matching ultimate — which is also the only way to prove
// all twelve are reachable rather than four of them soaking up every player.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data.js'));
require(path.join(ROOT, 'rng.js'));
require(path.join(ROOT, 'ratings.js'));
const ult = require(path.join(ROOT, 'ultimates.js'));

const ATTRS = data.ATTRIBUTE_KEYS;

// A player who is exactly average everywhere, so a test can raise ONE thing and
// know the derivation responded to that and nothing else.
function flatPlayer(over) {
  const attributes = {};
  ATTRS.forEach(function (k) { attributes[k] = 50; });
  return Object.assign({
    id: 'test1', name: 'Test Player', overall: 95,
    attributes: attributes, hiddenTraits: []
  }, over || {});
}

function withAttrs(raised, over) {
  const p = flatPlayer(over);
  Object.keys(raised).forEach(function (k) { p.attributes[k] = raised[k]; });
  return p;
}

function checkGate() {
  const gate = ult.ULTIMATE_TUNING.gateOverall;
  assert.ok(ult.hasUltimate(flatPlayer({ overall: gate })), 'exactly at the gate qualifies');
  assert.ok(!ult.hasUltimate(flatPlayer({ overall: gate - 1 })), 'one under does not');
  assert.strictEqual(ult.ultimateFor(flatPlayer({ overall: gate - 1 })), null,
    'a non-star has no ultimate at all, not a default one');
  console.log('checkGate: OK (gate ' + gate + ')');
}

// The trap this guards: RATING_BANDS live on the DISPLAY scale. Gating on
// rawOverall would admit a wildly different set of players and the bug would be
// invisible — everything would still "work", just for the wrong 200 people.
function checkGateUsesDisplayOverall() {
  const p = flatPlayer({ overall: ult.ULTIMATE_TUNING.gateOverall, rawOverall: 1 });
  assert.ok(ult.hasUltimate(p), 'the gate reads overall, not rawOverall');
  console.log('checkGateUsesDisplayOverall: OK');
}

function checkEveryUltimateIsReachable() {
  // One lopsided profile per ultimate. If a taxonomy entry can never win the
  // derivation it is decorative, which is the failure this catches.
  const cases = {
    heatCheck: { threePoint: 99, basketballIQ: 90 },
    silky: { midRange: 99, basketballIQ: 90 },
    paintBeast: { insideScoring: 99, postScoring: 95, strength: 90 },
    downhill: { ballHandling: 99, passing: 80, speed: 95, acceleration: 95 },
    aboveTheRim: { vertical: 99, acceleration: 97 },
    andOne: { strength: 99, freeThrow: 97 },
    glassWrecker: { offReb: 99, defReb: 99, strength: 90, vertical: 90 },
    coldBlooded: { basketballIQ: 99 },
    clamps: { perimeterDefense: 99, steal: 95, speed: 90 },
    motorNeverStops: { workEthic: 99 },
    floorGeneral: { passing: 99, ballHandling: 85, basketballIQ: 88 },
    theWall: { interiorDefense: 99, block: 95, strength: 90 }
  };
  Object.keys(cases).forEach(function (key) {
    assert.ok(ult.ULTIMATE_BY_KEY[key], 'unknown ultimate in test: ' + key);
    const got = ult.ultimateFor(withAttrs(cases[key]));
    assert.ok(got, key + ': derivation returned null for a qualifying star');
    assert.strictEqual(got.key, key,
      key + ': expected ' + key + ', got ' + got.key);
  });
  assert.strictEqual(Object.keys(cases).length, ult.ULTIMATE_TAXONOMY.length,
    'every taxonomy entry needs a reachability case');
  console.log('checkEveryUltimateIsReachable: OK (' + ult.ULTIMATE_TAXONOMY.length + ' ultimates)');
}

function checkDerivationIsDeterministic() {
  const p = withAttrs({ threePoint: 99 });
  const a = ult.ultimateFor(p), b = ult.ultimateFor(p);
  assert.strictEqual(a.key, b.key, 'the same player must always derive the same ultimate');
  console.log('checkDerivationIsDeterministic: OK');
}

function checkBadgeBoost() {
  const plain = withAttrs({ threePoint: 99 });
  assert.strictEqual(ult.badgeBoostFor(plain, ult.ultimateFor(plain)), 1,
    'no matching badge means no boost');
  const legend = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'legendary' }] });
  assert.ok(ult.badgeBoostFor(legend, ult.ultimateFor(legend)) > 1,
    'a matching legendary badge boosts the takeover');
  const bronze = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }] });
  assert.strictEqual(ult.badgeBoostFor(bronze, ult.ultimateFor(bronze)), 1,
    'only legendary and secret tiers boost — lower tiers do not');
  const wrong = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'rimProtector', tier: 'legendary' }] });
  assert.strictEqual(ult.badgeBoostFor(wrong, ult.ultimateFor(wrong)), 1,
    'a legendary badge that does not match the ultimate gives nothing');
  console.log('checkBadgeBoost: OK');
}

function checkTaxonomyShape() {
  const seen = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(!seen[u.key], 'duplicate ultimate key: ' + u.key);
    seen[u.key] = true;
    assert.ok(u.name && u.name.length, u.key + ' needs a display name');
    assert.ok(u.kind === 'solo' || u.kind === 'team', u.key + ' kind must be solo or team');
    assert.ok(u.side === 'offense' || u.side === 'defense', u.key + ' side must be offense or defense');
    assert.ok(u.derive && (u.derive.composite || u.derive.attributes),
      u.key + ' needs a derivation source');
  });
  const team = ult.ULTIMATE_TAXONOMY.filter(function (u) { return u.kind === 'team'; });
  assert.strictEqual(team.length, 2, 'exactly two team ultimates, one per end of the floor');
  assert.strictEqual(team.filter(function (u) { return u.side === 'offense'; }).length, 1);
  assert.strictEqual(team.filter(function (u) { return u.side === 'defense'; }).length, 1);
  console.log('checkTaxonomyShape: OK');
}

// The synthetic tests above prove each ultimate CAN be derived. They do not
// prove anybody actually gets one, and that is exactly the gap that hid a real
// defect: with the first three normalisers, Paint Beast was reachable in theory
// and held by NOBODY in the league, while Cold Blooded, And-One and Motor Never
// Stops captured every elite big. Reachability and holdership are different
// claims and both need asserting.
function leaguePlayers() {
  require(path.join(ROOT, 'teams.js'));
  const traits = require(path.join(ROOT, 'traits.js'));
  require(path.join(ROOT, 'scouting.js'));
  const players = require(path.join(ROOT, 'players-2026.js')).PLAYERS_2026;
  traits.ensureHiddenPlayerData(players);
  return players;
}

function holdingsByUltimate() {
  const by = {};
  leaguePlayers().forEach(function (p) {
    if (!ult.hasUltimate(p)) return;
    const u = ult.ultimateFor(p);
    by[u.key] = (by[u.key] || 0) + 1;
  });
  return by;
}

function checkHolderCountBand() {
  const holders = leaguePlayers().filter(function (p) { return ult.hasUltimate(p); });
  assert.ok(holders.length >= 30 && holders.length <= 60,
    'holders league-wide is ' + holders.length + ', outside the 30-60 band');
  console.log('checkHolderCountBand: OK (' + holders.length + ' holders)');
}

function checkEveryUltimateIsHeldInTheLeague() {
  const by = holdingsByUltimate();
  const unheld = ult.ULTIMATE_TAXONOMY
    .filter(function (u) { return !by[u.key]; })
    .map(function (u) { return u.key; });
  assert.strictEqual(unheld.length, 0,
    'nobody in the league holds: ' + unheld.join(', ') +
    ' — an ultimate the reference page prints and the league never grants');
  console.log('checkEveryUltimateIsHeldInTheLeague: OK (all 12 held)');
}

// One ultimate soaking up the elite is the same defect wearing a different hat:
// it means the derivation is measuring "is this player good" rather than "what
// is he best at".
function checkNoUltimateDominates() {
  const by = holdingsByUltimate();
  const total = Object.keys(by).reduce(function (s, k) { return s + by[k]; }, 0);
  const worst = Object.keys(by).reduce(function (m, k) { return by[k] > by[m] ? k : m; }, Object.keys(by)[0]);
  const share = by[worst] / total;
  assert.ok(share <= 0.40, worst + ' holds ' + (100 * share).toFixed(0) +
    '% of all ultimates — the derivation is measuring quality, not distinctiveness');
  console.log('checkNoUltimateDominates: OK (largest share ' + worst + ' at ' +
    (100 * share).toFixed(0) + '%)');
}

checkGate();
checkGateUsesDisplayOverall();
checkEveryUltimateIsReachable();
checkDerivationIsDeterministic();
checkBadgeBoost();
checkTaxonomyShape();
checkHolderCountBand();
checkEveryUltimateIsHeldInTheLeague();
checkNoUltimateDominates();
console.log('validate-ultimates: ALL OK');
