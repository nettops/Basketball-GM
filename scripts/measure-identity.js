// The single measurement every task in docs/superpowers/plans/2026-08-08-ratings-and-overall.md
// is judged against. Prints a fixed-format report; `--json` emits the same
// numbers as JSON so a task can diff its before and after mechanically.
//
// This is a MEASUREMENT, not a validator: it never asserts, it only reports.
// The assertions live in scripts/validate-ratings.js and (from Task 7)
// scripts/validate-identity.js. Keeping them apart matters — a measurement
// you are allowed to read without it failing the build is how you calibrate
// by measured rate instead of by picked values.
//
// Baseline at the start of the plan is committed to
// docs/superpowers/identity-baseline.txt. Real-NBA comparison numbers quoted
// in the comments are measured from
// reference/zengm/data/real-player-stats.basketball.json, 2025, min 300 FGA.
const path = require('path');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
require(path.join(__dirname, '..', 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const { ATTRIBUTE_KEYS } = require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const composite = require(path.join(__dirname, '..', 'compositeRatings.js'));

const GAMES = 300;
const SEED = 2026;
// Qualification is on MINUTES, not on attempts. Filtering by FGA and then
// measuring FGA spread selects on the very thing being measured and truncates
// the low end: the same league read 2.05x on an FGA>=150 filter and 2.85x on a
// minutes filter. Minutes are opportunity, which is the honest gate.
const MIN_MINUTES = 400;

function pct(arr, p) {
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// How many genuinely distinct players does the league contain? A "shape" is
// the attribute vector with the player's own mean subtracted, so two players
// who differ only in scale collapse onto the same shape. At the plan's
// baseline this was 17 across 380 players: attributes were literally
// `overall + archetypeOffset`, so two players with the same overall and
// archetype were byte-identical.
function attributeShapes() {
  const seen = {};
  PLAYERS_2026.forEach(function (p) {
    const mean = ATTRIBUTE_KEYS.reduce(function (s, k) { return s + p.attributes[k]; }, 0) / ATTRIBUTE_KEYS.length;
    seen[ATTRIBUTE_KEYS.map(function (k) { return Math.round(p.attributes[k] - mean); }).join(',')] = true;
  });
  return Object.keys(seen).length;
}

function attributeDistribution() {
  const all = [];
  PLAYERS_2026.forEach(function (p) {
    ATTRIBUTE_KEYS.forEach(function (k) { all.push(p.attributes[k]); });
  });
  const mean = all.reduce(function (a, b) { return a + b; }, 0) / all.length;
  const sd = Math.sqrt(all.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / all.length);
  return { mean: mean, sd: sd, min: Math.min.apply(null, all), max: Math.max.apply(null, all) };
}

// What fraction of the league clears each synergy bar? These mirror
// computeTeamSynergy's own tests exactly, including its ORs — measuring
// `shootingThree` alone would understate how many players qualify.
function synergyShares() {
  const n = PLAYERS_2026.length;
  const c = function (p, k) { return composite.computeComposite(p, k); };
  return {
    shooter: PLAYERS_2026.filter(function (p) {
      return c(p, 'shootingThree') >= composite.SHOOTER_THRESHOLD ||
             c(p, 'shootingMid') >= composite.SHOOTER_THRESHOLD;
    }).length / n,
    defender: PLAYERS_2026.filter(function (p) {
      return c(p, 'defenseInterior') >= composite.DEFENDER_THRESHOLD ||
             c(p, 'defensePerimeter') >= composite.DEFENDER_THRESHOLD;
    }).length / n,
    rebounder: PLAYERS_2026.filter(function (p) {
      return c(p, 'rebounding') >= composite.REBOUNDER_THRESHOLD;
    }).length / n
  };
}

// Realized league rates and per-player spread over GAMES simulated games.
function simulated() {
  const rng = makeRng(SEED);
  const byId = {};
  PLAYERS_2026.forEach(function (p) { byId[p.id] = p; });
  let fgm = 0, fga = 0, tpm = 0, tpa = 0, pts = 0, g = 0;
  const acc = {};
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 11) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    g += 1;
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      fgm += l.fgm; fga += l.fga; tpm += l.tpm; tpa += l.tpa; pts += l.points;
      const q = acc[id] || (acc[id] = { g: 0, min: 0, pts: 0, fga: 0, tpa: 0, ast: 0, pm: 0 });
      q.g += 1; q.min += l.minutes; q.pts += l.points; q.fga += l.fga; q.tpa += l.tpa;
      q.ast += l.assists; q.pm += (l.plusMinus || 0);
    });
  }
  const qual = Object.keys(acc).filter(function (id) { return byId[id] && acc[id].min >= MIN_MINUTES; });
  const share = qual.map(function (id) { return 100 * acc[id].tpa / acc[id].fga; });
  const vol = qual.map(function (id) { return acc[id].fga / acc[id].min * 36; });
  const ast = qual.map(function (id) { return acc[id].ast / acc[id].min * 36; });
  return {
    games: g,
    n: qual.length,
    fgPct: 100 * fgm / fga,
    tpPct: 100 * tpm / tpa,
    tpaShare: 100 * tpa / fga,
    ptsPerTeam: pts / g / 2,
    threePaP05: pct(share, 0.05),
    threePaP95: pct(share, 0.95),
    volumeRatio: pct(vol, 0.95) / Math.max(0.01, pct(vol, 0.05)),
    assistRatio: pct(ast, 0.95) / Math.max(0.01, pct(ast, 0.05))
  };
}

