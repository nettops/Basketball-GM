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
rq('faceSvgs.js');
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
    homeBox: { p1: { points: 31, teamId: 'BOS' }, p2: { points: 12, teamId: 'BOS' } },
    awayBox: { p3: { points: 28, teamId: 'LAL' } },
    homeRoster: [{ id: 'p1', name: 'J. Tatum' }, { id: 'p2', name: 'D. White' }],
    awayRoster: [{ id: 'p3', name: 'L. James' }]
  };
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
  const ctx = { moment: 'postgame', role: 'gm', teamId: 'BOS', roster: [player], opponentName: 'Lakers' };

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

function checkTypewriterSpeedIsTheSpeccedValue() {
  assert.strictEqual(dialogueBox.DIALOGUE_CHAR_MS, 28, 'the spec fixes this at 28ms/char');
  console.log('checkTypewriterSpeedIsTheSpeccedValue: OK');
}
checkTypewriterSpeedIsTheSpeccedValue();

console.log('All dialogue context validations passed');
