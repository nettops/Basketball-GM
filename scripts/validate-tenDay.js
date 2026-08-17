// Ten-day contracts. Injury cover with a deadline: minimum salary, ten game
// days, and at most two with the same club before it has to commit for the
// season or let him walk.
//
// The two-deal ceiling is the point. Without it a club keeps a useful player on
// rolling ten-days forever and never pays him, which is exactly what the real
// limit exists to prevent — and the expiry is the point too, because a ten-day
// that never ends is just a cheap contract.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { TEAMS } = req('teams.js');
const { PLAYERS_2026 } = req('players-2026.js');
const league = req('league.js');
const rosterMoves = req('rosterMoves.js');
const freeAgency = req('freeAgency.js');

function reset() {
  TEAMS.forEach(function (t) { t.deadMoney = []; });
  PLAYERS_2026.forEach(function (p) {
    delete p.waivers;
    delete p.tenDay;
    delete p.tenDayHistory;
  });
}

// A club with a spot open, and a free agent to put in it.
function aClubWithRoom() {
  return TEAMS.find(function (t) { return league.getTeamRoster(t.id).length < freeAgency.ROSTER_MAX; });
}

function makeFreeAgent() {
  const team = TEAMS.find(function (t) {
    return league.getTeamRoster(t.id).length > rosterMoves.ROSTER_MINIMUM;
  });
  const player = league.getTeamRoster(team.id)[0];
  const restore = { teamId: team.id, salary: player.contract.salary, years: player.contract.yearsRemaining };
  player.teamId = null;
  return { player: player, restore: restore };
}

function putBack(player, restore) {
  player.teamId = restore.teamId;
  player.contract.salary = restore.salary;
  player.contract.yearsRemaining = restore.years;
  delete player.tenDay;
  delete player.tenDayHistory;
}

function checkATenDayEndsAfterTenDays() {
  reset();
  const club = aClubWithRoom();
  const fa = makeFreeAgent();

  const signed = freeAgency.signTenDayContract(fa.player, club.id, 30);
  assert.strictEqual(signed.success, true, 'the signing went through: ' + (signed.reason || ''));
  assert.strictEqual(fa.player.teamId, club.id, 'and he is on the roster');
  assert.strictEqual(fa.player.contract.salary, freeAgency.MIN_SALARY, 'at the minimum');
  assert.strictEqual(signed.expiresOnDay, 30 + freeAgency.TEN_DAY_LENGTH, 'for ten game days');

  assert.deepStrictEqual(freeAgency.expireTenDayContracts(35), [], 'nothing expires early');
  assert.strictEqual(fa.player.teamId, club.id, 'he is still there mid-deal');

  const ended = freeAgency.expireTenDayContracts(40);
  assert.strictEqual(ended.length, 1, 'and the deal ends on its day');
  assert.strictEqual(fa.player.teamId, null, 'so he is a free agent again');

  // The difference between a ten-day and a waive, and the reason a club reaches
  // for one: the deal was paid in full over its ten days, so nothing is owed.
  assert.strictEqual(league.getTeamDeadMoney(club.id), 0, 'an expired ten-day leaves no dead money');

  putBack(fa.player, fa.restore);
  reset();
  console.log('checkATenDayEndsAfterTenDays: OK');
}
checkATenDayEndsAfterTenDays();

function checkTwoIsTheLimit() {
  reset();
  const club = aClubWithRoom();
  const fa = makeFreeAgent();

  assert.strictEqual(freeAgency.signTenDayContract(fa.player, club.id, 10).success, true, 'first deal');
  freeAgency.expireTenDayContracts(20);
  assert.strictEqual(fa.player.teamId, null, 'the first one ran out');

  assert.strictEqual(freeAgency.signTenDayContract(fa.player, club.id, 21).success, true, 'second deal');
  freeAgency.expireTenDayContracts(31);

  const third = freeAgency.signTenDayContract(fa.player, club.id, 32);
  assert.strictEqual(third.success, false, 'but not a third with the same club');
  assert.ok(/season|let him go/i.test(third.reason), 'and the club is told its choice: ' + third.reason);

  // The ceiling is per club. Somebody else may still take a look at him.
  const other = TEAMS.find(function (t) {
    return t.id !== club.id && league.getTeamRoster(t.id).length < freeAgency.ROSTER_MAX;
  });
  assert.strictEqual(freeAgency.signTenDayContract(fa.player, other.id, 33).success, true,
    'a different club has its own two');

  putBack(fa.player, fa.restore);
  reset();
  console.log('checkTwoIsTheLimit: OK');
}
checkTwoIsTheLimit();

function checkTheHistorySurvivesConversion() {
  reset();
  const club = aClubWithRoom();
  const fa = makeFreeAgent();

  freeAgency.signTenDayContract(fa.player, club.id, 10);
  const converted = freeAgency.convertTenDayToStandard(fa.player, freeAgency.MIN_SALARY, 1);
  assert.strictEqual(converted.success, true, 'the club committed for the season: ' + (converted.reason || ''));
  assert.strictEqual(fa.player.tenDay, undefined, 'so it is no longer a ten-day');
  assert.strictEqual(fa.player.teamId, club.id, 'and he stays');

  // He must NOT be released by the day sweep now that the deal is a real one.
  freeAgency.expireTenDayContracts(25);
  assert.strictEqual(fa.player.teamId, club.id, 'a converted deal does not expire out from under him');

  // The spent ten-day still counts, so lapsing and re-signing cannot launder
  // the ceiling.
  assert.strictEqual(freeAgency.tenDayCountFor(fa.player, club.id), 1, 'the spent deal is remembered');

  putBack(fa.player, fa.restore);
  reset();
  console.log('checkTheHistorySurvivesConversion: OK');
}
checkTheHistorySurvivesConversion();

function checkAManOnWaiversIsNotSignable() {
  reset();
  const club = aClubWithRoom();
  const fa = makeFreeAgent();
  fa.player.waivers = { fromTeamId: 'BOS', salary: 5000000, yearsRemaining: 1, clearsOnDay: 99 };

  const res = freeAgency.signTenDayContract(fa.player, club.id, 10);
  assert.strictEqual(res.success, false, 'the wire has first claim on him');
  assert.ok(/waivers/i.test(res.reason), 'and says so: ' + res.reason);

  putBack(fa.player, fa.restore);
  reset();
  console.log('checkAManOnWaiversIsNotSignable: OK');
}
checkAManOnWaiversIsNotSignable();

// A player traded away mid-ten-day must not be silently released by the club
// that acquired him when the original deal's clock runs out.
function checkATradedManIsNotReleasedByHisNewClub() {
  reset();
  const club = aClubWithRoom();
  const fa = makeFreeAgent();
  freeAgency.signTenDayContract(fa.player, club.id, 10);

  const newClub = TEAMS.find(function (t) {
    return t.id !== club.id && league.getTeamRoster(t.id).length < freeAgency.ROSTER_MAX;
  });
  fa.player.teamId = newClub.id;   // a trade

  const ended = freeAgency.expireTenDayContracts(20);
  assert.deepStrictEqual(ended, [], 'nobody was released');
  assert.strictEqual(fa.player.teamId, newClub.id, 'he stays where he was traded to');
  assert.strictEqual(fa.player.tenDay, undefined, 'and the spent deal is cleared off him');

  putBack(fa.player, fa.restore);
  reset();
  console.log('checkATradedManIsNotReleasedByHisNewClub: OK');
}
checkATradedManIsNotReleasedByHisNewClub();

console.log('All ten-day contract validations passed');
