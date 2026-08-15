// Where do ankle breakers actually go?
//
// The rate check in validate-impactMoments.js counts classifyImpact on raw
// events. That is ONE boundary. Between the sim producing a breakdown and the
// user seeing anything there are four, and a drop at any of them looks
// identical from the outside — "I have not seen one in a while".
//
//   1. classified   — classifyImpact says 'ankle'
//   2. marker       — an ankle impact marker reached a keyframe (drives the
//                     freeze, the zoom, the flash)
//   3. crossover    — the jab/cross/clear/recover choreography was built, and
//                     the defender actually stumbles. This is the thing that
//                     LOOKS like an ankle breaker.
//   4. speed gate   — impactQualifies at the playback speed the user watches
//
// Run: node scripts/probe-ankle-breakers.js [gamesPerPair]
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
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));
const impact = require(path.join(__dirname, '..', 'ui', 'pixelImpact.js'));

const PER_PAIR = Number(process.argv[2]) || 3;

const byId = {};
TEAMS.forEach(function (t) {
  league.getTeamRoster(t.id).forEach(function (p) { byId[p.id] = p; });
});

const n = {
  games: 0, madeShots: 0,
  classified: 0, marker: 0, crossover: 0,
  // Why a classified ankle never became a crossover.
  lostShooterOffFloor: 0, lostNoDefender: 0, lostDefenderOffFloor: 0, lostInside: 0
};
const visible = { 1: 0, 2: 0, 4: 0, 8: 0 };
const crossMs = [];

for (let i = 0; i < TEAMS.length; i++) {
  const home = TEAMS[i], away = TEAMS[(i + 9) % TEAMS.length];
  for (let g = 0; g < PER_PAIR; g++) {
    const seed = 4200 + i * 100 + g;
    const events = [];
    const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
    n.games++;

    events.forEach(function (e) {
      if (e.type === 'shot' && e.made) n.madeShots++;
      if (choreo.classifyImpact(e, byId[e.playerId], byId[e.defenderId]) !== 'ankle') return;
      n.classified++;
      // The crossover's own preconditions, counted so a shortfall names itself
      // rather than needing a second investigation.
      if (!e.defenderId) n.lostNoDefender++;
      else if (e.zone === 'inside') n.lostInside++;
    });

    const kfs = choreo.buildTimeline({
      events: events,
      homeRoster: league.getTeamRoster(home.id),
      awayRoster: league.getTeamRoster(away.id),
      boxScore: result.boxScore
    }).keyframes;

    // How long the move is actually on screen. A crossover that fires at a
    // healthy rate but lasts 60ms of wall time has not "stopped firing" — it
    // has stopped being perceptible, and those look identical from the couch.
    let crossStart = null;
    kfs.forEach(function (kf) {
      if (!kf.cross) { crossStart = null; return; }
      if (kf.cross.phase === 'jab' && crossStart === null) crossStart = kf.t;
      if (kf.cross.phase === 'recover' && crossStart !== null) {
        crossMs.push(kf.t - crossStart);
        crossStart = null;
      }
    });

    let lastCross = null;
    kfs.forEach(function (kf) {
      if (kf.impact && kf.impact.kind === 'ankle') {
        n.marker++;
        [1, 2, 4, 8].forEach(function (sp) {
          if (impact.impactQualifies('ankle', sp)) visible[sp]++;
        });
      }
      // One crossover spans several keyframes (jab, cross, clear, recover).
      // Counted once, on the phase that names the move.
      if (kf.cross && kf.cross.phase === 'cross' && kf.cross !== lastCross) {
        n.crossover++;
        lastCross = kf.cross;
      }
    });
  }
}

const per = function (v) { return (v / n.games).toFixed(2); };
console.log('games:               ' + n.games);
console.log('made shots/game:     ' + per(n.madeShots));
console.log('');
console.log('1. classified:       ' + per(n.classified) + '/game');
console.log('2. marker on a kf:   ' + per(n.marker) + '/game');
console.log('3. crossover drawn:  ' + per(n.crossover) + '/game   <- what LOOKS like an ankle breaker');
console.log('');
console.log('4. survives the speed gate, per game:');
[1, 2, 4, 8].forEach(function (sp) {
  console.log('     ' + sp + 'x:              ' + per(visible[sp]) +
    (impact.impactQualifies('ankle', sp) ? '' : '   <- gated out entirely'));
});
console.log('');
if (crossMs.length) {
  crossMs.sort(function (a, b) { return a - b; });
  const med = crossMs[Math.floor(crossMs.length / 2)];
  console.log('the move itself lasts ' + Math.round(med) + 'ms of game time (median of ' +
    crossMs.length + '). On screen that is:');
  [1, 2, 4, 8].forEach(function (sp) {
    const ms = Math.round(med / sp);
    const emphasised = impact.impactQualifies('ankle', sp);
    console.log('     ' + sp + 'x:  ' + String(ms).padStart(4) + 'ms' +
      (emphasised ? '  + freeze/zoom/flash' : '  bare, no emphasis at all'));
  });
  console.log('');
}
console.log('classified but no defender on the event: ' + per(n.lostNoDefender) + '/game');
console.log('classified but the shot was inside:      ' + per(n.lostInside) + '/game');
