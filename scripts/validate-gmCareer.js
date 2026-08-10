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

console.log('All gmCareer validations passed');