const report = {
  shapes: attributeShapes(),
  players: PLAYERS_2026.length,
  attributes: attributeDistribution(),
  synergy: synergyShares(),
  sim: simulated()
};

if (process.argv.indexOf('--json') !== -1) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const a = report.attributes, s = report.sim;
  console.log('ATTRIBUTES');
  console.log('  distinct shapes              ' + report.shapes + ' / ' + report.players +
    '            (target: nearly all distinct)');
  console.log('  league mean / sd             ' + a.mean.toFixed(1) + ' / ' + a.sd.toFixed(1) +
    '        (target: ~50 / 11-18)');
  console.log('  min / max                    ' + a.min + ' / ' + a.max);
  console.log('SYNERGY QUALIFYING SHARE                      (target: 15-25%)');
  console.log('  shooter                      ' + (report.synergy.shooter * 100).toFixed(1) + '%');
  console.log('  defender                     ' + (report.synergy.defender * 100).toFixed(1) + '%');
  console.log('  rebounder                    ' + (report.synergy.rebounder * 100).toFixed(1) + '%');
  console.log('LEAGUE (' + s.games + ' games, n=' + s.n + ' players with ' + MIN_MINUTES + '+ min)');
  console.log('  FG%                          ' + s.fgPct.toFixed(1) + '               (target: 46-49)');
  console.log('  3P%                          ' + s.tpPct.toFixed(1) + '               (target: 35-37, NBA 36.3)');
  console.log('  3PA share                    ' + s.tpaShare.toFixed(1) + '%              (hold near 29%)');
  console.log('  pts/game/team                ' + s.ptsPerTeam.toFixed(1) + '              (target: 108-118)');
  console.log('IDENTITY');
  console.log('  3PA share p05-p95            ' + s.threePaP05.toFixed(1) + '% - ' + s.threePaP95.toFixed(1) +
    '%  (' + (s.threePaP95 - s.threePaP05).toFixed(1) + ' pts)   (target ~48, NBA 67)');
  console.log('  shot volume p95:p05          ' + s.volumeRatio.toFixed(2) + 'x' +
    '             (target ~2.5x, NBA 2.9x)');
  console.log('  assist rate p95:p05          ' + s.assistRatio.toFixed(2) + 'x' +
    '             (target 4x+)');
}
