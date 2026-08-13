// The user's free-agency offer is subject to the SAME cap rule as every AI
// team's, and the Disable Salary Cap setting is the only way past it.
//
// Before this existed, generateAIOffer held the cap logic inline, so it only
// ever applied to offers the AI generated. The user's bidding path
// (freeAgencyBidding.js) never touched that function and was therefore
// unconstrained: a team $33.6M OVER the cap — a position where every AI team
// is refused outright — could sign a $1,000,000,000 contract and drive its
// payroll to eight times the cap. The Settings toggle promises "free agency
// and trades ignore cap space entirely", which is only meaningful if the cap
// otherwise binds.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const data = rq('data.js');
const league = rq('league.js');
const fa = rq('freeAgency.js');
const bidding = rq('freeAgencyBidding.js');
const { makeRng } = rq('rng.js');

const BILLION = 1000000000;
const CAP = data.getEffectiveSalaryCap(1);

// freeAgency.js and freeAgencyBidding.js both read GameState.settings for
// capLevel/capDisabled and tolerate its absence. Node has no GameState, so
// give them one rather than testing a code path the browser never takes.
global.GameState = { settings: { capLevel: 1, capDisabled: false } };

// Each case gets the league back exactly as it started: teamId and contract
// are the only things these paths mutate, and a leaked $1B contract would
// silently poison every later assertion about payroll.
function withFreeAgent(playerId, fn) {
  const p = PLAYERS_2026.find(function (x) { return x.id === playerId; });
  const teamId = p.teamId, contract = p.contract;
  p.teamId = null;
  try { return fn(p); } finally { p.teamId = teamId; p.contract = contract; }
}

function payrollOf(teamId) { return league.getTeamPayroll(teamId); }

// A team over the cap is exactly where the AI is refused: generateAIOffer
// returns null when capSpace < the minimum salary.
function findOverCapTeam() {
  const t = TEAMS.find(function (t) { return CAP - payrollOf(t.id) < 0; });
  assert.ok(t, 'the fixture league needs at least one over-the-cap team');
  return t;
}
function findUnderCapTeam() {
  const t = TEAMS.slice().sort(function (a, b) { return payrollOf(a.id) - payrollOf(b.id); })[0];
  assert.ok(CAP - payrollOf(t.id) > 5000000, 'need a team with real cap space');
  return t;
}

function checkOverCapTeamCannotSignAtAll() {
  const team = findOverCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const before = payrollOf(team.id);
    // The AI in this exact position is refused outright — the user must be too.
    assert.strictEqual(fa.generateAIOffer(team, star, makeRng(1)), null,
      'precondition: an over-cap team must get no AI offer');

    const state = bidding.startBidding(star.id, team.id, makeRng(1));
    const result = bidding.evaluateBiddingRound(state, BILLION, 5);
    assert.strictEqual(result.offerAccepted, false,
      'a $1B offer from an over-cap team must be rejected');
    assert.ok(result.rejectedReason, 'a rejection must say why');
    assert.strictEqual(result.userWinning, false,
      'a rejected offer cannot be described as winning the bidding');

    // Defense in depth: pressing Sign Player must not award him either, even
    // though the offer never legally existed.
    const outcome = bidding.finalizeBidding(state, true);
    assert.notStrictEqual(outcome.teamId, team.id,
      'an over-cap team must not end up with the player');
    assert.strictEqual(star.contract.salary < BILLION, true,
      'no $1B contract may be written');
    assert.ok(payrollOf(team.id) <= before + 1,
      'an over-cap team payroll must not grow, was ' + before + ' now ' + payrollOf(team.id));
  });
  console.log('checkOverCapTeamCannotSignAtAll: OK');
}

