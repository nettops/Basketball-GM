// A scouting system that prints the true rating is not a scouting system.
//
// The draft board rendered `p.overall` — the exact number — in a column beside
// a pill reading "Unscouted", and then SORTED the board by that same exact
// number. Either half alone gives the game away: you could ignore the pill and
// read the rating, or ignore the rating and take the top row. Spending a
// scouting point could not tell you anything you did not already have.
//
// These checks protect both halves, because a fix to one and not the other
// leaves the exploit intact.
const assert = require('assert');
const path = require('path');
function req(name) { return require(path.join(__dirname, '..', name)); }

const data = req('data.js');
req('traits.js');
const scouting = req('scouting.js');

// rawOverall is DELIBERATELY a different number from overall, and deliberately
// wrong for this purpose. The two are separate scales in the real data — a
// prospect showing 81 on the draft board carries a rawOverall of 38 — and the
// first version of this file set them equal, which let a fog that read the
// wrong field pass every check here and then print 38 in the browser.
function fixture(id, overall) {
  return {
    id: id, name: 'Prospect ' + id,
    overall: overall,
    rawOverall: Math.max(0, Math.round(overall * 0.55))
  };
}

// A spread of ids so the per-player bias is exercised, not one lucky hash.
const POOL = [];
for (let i = 0; i < 300; i++) POOL.push(fixture('p' + i, 45 + (i % 45)));

function checkFullyScoutedIsExact() {
  POOL.forEach(function (p) {
    const r = scouting.scoutedOverallRange(p, 70);
    assert.strictEqual(r.level, 'exact');
    assert.strictEqual(r.exact, p.overall, 'a fully scouted player must read true');
    assert.strictEqual(scouting.scoutedOverallLabel(r), String(p.overall));
    assert.strictEqual(scouting.scoutedOverallSortKey(r), p.overall);
  });
  console.log('checkFullyScoutedIsExact: OK (' + POOL.length + ' players at 70% confidence)');
}
checkFullyScoutedIsExact();

// The leak the whole file exists to close: below full confidence nothing may
// hand back the true number, in any field or any rendering.
function checkUnscoutedNeverExposesTheTruth() {
  [0, 15, 29, 30, 50, 69].forEach(function (confidence) {
    POOL.forEach(function (p) {
      const r = scouting.scoutedOverallRange(p, confidence);
      assert.strictEqual(r.exact, null,
        'confidence ' + confidence + ' returned an exact rating');
      assert.ok(scouting.scoutedOverallLabel(r).indexOf('–') !== -1,
        'confidence ' + confidence + ' rendered a single number instead of a range');
    });
  });
  console.log('checkUnscoutedNeverExposesTheTruth: OK (6 confidence levels)');
}
checkUnscoutedNeverExposesTheTruth();

// A band always centred on the truth hands you the answer as its midpoint,
// which is the same leak wearing a disguise. The midpoint has to be wrong for
// a real share of players, in BOTH directions.
function checkTheBandIsNotCentredOnTheTruth() {
  let over = 0, under = 0, dead = 0;
  POOL.forEach(function (p) {
    const key = scouting.scoutedOverallSortKey(scouting.scoutedOverallRange(p, 0));
    if (key > p.overall) over += 1;
    else if (key < p.overall) under += 1;
    else dead += 1;
  });
  assert.ok(over > POOL.length * 0.15, 'almost nobody scouts HIGH: ' + over + '/' + POOL.length);
  assert.ok(under > POOL.length * 0.15, 'almost nobody scouts LOW: ' + under + '/' + POOL.length);
  console.log('checkTheBandIsNotCentredOnTheTruth: OK (' + over + ' over, ' +
    under + ' under, ' + dead + ' exact by chance)');
}
checkTheBandIsNotCentredOnTheTruth();

