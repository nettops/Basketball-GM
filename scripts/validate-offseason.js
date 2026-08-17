const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));

function checkProgression() {
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const rng = makeRng(1);

  // `overall` is derived from the attributes (ratings.js), so these synthetic
  // players get the real getter installed rather than a plain number field —
  // otherwise `overall` is a frozen literal, progressPlayer (which now only
  // moves attributes) can never change it, and every trial measures zero.
  // Resetting between trials means restoring the ATTRIBUTES; assigning to
  // overall throws, by design.
  const ratingsModule = require(path.join(__dirname, '..', 'ratings.js'));
  function synth(fields, attrValue) {
    const pl = Object.assign({ attributes: {} }, fields);
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) { pl.attributes[k] = attrValue; });
    return ratingsModule.defineOverall(pl);
  }
  function snapshot(pl) {
    const out = {};
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) { out[k] = pl.attributes[k]; });
    return out;
  }
  function restore(pl, snap) {
    dataModule.ATTRIBUTE_KEYS.forEach(function (k) { pl.attributes[k] = snap[k]; });
  }

  // A young high-potential player should trend upward on average over many rolls.
  const youngProspect = synth({ age: 20, yearsPro: 2, potential: 88 }, 65);
  const youngSnap = snapshot(youngProspect);
  let totalChange = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const before = youngProspect.overall;
    progressionModule.progressPlayer(youngProspect, rng);
    totalChange += youngProspect.overall - before;
    restore(youngProspect, youngSnap); // reset for an independent trial
    youngProspect.age = 20;
    youngProspect.yearsPro = 2;
    youngProspect.potential = 88;
  }
  assert.ok(totalChange / TRIALS > 0, 'a young player far below potential should trend upward on average');

  // A declining veteran should trend downward on average.
  const veteran = synth({ age: 35, yearsPro: 13, potential: 78 }, 78);
  const vetSnap = snapshot(veteran);
  let veteranChange = 0;
  for (let i = 0; i < TRIALS; i++) {
    const before = veteran.overall;
    progressionModule.progressPlayer(veteran, rng);
    veteranChange += veteran.overall - before;
    restore(veteran, vetSnap);
    veteran.age = 35;
    veteran.yearsPro = 13;
    veteran.potential = 78;
  }
  assert.ok(veteranChange / TRIALS < 0, 'a 35-year-old should trend downward on average');

  // Invariant and range checks after a single real progression call.
  const p = synth({ age: 24, yearsPro: 3, potential: 90 }, 90);
  progressionModule.progressPlayer(p, rng);
  assert.strictEqual(p.yearsPro, 4, 'yearsPro must increment alongside age each offseason');
  assert.ok(p.potential >= p.rawOverall, 'potential must stay >= rawOverall after progression');
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
    assert.ok(p.potential >= p.rawOverall, 'generated prospect potential must be >= rawOverall');
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
    assert.ok(p.potential >= p.rawOverall);
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

  // The weighting must never reward winning. `(30 - wins)^2` used to invert
  // above 30 wins and hit exactly 0 at 30, so a 45-win lottery team outweighed
  // a 35-win one and a 30-win team could not win the lottery at all.
  let previousWeight = Infinity;
  for (let wins = 0; wins <= 82; wins++) {
    const weight = draftModule.lotteryWeight({ record: { wins: wins, losses: 82 - wins } });
    assert.ok(weight > 0, 'every lottery team must have a non-zero chance (wins=' + wins + ')');
    assert.ok(weight <= previousWeight, 'lottery weight must never increase with wins (wins=' + wins + ')');
    previousWeight = weight;
  }

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
  const prospectsModule = require(path.join(__dirname, '..', 'draftProspects.js'));
  const result = transitionModule.runOffseasonThroughDraft(bracket, rng, prospectsModule.DRAFT_PROSPECTS_2026);

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

