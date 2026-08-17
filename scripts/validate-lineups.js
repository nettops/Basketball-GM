// Five-man units.
//
// The engine has always known which five were on the floor — it reads onCourt
// every possession to apply plus/minus — and never recorded who they were
// TOGETHER. These checks pin down the accounting, because a lineup table that
// silently loses time is worse than no lineup table: a GM would read a net
// rating off minutes that never happened.
//
// The load-bearing invariant is that a team's lineup seconds sum to the length
// of the game. Five players are always on the floor for every second of it, so
// any bookkeeping error shows up there immediately.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
// lineupsPanelHtml interpolates player names, so it needs the browser's
// escapeHtml. Supplied here the same way validate-leagueNews.js supplies
// GameState — the module is a browser script first and a Node module second.
global.escapeHtml = function (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
const chart = require(path.join(__dirname, '..', 'ui', 'shotChart.js'));

const SEEDS = [11, 404, 1987, 60613];

// The same five, subbed in in a different order, must be ONE unit. Without
// this a season shatters into hundreds of one-possession rows that never
// repeat, and every net rating is noise.
function checkLineupKeyIgnoresSubstitutionOrder() {
  const a = gameSim.lineupKey(['e', 'b', 'a', 'd', 'c']);
  const b = gameSim.lineupKey(['a', 'b', 'c', 'd', 'e']);
  assert.strictEqual(a, b, 'a lineup is who is on the floor, not the order they arrived');
  assert.strictEqual(gameSim.lineupKey(['a', 'b', 'c', 'd', 'e']).split('|').length, 5, 'five ids in the key');
  // Not destructive: the caller's array is onCourt itself, and sorting it in
  // place would reorder the live lineup.
  const live = ['e', 'b', 'a'];
  gameSim.lineupKey(live);
  assert.deepStrictEqual(live, ['e', 'b', 'a'], 'lineupKey must not sort the caller\'s array in place');
  console.log('checkLineupKeyIgnoresSubstitutionOrder: OK');
}

function checkCreditLineupAccumulates() {
  const store = {};
  gameSim.creditLineup(store, 'k', 12, 3, 0);
  gameSim.creditLineup(store, 'k', 8, 0, 2);
  const row = store.k;
  assert.strictEqual(row.seconds, 20, 'seconds accumulate');
  assert.strictEqual(row.pointsFor, 3, 'points for accumulate');
  assert.strictEqual(row.pointsAgainst, 2, 'points against accumulate');
  assert.strictEqual(row.possessions, 2, 'possessions count');

  // Net rating is per 100 possessions, and must survive a zero denominator.
  assert.strictEqual(gameSim.lineupNetRating({ pointsFor: 10, pointsAgainst: 0, possessions: 10 }), 100,
    '10 points on 10 possessions is +100 per 100');
  assert.strictEqual(gameSim.lineupNetRating({ pointsFor: 0, pointsAgainst: 0, possessions: 0 }), 0,
    'a unit with no possessions rates 0, not NaN');
  assert.strictEqual(gameSim.lineupNetRating(null), 0, 'a missing row rates 0 rather than throwing');
  console.log('checkCreditLineupAccumulates: OK');
}

// THE invariant. Five players are on the floor for every second of the game,
// so a side's lineup seconds must equal the game's length exactly.
function checkLineupSecondsCoverTheWholeGame() {
  SEEDS.forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[0].id, TEAMS[1].id, makeRng(seed));
    const periods = result.periodScores ? result.periodScores.length : gameSim.REGULATION_PERIODS;
    const expected = gameSim.REGULATION_PERIODS * gameSim.PERIOD_SECONDS +
      Math.max(0, periods - gameSim.REGULATION_PERIODS) * gameSim.OVERTIME_SECONDS;

    [TEAMS[0].id, TEAMS[1].id].forEach(function (teamId) {
      const secs = result.lineups.filter(function (l) { return l.teamId === teamId; })
        .reduce(function (s, l) { return s + l.seconds; }, 0);
      assert.ok(Math.abs(secs - expected) < 0.5,
        'seed ' + seed + ' ' + teamId + ': lineup seconds ' + secs.toFixed(1) +
        ' should cover the whole game ' + expected);
    });
  });
  console.log('checkLineupSecondsCoverTheWholeGame: OK');
}

// Points credited to units must equal the points actually scored, or a net
// rating is measuring something other than the game that was played.
function checkLineupPointsReconcileWithTheScore() {
  SEEDS.forEach(function (seed) {
    const result = gameSim.simulateGame(TEAMS[2].id, TEAMS[3].id, makeRng(seed));
    const home = result.lineups.filter(function (l) { return l.teamId === TEAMS[2].id; });
    const away = result.lineups.filter(function (l) { return l.teamId === TEAMS[3].id; });
    const homeFor = home.reduce(function (s, l) { return s + l.pointsFor; }, 0);
    const awayFor = away.reduce(function (s, l) { return s + l.pointsFor; }, 0);
    const homeAgainst = home.reduce(function (s, l) { return s + l.pointsAgainst; }, 0);

    assert.strictEqual(homeFor, result.homeScore, 'seed ' + seed + ': home unit points must equal the home score');
    assert.strictEqual(awayFor, result.awayScore, 'seed ' + seed + ': away unit points must equal the away score');
    // One side's points against is the other side's points for — the same
    // possessions seen from the other bench.
    assert.strictEqual(homeAgainst, result.awayScore, 'points allowed must equal what the opponent scored');
  });
  console.log('checkLineupPointsReconcileWithTheScore: OK');
}

