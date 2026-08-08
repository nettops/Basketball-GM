# Impact Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give posters, ankle breakers and blocks a comic-panel treatment in the watched game — snap zoom, white flash, radial speed lines, freeze and shake — with blocks on a shorter tier.

**Architecture:** `ui/pixelChoreographer.js` classifies each shot/block event and attaches a structured `impact` marker to the keyframe it is already pushing. A new `ui/pixelImpact.js` owns all presentation. `ui/pixelGameView.js` reads the marker on the frame it already inspects and drives the effect. The possession engine, the save format and the recorded event log are untouched.

**Tech Stack:** Vanilla ES5-style JavaScript, zero dependencies. Dual `require`/global module pattern. Node validators in `scripts/`, browser assertions in `scripts/ui-smoke.js`.

## Global Constraints

- No changes to `simEnginePossession.js`, `gameSim.js`, or the save format. All three moments are derived from data the event log already carries.
- Detection keys off structured fields, never display strings. Do not extend `BIG_PLAY_LABELS`/`MAKE_LABELS` matching.
- Thresholds are calibrated by target rate against the whole league, never picked off raw ratings. Target ~2 posters and ~1.5 ankle breakers per game; validator band 0.5–4 per game per type.
- Posters and ankle breakers must be disjoint by construction — inside makes are posters, mid/three makes are ankle breakers.
- Reuse the existing `hitchMs` for freezing. Do not add a second freeze timer.
- Reduced motion removes motion, not information: no zoom/flash/shake/extended freeze, but the caption still names the play.
- Speed: full at 1×/2×, halved freeze at 4×, nothing at 8×.
- Every file keeps the existing dual-export footer: `if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }`

---

### Task 1: The classifier

Pure functions over two players and an event. No canvas, no timeline — this is the whole decision, testable in Node.

**Files:**
- Modify: `ui/pixelChoreographer.js` (add near `isDunker`, ~line 137; extend `module.exports` at ~line 694)
- Test: `scripts/validate-impactMoments.js` (create)

**Interfaces:**
- Consumes: existing `isDunker(player)` in the same file.
- Produces:
  - `IMPACT_THRESHOLDS` → `{ poster: number, ankle: number }`
  - `posterEdge(shooter, defender)` → number
  - `handleEdge(shooter, defender)` → number
  - `classifyImpact(ev, shooter, defender)` → `'poster' | 'ankle' | 'block' | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-impactMoments.js`:

```js
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

checkEdgesRespondToMatchup();
checkPosterNeedsAllThreeConditions();
checkAnkleBreakerIsOutsideOnly();
checkPosterAndAnkleAreDisjoint();
checkBlockIsAlwaysTierTwo();
checkUnknownAndMalformedEventsAreIgnored();

console.log('All impactMoments validations passed');
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/validate-impactMoments.js
```

Expected: `TypeError: choreo.posterEdge is not a function`

- [ ] **Step 3: Implement the classifier**

In `ui/pixelChoreographer.js`, immediately after the `isDunker` function (~line 137), add:

```js
// Which plays earn the comic-panel treatment (see ui/pixelImpact.js).
//
// Calibrated by target rate against the whole league, NOT by reading rating
// numbers — see the DUNK_LIFT_THRESHOLD comment above for why that fails here.
// scripts/validate-impactMoments.js asserts the observed rate stays in band as
// progression moves ratings over the league's life.
const IMPACT_THRESHOLDS = { poster: 22, ankle: 20 };

// How badly the finisher beat the man protecting the rim.
function posterEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.vertical * 2 + a.insideScoring) / 3 - d.interiorDefense;
}

// How badly the ball-handler beat the man in front of him.
function handleEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.ballHandling * 2 + a.acceleration + a.speed) / 4 - d.perimeterDefense;
}

// → 'poster' | 'ankle' | 'block' | null
//
// Zone is what keeps poster and ankle disjoint: inside makes can only ever be
// posters, outside makes only ever ankle breakers. There is no precedence rule
// to get wrong, and validate-impactMoments.js pins that as a property.
function classifyImpact(ev, shooter, defender) {
  if (!ev) return null;
  if (ev.type === 'block') return 'block';
  if (ev.type !== 'shot' || !ev.made) return null;
  // A shot whose shooter or defender could not be resolved is not a highlight.
  if (!shooter || !shooter.attributes || !defender || !defender.attributes) return null;

  if (ev.zone === 'inside') {
    if (!isDunker(shooter)) return null;
    return posterEdge(shooter, defender) >= IMPACT_THRESHOLDS.poster ? 'poster' : null;
  }
  if (ev.zone === 'mid' || ev.zone === 'three') {
    return handleEdge(shooter, defender) >= IMPACT_THRESHOLDS.ankle ? 'ankle' : null;
  }
  return null;
}
```

