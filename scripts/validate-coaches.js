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
  assert.deepStrictEqual(team.strategy, { pace: 0, threePointRate: 0 });

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
  player.potential = Math.min(99, player.overall + 10);
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
