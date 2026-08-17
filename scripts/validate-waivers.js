// The waiver wire. A player cut mid-season sits here for two game days with his
// contract attached, and another club may take the deal on whole.
//
// This is the decision dead money exists to pose, so the checks that matter are
// the two halves of it: a player worth more than he is owed gets claimed and
// the debt moves with him, and a player worth less clears while his old club
// keeps paying. A wire where everyone is claimed, or nobody is, is scenery.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

const data = req('data.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const rosterMoves = req('rosterMoves.js');
const waivers = req('waivers.js');

const CAP = data.getEffectiveSalaryCap();

function reset() {
  TEAMS.forEach(function (t) { t.deadMoney = []; });
  PLAYERS_2026.forEach(function (p) { delete p.waivers; });
}

// A club with bodies to spare and a real record, so claim priority and the
// roster minimum are both satisfied.
function aTeamWithSpareBodies(excludeId) {
  return TEAMS.find(function (t) {
    return t.id !== excludeId && league.getTeamRoster(t.id).length > rosterMoves.ROSTER_MINIMUM;
  });
}

function restore(player, teamId, salary, years) {
  player.teamId = teamId;
  player.contract.salary = salary;
  player.contract.yearsRemaining = years;
  delete player.waivers;
}

function checkAnInSeasonCutGoesToTheWireNotTheMarket() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const salary = player.contract.salary;
  const years = player.contract.yearsRemaining;

  const result = rosterMoves.waivePlayer(player.id, 10);
  assert.strictEqual(result.success, true, 'the waive went through');
  assert.strictEqual(result.onWaivers, true, 'and put him on the wire');
  assert.strictEqual(player.waivers.clearsOnDay, 10 + rosterMoves.WAIVER_WINDOW_DAYS,
    'his window closes two game days out');

  // The leak that would make the whole feature decoration: if the free agent
  // pool can see him, AI free agency signs him at its own price a day early
  // and no claim ever happens.
  const pool = rosterMoves.getFreeAgents();
  assert.ok(!pool.some(function (p) { return p.id === player.id; }),
    'a man on the wire is NOT in the free agent pool');
  assert.ok(waivers.playersOnWaivers().some(function (p) { return p.id === player.id; }),
    'he is on the wire');

  restore(player, team.id, salary, years);
  reset();
  console.log('checkAnInSeasonCutGoesToTheWireNotTheMarket: OK');
}
checkAnInSeasonCutGoesToTheWireNotTheMarket();

// Between seasons there are no game days for a window to run on, and every
// offseason caller (enforceRosterCeilings, the rollover, career mode) omits the
// day. Those releases must still work the way they always did, or the offseason
// silently parks players on a wire nothing will ever resolve.
function checkAnOffseasonCutIsStillImmediate() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const salary = player.contract.salary;
  const years = player.contract.yearsRemaining;

  const result = rosterMoves.waivePlayer(player.id);
  assert.strictEqual(result.success, true, 'the offseason waive went through');
  assert.strictEqual(result.onWaivers, false, 'with no wire involved');
  assert.strictEqual(player.waivers, undefined, 'and nothing to resolve later');
  assert.ok(rosterMoves.getFreeAgents().some(function (p) { return p.id === player.id; }),
    'he is a free agent immediately');

  restore(player, team.id, salary, years);
  reset();
  console.log('checkAnOffseasonCutIsStillImmediate: OK');
}
checkAnOffseasonCutIsStillImmediate();

function checkABargainIsClaimedAndTheDebtGoesWithHim() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;

  // Owed far less than he is worth: somebody will want this contract.
  player.contract.salary = 1200000;
  player.contract.yearsRemaining = 2;
  rosterMoves.waivePlayer(player.id, 5);
  assert.strictEqual(league.getTeamDeadMoney(team.id), 1200000, 'the club is on the hook while he sits');

  const out = waivers.resolveWaiverClaims(7, null, undefined);
  const row = out.find(function (r) { return r.playerId === player.id; });
  assert.ok(row && row.claimedBy, 'a player worth more than he is owed gets claimed');
  assert.strictEqual(player.teamId, row.claimedBy, 'and he is on their roster');
  assert.strictEqual(player.contract.salary, 1200000, 'on the contract he already had');
  assert.strictEqual(player.contract.yearsRemaining, 2, 'for the years already on it');
  assert.strictEqual(player.waivers, undefined, 'and he is off the wire');

  // The point of a claim: the debt moves to the claimant, so cutting a good
  // contract costs the club nothing but the player.
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'the waiving club owes nothing now');

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkABargainIsClaimedAndTheDebtGoesWithHim: OK (claimed by ' + row.claimedBy + ')');
}
checkABargainIsClaimedAndTheDebtGoesWithHim();

