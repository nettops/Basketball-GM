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

// A hand-built trade was the last path where the salary-matching law never
// ran against the user's own team: evaluateTrade stamped the user's leg
// accepted unconditionally, so a team with no cap space could absorb any
// salary at all. The VALUE judgment stays the user's own — a lopsided trade
// they build by hand is theirs to make — but the salary rule is league law
// and now binds both legs. The Disable Salary Cap setting remains the one
// way past it, same as free agency.
//
// Mutates contracts and (in the passing cases) executes real trades, so it
// restores what it touches and runs LAST.
function checkUserTradeCannotAbsorbUnlimitedSalary() {
  GameState.userTeamId = 'BOS';
  const other = TEAMS.find(function (t) { return t.id !== 'BOS'; });
  const mine = league.getTeamRoster('BOS')[0];
  const theirs = league.getTeamRoster(other.id)[0];
  const saved = [
    { p: mine, teamId: mine.teamId, salary: mine.contract.salary, jersey: mine.jerseyNumber },
    { p: theirs, teamId: theirs.teamId, salary: theirs.contract.salary, jersey: theirs.jerseyNumber }
  ];
  function restore() {
    saved.forEach(function (s) { s.p.teamId = s.teamId; s.p.contract.salary = s.salary; s.p.jerseyNumber = s.jersey; });
  }
  function proposal() {
    return {
      participants: ['BOS', other.id],
      assignments: [
        { playerId: mine.id, fromTeamId: 'BOS', toTeamId: other.id },
        { playerId: theirs.id, fromTeamId: other.id, toTeamId: 'BOS' }
      ],
      pickAssignments: []
    };
  }

  try {
    // The grab: send the minimum, take back $60M. The AI side accepts (its
    // salary DROPS and the incoming value clears its 0.9 bar once the $60M
    // contract's burden is priced in) — so only the user's leg stands
    // between this and execution.
    mine.contract.salary = 1200000;
    theirs.contract.salary = 60000000;
    const cap = rq('data.js').getEffectiveSalaryCap(1);
    const space = cap - league.getTeamPayroll('BOS');
    const increase = theirs.contract.salary - mine.contract.salary;
    assert.ok(increase > mine.contract.salary * 0.25 + 2000000 && increase > space,
      'precondition: the increase must bust both the matching band and cap space');

    const grab = trade.proposeTrade(proposal(), 'BOS', false, null);
    assert.ok(grab.legs[other.id] && grab.legs[other.id].accepted,
      'precondition: the AI side must accept, so the user leg is what decides — got ' +
      JSON.stringify(grab.legs[other.id]));
    assert.strictEqual(grab.accepted, false,
      'a hand-built trade must not absorb salary past both the band and cap space');
    assert.strictEqual(grab.legs.BOS.salaryOk, false, 'the refusal must sit on the user leg');
    assert.ok(typeof grab.legs.BOS.suggestion === 'string' && grab.legs.BOS.suggestion.length > 0,
      'and must carry a reason the Trade Center can show');
    assert.strictEqual(mine.teamId, 'BOS', 'no player may move on a refused trade');
    assert.strictEqual(theirs.teamId, other.id);

    // The user's freedom on VALUE survives: same players at equal salaries is
    // a terrible-value trade for whoever gives up the better man, and it must
    // still execute — the salary law is the ONLY new bar on the user's leg.
    mine.contract.salary = 20000000;
    theirs.contract.salary = 20000000;
    const lopsided = trade.proposeTrade(proposal(), 'BOS', false, null);
    assert.strictEqual(lopsided.accepted, true,
      'equal salaries must pass regardless of value: the user leg judges salary only — legs: ' +
      JSON.stringify(lopsided.legs));
    assert.strictEqual(mine.teamId, other.id, 'and the trade must actually execute');
    restore();

    // The setting keeps its promise: cap disabled, the $60M grab goes through.
    mine.contract.salary = 1200000;
    theirs.contract.salary = 60000000;
    GameState.settings.capDisabled = true;
    const uncapped = trade.proposeTrade(proposal(), 'BOS', false, null);
    assert.strictEqual(uncapped.accepted, true,
      'with the cap disabled the same trade must go through — that is what the setting is for');
  } finally {
    GameState.settings.capDisabled = false;
    restore();
  }
  console.log('checkUserTradeCannotAbsorbUnlimitedSalary: OK');
}

checkStaleOfferIsRefused();
checkAcceptingAnOfferKeepsRostersLegal();
checkFouledOutPlayerCannotBeFielded();
checkEvenTheCheatValidatesRosters();
checkUserTradeCannotAbsorbUnlimitedSalary();

console.log('All user-path rule validations passed');
