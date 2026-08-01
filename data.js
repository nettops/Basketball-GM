const ATTRIBUTE_KEYS = [
  'insideScoring', 'midRange', 'threePoint', 'freeThrow', 'passing',
  'ballHandling', 'postScoring', 'perimeterDefense', 'interiorDefense',
  'steal', 'block', 'offReb', 'defReb', 'speed', 'acceleration',
  'strength', 'vertical', 'basketballIQ', 'leadership', 'workEthic'
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const CONFERENCES = ['Eastern', 'Western'];

const DIVISIONS = {
  Eastern: ['Atlantic', 'Central', 'Southeast'],
  Western: ['Northwest', 'Pacific', 'Southwest']
};

const CAP_CONSTANTS = {
  SALARY_CAP: 154000000,
  LUXURY_TAX_LINE: 187000000
};

const RATING_MIN = 25;
const RATING_MAX = 99;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATTRIBUTE_KEYS, POSITIONS, CONFERENCES, DIVISIONS,
    CAP_CONSTANTS, RATING_MIN, RATING_MAX
  };
}