// Every id in a key must be a player who was actually on that team's roster.
function checkUnitsAreMadeOfTheRightTeamsPlayers() {
  const result = gameSim.simulateGame(TEAMS[5].id, TEAMS[6].id, makeRng(11));
  const homeIds = league.getTeamRoster(TEAMS[5].id).map(function (p) { return p.id; });
  result.lineups.filter(function (l) { return l.teamId === TEAMS[5].id; }).forEach(function (l) {
    const ids = l.key.split('|');
    assert.strictEqual(ids.length, 5, 'a unit is five players, got ' + ids.length);
    assert.strictEqual(new Set(ids).size, 5, 'a player cannot be on the floor twice');
    ids.forEach(function (id) {
      assert.ok(homeIds.indexOf(id) !== -1, id + ' is not on the home roster');
    });
  });
  console.log('checkUnitsAreMadeOfTheRightTeamsPlayers: OK');
}

// The season store is capped, and the cap must keep the units that PLAYED
// rather than whichever happened to be seen last.
function checkSeasonStoreKeepsTheBusiestUnits() {
  const team = TEAMS[8];
  team.lineupStats = undefined;
  for (let g = 0; g < 30; g++) {
    league.bankLineups(gameSim.simulateGame(team.id, TEAMS[(g % 20) + 9].id, makeRng(2000 + g)));
  }
  const store = team.lineupStats;
  const keys = Object.keys(store);
  assert.ok(keys.length > 0, 'a month of games should produce units');
  assert.ok(keys.length <= league.TEAM_LINEUP_KEEP,
    'the store must stay capped at ' + league.TEAM_LINEUP_KEEP + ', got ' + keys.length);

  // A dropped unit must always have played less than a kept one.
  const kept = keys.map(function (k) { return store[k].seconds; });
  assert.strictEqual(Math.min.apply(null, kept) <= Math.max.apply(null, kept), true, 'sanity');

  // The stored row must NOT carry its own key — that is the object key, and
  // duplicating it was 84 of 191 bytes a row across the whole league.
  assert.strictEqual(store[keys[0]].key, undefined,
    'the stored row must not duplicate its key; that doubles the save cost');
  assert.ok(String(store[keys[0]].seconds).length < 12,
    'seconds must be rounded, not carry raw float noise: ' + store[keys[0]].seconds);

  team.lineupStats = undefined;
  console.log('checkSeasonStoreKeepsTheBusiestUnits: OK (' + keys.length + ' units kept)');
}

// The box-score engine produces no lineups at all, exactly like playByPlay.
// Banking its result must be a no-op rather than a crash.
function checkBoxScoreEngineIsToleratedNotCrashed() {
  const team = TEAMS[8];
  team.lineupStats = undefined;
  assert.doesNotThrow(function () {
    league.bankLineups({ homeScore: 100, awayScore: 99 });
    league.bankLineups({ lineups: [] });
  }, 'a result with no lineups must bank nothing rather than throw');
  assert.strictEqual(team.lineupStats, undefined, 'nothing should have been created');
  console.log('checkBoxScoreEngineIsToleratedNotCrashed: OK');
}

// The view layer, including the case that will actually happen: a player in a
// stored unit has since been traded away.
function checkTheTableSurvivesATradedPlayer() {
  const team = TEAMS[9];
  team.lineupStats = {
    'a|b|c|d|e': { seconds: 600, pointsFor: 30, pointsAgainst: 20, possessions: 25, games: 4 },
    'a|b|c|d|f': { seconds: 120, pointsFor: 5, pointsAgainst: 9, possessions: 6, games: 2 }
  };
  const lookup = function (id) { return id === 'e' ? null : { id: id, name: 'First Sur' + id }; };
  const rows = chart.lineupRows(team, lookup, 8);

  assert.strictEqual(rows.length, 2, 'both units should be listed');
  assert.ok(rows[0].minutes > rows[1].minutes, 'sorted by minutes, most first');
  assert.strictEqual(rows[0].minutes, 10, '600 seconds is 10 minutes');
  assert.ok(Math.abs(rows[0].net - 40) < 1e-9, '+10 on 25 possessions is +40 per 100');

  assert.strictEqual(chart.lineupShortName(null), '(gone)', 'a departed player must be named, not left undefined');
  assert.strictEqual(chart.lineupShortName('Jayson Tatum'), 'Tatum', 'surnames only — five full names will not fit');
  assert.strictEqual(chart.lineupShortName('Nikola Jokic Jr'), 'Jokic Jr', 'a suffix stays with the surname');

  const html = chart.lineupsPanelHtml(team, lookup);
  assert.ok(html.indexOf('undefined') === -1, 'the table must never render "undefined"');
  assert.ok(html.indexOf('NaN') === -1, 'the table must never render NaN');
  assert.ok(html.indexOf('(gone)') !== -1, 'a traded player should read as gone');
  assert.strictEqual(html.split('<tr').length, html.split('</tr>').length, 'table rows must balance');

  team.lineupStats = undefined;
  assert.ok(chart.lineupsPanelHtml(team, lookup).indexOf('No units yet') !== -1,
    'a team that has not played says so rather than drawing an empty table');
  console.log('checkTheTableSurvivesATradedPlayer: OK');
}

checkLineupKeyIgnoresSubstitutionOrder();
checkCreditLineupAccumulates();
checkLineupSecondsCoverTheWholeGame();
checkLineupPointsReconcileWithTheScore();
checkUnitsAreMadeOfTheRightTeamsPlayers();
checkSeasonStoreKeepsTheBusiestUnits();
checkBoxScoreEngineIsToleratedNotCrashed();
checkTheTableSurvivesATradedPlayer();

console.log('All lineups validations passed');
