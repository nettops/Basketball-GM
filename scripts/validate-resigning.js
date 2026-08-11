// Teams get first refusal on their own expiring players, and contract length
// tracks who the player is.
//
// Before this existed, decrementContracts cut a player loose the instant his
// deal hit zero, so his own team had no claim on him and was simply one of ~20
// bidders on the open market. Measured over 5 offseasons: 437 contracts signed,
// all 437 recorded as open-market signings, ZERO re-signings league-wide. Star
// re-sign rate 12.7%, star tenure 2.27 seasons, 36% of the league changing
// teams every year.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS, getTeamById } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const ratings = rq('ratings.js');
const league = rq('league.js');
const fa = rq('freeAgency.js');
const seasonTransition = rq('seasonTransition.js');
const { makeRng } = rq('rng.js');

global.GameState = { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };

function byId(id) { return PLAYERS_2026.find(function (p) { return p.id === id; }); }
const BANDS = ratings.RATING_BANDS;

// Length has to track quality, and it has to be read off the DISPLAY scale.
// The first cut banded on rawOverall — a different scale entirely (median 47
// against the display median of 75, one player league-wide above 85) — which
// filed all but one player under "fringe" and made every contract in the
// league SHORTER. The bug passed every existing test; only the measured mean
// caught it. This pins the scale.
function checkContractLengthTracksQuality() {
  const rng = makeRng(3);
  const sample = function (p) {
    let total = 0;
    for (let i = 0; i < 200; i++) total += fa.contractYearsFor(p, rng);
    return total / 200;
  };
  const star = PLAYERS_2026.filter(function (p) { return p.overall >= BANDS.star && p.age <= 30; })
    .sort(function (a, b) { return b.overall - a.overall; })[0];
  const fringe = PLAYERS_2026.filter(function (p) { return p.overall < BANDS.fringe && p.age <= 30; })
    .sort(function (a, b) { return a.overall - b.overall; })[0];
  assert.ok(star && fringe, 'need both a star and a fringe player under 30');

  const starYears = sample(star), fringeYears = sample(fringe);
  assert.ok(starYears >= 4, 'a star should average 4+ year deals, got ' + starYears.toFixed(2));
  assert.ok(fringeYears <= 2, 'a fringe player should average 2 years or less, got ' + fringeYears.toFixed(2));
  assert.ok(starYears > fringeYears + 1.5,
    'stars must sign clearly longer than fringe players: ' + starYears.toFixed(2) + ' vs ' + fringeYears.toFixed(2));

  // Nobody signs past the age horizon. A 37-year-old on a 5-year deal is how
  // the league fills with unwaivable 42-year-olds.
  const old = PLAYERS_2026.filter(function (p) { return p.age >= 36; })
    .sort(function (a, b) { return b.overall - a.overall; })[0];
  if (old) {
    for (let i = 0; i < 100; i++) {
      const y = fa.contractYearsFor(old, rng);
      assert.ok(old.age + y <= 42, 'a ' + old.age + '-year-old drew a ' + y + '-year deal');
    }
  }
  assert.ok(fa.contractYearsFor(star, rng) <= fa.MAX_CONTRACT_YEARS, 'nothing may exceed the maximum');
  console.log('checkContractLengthTracksQuality: OK (star ' + starYears.toFixed(2) +
    'y, fringe ' + fringeYears.toFixed(2) + 'y)');
}

// The incumbent bonus is the concept scoreOffer did not have. Same team, same
// money — the only difference is whether he already plays there.
function checkIncumbentOfferScoresHigher() {
  const player = PLAYERS_2026.find(function (p) { return p.teamId === 'BOS' && p.overall >= BANDS.rotation; });
  const team = getTeamById('BOS');
  const base = { teamId: 'BOS', salary: 30000000, yearsRemaining: 3 };
  const inc = { teamId: 'BOS', salary: 30000000, yearsRemaining: 3, incumbent: true };
  const plain = fa.scoreOffer(player, team, base);
  const home = fa.scoreOffer(player, team, inc);
  assert.ok(home > plain,
    'an incumbent offer must score higher than the identical outside offer: ' + home + ' vs ' + plain);

  // ...but an unhappy player barely counts it. Without this a re-signing
  // window is a rubber stamp and morale means nothing.
  const originalMorale = player.status.morale;
  player.status.morale = 95;
  const happy = fa.scoreOffer(player, team, inc) - plain;
  player.status.morale = 20;
  const miserable = fa.scoreOffer(player, team, inc) - plain;
  player.status.morale = originalMorale;
  assert.ok(happy > miserable,
    'morale must change how much staying is worth: happy ' + happy.toFixed(4) + ' vs unhappy ' + miserable.toFixed(4));
  assert.ok(miserable < 0, 'a miserable player should be pushed AWAY, got ' + miserable.toFixed(4));
  console.log('checkIncumbentOfferScoresHigher: OK (+' + (home - plain).toFixed(4) +
    ', happy +' + happy.toFixed(4) + ', miserable ' + miserable.toFixed(4) + ')');
}

