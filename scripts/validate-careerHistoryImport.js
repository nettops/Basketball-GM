const assert = require('assert');
const path = require('path');

const importModule = require(path.join(__dirname, '..', 'careerHistoryImport.js'));
const careerHistoryModule = require(path.join(__dirname, '..', 'careerHistory.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

function checkImportRealPlayerCareerHistory() {
  const team = teamsModule.TEAMS[0];
  const player = leagueModule.getTeamRoster(team.id)[0];
  const otherTeam = teamsModule.TEAMS[1];

  const data = {
    seasons: [
      { season: 2024, teamId: otherTeam.id, gamesPlayed: 70, points: 1200, rebounds: 400, assists: 300, steals: 60, blocks: 20, fgm: 450, fga: 950, tpm: 90, tpa: 260, ftm: 210, fta: 250, minutes: 2200 },
      { season: 2025, teamId: team.id, gamesPlayed: 72, points: 1400, rebounds: 450, assists: 340, steals: 65, blocks: 22, fgm: 520, fga: 1050, tpm: 110, tpa: 300, ftm: 250, fta: 290, minutes: 2400 }
    ],
    contractHistory: [{ season: 2025, salary: 12000000, yearsRemaining: 3, teamId: team.id, type: 'free_agency' }],
    injuryHistory: [{ season: 2024, type: 'ankle sprain', severity: 'minor', estimatedRecoveryDays: 10, season2: undefined }],
    careerHighs: { singleGame: { points: 48, rebounds: 15 }, singleSeason: { points: 1400, ppg: 19.4 } }
  };

  const result = importModule.importRealPlayerCareerHistory(player, data);
  assert.ok(result, 'import should return the populated careerHistory');
  assert.strictEqual(player.careerHistory.seasonByYear[2024].teamId, otherTeam.id, 'season 2024 should carry the imported team');
  assert.strictEqual(player.careerHistory.seasonByYear[2025].points, 1400, 'season 2025 should carry the imported points');
  assert.strictEqual(player.careerHistory.teamHistory.length, 2, 'two consecutive different-team seasons should produce two tenures');
  assert.strictEqual(player.careerHistory.teamHistory[0].endSeason, 2024, 'the first tenure should close out at 2024');
  assert.strictEqual(player.careerHistory.contractHistory.length, 1, 'contract history should be imported');
  assert.strictEqual(player.careerHistory.injuryHistory.length, 1, 'injury history should be imported');
  assert.strictEqual(player.careerHistory.careerHighs.singleGame.points, 48, 'career highs should be seeded');
  assert.strictEqual(player.isRealPlayer, true, 'importing should flag the player as real');
  assert.strictEqual(player.careerHistoryImported, true, 'importing should flag the player as imported');
  console.log('checkImportRealPlayerCareerHistory: OK');
}

checkImportRealPlayerCareerHistory();

function checkImportIsIdempotent() {
  const player = leagueModule.getTeamRoster(teamsModule.TEAMS[2].id)[0];
  const data = { seasons: [{ season: 2024, teamId: teamsModule.TEAMS[2].id, gamesPlayed: 60, points: 900, rebounds: 300, assists: 200, steals: 40, blocks: 10, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 1800 }] };
  importModule.importRealPlayerCareerHistory(player, data);
  const secondAttempt = importModule.importRealPlayerCareerHistory(player, { seasons: [{ season: 2025, teamId: teamsModule.TEAMS[2].id, gamesPlayed: 10, points: 1, rebounds: 1, assists: 1, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 100 }] });
  assert.strictEqual(secondAttempt, null, 'a second import without force should be a no-op');
  assert.strictEqual(player.careerHistory.seasonByYear[2025], undefined, 'the no-op import should not have written new data');

  const forced = importModule.importRealPlayerCareerHistory(player, { seasons: [{ season: 2025, teamId: teamsModule.TEAMS[2].id, gamesPlayed: 10, points: 1, rebounds: 1, assists: 1, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 100 }] }, true);
  assert.ok(forced, 'force:true should allow re-import');
  assert.ok(player.careerHistory.seasonByYear[2025], 'the forced import should write the new season');
  console.log('checkImportIsIdempotent: OK');
}

checkImportIsIdempotent();

function checkBulkImportCareerHistory() {
  const roster = leagueModule.getTeamRoster(teamsModule.TEAMS[3].id);
  const target = roster[0];
  const untouched = roster[1];
  const dataset = {};
  dataset[target.id] = { seasons: [{ season: 2024, teamId: teamsModule.TEAMS[3].id, gamesPlayed: 50, points: 500, rebounds: 200, assists: 100, steals: 20, blocks: 10, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, minutes: 1200 }] };

  const result = importModule.bulkImportCareerHistory(roster, dataset);
  assert.deepStrictEqual(result.imported, [target.id], 'only the player present in the dataset should be imported');
  assert.strictEqual(careerHistoryModule.ensureCareerHistory(untouched).seasonByYear[2024], undefined, 'a player absent from the dataset should be left untouched');
  console.log('checkBulkImportCareerHistory: OK');
}

checkBulkImportCareerHistory();

console.log('All careerHistoryImport validations passed');
