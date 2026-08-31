// The bridge between the game and the dialogue scene library.
//
// Two things matter most here: that the context reads the same regardless of
// which side of the floor the user's team is on (a home/away mix-up would tell
// the user they won a game they lost), and that effects clamp — a text box
// must never be able to drive morale or reputation out of range.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js');
rq('rng.js');
rq('names.js');
rq('ratings.js');
rq('faces.js');
rq('teams.js');
const gmCareer = rq('gmCareer.js');
const dc = rq('dialogueContext.js');
const { makeRng } = rq('rng.js');

function fakeState() {
  return {
    userTeamId: 'BOS',
    leagueYear: 2027,
    rng: makeRng(99),
    settings: {},
    gmCareer: null
  };
}

// A finished game the user's team led by 11 after three and then lost.
function fakeSim() {
  return {
    homeTeamId: 'BOS',
    awayTeamId: 'LAL',
    homeScore: 104,
    awayScore: 110,
    period: 4,
    periodScores: [
      { period: 1, home: 28, away: 24 },
      { period: 2, home: 55, away: 48 },
      { period: 3, home: 84, away: 73 },
      { period: 4, home: 104, away: 110 }
    ],
    homeBox: {
      p1: { points: 31, teamId: 'BOS', fgm: 11, fga: 20, energy: 0.6, charge: 0, takeoversUsed: 0 },
      p2: { points: 12, teamId: 'BOS', fgm: 4, fga: 9, energy: 0.7, charge: 0, takeoversUsed: 0 }
    },
    awayBox: { p3: { points: 28, teamId: 'LAL', fgm: 10, fga: 18, energy: 0.8, charge: 0, takeoversUsed: 0 } },
    homeRoster: [{ id: 'p1', name: 'J. Tatum', overall: 92 }, { id: 'p2', name: 'D. White', overall: 78 }],
    awayRoster: [{ id: 'p3', name: 'L. James', overall: 90 }]
  };
}

// A sim where one user-side starter is having a genuinely bad shooting night.
function slumpSim() {
  const sim = fakeSim();
  sim.period = 2;
  sim.homeScore = 48; sim.awayScore = 62;
  sim.homeBox.p1 = { points: 7, teamId: 'BOS', fgm: 3, fga: 14, energy: 0.5, charge: 0, takeoversUsed: 0 };
  sim.homeBox.p2 = { points: 16, teamId: 'BOS', fgm: 7, fga: 11, energy: 0.7, charge: 0, takeoversUsed: 0 };
  return sim;
}

function checkRoleDetection() {
  const gm = fakeState();
  assert.strictEqual(dc.currentRole(gm), 'gm', 'no career controller means GM');

  gm.playerCareerController = { controlledPlayerId: null };
  assert.strictEqual(dc.currentRole(gm), 'gm', 'a controller with no player is still GM');

  gm.playerCareerController = { controlledPlayerId: 'p1' };
  assert.strictEqual(dc.currentRole(gm), 'player', 'a controlled player means player mode');
  console.log('checkRoleDetection: OK');
}
checkRoleDetection();

function checkPostgameContextReadsTheGame() {
  const c = dc.buildPostgameContext(fakeState(), fakeSim());
  assert.strictEqual(c.moment, 'postgame');
  assert.strictEqual(c.role, 'gm');
  assert.strictEqual(c.userScore, 104, 'the user is home here');
  assert.strictEqual(c.opponentScore, 110);
  assert.strictEqual(c.userLost, true);
  assert.strictEqual(c.userWon, false);
  assert.strictEqual(c.margin, 6, 'margin is always positive');
  assert.strictEqual(c.leadBlown, 11, 'led by 11 after three, lost');
  assert.strictEqual(c.topScorerName, 'J. Tatum', 'top scorer is from the USER team');
  assert.strictEqual(c.topScorerPoints, 31);
  assert.ok(c.teamName.length > 0 && c.opponentName.length > 0, 'both teams are named');
  console.log('checkPostgameContextReadsTheGame: OK');
}
checkPostgameContextReadsTheGame();

