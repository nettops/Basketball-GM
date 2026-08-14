# Broadcast Scoreboard UI — Design

Direction picked by the user 2026-08-14 from three rendered previews
(Dense Dark, ZenGM Classic, Broadcast Scoreboard). The chosen direction is
C — Broadcast Scoreboard — with the icon rail's hover-flyout variant.

## The idea in one sentence

ZenGM's information density underneath (13px type, tight sortable tables,
thin chrome), broadcast-telecast swag on top: a team-color header ribbon
with scoreboard stat readouts, an icon rail, OVR rating chips, condensed
uppercase headings — and the whole app re-colors to the team you run.

## What ZenGM contributes (the bones)

Measured from `reference/zengm/public/css`: base font 0.8125rem (13px) on
the system stack, dense striped data tables with sortable headers, thin
gutters, minimal chrome. We adopt:

- Base type 13px system stack, `font-variant-numeric: tabular-nums` on
  every table and stat readout.
- Table rows at ~24px: `padding: 5px 8px`, single hairline row borders,
  hover tint, right-aligned numeric columns, sortable headers with a ▾ on
  the active sort.
- One-line toolbars; no card-per-widget padding. The current UI's roomy
  panels shrink to content-first blocks.

## What is ours (the swag)

**1. Team ribbon (replaces the topbar).** A full-width header strip:
left block carries the team logo disc, condensed-uppercase team name, and
record/standing; a gradient runs from the team's `colors.primary` into the
app's charcoal. Right side is a scoreboard ticker: SEASON / DAY / PAYROLL /
CHEMISTRY as label-over-value readouts (9px uppercase label, 15px bold
tabular value; payroll turns amber when over the cap). Data is identical
to today's topbar — only the presentation changes.

**2. Icon rail (replaces the text sidebar).** A 52px rail with one icon
per NAV_HUB (8 hubs: Dashboard, Career, Roster, Schedule, League,
Transactions, Records, System). The active hub gets the green glow chip.
Hovering an icon slides out a flyout label; the existing per-hub tab strip
(ui/nav.js) is unchanged and carries all sub-view navigation, so no view
loses reachability. Keyboard/AT users get `title` + `aria-label` on every
rail item.

**3. Rating chips.** Display OVR renders as a small chip
(`min-width 26px, border-radius 4px, font-weight 900`): green fill at the
superstar band, dark-green tint at star, neutral dark otherwise — bands
read from `ratings.RATING_BANDS`, never hardcoded numbers. Used in roster
tables, player profile header, and compare view.

**4. Condensed display type.** Page titles and the team name set in a
condensed face (`"Arial Narrow", system fallback` — zero-dependency rule
forbids webfonts), uppercase, wide tracking. Body and tables stay on the
system stack.

**5. Team-color theming.** A `applyTeamTheme(team)` helper writes
`--team-primary` / `--team-secondary` CSS custom properties on `:root`
from `teams.js`'s existing `colors` field (all 30 teams already carry
primary/secondary hexes). The ribbon gradient, the rail's active glow, and
accent details read the variables. Called at init, on loadGame, and when
the user's team changes (expansion/commissioner reassignment). Dark
charcoal stays the ground everywhere; team color is trim, not surface —
legibility never depends on an arbitrary team hex. Guard: text never sits
directly on `--team-primary`; the ribbon overlays a fixed dark scrim
before text.

**6. Stat chips row.** Views that open with a summary (Roster, Dashboard,
Standings) get a row of bordered chips (label-over-value, green left
edge): e.g. Roster shows OFF RTG / DEF RTG / PACE / STREAK. Chips are a
CSS class + tiny helper, not per-view bespoke markup.

## What does NOT change

- No view is added, removed, merged, or re-routed. NAV_HUBS, the tab
  strip, and every ui/*.js view keep their structure and DOM ids — this
  is a re-skin plus two chrome swaps (topbar→ribbon, sidebar→rail), not a
  navigation redesign.
- The pixel game view's canvas and its HUD are untouched in this pass
  (its chrome already has its own visual language; restyling it is a
  follow-up if wanted).
- ui-smoke's 182 checks must stay green: smoke asserts content and ids,
  not colors, so the constraint is "keep ids and text intact".
- Zero dependencies: no webfonts, no CSS framework, no build step. One
  style.css, hand-written.

## Architecture

- `style.css` is rewritten around a token block:
  `:root { --bg, --panel, --line, --ink, --dim, --acc, --team-primary,
  --team-secondary }`. Components read tokens only.
- New `ui/chrome.js` (small): renders the ribbon and the rail from
  GameState + NAV_HUBS, owns `applyTeamTheme`. index.html swaps the old
  topbar/sidebar containers for `#team-ribbon` and `#nav-rail`.
- Rail icons are inline SVG (stroke icons, currentColor) defined in
  chrome.js — no emoji (platform-inconsistent) and no icon font.
- Rating chip + stat chip are CSS classes (`ovr-chip`, `stat-chip`) plus
  a `ovrChipHtml(player)` helper in ui/roster.js's shared helpers, reading
  RATING_BANDS.

## Error handling

- A team with missing/malformed `colors` falls back to the app green so
  the ribbon never renders unstyled (the unstyled-classes bug class).
- `applyTeamTheme(null)` (no team picked yet — the new-game screen) uses
  the neutral green theme.

## Testing

- validate-uiSafety / validate-browserBridges / whole suite green.
- ui-smoke 182 in the browser, plus a new smoke group asserting: ribbon
  exists and shows the team name, rail has 8 items with aria-labels, the
  active hub matches the current view, `--team-primary` equals the user
  team's stored hex, OVR chips appear in the roster table.
- Visual check by screenshot at desktop width on at least 3 teams with
  contrasting palettes (BOS green, LAL purple/gold, BKN black) — the BKN
  black-primary case exercises the scrim guard.
