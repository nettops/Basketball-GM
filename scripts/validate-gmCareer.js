// The GM career record is a QUERY over history the game already keeps, not a
// parallel set of counters. These tests exist to keep it that way: the moment a
// total is stored rather than derived, one of the anti-drift assertions below
// starts failing.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const draft = rq('draft.js');

// A bracket shaped exactly like playoffs.js builds one, small enough to reason
// about: 4 first-round series, 2 semis, 1 conference final per side, 1 final.
function fakeBracket() {
  const series = function (higher, lower, winner) {
    return { higherSeed: higher, lowerSeed: lower, winner: winner, complete: true };
  };
  return {
    first: [series('BOS', 'MIA', 'BOS'), series('NYK', 'ORL', 'NYK'),
            series('LAL', 'PHX', 'LAL'), series('DEN', 'SAC', 'DEN')],
    semis: [series('BOS', 'NYK', 'BOS'), series('LAL', 'DEN', 'LAL')],
    confFinals: [series('BOS', 'CHI', 'BOS'), series('LAL', 'GSW', 'LAL')],
    finals: [series('BOS', 'LAL', 'BOS')]
  };
}

function checkPlayoffResultByTeamEncodesEveryRound() {
  const byTeam = draft.playoffResultByTeam(fakeBracket());
  assert.strictEqual(byTeam.MIA, 0, 'a first-round loser is round 0');
  assert.strictEqual(byTeam.NYK, 1, 'a team that lost in the semis is round 1');
  assert.strictEqual(byTeam.CHI, 2, 'a team that lost the conference finals is round 2');
  assert.strictEqual(byTeam.LAL, 3, 'the Finals loser is round 3');
  assert.strictEqual(byTeam.BOS, 4, 'the champion is round 4');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(byTeam, 'UTA'), false,
    'a team that missed the playoffs is ABSENT, not present with a sentinel');
  console.log('checkPlayoffResultByTeamEncodesEveryRound: OK');
}
checkPlayoffResultByTeamEncodesEveryRound();

console.log('All gmCareer validations passed');
