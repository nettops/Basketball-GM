// What a setting does to a whole season's scoring.
//
// Reports PACE and EFFICIENCY separately, because they are the two independent
// ways to move points and they feel completely different: more possessions is a
// faster game at the same shooting, higher make rates is the same game with
// easier shots. A points-per-game number alone cannot tell you which you got.
//
// Run:  node scripts/sweep-scoring.js [seasons] [seedBase]
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
const gameSim = rq('gameSim.js');
const schedule = rq('schedule.js');

function runSeason(seed) {
  const rng = makeRng(seed);
  const games = schedule.generateSeasonGames(rng, TEAMS);
  const wins = {}; TEAMS.forEach(function (t) { wins[t.id] = 0; });
  let pts = 0, n = 0, fga = 0, fgm = 0, tpa = 0, tpm = 0;
  let marginSum = 0, close = 0, poss = 0;
  let offBadge = 0, defBadge = 0, atk = 0, def = 0, shots = 0;

  games.forEach(function (g, i) {
    const ev = [];
    const res = gameSim.simulateGame(g.home, g.away, makeRng(seed * 7919 + i), { events: ev });
    n++;
    pts += res.homeScore + res.awayScore;
    const m = Math.abs(res.homeScore - res.awayScore);
    marginSum += m;
    if (m <= 5) close++;
    wins[res.homeScore > res.awayScore ? g.home : g.away]++;
    Object.keys(res.boxScore).forEach(function (id) {
      const b = res.boxScore[id];
      fga += b.fga || 0; fgm += b.fgm || 0; tpa += b.tpa || 0; tpm += b.tpm || 0;
    });
    ev.forEach(function (e) {
      // one possession ends in a shot or a turnover
      if (e && (e.type === 'shot' || e.type === 'turnover')) poss++;
      if (!e || e.type !== 'shot' || !e.check) return;
      shots++;
      atk += e.check.attackTerm; def += e.check.defendTerm;
      (e.check.modifiers || []).forEach(function (mod) {
        if (mod.label === 'badges') offBadge += mod.value;
        else if (mod.label === 'defensive badges') defBadge += mod.value;
      });
    });
  });

  const w = TEAMS.map(function (t) { return wins[t.id]; }).sort(function (a, b) { return b - a; });
  return {
    pts: pts / n / 2, fg: fgm / fga * 100, tp: tpm / tpa * 100,
    poss: poss / n / 2, ppp: (pts / n / 2) / (poss / n / 2),
    bestW: w[0], worstW: w[w.length - 1],
    margin: marginSum / n, close: close / n * 100,
    offBadge: offBadge / shots * 100, defBadge: defBadge / shots * 100,
    atk: atk / shots * 100, def: def / shots * 100
  };
}

const seasons = Number(process.argv[2] || 1);
const out = [];
const seedBase = Number(process.argv[3] || 4100);
for (let s = 0; s < seasons; s++) out.push(runSeason(seedBase + s));
const avg = function (k) { return out.reduce(function (a, r) { return a + r[k]; }, 0) / out.length; };
process.stdout.write(JSON.stringify({
  pts: +avg('pts').toFixed(2), fg: +avg('fg').toFixed(2), tp: +avg('tp').toFixed(2),
  poss: +avg('poss').toFixed(1), ppp: +avg('ppp').toFixed(3),
  bestW: +avg('bestW').toFixed(1), worstW: +avg('worstW').toFixed(1),
  margin: +avg('margin').toFixed(2), close: +avg('close').toFixed(1),
  offBadge: +avg('offBadge').toFixed(3), defBadge: +avg('defBadge').toFixed(3),
  atk: +avg('atk').toFixed(2), def: +avg('def').toFixed(2)
}));
