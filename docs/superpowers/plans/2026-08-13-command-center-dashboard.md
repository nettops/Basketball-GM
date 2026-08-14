# Command Center Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline —
> this project never uses subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard view as the Command Center from the approved spec
(docs/superpowers/specs/2026-08-13-command-center-dashboard-design.md): team-color
hero band + two-column grid, adding seed, last-5, upcoming games, and a conference
race ladder from data the sim already tracks.

**Architecture:** All rendering stays in ui/dashboard.js (new pure helpers + a
rewritten renderDashboard). New CSS is appended to style.css under `dash-` /
`form-` / `fo-` prefixes so nothing collides with shared classes other views use.
The hero's Play button delegates to the dock's `handleWatchNextGame`; seeding
comes from `getPlayoffSeeds` (playoffs.js, already a browser global).

**Tech stack:** Vanilla JS string templates, CSS custom properties. No new files,
no bridges (dashboard has no Node consumer), no stored state.

## Global constraints

- UI-only: engine untouched, goldens must pass UNregenerated.
- Every player/team/feed string through `escapeHtml` — the injection smoke check
  walks this view.
- Raw `--team-primary` only under a scrim (the BKN black-primary rule);
  interactive elements use luminance-guarded `--accent`.
- Commit per task; never push.

---

### Task 1: CSS for the command center

**Files:** Modify: `style.css` (append after the broadcast blocks)

- [x] **Step 1:** Append the component block:

```css
/* ---- Command Center dashboard ---- */
.dash-hero { position: relative; overflow: hidden; display: flex; align-items: center; gap: 26px;
  padding: 14px 20px; margin-bottom: 10px; border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: linear-gradient(90deg, var(--team-primary) 0, rgba(11, 14, 20, .6) 55%, var(--surface-1) 100%); }
.dash-hero::before { content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, .25), rgba(0, 0, 0, .45)); }
.dash-hero > * { position: relative; }
.dash-hero-rec { font: 900 44px/1 var(--font-cond); letter-spacing: 1px; }
.dash-hero-rec small { display: block; font: 700 11px var(--font); letter-spacing: 1.5px;
  text-transform: uppercase; color: rgba(230, 234, 240, .75); margin-top: 2px; }
.dash-hero-stat { border-left: 1px solid rgba(230, 234, 240, .25); padding-left: 22px; }
.dash-hero-stat .v { font: 800 22px/1.1 var(--font-cond); }
.dash-hero-stat .k { font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
  color: rgba(230, 234, 240, .7); }
.dash-next { margin-left: auto; display: flex; align-items: center; gap: 14px;
  background: rgba(5, 7, 11, .55); border: 1px solid rgba(230, 234, 240, .2);
  border-radius: var(--r-md); padding: 10px 16px; }
.dash-next .vs { font: 900 18px var(--font-cond); }
.dash-next .sub { font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
  color: rgba(230, 234, 240, .65); }
#dash-play { background: var(--gold); border: none; color: #131313; cursor: pointer;
  font: 800 11px var(--font); letter-spacing: 1px; text-transform: uppercase;
  border-radius: var(--r-sm); padding: 8px 14px; }
#dash-play:hover { filter: brightness(1.1); }
#dash-play:disabled { background: var(--surface-3); color: var(--text-mute); cursor: default; filter: none; }
.dash-grid { display: grid; grid-template-columns: 1fr 340px; gap: 10px; align-items: start; }
.dash-col { display: flex; flex-direction: column; gap: 10px; }
.form-strip { display: flex; gap: 6px; }
.form-bug { flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--line);
  border-top: 3px solid var(--line-strong); border-radius: var(--r-sm); padding: 6px 8px; text-align: center; }
.form-bug.win { border-top-color: var(--win); }
.form-bug.loss { border-top-color: var(--loss); }
.form-bug .opp { font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.form-bug .score { font: 800 14px var(--font-cond); font-variant-numeric: tabular-nums; }
.form-bug .res { font-size: 10px; font-weight: 800; }
.form-bug .res.w { color: var(--win); }
.form-bug .res.l { color: var(--loss); }
.fo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
.fo-cell .k { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: var(--text-mute); }
.fo-cell .v { font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums; }
.fo-cell .v .cap-of { color: var(--text-mute); font-weight: 400; }
.lead-cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.lead-cols .k { font-size: 10px; text-transform: uppercase; letter-spacing: .8px;
  color: var(--text-mute); margin-bottom: 3px; }
.lead-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.lead-row.dim2 { color: var(--text-dim); }
.lead-league { color: var(--text-mute); margin-top: 5px; }
@media (max-width: 1100px) { .dash-grid { grid-template-columns: 1fr; } }
```

- [x] **Step 2:** Commit `style: command center dashboard CSS`.

### Task 2: Data helpers in ui/dashboard.js

**Files:** Modify: `ui/dashboard.js` (above renderDashboard)

**Interfaces produced:** `lastPlayedGames(teamId, season, n)` → newest-last array of
`{ day, opp, home, ownScore, oppScore, won }`; `upcomingGames(teamId, season, n)` →
`{ day, opp, home }`; `teamStreak(teamId, season)` → `'W4' | 'L2' | '—'`;
`conferenceSeeding(conference)` → getPlayoffSeeds(conference, 15).

- [x] **Step 1:** Implement, reading `season.games` the way powerRankings'
  `recentFormWinPct` does:

```js
function teamGameRow(g, teamId) {
  const home = g.homeTeamId === teamId;
  const opp = getTeamById(home ? g.awayTeamId : g.homeTeamId);
  return { day: g.day, opp: opp, home: home,
    ownScore: home ? g.homeScore : g.awayScore,
    oppScore: home ? g.awayScore : g.homeScore,
    won: home ? g.homeScore > g.awayScore : g.awayScore > g.homeScore };
}
function lastPlayedGames(teamId, season, n) {
  if (!season) return [];
  return season.games
    .filter(function (g) { return g.played && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; })
    .slice(-n)
    .map(function (g) { return teamGameRow(g, teamId); });
}
function upcomingGames(teamId, season, n) {
  if (!season) return [];
  return season.games
    .filter(function (g) { return !g.played && g.day > season.currentDay &&
      (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; })
    .slice(0, n)
    .map(function (g) { return teamGameRow(g, teamId); });
}
function teamStreak(teamId, season) {
  const played = lastPlayedGames(teamId, season, 82);
  if (played.length === 0) return '—';
  const lastWon = played[played.length - 1].won;
  let run = 0;
  for (let i = played.length - 1; i >= 0 && played[i].won === lastWon; i--) run++;
  return (lastWon ? 'W' : 'L') + run;
}
```

  (Playoff games appended to `season.games` carry `day: null` — the
  `g.day > season.currentDay` guard keeps them out of "upcoming", and
  `lastPlayedGames`' sort tolerates them; slice from the tail still returns the
  most recent regular-season days plus any played playoff rows, which is the
  honest "recent form".)

- [x] **Step 2:** Seed/division lookups:

```js
function seedLabel(team) {
  const seeds = getPlayoffSeeds(team.conference, 15);
  const idx = seeds.findIndex(function (t) { return t.id === team.id; });
  return ordinal(idx + 1) + ' ' + team.conference;
}
function divisionLabel(team) {
  const div = TEAMS.filter(function (t) { return t.division === team.division; })
    .sort(function (a, b) { return b.record.wins - a.record.wins; });
  const idx = div.findIndex(function (t) { return t.id === team.id; });
  return idx === 0 ? team.division + ' leaders' : ordinal(idx + 1) + ' ' + team.division;
}
function ordinal(n) {
  const suf = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suf;
}
```

- [x] **Step 3:** Commit `feat: dashboard form/seed helpers`.

### Task 3: renderDashboard — hero + grid

**Files:** Modify: `ui/dashboard.js` (rewrite renderDashboard; keep
injuryLabel/topLeaders/careerHintHtml/recentHeadlines/SCORE_LINE_PATTERN)

- [x] **Step 1:** Hero band. Record from `team.record`; sub `seedLabel · divisionLabel`
  (only when a season exists, else 'No season in progress'); stats streak /
  PPG / Opp PPG (`record.pointsFor / gp`, '—' when gp 0). Spotlight: regular
  season → next game from `upcomingGames(teamId, season, 1)` with opponent
  record + seed; playoffs → 'Playoffs · next series game'; offseason → stage
  name. Button: `<button id="dash-play">Play Next Game</button>`, disabled by
  the dock's own rule (copy of `noGameToWatch` from ui/simControls.js), wired
  to `handleWatchNextGame` (typeof-guarded like other cross-file calls).
- [x] **Step 2:** Left column: form strip (last 5 `.form-bug`s: `vs/@ ABBR`,
  `ownScore–oppScore`, W/L; plus one unstyled-top bug listing the next 2
  from `upcomingGames`), Conference Race panel (top 5 seeds or top 4 + user
  row, rank/team/W-L/GB/streak, user row `row-user` + accent tint, rows
  clickable to roster exactly like ui/standings.js), Leaders panel
  (`.lead-cols`, team top-3 per stat via existing topLeaders, muted league
  line via topLeaders over PLAYERS_2026).
- [x] **Step 3:** Right column: Front Office `.fo-grid` (payroll `$168M / $170M`
  with over-cap coloring + meter, chemistry, fans, owner each with meter),
  merged Injuries & Morale panel, Your Career (careerHintHtml unchanged),
  Headlines (recentHeadlines 6).
- [x] **Step 4:** Load in browser: dashboard renders, no console errors, Play
  button starts the next game, race rows navigate to rosters.
- [x] **Step 5:** Commit `feat: command center dashboard`.

### Task 4: Smoke coverage

**Files:** Modify: `scripts/ui-smoke.js` (new group after `broadcast:`)

- [x] **Step 1:** `checkDashboard()` group `dashboard:`; each check renders
  `renderView('dashboard')` first:
  - `dashboard:hero-record` — `.dash-hero-rec` text starts with
    `record.wins + '-' + record.losses`.
  - `dashboard:hero-seed` — hero subline contains `seedLabel(team)` computed
    independently in the check from `getPlayoffSeeds`.
  - `dashboard:form-strip-truth` — the `.form-bug.win/.loss` cards equal
    `lastPlayedGames(userTeamId, season, 5)` in count and W/L sequence.
  - `dashboard:race-user-row` — race table has exactly one `.row-user` whose
    rank cell equals the user's seed index + 1.
  - `dashboard:play-parity` — `#dash-play.disabled` ===
    `#sim-watch-game.disabled` after rendering the dock.
- [x] **Step 2:** Run UI_SMOKE in browser — all green including new group.
- [x] **Step 3:** Commit `test: dashboard smoke group`.

### Task 5: Whole-feature verification

- [x] **Step 1:** Full validator suite: 56/56, goldens unregenerated.
- [x] **Step 2:** Browser: UI_SMOKE all green; look at the page on BOS, LAL
  (purple/gold), BKN (black primary — hero must stay legible via scrim);
  resize below 1100px (columns stack).
- [x] **Step 3:** Advance a few days in-app: hero record/streak/form strip
  update; play a game via the hero button.
- [x] **Step 4:** Tick plan checkboxes, update memory, report with screenshots.
