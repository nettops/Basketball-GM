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
const dataModule = require(path.join(__dirname, '..', 'data.js'));

// Restoring TEAMS alone is not enough to undo an expansion: createExpansionTeam
// also reassigns donor players' teamId/jerseyNumber and appends brand-new filler
// players to PLAYERS_2026. Dropping the team without undoing those left players
// stranded on a team that no longer exists, which silently drained donor rosters
// for every later check in this file. These two helpers restore the whole league.
function snapshotLeague() {
  return {
    teams: teamsModule.TEAMS.slice(),
    playerCount: playersModule.PLAYERS_2026.length,
    players: playersModule.PLAYERS_2026.map(function (p) {
      return { ref: p, teamId: p.teamId, jerseyNumber: p.jerseyNumber, contract: Object.assign({}, p.contract) };
    })
  };
}

function restoreLeague(snap) {
  teamsModule.TEAMS.length = 0;
  snap.teams.forEach(function (t) { teamsModule.TEAMS.push(t); });
  // Players created after the snapshot were appended, so truncating is enough.
  playersModule.PLAYERS_2026.length = snap.playerCount;
  snap.players.forEach(function (e) {
    e.ref.teamId = e.teamId;
    e.ref.jerseyNumber = e.jerseyNumber;
    e.ref.contract = Object.assign({}, e.contract);
  });
}

// Every team must be inside the roster band the rest of the game assumes.
// Asserted at the end of each expansion-touching check so a leak surfaces where
// it happens rather than as a confusing failure three checks later.
function assertLeagueRostersAreLegal(context) {
  teamsModule.TEAMS.forEach(function (t) {
    const size = leagueModule.getTeamRoster(t.id).length;
    assert.ok(size >= 12 && size <= 15, context + ': ' + t.id + ' has ' + size + ' players, outside the 12-15 band');
  });
}

function checkEditPlayerRatings() {
  const team = teamsModule.TEAMS[0];
  const player = leagueModule.getTeamRoster(team.id)[0];
  // Read from data.js rather than hard-coded, so a future scale change cannot
  // leave this passing against numbers that no longer exist.
  const RMIN = dataModule.RATING_MIN, RMAX = dataModule.RATING_MAX;

  // `overall` is derived from the attributes now, so these are no longer
  // independent knobs and asking for both at once is self-contradictory: the
  // original single edit set overall to the maximum AND block to the minimum,
  // which cannot both be true of one player. editPlayerRatings applies the
  // overall solve first and explicit attributes after, so the attributes win —
  // that precedence is the thing worth pinning, and it is checked below.
  const overallOnly = commissionerModule.editPlayerRatings(player.id, { overall: 500, potential: -50 });
  assert.strictEqual(overallOnly.success, true, 'edit should report success for a real player');
  // The display CAPS AT 99 since the 2K-grading fit (2K has no 100s), and it
  // saturates before the attributes pin — a 99 no longer requires a maxed
  // sheet, so the old "every attribute at RATING_MAX" expectation was
  // geometry, not the property. The property: an absurd request lands the
  // player exactly on the ceiling the user can see.
  assert.strictEqual(player.overall, 99,
    'an out-of-range overall should land on the 99 display ceiling');
  assert.strictEqual(player.potential, RMIN, 'potential should clamp to RATING_MIN');

  const attrEdit = commissionerModule.editPlayerRatings(player.id, { attributes: { threePoint: 999, block: -999 } });
  assert.strictEqual(attrEdit.success, true);
  assert.strictEqual(player.attributes.threePoint, RMAX, 'attribute should clamp to RATING_MAX');
  assert.strictEqual(player.attributes.block, RMIN, 'attribute should clamp to RATING_MIN');

  // An explicit attribute must beat the overall solve in the same edit.
  commissionerModule.editPlayerRatings(player.id, { overall: 500, attributes: { block: 0 } });
  assert.strictEqual(player.attributes.block, RMIN,
    'an explicit attribute must win over the overall solve in the same edit');
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

  const leagueSnapshot = snapshotLeague();

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
      // Undo the whole expansion — team list, donor rosters, and the filler
      // players it generated — so later seeds see a genuinely pristine league.
      restoreLeague(leagueSnapshot);
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

  restoreLeague(leagueSnapshot);
  assertLeagueRostersAreLegal('after auto-expansion gating');

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
  // Team prestige rides the same clampRating as player ratings, so it moved
  // with the scale. Read from data.js rather than hard-coded.
  assert.strictEqual(team.prestige, dataModule.RATING_MAX,
    'prestige should clamp to RATING_MAX, not accept an out-of-range value');

  const missing = commissionerModule.editTeamAttributes('not-a-real-team', { prestige: 50 });
  assert.strictEqual(missing.success, false);

  console.log('checkEditTeamAttributes: OK');
}

