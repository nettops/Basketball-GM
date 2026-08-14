# Broadcast Scoreboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans
> (inline — this user never uses subagent-driven execution). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the app to the Broadcast Scoreboard direction (spec:
`docs/superpowers/specs/2026-08-14-broadcast-ui-design.md`): ZenGM density
underneath, team-color ribbon + icon rail + rating chips on top.

**Architecture:** Extend the existing chrome files rather than the spec's
proposed new `ui/chrome.js` — discovery showed `ui/topbar.js` already owns
team theming (`applyTeamAccent` with a luminance guard that already handles
BKN black) and `ui/nav.js` owns the sidebar; a third chrome file would
split one responsibility across three files. This is the one deliberate
deviation from the spec's architecture section; every visual requirement is
unchanged.

**Tech Stack:** Vanilla JS + one hand-written style.css. Zero dependencies,
no webfonts, no build step.

## Global Constraints

- Every existing DOM id and view keeps working; ui-smoke's 182 checks must
  stay green (they assert ids/text, not colors).
- Nav behavior identical: same hubs, same first-view-on-click, same
  `data-hub` attributes, label text still present in the DOM (flyout span)
  so text queries keep finding it.
- No hardcoded rating numbers: chips read `ratings.RATING_BANDS`.
- Team color is trim, never the surface under text (ribbon text sits on a
  dark scrim).

---

### Task 1: Density + broadcast foundations in style.css

**Files:** Modify: `style.css`

- [x] **Step 1: Tokens + base density.** In `:root` add
  `--team-primary: #007A33; --team-secondary: #BA9653;
  --font-cond: "Arial Narrow", "Segoe UI", Roboto, Arial, sans-serif;`.
  Change body `font-size: 14px` → `13px`. Add
  `.cond { font-family: var(--font-cond); text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }`.
- [x] **Step 2: Table density.** Find the table rules; set cell padding to
  `5px 8px`, header rules to
  `font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-dim); border-bottom: 1px solid var(--accent);`
  and row borders to 1px hairlines on `--line` at reduced strength. Panels
  (`.panel` or equivalent) drop to `padding: 10px 12px`.
- [x] **Step 3: New component classes** (append, complete):

```css
/* Broadcast ribbon */
.ribbon { display: flex; align-items: stretch; border-bottom: 2px solid var(--accent);
  background: linear-gradient(90deg, var(--team-primary) 0, rgba(11,14,20,.92) 300px, var(--surface-1) 520px, var(--surface-1) 100%); }
.ribbon-scrim { display: flex; align-items: center; gap: 10px; padding: 8px 16px 8px 12px;
  background: linear-gradient(90deg, rgba(0,0,0,.35), rgba(0,0,0,0)); }
.ribbon-name { font-size: 17px; line-height: 1.1; }
.ribbon-sub { font-size: 11.5px; color: rgba(255,255,255,.75); font-variant-numeric: tabular-nums; }
.ribbon-ticker { display: flex; align-items: center; gap: 20px; margin-left: auto; padding: 0 16px; }
.tick { text-align: right; }
.tick .tick-k { display: block; font-size: 9px; letter-spacing: .15em; text-transform: uppercase; color: var(--text-mute); }
.tick .tick-v { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.tick .tick-v.is-over { color: var(--warn); }

/* Icon rail */
.app-sidebar { width: 56px; }
.rail-item { position: relative; width: 40px; height: 40px; margin: 2px auto; display: flex;
  align-items: center; justify-content: center; background: none; border: none; border-radius: 8px;
  color: var(--text-dim); cursor: pointer; padding: 0; }
.rail-item svg { width: 20px; height: 20px; }
.rail-item:hover { background: var(--surface-2); color: var(--text); }
.rail-item.active { background: var(--accent-soft); color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent); }
.rail-label { position: absolute; left: 46px; top: 50%; transform: translateY(-50%);
  background: var(--surface-3); border: 1px solid var(--line-strong); border-radius: 6px;
  padding: 4px 10px; font-size: 12px; color: var(--text); white-space: nowrap;
  opacity: 0; pointer-events: none; transition: opacity .1s ease; z-index: 40; }
.rail-item:hover .rail-label, .rail-item:focus-visible .rail-label { opacity: 1; }

/* Rating + stat chips */
.ovr-chip { display: inline-block; min-width: 26px; text-align: center; font-weight: 900;
  border-radius: 4px; padding: 1px 4px; background: var(--surface-3);
  font-variant-numeric: tabular-nums; }
.ovr-chip.is-elite { background: var(--accent); color: #06101D; }
.ovr-chip.is-star { background: var(--accent-soft); color: var(--accent); }
.stat-chips { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.stat-chip { background: var(--surface-1); border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 6px; padding: 5px 12px; }
.stat-chip .tick-k { display: block; font-size: 9px; letter-spacing: .15em;
  text-transform: uppercase; color: var(--text-mute); }
.stat-chip .tick-v { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
```

- [x] **Step 4:** Load the app in the browser; every view still renders
  (denser, old topbar/sidebar still present). No console errors.
- [x] **Step 5:** Commit `style: broadcast tokens + ZenGM density pass`.

### Task 2: Team ribbon (ui/topbar.js)

**Files:** Modify: `ui/topbar.js`
**Interfaces:** Produces the same `renderTopBar(container)` global;
`applyTeamAccent(team)` additionally sets `--team-primary/--team-secondary`.

- [x] **Step 1:** In `applyTeamAccent`, after the accent writes, add:

```js
  const colors = (team && team.colors) || {};
  document.documentElement.style.setProperty('--team-primary', colors.primary || '#007A33');
  document.documentElement.style.setProperty('--team-secondary', colors.secondary || '#BA9653');
```

