var _FA_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), data: require('./data.js'), tradeEvaluator: require('./tradeEvaluator.js'), rosterMoves: require('./rosterMoves.js'), careerHistory: require('./careerHistory.js'), finances: require('./finances.js'), ratings: require('./ratings.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll, getPlayerById: getPlayerById },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveSalaryCap: getEffectiveSalaryCap, getEffectiveSalaryFloor: getEffectiveSalaryFloor },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, basePlayerValue: basePlayerValue },
      rosterMoves: { getFreeAgents: getFreeAgents, waivePlayer: waivePlayer },
      careerHistory: { recordContractInHistory: recordContractInHistory },
      finances: { budgetSpendMultiplier: budgetSpendMultiplier, ARENA_MAX_TIER: ARENA_MAX_TIER },
      ratings: { RATING_BANDS: RATING_BANDS }
    };

// Higher score = more playing-time opportunity: wide open at the position,
// clearly the best there, or buried behind better players.
function playingTimeScore(player, team) {
  const roster = _FA_DATA.league.getTeamRoster(team.id).filter(function (p) { return p.id !== player.id; });
  const samePosition = roster.filter(function (p) { return p.position === player.position; });
  if (samePosition.length === 0) return 1.0;
  const avgAtPosition = samePosition.reduce(function (s, p) { return s + p.rawOverall; }, 0) / samePosition.length;
  if (player.rawOverall > avgAtPosition + 5) return 0.9;
  if (player.rawOverall < avgAtPosition - 10) return 0.2;
  return 0.5;
}

// This team's current-season win% as a "hype" factor — separate from and
// more current than the timeline label below (a "win-now" team mid-slump
// isn't actually the hot destination its timeline classification implies).
function hypeScore(team) {
  const r = team.record;
  const gp = (r.wins || 0) + (r.losses || 0);
  if (gp < 5) return 0.5; // too early in the season to mean anything, stay neutral
  return r.wins / gp;
}

// Arena tier (finances.js's upgrade track, 1-5) as a facilities factor — a
// player choosing between two similar offers leans toward the nicer building.
function facilitiesScore(team) {
  const tier = (team.finances && team.finances.arenaTier) || 1;
  return (tier - 1) / (_FA_DATA.finances.ARENA_MAX_TIER - 1);
}

// A team that traded this player away at some point in his career left a
// mark — re-signing with them isn't the same as signing somewhere fresh.
// Only ever a mild penalty (this isn't meant to make reunions impossible,
// just a little less appealing than a clean-slate offer).
function tradedAwayPenalty(player, team) {
  const trades = player.careerHistory && player.careerHistory.trades;
  if (!trades || trades.length === 0) return 0;
  return trades.some(function (t) { return t.fromTeam === team.id; }) ? 1 : 0;
}

// Staying put is worth something. This model had no concept of an incumbent at
// all — the note that used to sit here explained that there was no tracked
// "previous team" once a contract expired, because decrementContracts wiped
// teamId before free agency ever ran. The consequence was measurable and
// total: over 5 offseasons every one of 437 contracts was recorded as an
// open-market signing and not a single player in the league ever re-signed
// where he already played. A star drew a mean of 20 bids and his own team was
// one of the 20.
//
// `offer.incumbent` now marks an offer from the team the player just played
// for, and it is worth INCUMBENT_BONUS before personality. Loyalty pushes it
// up, morale pulls it down — an unhappy star will still walk, which is the
// whole drama of a re-signing window. Calibrated by sweep against the measured
// star re-sign rate; see scripts/sweep-resign.js.
// Mutable holder rather than a bare const so a calibration sweep can move it
// without editing committed source, the same shape as seasonTransition.js's
// RETIREMENT_TUNING. The shipped value is whatever sits here.
//
// Chosen by measured rate, not taste. scripts/probe-star-churn.js, 6 offseasons
// through the full pipeline, star (85+) re-sign rate by bonus:
//
//   0.00  31.9%   (the window alone, with no incumbent bonus at all)
//   0.05  55.0%
//   0.10  57.0%
//   0.16  68.0%   seeds 75.0 / 56.3 / 70.7 / 70.0 — spread of 19 points
//   0.22  71.8%   seeds 71.9 / 70.8 / 71.2 / 73.1 — spread of 2
//
// 0.22 over 0.16 for BOTH reasons: it lands on the target, and it is stable
// across seeds where 0.16 is not — a bonus small enough to be swamped by
// market noise gives a re-sign rate that swings 19 points on the dice, which
// reads as randomness rather than as loyalty.
var RESIGN_TUNING = { incumbentBonus: 0.22 };

