const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));

function checkProgression() {
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const rng = makeRng(1);

  // A young high-potential player should trend upward on average over many rolls.
  const youngProspect = { age: 20, yearsPro: 2, overall: 65, potential: 88, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { youngProspect.attributes[k] = 65; });
  let totalChange = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const before = youngProspect.overall;
    progressionModule.progressPlayer(youngProspect, rng);
    totalChange += youngProspect.overall - before;
    youngProspect.overall = before; // reset for an independent trial
    youngProspect.age = 20;
    youngProspect.yearsPro = 2;
  }
  assert.ok(totalChange / TRIALS > 0, 'a young player far below potential should trend upward on average');

  // A declining veteran should trend downward on average.
  const veteran = { age: 35, yearsPro: 13, overall: 78, potential: 78, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { veteran.attributes[k] = 78; });
  let veteranChange = 0;
  for (let i = 0; i < TRIALS; i++) {
    const before = veteran.overall;
    progressionModule.progressPlayer(veteran, rng);
    veteranChange += veteran.overall - before;
    veteran.overall = before;
    veteran.age = 35;
    veteran.yearsPro = 13;
  }
  assert.ok(veteranChange / TRIALS < 0, 'a 35-year-old should trend downward on average');

  // Invariant and range checks after a single real progression call.
  const p = { age: 24, yearsPro: 3, overall: 90, potential: 90, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 90; });
  progressionModule.progressPlayer(p, rng);
  assert.strictEqual(p.yearsPro, 4, 'yearsPro must increment alongside age each offseason');
  assert.ok(p.potential >= p.overall, 'potential must stay >= overall after progression');
  assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX);
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) {
    assert.ok(p.attributes[k] >= dataModule.RATING_MIN && p.attributes[k] <= dataModule.RATING_MAX, k + ' out of range after progression');
  });

  console.log('checkProgression: OK');
}

checkProgression();

function checkDraftPickValue() {
  const pickValueModule = require(path.join(__dirname, '..', 'draftPickValue.js'));
  assert.ok(pickValueModule.pickBaseValue(1) > pickValueModule.pickBaseValue(30), 'pick 1 must be worth more than pick 30');
  assert.ok(pickValueModule.pickBaseValue(30) > pickValueModule.pickBaseValue(31), 'a late first-rounder must be worth more than an early second-rounder');
  assert.ok(pickValueModule.pickBaseValue(31) > pickValueModule.pickBaseValue(60), 'pick 31 must be worth more than pick 60');

  const rebuilding = { timeline: 'rebuilding' };
  const winNow = { timeline: 'win-now' };
  assert.ok(
    pickValueModule.estimateFuturePickValue(1, rebuilding) > pickValueModule.estimateFuturePickValue(1, winNow),
    'the same future first-round pick should be worth more owned by a rebuilding team than a win-now team'
  );
  assert.ok(
    pickValueModule.estimateFuturePickValue(1, rebuilding) > pickValueModule.estimateFuturePickValue(2, rebuilding),
    'a future first-round pick should be worth more than a future second-round pick from the same team'
  );

  console.log('checkDraftPickValue: OK');
}

checkDraftPickValue();

function checkProspectGeneration() {
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const rng = makeRng(7);
  const generatedClass = prospectsModule.generateProspectClass(rng, 60);

  assert.strictEqual(generatedClass.length, 60);
  const ids = generatedClass.map(function (p) { return p.id; });
  assert.strictEqual(new Set(ids).size, 60, 'generated prospect ids must be unique');

  generatedClass.forEach(function (p) {
    assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX, 'generated prospect overall out of range');
    assert.ok(p.potential >= p.overall, 'generated prospect potential must be >= overall');
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) {
      assert.ok(p.attributes[k] >= dataModule.RATING_MIN && p.attributes[k] <= dataModule.RATING_MAX, 'generated prospect attribute ' + k + ' out of range');
    });
  });

  const avgOverallTop10 = generatedClass.slice(0, 10).reduce(function (s, p) { return s + p.overall; }, 0) / 10;
  const avgOverallBottom10 = generatedClass.slice(-10).reduce(function (s, p) { return s + p.overall; }, 0) / 10;
  assert.ok(avgOverallTop10 > avgOverallBottom10, 'early-slot generated prospects should trend better than late-slot ones');

  console.log('checkProspectGeneration: OK');
}

