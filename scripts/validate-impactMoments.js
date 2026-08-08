// Which plays earn the comic-panel treatment, and how often.
//
// The thresholds here are calibrated by RATE, not picked off raw ratings.
// DUNK_LIFT_THRESHOLD in ui/pixelChoreographer.js carries the scar from the
// other approach: an absolute cutoff chosen from rating numbers marked ~95% of
// the league as dunkers. Every player in this pool is elite, so "high vertical"
// selects nearly everyone. checkRateStaysInBand below is what keeps this honest
// as progression moves ratings every season.
const assert = require('assert');
const path = require('path');

const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));

// Fixture players built to sit at the extremes, so these assertions test the
// STRUCTURE of the rules and stay true whatever the calibrated numbers become.
function mkPlayer(overrides) {
  const attributes = Object.assign({
    insideScoring: 50, midRange: 50, threePoint: 50, freeThrow: 50,
    passing: 50, ballHandling: 50, postScoring: 50,
    perimeterDefense: 50, interiorDefense: 50, steal: 50, block: 50,
    offReb: 50, defReb: 50, speed: 50, acceleration: 50,
    strength: 50, vertical: 50, basketballIQ: 50, leadership: 50, workEthic: 50
  }, (overrides && overrides.attributes) || {});
  return { id: (overrides && overrides.id) || 'p1', name: 'Test Player',
           heightIn: (overrides && overrides.heightIn) || 78, attributes: attributes };
}

const eliteLeaper = mkPlayer({ id: 'leaper', heightIn: 82, attributes: { vertical: 99, strength: 90, insideScoring: 95 } });
const weakRimProtector = mkPlayer({ id: 'weakbig', attributes: { interiorDefense: 20 } });
const eliteRimProtector = mkPlayer({ id: 'wall', attributes: { interiorDefense: 99 } });
const eliteHandler = mkPlayer({ id: 'handler', attributes: { ballHandling: 99, acceleration: 99, speed: 99 } });
const weakPerimeter = mkPlayer({ id: 'turnstile', attributes: { perimeterDefense: 20 } });
const elitePerimeter = mkPlayer({ id: 'stopper', attributes: { perimeterDefense: 99 } });

function checkEdgesRespondToMatchup() {
  assert.ok(choreo.posterEdge(eliteLeaper, weakRimProtector) > choreo.posterEdge(eliteLeaper, eliteRimProtector),
    'the same finisher should score a bigger poster edge against a weaker rim protector');
  assert.ok(choreo.handleEdge(eliteHandler, weakPerimeter) > choreo.handleEdge(eliteHandler, elitePerimeter),
    'the same handler should score a bigger handle edge against a weaker defender');
}

function checkPosterNeedsAllThreeConditions() {
  const made = { type: 'shot', made: true, zone: 'inside' };
  assert.strictEqual(choreo.classifyImpact(made, eliteLeaper, weakRimProtector), 'poster',
    'an elite leaper finishing inside over a weak rim protector is a poster');
  assert.strictEqual(choreo.classifyImpact(made, eliteLeaper, eliteRimProtector), null,
    'a real rim protector denies the poster');
  // a ground-bound finisher fails isDunker regardless of the matchup
  const grounded = mkPlayer({ id: 'grounded', heightIn: 72, attributes: { vertical: 20, strength: 20, insideScoring: 95 } });
  assert.strictEqual(choreo.classifyImpact(made, grounded, weakRimProtector), null,
    'a non-dunker cannot poster anybody');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: false, zone: 'inside' }, eliteLeaper, weakRimProtector), null,
    'a missed dunk is not a poster');
}

function checkAnkleBreakerIsOutsideOnly() {
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, weakPerimeter), 'ankle',
    'a big handle edge on a made mid-range is an ankle breaker');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'three' }, eliteHandler, weakPerimeter), 'ankle',
    'the same applies from three');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, eliteHandler, elitePerimeter), null,
    'a defender who stays in front denies it');
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: false, zone: 'three' }, eliteHandler, weakPerimeter), null,
    'a miss never fires — celebrating a brick would read as a bug');
}

