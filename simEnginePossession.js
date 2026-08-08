// Possession-by-possession engine — the "possession" SIM_ENGINES slot
// (see simEngine.js). Unlike simEngineBoxScore.js, which derives a final
// score from a team-rating diff and then distributes stats to match it,
// this engine simulates each individual possession (shot creator vs.
// defender matchup, make/miss, rebound, assist, turnover, foul) and the
// final score is just the sum of what actually happened. Slower and noisier
// than the box-score engine by design — that's the point of offering it as
// an alternative, not a bug.
var _POSS_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js'), box: require('./simEngineBoxScore.js'), composite: require('./compositeRatings.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      traits: { getTraitBonus: getTraitBonus },
      box: {
        distributeInt: distributeInt, scoringWeight: scoringWeight, reboundWeight: reboundWeight,
        assistWeight: assistWeight, stealWeight: stealWeight, blockWeight: blockWeight, minutesWeight: minutesWeight
      },
      composite: { computeComposite: computeComposite, computeTeamSynergy: computeTeamSynergy }
    };

// Real NBA teams average roughly 100 possessions each per game; this keeps
// that pace while staying cheap enough to run a full season in a few seconds.
const POSSESSIONS_PER_TEAM = 90;

function eligibleRoster(teamId) {
  const roster = _POSS_DATA.league.getTeamRoster(teamId).filter(function (p) { return !p.status.injury; });
  return roster.length > 0 ? roster : _POSS_DATA.league.getTeamRoster(teamId); // fully-depleted-roster fallback, shouldn't happen with real data
}

// `power` raises each weight before normalizing, which is how ZenGM controls
// whether an event concentrates on one player or spreads across the floor
// (ratingArray in GameSim.basketball/index.ts). Power 1 is a flat linear share;
// power 10 gives the best player on the floor about 79% of the events. Every
// pick here was effectively power 1, which is why the best scorer on the floor
// took only 1.44x the shots of the worst against the real NBA's 2.9x.
//
// PICK_FLOOR mirrors ZenGM's 5% floor: a role player is never completely frozen
// out. Without it, high powers produce players who literally never shoot, which
// reads as broken rather than as authentic.
//
// Draws exactly one rng value, as before, so the rng stream stays aligned.
const PICK_FLOOR = 0.05;

function weightedPick(players, weightFn, rng, power) {
  const p = (power === undefined) ? 1 : power;
  let weights = players.map(function (pl) { return Math.pow(Math.max(0, weightFn(pl)), p); });
  const raw = weights.reduce(function (a, b) { return a + b; }, 0);
  if (raw <= 0) return players[Math.floor(rng() * players.length)];
  const floor = PICK_FLOOR * raw;
  weights = weights.map(function (w) { return Math.max(w, floor); });
  const total = weights.reduce(function (a, b) { return a + b; }, 0);
  let r = rng() * total;
  for (let i = 0; i < players.length; i++) {
    r -= weights[i];
    if (r <= 0) return players[i];
  }
  return players[players.length - 1];
}

// Free throws and the shooting-foul rate, both recalibrated for the 0-100
// rating scale. FT_BASE is the league-average free-throw shooter (~78% in the
// real NBA); FT_DIV sets how far a great one separates from a poor one.
// 0.140 calibrated by measured rate against the NBA's ~22 attempts per
// team-game: 0.11 measured 17.7, 0.125 measured 19.8, 0.140 measures 22.3.
const SHOOTING_FOUL_RATE = 0.140;
const FT_BASE = 0.78, FT_DIV = 500;

// One number per event, calibrated by the measured spread each produces — the
// sweep is in this task's commit message. ZenGM's equivalents: usage 1.25,
// turnovers 2, defensive rebounds 3, steals 4, offensive rebounds 5, assists 10,
// blocks 10. Ours run lower on the shooter because our scoringWeight already
// spans p95/p05 = 2.54x, against ZenGM's usage composite at 1.85x — the same
// exponent bites harder on a wider input.
const PICK_POWER = {
  handler: 3,
  shooter: 1.4,
  passer: 6,
  onBallDefender: 2,
  shotDefender: 2,
  rebounder: 3
};

function ballHandlingWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'ballHandling') + _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'assist'));
}

function perimDefenseWeight(player) { return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'defensePerimeter')); }

function reboundCompositeWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'rebounding') + _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}

function initBoxLine() {
  return { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, energy: 1, fouls: 0, plusMinus: 0 };
}

