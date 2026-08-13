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
  // The components travel with the total. The Frivolities rows print these
  // three real stats rather than the total under an invented unit, so a pool
  // entry that carries only the sum silently renders every row as 0 pts.
  assert.deepStrictEqual(ghost.parts, { points: 9000, rebounds: 1000, assists: 500 },
    'the pool must carry the three stats the ranking is made of, not just their sum');
  assert.strictEqual(
    ghost.parts.points + ghost.parts.rebounds + ghost.parts.assists, ghost.production,
    'the printed components must add up to the number the list is sorted on');
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

  // 2031 is "now": both fixture classes (2026, 2027) are at least
  // DRAFT_VERDICT_MIN_SEASONS old, so every pick in them is judgeable.
  const NOW = 2031;
  const busts = toys.biggestBusts(5, NOW);
  assert.strictEqual(busts.length, 3, 'three top-10 picks were made, got ' + busts.length);
  // Draft rows print the components too, and they come from the pool via a
  // join on player id — a pick whose player is missing from the pool must
  // still render zeros rather than throw.
  busts.forEach(function (b) {
    assert.ok(b.parts && typeof b.parts.points === 'number',
      'every pick row must carry the stats its line prints');
    assert.strictEqual(b.parts.points + b.parts.rebounds + b.parts.assists, b.production);
  });
  assert.strictEqual(busts[0].playerId, dud.id, 'the WORST top-10 career should rank first');
  assert.strictEqual(busts[busts.length - 1].playerId, mediumLate.id,
    'the best top-10 career should rank last among busts');

  const steals = toys.biggestSteals(5, NOW);
  assert.strictEqual(steals.length, 2, 'two picks were made outside the top 10');
  assert.strictEqual(steals[0].playerId, star.id, 'the BEST late pick should rank first');
  assert.strictEqual(steals[1].playerId, scrub.id, 'the worst late pick should rank last');
  assert.ok(!busts.some(function (b) { return b.playerId === star.id; }),
    'a pick outside the top 10 can never be a bust');
  assert.ok(!steals.some(function (s) { return s.playerId === dud.id; }),
    'a top-10 pick can never be a steal');

  const atPick = toys.bestPlayerAtEveryPick(NOW);
  assert.strictEqual(atPick.length, 4, 'one row per DISTINCT pick number, got ' + atPick.length);
  assert.deepStrictEqual(atPick.map(function (r) { return r.pickNumber; }), [1, 3, 40, 55],
    'best-at-pick is ordered by pick number ascending');
  assert.strictEqual(atPick[0].playerId, mediumLate.id,
    'pick 1 was used twice and the BETTER career must win it, not the earlier one');

  const classes = toys.draftClassRankings(NOW);
  assert.strictEqual(classes.length, 2);
  assert.strictEqual(classes[0].leagueYear, 2026, 'the more productive class ranks first');
  assert.strictEqual(classes[0].production, 28050, 'a class is worth the sum of its picks');
  assert.strictEqual(classes[0].picks, 4);
  assert.strictEqual(classes[1].production, 12000);
  console.log('checkDraftToysRankCorrectly: OK');
}

// A brand new league opens these pages. They must be empty, not broken.
// A verdict on a draft pick needs time, exactly as a verdict on a trade does.
// Without this rule "Biggest Busts" is topped by whoever was drafted last week:
// on a real 25-season league, 11 of the 15 rows had a career of literally zero
// because 10 of them had been drafted that summer and had never played a game.
function checkRecentPicksAreNotJudged() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  const veteran = PLAYERS_2026[30], rookie = PLAYERS_2026[31];
  veteran.careerStats.points = 9000; veteran.careerStats.rebounds = 0; veteran.careerStats.assists = 0;
  rookie.careerStats.points = 0; rookie.careerStats.rebounds = 0; rookie.careerStats.assists = 0;

  history.LEAGUE_HISTORY.draftClasses.push(
    { leagueYear: 2040, picks: [{ round: 1, pickNumber: 2, teamId: 'BOS', playerId: veteran.id, playerName: veteran.name }] },
    { leagueYear: 2046, picks: [{ round: 1, pickNumber: 1, teamId: 'LAL', playerId: rookie.id, playerName: rookie.name }] }
  );

  // 2046 is the newest class, so it is "now" and the rookie is 0 seasons old.
  const busts = toys.biggestBusts(10);
  assert.ok(!busts.some(function (b) { return b.playerId === rookie.id; }),
    'a player drafted this year has not had a career yet and cannot be a bust');
  assert.ok(busts.some(function (b) { return b.playerId === veteran.id; }),
    'a pick six seasons old must still be judged');

  // The boundary, asserted from both sides rather than assumed.
  const gap = toys.DRAFT_VERDICT_MIN_SEASONS;
  assert.strictEqual(toys.judgeablePickRows(2046 + gap - 1)
    .filter(function (r) { return r.leagueYear === 2046; }).length, 0,
    'one season short of the bar must not be judged');
  assert.strictEqual(toys.judgeablePickRows(2046 + gap)
    .filter(function (r) { return r.leagueYear === 2046; }).length, 1,
    'exactly at the bar must be judged');

  assert.strictEqual(toys.latestDraftYear(), 2046,
    '"now" is derived from the newest class in the archive');
  // A class too new to judge must not be RANKED either — it would sit at the
  // bottom of the table looking like the worst class in history.
  assert.ok(!toys.draftClassRankings().some(function (c) { return c.leagueYear === 2046; }),
    'a class nobody has had time to judge must not be ranked at all');
  console.log('checkRecentPicksAreNotJudged: OK (bar ' + gap + ' seasons)');
}

