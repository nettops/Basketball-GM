var _ENGINE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngine: require('./simEngine.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, teams: { getTeamById: getTeamById }, simEngine: { registerEngine: registerEngine }, traits: { getTraitBonus: getTraitBonus } };

function computeTeamRating(teamId) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const rotation = roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).slice(0, 8);
  if (rotation.length === 0) return 50; // fully depleted roster fallback, shouldn't happen with real data
  const avgOverall = rotation.reduce(function (s, p) { return s + p.rawOverall; }, 0) / rotation.length;
  const avgFatiguePenalty = (rotation.reduce(function (s, p) { return s + p.status.fatigue; }, 0) / rotation.length) * 0.1;
  const team = _ENGINE_DATA.teams.getTeamById(teamId);
  const chemistryBonus = (team.chemistry - 70) * 0.05;
  // Modest nudge from hidden traits: a rotation stacked with Sharpshooters/Lockdown
  // Defenders plays a little better than raw overall alone would predict.
  const traitBonus = rotation.reduce(function (s, p) {
    return s + _ENGINE_DATA.traits.getTraitBonus(p, 'boxscore', 'scoring') + _ENGINE_DATA.traits.getTraitBonus(p, 'boxscore', 'defense');
  }, 0) / rotation.length * 0.15;
  // Coach quality contributes a small game-day edge on top of pure roster talent.
  const coachBonus = team.coach ? (team.coach.overall - 70) * 0.04 : 0;
  return avgOverall - avgFatiguePenalty + chemistryBonus + traitBonus + coachBonus;
}

// paceAdjustment shifts both teams' expected possessions equally — derived
// by simulateBoxScoreGame from both teams' strategy.pace dial (coaches.js /
// ui/coaching.js), so a fast-paced matchup runs higher-scoring than a
// slow-paced one regardless of which side has the rating edge.
function simulateScore(homeRating, awayRating, rng, paceAdjustment) {
  const BASE_PACE = 112 + (paceAdjustment || 0);
  const HOME_COURT_BONUS = 3;
  const diff = homeRating - awayRating;
  const homeExpected = BASE_PACE + diff * 0.6 + HOME_COURT_BONUS;
  const awayExpected = BASE_PACE - diff * 0.6;
  let homeScore = Math.round(homeExpected + (rng() - 0.5) * 24);
  let awayScore = Math.round(awayExpected + (rng() - 0.5) * 24);
  homeScore = Math.max(70, homeScore);
  awayScore = Math.max(70, awayScore);
  if (homeScore === awayScore) {
    // NBA games can't end in a tie — nudge whichever team had the rating edge.
    if (homeRating >= awayRating) homeScore += 1; else awayScore += 1;
  }
  return { homeScore: homeScore, awayScore: awayScore };
}

// Largest-remainder distribution: splits `total` across `weights` proportionally,
// as integers that sum to exactly `total` (never over/under by rounding drift).
// Reused for points, rebounds, assists, steals, blocks, and minutes.
function distributeInt(total, weights) {
  const sumW = weights.reduce(function (a, b) { return a + b; }, 0);
  if (sumW <= 0) {
    // No positive weights (shouldn't happen with real rosters) — split evenly.
    const even = weights.map(function () { return Math.floor(total / weights.length); });
    let leftover = total - even.reduce(function (a, b) { return a + b; }, 0);
    for (let i = 0; leftover > 0; i = (i + 1) % even.length, leftover--) even[i]++;
    return even;
  }
  const raw = weights.map(function (w) { return (total * w) / sumW; });
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce(function (a, b) { return a + b; }, 0);
  const order = raw.map(function (v, i) { return { i: i, frac: v - Math.floor(v) }; })
    .sort(function (a, b) { return b.frac - a.frac; });
  const result = floors.slice();
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].i] += 1;
  }
  return result;
}

function scoringWeight(player) {
  const a = player.attributes;
  const base = (a.insideScoring + a.midRange + a.threePoint + a.postScoring) / 4;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'scoring'));
}
function reboundWeight(player) {
  const a = player.attributes;
  const base = (a.offReb + a.defReb) / 2;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}
