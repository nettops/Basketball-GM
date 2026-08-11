// Why do franchise players keep hitting free agency?
//
// Measures, per offseason, through the REAL pipeline:
//   - how much of the league reaches free agency at all
//   - of the stars who do, how many RE-SIGN with the team they just played for
//   - how long the deals they sign actually run
//
// The incumbent team's teamId is wiped by decrementContracts before free
// agency runs, so "who did he play for last season" has to be snapshotted
// BEFORE the rollover or it is unrecoverable afterwards.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');
const freeAgency = rq('freeAgency.js');

// RESIGN_BONUS=n moves the incumbent bonus for one run so the calibration
// sweep can find its value without editing committed source — the shipped
// number stays whatever freeAgency.js says it is.
if (process.env.RESIGN_BONUS) {
  freeAgency.RESIGN_TUNING.incumbentBonus = Number(process.env.RESIGN_BONUS);
  process.stderr.write('RESIGN_BONUS override: ' + freeAgency.RESIGN_TUNING.incumbentBonus + '\n');
}

history.ensureCareerData(PLAYERS_2026);

const SEASONS = Number(process.env.SEASONS || 10);
const SEED = Number(process.env.SEED || 4242);
// "Franchise player" = a top-end player, not merely a starter. Reported at two
// bars so the answer cannot hinge on where the line was drawn.
const STAR = Number(process.env.STAR || 85);

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

const gs = buildGameState(SEED);
const totals = {
  rostered: 0, expired: 0, reachedMarket: 0,
  starRostered: 0, starExpired: 0, starResigned: 0, starMoved: 0, starUnsigned: 0,
  yearsAwarded: [], starYearsAwarded: [], starTenures: []
};
// How long each player has been continuously with his current team.
const tenure = {};
PLAYERS_2026.forEach(function (p) { tenure[p.id] = 1; });

console.log('yr   league  exp  ->mkt  %    | stars  exp  re-signed  moved  unsigned | mean deal  star deal');
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  // Snapshot BEFORE the rollover: decrementContracts wipes teamId.
  const before = {};
  PLAYERS_2026.forEach(function (p) {
    if (!p.teamId) return;
    before[p.id] = { team: p.teamId, ovr: p.overall, years: p.contract.yearsRemaining, name: p.name };
  });
  const rosteredIds = Object.keys(before);
  const starIds = rosteredIds.filter(function (id) { return before[id].ovr >= STAR; });

  rollover.runOffseasonRollover(gs, {});

  // Who actually reached the open market: contract ran out this offseason.
  const alive = {};
  PLAYERS_2026.forEach(function (p) { alive[p.id] = p; });

  let expired = 0, reachedMarket = 0, starExpired = 0, starResigned = 0, starMoved = 0, starUnsigned = 0;
  rosteredIds.forEach(function (id) {
    if (before[id].years > 1) return;   // deal still running, nothing happened to him
    if (!alive[id]) return;             // retired this offseason, not a free-agency story
    expired++;
    // A contract running out is not the same as reaching the open market —
    // that is the whole point of the re-signing window, and conflating the two
    // made the fix look like it had done nothing to league-wide churn.
    if (alive[id].teamId !== before[id].team) reachedMarket++;
    const p = alive[id];
    if (p.contract && p.contract.yearsRemaining > 0 && p.teamId) totals.yearsAwarded.push(p.contract.yearsRemaining);
    if (before[id].ovr >= STAR) {
      starExpired++;
      if (!p.teamId) starUnsigned++;
      else if (p.teamId === before[id].team) starResigned++;
      else starMoved++;
      if (p.teamId) totals.starYearsAwarded.push(p.contract.yearsRemaining);
    }
  });

  // Tenure: reset on every move, including a "move" back to the same team.
  PLAYERS_2026.forEach(function (p) {
    if (!p.teamId) { tenure[p.id] = 0; return; }
    if (before[p.id] && before[p.id].team === p.teamId) tenure[p.id] = (tenure[p.id] || 0) + 1;
    else tenure[p.id] = 1;
  });
  starIds.forEach(function (id) { if (alive[id]) totals.starTenures.push(tenure[id]); });

  totals.rostered += rosteredIds.length;
  totals.expired += expired;
  totals.reachedMarket += reachedMarket;
  totals.starRostered += starIds.length;
  totals.starExpired += starExpired;
  totals.starResigned += starResigned;
  totals.starMoved += starMoved;
  totals.starUnsigned += starUnsigned;

  const mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
  console.log(
    String(gs.leagueYear - 1).slice(2) + '   ' +
    String(rosteredIds.length).padStart(5) + String(expired).padStart(5) + String(reachedMarket).padStart(6) +
    (100 * reachedMarket / Math.max(1, rosteredIds.length)).toFixed(0).padStart(5) + '%   | ' +
    String(starIds.length).padStart(5) + String(starExpired).padStart(6) +
    String(starResigned).padStart(10) + String(starMoved).padStart(7) + String(starUnsigned).padStart(9) + ' | ' +
    mean(totals.yearsAwarded).toFixed(2).padStart(8) + mean(totals.starYearsAwarded).toFixed(2).padStart(10));
}

function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
console.log('');
console.log('Over ' + SEASONS + ' offseasons:');
console.log('  contracts expiring:           ' + totals.expired + '/' + totals.rostered +
  '  (' + (100 * totals.expired / totals.rostered).toFixed(1) + '% of all rostered players)');
console.log('  actually CHANGING TEAMS:      ' + totals.reachedMarket + '/' + totals.rostered +
  '  (' + (100 * totals.reachedMarket / totals.rostered).toFixed(1) + '% of all rostered players, every year)');
console.log('  stars (' + STAR + '+) reaching it:      ' + totals.starExpired + '/' + totals.starRostered +
  '  (' + (100 * totals.starExpired / Math.max(1, totals.starRostered)).toFixed(1) + '%)');
const decided = totals.starResigned + totals.starMoved;
console.log('  of those stars: re-signed ' + totals.starResigned + ', moved ' + totals.starMoved +
  ', went unsigned ' + totals.starUnsigned);
console.log('  RE-SIGN RATE: ' + (100 * totals.starResigned / Math.max(1, decided)).toFixed(1) +
  '% of stars who signed anywhere stayed put');
console.log('  mean contract awarded: ' + mean(totals.yearsAwarded).toFixed(2) + ' years' +
  '   (stars: ' + mean(totals.starYearsAwarded).toFixed(2) + ')');
console.log('  mean unbroken tenure of a star with one team: ' + mean(totals.starTenures).toFixed(2) + ' seasons');
