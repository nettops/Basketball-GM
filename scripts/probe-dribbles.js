// How often does a man actually put the ball on the floor, and for how long?
//
// The move vocabulary shipped in 88a0ee3 was measured AFTER the fact and came
// out 83% crossover — two new moves accounting for one possession in six. That
// went unnoticed because nothing counted them. This probe is the counter, and
// it runs BEFORE the calibration rather than after it.
//
// Target distribution, over eligible on-ball possessions (see below):
//
//   0 dribbles   50%      catch and shoot, no on-ball work
//   2 dribbles   25%      a put-down in place
//   4-6          15%      clear out and work: crossover or behind the back
//   7+           10%      the double move
//
// TWO INDEPENDENT WALKS, deliberately. The denominator is re-derived from the
// EVENT LOG — not read off the timeline — because a probe that asks the
// choreographer both "how many were eligible" and "how many fired" can only
// ever report 100% and would not have caught the lopsided mix either. The
// numerator walks the timeline and reads the `handle` marker the choreographer
// stamps on the first beat of a dribble string.
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
const league = rq('league.js');
const choreo = rq(path.join('ui', 'pixelChoreographer.js'));

const GAMES = Number(process.env.GAMES || 40);

// Eligibility, re-implemented from the event log rather than imported. This is
// the possession set the dribble roll is drawn over: someone is working on the
// ball against a defender, outside. A big sealing his man under the rim is not
// this, and never was — that exclusion predates the dribble model.
function eligibleFromEvents(events) {
  let n = 0;
  const onCourt = { home: [], away: [] };
  events.forEach(function (ev) {
    if (ev.lineups) {
      if (ev.lineups.home) onCourt.home = ev.lineups.home;
      if (ev.lineups.away) onCourt.away = ev.lineups.away;
    }
    if (ev.type !== 'shot') return;
    if (!ev.defenderId) return;
    if (ev.zone === 'inside') return;
    const five = onCourt.home.concat(onCourt.away);
    if (five.length && five.indexOf(ev.playerId) === -1) return;
    n += 1;
  });
  return n;
}

function bucketOf(n) {
  if (n <= 0) return '0';
  if (n <= 3) return '2';
  if (n <= 6) return '4-6';
  return '7+';
}

const buckets = { '0': 0, '2': 0, '4-6': 0, '7+': 0 };
const moves = {};
let eligibleTotal = 0, durationTotal = 0, beatsTotal = 0;
let handleBeats = 0;
let stepbacks = 0;

const rng = makeRng(20260810);
for (let g = 0; g < GAMES; g++) {
  const home = TEAMS[g % TEAMS.length];
  const away = TEAMS[(g * 7 + 13) % TEAMS.length];
  if (home.id === away.id) continue;
  const events = [];
  const result = gameSim.simulateGame(home.id, away.id, rng, { events: events });
  const session = {
    events: events,
    homeRoster: league.getTeamRoster(home.id),
    awayRoster: league.getTeamRoster(away.id),
    boxScore: result.boxScore
  };
  const tl = choreo.buildTimeline(session);

  const eligible = eligibleFromEvents(events);
  eligibleTotal += eligible;
  durationTotal += tl.durationMs;
  beatsTotal += tl.keyframes.length;

  let marked = 0;
  tl.keyframes.forEach(function (kf) {
    if (!kf.handle) return;
    marked += 1;
    buckets[bucketOf(kf.handle.n)] += 1;
    moves[kf.handle.move || 'none'] = (moves[kf.handle.move || 'none'] || 0) + 1;
    handleBeats += kf.handle.n;
  });
  // The stepback is counted off its OWN marker, not off `handle`.
  //
  // It is choreography laid on the end of a handle rather than a handle of its
  // own, and marking it as a second string made every stepback possession count
  // twice in the distribution above — which dropped the no-dribble share from
  // 44.3% to 36.5% against a 50% target and read exactly like the roll drifting.
  tl.keyframes.forEach(function (kf) {
    if (kf.step && kf.step.phase === 'plant') stepbacks += 1;
  });
  // Everything eligible that did NOT get a marker put up a shot without
  // dribbling. That is the 0 bucket, and it is inferred from the difference
  // rather than stamped, so a choreographer that silently stopped marking
  // would show up as 100% zeroes instead of as a clean sheet.
  buckets['0'] += Math.max(0, eligible - marked);
}

const rows = ['0', '2', '4-6', '7+'];
const target = { '0': 50, '2': 25, '4-6': 15, '7+': 10 };
const total = rows.reduce(function (s, k) { return s + buckets[k]; }, 0) || 1;

console.log('games ' + GAMES + '   eligible on-ball possessions ' + (eligibleTotal / GAMES).toFixed(1) + '/game');
console.log('');
console.log('dribbles   share   target   per game');
rows.forEach(function (k) {
  const share = (buckets[k] / total) * 100;
  console.log('  ' + k.padEnd(9) + (share.toFixed(1) + '%').padStart(6) +
    (target[k] + '%').padStart(9) + (buckets[k] / GAMES).toFixed(2).padStart(11));
});
console.log('');
console.log('moves      ' + JSON.stringify(moves));
console.log('dribbles put on the floor  ' + (handleBeats / GAMES).toFixed(1) + '/game');
console.log('stepbacks  ' + (stepbacks / GAMES).toFixed(2) + '/game (finishing move, not a handle)');
console.log('timeline   ' + (durationTotal / GAMES / 1000).toFixed(1) + 's/game at 1x, ' +
  (beatsTotal / GAMES).toFixed(0) + ' beats');
