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
      traits: require('./traits.js'),
      players: require('./players-2026.js'),
      ultimates: require('./ultimates.js'),
      tradeEvaluator: require('./tradeEvaluator.js'),
      owner: require('./owner.js'),
      league: require('./league.js'),
      draft: require('./draft.js'),
      rivalries: require('./rivalries.js'),
      difficulty: require('./difficulty.js'),
      gmCareer: require('./gmCareer.js')
    }
  : {
      save: { pushSeasonSnapshot: pushSeasonSnapshot },
      gmCareer: { ensureGmCareer: ensureGmCareer, addChronicle: addChronicle,
        CHRONICLE_KINDS: CHRONICLE_KINDS },
      history: { finalizeSeasonHistory: finalizeSeasonHistory, archiveDraftClass: archiveDraftClass },
      // runOffseasonThroughDraft and generateNewSeason both live in
      // seasonTransition.js, NOT draft.js — draft.js owns the interactive
      // draft session, not the offseason pipeline.
      seasonTransition: { runOffseasonThroughDraft: runOffseasonThroughDraft, generateNewSeason: generateNewSeason },
      freeAgency: { runFreeAgencySilently: runFreeAgencySilently, autoExerciseResignRights: autoExerciseResignRights, resolveLeagueRestrictedFA: resolveLeagueRestrictedFA },
      autoGM: { autoEnforceRosterSize: autoEnforceRosterSize },
      teams: { getTeamById: getTeamById },
      owner: { reviewSeason: reviewSeason, endTenure: endTenure, setMandate: setMandate, OWNER_PATIENCE: OWNER_PATIENCE },
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll },
      draft: { playoffResultByTeam: playoffResultByTeam, playoffBracketIsComplete: playoffBracketIsComplete },
      rivalries: { recordPlayoffSeries: recordPlayoffSeries, decayRivalries: decayRivalries },
      difficulty: { patienceFor: patienceFor },
      traits: { announceSecretBadges: announceSecretBadges },
      players: { PLAYERS_2026: PLAYERS_2026 },
      ultimates: { setLeagueGate: setLeagueGate },
      tradeEvaluator: { invalidateLeagueAvgCache: invalidateLeagueAvgCache }
    };

// A playoff series is where rivalries are actually made, so the bracket is
// mined for them before it is cleared — then every pair cools by a year. Decay
// last, so a series played this spring is not immediately discounted for it.
function runRivalryRollover(gameState) {
  if (!gameState.rivalries) return;
  const bracket = gameState.playoffBracket;
  if (bracket && _ROLLOVER_DATA.draft.playoffBracketIsComplete(bracket)) {
    ['first', 'semis', 'confFinals', 'finals'].forEach(function (round) {
      (bracket[round] || []).forEach(function (series) {
        if (series.higherSeed && series.lowerSeed) {
          _ROLLOVER_DATA.rivalries.recordPlayoffSeries(gameState.rivalries, series.higherSeed, series.lowerSeed);
        }
      });
    });
  }
  _ROLLOVER_DATA.rivalries.decayRivalries(gameState.rivalries);
}

// Judges the standing mandate, moves the owner, and sacks the GM if his
// patience is gone. Assembles the facts and hands them to owner.js, which owns
// every decision — the split exists so the judgement is testable without a
// league, and this function has no opinions of its own.
function runOwnerReview(gameState, onFeed) {
  const owner = _ROLLOVER_DATA.owner;
  const teamId = gameState.userTeamId;
  if (!teamId || !gameState.gmCareer || !gameState.ownerMandate) return null;

  const team = _ROLLOVER_DATA.teams.getTeamById(teamId);
  const bracket = gameState.playoffBracket;
  // playoffResultByTeam reads bracket.finals[0].winner unconditionally, so an
  // unfinished postseason has to be treated as no postseason rather than
  // crashing the rollover.
  const complete = _ROLLOVER_DATA.draft.playoffBracketIsComplete(bracket);
  const results = complete ? _ROLLOVER_DATA.draft.playoffResultByTeam(bracket) : {};
  const reached = results[teamId];

  const review = owner.reviewSeason(gameState, {
    team: team,
    roster: _ROLLOVER_DATA.league.getTeamRoster(teamId),
    madePlayoffs: reached !== undefined,
    roundsWon: reached === undefined ? 0 : reached,
    payroll: _ROLLOVER_DATA.league.getTeamPayroll(teamId),
    capLevel: gameState.settings ? gameState.settings.capLevel : undefined,
    // The one dial difficulty actually turns today.
    maxPatience: _ROLLOVER_DATA.difficulty.patienceFor(
      _ROLLOVER_DATA.owner.OWNER_PATIENCE,
      gameState.settings ? gameState.settings.difficulty : undefined)
  });
  if (!review) return null;
  // Carried to next season's mandate: the owner does not ask a club that missed
  // the playoffs to win a series in the next one.
  gameState.lastReviewMadePlayoffs = reached !== undefined;

  onFeed(review.met
    ? 'The owner is satisfied: you were asked to ' + review.mandate.label + ', and ' + review.detail + '.'
    : 'The owner is not happy. You were asked to ' + review.mandate.label + ' — ' + review.detail + '.');

  if (review.fired) {
    owner.endTenure(gameState.gmCareer, teamId, gameState.leagueYear || 2026);
    gameState.firedAtEndOfSeason = { teamId: teamId, leagueYear: gameState.leagueYear || 2026 };
    onFeed('You have been relieved of your duties by the ' + team.name + '.');
  } else if (!review.met) {
    onFeed('One more season like that and the job is gone.');
  }
  return review;
}

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

