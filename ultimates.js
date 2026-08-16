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
//
// gateOverall is only the FALLBACK, used before any league snapshot has been
// taken (which is exactly the 2026 league it was measured on). The live gate is
// RANK-BASED — the gateCount-th best player — and that matters:
//
// An absolute rating gate does not hold "the top 30-60 players" for long,
// because the league's rating distribution drifts upward as generated players
// replace the 2026 roster. Measured over a 20-season run, players at 85+ went
// 36 -> 42 -> ... -> 75, double the intended band, and with them league scoring
// drifted about two points high and the best scorer's peak season went from
// roughly 51 points a game to 62. Season one looked perfect the whole time.
const ULTIMATE_TUNING = {
  // 83, remeasured for the 2K27 import's display curve (knots moved, the
  // whole middle of the scale compressed): the 36th-best display overall in
  // the imported league is 83, and the old floor of 85 was OVERRIDING the
  // rank-based gate — 22 holders against the 30-60 band, with the rank
  // machinery working perfectly underneath.
  gateOverall: 87,
  gateCount: 36,
  // 0.03, widened from 0.02 when the norm decile tables were regenerated for
  // the 2K27 face-value scale: the diversity pass's own motivating example —
  // Giannis near-tied on Glass Wrecker — measured 0.016 on the old tables and
  // 0.0252 on the new ones. Same physical near-tie, coarser ruler (the tables
  // are 11-point step-linear percentiles), so the definition of "near" moves
  // with it. Every other unheld ultimate's best claimant sits at 0.018 or
  // less; the next gap beyond Giannis is 0.033, a genuine strength.
  badgeTieBreak: 0.03,
  badgeBoost: 1.35
};

// Set from the live league whenever the population changes (seasonRollover.js).
// Null until then, which makes hasUltimate fall back to gateOverall.
var _leagueGate = null;

// League-aware assignment overrides (player id -> taxonomy entry), rebuilt by
// setLeagueGate's diversity pass below. Null until a snapshot exists, which
// leaves ultimateFor on its pure per-player argmax.
var _assignmentOverrides = null;

// The gateCount-th highest overall in the league, floored at gateOverall so a
// depleted or expansion league cannot hand ultimates to ordinary players.
//
// ALSO the diversity pass. Pure argmax alone left ultimates unheld league-wide
// on the 2K27 roster — measured: Embiid TIED 1.000/1.000 between And-One and
// Paint Beast and lost on list order, Tatum lost Motor Never Stops by 0.008,
// Giannis lost Glass Wrecker by 0.016 — every gap inside badgeTieBreak, the
// design's own definition of a near-tie. So when an ultimate would be held by
// NOBODY, it may claim the near-tied holder with the smallest gap, provided
// that holder's argmax family keeps at least one other holder. Deterministic,
// draws no rng, and rebuilt at every league snapshot like the gate itself.
function setLeagueGate(players) {
  if (!players || !players.length) { _leagueGate = null; _assignmentOverrides = null; return null; }
  const overalls = players
    .map(function (p) { return p.overall || 0; })
    .sort(function (a, b) { return b - a; });
  const nth = overalls[Math.min(overalls.length, ULTIMATE_TUNING.gateCount) - 1];
  _leagueGate = Math.max(ULTIMATE_TUNING.gateOverall, nth);

  _assignmentOverrides = null;   // ultimateFor below must run pure argmax here
  const holders = players.filter(function (p) { return hasUltimate(p); });
  const byKey = {};   // ultimate key -> holder entries assigned by argmax
  const entries = holders.map(function (p) {
    const own = ultimateFor(p);
    const e = { player: p, own: own, ownScore: deriveScore(p, own) };
    (byKey[own.key] = byKey[own.key] || []).push(e);
    return e;
  });
  const overrides = {};
  ULTIMATE_TAXONOMY.forEach(function (u) {
    if (byKey[u.key] && byKey[u.key].length > 0) return;   // already held
    let best = null, bestGap = Infinity;
    entries.forEach(function (e) {
      if (overrides[e.player.id]) return;                   // already claimed
      if ((byKey[e.own.key] || []).length < 2) return;      // would orphan its family
      const gap = e.ownScore - deriveScore(e.player, u);
      if (gap <= ULTIMATE_TUNING.badgeTieBreak && gap < bestGap) { bestGap = gap; best = e; }
    });
    if (best) {
      overrides[best.player.id] = u;
      byKey[best.own.key] = byKey[best.own.key].filter(function (e) { return e !== best; });
      (byKey[u.key] = byKey[u.key] || []).push(best);
    }
  });
  _assignmentOverrides = overrides;
  return _leagueGate;
}

