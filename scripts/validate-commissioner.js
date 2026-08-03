const assert = require('assert');
const path = require('path');

const commissionerModule = require(path.join(__dirname, '..', 'commissioner.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const saveModule = require(path.join(__dirname, '..', 'save.js'));
const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
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
  // JSON round-trip like the real saveToSlot/loadFromSlot path does (and
  // like scripts/validate-save.js's own tests do) — serializeGameState hands
  // back the LIVE PLAYERS_2026 array by reference (players: _SAVE_DATA...),
  // so without this, applySavedState's `.length = 0; forEach(push)` below
  // truncates payload.players (the same array) before it can be read back,
  // silently wiping the entire roster instead of restoring it.
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'validator-test')));

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

function checkRelocateTeam() {
  const team = teamsModule.TEAMS.find(function (t) { return t.id === 'CHA'; });
  team.fanHappiness = 20;
  team.ownerHappiness = 50;

  const missing = commissionerModule.relocateTeam('not-a-real-team', { name: 'X', primaryColor: '#000000', secondaryColor: '#ffffff', marketSize: 50 });
  assert.strictEqual(missing.success, false, 'relocating an unknown team id should fail cleanly');

  const result = commissionerModule.relocateTeam('CHA', { name: 'Seattle Supersonics', primaryColor: '#006747', secondaryColor: '#FFC200', marketSize: 80 });
  assert.strictEqual(result.success, true);
  assert.strictEqual(team.name, 'Seattle Supersonics');
  assert.strictEqual(team.colors.primary, '#006747');
  assert.strictEqual(team.marketSize, 80);
  assert.strictEqual(team.fanHappiness, 60, 'relocation should reset fan happiness to a neutral baseline');
  assert.strictEqual(team.ownerHappiness, 60, 'relocation should bump owner happiness (was 50, +10)');
  assert.strictEqual(team.conference, 'Eastern', 'relocation should not change conference/division');
  assert.strictEqual(team.id, 'CHA', 'relocation should not change the team id');

  console.log('checkRelocateTeam: OK');
}

checkRelocateTeam();

function checkAutoExpansionGating() {
  // Earlier tests in this file (checkCreateExpansionTeam,
  // checkExpansionTeamSurvivesSaveLoad) each add their own expansion team to
  // the shared TEAMS array — strip those back out so this test starts from
  // the real 30-team baseline instead of however many happen to be left over.
  const nonExpansionTeams = teamsModule.TEAMS.filter(function (t) { return t.id.indexOf('EXP-') !== 0; });
  teamsModule.TEAMS.length = 0;
  nonExpansionTeams.forEach(function (t) { teamsModule.TEAMS.push(t); });
  assert.strictEqual(teamsModule.TEAMS.length, 30, 'test setup should start from the real 30-team baseline');

  const originalTeamsSnapshot = teamsModule.TEAMS.slice();

  // Below the fan-happiness bar: should never trigger regardless of rng.
  teamsModule.TEAMS.forEach(function (t) { t.fanHappiness = 30; });
  const belowBar = commissionerModule.checkAutoExpansion(makeRng(1));
  assert.strictEqual(belowBar, null, 'auto-expansion should not trigger when average fan happiness is low');

  // Above the bar but rng lands outside the trigger chance: a seed search
  // over a small range should find at least one non-triggering roll.
  teamsModule.TEAMS.forEach(function (t) { t.fanHappiness = 95; });
  let foundNonTrigger = false;
  let foundTrigger = false;
  for (let seed = 1; seed < 200 && !(foundNonTrigger && foundTrigger); seed++) {
    const before = teamsModule.TEAMS.length;
    const result = commissionerModule.checkAutoExpansion(makeRng(seed));
    if (result === null) {
      foundNonTrigger = true;
    } else {
      foundTrigger = true;
      assert.strictEqual(teamsModule.TEAMS.length, before + 1, 'a triggered expansion should add exactly one team');
      // Undo so later seeds in this loop still see the original 30-team league.
      teamsModule.TEAMS.length = 0;
      originalTeamsSnapshot.forEach(function (t) { teamsModule.TEAMS.push(t); });
    }
  }
  assert.ok(foundNonTrigger, 'eligible-but-unlucky seasons should be common, not guaranteed to expand');
  assert.ok(foundTrigger, 'eligible seasons should sometimes actually trigger an expansion');

  // At the team cap: should never trigger even when otherwise eligible.
  const originalMax = commissionerModule.AUTO_EXPANSION_MAX_TEAMS;
  while (teamsModule.TEAMS.length < originalMax) {
    teamsModule.TEAMS.push(Object.assign({}, teamsModule.TEAMS[0], { id: 'FILLER-' + teamsModule.TEAMS.length, name: 'Filler ' + teamsModule.TEAMS.length }));
  }
  const atCap = commissionerModule.checkAutoExpansion(makeRng(1));
  assert.strictEqual(atCap, null, 'auto-expansion should not trigger once the team cap is reached');

  teamsModule.TEAMS.length = 0;
  originalTeamsSnapshot.forEach(function (t) { teamsModule.TEAMS.push(t); });

  console.log('checkAutoExpansionGating: OK');
}

checkAutoExpansionGating();

function checkEditPlayerContract() {
  const player = playersModule.PLAYERS_2026.find(function (p) { return p.teamId; });
  const result = commissionerModule.editPlayerContract(player.id, { salary: 25000000, yearsRemaining: 4, playerOption: true });
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.contract.salary, 25000000);
  assert.strictEqual(player.contract.yearsRemaining, 4);
  assert.strictEqual(player.contract.playerOption, true);
  assert.strictEqual(player.contract.teamOption, false, 'fields not passed in changes should be left untouched');

  const negative = commissionerModule.editPlayerContract(player.id, { salary: -500000, yearsRemaining: -2 });
  assert.strictEqual(negative.success, true);
  assert.strictEqual(player.contract.salary, 0, 'salary should clamp to a minimum of 0, not go negative');
  assert.strictEqual(player.contract.yearsRemaining, 0, 'yearsRemaining should clamp to a minimum of 0');

  const missing = commissionerModule.editPlayerContract('not-a-real-id', { salary: 1 });
  assert.strictEqual(missing.success, false);

  console.log('checkEditPlayerContract: OK');
}

checkEditPlayerContract();

function checkEditTeamAttributes() {
  const team = teamsModule.getTeamById('MEM');
  const result = commissionerModule.editTeamAttributes('MEM', { prestige: 95, chemistry: 88 });
  assert.strictEqual(result.success, true);
  assert.strictEqual(team.prestige, 95);
  assert.strictEqual(team.chemistry, 88);

  const clamped = commissionerModule.editTeamAttributes('MEM', { prestige: 500 });
  assert.strictEqual(clamped.success, true);
  assert.strictEqual(team.prestige, 99, 'prestige should clamp to RATING_MAX (99), not accept an out-of-range value');

  const missing = commissionerModule.editTeamAttributes('not-a-real-team', { prestige: 50 });
  assert.strictEqual(missing.success, false);

  console.log('checkEditTeamAttributes: OK');
}

checkEditTeamAttributes();

console.log('All commissioner validations passed');
