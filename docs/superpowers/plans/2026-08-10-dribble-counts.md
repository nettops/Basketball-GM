# Dribble Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Inline execution only — this project does not use subagent-driven development.

**Goal:** Replace the named-move vocabulary with a rolled dribble count that drives the choreography, landing on 50% / 25% / 15% / 10% for 0 / 2 / 4-6 / 7+ dribbles.

**Architecture:** One pure function rolls a count per eligible on-ball possession. The count generates the beats procedurally — one beat per dribble — instead of three hand-written move variants. The count is stamped on the first beat as a `handle` marker so it can be measured independently.

**Tech Stack:** Vanilla ES5-style JS, zero dependencies, dual `require`/browser-global module pattern.

## Global Constraints

- Zero dependencies. Dual export: `module.exports` plus browser globals at file end.
- `git add` explicit paths — never `git add -A`.
- `git commit -F <file>` — PowerShell mangles multi-line `-m`.
- Every new assertion is mutation-tested. A surviving mutant means the assertion is worthless OR the code is dead — the finding must say which.
- Calibrate by measured rate, never by picked values. Record the sweep in the commit message.
- Never widen a bound to make a change pass — move the value, not the bound.
- Optimize for fun. Do NOT benchmark against real NBA numbers.
- `scripts/ui-smoke.js` is a BROWSER script. Running it under Node exits 0 and proves nothing.

## Control (measured before any change, `GAMES=40 node scripts/probe-dribbles.js`)

| | value |
| --- | --- |
| eligible on-ball possessions | 82.5 / game |
| timeline duration | 732.4 s / game at 1x |
| beats | 2580 / game |
| old isolations | 15.85 / game = **19.2%** of eligible |

19.2% against a `% 5 === 0` gate confirms the probe's eligibility walk agrees with the choreographer's, having been written independently of it.

## Expected cost

Beat budget per bucket, at `BEAT.isoSize` = 240ms per dribble:

| bucket | beats | ms |
| --- | --- | --- |
| 0 | none | 0 |
| 2 | 2 dribbles | 480 |
| 4-6 (mean 5) | clear 400 + 5x240 + attack 280 | 1880 |
| 7+ (mean 7.5) | clear 400 + 7.5x240 + attack 280 | 2480 |

Expected added time = 20.6x480 + 12.4x1880 + 8.25x2480 - 15.85x1200 (the old iso cost, already in the baseline) = **+34.6 s/game, +4.7%**. If the measured inflation exceeds 10%, shorten the per-dribble beat rather than cutting the long buckets — the long buckets are the point.

---

### Task 1: The roll

**Files:**
- Modify: `ui/pixelChoreographer.js` (module scope, near `cutJitter` at :124; exports at file end)
- Test: `scripts/validate-pixel-choreographer.js`

**Interfaces:**
- Produces: `roll01(seed) -> number in [0,1)`, `dribbleCount(seed, handleSkill) -> integer >= 0`, `DRIBBLE_TABLE`. All exported.

- [ ] **Step 1: Write the failing assertions**

Append to `scripts/validate-pixel-choreographer.js`:

