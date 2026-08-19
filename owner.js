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

// What the club is TRYING to be: timeline, nudged by prestige.
function mandateAmbition(team) {
  const base = team.timeline === 'win-now' ? 48
    : team.timeline === 'retooling' ? 38
    : 28;
  return base + Math.round(((team.prestige || 50) - 50) / 10);
}

// The win target, anchored to what the club ACTUALLY DID as well as to what it
// thinks it is.
//
// Ambition alone was the first cut and it was the single biggest source of
// failed mandates: measured, win totals were missed 64% of the time, because a
// club with a proud timeline and high prestige is asked for 52 every season
// regardless of being a 40-win team. Boston is exactly that club, and it was
// being set up to fail every year on the strength of its own reputation.
//
// Weighted toward last season because that is the honest evidence, with
// ambition still in the mix so a proud club is held to more than a modest one
// that won the same number. A club with no history yet (season one) falls back
// to pure ambition.
const TARGET_LAST_SEASON_WEIGHT = 0.65;

function mandateWinTarget(team) {
  const ambition = mandateAmbition(team);
  const last = team.lastSeasonWins;
  const anchored = (last === undefined || last === null)
    ? ambition
    : TARGET_LAST_SEASON_WEIGHT * last + (1 - TARGET_LAST_SEASON_WEIGHT) * ambition;
  return Math.max(20, Math.min(60, Math.round(anchored)));
}

