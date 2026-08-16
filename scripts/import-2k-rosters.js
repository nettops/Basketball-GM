// Regenerates the authored roster table in players-2026.js from
// data/2k27-rosters.json (scraped by scripts/scrape-2kratings.js — see
// docs/superpowers/specs/2026-08-13-2k27-roster-import-design.md).
//
// The one idea that makes "replace the ratings" safe: 2K decides ORDER and
// GAPS, the game keeps its UNITS. Each 2K skill is blended down to the
// game's 20 attributes (spec table), then QUANTILE-MAPPED onto the current
// league's distribution for that attribute — the player at the 90th
// percentile of 2K's three-point ratings becomes the 90th percentile of the
// game's threePoint distribution. Every engine threshold was calibrated
// against those distributions, and by construction they do not move.
//
// Contracts (2K has none): matched by name to the outgoing roster where the
// player already existed; otherwise rookie-scale for yearsPro <= 1, else a
// fair-market deal anchored the same way tradeEvaluator prices contracts.
//
// Teams: 2K carries 16-18 players on some rosters; the game's legal band is
// 12-15 (trade.js, freeAgency.js), so each team keeps its top 15 by 2K
// overall and the trim is logged.
//
// Run: node scripts/import-2k-rosters.js && node scripts/validate-data.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = f => require(path.join(ROOT, f));

const DATA_FILE = path.join(ROOT, 'data', '2k27-rosters.json');
const TARGET = path.join(ROOT, 'players-2026.js');

// ---- load the OUTGOING league first: it is the quantile-map target --------
rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const { ATTRIBUTE_KEYS } = rq('data.js');
const old = rq('players-2026.js');
const OLD_PLAYERS = old.PLAYERS_2026;
const ARCHETYPES = old.ARCHETYPES;

const oldSorted = {};
ATTRIBUTE_KEYS.forEach(k => {
  oldSorted[k] = OLD_PLAYERS.map(p => p.attributes[k]).sort((a, b) => a - b);
});
const oldContracts = {};
OLD_PLAYERS.forEach(p => { oldContracts[p.name] = p.contract; });

// ---- the 37 -> 20 blend (spec section 3) ----------------------------------
const BLEND = {
  threePoint: ['Three-Point Shot'],
  midRange: ['Mid-Range Shot'],
  insideScoring: ['Close Shot', 'Layup', 'Driving Dunk', 'Standing Dunk'],
  freeThrow: ['Free Throw'],
  postScoring: ['Post Hook', 'Post Fade', 'Post Control'],
  passing: ['Pass Accuracy', 'Pass Vision', 'Pass IQ'],
  ballHandling: ['Ball Handle', 'Speed with Ball'],
  perimeterDefense: ['Perimeter Defense'],
  interiorDefense: ['Interior Defense'],
  steal: ['Steal'],
  block: ['Block'],
  offReb: ['Offensive Rebound'],
  defReb: ['Defensive Rebound'],
  speed: ['Speed'],
  acceleration: ['Agility'],
  strength: ['Strength'],
  vertical: ['Vertical'],
  basketballIQ: ['Shot IQ', 'Pass IQ', 'Help Defense IQ', 'Offensive Consistency', 'Defensive Consistency'],
  leadership: ['Intangibles'],
  workEthic: ['Hustle']
};

// Potential grade -> authored headroom points on the 2K scale. mkPlayer
// rescales the (potential - overall) gap by ANCHOR_SD_RATIO, same as every
// authored player before this import.
// First cut (A+ 12 .. C 2) compressed every ceiling toward the current
// level: the superstar-potential arm's lowest admit was an 83 overall —
// an arm that only reaches players who nearly qualify anyway (the exact
// failure RATING_BANDS' comment documents). Doubled-ish so an A+ rookie
// carries genuine upside; re-anchored bands measured after this change.
const GRADE_HEADROOM = { 'A+': 22, 'A': 16, 'A-': 12, 'B+': 8, 'B': 6, 'B-': 4, 'C+': 3, 'C': 2 };

// 2K's potential grade is PEDIGREE, not remaining upside — LeBron carries an
// A+ at 23 years in. Measured before this discount existed: the superstar-
// potential arm admitted LeBron (41) and Paul George (35) as 'upside' cases.
// Full headroom through 23, fading to none by 32, same shape as
// tradeEvaluator's youthFactor.
function headroomAgeFactor(age) {
  if (age <= 23) return 1.0;
  if (age >= 32) return 0;
  return 1 - (age - 23) / 9;
}

// 2K team name -> game team id, matched on the unique nickname so
// "LA Surf" vs "Los Angeles Clippers" cannot break it.
const teamIdByNickname = {};
TEAMS.forEach(t => { teamIdByNickname[t.name.split(' ').pop()] = t.id; });