function checkUserOnTheAwaySideIsReadTheSameWay() {
  const state = fakeState();
  state.userTeamId = 'LAL';
  const c = dc.buildPostgameContext(state, fakeSim());
  assert.strictEqual(c.userScore, 110, 'the away score is the user score now');
  assert.strictEqual(c.opponentScore, 104);
  assert.strictEqual(c.userWon, true);
  assert.strictEqual(c.userLost, false);
  assert.strictEqual(c.margin, 6);
  assert.strictEqual(c.leadBlown, 0, 'the winner blew nothing');
  assert.strictEqual(c.topScorerName, 'L. James', 'top scorer follows the user side');
  assert.strictEqual(c.topScorerPoints, 28);
  console.log('checkUserOnTheAwaySideIsReadTheSameWay: OK');
}
checkUserOnTheAwaySideIsReadTheSameWay();

function checkLeadBlownNeedsBothALeadAndALoss() {
  const state = fakeState();
  const sim = fakeSim();
  sim.periodScores[2] = { period: 3, home: 70, away: 80 };
  assert.strictEqual(dc.buildPostgameContext(state, sim).leadBlown, 0, 'no lead, nothing blown');

  // A sim with no period history at all (a batch sim, or a save predating the
  // field) must degrade rather than throw.
  const bare = fakeSim();
  delete bare.periodScores;
  assert.strictEqual(dc.buildPostgameContext(state, bare).leadBlown, 0, 'missing period scores degrade to zero');

  const empty = fakeSim();
  empty.periodScores = [];
  assert.strictEqual(dc.buildPostgameContext(state, empty).leadBlown, 0, 'an empty history degrades to zero');
  console.log('checkLeadBlownNeedsBothALeadAndALoss: OK');
}
checkLeadBlownNeedsBothALeadAndALoss();

function checkHalftimeContextUsesTheLiveScore() {
  const state = fakeState();
  const sim = fakeSim();
  sim.period = 2;
  sim.homeScore = 55;
  sim.awayScore = 48;
  const c = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(c.moment, 'halftime');
  assert.strictEqual(c.userScore, 55);
  assert.strictEqual(c.opponentScore, 48);
  assert.strictEqual(c.leading, true);
  assert.strictEqual(c.trailing, false);
  assert.strictEqual(c.margin, 7, 'margin is positive at halftime too');
  assert.strictEqual(c.userWon, undefined, 'a game in progress has no winner');
  assert.strictEqual(c.userLost, undefined, 'and no loser');
  console.log('checkHalftimeContextUsesTheLiveScore: OK');
}
checkHalftimeContextUsesTheLiveScore();

function checkATiedHalftimeIsNeitherLeadingNorTrailing() {
  const state = fakeState();
  const sim = fakeSim();
  sim.period = 2; sim.homeScore = 50; sim.awayScore = 50;
  const c = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(c.leading, false);
  assert.strictEqual(c.trailing, false);
  assert.strictEqual(c.margin, 0);
  console.log('checkATiedHalftimeIsNeitherLeadingNorTrailing: OK');
}
checkATiedHalftimeIsNeitherLeadingNorTrailing();

// --- the halftime hint ----------------------------------------------------
// The panel names a man having a bad night; one of the coach's instructions
// acts on it. These checks are about not naming the WRONG man, since the whole
// mechanic depends on the hint being trustworthy.

function checkSlumpFindsTheStrugglingStarter() {
  const c = dc.buildHalftimeContext(fakeState(), slumpSim());
  assert.strictEqual(c.slumpId, 'p1', 'the 3-for-14 man is the slump');
  assert.strictEqual(c.slumpName, 'J. Tatum');
  assert.strictEqual(c.slumpFgm, 3);
  assert.strictEqual(c.slumpFga, 14);
  console.log('checkSlumpFindsTheStrugglingStarter: OK');
}
checkSlumpFindsTheStrugglingStarter();

function checkSlumpIsOnlyTheUsersOwnSide() {
  // Naming the opponent's cold shooter as "your" problem would be nonsense,
  // and worse, the boost would then be aimed at the other team.
  const state = fakeState();
  const sim = slumpSim();
  // Give the AWAY side a far worse night than anyone in Boston.
  sim.awayBox.p3 = { points: 2, teamId: 'LAL', fgm: 1, fga: 16, energy: 0.6, charge: 0, takeoversUsed: 0 };
  const c = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(c.slumpId, 'p1', 'still the user-side man, not the opponent');

  state.userTeamId = 'LAL';
  const away = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(away.slumpId, 'p3', 'and it follows the user to the away side');
  console.log('checkSlumpIsOnlyTheUsersOwnSide: OK');
}
checkSlumpIsOnlyTheUsersOwnSide();

