// The CONTROL for probe-superstar-rate.js.
//
// That harness ages a draft class in isolation and counts who ever peaked at
// display 90+. Fast, but it skips coach fit, the mentor bonus, and everything
// the league does to a player. Before any calibration is done on it, it has to
// be shown to agree with the real pipeline.
//
// This measures the SAME quantity — peak display overall, ever — but through
// the real rollover: real games, real playoffs, real free agency, real
// retirement. Slow (~15 min). Run once per calibration change, not per sweep.
//
// My first attempt at a control compared the fast harness against the number
// of players sitting at 90+ in the final season. That was wrong: a player who
// peaked at 91 in year 7 and declined to 87 by year 12 is a future superstar
// who does not appear in a final-season count. Stock is not flow. This tracks
// the peak on every player after every season so flow is what gets compared.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
const ratings = rq('ratings.js');
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

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 14);
const SUPERSTAR = ratings.RATING_BANDS.superstar;

const games = schedule.generateSeasonGames(makeRng(4242), TEAMS).map(function (g) {
  return {
    id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
    played: false, homeScore: null, awayScore: null, boxScore: null,
    isPlayoff: false, seriesId: null
  };
});
const gs = {
  userTeamId: 'BOS', leagueYear: 2026, rng: makeRng(4242),
  season: { games: games, currentDay: -1 },
  playoffBracket: null, offseasonStage: null, tradeOffers: [],
  upcomingDraftClass: DRAFT_PROSPECTS_2026,
  settings: { leagueYear: 2026, lotteryFormat: undefined }
};

// Identity by object, not id — generated prospects can collide on id with
// players already in the league, and keying a map on id would merge two
// different people and lose one of their peaks.
const peak = new Map();
const draftYear = new Map();
function recordPeaks() {
  PLAYERS_2026.forEach(function (p) {
    const cur = p.overall;
    if (!peak.has(p) || cur > peak.get(p)) peak.set(p, cur);
  });
}

const founding = new Set();
PLAYERS_2026.forEach(function (p) { founding.add(p); });
recordPeaks();

for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  recordPeaks();

  rollover.runOffseasonRollover(gs, {});

  // New arrivals: anything with a peak not yet recorded is this year's class.
  PLAYERS_2026.forEach(function (p) {
    if (!founding.has(p) && !draftYear.has(p)) draftYear.set(p, gs.leagueYear);
  });
  recordPeaks();
  process.stderr.write('season ' + gs.leagueYear + ' done\n');
}
recordPeaks();

// Retired players have left PLAYERS_2026, but their peaks are still in the map
// keyed by object — which is exactly why the map is keyed by object. A class's
// superstar count must include players who peaked and then retired.
const byClass = {};
draftYear.forEach(function (yr, p) {
  const c = byClass[yr] || (byClass[yr] = []);
  c.push(peak.get(p));
});

console.log('\nCONTROL — superstars per draft class, through the REAL pipeline');
console.log('  superstar = peak display OVR >= ' + SUPERSTAR + ', measured every season');
console.log('  (includes players who peaked and later declined or retired)\n');
console.log('  class   n   peaked 90+   share    best peak');
const counts = [];
Object.keys(byClass).sort().forEach(function (yr) {
  const peaks = byClass[yr];
  const n90 = peaks.filter(function (v) { return v >= SUPERSTAR; }).length;
  // Only classes with enough seasons behind them have finished developing;
  // the last few are still climbing and would drag the mean down as an
  // artifact of the run ending, not of the game.
  const mature = (2026 + SEASONS) - Number(yr) >= 8;
  if (mature) counts.push(n90);
  console.log('  ' + yr + '  ' + String(peaks.length).padStart(3) + '   ' +
    String(n90).padStart(10) + '  ' + (100 * n90 / peaks.length).toFixed(1).padStart(5) + '%  ' +
    String(Math.max.apply(null, peaks)).padStart(9) + (mature ? '' : '   (still developing)'));
});

const mean = counts.length ? counts.reduce(function (a, c) { return a + c; }, 0) / counts.length : 0;
console.log('\n  MEAN over mature classes: ' + mean.toFixed(2) + ' superstars per class');
console.log('  TARGET: 2-4.');
console.log('\n  Compare this to probe-superstar-rate.js\'s mean. If they agree,');
console.log('  the fast harness can be used to sweep. If they do not, the fast');
console.log('  harness is measuring something else and must be fixed first.');

const foundingPeaks = [];
founding.forEach(function (p) { foundingPeaks.push(peak.get(p)); });
console.log('\n  for reference, the founding 2026 rosters: ' +
  foundingPeaks.filter(function (v) { return v >= SUPERSTAR; }).length +
  ' of ' + foundingPeaks.length + ' ever peaked 90+ (' +
  (100 * foundingPeaks.filter(function (v) { return v >= SUPERSTAR; }).length / foundingPeaks.length).toFixed(1) + '%)');
