const assert = require('assert');
const path = require('path');

const careerHistoryModule = require(path.join(__dirname, '..', 'careerHistory.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const historyModule = require(path.join(__dirname, '..', 'history.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));

function checkEnsureCareerHistory() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[0].id)[0];
  const history = careerHistoryModule.ensureCareerHistory(player);
  assert.deepStrictEqual(history.seasonByYear, {}, 'fresh seasonByYear should be empty');
  assert.deepStrictEqual(history.teamHistory, [], 'fresh teamHistory should be empty');
  assert.deepStrictEqual(history.trades, [], 'fresh trades should be empty');
  assert.strictEqual(history.careerHighs.singleGame.points, 0, 'fresh singleGame highs should be zero');
  history.trades.push({ season: 2026 });
  const historyAgain = careerHistoryModule.ensureCareerHistory(player);
  assert.strictEqual(historyAgain.trades.length, 1, 'ensureCareerHistory must not reset existing data');
  console.log('checkEnsureCareerHistory: OK');
}

checkEnsureCareerHistory();

function checkRecordSeasonInHistory() {
  const team = teamsModule.TEAMS[1];
  const player = leagueModule.getTeamRoster(team.id)[0];
  player.seasonStats = { gamesPlayed: 70, points: 1400, rebounds: 500, assists: 300, steals: 60, blocks: 30, fgm: 500, fga: 1000, tpm: 100, tpa: 300, ftm: 300, fta: 350, minutes: 2200 };

  const seasonRecord = careerHistoryModule.recordSeasonInHistory(player, 2026);
  assert.strictEqual(seasonRecord.points, 1400, 'season record should carry the season stat line');
  assert.strictEqual(seasonRecord.teamId, team.id, 'season record should carry the current team');
  assert.strictEqual(player.careerHistory.seasonByYear[2026], seasonRecord, 'seasonByYear should be keyed by season');

  const teamEntry = careerHistoryModule.getTeamBreakdown(player, team.id)[0];
  assert.strictEqual(teamEntry.seasons, 1, 'team history entry should count one season');
  assert.strictEqual(teamEntry.totalPoints, 1400, 'team history entry should aggregate points');
  assert.strictEqual(teamEntry.endSeason, null, 'an active team tenure should have no endSeason');

  assert.strictEqual(player.careerHistory.careerHighs.singleSeason.points, 1400, 'singleSeason career high should be set from the season totals');

  // A second season with fewer points should not clobber the season high.
  player.seasonStats = { gamesPlayed: 70, points: 900, rebounds: 400, assists: 250, steals: 50, blocks: 20, fgm: 300, fga: 700, tpm: 80, tpa: 220, ftm: 200, fta: 240, minutes: 2000 };
  careerHistoryModule.recordSeasonInHistory(player, 2027);
  assert.strictEqual(player.careerHistory.careerHighs.singleSeason.points, 1400, 'a lower-scoring season should not lower the career high');
  assert.strictEqual(careerHistoryModule.getTeamBreakdown(player, team.id)[0].seasons, 2, 'the same team tenure should accumulate a second season');
  console.log('checkRecordSeasonInHistory: OK');
}

checkRecordSeasonInHistory();

// The teamHistory twin of validate-careerTotals.js's
// checkNewStatKeyDoesNotCorruptAnOldSave. An OPEN team tenure is seeded with
// total<Key> fields from the keys of its own era; when a key is added later,
// the next season rolled into that same still-open entry accumulates
// `undefined + 0`. Closing and reopening the tenure would hide it, so the
// entry has to stay open across the change — which is exactly what happens to
// a player who does not switch teams.
function checkNewStatKeyDoesNotCorruptAnOpenTenure() {
  const team = teamsModule.TEAMS[4];
  const player = leagueModule.getTeamRoster(team.id)[0];
  player.seasonStats = { gamesPlayed: 70, points: 1400, rebounds: 500, assists: 300, steals: 60, blocks: 30, fgm: 500, fga: 1000, tpm: 100, tpa: 300, ftm: 300, fta: 350, minutes: 2200 };
  careerHistoryModule.recordSeasonInHistory(player, 2030);

  player.seasonStats = { gamesPlayed: 70, points: 1000, brandNewStat: 42 };
  leagueModule.SEASON_STAT_KEYS.push('brandNewStat');
  try {
    careerHistoryModule.recordSeasonInHistory(player, 2031);
  } finally {
    leagueModule.SEASON_STAT_KEYS.pop();
  }

  const entry = careerHistoryModule.getTeamBreakdown(player, team.id)[0];
  assert.ok(!Number.isNaN(entry.totalBrandNewStat),
    'a stat key added mid-tenure must not accumulate to NaN in team totals');
  assert.strictEqual(entry.totalBrandNewStat, 42, 'the new key should start from zero and take the season');
  assert.strictEqual(entry.totalPoints, 2400, 'existing keys keep accumulating across the change');
  console.log('checkNewStatKeyDoesNotCorruptAnOpenTenure: OK');
}

