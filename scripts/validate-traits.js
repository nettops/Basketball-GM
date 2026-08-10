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
  return { id: 'test-player', overall: overall, rawOverall: overall, potential: potential, attributes: attrs };
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
    { id: 'a-1', overall: 80, rawOverall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} },
    { id: 'a-2', overall: 60, rawOverall: 60, potential: 60, attributes: makePlayer(60, 60).attributes, hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }], hiddenPersonality: { loyalty: 50 }, hiddenTendencies: {} }
  ];
  traitsModule.ensureHiddenPlayerData(players);
  assert.ok(players[0].hiddenTraits.length > 0, 'empty-stub player should be populated');
  assert.deepStrictEqual(players[1].hiddenTraits, [{ key: 'sharpshooter', tier: 'bronze' }], 'already-populated player should be left untouched');

  const again = [{ id: 'a-1', overall: 80, rawOverall: 80, potential: 85, attributes: makePlayer(80, 85).attributes, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {} }];
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

  // The 30%/70% thresholds still govern PERSONALITY and TENDENCIES — that is
  // what scouting buys now. Badges left the gate for rostered players, so the
  // badge expectations below changed while the threshold behaviour did not.
  const unscouted = scoutingModule.getRevealedView(player, 10);
  assert.strictEqual(unscouted.level, 'hidden', 'level describes PERSONALITY reveal, not badges');
  assert.strictEqual(unscouted.traitsAreFuzzy, false, 'a rostered player\'s badges are never fuzzed');
  assert.deepStrictEqual(unscouted.traits, player.hiddenTraits,
    'a rostered player shows badges at any confidence');
  assert.strictEqual(unscouted.personality, null, 'personality stays gated below 30%');
  assert.strictEqual(unscouted.tendencies, null);

  const fuzzy = scoutingModule.getRevealedView(player, 50);
  assert.strictEqual(fuzzy.level, 'fuzzy');
  assert.deepStrictEqual(fuzzy.traits, player.hiddenTraits, 'badges stay exact for a rostered player');
  assert.strictEqual(fuzzy.personality.loyalty, 'High');
  assert.strictEqual(fuzzy.personality.ambition, 'Low');
  assert.strictEqual(fuzzy.tendencies, null, 'tendencies stay hidden until exact-reveal confidence');

  const exact = scoutingModule.getRevealedView(player, 90);
  assert.strictEqual(exact.level, 'exact');
  assert.deepStrictEqual(exact.traits, player.hiddenTraits);
  assert.deepStrictEqual(exact.tendencies, player.hiddenTendencies);

  // The tier-band fuzzing this check used to cover for everyone now lives on
  // the PROSPECT path, so it is asserted there rather than dropped.
  const prospect = scoutingModule.getRevealedView(player, 50, true);
  assert.strictEqual(prospect.traits[0].rangeLabel, 'silver-hof',
    'gold should fuzz to the tier band one below and one above');

  // EVERY combination must be internally consistent: whenever level claims
  // personality is available, it must actually be there. This is the invariant
  // the two-field split exists to protect, checked across the whole matrix
  // rather than at the one confidence a test happened to pick.
  [0, 10, 29, 30, 50, 69, 70, 100].forEach(function (c) {
    [false, true].forEach(function (isProspect) {
      const v = scoutingModule.getRevealedView(player, c, isProspect);
      if (v.level === 'hidden') assert.strictEqual(v.personality, null, 'hidden must carry no personality at ' + c);
      else assert.ok(v.personality, 'level ' + v.level + ' promises personality at ' + c + ' and must carry one');
      if (v.level === 'exact') assert.ok(v.tendencies, 'exact must carry tendencies at ' + c);
      else assert.strictEqual(v.tendencies, null, 'only exact reveals tendencies (' + c + ')');
      assert.ok(Array.isArray(v.traits), 'badges are never null now, at any confidence');
      assert.strictEqual(v.traitsAreFuzzy, isProspect, 'badge fuzziness tracks prospect status, not confidence');
    });
  });

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

// Player identity in real basketball lives in shot SELECTION, not accuracy.
// Measured from reference/zengm/data/real-player-stats.basketball.json (2025,
// min 300 FGA): per-player 3PA share ran 4.5% to 71.6%, a 67-point spread,
// while true 3P% talent spanned about 14. Ours ran 12.7 points at the plan's
// baseline — the ratio was inverted, and superstars separated themselves by
// efficiency instead of by what shot they chose to take.
function checkShotMixSeparatesPlayers() {
  const playersMod = require(path.join(__dirname, '..', 'players-2026.js'));
  const roster = playersMod.PLAYERS_2026;
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(roster);
  const shares = roster.map(function (p) { return p.hiddenTendencies.threeTendency; })
    .sort(function (a, b) { return a - b; });
  const p05 = shares[Math.floor(0.05 * shares.length)];
  const p95 = shares[Math.floor(0.95 * shares.length)];
  assert.ok(p95 - p05 >= 40,
    'three-point tendency should span at least 40 points p05-p95, got ' +
    p05 + '% - ' + p95 + '% (' + (p95 - p05) + ')');
  assert.ok(p05 <= 15, 'the least willing shooter in the league should be under 15%, got ' + p05);
  assert.ok(p95 >= 55, 'the most willing should be over 55%, got ' + p95);
  console.log('checkShotMixSeparatesPlayers: OK (' + p05 + '% - ' + p95 + '%, spread ' + (p95 - p05) + ')');
}

