const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

// Plus/minus is the value signal the derived `overall` is fitted against
// (scripts/fit-overall.js). A box score cannot see defense, which is why
// ZenGM regresses its ovr against plus/minus per minute rather than against
// production — see reference/zengm/analysis/player-ovr-basketball/process.py.
// If plus/minus does not balance, that fit is measuring noise.
function checkPlusMinusBalances() {
  const rng = makeRng(31);
  let games = 0;
  for (let i = 0; i < 12; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 9) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = gameSim.simulateGame(home.id, away.id, rng);
    games += 1;

    const side = {};
    league.getTeamRoster(home.id).forEach(function (p) { side[p.id] = 'home'; });
    league.getTeamRoster(away.id).forEach(function (p) { side[p.id] = 'away'; });

    let homePm = 0, awayPm = 0, played = 0;
    Object.keys(result.boxScore).forEach(function (id) {
      const line = result.boxScore[id];
      assert.ok(typeof line.plusMinus === 'number',
        'every box-score line needs a numeric plusMinus, missing for ' + id);
      if (line.minutes > 0) played += 1;
      if (side[id] === 'home') homePm += line.plusMinus;
      if (side[id] === 'away') awayPm += line.plusMinus;
    });

    assert.ok(played >= 10, 'at least both fives should have played, got ' + played);
    // Five players are on the floor for every point scored, so a team's summed
    // plus/minus is exactly five times its final margin. That identity is what
    // makes this a real check rather than a smoke test: it fails if the credit
    // goes to the wrong five, the wrong sign, or the post-substitution lineup.
    const margin = result.homeScore - result.awayScore;
    assert.strictEqual(homePm, 5 * margin,
      'home plus/minus should be 5x the margin, got ' + homePm + ' vs ' + (5 * margin));
    assert.strictEqual(awayPm, -5 * margin,
      'away plus/minus should be -5x the margin, got ' + awayPm + ' vs ' + (-5 * margin));
  }
  console.log('checkPlusMinusBalances: OK (' + games + ' games)');
}

// The league must contain individuals, not 8 archetypes at different scales.
// Before the rescale this was 17 shapes across 380 players: makeAttributes was
// literally `overall + archetypeOffset[key]`, so two players with the same
// overall and archetype were byte-identical, and `threePoint - insideScoring`
// — the number that governs shot mix — took 9 distinct values league-wide.
// Every compressed spread in docs/superpowers/identity-baseline.txt is
// downstream of this one fact.
function checkPlayersAreIndividuals() {
  const seen = {};
  PLAYERS_2026.forEach(function (p) {
    const mean = ATTRIBUTE_KEYS.reduce(function (s, k) { return s + p.attributes[k]; }, 0) / ATTRIBUTE_KEYS.length;
    seen[ATTRIBUTE_KEYS.map(function (k) { return Math.round(p.attributes[k] - mean); }).join(',')] = true;
  });
  const shapes = Object.keys(seen).length;
  assert.ok(shapes >= PLAYERS_2026.length * 0.97,
    'attribute shapes should be nearly all distinct, got ' + shapes + ' for ' + PLAYERS_2026.length + ' players');
  console.log('checkPlayersAreIndividuals: OK (' + shapes + '/' + PLAYERS_2026.length + ' distinct)');
}

