const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers the boxscore engine
const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

function seedConference(conferenceTeams) {
  conferenceTeams.forEach(function (t, i) {
    t.record = { wins: conferenceTeams.length - i, losses: i, pointsFor: 0, pointsAgainst: 0 };
  });
}

function checkGenerateBracketWithoutSettingsIsUnchanged() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  seedConference(eastern);

  const bracket = playoffsModule.generateBracket();
  assert.strictEqual(bracket.playIn, null, 'omitting rng/settings should skip the play-in entirely, same as before it existed');
  assert.strictEqual(bracket.first.length, 8);

  console.log('checkGenerateBracketWithoutSettingsIsUnchanged: OK');
}

checkGenerateBracketWithoutSettingsIsUnchanged();

function checkPlayInDisabledBySettingsIsUnchanged() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  seedConference(eastern);

  const bracket = playoffsModule.generateBracket(makeRng(1), { simEngine: 'boxscore', playInEnabled: false });
  assert.strictEqual(bracket.playIn, null, 'playInEnabled: false should skip the play-in');

  console.log('checkPlayInDisabledBySettingsIsUnchanged: OK');
}

checkPlayInDisabledBySettingsIsUnchanged();

function checkResolvePlayInForConference() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  seedConference(eastern);
  const seeds10 = playoffsModule.getPlayoffSeeds('Eastern', 10);
  assert.strictEqual(seeds10.length, 10);

  const rng = makeRng(42);
  const result = playoffsModule.resolvePlayInForConference('Eastern', { simEngine: 'boxscore' }, rng);

  assert.strictEqual(result.games.length, 3, 'play-in should always play exactly 3 games (7v8, 9v10, loser-vs-winner)');
  const seed7 = seeds10[6], seed8 = seeds10[7], seed9 = seeds10[8], seed10 = seeds10[9];

  assert.deepStrictEqual([result.games[0].homeTeamId, result.games[0].awayTeamId], [seed7.id, seed8.id], '7 seed should host the 7-8 game');
  assert.deepStrictEqual([result.games[1].homeTeamId, result.games[1].awayTeamId], [seed9.id, seed10.id], '9 seed should host the 9-10 game');

  const winner1Id = result.games[0].homeScore > result.games[0].awayScore ? seed7.id : seed8.id;
  const loser1Id = winner1Id === seed7.id ? seed8.id : seed7.id;
  assert.strictEqual(result.seventhSeed.id, winner1Id, 'the 7-8 game winner should take the 7 seed outright');
  assert.strictEqual(result.games[2].homeTeamId, loser1Id, 'the 7-8 loser should host the final spot game');

  const finalSpotWinnerId = result.games[2].homeScore > result.games[2].awayScore ? result.games[2].homeTeamId : result.games[2].awayTeamId;
  assert.strictEqual(result.eighthSeed.id, finalSpotWinnerId, 'the final spot game winner should take the 8 seed');
  assert.notStrictEqual(result.eighthSeed.id, result.seventhSeed.id, '7 and 8 seeds must be different teams');

  console.log('checkResolvePlayInForConference: OK (7=' + result.seventhSeed.id + ', 8=' + result.eighthSeed.id + ')');
}

checkResolvePlayInForConference();

function checkGenerateBracketWithPlayInEnabled() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  seedConference(eastern);
  seedConference(western);
  const seedsE10 = playoffsModule.getPlayoffSeeds('Eastern', 10);
  const seedsW10 = playoffsModule.getPlayoffSeeds('Western', 10);

  const settings = { simEngine: 'boxscore', playInEnabled: true };
  const bracket = playoffsModule.generateBracket(makeRng(7), settings);

  assert.ok(bracket.playIn, 'playIn results should be recorded on the bracket');
  assert.ok(bracket.playIn.Eastern && bracket.playIn.Western, 'both conferences should have play-in results');
  assert.strictEqual(bracket.first.length, 8, 'the main bracket should still be a standard 8-series field once play-in resolves');

  // Seeds 1-6 should be untouched by the play-in (only 7/8 are contested).
  const eastFirstRoundTeamIds = bracket.first.slice(0, 4).reduce(function (ids, s) { return ids.concat([s.higherSeed, s.lowerSeed]); }, []);
  seedsE10.slice(0, 6).forEach(function (t) { assert.ok(eastFirstRoundTeamIds.indexOf(t.id) !== -1, t.id + ' (top-6 seed) should be in the bracket untouched'); });
  assert.strictEqual(eastFirstRoundTeamIds.indexOf(bracket.playIn.Eastern.seventhSeed.id) !== -1, true, 'the resolved 7 seed should appear in the bracket');
  assert.strictEqual(eastFirstRoundTeamIds.indexOf(bracket.playIn.Eastern.eighthSeed.id) !== -1, true, 'the resolved 8 seed should appear in the bracket');

  console.log('checkGenerateBracketWithPlayInEnabled: OK (unused seedsW10 count=' + seedsW10.length + ')');
}

checkGenerateBracketWithPlayInEnabled();

// Full end-to-end: play-in feeds a real bracket that plays out to a champion,
// same as a non-play-in bracket already does in scripts/validate-sim.js.
function checkFullBracketWithPlayInResolvesToChampion() {
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  seedConference(eastern);
  seedConference(western);

  const settings = { simEngine: 'boxscore', playInEnabled: true };
  const rng = makeRng(300);
  const bracket = playoffsModule.generateBracket(rng, settings);

  let gamesSimulated = 0;
  let game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  while (game !== null && gamesSimulated < 500) {
    gamesSimulated += 1;
    game = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  }

  assert.ok(bracket.finals.length === 1 && bracket.finals[0].complete, 'the bracket should resolve to a champion after play-in');
  assert.ok(bracket.finals[0].winner);

  console.log('checkFullBracketWithPlayInResolvesToChampion: OK (champion=' + bracket.finals[0].winner + ', games=' + gamesSimulated + ')');
}

checkFullBracketWithPlayInResolvesToChampion();

console.log('All play-in validations passed');