checkNewStatKeyDoesNotCorruptAnOpenTenure();

function checkRecordSeasonInHistoryNoGames() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[2].id)[0];
  player.seasonStats = { gamesPlayed: 0, points: 0 };
  const result = careerHistoryModule.recordSeasonInHistory(player, 2026);
  assert.strictEqual(result, null, 'a player who played no games should not get a season record');
  assert.deepStrictEqual(player.careerHistory.seasonByYear, {}, 'seasonByYear should stay empty');
  console.log('checkRecordSeasonInHistoryNoGames: OK');
}

checkRecordSeasonInHistoryNoGames();

function checkCheckAndUpdateCareerHighs() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[3].id)[0];
  careerHistoryModule.ensureCareerHistory(player);
  const gameLine = { points: 41, rebounds: 12, assists: 9, steals: 3, blocks: 2, minutes: 38 };
  const updated = careerHistoryModule.checkAndUpdateCareerHighs(player, gameLine);
  assert.strictEqual(updated.points, 41, 'a new career-high points game should be reported as updated');
  assert.strictEqual(player.careerHistory.careerHighs.singleGame.minutesPlayed, 38, 'minutes should map to the minutesPlayed high');

  const lowerLine = { points: 20, rebounds: 20, assists: 3, steals: 1, blocks: 0, minutes: 30 };
  const updated2 = careerHistoryModule.checkAndUpdateCareerHighs(player, lowerLine);
  assert.strictEqual(updated2.points, undefined, 'a lower-scoring game should not report a points update');
  assert.strictEqual(updated2.rebounds, 20, 'a new career-high rebounds game should be reported as updated');
  assert.strictEqual(player.careerHistory.careerHighs.singleGame.points, 41, 'the earlier points high should be preserved');
  console.log('checkCheckAndUpdateCareerHighs: OK');
}

checkCheckAndUpdateCareerHighs();

function checkRecordTradeInHistory() {
  const teamA = teamsModule.TEAMS[4];
  const teamB = teamsModule.TEAMS[5];
  const player = leagueModule.getTeamRoster(teamA.id)[0];
  careerHistoryModule.recordSeasonInHistory(Object.assign(player, { seasonStats: { gamesPlayed: 10, points: 100, rebounds: 40, assists: 20, steals: 5, blocks: 2, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 300 } }), 2026);

  const record = careerHistoryModule.recordTradeInHistory(player, teamA.id, teamB.id, 2026, 'traded for a pick');
  assert.strictEqual(record.fromTeam, teamA.id, 'trade record should carry the outgoing team');
  assert.strictEqual(record.toTeam, teamB.id, 'trade record should carry the incoming team');

  const oldEntry = careerHistoryModule.getTeamBreakdown(player, teamA.id)[0];
  assert.strictEqual(oldEntry.endSeason, 2026, 'the outgoing team tenure should be closed out at the trade season');
  const newEntry = careerHistoryModule.getTeamBreakdown(player, teamB.id)[0];
  assert.strictEqual(newEntry.startSeason, 2026, 'the incoming team tenure should open at the trade season');
  assert.strictEqual(newEntry.endSeason, null, 'the incoming team tenure should be active');
  console.log('checkRecordTradeInHistory: OK');
}

checkRecordTradeInHistory();

