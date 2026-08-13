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

const CT = ult.CHARGE_TUNING;

function checkGainsAndDrains() {
  const flat = 1;   // neutral situation, so this tests the play values alone
  ult.PLAY_KINDS.forEach(function (kind) {
    const v = ult.chargeGain('heatCheck', kind, flat);
    assert.strictEqual(typeof v, 'number', kind + ' must produce a number');
    assert.ok(!isNaN(v), kind + ' produced NaN');
  });
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > 0, 'a made three fills');
  assert.ok(ult.chargeGain('heatCheck', 'turnover', flat) < 0, 'a turnover drains');
  assert.ok(ult.chargeGain('heatCheck', 'missedShot', flat) < 0, 'a miss drains');
  assert.ok(ult.chargeGain('heatCheck', 'foul', flat) < 0, 'a foul drains');
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > ult.chargeGain('heatCheck', 'madeTwo', flat),
    'a made three is worth more than a made two');
  assert.strictEqual(ult.chargeGain('heatCheck', 'notAPlayKind', flat), 0,
    'an unknown play kind earns nothing rather than throwing');
  console.log('checkGainsAndDrains: OK');
}

// A drain must not shrink in a blowout. If the situation scaled both sides, a
// star could pad his meter in garbage time at no risk, which is the opposite of
// what the multiplier is for.
function checkDrainsIgnoreTheSituation() {
  const close = ult.situationMultiplier('heatCheck', 0, 4);
  const blowout = ult.situationMultiplier('heatCheck', 30, 1);
  assert.ok(close > blowout, 'fixture is wrong: a close fourth must out-multiply a blowout');
  assert.strictEqual(ult.chargeGain('heatCheck', 'turnover', close),
    ult.chargeGain('heatCheck', 'turnover', blowout),
    'a turnover costs the same whatever the score');
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', close) >
    ult.chargeGain('heatCheck', 'madeThree', blowout),
    'but a made three is worth more in a close fourth');
  console.log('checkDrainsIgnoreTheSituation: OK');
}

function checkAffinity() {
  // The same play is worth more to the ultimate it belongs to. This is what
  // makes Glass Wrecker charge off boards instead of off scoring.
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', 1) > ult.chargeGain('glassWrecker', 'madeThree', 1),
    'a three charges Heat Check faster than Glass Wrecker');
  assert.ok(ult.chargeGain('glassWrecker', 'rebound', 1) > ult.chargeGain('heatCheck', 'rebound', 1),
    'a board charges Glass Wrecker faster than Heat Check');
  // Every ultimate needs a currency, or it charges at the same flat rate as a
  // player with no ultimate at all.
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const aff = ult.CHARGE_AFFINITY[u.key];
    assert.ok(aff && aff.length, u.key + ' has no charge affinity — it would fill generically');
    aff.forEach(function (k) {
      assert.ok(ult.PLAY_KINDS.indexOf(k) !== -1, u.key + ' charges on unknown play kind ' + k);
      assert.ok(CT.gains[k] > 0, u.key + ' charges on ' + k + ', which is a DRAIN');
    });
  });
  console.log('checkAffinity: OK');
}

function checkSituation() {
  const level = ult.situationMultiplier('heatCheck', 0, 1);
  assert.ok(ult.situationMultiplier('heatCheck', 0, 4) > level, 'the fourth quarter is worth more');
  assert.ok(ult.situationMultiplier('heatCheck', 0, 5) > ult.situationMultiplier('heatCheck', 0, 4),
    'overtime is worth more than the fourth');
  // Compared at the SAME margin, so this tests trailing and not closeness.
  assert.ok(ult.situationMultiplier('heatCheck', -6, 1) > ult.situationMultiplier('heatCheck', 6, 1),
    'trailing by six is worth more than leading by six');
  assert.ok(ult.situationMultiplier('heatCheck', 30, 1) < level, 'a blowout is worth less');
  console.log('checkSituation: OK');
}

