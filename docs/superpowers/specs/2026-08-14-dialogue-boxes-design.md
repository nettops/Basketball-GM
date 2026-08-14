# Ace Attorney-Style Dialogue Boxes — Design

**Date:** 2026-08-14

## Goal

Give the game a dialogue-box presentation layer — pixel bust, name plate,
typewriter text, choices with consequences — and prove it on two moments: a
halftime exchange during a watched game, and a post-game interview.

The engine is the deliverable. Halftime and post-game are the first two
customers; free agency pitches, coach meetings and trade talks should cost
nothing but scene data afterwards.

## The problem this has to solve

There is no dialogue presentation in the game today, and the two moments pull
in opposite directions:

- **Post-game** happens between views. It could render into `#view-content`
  like `championshipScene.js` and every other scene in `ui/`.
- **Halftime** happens *inside* the live pixel game view, on top of a canvas
  that is mid-playback, with its own speed control, pause state and
  `prefers-reduced-motion` handling.

Rendering into `#view-content` — the existing convention — would force halftime
to tear down or hide the live canvas and its playback state. The two moments
would then be two implementations, which defeats the point of building an
engine.

A DOM overlay is the only form that renders over a canvas *and* over a normal
view. So the engine is DOM, and the bust alone is canvas.

Two smaller constraints fall out of what already exists:

- `narrativeSystem.js` has archetype dialogue pools (`agent_aggressive`,
  `coach_demanding`, `gm_shrewd`, `media_standard`) that nothing renders. They
  are generic by nature — a reporter who says the same ten things after a
  40-point blowout gets skipped within a season — but they are exactly right
  as a fallback when no situational scene matches.
- `drawPlayerSprite` has **no face**. The head is a 4x5 skin rect with a 6x3
  hair block on top (pixelSprites.js:239). Scaled to portrait size that is a
  featureless block, so a bust renderer is new work, not a scaling parameter.

## Decisions taken

- **Engine first, both moments.** One implementation serves halftime and
  post-game.
- **DOM overlay, canvas bust.** The box, text and choices are DOM; the portrait
  is a `<canvas>` the engine owns and repaints.
- **Procedural pixel busts.** Derived from each player's existing generated
  face data, so every player and reporter in the league is covered with no hand
  art.
- **Role-aware.** The same engine asks the GM about the rotation and the
  player-career player about his own line, with different consequence targets.
- **Fact-driven with a generic fallback.** Scenes are condition-gated against
  real game state and interpolate real values; if nothing matches, fall back to
  the `media_standard` pool so a scene never comes up empty.
- **Mixed stakes.** Some choices carry consequences, some are pure flavor
  (`effect: null`), and they look identical to the player.
- **A GM reputation stat is added.** See "Reputation" below.

## Non-goals

- No dialogue trees. A scene is a linear run of lines ending in one choice
  list; branching is out of scope.
- No voice, no portraits beyond the four emotions, no animated bust poses
  beyond a slide-in and idle bob.
- No scene authoring UI. Scenes are data in a source file.
- No new consequence systems beyond the reputation stat described below.
  Effects otherwise land on morale, the GM chronicle, and the player-career
  decision log, all of which already exist.

## Components

Four new files, plus two thin hooks in existing ones. Each file is
understandable without reading the others.

### `ui/pixelBust.js` — the art

```
drawPixelBust(ctx, colors, emotion, opts)
```

Draws a shoulders-up figure on a `BUST = { w: 32, h: 40 }` logical grid,
integer-scaled the way `spriteCardScale` already does it
(pixelSprites.js:288). A fractional scale gives some pixels two screen pixels
and their neighbours three, which at this size reads as a rendering bug rather
than as pixel art — the same reasoning that governs the table sprites.

Colors come from the existing `spriteColorsForPlayer`, so a bust and that
player's table sprite always agree on skin, hair and jersey. A missing player
or team falls back to `SPRITE_CARD_NO_TEAM` (pixelSprites.js:282).

Emotion is a lookup into two small tables — `BROW[emotion]` and
`MOUTH[emotion]` — each a short list of rects. Everything else (head shape,
hair, nose, jersey, trim) is identity and never varies with emotion. The four
emotions are `neutral`, `confident`, `angry`, `shaken`. Adding a fifth is two
array entries, not a new drawing path.

This module does **not** join the `startPlayerSpriteAutoPaint` MutationObserver.
That observer is deliberately idempotent — it skips an already-painted canvas
(pixelSprites.js:344) — which is exactly wrong for a portrait that must repaint
when the emotion changes. The dialogue engine owns its bust canvas and repaints
it directly.

### `ui/dialogueBox.js` — the engine

```
runDialogue(scene, ctx, onDone)
```

