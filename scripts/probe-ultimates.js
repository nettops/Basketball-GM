// Measures the takeover through a REAL season, driven by league.simulateDate.
//
// Never measure this with gameSim.simulateGame in a loop. That path skips
// fatigue, injuries, morale and rotations and reads roughly 35% low — a rate
// calibrated in the isolated harness lands badly wrong in the actual game.
//
// One season per process. Sweep with:
//   for v in 100 140 180; do CHARGE_FULL=$v QUIET=1 node scripts/probe-ultimates.js; done
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
rq('gameCoach.js'); rq('gameSim.js');
const ult = rq('ultimates.js');
const league = rq('league.js');
const schedule = rq('schedule.js');

// Env overrides so a sweep needs no edit per point.
if (process.env.CHARGE_FULL) ult.CHARGE_TUNING.full = Number(process.env.CHARGE_FULL);
if (process.env.TAKEOVER_POSS) ult.CHARGE_TUNING.takeoverPossessions = Number(process.env.TAKEOVER_POSS);
if (process.env.SECOND_MULT) ult.CHARGE_TUNING.secondFullMultiplier = Number(process.env.SECOND_MULT);
if (process.env.GATE) ult.ULTIMATE_TUNING.gateOverall = Number(process.env.GATE);
if (process.env.AFFINITY) ult.CHARGE_TUNING.affinityMultiplier = Number(process.env.AFFINITY);

const SEED = Number(process.env.SEED || 4242);
const QUIET = !!process.env.QUIET;

const holders = PLAYERS_2026.filter(function (p) { return ult.hasUltimate(p); });
const holderIds = {};
holders.forEach(function (p) { holderIds[p.id] = ult.ultimateFor(p).key; });

const games = schedule.generateSeasonGames(makeRng(SEED), TEAMS).map(function (g) {
  return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
    played: false, homeScore: null, awayScore: null, boxScore: null,
    isPlayoff: false, seriesId: null };
});
const season = { games: games, currentDay: -1 };
const rng = makeRng(SEED);
const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
for (let d = 0; d <= lastDay; d++) {
  league.simulateDate(season, d, { leagueYear: 2026 }, rng, null, null);
}

// Every takeover that happened, mined from the box scores the season produced.
let takeovers = 0, doubles = 0, starGames = 0, starGamesWithOne = 0;
const added = [];
const byUltimate = {};
let teamPoints = 0, teamGames = 0, played = 0;

const cutPts = [];
games.forEach(function (g) {
  if (!g.played || !g.boxScore) return;
  played += 1;
  (g.takeovers || []).forEach(function (t) {
    const k = holderIds[t.playerId];
    if (t.cutShort) { cutPts.push(t.points); }
    else { added.push(t.points); if (k) { byUltimate[k] = byUltimate[k] || { n: 0, pts: 0 }; byUltimate[k].n += 1; byUltimate[k].pts += t.points; } }
  });
  teamPoints += g.homeScore + g.awayScore;
  teamGames += 2;
  Object.keys(g.boxScore).forEach(function (pid) {
    const line = g.boxScore[pid];
    if (!line || line.takeoversUsed === undefined) return;
    if (!holderIds[pid]) return;
    starGames += 1;
    if (line.takeoversUsed >= 1) { starGamesWithOne += 1; takeovers += line.takeoversUsed; }
    if (line.takeoversUsed >= 2) doubles += 1;
    // Points come from the takeover LOG, not the box line: a line holds only
    // the most recent takeover, and only the log knows which the buzzer cut short.
  });
});

const mean = added.length
  ? added.reduce(function (a, b) { return a + b; }, 0) / added.length : 0;
const perGame = takeovers / Math.max(1, played);
const starShare = starGamesWithOne / Math.max(1, starGames);
const scoring = teamPoints / Math.max(1, teamGames);

if (QUIET) {
  console.log([
    process.env.CHARGE_FULL || ult.CHARGE_TUNING.full,
    process.env.TAKEOVER_POSS || ult.CHARGE_TUNING.takeoverPossessions,
    perGame.toFixed(3), starShare.toFixed(3),
    doubles ? (played / doubles).toFixed(1) : 'inf',
    mean.toFixed(1), scoring.toFixed(2), holders.length
  ].join('\t'));
} else {
  console.log('holders league-wide       ' + holders.length + '   (target 30-60)');
  console.log('takeovers per game        ' + perGame.toFixed(3) + '   (target ~1.0)');
  console.log('star-games with one       ' + (100 * starShare).toFixed(1) + '%   (target ~50%)');
  console.log('two in one game           1 in ' + (doubles ? (played / doubles).toFixed(1) : '∞') +
    ' games   (target ~15)');
  const cutMean = cutPts.length ? cutPts.reduce(function (a, b) { return a + b; }, 0) / cutPts.length : 0;
  const allMean = (added.concat(cutPts)).reduce(function (a, b) { return a + b; }, 0) / Math.max(1, added.length + cutPts.length);
  console.log('points added, ran its course  ' + mean.toFixed(1) + '   (target 10-15)');
  console.log('points added, cut by buzzer   ' + cutMean.toFixed(1) + '   (' + (100 * cutPts.length / Math.max(1, cutPts.length + added.length)).toFixed(0) + '% of takeovers)');
  console.log('points added, all takeovers   ' + allMean.toFixed(1));
  console.log('league pts per team-game  ' + scoring.toFixed(2) + '   (baseline 134.86, must not move)');
  console.log('');
  console.log('by ultimate (count, mean points added):');
  Object.keys(byUltimate).sort().forEach(function (k) {
    console.log('  ' + k.padEnd(18) + String(byUltimate[k].n).padStart(4) + '   ' +
      (byUltimate[k].pts / byUltimate[k].n).toFixed(1));
  });
}