// In-game stamina, separate from status.fatigue (fatigue.js's cross-game,
// season-long accumulation used by the box-score engine's team rating).
// This resets every game and only exists for the length of one
// simulatePossessionGame call — it's what makes a heavily-used player look a
// little worse in the fourth quarter of THIS game, not a lingering effect.
// Floor of 0.85x (rather than letting effectiveness collapse toward zero)
// mirrors real players never truly bottoming out — they're gassed, not
// incapacitated.
function energyMultiplier(energy) { return 0.85 + 0.15 * energy; }

// Higher workEthic (this game's proxy for conditioning — there's no
// dedicated stamina/endurance rating in ATTRIBUTE_KEYS) drains slower.
function drainEnergy(box, player) {
  const drainRate = 0.02 - (player.attributes.workEthic - 50) / 5000;
  box.energy = Math.max(0.4, box.energy - drainRate);
}

// NBA foul-out is 6; a player deep in foul trouble plays far more
// cautiously on defense well before actually fouling out, so the penalty
// ramps up starting at 4.
function foulTroubleMultiplier(fouls) {
  if (fouls >= 6) return 0.3;
  if (fouls >= 4) return 0.75;
  return 1;
}

// Wraps a base selection-weight function so it also accounts for this
// game's accumulated energy drain and foul trouble — used for every
// weightedPick call in simulatePossession so a gassed or foul-plagued
// player gradually stops being picked as the primary option WITHIN the five
// currently on the floor. Actually going to a fresher body is a separate
// concern handled a level up, by gameSim.js's rotations.
function energyAware(baseWeightFn, box, applyFoulTrouble) {
  return function (p) {
    const line = box[p.id];
    const mult = energyMultiplier(line.energy) * (applyFoulTrouble ? foulTroubleMultiplier(line.fouls) : 1);
    return Math.max(1, baseWeightFn(p) * mult);
  };
}

// Shot zone from the shooter's hidden shot-mix tendencies (traits.js's
// generateTendencies) — same "hidden information drives outcomes" spirit as
// the box-score engine's deriveShootingLine, just resolved per-shot instead
// of after the fact.
// In transition the rim is open, so the shot mix swings hard toward it. The
// engine had no concept of a break at all: shot zone came off flat tendencies
// whatever the situation, so a possession that began with a steal ended at the
// rim 40% of the time against 44% for a walk-up half-court set — breaks
// finished at the rim LESS often than everything else, which is backwards.
// Calibrated by measured rate, not picked. A first sweep scaled the rim up and
// BOTH other zones down — x2.2 gave 79% inside (nearly every break a layup,
// which trades one kind of sameness for another), x1.55 gave 63%.
//
// But paying for the rim out of threes was wrong. It dropped the league's 3PA
// share from 29.9% to 25.3% — a real distortion of the league's identity, to
// model a situation that in reality suppresses the MID-RANGE. Transition
// offence is the rim and the trailer three; the pull-up 18-footer is the shot
// that disappears. Taking the volume from mid instead holds 3PA at 29.1%
// against a 29.9% baseline while still putting 63% of break shots at the rim.
const TRANSITION_INSIDE_MULT = 1.6;
const TRANSITION_THREE_MULT = 1.0;
const TRANSITION_MID_MULT = 0.35;

function pickShotZone(shooter, rng, inTransition) {
  const t = shooter.hiddenTendencies || {};
  let three = t.threeTendency !== undefined ? Math.max(1, t.threeTendency) : 33;
  let mid = t.midTendency !== undefined ? Math.max(1, t.midTendency) : 33;
  let inside = t.insideTendency !== undefined ? Math.max(1, t.insideTendency) : 34;
  if (inTransition) {
    // Scaled, not replaced: a stretch big who never gets to the rim in the
    // half court should still be the least likely man on the break to finish
    // there. The bias moves the mix, it does not flatten the players.
    inside *= TRANSITION_INSIDE_MULT;
    three *= TRANSITION_THREE_MULT;
    mid *= TRANSITION_MID_MULT;
  }
  const total = three + mid + inside;
  let r = rng() * total;
  if ((r -= three) <= 0) return 'three';
  if ((r -= mid) <= 0) return 'mid';
  return 'inside';
}

