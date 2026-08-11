// The Target Rates table from docs/superpowers/plans/2026-08-08-ratings-and-overall.md,
// as assertions. Every bound here is anchored to a real NBA number measured
// from reference/zengm/data/real-player-stats.basketball.json (2025 season,
// min 300 FGA) — not to whatever this engine happened to produce.
//
// Bands, not exact values. This is not a golden master: it must catch the
// league drifting or a formula being read at the wrong point on its curve, and
// it must NOT fail on ordinary rng variation. The two golden masters
// (validate-gamesim, validate-seasonRollover) are what pin exact behaviour.
//
// Reuses scripts/measure-identity.js rather than reimplementing the metrics, so
// the number a calibration sweep reads and the number the build gates on cannot
// drift apart.
const assert = require('assert');
const path = require('path');

const measure = require(path.join(__dirname, 'measure-identity.js'));
const report = measure.report();

// 380 players, 17 distinct attribute shapes at the plan's baseline: attributes
// were literally `overall + archetypeOffset`, so two players with the same
// overall and archetype were byte-identical and the league held 8 people at
// different scales. Everything below is downstream of this one fact.
function checkLeagueIsMadeOfIndividuals() {
  assert.ok(report.shapes >= report.players * 0.97,
    'attribute shapes should be nearly all distinct, got ' + report.shapes + '/' + report.players);
  console.log('checkLeagueIsMadeOfIndividuals: OK (' + report.shapes + '/' + report.players + ')');
}

// Synergy rewards roster CONSTRUCTION. At baseline 65.5% of the league counted
// as shooters, 76.3% as defenders and 70.8% as rebounders — a bonus three
// quarters of the league earns is no bonus. ZenGM's equivalent skill cutoffs
// select roughly the top 10-25%.
function checkSynergyStillDiscriminates() {
  ['shooter', 'defender', 'rebounder'].forEach(function (k) {
    const share = report.synergy[k];
    assert.ok(share >= 0.10 && share <= 0.32,
      k + ' synergy bar selects ' + (share * 100).toFixed(1) + '% of the league, want 10-32%');
  });
  console.log('checkSynergyStillDiscriminates: OK (' +
    ['shooter', 'defender', 'rebounder'].map(function (k) {
      return k + ' ' + (report.synergy[k] * 100).toFixed(1) + '%';
    }).join(', ') + ')');
}

// Every league rate here is anchored on a measured real-NBA value EXCEPT
// points per team, which is a deliberate design target and is not trying to be
// realistic at all. This game aims at a high-scoring 130-140, reached by pace:
// ~114 possessions a team against the real league's ~100, at a normal 48% from
// the field. See POSSESSION_BASE_SECONDS in gameSim.js.
//
// The band below is DELIBERATELY the design target itself rather than a loose
// window around whatever the engine currently produces. Measured 134.7-135.3
// across independent samples, so it sits mid-band with ~5 points of headroom
// each way — tight enough that drift fails it, wide enough that seed noise
// (~0.6) cannot.
function checkLeagueRatesAreRealistic() {
  const s = report.sim;
  assert.ok(s.fgPct >= 45 && s.fgPct <= 50, 'league FG% out of band: ' + s.fgPct.toFixed(1));
  assert.ok(s.tpPct >= 34 && s.tpPct <= 38,
    'league 3P% out of band (NBA 2025: 36.3): ' + s.tpPct.toFixed(1));
  assert.ok(s.tpaShare >= 26 && s.tpaShare <= 34,
    'league 3PA share out of band: ' + s.tpaShare.toFixed(1) + '%');
  assert.ok(s.ptsPerTeam >= 130 && s.ptsPerTeam <= 140,
    'points per team outside the 130-140 design target: ' + s.ptsPerTeam.toFixed(1));
  console.log('checkLeagueRatesAreRealistic: OK (FG% ' + s.fgPct.toFixed(1) +
    ', 3P% ' + s.tpPct.toFixed(1) + ', 3PA ' + s.tpaShare.toFixed(1) +
    '%, ' + s.ptsPerTeam.toFixed(1) + ' pts)');
}

// THE POINT OF THE WHOLE PLAN. Real basketball differentiates players about
// five times more by WHICH shot they take than by how well they make it: NBA
// 2025 per-player 3PA share ran 4.5%-71.6% (67 points) while true 3P% talent
// spanned about 14. This engine had it inverted — 12.7 points of shot-mix
// spread and 1.44x of volume spread, so stars separated themselves by
// efficiency. These two bounds are what stop it regressing.
function checkPlayerIdentityIsInTheShotMix() {
  const s = report.sim;
  const spread = s.threePaP95 - s.threePaP05;
  assert.ok(spread >= 40,
    'per-player 3PA share should span 40+ points (NBA 67), got ' + spread.toFixed(1));
  assert.ok(s.threePaP05 <= 15,
    'the least willing shooter should be under 15% (NBA p05 4.5), got ' + s.threePaP05.toFixed(1));
  assert.ok(s.threePaP95 >= 50,
    'the most willing should be over 50% (NBA p95 71.6), got ' + s.threePaP95.toFixed(1));
  assert.ok(s.volumeRatio >= 2.2 && s.volumeRatio <= 3.4,
    'shot volume p95:p05 should be 2.2-3.4x (NBA usage 2.9x), got ' + s.volumeRatio.toFixed(2));
  assert.ok(s.assistRatio >= 3.5,
    'assists should concentrate on primary creators, got ' + s.assistRatio.toFixed(2) + 'x');
  console.log('checkPlayerIdentityIsInTheShotMix: OK (3PA spread ' + spread.toFixed(1) +
    'pts, volume ' + s.volumeRatio.toFixed(2) + 'x, assists ' + s.assistRatio.toFixed(2) + 'x)');
}

checkLeagueIsMadeOfIndividuals();
checkSynergyStillDiscriminates();
checkLeagueRatesAreRealistic();
checkPlayerIdentityIsInTheShotMix();

console.log('All identity validations passed');