function checkEmptyHistoryReturnsEmptyLists() {
  history.LEAGUE_HISTORY.draftClasses.length = 0;
  // No year passed: with no classes at all there is no "now" to derive, and
  // every list must still come back empty rather than throwing on -Infinity.
  assert.deepStrictEqual(toys.biggestBusts(5), []);
  assert.deepStrictEqual(toys.biggestSteals(5), []);
  assert.deepStrictEqual(toys.draftClassRankings(), []);
  assert.deepStrictEqual(toys.bestPlayerAtEveryPick(), []);
  console.log('checkEmptyHistoryReturnsEmptyLists: OK');
}

function checkCareerToys() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.ensureCareerData(PLAYERS_2026);
  const ringless = PLAYERS_2026[6], champ = PLAYERS_2026[7];
  ringless.careerStats.points = 30000; ringless.careerStats.rebounds = 0; ringless.careerStats.assists = 0;
  ringless.championshipsWon = 0; ringless.awardsWon = [];
  champ.careerStats.points = 31000; champ.careerStats.rebounds = 0; champ.careerStats.assists = 0;
  champ.championshipsWon = 3; champ.awardsWon = [];

  const noRing = toys.bestWithoutARing(5);
  assert.strictEqual(noRing[0].playerId, ringless.id,
    'the most productive ringless player should rank first');
  assert.ok(!noRing.some(function (r) { return r.playerId === champ.id; }),
    'a player with a ring must never appear');

  champ.awardsWon = [{ award: 'mvp', leagueYear: 2030 }];
  const noMvp = toys.bestWithoutAnMvp(5);
  assert.ok(!noMvp.some(function (r) { return r.playerId === champ.id; }),
    'an MVP winner must never appear in best-without-an-MVP');
  assert.ok(noMvp.some(function (r) { return r.playerId === ringless.id; }),
    'a player who never won MVP must appear');

  // Earnings come from the contract history, not from the current salary.
  const earner = PLAYERS_2026[8], pauper = PLAYERS_2026[9];
  earner.careerHistory.contractHistory = [
    { season: 2026, salary: 10000000, yearsRemaining: 2, teamId: 'BOS', type: 'free_agency' },
    { season: 2028, salary: 20000000, yearsRemaining: 3, teamId: 'BOS', type: 're_signing' }
  ];
  pauper.careerHistory.contractHistory = [
    { season: 2026, salary: 1200000, yearsRemaining: 1, teamId: 'MIA', type: 'free_agency' }
  ];
  const earnings = toys.careerEarnings(400);
  const row = earnings.find(function (e) { return e.playerId === earner.id; });
  assert.ok(row, 'a player with contracts must appear in career earnings');
  assert.strictEqual(row.earnings, 10000000 * 2 + 20000000 * 3,
    'earnings are salary times years for each contract signed');
  const earnerAt = earnings.indexOf(row);
  const pauperAt = earnings.findIndex(function (e) { return e.playerId === pauper.id; });
  assert.ok(pauperAt > earnerAt, 'the bigger earner must rank above the smaller one');

  // Longest unbroken spell with one franchise.
  const loyal = PLAYERS_2026[10], journeyman = PLAYERS_2026[11];
  loyal.careerHistory.teamHistory = [
    { teamId: 'BOS', startSeason: 2026, endSeason: null, seasons: 14 }
  ];
  journeyman.careerHistory.teamHistory = [
    { teamId: 'BOS', startSeason: 2026, endSeason: 2028, seasons: 3 },
    { teamId: 'MIA', startSeason: 2029, endSeason: 2030, seasons: 2 }
  ];
  const loyalty = toys.mostYearsOneTeam(400);
  const loyalRow = loyalty.find(function (r) { return r.playerId === loyal.id; });
  assert.ok(loyalRow, 'a player with a team history must appear');
  assert.strictEqual(loyalRow.years, 14);
  assert.strictEqual(loyalRow.teamId, 'BOS');
  const jRow = loyalty.find(function (r) { return r.playerId === journeyman.id; });
  assert.strictEqual(jRow.years, 3, 'the LONGEST spell counts, not the total or the last');
  assert.ok(loyalty.indexOf(loyalRow) < loyalty.indexOf(jRow), 'longer tenure ranks first');
  console.log('checkCareerToys: OK');
}

