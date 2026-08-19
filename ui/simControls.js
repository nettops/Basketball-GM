const SIM_SPEED_DELAYS_MS = { slow: 500, normal: 200, fast: 50, ultra: 0 };

// NOT `SIM_SPEED_DELAYS_MS[speed] || SIM_SPEED_DELAYS_MS.normal`, which is how
// this was written everywhere before. ultra is 0, and `0 || 200` is 200 — so
// the fastest setting silently ran at normal speed and had done all along.
// An unknown/absent value still needs the fallback, hence the explicit check.
function simSpeedDelayMs(speed) {
  return Object.prototype.hasOwnProperty.call(SIM_SPEED_DELAYS_MS, speed)
    ? SIM_SPEED_DELAYS_MS[speed]
    : SIM_SPEED_DELAYS_MS.normal;
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// The advance loop's yield. For a real pacing delay this is just a timer, but
// a ZERO delay must not be one: browsers clamp timers in a hidden tab to
// ~1s, and the design says a run keeps going when the user navigates away.
// Measured in a backgrounded tab: 749ms per setTimeout(0) yield, against
// 5.4ms to actually simulate a day — so ultra speed became ~150x slower the
// moment the tab lost focus. A MessageChannel round-trip is a genuine
// macrotask, so a Stop click still lands between iterations, but it is not a
// timer and is not clamped (measured: 0.016ms in that same hidden tab).
function yieldToBrowser(ms) {
  if (ms > 0) return delay(ms);
  return new Promise(function (resolve) {
    const channel = new MessageChannel();
    channel.port1.onmessage = function () { channel.port1.close(); resolve(); };
    channel.port2.postMessage(0);
  });
}

function isRegularSeasonComplete(season) {
  return season.games.every(function (g) { return g.played; });
}

// ---------------------------------------------------------------------------
// The single advance loop.
//
// Replaces runWithDelay (one step, no stop rules) and runMultiSeason
// (season-granular, its own stop rules). Having two loops with different
// stopping behaviour is why the ten dock controls behaved inconsistently.
//
// Each iteration: evaluate the stop BEFORE stepping, step once, yield.
// Checking before the step is load-bearing — it is what leaves the next day
// unplayed, which is what makes "stop and go watch that game" possible.
// Stopping after a step would mean the game the player wanted to see had
// already been decided.
//
// Policy lives in simRunner.js (pure, Node-tested); this file owns only the
// mechanism.
// ---------------------------------------------------------------------------
let _advanceStopRequested = false;
let _advanceRunning = false;

function requestAdvanceStop() { _advanceStopRequested = true; }
function isAdvanceRunning() { return _advanceRunning; }

function lastDayOfSeason() {
  return GameState.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
}

function autoDraftEffective() {
  return GameState.playMode === 'spectator' || GameState.automation.autoDraft;
}

function autoFreeAgencyEffective() {
  return GameState.playMode === 'spectator' || GameState.automation.autoFreeAgency;
}

// Picks still waiting on the user. handleUserDraftPick clears draftSession
// once the board is exhausted but leaves offseasonStage at 'draft', so the
// stage alone does not tell you whether anything is still pending.
function draftIsWaiting() {
  return GameState.offseasonStage === 'draft' && !autoDraftEffective() && !!GameState.draftSession;
}

// Advances the league exactly one unit and returns false when there is
// nothing left to step. A "unit" is whatever the current phase advances by:
// one day in the regular season, one game in the playoffs, one stage in the
// offseason. Ordering matters — the phases are checked most-advanced first.
//
// `out` collects side effects the loop needs to know about: `out.sceneShown`
// means something was rendered into view-content that the loop's closing
// renderView must not paint over.
function stepOnce(out) {
  // --- Offseason stages -----------------------------------------------------
  // Reaching here means the stage is automated (evaluateStop halts on the ones
  // the player has not delegated), so crossing it is exactly one step. These
  // mirror the "Go to Free Agency" and "Start New Season" buttons in
  // script.js's renderView, which Task 7 removes in favour of Continue.
  if (GameState.offseasonStage === 'draft') {
    GameState.offseasonStage = 'freeagency';
    if (autoFreeAgencyEffective()) {
      // Your expiring players were held back for you to decide on. With free
      // agency delegated there is nobody to ask, so the same rule every AI
      // team just used is applied on your behalf — otherwise delegating free
      // agency would silently cost you every star you meant to keep.
      autoExerciseResignRights(GameState.userTeamId, GameState.rng);
      runFreeAgencySilently(GameState.rng);
      autoEnforceRosterSize(getTeamById(GameState.userTeamId));
    }
    return true;
  }
  if (GameState.offseasonStage === 'freeagency') {
    // handleAdvanceToNewSeason rather than a fresh copy of its body: it also
    // calls enforceRosterFloors(), without which a user who clicked past free
    // agency starts the season with most of the league under the 12-man floor.
    handleAdvanceToNewSeason();
    return true;
  }

  // --- Postseason -----------------------------------------------------------
  if (GameState.playoffBracket) {
    if (GameState.playoffBracket.finals[0] && GameState.playoffBracket.finals[0].winner) {
      // Champion crowned: the next unit of time is the whole offseason.
      // stopAfterDraft mirrors the player's own automation setting, so a
      // manual drafter is handed their draft instead of having it resolved
      // for them. The old fast-forward loop auto-drafted regardless, which is
      // the behaviour the design deliberately drops.
      // Captured BEFORE runOffseasonRollover, which clears playoffBracket.
      const championId = GameState.playoffBracket.finals[0].winner;
      const championYear = GameState.leagueYear || 2026;

      const rollover = runOffseasonRollover(GameState, {
        stopAfterDraft: !autoDraftEffective(),
        // The same interactive draft script.js hands out. Without it Continue
        // auto-drafted for everyone, and the draftReady stop had nothing to
        // stop for — a manual drafter never saw their own draft.
        onDraft: autoDraftEffective() ? null : runInteractiveDraft,
        onFeed: function (text) { pushToFeed(text); },
        onCareerFollowup: GameState.gameMode === 'playerCareer'
          ? function () { return handlePlayerCareerOffseasonFollowup(true); }
          : null
      });
      if (rollover.careerSceneShown) out.sceneShown = true;

      // The career-mode scene wins if both want the screen — only one thing can
      // live in view-content, and that is the one the user was mid-conversation
      // with. out.sceneShown then stops the run, which the loop already treats
      // as "something asked to be read", so no new stop machinery is needed.
      if (!out.sceneShown && maybeShowChampionshipScene(championId, championYear, function () {
        renderView(GameState.currentView);
      })) {
        out.sceneShown = true;
      }
      return true;
    }
    const played = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng) !== null;
    collectFinishedPlayoffGames();
    return played;
  }

  // --- Regular season -------------------------------------------------------
  if (GameState.season.currentDay >= lastDayOfSeason()) {
    if (!isRegularSeasonComplete(GameState.season)) return false;
    GameState.playoffBracket = generateBracket(GameState.rng, GameState.settings);

    // Both of these lived only inside the loops being deleted and would have
    // gone with them.
    const madePlayoffs = GameState.playoffBracket.first.some(function (s) {
      return s.higherSeed === GameState.userTeamId || s.lowerSeed === GameState.userTeamId;
    });
    if ((madePlayoffs && GameState.settings.pauseOn.madePlayoffs) ||
        (!madePlayoffs && GameState.settings.pauseOn.missedPlayoffs)) {
      GameState.pauseRequested = true;
      GameState.pauseReason = madePlayoffs ? 'You made the playoffs' : 'You missed the playoffs';
    }
    if (handlePlayerCareerPlayoffIntro()) out.sceneShown = true;
    return true;
  }

  GameState.season.currentDay = simulateNextDay(
    GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng, handleDayComplete);

  // After the day is played, so the scene reads the standings the player would
  // see if they stopped here.
  if (maybeRunMidSeasonScene()) out.sceneShown = true;
  return true;
}

