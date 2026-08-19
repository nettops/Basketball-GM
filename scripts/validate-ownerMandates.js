// The owner, who until now did not know the score.
//
// Measured before this existed: across four seasons his happiness correlated
// with wins at r = 0.12-0.39, and the fifth-unhappiest owner in the league ran
// a club that had just won 71 games. Every write to ownerHappiness lived in
// finances.js and was driven by the luxury tax, so the clubs that spent to win
// had the angriest owners.
//
// The checks that matter are the two that make a mandate a goal rather than a
// punishment: it has to fit the club it is given to, and it must not be
// survivable-by-luck or lost-to-luck in a single season.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

const data = req('data.js');
const { makeRng } = req('rng.js');
const owner = req('owner.js');
const gmCareer = req('gmCareer.js');

function team(timeline, prestige, wins) {
  return { id: 'TST', name: 'Test', timeline: timeline, prestige: prestige || 50,
    record: { wins: wins || 0, losses: 82 - (wins || 0) } };
}

// A rebuilding club told to win 55 games is not a mandate, it is a bug report.
function checkTheMandateFitsTheClub() {
  const rng = makeRng(11);
  const seen = { 'win-now': {}, rebuilding: {}, retooling: {} };

  ['win-now', 'rebuilding', 'retooling'].forEach(function (timeline) {
    for (let i = 0; i < 200; i++) {
      const m = owner.chooseMandate(team(timeline, 50), rng);
      seen[timeline][m.type] = true;
      assert.ok(m.label && m.label.length > 0, 'every mandate says what it wants');
    }
  });

  assert.ok(!seen.rebuilding[owner.MANDATE_TYPES.wins],
    'nobody rebuilding is handed a win total');
  assert.ok(!seen.rebuilding[owner.MANDATE_TYPES.contend],
    'nor told to reach the conference finals');
  assert.ok(seen.rebuilding[owner.MANDATE_TYPES.develop],
    'they are asked to develop somebody');
  assert.ok(seen['win-now'][owner.MANDATE_TYPES.contend],
    'a win-now club can be asked to go deep');
  assert.ok(!seen['win-now'][owner.MANDATE_TYPES.develop],
    'and is not asked to bring the kids along instead');
  console.log('checkTheMandateFitsTheClub: OK');
}
checkTheMandateFitsTheClub();

// A target nobody can hit is the same failure as no target at all.
function checkWinTargetsStayReachable() {
  ['win-now', 'retooling', 'rebuilding'].forEach(function (timeline) {
    [10, 50, 99].forEach(function (prestige) {
      const t = owner.mandateWinTarget(team(timeline, prestige));
      assert.ok(t >= 20 && t <= 60, timeline + '/' + prestige + ' target is reachable: ' + t);
    });
  });
  // Prestige raises the bar at the same timeline: a proud club expects more of
  // itself.
  assert.ok(owner.mandateWinTarget(team('win-now', 90)) > owner.mandateWinTarget(team('win-now', 30)),
    'a proud club is held to a higher standard than a modest one');
  console.log('checkWinTargetsStayReachable: OK (' +
    owner.mandateWinTarget(team('rebuilding', 50)) + '-' +
    owner.mandateWinTarget(team('win-now', 90)) + ' across the league)');
}
checkWinTargetsStayReachable();

function checkTheJudgementReadsTheSeason() {
  const t = team('win-now', 70, 50);

  const winsMandate = { type: owner.MANDATE_TYPES.wins, target: 48 };
  assert.strictEqual(owner.judgeMandate(winsMandate, owner.seasonOutcome(t)).met, true, '50 wins clears 48');
  assert.strictEqual(owner.judgeMandate(winsMandate, owner.seasonOutcome(team('win-now', 70, 40))).met, false,
    '40 does not');

  const playoffs = { type: owner.MANDATE_TYPES.playoffs };
  assert.strictEqual(owner.judgeMandate(playoffs, owner.seasonOutcome(t, { madePlayoffs: true })).met, true, 'made it');
  assert.strictEqual(owner.judgeMandate(playoffs, owner.seasonOutcome(t, { madePlayoffs: false })).met, false, 'did not');

  const contend = { type: owner.MANDATE_TYPES.contend, rounds: 2 };
  assert.strictEqual(owner.judgeMandate(contend, owner.seasonOutcome(t, { roundsWon: 2 })).met, true, 'two rounds is deep enough');
  assert.strictEqual(owner.judgeMandate(contend, owner.seasonOutcome(t, { roundsWon: 1 })).met, false, 'one is not');

  const budget = { type: owner.MANDATE_TYPES.budget };
  const line = data.getEffectiveLuxuryTaxLine();
  assert.strictEqual(owner.judgeMandate(budget, owner.seasonOutcome(t, { payroll: line - 1 })).met, true, 'under the line');
  assert.strictEqual(owner.judgeMandate(budget, owner.seasonOutcome(t, { payroll: line + 1 })).met, false, 'over it');

  // Judged on minutes, not on rating growth. Growth was unwinnable by
  // construction: progressPlayer runs only in the offseason, so no rating could
  // move between a mandate being set and being judged.
  const develop = { type: owner.MANDATE_TYPES.develop };
  assert.strictEqual(owner.judgeMandate(develop, owner.seasonOutcome(t, { youngMinutesShare: 0.30 })).met, true,
    'the kids played');
  assert.strictEqual(owner.judgeMandate(develop, owner.seasonOutcome(t, { youngMinutesShare: 0.05 })).met, false,
    'they sat');

  // Missing is news; clearing it is just the job.
  const missed = owner.judgeMandate(winsMandate, owner.seasonOutcome(team('win-now', 70, 20)));
  const met = owner.judgeMandate(winsMandate, owner.seasonOutcome(t));
  assert.ok(missed.happinessDelta < 0 && met.happinessDelta > 0, 'the owner reacts in the right direction');
  assert.ok(Math.abs(missed.happinessDelta) > met.happinessDelta,
    'and a miss costs more than a hit earns');
  console.log('checkTheJudgementReadsTheSeason: OK');
}
checkTheJudgementReadsTheSeason();