- [x] **Step 2:** Rewrite `renderTopBar`'s innerHTML to the ribbon: left
  `ribbon-scrim` block (logo, `.cond.ribbon-name` team name,
  `.ribbon-sub` record · conference standing), right `.ribbon-ticker`
  with `tick` readouts for Season / Day / Stage / Payroll (`is-over` when
  over cap) / Chemistry. Keep the same data sources already in the
  function; keep the root element classed `topbar ribbon` so any existing
  selector on `.topbar` keeps binding.
- [x] **Step 3:** Browser: ribbon shows for BOS with green gradient +
  readable text; switch inspected save to a black-primary team check via
  commissioner or `applyTeamAccent(getTeamById('BKN'))` in console — text
  stays legible (scrim + luminance-guarded accent).
- [x] **Step 4:** Commit `feat: team-color broadcast ribbon`.

### Task 3: Icon rail (ui/nav.js + index.html)

**Files:** Modify: `ui/nav.js`, `index.html`
**Interfaces:** `renderNav(container, activeView, onNavigate, playMode,
gameMode, hasLegacy)` signature unchanged.

- [x] **Step 1:** Add `HUB_ICONS` in ui/nav.js — inline stroke SVGs keyed
  by hub id (`hub-dashboard` grid, `hub-career` user, `hub-roster` users,
  `hub-schedule` calendar, `hub-league` trophy, `hub-transactions` swap
  arrows, `hub-records` chart, `hub-system` gear), all
  `fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"`.
- [x] **Step 2:** In `renderNav`, keep the loop and click handler exactly;
  change the button build to:

```js
    const btn = document.createElement('button');
    btn.className = (activeHub && activeHub.id === hub.id) ? 'rail-item active' : 'rail-item';
    btn.setAttribute('data-hub', hub.id);
    btn.setAttribute('aria-label', hub.label);
    btn.title = hub.label;
    btn.innerHTML = (HUB_ICONS[hub.id] || HUB_ICONS['hub-dashboard']) +
      '<span class="rail-label">' + hub.label + '</span>';
```

- [x] **Step 3:** index.html: `.sidebar-brand` shrinks to the logo mark
  only (`NBA<span>GM</span>` stays, CSS rotates it to a small stacked
  mark or just shrinks font) — CSS-only if possible.
- [x] **Step 4:** Browser: 8 icons render, hover slides labels out, active
  hub glows, clicking navigates identically, `aria-label` present.
- [x] **Step 5:** Commit `feat: icon rail navigation`.

### Task 4: OVR chips + stat chips

**Files:** Modify: `ui/roster.js`, `ui/playerProfile.js`, `ui/dashboard.js`
**Interfaces:** Produces global `ovrChipHtml(player)` (defined in
ui/roster.js, loaded before profile/dashboard use it — check index.html
order; if profile loads first, define in ui/topbar.js instead, which loads
earliest of the chrome files).

- [x] **Step 1:** Helper (complete):

```js
function ovrChipHtml(player) {
  const B = (typeof RATING_BANDS !== 'undefined') ? RATING_BANDS : { superstar: 95, star: 87 };
  const cls = player.overall >= B.superstar ? ' is-elite' : (player.overall >= B.star ? ' is-star' : '');
  return '<span class="ovr-chip' + cls + '">' + player.overall + '</span>';
}
```

- [x] **Step 2:** Roster table's OVR cell renders `ovrChipHtml(p)`;
  profile header's big overall becomes a large chip (same classes, larger
  font via context selector `.profile-hero .ovr-chip { font-size: 18px; }`).
- [x] **Step 3:** Stat-chips row on Roster (OFF RTG / DEF RTG / PACE /
  STREAK from existing team season aggregates — reuse whatever the
  dashboard already computes; if a value is unavailable early-season,
  render '—') and on Dashboard (record / streak / next opponent / cap
  space).
- [x] **Step 4:** Browser check both views; commit
  `feat: rating chips + stat chip rows`.

### Task 5: Dock + headings polish pass

**Files:** Modify: `style.css`, spot-check every view in the browser

- [x] **Step 1:** Page `h2`/view headers get `.cond` sizing via CSS
  (`#view-content h2 { font-family: var(--font-cond); text-transform: uppercase; letter-spacing: .06em; }`)
  — CSS-only so no view file changes.
- [x] **Step 2:** Sim dock: primary Continue button
  `text-transform: uppercase; font-weight: 800;`, dock background gradient
  per preview.
- [x] **Step 3:** Walk every hub in the browser (all 8), screenshot,. fix
  any layout break the density pass caused (wrapped toolbars, cramped
  modals). LOOK at the pages — content checks pass on unstyled markup
  (known bug class).
- [x] **Step 4:** Commit `style: condensed headings + dock polish`.

### Task 6: Smoke coverage + whole-feature verification

**Files:** Modify: `scripts/ui-smoke.js`

- [x] **Step 1:** New smoke group `broadcastChrome`: ribbon element exists
  and contains the team name; rail renders >= 6 `.rail-item`s each with a
  non-empty `aria-label`; exactly one `.rail-item.active` and its
  `data-hub` matches `hubForView(GameState.currentView).id`;
  `--team-primary` on `:root` equals the user team's stored
  `colors.primary`; roster table contains `.ovr-chip`.
- [x] **Step 2:** Full validator suite (56) green.
- [x] **Step 3:** Browser: UI_SMOKE.run() all green (182 + new group);
  screenshots on BOS, LAL, BKN (scrim case).
- [x] **Step 4:** Commit `test: broadcast chrome smoke group`; update the
  spec's checkbox if any, and memory.
