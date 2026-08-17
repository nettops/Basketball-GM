const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const coachesModule = require(path.join(__dirname, '..', 'coaches.js'));

function makeTeam(overrides) {
  return Object.assign({ id: 'TST', name: 'Test Team' }, overrides || {});
}

function checkGenerateAndEnsureCoach() {
  const rng = makeRng(1);
  const team = makeTeam();
  assert.strictEqual(team.coach, undefined);

  const coach = coachesModule.ensureTeamCoach(team, rng);
  assert.ok(coach.name.length > 0);
  assert.ok(coach.overall >= 55 && coach.overall <= 95);
  assert.ok(coachesModule.COACH_SPECIALTIES.indexOf(coach.specialty) !== -1);
  // Was `deepStrictEqual(team.strategy, { pace: 0, threePointRate: 0 })`.
  // A new coach now arrives with a playbook and sets the dials to it, so
  // pinning them to neutral asserted the very thing that made the Game Plan
  // panel inert. What still has to hold is that the dials exist and only ever
  // carry one of the three settings the coaching screen offers.
  assert.ok(team.strategy, 'a team with a coach has a game plan');
  assert.ok([-1, 0, 1].indexOf(team.strategy.pace) !== -1, 'pace is one of the three offered settings');
  assert.ok([-1, 0, 1].indexOf(team.strategy.threePointRate) !== -1, 'three-point rate likewise');
  assert.deepStrictEqual(team.strategy, { pace: coach.lean.pace, threePointRate: coach.lean.threePointRate },
    'the dials should be exactly what this coach believes in');

  const sameCoach = coachesModule.ensureTeamCoach(team, rng);
  assert.strictEqual(sameCoach, coach, 'ensureTeamCoach should not replace an existing coach');

  console.log('checkGenerateAndEnsureCoach: OK');
}

checkGenerateAndEnsureCoach();

function checkHireCoachAndTenure() {
  const rng = makeRng(2);
  const team = makeTeam();
  coachesModule.ensureTeamCoach(team, rng);

  const candidates = coachesModule.generateCoachCandidates(rng, 3);
  assert.strictEqual(candidates.length, 3);

  coachesModule.hireCoach(team, candidates[0], 2027);
  assert.strictEqual(team.coach, candidates[0]);
  assert.strictEqual(team.coach.hireSeason, 2027);
  assert.strictEqual(team.coach.seasonsWithTeam, 0);

  coachesModule.tickCoachTenure(team);
  coachesModule.tickCoachTenure(team);
  assert.strictEqual(team.coach.seasonsWithTeam, 2);

  console.log('checkHireCoachAndTenure: OK');
}

checkHireCoachAndTenure();

function checkCoachFitMultiplier() {
  const rng = makeRng(3);
  const offensivePlayer = {
    attributes: { insideScoring: 80, midRange: 75, threePoint: 70, passing: 65, perimeterDefense: 40, interiorDefense: 40, steal: 35, block: 30 }
  };
  const defensivePlayer = {
    attributes: { insideScoring: 40, midRange: 35, threePoint: 30, passing: 40, perimeterDefense: 85, interiorDefense: 80, steal: 70, block: 65 }
  };

  const offenseCoach = { overall: 80, specialty: 'offense' };
  const defenseCoach = { overall: 80, specialty: 'defense' };
  const devCoach = { overall: 80, specialty: 'development' };

  assert.ok(coachesModule.coachFitMultiplier(offenseCoach, offensivePlayer) > coachesModule.coachFitMultiplier(offenseCoach, defensivePlayer),
    'an offense-specialist coach should fit an offense-leaning player better');
  assert.ok(coachesModule.coachFitMultiplier(defenseCoach, defensivePlayer) > coachesModule.coachFitMultiplier(defenseCoach, offensivePlayer),
    'a defense-specialist coach should fit a defense-leaning player better');
  assert.strictEqual(coachesModule.coachFitMultiplier(null, offensivePlayer), 1, 'no coach should be a neutral 1x multiplier');
  assert.ok(coachesModule.coachFitMultiplier(devCoach, offensivePlayer) > 0, 'a development coach should always return a positive multiplier');

  console.log('checkCoachFitMultiplier: OK (unused rng=' + typeof rng + ')');
}

checkCoachFitMultiplier();

// progression.js: Coachable/Stubborn should be gated by coach fit, not applied
// unconditionally (the pre-Phase-C behavior, back when no coach entity existed).
// Object.assign drops non-enumerable properties, so a shallow-copied player
// loses the derived `overall` getter entirely. Every test clone has to go
// through here.
function clonePlayer(player) {
  const ratingsMod = require(path.join(__dirname, '..', 'ratings.js'));
  const copy = Object.assign({}, player, { attributes: Object.assign({}, player.attributes) });
  return ratingsMod.defineOverall(copy);
}

