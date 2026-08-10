# High-Speed Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a watched game followable at 4x and 8x — the ball stays trackable, and the moments worth seeing stop the game instead of blurring past.

**Architecture:** Two changes, no new systems. The existing impact-emphasis module has its speed relationship inverted: instead of fading out as speed rises, the *bar for what earns a freeze* rises while the emphasis itself grows. The court renderer gains a ball trail and a handler ring, both scaling with speed.

**Tech Stack:** Vanilla ES5-style JavaScript, no build step, no dependencies. Canvas 2D at a fixed 480x270 pixel stage with `imageSmoothingEnabled = false`.

**Spec:** `docs/superpowers/specs/2026-08-10-high-speed-legibility-design.md`

## Global Constraints

- **No new dependencies, no new files.** Everything lands in `ui/pixelImpact.js`, `ui/pixelGameView.js`, and `scripts/validate-impactMoments.js`.
- **Reduced motion wins over everything.** It already returns 0 from every effect; freezes, zooms, trails and rings are all suppressed under it. This is an accessibility setting, not a preference.
- **A viewer action always wins.** Changing speed or pausing during a freeze cancels it rather than queueing.
- **`git add` explicit paths only.** Never `git add -A`.
- **Commit messages via file** when multi-line (`git commit -F <file>`); PowerShell mangles multi-line `-m`.
- **Every new assertion is mutation-tested.** A surviving mutant means the assertion is worthless OR the code is dead — say which.
- **Browser verification is mandatory.** `scripts/ui-smoke.js` is a BROWSER script; running it under Node exits 0 and proves nothing. This feature is entirely about how something looks.
- **Do not benchmark against the real NBA.** Tune for how it reads on screen.
- **Ignore the `assets/logos/MIA.png` 404** in browser checks; known and accepted.

## File Structure

| File | Responsibility |
| --- | --- |
| `ui/pixelImpact.js` (modify) | The qualifying bar and the freeze/zoom duration policy. Pure functions of a marker plus options — no canvas access — which is why they are asserted in Node. |
| `ui/pixelGameView.js` (modify) | Records recent ball positions and draws the trail and handler ring at the existing ball draw site. |
| `scripts/validate-impactMoments.js` (modify) | Existing speed assertions are REPLACED — they encode the behaviour being reversed. |

---

### Task 1: Invert the emphasis

**Files:**
- Modify: `ui/pixelImpact.js` (the `impactFreezeMs` and `armImpactZoom` functions, plus new constants)
- Modify: `scripts/validate-impactMoments.js:225-236` (the speed-policy block)

**Interfaces:**
- Produces: `impactQualifies(kind, speed)` → boolean; `IMPACT_FREEZE_MAX_MS` → number. Both exported.
- `impactFreezeMs(marker, opts)` keeps its signature; only its policy changes.

- [ ] **Step 1: Replace the speed-policy assertions**

In `scripts/validate-impactMoments.js`, find this block inside `checkEffectTiming` and DELETE it:

```js
  // speed policy: full at 1x and 2x, halved at 4x, nothing at 8x
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 2 }),
    impact.impactFreezeMs(poster, full), '2x keeps the full freeze');
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 4 }),
    Math.round(impact.impactFreezeMs(poster, full) / 2), '4x halves the freeze');
  assert.strictEqual(impact.impactFreezeMs(poster, { reduceMotion: false, speed: 8 }), 0,
    '8x suppresses the freeze entirely');
```

Replace it with:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/validate-impactMoments.js`
Expected: FAIL — `impact.impactQualifies is not a function`.

- [ ] **Step 3: Implement the policy**

In `ui/pixelImpact.js`, replace the whole `impactFreezeMs` function with:

```js
// Which kinds still earn a freeze at a given speed. The bar RISES with speed,
// which is the inverse of what this module used to do.
//
// Measured over 60 games: block 4.5/game, poster 2.0, ankle 1.7 — 8.3 total. At
// 8x a whole game plays in well under a minute, so freezing on all of them is a
// stutter every few seconds rather than emphasis. Blocks are simultaneously the
// most common and the least spectacular (they were already excluded from the
// camera push), so they are the first to drop out. At 8x only a poster
// qualifies: ~2 a game, which is the "rip through the possessions and stop dead
// on the dunk" experience this exists to buy.
const IMPACT_SPEED_BAR = [
  { maxSpeed: 2, kinds: ['poster', 'ankle', 'block'] },
  { maxSpeed: 4, kinds: ['poster', 'ankle'] },
  { maxSpeed: Infinity, kinds: ['poster'] }
];

function impactQualifies(kind, speed) {
  const s = typeof speed === 'number' ? speed : 1;
  for (let i = 0; i < IMPACT_SPEED_BAR.length; i++) {
    if (s <= IMPACT_SPEED_BAR[i].maxSpeed) {
      return IMPACT_SPEED_BAR[i].kinds.indexOf(kind) !== -1;
    }
  }
  return false;
}

