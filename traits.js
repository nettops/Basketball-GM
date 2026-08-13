var _TRAITS_DATA = (typeof require !== 'undefined')
  ? { rng: require('./rng.js'), ratings: require('./ratings.js') }
  : { rng: { makeRng: makeRng }, ratings: { RATING_BANDS: RATING_BANDS } };

// The secret values are calibrated, not picked. Swept against the ppg a
// legendary Sharpshooter's holder actually gains, 300 games per arm on one seed:
//
//   secret value   subject ppg   delta
//        26           23.95      +5.80
//        40           28.05      +9.90   <- shipped
//        55           33.90     +15.75
//        70           37.00     +18.85
//
// 40 lands on the "league-breaking, +8-10 ppg" target. League pts/team moved
// between 101.9 and 102.8 across the WHOLE sweep, so even at +25 ppg a single
// holder does not move league aggregate — the effect is concentrated by design.
// The superstar scale keeps its existing 1.75x ratio to the normal one.
const TRAIT_TIER_SCALE = { bronze: 1, silver: 2, gold: 3, hof: 5, legendary: 8, secret: 40 };
const SUPERSTAR_TIER_SCALE = { bronze: 2, silver: 4, gold: 6, hof: 9, legendary: 14, secret: 70 };
// `secret` is deliberately NOT in TRAIT_TIERS. That array is the set of tiers
// GENERATION can roll, and pickPositiveTier walks it — adding secret there
// would let a player be born with one, which is the one thing it must never be.
// It is reachable only by evolving a legendary badge in the offseason.
const TRAIT_TIERS = ['bronze', 'silver', 'gold', 'hof', 'legendary'];
const SECRET_TIER = 'secret';

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

  // --- Superstar (rare; gated by RATING_BANDS.superstar / .superstarPotential
  //     in traitWeight, on the DISPLAY scale — 7 of 380 players qualify) ---
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

// What each (system, stat) pair actually moves, in the player's words. The
// badge reference reads these rather than restating the pairs, so a badge can
// never be described as doing something the engine does not do.
const TRAIT_EFFECT_LABELS = {
  'boxscore/scoring': 'Scoring',
  'boxscore/assist': 'Assists',
  'boxscore/rebound': 'Rebounding',
  'boxscore/steal': 'Steals',
  'boxscore/block': 'Blocks',
  'boxscore/defense': 'Defence',
  'boxscore/usage': 'Shot volume',
  'chemistry/team': 'Team chemistry',
  'fatigue/accumulation': 'Fatigue',
  'injury/chance': 'Injury risk',
  'injury/recovery': 'Injury recovery',
  'progression/self': 'Own development',
  'progression/teammate': 'Teammate development'
};

