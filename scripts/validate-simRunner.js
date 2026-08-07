// The stop policy behind Continue.
//
// Kept free of the DOM and of globals so every rule is a plain input/output
// case: the Skip-to target and whether the user pressed Stop arrive through
// `context` precisely so these tests never have to arrange browser state.
// This is the file that decides when the game interrupts the player, so its
// rules are worth pinning individually rather than inferring from behaviour.
const assert = require('assert');
const path = require('path');
const runner = require(path.join(__dirname, '..', 'simRunner.js'));
const R = runner.STOP_REASONS;

function baseState(over) {
  const gs = {
    // Mid-season: one game played, one still to come.
    season: { games: [{ day: 0, played: true }, { day: 1, played: false }], currentDay: 0 },
    playoffBracket: null,
    offseasonStage: null,
    automation: { autoDraft: false, autoFreeAgency: false },
    pauseRequested: false,
    pauseReason: null
  };
  return Object.assign(gs, over || {});
}

const NO_CONTEXT = { target: null, userStopRequested: false };

function checkNothingToStopFor() {
  assert.strictEqual(runner.evaluateStop(baseState(), 0, NO_CONTEXT), null,
    'a normal mid-season day does not stop');
  console.log('checkNothingToStopFor: OK');
}
checkNothingToStopFor();

function checkUserStopOutranksEverything() {
  // Deliberately a state where several other reasons also apply. If Stop did
  // not win, pressing it would look ignored while some other reason was
  // reported instead.
  const gs = baseState({ offseasonStage: 'draft', pauseRequested: true, pauseReason: 'Injury' });
  const stop = runner.evaluateStop(gs, 0, { target: null, userStopRequested: true });
  assert.ok(stop, 'a stop is returned');
  assert.strictEqual(stop.reason, R.USER_STOP, 'pressing Stop wins over every automatic reason');
  console.log('checkUserStopOutranksEverything: OK');
}
checkUserStopOutranksEverything();

function checkDraftStopRespectsAutomation() {
  const manual = baseState({ offseasonStage: 'draft' });
  const s1 = runner.evaluateStop(manual, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.DRAFT_READY, 'stops at the draft when autoDraft is off');
  assert.ok(s1.label && s1.label.length > 0, 'and says why');

  const auto = baseState({ offseasonStage: 'draft', automation: { autoDraft: true, autoFreeAgency: false } });
  assert.strictEqual(runner.evaluateStop(auto, 0, NO_CONTEXT), null,
    'runs straight through when autoDraft is on');
  console.log('checkDraftStopRespectsAutomation: OK');
}
checkDraftStopRespectsAutomation();

function checkFreeAgencyStopRespectsAutomation() {
  const manual = baseState({ offseasonStage: 'freeagency' });
  const s1 = runner.evaluateStop(manual, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.FREE_AGENCY_READY, 'stops at free agency when autoFreeAgency is off');

  const auto = baseState({ offseasonStage: 'freeagency', automation: { autoDraft: false, autoFreeAgency: true } });
  assert.strictEqual(runner.evaluateStop(auto, 0, NO_CONTEXT), null,
    'runs through when autoFreeAgency is on');
  console.log('checkFreeAgencyStopRespectsAutomation: OK');
}
checkFreeAgencyStopRespectsAutomation();

function checkSeasonAndPlayoffBoundaries() {
  const done = baseState({ season: { games: [{ day: 0, played: true }], currentDay: 0 } });
  const s1 = runner.evaluateStop(done, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.SEASON_COMPLETE, 'stops when every game is played');

  const champ = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'BOS' }] }
  });
  const s2 = runner.evaluateStop(champ, 0, NO_CONTEXT);
  assert.ok(s2 && s2.reason === R.PLAYOFFS_COMPLETE, 'stops once a champion exists');

  // A bracket that exists but has no champion yet is mid-postseason: keep going.
  const midPlayoffs = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [] }
  });
  assert.strictEqual(runner.evaluateStop(midPlayoffs, 0, NO_CONTEXT), null,
    'an in-progress postseason does not stop');
  console.log('checkSeasonAndPlayoffBoundaries: OK');
}
checkSeasonAndPlayoffBoundaries();

function checkNotableEventStops() {
  const gs = baseState({ pauseRequested: true, pauseReason: 'Jayson Tatum injured' });
  const stop = runner.evaluateStop(gs, 0, NO_CONTEXT);
  assert.ok(stop && stop.reason === R.NOTABLE_EVENT, 'a flagged event stops the run');
  assert.strictEqual(stop.label, 'Jayson Tatum injured', 'and the reason reaches the label');

  // pauseRequested with no reason recorded must still produce something
  // readable rather than an empty status line.
  const bare = baseState({ pauseRequested: true });
  const s2 = runner.evaluateStop(bare, 0, NO_CONTEXT);
  assert.ok(s2 && s2.label && s2.label.length > 0, 'a missing reason still yields a label');
  console.log('checkNotableEventStops: OK');
}
checkNotableEventStops();

function checkDayTargetReached() {
  const gs = baseState({ season: { games: [{ day: 0, played: true }, { day: 9, played: false }], currentDay: 5 } });
  assert.strictEqual(runner.evaluateStop(gs, 5, { target: { kind: 'day', day: 9 }, userStopRequested: false }), null,
    'keeps going before the target day');
  const at = runner.evaluateStop(gs, 9, { target: { kind: 'day', day: 9 }, userStopRequested: false });
  assert.ok(at && at.reason === R.TARGET_REACHED, 'stops on the target day');
  const past = runner.evaluateStop(gs, 12, { target: { kind: 'day', day: 9 }, userStopRequested: false });
  assert.ok(past && past.reason === R.TARGET_REACHED, 'and stays stopped past it');
  console.log('checkDayTargetReached: OK');
}
checkDayTargetReached();

function checkContextIsOptional() {
  // The loop always passes a context, but a missing one must not throw —
  // this function is the single gate every advance runs through.
  assert.doesNotThrow(function () { runner.evaluateStop(baseState(), 0); },
    'a missing context is tolerated');
  console.log('checkContextIsOptional: OK');
}
checkContextIsOptional();

console.log('All sim runner validations passed');