// Every downstream formula is written against a scale where 50 is average —
// shotMakeProbability's `(composite - 50) / 250`, turnoverChance's `/ 400`,
// blockChance's `(block - 50) / 900`. Before the rescale the attributes lived
// in 48-99 with a mean of 74.2, so all of those were being read at the wrong
// point on their own curves. The offensive and defensive inflations happened
// to cancel in aggregate, which is why nothing looked broken.
function checkRatingsUseTheWholeScale() {
  const all = [];
  PLAYERS_2026.forEach(function (p) {
    ATTRIBUTE_KEYS.forEach(function (k) { all.push(p.attributes[k]); });
  });
  const mean = all.reduce(function (a, b) { return a + b; }, 0) / all.length;
  const sd = Math.sqrt(all.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / all.length);
  assert.ok(mean >= 44 && mean <= 56, 'league attribute mean should be near 50, got ' + mean.toFixed(1));
  assert.ok(sd >= 11 && sd <= 18, 'league attribute sd should be 11-18, got ' + sd.toFixed(1));
  assert.ok(Math.min.apply(null, all) <= 20,
    'somebody should be genuinely bad at something, league min was ' + Math.min.apply(null, all));
  assert.ok(Math.max.apply(null, all) >= 90,
    'somebody should be genuinely elite at something, league max was ' + Math.max.apply(null, all));
  console.log('checkRatingsUseTheWholeScale: OK (mean ' + mean.toFixed(1) + ', sd ' + sd.toFixed(1) +
    ', range ' + Math.min.apply(null, all) + '-' + Math.max.apply(null, all) + ')');
}

// Generation must be a pure function of the player's id. Attributes seeded
// from a shared or ambient rng would make the league different on every load,
// which silently invalidates saves and both golden masters.
function checkGenerationIsDeterministic() {
  const modPath = require.resolve(path.join(__dirname, '..', 'players-2026.js'));
  delete require.cache[modPath];
  const second = require(modPath).PLAYERS_2026;
  assert.strictEqual(second.length, PLAYERS_2026.length, 'regeneration changed the roster size');
  for (let i = 0; i < second.length; i++) {
    assert.strictEqual(second[i].id, PLAYERS_2026[i].id, 'regeneration reordered the roster');
    ATTRIBUTE_KEYS.forEach(function (k) {
      assert.strictEqual(second[i].attributes[k], PLAYERS_2026[i].attributes[k],
        'regeneration changed ' + second[i].id + '.' + k);
    });
  }
  console.log('checkGenerationIsDeterministic: OK');
}

// Synergy exists to reward roster CONSTRUCTION — stacking shooters compounds
// floor spacing. If most of the league clears every bar it cannot distinguish
// anything: at baseline 65.5% of players counted as shooters, 76.3% as
// defenders and 70.8% as rebounders. Tested against computeTeamSynergy's own
// ORs, not a single composite, because the ORs are what actually fire.
function checkSynergyThresholdsAreSelective() {
  const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));
  const c = function (p, k) { return composite.computeComposite(p, k); };
  const groups = {
    shooter: PLAYERS_2026.filter(function (p) {
      return c(p, 'shootingThree') >= composite.SHOOTER_THRESHOLD ||
             c(p, 'shootingMid') >= composite.SHOOTER_THRESHOLD;
    }).length,
    defender: PLAYERS_2026.filter(function (p) {
      return c(p, 'defenseInterior') >= composite.DEFENDER_THRESHOLD ||
             c(p, 'defensePerimeter') >= composite.DEFENDER_THRESHOLD;
    }).length,
    rebounder: PLAYERS_2026.filter(function (p) {
      return c(p, 'rebounding') >= composite.REBOUNDER_THRESHOLD;
    }).length
  };
  Object.keys(groups).forEach(function (k) {
    const share = groups[k] / PLAYERS_2026.length;
    assert.ok(share >= 0.10 && share <= 0.32,
      k + ' threshold selects ' + (share * 100).toFixed(1) + '% of the league, want 10-32%');
  });
  console.log('checkSynergyThresholdsAreSelective: OK (' +
    Object.keys(groups).map(function (k) {
      return k + ' ' + (groups[k] / PLAYERS_2026.length * 100).toFixed(1) + '%';
    }).join(', ') + ')');
}