// A freeze is real milliseconds, but at 8x each real second consumes eight times
// the game, so the same freeze buys proportionally less emphasis. It therefore
// scales UP with speed — and is capped, because past roughly a second a frozen
// game stops reading as a moment and starts reading as a hang.
//
// The cap is on the RESULT, not on the multiplier. The spec proposed capping the
// multiplier at 4, which for a 320ms base allows 1280ms — past the very line the
// cap exists to stay behind. Capping the duration directly is what the reasoning
// actually calls for.
const IMPACT_FREEZE_MAX_MS = 900;

function impactFreezeMs(marker, opts) {
  if (!marker) return 0;
  const o = opts || {};
  if (o.reduceMotion) return 0;
  const speed = typeof o.speed === 'number' ? o.speed : 1;
  if (!impactQualifies(marker.kind, speed)) return 0;
  const base = marker.kind === 'block' ? IMPACT_TIER2_FREEZE_MS : IMPACT_TIER1_FREEZE_MS;
  return Math.min(Math.round(base * speed), IMPACT_FREEZE_MAX_MS);
}
```

Then in `armImpactZoom`, replace this line:

```js
  if (o.reduceMotion || o.speed >= 8) return;
```

with:

```js
  // The 8x bail-out is gone deliberately. The camera push is what distinguishes
  // "this is a moment" from "the game froze", so it matters MORE at high speed,
  // not less. It now follows the same qualifying bar as the freeze.
  if (o.reduceMotion) return;
  if (!impactQualifies(marker.kind, typeof o.speed === 'number' ? o.speed : 1)) return;
```

Add to `module.exports`:

```js
    impactQualifies: impactQualifies,
    IMPACT_FREEZE_MAX_MS: IMPACT_FREEZE_MAX_MS,
```

- [ ] **Step 4: Run the tests**

Run: `node scripts/validate-impactMoments.js && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: every `check…: OK`, then `done` with no FAIL lines.

- [ ] **Step 5: Mutation-test the two rules separately**

They can break independently, so test them independently.

Mutation A — temporarily change the last bar row to `kinds: ['poster', 'block']`. Run `node scripts/validate-impactMoments.js`.
Expected: FAIL on `blocks are ~4.5/game and stop qualifying above 2x, or 8x stutters`. Revert.

Mutation B — temporarily change `Math.min(Math.round(base * speed), IMPACT_FREEZE_MAX_MS)` to `Math.round(base)`. Run again.
Expected: FAIL on `emphasis GROWS with speed rather than fading`. Revert.

If either survives, that assertion is worthless — say so and fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add ui/pixelImpact.js scripts/validate-impactMoments.js
git commit -m "feat: big moments stop the game hardest when the game is fastest"
```

---

### Task 2: Never lose the ball

**Files:**
- Modify: `ui/pixelGameView.js` (the ball draw site, around line 885)

**Interfaces:**
- Consumes: `speed` and `reduceMotion`, both already in scope in the render loop.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the trail buffer**

In `ui/pixelGameView.js`, next to the other per-playback render state (near `let speed = 1;` around line 207), add:

```js
  // Recent ball positions, newest last. Fixed length: the trail is a legibility
  // aid at speed, not a motion-blur effect, so it must not grow with frame rate.
  const ballTrail = [];
  const BALL_TRAIL_MAX = 10;
```

- [ ] **Step 2: Record and draw**

In `ui/pixelGameView.js`, find the ball draw site:

```js
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx) - 1, Math.round(groundY), 3, 1);
    drawBall(ctx, bx, by, holder ? undefined : ballSpin);