// 8-factor mood model: money, contention (timeline), current-season hype,
// playing time, market size, prestige, facilities, being traded away by this
// exact team before — plus the incumbent bonus above and hidden personality
// modifiers layered on top. Loyalty ALSO means "doesn't need max money to be
// satisfied"; Ambition amplifies how much contention matters; Ego penalizes
// offers implying a diminished role.
function scoreOffer(player, team, offer) {
  const salaryScore = Math.min(1, offer.salary / 45000000);
  const contentionScore = team.timeline === 'win-now' ? 1 : (team.timeline === 'retooling' ? 0.6 : 0.3);
  const hype = hypeScore(team);
  const marketScore = team.marketSize / 100;
  const prestigeScore = team.prestige / 100;
  const ptScore = playingTimeScore(player, team);
  const facilities = facilitiesScore(team);

  const ageFactor = Math.min(1, Math.max(0, (player.age - 20) / 15));
  const moneyWeight = 0.32;
  const marketWeight = 0.08;
  const prestigeWeight = 0.12;
  const facilitiesWeight = 0.06;
  const hypeWeight = 0.08;
  const remaining = 1 - moneyWeight - marketWeight - prestigeWeight - facilitiesWeight - hypeWeight;
  const contentionWeight = remaining * (0.3 + ageFactor * 0.4);
  const playingTimeWeight = remaining - contentionWeight;

  let score = salaryScore * moneyWeight + contentionScore * contentionWeight + ptScore * playingTimeWeight +
    marketScore * marketWeight + prestigeScore * prestigeWeight + facilities * facilitiesWeight + hype * hypeWeight;

  score -= tradedAwayPenalty(player, team) * 0.05;

  // Staying is worth something, and how much depends on the man. A loyal
  // player leans hard on it; an unhappy one barely counts it, which is how a
  // star still forces his way out of a place he has stopped enjoying.
  if (offer.incumbent) {
    const personality = player.hiddenPersonality || {};
    const morale = (player.status && player.status.morale !== undefined) ? player.status.morale : 70;
    const loyaltyLean = personality.loyalty !== undefined ? (personality.loyalty - 50) / 50 : 0;
    const moraleLean = (morale - 55) / 45;   // below ~55 morale this goes negative
    score += RESIGN_TUNING.incumbentBonus * (1 + loyaltyLean * 0.5) * Math.max(-0.5, Math.min(1, moraleLean));
  }

  const personality = player.hiddenPersonality;
  if (personality && personality.loyalty !== undefined) {
    score += (1 - salaryScore) * (personality.loyalty - 50) / 100 * 0.06;
    score += (contentionScore - 0.5) * (personality.ambition - 50) / 100 * 0.16;
    if (ptScore < 0.5) {
      score -= Math.max(0, (personality.ego - 50) / 100) * 0.10;
    }
  }

  return score;
}

// Morale nudges what a player considers a fair asking price: an unhappy
// player (low morale, wherever it came from — bench time, a losing record,
// an unwanted trade) just wants a good situation and will take less; a happy
// player knows their worth and holds out for a premium. `roundsUnsigned`
// (0 by default) is how many resolution rounds this player has already gone
// through the open market without a deal — each round shaves a bit more off
// the ask, so a name still unsigned after several rounds gets realistic
// about their market rather than holding out forever (see
// runFreeAgencySilently's multi-round loop).
function estimateFairSalary(player, roundsUnsigned) {
  const base = Math.max(1200000, (player.rawOverall - 45) * 900000);
  const morale = (player.status && player.status.morale !== undefined) ? player.status.morale : 70;
  const moraleMultiplier = 0.85 + (morale / 100) * 0.3;
  const decayMultiplier = Math.max(0.6, 1 - (roundsUnsigned || 0) * 0.08);
  return Math.round(base * moraleMultiplier * decayMultiplier);
}

