// Do the 42-ppg scoring leaders and the 39% league 3P% share one cause?
//
// The hypothesis: both are SELECTION, not accuracy. simEnginePossession picks
// the shooter with weightedPick(offense, scoringWeight, rng, PICK_POWER.shooter
// = 1.4) — a relative weight among the five on the floor. The exponent never
// changes, but the INPUT spread does: the 2026 league runs 60/75/95 and the
// 2075 league runs 55/77/100. A wider spread means the best player on each
// team takes a larger share of his team's shots, which simultaneously
//   (a) pushes his points per game up, and
//   (b) raises league 3P%, because a larger fraction of all threes are taken
//       by the players who shoot them best.
//
// If that is right, then 3P% by shooter-quintile should be flat-ish between the
// two leagues while the SHARE of attempts shifts toward the top quintile. If
// instead the per-quintile percentages themselves rise, the cause is accuracy
// and this hypothesis is wrong.
//
// The 2075-like league is SYNTHETIC — generated classes aged forward, sized to
// match — because materialising the real one costs a 50-season run. It
// reproduces the distribution, not the history, and that is the limit of what
// this probe can claim.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const prospects = rq('draftProspects.js');
const ratings = rq('ratings.js');
const progression = rq('progression.js');
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');

traits.ensureHiddenPlayerData(PLAYERS_2026);
const GAMES = Number(process.env.GAMES || 600);

function quintile(sorted, v) {
  let i = 0;
  while (i < sorted.length && sorted[i] < v) i++;
  return Math.min(4, Math.floor(5 * i / sorted.length));
}

// Runs GAMES games over whatever pool is currently assigned to TEAMS and
// reports where the shots went and who made them.
function measure(label, pool) {
  const byId = {};
  pool.forEach(function (p) { byId[p.id] = p; });
  const rng = makeRng(777);

  // Assign 15 per team, best-first snake so teams are competitive rather than
  // one superteam — matching how the real league distributes talent.
  const ranked = pool.slice().sort(function (a, b) { return b.overall - a.overall; });
  ranked.forEach(function (p, i) {
    const round = Math.floor(i / TEAMS.length);
    const idx = (round % 2 === 0) ? (i % TEAMS.length) : (TEAMS.length - 1 - (i % TEAMS.length));
    p.teamId = (round < 15) ? TEAMS[idx].id : null;
  });

  const scoringSorted = pool.filter(function (p) { return p.teamId; })
    .map(function (p) { return p.attributes.threePoint; })
    .sort(function (a, b) { return a - b; });

  const tpaByQ = [0, 0, 0, 0, 0], tpmByQ = [0, 0, 0, 0, 0];
  const ppg = {}, gp = {};
  let fga = 0, fgm = 0, tpa = 0, tpm = 0, pts = 0, teamGames = 0;

  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    teamGames += 2;
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      const pl = byId[id];
      if (!pl) return;
      fga += l.fga || 0; fgm += l.fgm || 0;
      tpa += l.tpa || 0; tpm += l.tpm || 0;
      pts += l.points || 0;
      ppg[id] = (ppg[id] || 0) + (l.points || 0);
      gp[id] = (gp[id] || 0) + 1;
      const q = quintile(scoringSorted, pl.attributes.threePoint);
      tpaByQ[q] += l.tpa || 0; tpmByQ[q] += l.tpm || 0;
    });
  }

  const leaders = Object.keys(ppg)
    .filter(function (id) { return gp[id] >= 20; })
    .map(function (id) { return { name: byId[id].name, ovr: byId[id].overall, ppg: ppg[id] / gp[id] }; })
    .sort(function (a, b) { return b.ppg - a.ppg; });

  const ovr = pool.map(function (p) { return p.overall; }).sort(function (a, b) { return a - b; });
  console.log('\n' + label);
  console.log('  distribution: min ' + ovr[0] + '  med ' + ovr[Math.floor(0.5 * ovr.length)] +
    '  max ' + ovr[ovr.length - 1] + '   (n=' + pool.length + ')');
  console.log('  league: FG% ' + (100 * fgm / fga).toFixed(1) + '   3P% ' + (100 * tpm / tpa).toFixed(1) +
    '   3PA share ' + (100 * tpa / fga).toFixed(1) + '%   pts/team ' + (pts / teamGames).toFixed(1));
  console.log('  top scorers: ' + leaders.slice(0, 3).map(function (l) {
    return l.name + ' ' + l.ppg.toFixed(1) + ' (' + l.ovr + ')';
  }).join(',  '));
  console.log('  three-point shooting by shooter quintile (5 = best shooters):');
  console.log('    quintile   share of 3PA    3P%');
  for (let q = 4; q >= 0; q--) {
    console.log('      ' + (q + 1) + '        ' + (100 * tpaByQ[q] / tpa).toFixed(1).padStart(8) + '%   ' +
      (tpmByQ[q] ? (100 * tpmByQ[q] / tpaByQ[q]).toFixed(1) : '  -').padStart(7));
  }
  return { tpaByQ: tpaByQ, tpmByQ: tpmByQ, tpa: tpa, top: leaders[0] };
}

console.log('SHOT CONCENTRATION — is the drift selection, or accuracy?');
console.log('  ' + GAMES + ' games per league, same seed.');

const original = PLAYERS_2026.map(function (p) { return p.teamId; });
const a = measure('2026 LEAGUE (authored)', PLAYERS_2026);
PLAYERS_2026.forEach(function (p, i) { p.teamId = original[i]; });

// Synthetic late-era league: generated classes aged to a spread of career
// stages, sized to the ~500 the 50-season run settles at.
const grng = makeRng(4242);
const future = [];
for (let c = 0; c < 12 && future.length < 500; c++) {
  const cls = prospects.generateProspectClass(grng, 64).slice(0, 60);
  const target = 22 + (c % 10);
  cls.forEach(function (p) {
    while (p.age < target) progression.progressPlayer(p, grng, []);
  });
  cls.forEach(function (p) { future.push(p); });
}
traits.ensureHiddenPlayerData(future);
future.forEach(function (p) { if (!p.seasonStats) p.seasonStats = undefined; });

// The engine reads players out of the league module, so the future pool has to
// replace it for the duration of its measurement, then be put back.
const saved = PLAYERS_2026.slice();
PLAYERS_2026.length = 0;
future.forEach(function (p) { PLAYERS_2026.push(p); });
const b = measure('SYNTHETIC LATE-ERA LEAGUE (generated, aged)', future);
PLAYERS_2026.length = 0;
saved.forEach(function (p) { PLAYERS_2026.push(p); });
PLAYERS_2026.forEach(function (p, i) { p.teamId = original[i]; });

console.log('\nVERDICT');
const shareTopA = 100 * a.tpaByQ[4] / a.tpa, shareTopB = 100 * b.tpaByQ[4] / b.tpa;
const pctTopA = 100 * a.tpmByQ[4] / a.tpaByQ[4], pctTopB = 100 * b.tpmByQ[4] / b.tpaByQ[4];
console.log('  top-quintile SHARE of threes:  ' + shareTopA.toFixed(1) + '%  ->  ' + shareTopB.toFixed(1) + '%');
console.log('  top-quintile 3P%:              ' + pctTopA.toFixed(1) + '%  ->  ' + pctTopB.toFixed(1) + '%');
console.log('  If the SHARE moved and the per-quintile percentages did not,');
console.log('  the drift is selection and the fix belongs in the talent spread.');
console.log('  If the percentages themselves rose, it is accuracy and this');
console.log('  hypothesis is wrong.');