function checkRecordInjuryInHistoryAndReturn() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[6].id)[0];
  careerHistoryModule.recordInjuryInHistory(player, 'ankle sprain', 'minor', 14, 2026);
  assert.strictEqual(player.careerHistory.injuryHistory.length, 1, 'injury should be logged');
  assert.strictEqual(player.careerHistory.injuryHistory[0].actualRecoveryDays, null, 'a fresh injury has no actual recovery yet');

  const returned = careerHistoryModule.recordInjuryReturn(player, 2026, 12);
  assert.strictEqual(returned.actualRecoveryDays, 12, 'recordInjuryReturn should fill in the actual recovery days');
  console.log('checkRecordInjuryInHistoryAndReturn: OK');
}

checkRecordInjuryInHistoryAndReturn();

function checkRecordContractInHistory() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[7].id)[0];
  const record = careerHistoryModule.recordContractInHistory(player, 2026, 20000000, 3, teamsModule.TEAMS[7].id, 'extension');
  assert.strictEqual(player.careerHistory.contractHistory[0], record, 'contract should be appended to contractHistory');
  assert.strictEqual(record.salary, 20000000, 'contract record should carry the salary');
  console.log('checkRecordContractInHistory: OK');
}

checkRecordContractInHistory();

function checkGetCareerProgressionTrend() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[8].id)[0];
  careerHistoryModule.recordSeasonInHistory(Object.assign(player, { seasonStats: { gamesPlayed: 10, points: 200, rebounds: 100, assists: 50, steals: 10, blocks: 5, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 300 } }), 2025);
  careerHistoryModule.recordSeasonInHistory(Object.assign(player, { seasonStats: { gamesPlayed: 10, points: 300, rebounds: 120, assists: 60, steals: 12, blocks: 6, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 320 } }), 2026);

  const trend = careerHistoryModule.getCareerProgressionTrend(player);
  assert.strictEqual(trend.length, 2, 'trend should have one entry per recorded season');
  assert.strictEqual(trend[0].season, 2025, 'trend should be sorted chronologically');
  assert.strictEqual(trend[1].ppg, 30, 'ppg should be points divided by games played');
  console.log('checkGetCareerProgressionTrend: OK');
}

checkGetCareerProgressionTrend();

function checkQueryHistoryByFilters() {
  const teamA = teamsModule.TEAMS[9];
  const teamB = teamsModule.TEAMS[10];
  const player = leagueModule.getTeamRoster(teamA.id)[0];
  careerHistoryModule.ensureCareerHistory(player);
  careerHistoryModule.recordContractInHistory(player, 2025, 5000000, 2, teamA.id, 'rookie_scale');
  careerHistoryModule.recordTradeInHistory(player, teamA.id, teamB.id, 2026, 'trade details');
  careerHistoryModule.recordInjuryInHistory(player, 'hamstring strain', 'moderate', 10, 2026);

  const all = careerHistoryModule.queryHistoryByFilters(player, {});
  assert.strictEqual(all.length, 3, 'all events should be returned with no filters');
  assert.deepStrictEqual(all.map(function (e) { return e.season; }), [2025, 2026, 2026], 'events should be sorted chronologically');

  const tradesOnly = careerHistoryModule.queryHistoryByFilters(player, { eventType: 'trade' });
  assert.strictEqual(tradesOnly.length, 1, 'eventType filter should narrow to trades');

  const season2025Only = careerHistoryModule.queryHistoryByFilters(player, { season: 2025 });
  assert.strictEqual(season2025Only.length, 1, 'season filter should narrow to that season');
  assert.strictEqual(season2025Only[0].eventType, 'contract', '2025 should only have the contract event');
  console.log('checkQueryHistoryByFilters: OK');
}

checkQueryHistoryByFilters();

function checkRollSeasonIntoCareerStatsIntegration() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[11].id)[0];
  player.seasonStats = { gamesPlayed: 82, points: 2000, rebounds: 600, assists: 400, steals: 100, blocks: 50, fgm: 700, fga: 1500, tpm: 150, tpa: 400, ftm: 450, fta: 500, minutes: 2800 };
  historyModule.rollSeasonIntoCareerStats(player, 2070, function () {});
  assert.strictEqual(player.careerHistory.seasonByYear[2070].points, 2000, 'rollSeasonIntoCareerStats should populate careerHistory via recordSeasonInHistory');
  console.log('checkRollSeasonIntoCareerStatsIntegration: OK');
}

