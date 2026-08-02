# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the 13-line stylesheet and bare `innerHTML` markup with a token-driven dark design system and sidebar app shell, so the game reads as a modern sports management title — without altering any existing function, listener, or gameplay mechanic.

**Architecture:** One rewritten `style.css` holding all tokens and components; a restructured `index.html` whose new inner `.app-shell` div carries the grid (leaving `#app-view` free for its inline `display` toggle); one new `ui/topbar.js` for the persistent status strip and team-accent resolution; and additive markup edits inside the HTML-string block of each existing view file, never its listener block.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no dependencies. Scripts load as globals via `<script>` tags in `index.html`. Verification is behavioral in a browser plus the existing `scripts/validate-*.js` Node suite.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-02-ui-redesign-design.md` §1. Every task's requirements implicitly include this section.

- **Never** rename or remove an `id`, a `data-*` attribute, an `input[name]`, or an input `type`.
- **Never** change a render function's signature, arguments, or return value.
- **Only** add wrapper elements, class names, and text formatting *around* existing hooks.
- The listener-wiring block at the bottom of each view file is **not edited** — only the HTML-string block above it.
- No changes to simulation, ratings, contracts, trades, drafting, or progression logic.
- Exactly one behavioral change is authorized in this entire plan: the `insertAdjacentHTML` fix in Task 4.
- Desktop-only. No responsive breakpoints.
- No new dependencies. The project is zero-dependency by design.
- `salarycap` and `news` remain placeholder views.

## Verification Model

This is presentation code — there is nothing to assert on, so the TDD cycle is replaced by a **behavioral cycle** run at the end of every task:

1. Reload the view in the browser.
2. Read console messages — must be empty of errors.
3. Exercise every listener that view owns (each task names them explicitly).
4. Commit.

`scripts/validate-*.js` is logic-only and must pass **unchanged** throughout; it is the regression proof that no gameplay code moved. It is run in Task 1 to capture a baseline and again in Task 13.

---

### Task 1: Preview server, baseline, and design tokens

**Files:**
- Create: `.claude/launch.json`
- Modify: `style.css` (full rewrite of the 13 existing lines)

**Interfaces:**
- Produces: the full `:root` token set (`--bg`, `--surface-1..3`, `--line`, `--line-strong`, `--text`, `--text-dim`, `--text-mute`, `--win`, `--loss`, `--warn`, `--info`, `--gold`, `--accent`, `--accent-soft`, `--r-sm/md/lg`, `--shadow`) consumed by every later task. Also base element styles for `body`, `button`, `input`, `select`, `table`, and the `.team-logo` / `.placeholder-view` rules carried over from the old stylesheet.

- [x] **Step 1: Capture the validator baseline**

Run each validator and record that they pass, so any later failure is unambiguously caused by this work:

```bash
cd "C:/Users/cory/Desktop/nba" && for f in scripts/validate-*.js; do echo "== $f"; node "$f" 2>&1 | tail -3; done
```

Expected: every validator reports success. If any fails *before* any edit, note it as pre-existing and do not attempt to fix it in this plan.

- [x] **Step 2: Create the preview server config**

Create `.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "nba-gm",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8123"],
      "port": 8123
    }
  ]
}
```

- [x] **Step 3: Start the preview and confirm the game runs unmodified**

Start the `nba-gm` preview. Confirm the team-select screen renders and the console is clean. This is the "before" state.

- [x] **Step 4: Rewrite `style.css` with tokens and base element styles**

Replace the entire file. Preserve the two rules the old sheet needed — `.team-logo` (used by `ui/teamLogo.js`) and `.placeholder-view` (used by `renderPlaceholder`) — retuned for dark.

```css
:root {
  --bg: #0B0E14;
  --surface-1: #131822;
  --surface-2: #1A2029;
  --surface-3: #232B37;
  --line: #2A3340;
  --line-strong: #3A4553;
  --text: #E6EAF0;
  --text-dim: #93A1B5;
  --text-mute: #64748B;
  --win: #3FB950;
  --loss: #F85149;
  --warn: #D29922;
  --info: #58A6FF;
  --gold: #D4A94E;
  --accent: #58A6FF;
  --accent-soft: rgba(88, 166, 255, .14);
  --r-sm: 4px;
  --r-md: 8px;
  --r-lg: 12px;
  --shadow: 0 2px 8px rgba(0, 0, 0, .4);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 { margin: 0 0 12px; font-weight: 650; letter-spacing: -.01em; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1rem; }
h4 { font-size: .875rem; color: var(--text-dim); }
p { margin: 0 0 10px; }
a { color: var(--accent); }

/* Numeric alignment — the single highest-leverage rule for a stats game. */
.num, td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

button {
  font: inherit;
  padding: 7px 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface-3);
  color: var(--text);
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
button:hover:not(:disabled) { background: var(--line-strong); border-color: var(--text-mute); }
button:disabled { opacity: .4; cursor: not-allowed; }
button.btn-primary { background: var(--accent); border-color: var(--accent); color: #06101D; font-weight: 650; }
button.btn-primary:hover:not(:disabled) { filter: brightness(1.12); background: var(--accent); }
button.btn-ghost { background: transparent; border-color: var(--line); color: var(--text-dim); }
button.btn-ghost:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
button.btn-danger { background: transparent; border-color: rgba(248, 81, 73, .4); color: var(--loss); }
button.btn-danger:hover:not(:disabled) { background: rgba(248, 81, 73, .12); border-color: var(--loss); }

input, select, textarea {
  font: inherit;
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface-1);
  color: var(--text);
}
input[type="number"] { font-variant-numeric: tabular-nums; }
input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); width: 15px; height: 15px; cursor: pointer; }
input[type="color"] { padding: 2px; height: 32px; width: 52px; cursor: pointer; }
select { cursor: pointer; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Carried over from the previous stylesheet — consumed by ui/teamLogo.js. */
.team-logo {
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid; border-radius: 50%; overflow: hidden;
  vertical-align: middle; flex-shrink: 0;
}
.team-logo img { width: 100%; height: 100%; object-fit: contain; }

.placeholder-view { padding: 64px 24px; text-align: center; color: var(--text-mute); font-style: italic; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-mute); }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

- [x] **Step 5: Verify in the browser**

Reload. Expected: dark background, light text, dark form controls throughout. Layout is still the old stacked one — that is correct at this stage. Console must be clean. Click into a team to confirm the app still boots.

- [x] **Step 6: Commit**

```bash
git add .claude/launch.json style.css && git commit -m "style: dark design tokens and base element styles"
```

---

### Task 2: App shell and sidebar navigation

**Files:**
- Modify: `index.html` (restructure `#app-view`, add `ui/topbar.js` script tag)
- Modify: `ui/nav.js` (add `group` field, emit grouped markup)
- Modify: `style.css` (append shell + nav components)

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `.app-shell`, `.app-sidebar`, `.app-main`, `.sidebar-brand`, `.nav-group`, `.nav-group-label`, `.nav-item` classes. `#app-topbar` div exists in the DOM, empty, for Task 3 to fill.
- `NAV_ITEMS` entries gain a `group` string. `renderNav(container, activeView, onNavigate, playMode)` signature is unchanged.

- [x] **Step 1: Restructure `index.html`**

Replace the `#app-view` block. `#app-view` keeps no layout of its own so `script.js`'s `style.display = 'block'` stays valid; `.app-shell` carries the grid.

```html
  <div id="team-select-view"></div>
  <div id="app-view" style="display:none;">
    <div class="app-shell">
      <aside class="app-sidebar">
        <div class="sidebar-brand">NBA<span>GM</span></div>
        <div id="nav-bar"></div>
      </aside>
      <div class="app-main">
        <div id="app-topbar"></div>
        <div id="view-content"></div>
        <div id="sim-controls"></div>
      </div>
    </div>
  </div>
```

Also add the new topbar script immediately before `ui/nav.js` in the script list:

```html
  <script src="ui/topbar.js"></script>
  <script src="ui/nav.js"></script>
```

- [x] **Step 2: Add `group` to `NAV_ITEMS` and emit groups in `renderNav`**

Rewrite the top of `ui/nav.js`. Every `id` and `label` is unchanged; only the additive `group` key is new.

```js
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Team' },
  { id: 'roster', label: 'Roster', group: 'Team' },
  { id: 'schedule', label: 'Schedule', group: 'Team' },
  { id: 'standings', label: 'Standings', group: 'League' },
  { id: 'awards', label: 'Awards', group: 'League' },
  { id: 'history', label: 'History', group: 'League' },
  { id: 'news', label: 'League News', group: 'League' },
  { id: 'feed', label: 'Live Feed', group: 'League' },
  { id: 'trade', label: 'Trade Center', group: 'Transactions' },
  { id: 'freeagency', label: 'Free Agency', group: 'Transactions' },
  { id: 'draft', label: 'Draft', group: 'Transactions' },
  { id: 'scouting', label: 'Scouting', group: 'Transactions' },
  { id: 'salarycap', label: 'Salary Cap', group: 'Transactions' },
  { id: 'saveload', label: 'Save/Load', group: 'System' },
  { id: 'settings', label: 'Settings', group: 'System' },
  { id: 'commissioner', label: 'Commissioner', group: 'System' }
];

const NAV_GROUP_ORDER = ['Team', 'League', 'Transactions', 'System'];

function renderNav(container, activeView, onNavigate, playMode) {
  container.innerHTML = '';
  NAV_GROUP_ORDER.forEach(function (group) {
    const items = NAV_ITEMS.filter(function (item) {
      if (item.group !== group) return false;
      if (item.id === 'commissioner' && playMode !== 'commissioner') return false;
      return true;
    });
    if (items.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group;
    groupEl.appendChild(label);

    items.forEach(function (item) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.className = item.id === activeView ? 'nav-item active' : 'nav-item';
      btn.addEventListener('click', function () { onNavigate(item.id); });
      groupEl.appendChild(btn);
    });

    container.appendChild(groupEl);
  });
}
```