// The point of patience. A job you can lose to one unlucky season is a coin
// flip, not a job.
function checkOneBadYearIsAWarningNotTheSack() {
  const career = gmCareer.createGmCareer('GM', 'BOS', 2026);
  const missed = { met: false };

  const first = owner.applyMandateResult(career, 'BOS', missed);
  assert.strictEqual(first.fired, false, 'the first miss is a warning');
  assert.strictEqual(first.patience, 1, 'with one year left');
  assert.strictEqual(owner.patienceLabel(first.patience), 'On notice', 'and it says so');

  const second = owner.applyMandateResult(career, 'BOS', missed);
  assert.strictEqual(second.fired, true, 'the second is the sack');
  console.log('checkOneBadYearIsAWarningNotTheSack: OK');
}
checkOneBadYearIsAWarningNotTheSack();

// Consecutive, not cumulative: a GM who alternates good and bad years keeps his
// job. He is judged on a trend, not an average.
function checkAGoodYearBuysBackTheBenefitOfTheDoubt() {
  const career = gmCareer.createGmCareer('GM', 'BOS', 2026);
  owner.applyMandateResult(career, 'BOS', { met: false });
  const recovered = owner.applyMandateResult(career, 'BOS', { met: true });
  assert.strictEqual(recovered.patience, owner.OWNER_PATIENCE, 'a good year resets him');
  assert.strictEqual(recovered.fired, false, 'and nobody is sacked');

  const missAgain = owner.applyMandateResult(career, 'BOS', { met: false });
  assert.strictEqual(missAgain.fired, false,
    'so the next miss is a fresh warning, not the second strike of a lifetime tally');
  console.log('checkAGoodYearBuysBackTheBenefitOfTheDoubt: OK');
}
checkAGoodYearBuysBackTheBenefitOfTheDoubt();

// endYear is the field gmCareer.js has always carried and nothing has ever
// written. A tenure that cannot end is the reason nobody could be fired.
function checkTheSackClosesTheTenure() {
  const career = gmCareer.createGmCareer('GM', 'BOS', 2026);
  const open = career.tenures[career.tenures.length - 1];
  assert.strictEqual(open.endYear, null, 'the tenure starts open');

  const closed = owner.endTenure(career, 'BOS', 2029);
  assert.ok(closed, 'the tenure was found');
  assert.strictEqual(closed.endYear, 2029, 'and closed on the season he was sacked');

  // Idempotent: sacking a man who has already gone must not close a tenure that
  // belongs to a different club or a different spell.
  assert.strictEqual(owner.endTenure(career, 'BOS', 2031), null, 'there is nothing left to close');
  console.log('checkTheSackClosesTheTenure: OK');
}
checkTheSackClosesTheTenure();

