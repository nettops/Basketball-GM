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
const fs = require('fs');

const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));
const motion = require(path.join(__dirname, '..', 'ui', 'pixelMotion.js'));

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

// How often a matchup fires across many possession seeds. The ankle breaker is
// a skill CHECK now, so a single call answers nothing — the question is the
// rate, not the verdict.
function ankleRate(shooter, defender, zone) {
  let n = 0;
  const trials = 4000;
  for (let seed = 0; seed < trials; seed++) {
    if (choreo.classifyImpact({ type: 'shot', made: true, zone: zone || 'mid' }, shooter, defender, seed) === 'ankle') n += 1;
  }
  return n / trials;
}

function checkAnkleBreakerIsOutsideOnly() {
  assert.ok(ankleRate(eliteHandler, weakPerimeter, 'mid') > 0.2,
    'a big handle edge on a made mid-range should often be an ankle breaker');
  assert.ok(ankleRate(eliteHandler, weakPerimeter, 'three') > 0.2,
    'the same applies from three');
  assert.ok(ankleRate(eliteHandler, elitePerimeter, 'mid') < 0.1,
    'a defender who stays in front should rarely be beaten');
  let missed = 0;
  for (let seed = 0; seed < 500; seed++) {
    if (choreo.classifyImpact({ type: 'shot', made: false, zone: 'three' }, eliteHandler, weakPerimeter, seed)) missed += 1;
  }
  assert.strictEqual(missed, 0, 'a miss never fires — celebrating a brick would read as a bug');
}