// Contract length used to be `1 + Math.floor(rng() * 4)` — a flat 1-4 years
// drawn with no reference to who the player was, so a 99-overall franchise
// player got the same coin flip as a minimum-salary body. Measured over 437
// signings that averaged 2.46 years, which put 36% of the entire league on the
// open market EVERY season and held a star's unbroken tenure to 2.27 seasons.
// Nobody could build anything.
//
// Length now tracks quality, because that is what makes a market rare: the
// players worth keeping are off the board for years at a time, and the churn
// is concentrated among the players nobody minds churning.
// Banded on ratings.js's RATING_BANDS — the league's own named tiers, on the
// DISPLAY scale. Not rawOverall: that is a different scale entirely (median 47
// against the display median of 75, and exactly one player league-wide above
// 85), so banding on it filed all but one player under "fringe" and made every
// contract in the league shorter rather than longer. Measured, caught, moved.
const MAX_CONTRACT_YEARS = 5;
function contractYearBands() {
  const b = _FA_DATA.ratings.RATING_BANDS;
  return [
    { min: b.superstar, low: 4, high: 5 },   // 90+, franchise players
    { min: b.star, low: 4, high: 5 },        // 87+, stars
    { min: b.rotation, low: 2, high: 4 },    // 79+, starters and rotation
    { min: b.fringe, low: 1, high: 3 },      // 70+, end of the bench
    { min: 0, low: 1, high: 2 }              // everyone else
  ];
}
// Nobody signs a deal that runs past the age players stop being signable at —
// otherwise 36-year-olds collect five-year contracts and the league fills up
// with unwaivable 41-year-olds.
const CONTRACT_AGE_HORIZON = 39;

function contractYearsFor(player, rng) {
  const band = contractYearBands().find(function (b) { return player.overall >= b.min; });
  const drawn = band.low + Math.floor(rng() * (band.high - band.low + 1));
  const ageLimit = Math.max(1, CONTRACT_AGE_HORIZON - (player.age || 25));
  return Math.max(1, Math.min(MAX_CONTRACT_YEARS, drawn, ageLimit));
}

// Rebuilding teams shouldn't behave like a win-now team's free agency
// department — a young core doesn't need veteran depth crowding out
// developmental minutes. Skipped only for players who don't fit a youth
// movement (established veterans); a young free agent still gets a normal
// look even from a rebuilding team.
const REBUILDING_SKIP_CHANCE = 0.9;
const REBUILDING_SKIP_AGE_THRESHOLD = 27;

const ROSTER_MAX = 15;
const MIN_SALARY = 1200000;

// THE one answer to "what may this team offer a free agent?".
//
// This lived inline inside generateAIOffer, which meant it only ever
// constrained offers the AI generated. The user's bidding path
// (freeAgencyBidding.js) does not go through that function, so it was bound by
// nothing: a team $33.6M OVER the cap — refused outright when it is the AI —
// could sign a $1,000,000,000 contract and take its payroll to eight times the
// cap. A rule written inside one caller is not a rule.
//
// Returns the ceiling and, when there is none, the reason to show the user.
// capSpace comes back too because generateAIOffer needs it for its own budget
// maths; this must stay a pure extraction, or league behaviour moves and every
// golden fixture is invalidated along with it.
function offerLimit(team) {
  const capDisabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.capDisabled;
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
  const payroll = _FA_DATA.league.getTeamPayroll(team.id);
  const capSpace = _FA_DATA.data.getEffectiveSalaryCap(capLevel) - payroll;

  if (_FA_DATA.league.getTeamRoster(team.id).length >= ROSTER_MAX) {
    return { max: 0, min: MIN_SALARY, capSpace: capSpace, capDisabled: capDisabled,
      reason: 'Roster is full (' + ROSTER_MAX + ' players).' };
  }
  if (capDisabled) {
    return { max: Infinity, min: MIN_SALARY, capSpace: capSpace, capDisabled: true, reason: null };
  }
  if (capSpace < MIN_SALARY) {
    return { max: 0, min: MIN_SALARY, capSpace: capSpace, capDisabled: false,
      reason: 'No cap space: payroll is $' + Math.abs(capSpace).toLocaleString() +
        ' over the $' + _FA_DATA.data.getEffectiveSalaryCap(capLevel).toLocaleString() + ' cap.' };
  }
  return { max: capSpace, min: MIN_SALARY, capSpace: capSpace, capDisabled: false, reason: null };
}