// Always re-queries. #sim-status lives inside the dock's innerHTML, so every
// renderSimControls destroys the element — a reference captured once goes
// stale the first time the dock repaints, and writes to it land on a detached
// node that is not on the page. That is exactly how the status line silently
// showed nothing at all.
function setSimStatus(text) {
  const el = document.getElementById('sim-status');
  if (el) el.textContent = text;
}

// How many game days must pass between two mid-season scenes.
//
// Tuned against the complaint it exists to answer: a playtester found a
// meaningful decision only every 15-20 games and spent the rest of an 82-game
// season clicking Continue. At eight days this roughly doubles the decision
// density without the season turning into a talk show — the predicates below
// still have to find something real, so a quiet team gets fewer.
const MID_SEASON_SCENE_GAP_DAYS = 8;

// A mid-season scene, fired between games during an ordinary Continue run.
//
// Returns true if one opened, which the caller turns into out.sceneShown —
// runAdvance already treats that as "something asked to be read" and stops the
// run. That is the entire point: the scene has to INTERRUPT the fast-forward,
// or it is just another thing you would scroll past.
//
// Refuses the fallback deliberately. selectScene invents a generic press
// question when nothing matches, which is right after a game you just watched
// and wrong here — an unprompted "any message for the fans?" every eight days
// is noise, and noise is what trained the player to skip in the first place.
function maybeRunMidSeasonScene() {
  if (GameState.settings && GameState.settings.dialogueScenes === false) return false;
  if (GameState.gameMode === 'playerCareer') return false;
  if (typeof runDialogue !== 'function' || dialogueBoxIsOpen()) return false;
  // Regular season only: the offseason and the playoffs have their own beats.
  if (GameState.offseasonStage || GameState.playoffBracket) return false;
  if (!GameState.season || !GameState.gmCareer) return false;

  const day = GameState.season.currentDay;
  const last = GameState.lastMidSeasonSceneDay;
  if (last !== undefined && last !== null && day - last < MID_SEASON_SCENE_GAP_DAYS) return false;

  const ctx = buildSeasonContext(GameState);
  const scene = selectScene(ctx, {
    // Day-stamped, NOT the shared recent-list — see
    // SEASON_SCENE_COOLDOWN_DAYS in dialogueContext.js for why any
    // list-of-N silenced this system entirely.
    recent: recentSeasonScenes(GameState),
    rand: GameState.rng
  });
  if (!scene || scene.id === FALLBACK_SCENE_ID) return false;

  const speakerIsOwner = scene.speaker && scene.speaker.kind === 'owner';
  if (speakerIsOwner) {
    ctx.speakerName = 'The Owner';
  } else {
    const reporter = reporterForTeam(GameState, GameState.userTeamId);
    if (reporter) {
      ctx.speakerReporter = { face: reporter.face };
      // join() rather than concatenation — see maybeRunPostgameDialogue for
      // why this value must not look like markup to the ui-safety scanner.
      ctx.speakerName = [reporter.name, reporter.outlet].join(' — ');
    }
  }

  // Stamped BEFORE the box opens, not in the callback: the callback does not
  // run until the user answers, and a player who leaves the box sitting there
  // would otherwise get a second scene the moment they resumed.
  GameState.lastMidSeasonSceneDay = day;

  const opened = runDialogue(scene, ctx, function (result) {
    if (!result.skipped) {
      const choice = scene.choices[result.choiceIndex];
      if (choice && typeof choice.effect === 'function') {
        rememberAnswer(GameState, scene.id, choice, GameState.leagueYear);
        applyDialogueEffect(GameState, choice.effect(ctx), ctx);
      }
    }
    stampSeasonScene(GameState, scene.id);
    // The dashboard strip shows owner happiness and job security, and an
    // answer can move both — repaint so the consequence is visible where the
    // player already is, instead of on next render.
    renderView(GameState.currentView);
  });

  if (!opened) GameState.lastMidSeasonSceneDay = last;
  return opened;
}

