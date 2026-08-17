// How often does a GM get sacked?
//
// This is the number the owner lives by. Near zero and he is decoration — a
// mandate nobody ever fails is a slogan. Near every season and the game is
// unplayable, because no plan survives long enough to be worth making. What is
// wanted is a job that is genuinely losable and usually kept: a handful of
// firings across a twenty-season career, concentrated on the clubs that deserve
// them.
//
// Run per club rather than for one team, because the mandate is chosen from the
// club's own timeline: a rebuilding side and a contender should not face the
// same job security, and if they do the mandate is not doing its work.
//
// Probes report; they do not assert.
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const { TEAMS } = req('teams.js');
const traits = req('traits.js');
req('scouting.js');
const { PLAYERS_2026 } = req('players-2026.js');
const { DRAFT_PROSPECTS_2026, generateProspectClass } = req('draftProspects.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
req('simEngine.js'); req('simEngineBoxScore.js'); req('simEnginePossession.js');
req('gameCoach.js'); req('gameSim.js');
const history = req('history.js');
const league = req('league.js');
const schedule = req('schedule.js');
const playoffs = req('playoffs.js');
const rollover = req('seasonRollover.js');
const gmCareer = req('gmCareer.js');
const owner = req('owner.js');
history.ensureCareerData(PLAYERS_2026);

// Twelve seasons across four clubs, not twenty across eight. A full season is
// a real simulation and this probe pays for every one of them: the first cut of
// this file asked for 160 of them and did not finish inside ten minutes. Four
// clubs still spans every timeline, which is the split that matters here.
const SEASONS = 12;

// Each career after the first gets its OWN prospect class. DRAFT_PROSPECTS_2026
// is module-level OBJECTS and the draft pushes the ones it picks straight into
// module-level PLAYERS_2026, so handing the same array to a second league in one
// process re-drafts men who are already in it. The first run of this probe did
// exactly that and draft.js's guard said so, loudly, nine times — which is the
// same harness defect validate-seasonRollover.js carried.
let leaguesBuilt = 0;

function buildState(teamId, seed) {
  const draftClass = leaguesBuilt++ === 0
    ? DRAFT_PROSPECTS_2026
    : generateProspectClass(makeRng(seed), TEAMS.length * 2 + 4, 2026);
  const gs = {
    userTeamId: teamId, leagueYear: 2026, rng: makeRng(seed),
    season: null, playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: draftClass,
    settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
  gs.gmCareer = gmCareer.createGmCareer('Probe', teamId, 2026);
  owner.setMandate(gs, TEAMS.find(function (t) { return t.id === teamId; }),
    league.getTeamRoster(teamId), gs.rng);
  return gs;
}

function newSeason(gs, seed) {
  gs.season = {
    games: schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
      return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
        played: false, homeScore: null, awayScore: null, boxScore: null,
        isPlayoff: false, seriesId: null };
    }), currentDay: -1
  };
}

function playSeason(gs) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
}

// One club, one twenty-season career. Being sacked does not stop the run — the
// question is how often the axe falls, not how long the first job lasts.
function runCareer(teamId, seed) {
  const gs = buildState(teamId, seed);
  const byType = {};
  let firings = 0, met = 0, missed = 0;

  newSeason(gs, seed);
  for (let s = 0; s < SEASONS; s++) {
    const mandateType = gs.ownerMandate ? gs.ownerMandate.type : 'none';
    playSeason(gs);
    const before = gs.firedAtEndOfSeason;
    rollover.runOffseasonRollover(gs, {});

    byType[mandateType] = byType[mandateType] || { seen: 0, missed: 0 };
    byType[mandateType].seen += 1;

    const patience = gs.gmCareer.ownerPatience ? gs.gmCareer.ownerPatience[teamId] : owner.OWNER_PATIENCE;
    if (patience === owner.OWNER_PATIENCE) met += 1;
    else { missed += 1; byType[mandateType].missed += 1; }

    if (gs.firedAtEndOfSeason && gs.firedAtEndOfSeason !== before) {
      firings += 1;
      // Rehired by the same club for the purposes of the probe, so the sample
      // is twenty judged seasons per club rather than however many came before
      // the first sack.
      gs.gmCareer = gmCareer.createGmCareer('Probe', teamId, gs.leagueYear);
      gs.firedAtEndOfSeason = null;
    }
  }
  return { firings: firings, met: met, missed: missed, byType: byType };
}

console.log('GM job security over ' + SEASONS + ' seasons per club, by timeline');
console.log('');
console.log('club  timeline     mandates met  missed  firings');

const totals = { firings: 0, met: 0, missed: 0, seasons: 0 };
const byTimeline = {};
// Which mandate is actually failing. Without this the overall rate says the
// owner is harsh but not WHY, and two rounds of tuning were spent guessing at
// it — both times the answer was a mandate that could not be met rather than an
// owner who was impatient.
const mandateTotals = {};
// One club per timeline where possible, so job security can be compared across
// them rather than averaged into a single meaningless number.
const sample = (function () {
  const picked = [];
  ['win-now', 'retooling', 'rebuilding'].forEach(function (tl) {
    const t = TEAMS.find(function (x) { return x.timeline === tl; });
    if (t) picked.push(t);
  });
  const extra = TEAMS.find(function (t) { return picked.indexOf(t) === -1; });
  if (extra) picked.push(extra);
  return picked;
})();

sample.forEach(function (t, i) {
  const out = runCareer(t.id, 4000 + i * 137);
  totals.firings += out.firings;
  totals.met += out.met;
  totals.missed += out.missed;
  totals.seasons += SEASONS;

  Object.keys(out.byType).forEach(function (k) {
    mandateTotals[k] = mandateTotals[k] || { seen: 0, missed: 0 };
    mandateTotals[k].seen += out.byType[k].seen;
    mandateTotals[k].missed += out.byType[k].missed;
  });

  byTimeline[t.timeline] = byTimeline[t.timeline] || { firings: 0, seasons: 0 };
  byTimeline[t.timeline].firings += out.firings;
  byTimeline[t.timeline].seasons += SEASONS;

  console.log(
    t.id.padEnd(6) + (t.timeline || '?').padEnd(13) +
    String(out.met).padStart(3) + String(out.missed).padStart(8) +
    String(out.firings).padStart(9)
  );
});

console.log('');
console.log('overall: ' + totals.firings + ' firings across ' + totals.seasons + ' judged seasons (' +
  (totals.firings / totals.seasons * 100).toFixed(1) + '% a season, one every ' +
  (totals.firings ? (totals.seasons / totals.firings).toFixed(1) : '∞') + ' years)');
console.log('mandates met: ' + (totals.met / totals.seasons * 100).toFixed(1) + '%');
console.log('');
Object.keys(byTimeline).forEach(function (tl) {
  const b = byTimeline[tl];
  console.log('  ' + tl.padEnd(12) + b.firings + ' firings / ' + b.seasons + ' seasons');
});
console.log('');
console.log('by mandate — the one that matters:');
console.log('  mandate      given  missed  miss rate');
Object.keys(mandateTotals).sort().forEach(function (k) {
  const m = mandateTotals[k];
  console.log('  ' + k.padEnd(12) + String(m.seen).padStart(5) + String(m.missed).padStart(8) +
    (m.seen ? (m.missed / m.seen * 100).toFixed(0) + '%' : '-').padStart(11));
});
console.log('');
console.log('Near 0% a season means the owner is decoration. Near 50% means no plan');
console.log('survives long enough to be worth making.');