// The duplicate guard on the one door drafted prospects come through. The case
// that matters is the SECOND one: a save round-trip hands back the same
// prospect as several distinct objects sharing an id, so the identity check
// this replaced (indexOf) let a twin straight into the pool. A player at two
// indexes is paid twice against the cap and rosterable from two places — it
// reached players once already, as "players duplicating on rosters, salary cap
// integer becomes weird".
//
// The two warnings this prints are the guard being loud on purpose, not a
// failure — a refusal means some pool was drafted twice, which is worth saying.
function checkAProspectCannotJoinTheLeagueTwice() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));
  const PLAYERS = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026;
  const before = PLAYERS.length;

  const rookie = { id: 'prospect-validator-twice-1', name: 'Twice Drafted', teamId: null };
  assert.strictEqual(draftModule.addDraftedProspect(rookie), true, 'a prospect new to the league joins it');
  assert.strictEqual(PLAYERS.length, before + 1, 'and is in the pool exactly once');

  assert.strictEqual(draftModule.addDraftedProspect(rookie), false, 'the same object is refused a second time');

  // A save round-trip's twin: same id, different object.
  const twin = { id: rookie.id, name: rookie.name, teamId: null };
  assert.notStrictEqual(twin, rookie, 'the twin really is a separate object');
  assert.strictEqual(draftModule.addDraftedProspect(twin), false, 'and so is a twin carrying the same id');

  assert.strictEqual(PLAYERS.length, before + 1, 'neither refusal changed the pool');

  const matches = PLAYERS.filter(function (p) { return p.id === rookie.id; });
  assert.strictEqual(matches.length, 1, 'exactly one player holds that id');
  PLAYERS.splice(PLAYERS.indexOf(rookie), 1);
  console.log('checkAProspectCannotJoinTheLeagueTwice: OK');
}
checkAProspectCannotJoinTheLeagueTwice();

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
  // The ceiling sweep (enforceRosterCeilings, freeAgency.js) legitimately
  // GROWS the pool when teams enter the market over 15 — the draft two
  // checks up hands every team two rookies, so several are. "Never grows"
  // was true only while nothing enforced the ceiling; the honest invariant
  // is: growth is bounded by exactly the over-ceiling surplus, and no team
  // is left over the ceiling afterwards.
  const surplus = teamsModule.TEAMS.reduce(function (s, t) {
    return s + Math.max(0, leagueModule.getTeamRoster(t.id).length - 15);
  }, 0);
  const results = freeAgencyModule.runFreeAgencySilently(rng);
  const after = rosterMovesModule.getFreeAgents().length;

  assert.ok(results.length >= 0, 'should return an array of signings (possibly empty if no team had room)');
  assert.ok(after <= before + surplus,
    'free agent pool may grow only by the over-ceiling surplus (' + surplus + '), got ' +
    before + ' -> ' + after);
  teamsModule.TEAMS.forEach(function (t) {
    assert.ok(leagueModule.getTeamRoster(t.id).length <= 15,
      t.id + ' must not be over the 15-man ceiling after the silent market');
  });
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
  const freeAgencyModule = require(path.join(__dirname, '..', 'freeAgency.js'));
  const rng = makeRng(900);

  // Roster room to spare so the waive is guaranteed to succeed regardless of
  // how earlier tests in this cumulative file left team rosters sized — and
  // now cap space too, since the bidder must be able to make a real offer.
  const donorTeam = teamsModule.TEAMS.filter(function (t) { return leagueModule.getTeamRoster(t.id).length > 12; })
    .sort(function (a, b) { return leagueModule.getTeamPayroll(a.id) - leagueModule.getTeamPayroll(b.id); })[0];
  const roster = leagueModule.getTeamRoster(donorTeam.id);
  const target = roster[roster.length - 1];
  const waiveResult = rosterMovesModule.waivePlayer(target.id);
  assert.strictEqual(waiveResult.success, true, 'test setup: waive should succeed on a team above the roster minimum');
  assert.strictEqual(target.teamId, null);

  const userTeamId = donorTeam.id;
  const state = biddingModule.startBidding(target.id, userTeamId, rng);
  assert.strictEqual(state.playerId, target.id);
  assert.strictEqual(state.userTeamId, userTeamId);

  // "Near-max" now means near the maximum this team may legally offer. The
  // user's bid is subject to the same cap rule as every AI team's, so a flat
  // $45,000,000 was only ever a legal offer by accident — and once it stopped
  // being one, this test would have gone red for a reason that has nothing to
  // do with bidding wars. Read the ceiling off the model rather than guessing.
  const limit = freeAgencyModule.offerLimit(teamsModule.getTeamById(userTeamId));
  assert.ok(!limit.reason, 'test setup: the donor team must be able to sign at all (' + limit.reason + ')');
  const bigBid = Math.min(45000000, limit.max);
  assert.ok(bigBid > limit.min, 'test setup: the donor team needs real cap space, has $' + limit.max);

  // A lowball offer should not obviously beat every competing AI bid.
  const lowResult = biddingModule.evaluateBiddingRound(state, limit.min + 100000, 1);
  assert.strictEqual(lowResult.offerAccepted, true, 'a minimum-salary offer should be legal');
  assert.ok(typeof lowResult.userWinning === 'boolean');

  // A near-max offer should win outright against any remaining competition.
  const highResult = biddingModule.evaluateBiddingRound(state, bigBid, 4);
  assert.strictEqual(highResult.offerAccepted, true,
    'the near-max offer must be legal, else userWinning below proves nothing: ' + highResult.rejectedReason);
  assert.strictEqual(highResult.userWinning, true, 'a near-max offer should beat any remaining AI bid');

  const outcome = biddingModule.finalizeBidding(state, true);
  assert.strictEqual(outcome.signed, true);
  assert.strictEqual(outcome.teamId, userTeamId);
  assert.strictEqual(target.teamId, userTeamId);

  console.log('checkBiddingWar: OK');
}