// A retiree keeps no careerHistory in the archive, so tenure and earnings would
// silently list only active players — every one of these lists would forget its
// own history the moment a career ended, which is precisely backwards for a
// history toy. archiveRetiree now banks the two scalars they need.
function checkRetireesKeepTenureAndEarnings() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  const p = PLAYERS_2026[12];
  history.ensureCareerData([p]);
  p.careerStats.points = 25000; p.careerStats.rebounds = 0; p.careerStats.assists = 0;
  p.careerHistory.teamHistory = [
    { teamId: 'BOS', startSeason: 2026, endSeason: 2033, seasons: 8 },
    { teamId: 'NYK', startSeason: 2034, endSeason: 2036, seasons: 3 }
  ];
  p.careerHistory.contractHistory = [
    { season: 2026, salary: 5000000, yearsRemaining: 4, teamId: 'BOS', type: 'rookie' },
    { season: 2030, salary: 30000000, yearsRemaining: 4, teamId: 'BOS', type: 're_signing' }
  ];
  const archived = history.archiveRetiree(p, 2037);
  assert.strictEqual(archived.longestTenure, 8, 'the archive must bank the longest spell');
  assert.strictEqual(archived.careerEarnings, 5000000 * 4 + 30000000 * 4,
    'the archive must bank total earnings');

  // Retirement SPLICES the player out of PLAYERS_2026 (seasonTransition.js),
  // and the fixture has to do the same. Leaving him in the active array meant
  // the active branch answered from his still-intact careerHistory and the
  // retiree branch was never reached — mutants that dropped retirees from both
  // lists entirely survived, because a retiree was never actually tested.
  const idx = PLAYERS_2026.indexOf(p);
  assert.notStrictEqual(idx, -1, 'fixture precondition: the player starts out active');
  PLAYERS_2026.splice(idx, 1);
  try {
    assert.ok(!toys.candidatePool().some(function (c) { return c.playerId === p.id && !c.retired; }),
      'precondition: he must no longer be reachable as an active player');
    const tenure = toys.mostYearsOneTeam(400).find(function (r) { return r.playerId === p.id; });
    assert.ok(tenure, 'a retiree must still appear in most-years-with-one-team');
    assert.strictEqual(tenure.years, 8);
    assert.strictEqual(tenure.teamId, 'BOS', 'and must name the team he spent them with');
    const paid = toys.careerEarnings(400).find(function (r) { return r.playerId === p.id; });
    assert.ok(paid, 'a retiree must still appear in career earnings');
    assert.strictEqual(paid.earnings, 140000000);
  } finally {
    PLAYERS_2026.splice(idx, 0, p);
  }
  console.log('checkRetireesKeepTenureAndEarnings: OK');
}

function checkMostTeams() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  const wanderer = PLAYERS_2026[13], homebody = PLAYERS_2026[14];
  wanderer.teamsPlayedFor = ['BOS', 'MIA', 'LAL', 'CHI', 'NYK', 'PHX'];
  homebody.teamsPlayedFor = ['BOS'];
  const list = toys.mostTeams(400);
  const w = list.find(function (r) { return r.playerId === wanderer.id; });
  const h = list.find(function (r) { return r.playerId === homebody.id; });
  assert.strictEqual(w.teams, 6);
  assert.strictEqual(h.teams, 1);
  assert.ok(list.indexOf(w) < list.indexOf(h), 'more teams ranks first');
  const ids = list.map(function (r) { return r.playerId; });
  assert.strictEqual(new Set(ids).size, ids.length, 'no player may be listed twice');
  console.log('checkMostTeams: OK');
}

