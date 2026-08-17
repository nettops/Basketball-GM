// Two consequences of dead money that the league had not caught up with.
//
// 1. The roster-ceiling sweep ranked cuts purely by player value, which was
//    right when releasing a player was free and became wrong the moment it was
//    not. It would release a $35M contract to save a roster spot it could have
//    saved by releasing a $1.2M one, and the club paid the difference for years.
//    That is where most of the league's dead money was coming from.
//
// 2. A fresh league opens with EXACTLY zero unsigned players — 435 players
//    across thirty rosters of 13-15 consumes the pool precisely. Ten-day deals,
//    two-way deals and the roster-floor sweep all have nothing to work with.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const freeAgency = req('freeAgency.js');
const rosterMoves = req('rosterMoves.js');
const prospects = req('draftProspects.js');

function reset() {
  TEAMS.forEach(function (t) { t.deadMoney = []; });
}

// The cut that costs least is the one a club should make, and "costs least" now
// has two terms in it.
// Real players, not hand-built ones: adjustedPlayerValue reads far more of a
// player than a plausible-looking literal carries, and a thin fixture makes it
// return NaN — which compares false against everything and passes nothing
// honestly.
function checkAnExpensiveContractIsExpensiveToCut() {
  reset();
  const team = TEAMS[0];
  const roster = league.getTeamRoster(team.id).slice()
    .sort(function (a, b) { return a.rawOverall - b.rawOverall; });
  const man = roster[0];
  const original = Object.assign({}, man.contract);

  // The SAME player twice. Only what he is owed changes, so the value term is
  // identical and the difference is purely the debt.
  man.contract = { salary: 1200000, yearsRemaining: 1, playerOption: false, teamOption: false };
  const cheapCost = freeAgency.releaseCost(man, team);
  man.contract = { salary: 35000000, yearsRemaining: 3, playerOption: false, teamOption: false };
  const priceyCost = freeAgency.releaseCost(man, team);

  assert.ok(isFinite(cheapCost) && isFinite(priceyCost), 'the cost is a real number');
  assert.ok(priceyCost > cheapCost,
    'cutting a big contract costs more than cutting a small one (' +
    priceyCost.toFixed(1) + ' vs ' + cheapCost.toFixed(1) + ')');

  // The money has to outweigh a real gap in ability, or the term is decorative.
  //
  // Deliberately against a modestly better player, not the best man on the
  // roster: the value gap from a fringe player to a star is far larger than any
  // contract, and it SHOULD be — no aversion to dead money should talk a club
  // into releasing a star on the minimum. The population this sweep actually
  // chooses among is the bottom of the roster, so that is where the flip has to
  // happen to mean anything.
  const better = roster[2];
  const betterOriginal = Object.assign({}, better.contract);
  better.contract = { salary: 1200000, yearsRemaining: 1, playerOption: false, teamOption: false };
  assert.ok(freeAgency.releaseCost(man, team) > freeAgency.releaseCost(better, team),
    'a club keeps a bad expensive contract and cuts a cheap useful man, the way real clubs do');

  man.contract = original;
  better.contract = betterOriginal;
  reset();
  console.log('checkAnExpensiveContractIsExpensiveToCut: OK (' +
    cheapCost.toFixed(1) + ' vs ' + priceyCost.toFixed(1) + ')');
}
checkAnExpensiveContractIsExpensiveToCut();