// `overall` must be a pure function of the attributes. It used to be a stored
// field that progression updated separately, and it drifted up to 7.3 points
// away from what the attributes supported over 12 seasons — while
// simEngineBoxScore's minutesWeight read `overall` and every other weight read
// attributes, so a drifted player drew star minutes with role-player skills.
function checkOverallIsDerived() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const p = PLAYERS_2026[0];
  const before = p.overall;
  const original = p.attributes.threePoint;
  p.attributes.threePoint = Math.min(100, original + 25);
  assert.notStrictEqual(p.overall, before,
    'overall must react to an attribute change; it is still a stored field');
  p.attributes.threePoint = original;
  assert.strictEqual(p.overall, before, 'overall must return to its prior value');
  assert.strictEqual(p.overall, ratings.computeOverall(p),
    'p.overall and computeOverall must agree');

  // Assignment has to FAIL LOUDLY. A getter with no setter is a silent no-op in
  // sloppy mode, which is worse than the bug being fixed — six call sites in
  // this codebase were assigning to overall.
  assert.throws(function () { p.overall = 99; }, /cannot be assigned/,
    'assigning to overall must throw rather than silently do nothing');

  // And it must never be serialised, or a loaded save carries a frozen value
  // that never updates again — the stored-overall bug through the back door.
  assert.strictEqual(JSON.parse(JSON.stringify(p)).overall, undefined,
    'overall must be non-enumerable so it never round-trips through a save');
  console.log('checkOverallIsDerived: OK');
}

// Progression must not be able to separate them, however many seasons run.
function checkOverallNeverDriftsFromAttributes() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  require(path.join(__dirname, '..', 'coaches.js'));
  const prog = require(path.join(__dirname, '..', 'progression.js'));
  const rng = makeRng(777);
  // Deep-copying through JSON drops the getter (it is non-enumerable), which is
  // exactly what a save does — so reinstalling it here also exercises the
  // rehydration path save.js depends on.
  const players = JSON.parse(JSON.stringify(PLAYERS_2026)).map(function (p) {
    return ratings.defineOverall(p);
  });
  for (let y = 0; y < 12; y++) {
    players.forEach(function (p) { if (p.age < 38) prog.progressPlayer(p, rng, [], {}); });
  }
  let worst = 0;
  players.forEach(function (p) {
    worst = Math.max(worst, Math.abs(p.overall - ratings.computeOverall(p)));
    assert.ok(p.potential >= p.overall,
      'potential must stay >= overall through progression for ' + p.id +
      ' (' + p.potential + ' vs ' + p.overall + ')');
  });
  assert.strictEqual(worst, 0,
    'overall cannot drift from the attributes; worst divergence after 12 seasons was ' + worst);
  console.log('checkOverallNeverDriftsFromAttributes: OK (12 seasons, zero drift)');
}

// Added because a mutation SURVIVED: zeroing the headroom conversion in
// players-2026.js left every check in this file green. Young players have to
// carry real room above their current overall, because progression pulls them
// toward it — with no headroom nobody develops, and three development
// validators fail while the file that owns the derivation says nothing.
function checkYoungPlayersHaveHeadroom() {
  const young = PLAYERS_2026.filter(function (p) { return p.age <= 23; });
  assert.ok(young.length >= 20, 'expected a meaningful under-24 population, got ' + young.length);
  const gaps = young.map(function (p) { return p.potential - p.overall; })
    .sort(function (a, b) { return a - b; });
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(median >= 5,
    'the median under-24 player needs real room to grow into, median headroom was ' + median);
  const withRoom = PLAYERS_2026.filter(function (p) { return p.potential > p.overall; }).length;
  assert.ok(withRoom >= PLAYERS_2026.length * 0.4,
    'a good share of the league should still be improvable, got ' + withRoom + '/' + PLAYERS_2026.length);
  PLAYERS_2026.forEach(function (p) {
    assert.ok(p.potential >= p.overall,
      'potential must never sit below overall for ' + p.id);
  });
  console.log('checkYoungPlayersHaveHeadroom: OK (median under-24 headroom ' + median +
    ', ' + withRoom + '/' + PLAYERS_2026.length + ' improvable)');
}

