const assert = require('assert');
const path = require('path');

const dataModule = require(path.join(__dirname, '..', 'data.js'));
const financesModule = require(path.join(__dirname, '..', 'finances.js'));

function makeTeam(overrides) {
  return Object.assign({
    id: 'TST', name: 'Test Team', marketSize: 60, fanHappiness: 70, ownerHappiness: 70,
    prestige: 60, record: { wins: 10, losses: 10 }
  }, overrides || {});
}

function checkArenaCapacityAndUpgrades() {
  const team = makeTeam();
  const baseCapacity = financesModule.arenaCapacity(team);
  assert.ok(baseCapacity > 0);

  const finances = financesModule.ensureTeamFinances(team);
  finances.cash = 100000000;
  const costBeforeUpgrade = financesModule.upgradeArenaCost(team);
  assert.ok(costBeforeUpgrade > 0);

  const upgraded = financesModule.upgradeArena(team);
  assert.strictEqual(upgraded, true, 'upgrade should succeed with enough cash');
  assert.strictEqual(finances.arenaTier, 2);
  assert.ok(financesModule.arenaCapacity(team) > baseCapacity, 'capacity should rise after upgrading');
  assert.ok(finances.cash < 100000000, 'cash should be spent on the upgrade');

  finances.cash = 0;
  const failedUpgrade = financesModule.upgradeArena(team);
  assert.strictEqual(failedUpgrade, false, 'upgrade should fail without enough cash');
  assert.strictEqual(finances.arenaTier, 2, 'tier should not change on a failed upgrade');

  finances.arenaTier = financesModule.ARENA_MAX_TIER;
  assert.strictEqual(financesModule.upgradeArenaCost(team), null, 'no cost should be returned once maxed out');

  console.log('checkArenaCapacityAndUpgrades: OK');
}

checkArenaCapacityAndUpgrades();

function checkBudgetTier() {
  assert.strictEqual(financesModule.budgetTier(makeTeam({ ownerHappiness: 20 })), 'low');
  assert.strictEqual(financesModule.budgetTier(makeTeam({ ownerHappiness: 50 })), 'medium');
  assert.strictEqual(financesModule.budgetTier(makeTeam({ ownerHappiness: 85 })), 'high');
  assert.ok(financesModule.budgetSpendMultiplier(makeTeam({ ownerHappiness: 85 })) > financesModule.budgetSpendMultiplier(makeTeam({ ownerHappiness: 20 })));
  console.log('checkBudgetTier: OK');
}

checkBudgetTier();

function checkTickFinancesForTeamGame() {
  const team = makeTeam({ fanHappiness: 50 });
  const getTeamByIdFn = function () { return team; };

  financesModule.tickFinancesForTeamGame('TST', true, getTeamByIdFn);
  const finances = financesModule.ensureTeamFinances(team);
  assert.ok(finances.lastAttendance > 0);
  assert.ok(finances.lastGateRevenue > 0);
  assert.strictEqual(finances.cash, finances.lastGateRevenue);
  assert.ok(team.fanHappiness > 50, 'a win should nudge fan happiness up');

  const happinessAfterWin = team.fanHappiness;
  financesModule.tickFinancesForTeamGame('TST', false, getTeamByIdFn);
  assert.ok(team.fanHappiness < happinessAfterWin, 'a loss should nudge fan happiness down');
  assert.ok(finances.seasonGateRevenue > finances.lastGateRevenue, 'season revenue should accumulate across games');

  console.log('checkTickFinancesForTeamGame: OK');
}

checkTickFinancesForTeamGame();

function checkApplySeasonEndFinancesLuxuryTax() {
  const team = makeTeam();
  const finances = financesModule.ensureTeamFinances(team);
  finances.cash = 0;
  const overTaxPayroll = dataModule.CAP_CONSTANTS.LUXURY_TAX_LINE + 10000000;

  const result = financesModule.applySeasonEndFinances(team, overTaxPayroll, 1);
  assert.strictEqual(result.luxuryTax, Math.round(10000000 * dataModule.CAP_CONSTANTS.LUXURY_TAX_RATE));
  assert.strictEqual(result.floorTax, 0);
  assert.strictEqual(finances.cash, -result.luxuryTax);
  assert.ok(team.ownerHappiness < 70, 'paying luxury tax should sour owner happiness');

  console.log('checkApplySeasonEndFinancesLuxuryTax: OK');
}

checkApplySeasonEndFinancesLuxuryTax();

function checkApplySeasonEndFinancesFloorTax() {
  const team = makeTeam();
  const finances = financesModule.ensureTeamFinances(team);
  finances.cash = 0;
  const underFloorPayroll = dataModule.CAP_CONSTANTS.SALARY_FLOOR - 5000000;

  const result = financesModule.applySeasonEndFinances(team, underFloorPayroll, 1);
  assert.strictEqual(result.floorTax, 5000000);
  assert.strictEqual(result.luxuryTax, 0);
  assert.strictEqual(finances.cash, -5000000);
  assert.ok(team.ownerHappiness < 70, 'a forced floor payment should sour owner happiness');

  console.log('checkApplySeasonEndFinancesFloorTax: OK');
}

