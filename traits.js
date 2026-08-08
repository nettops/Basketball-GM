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

// Same rescale problem, one level down. The roll is a fixed 0-100 draw nudged
// by how good the player is, so BOTH the anchor and the width of that nudge
// depend on the rating scale. Old skill (ovr+pot)/2 ran mean 76.9 sd 6.8, so
// `skill - 60` was a shift of mean +16.9 sd 6.8. New skill runs mean 50.4
// sd 8.8 — left alone the shift became mean -9.6, which is what pushed the
// league from 25% legendary traits to 6%.
//
// Only the ANCHOR is rescaled: 60 sat at -2.49 standard deviations on the old
// skill distribution, which against the new one is 28.5. Measured tier mix
// against the pre-rescale target (bronze 15 / silver 23 / gold 25 / hof 14 /
// legendary 25):
//   anchor 28.5, skill narrowed x0.773  ->  21 / 24 / 22 / 12 / 21
//   anchor 28.5, natural width          ->  18 / 24 / 21 / 13 / 25   <- chosen
//   anchor 24,   natural width          ->  16 / 23 / 20 / 14 / 27
//   anchor 20,   natural width          ->  15 / 21 / 20 / 13 / 31
//
// The first attempt also narrowed the skill term by 6.8/8.8 to hold its spread,
// and undershot the top of the ladder: the skill distribution changed SHAPE,
// not just its moments, so preserving two moments did not preserve the mix.
// Leaving the term at its natural width puts legendary exactly on 25%. The
// residue is a few points of gold sitting in bronze — the ladder is slightly
// more polarised than before, which is coherent on a more polarised scale.
const TIER_SKILL_ANCHOR = 28.5;