function currentGate() {
  return _leagueGate === null ? ULTIMATE_TUNING.gateOverall : _leagueGate;
}

// `derive` is how a player's fitness for this ultimate is scored: either one
// compositeRatings key, or a list of raw attributes averaged. `badges` are the
// badge keys whose legendary/secret form boosts it. `norm` is the measured
// DECILE TABLE of that score across the league (re-measured for the 2K27
// import by the inline regenerator in the import commit) — eleven values, from the
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
    norm: [31.5, 63.6, 69.5, 72.3, 74.3, 76, 77.5, 78.8, 80.5, 82.3, 94.3],
    badges: ['sharpshooter'] },
  { key: 'silky', name: 'Silky', kind: 'solo', side: 'offense',
    derive: { attributes: ['midRange'] },
    norm: [25, 60, 68, 70, 72, 75, 78, 80, 85, 90.6, 99],
    badges: ['offBallMover'] },
  { key: 'paintBeast', name: 'Paint Beast', kind: 'solo', side: 'offense',
    derive: { attributes: ['postScoring', 'strength'] },
    norm: [29.5, 42, 46.5, 49.5, 53.5, 56, 60.5, 64.4, 69, 76.8, 96],
    badges: ['postThreat', 'unstoppableForce'] },
  { key: 'downhill', name: 'Downhill', kind: 'solo', side: 'offense',
    derive: { attributes: ['ballHandling', 'speed'] },
    norm: [27.5, 52.5, 60.5, 67.5, 71, 74, 76.5, 79, 81.5, 84.5, 94.5],
    badges: ['pickRollMaestro', 'eliteSpeed'] },
  { key: 'aboveTheRim', name: 'Above the Rim', kind: 'solo', side: 'offense',
    derive: { attributes: ['vertical', 'acceleration'] },
    norm: [36.5, 62.2, 69.5, 72.5, 75, 77, 79, 80.5, 83, 86, 97],
    badges: ['explosiveVertical', 'humanHighlightReel'] },
  { key: 'andOne', name: 'And-One', kind: 'solo', side: 'offense',
    derive: { attributes: ['strength', 'freeThrow'] },
    norm: [51.5, 60.5, 63.4, 65.1, 67, 69, 70.5, 72.5, 74.5, 77.5, 90.5],
    badges: ['finisher', 'freeThrowAce'] },
  { key: 'glassWrecker', name: 'Glass Wrecker', kind: 'solo', side: 'offense',
    derive: { composite: 'rebounding' },
    norm: [40.8, 51.8, 54.2, 56.5, 58.7, 61.3, 64.3, 66.5, 71.3, 76.7, 90.8],
    badges: ['glassCleaner', 'springyRebounder'] },
  { key: 'coldBlooded', name: 'Cold Blooded', kind: 'solo', side: 'offense',
    derive: { attributes: ['basketballIQ'] },
    norm: [44, 57, 61, 63, 65, 68, 70, 72, 76, 80, 94],
    badges: ['clutchGene', 'iceInVeins'] },
  { key: 'clamps', name: 'Clamps', kind: 'solo', side: 'defense',
    derive: { composite: 'defensePerimeter' },
    norm: [33.3, 49.2, 55.1, 58, 60.6, 63.2, 66, 69.3, 72.9, 79, 96.6],
    badges: ['lockdownDefender', 'pointOfAttackMenace'] },
  { key: 'motorNeverStops', name: 'Motor Never Stops', kind: 'solo', side: 'offense',
    derive: { attributes: ['workEthic'] },
    norm: [50, 70, 75, 80, 85, 85, 85, 90, 90, 95, 99],
    badges: ['highMotor'] },
  { key: 'floorGeneral', name: 'Floor General', kind: 'team', side: 'offense',
    derive: { attributes: ['passing'] },
    norm: [33, 44.4, 50.8, 54, 58, 61, 66, 71, 75, 79, 97],
    badges: ['playmaker', 'floorGeneral'] },
  { key: 'theWall', name: 'The Wall', kind: 'team', side: 'defense',
    derive: { composite: 'defenseInterior' },
    norm: [32.9, 46.6, 50.4, 53.8, 57.7, 61.6, 64.3, 67.3, 71, 77.8, 88.6],
    badges: ['rimProtector', 'dpoyCaliber'] }
];

