const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const coach = require(path.join(__dirname, '..', 'gameCoach.js'));

// Six fouls means out, with no exceptions and no ambiguity.
function checkFouledOutPlayerIsBenched() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(61));
  const victim = sim.onCourt.home[0];
  sim.homeBox[victim].fouls = 6;
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === victim; }),
    'a player with 6 fouls must be substituted out');
  console.log('checkFouledOutPlayerIsBenched: OK');
}
checkFouledOutPlayerIsBenched();

// A gassed player gets a rest, provided someone fresher is available.
function checkTiredPlayerIsRested() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(62));
  const tired = sim.onCourt.home[0];
  sim.homeBox[tired].energy = 0.40;
  Object.keys(sim.homeBox).forEach(function (id) {
    if (sim.onCourt.home.indexOf(id) === -1) sim.homeBox[id].energy = 1.0;
  });
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === tired; }),
    'a player below the energy floor must be rested when a fresher body exists');
  console.log('checkTiredPlayerIsRested: OK');
}
checkTiredPlayerIsRested();

// Without a minutes budget nothing would sit a healthy starter, and one
// player would soak up all 48 minutes.
function checkStarterIsRestedOnMinutesPace() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(66));
  // Halfway through the game, with a starter who has never come off.
  sim.period = 3;
  sim.clock = 12 * 60;
  const hog = sim.onCourt.home[0];
  sim.secondsPlayed[hog] = 24 * 60;   // 24 minutes played at the half
  sim.homeBox[hog].energy = 1.0;      // not tired, not in foul trouble
  sim.homeBox[hog].fouls = 0;
  const swaps = coach.decideSubstitutions(sim, 'home');
  assert.ok(swaps.some(function (s) { return s.out === hog; }),
    'a starter well past his minutes pace must sit even when fresh');
  console.log('checkStarterIsRestedOnMinutesPace: OK');
}
checkStarterIsRestedOnMinutesPace();

// Nobody should approach a full 48 once the budget is enforced.
function checkNoPlayerSoaksTheWholeGame() {
  for (const seed of [67, 68, 69]) {
    const r = gameSim.simulateGame('BOS', 'LAL', makeRng(seed));
    Object.keys(r.boxScore).forEach(function (id) {
      assert.ok(r.boxScore[id].minutes <= 44,
        'no player should play essentially the whole game, got ' + r.boxScore[id].minutes + ' for ' + id);
    });
  }
  console.log('checkNoPlayerSoaksTheWholeGame: OK');
}
checkNoPlayerSoaksTheWholeGame();

// Every swap must be legal: out is on the floor, in is on the bench and healthy.
function checkSwapsAreAlwaysLegal() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(63));
  let guard = 0;
  while (!sim.done) {
    ['home', 'away'].forEach(function (team) {
      const swaps = coach.decideSubstitutions(sim, team);
      const outs = {}, ins = {};
      swaps.forEach(function (s) {
        assert.ok(sim.onCourt[team].indexOf(s.out) !== -1, 'sub-out must be on the floor');
        assert.ok(sim.onCourt[team].indexOf(s.in) === -1, 'sub-in must not already be on the floor');
        assert.ok(sim.byId[s.in], 'sub-in must be on this roster');
        assert.ok(!outs[s.out], 'no player subbed out twice in one batch');
        assert.ok(!ins[s.in], 'no player subbed in twice in one batch');
        outs[s.out] = true; ins[s.in] = true;
      });
      sim.applySubstitutions(team, swaps);
    });
    sim.step();
    assert.ok(guard++ < 5000, 'must terminate');
  }
  console.log('checkSwapsAreAlwaysLegal: OK');
}
checkSwapsAreAlwaysLegal();

// With no bench available the coach must field five, not four.
function checkNeverFieldsFewerThanFive() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(64));
  Object.keys(sim.homeBox).forEach(function (id) { sim.homeBox[id].fouls = 6; });
  const swaps = coach.decideSubstitutions(sim, 'home');
  sim.applySubstitutions('home', swaps);
  assert.strictEqual(sim.onCourt.home.length, 5, 'must still field five with everyone in foul trouble');
  console.log('checkNeverFieldsFewerThanFive: OK');
}
checkNeverFieldsFewerThanFive();

// The coach calls a timeout when it is being run off the floor, and not
// otherwise.
function checkCoachTimeoutOnRun() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(65));
  sim.run = { team: 'away', points: 10 };
  assert.strictEqual(coach.decideTimeout(sim, 'home'), true, 'conceding a 10-0 run should draw a timeout');

  sim.run = { team: 'away', points: 4 };
  assert.strictEqual(coach.decideTimeout(sim, 'home'), false, 'a 4-0 run is not worth a timeout');

  sim.run = { team: 'away', points: 10 };
  sim.timeoutsLeft.home = 0;
  assert.strictEqual(coach.decideTimeout(sim, 'home'), false, 'cannot call a timeout with none left');
  console.log('checkCoachTimeoutOnRun: OK');
}
checkCoachTimeoutOnRun();

// A coach pulling a star mid-takeover would be maddening to watch, and would
// silently cap the takeover's measured value — which is the number the whole
// calibration is aimed at.
function checkNoSubDuringTakeover() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(63));
  const star = sim.onCourt.home[0];
  // Give him every ordinary reason to sit: gassed, and well past his minutes.
  sim.homeBox[star].energy = 0.10;
  Object.keys(sim.homeBox).forEach(function (id) {
    if (sim.onCourt.home.indexOf(id) === -1) sim.homeBox[id].energy = 1.0;
  });
  sim.secondsPlayed[star] = 42 * 60;

  sim.takeovers = { home: null, away: null };
  const without = coach.decideSubstitutions(sim, 'home');
  assert.ok(without.some(function (s) { return s.out === star; }),
    'fixture is wrong: an exhausted, over-minutes player should normally be subbed');

  sim.takeovers = { home: { playerId: star, ultimateKey: 'heatCheck', side: 'offense', kind: 'solo', left: 9 }, away: null };
  const during = coach.decideSubstitutions(sim, 'home');
  assert.ok(!during.some(function (s) { return s.out === star; }),
    'a player mid-takeover must not be benched');

  // But a foul-out is not negotiable.
  sim.homeBox[star].fouls = 6;
  const fouledOut = coach.decideSubstitutions(sim, 'home');
  assert.ok(fouledOut.some(function (s) { return s.out === star; }),
    'a fouled-out player leaves the floor regardless of his takeover');

  // And the exemption must not protect his TEAM-MATES.
  sim.homeBox[star].fouls = 0;
  const mate = sim.onCourt.home[1];
  sim.homeBox[mate].energy = 0.10;
  const others = coach.decideSubstitutions(sim, 'home');
  assert.ok(others.some(function (s) { return s.out === mate; }),
    'the exemption covers the takeover holder only, not the whole lineup');
  console.log('checkNoSubDuringTakeover: OK');
}
checkNoSubDuringTakeover();

console.log('All coach validations passed');
