// Single-game feats: the moments worth remembering, detected from one
// box-score line and nothing else.
//
// Pure by design. Detection takes a line and a context and returns records; it
// reads no globals, opens no storage and knows no dates. That is what lets
// every threshold be tested directly instead of by simulating games until one
// happens to fire.
//
// Chosen by measured rate, not tradition.
//
// Measured on REAL SEASONS: scripts/probe-feats.js runs a full 1230-game season
// through league.simulateDate, ten seeds, one season per process. That harness
// choice is the whole story of this calibration. An earlier version called
// gameSim.simulateGame in a loop and reported 29.9 big scoring nights a season;
// the first real season played in the browser produced 42. The live path
// applies fatigue, injuries, morale and rotation minutes, and those are exactly
// what produce the outlier nights a feat IS. Numbers below are mean per season
// over ten seasons, with the season-to-season range beside them:
//
//   points bar     mean    range        points bar     mean    range
//     50          140.0   124-171         60           14.4     7-22
//     52           95.7    74-114         61           11.4     5-17
//     54           61.1    49-80          62            9.3     5-15
//     55           50.0    42-64          63            7.9     4-14
//     56           40.2    33-53          64            6.2     2-9
//     57           32.1    28-44          65            4.4     1-7
//     58           24.9    17-35          66            3.3     1-6
//     59           19.1    13-27          70            1.5     0-4
//
//   three-category bar:  10 -> 570.9    13 -> 123.3    15 -> 32.8
//                        12 -> 216.4    14 ->  69.0    16 -> 15.2
//
//   all-five bar:  3 -> 27.3      4 -> 2.8      5 -> 0.6
//
// Target bands, per season: big 15-40, huge 1-6, triple-double 40-120,
// five-by-five 0-3. Each bar is the LOWEST measured value whose mean lands in
// its band. Big is reported net of huge (a huge night is not also a big one),
// so 57 measures 32.1 and reports 32.1 - 4.4 = 27.7.
//
// Our league scores ~135 a team, so the traditional 50-point night fires 140
// times a season here — better than once a night — and the bar lands well above
// it. The same inflation is why the three-category bar is 14 rather than
// basketball's 10: at 10 it fires 571 times a season, twice every night.
//
// The five-by-five is the one bar left at its traditional value, and it is the
// rarest thing in the game at 0.6 a season — better than half the seasons
// measured had none at all. Its band floor is 0, so the rate band cannot prove
// detection works: it would pass with detection deleted. The hand-built
// boundary case in scripts/validate-feats.js is what proves it.
//
// Mutable holder rather than bare consts so the calibration probe can move
// them for one run without editing committed source — the same shape as
// freeAgency.js's RESIGN_TUNING and seasonTransition.js's RETIREMENT_TUNING.
// Re-measured after ultimates.js landed. A takeover adds ~13 points to a star's
// night about once a game league-wide, so big scoring nights got commoner and
// the old bars fell out of their bands — bigScoring fired 51 times against a
// 15-40 target. The bands are the specification, so the BARS move (see the
// TARGET_RATES comment in scripts/validate-feats.js).
//
// Swept on a real season through league.simulateDate, nights at or above:
//   55 -> 110    62 -> 28    68 -> 8
//   57 ->  75    64 -> 20    70 -> 5
//   60 ->  47    66 -> 13    72 -> 3
// bigScoring counts nights at-or-above `big` but below `huge`, so 62/70 gives
// 23 big and 5 huge — both mid-band.
//
// AND RE-MEASURED AGAIN once takeovers stopped being cut short by the buzzer.
// That fix does not raise a star's scoring rate; it lets a takeover run all
// twenty-six of its possessions instead of the ten the buzzer used to leave it,
// and a career night is exactly where that lands. Measured across five seeds
// (20260812 / 4242 / 555 / 8888 / 7), nights at or above 70 a season:
//
//   before the runway rule   4  4  6  5  4     mean 4.6
//   after                    7 11  8 10  9     mean 9.0
//
// The 1-6 band is the specification and 9 is outside it, so the bar moves. At
// 74 the same five seasons give 2 / 5 / 4 / 5 / 4, mean 4.0 — the rarity the 70
// bar used to buy. bigScoring at 62 went 28 -> 33, still mid-band, so it stays.
// Re-measured for the 2K27 import (probe-feats seed 1 + the validator's own
// season): doubleAt 14 -> 12, because the triple-double count fell to 22
// against the 40-120 band — the imported sheets spread rebounds/assists
// across more specialists — and 13 still read 33 on the validator's seed;
// 12 measures 95 on the probe's and holds the band on both. bigScoring
// 62 -> 60 for the same straddle (16 on one seed, 11 on the other; 60
// measures 28). hugeScoring 74 -> 2 nights, the rare headline it is meant
// to be.
// Re-measured again when PICK_CEILING.shooter dropped 0.50 -> 0.30 (the
// face-value league's scoring leader ran ~49 ppg; the cap pulls him to
// ~39.5): the 64/76 bars fell to 7 and 0 nights. On the validator's own
// seed the full-season counts read 56+ 40, 58+ 26, 60+ 19 and 66+ 6,
// 68+ 4, 70+ 3 — so 58 sits mid-band for bigScoring [15,40] and 68
// mid-band for hugeScoring [1,6], with the best night still 75. doubleAt
// 12 -> 11 in the same pass: capping the alpha's shot volume shaved the
// points leg of triple-doubles to 38 against the [40,120] floor.
// And re-measured once more when a regulation game became 38 minutes rather
// than 48. This is the largest move the bars have taken, and it is not
// calibration drift: league scoring fell from ~135 a team to ~109.
//
// The subtle part is that scoring fell and big nights got MORE common, so the
// bars did not simply follow the league total down. A shorter game is not a
// scaled-down game, because rotations do not scale with it — measured over 60
// games, the team clock falls 239.8 -> 190.1 player-minutes (-21%) while the
// leading minute-getter falls only 38.0 -> 33.3 (-12%), so his share of his
// own team's clock rises from 15.9% to 17.5%. The same team total gets divided
// less evenly, and the best scorer takes the extra. Best single night across
// five seasons is now 62-72 where the 48-minute league produced 59-62.
//
// Swept on the live season path across five seeds (20260812 / 4242 / 555 /
// 8888 / 7), nights at or above:
//   46 -> 76 77 64 68 70     54 -> 12 17 10 13 14
//   48 -> 52 53 39 47 51     56 ->  6  7  8  7  9
//   50 -> 31 39 23 28 36     58 ->  2  2  4  5  5
//   52 -> 17 26 17 20 23     60 ->  1  1  3  3  3
//
// bigScoring counts nights at-or-above `big` but below `huge`, so 50/58 gives
// 29 / 37 / 19 / 23 / 31 big — centred in [15,40] — and 2 / 2 / 4 / 5 / 5 huge,
// inside [1,6] on every seed. 48 was rejected because one season read 50, over
// the ceiling; 52 because one read 13, under the floor; 56 because one read 8
// huge.
//
// doubleAt stays 10: 68 / 63 / 63 / 65 / 71 against the [40,120] band. 11 reads
// 21-36 and falls under the floor, 9 reads 138-167 and breaks the ceiling.
var FEAT_TUNING = { bigScoring: 50, hugeScoring: 58, doubleAt: 10, fiveAt: 5 };

