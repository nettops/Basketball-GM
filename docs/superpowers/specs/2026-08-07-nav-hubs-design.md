# Navigation Hubs — Design

**Date:** 2026-08-07
**Status:** Approved

## Summary

Replace the 25-item sidebar with 7 hubs. Each hub opens a page carrying a tab strip for its sub-views. Nothing is removed, hidden, or demoted — every screen, every stat, every accolade stays exactly where the game already puts it, and reachable in at most two clicks.

## The problem

From the project owner: *"simplify the ui, right now there is alot to look at and ease of access is a must for a good game"*, and on returning to it: *"we want all of the player data and accolades and things present. I just feel the menu seems overwhelming."*

Measured in the browser at 1614×910:

| Group | Items |
|---|---|
| Team | 4 |
| League | 11 |
| Transactions | 7 |
| System | 3 |
| **Total** | **25** |

The sidebar's content is **1074px tall inside a 910px window**, so it scrolls: Save/Load, Settings and God Mode sit roughly 190px below the fold. So the complaint is not only aesthetic — the menu does not fit on screen, and one group (League) carries eleven entries on its own.

### What the owner ruled out

Asked which clusters they actually open in a session, the owner selected **all four**. That is the constraint that shapes everything else: there is no rarely-used tail to hide. Any design that works by demoting a group would be guessing against what they told us.

This also rules out the two obvious cheap fixes:

- **Collapsible groups** reduce the menu at rest but not in use — opening League still presents eleven items, and crossing between groups now costs an extra click.
- **Search / command palette** rewards knowing what you want. The owner explicitly browses accolades and history; typing "Frivolities" only works if you already remember it exists.

## Design principles

From the owner, and the reason this project exists:

1. **It must be fun**, not merely accurate.
2. **It should bring players back** for future sessions.
3. **Minimise micromanagement.** Agency is an opportunity, never an obligation.

Hubs serve the third at the level of *attention* rather than decisions: the player should not have to scan 25 labels to find the one screen they want.

## The grouping

Seven hubs in a standard GM game. `NAV_ITEMS` holds **28** entries; three are conditional (Career, Player Legacy, Commissioner) and are placed in the section below, leaving the **25** visible in GM mode in the table here. All 28 are accounted for; none is dropped.