checkEditTeamAttributes();

// An expansion team used to be quietly unusable: schedule.js's cross-division
// pass was hardcoded to 5-team divisions, so every matchup involving the 6th
// team in a division had no game count and expandToGameList dropped it as NaN
// — the new team played zero games. The draft was worse: 62 picks against a
// 60-prospect pool, with pick #31 emitted twice. This pins all of it.
function checkExpansionTeamIsFullyPlayable() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const rng = makeRng(4242);

  // Snapshot first so this check neither inherits nor leaks league state. It
  // previously depended on whatever earlier checks in this file happened to
  // leave behind, which is how it once failed on a drained donor pool.
  const leagueSnapshot = snapshotLeague();
  assertLeagueRostersAreLegal('before expansion');

  const before = teamsModule.TEAMS.length;
  const team = commissionerModule.createExpansionTeam({
    name: 'Expansion Test Club', primaryColor: '#111111', secondaryColor: '#eeeeee', marketSize: 60
  }, rng);
  assert.strictEqual(teamsModule.TEAMS.length, before + 1, 'the expansion team should join the league');
  assert.ok(team.coach, 'an expansion team needs a coach — nothing else assigns one after initSeason');
  assert.ok(team.strategy, 'an expansion team needs strategy dials for the sim engines to read');
  assert.ok(leagueModule.getTeamRoster(team.id).length >= 12, 'the expansion draft should clear the 12-man floor');

  const divisionSize = teamsModule.TEAMS.filter(function (t) {
    return t.conference === team.conference && t.division === team.division;
  }).length;
  assert.strictEqual(divisionSize, 6, 'the 31st team should make one division 6 deep — the case that used to break');

  const season = transitionModule.generateNewSeason(rng);
  const gamesFor = function (teamId) {
    return season.games.filter(function (g) { return g.homeTeamId === teamId || g.awayTeamId === teamId; }).length;
  };
  const counts = teamsModule.TEAMS.map(function (t) { return gamesFor(t.id); });
  assert.ok(Math.min.apply(null, counts) >= 80, 'every team must get a full schedule, expansion team included');
  assert.ok(Math.max.apply(null, counts) - Math.min.apply(null, counts) <= 4, 'schedules should stay within a few games of each other');

  teamsModule.TEAMS.forEach(function (t, i) {
    const noDoubleBooking = {};
    season.games.filter(function (g) { return g.homeTeamId === t.id || g.awayTeamId === t.id; })
      .forEach(function (g) {
        assert.ok(!noDoubleBooking[g.day], t.id + ' is booked twice on day ' + g.day);
        noDoubleBooking[g.day] = true;
      });
  });

  assert.ok(season.nextDraftClass.length >= teamsModule.TEAMS.length * 2,
    'the prospect class must cover both rounds of a 31-team draft');

  const bracket = { first: [], semis: [], confFinals: [], finals: [{ winner: 'BOS', higherSeed: 'BOS', lowerSeed: 'LAL', complete: true }] };
  for (let i = 0; i < 8; i++) bracket.first.push({ winner: 'BOS', higherSeed: 'BOS', lowerSeed: 'LAL' });
  for (let i = 0; i < 4; i++) bracket.semis.push({ winner: 'BOS', higherSeed: 'BOS', lowerSeed: 'LAL' });
  for (let i = 0; i < 2; i++) bracket.confFinals.push({ winner: 'BOS', higherSeed: 'BOS', lowerSeed: 'LAL' });
  const order = draftModule.buildDraftOrder(bracket, rng);
  const results = draftModule.runDraft(order, season.nextDraftClass);
  const pickNumbers = results.map(function (r) { return r.pickNumber; });
  assert.strictEqual(new Set(pickNumbers).size, pickNumbers.length, 'every pick number must be unique across both rounds');
  assert.strictEqual(results.length, teamsModule.TEAMS.length * 2, 'a 31-team draft is 62 picks');
  const firstSecondRounder = results.find(function (r) { return r.round === 2; });
  assert.strictEqual(firstSecondRounder.pickNumber, teamsModule.TEAMS.length + 1,
    'round 2 must start one past the end of round 1, not at a hardcoded 31');
  assert.strictEqual(firstSecondRounder.prospect.contract.yearsRemaining, 2,
    'the round-1/round-2 rookie-scale boundary must follow league size');

  restoreLeague(leagueSnapshot);
  assert.strictEqual(teamsModule.TEAMS.length, before, 'the league must be restored to its pre-expansion size');
  assertLeagueRostersAreLegal('after expansion');

  console.log('checkExpansionTeamIsFullyPlayable: OK');
}

checkExpansionTeamIsFullyPlayable();

console.log('All commissioner validations passed');