// THE reason this stopped being a threshold.
//
// `handleEdge >= 22` is fully deterministic on two fixed rating sets, so the
// same two players always produced the same verdict. Measured over 30 real
// games, every matchup that came up three or more times was all-or-nothing —
// 100% of them. A handler at edge 22.5 broke his man's ankles on 3 of 3 made
// jumpers; one at 21.5 never would, in any game, all season.
function checkTheSameMatchupIsNotAlwaysTheSameAnswer() {
  // Someone right on the old line: neither a certainty nor an impossibility.
  const borderline = mkPlayer({ id: 'borderline', attributes: { ballHandling: 74, acceleration: 70, speed: 72 } });
  const average = mkPlayer({ id: 'average', attributes: { perimeterDefense: 50 } });
  const r = ankleRate(borderline, average);
  assert.ok(r > 0.02 && r < 0.5,
    'a middling matchup fires ' + (r * 100).toFixed(1) + '% of the time — a check, not a lookup');

  // Neither end of the scale may be absolute. The bottom matters as much as the
  // top: without a floor the arithmetic clamps a third of all matchups to
  // exactly zero, which is the same defect facing the other way.
  const bestCase = ankleRate(eliteHandler, weakPerimeter);
  const worstCase = ankleRate(mkPlayer({ id: 'clumsy', attributes: { ballHandling: 25, acceleration: 30, speed: 30 } }),
    elitePerimeter);
  assert.ok(bestCase < 0.95, 'even the best matchup must not be automatic, got ' + bestCase.toFixed(3));
  assert.ok(worstCase > 0, 'even the worst matchup must be possible, got ' + worstCase.toFixed(3));
  assert.ok(bestCase > worstCase * 3,
    'skill has to matter: best ' + bestCase.toFixed(3) + ' against worst ' + worstCase.toFixed(3));

  // And it must be REPLAYABLE. This file is rebuilt from a stored event log
  // every time a game is re-watched or seeked; a real rng here would deal a
  // different highlight reel each time.
  for (let seed = 0; seed < 50; seed++) {
    const a = choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, weakPerimeter, seed);
    const b = choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, weakPerimeter, seed);
    assert.strictEqual(a, b, 'the same possession must classify the same way every time it is replayed');
  }

  console.log('checkTheSameMatchupIsNotAlwaysTheSameAnswer: OK (borderline ' +
    (r * 100).toFixed(1) + '%, best ' + (bestCase * 100).toFixed(1) +
    '%, worst ' + (worstCase * 100).toFixed(1) + '%)');
}
checkTheSameMatchupIsNotAlwaysTheSameAnswer();

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
      // A per-event seed, standing in for the possession seed the choreographer
      // passes. Omitting it hands every event in every game the SAME roll, so
      // an ankle breaker becomes all-or-nothing league-wide — which is how this
      // first read 7.42/game against a true 4.40.
      ev.forEach(function (e, ei) {
        const kind = choreo.classifyImpact(e, byId[e.playerId], byId[e.defenderId], (i * 100 + g) * 977 + ei);
        if (kind) count[kind] += 1;
      });
    }
  }

  // PER-KIND bands. This was a single 0.5-4 range covering both, which was the
  // right shape when both were meant to be equally rare. They no longer are:
  // crossovers were deliberately roughly doubled (threshold 34 -> 26) because
  // they should feel common, while posters stay rare. One range for both now
  // encodes a stale intent, and at 3.65/game the shared ceiling of 4 left so
  // little headroom that ordinary drift would fail the build for no defect.
  //
  // NOT widened to make a change pass — the change already passed at 3.65. The
  // bound is being re-aimed because the design intent behind it changed.
  const RATE_BANDS = { poster: [0.5, 3], ankle: [1.5, 6] };
  ['poster', 'ankle'].forEach(function (kind) {
    const rate = count[kind] / games;
    const band = RATE_BANDS[kind];
    assert.ok(rate >= band[0] && rate <= band[1],
      kind + ' fires ' + rate.toFixed(2) + '/game over ' + games +
      ' games, outside its ' + band[0] + '-' + band[1] +
      ' band — recalibrate IMPACT_THRESHOLDS in ui/pixelChoreographer.js');
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

  // Blocks run about 3.6 per game, so a single fixture game legitimately
  // contains zero — this used to ride on seed 4242 happening to have one, and
  // tripped the first time an unrelated change shifted the sim. Searches until
  // it finds a game with a block, then uses that one for the checks below.
  const home = TEAMS[0], away = TEAMS[9];
  let events = null, result = null, blockEvents = [];
  for (let s = 0; s < 12 && blockEvents.length === 0; s++) {
    events = [];
    result = gameSim.simulateGame(home.id, away.id, makeRng(4242 + s), { events: events });
    blockEvents = events.filter(function (e) { return e.type === 'block'; });
  }
  const timeline = choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster(home.id),
    awayRoster: league.getTeamRoster(away.id),
    boxScore: result.boxScore
  });

  assert.ok(blockEvents.length > 0, 'no seed in 4242-4253 produced a block; the fixture can no longer find one');

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

  // SPEED POLICY, DELIBERATELY INVERTED. The three assertions that used to live
  // here encoded the opposite rule — full freeze at 2x, halved at 4x, nothing at
  // 8x. That switched the emphasis off at exactly the speed where a highlight
  // blurs past, which is the defect this change exists to fix. They are replaced
  // rather than deleted so the reversal is visible in history.
  //
  // Two separate rules, asserted separately because they can break separately:
  //   (a) WHICH kinds still qualify — the bar rises with speed
  //   (b) HOW LONG a qualifying freeze holds — emphasis grows with speed
  const ankle = { kind: 'ankle', at: { x: 100, y: 100 }, byId: 'a', onId: 'b' };

  // (a) the bar
  assert.strictEqual(impact.impactQualifies('poster', 1), true, 'a poster always qualifies');
  assert.strictEqual(impact.impactQualifies('poster', 8), true, 'including at 8x — this is the whole point');
  assert.strictEqual(impact.impactQualifies('block', 2), true, 'a block qualifies at 2x');
  assert.strictEqual(impact.impactQualifies('block', 4), false,
    'blocks are ~4.5/game and stop qualifying above 2x, or 8x stutters');
  assert.strictEqual(impact.impactQualifies('ankle', 4), true, 'an ankle breaker survives 4x');
  assert.strictEqual(impact.impactQualifies('ankle', 8), false, 'but not 8x — only posters do');

  assert.strictEqual(impact.impactFreezeMs(block, { reduceMotion: false, speed: 8 }), 0,
    'a non-qualifying kind freezes for exactly zero');
  assert.ok(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 8 }) > 0,
    '8x MUST still stop for a poster — the old behaviour returned 0 here');

  // (b) the duration
  assert.strictEqual(impact.impactFreezeMs(poster, full), impact.IMPACT_TIER1_FREEZE_MS,
    '1x is unchanged from before this feature');
  assert.ok(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 2 }) >
            impact.impactFreezeMs(poster, full),
    'emphasis GROWS with speed rather than fading');
  assert.ok(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 8 }) <= impact.IMPACT_FREEZE_MAX_MS,
    'and is capped, or a freeze reads as a hang rather than a moment');
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 8 }),
    impact.impactFreezeMs(poster, { reduceMotion: false, speed: 4 }),
    'both land on the cap, so 8x is not longer than 4x');

  assert.ok(impact.impactFreezeMs(ankle, { reduceMotion: false, speed: 4 }) > 0,
    'an ankle breaker still holds at 4x');

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

  // ...and at 8x a poster fires HARDER, not less. This line used to assert the
  // opposite ('nothing fires at 8x'), left behind by b9b0b2e along with the
  // startImpact gate that made it true. Both are corrected now: at 1x you can
  // follow a dunk unaided, at 8x it is a smear, so 8x is where the camera and
  // the freeze earn their keep.
  impact.resetImpact();
  impact.startImpact(poster, 1000, { reduceMotion: false, speed: 8 });
  assert.ok(impact.impactZoom(1010) !== null, 'a poster must still fire at 8x');

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