// Why a specific offer is or is not legal. Shared by the bidding path and the
// panel that renders the inputs, so the numbers the user is told and the ones
// the model enforces cannot drift apart.
//
// BOTH boxes on that form are user input. The first version of this guarded
// salary and not years, and $5,000,000 x 99 years signed cleanly — a superstar
// locked up for a century at a rotation player's price. Hardening one field on
// a form is how a closed exploit reopens next to itself.
function checkOffer(team, salary, years) {
  const limit = offerLimit(team);
  if (limit.reason) return { ok: false, reason: limit.reason, limit: limit };
  if (!(salary >= limit.min)) {
    return { ok: false, reason: 'Offer is below the $' + limit.min.toLocaleString() +
      ' league minimum.', limit: limit };
  }
  if (salary > limit.max) {
    return { ok: false, reason: 'Offer exceeds your $' + limit.max.toLocaleString() +
      ' in cap space.', limit: limit };
  }
  // Whole years only, within the same 1..MAX_CONTRACT_YEARS the AI is held to
  // by contractYearsFor. NaN (an emptied box) fails every comparison, so it is
  // caught here rather than being signed as a NaN-year deal.
  if (!(years >= 1 && years <= MAX_CONTRACT_YEARS && Math.floor(years) === years)) {
    return { ok: false, reason: 'Contracts run 1 to ' + MAX_CONTRACT_YEARS +
      ' whole years.', limit: limit };
  }
  return { ok: true, reason: null, limit: limit };
}

function generateAIOffer(team, player, rng, roundsUnsigned) {
  const limit = offerLimit(team);
  if (limit.reason) return null;
  const capDisabled = limit.capDisabled;
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : 1;
  const payroll = _FA_DATA.league.getTeamPayroll(team.id);
  const capSpace = limit.capSpace;

  // A team still below the salary floor needs to keep spending regardless of
  // owner mood or marginal interest — it's on the hook for the shortfall as
  // a floor tax at season end either way (finances.js's applySeasonEndFinances),
  // so it may as well spend that money on a roster spot instead.
  const belowFloor = payroll < _FA_DATA.data.getEffectiveSalaryFloor(capLevel);
  const spendMultiplier = belowFloor ? 1 : _FA_DATA.finances.budgetSpendMultiplier(team);

  if (!belowFloor && team.timeline === 'rebuilding' && player.age >= REBUILDING_SKIP_AGE_THRESHOLD && rng() < REBUILDING_SKIP_CHANCE) return null;

  const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
  if (interest < (belowFloor ? 25 : 40)) return null;
  const fair = estimateFairSalary(player, roundsUnsigned);
  const budgetCappedSpace = capDisabled ? Infinity : capSpace * spendMultiplier;
  // Clamped to the space actually available. The old Math.max(1200000, ...)
  // ran last, so when budgetCappedSpace came in under the minimum it handed
  // back a $1.2M offer the team couldn't fit — the one place the cap check
  // above could be silently overrun.
  const desired = Math.min(budgetCappedSpace, Math.round(fair * (0.85 + rng() * 0.3)));
  const salary = capDisabled ? Math.max(1200000, desired) : Math.max(1200000, Math.min(desired, capSpace));
  const years = contractYearsFor(player, rng);
  return { teamId: team.id, salary: salary, yearsRemaining: years };
}

// --- Re-signing --------------------------------------------------------------
//
// The window that did not exist. Contracts simply ran out and the player was
// cut loose (decrementContracts set teamId = null) before free agency opened,
// so a franchise player's own team had no claim on him and no chance to speak
// first — it was one of ~20 bidders on the open market like anybody else.
//
// A team now gets first refusal on its own expiring players, BEFORE the market
// exists. Two things make it a real decision rather than a formality:
//
//   - the team must want him (the same interest bar the AI applies to any
//     free agent) and have a roster spot,
//   - the player compares the offer against what the open market would
//     actually pay him, computed with the same functions the market uses.
//
// He may exceed the cap to re-sign HIS OWN player and nobody else — real
// leagues work this way, and without it the good teams (which are the ones
// over the cap) would still lose every star they developed. The salary is the
// model's own asking price, so this is not a door back into "offer a billion".
const RESIGN_MAX_PREMIUM = 1.5;   // the most a team may bid above the asking price