checkApplySeasonEndFinancesFloorTax();

function checkApplySeasonEndFinancesHealthy() {
  const team = makeTeam({ ownerHappiness: 70 });
  const finances = financesModule.ensureTeamFinances(team);
  finances.cash = 0;
  finances.seasonGateRevenue = 5000000;
  const midPayroll = dataModule.CAP_CONSTANTS.SALARY_CAP;

  const result = financesModule.applySeasonEndFinances(team, midPayroll, 1);
  assert.strictEqual(result.luxuryTax, 0);
  assert.strictEqual(result.floorTax, 0);
  assert.strictEqual(finances.cash, 0, 'no penalty should be deducted between the floor and tax line');
  assert.ok(team.ownerHappiness > 70, 'a clean financial season should lift owner happiness');
  assert.strictEqual(finances.seasonGateRevenue, 0, 'season revenue counter should reset for the new season');

  console.log('checkApplySeasonEndFinancesHealthy: OK');
}

checkApplySeasonEndFinancesHealthy();

function checkCapLevelScalesFloorAndTax() {
  assert.strictEqual(dataModule.getEffectiveSalaryFloor(), dataModule.CAP_CONSTANTS.SALARY_FLOOR);
  assert.strictEqual(dataModule.getEffectiveSalaryFloor(1.5), Math.round(dataModule.CAP_CONSTANTS.SALARY_FLOOR * 1.5));
  console.log('checkCapLevelScalesFloorAndTax: OK');
}

checkCapLevelScalesFloorAndTax();

// Free agency: a below-floor team should keep spending toward the floor
// regardless of a sour owner mood, since it owes the shortfall as tax anyway.
function checkFreeAgencyRespectsBudgetTierAndFloor() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

  const team = teamsModule.getTeamById('CHA');
  team.ownerHappiness = 20; // low budget tier
  const roster = leagueModule.getTeamRoster(team.id);
  const targetPlayer = leagueModule.getTeamRoster('LAL')[0];

  const rng = makeRng(42);
  const offer = freeAgencyModule.generateAIOffer(team, targetPlayer, rng);
  const payroll = leagueModule.getTeamPayroll(team.id);
  const belowFloor = payroll < dataModule.getEffectiveSalaryFloor(1);
  if (offer) {
    const capSpace = dataModule.getEffectiveSalaryCap(1) - payroll;
    // A team already below the floor is exempt from the budget-tier multiplier
    // (see freeAgency.js's generateAIOffer) since it owes the shortfall as
    // floor tax either way — only a healthy-payroll team gets multiplier-capped.
    const allowedSpace = belowFloor ? capSpace : capSpace * financesModule.budgetSpendMultiplier(team);
    assert.ok(offer.salary <= allowedSpace + 1, 'a low-budget-tier team should not spend beyond its allowed share of cap space (belowFloor=' + belowFloor + ')');
  }

  console.log('checkFreeAgencyRespectsBudgetTierAndFloor: OK (offer=' + JSON.stringify(offer) + ')');
}

checkFreeAgencyRespectsBudgetTierAndFloor();

// Deterministic version of the above: force plenty of cap space (well above
// the floor either way) via a high capLevel, so the low-budget-tier
// multiplier is the only thing constraining the offer ceiling.
function checkBudgetMultiplierClipsOfferWhenAboveFloor() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

  const team = teamsModule.getTeamById('BOS'); // comfortably above the standard floor already
  const payroll = leagueModule.getTeamPayroll(team.id);
  assert.ok(payroll > dataModule.CAP_CONSTANTS.SALARY_FLOOR, 'test assumes BOS payroll is above the base floor');

  global.GameState = { settings: { capLevel: 3, capDisabled: false } }; // huge cap space, still above the (also-scaled) floor
  const capSpace = dataModule.getEffectiveSalaryCap(3) - payroll;
  const targetPlayer = leagueModule.getTeamRoster('LAL')[0];

  team.ownerHappiness = 20; // low tier
  const lowOffer = freeAgencyModule.generateAIOffer(team, targetPlayer, makeRng(1));
  team.ownerHappiness = 85; // high tier
  const highOffer = freeAgencyModule.generateAIOffer(team, targetPlayer, makeRng(1));

  if (lowOffer) assert.ok(lowOffer.salary <= capSpace * financesModule.budgetSpendMultiplier(Object.assign({}, team, { ownerHappiness: 20 })) + 1);
  if (highOffer) assert.ok(highOffer.salary <= capSpace + 1);

  delete global.GameState;
  console.log('checkBudgetMultiplierClipsOfferWhenAboveFloor: OK (low=' + JSON.stringify(lowOffer) + ', high=' + JSON.stringify(highOffer) + ')');
}

checkBudgetMultiplierClipsOfferWhenAboveFloor();

console.log('All finances validations passed');
