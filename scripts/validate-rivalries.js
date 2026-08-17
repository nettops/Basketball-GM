// Rivalries. Not all sixty-eight losses are equal, and until now they were.
//
// The check that matters most is the dullest one: the pair key has to be
// order-independent. A key that depends on which club was passed first gives
// one pair two entries that decay separately, and the bug surfaces months later
// as "the rivalry keeps resetting" with nothing obviously wrong to look at.
//
// After that, the two halves of the model: heat has to be earned by playing,
// and it has to be lost by not playing. A rivalry that only ever rises turns
// the whole league into everyone's rival by season five.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

const riv = req('rivalries.js');

function checkThePairKeyDoesNotCareWhoAskedFirst() {
  assert.strictEqual(riv.pairKey('BOS', 'NYK'), riv.pairKey('NYK', 'BOS'),
    'one pair, one key, whichever way round it is asked');

  const state = riv.createRivalryState();
  riv.addHeat(state, 'BOS', 'NYK', 20);
  assert.strictEqual(riv.getHeat(state, 'NYK', 'BOS'), 20, 'and heat reads back either way');
  assert.strictEqual(Object.keys(state.heat).length, 1, 'stored once, not twice');

  riv.addHeat(state, 'NYK', 'BOS', 5);
  assert.strictEqual(Object.keys(state.heat).length, 1, 'and adding from the other side does not fork it');
  assert.strictEqual(riv.getHeat(state, 'BOS', 'NYK'), 25, 'it accumulates on the one entry');
  console.log('checkThePairKeyDoesNotCareWhoAskedFirst: OK');
}
checkThePairKeyDoesNotCareWhoAskedFirst();

// Clubs meet two to four times a year by schedule alone. That is a calendar,
// not a rivalry, so a handful of routine meetings must not manufacture one.
function checkACalendarIsNotARivalry() {
  const state = riv.createRivalryState();
  for (let i = 0; i < 4; i++) {
    riv.recordGame(state, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 110, awayScore: 95 });
  }
  assert.ok(!riv.areRivals(state, 'BOS', 'NYK'),
    'four routine blowouts a season do not make a rivalry (heat ' +
    riv.getHeat(state, 'BOS', 'NYK') + ')');
  console.log('checkACalendarIsNotARivalry: OK');
}
checkACalendarIsNotARivalry();

// The ones that hurt are the ones people remember.
function checkCloseGamesAndPlayoffsBuildIt() {
  const blowouts = riv.createRivalryState();
  const nailbiters = riv.createRivalryState();
  for (let i = 0; i < 4; i++) {
    riv.recordGame(blowouts, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 120, awayScore: 90 });
    riv.recordGame(nailbiters, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 101, awayScore: 99 });
  }
  assert.ok(riv.getHeat(nailbiters, 'BOS', 'NYK') > riv.getHeat(blowouts, 'BOS', 'NYK'),
    'a season of two-point games counts for more than a season of blowouts');

  const playoff = riv.createRivalryState();
  riv.recordPlayoffSeries(playoff, 'BOS', 'NYK');
  assert.ok(riv.areRivals(playoff, 'BOS', 'NYK'),
    'one playoff series is a rivalry on its own — that is where they are made');
  assert.ok(riv.getHeat(playoff, 'BOS', 'NYK') > riv.getHeat(nailbiters, 'BOS', 'NYK'),
    'and worth more than a whole regular season of meetings');
  console.log('checkCloseGamesAndPlayoffsBuildIt: OK');
}
checkCloseGamesAndPlayoffsBuildIt();

// A rivalry that only ever rises makes the whole league everyone's rival.
// "Stop mattering to each other" means no more playoff meetings — NOT no more
// games. Two clubs in one league never stop playing each other, so a fixture
// that decays in silence measures a situation the game cannot produce. The
// first version of this check did exactly that and made the playoff constant
// look wrong when the fixture was.
function checkItFadesWhenTheyStopMattering() {
  const state = riv.createRivalryState();
  const ordinarySeason = function () {
    riv.recordGame(state, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 112, awayScore: 98 });
    riv.recordGame(state, { homeTeamId: 'NYK', awayTeamId: 'BOS', homeScore: 105, awayScore: 91 });
    riv.recordGame(state, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 118, awayScore: 99 });
    riv.recordGame(state, { homeTeamId: 'NYK', awayTeamId: 'BOS', homeScore: 101, awayScore: 99 });
  };

  ordinarySeason();
  riv.recordPlayoffSeries(state, 'BOS', 'NYK');
  assert.ok(riv.areRivals(state, 'BOS', 'NYK'), 'it starts hot');

  // They keep playing four times a year, they just never meet in May again.
  let seasons = 0;
  while (riv.areRivals(state, 'BOS', 'NYK') && seasons < 50) {
    riv.decayRivalries(state);
    ordinarySeason();
    seasons++;
  }
  assert.ok(seasons < 50, 'it does fade');
  assert.ok(seasons >= 2 && seasons <= 8,
    'and fades over a few seasons, not instantly and not for a decade: ' + seasons);

  // Dead pairs are deleted rather than left at zero. Thirty clubs is 435
  // possible pairs, and this object is saved.
  let more = 0;
  while (Object.keys(state.heat).length > 0 && more < 60) { riv.decayRivalries(state); more++; }
  assert.deepStrictEqual(state.heat, {}, 'and a cold pair leaves no row behind');
  console.log('checkItFadesWhenTheyStopMattering: OK (cooled in ' + seasons + ' seasons)');
}
checkItFadesWhenTheyStopMattering();

