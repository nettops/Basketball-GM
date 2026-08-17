// Did the loop actually close?
//
// The whole point of recording shot zones was that a GM could set the
// three-point dial on the coaching screen and see whether the shot mix moved.
// Every validator can pass and that can still be false — the counters could be
// perfectly consistent with each other and completely deaf to the dial. This
// probe is the only thing that checks the feature does what it was built for.
//
// Three questions, in order of how badly a "no" would hurt:
//
//   1. Does the league's zone split look like basketball? The engine's own
//      calibration comments claim ~30% of attempts from three; if this reads
//      far from that, the counters are wired to the wrong branch.
//   2. Does moving team.strategy.threePointRate move that team's share? If
//      not, the readout added to ui/coaching.js is decoration.
//   3. Do transition possessions finish at the rim more often than half-court
//      ones? simEnginePossession calibrated TRANSITION_INSIDE_MULT to put ~63%
//      of break shots inside, and that number has never been observable from
//      outside the engine before.
//
// Reports. Does not assert — scripts/validate-shotZones.js is where the
// invariants live.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js');
const gameSim = rq('gameSim.js');
const league = rq('league.js');

const GAMES_PER_MATCHUP = 40;

function emptyTotals() {
  return { inside: 0, mid: 0, three: 0, insideM: 0, midM: 0, threeM: 0 };
}

function addLine(totals, line) {
  totals.inside += line.insideFga || 0;
  totals.mid += line.midFga || 0;
  totals.three += line.tpa || 0;
  totals.insideM += line.insideFgm || 0;
  totals.midM += line.midFgm || 0;
  totals.threeM += line.tpm || 0;
}

function shares(t) {
  const total = t.inside + t.mid + t.three;
  if (!total) return { inside: 0, mid: 0, three: 0, total: 0 };
  return {
    inside: t.inside / total, mid: t.mid / total, three: t.three / total, total: total
  };
}

function pct(made, att) { return att > 0 ? (made / att * 100).toFixed(1) + '%' : '   —  '; }
function pctNum(x) { return (x * 100).toFixed(1).padStart(5) + '%'; }

// ---- 1. What the league's shot diet looks like ----

function leagueWideSplit() {
  const totals = emptyTotals();
  let games = 0;
  for (let i = 0; i < TEAMS.length; i += 2) {
    const home = TEAMS[i], away = TEAMS[(i + 1) % TEAMS.length];
    for (let g = 0; g < GAMES_PER_MATCHUP; g++) {
      const result = gameSim.simulateGame(home.id, away.id, makeRng(90000 + i * 1000 + g));
      Object.keys(result.boxScore).forEach(function (id) { addLine(totals, result.boxScore[id]); });
      games += 1;
    }
  }
  const s = shares(totals);
  console.log('=== 1. League shot diet (' + games + ' games, ' + s.total + ' attempts) ===');
  console.log('  zone        share     FG%');
  console.log('  at the rim ' + pctNum(s.inside) + '   ' + pct(totals.insideM, totals.inside));
  console.log('  mid-range  ' + pctNum(s.mid) + '   ' + pct(totals.midM, totals.mid));
  console.log('  three      ' + pctNum(s.three) + '   ' + pct(totals.threeM, totals.three));
  console.log('  expected ~30% from three, per simEnginePossession\'s own calibration.');
  console.log('');
  return s;
}

// ---- 2. Does the dial move the mix? ----
//
// The same two teams, the same seeds, the only difference being the home
// team's threePointRate. Same seeds matter: a different sample would confound
// the dial's effect with ordinary variance.

function dialSweep() {
  const home = TEAMS[0], away = TEAMS[1];
  const homeRoster = league.getTeamRoster(home.id).map(function (p) { return p.id; });
  const settings = [-1, -0.5, 0, 0.5, 1];
  const rows = [];

  settings.forEach(function (dial) {
    const team = TEAMS[0];
    team.strategy = { pace: 0, threePointRate: dial };
    const totals = emptyTotals();
    for (let g = 0; g < GAMES_PER_MATCHUP * 2; g++) {
      const result = gameSim.simulateGame(home.id, away.id, makeRng(4200 + g));
      homeRoster.forEach(function (id) {
        if (result.boxScore[id]) addLine(totals, result.boxScore[id]);
      });
    }
    rows.push({ dial: dial, s: shares(totals) });
  });
  TEAMS[0].strategy = { pace: 0, threePointRate: 0 };

  console.log('=== 2. Does the three-point dial move the shot mix? ===');
  console.log('  dial     three share   rim share   attempts');
  rows.forEach(function (r) {
    console.log('  ' + String(r.dial).padStart(4) + '     ' + pctNum(r.s.three) +
      '      ' + pctNum(r.s.inside) + '     ' + r.s.total);
  });
  const swing = (rows[rows.length - 1].s.three - rows[0].s.three) * 100;
  console.log('  swing from lowest to highest setting: ' + swing.toFixed(2) + ' pts of three-point share.');
  console.log(swing > 1
    ? '  VERDICT: the dial moves the mix. The readout on the coaching screen is real.'
    : '  VERDICT: THE DIAL DOES NOTHING VISIBLE. The feature has failed regardless of tests.');
  console.log('');
  return swing;
}