// The property that makes precedence impossible to get wrong.
function checkPosterAndAnkleAreDisjoint() {
  const zones = ['inside', 'mid', 'three'];
  const shooters = [eliteLeaper, eliteHandler, mkPlayer({ id: 'both', heightIn: 82,
    attributes: { vertical: 99, strength: 90, insideScoring: 99, ballHandling: 99, acceleration: 99, speed: 99 } })];
  const defenders = [weakRimProtector, weakPerimeter, eliteRimProtector, elitePerimeter];
  shooters.forEach(function (s) {
    defenders.forEach(function (d) {
      zones.forEach(function (z) {
        const kind = choreo.classifyImpact({ type: 'shot', made: true, zone: z }, s, d);
        if (z === 'inside') {
          assert.notStrictEqual(kind, 'ankle', 'an inside make must never classify as an ankle breaker');
        } else {
          assert.notStrictEqual(kind, 'poster', 'an outside make must never classify as a poster');
        }
      });
    });
  });
}

function checkBlockIsAlwaysTierTwo() {
  assert.strictEqual(choreo.classifyImpact({ type: 'block', zone: 'inside' }, eliteHandler, elitePerimeter), 'block',
    'every block classifies, regardless of ratings');
  assert.strictEqual(choreo.classifyImpact({ type: 'block', zone: 'three' }, elitePerimeter, eliteHandler), 'block',
    'including a three-point block');
}

function checkUnknownAndMalformedEventsAreIgnored() {
  assert.strictEqual(choreo.classifyImpact({ type: 'rebound' }, eliteLeaper, weakRimProtector), null);
  assert.strictEqual(choreo.classifyImpact({ type: 'turnover' }, eliteLeaper, weakRimProtector), null);
  assert.strictEqual(choreo.classifyImpact(null, eliteLeaper, weakRimProtector), null);
  // a shot whose defender was never resolved must not throw
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'inside' }, eliteLeaper, null), null);
  assert.strictEqual(choreo.classifyImpact({ type: 'shot', made: true, zone: 'mid' }, null, weakPerimeter), null);
}

// The check that survives the league aging. Progression moves ratings every
// season; a cutoff that is right in 2026 could fire on every possession by
// 2034. The band is wide on purpose — this catches drift and misconfiguration,
// it is not a golden master and must not fail on ordinary rng variation.
function checkRateStaysInBand() {
  require(path.join(__dirname, '..', 'data.js'));
  const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
  require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
  const rngMod = require(path.join(__dirname, '..', 'rng.js'));
  require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
  require(path.join(__dirname, '..', 'gameSim.js'));
  const se = require(path.join(__dirname, '..', 'simEngine.js'));
  const league = require(path.join(__dirname, '..', 'league.js'));
  const teams = require(path.join(__dirname, '..', 'teams.js'));
  const engine = se.getActiveEngine({ simEngine: 'possession' });

  const ids = teams.TEAMS.map(function (t) { return t.id; });
  const byId = {};
  ids.forEach(function (id) { league.getTeamRoster(id).forEach(function (p) { byId[p.id] = p; }); });

  const count = { poster: 0, ankle: 0, block: 0 };
  let games = 0;
  for (let i = 0; i < ids.length; i++) {
    const home = ids[i], away = ids[(i + 7) % ids.length];
    for (let g = 0; g < 4; g++) {
      const rng = rngMod.makeRng(81000 + i * 100 + g);
      const ev = [];
      engine.simulateGame(home, away, rng, { events: ev });
      games++;
      ev.forEach(function (e) {
        const kind = choreo.classifyImpact(e, byId[e.playerId], byId[e.defenderId]);
        if (kind) count[kind] += 1;
      });
    }
  }

  ['poster', 'ankle'].forEach(function (kind) {
    const rate = count[kind] / games;
    assert.ok(rate >= 0.5 && rate <= 4,
      kind + ' fires ' + rate.toFixed(2) + '/game over ' + games +
      ' games, outside the 0.5-4 band — recalibrate IMPACT_THRESHOLDS in ui/pixelChoreographer.js');
  });

  // Blocks are a real event, not a derived judgement: no threshold shrinks
  // them, so this asserts the tier-2 population is what the design assumed.
  const blockRate = count.block / games;
  assert.ok(blockRate >= 2 && blockRate <= 7,
    'blocks fire ' + blockRate.toFixed(2) + '/game, outside the expected 2-7 — the engine changed, revisit the two-tier split');
}

checkEdgesRespondToMatchup();
checkPosterNeedsAllThreeConditions();
checkAnkleBreakerIsOutsideOnly();
checkPosterAndAnkleAreDisjoint();
checkBlockIsAlwaysTierTwo();
checkUnknownAndMalformedEventsAreIgnored();
checkRateStaysInBand();

console.log('All impactMoments validations passed');
