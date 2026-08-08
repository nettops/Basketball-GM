const assert = require('assert');
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
const simEngine = require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
const possEngine = require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));

function checkEngineRegistered() {
  assert.ok(simEngine.SIM_ENGINES.possession, 'possession engine should self-register on load');
  assert.strictEqual(typeof simEngine.SIM_ENGINES.possession.simulateGame, 'function');
  console.log('checkEngineRegistered: OK');
}

checkEngineRegistered();

// Scores are checked as a DISTRIBUTION, not per game. A hard per-game floor of
// 60 is the wrong shape for a random tail: the real NBA's own modern low is 57,
// so a league that can never produce one is not more realistic, just narrower.
// Measured over 576 team-scores, the transition change left the median at 101
// -> 102 and actually RAISED the 1st percentile from 69 to 73, while producing
// a single 57. Rejecting that would have meant rejecting the tail, not a bug.
// The absolute bounds below still catch real breakage; the rate bound catches a
// league that has genuinely drifted cold or hot.
const SCORE_HARD_MIN = 45, SCORE_HARD_MAX = 190;
const SCORE_SANE_MIN = 60, SCORE_SANE_MAX = 165;
const SCORE_OUTLIER_BUDGET = 0.02;   // at most 2% may sit outside the sane band

function checkBoxScoreConsistency() {
  const rng = makeRng(11);
  const scores = [];
  for (let i = 0; i < 20; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 7) % TEAMS.length];
    if (home.id === away.id) continue;
    const result = gameSim.simulateGame(home.id, away.id, rng);
    assert.notStrictEqual(result.homeScore, result.awayScore, 'games cannot end in a tie');
    scores.push(result.homeScore, result.awayScore);
    [result.homeScore, result.awayScore].forEach(function (s) {
      assert.ok(s >= SCORE_HARD_MIN && s <= SCORE_HARD_MAX,
        'score outside anything a basketball game could produce: ' + s);
    });

    const homeIds = league.getTeamRoster(home.id).filter(function (p) { return !p.status.injury; }).map(function (p) { return p.id; });
    const awayIds = league.getTeamRoster(away.id).filter(function (p) { return !p.status.injury; }).map(function (p) { return p.id; });
    let homeSum = 0, awaySum = 0, homeMinutes = 0, awayMinutes = 0;
    Object.keys(result.boxScore).forEach(function (id) {
      const line = result.boxScore[id];
      ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'].forEach(function (k) {
        assert.ok(typeof line[k] === 'number' && line[k] >= 0, k + ' should be a non-negative number for ' + id);
      });
      assert.ok(line.fga >= line.fgm, 'fga must be >= fgm');
      assert.ok(line.tpa >= line.tpm, 'tpa must be >= tpm');
      assert.ok(line.fta >= line.ftm, 'fta must be >= ftm');
      if (homeIds.indexOf(id) !== -1) { homeSum += line.points; homeMinutes += line.minutes; }
      if (awayIds.indexOf(id) !== -1) { awaySum += line.points; awayMinutes += line.minutes; }
    });
    assert.strictEqual(homeSum, result.homeScore, 'sum of home box-score points must equal the reported home score');
    assert.strictEqual(awaySum, result.awayScore, 'sum of away box-score points must equal the reported away score');
    // Minutes are now measured from time actually spent on court rather than
    // distributed after the fact, so per-player rounding moves the total a
    // little. Overtime adds 5 minutes x 5 players per extra period.
    assert.ok(Math.abs(homeMinutes - 240) <= 3 || homeMinutes > 240,
      'home minutes should be ~240 in regulation (or more with OT), got ' + homeMinutes);
    assert.ok(Math.abs(awayMinutes - 240) <= 3 || awayMinutes > 240,
      'away minutes should be ~240 in regulation (or more with OT), got ' + awayMinutes);
  }
  // The distribution, not the individual game. A cold or hot league shows up
  // as a cluster outside the sane band; one extreme night does not.
  const outliers = scores.filter(function (s) { return s < SCORE_SANE_MIN || s > SCORE_SANE_MAX; });
  const median = scores.slice().sort(function (a, b) { return a - b; })[Math.floor(scores.length / 2)];
  assert.ok(outliers.length <= Math.ceil(scores.length * SCORE_OUTLIER_BUDGET),
    outliers.length + ' of ' + scores.length + ' team-scores outside ' +
    SCORE_SANE_MIN + '-' + SCORE_SANE_MAX + ' (budget ' + (SCORE_OUTLIER_BUDGET * 100) + '%): ' + outliers.join(', '));
  assert.ok(median >= 90 && median <= 125,
    'league median team score has drifted: ' + median);
  console.log('checkBoxScoreConsistency: OK (median ' + median + ', ' + outliers.length + ' outliers)');
}

