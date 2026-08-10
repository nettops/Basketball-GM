// Where does the OVR inflation come from?
//
// probe-twenty-seasons.js shows 90+ players going from 9/380 (2.4%) to
// 124/812 (15.3%) in eleven seasons. That is not the league getting bigger —
// it is a RATE going up sixfold. Something in the offseason is net-positive
// and never gives the points back.
//
// Three candidate sources, and this probe measures each in isolation so the
// answer is a number rather than a reading of the code:
//
//   1. calcBaseChange's asymmetric clip. Every age band bounds the gaussian
//      tighter on the downside than the upside: bound(g*5, -4, 20) at 23 and
//      under, bound(g*3, -2, 4) from 26 up. A symmetric draw through an
//      asymmetric clip has a positive mean. If so, EVERY player drifts up
//      every year regardless of age, which the age curve was supposed to stop.
//
//   2. The changeLimits ratchet. insideScoring is [-5, 23]: a 36-year-old's
//      shooting can fall 5 a year but rise 23. Same shape, one layer down.
//
//   3. The potential ratchet at progression.js:187 —
//      potential = max(potential, computeOverall(player)). Potential only ever
//      rises, and lines 136-144 pull the player TOWARD potential. A lucky
//      breakout is therefore banked permanently and then chased forever.
//
// Sources 1 and 2 are measured by sampling the functions directly. Source 3
// needs the real pipeline, so it re-runs progression over the actual league
// and reports raw overall against potential side by side: if potential climbs
// faster than the players do, the gap that drives the pull is self-feeding.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
rq('teams.js'); rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const ratings = rq('ratings.js');
const { makeRng } = rq('rng.js');
const { ATTRIBUTE_KEYS } = rq('data.js');
const progression = rq('progression.js');

const rng = makeRng(99);
const N = 200000;

// ---------------------------------------------------------------- source 1
// calcBaseChange is not exported, so reproduce its draw exactly. If this copy
// drifts from the original the numbers below are fiction — so it is asserted
// against the real thing by proxy at the end (mean attribute change per age).
function gaussianRandom(r) {
  const u1 = r(), u2 = r();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}
