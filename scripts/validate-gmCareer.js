// The GM career record is a QUERY over history the game already keeps, not a
// parallel set of counters. These tests exist to keep it that way: the moment a
// total is stored rather than derived, one of the anti-drift assertions below
// starts failing.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const draft = rq('draft.js');

// A bracket shaped exactly like playoffs.js builds one, small enough to reason
// about: 4 first-round series, 2 semis, 1 conference final per side, 1 final.
function fakeBracket() {
  const series = function (higher, lower, winner) {
    return { higherSeed: higher, lowerSeed: lower, winner: winner, complete: true };
  };
  return {
    first: [series('BOS', 'MIA', 'BOS'), series('NYK', 'ORL', 'NYK'),
            series('LAL', 'PHX', 'LAL'), series('DEN', 'SAC', 'DEN')],
    semis: [series('BOS', 'NYK', 'BOS'), series('LAL', 'DEN', 'LAL')],
    confFinals: [series('BOS', 'CHI', 'BOS'), series('LAL', 'GSW', 'LAL')],
    finals: [series('BOS', 'LAL', 'BOS')]
  };
}

function checkPlayoffResultByTeamEncodesEveryRound() {
  const byTeam = draft.playoffResultByTeam(fakeBracket());
  assert.strictEqual(byTeam.MIA, 0, 'a first-round loser is round 0');
  assert.strictEqual(byTeam.NYK, 1, 'a team that lost in the semis is round 1');
  assert.strictEqual(byTeam.CHI, 2, 'a team that lost the conference finals is round 2');
  assert.strictEqual(byTeam.LAL, 3, 'the Finals loser is round 3');
  assert.strictEqual(byTeam.BOS, 4, 'the champion is round 4');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(byTeam, 'UTA'), false,
    'a team that missed the playoffs is ABSENT, not present with a sentinel');
  console.log('checkPlayoffResultByTeamEncodesEveryRound: OK');
}
checkPlayoffResultByTeamEncodesEveryRound();

const gmCareer = rq('gmCareer.js');

function checkCareerStartsEmptyWithOneOpenTenure() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  assert.strictEqual(c.name, 'Cory');
  assert.deepStrictEqual(c.tenures, [{ teamId: 'BOS', startYear: 2026, endYear: null }]);
  assert.deepStrictEqual(c.seasons, []);
  assert.deepStrictEqual(c.milestones, []);
  assert.deepStrictEqual(c.chronicle, []);
  console.log('checkCareerStartsEmptyWithOneOpenTenure: OK');
}
checkCareerStartsEmptyWithOneOpenTenure();

function checkTenureCoversIsInclusiveAndOpenEnded() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2026), true, 'the start year is inside the tenure');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2099), true, 'an open tenure has no end');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2025), false, 'before the start year is outside');
  assert.strictEqual(gmCareer.tenureCovers(c, 'LAL', 2030), false, 'another team is never covered');

  c.tenures = [{ teamId: 'BOS', startYear: 2026, endYear: 2030 },
               { teamId: 'LAL', startYear: 2031, endYear: null }];
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2030), true, 'the end year is INSIDE the tenure');
  assert.strictEqual(gmCareer.tenureCovers(c, 'BOS', 2031), false, 'the year after the end is outside');
  assert.strictEqual(gmCareer.tenureCovers(c, 'LAL', 2031), true, 'a second stint is covered');
  console.log('checkTenureCoversIsInclusiveAndOpenEnded: OK');
}
checkTenureCoversIsInclusiveAndOpenEnded();

function checkRecordSeasonClassifiesAndIsIdempotent() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const row = gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  assert.deepStrictEqual(row, { leagueYear: 2026, teamId: 'BOS', wins: 58, losses: 24,
    result: gmCareer.SEASON_RESULT.CHAMPION });
  assert.strictEqual(c.seasons.length, 1);

  // The manual advance and the fast-forward reach finalizeSeasonHistory by
  // different routes. A duplicate row would silently double every derived
  // total, so the guard lives with the data rather than at one call site.
  gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  assert.strictEqual(c.seasons.length, 1, 'recording the same year twice must not append');
  console.log('checkRecordSeasonClassifiesAndIsIdempotent: OK');
}
checkRecordSeasonClassifiesAndIsIdempotent();