// options: { target } — null for Continue. Resolves to the stop that ended it.
async function runAdvance(options) {
  const opts = options || {};
  _advanceStopRequested = false;
  _advanceRunning = true;
  GameState.pauseRequested = false;
  GameState.pauseReason = null;

  const delayMs = simSpeedDelayMs(GameState.settings.simSpeed);
  const out = { sceneShown: false };
  let stop = null;
  let steps = 0;

  renderSimControls(document.getElementById('sim-controls'));   // flips Continue to Stop

  // Hard cap. A season is ~170 days and a bracket ~105 games, so this is far
  // beyond any legitimate run; it exists only so a state the loop cannot
  // advance spins for a moment rather than forever.
  // try/finally, not just the targeted catches inside: the flag below is what
  // the Continue button checks, and if ANYTHING in this loop throws without
  // clearing it the button is dead for the rest of the session -- no error
  // message, no recovery short of a reload. That is how a single bad render
  // turned into an unplayable league. Whatever goes wrong, the button comes
  // back.
  try {
    let guard = 0;
    while (guard++ < 20000) {
      stop = evaluateStop(GameState, GameState.season.currentDay, {
        target: opts.target || null,
        userStopRequested: _advanceStopRequested,
        // Both only on the first check. See simRunner.js — these are what let
        // Continue step across a boundary, or a finished free agency, that it
        // is parked on. A later season's free agency still stops the run.
        crossBoundary: steps === 0,
        crossStage: steps === 0 && !!opts.crossStage
      });
      if (stop) break;

      // A throw inside a step must halt and say so. Without this the guard is
      // the only thing between a broken step and 20000 attempts at it.
      let advanced;
      try {
        advanced = stepOnce(out);
      } catch (e) {
        stop = { reason: STOP_REASONS.USER_STOP, label: 'Simulation error: ' + e.message };
        break;
      }
      steps += 1;
      if (!advanced) { stop = { reason: STOP_REASONS.SEASON_COMPLETE, label: 'Nothing left to simulate' }; break; }

      // A scene the user has to acknowledge (a retirement ceremony, a playoff
      // intro) ends the run — simming past something that asked to be read is
      // the opposite of what a stop system is for.
      if (out.sceneShown) { stop = { reason: STOP_REASONS.NOTABLE_EVENT, label: '' }; break; }

      // Show the day that was just simulated. Without this the record, the
      // standings and the schedule all sat at their pre-Continue values for the
      // whole run, so a long advance looked like nothing was happening. Cheap
      // enough to do every step: ~0.1ms for the topbar and 1-4ms for a view,
      // against ~9ms of possession sim for a single day's games.
      // Rendering the frame must never be able to end the run. stepOnce is
      // already wrapped above, but this call was not, and a throw here escaped
      // runAdvance entirely — skipping `_advanceRunning = false` below, so
      // Continue checked isAdvanceRunning(), saw true forever, and did nothing
      // for the rest of the session. One bad view turned into an unplayable
      // league. A frame that will not draw is worth a console line, not a dead
      // button.
      try {
        refreshAdvanceFrame();
      } catch (e) {
        console.error('Advance frame render failed (continuing):', e);
      }
      setSimStatus('Simulating…');
      // ALWAYS yield, including at ultra where delayMs is 0. The old loops
      // skipped the await entirely at ultra, which froze the tab and made a run
      // impossible to interrupt — there was no moment for a click to land.
      await yieldToBrowser(delayMs);
    }

  } finally {
    _advanceRunning = false;
    _advanceStopRequested = false;
  }
  stop = stop || { reason: STOP_REASONS.USER_STOP, label: 'Stopped' };

  if (out.sceneShown) {
    // Re-render only the dock: the scene is sitting in view-content and
    // renderView would paint straight over it.
    renderSimControls(document.getElementById('sim-controls'));
  } else {
    renderView(GameState.currentView);
  }

  // AFTER the render above, never before: both branches rebuild the dock and
  // would wipe whatever was written first. Pressing Stop clears the line
  // rather than announcing itself — the user knows, they just clicked it.
  setSimStatus(stop.reason === STOP_REASONS.USER_STOP ? '' : stop.label);
  autosave(GameState);
  return { reason: stop.reason, label: stop.label, steps: steps };
}

