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
  assert.strictEqual(p.rawOverall, ratings.computeOverall(p),
    'p.rawOverall and computeOverall must agree');

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
    worst = Math.max(worst, Math.abs(p.rawOverall - ratings.computeOverall(p)));
    // Compared on the RAW scale, because `potential` is stored raw. Against
    // display `overall` this reads as potential below overall for every player
    // in the league — which is exactly the asymmetry potentialDisplay exists
    // to prevent leaking into the UI.
    assert.ok(p.potential >= p.rawOverall,
      'potential must stay >= rawOverall through progression for ' + p.id +
      ' (' + p.potential + ' vs ' + p.rawOverall + ')');
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
  const gaps = young.map(function (p) { return p.potential - p.rawOverall; })
    .sort(function (a, b) { return a - b; });
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(median >= 5,
    'the median under-24 player needs real room to grow into, median headroom was ' + median);
  const withRoom = PLAYERS_2026.filter(function (p) { return p.potential > p.rawOverall; }).length;
  assert.ok(withRoom >= PLAYERS_2026.length * 0.4,
    'a good share of the league should still be improvable, got ' + withRoom + '/' + PLAYERS_2026.length);
  PLAYERS_2026.forEach(function (p) {
    assert.ok(p.potential >= p.rawOverall,
      'potential must never sit below rawOverall for ' + p.id);
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
  // rawOverall, not overall. The display scale spans 1.58x where raw spans
  // 2.69x, so pointing this at display is exactly the range collapse the whole
  // check exists to catch — and it did catch it, on the commit that split them.
  { name: 'minutesWeight', stat: 'usage', base: function (p) { return p.rawOverall; } }
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

// Defensive badges buy ASSIGNMENTS as well as quality: a lockdown defender
// should draw the tough matchup more often, not merely be better when he
// happens to draw it. Without this the badges only ever act on shots the
// defender was already picked for, which is half a mechanic.
function checkDefensiveBadgesDrawAssignments() {
  const poss = require(path.join(__dirname, '..', 'simEnginePossession.js'));
  function makeDefender(hiddenTraits) {
    const p = { hiddenTraits: hiddenTraits, attributes: {} };
    ATTRIBUTE_KEYS.forEach(function (k) { p.attributes[k] = 60; });
    return p;
  }
  const base = makeDefender([]);
  const lockdown = makeDefender([{ key: 'lockdownDefender', tier: 'legendary' }]);

  assert.ok(poss.shotDefenseWeight(lockdown, 'three') > poss.shotDefenseWeight(base, 'three'),
    'a perimeter badge must raise the shot-defender pick weight on threes');
  assert.strictEqual(poss.shotDefenseWeight(lockdown, 'inside'), poss.shotDefenseWeight(base, 'inside'),
    'a PERIMETER badge must not raise the pick weight for inside shots');

  const stealer = makeDefender([{ key: 'pickpocket', tier: 'legendary' }]);
  assert.ok(poss.perimDefenseWeight(stealer) > poss.perimDefenseWeight(base),
    'a steal badge must raise the on-ball defender pick weight');

  // Charge Taker and Two-Way Star contribute NOTHING to shot quality (no
  // defensive zone), so allocation is the only place they can earn their keep.
  // If this ever reads equal, those two badges are decorative.
  ['chargeTaker', 'twoWayStar'].forEach(function (key) {
    const p = makeDefender([{ key: key, tier: 'legendary' }]);
    assert.ok(poss.shotDefenseWeight(p, 'inside') > poss.shotDefenseWeight(base, 'inside'),
      key + ' has no shot-quality effect, so it MUST show up in assignments or it does nothing at all');
  });
  console.log('checkDefensiveBadgesDrawAssignments: OK');
}

// Chemistry badges are TEAM-level, so they ride the team-level channel that
// already reaches shotMakeProbability. team.chemistry itself folds into the
// same term: it is authored 55-78 per team in teams.js but was read only by the
// non-default engine, so in normal play it was decorative.
function checkChemistryReachesSynergy() {
  const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));
  const roster = require(path.join(__dirname, '..', 'league.js')).getTeamRoster('BOS');
  const saved = roster.map(function (p) { return p.hiddenTraits; });

  roster.forEach(function (p) { p.hiddenTraits = []; });
  const neutral = composite.computeTeamSynergy(roster, { chemistry: 70 });

  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'naturalLeader', tier: 'legendary' }]; });
  const led = composite.computeTeamSynergy(roster, { chemistry: 70 });

  roster.forEach(function (p) { p.hiddenTraits = [{ key: 'lockerRoomCancer', tier: 'legendary' }]; });
  const toxic = composite.computeTeamSynergy(roster, { chemistry: 70 });

  assert.ok(led.offense > neutral.offense, 'Natural Leaders must raise offensive synergy');
  assert.ok(toxic.offense < neutral.offense, 'a toxic room must lower it');
  assert.ok(led.defense > neutral.defense && toxic.defense < neutral.defense,
    'chemistry must move BOTH sides of the ball, not just offence');
  assert.strictEqual(led.rebound, neutral.rebound,
    'chemistry is about playing together; rebounding is the least cooperative of the three');

  // The authored field must be live too, independently of badges.
  roster.forEach(function (p) { p.hiddenTraits = []; });
  const goodRoom = composite.computeTeamSynergy(roster, { chemistry: 78 });
  const badRoom = composite.computeTeamSynergy(roster, { chemistry: 55 });
  assert.ok(goodRoom.offense > badRoom.offense,
    'team.chemistry must stop being decorative in the default engine');

  // Omitting `team` must be neutral, so every existing caller is unaffected.
  const noTeam = composite.computeTeamSynergy(roster);
  const explicit70 = composite.computeTeamSynergy(roster, { chemistry: 70 });
  assert.ok(Math.abs(noTeam.offense - explicit70.offense) < 1e-9,
    'omitting team must behave as chemistry 70');

  roster.forEach(function (p, i) { p.hiddenTraits = saved[i]; });
  console.log('checkChemistryReachesSynergy: OK');
}

