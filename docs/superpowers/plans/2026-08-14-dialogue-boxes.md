# Ace Attorney-Style Dialogue Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable dialogue-box presentation layer — pixel bust, name plate, typewriter text, choices with consequences — and prove it on a halftime exchange and a post-game interview.

**Architecture:** A DOM overlay renders the box (it must sit over a live `<canvas>` *and* over normal views, which is why it is not canvas-native and not a `#view-content` scene). The portrait alone is canvas, drawn procedurally from each player's existing generated face data. Scene definitions are pure data with predicates and effect-returning choices, so selection and consequences are testable in node with no DOM.

**Tech Stack:** Vanilla ES5-style JavaScript, no build step, no framework. Tests are standalone node scripts using the built-in `assert` module.

**Spec:** `docs/superpowers/specs/2026-08-14-dialogue-boxes-design.md`

## Global Constraints

These apply to **every** task. They are not optional style preferences — two of them are enforced by existing static validators that will fail the build.

- **No build step.** Files are plain `<script>` tags in `index.html`. No imports, no bundler, no transpilation.
- **Dual-environment bridge.** Every new **root-level** module (not `ui/`) must carry the `_X_DATA` bridge:
  ```js
  var _X_DATA = (typeof require !== 'undefined')
    ? { ns: require('./ns.js') }        // Node: the WHOLE module
    : { ns: { fn: fn } };               // browser: a hand-written list
  ```
  `scripts/validate-browserBridges.js` statically asserts that every `_X_DATA.ns.member` referenced in the source is present in the browser branch. A mismatch passes every node test and crashes the game.
- **Module exports.** Every new file ends with:
  ```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { /* ... */ };
  }
  ```
- **Escaping.** Any user-controlled string reaching markup goes through `escapeHtml` (`ui/util.js`). `scripts/validate-uiSafety.js` scans every file in `ui/` and fails with file:line on unescaped interpolation. It auto-discovers files, so new `ui/` files are covered the moment they exist.
- **Dialogue text uses `textContent`, never `innerHTML`.** Scene text interpolates player and team names.
- **Determinism.** Anything random reads `GameState.rng`, never `Math.random`. A save must replay the same lines.
- **Integer scaling only** for pixel art. A fractional scale gives neighbouring pixels different widths and reads as a rendering bug.
- **Test command:** `node scripts/validate-<name>.js`. There is no test framework and no `package.json`. Validators are plain scripts that call `assert` and `console.log('<checkName>: OK')` per check, ending with `console.log('All <thing> validations passed')`. A failing assert exits non-zero.
- **Commit style:** `feat:` / `test:` / `fix:` prefix, lowercase, imperative.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `ui/pixelBust.js` | Draws a shoulders-up pixel portrait with per-emotion brow/mouth. Knows nothing about dialogue. |
| `dialogueScenes.js` | Scene definitions, selection, token interpolation. Pure data, no DOM, no game imports. |
| `dialogueContext.js` | The one module that knows both worlds: builds fact contexts from game state, generates reporters, applies effects back. |
| `ui/dialogueBox.js` | The overlay engine. Knows nothing about basketball. |
| `scripts/validate-pixelBust.js` | Tests for the bust renderer. |
| `scripts/validate-dialogueScenes.js` | Tests for scene selection and interpolation. |
| `scripts/validate-dialogueContext.js` | Tests for contexts, reporters, effects. |

**Modified:**

| File | Change |
|---|---|
| `gameSim.js` | Record period-end scores (enables "blew a lead" scenes). |
| `gmCareer.js` | `reputation` field, default and clamp, band helper. |
| `ui/gmCareerView.js` | Reputation tile in the existing `.kpi-grid`. |
| `ui/pixelAudio.js` | `blip` case in the `playPixelSfx` switch. |
| `ui/settings.js` | Toggle to disable dialogue scenes. |
| `save.js` | Persist `reporters` and `recentDialogueScenes` (the payload is an explicit field list). |
| `ui/simControls.js` | Post-game hook in the two `onFinish` callbacks. |
| `ui/pixelGameView.js` | Halftime hook at the period-change branch. |
| `index.html` | Script tags in dependency order. |
| `style.css` | Dialogue box styles. |
| `scripts/validate-gamesim.js` | Period-score assertions. |
| `scripts/validate-gmCareer.js` | Reputation assertions. |
| `scripts/validate-save.js` | Round-trip assertions for the two new fields. |

---

### Task 1: Period-end scores in the sim

The spec's example scene keys on `leadBlown`, which needs the score at the end of Q3. The sim tracks `homeScore`/`awayScore` but keeps no per-period history, so this fact is currently unrecoverable after a game. Two lines in a branch that already detects the period rollover.

**Files:**
- Modify: `gameSim.js` (sim state object ~line 175-208; period rollover branch ~line 270-275)
- Test: `scripts/validate-gamesim.js`

**Interfaces:**
- Produces: `sim.periodScores` — an array of `{ period, home, away }`, one entry appended as each period ENDS. A finished regulation game has 4 entries. Consumed by Task 5.

- [x] **Step 1: Write the failing test**

Append to `scripts/validate-gamesim.js`, immediately before the final `console.log('All ...')` line:

```js
function checkPeriodScoresAreRecorded() {
  const rng = mulberry32(12345);
  const sim = gamesim.createGameSim('BOS', 'LAL', rng, {});
  while (!sim.done) sim.step();

  assert.ok(Array.isArray(sim.periodScores), 'periodScores is an array');
  assert.ok(sim.periodScores.length >= 4, 'at least four periods ended, got ' + sim.periodScores.length);

  sim.periodScores.forEach(function (row, i) {
    assert.strictEqual(row.period, i + 1, 'periods are recorded in order');
    assert.ok(Number.isFinite(row.home) && Number.isFinite(row.away), 'scores are numbers');
    if (i > 0) {
      assert.ok(row.home >= sim.periodScores[i - 1].home, 'home score never decreases');
      assert.ok(row.away >= sim.periodScores[i - 1].away, 'away score never decreases');
    }
  });

  const last = sim.periodScores[sim.periodScores.length - 1];
  assert.strictEqual(last.home, sim.homeScore, 'final period row matches the final home score');
  assert.strictEqual(last.away, sim.awayScore, 'final period row matches the final away score');
  console.log('checkPeriodScoresAreRecorded: OK');
}
checkPeriodScoresAreRecorded();
```

Check the top of `scripts/validate-gamesim.js` for the exact names it already binds for `gamesim` and its seeded rng helper (`mulberry32` or equivalent) and use those names rather than the ones above if they differ.

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-gamesim.js
```

Expected: FAIL — `AssertionError: periodScores is an array`.

- [x] **Step 3: Add the field to the sim state**

In `gameSim.js`, in the `const sim = { ... }` object literal, immediately after the `takeoverLog: [],` line, add:

```js
    // The score as each period ENDED, one row per completed period. The sim
    // already knows when a period rolls over; without this the score at any
    // moment before the final buzzer is unrecoverable afterwards, which is
    // what a "blew a fourth-quarter lead" reads.
    periodScores: [],
```

- [x] **Step 4: Record the score at the rollover**

In `gameSim.js`, find the existing period-end branch:

```js
    const periodLength = sim.period <= REGULATION_PERIODS ? PERIOD_SECONDS : OVERTIME_SECONDS;
    if (sim.clock >= periodLength) {
      playByPlay.push('--- ' + (sim.period <= REGULATION_PERIODS
        ? 'Q' + sim.period
        : 'OT' + (sim.period - REGULATION_PERIODS)) + ' ---');
    }
```

Add the push inside that same `if`, after the `playByPlay.push(...)` call:

```js
      sim.periodScores.push({ period: sim.period, home: sim.homeScore, away: sim.awayScore });
```

- [x] **Step 5: Run the test to verify it passes**

```bash
node scripts/validate-gamesim.js
```

Expected: PASS, ending with the file's existing "All ... passed" line.

- [x] **Step 6: Run the sim regression validators**

Period scores must not perturb the simulation itself. Run the golden-output validators:

```bash
node scripts/validate-sim.js && node scripts/validate-possession.js && node scripts/validate-gameCoach.js
```

Expected: all PASS. If a golden-output test fails, the push was placed inside a branch that runs more than once per period — re-check it is inside `if (sim.clock >= periodLength)`.

- [x] **Step 7: Commit**

```bash
git add gameSim.js scripts/validate-gamesim.js
git commit -m "feat: record the score at the end of each period"
```

---

### Task 2: GM reputation stat

**Files:**
- Modify: `gmCareer.js` (`createGmCareer` ~line 47, `ensureGmCareer` ~line 59)
- Modify: `ui/gmCareerView.js` (`.kpi-grid`, ~line 81)
- Test: `scripts/validate-gmCareer.js`

**Interfaces:**
- Produces:
  - `career.reputation` — number, 0–100, default 50.
  - `clampReputation(value)` → number clamped to 0–100; non-numeric input returns 50.
  - `reputationBand(value)` → one of `'Stonewalled'` (0–24), `'Divisive'` (25–44), `'Known Quantity'` (45–64), `'Respected'` (65–84), `'Institution'` (85–100).
- Consumed by Task 5 (`applyDialogueEffect` writes it).

- [x] **Step 1: Write the failing test**

Append to `scripts/validate-gmCareer.js`, before its final "All ... passed" line:

```js
function checkReputationDefaultsAndClamps() {
  const career = gmCareer.createGmCareer('Test GM', 'BOS', 2026);
  assert.strictEqual(career.reputation, 50, 'a new career starts neutral');

  assert.strictEqual(gmCareer.clampReputation(150), 100, 'clamps high');
  assert.strictEqual(gmCareer.clampReputation(-20), 0, 'clamps low');
  assert.strictEqual(gmCareer.clampReputation(72), 72, 'passes through in range');
  assert.strictEqual(gmCareer.clampReputation('nonsense'), 50, 'a non-number falls back to neutral');
  assert.strictEqual(gmCareer.clampReputation(undefined), 50, 'undefined falls back to neutral');
  console.log('checkReputationDefaultsAndClamps: OK');
}
checkReputationDefaultsAndClamps();

function checkReputationBackfillsOldSaves() {
  // A save written before this feature existed has a career with no
  // reputation field at all. ensureGmCareer is what save.js runs on load.
  const gameState = { userTeamId: 'BOS', leagueYear: 2029, gmCareer: { name: 'Old GM', tenures: [], seasons: [] } };
  const career = gmCareer.ensureGmCareer(gameState);
  assert.strictEqual(career.reputation, 50, 'an old save backfills to neutral');

  // An existing value is preserved, not reset.
  gameState.gmCareer.reputation = 81;
  assert.strictEqual(gmCareer.ensureGmCareer(gameState).reputation, 81, 'an existing value survives');

  // A corrupt value is repaired rather than propagated.
  gameState.gmCareer.reputation = 'garbage';
  assert.strictEqual(gmCareer.ensureGmCareer(gameState).reputation, 50, 'a corrupt value is repaired');
  console.log('checkReputationBackfillsOldSaves: OK');
}
checkReputationBackfillsOldSaves();

function checkReputationBands() {
  assert.strictEqual(gmCareer.reputationBand(0), 'Stonewalled');
  assert.strictEqual(gmCareer.reputationBand(24), 'Stonewalled');
  assert.strictEqual(gmCareer.reputationBand(25), 'Divisive');
  assert.strictEqual(gmCareer.reputationBand(50), 'Known Quantity');
  assert.strictEqual(gmCareer.reputationBand(70), 'Respected');
  assert.strictEqual(gmCareer.reputationBand(100), 'Institution');
  // Every value in range must produce a band — no gaps between the boundaries.
  for (let v = 0; v <= 100; v++) {
    assert.ok(typeof gmCareer.reputationBand(v) === 'string' && gmCareer.reputationBand(v).length > 0,
      'no band for ' + v);
  }
  console.log('checkReputationBands: OK');
}
checkReputationBands();
```

Check the top of `scripts/validate-gmCareer.js` for the name it binds the module to and use that if it is not `gmCareer`.

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-gmCareer.js
```

Expected: FAIL — `AssertionError: a new career starts neutral` (or `TypeError: gmCareer.clampReputation is not a function`).

- [x] **Step 3: Implement in `gmCareer.js`**

Add these two functions above `createGmCareer`:

```js
// Reputation is written only by dialogue scenes and read only by the career
// view. It is deliberately NOT consumed by the simulation: it is a record of
// how the press has been handled, not a rating that moves free agency.
const REPUTATION_DEFAULT = 50;

function clampReputation(value) {
  if (typeof value !== 'number' || !isFinite(value)) return REPUTATION_DEFAULT;
  return Math.max(0, Math.min(100, value));
}

// Banded rather than bare so a 3-point swing reads as something, and so the
// number is not mistaken for a rating the engine consumes.
function reputationBand(value) {
  const v = clampReputation(value);
  if (v < 25) return 'Stonewalled';
  if (v < 45) return 'Divisive';
  if (v < 65) return 'Known Quantity';
  if (v < 85) return 'Respected';
  return 'Institution';
}
```