function checkAGoodNightHasNoSlump() {
  // No hint on a night nobody is struggling — a panel inventing a slump is
  // worse than a panel not mentioning one.
  const c = dc.buildHalftimeContext(fakeState(), fakeSim());
  assert.strictEqual(c.slumpId, null, '11-for-20 and 4-for-9 is nobody having a bad night');
  assert.strictEqual(c.slumpName, null);
  console.log('checkAGoodNightHasNoSlump: OK');
}
checkAGoodNightHasNoSlump();

function checkSmallSamplesAreNotSlumps() {
  // 1-for-3 is not a bad night, it is three shots. Calling it out would make
  // the panel look like it was not watching.
  const state = fakeState();
  const sim = slumpSim();
  sim.homeBox.p1 = { points: 2, teamId: 'BOS', fgm: 1, fga: 3, energy: 0.6, charge: 0, takeoversUsed: 0 };
  sim.homeBox.p2 = { points: 16, teamId: 'BOS', fgm: 7, fga: 11, energy: 0.7, charge: 0, takeoversUsed: 0 };
  assert.strictEqual(dc.buildHalftimeContext(state, sim).slumpId, null, 'three attempts is not a slump');
  console.log('checkSmallSamplesAreNotSlumps: OK');
}
checkSmallSamplesAreNotSlumps();

function checkAStarOutranksAWorseShootingBenchPlayer() {
  // Found in a real game: the panel named a bench player 3-for-10 and the
  // boost silently degraded to an energy bump. Your star struggling is the
  // better story AND the only one the payoff actually works on.
  const state = fakeState();
  const sim = slumpSim();
  sim.homeBox.p2 = { points: 2, teamId: 'BOS', fgm: 1, fga: 12, energy: 0.7, charge: 0, takeoversUsed: 0 };
  sim.homeRoster = [
    { id: 'p1', name: 'J. Tatum', overall: 92 },   // can take over, 3-for-14
    { id: 'p2', name: 'Deep Bench', overall: 55 }  // cannot, and shot worse
  ];
  const c = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(c.slumpId, 'p1', 'the star is named, not the worse-shooting bench player');

  // But when nobody who can take over qualifies, the bench player is still
  // named rather than the panel saying nothing.
  sim.homeRoster = [
    { id: 'p1', name: 'J. Tatum', overall: 55 },
    { id: 'p2', name: 'Deep Bench', overall: 55 }
  ];
  const fallback = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(fallback.slumpId, 'p2', 'with no stars, the worst shooter is named');
  console.log('checkAStarOutranksAWorseShootingBenchPlayer: OK');
}
checkAStarOutranksAWorseShootingBenchPlayer();

function checkTheBoostIsOnlyOfferedWhenItCanPayOut() {
  // Measured in a real game: the ultimate gate is 87, so roughly one player
  // per roster can take over. Offering the payoff to anyone else fell back to
  // an energy bump — and for a player already at full energy, to nothing.
  // The panel still MENTIONS the bad night; only the payoff is gated.
  const state = fakeState();
  const sim = slumpSim();

  sim.homeRoster = [{ id: 'p1', name: 'J. Tatum', overall: 92 }, { id: 'p2', name: 'D. White', overall: 78 }];
  const star = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(star.slumpId, 'p1', 'the bad night is reported');
  assert.strictEqual(star.boostId, 'p1', 'and it can be acted on');

  sim.homeRoster = [{ id: 'p1', name: 'J. Tatum', overall: 55 }, { id: 'p2', name: 'D. White', overall: 55 }];
  const nobody = dc.buildHalftimeContext(state, sim);
  assert.strictEqual(nobody.slumpId, 'p1', 'the bad night is STILL reported');
  assert.strictEqual(nobody.boostId, null, 'but there is nothing to act on');
  console.log('checkTheBoostIsOnlyOfferedWhenItCanPayOut: OK');
}
checkTheBoostIsOnlyOfferedWhenItCanPayOut();

function checkTheBoostLightsTheFuse() {
  // A player who can take over gets charge — enough to make it likely, not
  // enough to be free: he still has to earn the rest in the second half.
  const state = fakeState();
  const sim = slumpSim();
  const ctx = dc.buildHalftimeContext(state, sim);
  const before = sim.homeBox.p1.charge;

  const res = dc.applyDialogueEffect(state, { boostPlayer: ctx.slumpId }, ctx, { sim: sim });
  assert.ok(res.applied.indexOf('boostPlayer') !== -1, 'the boost was applied');
  assert.ok(sim.homeBox.p1.charge > before, 'charge went up');
  assert.ok(sim.homeBox.p1.charge < dc.CHARGE_FULL, 'but not to a free takeover');
  assert.ok(sim.homeBox.p1.charge >= dc.CHARGE_FULL * 0.4, 'and it is a real push, not a token');
  console.log('checkTheBoostLightsTheFuse: OK');
}
checkTheBoostLightsTheFuse();

