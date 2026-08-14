const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
const box = require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

function weightSort(roster) {
  return roster.slice().sort(function (a, b) {
    return box.minutesWeight(b) - box.minutesWeight(a);
  });
}

function ids(players) {
  return players.map(function (p) { return p.id; });
}

// The opt-in guarantee. Every league that never touches this feature must get
// the exact ordering the sim used before it existed — this is the same
// property the gamesim/rollover goldens assert end-to-end, checked here
// directly so a failure names the team rather than a drifted score.
function checkNoPickIsIdentical() {
  TEAMS.forEach(function (t) {
    const roster = league.getTeamRoster(t.id);
    const expected = ids(weightSort(roster));
    assert.deepStrictEqual(ids(box.lineupOrder(roster, t)), expected,
      t.id + ' drifted with no startingFive');
    assert.deepStrictEqual(
      ids(box.lineupOrder(roster, Object.assign({}, t, { startingFive: [] }))),
      expected, t.id + ' drifted with an empty startingFive');
    assert.deepStrictEqual(ids(box.lineupOrder(roster, null)), expected,
      t.id + ' drifted with no team at all');
  });
  console.log('checkNoPickIsIdentical: OK');
}

// A pick leads in the USER'S order, and everyone else keeps their old relative
// order — the bench is still ranked by rating, only the promotion is manual.
function checkPickLeads() {
  const t = TEAMS[0];
  const roster = league.getTeamRoster(t.id);
  const auto = ids(weightSort(roster));
  const picks = [auto[auto.length - 1], auto[auto.length - 2]];   // two worst
  const out = ids(box.lineupOrder(roster, Object.assign({}, t, { startingFive: picks })));
  assert.deepStrictEqual(out.slice(0, 2), picks, 'picked players must lead, in the order given');
  const rest = auto.filter(function (id) { return picks.indexOf(id) === -1; });
  assert.deepStrictEqual(out.slice(2), rest, 'remaining players must keep relative order');
  console.log('checkPickLeads: OK');
}

// Stale ids (a traded starter) and duplicates must not drop or clone anybody.
function checkJunkIdsIgnored() {
  const t = TEAMS[0];
  const roster = league.getTeamRoster(t.id);
  const auto = ids(weightSort(roster));
  const last = auto[auto.length - 1];
  const out = ids(box.lineupOrder(roster,
    Object.assign({}, t, { startingFive: ['nope-not-a-player', last, last] })));
  assert.strictEqual(out[0], last, 'the one valid pick still leads');
  assert.strictEqual(out.length, roster.length, 'no players dropped or duplicated');
  assert.deepStrictEqual(out.slice().sort(), auto.slice().sort(), 'same set of players');
  console.log('checkJunkIdsIgnored: OK');
}

// However many ids are stored, only a FIVE is ever promoted.
function checkCapsAtFive() {
  const t = TEAMS[0];
  const roster = league.getTeamRoster(t.id);
  const auto = ids(weightSort(roster));
  const picks = auto.slice(-6);                       // six worst players
  const out = ids(box.lineupOrder(roster, Object.assign({}, t, { startingFive: picks })));
  assert.deepStrictEqual(out.slice(0, 5), picks.slice(0, 5), 'only the first five are promoted');
  assert.ok(out.indexOf(picks[5]) >= 5, 'the sixth stored id is not promoted');
  console.log('checkCapsAtFive: OK');
}

// The failure mode no structural test catches: the pick is stored, the strip
// shows it, and the coach quietly plays whoever he likes anyway. Asserted on
// MINUTES OUT OF A REAL GAME rather than on targetMinutes, so it also fails if
// some later substitution rule undoes the promotion a possession later.
function checkPickChangesMinutes() {
  const home = TEAMS[0];
  const away = TEAMS[1];
  const roster = league.getTeamRoster(home.id).filter(function (p) { return !p.status.injury; });
  const auto = ids(weightSort(roster));
  const worstFive = auto.slice(-5);

  function minutesFor(playerIds) {
    let total = 0;
    const games = 12;
    for (let seed = 1; seed <= games; seed++) {
      const res = gameSim.simulateGame(home.id, away.id, makeRng(seed));
      playerIds.forEach(function (id) {
        const line = res.boxScore[id];
        if (line) total += line.minutes;
      });
    }
    return total / games;
  }

  delete home.startingFive;
  const before = minutesFor(worstFive);
  home.startingFive = worstFive;
  const after = minutesFor(worstFive);
  delete home.startingFive;

  assert.ok(after > before * 1.5,
    'starting the five worst players must raise their minutes, got ' +
    before.toFixed(1) + ' -> ' + after.toFixed(1));
  console.log('checkPickChangesMinutes: OK (' + before.toFixed(1) + ' -> ' +
    after.toFixed(1) + ' team minutes for the worst five)');
}

checkNoPickIsIdentical();
checkPickLeads();
checkJunkIdsIgnored();
checkCapsAtFive();
checkPickChangesMinutes();
console.log('All lineup validations passed');
