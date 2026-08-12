// Do family trees actually appear, and when?
//
// Families are the slowest-paying feature in the game by design: a father must
// have entered the league at least ELIGIBLE_FATHER_GAP (18) seasons before his
// son's draft, and the real 2026 players are deliberately never eligible. So a
// fresh save generates NOTHING for its first eighteen years, and the honest
// question is not "does it work" but "does it start on time and at the right
// rate once it does".
//
// Twenty seasons through the REAL pipeline — full schedule, playoffs and
// runOffseasonRollover — built the same way probe-twenty-seasons.js and
// gen-rollover-golden.js build theirs.
//
// SAVE=path also writes the finished league as a save payload, so the browser
// can load this exact twenty-season league and the family panels can be looked
// at rather than inferred.
const fs = require('fs');
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
const relatives = rq('relatives.js');
const save = rq('save.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 20);
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

// Everyone who has ever been in this league: on a roster, a free agent, or
// retired. A father who has retired still shows on his son's profile, so
// counting only active players would undercount families badly by year twenty.
function everyone() {
  return PLAYERS_2026.concat(history.LEAGUE_HISTORY.retiredPlayers);
}

function familyStats() {
  const all = everyone();
  const withKin = all.filter(function (p) { return relatives.relativesOf(p).length > 0; });
  const pairs = {};
  withKin.forEach(function (p) {
    relatives.relativesOf(p).forEach(function (r) {
      pairs[[p.id, r.playerId].sort().join('|')] = r.type;
    });
  });
  const types = { father: 0, brother: 0 };
  Object.keys(pairs).forEach(function (k) {
    if (pairs[k] === 'brother') types.brother += 1; else types.father += 1;
  });
  return { people: withKin.length, links: Object.keys(pairs).length, fatherSon: types.father, brothers: types.brother };
}

const gs = buildGameState(SEED);
console.log('twenty seasons, seed ' + SEED + '. A father needs ' +
  relatives.ELIGIBLE_FATHER_GAP + ' seasons in the league before his son can be drafted,');
console.log('and the real 2026 players are never eligible — so nothing can appear before ' +
  (2026 + relatives.ELIGIBLE_FATHER_GAP) + '.');
console.log('');
console.log('year  eligible fathers  new links  families  father-son  brothers');

for (let s = 0; s < SEASONS; s++) {
  const before = familyStats().links;
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  const eligible = everyone().filter(function (p) {
    return typeof p.firstLeagueYear === 'number' &&
      gs.leagueYear - p.firstLeagueYear >= relatives.ELIGIBLE_FATHER_GAP;
  }).length;

  rollover.runOffseasonRollover(gs, {});

  const now = familyStats();
  console.log(
    String(gs.leagueYear).padStart(4) + '  ' +
    String(eligible).padStart(16) + '  ' +
    String(now.links - before).padStart(9) + '  ' +
    String(now.links).padStart(8) + '  ' +
    String(now.fatherSon).padStart(10) + '  ' +
    String(now.brothers).padStart(8));
}

const final = familyStats();
console.log('');
console.log('after ' + SEASONS + ' seasons: ' + final.links + ' family links, ' +
  final.people + ' people with a relative (' + final.fatherSon + ' father-son, ' +
  final.brothers + ' brother pairs)');

// Name every family found, so the result can be checked on screen rather than
// taken on trust.
const seen = {};
everyone().forEach(function (p) {
  relatives.relativesOf(p).forEach(function (r) {
    const key = [p.id, r.playerId].sort().join('|');
    if (seen[key]) return;
    seen[key] = true;
    const verb = r.type === 'father' ? 'is the son of' : r.type === 'son' ? 'is the father of' : 'is the brother of';
    console.log('  ' + p.name + ' ' + verb + ' ' + r.name + '   [' + p.id + ']');
  });
});

if (process.env.SAVE) {
  const payload = save.serializeGameState(gs, 'twenty-season family check', false);
  fs.writeFileSync(process.env.SAVE, JSON.stringify(payload));
  console.log('');
  console.log('save written to ' + process.env.SAVE + ' (' +
    (fs.statSync(process.env.SAVE).size / 1048576).toFixed(1) + ' MB)');
}
