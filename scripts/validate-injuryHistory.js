const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const careerHistoryModule = require(path.join(__dirname, '..', 'careerHistory.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js')); // registers the boxscore engine as a side effect

// Phase A fix: league.js's simulateDate now records every injury rollInjury
// assigns (careerHistory.recordInjuryInHistory) and every recovery
// decrementInjuriesForTeamGame produces (careerHistory.recordInjuryReturn) —
// previously nothing called either, so ui/playerProfile.js's Injury Timeline
// tab always showed "No injuries on record" despite injuries happening in-game.
function checkInjuryHistoryWiredThroughSimulateDate() {
  const bosRoster = leagueModule.getTeamRoster('BOS');
  const lalRoster = leagueModule.getTeamRoster('LAL');
  const allPlayers = bosRoster.concat(lalRoster);

  allPlayers.forEach(function (p) {
    p.status.injury = null;
    p.status.fatigue = 0;
    const history = careerHistoryModule.ensureCareerHistory(p);
    history.injuryHistory = [];
  });

  const games = [];
  for (let day = 0; day < 150; day++) {
    games.push({ id: day, homeTeamId: day % 2 === 0 ? 'BOS' : 'LAL', awayTeamId: day % 2 === 0 ? 'LAL' : 'BOS', day: day, played: false });
  }
  const season = { games: games };
  const settings = { simEngine: 'boxscore', leagueYear: 2026 };
  const rng = makeRng(999);

  for (let day = 0; day < 150; day++) {
    leagueModule.simulateDate(season, day, settings, rng);
  }

  const playersWithInjuryRecords = allPlayers.filter(function (p) { return p.careerHistory.injuryHistory.length > 0; });
  assert.ok(playersWithInjuryRecords.length > 0, 'at least one player should have a recorded injury after 150 days of games');

  playersWithInjuryRecords.forEach(function (p) {
    p.careerHistory.injuryHistory.forEach(function (record) {
      assert.strictEqual(record.season, 2026);
      assert.strictEqual(record.type, 'In-game injury');
      assert.ok(['minor', 'moderate', 'major', 'severe'].indexOf(record.severity) !== -1, 'unexpected severity tier: ' + record.severity);
      assert.ok(record.gamesOut > 0, 'gamesOut should be recorded at creation time');
      assert.ok(record.estimatedRecoveryDays === null || record.estimatedRecoveryDays > 0);
    });
  });

  const recoveredRecords = playersWithInjuryRecords
    .reduce(function (acc, p) { return acc.concat(p.careerHistory.injuryHistory); }, [])
    .filter(function (r) { return r.actualRecoveryDays !== null; });
  assert.ok(recoveredRecords.length > 0, 'at least one non-season-ending injury should have recovered (and been recorded via recordInjuryReturn) within 150 days');
  recoveredRecords.forEach(function (r) { assert.ok(r.actualRecoveryDays > 0); });

  console.log('checkInjuryHistoryWiredThroughSimulateDate: OK (' + playersWithInjuryRecords.length + ' players injured, ' + recoveredRecords.length + ' recoveries recorded)');
}

checkInjuryHistoryWiredThroughSimulateDate();

console.log('All injury history validations passed');
