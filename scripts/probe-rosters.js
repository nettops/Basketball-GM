// How many players does a team actually carry, season after season — and can
// anybody still trade?
//
// This probe exists because a hand-written browser driver produced a league
// where all thirty teams sat on EXACTLY twelve players and the trade market
// died completely (247 trades in 2026, 114 in 2027, then zero for eight
// seasons). That looked like a serious balance defect. It was not.
//
// The offseason has TWO stages, draft and free agency. The driver called
// handleAdvanceToNewSeason() as soon as any stage appeared, which jumps
// straight past the free agency stage — so no AI team ever signed anyone, and
// enforceRosterFloors backfilling to the twelve-man legal minimum was the only
// thing adding players all decade. autoGM's generateTradeOffer needs more than
// twelve to offer anything, so the market shut off as a consequence.
//
// Driven properly — letting stepOnce cross both stages — the same build gives
// 27 of 30 teams a full 15-man roster and 250-490 trades a season.
//
// The lesson worth keeping is the reason this file exists: a harness that
// skips a stage of the real flow produces a defect that is not in the game.
// Run this before believing any claim about roster health or trade volume.
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
const autoGM = rq('autoGM.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 10);
const SEED = Number(process.env.SEED || 4242);

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
    feed: [], settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

function sizes() {
  return TEAMS.map(function (t) { return league.getTeamRoster(t.id).length; });
}

function payrollMillions() {
  const total = TEAMS.reduce(function (s, t) { return s + league.getTeamPayroll(t.id); }, 0);
  return total / TEAMS.length / 1000000;
}

// Can anyone trade? This is the question the roster size actually decides.
// Counted WITHOUT executing anything.
function teamsAbleToOffer(rng) {
  return TEAMS.filter(function (t) {
    return !!autoGM.generateTradeOffer(t, rng, null);
  }).length;
}

const gs = buildGameState(SEED);
console.log('year  roster sizes (min/median/max)   at the 12-man floor   avg payroll $M   teams able to offer a trade');

for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  rollover.runOffseasonRollover(gs, {});

  const sz = sizes().sort(function (a, b) { return a - b; });
  const atFloor = sz.filter(function (n) { return n <= freeAgency.ROSTER_FLOOR; }).length;
  console.log(
    String(gs.leagueYear).padStart(4) + '        ' +
    String(sz[0]).padStart(2) + ' / ' + String(sz[Math.floor(sz.length / 2)]).padStart(2) +
    ' / ' + String(sz[sz.length - 1]).padStart(2) + '                  ' +
    String(atFloor).padStart(2) + ' of ' + TEAMS.length + '           ' +
    payrollMillions().toFixed(1).padStart(6) + '            ' +
    String(teamsAbleToOffer(gs.rng)).padStart(2) + ' of ' + TEAMS.length);
}
