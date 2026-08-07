// The stop policy behind Continue: given league state, should the advance
// loop halt, and what should it say?
//
// Deliberately pure — no DOM, no timers, no globals. The two inputs that are
// NOT derivable from league state (the Skip-to target, and whether the user
// pressed Stop) arrive through `context`, which is what makes every rule here
// a plain input/output case rather than something needing a browser to test.
// ui/simControls.js owns the loop; this file owns the rules.
//
// One control replaced ten, and the ten had inconsistent stopping behaviour
// because each carried its own. Centralising the rules here is what lets
// Continue and every Skip-to target share a single code path.
const STOP_REASONS = {
  USER_STOP: 'userStop',
  DRAFT_READY: 'draftReady',
  FREE_AGENCY_READY: 'freeAgencyReady',
  SEASON_COMPLETE: 'seasonComplete',
  PLAYOFFS_COMPLETE: 'playoffsComplete',
  TARGET_REACHED: 'targetReached',
  NOTABLE_EVENT: 'notableEvent'
};

function _allGamesPlayed(season) {
  return !!season && season.games.every(function (g) { return g.played; });
}

function _championCrowned(bracket) {
  return !!(bracket && bracket.finals && bracket.finals[0] && bracket.finals[0].winner);
}

function _championIs(bracket, teamId) {
  return _championCrowned(bracket) && bracket.finals[0].winner === teamId;
}

// Targets that deliberately run past season boundaries. "5 seasons" and
// "until I win a title" both mean "keep rolling", so for them the two
// boundary stops below are not stops at all — they are the thing being
// skipped. Every other stop (an unautomated draft, a key injury, the user
// pressing Stop) still applies: per the design, a skip halts early for a
// decision rather than blowing past it.
function _targetSpansSeasons(target) {
  return !!target &&
    (target.kind === 'seasons' || target.kind === 'championship' || target.kind === 'stage');
}

// Returns { reason, label } or null.
//
// The order below IS the priority order and it matters. A user pressing Stop
// must win over every automatic reason, or their click looks ignored while
// some unrelated reason is reported instead.
function evaluateStop(gameState, dayIndex, context) {
  const ctx = context || {};
  const target = ctx.target || null;

  if (ctx.userStopRequested) {
    return { reason: STOP_REASONS.USER_STOP, label: 'Stopped' };
  }

  // Decisions the player has not delegated. Checked before the boundaries
  // below so the offseason stages report what is waiting rather than the
  // stage transition that got there.
  const auto = gameState.automation || {};
  // A live draftSession means picks are still waiting on the user. Once it is
  // gone the draft is finished and there is nothing left to decide, so the
  // stage becomes crossable — without this a manual drafter is stranded at a
  // completed draft forever, because nothing else moves offseasonStage on.
  if (gameState.offseasonStage === 'draft' && !auto.autoDraft && gameState.draftSession) {
    return { reason: STOP_REASONS.DRAFT_READY, label: 'Draft is ready' };
  }
  // Free agency has no equivalent "done" signal — the user signs whoever they
  // want and stops when they feel like it. ctx.crossStage is that signal:
  // Continue pressed while already looking at the free agency view means
  // "I'm finished here", so the run may proceed into the new season.
  if (gameState.offseasonStage === 'freeagency' && !auto.autoFreeAgency && !ctx.crossStage) {
    return { reason: STOP_REASONS.FREE_AGENCY_READY, label: 'Free agency is open' };
  }

  // Multi-season targets are checked before the boundary stops they are
  // meant to run through.
  if (target && target.kind === 'championship' && _championIs(gameState.playoffBracket, gameState.userTeamId)) {
    return { reason: STOP_REASONS.TARGET_REACHED, label: 'You won the title' };
  }
  if (target && target.kind === 'seasons' && (gameState.leagueYear || 0) >= target.untilYear) {
    return { reason: STOP_REASONS.TARGET_REACHED, label: 'Reached ' + (target.label || 'your target') };
  }
  // "Skip to Draft" / "Skip to Free Agency": run the season and postseason out,
  // roll over, and stop at the named stage. The draftReady/freeAgencyReady
  // rules above usually fire first and with a better label; this exists for
  // the case where that stage is automated and so never reports itself.
  if (target && target.kind === 'stage' && gameState.offseasonStage === target.stage) {
    return { reason: STOP_REASONS.TARGET_REACHED, label: 'Reached ' + (target.label || 'your target') };
  }

  // The boundary stops below describe a place the league is PARKED at, not an
  // event. Once the run halts at one, the state that caused it is still true,
  // so re-checking it on the next Continue would halt again having simulated
  // nothing — Continue would be a dead button at exactly the moments the
  // design says it should read "Continue -> Playoffs" / "-> Offseason".
  // ctx.crossBoundary is the loop saying "the user pressed Continue while
  // standing here; step across". It is deliberately narrow: it suppresses only
  // these two, and only on the run's first check. An unautomated draft is NOT
  // included — that one is a decision the player has to actually make.
  // ...and not once an offseason stage is under way. The bracket is not
  // cleared until the new season is generated, so a crowned champion stays
  // true for the whole offseason; without this, Continue halts in free agency
  // to announce "Playoffs are over" — stale by an entire offseason, and an
  // extra press for nothing. The stages have their own stops above.
  if (!_targetSpansSeasons(target) && !ctx.crossBoundary && !gameState.offseasonStage) {
    // A crowned champion outranks "season complete": once a bracket exists the
    // regular season is trivially complete too, and reporting that would be
    // stale by a whole postseason.
    if (_championCrowned(gameState.playoffBracket)) {
      return {
        reason: STOP_REASONS.PLAYOFFS_COMPLETE,
        // Worth naming. The old fast-forward loop said "You won the title" and
        // losing that on the one result the player most wants acknowledged
        // would make the biggest moment in a save the blandest.
        label: _championIs(gameState.playoffBracket, gameState.userTeamId)
          ? 'You won the title' : 'Playoffs are over'
      };
    }
    if (!gameState.playoffBracket && _allGamesPlayed(gameState.season)) {
      return { reason: STOP_REASONS.SEASON_COMPLETE, label: 'Regular season is over' };
    }
  }

  if (target && target.kind === 'day' && dayIndex >= target.day) {
    return { reason: STOP_REASONS.TARGET_REACHED, label: 'Reached ' + (target.label || 'your target') };
  }

  // Set by handleDayComplete for the events the player flagged in Settings.
  // Last because it is the softest reason: an injury matters, but not more
  // than the user asking to stop or a decision actively waiting on them.
  if (gameState.pauseRequested) {
    return {
      reason: STOP_REASONS.NOTABLE_EVENT,
      label: gameState.pauseReason || 'Something needs your attention'
    };
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STOP_REASONS: STOP_REASONS, evaluateStop: evaluateStop };
}
