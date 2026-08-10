// draftProspects.js:200 is a two-fields-two-meanings bug, the same shape as
// level/traitsAreFuzzy and rawOverall/overall before it:
//
//   prospect.potential = Math.max(clampedOverall, Math.min(99, estimate...))
//
// `clampedOverall` is on the AUTHORED scale (line 186 builds it as 58 + rank*22,
// the same scale players-2026.js's mkPlayer takes and immediately z-scores away
// through makeAttributes). `potential` is stored RAW — progression.js:138
// differences it against rawOverall. The Math.max therefore compares a number
// from one scale against a number from another and keeps the larger, which is
// almost always the authored one because the authored scale runs ~30 points
// higher than raw.
//
// This probe prints both scales side by side for a generated class so the
// mismatch is a measurement rather than a reading. If the floor imposed by
// clampedOverall sits above what the Monte Carlo actually estimated, then every
// prospect is handed a ceiling nobody measured, and progression.js's gap pull
// (0.15/yr under age 25) spends the next seven seasons chasing it.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
rq('teams.js'); rq('traits.js'); rq('scouting.js');
const players = rq('players-2026.js');
const prospects = rq('draftProspects.js');
const ratings = rq('ratings.js');
const { makeRng } = rq('rng.js');

const PLAYERS_2026 = players.PLAYERS_2026;

// What the league these prospects are joining actually looks like, in raw.
const raws = PLAYERS_2026.map(function (p) { return p.rawOverall; }).sort(function (a, b) { return a - b; });
const disp = PLAYERS_2026.map(function (p) { return p.overall; }).sort(function (a, b) { return a - b; });
function q(a, p) { return a[Math.floor(p * (a.length - 1))]; }
console.log('THE LEAGUE THEY ARE JOINING (2026 opening rosters, n=' + raws.length + ')');
console.log('  raw overall  min ' + raws[0].toFixed(1) + '  median ' + q(raws, 0.5).toFixed(1) +
  '  p95 ' + q(raws, 0.95).toFixed(1) + '  max ' + raws[raws.length - 1].toFixed(1));
console.log('  display      min ' + disp[0] + '  median ' + q(disp, 0.5) +
  '  p95 ' + q(disp, 0.95) + '  max ' + disp[disp.length - 1]);
const pots = PLAYERS_2026.map(function (p) { return p.potential; }).sort(function (a, b) { return a - b; });
console.log('  potential(raw) median ' + q(pots, 0.5).toFixed(1) + '  max ' + pots[pots.length - 1].toFixed(1));

console.log('\nA GENERATED DRAFT CLASS (generateProspectClass, 64 picks)');
console.log('  "authored" is line 186\'s number — the scale makeAttributes consumes.');
console.log('  "raw" is what the prospect actually came out as.');
console.log('  "MC" is what estimatePotentialMonteCarlo measured his ceiling to be.');
console.log('  "kept" is what line 200 stored. It is max(authored, MC).\n');
console.log('  pick  authored   raw    MC   kept   floor?   kept as display OVR');

const cls = prospects.generateProspectClass(makeRng(31337), 64);
let flooredCount = 0, floorExcess = 0;
cls.forEach(function (p, i) {
  // Reconstruct line 186/194 exactly for this pick index.
  const rankFactor = 1 - i / 64;
  // The rng draw cannot be replayed, so bracket it: the noise term is
  // (rng()-0.5)*8, i.e. +/-4. Report the deterministic centre.
  const authoredCentre = Math.max(40, Math.min(90, Math.round(58 + rankFactor * 22)));
  const kept = p.potential;
  // MC is not recoverable after the fact either, but the FLOOR is testable:
  // if kept is within rounding of the authored number, the Math.max chose the
  // authored branch and the Monte Carlo estimate was discarded.
  const flooredByAuthored = Math.abs(kept - authoredCentre) <= 4;
  if (flooredByAuthored) { flooredCount++; floorExcess += kept - p.rawOverall; }
  if (i % 8 === 0 || i === 63) {
    console.log('  ' + String(i + 1).padStart(4) + '  ' +
      String(authoredCentre).padStart(8) + ' ' + p.rawOverall.toFixed(1).padStart(5) + '  ' +
      '   ?' + ' ' + kept.toFixed(1).padStart(5) + '  ' +
      (flooredByAuthored ? ' YES  ' : '  no  ') + '   ' +
      String(ratings.toDisplayRating(kept)).padStart(8));
  }
});

console.log('\n  prospects whose stored potential matches the AUTHORED number');
console.log('  (i.e. the Monte Carlo estimate was thrown away): ' +
  flooredCount + ' of ' + cls.length);
if (flooredCount) {
  console.log('  average headroom those prospects were handed: +' +
    (floorExcess / flooredCount).toFixed(1) + ' raw above their actual rating');
}

const keptDisp = cls.map(function (p) { return ratings.toDisplayRating(p.potential); }).sort(function (a, b) { return a - b; });
const nowDisp = cls.map(function (p) { return p.overall; }).sort(function (a, b) { return a - b; });
console.log('\nTHE COMPARISON THAT MATTERS');
console.log('  this class, CURRENT display OVR:   min ' + nowDisp[0] +
  '  median ' + q(nowDisp, 0.5) + '  max ' + nowDisp[nowDisp.length - 1]);
console.log('  this class, POTENTIAL as display:  min ' + keptDisp[0] +
  '  median ' + q(keptDisp, 0.5) + '  max ' + keptDisp[keptDisp.length - 1]);
console.log('  the league median today is display ' + q(disp, 0.5) + '.');
const worseThanLeagueMedian = keptDisp.filter(function (v) { return v < q(disp, 0.5); }).length;
console.log('  prospects in this class whose CEILING is below that median: ' +
  worseThanLeagueMedian + ' of ' + cls.length);
console.log('\n  Every draft is 60 players pulled toward those ceilings at 0.15 of');
console.log('  the gap per year (progression.js:139-143), and 60 more arrive the');
console.log('  next year. That is the inflation.');
