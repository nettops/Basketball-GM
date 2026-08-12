// History superlatives. Each toy is asserted against a constructed history
// with a known right answer, so a ranking bug shows up as a wrong order rather
// than as a crash.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const history = rq('history.js');

function checkTeamSeasonsAreRecorded() {
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  TEAMS.forEach(function (t, i) { t.record = { wins: 20 + i, losses: 62 - i }; });
  const bracket = null;   // no playoffs played
  history.finalizeSeasonHistory(2026, bracket, function () {});

  const rows = history.LEAGUE_HISTORY.teamSeasons.filter(function (r) { return r.leagueYear === 2026; });
  assert.strictEqual(rows.length, TEAMS.length,
    'expected one row per team, got ' + rows.length + ' for ' + TEAMS.length + ' teams');
  rows.forEach(function (r) {
    assert.ok(typeof r.wins === 'number' && typeof r.losses === 'number', 'wins/losses must be numbers');
    assert.ok(r.playoffResult, 'every row needs a playoff result');
    assert.strictEqual(typeof r.champion, 'boolean');
  });
  assert.strictEqual(rows.filter(function (r) { return r.champion; }).length, 0,
    'no bracket means no champion');

  // The row must capture the season that just ENDED, not the reset that
  // follows it. finalizeSeasonHistory folds record into allTime, so a row
  // written a line too late records zeros for all thirty teams and no test
  // that only counts rows would notice.
  const bos = rows.find(function (r) { return r.teamId === TEAMS[0].id; });
  assert.strictEqual(bos.wins, 20,
    'the row must hold the finished season, got ' + bos.wins + ' wins for a 20-win team');
  console.log('checkTeamSeasonsAreRecorded: OK (' + rows.length + ' rows)');
}

// The null-bracket case above cannot see the classifier at all: with no
// playoffs every team is 'missed' whatever the code does, so a
// playoffResultLabel hard-wired to return 'missed' passed it. This plays a
// bracket and asserts each finish separately.
function checkPlayoffResultsAreClassified() {
  const id = TEAMS.map(function (t) { return t.id; });
  const CHAMP = id[0], RUNNER = id[1], LOST_CF = id[2], LOST_CSF = id[3], LOST_R1 = id[4], MISSED = id[5];
  const series = function (hi, lo, winner) { return { higherSeed: hi, lowerSeed: lo, winner: winner }; };
  const bracket = {
    first: [series(CHAMP, LOST_R1, CHAMP)],
    semis: [series(CHAMP, LOST_CSF, CHAMP)],
    confFinals: [series(CHAMP, LOST_CF, CHAMP)],
    finals: [series(CHAMP, RUNNER, CHAMP)]
  };

  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  TEAMS.forEach(function (t, i) { t.record = { wins: 41, losses: 41, pointsFor: 0, pointsAgainst: 0 }; });
  history.finalizeSeasonHistory(2027, bracket, function () {});

  const rows = {};
  history.LEAGUE_HISTORY.teamSeasons
    .filter(function (r) { return r.leagueYear === 2027; })
    .forEach(function (r) { rows[r.teamId] = r; });

  assert.strictEqual(rows[CHAMP].playoffResult, 'champion');
  assert.strictEqual(rows[RUNNER].playoffResult, 'lostFinals');
  assert.strictEqual(rows[LOST_CF].playoffResult, 'lostCF');
  assert.strictEqual(rows[LOST_CSF].playoffResult, 'lostCSF');
  assert.strictEqual(rows[LOST_R1].playoffResult, 'lostR1');
  assert.strictEqual(rows[MISSED].playoffResult, 'missed',
    'a team absent from the bracket never played a playoff game');

  assert.strictEqual(rows[CHAMP].champion, true);
  assert.strictEqual(rows[RUNNER].champion, false, 'losing the finals is not winning them');
  const champions = Object.keys(rows).filter(function (k) { return rows[k].champion; });
  assert.strictEqual(champions.length, 1, 'exactly one champion a season, got ' + champions.length);
  console.log('checkPlayoffResultsAreClassified: OK');
}

checkTeamSeasonsAreRecorded();
checkPlayoffResultsAreClassified();
console.log('All history toy validations passed');
