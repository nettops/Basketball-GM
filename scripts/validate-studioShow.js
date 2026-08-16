// The halftime studio show.
//
// The load-bearing check is checkTheCrewAreVisuallyDistinct: four men on a
// desk whose only difference is a name plate is not a panel. Colour does not
// separate anybody at 32x40 — the outline has to.
const assert = require('assert');
const path = require('path');
const studio = require(path.join(__dirname, '..', 'studioShow.js'));
const bust = require(path.join(__dirname, '..', 'ui', 'pixelBust.js'));
const scenes = require(path.join(__dirname, '..', 'dialogueScenes.js'));

// Every key a halftime context provides — a segment referencing anything else
// would print a stray {brace} on screen.
const HALFTIME_KEYS = [
  'moment', 'role', 'margin', 'teamName', 'opponentName', 'trailing', 'leading',
  'topScorerName', 'topScorerPoints', 'userScore', 'opponentScore', 'isPlayoff',
  'slumpName', 'slumpFgm', 'slumpFga', 'slumpPoints'
];

function fullContext(over) {
  return Object.assign({
    moment: 'halftime', role: 'gm', margin: 14,
    teamName: 'Boston Harbormen', opponentName: 'Los Angeles Monarchs',
    trailing: true, leading: false,
    topScorerName: 'Jayson Tatum', topScorerPoints: 12,
    userScore: 48, opponentScore: 62, isPlayoff: false
  }, over || {});
}

function checkTheCrewIsWellFormed() {
  assert.strictEqual(studio.CREW.length, 4, 'four on the desk');
  const seen = {};
  studio.CREW.forEach(function (m) {
    assert.ok(typeof m.key === 'string' && m.key.length > 0, 'crew member has a key');
    assert.ok(!seen[m.key], 'duplicate crew key: ' + m.key);
    seen[m.key] = true;
    assert.ok(typeof m.name === 'string' && m.name.length > 0, m.key + ' has a name');
    ['skin', 'hair', 'jersey', 'trim'].forEach(function (c) {
      assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(m.colors[c]), m.key + ' ' + c + ' is a hex colour');
    });
    assert.ok(m.traits, m.key + ' has traits');
    assert.ok(bust.HAIR[m.traits.hair], m.key + ' names an unknown hair: ' + m.traits.hair);
    assert.ok(bust.BUILD[m.traits.build], m.key + ' names an unknown build: ' + m.traits.build);
    assert.ok(bust.FACIAL[m.traits.facialHair], m.key + ' names unknown facial hair');
  });
  console.log('checkTheCrewIsWellFormed: OK');
}
checkTheCrewIsWellFormed();

function checkTheCrewAreVisuallyDistinct() {
  // Silhouette only — which cells are painted, ignoring colour entirely.
  function silhouette(member) {
    const grid = {};
    const ctx = {
      fillStyle: '#000',
      fillRect: function (x, y, w, h) {
        for (let px = x; px < x + w; px++) {
          for (let py = y; py < y + h; py++) grid[px + ',' + py] = 1;
        }
      }
    };
    bust.drawPixelBust(ctx, member.colors, 'neutral', { scale: 1, traits: member.traits });
    return Object.keys(grid).sort().join('|');
  }

  const sigs = studio.CREW.map(silhouette);
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      assert.notStrictEqual(sigs[i], sigs[j],
        studio.CREW[i].key + ' and ' + studio.CREW[j].key +
        ' are the same man in different colours');
    }
  }
  console.log('checkTheCrewAreVisuallyDistinct: OK');
}
checkTheCrewAreVisuallyDistinct();

function checkTheHostOpensAndClosesEverySegment() {
  // Somebody has to throw to the break, or the segment just stops.
  const host = studio.HOST_KEY;
  assert.ok(studio.CREW.some(function (m) { return m.key === host; }), 'the host is on the crew');
  studio.SEGMENTS.forEach(function (seg) {
    assert.strictEqual(seg.beats[0].who, host, seg.id + ': the host opens');
    assert.strictEqual(seg.beats[seg.beats.length - 1].who, host, seg.id + ': the host closes');
  });
  console.log('checkTheHostOpensAndClosesEverySegment: OK');
}
checkTheHostOpensAndClosesEverySegment();