// The two ends of the floor, weighted separately, because that is the whole
// point of splitting the column: a centre who lives on the offensive glass and
// a guard who gets his boards uncontested should not read the same. Blending
// them back into one average, then taking a flat share of it, would give every
// player on the roster the identical split.
function offReboundWeight(player) {
  const a = player.attributes;
  return Math.max(1, a.offReb + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}
function defReboundWeight(player) {
  const a = player.attributes;
  return Math.max(1, a.defReb + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}

// Share of a team's boards that come at the offensive end. Measured off the
// possession engine, which produces 26% unprompted from its own rebound roll —
// the two engines have to agree about this or a season simmed on one would
// read differently from a season simmed on the other.
const OFFENSIVE_REBOUND_SHARE = 0.26;
function assistWeight(player) {
  const a = player.attributes;
  const base = (a.passing + a.ballHandling) / 2;
  return Math.max(1, base + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'assist'));
}
function stealWeight(player) {
  return Math.max(1, player.attributes.steal + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'steal'));
}
function blockWeight(player) {
  return Math.max(1, player.attributes.block + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'block'));
}
// No offset. This was `overall - 40`, a hard constant that only made sense
// while overall averaged 74.7 — it existed to WIDEN the proportional split for
// the distributeInt call above, turning a 62-98 overall range into 22-58, a
// 2.64x spread.
//
// Once overall became derived (ratings.js) its mean fell to 47.8 and the
// subtraction went negative for the bottom quarter of the league, where the
// max(1, ...) guard flattened 158 players of differing quality onto an
// identical weight of 1. gameCoach.rotationRanks and gameSim's starter
// selection both SORT by this, so their order became arbitrary — 36 of those
// players sat inside a ten-man rotation, and on Boston's bench a 38 overall
// ranked below a 37 on nothing but sort stability.
//
// The offset is no longer needed because the rescaled range does its job:
// raw overall now spans 29-78, a 2.69x proportional spread against the old
// post-offset 2.64x. Removing it also returns the usage trait to being a
// modifier — a legendary +8 was 23% of the median weight before the rescale
// and 103% after it, and is 17% now — without retuning a single tier constant.
//
// Kept scale-free deliberately: any constant subtracted here is a bet on where
// the rating scale sits, and that bet has now been wrong once.
// Reads rawOverall, NOT the display value. The proportional spread is the whole
// point of this weight: raw spans 29-78 (2.69x), display spans 60-95 (1.58x).
// Pointing this at display would cut star usage by 40% while every test stayed
// green except the golden master.
function minutesWeight(player) {
  return Math.max(1, player.rawOverall + _ENGINE_DATA.traits.getTraitBonus(player, 'boxscore', 'usage'));
}

// The ONE ordering that decides both who tips off (gameSim's pickStarters) and
// each player's minute target (gameCoach's rotationRanks -> targetMinutes).
// They have to read the same list: promoting a user's pick into the starting
// five without also promoting his rotation rank leaves him a target of zero
// minutes, and decideSubstitutions rule 5 pulls him at the first whistle — the
// pick would look applied and be undone seconds later.
//
// With no startingFive this returns byte-for-byte the sort both callers used
// before this existed, which is what lets the gamesim and rollover goldens pass
// unregenerated and makes the whole feature opt-in.
const STARTERS = 5;

function lineupOrder(roster, team) {
  const byWeight = roster.slice().sort(function (a, b) {
    return minutesWeight(b) - minutesWeight(a);
  });
  const picks = (team && team.startingFive) || [];
  if (picks.length === 0) return byWeight;

  const inRoster = {};
  roster.forEach(function (p) { inRoster[p.id] = p; });

  const chosen = [];
  const taken = {};
  picks.forEach(function (id) {
    if (chosen.length >= STARTERS) return;   // never promote more than a five
    if (taken[id]) return;                   // duplicate id
    const p = inRoster[id];
    // Absent from the roster handed in: traded, released, or — because
    // eligibleRoster filters before the sim sees anything — injured tonight.
    // Either way the next man simply slides up and the stored pick is intact.
    if (!p) return;
    taken[id] = true;
    chosen.push(p);
  });
  if (chosen.length === 0) return byWeight;

  return chosen.concat(byWeight.filter(function (p) { return !taken[p.id]; }));
}

