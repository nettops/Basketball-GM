const assert = require('assert');
const path = require('path');

const historyModule = require(path.join(__dirname, '..', 'history.js'));
const awardsModule = require(path.join(__dirname, '..', 'awards.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const seasonTransitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));
const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEnsureCareerData() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[20].id)[0];
  historyModule.ensureCareerData([player]);
  assert.strictEqual(player.careerStats.gamesPlayed, 0, 'fresh careerStats should start at zero');
  assert.deepStrictEqual(player.awardsWon, [], 'fresh awardsWon should be empty');
  assert.strictEqual(player.peakOverall, player.overall, 'fresh peakOverall should default to current overall');
  player.careerStats.points = 777;
  historyModule.ensureCareerData([player]);
  assert.strictEqual(player.careerStats.points, 777, 'ensureCareerData must not reset existing data');
  console.log('checkEnsureCareerData: OK');
}

checkEnsureCareerData();

function checkRollSeasonIntoCareerStats() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[21].id)[0];
  historyModule.ensureCareerData([player]);
  player.seasonStats = { gamesPlayed: 70, points: 10000, rebounds: 400, assists: 300, steals: 60, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
  const messages = [];
  historyModule.rollSeasonIntoCareerStats(player, function (text) { messages.push(text); });
  assert.strictEqual(player.careerStats.points, 10000, 'career points should accumulate the season total');
  assert.strictEqual(player.careerStats.seasonsPlayed, 1, 'seasonsPlayed should increment');
  assert.strictEqual(player.bestSeasonTotals.points, 10000, 'bestSeasonTotals should capture this season');
  assert.ok(messages.some(function (m) { return m.indexOf('10,000 career points') !== -1; }), 'crossing 10,000 points should push a milestone feed line');

  player.seasonStats = { gamesPlayed: 70, points: 5000, rebounds: 300, assists: 200, steals: 50, blocks: 15, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
  const messages2 = [];
  historyModule.rollSeasonIntoCareerStats(player, function (text) { messages2.push(text); });
  assert.strictEqual(player.careerStats.points, 15000, 'career points should keep accumulating');
  assert.ok(!messages2.some(function (m) { return m.indexOf('10,000') !== -1; }), 'an already-crossed milestone should not re-fire');
  console.log('checkRollSeasonIntoCareerStats: OK');
}

checkRollSeasonIntoCareerStats();

function checkComputeSeasonAwards() {
  let statSeed = 0;
  teamsModule.TEAMS.forEach(function (team) {
    leagueModule.getTeamRoster(team.id).forEach(function (p) {
      historyModule.ensureCareerData([p]);
      statSeed += 1;
      p.seasonStats = {
        gamesPlayed: 70, points: 500 + statSeed, rebounds: 200 + statSeed, assists: 150 + statSeed,
        steals: 40 + (statSeed % 30), blocks: 20 + (statSeed % 20), fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
        minutes: 1500 + (statSeed % 500)
      };
    });
    team.record = { wins: 30 + (statSeed % 40), losses: 30, pointsFor: 0, pointsAgainst: 0 };
    team.lastSeasonWins = 20;
  });

  const result = awardsModule.computeSeasonAwards(2040);
  assert.strictEqual(result.leagueYear, 2040, 'leagueYear should be echoed back');
  assert.ok(result.winners.some(function (w) { return w.award === awardsModule.AWARD_KEYS.MVP; }), 'an MVP should be selected');
  const allNbaWinners = result.winners.filter(function (w) { return w.award.indexOf('allNba') === 0; });
  assert.strictEqual(allNbaWinners.length, 15, 'exactly 15 All-NBA slots should be filled');
  assert.strictEqual(new Set(allNbaWinners.map(function (w) { return w.playerId; })).size, 15, 'All-NBA selections must be unique players');
  assert.ok(result.mostImprovedTeam, 'a Most Improved Team should be selected');
  console.log('checkComputeSeasonAwards: OK');
}

checkComputeSeasonAwards();

function checkArchiveRetireeAndHof() {
  const roster = leagueModule.getTeamRoster(teamsModule.TEAMS[22].id);
  const star = roster[0];
  historyModule.ensureCareerData([star]);
  star.careerStats.points = 28000;
  star.careerStats.rebounds = 9000;
  star.careerStats.assists = 6000;
  star.awardsWon = [{ award: awardsModule.AWARD_KEYS.MVP, leagueYear: 2038 }, { award: awardsModule.AWARD_KEYS.MVP, leagueYear: 2039 }];
  star.championshipsWon = 2;
  star.peakOverall = 96;
  const starRecord = historyModule.archiveRetiree(star, 2045);
  assert.strictEqual(starRecord.hallOfFame, true, 'a decorated career should clear the HOF threshold');

  const journeyman = roster[1];
  historyModule.ensureCareerData([journeyman]);
  journeyman.careerStats.points = 4000;
  journeyman.careerStats.rebounds = 1500;
  journeyman.careerStats.assists = 800;
  journeyman.awardsWon = [];
  journeyman.championshipsWon = 0;
  journeyman.peakOverall = 68;
  const journeymanRecord = historyModule.archiveRetiree(journeyman, 2045);
  assert.strictEqual(journeymanRecord.hallOfFame, false, 'a modest career should not clear the HOF threshold');
  console.log('checkArchiveRetireeAndHof: OK');
}

checkArchiveRetireeAndHof();

function checkArchiveTradeAndDraftClass() {
  const teamA = teamsModule.TEAMS[23];
  const teamB = teamsModule.TEAMS[24];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
  const beforeTradeCount = historyModule.LEAGUE_HISTORY.trades.length;
  const tradeRecord = historyModule.archiveTrade(proposal, 2041);
  assert.strictEqual(tradeRecord.players[0].playerName, playerA.name, 'archived trade should carry the player name');
  assert.strictEqual(historyModule.LEAGUE_HISTORY.trades.length, beforeTradeCount + 1, 'trade archive should grow by one');

  const draftResults = [{ round: 1, pickNumber: 1, teamId: teamsModule.TEAMS[0].id, prospect: { id: 'prospect-validator', name: 'Validator Prospect' } }];
  const draftRecord = historyModule.archiveDraftClass(2041, draftResults);
  assert.strictEqual(draftRecord.picks[0].playerName, 'Validator Prospect', 'archived draft class should carry the prospect name');
  console.log('checkArchiveTradeAndDraftClass: OK');
}

checkArchiveTradeAndDraftClass();

function checkFinalizeSeasonHistoryEndToEnd() {
  const rng = makeRng(6100);
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 15 + i, losses: 5, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 10; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 15 + i, losses: 5, pointsFor: 0, pointsAgainst: 0 }; t.lastSeasonWins = 10; });
  teamsModule.TEAMS.forEach(function (t) {
    leagueModule.getTeamRoster(t.id).forEach(function (p) {
      p.seasonStats = { gamesPlayed: 70, points: 800, rebounds: 300, assists: 200, steals: 40, blocks: 20, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 1800 };
    });
  });

  const bracket = playoffsModule.generateBracket();
  let g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

  const beforeAwardsHistory = historyModule.LEAGUE_HISTORY.awardsHistory.length;
  const beforeChampions = historyModule.LEAGUE_HISTORY.champions.length;
  const sampleRoster = leagueModule.getTeamRoster(teamsModule.TEAMS[0].id);
  const beforeGamesPlayed = sampleRoster.map(function (p) { historyModule.ensureCareerData([p]); return p.careerStats.gamesPlayed; });

  historyModule.finalizeSeasonHistory(2050, bracket, function () {});

  assert.strictEqual(historyModule.LEAGUE_HISTORY.awardsHistory.length, beforeAwardsHistory + 1, 'awardsHistory should grow by one season');
  assert.strictEqual(historyModule.LEAGUE_HISTORY.champions.length, beforeChampions + 1, 'champions should grow by one season');
  sampleRoster.forEach(function (p, i) {
    assert.ok(p.careerStats.gamesPlayed > beforeGamesPlayed[i], 'every rostered player should have careerStats rolled forward');
  });
  console.log('checkFinalizeSeasonHistoryEndToEnd: OK');
}

