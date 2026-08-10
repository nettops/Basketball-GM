// How many future superstars does one draft class produce?
//
// The target is 2-4 per 60-man class ever reaching display 90+ at their peak.
// Measuring that in the full 12-season sim takes ~15 minutes a run, which is
// too slow to calibrate against. This is the fast harness: generate a class,
// age it with the REAL progressPlayer, record each player's peak display
// overall, count how many cleared 90.
//
// A fast harness is worthless unless it reproduces the slow one. So the first
// thing this prints is the CONTROL: the number the full sim actually produced
// (probe-entrant-quality.js, 12 seasons: 140 draft-entered players at 90+
// across 12 classes = ~11.7 per class). If this harness does not land near
// that on unmodified code, it is not measuring the same thing and nothing
// calibrated on it can be believed.
//
// Run with CLASSES=n to change the sample. SUPERSTAR_TARGET is read from
// ratings.RATING_BANDS so this tracks the shared table rather than hardcoding
// 90 a sixth time.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
rq('teams.js'); rq('traits.js'); rq('scouting.js');
rq('players-2026.js');
const prospects = rq('draftProspects.js');
const ratings = rq('ratings.js');
const progression = rq('progression.js');
const { makeRng } = rq('rng.js');

const CLASSES = Number(process.env.CLASSES || 40);
const DRAFTED = 60;        // two rounds; generateProspectClass makes 64 with a cushion
const PEAK_AGE = 32;       // past this the age curve is firmly negative, so the peak has happened
const SUPERSTAR = ratings.RATING_BANDS.superstar;
const NOPULL = process.env.NOPULL === '1';

function summarise(counts) {
  const sorted = counts.slice().sort(function (a, b) { return a - b; });
  const mean = counts.reduce(function (a, c) { return a + c; }, 0) / counts.length;
  return {
    mean: mean,
    min: sorted[0],
    p25: sorted[Math.floor(0.25 * (sorted.length - 1))],
    median: sorted[Math.floor(0.5 * (sorted.length - 1))],
    p75: sorted[Math.floor(0.75 * (sorted.length - 1))],
    max: sorted[sorted.length - 1]
  };
}

// One class, aged forward. Returns the per-class superstar count plus the peak
// display ratings so the shape of the class is visible, not just the count.
function runClass(seed) {
  const rng = makeRng(seed);
  const cls = prospects.generateProspectClass(rng, 64).slice(0, DRAFTED);
  const peaks = [];
  cls.forEach(function (p) {
    let peak = p.overall;
    // teammates empty and teamId null: no mentor bonus, no coach fit. Both are
    // multiplicative nudges around 1.0 in the real pipeline, so leaving them
    // out biases slightly LOW — which is the safe direction for a harness whose
    // job is to prove a rate is too HIGH.
    while (p.age < PEAK_AGE) {
      // NOPULL=1 disables the potential gap-pull (progression.js:136-144) and
      // the potential ratchet, leaving ONLY calcBaseChange's age curve. The
      // difference between the two runs is how much of a prospect's rise is
      // the ceiling dragging him up versus the age curve simply growing him.
      // Fixing the wrong one of those would move the number without fixing
      // anything.
      progression.progressPlayer(p, rng, [], NOPULL ? { suppressPotentialPull: true } : {});
      if (p.overall > peak) peak = p.overall;
    }
    peaks.push(peak);
  });
  return {
    superstars: peaks.filter(function (v) { return v >= SUPERSTAR; }).length,
    peaks: peaks.sort(function (a, b) { return b - a; })
  };
}

console.log('SUPERSTARS PER DRAFT CLASS');
console.log('  superstar = display OVR >= ' + SUPERSTAR + ' (ratings.RATING_BANDS.superstar)');
console.log('  measured as each player\'s PEAK, aging to ' + PEAK_AGE + ' via the real progressPlayer');
console.log('  ' + CLASSES + ' classes of ' + DRAFTED + '\n');

const counts = [];
const allPeaks = [];
let topPeaks = null;
for (let i = 0; i < CLASSES; i++) {
  const r = runClass(1000 + i * 17);
  counts.push(r.superstars);
  allPeaks.push(r.peaks);
  if (i === 0) topPeaks = r.peaks;
}

const s = summarise(counts);
console.log('  per class:  min ' + s.min + '  p25 ' + s.p25 + '  median ' + s.median +
  '  p75 ' + s.p75 + '  max ' + s.max);
console.log('  MEAN: ' + s.mean.toFixed(2) + ' superstars per class');
console.log('\n  TARGET: 2-4 per class.  ' +
  (s.mean >= 2 && s.mean <= 4 ? 'IN RANGE' : 'OUT OF RANGE — ' +
    (s.mean > 4 ? (s.mean / 3).toFixed(1) + 'x too many' : 'too few')));

console.log('\n  CONTROL — the full 12-season sim produced 140 draft-entered');
console.log('  players at 90+ across 12 classes = 11.7 per class. If the mean');
console.log('  above is nowhere near that on unmodified code, this harness is');
console.log('  measuring the wrong thing and must not be used to calibrate.');

console.log('\n  a sample class, peak display OVR of its top 12 picks:');
console.log('    ' + topPeaks.slice(0, 12).join(', '));

// The distribution tail is what "a superstar" should feel like. If the 90+
// count is right but there are forty 88s behind them, the league is still flat.
const flat = allPeaks.reduce(function (a, c) { return a.concat(c); }, []);
flat.sort(function (a, b) { return b - a; });
function share(lo) { return (100 * flat.filter(function (v) { return v >= lo; }).length / flat.length).toFixed(1); }
console.log('\n  across all ' + flat.length + ' players, share reaching each peak tier:');
[95, 90, 87, 85, 80, 75].forEach(function (t) {
  console.log('    peak >= ' + String(t).padStart(2) + ':  ' + share(t).padStart(5) + '%');
});
