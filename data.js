const ATTRIBUTE_KEYS = [
  'insideScoring', 'midRange', 'threePoint', 'freeThrow', 'passing',
  'ballHandling', 'postScoring', 'perimeterDefense', 'interiorDefense',
  'steal', 'block', 'offReb', 'defReb', 'speed', 'acceleration',
  'strength', 'vertical', 'basketballIQ', 'leadership', 'workEthic'
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const CONFERENCES = ['Eastern', 'Western'];

const DIVISIONS = {
  Eastern: ['Atlantic', 'Central', 'Southeast'],
  Western: ['Northwest', 'Pacific', 'Southwest']
};

const CAP_CONSTANTS = {
  SALARY_CAP: 154000000,
  LUXURY_TAX_LINE: 187000000,
  // Real NBA floor sits at 90% of the cap — teams under it owe the
  // shortfall to their own roster at season end (see finances.js).
  SALARY_FLOOR: 138600000,
  // Real NBA luxury tax is a graduated bracket system; this is a
  // deliberately simple flat-rate approximation, purely for a rough dollar
  // estimate/deduction, not exact bracket enforcement.
  LUXURY_TAX_RATE: 1.5
};

// capLevel is a settings-driven multiplier (default 1.0) on the base cap
// figures above — lets ui/settings.js offer a "cap level" slider without
// every consumer needing its own scaling logic.
function getEffectiveSalaryCap(capLevel) {
  return Math.round(CAP_CONSTANTS.SALARY_CAP * (capLevel || 1));
}

function getEffectiveLuxuryTaxLine(capLevel) {
  return Math.round(CAP_CONSTANTS.LUXURY_TAX_LINE * (capLevel || 1));
}

function getEffectiveSalaryFloor(capLevel) {
  return Math.round(CAP_CONSTANTS.SALARY_FLOOR * (capLevel || 1));
}

// A true 0-100 scale, matching ZenGM's. These were 25/99, which combined with
// the old `attribute = overall + archetypeOffset` generator put every rating
// in 48-99 with a league mean of 74.2 — while every formula downstream is
// written as `(composite - 50) / K` and assumes 50 is average. See
// docs/superpowers/plans/2026-08-08-ratings-and-overall.md.
const RATING_MIN = 0;
const RATING_MAX = 100;

const PLAYER_ARCHETYPES = {
  scorer: {
    name: "Scorer",
    description: "Volume scorer who takes over games",
    startingOverall: 70,
    startingPotential: 88,
    badge_affinity: ["scorer", "3pt_threat", "ball_handler"]
  },
  defender: {
    name: "Defender",
    description: "Elite defender, lockdown mentality",
    startingOverall: 68,
    startingPotential: 85,
    badge_affinity: ["defender", "steal_artist", "shot_blocker"]
  },
  playmaker: {
    name: "Playmaker",
    description: "Pass-first point guard",
    startingOverall: 69,
    startingPotential: 86,
    badge_affinity: ["playmaker", "ball_handler", "assists"]
  },
  rebounder: {
    name: "Rebounder",
    description: "Elite rebounder and interior presence",
    startingOverall: 68,
    startingPotential: 84,
    badge_affinity: ["rebounder", "shot_blocker", "interior_defense"]
  },
  all_around: {
    name: "All-Around",
    description: "Balanced player with versatile skills",
    startingOverall: 66,
    startingPotential: 82,
    badge_affinity: ["defender", "scorer", "playmaker"]
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATTRIBUTE_KEYS, POSITIONS, CONFERENCES, DIVISIONS,
    CAP_CONSTANTS, RATING_MIN, RATING_MAX, PLAYER_ARCHETYPES,
    getEffectiveSalaryCap, getEffectiveLuxuryTaxLine, getEffectiveSalaryFloor
  };
}
