const assert = require('assert');
const path = require('path');

const commissionerModule = require(path.join(__dirname, '..', 'commissioner.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEditPlayerRatings() {
  const team = teamsModule.TEAMS[0];
  const player = leagueModule.getTeamRoster(team.id)[0];
  const result = commissionerModule.editPlayerRatings(player.id, { overall: 500, potential: -50, attributes: { threePoint: 999, block: -999 } });
  assert.strictEqual(result.success, true, 'edit should report success for a real player');
  assert.strictEqual(player.overall, 99, 'overall should clamp to RATING_MAX');
  assert.strictEqual(player.potential, 25, 'potential should clamp to RATING_MIN');
  assert.strictEqual(player.attributes.threePoint, 99, 'attribute should clamp to RATING_MAX');
  assert.strictEqual(player.attributes.block, 25, 'attribute should clamp to RATING_MIN');
  const missing = commissionerModule.editPlayerRatings('not-a-real-id', { overall: 80 });
  assert.strictEqual(missing.success, false, 'editing an unknown player id should fail cleanly');
  console.log('checkEditPlayerRatings: OK');
}

checkEditPlayerRatings();

function checkDeletePlayer() {
  const team = teamsModule.TEAMS[1];
  const player = leagueModule.getTeamRoster(team.id)[0];
  const result = commissionerModule.deletePlayer(player.id);
  assert.strictEqual(result.success, true, 'delete should report success for a real player');
  assert.strictEqual(leagueModule.getPlayerById(player.id), undefined, 'deleted player should no longer be findable');
  const missing = commissionerModule.deletePlayer('not-a-real-id');
  assert.strictEqual(missing.success, false, 'deleting an unknown player id should fail cleanly');
  console.log('checkDeletePlayer: OK');
}

checkDeletePlayer();

function checkCreatePlayer() {
  const freeAgent = commissionerModule.createPlayer({ name: 'Validator Rookie', position: 'SG', age: 19, overall: 70, potential: 88, archetype: 'primary_scorer' });
  assert.strictEqual(freeAgent.teamId, null, 'a player created with no teamId should be a free agent');
  assert.strictEqual(Object.keys(freeAgent.attributes).length, 20, 'attributes should be fully derived, not left empty');
  assert.ok(Array.isArray(freeAgent.hiddenTraits), 'hiddenTraits should be an array');
  assert.strictEqual(typeof freeAgent.hiddenPersonality.ego, 'number', 'hiddenPersonality should be populated, not an empty stub');
  assert.strictEqual(typeof freeAgent.hiddenTendencies.threeTendency, 'number', 'hiddenTendencies should be populated, not an empty stub');

  const team = teamsModule.TEAMS[3];
  const rostered = commissionerModule.createPlayer({ name: 'Validator Starter', position: 'C', age: 24, overall: 82, potential: 82, archetype: 'rim_protector', teamId: team.id });
  assert.strictEqual(rostered.teamId, team.id, 'a player created with a teamId should be rostered on that team');
  assert.ok(rostered.contract.salary > 0, 'a rostered created player should have a nonzero salary');
  assert.strictEqual(typeof rostered.jerseyNumber, 'number', 'a rostered created player should get a jersey number');
  assert.strictEqual(leagueModule.getPlayerById(rostered.id), rostered, 'created player should be findable via getPlayerById');
  console.log('checkCreatePlayer: OK');
}

checkCreatePlayer();

function checkForceTrade() {
  const teamA = teamsModule.TEAMS[10];
  const teamB = teamsModule.TEAMS[11];
  const rosterA = leagueModule.getTeamRoster(teamA.id).slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(b, teamA) - tradeEvaluatorModule.adjustedPlayerValue(a, teamA); });
  const rosterB = leagueModule.getTeamRoster(teamB.id).slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(a, teamB) - tradeEvaluatorModule.adjustedPlayerValue(b, teamB); });
  const best = rosterA[0];
  const worst = rosterB[0];
  const lopsided = {
    participants: [teamA.id, teamB.id],
    assignments: [
      { playerId: best.id, fromTeamId: teamA.id, toTeamId: teamB.id },
      { playerId: worst.id, fromTeamId: teamB.id, toTeamId: teamA.id }
    ],
    pickAssignments: []
  };
  const normalEval = tradeModule.evaluateTrade(lopsided, null, true);
  assert.strictEqual(normalEval.accepted, false, 'test setup should produce a trade normal evaluation would reject');
  const forced = commissionerModule.forceTrade(lopsided);
  assert.strictEqual(forced.success, true, 'forceTrade should execute a trade normal evaluation would reject');
  assert.strictEqual(leagueModule.getPlayerById(best.id).teamId, teamB.id, 'forceTrade should actually move the players');

  const teamC = teamsModule.TEAMS[15];
  const rosterC = leagueModule.getTeamRoster(teamC.id);
  const dumpAssignments = rosterC.slice(0, rosterC.length - 5).map(function (p) { return { playerId: p.id, fromTeamId: teamC.id, toTeamId: teamA.id }; });
  const dumpEveryone = { participants: [teamC.id, teamA.id], assignments: dumpAssignments, pickAssignments: [] };
  const blocked = commissionerModule.forceTrade(dumpEveryone);
  assert.strictEqual(blocked.success, false, 'forceTrade should still block a trade that would break the 12-15 roster-size band');
  assert.ok(blocked.rosterErrors.length > 0, 'a blocked forceTrade should report why');
  console.log('checkForceTrade: OK');
}