Then extend the export block at the bottom of the file:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PIXEL_STAGE: PIXEL_STAGE,
    buildTimeline: buildTimeline,
    createChoreographer: createChoreographer,
    groupPossessions: groupPossessions,
    assignSlots: assignSlots,
    IMPACT_THRESHOLDS: IMPACT_THRESHOLDS,
    posterEdge: posterEdge,
    handleEdge: handleEdge,
    classifyImpact: classifyImpact
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/validate-impactMoments.js
```

Expected: `All impactMoments validations passed`

- [ ] **Step 5: Confirm nothing else broke**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: `done` with no FAIL lines (38 validators now).

- [ ] **Step 6: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-impactMoments.js
git commit -m "feat: classify posters, ankle breakers and blocks"
```

---

### Task 2: Calibrate the thresholds against the whole league

Task 1's numbers are exploratory, measured on a single matchup with ~10 distinct shooter/defender pairings. This task replaces them with numbers measured across every team, and adds the rate-band assertion that keeps them honest.

**Files:**
- Modify: `ui/pixelChoreographer.js` (the `IMPACT_THRESHOLDS` values only)
- Modify: `scripts/validate-impactMoments.js` (add the rate-band check)

**Interfaces:**
- Consumes: `classifyImpact` from Task 1; `getActiveEngine` from `simEngine.js`; `getTeamRoster` from `league.js`.
- Produces: calibrated `IMPACT_THRESHOLDS`; `checkRateStaysInBand()`.

- [ ] **Step 1: Measure the current rate across many matchups**

Create a throwaway measurement script at `/tmp/calibrate-impact.js`:

```js
const path = require('path');
const root = path.join(__dirname);
const rngMod = require('C:/Users/cory/Desktop/nba/rng.js');
require('C:/Users/cory/Desktop/nba/simEngineBoxScore.js');
require('C:/Users/cory/Desktop/nba/gameSim.js');
const se = require('C:/Users/cory/Desktop/nba/simEngine.js');
const league = require('C:/Users/cory/Desktop/nba/league.js');
const teams = require('C:/Users/cory/Desktop/nba/teams.js');
const choreo = require('C:/Users/cory/Desktop/nba/ui/pixelChoreographer.js');
const engine = se.getActiveEngine({ simEngine: 'possession' });

const ids = teams.TEAMS.map(function (t) { return t.id; });
const byId = {};
ids.forEach(function (id) { league.getTeamRoster(id).forEach(function (p) { byId[p.id] = p; }); });

// sweep candidate thresholds over many different matchups
[16, 18, 20, 22, 24, 26].forEach(function (thr) {
  choreo.IMPACT_THRESHOLDS.poster = thr;
  choreo.IMPACT_THRESHOLDS.ankle = thr;
  let poster = 0, ankle = 0, block = 0, games = 0;
  for (let i = 0; i < ids.length; i++) {
    const home = ids[i], away = ids[(i + 7) % ids.length];
    for (let g = 0; g < 8; g++) {
      const rng = rngMod.makeRng(70000 + i * 100 + g);
      const ev = [];
      engine.simulateGame(home, away, rng, { events: ev });
      games++;
      ev.forEach(function (e) {
        const kind = choreo.classifyImpact(e, byId[e.playerId], byId[e.defenderId]);
        if (kind === 'poster') poster++;
        else if (kind === 'ankle') ankle++;
        else if (kind === 'block') block++;
      });
    }
  }
  console.log('thr ' + String(thr).padEnd(4) +
    ' poster/gm ' + (poster / games).toFixed(2).padStart(6) +
    '  ankle/gm ' + (ankle / games).toFixed(2).padStart(6) +
    '  block/gm ' + (block / games).toFixed(2).padStart(6) +
    '  (' + games + ' games)');
});
```