| Hub | Tabs (in order; the first is the hub's default) |
|---|---|
| **Dashboard** | Dashboard |
| **Roster** | Roster · Compare Players · Career Ledger |
| **Schedule** | Schedule · Playoffs |
| **League** | Standings · Power Rankings · All-Star Weekend · League News · Live Feed |
| **Transactions** | Trade Center · Free Agency · Draft · Scouting · Salary Cap · Team Finances · Coaching |
| **Records** | History · Awards · Season Recap · Frivolities |
| **System** | Save/Load · Settings · God Mode |

Two placements are deliberate and were checked against what the views actually render rather than inferred from their names:

- **Career Ledger** renders per-player season-by-season stats with CSV export, and **Compare Players** stacks up to four players' stats. Both are player data, so they sit with Roster rather than in Records.
- **Frivolities** computes cross-league curiosities from `LEAGUE_HISTORY`. That is league record-keeping, so it stays in Records.

Transactions is the widest at seven tabs. Seven fits the content column comfortably (~1300px at the measured viewport), so it ships as one hub; if it feels heavy in use, the money tabs (Salary Cap, Team Finances, Coaching) split into an eighth hub without disturbing anything else.

### Conditional entries

The existing visibility rules carry over unchanged:

| View | Condition | Placement |
|---|---|---|
| Career (`playerDashboard`) | `gameMode === 'playerCareer'` | Its own top-level hub — that mode's home screen |
| Player Legacy (`legacy`) | `hasLegacy` | Second tab of the Career hub |
| Commissioner | `playMode === 'commissioner'` | Fourth tab of the System hub |

So the sidebar shows 7 hubs in a standard GM game and 8 in career mode. Commissioner mode adds a tab rather than a hub, keeping the count at 7.

## Architecture

**The view registry does not change.** All 30 entries in `BUILT_VIEWS` and all 30 view ids keep their current names and renderers. There are **30 `renderView('…')` call sites across 13 view ids** scattered through the codebase (the sim dock alone reaches for `draft` and `freeagency`); every one keeps working untouched. This is the decision that makes the change low-risk: it adds a presentation layer rather than re-plumbing navigation.

Four pieces:

### 1. `NAV_HUBS` in `ui/nav.js`

An ordered list of hubs, each with an ordered list of view ids:

```js
const NAV_HUBS = [
  { id: 'dashboard',    label: 'Dashboard',    views: ['dashboard'] },
  { id: 'roster',       label: 'Roster',       views: ['roster', 'playerComparison', 'careerLedger'],
    related: ['playerProfile'] },
  // ...
];
```

`NAV_ITEMS` stays as the canonical list of every navigable view. The smoke suite already iterates it to prove all 25 render, and that check must keep working.

`related` lists views that highlight a hub without appearing as a tab. It exists for `playerProfile` (below).

### 2. The sidebar renders hubs

`renderNav` renders one button per hub instead of one per view. Clicking a hub navigates to its first view. The existing per-item filters (commissioner, career mode, legacy) move to filtering a hub's `views` list; a hub whose views all filter out is not rendered.

The `roster` click behaviour is preserved: the sidebar's Roster entry clears `GameState.inspectTeamId`, so it always means "my team" even after inspecting another team from Standings.

### 3. The tab strip is its own element

A new `<div id="view-tabs">` sits between the topbar and `#view-content` in `index.html`.

This placement is load-bearing. Every view renderer owns `#view-content` outright and assigns `container.innerHTML = …`; a tab strip rendered inside it would be destroyed by the first view that painted. A sibling element means **no changes to any of the 30 renderers**.

### 4. `renderView` gains a hub lookup

After rendering the view, `renderView` resolves the hub for the current view id, renders its tabs into `#view-tabs`, and highlights that hub in the sidebar. When the hub has a single view — or the view has no hub — the strip renders empty and is hidden, so Dashboard has no vestigial one-tab bar.

### Hubless views

| View | Behaviour |
|---|---|
| `pixelGame` | No hub, no tabs. Unchanged from today. |
| `playerProfile` | Listed in Roster's `related`: highlights Roster, shows no tabs. Reached by clicking a player name from many screens, so blanking the sidebar there would read as a bug. |

## Error handling and edge cases

- **A view in no hub** is the failure that matters: it becomes unreachable from the sidebar while every existing test still passes. The Node check below makes it impossible to land.
- **A view in two hubs** would render two highlighted parents. Also caught by the Node check.
- **A hub whose default view has no renderer** would open a blank page. Checked.
- **Deep navigation from other views** (`renderView('draft')` from the sim dock, `renderView('freeagency')` from the offseason, player profiles from Standings) lands on the right tab with the right hub highlighted, because the hub is resolved from the view id rather than from what was clicked.
- **Career mode and commissioner mode** must not show empty hubs; a hub with no visible views is skipped entirely.

## Testing

**`scripts/validate-nav.js`** (new, Node) — the structural invariants, which are pure data and need no DOM:

- every id in `NAV_ITEMS` appears in exactly one hub's `views`
- no hub lists an unknown view id
- no view appears twice across hubs
- every hub has at least one view, and its first view is a real key in the view registry
- `related` ids are real view ids and are not also tabs

**Smoke `nav` group** (`scripts/ui-smoke.js`) — what the user can actually see and click, following that file's rule of asserting visible and reachable rather than merely present:

- the sidebar renders exactly the expected number of hubs for the current mode
- every hub button is hit-testable
- clicking each hub lands on that hub's default view
- the tab strip shows the expected tab count for the active hub, and each tab is hit-testable
- the active hub is highlighted after navigating to a view directly (not via its hub)
- Dashboard shows no tab strip

**Existing coverage that must keep passing:** the smoke `views` group visits all 25 nav view ids and asserts each renders; it is the proof that no screen was lost. The full Node suite and `UI_SMOKE.run()` must stay green.

## Out of scope

- The topbar's seven stats and the sim dock — untouched.
- The watch-view chrome (the full GM app remaining visible during a live game). Still parked at the owner's request.
- Any change to what a view renders. This project moves screens; it does not redesign them.
- Icons in the sidebar. Text labels stay — icons for "Frivolities" versus "Career Ledger" are unguessable, and the owner's complaint is quantity, not styling.