In `createGmCareer`, add `reputation: REPUTATION_DEFAULT,` to the returned object.

In `ensureGmCareer`, add this line alongside the existing normalizer guards (next to `if (!c.name) c.name = 'GM';`):

```js
  c.reputation = clampReputation(c.reputation);
```

`clampReputation` returns the default for `undefined`, so this one line both backfills old saves and repairs corrupt values. `save.js` serializes `gmCareer` wholesale and runs `ensureGmCareer` on load, so no migration code is needed.

Add all three names to the module's `module.exports` block:

```js
    clampReputation: clampReputation,
    reputationBand: reputationBand,
    REPUTATION_DEFAULT: REPUTATION_DEFAULT,
```

- [x] **Step 4: Run the test to verify it passes**

```bash
node scripts/validate-gmCareer.js
```

Expected: PASS.

- [x] **Step 5: Add the career view tile**

In `ui/gmCareerView.js`, inside the `.kpi-grid` string, after the "Playoff Trips" tile, add:

```js
      '<div class="kpi-tile"><div class="kpi-label">Reputation</div>' +
        '<div class="kpi-value">' + escapeHtml(reputationBand(career.reputation)) + '</div>' +
        '<div class="kpi-sub">' + Math.round(career.reputation) + ' / 100</div></div>' +
```

The variable holding the career object in `renderGmCareer` may be named something other than `career` — read the function and use the name already in scope. If only `totals` is in scope, call `ensureGmCareer(GameState)` at the top of the function to obtain it.

- [x] **Step 6: Run the UI safety and bridge validators**

```bash
node scripts/validate-uiSafety.js && node scripts/validate-browserBridges.js && node scripts/validate-save.js
```

Expected: all PASS. `validate-save.js` confirms a round-tripped save keeps the field.

- [x] **Step 7: Commit**

```bash
git add gmCareer.js ui/gmCareerView.js scripts/validate-gmCareer.js
git commit -m "feat: GM reputation, written by dialogue and shown on the career view"
```

---

### Task 3: Pixel bust renderer

**Files:**
- Create: `ui/pixelBust.js`
- Create: `scripts/validate-pixelBust.js`

**Interfaces:**
- Consumes: `spriteColorsForPlayer(player, team, isHome)` and `safeSpriteColor(value, fallback)` from `ui/pixelSprites.js`; `SPRITE_CARD_NO_TEAM` for the no-team fallback.
- Produces:
  - `BUST` = `{ w: 32, h: 40 }`
  - `BUST_EMOTIONS` = `['neutral', 'confident', 'angry', 'shaken']`
  - `BROW` / `MOUTH` — objects keyed by emotion, each value an array of `[x, y, w, h]` rects
  - `bustScale(sizePx)` → integer ≥ 1
  - `drawPixelBust(ctx, colors, emotion, opts)` — draws at scale `opts.scale` (default 1); unknown emotion falls back to `'neutral'`
  - `bustColorsFor(player, team)` → `{ skin, hair, jersey, trim }`

- [x] **Step 1: Write the failing test**

Create `scripts/validate-pixelBust.js`:

```js
const assert = require('assert');
const path = require('path');
const bust = require(path.join(__dirname, '..', 'ui', 'pixelBust.js'));

// A recording stand-in for CanvasRenderingContext2D. The bust renderer only
// ever sets fillStyle and calls fillRect, so this captures the whole drawing.
function fakeCtx() {
  const calls = [];
  return {
    calls: calls,
    fillStyle: '#000000',
    set _fs(v) { this.fillStyle = v; },
    fillRect: function (x, y, w, h) {
      calls.push({ x: x, y: y, w: w, h: h, color: this.fillStyle });
    }
  };
}

function checkEveryEmotionHasBrowAndMouth() {
  // A scene naming an emotion with no entry would silently render a blank
  // face — the failure mode this check exists to make impossible.
  bust.BUST_EMOTIONS.forEach(function (e) {
    assert.ok(Array.isArray(bust.BROW[e]), 'no brow for ' + e);
    assert.ok(Array.isArray(bust.MOUTH[e]), 'no mouth for ' + e);
    assert.ok(bust.BROW[e].length > 0, 'empty brow for ' + e);
    assert.ok(bust.MOUTH[e].length > 0, 'empty mouth for ' + e);
  });
  // And no stray keys that BUST_EMOTIONS does not list.
  assert.deepStrictEqual(Object.keys(bust.BROW).sort(), bust.BUST_EMOTIONS.slice().sort(),
    'BROW keys match BUST_EMOTIONS exactly');
  assert.deepStrictEqual(Object.keys(bust.MOUTH).sort(), bust.BUST_EMOTIONS.slice().sort(),
    'MOUTH keys match BUST_EMOTIONS exactly');
  console.log('checkEveryEmotionHasBrowAndMouth: OK');
}
checkEveryEmotionHasBrowAndMouth();

function checkFeatureRectsStayInsideTheGrid() {
  [bust.BROW, bust.MOUTH].forEach(function (table) {
    Object.keys(table).forEach(function (emotion) {
      table[emotion].forEach(function (r) {
        assert.strictEqual(r.length, 4, emotion + ' rect is [x,y,w,h]');
        assert.ok(r[0] >= 0 && r[0] + r[2] <= bust.BUST.w, emotion + ' rect overflows width: ' + r);
        assert.ok(r[1] >= 0 && r[1] + r[3] <= bust.BUST.h, emotion + ' rect overflows height: ' + r);
        assert.ok(r[2] > 0 && r[3] > 0, emotion + ' rect has no area: ' + r);
      });
    });
  });
  console.log('checkFeatureRectsStayInsideTheGrid: OK');
}
checkFeatureRectsStayInsideTheGrid();

function checkScaleIsAlwaysAWholeNumber() {
  // Fractional scaling gives some pixels two screen pixels and their
  // neighbours three, which reads as a rendering bug at this size.
  [0, 1, 39, 40, 41, 80, 120, 121, 500].forEach(function (px) {
    const s = bust.bustScale(px);
    assert.strictEqual(s, Math.floor(s), px + 'px gave a fractional scale ' + s);
    assert.ok(s >= 1, px + 'px gave a scale below 1');
  });
  assert.strictEqual(bust.bustScale(120), 3, '120px tall fits three logical pixels per screen pixel');
  assert.strictEqual(bust.bustScale(40), 1, 'exactly one bust height is scale 1');
  console.log('checkScaleIsAlwaysAWholeNumber: OK');
}
checkScaleIsAlwaysAWholeNumber();

function checkEmotionChangesOnlyTheBrowAndMouth() {
  const colors = { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' };
  const drawn = {};
  bust.BUST_EMOTIONS.forEach(function (e) {
    const ctx = fakeCtx();
    bust.drawPixelBust(ctx, colors, e, { scale: 1 });
    drawn[e] = ctx.calls;
  });

  // Identity rects — the ones drawn in skin, hair, jersey and trim — must be
  // byte-identical across emotions. Only the dark feature rects may differ.
  function identityOf(calls) {
    return JSON.stringify(calls.filter(function (c) {
      return c.color === colors.skin || c.color === colors.hair ||
             c.color === colors.jersey || c.color === colors.trim;
    }));
  }
  const base = identityOf(drawn.neutral);
  bust.BUST_EMOTIONS.forEach(function (e) {
    assert.strictEqual(identityOf(drawn[e]), base, e + ' changed the identity, not just the expression');
  });

  // And the expressions must actually differ from each other, or the swap is
  // decorative and the whole mechanism is pointless.
  const angry = JSON.stringify(drawn.angry);
  const neutral = JSON.stringify(drawn.neutral);
  assert.notStrictEqual(angry, neutral, 'angry and neutral render identically');
  console.log('checkEmotionChangesOnlyTheBrowAndMouth: OK');
}
checkEmotionChangesOnlyTheBrowAndMouth();

function checkUnknownEmotionFallsBackRatherThanThrowing() {
  const colors = { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' };
  const ctx = fakeCtx();
  bust.drawPixelBust(ctx, colors, 'ecstatic', { scale: 1 });
  const neutralCtx = fakeCtx();
  bust.drawPixelBust(neutralCtx, colors, 'neutral', { scale: 1 });
  assert.deepStrictEqual(ctx.calls, neutralCtx.calls, 'an unknown emotion renders as neutral');
  console.log('checkUnknownEmotionFallsBackRatherThanThrowing: OK');
}
checkUnknownEmotionFallsBackRatherThanThrowing();

function checkScaleMultipliesEveryRect() {
  const colors = { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' };
  const one = fakeCtx();
  const three = fakeCtx();
  bust.drawPixelBust(one, colors, 'neutral', { scale: 1 });
  bust.drawPixelBust(three, colors, 'neutral', { scale: 3 });
  assert.strictEqual(one.calls.length, three.calls.length, 'same rects at any scale');
  one.calls.forEach(function (c, i) {
    const t = three.calls[i];
    assert.strictEqual(t.x, c.x * 3, 'x scaled');
    assert.strictEqual(t.y, c.y * 3, 'y scaled');
    assert.strictEqual(t.w, c.w * 3, 'w scaled');
    assert.strictEqual(t.h, c.h * 3, 'h scaled');
  });
  console.log('checkScaleMultipliesEveryRect: OK');
}
checkScaleMultipliesEveryRect();

function checkColorsComeFromTheSpriteSystem() {
  // A bust and that player's table sprite must never disagree about who he is.
  const player = { face: { body: { color: '#bb876f' }, hair: { color: '#272421' } }, jerseyNumber: 7 };
  const team = { id: 'BOS', colors: { primary: '#007A33', secondary: '#BA9653' } };
  const c = bust.bustColorsFor(player, team);
  assert.strictEqual(c.skin, '#bb876f');
  assert.strictEqual(c.hair, '#272421');
  assert.strictEqual(c.jersey, '#007A33');

  // A reporter has no team at all.
  const noTeam = bust.bustColorsFor({ face: { body: { color: '#8d5524' }, hair: { color: '#111111' } } }, null);
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(noTeam.jersey), 'a teamless speaker still gets a jersey colour');
  assert.strictEqual(noTeam.skin, '#8d5524', 'a teamless speaker keeps his own skin');

  // And a player with no generated face at all must not produce undefined.
  const bare = bust.bustColorsFor({}, null);
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(bare.skin), 'fallback skin is a colour');
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(bare.hair), 'fallback hair is a colour');
  console.log('checkColorsComeFromTheSpriteSystem: OK');
}
checkColorsComeFromTheSpriteSystem();

console.log('All pixel bust validations passed');
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-pixelBust.js
```

Expected: FAIL — `Cannot find module '.../ui/pixelBust.js'`.

- [x] **Step 3: Write the implementation**

Create `ui/pixelBust.js`:

