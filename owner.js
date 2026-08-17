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

// "Develop the young core" is judged on MINUTES, not on rating growth, and that
// is a correction rather than a preference. Rating growth was the first cut and
// it was unwinnable: progressPlayer runs only in the offseason, the baseline was
// taken after one and the review happens before the next, so no rating could
// move between them. The mandate handed to 60% of rebuilding clubs could
// essentially never be met, and it showed — measured, rebuilding clubs cleared
// their mandate 2 seasons in 12.
//
// Minutes are also the honest measure: a GM does not control whether a
// nineteen-year-old improves, he controls whether the kid plays. Measured over
// a season the league median young share is 21.8% (p25 4.7%, p75 32.9%), so 20%
// is a bar that a club which means it clears and a club paying lip service
// does not.
const DEVELOP_MINUTES_SHARE = 0.20;

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

// opts.youngPlayers is how many under-23s are actually on the roster. A club
// with none cannot be asked to develop anybody — measured, several clubs open
// with zero, and handing them a development mandate would recreate the
// unwinnable mandate this design just removed in a new shape.
function chooseMandate(team, rng, opts) {
  const roll = rng ? rng() : 0.5;
  const timeline = team.timeline;
  const canDevelop = !opts || opts.youngPlayers === undefined || opts.youngPlayers > 0;

  if (timeline === 'win-now') {
    // "Reach the conference finals" was the first cut of this, and it made the
    // owner unreasonable rather than demanding: only four clubs of thirty get
    // there in a year, so a win-now GM was handed a roughly one-in-seven task
    // every season and sacked for failing it. Measured over 48 judged seasons,
    // win-now clubs were fired at 33% a season against 0% for retooling — the
    // mandate was mistuned, not the patience.
    //
    // Winning a series is the ask now: eight clubs of thirty do it, which is a
    // real bar that a good team clears and a flattering one does not.
    if (roll < 0.30) return { type: MANDATE_TYPES.contend, rounds: 1, label: 'win a playoff series' };
    if (roll < 0.75) return { type: MANDATE_TYPES.playoffs, label: 'make the playoffs' };
    return { type: MANDATE_TYPES.wins, target: mandateWinTarget(team), label: 'win ' + mandateWinTarget(team) + ' games' };
  }

  if (timeline === 'rebuilding') {
    // Nobody rebuilding is told to win. They are told to develop somebody and
    // not to set fire to the money doing it.
    if (roll < 0.6 && canDevelop) return { type: MANDATE_TYPES.develop, label: 'develop the young core' };
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
    youngMinutesShare: opts.youngMinutesShare || 0
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
      met = outcome.youngMinutesShare >= DEVELOP_MINUTES_SHARE;
      detail = 'the young players took ' + Math.round(outcome.youngMinutesShare * 100) +
        '% of the minutes (' + Math.round(DEVELOP_MINUTES_SHARE * 100) + '% asked)';
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

// The `develop` mandate needs a before to have an after. Taken when the mandate
// is set and diffed when it is judged — progression runs in the offseason,
// AFTER this judgement, so asking "did the kids improve" at review time with no
// baseline would always read zero and the mandate would be unfailable.
// What share of the club's minutes went to under-23s. Zero total minutes reads
// as zero share rather than dividing by nothing — a mandate judged before a
// single game is played must fail quietly, not throw.
function youngMinutesShare(roster) {
  let total = 0, young = 0;
  (roster || []).forEach(function (p) {
    const mins = (p.seasonStats && p.seasonStats.minutes) || 0;
    total += mins;
    if (p.age <= 23) young += mins;
  });
  return total > 0 ? young / total : 0;
}

function youngPlayerCount(roster) {
  return (roster || []).filter(function (p) { return p.age <= 23; }).length;
}

// Sets the standing mandate and snapshots what it will be judged against.
function setMandate(gameState, team, roster, rng) {
  const mandate = chooseMandate(team, rng, { youngPlayers: youngPlayerCount(roster) });
  mandate.leagueYear = gameState.leagueYear || 2026;
  gameState.ownerMandate = mandate;
  return mandate;
}

// The season review, from the facts the rollover can see. Returns null when
// there is nothing to judge, so the caller never has to guess whether a review
// happened — a spectator save, a career with no mandate yet, or an unfinished
// postseason all decline the same way.
//
// Takes the numbers rather than the league so it stays testable: everything
// below is arithmetic on five values.
function reviewSeason(gameState, facts) {
  const mandate = gameState.ownerMandate;
  const career = gameState.gmCareer;
  if (!mandate || !career || !gameState.userTeamId) return null;

  const outcome = seasonOutcome(facts.team, {
    madePlayoffs: facts.madePlayoffs,
    roundsWon: facts.roundsWon,
    payroll: facts.payroll,
    capLevel: facts.capLevel,
    youngMinutesShare: youngMinutesShare(facts.roster)
  });

  const judgement = judgeMandate(mandate, outcome);
  const standing = applyMandateResult(career, gameState.userTeamId, judgement);

  // Rounded, and clamped the same way finances.js clamps its own writes. The
  // raw field carries float noise from the tax maths (25.606481199999998 was
  // live in a measured league), which reads as a bug the moment it is on
  // screen next to a mandate.
  if (facts.team) {
    facts.team.ownerHappiness = Math.round(
      Math.max(20, Math.min(99, (facts.team.ownerHappiness || 60) + judgement.happinessDelta))
    );
  }

  return {
    mandate: mandate,
    met: judgement.met,
    detail: judgement.detail,
    patience: standing.patience,
    fired: standing.fired,
    happiness: facts.team ? facts.team.ownerHappiness : null
  };
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
    youngMinutesShare: youngMinutesShare,
    youngPlayerCount: youngPlayerCount,
    DEVELOP_MINUTES_SHARE: DEVELOP_MINUTES_SHARE,
    setMandate: setMandate,
    reviewSeason: reviewSeason,
    patienceLabel: patienceLabel
  };
}
