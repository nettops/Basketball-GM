const SIM_SPEED_DELAYS_MS = { slow: 500, normal: 200, fast: 50, ultra: 0 };

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isRegularSeasonComplete(season) {
  return season.games.every(function (g) { return g.played; });
}

async function runWithDelay(container, stepFn, stepsToRun) {
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'Simulating...';
  const delayMs = SIM_SPEED_DELAYS_MS[GameState.settings.simSpeed] || SIM_SPEED_DELAYS_MS.normal;

  for (let i = 0; i < stepsToRun; i++) {
    stepFn();
    if (delayMs > 0) await delay(delayMs);
  }

  if (statusEl) statusEl.textContent = '';
  renderView(GameState.currentView);
  autosave(GameState);
}

async function handleNextGame() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const targetDay = getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay);
    if (targetDay === null) return;
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay, GameState.settings, GameState.rng, handleDayComplete);
    }, 1);
  } else {
    await runWithDelay(container, function () {
      simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    }, 1);
  }
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

async function handleNextDay() {
  const container = document.getElementById('sim-controls');
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateNextDay(GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng, handleDayComplete);
  }, 1);
}

async function handleSimToEnd() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
    // Bracket generation belongs INSIDE the runWithDelay callback: that
    // function ends by calling renderView, so generating the bracket after it
    // returned left the dock still labelled "Regular Season" (and the playoff
    // view empty) until the next unrelated re-render.
    const hadBracket = !!GameState.playoffBracket;
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng, handleDayComplete);
      if (isRegularSeasonComplete(GameState.season)) {
        GameState.playoffBracket = generateBracket(GameState.rng, GameState.settings);
      }
    }, 1);
    // A career-mode player whose team just made the bracket gets the playoff
    // milestone scene. Rendered after runWithDelay because that call ends in a
    // renderView that would otherwise paint straight over it.
    if (!hadBracket && GameState.playoffBracket) {
      handlePlayerCareerPlayoffIntro();
    }
  } else {
    await runWithDelay(container, function () {
      let result = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      while (result !== null) {
        result = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      }
    }, 1);
  }
}

async function handleSimToTradeDeadline() {
  const container = document.getElementById('sim-controls');
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  const deadlineDay = Math.min(lastDay, Math.round(lastDay * 0.65));
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, deadlineDay, GameState.settings, GameState.rng, handleDayComplete);
  }, 1);
}

async function runRegularSeasonAndPlayoffsToCompletion(container) {
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  await runWithDelay(container, function () {
    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng, handleDayComplete);
    if (!GameState.playoffBracket && isRegularSeasonComplete(GameState.season)) GameState.playoffBracket = generateBracket(GameState.rng, GameState.settings);
    if (GameState.playoffBracket) {
      let g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
      while (g !== null) g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    }
  }, 1);
}

async function handleSimToDraft() {
  const container = document.getElementById('sim-controls');
  await runRegularSeasonAndPlayoffsToCompletion(container);
  handleAdvanceToOffseason();
}

async function handleSimToFreeAgency() {
  const container = document.getElementById('sim-controls');
  await runRegularSeasonAndPlayoffsToCompletion(container);
  handleAdvanceToOffseason();
  GameState.offseasonStage = 'freeagency';
  if (GameState.playMode === 'spectator' || GameState.automation.autoFreeAgency) {
    runFreeAgencySilently(GameState.rng);
    autoEnforceRosterSize(getTeamById(GameState.userTeamId));
  }
  renderView('freeagency');
  autosave(GameState);
}

