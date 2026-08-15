// The dialogue scene library.
//
// Scenes are pure data: a predicate over a flat fact object, lines with
// emotions, and choices whose effects are RETURNED rather than applied. That
// purity is what lets the whole library be checked here with no game state,
// no DOM and no simulation — including the checks that a scene cannot name an
// emotion nothing can draw, or a {token} no context provides.
const assert = require('assert');
const path = require('path');
const scenes = require(path.join(__dirname, '..', 'dialogueScenes.js'));
const bust = require(path.join(__dirname, '..', 'ui', 'pixelBust.js'));

// Every key a scene of each moment is allowed to read. A scene referencing
// anything outside its list would interpolate a stray {brace} into the user's
// face at runtime.
const POSTGAME_KEYS = [
  'moment', 'role', 'userWon', 'userLost', 'margin', 'teamName', 'opponentName',
  'leadBlown', 'topScorerName', 'topScorerPoints', 'userScore', 'opponentScore',
  'isPlayoff', 'streak', 'seasonWins', 'seasonLosses'
];
const HALFTIME_KEYS = [
  'moment', 'role', 'margin', 'teamName', 'opponentName', 'trailing', 'leading',
  'topScorerName', 'topScorerPoints', 'userScore', 'opponentScore', 'isPlayoff'
];
const EFFECT_CHANNELS = ['teamMorale', 'playerMorale', 'reputation', 'chronicle', 'recordDecision'];

function keysFor(moment) {
  return moment === 'halftime' ? HALFTIME_KEYS : POSTGAME_KEYS;
}

// A context carrying every allowed key, for exercising effects and predicates.
function fullContext(moment, role) {
  return {
    moment: moment, role: role || 'gm',
    userWon: false, userLost: true, margin: 6,
    teamName: 'Celtics', opponentName: 'Lakers', leadBlown: 11,
    topScorerName: 'J. Tatum', topScorerPoints: 31,
    userScore: 104, opponentScore: 110, isPlayoff: false,
    streak: -2, seasonWins: 20, seasonLosses: 15,
    trailing: true, leading: false
  };
}

function stubScene(over) {
  return Object.assign({
    id: 'stub', moment: 'postgame', roles: ['gm'], priority: 1,
    when: function () { return true; }, lines: [], choices: [{}]
  }, over || {});
}

function checkEverySceneIsWellFormed() {
  assert.ok(scenes.SCENES.length > 0, 'there is at least one scene');
  const seen = {};
  scenes.SCENES.forEach(function (s) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, 'scene has an id');
    assert.ok(!seen[s.id], 'duplicate scene id: ' + s.id);
    seen[s.id] = true;
    assert.ok(s.moment === 'postgame' || s.moment === 'halftime', s.id + ' has a valid moment');
    assert.ok(Array.isArray(s.roles) && s.roles.length > 0, s.id + ' has roles');
    s.roles.forEach(function (r) {
      assert.ok(r === 'gm' || r === 'player', s.id + ' has an unknown role: ' + r);
    });
    assert.strictEqual(typeof s.priority, 'number', s.id + ' has a numeric priority');
    assert.strictEqual(typeof s.when, 'function', s.id + ' has a predicate');
    assert.ok(Array.isArray(s.lines) && s.lines.length > 0, s.id + ' has lines');
    assert.ok(Array.isArray(s.choices) && s.choices.length > 0, s.id + ' has at least one choice');
    s.choices.forEach(function (c) {
      assert.ok(typeof c.text === 'string' && c.text.length > 0, s.id + ' choice has text');
    });
  });
  console.log('checkEverySceneIsWellFormed: OK');
}
checkEverySceneIsWellFormed();

function checkEveryEmotionNamedIsDrawable() {
  scenes.SCENES.forEach(function (s) {
    s.lines.forEach(function (l) {
      assert.ok(bust.BUST_EMOTIONS.indexOf(l.emotion) !== -1,
        s.id + ' line names an undrawable emotion: ' + l.emotion);
    });
    s.choices.forEach(function (c) {
      assert.ok(bust.BUST_EMOTIONS.indexOf(c.emotion) !== -1,
        s.id + ' choice names an undrawable emotion: ' + c.emotion);
    });
  });
  console.log('checkEveryEmotionNamedIsDrawable: OK');
}
checkEveryEmotionNamedIsDrawable();

function checkEveryTokenResolves() {
  scenes.SCENES.forEach(function (s) {
    const allowed = keysFor(s.moment);
    const texts = s.lines.map(function (l) { return l.text; })
      .concat(s.choices.map(function (c) { return c.text; }));
    texts.forEach(function (t) {
      scenes.tokensIn(t).forEach(function (tok) {
        assert.ok(allowed.indexOf(tok) !== -1,
          s.id + ' uses {' + tok + '}, which no ' + s.moment + ' context provides');
      });
    });
  });
  console.log('checkEveryTokenResolves: OK');
}
checkEveryTokenResolves();