// Without a surfaced stat the whole defensive path is invisible — a lockdown
// defender's contribution would exist only in team results and plus/minus.
function checkDefensiveFgIsRecorded() {
  const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
  const r = gameSim.simulateGame('BOS', 'LAL', makeRng(5));
  const lines = Object.keys(r.boxScore).map(function (id) { return r.boxScore[id]; });

  const totalOppFga = lines.reduce(function (s, l) { return s + l.oppFga; }, 0);
  const totalFga = lines.reduce(function (s, l) { return s + l.fga; }, 0);
  assert.strictEqual(totalOppFga, totalFga,
    'every shot has exactly one defender, so defended attempts must equal attempts (' +
    totalOppFga + ' vs ' + totalFga + ')');

  const totalOppFgm = lines.reduce(function (s, l) { return s + l.oppFgm; }, 0);
  const totalFgm = lines.reduce(function (s, l) { return s + l.fgm; }, 0);
  assert.strictEqual(totalOppFgm, totalFgm, 'defended makes must equal makes');

  lines.forEach(function (l) {
    assert.ok(l.oppFgm <= l.oppFga, 'a defender cannot allow more makes than attempts');
  });

  const { SEASON_STAT_KEYS } = require(path.join(__dirname, '..', 'league.js'));
  assert.ok(SEASON_STAT_KEYS.indexOf('oppFga') !== -1 && SEASON_STAT_KEYS.indexOf('oppFgm') !== -1,
    'DFG% only means anything over a season — one game of five defended shots is noise');
  console.log('checkDefensiveFgIsRecorded: OK (' + totalOppFga + ' defended attempts)');
}