Builds a fixed overlay, walks the scene's lines, presents the choice list, and
calls `onDone(result)` when dismissed. Owns the name plate, the typewriter, the
bust slot, the choice list, advance-on-click/Space, and Esc-to-skip.

`result` is `{ sceneId, choiceIndex, skipped }` — `choiceIndex` is `null` when
`skipped` is true. The hook, not the engine, decides what to do with it; the
engine never touches game state.

Knows nothing about basketball. Its entire input is a scene object and a
context object.

`z-index: 9600` — above `.quit-confirm`'s 9500 (style.css:1307) — and the layer
beneath takes `pointer-events: none` while the box is up, so a click cannot
reach the sim controls underneath.

### `dialogueScenes.js` — the data

Scene definitions. No DOM, no game imports, loadable in node.

### `dialogueContext.js` — the adapter

Turns a finished `GameSim` and `GameState` into the flat fact object scenes
read. This is the one place that knows both worlds, which is what keeps the
other three files honest.

### Hooks

- **Post-game:** in the `onFinish` callbacks passed to `setLiveWatchSession`
  (ui/simControls.js:392 and :483).
- **Halftime:** at the period-change branch that already pauses playback for
  the quarter-break card (ui/pixelGameView.js:538).

Both hooks do the same three things: build a context, ask for a scene, run it.

## Scene shape

```js
{
  id: 'blown-fourth-lead',
  moment: 'postgame',          // or 'halftime'
  roles: ['gm', 'player'],
  priority: 60,
  when: (c) => c.userLost && c.leadBlown >= 8,
  speaker: { kind: 'reporter' },
  lines: [
    { emotion: 'neutral', text: 'Up {leadBlown} going into the fourth.' },
    { emotion: 'angry',   text: 'You lose by {margin}. What happened to {teamName} in those twelve minutes?' }
  ],
  choices: [
    { text: 'That one is on me.',     emotion: 'shaken',  effect: (c) => ({ teamMorale: +1.5, reputation: +1, chronicle: 'Took the blame for a blown lead against ' + c.opponentName + '.' }) },
    { text: 'Ask the guys who quit.', emotion: 'angry',   effect: (c) => ({ teamMorale: -2.5, reputation: -2, chronicle: 'Called out the roster in the press after losing to ' + c.opponentName + '.' }) },
    { text: 'Long season.',           emotion: 'neutral', effect: null }
  ]
}
```

`effect: null` is the flavor case: a real reply that changes nothing.
Consequential and flavor choices sit in the same list and are visually
identical. The player is not told which is which.

## Speakers

A scene's `speaker` names *who is talking*, and `dialogueContext.js` resolves it
to something the box can draw:

- `{ kind: 'player', id }` and `{ kind: 'coach', id }` resolve to an existing
  entity, and the bust uses that entity's face data through
  `spriteColorsForPlayer`.
- `{ kind: 'reporter' }` has no entity behind it. Reporters are generated once
  per league and cached on `GameState.reporters` — one per team, so the beat
  writer who covers your team is the same person every night and becomes a
  recurring character rather than a new stranger each game.

A generated reporter is the minimum a bust and a name plate need: a name from
`pickUniqueName` (names.js:124), a `face` built by `generateFace` (faces.js:69)
for skin and hair, and an outlet name. They are drawn from the league RNG at
generation time and persisted with `GameState`, so a save replays the same
reporters. They are not players: they never enter a roster, a draft class, or
any league listing.

An absent `GameState.reporters` regenerates on load, so old saves and saves
made before this feature both work.

## Selection

1. Filter by `moment` and the current role. The role is `player` when
   `GameState.playerCareerController` exists and has a `controlledPlayerId`,
   and `gm` otherwise — the same signal the player dashboard already keys off.
2. Keep scenes whose `when(ctx)` returns true.
3. Take the highest `priority`; break ties with the league RNG.
4. Drop any scene id in the recent-scenes ring buffer.
5. If nothing survives, build a generic scene from the `media_standard` pool
   in narrativeSystem.js:95.

Ties break on `GameState.rng`, not `Math.random`, for the same reason
`NarrativeSystem._rand` does (narrativeSystem.js:10): a save must replay the
same lines.

The recent-scenes ring buffer lives on `GameState` and holds the last 8 fired
scene ids, so a scene cannot recur until 8 others have fired. It is saved with
`GameState`; an absent buffer normalizes to empty on load.

A scene whose `when()` throws is dropped from selection and logged. One bad
predicate should not cost the user their post-game.

## Effects

A choice's `effect(ctx)` **returns** a plain description of the change; a
single `applyDialogueEffect(desc, ctx)` interprets it. Scene data stays pure
and testable — assert on the returned object, no game state required.

Four channels, all landing on state that already exists or is added here:

| Channel | Target | Notes |
|---|---|---|
| `teamMorale` / `playerMorale` | `p.status.morale` | Clamped 0–100 |
| `reputation` | `career.reputation` | Clamped 0–100 |
| `chronicle` | `addChronicle(career, year, kind, text)` | Permanent trace in GM history |
| `recordDecision` | `playerCareerController.recordDecision` | Player-career mode only |

**Morale scale.** The per-game morale tick is ±0.35–0.45 (morale.js:16), so a
dialogue swing of ±1.5–3 is worth several games without being absurd. Nothing
in a text box should be worth more than that.

## Reputation

`career.reputation` — a number, 0–100, default 50, clamped on write.

Defaulted in `ensureGmCareer` (gmCareer.js:59), alongside the array guards
already there. This is what makes it free for existing saves: `save.js`
serializes `gameState.gmCareer` wholesale (save.js:189) and runs
`ensureGmCareer` on load (save.js:319), so every old save backfills to 50 with
no migration code.

Dialogue is the only writer. The GM career view is the only reader: a fifth
tile in the existing `.kpi-grid` (ui/gmCareerView.js:81).

It is displayed **banded**, not bare — "Respected", "Divisive", "Stonewalled"
— so a 3-point swing reads as something rather than as noise, and so the number
is not mistaken for a rating the simulation consumes. It is not consumed by the
simulation; nothing outside the career view reads it.

## Presentation

- **Layout.** Bust left, name plate overlapping the box's top-left corner, text
  body, and a `▼` blinker once a line completes.
- **Palette.** Built from existing CSS variables (`--surface-2`,
  `--line-strong`) so the box belongs to this game rather than cosplaying the
  Capcom palette.
- **Typewriter.** ~28ms/char. A click or Space *mid-line* completes the line
  instantly rather than advancing — that is the Ace Attorney contract, and it
  is what stops fast readers hating the effect. Only a click on a completed
  line advances.
- **Reduced motion.** `prefers-reduced-motion` renders each line complete
  immediately, matching how the quarter card already degrades
  (ui/pixelGameView.js:442).
- **Escaping.** Text is set with `textContent`, never `innerHTML`. Scene text
  interpolates player and team names, and this codebase has already been bitten
  by an apostrophe in an interpolated string (ui/randomEventScenes.js:8).
- **Audio.** One `blip` case added to the `playPixelSfx` switch
  (ui/pixelAudio.js:88) — a short square-wave tick, played every 3rd character
  so it chirps rather than buzzes. Respects the existing mute.
- **Motion.** Bust slides in from the left and holds a 1px idle bob, on the
  same reasoning as the sprite idle frame (pixelSprites.js:178): one pixel of
  movement is enough to read as alive.

## Halftime specifics

The period hook fires only when `period` crosses 2, only in games the user's
team plays, and only if the box is not already up.

It **hard-pauses** playback for the duration — not a `hitchMs` bump like the
quarter-break card, because a dialogue cannot be on a timer — and restores the
previous play state on dismiss. If the user leaves the view mid-scene, the
overlay tears itself down.

## Skipping

Esc dismisses the box. A skipped scene applies **no** effect: silence is not a
choice, and auto-applying a default would punish the user for skipping.

Settings gets one toggle to disable the scenes entirely.

## Testing

The split is what makes this cheap. Three of the four modules test in node with
no DOM.

**`dialogueScenes.js`** — against a set of fixture contexts:
- the expected scene wins selection
- every scene has at least one choice
- every `{token}` in every line resolves against the context keys a scene of
  that `moment` is given
- every `emotion` named by a scene exists in the bust tables
- the fallback fires when no predicate passes

**`applyDialogueEffect`** — morale clamps at 0 and 100, reputation clamps at 0
and 100, `effect: null` is a no-op, a chronicle effect appends exactly one
entry.

**`drawPixelBust`** — every emotion key exists in both `BROW` and `MOUTH`, so a
scene cannot name an emotion that silently renders a blank face.

**Reporter generation** — the same seed yields the same reporters, every team
has exactly one, and regeneration on a save with no `reporters` field produces
a complete set.

**Manual smoke** in the browser for the two hooks: halftime pauses and resumes
playback correctly at 1x and 8x, post-game fires after a watched game, and Esc
mid-scene leaves no overlay behind. Playback pause/restore is not worth
mocking.

## Risks

- **Scene volume.** An engine with four scenes is a demo. The value is in
  having enough situational scenes that repeats are rare, and that is writing
  work, not engineering work. The generic fallback keeps the floor from being
  embarrassing while the library grows.
- **Interruption fatigue.** Halftime is a pause in something the user chose to
  watch. If it fires every game it becomes a click-through. Mitigated by the
  settings toggle and the ring buffer; may need a firing probability if it
  still grates in play.
