// Composite ratings + team synergy, ported from the spirit of ZenGM's
// GameSim.basketball approach (reference/zengm/src/worker/core/GameSim.basketball):
// combine several raw attributes with sport-specific weights into a single
// score used for a specific in-game action, then let a team's overall MIX of
// strong composites produce a synergy bonus/penalty beyond what any single
// player's rating alone would predict (e.g. stacking shooters compounds
// floor spacing). Consumed by simEnginePossession.js.
var _COMPOSITE_DATA = (typeof require !== 'undefined')
  ? {}
  : {};

// Each composite is a weighted average of attributes (weights don't need to
// sum to 1 — they're relative), scaled back onto a roughly 0-100 range so
// composites behave like any other rating for downstream math.
const COMPOSITE_WEIGHTS = {
  shootingThree: { threePoint: 3, basketballIQ: 1 },
  shootingMid: { midRange: 3, basketballIQ: 1 },
  shootingInside: { insideScoring: 2, postScoring: 1.5, strength: 1 },
  defenseInterior: { interiorDefense: 2.5, strength: 1.5, vertical: 1, block: 2 },
  defensePerimeter: { perimeterDefense: 2.5, speed: 1.5, steal: 2 },
  ballHandling: { ballHandling: 2, passing: 1.5, basketballIQ: 1 },
  rebounding: { offReb: 1, defReb: 1, strength: 1, vertical: 1 }
};

function computeComposite(player, key) {
  const weights = COMPOSITE_WEIGHTS[key];
  if (!weights) return 50;
  const attrs = player.attributes;
  let sum = 0, totalWeight = 0;
  Object.keys(weights).forEach(function (attrKey) {
    sum += (attrs[attrKey] || 50) * weights[attrKey];
    totalWeight += weights[attrKey];
  });
  return totalWeight > 0 ? sum / totalWeight : 50;
}

// Logistic ramp: near-zero below `cutoff` players qualifying, near-`maxBonus`
// once several do, with a smooth transition around the cutoff — matches
// ZenGM's sigmoid(count, scale, threshold) shape without needing its exact
// constants (theirs are tuned per-sport-rating; these are a fresh, simpler
// curve calibrated for this game's rotation size of 8).
function synergyRamp(countQualifying, cutoff, maxBonus) {
  const steepness = 1.3;
  const sigmoid = 1 / (1 + Math.exp(-steepness * (countQualifying - cutoff)));
  return 1 + (sigmoid - 0.5) * 2 * maxBonus;
}

// Solved for a ~20% qualifying UNION, not set at each composite's own top-20%:
// the shooter and defender tests below are ORs, so per-composite percentiles
// would union out to nearly 40%. On the old 48-99 rating scale these were
// 72/72/70, which selected 65.5% of the league as shooters, 76.3% as defenders
// and 70.8% as rebounders — a roster-construction bonus three quarters of the
// league earned, which is no bonus at all. ZenGM's equivalent skill cutoffs
// pick out roughly the top 10-25%.
const SHOOTER_THRESHOLD = 68;
const DEFENDER_THRESHOLD = 67;
const REBOUNDER_THRESHOLD = 60;

// Computed once per game (not per possession — composites/synergy don't
// change possession-to-possession) from a team's active rotation. Returns
// multipliers >1 for a well-constructed roster's strength, <1 for a
// lopsided one, centered on 1.0 for an average team.
function computeTeamSynergy(roster) {
  const rotation = roster.slice().sort(function (a, b) { return b.overall - a.overall; }).slice(0, 8);
  if (rotation.length === 0) return { offense: 1, defense: 1, rebound: 1 };

  const shooters = rotation.filter(function (p) {
    return computeComposite(p, 'shootingThree') >= SHOOTER_THRESHOLD || computeComposite(p, 'shootingMid') >= SHOOTER_THRESHOLD;
  }).length;
  const defenders = rotation.filter(function (p) {
    return computeComposite(p, 'defenseInterior') >= DEFENDER_THRESHOLD || computeComposite(p, 'defensePerimeter') >= DEFENDER_THRESHOLD;
  }).length;
  const reboundThreats = rotation.filter(function (p) { return computeComposite(p, 'rebounding') >= REBOUNDER_THRESHOLD; }).length;

  return {
    offense: synergyRamp(shooters, 3, 0.06),
    defense: synergyRamp(defenders, 3, 0.06),
    rebound: synergyRamp(reboundThreats, 2, 0.05)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COMPOSITE_WEIGHTS: COMPOSITE_WEIGHTS,
    computeComposite: computeComposite,
    synergyRamp: synergyRamp,
    computeTeamSynergy: computeTeamSynergy,
    // Exported so scripts/measure-identity.js can report what share of the
    // league actually clears each bar. Synergy is meant to reward roster
    // CONSTRUCTION; if most of the league qualifies it cannot distinguish
    // anything, which is what these thresholds were doing before the rating
    // rescale — see docs/superpowers/identity-baseline.txt.
    SHOOTER_THRESHOLD: SHOOTER_THRESHOLD,
    DEFENDER_THRESHOLD: DEFENDER_THRESHOLD,
    REBOUNDER_THRESHOLD: REBOUNDER_THRESHOLD
  };
}
