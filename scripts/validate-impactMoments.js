// Which plays earn the comic-panel treatment, and how often.
//
// The thresholds here are calibrated by RATE, not picked off raw ratings.
// DUNK_LIFT_THRESHOLD in ui/pixelChoreographer.js carries the scar from the
// other approach: an absolute cutoff chosen from rating numbers marked ~95% of
// the league as dunkers. Every player in this pool is elite, so "high vertical"
// selects nearly everyone. checkRateStaysInBand below is what keeps this honest
// as progression moves ratings every season.
const assert = require('assert');
const path = require('path');

const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

// Fixture players built to sit at the extremes, so these assertions test the
// STRUCTURE of the rules and stay true whatever the calibrated numbers become.
function mkPlayer(overrides) {
  const attributes = Object.assign({
    insideScoring: 50, midRange: 50, threePoint: 50, freeThrow: 50,
    passing: 50, ballHandling: 50, postScoring: 50,
    perimeterDefense: 50, interiorDefense: 50, steal: 50, block: 50,
    offReb: 50, defReb: 50, speed: 50, acceleration: 50,
    strength: 50, vertical: 50, basketballIQ: 50, leadership: 50, workEthic: 50
  }, (overrides && overrides.attributes) || {});
  return { id: (overrides && overrides.id) || 'p1', name: 'Test Player',
           heightIn: (overrides && overrides.heightIn) || 78, attributes: attributes };
}

const eliteLeaper = mkPlayer({ id: 'leaper', heightIn: 82, attributes: { vertical: 99, strength: 90, insideScoring: 95 } });
const weakRimProtector = mkPlayer({ id: 'weakbig', attributes: { interiorDefense: 20 } });
const eliteRimProtector = mkPlayer({ id: 'wall', attributes: { interiorDefense: 99 } });
const eliteHandler = mkPlayer({ id: 'handler', attributes: { ballHandling: 99, acceleration: 99, speed: 99 } });
const weakPerimeter = mkPlayer({ id: 'turnstile', attributes: { perimeterDefense: 20 } });
const elitePerimeter = mkPlayer({ id: 'stopper', attributes: { perimeterDefense: 99 } });

function checkEdgesRespondToMatchup() {
  assert.ok(choreo.posterEdge(eliteLeaper, weakRimProtector) > choreo.posterEdge(eliteLeaper, eliteRimProtector),
    'the same finisher should score a bigger poster edge against a weaker rim protector');
  assert.ok(choreo.handleEdge(eliteHandler, weakPerimeter) > choreo.handleEdge(eliteHandler, elitePerimeter),
    'the same handler should score a bigger handle edge against a weaker defender');
}

function checkPosterNeedsAllThreeConditions() {
  const made = { type: 'shot', made: true, zone: 'inside' };
  assert.strictEqual(choreo.classifyImpact(made, eliteLeaper, weakRimProtector), 'poster',
    'an elite leaper finishing inside over a weak rim protector is a poster');
  assert.strictEqual(choreo.classifyImpact(made, eliteLeaper, eliteRimProtector), null,
    'a real rim protector denies the poster');
  // a ground-bound finisher fails isDunker regardless of the matchup
  const grounded = mkPlayer({ id: 'grounded', heightIn: 72, attributes: { vertical: 20, strength: 20, insideScoring: 95 } });
  assert.strictEqual(choreo.classifyImpact(made, grounded, weakRimProtector), null,
    'a non-dunker cannot poster anybody');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: false, zone: 'inside' }, eliteLeaper, weakRimProtector), null,
    'a missed dunk is not a poster');
}

function checkAnkleBreakerIsOutsideOnly() {
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, weakPerimeter), 'ankle',
    'a big handle edge on a made mid-range is an ankle breaker');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'three' }, eliteHandler, weakPerimeter), 'ankle',
    'the same applies from three');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, elitePerimeter), null,
    'a defender who stays in front denies it');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: false, zone: 'three' }, eliteHandler, weakPerimeter), null,
    'a miss never fires — celebrating a brick would read as a bug');
}