// The fit has to be worth having. Measured against the sim's own plus/minus per
// minute on SCRAMBLED rosters, which is the only way the signal is legible:
// with real rotations, even the old stored overall — the number the attributes
// were generated from — reached only r=0.372, because good players always share
// a floor and a player's plus/minus is mostly his teammates'. ZenGM hit the same
// wall and solved it the same way, with elevated injuries for lineup variety.
//
// The 0.6 bar is the FIT's quality, not a number chosen to pass: the full fit
// (1800 games, 400-minute floor) measures 0.823, and r here is sample-limited
// rather than fit-limited. Measured convergence, so the game count below is
// justified rather than picked -- 240 games/120min 0.451, 240/300 0.501,
// 480/300 0.578, 480/500 0.605, 900/500 0.693. 480 games at a 500-minute floor
// is the cheapest point that clears the real bar.
function checkOverallPredictsProduction() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const rng = makeRng(2026);
  const byId = {};
  PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
  const originalTeam = {};
  PLAYERS_2026.forEach(function (p) { originalTeam[p.id] = p.teamId; });

  function scramble() {
    const pool = PLAYERS_2026.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    pool.forEach(function (p, i) { p.teamId = TEAMS[i % TEAMS.length].id; });
  }

  const acc = {};
  for (let i = 0; i < 960; i++) {
    if (i % 30 === 0) scramble();
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      const q = acc[id] || (acc[id] = { min: 0, pm: 0 });
      q.min += l.minutes; q.pm += (l.plusMinus || 0);
    });
  }
  PLAYERS_2026.forEach(function (p) { p.teamId = originalTeam[p.id]; });

  const ids = Object.keys(acc).filter(function (id) { return byId[id] && acc[id].min >= 800; });
  const x = ids.map(function (id) { return ratings.computeOverall(byId[id]); });
  const y = ids.map(function (id) { return acc[id].pm / acc[id].min; });
  const n = x.length;
  const mx = x.reduce(function (a, b) { return a + b; }, 0) / n;
  const my = y.reduce(function (a, b) { return a + b; }, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) * (x[i] - mx);
    syy += (y[i] - my) * (y[i] - my);
  }
  const r = sxy / Math.sqrt(sxx * syy);
  assert.ok(n >= 100, 'need a real sample, got ' + n);
  assert.ok(r >= 0.6, 'overall should predict plus/minus per minute, r was ' + r.toFixed(3));
  console.log('checkOverallPredictsProduction: OK (r ' + r.toFixed(3) + ', n ' + n + ')');
}

// The assertion this file was MISSING. Deriving `overall` moved its mean from
// 74.7 to 47.8, and simEngineBoxScore's minutesWeight still subtracted a hard
// 40 — so the base collapsed from ~35 to ~8 and went negative for the bottom
// quarter of the league, where max(1, ...) flattened 104 players onto an
// identical weight of 1. gameCoach.rotationRanks and gameSim's starter pick
// both SORT by this, so a quarter of the league was ordered arbitrarily and 36
// of those players sat inside a ten-man rotation.
//
// Nothing here asserted that a value DOWNSTREAM of overall still had a usable
// range. That is the same class as the blockChance and ftPct scale bugs, and
// this one got through. Checking the invariants rather than the constants:
// distinct inputs must give distinct weights, the spread must stay usable, and
// a trait must stay a modifier rather than becoming the whole number.
//
// Applied to EVERY weight in simEngineBoxScore, not just minutesWeight. All six
// share one shape — Math.max(1, <attribute base> + traitBonus) — so all six
// share the failure mode, and minutesWeight was only the one whose collapse was
// visible because rotation order is user-facing. Checking the survivor and not
// its five identical siblings is how the next one gets through.
//
// Mirrors simEngineBoxScore.js:68-113. The bases are restated here rather than
// imported because they are module-private; checkTheBasesStillMatch below fails
// loudly if the two ever drift, so a formula change cannot silently leave this
// check measuring a stale definition.
const DOWNSTREAM_WEIGHTS = [
  { name: 'scoringWeight', stat: 'scoring',
    base: function (p) { const a = p.attributes; return (a.insideScoring + a.midRange + a.threePoint + a.postScoring) / 4; } },
  { name: 'reboundWeight', stat: 'rebound',
    base: function (p) { const a = p.attributes; return (a.offReb + a.defReb) / 2; } },
  { name: 'assistWeight', stat: 'assist',
    base: function (p) { const a = p.attributes; return (a.passing + a.ballHandling) / 2; } },
  { name: 'stealWeight', stat: 'steal', base: function (p) { return p.attributes.steal; } },
  { name: 'blockWeight', stat: 'block', base: function (p) { return p.attributes.block; } },
  { name: 'minutesWeight', stat: 'usage', base: function (p) { return p.overall; } }
];

