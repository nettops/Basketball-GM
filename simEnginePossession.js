// Possession-by-possession engine — the "possession" SIM_ENGINES slot
// (see simEngine.js). Unlike simEngineBoxScore.js, which derives a final
// score from a team-rating diff and then distributes stats to match it,
// this engine simulates each individual possession (shot creator vs.
// defender matchup, make/miss, rebound, assist, turnover, foul) and the
// final score is just the sum of what actually happened. Slower and noisier
// than the box-score engine by design — that's the point of offering it as
// an alternative, not a bug.
var _POSS_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js'), box: require('./simEngineBoxScore.js'), composite: require('./compositeRatings.js'), check: require('./skillCheck.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      traits: { getTraitBonus: getTraitBonus, shotQualityBonus: shotQualityBonus,
                defenseQualityBonus: defenseQualityBonus, foulProneness: foulProneness },
      check: { skillCheck: skillCheck, skillCheckProbability: skillCheckProbability },
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

function weightedPick(players, weightFn, rng, power, ceiling) {
  const p = (power === undefined) ? 1 : power;
  let weights = players.map(function (pl) { return Math.pow(Math.max(0, weightFn(pl)), p); });
  const raw = weights.reduce(function (a, b) { return a + b; }, 0);
  if (raw <= 0) return players[Math.floor(rng() * players.length)];
  const floor = PICK_FLOOR * raw;
  weights = weights.map(function (w) { return Math.max(w, floor); });

  // The counterpart to PICK_FLOOR. Without it, a player far better than his
  // four team-mates takes an unbounded share of the shots — which produced
  // 45-points-per-game seasons once the league started generating players who
  // outclassed their rosters that badly. The best real usage rates top out
  // around 35-40% of a team's attempts; nobody takes half.
  //
  // Applied on the normalised shares, capping and redistributing the excess
  // proportionally, so the capped player lands at exactly `ceiling` rather than
  // approximately. Draws no extra rng values, so the seeded stream is unmoved.
  if (ceiling !== undefined && ceiling < 1) {
    let sum0 = weights.reduce(function (a, b) { return a + b; }, 0);
    let probs = weights.map(function (w) { return w / sum0; });
    for (let pass = 0; pass < 4; pass++) {
      let excess = 0, underSum = 0;
      probs.forEach(function (q) {
        if (q > ceiling) excess += q - ceiling; else underSum += q;
      });
      if (excess < 1e-12 || underSum <= 0) break;
      probs = probs.map(function (q) {
        return q > ceiling ? ceiling : q + excess * (q / underSum);
      });
    }
    weights = probs;
  }

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
// Foul Prone routes HERE rather than into shot quality — see traits.js's
// defenseQualityBonus for why. Divides by 400 like the other defensive badge
// paths, so a legendary Foul Prone adds 8/400 = +2pp on a 14% base.
const FOUL_TRAIT_DIV = 400;
const FT_BASE = 0.78, FT_DIV = 500;

// Turns trait points into shot probability. A legendary scoring trait is worth
// 8 points, so at 300 that is +2.7 percentage points on the zone it applies to
// — meaningful against a ~13-point spread of pure shooting talent, without the
// trait outweighing the ratings underneath it. Calibrated by measured rate; the
// sweep is in this task's commit message.
const SHOT_TRAIT_DIV = 300;

// One number per event, calibrated by the measured spread each produces — the
// sweep is in this task's commit message. ZenGM's equivalents: usage 1.25,
// turnovers 2, defensive rebounds 3, steals 4, offensive rebounds 5, assists 10,
// blocks 10.
//
// Re-anchored for the 2K27 face-value roster: raw 2K attributes are far more
// compressed than the old mean-50 league (scoringWeight p95:p05 fell from
// 2.54x to 1.38x), so the same exponent produces far less concentration.
// shooter calibrated against the validate-possession per-36 FGA measurement
// (target 2.9x, the real-NBA usage spread): 1.4 measured 1.81x, 4.0 measured
// 5.42x, and 2.5 — the log-space interpolation between them — landed in band.
const PICK_POWER = {
  handler: 3,
  shooter: 2.5,
  passer: 6,
  onBallDefender: 2,
  shotDefender: 2,
  rebounder: 3
};

// The most of a possession's shot-weight one player may hold, among the five on
// the floor. Only the shooter is capped — it is the only pick that produced an
// absurd result without one (six seasons with a 40+ point scorer in a 50-season
// run, topping out at 45.5, where the 2026 league never exceeds ~35).
//
// NOTE this is a per-POSSESSION share among five players, not a season-long
// share of team attempts. Those are very different numbers: the 2026 league's
// busiest scorer takes 28% of his team's shots across a season but sits far
// above a fifth of the weight in the possessions he is on the floor for. A cap
// near 0.30 throttles ordinary stars badly; 0.40 does not touch them.
//
// 0.50 chosen against TWO targets that pull in opposite directions. Season
// leaders over a 35-season run, and single-game highs over one full season of
// the 2026 league, same seeds throughout:
//
//   setting   worst season   avg leader   40pt seasons | 40+/50+/60+ games  best
//   no cap        45.5          35.1           6       |  207 / 22 / 4      68
//   0.70          45.5          35.1           6       |  207 / 22 / 4      68
//   0.60          45.5          35.1           6       |  207 / 22 / 4      68
//   0.50          38.2          33.9           0       |  207 / 22 / 4      68
//   0.45          38.6          34.4           0       |  218 / 25 / 3      68
//   0.40          36.7          33.0           0       |  177 / 19 / 0      57
//
// Three things that table is here to record:
//
// Anything at 0.60 or looser is a NO-OP — identical to no cap in every column,
// down to the same three worst seasons. Do not read those as "gentler
// settings"; they never trigger.
//
// 0.50 is the loosest value that does anything, and it is dormant in normal
// play: its single-game profile is byte-identical to having no cap at all. It
// only engages when a player outclasses his own team-mates by more than anyone
// in the 2026 league does, which is exactly the case that went wrong. 0.45
// works too but is slightly intrusive, shifting even the 2026 counts.
//
// Going tighter breaks the thing the cap is supposed to protect. At 0.40 the
// best night in a season falls from 68 points to 57 and sixty-point games stop
// entirely. A 60-point game is one hot night; a 45-point AVERAGE is eighty-two
// of them. The cap must separate those, not flatten both.
//
// RE-SWEPT for the 2K27 face-value roster (user: a ~50 ppg leader is too
// much). The whole table above sat on the old scale, where the alpha's
// per-possession share ran well past 0.50; on the compressed 2K scale the
// best player's share is only ~0.32, so everything from 0.36 up is now the
// no-op region — measured, one full season per setting, same seed:
//
//   cap     teamPPG   leader        top5 mean
//   0.50     135.5    49.2 (VW)       40.3
//   0.36     135.7    45.7 (VW)       39.9
//   0.33     135.4    44.3 (VW)       39.0
//   0.30     135.5    39.5 (VW)       36.6   <- shipped
//   0.28     136.0    37.8 (KAT)      35.9
//   0.26     135.8    36.4 (KAT)      33.5
//
// 0.30 keeps the best player on top of the table (0.28 and below shuffle
// him to third) and lands the leader at ~39.5 — exactly proportional to a
// real ~33 ppg scoring champion once you scale by this league's 135-point
// pace — while team scoring does not move. Takeover dials still raise the
// holder's ceiling past this for the duration (shotCeiling in ultimates.js),
// so explosion nights survive; the cap trims the eighty-two-game AVERAGE.
const PICK_CEILING = { shooter: 0.30 };

function ballHandlingWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'ballHandling') + _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'assist'));
}