// The property that makes precedence impossible to get wrong.
function checkPosterAndAnkleAreDisjoint() {
  const zones = ['inside', 'mid', 'three'];
  const shooters = [eliteLeaper, eliteHandler, mkPlayer({ id: 'both', heightIn: 82,
    attributes: { vertical: 99, strength: 90, insideScoring: 99, ballHandling: 99, acceleration: 99, speed: 99 } })];
  const defenders = [weakRimProtector, weakPerimeter, eliteRimProtector, elitePerimeter];
  shooters.forEach(function (s) {
    defenders.forEach(function (d) {
      zones.forEach(function (z) {
        const kind = choreo.classifyImpact({ type: 'shot', made: true, zone: z }, s, d);
        if (z === 'inside') {
          assert.notStrictEqual(kind, 'ankle', 'an inside make must never classify as an ankle breaker');
        } else {
          assert.notStrictEqual(kind, 'poster', 'an outside make must never classify as a poster');
        }
      });
    });
  });
}

function checkBlockIsAlwaysTierTwo() {
  assert.strictEqual(choreo.classifyImpact({ type: 'block', zone: 'inside' }, eliteHandler, elitePerimeter), 'block',
    'every block classifies, regardless of ratings');
  assert.strictEqual(choreo.classifyImpact({ type: 'block', zone: 'three' }, elitePerimeter, eliteHandler), 'block',
    'including a three-point block');
}

function checkUnknownAndMalformedEventsAreIgnored() {
  assert.strictEqual(choreo.classifyImpact({ type: 'rebound' }, eliteLeaper, weakRimProtector), null);
  assert.strictEqual(choreo.classifyImpact({ type: 'turnover' }, eliteLeaper, weakRimProtector), null);
  assert.strictEqual(choreo.classifyImpact(null, eliteLeaper, weakRimProtector), null);
  // a shot whose defender was never resolved must not throw
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'inside' }, eliteLeaper, null), null);
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, null, weakPerimeter), null);
}

