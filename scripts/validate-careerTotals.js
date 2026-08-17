// Career totals as the UI shows them: stored careerStats PLUS the season
// currently in progress.
//
// careerStats only gains a season when rollSeasonIntoCareerStats runs at the
// top of the offseason, so mid-season every career surface read zero — a
// player 5 games into year one showed "Career Totals: Games 0, PPG 0.0" while
// the panel directly above it said GP 5, 16.4 PPG.
//
// The hazard this file exists to pin down is the offseason window. Rolling
// happens at seasonRollover.js:58, but the manual path RETURNS at the draft
// (line 89) and seasonStats is not cleared until generateNewSeason much later.
// For that whole stretch — the draft and free agency, which the user browses
// rosters during — careerStats already contains the season AND seasonStats
// still holds it. Naively adding the two double-counts an entire year.
const assert = require('assert');
const path = require('path');

const historyModule = require(path.join(__dirname, '..', 'history.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const seasonTransitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

// Tests share one global PLAYERS_2026, and checkRealEntryPointSetsTheFlag
// rolls the first 25 of them. Without clearing the flag here, a later test
// picking one of those players silently exercises the "already banked" branch
// and its assertions pass for the wrong reason.
function freshPlayer(teamIndex) {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[teamIndex].id)[0];
  historyModule.ensureCareerData([player]);
  player.seasonStatsRolled = false;
  return player;
}

function aSeason(gamesPlayed, points, rebounds, assists) {
  return {
    gamesPlayed: gamesPlayed, points: points, rebounds: rebounds, assists: assists,
    steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: gamesPlayed * 30
  };
}

// Adding a key to SEASON_STAT_KEYS must not corrupt a season already in
// progress. accumulateSeasonStats only seeds the whole object when it is
// ABSENT — a save made before the new key exists has a seasonStats that is
// present but short one field, and `undefined + 0` is NaN.
//
// The corruption hides: JSON.stringify writes NaN as null, and `null + 0` is
// 0, so the symptom is not a NaN on screen but a statistic that silently
// resets to zero every time the game is loaded.
//
// Tests the PROPERTY (any new key is safe) rather than one particular key, by
// extending the live array and restoring it, so it keeps guarding whatever is
// added next.
function checkNewStatKeyDoesNotCorruptAnOldSave() {
  const player = freshPlayer(1);
  // An old save: seasonStats exists, seeded from the keys of its own era.
  player.seasonStats = aSeason(10, 200, 60, 40);

  leagueModule.SEASON_STAT_KEYS.push('brandNewStat');
  try {
    leagueModule.accumulateSeasonStats(player.id, { points: 20, brandNewStat: 7 });
  } finally {
    leagueModule.SEASON_STAT_KEYS.pop();
  }

  assert.ok(!Number.isNaN(player.seasonStats.brandNewStat),
    'a stat key added after this save was made must not accumulate to NaN');
  assert.strictEqual(player.seasonStats.brandNewStat, 7,
    'the new key should start from zero and take the game line');
  assert.strictEqual(player.seasonStats.points, 220, 'existing keys keep accumulating');
  console.log('checkNewStatKeyDoesNotCorruptAnOldSave: OK');
}

// The reported bug: mid-season, career totals must include what has been
// played so far rather than reading zero.
function checkInProgressSeasonCounts() {
  const player = freshPlayer(2);
  player.seasonStats = aSeason(5, 82, 20, 15);

  const totals = historyModule.careerTotalsToDate(player);
  assert.strictEqual(totals.gamesPlayed, 5, 'in-progress games should count toward career games');
  assert.strictEqual(totals.points, 82, 'in-progress points should count toward career points');
  assert.strictEqual(totals.rebounds, 20, 'in-progress rebounds should count');
  assert.strictEqual(totals.assists, 15, 'in-progress assists should count');
  assert.strictEqual(totals.seasonsPlayed, 1, 'a season being played is a season played');

  // The stored record must be untouched: end-of-season milestone detection
  // compares careerStats before/after rolling, so a helper that mutated it
  // would fire "reaches 10,000 career points" against the wrong baseline.
  assert.strictEqual(player.careerStats.points, 0, 'careerTotalsToDate must not mutate stored careerStats');
  assert.strictEqual(player.careerStats.gamesPlayed, 0, 'careerTotalsToDate must not mutate stored gamesPlayed');
  console.log('checkInProgressSeasonCounts: OK');
}

// THE regression guard. Between finalizeSeasonHistory and generateNewSeason,
// both careerStats and seasonStats hold the same season.
function checkNoDoubleCountDuringOffseason() {
  const player = freshPlayer(3);
  player.seasonStats = aSeason(70, 1400, 500, 300);

  historyModule.rollSeasonIntoCareerStats(player, 2060, function () {});
  assert.strictEqual(player.careerStats.points, 1400, 'sanity: the roll should have banked the season');
  assert.ok(player.seasonStats && player.seasonStats.gamesPlayed === 70,
    'sanity: this test is meaningless unless seasonStats survives the roll');

  const totals = historyModule.careerTotalsToDate(player);
  assert.strictEqual(totals.points, 1400, 'a rolled season must not be counted twice');
  assert.strictEqual(totals.gamesPlayed, 70, 'a rolled season must not be counted twice');
  assert.strictEqual(totals.seasonsPlayed, 1, 'a rolled season must not add a second season');
  console.log('checkNoDoubleCountDuringOffseason: OK');
}

// After the new season is generated, seasonStats is wiped and the flag reset,
// so the next games played start counting again on top of the banked career.
function checkNewSeasonResumesCounting() {
  const player = freshPlayer(4);
  player.seasonStats = aSeason(70, 1400, 500, 300);
  historyModule.rollSeasonIntoCareerStats(player, 2060, function () {});

  seasonTransitionModule.generateNewSeason(makeRng(7));
  assert.ok(!player.seasonStats || !player.seasonStats.gamesPlayed,
    'sanity: generateNewSeason should have cleared seasonStats');

  leagueModule.ensureSeasonStats
    ? leagueModule.ensureSeasonStats(player)
    : (player.seasonStats = aSeason(0, 0, 0, 0));
  player.seasonStats = aSeason(3, 60, 15, 9);

  const totals = historyModule.careerTotalsToDate(player);
  assert.strictEqual(totals.points, 1460, 'new-season points should add to the banked career');
  assert.strictEqual(totals.gamesPlayed, 73, 'new-season games should add to the banked career');
  assert.strictEqual(totals.seasonsPlayed, 2, 'the new in-progress season is the second season');
  console.log('checkNewSeasonResumesCounting: OK');
}

// A player who has not appeared yet must not show a phantom season.
function checkZeroGamesAddsNothing() {
  const player = freshPlayer(5);
  player.seasonStats = aSeason(0, 0, 0, 0);

  const totals = historyModule.careerTotalsToDate(player);
  assert.strictEqual(totals.seasonsPlayed, 0, 'zero games played is not a season played');
  assert.strictEqual(totals.gamesPlayed, 0, 'zero games played adds no games');
  console.log('checkZeroGamesAddsNothing: OK');
}

// Rookies arrive mid-pipeline without seasonStats at all.
function checkMissingSeasonStatsIsSafe() {
  const player = freshPlayer(6);
  player.seasonStats = undefined;
  player.careerStats.points = 900;
  player.careerStats.gamesPlayed = 40;
  player.careerStats.seasonsPlayed = 1;

  const totals = historyModule.careerTotalsToDate(player);
  assert.strictEqual(totals.points, 900, 'absent seasonStats should fall back to stored career totals');
  assert.strictEqual(totals.gamesPlayed, 40, 'absent seasonStats should fall back to stored career totals');
  console.log('checkMissingSeasonStatsIsSafe: OK');
}

// The test above calls rollSeasonIntoCareerStats directly, which proves the
// arithmetic but not the wiring. The league never calls it that way: it goes
// through finalizeSeasonHistory, which loops every player in PLAYERS_2026.
// If the flag were set anywhere but inside that loop, the test above would
// still pass while every real league double-counted.
function checkRealEntryPointSetsTheFlag() {
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
  const roster = playersModule.PLAYERS_2026.slice(0, 25);
  historyModule.ensureCareerData(roster);
  roster.forEach(function (p) { p.seasonStats = aSeason(60, 1200, 400, 250); });

  const before = roster.map(function (p) { return historyModule.careerTotalsToDate(p).points; });
  assert.ok(before.every(function (v) { return v === 1200; }),
    'sanity: before the roll, the in-progress season is what career totals show');

  historyModule.finalizeSeasonHistory(2061, null, function () {});

  roster.forEach(function (p, i) {
    assert.strictEqual(p.seasonStatsRolled, true,
      'finalizeSeasonHistory must mark every player rolled, not just some');
    assert.strictEqual(historyModule.careerTotalsToDate(p).points, 1200,
      'player ' + i + ' double-counted through the real season-end path');
  });
  console.log('checkRealEntryPointSetsTheFlag: OK');
}

// Career HIGHS have the same defect as career totals: careerHighs.singleSeason
// is only written by recordSeasonInHistory at season end, so the profile showed
// "Best Season PPG 0.0" beside a live 16.4, while Single-Game Pts (updated per
// game) read a correct 36. Same rule, same rolled-flag guard.
function checkSeasonHighsIncludeLiveSeason() {
  const player = freshPlayer(7);
  player.careerHistory.careerHighs.singleSeason = { points: 1500, rebounds: 600, assists: 200, ppg: 21, rpg: 8, apg: 3 };
  player.seasonStats = aSeason(5, 82, 20, 15);

  assert.strictEqual(player.seasonStatsRolled, false,
    'this test is only meaningful against an unbanked season');
  const highs = historyModule.seasonHighsToDate(player);
  assert.strictEqual(highs.points, 1500, 'a 5-game total must not beat a full prior season');
  assert.ok(Math.abs(highs.apg - 3) < 1e-9, 'a live 3.0 apg should not displace a stored 3.0');
  assert.ok(Math.abs(highs.ppg - 21) < 1e-9, 'a live 16.4 ppg must not displace a stored career-high 21');

  // A genuinely career-best pace mid-season SHOULD show.
  player.seasonStats = aSeason(5, 150, 20, 15);
  assert.ok(Math.abs(historyModule.seasonHighsToDate(player).ppg - 30) < 1e-9,
    'a live 30.0 ppg is a new career high and should display');

  assert.strictEqual(player.careerHistory.careerHighs.singleSeason.ppg, 21,
    'seasonHighsToDate must not write back into the stored highs');
  console.log('checkSeasonHighsIncludeLiveSeason: OK');
}

// Honest scope note: this does NOT prove the seasonStatsRolled guard inside
// seasonHighsToDate is load-bearing, and cannot. Once a season is rolled, the
// stored high already contains it, so max(stored, live) is idempotent and
// deleting the guard changes no output — mutation testing confirmed the
// mutant survives. The guard is kept for symmetry with careerTotalsToDate,
// where it IS load-bearing, and to keep a future switch from max() to
// accumulation from silently double-counting.
//
// What this test does prove: a rolled season is reflected exactly once, which
// is the property a reader actually depends on.
function checkSeasonHighsRespectRolledFlag() {
  const player = freshPlayer(8);
  player.seasonStats = aSeason(70, 2100, 500, 300);
  historyModule.rollSeasonIntoCareerStats(player, 2062, function () {});

  const highs = historyModule.seasonHighsToDate(player);
  assert.strictEqual(highs.points, 2100, 'the rolled season should be reflected once, from storage');
  assert.strictEqual(player.seasonStatsRolled, true, 'sanity: the season was rolled');
  console.log('checkSeasonHighsRespectRolledFlag: OK');
}

checkNewStatKeyDoesNotCorruptAnOldSave();
checkInProgressSeasonCounts();
checkNoDoubleCountDuringOffseason();
checkRealEntryPointSetsTheFlag();
checkSeasonHighsIncludeLiveSeason();
checkSeasonHighsRespectRolledFlag();
checkNewSeasonResumesCounting();
checkZeroGamesAddsNothing();
checkMissingSeasonStatsIsSafe();

console.log('All careerTotals validations passed');