// PLAIN ENGLISH, DESCRIBING THE MECHANIC RATHER THAN THE NAME. Several of these
// names promise something the engine does not deliver, and the description has
// to tell the truth instead of flattering the name:
//
//   Explosive Vertical  raises BLOCKS, not dunks
//   High Motor Scorer   raises shot VOLUME, not efficiency
//   Quick Twitch        raises STEALS, not speed
//   Strength Advantage  raises REBOUNDS
//   Free Throw Ace      feeds general scoring, not just the line
//   Mentor              gives its bonus to TEAMMATES, never to the holder
//   Poise               feeds ASSISTS, not scoring
//
// scripts/validate-traits.js asserts every trait has one and that no orphan
// description survives a trait being renamed or removed.
const TRAIT_DESCRIPTIONS = {
  // --- Offensive ---
  sharpshooter: 'Takes more of his shots from three, and makes more of them.',
  postThreat: 'Scores more from the block, and draws the help that opens the floor.',
  finisher: 'Converts more of what he gets at the rim.',
  playmaker: 'Creates more shots for teammates. This one feeds assists, not his own scoring.',
  pickRollMaestro: 'Turns ball screens into points more often.',
  offBallMover: 'Scores more without the ball, on cuts and relocations.',
  freeThrowAce: 'His touch at the line carries into his whole scoring game, not just free throws.',
  highMotorScorer: 'Demands the ball more often. This raises his shot VOLUME, not his efficiency — he takes more shots, he does not make a higher share of them.',

  // --- Defensive ---
  lockdownDefender: 'Makes perimeter shots harder for whoever he is assigned.',
  rimProtector: 'Blocks more shots at the rim.',
  pickpocket: 'Takes the ball away more often.',
  defensiveAnchor: 'Holds up the interior, so shots inside fall less often.',
  chargeTaker: 'Reads drives early and makes them cost something.',
  switchable: 'Guards across positions without giving up the matchup.',
  glassCleaner: 'Ends possessions by finishing the defensive board.',
  pointOfAttackMenace: 'Pressures the ball handler into coughing it up.',

  // --- Athletic ---
  eliteSpeed: 'Beats defenders down the floor and turns it into points.',
  explosiveVertical: 'Plays above the rim. It shows up as BLOCKS rather than dunks.',
  ironMan: 'Gets hurt less often than his minutes suggest he should.',
  quickTwitch: 'First step into the passing lanes. This is a STEALS badge, not a speed one.',
  strengthAdvantage: 'Wins position in traffic and takes the REBOUND.',
  highMotor: 'Tires more slowly, so he holds his level deep into games.',
  springyRebounder: 'Goes back up for second chances on the offensive glass.',
  fastHealer: 'Comes back from injuries sooner than expected.',

  // --- Mental ---
  highIQ: 'Takes better shots because he reads the floor.',
  clutchGene: 'Scores more in the moments that decide games.',
  coachable: 'Improves faster from one season to the next.',
  naturalLeader: 'Lifts the locker room, and the whole roster plays a little better for it.',
  bigGameCompetitor: 'Raises his scoring when the game matters most.',
  filmJunkie: 'Studies, and develops faster for it.',
  poise: 'Stays composed under pressure and keeps finding the right pass. Feeds ASSISTS.',
  mentor: 'Develops the young players around him. The bonus goes to his TEAMMATES — he gets nothing from it himself.',

  // --- Flaws (tier is SEVERITY; legendary is the worst version) ---
  injuryProne: 'Gets hurt more often. Legendary is the worst version of this, not the best.',
  streaky: 'Scoring comes and goes. The floor is lower than the name suggests.',
  turnoverProne: 'Gives the ball away, which eats into his playmaking.',
  foulProne: 'Fouls too much, and it undoes his defence.',
  poorConditioning: 'Tires quickly and fades late in games.',
  lockerRoomCancer: 'Drags the room down. The whole team plays worse.',
  stubborn: 'Resists coaching and develops more slowly.',
  chokeArtist: 'Shrinks when the game is on the line.',

  // --- Superstar (rarer, and roughly double a normal badge at every tier) ---
  alphaDog: 'Takes games over. Superstar-scale scoring lift.',
  iceInVeins: 'Does not flinch late. Superstar-scale scoring lift.',
  twoWayStar: 'Elite at both ends, with a superstar-scale defensive bonus.',
  floorGeneral: 'Runs the offence. Superstar-scale assist lift.',
  unstoppableForce: 'Cannot be kept out of the paint.',
  dpoyCaliber: 'Defensive Player of the Year level — the largest defensive bonus in the game.',
  franchiseCornerstone: 'The room is built around him, and it plays better for it.',
  humanHighlightReel: 'Finishes plays nobody else on the floor finishes.'
};

