const assert = require('assert');
const path = require('path');

const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const draftModule = require(path.join(__dirname, '..', 'draft.js'));
const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
const seasonTransitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const autoGMModule = require(path.join(__dirname, '..', 'autoGM.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkEvaluateUserLeg() {
  const teamA = teamsModule.TEAMS[0];
  const teamB = teamsModule.TEAMS[1];
  const rosterA = leagueModule.getTeamRoster(teamA.id);
  const rosterB = leagueModule.getTeamRoster(teamB.id);
  const best = rosterB.slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(b, teamB) - tradeEvaluatorModule.adjustedPlayerValue(a, teamB); })[0];
  const worst = rosterA.slice().sort(function (a, b) { return tradeEvaluatorModule.adjustedPlayerValue(a, teamA) - tradeEvaluatorModule.adjustedPlayerValue(b, teamA); })[0];
  const proposal = {
    participants: [teamA.id, teamB.id],
    assignments: [
      { playerId: worst.id, fromTeamId: teamA.id, toTeamId: teamB.id },
      { playerId: best.id, fromTeamId: teamB.id, toTeamId: teamA.id }
    ],
    pickAssignments: []
  };
  const defaultResult = tradeModule.evaluateTrade(proposal, teamA.id);
  const uncheckedResult = tradeModule.evaluateTrade(proposal, teamA.id, false);
  const checkedResult = tradeModule.evaluateTrade(proposal, teamA.id, true);
  assert.strictEqual(defaultResult.legs[teamA.id].isUser, true, 'omitting the param preserves the isUser bypass');
  assert.strictEqual(uncheckedResult.legs[teamA.id].isUser, true, 'explicit false preserves the isUser bypass');
  assert.strictEqual(checkedResult.legs[teamA.id].isUser, undefined, 'evaluateUserLeg true runs the user leg through evaluateTeamLeg like any other team');
  console.log('checkEvaluateUserLeg: OK');
}

checkEvaluateUserLeg();

function checkDraftSession() {
  const rng = makeRng(900);
  const order = { firstRound: teamsModule.TEAMS.map(function (t) { return t.id; }), secondRound: teamsModule.TEAMS.slice().reverse().map(function (t) { return t.id; }) };
  const pool = prospectsModule.generateProspectClass(rng, 60);
  const session = draftModule.startDraftSession(order, pool);
  const userTeamId = order.firstRound[10];

  draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
  assert.strictEqual(draftModule.currentPick(session).teamId, userTeamId, 'should stop exactly at the user team\'s pick');
  assert.strictEqual(session.results.length, 10, 'should have resolved the 10 picks before the user\'s slot');

  draftModule.resolveCurrentPick(session, session.available[0]);
  draftModule.advanceDraftUntilUserTurn(session, userTeamId, false);
  assert.ok(draftModule.currentPick(session) === null || draftModule.currentPick(session).teamId === userTeamId, 'next stop (if any) should again be the user\'s next slot');

  draftModule.advanceDraftUntilUserTurn(session, userTeamId, true);
  assert.strictEqual(session.results.length, 60, 'a full draft should still produce 60 picks total');
  assert.strictEqual(new Set(session.results.map(function (r) { return r.prospect.id; })).size, 60, 'no prospect drafted twice');
  console.log('checkDraftSession: OK');
}

checkDraftSession();

function checkOffseasonPreDraftExtraction() {
  const rng = makeRng(950);
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 10 + i, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const bracket = playoffsModule.generateBracket();
  let g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, { simEngine: 'boxscore' }, rng); }

  const pre = seasonTransitionModule.runOffseasonPreDraft(rng);
  assert.ok(typeof pre.retireeCount === 'number', 'runOffseasonPreDraft should report a retiree count');

  const pool = prospectsModule.generateProspectClass(rng, 60);
  const order = draftModule.buildDraftOrder(bracket, rng);
  const results = draftModule.runDraft(order, pool);
  assert.strictEqual(results.length, 60, 'draft after a manually-run pre-draft step should still produce 60 picks');
  console.log('checkOffseasonPreDraftExtraction: OK');
}

checkOffseasonPreDraftExtraction();