// One sentence per ultimate, in the player's words. ui/ultimates.js reads these
// rather than restating what an ultimate does, so an ultimate whose dials are
// retuned can never end up described as doing something it no longer does —
// the same rule the badge reference already follows.
const ULTIMATE_DESCRIPTIONS = {
  heatCheck: 'Starts hunting threes, and they start dropping.',
  silky: 'Pull-ups from everywhere inside the arc begin to fall.',
  paintBeast: 'Bullies the rim — shots inside, and trips to the line.',
  downhill: 'Gets to the basket at will, and stops coughing the ball up.',
  aboveTheRim: 'Dunks, put-backs and chase-down blocks.',
  andOne: 'Stops settling and goes through people. The free throws pile up.',
  glassWrecker: 'Owns the boards, and cleans up his own team’s misses.',
  coldBlooded: 'The fourth quarter arrives and everything goes in.',
  clamps: 'Takes the other team’s ball-handler out of the game.',
  motorNeverStops: 'He stops getting tired. The man guarding him does not.',
  floorGeneral: 'All five on the floor shoot better and stop turning it over.',
  theWall: 'The other team’s shots stop falling.'
};

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

// Drains are what make a takeover EARNED rather than scheduled: a star shooting
// 4-for-15 moves backwards and never reaches one regardless of minutes played.
//
// `full` measured, not picked. Full seasons through league.simulateDate, seed
// 4242, everything else held:
//
//   full   takeovers/game   star-game share   2nd in 1 game per   pts added   league scoring
//   100        2.836              84.4%              1.2             12.2        136.53
//   160        1.780              70.7%              5.8             13.1        136.01
//   200        1.326              55.5%             35.1             13.2        135.13
//   240        1.006              42.4%            615.0             13.4        135.21
//   280        0.713              30.1%              never           13.9        134.94
//
// Re-measured after the runway rule and the third-quarter peak (see periodMult
// below), which between them changed how many meters get to spend themselves:
//
//   full   takeovers/game   pts, every takeover   league scoring
//   240        1.102                10.8             135.02
//   255        0.958                10.9             135.23   <- shipped
//   280        0.769                10.1             134.63
//
// TWO OF THE DESIGN'S TARGETS CANNOT BOTH BE MET, and it is worth writing down
// why rather than quietly missing one. The spec asks for ~1.0 takeovers per
// game AND ~50% of star-games producing one. Those are not independent:
//
//   takeovers per game = star-game share x holders on the floor per game
//
// With 36 holders across 30 teams, roughly 2.4 of them play in any given game,
// so 1.0 per game forces the share to 42%, and 50% would force the rate to 1.2.
// The per-game rate is the one a player actually experiences, so it wins; 42%
// is the honest consequence, not a miss.
//
// `secondFullMultiplier` measured at full 240. The design asks for a second
// takeover roughly once every fifteen games:
//
//   multiplier   2nd in 1 game per   takeovers/game   pts added
//      1.00            12.7               1.085         13.9
//      1.08            18.9               1.020         14.3   <- shipped
//      1.15            33.2               1.017         13.4
//      1.25            43.9               1.002         13.4
//      1.60           615.0               1.006         13.4
//
// 1.6 was the guess and it made a second takeover essentially impossible — a
// nice-sounding number that deleted a feature. 1.08 is a small extra cost that
// still produces the rare "he went nuclear" night.
const CHARGE_TUNING = {
  // 200, re-measured for the 2K27 import: the imported holders' charge
  // profiles fill the meter slower (0.644 takeovers/game at the old 255,
  // against the 0.7-1.4 band). Swept 255/235/215/200 over 90 real games:
  // 200 -> 0.989/game, back on the ~1-per-game the design aims at.
  //
  // 200 -> 160 when regulation became 38 minutes. A meter that fills over the
  // course of a game has the game's length baked into it, so a shorter one
  // charges fewer times: 0.672/game on the validator's season, under the 0.7
  // floor. Swept on the live season path, two seeds each:
  //   200 -> 0.740 / 0.745    170 -> 0.908 / 0.831
  //   185 -> 0.871 / 0.820    160 -> 0.898 / 0.888    150 -> 0.883 / 0.809
  //
  // Note it PLATEAUS around 0.89 rather than climbing to 1 — below ~170 the
  // limit stops being the threshold and becomes the game itself, since a
  // takeover also needs minRunPossessions left on the clock to fire at all.
  // 150 is already past the point of buying anything. 160 is taken over 170
  // for the tighter seed-to-seed pair, not the higher single reading.
  //
  // League scoring is flat across that entire sweep (109.1 -> 109.7 a team, no
  // trend), which is the invariant checkLeagueScoringHeldFlat exists to state:
  // more takeovers redistribute more, they do not manufacture points.
  full: 160,
  secondFullMultiplier: 1.08,
  takeoverPossessions: 26,
  // The shortest run that is still a takeover. Below this the meter holds
  // rather than firing — see takeoverRun.
  minRunPossessions: 10,
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
    // The meter runs hottest in the THIRD, not the fourth, and that is the
    // correction rather than the compromise it looks like.
    //
    // A takeover is 26 possessions; a quarter holds about 29 a side. Peaking in
    // the fourth therefore fired two thirds of all takeovers into a window too
    // short to contain one — measured, 68% started in the fourth and 85% of
    // those were amputated by the buzzer for six points against the 12.6 a
    // third-quarter takeover was worth. Peaking in the third does not move the
    // takeover out of crunch time; it moves the START out, so the run COVERS
    // the fourth instead of being cut off inside it.
    //
    // Measured (runway rule on, full season, seed 4242):
    //
    //   third  fourth   per game   cut short   pts, every takeover   scoring
    //    1.0     1.5      0.746        1.7%           9.8            134.12
    //    1.4     1.5      0.971        1.0%          10.4            135.14
    //    1.8     1.2      1.072        0.7%          10.6            134.91   <- shipped
    //    2.2     1.2      1.238        1.0%          10.8            135.15
    //    2.2     1.5      1.410        0.7%          10.7            135.86
    periodMult: { third: 1.8, fourth: 1.2, overtime: 2.0 },
    trailingMult: 1.2
  }
};

