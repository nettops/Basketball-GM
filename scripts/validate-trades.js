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

  const star = { overall: 95, rawOverall: 95, potential: 96, age: 25, contract: { salary: 30000000 } };
  const bustContract = { overall: 60, rawOverall: 60, potential: 61, age: 30, contract: { salary: 45000000 } };
  assert.ok(evaluatorModule.basePlayerValue(star) > evaluatorModule.basePlayerValue(bustContract), 'a star should be worth clearly more than an overpaid low-overall player');

  console.log('checkBasePlayerValue: OK');
}

checkBasePlayerValue();

function checkAdjustedPlayerValue() {
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
  const rebuildingTeam = { id: 'BKN', timeline: 'rebuilding' };

  const youngPlayer = { overall: 78, rawOverall: 78, potential: 88, age: 22, position: 'SF', contract: { salary: 6000000 } };
  const oldVeteran = { overall: 78, rawOverall: 78, potential: 78, age: 33, position: 'SF', contract: { salary: 6000000 } };

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

function checkPickTrading() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));

  const proposal = {
    participants: ['SAS', 'LAL'],
    assignments: [],
    pickAssignments: [
      { round: 1, fromTeamId: 'SAS', toTeamId: 'LAL' }
    ]
  };

  const beforeOwner = tradeModule.findPick('SAS', 1).currentOwnerId;
  assert.strictEqual(beforeOwner, 'SAS');

  const result = tradeModule.proposeTrade(proposal, 'LAL');
  assert.strictEqual(typeof result.accepted, 'boolean');

  if (result.accepted) {
    assert.strictEqual(tradeModule.findPick('SAS', 1), undefined, 'the pick is no longer owned by SAS once traded');
    const nowOwnedByLal = teamsModule.getTeamById('SAS').draftPicks.find(function (p) { return p.round === 1; });
    assert.strictEqual(nowOwnedByLal.currentOwnerId, 'LAL');
    // restore state for any later checks in this file
    nowOwnedByLal.currentOwnerId = 'SAS';
  }

  // Existing 3-argument evaluateTeamLeg calls (Phase 3 style) must still work unchanged.
  const evaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const anyPlayer = bosRoster[0];
  const backwardCompatLeg = evaluatorModule.evaluateTeamLeg('BOS', [anyPlayer.id], [anyPlayer.id]);
  assert.strictEqual(backwardCompatLeg.accepted, true, 'a player traded for themself with no pick args must still be an exact match');

  console.log('checkPickTrading: OK');
}

checkPickTrading();

// --- Trade offers expire ---------------------------------------------------
// An inbox that only ever grows is a standing obligation: offers were
// generated weekly and never removed, so they accumulated for a whole career.
function checkTradeOffersExpire() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
  const EXPIRY = tradeModule.TRADE_OFFER_EXPIRY_DAYS;
  assert.ok(EXPIRY > 0, 'expiry window is a positive number of days');

  const gs = { tradeOffers: [
    { dayReceived: 10, proposal: { participants: ['BOS', 'LAL'] } },   // fresh
    { dayReceived: 0, proposal: { participants: ['BOS', 'MIA'] } }     // stale
  ] };

  // One day short of the fresh offer's own deadline: only the stale one goes.
  const dropped = tradeModule.pruneExpiredTradeOffers(gs, 10 + EXPIRY - 1);
  assert.strictEqual(dropped, 1, 'exactly the stale offer is dropped');
  assert.strictEqual(gs.tradeOffers.length, 1, 'one offer survives');
  assert.strictEqual(gs.tradeOffers[0].proposal.participants[1], 'LAL', 'the fresh one survives');

  // The survivor goes when its own window closes.
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(gs, 10 + EXPIRY), 1, 'the last offer expires too');
  assert.strictEqual(gs.tradeOffers.length, 0, 'inbox empties');

  console.log('checkTradeOffersExpire: OK');
}
checkTradeOffersExpire();

function checkOffersExpireOnTheirLastDayNotBefore() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
  const EXPIRY = tradeModule.TRADE_OFFER_EXPIRY_DAYS;
  const gs = { tradeOffers: [{ dayReceived: 5, proposal: { participants: ['BOS', 'NYK'] } }] };
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(gs, 5 + EXPIRY - 1), 0,
    'still live the day before the window closes');
  assert.strictEqual(gs.tradeOffers.length, 1);
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(gs, 5 + EXPIRY), 1, 'gone once it closes');
  console.log('checkOffersExpireOnTheirLastDayNotBefore: OK');
}
checkOffersExpireOnTheirLastDayNotBefore();

function checkLegacyOffersGetAFullWindow() {
  // Offers saved before this feature have no dayReceived. They must not all
  // vanish on the first day after loading such a save — they get stamped with
  // the current day and then live out a normal window.
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
  const EXPIRY = tradeModule.TRADE_OFFER_EXPIRY_DAYS;
  const gs = { tradeOffers: [{ proposal: { participants: ['BOS', 'PHI'] } }] };

  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(gs, 40), 0, 'a legacy offer is not dropped on sight');
  assert.strictEqual(gs.tradeOffers[0].dayReceived, 40, 'it is stamped with the day it was first seen');
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(gs, 40 + EXPIRY), 1, 'then expires normally');
  console.log('checkLegacyOffersGetAFullWindow: OK');
}
checkLegacyOffersGetAFullWindow();

function checkPruneToleratesMissingInbox() {
  const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers({}, 5), 0, 'no tradeOffers array is not an error');
  assert.strictEqual(tradeModule.pruneExpiredTradeOffers(null, 5), 0, 'no game state is not an error');
  console.log('checkPruneToleratesMissingInbox: OK');
}
checkPruneToleratesMissingInbox();

console.log('All trade validations passed');
