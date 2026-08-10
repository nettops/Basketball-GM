// Calibrates PICK_CEILING.shooter — the most shots one player may take as a
// share of his team's.
//
// The problem it fixes: a 50-season run produced six seasons with someone
// averaging 40+ points, topping out at 45.5. The 2026 league never does this
// (its busiest scorer takes 28.4% of his team's shots for 34.6 a night); the
// outliers appear once generated players start outclassing their own rosters
// badly enough to take an unbounded share.
//
// Two things have to be true at once, which is why both are measured:
//   1. The 2026 league is UNTOUCHED. If the cap pulls Embiid or Curry down, it
//      is not fixing an outlier, it is nerfing the stars the game is built on.
//   2. A lopsided roster — one great player, four poor ones — no longer yields
//      a 45-point season. This is the case the real league eventually creates
//      and the one the 2026 rosters never test.
//
// Target: nobody above ~35 a night, stars still in the 33-35 range.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js'); rq('simEngine.js'); rq('simEngineBoxScore.js');
const poss = rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');
const { makeRng } = rq('rng.js');

traits.ensureHiddenPlayerData(PLAYERS_2026);
const GAMES = Number(process.env.GAMES || 400);
const byId = {};
PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
const ORIGINAL_TEAM = {};
PLAYERS_2026.forEach(function (p) { ORIGINAL_TEAM[p.id] = p.teamId; });

function topScorers(n) {
  const rng = makeRng(777);
  const pts = {}, gp = {}, fga = {}, teamFga = {};
  for (let i = 0; i < GAMES; i++) {
    const h = TEAMS[i % TEAMS.length], a = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
    if (h.id === a.id) continue;
    const r = gameSim.simulateGame(h.id, a.id, rng);
    const tot = {};
    Object.keys(r.boxScore).forEach(function (id) {
      const p = byId[id]; if (!p) return;
      tot[p.teamId] = (tot[p.teamId] || 0) + (r.boxScore[id].fga || 0);
    });
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id], p = byId[id]; if (!p) return;
      pts[id] = (pts[id] || 0) + (l.points || 0);
      gp[id] = (gp[id] || 0) + 1;
      fga[id] = (fga[id] || 0) + (l.fga || 0);
      teamFga[id] = (teamFga[id] || 0) + (tot[p.teamId] || 0);
    });
  }
  return Object.keys(pts).filter(function (id) { return gp[id] >= 15; })
    .map(function (id) {
      return { name: byId[id].name, ovr: byId[id].overall, ppg: pts[id] / gp[id],
               share: 100 * fga[id] / teamFga[id] };
    })
    .sort(function (a, b) { return b.ppg - a.ppg; }).slice(0, n);
}

// The 45-point seasons came from a LATE-ERA league, not from a lopsided 2026
// roster — my first attempt at this sweep used the latter and never reproduced
// the problem at all (its worst case was 35.8, which is fine). So build the
// league that actually misbehaves: generated players, aged to a spread of
// career stages, which is what the league is made of by 2060.
const prospects = rq('draftProspects.js');
const progression = rq('progression.js');
const SAVED = PLAYERS_2026.slice();

function installLateEra() {
  const grng = makeRng(4242);
  const pool = [];
  for (let c = 0; c < 11 && pool.length < 500; c++) {
    const cls = prospects.generateProspectClass(grng, 64).slice(0, 60);
    const target = 22 + (c % 10);
    cls.forEach(function (p) { while (p.age < target) progression.progressPlayer(p, grng, []); });
    cls.forEach(function (p) { pool.push(p); });
  }
  traits.ensureHiddenPlayerData(pool);
  // Snake the talent across teams so it looks like a real league, not one
  // superteam — the same way the concentration probe does it.
  const ranked = pool.slice().sort(function (a, b) { return b.overall - a.overall; });
  ranked.forEach(function (p, i) {
    const round = Math.floor(i / TEAMS.length);
    const idx = (round % 2 === 0) ? (i % TEAMS.length) : (TEAMS.length - 1 - (i % TEAMS.length));
    p.teamId = (round < 15) ? TEAMS[idx].id : null;
  });
  PLAYERS_2026.length = 0;
  pool.forEach(function (p) { PLAYERS_2026.push(p); byId[p.id] = p; });
}

function restore2026() {
  PLAYERS_2026.length = 0;
  SAVED.forEach(function (p) { PLAYERS_2026.push(p); p.teamId = ORIGINAL_TEAM[p.id]; });
}

// Higher than the first pass: the cap is a per-POSSESSION share among the five
// on the floor, where a star legitimately sits far above the 20% an even split
// would give. Capping near 0.30 there throttles ordinary stars, which is why
// the 2026 column collapsed on the first attempt.
const CEILINGS = [1.0, 0.60, 0.55, 0.50, 0.45, 0.40];
console.log('USAGE CEILING SWEEP — capping one player\'s share of his team\'s shots');
console.log('  ' + GAMES + ' games per setting, same seed. 1.0 means no cap (current behaviour).\n');
console.log('  cap     2026 top scorer            late-era top scorer');
console.log('          ppg    share   name          ppg    share   name');

CEILINGS.forEach(function (c) {
  poss.PICK_CEILING.shooter = c;

  restore2026();
  const normal = topScorers(1)[0];

  installLateEra();
  const late = topScorers(1)[0];
  restore2026();

  console.log('  ' + (c === 1 ? 'none' : c.toFixed(2)).padStart(5) + '  ' +
    normal.ppg.toFixed(1).padStart(5) + '  ' + normal.share.toFixed(1).padStart(5) + '%  ' +
    normal.name.slice(0, 12).padEnd(12) + '  ' +
    late.ppg.toFixed(1).padStart(5) + '  ' + late.share.toFixed(1).padStart(5) + '%  ' +
    late.name.slice(0, 14));
});

poss.PICK_CEILING.shooter = 0.30;
PLAYERS_2026.forEach(function (p) { p.teamId = ORIGINAL_TEAM[p.id]; });
console.log('\n  Pick the loosest cap that keeps BOTH columns at or under ~35.');
console.log('  Too tight and the 2026 stars stop being stars; too loose and the');
console.log('  lopsided case runs away again.');
