const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Team' },
  { id: 'playerDashboard', label: 'Career', group: 'Team' },
  { id: 'legacy', label: 'Player Legacy', group: 'Team' },
  { id: 'roster', label: 'Roster', group: 'Team' },
  { id: 'schedule', label: 'Schedule', group: 'Team' },
  { id: 'playoffs', label: 'Playoffs', group: 'Team' },
  { id: 'allStarWeekend', label: 'All-Star Weekend', group: 'League' },
  { id: 'standings', label: 'Standings', group: 'League' },
  { id: 'powerRankings', label: 'Power Rankings', group: 'League' },
  { id: 'awards', label: 'Awards', group: 'League' },
  { id: 'seasonSummary', label: 'Season Recap', group: 'League' },
  { id: 'history', label: 'History', group: 'League' },
  { id: 'frivolities', label: 'Frivolities', group: 'League' },
  { id: 'careerLedger', label: 'Career Ledger', group: 'League' },
  { id: 'playerComparison', label: 'Compare Players', group: 'League' },
  { id: 'news', label: 'League News', group: 'League' },
  { id: 'feed', label: 'Live Feed', group: 'League' },
  { id: 'trade', label: 'Trade Center', group: 'Transactions' },
  { id: 'freeagency', label: 'Free Agency', group: 'Transactions' },
  { id: 'draft', label: 'Draft', group: 'Transactions' },
  { id: 'scouting', label: 'Scouting', group: 'Transactions' },
  { id: 'salarycap', label: 'Salary Cap', group: 'Transactions' },
  { id: 'finances', label: 'Team Finances', group: 'Transactions' },
  { id: 'coaching', label: 'Coaching', group: 'Transactions' },
  { id: 'saveload', label: 'Save/Load', group: 'System' },
  { id: 'settings', label: 'Settings', group: 'System' },
  { id: 'commissioner', label: 'Commissioner', group: 'System' },
  { id: 'godMode', label: 'God Mode', group: 'System' }
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
    views: ['roster', 'playerComparison', 'careerLedger'],
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

const NAV_GROUP_ORDER = ['Team', 'League', 'Transactions', 'System'];

// hasLegacy surfaces the Player Legacy view after a career-mode player retires.
// At that point transitionToGMMode has already cleared gameMode, so the Career
// item is gone — without this the legacy view was reachable only from the
// one-shot button on the retirement scene, and unreachable forever after.
function renderNav(container, activeView, onNavigate, playMode, gameMode, hasLegacy) {
  container.innerHTML = '';
  NAV_GROUP_ORDER.forEach(function (group) {
    const items = NAV_ITEMS.filter(function (item) {
      if (item.group !== group) return false;
      if (item.id === 'commissioner' && playMode !== 'commissioner') return false;
      if (item.id === 'playerDashboard' && gameMode !== 'playerCareer') return false;
      if (item.id === 'legacy' && !hasLegacy) return false;
      return true;
    });
    if (items.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group;
    groupEl.appendChild(label);

    items.forEach(function (item) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.className = item.id === activeView ? 'nav-item active' : 'nav-item';
      btn.addEventListener('click', function () {
        // The sidebar Roster link always means "my team" — clears any
        // in-progress inspection from clicking a team in Standings/Power
        // Rankings (see script.js's BUILT_VIEWS.roster and ui/standings.js).
        if (item.id === 'roster') GameState.inspectTeamId = null;
        onNavigate(item.id);
      });
      groupEl.appendChild(btn);
    });

    container.appendChild(groupEl);
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
