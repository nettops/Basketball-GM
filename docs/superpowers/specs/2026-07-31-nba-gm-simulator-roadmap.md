# NBA General Manager Simulator — Roadmap & Vision

**Status:** Approved. Governs phase sequencing; detailed design for each phase lives in its own spec doc.

## Vision

A fully playable NBA General Manager simulator running entirely locally in the browser (open `index.html`, no server, no build step, no external APIs). Pure HTML/CSS/vanilla JavaScript. The player builds a dynasty through drafting, trading, free agency, salary cap management, player development, and scouting — with an emphasis on decision-making over graphics, and hidden information (traits, personality, tendencies) that means raw Overall rating never tells the whole story.

The simulation should support every level of player involvement, from hands-on GM to hands-off Spectator watching an alternate NBA history unfold across 100+ simulated seasons.

## Constraints

- HTML + CSS + vanilla JavaScript only. No React, no Node/build tooling, no TypeScript, no frameworks, no databases, no external APIs.
- Fully offline. Persistence via `localStorage`.
- Modular file structure; avoid giant files; comment non-obvious logic only.
- Real NBA team names and real player names/likenesses, for personal/local use only (not distributed or commercial).
- Data must be hardcoded (no live data source). Real player ratings/attributes are estimated from the model's basketball knowledge, not scraped or sourced from a live database.

## Phase Sequence

Each phase is its own spec → plan → implementation cycle. A phase should leave the game in a playable state before the next begins.

1. **Foundation** — file structure, data schemas, all 30 real teams with real 2025-26 rosters, dashboard + navigation shell. Browse-only. *(See `2026-07-31-phase-1-foundation-design.md`.)*
2. **Season sim engine** — schedule generation, game simulation, standings, box scores, playoffs. Basic sim controls (Next Day/Week/Sim to End of Season) and speed setting.
3. **Roster management + trades** — manual roster moves, trade proposals, AI trade evaluation and counteroffers. This AI evaluation logic is reused by Auto GM in Phase 7.
4. **Free agency + draft** — offseason free agency (player choice logic: money, contention, playing time, market, prestige, coach quality), draft class generation, lottery, two-round draft. First 1-2 in-game draft classes use real known upcoming prospects (per model's knowledge); all subsequent draft classes are fully procedurally generated.
5. **Hidden traits, personality & scouting** — the hidden trait taxonomy (Offensive/Defensive/Athletic/Mental/Negative/Superstar tiers: Bronze/Silver/Gold/HOF/Legendary), hidden personality ratings, hidden tendencies, and the scouting system that gradually reveals them. Layered on top of the player records created in Phase 1 (which start with empty `hiddenTraits`/`hiddenPersonality` stubs).
6. **Save/load** — `localStorage` persistence, multiple save slots, autosave. Built before Phase 7 so long automated/multi-season sims aren't at risk of being lost.
7. **Play modes & automation** — General Manager / Commissioner / Spectator modes; per-system automation toggles (auto lineups, auto injuries, auto sign FAs, auto draft, auto negotiate, auto trade, auto training, auto scout, auto G League, auto cap); Auto GM decision logic (reuses AI logic from Phases 3-4, informed by team needs, cap, hidden traits/personality, draft capital, team timeline); expanded sim controls (sim to lottery/deadline/free agency/N seasons/until championship/custom); adjustable sim speed; live simulation feed; pause-on-event settings; Commissioner sandbox tools (edit rosters/ratings, force trades, create/delete players, expansion teams, disable cap).
8. **League history & dynasty tracking** — indefinite season tracking, full awards suite (MVP, Finals MVP, DPOY, ROY, 6MOY, COY, MIP, All-NBA), retirements, Hall of Fame, franchise/league records, career milestones, draft class archives, major trade archive. What Spectator mode and long unattended multi-season sims (Phase 7) are ultimately browsing.

## Deferred / Future Scope (explicitly out of scope for now)

- **Historical starting seasons** (real rosters for years other than 2025-26, e.g. "start a game in 2010"). The user wants this eventually, back to season 2000-01, but full-roster real-data accuracy for 26 seasons is a large hand-authored data-entry effort. Deferred until after the core 8-phase roadmap is playable. When built, it slots in as additional `players-YYYY.js` files alongside `players-2026.js` — the Phase 1 architecture is intentionally designed to make this a data-only addition, not an engine change.
- Real dollar-figure contracts for real players (using simplified/approximate contract values instead, generated from overall/age/position — see Phase 1 design).
- Real logo image assets (using text/color branding instead, to avoid bundling copyrighted image files).