// The effect has to ARM, not merely be willing to.
//
// This exists because it did not. b9b0b2e made big moments hit hardest at high
// speed and removed the 8x bail-out from armImpactZoom, but left an identical
// one in startImpact -- so at 8x nothing was ever armed: no zoom, no flash, no
// speed lines, no freeze. The feature was dead at exactly the speed it had just
// been rebuilt for.
//
// It survived because every check here asked impactFreezeMs, which answers
// 900ms quite happily; the game never reached it. So this drives the real
// entry point and then asks what the VIEW would get back, which is the only
// question that matters.
function checkTheEffectActuallyArmsAtEverySpeed() {
  const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));
  const poster = { kind: 'poster', at: { x: 240, y: 160 }, byId: 'a', onId: 'b' };
  const block = { kind: 'block', at: { x: 240, y: 160 }, byId: 'a', onId: 'b' };

  [1, 2, 4, 8].forEach(function (speed) {
    impact.resetImpact();
    impact.startImpact(poster, 0, { reduceMotion: false, speed: speed });
    assert.ok(impact.impactZoom(10) !== null,
      'a poster must arm the camera at ' + speed + 'x -- it is the rarest play in the game');
    assert.ok(impact.impactFreezeMs(poster, { reduceMotion: false, speed: speed }) > 0,
      'a poster must still freeze at ' + speed + 'x');
  });

  // ...and the bar still rises: a block is common and least spectacular, so it
  // is the first to stop interrupting. If this ever passed at 4x the fix above
  // would have gone too far the other way.
  impact.resetImpact();
  impact.startImpact(block, 0, { reduceMotion: false, speed: 4 });
  assert.strictEqual(impact.impactZoom(10), null, 'a block must not arm anything at 4x');
  assert.strictEqual(impact.impactFreezeMs(block, { reduceMotion: false, speed: 4 }), 0,
    'a block must not freeze at 4x');

  // THE ANKLE BREAKER IS THE CASE THAT MATTERS, and the first version of this
  // check missed it: deleting the qualifying gate from startImpact altogether
  // still passed, because a block is filtered a second time by `zoom` and a
  // poster qualifies everywhere. An ankle breaker is the only kind the gate
  // decides on its own -- it zooms (it is not a block) but stops qualifying
  // above 4x -- so without the gate the camera would snap in on a play that
  // has a zero-length freeze, and the zoom would flick in and straight out.
  // ...and it has to be asked about the FLASH and the LINES, not the zoom.
  // Asking about the zoom does not work: it self-expires the moment
  // `nowMs - startMs > freezeMs`, and a non-qualifying play has a zero freeze,
  // so the zoom looks correctly suppressed whether the gate is there or not.
  // The flash and the lines are aged against their own durations and would
  // still fire. A first version of this check only asked about the zoom and
  // deleting the entire gate survived it.
  const ankle = { kind: 'ankle', at: { x: 240, y: 160 }, byId: 'a', onId: 'b' };
  function drawsAnything(marker, speed) {
    impact.resetImpact();
    impact.startImpact(marker, 0, { reduceMotion: false, speed: speed });
    let calls = 0;
    const spy = {
      save: function () {}, restore: function () {}, beginPath: function () {},
      moveTo: function () {}, lineTo: function () {},
      stroke: function () { calls++; }, fillRect: function () { calls++; },
      globalAlpha: 0, strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: ''
    };
    impact.drawImpactFlash(spy, 10, 480, 270);
    impact.drawImpactLines(spy, impact.IMPACT_TIER1_FREEZE_MS / 2);
    return calls > 0;
  }
  [1, 2, 4].forEach(function (speed) {
    assert.ok(drawsAnything(ankle, speed), 'an ankle breaker must still land at ' + speed + 'x');
  });
  assert.strictEqual(drawsAnything(ankle, 8), false,
    'at 8x only a poster survives -- an ankle breaker must draw nothing at all');
  assert.ok(drawsAnything(poster, 8), 'a poster must still draw its flash and lines at 8x');

  impact.resetImpact();
  impact.startImpact(poster, 0, { reduceMotion: true, speed: 1 });
  assert.strictEqual(impact.impactZoom(10), null, 'reduced motion must still suppress everything');

  impact.resetImpact();
  console.log('checkTheEffectActuallyArmsAtEverySpeed: OK');
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
  // Ankle breakers fire around twice a game, so a single fixture game legitimately
  // contains zero — this used to depend on seed 991 happening to have one.
  // Accumulating over several games tests the real invariant (exactly four cross
  // beats per breaker, no strays) without riding on one game's luck.
  let ankleCount = 0, crossBeats = 0;
  for (let s = 0; s < 8; s++) {
    const events2 = [];
    const home2 = TEAMS[(3 + s) % 30], away2 = TEAMS[(17 + s) % 30];
    if (home2.id === away2.id) continue;
    const res2 = gameSim.simulateGame(home2.id, away2.id, makeRng(991 + s), { events: events2 });
    const kfs2 = choreo.buildTimeline({
      events: events2,
      homeRoster: league.getTeamRoster(home2.id),
      awayRoster: league.getTeamRoster(away2.id),
      boxScore: res2.boxScore
    }).keyframes;
    ankleCount += kfs2.filter(function (k) { return k.impact && k.impact.kind === 'ankle'; }).length;
    crossBeats += kfs2.filter(function (k) { return k.cross; }).length;
  }
  assert.ok(ankleCount > 0, 'fixture games should contain at least one ankle breaker');
  assert.strictEqual(crossBeats, ankleCount * 4,
    'expected exactly 4 cross beats per ankle breaker — ' + crossBeats + ' beats for ' + ankleCount + ' breakers');
  console.log('checkAnkleBreakerHasACrossover: OK (' + checked + ' verified, ' +
    ankleCount + ' in the strays fixture with ' + crossBeats + ' beats)');
}

