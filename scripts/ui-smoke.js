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

  // Skill-check breakdowns. Rendered against a HAND-BUILT log rather than a real
  // game so the assertion pins exact content — a real game's checks vary by seed,
  // and "some breakdown appeared" is the kind of weak assertion this file exists
  // to avoid. The mixed shapes are the point: a bare-string header, a bare-string
  // play with no contest, and a play carrying a check must all render correctly
  // from the same array.
  //
  // Its OWN group, deliberately. These first lived at the end of
  // checkScheduleBoxScore, which returns early when no games have been simmed —
  // so in a fresh session they would have silently never run. playByPlayHtml is
  // a pure function and needs no season, and a check that requires setup it does
  // not actually need is a check that quietly does not execute.
  function checkPlayByPlayBreakdown() {
    const results = [];
    const fakeGame = { playByPlay: [
      '--- Q1 ---',
      'Horford grabs the defensive rebound',
      { text: 'Tatum drills a 3-pointer', check: {
        kind: 'shot', base: 0.33,
        attack: { label: 'shootingThree', value: 82, scale: 250, energy: 1 },
        defend: { label: 'defensePerimeter', value: 61, scale: 350, energy: 1 },
        modifiers: [{ label: 'Sharpshooter (gold)', value: 0.01 }, { label: 'noise', value: 0.0001 }],
        probability: 0.41, roll: 0.22, passed: true
      } }
    ] };
    const pbp = playByPlayHtml(fakeGame);
    results.push(ok('pbp:names-attacking-rating', pbp.indexOf('shootingThree 82') !== -1));
    results.push(ok('pbp:names-defending-rating', pbp.indexOf('defensePerimeter 61') !== -1));
    results.push(ok('pbp:itemises-each-modifier', pbp.indexOf('Sharpshooter (gold) +1.0%') !== -1));
    results.push(ok('pbp:drops-noise-modifiers', pbp.indexOf('noise') === -1,
      'a +0.01% term must not print as "+0.0%"'));
    results.push(ok('pbp:shows-the-roll', pbp.indexOf('41.0% needed, rolled 22.0%') !== -1));
    results.push(ok('pbp:quarter-header-still-plain', pbp.indexOf('pbp-quarter') !== -1));
    results.push(ok('pbp:contestless-play-not-expandable',
      pbp.indexOf('<div class="pbp-line">Horford grabs the defensive rebound</div>') !== -1,
      'a rebound has no check and must stay a plain line'));
    results.push(ok('pbp:checked-play-is-expandable', pbp.indexOf('pbp-line-expandable') !== -1));

    // Expanding must actually reveal the breakdown on screen, not merely put it
    // in the DOM — the whole reason this file exists (see the header comment).
    //
    // PREPENDED, not appended. Appending put the host ~1750px down a page whose
    // scrollHeight was 1712 — below the scrollable area entirely, so it could
    // not even be scrolled to. isVisible then reported false for BOTH the
    // collapsed and expanded cases, which made "hidden until expanded" pass for
    // the wrong reason and hid a real CSS bug: `.pbp-check { display: flex }`
    // overrode the UA rule that hides a closed <details>'s children, so the
    // breakdown rendered while collapsed. Measuring inside the viewport is what
    // exposed it. Off-screen is not the same as hidden.
    const host = document.createElement('div');
    host.innerHTML = pbp;
    document.body.insertBefore(host, document.body.firstChild);
    const det = host.querySelector('details.pbp-line-expandable');
    const body = det && det.querySelector('.pbp-check');
    results.push(ok('pbp:breakdown-hidden-until-expanded', !!body && !isVisible(body),
      body ? 'collapsed height ' + body.getBoundingClientRect().height : 'no breakdown node'));
    if (det) det.open = true;
    results.push(ok('pbp:breakdown-visible-when-expanded', !!body && isVisible(body),
      body ? 'expanded height ' + body.getBoundingClientRect().height : 'no breakdown node'));
    document.body.removeChild(host);

    // The LIVE-VIEW breakdown. This is the assertion the whole skill-check
    // project exists for: a rich structure that nothing reads is the dead-path
    // bug that let 15 traits sit unread through seven calibration tasks. If
    // pixelPushCommentary ignores its `check` argument, the structure is
    // decorative and these fail.
    const feed = document.createElement('div');
    document.body.insertBefore(feed, document.body.firstChild);

    pixelPushCommentary(feed, 'Tatum posterizes Davis', {
      kind: 'shot',
      attack: { label: 'shootingInside', value: 88, scale: 250, energy: 1 },
      defend: { label: 'defenseInterior', value: 55, scale: 350, energy: 1 },
      modifiers: [{ label: 'Finisher (hof)', value: 0.017 }, { label: 'noise', value: 0.0001 }],
      probability: 0.66, roll: 0.31, passed: true
    });
    const impactLine = feed.firstChild;
    const impactDetail = impactLine && impactLine.querySelector('.pixel-commentary-check');
    results.push(ok('hud:impact-shows-breakdown', !!impactDetail));
    const dtext = impactDetail ? impactDetail.textContent : '';
    results.push(ok('hud:names-attacking-rating', dtext.indexOf('shootingInside 88') !== -1, dtext));
    results.push(ok('hud:names-defending-rating', dtext.indexOf('vs defenseInterior 55') !== -1));
    results.push(ok('hud:itemises-modifiers', dtext.indexOf('Finisher (hof) +1.7%') !== -1));
    results.push(ok('hud:drops-noise-modifiers', dtext.indexOf('noise') === -1));
    results.push(ok('hud:shows-the-roll', dtext.indexOf('66% → 31%') !== -1));
    results.push(ok('hud:breakdown-visible', !!impactDetail && isVisible(impactDetail)));
    // The caption itself must survive alongside the breakdown.
    results.push(ok('hud:caption-still-present',
      !!impactLine && impactLine.textContent.indexOf('Tatum posterizes Davis') === 0));

    // An ordinary possession passes null and must stay a bare caption — at ~91
    // possessions a side, a breakdown on every line would stop being read.
    pixelPushCommentary(feed, 'Brown brings it up', null);
    const plainLine = feed.firstChild;
    results.push(ok('hud:ordinary-play-has-no-breakdown',
      !!plainLine && !plainLine.querySelector('.pixel-commentary-check')));

    document.body.removeChild(feed);

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
  // Switching views used to inherit the previous view's scroll offset, so
  // reading the standings to the bottom and then opening the roster dropped you
  // into the middle of the roster with no indication you weren't at the top.
  // The reset has to be conditional: views re-render in place to sort and
  // filter, and resetting there would fight the user on every column click.
  function checkScrollOnNavigate() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;
    const vc = document.getElementById('view-content');

    renderView('standings');
    vc.scrollTop = 400;
    const parked = vc.scrollTop;
    if (parked === 0) {
      // Nothing to prove if the view is too short to scroll at this size.
      results.push(ok('nav:scroll-resets-on-view-change', true, 'skipped — standings not scrollable here'));
      results.push(ok('nav:scroll-survives-same-view-rerender', true, 'skipped'));
      renderView(startView);
      return results;
    }

    renderView('roster');
    results.push(ok('nav:scroll-resets-on-view-change', vc.scrollTop === 0,
      'landed at ' + vc.scrollTop + ' after switching views'));

    vc.scrollTop = 300;
    renderView('roster');   // same view: a sort/filter redraw
    results.push(ok('nav:scroll-survives-same-view-rerender', vc.scrollTop === 300,
      'same-view redraw moved scroll to ' + vc.scrollTop));

    renderView(startView);
    return results;
  }

  function checkNav() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;

    // [data-hub], not bare .rail-item: the Main menu exit button carries the
    // same rail-item class for styling (ui/nav.js:195) but is not a hub.
    // Counting it read 8 here — and worse, the reachability loop below clicked
    // it, which opens the "Leave this career?" overlay. Nothing dismissed it,
    // so every later group hit-tested against a modal and the whole dock group
    // reported its controls unreachable.
    const hubs = Array.from(document.querySelectorAll('#nav-bar .rail-item[data-hub]'));
    // Derived rather than a literal: which hubs render depends on play mode and
    // career state (renderNav skips any hub whose views all filter out), so the
    // count legitimately moves. A hardcoded 7 went stale the moment hub-career
    // was added. Same arguments script.js:789 passes renderNav.
    const expectedHubs = NAV_HUBS.filter(function (h) {
      return visibleHubViews(h, GameState.playMode, GameState.gameMode, !!GameState.playerLegacy).length > 0;
    }).length;
    results.push(ok('nav:hub-count', hubs.length === expectedHubs,
      hubs.length + ' hubs, expected ' + expectedHubs));
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
    const active = document.querySelector('#nav-bar .rail-item.active');
    results.push(ok('nav:hub-highlighted-on-direct-nav',
      !!active && active.getAttribute('data-hub') === 'hub-records',
      active ? active.textContent : 'none'));

    renderView('playerProfile');
    const profileHub = document.querySelector('#nav-bar .rail-item.active');
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
    const hubCount = document.querySelectorAll('#nav-bar .rail-item[data-hub]').length;
    for (let i = 0; i < hubCount; i++) {
      document.querySelectorAll('#nav-bar .rail-item[data-hub]')[i].click();
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

  // The advance loop repaints as it goes. It used to mutate the league for the
  // whole run while the screen kept its pre-Continue values, so a Continue that
  // covered forty games showed the old record the entire time and only caught
  // up when the user happened to click a tab.
  //
  // Asserted through refreshAdvanceFrame directly rather than by running an
  // advance: this suite is synchronous, and the loop is not. The divergence is
  // made by emptying the topbar rather than by touching the league, so the
  // check cannot corrupt the save it is running against.
  function checkAdvanceRepaints() {
    requireSeason();
    const results = [];

    results.push(ok('advance:repaint-hook-exists', typeof refreshAdvanceFrame === 'function'));
    if (typeof refreshAdvanceFrame !== 'function') return results;

    const bar = document.getElementById('app-topbar');
    const team = getTeamById(GameState.userTeamId);
    const expected = team.record.wins + '-' + team.record.losses;

    bar.innerHTML = '';
    refreshAdvanceFrame();

    // The ribbon carries the record in .ribbon-sub as "W–L · Conference · ...";
    // assert the substring rather than a dedicated element, and normalise its
    // en-dash to the hyphen `expected` is built with.
    const rec = bar.querySelector('.ribbon-sub');
    const shown = rec ? rec.textContent.replace(/\s/g, '').replace(/–/g, '-') : '(no record element)';
    results.push(ok('advance:repaint-restores-topbar-record', shown.indexOf(expected) !== -1,
      'showed ' + shown + ', league says ' + expected));

    // The loop must not rebuild the dock: replacing the Stop button under the
    // cursor every step is what makes a long run impossible to interrupt.
    const dockBefore = document.querySelector('#sim-controls button');
    refreshAdvanceFrame();
    const dockAfter = document.querySelector('#sim-controls button');
    results.push(ok('advance:repaint-leaves-dock-alone', dockBefore === dockAfter,
      'the dock button was replaced by a repaint'));

    return results;
  }

  // Headings that title nothing. This has now been shipped twice: the watched
  // game's "Leaders" label sat over blank space until the first basket, and
  // Free Agency showed a bare column header plus a "Recent Signings" panel with
  // nothing under either. Both looked like a screen that had failed to load.
  // A heading is only allowed when the thing it names actually has content.
  function checkNoStrandedHeadings() {
    requireSeason();
    const results = [];
    const bareTables = [];
    const barePanels = [];
    const restoreView = GameState.currentView;

    applicableNavIds().forEach(function (id) {
      try {
        renderView(id);
      } catch (e) {
        return;
      }
      const vc = document.getElementById('view-content');

      vc.querySelectorAll('table').forEach(function (t) {
        if (t.querySelectorAll('thead th').length > 0 && t.querySelectorAll('tbody tr').length === 0) {
          bareTables.push(id + ': ' +
            Array.from(t.querySelectorAll('thead th')).map(function (th) { return th.textContent.trim(); })
              .join('/').slice(0, 44));
        }
      });

      vc.querySelectorAll('.panel-header').forEach(function (h) {
        const siblings = Array.from(h.parentElement.children).filter(function (c) { return c !== h; });
        const text = siblings.map(function (c) { return (c.textContent || '').trim(); }).join('');
        // A panel of only controls (a form, a chart) is legitimately textless.
        const hasControls = siblings.some(function (c) {
          return c.querySelector && c.querySelector('input,select,button,canvas,img');
        });
        if (!text && !hasControls) barePanels.push(id + ': "' + h.textContent.trim() + '"');
      });
    });
    renderView(restoreView);

    results.push(ok('empty:no-header-row-without-rows', bareTables.length === 0,
      bareTables.slice(0, 5).join('; ') || null));
    results.push(ok('empty:no-panel-header-without-body', barePanels.length === 0,
      barePanels.slice(0, 5).join('; ') || null));
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

  // The highlight treatment is driven by a structured marker and suppressed by
  // playback speed and by reduced motion. The scoreboard assertion is the one
  // that catches the layering being done wrong: the in-canvas scoreboard is
  // painted after the scene transform, so a zoom must not move it. That is
  // invisible in any still frame where nothing happens to be zooming, and it
  // needs a control — the crowd is inside the transform and does zoom, so a
  // sample that catches crowd pixels reports movement that isn't the board's.
  function checkImpactMoments() {
    const results = [];

    results.push(ok('impact:module-loaded',
      typeof startImpact === 'function' && typeof impactZoom === 'function'));
    if (typeof startImpact !== 'function') return results;

    const poster = { kind: 'poster', at: { x: 240, y: 160 }, byId: 'a', onId: 'b' };
    const block = { kind: 'block', at: { x: 240, y: 160 }, byId: 'a', onId: 'b' };

    resetImpact();
    startImpact(poster, 0, { reduceMotion: false, speed: 1 });
    const z = impactZoom(10);
    results.push(ok('impact:poster-zooms', !!z && z.scale > 1,
      z ? 'scale ' + z.scale : 'no zoom'));

    resetImpact();
    startImpact(block, 0, { reduceMotion: false, speed: 1 });
    results.push(ok('impact:block-does-not-zoom', impactZoom(10) === null));

    resetImpact();
    startImpact(poster, 0, { reduceMotion: true, speed: 1 });
    results.push(ok('impact:reduced-motion-suppresses', impactZoom(10) === null &&
      impactFreezeMs(poster, { reduceMotion: true, speed: 1 }) === 0));

    // These two used to assert that a poster produced NO zoom and NO freeze at
    // 8x, and that 4x HALVED the freeze. b9b0b2e deliberately reversed both --
    // at 1x you can see a dunk unaided, at 8x it is a smear, so the emphasis
    // now grows with speed instead of fading out. That commit updated the Node
    // validator and left these behind, and because this file only runs in a
    // browser (under Node it exits 0 and proves nothing) they sat red and
    // unread. They now assert the design that actually shipped.
    resetImpact();
    startImpact(poster, 0, { reduceMotion: false, speed: 8 });
    results.push(ok('impact:poster-still-lands-at-8x',
      impactZoom(10) !== null &&
      impactFreezeMs(poster, { reduceMotion: false, speed: 8 }) > 0,
      'freeze ' + impactFreezeMs(poster, { reduceMotion: false, speed: 8 }) + 'ms'));

    // The bar RISES with speed: a block is the most common and least
    // spectacular kind, so it is the first to stop interrupting.
    results.push(ok('impact:block-drops-out-above-2x',
      impactFreezeMs(block, { reduceMotion: false, speed: 2 }) > 0 &&
      impactFreezeMs(block, { reduceMotion: false, speed: 4 }) === 0));

    // A freeze is real milliseconds, so at 8x it buys proportionally less of
    // the game -- it scales UP, and caps before a pause reads as a hang.
    const f1 = impactFreezeMs(poster, { reduceMotion: false, speed: 1 });
    const f4 = impactFreezeMs(poster, { reduceMotion: false, speed: 4 });
    const f8 = impactFreezeMs(poster, { reduceMotion: false, speed: 8 });
    results.push(ok('impact:freeze-grows-with-speed-then-caps',
      f4 > f1 && f8 >= f4 && f8 === IMPACT_FREEZE_MAX_MS,
      f1 + ' / ' + f4 + ' / ' + f8 + ' (cap ' + IMPACT_FREEZE_MAX_MS + ')'));

    // Leaving state armed here would zoom the first frame of whatever the user
    // opens next, which is exactly the leak stopPixelPlayback exists to close.
    resetImpact();
    results.push(ok('impact:reset-clears-state', impactZoom(10) === null));

    return results;
  }

  // The badge reference renders 48 cards straight from the taxonomy. The two
  // things worth asserting are that it renders ALL of them (a filter bug drops
  // a category silently) and that the five-tier ladder never wraps — five tiers
  // only read as a ladder on one line, and at a 280px card LEGENDARY dropped to
  // its own row while every DOM-shape assertion still passed.
  function checkBadgeReference() {
    requireSeason();
    const results = [];
    renderView('badges');
    const cards = document.querySelectorAll('.badge-ref-card');
    results.push(ok('badges:renders-every-badge', cards.length === TRAIT_TAXONOMY.length,
      cards.length + ' of ' + TRAIT_TAXONOMY.length));
    results.push(ok('badges:all-six-categories',
      document.querySelectorAll('.badge-ref-cat-title').length === 6));
    results.push(ok('badges:visible', cards.length > 0 && isVisible(cards[0])));

    const ladders = Array.from(document.querySelectorAll('.badge-ref-ladder'));
    results.push(ok('badges:five-tiers-each',
      ladders.every(function (l) { return l.children.length === 5; })));
    const wrapped = ladders.filter(function (l) {
      const tops = Array.from(l.children).map(function (c) { return c.offsetTop; });
      return new Set(tops).size > 1;
    });
    results.push(ok('badges:ladder-never-wraps', wrapped.length === 0, wrapped.length + ' wrapped'));
    const clipped = Array.from(document.querySelectorAll('.badge-ref-tier-name'))
      .filter(function (e) { return e.scrollWidth > e.clientWidth + 1; });
    results.push(ok('badges:tier-labels-not-clipped', clipped.length === 0, clipped.length + ' clipped'));

    // Every card must carry a real sentence, not an empty <p>.
    const blank = Array.from(cards).filter(function (c) {
      const d = c.querySelector('.badge-ref-desc');
      return !d || d.textContent.trim().length < 25;
    });
    results.push(ok('badges:every-card-describes-itself', blank.length === 0, blank.length + ' blank'));

    // A flaw must read as a reduction, never as a bonus.
    const streaky = Array.from(cards).find(function (c) {
      return c.querySelector('.badge-ref-name').textContent === 'Streaky';
    });
    const streakyText = streaky ? streaky.querySelector('.badge-ref-effect').textContent : '';
    results.push(ok('badges:flaws-read-as-reductions', streakyText.indexOf('Reduces') === 0, streakyText));
    return results;
  }

  // The Feats page is the only screen in the game whose contents cannot be
  // rebuilt from a save: box scores are pruned at write time, so if a feat is
  // not filed as the game finishes it is gone. That makes "the page rendered
  // and the rows are on screen" worth asserting rather than assuming.
  function checkFeats() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;

    renderView('feats');
    const view = document.getElementById('view-content');
    // textContent, not innerText. innerText reports only what is actually laid
    // out, and returns almost nothing when the browser pane is not compositing
    // — a page that renders perfectly then fails this check for a reason that
    // has nothing to do with the page.
    const heading = view.querySelector('.view-header h2');
    results.push(ok('feats:renders', !!heading && heading.textContent.indexOf('Feats') !== -1,
      heading ? heading.textContent : 'no view header'));

    const rows = view.querySelectorAll('#feat-rows tr');
    const empty = view.querySelector('.empty-state');
    // Detail is context, not an error message — it is printed whether the check
    // passes or fails, so a sentence describing the failure reads as a failure
    // on every successful run.
    results.push(ok('feats:rows-or-empty-state', rows.length > 0 || !!empty,
      rows.length + ' rows, ' + (empty ? 'empty state present' : 'no empty state')));

    if (rows.length > 0) {
      const r = rows[0].getBoundingClientRect();
      results.push(ok('feats:first-row-visible', r.height > 0 && r.top < window.innerHeight,
        'height ' + r.height.toFixed(0) + ', top ' + r.top.toFixed(0)));

      // Filtering is the page's only interaction. A filter that hides
      // everything, or hides nothing, is the failure worth catching.
      const select = document.getElementById('feat-year');
      const year = select.options[1] && select.options[1].value;
      if (year) {
        select.value = year;
        select.dispatchEvent(new Event('change'));
        const shown = Array.from(view.querySelectorAll('#feat-rows tr'))
          .filter(function (tr) { return tr.style.display !== 'none'; });
        results.push(ok('feats:season-filter-narrows',
          shown.length > 0 && shown.length <= rows.length,
          shown.length + ' of ' + rows.length + ' after filtering to ' + year));
        const strays = shown.filter(function (tr) { return tr.getAttribute('data-feat-year') !== year; });
        results.push(ok('feats:season-filter-is-honest', strays.length === 0,
          strays.length ? strays.length + ' rows from another season survived the filter' : null));
        select.value = '';
        select.dispatchEvent(new Event('change'));
      }

      // The spec asks for season, team and player. All three are asserted, so
      // one of them quietly not being wired up is a failure and not a shrug.
      const teamSel = document.getElementById('feat-team');
      const teamId = teamSel.options[1] && teamSel.options[1].value;
      if (teamId) {
        teamSel.value = teamId;
        teamSel.dispatchEvent(new Event('change'));
        const shown = Array.from(view.querySelectorAll('#feat-rows tr'))
          .filter(function (tr) { return tr.style.display !== 'none'; });
        results.push(ok('feats:team-filter-narrows',
          shown.length > 0 && shown.every(function (tr) { return tr.getAttribute('data-feat-team') === teamId; }),
          shown.length + ' rows, all ' + teamId));
        teamSel.value = '';
        teamSel.dispatchEvent(new Event('change'));
      }

      const nameInput = document.getElementById('feat-player');
      const someName = rows[0].getAttribute('data-feat-player');
      nameInput.value = someName;
      nameInput.dispatchEvent(new Event('input'));
      const byName = Array.from(view.querySelectorAll('#feat-rows tr'))
        .filter(function (tr) { return tr.style.display !== 'none'; });
      results.push(ok('feats:player-filter-narrows',
        byName.length > 0 && byName.every(function (tr) { return tr.getAttribute('data-feat-player') === someName; }),
        byName.length + ' rows for "' + someName + '"'));
      nameInput.value = '';
      nameInput.dispatchEvent(new Event('input'));

      const restored = Array.from(view.querySelectorAll('#feat-rows tr'))
        .filter(function (tr) { return tr.style.display !== 'none'; });
      results.push(ok('feats:clearing-filters-restores-every-row',
        restored.length === rows.length, restored.length + ' of ' + rows.length));

      // Every feat must name a player who can actually be opened. A record
      // pointing at an id nobody holds renders a dead button.
      const link = view.querySelector('#feat-rows button[data-profile-id]');
      results.push(ok('feats:player-links-resolve',
        !!link && !!PLAYERS_2026.find(function (p) { return p.id === link.getAttribute('data-profile-id'); }),
        link ? link.getAttribute('data-profile-id') : 'no link'));
    }

    renderView(startView);
    return results;
  }

  // Sixteen separate queries over league history, any one of which can be the
  // one that throws on an empty league or a half-played season. Every toy is
  // opened, not just the default.
  function checkToys() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;

    renderView('frivolities');
    const view = document.getElementById('view-content');
    const buttons = view.querySelectorAll('button[data-toy]');
    results.push(ok('toys:index-renders', buttons.length >= 17, buttons.length + ' toys'));

    // The glance panels this page had before the toys must still be here.
    // Read off the DOM rather than innerText, for the reason given in
    // checkFeats above.
    const headers = Array.from(view.querySelectorAll('.panel-header'))
      .map(function (h) { return h.textContent; });
    const survives = function (name) {
      return headers.some(function (h) { return h.indexOf(name) !== -1; });
    };
    results.push(ok('toys:glance-panels-survive',
      survives('Most Active Trade Partners') && survives('Draft Class Hit Rates') &&
      survives('Most-Traded Players') && survives('Longest Current Tenures'),
      headers.join(' | ')));

    // Re-query by index each iteration: clicking re-renders the page and
    // detaches every button captured beforehand. A detached node still fires
    // its listener, so a cached loop looks like it works while asserting
    // against elements no longer on the page.
    const count = buttons.length;
    const broke = [];
    const empties = [];
    for (let i = 0; i < count; i++) {
      const all = document.getElementById('view-content').querySelectorAll('button[data-toy]');
      const id = all[i] && all[i].getAttribute('data-toy');
      try {
        all[i].click();
        const body = document.getElementById('view-content');
        const list = body.querySelector('.stack-list');
        const empty = body.querySelector('.empty-state');
        if (!list && !empty) broke.push(id + ': rendered neither a list nor an empty state');
        if (!list && empty) empties.push(id);
      } catch (e) {
        broke.push(id + ': ' + e.message);
      }
    }
    results.push(ok('toys:every-toy-opens', broke.length === 0, broke.join('; ') || null));
    results.push(ok('toys:selected-toy-is-marked',
      document.getElementById('view-content').querySelectorAll('button[data-toy].btn-primary').length === 1,
      null));
    // Not a failure — a young league legitimately has empty toys — but worth
    // reporting so "everything is empty" is visible rather than silent.
    results.push(ok('toys:some-toy-has-rows', empties.length < count,
      empties.length + ' of ' + count + ' empty' + (empties.length ? ': ' + empties.join(', ') : '')));

    renderView(startView);
    return results;
  }

  // The broadcast chrome (2026-08-14 re-skin): ribbon, icon rail, chips.
  function checkBroadcastChrome() {
    const results = [];
    const team = getTeamById(GameState.userTeamId);

    const ribbon = document.querySelector('.ribbon');
    results.push(ok('broadcast:ribbon-exists', !!ribbon, null));
    results.push(ok('broadcast:ribbon-names-the-team',
      !!ribbon && ribbon.textContent.indexOf(team.name) !== -1, team.name));

    const rail = document.querySelectorAll('.rail-item');
    results.push(ok('broadcast:rail-has-hubs', rail.length >= 6, rail.length + ' items'));
    const unlabeled = Array.prototype.filter.call(rail, function (b) {
      return !(b.getAttribute('aria-label') || '').trim();
    });
    results.push(ok('broadcast:rail-items-labeled', unlabeled.length === 0,
      unlabeled.length + ' without aria-label'));
    const active = document.querySelectorAll('.rail-item.active');
    const expectHub = hubForView(GameState.currentView);
    results.push(ok('broadcast:one-active-hub-and-it-matches',
      active.length === 1 && !!expectHub && active[0].getAttribute('data-hub') === expectHub.id,
      active.length + ' active, view ' + GameState.currentView));

    // The theme var must be the TEAM'S stored hex, not the CSS default —
    // proving applyTeamAccent actually ran for this team.
    const setPrimary = getComputedStyle(document.documentElement)
      .getPropertyValue('--team-primary').trim().toUpperCase();
    const storedPrimary = (team.colors && team.colors.primary || '').toUpperCase();
    results.push(ok('broadcast:team-primary-var-applied',
      setPrimary === storedPrimary, setPrimary + ' vs ' + storedPrimary));

    // Rating chips reach the roster table.
    const startView = GameState.currentView;
    renderView('roster');
    const chips = document.getElementById('view-content').querySelectorAll('.rating-chip');
    results.push(ok('broadcast:roster-renders-rating-chips', chips.length > 0, chips.length + ' chips'));
    const strip = document.getElementById('view-content').querySelectorAll('.stat-chip');
    results.push(ok('broadcast:roster-stat-strip', strip.length >= 3, strip.length + ' stat chips'));
    renderView(startView);
    return results;
  }

  // The command center dashboard (2026-08-13): every number on the hero and
  // form strip is re-derived here from the same raw state the view reads, so
  // a drifted render (stale record, wrong seed, invented results) fails even
  // though the page "looks fine".
  function checkDashboard() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;
    renderView('dashboard');
    const vc = document.getElementById('view-content');
    const team = getTeamById(GameState.userTeamId);
    const season = GameState.season;

    const rec = vc.querySelector('.dash-hero-rec');
    results.push(ok('dashboard:hero-record',
      !!rec && rec.textContent.indexOf(team.record.wins + '-' + team.record.losses) === 0,
      rec ? rec.textContent.slice(0, 24) : 'no hero'));

    // Recompute the seed independently from the same source the view uses.
    const seeds = getPlayoffSeeds(team.conference, 15);
    const seedIdx = seeds.findIndex(function (t) { return t.id === team.id; });
    results.push(ok('dashboard:hero-seed',
      !!rec && rec.textContent.indexOf((seedIdx + 1) + '') !== -1 &&
      rec.textContent.indexOf(team.conference) !== -1,
      'expected seed ' + (seedIdx + 1) + ' ' + team.conference));

    // The form strip must be the schedule's truth: same count, same W/L
    // letters, oldest to newest.
    const played = season.games
      .filter(function (g) { return g.played && (g.homeTeamId === team.id || g.awayTeamId === team.id); })
      .sort(function (a, b) { return (a.day || 0) - (b.day || 0); })
      .slice(-5);
    const expectSeq = played.map(function (g) {
      const home = g.homeTeamId === team.id;
      return (home ? g.homeScore > g.awayScore : g.awayScore > g.homeScore) ? 'W' : 'L';
    }).join('');
    const gotSeq = Array.prototype.map.call(
      vc.querySelectorAll('.form-bug.win .res, .form-bug.loss .res'),
      function (r) { return r.textContent.trim(); }).join('');
    results.push(ok('dashboard:form-strip-truth', gotSeq === expectSeq,
      'strip ' + gotSeq + ' vs schedule ' + expectSeq));

    const userRows = vc.querySelectorAll('tr.row-user');
    const rankCell = userRows.length === 1 ? userRows[0].querySelector('td') : null;
    results.push(ok('dashboard:race-user-row',
      userRows.length === 1 && !!rankCell && rankCell.textContent.trim() === String(seedIdx + 1),
      userRows.length + ' user rows, rank ' + (rankCell ? rankCell.textContent.trim() : '?') +
      ' vs seed ' + (seedIdx + 1)));

    // The hero's Play button and the dock's Watch button must always agree
    // about whether there is a game to play.
    renderSimControls(document.getElementById('sim-controls'));
    const play = vc.querySelector('#dash-play');
    const watch = document.getElementById('sim-watch-game');
    results.push(ok('dashboard:play-parity',
      !!play && !!watch && play.disabled === watch.disabled,
      'play ' + (play && play.disabled) + ' vs watch ' + (watch && watch.disabled)));

    renderView(startView);
    return results;
  }

  // The starting-five picker (2026-08-14). Every check asserts on the STORED
  // list as well as the rendered strip, because the failure that matters is the
  // two disagreeing — a lineup that looks chosen and is not.
  function checkLineup() {
    requireSeason();
    const results = [];
    const startView = GameState.currentView;
    const startInspect = GameState.inspectTeamId;
    const team = getTeamById(GameState.userTeamId);
    const restoreFive = team.startingFive ? team.startingFive.slice() : undefined;

    try {
      GameState.inspectTeamId = null;
      team.startingFive = [];
      renderView('roster');
      const vc = document.getElementById('view-content');

      results.push(ok('lineup:strip-renders',
        !!vc.querySelector('#lineup-strip') && vc.querySelectorAll('.lineup-slot').length === 5,
        vc.querySelectorAll('.lineup-slot').length + ' slots'));

      // Picking one must reach stored state AND show that player's name.
      const first = vc.querySelector('.lineup-toggle');
      const firstId = first && first.getAttribute('data-lineup-id');
      if (first) first.click();
      const afterOne = (getTeamById(GameState.userTeamId).startingFive || []);
      const named = document.getElementById('view-content')
        .querySelector('.lineup-slot:not(.is-empty) .nm');
      const pickedPlayer = PLAYERS_2026.find(function (p) { return p.id === firstId; });
      results.push(ok('lineup:toggle-persists',
        afterOne.indexOf(firstId) !== -1 && !!named && !!pickedPlayer &&
        named.textContent === pickedPlayer.name,
        'stored ' + afterOne.length + ', slot shows ' + (named ? named.textContent : 'nothing')));

      // Five is the ceiling however many times you click.
      for (let i = 0; i < 8; i++) {
        const btns = document.getElementById('view-content').querySelectorAll('.lineup-toggle:not(.is-on)');
        if (btns[0]) btns[0].click();
      }
      const capped = (getTeamById(GameState.userTeamId).startingFive || []);
      results.push(ok('lineup:caps-at-five', capped.length === 5, capped.length + ' stored'));

      const autoBtn = document.getElementById('lineup-auto');
      if (autoBtn) autoBtn.click();
      results.push(ok('lineup:auto-clears',
        (getTeamById(GameState.userTeamId).startingFive || []).length === 0,
        (getTeamById(GameState.userTeamId).startingFive || []).length + ' left'));

      // Another team's roster is browsing, not control.
      const other = TEAMS.find(function (t) { return t.id !== GameState.userTeamId; });
      GameState.inspectTeamId = other.id;
      renderView('roster');
      results.push(ok('lineup:other-team-readonly',
        document.getElementById('view-content').querySelectorAll('.lineup-toggle').length === 0,
        'toggles on ' + other.id));
    } finally {
      // Never leave a lineup behind in the user's league: this suite runs
      // against real game state, exactly like the injection check's feed.
      if (restoreFive === undefined) delete team.startingFive;
      else team.startingFive = restoreFive;
      GameState.inspectTeamId = startInspect;
      renderView(startView);
    }
    return results;
  }

  const GROUPS = {
    views: checkViews,
    feats: checkFeats,
    toys: checkToys,
    injection: checkNoInjection,
    entities: checkNoEntityLeak,
    boxscore: checkScheduleBoxScore,
    pbp: checkPlayByPlayBreakdown,
    align: checkTableAlignment,
    chrome: checkChromeLabels,
    impact: checkImpactMoments,
    advance: checkAdvanceRepaints,
    empty: checkNoStrandedHeadings,
    scroll: checkScrollOnNavigate,
    nav: checkNav,
    broadcast: checkBroadcastChrome,
    dashboard: checkDashboard,
    lineup: checkLineup,
    dock: checkDock,
    badges: checkBadgeReference,
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
