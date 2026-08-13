# 2K27 Roster Import, Physicals, and Archetype Labels — Design

Approved in conversation 2026-08-13. Three user decisions fixed the scope:
ratings ARE replaced by 2K27's (not kept as reference), archetypes are
DERIVED from attributes (so generated players get them forever), and
archetypes are LABELS only (no gameplay effects).

## Source data

`data/2k27-rosters.json` — scraped from 2kratings.com (scraper:
`scripts/scrape-2kratings.js`). All 30 current NBA teams, ~450 players, each
with: 37 attribute ratings (0-99), overall, potential grade (A+..), archetype
label, positions, jersey, height/weight/wingspan, birthdate, years in NBA,
college. Some 2K27 ratings are carry-overs from 2K26 where unannounced; the
site says so and we accept it.

## 1. The league becomes the real 2K27 NBA

`players-2026.js`'s authored roster table is regenerated from the scrape:
real rosters (~450 players), real ages (from birthdates, season 2026-27),
real jerseys, real physicals. The file KEEPS its generation machinery
(`mkPlayer`, `makeAttributes`, `ARCHETYPES`, exports) — draft prospects,
career mode, the commissioner and four validators use it. Only the table of
authored players changes. Old saves are unaffected: a save serializes its
entire player pool and restores it wholesale (`applySavedState`), so an old
save loads its old league. New rosters apply to new games.

## 2. 2K decides who is good; the game keeps its units

The engine's every threshold (shot make rates, star gates, feat bars,
takeover charge) was measured against the game's own attribute scale. So 2K
values are imported by QUANTILE MAPPING, per attribute: each player's 2K
value becomes the value at the same percentile of the CURRENT league's
distribution for that attribute. Ordering and relative gaps are 2K's; the
league-wide distribution the engine was calibrated against is unchanged by
construction. `overall` stays the derived regression (ratings.js); potential
grades map to authored headroom via a small table (A+ largest), re-scaled by
mkPlayer's existing gap machinery.

Acceptance: league scoring within ±1.5 of the 134.86 baseline, playoffs
still favor the best, all-star/feat/takeover rates in their measured bands —
via the existing probes, through `league.simulateDate` (the isolated harness
reads ~35% low; memory).

## 3. The 37 → 20 translation

| game attribute | 2K source (blend = mean) |
|---|---|
| threePoint | Three-Point Shot |
| midRange | Mid-Range Shot |
| insideScoring | Close Shot, Layup, Driving Dunk, Standing Dunk |
| freeThrow | Free Throw |
| postScoring | Post Hook, Post Fade, Post Control |
| passing | Pass Accuracy, Pass Vision, Pass IQ |
| ballHandling | Ball Handle, Speed with Ball |
| perimeterDefense | Perimeter Defense |
| interiorDefense | Interior Defense |
| steal | Steal |
| block | Block |
| offReb | Offensive Rebound |
| defReb | Defensive Rebound |
| speed | Speed |
| acceleration | Agility |
| strength | Strength |
| vertical | Vertical |
| basketballIQ | Shot IQ, Pass IQ, Help Defense IQ, Off./Def. Consistency |
| leadership | Intangibles |
| workEthic | Hustle |

Blend first (on the 2K scale), then quantile-map the blended value.

## 4. What 2K does not have

Contracts: players matched by name to the OLD roster keep their exact
contract. New players get fair-market deals from the game's own logic
(`estimateFairSalary`-anchored; rookie-scale for yearsPro ≤ 1). Positions:
first-listed 2K position.

## 5. Physicals

`heightIn`/`weightLb` already exist on every player and feed the pixel court
(sprite height, dunk appeal). Import makes them real, and adds `wingspanIn`.
Generated players (prospects; relatives inherit via prospects): physicals
sampled from per-position distributions measured off the scraped league,
replacing the current uniform 74-83in roll. Wingspan display joins height
and weight on the player profile and draft views. No new gameplay effects.

## 6. Archetype labels

New root module `archetypeLabel.js`: a pure function from (attributes,
position, heightIn) to a display label ("Sharpshooter", "Two-Way Wing",
"Rim Protector", …). Distinct from the internal generation-shape
`player.archetype` (8 ids, untouched). Derived at display time — never
stored, so it tracks progression and covers every generated player forever.
Sanity validator: for real imported players, the derived label's skill
family must not contradict the player's 2K label on a hand-checked set
(Curry reads as a shooter, Jokic as a playmaking big, Gobert as a rim
protector). Shown on the roster table, player profile, and scouting.

## Out of scope

Badges import (the trait system already covers this ground), WNBA/classic
teams, live rating updates from the site, gameplay effects from archetypes
or wingspan.
