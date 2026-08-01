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

function checkEvaluateTeamLeg() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

  // A star-for-scrub swap should be rejected for the team giving up the star.
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const star = bosRoster.slice().sort(function (a, b) { return b.overall - a.overall; })[0];
  const scrub = bosRoster.slice().sort(function (a, b) { return a.overall - b.overall; })[0];

  const badLeg = evaluatorModule.evaluateTeamLeg('BOS', [star.id], [scrub.id]);
  assert.strictEqual(badLeg.accepted, false, 'giving up a star for a scrub should be rejected');
  assert.ok(badLeg.suggestion, 'a rejected leg should include a suggestion');

  // A player traded for themself is a trivial exact value/salary match.
  const sortedByOverall = bosRoster.slice().sort(function (a, b) { return b.overall - a.overall; });
  const mid1 = sortedByOverall[Math.floor(sortedByOverall.length / 2)];
  const evenLeg = evaluatorModule.evaluateTeamLeg('BOS', [mid1.id], [mid1.id]);
  assert.strictEqual(evenLeg.accepted, true, 'a player traded for themself must be an exact value/salary match');

  console.log('checkEvaluateTeamLeg: OK');
}

checkEvaluateTeamLeg();

function checkProposeTrade() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  // 2-team trade: plumbing runs end to end without throwing, and a rejected
  // trade must not mutate any player.
  const gswRoster = leagueModule.getTeamRoster('GSW');
  const lacRoster = leagueModule.getTeamRoster('LAC');
  const gswPlayer = gswRoster[gswRoster.length - 1];
  const lacPlayer = lacRoster[lacRoster.length - 1];

  const twoTeamProposal = {
    participants: ['GSW', 'LAC'],
    assignments: [
      { playerId: gswPlayer.id, fromTeamId: 'GSW', toTeamId: 'LAC' },
      { playerId: lacPlayer.id, fromTeamId: 'LAC', toTeamId: 'GSW' }
    ]
  };
  const result = tradeModule.proposeTrade(twoTeamProposal, 'GSW');
  assert.strictEqual(typeof result.accepted, 'boolean');
  if (!result.accepted) {
    assert.strictEqual(gswPlayer.teamId, 'GSW', 'a rejected trade must not move any player');
    assert.strictEqual(lacPlayer.teamId, 'LAC', 'a rejected trade must not move any player');
  } else {
    assert.strictEqual(gswPlayer.teamId, 'LAC');
    assert.strictEqual(lacPlayer.teamId, 'GSW');
    // restore state for later checks
    gswPlayer.teamId = 'GSW';
    lacPlayer.teamId = 'LAC';
  }

  // Roster-size guard: sending most of a roster away with nothing back must
  // never be allowed to push a team below 12.
  const smallTeam = 'CHA';
  const chaRoster = leagueModule.getTeamRoster(smallTeam);
  const oneWayProposal = {
    participants: [smallTeam, 'LAL'],
    assignments: chaRoster.slice(0, chaRoster.length - 11).map(function (p) {
      return { playerId: p.id, fromTeamId: smallTeam, toTeamId: 'LAL' };
    })
  };
  const rosterErrors = tradeModule.validateRosterSizes(oneWayProposal);
  assert.ok(rosterErrors.length > 0, 'sending most of a roster away with nothing back should fail the roster-size check');

  // 3-team trade: plumbing must handle 3 participants without special-casing.
  const denPlayer = leagueModule.getTeamRoster('DEN')[leagueModule.getTeamRoster('DEN').length - 1];
  const minPlayer = leagueModule.getTeamRoster('MIN')[leagueModule.getTeamRoster('MIN').length - 1];
  const okcPlayer = leagueModule.getTeamRoster('OKC')[leagueModule.getTeamRoster('OKC').length - 1];
  const threeTeamProposal = {
    participants: ['DEN', 'MIN', 'OKC'],
    assignments: [
      { playerId: denPlayer.id, fromTeamId: 'DEN', toTeamId: 'MIN' },
      { playerId: minPlayer.id, fromTeamId: 'MIN', toTeamId: 'OKC' },
      { playerId: okcPlayer.id, fromTeamId: 'OKC', toTeamId: 'DEN' }
    ]
  };
  const threeTeamResult = tradeModule.proposeTrade(threeTeamProposal, 'DEN');
  assert.strictEqual(typeof threeTeamResult.accepted, 'boolean');
  assert.strictEqual(Object.keys(threeTeamResult.legs).length, 3, 'a 3-team trade should evaluate all 3 legs');

  console.log('checkProposeTrade: OK');
}

checkProposeTrade();
console.log('All trade validations passed');
