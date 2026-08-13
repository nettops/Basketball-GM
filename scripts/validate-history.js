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
  assert.strictEqual(player.peakOverall, player.rawOverall, 'fresh peakOverall should default to current rawOverall');
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
  historyModule.rollSeasonIntoCareerStats(player, 2060, function (text) { messages.push(text); });
  assert.strictEqual(player.careerStats.points, 10000, 'career points should accumulate the season total');
  assert.strictEqual(player.careerStats.seasonsPlayed, 1, 'seasonsPlayed should increment');
  assert.strictEqual(player.bestSeasonTotals.points, 10000, 'bestSeasonTotals should capture this season');
  assert.ok(messages.some(function (m) { return m.indexOf('10,000 career points') !== -1; }), 'crossing 10,000 points should push a milestone feed line');
  assert.strictEqual(player.careerHistory.seasonByYear[2060].points, 10000, 'careerHistory.seasonByYear should record the season');

  player.seasonStats = { gamesPlayed: 70, points: 5000, rebounds: 300, assists: 200, steals: 50, blocks: 15, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 2000 };
  const messages2 = [];
  historyModule.rollSeasonIntoCareerStats(player, 2061, function (text) { messages2.push(text); });
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

// Phase G: a Hall-of-Fame-caliber retirement should retire the player's
// jersey number with their last team, and that number should no longer be
// assignable to a new player on that team.
function checkJerseyRetirementOnHofInduction() {
  const team = teamsModule.getTeamById('DEN');
  team.retiredNumbers = [];
  const player = leagueModule.getTeamRoster(team.id)[0];
  player.teamId = team.id;
  player.jerseyNumber = 42; // pick a number unlikely to already be in use
  player.teamsPlayedFor = [team.id];
  player.awardsWon = [
    { award: 'mvp', leagueYear: 2050 }, { award: 'mvp', leagueYear: 2051 }, { award: 'mvp', leagueYear: 2052 },
    { award: 'allNba1', leagueYear: 2050 }, { award: 'allNba1', leagueYear: 2051 }
  ];
  player.championshipsWon = 3;
  player.peakOverall = 96;
  player.careerStats = { gamesPlayed: 1200, seasonsPlayed: 15, points: 30000, rebounds: 8000, assists: 6000 };
  leagueModule.SEASON_STAT_KEYS.forEach(function (k) { if (player.careerStats[k] === undefined) player.careerStats[k] = 0; });
  player.bestSeasonTotals = { points: 2200, rebounds: 700, assists: 500 };

  const record = historyModule.archiveRetiree(player, 2053);
  assert.strictEqual(record.hallOfFame, true, 'test setup should produce a clear Hall-of-Fame score');
  assert.strictEqual(record.jerseyNumber, 42);
  assert.strictEqual(record.lastTeamId, team.id);
  assert.ok(team.retiredNumbers.indexOf(42) !== -1, "the team's retiredNumbers should include the retiree's number");

  // A non-Hall-of-Famer's number should NOT be retired.
  const commonPlayer = leagueModule.getTeamRoster(team.id)[1];
  commonPlayer.teamId = team.id;
  commonPlayer.jerseyNumber = 43;
  commonPlayer.teamsPlayedFor = [team.id];
  commonPlayer.awardsWon = [];
  commonPlayer.championshipsWon = 0;
  commonPlayer.peakOverall = 70;
  commonPlayer.careerStats = { gamesPlayed: 200, seasonsPlayed: 3, points: 1500, rebounds: 500, assists: 300 };
  leagueModule.SEASON_STAT_KEYS.forEach(function (k) { if (commonPlayer.careerStats[k] === undefined) commonPlayer.careerStats[k] = 0; });
  commonPlayer.bestSeasonTotals = { points: 600, rebounds: 200, assists: 100 };
  const commonRecord = historyModule.archiveRetiree(commonPlayer, 2053);
  assert.strictEqual(commonRecord.hallOfFame, false, 'test setup should produce a clearly non-Hall-of-Fame score');
  assert.strictEqual(team.retiredNumbers.indexOf(43), -1, "a non-Hall-of-Famer's number should not be retired");

  console.log('checkJerseyRetirementOnHofInduction: OK (hofScore=' + record.hofScore.toFixed(1) + ')');
}