function checkInterpolation() {
  assert.strictEqual(scenes.interpolate('Lost by {margin}.', { margin: 9 }), 'Lost by 9.');
  assert.strictEqual(scenes.interpolate('{a} and {b}', { a: 'x', b: 'y' }), 'x and y');
  assert.strictEqual(scenes.interpolate('no tokens', {}), 'no tokens');
  // An unknown token is left verbatim rather than printing "undefined" — a
  // visible {brace} in the game gets reported as a bug; "undefined" gets a shrug.
  assert.strictEqual(scenes.interpolate('{nope}', {}), '{nope}');
  assert.strictEqual(scenes.interpolate('{a}', { a: null }), '{a}', 'null is treated as missing');
  assert.strictEqual(scenes.interpolate('{a}', { a: 0 }), '0', 'zero is a real value, not missing');
  // Single pass: a value that is itself brace-shaped must not be re-scanned.
  assert.strictEqual(scenes.interpolate('{a}', { a: '{b}', b: 'no' }), '{b}');
  assert.deepStrictEqual(scenes.tokensIn('{a} {b} {a}'), ['a', 'b'], 'tokens are deduped');
  assert.deepStrictEqual(scenes.tokensIn('none here'), []);
  console.log('checkInterpolation: OK');
}
checkInterpolation();