// SECRET FORMS. A badge already held at LEGENDARY can evolve, once, in the
// offseason. The badge keeps its key — so its affinity, its effect pair and
// every routing decision downstream are untouched — and only its tier and its
// displayed name change. That is what makes this safe to add to a system with
// 13 live effect families: nothing new has to be wired anywhere.
//
// FLAWS HAVE NO SECRET FORM. A legendary flaw metastasising into something
// worse is a good idea and a different feature; this one was asked for as a
// boost, and 40 positive badges is the whole set that can evolve.
const SECRET_FORMS = {
  // --- Offensive ---
  sharpshooter: { name: 'Deadeye', description: 'The shot stopped being a question. He is a threat the moment he crosses half-court.' },
  postThreat: { name: 'Dream Shake', description: 'Nobody guards him on the block one-on-one any more, and everybody knows it.' },
  finisher: { name: 'Rim Wrecker', description: 'Contact stopped mattering. If he gets a step, it is two points.' },
  playmaker: { name: 'Puppet Master', description: 'He decides where the defence goes, then punishes it for going there.' },
  pickRollMaestro: { name: 'Two-Man Game', description: 'The screen has become unguardable regardless of who is setting it.' },
  offBallMover: { name: 'Ghost', description: 'He is never where the defence left him, and he is always open.' },
  freeThrowAce: { name: 'Automatic', description: 'His touch turned into an every-possession weapon, not just a free-throw one.' },
  highMotorScorer: { name: 'Bottomless Tank', description: 'The offence runs through him now, possession after possession, and he never asks out.' },

  // --- Defensive ---
  lockdownDefender: { name: 'Straitjacket', description: 'His assignment stops existing. Teams game-plan to keep the ball away from him.' },
  rimProtector: { name: 'The Wall', description: 'The paint closed. Drivers pull up rather than test him.' },
  pickpocket: { name: 'Sticky Fingers', description: 'Handling the ball near him is a mistake, and he makes them pay every time.' },
  defensiveAnchor: { name: 'Keystone', description: 'The whole defence holds because he does.' },
  chargeTaker: { name: 'Concrete', description: 'He arrives before the drive does, and the drive ends.' },
  switchable: { name: 'Shapeshifter', description: 'One through five, the matchup never favours the offence.' },
  glassCleaner: { name: 'Vacuum', description: 'Defensive possessions end when the shot goes up, not when it comes down.' },
  pointOfAttackMenace: { name: 'Full-Court Pest', description: 'The offence cannot get into its set. It never gets started.' },

  // --- Athletic ---
  eliteSpeed: { name: 'Blur', description: 'In transition he is simply gone, and the game bends around that.' },
  explosiveVertical: { name: 'Skywalker', description: 'Everything at the rim is his. It shows up as blocks, and as fear.' },
  ironMan: { name: 'Titanium', description: 'He does not miss games. The schedule stopped applying to him.' },
  quickTwitch: { name: 'Live Wire', description: 'Every pass near him is a coin flip, and the coin is weighted.' },
  strengthAdvantage: { name: 'Freight Train', description: 'Boxing him out stopped working. The board is his by default.' },
  highMotor: { name: 'Perpetual Motion', description: 'The fourth quarter looks like the first. He does not slow down.' },
  springyRebounder: { name: 'Second Jump', description: 'He is back up before anyone else has landed.' },
  fastHealer: { name: 'Overnight Recovery', description: 'Injuries that should cost him months cost him weeks.' },

  // --- Mental ---
  highIQ: { name: 'Chess Master', description: 'He is two possessions ahead of everyone on the floor, including his own coach.' },
  clutchGene: { name: 'Cold Blooded', description: 'The last five minutes belong to him, and the numbers agree.' },
  coachable: { name: 'Sponge', description: 'He adds a new part of his game every single summer.' },
  naturalLeader: { name: 'Magnetic', description: 'Players want to be on his team. The whole roster is better for it.' },
  bigGameCompetitor: { name: 'Big Stage', description: 'The bigger the game, the further above his own average he plays.' },
  filmJunkie: { name: 'Photographic', description: 'He has seen your set before, and he knows the counter.' },
  poise: { name: 'Unshakeable', description: 'Pressure does not reach him. The right pass still gets made.' },
  mentor: { name: 'Kingmaker', description: 'Young players around him develop at a rate nobody can explain. Still nothing for him.' },

  // --- Superstar ---
  alphaDog: { name: 'Killer Instinct', description: 'He smells a beaten opponent and ends it. The game stops being competitive.' },
  iceInVeins: { name: 'Absolute Zero', description: 'There is no moment big enough to make him blink.' },
  twoWayStar: { name: 'Two-Way Terror', description: 'He is the best player on the floor at both ends, in the same game.' },
  floorGeneral: { name: 'Field Marshal', description: 'The offence is an extension of him. Everyone else is executing his read.' },
  unstoppableForce: { name: 'Juggernaut', description: 'There is no defensive scheme for this. There is only fouling him.' },
  dpoyCaliber: { name: 'Eraser', description: 'Whatever the offence wanted, he takes it away. The best defensive badge in the game.' },
  franchiseCornerstone: { name: 'Dynasty', description: 'The organisation is built around him and it shows in every locker room.' },
  humanHighlightReel: { name: 'Poster Child', description: 'He plays above the game itself, and the building knows it.' }
};

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
    return (player.overall >= _TRAITS_DATA.ratings.RATING_BANDS.superstar ||
            player.potentialDisplay >= _TRAITS_DATA.ratings.RATING_BANDS.superstarPotential) ? 1 : 0;
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
  const skill = (player.rawOverall + player.potential) / 2;
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
    Math.round((player.rawOverall - TRAIT_COUNT_FLOOR) / TRAIT_COUNT_STEP)));
  const candidates = TRAIT_TAXONOMY.filter(function (def) { return traitWeight(player, def) > 0; });
  const selected = weightedSampleWithoutReplacement(candidates, function (def) { return traitWeight(player, def); }, Math.min(traitCount, candidates.length), rng);
  return selected.map(function (def) {
    const tier = def.category === 'negative' ? pickNegativeTier(rng) : pickPositiveTier(player, rng);
    return { key: def.key, tier: tier };
  });
}

