// Possession-by-possession engine — the "possession" SIM_ENGINES slot
// (see simEngine.js). Unlike simEngineBoxScore.js, which derives a final
// score from a team-rating diff and then distributes stats to match it,
// this engine simulates each individual possession (shot creator vs.
// defender matchup, make/miss, rebound, assist, turnover, foul) and the
// final score is just the sum of what actually happened. Slower and noisier
// than the box-score engine by design — that's the point of offering it as
// an alternative, not a bug.
var _POSS_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), simEngine: require('./simEngine.js'), traits: require('./traits.js'), box: require('./simEngineBoxScore.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      simEngine: { registerEngine: registerEngine },
      traits: { getTraitBonus: getTraitBonus },
      box: {
        distributeInt: distributeInt, scoringWeight: scoringWeight, reboundWeight: reboundWeight,
        assistWeight: assistWeight, stealWeight: stealWeight, blockWeight: blockWeight, minutesWeight: minutesWeight
      }
    };

// Real NBA teams average roughly 100 possessions each per game; this keeps
// that pace while staying cheap enough to run a full season in a few seconds.
const POSSESSIONS_PER_TEAM = 90;

function eligibleRoster(teamId) {
  const roster = _POSS_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  return roster.length > 0 ? roster : _POSS_DATA.league.getTeamRoster(teamId); // fully-depleted-roster fallback, shouldn't happen with real data
}

function weightedPick(players, weightFn, rng) {
  const weights = players.map(weightFn);
  const total = weights.reduce(function (a, b) { return a + b; }, 0);
  if (total <= 0) return players[Math.floor(rng() * players.length)];
  let r = rng() * total;
  for (let i = 0; i < players.length; i++) {
    r -= weights[i];
    if (r <= 0) return players[i];
  }
  return players[players.length - 1];
}

function ballHandlingWeight(player) {
  const a = player.attributes;
  return Math.max(1, (a.ballHandling + a.passing) / 2 + _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'assist'));
}

function perimDefenseWeight(player) { return Math.max(1, player.attributes.perimeterDefense); }