function checkMissingThePlayoffsIsRecordedAsMissed() {
  const c = gmCareer.createGmCareer('Cory', 'UTA', 2026);
  const row = gmCareer.recordSeason(c, 2026, 'UTA', 19, 63, fakeBracket());
  assert.strictEqual(row.result, gmCareer.SEASON_RESULT.MISSED,
    'a team absent from the bracket missed the playoffs');

  // A season abandoned before the Finals resolve must not read as a title.
  const c2 = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const row2 = gmCareer.recordSeason(c2, 2026, 'BOS', 58, 24, null);
  assert.strictEqual(row2.result, gmCareer.SEASON_RESULT.MISSED,
    'no bracket at all is MISSED, never CHAMPION');
  console.log('checkMissingThePlayoffsIsRecordedAsMissed: OK');
}
checkMissingThePlayoffsIsRecordedAsMissed();

function checkRegularSeasonRecordExcludesThePlayoffs() {
  // league.js's recordGameResult has no isPlayoff guard, so team.record
  // accumulates postseason games. Measured on a real 2026 season: Boston
  // finished 73-9 and team.record read 86-14 by the time the career row was
  // written. This is the assertion that keeps the career page honest.
  const games = [
    { played: true, isPlayoff: false, homeTeamId: 'BOS', awayTeamId: 'MIA', homeScore: 110, awayScore: 100 },
    { played: true, isPlayoff: false, homeTeamId: 'NYK', awayTeamId: 'BOS', homeScore: 99, awayScore: 105 },
    { played: true, isPlayoff: false, homeTeamId: 'BOS', awayTeamId: 'LAL', homeScore: 90, awayScore: 101 },
    { played: false, isPlayoff: false, homeTeamId: 'BOS', awayTeamId: 'CHI', homeScore: null, awayScore: null },
    { played: true, isPlayoff: true, homeTeamId: 'BOS', awayTeamId: 'MIA', homeScore: 120, awayScore: 90 },
    { played: true, isPlayoff: false, homeTeamId: 'DEN', awayTeamId: 'SAC', homeScore: 111, awayScore: 100 }
  ];
  const rec = gmCareer.regularSeasonRecord(games, 'BOS');
  assert.deepStrictEqual(rec, { wins: 2, losses: 1 },
    'regular season only: an unplayed game, a playoff game and another team\'s game are all excluded');

  assert.deepStrictEqual(gmCareer.regularSeasonRecord([], 'BOS'), { wins: 0, losses: 0 },
    'no games is 0-0, not a crash');
  assert.deepStrictEqual(gmCareer.regularSeasonRecord(null, 'BOS'), { wins: 0, losses: 0 },
    'a missing schedule is 0-0, not a crash');
  console.log('checkRegularSeasonRecordExcludesThePlayoffs: OK');
}
checkRegularSeasonRecordExcludesThePlayoffs();

function checkEnsureRepairsAPartialCareer() {
  const gs = { userTeamId: 'BOS', leagueYear: 2031 };
  const created = gmCareer.ensureGmCareer(gs);
  assert.strictEqual(created.name, 'GM', 'a career with no name defaults rather than blocking');
  assert.strictEqual(created.tenures[0].startYear, 2031,
    'a career created mid-save starts at the CURRENT year, not 2026 — it does not invent a past');

  const gs2 = { userTeamId: 'BOS', leagueYear: 2026, gmCareer: { name: 'Cory' } };
  const repaired = gmCareer.ensureGmCareer(gs2);
  assert.deepStrictEqual(repaired.seasons, [], 'missing arrays are repaired, not left undefined');
  assert.deepStrictEqual(repaired.chronicle, []);
  assert.deepStrictEqual(repaired.milestones, []);
  console.log('checkEnsureRepairsAPartialCareer: OK');
}
checkEnsureRepairsAPartialCareer();

// A career with a known, hand-checkable shape: 6 seasons, 2 titles (back to
// back), 1 Finals loss, 4 playoff appearances.
function sixSeasonCareer() {
  const R = gmCareer.SEASON_RESULT;
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  c.seasons = [
    { leagueYear: 2026, teamId: 'BOS', wins: 41, losses: 41, result: R.MISSED },
    { leagueYear: 2027, teamId: 'BOS', wins: 50, losses: 32, result: R.FIRST_ROUND },
    { leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION },
    { leagueYear: 2029, teamId: 'BOS', wins: 58, losses: 24, result: R.CHAMPION },
    { leagueYear: 2030, teamId: 'BOS', wins: 55, losses: 27, result: R.FINALS_LOSS },
    { leagueYear: 2031, teamId: 'BOS', wins: 30, losses: 52, result: R.MISSED }
  ];
  return c;
}