checkBiddingWar();

function checkDraftOrderRespectsTradedPicks() {
  const draftModule = require(path.join(__dirname, '..', 'draft.js'));

  // Give SAS's next first-round pick to LAL, then confirm whichever slot the
  // draft order would have given SAS instead goes to LAL.
  const sasPick = teamsModule.getTeamById('SAS').draftPicks.find(function (p) { return p.round === 1; });
  const originalOwner = sasPick.currentOwnerId;
  sasPick.currentOwnerId = 'LAL';

  const rawOrder = ['SAS', 'BOS', 'MIA']; // a fake raw order; only SAS's slot should remap
  const remapped = draftModule.remapForPickOwnership(rawOrder, 1);
  assert.deepStrictEqual(remapped, ['LAL', 'BOS', 'MIA'], 'SAS\'s slot should now belong to LAL, others unchanged');

  sasPick.currentOwnerId = originalOwner; // restore

  console.log('checkDraftOrderRespectsTradedPicks: OK');
}

checkDraftOrderRespectsTradedPicks();

function checkGenerateNewSeason() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const team = teamsModule.getTeamById('BOS');
  team.record = { wins: 55, losses: 27, pointsFor: 9000, pointsAgainst: 8700 };
  const player = leagueModule.getTeamRoster('BOS')[0];
  player.seasonStats = { gamesPlayed: 82, points: 2000 };

  const rng = makeRng(1000);
  const result = transitionModule.generateNewSeason(rng);

  assert.strictEqual(result.games.length, 1230, 'a new season should have exactly 1230 games');
  // Sized off the league, not a hardcoded 60: two rounds of one pick per team
  // plus a small cushion, so an expansion team can't outrun the prospect pool.
  const expectedClassSize = teamsModule.TEAMS.length * 2 + 4;
  assert.strictEqual(result.nextDraftClass.length, expectedClassSize,
    'generateNewSeason should produce a draft class sized for the current league (' + expectedClassSize + ' prospects)');
  assert.ok(result.nextDraftClass.length >= teamsModule.TEAMS.length * 2,
    'the draft class must cover every pick in both rounds');
  assert.strictEqual(team.record.wins, 0, 'records should reset for the new season');
  assert.strictEqual(player.seasonStats, undefined, 'season stats should clear for the new season');
  assert.strictEqual(teamsModule.getTeamById('BOS').draftPicks.length, 2, 'every team should have fresh draft picks after generating a new season');
  assert.strictEqual(teamsModule.getTeamById('BOS').draftPicks[0].currentOwnerId, 'BOS', 'a fresh pick is owned by its original team until traded again');

  console.log('checkGenerateNewSeason: OK');
}

checkGenerateNewSeason();

// runOffseasonPreDraft used to scope progression and retirement to players with
// a teamId. progressPlayer is what increments age/yearsPro, so every player who
// reached free agency was frozen at his current age forever and could never
// roll retirement — the pool grew without bound and never turned over.
function checkFreeAgentsAgeAndRetire() {
  const transitionModule = require(path.join(__dirname, '..', 'seasonTransition.js'));
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));

  // Park a handful of players in free agency, including one already old enough
  // for the retirement roll to be able to reach him.
  const sample = playersModule.PLAYERS_2026.slice(0, 5);
  sample.forEach(function (p) { p.teamId = null; });
  const tracked = sample[0];
  tracked.age = 30;
  const startingAge = tracked.age;
  const startingYearsPro = tracked.yearsPro;

  transitionModule.runOffseasonPreDraft(makeRng(9001), 2030);

  assert.strictEqual(tracked.age, startingAge + 1, 'a free agent must age at the offseason like everyone else');
  assert.strictEqual(tracked.yearsPro, startingYearsPro + 1, 'a free agent must accrue yearsPro at the offseason');

  // Over enough offseasons an aging free-agent pool must actually shrink,
  // rather than accumulating un-retirable players indefinitely.
  const stuck = playersModule.PLAYERS_2026.filter(function (p) { return !p.teamId; });
  stuck.forEach(function (p) { p.age = 38; });
  const before = stuck.length;
  assert.ok(before > 0, 'test setup should leave some free agents in the pool');
  for (let i = 0; i < 6; i++) transitionModule.runOffseasonPreDraft(makeRng(700 + i), 2031 + i);
  const after = playersModule.PLAYERS_2026.filter(function (p) { return !p.teamId; })
    .filter(function (p) { return stuck.indexOf(p) !== -1; }).length;
  assert.ok(after < before, 'aging free agents must eventually retire out of the pool, got ' + after + ' of ' + before);

  console.log('checkFreeAgentsAgeAndRetire: OK');
}

checkFreeAgentsAgeAndRetire();

console.log('All offseason validations passed');