```js
// Shoulders-up pixel portraits for the dialogue box.
//
// Separate from ui/pixelSprites.js because that file draws 14x32 full-body
// court figures whose head is a featureless 4x5 block — legible at table size
// and meaningless at portrait size. This draws a face.
//
// It deliberately does NOT join startPlayerSpriteAutoPaint. That observer is
// idempotent and skips an already-painted canvas, which is exactly wrong for a
// portrait that has to repaint every time the emotion changes. The dialogue
// engine owns its canvas and repaints it directly.

var _BUST_DATA = (typeof require !== 'undefined')
  ? { sprites: require('./pixelSprites.js') }
  : { sprites: {
        spriteColorsForPlayer: spriteColorsForPlayer,
        safeSpriteColor: safeSpriteColor,
        SPRITE_CARD_NO_TEAM: SPRITE_CARD_NO_TEAM
      } };

// The logical grid. Everything below is expressed in these units and
// multiplied by an integer scale at draw time.
const BUST = { w: 32, h: 40 };

const BUST_EMOTIONS = ['neutral', 'confident', 'angry', 'shaken'];

const BUST_FALLBACK_SKIN = '#bb876f';
const BUST_FALLBACK_HAIR = '#272421';
const BUST_FEATURE = '#1b1a19';   // eyes, brows, mouth — near-black, not pure
const BUST_SHADOW = 'rgba(0,0,0,0.18)';

// Identity: drawn the same way for every emotion. Order is back-to-front.
const HEAD_RECTS = [
  ['jersey',  [5, 34, 22, 6]],
  ['trim',    [5, 34, 22, 1]],
  ['skin',    [13, 29, 6, 6]],    // neck
  ['skin',    [8, 6, 16, 24]],    // head
  ['shadow',  [8, 27, 16, 3]],    // jaw shading, so the chin reads
  ['hair',    [7, 4, 18, 6]],     // fringe
  ['hair',    [7, 4, 2, 11]],     // left sideburn
  ['hair',    [23, 4, 2, 11]]     // right sideburn
];

const EYE_RECTS = [[11, 17, 3, 3], [18, 17, 3, 3]];
const NOSE_RECT = [15, 21, 2, 3];

// Brows and mouths are the ONLY things emotion changes. Each entry is a list
// of [x, y, w, h] rects on the same grid.
const BROW = {
  // flat, level
  neutral:   [[11, 14, 3, 1], [18, 14, 3, 1]],
  // both lifted a pixel
  confident: [[11, 13, 3, 1], [18, 13, 3, 1]],
  // inner ends driven DOWN toward the nose — the angry V
  angry:     [[11, 13, 2, 1], [13, 15, 2, 1], [17, 15, 2, 1], [19, 13, 2, 1]],
  // inner ends lifted — the worried inverted V
  shaken:    [[11, 15, 2, 1], [13, 13, 2, 1], [17, 13, 2, 1], [19, 15, 2, 1]]
};

const MOUTH = {
  neutral:   [[14, 25, 4, 1]],
  confident: [[14, 25, 4, 1], [13, 24, 1, 1], [18, 24, 1, 1]],   // corners up
  angry:     [[14, 24, 4, 1], [13, 25, 1, 1], [18, 25, 1, 1]],   // corners down
  shaken:    [[15, 24, 2, 3]]                                     // small open O
};

// Sized on HEIGHT, and floored to a whole number. See pixelSprites.js's
// spriteCardScale for why fractional scaling is not an option here.
function bustScale(sizePx) {
  return Math.max(1, Math.floor((sizePx || BUST.h) / BUST.h));
}

// Colours come from the sprite system so a bust and that player's table
// sprite can never disagree about who he is.
function bustColorsFor(player, team) {
  const s = _BUST_DATA.sprites;
  const c = s.spriteColorsForPlayer(player || {}, team || s.SPRITE_CARD_NO_TEAM, true);
  return {
    skin: s.safeSpriteColor(c.skin, BUST_FALLBACK_SKIN),
    hair: s.safeSpriteColor(c.hair, BUST_FALLBACK_HAIR),
    jersey: s.safeSpriteColor(c.jersey, '#5b6673'),
    trim: s.safeSpriteColor(c.trim, '#c9d1d9')
  };
}

function drawPixelBust(ctx, colors, emotion, opts) {
  opts = opts || {};
  const s = opts.scale || 1;
  const ox = opts.x || 0;
  const oy = opts.y || 0;
  const e = BROW[emotion] ? emotion : 'neutral';

  function rect(color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + r[0] * s, oy + r[1] * s, r[2] * s, r[3] * s);
  }

  const palette = {
    skin: colors.skin, hair: colors.hair, jersey: colors.jersey,
    trim: colors.trim, shadow: BUST_SHADOW
  };
  HEAD_RECTS.forEach(function (pair) { rect(palette[pair[0]], pair[1]); });
  EYE_RECTS.forEach(function (r) { rect(BUST_FEATURE, r); });
  rect(BUST_SHADOW, NOSE_RECT);
  BROW[e].forEach(function (r) { rect(BUST_FEATURE, r); });
  MOUTH[e].forEach(function (r) { rect(BUST_FEATURE, r); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUST: BUST,
    BUST_EMOTIONS: BUST_EMOTIONS,
    BROW: BROW,
    MOUTH: MOUTH,
    bustScale: bustScale,
    bustColorsFor: bustColorsFor,
    drawPixelBust: drawPixelBust
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
node scripts/validate-pixelBust.js
```

Expected: PASS, ending with `All pixel bust validations passed`.

If `checkEmotionChangesOnlyTheBrowAndMouth` fails, an identity rect is being drawn in `BUST_FEATURE` or `BUST_SHADOW` and therefore is not counted as identity — that is the test working correctly; move the rect into the right colour bucket rather than weakening the assertion.

- [x] **Step 5: Commit**

```bash
git add ui/pixelBust.js scripts/validate-pixelBust.js
git commit -m "feat: pixel bust portraits with per-emotion brow and mouth"
```

---

### Task 4: Scene data and selection

**Files:**
- Create: `dialogueScenes.js`
- Create: `scripts/validate-dialogueScenes.js`

**Interfaces:**
- Consumes: nothing. This module is pure — no DOM, no game imports, no `_X_DATA` bridge (it has no dependencies to bridge).
- Produces:
  - `SCENES` — array of scene objects
  - `tokensIn(text)` → array of token names found in `{braces}`
  - `interpolate(text, ctx)` → string with `{token}` replaced by `ctx[token]`; an unknown token is left verbatim
  - `selectScene(ctx, opts)` → a scene object, never null. `opts` = `{ scenes, recent, rand, fallbackLines }`
  - `FALLBACK_SCENE_ID` = `'generic-media'`
- Consumed by Task 5 and Tasks 9/10.

Scene object shape:
```js
{ id, moment: 'postgame'|'halftime', roles: ['gm'|'player'], priority: number,
  when: (ctx) => boolean, speaker: { kind }, lines: [{ emotion, text }],
  choices: [{ text, emotion, effect: (ctx) => object | null }] }
```

- [x] **Step 1: Write the failing test**

Create `scripts/validate-dialogueScenes.js`:

```js
const assert = require('assert');
const path = require('path');
const scenes = require(path.join(__dirname, '..', 'dialogueScenes.js'));
const bust = require(path.join(__dirname, '..', 'ui', 'pixelBust.js'));

// Every key a scene predicate or line is allowed to read, per moment. A scene
// referencing anything outside this list would interpolate "undefined" into
// the user's face at runtime.
const POSTGAME_KEYS = [
  'moment', 'role', 'userWon', 'userLost', 'margin', 'teamName', 'opponentName',
  'leadBlown', 'topScorerName', 'topScorerPoints', 'userScore', 'opponentScore',
  'isPlayoff', 'streak', 'seasonWins', 'seasonLosses'
];
const HALFTIME_KEYS = [
  'moment', 'role', 'margin', 'teamName', 'opponentName', 'trailing', 'leading',
  'topScorerName', 'topScorerPoints', 'userScore', 'opponentScore', 'isPlayoff'
];

function keysFor(moment) {
  return moment === 'halftime' ? HALFTIME_KEYS : POSTGAME_KEYS;
}

function checkEverySceneIsWellFormed() {
  assert.ok(scenes.SCENES.length > 0, 'there is at least one scene');
  const seen = {};
  scenes.SCENES.forEach(function (s) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, 'scene has an id');
    assert.ok(!seen[s.id], 'duplicate scene id: ' + s.id);
    seen[s.id] = true;
    assert.ok(s.moment === 'postgame' || s.moment === 'halftime', s.id + ' has a valid moment');
    assert.ok(Array.isArray(s.roles) && s.roles.length > 0, s.id + ' has roles');
    s.roles.forEach(function (r) {
      assert.ok(r === 'gm' || r === 'player', s.id + ' has an unknown role: ' + r);
    });
    assert.strictEqual(typeof s.priority, 'number', s.id + ' has a numeric priority');
    assert.strictEqual(typeof s.when, 'function', s.id + ' has a predicate');
    assert.ok(Array.isArray(s.lines) && s.lines.length > 0, s.id + ' has lines');
    assert.ok(Array.isArray(s.choices) && s.choices.length > 0, s.id + ' has at least one choice');
  });
  console.log('checkEverySceneIsWellFormed: OK');
}
checkEverySceneIsWellFormed();

function checkEveryEmotionNamedIsDrawable() {
  scenes.SCENES.forEach(function (s) {
    s.lines.forEach(function (l) {
      assert.ok(bust.BUST_EMOTIONS.indexOf(l.emotion) !== -1,
        s.id + ' line names an undrawable emotion: ' + l.emotion);
    });
    s.choices.forEach(function (c) {
      assert.ok(bust.BUST_EMOTIONS.indexOf(c.emotion) !== -1,
        s.id + ' choice names an undrawable emotion: ' + c.emotion);
    });
  });
  console.log('checkEveryEmotionNamedIsDrawable: OK');
}
checkEveryEmotionNamedIsDrawable();

function checkEveryTokenResolves() {
  scenes.SCENES.forEach(function (s) {
    const allowed = keysFor(s.moment);
    s.lines.forEach(function (l) {
      scenes.tokensIn(l.text).forEach(function (t) {
        assert.ok(allowed.indexOf(t) !== -1,
          s.id + ' uses {' + t + '}, which no ' + s.moment + ' context provides');
      });
    });
    s.choices.forEach(function (c) {
      scenes.tokensIn(c.text).forEach(function (t) {
        assert.ok(allowed.indexOf(t) !== -1,
          s.id + ' choice uses {' + t + '}, which no ' + s.moment + ' context provides');
      });
    });
  });
  console.log('checkEveryTokenResolves: OK');
}
checkEveryTokenResolves();

function checkInterpolation() {
  assert.strictEqual(scenes.interpolate('Lost by {margin}.', { margin: 9 }), 'Lost by 9.');
  assert.strictEqual(scenes.interpolate('{a} and {b}', { a: 'x', b: 'y' }), 'x and y');
  assert.strictEqual(scenes.interpolate('no tokens', {}), 'no tokens');
  // An unknown token is left verbatim rather than printing "undefined" — a
  // visible {brace} in the game is a bug report; "undefined" is a shrug.
  assert.strictEqual(scenes.interpolate('{nope}', {}), '{nope}');
  // A value that is itself brace-shaped must not be re-scanned.
  assert.strictEqual(scenes.interpolate('{a}', { a: '{b}', b: 'no' }), '{b}');
  assert.deepStrictEqual(scenes.tokensIn('{a} {b} {a}'), ['a', 'b'], 'tokens are deduped');
  console.log('checkInterpolation: OK');
}
checkInterpolation();

function checkHighestPriorityWins() {
  const ctx = { moment: 'postgame', role: 'gm' };
  const pool = [
    { id: 'low',  moment: 'postgame', roles: ['gm'], priority: 10, when: function () { return true; }, lines: [], choices: [{}] },
    { id: 'high', moment: 'postgame', roles: ['gm'], priority: 90, when: function () { return true; }, lines: [], choices: [{}] }
  ];
  assert.strictEqual(scenes.selectScene(ctx, { scenes: pool, rand: function () { return 0; } }).id, 'high');
  console.log('checkHighestPriorityWins: OK');
}
checkHighestPriorityWins();

function checkFiltersByMomentAndRole() {
  const pool = [
    { id: 'wrong-moment', moment: 'halftime', roles: ['gm'],     priority: 99, when: function () { return true; }, lines: [], choices: [{}] },
    { id: 'wrong-role',   moment: 'postgame', roles: ['player'], priority: 99, when: function () { return true; }, lines: [], choices: [{}] },
    { id: 'right',        moment: 'postgame', roles: ['gm'],     priority: 1,  when: function () { return true; }, lines: [], choices: [{}] }
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' }, { scenes: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'right', 'moment and role filter before priority');
  console.log('checkFiltersByMomentAndRole: OK');
}
checkFiltersByMomentAndRole();

function checkRecentScenesAreSkipped() {
  const pool = [
    { id: 'just-fired', moment: 'postgame', roles: ['gm'], priority: 90, when: function () { return true; }, lines: [], choices: [{}] },
    { id: 'next-up',    moment: 'postgame', roles: ['gm'], priority: 10, when: function () { return true; }, lines: [], choices: [{}] }
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' },
    { scenes: pool, recent: ['just-fired'], rand: function () { return 0; } });
  assert.strictEqual(got.id, 'next-up', 'a recently fired scene is passed over');
  console.log('checkRecentScenesAreSkipped: OK');
}
checkRecentScenesAreSkipped();

function checkAThrowingPredicateIsDroppedNotFatal() {
  // One bad predicate must not cost the user their post-game.
  const pool = [
    { id: 'broken', moment: 'postgame', roles: ['gm'], priority: 99,
      when: function () { throw new Error('boom'); }, lines: [], choices: [{}] },
    { id: 'fine',   moment: 'postgame', roles: ['gm'], priority: 1,
      when: function () { return true; }, lines: [], choices: [{}] }
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' }, { scenes: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'fine', 'the throwing scene was skipped, not propagated');
  console.log('checkAThrowingPredicateIsDroppedNotFatal: OK');
}
checkAThrowingPredicateIsDroppedNotFatal();

function checkFallbackWhenNothingMatches() {
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' }, {
    scenes: [],
    rand: function () { return 0; },
    fallbackLines: ['How are you feeling about your performance?']
  });
  assert.strictEqual(got.id, scenes.FALLBACK_SCENE_ID, 'the fallback fired');
  assert.ok(got.lines.length > 0, 'the fallback has a line');
  assert.strictEqual(got.lines[0].text, 'How are you feeling about your performance?');
  assert.ok(got.choices.length > 0, 'the fallback has choices');
  got.choices.forEach(function (c) {
    assert.strictEqual(c.effect, null, 'fallback choices are pure flavour');
  });
  console.log('checkFallbackWhenNothingMatches: OK');
}
checkFallbackWhenNothingMatches();

function checkSelectionIsDeterministicForAGivenRand() {
  // Ties break on the injected rng, so the same save replays the same line.
  const pool = [
    { id: 'a', moment: 'postgame', roles: ['gm'], priority: 50, when: function () { return true; }, lines: [], choices: [{}] },
    { id: 'b', moment: 'postgame', roles: ['gm'], priority: 50, when: function () { return true; }, lines: [], choices: [{}] }
  ];
  const ctx = { moment: 'postgame', role: 'gm' };
  assert.strictEqual(scenes.selectScene(ctx, { scenes: pool, rand: function () { return 0; } }).id, 'a');
  assert.strictEqual(scenes.selectScene(ctx, { scenes: pool, rand: function () { return 0.99; } }).id, 'b');
  console.log('checkSelectionIsDeterministicForAGivenRand: OK');
}
checkSelectionIsDeterministicForAGivenRand();

function checkRealScenesFireOnRealContexts() {
  // The shipped library must actually match something plausible, or the
  // fallback is all anyone will ever see.
  const blownLead = {
    moment: 'postgame', role: 'gm', userWon: false, userLost: true, margin: 6,
    teamName: 'Harbormen', opponentName: 'Monarchs', leadBlown: 11,
    topScorerName: 'J. Tatum', topScorerPoints: 31, userScore: 104, opponentScore: 110,
    isPlayoff: false, streak: -2, seasonWins: 20, seasonLosses: 15
  };
  const got = scenes.selectScene(blownLead, { rand: function () { return 0; } });
  assert.notStrictEqual(got.id, scenes.FALLBACK_SCENE_ID,
    'a blown 11-point lead should match a real scene, not the fallback');
  console.log('checkRealScenesFireOnRealContexts: OK');
}
checkRealScenesFireOnRealContexts();

function checkEffectsAreReturnedNotApplied() {
  // A choice must not touch game state. It returns a description; a single
  // applier in dialogueContext.js interprets it. This is what makes scenes
  // testable with no game at all.
  scenes.SCENES.forEach(function (s) {
    s.choices.forEach(function (c) {
      assert.ok(c.effect === null || typeof c.effect === 'function',
        s.id + ': effect is null or a function');
      if (typeof c.effect === 'function') {
        const ctx = {
          moment: s.moment, role: s.roles[0], teamName: 'Harbormen', opponentName: 'Monarchs',
          margin: 6, leadBlown: 11, topScorerName: 'J. Tatum', topScorerPoints: 31,
          userWon: false, userLost: true, userScore: 104, opponentScore: 110,
          trailing: true, leading: false, isPlayoff: false, streak: -2,
          seasonWins: 20, seasonLosses: 15
        };
        const out = c.effect(ctx);
        assert.ok(out && typeof out === 'object', s.id + ': an effect returns an object');
        Object.keys(out).forEach(function (k) {
          assert.ok(['teamMorale', 'playerMorale', 'reputation', 'chronicle', 'recordDecision'].indexOf(k) !== -1,
            s.id + ': unknown effect channel "' + k + '"');
        });
        if (typeof out.teamMorale === 'number') {
          assert.ok(Math.abs(out.teamMorale) <= 3,
            s.id + ': a morale swing above 3 outweighs several games of results');
        }
        if (typeof out.reputation === 'number') {
          assert.ok(Math.abs(out.reputation) <= 5, s.id + ': reputation swing is too large');
        }
      }
    });
  });
  console.log('checkEffectsAreReturnedNotApplied: OK');
}
checkEffectsAreReturnedNotApplied();

function checkAtLeastOneFlavourChoiceExists() {
  // Mixed stakes was an explicit design decision: some replies change nothing.
  const hasFlavour = scenes.SCENES.some(function (s) {
    return s.choices.some(function (c) { return c.effect === null; });
  });
  assert.ok(hasFlavour, 'no scene offers a pure-flavour reply');
  console.log('checkAtLeastOneFlavourChoiceExists: OK');
}
checkAtLeastOneFlavourChoiceExists();

console.log('All dialogue scene validations passed');
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-dialogueScenes.js
```

