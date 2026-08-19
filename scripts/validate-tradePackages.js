// You cannot buy quality with quantity.
//
// evaluateTeamLeg used to ADD player values up, and a plain sum says three
// replacement-level bodies are worth exactly as much as their ratings add to.
// Measured through the real Propose Trade gate across all 870 club pairs, 6.8%
// of them would hand over their best player for a bundle of the worst men on
// your roster. A roster is not a warehouse: five places on the floor and one
// ball, and the fourth piece in a package plays almost none of the minutes the
// man he replaced was playing.
//
// EVERY CHECK BELOW USES CONTROLLED FIXTURES, not real rosters, and that is the
// point rather than laziness. The first version of this file asserted over live
// teams that "a star must not be buyable with three scrubs" and failed 12 of 26
// — until the failures were actually read. Boston's best player is a 36-year-old
// on $49M, and three cheap younger players for him is a rebuild, not a robbery.
// adjustedPlayerValue weighs age and contract on purpose, so any test that
// treats OVR as value is measuring the wrong thing and will demand the evaluator
// get WORSE. Holding age and money equal is the only way to isolate the one
// property this file exists to protect.
const assert = require('assert');
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const traits = req('traits.js');
req('scouting.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const league = req('league.js');
const { TEAMS } = req('teams.js');
const ev = req('tradeEvaluator.js');

const team = TEAMS[0];

// Identical in every respect the evaluator reads except the rating: same age,
// same money, same contract length. Anything left is quantity against quality.
function twin(overall, id) {
  return {
    id: id, name: 'Fixture ' + id, teamId: team.id, age: 26,
    overall: overall, rawOverall: overall, potential: overall,
    contract: { salary: 10000000, yearsRemaining: 3, playerOption: false, teamOption: false },
    status: { morale: 70, fatigue: 0, injury: null },
    attributes: {}, seasonStats: null, careerStats: null, championshipsWon: 0
  };
}

function checkAnExtraPieceStillAddsSomething() {
  const a = twin(70, 'a'), b = twin(70, 'b'), c = twin(70, 'c');
  const one = ev.packageValue([a], team, null);
  const two = ev.packageValue([a, b], team, null);
  const three = ev.packageValue([a, b, c], team, null);
  assert.ok(two > one, 'a second player must still ADD value — this is a discount, not a cap');
  assert.ok(three > two, 'and so must a third');
  console.log('checkAnExtraPieceStillAddsSomething: OK (' + one.toFixed(0) + ' / ' +
    two.toFixed(0) + ' / ' + three.toFixed(0) + ')');
}
checkAnExtraPieceStillAddsSomething();

// The property that closes the exploit: N identical players are worth strictly
// less than N times one of them.
function checkQuantityIsDiscounted() {
  const pieces = ['a', 'b', 'c', 'd'].map(function (id) { return twin(70, id); });
  const single = ev.packageValue([pieces[0]], team, null);
  const four = ev.packageValue(pieces, team, null);
  assert.ok(four < single * 4,
    'four identical players priced at ' + four.toFixed(0) + ', the same as a flat sum');
  assert.ok(four < single * 2.5,
    'the discount is not biting: four identical players priced at ' + four.toFixed(0) +
    ' against a single ' + single.toFixed(0));
  console.log('checkQuantityIsDiscounted: OK (4 identical priced at ' +
    (four / single).toFixed(2) + 'x one of them, not 4.00x)');
}
checkQuantityIsDiscounted();

// THE regression test, with age and money held equal so only rating varies.
// Three clearly worse players must not out-price one clearly better one.
function checkThreeWorseMenDoNotOutpriceOneBetter() {
  const star = twin(88, 'star');
  const scrubs = [twin(52, 's1'), twin(50, 's2'), twin(48, 's3')];
  const starValue = ev.packageValue([star], team, null);
  const scrubValue = ev.packageValue(scrubs, team, null);
  assert.ok(scrubValue < 0.9 * starValue,
    'three players in the low 50s priced at ' + scrubValue.toFixed(0) +
    ' against an 88 at ' + starValue.toFixed(0) + ' — quantity is still buying quality');
  console.log('checkThreeWorseMenDoNotOutpriceOneBetter: OK (three at ~50 = ' +
    scrubValue.toFixed(0) + ', one at 88 = ' + starValue.toFixed(0) + ')');
}
checkThreeWorseMenDoNotOutpriceOneBetter();

// Two genuinely good players for one great one is a REAL trade and has to keep
// working, or the fix has simply banned multi-player deals.
function checkTwoGoodPlayersCanStillLandAStar() {
  const star = twin(88, 'star');
  const good = [twin(80, 'g1'), twin(78, 'g2')];
  assert.ok(ev.packageValue(good, team, null) >= 0.9 * ev.packageValue([star], team, null),
    'an 80 and a 78 can no longer buy an 88 — the discount has banned real trades');
  console.log('checkTwoGoodPlayersCanStillLandAStar: OK');
}
checkTwoGoodPlayersCanStillLandAStar();

// Order must not matter. The pieces are ranked internally, so handing them over
// worst-first has to price identically — otherwise the exploit comes straight
// back by reordering the checkboxes.
function checkOrderDoesNotChangeThePrice() {
  const pieces = [twin(80, 'x'), twin(55, 'y'), twin(70, 'z')];
  const forward = ev.packageValue(pieces, team, null);
  const backward = ev.packageValue(pieces.slice().reverse(), team, null);
  assert.ok(Math.abs(forward - backward) < 1e-9,
    'the same players priced differently by order: ' + forward + ' vs ' + backward);
  console.log('checkOrderDoesNotChangeThePrice: OK');
}
checkOrderDoesNotChangeThePrice();

// And the whole thing must still be reachable from a real league: if no live
// roster can produce a multi-player package at all, the checks above are
// testing a code path the game never runs.
function checkRealRostersStillTrade() {
  let multi = 0;
  TEAMS.slice(0, 8).forEach(function (t) {
    const roster = league.getTeamRoster(t.id).slice(0, 3);
    if (roster.length >= 2 && ev.packageValue(roster, t, null) > 0) multi += 1;
  });
  assert.ok(multi >= 6, 'multi-player packages do not price on real rosters');
  console.log('checkRealRostersStillTrade: OK (' + multi + '/8 clubs price a package)');
}
checkRealRostersStillTrade();

console.log('All trade package validations passed');