// A team is allowed to walk away from its own declining veteran — first
// refusal is a decision, not an obligation.
//
// NOT generateAIOffer's bar of 40, which was the first thing tried and is
// near-dead here. That number is tuned for the FREE AGENT pool, which collects
// washed-up players nobody has signed in years; among players actually on a
// roster the value distribution sits far higher. Measured over 640 expiring
// players across 4 offseasons: min 36, p05 58.4, p10 66.2, median 94.1.
//
//   bar 40 declines 0.3%   50 -> 1.6%   55 -> 3.0%
//   bar 58 declines 4.8%   60 -> 5.9%   62 -> 6.6%
//
// 58, for a decline rate near 5% — often enough that a fading veteran being
// let go is a thing that happens, rare enough that it is not how most players
// leave. At 40 it fired for 2 players in 640, and deleting the check outright
// changed no test result.
const RESIGN_INTEREST_BAR = 58;

function resignAsk(player, rng) {
  return {
    salary: estimateFairSalary(player, 0),
    yearsRemaining: contractYearsFor(player, rng)
  };
}

// What the open market would give him — the best offer from anyone else,
// scored exactly as resolveFreeAgentSilently would score it. Computed with the
// player still on his roster, which is the point: his own team's payroll still
// carries him, so rivals with space look richer, just as they should.
function bestMarketAlternative(player, rng, excludeTeamId) {
  let best = null, bestScore = -Infinity;
  _FA_DATA.teams.TEAMS.forEach(function (t) {
    if (t.id === excludeTeamId) return;
    const offer = generateAIOffer(t, player, rng);
    if (!offer) return;
    const s = scoreOffer(player, t, offer);
    if (s > bestScore) { best = offer; bestScore = s; }
  });
  return { offer: best, score: best ? bestScore : -Infinity };
}

// Would this player accept this re-signing offer? Exported so the user's panel
// can show the verdict before committing, rather than making them guess.
function evaluateResign(player, team, offer, rng) {
  const incumbentOffer = {
    teamId: team.id, salary: offer.salary,
    yearsRemaining: offer.yearsRemaining, incumbent: true
  };
  const mine = scoreOffer(player, team, incumbentOffer);
  const market = bestMarketAlternative(player, rng, team.id);
  return {
    accepted: mine >= market.score,
    offer: incumbentOffer,
    myScore: mine,
    marketScore: market.score,
    marketOffer: market.offer
  };
}

// Bounds on what a team may offer its own expiring player. Same shape as
// checkOffer so the panel can treat them alike.
function checkResignOffer(team, player, salary, years, rng) {
  const ask = resignAsk(player, rng);
  const max = Math.round(ask.salary * RESIGN_MAX_PREMIUM);
  if (_FA_DATA.league.getTeamRoster(team.id).length > ROSTER_MAX) {
    return { ok: false, reason: 'Roster is full (' + ROSTER_MAX + ' players).', ask: ask, max: max };
  }
  if (!(salary >= ask.salary)) {
    return { ok: false, reason: 'He is asking $' + ask.salary.toLocaleString() + '.', ask: ask, max: max };
  }
  if (salary > max) {
    return { ok: false, reason: 'You cannot go above $' + max.toLocaleString() +
      ' to re-sign your own player.', ask: ask, max: max };
  }
  if (!(years >= 1 && years <= MAX_CONTRACT_YEARS)) {
    return { ok: false, reason: 'Contracts run 1 to ' + MAX_CONTRACT_YEARS + ' years.', ask: ask, max: max };
  }
  return { ok: true, reason: null, ask: ask, max: max };
}

// Commits a re-signing. Separate from signPlayer only in that the player is
// already on the roster, so signPlayer's own 're_signing' branch finally
// becomes reachable — it never could be before, because teamId was always
// wiped first.
function applyResign(player, team, offer) {
  signPlayer(player, { teamId: team.id, salary: offer.salary, yearsRemaining: offer.yearsRemaining });
}

