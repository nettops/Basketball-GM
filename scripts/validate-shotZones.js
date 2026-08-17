// Where the shots came from.
//
// pickShotZone has always classified every attempt as inside/mid/three; the
// answer was used four times inside a possession and then dropped. These
// checks pin down that the four new box-line fields count the same shots the
// engine actually resolved, in every branch it can resolve them through.
//
// The invariant does the heavy lifting:
//   insideFga + midFga + tpa === fga
// A miscount in any single branch breaks it. That is why mid-range is stored
// rather than derived by subtraction — a subtraction cannot disagree with
// itself, so it cannot catch anything.
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
const boxEngine = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));

// Every seed is explicit. A validator that calls a seeded function without its
// seed gets one roll for the whole league and reports a probabilistic rule as
// an all-or-nothing one.
const SEEDS = [11, 404, 1987, 60613, 777001];

function assertLineAddsUp(line, who) {
  assert.strictEqual(line.insideFga + line.midFga + line.tpa, line.fga,
    who + ': zone attempts must account for every field goal attempt');
  assert.strictEqual(line.insideFgm + line.midFgm + line.tpm, line.fgm,
    who + ': zone makes must account for every field goal made');
  assert.ok(line.insideFgm <= line.insideFga, who + ': cannot make more inside than taken');
  assert.ok(line.midFgm <= line.midFga, who + ': cannot make more mid-range than taken');
  assert.ok(line.tpm <= line.tpa, who + ': cannot make more threes than taken');
}

function checkEveryAttemptLandsInAZone() {
  let totalFga = 0;
  SEEDS.forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[0].id, TEAMS[1].id, makeRng(seed));
    Object.keys(result.boxScore).forEach(function (id) {
      assertLineAddsUp(result.boxScore[id], 'seed ' + seed + ' player ' + id);
      totalFga += result.boxScore[id].fga;
    });
  });
  assert.ok(totalFga > 500, 'sanity: these games should contain real shot volume, got ' + totalFga);
  console.log('checkEveryAttemptLandsInAZone: OK (' + totalFga + ' attempts)');
}

// The branch a careless test misses. A blocked shot increments fga and never
// reaches the make path, so if only the resolved-shot site had been updated
// every block would be an attempt from nowhere and the invariant would break
// by exactly the number of blocks.
function checkBlockedShotsKeepTheirZone() {
  let blocks = 0;
  SEEDS.forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[2].id, TEAMS[3].id, makeRng(seed));
    Object.keys(result.boxScore).forEach(function (id) {
      blocks += result.boxScore[id].blocks;
      assertLineAddsUp(result.boxScore[id], 'seed ' + seed + ' player ' + id);
    });
  });
  assert.ok(blocks > 0, 'these games must actually contain blocks or this check proves nothing');
  console.log('checkBlockedShotsKeepTheirZone: OK (' + blocks + ' blocks covered)');
}

// A shot chart that is all one zone means the tendencies are not being read.
function checkAllThreeZonesGetUsed() {
  const totals = { inside: 0, mid: 0, three: 0 };
  SEEDS.forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[5].id, TEAMS[6].id, makeRng(seed));
    Object.keys(result.boxScore).forEach(function (id) {
      const l = result.boxScore[id];
      totals.inside += l.insideFga;
      totals.mid += l.midFga;
      totals.three += l.tpa;
    });
  });
  assert.ok(totals.inside > 0 && totals.mid > 0 && totals.three > 0,
    'all three zones should see attempts: ' + JSON.stringify(totals));
  const sum = totals.inside + totals.mid + totals.three;
  const threeShare = totals.three / sum;
  // Wide band on purpose. The narrow calibration lives in
  // scripts/probe-shotZones.js, which measures a season rather than five
  // games; this only catches a zone wired to the wrong counter.
  assert.ok(threeShare > 0.15 && threeShare < 0.50,
    'three-point share of attempts looks wrong: ' + threeShare.toFixed(3));
  console.log('checkAllThreeZonesGetUsed: OK (' + JSON.stringify(totals) + ')');
}

