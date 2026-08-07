// Browser smoke suite — paste into the devtools console (or evaluate via the
// preview tooling) with the app served by scripts/devserver.py.
//
//   UI_SMOKE.run()        -> runs everything, returns { passed, failed, results }
//   UI_SMOKE.run('views') -> runs one group
//
// WHY THIS EXISTS
// ---------------
// The Node suite (scripts/validate-*.js) covers game logic and, since
// validate-uiSafety.js, the shape of the view source. Neither can see what a
// user actually sees. The schedule's box score shipped "working" by every
// check that was run against it — the markup was in the DOM and the assertions
// passed — while in the browser it rendered ~3,200px below the click, entirely
// off-screen. Clicking a game highlighted the row and appeared to do nothing.
//
// So the rule these assertions encode: for anything a user interacts with,
// assert what is VISIBLE AND REACHABLE, not merely what exists in the DOM.
// "element.querySelectorAll(...).length > 0" is not evidence a feature works.
//
// A second lesson is baked in below: ad-hoc verification snippets were
// themselves buggy (clicking a node detached by a re-render; counting
// `tbody tr` across nested tables instead of counting player cells), producing
// phantom failures that cost real time. Helpers here re-query the live DOM
// after every mutation and count the specific thing being asserted.

const UI_SMOKE = (function () {
  const HOSTILE = 'Zed <img src=x onerror=window.__UI_SMOKE_XSS=1> O\'Neal';

  function ok(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail === undefined ? null : detail };
  }

  function viewContent() { return document.getElementById('view-content'); }

  // ui/nav.js hides some entries by mode; asserting on them regardless would
  // flag correct "not applicable" states as broken views.
  function applicableNavIds() {
    return NAV_ITEMS.filter(function (item) {
      if (item.id === 'playerDashboard') return GameState.gameMode === 'playerCareer';
      if (item.id === 'legacy') return !!GameState.playerLegacy;
      return true;
    }).map(function (item) { return item.id; });
  }

  // Fully inside the viewport, not merely present in the document.
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  // `typeof`, not `window.GameState`: script.js declares GameState with a
  // top-level `const`, which binds in the global LEXICAL environment and is
  // never exposed as a property of window. Same for TEAMS, NAV_ITEMS, and
  // every other const in this codebase.
  function requireSeason() {
    if (typeof GameState === 'undefined' || !GameState.season) {
      throw new Error('Start a game first (pick a team), then re-run UI_SMOKE.');
    }
  }

  // -------------------------------------------------------------------------

  // Every nav-reachable view must render real content and must not throw.
  function checkViews() {
    requireSeason();
    const results = [];
    const ids = applicableNavIds();
    const restoreMode = GameState.playMode;
    GameState.playMode = 'commissioner'; // so the commissioner view is reachable

    ids.forEach(function (id) {
      try {
        renderView(id);
        const vc = viewContent();
        const text = vc.textContent.trim();
        const isPlaceholder = text.indexOf('Coming in a later phase') !== -1;
        results.push(ok('view:' + id, text.length > 20 && !isPlaceholder,
          isPlaceholder ? 'renders the placeholder — no renderer wired' : text.length + ' chars'));
      } catch (e) {
        results.push(ok('view:' + id, false, 'threw: ' + e.message));
      }
    });

    GameState.playMode = restoreMode;
    return results;
  }

  // Hostile text planted everywhere it can originate must never become markup.
  function checkNoInjection() {
    requireSeason();
    delete window.__UI_SMOKE_XSS;
    const results = [];
    const restoreMode = GameState.playMode;

    const roster = getTeamRoster(GameState.userTeamId);
    const victim = roster[0];
    const originalName = victim.name;
    victim.name = HOSTILE;
    if (typeof pushToFeed === 'function') pushToFeed(HOSTILE + ' did something', 1);

    GameState.playMode = 'commissioner';
    applicableNavIds().forEach(function (id) {
      try {
        renderView(id);
        const vc = viewContent();
        const injected = vc.querySelector('img[src="x"], script');
        results.push(ok('injection:' + id, !injected, injected ? 'HOSTILE NAME BECAME MARKUP' : null));
      } catch (e) {
        results.push(ok('injection:' + id, false, 'threw: ' + e.message));
      }
    });
    results.push(ok('injection:no-handler-fired', !window.__UI_SMOKE_XSS));

    victim.name = originalName;
    GameState.playMode = restoreMode;
    return results;
  }

  // Escaped entities must never leak to the user as literal "&amp;" text.
  function checkNoEntityLeak() {
    requireSeason();
    const results = [];
    applicableNavIds().forEach(function (id) {
      try {
        renderView(id);
        const text = viewContent().textContent;
        const leak = text.match(/&(amp|lt|gt|quot|#39);/);
        results.push(ok('entities:' + id, !leak, leak ? 'leaked ' + leak[0] : null));
      } catch (e) {
        results.push(ok('entities:' + id, false, 'threw: ' + e.message));
      }
    });
    return results;
  }

  // THE ONE THAT MATTERED. An expandable row must put its content where the
  // user is looking, and must stay interactive afterwards.
  function checkScheduleBoxScore() {
    requireSeason();
    const results = [];
    renderView('schedule');
    window.scrollTo(0, 0);

    const playable = document.querySelectorAll('tr.is-playable');
    if (playable.length === 0) {
      return [ok('boxscore:has-played-games', false, 'sim some games first')];
    }

    // Re-query after every mutation: a re-render detaches the node you held.
    const rowId = playable[Math.min(2, playable.length - 1)].getAttribute('data-game-id');
    document.querySelector('tr[data-game-id="' + rowId + '"]').click();

    const expanded = document.querySelector('tr.is-expanded');
    // `detail` is ONLY the box-score row. Taking nextElementSibling unconditionally
    // meant that when the detail row was absent, the geometry assertions measured
    // the next ordinary schedule row instead — and passed. Mutation testing caught
    // that: reintroducing the original bug left these two green while the feature
    // was broken. A check that can pass on the wrong element proves nothing.
    const sibling = expanded && expanded.nextElementSibling;
    const detail = (sibling && sibling.classList.contains('schedule-detail-row')) ? sibling : null;
    results.push(ok('boxscore:opens', !!detail,
      detail ? null : 'no .schedule-detail-row directly after the expanded row'));
    results.push(ok('boxscore:inline-under-row', !!detail &&
      Math.abs(detail.getBoundingClientRect().top - expanded.getBoundingClientRect().bottom) <= 1,
      detail ? Math.round(detail.getBoundingClientRect().top - expanded.getBoundingClientRect().bottom) + 'px gap' : 'no detail row'));
    results.push(ok('boxscore:visible-on-screen', !!detail && isVisible(detail)));

    // Count the specific thing being asserted — player cells — not whatever
    // <tr>s happen to nest inside.
    const game = GameState.season.games.find(function (g) { return g.id === Number(rowId); });
    if (detail && game && game.boxScore) {
      const cells = detail.querySelectorAll('td.col-name');
      const names = Array.prototype.map.call(cells, function (c) { return c.textContent; });
      const expectedLines = Object.keys(game.boxScore).length;
      results.push(ok('boxscore:every-line-shown', names.length === expectedLines,
        names.length + ' shown / ' + expectedLines + ' in box score'));
      results.push(ok('boxscore:no-duplicate-lines',
        names.filter(function (n, i) { return names.indexOf(n) !== i; }).length === 0));
    }

    // Still interactive: a second click must collapse it.
    document.querySelector('tr[data-game-id="' + rowId + '"]').click();
    results.push(ok('boxscore:collapses', !document.querySelector('tr.schedule-detail-row')));

    // A game with no stored box score must degrade, not break the row.
    // Must be one of the USER's games — the schedule only lists those, so a
    // league-wide search finds games that have no row to click.
    const withBox = GameState.season.games.find(function (g) {
      return g.played && g.boxScore &&
        (g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId);
    });
    if (withBox) {
      const saved = withBox.boxScore;
      withBox.boxScore = null;
      renderView('schedule');
      const r = document.querySelector('tr[data-game-id="' + withBox.id + '"]');
      let threw = null;
      try { r.click(); } catch (e) { threw = e.message; }
      const d = document.querySelector('tr.schedule-detail-row');
      results.push(ok('boxscore:missing-degrades-gracefully', !threw && !!d, threw));
      document.querySelector('tr[data-game-id="' + withBox.id + '"]').click();
      results.push(ok('boxscore:still-collapses-after-fallback', !document.querySelector('tr.schedule-detail-row')));
      withBox.boxScore = saved;
    }

    return results;
  }

  // The live coaching controls. These assert REACHABILITY, not just presence
  // or visibility: the substitution panel shipped once rendering correctly
  // below #view-content's scroll fold, and the control row shipped occluded
  // by the sim dock. Both passed every DOM-existence check, and both passed a
  // programmatic el.click() — which bypasses hit-testing entirely and is why
  // that verification was a false green. isHitTestable is the assertion that
  // actually caught it.
  function isHitTestable(el) {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  }

  function checkLiveControls() {
    const results = [];
    const view = viewContent();

    const canvas = view.querySelector('#pixel-canvas');
    results.push(ok('live:canvas-visible', isVisible(canvas)));

    const timeout = view.querySelector('#pixel-timeout');
    results.push(ok('live:timeout-reachable', isHitTestable(timeout),
      timeout ? null : 'no #pixel-timeout'));
    results.push(ok('live:timeout-shows-count',
      !!timeout && /Timeout \(\d\)/.test(timeout.textContent),
      timeout ? timeout.textContent : null));

    const subs = view.querySelector('#pixel-subs');
    results.push(ok('live:subs-reachable', isHitTestable(subs) && !subs.disabled));

    if (subs && !subs.disabled) {
      subs.click();
      const panel = viewContent().querySelector('#pixel-subpanel');
      results.push(ok('live:subs-panel-reachable', !!panel && !panel.hidden && isVisible(panel)));
      const onFloor = viewContent().querySelectorAll('#pixel-subpanel .pixel-sub-out');
      results.push(ok('live:five-on-floor', onFloor.length === 5, onFloor.length));
      const bench = viewContent().querySelectorAll('#pixel-subpanel .pixel-sub-in');
      results.push(ok('live:bench-populated', bench.length > 0, bench.length));
      results.push(ok('live:first-floor-player-reachable',
        onFloor.length > 0 && isHitTestable(onFloor[0])));
      viewContent().querySelector('#pixel-subs').click(); // close again
    }

    // The nudge slot must not reserve layout space when empty — a nudge
    // appearing must never shift what is under the user's cursor.
    const slot = view.querySelector('#pixel-nudge-slot');
    results.push(ok('live:nudge-slot-exists', !!slot));
    results.push(ok('live:nudge-slot-is-overlay',
      !!slot && window.getComputedStyle(slot).position === 'absolute',
      slot ? window.getComputedStyle(slot).position : null));

    return results;
  }

  const GROUPS = {
    views: checkViews,
    injection: checkNoInjection,
    entities: checkNoEntityLeak,
    boxscore: checkScheduleBoxScore,
    // Must be run WHILE a live game is open — `UI_SMOKE.run('live')` from the
    // pixel view. It asserts on that view's controls, so running it from the
    // dashboard reports failures that only mean "wrong view".
    live: checkLiveControls
  };

  function run(only) {
    const names = only ? [only] : Object.keys(GROUPS);
    let results = [];
    names.forEach(function (n) {
      try {
        results = results.concat(GROUPS[n]());
      } catch (e) {
        results.push(ok('group:' + n, false, 'threw: ' + e.message));
      }
    });
    const failed = results.filter(function (r) { return !r.pass; });
    if (failed.length) {
      console.error('UI_SMOKE: ' + failed.length + ' FAILED');
      failed.forEach(function (f) { console.error('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : '')); });
    } else {
      console.log('UI_SMOKE: all ' + results.length + ' checks passed');
    }
    return { passed: results.length - failed.length, failed: failed.length, failures: failed, results: results };
  }

  return { run: run, groups: Object.keys(GROUPS) };
})();

// Explicit global assignment so the suite is usable both ways: pasted directly
// into the console, and fetched + eval'd. A top-level `const` inside an
// indirect eval lands in that eval's own scope and never reaches the page.
if (typeof window !== 'undefined') window.UI_SMOKE = UI_SMOKE;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UI_SMOKE: UI_SMOKE };
}