// Runs first refusal across the league for everyone whose deal has just run
// out. `deferTeamId` (the human's team) is skipped and reported back instead,
// so the user makes their own calls rather than having an assistant GM make
// them; those players carry resignRights until the user acts or the market
// opens.
//
// Best players first, so a team facing two expiring stars and one roster spot
// keeps the better one — the same ordering runFreeAgencySilently uses.
//
// `lost` entries carry WHY: 'declined' (the team did not want him) or 'walked'
// (he preferred the market). Collapsing the two into a bare list hid the
// difference well enough that deleting the interest bar changed no test result.
function runResigningWindow(expiring, rng, deferTeamId) {
  const resigned = [], lost = [], deferred = [];
  expiring.slice()
    .sort(function (a, b) {
      return _FA_DATA.tradeEvaluator.basePlayerValue(b) - _FA_DATA.tradeEvaluator.basePlayerValue(a);
    })
    .forEach(function (player) {
      const team = _FA_DATA.teams.getTeamById(player.teamId);
      if (!team) return;
      const ask = resignAsk(player, rng);
      if (player.teamId === deferTeamId) {
        player.resignRights = { teamId: team.id, salary: ask.salary, yearsRemaining: ask.yearsRemaining };
        deferred.push(player);
        return;
      }
      // Does the team even want him? Same bar the AI applies to any free
      // agent, so a declining veteran is allowed to be let go.
      const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
      if (interest < RESIGN_INTEREST_BAR || _FA_DATA.league.getTeamRoster(team.id).length > ROSTER_MAX) {
        lost.push({ player: player, reason: 'declined' });
        return;
      }
      const verdict = evaluateResign(player, team, ask, rng);
      if (!verdict.accepted) { lost.push({ player: player, reason: 'walked' }); return; }
      applyResign(player, team, ask);
      resigned.push({ playerId: player.id, teamId: team.id, salary: ask.salary, yearsRemaining: ask.yearsRemaining });
    });
  return { resigned: resigned, lost: lost, deferred: deferred };
}

// A deferred player STAYS on the roster, on an expired contract, until the
// user acts — decrementContracts deliberately does not release anyone still
// holding rights. Both endings below therefore have to release him themselves;
// leaving him rostered on a zero-year deal is how he would become permanent.
function releaseFromRights(player) {
  delete player.resignRights;
  player.teamId = null;
}

// The user's outstanding rights, exercised for them when free agency is
// automated (spectator mode, or autoFreeAgency on) — otherwise an automated
// save would quietly lose every star it was meant to keep.
function autoExerciseResignRights(teamId, rng) {
  const done = [];
  const team = _FA_DATA.teams.getTeamById(teamId);
  _FA_DATA.league.getTeamRoster(teamId).slice().forEach(function (player) {
    if (!player.resignRights) return;
    const ask = { salary: player.resignRights.salary, yearsRemaining: player.resignRights.yearsRemaining };
    const interest = _FA_DATA.tradeEvaluator.adjustedPlayerValue(player, team);
    const verdict = evaluateResign(player, team, ask, rng);
    if (interest >= 40 && verdict.accepted) {
      delete player.resignRights;
      applyResign(player, team, ask);
      done.push({ playerId: player.id, teamId: teamId, salary: ask.salary, yearsRemaining: ask.yearsRemaining });
    } else {
      releaseFromRights(player);
    }
  });
  return done;
}

// Anyone the user never got round to. Called when the market opens: rights do
// not survive into free agency, and an unexercised one means he walks.
function releaseUnexercisedResignRights(teamId) {
  const released = [];
  _FA_DATA.league.getTeamRoster(teamId).slice().forEach(function (player) {
    if (!player.resignRights) return;
    releaseFromRights(player);
    released.push(player.id);
  });
  return released;
}

const ROSTER_FLOOR = 12;

