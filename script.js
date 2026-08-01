const GameState = {
  userTeamId: null,
  currentView: 'dashboard'
};

// Views with a real renderer this phase. Anything else in NAV_ITEMS (ui/nav.js)
// falls back to the placeholder view.
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: renderRoster,
  standings: renderStandings
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
}

function selectTeam(teamId) {
  GameState.userTeamId = teamId;
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}

function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam);
}

document.addEventListener('DOMContentLoaded', init);