Run it:

```bash
node /tmp/calibrate-impact.js
```

- [ ] **Step 2: Set the thresholds to hit the target rates**

From the sweep, pick the poster threshold whose rate is nearest **2.0/game** and the ankle threshold nearest **1.5/game**. They will usually differ — the rating spread for leaping finishers is wider than for handles, so the same cutoff produces roughly twice as many posters as ankle breakers.

Edit `IMPACT_THRESHOLDS` in `ui/pixelChoreographer.js` to those two values, and update the comment above it to record the observed rates:

```js
// Calibrated 2026-08-07 against all 30 teams: poster fires ~2.0/game, ankle
// ~1.5/game. checkRateStaysInBand in scripts/validate-impactMoments.js holds
// these to 0.5-4/game so progression cannot silently turn them into confetti.
const IMPACT_THRESHOLDS = { poster: <measured>, ankle: <measured> };
```

Replace `<measured>` with the two numbers from Step 1. Do not leave the angle brackets in the file.

- [ ] **Step 3: Write the failing rate-band test**

Append to `scripts/validate-impactMoments.js`, before the call block at the bottom:

```js
// The check that survives the league aging. Progression moves ratings every
// season; a cutoff that is right in 2026 could fire on every possession by
// 2034. The band is wide on purpose — this catches drift and misconfiguration,
// it is not a golden master and must not fail on ordinary rng variation.
function checkRateStaysInBand() {
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
```

Add the call alongside the others:

```js
checkRateStaysInBand();
```

- [ ] **Step 4: Run it**

```bash
node scripts/validate-impactMoments.js
```

Expected: `All impactMoments validations passed`. If a rate assertion fires, return to Step 2 and adjust that threshold — do not widen the band to make it pass.

- [ ] **Step 5: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-impactMoments.js
git commit -m "feat: calibrate impact thresholds by rate across all 30 teams"
```

---

### Task 3: The choreographer attaches the marker

**Files:**
- Modify: `ui/pixelChoreographer.js` — `push()` at ~line 370; the `block` branch at ~line 544; the `shot` branch at ~line 553
- Test: `scripts/validate-impactMoments.js` (add a timeline check)

**Interfaces:**
- Consumes: `classifyImpact` from Task 1.
- Produces: keyframes carrying `impact: { kind, at: { x, y }, byId, onId }` or `impact: null`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-impactMoments.js`, before the call block:

```js
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
  const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
  ensureHiddenPlayerData(PLAYERS_2026);
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
```

Add the call:

```js
checkMarkerReachesTheKeyframe();
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/validate-impactMoments.js
```

Expected: `AssertionError: exactly one keyframe should carry the block marker` (0 found).

- [ ] **Step 3: Give `push()` an impact parameter**

In `ui/pixelChoreographer.js`, change the `push` signature and the object it builds (~line 370):

```js
  function push(dt, pos, ball, period, quarter, clock, text, commentary, sfx, impact) {
    t += dt;
    // Every keyframe goes through the collision pass so sprites never stack;
    // the current ball holder is the protected (immovable) body.
    const resolved = separatePositions(pos, ball.holder);
    keyframes.push({
      t: t, pos: resolved, ball: ball, score: score.slice(),
      period: period, quarter: quarter,
      clock: Math.max(0, Math.round(clock)), text: text || '', commentary: commentary || '',
      sfx: sfx || '',
      // Structured highlight marker, or null. ui/pixelGameView.js reads this
      // field rather than matching on `text` — see classifyImpact above.
      impact: impact || null,
      // index into timeline.snapshots (running leaders / foul trouble) and
      // which possession this beat belongs to, used to derive a shot clock
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
```