// A career ending is news. Which career it was decides how loudly.
//
// A club legend leaving on your watch also belongs in YOUR record — the GM
// chronicle already holds every press answer you have given, and "the greatest
// player you ever employed retired" is at least as much a part of a tenure as
// what you said about a losing streak.
const RETIREMENT_HEADLINE_OVERALL = 78;
const RETIREMENT_LEGEND_OVERALL = 86;

function announceRetirements(gameState, retirees, onFeed) {
  if (!Array.isArray(retirees) || retirees.length === 0) return 0;
  const year = gameState.leagueYear || 2026;
  let announced = 0;

  retirees.slice()
    .sort(function (a, b) { return b.overall - a.overall; })
    .forEach(function (r) {
      const wasOurs = r.teamId && r.teamId === gameState.userTeamId;
      // Everyone worth a headline, plus anyone who played for the user
      // regardless of rating — the twelfth man on your own bench retiring is
      // still your news, even if the league does not care.
      if (r.overall < RETIREMENT_HEADLINE_OVERALL && !wasOurs) return;

      // Two numbers, two provenances, and they may not be mixed. Career LENGTH
      // comes from yearsPro and covers the player's whole life; POINTS come
      // from careerStats and cover only the seasons this save simulated.
      // Quoting them together produced "Mike Conley — 20 seasons, 507 career
      // points", which is wrong twice over: it undersells the career and
      // misreports the total. So the points are only spoken when this save
      // watched the whole career — otherwise the length stands on its own.
      const knowsWholeCareer = r.simSeasons >= r.seasons;
      const career = r.seasons > 0
        ? (knowsWholeCareer && r.points > 0
            ? r.seasons + ' seasons, ' + r.points.toLocaleString() + ' career points'
            : r.seasons + ' seasons in the league')
        : 'a short career';
      const rings = r.titles > 0 ? ', ' + r.titles + (r.titles === 1 ? ' ring' : ' rings') : '';
      const verb = r.overall >= RETIREMENT_LEGEND_OVERALL ? ' retires' : ' calls it a career';
      onFeed(r.name + verb + ' at ' + r.age + ' — ' + career + rings + '.');
      announced += 1;

      if (wasOurs && r.overall >= RETIREMENT_HEADLINE_OVERALL) {
        const gmCareer = _ROLLOVER_DATA.gmCareer.ensureGmCareer(gameState);
        if (gmCareer) {
          _ROLLOVER_DATA.gmCareer.addChronicle(gmCareer, year,
            _ROLLOVER_DATA.gmCareer.CHRONICLE_KINDS.PRESS,
            r.name + ' retired a ' + (r.titles > 0 ? 'champion' : 'one-club man') +
            (r.seasons > 0 ? ' after ' + r.seasons + ' seasons.' : '.'));
        }
      }
    });
  return announced;
}