// Splits a player's points into approximate FG/3PT/FT makes+attempts, weighted by
// their shooting attributes. This is a flavor-stat approximation, not a precise
// possession-level shot model (that's the possession-by-possession engine, later).
function deriveShootingLine(player, points, rng, threePointRateDial) {
  if (points === 0) return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, insideFga: 0, insideFgm: 0, midFga: 0, midFgm: 0 };
  const a = player.attributes;
  const ftShare = Math.min(0.35, 0.10 + (a.freeThrow - 50) / 300);
  const ftPoints = Math.round(points * Math.max(0, ftShare));
  // hiddenTendencies.threeTendency is a ~0-100 share of a player's shot mix
  // (see traits.js's generateTendencies); nudge the visible-attribute-driven
  // three-point share by how far it sits from a neutral one-third split.
  const tendencyNudge = (player.hiddenTendencies && player.hiddenTendencies.threeTendency !== undefined) ? (player.hiddenTendencies.threeTendency - 33) / 300 : 0;
  // team.strategy.threePointRate (coaches.js / ui/coaching.js), roughly -1..1,
  // nudges every player's three-point share the same direction — a coach's
  // scheme, not an individual shot preference.
  const strategyNudge = (threePointRateDial || 0) * 0.06;
  const threeShare = Math.min(0.6, Math.max(0, (a.threePoint - 50) / 120 + tendencyNudge + strategyNudge));
  const remainderAfterFt = points - ftPoints;
  let threeMade = Math.round((remainderAfterFt * threeShare) / 3);
  let threePoints = threeMade * 3;
  if (threePoints > remainderAfterFt) { threeMade = Math.floor(remainderAfterFt / 3); threePoints = threeMade * 3; }
  const twoPointRemainder = remainderAfterFt - threePoints;
  const twoMade = Math.round(twoPointRemainder / 2);

  const twoPct = Math.max(0.30, Math.min(0.65, ((a.insideScoring + a.midRange) / 2) / 150));
  const threePct = Math.max(0.20, Math.min(0.50, a.threePoint / 180));
  const ftPct = Math.max(0.55, Math.min(0.95, a.freeThrow / 105));

  const twoAttempts = twoMade > 0 ? Math.max(twoMade, Math.round(twoMade / twoPct)) : (rng() < 0.15 ? 1 : 0);
  const threeAttempts = threeMade > 0 ? Math.max(threeMade, Math.round(threeMade / threePct)) : (rng() < 0.1 ? 1 : 0);
  const ftAttempts = ftPoints > 0 ? Math.max(Math.round(ftPoints / 1), Math.round(ftPoints / ftPct)) : 0;

  // Split the two-pointers across the rim and the mid-range, so this engine
  // answers the same question the possession engine does — it is selectable in
  // ui/settings.js, and without this a player who switches engines gets a
  // season of empty shot charts.
  //
  // Read from the same hiddenTendencies pair pickShotZone uses, with the same
  // neutral fallback, so the two engines describe a player's shot diet the same
  // way. Deliberately draws no rng: the split is a rounding of an existing
  // total, and a new draw here would move every seeded result in this engine.
  //
  // The remainder always goes to mid-range rather than being rounded
  // independently, which makes inside + mid === two by construction — the
  // invariant validate-shotZones.js asserts cannot fail by a rounding penny.
  const t = player.hiddenTendencies || {};
  const insideT = t.insideTendency !== undefined ? Math.max(1, t.insideTendency) : 34;
  const midT = t.midTendency !== undefined ? Math.max(1, t.midTendency) : 33;
  const insideShare = insideT / (insideT + midT);
  const insideAttempts = Math.round(twoAttempts * insideShare);
  const insideMade = Math.min(insideAttempts, Math.round(twoMade * insideShare));

  return {
    fgm: twoMade + threeMade,
    fga: twoAttempts + threeAttempts,
    tpm: threeMade,
    tpa: threeAttempts,
    ftm: ftPoints,
    fta: ftAttempts,
    insideFga: insideAttempts,
    insideFgm: insideMade,
    midFga: twoAttempts - insideAttempts,
    midFgm: twoMade - insideMade
  };
}

