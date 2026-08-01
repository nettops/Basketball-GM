const assert = require('assert');
const path = require('path');

const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

function checkWaivePlayer() {
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const before = leagueModule.getTeamRoster('BOS').length;
  const target = leagueModule.getTeamRoster('BOS')[before - 1]; // last player, arbitrary pick

  const result = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(result.success, true);
  assert.strictEqual(target.teamId, null);
  assert.strictEqual(leagueModule.getTeamRoster('BOS').length, before - 1);
  assert.ok(rosterMovesModule.getFreeAgents().some(function (p) { return p.id === target.id; }));

  const alreadyFa = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(alreadyFa.success, false);

  // restore state for later checks in this file
  target.teamId = 'BOS';

  console.log('checkWaivePlayer: OK');
}

checkWaivePlayer();

function checkBasePlayerValue() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

  assert.ok(evaluatorModule.youthFactor(20) > evaluatorModule.youthFactor(33), 'younger players should weight potential more');
  assert.ok(evaluatorModule.youthFactor(34) <= 0.1);

  assert.strictEqual(evaluatorModule.contractBurden(1000000, 60), 0, 'a below-market salary should have no burden');
  assert.ok(evaluatorModule.contractBurden(50000000, 60) > 0, 'a max contract on a 60-overall should carry burden');

  const star = { overall: 95, potential: 96, age: 25, contract: { salary: 30000000 } };
  const bustContract = { overall: 60, potential: 61, age: 30, contract: { salary: 45000000 } };
  assert.ok(evaluatorModule.basePlayerValue(star) > evaluatorModule.basePlayerValue(bustContract), 'a star should be worth clearly more than an overpaid low-overall player');

  console.log('checkBasePlayerValue: OK');
}

checkBasePlayerValue();

function checkAdjustedPlayerValue() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
  const rebuildingTeam = { id: 'BKN', timeline: 'rebuilding' };

  const youngPlayer = { overall: 78, potential: 88, age: 22, position: 'SF', contract: { salary: 6000000 } };
  const oldVeteran = { overall: 78, potential: 78, age: 33, position: 'SF', contract: { salary: 6000000 } };

  assert.ok(
    evaluatorModule.adjustedPlayerValue(youngPlayer, rebuildingTeam) > evaluatorModule.adjustedPlayerValue(oldVeteran, rebuildingTeam),
    'a rebuilding team should value the young player over an equal-overall veteran'
  );

  const centerHeavyTeam = teamsModule.getTeamById('DEN'); // real roster, has real centers
  const needMultiplierForGuard = evaluatorModule.needMultiplier('PG', centerHeavyTeam);
  assert.ok(typeof needMultiplierForGuard === 'number' && needMultiplierForGuard > 0);

  console.log('checkAdjustedPlayerValue: OK');
}

checkAdjustedPlayerValue();
console.log('All trade validations passed');
