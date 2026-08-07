// One-shot generator for the rollover characterization fixture. Run ONCE,
// before the two rollover paths are merged, and commit the JSON it writes.
// Re-running it after a deliberate behaviour change is how the fixture gets
// updated, and that must be justified in the commit that does it.
//
// The rollover is the most destructive operation in the league: it retires
// players, drafts new ones, runs free agency and replaces the schedule. It
// existed in two copies about to be merged, and a divergence between them
// corrupts a save quietly rather than loudly.
const fs = require('fs');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { DRAFT_PROSPECTS_2026 } = require(path.join(__dirname, '..', 'draftProspects.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
require(path.join(__dirname, '..', 'gameCoach.js'));
require(path.join(__dirname, '..', 'gameSim.js'));
const history = require(path.join(__dirname, '..', 'history.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const schedule = require(path.join(__dirname, '..', 'schedule.js'));
const playoffs = require(path.join(__dirname, '..', 'playoffs.js'));
const rollover = require(path.join(__dirname, '..', 'seasonRollover.js'));

history.ensureCareerData(PLAYERS_2026);

const SEASONS = 3;

// Stable digests, so the fixture catches roster and record drift and not just
// the year counter ticking.
function teamChecksum() {
  return TEAMS.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, t, i) {
      const r = t.record || {};
      return (sum + (r.wins || 0) * (i + 2) + (r.losses || 0) * (i + 3)) % 2147483647;
    }, 0);
}

function rosterChecksum() {
  return PLAYERS_2026.slice().sort(function (a, b) { return a.id.localeCompare(b.id); })
    .reduce(function (sum, p, i) {
      return (sum + (p.age || 0) * (i + 2) + (p.teamId ? p.teamId.length : 0) * (i + 5)) % 2147483647;
    }, 0);
}

function buildGameState(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return {
    userTeamId: 'BOS',
    leagueYear: 2026,
    rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null,
    offseasonStage: null,
    tradeOffers: [],
    // A real class, not an empty array: with no prospects the draft is a
    // no-op and the fixture would pin nothing.
    upcomingDraftClass: DRAFT_PROSPECTS_2026,
    settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

const gs = buildGameState(4242);
const out = [];
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  // Captured BEFORE the rollover: generateNewSeason resets every team's
  // record, so checksumming afterwards yields 0 every season — an assertion
  // that can never fail. This pins that the season actually simulated.
  const recordsAfterSeason = teamChecksum();

  rollover.runOffseasonRollover(gs, {});

  out.push({
    season: s + 1,
    leagueYear: gs.leagueYear,
    teamChecksum: recordsAfterSeason,
    rosterChecksum: rosterChecksum(),
    gamesCount: gs.season.games.length,
    draftPicks: (gs.lastDraftResults || []).length,
    leaguePlayerCount: PLAYERS_2026.length
  });
}

const target = path.join(__dirname, 'fixtures', 'rollover-golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', target);
console.log(JSON.stringify(out, null, 2));