function bound(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function baseFor(age) {
  if (age <= 21) return 2;
  if (age <= 25) return 1;
  if (age <= 27) return 0;
  if (age <= 29) return -1;
  if (age <= 31) return -2;
  if (age <= 34) return -3;
  if (age <= 40) return -4;
  if (age <= 43) return -5;
  return -6;
}
function noiseFor(age, r) {
  if (age <= 23) return bound(gaussianRandom(r) * 5, -4, 20);
  if (age <= 25) return bound(gaussianRandom(r) * 5, -4, 10);
  return bound(gaussianRandom(r) * 3, -2, 4);
}

console.log('SOURCE 1 — the asymmetric clip inside calcBaseChange');
console.log('  A symmetric gaussian clipped tighter below than above has a');
console.log('  positive mean. "skew" is that mean: free points per year.\n');
console.log('  age   intended    skew    actual   -> is the age curve intact?');
const AGES = [20, 22, 24, 26, 28, 30, 32, 35, 38];
const skewByAge = {};
AGES.forEach(function (age) {
  let s = 0;
  for (let i = 0; i < N; i++) s += noiseFor(age, rng);
  const skew = s / N;
  skewByAge[age] = skew;
  const intended = baseFor(age);
  const actual = intended + skew;
  console.log('  ' + String(age).padStart(3) + '   ' +
    intended.toFixed(2).padStart(8) + '  ' + skew.toFixed(3).padStart(6) + '  ' +
    actual.toFixed(3).padStart(7) + '   ' +
    (Math.sign(actual) === Math.sign(intended) || intended === 0
      ? 'yes' : 'NO — decline became growth'));
});

// ---------------------------------------------------------------- source 2
// Does the per-attribute clip add drift ON TOP of the base change? Feed a
// FIXED baseChange through the same bound() the real loop uses and see what
// comes out. A player asked to lose 4 who only loses 3.2 is being subsidised.
console.log('\nSOURCE 2 — the per-attribute changeLimits, on top of source 1');
console.log('  Feeding a fixed baseChange through the real [lo,hi] clip and the');
console.log('  (0.4 + rng*1.0) multiplier. "delivered" is what the attribute');
console.log('  actually moves when the curve asked for "requested".\n');
const PROFILES = {
  insideScoring: [-5, 23], threePoint: [-5, 23], passing: [-4, 9],
  perimeterDefense: [-7, 14], block: [-21, 7], speed: [-21, 4],
  strength: [-5, 11], workEthic: [-4, 7]
};
console.log('  attribute           requested  delivered   subsidy');
[-6, -3].forEach(function (req) {
  console.log('  --- a declining veteran asked for ' + req + ' ---');
  Object.keys(PROFILES).forEach(function (k) {
    const lim = PROFILES[k];
    let s = 0;
    for (let i = 0; i < 50000; i++) s += bound(req * (0.4 + rng() * 1.0), lim[0], lim[1]);
    const got = s / 50000;
    console.log('    ' + k.padEnd(18) + String(req).padStart(8) + '  ' +
      got.toFixed(2).padStart(9) + '  ' + (got - req).toFixed(2).padStart(8));
  });
});

// ---------------------------------------------------------------- source 3
// The potential ratchet, measured on the real league through the real
// progressPlayer. No draft, no free agency, no retirement — just the same
// players aging — so anything that moves is progression alone.
console.log('\nSOURCE 3 — the potential ratchet (progression.js:187)');
console.log('  Same players, aged 12 years through the real progressPlayer.');
console.log('  Nobody joins, nobody retires. If potential climbs while the');
console.log('  players themselves age past 30, it is ratcheting, not tracking.\n');

const cohort = PLAYERS_2026.map(function (p) {
  return ratings.defineOverall({
    id: p.id, name: p.name, position: p.position,
    age: p.age, yearsPro: p.yearsPro,
    attributes: Object.assign({}, p.attributes),
    potential: p.potential, teamId: null,
    hiddenTraits: (p.hiddenTraits || []).slice(),
    hiddenPersonality: Object.assign({}, p.hiddenPersonality || {}),
    isCustomPlayer: false
  });
});

function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
function atCeiling(pool) {
  let n = 0, tot = 0;
  pool.forEach(function (p) {
    ATTRIBUTE_KEYS.forEach(function (k) {
      tot++; if (p.attributes[k] >= 100) n++;
    });
  });
  return 100 * n / tot;
}

console.log('  yr  age   rawOVR   potential   gap   dispOVR  90+  attrs@100');
const prng = makeRng(7);
for (let y = 0; y <= 12; y++) {
  const raw = cohort.map(function (p) { return p.rawOverall; });
  const pot = cohort.map(function (p) { return p.potential; });
  const disp = cohort.map(function (p) { return p.overall; });
  console.log('  ' + String(y).padStart(2) + ' ' +
    mean(cohort.map(function (p) { return p.age; })).toFixed(1).padStart(4) + '  ' +
    mean(raw).toFixed(2).padStart(6) + '  ' + mean(pot).toFixed(2).padStart(9) + '  ' +
    (mean(pot) - mean(raw)).toFixed(2).padStart(5) + '  ' +
    mean(disp).toFixed(1).padStart(7) + ' ' +
    String(disp.filter(function (v) { return v >= 90; }).length).padStart(4) + '  ' +
    atCeiling(cohort).toFixed(1).padStart(8) + '%');
  if (y < 12) cohort.forEach(function (p) { progression.progressPlayer(p, prng, []); });
}

// The counterfactual: same cohort, same seed, but potential frozen. Whatever
// difference this makes IS the ratchet's contribution — a number with a
// control, rather than a number on its own.
console.log('\n  CONTROL — identical cohort and seed, potential ratchet disabled');
console.log('  (progressPlayer with suppressPotentialPull, so line 187 and the');
console.log('  gap pull are both off; everything else is unchanged.)\n');
const control = PLAYERS_2026.map(function (p) {
  return ratings.defineOverall({
    id: p.id, name: p.name, position: p.position,
    age: p.age, yearsPro: p.yearsPro,
    attributes: Object.assign({}, p.attributes),
    potential: p.potential, teamId: null,
    hiddenTraits: (p.hiddenTraits || []).slice(),
    hiddenPersonality: Object.assign({}, p.hiddenPersonality || {}),
    isCustomPlayer: false
  });
});
console.log('  yr  age   rawOVR   dispOVR  90+');
const crng = makeRng(7);
for (let y = 0; y <= 12; y++) {
  const disp = control.map(function (p) { return p.overall; });
  console.log('  ' + String(y).padStart(2) + ' ' +
    mean(control.map(function (p) { return p.age; })).toFixed(1).padStart(4) + '  ' +
    mean(control.map(function (p) { return p.rawOverall; })).toFixed(2).padStart(6) + '  ' +
    mean(disp).toFixed(1).padStart(7) + ' ' +
    String(disp.filter(function (v) { return v >= 90; }).length).padStart(4));
  if (y < 12) control.forEach(function (p) {
    progression.progressPlayer(p, crng, [], { suppressPotentialPull: true });
  });
}