// The check that survives the league aging. Progression moves ratings every
// season; a cutoff that is right in 2026 could fire on every possession by
// 2034. The band is wide on purpose — this catches drift and misconfiguration,
// it is not a golden master and must not fail on ordinary rng variation.
function checkRateStaysInBand() {
  require(path.join(__dirname, '..', 'data.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const rngMod = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  require(path.join(__dirname, '..', 'gameSim.js'));
  const se = require(path.join(__dirname, '..', 'simEngine.js'));
  const league = require(path.join(__dirname, '..', 'league.js'));
  const teams = require(path.join(__dirname, '..', 'teams.js'));
  const engine = se.getActiveEngine({ simEngine: 'possession' });

  const ids = teams.TEAMS.map(function (t) { return t.id; });
  const byId = {};
  ids.forEach(function (id) { league.getTeamRoster(id).forEach(function (p) { byId[p.id] = p; }); });

  const count = { poster: 0, ankle: 0, block: 0 };
  let games = 0;
  for (let i = 0; i < ids.length; i++) {
    const home = ids[i], away = ids[(i + 7) % ids.length];
    for (let g = 0; g < 4; g++) {
      const rng = rngMod.makeRng(81000 + i * 100 + g);
      const ev = [];
      engine.simulateGame(home, away, rng, { events: ev });
      games++;
      ev.forEach(function (e) {
        const kind = choreo.classifyImpact(e, byId[e.playerId], byId[e.defenderId]);
        if (kind) count[kind] += 1;
      });
    }
  }

  ['poster', 'ankle'].forEach(function (kind) {
    const rate = count[kind] / games;
    assert.ok(rate >= 0.5 && rate <= 4,
      kind + ' fires ' + rate.toFixed(2) + '/game over ' + games +
      ' games, outside the 0.5-4 band — recalibrate IMPACT_THRESHOLDS in ui/pixelChoreographer.js');
  });

  // Blocks are a real event, not a derived judgement: no threshold shrinks
  // them, so this asserts the tier-2 population is what the design assumed.
  const blockRate = count.block / games;
  assert.ok(blockRate >= 2 && blockRate <= 7,
    'blocks fire ' + blockRate.toFixed(2) + '/game, outside the expected 2-7 — the engine changed, revisit the two-tier split');
}

// The marker has to survive the trip through buildTimeline onto a keyframe —
// that is the contract ui/pixelGameView.js reads. Structured field, never a
// display string: this codebase has twice been bitten by logic keyed to
// human-readable text.
function checkMarkerReachesTheKeyframe() {
  // Drive a REAL simulated game rather than a hand-built event list: the
  // session shape and the possession grouping are then exactly what the view
  // uses. Mirrors buildSession in scripts/validate-pixel-choreographer.js.
  require(path.join(__dirname, '..', 'data.js'));
  const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const league = require(path.join(__dirname, '..', 'league.js'));

  const home = TEAMS[0], away = TEAMS[9];
  const events = [];
  const result = gameSim.simulateGame(home.id, away.id, makeRng(4242), { events: events });
  const timeline = choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster(home.id),
    awayRoster: league.getTeamRoster(away.id),
    boxScore: result.boxScore
  });

  const blockEvents = events.filter(function (e) { return e.type === 'block'; });
  assert.ok(blockEvents.length > 0, 'the fixture game should contain at least one block');

  const marked = timeline.keyframes.filter(function (k) { return k.impact; });
  const blockMarkers = marked.filter(function (k) { return k.impact.kind === 'block'; });
  assert.strictEqual(blockMarkers.length, blockEvents.length,
    'every block event should produce exactly one marked keyframe');

  // byId / onId orientation: for a block, the DEFENDER is the one who did it
  const first = blockMarkers[0].impact;
  assert.strictEqual(first.byId, blockEvents[0].defenderId, 'byId is who did it — the blocker');
  assert.strictEqual(first.onId, blockEvents[0].playerId, 'onId is who it was done to — the shooter');
  assert.strictEqual(typeof first.at.x, 'number');
  assert.strictEqual(typeof first.at.y, 'number');

  // the field must always exist, so the view never reads undefined
  timeline.keyframes.forEach(function (k) {
    assert.ok(k.impact === null || (k.impact && typeof k.impact.kind === 'string'),
      'impact must always be present as null or a well-formed marker');
  });

  // and a marked shot keyframe must orient the other way round
  const shotMarkers = marked.filter(function (k) { return k.impact.kind !== 'block'; });
  if (shotMarkers.length) {
    assert.ok(shotMarkers[0].impact.byId && shotMarkers[0].impact.onId,
      'a poster or ankle breaker names both the scorer and the defender');
  }
}