// Families take the better part of twenty seasons to appear, by which time half
// of any pair has usually retired — so a listing that reads only the active
// league drops most of them. Measured: one of three families shown in a real
// twenty-season save.
function checkFamiliesIncludeRetirees() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  const active = PLAYERS_2026[20], gone = PLAYERS_2026[21];
  active.relatives = [{ type: 'brother', playerId: 'ret-1', name: 'Retired Brother' }];
  gone.relatives = [];
  history.LEAGUE_HISTORY.retiredPlayers.push(
    { id: 'ret-1', name: 'Retired Brother', careerStats: {}, awardsWon: [], championshipsWon: 0,
      relatives: [{ type: 'brother', playerId: active.id, name: active.name }] },
    { id: 'ret-2', name: 'Old Father', careerStats: {}, awardsWon: [], championshipsWon: 0,
      relatives: [{ type: 'son', playerId: 'ret-3', name: 'Old Son' }] },
    { id: 'ret-3', name: 'Old Son', careerStats: {}, awardsWon: [], championshipsWon: 0,
      relatives: [{ type: 'father', playerId: 'ret-2', name: 'Old Father' }] }
  );

  const list = toys.families();
  assert.strictEqual(list.length, 2,
    'expected two families — one part-retired, one wholly retired — got ' + list.length);
  assert.ok(list.some(function (f) { return f.a === active.name || f.b === active.name; }),
    'the pair with one active member must appear');
  assert.ok(list.some(function (f) { return f.a === 'Old Father' || f.b === 'Old Father'; }),
    'a family where BOTH members have retired must still appear');

  // Both ends carry a link, so a pair must not be listed from each end.
  const keys = list.map(function (f) { return [f.aId, f.bId].sort().join('|'); });
  assert.strictEqual(new Set(keys).size, keys.length, 'no family may be listed twice');

  active.relatives = [];
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  console.log('checkFamiliesIncludeRetirees: OK');
}

function checkHallOfVeryGood() {
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.push(
    { id: 'r1', name: 'Just In', careerStats: {}, awardsWon: [], championshipsWon: 0, hofScore: 120, hallOfFame: true },
    { id: 'r2', name: 'Just Out', careerStats: {}, awardsWon: [], championshipsWon: 0, hofScore: 95, hallOfFame: false },
    { id: 'r3', name: 'Well Out', careerStats: {}, awardsWon: [], championshipsWon: 0, hofScore: 40, hallOfFame: false }
  );
  const list = toys.hallOfVeryGood(5);
  assert.strictEqual(list.length, 2, 'only the non-inducted belong in the Hall of Very Good');
  assert.strictEqual(list[0].playerId, 'r2', 'the highest score that fell short ranks first');
  assert.strictEqual(list[1].playerId, 'r3');
  assert.ok(!list.some(function (r) { return r.playerId === 'r1'; }),
    'an inductee must never appear');
  console.log('checkHallOfVeryGood: OK');
}