// The amplifier must not break the invariant pickShotZone relies on.
function checkTendenciesStillSumToOneHundred() {
  const playersMod = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(playersMod.PLAYERS_2026);
  playersMod.PLAYERS_2026.forEach(function (p) {
    const t = p.hiddenTendencies;
    const sum = t.threeTendency + t.midTendency + t.insideTendency;
    assert.strictEqual(sum, 100,
      'shot tendencies must sum to exactly 100 for ' + p.id + ', got ' + sum);
    [t.threeTendency, t.midTendency, t.insideTendency].forEach(function (v) {
      assert.ok(v >= 0 && v <= 100, 'tendency out of range for ' + p.id + ': ' + v);
    });
  });
  console.log('checkTendenciesStillSumToOneHundred: OK');
}

// Trait GENERATION keys off `overall`, so it moved when overall was rescaled
// and nothing noticed. Left alone, `(overall - 45) / 9` gave 86% of the league
// exactly one trait where the median player used to carry three, and the tier
// mix inverted — legendary 25% -> 6%, bronze 15% -> 38%. The trait system was
// gutted by a change that never touched this file.
//
// Pinned as a DISTRIBUTION rather than exact counts: this must catch the system
// being hollowed out, not fail on ordinary variation in a seeded roster.
function checkTraitGenerationSurvivesTheRatingScale() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const playersMod = require(path.join(__dirname, '..', 'players-2026.js'));
  const roster = playersMod.PLAYERS_2026;
  traitsModule.ensureHiddenPlayerData(roster);

  let total = 0;
  const tiers = {};
  roster.forEach(function (p) {
    total += p.hiddenTraits.length;
    p.hiddenTraits.forEach(function (t) { tiers[t.tier] = (tiers[t.tier] || 0) + 1; });
  });
  const perPlayer = total / roster.length;
  assert.ok(perPlayer >= 2.5 && perPlayer <= 4.0,
    'the league should average 2.5-4 traits per player (3.28 before the rescale), got ' + perPlayer.toFixed(2));

  // Every tier has to be reachable. A ladder whose top rung is never rolled is
  // a feature nobody ever sees.
  traitsModule.TRAIT_TIERS.forEach(function (tier) {
    const share = (tiers[tier] || 0) / total;
    assert.ok(share >= 0.05,
      'tier "' + tier + '" is only ' + (100 * share).toFixed(1) + '% of rolled traits — effectively unreachable');
  });
  const topHeavy = (tiers.legendary || 0) / total;
  assert.ok(topHeavy <= 0.35,
    'legendary traits are ' + (100 * topHeavy).toFixed(1) + '% of all rolls — the ladder has collapsed upward');
  console.log('checkTraitGenerationSurvivesTheRatingScale: OK (' + perPlayer.toFixed(2) + '/player, ' +
    traitsModule.TRAIT_TIERS.map(function (t) {
      return t.slice(0, 2) + ' ' + (100 * (tiers[t] || 0) / total).toFixed(0) + '%';
    }).join(' ') + ')');
}

// The tier VALUES, checked where they actually land: the share of events a
// player wins in weightedPick. This is the assertion that was missing when
// minutesWeight silently made a legendary usage trait worth 103% of a median
// player's entire weight.
//
// Measured on five players at the league's real scoringWeight spread, the
// ladder runs +2.6% / +5.1% / +7.6% / +12.7% / +20.2% relative pick share. The
// values themselves did NOT need rescaling — the apparent over-strength was an
// artifact of broken generation concentrating traits on very few players.
function checkTraitTierLadderIsMeaningfulButNotDominant() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const dataMod = require(path.join(__dirname, '..', 'data.js'));
  const playersMod = require(path.join(__dirname, '..', 'players-2026.js'));
  const box = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));

  const weights = playersMod.PLAYERS_2026.map(function (p) {
    const a = p.attributes;
    return (a.insideScoring + a.midRange + a.threePoint + a.postScoring) / 4;
  }).sort(function (x, y) { return x - y; });
  const at = function (f) { return weights[Math.floor(f * weights.length)]; };
  const five = [at(0.9), at(0.7), at(0.5), at(0.3), at(0.1)];

  // Mirrors weightedPick's normalisation (power + 5% floor).
  const POWER = 1.4, FLOOR = 0.05;
  function share(ws, i) {
    let p = ws.map(function (x) { return Math.pow(Math.max(0, x), POWER); });
    const raw = p.reduce(function (a, b) { return a + b; }, 0);
    const floor = FLOOR * raw;
    p = p.map(function (x) { return Math.max(x, floor); });
    const tot = p.reduce(function (a, b) { return a + b; }, 0);
    return p[i] / tot;
  }
  const base = share(five, 2);
  let last = 0;
  traitsModule.TRAIT_TIERS.forEach(function (tier) {
    const bonus = Math.abs(traitsModule.TRAIT_TIER_SCALE[tier]);
    const mod = five.slice();
    mod[2] = five[2] + bonus;
    const gain = share(mod, 2) / base - 1;
    assert.ok(gain > last,
      'tier "' + tier + '" must be worth strictly more than the one below it');
    last = gain;
  });
  const top = share((function () { const m = five.slice(); m[2] = five[2] + traitsModule.TRAIT_TIER_SCALE.legendary; return m; })(), 2) / base - 1;
  assert.ok(top >= 0.08 && top <= 0.45,
    'a legendary trait should shift pick share 8-45%, got ' + (100 * top).toFixed(1) +
    '% — below that it is invisible, above it the trait outweighs the ratings it modifies');
  const bottom = share((function () { const m = five.slice(); m[2] = five[2] + traitsModule.TRAIT_TIER_SCALE.bronze; return m; })(), 2) / base - 1;
  assert.ok(bottom >= 0.005,
    'even a bronze trait has to do something measurable, got ' + (100 * bottom).toFixed(2) + '%');
  console.log('checkTraitTierLadderIsMeaningfulButNotDominant: OK (bronze +' +
    (100 * bottom).toFixed(1) + '%, legendary +' + (100 * top).toFixed(1) + '% pick share)');
}

