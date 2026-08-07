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
  const gs = baseState({ offseasonStage: 'draft', draftSession: {}, pauseRequested: true, pauseReason: 'Injury' });
  const stop = runner.evaluateStop(gs, 0, { target: null, userStopRequested: true });
  assert.ok(stop, 'a stop is returned');
  assert.strictEqual(stop.reason, R.USER_STOP, 'pressing Stop wins over every automatic reason');
  console.log('checkUserStopOutranksEverything: OK');
}
checkUserStopOutranksEverything();

function checkDraftStopRespectsAutomation() {
  const manual = baseState({ offseasonStage: 'draft', draftSession: {} });
  const s1 = runner.evaluateStop(manual, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.DRAFT_READY, 'stops at the draft when autoDraft is off');
  assert.ok(s1.label && s1.label.length > 0, 'and says why');

  const auto = baseState({ offseasonStage: 'draft', draftSession: {}, automation: { autoDraft: true, autoFreeAgency: false } });
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

// Continue must be able to step ACROSS a boundary it is parked on, or it is a
// dead button exactly when the design says it should read "Continue -> Playoffs".
function checkCrossBoundaryLetsContinueProceed() {
  const seasonOver = baseState({ season: { games: [{ day: 0, played: true }], currentDay: 0 } });
  const s1 = runner.evaluateStop(seasonOver, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.SEASON_COMPLETE, 'halts at the boundary during a run');
  assert.strictEqual(runner.evaluateStop(seasonOver, 0, { crossBoundary: true }), null,
    'but steps across it when Continue is pressed from there');

  const champ = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'BOS' }] }
  });
  assert.strictEqual(runner.evaluateStop(champ, 0, { crossBoundary: true }), null,
    'the same applies to a finished postseason, so the rollover can run');

  // The narrowness is the point: a draft the user has not delegated is a
  // decision, not a boundary, and crossBoundary must not skip it.
  const draft = baseState({ offseasonStage: 'draft', draftSession: {} });
  const s2 = runner.evaluateStop(draft, 0, { crossBoundary: true });
  assert.ok(s2 && s2.reason === R.DRAFT_READY, 'an unautomated draft still stops');

  // Nor may it override the user.
  const s3 = runner.evaluateStop(seasonOver, 0, { crossBoundary: true, userStopRequested: true });
  assert.ok(s3 && s3.reason === R.USER_STOP, 'and Stop still wins');
  console.log('checkCrossBoundaryLetsContinueProceed: OK');
}
checkCrossBoundaryLetsContinueProceed();

function checkChampionshipTargetRunsPastOtherChampions() {
  const someoneElse = baseState({
    userTeamId: 'BOS',
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'LAL' }] }
  });
  const ctx = { target: { kind: 'championship' }, userStopRequested: false };
  assert.strictEqual(runner.evaluateStop(someoneElse, 0, ctx), null,
    'another team winning is just a season boundary to roll through');

  const us = baseState({
    userTeamId: 'BOS',
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'BOS' }] }
  });
  const stop = runner.evaluateStop(us, 0, ctx);
  assert.ok(stop && stop.reason === R.TARGET_REACHED, 'the user winning ends the run');
  assert.strictEqual(stop.label, 'You won the title', 'and says so');

  // The design is explicit that a skip halts early for a decision rather than
  // blowing past it — the old fast-forward loop did the opposite.
  const draftMidRun = baseState({ userTeamId: 'BOS', offseasonStage: 'draft', draftSession: {} });
  const s2 = runner.evaluateStop(draftMidRun, 0, ctx);
  assert.ok(s2 && s2.reason === R.DRAFT_READY, 'an unautomated draft still interrupts a title run');
  console.log('checkChampionshipTargetRunsPastOtherChampions: OK');
}
checkChampionshipTargetRunsPastOtherChampions();

function checkSeasonsTargetCountsLeagueYears() {
  const ctx = { target: { kind: 'seasons', untilYear: 2029, label: '3 seasons' }, userStopRequested: false };
  const midRun = baseState({
    leagueYear: 2027,
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'LAL' }] }
  });
  assert.strictEqual(runner.evaluateStop(midRun, 0, ctx), null,
    'rolls through season boundaries until the year is reached');

  const arrived = baseState({ leagueYear: 2029 });
  const stop = runner.evaluateStop(arrived, 0, ctx);
  assert.ok(stop && stop.reason === R.TARGET_REACHED, 'stops on the target year');
  assert.strictEqual(stop.label, 'Reached 3 seasons', 'and reports the target');
  console.log('checkSeasonsTargetCountsLeagueYears: OK');
}
checkSeasonsTargetCountsLeagueYears();

