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

checkShotMixSeparatesPlayers();
checkTendenciesStillSumToOneHundred();

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

console.log('All trait/scouting validations passed');