function checkDownstreamWeightsSurviveTheScale() {
  const box = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const traits = require(path.join(__dirname, '..', 'traits.js'));
  const N = PLAYERS_2026.length;
  const report = [];

  DOWNSTREAM_WEIGHTS.forEach(function (w) {
    const fn = box[w.name];
    assert.ok(typeof fn === 'function', w.name + ' is not exported from simEngineBoxScore');
    function bonus(p) { return traits.getTraitBonus(p, 'boxscore', w.stat); }
    const weights = PLAYERS_2026.map(fn);

    // 0. THE MECHANISM. max(1, ...) is a divide-by-zero guard for distributeInt,
    //    not a value-producing path — every player it catches is a player whose
    //    quality stopped being represented. That is precisely how the bug did
    //    its damage: at `overall - 40` it clamped 94 players onto the floor and
    //    104 onto a single weight. Measured across the whole healthy range this
    //    is flat zero (offsets 0 through 25 clamp nobody), and the mildest
    //    mutant that breaks it clamps 10, so the 1% bound sits 3.3x below the
    //    first real failure while leaving room for a genuine 0-attribute player.
    //
    //    This is the assertion the repo was missing. The ordering and tie checks
    //    below describe the SYMPTOM and only trip once the damage is broad; this
    //    one names the cause and trips as soon as the scale slips at all.
    const clamped = PLAYERS_2026.filter(function (p) { return w.base(p) + bonus(p) < 1; }).length;
    assert.ok(clamped <= N * 0.01,
      w.name + ': the max(1, ...) floor is clamping ' + clamped + ' players (' +
      (100 * clamped / N).toFixed(1) + '% of the league) — it is a guard, not a value, ' +
      'and everyone it catches has had their quality erased');

    // 1. MONOTONIC in the underlying skill, for players without the matching
    //    trait. A better player must never sort below a worse one. (A trait
    //    carrier legitimately jumps the queue — that is what the trait is for —
    //    so carriers are excluded rather than counted as failures. An earlier
    //    draft of this check flagged 80 players by counting every member of any
    //    weight group a carrier had landed in, which indicted the innocent.)
    const noTrait = PLAYERS_2026.filter(function (p) { return bonus(p) === 0; });
    let inverted = 0;
    for (let i = 0; i < noTrait.length; i++) {
      for (let j = 0; j < noTrait.length; j++) {
        if (w.base(noTrait[i]) > w.base(noTrait[j]) &&
            fn(noTrait[i]) <= fn(noTrait[j])) inverted += 1;
      }
    }
    assert.strictEqual(inverted, 0,
      w.name + ': ' + inverted + ' pairs of players sort in the wrong order relative to their skill');

    // 2. No mass flattening. The bug put 104 players — 27% of the league — onto
    //    a single weight, which is what made rotation order arbitrary. Ties
    //    between genuinely equal players are fine and unavoidable (attributes
    //    are integers across 380 players), so this bounds the largest tie
    //    rather than forbidding ties.
    const groups = {};
    weights.forEach(function (v) { groups[v] = (groups[v] || 0) + 1; });
    const biggest = Math.max.apply(null, Object.keys(groups).map(function (k) { return groups[k]; }));
    assert.ok(biggest <= N * 0.12,
      w.name + ': ' + biggest + ' players share one weight (' +
      (100 * biggest / N).toFixed(0) + '% of the league) — order is arbitrary among them');

    // 3. A trait is a modifier, not the number itself. A legendary usage trait
    //    adds +8; against a median weight of ~8 that was 103% of the player,
    //    which is what made the collapse visible. Read off the taxonomy rather
    //    than hard-coded, so retuning TRAIT_TIER_SCALE re-checks itself here
    //    instead of silently becoming dominant.
    const sorted = weights.slice().sort(function (a, b) { return a - b; });
    const median = sorted[Math.floor(sorted.length / 2)];
    let maxTier = 0;
    traits.TRAIT_TAXONOMY.forEach(function (t) {
      if (t.effect.system !== 'boxscore' || t.effect.stat !== w.stat) return;
      traits.TRAIT_TIERS.forEach(function (tier) {
        maxTier = Math.max(maxTier, Math.abs(t.tierValues[tier]));
      });
    });
    assert.ok(maxTier / median <= 0.45,
      w.name + ': the largest trait bonus is ' + (100 * maxTier / median).toFixed(0) +
      '% of the median weight — a modifier should not dominate the rating it modifies');

    report.push(w.name.replace('Weight', '') + ' ' + (100 * maxTier / median).toFixed(0) + '%');
  });

  // 4. minutesWeight ALONE carries a spread bound. simEngineBoxScore splits 240
  //    minutes with distributeInt in proportion to it, so too narrow and
  //    everyone plays the same minutes, too wide and the bench never plays. The
  //    other five are deliberately exempt: blockWeight legitimately spans 104x
  //    because a rim protector really does block two orders of magnitude more
  //    than a small guard, and bounding that would be asserting a preference,
  //    not an invariant.
  const mw = PLAYERS_2026.map(box.minutesWeight);
  const spread = Math.max.apply(null, mw) / Math.min.apply(null, mw);
  assert.ok(spread >= 1.8 && spread <= 4.5,
    'minutes-weight spread should be 1.8-4.5x (it was 2.64x before the rescale), got ' + spread.toFixed(2));

  console.log('checkDownstreamWeightsSurviveTheScale: OK (' + DOWNSTREAM_WEIGHTS.length +
    ' weights, 0 clamped, minutes spread ' + spread.toFixed(2) + 'x, max trait ' + report.join(' / ') + ')');
}

