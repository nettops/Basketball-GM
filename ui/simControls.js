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
      const rollover = runOffseasonRollover(GameState, {
        stopAfterDraft: !autoDraftEffective(),
        onFeed: function (text) { pushToFeed(text); },
        onCareerFollowup: GameState.gameMode === 'playerCareer'
          ? function () { return handlePlayerCareerOffseasonFollowup(true); }
          : null
      });
      if (rollover.careerSceneShown) out.sceneShown = true;
      return true;
    }
    return simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng) !== null;
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
  return true;
}

// options: { target } — null for Continue. Resolves to the stop that ended it.
async function runAdvance(options) {
  const opts = options || {};
  const statusEl = document.getElementById('sim-status');
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
  let guard = 0;
  while (guard++ < 20000) {
    stop = evaluateStop(GameState, GameState.season.currentDay, {
      target: opts.target || null,
      userStopRequested: _advanceStopRequested,
      // Only the first check. See simRunner.js — this is what lets Continue
      // step across a boundary it is parked on.
      crossBoundary: steps === 0
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

    if (statusEl) statusEl.textContent = 'Simulating...';
    // ALWAYS yield, including at ultra where delayMs is 0. The old loops
    // skipped the await entirely at ultra, which froze the tab and made a run
    // impossible to interrupt — there was no moment for a click to land.
    await yieldToBrowser(delayMs);
  }

  _advanceRunning = false;
  _advanceStopRequested = false;
  stop = stop || { reason: STOP_REASONS.USER_STOP, label: 'Stopped' };
  if (statusEl) statusEl.textContent = stop.reason === STOP_REASONS.USER_STOP ? '' : stop.label;

  if (out.sceneShown) {
    // Re-render only the dock: the scene is sitting in view-content and
    // renderView would paint straight over it.
    renderSimControls(document.getElementById('sim-controls'));
  } else {
    renderView(GameState.currentView);
  }
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
  if (GameState.offseasonStage === 'draft' && !autoDraftEffective()) return renderView('draft');
  if (GameState.offseasonStage === 'freeagency' && !autoFreeAgencyEffective()) return renderView('freeagency');

  const result = await runAdvance({ target: null });
  if (result.reason === STOP_REASONS.DRAFT_READY) renderView('draft');
  else if (result.reason === STOP_REASONS.FREE_AGENCY_READY) renderView('freeagency');
  return result;
}

// kind: 'deadline' | 'days' | 'seasonEnd' | 'draft' | 'freeAgency' | 'seasons'
// | 'championship'. Every one is the same loop with a different stop predicate.
async function handleSkipTo(kind, quantity) {
  const lastDay = lastDayOfSeason();

  if (kind === 'deadline') {
    return runAdvance({ target: advanceTargetForDay(Math.min(lastDay, Math.round(lastDay * 0.65)), 'the trade deadline') });
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
    if (!automated) renderView(stage);
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
  const statusEl = document.getElementById('sim-status');
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  if (statusEl) statusEl.textContent = 'Simulating...';

  const events = [];
  const watch = { teamId: GameState.userTeamId, events: events, live: true };
  let guard = 0;
  // Guard: a full bracket is at most 105 games; the cap only exists so a
  // malformed bracket can't spin forever.
  while (guard++ < 200) {
    const game = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng, watch);
    if (watch.liveGame) break;         // reached the user's game
    if (game === null) break;          // champion already crowned
  }

  if (statusEl) statusEl.textContent = '';
  if (!watch.liveGame) {
    if (statusEl) statusEl.textContent = 'No remaining games for your team to watch.';
    renderView(GameState.currentView);
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
      watch.liveGame.finish();
      // The bracket advance was deferred along with the result — do it now
      // that the series actually contains this game.
      advanceBracketIfRoundComplete(GameState.playoffBracket);
      autosave(GameState);
    }
  });
  renderView('pixelGame');
}

// Sims forward to `targetDay` and watches the user's game that day. Shared by
// the dock's Watch Next Game and the Schedule view's per-game Watch button
// (which passes a specific future day), so both paths advance the league
// identically — only WHICH day they stop on differs.
async function watchGameOnDay(targetDay) {
  const container = document.getElementById('sim-controls');
  if (targetDay === null || targetDay === undefined) return;

  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'Simulating...';

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

  if (statusEl) statusEl.textContent = '';
  if (!watch || !watch.liveGame) {
    // Graceful fallback (spec): behave like a normal Next Game click.
    if (statusEl) statusEl.textContent = 'Game could not be watched — simmed normally.';
    renderView(GameState.currentView);
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
      watch.liveGame.finish();
      autosave(GameState);
    }
  });
  renderView('pixelGame');
}