Every existing `push(...)` call keeps working — the new parameter is `undefined` and becomes `null`.

- [ ] **Step 4: Mark the block beat**

In the `block` branch (~line 544), replace the third `push` — the resolve beat — with:

```js
        // swatted sideways, not through the net
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, period, quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block',
          { kind: 'block', at: { x: sp[0], y: sp[1] }, byId: ev.defenderId, onId: ev.playerId });
```

- [ ] **Step 5: Mark the made-shot beat**

In the `shot` branch, find the `push(flightBeat(ev.zone), crashPos, ...)` call (~line 630). Immediately **before** it, add the classification:

```js
        // Highlight classification. Only made shots qualify; the shooter and
        // the contesting defender both come straight off the event.
        const impactKind = ev.made
          ? classifyImpact(ev, playerById[ev.playerId], playerById[ev.defenderId])
          : null;
        // Posters resolve at the rim, ankle breakers where the shot went up.
        const impactAt = impactKind === 'poster'
          ? { x: hoop.x, y: hoop.y }
          : { x: relSpot[0], y: relSpot[1] };
        const impactMarker = impactKind
          ? { kind: impactKind, at: impactAt, byId: ev.playerId, onId: ev.defenderId }
          : null;
```

Then add `impactMarker` as the final argument of that `push`:

```js
        push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          ev.made ? madeLabel : '', shotComment,
          ev.made ? (dunking ? 'dunk' : 'swish') : 'clang',
          impactMarker);
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node scripts/validate-impactMoments.js && node scripts/validate-pixel-choreographer.js
```

Expected: `All impactMoments validations passed` then the choreographer validator's own success line.

- [ ] **Step 7: Confirm nothing else broke**

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: `done` with no FAIL lines.

- [ ] **Step 8: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-impactMoments.js
git commit -m "feat: choreographer marks highlight keyframes"
```

---

### Task 4: The effect module

Timing, zoom and freeze are pure functions of a marker and a clock — testable in Node with no canvas. Only the two draw calls need a real context.

**Files:**
- Create: `ui/pixelImpact.js`
- Modify: `index.html` (script tag, after `ui/pixelHud.js`)
- Test: `scripts/validate-impactMoments.js` (add effect-timing checks)

**Interfaces:**
- Consumes: `impact` markers from Task 3.
- Produces:
  - `startImpact(marker, nowMs, opts)` → `void`; `opts` is `{ reduceMotion: boolean, speed: number }`
  - `impactFreezeMs(marker, opts)` → `number` (0 when suppressed)
  - `impactZoom(nowMs)` → `{ scale, cx, cy }` or `null`
  - `drawImpactLines(ctx, nowMs)` → `void` (call inside the scene transform)
  - `drawImpactFlash(ctx, nowMs, stageW, stageH)` → `void` (call after the scene transform)
  - `resetImpact()` → `void`

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-impactMoments.js`, before the call block:

```js
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
  assert.strictEqual(z.cx, 100, 'zoom is centred on the impact point');
  assert.strictEqual(z.cy, 100);
  assert.strictEqual(impact.impactZoom(1000 + 5000), null, 'the zoom releases');

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
```

Add the call:

```js
checkEffectTiming();
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/validate-impactMoments.js
```

Expected: `Cannot find module '.../ui/pixelImpact.js'`

- [ ] **Step 3: Create the effect module**

Create `ui/pixelImpact.js`:

```js
// Comic-panel treatment for highlight plays — see
// docs/superpowers/specs/2026-08-07-impact-moments-design.md.
//
// Two tiers. Posters and ankle breakers are rare (~3.5/game combined) and get
// the full effect: snap zoom, flash, radial speed lines, long freeze. Blocks
// are ~4/game and unfilterable, so they get a short punch — flash and shake at
// the freeze the view already used for makes. Acknowledging every swat without
// stopping the game four times is what keeps the top tier feeling rare.

// Durations in real milliseconds, unscaled by playback speed.
const IMPACT_TIER1_FREEZE_MS = 320;
const IMPACT_TIER2_FREEZE_MS = 120;
const IMPACT_FLASH_MS = 70;
const IMPACT_LINES_MS = 320;
const IMPACT_ZOOM_SCALE = 2;

let _impact = null;   // { kind, at, startMs, freezeMs, zoom }

// The zoom SNAPS rather than tweens. An eased scale on a 480x270 canvas with
// imageSmoothingEnabled = false lands sprite edges on fractional pixels every
// frame, which shimmers. Snapping in, holding, and snapping back is truer to
// pixel art and reads as a harder cut.
function impactFreezeMs(marker, opts) {
  if (!marker) return 0;
  const o = opts || {};
  if (o.reduceMotion) return 0;
  if (o.speed >= 8) return 0;
  const base = marker.kind === 'block' ? IMPACT_TIER2_FREEZE_MS : IMPACT_TIER1_FREEZE_MS;
  if (o.speed >= 4) return Math.round(base / 2);
  return base;
}

function startImpact(marker, nowMs, opts) {
  const o = opts || {};
  if (!marker) return;
  if (o.reduceMotion || o.speed >= 8) return;   // motion suppressed; caption still shows
  _impact = {
    kind: marker.kind,
    at: marker.at,
    startMs: nowMs,
    freezeMs: impactFreezeMs(marker, o),
    // only the rare tier zooms — a block four times a game would be seasick
    zoom: marker.kind !== 'block'
  };
}

function resetImpact() { _impact = null; }

function impactZoom(nowMs) {
  if (!_impact || !_impact.zoom) return null;
  if (nowMs - _impact.startMs > _impact.freezeMs) return null;
  return { scale: IMPACT_ZOOM_SCALE, cx: _impact.at.x, cy: _impact.at.y };
}

// Radial speed lines from the point of impact. Drawn INSIDE the scene
// transform so they stay anchored to the action while it is zoomed.
function drawImpactLines(ctx, nowMs) {
  if (!_impact) return;
  const age = nowMs - _impact.startMs;
  if (age < 0 || age > IMPACT_LINES_MS) return;
  if (_impact.kind === 'block') return;   // tier 2 gets no lines

  const fade = 1 - age / IMPACT_LINES_MS;
  const cx = _impact.at.x, cy = _impact.at.y;
  ctx.save();
  ctx.globalAlpha = 0.55 * fade;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const ang = (Math.PI * 2 / 12) * i;
    const inner = 18 + (1 - fade) * 10;
    const outer = inner + 26;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx + Math.cos(ang) * inner), Math.round(cy + Math.sin(ang) * inner));
    ctx.lineTo(Math.round(cx + Math.cos(ang) * outer), Math.round(cy + Math.sin(ang) * outer));
    ctx.stroke();
  }
  ctx.restore();
}

// Full-frame white flash. Drawn AFTER the scene transform so the zoom and the
// shake cannot skew or offset it.
function drawImpactFlash(ctx, nowMs, stageW, stageH) {
  if (!_impact) return;
  const age = nowMs - _impact.startMs;
  if (age < 0 || age > IMPACT_FLASH_MS) return;
  ctx.save();
  ctx.globalAlpha = 0.7 * (1 - age / IMPACT_FLASH_MS);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, stageW, stageH);
  ctx.restore();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IMPACT_TIER1_FREEZE_MS: IMPACT_TIER1_FREEZE_MS,
    IMPACT_TIER2_FREEZE_MS: IMPACT_TIER2_FREEZE_MS,
    startImpact: startImpact,
    resetImpact: resetImpact,
    impactFreezeMs: impactFreezeMs,
    impactZoom: impactZoom,
    drawImpactLines: drawImpactLines,
    drawImpactFlash: drawImpactFlash
  };
}
```

- [ ] **Step 4: Register the script**

In `index.html`, add after the `ui/pixelHud.js` line (line 138):