checkForceTrade();

function checkCreateExpansionTeam() {
  const rng = makeRng(2026);
  const beforeCount = teamsModule.TEAMS.length;
  const team = commissionerModule.createExpansionTeam({ name: 'Vegas Aces', primaryColor: '#111111', secondaryColor: '#EEEEEE', marketSize: 60 }, rng);
  assert.strictEqual(teamsModule.TEAMS.length, beforeCount + 1, 'expansion team should be appended to TEAMS');
  assert.ok(team.conference === 'Eastern' || team.conference === 'Western', 'expansion team should get a valid conference');
  const roster = leagueModule.getTeamRoster(team.id);
  assert.ok(roster.length >= 12 && roster.length <= 15, 'expansion roster should land within the standard 12-15 band');
  assert.strictEqual(new Set(roster.map(function (p) { return p.jerseyNumber; })).size, roster.length, 'expansion roster should have no duplicate jersey numbers');
  const noDonorBelowFloor = teamsModule.TEAMS
    .filter(function (t) { return t.id !== team.id; })
    .every(function (t) { return leagueModule.getTeamRoster(t.id).length >= 12; });
  assert.ok(noDonorBelowFloor, 'no donor team should drop below the 12-player floor during an expansion draft');
  console.log('checkCreateExpansionTeam: OK');
}

checkCreateExpansionTeam();

function checkExpansionTeamSurvivesSaveLoad() {
  const rng = makeRng(78);
  const team = commissionerModule.createExpansionTeam({ name: 'Portland Pines', primaryColor: '#004400', secondaryColor: '#FFFFFF', marketSize: 45 }, rng);
  const gameState = {
    userTeamId: teamsModule.TEAMS[0].id, currentView: 'dashboard', season: null, playoffBracket: null,
    upcomingDraftClass: [], lastDraftResults: [], scouting: null, leagueYear: 2026, offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'normal', pauseOn: {}, capDisabled: false }, rng: rng,
    playMode: 'commissioner', automation: {}, feed: [], draftSession: null
  };
  const payload = saveModule.serializeGameState(gameState, 'validator-test');

  const idx = teamsModule.TEAMS.findIndex(function (t) { return t.id === team.id; });
  teamsModule.TEAMS.splice(idx, 1);
  assert.strictEqual(teamsModule.TEAMS.findIndex(function (t) { return t.id === team.id; }), -1, 'test setup should simulate a fresh reload with the expansion team absent');

  const freshState = {};
  saveModule.applySavedState(payload, freshState);
  const restored = teamsModule.TEAMS.find(function (t) { return t.id === team.id; });
  assert.ok(restored, 'expansion team should be recreated in TEAMS on load');
  assert.strictEqual(restored.name, 'Portland Pines', 'restored expansion team should keep its identity fields');
  assert.strictEqual(restored.conference, team.conference, 'restored expansion team should keep its assigned conference');
  assert.strictEqual(restored.marketSize, team.marketSize, 'restored expansion team should keep its mutable fields');
  console.log('checkExpansionTeamSurvivesSaveLoad: OK');
}

checkExpansionTeamSurvivesSaveLoad();

console.log('All commissioner validations passed');