// Both guards here exist for the same reason, and it is the recurring failure
// of this whole feature: a mandate the club cannot possibly meet is not a
// mandate, it is a scheduled firing.
//
//   opts.youngPlayers  — a club with no under-23s cannot develop anybody, and
//                        several open with zero.
//   opts.underTaxLine  — "stay under the luxury tax" only means anything said
//                        to somebody who is under it. Measured, 7 clubs of 30
//                        are, against a median payroll of $233M and a $187M
//                        line, so this was being handed to 23 clubs who would
//                        need to shed $46M to comply.
//
// Both fall through to a win total, which every club can be judged on fairly
// because the target is already scaled by timeline and prestige.
function chooseMandate(team, rng, opts) {
  const roll = rng ? rng() : 0.5;
  const timeline = team.timeline;
  const canDevelop = !opts || opts.youngPlayers === undefined || opts.youngPlayers > 0;
  const canBudget = !opts || opts.underTaxLine === undefined || opts.underTaxLine;
  // A club that did not reach the playoffs last season is not asked to win a
  // series in this one. Measured, this mandate was missed 5 times out of 5 —
  // the third variant of the same mistake, handed to clubs with no realistic
  // route to it.
  const canContend = !opts || opts.madePlayoffsLastYear === undefined || opts.madePlayoffsLastYear;
  const winsMandate = function () {
    return { type: MANDATE_TYPES.wins, target: mandateWinTarget(team),
      label: 'win ' + mandateWinTarget(team) + ' games' };
  };

  if (timeline === 'win-now') {
    // A win-now club is never told to watch the money — that is what the
    // timeline means.
    // "Reach the conference finals" was the first cut of this, and it made the
    // owner unreasonable rather than demanding: only four clubs of thirty get
    // there in a year, so a win-now GM was handed a roughly one-in-seven task
    // every season and sacked for failing it. Measured over 48 judged seasons,
    // win-now clubs were fired at 33% a season against 0% for retooling — the
    // mandate was mistuned, not the patience.
    //
    // Winning a series is the ask now: eight clubs of thirty do it, which is a
    // real bar that a good team clears and a flattering one does not.
    if (roll < 0.30 && canContend) return { type: MANDATE_TYPES.contend, rounds: 1, label: 'win a playoff series' };
    if (roll < 0.75) return { type: MANDATE_TYPES.playoffs, label: 'make the playoffs' };
    return { type: MANDATE_TYPES.wins, target: mandateWinTarget(team), label: 'win ' + mandateWinTarget(team) + ' games' };
  }

  if (timeline === 'rebuilding') {
    // Nobody rebuilding is told to win. They are told to develop somebody and
    // not to set fire to the money doing it.
    if (roll < 0.6 && canDevelop) return { type: MANDATE_TYPES.develop, label: 'develop the young core' };
    if (canBudget) return { type: MANDATE_TYPES.budget, label: 'stay under the luxury tax' };
    if (canDevelop) return { type: MANDATE_TYPES.develop, label: 'develop the young core' };
    return winsMandate();
  }

  // retooling: the awkward middle, and the only one who gets the full spread.
  if (roll < 0.4) return winsMandate();
  if (roll < 0.7) return { type: MANDATE_TYPES.playoffs, label: 'make the playoffs' };
  if (canBudget) return { type: MANDATE_TYPES.budget, label: 'stay under the luxury tax' };
  return winsMandate();
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
// maxPatience lets difficulty.js shorten or lengthen the rope without this
// module knowing difficulty exists. Defaults to OWNER_PATIENCE, so every
// existing caller is unchanged.
function applyMandateResult(career, teamId, judgement, maxPatience) {
  const ceiling = maxPatience || OWNER_PATIENCE;
  if (!career.ownerPatience) career.ownerPatience = {};
  const before = career.ownerPatience[teamId] === undefined
    ? ceiling
    : career.ownerPatience[teamId];
  const after = judgement.met ? ceiling : before - 1;
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
function setMandate(gameState, team, roster, rng, facts) {
  const f = facts || {};
  const mandate = chooseMandate(team, rng, {
    youngPlayers: youngPlayerCount(roster),
    underTaxLine: f.payroll === undefined
      ? undefined
      : f.payroll <= _OWNER_DATA.data.getEffectiveLuxuryTaxLine(f.capLevel),
    madePlayoffsLastYear: f.madePlayoffsLastYear
  });
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
  const standing = applyMandateResult(career, gameState.userTeamId, judgement,
    facts.maxPatience);

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

// Who would hire this man now.
//
// Being sacked has to lead somewhere or it is a message box: `endYear` was set,
// `firedAtEndOfSeason` was saved, and nothing read either — the owner could fire
// you and the game carried on as though he had not.
//
// Reputation is the gate, and the clubs that will take a chance are the ones
// with the least to lose: a proud, successful club wants a proven GM, a
// struggling one will take whoever is available. That inverts naturally out of
// prestige, so no second ranking is invented for it.
function clubsWillingToHire(career, teams, excludeTeamId) {
  const reputation = (career && career.reputation) || 50;
  return (teams || []).filter(function (t) {
    if (t.id === excludeTeamId) return false;
    // A club's standards scale with its prestige. At reputation 50 the middle
    // of the league is open; a wrecked reputation leaves only the desperate.
    return reputation >= (t.prestige || 50) - 20;
  }).sort(function (a, b) { return (b.prestige || 50) - (a.prestige || 50); });
}

// Starts the next spell. The tenure list is the career, so a second job is
// another entry rather than a rewrite of the first — tenureCovers already reads
// them as a sequence.
function startTenure(career, teamId, leagueYear) {
  if (!career) return null;
  if (!Array.isArray(career.tenures)) career.tenures = [];
  // Close whatever is still open first. In the ordinary flow runOwnerReview has
  // already done it, but a GM cannot hold two open tenures at once and
  // tenureCovers reads them as a sequence — two open spells would report him as
  // running both clubs in the same season and attribute every stat twice.
  career.tenures.forEach(function (t) {
    if (t.endYear === null || t.endYear === undefined) t.endYear = leagueYear - 1;
  });
  const tenure = { teamId: teamId, startYear: leagueYear, endYear: null };
  career.tenures.push(tenure);
  // A fresh employer extends fresh credit.
  if (career.ownerPatience) delete career.ownerPatience[teamId];
  return tenure;
}

// What the owner's patience stands at RIGHT NOW, defaulting to full for a
// club the GM has only just joined. Read by both the career page and the
// dashboard strip; a second inline copy of this `=== undefined ? ceiling`
// rule is how the two screens end up disagreeing about whether you are about
// to be sacked.
function currentPatience(career, teamId, maxPatience) {
  const ceiling = maxPatience || OWNER_PATIENCE;
  if (!career || !career.ownerPatience || career.ownerPatience[teamId] === undefined) return ceiling;
  return career.ownerPatience[teamId];
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
    mandateAmbition: mandateAmbition,
    chooseMandate: chooseMandate,
    seasonOutcome: seasonOutcome,
    judgeMandate: judgeMandate,
    applyMandateResult: applyMandateResult,
    endTenure: endTenure,
    startTenure: startTenure,
    clubsWillingToHire: clubsWillingToHire,
    youngMinutesShare: youngMinutesShare,
    youngPlayerCount: youngPlayerCount,
    DEVELOP_MINUTES_SHARE: DEVELOP_MINUTES_SHARE,
    setMandate: setMandate,
    reviewSeason: reviewSeason,
    currentPatience: currentPatience,
    patienceLabel: patienceLabel
  };
}