// How fast each ultimate's meter fills, relative to the others.
//
// This exists because the affinity currencies are not worth the same. Measured
// at a flat rate of 1.0 across a full season, takeovers per holder-game ran:
//
//   paintBeast      0.878     aboveTheRim     0.329
//   silky           0.688     theWall         0.232
//   downhill        0.674     clamps          0.095
//   glassWrecker    0.585     coldBlooded     0.037
//   floorGeneral    0.549     motorNeverStops 0.030
//   heatCheck       0.513
//   andOne          0.358
//
// A 29x spread. Hold Paint Beast and you take over most nights; hold Motor
// Never Stops and you do it three times a season. That is not rarity, it is a
// dead ultimate — the same defect as one nobody holds, wearing a different hat.
//
// The cause is structural, not a tuning slip. Scoring ultimates charge off made
// shots, which happen constantly; Clamps charges off steals and The Wall off
// blocks, which do not. Cold Blooded is dead until the fourth quarter by
// design, so it has a quarter of the game to earn in.
//
// Correcting it took two things, and the second was not a tuning change at all.
//
// The first attempt set each rate to the reciprocal of its measured rate. That
// over-shot violently and INVERTED the problem — Clamps and Motor Never Stops
// went to 1.9 and 2.5 per holder-game while Downhill collapsed to 0.05. The
// cause is that the threshold is a step function, so the response near it is
// sharply non-linear and a full correction always overshoots.
//
// The rates below are two DAMPED rounds, each correction square-rooted. They
// land the spread at roughly 8x, from 0.12 to 0.99 per holder-game.
//
// A false lead worth recording so it is not re-investigated: only one takeover
// runs per side at a time, and gameSim.js originally picked the first eligible
// player in LINEUP ORDER, which looked like it must be starving slower
// team-mates. It was not. Measured, lineup order gives a 7.8x spread against
// 8.4x for the fairest-first rule that replaced it — indistinguishable. The
// selection rule was changed anyway because deciding on merit beats deciding on
// array position, but it fixed nothing and no number detects it.
//
// IT DOES NOT CONVERGE FURTHER, and the reason is worth recording so nobody
// wastes another afternoon on it: Heat Check, Paint Beast and Cold Blooded have
// exactly ONE holder each in the 2026 league. Their "rate" is one specific
// player measured over eighty games, so another round fits Stephen Curry rather
// than fitting the ultimate. The remaining spread is sampling noise, not
// mis-tuning, and the guard that matters is the one in
// scripts/validate-ultimates.js: every ultimate must actually fire in a season.
const CHARGE_RATE = {
  heatCheck: 1.29, silky: 1.00, paintBeast: 0.79, downhill: 0.95,
  // andOne 0.86 -> 1.50 after the 2K-display re-anchor changed WHO holds it:
  // its single holder charged 0.125 takeovers a game against a league mean
  // near 1 (rate span 14.2x, over the 13x ceiling). Measured over 240 games:
  // 1.50 -> 0.94/game, span 5.1x. (2.20 overshot to 1.69.)
  aboveTheRim: 0.96, andOne: 1.50, glassWrecker: 0.89, coldBlooded: 4.00,
  clamps: 1.46, motorNeverStops: 1.79, floorGeneral: 0.96, theWall: 1.03
};