function loadScrape() {
  const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (j.teams.length !== 30) throw new Error('expected 30 teams, got ' + j.teams.length);
  return j;
}

// Average rank (ties share) among all imported values of this attribute,
// then the value at that percentile of the OLD league's distribution.
function quantileMapper(newValues) {
  const sorted = newValues.slice().sort((a, b) => a - b);
  return function (v, key) {
    // average rank of v within sorted (ties -> midpoint)
    let lo = 0, hi = sorted.length - 1;
    while (lo < sorted.length && sorted[lo] < v) lo++;
    while (hi >= 0 && sorted[hi] > v) hi--;
    const pct = sorted.length === 1 ? 0.5 : ((lo + hi) / 2) / (sorted.length - 1);
    const target = oldSorted[key];
    const idx = pct * (target.length - 1);
    const base = Math.floor(idx);
    const frac = idx - base;
    const mapped = base >= target.length - 1
      ? target[target.length - 1]
      : target[base] * (1 - frac) + target[base + 1] * frac;
    return Math.round(mapped);
  };
}

function ageOn(birthdate, fallbackYears) {
  if (!birthdate) return 20 + (fallbackYears || 0);
  const d = new Date(birthdate);
  const ref = new Date('2026-10-01');
  let a = ref.getFullYear() - d.getFullYear();
  if (ref.getMonth() < d.getMonth() || (ref.getMonth() === d.getMonth() && ref.getDate() < d.getDate())) a--;
  return a;
}