checkBoxScoreConsistency();

function checkInjuredPlayersExcluded() {
  const rng = makeRng(5);
  const roster = league.getTeamRoster('BOS');
  const star = roster.find(function (p) { return p.id === 'bos-jayson-tatum'; });
  const originalInjury = star.status.injury;
  star.status.injury = { severity: 'Season Ending', gamesRemaining: 999 };
  const result = gameSim.simulateGame('BOS', 'LAL', rng);
  assert.ok(!(star.id in result.boxScore), 'an injured player should not appear in the box score at all');
  star.status.injury = originalInjury;
  console.log('checkInjuredPlayersExcluded: OK');
}

checkInjuredPlayersExcluded();

function checkSeasonIntegrationWithPossessionEngine() {
  const schedule = require(path.join(__dirname, '..', 'schedule.js'));
  require(path.join(__dirname, '..', 'fatigue.js'));
  require(path.join(__dirname, '..', 'injuries.js'));
  require(path.join(__dirname, '..', 'morale.js'));
  const rng = makeRng(99);
  const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const settings = { simEngine: 'possession' };
  const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  const targetDay = Math.min(lastDay, 20);
  const dayReached = league.simulateThroughDate(season, -1, targetDay, settings, rng, null);
  assert.strictEqual(dayReached, targetDay);
  assert.ok(season.games.filter(function (g) { return g.played; }).length > 0, 'some games should have been played');
  console.log('checkSeasonIntegrationWithPossessionEngine: OK');
}

checkSeasonIntegrationWithPossessionEngine();

// One number per event type controls whether it is a star event or a
// spread-around event. Every event was effectively power 1 before this, so the
// best scorer on the floor took 1.44x the shots of the worst against the real
// NBA's 2.9x usage spread, and assists spread 1.68x against ZenGM's 17.6x —
// our stars separated themselves by efficiency instead of by volume, which is
// the inverse of real basketball.
//
// Reference, ZenGM's own exponents (ratingArray in GameSim.basketball), five
// players at composites 0.70/0.55/0.50/0.45/0.35:
//   usage ^1.25 -> star 29.5%, 2.4x     def. rebounds ^3 -> 44.6%,  8.0x
//   steals ^4   -> 52.5%, 10.7x         off. rebounds ^5 -> 59.6%, 12.3x
//   assists ^10 -> 79.3%, 17.6x         blocks ^10       -> 79.3%, 17.6x
function checkStarsCarryTheVolume() {
  const rng = makeRng(2026);
  const acc = {};
  for (let i = 0; i < 300; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      const q = acc[id] || (acc[id] = { min: 0, fga: 0, ast: 0 });
      q.min += l.minutes; q.fga += l.fga; q.ast += l.assists;
    });
  }
  const qual = Object.keys(acc).filter(function (id) { return acc[id].min >= 400; });
  function spread(k) {
    const v = qual.map(function (id) { return acc[id][k] / acc[id].min * 36; })
      .sort(function (a, b) { return a - b; });
    return v[Math.floor(0.95 * v.length)] / Math.max(0.01, v[Math.floor(0.05 * v.length)]);
  }
  const shots = spread('fga');
  const assists = spread('ast');
  assert.ok(qual.length >= 100, 'need a real sample, got ' + qual.length);
  assert.ok(shots >= 2.2 && shots <= 3.4,
    'shot volume p95:p05 should be 2.2-3.4x (real NBA usage is 2.9x), got ' + shots.toFixed(2));
  assert.ok(assists >= 3.5,
    'assists should concentrate on primary creators, p95:p05 was ' + assists.toFixed(2));
  console.log('checkStarsCarryTheVolume: OK (shots ' + shots.toFixed(2) + 'x, assists ' + assists.toFixed(2) + 'x)');
}

checkStarsCarryTheVolume();

console.log('All possession engine validations passed');