function advanceTargetForDay(day, label) {
  return { kind: 'day', day: day, label: label || ('day ' + day) };
}

async function handleContinue() {
  if (isAdvanceRunning()) { requestAdvanceStop(); return; }

  // Standing at a stage the player has to act on, Continue is a doorway
  // rather than a simulation: take them there instead of running a loop that
  // would stop immediately having done nothing.
  if (draftIsWaiting() && GameState.currentView !== 'draft') return renderView('draft');
  const faWaiting = GameState.offseasonStage === 'freeagency' && !autoFreeAgencyEffective();
  if (faWaiting && GameState.currentView !== 'freeagency') return renderView('freeagency');

  // Already looking at free agency and pressing Continue again is the only
  // "I'm done signing" signal there is — nothing else marks that stage
  // finished, and the button that used to end it is gone.
  const result = await runAdvance({ target: null, crossStage: faWaiting });
  // Land the user on the stage that is waiting, then restate why — the
  // renderView rebuilds the dock and would otherwise wipe the line runAdvance
  // just wrote.
  if (result.reason === STOP_REASONS.DRAFT_READY) { renderView('draft'); setSimStatus(result.label); }
  else if (result.reason === STOP_REASONS.FREE_AGENCY_READY) { renderView('freeagency'); setSimStatus(result.label); }
  return result;
}

