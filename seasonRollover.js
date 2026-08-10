// The ONE implementation of season -> offseason -> new season.
//
// This logic existed twice: once in ui/simControls.js's runMultiSeason (the
// fast-forward path, which rolls all the way into the next season) and once
// in script.js's handleAdvanceToOffseason (the manual path, which stops at
// the draft). The comments in both explicitly noted the other existed. Two
// implementations of a league's most destructive operation is how a
// fast-forward silently diverges from a manual advance — duplicate draftees,
// history counted twice, a year counter that drifts.
//
// Extracted to the root rather than left in ui/ so Node can require it: the
// browser file it came from calls into the DOM, which is exactly why this
// logic was never testable.
var _ROLLOVER_DATA = (typeof require !== 'undefined')
  ? {
      save: require('./save.js'),
      history: require('./history.js'),
      seasonTransition: require('./seasonTransition.js'),
      freeAgency: require('./freeAgency.js'),
      autoGM: require('./autoGM.js'),
      teams: require('./teams.js'),
      traits: require('./traits.js')
    }
  : {
      save: { pushSeasonSnapshot: pushSeasonSnapshot },
      history: { finalizeSeasonHistory: finalizeSeasonHistory, archiveDraftClass: archiveDraftClass },
      // runOffseasonThroughDraft and generateNewSeason both live in
      // seasonTransition.js, NOT draft.js — draft.js owns the interactive
      // draft session, not the offseason pipeline.
      seasonTransition: { runOffseasonThroughDraft: runOffseasonThroughDraft, generateNewSeason: generateNewSeason },
      freeAgency: { runFreeAgencySilently: runFreeAgencySilently },
      autoGM: { autoEnforceRosterSize: autoEnforceRosterSize },
      teams: { getTeamById: getTeamById },
      traits: { announceSecretBadges: announceSecretBadges }
    };

// Rolls a completed season into the next one: archives history, runs the
// draft, then (unless stopped) free agency and a fresh schedule.
//
// deps.onFeed receives feed lines. deps.onCareerFollowup runs player-career
// mode's own offseason step and returns true if it put a scene on screen the
// user must acknowledge. deps.onDraft, when given, resolves the draft in
// place of the automatic pipeline. All three are injected rather than called
// directly because they reach into script.js and the DOM — this module stays
// free of both so it remains testable in Node.
//
// deps.stopAfterDraft stops once the draft is done, leaving offseasonStage at
// 'draft'. That is the manual path; without it the rollover continues through
// free agency into a fresh schedule.
function runOffseasonRollover(gameState, deps) {
  const d = deps || {};
  const onFeed = d.onFeed || function () {};

  _ROLLOVER_DATA.save.pushSeasonSnapshot(gameState);

  // The offseason below retires players out of PLAYERS_2026, so any offer
  // still in the inbox can name someone who no longer exists.
  gameState.tradeOffers = [];

  _ROLLOVER_DATA.history.finalizeSeasonHistory(gameState.leagueYear || 2026, gameState.playoffBracket, onFeed);

  // setLeagueYear lives in script.js, which Node cannot load. Both writes are
  // done here because league.js reads settings.leagueYear and has no access
  // to the GameState global — they must not drift apart.
  gameState.leagueYear = (gameState.leagueYear || 2026) + 1;
  if (gameState.settings) gameState.settings.leagueYear = gameState.leagueYear;

  // The draft is the ONE step that legitimately differs between callers, and
  // it differs because the user chose it in Settings: with autoDraft off the
  // manual path builds an interactive session for them to pick from instead
  // of resolving every pick itself. That is a real difference, unlike the
  // accidental duplication this module exists to remove — so it is an
  // injected strategy rather than a second copy of the whole rollover.
  // deps.onDraft owns setting lastDraftResults/draftSession and archiving.
  if (d.onDraft) {
    d.onDraft(gameState);
  } else {
    const draftResult = _ROLLOVER_DATA.seasonTransition.runOffseasonThroughDraft(
      gameState.playoffBracket, gameState.rng, gameState.upcomingDraftClass,
      gameState.leagueYear, gameState.settings.lotteryFormat);
    // Both offseason routes announce these. The manual-draft path calls
    // runOffseasonPreDraft itself (script.js) and reports there; this is the
    // fast-forward path, the one that runs unattended, where a silent
    // evolution would simply never be noticed.
    _ROLLOVER_DATA.traits.announceSecretBadges(draftResult.secretBadges, onFeed);
    gameState.lastDraftResults = draftResult.draftResults;
    // A session left over from an abandoned manual draft would otherwise
    // still point at prospects that have just been drafted for real.
    gameState.draftSession = null;
    _ROLLOVER_DATA.history.archiveDraftClass(gameState.leagueYear, draftResult.draftResults);
  }

  // The manual path stops here and hands the user their draft; the
  // fast-forward path continues into the new season. Everything above ran
  // identically for both, which is the entire point of this module.
  if (d.stopAfterDraft) {
    gameState.offseasonStage = 'draft';
    return { careerSceneShown: false, stoppedAfterDraft: true };
  }

  _ROLLOVER_DATA.freeAgency.runFreeAgencySilently(gameState.rng);
  _ROLLOVER_DATA.autoGM.autoEnforceRosterSize(_ROLLOVER_DATA.teams.getTeamById(gameState.userTeamId));

  let careerSceneShown = false;
  if (d.onCareerFollowup) careerSceneShown = !!d.onCareerFollowup();

  const seasonResult = _ROLLOVER_DATA.seasonTransition.generateNewSeason(gameState.rng);
  gameState.season = { games: seasonResult.games, currentDay: -1 };
  gameState.upcomingDraftClass = seasonResult.nextDraftClass;
  gameState.playoffBracket = null;
  gameState.offseasonStage = null;
  gameState.allStarWeekend = null;

  return { careerSceneShown: careerSceneShown, stoppedAfterDraft: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runOffseasonRollover: runOffseasonRollover };
}