function checkAutoEnforceRosterSize() {
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
  const team = teamsModule.TEAMS[2];
  const before = leagueModule.getTeamRoster(team.id).length;
  // Push enough overflow players to guarantee we clear 15 regardless of
  // `before` — earlier checks in this same process (e.g.
  // checkOffseasonPreDraftExtraction's retirements) mutate real rosters, so
  // `before` isn't a fixed number run to run.
  const overflowCount = Math.max(3, 18 - before);
  for (let i = 0; i < overflowCount; i++) {
    playersModule.PLAYERS_2026.push({
      id: 'validate-automation-overflow-' + i, name: 'Overflow Guy ' + i, teamId: team.id, position: 'SF', age: 30,
      overall: 40, potential: 40, jerseyNumber: 90 + i,
      contract: { salary: 1500000, yearsRemaining: 1, playerOption: false, teamOption: false },
      status: { fatigue: 0, injury: null, morale: 50 },
      attributes: {}, hiddenTraits: [], hiddenPersonality: {}, hiddenTendencies: {}
    });
  }
  assert.strictEqual(leagueModule.getTeamRoster(team.id).length, before + overflowCount, 'roster should be overflowed before enforcement');
  assert.ok(leagueModule.getTeamRoster(team.id).length > 15, 'test setup should guarantee an overflow above 15');
  const waived = autoGMModule.autoEnforceRosterSize(team);
  assert.ok(waived.length > 0, 'should have waived at least one player');
  assert.ok(leagueModule.getTeamRoster(team.id).length <= 15, 'roster should be back at or under 15 after enforcement');
  console.log('checkAutoEnforceRosterSize: OK');
}

checkAutoEnforceRosterSize();

function checkAutoAllocateScoutPoints() {
  const scoutingModule = require(path.join(__dirname, '..', 'scouting.js'));
  const state = scoutingModule.initScoutingState();
  state.pointsAvailable = 100;
  const ownRosterIds = leagueModule.getTeamRoster(teamsModule.TEAMS[3].id).map(function (p) { return p.id; });
  autoGMModule.autoAllocateScoutPoints(state, ownRosterIds, [], []);
  assert.ok(state.pointsAvailable < 100, 'points should have been spent');
  const anySpent = ownRosterIds.some(function (id) { return state.targets[id] && state.targets[id].confidence > 0; });
  assert.ok(anySpent, 'at least one own-roster player should have gained confidence');
  console.log('checkAutoAllocateScoutPoints: OK');
}

checkAutoAllocateScoutPoints();

function checkGenerateTradeOffer() {
  const rng = makeRng(1000);
  let foundValid = false;
  for (let i = 0; i < teamsModule.TEAMS.length && !foundValid; i++) {
    const offer = autoGMModule.generateTradeOffer(teamsModule.TEAMS[i], rng);
    if (offer) {
      assert.strictEqual(offer.evaluation.accepted, true, 'a returned offer must have both legs accepted');
      assert.strictEqual(offer.proposal.assignments.length, 2, 'generator produces exactly a 1-for-1 swap');
      foundValid = true;
    }
  }
  assert.ok(foundValid, 'at least one of the 30 real rosters should produce a valid generated trade offer');
  console.log('checkGenerateTradeOffer: OK');
}

checkGenerateTradeOffer();

function checkSimulateDatePayload() {
  const scheduleModule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const rng = makeRng(1100);
  const games = scheduleModule.generateSeasonGames(rng, teamsModule.TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  let seenTodaysGames = null;
  let seenNewInjuries = null;
  leagueModule.simulateDate(season, 0, { simEngine: 'boxscore' }, rng, function (dayIndex, todaysGames, newInjuries) {
    seenTodaysGames = todaysGames;
    seenNewInjuries = newInjuries;
  });
  assert.ok(Array.isArray(seenTodaysGames), 'onDayComplete should receive the games played that day');
  assert.ok(Array.isArray(seenNewInjuries), 'onDayComplete should receive a (possibly empty) newInjuries array');
  console.log('checkSimulateDatePayload: OK');
}

checkSimulateDatePayload();

console.log('All automation validations passed');