function checkEverySegmentIsWellFormed() {
  assert.ok(studio.SEGMENTS.length > 0, 'there is at least one segment');
  const seen = {};
  const crewKeys = studio.CREW.map(function (m) { return m.key; });
  studio.SEGMENTS.forEach(function (seg) {
    assert.ok(typeof seg.id === 'string' && seg.id.length > 0, 'segment has an id');
    assert.ok(!seen[seg.id], 'duplicate segment id: ' + seg.id);
    seen[seg.id] = true;
    assert.strictEqual(typeof seg.priority, 'number', seg.id + ' has a priority');
    assert.strictEqual(typeof seg.when, 'function', seg.id + ' has a predicate');
    assert.ok(Array.isArray(seg.beats) && seg.beats.length >= 3, seg.id + ' has at least three beats');
    seg.beats.forEach(function (b, i) {
      assert.ok(crewKeys.indexOf(b.who) !== -1, seg.id + ' beat ' + i + ' names a stranger: ' + b.who);
      assert.ok(bust.BUST_EMOTIONS.indexOf(b.emotion) !== -1,
        seg.id + ' beat ' + i + ' names an undrawable emotion: ' + b.emotion);
      assert.ok(typeof b.text === 'string' && b.text.length > 0, seg.id + ' beat ' + i + ' has text');
      if (i > 0) {
        assert.notStrictEqual(b.who, seg.beats[i - 1].who,
          seg.id + ' beat ' + i + ': ' + b.who + ' talks twice in a row, which reads as one long line');
      }
    });
  });
  console.log('checkEverySegmentIsWellFormed: OK');
}
checkEverySegmentIsWellFormed();

function checkEveryTokenResolves() {
  studio.SEGMENTS.forEach(function (seg) {
    seg.beats.forEach(function (b) {
      scenes.tokensIn(b.text).forEach(function (tok) {
        assert.ok(HALFTIME_KEYS.indexOf(tok) !== -1,
          seg.id + ' uses {' + tok + '}, which no halftime context provides');
      });
    });
  });
  console.log('checkEveryTokenResolves: OK');
}
checkEveryTokenResolves();

function checkEverybodyGetsOnAir() {
  // A crew member nobody ever writes a line for is a face on a desk for no
  // reason. Across the whole library, each of the four should speak somewhere.
  const spoke = {};
  studio.SEGMENTS.forEach(function (seg) {
    seg.beats.forEach(function (b) { spoke[b.who] = true; });
  });
  studio.CREW.forEach(function (m) {
    assert.ok(spoke[m.key], m.key + ' never speaks in any segment');
  });
  console.log('checkEverybodyGetsOnAir: OK');
}
checkEverybodyGetsOnAir();

function checkSelectionPicksByPriorityAndSituation() {
  const trailingBadly = studio.selectSegment(fullContext({ trailing: true, margin: 18 }),
    { rand: function () { return 0; } });
  assert.ok(trailingBadly, 'a blowout matches something');

  const leading = studio.selectSegment(fullContext({ trailing: false, leading: true, margin: 18 }),
    { rand: function () { return 0; } });
  assert.ok(leading, 'a big lead matches something');
  assert.notStrictEqual(trailingBadly.id, leading.id,
    'being up 18 and down 18 should not get the same segment');
  console.log('checkSelectionPicksByPriorityAndSituation: OK');
}
checkSelectionPicksByPriorityAndSituation();

function checkThereIsAlwaysSomethingToShow() {
  // Unlike the interview scenes there is no generic pool to fall back on, so
  // one segment must accept any halftime or the show silently no-ops.
  [
    fullContext({ trailing: false, leading: false, margin: 0 }),
    fullContext({ trailing: true, margin: 1 }),
    fullContext({ leading: true, trailing: false, margin: 40 }),
    fullContext({ trailing: true, margin: 40, isPlayoff: true })
  ].forEach(function (ctx, i) {
    const seg = studio.selectSegment(ctx, { rand: function () { return 0; } });
    assert.ok(seg, 'context ' + i + ' produced no segment at all');
    assert.ok(seg.beats.length >= 3, 'context ' + i + ' produced an empty segment');
  });
  console.log('checkThereIsAlwaysSomethingToShow: OK');
}
checkThereIsAlwaysSomethingToShow();