Expected: FAIL — `Cannot find module '.../dialogueScenes.js'`.

- [x] **Step 3: Write the implementation**

Create `dialogueScenes.js`:

```js
// Dialogue scene definitions and selection.
//
// Deliberately PURE: no DOM, no game imports, no _X_DATA bridge. A scene's
// `when` reads a flat fact object and a choice's `effect` RETURNS a
// description of a change rather than applying one. That is what lets the
// whole library be tested in node with no game state, and it is why
// dialogueContext.js exists as the single place that knows both worlds.

const FALLBACK_SCENE_ID = 'generic-media';

// Used only when the caller supplies none. dialogueContext.js passes the
// media_standard pool from narrativeSystem.js.
const DEFAULT_FALLBACK_LINES = [
  'How are you feeling about your performance?',
  "What's your take on the team's direction?",
  'Any message for the fans tonight?'
];

const TOKEN_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function tokensIn(text) {
  const out = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text))) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
}

// A missing token is left verbatim rather than printed as "undefined": a
// visible {brace} in the game gets reported as a bug, and "undefined" gets
// shrugged at. Single-pass, so a value that is itself brace-shaped is not
// re-scanned.
function interpolate(text, ctx) {
  return String(text).replace(new RegExp(TOKEN_RE.source, 'g'), function (whole, key) {
    const v = ctx ? ctx[key] : undefined;
    return (v === undefined || v === null) ? whole : String(v);
  });
}

function buildFallbackScene(ctx, rand, fallbackLines) {
  const pool = (fallbackLines && fallbackLines.length) ? fallbackLines : DEFAULT_FALLBACK_LINES;
  const line = pool[Math.floor(rand() * pool.length)];
  return {
    id: FALLBACK_SCENE_ID,
    moment: ctx.moment,
    roles: [ctx.role],
    priority: -1,
    when: function () { return true; },
    speaker: { kind: 'reporter' },
    lines: [{ emotion: 'neutral', text: line }],
    // Nothing interesting happened, so nothing is at stake. Every reply here
    // is flavour by construction.
    choices: [
      { text: 'Give the honest answer.', emotion: 'neutral', effect: null },
      { text: 'Keep it short.', emotion: 'neutral', effect: null }
    ]
  };
}

function selectScene(ctx, opts) {
  opts = opts || {};
  const pool = opts.scenes || SCENES;
  const recent = opts.recent || [];
  const rand = opts.rand || Math.random;

  const eligible = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (s.moment !== ctx.moment) continue;
    if (s.roles.indexOf(ctx.role) === -1) continue;
    if (recent.indexOf(s.id) !== -1) continue;
    let ok = false;
    try {
      ok = !!s.when(ctx);
    } catch (err) {
      // One bad predicate must not cost the user their post-game.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('dialogue scene "' + s.id + '" predicate threw: ' + err.message);
      }
      continue;
    }
    if (ok) eligible.push(s);
  }

  if (eligible.length === 0) return buildFallbackScene(ctx, rand, opts.fallbackLines);

  let top = eligible[0].priority;
  for (let i = 1; i < eligible.length; i++) {
    if (eligible[i].priority > top) top = eligible[i].priority;
  }
  const tied = eligible.filter(function (s) { return s.priority === top; });
  return tied[Math.floor(rand() * tied.length)];
}

const SCENES = [
  {
    id: 'blown-fourth-lead',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 70,
    when: function (c) { return c.userLost && c.leadBlown >= 8; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'Up {leadBlown} going into the fourth.' },
      { emotion: 'angry', text: 'You lose by {margin}. What happened to the {teamName} in those twelve minutes?' }
    ],
    choices: [
      { text: 'That one is on me.', emotion: 'shaken',
        effect: function (c) { return { teamMorale: 1.5, reputation: 1, chronicle: 'Took the blame for a blown lead against the ' + c.opponentName + '.' }; } },
      { text: 'Ask the guys who stopped competing.', emotion: 'angry',
        effect: function (c) { return { teamMorale: -2.5, reputation: -2, chronicle: 'Called out the roster in the press after losing to the ' + c.opponentName + '.' }; } },
      { text: "It's a long season.", emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'star-carried-a-loss',
    moment: 'postgame',
    roles: ['gm'],
    priority: 55,
    when: function (c) { return c.userLost && c.topScorerPoints >= 35; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: '{topScorerName} goes for {topScorerPoints} and you still lose by {margin}.' },
      { emotion: 'neutral', text: 'How long can one man carry this roster?' }
    ],
    choices: [
      { text: 'He deserves better. We will get him help.', emotion: 'confident',
        effect: function () { return { teamMorale: 1, reputation: 1 }; } },
      { text: 'Basketball is a five-man game. Ask the other four.', emotion: 'angry',
        effect: function () { return { teamMorale: -2, reputation: -1 }; } },
      { text: 'We are evaluating everything.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'statement-win',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 50,
    when: function (c) { return c.userWon && c.margin >= 20; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'confident', text: 'Twenty-plus over the {opponentName}. That is the most complete game you have played.' }
    ],
    choices: [
      { text: 'The group has been building to this.', emotion: 'confident',
        effect: function () { return { teamMorale: 1.5, reputation: 1 }; } },
      { text: 'One game. We have not done anything yet.', emotion: 'neutral',
        effect: function () { return { reputation: 1 }; } },
      { text: 'We are the best team in this league.', emotion: 'confident',
        effect: function (c) { return { teamMorale: 1, reputation: -1, chronicle: 'Declared the ' + c.teamName + ' the best team in the league after a ' + c.margin + '-point win.' }; } }
    ]
  },
  {
    id: 'halftime-trailing-badly',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 60,
    when: function (c) { return c.trailing && c.margin >= 12; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'angry', text: 'Down {margin} at the half to the {opponentName}.' },
      { emotion: 'angry', text: 'I need to know what you want me to do with this second half.' }
    ],
    choices: [
      { text: 'Ride the starters. Win it now.', emotion: 'confident',
        effect: function () { return { teamMorale: -0.5 }; } },
      { text: 'Get the young guys minutes.', emotion: 'neutral',
        effect: function () { return { teamMorale: 1 }; } },
      { text: 'You are the coach. Coach.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'halftime-close-game',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 30,
    when: function (c) { return c.margin <= 4; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'neutral', text: 'Dead even with the {opponentName}. This is going to come down to the last four minutes.' }
    ],
    choices: [
      { text: 'Keep the rotation tight.', emotion: 'confident',
        effect: function () { return { teamMorale: 0.5 }; } },
      { text: 'Trust the group.', emotion: 'neutral', effect: null }
    ]
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCENES: SCENES,
    FALLBACK_SCENE_ID: FALLBACK_SCENE_ID,
    DEFAULT_FALLBACK_LINES: DEFAULT_FALLBACK_LINES,
    tokensIn: tokensIn,
    interpolate: interpolate,
    selectScene: selectScene
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
node scripts/validate-dialogueScenes.js
```

Expected: PASS, ending with `All dialogue scene validations passed`.

- [x] **Step 5: Commit**

```bash
git add dialogueScenes.js scripts/validate-dialogueScenes.js
git commit -m "feat: dialogue scene library and selection"
```

---

### Task 5: Context, reporters, and effects

**Files:**
- Create: `dialogueContext.js`
- Create: `scripts/validate-dialogueContext.js`

**Interfaces:**
- Consumes: `sim.periodScores` (Task 1); `clampReputation` / `ensureGmCareer` / `addChronicle` (Task 2); `selectScene` (Task 4); `getTeamById` (teams.js); `pickUniqueName` / `takenNameSet` (names.js); `generateFace` (faces.js).
- Produces:
  - `currentRole(gameState)` → `'player'` | `'gm'`
  - `ensureReporters(gameState)` → `{ [teamId]: reporter }`, cached on `gameState.reporters`
  - `reporterForTeam(gameState, teamId)` → reporter
  - `buildPostgameContext(gameState, sim)` → context object
  - `buildHalftimeContext(gameState, sim)` → context object
  - `applyDialogueEffect(gameState, desc, ctx)` → `{ applied: [...] }`
  - `pushRecentScene(gameState, sceneId)`, `RECENT_SCENE_LIMIT` = 8
- Consumed by Task 6 (persistence) and Tasks 9 and 10.

Reporter shape: `{ id, name, outlet, teamId, face }`.

- [x] **Step 1: Write the failing test**

Create `scripts/validate-dialogueContext.js`:

