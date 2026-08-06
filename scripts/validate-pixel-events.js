const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

const EVENT_TYPES = ['possession', 'turnover', 'block', 'shot', 'rebound', 'foul-ft', 'tiebreak'];

function checkNoRngDrift() {
  // Same seed, capture on vs off: identical results.
  for (let seed = 1; seed <= 10; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const plain = possEngine.simulateGame(home.id, away.id, makeRng(seed));
    const events = [];
    const captured = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });
    assert.strictEqual(captured.homeScore, plain.homeScore, 'homeScore drift at seed ' + seed);
    assert.strictEqual(captured.awayScore, plain.awayScore, 'awayScore drift at seed ' + seed);
    assert.strictEqual(JSON.stringify(captured.boxScore), JSON.stringify(plain.boxScore), 'boxScore drift at seed ' + seed);
    assert.ok(events.length > 0, 'events should have been captured');
  }
  console.log('checkNoRngDrift: OK');
}
checkNoRngDrift();

function checkEventIntegrity() {
  for (let seed = 20; seed < 35; seed++) {
    const home = TEAMS[seed % TEAMS.length];
    const away = TEAMS[(seed + 13) % TEAMS.length];
    if (home.id === away.id) continue;
    const events = [];
    const result = possEngine.simulateGame(home.id, away.id, makeRng(seed), { events: events });

    const homeIds = league.getTeamRoster(home.id).map(function (p) { return p.id; });
    const awayIds = league.getTeamRoster(away.id).map(function (p) { return p.id; });

    let homePts = 0, awayPts = 0, lastQuarter = 1;
    events.forEach(function (ev) {
      assert.ok(EVENT_TYPES.indexOf(ev.type) !== -1, 'unknown event type ' + ev.type);
      assert.ok(ev.team === 'home' || ev.team === 'away', 'event team must be home/away');
      assert.ok(ev.quarter >= lastQuarter, 'quarters must be monotonic');
      lastQuarter = ev.quarter;
      assert.ok(ev.quarter >= 1 && ev.quarter <= 4, 'quarter in range');

      const ownIds = ev.team === 'home' ? homeIds : awayIds;
      const oppIds = ev.team === 'home' ? awayIds : homeIds;
      // rebound team is the rebounder's own side; all types put playerId on ev.team's roster
      assert.ok(ownIds.indexOf(ev.playerId) !== -1, ev.type + ' playerId ' + ev.playerId + ' not on ' + ev.team + ' roster');
      if (ev.defenderId) {
        assert.ok(oppIds.indexOf(ev.defenderId) !== -1, ev.type + ' defenderId not on opposing roster');
      }
      if (ev.type === 'shot' && ev.assistPlayerId) {
        assert.ok(ownIds.indexOf(ev.assistPlayerId) !== -1, 'assistPlayerId not on own roster');
        assert.notStrictEqual(ev.assistPlayerId, ev.playerId, 'no self-assists');
      }
      if (ev.type === 'foul-ft') {
        assert.strictEqual(ev.points, ev.made, 'foul-ft points must equal made');
        assert.ok(ev.made >= 0 && ev.made <= ev.attempts, 'made within attempts');
      }
      const pts = ev.points || 0;
      if (ev.team === 'home') homePts += pts; else awayPts += pts;
    });

    assert.strictEqual(homePts, result.homeScore, 'event points must sum to home score');
    assert.strictEqual(awayPts, result.awayScore, 'event points must sum to away score');

    // Every possession event is eventually followed by a terminal event before the next possession
    let openPossession = false;
    events.forEach(function (ev) {
      if (ev.type === 'possession') {
        assert.ok(!openPossession, 'possession opened while previous still unterminated');
        openPossession = true;
      } else if (ev.type === 'turnover' || ev.type === 'block' || ev.type === 'shot') {
        openPossession = false;
      }
    });
  }
  console.log('checkEventIntegrity: OK');
}
checkEventIntegrity();

console.log('All pixel event validations passed');