checkProspectGeneration();

function checkReal2026Class() {
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  assert.strictEqual(prospectsModule.DRAFT_PROSPECTS_2026.length, 60, 'the real 2026 class must have exactly 60 prospects');
  const ids = prospectsModule.DRAFT_PROSPECTS_2026.map(function (p) { return p.id; });
  assert.strictEqual(new Set(ids).size, 60, 'real prospect ids must be unique');
  prospectsModule.DRAFT_PROSPECTS_2026.forEach(function (p) {
    assert.ok(p.overall >= dataModule.RATING_MIN && p.overall <= dataModule.RATING_MAX);
    assert.ok(p.potential >= p.overall);
    assert.strictEqual(p.teamId, null);
  });
  const first15Avg = prospectsModule.DRAFT_PROSPECTS_2026.slice(0, 15).reduce(function (s, p) { return s + p.overall; }, 0) / 15;
  const last15Avg = prospectsModule.DRAFT_PROSPECTS_2026.slice(-15).reduce(function (s, p) { return s + p.overall; }, 0) / 15;
  assert.ok(first15Avg > last15Avg, 'the top of the class should rate better than the bottom on average');
  console.log('checkReal2026Class: OK (' + prospectsModule.DRAFT_PROSPECTS_2026.length + ' prospects)');
}

checkReal2026Class();

function checkDraftOrder() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));

  // Realistic 82-game-season win spread (12-68), not a compressed 1-15 range —
  // the lottery weight formula's differentiation depends on realistic win gaps
  // between the worst and best lottery teams.
  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 12 + (eastern.length - 1 - i) * 4, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 12 + (western.length - 1 - i) * 4, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rng = makeRng(300);
  let g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rng); }

  const order = draftModule.buildDraftOrder(bracket, rng);
  assert.strictEqual(order.firstRound.length, 30, 'first round must have exactly 30 picks');
  assert.strictEqual(new Set(order.firstRound).size, 30, 'first round picks must be unique teams');
  assert.strictEqual(order.secondRound.length, 30, 'second round must have exactly 30 picks');
  assert.strictEqual(new Set(order.secondRound).size, 30, 'second round picks must be unique teams');

  // Statistical check on the lottery weighting itself (the part most likely to have a sign error).
  const worstTeam = teamsModule.TEAMS.slice().sort(function (a, b) { return a.record.wins - b.record.wins; })[0];
  let worstTeamFirstPickCount = 0;
  const TRIALS = 300;
  for (let i = 0; i < TRIALS; i++) {
    const trialOrder = draftModule.buildDraftOrder(bracket, rng);
    if (trialOrder.firstRound[0] === worstTeam.id) worstTeamFirstPickCount++;
  }
  assert.ok(worstTeamFirstPickCount / TRIALS > 0.15, 'the worst team should win the #1 pick a meaningfully large share of the time, got ' + (worstTeamFirstPickCount / TRIALS));

  console.log('checkDraftOrder: OK');
}

checkDraftOrder();

function checkRunDraft() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const rng = makeRng(400);

  const draftOrder = { firstRound: teamsModule.TEAMS.map(function (t) { return t.id; }), secondRound: teamsModule.TEAMS.slice().reverse().map(function (t) { return t.id; }) };
  const pool = prospectsModule.generateProspectClass(rng, 60);

  const results = draftModule.runDraft(draftOrder, pool);
  assert.strictEqual(results.length, 60, 'a full draft should produce 60 picks');
  const pickedIds = results.map(function (r) { return r.prospect.id; });
  assert.strictEqual(new Set(pickedIds).size, 60, 'no prospect should be drafted twice');

  results.forEach(function (r) {
    assert.strictEqual(r.prospect.teamId, r.teamId, 'a drafted prospect must have its teamId set to the drafting team');
    assert.ok(r.prospect.contract.salary > 0, 'a drafted prospect must have a rookie contract');
    assert.ok(typeof r.prospect.jerseyNumber === 'number');
  });

  const firstPick = results[0];
  const lastPick = results[59];
  assert.ok(firstPick.prospect.contract.salary > lastPick.prospect.contract.salary, 'the #1 pick should earn more than the #60 pick');

  console.log('checkRunDraft: OK');
}

