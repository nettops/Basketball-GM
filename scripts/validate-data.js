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
    assert.strictEqual(teams.getTeamLogoUrl(t.id), 'assets/logos/' + t.id + '.png', 'unexpected logo URL for ' + t.id);
    ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry'].forEach(function (field) {
      assert.ok(t[field] >= 1 && t[field] <= 100, field + ' out of range on ' + t.id);
    });
    assert.ok(['rebuilding', 'retooling', 'win-now'].includes(t.timeline), 'invalid timeline on ' + t.id);
    assert.ok(t.marketSize >= 1 && t.marketSize <= 100, 'invalid marketSize on ' + t.id);
    assert.strictEqual(t.draftPicks.length, 2, t.id + ' should start with exactly 2 owned picks');
    assert.deepStrictEqual(t.draftPicks.map(function (p) { return p.round; }), [1, 2]);
    t.draftPicks.forEach(function (p) {
      assert.strictEqual(p.originalTeamId, t.id);
      assert.strictEqual(p.currentOwnerId, t.id);
    });
    assert.strictEqual(t.record.wins, 0);
    assert.strictEqual(t.record.losses, 0);
  });
  assert.strictEqual(teams.getTeamById('BOS').name, 'Boston Celtics');
  assert.strictEqual(teams.getTeamById('nonexistent'), undefined);
  console.log('checkTeams: OK');
}

const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));

function checkPlayers() {
  const players = playersModule.PLAYERS_2026;
  const ids = players.map(function (p) { return p.id; });
  assert.strictEqual(new Set(ids).size, ids.length, 'player ids must be unique');

  const jerseyByTeam = {};

  players.forEach(function (p) {
    assert.ok(teams.getTeamById(p.teamId), 'unknown teamId: ' + p.teamId + ' on ' + p.id);
    assert.ok(data.POSITIONS.includes(p.position), 'invalid position: ' + p.position + ' on ' + p.id);
    assert.ok(p.age >= 18 && p.age <= 45, 'age out of range on ' + p.id);
    assert.ok(p.jerseyNumber >= 0 && p.jerseyNumber <= 99, 'jersey number out of range on ' + p.id);

    jerseyByTeam[p.teamId] = jerseyByTeam[p.teamId] || new Set();
    assert.ok(!jerseyByTeam[p.teamId].has(p.jerseyNumber), 'duplicate jersey number ' + p.jerseyNumber + ' on team ' + p.teamId);
    jerseyByTeam[p.teamId].add(p.jerseyNumber);

    assert.ok(p.overall >= data.RATING_MIN && p.overall <= data.RATING_MAX, 'overall out of range on ' + p.id);
    assert.ok(p.potential >= data.RATING_MIN && p.potential <= data.RATING_MAX, 'potential out of range on ' + p.id);
    assert.ok(p.potential >= p.overall, 'potential must be >= overall on ' + p.id);

    data.ATTRIBUTE_KEYS.forEach(function (key) {
      const val = p.attributes[key];
      assert.ok(val >= data.RATING_MIN && val <= data.RATING_MAX, 'attribute ' + key + ' out of range on ' + p.id);
    });

    assert.ok(p.contract.salary > 0, 'salary must be positive on ' + p.id);
    assert.ok(p.contract.yearsRemaining >= 1 && p.contract.yearsRemaining <= 6, 'yearsRemaining out of range on ' + p.id);
    assert.ok(!(p.contract.playerOption && p.contract.teamOption), 'playerOption and teamOption both true on ' + p.id);

    assert.strictEqual(p.status.injury, null, 'injury must be null in Phase 1 on ' + p.id);
    assert.deepStrictEqual(p.hiddenTraits, [], 'hiddenTraits must be empty stub in Phase 1 on ' + p.id);
    assert.deepStrictEqual(p.hiddenPersonality, {}, 'hiddenPersonality must be empty stub in Phase 1 on ' + p.id);
  });

  // Any team that has been populated so far must have 12-15 players. Teams not
  // yet reached by the current division-batch task (0 players) are skipped here;
  // full 30-team coverage is asserted separately once every division is done.
  const teamsWithPlayers = new Set(players.map(function (p) { return p.teamId; }));
  teamsWithPlayers.forEach(function (teamId) {
    const count = players.filter(function (p) { return p.teamId === teamId; }).length;
    assert.ok(count >= 12 && count <= 15, teamId + ' roster size out of range: ' + count);
  });

  console.log('checkPlayers: OK (' + players.length + ' players, ' + teamsWithPlayers.size + '/30 teams populated)');

  if (teamsWithPlayers.size === 30) {
    teams.TEAMS.forEach(function (t) {
      assert.ok(teamsWithPlayers.has(t.id), 'team ' + t.id + ' has no players even though 30 teams reported populated');
    });
    console.log('checkAllTeamsPopulated: OK (all 30 teams have real rosters)');
  }
}

checkDataConstants();
checkTeams();
checkPlayers();
console.log('All validations passed');
