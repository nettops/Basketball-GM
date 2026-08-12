// Every rule the game STATES must also bind on the path the user actually
// takes.
//
// This file exists because the same defect kept recurring in different
// clothes, and each instance was found by a player rather than by the suite:
//
//   - the salary cap was enforced inside generateAIOffer, so the user's
//     bidding path was bound by nothing and could sign a $1,000,000,000 deal
//   - the salary box was guarded and the years box beside it was not, so
//     $5,000,000 x 99 years signed cleanly
//   - the bidding contest computed userWinning every round and enforced it
//     nowhere, so a 91-overall could be had at the league minimum while
//     eleven teams bid up to $31,833,686
//
// The shape is always one of two things: a rule written inside one caller, or
// a value computed and then discarded. The two cases below are the remaining
// instances found by auditing every surface the user can act on.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const league = rq('league.js');
const trade = rq('trade.js');
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
const coach = rq('gameCoach.js');
const gameSim = rq('gameSim.js');

global.GameState = { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };

// Accepting an offer from the inbox is a trade and has to leave both rosters
// legal. Both accept paths called executeTrade raw, so the 12-15 rule was
// enforced when BUILDING a trade and skipped when accepting one. An offer is
// legal when autoGM generates it and can go stale sitting there.
function checkAcceptingAnOfferKeepsRostersLegal() {
  const sizes = TEAMS.map(function (t) { return { id: t.id, n: league.getTeamRoster(t.id).length }; });
  const big = sizes.slice().sort(function (a, b) { return b.n - a.n; })[0];
  const small = sizes.slice().sort(function (a, b) { return a.n - b.n; })[0];
  // Move enough bodies that the sending team drops under the floor.
  const count = big.n - 11;
  assert.ok(count >= 1, 'fixture needs a team that can be emptied below 12');
  const give = league.getTeamRoster(big.id).slice(0, count);
  const proposal = {
    participants: [big.id, small.id],
    assignments: give.map(function (p) { return { playerId: p.id, fromTeamId: big.id, toTeamId: small.id }; }),
    pickAssignments: []
  };

  assert.ok(trade.validateRosterSizes(proposal).length > 0,
    'precondition: this proposal must be illegal, ' + big.id + ' would end on ' + (big.n - count));

  const before = { big: league.getTeamRoster(big.id).length, small: league.getTeamRoster(small.id).length };
  const result = trade.acceptTradeOffer(proposal, null);
  assert.strictEqual(result.executed, false, 'an illegal offer must not execute on accept');
  assert.ok(result.rosterErrors.length > 0, 'and must say what is wrong');
  assert.strictEqual(league.getTeamRoster(big.id).length, before.big,
    'no player may move when the trade is refused');
  assert.strictEqual(league.getTeamRoster(small.id).length, before.small);

  // ...and a legal one still goes through.
  const one = league.getTeamRoster(big.id)[0];
  const legal = {
    participants: [big.id, small.id],
    assignments: [{ playerId: one.id, fromTeamId: big.id, toTeamId: small.id }],
    pickAssignments: []
  };
  assert.strictEqual(trade.validateRosterSizes(legal).length, 0, 'precondition: a 1-for-0 must be legal here');
  const ok = trade.acceptTradeOffer(legal, null);
  assert.strictEqual(ok.executed, true, 'a legal offer must still execute');
  assert.strictEqual(one.teamId, small.id, 'and must actually move the player');
  one.teamId = big.id;
  console.log('checkAcceptingAnOfferKeepsRostersLegal: OK');
}

