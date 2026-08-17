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

  const develop = { type: owner.MANDATE_TYPES.develop };
  assert.strictEqual(owner.judgeMandate(develop, owner.seasonOutcome(t, { youngImprovement: 3 })).met, true, 'the kids grew');
  assert.strictEqual(owner.judgeMandate(develop, owner.seasonOutcome(t, { youngImprovement: 0 })).met, false, 'they did not');

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

console.log('All owner mandate validations passed');
