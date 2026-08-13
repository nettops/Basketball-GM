// The aging cohort DECLINES (probe-progression-drift.js: raw 47.6 -> 28.1 over
// twelve years, 90+ going 9 -> 4) while the live league INFLATES (90+ going
// 9 -> 124). Those two facts together mean the inflation is not in how players
// age. It is in who arrives.
//
// This probe runs the real rollover and asks three questions about entrants:
//
//   1. What does each incoming draft class look like at the moment it enters?
//      If class quality climbs year over year, generateProspectClass is
//      reading something that is itself inflating.
//   2. Where do the 90+ players come from — are they veterans who grew, or
//      recent draftees who arrived good?
//   3. Does the population growth alone explain it? 90+ is reported as a SHARE
//      as well as a count, because a bigger league trivially has more of
//      everything and that would not be a balance problem.
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
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 12);

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

function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function maxOf(a) { return a.length ? Math.max.apply(null, a) : 0; }

// Identity is by object, not id: generated prospects can collide on id with
// players already in the league, and a set keyed on id would silently merge
// two different people into one and undercount the class.
const seen = new Set();
PLAYERS_2026.forEach(function (p) { seen.add(p); });

console.log('Q1+Q3 — each new draft class at the moment it entered, and the');
console.log('        league it entered into. "90+ %" is the share, so league');
console.log('        growth alone cannot produce a rising number.\n');
console.log('yr  league  90+  90+%   | new entrants  theirOVR  theirMax  theirPot  #90+');

const classes = [];
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  rollover.runOffseasonRollover(gs, {});

  const entrants = PLAYERS_2026.filter(function (p) { return !seen.has(p); });
  entrants.forEach(function (p) { seen.add(p); p._draftYear = gs.leagueYear; });
  classes.push({ year: gs.leagueYear, players: entrants });

  const ovr = PLAYERS_2026.map(function (p) { return p.overall; });
  const n90 = ovr.filter(function (v) { return v >= 90; }).length;
  const eo = entrants.map(function (p) { return p.overall; });
  const ep = entrants.map(function (p) { return p.potential; });

  console.log(
    String(gs.leagueYear).slice(2) + '  ' +
    String(PLAYERS_2026.length).padStart(6) + ' ' + String(n90).padStart(4) + ' ' +
    (100 * n90 / ovr.length).toFixed(1).padStart(5) + '%  |' +
    String(entrants.length).padStart(13) + '  ' +
    mean(eo).toFixed(1).padStart(8) + '  ' + String(maxOf(eo)).padStart(8) + '  ' +
    mean(ep).toFixed(1).padStart(8) + '  ' +
    String(eo.filter(function (v) { return v >= 90; }).length).padStart(4));
}

// ------------------------------------------------------------------- Q2
console.log('\nQ2 — who ARE the 90+ players at the end? Grouped by how they got');
console.log('     into the league. If they are mostly recent draftees, the');
console.log('     draft generator is the thing to fix, not the age curve.\n');

const elite = PLAYERS_2026.filter(function (p) { return p.overall >= 90; });
const byOrigin = { founding: 0, drafted: 0 };
const byYearsPro = {};
elite.forEach(function (p) {
  if (p._draftYear === undefined) byOrigin.founding++; else byOrigin.drafted++;
  const yp = Math.min(12, p.yearsPro || 0);
  byYearsPro[yp] = (byYearsPro[yp] || 0) + 1;
});
console.log('  total 90+: ' + elite.length);
console.log('  from the original 2026 rosters: ' + byOrigin.founding);
console.log('  entered via the draft since:    ' + byOrigin.drafted);

// Does the inflation actually reach the court? 151 players rated 90+ against
// 370 roster spots only matters if those players are ON those rosters. If the
// elite are sitting in the free-agent pool, the headline OVR number overstates
// what a user would actually face, and the fix is in free agency rather than
// in the draft scale. Measured, because guessing here picks the wrong fix.
const eliteRostered = elite.filter(function (p) { return p.teamId; }).length;
console.log('\n  of those ' + elite.length + ' players rated 90+:');
console.log('    on a roster:  ' + eliteRostered);
console.log('    unsigned:     ' + (elite.length - eliteRostered));
const rosteredAll = PLAYERS_2026.filter(function (p) { return p.teamId; });
const rosteredElite = rosteredAll.filter(function (p) { return p.overall >= 90; }).length;
console.log('  so the league a user actually plays against is ' + rosteredElite +
  ' of ' + rosteredAll.length + ' rostered players at 90+ (' +
  (100 * rosteredElite / rosteredAll.length).toFixed(1) + '%), against 9 of 380 (2.4%) in 2026.');
const faOvr = PLAYERS_2026.filter(function (p) { return !p.teamId; })
  .map(function (p) { return p.overall; }).sort(function (a, b) { return b - a; });
console.log('  best unsigned free agents: ' + faOvr.slice(0, 10).join(', '));
console.log('\n  yearsPro  count   (how long they took to get there)');
Object.keys(byYearsPro).sort(function (a, b) { return a - b; }).forEach(function (k) {
  console.log('  ' + String(k).padStart(8) + '  ' + String(byYearsPro[k]).padStart(5) +
    '  ' + '#'.repeat(Math.min(60, byYearsPro[k])));
});

// Track one class all the way through, so growth is separated from arrival.
console.log('\n  the first generated class, followed year by year:');
console.log('  (arrived at the OVR on row 0 — everything after is growth)');
if (classes.length) {
  const first = classes[0].players;
  console.log('  class of ' + classes[0].year + ', n=' + first.length +
    ', now averaging ' + mean(first.map(function (p) { return p.overall; })).toFixed(1) +
    ' with max ' + maxOf(first.map(function (p) { return p.overall; })) +
    ' at age ' + mean(first.map(function (p) { return p.age; })).toFixed(1));
  console.log('  of them, ' + first.filter(function (p) { return p.overall >= 90; }).length +
    ' are now 90+, and ' + first.filter(function (p) { return !p.teamId; }).length +
    ' of ' + first.length + ' are unsigned');
}

// ------------------------------------------------------- population sanity
console.log('\nPOPULATION — where the extra bodies sit. enforceRosterCeilings');
console.log('  (freeAgency.js) sweeps every AI team back to 15 when the silent');
console.log('  market runs; the user team is the autoCap setting + rollover.\n');
const rostered = PLAYERS_2026.filter(function (p) { return p.teamId; });
console.log('  rostered: ' + rostered.length + ' across ' + TEAMS.length +
  ' teams = ' + (rostered.length / TEAMS.length).toFixed(1) + ' per team (cap is 15)');
console.log('  free agents: ' + (PLAYERS_2026.length - rostered.length));
const over = TEAMS.filter(function (t) {
  return PLAYERS_2026.filter(function (p) { return p.teamId === t.id; }).length > 15;
});
console.log('  teams over the 15-man cap: ' + over.length + ' of ' + TEAMS.length);
