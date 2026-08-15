# NBA GM Simulator — working notes

A basketball GM simulation that runs entirely in the browser. No build step, no
bundler, no `package.json`. `index.html` loads ~120 plain `<script>` tags in
dependency order and everything talks through globals.

## Running it

Dev server (never open `index.html` over `file://` — the sim worker and fetches
need a real origin):

```bash
python scripts/devserver.py 8137
```

In Claude Code, `preview_start` with `{name: "nba-gm"}` starts that same server
from `.claude/launch.json` and opens the preview.

## The module pattern — read this before editing any file

Every file is a browser script first and a Node module second. Logic that needs
testing sits at file scope and is exported through a guard at the bottom:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

Two rules follow from that:

- **Never add `import`/`export` syntax.** It breaks the `<script>` load.
- **If Node can't reach it, it can't be tested.** `ui/pixelMotion.js` exists
  because three real defects hid inside a 400-line render closure in
  `ui/pixelGameView.js` where no validator could see them. When logic gets
  hairy, pull it out to file scope rather than leaving it in a closure.

New root-level file? Add its `<script>` tag to `index.html` in dependency
order, or it simply won't exist at runtime.

## Tests

`scripts/validate-*.js` — ~110 of them, one per subsystem. Plain `node` +
`assert`, no framework, **no runner script**. Run the ones you touched:

```bash
node scripts/validate-dribble.js
```

`scripts/probe-*.js` — measurement, not pass/fail. They sim many seasons and
print distributions, used to tune a number until it lands in a stated band.
Probes report; validators assert.

`scripts/ui-smoke.js` and `scripts/validate-browserBridges.js` catch the class
of bug where every validator is green and the page still throws
`selectSegment is not defined` — anything wired between HTML and JS should be
covered by one of those.

**A validator that calls a seeded function without its seed is lying.** Every
caller that omits a possession seed gets the same roll for the whole league,
which turns a probabilistic rule into an all-or-nothing one and reports numbers
roughly double the truth. This has bitten twice.

## How work is planned

Non-trivial features get two documents:

- `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` — what and why
- `docs/superpowers/plans/YYYY-MM-DD-<name>.md` — the task list, ticked off as
  it goes, with a closing section on what was measured and what was left undone

Read the most recent plan to see where things stand.

## Commits

Lowercase `type: ` prefix, then a sentence describing the behavior in the
game's own terms rather than the code's:

```
feat: a crossover crosses the ball over, not just the man
fix: a change of tempo can no longer rewrite where the ball already was
test: probe where ankle breakers actually go
```

## `reference/` is not in the repo

`.gitignore` excludes a ~79MB vendored directory (zengm, facesjs, and others)
kept locally for reading. **A fresh clone will not have it**, and that is fine
— nothing at runtime depends on it. The one script that reads it,
`scripts/build-face-svgs.js`, has its output (`faceSvgs.js`) committed. Don't
try to regenerate face SVGs from a checkout that lacks `reference/facesjs`.