function checkTheBoostNeverTakesChargeAway() {
  // Live bug: the ceiling was applied with Math.min alone, so a player who had
  // already banked more charge than the ceiling had it CLAMPED DOWN. Acting on
  // the hint made him worse off, and measured over 60 games the whole mechanic
  // came out as a no-op.
  const state = fakeState();
  const sim = slumpSim();
  const ctx = dc.buildHalftimeContext(state, sim);
  const line = sim.homeBox[ctx.boostId];

  line.charge = dc.CHARGE_FULL * 0.95;   // already past the ceiling
  dc.applyDialogueEffect(state, { boostPlayer: ctx.boostId }, ctx, { sim: sim });
  assert.strictEqual(line.charge, dc.CHARGE_FULL * 0.95, 'a player past the ceiling is left alone');

  line.charge = dc.CHARGE_FULL * 0.5;    // below it, so the boost should lift him
  dc.applyDialogueEffect(state, { boostPlayer: ctx.boostId }, ctx, { sim: sim });
  assert.ok(line.charge > dc.CHARGE_FULL * 0.5, 'a player below the ceiling is lifted');
  assert.ok(line.charge <= dc.CHARGE_FULL * dc.BOOST_CHARGE_CEILING + 1e-9, 'but not past the ceiling');
  console.log('checkTheBoostNeverTakesChargeAway: OK');
}
checkTheBoostNeverTakesChargeAway();

function checkAPlayerWithNoUltimateGetsASecondWindInstead() {
  // Below the ultimate gate charge does nothing at all, so the hint would pay
  // out nothing. Energy is the fallback so it always buys something.
  const state = fakeState();
  const sim = slumpSim();
  sim.homeRoster = [{ id: 'p1', name: 'J. Tatum', overall: 55 }, { id: 'p2', name: 'D. White', overall: 78 }];
  const ctx = dc.buildHalftimeContext(state, sim);
  const beforeEnergy = sim.homeBox.p1.energy;
  const beforeCharge = sim.homeBox.p1.charge;

  dc.applyDialogueEffect(state, { boostPlayer: 'p1' }, ctx, { sim: sim });
  assert.ok(sim.homeBox.p1.energy > beforeEnergy, 'he got his legs back');
  assert.strictEqual(sim.homeBox.p1.charge, beforeCharge, 'and no charge, which would do nothing for him');
  assert.ok(sim.homeBox.p1.energy <= 1, 'energy clamps at full');
  console.log('checkAPlayerWithNoUltimateGetsASecondWindInstead: OK');
}
checkAPlayerWithNoUltimateGetsASecondWindInstead();

function checkTheBoostNeedsASimAndAKnownPlayer() {
  const state = fakeState();
  const sim = slumpSim();
  const ctx = dc.buildHalftimeContext(state, sim);

  // No sim supplied (the post-game path never has one) — must not throw.
  const noSim = dc.applyDialogueEffect(state, { boostPlayer: 'p1' }, ctx);
  assert.strictEqual(noSim.applied.indexOf('boostPlayer'), -1, 'nothing applied without a sim');

  // A player who is not in either box.
  const before = JSON.stringify(sim.homeBox);
  const stranger = dc.applyDialogueEffect(state, { boostPlayer: 'nobody' }, ctx, { sim: sim });
  assert.strictEqual(stranger.applied.indexOf('boostPlayer'), -1, 'nothing applied for a stranger');
  assert.strictEqual(JSON.stringify(sim.homeBox), before, 'and nothing was touched');

  // A null target, which is what a scene produces when there is no slump.
  assert.doesNotThrow(function () {
    dc.applyDialogueEffect(state, { boostPlayer: null }, ctx, { sim: sim });
  }, 'a null target is a no-op');
  console.log('checkTheBoostNeedsASimAndAKnownPlayer: OK');
}
checkTheBoostNeedsASimAndAKnownPlayer();