// Cold Blooded's 4.00 is the one rate the damped rounds above could not reach,
// and it is worth saying why so it is not "corrected" back into line. Everyone
// else fills a meter across four quarters. Cold Blooded earns in one, so a rate
// near 1 is not rarity — it is roughly a quarter of the earning everyone else
// gets, on top of a threshold built for four quarters of it. Measured over 47
// games of its single holder:
//
//   rate   fires   mean points
//   1.54     0         -          <- shipped; the ultimate did not exist
//   2.50     3        6.3
//   3.50     9        9.3
//   4.00    11        8.9         <- once every four or five games
//   4.50    21       10.0
//
// The damped correction could never find this because it square-roots each
// round toward a measured rate that was already near zero.

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
  else if (period === 3) mult *= s.periodMult.third;
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
  const rate = CHARGE_RATE[ultimateKey] === undefined ? 1 : CHARGE_RATE[ultimateKey];
  return base * affinityMult * rate * (situationMult === undefined ? 1 : situationMult);
}

function chargeThreshold(takeoversUsed) {
  return CHARGE_TUNING.full * Math.pow(CHARGE_TUNING.secondFullMultiplier, takeoversUsed || 0);
}

// One ultimate is not a quarter long. Motor Never Stops is the endurance one;
// its whole claim is that it does not end when everyone else's does.
//
// Cold Blooded was given a short 12-possession run here too, on the reasoning
// that its meter is dead until the fourth (LATE_GAME_ONLY) so it cannot both
// fill and run inside one quarter. That reasoning was right about the problem
// and wrong about the fix: measured, the runway rule alone already gives it
// ~19 takeovers a season averaging a 14-possession run and 10 points, against
// 9-22 takeovers averaging 11 possessions and 8 points with the special case.
// The special case made it slightly worse AND less stable, so it is not here.
// It was found by mutation testing — removing it changed nothing any guard
// could see, which is what a redundant fix looks like.
const TAKEOVER_LENGTH = { motorNeverStops: 65 };

function takeoverLength(ultimateKey) {
  return TAKEOVER_LENGTH[ultimateKey] === undefined
    ? CHARGE_TUNING.takeoverPossessions
    : TAKEOVER_LENGTH[ultimateKey];
}

// How long a takeover starting NOW can actually run, or 0 for "not now".
//
// A takeover is 26 possessions and a quarter holds about 29 per side, so one
// that begins more than a minute into the fourth cannot finish. That is not an
// edge case: measured over a full season, 68% of all takeovers began in the
// fourth and 85% of THOSE were amputated by the buzzer, averaging six points
// against the 12.6 a third-quarter takeover was worth. Two thirds of the
// feature was firing into a window too short to hold it.
//
// So the run is declared against the game left rather than assumed:
//
//   room for the whole thing  -> the whole thing
//   room for a shorter run    -> that shorter run, and it is a real takeover
//   less than minRun          -> it does not start; the meter stays full
//
// The last line is the one that removes the two-point fizzle. A star whose
// meter fills with ninety seconds on the clock does not get a hollow takeover
// tacked onto the box score — he stays loaded, and if the game goes to
// overtime he erupts on the first possession of it.
function takeoverRun(ultimateKey, possessionsLeft) {
  const run = Math.min(takeoverLength(ultimateKey), possessionsLeft);
  return run >= CHARGE_TUNING.minRunPossessions ? run : 0;
}

