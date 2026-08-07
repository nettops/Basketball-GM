// One-shot generator for the pre-refactor characterization fixture used by
// scripts/validate-gamesim.js. Run this ONCE, before the GameSim refactor,
// and commit the JSON it writes. Re-running it after a deliberate behaviour
// change is how the fixture gets updated (and that must be justified in the
// commit that does it).
const fs = require('fs');
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
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));

// A stable digest of every stat line, so the fixture catches distribution
// changes and not just the final score.
function boxChecksum(boxScore) {
  const keys = Object.keys(boxScore).sort();
  let sum = 0;
  keys.forEach(function (id, idx) {
    const line = boxScore[id];
    ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
     'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fouls'].forEach(function (k, ki) {
      sum = (sum + (line[k] || 0) * (idx + 1) * (ki + 3)) % 2147483647;
    });
  });
  return sum;
}

const CASES = [
  { seed: 1, home: 'BOS', away: 'LAL' },
  { seed: 2, home: 'DEN', away: 'MIA' },
  { seed: 3, home: 'OKC', away: 'NYK' },
  { seed: 4, home: 'MIL', away: 'PHI' },
  { seed: 5, home: 'GSW', away: 'DAL' },
  { seed: 6, home: 'CLE', away: 'MEM' },
  { seed: 7, home: 'SAS', away: 'HOU' },
  { seed: 8, home: 'ORL', away: 'IND' }
];

const out = CASES.map(function (c) {
  const result = gameSim.simulateGame(c.home, c.away, makeRng(c.seed));
  return {
    seed: c.seed, home: c.home, away: c.away,
    homeScore: result.homeScore, awayScore: result.awayScore,
    boxChecksum: boxChecksum(result.boxScore),
    playByPlayLength: result.playByPlay.length
  };
});

const dir = path.join(__dirname, 'fixtures');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'gamesim-golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + out.length + ' golden cases');