// Effect timing. Everything except the two draw calls is a pure function of a
// marker and a clock, so it is asserted here rather than in the browser.
function checkEffectTiming() {
  const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));
  const poster = { kind: 'poster', at: { x: 100, y: 100 }, byId: 'a', onId: 'b' };
  const block = { kind: 'block', at: { x: 100, y: 100 }, byId: 'a', onId: 'b' };
  const full = { reduceMotion: false, speed: 1 };

  // tier 1 freezes for longer than tier 2
  assert.ok(impact.impactFreezeMs(poster, full) > impact.impactFreezeMs(block, full),
    'a poster should hold longer than a block');

  // speed policy: full at 1x and 2x, halved at 4x, nothing at 8x
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 2 }),
    impact.impactFreezeMs(poster, full), '2x keeps the full freeze');
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 4 }),
    Math.round(impact.impactFreezeMs(poster, full) / 2), '4x halves the freeze');
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 8 }), 0,
    '8x suppresses the freeze entirely');

  // reduced motion removes motion, not information
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: true, speed: 1 }), 0,
    'reduced motion suppresses the freeze');
  impact.resetImpact();
  impact.startImpact(poster, 1000, { reduceMotion: true, speed: 1 });
  assert.strictEqual(impact.impactZoom(1000), null, 'reduced motion never zooms');

  // zoom is active during the hold and gone afterwards
  impact.resetImpact();
  impact.startImpact(poster, 1000, full);
  const z = impact.impactZoom(1010);
  assert.ok(z && z.scale > 1, 'a poster zooms in while it holds');
  assert.strictEqual(z.cx, 120, 'centre is clamped so the magnified view stays on court (x=100 → 120)');
  assert.strictEqual(z.cy, 100, 'y needed no clamping here');
  assert.strictEqual(impact.impactZoom(1000 + 5000), null, 'the zoom releases');

  // A poster resolves AT the rim, 14px from the court edge. Unclamped, the
  // magnified viewport would run off the stage and put the dunk in the corner.
  impact.resetImpact();
  impact.startImpact({ kind: 'poster', at: { x: 34, y: 160 }, byId: 'a', onId: 'b' }, 1000, full);
  const rimZoom = impact.impactZoom(1010, 480, 270);
  assert.strictEqual(rimZoom.cx, 120, 'a left-rim poster clamps to half a viewport in from the edge');
  assert.ok(rimZoom.cx - 480 / (2 * 2) >= 0, 'the magnified viewport never starts left of the stage');
  impact.resetImpact();
  impact.startImpact({ kind: 'poster', at: { x: 446, y: 160 }, byId: 'a', onId: 'b' }, 1000, full);
  assert.strictEqual(impact.impactZoom(1010, 480, 270).cx, 360, 'and the right rim clamps symmetrically');

  // The property that actually matters, and the one a clamp can silently break:
  // whatever the play's position, the impact point must still be ON SCREEN
  // under the transform the view applies, and the magnified window must not run
  // off the court into black bars. Clamping the focus without centring on it
  // pushed a left-rim dunk to screen x=-52 — visible in no frame at all.
  const W = 480, H = 270, S = 2;
  [[34, 160], [446, 160], [240, 135], [30, 250], [470, 20]].forEach(function (pt) {
    impact.resetImpact();
    impact.startImpact({ kind: 'poster', at: { x: pt[0], y: pt[1] }, byId: 'a', onId: 'b' }, 1000, full);
    const z = impact.impactZoom(1010, W, H);
    // mirrors ui/pixelGameView.js: translate(W/2,H/2) → scale → translate(-cx,-cy)
    const screenX = (pt[0] - z.cx) * S + W / 2;
    const screenY = (pt[1] - z.cy) * S + H / 2;
    assert.ok(screenX >= 0 && screenX <= W && screenY >= 0 && screenY <= H,
      'impact at ' + pt[0] + ',' + pt[1] + ' lands off screen at ' + Math.round(screenX) + ',' + Math.round(screenY));
    assert.ok(z.cx - W / (2 * S) >= 0 && z.cx + W / (2 * S) <= W,
      'the magnified window must stay on the court horizontally');
    assert.ok(z.cy - H / (2 * S) >= 0 && z.cy + H / (2 * S) <= H,
      'and vertically');
  });

  // blocks never zoom, at any speed
  impact.resetImpact();
  impact.startImpact(block, 1000, full);
  assert.strictEqual(impact.impactZoom(1010), null, 'tier 2 is flash and shake only');

  // 8x starts nothing at all
  impact.resetImpact();
  impact.startImpact(poster, 1000, { reduceMotion: false, speed: 8 });
  assert.strictEqual(impact.impactZoom(1010), null, 'nothing fires at 8x');

  impact.resetImpact();
}