function checkTheBoostCannotReachTheOpponent() {
  // The most damaging possible bug in this mechanic: buying the other team a
  // takeover. The applier must refuse a player who is not on the user's side.
  const state = fakeState();
  const sim = slumpSim();
  const ctx = dc.buildHalftimeContext(state, sim);
  const before = JSON.stringify(sim.awayBox);
  dc.applyDialogueEffect(state, { boostPlayer: 'p3' }, ctx, { sim: sim });
  assert.strictEqual(JSON.stringify(sim.awayBox), before, 'the opponent was not boosted');
  console.log('checkTheBoostCannotReachTheOpponent: OK');
}
checkTheBoostCannotReachTheOpponent();

function checkReportersAreOnePerTeamAndStable() {
  const state = fakeState();
  const first = dc.ensureReporters(state);
  const ids = Object.keys(first);
  assert.ok(ids.length >= 30, 'a reporter for every team, got ' + ids.length);

  // Cached, not regenerated: your beat writer is the same person every night.
  assert.strictEqual(dc.ensureReporters(state), first, 'the same object is returned, not a rebuild');
  assert.strictEqual(dc.reporterForTeam(state, 'BOS').name, first.BOS.name, 'stable across calls');

  const names = {};
  ids.forEach(function (teamId) {
    const r = first[teamId];
    assert.ok(typeof r.name === 'string' && r.name.length > 0, teamId + ' reporter has a name');
    assert.ok(typeof r.outlet === 'string' && r.outlet.length > 0, teamId + ' reporter has an outlet');
    assert.strictEqual(r.teamId, teamId, 'the reporter knows his beat');
    assert.ok(r.face && r.face.body && r.face.hair, teamId + ' reporter has a face to draw');
    assert.ok(!names[r.name], 'two reporters share the name ' + r.name);
    names[r.name] = true;
  });
  console.log('checkReportersAreOnePerTeamAndStable: OK');
}
checkReportersAreOnePerTeamAndStable();

function checkReportersRegenerateOnAnOldSave() {
  const state = fakeState();
  assert.ok(!state.reporters, 'precondition: nothing cached');
  assert.ok(Object.keys(dc.ensureReporters(state)).length > 0, 'an old save regenerates a full set');
  console.log('checkReportersRegenerateOnAnOldSave: OK');
}
checkReportersRegenerateOnAnOldSave();

function checkSameSeedGivesSameReporters() {
  assert.strictEqual(dc.ensureReporters(fakeState()).BOS.name, dc.ensureReporters(fakeState()).BOS.name,
    'a save replays the same reporters');
  console.log('checkSameSeedGivesSameReporters: OK');
}
checkSameSeedGivesSameReporters();

function checkAnUnknownTeamStillGetsAReporter() {
  // Expansion and relocation can hand us a team id the cache predates.
  const state = fakeState();
  dc.ensureReporters(state);
  const r = dc.reporterForTeam(state, 'ZZZ');
  assert.ok(r && r.name, 'an unknown beat falls back rather than returning null');
  console.log('checkAnUnknownTeamStillGetsAReporter: OK');
}
checkAnUnknownTeamStillGetsAReporter();

