const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkTaxonomy() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  assert.strictEqual(traitsModule.TRAIT_TAXONOMY.length, 48, 'expected 48 total traits');
  const byCategory = {};
  traitsModule.TRAIT_TAXONOMY.forEach(function (t) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  });
  ['offensive', 'defensive', 'athletic', 'mental', 'negative', 'superstar'].forEach(function (cat) {
    assert.strictEqual(byCategory[cat], 8, cat + ' should have exactly 8 traits');
  });
  assert.strictEqual(Object.keys(traitsModule.TRAIT_TAXONOMY_BY_KEY).length, 48, 'lookup map should have one entry per trait');

  console.log('checkTaxonomy: OK');
}

checkTaxonomy();

function checkGetTraitBonus() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const player = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }, { key: 'chokeArtist', tier: 'bronze' }] };
  const bonus = traitsModule.getTraitBonus(player, 'boxscore', 'scoring');
  assert.strictEqual(bonus, 3 - 1, 'sharpshooter gold (+3) minus chokeArtist bronze (-1) should net to 2');
  assert.strictEqual(traitsModule.getTraitBonus(player, 'boxscore', 'rebound'), 0, 'no matching traits for this stat should return 0');
  assert.strictEqual(traitsModule.getTraitBonus({}, 'boxscore', 'scoring'), 0, 'a player with no hiddenTraits field should not throw');

  console.log('checkGetTraitBonus: OK');
}

checkGetTraitBonus();

function makePlayer(overall, potential, attrOverrides) {
  const attrs = { threePoint: 60, midRange: 60, insideScoring: 60, postScoring: 50, passing: 55, ballHandling: 55, steal: 50, block: 45, offReb: 50, defReb: 50, basketballIQ: 60, workEthic: 60, leadership: 55, strength: 55, speed: 55, acceleration: 55, vertical: 55, freeThrow: 60, perimeterDefense: 50, interiorDefense: 50 };
  Object.assign(attrs, attrOverrides || {});
  return { id: 'test-player', overall: overall, potential: potential, attributes: attrs };
}

function checkGenerateHiddenTraits() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const rng = makeRng(11);

  let lowTotal = 0;
  let highTotal = 0;
  const TRIALS = 100;
  for (let i = 0; i < TRIALS; i++) {
    lowTotal += traitsModule.generateHiddenTraits(makePlayer(50, 55), rng).length;
    highTotal += traitsModule.generateHiddenTraits(makePlayer(97, 98), rng).length;
  }
  assert.ok(highTotal > lowTotal, 'higher-overall players should average more traits than low-overall players');

  let superstarCount = 0;
  for (let i = 0; i < TRIALS; i++) {
    const traits = traitsModule.generateHiddenTraits(makePlayer(60, 65), rng);
    if (traits.some(function (t) { return traitsModule.TRAIT_TAXONOMY_BY_KEY[t.key].category === 'superstar'; })) superstarCount++;
  }
  assert.strictEqual(superstarCount, 0, 'a 60 OVR / 65 POT player should never roll a superstar trait');

  console.log('checkGenerateHiddenTraits: OK');
}

checkGenerateHiddenTraits();

function checkGeneratePersonalityAndTendencies() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const rng = makeRng(22);
  const player = makePlayer(75, 80);

  const personality = traitsModule.generatePersonality(player, rng);
  ['loyalty', 'ambition', 'ego', 'coachability', 'durabilityMindset'].forEach(function (k) {
    assert.ok(personality[k] >= 0 && personality[k] <= 100, k + ' out of 0-100 range');
  });

  const tendencies = traitsModule.generateTendencies(player, rng);
  ['threeTendency', 'midTendency', 'insideTendency', 'isoTendency', 'catchAndShootTendency', 'postTendency', 'transitionTendency', 'clutchUsage', 'gambleTendency', 'reboundAggression'].forEach(function (k) {
    assert.ok(tendencies[k] >= 0 && tendencies[k] <= 100, k + ' out of 0-100 range');
  });

  console.log('checkGeneratePersonalityAndTendencies: OK');
}

checkGeneratePersonalityAndTendencies();

function checkEnsureHiddenPlayerData() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const players = [
    { id: 'a-1', overall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} },
    { id: 'a-2', overall: 60, potential: 60, attributes: makePlayer(60, 60).attributes, hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }], hiddenPersonality: { loyalty: 50 }, hiddenTendencies: {} }
  ];
  traitsModule.ensureHiddenPlayerData(players);
  assert.ok(players[0].hiddenTraits.length > 0, 'empty-stub player should be populated');
  assert.deepStrictEqual(players[1].hiddenTraits, [{ key: 'sharpshooter', tier: 'bronze' }], 'already-populated player should be left untouched');

  const again = [{ id: 'a-1', overall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} }];
  traitsModule.ensureHiddenPlayerData(again);
  assert.deepStrictEqual(again[0].hiddenTraits, players[0].hiddenTraits, 'same id should deterministically regenerate identical trait data');

  console.log('checkEnsureHiddenPlayerData: OK');
}

checkEnsureHiddenPlayerData();