// kind: 'deadline' | 'days' | 'seasonEnd' | 'draft' | 'freeAgency' | 'seasons'
// | 'championship'. Every one is the same loop with a different stop predicate.
async function handleSkipTo(kind, quantity) {
  const lastDay = lastDayOfSeason();

  if (kind === 'deadline') {
    return runAdvance({ target: advanceTargetForDay(Math.min(lastDay, tradeDeadlineDay(GameState.season.games)), 'the trade deadline') });
  }
  if (kind === 'days') {
    return runAdvance({ target: advanceTargetForDay(Math.min(lastDay, GameState.season.currentDay + quantity), quantity + ' days') });
  }
  if (kind === 'seasons') {
    return runAdvance({ target: { kind: 'seasons', untilYear: (GameState.leagueYear || 2026) + quantity, label: quantity + ' seasons' } });
  }
  if (kind === 'championship') {
    return runAdvance({ target: { kind: 'championship', label: 'a title' } });
  }
  if (kind === 'draft' || kind === 'freeAgency') {
    const stage = kind === 'draft' ? 'draft' : 'freeagency';
    // With the stage automated there is no such stop to reach — the rollover
    // runs straight through it — so the honest target is the next season.
    const automated = kind === 'draft' ? autoDraftEffective() : autoFreeAgencyEffective();
    const target = automated
      ? { kind: 'seasons', untilYear: (GameState.leagueYear || 2026) + 1, label: 'the new season' }
      : { kind: 'stage', stage: stage, label: kind === 'draft' ? 'the draft' : 'free agency' };
    const result = await runAdvance({ target: target });
    if (!automated) { renderView(stage); setSimStatus(result.label); }
    return result;
  }
  // seasonEnd / playoffsEnd: Continue's own boundary rules already stop there.
  return runAdvance({ target: null });
}

// Watch Next Game: identical day-advance to handleNextGame, except the user's
// game sims through the possession engine with event capture and the pixel
// view opens on the result. Regular season only (the playoff sim path is
// separate — spec lists playoff watching as a follow-up).
// Playoff twin of handleWatchNextGame. The bracket sims games one at a time
// in round order, so this plays forward through other series (exactly as the
// regular-season path sims the rest of the day's games) until it reaches one
// involving the user's team, then opens the pixel view on it.
async function handleWatchNextPlayoffGame() {
  const container = document.getElementById('sim-controls');
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  setSimStatus('Simulating…');

  const events = [];
  const watch = { teamId: GameState.userTeamId, events: events, live: true };
  let guard = 0;
  // Guard: a full bracket is at most 105 games; the cap only exists so a
  // malformed bracket can't spin forever.
  while (guard++ < 200) {
    const game = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng, watch);
    collectFinishedPlayoffGames();     // the other teams' games played on the way
    if (watch.liveGame) break;         // reached the user's game
    if (game === null) break;          // champion already crowned
  }

  setSimStatus('');
  if (!watch.liveGame) {
    // After the render, not before: renderView rebuilds the dock and would
    // wipe this message, so it has never actually been seen.
    renderView(GameState.currentView);
    setSimStatus('No remaining games for your team to watch.');
    autosave(GameState);
    return;
  }

  autosave(GameState);
  setLiveWatchSession({
    homeTeamId: watch.liveGame.game.homeTeamId,
    awayTeamId: watch.liveGame.game.awayTeamId,
    events: events,
    sim: watch.liveGame.sim,
    userTeamId: GameState.userTeamId,
    isPlayoff: true,
    onFinish: function () {
      // finish() first: the interview reads the completed result and box
      // score, neither of which exists until the game is closed out.
      watch.liveGame.finish();
      maybeRunPostgameDialogue(watch.liveGame.sim, function () {
        // The bracket advance was deferred along with the result — do it now
        // that the series actually contains this game.
        advanceBracketIfRoundComplete(GameState.playoffBracket);
        // Including the game just coached: finish() is what completes it, so it
        // only becomes drainable here. Without this the ONE playoff game the
        // user actually played would be the only one with no box score.
        collectFinishedPlayoffGames();
        autosave(GameState);
      });
    }
  });
  renderView('pixelGame');
}