function runOffseasonRollover(gameState, deps) {
  const d = deps || {};
  const onFeed = d.onFeed || function () {};

  _ROLLOVER_DATA.save.pushSeasonSnapshot(gameState);

  // The offseason below retires players out of PLAYERS_2026, so any offer
  // still in the inbox can name someone who no longer exists.
  gameState.tradeOffers = [];
  // Last offseason's outcomes belong to last offseason.
  gameState.freeAgencyLog = [];

  _ROLLOVER_DATA.history.finalizeSeasonHistory(gameState.leagueYear || 2026, gameState.playoffBracket, onFeed);

  // Before the year increments and the bracket is cleared — the review reads
  // both. This is what stops ownerHappiness being a spending thermostat: until
  // now every write to it came from the luxury tax, so the owner did not know
  // the score.
  runOwnerReview(gameState, onFeed);
  runRivalryRollover(gameState);

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
      gameState.leagueYear, gameState.settings.lotteryFormat, gameState.userTeamId);
    announceRetirements(gameState, draftResult.retirees, onFeed);
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

  // BEFORE the first value consumer below, not only at the end of the
  // rollover: progression, retirements and the draft just rewrote the pool,
  // and free agency's signing decisions read the league-average rawOverall
  // through the trade evaluator. Priming its cache from LAST season's pool
  // here is what made the rollover golden diverge when the cache landed.
  _ROLLOVER_DATA.tradeEvaluator.invalidateLeagueAvgCache();

  // The user's own expiring players were deferred rather than decided for
  // them, so this path — which runs unattended — has to answer for them before
  // the market opens, or an automated save quietly loses every star it was
  // meant to keep. Anyone the offer does not hold onto is released here.
  _ROLLOVER_DATA.freeAgency.autoExerciseResignRights(gameState.userTeamId, gameState.rng);
  // The rest of the league's restricted players were parked so the GM could
  // raid them; unattended, nobody did, so every incumbent answers the rival
  // sheet it was already facing. Must run BEFORE the open market, or a parked
  // player would still be holding a roster spot nobody could sign into.
  _ROLLOVER_DATA.freeAgency.resolveLeagueRestrictedFA(gameState.userTeamId);
  _ROLLOVER_DATA.freeAgency.runFreeAgencySilently(gameState.rng);
  _ROLLOVER_DATA.autoGM.autoEnforceRosterSize(_ROLLOVER_DATA.teams.getTeamById(gameState.userTeamId));

  let careerSceneShown = false;
  if (d.onCareerFollowup) careerSceneShown = !!d.onCareerFollowup();

  const seasonResult = _ROLLOVER_DATA.seasonTransition.generateNewSeason(
    gameState.rng, gameState.leagueYear);
  gameState.season = { games: seasonResult.games, currentDay: -1 };
  gameState.upcomingDraftClass = seasonResult.nextDraftClass;

  // Next season's mandate, set now rather than at tip-off, so the GM has the
  // whole offseason to build toward it. The roster snapshot for a `develop`
  // mandate is taken here too — it has to predate the season it judges.
  if (gameState.userTeamId && gameState.gmCareer) {
    _ROLLOVER_DATA.owner.setMandate(
      gameState,
      _ROLLOVER_DATA.teams.getTeamById(gameState.userTeamId),
      _ROLLOVER_DATA.league.getTeamRoster(gameState.userTeamId),
      gameState.rng,
      { payroll: _ROLLOVER_DATA.league.getTeamPayroll(gameState.userTeamId),
        capLevel: gameState.settings ? gameState.settings.capLevel : undefined,
        madePlayoffsLastYear: gameState.lastReviewMadePlayoffs });
  }
  gameState.playoffBracket = null;
  gameState.offseasonStage = null;
  gameState.allStarWeekend = null;
  // Day-stamped, and the day counter restarts — see script.js's initSeason.
  gameState.seasonSceneDays = {};
  gameState.seasonSceneCounts = {};
  gameState.lastMidSeasonSceneDay = null;

  // Re-anchor the ultimate gate to the NEW player population. It is rank-based
  // — the 36th best player — because the league's rating distribution drifts
  // upward as generated players replace the 2026 roster. Held at a fixed 85,
  // holders grew from 36 to 75 over twenty seasons and took league scoring and
  // the scoring leader up with them, while season one still looked perfect.
  //
  // Here, at the end of the rollover, because this is the point where retirees
  // have gone, rookies have arrived and progression has been applied — the
  // population the coming season will actually be played with.
  _ROLLOVER_DATA.ultimates.setLeagueGate(_ROLLOVER_DATA.players.PLAYERS_2026);
  // Same boundary, same reason: the trade evaluator's cached league-average
  // rawOverall goes stale exactly when the population changes.
  _ROLLOVER_DATA.tradeEvaluator.invalidateLeagueAvgCache();

  return { careerSceneShown: careerSceneShown, stoppedAfterDraft: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    announceRetirements: announceRetirements, runOffseasonRollover: runOffseasonRollover };
}