// On-ball assignment. Steal badges buy assignments here as well as raising the
// turnover chance in turnoverSpec — a pickpocket both guards the ball more and
// is better at it, which is what the badge name promises.
function perimDefenseWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'defensePerimeter') +
    _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'steal'));
}

// Shot-defender assignment, zone-aware. Extracted from an anonymous inline
// lambda at the pick site: leaving it anonymous is exactly what made this path
// easy to miss when auditing which weights read traits, and it was one of the
// places the badges had to reach.
//
// `routed` is the zone-matched part — a perimeter stopper draws more perimeter
// assignments. `unrouted` is what defenseQualityBonus deliberately ignores:
// Charge Taker (basketballIQ) and Two-Way Star (no affinity) contribute nothing
// to shot quality, so allocation is the ONLY place they can earn their keep. If
// they did not appear here they would be decorative badges.
function shotDefenseWeight(player, zone) {
  const composite = zone === 'inside' ? 'defenseInterior' : 'defensePerimeter';
  const routed = _POSS_DATA.traits.defenseQualityBonus(player, zone);
  const zonedTotal = _POSS_DATA.traits.defenseQualityBonus(player, 'three') +
    _POSS_DATA.traits.defenseQualityBonus(player, 'inside');
  const unrouted = Math.max(0,
    _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'defense') - zonedTotal);
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, composite) + routed + unrouted);
}

function reboundCompositeWeight(player) {
  return Math.max(1, _POSS_DATA.composite.computeComposite(player, 'rebounding') + _POSS_DATA.traits.getTraitBonus(player, 'boxscore', 'rebound'));
}