// The ceiling's own league-wide sweep, symmetric to enforceRosterFloors below
// and for the same reason: nothing else guarantees an AI team ends the
// offseason legal. The draft hands every team two rookies unconditionally, so
// a team that entered the offseason full comes out at 16-17 — free agency then
// correctly refuses to sign anyone FOR them, but nothing ever waived anyone
// either, and the team simply played the whole season over the limit
// (measured: 2-7 teams per season across ten simulated seasons).
// autoEnforceRosterSize (autoGM.js) is this exact loop and only ever ran
// against the user's team.
//
// The user's team is deliberately excluded: their over-cap handling is the
// opt-in Auto Roster-Size Compliance setting plus the unattended rollover
// path (seasonRollover.js), and a league sweep must not waive the user's
// players out from under a choice they were given a setting for.
function enforceRosterCeilings() {
  const userTeamId = typeof GameState !== 'undefined' ? GameState.userTeamId : null;
  const waived = [];
  _FA_DATA.teams.TEAMS.forEach(function (team) {
    if (team.id === userTeamId) return;
    let roster = _FA_DATA.league.getTeamRoster(team.id);
    while (roster.length > ROSTER_MAX) {
      const worst = roster.slice().sort(function (a, b) {
        return _FA_DATA.tradeEvaluator.adjustedPlayerValue(a, team) - _FA_DATA.tradeEvaluator.adjustedPlayerValue(b, team);
      })[0];
      const result = _FA_DATA.rosterMoves.waivePlayer(worst.id);
      if (!result.success) break;
      waived.push({ playerId: worst.id, teamId: team.id });
      roster = _FA_DATA.league.getTeamRoster(team.id);
    }
  });
  return waived;
}

// Nothing else guarantees an AI team ends free agency legal. decrementContracts
// can drop a team to any size, generateAIOffer above declines anyone under its
// interest bar, and autoEnforceRosterSize only ever ran against the user's team
// — so a team could sit below 12 indefinitely, at which point validateRosterSizes
// (trade.js) rejects every trade it proposes for the rest of the save.
// Minimum-salary signings, interest bar bypassed, worst-off teams served first.
function enforceRosterFloors() {
  const signings = [];
  const short = _FA_DATA.teams.TEAMS
    .filter(function (t) { return _FA_DATA.league.getTeamRoster(t.id).length < ROSTER_FLOOR; })
    .sort(function (a, b) {
      return _FA_DATA.league.getTeamRoster(a.id).length - _FA_DATA.league.getTeamRoster(b.id).length;
    });

  short.forEach(function (team) {
    while (_FA_DATA.league.getTeamRoster(team.id).length < ROSTER_FLOOR) {
      const pool = _FA_DATA.rosterMoves.getFreeAgents();
      if (pool.length === 0) return;
      const best = pool.slice().sort(function (a, b) {
        return _FA_DATA.tradeEvaluator.adjustedPlayerValue(b, team) - _FA_DATA.tradeEvaluator.adjustedPlayerValue(a, team);
      })[0];
      signPlayer(best, { teamId: team.id, salary: 1200000, yearsRemaining: 1 });
      signings.push({ playerId: best.id, teamId: team.id });
    }
  });
  return signings;
}

function signPlayer(player, offer) {
  const roster = _FA_DATA.league.getTeamRoster(offer.teamId);
  const team = _FA_DATA.teams.getTeamById(offer.teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }).concat((team && team.retiredNumbers) || []));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  const contractType = player.teamId === offer.teamId ? 're_signing' : 'free_agency';
  player.teamId = offer.teamId;
  player.jerseyNumber = jersey;
  player.contract = { salary: offer.salary, yearsRemaining: offer.yearsRemaining, playerOption: false, teamOption: false };
  // GameState is a browser global from script.js — guarded since freeAgency.js
  // also runs standalone under Node in scripts/validate-offseason.js.
  const leagueYear = typeof GameState !== 'undefined' ? (GameState.leagueYear || 2026) : undefined;
  _FA_DATA.careerHistory.recordContractInHistory(player, leagueYear, offer.salary, offer.yearsRemaining, offer.teamId, contractType);
  // Landing a new deal is a positive event regardless of whether it's a
  // fresh signing or a re-signing with the incumbent team.
  if (player.status && player.status.morale !== undefined) {
    player.status.morale = Math.min(100, player.status.morale + 4);
  }
  // pushToFeed is a browser-global from script.js — guarded since freeAgency.js
  // also runs standalone under Node in scripts/validate-offseason.js.
  if (typeof pushToFeed === 'function') {
    const team = _FA_DATA.teams.getTeamById(offer.teamId);
    pushToFeed(player.name + ' signs with ' + team.name + ' ($' + offer.salary.toLocaleString() + '/yr, ' +
      offer.yearsRemaining + ' yr' + (offer.yearsRemaining === 1 ? '' : 's') + ')');
  }
}