checkJerseyRetirementOnHofInduction();

// The three jersey-assignment call sites (draft, free agency, commissioner
// player creation) should all skip a team's retired numbers.
function checkRetiredNumbersExcludedFromAssignment() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgencyBidding.js')) && require(path.join(__dirname, '..', 'freeAgency.js'));
  const commissionerModule = require(path.join(__dirname, '..', 'commissioner.js'));
  const draftProspectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));

  const team = teamsModule.getTeamById('POR');
  const roster = leagueModule.getTeamRoster(team.id);
  team.retiredNumbers = [0]; // block the number executePick/signPlayer/nextAvailableJersey would otherwise pick first
  roster.forEach(function (p) { p.jerseyNumber = 99; }); // clear the roster's own numbers out of the way too

  const prospect = draftProspectsModule.generateProspectClass(makeRng(1), 1)[0];
  draftModule.executePick(team.id, prospect, 30);
  assert.notStrictEqual(prospect.jerseyNumber, 0, "a draft pick should not receive a team's retired number");

  const faPlayer = leagueModule.getTeamRoster('LAC')[0];
  freeAgencyModule.signPlayer(faPlayer, { teamId: team.id, salary: 2000000, yearsRemaining: 1 });
  assert.notStrictEqual(faPlayer.jerseyNumber, 0, "a free agent signing should not receive a team's retired number");

  const created = commissionerModule.createPlayer({ name: 'Test Rookie', position: 'PG', age: 20, overall: 60, potential: 70, archetype: 'playmaker', teamId: team.id });
  assert.notStrictEqual(created.jerseyNumber, 0, "a commissioner-created player should not receive a team's retired number");

  team.retiredNumbers = [];
  console.log('checkRetiredNumbersExcludedFromAssignment: OK');
}

checkRetiredNumbersExcludedFromAssignment();

// Takeovers must be stored in their own right. save.js prunes box scores to
// the user's own games, so a takeover that lived only in one would vanish for
// the other 29 teams the moment the save was written.
function checkTakeoversAreFiledAndStamped() {
  const history = require(path.join(__dirname, '..', 'history.js'));
  history.LEAGUE_HISTORY.takeovers.length = 0;
  const stored = history.recordTakeovers([
    { playerId: 'p1', playerName: 'Star One', teamId: 'BOS', ultimateKey: 'heatCheck', points: 14, period: 3 }
  ], { leagueYear: 2026, day: 40 });
  assert.strictEqual(history.LEAGUE_HISTORY.takeovers.length, 1);
  const row = history.LEAGUE_HISTORY.takeovers[0];
  assert.strictEqual(row.leagueYear, 2026, 'the season must be stamped on the row');
  assert.strictEqual(row.day, 40, 'and the day');
  assert.strictEqual(row.playerName, 'Star One',
    'the NAME is stored, not just the id — a takeover outlives the player');
  assert.strictEqual(row.ultimateKey, 'heatCheck');
  assert.strictEqual(stored.length, 1, 'and the stored rows are returned');
  assert.deepStrictEqual(history.recordTakeovers([], { leagueYear: 2026, day: 1 }), [],
    'an empty list files nothing rather than throwing');
  assert.deepStrictEqual(history.recordTakeovers(null, null), [],
    'and a missing context files nothing rather than throwing');
  history.LEAGUE_HISTORY.takeovers.length = 0;
  console.log('checkTakeoversAreFiledAndStamped: OK');
}
checkTakeoversAreFiledAndStamped();

// The same failure feats had: a call site that passes no context files rows
// with no season on them, and they are unqueryable forever after.
function checkTakeoverCallSitePassesContext() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'league.js'), 'utf8');
  const re = /recordTakeovers\(([\s\S]*?)\);/g;
  let m, sites = 0;
  while ((m = re.exec(src)) !== null) {
    sites += 1;
    assert.ok(/leagueYear/.test(m[1]), 'a recordTakeovers call site passes no leagueYear');
    assert.ok(/day/.test(m[1]), 'a recordTakeovers call site passes no day');
  }
  assert.ok(sites > 0, 'recordTakeovers is never called — takeovers are not filed at all');
  console.log('checkTakeoverCallSitePassesContext: OK (' + sites + ' site)');
}
checkTakeoverCallSitePassesContext();

console.log('All history validations passed');