// The other half of the exploit. If the fogged board still ranks in true-rating
// order, the numbers can stay hidden and the top row is still the right pick.
function checkSortOrderNoLongerMatchesTheTruth() {
  const byTruth = POOL.slice().sort(function (a, b) { return b.overall - a.overall; })
    .map(function (p) { return p.id; });
  const byBelief = POOL.slice().sort(function (a, b) {
    return scouting.scoutedOverallSortKey(scouting.scoutedOverallRange(b, 0)) -
      scouting.scoutedOverallSortKey(scouting.scoutedOverallRange(a, 0));
  }).map(function (p) { return p.id; });
  let moved = 0;
  for (let i = 0; i < byTruth.length; i++) if (byTruth[i] !== byBelief[i]) moved += 1;
  assert.ok(moved > POOL.length * 0.5,
    'the fogged board still ranks in true order: only ' + moved + ' of ' +
    POOL.length + ' rows moved');
  console.log('checkSortOrderNoLongerMatchesTheTruth: OK (' + moved + '/' +
    POOL.length + ' rows differ from the true ranking)');
}
checkSortOrderNoLongerMatchesTheTruth();

// Stable across calls. A number that re-rolls on every repaint could be
// averaged back to the truth by opening and closing the view, and would make
// the table flicker while you read it.
function checkTheSameQuestionGetsTheSameAnswer() {
  POOL.forEach(function (p) {
    const a = scouting.scoutedOverallRange(p, 10);
    const b = scouting.scoutedOverallRange(p, 10);
    assert.deepStrictEqual(a, b, 'a scouting read changed between two calls');
  });
  console.log('checkTheSameQuestionGetsTheSameAnswer: OK');
}
checkTheSameQuestionGetsTheSameAnswer();

// Wrong, but not absurd: the scout's range must still contain the real rating,
// and must never quote a number outside the rating scale.
function checkTheRangeStaysHonestAndInBounds() {
  [0, 40].forEach(function (confidence) {
    POOL.forEach(function (p) {
      const r = scouting.scoutedOverallRange(p, confidence);
      assert.ok(r.low <= p.overall && p.overall <= r.high,
        'the true rating ' + p.overall + ' fell outside the scout range ' +
        r.low + '–' + r.high);
      assert.ok(r.low >= data.RATING_MIN && r.high <= data.RATING_MAX,
        'range ' + r.low + '–' + r.high + ' leaves the rating scale');
    });
  });
  // And the partial read has to be worth paying for: a narrower band than none.
  const wide = scouting.scoutedOverallRange(POOL[0], 0);
  const narrow = scouting.scoutedOverallRange(POOL[0], 40);
  assert.ok((narrow.high - narrow.low) < (wide.high - wide.low),
    'scouting to 40% told you nothing the 0% read did not');
  console.log('checkTheRangeStaysHonestAndInBounds: OK (partial band ' +
    (narrow.high - narrow.low) + ' wide vs unscouted ' + (wide.high - wide.low) + ')');
}
checkTheRangeStaysHonestAndInBounds();

// The clamp must not silently swallow the fog at the ends of the scale.
function checkTheScaleEndsStillFog() {
  [data.RATING_MIN, data.RATING_MAX].forEach(function (edge) {
    const r = scouting.scoutedOverallRange(fixture('edge' + edge, edge), 0);
    assert.strictEqual(r.exact, null);
    assert.ok(r.high > r.low, 'a rating at ' + edge + ' collapsed to a single value');
  });
  console.log('checkTheScaleEndsStillFog: OK');
}
checkTheScaleEndsStillFog();

// The field the fog reads must be the field the board prints.
function checkTheFogTracksTheDisplayedRating() {
  const p = fixture('display-check', 81);
  assert.notStrictEqual(p.overall, p.rawOverall, 'the fixture must exercise the two scales');
  assert.strictEqual(scouting.scoutedOverallRange(p, 90).exact, p.overall,
    'a fully scouted read returned the raw scale instead of the displayed rating');
  const fogged = scouting.scoutedOverallRange(p, 0);
  assert.ok(fogged.low <= p.overall && p.overall <= fogged.high,
    'the fogged band ' + fogged.low + '-' + fogged.high +
    ' does not contain the displayed rating ' + p.overall);
  console.log('checkTheFogTracksTheDisplayedRating: OK (overall ' + p.overall +
    ', rawOverall ' + p.rawOverall + ')');
}
checkTheFogTracksTheDisplayedRating();

console.log('All scouting fog validations passed');
