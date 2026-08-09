// One opposed-attribute check, used everywhere the possession engine decides
// whether something happened. Before this, each contest was hand-rolled with
// its own divisor and centring convention — turnover used a raw difference over
// 400, shot-make used two centred terms over 250 and 350, block used one over
// 420. Three shapes meant badges had to be bolted on in three places and the
// math was invisible to the UI.
//
// Zero dependencies BY DESIGN: this takes plain numbers, never players or
// ratings modules, so it can be unit-tested without loading a league and reused
// by anything. The caller resolves composites and trait bonuses; this does the
// arithmetic and the roll.
//
// `attack` is whoever WANTS THE CHECK TO PASS, not whoever has the ball. On a
// turnover check the defender is the attacking side. Naming by outcome rather
// than by possession is what lets one function cover contests running in both
// directions instead of needing an inverted twin.

// 50 is the middle of the rating scale (data.js RATING_MIN 0 / RATING_MAX 100),
// so an average player contributes exactly nothing and `base` means what it says.
const SKILL_CHECK_CENTRE = 50;

function skillCheckSideTerm(side) {
  if (!side || !side.scale) return 0;
  const energy = side.energy === undefined ? 1 : side.energy;
  return (side.value - SKILL_CHECK_CENTRE) / side.scale * energy;
}

// Split out from skillCheck so the arithmetic can be tested without consuming
// an rng draw, and so a caller that only wants the probability (a UI preview,
// a calibration sweep) does not perturb the stream.
function skillCheckProbability(spec) {
  const attackTerm = skillCheckSideTerm(spec.attack);
  const defendTerm = skillCheckSideTerm(spec.defend);
  let modifierTotal = 0;
  const mods = spec.modifiers || [];
  for (let i = 0; i < mods.length; i++) modifierTotal += mods[i].value;
  const raw = spec.base + attackTerm - defendTerm + modifierTotal;
  const min = spec.min === undefined ? 0 : spec.min;
  const max = spec.max === undefined ? 1 : spec.max;
  return {
    attackTerm: attackTerm,
    defendTerm: defendTerm,
    modifierTotal: modifierTotal,
    // raw is kept UNCLAMPED so a consumer can show that a value was capped
    // rather than silently presenting the cap as if it were the calculation.
    raw: raw,
    probability: Math.max(min, Math.min(max, raw))
  };
}

// Draws from rng EXACTLY ONCE, replacing the `rng() < chance` it stands in for.
// Two draws or zero draws desynchronises every later possession in the game,
// which is why validate-skillCheck.js counts them.
function skillCheck(spec, rng) {
  const p = skillCheckProbability(spec);
  const roll = rng();
  return {
    kind: spec.kind,
    base: spec.base,
    attack: spec.attack || null,
    defend: spec.defend || null,
    modifiers: spec.modifiers || [],
    attackTerm: p.attackTerm,
    defendTerm: p.defendTerm,
    modifierTotal: p.modifierTotal,
    raw: p.raw,
    probability: p.probability,
    roll: roll,
    // `<` not `<=`, matching the rng() < chance idiom this replaces exactly.
    passed: roll < p.probability
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKILL_CHECK_CENTRE: SKILL_CHECK_CENTRE,
    skillCheckSideTerm: skillCheckSideTerm,
    skillCheckProbability: skillCheckProbability,
    skillCheck: skillCheck
  };
}