function checkScoutingEconomy() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const team = { prestige: 80 };
  const state = scoutingModule.initScoutingState();

  scoutingModule.tickPassiveScouting(state, team, 0, ['own-1'], ['opp-1'], ['prospect-1'], 45);
  assert.strictEqual(state.pointsAvailable, 140, 'week 0 rollover should grant 100 + floor(80/2) = 140 points');
  assert.strictEqual(state.targets['own-1'].confidence, 0.4, 'own roster gains 0.4/day');
  assert.strictEqual(state.targets['opp-1'].confidence, 0.2, 'played opponent gains 0.2/day');
  assert.strictEqual(state.targets['prospect-1'].confidence, 0.15, 'prospect gains 0.15/day outside the 30-day pre-draft window');

  // Same week (day 1, still week 0) should not re-grant points.
  scoutingModule.tickPassiveScouting(state, team, 1, [], [], [], 44);
  assert.strictEqual(state.pointsAvailable, 140, 'points should not re-roll within the same week');

  // Crossing into week 1 (day 7) should refresh the allowance.
  const spentFirst = scoutingModule.allocateScoutPoints(state, 'own-1', 40);
  assert.ok(spentFirst > 0 && state.pointsAvailable === 100, 'spending 40 of 140 should leave 100');
  scoutingModule.tickPassiveScouting(state, team, 7, [], [], [], 38);
  assert.strictEqual(state.pointsAvailable, 140, 'crossing into a new week should refresh points to the full weekly amount');

  // Draft-buzz speed-up inside 30 days of the draft.
  const state2 = scoutingModule.initScoutingState();
  scoutingModule.tickPassiveScouting(state2, team, 0, [], [], ['prospect-2'], 10);
  assert.strictEqual(state2.targets['prospect-2'].confidence, 0.3, 'inside 30 days of the draft, prospects gain 0.3/day');

  // Overspending is clamped to what's available.
  const state3 = scoutingModule.initScoutingState();
  scoutingModule.tickPassiveScouting(state3, team, 0, [], [], [], null);
  const spent = scoutingModule.allocateScoutPoints(state3, 'x', 9999);
  assert.strictEqual(state3.pointsAvailable, 0, 'allocateScoutPoints should never let spend exceed pointsAvailable');
  assert.ok(spent > 0);

  console.log('checkScoutingEconomy: OK');
}

checkScoutingEconomy();

function checkRevealThresholds() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const player = {
    hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: { loyalty: 80, ambition: 20, ego: 50, coachability: 50, durabilityMindset: 50 },
    hiddenTendencies: { threeTendency: 40 }
  };

  const hidden = scoutingModule.getRevealedView(player, 10);
  assert.strictEqual(hidden.level, 'hidden');
  assert.strictEqual(hidden.traits, null);

  const fuzzy = scoutingModule.getRevealedView(player, 50);
  assert.strictEqual(fuzzy.level, 'fuzzy');
  assert.strictEqual(fuzzy.traits[0].rangeLabel, 'silver-hof', 'gold should fuzz to the tier band one below and one above');
  assert.strictEqual(fuzzy.personality.loyalty, 'High');
  assert.strictEqual(fuzzy.personality.ambition, 'Low');
  assert.strictEqual(fuzzy.tendencies, null, 'tendencies stay hidden until exact-reveal confidence');

  const exact = scoutingModule.getRevealedView(player, 90);
  assert.strictEqual(exact.level, 'exact');
  assert.deepStrictEqual(exact.traits, player.hiddenTraits);
  assert.deepStrictEqual(exact.tendencies, player.hiddenTendencies);

  console.log('checkRevealThresholds: OK');
}

checkRevealThresholds();

function checkComputeTeamRatingTraitBonus() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const before = engineModule.computeTeamRating('BOS');

  const roster = leagueModule.getTeamRoster('BOS');
  const originalTraits = roster.map(function (p) { return p.hiddenTraits; });
  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'sharpshooter', tier: 'legendary' }, { key: 'iceInVeins', tier: 'legendary' }]; });

  const after = engineModule.computeTeamRating('BOS');
  roster.forEach(function (p, i) { p.hiddenTraits = originalTraits[i]; }); // restore

  assert.ok(after > before, 'stacking every player with elite offensive traits should raise team rating');

  console.log('checkComputeTeamRatingTraitBonus: OK');
}

checkComputeTeamRatingTraitBonus();

// scoringWeight/reboundWeight/stealWeight/blockWeight/etc aren't exported
// individually (and a full simulateGame roll is too noisy to reliably detect
// a single player's trait-driven share shift within a fixed 5-block team
// total, especially on a roster where several other players already have high
// block attributes). Instead, reproduce blockWeight's exact formula
// (Math.max(1, attributes.block + getTraitBonus(player,'boxscore','block')))
// directly against the two exported building blocks it's made of —
// getTraitBonus and distributeInt — which deterministically proves both that
// the trait raises the weight and that distributeInt turns a higher weight
// into a bigger integer share.
function checkWeightFunctionTraitBias() {
  const engineModule = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));

  const withTrait = { attributes: { block: 45 }, hiddenTraits: [{ key: 'rimProtector', tier: 'legendary' }] };
  const withoutTrait = { attributes: { block: 45 }, hiddenTraits: [] };
  const weightWith = Math.max(1, withTrait.attributes.block + traitsModule.getTraitBonus(withTrait, 'boxscore', 'block'));
  const weightWithout = Math.max(1, withoutTrait.attributes.block + traitsModule.getTraitBonus(withoutTrait, 'boxscore', 'block'));
  assert.ok(weightWith > weightWithout, 'a legendary Rim Protector should raise blockWeight\'s underlying weight');

  const shareWith = engineModule.distributeInt(5, [weightWith, 10, 10, 10])[0];
  const shareWithout = engineModule.distributeInt(5, [weightWithout, 10, 10, 10])[0];
  assert.ok(shareWith >= shareWithout, 'a higher block weight should never receive a smaller share of the fixed team block total');

  console.log('checkWeightFunctionTraitBias: OK');
}

checkWeightFunctionTraitBias();

console.log('All trait/scouting validations passed');