Note: `NAV_ITEMS` order changed so grouping reads naturally, but every id is still present exactly once, the commissioner filter is preserved verbatim, and `onNavigate(item.id)` is unchanged. Keep the existing `module.exports` line at the bottom of the file untouched.

- [x] **Step 3: Append shell and nav CSS to `style.css`**

```css
/* ---------- App shell ---------- */
.app-shell { display: grid; grid-template-columns: 232px 1fr; height: 100vh; }
.app-sidebar {
  background: var(--surface-2);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column;
  overflow-y: auto;
}
.app-main {
  display: grid; grid-template-rows: auto 1fr auto;
  min-width: 0; min-height: 0;
}
#view-content { overflow-y: auto; padding: 22px 26px; min-height: 0; }

.sidebar-brand {
  padding: 18px 18px 14px;
  font-size: 1.05rem; font-weight: 800; letter-spacing: .1em;
  color: var(--text);
  border-bottom: 1px solid var(--line);
}
.sidebar-brand span { color: var(--accent); }

#nav-bar { padding: 10px 0 20px; }
.nav-group { margin-bottom: 14px; }
.nav-group-label {
  padding: 6px 18px;
  font-size: .68rem; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--text-mute);
}
.nav-item {
  display: block; width: 100%; text-align: left;
  padding: 7px 18px;
  background: none; border: none; border-left: 3px solid transparent;
  border-radius: 0;
  color: var(--text-dim); font-size: .875rem;
}
.nav-item:hover:not(:disabled) {
  background: var(--surface-3); border-color: transparent;
  border-left-color: var(--line-strong); color: var(--text);
}
.nav-item.active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  color: var(--text); font-weight: 650;
}
```

- [x] **Step 4: Verify in the browser**

Reload, select a team. Expected: a sidebar with four labeled groups; content to its right; the active item shows an accent left-bar. Click through **every** nav item and confirm each view renders and the active state follows — this exercises the `onNavigate` callback for all 16 entries. Console clean.

- [x] **Step 5: Commit**

```bash
git add index.html ui/nav.js style.css && git commit -m "feat(ui): sidebar app shell with grouped navigation"
```

---

### Task 3: Persistent topbar and team accent

**Files:**
- Create: `ui/topbar.js`
- Modify: `script.js` (one added line inside `renderView`)
- Modify: `style.css` (append topbar + meter components)

**Interfaces:**
- Consumes: `.app-main` grid row 1 (`#app-topbar`) from Task 2.
- Produces: `renderTopBar(container)` and `resolveAccent(team)` globals. `.topbar`, `.topbar-identity`, `.status-chip`, `.meter`, `.meter-fill` classes, where `.meter` is reused by Tasks 6 and 10.

- [x] **Step 1: Create `ui/topbar.js`**