// The curve maps the fitted value onto the scale players actually read. Three
// properties make it safe, and all three are load-bearing:
//   monotone - a better player never reads worse
//   bounded  - nothing escapes 0..100, including a hypothetical all-100 player
//   ABSOLUTE - the same attributes give the same number regardless of who else
//              is in the league. A percentile mapping would fail this and would
//              silently re-rate everyone every time a draft class arrived.
function checkDisplayCurveIsMonotoneAndBounded() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  // Swept well OUTSIDE 0..100 deliberately. Both clamps are unreachable from
  // the real callers, because computeOverall already clamps its own output —
  // so a sweep of only the reachable domain leaves them untested, and removing
  // one is a mutation that survives. The function promises a bounded result for
  // any numeric input; this tests that promise rather than today's callers.
  let prev = -1;
  for (let raw = -80; raw <= 120; raw += 0.25) {
    const d = ratings.toDisplayRating(raw);
    assert.ok(d >= 0 && d <= 100, 'display escaped 0..100 at raw ' + raw + ': ' + d);
    assert.ok(d >= prev, 'display curve went DOWN at raw ' + raw + ': ' + prev + ' -> ' + d);
    prev = d;
  }
  assert.strictEqual(ratings.toDisplayRating(1e9), 100, 'the upper clamp must hold');
  assert.strictEqual(ratings.toDisplayRating(-1e9), 0, 'the lower clamp must hold');
  assert.strictEqual(ratings.toDisplayRating(ratings.DISPLAY_KNOT.rawHi), ratings.DISPLAY_KNOT.dispHi,
    'the top knot must land exactly on its display value');
  assert.strictEqual(ratings.toDisplayRating(ratings.DISPLAY_KNOT.rawLo), ratings.DISPLAY_KNOT.dispLo,
    'the bottom knot must land exactly on its display value');
  assert.strictEqual(ratings.toDisplayRating(100), 100, 'a perfect player reads 100');
  console.log('checkDisplayCurveIsMonotoneAndBounded: OK');
}

// Absoluteness, tested by changing the league around a fixed raw value. If the
// curve ever consulted league state — a percentile, a max, a mean — this fails.
function checkDisplayCurveIsAbsolute() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const before = ratings.toDisplayRating(70);
  const stash = PLAYERS_2026.splice(0, 100);
  const during = ratings.toDisplayRating(70);
  Array.prototype.unshift.apply(PLAYERS_2026, stash);
  const after = ratings.toDisplayRating(70);
  assert.strictEqual(before, during,
    'display must not depend on the league around the player (removed 100 players and it moved)');
  assert.strictEqual(before, after, 'display must be stable once the league is restored');
  assert.strictEqual(PLAYERS_2026.length, 380, 'the league must be put back exactly as found');
  console.log('checkDisplayCurveIsAbsolute: OK (raw 70 -> ' + before + ')');
}

// toRawRating is the inverse scaleAttributesToOverall solves against. Every
// reachable display value must round-trip back to itself.
function checkDisplayCurveRoundTrips() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  for (let d = 40; d <= 100; d++) {
    const raw = ratings.toRawRating(d);
    assert.strictEqual(ratings.toDisplayRating(raw), d,
      'round trip failed at display ' + d + ' (raw ' + raw.toFixed(3) + ')');
  }
  console.log('checkDisplayCurveRoundTrips: OK (display 40-100)');
}

checkDefensiveBadgesDrawAssignments();
checkChemistryReachesSynergy();
checkDefensiveFgIsRecorded();
// One field cannot mean two things. `overall` was both the number a player
// reads and a proportional weight the sim consumes; rescaling it for the first
// silently corrupts the second.
function checkRawAndDisplayAreBothPresent() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const p = PLAYERS_2026[0];
  assert.ok(typeof p.rawOverall === 'number', 'rawOverall must exist');
  assert.ok(typeof p.overall === 'number', 'overall must exist');
  assert.strictEqual(p.overall, ratings.toDisplayRating(p.rawOverall),
    'overall must be the display of rawOverall');
  assert.ok(typeof p.potentialDisplay === 'number', 'potentialDisplay must exist');
  assert.strictEqual(p.potentialDisplay, ratings.toDisplayRating(p.potential),
    'potentialDisplay must be the display of the stored raw potential');
  assert.notStrictEqual(p.overall, p.rawOverall,
    'display and raw must actually differ, or the split is decorative');
  console.log('checkRawAndDisplayAreBothPresent: OK (raw ' + p.rawOverall + ' -> ' + p.overall + ')');
}