// A scoring trait used to affect only WHO SHOOTS, never whether the ball went
// in — shotMakeProbability took composites and synergy and no trait input at
// all. So a legendary Sharpshooter did not shoot threes better; he simply took
// about two more shots per 36 of his usual mix. The name promised something
// the sim never delivered.
//
// Routed by the trait's own `affinity` attribute rather than a new taxonomy
// field: threePoint -> threes, insideScoring/postScoring -> inside, freeThrow
// -> the line. Traits whose affinity has no shooting meaning (speed,
// leadership, basketballIQ, strength, vertical) stay volume-only, which is the
// right answer — Elite Speed earning you more shots is basketball, Elite Speed
// fixing your jumper is not.
function checkScoringTraitsChangeShotQuality() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const dataMod = require(path.join(__dirname, '..', 'data.js'));
  const attrs = {};
  dataMod.ATTRIBUTE_KEYS.forEach(function (k) { attrs[k] = 50; });
  const plain = { id: 'plain', attributes: attrs, hiddenTraits: [] };
  const shooter = { id: 'shot', attributes: attrs, hiddenTraits: [{ key: 'sharpshooter', tier: 'legendary' }] };
  const bigman = { id: 'big', attributes: attrs, hiddenTraits: [{ key: 'finisher', tier: 'legendary' }] };
  const streaky = { id: 'bad', attributes: attrs, hiddenTraits: [{ key: 'streaky', tier: 'legendary' }] };

  const q = traitsModule.shotQualityBonus;
  assert.ok(q(shooter, 'three') > 0, 'a Sharpshooter must shoot threes better');
  assert.strictEqual(q(shooter, 'inside'), 0, 'a Sharpshooter must NOT finish inside better');
  assert.strictEqual(q(shooter, 'mid'), 0, 'a Sharpshooter must not improve the mid-range either');
  assert.ok(q(bigman, 'inside') > 0, 'a Finisher must finish inside better');
  assert.strictEqual(q(bigman, 'three'), 0, 'a Finisher must NOT shoot threes better');
  assert.strictEqual(q(plain, 'three'), 0, 'a player with no scoring trait gets nothing');

  // A flaw in your shot shows up everywhere — negatives carry no affinity, so
  // routing them by zone would silently make them free.
  ['three', 'mid', 'inside'].forEach(function (z) {
    assert.ok(q(streaky, z) < 0, 'Streaky must hurt the ' + z + ' shot, not just the shot count');
  });

  // Tiers have to ladder here too, or every Sharpshooter shoots alike.
  let last = -Infinity;
  traitsModule.TRAIT_TIERS.forEach(function (tier) {
    const v = q({ attributes: attrs, hiddenTraits: [{ key: 'sharpshooter', tier: tier }] }, 'three');
    assert.ok(v > last, 'shot-quality bonus must increase with tier, stalled at ' + tier);
    last = v;
  });
  console.log('checkScoringTraitsChangeShotQuality: OK (legendary Sharpshooter +' +
    q(shooter, 'three').toFixed(1) + ' on threes, 0 elsewhere)');
}

checkShotMixSeparatesPlayers();
checkTendenciesStillSumToOneHundred();
checkScoringTraitsChangeShotQuality();
checkTraitGenerationSurvivesTheRatingScale();
checkTraitTierLadderIsMeaningfulButNotDominant();

