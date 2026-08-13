# 2K27 Roster Import Implementation Plan

> Spec: docs/superpowers/specs/2026-08-13-2k27-roster-import-design.md
> Executed inline (user preference: never subagent-driven).

**Goal:** the league becomes the real 2K27 NBA — ratings, rosters, physicals —
with derived archetype labels, and the calibrated engine's balance intact.

---

### Task 1: Land the data
- [ ] Commit `scripts/scrape-2kratings.js` (curl transport, pinned 30 slugs)
- [ ] Commit `data/2k27-rosters.json` (scrape output; ~450 players)
- [ ] Sanity: 30 teams, every player has 37 attributes, physicals parse

### Task 2: mkPlayer accepts explicit attributes and wingspan
- [ ] `opts.attributes` — when present, used verbatim instead of
      `makeAttributes(overall, archetype, id)`; signature patches skipped
      (real sheets don't need them)
- [ ] `opts.wingspanIn` — stored as `player.wingspanIn` (may be null)
- [ ] `node scripts/validate-data.js` still green (old table untouched so far)

### Task 3: The import pipeline
- [ ] `scripts/import-2k-rosters.js`:
      1. Load CURRENT players-2026.js → per-attribute sorted arrays
         (the quantile-map targets) + name→contract map
      2. Read data/2k27-rosters.json; blend 37→20 per the spec table
      3. Quantile-map each blended value onto the old distribution
      4. Contracts: by-name carry-over, else rookie-scale (yearsPro ≤ 1)
         or fair-market from mapped quality
      5. Potential grade → headroom points (A+ 12, A 9, A- 7, B+ 5, B 4,
         B- 3, C+/C 2, else 1) — mkPlayer's gap rescale does the rest
      6. Emit the roster table between GENERATED markers in players-2026.js
         (mkPlayer calls with opts.attributes/wingspanIn/dateOfBirth),
         internal archetype id chosen nearest by attribute shape
- [ ] Run it; league loads; distributions match old per attribute
      (compare min/median/max/quartiles); top-10 rawOverall order ≈ 2K order

### Task 4: Recalibrate-or-confirm
- [ ] Regenerate goldens (gen-gamesim-golden, gen-rollover-golden)
- [ ] Full validator suite green
- [ ] probes: twenty-seasons (scoring 134.86±1.5, stable), invariants,
      feats, ultimates, superstar-rate-fullsim, star-value
- [ ] Only if a band is missed: tune the ONE constant that owns it, remeasure

### Task 5: Physicals for generated players + display
- [ ] Measure per-position height/weight/wingspan mean/sd from the JSON;
      constants into draftProspects.js; prospects sample those instead of
      uniform 74-83in; wingspan added to prospects
- [ ] Profile + draft views show height · weight · wingspan
- [ ] validate-offseason / careerMode green

### Task 6: Archetype labels
- [ ] `archetypeLabel.js` (root, dual-bridge): pure
      `archetypeLabel(player)` → string; z-score attribute families vs
      league, rules pick label; height gates big-man labels
- [ ] `scripts/validate-archetypeLabel.js`: hand-checked sanity set
      (Curry→shooter family, Jokic→playmaking big, Gobert→rim protector,
      SGA→scoring guard…); every player gets a non-empty label; labels
      change when attributes change (mutation)
- [ ] UI: roster table column, player profile line, scouting card;
      index.html + simWorker importScripts + validate-browserBridges green
- [ ] validate-uiSafety literal-class guard green

### Task 7: Whole-feature verification
- [ ] Full validator suite + all probes
- [ ] Browser: new game → rosters/ratings/physicals/archetypes visible;
      sim a week; watch a live game; save/load round-trip; UI_SMOKE 182+
- [ ] Old-save compatibility: load a pre-import save, its league intact
- [ ] Memory files updated; commits per task

---

### Task 8 (follow-up, user 2026-08-13): attributes at 2K face value
User wants attribute FACE VALUES to equal 2kratings.com numbers (Tatum
defReb 89, not the quantile-mapped 87), tuning the engine as needed.
- [x] Importer: drop quantile mapping — emit blended 2K values directly
      (single-source attributes = exact site numbers); print per-attribute
      affine (mean/sd: mapped-league -> raw-2K-league) for generation
- [x] makeAttributes: apply that affine per attribute so GENERATED players
      land on the same scale as the raw-2K league (else draft classes are
      systematically off and the league decays)
- [x] Re-import; measure league scoring over ~600 real games; tune the
      make-probability constants back to ~135±1.5 (FT center 76, base
      -0.019 then -0.0064 after the shooter re-anchor; ultimates check
      measures 135.42)
- [x] Refit rawOverall (fit-overall 3000, r 0.526 vs the retuned engine) +
      display fit (per-position, r 0.965); re-anchored: RATING_BANDS
      superstarPotential 97, ultimates norm tables + badgeTieBreak 0.03,
      synergy thresholds 83/78/71, archetypeLabel thresholds (p75/p90 of
      face-value families), PICK_POWER.shooter 2.5 (usage 2.86x),
      SHARE_LOW/PIVOT/HIGH .27/.31/.335 (3PA identity spread 51),
      BLOCK_BASE 0.0055 (block mean 56.1), trade-block bonus 0.9,
      minutes-spread band to 6.0 (bench still gets 6.0 min)
- [x] League-decay fix (twenty-seasons probe exposed it): progression
      deltas cross GENERATION_AFFINE like generation does; potential pull
      0.15/0.05 -> 0.05/0.017 (the p75 Monte Carlo ceiling is an estimate,
      not a promise); GROWTH_TUNING young base 0.5/0.15, noise clip +4;
      prospect entry band 55+20 capped at display 80. Fullsim superstar
      rate 3.83/class (target 2-4, was 13.83); median OVR flat over 20
      seasons (78 -> 76, was 78 -> 85); scoring bends back to ~140 (was
      147 and climbing)
- [x] Goldens regenerated, all 56 validators green, probes green
      (invariants 10 seasons, feats, twenty-seasons, superstar rate)
- [x] Browser: Tatum defReb 89 on his profile (fresh no-store load,
      engine constants confirmed served), UI_SMOKE 182/182, only the
      accepted MIA.png 404 in the console
