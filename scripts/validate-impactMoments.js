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

checkEdgesRespondToMatchup();
checkPosterNeedsAllThreeConditions();
checkAnkleBreakerIsOutsideOnly();
checkPosterAndAnkleAreDisjoint();
checkBlockIsAlwaysTierTwo();
checkUnknownAndMalformedEventsAreIgnored();

console.log('All impactMoments validations passed');