`resolveAccent` uses relative luminance so near-black team colors (Brooklyn `#000000`, Toronto's black secondary) can't produce an invisible accent.

```js
function hexLuminance(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 0;
  const rgb = [0, 2, 4].map(function (i) {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// Team primaries include pure black (BKN) and very dark navies, which vanish
// against --bg. Fall back through secondary, then to the default info blue.
const MIN_ACCENT_LUMINANCE = 0.09;

function resolveAccent(team) {
  if (!team || !team.colors) return '#58A6FF';
  if (hexLuminance(team.colors.primary) >= MIN_ACCENT_LUMINANCE) return team.colors.primary;
  if (hexLuminance(team.colors.secondary) >= MIN_ACCENT_LUMINANCE) return team.colors.secondary;
  return '#58A6FF';
}

function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 'rgba(88,166,255,' + alpha + ')';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function applyTeamAccent(team) {
  const accent = resolveAccent(team);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.14));
}

function statusChip(label, value, valueClass) {
  return '<div class="status-chip"><span class="chip-label">' + label + '</span>' +
    '<span class="chip-value ' + (valueClass || '') + '">' + value + '</span></div>';
}

function renderTopBar(container) {
  if (!container) return;
  if (!GameState.userTeamId) { container.innerHTML = ''; return; }

  const team = getTeamById(GameState.userTeamId);
  applyTeamAccent(team);

  const payroll = getTeamPayroll(team.id);
  const cap = CAP_CONSTANTS.SALARY_CAP;
  const pct = Math.min(100, Math.round((payroll / cap) * 100));
  const overCap = payroll > cap;
  const day = GameState.season && GameState.season.currentDay >= 0 ? GameState.season.currentDay : '—';
  const stage = GameState.playoffBracket ? 'Playoffs' : (GameState.offseasonStage ? 'Offseason' : 'Regular Season');

  container.innerHTML =
    '<div class="topbar">' +
      '<div class="topbar-identity">' +
        teamLogoImgHtml(team.id, 40) +
        '<div class="identity-text">' +
          '<div class="identity-name">' + team.name + '</div>' +
          '<div class="identity-meta">' + team.conference + ' · ' + team.division + '</div>' +
        '</div>' +
        '<div class="identity-record">' + team.record.wins + '<span>-</span>' + team.record.losses + '</div>' +
      '</div>' +
      '<div class="topbar-status">' +
        statusChip('Season', GameState.leagueYear || 2026, '') +
        statusChip('Day', day, '') +
        statusChip('Stage', stage, '') +
        '<div class="status-chip chip-cap">' +
          '<span class="chip-label">Payroll</span>' +
          '<span class="chip-value ' + (overCap ? 'is-over' : '') + '">$' + Math.round(payroll / 1e6) + 'M <em>/ $' + Math.round(cap / 1e6) + 'M</em></span>' +
          '<div class="meter"><div class="meter-fill ' + (overCap ? 'is-over' : '') + '" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        statusChip('Chemistry', team.chemistry, '') +
        '<div class="mode-pill mode-' + GameState.playMode + '">' + GameState.playMode + '</div>' +
      '</div>' +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTopBar: renderTopBar, resolveAccent: resolveAccent, hexLuminance: hexLuminance };
}
```

- [x] **Step 2: Wire it into `renderView`**

In `script.js`, inside `renderView`, immediately after the existing `renderNav(...)` call, add exactly one line:

```js
  renderTopBar(document.getElementById('app-topbar'));
```

Nothing else in `renderView` changes at this step.

- [x] **Step 3: Append topbar CSS to `style.css`**

```css
/* ---------- Topbar ---------- */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 20px; padding: 12px 26px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.topbar-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.identity-text { min-width: 0; }
.identity-name { font-size: 1.05rem; font-weight: 700; white-space: nowrap; }
.identity-meta { font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-mute); }
.identity-record {
  margin-left: 8px; padding-left: 14px;
  border-left: 1px solid var(--line);
  font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums;
}
.identity-record span { color: var(--text-mute); margin: 0 2px; }

.topbar-status { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.status-chip { display: flex; flex-direction: column; gap: 1px; min-width: 54px; }
.chip-label { font-size: .62rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text-mute); }
.chip-value { font-size: .9rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.chip-value em { font-style: normal; font-weight: 400; color: var(--text-mute); }
.chip-value.is-over { color: var(--warn); }
.chip-cap { min-width: 148px; }

.meter { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; margin-top: 3px; }
.meter-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width .2s ease; }
.meter-fill.is-over { background: var(--warn); }

.mode-pill {
  padding: 3px 10px; border-radius: 999px;
  font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  border: 1px solid var(--line-strong); color: var(--text-dim);
}
.mode-pill.mode-commissioner { color: var(--gold); border-color: rgba(212, 169, 78, .45); }
.mode-pill.mode-spectator { color: var(--info); border-color: rgba(88, 166, 255, .45); }
```

- [x] **Step 4: Verify in the browser**

Reload and select **Boston** (bright green primary — accent should turn green) then restart and select **Brooklyn** (`#000000` primary — accent must fall back, *not* go invisible). Confirm the topbar shows record, season, day, stage, payroll meter, chemistry, and mode pill. Sim a few days and confirm day/record update. Console clean.

- [x] **Step 5: Commit**

```bash
git add ui/topbar.js script.js index.html style.css && git commit -m "feat(ui): persistent topbar with contrast-guarded team accent"
```

---

### Task 4: Sim dock and the `innerHTML +=` fix

**Files:**
- Modify: `ui/simControls.js` (`renderSimControls` HTML string only)
- Modify: `script.js:253, 256, 267` (the three `innerHTML +=` sites)
- Modify: `style.css` (append dock components)

**Interfaces:**
- Consumes: `.app-main` grid row 3 (`#sim-controls`).
- Produces: `.dock-group` wrappers, leaving the offseason advance button as the only direct-child `button` of `#sim-controls`, which `#sim-controls > button` styles as the primary CTA.

- [x] **Step 1: Fix the listener-destroying `innerHTML +=`**

This is the one authorized behavioral change. In `script.js`, replace all three occurrences. `innerHTML +=` re-parses the container and destroys the listeners `renderSimControls` just attached; `insertAdjacentHTML` appends without touching existing children.

```js
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="advance-offseason-btn">Advance to Offseason</button>');
```

```js
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="advance-to-fa-btn">Go to Free Agency</button>');
```

```js
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="start-new-season-btn">Start New Season</button>');
```

The `document.getElementById(...).addEventListener(...)` line following each one is unchanged and still resolves.

- [x] **Step 2: Group the dock markup in `ui/simControls.js`**

Replace only the `container.innerHTML = ...` assignment inside `renderSimControls`. Every id, both number inputs, and the speed select options are byte-identical to before; only wrappers and classes are added. The `document.getElementById(...)` listener block below it is untouched.

```js
  container.innerHTML =
    '<div class="dock-group dock-primary">' +
      '<button id="sim-next-game" class="btn-primary">Next Game</button>' +
      '<button id="sim-next-day">Next Day</button>' +
      '<button id="sim-to-end">Sim to End of ' + stageLabel + '</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<span class="dock-label">Skip to</span>' +
      '<button id="sim-to-deadline" class="btn-ghost">Trade Deadline</button>' +
      '<button id="sim-to-draft" class="btn-ghost">Draft</button>' +
      '<button id="sim-to-fa" class="btn-ghost">Free Agency</button>' +
    '</div>' +
    '<div class="dock-group">' +
      '<span class="dock-label">Fast forward</span>' +
      '<input type="number" id="sim-n-seasons" value="1" min="1" max="15">' +
      '<button id="sim-n-seasons-btn" class="btn-ghost">Seasons</button>' +
      '<button id="sim-until-championship" class="btn-ghost">Until Title</button>' +
      '<input type="number" id="sim-n-days" value="7" min="1">' +
      '<button id="sim-n-days-btn" class="btn-ghost">Days</button>' +
    '</div>' +
    '<div class="dock-group dock-end">' +
      '<span class="dock-label">Speed</span>' +
      '<select id="sim-speed">' +
        ['slow', 'normal', 'fast', 'ultra'].map(function (s) {
          return '<option value="' + s + '"' + (GameState.settings.simSpeed === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') +
      '</select>' +
      '<span id="sim-status"></span>' +
    '</div>';
```

Note: the inline `style="width:3em"` / `style="width:4em"` on the two number inputs moves to CSS. The `id`, `type`, `value`, `min`, and `max` attributes are unchanged, so `Number(document.getElementById('sim-n-seasons').value)` still reads exactly the same.

- [x] **Step 3: Append dock CSS to `style.css`**

```css
/* ---------- Sim dock ---------- */
#sim-controls {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 11px 26px;
  background: var(--surface-2);
  border-top: 1px solid var(--line);
}
.dock-group { display: flex; align-items: center; gap: 7px; }
.dock-group.dock-end { margin-left: auto; }
.dock-label {
  font-size: .62rem; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--text-mute);
  margin-right: 2px;
}
#sim-controls input[type="number"] { width: 58px; padding: 6px 7px; }
#sim-controls .dock-primary button { padding: 8px 16px; }

/* The offseason advance button — appended by renderView as the only
   direct-child button of #sim-controls (all dock controls are nested). */
#sim-controls > button {
  margin-left: auto;
  background: var(--win); border-color: var(--win); color: #06140A;
  font-weight: 700;
}
#sim-controls > button:hover:not(:disabled) { filter: brightness(1.12); background: var(--win); }

#sim-status { font-size: .8rem; color: var(--accent); font-weight: 600; min-width: 0; }
#sim-status:not(:empty)::before {
  content: ''; display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); margin-right: 6px;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
```

- [x] **Step 4: Verify the dock and the bug fix**

Reload and confirm the dock is grouped along the bottom with "Next Game" as the accent-filled primary. Then exercise every control: Next Game, Next Day, Sim to End, Trade Deadline, and a 2-season fast-forward. Confirm buttons disable during a sim and `#sim-status` shows the pulsing indicator.

Then verify the fix specifically: use **Sim to Draft** to reach the offseason, confirm the green advance CTA appears at the dock's right — and confirm the sim control buttons **still respond**, which they do not on `main` today.

- [x] **Step 5: Commit**

```bash
git add ui/simControls.js script.js style.css && git commit -m "feat(ui): grouped sim dock; fix innerHTML += destroying sim control listeners"
```

---

### Task 5: Shared view components — panel, table, chip, pill, empty state

**Files:**
- Modify: `style.css` (append the shared component layer)

**Interfaces:**
- Produces: `.panel`, `.panel-header`, `.panel-body`, `.data-table`, `.rating-chip` (+ `.tier-elite/.tier-high/.tier-mid/.tier-low`), `.pill` (+ `.pill-pos/.pill-win/.pill-loss/.pill-gold/.pill-mute`), `.empty-state`, `.view-header`, `.kpi-grid`, `.kpi-tile`. Every later task consumes these; no later task defines its own table or panel styling.

- [x] **Step 1: Append the shared component layer to `style.css`**

```css
/* ---------- Panels ---------- */
.view-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; }
.view-header h2 { margin: 0; }
.view-header .view-sub { font-size: .8rem; color: var(--text-mute); }

.panel {
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  margin-bottom: 18px;
  overflow: hidden;
}
.panel-header {
  padding: 10px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  font-size: .7rem; font-weight: 700;
  letter-spacing: .09em; text-transform: uppercase;
  color: var(--text-dim);
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.panel-body { padding: 14px; }
.panel-body > :last-child { margin-bottom: 0; }

/* ---------- Data tables ---------- */
table { border-collapse: collapse; width: 100%; }
.data-table { background: var(--surface-1); font-size: .84rem; }
.data-table th {
  position: sticky; top: 0; z-index: 1;
  background: var(--surface-2);
  padding: 9px 12px; text-align: left;
  font-size: .66rem; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--text-dim);
  border-bottom: 1px solid var(--line-strong);
  white-space: nowrap;
}
.data-table th[data-key] { cursor: pointer; user-select: none; }
.data-table th[data-key]:hover { color: var(--text); background: var(--surface-3); }
.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: var(--surface-2); }
.data-table .col-name { font-weight: 600; font-variant-numeric: normal; }
.data-table td.actions { white-space: nowrap; text-align: right; }
.data-table td.actions button { padding: 4px 10px; font-size: .78rem; }
.data-table tr.is-clickable { cursor: pointer; }

/* ---------- Rating chips ---------- */
.rating-chip {
  display: inline-block; min-width: 30px; padding: 2px 7px;
  border-radius: var(--r-sm);
  font-weight: 700; font-size: .8rem; text-align: center;
  font-variant-numeric: tabular-nums;
  background: var(--surface-3); color: var(--text-dim);
}
.rating-chip.tier-elite { background: rgba(212, 169, 78, .18); color: var(--gold); }
.rating-chip.tier-high { background: rgba(88, 166, 255, .16); color: var(--info); }
.rating-chip.tier-mid { background: rgba(63, 185, 80, .14); color: var(--win); }
.rating-chip.tier-low { background: var(--surface-3); color: var(--text-mute); }

/* ---------- Pills ---------- */
.pill {
  display: inline-block; padding: 2px 8px;
  border-radius: 999px;
  font-size: .68rem; font-weight: 700;
  letter-spacing: .05em; text-transform: uppercase;
  background: var(--surface-3); color: var(--text-dim);
}
.pill-pos { background: var(--surface-3); color: var(--text); min-width: 32px; text-align: center; }
.pill-win { background: rgba(63, 185, 80, .16); color: var(--win); }
.pill-loss { background: rgba(248, 81, 73, .16); color: var(--loss); }
.pill-gold { background: rgba(212, 169, 78, .16); color: var(--gold); }
.pill-mute { background: transparent; color: var(--text-mute); border: 1px solid var(--line); }

/* ---------- KPI tiles ---------- */
.kpi-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr));
  gap: 12px; margin-bottom: 18px;
}
.kpi-tile {
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: var(--r-md);
  padding: 12px 14px;
}
.kpi-label {
  font-size: .64rem; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--text-mute); margin-bottom: 4px;
}
.kpi-value { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
.kpi-sub { font-size: .74rem; color: var(--text-dim); margin-top: 2px; }
.kpi-value.is-good { color: var(--win); }
.kpi-value.is-bad { color: var(--loss); }
.kpi-value.is-warn { color: var(--warn); }

/* ---------- Empty state ---------- */
.empty-state {
  padding: 40px 24px; text-align: center;
  color: var(--text-mute); font-size: .875rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface-1);
}

/* ---------- Misc lists ---------- */
.stack-list { list-style: none; margin: 0; padding: 0; }
.stack-list li {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-size: .85rem;
}
.stack-list li:last-child { border-bottom: none; }
```

- [x] **Step 2: Verify no regression**

Reload and click through the views. Nothing should visibly change yet except that bare `<table>` elements now have collapsed borders and no white background — the classes are not applied until later tasks. Console clean.

- [x] **Step 3: Commit**

```bash
git add style.css && git commit -m "style: shared panel, table, chip, pill, and KPI components"
```

---

### Task 6: Dashboard

**Files:**
- Modify: `ui/dashboard.js` (the `container.innerHTML` string; this file has no listeners at all)

**Interfaces:**
- Consumes: `.kpi-grid`, `.kpi-tile`, `.panel`, `.meter` from Tasks 3 and 5.
- Produces: nothing consumed downstream.

- [x] **Step 1: Rebuild the dashboard markup**

Every value computed by the existing function is preserved — record, roster size, payroll, cap space, chemistry, fan/owner happiness, next game. The variable computation above (`team`, `roster`, `payroll`, `capSpace`, `nextDay`, `nextGameLabel`) is **unchanged**; only the `container.innerHTML` assignment is replaced.

```js
  const capPct = Math.min(100, Math.round((payroll / CAP_CONSTANTS.SALARY_CAP) * 100));
  const capClass = capSpace >= 0 ? 'is-good' : 'is-warn';
  const capText = capSpace >= 0
    ? '$' + capSpace.toLocaleString() + ' space'
    : '$' + Math.abs(capSpace).toLocaleString() + ' over';

  container.innerHTML =
    '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 28) + ' ' + team.name + '</h2>' +
      '<span class="view-sub">' + team.conference + ' Conference · ' + team.division + '</span></div>' +

    '<div class="kpi-grid">' +
      '<div class="kpi-tile"><div class="kpi-label">Record</div>' +
        '<div class="kpi-value">' + team.record.wins + '-' + team.record.losses + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Roster</div>' +
        '<div class="kpi-value">' + roster.length + '</div><div class="kpi-sub">players under contract</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Chemistry</div>' +
        '<div class="kpi-value">' + team.chemistry + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.chemistry + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Fan Happiness</div>' +
        '<div class="kpi-value">' + team.fanHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.fanHappiness + '%"></div></div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Owner Happiness</div>' +
        '<div class="kpi-value">' + team.ownerHappiness + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + team.ownerHappiness + '%"></div></div></div>' +
    '</div>' +

    '<div class="panel"><div class="panel-header">Salary Cap</div><div class="panel-body">' +
      '<div class="kpi-label">Payroll</div>' +
      '<div class="kpi-value ' + capClass + '">$' + payroll.toLocaleString() + '</div>' +
      '<div class="meter" style="margin:8px 0 6px;"><div class="meter-fill ' + (capSpace < 0 ? 'is-over' : '') + '" style="width:' + capPct + '%"></div></div>' +
      '<div class="kpi-sub">Cap $' + CAP_CONSTANTS.SALARY_CAP.toLocaleString() + ' · ' + capText + '</div>' +
    '</div></div>' +

    '<div class="panel"><div class="panel-header">Next Up</div><div class="panel-body">' +
      '<div class="kpi-value" style="font-size:1.05rem;">' + nextGameLabel + '</div>' +
    '</div></div>';
```

- [x] **Step 2: Verify in the browser**

Reload the Dashboard. Expected: five KPI tiles with accent left-bars and chemistry/happiness meters, a cap panel whose meter turns amber when over, and a next-game panel. Sim a few days and confirm record and next-game text update. Console clean.

- [x] **Step 3: Commit**

```bash
git add ui/dashboard.js && git commit -m "feat(ui): dashboard KPI tiles and cap meter"
```

---

### Task 7: Roster

**Files:**
- Modify: `ui/roster.js` (the `html` string inside `draw()` only)
- Modify: `style.css` (append one helper used only here)

**Interfaces:**
- Consumes: `.data-table`, `.rating-chip`, `.pill-pos`, `.panel` from Task 5.
- Produces: `ratingTier(value)` local helper.

- [x] **Step 1: Add the rating tier helper to `ui/roster.js`**

Place above `renderRoster`:

```js
function ratingTier(value) {
  if (value >= 90) return 'tier-elite';
  if (value >= 80) return 'tier-high';
  if (value >= 70) return 'tier-mid';
  return 'tier-low';
}
```

- [x] **Step 2: Rebuild the roster table markup**

Replace only the `html` construction inside `draw()`. `th[data-key]`, the sort-caret logic, `data-waive-id`, and `data-scout-id` are all preserved exactly, so the three `querySelectorAll` listener blocks below are untouched.

```js
    let html = '<div class="view-header"><h2>Roster</h2><span class="view-sub">' + roster.length + ' players</span></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr>';
    ROSTER_COLUMNS.forEach(function (col) {
      const numeric = col.key !== 'name' && col.key !== 'position';
      html += '<th data-key="' + col.key + '"' + (numeric ? ' class="num"' : '') + '>' +
        col.label + (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    });
    html += '<th class="num">Action</th>';
    html += '</tr></thead><tbody>';
    roster.forEach(function (p) {
      const avg = getPlayerAverages(p);
      html += '<tr>' +
        '<td class="col-name">' + p.name + '</td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.potential) + '">' + p.potential + '</span></td>' +
        '<td class="num">' + avg.ppg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.rpg.toFixed(1) + '</td>' +
        '<td class="num">' + avg.apg.toFixed(1) + '</td>' +
        '<td class="num">' + (avg.fgPct * 100).toFixed(1) + '%</td>' +
        '<td class="num">$' + p.contract.salary.toLocaleString() + '</td>' +
        '<td class="num">' + p.contract.yearsRemaining + '</td>' +
        '<td class="actions"><button class="btn-ghost" data-scout-id="' + p.id + '">Scout</button> ' +
          '<button class="btn-danger" data-waive-id="' + p.id + '">Waive</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="panel"><div class="panel-header">Career Totals</div>' +
      '<table class="data-table"><thead><tr><th>Name</th><th class="num">Seasons</th><th class="num">Pts</th>' +
      '<th class="num">Reb</th><th class="num">Ast</th><th class="num">Titles</th></tr></thead><tbody>';
    roster.forEach(function (p) {
      ensureCareerData([p]);
      html += '<tr><td class="col-name">' + p.name + '</td><td class="num">' + p.careerStats.seasonsPlayed +
        '</td><td class="num">' + p.careerStats.points + '</td><td class="num">' + p.careerStats.rebounds +
        '</td><td class="num">' + p.careerStats.assists + '</td><td class="num">' +
        (p.championshipsWon > 0 ? '<span class="pill pill-gold">' + p.championshipsWon + '</span>' : '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
```

Note: Scout and Waive swapped visual order so the destructive action sits last; both `data-*` attributes are unchanged, so both listener blocks still bind.

- [x] **Step 3: Verify in the browser**

Open Roster. Expected: sticky uppercase headers, tiered OVR/POT chips, position pills, right-aligned tabular stats, ghost/danger action buttons, career panel below.

Exercise all three listener groups: click several column headers and confirm sorting works in **both** directions; click **Scout** and confirm it navigates to the Scouting view with the report open; click **Waive** on a player and confirm the roster shrinks. Console clean.

- [x] **Step 4: Commit**

```bash
git add ui/roster.js style.css && git commit -m "feat(ui): roster table with rating chips and position pills"
```

---

### Task 8: Standings and schedule

**Files:**
- Modify: `ui/standings.js` (the `html` string; no listeners in this file)
- Modify: `ui/schedule.js` (`renderSchedule` and `renderBoxScoreDetail` html strings)
- Modify: `style.css` (append `.conf-grid`)

**Interfaces:**
- Consumes: `.panel`, `.data-table`, `.pill-win`, `.pill-loss` from Task 5.

- [x] **Step 1: Add the conference grid to `style.css`**

```css
.conf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
.conf-col h3 { font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 10px; }
.row-user td { background: var(--accent-soft) !important; font-weight: 650; }
```

- [x] **Step 2: Rebuild standings markup**

Two conferences side by side, each division a panel. The user's team row is highlighted. Sorting and data are unchanged.

```js
function renderStandings(container) {
  let html = '<div class="view-header"><h2>Standings</h2></div><div class="conf-grid">';
  CONFERENCES.forEach(function (conf) {
    html += '<div class="conf-col"><h3>' + conf + ' Conference</h3>';
    DIVISIONS[conf].forEach(function (div) {
      html += '<div class="panel"><div class="panel-header">' + div + '</div>' +
        '<table class="data-table"><thead><tr><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">Diff</th></tr></thead><tbody>';
      const divTeams = TEAMS.filter(function (t) { return t.conference === conf && t.division === div; })
        .slice()
        .sort(function (a, b) { return b.record.wins - a.record.wins; });
      divTeams.forEach(function (t) {
        const diff = (t.record.pointsFor || 0) - (t.record.pointsAgainst || 0);
        const diffLabel = (diff > 0 ? '+' : '') + diff;
        const diffClass = diff > 0 ? 'style="color:var(--win)"' : (diff < 0 ? 'style="color:var(--loss)"' : '');
        const rowClass = t.id === GameState.userTeamId ? ' class="row-user"' : '';
        html += '<tr' + rowClass + '><td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + t.name + '</td>' +
          '<td class="num">' + t.record.wins + '</td><td class="num">' + t.record.losses + '</td>' +
          '<td class="num" ' + diffClass + '>' + diffLabel + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}
```

- [x] **Step 3: Rebuild schedule markup**

`tr[data-game-id]` and `#box-score-detail` are preserved, so the row-click listener below is untouched.

```js
  let html = '<div class="view-header"><h2>Schedule</h2><span class="view-sub">Click a game for its box score</span></div>';
  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Day</th><th>Opponent</th><th>Result</th></tr></thead><tbody>';
  games.forEach(function (g) {
    const isHome = g.homeTeamId === teamId;
    const oppId = isHome ? g.awayTeamId : g.homeTeamId;
    const opp = getTeamById(oppId);
    const oppLabel = '<span class="pill pill-mute">' + (isHome ? 'VS' : '@') + '</span> ' + teamLogoImgHtml(oppId, 18) + ' ' + opp.name;
    let resultLabel = '<span class="pill pill-mute">Scheduled</span>';
    if (g.played) {
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      const won = teamScore > oppScore;
      resultLabel = '<span class="pill ' + (won ? 'pill-win' : 'pill-loss') + '">' + (won ? 'W' : 'L') + '</span> ' +
        teamScore + '-' + oppScore;
    }
    html += '<tr class="is-clickable" data-game-id="' + g.id + '"><td class="num">' + g.day + '</td>' +
      '<td class="col-name">' + oppLabel + '</td><td>' + resultLabel + '</td></tr>';
  });
  html += '</tbody></table></div><div id="box-score-detail"></div>';
  container.innerHTML = html;
```

And `renderBoxScoreDetail`:

```js
function renderBoxScoreDetail(container, game) {
  if (!game.played) {
    container.innerHTML = '<div class="empty-state">This game hasn\'t been played yet.</div>';
    return;
  }
  const home = getTeamById(game.homeTeamId);
  const away = getTeamById(game.awayTeamId);
  let html = '<div class="panel"><div class="panel-header">Box Score</div><div class="panel-body">' +
    '<div class="kpi-value">' + teamLogoImgHtml(away.id, 22) + ' ' + away.name + ' ' + game.awayScore +
    ' <span style="color:var(--text-mute)">@</span> ' +
    teamLogoImgHtml(home.id, 22) + ' ' + home.name + ' ' + game.homeScore + '</div></div>' +
    '<table class="data-table"><thead><tr><th>Player</th><th class="num">MIN</th><th class="num">PTS</th>' +
    '<th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th></tr></thead><tbody>';
  Object.keys(game.boxScore).forEach(function (playerId) {
    const p = getPlayerById(playerId);
    const s = game.boxScore[playerId];
    html += '<tr><td class="col-name">' + p.name + '</td><td class="num">' + s.minutes + '</td><td class="num">' + s.points +
      '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists + '</td><td class="num">' + s.steals +
      '</td><td class="num">' + s.blocks + '</td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}
```

- [x] **Step 4: Verify in the browser**

Standings: two conference columns, three division panels each, your team's row accent-highlighted, point differential colored. Schedule: sim some games first, then confirm W/L pills render and **clicking a row opens its box score** below. Click an unplayed game and confirm the empty state. Console clean.

- [x] **Step 5: Commit**

```bash
git add ui/standings.js ui/schedule.js style.css && git commit -m "feat(ui): conference standings grid and schedule with box score panel"
```

---

### Task 9: Live feed, awards, history, save/load

**Files:**
- Modify: `ui/liveFeed.js`, `ui/awards.js`, `ui/history.js`, `ui/saveLoad.js`
- Modify: `style.css` (append `.feed-item`, `.save-slot`)

**Interfaces:**
- Consumes: `.panel`, `.data-table`, `.empty-state`, `.stack-list`, `.pill-gold` from Task 5.

- [x] **Step 1: Append feed and save-slot CSS**

```css
.feed-item { display: flex; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--line); font-size: .85rem; }
.feed-item:last-child { border-bottom: none; }
.feed-day {
  flex-shrink: 0; min-width: 92px;
  font-size: .66rem; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-mute);
  font-variant-numeric: tabular-nums; padding-top: 2px;
}
.save-slot {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; border-bottom: 1px solid var(--line);
}
.save-slot:last-child { border-bottom: none; }
.save-slot-info { flex: 1; min-width: 0; }
.save-slot-name { font-weight: 650; font-size: .88rem; }
.save-slot-meta { font-size: .74rem; color: var(--text-mute); }
.save-slot.is-empty .save-slot-name { color: var(--text-mute); font-weight: 400; font-style: italic; }
```

- [x] **Step 2: Rebuild `ui/liveFeed.js`**

```js
function renderLiveFeed(container) {
  let html = '<div class="view-header"><h2>Live Feed</h2><span class="view-sub">' + GameState.feed.length + ' events</span></div>';
  if (GameState.feed.length === 0) {
    html += '<div class="empty-state">Nothing has happened yet — advance the sim to see events here.</div>';
  } else {
    html += '<div class="panel">';
    GameState.feed.slice().reverse().forEach(function (entry) {
      html += '<div class="feed-item"><span class="feed-day">Y' + entry.leagueYear + ' · D' +
        (entry.day === null ? '—' : entry.day) + '</span><span>' + entry.text + '</span></div>';
    });
    html += '</div>';
  }
  container.innerHTML = html;
}
```

- [x] **Step 3: Rebuild `ui/awards.js` render body**

`AWARD_LABELS` and `AWARD_DISPLAY_ORDER` are unchanged; only the html construction inside `renderAwards` changes.

```js
function renderAwards(container) {
  let html = '<div class="view-header"><h2>Awards</h2></div>';

  if (LEAGUE_HISTORY.awardsHistory.length === 0) {
    html += '<div class="empty-state">No seasons completed yet — awards appear here once a season ends.</div>';
    container.innerHTML = html;
    return;
  }

  LEAGUE_HISTORY.awardsHistory.slice().reverse().forEach(function (season) {
    html += '<div class="panel"><div class="panel-header">' + season.leagueYear + ' Season</div><ul class="stack-list">';
    AWARD_DISPLAY_ORDER.forEach(function (awardKey) {
      const winners = season.winners.filter(function (w) { return w.award === awardKey; });
      if (winners.length === 0) return;
      html += '<li><span class="feed-day" style="min-width:210px;display:inline-block;">' + AWARD_LABELS[awardKey] +
        '</span>' + winners.map(function (w) { return w.playerName; }).join(', ') + '</li>';
    });
    if (season.mostImprovedTeam) {
      html += '<li><span class="feed-day" style="min-width:210px;display:inline-block;">Most Improved Team</span>' +
        season.mostImprovedTeam.teamName + '</li>';
    }
    html += '</ul></div>';
  });

  container.innerHTML = html;
}
```

- [x] **Step 4: Rebuild the five `ui/history.js` section builders**

Each returns a `.panel` instead of a bare `<section>`. `renderHistory` itself is unchanged apart from its header line.

```js
function renderChampionsSection() {
  let html = '<div class="panel"><div class="panel-header">Champions</div>';
  if (LEAGUE_HISTORY.champions.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No champion crowned yet.</div></div></div>';
  }
  html += '<ul class="stack-list">';
  LEAGUE_HISTORY.champions.slice().reverse().forEach(function (c) {
    const team = getTeamById(c.teamId);
    html += '<li><span class="pill pill-gold">' + c.leagueYear + '</span> ' +
      (team ? teamLogoImgHtml(team.id, 18) + ' ' + team.name : 'Unknown') + '</li>';
  });
  return html + '</ul></div>';
}

function renderHallOfFameSection() {
  const inducted = LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; });
  let html = '<div class="panel"><div class="panel-header">Hall of Fame</div>';
  if (inducted.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No one inducted yet.</div></div></div>';
  }
  html += '<table class="data-table"><thead><tr><th>Name</th><th class="num">Retired</th><th class="num">Pts</th>' +
    '<th class="num">Reb</th><th class="num">Ast</th><th class="num">Titles</th></tr></thead><tbody>';
  inducted.forEach(function (r) {
    html += '<tr><td class="col-name">' + r.name + '</td><td class="num">' + r.retiredYear + '</td><td class="num">' +
      r.careerStats.points + '</td><td class="num">' + r.careerStats.rebounds + '</td><td class="num">' +
      r.careerStats.assists + '</td><td class="num">' + r.championshipsWon + '</td></tr>';
  });
  return html + '</tbody></table></div>';
}

function renderRecordsSection() {
  let html = '<div class="panel"><div class="panel-header">Records</div><div class="panel-body">';
  html += '<h4>Career Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += careerLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Single-Season Leaders</h4>';
  Object.keys(RECORD_STAT_LABELS).forEach(function (statKey) {
    html += '<p><strong>' + RECORD_STAT_LABELS[statKey] + ':</strong> ';
    html += singleSeasonLeaders(statKey, 5).map(function (l) { return l.name + ' (' + l.value + ')'; }).join(', ');
    html += '</p>';
  });
  html += '<h4>Most Franchise Wins</h4><p>';
  html += franchiseWinLeaders(5).map(function (l) { return l.name + ' (' + l.allTimeWins + ')'; }).join(', ');
  return html + '</p></div></div>';
}

function renderDraftArchiveSection() {
  let html = '<div class="panel"><div class="panel-header">Draft Archive</div>';
  if (LEAGUE_HISTORY.draftClasses.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No drafts completed yet.</div></div></div>';
  }
  html += '<div class="panel-body">';
  LEAGUE_HISTORY.draftClasses.slice().reverse().forEach(function (dc) {
    html += '<h4>' + dc.leagueYear + '</h4><ol>';
    dc.picks.slice().sort(function (a, b) { return a.pickNumber - b.pickNumber; }).forEach(function (p) {
      const team = getTeamById(p.teamId);
      html += '<li>' + p.playerName + ' — ' + (team ? team.name : 'Unknown') + '</li>';
    });
    html += '</ol>';
  });
  return html + '</div></div>';
}

function renderTradeArchiveSection() {
  let html = '<div class="panel"><div class="panel-header">Trade Archive</div>';
  if (LEAGUE_HISTORY.trades.length === 0) {
    return html + '<div class="panel-body"><div class="empty-state">No trades executed yet.</div></div></div>';
  }
  html += '<ul class="stack-list">';
  LEAGUE_HISTORY.trades.slice().reverse().forEach(function (t) {
    const teamNames = t.participants.map(function (id) { const team = getTeamById(id); return team ? team.name : 'Unknown'; }).join(' / ');
    const playerNames = t.players.map(function (p) { return p.playerName; }).join(', ');
    html += '<li><span class="pill pill-mute">' + t.leagueYear + '</span> ' + teamNames + ': ' + playerNames + '</li>';
  });
  return html + '</ul></div>';
}
```

And in `renderHistory`, change the heading line only:

```js
  let html = '<div class="view-header"><h2>League History</h2></div>';
```

- [x] **Step 5: Rebuild `ui/saveLoad.js` slot markup**

`saveSlotLabel` is split into structured fields, but `renderSaveSlotRow` keeps all three `data-*-slot` attributes and the `disabled` logic exactly, so every listener block below is untouched.

```js
function renderSaveSlotRow(slot, opts) {
  const label = slot.slotId === 'autosave' ? 'Autosave' : 'Slot ' + slot.slotId;
  let html = '<div class="save-slot' + (slot.empty ? ' is-empty' : '') + '"><div class="save-slot-info">';
  if (slot.empty) {
    html += '<div class="save-slot-name">' + label + ' — empty</div>';
  } else {
    html += '<div class="save-slot-name">' + label + ' · ' + slot.name + '</div>' +
      '<div class="save-slot-meta">' + slot.teamName + ' · ' + slot.wins + '-' + slot.losses +
      ' · ' + (slot.leagueYear || 2026) + ' · saved ' + formatSavedAt(slot.savedAt) + '</div>';
  }
  html += '</div>';
  html += '<button data-load-slot="' + slot.slotId + '"' + (slot.empty ? ' disabled' : '') + '>Load</button>';
  if (opts.showSaveButton) {
    html += '<button class="btn-primary" data-save-slot="' + slot.slotId + '">' + (slot.empty ? 'Save' : 'Overwrite') + '</button>';
  }
  if (opts.showDeleteButton && !slot.empty) {
    html += '<button class="btn-danger" data-delete-slot="' + slot.slotId + '">Delete</button>';
  }
  html += '</div>';
  return html;
}
```

In `renderSaveList`, wrap the slots in a panel:

```js
  let html = '<div class="panel"><div class="panel-header">Load Game</div>';
  slots.forEach(function (slot) { html += renderSaveSlotRow(slot, { showSaveButton: false, showDeleteButton: false }); });
  html += '</div>';
```

In `renderSaveLoad`'s `draw()`, replace the html construction (keeping `#save-name-input`, `#save-slots`, `#save-message`):

```js
    let html = '<div class="view-header"><h2>Save / Load</h2></div>';
    html += '<div class="panel"><div class="panel-header">Save Name</div><div class="panel-body">' +
      '<input type="text" id="save-name-input" value="' + defaultName + '" style="width:320px;"></div></div>';
    html += '<div class="panel"><div class="panel-header">Slots</div><div id="save-slots">';
    slots.forEach(function (slot) {
      html += renderSaveSlotRow(slot, { showSaveButton: slot.slotId !== 'autosave', showDeleteButton: slot.slotId !== 'autosave' });
    });
    html += '</div></div>';
    html += '<div id="save-message" class="kpi-sub"></div>';
```

Note: `saveSlotLabel` is no longer called by `renderSaveSlotRow`, but the function and its `module.exports` line stay in place — it is exported and removing it would change the module's public surface.

- [x] **Step 6: Verify in the browser**

Feed: sim days, confirm timeline entries with day markers. Awards/History: confirm empty states before a season completes. Save/Load: **save to a slot**, confirm the slot card populates with name/team/record/timestamp; **load** it back; **delete** it. All three listener groups must work. Console clean.

- [x] **Step 7: Commit**

```bash
git add ui/liveFeed.js ui/awards.js ui/history.js ui/saveLoad.js style.css && git commit -m "feat(ui): feed timeline, awards, history, and save slot cards"
```

---

### Task 10: Draft, free agency, scouting

**Files:**
- Modify: `ui/draft.js`, `ui/draftPicker.js`, `ui/freeAgency.js`, `ui/scouting.js`
- Modify: `style.css` (append `.bid-panel`, `.toolbar`)

**Interfaces:**
- Consumes: `.panel`, `.data-table`, `.rating-chip`, `.pill`, `.meter`, `.empty-state` from Tasks 3 and 5. Reuses `ratingTier` — since `ui/roster.js` loads before these files and defines it as a global, it is available; do **not** redefine it.

- [x] **Step 1: Append the bidding panel and toolbar CSS**

```css
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.bid-panel {
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  padding: 16px; margin: 14px 0;
  box-shadow: var(--shadow);
  max-width: 420px;
}
.bid-panel label { display: block; margin-bottom: 9px; font-size: .82rem; color: var(--text-dim); }
.bid-panel label input { margin-left: 6px; }
.field-row { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; font-size: .82rem; }
```

- [x] **Step 2: Rebuild `ui/draft.js`**

```js
function renderDraftResults(container, draftResults) {
  let html = '<div class="view-header"><h2>Draft Results</h2><span class="view-sub">' + draftResults.length + ' picks</span></div>';
  if (draftResults.length === 0) {
    container.innerHTML = html + '<div class="empty-state">No draft has been completed yet.</div>';
    return;
  }
  html += '<div class="panel"><table class="data-table"><thead><tr><th class="num">Pick</th><th class="num">Rd</th>' +
    '<th>Team</th><th>Player</th><th>Pos</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>';
  draftResults.forEach(function (r) {
    const team = getTeamById(r.teamId);
    html += '<tr><td class="num">' + r.pickNumber + '</td><td class="num">' + r.round + '</td>' +
      '<td class="col-name">' + teamLogoImgHtml(team.id, 18) + ' ' + team.name + '</td>' +
      '<td class="col-name">' + r.prospect.name + '</td>' +
      '<td><span class="pill pill-pos">' + r.prospect.position + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.overall) + '">' + r.prospect.overall + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.potential) + '">' + r.prospect.potential + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}
```

Note: the hardcoded `'2026 Draft Results'` heading becomes just `'Draft Results'` — the old label was wrong for every year after the first.

- [x] **Step 3: Rebuild `ui/draftPicker.js` markup**

`data-prospect-id` is preserved, so the listener block is untouched.

```js
  let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Round ' + pick.round + ', Pick ' + pick.pickNumber + '</h2>' +
    '<span class="view-sub">' + session.results.length + ' picks made · ' + session.available.length + ' prospects left</span></div>';
  html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
    '<th class="num">OVR</th><th>Scouted</th><th class="num"></th></tr></thead><tbody>';
  sorted.forEach(function (p) {
    const target = GameState.scouting.targets[p.id];
    const confidence = target ? target.confidence : 0;
    const revealed = getRevealedView(p, confidence);
    const scoutPill = revealed.level === 'exact'
      ? '<span class="pill pill-win">Fully scouted</span>'
      : (revealed.level === 'fuzzy' ? '<span class="pill pill-gold">Partial</span>' : '<span class="pill pill-mute">Unscouted</span>');
    html += '<tr><td class="col-name">' + p.name + '</td>' +
      '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
      '<td class="num">' + p.age + '</td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
      '<td>' + scoutPill + '</td>' +
      '<td class="actions"><button class="btn-primary" data-prospect-id="' + p.id + '">Draft</button></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
```

- [x] **Step 4: Rebuild `ui/freeAgency.js` markup**

`#resolve-remaining-btn`, `data-offer-id`, `#bidding-panel`, and `#signing-log` are all preserved.

In `draw()`:

```js
    if (GameState.playMode === 'spectator') {
      container.innerHTML = '<div class="view-header"><h2>Free Agency</h2></div>' +
        '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      return;
    }

    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });

    let html = '<div class="view-header"><h2>Free Agency</h2><span class="view-sub">' + pool.length + ' available</span></div>';
    html += '<div class="toolbar"><button id="resolve-remaining-btn" class="btn-ghost">Resolve Remaining Free Agents</button></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
      '<th class="num">OVR</th><th class="num">Action</th></tr></thead><tbody>';
    pool.forEach(function (p) {
      html += '<tr><td class="col-name">' + p.name + '</td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
        '<td class="actions"><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div id="bidding-panel"></div>';
    html += '<div class="panel"><div class="panel-header">Recent Signings</div><ul class="stack-list" id="signing-log">' +
      signingLog.slice(-15).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>';

    container.innerHTML = html;
```

In `renderBiddingPanel`'s `draw()`, keeping `#bid-salary`, `#bid-years`, `#submit-bid-btn`, `#accept-bid-btn`, `#withdraw-bid-btn`:

```js
    let html = '<div class="bid-panel"><h3>Bidding for ' + player.name + '</h3>';
    html += '<div class="kpi-sub">Competing offers: ' + state.aiOffers.length + '</div>';
    if (lastResult) {
      html += lastResult.userWinning
        ? '<p><span class="pill pill-win">Leading</span> Your offer is currently winning.</p>'
        : '<p><span class="pill pill-loss">Behind</span> A competing offer is ahead' +
          (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') + '.</p>';
    }
    html += '<div class="field-row"><label style="margin:0;">Salary $</label><input type="number" id="bid-salary" value="5000000" step="100000" style="width:140px;"></div>';
    html += '<div class="field-row"><label style="margin:0;">Years</label><input type="number" id="bid-years" value="2" min="1" max="5" style="width:70px;"></div>';
    html += '<div class="toolbar" style="margin:14px 0 0;">' +
      '<button id="submit-bid-btn">Submit Offer</button>' +
      '<button id="accept-bid-btn" class="btn-primary"' + (lastResult ? '' : ' disabled') + '>Sign Player</button>' +
      '<button id="withdraw-bid-btn" class="btn-ghost">Withdraw</button></div>';
    html += '</div>';
    container.innerHTML = html;
```

- [x] **Step 5: Rebuild `ui/scouting.js` markup**

All of `#scouting-add-select`, `#scouting-add-btn`, `#scouting-report`, `data-alloc-id`, `data-spend-id`, `data-report-id`, `data-unwatch-id` are preserved.

In `renderScouting`'s `draw()`:

```js
    const state = GameState.scouting;
    let html = '<div class="view-header"><h2>Scouting</h2><span class="view-sub">' +
      Math.round(state.pointsAvailable) + ' scout points available this week</span></div>';

    const watchlistIds = Object.keys(state.targets).filter(function (id) { return state.targets[id].watchlisted; });
    html += '<div class="panel"><div class="panel-header">Watchlist</div>';
    if (watchlistIds.length === 0) {
      html += '<div class="panel-body"><div class="empty-state">No players watchlisted yet. Add players below.</div></div>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Name</th><th>Team</th><th class="num">Confidence</th>' +
        '<th>Allocate</th><th class="num"></th></tr></thead><tbody>';
      watchlistIds.forEach(function (id) {
        const player = findScoutableById(id);
        if (!player) return;
        const conf = state.targets[id].confidence;
        html += '<tr><td class="col-name">' + player.name + '</td>' +
          '<td>' + (player.teamId ? teamLogoImgHtml(player.teamId, 18) + ' ' + getTeamById(player.teamId).name : '<span class="pill pill-mute">Prospect</span>') + '</td>' +
          '<td class="num">' + Math.round(conf) + '%<div class="meter"><div class="meter-fill" style="width:' + Math.round(conf) + '%"></div></div></td>' +
          '<td><input type="number" min="0" max="' + Math.round(state.pointsAvailable) + '" value="10" data-alloc-id="' + id + '" style="width:64px"> ' +
          '<button class="btn-ghost" data-spend-id="' + id + '">Spend</button></td>' +
          '<td class="actions"><button data-report-id="' + id + '">Report</button> ' +
          '<button class="btn-danger" data-unwatch-id="' + id + '">Remove</button></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="panel"><div class="panel-header">Add to Watchlist</div><div class="panel-body"><div class="toolbar">';
    html += '<select id="scouting-add-select" style="min-width:280px;"><option value="">Choose a player or prospect...</option>';
    scoutablePool().forEach(function (p) {
      if (state.targets[p.id] && state.targets[p.id].watchlisted) return;
      html += '<option value="' + p.id + '">' + p.name + (p.teamId ? ' (' + getTeamById(p.teamId).name + ')' : ' (Prospect)') + '</option>';
    });
    html += '</select> <button id="scouting-add-btn" class="btn-primary">Add</button></div></div></div>';

    html += '<div id="scouting-report"></div>';

    container.innerHTML = html;
```

And in `renderScoutingReport`, wrap the report in a panel — the `???` placeholders and all three reveal levels are preserved verbatim:

```js
  let html = '<div class="panel"><div class="panel-header">Scouting Report — ' + player.name + '</div><div class="panel-body">';
  html += '<div class="kpi-label">Confidence</div><div class="kpi-value">' + Math.round(confidence) + '% ' +
    '<span class="pill pill-mute">' + view.level + '</span></div>';
  html += '<div class="meter" style="margin:8px 0 16px;"><div class="meter-fill" style="width:' + Math.round(confidence) + '%"></div></div>';
```

then keep the existing Traits / Personality / Tendencies blocks exactly as they are, and close with:

```js
  html += '</div></div>';
  container.innerHTML = html;
```

- [x] **Step 6: Verify in the browser**

Scouting: add a player to the watchlist, spend points on them, open the report, remove them — all four listener groups. Free Agency: sim to free agency, click Make Offer, submit a bid, then sign or withdraw. Draft: sim to draft with auto-draft **off** so the picker appears, and draft a prospect. Console clean.

- [x] **Step 7: Commit**

```bash
git add ui/draft.js ui/draftPicker.js ui/freeAgency.js ui/scouting.js style.css && git commit -m "feat(ui): draft, free agency, and scouting panels"
```

---

### Task 11: Settings, trade center, commissioner

**Files:**
- Modify: `ui/settings.js`, `ui/tradeCenter.js`, `ui/commissioner.js`
- Modify: `style.css` (append `.toggle-row`, `.trade-grid`, `.balance`)

**Interfaces:**
- Consumes: `.panel`, `.data-table`, `.toolbar`, `.pill` from Tasks 5 and 10.

- [x] **Step 1: Append the CSS**

```css
.toggle-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 14px; border-bottom: 1px solid var(--line);
  font-size: .85rem; cursor: pointer;
}
.toggle-row:last-child { border-bottom: none; }
.toggle-row:hover { background: var(--surface-2); }
.toggle-row input { margin-top: 2px; flex-shrink: 0; }
.toggle-row.is-disabled { opacity: .45; cursor: not-allowed; }

.trade-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.balance { display: flex; gap: 18px; padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
.balance-item { flex: 1; }
.balance-label { font-size: .62rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text-mute); }
.balance-value { font-size: .95rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.form-grid { display: grid; grid-template-columns: 128px 1fr; gap: 9px 12px; align-items: center; max-width: 440px; }
.form-grid label { font-size: .82rem; color: var(--text-dim); }
```

- [x] **Step 2: Rebuild `ui/settings.js` markup**

Every `input[name=...]`, `data-automation-key`, `data-pause-on-key`, `#settings-disable-cap`, and `#settings-team-picker` is preserved, so all five listener blocks are untouched. Only `style="display:block"` on labels becomes `class="toggle-row"`.

```js
function renderSettings(container) {
  let html = '<div class="view-header"><h2>Settings</h2></div>';

  html += '<div class="panel"><div class="panel-header">Play Mode <span class="pill pill-mute">' + GameState.playMode + '</span></div>';
  ['gm', 'commissioner', 'spectator'].forEach(function (mode) {
    html += '<label class="toggle-row"><input type="radio" name="play-mode-switch" value="' + mode + '"' +
      (GameState.playMode === mode ? ' checked' : '') + '> ' + mode + '</label>';
  });
  if (!GameState.userTeamId) {
    html += '<div class="panel-body"><p class="kpi-sub">No team selected yet — choose one before switching out of Spectator.</p>';
    html += '<select id="settings-team-picker">' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select></div>';
  }
  html += '</div>';

  html += '<div class="panel"><div class="panel-header">Simulation Engine</div>';
  Object.keys(SIM_ENGINES).forEach(function (engineName) {
    const available = SIM_ENGINES[engineName] !== null;
    const checked = GameState.settings.simEngine === engineName ? ' checked' : '';
    const disabled = available ? '' : ' disabled';
    html += '<label class="toggle-row' + (available ? '' : ' is-disabled') + '"><input type="radio" name="sim-engine" value="' +
      engineName + '"' + checked + disabled + '> ' + ENGINE_LABELS[engineName] + '</label>';
  });
  html += '</div>';

  if (GameState.playMode !== 'spectator') {
    html += '<div class="panel"><div class="panel-header">Automation</div>';
    Object.keys(AUTOMATION_LABELS).forEach(function (key) {
      html += '<label class="toggle-row"><input type="checkbox" data-automation-key="' + key + '"' +
        (GameState.automation[key] ? ' checked' : '') + '> ' + AUTOMATION_LABELS[key] + '</label>';
    });
    html += '</div>';

    html += '<div class="panel"><div class="panel-header">Pause Multi-Season Sim On</div>';
    Object.keys(PAUSE_ON_LABELS).forEach(function (key) {
      html += '<label class="toggle-row"><input type="checkbox" data-pause-on-key="' + key + '"' +
        (GameState.settings.pauseOn[key] ? ' checked' : '') + '> ' + PAUSE_ON_LABELS[key] + '</label>';
    });
    html += '</div>';

    if (GameState.playMode === 'commissioner') {
      html += '<div class="panel"><div class="panel-header">Commissioner</div>';
      html += '<label class="toggle-row"><input type="checkbox" id="settings-disable-cap"' +
        (GameState.settings.capDisabled ? ' checked' : '') +
        '> Disable Salary Cap (free agency and trades ignore cap space entirely)</label></div>';
    }
  }

  container.innerHTML = html;
```

The entire listener block below `container.innerHTML = html;` stays exactly as it is.

- [x] **Step 3: Rebuild `ui/tradeCenter.js` markup**

Inside `draw()`, keeping `#add-team-select`, `.trade-team-panel[data-team-id]`, `data-player-id`, `data-from-team`, `data-dest-for`, `data-pick-round`, `data-pick-from`, `data-pick-dest-round`, `data-pick-dest-from`, `#trade-result`, `#propose-trade-btn`, `#force-trade-btn`, `data-accept-offer`, `data-decline-offer`:

```js
    let html = '<div class="view-header"><h2>Trade Center</h2></div>';

    if (GameState.playMode === 'spectator') {
      html += '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      container.innerHTML = html;
      return;
    }

    if (GameState.tradeOffers.length > 0) {
      html += '<div class="panel"><div class="panel-header">Incoming Offers <span class="pill pill-gold">' +
        GameState.tradeOffers.length + '</span></div><ul class="stack-list">';
      GameState.tradeOffers.forEach(function (offer, i) {
        const partnerId = offer.proposal.participants.find(function (id) { return id !== userTeamId; });
        const partner = getTeamById(partnerId);
        const mine = offer.proposal.assignments.find(function (a) { return a.fromTeamId === userTeamId; });
        const theirs = offer.proposal.assignments.find(function (a) { return a.fromTeamId === partnerId; });
        html += '<li>' + teamLogoImgHtml(partnerId, 18) + ' <strong>' + partner.name + '</strong> offers ' +
          getPlayerById(theirs.playerId).name + ' for your ' + getPlayerById(mine.playerId).name +
          ' <button class="btn-primary" data-accept-offer="' + i + '">Accept</button> ' +
          '<button class="btn-ghost" data-decline-offer="' + i + '">Decline</button></li>';
      });
      html += '</ul></div>';
    }

    html += '<div class="toolbar"><span class="dock-label">Add participant</span>' +
      '<select id="add-team-select"><option value="">Add a team...</option>';
    TEAMS.forEach(function (t) {
      if (state.participants.indexOf(t.id) === -1) {
        html += '<option value="' + t.id + '">' + t.name + '</option>';
      }
    });
    html += '</select></div>';

    html += '<div class="trade-grid">';
```

Then inside the `state.participants.forEach` loop, replace the panel opening (all value/salary computation above it is unchanged):

```js
      html += '<div class="trade-team-panel panel" data-team-id="' + teamId + '">';
      html += '<div class="panel-header">' + teamLogoImgHtml(teamId, 20) + ' ' + team.name +
        (teamId === userTeamId ? ' <span class="pill pill-mute">You</span>' : '') + '</div>';
      html += '<div class="balance">' +
        '<div class="balance-item"><div class="balance-label">Value Out / In</div>' +
        '<div class="balance-value">' + (outgoingValue + outgoingPickValue).toFixed(1) + ' → ' + (incomingValue + incomingPickValue).toFixed(1) + '</div></div>' +
        '<div class="balance-item"><div class="balance-label">Salary Out / In</div>' +
        '<div class="balance-value">$' + Math.round(outgoingSalary / 1e6) + 'M → $' + Math.round(incomingSalary / 1e6) + 'M</div></div>' +
        '</div>';

      html += '<table class="data-table"><thead><tr><th>Player</th><th class="num">In</th><th>Send to</th></tr></thead><tbody>';
      roster.forEach(function (p) {
        const assignment = state.assignments.find(function (a) { return a.playerId === p.id; });
        html += '<tr><td class="col-name">' + p.name + ' <span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="num"><input type="checkbox" data-player-id="' + p.id + '" data-from-team="' + teamId + '"' + (assignment ? ' checked' : '') + '></td>' +
          '<td><select data-dest-for="' + p.id + '"' + (assignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = assignment && assignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></td></tr>';
      });
      html += '</tbody></table>';

      html += '<div class="panel-body"><div class="kpi-label">Draft Picks</div>';
      [1, 2].forEach(function (round) {
        const pick = findPick(teamId, round);
        if (!pick) return;
        const pickAssignment = state.pickAssignments.find(function (pa) { return pa.fromTeamId === teamId && pa.round === round; });
        html += '<div class="field-row"><label style="margin:0;"><input type="checkbox" data-pick-round="' + round +
          '" data-pick-from="' + teamId + '"' + (pickAssignment ? ' checked' : '') + '> Round ' + round + '</label>';
        html += '<select data-pick-dest-round="' + round + '" data-pick-dest-from="' + teamId + '"' + (pickAssignment ? '' : ' disabled') + '>';
        state.participants.filter(function (t) { return t !== teamId; }).forEach(function (destId) {
          const selected = pickAssignment && pickAssignment.toTeamId === destId ? ' selected' : '';
          html += '<option value="' + destId + '"' + selected + '>' + getTeamById(destId).name + '</option>';
        });
        html += '</select></div>';
      });
      html += '</div></div>';
```

And after the loop, close the grid and style the actions:

```js
    html += '</div>';
    html += '<div id="trade-result">' + (state.resultMessage || '') + '</div>';
    state.resultMessage = null;
    html += '<div class="toolbar"><button id="propose-trade-btn" class="btn-primary">Propose Trade</button>';
    if (GameState.playMode === 'commissioner') {
      html += '<button id="force-trade-btn" class="btn-danger">Force Trade</button>';
    }
    html += '</div>';

    container.innerHTML = html;
    wireEvents();
```

`wireEvents()` itself is not edited.

- [x] **Step 4: Rebuild `ui/commissioner.js` section markup**

Each of the four `render*Section` functions returns a `.panel` instead of a bare `<section>`, and the create/expansion forms use `.form-grid`. Every id and `data-edit-*` attribute is preserved, so all four `wire*Events` functions are untouched.

Change `renderCommissioner`'s heading line to:

```js
    let html = '<div class="view-header"><h2>Commissioner Tools</h2></div>';
```

Then in each section, replace `'<section><h3>X</h3>'` with `'<div class="panel"><div class="panel-header">X</div><div class="panel-body">'` and the closing `'</section>'` with `'</div></div>'`. For the two form sections, wrap the labeled inputs in `.form-grid` and drop the `<br>` separators:

```js
function renderCreatePlayerSection(state) {
  let html = '<div class="panel"><div class="panel-header">Create Player</div><div class="panel-body"><div class="form-grid">';
  html += '<label>Name</label><input type="text" id="commissioner-create-name">';
  html += '<label>Position</label><select id="commissioner-create-position">' + POSITIONS.map(function (pos) { return '<option value="' + pos + '">' + pos + '</option>'; }).join('') + '</select>';
  html += '<label>Age</label><input type="number" id="commissioner-create-age" min="18" max="45" value="22">';
  html += '<label>Overall</label><input type="number" id="commissioner-create-overall" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="60">';
  html += '<label>Potential</label><input type="number" id="commissioner-create-potential" min="' + RATING_MIN + '" max="' + RATING_MAX + '" value="70">';
  html += '<label>Archetype</label><select id="commissioner-create-archetype">' + CREATE_PLAYER_ARCHETYPES.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select>';
  html += '<label>Team</label><select id="commissioner-create-team"><option value="">Free Agent</option>' + TEAMS.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') + '</select>';
  html += '</div><div class="toolbar"><button id="commissioner-create-btn" class="btn-primary">Create Player</button>';
  if (state.createMessage) {
    html += '<span class="kpi-sub">' + state.createMessage + '</span>';
  }
  html += '</div></div></div>';
  return html;
}

function renderExpansionTeamSection(state) {
  let html = '<div class="panel"><div class="panel-header">Create Expansion Team</div><div class="panel-body"><div class="form-grid">';
  html += '<label>Name</label><input type="text" id="commissioner-expansion-name">';
  html += '<label>Primary Color</label><input type="color" id="commissioner-expansion-primary" value="#1D1160">';
  html += '<label>Secondary Color</label><input type="color" id="commissioner-expansion-secondary" value="#FFFFFF">';
  html += '<label>Market Size (1-100)</label><input type="number" id="commissioner-expansion-market" min="1" max="100" value="50">';
  html += '</div><div class="toolbar"><button id="commissioner-expansion-btn" class="btn-primary">Create Expansion Team</button></div>';
  if (state.expansionResult) {
    html += '<p class="kpi-sub">Created ' + state.expansionResult.name + ' (' + state.expansionResult.conference + ' — ' + state.expansionResult.division + '), roster of ' +
      getTeamRoster(state.expansionResult.id).length + ' via expansion draft. Takes effect next season.</p>';
  }
  html += '</div></div>';
  return html;
}
```

For `renderEditPlayerSection`, keep the `data-edit-field` / `data-edit-attribute` inputs and their `<table>` exactly, adding `class="data-table"` to the table and wrapping the select in a `.toolbar`. For `renderDeletePlayerSection`, keep the two-click confirm state logic and all three button ids exactly, wrapping them in a `.toolbar`.

- [x] **Step 5: Verify in the browser**

Settings: toggle each automation and pause-on checkbox and confirm `GameState` updates in the console; switch the sim engine radio; switch play mode. Trade Center: add a participant team, check a player, change their destination, check a draft pick, and propose the trade — confirm the accept/reject message renders. Commissioner (in commissioner mode): select a player and edit a rating, use the two-click delete, create a player, create an expansion team. Console clean.

- [x] **Step 6: Commit**

```bash
git add ui/settings.js ui/tradeCenter.js ui/commissioner.js style.css && git commit -m "feat(ui): settings toggle rows, trade grid, commissioner panels"
```

---

### Task 12: Team select screen

**Files:**
- Modify: `ui/teamSelect.js` (the `container.innerHTML` string and the card `innerHTML`)
- Modify: `style.css` (append `.select-screen`, `.team-grid`, retune `.team-card`, `.segmented`)

**Interfaces:**
- Consumes: `.panel` from Task 5, `renderSaveList` from Task 9.

This is last because it is the first screen a player sees, and doing it after the in-app shell means the two are styled consistently rather than guessed at.

- [x] **Step 1: Append the select screen CSS**

```css
.select-screen { max-width: 1080px; margin: 0 auto; padding: 44px 24px 64px; }
.select-title { text-align: center; font-size: 2rem; font-weight: 800; letter-spacing: -.02em; margin-bottom: 6px; }
.select-sub { text-align: center; color: var(--text-mute); margin-bottom: 26px; }

.segmented { display: flex; justify-content: center; gap: 0; margin-bottom: 28px; }
.segmented label {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 18px; cursor: pointer;
  background: var(--surface-1); border: 1px solid var(--line-strong);
  font-size: .85rem; color: var(--text-dim);
}
.segmented label:first-child { border-radius: var(--r-sm) 0 0 var(--r-sm); }
.segmented label:last-child { border-radius: 0 var(--r-sm) var(--r-sm) 0; border-left: none; }
.segmented label:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }

.team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 12px; margin-bottom: 28px; }
.team-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 18px 12px; cursor: pointer;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  color: #fff; text-align: center;
  transition: transform .14s ease, box-shadow .14s ease;
}
.team-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.team-card-name { font-weight: 700; font-size: .88rem; line-height: 1.25; text-shadow: 0 1px 3px rgba(0,0,0,.55); }
.team-card-meta { font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; opacity: .8; }
.select-actions { text-align: center; margin-bottom: 26px; }
```

- [x] **Step 2: Rebuild `ui/teamSelect.js`**

`input[name="play-mode"]`, `#team-grid`, `#spectate-league-btn`, and `#load-game-section` are all preserved, so the three listener blocks below are untouched. The `.team-card` click listener is attached per-card in JS exactly as before.

```js
function renderTeamSelect(container, onSelect, onLoadGame, onSpectate) {
  container.innerHTML =
    '<div class="select-screen">' +
    '<div class="select-title">Choose Your Franchise</div>' +
    '<div class="select-sub">Take control of any team in the league.</div>' +
    '<div class="segmented">' +
    '<label><input type="radio" name="play-mode" value="gm" checked> GM <span class="kpi-sub">manual control</span></label>' +
    '<label><input type="radio" name="play-mode" value="commissioner"> Commissioner <span class="kpi-sub">+ sandbox tools</span></label>' +
    '</div>' +
    '<div id="team-grid" class="team-grid"></div>' +
    '<div class="select-actions"><button id="spectate-league-btn" class="btn-ghost">Spectate League (fully automated)</button></div>' +
    '<div id="load-game-section"></div>' +
    '</div>';

  const grid = container.querySelector('#team-grid');
  TEAMS.forEach(function (team) {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.style.background = 'linear-gradient(150deg, ' + team.colors.primary + ' 0%, ' + team.colors.secondary + ' 190%)';
    card.style.borderColor = team.colors.secondary;
    card.innerHTML = teamLogoImgHtml(team.id, 46) +
      '<div class="team-card-name">' + team.name + '</div>' +
      '<div class="team-card-meta">' + team.division + '</div>';
    card.addEventListener('click', function () {
      const mode = container.querySelector('input[name="play-mode"]:checked').value;
      onSelect(team.id, mode);
    });
    grid.appendChild(card);
  });

  document.getElementById('spectate-league-btn').addEventListener('click', onSpectate);

  renderSaveList(container.querySelector('#load-game-section'), onLoadGame);
}
```

- [x] **Step 3: Verify in the browser**

Reload. Expected: a centered grid of 30 gradient team cards with logos, a segmented GM/Commissioner control, spectate button, and the load-game panel. Confirm: selecting **Commissioner** then a team enters commissioner mode (Commissioner appears in the sidebar); the **Spectate** button starts an automated league; a **saved slot loads** from this screen. Console clean.

- [x] **Step 4: Commit**

```bash
git add ui/teamSelect.js style.css && git commit -m "feat(ui): team select screen with gradient franchise cards"
```

---

### Task 13: Full regression sweep

**Files:** none modified unless a defect is found.

- [x] **Step 1: Re-run the full validator suite**

```bash
cd "C:/Users/cory/Desktop/nba" && for f in scripts/validate-*.js; do echo "== $f"; node "$f" 2>&1 | tail -3; done
```

Expected: identical results to the Task 1 baseline. Any difference means gameplay logic was touched and must be reverted.

- [x] **Step 2: Full-game playthrough**

In one continuous session, exercise the complete loop and confirm the console stays clean throughout:

1. Team select → pick a team in GM mode.
2. Dashboard → Roster (sort, scout, waive) → Standings → Schedule (open a box score).
3. Sim to Trade Deadline. Check the Live Feed populated.
4. Trade Center: accept or decline any incoming offer; build and propose a manual trade.
5. Scouting: watchlist a player, spend points, open the report.
6. Settings: toggle automation flags.
7. Sim to End of Regular Season, then through the playoffs.
8. Advance to Offseason → **confirm sim dock buttons still work** (the Task 4 fix) → Draft → Free Agency → Start New Season.
9. Save to a slot, reload the page, load the save, confirm state resumes.

- [x] **Step 3: Verify every view renders under a cold spectator start**

Reload, click Spectate League, and visit all 16 nav items. Spectator mode takes different branches in Trade Center, Free Agency, and Settings — confirm each shows its empty state rather than erroring.

- [x] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(ui): regression sweep corrections"
```

If no defects were found, skip this step — there is nothing to commit.
