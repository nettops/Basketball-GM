// The rebound column, split.
//
// `rebounds` stays the TOTAL. oreb and dreb sit beside it and must add up to
// it exactly, in both engines — the same invariant the shot zones already
// carry (insideFga + midFga + tpa === fga), and for the same reason: the
// moment the parts stop summing to the whole, a box score shows a player with
// 11 rebounds, 4 offensive and 6 defensive, and there is no way to tell which
// number is the wrong one.
//
// Both engines are checked because a season can be simmed on either, and a
// stat that means one thing on 'possession' and another on 'boxscore' is worse
// than no stat.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const traits = req('traits.js');
req('scouting.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
req('simEngine.js');
const boxEngine = req('simEngineBoxScore.js');
req('simEnginePossession.js');
req('gameCoach.js');
const gameSim = req('gameSim.js');
const league = req('league.js');
const { TEAMS } = req('teams.js');

// gameSim.simulateGame IS the possession engine — it does not route through
// getActiveEngine, so handing it { simEngine: 'boxscore' } runs the possession
// engine and silently reports its numbers under the other engine's name. The
// first version of this file did exactly that and produced two identical
// figures to the decimal place, which is what gave it away. Each engine is
// reached through its own entry point here.
const ENGINES = {
  possession: function (home, away, seed) {
    return gameSim.simulateGame(home, away, makeRng(seed), { settings: { simEngine: 'possession' } });
  },
  boxscore: function (home, away, seed) {
    return boxEngine.simulateGame(home, away, makeRng(seed), {});
  }
};

function everyLine(engine, games) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const home = TEAMS[g % TEAMS.length].id;
    const away = TEAMS[(g * 11 + 4) % TEAMS.length].id;
    if (home === away) continue;
    const result = ENGINES[engine](home, away, 31337 + g);
    Object.keys(result.boxScore).forEach(function (id) { out.push(result.boxScore[id]); });
  }
  return out;
}

function checkThePartsSumToTheWhole(engine) {
  const lines = everyLine(engine, 8);
  assert.ok(lines.length > 50, engine + ': too few stat lines to judge');
  lines.forEach(function (s) {
    assert.notStrictEqual(s.oreb, undefined, engine + ': a stat line has no oreb at all');
    assert.notStrictEqual(s.dreb, undefined, engine + ': a stat line has no dreb at all');
    assert.strictEqual(s.oreb + s.dreb, s.rebounds,
      engine + ': ' + s.oreb + ' offensive + ' + s.dreb + ' defensive does not make ' +
      s.rebounds + ' rebounds');
    assert.ok(s.oreb >= 0 && s.dreb >= 0, engine + ': a negative rebound count');
  });
  console.log('checkThePartsSumToTheWhole: OK (' + engine + ', ' + lines.length + ' lines)');
}
checkThePartsSumToTheWhole('possession');
checkThePartsSumToTheWhole('boxscore');

// A split that puts the same share on everybody is a column of decoration. The
// engines must actually separate a player who lives on the offensive glass
// from one who does not.
function checkTheSplitDiscriminates(engine) {
  const lines = everyLine(engine, 12).filter(function (s) { return s.rebounds >= 4; });
  const shares = lines.map(function (s) { return s.oreb / s.rebounds; });
  const lo = Math.min.apply(null, shares), hi = Math.max.apply(null, shares);
  assert.ok(hi - lo > 0.3,
    engine + ': every rebounder has nearly the same offensive share (' +
    lo.toFixed(2) + '-' + hi.toFixed(2) + ') — the split is not reading the player');
  console.log('checkTheSplitDiscriminates: OK (' + engine + ', offensive share ' +
    lo.toFixed(2) + '-' + hi.toFixed(2) + ')');
}
checkTheSplitDiscriminates('possession');
checkTheSplitDiscriminates('boxscore');

// The two engines have to agree about what a rebound column MEANS, or a season
// simmed on one reads differently from a season simmed on the other.
function checkBothEnginesAgreeOnTheLeagueShare() {
  const shares = ['possession', 'boxscore'].map(function (engine) {
    const lines = everyLine(engine, 10);
    let oreb = 0, total = 0;
    lines.forEach(function (s) { oreb += s.oreb; total += s.rebounds; });
    return { engine: engine, share: oreb / total };
  });
  shares.forEach(function (s) {
    assert.ok(s.share > 0.18 && s.share < 0.34,
      s.engine + ' puts ' + (100 * s.share).toFixed(1) + '% of boards at the offensive end — ' +
      'the real league runs about 26%');
  });
  assert.ok(Math.abs(shares[0].share - shares[1].share) < 0.05,
    'the engines disagree: ' + shares.map(function (s) {
      return s.engine + ' ' + (100 * s.share).toFixed(1) + '%';
    }).join(' vs '));
  console.log('checkBothEnginesAgreeOnTheLeagueShare: OK (' + shares.map(function (s) {
    return s.engine + ' ' + (100 * s.share).toFixed(1) + '%';
  }).join(', ') + ')');
}
checkBothEnginesAgreeOnTheLeagueShare();

// The split has to survive the trip from one game to a season average, or it
// only exists in the box score. SEASON_STAT_KEYS is what carries it.
function checkASeasonAverageCarriesTheSplit() {
  assert.ok(league.SEASON_STAT_KEYS.indexOf('oreb') !== -1 &&
    league.SEASON_STAT_KEYS.indexOf('dreb') !== -1,
    'oreb/dreb are not in SEASON_STAT_KEYS, so no season or career total will ever hold them');

  // A save written before the split reaches getPlayerAverages with the fields
  // simply absent — that must read as zero, not NaN on a screen.
  const older = { gamesPlayed: 10, points: 100, rebounds: 80, assists: 30, steals: 10, blocks: 5,
    fgm: 40, fga: 90, tpm: 10, tpa: 30, ftm: 10, fta: 12, minutes: 300, oppFga: 50, oppFgm: 22,
    insideFga: 30, insideFgm: 18, midFga: 30, midFgm: 12, plusMinus: 20 };
  const avg = league.getPlayerAverages({ seasonStats: older });
  assert.strictEqual(avg.orpg, 0, 'a pre-split save must report 0 offensive boards, not NaN');
  assert.strictEqual(avg.drpg, 0, 'and 0 defensive boards');
  assert.ok(avg.rpg > 0, 'while its rebound total still reads');
  console.log('checkASeasonAverageCarriesTheSplit: OK');
}
checkASeasonAverageCarriesTheSplit();

console.log('All rebound validations passed');