// The bug this replaced: ratings cannot move between a mandate being set and
// being judged, because progression runs only in the offseason. A develop
// mandate scored on rating growth was therefore unfailable in one direction and
// unwinnable in the other, and rebuilding clubs cleared their mandate 2 seasons
// in 12 because of it.
function checkDevelopIsJudgedOnSomethingAGmControls() {
  const played = [
    { age: 21, seasonStats: { minutes: 2000 } },
    { age: 30, seasonStats: { minutes: 2000 } }
  ];
  const benched = [
    { age: 21, seasonStats: { minutes: 100 } },
    { age: 30, seasonStats: { minutes: 3900 } }
  ];
  assert.ok(owner.youngMinutesShare(played) > owner.DEVELOP_MINUTES_SHARE, 'playing the kids clears it');
  assert.ok(owner.youngMinutesShare(benched) < owner.DEVELOP_MINUTES_SHARE, 'benching them does not');

  // Before a game is played there are no minutes at all. That must read as zero
  // rather than dividing by nothing.
  assert.strictEqual(owner.youngMinutesShare([{ age: 21 }, { age: 30 }]), 0, 'no minutes is no share');
  assert.strictEqual(owner.youngMinutesShare([]), 0, 'and an empty roster does not throw');
  console.log('checkDevelopIsJudgedOnSomethingAGmControls: OK');
}
checkDevelopIsJudgedOnSomethingAGmControls();

// A club with no under-23s cannot develop anybody. Asking it to would recreate
// the unwinnable mandate in a new shape — and several clubs open with zero.
function checkAClubWithNoKidsIsNotToldToDevelopThem() {
  const rng = makeRng(7);
  const bare = { id: 'X', timeline: 'rebuilding', prestige: 50, record: { wins: 0, losses: 0 } };
  for (let i = 0; i < 200; i++) {
    const m = owner.chooseMandate(bare, rng, { youngPlayers: 0 });
    assert.notStrictEqual(m.type, owner.MANDATE_TYPES.develop,
      'a club with no young players is never asked to develop them');
  }
  // With kids on the roster it is back on the table.
  let sawDevelop = false;
  for (let i = 0; i < 200; i++) {
    if (owner.chooseMandate(bare, rng, { youngPlayers: 4 }).type === owner.MANDATE_TYPES.develop) sawDevelop = true;
  }
  assert.ok(sawDevelop, 'a club with kids can be asked to play them');
  console.log('checkAClubWithNoKidsIsNotToldToDevelopThem: OK');
}
checkAClubWithNoKidsIsNotToldToDevelopThem();

// The same defect as the develop mandate, in the other direction. Measured, 7
// clubs of 30 are under the luxury tax line against a median payroll of $233M
// and a $187M line — so "stay under the luxury tax" was being handed to 23
// clubs who would have had to shed $46M to comply with it.
function checkAClubDeepInTheTaxIsNotToldToStayOutOfIt() {
  const rng = makeRng(19);
  const overTaxed = { id: 'X', timeline: 'rebuilding', prestige: 50, record: { wins: 0, losses: 0 } };
  for (let i = 0; i < 200; i++) {
    const m = owner.chooseMandate(overTaxed, rng, { youngPlayers: 3, underTaxLine: false });
    assert.notStrictEqual(m.type, owner.MANDATE_TYPES.budget,
      'a club already deep in the tax is not told to stay out of it');
  }

  // Under the line, it is a fair thing to ask.
  let sawBudget = false;
  for (let i = 0; i < 200; i++) {
    if (owner.chooseMandate(overTaxed, rng, { youngPlayers: 3, underTaxLine: true }).type === owner.MANDATE_TYPES.budget) {
      sawBudget = true;
    }
  }
  assert.ok(sawBudget, 'a club under the line can be asked to stay there');

  // And a club that can do NEITHER still gets something judgeable rather than
  // falling through to nothing.
  for (let i = 0; i < 100; i++) {
    const m = owner.chooseMandate(overTaxed, rng, { youngPlayers: 0, underTaxLine: false });
    assert.ok(m.type === owner.MANDATE_TYPES.wins, 'no kids and no room still yields a win total');
    assert.ok(m.target >= 20 && m.target <= 60, 'and a reachable one');
  }
  console.log('checkAClubDeepInTheTaxIsNotToldToStayOutOfIt: OK');
}
checkAClubDeepInTheTaxIsNotToldToStayOutOfIt();

// The biggest single source of failed mandates, found by printing the
// per-mandate miss rate rather than by reasoning about which one looked hard:
// win totals were missed 64% of the time because the target read the club's
// self-image and never its actual strength. Boston, prestige 88 and a 40-win
// team, was asked for 52 every season.
function checkTheTargetKnowsWhatTheClubActuallyDid() {
  const proudButBad = { id: 'X', timeline: 'win-now', prestige: 88,
    lastSeasonWins: 40, record: { wins: 0, losses: 0 } };
  const ambition = owner.mandateAmbition(proudButBad);
  const target = owner.mandateWinTarget(proudButBad);

  assert.ok(target < ambition,
    'a proud club that won 40 is asked for less than its reputation suggests (' +
    target + ' vs ambition ' + ambition + ')');
  assert.ok(target > proudButBad.lastSeasonWins,
    'but still asked to improve on what it did (' + target + ' vs 40)');

  // A club that won more is asked for more, at the same reputation.
  const proudAndGood = Object.assign({}, proudButBad, { lastSeasonWins: 58 });
  assert.ok(owner.mandateWinTarget(proudAndGood) > target,
    'and a club that won 58 is asked for more than one that won 40');

  // Season one has no history at all; the target falls back to ambition rather
  // than to zero, which would make the first mandate free.
  const fresh = { id: 'Y', timeline: 'win-now', prestige: 88, record: { wins: 0, losses: 0 } };
  assert.strictEqual(owner.mandateWinTarget(fresh), Math.min(60, owner.mandateAmbition(fresh)),
    'with no history the target is pure ambition, not zero');
  console.log('checkTheTargetKnowsWhatTheClubActuallyDid: OK');
}
checkTheTargetKnowsWhatTheClubActuallyDid();