function checkOfferCannotExceedCapSpace() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const space = CAP - payrollOf(team.id);
    const state = bidding.startBidding(star.id, team.id, makeRng(2));

    const tooBig = bidding.evaluateBiddingRound(state, space + 1000000, 3);
    assert.strictEqual(tooBig.offerAccepted, false,
      'an offer $1M above available space must be rejected');

    const legal = bidding.evaluateBiddingRound(state, space - 1000000, 3);
    assert.strictEqual(legal.offerAccepted, true,
      'an offer inside cap space must be accepted, got: ' + legal.rejectedReason);

    bidding.finalizeBidding(state, true);
    assert.strictEqual(star.teamId, team.id, 'a legal offer must actually sign the player');
    assert.ok(payrollOf(team.id) <= CAP,
      'payroll must not exceed the cap after a legal signing');
  });
  console.log('checkOfferCannotExceedCapSpace: OK');
}

// The gap between bidding and signing is real: you can submit a legal offer,
// go and make a trade that eats your cap space, and come back to a Sign Player
// button that is still sitting there enabled. finalizeBidding re-checks for
// exactly this, and without this case that re-check is unproven — a mutation
// deleting it survived the rest of the suite.
function checkCapSpaceLostBetweenBidAndSigning() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const space = CAP - payrollOf(team.id);
    const state = bidding.startBidding(star.id, team.id, makeRng(6));
    const legal = bidding.evaluateBiddingRound(state, space - 2000000, 3);
    assert.strictEqual(legal.offerAccepted, true, 'precondition: the bid must be legal when made');

    // Now absorb salary the way a trade would, wiping out that space.
    const fat = PLAYERS_2026.filter(function (p) { return p.teamId && p.teamId !== team.id; })
      .sort(function (a, b) { return b.contract.salary - a.contract.salary; })[0];
    const fatFrom = fat.teamId;
    fat.teamId = team.id;
    try {
      assert.ok(CAP - payrollOf(team.id) < space - 2000000,
        'precondition: the trade must actually have eaten the space');
      const outcome = bidding.finalizeBidding(state, true);
      assert.notStrictEqual(outcome.teamId, team.id,
        'an offer that no longer fits must not be honoured at signing time');
      assert.notStrictEqual(star.teamId, team.id);
    } finally {
      fat.teamId = fatFrom;
    }
  });
  console.log('checkCapSpaceLostBetweenBidAndSigning: OK');
}

// The salary box was hardened and the YEARS box next to it was not. Both are
// user input on the same form; guarding one and not the other is how a fixed
// exploit reappears wearing a different hat. $5,000,000 x 99 years signed
// cleanly — a superstar locked up for a century at a rotation player's price.
function checkContractLengthIsBounded() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const legalSalary = Math.min(20000000, (CAP - payrollOf(team.id)) - 1000000);
    // 2.5 is in here because a number input's step= is advisory only — you can
    // type a fraction into it. Without this case the whole-years requirement
    // was untested and deleting it changed nothing.
    [99, 50, 6, 0, -3, 2.5, NaN].forEach(function (years) {
      const state = bidding.startBidding(star.id, team.id, makeRng(9));
      const r = bidding.evaluateBiddingRound(state, legalSalary, years);
      assert.strictEqual(r.offerAccepted, false,
        'a ' + years + '-year contract must be rejected');
      assert.ok(r.rejectedReason, 'and must say why');
      // Defense in depth, exactly as for salary: the Sign button must not
      // honour it either.
      const outcome = bidding.finalizeBidding(state, true);
      assert.notStrictEqual(outcome.teamId, team.id,
        'a ' + years + '-year offer must not be signed');
      assert.ok(!star.teamId || star.contract.yearsRemaining <= fa.MAX_CONTRACT_YEARS,
        'no contract may exceed ' + fa.MAX_CONTRACT_YEARS + ' years');
      star.teamId = null;
    });
    // ...and a legal term still works.
    const state = bidding.startBidding(star.id, team.id, makeRng(9));
    const ok = bidding.evaluateBiddingRound(state, legalSalary, fa.MAX_CONTRACT_YEARS);
    assert.strictEqual(ok.offerAccepted, true,
      'the maximum legal term must still be allowed: ' + ok.rejectedReason);
  });
  console.log('checkContractLengthIsBounded: OK');
}

