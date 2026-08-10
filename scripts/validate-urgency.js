// Urgency — the engine reacting to its own scoreboard.
//
// The invariants here are the ones that make it safe rather than the ones that
// make it work; how well it works is measured by scripts/probe-comebacks.js,
// which is a calibration probe, not a test. These four assertions are what stop
// it becoming a bug:
//
//   1. ZERO-SUM. One team's bonus is exactly the other's penalty, which is the
//      reason league FG%/3P%/points could not move and the shot bases did not
//      need re-solving. If this ever stops holding, urgency starts inflating or
//      deflating league scoring and every calibrated constant downstream drifts.
//   2. It does NOT engage in the first half.
//   3. The cap binds, in both directions.
//   4. A caller that passes no game context gets byte-identical behaviour.
//      Every pre-urgency caller relies on this.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js'); rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
rq('simEngine.js'); rq('simEngineBoxScore.js');
const poss = rq('simEnginePossession.js');
const { skillCheckProbability } = rq('skillCheck.js');

function urgencyOf(spec) {
  const m = spec.modifiers.find(function (x) { return x.label === 'urgency'; });
  return m ? m.value : null;
}

function checkUrgencyIsZeroSum() {
  const T = poss.URGENCY_TUNING;
  for (let d = -40; d <= 40; d += 1) {
    const trailing = poss.urgencyBonus(d, T.fromPeriod);
    const leading = poss.urgencyBonus(-d, T.fromPeriod);
    assert.ok(Math.abs(trailing + leading) < 1e-12,
      'urgency must be exactly zero-sum at a ' + d + '-point margin, got ' +
      trailing + ' and ' + leading);
  }
  // And it must have the right SIGN: trailing helps, leading hurts.
  assert.ok(poss.urgencyBonus(-10, T.fromPeriod) > 0, 'a trailing team gets a BONUS');
  assert.ok(poss.urgencyBonus(10, T.fromPeriod) < 0, 'a leading team gets a PENALTY');
  assert.strictEqual(poss.urgencyBonus(0, T.fromPeriod), 0, 'a tie game is untouched');
  console.log('checkUrgencyIsZeroSum: OK');
}
checkUrgencyIsZeroSum();

function checkUrgencyIsSilentInTheFirstHalf() {
  const T = poss.URGENCY_TUNING;
  for (let p = 1; p < T.fromPeriod; p++) {
    assert.strictEqual(poss.urgencyBonus(-25, p), 0,
      'urgency must not engage in period ' + p + ' — nobody plays with urgency four minutes in');
  }
  assert.notStrictEqual(poss.urgencyBonus(-25, T.fromPeriod), 0,
    'it must engage at period ' + T.fromPeriod + ', or the feature is dead');
  console.log('checkUrgencyIsSilentInTheFirstHalf: OK');
}
checkUrgencyIsSilentInTheFirstHalf();

function checkTheCapBindsBothWays() {
  const T = poss.URGENCY_TUNING;
  assert.ok(Math.abs(poss.urgencyBonus(-500, T.fromPeriod) - T.cap) < 1e-12,
    'an absurd deficit is capped at +' + T.cap);
  assert.ok(Math.abs(poss.urgencyBonus(500, T.fromPeriod) + T.cap) < 1e-12,
    'an absurd lead is capped at -' + T.cap);
  // The cap must actually be REACHABLE inside a real basketball game, or it is
  // decoration. At perPoint it should bind somewhere under a 40-point margin.
  const bindsAt = T.cap / T.perPoint;
  assert.ok(bindsAt < 40, 'the cap binds at ' + bindsAt.toFixed(1) +
    ' points, which never happens in a game — it would be dead code');
  console.log('checkTheCapBindsBothWays: OK (binds at ' + bindsAt.toFixed(1) + ' points)');
}
checkTheCapBindsBothWays();

function checkNoGameContextMeansNoChange() {
  // shotSpec's last two arguments are the game context. Omitting them — which
  // is what every caller did before urgency existed — must leave the spec
  // exactly as it was.
  const withOut = poss.shotSpec('three', 80, 60, 1.02, 0.98, 1, 1, 0, 0);
  assert.strictEqual(urgencyOf(withOut), 0,
    'a spec built with no game context must carry zero urgency');

  const withCtx = poss.shotSpec('three', 80, 60, 1.02, 0.98, 1, 1, 0, 0, -20, 4);
  assert.ok(urgencyOf(withCtx) > 0, 'and with context it must actually apply');

  // The probabilities must differ by exactly the urgency term and nothing else.
  const a = skillCheckProbability(withOut).probability;
  const b = skillCheckProbability(withCtx).probability;
  assert.ok(Math.abs((b - a) - urgencyOf(withCtx)) < 1e-12,
    'urgency must be the ONLY difference between the two specs');
  console.log('checkNoGameContextMeansNoChange: OK');
}
checkNoGameContextMeansNoChange();

console.log('All urgency validations passed');
