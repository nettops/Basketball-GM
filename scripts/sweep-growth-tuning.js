// Sweeps progression.GROWTH_TUNING against the superstars-per-draft-class rate.
//
// The target is 2-4 players per 60-man class ever peaking at display 90+.
// Unmodified code produces 21.65. This finds the setting that lands in the
// band, by measuring each candidate rather than by picking one that looks
// reasonable.
//
// Two things are being fixed and they are not the same kind of thing:
//
//   The CLIP asymmetry is a defect. [-4, 20] against an SD of 5 clips 0.8
//   sigma of downside against 4 sigma of upside, so noise that reads as
//   symmetric carries a positive mean (+0.62/yr at age 20, measured in
//   probe-progression-drift.js) and a long upside tail. Symmetrising it is a
//   correction, not a tuning choice.
//
//   The BASE values are a design choice — how fast should a 19-year-old
//   improve? — and those are what get calibrated to hit the user's target.
//
// Each config is run over the same class seeds, so differences between rows
// are the config and not the draw.
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

const CLASSES = Number(process.env.CLASSES || 25);
const DRAFTED = 60;
const PEAK_AGE = 32;
const SUPERSTAR = ratings.RATING_BANDS.superstar;
const TUNING = progression.GROWTH_TUNING;

// Snapshot the shipped defaults so each config starts from a known state
// rather than from whatever the previous config left behind.
const DEFAULT_BASE = TUNING.base.map(function (r) { return r.slice(); });
const DEFAULT_NOISE = TUNING.noise.map(function (r) { return r.slice(); });

function apply(cfg) {
  TUNING.base = DEFAULT_BASE.map(function (r) { return r.slice(); });
  TUNING.noise = DEFAULT_NOISE.map(function (r) { return r.slice(); });
  // chanceScale 0 disables busting entirely, which is what "shipped" means
  // here — bustChance existed but nothing read it.
  prospects.BUST_TUNING.chanceScale = cfg.bustScale === undefined ? 0 : cfg.bustScale;
  prospects.BUST_TUNING.retainedGap = cfg.bustGap === undefined ? 0.25 : cfg.bustGap;
  prospects.BUST_TUNING.developmentRate = cfg.bustDev === undefined ? 0.35 : cfg.bustDev;
  if (cfg.base21 !== undefined) TUNING.base[0][1] = cfg.base21;
  if (cfg.base25 !== undefined) TUNING.base[1][1] = cfg.base25;
  if (cfg.sdYoung !== undefined) { TUNING.noise[0][1] = cfg.sdYoung; TUNING.noise[1][1] = cfg.sdYoung; }
  if (cfg.clip !== undefined) {
    // Symmetric clip expressed in sigma, so it stays symmetric when sd moves.
    const s0 = TUNING.noise[0][1], s1 = TUNING.noise[1][1];
    TUNING.noise[0][2] = -cfg.clip * s0; TUNING.noise[0][3] = cfg.clip * s0;
    TUNING.noise[1][2] = -cfg.clip * s1; TUNING.noise[1][3] = cfg.clip * s1;
  }
}

function measure() {
  const counts = [];
  const allPeaks = [];
  for (let i = 0; i < CLASSES; i++) {
    const rng = makeRng(1000 + i * 17);
    const cls = prospects.generateProspectClass(rng, 64).slice(0, DRAFTED);
    let n = 0;
    cls.forEach(function (p) {
      let peak = p.overall;
      while (p.age < PEAK_AGE) {
        progression.progressPlayer(p, rng, []);
        if (p.overall > peak) peak = p.overall;
      }
      allPeaks.push(peak);
      if (peak >= SUPERSTAR) n++;
    });
    counts.push(n);
  }
  const mean = counts.reduce(function (a, c) { return a + c; }, 0) / counts.length;
  const sorted = counts.slice().sort(function (a, b) { return a - b; });
  allPeaks.sort(function (a, b) { return b - a; });
  function share(lo) { return 100 * allPeaks.filter(function (v) { return v >= lo; }).length / allPeaks.length; }
  return {
    mean: mean, min: sorted[0], max: sorted[sorted.length - 1],
    median: sorted[Math.floor(0.5 * (sorted.length - 1))],
    p95: allPeaks[Math.floor(0.05 * allPeaks.length)],
    medPeak: allPeaks[Math.floor(0.5 * allPeaks.length)],
    best: allPeaks[0],
    share90: share(90), share85: share(85), share75: share(75)
  };
}