const FEAT_KINDS = ['bigScoring', 'hugeScoring', 'tripleDouble', 'fiveByFive'];

// The five categories a double or a five counts across.
const FEAT_CATEGORIES = ['points', 'rebounds', 'assists', 'steals', 'blocks'];

function featCategoryCount(line, bar) {
  return FEAT_CATEGORIES.reduce(function (n, key) {
    return (line[key] || 0) >= bar ? n + 1 : n;
  }, 0);
}

function makeFeat(kind, line, context) {
  return {
    leagueYear: context.leagueYear,
    day: context.day,
    playerId: context.playerId,
    playerName: context.playerName,
    teamId: context.teamId,
    oppTeamId: context.oppTeamId,
    kind: kind,
    points: line.points || 0,
    rebounds: line.rebounds || 0,
    assists: line.assists || 0,
    steals: line.steals || 0,
    blocks: line.blocks || 0
  };
}

// Zero or more feats for one line. A huge scoring night reports ONLY as huge:
// listing it as both would double-count it in every rate measurement and make
// the page read as though the player did two remarkable things.
function detectFeats(line, context) {
  if (!line) return [];
  const out = [];
  const points = line.points || 0;

  if (points >= FEAT_TUNING.hugeScoring) {
    out.push(makeFeat('hugeScoring', line, context));
  } else if (points >= FEAT_TUNING.bigScoring) {
    out.push(makeFeat('bigScoring', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.doubleAt) >= 3) {
    out.push(makeFeat('tripleDouble', line, context));
  }
  if (featCategoryCount(line, FEAT_TUNING.fiveAt) === FEAT_CATEGORIES.length) {
    out.push(makeFeat('fiveByFive', line, context));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectFeats: detectFeats,
    featCategoryCount: featCategoryCount,
    FEAT_TUNING: FEAT_TUNING,
    FEAT_KINDS: FEAT_KINDS,
    FEAT_CATEGORIES: FEAT_CATEGORIES
  };
}