// ---- 3. Transition vs half court ----
//
// Read straight off the possession engine's own zone picker rather than out of
// a box score, because a box score has no idea which possessions were breaks.

function transitionSplit() {
  const poss = rq('simEnginePossession.js');
  const players = league.getTeamRoster(TEAMS[0].id).concat(league.getTeamRoster(TEAMS[1].id));
  const half = { inside: 0, mid: 0, three: 0 };
  const fast = { inside: 0, mid: 0, three: 0 };
  const rng = makeRng(31337);
  const DRAWS = 40000;
  for (let i = 0; i < DRAWS; i++) {
    const shooter = players[i % players.length];
    half[poss.pickShotZone(shooter, rng, false, null)] += 1;
    fast[poss.pickShotZone(shooter, rng, true, null)] += 1;
  }
  const h = shares({ inside: half.inside, mid: half.mid, three: half.three, insideM: 0, midM: 0, threeM: 0 });
  const f = shares({ inside: fast.inside, mid: fast.mid, three: fast.three, insideM: 0, midM: 0, threeM: 0 });
  console.log('=== 3. Transition vs half court (' + DRAWS + ' draws each) ===');
  console.log('             rim       mid      three');
  console.log('  half court ' + pctNum(h.inside) + '  ' + pctNum(h.mid) + '  ' + pctNum(h.three));
  console.log('  transition ' + pctNum(f.inside) + '  ' + pctNum(f.mid) + '  ' + pctNum(f.three));
  console.log('  engine calibrated transition to ~63% at the rim while holding the three roughly flat.');
  console.log('');
}

// ---- 4. The pace dial, and what it costs ----
//
// Pace and points are the same lever arithmetically — see the
// POSSESSION_BASE_SECONDS comment in gameSim.js — so unlike the three-point
// dial this one IS a scoring dial. That is fine for a control the user chose to
// move, and it is the reason every AI team sits at 0. This measures how much,
// so the size of the concession is on the record rather than assumed.
//
// Both columns matter: BOTH teams at the setting is the extreme case, and the
// user's team alone against a neutral league is the case that actually happens.

function paceSweep() {
  const home = TEAMS[0], away = TEAMS[1];
  const homeRoster = league.getTeamRoster(home.id).map(function (p) { return p.id; });

  function run(homeDial, awayDial) {
    home.strategy = { pace: homeDial, threePointRate: 0 };
    away.strategy = { pace: awayDial, threePointRate: 0 };
    let points = 0, fga = 0;
    const games = GAMES_PER_MATCHUP * 2;
    for (let g = 0; g < games; g++) {
      const result = gameSim.simulateGame(home.id, away.id, makeRng(4200 + g));
      points += result.homeScore;
      homeRoster.forEach(function (id) {
        if (result.boxScore[id]) fga += result.boxScore[id].fga;
      });
    }
    return { ppg: points / games, fga: fga };
  }

  console.log('=== 4. What the pace dial buys ===');
  console.log('  setting            home ppg   team FGA');
  [
    ['both slow    ', -1, -1], ['user slow    ', -1, 0], ['neutral      ', 0, 0],
    ['user fast    ', 1, 0], ['both fast    ', 1, 1], ['opposed      ', 1, -1]
  ].forEach(function (row) {
    const r = run(row[1], row[2]);
    console.log('  ' + row[0] + '      ' + r.ppg.toFixed(1).padStart(6) + '     ' + r.fga);
  });
  home.strategy = { pace: 0, threePointRate: 0 };
  away.strategy = { pace: 0, threePointRate: 0 };
  console.log('  Every AI team sits at 0, so "user fast/slow" is the case that occurs in a real save.');
  console.log('  "opposed" must equal "neutral" exactly — the two share one clock.');
  console.log('');
}

const leagueShares = leagueWideSplit();
const swing = dialSweep();
transitionSplit();
paceSweep();

console.log('=== summary ===');
console.log('  league three-point share: ' + pctNum(leagueShares.three));
console.log('  dial swing:               ' + swing.toFixed(2) + ' pts');
