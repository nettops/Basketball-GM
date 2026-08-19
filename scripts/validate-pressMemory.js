// Press conferences with a memory.
//
// dialogueScenes.js was already a pure scene engine — `when` predicates over a
// flat fact object, effects returned rather than applied. What it had no
// concept of was having been asked before. So this is a memory to feed it, not
// a system to build, and the check that matters is that feeding it does not
// cost the engine its purity: memory arrives as more facts, never as an import.
const assert = require('assert');
const path = require('path');
const fs = require('fs');

function req(name) { return require(path.join(__dirname, '..', name)); }

const ctx = req('dialogueContext.js');
const scenes = req('dialogueScenes.js');

function checkAnAnswerIsRemembered() {
  const gs = {};
  ctx.rememberAnswer(gs, 'postgame-blowout', { id: 'blame-refs', tone: 'defiant' }, 2026);
  assert.strictEqual(gs.pressMemory.length, 1, 'it was written down');

  const facts = ctx.pressMemoryFacts(gs);
  assert.strictEqual(facts.pressAnswers, 1, 'and counted');
  assert.strictEqual(facts.pressLastChoiceId, 'blame-refs', 'the last thing said is recoverable');
  assert.strictEqual(facts.pressLastTone, 'defiant', 'and how it was said');
  assert.strictEqual(facts.pressHasSaid('blame-refs'), true, 'a scene can ask whether he has said it');
  assert.strictEqual(facts.pressHasSaid('took-the-blame'), false, 'and get an honest no');
  console.log('checkAnAnswerIsRemembered: OK');
}
checkAnAnswerIsRemembered();

// "He blamed the officials, twice" is the interesting fact, not "he said
// something once".
function checkItCountsRepetition() {
  const gs = {};
  ['blame-refs', 'blame-refs', 'took-the-blame'].forEach(function (id, i) {
    ctx.rememberAnswer(gs, 'scene-' + i, { id: id, tone: id === 'blame-refs' ? 'defiant' : 'humble' }, 2026);
  });
  const facts = ctx.pressMemoryFacts(gs);
  assert.strictEqual(facts.pressSaidCounts['blame-refs'], 2, 'twice is twice');
  assert.strictEqual(facts.pressToneCounts.defiant, 2, 'and the tone is tallied');
  assert.strictEqual(facts.pressToneStreak, 1, 'the streak is broken by the humble answer');

  ctx.rememberAnswer(gs, 'scene-4', { id: 'took-the-blame', tone: 'humble' }, 2026);
  assert.strictEqual(ctx.pressMemoryFacts(gs).pressToneStreak, 2, 'two humble answers in a row is a streak');
  console.log('checkItCountsRepetition: OK');
}
checkItCountsRepetition();

// It is saved, so it cannot grow forever.
function checkTheMemoryIsBounded() {
  const gs = {};
  for (let i = 0; i < ctx.PRESS_MEMORY_LIMIT * 3; i++) {
    ctx.rememberAnswer(gs, 'scene', { id: 'answer-' + i, tone: 'flat' }, 2026);
  }
  assert.strictEqual(gs.pressMemory.length, ctx.PRESS_MEMORY_LIMIT, 'it stops at the limit');
  // And it keeps the RECENT ones — a reporter quoting your oldest answer while
  // forgetting last week's is the wrong way round.
  assert.strictEqual(gs.pressMemory[gs.pressMemory.length - 1].choiceId,
    'answer-' + (ctx.PRESS_MEMORY_LIMIT * 3 - 1), 'the newest answer survives');
  assert.strictEqual(ctx.pressMemoryFacts(gs).pressHasSaid('answer-0'), false,
    'and the oldest has been forgotten');
  console.log('checkTheMemoryIsBounded: OK');
}
checkTheMemoryIsBounded();

// A malformed or choiceless answer must not put a hole in the log that
// pressMemoryFacts then trips over.
function checkAChoicelessAnswerIsIgnored() {
  const gs = {};
  ctx.rememberAnswer(gs, 'scene', null, 2026);
  ctx.rememberAnswer(gs, 'scene', {}, 2026);
  assert.strictEqual(gs.pressMemory.length, 0, 'nothing was recorded');
  assert.doesNotThrow(function () { ctx.pressMemoryFacts(gs); }, 'and the facts still build');
  assert.strictEqual(ctx.pressMemoryFacts(gs).pressLastTone, null, 'with nothing remembered');
  console.log('checkAChoicelessAnswerIsIgnored: OK');
}
checkAChoicelessAnswerIsIgnored();

// A scene's `when` reads a flat fact object. Memory has to be usable from
// there, or it is a log nobody can act on.
function checkAScenePredicateCanReadTheMemory() {
  const gs = {};
  ctx.rememberAnswer(gs, 'postgame', { id: 'blame-refs', tone: 'defiant' }, 2026);
  const facts = Object.assign({ margin: 20, userScore: 90 }, ctx.pressMemoryFacts(gs));

  // Exactly the shape a scene would use to bring up an old answer.
  const when = function (f) { return f.pressHasSaid('blame-refs') && f.pressToneStreak >= 1; };
  assert.strictEqual(when(facts), true, 'a predicate can ask what he said last time');

  const fresh = Object.assign({ margin: 20 }, ctx.pressMemoryFacts({}));
  assert.strictEqual(when(fresh), false, 'and a GM with no history is not accused of anything');
  console.log('checkAScenePredicateCanReadTheMemory: OK');
}
checkAScenePredicateCanReadTheMemory();

// The engine's purity is the property that made this cheap. If dialogueScenes.js
// ever reaches for game state directly, the whole library stops being testable
// without a league — which is the reason it was built this way.
function checkTheSceneEngineStayedPure() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dialogueScenes.js'), 'utf8');
  assert.ok(!/require\s*\(/.test(src), 'dialogueScenes.js requires nothing');
  assert.ok(!/_DIALOGUE_DATA|GameState|document\./.test(src),
    'and reaches neither the game state nor the DOM');
  assert.ok(typeof scenes.selectScene === 'function' || typeof scenes.SCENES === 'object',
    'while still being the scene library');
  console.log('checkTheSceneEngineStayedPure: OK');
}
checkTheSceneEngineStayedPure();

console.log('All press memory validations passed');