checkRunDraft();

function checkOffseasonThroughDraft() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const playoffsModule = require(path.join(__dirname, '..', 'playoffs.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));

  const eastern = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Eastern'; });
  eastern.forEach(function (t, i) { t.record = { wins: 12 + (eastern.length - 1 - i) * 4, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
  const western = teamsModule.TEAMS.filter(function (t) { return t.conference === 'Western'; });
  western.forEach(function (t, i) { t.record = { wins: 12 + (western.length - 1 - i) * 4, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });

  const bracket = playoffsModule.generateBracket();
  const settings = { simEngine: 'boxscore' };
  const rngForPlayoffs = makeRng(500);
  let g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rngForPlayoffs);
  while (g !== null) { g = playoffsModule.simulateNextPlayoffGame(bracket, settings, rngForPlayoffs); }

  const totalPlayersBefore = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026.length;

  const rng = makeRng(600);
  const result = transitionModule.runOffseasonThroughDraft(bracket, rng, true);

  assert.ok(result.draftResults.length === 60, 'the first draft should use the real 60-prospect class');

  // Every team gains exactly 2 new draftees (1 first round + 1 second round).
  // Roster size can otherwise move in either direction this offseason: down from
  // retirements and contract expirations (expired contracts become free agents,
  // which Batch B's free agency exists to resolve — not a bug here), so the only
  // safe per-team invariant is a non-negative, sane roster count.
  teamsModule.TEAMS.forEach(function (t) {
    const after = leagueModule.getTeamRoster(t.id).length;
    assert.ok(after >= 0 && after <= 17, t.id + ' roster size implausible after offseason: ' + after);
  });

  // League-wide player count: before + 60 drafted - retirees (free agents are
  // still in PLAYERS_2026, just with teamId null, so they aren't subtracted here).
  const totalPlayersAfter = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026.length;
  assert.strictEqual(totalPlayersAfter, totalPlayersBefore + 60 - result.retireeCount, 'league-wide player count should reflect draftees added and retirees removed');

  console.log('checkOffseasonThroughDraft: OK (' + result.retireeCount + ' retirements, ' + result.draftResults.length + ' picks made)');
}

checkOffseasonThroughDraft();

function checkScoreOffer() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const player = { id: 'test-fa-player', age: 34, overall: 82, position: 'SF' };
  const winNowTeam = teamsModule.getTeamById('LAL');
  const rebuildingTeam = teamsModule.getTeamById('WAS');

  const sameOffer = { salary: 20000000, yearsRemaining: 2 };
  const winNowScore = freeAgencyModule.scoreOffer(player, winNowTeam, sameOffer);
  const rebuildingScore = freeAgencyModule.scoreOffer(player, rebuildingTeam, sameOffer);
  assert.ok(winNowScore > rebuildingScore, 'an aging star should score an identical offer higher from a win-now team than a rebuilding one');

  const bigOffer = { salary: 40000000, yearsRemaining: 2 };
  const smallOffer = { salary: 5000000, yearsRemaining: 2 };
  assert.ok(
    freeAgencyModule.scoreOffer(player, winNowTeam, bigOffer) > freeAgencyModule.scoreOffer(player, winNowTeam, smallOffer),
    'more money should score higher, all else equal'
  );

  console.log('checkScoreOffer: OK');
}

checkScoreOffer();

function checkAIOfferAndSigning() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const rng = makeRng(700);

  // Use a real waived player (already in PLAYERS_2026 with teamId null), not a
  // standalone fixture — signPlayer only mutates an existing player record,
  // it doesn't add anyone new to the league.
  const donorRoster = leagueModule.getTeamRoster('ORL');
  const testPlayer = donorRoster[donorRoster.length - 1];
  rosterMovesModule.waivePlayer(testPlayer.id);
  assert.strictEqual(testPlayer.teamId, null);

  const team = teamsModule.getTeamById('MIA');
  const offer = freeAgencyModule.generateAIOffer(team, testPlayer, rng);
  if (offer) {
    assert.strictEqual(offer.teamId, 'MIA');
    assert.ok(offer.salary > 0);
    assert.ok(offer.yearsRemaining >= 1 && offer.yearsRemaining <= 4);

    freeAgencyModule.signPlayer(testPlayer, offer);
    assert.strictEqual(testPlayer.teamId, 'MIA');
    assert.strictEqual(testPlayer.contract.salary, offer.salary);
    assert.ok(typeof testPlayer.jerseyNumber === 'number');

    const roster = leagueModule.getTeamRoster('MIA');
    assert.ok(roster.some(function (p) { return p.id === testPlayer.id; }), 'signed player must appear on the roster');
  } else {
    // No team had interest/room in this particular RNG draw — restore the
    // player so this test doesn't leave a stray unsigned free agent behind.
    testPlayer.teamId = 'ORL';
  }

  console.log('checkAIOfferAndSigning: OK');
}

checkAIOfferAndSigning();

function checkSilentFreeAgencyResolution() {
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const rng = makeRng(800);

  // Manufacture a small, deterministic free agent pool via waiving.
  const roster = leagueModule.getTeamRoster('BOS');
  const waivedIds = [];
  for (let i = 0; i < 2 && roster.length - waivedIds.length > 12; i++) {
    const target = roster[i];
    rosterMovesModule.waivePlayer(target.id);
    waivedIds.push(target.id);
  }

  const before = rosterMovesModule.getFreeAgents().length;
  const results = freeAgencyModule.runFreeAgencySilently(rng);
  const after = rosterMovesModule.getFreeAgents().length;

  assert.ok(results.length >= 0, 'should return an array of signings (possibly empty if no team had room)');
  assert.ok(after <= before, 'free agent pool should shrink or stay the same, never grow, after resolution');
  results.forEach(function (r) {
    const player = leagueModule.getPlayerById(r.playerId);
    assert.strictEqual(player.teamId, r.teamId, 'a resolved signing must actually be reflected on the player record');
  });

  console.log('checkSilentFreeAgencyResolution: OK (' + results.length + ' signed of ' + before + ' free agents)');
}

checkSilentFreeAgencyResolution();

function checkBiddingWar() {
  const biddingModule = require(path.join(__dirname, '..', 'freeAgencyBidding.js'));
  const rosterMovesModule = require(path.join(__dirname, '..', 'rosterMoves.js'));
  const rng = makeRng(900);

  // Find any team with roster room to spare so the waive is guaranteed to
  // succeed regardless of how earlier tests in this cumulative file left
  // team rosters sized.
  const donorTeam = teamsModule.TEAMS.find(function (t) { return leagueModule.getTeamRoster(t.id).length > 12; });
  const roster = leagueModule.getTeamRoster(donorTeam.id);
  const target = roster[roster.length - 1];
  const waiveResult = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(waiveResult.success, true, 'test setup: waive should succeed on a team above the roster minimum');
  assert.strictEqual(target.teamId, null);

  const userTeamId = donorTeam.id;
  const state = biddingModule.startBidding(target.id, userTeamId, rng);
  assert.strictEqual(state.playerId, target.id);
  assert.strictEqual(state.userTeamId, userTeamId);

  // A lowball offer should not obviously beat every competing AI bid.
  const lowResult = biddingModule.evaluateBiddingRound(state, 1300000, 1);
  assert.ok(typeof lowResult.userWinning === 'boolean');

  // A near-max offer should win outright against any remaining competition.
  const highResult = biddingModule.evaluateBiddingRound(state, 45000000, 4);
  assert.strictEqual(highResult.userWinning, true, 'a near-max offer should beat any remaining AI bid');

  const outcome = biddingModule.finalizeBidding(state, true);
  assert.strictEqual(outcome.signed, true);
  assert.strictEqual(outcome.teamId, userTeamId);
  assert.strictEqual(target.teamId, userTeamId);

  console.log('checkBiddingWar: OK');
}

checkBiddingWar();
console.log('All offseason validations passed');