function checkCareerTotalsAreDerivedFromSeasonRows() {
  const t = gmCareer.careerTotals(sixSeasonCareer());
  assert.strictEqual(t.seasons, 6);
  assert.strictEqual(t.wins, 296);
  assert.strictEqual(t.losses, 196);
  assert.strictEqual(t.titles, 2);
  assert.strictEqual(t.finalsAppearances, 3, 'two titles plus one Finals loss');
  assert.strictEqual(t.playoffAppearances, 4);
  assert.strictEqual(Math.round(t.winPct * 1000) / 1000, 0.602);
  console.log('checkCareerTotalsAreDerivedFromSeasonRows: OK');
}
checkCareerTotalsAreDerivedFromSeasonRows();

function checkStreaksCountConsecutiveSeasonsOnly() {
  const c = sixSeasonCareer();
  assert.deepStrictEqual(gmCareer.titleYears(c), [2028, 2029]);
  assert.strictEqual(gmCareer.longestTitleRun(c), 2, 'back-to-back is a run of 2');
  assert.strictEqual(gmCareer.longestPlayoffStreak(c), 4, '2027-2030 is four straight');

  // A gap must BREAK the run, not be skipped over.
  const R = gmCareer.SEASON_RESULT;
  c.seasons[3].result = R.MISSED;
  assert.strictEqual(gmCareer.longestTitleRun(c), 1, 'a missed year between titles breaks the run');
  assert.strictEqual(gmCareer.longestPlayoffStreak(c), 2, 'and breaks the playoff streak');
  console.log('checkStreaksCountConsecutiveSeasonsOnly: OK');
}
checkStreaksCountConsecutiveSeasonsOnly();

function checkArchiveQueriesRespectTheTenureWindow() {
  const c = sixSeasonCareer();
  const leagueHistory = {
    champions: [],
    draftClasses: [
      { leagueYear: 2027, picks: [{ round: 1, pickNumber: 3, teamId: 'BOS', playerId: 'p1', playerName: 'Real Pick' }] },
      { leagueYear: 2027, picks: [{ round: 1, pickNumber: 4, teamId: 'LAL', playerId: 'p2', playerName: 'Not Yours' }] },
      { leagueYear: 2020, picks: [{ round: 1, pickNumber: 1, teamId: 'BOS', playerId: 'p3', playerName: 'Before You' }] }
    ],
    trades: [
      { leagueYear: 2028, participants: ['BOS', 'LAL'],
        players: [{ playerId: 'p4', playerName: 'Arrived', fromTeamId: 'LAL', toTeamId: 'BOS' },
                  { playerId: 'p5', playerName: 'Departed', fromTeamId: 'BOS', toTeamId: 'LAL' }], picks: [] },
      { leagueYear: 2028, participants: ['NYK', 'MIA'],
        players: [{ playerId: 'p6', playerName: 'Elsewhere', fromTeamId: 'NYK', toTeamId: 'MIA' }], picks: [] }
    ]
  };

  const picks = gmCareer.userDraftPicks(c, leagueHistory);
  assert.strictEqual(picks.length, 1, 'only picks made by your team, during your years');
  assert.strictEqual(picks[0].playerName, 'Real Pick');

  assert.strictEqual(gmCareer.userTrades(c, leagueHistory).length, 1,
    'only trades your team took part in');

  const arrivals = gmCareer.playersAcquiredByTrade(c, leagueHistory);
  assert.deepStrictEqual(arrivals.map(function (a) { return a.playerName; }), ['Arrived'],
    'a player LEAVING your team is not an acquisition');
  console.log('checkArchiveQueriesRespectTheTenureWindow: OK');
}
checkArchiveQueriesRespectTheTenureWindow();

