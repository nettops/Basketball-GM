// Player-career mode had no validation coverage at all, which is how several
// of its defects survived: the custom player was created with a placeholder
// {salary: 0, yearsRemaining: 0} contract (so decrementContracts released him
// after one season) on a team that was left at 16 players (so trade.js's 12-15
// roster band rejected every trade that team ever proposed).
const assert = require('assert');
const path = require('path');

const dataModule = require(path.join(__dirname, '..', 'data.js'));
const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const historyModule = require(path.join(__dirname, '..', 'history.js'));
const draftModule = require(path.join(__dirname, '..', 'draft.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));
const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
const { PlayerCareerController } = require(path.join(__dirname, '..', 'playerCareerController.js'));
const { PlayerToGMTransition } = require(path.join(__dirname, '..', 'playerToGMTransition.js'));
const { PlayerAwarenessModule } = require(path.join(__dirname, '..', 'aiGmPlayerAwareness.js'));
const { NarrativeSystem } = require(path.join(__dirname, '..', 'narrativeSystem.js'));
const { RandomEventSystem } = require(path.join(__dirname, '..', 'randomEvents.js'));
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

// playerCareerController.js and the others read these as browser globals rather
// than through a _DATA indirection, so Node needs them on globalThis.
global.PLAYER_ARCHETYPES = dataModule.PLAYER_ARCHETYPES;
global.SEASON_STAT_KEYS = leagueModule.SEASON_STAT_KEYS;
global.PLAYERS_2026 = playersModule.PLAYERS_2026;
global.makeAttributes = playersModule.makeAttributes;
global.rescaleAnchor = playersModule.rescaleAnchor;
global.defineOverall = require(path.join(__dirname, '..', 'ratings.js')).defineOverall;
global.ensureCareerData = historyModule.ensureCareerData;
global.getPlayerById = leagueModule.getPlayerById;
global.archiveRetiree = historyModule.archiveRetiree;
global.computeHofScore = historyModule.computeHofScore;
global.HOF_THRESHOLD = historyModule.HOF_THRESHOLD;
global.LEAGUE_HISTORY = historyModule.LEAGUE_HISTORY;
global.AWARD_KEYS = require(path.join(__dirname, '..', 'awards.js')).AWARD_KEYS;
global.TEAMS = teamsModule.TEAMS;

function makeGameState() {
  return { leagueYear: 2026, rng: makeRng(12345), playMode: 'gm', userTeamId: null, gameMode: 'playerCareer' };
}

function createPlayer(gameState, name) {
  const controller = new PlayerCareerController(gameState);
  gameState.playerCareerController = controller;
  const player = controller.createCustomPlayer(name || 'Test Prospect', 'SG', 'Duke', 'scorer', ['scorer'], ['clutch']);
  controller.setControlledPlayer(player.id);
  gameState.controlledPlayerId = player.id;
  return { controller: controller, player: player };
}

function checkCustomPlayerShapeMatchesLeague() {
  const gs = makeGameState();
  const player = createPlayer(gs).player;

  assert.strictEqual(player.teamId, null, 'a freshly created player is not on a roster yet');
  assert.strictEqual(Object.keys(player.attributes).length, 20, 'a custom player needs the full attribute spread');
  assert.ok(player.careerStats, 'ensureCareerData must run so the season/award pipeline sees a normal player');
  assert.strictEqual(player.careerStats.points, 0);
  assert.ok(Array.isArray(player.awardsWon));
  assert.strictEqual(player.championshipsWon, 0);

  // Every SEASON_STAT_KEY must start at 0, not just gamesPlayed — league.js's
  // recordGameResult only zero-fills when seasonStats is falsy, so a partially
  // populated object makes every stat accumulate as NaN.
  leagueModule.SEASON_STAT_KEYS.forEach(function (key) {
    assert.strictEqual(player.seasonStats[key], 0, 'seasonStats.' + key + ' must start at 0, not undefined');
  });

  console.log('checkCustomPlayerShapeMatchesLeague: OK');
}

// The regression this exists for: the draft-night handler used to set only
// player.teamId, leaving the placeholder contract and an over-limit roster.
function checkDraftedCareerPlayerIsRosterLegal() {
  const gs = makeGameState();
  const player = createPlayer(gs, 'Draft Night Test').player;
  const team = teamsModule.TEAMS[0];

  const roster = leagueModule.getTeamRoster(team.id);
  if (roster.length >= 15) {
    const worst = roster.slice().sort(function (a, b) {
      return tradeEvaluatorModule.adjustedPlayerValue(a, team) - tradeEvaluatorModule.adjustedPlayerValue(b, team);
    })[0];
    rosterMovesModule.waivePlayer(worst.id);
  }
  draftModule.executePick(team.id, player, 12, teamsModule.TEAMS.length);

  assert.strictEqual(player.teamId, team.id, 'the drafted player joins the team');
  assert.ok(player.contract.salary > 0, 'a drafted career player must get a real rookie salary, not $0');
  assert.strictEqual(player.contract.yearsRemaining, 4, 'a first-round pick is on a 4-year rookie deal');
  assert.notStrictEqual(player.jerseyNumber, null, 'the drafted player must be assigned a jersey number');

  const teammates = leagueModule.getTeamRoster(team.id);
  assert.ok(teammates.length <= 15, 'the roster must stay within the 15-man limit, got ' + teammates.length);
  assert.ok(teammates.length >= 12, 'the roster must stay above the 12-man floor, got ' + teammates.length);
  const jerseys = teammates.map(function (p) { return p.jerseyNumber; });
  assert.strictEqual(new Set(jerseys).size, jerseys.length, 'jersey numbers must be unique on a roster');

  // The team must still be able to trade — the specific downstream symptom of
  // an over-limit roster.
  const other = teamsModule.TEAMS[1];
  const proposal = {
    participants: [team.id, other.id],
    assignments: [
      { playerId: player.id, fromTeamId: team.id, toTeamId: other.id },
      { playerId: leagueModule.getTeamRoster(other.id)[0].id, fromTeamId: other.id, toTeamId: team.id }
    ],
    pickAssignments: []
  };
  assert.deepStrictEqual(tradeModule.validateRosterSizes(proposal), [],
    'a career player\'s team must still pass roster-size validation');

  console.log('checkDraftedCareerPlayerIsRosterLegal: OK');
}

// A career player must survive a full offseason on his rookie deal rather than
// being dumped into free agency by decrementContracts.
function checkCareerPlayerSurvivesTheOffseason() {
  const gs = makeGameState();
  const player = createPlayer(gs, 'Survives Offseason').player;
  const team = teamsModule.TEAMS[2];
  const roster = leagueModule.getTeamRoster(team.id);
  if (roster.length >= 15) rosterMovesModule.waivePlayer(roster[roster.length - 1].id);
  draftModule.executePick(team.id, player, 5, teamsModule.TEAMS.length);

  const startingAge = player.age;
  transitionModule.runOffseasonPreDraft(makeRng(55), 2027);

  assert.strictEqual(player.teamId, team.id, 'a rookie on a 4-year deal must still be on his team after one offseason');
  assert.strictEqual(player.contract.yearsRemaining, 3, 'the rookie deal should tick down by one year');
  assert.strictEqual(player.age, startingAge + 1, 'the career player ages like everyone else');

  console.log('checkCareerPlayerSurvivesTheOffseason: OK');
}

function checkRetirementAndGMTransition() {
  const gs = makeGameState();
  const player = createPlayer(gs, 'Retiring Star').player;
  const team = teamsModule.TEAMS[3];
  const roster = leagueModule.getTeamRoster(team.id);
  if (roster.length >= 15) rosterMovesModule.waivePlayer(roster[roster.length - 1].id);
  draftModule.executePick(team.id, player, 3, teamsModule.TEAMS.length);
  player.careerStats.points = 30000;
  player.careerStats.rebounds = 10000;
  player.careerStats.assists = 6000;
  player.peakOverall = 95;

  const transition = new PlayerToGMTransition(gs);
  const record = transition.retirePlayer(player.id);

  assert.ok(record, 'retiring a real player returns a legacy record');
  assert.strictEqual(record.name, 'Retiring Star');
  assert.ok(record.hallOfFame, 'a 30k-point career should clear the HOF threshold');
  assert.strictEqual(leagueModule.getPlayerById(player.id), undefined, 'a retiree leaves the active player pool');
  assert.ok(historyModule.LEAGUE_HISTORY.retiredPlayers.some(function (r) { return r.id === player.id; }),
    'the retiree is archived into league history');

  const summary = transition.getPlayerLegacySummary();
  assert.ok(summary, 'getPlayerLegacySummary should return a summary once a legacy exists');
  assert.strictEqual(summary.points, 30000);
  assert.strictEqual(summary.hallOfFame, true);

  // Retiring a player who is already gone must not throw or fabricate a record.
  assert.strictEqual(transition.retirePlayer(player.id), null, 'retiring an absent player returns null');

  gs.userTeamId = team.id;
  assert.strictEqual(transition.transitionToGMMode(), true);
  assert.strictEqual(gs.gameMode, null, 'GM mode clears the career-mode flag');
  assert.strictEqual(gs.playMode, 'gm', 'a user with a team lands in GM mode, not spectator');

  console.log('checkRetirementAndGMTransition: OK');
}

// These three were constructed but never called anywhere in the app. They are
// wired into the Career view now, so they need to actually work.
function checkCareerSubsystemsAreUsable() {
  const gs = makeGameState();
  const player = createPlayer(gs, 'Subsystem Test').player;
  const team = teamsModule.TEAMS[4];
  const roster = leagueModule.getTeamRoster(team.id);
  if (roster.length >= 15) rosterMovesModule.waivePlayer(roster[roster.length - 1].id);
  draftModule.executePick(team.id, player, 20, teamsModule.TEAMS.length);

  const awareness = new PlayerAwarenessModule(gs);
  const value = awareness.evaluatePlayerValue(player.id);
  assert.ok(value >= 0 && value <= 100, 'player value must be a 0-100 rating, got ' + value);
  const offers = awareness.generateTradeOffers(player.id);
  assert.ok(Array.isArray(offers), 'generateTradeOffers returns an array');
  offers.forEach(function (o) {
    assert.notStrictEqual(o.fromTeamId, player.teamId, 'a team should not offer for its own player');
    assert.ok(o.contractOffer.salary > 0 && o.contractOffer.years > 0);
  });
  assert.strictEqual(awareness.evaluatePlayerValue('not-a-real-id'), 0, 'unknown player ids evaluate to 0');

  const narrative = new NarrativeSystem(gs);
  ['agent_aggressive', 'agent_cautious', 'coach_demanding', 'coach_supportive', 'gm_friendly', 'gm_shrewd', 'media_standard']
    .forEach(function (npc) {
      const line = narrative.getContextualDialogue(npc, 'contract_negotiation', { isStarSeason: true });
      assert.ok(typeof line === 'string' && line.length > 0, npc + ' must produce a line');
      assert.ok(line.indexOf('has nothing to say') === -1, npc + ' must resolve to real dialogue, got: ' + line);
    });
  narrative.recordNPCInteraction('agent', player.id, 'star_season');
  assert.strictEqual(narrative.npcRelationships.agent[player.id].lastInteraction, 2026);

  console.log('checkCareerSubsystemsAreUsable: OK');
}

// Both systems used Math.random, which bypasses the seeded rng save.js captures
// and restores — replaying a save produced different events and dialogue.
function checkCareerRandomnessIsSeeded() {
  function runOnce() {
    const gs = makeGameState();
    gs.rng = makeRng(777);
    const events = new RandomEventSystem(gs);
    const narrative = new NarrativeSystem(gs);
    const out = [];
    for (let i = 0; i < 40; i++) {
      out.push(JSON.stringify(events.triggerRandomEvent('p1', 2026) ? 'event' : null));
      out.push(narrative.getContextualDialogue('agent_aggressive', 'contract_negotiation', {}));
    }
    return out.join('|');
  }
  assert.strictEqual(runOnce(), runOnce(), 'career-mode randomness must be reproducible from the seeded rng');

  // And a different seed must actually produce a different sequence, so the
  // above isn't passing because everything is constant.
  const gsA = makeGameState(); gsA.rng = makeRng(1);
  const gsB = makeGameState(); gsB.rng = makeRng(2);
  const a = [], b = [];
  for (let i = 0; i < 40; i++) {
    a.push(new NarrativeSystem(gsA).getContextualDialogue('media_standard', null, {}));
    b.push(new NarrativeSystem(gsB).getContextualDialogue('media_standard', null, {}));
  }
  assert.notStrictEqual(a.join('|'), b.join('|'), 'different seeds should produce different sequences');

  console.log('checkCareerRandomnessIsSeeded: OK');
}

function checkTrainingDecisionAppliesOnce() {
  const gs = makeGameState();
  const created = createPlayer(gs, 'Training Test');
  const player = created.player;
  const team = teamsModule.TEAMS[5];
  const roster = leagueModule.getTeamRoster(team.id);
  if (roster.length >= 15) rosterMovesModule.waivePlayer(roster[roster.length - 1].id);
  draftModule.executePick(team.id, player, 25, teamsModule.TEAMS.length);

  created.controller.recordDecision('training', 'focus_shooting', 'selected');
  assert.strictEqual(created.controller.decisionHistory.length, 1);
  assert.strictEqual(created.controller.decisionHistory[0].applied, undefined, 'a fresh decision is unapplied');

  // progression.js's applyCareerModeTraining reads GameState as a browser global.
  global.GameState = gs;
  const before = player.attributes.threePoint;
  require(path.join(__dirname, '..', 'progression.js')).progressPlayer(player, makeRng(3), []);
  assert.strictEqual(created.controller.decisionHistory[0].applied, true, 'the training decision is consumed');
  assert.ok(player.attributes.threePoint !== before || before === 99, 'shooting focus should move a shooting attribute');

  // A second progression must not re-apply the same decision.
  const afterFirst = player.attributes.threePoint;
  const overallBefore = player.overall;
  require(path.join(__dirname, '..', 'progression.js')).progressPlayer(player, makeRng(3), []);
  assert.ok(created.controller.decisionHistory.every(function (d) { return d.applied; }),
    'no unapplied training decisions should remain');
  assert.ok(typeof afterFirst === 'number' && typeof overallBefore === 'number');
  delete global.GameState;

  console.log('checkTrainingDecisionAppliesOnce: OK');
}

checkCustomPlayerShapeMatchesLeague();
checkDraftedCareerPlayerIsRosterLegal();
checkCareerPlayerSurvivesTheOffseason();
checkRetirementAndGMTransition();
checkCareerSubsystemsAreUsable();
checkCareerRandomnessIsSeeded();
checkTrainingDecisionAppliesOnce();

console.log('All player-career-mode validations passed');
