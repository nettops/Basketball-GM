// Ultimate abilities — see docs/superpowers/specs/2026-08-12-ultimate-abilities-design.md.
//
// The whole brain of the feature, and deliberately the only file that knows
// what an ultimate IS. It takes plain values and returns plain values: no
// league, no GameState, no rng. gameSim.js owns every state transition and
// simEnginePossession.js only reads the dial numbers this file produces.
//
// DRAWS NO RNG, BY DESIGN. The meter is bookkeeping over events that already
// happened, so a takeover is the consequence of a night already going well
// rather than a die roll that decides a game. It also means the seeded stream
// is untouched and the same game replays identically — which is what lets both
// golden masters stay byte-identical until the dials are actually applied.
var _ULT_DATA = (typeof require !== 'undefined')
  ? { composite: require('./compositeRatings.js') }
  : { composite: { computeComposite: computeComposite } };

// Who qualifies. RATING_BANDS.star is on the DISPLAY scale (see ratings.js) —
// gating on rawOverall here would silently admit a completely different set of
// players, and everything would still appear to work.
//
// gateOverall and badgeBoost are calibrated in the calibration task; the
// measured sweeps live in the comments there.
// badgeTieBreak is in PERCENTILE POINTS, matching deriveScore's 0-1 scale. Two
// points is enough to settle a near-tie in favour of a badge the player
// actually holds, and far too small to override a genuine strength.
//
// gateOverall 85 measured, not picked. Holders league-wide, 2026:
//   gate 84 -> 42    gate 86 -> 29    gate 88 -> 20
//   gate 85 -> 36    gate 87 -> 23    gate 89 -> 12
// The target band is 30-60, so 84 and 85 both qualify and 85 is the tighter
// "one or two per team, some teams none" the design asks for.
const ULTIMATE_TUNING = {
  gateOverall: 85,
  badgeTieBreak: 0.02,
  badgeBoost: 1.35
};

