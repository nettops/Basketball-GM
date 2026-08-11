// What is a second superstar actually WORTH, in wins?
//
// probe-superteam.js showed Milwaukee gaining only 0-3 wins from swapping an
// 81-overall centre for a 91-overall one, and San Antonio getting BETTER in two
// of three seeds after giving Wembanyama away. Three seasons is three
// anecdotes. This runs one regular season per seed, both arms, and reports the
// win delta as a measured rate.
//
// One season only: no rollover, so free agency and the draft cannot scramble
// the rosters being compared. PLAYERS_2026 is a singleton, so SWAP=1 and
// SWAP=0 must run in separate processes.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS, getTeamById } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const league = rq('league.js');
const schedule = rq('schedule.js');

const SEED = Number(process.env.SEED || 1);
const SWAP = process.env.SWAP === '1';
const TARGET_ID = 'sas-victor-wembanyama';
const RETURN_ID = 'mil-myles-turner';

function byId(id) { return PLAYERS_2026.find(function (p) { return p.id === id; }); }
const target = byId(TARGET_ID), ret = byId(RETURN_ID);
const HOME = ret.teamId, AWAY = target.teamId;

if (SWAP) { target.teamId = HOME; ret.teamId = AWAY; }

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

function ppg(p) {
  const s = p.seasonStats;
  if (!s || !s.gamesPlayed) return '0.0/0.0';
  return (s.points / s.gamesPlayed).toFixed(1) + '/' + (s.rebounds / s.gamesPlayed).toFixed(1);
}
const home = getTeamById(HOME), away = getTeamById(AWAY);
const giannis = byId('mil-giannis-antetokounmpo');
console.log([
  SEED, SWAP ? 'swap' : 'base',
  HOME + ' ' + home.record.wins,
  AWAY + ' ' + away.record.wins,
  'wemby ' + ppg(target),
  'giannis ' + ppg(giannis),
  'turner ' + ppg(ret)
].join('\t'));