// offenseSynergy/defenseSynergy are the shooting team's and defending team's
// per-game synergy multipliers (computeTeamSynergy, computed once per game —
// see simulatePossessionGame) rather than anything derived from this one
// shooter/defender pairing: a team full of shooters raises everyone's look
// quality (floor spacing), and a team full of good defenders suppresses it,
// independent of who specifically is on the floor for this possession.
// shooterEnergyMult/defenderEnergyMult (from energyMultiplier, 0.85-1.0)
// scale down how much each side's skill edge actually shows up on this
// possession — a tired shooter's touch suffers, a tired defender's
// contest is a beat late — without erasing the underlying rating gap.
function shotMakeProbability(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult) {
  let base, shootComposite, defComposite;
  if (zone === 'three') { base = 0.330; shootComposite = _POSS_DATA.composite.computeComposite(shooter, 'shootingThree'); defComposite = _POSS_DATA.composite.computeComposite(defender, 'defensePerimeter'); }
  else if (zone === 'mid') { base = 0.42; shootComposite = _POSS_DATA.composite.computeComposite(shooter, 'shootingMid'); defComposite = _POSS_DATA.composite.computeComposite(defender, 'defensePerimeter'); }
  else { base = 0.56; shootComposite = _POSS_DATA.composite.computeComposite(shooter, 'shootingInside'); defComposite = _POSS_DATA.composite.computeComposite(defender, 'defenseInterior'); }
  const skillAdj = (shootComposite - 50) / 250 * (shooterEnergyMult !== undefined ? shooterEnergyMult : 1);
  const defAdj = (defComposite - 50) / 350 * (defenderEnergyMult !== undefined ? defenderEnergyMult : 1);
  const synergyAdj = (offenseSynergy || 1) - (defenseSynergy || 1);
  return Math.max(0.18, Math.min(0.72, base + skillAdj - defAdj + synergyAdj));
}

// Appends a play-by-play line if `log` was supplied (simulatePossessionGame
// always supplies one — see the module comment there on why play-by-play is
// always generated and pruned at save time instead of gated behind a flag).
function logPlay(log, text) {
  if (log) log.push(text);
}

// Structured-event twin of logPlay for the pixel game view (see
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md). eventCtx is
// { events, team, quarter } or null; pushing events never touches the rng,
// so capture-on and capture-off runs are bit-identical
// (scripts/validate-pixel-events.js proves this).
function pushEvent(eventCtx, ev) {
  if (!eventCtx) return;
  ev.team = eventCtx.team;
  ev.quarter = eventCtx.quarter;
  // period distinguishes overtime (5+) from Q4, which `quarter` clamps away;
  // clock is the real game clock at the start of this possession.
  ev.period = eventCtx.period;
  ev.clock = eventCtx.clock;
  // Only on the possession event: the five cannot change mid-possession, so
  // repeating them on every play would be ten ids of pure duplication.
  if (ev.type === 'possession') ev.lineups = eventCtx.lineups;
  eventCtx.events.push(ev);
}