// Which shot a scoring trait actually improves, derived from the trait's own
// `affinity` attribute rather than a new taxonomy field. Every scoring trait
// already declares one, and it is exactly the right routing:
//
//   Sharpshooter (threePoint)   -> threes
//   Finisher (insideScoring)    -> inside
//   Post Threat (postScoring)   -> inside
//   Free Throw Ace (freeThrow)  -> the line
//
// Traits whose affinity has no shooting meaning — Elite Speed (speed), Clutch
// Gene (basketballIQ), Alpha Dog (leadership), Human Highlight Reel (vertical)
// — deliberately map to NOTHING here and stay volume-only. Earning more shots
// is what those traits are; improving the stroke is not. A blanket accuracy
// bonus on `boxscore/scoring` would have had Elite Speed fixing your jumper.
const SHOT_ZONE_BY_AFFINITY = {
  threePoint: 'three',
  midRange: 'mid',
  insideScoring: 'inside',
  postScoring: 'inside',
  freeThrow: 'ft'
};

// Returns the raw trait points a player brings to a given shot zone. Callers
// scale it — simEnginePossession divides by SHOT_TRAIT_DIV to turn points into
// probability.
//
// NEGATIVE scoring traits (Streaky, Choke Artist) carry no affinity, so routing
// strictly by zone would silently make them free. A flaw in your shot shows up
// wherever you shoot from, so they apply everywhere.
function shotQualityBonus(player, zone) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== 'boxscore' || def.effect.stat !== 'scoring') return sum;
    const value = def.tierValues[t.tier] * def.effect.direction;
    if (value < 0) return sum + value;
    return SHOT_ZONE_BY_AFFINITY[def.affinity] === zone ? sum + value : sum;
  }, 0);
}

// Which shot a DEFENSIVE badge contests, routed by the trait's own affinity —
// the exact mirror of SHOT_ZONE_BY_AFFINITY above, and for the same reason. A
// flat `boxscore/defense` bonus would have a perimeter stopper protecting the
// rim, which is the error shotQualityBonus was created to avoid on offence.
const DEFENSE_ZONES_BY_AFFINITY = {
  perimeterDefense: ['three', 'mid'],
  interiorDefense: ['inside']
};

// Points a defender takes OFF the shooter's chance in this zone. Always >= 0;
// the caller subtracts it.
//
// Positives with no defensive zone (Charge Taker's basketballIQ, Two-Way Star's
// absent affinity) return 0 here on purpose and earn their keep through the
// ALLOCATION path instead — they draw tougher assignments rather than making
// each contest better. Same shape as unrouted scoring traits being volume-only.
//
// NEGATIVES ARE EXCLUDED ENTIRELY. Foul Prone is the only one, and under the
// scoring precedent it would apply to every zone — meaning opponents shoot
// BETTER against a foul-prone defender. That is a poor model of what fouling
// is, so it routes to the foul rate through foulProneness() instead. This is
// the one place the offence/defence mirror is deliberately broken.
function defenseQualityBonus(player, zone) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== 'boxscore' || def.effect.stat !== 'defense') return sum;
    if (def.effect.direction < 0) return sum;                 // -> foulProneness
    const zones = DEFENSE_ZONES_BY_AFFINITY[def.affinity];
    if (!zones || zones.indexOf(zone) === -1) return sum;     // -> allocation only
    return sum + def.tierValues[t.tier];
  }, 0);
}

// Magnitude of a defender's foul-drawing badges. Always >= 0; the caller adds
// it to the shooting-foul rate. Only negative `boxscore/defense` traits count —
// a good defender is not rewarded with fewer fouls here, because that would
// quietly make every positive defence badge a second, hidden effect.
function foulProneness(player) {
  return (player.hiddenTraits || []).reduce(function (sum, t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    if (!def || def.effect.system !== 'boxscore' || def.effect.stat !== 'defense') return sum;
    if (def.effect.direction > 0) return sum;
    return sum + def.tierValues[t.tier];
  }, 0);
}