checkFinalizeSeasonHistoryEndToEnd();

function checkRecordsLeaders() {
  const p = leagueModule.getTeamRoster(teamsModule.TEAMS[25].id)[0];
  historyModule.ensureCareerData([p]);
  p.careerStats.points = 999999;
  // A value comfortably above any other check's artificial single-season
  // stats in this same process (e.g. checkRollSeasonIntoCareerStats sets
  // bestSeasonTotals.points to 10000 on a different player) — otherwise this
  // "stacked" player isn't guaranteed to actually lead.
  p.bestSeasonTotals.points = 999999;
  teamsModule.TEAMS[25].allTimeWins = 999999;

  const careerTop = historyModule.careerLeaders('points', 5);
  assert.strictEqual(careerTop.length, 5, 'careerLeaders should respect the requested count');
  assert.strictEqual(careerTop[0].id, p.id, 'the stacked player should lead career points');

  const seasonTop = historyModule.singleSeasonLeaders('points', 5);
  assert.strictEqual(seasonTop[0].id, p.id, 'the stacked player should lead single-season points');

  const winLeaders = historyModule.franchiseWinLeaders(5);
  assert.strictEqual(winLeaders[0].id, teamsModule.TEAMS[25].id, 'the stacked team should lead all-time wins');
  console.log('checkRecordsLeaders: OK');
}