```js
function checkDribbleRoll() {
  // roll01 must be equidistributed. Everything else in the choreographer picks
  // with modular arithmetic -- `(pi * 7 + ei) % 5` -- which is fine for a coin
  // flip but cannot express 50/25/15/10, and a modulus that happens to land on
  // the right shares for one seed sequence silently correlates with every other
  // modulus in the file.
  const decile = new Array(10).fill(0);
  for (let s = 0; s < 20000; s++) {
    const r = choreo.roll01(s);
    assert.ok(r >= 0 && r < 1, 'roll01 stays in [0,1)');
    decile[Math.floor(r * 10)] += 1;
  }
  decile.forEach(function (n, i) {
    assert.ok(n > 1700 && n < 2300, 'decile ' + i + ' near even, got ' + n);
  });

  // League-wide shape at the mean skill.
  const seen = { '0': 0, '2': 0, '4-6': 0, '7+': 0 };
  for (let s = 0; s < 20000; s++) {
    const n = choreo.dribbleCount(s, 50);
    assert.ok(n >= 0 && n <= 8 && n !== 1 && n !== 3, 'count is 0, 2, 4-6 or 7-8, got ' + n);
    seen[n === 0 ? '0' : n === 2 ? '2' : n <= 6 ? '4-6' : '7+'] += 1;
  }
  const pct = function (k) { return (seen[k] / 20000) * 100; };
  assert.ok(Math.abs(pct('0') - 50) < 2, '0 dribbles near 50%, got ' + pct('0').toFixed(1));
  assert.ok(Math.abs(pct('2') - 25) < 2, '2 dribbles near 25%, got ' + pct('2').toFixed(1));
  assert.ok(Math.abs(pct('4-6') - 15) < 2, '4-6 near 15%, got ' + pct('4-6').toFixed(1));
  assert.ok(Math.abs(pct('7+') - 10) < 2, '7+ near 10%, got ' + pct('7+').toFixed(1));

  // Skill biases the DISTRIBUTION, not which moves are unlocked. The 88a0ee3
  // failure was a cliff: ballHandling 79 got a crossover and 80 got a double
  // move. A great handler should hold the ball longer MORE OFTEN, not hold it
  // longer every single time.
  let eliteLong = 0, poorLong = 0;
  for (let s = 0; s < 20000; s++) {
    if (choreo.dribbleCount(s, 95) >= 4) eliteLong += 1;
    if (choreo.dribbleCount(s, 40) >= 4) poorLong += 1;
  }
  assert.ok(eliteLong > poorLong * 1.4, 'elite handlers work longer more often');
  assert.ok(poorLong > 20000 * 0.05, 'a poor handler still sometimes works, got ' + poorLong);
  console.log('checkDribbleRoll: OK');
}
checkDribbleRoll();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: FAIL — `choreo.roll01 is not a function`

- [ ] **Step 3: Implement**

In `ui/pixelChoreographer.js`, after `cutJitter` (:126):

```js
// A roll in [0,1) from an integer seed.
function roll01(seed) {
  let x = ((seed | 0) * 1103515245 + 12345) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = (Math.imul(x, 2246822519) ^ (x >>> 13)) >>> 0;
  return (x >>> 8) / 16777216;
}

// How long a man holds the ball, which is what a viewer actually reads, rather
// than which named move he reaches for. 88a0ee3 gated three moves behind
// ball-handling thresholds and 83% of them came out as the same crossover
// default -- two new moves accounting for one possession in six. Rolling the
// COUNT and letting the move follow from it cannot produce that failure,
// because the shares are the thing being picked.
const DRIBBLE_TABLE = [
  { share: 0.50, counts: [0] },
  { share: 0.25, counts: [2] },
  { share: 0.15, counts: [4, 5, 6] },
  { share: 0.10, counts: [7, 8] }
];
// Skill shifts the roll toward the longer buckets. Deliberately gentle: at
// DRIBBLE_SKILL_SHIFT = 0.12 a 95-rated handler moves the roll +0.108 and a
// 40-rated one -0.024, so the elite guard works long about twice as often as
// the poor one without EVER being locked out of a simple catch and shoot.
const DRIBBLE_SKILL_SHIFT = 0.12;

function dribbleCount(seed, handleSkill) {
  const h = typeof handleSkill === 'number' ? handleSkill : 50;
  const r = roll01(seed) + ((h - 50) / 50) * DRIBBLE_SKILL_SHIFT;
  const clamped = r < 0 ? 0 : (r >= 1 ? 0.999999 : r);
  let acc = 0;
  for (let i = 0; i < DRIBBLE_TABLE.length; i++) {
    acc += DRIBBLE_TABLE[i].share;
    if (clamped < acc) {
      const counts = DRIBBLE_TABLE[i].counts;
      // second, independent roll picks WITHIN the bucket, so 4/5/6 are not
      // determined by how close the first roll sat to the bucket edge
      return counts[Math.floor(roll01(seed * 31 + 7) * counts.length)];
    }
  }
  return DRIBBLE_TABLE[DRIBBLE_TABLE.length - 1].counts[0];
}
```

Add `roll01`, `dribbleCount`, `DRIBBLE_TABLE` to `module.exports` and to the browser globals block.

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/validate-pixel-choreographer.js`
Expected: PASS, including `checkDribbleRoll: OK`

The skill shift is NOT rate-neutral — shot attempts are weighted toward good handlers, so the league-wide realised shape will drift off 50/25/15/10. Task 4 measures the drift and moves `DRIBBLE_TABLE` shares to absorb it. Do not adjust the shares here.

- [ ] **Step 5: Mutation-test the new assertions**

Four mutants, each reverted immediately:
1. `DRIBBLE_TABLE[0].share` 0.50 -> 0.60 — the 0-dribble assertion must fail.
2. `DRIBBLE_SKILL_SHIFT` 0.12 -> 0 — `eliteLong > poorLong * 1.4` must fail.
3. `DRIBBLE_SKILL_SHIFT` 0.12 -> 0.9 — `poorLong > 5%` must fail (the cliff this replaces).
4. `roll01` returns `((seed * 7) % 100) / 100` — the decile assertion must fail.

Record each result. A surviving mutant means the assertion is worthless OR the code is dead — say which.