// The sweep must still leave every club legal. A cost function that refuses to
// cut anybody would be worse than the value-only one it replaced.
function checkTheSweepStillEmptiesTheOverflow() {
  reset();
  const team = TEAMS.find(function (t) { return league.getActiveRoster(t.id).length >= 14; });
  const donors = [];

  // Overfill it past the ceiling with cheap bodies.
  let added = 0;
  while (league.getActiveRoster(team.id).length <= freeAgency.ROSTER_MAX && added < 6) {
    const other = TEAMS.find(function (t) {
      return t.id !== team.id && league.getActiveRoster(t.id).length > rosterMoves.ROSTER_MINIMUM + 1;
    });
    const moved = league.getTeamRoster(other.id)[0];
    donors.push({ p: moved, from: moved.teamId });
    moved.teamId = team.id;
    added++;
  }
  assert.ok(league.getActiveRoster(team.id).length > freeAgency.ROSTER_MAX, 'the club really is over the ceiling');

  const cuts = freeAgency.enforceRosterCeilings();
  assert.ok(cuts.length > 0, 'somebody was moved on');
  TEAMS.forEach(function (t) {
    assert.ok(league.getActiveRoster(t.id).length <= freeAgency.ROSTER_MAX,
      t.id + ' is legal afterwards (' + league.getActiveRoster(t.id).length + ')');
  });

  donors.forEach(function (d) { if (d.p.teamId === team.id) d.p.teamId = d.from; });
  reset();
  console.log('checkTheSweepStillEmptiesTheOverflow: OK (' + cuts.length + ' moved on, ' +
    cuts.filter(function (c) { return c.boughtOut; }).length + ' by buyout)');
}
checkTheSweepStillEmptiesTheOverflow();

// A buyout clears the same roster spot for less money, so a club with no reason
// to prefer the bigger bill should not be handed one.
function checkABuyoutIsPreferredWhenHeWillTakeOne() {
  reset();
  const team = TEAMS[0];
  const willing = { name: 'Willing', contract: { salary: 20000000, yearsRemaining: 2 },
    age: 34, status: { morale: 20 } };
  team.record = { wins: 6, losses: 54 };

  const appetite = rosterMoves.buyoutAppetite(willing, team);
  assert.ok(appetite > 0, 'he would take something to leave');
  const viaBuyout = rosterMoves.buyoutDecision(willing, team, appetite).deadMoney;
  assert.ok(viaBuyout < willing.contract.salary,
    'and a buyout leaves a smaller bill than a release ($' + Math.round(viaBuyout / 1e6) +
    'M vs $' + Math.round(willing.contract.salary / 1e6) + 'M)');
  reset();
  console.log('checkABuyoutIsPreferredWhenHeWillTakeOne: OK');
}
checkABuyoutIsPreferredWhenHeWillTakeOne();

// The market must not be empty on day one.
function checkTheMarketIsNeverEmpty() {
  const before = rosterMoves.getFreeAgents().length;
  const added = freeAgency.ensureVeteranFreeAgentPool(makeRng(5150), prospects.generateProspectClass);
  const after = rosterMoves.getFreeAgents().length;

  assert.ok(after >= freeAgency.VETERAN_POOL_SIZE,
    'the pool reaches its target (' + before + ' -> ' + after + ')');
  added.forEach(function (p) {
    assert.strictEqual(p.teamId, null, p.name + ' is unsigned');
    assert.ok(p.age >= 24 && p.age <= 33, p.name + ' reads as a journeyman, not a prospect: age ' + p.age);
    assert.ok(p.yearsPro >= 1, p.name + ' has been around');
    assert.strictEqual(p.contract.yearsRemaining, 0, 'and is owed nothing by anybody');
  });

  // Idempotent: called again with the pool already full, it must not keep
  // stuffing the league with journeymen every season.
  const secondCall = freeAgency.ensureVeteranFreeAgentPool(makeRng(5151), prospects.generateProspectClass);
  assert.deepStrictEqual(secondCall, [], 'a full market is left alone');

  added.forEach(function (p) {
    const i = PLAYERS_2026.indexOf(p);
    if (i !== -1) PLAYERS_2026.splice(i, 1);
  });
  console.log('checkTheMarketIsNeverEmpty: OK (' + before + ' -> ' + after + ' free agents)');
}
checkTheMarketIsNeverEmpty();

console.log('All release-cost and market validations passed');
