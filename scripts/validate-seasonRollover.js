// Characterization test for the season rollover.
//
// This exists because the rollover had TWO implementations — the fast-forward
// path in ui/simControls.js and the manual one in script.js — that are about
// to be merged. A divergence between them corrupts a league quietly rather
// than loudly: duplicate draftees, history counted twice, a year counter that
// drifts. The fixture pins the behaviour so the merge has to prove itself.
//
// Note on the digests below: an early version sampled only player age and
// team-id length, and was too weak to see a real divergence — two leagues with
// entirely different players produced the same number. leaguePlayerCount was
// added alongside them because it cannot be fooled that way.
//
// This script plays several full seasons and takes ~20 seconds. That is the
// cost of exercising the real rollover: the draft order is derived from
// playoff finish order, so a completed postseason is required input and
// cannot be faked.
const assert = require('assert');
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { DRAFT_PROSPECTS_2026, generateProspectClass } = require(path.join(__dirname, '..', 'draftProspects.js'));
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

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rollover-golden.json'), 'utf8'));

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

// The FIRST league gets the real 2026 class, because the golden fixture was
// generated from it. Every league after gets one of its own, and must:
// DRAFT_PROSPECTS_2026 is a module-level array of module-level OBJECTS, and the
// draft pushes the objects it picks straight into the module-level
// PLAYERS_2026 (seasonTransition.js's runOffseasonThroughDraft). Hand the same
// array to a second league in the same process and its draft pushes those same
// objects a second time — one player at two indexes, paid twice against the cap
// and rosterable from two places. Measured before this split existed: 55
// duplicate ids by the end of this file, every one of them from the fixed
// class. checkNoPlayerAppearsTwice at the bottom is what holds it.
let leaguesBuilt = 0;