// The whole point: a team over the cap keeps its own star. Without this the
// good teams — which are the ones over the cap — still lose everyone they
// develop, which is the complaint that started all of it.
function checkOverCapTeamCanRetainItsOwnStar() {
  const team = TEAMS.find(function (t) {
    return 154000000 - league.getTeamPayroll(t.id) < 0;
  });
  assert.ok(team, 'need an over-the-cap team');
  const star = league.getTeamRoster(team.id).sort(function (a, b) { return b.overall - a.overall; })[0];
  const rng = makeRng(11);

  // Precondition: on the open market this same team could not sign him at all.
  assert.ok(!fa.checkOffer(team, 20000000).ok,
    'precondition: an over-cap team must be barred from the open market');

  const originalContract = star.contract;
  star.contract = { salary: originalContract.salary, yearsRemaining: 0, playerOption: false, teamOption: false };
  const result = fa.runResigningWindow([star], rng, null);
  const kept = star.teamId === team.id && star.contract.yearsRemaining > 0;
  assert.ok(kept || result.lost.length === 1,
    'the window must either retain him or explicitly lose him, never leave him in limbo');
  assert.ok(kept, 'an over-cap team must be able to re-sign its OWN star, over the cap');
  assert.ok(star.contract.salary > 0);
  star.contract = originalContract;
  console.log('checkOverCapTeamCanRetainItsOwnStar: OK (' + team.id + ' kept ' + star.name + ')');
}

// The user's players are not decided for them.
function checkUserTeamIsDeferred() {
  const rng = makeRng(21);
  const roster = league.getTeamRoster('LAL');
  const player = roster.sort(function (a, b) { return b.overall - a.overall; })[0];
  const original = player.contract;
  player.contract = { salary: original.salary, yearsRemaining: 0, playerOption: false, teamOption: false };

  const result = fa.runResigningWindow([player], rng, 'LAL');
  assert.strictEqual(result.deferred.length, 1, 'the user\'s expiring player must be deferred');
  assert.strictEqual(result.resigned.length, 0, 'nothing may be decided for the user');
  assert.ok(player.resignRights, 'he must carry re-sign rights');
  assert.strictEqual(player.teamId, 'LAL', 'and stay on the roster while they are outstanding');
  assert.ok(player.resignRights.salary > 0 && player.resignRights.yearsRemaining > 0,
    'the rights must name a price and a term to show the user');

  // Letting the window close sends him to the market — a right must not
  // survive into the new season, or he sits rostered forever on a zero-year
  // deal that can never expire again.
  fa.releaseUnexercisedResignRights('LAL');
  assert.strictEqual(player.teamId, null, 'an unexercised right must release him');
  assert.ok(!player.resignRights, 'and must not survive');

  player.teamId = 'LAL';
  player.contract = original;
  console.log('checkUserTeamIsDeferred: OK');
}

// Delegating free agency must not quietly cost you your stars.
function checkAutoExerciseKeepsThem() {
  const rng = makeRng(31);
  const roster = league.getTeamRoster('DEN');
  const player = roster.sort(function (a, b) { return b.overall - a.overall; })[0];
  const original = player.contract;
  player.contract = { salary: original.salary, yearsRemaining: 0, playerOption: false, teamOption: false };
  fa.runResigningWindow([player], rng, 'DEN');
  assert.ok(player.resignRights, 'precondition: deferred');

  fa.autoExerciseResignRights('DEN', rng);
  assert.ok(!player.resignRights, 'rights must be spent either way');
  assert.strictEqual(player.teamId, 'DEN', 'his own team should have kept him');
  assert.ok(player.contract.yearsRemaining > 0, 'on a real contract, not the expired one');

  player.contract = original;
  console.log('checkAutoExerciseKeepsThem: OK');
}

// decrementContracts must not release anyone still holding rights, and must
// still release everyone else.
function checkExpiryReleasesOnlyTheUndecided() {
  const rng = makeRng(41);
  const before = PLAYERS_2026.filter(function (p) { return p.teamId; }).length;
  seasonTransition.decrementContracts(rng, 'BOS');
  const stranded = PLAYERS_2026.filter(function (p) {
    return p.teamId && p.contract.yearsRemaining <= 0 && !p.resignRights;
  });
  assert.strictEqual(stranded.length, 0,
    stranded.length + ' players are rostered on an expired contract with no rights');
  const rights = PLAYERS_2026.filter(function (p) { return p.resignRights; });
  rights.forEach(function (p) {
    assert.strictEqual(p.teamId, 'BOS', 'only the deferred team may hold rights, found ' + p.teamId);
  });
  assert.ok(PLAYERS_2026.filter(function (p) { return p.teamId; }).length < before,
    'somebody must have reached the market');
  console.log('checkExpiryReleasesOnlyTheUndecided: OK (' + rights.length + ' deferred to BOS)');
}

checkContractLengthTracksQuality();
checkIncumbentOfferScoresHigher();
checkOverCapTeamCanRetainItsOwnStar();
checkUserTeamIsDeferred();
checkAutoExerciseKeepsThem();
checkExpiryReleasesOnlyTheUndecided();

console.log('All re-signing validations passed');