// The player has to actually choose you. finalizeBidding signed whoever the
// user named the moment they pressed the button, so the entire bidding
// contest was decorative: a 91-overall Wembanyama with a rival offering
// $31,833,686 signed for the $1,200,000 league minimum, with the panel saying
// "Behind" at the time. userWinning was computed every round and then thrown
// away — the same shape as every other bug here, a value worked out on one
// path and enforced on none.
function checkLosingBidCannotJustBeSigned() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const state = bidding.startBidding(star.id, team.id, makeRng(12));
    const minimum = fa.MIN_SALARY;
    const r = bidding.evaluateBiddingRound(state, minimum, 5);
    assert.strictEqual(r.offerAccepted, true, 'a minimum-salary offer is legal, just not competitive');
    assert.ok(r.bestAIOffer, 'precondition: somebody else must be bidding on a 91-overall');
    assert.ok(r.bestAIOffer.salary > minimum * 5,
      'precondition: the rival bid must be far above the minimum, got ' + r.bestAIOffer.salary);
    assert.strictEqual(r.userWinning, false, 'precondition: a minimum offer must be losing');

    const outcome = bidding.finalizeBidding(state, true);
    assert.notStrictEqual(outcome.teamId, team.id,
      'a player must not join a team whose offer he is not choosing');
    assert.notStrictEqual(star.teamId, team.id);
    assert.strictEqual(outcome.signed, true, 'he should sign with whoever actually won');
    star.teamId = null;

    // ...and a WINNING bid still closes the deal.
    const state2 = bidding.startBidding(star.id, team.id, makeRng(12));
    const space = CAP - payrollOf(team.id);
    const big = bidding.evaluateBiddingRound(state2, Math.min(space - 1000000, 44000000), 5);
    assert.strictEqual(big.offerAccepted, true, big.rejectedReason || '');
    assert.strictEqual(big.userWinning, true, 'a near-max offer should be winning');
    const won = bidding.finalizeBidding(state2, true);
    assert.strictEqual(won.teamId, team.id, 'a winning bid must still sign him');
    assert.strictEqual(star.teamId, team.id);
  });
  console.log('checkLosingBidCannotJustBeSigned: OK');
}

function checkBelowMinimumRejected() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const state = bidding.startBidding(star.id, team.id, makeRng(3));
    const r = bidding.evaluateBiddingRound(state, 1000, 2);
    assert.strictEqual(r.offerAccepted, false,
      'an offer below the league minimum must be rejected');
  });
  console.log('checkBelowMinimumRejected: OK');
}

function checkDisableCapStillWorks() {
  const team = findOverCapTeam();
  global.GameState.settings.capDisabled = true;
  try {
    withFreeAgent('sas-victor-wembanyama', function (star) {
      const state = bidding.startBidding(star.id, team.id, makeRng(4));
      const r = bidding.evaluateBiddingRound(state, BILLION, 5);
      assert.strictEqual(r.offerAccepted, true,
        'with the cap disabled the offer must go through — that is what the setting is for');
      const outcome = bidding.finalizeBidding(state, true);
      assert.strictEqual(outcome.teamId, team.id);
      assert.strictEqual(star.contract.salary, BILLION);
    });
  } finally {
    global.GameState.settings.capDisabled = false;
  }
  console.log('checkDisableCapStillWorks: OK');
}

