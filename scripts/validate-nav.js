// The sidebar renders NAV_HUBS, but NAV_ITEMS is still the canonical list of
// every navigable view. The failure that matters is a view that falls out of
// every hub: it becomes unreachable from the UI while every other test in the
// suite still passes, because the view itself renders perfectly well. These
// are pure data invariants, so they need no DOM.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const nav = require(path.join(__dirname, '..', 'ui', 'nav.js'));

const ALL_VIEW_IDS = nav.NAV_ITEMS.map(function (i) { return i.id; });

function allHubViews() {
  return nav.NAV_HUBS.reduce(function (acc, hub) { return acc.concat(hub.views); }, []);
}

function checkEveryNavViewLivesInExactlyOneHub() {
  const placed = allHubViews();
  const missing = ALL_VIEW_IDS.filter(function (id) { return placed.indexOf(id) === -1; });
  assert.deepStrictEqual(missing, [],
    'views in NAV_ITEMS but in no hub (unreachable from the sidebar): ' + missing.join(', '));

  const seen = {};
  const duplicated = placed.filter(function (id) {
    const dup = seen[id] === true;
    seen[id] = true;
    return dup;
  });
  assert.deepStrictEqual(duplicated, [],
    'views listed in more than one hub (two highlighted parents): ' + duplicated.join(', '));
  console.log('checkEveryNavViewLivesInExactlyOneHub: OK (' + ALL_VIEW_IDS.length + ' views)');
}
checkEveryNavViewLivesInExactlyOneHub();

function checkNoHubListsAnUnknownView() {
  const unknown = allHubViews().filter(function (id) { return ALL_VIEW_IDS.indexOf(id) === -1; });
  assert.deepStrictEqual(unknown, [],
    'hubs list view ids that are not in NAV_ITEMS: ' + unknown.join(', '));
  console.log('checkNoHubListsAnUnknownView: OK');
}
checkNoHubListsAnUnknownView();

function checkEveryHubHasADefaultViewWithARenderer() {
  // BUILT_VIEWS is a script.js object literal that Node cannot require (the
  // file is a browser global script), so parse it the same way
  // validate-uiSafety.js does.
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const built = scriptSrc.slice(scriptSrc.indexOf('const BUILT_VIEWS'),
    scriptSrc.indexOf('function isRegularSeasonAndPlayoffsComplete'));

  nav.NAV_HUBS.forEach(function (hub) {
    assert.ok(hub.views.length > 0, hub.id + ' has no views');
    assert.ok(hub.label && hub.label.length > 0, hub.id + ' has no label');
    assert.ok(/^hub-/.test(hub.id), hub.id + ' must be prefixed hub- so it cannot collide with a view id');
    const landing = hub.views[0];
    assert.ok(new RegExp('(^|[\\s{,])' + landing + '\\s*:').test(built),
      hub.id + ' lands on ' + landing + ', which has no renderer in BUILT_VIEWS');
  });
  console.log('checkEveryHubHasADefaultViewWithARenderer: OK (' + nav.NAV_HUBS.length + ' hubs)');
}
checkEveryHubHasADefaultViewWithARenderer();

function checkRelatedViewsAreRealAndNotTabs() {
  const tabs = allHubViews();
  nav.NAV_HUBS.forEach(function (hub) {
    (hub.related || []).forEach(function (id) {
      assert.strictEqual(tabs.indexOf(id), -1,
        id + ' is both a tab and a related view of ' + hub.id + '; it must be one or the other');
      assert.strictEqual(nav.hubForView(id).id, hub.id,
        'hubForView(' + id + ') should resolve to ' + hub.id);
    });
  });
  console.log('checkRelatedViewsAreRealAndNotTabs: OK');
}
checkRelatedViewsAreRealAndNotTabs();

function checkHubForViewResolvesEveryNavView() {
  ALL_VIEW_IDS.forEach(function (id) {
    const hub = nav.hubForView(id);
    assert.ok(hub, 'hubForView(' + id + ') returned null');
  });
  assert.strictEqual(nav.hubForView('pixelGame'), null,
    'pixelGame has no hub and must resolve to null, not throw');
  assert.strictEqual(nav.hubForView('nonsense'), null, 'an unknown view resolves to null');
  console.log('checkHubForViewResolvesEveryNavView: OK');
}
checkHubForViewResolvesEveryNavView();

function checkConditionalViewVisibility() {
  assert.strictEqual(nav.navViewIsVisible('commissioner', 'gm', null, false), false,
    'commissioner is hidden outside commissioner mode');
  assert.strictEqual(nav.navViewIsVisible('commissioner', 'commissioner', null, false), true);
  assert.strictEqual(nav.navViewIsVisible('playerDashboard', 'gm', 'gm', false), false,
    'Career is hidden outside player-career mode');
  assert.strictEqual(nav.navViewIsVisible('playerDashboard', 'gm', 'playerCareer', false), true);
  assert.strictEqual(nav.navViewIsVisible('legacy', 'gm', 'gm', false), false);
  assert.strictEqual(nav.navViewIsVisible('legacy', 'gm', 'gm', true), true);
  assert.strictEqual(nav.navViewIsVisible('roster', 'gm', 'gm', false), true,
    'an ordinary view is always visible');
  console.log('checkConditionalViewVisibility: OK');
}
checkConditionalViewVisibility();

function checkGmModeShowsSevenHubs() {
  // The whole point of the project: a standard GM game must not show more
  // than seven sidebar entries.
  const visible = nav.NAV_HUBS.filter(function (hub) {
    return nav.visibleHubViews(hub, 'gm', 'gm', false).length > 0;
  });
  assert.strictEqual(visible.length, 7,
    'a GM game should show 7 hubs, got ' + visible.map(function (h) { return h.id; }).join(', '));

  const career = nav.NAV_HUBS.filter(function (hub) {
    return nav.visibleHubViews(hub, 'gm', 'playerCareer', false).length > 0;
  });
  assert.strictEqual(career.length, 8, 'career mode adds the Career hub');
  console.log('checkGmModeShowsSevenHubs: OK');
}
checkGmModeShowsSevenHubs();

function checkLabelsResolve() {
  assert.strictEqual(nav.navLabelFor('seasonSummary'), 'Season Recap',
    'tab labels come from NAV_ITEMS so the sidebar and tabs never drift');
  assert.strictEqual(nav.navLabelFor('nonsense'), 'nonsense', 'an unknown id falls back to itself');
  console.log('checkLabelsResolve: OK');
}
checkLabelsResolve();

console.log('All nav validations passed');
