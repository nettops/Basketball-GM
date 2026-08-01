const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkRng() {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB, 'same seed must produce same sequence');
  seqA.forEach(function (v) { assert.ok(v >= 0 && v < 1, 'rng output out of [0,1) range'); });
  const c = makeRng(43);
  assert.notStrictEqual(a(), c(), 'different seeds should (almost certainly) differ');
  console.log('checkRng: OK');
}

checkRng();

const { generateMatchupCounts } = require(path.join(__dirname, '..', 'schedule.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const dataModule = require(path.join(__dirname, '..', 'data.js'));

function checkMatchupCounts() {
  const rng = makeRng(42);
  const gamesCount = generateMatchupCounts(rng);

  let totalGames = 0;
  const bad = [];
  teamsModule.TEAMS.forEach(function (t) {
    const total = Object.values(gamesCount[t.id]).reduce(function (s, n) { return s + n; }, 0);
    totalGames += total;
    if (total !== 82) bad.push([t.id, total]);
  });
  assert.strictEqual(bad.length, 0, 'teams with wrong total games: ' + JSON.stringify(bad));
  assert.strictEqual(totalGames, 82 * 30, 'sum of all teams total games must be 82*30');

  teamsModule.TEAMS.forEach(function (t) {
    const nonDivConfOpponents = teamsModule.TEAMS.filter(function (o) {
      return o.conference === t.conference && o.division !== t.division;
    });
    const fourGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 4; }).length;
    const threeGameCount = nonDivConfOpponents.filter(function (o) { return gamesCount[t.id][o.id] === 3; }).length;
    assert.strictEqual(fourGameCount, 6, t.id + ' should have 6 four-game non-division opponents, got ' + fourGameCount);
    assert.strictEqual(threeGameCount, 4, t.id + ' should have 4 three-game non-division opponents, got ' + threeGameCount);
  });

  console.log('checkMatchupCounts: OK');
}

checkMatchupCounts();
console.log('All sim validations passed');