// Two levers, and they do different jobs. The growth lever (clip/sd/base)
// lowers EVERYBODY, which flattens the league. The bust lever lowers a third
// of each class to nothing while leaving the players who hit fully intact —
// which is what "2-4 superstars per class" is supposed to feel like. So the
// sweep leans on bust first and uses growth only as much as it has to.
// Now that busting damps DEVELOPMENT and not just the ceiling, the bust lever
// alone should be able to carry most of the way — which is the outcome worth
// having, because it leaves the players who hit untouched. The growth lever is
// swept alongside only to see how much of it is still needed.
// Fine sweep around the promising region. Two targets, not one — a config that
// hits 2-4 superstars by making EVERY draftee mediocre has not produced stars,
// it has produced a flat league. So the median drafted player's peak is read
// alongside: he should come out a rotation player near the league median of
// 75, not an 86 (which is what shipped code does, and is the real absurdity —
// half of every draft class peaking eleven points above the median NBA player).
const CONFIGS = [
  { name: 'shipped (control)',              cfg: {} },
  { name: 'A clip2 sd3 b1/.5 bx2',          cfg: { clip: 2.0, sdYoung: 3, base21: 1, base25: 0.5, bustScale: 2, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'B clip2 sd3 b1/.5 bx2.5',        cfg: { clip: 2.0, sdYoung: 3, base21: 1, base25: 0.5, bustScale: 2.5, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'C clip2 sd2.5 b1/.5 bx2',        cfg: { clip: 2.0, sdYoung: 2.5, base21: 1, base25: 0.5, bustScale: 2, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'D clip2 sd2.5 b1/.5 bx2.5',      cfg: { clip: 2.0, sdYoung: 2.5, base21: 1, base25: 0.5, bustScale: 2.5, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'E clip2 sd3 b.75/.25 bx2',       cfg: { clip: 2.0, sdYoung: 3, base21: 0.75, base25: 0.25, bustScale: 2, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'F clip2 sd3 b.5/.25 bx2',        cfg: { clip: 2.0, sdYoung: 3, base21: 0.5, base25: 0.25, bustScale: 2, bustGap: 0.10, bustDev: 0.20 } },
  { name: 'G clip2 sd2.5 b.75/.25 bx2.5',   cfg: { clip: 2.0, sdYoung: 2.5, base21: 0.75, base25: 0.25, bustScale: 2.5, bustGap: 0.10, bustDev: 0.20 } }
];

console.log('SWEEP — superstars per 60-man draft class (target 2-4)');
console.log('  ' + CLASSES + ' classes per config, same seeds across configs\n');
console.log('  config                          mean   min  med  max  | peak OVR: p95  med  best | %>=90  %>=85  %>=75');
CONFIGS.forEach(function (c) {
  apply(c.cfg);
  const r = measure();
  const hit = r.mean >= 2 && r.mean <= 4 ? ' <== IN BAND' : '';
  console.log('  ' + c.name.padEnd(30) +
    r.mean.toFixed(2).padStart(6) + '  ' + String(r.min).padStart(4) + ' ' +
    String(r.median).padStart(4) + ' ' + String(r.max).padStart(4) + '  |' +
    String(r.p95).padStart(13) + String(r.medPeak).padStart(5) + String(r.best).padStart(6) + ' |' +
    r.share90.toFixed(1).padStart(6) + r.share85.toFixed(1).padStart(7) + r.share75.toFixed(1).padStart(7) + hit);
});

// Restore, so a later require in the same process is not left on the last config.
TUNING.base = DEFAULT_BASE.map(function (r) { return r.slice(); });
TUNING.noise = DEFAULT_NOISE.map(function (r) { return r.slice(); });