// `derive` is how a player's fitness for this ultimate is scored: either one
// compositeRatings key, or a list of raw attributes averaged. `badges` are the
// badge keys whose legendary/secret form boosts it. `norm` is the measured
// DECILE TABLE of that score across all 2026 players — eleven values, from the
// league minimum to the league maximum.
//
// TWO separate things had to be fixed here, and it is worth keeping them
// straight because they look like one problem and are not.
//
// FIRST, and the one that actually mattered: the derivations OVERLAPPED. Paint
// Beast, And-One and Above the Rim all pointed at the same big men, and Paint
// Beast lost every time — held by NOBODY in the league at any gate, however it
// was scored. Silky ran through the shootingMid composite, which folds in
// basketball IQ and so drifted toward "generally smart" rather than "shoots
// from fifteen feet". The fix was to give each ultimate a source the others do
// not touch: post scoring plus strength for Paint Beast, mid-range alone for
// Silky, ball handling plus speed for Downhill (acceleration belongs to Above
// the Rim). scripts/validate-ultimates.js asserts every ultimate is held by
// somebody in the real league, which is the guard that catches this class of
// bug — a synthetic test proving an ultimate CAN be derived does not prove
// anybody gets one.
//
// SECOND, the ruler. Three were measured, on the corrected derivations:
//
//   ruler                largest share   unheld
//   raw score                 22%        none
//   median-to-95th span       25%        heatCheck
//   percentile rank           19%        none      <- shipped
//
// Raw scores work once the derivations are clean, so the normaliser was not the
// cure. It is still the right ruler: composites are not on a shared scale (an
// average player scores 53 on Above the Rim and 46 on Paint Beast), and the
// span version is actively wrong — dividing by a narrow spread INFLATES the
// score, so work ethic (spanning 19 points) beat passing (spanning 36) for the
// same edge, and the league's best scorer derived "Motor Never Stops". Rank is
// invariant to distribution shape, which is the only property that matters for
// the question "what is this man best at compared to everyone else".
//
// The three sources that are UNIVERSAL rather than distinctive — basketball IQ,
// strength, work ethic — are why Cold Blooded, And-One and Motor Never Stops
// still draw well. That is intended: they are the "great player" ultimates.
const ULTIMATE_TAXONOMY = [
  { key: 'heatCheck', name: 'Heat Check', kind: 'solo', side: 'offense',
    derive: { composite: 'shootingThree' },
    norm: [9, 24.3, 30, 40.8, 48, 53.3, 58.3, 63, 67, 72.8, 97.3],
    badges: ['sharpshooter'] },
  { key: 'silky', name: 'Silky', kind: 'solo', side: 'offense',
    derive: { attributes: ['midRange'] },
    norm: [4, 25, 32, 38, 43, 48, 52, 56, 62, 73, 97],
    badges: ['offBallMover'] },
  { key: 'paintBeast', name: 'Paint Beast', kind: 'solo', side: 'offense',
    derive: { attributes: ['postScoring', 'strength'] },
    norm: [13, 29, 33.5, 36.5, 39.5, 45, 49, 54, 59, 65, 95],
    badges: ['postThreat', 'unstoppableForce'] },
  { key: 'downhill', name: 'Downhill', kind: 'solo', side: 'offense',
    derive: { attributes: ['ballHandling', 'speed'] },
    norm: [13, 27.5, 34.5, 40.5, 43.5, 48, 53.5, 59, 64.5, 72, 90],
    badges: ['pickRollMaestro', 'eliteSpeed'] },
  { key: 'aboveTheRim', name: 'Above the Rim', kind: 'solo', side: 'offense',
    derive: { attributes: ['vertical', 'acceleration'] },
    norm: [14.5, 39, 43, 45.5, 48.5, 51.5, 55.5, 59, 63.5, 69, 97],
    badges: ['explosiveVertical', 'humanHighlightReel'] },
  { key: 'andOne', name: 'And-One', kind: 'solo', side: 'offense',
    derive: { attributes: ['strength', 'freeThrow'] },
    norm: [20, 35.5, 40, 44, 46.5, 50, 53, 56.5, 59, 67, 92],
    badges: ['finisher', 'freeThrowAce'] },
  { key: 'glassWrecker', name: 'Glass Wrecker', kind: 'solo', side: 'offense',
    derive: { composite: 'rebounding' },
    norm: [17.3, 35.3, 38.8, 42.8, 45.5, 49, 51.8, 55.8, 60.8, 66.8, 93.5],
    badges: ['glassCleaner', 'springyRebounder'] },
  { key: 'coldBlooded', name: 'Cold Blooded', kind: 'solo', side: 'offense',
    derive: { attributes: ['basketballIQ'] },
    norm: [9, 36, 42, 47, 50, 53, 56, 60, 63, 70, 99],
    badges: ['clutchGene', 'iceInVeins'] },
  { key: 'clamps', name: 'Clamps', kind: 'solo', side: 'defense',
    derive: { composite: 'defensePerimeter' },
    norm: [28.3, 36.7, 40.9, 44.6, 47.9, 51.8, 55.7, 58.6, 62.2, 66.4, 86.6],
    badges: ['lockdownDefender', 'pointOfAttackMenace'] },
  { key: 'motorNeverStops', name: 'Motor Never Stops', kind: 'solo', side: 'offense',
    derive: { attributes: ['workEthic'] },
    norm: [24, 39, 44, 46, 50, 52, 54, 58, 62, 66, 89],
    badges: ['highMotor'] },
  { key: 'floorGeneral', name: 'Floor General', kind: 'team', side: 'offense',
    derive: { attributes: ['passing'] },
    norm: [10, 28, 32, 36, 40, 45, 48, 53, 61, 73, 100],
    badges: ['playmaker', 'floorGeneral'] },
  { key: 'theWall', name: 'The Wall', kind: 'team', side: 'defense',
    derive: { composite: 'defenseInterior' },
    norm: [12.1, 29.9, 34.6, 38, 41.4, 43.5, 47, 51.1, 59.4, 68.1, 96.8],
    badges: ['rimProtector', 'dpoyCaliber'] }
];

const ULTIMATE_BY_KEY = {};
ULTIMATE_TAXONOMY.forEach(function (u) { ULTIMATE_BY_KEY[u.key] = u; });

