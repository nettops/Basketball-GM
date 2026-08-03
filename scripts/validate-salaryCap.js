const assert = require('assert');
const path = require('path');

const dataModule = require(path.join(__dirname, '..', 'data.js'));
global.CAP_CONSTANTS = dataModule.CAP_CONSTANTS;
global.getEffectiveSalaryCap = dataModule.getEffectiveSalaryCap;
global.getEffectiveLuxuryTaxLine = dataModule.getEffectiveLuxuryTaxLine;
const salaryCap = require(path.join(__dirname, '..', 'ui', 'salaryCap.js'));

function checkEstimateLuxuryTax() {
  assert.strictEqual(salaryCap.estimateLuxuryTax(CAP_CONSTANTS.LUXURY_TAX_LINE), 0, 'exactly at the tax line should owe nothing');
  assert.strictEqual(salaryCap.estimateLuxuryTax(CAP_CONSTANTS.LUXURY_TAX_LINE - 1000000), 0, 'under the tax line should owe nothing');
  const over = CAP_CONSTANTS.LUXURY_TAX_LINE + 10000000;
  assert.strictEqual(salaryCap.estimateLuxuryTax(over), Math.round(10000000 * salaryCap.LUXURY_TAX_RATE), '$10M over the line should owe rate x $10M');
  console.log('checkEstimateLuxuryTax: OK');
}

checkEstimateLuxuryTax();

console.log('All salary cap validations passed');