- [ ] **Step 6: Commit**

```bash
git add ui/pixelChoreographer.js scripts/validate-pixel-choreographer.js
git commit -F .git/COMMIT_BODY
```

---

### Task 2: The count drives the beats

**Files:**
- Modify: `ui/pixelChoreographer.js:915-916` (the `isoPlay` gate), `:988-1066` (the iso block), `:1105-1112` (hoist the impact classification)

**Interfaces:**
- Consumes: `dribbleCount` from Task 1.
- Produces: a `handle` marker `{ n, move }` on the first beat of every dribble string. `move` is one of `'putdown' | 'cross' | 'behind' | 'double'`.

- [ ] **Step 1: Hoist the impact classification above the iso block**

`classifyImpact` is pure — it reads only `ev` and the two players — so computing it earlier changes nothing. It has to move because an ankle-breaker is a statement that the man DRIBBLED, and the count has to know that before it picks.

Move these three lines from :1108 to immediately before the `isoPlay` computation at :915, and delete them from their old position:

```js
const shooterPlayer = playerById[ev.playerId];
const dunking = ev.zone === 'inside' && isDunker(shooterPlayer);
const impactKind = ev.made ? classifyImpact(ev, shooterPlayer, playerById[ev.defenderId]) : null;
```

- [ ] **Step 2: Replace the gate with the roll**

Replace :915-916:

```js
const isoPlay = shooterOn && ev.defenderId && shotPos[ev.defenderId] &&
  ev.zone !== 'inside' && (pi * 7 + ei) % 5 === 0;
```

with:

```js
// Eligibility is unchanged -- someone working on the ball against a defender,
// outside. What changed is that eligibility no longer decides: it only earns
// a roll. The old `% 5 === 0` made every fifth eligible possession an
// isolation and the other four identical.
const onBall = shooterOn && ev.defenderId && shotPos[ev.defenderId] && ev.zone !== 'inside';
const handleSkill = (onBall && playerById[ev.playerId] && playerById[ev.playerId].attributes)
  ? playerById[ev.playerId].attributes.ballHandling : 50;
let dribbles = onBall ? dribbleCount(pi * 101 + ei, handleSkill) : 0;
// The sim already said this shot came out of a breakdown. A man cannot break
// his defender down without putting the ball on the floor, so an ankle-breaker
// FORCES the count up rather than the count silently contradicting it.
if (onBall && impactKind === 'ankle' && dribbles < 4) dribbles = 4;
const isoPlay = dribbles > 0;
```

- [ ] **Step 3: Replace the three hand-written variants with a procedural string**

Replace the move-selection block at :1032-1059 (from the `handleSkill` const through the closing brace of the `else`) with:

```js
// One beat per dribble, so the marker is not a claim the beats fail to back
// up. The string alternates sides with a decaying amplitude and creeps toward
// the rim; which SHAPE it is falls out of the count.
const moveKind = dribbles <= 2 ? 'putdown'
  : dribbles >= 7 ? 'double'
    : (roll01(pi * 17 + ei) < 0.5 ? 'cross' : 'behind');
tagHandle({ n: dribbles, move: moveKind });

let back = clear;
for (let d = 0; d < dribbles; d++) {
  const side = (d % 2) ? -1 : 1;
  // the double move's signature is that the LAST pair is the biggest, after
  // the defender has already committed to three smaller ones
  const late = (moveKind === 'double' && d >= dribbles - 2);
  const amp = (moveKind === 'putdown' ? 5 : 11 - (d % 3) * 2) + (late ? 4 : 0);
  const rim = 2 + (d % 3) * 2;
  // behind the back: the BALL takes the long way round a handler whose
  // shoulders stay square, which is the only thing that reads at this size
  const ballLat = (moveKind === 'behind' && (d % 2) === 1) ? -12 : 0;
  back = probe(side * amp, rim, d + 1, ballLat);
}
```

Delete the now-unused `moveRoll` and the old `handleSkill` const inside the iso block (it moved to Step 2).

- [ ] **Step 4: Clear out only for the long buckets**

A put-down is not an isolation — nobody clears the side for two dribbles. Wrap the clear-out at :998-1006 so it only runs for `dribbles >= 4`, and let `clear` fall back to `shotPos` otherwise:

```js
let clear = shotPos;
if (dribbles >= 4) {
  clear = Object.assign({}, shotPos);
  five[poss.team].forEach(function (p) {
    if (p.id === me || !clear[p.id]) return;
    clear[p.id] = clampToCourt(clear[p.id][0] - lx * dir * 20, clear[p.id][1] - ly * dir * 20);
  });
  push(BEAT.isoClear, clear, { x: sp[0], y: sp[1], holder: me },
    period, quarter, clock, '',
    (pi % 3 === 0) ? fillT(COMMENT.bringUp, pi + ei, { h: ln(me), team: teamNames[poss.team] }) : '');
}
```

