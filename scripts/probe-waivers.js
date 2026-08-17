// How often is a waived player actually claimed?
//
// Near 100% or near 0% both mean the wire is fake — at 100% waiving costs
// nothing and dead money never bites, at 0% the wire is a two-day pause on the
// way to free agency and nobody is ever rescued from a bad contract. The band
// worth landing in is a minority of players claimed, weighted heavily toward
// the ones on cheap deals, because that is what makes the decision to cut a
// good contract different from the decision to cut a bad one.
//
// Probes report; they do not assert.
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

const data = req('data.js');
req('rng.js');
const { TEAMS } = req('teams.js');
const traits = req('traits.js');
req('scouting.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = req('rng.js');
const league = req('league.js');
const freeAgency = req('freeAgency.js');
const rosterMoves = req('rosterMoves.js');
const waivers = req('waivers.js');

const CAP = data.getEffectiveSalaryCap();
const rng = makeRng(90210);

// Give the league a spread of records so claim priority means something —
// at 0-0 across the board the queue is alphabetical and every claim lands on
// the same club, which would make the distribution below a lie.
TEAMS.forEach(function (t, i) {
  t.record = { wins: Math.round(10 + rng() * 50), losses: 0 };
  t.deadMoney = [];
});

const buckets = [
  { label: 'minimum ($1.2M)', salary: freeAgency.MIN_SALARY },
  { label: 'cheap ($4M)', salary: 4000000 },
  { label: 'mid ($12M)', salary: 12000000 },
  { label: 'expensive ($30M)', salary: 30000000 }
];

console.log('waiver claim rate by what the player is owed');
console.log('(a claim inherits the contract whole, so the question is always');
console.log(' "is he worth what he is owed", never "what would we pay him")');
console.log('');
console.log('owed              waived  claimed   rate   clearsToFA');

let grandWaived = 0, grandClaimed = 0;

buckets.forEach(function (bucket) {
  let waived = 0, claimed = 0;

  // A fresh sample of real rostered players each round, restored afterwards so
  // the next bucket sees the same league.
  const sample = TEAMS.map(function (t) {
    const roster = league.getTeamRoster(t.id);
    return roster.length > rosterMoves.ROSTER_MINIMUM ? roster[Math.floor(rng() * roster.length)] : null;
  }).filter(Boolean);

  const restore = sample.map(function (p) {
    return { p: p, teamId: p.teamId, salary: p.contract.salary, years: p.contract.yearsRemaining };
  });

  sample.forEach(function (p) {
    p.contract.salary = bucket.salary;
    p.contract.yearsRemaining = 2;
    const res = rosterMoves.waivePlayer(p.id, 1);
    if (res.success) waived++;
  });

  waivers.resolveWaiverClaims(3, null, undefined).forEach(function (row) {
    if (row.claimedBy) claimed++;
  });

  grandWaived += waived;
  grandClaimed += claimed;

  console.log(
    bucket.label.padEnd(18) +
    String(waived).padStart(5) +
    String(claimed).padStart(9) +
    (waived ? (claimed / waived * 100).toFixed(0) + '%' : '-').padStart(7) +
    String(waived - claimed).padStart(12)
  );

  restore.forEach(function (r) {
    r.p.teamId = r.teamId;
    r.p.contract.salary = r.salary;
    r.p.contract.yearsRemaining = r.years;
    delete r.p.waivers;
  });
  TEAMS.forEach(function (t) { t.deadMoney = []; });
});

console.log('');
console.log('overall: ' + grandClaimed + ' of ' + grandWaived + ' claimed (' +
  (grandClaimed / grandWaived * 100).toFixed(1) + '%)');

// How much room the league actually has is the constraint behind all of it.
const withRoom = TEAMS.filter(function (t) { return league.getTeamPayroll(t.id) < CAP; });
console.log('clubs under the $' + Math.round(CAP / 1e6) + 'M cap: ' + withRoom.length + ' of ' + TEAMS.length +
  ' — everyone else can only absorb the minimum');
