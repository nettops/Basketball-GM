// Does the sim itself say rebounding matters less for a guard?
//
// fit-overall.js fits ONE coefficient vector across every player. 2K instead
// weights each position differently — a point guard is not judged on boxing
// out. That is a NORMATIVE choice, and before making it by hand it is worth
// asking whether the data already agrees: fit the same regression separately
// per position group and read what each one says.
//
// If a guard's defReb coefficient comes out near zero on its own, the 2K
// weighting and the measurement agree and there is nothing to argue about. If
// it comes out high, then zeroing it is a fiction — a defensible one, but the
// commit should say so rather than pretend it was measured.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const ratings = rq('ratings.js');
const { makeRng } = rq('rng.js');
const { ATTRIBUTE_KEYS } = rq('data.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
const gameSim = rq('gameSim.js');

PLAYERS_2026.forEach(function (p) { ratings.defineOverall(p); });
rq('traits.js').ensureHiddenPlayerData(PLAYERS_2026);

const GAMES = Number(process.env.FIT_GAMES || 1800);
const MIN_MINUTES = 300;
const RIDGE = 1.0;

const GROUPS = {
  guards: ['PG', 'SG'],
  wings: ['SF'],
  bigs: ['PF', 'C']
};

const rng = makeRng(1);
const byId = {};
PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
const originalTeam = {};
PLAYERS_2026.forEach(function (p) { originalTeam[p.id] = p.teamId; });

// Same roster scrambling fit-overall.js uses: rotations are rating-driven, so
// without it a player's plus/minus is mostly his teammates'.
function scramble() {
  const pool = PLAYERS_2026.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  pool.forEach(function (p, i) { p.teamId = TEAMS[i % TEAMS.length].id; });
}

const acc = {};
for (let i = 0; i < GAMES; i++) {
  if (i % 30 === 0) scramble();
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
  if (home.id === away.id) continue;
  const r = gameSim.simulateGame(home.id, away.id, rng);
  Object.keys(r.boxScore).forEach(function (id) {
    const l = r.boxScore[id];
    const q = acc[id] || (acc[id] = { min: 0, pm: 0 });
    q.min += l.minutes; q.pm += (l.plusMinus || 0);
  });
}
PLAYERS_2026.forEach(function (p) { p.teamId = originalTeam[p.id]; });

function solveNonNegative(A, b, iters) {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let maxDelta = 0;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (k !== j) s += A[j][k] * x[k];
      const v = (b[j] - s) / A[j][j];
      const next = (j === n - 1) ? v : Math.max(0, v);
      if (Math.abs(next - x[j]) > maxDelta) maxDelta = Math.abs(next - x[j]);
      x[j] = next;
    }
    if (maxDelta < 1e-12) break;
  }
  return x;
}

function fit(ids) {
  const means = {};
  ATTRIBUTE_KEYS.forEach(function (k) {
    means[k] = ids.reduce(function (s, id) { return s + byId[id].attributes[k]; }, 0) / ids.length;
  });
  const K = ATTRIBUTE_KEYS.length;
  const X = ids.map(function (id) {
    return ATTRIBUTE_KEYS.map(function (k) { return byId[id].attributes[k] - means[k]; }).concat([1]);
  });
  const y = ids.map(function (id) { return acc[id].pm / acc[id].min; });
  const A = [], b = [];
  for (let i = 0; i <= K; i++) {
    A.push([]);
    for (let j = 0; j <= K; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r][i] * X[r][j];
      if (i === j && i < K) s += RIDGE;
      A[i].push(s);
    }
    let s2 = 0;
    for (let r = 0; r < X.length; r++) s2 += X[r][i] * y[r];
    b.push(s2);
  }
  const coef = solveNonNegative(A, b, 5000);
  // Normalise so groups are comparable: report each attribute's SHARE of the
  // group's total weight, not its raw slope. Raw slopes differ in scale between
  // groups because plus/minus variance does.
  let total = 0;
  for (let i = 0; i < K; i++) total += coef[i];
  const share = {};
  ATTRIBUTE_KEYS.forEach(function (k, i) { share[k] = total > 0 ? coef[i] / total : 0; });
  return { share: share, n: ids.length };
}

const eligible = Object.keys(acc).filter(function (id) {
  return byId[id] && acc[id].min >= MIN_MINUTES;
});

const results = {};
Object.keys(GROUPS).forEach(function (g) {
  const ids = eligible.filter(function (id) { return GROUPS[g].indexOf(byId[id].position) !== -1; });
  results[g] = fit(ids);
});
results.all = fit(eligible);

// Report the attributes this question is actually about, plus the biggest
// movers, as a share of each group's total weight.
const FOCUS = ['defReb', 'offReb', 'block', 'interiorDefense', 'steal', 'perimeterDefense',
  'threePoint', 'midRange', 'ballHandling', 'passing', 'postScoring', 'basketballIQ'];

console.log('weight SHARE of each attribute, fitted separately per position group');
console.log('(' + GAMES + ' games; guards n=' + results.guards.n + ', wings n=' + results.wings.n +
  ', bigs n=' + results.bigs.n + ', all n=' + results.all.n + ')\n');
console.log('attribute            guards    wings     bigs      all');
FOCUS.forEach(function (k) {
  console.log('  ' + k.padEnd(18) +
    ['guards', 'wings', 'bigs', 'all'].map(function (g) {
      return (100 * results[g].share[k]).toFixed(1).padStart(6) + '%';
    }).join('  '));
});

console.log('\nthe question this was built to answer:');
['defReb', 'offReb', 'block', 'interiorDefense'].forEach(function (k) {
  const g = 100 * results.guards.share[k], b = 100 * results.bigs.share[k];
  console.log('  ' + k.padEnd(18) + 'guards ' + g.toFixed(1) + '%  vs  bigs ' + b.toFixed(1) +
    '%   ' + (g < b * 0.5 ? '-> the data ALREADY discounts it for guards'
                          : '-> the data does NOT discount it for guards'));
});
