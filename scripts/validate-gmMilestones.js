// The chase-list is a BALANCE problem wearing a coding problem's clothes: a
// list where half the entries are unreachable discourages, and one cleared by
// season eight is empty. These tests cover the MECHANICS only — whether the
// thresholds are any good is measured by scripts/probe-gm-milestones.js.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const gmCareer = rq('gmCareer.js');
const gmMilestones = rq('gmMilestones.js');
const ratings = rq('ratings.js');

function careerWith(seasons) {
  const c = gmCareer.createGmCareer('Cory', 'BOS', 2026);
  c.seasons = seasons;
  return c;
}

function emptyContext(career) {
  return gmMilestones.buildContext(career,
    { champions: [], draftClasses: [], trades: [], awardsHistory: [] },
    [], [], ratings.toDisplayRating);
}

function checkEveryMilestoneIsWellFormed() {
  const seen = {};
  gmMilestones.MILESTONES.forEach(function (m) {
    assert.ok(m.id && typeof m.id === 'string', 'every milestone needs an id');
    assert.strictEqual(seen[m.id], undefined, 'duplicate milestone id: ' + m.id);
    seen[m.id] = true;
    assert.ok(m.label && m.description, m.id + ' needs a label and a description');
    assert.notStrictEqual(gmMilestones.FAMILIES.indexOf(m.family), -1,
      m.id + ' has unknown family ' + m.family);
    assert.strictEqual(typeof m.achieved, 'function', m.id + ' needs an achieved()');
    assert.ok(m.progress === null || typeof m.progress === 'function',
      m.id + ' progress must be a function or explicitly null');
    assert.strictEqual(typeof m.hidden, 'boolean', m.id + ' must declare hidden explicitly');
  });
  assert.ok(gmMilestones.MILESTONES.length >= 15,
    'a chase-list shorter than 15 does not span a career');
  console.log('checkEveryMilestoneIsWellFormed: OK (' + gmMilestones.MILESTONES.length + ' milestones)');
}
checkEveryMilestoneIsWellFormed();

function checkNothingIsAchievedOnAnEmptyCareer() {
  const c = careerWith([]);
  const ctx = emptyContext(c);
  const wrongly = gmMilestones.MILESTONES.filter(function (m) { return m.achieved(ctx); });
  assert.deepStrictEqual(wrongly.map(function (m) { return m.id; }), [],
    'these fire on a career that has done nothing: ' + wrongly.map(function (m) { return m.id; }).join(', '));
  console.log('checkNothingIsAchievedOnAnEmptyCareer: OK');
}
checkNothingIsAchievedOnAnEmptyCareer();

function checkUnlockIsRecordedOnceWithItsYear() {
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION }]);
  const ctx = emptyContext(c);

  const ids = gmMilestones.evaluate(c, ctx).map(function (m) { return m.id; });
  assert.notStrictEqual(ids.indexOf('first_title'), -1, 'winning a title unlocks first_title');
  assert.strictEqual(gmMilestones.isUnlocked(c, 'first_title'), true);
  assert.strictEqual(c.milestones.find(function (u) { return u.id === 'first_title'; }).leagueYear, 2028,
    'the unlock is dated to the latest season');

  assert.deepStrictEqual(gmMilestones.evaluate(c, ctx), [], 're-evaluating unlocks nothing new');
  assert.strictEqual(c.milestones.filter(function (u) { return u.id === 'first_title'; }).length, 1);
  console.log('checkUnlockIsRecordedOnceWithItsYear: OK');
}
checkUnlockIsRecordedOnceWithItsYear();

function checkUnlockWritesAChronicleLine() {
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2028, teamId: 'BOS', wins: 62, losses: 20, result: R.CHAMPION }]);
  gmMilestones.evaluate(c, emptyContext(c));
  const lines = c.chronicle.filter(function (e) { return e.kind === 'milestone'; });
  assert.ok(lines.length >= 1, 'an unlock must reach the chronicle, not just the milestone list');
  assert.strictEqual(lines[0].leagueYear, 2028);
  console.log('checkUnlockWritesAChronicleLine: OK');
}
checkUnlockWritesAChronicleLine();

function checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes() {
  const R = gmCareer.SEASON_RESULT;
  const seasons = [];
  for (let i = 0; i < 9; i++) {
    seasons.push({ leagueYear: 2026 + i, teamId: 'BOS', wins: 41, losses: 41, result: R.MISSED });
  }
  const c = careerWith(seasons);
  const near = gmMilestones.nearestMilestone(c, emptyContext(c));
  assert.strictEqual(near.milestone.id, 'ten_seasons');
  assert.strictEqual(near.current, 9);
  assert.strictEqual(near.target, 10);

  // Called twice on identical state it must give the same answer, or the
  // Dashboard changes what it is telling you every time it repaints.
  assert.strictEqual(gmMilestones.nearestMilestone(c, emptyContext(c)).milestone.id, near.milestone.id);
  assert.strictEqual(near.milestone.progress === null, false,
    'a binary milestone must never be "nearest" — it has no honest fraction');
  console.log('checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes: OK');
}
checkNearestMilestoneIsDeterministicAndSkipsBinaryOnes();

function checkHiddenMilestonesAreNeverTheNearestHint() {
  const R = gmCareer.SEASON_RESULT;
  const seasons = [];
  for (let i = 0; i < 24; i++) {
    seasons.push({ leagueYear: 2026 + i, teamId: 'BOS', wins: 60, losses: 22, result: R.CHAMPION });
  }
  const c = careerWith(seasons);
  const near = gmMilestones.nearestMilestone(c, emptyContext(c));
  if (near) {
    assert.strictEqual(near.milestone.hidden, false,
      'the Dashboard hint must never spoil a hidden milestone');
  }
  console.log('checkHiddenMilestonesAreNeverTheNearestHint: OK');
}
checkHiddenMilestonesAreNeverTheNearestHint();

function checkTheScaleTrap() {
  // peakOverall is RAW; the 90 in "a player you drafted reaches 90" is DISPLAY.
  // On this curve DISPLAY RUNS HIGHER THAN RAW, so the failure mode of
  // comparing raw against a display threshold is that the milestone SILENTLY
  // UNDER-FIRES: it would demand raw 90, which is a display all-time great,
  // and genuine 90-rated stars would never trip it. That is the quiet version
  // of this bug and the reason it has survived four times in this codebase.
  // The fixture raws are DERIVED from the live curve rather than hardcoded —
  // the 2K27 import re-anchored the knots and killed the old literals.
  const R = gmCareer.SEASON_RESULT;
  const c = careerWith([{ leagueYear: 2027, teamId: 'BOS', wins: 50, losses: 32, result: R.FIRST_ROUND }]);
  const leagueHistory = {
    champions: [], trades: [], awardsHistory: [],
    draftClasses: [{ leagueYear: 2027, picks: [{ round: 1, pickNumber: 5, teamId: 'BOS', playerId: 'p1', playerName: 'The Kid' }] }]
  };
  const drafted = gmMilestones.MILESTONES.find(function (m) { return m.id === 'drafted_a_star'; });

  let starRaw = 23;
  while (ratings.toDisplayRating(starRaw) < 90) starRaw++;
  const nonStarRaw = starRaw - 5;
  assert.strictEqual(ratings.toDisplayRating(starRaw) >= 90, true,
    'precondition: raw ' + starRaw + ' IS a display-90 player on this curve');
  assert.strictEqual(starRaw >= 90, false,
    'precondition: ...and a naive raw comparison would miss him entirely');
  assert.strictEqual(ratings.toDisplayRating(nonStarRaw) < 90, true,
    'precondition: raw ' + nonStarRaw + ' displays below 90');

  const realStar = { id: 'p1', name: 'The Kid', peakOverall: starRaw };
  assert.strictEqual(drafted.achieved(
    gmMilestones.buildContext(c, leagueHistory, [realStar], [], ratings.toDisplayRating)), true,
    'a raw-' + starRaw + ' player displays at 90+ and MUST satisfy a display-90 threshold');

  const notAStar = { id: 'p1', name: 'The Kid', peakOverall: nonStarRaw };
  assert.strictEqual(drafted.achieved(
    gmMilestones.buildContext(c, leagueHistory, [notAStar], [], ratings.toDisplayRating)), false,
    'raw ' + nonStarRaw + ' displays below 90 and must not qualify');
  console.log('checkTheScaleTrap: OK');
}
checkTheScaleTrap();

console.log('All gmMilestones validations passed');
