// Waiving a player used to be free, and that made it the best move in the game.
// Measured on the opening league before this existed: every club cutting its
// two worst players cleared $32M each — 20.8% of the salary cap — at no cost
// whatsoever. Cap room could be conjured on demand, so every other financial
// rule was being negotiated against a number that could simply be deleted.
//
// These checks pin the cost: the money follows the club, shows up in the one
// place everything asks about money, and ages at the rate of the contract it
// came from.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const rosterMoves = req('rosterMoves.js');
const seasonTransition = req('seasonTransition.js');

// Every check starts from a league nobody has waived anyone in.
function resetDeadMoney() {
  TEAMS.forEach(function (t) { t.deadMoney = []; });
}

function aTeamWithSpareBodies() {
  return TEAMS.find(function (t) {
    return league.getTeamRoster(t.id).length > rosterMoves.ROSTER_MINIMUM;
  });
}

function checkWaivingLeavesTheBillBehind() {
  resetDeadMoney();
  const team = aTeamWithSpareBodies();
  const victim = league.getTeamRoster(team.id)[0];
  const salary = victim.contract.salary;
  const payrollBefore = league.getTeamPayroll(team.id);

  const result = rosterMoves.waivePlayer(victim.id);
  assert.strictEqual(result.success, true, 'the waive went through');
  assert.strictEqual(victim.teamId, null, 'and he is off the roster');

  // The point of the whole feature: the roster got cheaper, the club did not.
  assert.strictEqual(league.getTeamDeadMoney(team.id), salary, 'the salary is now dead money');
  assert.strictEqual(league.getTeamPayroll(team.id), payrollBefore,
    'so the payroll did not move at all — cutting him bought no cap room');

  // Restore him so later checks see the league they expect.
  victim.teamId = team.id;
  resetDeadMoney();
  console.log('checkWaivingLeavesTheBillBehind: OK ($' + Math.round(salary / 1e6) + 'M still owed)');
}
checkWaivingLeavesTheBillBehind();

function checkDeadMoneyReachesEverySpendingDecision() {
  resetDeadMoney();
  const team = TEAMS[0];
  const payrollBefore = league.getTeamPayroll(team.id);
  team.deadMoney = [{ playerId: 'x', name: 'Ghost', salary: 20000000, yearsRemaining: 2 }];

  // getTeamPayroll is the single question trades, offers and the cap sheet all
  // ask. If dead money is in here it is in all of them, and if it is not then
  // adding it at each call site is the beginning of two definitions of payroll.
  assert.strictEqual(league.getTeamPayroll(team.id), payrollBefore + 20000000,
    'payroll carries dead money');
  resetDeadMoney();
  console.log('checkDeadMoneyReachesEverySpendingDecision: OK');
}
checkDeadMoneyReachesEverySpendingDecision();

function checkTheDebtAgesLikeTheContractItCameFrom() {
  resetDeadMoney();
  const team = TEAMS[0];
  team.deadMoney = [
    { playerId: 'a', name: 'Two More Years', salary: 5000000, yearsRemaining: 2 },
    { playerId: 'b', name: 'Last Year', salary: 3000000, yearsRemaining: 1 }
  ];

  rosterMoves.decrementDeadMoney(TEAMS);
  assert.strictEqual(team.deadMoney.length, 1, 'the one-year debt is paid off and gone');
  assert.strictEqual(team.deadMoney[0].playerId, 'a', 'the longer one survives');
  assert.strictEqual(team.deadMoney[0].yearsRemaining, 1, 'a year lighter');
  assert.strictEqual(league.getTeamDeadMoney(team.id), 5000000, 'and still owed in full this year');

  rosterMoves.decrementDeadMoney(TEAMS);
  assert.deepStrictEqual(team.deadMoney, [], 'eventually the club is clear');
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'and owes nothing');
  resetDeadMoney();
  console.log('checkTheDebtAgesLikeTheContractItCameFrom: OK');
}
checkTheDebtAgesLikeTheContractItCameFrom();

// A club that never waived anyone has no deadMoney field at all, and neither
// does a team restored from a save written before this existed. Every reader
// has to treat that as zero rather than throwing — the cap sheet is on screen
// the moment a legacy save loads.
function checkALegacyTeamOwesNothing() {
  const team = TEAMS[1];
  delete team.deadMoney;
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'no dead money field reads as no debt');
  assert.doesNotThrow(function () { league.getTeamPayroll(team.id); }, 'and payroll still computes');
  rosterMoves.decrementDeadMoney(TEAMS);
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'the offseason tick leaves it alone');
  resetDeadMoney();
  console.log('checkALegacyTeamOwesNothing: OK');
}
checkALegacyTeamOwesNothing();

// The offseason has to tick the debt, not just the contracts. This runs the
// real decrementContracts rather than calling decrementDeadMoney directly, so
// it fails if the two are ever wired apart.
function checkTheOffseasonTicksIt() {
  resetDeadMoney();
  const team = TEAMS[0];
  team.deadMoney = [{ playerId: 'c', name: 'Paid To Leave', salary: 8000000, yearsRemaining: 3 }];

  seasonTransition.decrementContracts(null);

  assert.strictEqual(team.deadMoney[0].yearsRemaining, 2,
    'the real offseason path ages dead money, not just a direct call to it');
  resetDeadMoney();
  console.log('checkTheOffseasonTicksIt: OK');
}
checkTheOffseasonTicksIt();

// A forgiven contract is not a debt. Buyouts (task 4) can forgive the whole
// thing, and a zero-dollar row would sit on the cap sheet for years looking
// like a bug while costing nothing.
function checkNothingOwedRecordsNothing() {
  resetDeadMoney();
  const team = TEAMS[0];
  const fake = { id: 'z', name: 'Fully Forgiven', contract: { salary: 0, yearsRemaining: 2 } };
  const entry = rosterMoves.addDeadMoney(team, fake, 0);
  assert.strictEqual(entry, null, 'nothing owed records nothing');
  assert.deepStrictEqual(team.deadMoney, [], 'and leaves no empty row behind');
  resetDeadMoney();
  console.log('checkNothingOwedRecordsNothing: OK');
}
checkNothingOwedRecordsNothing();

console.log('All dead money validations passed');
