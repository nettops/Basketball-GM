// Difficulty modes.
//
// The check that matters here is the NEGATIVE one, and it is the reason the
// module is as small as it is: difficulty must never reach the sim. A mode that
// quietly moved shot percentages or nudged a close game would make every result
// in the save unreadable — you could never tell whether a team lost because it
// was worse or because the setting decided it should.
//
// checkNoModeChangesASimulatedGame simulates the same seeded game under every
// mode and requires an identical box score. It passes today by construction,
// because nothing in the sim path reads difficulty at all. It exists so that it
// STOPS passing the moment somebody wires it in.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const traits = req('traits.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
req('simEngine.js'); req('simEngineBoxScore.js'); req('simEnginePossession.js');
req('gameCoach.js');
const gameSim = req('gameSim.js');
const difficulty = req('difficulty.js');
const owner = req('owner.js');

// A difficulty system whose default is not EXACTLY neutral silently changes
// every save that already exists.
function checkNormalIsExactlyNeutral() {
  const n = difficulty.getDifficulty('normal');
  assert.strictEqual(n.ownerPatienceOffset, 0, 'normal moves the owner not at all');
  assert.strictEqual(n.aiTradeShrewdness, 1, 'nor trades');
  assert.strictEqual(n.rivalFreeAgentPull, 1, 'nor free agency');
  assert.strictEqual(difficulty.patienceFor(owner.OWNER_PATIENCE, 'normal'), owner.OWNER_PATIENCE,
    'so patience on normal is exactly what owner.js says it is');

  // An unknown or missing key must land on normal rather than on undefined —
  // a save written before this setting existed carries no difficulty at all.
  assert.deepStrictEqual(difficulty.getDifficulty(undefined), n, 'no setting means normal');
  assert.deepStrictEqual(difficulty.getDifficulty('nonsense'), n, 'an unknown setting means normal');
  console.log('checkNormalIsExactlyNeutral: OK');
}
checkNormalIsExactlyNeutral();

function checkTheModesAreActuallyOrdered() {
  const keys = ['relaxed', 'normal', 'tough', 'brutal'];
  for (let i = 1; i < keys.length; i++) {
    const easier = difficulty.getDifficulty(keys[i - 1]);
    const harder = difficulty.getDifficulty(keys[i]);
    assert.ok(harder.aiTradeShrewdness >= easier.aiTradeShrewdness,
      keys[i] + ' trades at least as shrewdly as ' + keys[i - 1]);
    assert.ok(harder.rivalFreeAgentPull >= easier.rivalFreeAgentPull,
      keys[i] + ' pulls free agents at least as hard as ' + keys[i - 1]);
    assert.ok(harder.ownerPatienceOffset <= easier.ownerPatienceOffset,
      keys[i] + ' has an owner at least as impatient as ' + keys[i - 1]);
  }
  // And the extremes actually differ, or the setting is a label with no effect.
  assert.ok(difficulty.getDifficulty('brutal').aiTradeShrewdness >
    difficulty.getDifficulty('relaxed').aiTradeShrewdness, 'the ends of the scale are not the same place');
  console.log('checkTheModesAreActuallyOrdered: OK');
}
checkTheModesAreActuallyOrdered();

// A patience of zero sacks the GM at the first review he ever faces, before he
// has taken a single decision. That is not a difficulty setting, it is a broken
// save.
function checkPatienceNeverReachesZero() {
  difficulty.difficultyKeys().forEach(function (key) {
    assert.ok(difficulty.patienceFor(1, key) >= 1,
      key + ' leaves at least one season of rope even from a base of 1');
    assert.ok(difficulty.patienceFor(owner.OWNER_PATIENCE, key) >= 1,
      key + ' leaves at least one season of rope');
  });
  assert.strictEqual(difficulty.patienceFor(owner.OWNER_PATIENCE, 'brutal'), owner.OWNER_PATIENCE - 1,
    'brutal really is one season shorter');
  console.log('checkPatienceNeverReachesZero: OK');
}
checkPatienceNeverReachesZero();

// THE point of this file. Difficulty adjusts what the league does AROUND the
// player, never what happens once the ball is in the air.
function checkNoModeChangesASimulatedGame() {
  const SEED = 20260817;
  const results = difficulty.difficultyKeys().map(function (key) {
    // Passed the way every other setting reaches the engine, so that if
    // difficulty is ever threaded into the sim this test sees it.
    const settings = { simEngine: 'possession', difficulty: key };
    return {
      key: key,
      out: gameSim.simulateGame('BOS', 'LAL', makeRng(SEED), { settings: settings })
    };
  });

  const first = results[0];
  results.slice(1).forEach(function (r) {
    assert.strictEqual(r.out.homeScore, first.out.homeScore,
      r.key + ' must produce the same home score as ' + first.key +
      ' — difficulty has reached the simulation');
    assert.strictEqual(r.out.awayScore, first.out.awayScore,
      r.key + ' must produce the same away score as ' + first.key);
    assert.deepStrictEqual(Object.keys(r.out.boxScore).sort(), Object.keys(first.out.boxScore).sort(),
      r.key + ' must field the same players');
    Object.keys(first.out.boxScore).forEach(function (pid) {
      assert.strictEqual(r.out.boxScore[pid].points, first.out.boxScore[pid].points,
        r.key + ' must give ' + pid + ' the same points');
    });
  });
  console.log('checkNoModeChangesASimulatedGame: OK (' +
    first.out.homeScore + '-' + first.out.awayScore + ' on every mode)');
}
checkNoModeChangesASimulatedGame();