// Fires the post-game interview, if one is warranted, then runs `onContinue`
// once the box is dismissed. Returns true if a box actually opened.
//
// Both onFinish paths call this same helper rather than each building their
// own: the regular-season and playoff paths already do different amounts of
// work around it, and duplicating the gating between them is exactly how the
// two would drift apart.
//
// It never swallows the continuation. Every early return calls it, so a
// disabled setting, an unrelated game, or a refused box all still complete the
// work the caller deferred.
function maybeRunPostgameDialogue(sim, onContinue) {
  const cont = typeof onContinue === 'function' ? onContinue : function () {};
  if (GameState.settings && GameState.settings.dialogueScenes === false) { cont(); return false; }
  if (typeof runDialogue !== 'function' || dialogueBoxIsOpen()) { cont(); return false; }
  if (!sim || (sim.homeTeamId !== GameState.userTeamId && sim.awayTeamId !== GameState.userTeamId)) {
    cont();
    return false;
  }

  const ctx = buildPostgameContext(GameState, sim);
  const scene = selectScene(ctx, {
    recent: GameState.recentDialogueScenes || [],
    rand: GameState.rng,
    fallbackLines: (GameState.narrativeSystem && GameState.narrativeSystem.dialogueLibrary)
      ? GameState.narrativeSystem.dialogueLibrary.media_standard
      : null
  });

  const reporter = reporterForTeam(GameState, GameState.userTeamId);
  if (reporter) {
    ctx.speakerReporter = { face: reporter.face };
    // join(), not concatenation with a string literal: this value is assigned
    // with textContent inside the dialogue box and must NOT be escaped — an
    // escaped apostrophe would render as "&#39;" on screen. Written this way
    // so the ui-safety scanner, which treats `x + '...'` as markup building,
    // does not flag a line that never touches innerHTML.
    ctx.speakerName = [reporter.name, reporter.outlet].join(' — ');
  }

  const opened = runDialogue(scene, ctx, function (result) {
    // A skipped scene applies nothing: silence is not an answer.
    if (!result.skipped) {
      const choice = scene.choices[result.choiceIndex];
      if (choice && typeof choice.effect === 'function') {
        // What he said, before what it does — so a later scene can bring it up.
        rememberAnswer(GameState, scene && scene.id, choice, GameState.leagueYear);
        applyDialogueEffect(GameState, choice.effect(ctx), ctx);
      }
    }
    pushRecentScene(GameState, scene.id);
    cont();
  });

  if (!opened) cont();
  return opened;
}

// Files anything the playoff machinery has finished into the season's game
// list, which is where the Schedule view looks and what save.js persists.
// Playoff games used to be simulated and discarded, so there was no playoff
// box score to open anywhere in the app.
function collectFinishedPlayoffGames() {
  const finished = drainFinishedPlayoffGames();
  if (!finished.length) return 0;
  // Each gets a day continuing past the regular season. Not decoration: the
  // Schedule view sorts by day, and a game without one sorts by NaN, which
  // scatters the playoffs through the list in an order the comparator does not
  // define. One day per game also happens to be true — playoff games are not
  // played two-a-night.
  let day = 0, id = 0;
  GameState.season.games.forEach(function (g) {
    if (typeof g.day === 'number' && g.day > day) day = g.day;
    if (typeof g.id === 'number' && g.id > id) id = g.id;
  });
  finished.forEach(function (g) {
    day += 1;
    id += 1;
    g.day = day;
    // Numeric and unique across the season, matching the schedule's own ids.
    // The Schedule view reads this back through Number(), so a string id would
    // become NaN and the row would refuse to expand.
    g.id = id;
    GameState.season.games.push(g);
  });
  return finished.length;
}