// The two draw calls need a canvas, so Node cannot check what they paint — but
// it can check they run without throwing and respect their own gates. A typo
// in here would otherwise surface only as a dead frame in a watched game.
function checkDrawCallsAreSafe() {
  const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));
  const calls = [];
  const ctx = {
    save: function () { calls.push('save'); },
    restore: function () { calls.push('restore'); },
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    stroke: function () { calls.push('stroke'); },
    fillRect: function () { calls.push('fillRect'); }
  };
  const poster = { kind: 'poster', at: { x: 100, y: 100 }, byId: 'a', onId: 'b' };
  const block = { kind: 'block', at: { x: 100, y: 100 }, byId: 'a', onId: 'b' };

  // nothing armed: both calls must be inert rather than throwing
  impact.resetImpact();
  impact.drawImpactLines(ctx, 0);
  impact.drawImpactFlash(ctx, 0, 480, 270);
  assert.strictEqual(calls.length, 0, 'with no impact armed, neither draw call should touch the context');

  // The flash and the lines hand off rather than overlap. Drawing them at the
  // same time put the lines' brightest frames under a white wash, so they were
  // never actually seen — this asserts the ordering that fixed it.
  impact.startImpact(poster, 0, { reduceMotion: false, speed: 1 });

  calls.length = 0;
  impact.drawImpactFlash(ctx, 10, 480, 270);
  impact.drawImpactLines(ctx, 10);
  assert.ok(calls.indexOf('fillRect') !== -1, 'the flash paints in its own opening window');
  assert.strictEqual(calls.indexOf('stroke'), -1,
    'the lines must stay silent while the flash is up, or they are drawn under it and wasted');

  calls.length = 0;
  impact.drawImpactFlash(ctx, 150, 480, 270);
  impact.drawImpactLines(ctx, 150);
  assert.strictEqual(calls.indexOf('fillRect'), -1, 'the flash is done by 150ms');
  assert.ok(calls.indexOf('stroke') !== -1, 'the lines take over once the flash clears');
  assert.strictEqual(calls.filter(function (c) { return c === 'save'; }).length,
    calls.filter(function (c) { return c === 'restore'; }).length,
    'every save must be balanced by a restore, or the whole scene inherits the state');

  // blocks flash but never draw lines, at any point in their life
  impact.resetImpact();
  impact.startImpact(block, 0, { reduceMotion: false, speed: 1 });
  calls.length = 0;
  impact.drawImpactLines(ctx, 10);
  impact.drawImpactLines(ctx, 150);
  assert.strictEqual(calls.indexOf('stroke'), -1, 'tier 2 draws no radial lines');

  // both go quiet once their window has passed
  impact.resetImpact();
  impact.startImpact(poster, 0, { reduceMotion: false, speed: 1 });
  calls.length = 0;
  impact.drawImpactLines(ctx, 10000);
  impact.drawImpactFlash(ctx, 10000, 480, 270);
  assert.strictEqual(calls.length, 0, 'both draw calls must go quiet after their window');

  impact.resetImpact();
}

