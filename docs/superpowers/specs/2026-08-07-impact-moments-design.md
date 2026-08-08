# Impact Moments — Design

**Date:** 2026-08-07
**Status:** Approved

## Summary

Give the watched game three highlight moments — **posters**, **ankle breakers** and **blocks** — a comic-panel visual treatment: a snap zoom, a white flash, radial speed lines, a freeze and a shake. Blocks get a shorter version; posters and ankle breakers get the full one. Nothing changes in the possession engine, the save format, or the recorded event log.

## The problem

From the project owner: *"i was thinking more about blocks, posterizers, impact frames"*, then *"i want to add ankle breakers also"*.

The watched game currently punctuates every made shot identically: a 120ms freeze (`hitchMs`), a net splash, a rim shake, and screen shake for anything in `BIG_PLAY_LABELS`. Two consequences:

- **Everything is equally loud, so nothing reads as a highlight.** A routine layup and a thunderous dunk get the same 120ms.
- **A block gets *less* punctuation than a layup.** Blocks fire screen shake and a sound, but the freeze only triggers on `MAKE_LABELS`, and a block is not a make. The single most exciting defensive play in basketball is the one play the view refuses to stop for.

There is also no concept of a play happening *to* someone. A dunk is a dunk whether or not anyone contested it, so the view cannot tell a poster from an uncontested breakaway.

## What the data already supports

Measured against the possession engine:

| Event | Per game | Sample |
|---|---|---|
| Blocks | 4.01 | 200 games, 5 matchups |
| Made inside shots | 31.3 | 40 games, `BOS`/`ATL` |
| Made inside by a dunker (`isDunker`) | 18.1 | 40 games, `BOS`/`ATL` |
| Made threes | 22.6 | 40 games, `BOS`/`ATL` |

The block rate is sampled across five matchups because it is the one figure the design depends on quantitatively — single-matchup samples of it ranged 4.2 to 4.7, and the broader sample settles at 4.01. The shot-mix rows are single-matchup and are context only; nothing in this design is tuned to them.

Critically, **every `shot` event already carries `defenderId`** — the contesting defender, chosen in `simEnginePossession.js` before the make/miss roll. `block` events carry both the shooter and the blocker. And the attribute set includes `ballHandling`, `acceleration`, `speed`, `vertical`, `insideScoring`, `perimeterDefense` and `interiorDefense`.

So all three moments are derivable in the presentation layer with **no engine change** — which also means no golden-master fixture churn and no save-format change.

## Decisions

| Question | Decision |
|---|---|
| How often should the big treatment fire? | Rare peaks only — the loud treatment is reserved for genuine highlights. |
| How do three types share that budget? | Two tiers. Blocks (~4/game, unfilterable) get a short punch. Posters and ankle breakers get the full comic panel, tuned to ~3.5/game combined. |
| What does the treatment consist of? | Comic panel: snap zoom, white flash, radial speed lines, freeze, shake. |
| Does it fire for the opponent too? | Yes, identical treatment. The crowd carries the emotion — the arena already reacts differently for home and away. |

Rejected: a silhouette treatment (two ~20px sprites read as mush at this resolution), and a per-game ranking system (requires lookahead, which fights live playback since the future is not yet simulated).

## Architecture

Three separable pieces. Detection is structured data, never a display string — `ui/pixelGameView.js` already matches on label text via `BIG_PLAY_LABELS.indexOf(fr.a.text)`, and this codebase has twice been bitten by logic keyed to human-readable strings.

### 1. `ui/pixelChoreographer.js` — detection

In the existing `block` branch and the made-inside/made-outside paths of the `shot` branch, attach a marker to the keyframe already being pushed. No new beats, no timeline restructuring.

```js
impact: { kind: 'poster' | 'ankle' | 'block', at: { x, y }, byId, onId }
```

`byId` is the player who did it, `onId` the player it was done to. `at` is the impact point in stage coordinates, used as the zoom origin and the radial-line centre.

### 2. `ui/pixelImpact.js` — the effect (new file)

Owns all presentation: freeze duration, flash, radial lines, zoom factor, shake amount. Split into its own file for the same reason `ui/pixelAudio.js` and `ui/pixelHud.js` were split out — `ui/pixelGameView.js` is already ~1000 lines and this is a self-contained visual concern.

```js
startImpact(marker, nowMs, opts)   // opts: { reduceMotion, speed }
drawImpact(ctx, nowMs)             // draws flash + radial lines
impactZoom(nowMs)                  // → { scale, cx, cy } or null
impactFreezeMs(marker, opts)       // → freeze duration for hitchMs
```

### 3. `ui/pixelGameView.js` — wiring

Where the view currently inspects `MAKE_LABELS` to fire the 120ms hitch, it also reads `fr.a.impact` and hands it to the impact module.

**Data flow:** possession engine (unchanged) → choreographer attaches marker → keyframe → view reads the field it is already inspecting → impact module draws.

## Triggers

### Tier 1 — full comic panel

**Poster.** `type === 'shot'`, `made`, `zone === 'inside'`, shooter passes the existing `isDunker()`, and:

```
posterEdge = (vertical × 2 + insideScoring) / 3  −  defender.interiorDefense
```

Reusing `isDunker()` rather than inventing a second notion of "can this player dunk" matters: the label on these shots already reads *"Slams it home!"*, so effect and words agree by construction.

**Ankle breaker.** `type === 'shot'`, `made`, `zone === 'mid' || zone === 'three'`, and:

```
handleEdge = (ballHandling × 2 + acceleration + speed) / 4  −  defender.perimeterDefense
```

Restricting ankle breakers to mid/three keeps the two **disjoint by construction**: inside makes are posters, outside makes are ankle breakers, and no event can be both. There is no precedence rule to get wrong.