checkRecordsLeaders();

function checkRetirementArchivesRetirees() {
  const rng = makeRng(6200);
  const before = historyModule.LEAGUE_HISTORY.retiredPlayers.length;
  const result = seasonTransitionModule.runOffseasonPreDraft(rng, 2051);
  assert.strictEqual(historyModule.LEAGUE_HISTORY.retiredPlayers.length - before, result.retireeCount, 'archived-retiree count should match runOffseasonPreDraft\'s reported count');
  console.log('checkRetirementArchivesRetirees: OK');
}

checkRetirementArchivesRetirees();

function checkTradeHistorySink() {
  const teamA = teamsModule.TEAMS[27];
  const teamB = teamsModule.TEAMS[28];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
  let sinkCalledWith = null;
  tradeModule.executeTrade(proposal, function (p) { sinkCalledWith = p; });
  assert.strictEqual(sinkCalledWith, proposal, 'executeTrade should invoke historySink with the proposal');
  console.log('checkTradeHistorySink: OK');
}

checkTradeHistorySink();

function checkSaveLoadRoundTrip() {
  teamsModule.TEAMS[0].allTimeWins = 54321;
  const gameState = {
    userTeamId: teamsModule.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
    upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2060, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: { getState: function () { return null; } },
    playMode: 'gm', automation: {}, feed: [], draftSession: null
  };
  // JSON round-trip matches this codebase's established save/load test convention
  // (see validate-save.js) and mirrors the real persistence path (storage.setItem
  // stringifies, storage.getItem parses) — without it, payload.leagueHistory is
  // the very same object as the live LEAGUE_HISTORY (serializeGameState hands out
  // a reference, not a clone, same as it already does for `players`), so wiping
  // the live state below would wipe the "saved" payload too.
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'validator-history-test')));
  assert.ok(Array.isArray(payload.leagueHistory.retiredPlayers), 'serialized payload should include leagueHistory');
  assert.strictEqual(payload.teams[teamsModule.TEAMS[0].id].allTimeWins, 54321, 'serialized team payload should include allTimeWins');

  const savedRetiredCount = payload.leagueHistory.retiredPlayers.length;
  historyModule.LEAGUE_HISTORY.retiredPlayers.length = 0;
  teamsModule.TEAMS[0].allTimeWins = 0;

  const freshState = {};
  saveModule.applySavedState(payload, freshState);
  assert.strictEqual(historyModule.LEAGUE_HISTORY.retiredPlayers.length, savedRetiredCount, 'leagueHistory should be restored on load');
  assert.strictEqual(teamsModule.TEAMS[0].allTimeWins, 54321, 'allTimeWins should be restored on load');
  console.log('checkSaveLoadRoundTrip: OK');
}

checkSaveLoadRoundTrip();

console.log('All history validations passed');
