// Morale was measured every game and read by nobody who mattered. It now
// reaches development, and these are the rules that keep that from quietly
// re-scaling the league.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js'); rq('teams.js');
const traits = rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const ratings = rq('ratings.js'); rq('coaches.js');
const prog = rq('progression.js');
const morale = rq('morale.js');
const { makeRng } = rq('rng.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);

function checkTheAverageManIsUnaffected() {
  // The pivot IS the no-op point. If this drifts, every club in the league
  // starts developing faster or slower for no design reason.
  assert.strictEqual(prog.moraleDevelopmentBonus({ status: { morale: prog.MORALE_DEV_PIVOT } }), 0,
    'a player at the pivot must get exactly nothing');
  console.log('checkTheAverageManIsUnaffected: OK (pivot ' + prog.MORALE_DEV_PIVOT + ')');
}

function checkMoodPointsTheRightWay() {
  const low = prog.moraleDevelopmentBonus({ status: { morale: 20 } });
  const mid = prog.moraleDevelopmentBonus({ status: { morale: prog.MORALE_DEV_PIVOT } });
  const high = prog.moraleDevelopmentBonus({ status: { morale: 95 } });
  assert.ok(low < mid && mid < high, 'happier must develop faster: ' + low + ' < ' + mid + ' < ' + high);
  assert.ok(low < 0 && high > 0, 'the pivot must actually split the two directions');
  console.log('checkMoodPointsTheRightWay: OK');
}

function checkMoodMattersLessThanABreakoutYear() {
  // Sized against the terms already in progressPlayer: coachability is +/-1.5,
  // the affiliate bonus 1.0, a breakout roll +/-8. Mood should feel like a
  // coach who suits you, not like a career-changing year.
  const ext = Math.max(
    Math.abs(prog.moraleDevelopmentBonus({ status: { morale: 0 } })),
    Math.abs(prog.moraleDevelopmentBonus({ status: { morale: 100 } })));
  assert.ok(ext <= 2.0, 'morale must not dominate development, got ' + ext.toFixed(2));
  assert.ok(ext >= 0.5, 'and must not be decorative either, got ' + ext.toFixed(2));
  console.log('checkMoodMattersLessThanABreakoutYear: OK (max ' + ext.toFixed(2) + ' pts/season)');
}

function checkAMissingMoodIsNotAPenalty() {
  // Old saves, generated prospects and the Monte Carlo's throwaway clones do
  // not all carry a status block. None of them may be punished for it.
  assert.strictEqual(prog.moraleDevelopmentBonus({}), 0, 'no status, no effect');
  assert.strictEqual(prog.moraleDevelopmentBonus({ status: {} }), 0, 'no morale, no effect');
  assert.strictEqual(prog.moraleDevelopmentBonus({ status: { morale: null } }), 0, 'null morale, no effect');
  assert.strictEqual(prog.moraleDevelopmentBonus(null), 0, 'no player, no crash');
  console.log('checkAMissingMoodIsNotAPenalty: OK');
}

function checkPotentialIsNotJudgedOnABadMonth() {
  // estimatePotentialMonteCarlo asks what a player COULD become. A slump in
  // November is not part of that answer, which is why the potential pull and
  // coach fit are suppressed there too.
  function run(m, suppress) {
    const p = {
      id: 't', age: 21, yearsPro: 1, potential: 90, teamId: null,
      attributes: Object.assign({}, PLAYERS_2026[0].attributes),
      status: { morale: m }, hiddenTraits: [], hiddenPersonality: {}, contract: { yearsRemaining: 3 }
    };
    ratings.defineOverall(p);
    const before = p.rawOverall;
    prog.progressPlayer(p, makeRng(5), [], { suppressPotentialPull: suppress });
    return p.rawOverall - before;
  }
  assert.strictEqual(run(5, true), run(95, true),
    'inside the potential estimate, mood must make no difference at all');
  assert.notStrictEqual(run(5, false), run(95, false),
    'but in a real season it must');
  console.log('checkPotentialIsNotJudgedOnABadMonth: OK');
}

function checkTheLeagueDevelopsAsItDidBefore() {
  // The integration check, and the one that matters. This is a
  // REDISTRIBUTION: unhappy players develop slower, happy ones faster, and the
  // league as a whole must land where it always did. Pivoting on the median
  // (57) rather than the mean (62.3) failed this at +0.244 pts/season, which
  // is every club quietly improving faster for no reason.
  //
  // Morale is set to a measured, realistic spread rather than a played season,
  // so this stays a fast unit-style check: median ~57, p10 ~39, p90 ~92.
  const r = makeRng(31);
  const sample = PLAYERS_2026.slice(0, 300);
  const moods = sample.map(function () {
    const u = r();
    return u < 0.1 ? 39 : u < 0.5 ? 55 : u < 0.9 ? 75 : 92;
  });
  function pass(pinned) {
    const rr = makeRng(777);
    let total = 0;
    sample.forEach(function (src, i) {
      const p = {
        id: src.id, age: src.age, yearsPro: src.yearsPro, potential: src.potential, teamId: null,
        attributes: Object.assign({}, src.attributes),
        status: { morale: pinned ? prog.MORALE_DEV_PIVOT : moods[i] },
        hiddenTraits: src.hiddenTraits, hiddenPersonality: src.hiddenPersonality,
        contract: src.contract
      };
      ratings.defineOverall(p);
      const before = p.rawOverall;
      prog.progressPlayer(p, rr, [], {});
      total += (p.rawOverall - before);
    });
    return total / sample.length;
  }
  const live = pass(false), neutral = pass(true);
  const drift = Math.abs(live - neutral);
  assert.ok(drift < 0.12,
    'morale must redistribute development, not add it. Drift ' + drift.toFixed(3) +
    ' pts/season (live ' + live.toFixed(3) + ' vs neutral ' + neutral.toFixed(3) + ')');
  console.log('checkTheLeagueDevelopsAsItDidBefore: OK (drift ' + drift.toFixed(3) + ' pts/season)');
}

function checkTheGapIsWorthCaringAbout() {
  // The design goal: neglecting a young player has to cost something you can
  // see. Two identical prospects, five seasons, different moods.
  function career(m) {
    const src = PLAYERS_2026.find(function (p) { return p.age <= 23 && p.potential >= 80; }) || PLAYERS_2026[0];
    const p = {
      id: 'c', age: src.age, yearsPro: src.yearsPro, potential: src.potential, teamId: null,
      attributes: Object.assign({}, src.attributes), status: { morale: m },
      hiddenTraits: src.hiddenTraits, hiddenPersonality: src.hiddenPersonality, contract: src.contract
    };
    ratings.defineOverall(p);
    const rng = makeRng(9);
    for (let y = 0; y < 5; y++) { p.status.morale = m; prog.progressPlayer(p, rng, [], {}); }
    return p.rawOverall;
  }
  const unhappy = career(35), happy = career(90);
  assert.ok(happy - unhappy >= 2,
    'five seasons of neglect must cost a visible amount, got ' + (happy - unhappy).toFixed(2));
  console.log('checkTheGapIsWorthCaringAbout: OK (' + (happy - unhappy).toFixed(1) +
    ' rating points over five seasons)');
}

function checkTheTierBoundariesStillMeanSomething() {
  // moraleTier is what the UI shows. An "unhappy" player must actually be on
  // the losing side of development, or the label lies.
  assert.strictEqual(morale.moraleTier(30), 'unhappy');
  assert.strictEqual(morale.moraleTier(80), 'happy');
  assert.ok(prog.moraleDevelopmentBonus({ status: { morale: 39 } }) < 0,
    'a player the UI calls unhappy must develop slower');
  assert.ok(prog.moraleDevelopmentBonus({ status: { morale: 80 } }) > 0,
    'a player the UI calls happy must develop faster');
  console.log('checkTheTierBoundariesStillMeanSomething: OK');
}

checkTheAverageManIsUnaffected();
checkMoodPointsTheRightWay();
checkMoodMattersLessThanABreakoutYear();
checkAMissingMoodIsNotAPenalty();
checkPotentialIsNotJudgedOnABadMonth();
checkTheLeagueDevelopsAsItDidBefore();
checkTheGapIsWorthCaringAbout();
checkTheTierBoundariesStillMeanSomething();

console.log('All morale-development validations passed');