checkRollSeasonIntoCareerStatsIntegration();

function checkArchiveTradeRecordsPerPlayerHistory() {
  const teamA = teamsModule.TEAMS[12];
  const teamB = teamsModule.TEAMS[13];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  careerHistoryModule.ensureCareerHistory(playerA);
  const proposal = { participants: [teamA.id, teamB.id], assignments: [{ playerId: playerA.id, fromTeamId: teamA.id, toTeamId: teamB.id }], pickAssignments: [] };
  historyModule.archiveTrade(proposal, 2071);
  const trade = playerA.careerHistory.trades[playerA.careerHistory.trades.length - 1];
  assert.strictEqual(trade.fromTeam, teamA.id, 'archiveTrade should record the per-player trade history entry');
  assert.strictEqual(trade.toTeam, teamB.id, 'archiveTrade should record the incoming team');
  console.log('checkArchiveTradeRecordsPerPlayerHistory: OK');
}

checkArchiveTradeRecordsPerPlayerHistory();

function checkTradeExecuteChecksCareerHighs() {
  const teamA = teamsModule.TEAMS[14];
  const teamB = teamsModule.TEAMS[15];
  const playerA = leagueModule.getTeamRoster(teamA.id)[0];
  careerHistoryModule.ensureCareerHistory(playerA);
  const before = leagueModule.getPlayerAverages; // sanity: module loaded
  assert.ok(typeof before === 'function', 'league module should be loaded');

  leagueModule.accumulateSeasonStats(playerA.id, { points: 55, rebounds: 20, assists: 15, steals: 5, blocks: 4, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 44 });
  assert.strictEqual(playerA.careerHistory.careerHighs.singleGame.points, 55, 'accumulateSeasonStats should check the game line against career highs');
  console.log('checkTradeExecuteChecksCareerHighs: OK');
}

checkTradeExecuteChecksCareerHighs();

function checkSignPlayerRecordsContract() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[16].id)[0];
  careerHistoryModule.ensureCareerHistory(player);
  const beforeCount = player.careerHistory.contractHistory.length;
  freeAgencyModule.signPlayer(player, { teamId: teamsModule.TEAMS[17].id, salary: 8000000, yearsRemaining: 2 });
  assert.strictEqual(player.careerHistory.contractHistory.length, beforeCount + 1, 'signPlayer should append a contractHistory entry');
  assert.strictEqual(player.careerHistory.contractHistory[beforeCount].salary, 8000000, 'contract entry should carry the signed salary');
  console.log('checkSignPlayerRecordsContract: OK');
}

checkSignPlayerRecordsContract();

function checkSaveLoadRoundTripPreservesCareerHistory() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[18].id)[0];
  careerHistoryModule.recordContractInHistory(player, 2026, 9000000, 1, teamsModule.TEAMS[18].id, 'extension');
  const gameState = {
    userTeamId: teamsModule.TEAMS[18].id, currentView: 'dashboard', season: null, playoffBracket: null,
    upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2026, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: { getState: function () { return null; } },
    playMode: 'gm', automation: {}, feed: [], draftSession: null
  };
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'validator-careerHistory-test')));
  const savedPlayer = payload.players.find(function (p) { return p.id === player.id; });
  assert.strictEqual(savedPlayer.careerHistory.contractHistory[0].salary, 9000000, 'serialized players should carry careerHistory');

  const freshState = {};
  saveModule.applySavedState(payload, freshState);
  const reloadedPlayer = leagueModule.getPlayerById(player.id);
  assert.strictEqual(reloadedPlayer.careerHistory.contractHistory[0].salary, 9000000, 'careerHistory should round-trip through save/load');
  console.log('checkSaveLoadRoundTripPreservesCareerHistory: OK');
}

checkSaveLoadRoundTripPreservesCareerHistory();

console.log('All careerHistory validations passed');
