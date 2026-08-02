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
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng, handleDayComplete);
    }, 1);
    if (isRegularSeasonComplete(GameState.season)) {
      GameState.playoffBracket = generateBracket();
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
    if (!GameState.playoffBracket && isRegularSeasonComplete(GameState.season)) GameState.playoffBracket = generateBracket();
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
  container.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  const statusEl = document.getElementById('sim-status');
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

    GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, stepTarget, GameState.settings, GameState.rng, handleDayComplete);
    if (delayMs > 0) await delay(delayMs);
    daysRemaining -= (GameState.season.currentDay - daysBefore);
    if (GameState.pauseRequested) break;
    if (GameState.season.currentDay < lastDay) continue; // 'days' mode hit its limit mid-season

    if (!GameState.playoffBracket) {
      GameState.playoffBracket = generateBracket();
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
    // archiveDraftClass wiring, not just the manual single-step path.
    finalizeSeasonHistory(GameState.leagueYear || 2026, GameState.playoffBracket, function (text) { pushToFeed(text); });
    GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
    const draftResult = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass, GameState.leagueYear);
    GameState.lastDraftResults = draftResult.draftResults;
    archiveDraftClass(GameState.leagueYear, draftResult.draftResults);
    runFreeAgencySilently(GameState.rng);
    autoEnforceRosterSize(getTeamById(GameState.userTeamId));

    const seasonResult = generateNewSeason(GameState.rng);
    GameState.season = { games: seasonResult.games, currentDay: -1 };
    GameState.upcomingDraftClass = seasonResult.nextDraftClass;
    GameState.playoffBracket = null;
    GameState.offseasonStage = null;
    seasonsRun += 1;
  }

  if (statusEl) statusEl.textContent = '';
  renderView(GameState.currentView);
  autosave(GameState);
}

function renderSimControls(container) {
  const stageLabel = GameState.playoffBracket ? 'Playoffs' : 'Regular Season';
  container.innerHTML =
    '<button id="sim-next-game">Next Game</button>' +
    '<button id="sim-next-day">Next Day</button>' +
    '<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +
    '<button id="sim-to-deadline">Sim to Trade Deadline</button>' +
    '<button id="sim-to-draft">Sim to Draft</button>' +
    '<button id="sim-to-fa">Sim to Free Agency</button>' +
    '<input type="number" id="sim-n-seasons" value="1" min="1" max="15" style="width:3em;"><button id="sim-n-seasons-btn">Sim N Seasons</button>' +
    '<button id="sim-until-championship">Sim Until Championship</button>' +
    '<input type="number" id="sim-n-days" value="7" min="1" style="width:4em;"><button id="sim-n-days-btn">Sim Custom Days</button>' +
    '<select id="sim-speed">' +
      ['slow', 'normal', 'fast', 'ultra'].map(function (s) {
        return '<option value="' + s + '"' + (GameState.settings.simSpeed === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') +
    '</select>' +
    '<span id="sim-status"></span>';

  document.getElementById('sim-next-game').addEventListener('click', handleNextGame);
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSimControls: renderSimControls, SIM_SPEED_DELAYS_MS: SIM_SPEED_DELAYS_MS };
}
