// Measures whether games behave like basketball games rather than like 100
// independent coin flips.
//
// The engine had NO game-state feedback: every possession in a 40-point blowout
// was played exactly like a tie game. That is why mean |margin| bottomed out at
// 15.8 no matter how the shot divisors were tuned — the randomness was already
// exactly what independent shooting implies, and real basketball sits BELOW
// that floor because real games self-correct.
//
// Four numbers, and the third is a GUARD, not a target:
//
//   |margin|      mean absolute final margin        real ~11
//   close%        share of games inside 5 points    real ~33%
//   hold20        share of 20+ point leads entering the 4th that HOLD UP
//                 -> real ~95%. A comeback mechanic that hands those back is
//                    not drama, it is noise. This must stay high.
//   comeback15    share of games where a team trailing by 15+ at any point
//                 after halftime went on to win  -> real ~5-8%
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');

const GAMES = Number(process.env.GAMES || 600);
const mean = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };

// The score DURING the game, which no returned artifact carries: play-by-play
// entries hold only { text, check }, and captured events hold period and clock
// but no score. Driving the sim a step at a time and reading sim.homeScore /
// sim.awayScore / sim.period is the only way to see what a game looked like
// before it ended — and "did a 20-point lead hold up" is unanswerable without
// it. A first cut of this probe parsed play-by-play, silently found no scores,
// and reported both headline numbers as n/a.
function playTracked(homeId, awayId, rng) {
  const sim = gameSim.createGameSim(homeId, awayId, rng, {});
  const track = [];
  while (!sim.done) {
    sim.step();
    track.push({ period: sim.period, home: sim.homeScore, away: sim.awayScore });
  }
  return { track: track, homeScore: sim.homeScore, awayScore: sim.awayScore };
}

const margins = [];
let hold20Chances = 0, hold20Held = 0;
let comeback15Chances = 0, comeback15Won = 0;

const rng = makeRng(20260810);
for (let i = 0; i < GAMES; i++) {
  const h = TEAMS[i % TEAMS.length];
  const a = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
  if (h.id === a.id) continue;
  const r = playTracked(h.id, a.id, rng);
  const finalMargin = r.homeScore - r.awayScore;
  margins.push(Math.abs(finalMargin));

  const track = r.track;
  if (track.length === 0) continue;

  // Entering the 4th: the last recorded state in period 3.
  let entering4th = null;
  for (let k = track.length - 1; k >= 0; k--) {
    if (track[k].period === 3) { entering4th = track[k]; break; }
  }
  if (entering4th) {
    const lead = entering4th.home - entering4th.away;
    if (Math.abs(lead) >= 20) {
      hold20Chances += 1;
      if (Math.sign(lead) === Math.sign(finalMargin)) hold20Held += 1;
    }
  }

  // Trailed by 15+ at any point after halftime, then won.
  let worstHome = 0, worstAway = 0;
  track.forEach(function (t) {
    if (t.period < 3) return;
    const d = t.home - t.away;
    if (d < worstHome) worstHome = d;
    if (-d < worstAway) worstAway = -d;
  });
  if (worstHome <= -15) { comeback15Chances += 1; if (finalMargin > 0) comeback15Won += 1; }
  if (worstAway <= -15) { comeback15Chances += 1; if (finalMargin < 0) comeback15Won += 1; }
}

const pct = function (n, d) { return d > 0 ? (100 * n / d).toFixed(1) + '%' : 'n/a'; };
console.log('COMEBACK / GAME-SHAPE PROBE — ' + margins.length + ' games');
console.log('  mean |margin|   ' + mean(margins).toFixed(2) + '        (real NBA ~11)');
console.log('  close (<=5)     ' + pct(margins.filter(function (v) { return v <= 5; }).length, margins.length) +
            '        (real NBA ~33%)');
console.log('  blowouts (>=25) ' + pct(margins.filter(function (v) { return v >= 25; }).length, margins.length) +
            '        (real NBA ~8%)');
console.log('  hold20  ' + pct(hold20Held, hold20Chances) + ' of ' + hold20Chances +
            ' twenty-point 4th-qtr leads held   (real ~95%) <- GUARD, keep high');
console.log('  comeback15  ' + pct(comeback15Won, comeback15Chances) + ' of ' + comeback15Chances +
            ' second-half 15-pt holes erased  (real ~5-8%)');
