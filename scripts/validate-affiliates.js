// The affiliate league: thirty clubs where two-way players and generated filler
// play a real schedule, so a prospect can develop by playing instead of by
// sitting on somebody's bench.
//
// The checks that matter are the boundaries. Affiliate players must stay OUT of
// PLAYERS_2026 — every league-wide sweep in the game walks that array, so a
// filler forward leaking into it would appear in stat leaders, awards, the
// draft pool and the save file. And the affiliate sim must take its own rng, or
// the parent league's determinism and both golden fixtures move the moment a
// reserve game is played.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const freeAgency = req('freeAgency.js');
const affiliates = req('affiliates.js');

const SEASON_DAYS = 170;

function freshLeague() {
  return affiliates.initAffiliateLeague(makeRng(4242), 2026, SEASON_DAYS);
}

function checkEveryClubHasOne() {
  const state = freshLeague();
  assert.strictEqual(Object.keys(state.records).length, TEAMS.length, 'one affiliate per club');
  TEAMS.forEach(function (t) {
    const id = affiliates.affiliateIdFor(t.id);
    assert.ok(state.records[id], t.id + ' has an affiliate');
    assert.strictEqual(affiliates.parentIdFor(id), t.id, 'and it points back at its parent');
    const roster = affiliates.affiliateRoster(state, id, PLAYERS_2026);
    assert.strictEqual(roster.length, affiliates.AFFILIATE_ROSTER_TARGET,
      t.id + ' affiliate fields a full roster');
  });
  console.log('checkEveryClubHasOne: OK');
}
checkEveryClubHasOne();

// The boundary the whole design rests on. Filler players are complete player
// objects — if they ever reached PLAYERS_2026 they would show up in scoring
// leaders, award voting, the free agent pool and every save.
function checkFillerStaysOutOfTheLeaguePool() {
  const state = freshLeague();
  const poolIds = new Set(PLAYERS_2026.map(function (p) { return p.id; }));
  const leaked = state.filler.filter(function (p) { return poolIds.has(p.id); });
  assert.deepStrictEqual(leaked, [], 'no affiliate filler is in PLAYERS_2026');

  // And they are not on any parent roster either.
  TEAMS.forEach(function (t) {
    const roster = league.getTeamRoster(t.id);
    assert.ok(!roster.some(function (p) { return p.teamId.indexOf('-A') !== -1; }),
      t.id + ' roster has no affiliate players on it');
  });
  console.log('checkFillerStaysOutOfTheLeaguePool: OK (' + state.filler.length + ' filler players held separately)');
}
checkFillerStaysOutOfTheLeaguePool();

function checkTheScheduleIsPlayable() {
  const state = freshLeague();
  assert.ok(state.games.length > 0, 'there are games');

  // Nobody plays twice in a day, which would let one club field two lineups.
  const byDay = {};
  state.games.forEach(function (g) {
    byDay[g.day] = byDay[g.day] || [];
    byDay[g.day].push(g);
  });
  Object.keys(byDay).forEach(function (day) {
    const seen = {};
    byDay[day].forEach(function (g) {
      assert.ok(!seen[g.home] && !seen[g.away], 'no club plays twice on day ' + day);
      assert.notStrictEqual(g.home, g.away, 'and nobody plays themselves');
      seen[g.home] = true;
      seen[g.away] = true;
    });
  });

  // Every club gets a real season, not one game and a bye until April.
  const counts = {};
  Object.keys(state.records).forEach(function (id) { counts[id] = 0; });
  state.games.forEach(function (g) { counts[g.home] += 1; counts[g.away] += 1; });
  const low = Math.min.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }));
  const high = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }));
  assert.strictEqual(high, affiliates.AFFILIATE_GAMES_PER_TEAM, 'nobody plays more than the season length');
  assert.ok(low >= affiliates.AFFILIATE_GAMES_PER_TEAM - 2,
    'and nobody is left short: ' + low + '-' + high + ' games');
  console.log('checkTheScheduleIsPlayable: OK (' + state.games.length + ' games, ' + low + '-' + high + ' each)');
}
checkTheScheduleIsPlayable();

function checkADayOfGamesProducesResults() {
  const state = freshLeague();
  const rng = makeRng(77);
  const day = state.games[0].day;
  const scheduled = state.games.filter(function (g) { return g.day === day; });

  const played = affiliates.simulateAffiliateDay(state, day, rng, PLAYERS_2026);
  assert.strictEqual(played.length, scheduled.length, 'every game scheduled that day was played');

  played.forEach(function (g) {
    assert.ok(g.played, 'the game is marked played');
    assert.ok(g.homeScore > 0 && g.awayScore > 0, 'with real scores');
    assert.notStrictEqual(g.homeScore, g.awayScore, 'and a winner — a tie is not a result');
    assert.ok(Object.keys(g.boxScore).length > 0, 'and a box score');
  });

  // Records add up: every game moves exactly one win and one loss.
  const totalW = Object.keys(state.records).reduce(function (s, k) { return s + state.records[k].wins; }, 0);
  const totalL = Object.keys(state.records).reduce(function (s, k) { return s + state.records[k].losses; }, 0);
  assert.strictEqual(totalW, played.length, 'one win per game');
  assert.strictEqual(totalL, played.length, 'and one loss per game');

  // Replaying the same day must not double-count.
  const again = affiliates.simulateAffiliateDay(state, day, rng, PLAYERS_2026);
  assert.deepStrictEqual(again, [], 'a day already played does not play again');
  console.log('checkADayOfGamesProducesResults: OK (' + played.length + ' games)');
}
checkADayOfGamesProducesResults();

