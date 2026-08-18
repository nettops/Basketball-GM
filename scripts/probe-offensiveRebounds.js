// How many offensive rebounds does a game produce, and what happens after one?
//
// Reports, per team-game: missed shots, offensive rebounds, offensive rebound
// rate (share of available misses), and — the number the box score cannot show
// you — how many points were scored on the possession that FOLLOWED an
// offensive board.
//
// Real NBA reference: about 28% of missed shots are rebounded by the offense,
// and second-chance points run 12-14 a game.
const path = require('path');
function req(name) { return require(path.join(__dirname, '..', name)); }

req('data.js');
const { makeRng } = req('rng.js');
const traits = req('traits.js');
const { PLAYERS_2026 } = req('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
req('simEngine.js'); req('simEngineBoxScore.js'); req('simEnginePossession.js');
req('gameCoach.js');
const gameSim = req('gameSim.js');
const { TEAMS } = req('teams.js');

const GAMES = 60;
let misses = 0, offRebs = 0, defRebs = 0, secondChancePts = 0, teamGames = 0;

for (let g = 0; g < GAMES; g++) {
  const home = TEAMS[g % TEAMS.length].id;
  const away = TEAMS[(g * 7 + 3) % TEAMS.length].id;
  if (home === away) continue;
  const events = [];
  gameSim.simulateGame(home, away, makeRng(90210 + g),
    { settings: { simEngine: 'possession' }, events: events });
  teamGames += 2;

  // Second-chance points, the NBA definition: everything the offence scores
  // after an offensive rebound until the ball actually changes hands. That
  // includes a putback missed, rebounded again, and finally scored — so the
  // window closes on a defensive board, a turnover, or a made shot, not on the
  // next `possession` event (a second chance IS a fresh possession event here,
  // because the engine reruns the whole possession function for it).
  let armed = null;
  events.forEach(function (ev) {
    if (ev.type === 'shot') {
      if (!ev.made) misses += 1;
      if (ev.made) {
        if (armed === ev.team) secondChancePts += ev.points;
        armed = null;                       // a bucket ends the possession
      }
    } else if (ev.type === 'foul-ft') {
      if (armed === ev.team) secondChancePts += ev.points;
      armed = null;                         // so does a trip to the line
    } else if (ev.type === 'turnover') {
      armed = null;
    } else if (ev.type === 'rebound') {
      if (ev.offensive) { offRebs += 1; armed = ev.team; }
      else { defRebs += 1; armed = null; }
    }
  });
}

const perTeamGame = function (n) { return (n / teamGames).toFixed(1); };
console.log('games simulated:            ' + (teamGames / 2));
console.log('missed shots / team-game:   ' + perTeamGame(misses));
console.log('off rebounds / team-game:   ' + perTeamGame(offRebs) + '   (NBA ~10-11)');
console.log('def rebounds / team-game:   ' + perTeamGame(defRebs) + '   (NBA ~33)');
console.log('off rebound rate:           ' + (100 * offRebs / (offRebs + defRebs)).toFixed(1) +
  '%  (NBA ~28% of available misses)');
console.log('second-chance pts/team-game:' + perTeamGame(secondChancePts) + '   (NBA ~13)');