// Only the top two tiers boost. A bronze Sharpshooter is a common badge; if it
// counted, nearly every Heat Check holder would be boosted and the boost would
// mean nothing.
const BOOSTING_TIERS = { legendary: true, secret: true };

// The closed set of plays the engine may report. A kind not on this list earns
// nothing rather than throwing — but validate-ultimates.js asserts statically
// that the engine only ever reports kinds that ARE on it, so a typo in the
// engine fails loudly in the test rather than silently zeroing a player's meter
// for the rest of the game.
const PLAY_KINDS = ['madeThree', 'madeTwo', 'freeThrow', 'assist', 'steal',
  'block', 'rebound', 'offRebound', 'missedShot', 'turnover', 'foul'];

// Values are relative to a 100-point meter. Calibrated against the measured
// takeover rate; the sweep lives above `full` below.
//
// Drains are what make a takeover EARNED rather than scheduled: a star shooting
// 4-for-15 moves backwards and never reaches one regardless of minutes played.
const CHARGE_TUNING = {
  full: 100,
  // A second takeover in one game should be the night people remember, not a
  // routine second helping.
  secondFullMultiplier: 1.6,
  takeoverPossessions: 20,
  longTakeoverPossessions: 50,
  gains: {
    madeThree: 9, madeTwo: 6, freeThrow: 2, assist: 5, steal: 8,
    block: 8, rebound: 3, offRebound: 5,
    missedShot: -4, turnover: -9, foul: -3
  },
  // A play in the ultimate's own currency is worth more to it. This is what
  // makes Glass Wrecker charge off boards while Heat Check charges off threes,
  // rather than all twelve filling identically.
  affinityMultiplier: 1.6,
  situation: {
    // Closeness bands, tightest first. `within` is the absolute score margin.
    closeness: [{ within: 5, mult: 1.5 }, { within: 10, mult: 1.2 },
                { within: 20, mult: 1.0 }, { within: Infinity, mult: 0.4 }],
    periodMult: { fourth: 1.5, overtime: 2.0 },
    trailingMult: 1.2
  }
};

// Which play kinds are each ultimate's own currency.
const CHARGE_AFFINITY = {
  heatCheck: ['madeThree'],
  silky: ['madeTwo'],
  paintBeast: ['madeTwo', 'freeThrow'],
  downhill: ['madeTwo', 'assist'],
  aboveTheRim: ['madeTwo', 'block', 'offRebound'],
  andOne: ['freeThrow', 'madeTwo'],
  glassWrecker: ['rebound', 'offRebound'],
  coldBlooded: ['madeThree', 'madeTwo'],
  clamps: ['steal'],
  motorNeverStops: ['rebound', 'assist'],
  floorGeneral: ['assist'],
  theWall: ['block']
};

// Cold Blooded's meter is dead until the fourth quarter. Not a special case —
// it is the same situation rule as everyone else with the first three periods
// multiplied to zero, which is what makes it the rarest thing in the game and
// guarantees it always arrives at the worst possible moment for the opponent.
const LATE_GAME_ONLY = { coldBlooded: true };

function situationMultiplier(ultimateKey, scoreDiff, period) {
  if (LATE_GAME_ONLY[ultimateKey] && period < 4) return 0;
  const s = CHARGE_TUNING.situation;
  const diff = scoreDiff || 0;
  const margin = Math.abs(diff);
  let mult = 1;
  for (let i = 0; i < s.closeness.length; i++) {
    if (margin <= s.closeness[i].within) { mult = s.closeness[i].mult; break; }
  }
  if (period >= 5) mult *= s.periodMult.overtime;
  else if (period === 4) mult *= s.periodMult.fourth;
  if (diff < 0) mult *= s.trailingMult;
  return mult;
}

