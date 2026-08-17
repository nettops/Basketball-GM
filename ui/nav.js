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
  { id: 'feats', label: 'Feats' },
  { id: 'gmCareer', label: 'My Career' },
  { id: 'frivolities', label: 'Frivolities' },
  { id: 'careerLedger', label: 'Career Ledger' },
  { id: 'playerComparison', label: 'Compare Players' },
  { id: 'badges', label: 'Badges' },
  { id: 'ultimates', label: 'Ultimates' },
  { id: 'news', label: 'League News' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'trade', label: 'Trade Center' },
  { id: 'freeagency', label: 'Free Agency' },
  { id: 'draft', label: 'Draft' },
  { id: 'scouting', label: 'Scouting' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'affiliate', label: 'Affiliate' },
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
    views: ['roster', 'playerComparison', 'careerLedger', 'badges', 'ultimates'],
    related: ['playerProfile'] },
  { id: 'hub-schedule', label: 'Schedule', views: ['schedule', 'playoffs'] },
  { id: 'hub-league', label: 'League',
    views: ['standings', 'powerRankings', 'allStarWeekend', 'news', 'feed'] },
  { id: 'hub-transactions', label: 'Transactions',
    views: ['trade', 'freeagency', 'transactions', 'affiliate', 'draft', 'scouting', 'salarycap', 'finances', 'coaching'] },
  { id: 'hub-records', label: 'Records',
    views: ['gmCareer', 'history', 'awards', 'feats', 'seasonSummary', 'frivolities'] },
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
// Inline stroke icons, one per hub, all on currentColor so the rail's
// state classes recolor them for free. Inline SVG rather than emoji
// (platform-inconsistent glyphs) or an icon font (zero-dependency rule).
const HUB_ICONS = {
  'hub-dashboard': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  'hub-career': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>',
  'hub-roster': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5v.5"/></svg>',
  'hub-schedule': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  'hub-league': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 4h8v6a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 5M16 6h3a3 3 0 0 1-3 5"/><path d="M12 14v3M8 21h8M10 21v-2a2 2 0 0 1 4 0v2"/></svg>',
  'hub-transactions': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 4l4 4-4 4M21 8H7M7 12l-4 4 4 4M3 16h14"/></svg>',
  'hub-records': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  'hub-system': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>'
};

function renderNav(container, activeView, onNavigate, playMode, gameMode, hasLegacy) {
  container.innerHTML = '';
  const activeHub = hubForView(activeView);

  NAV_HUBS.forEach(function (hub) {
    const views = visibleHubViews(hub, playMode, gameMode, hasLegacy);
    if (views.length === 0) return;   // every view filtered out: skip entirely

    const btn = document.createElement('button');
    // Icon rail: the label lives in a flyout span, so it is still real text
    // in the DOM — anything that finds nav entries by text keeps finding
    // them — and aria-label/title carry it for AT and slow hoverers.
    btn.className = (activeHub && activeHub.id === hub.id) ? 'rail-item active' : 'rail-item';
    btn.setAttribute('data-hub', hub.id);
    btn.setAttribute('aria-label', hub.label);
    btn.title = hub.label;
    btn.innerHTML = (HUB_ICONS[hub.id] || HUB_ICONS['hub-dashboard']) +
      '<span class="rail-label">' + hub.label + '</span>';
    btn.addEventListener('click', function () {
      // The sidebar Roster entry always means "my team" — clears any
      // in-progress inspection from clicking a team in Standings/Power
      // Rankings (see script.js's BUILT_VIEWS.roster and ui/standings.js).
      if (views[0] === 'roster') GameState.inspectTeamId = null;
      onNavigate(views[0]);
    });
    container.appendChild(btn);
  });

  // Way out of the career, pinned to the bottom of the rail (the spacer takes
  // up the slack above it). Deliberately separated from the hub icons: it is
  // not somewhere to navigate to, it ends the session — and it sits far from
  // the icons the player uses constantly so it is hard to hit by accident.
  //
  // Calls the global directly rather than taking a seventh positional callback,
  // the same way ui/saveLoad.js already calls renderView. requestReturnToMenu
  // owns the confirm and the save offer; none of that belongs in here.
  const spacer = document.createElement('div');
  spacer.className = 'rail-spacer';
  container.appendChild(spacer);

  const exit = document.createElement('button');
  exit.className = 'rail-item rail-exit';
  exit.setAttribute('aria-label', 'Main menu');
  exit.title = 'Main menu';
  exit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
    '<polyline points="16 17 21 12 16 7"></polyline>' +
    '<line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
    '<span class="rail-label">Main menu</span>';
  exit.addEventListener('click', function () { requestReturnToMenu(false); });
  container.appendChild(exit);
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
