const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers distributeInt as a side effect (unused here directly, but keeps parity with how the module is loaded in-browser)
const aswModule = require(path.join(__dirname, '..', 'allStarWeekend.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

function givePlayerASeason(player, gamesPlayed, ppg) {
  player.seasonStats = {
    gamesPlayed: gamesPlayed, points: Math.round(ppg * gamesPlayed), rebounds: gamesPlayed * 5, assists: gamesPlayed * 4,
    steals: gamesPlayed, blocks: gamesPlayed, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: gamesPlayed * 30
  };
}

function checkSelectAllStars() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  const allEasternPlayers = eastern.reduce(function (all, t) { return all.concat(leagueModule.getTeamRoster(t.id)); }, []);
  allEasternPlayers.forEach(function (p, i) { givePlayerASeason(p, 25, 10 + (i % 5)); });

  // Make a handful of players clear standouts so selection is deterministic.
  const stars = allEasternPlayers.slice(0, 12);
  stars.forEach(function (p, i) { givePlayerASeason(p, 30, 30 - i); });

  const selection = aswModule.selectAllStars('Eastern');
  assert.strictEqual(selection.starters.length, 5);
  assert.strictEqual(selection.reserves.length, 7);
  const selectedIds = selection.starters.concat(selection.reserves).map(function (p) { return p.id; });
  stars.forEach(function (p) { assert.ok(selectedIds.indexOf(p.id) !== -1, p.name + ' should have been selected as a standout'); });

  // Starters should outrank reserves by allStarValue.
  const minStarterValue = Math.min.apply(null, selection.starters.map(aswModule.allStarValue));
  const maxReserveValue = Math.max.apply(null, selection.reserves.map(aswModule.allStarValue));
  assert.ok(minStarterValue >= maxReserveValue, 'every starter should rank at or above every reserve');

  console.log('checkSelectAllStars: OK');
}

checkSelectAllStars();

function checkSimulateAllStarGame() {
  const eastRoster = leagueModule.getTeamRoster('BOS').slice(0, 5).concat(leagueModule.getTeamRoster('MIA').slice(0, 5));
  const westRoster = leagueModule.getTeamRoster('LAL').slice(0, 5).concat(leagueModule.getTeamRoster('DEN').slice(0, 5));
  eastRoster.concat(westRoster).forEach(function (p) { givePlayerASeason(p, 30, 20); });

  const rng = makeRng(50);
  const result = aswModule.simulateAllStarGame(eastRoster, westRoster, rng);

  assert.ok(result.eastScore > 100 && result.westScore > 100, 'an exhibition game should be high-scoring, got ' + result.eastScore + '/' + result.westScore);
  assert.ok(result.mvpPlayerId, 'a game MVP should be selected');
  const totalEastPoints = Object.values(result.eastBox).reduce(function (s, l) { return s + l.points; }, 0);
  assert.strictEqual(totalEastPoints, result.eastScore, 'individual box score points should sum to the team total');

  console.log('checkSimulateAllStarGame: OK (' + result.eastScore + '-' + result.westScore + ')');
}

checkSimulateAllStarGame();

function checkThreePointContest() {
  // Any two real players will do — the contest reads threePoint, which the
  // test overrides on both. Taken from live rosters rather than by id: the
  // 2K27 import moves players between teams every time it reruns, and a
  // hardcoded id ('lal-lebron-james') died exactly that way.
  const base1 = leagueModule.getTeamRoster('BOS')[0];
  const base2 = leagueModule.getTeamRoster('LAL')[0];
  const sharpshooter = Object.assign({}, base1, { attributes: Object.assign({}, base1.attributes, { threePoint: 95 }) });
  const bricklayer = Object.assign({}, base2, { attributes: Object.assign({}, base2.attributes, { threePoint: 20 }) });

  const rng = makeRng(60);
  const result = aswModule.simulateThreePointContest([sharpshooter, bricklayer], rng);

  assert.strictEqual(result.results.length, 2);
  assert.ok(result.winnerId);
  result.results.forEach(function (r) { assert.ok(r.bestRound >= 0 && r.bestRound <= 30, 'a 3pt round score should be in the possible [0,30] range'); });

  console.log('checkThreePointContest: OK (winner=' + result.winnerId + ')');
}

checkThreePointContest();

function checkDunkContest() {
  const contestants = leagueModule.getTeamRoster('LAC').slice(0, 4);
  const rng = makeRng(70);
  const result = aswModule.simulateDunkContest(contestants, rng);

  assert.strictEqual(result.results.length, 4);
  assert.ok(result.winnerId);
  result.results.forEach(function (r) { assert.ok(r.bestDunk >= 20 && r.bestDunk <= 50, 'a dunk score should be in the judged [20,50] range'); });

  console.log('checkDunkContest: OK (winner=' + result.winnerId + ')');
}

checkDunkContest();

console.log('All All-Star Weekend validations passed');