```

Replace it with:

```js
    // Legibility at speed. At 1x you can follow the ball unaided; at 8x it is a
    // smear, so the trail and the handler ring fade IN as speed rises rather
    // than being always-on clutter. Both sit under the ball and the sprites, so
    // they can never obscure the thing they exist to point at.
    //
    // Suppressed entirely under reduced motion, alongside the freezes and zooms
    // — a trail is exactly the kind of moving decoration that setting is for.
    if (!reduceMotion && speed > 1) {
      // 0 at 1x, 1 at 8x. Everything below scales off this one number so the
      // effect has a single intensity knob rather than three.
      const trailStrength = Math.min(1, (speed - 1) / 7);

      ballTrail.push({ x: bx, y: by });
      while (ballTrail.length > BALL_TRAIL_MAX) ballTrail.shift();

      for (let i = 0; i < ballTrail.length - 1; i++) {
        const age = (i + 1) / ballTrail.length;       // 0 oldest, 1 newest
        ctx.fillStyle = 'rgba(255,190,90,' + (0.45 * age * trailStrength).toFixed(3) + ')';
        const r = age < 0.6 ? 1 : 2;
        ctx.fillRect(Math.round(ballTrail[i].x) - (r >> 1), Math.round(ballTrail[i].y) - (r >> 1), r, r);
      }

      // A ring under whoever is holding it. Drawn on the FLOOR (groundY) rather
      // than at the ball, so it reads as "this player" and not as a second ball.
      if (holder) {
        ctx.strokeStyle = 'rgba(255,210,120,' + (0.75 * trailStrength).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(bx), Math.round(groundY) + 1, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (ballTrail.length) {
      // Dropping back to 1x (or into reduced motion) must clear the tail rather
      // than leave a frozen streak on the floor.
      ballTrail.length = 0;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx) - 1, Math.round(groundY), 3, 1);
    drawBall(ctx, bx, by, holder ? undefined : ballSpin);
```

- [ ] **Step 3: Verify nothing regressed in Node**

Run: `for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done` with no FAIL lines.

This proves only that nothing else broke. The trail itself is canvas drawing and cannot be asserted here — Task 3 is where it is actually verified.

- [ ] **Step 4: Commit**

```bash
git add ui/pixelGameView.js
git commit -m "feat: the ball leaves a trail when the game is moving fast"
```

---

### Task 3: Verify it in a browser, and calibrate by eye

**Files:** none changed unless the calibration says so.

This is the task the whole feature lives or dies on. Both changes are about how something *looks*, and no Node assertion can see either one.

- [ ] **Step 1: Serve the app**

Start the preview using the `nba-gm` launch config. Confirm the only 404 is `assets/logos/MIA.png`, which is known and accepted.

- [ ] **Step 2: Confirm the policy from the live page**

In the browser console:

```js
[1,2,4,8].map(s => ({
  speed: s,
  poster: impactFreezeMs({kind:'poster'}, {reduceMotion:false, speed:s}),
  ankle:  impactFreezeMs({kind:'ankle'},  {reduceMotion:false, speed:s}),
  block:  impactFreezeMs({kind:'block'},  {reduceMotion:false, speed:s})
}))
```

Expected: poster non-zero at every speed and capped at 900; block non-zero only at 1x and 2x; ankle zero at 8x. If the browser disagrees with Node, the script tag order is wrong — fix that before going further.

- [ ] **Step 3: Watch a game at each speed**

Start a game, open the watch view, and watch at 1x, then 4x, then 8x. Confirm by eye:

- **1x is unchanged.** No trail, no ring, freezes exactly as before this change.
- **8x: the ball is trackable.** You can follow it across the floor.
- **8x: a poster stops the game and reads.** The camera pushes in, the freeze holds long enough to see what happened, and play resumes without feeling like it hung.
- **8x: a block does NOT interrupt.** Swats still flash, but the game does not stop.
- Take a screenshot at 8x mid-possession showing the trail, and one during a poster freeze.

- [ ] **Step 4: Confirm reduced motion suppresses all of it**

Enable reduced motion and watch at 8x. Expected: no trail, no ring, no freeze, no zoom. If any survives, it is an accessibility bug, not a polish item — fix before committing.

- [ ] **Step 5: Calibrate if it does not read**

Only three numbers are in play, and each has one job:

- `IMPACT_FREEZE_MAX_MS` (900) — raise if an 8x poster is over before you see it; lower if it feels like a hang.
- `BALL_TRAIL_MAX` (10) — raise if the ball is still hard to follow at 8x; lower if the trail reads as clutter. **Shorten it rather than fading it**, since fading defeats the purpose at exactly the speed it is needed.
- The ring's alpha multiplier (0.75) — raise if the handler does not pop.

Change one at a time and re-watch. Record what moved and why in the commit message.

- [ ] **Step 6: Full suite and fresh-clone verify**

Run: `git status --short && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: clean tree, `done`, no FAIL lines.

Then: `git clone . "$TEMP/nba-verify" && cd "$TEMP/nba-verify" && for f in scripts/validate-*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done; echo done`
Expected: `done`. This catches anything that works only because of untracked local state.

- [ ] **Step 7: Report**

State plainly: what was verified by eye at which speeds, any calibration that moved and why, the suite result, the fresh-clone result, and anything left unfixed. Do not report completion with known-failing checks, and do not describe the visual result as verified unless it was actually watched.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task: the inverted freeze and the qualifying bar → Task 1; the camera push at 8x → Task 1 Step 3; the ball trail and handler ring → Task 2; reduced motion suppressing everything → Task 2 Step 2 plus Task 3 Step 4; replacing rather than deleting the old assertions → Task 1 Step 1; browser verification → Task 3.

**2. Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries the actual code. Task 3's calibration deliberately does not name final values — that is the point of the task, and it states exactly which three constants may move and in which direction.

**3. Type consistency.** `impactQualifies(kind, speed)` is defined in Task 1 Step 3 and used with that exact signature in Task 1 Step 1's assertions, in `armImpactZoom`, and in Task 3's console check. `IMPACT_FREEZE_MAX_MS` is defined and exported in Step 3 and asserted in Step 1. `trailStrength`, `ballTrail` and `BALL_TRAIL_MAX` are defined in Task 2 Step 1 and used only in Task 2 Step 2.

**One correction found during review, carried into the plan:** the spec specified the freeze as `base × min(speed, 4)`, capping the *multiplier*. For a 320ms base that permits 1280ms — past the one-second line the cap exists to stay behind, so the spec contradicted its own reasoning. The plan caps the *duration* at 900ms instead, which is what the reasoning actually calls for.

**One dependency worth stating:** Task 2 assumes `reduceMotion`, `speed`, `bx`, `by`, `groundY` and `holder` are all in scope at the ball draw site. They are — verified against the current file. If a future refactor moves that block, the trail moves with it.