// Cold Blooded is the whole reason the situation multiplier takes the ultimate
// as an argument rather than just the game state.
function checkColdBloodedIgnoresEarlyGame() {
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 1), 0, 'Q1 earns nothing');
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 3), 0, 'Q3 earns nothing');
  assert.ok(ult.situationMultiplier('coldBlooded', 0, 4) > 0, 'the fourth earns');
  assert.ok(ult.situationMultiplier('coldBlooded', 25, 4) < ult.situationMultiplier('coldBlooded', 0, 4),
    'and only really when the game is close');
  // No other ultimate may be late-game-only by accident.
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    if (u.key === 'coldBlooded') return;
    assert.ok(ult.situationMultiplier(u.key, 0, 1) > 0, u.key + ' must charge in the first quarter');
  });
  console.log('checkColdBloodedIgnoresEarlyGame: OK');
}

function checkThresholdRises() {
  const first = ult.chargeThreshold(0);
  const second = ult.chargeThreshold(1);
  assert.strictEqual(first, CT.full, 'the first takeover costs a full meter');
  assert.ok(second > first, 'a second takeover must cost more than the first');
  assert.ok(ult.chargeThreshold(2) > second, 'and a third more than the second');
  console.log('checkThresholdRises: OK (' + first + ' then ' + second.toFixed(0) + ')');
}

function checkTakeoverLength() {
  const normal = ult.takeoverLength('heatCheck');
  assert.strictEqual(normal, CT.takeoverPossessions);
  assert.ok(ult.takeoverLength('motorNeverStops') > normal * 2,
    'Motor Never Stops runs at least twice as long — attrition is its whole idea');
  console.log('checkTakeoverLength: OK');
}

checkGate();
checkGateUsesDisplayOverall();
checkEveryUltimateIsReachable();
checkDerivationIsDeterministic();
checkBadgeBoost();
checkTaxonomyShape();
// The engine reports plays; ultimates.js prices them. If the engine ever
// reports a kind the pricing table does not know, that player's meter silently
// stops filling for the rest of the game — so the two lists are asserted to
// agree STATICALLY, by reading the engine's source, rather than by hoping a
// simulated game happens to hit every branch.
function checkEngineReportsOnlyKnownPlayKinds() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'simEnginePossession.js'), 'utf8');
  const reported = [];
  const re = /reportPlay\([^,]+,\s*[^,]+,\s*'([a-zA-Z]+)'\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) { if (reported.indexOf(m[1]) === -1) reported.push(m[1]); }
  assert.ok(reported.length > 0, 'no reportPlay call sites found — the report is not wired in');
  reported.forEach(function (kind) {
    assert.ok(ult.PLAY_KINDS.indexOf(kind) !== -1,
      'the engine reports "' + kind + '", which ultimates.js prices at nothing');
  });
  // And the reverse: a priced kind nobody reports is dead tuning.
  ult.PLAY_KINDS.forEach(function (kind) {
    assert.ok(reported.indexOf(kind) !== -1,
      'ultimates.js prices "' + kind + '" but the engine never reports it');
  });
  console.log('checkEngineReportsOnlyKnownPlayKinds: OK (' + reported.length + ' kinds)');
}

function checkBoxLineCarriesMeterState() {
  const poss = require(path.join(ROOT, 'simEnginePossession.js'));
  const line = poss.initBoxLine();
  ['charge', 'takeoverLeft', 'takeoversUsed', 'takeoverPoints', 'takeoverPointsAt']
    .forEach(function (f) {
      assert.strictEqual(line[f], 0, 'a fresh box line must start with ' + f + ' at 0');
    });
  console.log('checkBoxLineCarriesMeterState: OK');
}

function checkEveryUltimateTurnsSomething() {
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    const dials = Object.keys(eff);
    assert.ok(dials.length > 0, u.key + ' turns no dials — its takeover would do nothing');
    dials.forEach(function (d) {
      assert.ok(ult.DIAL_NAMES.indexOf(d) !== -1,
        u.key + ' turns unknown dial "' + d + '" — the engine will never read it');
    });
  });
  console.log('checkEveryUltimateTurnsSomething: OK');
}