function checkTeamSeasonToys() {
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.push(
    { leagueYear: 2030, teamId: 'BOS', wins: 70, losses: 12, playoffResult: 'lostR1', champion: false },
    { leagueYear: 2031, teamId: 'LAL', wins: 41, losses: 41, playoffResult: 'champion', champion: true },
    { leagueYear: 2032, teamId: 'CHI', wins: 60, losses: 22, playoffResult: 'missed', champion: false },
    { leagueYear: 2033, teamId: 'PHX', wins: 9, losses: 73, playoffResult: 'missed', champion: false },
    { leagueYear: 2034, teamId: 'MIA', wins: 55, losses: 27, playoffResult: 'champion', champion: true },
    { leagueYear: 2035, teamId: 'NYK', wins: 30, losses: 52, playoffResult: 'missed', champion: false }
  );
  assert.strictEqual(toys.bestTeams(1)[0].wins, 70);
  assert.strictEqual(toys.bestTeams(2)[1].wins, 60, 'best teams descend by wins');
  assert.strictEqual(toys.worstTeams(1)[0].wins, 9);
  assert.strictEqual(toys.worstTeams(2)[1].wins, 30, 'worst teams ascend by wins');

  const missed = toys.bestToMissThePlayoffs(5);
  assert.strictEqual(missed[0].teamId, 'CHI', '60 wins and no playoffs is the best team to miss');
  assert.ok(!missed.some(function (r) { return r.teamId === 'BOS'; }),
    'a team that lost in round one did NOT miss the playoffs');
  assert.deepStrictEqual(missed.map(function (r) { return r.teamId; }), ['CHI', 'NYK', 'PHX'],
    'the list descends by wins: 60, 30, 9');

  const worstChamps = toys.worstToWinIt(5);
  assert.strictEqual(worstChamps.length, 2, 'only champions belong here');
  assert.strictEqual(worstChamps[0].teamId, 'LAL', 'a 41-win champion is the worst team to win it');
  assert.strictEqual(worstChamps[1].teamId, 'MIA');
  assert.ok(!worstChamps.some(function (r) { return r.teamId === 'PHX'; }),
    'a 9-win team that won nothing must never appear among champions');

  // The toys must not hand out the array LEAGUE_HISTORY is holding: sorting a
  // returned reference in place would silently reorder the stored history.
  const before = history.LEAGUE_HISTORY.teamSeasons.map(function (r) { return r.teamId; });
  toys.bestTeams(10);
  assert.deepStrictEqual(history.LEAGUE_HISTORY.teamSeasons.map(function (r) { return r.teamId; }), before,
    'ranking a toy must not reorder the stored history');
  console.log('checkTeamSeasonToys: OK');
}

function checkLopsidedTradesNeedTime() {
  history.LEAGUE_HISTORY.trades.length = 0;
  const a = PLAYERS_2026[15], b = PLAYERS_2026[16];
  [a, b].forEach(function (p) {
    p.careerHistory = p.careerHistory || {};
    p.careerHistory.seasonByYear = {};
  });
  // a explodes after the trade; b does nothing. The 2030 rows are the control:
  // production BEFORE the trade year must not count toward the verdict.
  a.careerHistory.seasonByYear[2030] = { season: 2030, points: 9000, rebounds: 0, assists: 0 };
  b.careerHistory.seasonByYear[2030] = { season: 2030, points: 9000, rebounds: 0, assists: 0 };
  a.careerHistory.seasonByYear[2031] = { season: 2031, points: 2000, rebounds: 500, assists: 500 };
  b.careerHistory.seasonByYear[2031] = { season: 2031, points: 10, rebounds: 0, assists: 0 };

  history.LEAGUE_HISTORY.trades.push({
    leagueYear: 2030, participants: ['BOS', 'LAL'],
    players: [
      { playerId: a.id, playerName: a.name, fromTeamId: 'BOS', toTeamId: 'LAL' },
      { playerId: b.id, playerName: b.name, fromTeamId: 'LAL', toTeamId: 'BOS' }
    ],
    picks: []
  });
  // Too recent to judge.
  assert.deepStrictEqual(toys.mostLopsidedTrades(5, 2032), [],
    'a trade less than ' + toys.LOPSIDED_MIN_SEASONS + ' seasons old must not be judged');
  // Biggest Trades does NOT wait. It ranks on how big the names were, which is
  // knowable the day the trade happens; only the verdict on who WON needs time.
  assert.strictEqual(toys.biggestTrades(5).length, 1,
    'the biggest-trades list must not sit empty waiting three seasons');

  const judged = toys.mostLopsidedTrades(5, 2035);
  assert.strictEqual(judged.length, 1, 'an old enough trade must be judged');
  assert.strictEqual(judged[0].difference, 2990,
    'lopsidedness counts only the seasons AFTER the trade, got ' + judged[0].difference);
  assert.strictEqual(judged[0].combined, 3010,
    'and so does the combined total, got ' + judged[0].combined);
  assert.strictEqual(judged[0].bySide.LAL, 3000, 'LAL received the player who exploded');
  assert.strictEqual(judged[0].bySide.BOS, 10);
  console.log('checkLopsidedTradesNeedTime: OK');
}