function checkProgressionTraitIntegration() {
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const dataModule = require(path.join(__dirname, '..', 'data.js'));
  const rng = makeRng(33);

  // `overall` is derived from the attributes (ratings.js). A plain `overall: 70`
  // field would be a frozen literal that progressPlayer — which now only moves
  // attributes — can never change, so every trial would measure zero and this
  // check would compare 0 against 0.
  const ratingsModule = require(path.join(__dirname, '..', 'ratings.js'));
  function freshPlayer(overrides) {
    const p = { age: 22, yearsPro: 2, potential: 80, attributes: {} };
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 70; });
    Object.assign(p, overrides || {});
    return ratingsModule.defineOverall(p);
  }

  const coachable = freshPlayer({ hiddenTraits: [{ key: 'coachable', tier: 'legendary' }], hiddenPersonality: { coachability: 100 } });
  const stubborn = freshPlayer({ hiddenTraits: [{ key: 'stubborn', tier: 'legendary' }], hiddenPersonality: { coachability: 0 } });

  let coachableTotal = 0;
  let stubbornTotal = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const c = freshPlayer({ hiddenTraits: coachable.hiddenTraits, hiddenPersonality: coachable.hiddenPersonality });
    const s = freshPlayer({ hiddenTraits: stubborn.hiddenTraits, hiddenPersonality: stubborn.hiddenPersonality });
    const cBefore = c.overall;
    const sBefore = s.overall;
    progressionModule.progressPlayer(c, rng, []);
    progressionModule.progressPlayer(s, rng, []);
    coachableTotal += c.overall - cBefore;
    stubbornTotal += s.overall - sBefore;
  }
  assert.ok(coachableTotal > stubbornTotal, 'a legendary-Coachable/high-coachability player should out-develop a legendary-Stubborn/low-coachability player on average');

  // Mentor: a young player with a Mentor teammate should progress at least as
  // well on average as one without, all else equal.
  let withMentorTotal = 0;
  let withoutMentorTotal = 0;
  const mentorTeammate = freshPlayer({ hiddenTraits: [{ key: 'mentor', tier: 'legendary' }] });
  for (let i = 0; i < TRIALS; i++) {
    const young = freshPlayer({ age: 21, hiddenTraits: [], hiddenPersonality: undefined });
    const youngAlone = freshPlayer({ age: 21, hiddenTraits: [], hiddenPersonality: undefined });
    const beforeWith = young.overall;
    const beforeWithout = youngAlone.overall;
    progressionModule.progressPlayer(young, rng, [mentorTeammate]);
    progressionModule.progressPlayer(youngAlone, rng, []);
    withMentorTotal += young.overall - beforeWith;
    withoutMentorTotal += youngAlone.overall - beforeWithout;
  }
  assert.ok(withMentorTotal >= withoutMentorTotal, 'a legendary Mentor teammate should never hurt a young player\'s average development');

  console.log('checkProgressionTraitIntegration: OK');
}

checkProgressionTraitIntegration();