function checkFullRosterCannotSign() {
  const team = TEAMS.find(function (t) { return league.getTeamRoster(t.id).length === 15; })
    || (function () {
      // Fill the roomiest team to 15 by borrowing free-agent-less bodies.
      const t = findUnderCapTeam();
      const spares = PLAYERS_2026.filter(function (p) { return p.teamId && p.teamId !== t.id; });
      const moved = [];
      while (league.getTeamRoster(t.id).length < 15) {
        const p = spares.pop();
        moved.push({ p: p, from: p.teamId });
        p.teamId = t.id;
      }
      t.__restore = function () { moved.forEach(function (m) { m.p.teamId = m.from; }); };
      return t;
    })();
  try {
    withFreeAgent('sas-victor-wembanyama', function (star) {
      const state = bidding.startBidding(star.id, team.id, makeRng(5));
      const r = bidding.evaluateBiddingRound(state, 1500000, 1);
      assert.strictEqual(r.offerAccepted, false,
        'a 15-man roster must not be able to sign a 16th player');
    });
  } finally {
    if (team.__restore) { team.__restore(); delete team.__restore; }
  }
  console.log('checkFullRosterCannotSign: OK');
}

// The extraction must not have moved the AI. If offerLimit changed what
// generateAIOffer does, league behaviour changed and every golden is suspect.
function checkAiOffersUnchanged() {
  const team = findUnderCapTeam();
  withFreeAgent('sas-victor-wembanyama', function (star) {
    const offer = fa.generateAIOffer(team, star, makeRng(7));
    assert.ok(offer, 'a team with space and interest should still make an offer');
    assert.ok(offer.salary >= 1200000, 'AI offer must respect the minimum');
    assert.ok(offer.salary <= CAP - payrollOf(team.id),
      'AI offer must still fit in cap space');
  });
  console.log('checkAiOffersUnchanged: OK');
}

// The 15-man ceiling has to be enforced somewhere for AI teams, not just
// stated. The draft hands every team two rookies unconditionally, so a team
// that entered the offseason full leaves it at 16-17; free agency then
// correctly refuses to sign anyone for them, but nothing ever waived anyone
// back down — measured over ten simulated seasons, 2-7 teams PLAYED EVERY
// SEASON over the limit. autoEnforceRosterSize existed for exactly this and
// only ever ran against the user's team.
//
// MUTATES THE LEAGUE (it runs the real silent market), so it runs last.
function checkOverfullAiTeamGetsTrimmed() {
  global.GameState.userTeamId = 'BOS';
  const aiTeam = TEAMS.find(function (t) { return t.id !== 'BOS'; });
  const donors = PLAYERS_2026.filter(function (p) {
    return p.teamId && p.teamId !== aiTeam.id && p.teamId !== 'BOS';
  });
  while (league.getTeamRoster(aiTeam.id).length < 17) {
    const p = donors.pop();
    if (p.teamId === aiTeam.id) continue;
    p.teamId = aiTeam.id;
  }
  while (league.getTeamRoster('BOS').length < 16) {
    const p = donors.pop();
    if (p.teamId === 'BOS') continue;
    p.teamId = 'BOS';
  }

  fa.runFreeAgencySilently(makeRng(11));

  assert.strictEqual(league.getTeamRoster(aiTeam.id).length, 15,
    'an AI team over the 15-man ceiling must be waived back down by the silent market, got ' +
    league.getTeamRoster(aiTeam.id).length);
  assert.strictEqual(league.getTeamRoster('BOS').length, 16,
    'the USER team is not the sweep\'s to trim — that is the opt-in autoCap ' +
    'setting and the unattended rollover path, got ' + league.getTeamRoster('BOS').length);
  console.log('checkOverfullAiTeamGetsTrimmed: OK');
}

checkOverCapTeamCannotSignAtAll();
checkOfferCannotExceedCapSpace();
checkCapSpaceLostBetweenBidAndSigning();
checkContractLengthIsBounded();
checkLosingBidCannotJustBeSigned();
checkBelowMinimumRejected();
checkDisableCapStillWorks();
checkFullRosterCannotSign();
checkAiOffersUnchanged();
checkOverfullAiTeamGetsTrimmed();

console.log('All free agency cap validations passed');