function checkAnOverpaidManClearsAndTheBillStays() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;

  // Owed far more than anyone thinks he is worth.
  player.contract.salary = 60000000;
  player.contract.yearsRemaining = 3;
  rosterMoves.waivePlayer(player.id, 5);

  const out = waivers.resolveWaiverClaims(7, null, undefined);
  const row = out.find(function (r) { return r.playerId === player.id; });
  assert.ok(row && row.cleared, 'nobody takes on a contract that bad');
  assert.strictEqual(player.teamId, null, 'so he is a free agent');
  assert.strictEqual(player.waivers, undefined, 'off the wire');
  assert.ok(rosterMoves.getFreeAgents().some(function (p) { return p.id === player.id; }),
    'and the market can see him now');
  assert.strictEqual(league.getTeamDeadMoney(team.id), 60000000,
    'while the club that wrote the deal keeps paying it');

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkAnOverpaidManClearsAndTheBillStays: OK');
}
checkAnOverpaidManClearsAndTheBillStays();

function checkTheWindowIsRespected() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;
  player.contract.salary = 1200000;

  rosterMoves.waivePlayer(player.id, 5);
  const early = waivers.resolveWaiverClaims(6, null, undefined);
  assert.deepStrictEqual(early, [], 'nothing settles before the window closes');
  assert.ok(player.waivers, 'he is still on the wire');

  const onTime = waivers.resolveWaiverClaims(7, null, undefined);
  assert.strictEqual(onTime.length, 1, 'and settles on the day it does');

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkTheWindowIsRespected: OK');
}
checkTheWindowIsRespected();

function checkAClaimObeysTheCapAndTheRoster() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;
  // Above the minimum, so the exception below does not apply and the cap does.
  player.contract.salary = 8000000;
  rosterMoves.waivePlayer(player.id, 5);

  const broke = TEAMS.find(function (t) { return t.id !== team.id; });
  // Push them over the cap with pure debt, which getTeamPayroll counts.
  broke.deadMoney = [{ playerId: 'ghost', name: 'Ghost', salary: CAP, yearsRemaining: 3 }];
  const capped = waivers.canClaim(broke, player, undefined);
  assert.strictEqual(capped.ok, false, 'a club with no room cannot claim a real contract');
  assert.ok(/cap/i.test(capped.reason), 'and is told why: ' + capped.reason);

  const own = waivers.canClaim(TEAMS.find(function (t) { return t.id === team.id; }), player, undefined);
  assert.strictEqual(own.ok, false, 'nor can the club that just waived him');

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkAClaimObeysTheCapAndTheRoster: OK');
}
checkAClaimObeysTheCapAndTheRoster();

// Without this exception the wire is scenery. Measured on the opening league:
// 2 of 30 clubs have room to claim even a $1.2M player, because this cap is
// soft and 28 clubs are over it. Every claim would fail on cap space, nothing
// would ever be claimed, and dead money would have no counterweight at all.
function checkAnyoneCanAbsorbTheMinimum() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;
  player.contract.salary = 1200000;
  rosterMoves.waivePlayer(player.id, 5);

  const broke = TEAMS.find(function (t) {
    return t.id !== team.id && league.getTeamRoster(t.id).length < 15;
  });
  broke.deadMoney = [{ playerId: 'ghost', name: 'Ghost', salary: CAP, yearsRemaining: 3 }];
  assert.ok(league.getTeamPayroll(broke.id) > CAP, 'the club really is over the cap');

  const res = waivers.canClaim(broke, player, undefined);
  assert.strictEqual(res.ok, true, 'a minimum contract can still be absorbed: ' + (res.reason || ''));

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkAnyoneCanAbsorbTheMinimum: OK');
}
checkAnyoneCanAbsorbTheMinimum();

// Worst record first. This is what makes a bad club's cap space worth
// something, and it is the only reason a rebuilding team ever wins a race for
// a useful player.
function checkTheWorstTeamGetsFirstCall() {
  const order = waivers.claimPriority();
  for (let i = 1; i < order.length; i++) {
    const prev = (order[i - 1].record && order[i - 1].record.wins) || 0;
    const cur = (order[i].record && order[i].record.wins) || 0;
    assert.ok(prev <= cur, 'claim priority runs worst record first');
  }
  assert.strictEqual(order.length, TEAMS.length, 'and everybody is in the queue');
  console.log('checkTheWorstTeamGetsFirstCall: OK');
}
checkTheWorstTeamGetsFirstCall();

// The user's own claim, which is the button on the panel.
function checkTheUserCanClaimDirectly() {
  reset();
  const team = aTeamWithSpareBodies();
  const claimant = aTeamWithSpareBodies(team.id);
  const player = league.getTeamRoster(team.id)[0];
  const originalSalary = player.contract.salary;
  const originalYears = player.contract.yearsRemaining;
  player.contract.salary = 1200000;
  rosterMoves.waivePlayer(player.id, 5);

  const res = waivers.claimPlayer(player.id, claimant.id, undefined);
  assert.strictEqual(res.success, true, 'the claim went through');
  assert.strictEqual(player.teamId, claimant.id, 'and he is theirs');
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'debt cancelled');

  // He is gone from the wire, so the day's sweep has nothing left to settle.
  assert.deepStrictEqual(waivers.resolveWaiverClaims(9, null, undefined), [],
    'a claimed player is not settled twice');

  restore(player, team.id, originalSalary, originalYears);
  reset();
  console.log('checkTheUserCanClaimDirectly: OK');
}
checkTheUserCanClaimDirectly();

console.log('All waiver validations passed');