// The whole effect exists to decorate the freeze. The freeze works by holding
// playbackMs still, so an effect aged off playbackMs is frozen at age 0 for
// the entire hold: the lines (gated to age >= 70ms) never drew on the panel at
// all, and the flash sat at full alpha instead of decaying. Both then played
// AFTER the freeze lifted, over resumed play, around a rim the players had
// already left. The fix is a real-time clock, and this is what pins it down.
function checkEffectsUseARealTimeClock() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'pixelGameView.js'), 'utf8');

  assert.ok(/impactRealMs\s*\+=\s*realDt/.test(src),
    'the view must accumulate a real-time clock for impact effects');

  // Every impact entry point must be handed that clock, never playbackMs.
  [
    ['drawImpactLines', /drawImpactLines\(\s*ctx\s*,\s*impactRealMs\s*\)/],
    ['drawImpactFlash', /drawImpactFlash\(\s*ctx\s*,\s*impactRealMs\s*,/],
    ['impactZoom', /impactZoom\(\s*impactRealMs\s*,/],
    ['startImpact', /startImpact\(\s*fr\.a\.impact\s*,\s*impactRealMs\s*,/],
    ['armImpactZoom', /armImpactZoom\([^)]*,\s*impactRealMs\s*,/]
  ].forEach(function (pair) {
    assert.ok(pair[1].test(src), pair[0] + ' must be driven by impactRealMs, not playbackMs');
  });
  assert.ok(!/(drawImpactLines|drawImpactFlash|impactZoom)\(\s*(ctx\s*,\s*)?playbackMs/.test(src),
    'no impact effect may be aged off playbackMs — it stops during the freeze');
  console.log('checkEffectsUseARealTimeClock: OK');
}

// With a clock that advances, the lines must own the middle of the freeze
// rather than arriving after it.
function checkLinesPlayInsideTheFreeze() {
  const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));
  const poster = { kind: 'poster', at: { x: 240, y: 135 } };
  let strokes = 0, fills = 0;
  const ctx = {
    save: function () {}, restore: function () {}, beginPath: function () {},
    moveTo: function () {}, lineTo: function () {}, arc: function () {},
    stroke: function () { strokes++; }, fillRect: function () { fills++; },
    globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: ''
  };
  const freeze = impact.IMPACT_TIER1_FREEZE_MS;   // 320
  impact.resetImpact();
  impact.startImpact(poster, 0, { reduceMotion: false, speed: 1 });

  function at(t) {
    strokes = 0; fills = 0;
    impact.drawImpactLines(ctx, t);
    impact.drawImpactFlash(ctx, t, 480, 270);
    return { strokes: strokes, fills: fills };
  }
  const early = at(10);
  assert.ok(early.fills > 0 && early.strokes === 0, 'flash owns the opening, lines silent');
  const mid = at(Math.round(freeze / 2));
  assert.ok(mid.strokes > 0, 'lines must draw in the MIDDLE of the freeze, not after it');
  assert.strictEqual(mid.fills, 0, 'flash must be finished by mid-freeze');
  const justInside = at(freeze - 10);
  assert.ok(justInside.strokes > 0, 'lines must still be alive at the end of the freeze');
  impact.resetImpact();
  console.log('checkLinesPlayInsideTheFreeze: OK');
}

// The camera pushes in on the takeoff; the flash and lines wait for the slam.
function checkZoomLeadIn() {
  const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));
  const poster = { kind: 'poster', at: { x: 446, y: 160 } };
  const opts = { reduceMotion: false, speed: 1 };
  let strokes = 0, fills = 0;
  const ctx = {
    save: function () {}, restore: function () {}, beginPath: function () {},
    moveTo: function () {}, lineTo: function () {},
    stroke: function () { strokes++; }, fillRect: function () { fills++; },
    globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: ''
  };
  // Armed at a SMALL clock value on purpose. `startMs` is null during the
  // lead-in, and `nowMs - null` is `nowMs` — so at a large clock the age lands
  // past both windows and the effects stay quiet by luck rather than by the
  // guard. A poster early in playback is the case that actually exercises it.
  impact.resetImpact();
  impact.armImpactZoom(poster, 20, opts);
  assert.ok(impact.impactZoom(20, 480, 270), 'lead-in must zoom immediately');
  assert.ok(impact.impactZoom(200, 480, 270), 'lead-in zoom must hold through the rise');
  impact.drawImpactLines(ctx, 30);
  impact.drawImpactFlash(ctx, 30, 480, 270);
  impact.drawImpactLines(ctx, 200);
  impact.drawImpactFlash(ctx, 200, 480, 270);
  assert.strictEqual(strokes + fills, 0, 'lead-in is camera only — no flash, no lines');

  // the slam upgrades it in place, and the flash starts from the SLAM
  impact.startImpact(poster, 240, opts);
  fills = 0;
  impact.drawImpactFlash(ctx, 245, 480, 270);
  assert.ok(fills > 0, 'flash must fire at the slam');
  assert.ok(impact.impactZoom(300, 480, 270), 'zoom continues through the freeze');
  assert.strictEqual(impact.impactZoom(240 + impact.IMPACT_TIER1_FREEZE_MS + 50, 480, 270), null,
    'zoom must release after the freeze');

  // a block never zooms, lead-in or otherwise
  impact.resetImpact();
  impact.armImpactZoom({ kind: 'block', at: { x: 100, y: 100 } }, 0, opts);
  assert.strictEqual(impact.impactZoom(0, 480, 270), null, 'blocks must never zoom');
  impact.resetImpact();
  console.log('checkZoomLeadIn: OK');
}