```js
const assert = require('assert');
const path = require('path');
const dc = require(path.join(__dirname, '..', 'dialogueContext.js'));
const gmCareer = require(path.join(__dirname, '..', 'gmCareer.js'));

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeState() {
  return {
    userTeamId: 'BOS',
    leagueYear: 2027,
    rng: seededRng(99),
    settings: {},
    gmCareer: null
  };
}

// A finished game the user's team lost after leading by 11 at the end of Q3.
function fakeSim() {
  return {
    homeTeamId: 'BOS',
    awayTeamId: 'LAL',
    homeScore: 104,
    awayScore: 110,
    period: 4,
    periodScores: [
      { period: 1, home: 28, away: 24 },
      { period: 2, home: 55, away: 48 },
      { period: 3, home: 84, away: 73 },
      { period: 4, home: 104, away: 110 }
    ],
    homeBox: { p1: { pts: 31, teamId: 'BOS' }, p2: { pts: 12, teamId: 'BOS' } },
    awayBox: { p3: { pts: 28, teamId: 'LAL' } },
    homeRoster: [{ id: 'p1', name: 'J. Tatum' }, { id: 'p2', name: 'D. White' }],
    awayRoster: [{ id: 'p3', name: 'L. James' }]
  };
}

function checkRoleDetection() {
  const gm = fakeState();
  assert.strictEqual(dc.currentRole(gm), 'gm', 'no career controller means GM');

  gm.playerCareerController = { controlledPlayerId: null };
  assert.strictEqual(dc.currentRole(gm), 'gm', 'a controller with no player is still GM');

  gm.playerCareerController = { controlledPlayerId: 'p1' };
  assert.strictEqual(dc.currentRole(gm), 'player', 'a controlled player means player mode');
  console.log('checkRoleDetection: OK');
}
checkRoleDetection();

function checkPostgameContextReadsTheGame() {
  const state = fakeState();
  const c = dc.buildPostgameContext(state, fakeSim());
  assert.strictEqual(c.moment, 'postgame');
  assert.strictEqual(c.role, 'gm');
  assert.strictEqual(c.userScore, 104, 'the user is home here');
  assert.strictEqual(c.opponentScore, 110);
  assert.strictEqual(c.userLost, true);
  assert.strictEqual(c.userWon, false);
  assert.strictEqual(c.margin, 6, 'margin is always positive');
  assert.strictEqual(c.leadBlown, 11, 'led by 11 after three, lost');
  assert.strictEqual(c.topScorerName, 'J. Tatum', 'top scorer is from the USER team');
  assert.strictEqual(c.topScorerPoints, 31);
  console.log('checkPostgameContextReadsTheGame: OK');
}
checkPostgameContextReadsTheGame();

function checkUserOnTheAwaySideIsReadTheSameWay() {
  const state = fakeState();
  state.userTeamId = 'LAL';
  const c = dc.buildPostgameContext(state, fakeSim());
  assert.strictEqual(c.userScore, 110, 'the away score is the user score now');
  assert.strictEqual(c.opponentScore, 104);
  assert.strictEqual(c.userWon, true);
  assert.strictEqual(c.margin, 6);
  assert.strictEqual(c.leadBlown, 0, 'the winner blew nothing');
  assert.strictEqual(c.topScorerName, 'L. James', 'top scorer follows the user side');
  console.log('checkUserOnTheAwaySideIsReadTheSameWay: OK');
}
checkUserOnTheAwaySideIsReadTheSameWay();

function checkLeadBlownNeedsBothALeadAndALoss() {
  const state = fakeState();
  // Trailed after three AND lost: nothing was blown.
  const sim = fakeSim();
  sim.periodScores[2] = { period: 3, home: 70, away: 80 };
  assert.strictEqual(dc.buildPostgameContext(state, sim).leadBlown, 0, 'no lead, nothing blown');

  // A sim with no periodScores at all (an old save, or a batch sim) must not throw.
  const bare = fakeSim();
  delete bare.periodScores;
  assert.strictEqual(dc.buildPostgameContext(state, bare).leadBlown, 0, 'missing period scores degrade to zero');
  console.log('checkLeadBlownNeedsBothALeadAndALoss: OK');
}
checkLeadBlownNeedsBothALeadAndALoss();

function checkHalftimeContextUsesTheHalftimeScore() {
  const state = fakeState();
  const sim = fakeSim();
  sim.period = 2;
  sim.homeScore = 55;
  sim.awayScore = 48;
  const c = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(c.moment, 'halftime');
  assert.strictEqual(c.userScore, 55);
  assert.strictEqual(c.opponentScore, 48);
  assert.strictEqual(c.leading, true);
  assert.strictEqual(c.trailing, false);
  assert.strictEqual(c.margin, 7, 'margin is positive at halftime too');
  assert.strictEqual(c.userWon, undefined, 'a game in progress has no winner');
  console.log('checkHalftimeContextUsesTheHalftimeScore: OK');
}
checkHalftimeContextUsesTheHalftimeScore();

function checkReportersAreOnePerTeamAndStable() {
  const state = fakeState();
  const first = dc.ensureReporters(state);
  const ids = Object.keys(first);
  assert.ok(ids.length > 0, 'reporters were generated');

  // Cached, not regenerated: your beat writer is the same person every night.
  const second = dc.ensureReporters(state);
  assert.strictEqual(second, first, 'the same object is returned, not a rebuild');
  assert.strictEqual(dc.reporterForTeam(state, 'BOS').name, first.BOS.name, 'stable across calls');

  ids.forEach(function (teamId) {
    const r = first[teamId];
    assert.ok(typeof r.name === 'string' && r.name.length > 0, teamId + ' reporter has a name');
    assert.ok(typeof r.outlet === 'string' && r.outlet.length > 0, teamId + ' reporter has an outlet');
    assert.strictEqual(r.teamId, teamId, 'the reporter knows his beat');
    assert.ok(r.face && r.face.body && r.face.hair, teamId + ' reporter has a face to draw');
  });
  console.log('checkReportersAreOnePerTeamAndStable: OK');
}
checkReportersAreOnePerTeamAndStable();

function checkReportersRegenerateOnAnOldSave() {
  const state = fakeState();
  // A save written before this feature has no reporters field at all.
  assert.ok(!state.reporters, 'precondition: nothing cached');
  const r = dc.ensureReporters(state);
  assert.ok(Object.keys(r).length > 0, 'an old save regenerates a full set');
  console.log('checkReportersRegenerateOnAnOldSave: OK');
}
checkReportersRegenerateOnAnOldSave();

function checkSameSeedGivesSameReporters() {
  const a = fakeState();
  const b = fakeState();
  assert.strictEqual(dc.ensureReporters(a).BOS.name, dc.ensureReporters(b).BOS.name,
    'a save replays the same reporters');
  console.log('checkSameSeedGivesSameReporters: OK');
}
checkSameSeedGivesSameReporters();

function checkEffectsClampAndApply() {
  const state = fakeState();
  const career = gmCareer.ensureGmCareer(state);
  career.reputation = 50;

  const player = { id: 'p1', status: { morale: 50 } };
  const ctx = { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [player], opponentName: 'Monarchs' };

  dc.applyDialogueEffect(state, { reputation: 3 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 53, 'reputation moved');

  dc.applyDialogueEffect(state, { reputation: 999 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 100, 'reputation clamps high');

  dc.applyDialogueEffect(state, { reputation: -999 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 0, 'reputation clamps low');

  dc.applyDialogueEffect(state, { teamMorale: 2 }, ctx);
  assert.strictEqual(player.status.morale, 52, 'team morale moved every player');

  player.status.morale = 99.5;
  dc.applyDialogueEffect(state, { teamMorale: 5 }, ctx);
  assert.strictEqual(player.status.morale, 100, 'morale clamps at 100');

  player.status.morale = 1;
  dc.applyDialogueEffect(state, { teamMorale: -5 }, ctx);
  assert.strictEqual(player.status.morale, 0, 'morale clamps at 0');
  console.log('checkEffectsClampAndApply: OK');
}
checkEffectsClampAndApply();

function checkANullEffectChangesNothing() {
  const state = fakeState();
  const career = gmCareer.ensureGmCareer(state);
  career.reputation = 64;
  const player = { id: 'p1', status: { morale: 41 } };
  const ctx = { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [player] };

  const before = JSON.stringify({ rep: state.gmCareer.reputation, morale: player.status.morale });
  dc.applyDialogueEffect(state, null, ctx);
  dc.applyDialogueEffect(state, undefined, ctx);
  dc.applyDialogueEffect(state, {}, ctx);
  const after = JSON.stringify({ rep: state.gmCareer.reputation, morale: player.status.morale });
  assert.strictEqual(after, before, 'a flavour choice is a genuine no-op');
  console.log('checkANullEffectChangesNothing: OK');
}
checkANullEffectChangesNothing();

function checkChronicleAppendsExactlyOnce() {
  const state = fakeState();
  gmCareer.ensureGmCareer(state);
  const before = state.gmCareer.chronicle.length;
  dc.applyDialogueEffect(state, { chronicle: 'Said a thing.' }, { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [] });
  assert.strictEqual(state.gmCareer.chronicle.length, before + 1, 'exactly one entry');
  console.log('checkChronicleAppendsExactlyOnce: OK');
}
checkChronicleAppendsExactlyOnce();

function checkRecentSceneRingBuffer() {
  const state = fakeState();
  for (let i = 0; i < dc.RECENT_SCENE_LIMIT + 4; i++) {
    dc.pushRecentScene(state, 'scene-' + i);
  }
  assert.strictEqual(state.recentDialogueScenes.length, dc.RECENT_SCENE_LIMIT, 'the buffer is bounded');
  assert.strictEqual(state.recentDialogueScenes.indexOf('scene-0'), -1, 'the oldest fell off');
  assert.ok(state.recentDialogueScenes.indexOf('scene-' + (dc.RECENT_SCENE_LIMIT + 3)) !== -1, 'the newest is kept');

  // An absent buffer normalizes rather than throwing.
  const fresh = fakeState();
  dc.pushRecentScene(fresh, 'first');
  assert.deepStrictEqual(fresh.recentDialogueScenes, ['first']);
  console.log('checkRecentSceneRingBuffer: OK');
}
checkRecentSceneRingBuffer();

console.log('All dialogue context validations passed');
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-dialogueContext.js
```

Expected: FAIL — `Cannot find module '.../dialogueContext.js'`.

- [x] **Step 3: Write the implementation**

Create `dialogueContext.js`. Note the `_DIALOGUE_DATA` bridge — `scripts/validate-browserBridges.js` will fail if the browser branch omits any member the source references.

