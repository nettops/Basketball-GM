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

const toys = rq('historyToys.js');

// Reading only retiredPlayers would leave every toy empty for the first fifteen
// seasons of a save — which is most of the time anyone will look at them. The
// pool is active players PLUS retirees, keyed by id so nobody is double-counted.
function checkPoolIncludesActivePlayers() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  PLAYERS_2026[0].careerStats.points = 5000;
  const pool = toys.candidatePool();
  assert.ok(pool.length >= PLAYERS_2026.length,
    'pool of ' + pool.length + ' is smaller than the ' + PLAYERS_2026.length + ' active players');
  const ids = pool.map(function (p) { return p.playerId; });
  assert.strictEqual(new Set(ids).size, ids.length, 'no player may appear twice in the pool');
  const first = pool.find(function (p) { return p.playerId === PLAYERS_2026[0].id; });
  assert.ok(first && first.production > 0, 'an active player with stats must carry production');

  // A retiree must not be dropped, and must not be listed twice if he also
  // still sits in PLAYERS_2026 under the same id.
  history.LEAGUE_HISTORY.retiredPlayers.push({
    id: 'ghost-1', name: 'Old Timer', careerStats: { points: 9000, rebounds: 1000, assists: 500 },
    awardsWon: [], championshipsWon: 2, hofScore: 140, hallOfFame: true
  });
  const withRetiree = toys.candidatePool();
  const ghost = withRetiree.find(function (p) { return p.playerId === 'ghost-1'; });
  assert.ok(ghost, 'a retiree must be in the pool');
  assert.strictEqual(ghost.production, 10500, 'production is points + rebounds + assists');
  assert.strictEqual(ghost.retired, true);
  assert.strictEqual(ghost.championships, 2);
  console.log('checkPoolIncludesActivePlayers: OK (' + withRetiree.length + ')');
}

// The fixture deliberately carries TWO of everything that gets ranked. With one
// bust in the list, biggestBusts returns the same answer sorted either way, and
// a mutant that reversed the comparator survived; with one pick per slot,
// bestPlayerAtEveryPick has no contest to resolve and a mutant that kept the
// first row instead of the best survived too. A ranking test needs something to
// rank.
function checkDraftToysRankCorrectly() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  const star = PLAYERS_2026[0], dud = PLAYERS_2026[1];
  const okPick = PLAYERS_2026[2], mediumLate = PLAYERS_2026[3], scrub = PLAYERS_2026[4];
  function stats(p, points) { p.careerStats.points = points; p.careerStats.rebounds = 0; p.careerStats.assists = 0; }
  stats(star, 20000);        // pick 40 in 2026 — the great steal
  stats(dud, 10);            // pick 1 in 2026 — the great bust
  stats(okPick, 8000);       // pick 3 in 2026 — a fine top-10 career
  stats(mediumLate, 12000);  // pick 1 in 2027 — beats dud at the same slot
  stats(scrub, 40);          // pick 55 in 2026 — a late pick who was NOT a steal

  history.LEAGUE_HISTORY.draftClasses.push({
    leagueYear: 2026,
    picks: [
      { round: 1, pickNumber: 1, teamId: 'BOS', playerId: dud.id, playerName: dud.name },
      { round: 1, pickNumber: 3, teamId: 'NYK', playerId: okPick.id, playerName: okPick.name },
      { round: 1, pickNumber: 40, teamId: 'LAL', playerId: star.id, playerName: star.name },
      { round: 2, pickNumber: 55, teamId: 'MIA', playerId: scrub.id, playerName: scrub.name }
    ]
  });
  history.LEAGUE_HISTORY.draftClasses.push({
    leagueYear: 2027,
    picks: [
      { round: 1, pickNumber: 1, teamId: 'CHI', playerId: mediumLate.id, playerName: mediumLate.name }
    ]
  });

  const busts = toys.biggestBusts(5);
  assert.strictEqual(busts.length, 3, 'three top-10 picks were made, got ' + busts.length);
  assert.strictEqual(busts[0].playerId, dud.id, 'the WORST top-10 career should rank first');
  assert.strictEqual(busts[busts.length - 1].playerId, mediumLate.id,
    'the best top-10 career should rank last among busts');

  const steals = toys.biggestSteals(5);
  assert.strictEqual(steals.length, 2, 'two picks were made outside the top 10');
  assert.strictEqual(steals[0].playerId, star.id, 'the BEST late pick should rank first');
  assert.strictEqual(steals[1].playerId, scrub.id, 'the worst late pick should rank last');
  assert.ok(!busts.some(function (b) { return b.playerId === star.id; }),
    'a pick outside the top 10 can never be a bust');
  assert.ok(!steals.some(function (s) { return s.playerId === dud.id; }),
    'a top-10 pick can never be a steal');

  const atPick = toys.bestPlayerAtEveryPick();
  assert.strictEqual(atPick.length, 4, 'one row per DISTINCT pick number, got ' + atPick.length);
  assert.deepStrictEqual(atPick.map(function (r) { return r.pickNumber; }), [1, 3, 40, 55],
    'best-at-pick is ordered by pick number ascending');
  assert.strictEqual(atPick[0].playerId, mediumLate.id,
    'pick 1 was used twice and the BETTER career must win it, not the earlier one');

  const classes = toys.draftClassRankings();
  assert.strictEqual(classes.length, 2);
  assert.strictEqual(classes[0].leagueYear, 2026, 'the more productive class ranks first');
  assert.strictEqual(classes[0].production, 28050, 'a class is worth the sum of its picks');
  assert.strictEqual(classes[0].picks, 4);
  assert.strictEqual(classes[1].production, 12000);
  console.log('checkDraftToysRankCorrectly: OK');
}

// A brand new league opens these pages. They must be empty, not broken.
function checkEmptyHistoryReturnsEmptyLists() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  assert.deepStrictEqual(toys.biggestBusts(5), []);
  assert.deepStrictEqual(toys.biggestSteals(5), []);
  assert.deepStrictEqual(toys.draftClassRankings(), []);
  assert.deepStrictEqual(toys.bestPlayerAtEveryPick(), []);
  console.log('checkEmptyHistoryReturnsEmptyLists: OK');
}

checkTeamSeasonsAreRecorded();
checkPlayoffResultsAreClassified();
checkPoolIncludesActivePlayers();
checkDraftToysRankCorrectly();
checkEmptyHistoryReturnsEmptyLists();
console.log('All history toy validations passed');