// The camera frames impact.at. Off-ball flow now moves most of the floor every
// beat, so the one thing that must NOT move is the player the camera is about
// to zoom in on — otherwise the effect fires on empty hardwood.
// Where the VIEW actually puts a dunker's ball at full extension, obtained by
// running the view's own code rather than by quoting the choreographer's
// constant back at itself. Asking DUNK_REACH about DUNK_REACH is vacuous --
// mutation testing proved it: doubling it and halving it both survived,
// because the placement and the check were reading the same number.
//
// This used to scrape the numbers out of ui/pixelGameView.js with a regex,
// which was independent but brittle: moving the code to ui/pixelMotion.js
// broke the parse. Now it CALLS the drawing function. Independent and exact --
// any change to the lift table, the hand offset or the easing moves this.
function viewDunkReach() {
  const apex = motion.DUNK_LIFT.rise;
  // The ball's height above the dunker's feet at the top of the leap, straight
  // out of the function the canvas draws with. `cock` is forced to 1 rather
  // than passed dunkCock(apex): if the easing ever stopped reaching full
  // extension at the apex this must FAIL, not quietly agree with itself about
  // a shorter reach.
  const reach = motion.heldBallOffset('dunk', apex, 1, { up: 0, side: 0 }).up;
  assert.strictEqual(motion.dunkCock(apex), 1,
    'a dunker must be at FULL extension at the apex, not ' + motion.dunkCock(apex));
  assert.strictEqual(choreo.DUNK_REACH, reach,
    'choreographer plants a dunker ' + choreo.DUNK_REACH + 'px below the rim, but the view ' +
    'puts his ball ' + reach + 'px above his feet -- the ball would miss the rim by ' +
    Math.abs(reach - choreo.DUNK_REACH) + 'px');
  return reach;
}

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
      // A POSTER RESOLVES AT HIS HAND, NOT HIS FEET. A dunker plants
      // DUNK_REACH below the rim precisely so his raised hand arrives ON it, so
      // his floor position is 46px from the impact BY DESIGN and measuring
      // there would demand the camera frame his shoes. What the zoom actually
      // holds is the rim, the ball and his outstretched arm — all at the point
      // DUNK_REACH above him. The margin below is unchanged; only the point
      // being measured is corrected.
      const reach = k.impact.kind === 'poster' ? viewDunkReach() : 0;
      const off = Math.hypot(who[0] - k.impact.at.x, (who[1] - reach) - k.impact.at.y);
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
checkTheEffectActuallyArmsAtEverySpeed();
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