```js
// The single module that knows both the scene world and the game world.
//
// Reads game state into the flat fact object scenes are written against, and
// writes a chosen effect back out. Everything else in the dialogue system is
// deliberately ignorant of one side or the other; this is where that ignorance
// is paid for.

var _DIALOGUE_DATA = (typeof require !== 'undefined')
  ? {
      teams: require('./teams.js'),
      league: require('./league.js'),
      gmCareer: require('./gmCareer.js'),
      names: require('./names.js'),
      faces: require('./faces.js'),
      scenes: require('./dialogueScenes.js')
    }
  : {
      teams: { getTeamById: getTeamById, TEAMS: TEAMS },
      league: { getTeamRoster: getTeamRoster },
      gmCareer: {
        ensureGmCareer: ensureGmCareer,
        addChronicle: addChronicle,
        clampReputation: clampReputation
      },
      names: { pickUniqueName: pickUniqueName, takenNameSet: takenNameSet },
      faces: { generateFace: generateFace },
      scenes: { selectScene: selectScene, interpolate: interpolate }
    };

const RECENT_SCENE_LIMIT = 8;

const OUTLET_SUFFIXES = [
  'Tribune', 'Post', 'Herald', 'Chronicle', 'Dispatch', 'Sports Daily',
  'Athletic Weekly', 'Beat', 'Gazette', 'Register'
];

// Player mode is signalled by the career controller actually holding a
// player — a controller with no controlledPlayerId is the GM path.
function currentRole(gameState) {
  const c = gameState && gameState.playerCareerController;
  return (c && c.controlledPlayerId) ? 'player' : 'gm';
}

function _rand(gameState) {
  return (gameState && gameState.rng) ? gameState.rng : Math.random;
}

function _teamIds(gameState) {
  const t = _DIALOGUE_DATA.teams;
  if (Array.isArray(t.TEAMS)) return t.TEAMS.map(function (x) { return x.id; });
  // Fall back to whatever the state carries, so a trimmed test fixture works.
  if (gameState && Array.isArray(gameState.teams)) return gameState.teams.map(function (x) { return x.id; });
  return [gameState && gameState.userTeamId].filter(Boolean);
}

// One reporter per team, generated once and cached on the save. The point of
// caching is characterisation: the writer who covers your team is the same
// person every night rather than a new stranger each game.
//
// Reporters are NOT players. They never enter a roster, a draft class, or any
// league listing.
function ensureReporters(gameState) {
  if (gameState.reporters && typeof gameState.reporters === 'object') return gameState.reporters;
  const rng = _rand(gameState);
  const taken = _DIALOGUE_DATA.names.takenNameSet();
  const out = {};
  _teamIds(gameState).forEach(function (teamId) {
    const team = _DIALOGUE_DATA.teams.getTeamById ? _DIALOGUE_DATA.teams.getTeamById(teamId) : null;
    const city = (team && (team.city || team.name)) || teamId;
    out[teamId] = {
      id: 'reporter-' + teamId,
      teamId: teamId,
      name: _DIALOGUE_DATA.names.pickUniqueName(rng, taken),
      outlet: city + ' ' + OUTLET_SUFFIXES[Math.floor(rng() * OUTLET_SUFFIXES.length)],
      face: _DIALOGUE_DATA.faces.generateFace(rng)
    };
  });
  gameState.reporters = out;
  return out;
}

function reporterForTeam(gameState, teamId) {
  const all = ensureReporters(gameState);
  return all[teamId] || all[gameState.userTeamId] || null;
}

function _teamName(teamId) {
  const t = _DIALOGUE_DATA.teams.getTeamById ? _DIALOGUE_DATA.teams.getTeamById(teamId) : null;
  return (t && t.name) || teamId;
}

// The top scorer on the USER's side, not in the game. A scene about your own
// roster should never name the opponent's best player.
function _topScorer(sim, userIsHome) {
  const box = userIsHome ? sim.homeBox : sim.awayBox;
  const roster = userIsHome ? sim.homeRoster : sim.awayRoster;
  let bestId = null;
  let best = -1;
  Object.keys(box || {}).forEach(function (id) {
    const pts = (box[id] && box[id].pts) || 0;
    if (pts > best) { best = pts; bestId = id; }
  });
  const player = (roster || []).find(function (p) { return p.id === bestId; });
  return { name: (player && player.name) || 'Your best player', points: Math.max(0, best) };
}

function _baseContext(gameState, sim) {
  const userIsHome = sim.homeTeamId === gameState.userTeamId;
  const userScore = userIsHome ? sim.homeScore : sim.awayScore;
  const opponentScore = userIsHome ? sim.awayScore : sim.homeScore;
  const opponentId = userIsHome ? sim.awayTeamId : sim.homeTeamId;
  const top = _topScorer(sim, userIsHome);
  return {
    role: currentRole(gameState),
    userIsHome: userIsHome,
    teamId: gameState.userTeamId,
    teamName: _teamName(gameState.userTeamId),
    opponentId: opponentId,
    opponentName: _teamName(opponentId),
    userScore: userScore,
    opponentScore: opponentScore,
    margin: Math.abs(userScore - opponentScore),
    topScorerName: top.name,
    topScorerPoints: top.points,
    isPlayoff: !!(gameState.playoffBracket),
    roster: _DIALOGUE_DATA.league.getTeamRoster
      ? _DIALOGUE_DATA.league.getTeamRoster(gameState.userTeamId)
      : []
  };
}

// The margin the user led by at the end of the third, if they led and then
// lost. Zero in every other case, including a sim with no period history
// (a batch sim, or a save written before period scores existed).
function _leadBlown(gameState, sim, userIsHome, userLost) {
  if (!userLost || !Array.isArray(sim.periodScores)) return 0;
  const third = sim.periodScores.find(function (r) { return r.period === 3; });
  if (!third) return 0;
  const userThird = userIsHome ? third.home : third.away;
  const oppThird = userIsHome ? third.away : third.home;
  return Math.max(0, userThird - oppThird);
}

function buildPostgameContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  const userWon = base.userScore > base.opponentScore;
  return Object.assign(base, {
    moment: 'postgame',
    userWon: userWon,
    userLost: !userWon,
    leadBlown: _leadBlown(gameState, sim, base.userIsHome, !userWon),
    streak: (gameState.season && gameState.season.streak) || 0,
    seasonWins: (gameState.season && gameState.season.wins) || 0,
    seasonLosses: (gameState.season && gameState.season.losses) || 0
  });
}

function buildHalftimeContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  return Object.assign(base, {
    moment: 'halftime',
    leading: base.userScore > base.opponentScore,
    trailing: base.userScore < base.opponentScore
  });
}

function _nudgeMorale(player, delta) {
  if (!player || !player.status || typeof player.status.morale !== 'number') return;
  player.status.morale = Math.max(0, Math.min(100, player.status.morale + delta));
}

// The single interpreter of an effect description. Scenes return these; only
// this function touches game state, which is what keeps the scene library
// testable with no game at all.
function applyDialogueEffect(gameState, desc, ctx) {
  const applied = [];
  if (!desc || typeof desc !== 'object') return { applied: applied };

  if (typeof desc.teamMorale === 'number') {
    (ctx.roster || []).forEach(function (p) { _nudgeMorale(p, desc.teamMorale); });
    applied.push('teamMorale');
  }

  if (typeof desc.playerMorale === 'number') {
    const id = gameState.playerCareerController && gameState.playerCareerController.controlledPlayerId;
    const me = (ctx.roster || []).find(function (p) { return p.id === id; });
    _nudgeMorale(me, desc.playerMorale);
    applied.push('playerMorale');
  }

  if (typeof desc.reputation === 'number') {
    const career = _DIALOGUE_DATA.gmCareer.ensureGmCareer(gameState);
    if (career) {
      career.reputation = _DIALOGUE_DATA.gmCareer.clampReputation(career.reputation + desc.reputation);
      applied.push('reputation');
    }
  }

  if (typeof desc.chronicle === 'string' && desc.chronicle.length > 0) {
    const career = _DIALOGUE_DATA.gmCareer.ensureGmCareer(gameState);
    if (career) {
      _DIALOGUE_DATA.gmCareer.addChronicle(career, gameState.leagueYear, 'press', desc.chronicle);
      applied.push('chronicle');
    }
  }

  if (desc.recordDecision) {
    const c = gameState.playerCareerController;
    if (c && typeof c.recordDecision === 'function') {
      c.recordDecision('dialogue', String(desc.recordDecision), 'resolved');
      applied.push('recordDecision');
    }
  }

  return { applied: applied };
}

function pushRecentScene(gameState, sceneId) {
  if (!Array.isArray(gameState.recentDialogueScenes)) gameState.recentDialogueScenes = [];
  gameState.recentDialogueScenes.push(sceneId);
  while (gameState.recentDialogueScenes.length > RECENT_SCENE_LIMIT) {
    gameState.recentDialogueScenes.shift();
  }
  return gameState.recentDialogueScenes;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RECENT_SCENE_LIMIT: RECENT_SCENE_LIMIT,
    currentRole: currentRole,
    ensureReporters: ensureReporters,
    reporterForTeam: reporterForTeam,
    buildPostgameContext: buildPostgameContext,
    buildHalftimeContext: buildHalftimeContext,
    applyDialogueEffect: applyDialogueEffect,
    pushRecentScene: pushRecentScene
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
node scripts/validate-dialogueContext.js
```

Expected: PASS, ending with `All dialogue context validations passed`.

If `checkReportersAreOnePerTeamAndStable` fails on a missing `TEAMS` export, check what `teams.js` actually exports for the full team list and use that name in `_teamIds` and in the browser branch of `_DIALOGUE_DATA`.

- [x] **Step 5: Commit**

```bash
git add dialogueContext.js scripts/validate-dialogueContext.js
git commit -m "feat: dialogue contexts, beat reporters, and effect application"
```

---

### Task 6: Persist reporters and the recent-scene buffer

`save.js` does **not** serialize `GameState` wholesale — it builds an explicit
payload field list. A new field that is not added to it is silently dropped on
reload, which is exactly the bug the file's own v2 comment documents ("a
reload silently dropped it: a career-mode game reverted to GM mode…").

Without this task, reporters regenerate from an advanced rng on every load, so
your beat writer is a different person every session — which defeats the whole
reason they are cached.

**Files:**
- Modify: `save.js` (payload object ~line 160-189; load path ~line 305-320)
- Test: `scripts/validate-save.js`

**Interfaces:**
- Consumes: `GameState.reporters` and `GameState.recentDialogueScenes` (Task 5).
- Produces: both fields survive a save/load round trip.

- [x] **Step 1: Write the failing test**

Append to `scripts/validate-save.js`, before its final "All ... passed" line:

```js
function checkDialogueStateSurvivesARoundTrip() {
  const state = makeTestGameState();
  state.reporters = {
    BOS: { id: 'reporter-BOS', teamId: 'BOS', name: 'Dana Kessler', outlet: 'Boston Herald',
           face: { body: { color: '#bb876f' }, hair: { color: '#272421' } } }
  };
  state.recentDialogueScenes = ['blown-fourth-lead', 'statement-win'];

  const payload = buildSavePayload(state);
  const loaded = makeEmptyGameState();
  applySavePayload(payload, loaded);

  assert.ok(loaded.reporters, 'reporters survived the round trip');
  assert.strictEqual(loaded.reporters.BOS.name, 'Dana Kessler', 'the beat writer is the same person');
  assert.strictEqual(loaded.reporters.BOS.outlet, 'Boston Herald');
  assert.ok(loaded.reporters.BOS.face, 'the face survived, so the bust still draws');
  assert.deepStrictEqual(loaded.recentDialogueScenes, ['blown-fourth-lead', 'statement-win'],
    'the ring buffer survived');
  console.log('checkDialogueStateSurvivesARoundTrip: OK');
}
checkDialogueStateSurvivesARoundTrip();

function checkAnOldSaveWithoutDialogueStateLoads() {
  // A payload written before this feature has neither field.
  const state = makeTestGameState();
  const payload = buildSavePayload(state);
  delete payload.reporters;
  delete payload.recentDialogueScenes;

  const loaded = makeEmptyGameState();
  assert.doesNotThrow(function () { applySavePayload(payload, loaded); },
    'an old save loads without throwing');
  assert.deepStrictEqual(loaded.recentDialogueScenes, [], 'the buffer normalizes to empty');
  console.log('checkAnOldSaveWithoutDialogueStateLoads: OK');
}
checkAnOldSaveWithoutDialogueStateLoads();
```

`makeTestGameState`, `makeEmptyGameState`, `buildSavePayload` and
`applySavePayload` are placeholders — read the top of
`scripts/validate-save.js` and use the fixture helpers and the save/load
function names it already uses.

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-save.js
```

Expected: FAIL — `AssertionError: reporters survived the round trip`.

- [x] **Step 3: Add the fields to the payload**

In `save.js`, at the end of the payload object (after the `gmCareer:` line),
add:

```js
    ,
    // v4. Dialogue state. Reporters are cached rather than derived: the point
    // of caching them is that the writer covering your team is the SAME person
    // every night, and regenerating from an advanced rng on every load would
    // hand you a stranger each session. The ring buffer stops a scene
    // recurring immediately across a save/load.
    reporters: gameState.reporters || null,
    recentDialogueScenes: gameState.recentDialogueScenes || []
```

- [x] **Step 4: Restore them on load**

In `save.js`, in the load path alongside the other field restorations (near
the `gameState.gmCareer = payload.gmCareer || null;` line), add:

```js
  // A payload predating this feature has neither. Reporters left null are
  // regenerated on first use by ensureReporters; the buffer starts empty,
  // which just means the next scene is unconstrained.
  gameState.reporters = payload.reporters || null;
  gameState.recentDialogueScenes = Array.isArray(payload.recentDialogueScenes)
    ? payload.recentDialogueScenes
    : [];
```

- [x] **Step 5: Run the test to verify it passes**

```bash
node scripts/validate-save.js
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add save.js scripts/validate-save.js
git commit -m "feat: persist reporters and the recent-scene buffer"
```

---

### Task 7: The dialogue box overlay

The engine. Most of it is DOM, which this codebase has no harness for, so the validator asserts what is assertable — that the module loads and degrades without a DOM, the way `ui/pixelSprites.js`'s own validator does — and the rest is covered by manual smoke in Tasks 9 and 10.

**Files:**
- Create: `ui/dialogueBox.js`
- Modify: `style.css` (append)
- Modify: `index.html`
- Test: `scripts/validate-dialogueContext.js` (append)

**Interfaces:**
- Consumes: `drawPixelBust`, `bustScale`, `bustColorsFor`, `BUST` (Task 3); `interpolate` (Task 4).
- Produces:
  - `runDialogue(scene, ctx, onDone)` — returns `true` if the box opened, `false` if it could not (no DOM, or a box is already up)
  - `onDone(result)` where `result` = `{ sceneId, choiceIndex, skipped }`; `choiceIndex` is `null` when `skipped` is true
  - `dialogueBoxIsOpen()` → boolean
  - `closeDialogueBox()` — tears down; used when leaving a view mid-scene
  - `DIALOGUE_CHAR_MS` = 28

- [x] **Step 1: Write the failing test**

Append to `scripts/validate-dialogueContext.js`, before its final "All ... passed" line:

```js
const dialogueBox = require(path.join(__dirname, '..', 'ui', 'dialogueBox.js'));

function checkTheBoxDegradesWithoutADom() {
  // This module is required by a node validator that has no DOM, exactly the
  // way ui/pixelSprites.js is. It must not throw at load or at call.
  assert.strictEqual(dialogueBox.dialogueBoxIsOpen(), false, 'nothing is open without a DOM');
  assert.strictEqual(dialogueBox.runDialogue({ id: 'x', lines: [], choices: [] }, {}, function () {}),
    false, 'runDialogue reports it could not open rather than throwing');
  assert.doesNotThrow(function () { dialogueBox.closeDialogueBox(); }, 'closing nothing is safe');
  console.log('checkTheBoxDegradesWithoutADom: OK');
}
checkTheBoxDegradesWithoutADom();