// The user's own title is the one result worth naming.
function checkUserTitleIsNamedOnAPlainContinue() {
  const gs = baseState({
    userTeamId: 'BOS',
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'BOS' }] }
  });
  const stop = runner.evaluateStop(gs, 0, NO_CONTEXT);
  assert.strictEqual(stop.label, 'You won the title', 'the user winning is named');

  const other = baseState({
    userTeamId: 'BOS',
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'LAL' }] }
  });
  assert.strictEqual(runner.evaluateStop(other, 0, NO_CONTEXT).label, 'Playoffs are over',
    'someone else winning is not');
  console.log('checkUserTitleIsNamedOnAPlainContinue: OK');
}
checkUserTitleIsNamedOnAPlainContinue();

// The bracket survives into the offseason (the season summary reads it), so a
// crowned champion stays true the whole way through. Those boundaries are
// behind us by then and must not interrupt an automated offseason.
function checkOffseasonStagesSuppressStaleBoundaries() {
  const inFreeAgency = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'OKC' }] },
    offseasonStage: 'freeagency',
    automation: { autoDraft: true, autoFreeAgency: true }
  });
  assert.strictEqual(runner.evaluateStop(inFreeAgency, 0, NO_CONTEXT), null,
    'an automated free agency is not interrupted to announce the playoffs are over');

  const atDraft = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'OKC' }] },
    offseasonStage: 'draft', draftSession: {},
    automation: { autoDraft: true, autoFreeAgency: true }
  });
  assert.strictEqual(runner.evaluateStop(atDraft, 0, NO_CONTEXT), null,
    'nor an automated draft');

  // The stages' own stops must still fire — this suppresses the stale
  // boundary, not the real decision.
  const manualFA = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'OKC' }] },
    offseasonStage: 'freeagency',
    automation: { autoDraft: true, autoFreeAgency: false }
  });
  const stop = runner.evaluateStop(manualFA, 0, NO_CONTEXT);
  assert.ok(stop && stop.reason === R.FREE_AGENCY_READY, 'an unautomated free agency still stops');

  // And with no offseason under way the boundary is the correct answer.
  const justCrowned = baseState({
    season: { games: [{ day: 0, played: true }], currentDay: 0 },
    playoffBracket: { finals: [{ winner: 'OKC' }] }
  });
  const s2 = runner.evaluateStop(justCrowned, 0, NO_CONTEXT);
  assert.ok(s2 && s2.reason === R.PLAYOFFS_COMPLETE, 'the boundary still reports when it is current');
  console.log('checkOffseasonStagesSuppressStaleBoundaries: OK');
}
checkOffseasonStagesSuppressStaleBoundaries();

// The offseason has to be escapable. Nothing outside these two rules moves
// offseasonStage on for a manual player, so if either stops unconditionally
// the save is stuck at that stage permanently.
function checkFinishedOffseasonStagesAreEscapable() {
  // handleUserDraftPick clears draftSession when the board is exhausted but
  // leaves offseasonStage at 'draft'. If that still reported draftReady, the
  // player would sit at a completed draft with no way forward.
  const drafted = baseState({ offseasonStage: 'draft', draftSession: null });
  assert.strictEqual(runner.evaluateStop(drafted, 0, NO_CONTEXT), null,
    'a completed draft no longer blocks the run');

  const midDraft = baseState({ offseasonStage: 'draft', draftSession: { results: [] } });
  const s1 = runner.evaluateStop(midDraft, 0, NO_CONTEXT);
  assert.ok(s1 && s1.reason === R.DRAFT_READY, 'but picks still waiting do');

  // Free agency has no "done" flag at all — the user decides. crossStage is
  // Continue saying so.
  const fa = baseState({ offseasonStage: 'freeagency' });
  const s2 = runner.evaluateStop(fa, 0, NO_CONTEXT);
  assert.ok(s2 && s2.reason === R.FREE_AGENCY_READY, 'free agency stops the first time');
  assert.strictEqual(runner.evaluateStop(fa, 0, { crossStage: true }), null,
    'and is escapable when the user says they are finished');

  // crossStage is for free agency only: it must not skip pending draft picks.
  assert.ok(runner.evaluateStop(midDraft, 0, { crossStage: true }).reason === R.DRAFT_READY,
    'crossStage never skips picks the user still has to make');
  console.log('checkFinishedOffseasonStagesAreEscapable: OK');
}
checkFinishedOffseasonStagesAreEscapable();

function checkContextIsOptional() {
  // The loop always passes a context, but a missing one must not throw —
  // this function is the single gate every advance runs through.
  assert.doesNotThrow(function () { runner.evaluateStop(baseState(), 0); },
    'a missing context is tolerated');
  console.log('checkContextIsOptional: OK');
}
checkContextIsOptional();

console.log('All sim runner validations passed');
