var _TRAITS_DATA = (typeof require !== 'undefined')
  ? { rng: require('./rng.js') }
  : { rng: { makeRng: makeRng } };

const TRAIT_TIER_SCALE = { bronze: 1, silver: 2, gold: 3, hof: 5, legendary: 8 };
const SUPERSTAR_TIER_SCALE = { bronze: 2, silver: 4, gold: 6, hof: 9, legendary: 14 };
const TRAIT_TIERS = ['bronze', 'silver', 'gold', 'hof', 'legendary'];

// 48 traits, 8 per category. `affinity` is the attribute key (from data.js's
// ATTRIBUTE_KEYS) that makes a player more likely to roll this trait; null for
// traits with no clean attribute proxy. `effect.system`/`effect.stat` are the
// exact (system, stat) pair Batch B's integration points query via
// getTraitBonus — every trait maps to exactly one, no per-trait special-casing
// needed at call sites except Mentor (cross-player, see progression.js).
const TRAIT_TAXONOMY = [
  // --- Offensive ---
  { key: 'sharpshooter', name: 'Sharpshooter', category: 'offensive', affinity: 'threePoint', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'postThreat', name: 'Post Threat', category: 'offensive', affinity: 'postScoring', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'finisher', name: 'Finisher', category: 'offensive', affinity: 'insideScoring', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'playmaker', name: 'Playmaker', category: 'offensive', affinity: 'passing', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pickRollMaestro', name: 'Pick & Roll Maestro', category: 'offensive', affinity: 'ballHandling', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'offBallMover', name: 'Off-Ball Mover', category: 'offensive', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'freeThrowAce', name: 'Free Throw Ace', category: 'offensive', affinity: 'freeThrow', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'highMotorScorer', name: 'High Motor Scorer', category: 'offensive', affinity: 'workEthic', effect: { system: 'boxscore', stat: 'usage', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Defensive ---
  { key: 'lockdownDefender', name: 'Lockdown Defender', category: 'defensive', affinity: 'perimeterDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'rimProtector', name: 'Rim Protector', category: 'defensive', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'block', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pickpocket', name: 'Pickpocket', category: 'defensive', affinity: 'steal', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'defensiveAnchor', name: 'Defensive Anchor', category: 'defensive', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'chargeTaker', name: 'Charge Taker', category: 'defensive', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'switchable', name: 'Switchable', category: 'defensive', affinity: 'perimeterDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'glassCleaner', name: 'Glass Cleaner', category: 'defensive', affinity: 'defReb', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'pointOfAttackMenace', name: 'Point-of-Attack Menace', category: 'defensive', affinity: 'steal', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Athletic ---
  { key: 'eliteSpeed', name: 'Elite Speed', category: 'athletic', affinity: 'speed', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'explosiveVertical', name: 'Explosive Vertical', category: 'athletic', affinity: 'vertical', effect: { system: 'boxscore', stat: 'block', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'ironMan', name: 'Iron Man', category: 'athletic', affinity: 'strength', effect: { system: 'injury', stat: 'chance', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'quickTwitch', name: 'Quick Twitch', category: 'athletic', affinity: 'acceleration', effect: { system: 'boxscore', stat: 'steal', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'strengthAdvantage', name: 'Strength Advantage', category: 'athletic', affinity: 'strength', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'highMotor', name: 'High Motor', category: 'athletic', affinity: 'workEthic', effect: { system: 'fatigue', stat: 'accumulation', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'springyRebounder', name: 'Springy Rebounder', category: 'athletic', affinity: 'offReb', effect: { system: 'boxscore', stat: 'rebound', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'fastHealer', name: 'Fast Healer', category: 'athletic', affinity: 'strength', effect: { system: 'injury', stat: 'recovery', direction: -1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Mental ---
  { key: 'highIQ', name: 'High IQ', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'clutchGene', name: 'Clutch Gene', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'coachable', name: 'Coachable', category: 'mental', affinity: 'workEthic', effect: { system: 'progression', stat: 'self', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'naturalLeader', name: 'Natural Leader', category: 'mental', affinity: 'leadership', effect: { system: 'chemistry', stat: 'team', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'bigGameCompetitor', name: 'Big-Game Competitor', category: 'mental', affinity: 'leadership', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'filmJunkie', name: 'Film Junkie', category: 'mental', affinity: 'workEthic', effect: { system: 'progression', stat: 'self', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'poise', name: 'Poise', category: 'mental', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'mentor', name: 'Mentor', category: 'mental', affinity: 'leadership', effect: { system: 'progression', stat: 'teammate', direction: 1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Negative (tier = severity; Legendary is the WORST version of the flaw) ---
  { key: 'injuryProne', name: 'Injury Prone', category: 'negative', affinity: null, effect: { system: 'injury', stat: 'chance', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'streaky', name: 'Streaky', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'scoring', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'turnoverProne', name: 'Turnover Prone', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'assist', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'foulProne', name: 'Foul Prone', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'defense', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'poorConditioning', name: 'Poor Conditioning', category: 'negative', affinity: null, effect: { system: 'fatigue', stat: 'accumulation', direction: 1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'lockerRoomCancer', name: 'Locker Room Cancer', category: 'negative', affinity: null, effect: { system: 'chemistry', stat: 'team', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'stubborn', name: 'Stubborn', category: 'negative', affinity: null, effect: { system: 'progression', stat: 'self', direction: -1 }, tierValues: TRAIT_TIER_SCALE },
  { key: 'chokeArtist', name: 'Choke Artist', category: 'negative', affinity: null, effect: { system: 'boxscore', stat: 'scoring', direction: -1 }, tierValues: TRAIT_TIER_SCALE },

  // --- Superstar (rare; gated to overall>=85 or potential>=88 in generateHiddenTraits) ---
  { key: 'alphaDog', name: 'Alpha Dog', category: 'superstar', affinity: 'leadership', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'iceInVeins', name: 'Ice in Veins', category: 'superstar', affinity: 'basketballIQ', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'twoWayStar', name: 'Two-Way Star', category: 'superstar', affinity: null, effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'floorGeneral', name: 'Floor General', category: 'superstar', affinity: 'passing', effect: { system: 'boxscore', stat: 'assist', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'unstoppableForce', name: 'Unstoppable Force', category: 'superstar', affinity: 'strength', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'dpoyCaliber', name: 'DPOY Caliber', category: 'superstar', affinity: 'interiorDefense', effect: { system: 'boxscore', stat: 'defense', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'franchiseCornerstone', name: 'Franchise Cornerstone', category: 'superstar', affinity: 'leadership', effect: { system: 'chemistry', stat: 'team', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE },
  { key: 'humanHighlightReel', name: 'Human Highlight Reel', category: 'superstar', affinity: 'vertical', effect: { system: 'boxscore', stat: 'scoring', direction: 1 }, tierValues: SUPERSTAR_TIER_SCALE }
];

const TRAIT_TAXONOMY_BY_KEY = {};
TRAIT_TAXONOMY.forEach(function (t) { TRAIT_TAXONOMY_BY_KEY[t.key] = t; });

function getTraitBonus(player, system, stat) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== system || def.effect.stat !== stat) return sum;
    return sum + def.tierValues[t.tier] * def.effect.direction;
  }, 0);
}

function weightedSampleWithoutReplacement(items, weightFn, count, rng) {
  const pool = items.slice();
  const result = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const weights = pool.map(weightFn);
    const total = weights.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

function traitWeight(player, def) {
  if (def.category === 'superstar') {
    return (player.overall >= 85 || player.potential >= 88) ? 1 : 0;
  }
  let w = 1;
  if (def.affinity) {
    const attr = player.attributes[def.affinity] || 50;
    w = Math.max(0.1, (attr - 40) / 20);
  }
  if (def.category === 'negative') {
    const flawProxy = 100 - (player.attributes.workEthic + player.attributes.basketballIQ) / 2;
    w *= Math.max(0.3, flawProxy / 50);
  }
  return w;
}

function pickPositiveTier(player, rng) {
  const skill = (player.overall + player.potential) / 2;
  const roll = rng() * 100 + (skill - 60);
  if (roll < 30) return 'bronze';
  if (roll < 55) return 'silver';
  if (roll < 78) return 'gold';
  if (roll < 92) return 'hof';
  return 'legendary';
}

function pickNegativeTier(rng) {
  const roll = rng() * 100;
  if (roll < 45) return 'bronze';
  if (roll < 75) return 'silver';
  if (roll < 92) return 'gold';
  if (roll < 98) return 'hof';
  return 'legendary';
}

// Trait count scales with overall: ~1 at bench-level (45 OVR), ~2 at a solid
// rotation player (60 OVR), up to 5-6 for a top-tier star (95+ OVR). Superstar
// traits are only reachable via traitWeight's overall/potential gate above,
// and even then a candidate has to win the weighted draw against everything else.
function generateHiddenTraits(player, rng) {
  const traitCount = Math.max(1, Math.min(6, Math.round((player.overall - 45) / 9)));
  const candidates = TRAIT_TAXONOMY.filter(function (def) { return traitWeight(player, def) > 0; });
  const selected = weightedSampleWithoutReplacement(candidates, function (def) { return traitWeight(player, def); }, Math.min(traitCount, candidates.length), rng);
  return selected.map(function (def) {
    const tier = def.category === 'negative' ? pickNegativeTier(rng) : pickPositiveTier(player, rng);
    return { key: def.key, tier: tier };
  });
}

function personalityAxis(base, spread, rng) {
  return Math.max(0, Math.min(100, Math.round(base + (rng() - 0.5) * spread)));
}

function generatePersonality(player, rng) {
  const a = player.attributes;
  return {
    loyalty: personalityAxis(50, 90, rng),
    ambition: personalityAxis(50, 90, rng),
    ego: personalityAxis(30 + player.overall * 0.4, 50, rng),
    coachability: personalityAxis((a.workEthic + a.basketballIQ) / 2, 60, rng),
    durabilityMindset: personalityAxis((a.strength + a.workEthic) / 2, 60, rng)
  };
}

// Shot-mix values are an approximate normalized split (they won't sum to
// exactly 100 after independent rounding — that's fine, they're a bias input
// to simEngineBoxScore.js, not a precise possession accounting).
function generateTendencies(player, rng) {
  const a = player.attributes;
  const rawThree = a.threePoint;
  const rawMid = a.midRange;
  const rawInside = a.insideScoring + a.postScoring / 2;
  const shotTotal = rawThree + rawMid + rawInside;
  return {
    threeTendency: Math.round((rawThree / shotTotal) * 100),
    midTendency: Math.round((rawMid / shotTotal) * 100),
    insideTendency: Math.round((rawInside / shotTotal) * 100),
    isoTendency: personalityAxis(a.ballHandling, 60, rng),
    catchAndShootTendency: personalityAxis(a.threePoint, 60, rng),
    postTendency: personalityAxis(a.postScoring, 60, rng),
    transitionTendency: personalityAxis(a.speed, 60, rng),
    clutchUsage: personalityAxis(a.basketballIQ, 70, rng),
    gambleTendency: personalityAxis(a.steal, 70, rng),
    reboundAggression: personalityAxis((a.offReb + a.defReb) / 2, 70, rng)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAIT_TAXONOMY: TRAIT_TAXONOMY,
    TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY,
    TRAIT_TIERS: TRAIT_TIERS,
    getTraitBonus: getTraitBonus,
    generateHiddenTraits: generateHiddenTraits,
    generatePersonality: generatePersonality,
    generateTendencies: generateTendencies
  };
}