function checkBadgeBoostScalesTheEffect() {
  const plain = ult.takeoverEffect('heatCheck', 1);
  const boosted = ult.takeoverEffect('heatCheck', ult.ULTIMATE_TUNING.badgeBoost);
  assert.ok(boosted.makeThree > plain.makeThree, 'a matching badge makes the takeover stronger');
  assert.ok(boosted.shotShare > plain.shotShare, 'including the multiplier dials');
  // A multiplier must scale from 1, not from 0 — otherwise a 35% boost on a
  // 2.4x share becomes 3.24x, which is a 60% boost.
  assert.ok(boosted.shotShare < plain.shotShare * ult.ULTIMATE_TUNING.badgeBoost,
    'multiplier dials scale from 1, not from 0');
  // energyDrain is a fraction where LOWER is stronger; boosting it upward would
  // turn a legendary badge into a penalty.
  const motorPlain = ult.takeoverEffect('motorNeverStops', 1);
  const motorBoost = ult.takeoverEffect('motorNeverStops', ult.ULTIMATE_TUNING.badgeBoost);
  assert.ok(motorBoost.energyDrain <= motorPlain.energyDrain,
    'a badge must never make Motor Never Stops tire FASTER');
  console.log('checkBadgeBoostScalesTheEffect: OK');
}

// Team ultimates are multiplied by five, so their per-player magnitude must be
// smaller than any solo one.
function checkTeamEffectsAreSmallerPerPlayer() {
  const solo = ult.takeoverEffect('heatCheck', 1).makeThree;
  const team = ult.takeoverEffect('floorGeneral', 1).teamMake;
  assert.ok(team < solo, 'a team ultimate lifts each player less than a solo one lifts its holder');
  console.log('checkTeamEffectsAreSmallerPerPlayer: OK');
}

// Motor Never Stops earns its points by attrition. If it ever gains a shooting
// bonus it stops being the odd one out and becomes a twelfth accuracy boost.
function checkMotorTouchesNoShootingProbability() {
  const eff = ult.takeoverEffect('motorNeverStops', 1);
  ['makeThree', 'makeMid', 'makeInside', 'makeFt', 'teamMake', 'shotShare'].forEach(function (d) {
    assert.strictEqual(eff[d], undefined, 'Motor Never Stops must not turn ' + d);
  });
  assert.ok(eff.energyDrain !== undefined, 'Motor Never Stops must turn energyDrain');
  console.log('checkMotorTouchesNoShootingProbability: OK');
}

// weightedPick caps any one player at PICK_CEILING.shooter. A usage boost that
// does not lift that ceiling saturates silently and the points band is
// unreachable however the rest is tuned.
function checkUsageUltimatesLiftTheCeiling() {
  const ENGINE_CEILING = 0.50;
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    if (!eff.shotShare) return;
    assert.ok(eff.shotShare > 1, u.key + ' has a shotShare that does not raise anything');
    assert.ok(eff.shotCeiling > ENGINE_CEILING,
      u.key + ' raises shot share but not the ceiling — the boost would saturate');
  });
  console.log('checkUsageUltimatesLiftTheCeiling: OK');
}

// A zone bias on a shot the ultimate does not improve sends the holder to a
// spot he is no better from, which lowers his efficiency during his own
// takeover.
function checkZoneBiasMatchesTheMakeBonus() {
  const ZONE_DIAL = { three: 'makeThree', mid: 'makeMid', inside: 'makeInside' };
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    if (!eff.zoneBias) return;
    Object.keys(eff.zoneBias).forEach(function (zone) {
      assert.ok(eff[ZONE_DIAL[zone]] > 0,
        u.key + ' biases shots to ' + zone + ' without improving ' + ZONE_DIAL[zone]);
    });
  });
  console.log('checkZoneBiasMatchesTheMakeBonus: OK');
}

function checkUnknownUltimateIsInert() {
  assert.deepStrictEqual(ult.takeoverEffect('notAnUltimate', 1), {},
    'an unknown key returns no dials rather than throwing');
  console.log('checkUnknownUltimateIsInert: OK');
}

checkGainsAndDrains();
checkDrainsIgnoreTheSituation();
checkAffinity();
checkSituation();
checkColdBloodedIgnoresEarlyGame();
checkThresholdRises();
checkTakeoverLength();
checkEngineReportsOnlyKnownPlayKinds();
checkBoxLineCarriesMeterState();
checkEveryUltimateTurnsSomething();
checkBadgeBoostScalesTheEffect();
checkTeamEffectsAreSmallerPerPlayer();
checkMotorTouchesNoShootingProbability();
checkUsageUltimatesLiftTheCeiling();
checkZoneBiasMatchesTheMakeBonus();
checkUnknownUltimateIsInert();
checkHolderCountBand();
checkEveryUltimateIsHeldInTheLeague();
checkNoUltimateDominates();
console.log('validate-ultimates: ALL OK');