function checkAThrowingPredicateIsDroppedNotFatal() {
  const pool = [
    { id: 'broken', priority: 99, when: function () { throw new Error('boom'); },
      beats: [{ who: studio.HOST_KEY, emotion: 'neutral', text: 'x' }] },
    { id: 'fine', priority: 1, when: function () { return true; },
      beats: [{ who: studio.HOST_KEY, emotion: 'neutral', text: 'y' }] }
  ];
  const got = studio.selectSegment(fullContext(), { segments: pool, rand: function () { return 0; } });
  assert.strictEqual(got.id, 'fine', 'a throwing predicate was skipped, not propagated');
  console.log('checkAThrowingPredicateIsDroppedNotFatal: OK');
}
checkAThrowingPredicateIsDroppedNotFatal();

function checkRecentSegmentsAreSkipped() {
  const pool = [
    { id: 'just-aired', priority: 90, when: function () { return true; },
      beats: [{ who: studio.HOST_KEY, emotion: 'neutral', text: 'x' }] },
    { id: 'next-up', priority: 10, when: function () { return true; },
      beats: [{ who: studio.HOST_KEY, emotion: 'neutral', text: 'y' }] }
  ];
  const got = studio.selectSegment(fullContext(),
    { segments: pool, recent: ['just-aired'], rand: function () { return 0; } });
  assert.strictEqual(got.id, 'next-up', 'a recently aired segment is passed over');

  // But if EVERYTHING is recent, the show must still go on rather than
  // returning nothing — the buffer is a preference, not a veto.
  const all = studio.selectSegment(fullContext(),
    { segments: pool, recent: ['just-aired', 'next-up'], rand: function () { return 0; } });
  assert.ok(all, 'with everything recent it still airs something');
  console.log('checkRecentSegmentsAreSkipped: OK');
}
checkRecentSegmentsAreSkipped();

function checkTheHintOutranksTheSituation() {
  // A named man going 3-for-14 is a better halftime story than the margin, and
  // it is the only segment that leads anywhere. It has to win.
  const withSlump = fullContext({ slumpName: 'J. Tatum', slumpFgm: 3, slumpFga: 14, slumpPoints: 7 });
  const seg = studio.selectSegment(withSlump, { rand: function () { return 0; } });
  assert.ok(/slump/.test(seg.id), 'a slump night should air the slump segment, got ' + seg.id);

  // Both a trailing and a leading slump have to be covered, or half the time
  // the hint silently does not appear.
  const leading = studio.selectSegment(
    fullContext({ trailing: false, leading: true, margin: 9, slumpName: 'J. Tatum', slumpFgm: 3, slumpFga: 14 }),
    { rand: function () { return 0; } });
  assert.ok(/slump/.test(leading.id), 'a slump while leading should also air one, got ' + leading.id);
  console.log('checkTheHintOutranksTheSituation: OK');
}
checkTheHintOutranksTheSituation();

function checkNoSlumpSegmentFiresWithoutASlump() {
  // Naming a man who is not struggling would make the hint untrustworthy, and
  // the coach's payoff option would point at nobody.
  const seg = studio.selectSegment(fullContext({ slumpName: null }), { rand: function () { return 0; } });
  assert.ok(!/slump/.test(seg.id), 'no slump, no slump segment, got ' + seg.id);
  console.log('checkNoSlumpSegmentFiresWithoutASlump: OK');
}
checkNoSlumpSegmentFiresWithoutASlump();

function checkTheHintIsNotSignposted() {
  // Noticing the connection IS the mechanic. A beat that says "tell your
  // coach" hands it over and there is nothing left to spot.
  const giveaways = /tell (your|the) coach|talk to (your|the) coach|remember this|hint|next screen/i;
  studio.SEGMENTS.forEach(function (seg) {
    seg.beats.forEach(function (b) {
      assert.ok(!giveaways.test(b.text), seg.id + ' signposts the hint: "' + b.text + '"');
    });
  });
  console.log('checkTheHintIsNotSignposted: OK');
}
checkTheHintIsNotSignposted();

function checkTheShowCarriesNoConsequences() {
  // Watch-only by design: a segment must have no choices and no effects.
  studio.SEGMENTS.forEach(function (seg) {
    assert.strictEqual(seg.choices, undefined, seg.id + ' has choices; the show is watch-only');
    seg.beats.forEach(function (b) {
      assert.strictEqual(b.effect, undefined, seg.id + ' beat carries an effect');
    });
  });
  console.log('checkTheShowCarriesNoConsequences: OK');
}
checkTheShowCarriesNoConsequences();

console.log('All studio show validations passed');
