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
  trade: renderTradeCenter
};

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