### Tier 2 — short punch

Every `type === 'block'`. Flash and shake, freeze stays at today's 120ms, no zoom, no radial lines. Blocks are ~4/game and that number is fixed — they are a real event, not a derived judgement, so no threshold shrinks them. Acknowledging every swat without stopping the game four times is what keeps the top tier rare.

### Thresholds are calibrated by rate, not picked by hand

The two cutoffs must **not** be absolute numbers chosen off raw ratings. `DUNK_LIFT_THRESHOLD` in `ui/pixelChoreographer.js` carries the scar from exactly that mistake:

> *"an absolute cutoff picked off raw rating numbers marked ~95% of them as dunkers (30 dunks to 1 layup in a test game). 82 sits near the pool's 65th percentile"*

Every player in this pool is elite, so a "high vertical" cutoff selects nearly everyone.

Therefore:

- Calibrate against **all** league shooter/defender pairings, not one matchup.
- Target **~2 posters and ~1.5 ankle breakers per game**.
- Ship `scripts/validate-impactMoments.js` asserting the observed rate stays within **0.5–4 per game per type** across N simulated games.

The rate band is what makes this survive the league aging. Progression moves ratings every season; a constant that is correct in 2026 could fire on every possession by 2034. A band catches that drift, a hardcoded number rots silently.

Exploratory measurements (single `BOS`/`ATL` matchup, ~10 distinct pairings, so **not** final calibration):

| Threshold | poster/gm | ankle/gm |
|---|---|---|
| 15 | 4.78 | 5.58 |
| 20 | 3.23 | 1.57 |
| 22 | 3.23 | 0.57 |
| 25 | 0.78 | 0.05 |

The repeated values (3.23 at both 20 and 22) are a small-sample artifact and are the reason final thresholds are an implementation task backed by the validator, not a number written into this spec.

## The effect

Tier 1 fires in order: snap zoom in → white flash (1–2 frames) → radial lines from `at`, held through the freeze → shake on release → snap back.

**The zoom snaps rather than tweens.** An eased zoom on a 480×270 canvas with `imageSmoothingEnabled = false` lands sprite edges on fractional pixels every frame, producing the same shimmer the display already suffers from its 1.285× upscale. Snapping to 2×, holding, then snapping back is truer to pixel art, free of that artifact, and reads as a harder cut.

**Reuse `hitchMs`; do not add a second timer.** It already freezes the whole scene for makes and quarter cards and already composes via `Math.max`. A poster *is* a made shot, so both paths fire on the same frame — `Math.max` means the longer freeze wins instead of two clocks disagreeing.

**Layering.** Drawn inside the existing shake transform, after sprites, before the in-canvas scoreboard. The view already separates these — the scoreboard is explicitly *"drawn unshaken in the same pixel grid"* — so this follows an existing seam rather than cutting a new one. The score and clock never zoom.

## Degradation

**Playback speed.** Concretely:

| Speed | Tier 1 | Tier 2 (blocks) |
|---|---|---|
| 1×, 2× | Full effect, full freeze | Flash + shake, 120ms |
| 4× | Zoom and flash, freeze halved | Flash only, no freeze |
| 8× | Nothing | Nothing |

This mirrors the rule already in the view, where one-shot audio drops above 4× because *"the beats blur together into a machine-gun rattle"*. Freezing eight times a game while the user is explicitly fast-forwarding fights what they asked for. Freeze durations are in `ui/pixelImpact.js` as named constants so the halving is one number, not a scattered condition.

**Reduced motion removes motion, not information.** Under `prefers-reduced-motion` there is no zoom, flash, shake or extended freeze — but the caption and commentary still name what happened. The player learns their star was just posterised; they are not hit with it.

## Known limitations

Stated rather than hidden, because both are consequences of deriving presentation from a sim that does not model these events:

- **A missed ankle breaker never fires.** Detection keys off shot events, so the move only registers if the shot drops. Celebrating a brick would read as a bug, so this is the right trade — but the effect under-reports what a viewer would call an ankle breaker.
- **The formulas are inventions.** The engine models neither a crossover nor a contest at the rim; a narrative is being inferred from a rating differential. This is already true of `isDunker()`, so it is consistent with the existing design — but it means the thresholds need feel-tuning against real playback, not only rate-tuning against a table.

## Testing

**`scripts/validate-impactMoments.js` (Node).** The edge formulas and the classifier are pure functions of two players and an event, so they test directly against fixture players:

- Each formula returns the expected sign for a lopsided pairing and for its inverse.
- **Disjointness:** no event classifies as both poster and ankle breaker.
- A block always classifies as tier 2, regardless of ratings.
- **Rate band:** across N simulated games, posters and ankle breakers each land within 0.5–4 per game.

**`ui-smoke` gains an `impact` group (browser).**

- A keyframe carrying a marker starts the effect; one without it does not.
- Reduced motion suppresses zoom, flash and shake but preserves the caption.
- Nothing fires above 4×.
- The scoreboard's on-screen position is unchanged during a zoom — the assertion that catches the layering being done wrong.

**Visual verification** is a screenshot captured during the freeze. The hold is long enough to capture reliably, so "does this actually look like a poster" is checked with an image rather than a passing boolean.

## Out of scope

- A general camera that follows play. Measured separately: only ~25% of the court is in use at any moment, so a tracking camera is the larger visual win — but it is its own design, and the snap zoom here is deliberately momentary rather than a camera system.
- Fixing the 1.285× fractional display upscale that softens all pixel art. Related, cheap, and worth doing — but independent of this feature.
- New engine events. Nothing here requires the possession engine to model a crossover or a contest.