function checkTypewriterSpeedIsTheSpeccedValue() {
  assert.strictEqual(dialogueBox.DIALOGUE_CHAR_MS, 28, 'the spec fixes this at 28ms/char');
  console.log('checkTypewriterSpeedIsTheSpeccedValue: OK');
}
checkTypewriterSpeedIsTheSpeccedValue();
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/validate-dialogueContext.js
```

Expected: FAIL — `Cannot find module '.../ui/dialogueBox.js'`.

- [x] **Step 3: Write the implementation**

Create `ui/dialogueBox.js`:

```js
// The dialogue overlay. Knows nothing about basketball — its entire input is
// a scene object and a context object.
//
// It is a DOM overlay rather than a #view-content scene (the convention every
// other scene in ui/ follows) for one reason: halftime fires INSIDE the live
// pixel game view, on top of a canvas that is mid-playback. Rendering into
// #view-content would mean tearing that down, and the two moments would drift
// into two implementations.

var _DIALOGUE_BOX_DATA = (typeof require !== 'undefined')
  ? { bust: require('./pixelBust.js'), scenes: require('../dialogueScenes.js') }
  : { bust: {
        drawPixelBust: drawPixelBust, bustScale: bustScale,
        bustColorsFor: bustColorsFor, BUST: BUST
      },
      scenes: { interpolate: interpolate } };

// Fixed by the spec. A click mid-line completes it instantly, so this is a
// floor on comfort rather than a ceiling on speed.
const DIALOGUE_CHAR_MS = 28;
const DIALOGUE_BUST_PX = 120;

// Only one box at a time. A second scene arriving while one is up is dropped
// by the caller, not queued.
let _openBox = null;

function dialogueBoxIsOpen() {
  return _openBox !== null;
}

function closeDialogueBox() {
  if (!_openBox) return;
  if (_openBox.onKey && typeof document !== 'undefined') {
    document.removeEventListener('keydown', _openBox.onKey);
  }
  if (_openBox.timer) clearInterval(_openBox.timer);
  if (_openBox.root && _openBox.root.parentNode) {
    _openBox.root.parentNode.removeChild(_openBox.root);
  }
  _openBox = null;
}

function _speakerName(scene, ctx) {
  if (ctx && ctx.speakerName) return ctx.speakerName;
  const kind = (scene.speaker && scene.speaker.kind) || 'reporter';
  if (kind === 'coach') return 'Head Coach';
  return 'Beat Writer';
}

function runDialogue(scene, ctx, onDone) {
  if (typeof document === 'undefined' || !document.body) return false;
  if (_openBox) return false;
  if (!scene || !Array.isArray(scene.lines) || !Array.isArray(scene.choices)) return false;

  const done = typeof onDone === 'function' ? onDone : function () {};

  const root = document.createElement('div');
  root.className = 'dlg-overlay';

  const box = document.createElement('div');
  box.className = 'dlg-box';

  // The bezel. Bust and text live INSIDE it; the choice stack is a sibling
  // that continues the same rings downward.
  const frame = document.createElement('div');
  frame.className = 'dlg-frame';

  const bustWrap = document.createElement('div');
  bustWrap.className = 'dlg-bust';
  const scale = _DIALOGUE_BOX_DATA.bust.bustScale(DIALOGUE_BUST_PX);
  const canvas = document.createElement('canvas');
  canvas.width = _DIALOGUE_BOX_DATA.bust.BUST.w * scale;
  canvas.height = _DIALOGUE_BOX_DATA.bust.BUST.h * scale;
  bustWrap.appendChild(canvas);

  const body = document.createElement('div');
  body.className = 'dlg-body';

  const plate = document.createElement('div');
  plate.className = 'dlg-plate';
  // textContent, never innerHTML: this is a generated person's name.
  plate.textContent = _speakerName(scene, ctx);

  const textEl = document.createElement('div');
  textEl.className = 'dlg-text';

  const blinker = document.createElement('div');
  blinker.className = 'dlg-blinker';
  blinker.textContent = '▼';
  blinker.style.visibility = 'hidden';

  const choiceList = document.createElement('div');
  choiceList.className = 'dlg-choices';
  choiceList.style.display = 'none';

  body.appendChild(plate);
  body.appendChild(textEl);
  body.appendChild(blinker);
  frame.appendChild(bustWrap);
  frame.appendChild(body);
  box.appendChild(frame);
  box.appendChild(choiceList);
  root.appendChild(box);
  document.body.appendChild(root);

  const reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const state = {
    root: root, canvas: canvas, scale: scale,
    lineIndex: 0, charIndex: 0, timer: null, onKey: null,
    fullText: '', complete: false, finished: false
  };
  _openBox = state;

  const colors = _DIALOGUE_BOX_DATA.bust.bustColorsFor(
    (ctx && ctx.speakerPlayer) || (ctx && ctx.speakerReporter) || {},
    (ctx && ctx.speakerTeam) || null
  );

  function paintBust(emotion) {
    const c2d = canvas.getContext('2d');
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    _DIALOGUE_BOX_DATA.bust.drawPixelBust(c2d, colors, emotion, { scale: state.scale });
  }

  function finishLine() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    textEl.textContent = state.fullText;
    state.complete = true;
    blinker.style.visibility = 'visible';
  }

  function startLine() {
    const line = scene.lines[state.lineIndex];
    state.fullText = _DIALOGUE_BOX_DATA.scenes.interpolate(line.text, ctx || {});
    state.charIndex = 0;
    state.complete = false;
    textEl.textContent = '';
    blinker.style.visibility = 'hidden';
    paintBust(line.emotion);

    if (reduceMotion) { finishLine(); return; }

    state.timer = setInterval(function () {
      state.charIndex++;
      textEl.textContent = state.fullText.slice(0, state.charIndex);
      // Every third character, so it chirps rather than buzzes.
      if (state.charIndex % 3 === 0 && typeof playPixelSfx === 'function') playPixelSfx('blip');
      if (state.charIndex >= state.fullText.length) finishLine();
    }, DIALOGUE_CHAR_MS);
  }

  function showChoices() {
    blinker.style.visibility = 'hidden';
    choiceList.style.display = '';
    scene.choices.forEach(function (choice, i) {
      const btn = document.createElement('button');
      btn.className = 'dlg-choice';
      btn.type = 'button';
      // textContent: choice text can interpolate generated names too.
      btn.textContent = _DIALOGUE_BOX_DATA.scenes.interpolate(choice.text, ctx || {});
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (choice.emotion) paintBust(choice.emotion);
        finish({ sceneId: scene.id, choiceIndex: i, skipped: false });
      });
      choiceList.appendChild(btn);
    });
  }

  function finish(result) {
    if (state.finished) return;
    state.finished = true;
    closeDialogueBox();
    done(result);
  }

  // A click mid-line COMPLETES the line rather than advancing. Skipping the
  // rest of a sentence you have not read is the failure mode this prevents.
  function advance() {
    if (!state.complete) { finishLine(); return; }
    if (state.lineIndex < scene.lines.length - 1) {
      state.lineIndex++;
      startLine();
      return;
    }
    if (choiceList.style.display === 'none') showChoices();
  }

  root.addEventListener('click', advance);

  state.onKey = function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // A skipped scene applies NO effect. Silence is not a choice, and
      // auto-applying a default would punish the user for skipping.
      finish({ sceneId: scene.id, choiceIndex: null, skipped: true });
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener('keydown', state.onKey);

  startLine();
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIALOGUE_CHAR_MS: DIALOGUE_CHAR_MS,
    runDialogue: runDialogue,
    dialogueBoxIsOpen: dialogueBoxIsOpen,
    closeDialogueBox: closeDialogueBox
  };
}
```

- [x] **Step 4: Append the styles**

Append to `style.css`:

Direction **C, "arcade terminal"**, chosen from rendered mockups on 2026-08-15.
Hard double border, monospace, no rounded corners — the box belongs to the
pixel game rather than the app chrome. Deliberately does NOT use `--r-lg` or
the app's sans stack; that is the point of the direction.

```css
/* ---- Dialogue box (arcade terminal) ----
   z-index sits ABOVE .quit-confirm (9500): a dialogue can open over the live
   game view, and the layer beneath must not be clickable through it.

   The doubled border is drawn with box-shadow rings rather than nested
   elements: two solid rings at 3px and 5px give the CRT-bezel edge without a
   wrapper div per ring. Squared corners throughout — a rounded corner is what
   would make this read as app chrome instead of as the game. */
.dlg-overlay {
  position: fixed; inset: 0; z-index: 9600;
  display: flex; align-items: flex-end; justify-content: center;
  padding: 0 14px 14px;
  background: rgba(0, 0, 0, .45);
  cursor: pointer;
}
.dlg-box { width: 100%; max-width: 660px; }
.dlg-frame {
  display: flex;
  background: #0d1017;
  border: 3px solid #55627a;
  box-shadow: 0 0 0 3px #0d1017, 0 0 0 5px var(--line), 0 14px 36px -8px rgba(0, 0, 0, .9);
}
.dlg-bust {
  flex: 0 0 auto; padding: 10px; align-self: stretch;
  display: flex; align-items: flex-end;
  background: #11151d;
  border-right: 3px solid #55627a;
}
.dlg-bust canvas {
  image-rendering: pixelated; display: block;
  animation: dlg-bust-in 180ms steps(3, end);
}
/* Stepped, not eased: a smooth slide under a pixel bust reads as a different
   art style arriving with it. */