function chargeGain(ultimateKey, playKind, situationMult) {
  const base = CHARGE_TUNING.gains[playKind];
  if (base === undefined) return 0;
  // Drains are NOT scaled by the situation: a turnover in a blowout still costs
  // what a turnover costs. Only the earning side responds to the moment,
  // because it is the earning side the design wants pushed into the fourth.
  if (base < 0) return base;
  const affinity = CHARGE_AFFINITY[ultimateKey] || [];
  const affinityMult = affinity.indexOf(playKind) !== -1 ? CHARGE_TUNING.affinityMultiplier : 1;
  return base * affinityMult * (situationMult === undefined ? 1 : situationMult);
}

function chargeThreshold(takeoversUsed) {
  return CHARGE_TUNING.full * Math.pow(CHARGE_TUNING.secondFullMultiplier, takeoversUsed || 0);
}

function takeoverLength(ultimateKey) {
  return ultimateKey === 'motorNeverStops'
    ? CHARGE_TUNING.longTakeoverPossessions
    : CHARGE_TUNING.takeoverPossessions;
}

function hasUltimate(player) {
  return !!player && (player.overall || 0) >= ULTIMATE_TUNING.gateOverall;
}

function rawScore(player, ultimate) {
  const d = ultimate.derive;
  if (d.composite) return _ULT_DATA.composite.computeComposite(player, d.composite);
  const attrs = player.attributes || {};
  let sum = 0;
  for (let i = 0; i < d.attributes.length; i++) {
    const v = attrs[d.attributes[i]];
    sum += (v === undefined ? 50 : v);
  }
  return sum / d.attributes.length;
}

// Where a value sits in a measured decile table, as a fraction from 0 to 1,
// interpolated inside whichever decile it falls in. See the taxonomy comment
// for the two rulers measured against this one.
function percentileIn(value, table) {
  if (!table || table.length !== 11) return 0.5;
  if (value <= table[0]) return 0;
  if (value >= table[10]) return 1;
  for (let i = 1; i <= 10; i++) {
    if (value <= table[i]) {
      const lo = table[i - 1], hi = table[i];
      return ((i - 1) + (hi > lo ? (value - lo) / (hi - lo) : 0)) / 10;
    }
  }
  return 1;
}

// This player's league rank on THIS ultimate's source, 0 to 1.
function deriveScore(player, ultimate) {
  return percentileIn(rawScore(player, ultimate), ultimate.norm);
}

function badgeBoostFor(player, ultimate) {
  if (!ultimate) return 1;
  const held = (player && player.hiddenTraits) || [];
  for (let i = 0; i < held.length; i++) {
    if (BOOSTING_TIERS[held[i].tier] && ultimate.badges.indexOf(held[i].key) !== -1) {
      return ULTIMATE_TUNING.badgeBoost;
    }
  }
  return 1;
}

// Deterministic: highest derived score wins, and a matching badge of ANY tier
// breaks ties. Iteration order of ULTIMATE_TAXONOMY settles an exact tie, so
// the same player always derives the same ultimate — which is what lets a
// player who develops in a new direction grow into a different one without
// anything being stored on him.
function ultimateFor(player) {
  if (!hasUltimate(player)) return null;
  const held = (player.hiddenTraits) || [];
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < ULTIMATE_TAXONOMY.length; i++) {
    const u = ULTIMATE_TAXONOMY[i];
    let score = deriveScore(player, u);
    for (let j = 0; j < held.length; j++) {
      if (u.badges.indexOf(held[j].key) !== -1) { score += ULTIMATE_TUNING.badgeTieBreak; break; }
    }
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ULTIMATE_TUNING: ULTIMATE_TUNING,
    ULTIMATE_TAXONOMY: ULTIMATE_TAXONOMY,
    ULTIMATE_BY_KEY: ULTIMATE_BY_KEY,
    PLAY_KINDS: PLAY_KINDS,
    CHARGE_TUNING: CHARGE_TUNING,
    CHARGE_AFFINITY: CHARGE_AFFINITY,
    hasUltimate: hasUltimate,
    ultimateFor: ultimateFor,
    badgeBoostFor: badgeBoostFor,
    percentileIn: percentileIn,
    situationMultiplier: situationMultiplier,
    chargeGain: chargeGain,
    chargeThreshold: chargeThreshold,
    takeoverLength: takeoverLength
  };
}