function checkHighestPriorityWins() {
  const pool = [
    stubScene({ id: 'low', priority: 10 }),
    stubScene({ id: 'high', priority: 90 })
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' },
    { scenes: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'high');
  console.log('checkHighestPriorityWins: OK');
}
checkHighestPriorityWins();

function checkFiltersByMomentAndRole() {
  const pool = [
    stubScene({ id: 'wrong-moment', moment: 'halftime', priority: 99 }),
    stubScene({ id: 'wrong-role', roles: ['player'], priority: 99 }),
    stubScene({ id: 'right', priority: 1 })
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' },
    { scenes: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'right', 'moment and role filter before priority');
  console.log('checkFiltersByMomentAndRole: OK');
}
checkFiltersByMomentAndRole();

function checkRecentScenesAreSkipped() {
  const pool = [
    stubScene({ id: 'just-fired', priority: 90 }),
    stubScene({ id: 'next-up', priority: 10 })
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' },
    { scenes: pool, recent: ['just-fired'], rand: function () { return 0; } });
  assert.strictEqual(got.id, 'next-up', 'a recently fired scene is passed over');
  console.log('checkRecentScenesAreSkipped: OK');
}
checkRecentScenesAreSkipped();

function checkAThrowingPredicateIsDroppedNotFatal() {
  // One bad predicate must not cost the user their post-game.
  const pool = [
    stubScene({ id: 'broken', priority: 99, when: function () { throw new Error('boom'); } }),
    stubScene({ id: 'fine', priority: 1 })
  ];
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' },
    { scenes: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'fine', 'the throwing scene was skipped, not propagated');
  console.log('checkAThrowingPredicateIsDroppedNotFatal: OK');
}
checkAThrowingPredicateIsDroppedNotFatal();

function checkFallbackWhenNothingMatches() {
  const got = scenes.selectScene({ moment: 'postgame', role: 'gm' }, {
    scenes: [],
    rand: function () { return 0; },
    fallbackLines: ['How are you feeling about your performance?']
  });
  assert.strictEqual(got.id, scenes.FALLBACK_SCENE_ID, 'the fallback fired');
  assert.strictEqual(got.lines.length, 1, 'the fallback has a line');
  assert.strictEqual(got.lines[0].text, 'How are you feeling about your performance?');
  assert.ok(bust.BUST_EMOTIONS.indexOf(got.lines[0].emotion) !== -1, 'and a drawable emotion');
  assert.ok(got.choices.length > 0, 'the fallback has choices');
  got.choices.forEach(function (c) {
    assert.strictEqual(c.effect, null, 'fallback choices are pure flavour');
  });
  // With no pool supplied it still produces something rather than crashing.
  const bare = scenes.selectScene({ moment: 'halftime', role: 'player' },
    { scenes: [], rand: function () { return 0; } });
  assert.strictEqual(bare.id, scenes.FALLBACK_SCENE_ID);
  assert.ok(bare.lines[0].text.length > 0, 'a default line exists');
  assert.strictEqual(bare.moment, 'halftime', 'the fallback adopts the moment it was asked for');
  console.log('checkFallbackWhenNothingMatches: OK');
}
checkFallbackWhenNothingMatches();

function checkSelectionIsDeterministicForAGivenRand() {
  // Ties break on the injected rng, so the same save replays the same line.
  const pool = [stubScene({ id: 'a', priority: 50 }), stubScene({ id: 'b', priority: 50 })];
  const ctx = { moment: 'postgame', role: 'gm' };
  assert.strictEqual(scenes.selectScene(ctx, { scenes: pool, rand: function () { return 0; } }).id, 'a');
  assert.strictEqual(scenes.selectScene(ctx, { scenes: pool, rand: function () { return 0.99; } }).id, 'b');
  console.log('checkSelectionIsDeterministicForAGivenRand: OK');
}
checkSelectionIsDeterministicForAGivenRand();

function checkRealScenesFireOnRealContexts() {
  // The shipped library must actually match something plausible, or the
  // fallback is all anyone will ever see.
  const blownLead = fullContext('postgame', 'gm');
  const got = scenes.selectScene(blownLead, { rand: function () { return 0; } });
  assert.notStrictEqual(got.id, scenes.FALLBACK_SCENE_ID,
    'a blown 11-point lead should match a real scene, not the fallback');

  const halftime = fullContext('halftime', 'gm');
  halftime.margin = 14;
  const ht = scenes.selectScene(halftime, { rand: function () { return 0; } });
  assert.notStrictEqual(ht.id, scenes.FALLBACK_SCENE_ID,
    'down 14 at the half should match a real scene');
  console.log('checkRealScenesFireOnRealContexts: OK');
}
checkRealScenesFireOnRealContexts();

function checkBothMomentsAndBothRolesAreServed() {
  ['postgame', 'halftime'].forEach(function (m) {
    ['gm', 'player'].forEach(function (r) {
      const any = scenes.SCENES.some(function (s) {
        return s.moment === m && s.roles.indexOf(r) !== -1;
      });
      assert.ok(any, 'no scene at all for ' + m + '/' + r);
    });
  });
  console.log('checkBothMomentsAndBothRolesAreServed: OK');
}
checkBothMomentsAndBothRolesAreServed();

function checkEffectsAreReturnedNotApplied() {
  // A choice must not touch game state. It returns a description; a single
  // applier interprets it. This is what makes scenes testable with no game.
  scenes.SCENES.forEach(function (s) {
    const ctx = fullContext(s.moment, s.roles[0]);
    s.choices.forEach(function (c) {
      assert.ok(c.effect === null || typeof c.effect === 'function',
        s.id + ': effect is null or a function');
      if (typeof c.effect !== 'function') return;
      const out = c.effect(ctx);
      assert.ok(out && typeof out === 'object', s.id + ': an effect returns an object');
      assert.ok(Object.keys(out).length > 0, s.id + ': an effect that changes nothing should be null');
      Object.keys(out).forEach(function (k) {
        assert.ok(EFFECT_CHANNELS.indexOf(k) !== -1, s.id + ': unknown effect channel "' + k + '"');
      });
      ['teamMorale', 'playerMorale'].forEach(function (k) {
        if (typeof out[k] === 'number') {
          assert.ok(Math.abs(out[k]) <= 3,
            s.id + ': a ' + k + ' swing above 3 outweighs several games of results');
        }
      });
      if (typeof out.reputation === 'number') {
        assert.ok(Math.abs(out.reputation) <= 5, s.id + ': reputation swing is too large');
      }
      if (out.chronicle !== undefined) {
        assert.strictEqual(typeof out.chronicle, 'string', s.id + ': chronicle is a string');
        assert.ok(out.chronicle.length > 0, s.id + ': chronicle is not empty');
        assert.strictEqual(scenes.tokensIn(out.chronicle).length, 0,
          s.id + ': chronicle text has an uninterpolated token');
      }
    });
  });
  console.log('checkEffectsAreReturnedNotApplied: OK');
}
checkEffectsAreReturnedNotApplied();

function checkEffectsDoNotMutateTheContext() {
  // An effect that writes to the context it was handed would apply a change
  // twice: once here and once through the applier.
  scenes.SCENES.forEach(function (s) {
    s.choices.forEach(function (c) {
      if (typeof c.effect !== 'function') return;
      const ctx = fullContext(s.moment, s.roles[0]);
      const before = JSON.stringify(ctx);
      c.effect(ctx);
      assert.strictEqual(JSON.stringify(ctx), before, s.id + ': an effect mutated the context');
    });
  });
  console.log('checkEffectsDoNotMutateTheContext: OK');
}
checkEffectsDoNotMutateTheContext();

function checkAtLeastOneFlavourChoiceExists() {
  // Mixed stakes was an explicit design decision: some replies change nothing,
  // and they look identical to the ones that do.
  const hasFlavour = scenes.SCENES.some(function (s) {
    return s.choices.some(function (c) { return c.effect === null; });
  });
  assert.ok(hasFlavour, 'no scene offers a pure-flavour reply');
  console.log('checkAtLeastOneFlavourChoiceExists: OK');
}
checkAtLeastOneFlavourChoiceExists();

console.log('All dialogue scene validations passed');