// Missed 5 times out of 5 before this guard. The third variant of one mistake:
// a mandate handed to a club with no realistic route to it.
function checkAClubThatMissedThePlayoffsIsNotToldToWinASeries() {
  const rng = makeRng(23);
  const t = { id: 'Z', timeline: 'win-now', prestige: 70, lastSeasonWins: 38,
    record: { wins: 0, losses: 0 } };
  for (let i = 0; i < 300; i++) {
    const m = owner.chooseMandate(t, rng, { madePlayoffsLastYear: false });
    assert.notStrictEqual(m.type, owner.MANDATE_TYPES.contend,
      'a club that missed the playoffs is not asked to win a series');
  }
  let sawContend = false;
  for (let i = 0; i < 300; i++) {
    if (owner.chooseMandate(t, rng, { madePlayoffsLastYear: true }).type === owner.MANDATE_TYPES.contend) {
      sawContend = true;
    }
  }
  assert.ok(sawContend, 'a club that reached the playoffs can be asked to go further');
  console.log('checkAClubThatMissedThePlayoffsIsNotToldToWinASeries: OK');
}
checkAClubThatMissedThePlayoffsIsNotToldToWinASeries();

// Being sacked has to lead somewhere. endYear was set and firedAtEndOfSeason was
// saved, and nothing read either — the owner could fire you and the game carried
// on as though he had not.
function checkTheSackLeadsSomewhere() {
  const teams = [
    { id: 'AAA', prestige: 90 }, { id: 'BBB', prestige: 60 },
    { id: 'CCC', prestige: 40 }, { id: 'DDD', prestige: 20 }
  ];

  const wellRegarded = { reputation: 85, tenures: [] };
  const openToHim = owner.clubsWillingToHire(wellRegarded, teams, 'AAA');
  assert.ok(openToHim.length >= 3, 'a respected GM has options');
  assert.ok(!openToHim.some(function (t) { return t.id === 'AAA'; }),
    'but not at the club that just sacked him');
  assert.ok(openToHim[0].prestige >= openToHim[openToHim.length - 1].prestige,
    'and the best job is listed first');

  const disgraced = { reputation: 15, tenures: [] };
  const scraps = owner.clubsWillingToHire(disgraced, teams, 'AAA');
  assert.ok(scraps.length < openToHim.length,
    'a wrecked reputation leaves fewer doors open (' + scraps.length + ' vs ' + openToHim.length + ')');
  scraps.forEach(function (t) {
    assert.ok(t.prestige <= 40, 'and only the clubs with least to lose: ' + t.id);
  });

  // Taking a job opens a new tenure and extends fresh credit.
  const career = gmCareer.createGmCareer('GM', 'BOS', 2026);
  owner.applyMandateResult(career, 'BOS', { met: false });
  owner.applyMandateResult(career, 'BOS', { met: false });
  owner.endTenure(career, 'BOS', 2028);

  const next = owner.startTenure(career, 'CCC', 2029);
  // Nobody holds two jobs at once. tenureCovers reads tenures as a sequence, so
  // a spell left open alongside a new one reports the GM at both clubs in the
  // same season and counts every stat twice. Found because a browser check
  // forced the flag directly instead of going through the review that closes it.
  const stillOpen = career.tenures.filter(function (t) {
    return t.endYear === null || t.endYear === undefined;
  });
  assert.strictEqual(stillOpen.length, 1, 'exactly one tenure is open at a time');
  assert.strictEqual(stillOpen[0].teamId, 'CCC', 'and it is the new job');
  assert.strictEqual(career.tenures.length, 2, 'the career has two spells now');
  assert.strictEqual(next.endYear, null, 'the new one is open');
  assert.strictEqual(career.tenures[0].endYear, 2028, 'and the old one stays closed');
  assert.strictEqual(owner.applyMandateResult(career, 'CCC', { met: false }).fired, false,
    'a new employer does not inherit the grudge of the last one');
  console.log('checkTheSackLeadsSomewhere: OK');
}
checkTheSackLeadsSomewhere();

console.log('All owner mandate validations passed');