function checkEffectsClampAndApply() {
  const state = fakeState();
  const career = gmCareer.ensureGmCareer(state);
  career.reputation = 50;

  const player = { id: 'p1', status: { morale: 50 } };
  const ctx = { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [player], opponentName: 'Monarchs' };

  dc.applyDialogueEffect(state, { reputation: 3 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 53, 'reputation moved');

  dc.applyDialogueEffect(state, { reputation: 999 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 100, 'reputation clamps high');

  dc.applyDialogueEffect(state, { reputation: -999 }, ctx);
  assert.strictEqual(state.gmCareer.reputation, 0, 'reputation clamps low');

  dc.applyDialogueEffect(state, { teamMorale: 2 }, ctx);
  assert.strictEqual(player.status.morale, 52, 'team morale moved every player');

  player.status.morale = 99.5;
  dc.applyDialogueEffect(state, { teamMorale: 5 }, ctx);
  assert.strictEqual(player.status.morale, 100, 'morale clamps at 100');

  player.status.morale = 1;
  dc.applyDialogueEffect(state, { teamMorale: -5 }, ctx);
  assert.strictEqual(player.status.morale, 0, 'morale clamps at 0');
  console.log('checkEffectsClampAndApply: OK');
}
checkEffectsClampAndApply();

function checkPlayerMoraleHitsOnlyTheControlledPlayer() {
  const state = fakeState();
  gmCareer.ensureGmCareer(state);
  state.playerCareerController = { controlledPlayerId: 'p1' };
  const me = { id: 'p1', status: { morale: 50 } };
  const other = { id: 'p2', status: { morale: 50 } };
  dc.applyDialogueEffect(state, { playerMorale: 3 },
    { moment: 'postgame', role: 'player', teamId: 'BOS', roster: [me, other] });
  assert.strictEqual(me.status.morale, 53, 'the controlled player moved');
  assert.strictEqual(other.status.morale, 50, 'a teammate did not');
  console.log('checkPlayerMoraleHitsOnlyTheControlledPlayer: OK');
}
checkPlayerMoraleHitsOnlyTheControlledPlayer();

function checkANullEffectChangesNothing() {
  const state = fakeState();
  const career = gmCareer.ensureGmCareer(state);
  career.reputation = 64;
  const player = { id: 'p1', status: { morale: 41 } };
  const ctx = { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [player] };

  const before = JSON.stringify({ rep: state.gmCareer.reputation, morale: player.status.morale,
    chron: state.gmCareer.chronicle.length });
  dc.applyDialogueEffect(state, null, ctx);
  dc.applyDialogueEffect(state, undefined, ctx);
  dc.applyDialogueEffect(state, {}, ctx);
  const after = JSON.stringify({ rep: state.gmCareer.reputation, morale: player.status.morale,
    chron: state.gmCareer.chronicle.length });
  assert.strictEqual(after, before, 'a flavour choice is a genuine no-op');
  console.log('checkANullEffectChangesNothing: OK');
}
checkANullEffectChangesNothing();

function checkChronicleAppendsExactlyOnceWithANamedKind() {
  const state = fakeState();
  gmCareer.ensureGmCareer(state);
  const before = state.gmCareer.chronicle.length;
  dc.applyDialogueEffect(state, { chronicle: 'Said a thing.' },
    { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [] });
  assert.strictEqual(state.gmCareer.chronicle.length, before + 1, 'exactly one entry');
  const entry = state.gmCareer.chronicle[state.gmCareer.chronicle.length - 1];
  assert.strictEqual(entry.kind, gmCareer.CHRONICLE_KINDS.PRESS, 'filed under a named kind');
  assert.strictEqual(entry.leagueYear, 2027, 'filed against the right year');
  console.log('checkChronicleAppendsExactlyOnceWithANamedKind: OK');
}
checkChronicleAppendsExactlyOnceWithANamedKind();

function checkAMissingRosterDoesNotThrow() {
  // getTeamRoster can legitimately come back empty mid-offseason.
  const state = fakeState();
  gmCareer.ensureGmCareer(state);
  assert.doesNotThrow(function () {
    dc.applyDialogueEffect(state, { teamMorale: 2 }, { moment: 'postgame', role: 'gm', teamId: 'BOS' });
  }, 'no roster, no crash');
  // And a player carrying no status block is skipped rather than crashing.
  assert.doesNotThrow(function () {
    dc.applyDialogueEffect(state, { teamMorale: 2 },
      { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [{ id: 'x' }] });
  }, 'a player with no status block is skipped');
  console.log('checkAMissingRosterDoesNotThrow: OK');
}
checkAMissingRosterDoesNotThrow();

function checkRecentSceneRingBuffer() {
  const state = fakeState();
  for (let i = 0; i < dc.RECENT_SCENE_LIMIT + 4; i++) {
    dc.pushRecentScene(state, 'scene-' + i);
  }
  assert.strictEqual(state.recentDialogueScenes.length, dc.RECENT_SCENE_LIMIT, 'the buffer is bounded');
  assert.strictEqual(state.recentDialogueScenes.indexOf('scene-0'), -1, 'the oldest fell off');
  assert.ok(state.recentDialogueScenes.indexOf('scene-' + (dc.RECENT_SCENE_LIMIT + 3)) !== -1,
    'the newest is kept');

  const fresh = fakeState();
  dc.pushRecentScene(fresh, 'first');
  assert.deepStrictEqual(fresh.recentDialogueScenes, ['first'], 'an absent buffer normalizes');

  const corrupt = fakeState();
  corrupt.recentDialogueScenes = 'not an array';
  dc.pushRecentScene(corrupt, 'first');
  assert.deepStrictEqual(corrupt.recentDialogueScenes, ['first'], 'a corrupt buffer is replaced');
  console.log('checkRecentSceneRingBuffer: OK');
}
checkRecentSceneRingBuffer();

const dialogueBox = rq('ui/dialogueBox.js');

function checkTheBoxDegradesWithoutADom() {
  // This module is required by a node validator that has no DOM, exactly the
  // way ui/pixelSprites.js is. It must not throw at load or at call.
  assert.strictEqual(dialogueBox.dialogueBoxIsOpen(), false, 'nothing is open without a DOM');
  assert.strictEqual(
    dialogueBox.runDialogue({ id: 'x', lines: [{ emotion: 'neutral', text: 'hi' }], choices: [{ text: 'ok' }] }, {}, function () {}),
    false, 'runDialogue reports it could not open rather than throwing');
  assert.doesNotThrow(function () { dialogueBox.closeDialogueBox(); }, 'closing nothing is safe');
  console.log('checkTheBoxDegradesWithoutADom: OK');
}
checkTheBoxDegradesWithoutADom();

function checkMalformedScenesAreRefused() {
  // A scene with no lines or no choices would open a box the user cannot
  // dismiss. Refusing is the caller's cue to fall through.
  [null, {}, { lines: [], choices: [] },
   { lines: [{ emotion: 'neutral', text: 'x' }], choices: [] },
   { lines: [], choices: [{ text: 'x' }] }].forEach(function (bad) {
    assert.strictEqual(dialogueBox.runDialogue(bad, {}, function () {}), false,
      'refused: ' + JSON.stringify(bad));
  });
  console.log('checkMalformedScenesAreRefused: OK');
}
checkMalformedScenesAreRefused();

function checkTheStudioAlsoDegradesWithoutADom() {
  const studio = rq('studioShow.js');
  const seg = studio.SEGMENTS[0];
  assert.strictEqual(dialogueBox.runStudioSegment(seg, {}, function () {}), false,
    'the studio reports it could not open rather than throwing');
  [null, {}, { beats: [] }].forEach(function (bad) {
    assert.strictEqual(dialogueBox.runStudioSegment(bad, {}, function () {}), false,
      'refused a malformed segment: ' + JSON.stringify(bad));
  });
  console.log('checkTheStudioAlsoDegradesWithoutADom: OK');
}
checkTheStudioAlsoDegradesWithoutADom();

function checkTheHandoffOutlastsItsAnimation() {
  // The sweep timer removes the lingering set. If it fired before the CSS
  // transition finished, the set would vanish mid-move instead of pulling
  // back — the exact defect the transition exists to avoid.
  assert.ok(dialogueBox.STUDIO_HANDOFF_MS >= 620,
    'the sweep must outlast the 620ms pull-back, got ' + dialogueBox.STUDIO_HANDOFF_MS);
  console.log('checkTheHandoffOutlastsItsAnimation: OK');
}
checkTheHandoffOutlastsItsAnimation();

function checkTheStudioIsDrawnBigEnoughToSeeAFace() {
  // Fullscreen exists so you can see who is talking. At the old 80px the bust
  // scaled to 2x and a face was a suggestion.
  const bust = rq('ui/pixelBust.js');
  assert.ok(bust.bustScale(dialogueBox.STUDIO_SEAT_PX) >= 4,
    'seats should draw at 4x or better, got ' + bust.bustScale(dialogueBox.STUDIO_SEAT_PX));
  console.log('checkTheStudioIsDrawnBigEnoughToSeeAFace: OK');
}
checkTheStudioIsDrawnBigEnoughToSeeAFace();

function checkTypewriterSpeedIsTheSpeccedValue() {
  assert.strictEqual(dialogueBox.DIALOGUE_CHAR_MS, 28, 'the spec fixes this at 28ms/char');
  console.log('checkTypewriterSpeedIsTheSpeccedValue: OK');
}
checkTypewriterSpeedIsTheSpeccedValue();

// The deadline the owner asks about must be the deadline the game observes.
//
// It was not. ui/simControls.js sends "Skip To Deadline" to day 83 and
// script.js clusters AI trades around day 83, while this file asked the
// question in GAMES PLAYED — 65% of 82 games is game 53, which a club reaches
// on day 66. So the buy-or-sell scene opened seventeen days early and had gone
// quiet by the time the deadline actually landed. Both are now read off
// data.js's tradeDeadlineDay, and this check exists so they cannot drift apart
// again in different units.
function checkTheDeadlineSceneAsksAboutTheRealDeadline() {
  const data = rq('data.js');
  // A season shaped like the real one: 82 games per club spread over ~127 days.
  const games = [];
  for (let day = 1; day <= 127; day++) games.push({ day: day });
  const deadline = data.tradeDeadlineDay(games);
  assert.strictEqual(deadline, 83, 'the shared helper moved: got day ' + deadline);

  function soonOn(day) {
    const gs = fakeState();
    gs.season = { games: games, currentDay: day };
    return dc.buildSeasonContext(gs).deadlineSoon;
  }

  assert.strictEqual(soonOn(deadline), true, 'silent ON the deadline itself');
  assert.strictEqual(soonOn(deadline - 1), true, 'silent the day before the deadline');
  assert.strictEqual(soonOn(deadline - 14), true, 'the window must open a fortnight out');
  assert.strictEqual(soonOn(deadline - 15), false, 'the window opened too early');
  assert.strictEqual(soonOn(deadline + 1), false, 'still asking after the deadline passed');
  // The specific regression: the old games-played window opened here.
  assert.strictEqual(soonOn(66), false,
    'day 66 is seventeen days before the deadline and must not count as soon');
  console.log('checkTheDeadlineSceneAsksAboutTheRealDeadline: OK (deadline day ' +
    deadline + ', window ' + (deadline - 14) + '-' + deadline + ')');
}
checkTheDeadlineSceneAsksAboutTheRealDeadline();

// A rivalry scene has to be about something that is happening, not about a
// row in a table. rivalry-heat used to fire on "you have a rival", which is
// permanently true once you do — and at priority 58 that outranked everything
// below it. probe-sceneVolume.js measured the cost: running-hot never fired
// once across six seasons.
function checkTheRivalryOnlyComesUpAroundTheFixture() {
  const dc = require(path.join(ROOT, 'dialogueContext.js'));
  const ds = require(path.join(ROOT, 'dialogueScenes.js'));
  const rivalries = require(path.join(ROOT, 'rivalries.js'));
  const teams = require(path.join(ROOT, 'teams.js'));

  const state = rivalries.createRivalryState ? rivalries.createRivalryState() : {};
  rivalries.addHeat(state, 'BOS', 'LAL', rivalries.RIVALRY_THRESHOLD + 10);

  function ctxOnDay(day, rivalGameDay) {
    teams.TEAMS.forEach(function (t) { t.record = { wins: 20, losses: 20 }; });
    return dc.buildSeasonContext({
      userTeamId: 'BOS', leagueYear: 2026, rivalries: state, gmCareer: null,
      season: {
        currentDay: day,
        games: [{ id: 'g1', homeTeamId: 'BOS', awayTeamId: 'LAL', day: rivalGameDay,
                  played: rivalGameDay <= day, homeScore: null, awayScore: null }]
      }
    });
  }

  const near = ctxOnDay(40, 42);
  const far = ctxOnDay(40, 90);
  assert.ok(near.rivalName, 'the rival must still be identified either way');
  assert.ok(far.rivalName, 'the rival must still be identified either way');
  assert.strictEqual(near.rivalGameNear, true, 'a fixture two days out is near');
  assert.strictEqual(far.rivalGameNear, false, 'a fixture fifty days out is not');

  const scene = ds.SCENES.filter(function (x) { return x.id === 'rivalry-heat'; })[0];
  assert.ok(scene, 'rivalry-heat must exist');
  assert.strictEqual(scene.when(near), true, 'it must fire around the fixture');
  assert.strictEqual(scene.when(far), false, 'and stay quiet the rest of the year');

  // Just played counts as much as about to play.
  assert.strictEqual(ctxOnDay(40, 34).rivalGameNear, true, 'a game six days ago is still live');
  assert.strictEqual(ctxOnDay(40, 20).rivalGameNear, false, 'twenty days ago is not');

  // No rivalry at all must not throw or invent one.
  const none = dc.buildSeasonContext({
    userTeamId: 'BOS', leagueYear: 2026, rivalries: null, gmCareer: null,
    season: { currentDay: 10, games: [] }
  });
  assert.strictEqual(none.rivalGameNear, false, 'no rival, no fixture');
  assert.strictEqual(scene.when(none), false, 'and no scene');

  console.log('checkTheRivalryOnlyComesUpAroundTheFixture: OK');
}
checkTheRivalryOnlyComesUpAroundTheFixture();

console.log('All dialogue context validations passed');
