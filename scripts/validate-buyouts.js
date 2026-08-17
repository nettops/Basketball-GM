// Buyouts. A player under contract gives up a share of what he is owed in
// exchange for his release — the one negotiation in this game where the club's
// bad news is its leverage: the worse the team, the more the player will pay to
// leave it.
//
// A buyout only means anything because dead money exists. Before it, releasing
// a player already cost nothing, so there was nothing to negotiate down.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const rosterMoves = req('rosterMoves.js');

function reset() {
  TEAMS.forEach(function (t) { t.deadMoney = []; });
}

function aTeamWithSpareBodies() {
  return TEAMS.find(function (t) {
    return league.getTeamRoster(t.id).length > rosterMoves.ROSTER_MINIMUM;
  });
}

// The decision is pure, so it can be examined without moving anybody.
function checkALosingTeamIsWorthPayingToLeave() {
  const player = { age: 27, status: { morale: 70 }, contract: { salary: 10000000, yearsRemaining: 2 } };
  const contender = { record: { wins: 50, losses: 10 } };
  const cellar = { record: { wins: 8, losses: 52 } };

  const onGood = rosterMoves.buyoutAppetite(player, contender);
  const onBad = rosterMoves.buyoutAppetite(player, cellar);
  assert.ok(onBad > onGood,
    'a man on a losing team will give up more to go (' + onBad.toFixed(2) + ' vs ' + onGood.toFixed(2) + ')');

  // Early in a season nobody knows it is lost yet, so a bad start must not read
  // like a bad season — otherwise every October slump triggers a fire sale.
  const earlySlump = { record: { wins: 1, losses: 5 } };
  const lateCollapse = { record: { wins: 10, losses: 50 } };
  assert.ok(rosterMoves.buyoutAppetite(player, earlySlump) < rosterMoves.buyoutAppetite(player, lateCollapse),
    'six games in is not the same as sixty');
  console.log('checkALosingTeamIsWorthPayingToLeave: OK');
}
checkALosingTeamIsWorthPayingToLeave();

function checkAgeAndUnhappinessBothPush() {
  const team = { record: { wins: 20, losses: 40 } };
  const base = { age: 25, status: { morale: 70 }, contract: { salary: 10000000, yearsRemaining: 2 } };
  const old = { age: 34, status: { morale: 70 }, contract: { salary: 10000000, yearsRemaining: 2 } };
  const unhappy = { age: 25, status: { morale: 20 }, contract: { salary: 10000000, yearsRemaining: 2 } };

  assert.ok(rosterMoves.buyoutAppetite(old, team) > rosterMoves.buyoutAppetite(base, team),
    'a veteran has fewer years to spend and knows it');
  assert.ok(rosterMoves.buyoutAppetite(unhappy, team) > rosterMoves.buyoutAppetite(base, team),
    'an unhappy man leaves for less');
  console.log('checkAgeAndUnhappinessBothPush: OK');
}
checkAgeAndUnhappinessBothPush();

// Nobody signs away everything. Past half his money he is better off sitting on
// the bench collecting it, which is the situation a buyout exists to end.
function checkNobodyGivesUpEverything() {
  const desperate = { age: 38, status: { morale: 1 }, contract: { salary: 10000000, yearsRemaining: 1 } };
  const hopeless = { record: { wins: 0, losses: 82 } };
  const appetite = rosterMoves.buyoutAppetite(desperate, hopeless);
  assert.ok(appetite <= rosterMoves.BUYOUT_MAX_FORGIVENESS,
    'even the most desperate man keeps half: ' + appetite);

  const decision = rosterMoves.buyoutDecision(desperate, hopeless, 0.9);
  assert.strictEqual(decision.accepted, false, 'and refuses a 90% haircut');
  console.log('checkNobodyGivesUpEverything: OK (ceiling ' + appetite.toFixed(2) + ')');
}
checkNobodyGivesUpEverything();

function checkABuyoutCostsLessThanCuttingHim() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const salary = player.contract.salary;
  const years = player.contract.yearsRemaining;

  // Make him want out badly enough to accept something.
  team.record = { wins: 5, losses: 55 };
  player.age = 34;
  if (player.status) player.status.morale = 25;

  const appetite = rosterMoves.buyoutAppetite(player, team);
  assert.ok(appetite > 0, 'he wants out');

  const result = rosterMoves.buyoutPlayer(player.id, appetite);
  assert.strictEqual(result.success, true, 'he took the deal: ' + (result.reason || ''));
  assert.strictEqual(player.teamId, null, 'and he is gone');
  assert.strictEqual(player.waivers, undefined,
    'straight to free agency, not the wire — at a salary he just cut, nobody would claim him anyway');

  const owed = league.getTeamDeadMoney(team.id);
  assert.ok(owed < salary, 'the club owes less than the full contract ($' +
    Math.round(owed / 1e6) + 'M of $' + Math.round(salary / 1e6) + 'M)');
  assert.ok(owed > 0, 'but it still owes something — this is a discount, not an escape');

  player.teamId = team.id;
  player.contract.salary = salary;
  player.contract.yearsRemaining = years;
  reset();
  console.log('checkABuyoutCostsLessThanCuttingHim: OK (saved ' +
    Math.round((1 - owed / salary) * 100) + '%)');
}
checkABuyoutCostsLessThanCuttingHim();

function checkAGreedyOfferIsRefused() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  team.record = { wins: 55, losses: 5 };
  player.age = 24;
  if (player.status) player.status.morale = 90;

  const result = rosterMoves.buyoutPlayer(player.id, 0.45);
  assert.strictEqual(result.success, false, 'a happy young man on a winner says no');
  assert.ok(/turned it down/i.test(result.reason), 'and says so: ' + result.reason);
  assert.strictEqual(player.teamId, team.id, 'he is still on the roster');
  assert.strictEqual(league.getTeamDeadMoney(team.id), 0, 'and nothing was charged for asking');
  reset();
  console.log('checkAGreedyOfferIsRefused: OK');
}
checkAGreedyOfferIsRefused();

// A full forgiveness leaves no debt, and must leave no empty row either —
// validate-deadMoney pins the same rule from the other side.
function checkFullForgivenessLeavesNothingBehind() {
  reset();
  const team = aTeamWithSpareBodies();
  const player = league.getTeamRoster(team.id)[0];
  const salary = player.contract.salary;
  const years = player.contract.yearsRemaining;

  const decision = rosterMoves.buyoutDecision(player, team, 1.0);
  assert.strictEqual(decision.deadMoney, 0, 'forgiving everything owes nothing');

  player.teamId = team.id;
  player.contract.salary = salary;
  player.contract.yearsRemaining = years;
  reset();
  console.log('checkFullForgivenessLeavesNothingBehind: OK');
}
checkFullForgivenessLeavesNothingBehind();

console.log('All buyout validations passed');
