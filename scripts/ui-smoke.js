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
        // renderView can REFUSE to navigate — it now asks before abandoning a
        // live watched game. Without this postcondition check every assertion
        // below runs against whatever is still on screen and passes, which is
        // precisely the kind of false green this file exists to prevent.
        if (GameState.currentView !== id) {
          results.push(ok('view:' + id, false,
            'navigation refused — a live watched game is holding it; finish or exit that game first'));
          return;
        }
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
    // GameState.feed is REAL game state, not a scratch buffer: save.js
    // serializes it and ui/dashboard.js renders its tail as the Dashboard
    // headlines. Pushing the hostile string below used to leave it in the
    // league forever — the player name was restored, the feed entry never was —
    // so running the smoke suite wrote "Zed <img src=x ...> O'Neal did
    // something" into the user's save and it showed up under Headlines.
    const originalFeed = GameState.feed.slice();

    // try/finally, not straight-line restore at the end. Only renderView sits
    // inside a per-view catch; a throw anywhere else in this block used to
    // strand the hostile name on a real player and the payload in the feed.
    try {
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
    } finally {
      victim.name = originalName;
      // In place, not reassigned: anything holding a reference to the array
      // keeps seeing the live feed.
      GameState.feed.length = 0;
      Array.prototype.push.apply(GameState.feed, originalFeed);
      GameState.playMode = restoreMode;
    }

    // A test that dirties the save it runs against is worse than no test. This
    // asserts the cleanup actually happened — it is what would have caught the
    // leak above, and it fails loudly if a future edit reintroduces it.
    const stranded = GameState.feed.filter(function (e) {
      return e && typeof e.text === 'string' && e.text.indexOf('__UI_SMOKE_XSS') !== -1;
    }).length;
    results.push(ok('injection:leaves-no-trace',
      stranded === 0 && victim.name === originalName,
      stranded > 0 ? stranded + ' hostile feed entries left behind' : null));

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

    // This group asserts on the pixel view's own controls, so running it from
    // anywhere else reported eight failures that only meant "wrong view" — on
    // every single full run. A suite that always shows failures teaches you to
    // stop reading them, which is worse than having no suite. Report the skip
    // instead, and say how to run it for real.
    if (typeof GameState !== 'undefined' && GameState.currentView !== 'pixelGame') {
      return [ok('live:skipped-not-watching', true,
        'start a watched game, then UI_SMOKE.run("live")')];
    }

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

      // The panel must be closable from ITSELF. It can be opened by a nudge
      // without the user touching the Subs toggle, and that toggle can sit
      // below #view-content's scroll fold — which left the panel open with
      // its only exit off-screen.
      const closeBtn = viewContent().querySelector('#pixel-sub-close');
      results.push(ok('live:sub-panel-has-close', !!closeBtn));
      results.push(ok('live:sub-panel-close-reachable', isHitTestable(closeBtn)));
      if (closeBtn) closeBtn.click();
      results.push(ok('live:sub-panel-closes-from-itself',
        !!viewContent().querySelector('#pixel-subpanel').hidden));
    }

    // The nudge slot must not reserve layout space when empty — a nudge
    // appearing must never shift what is under the user's cursor.
    const slot = view.querySelector('#pixel-nudge-slot');
    results.push(ok('live:nudge-slot-exists', !!slot));
    results.push(ok('live:nudge-slot-is-overlay',
      !!slot && window.getComputedStyle(slot).position === 'absolute',
      slot ? window.getComputedStyle(slot).position : null));

    // A nudge must always be closable by hand. Expiry runs on the playback
    // clock, which stops when the user pauses — so without a dismiss control
    // a paused nudge sat on screen permanently. Rendered directly here rather
    // than waiting for a real one, so this holds regardless of game state.
    if (slot && typeof pixelRenderNudge === 'function') {
      const hadNudge = !!slot.querySelector('.pixel-nudge');
      if (!hadNudge) {
        pixelRenderNudge(slot, { kind: 'run', text: 'smoke test', actionLabel: 'Act' });
        const x = slot.querySelector('#pixel-nudge-dismiss');
        results.push(ok('live:nudge-has-dismiss', !!x));
        results.push(ok('live:nudge-dismiss-reachable', isHitTestable(x)));
        pixelRenderNudge(slot, null);   // leave the slot as we found it
        results.push(ok('live:nudge-slot-restored', !slot.querySelector('.pixel-nudge')));
      }
    }

    // Leaving a live game finishes it irreversibly, so it must ask first —
    // on EVERY exit route, including the sidebar. Raised directly here rather
    // than by actually navigating, so the check cannot strand the suite on
    // another view.
    const confirmEl = view.querySelector('#pixel-leave-confirm');
    results.push(ok('live:leave-confirm-exists', !!confirmEl));
    results.push(ok('live:leave-confirm-hidden-by-default',
      !!confirmEl && confirmEl.hidden));
    if (confirmEl && typeof confirmLeaveLiveGame === 'function') {
      const proceeded = confirmLeaveLiveGame('dashboard');
      results.push(ok('live:leaving-is-gated', proceeded === false,
        proceeded === true ? 'navigation was allowed without asking' : null));
      results.push(ok('live:leave-confirm-visible-when-raised', !confirmEl.hidden));
      const stay = view.querySelector('#pixel-leave-stay');
      const go = view.querySelector('#pixel-leave-go');
      results.push(ok('live:leave-confirm-buttons-reachable',
        isHitTestable(stay) && isHitTestable(go)));
      if (stay) stay.click();   // dismiss; must not leave the game
      results.push(ok('live:keep-watching-dismisses', confirmEl.hidden));
    }

    return results;
  }

  // The dock's whole point is that there is one primary action. A regression
  // here means the ten controls crept back, or Continue became unreachable.
  function checkDock() {
    requireSeason();
    const results = [];
    const dock = document.getElementById('sim-controls');

    const cont = dock.querySelector('#sim-continue');
    results.push(ok('dock:continue-reachable', isHitTestable(cont)));
    // The primary button is Continue, Stop mid-run, or "Your pick" while the
    // draft is waiting on the user. Anything else means continueLabel fell
    // through to a state it does not handle — and a wrong label here is a
    // promise about what the next click does.
    results.push(ok('dock:continue-labelled',
      !!cont && /^(Continue|Stop|Your pick)/.test(cont.textContent.trim()),
      cont ? cont.textContent : null));
    // A disabled primary must always explain itself, or it reads as broken.
    results.push(ok('dock:disabled-continue-is-explained',
      !cont || !cont.disabled ||
        /Your pick/.test(cont.textContent) ||
        (typeof isLiveWatchPending === 'function' && isLiveWatchPending()),
      cont ? 'disabled with label: ' + cont.textContent : null));

    const watch = dock.querySelector('#sim-watch-game');
    results.push(ok('dock:watch-reachable', isHitTestable(watch)));

    const skip = dock.querySelector('#sim-skip-to');
    results.push(ok('dock:skip-menu-reachable', isHitTestable(skip)));
    results.push(ok('dock:skip-go-reachable', isHitTestable(dock.querySelector('#sim-skip-go'))));

    // At most three elements visible at once: the quantity input stays hidden
    // until a target that needs it is chosen.
    const qty = dock.querySelector('#sim-skip-qty');
    const needsQty = skip && (skip.value === 'seasons' || skip.value === 'days');
    results.push(ok('dock:skip-qty-hidden-unless-needed',
      !!qty && (needsQty ? !qty.hidden : qty.hidden),
      qty ? 'value=' + (skip ? skip.value : '?') + ' hidden=' + qty.hidden : null));

    // The ten controls this replaced must be gone, not hidden.
    const retired = ['sim-next-game', 'sim-next-day', 'sim-to-end', 'sim-to-deadline',
      'sim-to-draft', 'sim-to-fa', 'sim-n-seasons-btn', 'sim-until-championship', 'sim-n-days-btn'];
    const survivors = retired.filter(function (id) { return !!document.getElementById(id); });
    results.push(ok('dock:old-controls-removed', survivors.length === 0, survivors.join(', ') || null));

    // ...and so must the three ceremonial offseason buttons Continue absorbed.
    // While these existed there were two ways through the offseason, and only
    // one of them was being maintained.
    const ceremonial = ['advance-offseason-btn', 'advance-to-fa-btn', 'start-new-season-btn'];
    const stillThere = ceremonial.filter(function (id) { return !!document.getElementById(id); });
    results.push(ok('dock:ceremonial-buttons-removed', stillThere.length === 0, stillThere.join(', ') || null));

    // Undo/Redo and speed are not time controls and must survive.
    results.push(ok('dock:undo-still-present', !!document.getElementById('sim-undo-btn')));
    results.push(ok('dock:speed-still-present', !!document.getElementById('sim-speed')));

    // The status line is the only channel that tells the player WHY a run
    // stopped, and it silently failed for the whole of this project's life:
    // #sim-status lives inside the dock's innerHTML, so a reference captured
    // before a re-render points at a detached node and every write vanishes.
    // Asserting the write actually lands is the only way that stays fixed.
    if (typeof setSimStatus === 'function') {
      const statusEl = dock.querySelector('#sim-status');
      const before = statusEl ? statusEl.textContent : '';
      const sentinel = 'smoke-status-probe';
      setSimStatus(sentinel);
      const live = dock.querySelector('#sim-status');
      results.push(ok('dock:status-line-receives-writes',
        !!live && live.textContent === sentinel,
        live ? live.textContent : 'no #sim-status'));
      setSimStatus(before);
    }

    return results;
  }

  // The sidebar is the project's whole deliverable, so these assert what a
  // user can see and click rather than what exists. The last check is the one
  // that matters: every view still reachable by clicking hubs and tabs. A view
  // orphaned from all hubs renders perfectly when navigated to directly, so
  // nothing else in this suite would notice it had become unreachable.
  function checkNav() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;

    const hubs = Array.from(document.querySelectorAll('#nav-bar .nav-item'));
    results.push(ok('nav:hub-count', hubs.length === 7, hubs.length + ' hubs'));
    results.push(ok('nav:hubs-reachable', hubs.every(isHitTestable),
      hubs.filter(function (h) { return !isHitTestable(h); })
        .map(function (h) { return h.textContent; }).join(', ') || null));

    renderView('dashboard');
    results.push(ok('nav:dashboard-has-no-tabs',
      document.querySelectorAll('#view-tabs .view-tab').length === 0));

    renderView('standings');
    const tabs = Array.from(document.querySelectorAll('#view-tabs .view-tab'));
    results.push(ok('nav:tabs-render-for-hub', tabs.length === 5, tabs.length + ' tabs on League'));
    results.push(ok('nav:tabs-reachable', tabs.length > 0 && tabs.every(isHitTestable)));
    results.push(ok('nav:active-tab-marked',
      document.querySelectorAll('#view-tabs .view-tab.active').length === 1));

    // Reached directly, not by clicking its hub — this is how the sim dock and
    // the offseason navigate, and the highlight must still follow. Matched on
    // data-hub rather than the label so a copy change cannot fail the test.
    renderView('frivolities');
    const active = document.querySelector('#nav-bar .nav-item.active');
    results.push(ok('nav:hub-highlighted-on-direct-nav',
      !!active && active.getAttribute('data-hub') === 'hub-records',
      active ? active.textContent : 'none'));

    renderView('playerProfile');
    const profileHub = document.querySelector('#nav-bar .nav-item.active');
    results.push(ok('nav:related-view-keeps-hub-highlighted',
      !!profileHub && profileHub.getAttribute('data-hub') === 'hub-roster',
      profileHub ? profileHub.textContent : 'none'));
    results.push(ok('nav:related-view-has-no-tabs',
      document.querySelectorAll('#view-tabs .view-tab').length === 0));

    // Re-query by index each iteration: clicking a hub re-renders the sidebar
    // and detaches every button captured beforehand. A detached node still
    // fires its listener, so a cached loop looks like it works while
    // asserting against elements no longer on the page.
    const reachable = [];
    const hubCount = document.querySelectorAll('#nav-bar .nav-item').length;
    for (let i = 0; i < hubCount; i++) {
      document.querySelectorAll('#nav-bar .nav-item')[i].click();
      reachable.push(GameState.currentView);
      document.querySelectorAll('#view-tabs .view-tab').forEach(function (t) {
        reachable.push(t.getAttribute('data-view'));
      });
    }
    const expected = applicableNavIds().filter(function (id) { return id !== 'commissioner'; });
    const unreachable = expected.filter(function (id) { return reachable.indexOf(id) === -1; });
    results.push(ok('nav:every-view-reachable', unreachable.length === 0,
      unreachable.join(', ') || null));

    renderView(startView);
    return results;
  }

  // A numeric column whose header aligns one way and whose values align the
  // other is unreadable once the column is wide. This regressed silently
  // because style.css DOES carry `th.num { text-align: right }` — but
  // `.data-table th { text-align: left }` sits later at identical (0,1,1)
  // specificity and beat it, app-wide, for every table in the game. Nothing
  // else in this suite looks at computed style, so nothing else could notice.
  function checkTableAlignment() {
    requireSeason();
    const results = [];
    const offenders = [];

    // Sweep every view so this covers all tables, not just today's roster.
    const restoreView = GameState.currentView;
    applicableNavIds().forEach(function (id) {
      try {
        renderView(id);
      } catch (e) {
        return;
      }
      document.querySelectorAll('#view-content table.data-table').forEach(function (table) {
        const ths = table.querySelectorAll('thead th.num');
        const tds = table.querySelectorAll('tbody td.num');
        if (ths.length === 0 || tds.length === 0) return;
        const thAlign = getComputedStyle(ths[0]).textAlign;
        const tdAlign = getComputedStyle(tds[0]).textAlign;
        if (thAlign !== tdAlign) {
          offenders.push(id + ': th=' + thAlign + ' td=' + tdAlign);
        }
      });
    });
    renderView(restoreView);

    results.push(ok('align:numeric-headers-match-values', offenders.length === 0,
      offenders.slice(0, 5).join('; ') || null));
    return results;
  }

  // Short labels that name one thing must not be broken across lines. The
  // topbar identity was squeezed to 46px by the status chips competing for the
  // same flex row, so "Eastern · Atlantic" rendered as three lines with the
  // separator stranded alone on the middle one. Like the alignment check above,
  // this is invisible to any assertion that only looks at markup — the text was
  // all present and correct, it was the box that was wrong.
  function checkChromeLabels() {
    requireSeason();
    const results = [];
    const offenders = [];

    // Squeezed-below-natural-width is the actual defect; line count is how it
    // shows up. Check both so a future clip-instead-of-wrap also trips this.
    ['.identity-name', '.identity-meta', '.chip-label', '.chip-value'].forEach(function (sel) {
      document.querySelectorAll('.topbar ' + sel).forEach(function (el) {
        const text = (el.textContent || '').trim();
        if (!text) return;
        const box = el.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 0;
        if (lineHeight > 0 && box.height > lineHeight * 1.5) {
          offenders.push(sel + ' wrapped to ' + Math.round(box.height / lineHeight) + ' lines: "' + text + '"');
        }
        if (el.scrollWidth > Math.ceil(box.width) + 1) {
          offenders.push(sel + ' squeezed to ' + Math.round(box.width) + 'px, needs ' + el.scrollWidth + 'px: "' + text + '"');
        }
      });
    });

    const bar = document.querySelector('.topbar');
    results.push(ok('chrome:topbar-does-not-clip',
      !bar || bar.scrollWidth <= bar.clientWidth + 1,
      bar ? bar.scrollWidth + '>' + bar.clientWidth : 'no topbar'));
    results.push(ok('chrome:labels-render-on-one-line', offenders.length === 0,
      offenders.slice(0, 5).join('; ') || null));
    return results;
  }

  const GROUPS = {
    views: checkViews,
    injection: checkNoInjection,
    entities: checkNoEntityLeak,
    boxscore: checkScheduleBoxScore,
    align: checkTableAlignment,
    chrome: checkChromeLabels,
    nav: checkNav,
    dock: checkDock,
    // Must be run WHILE a live game is open — `UI_SMOKE.run('live')` from the
    // pixel view. From anywhere else it reports a single skip rather than
    // asserting on controls that are not on screen.
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
