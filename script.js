const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
  season: null,
  playoffBracket: null,
  settings: { simEngine: 'boxscore', simSpeed: 'normal' }
};

function initSeason() {
  GameState.rng = makeRng(Date.now());
  const games = generateSeasonGames(GameState.rng, TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  GameState.season = { games: games, currentDay: -1 };
}

// Views with a real renderer this phase. Anything else in NAV_ITEMS (ui/nav.js)
// falls back to the placeholder view.
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) { renderDraftResults(container, GameState.lastDraftResults || []); }
};

function isRegularSeasonAndPlayoffsComplete() {
  return GameState.season && GameState.season.games.every(function (g) { return g.played; })
    && GameState.playoffBracket && GameState.playoffBracket.finals.length > 0 && GameState.playoffBracket.finals[0].complete;
}

function handleAdvanceToOffseason() {
  const isFirstDraft = GameState.leagueYear === undefined;
  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, isFirstDraft);
  GameState.lastDraftResults = result.draftResults;
  GameState.offseasonStage = 'draft';
  renderView('draft');
}

function handleAdvanceToNewSeason() {
  const games = generateNewSeason(GameState.rng);
  GameState.season = { games: games, currentDay: -1 };
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  renderView('dashboard');
}

function renderPlaceholder(container) {
  container.innerHTML = '<div class="placeholder-view">Coming in a later phase.</div>';
}

function renderView(viewName) {
  GameState.currentView = viewName;
  const container = document.getElementById('view-content');
  const renderer = BUILT_VIEWS[viewName];
  if (renderer) {
    renderer(container, GameState.userTeamId);
  } else {
    renderPlaceholder(container);
  }
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView);
  if (GameState.season) {
    renderSimControls(document.getElementById('sim-controls'));
  }

  const simControlsEl = document.getElementById('sim-controls');
  if (isRegularSeasonAndPlayoffsComplete() && !GameState.offseasonStage) {
    simControlsEl.innerHTML += '<button id="advance-offseason-btn">Advance to Offseason</button>';
    document.getElementById('advance-offseason-btn').addEventListener('click', handleAdvanceToOffseason);
  } else if (GameState.offseasonStage === 'draft') {
    simControlsEl.innerHTML += '<button id="advance-to-fa-btn">Go to Free Agency</button>';
    document.getElementById('advance-to-fa-btn').addEventListener('click', function () { GameState.offseasonStage = 'freeagency'; renderView('freeagency'); });
  } else if (GameState.offseasonStage === 'freeagency') {
    simControlsEl.innerHTML += '<button id="start-new-season-btn">Start New Season</button>';
    document.getElementById('start-new-season-btn').addEventListener('click', handleAdvanceToNewSeason);
  }
}

function selectTeam(teamId) {
  GameState.userTeamId = teamId;
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}

function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam);
}

document.addEventListener('DOMContentLoaded', init);
