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
  const youngProspect = { age: 20, overall: 65, potential: 88, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { youngProspect.attributes[k] = 65; });
  let totalChange = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const before = youngProspect.overall;
    progressionModule.progressPlayer(youngProspect, rng);
    totalChange += youngProspect.overall - before;
    youngProspect.overall = before; // reset for an independent trial
    youngProspect.age = 20;
  }
  assert.ok(totalChange / TRIALS > 0, 'a young player far below potential should trend upward on average');

  // A declining veteran should trend downward on average.
  const veteran = { age: 35, overall: 78, potential: 78, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { veteran.attributes[k] = 78; });
  let veteranChange = 0;
  for (let i = 0; i < TRIALS; i++) {
    const before = veteran.overall;
    progressionModule.progressPlayer(veteran, rng);
    veteranChange += veteran.overall - before;
    veteran.overall = before;
    veteran.age = 35;
  }
  assert.ok(veteranChange / TRIALS < 0, 'a 35-year-old should trend downward on average');

  // Invariant and range checks after a single real progression call.
  const p = { age: 24, overall: 90, potential: 90, attributes: {} };
  dataModule.ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 90; });
  progressionModule.progressPlayer(p, rng);
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
    pickValueModule.estimateFuturePickValue(15, rebuilding) > pickValueModule.estimateFuturePickValue(15, winNow),
    'the same future pick should be worth more owned by a rebuilding team than a win-now team'
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
console.log('All offseason validations passed');