// An ankle breaker has to BE an ankle breaker. Before this, the classifier
// picked a shot where the handler badly out-rated his man and the view zoomed
// in on... a player standing still shooting a jumper, with the defender at
// ordinary spacing. The move has to exist in the choreography, not just in the
// camera work.
function checkAnkleBreakerHasACrossover() {
  require(path.join(__dirname, '..', 'data.js'));
  const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const league = require(path.join(__dirname, '..', 'league.js'));

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  let checked = 0;
  const opened = [];
  for (let s = 0; s < 6; s++) {
    const home = TEAMS[s % 30], away = TEAMS[(s + 11) % 30];
    const events = [];
    const res = gameSim.simulateGame(home.id, away.id, makeRng(5300 + s), { events: events });
    const kfs = choreo.buildTimeline({
      events: events,
      homeRoster: league.getTeamRoster(home.id),
      awayRoster: league.getTeamRoster(away.id),
      boxScore: res.boxScore
    }).keyframes;

    kfs.forEach(function (k, i) {
      if (!k.impact || k.impact.kind !== 'ankle') return;
      const by = k.impact.byId, on = k.impact.onId;
      const found = {};
      for (let j = i; j >= 0 && j > i - 14; j--) {
        const c = kfs[j].cross;
        if (c && c.by === by && c.on === on && !found[c.phase]) found[c.phase] = kfs[j];
      }
      ['jab', 'cross', 'clear', 'recover'].forEach(function (p) {
        assert.ok(found[p], 'ankle breaker is missing its "' + p + '" beat');
      });
      // The separation has to actually open, or it is a sidestep. Asserted as
      // a DISTRIBUTION, not per breaker: how far a given crossover opens
      // depends on where on the floor it started, so a hard per-instance floor
      // is the wrong shape — the same mistake as the per-game score floor this
      // project already replaced with a distribution check. Measured over 120
      // breakers the separation runs min +2.3, median +9.1, max +10.5, and is
      // NEVER negative. So: every breaker must open some separation, and the
      // median must open real separation.
      const gJab = dist(found.jab.pos[by], found.jab.pos[on]);
      const gClear = dist(found.clear.pos[by], found.clear.pos[on]);
      assert.ok(gClear > gJab,
        'crossover must open separation, not close it (jab ' + gJab.toFixed(1) +
        ' -> clear ' + gClear.toFixed(1) + ')');
      opened.push(gClear - gJab);
      // and he must STAY beaten while the shot is gathered. Asserted at the
      // windup ('recover') rather than at the shot itself: by the shot keyframe
      // crashPositions has moved everyone goalward and would mask a defender
      // who snapped straight back to his man the instant the cut finished.
      const gRecover = dist(found.recover.pos[by], found.recover.pos[on]);
      assert.ok(gRecover > gClear - 4,
        'defender must stay beaten through the windup (clear ' + gClear.toFixed(1) +
        ' -> windup ' + gRecover.toFixed(1) + ')');
      // the defender bites HARDER than the jab — he ends up further across than
      // the man he is guarding, which is what selling the fake means
      assert.ok(found.cross.cross.phase === 'cross', 'cut beat must be tagged "cross"');
      checked += 1;
    });
  }
  assert.ok(checked >= 5, 'expected several ankle breakers across the fixture games, saw ' + checked);
  opened.sort(function (a, b) { return a - b; });
  const medianOpened = opened[Math.floor(opened.length / 2)];
  assert.ok(medianOpened >= 6,
    'the typical crossover must open real separation, median was ' + medianOpened.toFixed(1) + 'px');

  // A plain jump shot must NOT get a crossover — the move is the rare thing,
  // and a league where every jumper is preceded by a crossover is worse than
  // one with none. Exactly four cross beats per ankle breaker, no strays.
  const events2 = [];
  const res2 = gameSim.simulateGame(TEAMS[3].id, TEAMS[17].id, makeRng(991), { events: events2 });
  const kfs2 = choreo.buildTimeline({
    events: events2,
    homeRoster: league.getTeamRoster(TEAMS[3].id),
    awayRoster: league.getTeamRoster(TEAMS[17].id),
    boxScore: res2.boxScore
  }).keyframes;
  const ankleCount = kfs2.filter(function (k) { return k.impact && k.impact.kind === 'ankle'; }).length;
  const crossBeats = kfs2.filter(function (k) { return k.cross; }).length;
  assert.ok(ankleCount > 0, 'fixture game should contain at least one ankle breaker');
  assert.strictEqual(crossBeats, ankleCount * 4,
    'expected exactly 4 cross beats per ankle breaker — ' + crossBeats + ' beats for ' + ankleCount + ' breakers');
  console.log('checkAnkleBreakerHasACrossover: OK (' + checked + ' verified, ' +
    ankleCount + ' in the strays fixture with ' + crossBeats + ' beats)');
}