function initBoxLine() {
  return { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
}

// Shot zone from the shooter's hidden shot-mix tendencies (traits.js's
// generateTendencies) — same "hidden information drives outcomes" spirit as
// the box-score engine's deriveShootingLine, just resolved per-shot instead
// of after the fact.
function pickShotZone(shooter, rng) {
  const t = shooter.hiddenTendencies || {};
  const three = t.threeTendency !== undefined ? Math.max(1, t.threeTendency) : 33;
  const mid = t.midTendency !== undefined ? Math.max(1, t.midTendency) : 33;
  const inside = t.insideTendency !== undefined ? Math.max(1, t.insideTendency) : 34;
  const total = three + mid + inside;
  let r = rng() * total;
  if ((r -= three) <= 0) return 'three';
  if ((r -= mid) <= 0) return 'mid';
  return 'inside';
}

function shotMakeProbability(shooter, defender, zone) {
  const a = shooter.attributes;
  let base, shootAttr, defAttr;
  if (zone === 'three') { base = 0.36; shootAttr = a.threePoint; defAttr = defender.attributes.perimeterDefense; }
  else if (zone === 'mid') { base = 0.42; shootAttr = a.midRange; defAttr = defender.attributes.perimeterDefense; }
  else { base = 0.56; shootAttr = (a.insideScoring + a.postScoring) / 2; defAttr = defender.attributes.interiorDefense; }
  const skillAdj = (shootAttr - 50) / 250;
  const defAdj = (defAttr - 50) / 350;
  return Math.max(0.18, Math.min(0.72, base + skillAdj - defAdj));
}

// Simulates one team's single possession against the given defense, mutating
// both teams' box-line accumulators in place. Returns the points scored.
function simulatePossession(offense, offenseBox, defense, defenseBox, rng) {
  const handler = weightedPick(offense, ballHandlingWeight, rng);
  const onBallDefender = weightedPick(defense, perimDefenseWeight, rng);

  const turnoverChance = Math.max(0.04, Math.min(0.22,
    0.11 + (onBallDefender.attributes.steal - handler.attributes.ballHandling) / 400));
  if (rng() < turnoverChance) {
    if (rng() < 0.5) defenseBox[onBallDefender.id].steals += 1;
    return 0;
  }

  const shooter = weightedPick(offense, _POSS_DATA.box.scoringWeight, rng);
  const zone = pickShotZone(shooter, rng);
  const defenderAttr = zone === 'inside' ? 'interiorDefense' : 'perimeterDefense';
  const shotDefender = weightedPick(defense, function (p) { return Math.max(1, p.attributes[defenderAttr]); }, rng);

  const blockChance = zone === 'three' ? 0.01 : Math.max(0, (shotDefender.attributes.block - 50) / 900);
  if (rng() < blockChance) {
    defenseBox[shotDefender.id].blocks += 1;
    offenseBox[shooter.id].fga += 1;
    if (zone === 'three') offenseBox[shooter.id].tpa += 1;
    return 0;
  }

  const makeProb = shotMakeProbability(shooter, shotDefender, zone);
  const made = rng() < makeProb;
  const shotValue = zone === 'three' ? 3 : 2;
  offenseBox[shooter.id].fga += 1;
  if (zone === 'three') offenseBox[shooter.id].tpa += 1;

  let points = 0;
  if (made) {
    offenseBox[shooter.id].fgm += 1;
    if (zone === 'three') offenseBox[shooter.id].tpm += 1;
    offenseBox[shooter.id].points += shotValue;
    points += shotValue;
    if (rng() < 0.6) {
      const passer = weightedPick(offense.filter(function (p) { return p.id !== shooter.id; }), ballHandlingWeight, rng);
      if (passer) offenseBox[passer.id].assists += 1;
    }
  } else {
    const offReboundChance = 0.25;
    if (rng() < offReboundChance) {
      const rebounder = weightedPick(offense, _POSS_DATA.box.reboundWeight, rng);
      offenseBox[rebounder.id].rebounds += 1;
    } else {
      const rebounder = weightedPick(defense, _POSS_DATA.box.reboundWeight, rng);
      defenseBox[rebounder.id].rebounds += 1;
    }
  }

  // Shooting foul: a flat chance of 2 bonus free throws on top of the field
  // goal attempt above (and-1s and non-shooting fouls folded into the same
  // rough rate — this is a pace-of-play approximation, not a foul model).
  if (rng() < 0.11) {
    const ftAttempts = 2;
    const ftPct = Math.max(0.55, Math.min(0.95, shooter.attributes.freeThrow / 105));
    let made2 = 0;
    for (let i = 0; i < ftAttempts; i++) { if (rng() < ftPct) made2 += 1; }
    offenseBox[shooter.id].fta += ftAttempts;
    offenseBox[shooter.id].ftm += made2;
    offenseBox[shooter.id].points += made2;
    points += made2;
  }

  return points;
}

function simulateTeamMinutes(roster) {
  const minutes = _POSS_DATA.box.distributeInt(240, roster.map(_POSS_DATA.box.minutesWeight));
  const byId = {};
  roster.forEach(function (p, i) { byId[p.id] = minutes[i]; });
  return byId;
}

function simulateGame(homeTeamId, awayTeamId, rng) {
  const homeRoster = eligibleRoster(homeTeamId);
  const awayRoster = eligibleRoster(awayTeamId);

  const homeBox = {};
  homeRoster.forEach(function (p) { homeBox[p.id] = initBoxLine(); });
  const awayBox = {};
  awayRoster.forEach(function (p) { awayBox[p.id] = initBoxLine(); });

  const homeMinutes = simulateTeamMinutes(homeRoster);
  const awayMinutes = simulateTeamMinutes(awayRoster);
  homeRoster.forEach(function (p) { homeBox[p.id].minutes = homeMinutes[p.id]; });
  awayRoster.forEach(function (p) { awayBox[p.id].minutes = awayMinutes[p.id]; });

  let homeScore = 0;
  let awayScore = 0;
  for (let i = 0; i < POSSESSIONS_PER_TEAM; i++) {
    homeScore += simulatePossession(homeRoster, homeBox, awayRoster, awayBox, rng);
    awayScore += simulatePossession(awayRoster, awayBox, homeRoster, homeBox, rng);
  }

  if (homeScore === awayScore) {
    // NBA games can't end in a tie — nudge whichever team had more makes.
    const homeMakes = Object.keys(homeBox).reduce(function (s, id) { return s + homeBox[id].fgm; }, 0);
    const awayMakes = Object.keys(awayBox).reduce(function (s, id) { return s + awayBox[id].fgm; }, 0);
    if (homeMakes >= awayMakes) { homeBox[homeRoster[0].id].points += 1; homeScore += 1; }
    else { awayBox[awayRoster[0].id].points += 1; awayScore += 1; }
  }

  return { homeScore: homeScore, awayScore: awayScore, boxScore: Object.assign({}, homeBox, awayBox) };
}

_POSS_DATA.simEngine.registerEngine('possession', { simulateGame: simulateGame });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
    weightedPick: weightedPick,
    pickShotZone: pickShotZone,
    shotMakeProbability: shotMakeProbability,
    simulatePossession: simulatePossession,
    simulateGame: simulateGame
  };
}