// Team chemistry badges, summed across a roster. Signed: Natural Leader and
// Franchise Cornerstone raise it, Locker Room Cancer lowers it. Team-level by
// nature, which is why it feeds computeTeamSynergy rather than any per-player
// weight.
function chemistryBonus(roster) {
  return (roster || []).reduce(function (total, p) {
    return total + getTraitBonus(p, 'chemistry', 'team');
  }, 0);
}

function personalityAxis(base, spread, rng) {
  return Math.max(0, Math.min(100, Math.round(base + (rng() - 0.5) * spread)));
}

function generatePersonality(player, rng) {
  const a = player.attributes;
  return {
    loyalty: personalityAxis(50, 90, rng),
    ambition: personalityAxis(50, 90, rng),
    ego: personalityAxis(30 + player.rawOverall * 0.4, 50, rng),
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
// Measured raw share distribution — re-anchored for the 2K27 face-value
// roster, whose compressed attribute scale halves the raw-share span
// (435 players):
//   p05 0.200   p25 0.289   p50 0.310   p75 0.327   p95 0.351   mean 0.302
// (the old mean-50 league ran p05 0.100 / p50 0.300 / p95 0.447). PIVOT sits
// at that median and maps to itself; LOW and HIGH keep their old percentile
// positions (just below p25, ~p85) so the same share of the league lands in
// each band. The middle band is steeper in absolute slope only because the
// input span shrank — the output geometry (0.08 floor, 0.56 shoulder) is
// unchanged.
const SHARE_LOW = 0.27, SHARE_PIVOT = 0.31, SHARE_HIGH = 0.335;
const SHARE_LOW_OUT = 0.08, SHARE_PIVOT_OUT = 0.31, SHARE_HIGH_OUT = 0.56;
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

// THE EVOLUTION ROLL. Called once per player per offseason, from
// progression.js's progressPlayer.
//
// ONE PER PLAYER, EVER. These do not expire, so without a cap every offseason
// adds holders and only retirement removes them — over twenty seasons the
// league fills up with them and "secret" stops meaning anything. A player who
// already has one is out of the running for good.
//
// Eligibility is the gate that does most of the work: he must already hold a
// POSITIVE badge at legendary. That means the badge he can evolve is decided by
// what he already is, and a player with no legendary badge can never roll at
// all — no separate rarity gate needed on top.
// Calibrated by sweep, not picked. 190 of 380 players are eligible — legendary
// is the MOST common tier, so "holds a legendary" is not itself rare and the
// chance has to do all the gating. Multipliers across the eligible pool sum to
// 353x base, so:
//
//   base      per offseason   best player      steady state (~12yr careers)
//   0.0100         3.53          6.26%             ~42 holders
//   0.0020         0.71          1.25%             ~8.5
//   0.0010         0.35          0.63%             ~4.2      <- shipped
//   0.0005         0.18          0.31%             ~2.1
//
// 0.0010 gives roughly one evolution every three seasons and about four holders
// league-wide at any time — one per seven teams. Rare enough that it is an
// event, common enough that it happens to YOUR player eventually.
const SECRET_BASE_CHANCE = 0.0010;

function secretEvolutionChance(player) {
  // Work ethic is the spine of it: 0.5x at 0, 1.0x at 50, 2.0x at 100.
  const workEthic = (player.attributes && player.attributes.workEthic) || 50;
  const effort = 0.5 + workEthic / 66.7;

  // Coachable and Film Junkie raise it, Stubborn lowers it — and all three sit
  // on the same progression/self axis, so ONE term covers every one of them and
  // any future trait on that axis comes along for free.
  const coaching = 1 + getTraitBonus(player, 'progression', 'self') / 8;

  // Development years. Past 29 this becomes a long shot rather than a path.
  const age = player.age || 27;
  const youth = age <= 25 ? 2.0 : (age <= 29 ? 1.0 : 0.3);

  return SECRET_BASE_CHANCE * effort * Math.max(0.25, coaching) * youth;
}

function eligibleSecretBadges(player) {
  if (!player.hiddenTraits) return [];
  // Already holds one: done, for the rest of his career.
  if (player.hiddenTraits.some(function (t) { return t.tier === SECRET_TIER; })) return [];
  return player.hiddenTraits.filter(function (t) {
    const def = TRAIT_TAXONOMY_BY_KEY[t.key];
    return t.tier === 'legendary' && def && def.category !== 'negative' && SECRET_FORMS[t.key];
  });
}

// Returns the evolved trait ({key, tier, secretName}) or null. Mutates the
// player's hiddenTraits in place when it fires, so the caller only has to
// report it.
//
// DRAWS FROM ITS OWN STREAM, not the offseason's. Taking even one number from
// the shared rng shifts it for every player processed after, which moved the
// rollover golden — verified by stubbing this to null and watching the golden
// go straight back to passing.
//
// Seeding on the player's id plus his age gives a draw that is stable for a
// given player in a given season, different every season as he ages, and
// completely independent of how many players were processed before him. So
// this feature is provably additive: the rest of the offseason is bit-for-bit
// what it was, and the golden proves it rather than being regenerated to hide it.
function rollSecretBadgeEvolution(player) {
  const candidates = eligibleSecretBadges(player);
  if (!candidates.length) return null;
  // Coerced, because hand-built test fixtures do not always carry an id and a
  // crash inside a rarity roll is a poor way to find that out.
  const rng = _TRAITS_DATA.rng.makeRng(
    hashId(String(player.id || player.name || '')) + (player.age || 0) * 7919);
  const roll = rng();
  // ONE roll per player, NOT one per legendary badge. Scaling by the number of
  // candidates gave a player holding three legendaries three times the chance,
  // which pushed the best player in the league to 18.8% a summer and the league
  // to 5.7 evolutions a year. Holding more legendary badges decides WHICH badge
  // can evolve, not how likely it is that one does.
  const chance = secretEvolutionChance(player);
  if (roll >= chance) return null;
  // Which one evolves is decided off the same draw rather than a second one.
  const pick = candidates[Math.min(candidates.length - 1,
    Math.floor((roll / chance) * candidates.length))];
  pick.tier = SECRET_TIER;
  return { key: pick.key, tier: SECRET_TIER, name: SECRET_FORMS[pick.key].name };
}

// One formatter, used by both offseason routes, so the manual-draft path and
// the fast-forward path cannot drift into announcing these differently.
function announceSecretBadges(secretBadges, onFeed) {
  if (!secretBadges || !secretBadges.length || !onFeed) return;
  secretBadges.forEach(function (s) {
    const def = TRAIT_TAXONOMY_BY_KEY[s.key];
    onFeed('SECRET BADGE — ' + s.playerName + ' turned ' +
      (def ? def.name : s.key) + ' into ' + s.name + ' over the summer.');
  });
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
    TRAIT_DESCRIPTIONS: TRAIT_DESCRIPTIONS,
    SECRET_FORMS: SECRET_FORMS,
    SECRET_TIER: SECRET_TIER,
    SECRET_BASE_CHANCE: SECRET_BASE_CHANCE,
    secretEvolutionChance: secretEvolutionChance,
    eligibleSecretBadges: eligibleSecretBadges,
    rollSecretBadgeEvolution: rollSecretBadgeEvolution,
    announceSecretBadges: announceSecretBadges,
    TRAIT_EFFECT_LABELS: TRAIT_EFFECT_LABELS,
    TRAIT_TIERS: TRAIT_TIERS,
    // Exported so scripts/validate-traits.js can check the tier ladder where it
    // actually lands — the share of events a trait wins in weightedPick —
    // rather than trusting the constants to still mean what they meant on a
    // different rating scale.
    TRAIT_TIER_SCALE: TRAIT_TIER_SCALE,
    SUPERSTAR_TIER_SCALE: SUPERSTAR_TIER_SCALE,
    getTraitBonus: getTraitBonus,
    shotQualityBonus: shotQualityBonus,
    SHOT_ZONE_BY_AFFINITY: SHOT_ZONE_BY_AFFINITY,
    defenseQualityBonus: defenseQualityBonus,
    DEFENSE_ZONES_BY_AFFINITY: DEFENSE_ZONES_BY_AFFINITY,
    foulProneness: foulProneness,
    chemistryBonus: chemistryBonus,
    generateHiddenTraits: generateHiddenTraits,
    generatePersonality: generatePersonality,
    generateTendencies: generateTendencies,
    ensureHiddenPlayerData: ensureHiddenPlayerData
  };
}