// THE ANTI-DRIFT ASSERTION.
//
// Comparing the career page's title count against the trophy room's banner
// count would be VACUOUS: both read careerTotals, so the test passes no matter
// how wrong careerTotals is. It has to be checked against an INDEPENDENT
// re-implementation — the same idiom validate-skillCheck.js's referenceShot
// uses. That means a future change to careerTotals must be mirrored here by
// hand. That is the point, not an inconvenience.
function checkTitlesAgreeWithAnIndependentWalkOfTheArchive() {
  const c = sixSeasonCareer();
  const leagueHistory = {
    champions: [
      { leagueYear: 2028, teamId: 'BOS' },
      { leagueYear: 2029, teamId: 'BOS' },
      { leagueYear: 2030, teamId: 'LAL' },
      { leagueYear: 2024, teamId: 'BOS' }   // before the tenure: not yours
    ],
    draftClasses: [], trades: []
  };

  let referenceTitles = 0;
  leagueHistory.champions.forEach(function (ch) {
    if (gmCareer.tenureCovers(c, ch.teamId, ch.leagueYear)) referenceTitles += 1;
  });

  assert.strictEqual(gmCareer.careerTotals(c).titles, referenceTitles,
    'the season rows and the champions archive must tell the same story');
  console.log('checkTitlesAgreeWithAnIndependentWalkOfTheArchive: OK (' + referenceTitles + ' titles)');
}
checkTitlesAgreeWithAnIndependentWalkOfTheArchive();

function checkChronicleIsAppendOnlyAndDated() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const e = gmCareer.addChronicle(c, 2028, 'milestone', 'Won your first championship.');
  assert.deepStrictEqual(e, { leagueYear: 2028, kind: 'milestone', text: 'Won your first championship.' });
  gmCareer.addChronicle(c, 2029, 'award', 'Jayson Tatum wins MVP.');
  assert.strictEqual(c.chronicle.length, 2, 'entries accumulate; nothing is overwritten');
  console.log('checkChronicleIsAppendOnlyAndDated: OK');
}
checkChronicleIsAppendOnlyAndDated();

function checkSeasonChronicleTextIsFrozenAtWriteTime() {
  const R = gmCareer.SEASON_RESULT;
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  const e = gmCareer.recordSeasonChronicle(c,
    { leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION }, 'Boston Harbormen');
  assert.strictEqual(e.kind, 'season');
  assert.strictEqual(e.text, '62-20. Won the championship.',
    'the line reads as a sentence and carries the record');

  const miss = gmCareer.recordSeasonChronicle(c,
    { leagueYear: 2031, teamId: 'BOS', wins: 30, losses: 52, result: R.MISSED }, 'Boston Harbormen');
  assert.strictEqual(miss.text, '30-52. Missed the playoffs.');
  console.log('checkSeasonChronicleTextIsFrozenAtWriteTime: OK');
}
checkSeasonChronicleTextIsFrozenAtWriteTime();

function checkChronicleGetsOneSeasonLinePerYear() {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  gmCareer.recordSeason(c, 2026, 'BOS', 58, 24, fakeBracket());
  gmCareer.recordSeasonChronicle(c, c.seasons[0], 'Boston Harbormen');
  const again = gmCareer.recordSeasonChronicle(c, c.seasons[0], 'Boston Harbormen');
  assert.strictEqual(again, null, 'a year already chronicled returns null');
  assert.strictEqual(c.chronicle.filter(function (e) { return e.kind === 'season'; }).length, 1);
  console.log('checkChronicleGetsOneSeasonLinePerYear: OK');
}
checkChronicleGetsOneSeasonLinePerYear();