async function handleWatchNextGame() {
  if (GameState.playoffBracket) return handleWatchNextPlayoffGame();
  return watchGameOnDay(getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay));
}

function renderSimControls(container) {
  const stageLabel = GameState.playoffBracket ? 'Playoffs' : 'Regular Season';
  // Once the offseason has started, handleAdvanceToOffseason is a no-op by
  // design (see its guard) — disable the two controls that call it so the
  // button state matches what actually happens on click.
  const inOffseason = !!GameState.offseasonStage;
  const running = isAdvanceRunning();
  // While a run is in flight the only live control is Stop. Task 7 replaces
  // this dock wholesale; until then the buttons keep their labels and simply
  // route through runAdvance.
  const skipDisabled = (inOffseason || running) ? ' disabled' : '';
  const busyDisabled = running ? ' disabled' : '';
  container.innerHTML =
    '<div class="dock-group dock-primary">' +
      '<button id="sim-next-game" class="btn-primary">' + (running ? 'Stop' : 'Next Game') + '</button>' +
      '<button id="sim-watch-game"' + busyDisabled + '>Watch Next Game</button>' +
      '<button id="sim-next-day"' + busyDisabled + '>Next Day</button>' +
      '<button id="sim-to-end"' + busyDisabled + '>Sim to End of ' + stageLabel + '</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<button id="sim-undo-btn" class="btn-ghost" title="Undo the last trade or free agent signing"' + (canUndo(GameState) ? '' : ' disabled') + '>Undo</button>' +
      '<button id="sim-redo-btn" class="btn-ghost"' + (canRedo(GameState) ? '' : ' disabled') + '>Redo</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<span class="dock-label">Skip to</span>' +
      '<button id="sim-to-deadline" class="btn-ghost"' + skipDisabled + '>Trade Deadline</button>' +
      '<button id="sim-to-draft" class="btn-ghost"' + skipDisabled + '>Draft</button>' +
      '<button id="sim-to-fa" class="btn-ghost"' + skipDisabled + '>Free Agency</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<span class="dock-label">Fast forward</span>' +
      '<input type="number" id="sim-n-seasons" value="1" min="1" max="15"' + skipDisabled + '>' +
      '<button id="sim-n-seasons-btn" class="btn-ghost"' + skipDisabled + '>Seasons</button>' +
      '<button id="sim-until-championship" class="btn-ghost"' + skipDisabled + '>Until Title</button>' +
      '<input type="number" id="sim-n-days" value="7" min="1"' + skipDisabled + '>' +
      '<button id="sim-n-days-btn" class="btn-ghost"' + skipDisabled + '>Days</button>' +
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

  document.getElementById('sim-next-game').addEventListener('click', function () {
    if (isAdvanceRunning()) return requestAdvanceStop();
    if (GameState.playoffBracket) return runAdvance({ target: null });
    const day = getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay);
    if (day === null) return;
    return runAdvance({ target: advanceTargetForDay(day, 'your next game') });
  });
  document.getElementById('sim-watch-game').addEventListener('click', handleWatchNextGame);
  document.getElementById('sim-next-day').addEventListener('click', function () {
    runAdvance({ target: advanceTargetForDay(GameState.season.currentDay + 1, 'the next day') });
  });
  document.getElementById('sim-to-end').addEventListener('click', function () { handleSkipTo('seasonEnd'); });
  document.getElementById('sim-to-deadline').addEventListener('click', function () { handleSkipTo('deadline'); });
  document.getElementById('sim-to-draft').addEventListener('click', function () { handleSkipTo('draft'); });
  document.getElementById('sim-to-fa').addEventListener('click', function () { handleSkipTo('freeAgency'); });
  document.getElementById('sim-n-seasons-btn').addEventListener('click', function () {
    handleSkipTo('seasons', Number(document.getElementById('sim-n-seasons').value));
  });
  document.getElementById('sim-until-championship').addEventListener('click', function () {
    handleSkipTo('championship');
  });
  document.getElementById('sim-n-days-btn').addEventListener('click', function () {
    handleSkipTo('days', Number(document.getElementById('sim-n-days').value));
  });
  document.getElementById('sim-speed').addEventListener('change', function (e) {
    GameState.settings.simSpeed = e.target.value;
  });

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