function isoDate(birthdate) {
  if (!birthdate) return null;
  const d = new Date(birthdate + ' UTC');
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

// Nearest internal generation-archetype by correlation between the
// archetype's offset vector and the player's centred attribute profile.
// Only generation-side code reads it; this keeps the field honest.
function nearestArchetypeId(attrs) {
  const keys = Object.keys(ARCHETYPES.primary_scorer);
  const mean = keys.reduce((s, k) => s + attrs[k], 0) / keys.length;
  let best = null, bestScore = -Infinity;
  Object.keys(ARCHETYPES).forEach(id => {
    let dot = 0;
    keys.forEach(k => { dot += ARCHETYPES[id][k] * (attrs[k] - mean); });
    if (dot > bestScore) { bestScore = dot; best = id; }
  });
  return best;
}

function contractFor(p, displayAnchor) {
  const kept = oldContracts[p.name];
  if (kept) return { salary: kept.salary, yearsRemaining: kept.yearsRemaining, playerOption: kept.playerOption, teamOption: kept.teamOption };
  if ((p.yearsInNba || 0) <= 1) {
    // Rookie scale, anchored to draft quality the way the old table's own
    // rookies run ($2M late second to ~$13M top pick).
    const salary = Math.round(Math.max(2000000, (p.overall - 65) * 900000) / 100000) * 100000;
    return { salary: salary, yearsRemaining: 4, playerOption: false, teamOption: false };
  }
  // Fair-market: the same (overall - 50) * $1M anchor tradeEvaluator's
  // contractBurden treats as fair, floored at the minimum.
  const salary = Math.round(Math.max(1200000, (displayAnchor - 50) * 1000000) / 100000) * 100000;
  const years = p.yearsInNba >= 12 ? 1 : 2;
  return { salary: salary, yearsRemaining: years, playerOption: false, teamOption: false };
}

function js(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

function main() {
  const scrape = loadScrape();

  // Collect every imported player with blended (still 2K-scale) values.
  const all = [];
  scrape.teams.forEach(team => {
    const nickname = team.name.split(' ').pop();
    const teamId = teamIdByNickname[nickname];
    if (!teamId) throw new Error('no team id for ' + team.name);
    // Legal band is 12-15: keep the top 15 by 2K overall.
    const keep = team.players.slice().sort((a, b) => b.overall - a.overall).slice(0, 15);
    if (team.players.length > 15) {
      console.log(team.name + ': trimmed ' + (team.players.length - 15) + ' (' +
        team.players.slice().sort((a, b) => b.overall - a.overall).slice(15).map(p => p.name).join(', ') + ')');
    }
    keep.forEach(p => {
      const blended = {};
      ATTRIBUTE_KEYS.forEach(k => {
        const parts = BLEND[k].map(name => {
          if (p.attributes[name] === undefined) throw new Error(p.name + ' missing 2K attribute ' + name);
          return p.attributes[name];
        });
        blended[k] = parts.reduce((a, b) => a + b, 0) / parts.length;
      });
      all.push({ p: p, teamId: teamId, teamName: team.name, blended: blended });
    });
  });
  console.log('importing ' + all.length + ' players across 30 teams');

  // FACE VALUE, since the user asked for it (2026-08-13): the blended 2K
  // numbers are stored directly, so a single-source attribute (threePoint,
  // defReb...) reads exactly what 2kratings.com shows. The engine is tuned
  // to this scale rather than the values bent to the engine's old scale —
  // the quantile mapper above is retired but kept for reference.
  all.forEach(e => {
    e.attrs = {};
    ATTRIBUTE_KEYS.forEach(k => { e.attrs[k] = Math.round(e.blended[k]); });
  });

  // The affine bridge for GENERATED players: makeAttributes was calibrated
  // to produce the OLD league's per-attribute distributions, so generated
  // players need `new = old * scale + shift` per attribute or every draft
  // class arrives on the wrong scale and the league decays. Printed here,
  // pasted into players-2026.js (GENERATION_AFFINE).
  console.log('const GENERATION_AFFINE = {');
  ATTRIBUTE_KEYS.forEach(k => {
    const oldVals = OLD_PLAYERS.map(p => p.attributes[k]);
    const newVals = all.map(e => e.attrs[k]);
    const stat = v => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return { m: m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length) };
    };
    const o = stat(oldVals), n = stat(newVals);
    const scale = o.sd > 0 ? n.sd / o.sd : 1;
    const shift = n.m - o.m * scale;
    console.log('  ' + k + ': { scale: ' + scale.toFixed(4) + ', shift: ' + shift.toFixed(2) + ' },');
  });
  console.log('};');

  // Emit the table.
  const lines = [];
  let currentTeam = null;
  const usedJerseys = {};
  all.forEach(e => {
    const p = e.p;
    if (e.teamId !== currentTeam) {
      currentTeam = e.teamId;
      usedJerseys[currentTeam] = new Set();
      lines.push('');
      lines.push('// ' + e.teamName);
    }
    let jersey = p.jersey === null || p.jersey === undefined ? 0 : p.jersey;
    while (usedJerseys[e.teamId].has(jersey)) jersey++;
    usedJerseys[e.teamId].add(jersey);

    const position = (p.positions && p.positions[0]) || 'SF';
    const age = ageOn(p.birthdate, p.yearsInNba);
    const dob = isoDate(p.birthdate);
    const headroom = Math.round((GRADE_HEADROOM[p.potential] || 1) * headroomAgeFactor(age));
    const contract = contractFor(p, p.overall);
    const arch = nearestArchetypeId(e.attrs);
    const attrSrc = '{ ' + ATTRIBUTE_KEYS.map(k => k + ': ' + e.attrs[k]).join(', ') + ' }';
    const opts = '{ ' +
      (dob ? 'dateOfBirth: ' + js(dob) + ', ' : '') +
      (p.priorToNba ? 'college: ' + js(p.priorToNba) + ', ' : '') +
      (p.wingspan && p.wingspan.inches ? 'wingspanIn: ' + p.wingspan.inches + ', ' : '') +
      (contract.playerOption ? 'playerOption: true, ' : '') +
      (contract.teamOption ? 'teamOption: true, ' : '') +
      'attributes: ' + attrSrc + ' }';
    lines.push('PLAYERS_2026.push(mkPlayer(' + [
      js(e.teamId), js(p.name), age,
      (p.height && p.height.inches) || 78,
      (p.weight && p.weight.lbs) || 210,
      js(position), jersey, p.yearsInNba || 0,
      p.overall, p.overall + headroom, js(arch),
      contract.salary, contract.yearsRemaining, opts
    ].join(', ') + '));');
  });

  // Splice into players-2026.js between the pool declaration and the exports.
  const src = fs.readFileSync(TARGET, 'utf8');
  const startMark = 'const PLAYERS_2026 = [];';
  const endMark = 'if (typeof module !== ';
  const start = src.indexOf(startMark);
  const end = src.indexOf(endMark);
  if (start === -1 || end === -1 || end < start) throw new Error('table markers not found in players-2026.js');
  const header = '\n\n// ============================ GENERATED TABLE ============================\n' +
    '// Regenerated by scripts/import-2k-rosters.js from data/2k27-rosters.json\n' +
    '// (NBA 2K27 rosters, pulled ' + scrape.pulledAt.slice(0, 10) + '). Do not hand-edit players here —\n' +
    '// rerun the importer. Attribute sheets are explicit (quantile-mapped onto\n' +
    '// the previous league\'s per-attribute distributions) so makeAttributes and\n' +
    '// SIGNATURE_ATTRIBUTES do not apply to them; both remain for generated\n' +
    '// players (prospects, career mode, commissioner).\n';
  const out = src.slice(0, start + startMark.length) + header + lines.join('\n') + '\n\n' + src.slice(end);
  fs.writeFileSync(TARGET, out);
  console.log('wrote ' + TARGET + ' (' + all.length + ' players)');
}

main();