// Repeats season -> playoffs -> offseason (always fully auto-driven, regardless
// of individual automation toggles — a 10+ season unattended run can't pause
// for manual draft/FA input at every boundary) until the requested stop
// condition. mode: 'seasons' | 'championship' | 'days'.
async function runMultiSeason(mode, target) {
  const container = document.getElementById('sim-controls');
  const statusEl = document.getElementById('sim-status');

  // Idempotence guard, mirroring script.js's handleAdvanceToOffseason. This
  // loop is a second, independent season-rollover path (see the comment on
  // its body below) that redoes finalizeSeasonHistory / runOffseasonThroughDraft
  // / runFreeAgencySilently unconditionally from its very first iteration —
  // it never checks whether an offseason (draft, possibly still mid-pick in
  // manual mode; free agency) is already under way. Without this guard, a
  // "Skip to Draft"/"Skip to Free Agency" click followed by any fast-forward
  // button re-drafts the SAME GameState.upcomingDraftClass prospects a second
  // time straight into PLAYERS_2026 (duplicate roster entries, salaries
  // double-counted in payroll) and leaves any in-progress GameState.draftSession
  // pointing at prospects whose state no longer matches reality — which is
  // what the fast-forward controls hanging on the next interaction traces
  // back to. The buttons are also disabled below (renderSimControls) while
  // inOffseason, same as "Skip to...", but this guard is the actual fix:
  // button state alone doesn't stop a second call reaching here.
  if (GameState.offseasonStage) {
    if (statusEl) statusEl.textContent = 'Finish the current draft / free agency before fast-forwarding.';
    return;
  }

  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const delayMs = SIM_SPEED_DELAYS_MS[GameState.settings.simSpeed] || SIM_SPEED_DELAYS_MS.normal;

  let seasonsRun = 0;
  const maxSeasons = mode === 'championship' ? 15 : (mode === 'seasons' ? target : Infinity);
  let daysRemaining = mode === 'days' ? target : Infinity;
  GameState.pauseRequested = false;

  while (seasonsRun < maxSeasons && daysRemaining > 0 && !GameState.pauseRequested) {
    const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
    const stepTarget = mode === 'days' ? Math.min(lastDay, GameState.season.currentDay + daysRemaining) : lastDay;
    const daysBefore = GameState.season.currentDay;
    if (statusEl) statusEl.textContent = 'Simulating season ' + (seasonsRun + 1) + '...';

    // Worker-backed path (opt-in, GameState.settings.useWorkerSim — see
    // ui/settings.js) hands each individual game's simulation math off to
    // simWorker.js and yields to the browser between every game via the
    // postMessage roundtrip, instead of only between whole seasons like the
    // synchronous path below. Same bookkeeping either way (league.js's
    // simulateDateAsync shares applyGameResult with the sync simulateDate) —
    // this only changes WHERE the CPU-heavy game math runs, never the result.
    const useWorker = GameState.settings.useWorkerSim && isWorkerSimAvailable();
    GameState.season.currentDay = useWorker
      ? await simulateThroughDateAsync(GameState.season, GameState.season.currentDay, stepTarget, GameState.settings, GameState.rng, handleDayComplete)
      : simulateThroughDate(GameState.season, GameState.season.currentDay, stepTarget, GameState.settings, GameState.rng, handleDayComplete);
    if (delayMs > 0) await delay(delayMs);
    daysRemaining -= (GameState.season.currentDay - daysBefore);
    if (GameState.pauseRequested) break;
    if (GameState.season.currentDay < lastDay) continue; // 'days' mode hit its limit mid-season

    if (!GameState.playoffBracket) {
      GameState.playoffBracket = generateBracket(GameState.rng, GameState.settings);
      const madePlayoffs = GameState.playoffBracket.first.some(function (s) { return s.higherSeed === GameState.userTeamId || s.lowerSeed === GameState.userTeamId; });
      if ((madePlayoffs && GameState.settings.pauseOn.madePlayoffs) || (!madePlayoffs && GameState.settings.pauseOn.missedPlayoffs)) {
        GameState.pauseRequested = true;
      }
    }
    let g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);
    while (g !== null) g = simulateNextPlayoffGame(GameState.playoffBracket, GameState.settings, GameState.rng);

    if (mode === 'championship' && GameState.playoffBracket.finals[0].winner === GameState.userTeamId) {
      seasonsRun += 1;
      GameState.pauseRequested = true;
      break;
    }
    if (GameState.pauseRequested) { seasonsRun += 1; break; }

    // This loop is a second, independent season-rollover path alongside
    // script.js's handleAdvanceToOffseason (used by the manual "Next..."
    // buttons) — it drives every fast-forward control (Sim N Seasons, Sim
    // Until Championship, Sim Custom Days), which is precisely the
    // "long unattended multi-season sim" use case Phase 8's history/awards
    // tracking exists for, so it needs the same finalizeSeasonHistory /
    // archiveDraftClass wiring, not just the manual single-step path. Same
    // reasoning applies to the season-snapshot rewind feature.
    pushSeasonSnapshot(GameState);
    // Same reason script.js's handleAdvanceToOffseason clears these: the
    // offseason below retires players out of PLAYERS_2026, so any offer still
    // in the inbox can name someone who no longer exists.
    GameState.tradeOffers = [];
    finalizeSeasonHistory(GameState.leagueYear || 2026, GameState.playoffBracket, function (text) { pushToFeed(text); });
    setLeagueYear((GameState.leagueYear || 2026) + 1);
    const draftResult = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass, GameState.leagueYear, GameState.settings.lotteryFormat);
    GameState.lastDraftResults = draftResult.draftResults;
    archiveDraftClass(GameState.leagueYear, draftResult.draftResults);
    runFreeAgencySilently(GameState.rng);
    autoEnforceRosterSize(getTeamById(GameState.userTeamId));

    // Career mode's own offseason step. This loop is a separate rollover path
    // from script.js's handleAdvanceToOffseason, and it never ran the career
    // followup — so fast-forwarding skipped every retirement ceremony and
    // random event, and could retire the controlled player straight out of
    // PLAYERS_2026 leaving the Career view reading "Player not found".
    let careerSceneShown = false;
    if (GameState.gameMode === 'playerCareer') {
      careerSceneShown = handlePlayerCareerOffseasonFollowup(true);
    }

    const seasonResult = generateNewSeason(GameState.rng);
    GameState.season = { games: seasonResult.games, currentDay: -1 };
    GameState.upcomingDraftClass = seasonResult.nextDraftClass;
    GameState.playoffBracket = null;
    GameState.offseasonStage = null;
    GameState.allStarWeekend = null;
    seasonsRun += 1;

    // A scene the user has to acknowledge ends the fast-forward. Returning
    // here (rather than breaking) skips the renderView below, which would
    // otherwise immediately paint over the scene that was just rendered.
    if (careerSceneShown) {
      if (statusEl) statusEl.textContent = '';
      // Re-render just the dock, not the whole view: the buttons were disabled
      // at the top of this function and need re-enabling, but renderView would
      // paint over the scene we just put in view-content.
      renderSimControls(document.getElementById('sim-controls'));
      autosave(GameState);
      return;
    }
  }

  if (statusEl) statusEl.textContent = '';
  renderView(GameState.currentView);
  autosave(GameState);
}