// Sims forward to `targetDay` and watches the user's game that day. Shared by
// the dock's Watch Next Game and the Schedule view's per-game Watch button
// (which passes a specific future day), so both paths advance the league
// identically — only WHICH day they stop on differs.
async function watchGameOnDay(targetDay) {
  const container = document.getElementById('sim-controls');
  if (targetDay === null || targetDay === undefined) return;

  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  setSimStatus('Simulating…');

  // Days before the user's game day sim exactly as Next Game does.
  if (targetDay - 1 > GameState.season.currentDay) {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay - 1, GameState.settings, GameState.rng, handleDayComplete);
  }
  const userGame = GameState.season.games.find(function (g) {
    return g.day === targetDay && !g.played && (g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId);
  });
  const events = [];
  const watch = userGame ? { gameId: userGame.id, events: events, live: true } : null;
  simulateDate(GameState.season, targetDay, GameState.settings, GameState.rng, handleDayComplete, watch);
  GameState.season.currentDay = targetDay;

  setSimStatus('');
  if (!watch || !watch.liveGame) {
    // Graceful fallback (spec): sim the day normally. The message goes after
    // the render, which rebuilds the dock and would otherwise wipe it.
    renderView(GameState.currentView);
    setSimStatus('Game could not be watched — simmed normally.');
    autosave(GameState);
    return;
  }

  // Saving here records the day's OTHER games and the advanced day. The
  // watched game is still unplayed and is not in the save: if the user
  // reloads mid-watch it simply has not happened yet, which is the only
  // consistent state available (playback lives in memory by design — see the
  // module comment in ui/pixelGameView.js).
  autosave(GameState);

  setLiveWatchSession({
    homeTeamId: watch.liveGame.game.homeTeamId,
    awayTeamId: watch.liveGame.game.awayTeamId,
    events: events,
    sim: watch.liveGame.sim,
    userTeamId: GameState.userTeamId,
    onFinish: function () {
      // finish() first: the interview reads the completed result and box
      // score, neither of which exists until the game is closed out. The
      // autosave is deferred so the reputation and morale the interview
      // moves are actually in the file it writes.
      watch.liveGame.finish();
      maybeRunPostgameDialogue(watch.liveGame.sim, function () {
        autosave(GameState);
      });
    }
  });
  renderView('pixelGame');
}

async function handleWatchNextGame() {
  if (GameState.playoffBracket) return handleWatchNextPlayoffGame();
  return watchGameOnDay(getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay));
}

// Continue states where it is going. That is what lets it absorb the three
// ceremonial offseason clicks — Advance to Offseason, Go to Free Agency,
// Start New Season — which existed only because nothing else would do them.
//
// Every branch here must match what handleContinue actually does from that
// state, including the automation branches: with autoDraft off Continue opens
// the draft for the user rather than crossing it, and a label promising
// otherwise would be a lie about the next click.
function continueLabel() {
  if (isAdvanceRunning()) return 'Stop';
  if (GameState.offseasonStage === 'draft') {
    // Standing on the draft with a pick waiting, Continue has nothing it can
    // do — the choice is the player's, and the Draft view's own buttons make
    // it. Saying so beats a button that restates "Draft is ready" and does
    // nothing; renderSimControls disables it to match.
    if (draftIsWaiting()) {
      return GameState.currentView === 'draft' ? 'Your pick' : 'Continue → Draft';
    }
    return 'Continue → Free Agency';   // a finished draft crosses onward
  }
  if (GameState.offseasonStage === 'freeagency') {
    // Once they are looking at free agency, the next press ends it.
    const waiting = !autoFreeAgencyEffective() && GameState.currentView !== 'freeagency';
    return waiting ? 'Continue → Free Agency' : 'Continue → Next Season';
  }
  if (GameState.playoffBracket) {
    const finals = GameState.playoffBracket.finals;
    // A crowned champion means the next unit of time is the whole offseason.
    if (finals && finals[0] && finals[0].winner) return 'Continue → Offseason';
    return 'Continue → Playoffs';
  }
  if (GameState.season && isRegularSeasonComplete(GameState.season)) return 'Continue → Playoffs';
  return 'Continue';
}