// difficulty's one wired dial. A setting whose modes are defined but consumed
// by nothing is a label, so this asserts the rope actually changes length.
function checkTheOwnerActuallyFeelsTheSetting() {
  const gmCareer = req('gmCareer.js');
  const missed = { met: false };

  const brutalCareer = gmCareer.createGmCareer('GM', 'BOS', 2026);
  const brutalMax = difficulty.patienceFor(owner.OWNER_PATIENCE, 'brutal');
  const brutalFirst = owner.applyMandateResult(brutalCareer, 'BOS', missed, brutalMax);
  assert.strictEqual(brutalFirst.fired, true, 'on brutal, one miss is the sack');

  const normalCareer = gmCareer.createGmCareer('GM', 'BOS', 2026);
  const normalMax = difficulty.patienceFor(owner.OWNER_PATIENCE, 'normal');
  assert.strictEqual(owner.applyMandateResult(normalCareer, 'BOS', missed, normalMax).fired, false,
    'on normal the same miss is a warning');

  const relaxedCareer = gmCareer.createGmCareer('GM', 'BOS', 2026);
  const relaxedMax = difficulty.patienceFor(owner.OWNER_PATIENCE, 'relaxed');
  owner.applyMandateResult(relaxedCareer, 'BOS', missed, relaxedMax);
  assert.strictEqual(owner.applyMandateResult(relaxedCareer, 'BOS', missed, relaxedMax).fired, false,
    'and on relaxed even two misses are survivable');
  console.log('checkTheOwnerActuallyFeelsTheSetting: OK');
}
checkTheOwnerActuallyFeelsTheSetting();

// The other two dials. They were defined and consumed by nothing for a while,
// which is a setting that lies about what it does — so this asserts both are
// actually read by the code that claims to read them.
function checkTheOtherTwoDialsAreReallyWired() {
  const tradeEvaluator = req('tradeEvaluator.js');
  const freeAgency = req('freeAgency.js');

  difficulty.applyDifficulty('normal', tradeEvaluator.TRADE_TUNING, freeAgency.MARKET_TUNING);
  assert.strictEqual(tradeEvaluator.TRADE_TUNING.shrewdness, 1, 'normal leaves trades exactly alone');
  assert.strictEqual(freeAgency.MARKET_TUNING.rivalPull, 1, 'and free agency exactly alone');

  difficulty.applyDifficulty('brutal', tradeEvaluator.TRADE_TUNING, freeAgency.MARKET_TUNING);
  assert.ok(tradeEvaluator.TRADE_TUNING.shrewdness > 1, 'brutal makes the AI bargain harder');
  assert.ok(freeAgency.MARKET_TUNING.rivalPull > 1, 'and rivals pull harder at free agents');

  difficulty.applyDifficulty('relaxed', tradeEvaluator.TRADE_TUNING, freeAgency.MARKET_TUNING);
  assert.ok(tradeEvaluator.TRADE_TUNING.shrewdness < 1, 'relaxed makes it easier');
  assert.ok(freeAgency.MARKET_TUNING.rivalPull < 1, 'both ways');

  // The user's own offer is never scaled: difficulty makes the league harder,
  // it does not make the player worse at his job.
  const player = { name: 'X', age: 27, rawOverall: 75, status: { morale: 70 },
    hiddenPersonality: null, careerHistory: null };
  const team = { id: 'BOS', timeline: 'win-now', prestige: 70, marketSize: 70,
    record: { wins: 40, losses: 20 }, finances: { arenaTier: 3 } };
  const offer = { salary: 20000000, yearsRemaining: 3, teamId: 'BOS' };
  global.GameState = { userTeamId: 'BOS' };
  const mine = freeAgency.rivalWeightedScore(player, team, offer, 'BOS');
  const theirs = freeAgency.rivalWeightedScore(player, team, offer, 'LAL');
  assert.ok(theirs < mine, 'on relaxed a rival offer is worth less than the same offer from the user');
  delete global.GameState;

  // Leave the league on normal for anything that runs after this file.
  difficulty.applyDifficulty('normal', tradeEvaluator.TRADE_TUNING, freeAgency.MARKET_TUNING);
  console.log('checkTheOtherTwoDialsAreReallyWired: OK');
}
checkTheOtherTwoDialsAreReallyWired();

console.log('All difficulty validations passed');
