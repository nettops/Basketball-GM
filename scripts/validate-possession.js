const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const simEngine = require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

function checkEngineRegistered() {
  assert.ok(simEngine.SIM_ENGINES.possession, 'possession engine should self-register on load');
  assert.strictEqual(typeof simEngine.SIM_ENGINES.possession.simulateGame, 'function');
  console.log('checkEngineRegistered: OK');
}

checkEngineRegistered();

function checkBoxScoreConsistency() {
  const rng = makeRng(11);
  for (let i = 0; i < 20; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 7) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = possEngine.simulateGame(home.id, away.id, rng);
    assert.notStrictEqual(result.homeScore, result.awayScore, 'games cannot end in a tie');
    assert.ok(result.homeScore >= 60 && result.homeScore <= 170, 'home score should be in a realistic NBA range: ' + result.homeScore);
    assert.ok(result.awayScore >= 60 && result.awayScore <= 170, 'away score should be in a realistic NBA range: ' + result.awayScore);

    const homeIds = league.getTeamRoster(home.id).filter(function (p) { return !p.status.injury; }).map(function (p) { return p.id; });
    const awayIds = league.getTeamRoster(away.id).filter(function (p) { return !p.status.injury; }).map(function (p) { return p.id; });
    let homeSum = 0, awaySum = 0, homeMinutes = 0, awayMinutes = 0;
    Object.keys(result.boxScore).forEach(function (id) {
      const line = result.boxScore[id];
      ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'].forEach(function (k) {
        assert.ok(typeof line[k] === 'number' && line[k] >= 0, k + ' should be a non-negative number for ' + id);
      });
      assert.ok(line.fga >= line.fgm, 'fga must be >= fgm');
      assert.ok(line.tpa >= line.tpm, 'tpa must be >= tpm');
      assert.ok(line.fta >= line.ftm, 'fta must be >= ftm');
      if (homeIds.indexOf(id) !== -1) { homeSum += line.points; homeMinutes += line.minutes; }
      if (awayIds.indexOf(id) !== -1) { awaySum += line.points; awayMinutes += line.minutes; }
    });
    assert.strictEqual(homeSum, result.homeScore, 'sum of home box-score points must equal the reported home score');
    assert.strictEqual(awaySum, result.awayScore, 'sum of away box-score points must equal the reported away score');
    assert.strictEqual(homeMinutes, 240, 'home team minutes must sum to exactly 240 (5 x 48)');
    assert.strictEqual(awayMinutes, 240, 'away team minutes must sum to exactly 240 (5 x 48)');
  }
  console.log('checkBoxScoreConsistency: OK');
}

checkBoxScoreConsistency();

function checkInjuredPlayersExcluded() {
  const rng = makeRng(5);
  const roster = league.getTeamRoster('BOS');
  const star = roster.find(function (p) { return p.id === 'bos-jayson-tatum'; });
  const originalInjury = star.status.injury;
  star.status.injury = { severity: 'Season Ending', gamesRemaining: 999 };
  const result = possEngine.simulateGame('BOS', 'LAL', rng);
  assert.ok(!(star.id in result.boxScore), 'an injured player should not appear in the box score at all');
  star.status.injury = originalInjury;
  console.log('checkInjuredPlayersExcluded: OK');
}

checkInjuredPlayersExcluded();

function checkSeasonIntegrationWithPossessionEngine() {
  const schedule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'fatigue.js'));
  require(path.join(__dirname, '..', 'injuries.js'));
  require(path.join(__dirname, '..', 'morale.js'));
  const rng = makeRng(99);
  const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const settings = { simEngine: 'possession' };
  const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  const targetDay = Math.min(lastDay, 20);
  const dayReached = league.simulateThroughDate(season, -1, targetDay, settings, rng, null);
  assert.strictEqual(dayReached, targetDay);
  assert.ok(season.games.filter(function (g) { return g.played; }).length > 0, 'some games should have been played');
  console.log('checkSeasonIntegrationWithPossessionEngine: OK');
}

checkSeasonIntegrationWithPossessionEngine();

console.log('All possession engine validations passed');
