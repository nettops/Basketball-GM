// One-shot generator for ratings.js's coefficients, in the same spirit as
// scripts/gen-gamesim-golden.js: run it, paste the output, commit. Re-running
// it after a deliberate change to the sim is how the fit gets updated, and
// that must be justified in the commit that does it.
//
// Method is ZenGM's (reference/zengm/analysis/player-ovr-basketball/process.py):
// regress the raw attributes against PLUS/MINUS PER MINUTE. A box score cannot
// see defense, so a formula fitted on production would undervalue
// interiorDefense and perimeterDefense — which is exactly what the old
// hand-authored overall did, since it WAS the attributes' seed and could not
// disagree with them.
//
// Implemented as normal equations solved by Gauss-Jordan, since this project
// takes no dependencies. Ridge-regularised: the 20 attributes are correlated
// by construction (every player is an archetype plus noise), so the plain
// normal equations are near-singular and the unregularised coefficients swing
// wildly between runs.
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));

const GAMES = Number(process.env.FIT_GAMES || 1200);
const MIN_MINUTES = 400;
const RIDGE = Number(process.env.FIT_RIDGE || 1.0);

// The distribution the rest of the game expects an overall to have. Matched to
// what the attribute anchor already produces (players-2026.js SCALE_MEAN/SD),
// so `potential - overall` stays meaningful in progression.js.
const TARGET_MEAN = 50, TARGET_SD = 9;

function solve(A, b) {
  const n = b.length;
  const M = A.map(function (row, i) { return row.concat([b[i]]); });
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
    if (Math.abs(M[col][col]) < 1e-12) throw new Error('singular matrix at column ' + col);
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(function (row) { return row[n]; });
}

// NON-NEGATIVE LEAST SQUARES, by coordinate descent on the normal equations.
// Each pass sets one coefficient to its optimum given the others and clamps it
// at zero; the intercept stays unconstrained. Converges reliably here because
// the ridge penalty makes the Gram matrix strictly diagonally dominant.
//
// Why constrain the sign at all: a rating where being BETTER at something makes
// you WORSE is broken as a rating, and the plain ridge fit produced five such
// coefficients — insideScoring worst at -0.086, so improving a big man's inside
// game lowered his overall.
//
// Why constraining it discards nothing real: max |r| in the attribute matrix is
// 0.910 (interiorDefense/block), and every negative had a strongly correlated
// partner carrying a large positive (insideScoring/acceleration r=.71,
// freeThrow/threePoint r=.81, passing/ballHandling r=.85). At that level the
// individual coefficients are not identified — only sums along correlated
// directions are, and ridge splits the shared signal arbitrarily. The proof is
// that the sign pattern itself is unstable: five negatives on 1800 games became
// a different two on 900 games of the same league.
//
// `solve` is kept below as the A/B control. Do not delete it — the commit that
// changes this fit has to report both arms at the same game count.
function solveNonNegative(A, b, iters) {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let maxDelta = 0;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (k !== j) s += A[j][k] * x[k];
      const v = (b[j] - s) / A[j][j];
      const next = (j === n - 1) ? v : Math.max(0, v);   // intercept unconstrained
      if (Math.abs(next - x[j]) > maxDelta) maxDelta = Math.abs(next - x[j]);
      x[j] = next;
    }
    if (maxDelta < 1e-12) break;
  }
  return x;
}

const rng = makeRng(1);
const byId = {};
PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });

// SCRAMBLE THE ROSTERS between blocks of games. This is the whole reason the
// fit works, and it is the same problem ZenGM solved by simulating with an
// elevated injury rate "to make the +/- stats richer from more lineup
// variety" (analysis/player-ovr-basketball/README.md).
//
// Measured on the real rosters: even the STORED overall — the number the
// attributes were literally generated from — correlates only r=0.372 with
// plus/minus per minute, and Game Score per minute only r=0.457. Rotations
// are rating-driven, so good players always share a floor and a player's
// plus/minus is mostly his teammates'. Randomising who he plays with turns
// that confound into mean-zero noise.
//
// Only teamId is touched, and it is restored below, so this changes nothing
// about the league it is measuring.
const originalTeam = {};
PLAYERS_2026.forEach(function (p) { originalTeam[p.id] = p.teamId; });