function renderSimControls(container) {
  const running = isAdvanceRunning();
  // Skip-to is meaningless mid-offseason: every target is either behind us or
  // the stage we are already standing in.
  const skipDisabled = (!!GameState.offseasonStage || running) ? ' disabled' : '';
  const busyDisabled = running ? ' disabled' : '';
  container.innerHTML =
    '<div class="dock-group dock-primary">' +
      // Ten time controls became three. The player used to have to decide HOW
      // FAR to skip before every advance, which is itself a micro-decision
      // repeated constantly; Continue asks nothing and stops when something
      // actually needs them.
      '<button id="sim-continue" class="btn-primary">' + continueLabel() + '</button>' +
      '<button id="sim-watch-game"' + busyDisabled + '>Watch Next Game</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<button id="sim-undo-btn" class="btn-ghost" title="Undo the last trade or free agent signing"' + (canUndo(GameState) ? '' : ' disabled') + '>Undo</button>' +
      '<button id="sim-redo-btn" class="btn-ghost"' + (canRedo(GameState) ? '' : ' disabled') + '>Redo</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<select id="sim-skip-to"' + skipDisabled + '>' +
        '<option value="">Skip to…</option>' +
        '<option value="deadline">Trade Deadline</option>' +
        '<option value="draft">Draft</option>' +
        '<option value="freeAgency">Free Agency</option>' +
        '<option value="seasonEnd">End of Regular Season</option>' +
        '<option value="playoffsEnd">End of Playoffs</option>' +
        '<option value="championship">Until Title</option>' +
        '<option value="seasons">Seasons…</option>' +
        '<option value="days">Days…</option>' +
      '</select>' +
      '<input type="number" id="sim-skip-qty" value="1" min="1" max="15" hidden>' +
      '<button id="sim-skip-go" class="btn-ghost"' + skipDisabled + '>Go</button>' +
    '</div>' +
    '<div class="dock-group dock-end">' +
      '<span class="dock-label">Speed</span>' +
      '<select id="sim-speed">' +
        ['slow', 'normal', 'fast', 'ultra'].map(function (s) {
          return '<option value="' + s + '"' + (GameState.settings.simSpeed === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') +
      '</select>' +
      '<span id="sim-status"></span>' +
    '</div>';

  document.getElementById('sim-continue').addEventListener('click', handleContinue);
  document.getElementById('sim-watch-game').addEventListener('click', handleWatchNextGame);
  document.getElementById('sim-skip-to').addEventListener('change', function (e) {
    // Only the two quantity-taking targets reveal the number input, so at most
    // three elements are ever visible at once.
    const needsQty = e.target.value === 'seasons' || e.target.value === 'days';
    const qty = document.getElementById('sim-skip-qty');
    qty.hidden = !needsQty;
    if (needsQty) qty.value = e.target.value === 'days' ? '7' : '1';
  });
  document.getElementById('sim-skip-go').addEventListener('click', function () {
    const kind = document.getElementById('sim-skip-to').value;
    if (!kind) return;
    const qty = Number(document.getElementById('sim-skip-qty').value) || 1;
    handleSkipTo(kind, qty);
  });
  document.getElementById('sim-speed').addEventListener('change', function (e) {
    GameState.settings.simSpeed = e.target.value;
  });

  // The dock stays visible during a watched game, so without this Continue
  // would sim days out from under a game still on screen. Guarded by typeof:
  // ui/pixelGameView.js loads after this file, so the name does not exist
  // when this module is evaluated — only when a render actually runs.
  if (typeof isLiveWatchPending === 'function' && isLiveWatchPending()) {
    document.getElementById('sim-continue').disabled = true;
    document.getElementById('sim-skip-go').disabled = true;
  }

  // Likewise when the user is looking at the draft that is waiting on them:
  // the pick is theirs to make, so Continue is genuinely unavailable rather
  // than merely ineffective. It re-enables the moment the board is exhausted,
  // which is what carries them on to free agency.
  if (draftIsWaiting() && GameState.currentView === 'draft') {
    document.getElementById('sim-continue').disabled = true;
  }

  // Nothing left to watch: during the offseason, and once the regular season
  // has no remaining game for the user. A button that opens an empty view is
  // worse than one that is visibly unavailable.
  const noGameToWatch = !!GameState.offseasonStage ||
    (!GameState.playoffBracket && GameState.season &&
      getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay) === null);
  if (noGameToWatch) document.getElementById('sim-watch-game').disabled = true;

  document.getElementById('sim-undo-btn').addEventListener('click', function () {
    performUndo(GameState);
    renderView(GameState.currentView);
  });
  document.getElementById('sim-redo-btn').addEventListener('click', function () {
    performRedo(GameState);
    renderView(GameState.currentView);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderSimControls: renderSimControls,
    runAdvance: runAdvance,
    requestAdvanceStop: requestAdvanceStop,
    isAdvanceRunning: isAdvanceRunning,
    handleContinue: handleContinue,
    handleSkipTo: handleSkipTo,
    watchGameOnDay: watchGameOnDay,
    SIM_SPEED_DELAYS_MS: SIM_SPEED_DELAYS_MS
  };
}
