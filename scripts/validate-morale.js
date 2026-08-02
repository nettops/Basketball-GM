const assert = require('assert');
const path = require('path');

function makePlayer(overrides) {
  return Object.assign({
    id: 'test-player', name: 'Test Player', teamId: 'BOS', overall: 70,
    contract: { salary: 5000000, yearsRemaining: 3, playerOption: false, teamOption: false },
    status: { morale: 70, fatigue: 0, injury: null }
  }, overrides || {});
}

function checkTickMoraleForTeamGame() {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'league.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'morale.js'))];
  const league = require(path.join(__dirname, '..', 'league.js'));
  const morale = require(path.join(__dirname, '..', 'morale.js'));

  const starter = league.getPlayerById('bos-jayson-tatum');
  const bench = league.getPlayerById('bos-jd-davison');
  starter.status.morale = 50;
  bench.status.morale = 50;

  const minutesByPlayerId = {};
  league.getTeamRoster('BOS').forEach(function (p) { minutesByPlayerId[p.id] = p.id === starter.id ? 38 : 4; });

  morale.tickMoraleForTeamGame('BOS', true, minutesByPlayerId);
  assert.ok(starter.status.morale > 50, 'a heavy-minutes starter on a winning team should gain morale');
  assert.ok(bench.status.morale < starter.status.morale, 'a buried bench player should trail the starter after the same win');

  const before = starter.status.morale;
  for (let i = 0; i < 500; i++) morale.tickMoraleForTeamGame('BOS', false, minutesByPlayerId);
  assert.ok(starter.status.morale >= 0 && starter.status.morale <= 100, 'morale must stay clamped to [0, 100]');
  assert.ok(starter.status.morale < before, 'repeated losses should drive morale down');

  console.log('checkTickMoraleForTeamGame: OK');
}

checkTickMoraleForTeamGame();

function checkMoraleTier() {
  const morale = require(path.join(__dirname, '..', 'morale.js'));
  assert.strictEqual(morale.moraleTier(80), 'happy');
  assert.strictEqual(morale.moraleTier(55), 'neutral');
  assert.strictEqual(morale.moraleTier(10), 'unhappy');
  console.log('checkMoraleTier: OK');
}

checkMoraleTier();

function checkMoraleFactors() {
  const morale = require(path.join(__dirname, '..', 'morale.js'));
  const player = makePlayer({
    overall: 80,
    contract: { salary: 5000000, yearsRemaining: 1, playerOption: false, teamOption: false },
    seasonStats: { gamesPlayed: 10, minutes: 100, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }
  });
  const badTeam = { record: { wins: 2, losses: 10 } };
  const reasons = morale.moraleFactors(player, badTeam);
  assert.ok(reasons.indexOf('Losing record') !== -1, 'a team well under .500 should surface as a reason');
  assert.ok(reasons.indexOf('Limited role') !== -1, '10 mpg for an 80 OVR player should surface as a reason');
  assert.ok(reasons.indexOf('Contract expiring') !== -1, 'yearsRemaining <= 1 should surface as a reason');

  const contentPlayer = makePlayer({ overall: 60, contract: { salary: 5000000, yearsRemaining: 4, playerOption: false, teamOption: false } });
  const goodTeam = { record: { wins: 10, losses: 2 } };
  assert.deepStrictEqual(morale.moraleFactors(contentPlayer, goodTeam), [], 'a settled player on a winning team should have no flagged reasons');

  console.log('checkMoraleFactors: OK');
}

checkMoraleFactors();

function checkFreeAgencyMoraleSensitivity() {
  const freeAgency = require(path.join(__dirname, '..', 'freeAgency.js'));
  const happy = makePlayer({ overall: 75, status: { morale: 95, fatigue: 0, injury: null } });
  const unhappy = makePlayer({ overall: 75, status: { morale: 5, fatigue: 0, injury: null } });
  const happyFair = freeAgency.estimateFairSalary(happy);
  const unhappyFair = freeAgency.estimateFairSalary(unhappy);
  assert.ok(happyFair > unhappyFair, 'a happy player should command a higher fair-market salary than an unhappy one at the same overall');

  const roster = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026;
  const player = roster.find(function (p) { return p.teamId === null; }) || roster[0];
  const beforeMorale = player.status.morale;
  freeAgency.signPlayer(player, { teamId: 'BOS', salary: 5000000, yearsRemaining: 2 });
  assert.ok(player.status.morale >= beforeMorale, 'signing a new contract should never lower morale');

  console.log('checkFreeAgencyMoraleSensitivity: OK');
}

checkFreeAgencyMoraleSensitivity();

console.log('All morale validations passed');
