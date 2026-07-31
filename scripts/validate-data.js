const assert = require('assert');
const path = require('path');

const data = require(path.join(__dirname, '..', 'data.js'));

function checkDataConstants() {
  assert.strictEqual(data.ATTRIBUTE_KEYS.length, 20, 'expected 20 attribute keys');
  assert.strictEqual(new Set(data.ATTRIBUTE_KEYS).size, 20, 'attribute keys must be unique');
  assert.deepStrictEqual(data.POSITIONS, ['PG', 'SG', 'SF', 'PF', 'C']);
  assert.deepStrictEqual(data.CONFERENCES, ['Eastern', 'Western']);
  assert.strictEqual(data.DIVISIONS.Eastern.length, 3);
  assert.strictEqual(data.DIVISIONS.Western.length, 3);
  assert.strictEqual(data.RATING_MIN, 25);
  assert.strictEqual(data.RATING_MAX, 99);
  console.log('checkDataConstants: OK');
}

const teams = require(path.join(__dirname, '..', 'teams.js'));

function checkTeams() {
  assert.strictEqual(teams.TEAMS.length, 30, 'expected exactly 30 teams');
  const ids = teams.TEAMS.map(function (t) { return t.id; });
  assert.strictEqual(new Set(ids).size, 30, 'team ids must be unique');
  teams.TEAMS.forEach(function (t) {
    assert.ok(data.CONFERENCES.includes(t.conference), 'invalid conference: ' + t.conference);
    assert.ok(data.DIVISIONS[t.conference].includes(t.division), 'invalid division: ' + t.division + ' for ' + t.conference);
    assert.ok(t.colors && t.colors.primary && t.colors.secondary, 'missing colors on ' + t.id);
    ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry'].forEach(function (field) {
      assert.ok(t[field] >= 1 && t[field] <= 100, field + ' out of range on ' + t.id);
    });
    assert.strictEqual(t.record.wins, 0);
    assert.strictEqual(t.record.losses, 0);
  });
  assert.strictEqual(teams.getTeamById('BOS').name, 'Boston Celtics');
  assert.strictEqual(teams.getTeamById('nonexistent'), undefined);
  console.log('checkTeams: OK');
}

checkDataConstants();
checkTeams();
console.log('All validations passed');