// The multiplier is what makes a rivalry game worth more. It has to be exactly
// 1 below the threshold, or every game in the league quietly swings harder than
// it should.
function checkTheMultiplierOnlyAppliesToRealRivalries() {
  const state = riv.createRivalryState();
  assert.strictEqual(riv.rivalryMultiplier(state, 'BOS', 'NYK'), 1,
    'two clubs with no history swing exactly as much as they always did');

  riv.addHeat(state, 'BOS', 'NYK', riv.RIVALRY_THRESHOLD - 1);
  assert.strictEqual(riv.rivalryMultiplier(state, 'BOS', 'NYK'), 1, 'just under the bar is still nothing');

  riv.addHeat(state, 'BOS', 'NYK', 2);
  assert.ok(riv.rivalryMultiplier(state, 'BOS', 'NYK') > 1, 'over it, the game is worth more');

  riv.addHeat(state, 'BOS', 'NYK', riv.HEAT_MAX);
  assert.ok(riv.rivalryMultiplier(state, 'BOS', 'NYK') <= 2,
    'and the hottest rivalry in history is worth double, never more');
  console.log('checkTheMultiplierOnlyAppliesToRealRivalries: OK');
}
checkTheMultiplierOnlyAppliesToRealRivalries();

function checkRivalsOfListsOnlyRealOnes() {
  const state = riv.createRivalryState();
  riv.recordPlayoffSeries(state, 'BOS', 'NYK');
  riv.recordPlayoffSeries(state, 'BOS', 'PHI');
  riv.recordPlayoffSeries(state, 'BOS', 'PHI');   // hotter
  riv.addHeat(state, 'BOS', 'MIA', 3);            // below the bar
  riv.recordPlayoffSeries(state, 'LAL', 'GSW');   // nothing to do with Boston

  const rivals = riv.rivalsOf(state, 'BOS');
  assert.deepStrictEqual(rivals.map(function (r) { return r.teamId; }), ['PHI', 'NYK'],
    'hottest first, and only the ones over the bar');
  assert.ok(!rivals.some(function (r) { return r.teamId === 'MIA'; }), 'a warm pair is not a rivalry');
  assert.ok(!rivals.some(function (r) { return r.teamId === 'LAL' || r.teamId === 'GSW'; }),
    'and somebody else\'s rivalry is not yours');
  console.log('checkRivalsOfListsOnlyRealOnes: OK');
}
checkRivalsOfListsOnlyRealOnes();

// The check the first version of this file did not have, and the one that
// mattered. Testing a single season cannot see where heat CONVERGES: clubs meet
// about four times a year forever, so meeting heat settles at
// perSeason / (1 - HEAT_DECAY). If the threshold sits below that, every pair in
// the league eventually becomes a rivalry — measured in the browser, all 435
// possible pairs carried heat while nobody was anybody's rival.
function checkTheCalendarNeverReachesTheBarOnItsOwn() {
  const state = riv.createRivalryState();
  // Twenty seasons of ordinary scheduling: four meetings, one of them close.
  for (let season = 0; season < 20; season++) {
    riv.recordGame(state, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 112, awayScore: 98 });
    riv.recordGame(state, { homeTeamId: 'NYK', awayTeamId: 'BOS', homeScore: 105, awayScore: 91 });
    riv.recordGame(state, { homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 118, awayScore: 99 });
    riv.recordGame(state, { homeTeamId: 'NYK', awayTeamId: 'BOS', homeScore: 101, awayScore: 99 });
    riv.decayRivalries(state);
  }
  const settled = riv.getHeat(state, 'BOS', 'NYK');
  assert.ok(!riv.areRivals(state, 'BOS', 'NYK'),
    'two decades of ordinary scheduling is still not a rivalry (settled at ' + settled + ')');

  // But add one playoff series to those same two clubs and it plainly is.
  riv.recordPlayoffSeries(state, 'BOS', 'NYK');
  assert.ok(riv.areRivals(state, 'BOS', 'NYK'),
    'meeting in the playoffs makes one immediately');
  console.log('checkTheCalendarNeverReachesTheBarOnItsOwn: OK (calendar settles at ' + settled + ')');
}
checkTheCalendarNeverReachesTheBarOnItsOwn();

console.log('All rivalry validations passed');