function buildGameState(seed) {
  const draftClass = leaguesBuilt++ === 0
    ? DRAFT_PROSPECTS_2026
    : generateProspectClass(makeRng(seed), TEAMS.length * 2 + 4, 2026);
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
    upcomingDraftClass: draftClass,
    settings: { leagueYear: 2026, lotteryFormat: undefined }
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

// Comparing against a fixture generated by a SEPARATE process is also the
// cross-process determinism guarantee: if the rollover consumed any unseeded
// randomness, these numbers could not survive a second process. That is how
// unseeded prospect ids were found — the fixture would not reproduce.
//
// An in-process version of that check is not possible here: PLAYERS_2026 and
// TEAMS are shared module-level state that every check above mutates, so a
// second run inside one process does not start from a clean league.
function checkRolloverMatchesGolden() {
  const gs = buildGameState(4242);
  GOLDEN.forEach(function (expected, i) {
    playSeason(gs);
    const recordsAfterSeason = teamChecksum();   // before the rollover resets them
    rollover.runOffseasonRollover(gs, {});

    const where = 'season ' + (i + 1) + ' ';
    assert.strictEqual(gs.leagueYear, expected.leagueYear, where + 'leagueYear');
    assert.strictEqual(recordsAfterSeason, expected.teamChecksum, where + 'team records');
    assert.strictEqual(rosterChecksum(), expected.rosterChecksum, where + 'rosters');
    assert.strictEqual(gs.season.games.length, expected.gamesCount, where + 'schedule size');
    assert.strictEqual((gs.lastDraftResults || []).length, expected.draftPicks, where + 'draft picks');
    assert.strictEqual(PLAYERS_2026.length, expected.leaguePlayerCount, where + 'league population');
  });
  console.log('checkRolloverMatchesGolden: OK');
}
checkRolloverMatchesGolden();

function checkRolloverResetsSeasonState() {
  // A genuinely PLAYED season. The draft order is built from playoff finish
  // order, so it needs a completed bracket — neither a hand-built literal nor
  // a freshly generated bracket (whose finals are still empty) is valid input.
  const gs = buildGameState(77);
  playSeason(gs);
  gs.offseasonStage = 'draft';
  gs.allStarWeekend = { done: true };
  gs.tradeOffers = [{ proposal: {} }];

  rollover.runOffseasonRollover(gs, {});

  assert.strictEqual(gs.playoffBracket, null, 'bracket cleared');
  assert.strictEqual(gs.offseasonStage, null, 'offseason stage cleared');
  assert.strictEqual(gs.allStarWeekend, null, 'all-star state cleared');
  assert.deepStrictEqual(gs.tradeOffers, [], 'stale offers dropped before rosters change');
  assert.strictEqual(gs.season.currentDay, -1, 'the new season starts before day 0');
  assert.ok(gs.season.games.length > 0, 'a fresh schedule exists');
  console.log('checkRolloverResetsSeasonState: OK');
}
checkRolloverResetsSeasonState();

function checkCareerFollowupIsReported() {
  const gs = buildGameState(78);
  playSeason(gs);
  let called = false;
  const r = rollover.runOffseasonRollover(gs, { onCareerFollowup: function () { called = true; return true; } });
  assert.strictEqual(called, true, 'the injected career step runs');
  assert.strictEqual(r.careerSceneShown, true, 'and its result is reported back');

  const gs2 = buildGameState(79);
  playSeason(gs2);
  const r2 = rollover.runOffseasonRollover(gs2, {});
  assert.strictEqual(r2.careerSceneShown, false, 'absent in GM mode');
  console.log('checkCareerFollowupIsReported: OK');
}
checkCareerFollowupIsReported();

// The manual path. The plan's version of this test built a state without
// playing a season, which cannot work: buildDraftOrder reads playoff finish
// order and needs a completed postseason.
function checkStopAfterDraftLeavesTheUserAtTheDraft() {
  const gs = buildGameState(80);
  playSeason(gs);
  const scheduleBefore = gs.season.games;

  const r = rollover.runOffseasonRollover(gs, { stopAfterDraft: true });

  assert.strictEqual(r.stoppedAfterDraft, true, 'reports where it stopped');
  assert.strictEqual(gs.offseasonStage, 'draft', 'the user is left at the draft');
  assert.ok(gs.lastDraftResults && gs.lastDraftResults.length > 0, 'the draft still ran');
  assert.strictEqual(gs.leagueYear, 2027, 'the year advanced exactly once');
  // The specific corruption this guards: stopping late would replace the
  // schedule and run free agency behind the user's back, so the season they
  // are still looking at must be the same object, still fully played.
  assert.strictEqual(gs.season.games, scheduleBefore, 'the schedule was not replaced');
  assert.ok(gs.season.games.every(function (g) { return g.played; }),
    'the finished season is still finished');
  assert.ok(gs.playoffBracket, 'and its bracket is still there to summarize');
  console.log('checkStopAfterDraftLeavesTheUserAtTheDraft: OK');
}
checkStopAfterDraftLeavesTheUserAtTheDraft();

// With autoDraft off, script.js injects an interactive draft session in place
// of the automatic pipeline. The automatic one must not also run — that would
// draft the same class twice into PLAYERS_2026.
function checkInjectedDraftReplacesTheAutomaticOne() {
  const gs = buildGameState(81);
  playSeason(gs);
  const populationBefore = PLAYERS_2026.length;

  let sawState = null;
  rollover.runOffseasonRollover(gs, {
    stopAfterDraft: true,
    onDraft: function (state) { sawState = state; state.lastDraftResults = []; }
  });

  assert.strictEqual(sawState, gs, 'the injected draft receives the game state');
  assert.deepStrictEqual(gs.lastDraftResults, [], 'and owns the results');
  assert.strictEqual(PLAYERS_2026.length, populationBefore,
    'no prospects were drafted by the automatic path as well');
  console.log('checkInjectedDraftReplacesTheAutomaticOne: OK');
}
checkInjectedDraftReplacesTheAutomaticOne();

// PLAYERS_2026 is module-level and every check above drafts into it. One player
// object sitting at two indexes is a shape this game has shipped before: the
// fast-forward/offseason overlap re-drafted a still-pending class and rosters
// duplicated while salaries counted twice (scripts/validate-simControlsOffseasonGuard.js
// is that bug's regression test). Nothing asserted the invariant itself until
// now, so the next occurrence was found by accident, by unrelated code that
// happened to walk the pool.
function checkNoPlayerAppearsTwice() {
  const seen = Object.create(null);
  const dupes = PLAYERS_2026.filter(function (p) {
    if (seen[p.id]) return true;
    seen[p.id] = true;
    return false;
  }).map(function (p) { return p.id; });
  assert.deepStrictEqual(dupes, [], 'the same player id is in PLAYERS_2026 more than once');
  console.log('checkNoPlayerAppearsTwice: OK');
}
checkNoPlayerAppearsTwice();

console.log('All season rollover validations passed');
