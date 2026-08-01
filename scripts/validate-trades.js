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
console.log('All trade validations passed');
