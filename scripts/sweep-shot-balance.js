// Makes defence as strong as offence in the shot model, without changing what
// the 2026 league looks like.
//
// The problem: shot quality is base + shooter/skillDiv - defender/defDiv, and
// those divisors were 250 and 350. Unequal divisors mean the ABSOLUTE level of
// the league leaks into scoring — lift every player by the same amount and the
// whole league shoots better, because the shooters gained more than the
// defenders did. Over fifty simulated seasons that showed up as league 3P%
// settling near 39% against a 34-38 target.
//
// The fix is to set defDiv = skillDiv so the two cancel. But that alone makes
// every shot harder, so the per-zone bases have to be re-solved to put the 2026
// league back exactly where it was. This script does the solving by measuring,
// not by algebra: simulate, compare against the locked 2026 rates, nudge the
// base, repeat.
//
// Then it re-runs the uniform-shift test that exposed the problem. If the fix
// works, that line goes flat.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { ATTRIBUTE_KEYS } = rq('data.js');
rq('ratings.js'); rq('simEngine.js'); rq('simEngineBoxScore.js');
const poss = rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');
const { makeRng } = rq('rng.js');

traits.ensureHiddenPlayerData(PLAYERS_2026);
const GAMES = Number(process.env.GAMES || 500);
const T = poss.SHOT_TUNING;

function measure(shift) {
  const snap = shift ? PLAYERS_2026.map(function (p) { return Object.assign({}, p.attributes); }) : null;
  if (shift) {
    PLAYERS_2026.forEach(function (p) {
      ATTRIBUTE_KEYS.forEach(function (k) {
        p.attributes[k] = Math.max(0, Math.min(100, p.attributes[k] + shift));
      });
    });
  }
  const rng = makeRng(777);
  let fga = 0, fgm = 0, tpa = 0, tpm = 0, pts = 0, tg = 0;
  for (let i = 0; i < GAMES; i++) {
    const h = TEAMS[i % TEAMS.length], a = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
    if (h.id === a.id) continue;
    const r = gameSim.simulateGame(h.id, a.id, rng);
    tg += 2;
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      fga += l.fga || 0; fgm += l.fgm || 0; tpa += l.tpa || 0; tpm += l.tpm || 0; pts += l.points || 0;
    });
  }
  const med = PLAYERS_2026.map(function (p) { return p.overall; }).sort(function (x, y) { return x - y; })[190];
  if (shift) PLAYERS_2026.forEach(function (p, i) { p.attributes = snap[i]; });
  return {
    med: med,
    fg: 100 * fgm / fga,
    tp: 100 * tpm / tpa,
    // Two-point percentage, so `mid` and `inside` can be solved apart from `three`.
    two: 100 * (fgm - tpm) / (fga - tpa),
    share: 100 * tpa / fga,
    pts: pts / tg
  };
}

console.log('SHOT BALANCE — making defence count as much as offence\n');
// The baseline must be measured with the ORIGINAL divisors, not with whatever
// SHOT_TUNING currently holds. Reading it afterwards is how a solver
// "converges" on iteration zero having done nothing: it compares the new setup
// against itself. That happened on the first run of this script.
const ORIGINAL = { skillDiv: 250, defDiv: 350, base: { three: 0.330, mid: 0.42, inside: 0.56 } };
const TARGET = { skillDiv: T.skillDiv, defDiv: T.defDiv };
T.skillDiv = ORIGINAL.skillDiv; T.defDiv = ORIGINAL.defDiv;
T.base = { three: ORIGINAL.base.three, mid: ORIGINAL.base.mid, inside: ORIGINAL.base.inside };
const before = measure(0);
T.skillDiv = TARGET.skillDiv; T.defDiv = TARGET.defDiv;
console.log('  2026 league on the ORIGINAL 250/350 divisors (the numbers to preserve):');
console.log('    FG% ' + before.fg.toFixed(2) + '   3P% ' + before.tp.toFixed(2) +
  '   2P% ' + before.two.toFixed(2) + '   pts/team ' + before.pts.toFixed(1));

// Equal divisors: a point of defence is now worth exactly a point of offence.
// Divisors are set in SHOT_TUNING itself now; the sweep only solves bases.
console.log('\n  defDiv set to ' + T.defDiv + ' (was 350). Re-solving the bases so the');
console.log('  2026 league lands back on the same numbers.\n');
console.log('  iter   three   mid     inside  |   FG%    3P%    2P%   pts');

// Probability enters linearly before clamping, so a percentage-point gap maps
// almost one-for-one onto the base. Damped slightly to avoid overshoot, and run
// to convergence rather than a fixed guess.
for (let it = 0; it < 8; it++) {
  const m = measure(0);
  const dTp = (before.tp - m.tp) / 100;
  const dTwo = (before.two - m.two) / 100;
  console.log('  ' + String(it).padStart(4) + '  ' +
    T.base.three.toFixed(4) + '  ' + T.base.mid.toFixed(4) + '  ' + T.base.inside.toFixed(4) + '  |  ' +
    m.fg.toFixed(2) + '  ' + m.tp.toFixed(2) + '  ' + m.two.toFixed(2) + '  ' + m.pts.toFixed(1));
  if (Math.abs(dTp) < 0.0015 && Math.abs(dTwo) < 0.0015) { console.log('  converged'); break; }
  T.base.three += dTp * 0.9;
  T.base.mid += dTwo * 0.9;
  T.base.inside += dTwo * 0.9;
}

const after = measure(0);
console.log('\n  RESULT');
console.log('    before:  FG% ' + before.fg.toFixed(2) + '   3P% ' + before.tp.toFixed(2) +
  '   2P% ' + before.two.toFixed(2) + '   pts ' + before.pts.toFixed(1));
console.log('    after:   FG% ' + after.fg.toFixed(2) + '   3P% ' + after.tp.toFixed(2) +
  '   2P% ' + after.two.toFixed(2) + '   pts ' + after.pts.toFixed(1));
console.log('    bases:   three ' + T.base.three.toFixed(4) + '  mid ' + T.base.mid.toFixed(4) +
  '  inside ' + T.base.inside.toFixed(4));

console.log('\n  SCALE TEST — move every attribute on every player together.');
console.log('  This is the line that used to slope. It should now be flat.\n');
console.log('    shift  medOVR    FG%     3P%    pts');
[-10, -5, 0, 5].forEach(function (s) {
  const r = measure(s);
  console.log('    ' + String(s).padStart(5) + '  ' + String(r.med).padStart(6) + '  ' +
    r.fg.toFixed(1).padStart(5) + '  ' + r.tp.toFixed(1).padStart(6) + '  ' + r.pts.toFixed(1).padStart(6));
});
console.log('\n  Paste the solved bases into SHOT_TUNING in simEnginePossession.js.');
