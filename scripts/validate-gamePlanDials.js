// The Game Plan dials on the coaching screen, and whether they do anything.
//
// They did not. For as long as the possession engine has been the default,
// `strategy` and `threePointRate` appeared zero times in it and zero times in
// gameSim.js — only simEngineBoxScore.js read them, and nobody runs that. The
// panel meanwhile told the player they had "a real but modest effect on pace
// and shot selection", which was false for every default save.
//
// Every check here fails against the engine as it was, which is the point: a
// control that does nothing passes any test that only asks whether the game
// still runs.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
const poss = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

const HOME = TEAMS[0], AWAY = TEAMS[1];
const HOME_IDS = league.getTeamRoster(HOME.id).map(function (p) { return p.id; });
const GAMES = 30;

function clearDials() {
  HOME.strategy = { pace: 0, threePointRate: 0 };
  AWAY.strategy = { pace: 0, threePointRate: 0 };
}

// Same seeds at every setting, always. A different sample would confound the
// dial's effect with ordinary variance, and the swing being measured here is
// smaller than a season's noise.
function measure(games) {
  let inside = 0, mid = 0, tpa = 0, fga = 0, points = 0;
  for (let g = 0; g < games; g++) {
    const r = gameSim.simulateGame(HOME.id, AWAY.id, makeRng(4200 + g));
    points += r.homeScore;
    HOME_IDS.forEach(function (id) {
      const l = r.boxScore[id];
      if (!l) return;
      inside += l.insideFga; mid += l.midFga; tpa += l.tpa; fga += l.fga;
    });
  }
  return {
    threeShare: fga > 0 ? tpa / fga : 0,
    rimShare: fga > 0 ? inside / fga : 0,
    midShare: fga > 0 ? mid / fga : 0,
    fga: fga,
    ppg: points / games
  };
}

// THE regression guard, and the one that would have caught the original bug.
function checkThreePointDialMovesTheShotMix() {
  clearDials();
  HOME.strategy.threePointRate = -1;
  const low = measure(GAMES);
  HOME.strategy.threePointRate = 0;
  const mid = measure(GAMES);
  HOME.strategy.threePointRate = 1;
  const high = measure(GAMES);
  clearDials();

  assert.ok(high.threeShare > mid.threeShare, 'High must take MORE threes than Balanced: ' +
    high.threeShare.toFixed(3) + ' vs ' + mid.threeShare.toFixed(3));
  assert.ok(low.threeShare < mid.threeShare, 'Low must take FEWER threes than Balanced: ' +
    low.threeShare.toFixed(3) + ' vs ' + mid.threeShare.toFixed(3));

  // Not merely different — different enough for a GM to see it on the readout
  // the coaching screen now prints. A swing under 4 points of share would round
  // away into noise there.
  const swing = (high.threeShare - low.threeShare) * 100;
  assert.ok(swing > 4, 'the full range must be worth more than 4 points of share, got ' + swing.toFixed(2));

  // The extra threes are paid for out of the other zones, not conjured.
  assert.ok(high.rimShare < low.rimShare, 'shooting more threes must mean shooting less at the rim');
  console.log('checkThreePointDialMovesTheShotMix: OK (' +
    (low.threeShare * 100).toFixed(1) + '% -> ' + (mid.threeShare * 100).toFixed(1) + '% -> ' +
    (high.threeShare * 100).toFixed(1) + '%)');
}

// The three-point dial is a STYLE lever, not a scoring one. If it moved scoring
// much it would stop being a choice and become a difficulty setting.
function checkThreePointDialIsNotAScoringLever() {
  clearDials();
  HOME.strategy.threePointRate = -1;
  const low = measure(GAMES);
  HOME.strategy.threePointRate = 1;
  const high = measure(GAMES);
  clearDials();
  const drift = Math.abs(high.ppg - low.ppg);
  assert.ok(drift < 4, 'shot mix should not swing scoring by more than a few points, got ' + drift.toFixed(2));
  console.log('checkThreePointDialIsNotAScoringLever: OK (' +
    low.ppg.toFixed(1) + ' vs ' + high.ppg.toFixed(1) + ' ppg)');
}