@keyframes dlg-bust-in {
  from { transform: translateX(-9px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
.dlg-body { position: relative; flex: 1 1 auto; padding: 9px 12px 11px; min-width: 0; }
.dlg-plate {
  font-family: ui-monospace, "Consolas", "Courier New", monospace;
  font-size: .7rem; letter-spacing: .1em; text-transform: uppercase;
  color: #7dd3a0; margin-bottom: 6px;
}
.dlg-text {
  font-family: ui-monospace, "Consolas", "Courier New", monospace;
  font-size: .84rem; line-height: 1.55; color: #dbe4f0;
  min-height: 3.1em; white-space: pre-wrap;
}
.dlg-blinker {
  position: absolute; right: 10px; bottom: 6px;
  font-size: .62rem; color: #7dd3a0;
  animation: dlg-blink 1s steps(2, start) infinite;
}
@keyframes dlg-blink { to { visibility: hidden; } }
/* Choices continue the frame downward — same rings, no top border, so the
   stack reads as one console rather than as buttons under a box. */
.dlg-choices { display: flex; flex-direction: column; }
.dlg-choice {
  position: relative; text-align: left; cursor: pointer;
  font-family: ui-monospace, "Consolas", "Courier New", monospace;
  font-size: .8rem; color: #dbe4f0;
  background: #0d1017;
  border: 3px solid #55627a; border-top: none;
  padding: 8px 12px 8px 26px;
  box-shadow: 0 0 0 3px #0d1017, 0 0 0 5px var(--line);
}
.dlg-choice::before {
  content: '\25B6'; position: absolute; left: 10px; top: 50%;
  transform: translateY(-50%); font-size: .62rem; color: #7dd3a0;
  opacity: 0;
}
.dlg-choice:hover, .dlg-choice:focus-visible { background: #161c26; outline: none; }
.dlg-choice:hover::before, .dlg-choice:focus-visible::before { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .dlg-bust canvas { animation: none; }
  .dlg-blinker { animation: none; }
}
```

The literal hex values here are intentional and are **not** a token oversight:
this direction is deliberately outside the app's surface ramp. `--line` is
still used for the outer ring so the frame agrees with the app's edge colour.

Because `.dlg-frame` is a new wrapper element, `runDialogue` must build it —
see the DOM assembly in Step 3, which nests `.dlg-bust` and `.dlg-body` inside
`.dlg-frame`, with `.dlg-choices` a sibling of `.dlg-frame` inside `.dlg-box`.
Markup without its matching CSS renders as unstyled plain text and every
content assertion still passes, so this pairing gets checked by eye in Step 6.

- [x] **Step 5: Wire the script tags**

In `index.html`, load order matters — these share one global scope and run in tag order.

Add after the `<script src="ui/pixelSprites.js"></script>` line:

```html
  <!-- Reads spriteColorsForPlayer/safeSpriteColor from pixelSprites.js at
       CALL time, not load time, but it is kept adjacent to its only
       dependency so the pairing is obvious. -->
  <script src="ui/pixelBust.js"></script>
```

Add immediately after `<script src="narrativeSystem.js"></script>` (its fallback pool comes from there) and before `ui/pixelChoreographer.js`:

```html
  <!-- Pure data and predicates; depends on nothing. -->
  <script src="dialogueScenes.js"></script>
  <!-- Captures teams/league/gmCareer/names/faces/dialogueScenes into its data
       block at LOAD time, so every one of them must already be defined. -->
  <script src="dialogueContext.js"></script>
  <script src="ui/dialogueBox.js"></script>
```

- [x] **Step 6: Run the full validator sweep**

```bash
node scripts/validate-dialogueContext.js && node scripts/validate-uiSafety.js && node scripts/validate-browserBridges.js
```

Expected: all PASS. `validate-browserBridges.js` is the one that catches a `_DIALOGUE_DATA` browser branch missing a member the source references — the failure mode that passes every node test and crashes the game.

- [x] **Step 7: Commit**

```bash
git add ui/dialogueBox.js style.css index.html scripts/validate-dialogueContext.js
git commit -m "feat: the dialogue box overlay"
```

---

### Task 8: Blip audio and the settings toggle

**Files:**
- Modify: `ui/pixelAudio.js` (`playPixelSfx` switch, ~line 88)
- Modify: `ui/settings.js`

**Interfaces:**
- Produces: `playPixelSfx('blip')`; `GameState.settings.dialogueScenes` (boolean, defaults to enabled when `undefined`).
- Consumed by Tasks 9 and 10, which check the setting before firing.

- [x] **Step 1: Add the blip**

In `ui/pixelAudio.js`, inside the `playPixelSfx` switch, add alongside the other cases:

```js
    case 'blip':    sfxTone(a, 620, 0.03, 'square', 0.035); break;
```

Short and quiet on purpose — it fires every third character, so anything longer or louder becomes a buzz rather than a chirp.

- [x] **Step 2: Verify it does not break the audio module**

```bash
node --check ui/pixelAudio.js
```

Expected: no output (syntax is valid).

- [x] **Step 3: Add the settings toggle**

In `ui/settings.js`, alongside the other checkbox rows (follow the exact markup of the `playInEnabled` row), add:

```js
    '<label><input type="checkbox" data-setting="dialogueScenes"' +
      (GameState.settings.dialogueScenes === false ? '' : ' checked') +
      '> Halftime and post-game interviews</label>' +
```

The `=== false` test is deliberate: an absent setting means enabled, so existing saves get the feature without a migration.

Wire the change handler the same way the neighbouring checkboxes are wired in this file's event delegation block:

```js
      GameState.settings.dialogueScenes = e.target.checked;
```

Read the existing handler block and match its dispatch style (`data-setting` attribute vs. an `id`) rather than inventing a new one.

- [x] **Step 4: Run the validators**

```bash
node scripts/validate-uiSafety.js && node scripts/validate-settingsRules.js
```

Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add ui/pixelAudio.js ui/settings.js
git commit -m "feat: dialogue blip sfx and a toggle to turn the scenes off"
```

---

### Task 9: Post-game hook

**Files:**
- Modify: `ui/simControls.js` (the two `onFinish` callbacks, ~line 392 and ~line 483)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: `maybeRunPostgameDialogue(sim, onContinue)` — a single helper both `onFinish` sites call, so the two paths cannot drift.

- [x] **Step 1: Add the helper**

In `ui/simControls.js`, above the function containing the first `setLiveWatchSession` call, add:

```js
// Fires the post-game interview, if one is warranted. Returns true if a box
// opened. Both onFinish paths (regular season and playoff) call this same
// helper so the two cannot drift.
function maybeRunPostgameDialogue(sim, onContinue) {
  const cont = typeof onContinue === 'function' ? onContinue : function () {};
  if (GameState.settings && GameState.settings.dialogueScenes === false) { cont(); return false; }
  if (typeof runDialogue !== 'function' || dialogueBoxIsOpen()) { cont(); return false; }
  if (!sim || (sim.homeTeamId !== GameState.userTeamId && sim.awayTeamId !== GameState.userTeamId)) {
    cont();
    return false;
  }

  const ctx = buildPostgameContext(GameState, sim);
  const scene = selectScene(ctx, {
    recent: GameState.recentDialogueScenes || [],
    rand: GameState.rng,
    fallbackLines: (GameState.narrativeSystem && GameState.narrativeSystem.dialogueLibrary)
      ? GameState.narrativeSystem.dialogueLibrary.media_standard
      : null
  });

  const reporter = reporterForTeam(GameState, GameState.userTeamId);
  if (reporter) {
    ctx.speakerReporter = { face: reporter.face };
    ctx.speakerName = reporter.name + ' — ' + reporter.outlet;
  }

  const opened = runDialogue(scene, ctx, function (result) {
    if (!result.skipped) {
      const choice = scene.choices[result.choiceIndex];
      if (choice && typeof choice.effect === 'function') {
        applyDialogueEffect(GameState, choice.effect(ctx), ctx);
      }
    }
    pushRecentScene(GameState, scene.id);
    autosave(GameState);
    cont();
  });

  if (!opened) cont();
  return opened;
}
```

- [x] **Step 2: Call it from both `onFinish` sites**

In the regular-season `onFinish` (~line 483), change:

```js
    onFinish: function () {
      watch.liveGame.finish();
      autosave(GameState);
    }
```

to:

```js
    onFinish: function () {
      watch.liveGame.finish();
      // The interview comes AFTER finish(): the box score and the result only
      // exist once the game is completed, and the scene reads both.
      maybeRunPostgameDialogue(watch.liveGame.sim, function () {
        autosave(GameState);
      });
    }
```

In the playoff `onFinish` (~line 392), wrap the existing body the same way. Read that callback in full first — it does more than the regular-season one (it advances the bracket and collects finished games) and **all** of that existing work must still run. Call `maybeRunPostgameDialogue` after `watch.liveGame.finish()` and move the remaining statements into its continuation, preserving their order.

- [x] **Step 3: Run the validators**

```bash
node scripts/validate-uiSafety.js && node scripts/validate-simControlsOffseasonGuard.js && node scripts/validate-liveWatch.js && node scripts/validate-userPathRules.js
```

Expected: all PASS.

- [x] **Step 4: Manual smoke in the browser**

Start the dev server and play a game to completion:

```bash
python scripts/devserver.py
```

Verify, in order:
1. Watch a full game with your own team. The interview appears after the final buzzer.
2. The bust draws a face, and the expression changes between lines.
3. Clicking mid-line completes the line; clicking again advances.
4. Choices appear only after the last line.
5. Picking a consequential choice moves the Reputation tile on the GM Career view.
6. Picking the flavour choice moves nothing.
7. Esc mid-scene closes the box and changes nothing.
8. Turning the setting off stops it firing.

- [x] **Step 5: Commit**

```bash
git add ui/simControls.js
git commit -m "feat: post-game interview after a watched game"
```

---

### Task 10: Halftime hook

**Files:**
- Modify: `ui/pixelGameView.js` (period-change branch, ~line 538)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: nothing consumed elsewhere.

- [x] **Step 1: Find the seam**

In `ui/pixelGameView.js`, the existing branch is:

```js
      if (fr.a.period > lastQuarterSeen) {
        if (!reduceMotion) {
          quarterCard = { ... };
          hitchMs = Math.max(hitchMs, 1500);
        }
        lastQuarterSeen = fr.a.period;
        playPixelSfx('buzzer');
      }
```

- [x] **Step 2: Add the halftime call**

Inside that branch, after `lastQuarterSeen = fr.a.period;`, add:

```js
        // Halftime is the crossing INTO period 3 — the end of the second.
        // Not a hitchMs bump like the quarter card: a dialogue cannot be on a
        // timer, so playback is hard-paused and restored on dismiss.
        if (lastQuarterSeen === 3) maybeRunHalftimeDialogue();
```

- [x] **Step 3: Add the helper**

Inside the same closure that owns the playback loop (so it can reach the pause controls and `sim`), add:

```js
  function maybeRunHalftimeDialogue() {
    if (GameState.settings && GameState.settings.dialogueScenes === false) return;
    if (typeof runDialogue !== 'function' || dialogueBoxIsOpen()) return;
    const sim = liveSim;
    if (!sim) return;
    if (sim.homeTeamId !== GameState.userTeamId && sim.awayTeamId !== GameState.userTeamId) return;

    const wasPlaying = isPlaying();
    setPlaying(false);

    const ctx = buildHalftimeContext(GameState, sim);
    const scene = selectScene(ctx, {
      recent: GameState.recentDialogueScenes || [],
      rand: GameState.rng,
      fallbackLines: (GameState.narrativeSystem && GameState.narrativeSystem.dialogueLibrary)
        ? GameState.narrativeSystem.dialogueLibrary.media_standard
        : null
    });
    // The coach has no generated face, so the bust falls back to neutral
    // colouring — but passing the team makes him wear YOUR jersey, which is
    // most of what makes him read as your coach rather than a stranger.
    ctx.speakerName = 'Head Coach';
    ctx.speakerTeam = getTeamById(GameState.userTeamId);

    const opened = runDialogue(scene, ctx, function (result) {
      if (!result.skipped) {
        const choice = scene.choices[result.choiceIndex];
        if (choice && typeof choice.effect === 'function') {
          applyDialogueEffect(GameState, choice.effect(ctx), ctx);
        }
      }
      pushRecentScene(GameState, scene.id);
      if (wasPlaying) setPlaying(true);
    });

    // If the box could not open, playback must not be left frozen.
    if (!opened && wasPlaying) setPlaying(true);
  }
```

`liveSim`, `isPlaying()` and `setPlaying()` are placeholders for whatever this file actually calls them. Read the playback loop and substitute the real names — the sim object it is animating, and the pause/resume controls the pause button already drives. Do **not** add new pause state; reuse what the pause button uses.

- [x] **Step 4: Tear the box down when leaving the view**

Find where this view cleans up (the same place the pixel coach's document-level `keydown` listener is removed at game over) and add:

```js
    closeDialogueBox();
```

Without this, leaving the Watch Game view mid-scene leaves an overlay pinned over the whole app.

- [x] **Step 5: Run the validators**

```bash
node scripts/validate-uiSafety.js && node scripts/validate-liveWatch.js && node scripts/validate-pixel-events.js && node scripts/validate-browserBridges.js
```

Expected: all PASS.

- [x] **Step 6: Manual smoke in the browser**

```bash
python scripts/devserver.py
```

Verify, in order:
1. Watch your own team. At the end of Q2, playback pauses and the coach appears.
2. Dismissing resumes playback at the same speed it was running.
3. It behaves the same at 1x and at 8x.
4. Pausing manually before halftime, then dismissing the box, leaves playback paused (it restores the *previous* state, not "playing").
5. Leaving the view mid-scene removes the overlay.
6. It does not fire for a game your team is not in.
7. It fires once, not on every frame of the period change.

- [x] **Step 7: Run the whole validator suite**

```bash
for f in scripts/validate-*.js; do echo "== $f"; node "$f" > /dev/null || echo "FAILED: $f"; done
```

Expected: no `FAILED:` lines.

- [x] **Step 8: Commit**

```bash
git add ui/pixelGameView.js
git commit -m "feat: halftime exchange during a watched game"
```

---

## Outcome (2026-08-15)

All 10 tasks complete. 60 validators pass, 3 of them new. Four things went
differently from the plan, all corrected in place:

1. **Period scores belong in `endPeriod()`**, not at the play-by-play period
   header. That header is written at the top of a step for the period about to
   be played, so it captured a score one possession short of the period's end
   and the final row did not equal the final score.
2. **`CHRONICLE_KINDS` is a fixed enum.** The plan had dialogue writing a bare
   `'press'` string; `PRESS` was added to the enum instead.
3. **`SPRITE_CARD_NO_TEAM` was not exported** from `ui/pixelSprites.js`, so the
   teamless-speaker fallback the plan relied on did not exist yet.
4. **Load order.** `ui/dialogueBox.js` captures `drawPixelBust` and
   `interpolate` at load time, so it must follow both `ui/pixelBust.js` and
   `dialogueScenes.js`. Placed by the plan's original position it threw on
   every page load. Also, `validate-uiSafety.js` requires every `ui/` file to
   be loaded by `index.html`, so the script tag ships with the file rather than
   with the task that first uses it.

Nine scenes shipped rather than five, covering both moments and both roles.

## Notes for the implementer

- **Line numbers drift.** Every `~line N` above is from the state of the repo at plan time. Search for the quoted code, do not trust the number.
- **Two validators are load-bearing and easy to forget.** `validate-browserBridges.js` catches a browser branch missing a member — the failure that passes every node test and crashes the real game. `validate-uiSafety.js` catches unescaped interpolation. Run both after any change under `ui/` or to a root module's `_X_DATA` block.
- **The `hitchMs` pattern is not what halftime wants.** The quarter card uses a timed freeze because it dismisses itself. A dialogue does not, so it hard-pauses and restores.
- **Scene volume is the real risk, and it is writing work, not engineering work.** Five scenes ship here. The fallback keeps the floor from being embarrassing, but the feature only feels alive at a few dozen. Adding one is appending an object to `SCENES` — `validate-dialogueScenes.js` checks its tokens, emotions, effect channels, and morale scale automatically.