// THE UPGRADE PATH. defineOverall's idempotence guard tests `rawOverall`, not
// `overall`, and the difference only shows on a player carrying the OLD shape:
// an `overall` getter and nothing else. Guarding on `overall` would see a getter
// already present, return early, and leave that player without rawOverall
// forever — every sim-facing read of it silently undefined.
//
// Nothing in the normal corpus builds such a player (a deserialised save has no
// getters at all, so either guard works), which made reverting the guard a
// surviving mutant. This constructs the old shape directly so the guard is live.
function checkOldShapePlayersGainTheNewGetters() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  const legacy = JSON.parse(JSON.stringify(PLAYERS_2026[3]));
  Object.defineProperty(legacy, 'overall', {
    get: function () { return ratings.computeOverall(this); },
    enumerable: false, configurable: true
  });
  assert.strictEqual(legacy.rawOverall, undefined, 'the fixture must start in the OLD shape');
  ratings.defineOverall(legacy);
  assert.ok(typeof legacy.rawOverall === 'number',
    'a player carrying the old single-getter shape must still gain rawOverall');
  assert.strictEqual(legacy.overall, ratings.toDisplayRating(legacy.rawOverall),
    'and its overall must be upgraded to the display value');
  console.log('checkOldShapePlayersGainTheNewGetters: OK');
}

// Neither may serialise. A saved league carrying a frozen rating rebuilds the
// stored-overall drift bug through the back door.
function checkNeitherRatingSerialises() {
  const json = JSON.stringify(PLAYERS_2026[0]);
  assert.ok(json.indexOf('"overall"') === -1, 'overall must not serialise');
  assert.ok(json.indexOf('"rawOverall"') === -1, 'rawOverall must not serialise');
  assert.ok(json.indexOf('"potentialDisplay"') === -1, 'potentialDisplay must not serialise');
  assert.ok(json.indexOf('"potential"') !== -1, 'the STORED raw potential must still serialise');
  console.log('checkNeitherRatingSerialises: OK');
}

// The proportional spread minutesWeight depends on. If this narrows, stars are
// taking fewer shots than they should and the sim has been quietly rebalanced.
// 2.69x today; the display scale would give 1.58x.
function checkUsageSpreadStaysWide() {
  const weights = PLAYERS_2026.map(function (p) { return p.rawOverall; });
  const spread = Math.max.apply(null, weights) / Math.min.apply(null, weights);
  assert.ok(spread >= 2.4,
    'usage spread collapsed to ' + spread.toFixed(2) + 'x — minutesWeight is reading the display field');
  console.log('checkUsageSpreadStaysWide: OK (' + spread.toFixed(2) + 'x)');
}

// Coaches carry their OWN hand-authored overall on a 55-95 scale. It is not
// derived from attributes and must never be routed through the player curve.
function checkCoachOverallIsUntouched() {
  const coachMod = require(path.join(__dirname, '..', 'coaches.js'));
  const rng = makeRng(4242);
  const all = [];
  for (let i = 0; i < 60; i++) all.push(coachMod.generateCoach(rng));
  assert.ok(all.length > 0, 'expected a coach pool to check');
  all.forEach(function (c) {
    assert.ok(c.overall >= 55 && c.overall <= 95,
      'coach ' + c.name + ' overall ' + c.overall + ' left the authored 55-95 band');
    assert.strictEqual(c.rawOverall, undefined, 'a coach must never gain rawOverall');
  });
  console.log('checkCoachOverallIsUntouched: OK (' + all.length + ' coaches)');
}

// "Make this player a 90" means 90 on the scale the user is looking at.
function checkScaleAttributesHitsADisplayTarget() {
  const ratings = require(path.join(__dirname, '..', 'ratings.js'));
  [65, 75, 85, 90, 95].forEach(function (target) {
    const clone = ratings.defineOverall(JSON.parse(JSON.stringify(PLAYERS_2026[40])));
    ratings.scaleAttributesToOverall(clone, target);
    assert.strictEqual(clone.overall, target,
      'scaleAttributesToOverall(p, ' + target + ') gave ' + clone.overall);
  });
  console.log('checkScaleAttributesHitsADisplayTarget: OK (65/75/85/90/95)');
}

checkDisplayCurveIsMonotoneAndBounded();
checkDisplayCurveIsAbsolute();
checkDisplayCurveRoundTrips();
checkRawAndDisplayAreBothPresent();
checkOldShapePlayersGainTheNewGetters();
checkNeitherRatingSerialises();
checkUsageSpreadStaysWide();
checkCoachOverallIsUntouched();
checkScaleAttributesHitsADisplayTarget();

console.log('All ratings validations passed');
