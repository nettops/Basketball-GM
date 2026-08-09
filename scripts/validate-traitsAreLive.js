// THE TRIPWIRE. The bug this exists for is not "defense is unwired" — it is
// "a trait family can be silently dead and nothing notices". Fifteen traits sat
// dead through seven calibration tasks without a single test complaining,
// because every test asserted on league rates and a dead trait moves no rate.
//
// For each (system, stat) family in the taxonomy, give ONE player a legendary
// trait from that family and assert their own line moves against a seed-matched
// control. Byte-identical output means the code path never consulted the trait.
//
// NO EXEMPTIONS. The family list is derived from TRAIT_TAXONOMY itself, so a
// family cannot be dropped from coverage by deleting a row here, and a family
// added to the taxonomy is covered the day it appears.
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
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const fatigue = require(path.join(__dirname, '..', 'fatigue.js'));
const injuries = require(path.join(__dirname, '..', 'injuries.js'));
const progression = require(path.join(__dirname, '..', 'progression.js'));
const ratings = require(path.join(__dirname, '..', 'ratings.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));

const SUBJECT_TEAM = 'BOS';
const GAMES = 400;
const SEED = 31337;

// EACH FAMILY NEEDS THE RIGHT PROBE. An earlier draft of this file measured
// every family through a season's box-score lines, which would have reported
// injury, fatigue and progression as DEAD — not because they are unwired, but
// because none of them writes a box-score stat. A test that cannot observe a
// system will always call it dead, and "the test was looking in the wrong
// place" is indistinguishable from a real bug until someone checks.
//
// So each family declares HOW it is observed. Box-score families share the
// season probe; the rest are measured where they actually act.
// Keyed by "system/stat" first, falling back to bare "system". Progression needs
// the finer key because its two families act on DIFFERENT PLAYERS — self on the
// carrier, teammate on everyone young around them — and one probe cannot see
// both.
const PROBES = {
  'progression/self': 'progressionSelf',
  'progression/teammate': 'progressionTeammate',
  boxscore: 'season',
  fatigue: 'fatigue',
  injury: 'injury',
  chemistry: 'season'         // reaches the sim through team synergy
};

// Every distinct (system, stat) pair the taxonomy declares, each paired with a
// representative trait key. Derived, not hand-listed, so a family added to the
// taxonomy is covered the day it appears and fails until it is wired.
function familiesFromTaxonomy() {
  const byFamily = {};
  traits.TRAIT_TAXONOMY.forEach(function (t) {
    const key = t.effect.system + '/' + t.effect.stat;
    // Prefer a POSITIVE trait as the representative: a negative one proves the
    // same wiring but reads confusingly in a failure message.
    if (!byFamily[key] || (byFamily[key].direction < 0 && t.effect.direction > 0)) {
      byFamily[key] = { key: t.key, name: t.name, direction: t.effect.direction, system: t.effect.system };
    }
  });
  return byFamily;
}

// A mid-rotation player has room to move in both directions; the best player on
// the roster already takes every shot and the worst never plays.
function pickSubject() {
  return league.getTeamRoster(SUBJECT_TEAM)
    .slice().sort(function (a, b) { return b.overall - a.overall; })[4];
}

function withTrait(subject, traitKey, fn) {
  const saved = subject.hiddenTraits;
  subject.hiddenTraits = traitKey === null ? [] : [{ key: traitKey, tier: 'legendary' }];
  try { return fn(); } finally { subject.hiddenTraits = saved; }
}

// Box-score probe: the subject's own season line.
function probeSeason(subject) {
  const rng = makeRng(SEED);
  const t = { min: 0, pts: 0, fga: 0, fgm: 0, ast: 0, reb: 0, stl: 0, blk: 0, oppFga: 0, oppFgm: 0, fouls: 0 };
  const FIELD = { min: 'minutes', pts: 'points', ast: 'assists', reb: 'rebounds', stl: 'steals', blk: 'blocks' };
  let games = 0;
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length], away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    if (home.id !== SUBJECT_TEAM && away.id !== SUBJECT_TEAM) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    const l = r.boxScore[subject.id];
    if (!l) continue;
    games += 1;
    Object.keys(t).forEach(function (k) { t[k] += l[FIELD[k] || k] || 0; });
  }
  t.games = games;
  return t;
}

// Fatigue probe: run one team-game of fatigue accumulation and read the result.
function probeFatigue(subject) {
  const saved = subject.status.fatigue;
  subject.status.fatigue = 0;
  const minutes = {};
  league.getTeamRoster(SUBJECT_TEAM).forEach(function (p) { minutes[p.id] = 30; });
  fatigue.applyFatigueForGame(SUBJECT_TEAM, minutes, false);
  const out = { fatigue: subject.status.fatigue };
  subject.status.fatigue = saved;
  return out;
}