// gameCoach refuses to field a six-foul player and ui/pixelHud disables his
// sub button with the title "Fouled out". The model never checked, so
// re-enabling that button put a disqualified player back on the floor —
// measured at 23 minutes and 113 of 226 possessions.
function checkFouledOutPlayerCannotBeFielded() {
  const sim = gameSim.createGameSim('BOS', 'LAL', makeRng(5), {});
  sim.step();
  const box = sim.result().boxScore;
  const onFloor = sim.onCourt.home.slice();
  const bench = league.getTeamRoster('BOS').map(function (p) { return p.id; })
    .filter(function (id) { return box[id] && onFloor.indexOf(id) === -1; })[0];
  assert.ok(bench, 'need a bench player with a box line');

  // Below the bar he is a legal substitution — this is what proves the guard
  // reads FOULS and not something incidental about being on the bench.
  box[bench].fouls = coach.FOUL_OUT - 1;
  sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: sim.onCourt.home[0], in: bench }] });
  sim.step();
  assert.notStrictEqual(sim.onCourt.home.indexOf(bench), -1,
    'a player one foul short of disqualification must still be substitutable');

  // Now foul him out and try to keep him on for the rest of the game.
  box[bench].fouls = coach.FOUL_OUT;
  let onCount = 0, steps = 0;
  while (!sim.done && steps < 4000) {
    if (sim.onCourt.home.indexOf(bench) === -1) {
      sim.applyDecision({ type: 'substitution', team: 'home', swaps: [{ out: sim.onCourt.home[0], in: bench }] });
    }
    sim.step();
    steps++;
    if (sim.onCourt.home.indexOf(bench) !== -1) onCount++;
  }
  assert.ok(steps > 50, 'the game must actually have run, got ' + steps + ' steps');
  assert.strictEqual(onCount, 0,
    'a fouled-out player was on the floor for ' + onCount + ' of ' + steps + ' possessions');
  console.log('checkFouledOutPlayerCannotBeFielded: OK (0 of ' + steps + ' possessions)');
}

// The commissioner's Force Trade is an explicit cheat that skips value and
// salary — and it STILL validates roster sizes. Accepting an ordinary offer
// was the only trade path in the game that did not, which is the clearest
// statement of how the omission read.
function checkEvenTheCheatValidatesRosters() {
  const commissioner = rq('commissioner.js');
  const sizes = TEAMS.map(function (t) { return { id: t.id, n: league.getTeamRoster(t.id).length }; });
  const big = sizes.slice().sort(function (a, b) { return b.n - a.n; })[0];
  const small = sizes.slice().sort(function (a, b) { return a.n - b.n; })[0];
  const give = league.getTeamRoster(big.id).slice(0, big.n - 11);
  const proposal = {
    participants: [big.id, small.id],
    assignments: give.map(function (p) { return { playerId: p.id, fromTeamId: big.id, toTeamId: small.id }; }),
    pickAssignments: []
  };
  const forced = commissioner.forceTrade(proposal, null);
  assert.strictEqual(forced.success, false,
    'even the sanctioned cheat must refuse to break the roster minimum');
  console.log('checkEvenTheCheatValidatesRosters: OK');
}

// An offer names SPECIFIC players and sits in the inbox for days. Waive the
// player it asks you for, then accept: executeTrade assigned him to the other
// team regardless of the fact that he was a free agent by then, and handed you
// their player anyway. Reproduced through the real Accept button — Boston gave
// away a man it no longer owned and still received Chicago's.
//
// Roster-size validation does NOT catch this: the counts still balance,
// because the assignment list says one out and one in whatever the truth is.
function checkStaleOfferIsRefused() {
  const sizes = TEAMS.map(function (t) { return { id: t.id, n: league.getTeamRoster(t.id).length }; });
  const a = sizes.slice().sort(function (x, y) { return y.n - x.n; })[0];
  const b = sizes.filter(function (x) { return x.id !== a.id; })
    .sort(function (x, y) { return y.n - x.n; })[0];
  const mine = league.getTeamRoster(a.id)[0];
  const theirs = league.getTeamRoster(b.id)[0];
  const proposal = {
    participants: [a.id, b.id],
    assignments: [
      { playerId: mine.id, fromTeamId: a.id, toTeamId: b.id },
      { playerId: theirs.id, fromTeamId: b.id, toTeamId: a.id }
    ],
    pickAssignments: []
  };
  assert.strictEqual(trade.acceptTradeOffer(proposal, null).executed, true,
    'precondition: the offer is legal while both players are where it says');
  // put it back
  mine.teamId = a.id; theirs.teamId = b.id;

  // Now go stale: the player it asks for is waived before you accept.
  mine.teamId = null;
  const result = trade.acceptTradeOffer(proposal, null);
  assert.strictEqual(result.executed, false,
    'an offer naming a player you no longer own must be refused');
  assert.ok((result.staleAssignments || []).length > 0, 'and must say which player is stale');
  assert.strictEqual(theirs.teamId, b.id,
    'you must NOT receive their player from a refused trade');
  assert.strictEqual(mine.teamId, null,
    'and the waived player must stay a free agent, not be handed over');
  mine.teamId = a.id;
  console.log('checkStaleOfferIsRefused: OK');
}

checkStaleOfferIsRefused();
checkAcceptingAnOfferKeepsRostersLegal();
checkFouledOutPlayerCannotBeFielded();
checkEvenTheCheatValidatesRosters();

console.log('All user-path rule validations passed');