function hasUltimate(player) {
  return !!player && (player.overall || 0) >= currentGate();
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
  // The league snapshot may have handed this player to an otherwise-unheld
  // ultimate they near-tied on — see setLeagueGate's diversity pass.
  if (_assignmentOverrides && _assignmentOverrides[player.id]) return _assignmentOverrides[player.id];
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

// The closed set of dials a takeover may turn. Every name here is read by
// simEnginePossession.js, and validate-ultimates.js asserts that STATICALLY —
// the recurring failure in this codebase is a value computed and then
// discarded, and an unread dial is exactly that wearing a new hat.
//
//   shotShare    multiplier on the holder's shot-pick weight
//   shotCeiling  raises PICK_CEILING.shooter, for the holder and duration only
//   zoneBias     { three|mid|inside: multiplier } on his shot-zone mix
//   makeThree / makeMid / makeInside / makeFt   added to his make probability
//   turnover     added to the turnover chance when he handles (negative helps him)
//   block        added to his block chance as defender
//   reboundShare multiplier on his rebound-pick weight
//   foulRate     multiplier on the shooting-foul rate when he shoots
//   energyDrain  multiplier on his OWN energy drain (below 1 = tires slower)
//   matchupDrain multiplier on his defender's energy drain (above 1 = tires them)
//   teamMake     added to all five team-mates' make probability
//   teamTurnover added to the team's turnover chance (negative helps)
//   oppMake      added to the opponent five's make probability (negative hurts them)
//   oppTurnover  added to the opponent's turnover chance
const DIAL_NAMES = ['shotShare', 'shotCeiling', 'zoneBias', 'makeThree', 'makeMid',
  'makeInside', 'makeFt', 'turnover', 'block', 'reboundShare', 'foulRate',
  'energyDrain', 'matchupDrain', 'teamMake', 'teamTurnover', 'oppMake', 'oppTurnover'];

// Probability dials are absolute additions to a 0-1 probability; share dials
// are multipliers.
//
// THE TAKEOVER IS EFFICIENCY-LED, NOT USAGE-LED, AND THAT WAS NOT THE FIRST
// ATTEMPT. The obvious build gives the holder the ball far more (shot share
// 2.2-2.5, ceiling lifted to 0.78-0.82) and it broke the league. Measured over
// a full season against the same build with ultimates switched off:
//
//                        league leader   best game   players over 40 ppg
//   ultimates off            43.4 ppg        69              2
//   usage-led  (2.4 / 0.80)  51.4 ppg        90              7
//   softened   (1.7 / 0.62)  45.7 ppg        77              5
//   efficiency (1.35 / 0.55) 44.5 ppg        75              7   <- shipped
//
// PICK_CEILING.shooter exists at 0.50 precisely to stop 40-point seasons — its
// own comment records six of them in a 35-season run before the cap. Lifting it
// to 0.80 for a takeover reintroduced exactly the thing it was created to
// prevent, and league scoring could not see it: the total was fine, the
// DISTRIBUTION was not.
//
// So the shipped version keeps the ceiling close to the engine's own 0.50 and
// buys the holder's 10-15 points through accuracy and shot selection instead.
// He scores more because more of his shots go in, not because he hogs the ball
// — which is also the better story.
//
// Still honestly a shift: seven players above 40 ppg against two. Stars ARE
// meant to become more dominant, and league scoring, the leader and the best
// single game all sit within a point or six of baseline. But it is a change,
// not a null result, and checkScoringLeadersInBand in validate-ultimates.js is
// there so it cannot get worse unnoticed.
//
// Team dials are far smaller than solo ones because they are multiplied by
// five. Without that, every floor general in the league would be the best
// player alive.
const TAKEOVER_EFFECTS = {
  heatCheck:       { shotShare: 1.35, shotCeiling: 0.55, zoneBias: { three: 2.2 }, makeThree: 0.19 },
  silky:           { shotShare: 1.35, shotCeiling: 0.55, zoneBias: { mid: 2.6 }, makeMid: 0.20 },
  paintBeast:      { shotShare: 1.35, shotCeiling: 0.55, zoneBias: { inside: 2.0 }, makeInside: 0.18, foulRate: 1.3 },
  downhill:        { shotShare: 1.30, shotCeiling: 0.54, zoneBias: { inside: 1.9 }, makeInside: 0.16, turnover: -0.05 },
  aboveTheRim:     { shotShare: 1.30, shotCeiling: 0.54, zoneBias: { inside: 2.1 }, makeInside: 0.18, reboundShare: 1.6, block: 0.05 },
  andOne:          { shotShare: 1.30, shotCeiling: 0.54, zoneBias: { inside: 2.0 }, makeInside: 0.13, foulRate: 2.2, makeFt: 0.08 },
  glassWrecker:    { shotShare: 1.20, shotCeiling: 0.53, zoneBias: { inside: 1.6 }, makeInside: 0.13, reboundShare: 3.0 },
  coldBlooded:     { shotShare: 1.40, shotCeiling: 0.56, makeThree: 0.18, makeMid: 0.18, makeInside: 0.18, makeFt: 0.06 },
  clamps:          { oppTurnover: 0.10 },
  motorNeverStops: { energyDrain: 0.15, matchupDrain: 1.9 },
  floorGeneral:    { teamMake: 0.045, teamTurnover: -0.02 },
  theWall:         { oppMake: -0.05, block: 0.04 }
};

// Multiplier dials scale FROM 1, not from 0. Doubling a 1.6x share multiplier
// would be 3.2x, which is not what a 35% badge boost means.
const MULTIPLIER_DIALS = { shotShare: true, reboundShare: true, foulRate: true, matchupDrain: true };

// Dials a badge boost must not touch: shotCeiling is a hard cap the engine
// clamps to, zoneBias is a shot-mix ratio, and energyDrain is a fraction where
// LOWER is stronger — multiplying it up would make the badge a penalty.
const UNBOOSTED_DIALS = { shotCeiling: true, zoneBias: true, energyDrain: true };

function takeoverEffect(ultimateKey, badgeBoost) {
  const base = TAKEOVER_EFFECTS[ultimateKey];
  if (!base) return {};
  const boost = (badgeBoost === undefined || !(badgeBoost > 0)) ? 1 : badgeBoost;
  const out = {};
  Object.keys(base).forEach(function (dial) {
    const v = base[dial];
    if (UNBOOSTED_DIALS[dial]) { out[dial] = v; return; }
    if (MULTIPLIER_DIALS[dial]) { out[dial] = 1 + (v - 1) * boost; return; }
    out[dial] = v * boost;
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ULTIMATE_TUNING: ULTIMATE_TUNING,
    ULTIMATE_TAXONOMY: ULTIMATE_TAXONOMY,
    ULTIMATE_BY_KEY: ULTIMATE_BY_KEY,
    ULTIMATE_DESCRIPTIONS: ULTIMATE_DESCRIPTIONS,
    PLAY_KINDS: PLAY_KINDS,
    CHARGE_TUNING: CHARGE_TUNING,
    CHARGE_AFFINITY: CHARGE_AFFINITY,
    CHARGE_RATE: CHARGE_RATE,
    hasUltimate: hasUltimate,
    setLeagueGate: setLeagueGate,
    currentGate: currentGate,
    ultimateFor: ultimateFor,
    badgeBoostFor: badgeBoostFor,
    percentileIn: percentileIn,
    situationMultiplier: situationMultiplier,
    chargeGain: chargeGain,
    chargeThreshold: chargeThreshold,
    TAKEOVER_LENGTH: TAKEOVER_LENGTH,
    takeoverLength: takeoverLength,
    takeoverRun: takeoverRun,
    DIAL_NAMES: DIAL_NAMES,
    TAKEOVER_EFFECTS: TAKEOVER_EFFECTS,
    takeoverEffect: takeoverEffect
  };
}
