// Restricted free agency: a rival puts a price on your young player and you
// have to answer it.
//
// The mechanics are asserted here; whether the DECISION is real — whether the
// match rate sits somewhere between always and never — is measured by
// scripts/probe-restrictedFA.js, because no assertion can tell a live choice
// from a foregone one.
const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
const traits = require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const fa = require(path.join(__dirname, '..', 'freeAgency.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

function checkWhoIsRestricted() {
  assert.strictEqual(fa.isRestrictedFreeAgent({ teamId: 'BOS', yearsPro: 0 }), true, 'a rookie is restricted');
  assert.strictEqual(fa.isRestrictedFreeAgent({ teamId: 'BOS', yearsPro: fa.RFA_MAX_YEARS_PRO }), true,
    'the boundary year is restricted');
  assert.strictEqual(fa.isRestrictedFreeAgent({ teamId: 'BOS', yearsPro: fa.RFA_MAX_YEARS_PRO + 1 }), false,
    'one year past the rookie deal is unrestricted');
  assert.strictEqual(fa.isRestrictedFreeAgent({ teamId: null, yearsPro: 1 }), false,
    'a player on nobody\'s roster has no incumbent to restrict him');
  assert.strictEqual(fa.isRestrictedFreeAgent(null), false, 'a missing player is not restricted, and not a crash');
  // yearsPro is absent on some generated players; absent must mean rookie
  // rather than NaN-compared into false.
  assert.strictEqual(fa.isRestrictedFreeAgent({ teamId: 'BOS' }), true,
    'a player with no service recorded is treated as a rookie');
  console.log('checkWhoIsRestricted: OK');
}

// The premium is the whole feature. A sheet at fair value would be matched
// without a thought and the decision would be theatre.
function checkASheetCostsMoreThanFairValue() {
  let sheets = 0;
  PLAYERS_2026.filter(function (p) { return p.teamId && fa.isRestrictedFreeAgent(p); })
    .slice(0, 25).forEach(function (player) {
      TEAMS.slice(0, 6).forEach(function (t) {
        if (t.id === player.teamId) return;
        // The SAME seed for both, so the only difference between the two
        // numbers is the premium rather than a different roll of the dice.
        const sheet = fa.generateOfferSheet(t, player, makeRng(99));
        if (!sheet) return;
        const plain = fa.generateAIOffer(t, player, makeRng(99));
        sheets += 1;
        assert.ok(plain, 'a club that will write a sheet would also make a plain offer');
        assert.ok(sheet.salary > plain.salary,
          'a sheet must beat that club\'s own market offer or it carries no threat: ' +
          sheet.salary + ' vs ' + plain.salary);
        assert.strictEqual(sheet.offerSheet, true, 'a sheet must be marked so the UI can tell them apart');
        assert.ok(sheet.yearsRemaining >= 1, 'a sheet must be a real contract');
      });
    });
  assert.ok(sheets > 0, 'the league should produce offer sheets at all');
  console.log('checkASheetCostsMoreThanFairValue: OK (' + sheets + ' sheets, all above market)');
}

// The decision itself, as pure numbers — no league, no offseason.
function checkMatchDecisionRespondsToPrice() {
  const fair = 10000000;
  // The same player, at three prices.
  const cheap = fa.matchDecision(80, fair, fair);
  const steep = fa.matchDecision(80, fair * 1.5, fair);
  assert.ok(cheap.matched, 'a good player at fair value is kept');
  assert.ok(steep.bar > cheap.bar, 'a bigger overpay must raise the bar to keep him');
  assert.ok(!steep.matched, 'the same player at 50% over should get away');

  // And a genuinely good player is kept even at a steep price — otherwise the
  // mechanism is just a tax on developing anybody.
  assert.ok(fa.matchDecision(140, fair * 1.5, fair).matched,
    'a star must still be matched at a steep price');

  // A worthless player is let go at any price.
  assert.ok(!fa.matchDecision(10, fair, fair).matched, 'a fringe player is not worth matching');

  // Degenerate inputs must not produce NaN comparisons.
  const zero = fa.matchDecision(80, 5000000, 0);
  assert.ok(!Number.isNaN(zero.overpay) && !Number.isNaN(zero.bar),
    'a zero fair value must not make the bar NaN');
  console.log('checkMatchDecisionRespondsToPrice: OK (bar ' + cheap.bar.toFixed(1) +
    ' at fair, ' + steep.bar.toFixed(1) + ' at 1.5x)');
}

// Matching deliberately does NOT go through checkOffer: a team may exceed the
// cap for its own player and nobody else, which is the rule the re-signing
// window already runs on. Without it only bad teams could keep anyone.
function checkMatchingMayExceedTheCap() {
  const team = TEAMS[0];
  const player = league.getTeamRoster(team.id).filter(fa.isRestrictedFreeAgent)[0] ||
    league.getTeamRoster(team.id)[0];
  const huge = { teamId: 'NYK', salary: 900000000, yearsRemaining: 3 };
  const verdict = fa.evaluateMatch(team, player, huge);
  assert.strictEqual(typeof verdict.matched, 'boolean',
    'an absurd sheet still produces a decision rather than throwing');
  assert.ok(verdict.overpay > 1, 'an absurd sheet is a big overpay');
  assert.ok(!verdict.matched, 'nobody matches nine hundred million');

  assert.deepStrictEqual(fa.evaluateMatch(null, player, huge).matched, false, 'a missing team declines');
  assert.deepStrictEqual(fa.evaluateMatch(team, player, null).matched, false, 'a missing sheet declines');
  console.log('checkMatchingMayExceedTheCap: OK');
}

// An unmatched sheet is a SIGNING, not a release. If the player fell into the
// open market instead, the rest of the league would get a second bite at him
// and ignoring the panel would beat declining on it.
function checkAnUnansweredSheetSignsHimAway() {
  const team = TEAMS[3];
  const player = league.getTeamRoster(team.id)[0];
  const rival = TEAMS[7];
  player.resignRights = {
    teamId: team.id, salary: 5000000, yearsRemaining: 2,
    offerSheet: { teamId: rival.id, salary: 20000000, yearsRemaining: 4 }
  };
  fa.releaseUnexercisedResignRights(team.id);
  assert.strictEqual(player.teamId, rival.id, 'he joins the club that wrote the sheet');
  assert.strictEqual(player.contract.salary, 20000000, 'on the sheet\'s terms, not his old ones');
  assert.strictEqual(player.contract.yearsRemaining, 4, 'and the sheet\'s length');
  assert.strictEqual(player.resignRights, undefined, 'the rights are spent');

  // The unrestricted path through the same function is untouched: no sheet
  // means he reaches the open market exactly as before.
  const other = league.getTeamRoster(team.id)[0];
  other.resignRights = { teamId: team.id, salary: 5000000, yearsRemaining: 2 };
  fa.releaseUnexercisedResignRights(team.id);
  assert.strictEqual(other.teamId, null, 'without a sheet he still walks to free agency');
  console.log('checkAnUnansweredSheetSignsHimAway: OK');
}

// Automation must resolve sheets the same way a played save would, or a
// spectator league quietly leaks exactly the players the feature protects.
function checkAutomationAnswersSheets() {
  const team = TEAMS[4];
  const roster = league.getTeamRoster(team.id);
  const keeper = roster[0];
  const rival = TEAMS[9];
  // A trivially cheap sheet on a good player: any sane GM matches.
  keeper.resignRights = {
    teamId: team.id, salary: 4000000, yearsRemaining: 2,
    offerSheet: { teamId: rival.id, salary: 4000000, yearsRemaining: 2 }
  };
  const before = keeper.teamId;
  fa.autoExerciseResignRights(team.id, makeRng(5));
  assert.strictEqual(keeper.teamId, before, 'automation should match a cheap sheet on a good player');
  assert.strictEqual(keeper.resignRights, undefined, 'and spend the rights either way');
  console.log('checkAutomationAnswersSheets: OK');
}

// --- Raiding ----------------------------------------------------------------
//
// The half that needed a flow change. runResigningWindow used to settle every
// other club's restricted player on the spot, so by the time the free agency
// screen was drawn there was nothing left to raid. They are parked now, and
// resolveLeagueRestrictedFA answers for all of them when the market opens.

// Snapshotted so each fixture starts from the real league rather than from
// whatever the previous check left behind — without this the contracts
// decrement cumulatively and by the fourth call half the league is years into
// the past.
const LEAGUE_SNAPSHOT = PLAYERS_2026.map(function (p) {
  return { p: p, teamId: p.teamId, salary: p.contract.salary, years: p.contract.yearsRemaining };
});

function restoreLeague() {
  LEAGUE_SNAPSHOT.forEach(function (s) {
    s.p.teamId = s.teamId;
    s.p.contract.salary = s.salary;
    s.p.contract.yearsRemaining = s.years;
    delete s.p.resignRights;
  });
}

// Mirrors seasonTransition.js's decrementContracts exactly: age every deal,
// run the window, then release anyone left expired with nothing holding him.
// That last step is not decoration — it is what makes "nobody is stranded" a
// meaningful assertion rather than one the fixture fails by construction.
function parkedFixture(seed) {
  restoreLeague();
  const rng = makeRng(seed);
  PLAYERS_2026.forEach(function (p) { if (p.teamId) p.contract.yearsRemaining -= 1; });
  const expiring = PLAYERS_2026.filter(function (p) { return p.teamId && p.contract.yearsRemaining <= 0; });
  const result = fa.runResigningWindow(expiring, rng, 'BOS');
  PLAYERS_2026.forEach(function (p) {
    if (p.teamId && p.contract.yearsRemaining <= 0 && !p.resignRights) p.teamId = null;
  });
  return result;
}

function checkOtherClubsRestrictedPlayersAreRaidable() {
  const result = parkedFixture(31);
  assert.ok(result.openRestricted.length > 0,
    'other clubs\' restricted players must be left open, or there is nothing to raid');
  const open = fa.openRestrictedFreeAgents('BOS');
  assert.ok(open.length > 0, 'and they must be findable from outside');
  open.forEach(function (p) {
    assert.notStrictEqual(p.teamId, 'BOS', 'the raid list must never include your own players');
    assert.ok(p.resignRights.offerSheet, 'each carries the sheet the incumbent has to beat');
    assert.ok(p.teamId, 'and stays on his roster while parked, holding the spot');
  });
  console.log('checkOtherClubsRestrictedPlayersAreRaidable: OK (' + open.length + ' raidable)');
}

function checkWritingASheetTakesTheBestOffer() {
  parkedFixture(77);
  const open = fa.openRestrictedFreeAgents('BOS');
  const target = open[0];
  const bos = TEAMS.filter(function (t) { return t.id === 'BOS'; })[0];
  const standing = target.resignRights.offerSheet;

  // Too small to tempt him: the sheet he already holds should survive.
  const lowball = fa.writeOfferSheet(target, bos, 1200000, 1);
  if (!lowball.ok) {
    assert.ok(/prefers|cap|minimum|Roster/.test(lowball.reason), 'a refusal must explain itself: ' + lowball.reason);
  }
  assert.strictEqual(target.resignRights.offerSheet.teamId, standing.teamId,
    'a lowball must not displace a better standing sheet');

  // Illegal offers are refused with a reason rather than silently applied.
  const silly = fa.writeOfferSheet(target, bos, -5, 3);
  assert.strictEqual(silly.ok, false, 'a negative salary is not an offer');
  assert.ok(silly.reason, 'and says why');

  const tooLong = fa.writeOfferSheet(target, bos, 5000000, 99);
  assert.strictEqual(tooLong.ok, false, 'a 99-year sheet is not an offer');

  // Your own player is the Match flow, not a raid.
  const mine = PLAYERS_2026.filter(function (p) { return p.teamId === 'BOS' && p.resignRights; })[0];
  if (mine) {
    assert.strictEqual(fa.writeOfferSheet(mine, bos, 5000000, 2).ok, false,
      'you cannot write an offer sheet on your own player');
  }
  console.log('checkWritingASheetTakesTheBestOffer: OK');
}

// THE invariant of the flow change. A parked player sits on a zero-year
// contract; if resolution ever misses one he is rostered forever on a deal
// that can never expire again.
function checkResolutionLeavesNobodyParked() {
  parkedFixture(404);
  const before = fa.openRestrictedFreeAgents('BOS').length;
  assert.ok(before > 0, 'sanity: there must be parked players to resolve');

  const results = fa.resolveLeagueRestrictedFA('BOS');
  assert.strictEqual(results.length, before, 'every parked player must get an answer');
  assert.strictEqual(fa.openRestrictedFreeAgents('BOS').length, 0,
    'nobody may be left parked once the market opens');

  const stranded = PLAYERS_2026.filter(function (p) {
    return p.teamId && p.contract.yearsRemaining <= 0 && !p.resignRights;
  });
  // A parked player sits on a zero-year deal. If resolution misses one he is
  // rostered forever on a contract that can never expire again.
  assert.strictEqual(stranded.length, 0,
    stranded.length + ' players are rostered on an expired contract with nothing holding them');

  // And both endings actually occur, or the resolution is one-sided.
  const matched = results.filter(function (r) { return r.matched; }).length;
  assert.ok(matched > 0, 'some incumbents must keep their player');
  assert.ok(matched < results.length, 'and some must lose him');
  results.forEach(function (r) {
    assert.ok(r.teamId, r.name + ' resolved to no team at all');
  });
  console.log('checkResolutionLeavesNobodyParked: OK (' + matched + ' kept, ' +
    (results.length - matched) + ' moved)');
}

// A raid that works, end to end: outbid the standing sheet, then have the
// incumbent decline to match.
function checkAWinningRaidLandsThePlayer() {
  parkedFixture(2718);

  // The raider must actually be able to pay. Boston opens $232M against a
  // $154M cap, so writing a sheet from there is refused every time — the first
  // version of this check looped over every target, was refused on all of them,
  // and printed "every incumbent matched" without ever having raided anyone.
  // A test that passes by never reaching its own subject is worse than no test.
  const raider = TEAMS.slice().sort(function (a, b) {
    return league.getTeamPayroll(a.id) - league.getTeamPayroll(b.id);
  })[0];
  const space = fa.checkOffer(raider, 10000000, 4);
  assert.ok(space.ok, 'the poorest-payroll club must be able to write a real sheet: ' + space.reason);

  const open = fa.openRestrictedFreeAgents(raider.id);
  assert.ok(open.length > 0, 'there must be somebody to raid');
  const target = open[0];
  const heldBy = target.teamId;

  // Steep on purpose: he should prefer it, and the incumbent should balk.
  const res = fa.writeOfferSheet(target, raider, 10000000, 4);
  assert.ok(res.ok, 'a big sheet from a club with space must be accepted: ' + res.reason);
  assert.strictEqual(target.resignRights.offerSheet.teamId, raider.id, 'the standing sheet is now ours');

  const out = fa.resolveLeagueRestrictedFA(raider.id);
  const row = out.filter(function (r) { return r.playerId === target.id; })[0];
  assert.ok(row, 'our target must be among the resolved');

  if (row.matched) {
    assert.strictEqual(target.teamId, heldBy, 'a matched player stays put');
    assert.strictEqual(target.contract.salary, 10000000,
      'and is kept on OUR terms — that is what matching costs them');
    console.log('checkAWinningRaidLandsThePlayer: OK (' + heldBy + ' matched, and pays our price)');
  } else {
    assert.strictEqual(target.teamId, raider.id, 'an unmatched sheet of ours must deliver the player');
    assert.strictEqual(target.contract.salary, 10000000, 'on the terms we wrote');
    assert.strictEqual(target.contract.yearsRemaining, 4, 'and the length we wrote');
    console.log('checkAWinningRaidLandsThePlayer: OK (signed ' + target.name + ' away from ' + heldBy + ')');
  }
}

checkWhoIsRestricted();
checkOtherClubsRestrictedPlayersAreRaidable();
checkWritingASheetTakesTheBestOffer();
checkResolutionLeavesNobodyParked();
checkAWinningRaidLandsThePlayer();
restoreLeague();
checkASheetCostsMoreThanFairValue();
checkMatchDecisionRespondsToPrice();
checkMatchingMayExceedTheCap();
checkAnUnansweredSheetSignsHimAway();
checkAutomationAnswersSheets();

console.log('All restrictedFA validations passed');