function checkInjuryFatigueTraitIntegration() {
  const injuriesModule = require(path.join(__dirname, '..', 'injuries.js'));
  const fatigueModule = require(path.join(__dirname, '..', 'fatigue.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));

  const roster = leagueModule.getTeamRoster('BOS');
  const target = roster[0];
  const originalTraits = target.hiddenTraits;
  const originalPersonality = target.hiddenPersonality;
  const originalStatus = target.status;

  // Iron Man + max durabilityMindset should roll injuries less often than
  // Injury Prone + min durabilityMindset, over many trials.
  const rng = makeRng(44);
  let ironManInjuries = 0;
  let injuryProneInjuries = 0;
  const TRIALS = 3000;
  for (let i = 0; i < TRIALS; i++) {
    target.status = { morale: 70, fatigue: 80, injury: null };
    target.hiddenTraits = [{ key: 'ironMan', tier: 'legendary' }];
    target.hiddenPersonality = { durabilityMindset: 100 };
    injuriesModule.rollInjury(target, rng);
    if (target.status.injury) ironManInjuries++;

    target.status = { morale: 70, fatigue: 80, injury: null };
    target.hiddenTraits = [{ key: 'injuryProne', tier: 'legendary' }];
    target.hiddenPersonality = { durabilityMindset: 0 };
    injuriesModule.rollInjury(target, rng);
    if (target.status.injury) injuryProneInjuries++;
  }
  assert.ok(injuryProneInjuries > ironManInjuries, 'Injury Prone + low durabilityMindset should roll more injuries than Iron Man + high durabilityMindset over ' + TRIALS + ' trials');

  target.hiddenTraits = originalTraits;
  target.hiddenPersonality = originalPersonality;
  target.status = originalStatus;

  // High Motor should accumulate less fatigue per game than Poor Conditioning.
  assert.ok(teamsModule.getTeamById('BOS'));

  const realA = roster[0];
  const realB = roster[1];
  const savedA = { traits: realA.hiddenTraits, status: realA.status };
  const savedB = { traits: realB.hiddenTraits, status: realB.status };
  realA.hiddenTraits = [{ key: 'highMotor', tier: 'legendary' }];
  realA.status = { fatigue: 0 };
  realB.hiddenTraits = [{ key: 'poorConditioning', tier: 'legendary' }];
  realB.status = { fatigue: 0 };

  const minutesByPlayerId = {};
  minutesByPlayerId[realA.id] = 36;
  minutesByPlayerId[realB.id] = 36;
  fatigueModule.applyFatigueForGame('BOS', minutesByPlayerId, false);

  assert.ok(realA.status.fatigue < realB.status.fatigue, 'High Motor should accumulate less fatigue than Poor Conditioning for the same minutes');

  realA.hiddenTraits = savedA.traits; realA.status = savedA.status;
  realB.hiddenTraits = savedB.traits; realB.status = savedB.status;

  console.log('checkInjuryFatigueTraitIntegration: OK');
}

checkInjuryFatigueTraitIntegration();

function checkFreeAgencyTradeTraitIntegration() {
  const faModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  const offer = { teamId: 'BOS', salary: 10000000, yearsRemaining: 3 };

  const roster = leagueModule.getTeamRoster('BOS');
  const proxyForPlayingTime = Object.assign({}, roster[0], { position: 'SF' });

  const ambitiousOnLosingTeam = Object.assign({}, proxyForPlayingTime, { hiddenPersonality: { loyalty: 50, ambition: 100, ego: 50, coachability: 50, durabilityMindset: 50 } });
  const apatheticOnLosingTeam = Object.assign({}, proxyForPlayingTime, { hiddenPersonality: { loyalty: 50, ambition: 0, ego: 50, coachability: 50, durabilityMindset: 50 } });
  const losingTeam = Object.assign({}, teamsModule.getTeamById('BKN'), { timeline: 'rebuilding' });

  const ambitiousScore = faModule.scoreOffer(ambitiousOnLosingTeam, losingTeam, offer);
  const apatheticScore = faModule.scoreOffer(apatheticOnLosingTeam, losingTeam, offer);
  assert.ok(ambitiousScore < apatheticScore, 'a highly ambitious player should score a rebuilding-team offer lower than an unambitious player, all else equal');

  // Trade morale hit: high-ego/high-loyalty player should lose more morale than baseline.
  const highEgoPlayer = leagueModule.getPlayerById(roster[0].id);
  const savedPersonality = highEgoPlayer.hiddenPersonality;
  const savedStatus = highEgoPlayer.status;
  const savedTeamId = highEgoPlayer.teamId;

  highEgoPlayer.hiddenPersonality = { loyalty: 100, ambition: 50, ego: 100, coachability: 50, durabilityMindset: 50 };
  highEgoPlayer.status = { morale: 70, fatigue: 0, injury: null };
  const destTeamId = highEgoPlayer.teamId === 'BOS' ? 'MIA' : 'BOS';
  tradeModule.executeTrade({ assignments: [{ playerId: highEgoPlayer.id, fromTeamId: savedTeamId, toTeamId: destTeamId }], pickAssignments: [] });
  assert.ok(highEgoPlayer.status.morale < 70, 'trading a high-ego/high-loyalty player should reduce morale');

  highEgoPlayer.teamId = savedTeamId;
  highEgoPlayer.hiddenPersonality = savedPersonality;
  highEgoPlayer.status = savedStatus;

  console.log('checkFreeAgencyTradeTraitIntegration: OK');
}

checkFreeAgencyTradeTraitIntegration();

// Defence mirrors shotQualityBonus: routed by the trait's own affinity so a
// perimeter stopper does not suddenly protect the rim.
function checkDefenseQualityBonusRoutesByZone() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const lockdown = { hiddenTraits: [{ key: 'lockdownDefender', tier: 'legendary' }] };   // perimeterDefense
  const anchor = { hiddenTraits: [{ key: 'defensiveAnchor', tier: 'legendary' }] };      // interiorDefense

  assert.ok(traitsModule.defenseQualityBonus(lockdown, 'three') > 0, 'a perimeter stopper must affect threes');
  assert.ok(traitsModule.defenseQualityBonus(lockdown, 'mid') > 0, 'a perimeter stopper must affect mid-range');
  assert.strictEqual(traitsModule.defenseQualityBonus(lockdown, 'inside'), 0,
    'a PERIMETER defender must not protect the rim — that is what routing is for');

  assert.ok(traitsModule.defenseQualityBonus(anchor, 'inside') > 0, 'an interior anchor must affect inside shots');
  assert.strictEqual(traitsModule.defenseQualityBonus(anchor, 'three'), 0,
    'an INTERIOR defender must not contest threes');
  console.log('checkDefenseQualityBonusRoutesByZone: OK');
}

// Positives with no defensive-zone meaning are allocation-only, exactly as
// unrouted scoring traits are volume-only. Charge Taker (basketballIQ) and
// Two-Way Star (no affinity) earn more assignments; they do not improve the
// contest itself.
function checkUnroutedDefendersAreAllocationOnly() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  ['chargeTaker', 'twoWayStar'].forEach(function (key) {
    const p = { hiddenTraits: [{ key: key, tier: 'legendary' }] };
    ['three', 'mid', 'inside'].forEach(function (zone) {
      assert.strictEqual(traitsModule.defenseQualityBonus(p, zone), 0,
        key + ' has no defensive zone and must contribute nothing to shot quality');
    });
  });
  console.log('checkUnroutedDefendersAreAllocationOnly: OK');
}

