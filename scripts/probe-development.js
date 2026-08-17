// Does a season in the affiliate league actually beat a season on the bench?
//
// If it does not, the whole affiliate league is scenery — thirty schedules and
// four hundred and fifty simulated games in service of a roster exemption. This
// is the number that says whether sending a prospect down is a development
// decision or a cap trick.
//
// Probes report; they do not assert.
const path = require('path');

function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const { TEAMS } = req('teams.js');
const traits = req('traits.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const progression = req('progression.js');
const prospects = req('draftProspects.js');
const affiliates = req('affiliates.js');
const ratings = req('ratings.js');

const TRIALS = 400;
const SEASONS = 3;

// A fresh prospect each trial, cloned so both careers start from the same man.
function makeProspect(rng) {
  return prospects.generateProspectClass(rng, 1, 2026)[0];
}

// rawOverall is a DERIVED getter installed by ratings.defineOverall, not a
// stored field — a plain key copy loses it and every gain below reads NaN.
// The clone gets its own attributes object and the getter re-installed on top.
function cloneFor(source, sentDown) {
  const copy = {};
  Object.keys(source).forEach(function (k) { copy[k] = source[k]; });
  copy.attributes = Object.assign({}, source.attributes);
  ratings.defineOverall(copy);
  copy.teamId = TEAMS[0].id;
  copy.twoWay = sentDown
    ? { down: true, gamesDown: affiliates.AFFILIATE_GAMES_PER_TEAM }
    : { down: false, gamesDown: 0 };
  return copy;
}

let downTotal = 0, benchTotal = 0, downWins = 0, ties = 0;
const rng = makeRng(2718);

for (let t = 0; t < TRIALS; t++) {
  const source = makeProspect(rng);
  const start = source.rawOverall;

  const down = cloneFor(source, true);
  const bench = cloneFor(source, false);

  // The SAME dice for both careers, so the only difference between them is
  // where he spent the year. Anything else and this measures the rng.
  for (let s = 0; s < SEASONS; s++) {
    const seed = Math.floor(rng() * 1e9);
    progression.progressPlayer(down, makeRng(seed), [], {});
    progression.progressPlayer(bench, makeRng(seed), [], {});
    // A season's worth of affiliate games each year he is down.
    if (down.twoWay.down) down.twoWay.gamesDown = affiliates.AFFILIATE_GAMES_PER_TEAM;
  }

  const downGain = down.rawOverall - start;
  const benchGain = bench.rawOverall - start;
  downTotal += downGain;
  benchTotal += benchGain;
  if (downGain > benchGain) downWins++;
  else if (downGain === benchGain) ties++;
}

console.log('development over ' + SEASONS + ' seasons, ' + TRIALS + ' prospects, same dice both ways');
console.log('');
console.log('  played for the affiliate:  +' + (downTotal / TRIALS).toFixed(2) + ' overall');
console.log('  sat on the parent bench:   +' + (benchTotal / TRIALS).toFixed(2) + ' overall');
console.log('  gap:                       ' +
  ((downTotal - benchTotal) / TRIALS >= 0 ? '+' : '') +
  ((downTotal - benchTotal) / TRIALS).toFixed(2) + ' overall');
console.log('');
console.log('  developed better by playing: ' + (downWins / TRIALS * 100).toFixed(1) + '%' +
  (ties ? '  (ties: ' + (ties / TRIALS * 100).toFixed(1) + '%)' : ''));
console.log('');
console.log('A gap near zero means the affiliate league is scenery and sending a');
console.log('prospect down is only a roster exemption.');