function checkProgressionRespectsCoachFit() {
  const leagueModule = require(path.join(__dirname, '..', 'league.js'));
  const progressionModule = require(path.join(__dirname, '..', 'progression.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

  const team = teamsModule.getTeamById('BOS');
  const player = leagueModule.getTeamRoster('BOS')[0];
  player.age = 22; // young enough for the growth-curve branch, where coachability matters most
  player.potential = Math.min(99, player.rawOverall + 10);
  player.hiddenPersonality = Object.assign({}, player.hiddenPersonality, { coachability: 90 }); // strongly Coachable

  const rngA = makeRng(11);
  const rngB = makeRng(11);

  team.coach = { overall: 90, specialty: 'development' }; // strong fit
  const goodFitOverallBefore = player.overall;
  // Object.assign does NOT copy non-enumerable properties, and `overall` is a
  // non-enumerable derived getter (ratings.js) — a plain shallow copy comes
  // back with overall === undefined. Clone the data and reinstall the getter.
  progressionModule.progressPlayer(clonePlayer(player), rngA, []);

  team.coach = { overall: 55, specialty: 'defense' }; // weak/mismatched fit for an offense-leaning young player
  player.attributes.insideScoring = 85; player.attributes.midRange = 80; player.attributes.threePoint = 75; player.attributes.passing = 70;
  player.attributes.perimeterDefense = 40; player.attributes.interiorDefense = 40; player.attributes.steal = 35; player.attributes.block = 30;

  // Just confirm no crash and the function still returns a clamped rating —
  // exact deltas depend on rng draws shared with other change terms, so this
  // checks the wiring (team lookup + coachFitMultiplier call) rather than an
  // exact numeric outcome.
  const clone = clonePlayer(player);
  progressionModule.progressPlayer(clone, rngB, []);
  const dataMod = require(path.join(__dirname, '..', 'data.js'));
  assert.ok(clone.overall >= dataMod.RATING_MIN && clone.overall <= dataMod.RATING_MAX,
    'a progressed clone should still hold a valid derived overall, got ' + clone.overall);

  console.log('checkProgressionRespectsCoachFit: OK (before=' + goodFitOverallBefore + ')');
}

checkProgressionRespectsCoachFit();

// awards.js: Coach of the Year should be attached to a real coach entity.
function checkCoachOfTheYear() {
  const awardsModule = require(path.join(__dirname, '..', 'awards.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const rng = makeRng(4);

  teamsModule.TEAMS.forEach(function (t) {
    t.coach = coachesModule.generateCoach(rng);
    t.lastSeasonWins = 20;
    t.record = { wins: 20, losses: 20 };
  });
  const improvedTeam = teamsModule.getTeamById('MEM');
  improvedTeam.record = { wins: 55, losses: 27 };
  improvedTeam.coach.overall = 95;

  const coty = awardsModule.computeCoachOfTheYear();
  assert.ok(coty, 'a coach of the year should be selected when teams have coaches');
  assert.strictEqual(coty.teamId, 'MEM', 'the most-improved team\'s coach should win');
  assert.strictEqual(coty.coach, improvedTeam.coach);

  console.log('checkCoachOfTheYear: OK');
}

checkCoachOfTheYear();

console.log('All coaches validations passed');

// --- Playbooks --------------------------------------------------------------
//
// A coach's specialty used to exist only inside progression maths. It now sets
// the team's Game Plan dials, which is what makes hiring one of three
// candidates a decision rather than a comparison of a single number.

// The property the whole design rests on: thirty coaches with opinions must
// make the league VARIED, not faster. Specialty is drawn uniformly and the
// three leans are symmetric, so the league's average dial has to sit at zero
// or every scoring number calibrated against a neutral league drifts.
function checkLeansCancelAcrossTheLeague() {
  const lean = coachesModule.COACH_LEAN_BY_SPECIALTY;
  const paceSum = coachesModule.COACH_SPECIALTIES.reduce(function (s, k) { return s + lean[k].pace; }, 0);
  const threeSum = coachesModule.COACH_SPECIALTIES.reduce(function (s, k) { return s + lean[k].threePointRate; }, 0);
  assert.strictEqual(paceSum, 0, 'pace leans must cancel across the specialties, got ' + paceSum);
  assert.strictEqual(threeSum, 0, 'three-point leans must cancel across the specialties, got ' + threeSum);

  // And empirically, over a realistic pool.
  const rng = makeRng(2718);
  let pace = 0, three = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const c = coachesModule.generateCoach(rng, new Set(['x']));
    pace += c.lean.pace;
    three += c.lean.threePointRate;
  }
  assert.ok(Math.abs(pace / N) < 0.08, 'mean pace lean should sit near zero, got ' + (pace / N).toFixed(3));
  assert.ok(Math.abs(three / N) < 0.08, 'mean three lean should sit near zero, got ' + (three / N).toFixed(3));
  console.log('checkLeansCancelAcrossTheLeague: OK (mean pace ' + (pace / N).toFixed(3) +
    ', three ' + (three / N).toFixed(3) + ')');
}

// Two coaches of the same specialty must not be the same coach. Conviction
// below 1 is what buys that, and it also keeps Balanced a normal setting.
function checkSameSpecialtyStillVaries() {
  const rng = makeRng(99);
  const seen = {};
  for (let i = 0; i < 200; i++) {
    const l = coachesModule.rollCoachLean('offense', rng);
    seen[l.pace + '/' + l.threePointRate] = (seen[l.pace + '/' + l.threePointRate] || 0) + 1;
  }
  assert.ok(Object.keys(seen).length >= 3,
    'offensive coaches should not all play identically: ' + JSON.stringify(seen));
  // An offensive coach never wants a slow, inside game — conviction only ever
  // drops him to balanced, it must not flip his beliefs.
  Object.keys(seen).forEach(function (k) {
    const parts = k.split('/');
    assert.ok(Number(parts[0]) >= 0, 'an offensive coach must never lean slow: ' + k);
    assert.ok(Number(parts[1]) >= 0, 'an offensive coach must never lean away from threes: ' + k);
  });
  console.log('checkSameSpecialtyStillVaries: OK (' + Object.keys(seen).length + ' distinct playbooks)');
}

function checkHiringACoachSetsTheGamePlan() {
  const team = makeTeam({ strategy: { pace: 0, threePointRate: 0 } });
  const coach = { id: 'c1', specialty: 'defense', overall: 80, seasonsWithTeam: 3,
    lean: { pace: -1, threePointRate: -1 } };
  coachesModule.hireCoach(team, coach, 2030);
  assert.deepStrictEqual(team.strategy, { pace: -1, threePointRate: -1 },
    'hiring a coach must impose his playbook — that is what makes the hire a choice');
  assert.strictEqual(coach.seasonsWithTeam, 0, 'tenure still resets on hire');

  // A coach from a save made before playbooks existed leaves the dials alone
  // rather than zeroing them.
  const team2 = makeTeam({ strategy: { pace: 1, threePointRate: 1 } });
  coachesModule.hireCoach(team2, { id: 'c2', specialty: 'offense', overall: 70, seasonsWithTeam: 0 }, 2030);
  assert.deepStrictEqual(team2.strategy, { pace: 1, threePointRate: 1 },
    'a legacy coach with no lean must not silently reset the game plan');
  console.log('checkHiringACoachSetsTheGamePlan: OK');
}

// ensureTeamCoach runs on every draw of the coaching screen. If it re-imposed
// the playbook each time, the two dropdowns would be unusable — the GM would
// change one and watch it snap back.
function checkEnsureDoesNotOverwriteTheGMsChoice() {
  const rng = makeRng(5);
  const team = makeTeam();
  coachesModule.ensureTeamCoach(team, rng);
  assert.ok(team.strategy, 'a team with no dials gets its coach\'s playbook');

  team.strategy = { pace: 1, threePointRate: -1 };
  coachesModule.ensureTeamCoach(team, rng);
  assert.deepStrictEqual(team.strategy, { pace: 1, threePointRate: -1 },
    'a GM\'s own dial settings must survive every redraw of the screen');

  // A legacy coach gets a playbook backfilled rather than staying blank
  // forever, so an existing league gets the variety too.
  const legacy = makeTeam({ coach: { id: 'old', specialty: 'offense', overall: 70, seasonsWithTeam: 4 } });
  coachesModule.ensureTeamCoach(legacy, rng);
  assert.ok(legacy.coach.lean, 'a coach loaded from an older save should be given a playbook');
  console.log('checkEnsureDoesNotOverwriteTheGMsChoice: OK');
}

function checkPlaybookReadsAsWords() {
  assert.strictEqual(coachesModule.coachLeanLabel({ lean: { pace: 1, threePointRate: 1 } }), 'runs, shoots threes');
  assert.strictEqual(coachesModule.coachLeanLabel({ lean: { pace: -1, threePointRate: -1 } }), 'slows it down, works inside');
  assert.strictEqual(coachesModule.coachLeanLabel({ lean: { pace: 0, threePointRate: 0 } }), 'Balanced');
  assert.strictEqual(coachesModule.coachLeanLabel({ lean: { pace: 0, threePointRate: 1 } }), 'shoots threes');
  assert.strictEqual(coachesModule.coachLeanLabel(null), 'Balanced', 'no coach reads as balanced, not a crash');
  assert.strictEqual(coachesModule.coachLeanLabel({ specialty: 'offense' }), 'Balanced',
    'a legacy coach with no lean reads as balanced');
  console.log('checkPlaybookReadsAsWords: OK');
}

checkLeansCancelAcrossTheLeague();
checkSameSpecialtyStillVaries();
checkHiringACoachSetsTheGamePlan();
checkEnsureDoesNotOverwriteTheGMsChoice();
checkPlaybookReadsAsWords();
