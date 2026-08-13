// One-shot generator for the DISPLAY overall coefficients, sibling to
// fit-overall.js (which fits the SIM's rawOverall against plus/minus and is
// untouched by this). This fit answers a different question: "what would 2K
// rate this sheet?" — regressing the game's 20 mapped attributes against the
// 435 imported players' actual 2K27 overalls, so the number the player READS
// tracks 2K's own grading. Derived, never stored: progression moves it, and
// every generated player is graded exactly as 2K would grade their sheet.
//
// NNLS via the same coordinate-descent trick as fit-overall.js: negative
// coefficients would make an attribute gain LOWER a player's rating, which
// progression cannot explain to anyone.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = f => require(path.join(ROOT, f));

rq('data.js'); rq('rng.js'); rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
rq('ratings.js');
const { ATTRIBUTE_KEYS } = rq('data.js');

// 2K overalls by name from the scrape.
const scrape = require(path.join(ROOT, 'data', '2k27-rosters.json'));
const twoK = {};
scrape.teams.forEach(t => t.players.forEach(p => { twoK[p.name] = p.overall; }));

const rows = PLAYERS_2026.filter(p => twoK[p.name] !== undefined);
console.log('fitting on ' + rows.length + ' of ' + PLAYERS_2026.length + ' players with 2K overalls');

// Two derived features beyond the 20 raw attributes, both monotone so a
// trained attribute can never LOWER the display: 2K credits elite peaks
// more than linearly (a 99 three is a identity, not one more point), and a
// single league-wide line put Curry at 86 against his 2K 95.
const FEATURE_KEYS = ATTRIBUTE_KEYS.concat(['peakSkill', 'topThreeMean']);
function features(p) {
  const a = p.attributes;
  const vals = ATTRIBUTE_KEYS.map(k => a[k] || 0).sort((x, y) => y - x);
  return ATTRIBUTE_KEYS.map(k => a[k] || 0)
    .concat([vals[0], (vals[0] + vals[1] + vals[2]) / 3]);
}

// Per-position, in the 2K sense: a point guard is not graded on boxing out.
// Fitting against 2K's own overalls (a clean target) sidesteps the
// collinearity that made per-position PLUS/MINUS fits unusable
// (probe-position-fit.js) — with ridge, ~90 rows per position is plenty.
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const RIDGE = 0.7;
const K = FEATURE_KEYS.length;
const out = {};
let allResiduals = [];

POSITIONS.forEach(pos => {
  const sub = rows.filter(p => p.position === pos);
  const means = FEATURE_KEYS.map((k, j) => sub.reduce((s, p) => s + features(p)[j], 0) / sub.length);
  const yMean = sub.reduce((s, p) => s + twoK[p.name], 0) / sub.length;
  const X = sub.map(p => features(p).map((v, j) => v - means[j]));
  const y = sub.map(p => twoK[p.name] - yMean);
  let coef = new Array(K).fill(0);
  for (let iter = 0; iter < 4000; iter++) {
    for (let j = 0; j < K; j++) {
      let num = 0, den = RIDGE;
      for (let i = 0; i < sub.length; i++) {
        let pred = 0;
        for (let m = 0; m < K; m++) if (m !== j) pred += coef[m] * X[i][m];
        num += X[i][j] * (y[i] - pred);
        den += X[i][j] * X[i][j];
      }
      coef[j] = Math.max(0, num / den);
    }
  }
  out[pos] = { coef: coef, means: means, intercept: yMean, n: sub.length };
  sub.forEach((p, i) => {
    let pred = yMean;
    for (let j = 0; j < K; j++) pred += coef[j] * X[i][j];
    allResiduals.push({ name: p.name, twoK: twoK[p.name], pred: Math.round(pred), r: twoK[p.name] - pred });
  });
});

const sse = allResiduals.reduce((s, w) => s + w.r * w.r, 0);
const grandMean = rows.reduce((s, p) => s + twoK[p.name], 0) / rows.length;
const sst = rows.reduce((s, p) => s + Math.pow(twoK[p.name] - grandMean, 2), 0);
console.log('in-sample r = ' + Math.sqrt(1 - sse / sst).toFixed(3) +
  ', mean |residual| = ' + (allResiduals.reduce((s, w) => s + Math.abs(w.r), 0) / allResiduals.length).toFixed(2));
allResiduals.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
console.log('largest residuals: ' + allResiduals.slice(0, 5).map(w => w.name + ' 2K ' + w.twoK + ' fit ' + w.pred).join(' | '));
['Luka Doncic', 'Stephen Curry', 'Nikola Jokic', 'Victor Wembanyama', 'Jayson Tatum', 'Giannis Antetokounmpo'].forEach(n => {
  const w = allResiduals.find(x => x.name === n);
  if (w) console.log(n + ': 2K ' + w.twoK + ' -> fit ' + w.pred);
});

console.log('\n// Fitted by scripts/fit-display-overall.js against the ' + rows.length + ' imported 2K27 overalls');
console.log('// (per position, ridge ' + RIDGE + ', features = 20 attributes + peakSkill + topThreeMean).');
console.log('const DISPLAY_OVERALL_FIT = {');
POSITIONS.forEach(pos => {
  const f = out[pos];
  console.log('  ' + pos + ': { intercept: ' + f.intercept.toFixed(3) + ', terms: {');
  FEATURE_KEYS.forEach((k, j) => {
    if (f.coef[j] > 0.0005) console.log('    ' + k + ': { coef: ' + f.coef[j].toFixed(5) + ', mean: ' + f.means[j].toFixed(1) + ' },');
  });
  console.log('  } },');
});
console.log('};');