// Simulates one team's single possession against the given defense, mutating
// both teams' box-line accumulators in place. Returns the points scored.
// `synergy` is { offense: {offense,defense,rebound}, defense: {...} } — the
// two teams' per-game synergy multipliers computed once by
// simulatePossessionGame (see computeTeamSynergy), not recomputed here.
// `log`, if supplied, gets a human-readable line appended for whatever
// happened this possession.
// `inTransition` says this possession began off a live ball — a steal or a
// defensive rebound — and biases the shot mix toward the rim. `outcome`, if
// supplied, is filled in with how THIS possession ended so the caller can set
// inTransition for the next one; the events context is null in a plain season
// sim, so the handoff cannot be read back off the event log.
function simulatePossession(offense, offenseBox, defense, defenseBox, rng, synergy, log, eventCtx, inTransition, outcome) {
  const offSyn = synergy ? synergy.offense : { offense: 1, defense: 1, rebound: 1 };
  const defSyn = synergy ? synergy.defense : { offense: 1, defense: 1, rebound: 1 };
  if (outcome) outcome.liveBallToDefense = false;

  const handler = weightedPick(offense, energyAware(ballHandlingWeight, offenseBox, false), rng, PICK_POWER.handler);
  const onBallDefender = weightedPick(defense, energyAware(perimDefenseWeight, defenseBox, true), rng, PICK_POWER.onBallDefender);
  drainEnergy(offenseBox[handler.id], handler);
  drainEnergy(defenseBox[onBallDefender.id], onBallDefender);
  pushEvent(eventCtx, { type: 'possession', playerId: handler.id });

  const turnoverChance = Math.max(0.04, Math.min(0.22,
    0.11 + (onBallDefender.attributes.steal - handler.attributes.ballHandling) / 400 + (defSyn.defense - offSyn.offense) * 0.3));
  if (rng() < turnoverChance) {
    const stolen = rng() < 0.5;
    if (stolen) defenseBox[onBallDefender.id].steals += 1;
    logPlay(log, handler.name + ' turns it over' + (stolen ? ', stolen by ' + onBallDefender.name : ''));
    pushEvent(eventCtx, { type: 'turnover', playerId: handler.id, defenderId: stolen ? onBallDefender.id : null });
    // only a STEAL is a live ball; a dead-ball turnover is inbounded
    if (outcome) outcome.liveBallToDefense = stolen;
    return 0;
  }

  const shooter = weightedPick(offense, energyAware(_POSS_DATA.box.scoringWeight, offenseBox, false), rng, PICK_POWER.shooter);
  const zone = pickShotZone(shooter, rng, inTransition);
  const defComposite = zone === 'inside' ? 'defenseInterior' : 'defensePerimeter';
  const shotDefender = weightedPick(defense, energyAware(function (p) { return _POSS_DATA.composite.computeComposite(p, defComposite); }, defenseBox, true), rng, PICK_POWER.shotDefender);
  drainEnergy(offenseBox[shooter.id], shooter);
  drainEnergy(defenseBox[shotDefender.id], shotDefender);
  const zoneLabel = zone === 'three' ? '3-pointer' : (zone === 'mid' ? 'mid-range jumper' : 'shot inside');

  // This was `max(0, (block - 50) / 900)`, which assumed 50 was the BOTTOM of
  // the rating scale rather than its middle — on the old 48-99 attributes
  // nobody was ever clipped, but on a true 0-100 scale it zeroed half the
  // league and blocks fell from 1.86 to 0.87 per team-game. Reshaped to a base
  // plus a deviation so a below-average shot-blocker is merely unlikely to
  // block rather than literally unable to.
  //
  // BLOCK_BASE calibrated to RESTORE the pre-rescale rate (1.86 blocks per
  // team-game; 0.020 measures 1.78), deliberately NOT to the real NBA's ~4.9.
  //
  // This rescale's job is to not break anything, and the block rate was
  // already 2.6x under the real league before it. Fixing that is a balance
  // change, and it is not free: validate-impactMoments.js gates the block
  // comic-panel population at 2-7 per game, so an NBA-realistic block rate
  // (BLOCK_BASE 0.085 measures 4.73/team, 9.5/game) would roughly triple the
  // tier-2 impact effects. How many comic panels a game should carry is a
  // feel decision, not an arithmetic one. Left for the recalibration task with
  // the sweep already measured:
  //   0.020 -> 1.78/team   0.030 -> 2.20   0.055 -> 3.28
  //   0.070 -> 4.38        0.085 -> 4.73 (NBA-realistic)
  const BLOCK_BASE = 0.020, BLOCK_DIV = 420, BLOCK_MIN = 0.004, BLOCK_MAX = 0.20;
  const blockChance = zone === 'three'
    ? 0.008
    : Math.max(BLOCK_MIN, Math.min(BLOCK_MAX, BLOCK_BASE + (shotDefender.attributes.block - 50) / BLOCK_DIV));
  if (rng() < blockChance) {
    defenseBox[shotDefender.id].blocks += 1;
    offenseBox[shooter.id].fga += 1;
    if (zone === 'three') offenseBox[shooter.id].tpa += 1;
    logPlay(log, shooter.name + '\'s ' + zoneLabel + ' is blocked by ' + shotDefender.name);
    pushEvent(eventCtx, { type: 'block', playerId: shooter.id, defenderId: shotDefender.id, zone: zone });
    return 0;
  }

  const makeProb = shotMakeProbability(shooter, shotDefender, zone, offSyn.offense, defSyn.defense,
    energyMultiplier(offenseBox[shooter.id].energy), energyMultiplier(defenseBox[shotDefender.id].energy) * foulTroubleMultiplier(defenseBox[shotDefender.id].fouls));
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
    let assistLine = '';
    let assistPlayerId = null;
    if (rng() < 0.6) {
      const passer = weightedPick(offense.filter(function (p) { return p.id !== shooter.id; }), energyAware(ballHandlingWeight, offenseBox, false), rng, PICK_POWER.passer);
      if (passer) {
        offenseBox[passer.id].assists += 1;
        assistLine = ' (assist: ' + passer.name + ')';
        assistPlayerId = passer.id;
      }
    }
    logPlay(log, shooter.name + ' makes ' + zoneLabel + assistLine);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: true, points: shotValue, assistPlayerId: assistPlayerId });
  } else {
    logPlay(log, shooter.name + ' misses ' + zoneLabel);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: false, points: 0, assistPlayerId: null });
    const offReboundChance = Math.max(0.1, Math.min(0.4, 0.25 * (offSyn.rebound / defSyn.rebound)));
    if (rng() < offReboundChance) {
      const rebounder = weightedPick(offense, energyAware(reboundCompositeWeight, offenseBox, false), rng, PICK_POWER.rebounder);
      offenseBox[rebounder.id].rebounds += 1;
      logPlay(log, rebounder.name + ' grabs the offensive rebound');
      pushEvent(eventCtx, { type: 'rebound', playerId: rebounder.id, offensive: true });
    } else {
      const rebounder = weightedPick(defense, energyAware(reboundCompositeWeight, defenseBox, false), rng, PICK_POWER.rebounder);
      defenseBox[rebounder.id].rebounds += 1;
      logPlay(log, rebounder.name + ' grabs the defensive rebound');
      // A defensive rebounder is on the OTHER side from the possession's
      // offense, and pushEvent stamps ev.team from the context — so this one
      // event goes through a side-flipped context. Derived from the real
      // context by copy-and-override rather than rebuilt field by field: a
      // hand-listed copy silently drops every field added to the context
      // later, which is exactly how these events ended up with no period or
      // clock while all the others had them.
      pushEvent(eventCtx && Object.assign({}, eventCtx, { team: eventCtx.team === 'home' ? 'away' : 'home' }),
        { type: 'rebound', playerId: rebounder.id, offensive: false });
      if (outcome) outcome.liveBallToDefense = true;
    }
  }

  // Shooting foul: a flat chance of 2 bonus free throws on top of the field
  // goal attempt above (and-1s and non-shooting fouls folded into the same
  // rough rate — this is a pace-of-play approximation, not a foul model).
  // Charged to the shot defender, feeding foulTroubleMultiplier above for
  // the rest of the game.
  // 0.125 calibrated by measured rate against the real NBA's ~22 free-throw
  // attempts per team-game; at 0.11 this engine produced 17.7.
  if (rng() < SHOOTING_FOUL_RATE) {
    defenseBox[shotDefender.id].fouls += 1;
    const ftAttempts = 2;
    // Was `freeThrow / 105`, which centred a 78% free-throw shooter at a rating
    // of 82 — fine when every rating lived in 48-99, but on a true 0-100 scale
    // the league-average shooter computed to 0.486 and the 0.55 floor did all
    // the work, flattening every player onto the same number. Now centred on 50
    // with a spread wide enough to separate a 60% shooter from a 90% one.
    const ftPct = Math.max(0.45, Math.min(0.95,
      FT_BASE + (shooter.attributes.freeThrow - 50) / FT_DIV));
    let made2 = 0;
    for (let i = 0; i < ftAttempts; i++) { if (rng() < ftPct) made2 += 1; }
    offenseBox[shooter.id].fta += ftAttempts;
    offenseBox[shooter.id].ftm += made2;
    offenseBox[shooter.id].points += made2;
    points += made2;
    logPlay(log, 'Foul on ' + shotDefender.name + ' — ' + shooter.name + ' makes ' + made2 + ' of ' + ftAttempts + ' free throws');
    pushEvent(eventCtx, { type: 'foul-ft', playerId: shooter.id, defenderId: shotDefender.id, made: made2, attempts: ftAttempts, points: made2 });
  }

  return points;
}

// Named distinctly from simEngineBoxScore.js's own simulateGame — see that
// file's comment on this same function name for why. Play-by-play is always
// generated (the string-building cost is negligible next to the possession
// math that already runs regardless) rather than gated behind a flag —
// storage is what's expensive, and that's pruned at save time the same way
// save.js already prunes box scores down to just the user's own games.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
    weightedPick: weightedPick,
    pickShotZone: pickShotZone,
    shotMakeProbability: shotMakeProbability,
    simulatePossession: simulatePossession,
    eligibleRoster: eligibleRoster,
    initBoxLine: initBoxLine,
    energyMultiplier: energyMultiplier
  };
}