// Injury probe: injuries are rare, so roll many times at a fixed seed and count.
// Both chance and recovery show up here — chance in how many injuries land,
// recovery in how long they last.
function probeInjury(subject) {
  const rng = makeRng(SEED);
  const savedInjury = subject.status.injury;
  let count = 0, totalGamesOut = 0;
  for (let i = 0; i < 40000; i++) {
    subject.status.injury = null;
    injuries.rollInjury(subject, rng);
    if (subject.status.injury) {
      count += 1;
      totalGamesOut += Math.min(200, subject.status.injury.gamesRemaining);
    }
  }
  subject.status.injury = savedInjury;
  return { injuries: count, gamesOut: totalGamesOut };
}

// Progression needs MANY TRIALS, not one. The trait adds bonus*0.3 to a change
// that is then distributed across attributes and rounded, so a single offseason
// can round to exactly zero and read as dead. The first draft of this file did
// exactly that and reported progression/self as unwired — it is not, and
// scripts/validate-traits.js's checkProgressionTraitIntegration has covered it
// all along with 200 trials. Copied that shape rather than inventing another.
const PROGRESSION_TRIALS = 200;

// `overall` is derived from the attributes (ratings.js). A plain literal would
// be frozen, and progressPlayer reads it for the potential pull.
function freshDevelopmentPlayer(age, hiddenTraits) {
  const p = { age: age, yearsPro: 2, potential: 80, teamId: null, status: { morale: 70, fatigue: 0, injury: null },
    attributes: {}, hiddenTraits: hiddenTraits, hiddenPersonality: {} };
  ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 70; });
  return ratings.defineOverall(p);
}

function sumAttributes(p) {
  let sum = 0;
  ATTRIBUTE_KEYS.forEach(function (k) { sum += p.attributes[k]; });
  return sum;
}

// self: the trait is on the developing player.
function probeProgressionSelf(subject) {
  const rng = makeRng(SEED);
  let total = 0;
  for (let i = 0; i < PROGRESSION_TRIALS; i++) {
    const p = freshDevelopmentPlayer(22, subject.hiddenTraits);
    const before = sumAttributes(p);
    progression.progressPlayer(p, rng, []);
    total += sumAttributes(p) - before;
  }
  return { growth: total };
}

// teammate: the trait is on SOMEONE ELSE, and only helps players aged <= 25.
// Putting it on the subject with no teammates — as the first draft did — means
// it can never fire, which looks exactly like dead code.
function probeProgressionTeammate(subject) {
  const rng = makeRng(SEED);
  const mentor = freshDevelopmentPlayer(30, subject.hiddenTraits);
  let total = 0;
  for (let i = 0; i < PROGRESSION_TRIALS; i++) {
    const young = freshDevelopmentPlayer(21, []);
    const before = sumAttributes(young);
    progression.progressPlayer(young, rng, [mentor]);
    total += sumAttributes(young) - before;
  }
  return { growth: total };
}

const PROBE_FN = {
  season: probeSeason,
  fatigue: probeFatigue,
  injury: probeInjury,
  progressionSelf: probeProgressionSelf,
  progressionTeammate: probeProgressionTeammate
};

function checkEveryFamilyIsLive() {
  const subject = pickSubject();
  const families = familiesFromTaxonomy();
  const dead = [];
  const live = [];

  Object.keys(families).sort().forEach(function (family) {
    const rep = families[family];
    const probeName = PROBES[family] || PROBES[rep.system];
    assert.ok(probeName, 'no probe declared for system "' + rep.system +
      '" — a new trait system needs a way to observe it, or this test cannot tell wired from dead');
    const probe = PROBE_FN[probeName];

    const control = withTrait(subject, null, function () { return probe(subject); });
    const treated = withTrait(subject, rep.key, function () { return probe(subject); });
    const moved = Object.keys(control).some(function (k) {
      return k !== 'games' && Math.abs(treated[k] - control[k]) > 1e-9;
    });
    if (moved) live.push(family); else dead.push(family + ' (' + rep.name + ', probe: ' + probeName + ')');
  });

  assert.strictEqual(dead.length, 0,
    dead.length + ' trait families are byte-identical to no-trait — the traits exist, ' +
    'the sim never reads them:\n  ' + dead.join('\n  '));
  console.log('checkEveryFamilyIsLive: OK (' + live.length + ' families, subject ' + subject.name + ')');
}

checkEveryFamilyIsLive();
console.log('All traits-are-live validations passed');