// The bases above are a hand-copy of module-private formulas, so they can rot.
// Wherever the floor is not in play the weight must equal base + bonus exactly;
// if simEngineBoxScore's formula changes and this table does not, every check
// that reads `base` starts measuring a definition the engine no longer uses —
// silently, and in the passing direction. This is the tripwire for that.
function checkTheBasesStillMatch() {
  const box = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  const traits = require(path.join(__dirname, '..', 'traits.js'));
  DOWNSTREAM_WEIGHTS.forEach(function (w) {
    const fn = box[w.name];
    PLAYERS_2026.forEach(function (p) {
      const raw = w.base(p) + traits.getTraitBonus(p, 'boxscore', w.stat);
      if (raw < 1) return;                       // floor legitimately in play
      assert.ok(Math.abs(fn(p) - raw) < 1e-9,
        w.name + ': validate-ratings\' copy of the base formula no longer matches ' +
        'simEngineBoxScore for ' + p.name + ' (' + fn(p) + ' vs ' + raw + ') — ' +
        'update DOWNSTREAM_WEIGHTS to match simEngineBoxScore.js');
    });
  });
  console.log('checkTheBasesStillMatch: OK (' + DOWNSTREAM_WEIGHTS.length + ' formulas mirror the engine)');
}

checkPlusMinusBalances();
checkTheBasesStillMatch();
checkDownstreamWeightsSurviveTheScale();
checkOverallIsDerived();
checkOverallNeverDriftsFromAttributes();
checkYoungPlayersHaveHeadroom();
checkOverallPredictsProduction();
checkPlayersAreIndividuals();
checkRatingsUseTheWholeScale();
checkGenerationIsDeterministic();
checkSynergyThresholdsAreSelective();

console.log('All ratings validations passed');
