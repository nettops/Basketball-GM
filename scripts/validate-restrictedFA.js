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

checkWhoIsRestricted();
checkASheetCostsMoreThanFairValue();
checkMatchDecisionRespondsToPrice();
checkMatchingMayExceedTheCap();
checkAnUnansweredSheetSignsHimAway();
checkAutomationAnswersSheets();

console.log('All restrictedFA validations passed');