Note `tagHandle` in Step 3 runs AFTER the clear-out push when there is one, so the marker lands on the first size-up beat either way — one marker per string, which is what the probe counts.

- [ ] **Step 5: Add `tagHandle`**

Immediately after the `push` function (:609), inside the same closure:

```js
// Stamp the dribble count on the beat just pushed. Kept off `push`'s argument
// list, which is already thirteen positional parameters and where a fourteenth
// would be a bug waiting to happen.
function tagHandle(meta) {
  if (keyframes.length) keyframes[keyframes.length - 1].handle = meta;
}
```

Because `tagHandle` marks the LAST pushed keyframe, call it after the first `probe` rather than before the loop. Adjust Step 3 accordingly: move the `tagHandle` call to just inside the loop under `if (d === 0)`.

- [ ] **Step 6: Verify nothing regressed**

Run: `node scripts/validate-pixel-choreographer.js && node scripts/validate-pixel-events.js && node scripts/validate-liveWatch.js`
Expected: all PASS. The incremental and whole-game paths must still produce identical timelines — that assertion already exists and must not be touched.

- [ ] **Step 7: Commit**

```bash
git add ui/pixelChoreographer.js
git commit -F .git/COMMIT_BODY
```

---

### Task 3: The probe reads the marker

**Files:**
- Already created: `scripts/probe-dribbles.js`

- [ ] **Step 1: Run it**

Run: `GAMES=40 node scripts/probe-dribbles.js`
Expected: non-zero counts in all four buckets, and `moves` showing putdown / cross / behind / double.

- [ ] **Step 2: Sanity-check against the control**

The eligible count must still read 82.5/game — the roll changed what happens on those possessions, not which ones qualify. If the denominator moved, eligibility was changed by accident. Stop and find out why.

- [ ] **Step 3: Commit the probe**

```bash
git add scripts/probe-dribbles.js
git commit -F .git/COMMIT_BODY
```

---

### Task 4: Calibrate to the measured rate

**Files:**
- Modify: `ui/pixelChoreographer.js` (`DRIBBLE_TABLE` shares only)

The skill shift is not rate-neutral: shots are weighted toward good handlers, so the realised league-wide shape will sit long of 50/25/15/10. The table shares are the correction, and they are set from measurement rather than picked.

- [ ] **Step 1: Record the realised shape from Task 3**

- [ ] **Step 2: Sweep the shares**

For each candidate table, run `GAMES=40 node scripts/probe-dribbles.js` and record the realised shares. Move only the shares, never the target — the target is what the owner asked for.

- [ ] **Step 3: Accept when every bucket is within 2 points of target**

If a bucket cannot be brought inside 2 points by moving shares alone, the skill shift is too strong. Reduce `DRIBBLE_SKILL_SHIFT` and re-sweep. Do NOT widen the acceptance band.

- [ ] **Step 4: Check the cost**

Compare `timeline s/game` to the control's 732.4s. Over +10% (805s), shorten the per-dribble beat — do not cut the long buckets.

- [ ] **Step 5: Commit with the full sweep table in the message**

```bash
git add ui/pixelChoreographer.js
git commit -F .git/COMMIT_BODY
```

---

### Task 5: Browser verification

Mandatory and cannot be done from Node. `scripts/ui-smoke.js` is a BROWSER script — running it under Node exits 0 and proves nothing.

- [ ] **Step 1: Serve on a fresh port, no-store**

A stale-JS pin has bitten this project before. Start the dev server on a port not used earlier in the session.

- [ ] **Step 2: Watch a game and confirm each bucket reads**

Confirm by eye, at 1x:
- a 0-dribble possession is a clean catch and shoot with no size-up
- a 2-dribble put-down does NOT clear the side out
- a 4-6 string reads as a crossover or a behind-the-back, and the two look different from each other
- a 7+ double move reads as a bigger second move after the defender has committed

- [ ] **Step 3: Screenshot each of the four for the owner**

The owner asked to SEE the moves before sign-off. Screenshots from the game's own renderer, not a mockup — the real sprites are the thing being judged.

- [ ] **Step 4: Confirm no console errors**

The `assets/logos/MIA.png` 404 is known and accepted — it is expected output, not a finding.

---

### Task 6: Whole-suite verification

- [ ] **Step 1: Run all 46 validators**
- [ ] **Step 2: Verify from a fresh clone** so the result does not depend on untracked local state
- [ ] **Step 3: Update the design note's status to implemented, with the realised distribution recorded**
