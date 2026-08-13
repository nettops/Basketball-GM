// What bar makes a feat rare enough to mean something?
//
// Our league scores ~135 a team, so basketball's traditional 50-point night is
// far less remarkable here than it is in a 115-point league. The bars are
// therefore chosen from measured rates, not from tradition.
//
// This probe simulates FULL SEASONS through league.simulateDate — the path the
// game actually runs — rather than calling gameSim.simulateGame in a loop. The
// difference is not cosmetic: the live path applies fatigue, injuries, morale
// and rotation minutes, and an early version of this probe that skipped all of
// that reported 29.9 big scoring nights a season while a real season produced
// 42. An isolated harness reading low is a known trap in this codebase; the
// calibration has to happen on the distribution the player will actually see.
//
// One season per process, seeded, like probe-star-value.js: PLAYERS_2026 is a
// singleton and fatigue/season stats carry over, so repeated seasons in one
// process are not independent draws.
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
const league = rq('league.js');
const schedule = rq('schedule.js');
const feats = rq('feats.js');

const SEED = Number(process.env.SEED || 1);
const QUIET = process.env.QUIET === '1';

const rng = makeRng(SEED);
const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
  return {
    id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
    played: false, homeScore: null, awayScore: null, boxScore: null,
    isPlayoff: false, seriesId: null
  };
});
const season = { games: games, currentDay: -1 };
const settings = { leagueYear: 2026 };
const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
for (let d = 0; d <= lastDay; d++) league.simulateDate(season, d, settings, rng, null, null);

const lines = [];
games.forEach(function (g) {
  if (!g.boxScore) return;
  Object.keys(g.boxScore).forEach(function (id) { lines.push(g.boxScore[id]); });
});

function atLeast(bar) {
  return lines.filter(function (l) { return (l.points || 0) >= bar; }).length;
}
function categoriesAtLeast(bar, need) {
  return lines.filter(function (l) { return feats.featCategoryCount(l, bar) >= need; }).length;
}

// Runs to 80 because the table has to span the range a bar might land in, not
// just the range it currently sits in. It stopped at 70, so when takeovers
// started running their full length and 70-point nights doubled, the table had
// nothing to say about where the huge-scoring bar should move to.
const POINT_BARS = [50, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 68, 70,
                    72, 74, 76, 78, 80];
const DOUBLE_BARS = [10, 12, 13, 14, 15, 16, 17];
const FIVE_BARS = [3, 4, 5];

// One machine-readable line per bar so a multi-seed sweep can be aggregated by
// a shell loop without parsing prose.
if (QUIET) {
  const cells = [];
  POINT_BARS.forEach(function (b) { cells.push('p' + b + '=' + atLeast(b)); });
  DOUBLE_BARS.forEach(function (b) { cells.push('d' + b + '=' + categoriesAtLeast(b, 3)); });
  FIVE_BARS.forEach(function (b) { cells.push('f' + b + '=' + categoriesAtLeast(b, feats.FEAT_CATEGORIES.length)); });
  console.log('seed=' + SEED + ' games=' + games.length + ' lines=' + lines.length + ' ' + cells.join(' '));
} else {
  console.log('seed ' + SEED + ': one full season, ' + games.length + ' games, ' + lines.length + ' player-lines');
  console.log('every count below is FOR THIS ONE SEASON');
  const points = lines.map(function (l) { return l.points || 0; }).sort(function (a, b) { return b - a; });
  console.log('highest ten lines: ' + points.slice(0, 10).join(', '));
  console.log('');
  console.log('points bar   nights at or above');
  POINT_BARS.forEach(function (bar) {
    console.log('  ' + String(bar).padStart(3) + '        ' + String(atLeast(bar)).padStart(6));
  });
  console.log('');
  console.log('three-category bar   nights');
  DOUBLE_BARS.forEach(function (bar) {
    console.log('  ' + String(bar).padStart(3) + '                ' + String(categoriesAtLeast(bar, 3)).padStart(6));
  });
  console.log('');
  console.log('all-five bar   nights');
  FIVE_BARS.forEach(function (bar) {
    console.log('  ' + String(bar).padStart(3) + '          ' +
      String(categoriesAtLeast(bar, feats.FEAT_CATEGORIES.length)).padStart(6));
  });
}