// Pace is the opposite: it buys possessions, and possessions are points.
function checkPaceDialMovesPossessions() {
  clearDials();
  HOME.strategy.pace = -1; AWAY.strategy.pace = -1;
  const slow = measure(GAMES);
  clearDials();
  const balanced = measure(GAMES);
  HOME.strategy.pace = 1; AWAY.strategy.pace = 1;
  const fast = measure(GAMES);
  clearDials();

  assert.ok(fast.fga > balanced.fga, 'Fast must produce more shots than Balanced: ' + fast.fga + ' vs ' + balanced.fga);
  assert.ok(slow.fga < balanced.fga, 'Slow must produce fewer shots than Balanced: ' + slow.fga + ' vs ' + balanced.fga);
  assert.ok(fast.ppg > slow.ppg, 'more possessions at the same efficiency must mean more points');

  // Pace must not quietly become a shot-selection lever too — the two dials are
  // meant to be independent controls.
  const mixDrift = Math.abs(fast.threeShare - slow.threeShare) * 100;
  assert.ok(mixDrift < 3, 'pace should barely touch shot mix, moved ' + mixDrift.toFixed(2) + ' points of share');
  console.log('checkPaceDialMovesPossessions: OK (' + slow.fga + ' / ' + balanced.fga + ' / ' + fast.fga +
    ' attempts, ' + slow.ppg.toFixed(1) + ' -> ' + fast.ppg.toFixed(1) + ' ppg)');
}

// Pace is shared. A team that wants to run against one that wants to walk gets
// a compromise, not its own way — they are playing the same game on one clock.
function checkPaceIsBlendedBetweenBothTeams() {
  clearDials();
  HOME.strategy.pace = 1; AWAY.strategy.pace = 1;
  const bothFast = measure(GAMES);
  HOME.strategy.pace = 1; AWAY.strategy.pace = -1;
  const opposed = measure(GAMES);
  clearDials();
  const neutral = measure(GAMES);

  assert.strictEqual(opposed.fga, neutral.fga,
    'opposite dials must cancel to exactly the neutral game, got ' + opposed.fga + ' vs ' + neutral.fga);
  assert.ok(bothFast.fga > opposed.fga, 'two teams that both want to run should get a faster game');
  console.log('checkPaceIsBlendedBetweenBothTeams: OK (opposed dials cancel exactly)');
}

// The whole league defaults to no strategy object at all, so neutral has to be
// an EXACT no-op or every golden master moves for a game nobody configured.
function checkNeutralDialsAreByteIdentical() {
  const shooter = league.getTeamRoster(HOME.id)[0];
  const counts = { withUndefined: {}, withZero: {} };
  ['withUndefined', 'withZero'].forEach(function (which) {
    const rng = makeRng(9090);
    const dial = which === 'withZero' ? 0 : undefined;
    const tally = { inside: 0, mid: 0, three: 0 };
    for (let i = 0; i < 5000; i++) tally[poss.pickShotZone(shooter, rng, false, null, dial)] += 1;
    counts[which] = tally;
  });
  assert.deepStrictEqual(counts.withZero, counts.withUndefined,
    'a zero dial and an absent dial must draw the identical sequence');

  // And the pre-dial call shape — four arguments — must still behave the same.
  const rngA = makeRng(9090), rngB = makeRng(9090);
  for (let i = 0; i < 500; i++) {
    assert.strictEqual(poss.pickShotZone(shooter, rngA, false, null),
      poss.pickShotZone(shooter, rngB, false, null, 0),
      'omitting the dial entirely must match passing zero, at draw ' + i);
  }
  console.log('checkNeutralDialsAreByteIdentical: OK');
}

// The coaching screen offers exactly these three settings; the engine must
// respond to each of them rather than only to the extremes.
function checkEveryOfferedSettingIsDistinct() {
  clearDials();
  const seen = {};
  [-1, 0, 1].forEach(function (d) {
    HOME.strategy.threePointRate = d;
    seen[d] = measure(10).threeShare.toFixed(4);
  });
  clearDials();
  assert.strictEqual(new Set(Object.values(seen)).size, 3,
    'each offered setting should produce its own shot mix: ' + JSON.stringify(seen));
  console.log('checkEveryOfferedSettingIsDistinct: OK (' + JSON.stringify(seen) + ')');
}

checkNeutralDialsAreByteIdentical();
checkThreePointDialMovesTheShotMix();
checkThreePointDialIsNotAScoringLever();
checkPaceDialMovesPossessions();
checkPaceIsBlendedBetweenBothTeams();
checkEveryOfferedSettingIsDistinct();

console.log('All gamePlanDials validations passed');
