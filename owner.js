// The owner. He states what he expects before the season, judges it after, and
// eventually runs out of patience.
//
// He exists because measurement said he did not. Every write to
// `ownerHappiness` lived in finances.js and was driven by the luxury tax, which
// made the owner a spending thermostat that did not know the score: across four
// seasons his happiness correlated with wins at r = 0.12-0.39, and in 2029 the
// fifth-unhappiest owner in the league ran a club that had just won 71 games.
// The clubs that spent to win had the angriest owners, entirely by accident.
//
// Everything here is pure and at file scope. A mandate is chosen from numbers,
// judged against numbers, and produces a number — none of it needs a league to
// be true, and all of it needs to be testable without one.
var _OWNER_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js') }
  : { data: { getEffectiveLuxuryTaxLine: getEffectiveLuxuryTaxLine } };

// How many seasons of missing the mandate a GM survives. Two, not one: a single
// bad year decided by the dice is a coin flip, not a judgement, and a job you
// can lose to one unlucky season stops being a job worth planning around.
const OWNER_PATIENCE = 2;

// What the owner asks for, by what the club is already trying to do. A
// rebuilding club told to win 55 games is not a mandate, it is a bug report.
const MANDATE_TYPES = {
  wins: 'wins',
  playoffs: 'playoffs',
  contend: 'contend',
  develop: 'develop',
  budget: 'budget'
};

// Win targets are pinned to what the club's timeline claims it is doing, then
// nudged by prestige — a proud club expects more of itself at the same
// timeline. Kept well inside the plausible range: a target nobody can hit is
// the same failure as no target at all.
function mandateWinTarget(team) {
  const base = team.timeline === 'win-now' ? 48
    : team.timeline === 'retooling' ? 38
    : 28;
  const prestigeNudge = Math.round(((team.prestige || 50) - 50) / 10);
  return Math.max(20, Math.min(60, base + prestigeNudge));
}

function chooseMandate(team, rng) {
  const roll = rng ? rng() : 0.5;
  const timeline = team.timeline;

  if (timeline === 'win-now') {
    // A proud win-now club is asked to go deep; the rest are asked to turn up.
    if (roll < 0.45) return { type: MANDATE_TYPES.contend, rounds: 2, label: 'reach the conference finals' };
    if (roll < 0.8) return { type: MANDATE_TYPES.playoffs, label: 'make the playoffs' };
    return { type: MANDATE_TYPES.wins, target: mandateWinTarget(team), label: 'win ' + mandateWinTarget(team) + ' games' };
  }

  if (timeline === 'rebuilding') {
    // Nobody rebuilding is told to win. They are told to develop somebody and
    // not to set fire to the money doing it.
    if (roll < 0.6) return { type: MANDATE_TYPES.develop, label: 'develop the young core' };
    return { type: MANDATE_TYPES.budget, label: 'stay under the luxury tax' };
  }

  // retooling: the awkward middle, and the only one who gets the full spread.
  if (roll < 0.4) return { type: MANDATE_TYPES.wins, target: mandateWinTarget(team), label: 'win ' + mandateWinTarget(team) + ' games' };
  if (roll < 0.7) return { type: MANDATE_TYPES.playoffs, label: 'make the playoffs' };
  return { type: MANDATE_TYPES.budget, label: 'stay under the luxury tax' };
}

// The season, reduced to the handful of facts a mandate can be judged against.
// Taking a summary rather than the live league is what keeps this testable: the
// judgement below has no opinion about where the numbers came from.
function seasonOutcome(team, opts) {
  opts = opts || {};
  const record = team.record || { wins: 0, losses: 0 };
  return {
    wins: record.wins || 0,
    madePlayoffs: !!opts.madePlayoffs,
    roundsWon: opts.roundsWon || 0,
    payroll: opts.payroll || 0,
    taxLine: opts.taxLine || _OWNER_DATA.data.getEffectiveLuxuryTaxLine(opts.capLevel),
    youngImprovement: opts.youngImprovement || 0
  };
}

// Met or missed, and by how much it moved him. The delta is deliberately
// asymmetric: clearing a mandate is the job, and missing it is news.
function judgeMandate(mandate, outcome) {
  let met = false;
  let detail = '';

  switch (mandate.type) {
    case MANDATE_TYPES.wins:
      met = outcome.wins >= mandate.target;
      detail = outcome.wins + ' wins against a target of ' + mandate.target;
      break;
    case MANDATE_TYPES.playoffs:
      met = outcome.madePlayoffs;
      detail = outcome.madePlayoffs ? 'reached the playoffs' : 'missed the playoffs';
      break;
    case MANDATE_TYPES.contend:
      met = outcome.roundsWon >= (mandate.rounds || 2);
      detail = 'won ' + outcome.roundsWon + ' playoff round' + (outcome.roundsWon === 1 ? '' : 's');
      break;
    case MANDATE_TYPES.budget:
      met = outcome.payroll <= outcome.taxLine;
      detail = met ? 'stayed under the tax line' : 'went into the luxury tax';
      break;
    case MANDATE_TYPES.develop:
      met = outcome.youngImprovement > 0;
      detail = outcome.youngImprovement > 0
        ? 'the young players improved'
        : 'the young players went nowhere';
      break;
    default:
      met = true;
      detail = 'no mandate';
  }

  return { met: met, detail: detail, happinessDelta: met ? 8 : -14 };
}

// Patience only falls on a miss, and RESETS on a success — the owner is
// counting consecutive failures, not keeping a lifetime ledger. A GM who
// alternates good and bad years keeps his job, which is the intent: he is being
// judged on a trend, not on an average.
function applyMandateResult(career, teamId, judgement) {
  if (!career.ownerPatience) career.ownerPatience = {};
  const before = career.ownerPatience[teamId] === undefined
    ? OWNER_PATIENCE
    : career.ownerPatience[teamId];
  const after = judgement.met ? OWNER_PATIENCE : before - 1;
  career.ownerPatience[teamId] = Math.max(0, after);
  return { patience: career.ownerPatience[teamId], fired: after <= 0 };
}

// The firing. `endYear` is the field gmCareer.js has always carried and nothing
// has ever written — a tenure that could not end.
function endTenure(career, teamId, leagueYear) {
  if (!career || !career.tenures) return null;
  for (let i = career.tenures.length - 1; i >= 0; i--) {
    const t = career.tenures[i];
    if (t.teamId === teamId && (t.endYear === null || t.endYear === undefined)) {
      t.endYear = leagueYear;
      return t;
    }
  }
  return null;
}

function patienceLabel(remaining) {
  if (remaining >= OWNER_PATIENCE) return 'Secure';
  if (remaining === 1) return 'On notice';
  return 'Out of patience';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OWNER_PATIENCE: OWNER_PATIENCE,
    MANDATE_TYPES: MANDATE_TYPES,
    mandateWinTarget: mandateWinTarget,
    chooseMandate: chooseMandate,
    seasonOutcome: seasonOutcome,
    judgeMandate: judgeMandate,
    applyMandateResult: applyMandateResult,
    endTenure: endTenure,
    patienceLabel: patienceLabel
  };
}
