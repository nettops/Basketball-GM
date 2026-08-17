// Is the match decision real?
//
// This is the number restricted free agency lives or dies by. If every sheet is
// matched, the feature is a notification. If none is, it is a talent tax on
// whoever develops players. Either way the "decision" is fake and no test would
// notice, because both extremes are perfectly self-consistent.
//
// Reports. Tuning OFFER_SHEET_PREMIUM and MATCH_OVERPAY_WEIGHT is what this
// exists for; scripts/validate-restrictedFA.js asserts the mechanics.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
const fa = rq('freeAgency.js');
const league = rq('league.js');
const tradeEvaluator = rq('tradeEvaluator.js');

const SEEDS = [3, 17, 91, 404, 2718];

function snapshot() {
  return PLAYERS_2026.map(function (p) {
    return { p: p, teamId: p.teamId, salary: p.contract.salary, years: p.contract.yearsRemaining };
  });
}

function restore(snap) {
  snap.forEach(function (s) {
    s.p.teamId = s.teamId;
    s.p.contract.salary = s.salary;
    s.p.contract.yearsRemaining = s.years;
    delete s.p.resignRights;
  });
}

const base = snapshot();

let totalExpiring = 0, totalRestricted = 0, totalSheets = 0, totalMatched = 0, totalPoached = 0;
const overpays = [];
const barGaps = [];

SEEDS.forEach(function (seed) {
  restore(base);
  const rng = makeRng(seed);

  // The expiring class, built the way decrementContracts builds it.
  PLAYERS_2026.forEach(function (p) { if (p.teamId) p.contract.yearsRemaining -= 1; });
  const expiring = PLAYERS_2026.filter(function (p) { return p.teamId && p.contract.yearsRemaining <= 0; });
  totalExpiring += expiring.length;

  const restricted = expiring.filter(fa.isRestrictedFreeAgent);
  totalRestricted += restricted.length;

  // Measure the decision on each restricted player BEFORE running the window,
  // so the numbers describe the choice rather than its consequences.
  restricted.forEach(function (player) {
    const team = TEAMS.filter(function (t) { return t.id === player.teamId; })[0];
    if (!team) return;
    const sheet = fa.bestOfferSheet(player, rng, team.id);
    if (!sheet) return;
    totalSheets += 1;
    const verdict = fa.evaluateMatch(team, player, sheet);
    overpays.push(verdict.overpay);
    barGaps.push(tradeEvaluator.adjustedPlayerValue(player, team) - verdict.bar);
    if (verdict.matched) totalMatched += 1; else totalPoached += 1;
  });
});

restore(base);

function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) + '%' : '   —  '; }

console.log('=== Restricted free agency, ' + SEEDS.length + ' offseasons ===');
console.log('  expiring players          ' + totalExpiring);
console.log('  of those, restricted      ' + totalRestricted + '  (' + pct(totalRestricted, totalExpiring) + ')');
console.log('  drew an offer sheet       ' + totalSheets + '  (' + pct(totalSheets, totalRestricted) + ' of restricted)');
console.log('');
console.log('  MATCHED (kept)            ' + totalMatched + '  (' + pct(totalMatched, totalSheets) + ')');
console.log('  poached (lost)            ' + totalPoached + '  (' + pct(totalPoached, totalSheets) + ')');
console.log('');
console.log('  mean overpay on a sheet   ' + mean(overpays).toFixed(2) + 'x fair value');
console.log('  mean value minus bar      ' + mean(barGaps).toFixed(1) + '  (positive = kept)');
console.log('');
console.log('  Target band is roughly 50-80% matched. Real leagues match most sheets,');
console.log('  but a rate at either extreme means the premium is mistuned and the');
console.log('  decision is theatre.');
if (totalSheets === 0) {
  console.log('  VERDICT: NO SHEETS WRITTEN AT ALL — the feature never fires.');
} else {
  const rate = totalMatched / totalSheets;
  console.log(rate > 0.95 || rate < 0.15
    ? '  VERDICT: MISTUNED — the choice is effectively made for the GM.'
    : '  VERDICT: the decision is live.');
}