// The box-score engine is selectable in settings (ui/settings.js). If it does
// not answer the same question, switching engines silently produces a season
// of empty shot charts.
function checkBoxScoreEngineSplitsToo() {
  const totals = { inside: 0, mid: 0, three: 0 };
  let checked = 0;
  SEEDS.forEach(function (seed) {
    const result = boxEngine.simulateGame(TEAMS[0].id, TEAMS[1].id, makeRng(seed));
    Object.keys(result.boxScore).forEach(function (id) {
      const l = result.boxScore[id];
      assertLineAddsUp(l, 'boxscore engine seed ' + seed + ' player ' + id);
      totals.inside += l.insideFga;
      totals.mid += l.midFga;
      totals.three += l.tpa;
      checked += 1;
    });
  });
  assert.ok(checked > 0, 'sanity: the box-score engine produced no lines');
  assert.ok(totals.inside > 0 && totals.mid > 0 && totals.three > 0,
    'the box-score engine must fill all three zones too: ' + JSON.stringify(totals));
  console.log('checkBoxScoreEngineSplitsToo: OK (' + JSON.stringify(totals) + ')');
}

// The new keys have to survive the trip from one game to a season line, which
// is what puts them on a career page. This is the payoff for adding them to
// SEASON_STAT_KEYS rather than accumulating them by hand.
function checkZonesReachSeasonStats() {
  ['insideFga', 'insideFgm', 'midFga', 'midFgm', 'plusMinus'].forEach(function (k) {
    assert.ok(leagueModule.SEASON_STAT_KEYS.indexOf(k) !== -1,
      k + ' must be in SEASON_STAT_KEYS or it dies with the game');
  });

  const player = leagueModule.getTeamRoster(TEAMS[7].id)[0];
  delete player.seasonStats;
  leagueModule.accumulateSeasonStats(player.id, {
    points: 20, fga: 15, fgm: 8, tpa: 5, tpm: 2,
    insideFga: 6, insideFgm: 4, midFga: 4, midFgm: 2, plusMinus: 11
  });
  leagueModule.accumulateSeasonStats(player.id, {
    points: 10, fga: 9, fgm: 4, tpa: 3, tpm: 1,
    insideFga: 4, insideFgm: 2, midFga: 2, midFgm: 1, plusMinus: -3
  });
  const s = player.seasonStats;
  assert.strictEqual(s.insideFga, 10, 'inside attempts should accumulate across games');
  assert.strictEqual(s.midFgm, 3, 'mid-range makes should accumulate across games');
  assert.strictEqual(s.plusMinus, 8, 'plus/minus should accumulate, and may go negative');
  assert.strictEqual(s.insideFga + s.midFga + s.tpa, s.fga,
    'the invariant has to hold at season level too, not just per game');

  const avg = leagueModule.getPlayerAverages(player);
  assert.ok(Math.abs(avg.insideFgPct - 0.6) < 1e-9, 'inside FG% should be makes over attempts');
  assert.ok(Math.abs(avg.threeRate - (8 / 24)) < 1e-9, 'three rate should be a share of all attempts');
  console.log('checkZonesReachSeasonStats: OK');
}

// getPlayerAverages is hand-written rather than derived from SEASON_STAT_KEYS,
// so a player who has taken nothing from a zone must not divide by it.
function checkEmptyZonesDoNotDivideByZero() {
  const player = leagueModule.getTeamRoster(TEAMS[8].id)[0];
  delete player.seasonStats;
  leagueModule.accumulateSeasonStats(player.id, { points: 0, minutes: 4 });
  const avg = leagueModule.getPlayerAverages(player);
  ['insideFgPct', 'midFgPct', 'insideRate', 'midRate', 'threeRate', 'dfgPct'].forEach(function (k) {
    assert.strictEqual(avg[k], 0, k + ' should be 0 for a player with no attempts, not NaN');
  });
  console.log('checkEmptyZonesDoNotDivideByZero: OK');
}

checkEveryAttemptLandsInAZone();
checkBlockedShotsKeepTheirZone();
checkAllThreeZonesGetUsed();
checkBoxScoreEngineSplitsToo();
checkZonesReachSeasonStats();
checkEmptyZonesDoNotDivideByZero();

console.log('All shotZones validations passed');
