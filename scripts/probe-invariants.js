// Ten seasons through the real pipeline (SEASONS=n to change), checking hard
// invariants at each season's end — the "runs fine but the data is quietly
// wrong" class of bug. This probe is what found the AI roster-ceiling gap:
// before enforceRosterCeilings (freeAgency.js), 2-7 teams PLAYED EVERY SEASON
// at 16-17 players, because the draft adds two rookies unconditionally and
// only the user's team was ever swept back down.
// Checks:
//   - no player on two rosters at once
//   - no duplicate player ids in the pool
//   - roster sizes within the legal band
//   - every team's played game count is 82
//   - standings wins+losses equal games played, league-wide wins == losses
//   - every rostered player's contract fields are sane (finite, > 0)
//   - serialized save size per season (unbounded growth detector)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js');
rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');

history.ensureCareerData(PLAYERS_2026);

function buildGameState(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return {
    userTeamId: 'BOS', leagueYear: 2026, rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: DRAFT_PROSPECTS_2026,
    settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.log('  FAIL: ' + msg); }
}

function auditSeason(gs, label) {
  // Duplicate ids in the pool
  const ids = new Set();
  PLAYERS_2026.forEach(function (p) {
    check(!ids.has(p.id), label + ' duplicate player id in pool: ' + p.id + ' ' + p.name);
    ids.add(p.id);
  });

  // Rosters: sizes, cross-team duplicates, contract sanity
  const seen = {};
  TEAMS.forEach(function (t) {
    const roster = PLAYERS_2026.filter(function (p) { return p.teamId === t.id; });
    check(roster.length >= 8 && roster.length <= 15,
      label + ' ' + t.id + ' roster size ' + roster.length);
    roster.forEach(function (p) {
      check(!seen[p.id], label + ' ' + p.name + ' on two rosters: ' + seen[p.id] + ' and ' + t.id);
      seen[p.id] = t.id;
      const c = p.contract;
      check(c && isFinite(c.salary) && c.salary > 0 && isFinite(c.yearsRemaining) && c.yearsRemaining >= 1,
        label + ' ' + t.id + ' ' + p.name + ' bad contract: ' + JSON.stringify(c));
      check(isFinite(p.overall) && p.overall >= 0 && p.overall <= 100,
        label + ' ' + p.name + ' overall out of range: ' + p.overall);
      check(isFinite(p.age) && p.age >= 18 && p.age <= 45,
        label + ' ' + p.name + ' age out of range: ' + p.age);
    });
  });

  // Games: every team plays 82, standings arithmetic holds
  const played = gs.season.games.filter(function (g) { return g.played && !g.isPlayoff; });
  const counts = {}; const wins = {}; const losses = {};
  TEAMS.forEach(function (t) { counts[t.id] = 0; wins[t.id] = 0; losses[t.id] = 0; });
  played.forEach(function (g) {
    counts[g.homeTeamId]++; counts[g.awayTeamId]++;
    check(g.homeScore !== g.awayScore, label + ' tie game ' + g.id);
    const w = g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId;
    const l = g.homeScore > g.awayScore ? g.awayTeamId : g.homeTeamId;
    wins[w]++; losses[l]++;
  });
  TEAMS.forEach(function (t) {
    check(counts[t.id] === 82, label + ' ' + t.id + ' played ' + counts[t.id] + ' regular-season games');
    check(wins[t.id] + losses[t.id] === counts[t.id], label + ' ' + t.id + ' W+L != GP');
  });
  const totalW = TEAMS.reduce(function (a, t) { return a + wins[t.id]; }, 0);
  const totalL = TEAMS.reduce(function (a, t) { return a + losses[t.id]; }, 0);
  check(totalW === totalL, label + ' league wins ' + totalW + ' != losses ' + totalL);
}

const gs = buildGameState(9090);
const SEASONS = Number(process.env.SEASONS || 10);
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  auditSeason(gs, 'Y' + gs.leagueYear);

  // Save-size growth: history + career data are the only things allowed to
  // grow, and they should grow roughly linearly, not explode.
  let histSize = 0;
  try { histSize = JSON.stringify(history.LEAGUE_HISTORY || {}).length; } catch (e) { histSize = -1; }
  const poolSize = JSON.stringify(PLAYERS_2026).length;
  console.log('Y' + gs.leagueYear + '  pool=' + PLAYERS_2026.length +
    '  poolJSON=' + (poolSize / 1024 / 1024).toFixed(1) + 'MB' +
    '  historyJSON=' + (histSize / 1024 / 1024).toFixed(1) + 'MB' +
    (failures ? '  FAILURES SO FAR: ' + failures : '  ok'));

  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  rollover.runOffseasonRollover(gs, {});
}

console.log(failures === 0 ? 'ALL INVARIANTS HELD over ' + SEASONS + ' seasons' : failures + ' INVARIANT FAILURES');
process.exit(failures === 0 ? 0 : 1);
