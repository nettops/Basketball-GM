# Command Center Dashboard — Design

**Date:** 2026-08-13
**Chosen from previews:** Direction B ("Command Center") of three mocked directions
(A Box Score Grid, B Command Center, C Gameday Rail). The user picked B.

## Goal

Replace the dashboard's single-column stack of eight equal-weight panels with a
ZenGM-informed command center: a team-color hero band that answers "how are we
doing and what's next" at a glance, over a dense two-column grid. Adds the
ZenGM staples the page lacked — conference seed, last-5 results, upcoming
games, a conference race ladder — using only data the sim already tracks.

## Non-goals

- No new stored state. Everything derives from `team.record`
  (wins/losses/pointsFor/pointsAgainst), `GameState.season.games`, the feed,
  and existing career/injury/morale accessors. Saves are untouched.
- No engine or sim changes. Goldens must not move.
- Other views keep their markup; shared CSS (`.kpi-*`, `.panel`, `.meter`)
  stays for them.

## Layout

```
[ hero band: logo · big record + seed/division · streak · PPG · Opp PPG · next-game spotlight w/ Play button ]
[ left column (wide)                          ][ right column (340px)          ]
[  form strip: last 5 score bugs + coming-up  ][  Front Office gauges          ]
[  Conference Race ladder                     ][  Injuries & Morale (merged)   ]
[  Leaders (team top-3 + league best, 3 cols) ][  Your Career milestone        ]
[                                             ][  Headlines                    ]
```

## Components

**Hero band** (`.dash-hero`): gradient from `--team-primary` under a dark
scrim, same pattern as the topbar ribbon (raw hex is safe because text sits on
the scrim, not the color — the BKN rule from ui/topbar.js). Left to right:
logo, condensed 44px record with "Nth CONF · division standing" subline,
divider stats (streak, PPG, Opp PPG), and a spotlight card for the next game
showing opponent, their record and seed, and a gold **Play Next Game** button.

- Streak, PPG, Opp PPG derive from `season.games` / `team.record`; before any
  games all three show em dashes.
- The Play button calls the dock's existing `handleWatchNextGame` and is
  disabled under exactly the dock's `noGameToWatch` conditions (offseason, or
  regular season with no remaining user game). During playoffs the spotlight
  shows "Playoffs — next series game" (no opponent lookup) and the button
  works as the dock's Watch does. During offseason it shows the stage name,
  button disabled.

**Form strip** (`.form-bug` cards): last 5 played games, oldest→newest, each a
small card with green/red top border, opponent, score, W/L; then one
"coming up" card listing the next 2 opponents by day. Fewer than 5 played →
fewer cards; zero played → the strip shows only the coming-up card.

**Conference race**: user's conference seeded by `getPlayoffSeeds(conf, 15)`
(wins, then point diff — the real seeding sort, not the standings' wins-only
divisional sort). Top 5 rows; if the user seeds 6th or lower, top 4 plus the
user's row at its true rank. Columns: rank, team, W-L, GB (vs leader, '—' for
the leader), streak. User row highlighted with the accent tint; team rows
clickable to their roster like Standings.

**Leaders**: three columns (PTS/REB/AST); each shows the team's top 3 by the
existing `getPlayerAverages` and a muted "League: <leader> <value>" line.
Empty season → "No games played yet."

**Front Office**: four compact gauges — payroll (with `/cap` and over-cap
coloring), chemistry, fans, owner — replacing the KPI tiles and the two
full-size morale/happiness panels.

**Injuries & Morale** (merged panel): injured players (name, rating chip, out
label) then unhappy players (name, morale, reason). Both empty → single
"All healthy, nobody unhappy." line.

**Your Career** and **Headlines**: existing `careerHintHtml()` and
`recentHeadlines()` (6 entries), restyled only.

## Data flow

All helpers live in ui/dashboard.js and read GameState at render time:
`lastPlayedGames(teamId, season, n)`, `upcomingGames(teamId, season, n)`,
`teamStreak(teamId, season)`, plus seed/division-rank lookups over
`getPlayoffSeeds` and TEAMS. Names and feed text are escaped everywhere —
the injection smoke check walks this view with a hostile player name.

## Error handling

No season → hero renders with 0-0/dashes, strip shows nothing playable,
spotlight says "No season in progress", button disabled. Empty roster, empty
feed, no injuries each keep their existing empty-state lines.

## Testing

New `dashboard` UI_SMOKE group: hero record equals `team.record`; seed line
matches `getPlayoffSeeds` order; form strip count and W/L letters equal the
real last played games; race table marks the user row at its true rank; Play
button disabled state matches the dock's `#sim-watch-game`. Existing injection
and nav checks keep passing unchanged. Full validator suite (56) must stay
green with goldens unregenerated — this is UI-only.