// `opponentScore` exists only to produce a plus/minus. This engine never
// tracks who was on the floor together — it distributes whole-game totals
// after the fact — so a real possession-level plus/minus is not available
// here. A minutes-weighted share of the margin is correct in expectation and
// preserves the identity the possession engine satisfies exactly: the team's
// summed plus/minus equals five times the margin, because the minutes sum to
// 240. Approximate, and honestly so; the possession engine is the one whose
// plus/minus scripts/fit-overall.js regresses against.
function simulateTeamBoxScore(teamId, teamScore, opponentScore, rng) {
  const roster = _ENGINE_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  const minutes = distributeInt(240, roster.map(minutesWeight));
  const points = distributeInt(teamScore, roster.map(scoringWeight));
  // ~42 total rebounds/team is a realistic NBA average. Distributed as two
  // separate pots and summed, rather than one pot then split, so that
  // oreb + dreb === rebounds holds exactly with no rounding slack.
  const totalBoards = Math.round(teamScore * 0.42);
  const offBoards = Math.round(totalBoards * OFFENSIVE_REBOUND_SHARE);
  const oreb = distributeInt(offBoards, roster.map(offReboundWeight));
  const dreb = distributeInt(totalBoards - offBoards, roster.map(defReboundWeight));
  const assists = distributeInt(Math.round(teamScore * 0.22), roster.map(assistWeight));
  const steals = distributeInt(7, roster.map(stealWeight));
  const blocks = distributeInt(5, roster.map(blockWeight));
  const team = _ENGINE_DATA.teams.getTeamById(teamId);
  const threePointRateDial = team.strategy ? team.strategy.threePointRate : 0;

  const boxScore = {};
  roster.forEach(function (p, i) {
    const shooting = deriveShootingLine(p, points[i], rng, threePointRateDial);
    boxScore[p.id] = {
      // Which team the player suited up for IN THIS GAME. Without it the only
      // way to attribute a line is the player's current teamId, which goes
      // stale the moment they're traded — the schedule's box score then drops
      // those lines entirely. Not a SEASON_STAT_KEY, so it's ignored by
      // accumulateSeasonStats and the career-high checks.
      teamId: teamId,
      minutes: minutes[i],
      points: points[i],
      rebounds: oreb[i] + dreb[i],
      oreb: oreb[i],
      dreb: dreb[i],
      assists: assists[i],
      steals: steals[i],
      blocks: blocks[i],
      fgm: shooting.fgm,
      fga: shooting.fga,
      tpm: shooting.tpm,
      tpa: shooting.tpa,
      ftm: shooting.ftm,
      fta: shooting.fta,
      insideFga: shooting.insideFga,
      insideFgm: shooting.insideFgm,
      midFga: shooting.midFga,
      midFgm: shooting.midFgm,
      plusMinus: Math.round((minutes[i] / 240) * 5 * (teamScore - opponentScore))
    };
  });
  return boxScore;
}

// Named distinctly from simEnginePossession.js's own simulateGame — both
// files load as plain global scripts, so a same-named top-level function
// here would silently shadow (or be shadowed by) the other engine's version
// for any caller that isn't going through the SIM_ENGINES registry. See the
// commissioner.js/progression.js clampRating collision this project already
// hit for what that class of bug looks like once it isn't caught early.
function simulateBoxScoreGame(homeTeamId, awayTeamId, rng) {
  const homeRating = computeTeamRating(homeTeamId);
  const awayRating = computeTeamRating(awayTeamId);
  const homeTeam = _ENGINE_DATA.teams.getTeamById(homeTeamId);
  const awayTeam = _ENGINE_DATA.teams.getTeamById(awayTeamId);
  const homePace = homeTeam.strategy ? homeTeam.strategy.pace : 0;
  const awayPace = awayTeam.strategy ? awayTeam.strategy.pace : 0;
  const paceAdjustment = ((homePace || 0) + (awayPace || 0)) / 2 * 4; // dial is roughly -1..1, worth up to ±4 possessions
  const score = simulateScore(homeRating, awayRating, rng, paceAdjustment);
  const homeBox = simulateTeamBoxScore(homeTeamId, score.homeScore, score.awayScore, rng);
  const awayBox = simulateTeamBoxScore(awayTeamId, score.awayScore, score.homeScore, rng);
  return {
    homeScore: score.homeScore,
    awayScore: score.awayScore,
    boxScore: Object.assign({}, homeBox, awayBox)
  };
}

_ENGINE_DATA.simEngine.registerEngine('boxscore', { simulateGame: simulateBoxScoreGame });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeTeamRating: computeTeamRating,
    simulateScore: simulateScore,
    distributeInt: distributeInt,
    simulateGame: simulateBoxScoreGame,
    scoringWeight: scoringWeight,
    reboundWeight: reboundWeight,
    assistWeight: assistWeight,
    stealWeight: stealWeight,
    blockWeight: blockWeight,
    minutesWeight: minutesWeight,
    lineupOrder: lineupOrder
  };
}
