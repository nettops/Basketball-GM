const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

// Phase A: capLevel is a settings-driven multiplier on the base cap figures,
// surfaced as a "Cap Level" select in ui/settings.js.
function checkEffectiveCapScaling() {
  assert.strictEqual(dataModule.getEffectiveSalaryCap(), dataModule.CAP_CONSTANTS.SALARY_CAP, 'undefined capLevel should default to 1x');
  assert.strictEqual(dataModule.getEffectiveSalaryCap(1), dataModule.CAP_CONSTANTS.SALARY_CAP);
  assert.strictEqual(dataModule.getEffectiveSalaryCap(0.75), Math.round(dataModule.CAP_CONSTANTS.SALARY_CAP * 0.75));
  assert.strictEqual(dataModule.getEffectiveSalaryCap(1.5), Math.round(dataModule.CAP_CONSTANTS.SALARY_CAP * 1.5));

  assert.strictEqual(dataModule.getEffectiveLuxuryTaxLine(), dataModule.CAP_CONSTANTS.LUXURY_TAX_LINE, 'undefined capLevel should default to 1x');
  assert.strictEqual(dataModule.getEffectiveLuxuryTaxLine(1.25), Math.round(dataModule.CAP_CONSTANTS.LUXURY_TAX_LINE * 1.25));

  console.log('checkEffectiveCapScaling: OK');
}

checkEffectiveCapScaling();

// Phase A: injuryFrequency is a settings-driven multiplier on injuries.js's
// base injury chance, surfaced as an "Injury Frequency" select in ui/settings.js.
function checkInjuryFrequencySetting() {
  const injuriesModule = require(path.join(__dirname, '..', 'injuries.js'));
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const player = leagueModule.getTeamRoster('BOS')[0];
  player.status.fatigue = 0;

  const TRIALS = 5000;

  global.GameState = { settings: { injuryFrequency: 0 } };
  let offCount = 0;
  const rngOff = makeRng(7);
  for (let i = 0; i < TRIALS; i++) {
    player.status.injury = null;
    injuriesModule.rollInjury(player, rngOff);
    if (player.status.injury) offCount++;
  }
  assert.strictEqual(offCount, 0, 'injuryFrequency 0 should produce zero injuries, got ' + offCount);

  global.GameState = { settings: { injuryFrequency: 1 } };
  let normalCount = 0;
  const rngNormal = makeRng(7);
  for (let i = 0; i < TRIALS; i++) {
    player.status.injury = null;
    injuriesModule.rollInjury(player, rngNormal);
    if (player.status.injury) normalCount++;
  }

  global.GameState = { settings: { injuryFrequency: 3 } };
  let highCount = 0;
  const rngHigh = makeRng(7);
  for (let i = 0; i < TRIALS; i++) {
    player.status.injury = null;
    injuriesModule.rollInjury(player, rngHigh);
    if (player.status.injury) highCount++;
  }
  assert.ok(highCount > normalCount, 'injuryFrequency 3 (' + highCount + ') should injure more often than 1 (' + normalCount + ')');

  delete global.GameState;
  player.status.injury = null;
  console.log('checkInjuryFrequencySetting: OK (off=' + offCount + ', normal=' + normalCount + ', high=' + highCount + ')');
}

checkInjuryFrequencySetting();

console.log('All settings rules validations passed');