// A two-way player is a real league player who happens not to occupy a seat.
// That exemption is the entire contract.
function checkATwoWayPlayerDoesNotTakeUpASeat() {
  const team = TEAMS.find(function (t) { return league.getTeamRoster(t.id).length > 12; });
  const before = league.getActiveRoster(team.id).length;
  const fullBefore = league.getTeamRoster(team.id).length;

  const guy = league.getTeamRoster(team.id)[0];
  const restore = { teamId: guy.teamId, contract: Object.assign({}, guy.contract) };
  guy.twoWay = { down: true };

  assert.strictEqual(league.getTeamRoster(team.id).length, fullBefore,
    'he is still on the roster for the sim and the stat sweeps');
  assert.strictEqual(league.getActiveRoster(team.id).length, before - 1,
    'but he does not count against the fifteen while he is down');

  // Called up, he counts again.
  affiliates.callUp(guy);
  assert.strictEqual(league.getActiveRoster(team.id).length, before, 'called up, he takes a seat');
  assert.strictEqual(affiliates.callUp(guy).success, false, 'and cannot be called up twice');

  assert.strictEqual(affiliates.sendDown(guy).success, true, 'and can be sent back');
  assert.strictEqual(league.getActiveRoster(team.id).length, before - 1, 'freeing the seat again');

  delete guy.twoWay;
  guy.teamId = restore.teamId;
  guy.contract = restore.contract;
  console.log('checkATwoWayPlayerDoesNotTakeUpASeat: OK');
}
checkATwoWayPlayerDoesNotTakeUpASeat();

function checkASentDownTwoWayPlayerTurnsOutForTheAffiliate() {
  const state = freshLeague();
  const team = TEAMS[0];
  const affId = affiliates.affiliateIdFor(team.id);
  const before = affiliates.affiliateRoster(state, affId, PLAYERS_2026).length;

  const guy = league.getTeamRoster(team.id)[0];
  guy.twoWay = { down: true };
  const withHim = affiliates.affiliateRoster(state, affId, PLAYERS_2026);
  assert.strictEqual(withHim.length, before + 1, 'he plays for the affiliate while he is down');
  assert.ok(withHim.some(function (p) { return p.id === guy.id; }), 'and it is him');

  affiliates.callUp(guy);
  assert.strictEqual(affiliates.affiliateRoster(state, affId, PLAYERS_2026).length, before,
    'called up, he stops turning out for them');

  delete guy.twoWay;
  console.log('checkASentDownTwoWayPlayerTurnsOutForTheAffiliate: OK');
}
checkASentDownTwoWayPlayerTurnsOutForTheAffiliate();

// Only two-way players move between the two leagues. A normal player being
// "sent down" would vanish from the club that is paying him.
function checkOnlyTwoWayPlayersMove() {
  const guy = league.getTeamRoster(TEAMS[0].id)[0];
  assert.strictEqual(affiliates.sendDown(guy).success, false, 'a normal player cannot be sent down');
  assert.strictEqual(affiliates.callUp(guy).success, false, 'nor called up');
  console.log('checkOnlyTwoWayPlayersMove: OK');
}
checkOnlyTwoWayPlayersMove();

// The parent league's determinism depends on the affiliate sim never touching
// its dice. Same seed, same day, same results — twice, from separate states.
function checkTheAffiliateSimIsSelfContained() {
  const a = freshLeague();
  const b = freshLeague();
  const day = a.games[0].day;
  const outA = affiliates.simulateAffiliateDay(a, day, makeRng(99), PLAYERS_2026);
  const outB = affiliates.simulateAffiliateDay(b, day, makeRng(99), PLAYERS_2026);
  assert.strictEqual(outA.length, outB.length, 'the same day plays the same number of games');
  outA.forEach(function (g, i) {
    assert.strictEqual(g.homeScore, outB[i].homeScore, 'and the same scores, from its own rng');
    assert.strictEqual(g.awayScore, outB[i].awayScore, 'both ways');
  });
  console.log('checkTheAffiliateSimIsSelfContained: OK');
}
checkTheAffiliateSimIsSelfContained();

console.log('All affiliate league validations passed');
