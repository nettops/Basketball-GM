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
}

async function handleNextGame() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const targetDay = getNextGameDay(GameState.season, GameState.userTeamId, GameState.season.currentDay);
    if (targetDay === null) return;
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, targetDay, GameState.settings, GameState.rng);
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
    GameState.season.currentDay = simulateNextDay(GameState.season, GameState.season.currentDay, GameState.settings, GameState.rng);
  }, 1);
}

async function handleSimToEnd() {
  const container = document.getElementById('sim-controls');
  if (!GameState.playoffBracket) {
    const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
    await runWithDelay(container, function () {
      GameState.season.currentDay = simulateThroughDate(GameState.season, GameState.season.currentDay, lastDay, GameState.settings, GameState.rng);
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

function renderSimControls(container) {
  const stageLabel = GameState.playoffBracket ? 'Playoffs' : 'Regular Season';
  container.innerHTML =
    '<button id="sim-next-game">Next Game</button>' +
    '<button id="sim-next-day">Next Day</button>' +
    '<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +
    '<select id="sim-speed">' +
      ['slow', 'normal', 'fast', 'ultra'].map(function (s) {
        return '<option value="' + s + '"' + (GameState.settings.simSpeed === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') +
    '</select>' +
    '<span id="sim-status"></span>';

  document.getElementById('sim-next-game').addEventListener('click', handleNextGame);
  document.getElementById('sim-next-day').addEventListener('click', handleNextDay);
  document.getElementById('sim-to-end').addEventListener('click', handleSimToEnd);
  document.getElementById('sim-speed').addEventListener('change', function (e) {
    GameState.settings.simSpeed = e.target.value;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSimControls: renderSimControls, SIM_SPEED_DELAYS_MS: SIM_SPEED_DELAYS_MS };
}