// Foul Prone is the ONE deliberate break from the scoring precedent. Under that
// precedent a negative applies to every zone — which for a defence trait would
// mean opponents SHOOT BETTER against you, a poor model of what fouling is. It
// routes to the foul rate instead, so it must contribute nothing to shot quality.
function checkFoulProneRoutesToFoulsNotShotQuality() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const p = { hiddenTraits: [{ key: 'foulProne', tier: 'legendary' }] };
  ['three', 'mid', 'inside'].forEach(function (zone) {
    assert.strictEqual(traitsModule.defenseQualityBonus(p, zone), 0,
      'Foul Prone must not make opponents shoot better — it makes you foul');
  });
  assert.ok(traitsModule.foulProneness(p) > 0, 'Foul Prone must raise foul-drawing');
  assert.strictEqual(traitsModule.foulProneness({ hiddenTraits: [{ key: 'lockdownDefender', tier: 'legendary' }] }), 0,
    'a clean defender must not draw extra fouls');

  // Foul Prone happens to carry NO affinity, so the affinity check alone would
  // exclude it and the explicit negative guard would be unreachable — a mutant
  // deleting that guard survived until this case existed. Inject a synthetic
  // negative defence trait that DOES have an affinity, so the rule "negatives
  // never improve the opponent's shot" is tested rather than merely implied by
  // today's data. Without this, adding one real trait of that shape would
  // silently make opponents shoot better against the player who has it.
  const taxonomy = traitsModule.TRAIT_TAXONOMY_BY_KEY;
  taxonomy.__syntheticNegativeDefender = {
    key: '__syntheticNegativeDefender', name: 'Synthetic Gambler', category: 'negative',
    affinity: 'perimeterDefense',
    effect: { system: 'boxscore', stat: 'defense', direction: -1 },
    tierValues: { bronze: 1, silver: 2, gold: 3, hof: 5, legendary: 8 }
  };
  try {
    const gambler = { hiddenTraits: [{ key: '__syntheticNegativeDefender', tier: 'legendary' }] };
    assert.strictEqual(traitsModule.defenseQualityBonus(gambler, 'three'), 0,
      'a NEGATIVE defence trait must never contribute to shot quality, even with a routable affinity');
    assert.ok(traitsModule.foulProneness(gambler) > 0,
      'a negative defence trait belongs on the foul path');
  } finally {
    delete taxonomy.__syntheticNegativeDefender;
  }
  console.log('checkFoulProneRoutesToFoulsNotShotQuality: OK');
}

// Chemistry is a TEAM property, so it sums across the roster and both signs count.
function checkChemistryBonusSumsAcrossTheRoster() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const leaderA = { hiddenTraits: [{ key: 'naturalLeader', tier: 'legendary' }] };
  const leaderB = { hiddenTraits: [{ key: 'naturalLeader', tier: 'legendary' }] };
  const cancer = { hiddenTraits: [{ key: 'lockerRoomCancer', tier: 'legendary' }] };
  const plain = { hiddenTraits: [] };

  assert.strictEqual(traitsModule.chemistryBonus([plain, plain]), 0);
  const one = traitsModule.chemistryBonus([leaderA, plain]);
  assert.ok(one > 0, 'a Natural Leader must raise team chemistry');
  assert.ok(traitsModule.chemistryBonus([leaderA, leaderB]) > one, 'two leaders must beat one');
  assert.ok(traitsModule.chemistryBonus([cancer, plain]) < 0, 'a Locker Room Cancer must lower it');
  assert.strictEqual(traitsModule.chemistryBonus([leaderA, cancer]), 0, 'equal and opposite must cancel');
  console.log('checkChemistryBonusSumsAcrossTheRoster: OK');
}

// Badges leave the scouting gate for rostered players. Personality and
// tendencies stay behind it, so scouting keeps a job — it just stops taxing you
// to learn what your own players are.
function checkBadgesAreVisibleForRosteredPlayers() {
  const scouting = require(path.join(__dirname, '..', 'scouting.js'));
  const p = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: { loyalty: 80 }, hiddenTendencies: { threeRate: 0.4 } };

  const unscouted = scouting.getRevealedView(p, 0, false);
  assert.deepStrictEqual(unscouted.traits, p.hiddenTraits,
    'a rostered player\'s badges must be exact at 0% confidence');
  assert.strictEqual(unscouted.traitsAreFuzzy, false);
  // `level` must keep meaning PERSONALITY reveal only. Overloading it to also
  // carry badge state is what made ui/playerProfile.js throw Object.keys(null)
  // on every unscouted player, because its branches read level to decide
  // whether personality existed.
  assert.strictEqual(unscouted.level, 'hidden',
    'level must describe personality reveal, never badge visibility');
  assert.strictEqual(unscouted.personality, null,
    'personality must STAY gated — only badges come out from behind it');
  assert.strictEqual(unscouted.tendencies, null, 'tendencies must stay gated');

  const scouted = scouting.getRevealedView(p, 100, false);
  assert.ok(scouted.personality, 'personality must still unlock with confidence');
  console.log('checkBadgesAreVisibleForRosteredPlayers: OK');
}

// Prospects keep the fuzz: seeing a draft pick's exact tier would remove most
// of draft night's risk. Reuses the fuzzy path that already exists.
function checkProspectBadgesStayFuzzy() {
  const scouting = require(path.join(__dirname, '..', 'scouting.js'));
  const p = { hiddenTraits: [{ key: 'sharpshooter', tier: 'gold' }],
    hiddenPersonality: {}, hiddenTendencies: {} };
  const view = scouting.getRevealedView(p, 0, true);
  assert.ok(view.traits && view.traits.length === 1, 'a prospect must still show WHICH badges');
  assert.ok(!view.traits[0].tier, 'a prospect must NOT show the exact tier');
  assert.strictEqual(view.traitsAreFuzzy, true);
  // A prospect at 0% must report personality as HIDDEN, not fuzzy. The first
  // version returned level 'fuzzy' with personality null, and every consumer
  // that trusted 'fuzzy' to mean "personality is present" crashed on it.
  assert.strictEqual(view.level, 'hidden');
  assert.strictEqual(view.personality, null,
    'a level that promises personality must actually carry one');
  assert.ok(view.traits[0].rangeLabel && view.traits[0].rangeLabel.indexOf('-') !== -1,
    'a prospect badge must carry a tier RANGE, got ' + JSON.stringify(view.traits[0]));

  // Even fully scouted, a prospect's tier stays a range — scouting a prospect
  // buys personality and tendencies, not certainty about their ceiling.
  const scouted = scouting.getRevealedView(p, 100, true);
  assert.ok(!scouted.traits[0].tier, 'a fully scouted prospect still must not show the exact tier');
  console.log('checkProspectBadgesStayFuzzy: OK');
}