```html
  <script src="ui/pixelImpact.js"></script>
```

It must load before `ui/pixelGameView.js`, which calls into it.

- [ ] **Step 5: Run the test to verify it passes**

```bash
node scripts/validate-impactMoments.js
```

Expected: `All impactMoments validations passed`

- [ ] **Step 6: Commit**

```bash
git add ui/pixelImpact.js index.html scripts/validate-impactMoments.js
git commit -m "feat: pixelImpact.js — comic-panel effect module"
```

---

### Task 5: Wire the effect into the view

**Files:**
- Modify: `ui/pixelGameView.js` — effect trigger at ~line 447; scene transform at ~line 483; scene close at ~line 790

**Interfaces:**
- Consumes: `fr.a.impact` from Task 3; every function from Task 4.
- Produces: no new exports. `renderPixelGame` behaviour only.

- [ ] **Step 1: Fire the effect when a marked keyframe becomes current**

In `ui/pixelGameView.js`, inside the `if (fr.a.t !== lastEffectKfT) {` block, immediately after the existing `MAKE_LABELS` block (~line 456), add:

```js
      // Highlight plays. Read off a structured field, never the label text.
      // hitchMs is REUSED rather than paired with a second freeze clock: a
      // poster is also a made shot, so both paths fire on the same frame and
      // Math.max lets the longer hold win instead of two timers disagreeing.
      if (fr.a.impact) {
        startImpact(fr.a.impact, playbackMs, { reduceMotion: reduceMotion, speed: speed });
        hitchMs = Math.max(hitchMs, impactFreezeMs(fr.a.impact, { reduceMotion: reduceMotion, speed: speed }));
        if (!reduceMotion && speed < 8) shakeStartMs = playbackMs;
      }
```

- [ ] **Step 2: Apply the zoom inside the scene transform**

At the scene transform (~line 483), extend it:

```js
    ctx.save();
    ctx.translate(shakeX, shakeY);
    // Snap zoom on a highlight. Inside the shake transform and before the
    // sprites, so the court and players scale together; the scoreboard is
    // drawn after ctx.restore() below and is deliberately left untouched.
    const impactZoomNow = impactZoom(playbackMs);
    if (impactZoomNow) {
      ctx.translate(impactZoomNow.cx, impactZoomNow.cy);
      ctx.scale(impactZoomNow.scale, impactZoomNow.scale);
      ctx.translate(-impactZoomNow.cx, -impactZoomNow.cy);
    }
```

- [ ] **Step 3: Draw the lines and the flash**

Immediately **before** the `ctx.restore()` that closes the scene (~line 790), add:

```js
    // anchored to the action, so inside the zoom
    drawImpactLines(ctx, playbackMs);
```

Immediately **after** that same `ctx.restore()`, add:

```js
    // full-frame, so outside the zoom and the shake
    drawImpactFlash(ctx, playbackMs, PIXEL_STAGE.w, PIXEL_STAGE.h);
```

- [ ] **Step 4: Clear the effect when playback stops**

Find `stopPixelPlayback` (~line 88) and add `resetImpact();` to its body, so a lingering freeze cannot leak into the next watched game:

```js
function stopPixelPlayback() {
  if (typeof resetImpact === 'function') resetImpact();
```

- [ ] **Step 5: Verify in the browser**

Serve the repo on a port not used earlier in the session, with no-store
headers — a fresh port alone is not enough, the browser will still reuse a
cached bundle for identical paths:

```bash
python -c "import http.server,socketserver,functools; H=functools.partial(http.server.SimpleHTTPRequestHandler,directory='C:/Users/cory/Desktop/nba'); socketserver.ThreadingTCPServer.allow_reuse_address=True; socketserver.ThreadingTCPServer(('127.0.0.1',8941),H).serve_forever()"
```

Open `http://127.0.0.1:8941/index.html`, then in the page console start a
league, sim to a played day, and watch a game. Match the button by its text —
positional selectors on the dock have broken silently twice before:

```js
selectTeam('BOS');
await handleContinue();
Array.from(document.querySelectorAll('#sim-controls button'))
  .find(b => /Watch Next Game/i.test(b.textContent)).click();
```

Then confirm the wiring is live and no errors appear:

```js
JSON.stringify({
  moduleLoaded: typeof startImpact === 'function',
  markersInTimeline: 'check a marked keyframe fires'
})
```

Expected: `moduleLoaded: true`, no console errors, and the game plays normally.

- [ ] **Step 6: Capture the effect**

Take a screenshot during a highlight freeze. The tier-1 hold is 320ms, long enough to capture. Confirm by eye that the zoom is centred on the action, the flash is full-frame, the radial lines sit at the impact point, and **the scoreboard has not moved or scaled**.

- [ ] **Step 7: Commit**

```bash
git add ui/pixelGameView.js
git commit -m "feat: play the impact effect on marked keyframes"
```

---

### Task 6: Browser assertions and full verification

**Files:**
- Modify: `scripts/ui-smoke.js` — new `checkImpactMoments`, registered in `GROUPS`

**Interfaces:**
- Consumes: everything above.
- Produces: `impact` smoke group.

- [ ] **Step 1: Write the check**

In `scripts/ui-smoke.js`, add before the `GROUPS` object:

```js
  // The effect is driven by a structured marker and suppressed by speed and by
  // reduced motion. The scoreboard assertion is the one that catches the
  // layering being done wrong: it is drawn after the scene transform, so a
  // zoom must not move it. Getting that wrong is invisible in a still frame
  // where nothing happens to be zooming.
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

    resetImpact();
    startImpact(poster, 0, { reduceMotion: false, speed: 8 });
    results.push(ok('impact:nothing-at-8x', impactZoom(10) === null &&
      impactFreezeMs(poster, { reduceMotion: false, speed: 8 }) === 0));

    results.push(ok('impact:4x-halves-the-freeze',
      impactFreezeMs(poster, { reduceMotion: false, speed: 4 }) ===
        Math.round(impactFreezeMs(poster, { reduceMotion: false, speed: 1 }) / 2)));

    resetImpact();
    return results;
  }
```

Register it in `GROUPS`, after `advance`:

```js
    advance: checkAdvanceRepaints,
    impact: checkImpactMoments,
```

- [ ] **Step 2: Run the group in the browser**

```js
const res = UI_SMOKE.run('impact');
JSON.stringify({ passed: res.passed, failed: res.failed,
  results: res.results.map(r => (r.pass ? 'PASS ' : 'FAIL ') + r.name) })
```

Expected: 6 passed, 0 failed.

- [ ] **Step 3: Mutation-test the checks**

Stub the module to a no-op and confirm the group fails, proving the assertions are load-bearing:

```js
(function () {
  const orig = window.impactZoom;
  window.impactZoom = function () { return null; };
  const mutant = UI_SMOKE.run('impact');
  window.impactZoom = orig;
  return JSON.stringify({ mutantFailed: mutant.failed });
})()
```

Expected: `mutantFailed` is at least 1 — `impact:poster-zooms` must fail when zoom is neutered.

- [ ] **Step 4: Full verification**

Node:

```bash
for f in scripts/validate-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: `done`, no FAIL lines, 38 validators.

Browser:

```js
const res = UI_SMOKE.run();
JSON.stringify({ passed: res.passed, failed: res.failed,
  failures: res.results.filter(r => !r.pass).map(r => r.name) })
```

Expected: 0 failed. The count rises from 121 by the 6 new `impact` assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui-smoke.js
git commit -m "test: smoke coverage for impact moments"
```

---

## Verification checklist

- [ ] 38 Node validators pass, including the rate band
- [ ] Browser smoke passes with the new `impact` group, 0 failures
- [ ] A screenshot taken during a freeze shows zoom, flash and radial lines
- [ ] The scoreboard does not move or scale during a zoom
- [ ] `prefers-reduced-motion` suppresses the motion but the caption still names the play
- [ ] Nothing fires at 8×
- [ ] `git status` shows no unintended files
