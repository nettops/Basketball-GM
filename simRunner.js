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
  if (gameState.offseasonStage === 'draft' && !auto.autoDraft) {
    return { reason: STOP_REASONS.DRAFT_READY, label: 'Draft is ready' };
  }
  if (gameState.offseasonStage === 'freeagency' && !auto.autoFreeAgency) {
    return { reason: STOP_REASONS.FREE_AGENCY_READY, label: 'Free agency is open' };
  }

  // A crowned champion outranks "season complete": once a bracket exists the
  // regular season is trivially complete too, and reporting that would be
  // stale by a whole postseason.
  if (_championCrowned(gameState.playoffBracket)) {
    return { reason: STOP_REASONS.PLAYOFFS_COMPLETE, label: 'Playoffs are over' };
  }
  if (!gameState.playoffBracket && _allGamesPlayed(gameState.season)) {
    return { reason: STOP_REASONS.SEASON_COMPLETE, label: 'Regular season is over' };
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