function scramble() {
  const pool = PLAYERS_2026.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  pool.forEach(function (p, i) { p.teamId = TEAMS[i % TEAMS.length].id; });
}

const GAMES_PER_SCRAMBLE = 30;
const acc = {};
for (let i = 0; i < GAMES; i++) {
  if (i % GAMES_PER_SCRAMBLE === 0) scramble();
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
  if (home.id === away.id) continue;
  const r = gameSim.simulateGame(home.id, away.id, rng);
  Object.keys(r.boxScore).forEach(function (id) {
    const l = r.boxScore[id];
    const q = acc[id] || (acc[id] = { min: 0, pm: 0 });
    q.min += l.minutes;
    q.pm += (l.plusMinus || 0);
  });
}
PLAYERS_2026.forEach(function (p) { p.teamId = originalTeam[p.id]; });

const ids = Object.keys(acc).filter(function (id) {
  return byId[id] && acc[id].min >= MIN_MINUTES;
});
console.error('fitting on ' + ids.length + ' players over ' + GAMES + ' games (ridge ' + RIDGE + ')');

// Centre each attribute so the intercept is the league-average player.
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
    // Ridge penalty on the slopes only, never on the intercept.
    if (i === j && i < K) s += RIDGE;
    A[i].push(s);
  }
  let s2 = 0;
  for (let r = 0; r < X.length; r++) s2 += X[r][i] * y[r];
  b.push(s2);
}
// FIT_SOLVER=ridge runs the unconstrained control for the A/B.
const USE_RIDGE_CONTROL = process.env.FIT_SOLVER === 'ridge';
const coef = USE_RIDGE_CONTROL ? solve(A, b) : solveNonNegative(A, b, 5000);
console.error('solver: ' + (USE_RIDGE_CONTROL ? 'ridge (control)' : 'NNLS'));
console.error('negative coefficients: ' +
  ATTRIBUTE_KEYS.filter(function (k, i) { return coef[i] < 0; }).length);

const pred = X.map(function (row) {
  let s = 0;
  for (let i = 0; i <= K; i++) s += row[i] * coef[i];
  return s;
});
const pm = pred.reduce(function (a, c) { return a + c; }, 0) / pred.length;
const psd = Math.sqrt(pred.reduce(function (s, v) { return s + (v - pm) * (v - pm); }, 0) / pred.length);
const mult = TARGET_SD / psd;

// How well does the fit actually track the thing it was fitted on?
const ym = y.reduce(function (a, c) { return a + c; }, 0) / y.length;
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < y.length; i++) {
  sxy += (pred[i] - pm) * (y[i] - ym);
  sxx += (pred[i] - pm) * (pred[i] - pm);
  syy += (y[i] - ym) * (y[i] - ym);
}
console.error('in-sample r = ' + (sxy / Math.sqrt(sxx * syy)).toFixed(3));

console.log('// Fitted by scripts/fit-overall.js against ' + GAMES + ' games and ' +
  ids.length + ' players (ridge ' + RIDGE + ', in-sample r ' +
  (sxy / Math.sqrt(sxx * syy)).toFixed(3) + ').');
console.log('// Re-run that script to regenerate after a deliberate sim change.');
console.log('const OVERALL_COEFFICIENTS = {');
ATTRIBUTE_KEYS.forEach(function (k, i) {
  console.log('  ' + k + ': { coef: ' + (coef[i] * mult).toFixed(5) +
    ', mean: ' + means[k].toFixed(1) + ' },');
});
console.log('};');
console.log('const OVERALL_INTERCEPT = ' + (TARGET_MEAN + (coef[K] - pm) * mult).toFixed(4) + ';');
