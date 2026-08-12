// What bar makes a feat rare enough to mean something?
//
// Our league scores ~135 a team, so basketball's traditional 50-point night is
// far less remarkable here than it is in a 115-point league. The bars are
// therefore chosen from measured rates, not from tradition. Reports how often
// each candidate would fire, league-wide, per season.
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
rq('gameCoach.js');
const gameSim = rq('gameSim.js');
const feats = rq('feats.js');

global.GameState = global.GameState ||
  { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };

const GAMES = Number(process.env.GAMES || 400);
// A full league season is 30 teams x 82 games / 2.
const GAMES_PER_SEASON = 1230;

const rng = makeRng(Number(process.env.SEED || 4242));
const lines = [];
for (let i = 0; i < GAMES; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 7) % TEAMS.length];
  if (home.id === away.id) continue;
  const r = gameSim.simulateGame(home.id, away.id, rng, {});
  Object.keys(r.boxScore).forEach(function (id) { lines.push(r.boxScore[id]); });
}
const gamesSimmed = GAMES;
const scale = GAMES_PER_SEASON / gamesSimmed;

function perSeason(count) { return count * scale; }

console.log('sampled ' + gamesSimmed + ' games, ' + lines.length + ' player-lines');
console.log('rates below are LEAGUE-WIDE PER SEASON (' + GAMES_PER_SEASON + ' games)');
console.log('');
const points = lines.map(function (l) { return l.points || 0; }).sort(function (a, b) { return b - a; });
console.log('highest ten lines: ' + points.slice(0, 10).join(', '));
console.log('');

console.log('points bar   nights at or above');
[40, 45, 48, 50, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 65, 70].forEach(function (bar) {
  const n = lines.filter(function (l) { return (l.points || 0) >= bar; }).length;
  console.log('  ' + String(bar).padStart(3) + '        ' + perSeason(n).toFixed(1).padStart(8));
});
console.log('');

console.log('triple-double bar   nights with 3+ categories at or above');
[10, 11, 12, 13, 14, 15, 16].forEach(function (bar) {
  const n = lines.filter(function (l) { return feats.featCategoryCount(l, bar) >= 3; }).length;
  console.log('  ' + String(bar).padStart(3) + '               ' + perSeason(n).toFixed(1).padStart(8));
});
console.log('');

console.log('five-by-five bar   nights with all five at or above');
[3, 4, 5].forEach(function (bar) {
  const n = lines.filter(function (l) {
    return feats.featCategoryCount(l, bar) === feats.FEAT_CATEGORIES.length;
  }).length;
  console.log('  ' + String(bar).padStart(3) + '              ' + perSeason(n).toFixed(1).padStart(8) +
    '   (' + n + ' raw)');
});