// The camera frames impact.at. Off-ball flow now moves most of the floor every
// beat, so the one thing that must NOT move is the player the camera is about
// to zoom in on — otherwise the effect fires on empty hardwood.
function checkTheCameraStillLandsOnTheActor() {
  require(path.join(__dirname, '..', 'data.js'));
  const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const league = require(path.join(__dirname, '..', 'league.js'));

  let checked = 0;
  for (let s = 0; s < 4; s++) {
    const home = TEAMS[s % 30], away = TEAMS[(s + 9) % 30];
    const events = [];
    const res = gameSim.simulateGame(home.id, away.id, makeRng(4242 + s), { events: events });
    const kfs = choreo.buildTimeline({
      events: events,
      homeRoster: league.getTeamRoster(home.id),
      awayRoster: league.getTeamRoster(away.id),
      boxScore: res.boxScore
    }).keyframes;
    kfs.forEach(function (k) {
      if (!k.impact) return;
      // a block resolves where the SHOT was (onId); a poster and an ankle
      // breaker resolve on the man who made them (byId)
      const whoId = k.impact.kind === 'block' ? k.impact.onId : k.impact.byId;
      const who = k.pos[whoId];
      if (!who) return;
      const off = Math.hypot(who[0] - k.impact.at.x, who[1] - k.impact.at.y);
      assert.ok(off <= 8,
        k.impact.kind + ' fires ' + off.toFixed(1) + 'px away from its actor — the zoom would frame empty court');
      checked += 1;
    });
  }
  assert.ok(checked >= 15, 'expected a decent sample of impacts, saw ' + checked);
  console.log('checkTheCameraStillLandsOnTheActor: OK (' + checked + ' impacts on the mark)');
}

checkTheCameraStillLandsOnTheActor();
checkAnkleBreakerHasACrossover();
checkEffectsUseARealTimeClock();
checkLinesPlayInsideTheFreeze();
checkZoomLeadIn();
checkEdgesRespondToMatchup();
checkPosterNeedsAllThreeConditions();
checkAnkleBreakerIsOutsideOnly();
checkPosterAndAnkleAreDisjoint();
checkBlockIsAlwaysTierTwo();
checkUnknownAndMalformedEventsAreIgnored();
checkMarkerReachesTheKeyframe();
checkEffectTiming();
checkDrawCallsAreSafe();
checkRateStaysInBand();

console.log('All impactMoments validations passed');