// The dead `badges` array and badge_affinity are gone. Once badges MEAN traits,
// a second inert thing called "badges" is a trap for whoever reads this next.
function checkTheDeadBadgeArrayIsGone() {
  const dataModule = require(path.join(__dirname, '..', 'data.js'));
  Object.keys(dataModule.PLAYER_ARCHETYPES).forEach(function (k) {
    assert.strictEqual(dataModule.PLAYER_ARCHETYPES[k].badge_affinity, undefined,
      k + ' still declares badge_affinity, which nothing reads');
  });
  console.log('checkTheDeadBadgeArrayIsGone: OK');
}

checkBadgesAreVisibleForRosteredPlayers();
// The badge reference (ui/badges.js) renders straight from the taxonomy, so a
// badge added without a description would render a blank card and a renamed
// key would leave its old text stranded. Both directions are checked, because
// only checking one lets the other rot — the same asymmetry that left five
// rating gates dead.
function checkEveryBadgeIsDocumented() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  const missing = traitsModule.TRAIT_TAXONOMY
    .filter(function (t) { return !traitsModule.TRAIT_DESCRIPTIONS[t.key]; })
    .map(function (t) { return t.key; });
  assert.strictEqual(missing.length, 0,
    'these badges have no description and would render blank: ' + missing.join(', '));

  const orphans = Object.keys(traitsModule.TRAIT_DESCRIPTIONS)
    .filter(function (k) { return !traitsModule.TRAIT_TAXONOMY_BY_KEY[k]; });
  assert.strictEqual(orphans.length, 0,
    'these descriptions no longer match any badge: ' + orphans.join(', '));

  // Every (system, stat) pair the taxonomy uses needs a human label, or the
  // reference falls back to printing "boxscore/usage" at the player.
  const unlabelled = traitsModule.TRAIT_TAXONOMY.filter(function (t) {
    return !traitsModule.TRAIT_EFFECT_LABELS[t.effect.system + '/' + t.effect.stat];
  }).map(function (t) { return t.effect.system + '/' + t.effect.stat; });
  assert.strictEqual(unlabelled.length, 0,
    'these effect pairs have no display label: ' + Array.from(new Set(unlabelled)).join(', '));

  // A description that is shorter than a name is a placeholder, not a description.
  const stubs = traitsModule.TRAIT_TAXONOMY.filter(function (t) {
    return traitsModule.TRAIT_DESCRIPTIONS[t.key].length < 25;
  }).map(function (t) { return t.key; });
  assert.strictEqual(stubs.length, 0, 'these descriptions are stubs: ' + stubs.join(', '));

  console.log('checkEveryBadgeIsDocumented: OK (' + traitsModule.TRAIT_TAXONOMY.length + ' badges)');
}

// Secret badges are the rarest thing in the game and the easiest to break
// silently: they are unreachable by generation, reachable only by evolution,
// and capped at one per player. Each of those is asserted, because none of them
// is visible from reading a roster.
function checkSecretBadgesAreUnreachableByGeneration() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  assert.strictEqual(traitsModule.TRAIT_TIERS.indexOf(traitsModule.SECRET_TIER), -1,
    'secret must NOT be in TRAIT_TIERS, or generation can roll it and players are born with one');

  // Generate a whole league's worth of traits and confirm none came out secret.
  const playersMod = require(path.join(__dirname, '..', 'players-2026.js'));
  traitsModule.ensureHiddenPlayerData(playersMod.PLAYERS_2026);
  const born = [];
  playersMod.PLAYERS_2026.forEach(function (p) {
    (p.hiddenTraits || []).forEach(function (t) {
      if (t.tier === traitsModule.SECRET_TIER) born.push(p.name);
    });
  });
  assert.strictEqual(born.length, 0,
    'no player may be GENERATED with a secret badge, found: ' + born.join(', '));

  // Every positive badge has a form to evolve into; no flaw does.
  const positives = traitsModule.TRAIT_TAXONOMY.filter(function (t) { return t.category !== 'negative'; });
  const missing = positives.filter(function (t) { return !traitsModule.SECRET_FORMS[t.key]; });
  assert.strictEqual(missing.length, 0,
    'these positive badges have no secret form: ' + missing.map(function (t) { return t.key; }).join(', '));
  const onFlaws = Object.keys(traitsModule.SECRET_FORMS).filter(function (k) {
    const d = traitsModule.TRAIT_TAXONOMY_BY_KEY[k];
    return d && d.category === 'negative';
  });
  assert.strictEqual(onFlaws.length, 0, 'flaws must not have secret forms: ' + onFlaws.join(', '));

  // Names must be distinct from each other AND from the base badge names, or
  // the feed line "turned X into Y" reads as nonsense.
  const seen = {};
  Object.keys(traitsModule.SECRET_FORMS).forEach(function (k) {
    const n = traitsModule.SECRET_FORMS[k].name;
    assert.ok(!seen[n], 'duplicate secret badge name: ' + n);
    seen[n] = true;
    assert.notStrictEqual(n, traitsModule.TRAIT_TAXONOMY_BY_KEY[k].name,
      'secret form must differ from the base badge name for ' + k);
  });
  console.log('checkSecretBadgesAreUnreachableByGeneration: OK (' +
    Object.keys(traitsModule.SECRET_FORMS).length + ' forms)');
}