function resolveFreeAgentSilently(player, rng, roundsUnsigned) {
  const offers = _FA_DATA.teams.TEAMS.map(function (t) { return generateAIOffer(t, player, rng, roundsUnsigned); }).filter(Boolean);
  if (offers.length === 0) return null;
  let best = offers[0];
  let bestScore = scoreOffer(player, _FA_DATA.teams.getTeamById(best.teamId), best);
  for (let i = 1; i < offers.length; i++) {
    const score = scoreOffer(player, _FA_DATA.teams.getTeamById(offers[i].teamId), offers[i]);
    if (score > bestScore) { best = offers[i]; bestScore = score; }
  }
  signPlayer(player, best);
  return best;
}

// Resolves every current free agent, best (highest base value) first — so
// stars sign before the depth-piece market resolves against whatever cap
// space is left, same as how real free agency tends to play out. Runs
// multiple rounds over whoever's still unsigned: a player who gets no
// offers in round 1 (asking price too high, or every interested team's cap
// space/skip logic passed) comes back in round 2 with estimateFairSalary's
// demand decay already lowering the bar, same as a real free agent
// recalibrating expectations as the market thins out.
const MAX_FREE_AGENCY_ROUNDS = 4;

function runFreeAgencySilently(rng) {
  // Over-full teams shed players BEFORE the pool is read, so anyone waived
  // lands in THIS market rather than floating unsigned until next offseason.
  enforceRosterCeilings();
  let pool = _FA_DATA.rosterMoves.getFreeAgents().slice()
    .sort(function (a, b) { return _FA_DATA.tradeEvaluator.basePlayerValue(b) - _FA_DATA.tradeEvaluator.basePlayerValue(a); });
  const results = [];
  for (let round = 0; round < MAX_FREE_AGENCY_ROUNDS && pool.length > 0; round++) {
    const stillUnsigned = [];
    pool.forEach(function (player) {
      const offer = resolveFreeAgentSilently(player, rng, round);
      if (offer) results.push({ playerId: player.id, teamId: offer.teamId, salary: offer.salary });
      else stillUnsigned.push(player);
    });
    pool = stillUnsigned;
  }
  // Runs last, on whoever the open market left behind, so a team that came out
  // of the offseason short still ends up with a legal roster.
  enforceRosterFloors().forEach(function (s) {
    results.push({ playerId: s.playerId, teamId: s.teamId, salary: 1200000, floorSigning: true });
  });
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playingTimeScore: playingTimeScore,
    hypeScore: hypeScore,
    facilitiesScore: facilitiesScore,
    tradedAwayPenalty: tradedAwayPenalty,
    scoreOffer: scoreOffer,
    estimateFairSalary: estimateFairSalary,
    generateAIOffer: generateAIOffer,
    offerLimit: offerLimit,
    checkOffer: checkOffer,
    ROSTER_MAX: ROSTER_MAX,
    MIN_SALARY: MIN_SALARY,
    contractYearsFor: contractYearsFor,
    MAX_CONTRACT_YEARS: MAX_CONTRACT_YEARS,
    RESIGN_TUNING: RESIGN_TUNING,
    RESIGN_INTEREST_BAR: RESIGN_INTEREST_BAR,
    resignAsk: resignAsk,
    bestMarketAlternative: bestMarketAlternative,
    evaluateResign: evaluateResign,
    checkResignOffer: checkResignOffer,
    applyResign: applyResign,
    runResigningWindow: runResigningWindow,
    autoExerciseResignRights: autoExerciseResignRights,
    releaseUnexercisedResignRights: releaseUnexercisedResignRights,
    signPlayer: signPlayer,
    resolveFreeAgentSilently: resolveFreeAgentSilently,
    runFreeAgencySilently: runFreeAgencySilently,
    enforceRosterFloors: enforceRosterFloors,
    enforceRosterCeilings: enforceRosterCeilings,
    ROSTER_FLOOR: ROSTER_FLOOR,
    MAX_FREE_AGENCY_ROUNDS: MAX_FREE_AGENCY_ROUNDS
  };
}