function pickPositiveTier(player, rng) {
  const skill = (player.overall + player.potential) / 2;
  const roll = rng() * 100 + (skill - TIER_SKILL_ANCHOR);
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
// How many traits a player carries, and how good they are, both key off
// `overall` — so both moved when overall was rescaled onto a true 0-100 scale
// and its mean fell from 74.7 to 47.8. Left alone, `(overall - 45) / 9` gave
// 86% of the league exactly ONE trait where the median player used to carry
// three, and the tier mix inverted: legendary went 25% -> 6% and bronze
// 15% -> 38%. The trait system was quietly gutted by a change that never
// touched it.
//
// Converted by z-score rather than re-picked, so the same slice of the league
// lands in the same place: on the old distribution (overall mean 74.7, sd 7.6)
// the offset sat at -3.90 standard deviations, which against the new one
// (mean 47.8, sd 9.9) is 9; the divisor scales with the sd ratio, 9 -> 12.
// Verified at three points — p05 overall 32 -> 2 traits (old 65 -> 2),
// p50 48 -> 3 (old 74 -> 3), p95 66 -> 5 (old 89 -> 5).
const TRAIT_COUNT_FLOOR = 9;
const TRAIT_COUNT_STEP = 12;

function generateHiddenTraits(player, rng) {
  const traitCount = Math.max(1, Math.min(6,
    Math.round((player.overall - TRAIT_COUNT_FLOOR) / TRAIT_COUNT_STEP)));
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

// Shot selection is where player identity actually lives, and this used to be
// a plain linear share: `rawThree / (rawThree + rawMid + rawInside)`. A linear
// share barely responds, because the numerator and the denominator move
// together — a great shooter's total rises along with his three-point rating,
// so the ratio stays near where it started.
//
// Measured from reference/zengm/data/real-player-stats.basketball.json (2025,
// min 300 FGA): real per-player 3PA share runs 4.5% to 71.6%, a 67-point
// spread, while true 3P% talent spans about 14. Real basketball differentiates
// players roughly five times more by WHICH shot they take than by how well they
// make it. Ours was the inverse.
//
// amplifyShare pushes the raw share through a piecewise map with a steep middle
// segment — the same shape ZenGM uses for shootingThreePointerScaled2 in
// GameSim.basketball/index.ts, where a slope-3.5 band encodes "you are either a
// shooter or you are not". Below SHARE_LOW the map crushes you toward zero;
// between LOW and HIGH a small difference in skill swings volume hard; above
// HIGH a specialist is compressed so nobody runs away to shooting only threes.
// Breakpoints calibrated by measured rate — the sweep is in this task's commit.
// The map PIVOTS on the league median so it spreads players without moving the
// league. A first attempt ran the steep band from 0.28 to 0.38 and sent the
// median player from a 30% three-point share to 15%: the spread went to 54.7
// points but league 3PA share fell 29.1% -> 22.3%, buying individual identity
// with the league's identity. Exactly the mistake the transition shot-mix
// calibration already made once, paying for the rim out of threes.
//
// Measured raw share distribution over the 380 rostered players:
//   p05 0.100   p25 0.217   p50 0.300   p75 0.372   p95 0.447   mean 0.291
// so PIVOT is set at that median and mapped to itself.
const SHARE_LOW = 0.20, SHARE_PIVOT = 0.30, SHARE_HIGH = 0.40;
const SHARE_LOW_OUT = 0.08, SHARE_PIVOT_OUT = 0.30, SHARE_HIGH_OUT = 0.56;
const SHARE_TAIL_SLOPE = 0.6;

function amplifyShare(share) {
  if (share <= 0) return 0;
  if (share < SHARE_LOW) return share * (SHARE_LOW_OUT / SHARE_LOW);
  if (share < SHARE_PIVOT) {
    return SHARE_LOW_OUT +
      (share - SHARE_LOW) * ((SHARE_PIVOT_OUT - SHARE_LOW_OUT) / (SHARE_PIVOT - SHARE_LOW));
  }
  if (share < SHARE_HIGH) {
    return SHARE_PIVOT_OUT +
      (share - SHARE_PIVOT) * ((SHARE_HIGH_OUT - SHARE_PIVOT_OUT) / (SHARE_HIGH - SHARE_PIVOT));
  }
  return Math.min(0.95, SHARE_HIGH_OUT + (share - SHARE_HIGH) * SHARE_TAIL_SLOPE);
}

function generateTendencies(player, rng) {
  const a = player.attributes;
  const rawThree = Math.max(1, a.threePoint);
  const rawMid = Math.max(1, a.midRange);
  const rawInside = Math.max(1, a.insideScoring + a.postScoring / 2);
  const shotTotal = rawThree + rawMid + rawInside;

  // Amplify the three-point share, then split what is left between mid and
  // inside in their original proportion — so a stretch big who loses volume to
  // the amplifier loses it from both other zones rather than only one.
  const three = amplifyShare(rawThree / shotTotal);
  const rest = rawMid + rawInside;
  const t3 = Math.round(three * 100);
  const tm = Math.round((1 - three) * (rawMid / rest) * 100);
  return {
    threeTendency: t3,
    midTendency: tm,
    // Absorbs the rounding so the three always sum to exactly 100.
    insideTendency: 100 - t3 - tm,
    isoTendency: personalityAxis(a.ballHandling, 60, rng),
    catchAndShootTendency: personalityAxis(a.threePoint, 60, rng),
    postTendency: personalityAxis(a.postScoring, 60, rng),
    transitionTendency: personalityAxis(a.speed, 60, rng),
    clutchUsage: personalityAxis(a.basketballIQ, 70, rng),
    gambleTendency: personalityAxis(a.steal, 70, rng),
    reboundAggression: personalityAxis((a.offReb + a.defReb) / 2, 70, rng)
  };
}

// Cheap deterministic string->uint32 hash so ensureHiddenPlayerData can seed a
// per-player rng purely from the player's stable id — no external rng needed,
// and re-running it twice on the same roster always produces the same result.
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function ensureHiddenPlayerData(players) {
  players.forEach(function (p) {
    if (p.hiddenTraits && p.hiddenTraits.length > 0) return;
    const playerRng = _TRAITS_DATA.rng.makeRng(hashId(p.id));
    p.hiddenTraits = generateHiddenTraits(p, playerRng);
    p.hiddenPersonality = generatePersonality(p, playerRng);
    p.hiddenTendencies = generateTendencies(p, playerRng);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAIT_TAXONOMY: TRAIT_TAXONOMY,
    TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY,
    TRAIT_TIERS: TRAIT_TIERS,
    // Exported so scripts/validate-traits.js can check the tier ladder where it
    // actually lands — the share of events a trait wins in weightedPick —
    // rather than trusting the constants to still mean what they meant on a
    // different rating scale.
    TRAIT_TIER_SCALE: TRAIT_TIER_SCALE,
    SUPERSTAR_TIER_SCALE: SUPERSTAR_TIER_SCALE,
    getTraitBonus: getTraitBonus,
    generateHiddenTraits: generateHiddenTraits,
    generatePersonality: generatePersonality,
    generateTendencies: generateTendencies,
    ensureHiddenPlayerData: ensureHiddenPlayerData
  };
}