function initBoxLine() {
  // oppFga/oppFgm are what a player allowed AS THE SHOT DEFENDER — the raw
  // material for DFG%. Without them a defensive badge is invisible: steals and
  // blocks land in the box score, "lowered the shooter's percentage" does not.
  //
  // charge/takeoverLeft/takeoversUsed/takeoverPoints/takeoverPointsAt are the
  // ultimate meter (ultimates.js), per game and discarded with it. They live
  // here rather than on the player because a meter that survived the final
  // buzzer would let a star bank a takeover across a road trip.
  // insideFga/insideFgm/midFga/midFgm are the shot chart. pickShotZone already
  // classifies every attempt; before these existed the answer was used four
  // times inside one possession and then dropped, so the only zone that ever
  // reached a box score was the three — via tpa/tpm, which ARE the third pair
  // and are why there is no threeFga here.
  //
  // That leaves an invariant worth more than the two integers a derived
  // mid-range would have saved, and validate-shotZones.js asserts it:
  //   insideFga + midFga + tpa === fga
  // oreb/dreb split the SAME boards `rebounds` already counts — it stays the
  // total, so every consumer of it (career milestones, feats, triple-doubles,
  // the awards race) is untouched. Same shape as the shot zones above:
  //   oreb + dreb === rebounds
  // and scripts/validate-rebounds.js asserts it for both engines.
  return { minutes: 0, points: 0, rebounds: 0, oreb: 0, dreb: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, energy: 1, fouls: 0, plusMinus: 0, oppFga: 0, oppFgm: 0,
    insideFga: 0, insideFgm: 0, midFga: 0, midFgm: 0,
    charge: 0, takeoverLeft: 0, takeoversUsed: 0, takeoverPoints: 0, takeoverPointsAt: 0 };
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

// How hard the coaching screen's Three-Point Rate dial pulls, per unit of dial
// (the UI offers -1, 0, +1 — Low, Balanced, High).
//
// A MULTIPLIER on the three weight, not an addition to the share, because this
// engine picks a zone from weights and normalisation then pays for the extra
// threes out of the other two zones in proportion. That is the same shape the
// takeover bias and the transition bias already use.
//
// 0.33 was solved for, not picked: the league takes 27.6% of its shots from
// three, and simEngineBoxScore's dial is worth 0.06 of SHARE per unit, so
// matching it means landing near 33.6% at +1. A weight multiplier m moves a
// share s to m*s/(m*s + 1 - s); solving 0.336 = 0.276m/(0.276m + 0.724) gives
// m = 1.33. Measured result is in the plan.
const THREE_RATE_DIAL_STRENGTH = 0.33;

function pickShotZone(shooter, rng, inTransition, takeoverBias, threeRateDial) {
  const t = shooter.hiddenTendencies || {};
  let three = t.threeTendency !== undefined ? Math.max(1, t.threeTendency) : 33;
  let mid = t.midTendency !== undefined ? Math.max(1, t.midTendency) : 33;
  let inside = t.insideTendency !== undefined ? Math.max(1, t.insideTendency) : 34;
  // A neutral dial must be an EXACT no-op — every team defaults to 0 (and to no
  // strategy object at all under Node), so anything else here would move both
  // golden masters for a league where nobody has touched the control.
  if (threeRateDial) three *= 1 + THREE_RATE_DIAL_STRENGTH * threeRateDial;
  // A takeover pulls the holder toward the spot his ultimate improves — Heat
  // Check starts hunting threes. Scaled like the transition bias rather than
  // replacing the mix, so a big man taking over still is not launching from
  // thirty feet. Absent for every shot by anyone not mid-takeover.
  if (takeoverBias) {
    if (takeoverBias.three) three *= takeoverBias.three;
    if (takeoverBias.mid) mid *= takeoverBias.mid;
    if (takeoverBias.inside) inside *= takeoverBias.inside;
  }
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

// Spec builders for the three contests this engine resolves. Each takes plain
// numbers rather than players so it can be swept against the original formula
// in scripts/validate-skillCheck.js without constructing a league.
//
// The divisors below are deliberately NOT normalised onto a single scale. They
// were calibrated independently and normalising them would change outcomes,
// move both goldens and need a full recalibration sweep — a balance change has
// no business riding along inside a refactor. That is its own later pass.

const TURNOVER_BASE = 0.11, TURNOVER_DIV = 400;
const TURNOVER_MIN = 0.04, TURNOVER_MAX = 0.22;
const TURNOVER_SYNERGY_WEIGHT = 0.3;
// Steal badges divide by the same 400 the steal RATING uses, so a legendary
// Pickpocket is worth exactly +8 rating points of steal. The badge is a
// modifier on the skill, deliberately not a bigger lever than the skill itself.
const STEAL_TRAIT_DIV = TURNOVER_DIV;

// ATTACK is the DEFENDER: a turnover is the defence's check to pass. Both sides
// divide by the same 400 because the original was a raw difference over one
// divisor — (d - h)/400 is algebraically (d-50)/400 - (h-50)/400.
function turnoverSpec(defenderSteal, handlerBallHandling, defSynergyDefense, offSynergyOffense, stealTraitBonus) {
  return {
    kind: 'turnover',
    base: TURNOVER_BASE,
    attack: { label: 'steal', value: defenderSteal, scale: TURNOVER_DIV, energy: 1 },
    defend: { label: 'ballHandling', value: handlerBallHandling, scale: TURNOVER_DIV, energy: 1 },
    modifiers: [
      { label: 'team synergy', value: (defSynergyDefense - offSynergyOffense) * TURNOVER_SYNERGY_WEIGHT },
      { label: 'steal badges', value: (stealTraitBonus || 0) / STEAL_TRAIT_DIV }
    ],
    min: TURNOVER_MIN, max: TURNOVER_MAX
  };
}

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
//
// Re-based for the 2K27 face-value roster: the league block mean is 56.1, not
// 50, so the old 0.020 base effectively became 0.0345 and blocks hit 8.03 per
// game. 0.0055 cancels the mean shift exactly (0.020 - 6.1/420) and measured
// back inside the impact-moment band.
const BLOCK_BASE = 0.0055, BLOCK_DIV = 420, BLOCK_MIN = 0.004, BLOCK_MAX = 0.20;
const BLOCK_THREE_CHANCE = 0.008;

// Block badges divide by the same BLOCK_DIV the block rating uses, so a
// legendary Rim Protector is worth +8 rating points of block.
const BLOCK_TRAIT_DIV = BLOCK_DIV;

// A three is not a contest — nobody meaningfully blocks a jump shot from 24
// feet — so that branch is a flat constant with no attacking side. It still
// goes through skillCheck so it draws its one rng value in the same order.
//
// The badge applies to BOTH branches. A rim protector being literally unable to
// block a three would be a worse model than the flat rate it replaces.
function blockSpec(defenderBlock, zone, blockTraitBonus) {
  const badge = { label: 'block badges', value: (blockTraitBonus || 0) / BLOCK_TRAIT_DIV };
  if (zone === 'three') {
    return { kind: 'block', base: BLOCK_THREE_CHANCE, attack: null, defend: null, modifiers: [badge], min: 0, max: 1 };
  }
  return {
    kind: 'block',
    base: BLOCK_BASE,
    attack: { label: 'block', value: defenderBlock, scale: BLOCK_DIV, energy: 1 },
    defend: null,
    modifiers: [badge],
    min: BLOCK_MIN, max: BLOCK_MAX
  };
}

// Shot quality: base + shooter/SKILL_DIV - defender/DEF_DIV, clamped.
//
// SKILL_DIV and DEF_DIV used to be 250 and 350, meaning a point of shooting was
// worth 1.4x a point of defence. That made league scoring depend on the ABSOLUTE
// level of the league rather than on shooter-versus-defender, so as players got
// better the whole league shot better and nothing pushed back. Measured by
// moving every attribute on every player together, which a difference-based
// model should ignore entirely:
//
//   shift   medOVR    3P%
//     -10      68    34.8
//       0      75    37.2
//      +5      78    37.6
//
// Equal divisors make that line flat: raise everyone and offence and defence
// cancel exactly, which is what "defence keeps up with offence" means
// mechanically. The bases are then re-solved so the 2026 league still produces
// the same FG%, 3P% and points it always did — see scripts/sweep-shot-balance.js.
// Bases solved by scripts/sweep-shot-balance.js against the locked 2026 rates,
// so the starting league is unchanged by this: FG% 47.45 -> 47.54, 3P% 37.00 ->
// 37.07, points 104.2 -> 104.7, all inside the noise of a 500-game measurement.
//
// The scale test improved but did NOT go fully flat — the slope across a 15-point
// uniform shift roughly halved (2.4pp of 3P% down to 1.5pp). The remainder is the
// 0.18/0.72 clamps plus the other rating-driven paths (blocks, turnovers, fouls,
// rebounds) that are not part of this balance. Worth knowing before anyone reads
// this as a complete fix.
// Equalised at 292, not at 250. Both choices make defence count the same as
// offence; the difference is how much a rating swing moves a single shot.
//
// Old sensitivity to a one-point swing in the shooter-versus-defender gap was
// 1/250 + 1/350 = 0.00686. Equalising at 250 gives 2/250 = 0.00800 — 17% more,
// which widened the spread of game outcomes enough to produce 57- and 59-point
// games and trip validate-possession's floor. Equalising at 292 gives
// 2/292 = 0.00685, matching what the engine always had. So defence gains parity
// without the league getting swingier.
//
// Bases re-solved against the locked 2026 rates by scripts/sweep-shot-balance.js.
var SHOT_TUNING = {
  // Bases trimmed -0.019 for the 2K face-value import (attributes now read
  // exactly as 2kratings.com shows them, so the whole offense/defense scale
  // moved). Measured over 200 games, seed 555, against the quantile league's
  // 135.21 on identical seeds: raw sheets ran 140.54 (FT re-centering fixed
  // +1.2 of it, see FT_BASE), and -0.019 lands 134.88 with FG% 47.3 / 3P%
  // 36.7 / FT% 78.4.
  //
  // Trimmed a further -0.0064 when PICK_POWER.shooter was re-anchored for the
  // face-value scale: concentrating volume back on stars put better shooters
  // on more shots and league scoring rose to ~136.8 against the 134.86
  // baseline. Sized from the measured sensitivity above (-0.019 base moved
  // scoring -5.66, so ~298 points per unit of base).
  //
  // And -0.0065 more after the rawOverall refit against the capped engine:
  // the new fit reordered rotations toward stronger lineups and scoring rose
  // to 136.79 on the ultimates validator's seeds. Same sensitivity.
  // Re-solved when the design target became three bands at once — 99-115
  // points, 47.5-49% FG, 36-38% from three. Pace (POSSESSION_BASE_SECONDS 12.5
  // -> 15.4) carried the points; it cannot touch percentages, so the bases
  // carry those. At the old values the slower clock left FG% at 47.0 and 3P% at
  // 36.1 — points right, both percentages sitting on or under their floor.
  //
  // Solved by simulation, not algebra, the same way sweep-shot-balance.js does
  // it: aim at the MIDDLE of each band so seed noise cannot push either out.
  // The solver oscillates inside its own noise from the second iteration on
  // (+/-0.3pp of 3P% at 400 games), so these are the centre of that cluster
  // rather than one lucky iterate.
  base: { three: 0.3235, mid: 0.4175, inside: 0.5575 },
  // skillDiv was 292 and defDiv 292. Both moved for reasons that are NOT the
  // same, which is why they are no longer equal:
  //
  // skillDiv 292 -> 400 on PLAYER realism, independent of any balance concern.
  // Measured 3P% of the top-decile three-point shooters against the bottom
  // decile, both at 150+ attempts: 292 gave a 10.4pp spread, 400 gives 9.3pp,
  // 500 gives 7.5pp. The real league runs about 9pp (roughly 40.5% against
  // 31.5%). 292 was making shooters MORE differentiated than reality, not less.
  //
  // defDiv 292 -> 1000 on TEAM realism. The shooter's skill and the defender's
  // skill shared one divisor, and team strength moves both at once: a good team
  // shoots better AND defends better, so the two stack into the margin. Raising
  // only the defensive side cuts that stacking while leaving shooter-vs-shooter
  // differentiation completely untouched, because two players on the same team
  // are separated by skillDiv alone.
  skillDiv: 400,
  defDiv: 1000,
  // Team synergy is a MULTIPLIER (synergyRamp returns 1 +/- 0.06, plus a
  // chemistry term) that was being differenced against the opponent's and added
  // RAW to a probability — the only modifier in shotSpec without a divisor.
  // That gave it up to ~12-15 percentage points of swing on every shot: roughly
  // three times the entire skill term and five times a legendary badge, from a
  // term nobody had calibrated because it did not look like a rating.
  //
  // What it did to the league, measured over 3 seasons x 3 seeds:
  //
  //   synDiv  bestW  worstW  60+  |margin|  close%   FG%    3P%    pts
  //     1      80.7    8.0   6.3    26.5     12.8   47.6   37.1  104.6  <- was
  //     4      74.0   11.0   5.3    19.3     18.0   47.1   36.3  103.3
  //     6      71.7    8.3   3.3    18.6     18.6   46.8   36.2  102.5
  //     8      70.0   11.3   3.7    18.7     17.9   46.9   36.1  102.5  <- now
  //    10      70.7   11.3   3.7    18.6     17.5   46.9   36.2  102.7
  //    14      72.7   12.3   3.7    18.4     18.4   46.7   36.0  102.2
  //   (real NBA: best ~64, worst ~18, one 60-win team, |margin| ~11, close ~33%)
  //
  // A one-season read said 81 wins for the best team; three seeds say 80.7, so
  // the headline number was not a fluke of one schedule.
  //
  // 8 sits in the middle of the plateau — 6 through 14 are within noise of each
  // other — and is chosen on a principle rather than a number: at 8 the synergy
  // swing is +/-1.5pp, proportionate to the 2.67pp a legendary badge is worth.
  // Above ~14 roster construction stops mattering at all, which is not balance,
  // it is deleting a feature.
  //
  // League rates move slightly and deliberately are NOT re-solved: 3P% 37.1 ->
  // 36.1 sits inside the 35-38% band the real league runs and the one the
  // project owner accepted. Re-solving the bases to claw back 1pp would mean
  // re-tuning four constants to hide a change that is within tolerance.
  //
  // Retuned to 14 alongside the divisor split above; 8 through 20 are within
  // noise of each other on every column, and 14 is the middle of that plateau.
  //
  // WHY THE MARGIN STOPS HERE, and it is not for want of trying. Mean |margin|
  // is 16.4 against a real ~11, and the rest is NOT reachable by tuning. Pushed
  // to absurdity — synergyDiv 200, skillDiv 600, defDiv 4000, which deletes
  // defence and roster construction outright and flattens the elite-vs-poor
  // shooter spread to 5.4pp — |margin| still only reaches 15.8. It asymptotes,
  // because what is left is the shooting itself:
  //
  //   per-team scoring variance, this engine   128
  //   what independent shooting predicts       126   (2*FGM + TPM + FTM,
  //                                                   counting the overlap
  //                                                   between made threes and
  //                                                   made field goals)
  //   real NBA                                  91
  //
  // The engine is statistically CORRECT — its randomness is exactly what
  // coin-flip shooting implies. Real basketball sits BELOW that floor, meaning
  // real games are LESS random than independent shooting: teams that fall
  // behind change shot selection, teams ahead slow the game down, blowouts
  // reach garbage time. This engine has no game-state feedback at all, so it
  // cannot go below the arithmetic.
  //
  // Closing the rest needs that feedback as a FEATURE, not a constant. Do not
  // try to reach it by turning these divisors up: the ceiling is 15.8 and the
  // price is every system that makes one roster feel different from another.
  synergyDiv: 14
};
const SHOT_MIN = 0.18, SHOT_MAX = 0.72;

// Symmetric with SHOT_TRAIT_DIV: a legendary defensive badge takes off 8/300 =
// 2.67pp on its zone, which is what a legendary offensive one puts on. Chosen
// by sweep against the locked league rates, NOT picked — grid over
// DEF_TRAIT_DIV x CHEM_DIV, worst normalised miss against the four bounds:
//
//   DEF   CHEM    FG%     3P%   3PAsh    pts    miss
//   300    600   46.57   36.35   30.4   102.4   0.62  PASS  <- chosen
//   450    600   46.68   36.39   30.2   102.3   0.64  PASS
//   450    900   46.49   36.22   30.6   102.3   0.96  PASS
//   900    900   46.92   36.71   30.4   102.9   0.43  PASS
//   (eight other cells missed at least one bound)
//
// 900/900 fits marginally better, and was NOT chosen. The gap (0.43 vs 0.62) is
// well inside the noise of a single-seed 300-game measurement, and at 900 a
// legendary defensive badge is worth 0.89pp — a third of its offensive
// counterpart, which is not a badge, it is a rounding error. Fitting the
// league slightly better by making the feature meaningless is a bad trade.
const DEF_TRAIT_DIV = SHOT_TRAIT_DIV;

// Named rather than inlined at the roll, so it can be asserted on directly.
// The tripwire cannot cover this path: boxscore/defense's representative trait
// is a POSITIVE one (Lockdown Defender), which reaches the sim through
// shotSpec — so zeroing the foul term would leave the family looking perfectly
// live while Foul Prone quietly did nothing.
function shootingFoulRate(defender) {
  return SHOOTING_FOUL_RATE + _POSS_DATA.traits.foulProneness(defender) / FOUL_TRAIT_DIV;
}

// URGENCY — the game reacting to its own scoreboard.
//
// Before this, every possession in a 40-point blowout was played exactly like a
// tie game. That is why mean |margin| bottomed out at 15.8 however the shot
// divisors were tuned: the engine's randomness is exactly what independent
// shooting implies (per-team scoring variance 128 against a predicted 126), and
// real basketball sits BELOW that floor at 91 because real games self-correct.
// A trailing team tightens up; a leading team eases off; benches empty.
//
// Modelled as a small, ZERO-SUM shot adjustment: the trailing side gets
// +perPoint per point of deficit, the leading side the same amount off. Because
// it is symmetric it cannot move league-average shooting — one team's gain is
// the other's loss in every single possession.
//
// fromPeriod exists because rubber-banding a first quarter would be nonsense:
// nobody plays with urgency four minutes in. It engages in the second half,
// which is when real teams start reacting to the scoreboard.
//
// perPoint/cap are CALIBRATED by scripts/probe-comebacks.js against four
// numbers, one of which is a guard rather than a target: 20-point fourth
// quarter leads must keep holding up ~95% of the time. A mechanic that hands
// those back is not drama, it is noise.
// Swept over 600 games, same seed throughout (scripts/probe-comebacks.js):
//
//   perPt/cap      |margin|  close%  blow%  hold20  comeback15   FG%    3P%
//   0      (off)     16.12    22.2    23.8    98.7      5.9      47.9   36.9
//   0.0010/0.020     15.43    20.3    21.2   100.0      7.2      48.0   36.7
//   0.0018/0.030     14.21    24.5    16.7    98.6      8.1      47.9   36.9
//   0.0025/0.040     14.18    26.0    17.3    99.2      7.0      48.0   36.8
//   0.0035/0.055     11.41    31.5     9.2   100.0      9.9      48.1   37.0  <- shipped
//   0.0050/0.070     10.05    36.5     7.0    98.6     14.8      48.0   36.7
//   0.0070/0.090      9.34    38.3     5.3   100.0     14.0      47.8   36.6
//   real NBA           ~11     ~33     ~8      ~95      5-8       ~47    ~36
//
// 0.0035/0.055 lands on real basketball for all four at once. Looser than that
// and comebacks from 15 down roughly double the real rate, which stops being
// drama and starts being noise — the guard the whole probe exists to protect.
//
// Note FG%, 3P% and points are FLAT down the entire column. That is the
// zero-sum construction doing its job: one team's urgency bonus is the other's
// penalty on every possession, so nothing here can move league scoring, and the
// shot bases did not need re-solving.
var URGENCY_TUNING = {
  perPoint: 0.0035,
  cap: 0.055,
  fromPeriod: 3
};

// scoreDiff is the SHOOTING team's lead (negative when trailing).
function urgencyBonus(scoreDiff, period) {
  if (typeof scoreDiff !== 'number' || !period || period < URGENCY_TUNING.fromPeriod) return 0;
  // `+ 0` normalises negative zero. -scoreDiff * perPoint yields -0 in a tie
  // game, and -0 serialises into the golden fixtures as `-0`, which reads as a
  // real diff on every future regeneration.
  const raw = -scoreDiff * URGENCY_TUNING.perPoint + 0;
  return Math.max(-URGENCY_TUNING.cap, Math.min(URGENCY_TUNING.cap, raw));
}

// FINISHING THROUGH A BODY.
//
// Contact has been drawn since the animation pass and has never meant anything:
// the sprite compressed and kept climbing, and the sim had already decided the
// shot went in for reasons that had nothing to do with a man being in the way.
// Worse, the two disagreed about WHEN — the animation inferred contact from
// positions the choreographer invented after the fact, so a finish drawn
// through a defender was resolved as an ordinary one and vice versa.
//
// So the sim decides it, and the drawing reads what the sim decided.
//
// HOW OFTEN. Interior defence puts a body on you; the sim already has a rating
// for exactly that. Nothing else is invented.
const CONTACT_TUNING = {
  // Solved backwards from the animation's own rate. A defender at the league's
  // median interior D should produce contact on about one inside shot in six,
  // which is what the choreographer was already drawing before this existed.
  base: 0.06,
  perDefPoint: 0.0022,
  cap: 0.32,
  // WHAT IT COSTS. Eight points of make probability is a real penalty — the
  // difference between a clean look and one through a chest — but it is scaled
  // by how good a finisher he is, because "finishes through contact" is a skill
  // and a sim in which it is not is a sim where the rating is decorative. An
  // elite interior scorer keeps most of it; a guard who should not be there
  // loses nearly all of it.
  penalty: 0.08,
  finisherRelief: 0.6          // of the penalty, at a 99 inside composite
};

function contactChance(defComposite) {
  const d = typeof defComposite === 'number' ? defComposite : 50;
  return Math.max(0, Math.min(CONTACT_TUNING.cap,
    CONTACT_TUNING.base + d * CONTACT_TUNING.perDefPoint));
}

function contactPenalty(shootComposite) {
  const s = Math.max(0, Math.min(99, typeof shootComposite === 'number' ? shootComposite : 50));
  return -CONTACT_TUNING.penalty * (1 - CONTACT_TUNING.finisherRelief * (s / 99));
}

function shotSpec(zone, shootComposite, defComposite, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult, traitBonus, defTraitBonus, scoreDiff, period, contact) {
  return {
    kind: 'shot',
    base: SHOT_TUNING.base[zone],
    attack: {
      label: zone === 'three' ? 'shootingThree' : (zone === 'mid' ? 'shootingMid' : 'shootingInside'),
      value: shootComposite, scale: SHOT_TUNING.skillDiv,
      energy: shooterEnergyMult === undefined ? 1 : shooterEnergyMult
    },
    defend: {
      label: zone === 'inside' ? 'defenseInterior' : 'defensePerimeter',
      value: defComposite, scale: SHOT_TUNING.defDiv,
      energy: defenderEnergyMult === undefined ? 1 : defenderEnergyMult
    },
    modifiers: [
      { label: 'team synergy', value: ((offenseSynergy || 1) - (defenseSynergy || 1)) / SHOT_TUNING.synergyDiv },
      { label: 'badges', value: traitBonus / SHOT_TRAIT_DIV },
      // NEGATIVE: this is the DEFENDER's contribution, so it comes off the
      // shooter's chance. Routed by zone in traits.js's defenseQualityBonus, so
      // a perimeter stopper does nothing to a shot at the rim.
      { label: 'defensive badges', value: -(defTraitBonus || 0) / DEF_TRAIT_DIV },
      { label: 'urgency', value: urgencyBonus(scoreDiff, period) },
      // Named like every other modifier so the UI can show "contact -5.6%"
      // rather than folding it invisibly into the base, and so the check the
      // event carries explains itself.
      { label: 'contact', value: contact ? contactPenalty(shootComposite) : 0 }
    ],
    min: SHOT_MIN, max: SHOT_MAX
  };
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
// Resolves composites and the badge bonus, then hands PLAIN NUMBERS to shotSpec.
// The split matters: shotSpec can be swept against the original formula in
// scripts/validate-skillCheck.js without constructing a league, because it never
// touches a player object.
//
// Scoring traits reach the SHOT, not just the shot count. Until this, a
// legendary Sharpshooter did not shoot threes any better — traits only fed
// scoringWeight, so the trait bought volume and the name promised accuracy.
// Routed by zone in traits.js (shotQualityBonus), so this only fires for the
// shot the trait is actually about, and it arrives as a NAMED modifier so the
// UI can show "badges +1.0%" rather than folding it invisibly into one float.
function shotMakeSpecFor(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult, scoreDiff, period, contact) {
  const shootKey = zone === 'three' ? 'shootingThree' : (zone === 'mid' ? 'shootingMid' : 'shootingInside');
  const defKey = zone === 'inside' ? 'defenseInterior' : 'defensePerimeter';
  return shotSpec(zone,
    _POSS_DATA.composite.computeComposite(shooter, shootKey),
    _POSS_DATA.composite.computeComposite(defender, defKey),
    offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult,
    _POSS_DATA.traits.shotQualityBonus(shooter, zone),
    _POSS_DATA.traits.defenseQualityBonus(defender, zone),
    scoreDiff, period, contact);
}

// Sibling wrappers to shotMakeSpecFor: they resolve the badge lookups and hand
// plain numbers to the spec builders. Named and exported so the WIRING can be
// asserted, not just the arithmetic.
//
// This exists because two mutants survived without it. Dropping the badge
// lookup at these call sites left validate-traitsAreLive green — defense and
// steal are ALSO wired through the allocation path, so the family still moved
// and the tripwire, which only asks "is this family read at all", could not
// see that the rate path had gone. A spec builder can be perfect while the
// call site feeding it passes zero.
function turnoverSpecFor(onBallDefender, handler, defSynergyDefense, offSynergyOffense) {
  return turnoverSpec(onBallDefender.attributes.steal, handler.attributes.ballHandling,
    defSynergyDefense, offSynergyOffense,
    _POSS_DATA.traits.getTraitBonus(onBallDefender, 'boxscore', 'steal'));
}

function blockSpecFor(shotDefender, zone) {
  return blockSpec(shotDefender.attributes.block, zone,
    _POSS_DATA.traits.getTraitBonus(shotDefender, 'boxscore', 'block'));
}

// A takeover's contribution to a contest, as NAMED modifiers appended to the
// spec the existing builders return. skillCheck sums modifiers into the
// probability and hands them back on the result, and the expandable
// play-by-play already renders that list — so a takeover explains itself on
// screen ("Takeover +13%") through machinery that already exists, rather than
// being an invisible thumb on the scale.
//
// Appended at the call site rather than threaded through shotSpec/turnoverSpec
// so those keep their signatures and scripts/validate-skillCheck.js can go on
// sweeping them against the original formulas.
const ZONE_MAKE_DIAL = { three: 'makeThree', mid: 'makeMid', inside: 'makeInside' };

function withModifiers(spec, mods) {
  if (mods.length) spec.modifiers = spec.modifiers.concat(mods);
  return spec;
}

function takeoverShotMods(shooterId, zone, tk, soloId, teamOn, offDial, defDial) {
  const mods = [];
  if (soloId && shooterId === soloId) {
    const v = offDial[ZONE_MAKE_DIAL[zone]];
    if (v) mods.push({ label: 'takeover', value: v });
  }
  if (teamOn && offDial.teamMake) mods.push({ label: 'team takeover', value: offDial.teamMake });
  // The Wall: the DEFENDING side's holder suppresses the whole opposing five,
  // so this applies to every shot, not just the one he contests.
  if (defDial.oppMake) mods.push({ label: 'opponent takeover', value: defDial.oppMake });
  return mods;
}

function takeoverTurnoverMods(handlerId, soloId, teamOn, offDial, defDial) {
  const mods = [];
  if (soloId && handlerId === soloId && offDial.turnover) {
    mods.push({ label: 'takeover', value: offDial.turnover });
  }
  if (teamOn && offDial.teamTurnover) mods.push({ label: 'team takeover', value: offDial.teamTurnover });
  // Clamps: he is the man guarding the ball for the duration.
  if (defDial.oppTurnover) mods.push({ label: 'clamps', value: defDial.oppTurnover });
  return mods;
}

function takeoverBlockMods(defenderId, tkDef, defDial) {
  if (!tkDef || !defDial.block) return [];
  // A solo shot-blocking takeover only helps when HE is contesting; a team one
  // (The Wall) lifts whoever is.
  if (tkDef.kind === 'team' || defenderId === tkDef.playerId) {
    return [{ label: 'takeover', value: defDial.block }];
  }
  return [];
}

// Energy drains at a scaled rate. Written as "drain normally, then give back a
// fraction of what was taken" so it stays exactly consistent with drainEnergy's
// own curve rather than duplicating it — the one place a second implementation
// would silently diverge.
function drainEnergyScaled(box, player, mult) {
  if (mult === undefined || mult === 1) return drainEnergy(box, player);
  const before = box.energy;
  drainEnergy(box, player);
  box.energy = before - (before - box.energy) * mult;
}

// Kept as a named export because scripts/validate-possession.js and the pixel
// choreographer's classifier both read a bare probability without rolling.
function shotMakeProbability(shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult) {
  return _POSS_DATA.check.skillCheckProbability(shotMakeSpecFor(
    shooter, defender, zone, offenseSynergy, defenseSynergy, shooterEnergyMult, defenderEnergyMult)).probability;
}

// Appends a play-by-play line if `log` was supplied (simulatePossessionGame
// always supplies one — see the module comment there on why play-by-play is
// always generated and pruned at save time instead of gated behind a flag).
// An entry is a bare string when there is nothing to show, or { text, check }
// when a skillCheck produced it. Both shapes coexist deliberately and
// permanently: gameSim.js pushes quarter headers as plain strings, and every
// save written before skill checks existed contains strings only — so
// ui/schedule.js has to handle both forever, not just during a migration.
function logPlay(log, text, check) {
  if (!log) return;
  log.push(check ? { text: text, check: check } : text);
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

// What happened, in the ultimate meter's vocabulary. gameSim.js prices these
// through ultimates.chargeGain — this engine deliberately does not know what a
// play is WORTH, only that it happened, which is what keeps ultimates.js out of
// this file's requires entirely.
//
// A no-op when `outcome` is absent, which is every pre-ultimates caller and
// every unit test that does not care. Draws no rng and feeds nothing back into
// the possession, so both golden masters are untouched by its presence.
function reportPlay(outcome, playerId, kind) {
  if (!outcome) return;
  if (!outcome.plays) outcome.plays = [];
  outcome.plays.push({ playerId: playerId, kind: kind });
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
function simulatePossession(offense, offenseBox, defense, defenseBox, rng, synergy, log, eventCtx, inTransition, outcome, gameCtx) {
  // gameCtx is { scoreDiff, period } from the SHOOTING team's point of view.
  // Optional: omitted (or absent, as in every pre-urgency caller) it leaves the
  // urgency modifier at exactly zero, so a caller that does not pass it gets
  // byte-identical behaviour.
  const scoreDiff = gameCtx ? gameCtx.scoreDiff : undefined;
  const gamePeriod = gameCtx ? gameCtx.period : undefined;
  const offSyn = synergy ? synergy.offense : { offense: 1, defense: 1, rebound: 1 };
  const defSyn = synergy ? synergy.defense : { offense: 1, defense: 1, rebound: 1 };
  if (outcome) outcome.liveBallToDefense = false;
  if (outcome) outcome.offensiveRebound = false;

  // The two live takeovers, already resolved to offense/defense by gameSim.js.
  // Absent for every caller that passes no gameCtx, which is what keeps every
  // pre-ultimates caller behaving exactly as it did.
  const tkOff = gameCtx && gameCtx.takeovers ? gameCtx.takeovers.offense : null;
  const tkDef = gameCtx && gameCtx.takeovers ? gameCtx.takeovers.defense : null;
  // The SHOOTING team's Three-Point Rate dial (coaches.js / ui/coaching.js).
  // Rides on gameCtx for the same reason scoreDiff does: a caller that omits it
  // gets exactly the behaviour it had before the dial existed.
  const threeRateDial = gameCtx ? gameCtx.threeRate : undefined;
  const offDial = tkOff ? tkOff.effect : {};
  const defDial = tkDef ? tkDef.effect : {};
  // A solo takeover names one player; a team takeover lifts all five.
  const soloId = tkOff && tkOff.kind === 'solo' ? tkOff.playerId : null;
  const teamOn = !!(tkOff && tkOff.kind === 'team');

  const handler = weightedPick(offense, energyAware(ballHandlingWeight, offenseBox, false), rng, PICK_POWER.handler);
  const onBallDefender = weightedPick(defense, energyAware(perimDefenseWeight, defenseBox, true), rng, PICK_POWER.onBallDefender);
  // Motor Never Stops: he stops tiring, and the man guarding him tires faster.
  const handlerIsHolder = !!(soloId && handler.id === soloId);
  drainEnergyScaled(offenseBox[handler.id], handler,
    handlerIsHolder ? offDial.energyDrain : undefined);
  drainEnergyScaled(defenseBox[onBallDefender.id], onBallDefender,
    handlerIsHolder ? offDial.matchupDrain : undefined);
  pushEvent(eventCtx, { type: 'possession', playerId: handler.id });

  const turnoverCheck = _POSS_DATA.check.skillCheck(
    withModifiers(turnoverSpecFor(onBallDefender, handler, defSyn.defense, offSyn.offense),
      takeoverTurnoverMods(handler.id, soloId, teamOn, offDial, defDial)), rng);
  if (turnoverCheck.passed) {
    const stolen = rng() < 0.5;
    if (stolen) defenseBox[onBallDefender.id].steals += 1;
    reportPlay(outcome, handler.id, 'turnover');
    if (stolen) reportPlay(outcome, onBallDefender.id, 'steal');
    logPlay(log, handler.name + ' turns it over' + (stolen ? ', stolen by ' + onBallDefender.name : ''), turnoverCheck);
    pushEvent(eventCtx, { type: 'turnover', playerId: handler.id, defenderId: stolen ? onBallDefender.id : null, check: turnoverCheck });
    // only a STEAL is a live ball; a dead-ball turnover is inbounded
    if (outcome) outcome.liveBallToDefense = stolen;
    return 0;
  }

  // shotShare and shotCeiling. The ceiling lift is load-bearing, not garnish:
  // weightedPick caps any one player at PICK_CEILING.shooter on the NORMALISED
  // shares, so a usage boost without it saturates at 50% and the takeover's
  // measured points band is unreachable however the rest is tuned. Lifted for
  // the holder and the duration only.
  const shooterWeight = (soloId && offDial.shotShare)
    ? function (p) {
        const w = _POSS_DATA.box.scoringWeight(p);
        return p.id === soloId ? w * offDial.shotShare : w;
      }
    : _POSS_DATA.box.scoringWeight;
  const shooterCeiling = (soloId && offDial.shotCeiling)
    ? Math.max(PICK_CEILING.shooter, offDial.shotCeiling)
    : PICK_CEILING.shooter;
  const shooter = weightedPick(offense, energyAware(shooterWeight, offenseBox, false), rng, PICK_POWER.shooter, shooterCeiling);
  const zone = pickShotZone(shooter, rng, inTransition,
    (soloId && shooter.id === soloId) ? offDial.zoneBias : null, threeRateDial);
  const shotDefender = weightedPick(defense, energyAware(function (p) { return shotDefenseWeight(p, zone); }, defenseBox, true), rng, PICK_POWER.shotDefender);
  // reboundShare, applied on whichever side the holder is actually on. A
  // takeover by the DEFENDING team's Glass Wrecker has to lift him on the
  // defensive glass, which is the board he mostly gets.
  const offReboundWeight = (soloId && offDial.reboundShare)
    ? function (p) {
        const w = reboundCompositeWeight(p);
        return p.id === soloId ? w * offDial.reboundShare : w;
      }
    : reboundCompositeWeight;
  const defHolderId = tkDef && tkDef.kind === 'solo' ? tkDef.playerId : null;
  const defReboundWeight = (defHolderId && defDial.reboundShare)
    ? function (p) {
        const w = reboundCompositeWeight(p);
        return p.id === defHolderId ? w * defDial.reboundShare : w;
      }
    : reboundCompositeWeight;

  const shooterIsHolder = !!(soloId && shooter.id === soloId);
  drainEnergyScaled(offenseBox[shooter.id], shooter,
    shooterIsHolder ? offDial.energyDrain : undefined);
  drainEnergyScaled(defenseBox[shotDefender.id], shotDefender,
    shooterIsHolder ? offDial.matchupDrain : undefined);
  const zoneLabel = zone === 'three' ? '3-pointer' : (zone === 'mid' ? 'mid-range jumper' : 'shot inside');

  // Constants and their reasoning are hoisted to blockSpec at module scope.
  const blockCheck = _POSS_DATA.check.skillCheck(
    withModifiers(blockSpecFor(shotDefender, zone),
      takeoverBlockMods(shotDefender.id, tkDef, defDial)), rng);
  if (blockCheck.passed) {
    defenseBox[shotDefender.id].blocks += 1;
    // A blocked shot is a defended MISS, so it counts toward DFG% denominator.
    defenseBox[shotDefender.id].oppFga += 1;
    offenseBox[shooter.id].fga += 1;
    if (zone === 'three') offenseBox[shooter.id].tpa += 1;
    if (zone === 'inside') offenseBox[shooter.id].insideFga += 1;
    if (zone === 'mid') offenseBox[shooter.id].midFga += 1;
    reportPlay(outcome, shotDefender.id, 'block');
    reportPlay(outcome, shooter.id, 'missedShot');
    logPlay(log, shooter.name + '\'s ' + zoneLabel + ' is blocked by ' + shotDefender.name, blockCheck);
    pushEvent(eventCtx, { type: 'block', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, check: blockCheck });
    return 0;
  }

  // WHETHER HE HAS TO GO THROUGH SOMEBODY. Inside only — contact is a thing
  // that happens at the rim, and a jump shooter with a hand in his face is a
  // contest, which the defence composite already prices.
  //
  // Rolled here rather than inside the spec builder because this is where the
  // rng lives, and because the ANSWER has to travel on the event: the drawing
  // used to infer contact from positions invented after the fact, so a finish
  // resolved as contested could be drawn clean and the other way round.
  const contact = zone === 'inside' && rng() <
    contactChance(_POSS_DATA.composite.computeComposite(shotDefender, 'defenseInterior'));
  const shotCheck = _POSS_DATA.check.skillCheck(
    withModifiers(shotMakeSpecFor(shooter, shotDefender, zone,
      offSyn.offense, defSyn.defense,
      energyMultiplier(offenseBox[shooter.id].energy),
      energyMultiplier(defenseBox[shotDefender.id].energy) * foulTroubleMultiplier(defenseBox[shotDefender.id].fouls),
      scoreDiff, gamePeriod, contact),
      takeoverShotMods(shooter.id, zone, tkOff, soloId, teamOn, offDial, defDial)), rng);
  const made = shotCheck.passed;
  const shotValue = zone === 'three' ? 3 : 2;
  offenseBox[shooter.id].fga += 1;
  defenseBox[shotDefender.id].oppFga += 1;
  if (zone === 'three') offenseBox[shooter.id].tpa += 1;
  if (zone === 'inside') offenseBox[shooter.id].insideFga += 1;
  if (zone === 'mid') offenseBox[shooter.id].midFga += 1;

  let points = 0;
  if (made) {
    offenseBox[shooter.id].fgm += 1;
    defenseBox[shotDefender.id].oppFgm += 1;
    if (zone === 'three') offenseBox[shooter.id].tpm += 1;
    if (zone === 'inside') offenseBox[shooter.id].insideFgm += 1;
    if (zone === 'mid') offenseBox[shooter.id].midFgm += 1;
    offenseBox[shooter.id].points += shotValue;
    points += shotValue;
    // Written as two calls rather than one with a ternary so that every
    // reportPlay site names its kind as a bare literal — that is what lets
    // validate-ultimates.js check the engine's vocabulary against the pricing
    // table statically instead of hoping a sim hits every branch.
    if (zone === 'three') reportPlay(outcome, shooter.id, 'madeThree');
    else reportPlay(outcome, shooter.id, 'madeTwo');
    let assistLine = '';
    let assistPlayerId = null;
    if (rng() < 0.6) {
      const passer = weightedPick(offense.filter(function (p) { return p.id !== shooter.id; }), energyAware(ballHandlingWeight, offenseBox, false), rng, PICK_POWER.passer);
      if (passer) {
        offenseBox[passer.id].assists += 1;
        assistLine = ' (assist: ' + passer.name + ')';
        assistPlayerId = passer.id;
        reportPlay(outcome, passer.id, 'assist');
      }
    }
    logPlay(log, shooter.name + ' makes ' + zoneLabel + assistLine, shotCheck);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: true, points: shotValue, assistPlayerId: assistPlayerId, contact: contact, check: shotCheck });
  } else {
    reportPlay(outcome, shooter.id, 'missedShot');
    logPlay(log, shooter.name + ' misses ' + zoneLabel, shotCheck);
    pushEvent(eventCtx, { type: 'shot', playerId: shooter.id, defenderId: shotDefender.id, zone: zone, made: false, points: 0, assistPlayerId: null, contact: contact, check: shotCheck });
    const offReboundChance = Math.max(0.1, Math.min(0.4, 0.25 * (offSyn.rebound / defSyn.rebound)));
    if (rng() < offReboundChance) {
      const rebounder = weightedPick(offense, energyAware(offReboundWeight, offenseBox, false), rng, PICK_POWER.rebounder);
      offenseBox[rebounder.id].rebounds += 1;
      offenseBox[rebounder.id].oreb += 1;
      reportPlay(outcome, rebounder.id, 'offRebound');
      logPlay(log, rebounder.name + ' grabs the offensive rebound');
      pushEvent(eventCtx, { type: 'rebound', playerId: rebounder.id, offensive: true });
      // The whole point of an offensive rebound: the ball does NOT change
      // hands. gameSim.js's loop used to flip sides unconditionally, so a
      // board was recorded and then handed straight to the defence — the
      // engine produced a realistic ten offensive rebounds a team a night and
      // one single second-chance point.
      if (outcome) outcome.offensiveRebound = true;
    } else {
      const rebounder = weightedPick(defense, energyAware(defReboundWeight, defenseBox, false), rng, PICK_POWER.rebounder);
      defenseBox[rebounder.id].rebounds += 1;
      defenseBox[rebounder.id].dreb += 1;
      reportPlay(outcome, rebounder.id, 'rebound');
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
  // foulRate: And-One stops settling and goes through people.
  const foulMult = (shooterIsHolder && offDial.foulRate) ? offDial.foulRate : 1;
  if (rng() < shootingFoulRate(shotDefender) * foulMult) {
    defenseBox[shotDefender.id].fouls += 1;
    // Fouled on the shot: the ball is at the line, so this is the trip's
    // reward and an offensive rebound on the same miss must not ALSO extend
    // the possession. Rare (a foul on a miss the offence rebounded), but it
    // would pay for one miss twice.
    if (outcome) outcome.offensiveRebound = false;
    reportPlay(outcome, shotDefender.id, 'foul');
    const ftAttempts = 2;
    // Was `freeThrow / 105`, which centred a 78% free-throw shooter at a rating
    // of 82 — fine when every rating lived in 48-99, but on a true 0-100 scale
    // the league-average shooter computed to 0.486 and the 0.55 floor did all
    // the work, flattening every player onto the same number. Centred on 50
    // for that scale; RE-CENTRED ON 76 for the 2K face-value import — 2K's
    // free-throw ratings average 76.2 league-wide, and leaving the centre at
    // 50 handed every shooter +5pp (league FT% measured 83.7 against the 78
    // the base encodes). The spread term is unchanged.
    // Free Throw Ace's affinity is `freeThrow`, so shotQualityBonus routes it
    // to the 'ft' zone — it belongs here rather than on any field-goal zone.
    const ftBoost = (shooterIsHolder && offDial.makeFt) ? offDial.makeFt : 0;
    const ftPct = Math.max(0.45, Math.min(0.95,
      FT_BASE + (shooter.attributes.freeThrow - 76) / FT_DIV +
      _POSS_DATA.traits.shotQualityBonus(shooter, 'ft') / SHOT_TRAIT_DIV + ftBoost));
    let made2 = 0;
    for (let i = 0; i < ftAttempts; i++) { if (rng() < ftPct) made2 += 1; }
    offenseBox[shooter.id].fta += ftAttempts;
    offenseBox[shooter.id].ftm += made2;
    offenseBox[shooter.id].points += made2;
    points += made2;
    for (let f = 0; f < made2; f++) reportPlay(outcome, shooter.id, 'freeThrow');
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
    turnoverSpec: turnoverSpec,
    blockSpec: blockSpec,
    shotSpec: shotSpec,
    SHOT_TUNING: SHOT_TUNING,
    URGENCY_TUNING: URGENCY_TUNING,
    urgencyBonus: urgencyBonus,
    PICK_CEILING: PICK_CEILING,
    shootingFoulRate: shootingFoulRate,
    shotMakeSpecFor: shotMakeSpecFor,
    contactChance: contactChance,
    contactPenalty: contactPenalty,
    CONTACT_TUNING: CONTACT_TUNING,
    turnoverSpecFor: turnoverSpecFor,
    blockSpecFor: blockSpecFor,
    perimDefenseWeight: perimDefenseWeight,
    shotDefenseWeight: shotDefenseWeight,
    weightedPick: weightedPick,
    pickShotZone: pickShotZone,
    shotMakeProbability: shotMakeProbability,
    // Exported so validate-ultimates.js can assert each dial actually moves a
    // probability, rather than only that its NAME appears in this file. Three
    // of them are read through a lookup table, so a text search alone would
    // pass on a dial the engine had merely mentioned.
    ZONE_MAKE_DIAL: ZONE_MAKE_DIAL,
    takeoverShotMods: takeoverShotMods,
    takeoverTurnoverMods: takeoverTurnoverMods,
    takeoverBlockMods: takeoverBlockMods,
    drainEnergyScaled: drainEnergyScaled,
    withModifiers: withModifiers,
    simulatePossession: simulatePossession,
    reportPlay: reportPlay,
    eligibleRoster: eligibleRoster,
    initBoxLine: initBoxLine,
    energyMultiplier: energyMultiplier
  };
}