function checkSecretBadgeEvolutionIsCappedAndRare() {
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));

  // A player already holding one is permanently out of the running. Without
  // this a star could stack several league-breaking badges over a career.
  const holder = {
    id: 'cap-test', name: 'Cap Test', age: 22,
    attributes: { workEthic: 99 },
    hiddenTraits: [
      { key: 'sharpshooter', tier: traitsModule.SECRET_TIER },
      { key: 'finisher', tier: 'legendary' }
    ]
  };
  assert.strictEqual(traitsModule.eligibleSecretBadges(holder).length, 0,
    'a player who already holds a secret badge must never be eligible for another');

  // Only LEGENDARY positives are candidates.
  const mixed = {
    id: 'mix-test', name: 'Mix Test', age: 22,
    attributes: { workEthic: 50 },
    hiddenTraits: [
      { key: 'sharpshooter', tier: 'hof' },
      { key: 'finisher', tier: 'legendary' },
      { key: 'streaky', tier: 'legendary' }
    ]
  };
  const cands = traitsModule.eligibleSecretBadges(mixed).map(function (t) { return t.key; });
  assert.deepStrictEqual(cands, ['finisher'],
    'only positive LEGENDARY badges are candidates, got ' + cands.join(','));

  // The category guard on its own terms. Without this, dropping
  // `category !== 'negative'` from eligibleSecretBadges was a SURVIVING mutant:
  // no flaw has a secret form, so the second half of the condition already
  // excluded every flaw and the category check never decided anything. Giving a
  // flaw a form for the length of this assertion is the only way to find out
  // whether the guard actually works, rather than whether the data happens to
  // make it unnecessary.
  const restore = traitsModule.SECRET_FORMS.streaky;
  traitsModule.SECRET_FORMS.streaky = { name: 'Test Form', description: 'Injected for this assertion only.' };
  try {
    const withFlawForm = traitsModule.eligibleSecretBadges(mixed).map(function (t) { return t.key; });
    assert.deepStrictEqual(withFlawForm, ['finisher'],
      'a FLAW must stay ineligible even if it somehow has a secret form, got ' + withFlawForm.join(','));
  } finally {
    if (restore === undefined) delete traitsModule.SECRET_FORMS.streaky;
    else traitsModule.SECRET_FORMS.streaky = restore;
  }

  // The chance must respond to what it claims to respond to.
  function chanceFor(over) {
    return traitsModule.secretEvolutionChance(Object.assign({
      age: 22, attributes: { workEthic: 50 }, hiddenTraits: []
    }, over));
  }
  const baseline = chanceFor({});
  assert.ok(chanceFor({ attributes: { workEthic: 99 } }) > baseline * 1.4,
    'work ethic must raise the chance materially');
  assert.ok(chanceFor({ age: 34 }) < baseline * 0.5, 'age must lower it');
  assert.ok(chanceFor({ hiddenTraits: [{ key: 'coachable', tier: 'legendary' }] }) > baseline * 1.4,
    'Coachable must raise it');
  assert.ok(chanceFor({ hiddenTraits: [{ key: 'stubborn', tier: 'legendary' }] }) < baseline,
    'Stubborn must lower it');

  // And it must stay RARE. Summed across the whole eligible league this is the
  // expected number of evolutions per offseason; measured at 0.32 over 25
  // seasons of real offseasons. A change that pushes this past 1.5 has turned
  // the rarest thing in the game into a routine one.
  let expected = 0;
  const leagueMod = require(path.join(__dirname, '..', 'players-2026.js'));
  leagueMod.PLAYERS_2026.forEach(function (p) {
    if (traitsModule.eligibleSecretBadges(p).length) expected += traitsModule.secretEvolutionChance(p);
  });
  assert.ok(expected > 0.05 && expected < 1.5,
    'expected evolutions per offseason should stay rare, got ' + expected.toFixed(2));
  console.log('checkSecretBadgeEvolutionIsCappedAndRare: OK (' + expected.toFixed(2) + '/offseason)');
}

checkEveryBadgeIsDocumented();
checkSecretBadgesAreUnreachableByGeneration();
checkSecretBadgeEvolutionIsCappedAndRare();
checkProspectBadgesStayFuzzy();
checkTheDeadBadgeArrayIsGone();
checkDefenseQualityBonusRoutesByZone();
checkUnroutedDefendersAreAllocationOnly();
checkFoulProneRoutesToFoulsNotShotQuality();
checkChemistryBonusSumsAcrossTheRoster();

console.log('All trait/scouting validations passed');