// The defect that made this whole toy lie. A traded player is looked up to see
// what he did after the deal — but a retired player is spliced out of
// PLAYERS_2026, so his side silently scored zero. And because a trade is only
// judged three seasons on, retirement is the NORMAL case.
//
// Measured before the fix: an even trade (2,600 against 2,900) read as 2,600
// against 0 once one side retired. It did not merely under-count, it INVERTED
// the answer and manufactured the most lopsided trade in league history out of
// a fair swap.
function checkARetiredPlayerStillCountsInATrade() {
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  const a = PLAYERS_2026[17], b = PLAYERS_2026[18];
  history.ensureCareerData([a, b]);
  a.careerHistory.seasonByYear = { 2031: { season: 2031, points: 2000, rebounds: 500, assists: 400 } };
  b.careerHistory.seasonByYear = { 2031: { season: 2031, points: 1900, rebounds: 400, assists: 300 } };

  history.LEAGUE_HISTORY.trades.push({
    leagueYear: 2030, participants: ['BOS', 'LAL'],
    players: [
      { playerId: a.id, playerName: a.name, fromTeamId: 'BOS', toTeamId: 'LAL' },
      { playerId: b.id, playerName: b.name, fromTeamId: 'LAL', toTeamId: 'BOS' }
    ],
    picks: []
  });

  const before = toys.mostLopsidedTrades(5, 2040)[0];
  assert.strictEqual(before.bySide.LAL, 2900);
  assert.strictEqual(before.bySide.BOS, 2600);

  // Retire B exactly as the game does: archive him, then splice him out.
  b.teamId = null;
  const archived = history.archiveRetiree(b, 2035);
  assert.ok(archived.productionByYear,
    'the archive must bank per-season production — a career total cannot answer ' +
    '"what did he do AFTER 2030"');
  assert.strictEqual(archived.productionByYear[2031], 2600);
  const idx = PLAYERS_2026.indexOf(b);
  PLAYERS_2026.splice(idx, 1);

  const after = toys.mostLopsidedTrades(5, 2040)[0];
  assert.strictEqual(after.bySide.BOS, 2600,
    'a retired player must still count for the side that received him, got ' + after.bySide.BOS);
  assert.strictEqual(after.bySide.LAL, 2900, 'and the active side must be unchanged');
  assert.strictEqual(after.difference, before.difference,
    'retiring must not change the verdict at all — it changed it from ' +
    before.difference + ' to ' + after.difference);

  PLAYERS_2026.splice(idx, 0, b);
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  console.log('checkARetiredPlayerStillCountsInATrade: OK');
}

// Star power is a different question from who won, and answered from career
// totals rather than from what happened next.
function checkBiggestTradesRankOnTheNames() {
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  const star = PLAYERS_2026[19], scrub = PLAYERS_2026[20];
  history.ensureCareerData([star, scrub]);
  star.careerStats.points = 30000; star.careerStats.rebounds = 0; star.careerStats.assists = 0;
  scrub.careerStats.points = 50; scrub.careerStats.rebounds = 0; scrub.careerStats.assists = 0;

  history.LEAGUE_HISTORY.trades.push(
    { leagueYear: 2049, participants: ['BOS', 'LAL'],
      players: [{ playerId: star.id, playerName: star.name, fromTeamId: 'BOS', toTeamId: 'LAL' }], picks: [] },
    { leagueYear: 2049, participants: ['CHI', 'MIA'],
      players: [{ playerId: scrub.id, playerName: scrub.name, fromTeamId: 'CHI', toTeamId: 'MIA' }], picks: [] }
  );

  const big = toys.biggestTrades(5);
  assert.strictEqual(big.length, 2, 'a trade from last season is still a trade');
  assert.strictEqual(big[0].bySide.LAL, 30000, 'the deal that moved the star ranks first');
  assert.strictEqual(big[1].bySide.MIA, 50);
  assert.ok(big[0].participants.length === 2, 'the row needs both sides to render them');
  console.log('checkBiggestTradesRankOnTheNames: OK');
}

checkTeamSeasonsAreRecorded();
checkPlayoffResultsAreClassified();
checkPoolIncludesActivePlayers();
checkDraftToysRankCorrectly();
checkRecentPicksAreNotJudged();
checkEmptyHistoryReturnsEmptyLists();
checkCareerToys();
checkRetireesKeepTenureAndEarnings();
checkMostTeams();
checkFamiliesIncludeRetirees();
checkHallOfVeryGood();
checkTeamSeasonToys();
checkLopsidedTradesNeedTime();
checkARetiredPlayerStillCountsInATrade();
checkBiggestTradesRankOnTheNames();
console.log('All history toy validations passed');