// A bracket that EXISTS is not a bracket that FINISHED. playoffResultByTeam
// reads bracket.finals[0] unconditionally, so every caller has to check first.
// ui/draft.js did not, and opening the Draft screen mid-playoffs threw — which
// then killed the Continue button, because that render runs inside the advance
// loop. The guard is now one shared predicate rather than a condition each
// caller remembers to repeat.
function checkBracketCompletenessIsShared() {
  const seeded = { first: [{ higherSeed: 'BOS', lowerSeed: 'MIA', winner: null }], semis: [], confFinals: [], finals: [] };
  assert.strictEqual(draft.playoffBracketIsComplete(seeded), false, 'a seeded bracket is not complete');
  assert.strictEqual(draft.playoffBracketIsComplete(null), false, 'no bracket is not complete');
  assert.strictEqual(draft.playoffBracketIsComplete({}), false, 'an empty object is not complete');
  assert.strictEqual(draft.playoffBracketIsComplete({ finals: [] }), false, 'empty finals is not complete');
  assert.strictEqual(draft.playoffBracketIsComplete({ finals: [{ winner: null }] }), false,
    'finals played but undecided is not complete');
  assert.strictEqual(draft.playoffBracketIsComplete(fakeBracket()), true, 'a finished bracket is complete');

  // And the thing the guard exists to protect: the raw function must still be
  // the one that throws, so nobody is tempted to make it silently return
  // nonsense for an unfinished bracket.
  assert.throws(function () { draft.playoffResultByTeam(seeded); },
    'playoffResultByTeam still requires a finished bracket');
  console.log('checkBracketCompletenessIsShared: OK');
}
checkBracketCompletenessIsShared();

function checkReputationDefaultsAndClamps() {
  const career = gmCareer.createGmCareer('Test GM', 'BOS', 2026);
  assert.strictEqual(career.reputation, 50, 'a new career starts neutral');

  assert.strictEqual(gmCareer.clampReputation(150), 100, 'clamps high');
  assert.strictEqual(gmCareer.clampReputation(-20), 0, 'clamps low');
  assert.strictEqual(gmCareer.clampReputation(72), 72, 'passes through in range');
  assert.strictEqual(gmCareer.clampReputation('nonsense'), 50, 'a non-number falls back to neutral');
  assert.strictEqual(gmCareer.clampReputation(undefined), 50, 'undefined falls back to neutral');
  assert.strictEqual(gmCareer.clampReputation(NaN), 50, 'NaN falls back to neutral');
  console.log('checkReputationDefaultsAndClamps: OK');
}
checkReputationDefaultsAndClamps();

function checkReputationBackfillsOldSaves() {
  // A save written before this feature has a career with no reputation field
  // at all. ensureGmCareer is what save.js runs on load.
  const gameState = { userTeamId: 'BOS', leagueYear: 2029, gmCareer: { name: 'Old GM', tenures: [], seasons: [] } };
  assert.strictEqual(gmCareer.ensureGmCareer(gameState).reputation, 50, 'an old save backfills to neutral');

  gameState.gmCareer.reputation = 81;
  assert.strictEqual(gmCareer.ensureGmCareer(gameState).reputation, 81, 'an existing value survives');

  gameState.gmCareer.reputation = 'garbage';
  assert.strictEqual(gmCareer.ensureGmCareer(gameState).reputation, 50, 'a corrupt value is repaired');
  console.log('checkReputationBackfillsOldSaves: OK');
}
checkReputationBackfillsOldSaves();

function checkReputationBands() {
  assert.strictEqual(gmCareer.reputationBand(0), 'Stonewalled');
  assert.strictEqual(gmCareer.reputationBand(24), 'Stonewalled');
  assert.strictEqual(gmCareer.reputationBand(25), 'Divisive');
  assert.strictEqual(gmCareer.reputationBand(50), 'Known Quantity');
  assert.strictEqual(gmCareer.reputationBand(70), 'Respected');
  assert.strictEqual(gmCareer.reputationBand(100), 'Institution');
  // Every value in range must produce a band — no gaps between boundaries.
  for (let v = 0; v <= 100; v++) {
    const band = gmCareer.reputationBand(v);
    assert.ok(typeof band === 'string' && band.length > 0, 'no band for ' + v);
  }
  console.log('checkReputationBands: OK');
}
checkReputationBands();

function checkPressIsANamedChronicleKind() {
  // Dialogue writes chronicle entries. Passing a bare string would put a kind
  // in the log that nothing else in the game knows how to render or filter.
  assert.strictEqual(gmCareer.CHRONICLE_KINDS.PRESS, 'press', 'press is a named kind');
  const career = gmCareer.createGmCareer('Test GM', 'BOS', 2026);
  const entry = gmCareer.addChronicle(career, 2027, gmCareer.CHRONICLE_KINDS.PRESS, 'Said a thing.');
  assert.strictEqual(entry.kind, 'press');
  assert.strictEqual(career.chronicle.length, 1);
  console.log('checkPressIsANamedChronicleKind: OK');
}
checkPressIsANamedChronicleKind();

console.log('All gmCareer validations passed');