function renderSimControls(container) {
  const stageLabel = GameState.playoffBracket ? 'Playoffs' : 'Regular Season';
  // Once the offseason has started, handleAdvanceToOffseason is a no-op by
  // design (see its guard) — disable the two controls that call it so the
  // button state matches what actually happens on click.
  const inOffseason = !!GameState.offseasonStage;
  const skipDisabled = inOffseason ? ' disabled' : '';
  container.innerHTML =
    '<div class="dock-group dock-primary">' +
      '<button id="sim-next-game" class="btn-primary">Next Game</button>' +
      '<button id="sim-watch-game">Watch Next Game</button>' +
      '<button id="sim-next-day">Next Day</button>' +
      '<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +
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

  document.getElementById('sim-next-game').addEventListener('click', handleNextGame);
  document.getElementById('sim-watch-game').addEventListener('click', handleWatchNextGame);
  document.getElementById('sim-next-day').addEventListener('click', handleNextDay);
  document.getElementById('sim-to-end').addEventListener('click', handleSimToEnd);
  document.getElementById('sim-to-deadline').addEventListener('click', handleSimToTradeDeadline);
  document.getElementById('sim-to-draft').addEventListener('click', handleSimToDraft);
  document.getElementById('sim-to-fa').addEventListener('click', handleSimToFreeAgency);
  document.getElementById('sim-n-seasons-btn').addEventListener('click', function () {
    runMultiSeason('seasons', Number(document.getElementById('sim-n-seasons').value));
  });
  document.getElementById('sim-until-championship').addEventListener('click', function () {
    runMultiSeason('championship', null);
  });
  document.getElementById('sim-n-days-btn').addEventListener('click', function () {
    runMultiSeason('days', Number(document.getElementById('sim-n-days').value));
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
  module.exports = { renderSimControls: renderSimControls, runMultiSeason: runMultiSeason, watchGameOnDay: watchGameOnDay, SIM_SPEED_DELAYS_MS: SIM_SPEED_DELAYS_MS };
}
