const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'playerDashboard', label: 'Career' },
  { id: 'legacy', label: 'Player Legacy' },
  { id: 'roster', label: 'Roster' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'playoffs', label: 'Playoffs' },
  { id: 'allStarWeekend', label: 'All-Star Weekend' },
  { id: 'standings', label: 'Standings' },
  { id: 'powerRankings', label: 'Power Rankings' },
  { id: 'awards', label: 'Awards' },
  { id: 'seasonSummary', label: 'Season Recap' },
  { id: 'history', label: 'History' },
  { id: 'frivolities', label: 'Frivolities' },
  { id: 'careerLedger', label: 'Career Ledger' },
  { id: 'playerComparison', label: 'Compare Players' },
  { id: 'badges', label: 'Badges' },
  { id: 'news', label: 'League News' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'trade', label: 'Trade Center' },
  { id: 'freeagency', label: 'Free Agency' },
  { id: 'draft', label: 'Draft' },
  { id: 'scouting', label: 'Scouting' },
  { id: 'salarycap', label: 'Salary Cap' },
  { id: 'finances', label: 'Team Finances' },
  { id: 'coaching', label: 'Coaching' },
  { id: 'saveload', label: 'Save/Load' },
  { id: 'settings', label: 'Settings' },
  { id: 'commissioner', label: 'Commissioner' },
  { id: 'godMode', label: 'God Mode' }
];

// What the sidebar actually renders. Each hub owns an ordered list of view
// ids; the first is where clicking the hub lands, and the rest become tabs on
// that page.
//
// NAV_ITEMS above stays the canonical list of every navigable view —
// scripts/ui-smoke.js iterates it to prove all of them render, and
// scripts/validate-nav.js asserts every one of them lives in exactly one hub.
// A view that falls out of every hub is unreachable from the UI while still
// rendering perfectly when navigated to directly, so no other test would
// notice.
//
// Ids are prefixed hub- because three hubs share a name with a view
// ('dashboard', 'roster', 'schedule') and the two are looked up separately.
//
// `related` lists views that highlight a hub WITHOUT being tabs. playerProfile
// is opened by clicking a player name from half a dozen screens; it belongs to
// no tab strip, but blanking the sidebar while you read a player would look
// like a bug.
const NAV_HUBS = [
  { id: 'hub-dashboard', label: 'Dashboard', views: ['dashboard'] },
  { id: 'hub-career', label: 'Career', views: ['playerDashboard', 'legacy'] },
  { id: 'hub-roster', label: 'Roster',
    views: ['roster', 'playerComparison', 'careerLedger', 'badges'],
    related: ['playerProfile'] },
  { id: 'hub-schedule', label: 'Schedule', views: ['schedule', 'playoffs'] },
  { id: 'hub-league', label: 'League',
    views: ['standings', 'powerRankings', 'allStarWeekend', 'news', 'feed'] },
  { id: 'hub-transactions', label: 'Transactions',
    views: ['trade', 'freeagency', 'draft', 'scouting', 'salarycap', 'finances', 'coaching'] },
  { id: 'hub-records', label: 'Records',
    views: ['history', 'awards', 'seasonSummary', 'frivolities'] },
  { id: 'hub-system', label: 'System',
    views: ['saveload', 'settings', 'godMode', 'commissioner'] }
];

function hubForView(viewId) {
  for (let i = 0; i < NAV_HUBS.length; i++) {
    const hub = NAV_HUBS[i];
    if (hub.views.indexOf(viewId) !== -1) return hub;
    if (hub.related && hub.related.indexOf(viewId) !== -1) return hub;
  }
  return null;
}

// The three conditional entries, in one place. These rules were previously
// inline in renderNav; the tab strip needs them too, and two copies would
// drift.
function navViewIsVisible(viewId, playMode, gameMode, hasLegacy) {
  if (viewId === 'commissioner') return playMode === 'commissioner';
  if (viewId === 'playerDashboard') return gameMode === 'playerCareer';
  if (viewId === 'legacy') return !!hasLegacy;
  return true;
}

function visibleHubViews(hub, playMode, gameMode, hasLegacy) {
  return hub.views.filter(function (v) {
    return navViewIsVisible(v, playMode, gameMode, hasLegacy);
  });
}

// Tab labels come from NAV_ITEMS so a rename lands in both places at once.
function navLabelFor(viewId) {
  const item = NAV_ITEMS.find(function (i) { return i.id === viewId; });
  return item ? item.label : viewId;
}

// Renders the active hub's sibling views as tabs. Leaves the container empty
// (and so collapsed, via #view-tabs:empty) when there is nothing worth showing:
// a hub with one visible view, a view with no hub at all (pixelGame), or a
// `related` view like playerProfile that highlights a hub without belonging to
// its tab strip.
function renderViewTabs(container, activeView, onNavigate, playMode, gameMode, hasLegacy) {
  container.innerHTML = '';
  const hub = hubForView(activeView);
  if (!hub) return;
  if (hub.views.indexOf(activeView) === -1) return;

  const views = visibleHubViews(hub, playMode, gameMode, hasLegacy);
  if (views.length < 2) return;

  views.forEach(function (viewId) {
    const btn = document.createElement('button');
    btn.textContent = navLabelFor(viewId);
    btn.className = viewId === activeView ? 'view-tab active' : 'view-tab';
    btn.setAttribute('data-view', viewId);
    btn.addEventListener('click', function () {
      // Same rule the sidebar has always had: choosing Roster means MY team,
      // clearing any team being inspected from Standings or Power Rankings.
      if (viewId === 'roster') GameState.inspectTeamId = null;
      onNavigate(viewId);
    });
    container.appendChild(btn);
  });
}

// Renders one button per hub. Clicking a hub lands on its first VISIBLE view,
// not blindly on views[0] — in a GM game the System hub's fourth tab
// (Commissioner) is filtered out, and a career-mode Career hub may have lost
// its Legacy tab, so the landing view has to come from the filtered list.
//
// hasLegacy surfaces the Player Legacy view after a career-mode player retires.
// At that point transitionToGMMode has already cleared gameMode, so the Career
// tab is gone — without this the legacy view was reachable only from the
// one-shot button on the retirement scene, and unreachable forever after.
function renderNav(container, activeView, onNavigate, playMode, gameMode, hasLegacy) {
  container.innerHTML = '';
  const activeHub = hubForView(activeView);

  NAV_HUBS.forEach(function (hub) {
    const views = visibleHubViews(hub, playMode, gameMode, hasLegacy);
    if (views.length === 0) return;   // every view filtered out: skip entirely

    const btn = document.createElement('button');
    btn.textContent = hub.label;
    btn.className = (activeHub && activeHub.id === hub.id) ? 'nav-item active' : 'nav-item';
    btn.setAttribute('data-hub', hub.id);
    btn.addEventListener('click', function () {
      // The sidebar Roster entry always means "my team" — clears any
      // in-progress inspection from clicking a team in Standings/Power
      // Rankings (see script.js's BUILT_VIEWS.roster and ui/standings.js).
      if (views[0] === 'roster') GameState.inspectTeamId = null;
      onNavigate(views[0]);
    });
    container.appendChild(btn);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NAV_ITEMS: NAV_ITEMS,
    NAV_HUBS: NAV_HUBS,
    hubForView: hubForView,
    navViewIsVisible: navViewIsVisible,
    visibleHubViews: visibleHubViews,
    navLabelFor: navLabelFor,
    renderViewTabs: renderViewTabs,
    renderNav: renderNav
  };
}
