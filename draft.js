var _DRAFT_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js'), tradeEvaluator: require('./tradeEvaluator.js'), league: require('./league.js'), lotteryFormats: require('./draftLotteryFormats.js'), players: require('./players-2026.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById }, tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }, league: { getTeamRoster: getTeamRoster }, lotteryFormats: { getLotteryFormat: getLotteryFormat, DEFAULT_LOTTERY_FORMAT: DEFAULT_LOTTERY_FORMAT }, players: { PLAYERS_2026: PLAYERS_2026 } };

function weightedDrawWithoutReplacement(candidates, weightFn, count, rng) {
  let pool = candidates.map(function (c) { return { c: c, w: weightFn(c) }; });
  const picks = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce(function (s, p) { return s + p.w; }, 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    if (idx >= pool.length) idx = pool.length - 1;
    picks.push(pool[idx].c);
    pool.splice(idx, 1);
  }
  return picks;
}

// Worse record, better odds — and never the reverse. Squaring `30 - wins`
// alone flipped sign above 30: a 45-win team that missed the playoffs scored
// 225 while a 35-win team scored 25, and a team sitting exactly on 30 scored 0,
// making it literally ineligible to win the lottery. Clamping the base at 1
// leaves the odds for every sub-30-win team exactly as they were (which is the
// overwhelmingly common case and the calibration this curve was tuned for) and
// gives everything above 30 the same minimum weight instead of a rising one.
const LOTTERY_WIN_ANCHOR = 30;

function lotteryWeight(team) {
  return Math.pow(Math.max(1, LOTTERY_WIN_ANCHOR - team.record.wins), 2);
}

// Whether the bracket has been played out to a champion. playoffResultByTeam
// and everything built on it REQUIRE this — they read `bracket.finals[0]`
// unconditionally, so a bracket that merely EXISTS is not enough.
//
// The distinction is not academic. ui/draft.js guarded its lottery-odds panel
// on `GameState.playoffBracket && !GameState.draftSession`, which is true the
// moment the first round is seeded. Opening the Draft screen during the
// playoffs threw "Cannot read properties of undefined (reading 'winner')" —
// and because that render happens inside the advance loop, it also killed the
// Continue button for the rest of the session.
function playoffBracketIsComplete(bracket) {
  return !!(bracket && bracket.finals && bracket.finals[0] && bracket.finals[0].winner);
}

// The elimination round each playoff team reached: 0 first round, 1 conference
// semis, 2 conference finals, 3 lost the Finals, 4 champion. Teams that missed
// the playoffs are absent from the map entirely.
//
// Extracted from getPlayoffFinishOrder so gmCareer.js can classify a season the
// same way the lottery orders one. Two copies of this would be two definitions
// of "how the season ended", and they would disagree the first time either
// changed.
function playoffResultByTeam(bracket) {
  const eliminatedInRound = {};
  bracket.first.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 0; });
  bracket.semis.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 1; });
  bracket.confFinals.forEach(function (s) { eliminatedInRound[s.winner === s.higherSeed ? s.lowerSeed : s.higherSeed] = 2; });
  const finals = bracket.finals[0];
  eliminatedInRound[finals.winner === finals.higherSeed ? finals.lowerSeed : finals.higherSeed] = 3;
  eliminatedInRound[finals.winner] = 4;
  return eliminatedInRound;
}

// Worse playoff finish -> earlier pick. Ties within the same elimination round
// broken by regular-season wins ascending (worse record picks first).
function getPlayoffFinishOrder(bracket) {
  const eliminatedInRound = playoffResultByTeam(bracket);
  return Object.keys(eliminatedInRound).sort(function (a, b) {
    if (eliminatedInRound[a] !== eliminatedInRound[b]) return eliminatedInRound[a] - eliminatedInRound[b];
    return _DRAFT_DATA.teams.getTeamById(a).record.wins - _DRAFT_DATA.teams.getTeamById(b).record.wins;
  });
}

function buildDraftOrder(bracket, rng, formatKey) {
  const playoffTeamIds = new Set(getPlayoffFinishOrder(bracket));
  const lotteryTeams = _DRAFT_DATA.teams.TEAMS.filter(function (t) { return !playoffTeamIds.has(t.id); });
  const sortedWorstFirst = lotteryTeams.slice().sort(function (a, b) { return a.record.wins - b.record.wins; });
  const format = _DRAFT_DATA.lotteryFormats.getLotteryFormat(formatKey || _DRAFT_DATA.lotteryFormats.DEFAULT_LOTTERY_FORMAT);

  const weights = format.getWeights(sortedWorstFirst);
  const weightFn = function (team) { return weights[sortedWorstFirst.indexOf(team)]; };
  const drawn = weightedDrawWithoutReplacement(sortedWorstFirst, weightFn, format.numLotteryPicks, rng);
  const drawnIds = new Set(drawn.map(function (t) { return t.id; }));
  const remainingLottery = lotteryTeams.filter(function (t) { return !drawnIds.has(t.id); })
    .sort(function (a, b) { return a.record.wins - b.record.wins; });

  const rawFirstRound = drawn.map(function (t) { return t.id; })
    .concat(remainingLottery.map(function (t) { return t.id; }))
    .concat(getPlayoffFinishOrder(bracket));

  // Second round: straight reverse full-season record for all 30 teams, no lottery.
  const rawSecondRound = _DRAFT_DATA.teams.TEAMS.slice()
    .sort(function (a, b) { return a.record.wins - b.record.wins; })
    .map(function (t) { return t.id; });

  return {
    firstRound: remapForPickOwnership(rawFirstRound, 1),
    secondRound: remapForPickOwnership(rawSecondRound, 2)
  };
}

// Standings determine WHICH SLOT each original team's pick lands in; this
// remaps each slot to whoever currently owns that original team's pick, so a
// traded pick actually gets drafted by the team that acquired it.
function remapForPickOwnership(order, round) {
  return order.map(function (originalTeamId) {
    const originalTeam = _DRAFT_DATA.teams.getTeamById(originalTeamId);
    const pick = originalTeam.draftPicks.find(function (p) { return p.round === round; });
    return pick ? pick.currentOwnerId : originalTeamId;
  });
}

function selectAIPick(teamId, availableProspects) {
  if (!availableProspects || availableProspects.length === 0) return null;
  const team = _DRAFT_DATA.teams.getTeamById(teamId);
  let best = availableProspects[0];
  let bestValue = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(best, team);
  for (let i = 1; i < availableProspects.length; i++) {
    const value = _DRAFT_DATA.tradeEvaluator.adjustedPlayerValue(availableProspects[i], team);
    if (value > bestValue) { best = availableProspects[i]; bestValue = value; }
  }
  return best;
}

// The first round is one pick per team, so the round-1/round-2 boundary moves
// with league size (expansion). Callers that know the real draft order pass its
// first-round length; the default keeps the original 30-team scale for any
// caller that doesn't (and for the salary curve's shape).
function firstRoundSize(roundSize) {
  return roundSize || _DRAFT_DATA.teams.TEAMS.length || 30;
}

function rookieSalary(pickNumber, roundSize) {
  const n = firstRoundSize(roundSize);
  const spread = Math.max(1, n - 1);
  if (pickNumber <= n) {
    return Math.round(10000000 - (pickNumber - 1) * (7500000 / spread));
  }
  const secondRoundSlot = pickNumber - n;
  return Math.round(2200000 - (secondRoundSlot - 1) * (1100000 / spread));
}

function rookieYears(pickNumber, roundSize) {
  return pickNumber <= firstRoundSize(roundSize) ? 4 : 2;
}

function executePick(teamId, prospect, pickNumber, roundSize) {
  const roster = _DRAFT_DATA.league.getTeamRoster(teamId);
  const team = _DRAFT_DATA.teams.getTeamById(teamId);
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }).concat((team && team.retiredNumbers) || []));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;

  prospect.teamId = teamId;
  prospect.jerseyNumber = jersey;
  prospect.yearsPro = 0;
  prospect.contract = { salary: rookieSalary(pickNumber, roundSize), yearsRemaining: rookieYears(pickNumber, roundSize), playerOption: false, teamOption: false };
}

// The one place a drafted prospect joins the league pool. Both draft paths go
// through it: the session/manual one below, and the automatic one in
// seasonTransition.js's runOffseasonThroughDraft.
//
// Guards by ID, not by object identity, which is what resolveCurrentPick used
// to check on its own. Identity is not enough: a save round-trip serializes the
// player pool, upcomingDraftClass and draftSession as three separate object
// graphs, so one prospect comes back as several DIFFERENT objects sharing one
// id — and an identity check waves every one of them through. Two entries with
// one id is the shape that once reached players as "players duplicating on
// rosters, salary cap integer becomes weird".
//
// It refuses rather than throws, so a mis-sequenced draft costs a pick instead
// of the league, but it is never expected: getting here means some prospect
// pool was drafted twice. So it says so out loud rather than dropping the pick
// quietly — a silent guard would have made that older bug rarer to notice, not
// rarer to happen.
function addDraftedProspect(prospect) {
  const pool = _DRAFT_DATA.players.PLAYERS_2026;
  const clash = pool.some(function (p) { return p.id === prospect.id; });
  if (clash) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('draft: ' + prospect.name + ' (' + prospect.id + ') is already in the league — ' +
        'a prospect pool has been drafted twice; the pick was dropped rather than duplicate him');
    }
    return false;
  }
  pool.push(prospect);
  return true;
}

function runDraft(draftOrder, prospectPool) {
  const results = [];
  let available = prospectPool.slice();
  // Second-round pick numbers continue from wherever the first round actually
  // ended. Hardcoding 30 made a 31-team league emit pick #31 twice — once as
  // the last first-rounder and again as the first second-rounder.
  const roundSize = draftOrder.firstRound.length;

  function runRound(order, round, pickOffset) {
    order.forEach(function (teamId, i) {
      // The prospect pool can run dry if it was sized for a smaller league.
      // Skipping is the right behavior: a team forfeits the pick rather than
      // the whole draft throwing on an undefined prospect.
      if (available.length === 0) return;
      const pickNumber = pickOffset + i + 1;
      const prospect = selectAIPick(teamId, available);
      executePick(teamId, prospect, pickNumber, roundSize);
      available = available.filter(function (p) { return p.id !== prospect.id; });
      results.push({ teamId: teamId, prospect: prospect, pickNumber: pickNumber, round: round });
    });
  }

  runRound(draftOrder.firstRound, 1, 0);
  runRound(draftOrder.secondRound, 2, roundSize);

  return results;
}

function startDraftSession(draftOrder, prospectPool) {
  const roundSize = draftOrder.firstRound.length;
  const picks = draftOrder.firstRound.map(function (teamId, i) { return { teamId: teamId, round: 1, pickNumber: i + 1 }; })
    .concat(draftOrder.secondRound.map(function (teamId, i) { return { teamId: teamId, round: 2, pickNumber: roundSize + i + 1 }; }));
  return { picks: picks, index: 0, available: prospectPool.slice(), results: [], roundSize: roundSize };
}

function currentPick(session) {
  return session.index < session.picks.length ? session.picks[session.index] : null;
}

function resolveCurrentPick(session, prospect) {
  const pick = currentPick(session);
  if (!pick) return null;
  // An exhausted prospect pool forfeits the pick rather than throwing — same
  // handling runDraft applies on the fully-automatic path.
  if (!prospect) {
    session.index += 1;
    return null;
  }
  executePick(pick.teamId, prospect, pick.pickNumber, session.roundSize);
  // The manual/session draft flow is the only place a drafted prospect gets
  // attached to a roster — unlike runDraft's automatic path, whose caller
  // (seasonTransition.js's runOffseasonThroughDraft) pushes every drafted
  // prospect into PLAYERS_2026 itself. Without this, executePick's mutation
  // sets .teamId on an object nothing else ever pushed into PLAYERS_2026, so
  // no roster/payroll/getPlayerById lookup (every one of which reads
  // PLAYERS_2026 directly) can see it: a manually-drafted rookie vanished
  // instead of joining the team.
  addDraftedProspect(prospect);
  session.available = session.available.filter(function (p) { return p.id !== prospect.id; });
  const result = { teamId: pick.teamId, prospect: prospect, pickNumber: pick.pickNumber, round: pick.round };
  session.results.push(result);
  session.index += 1;
  return result;
}

// Advances through AI-controlled picks until either the draft ends or it's
// the user's turn to choose by hand — mirrors the manual/automatic split
// freeAgencyBidding.js already uses for FA bidding: no promises, driven step
// by step by the UI (call this again after resolveCurrentPick to continue).
function advanceDraftUntilUserTurn(session, userTeamId, autoDraftOn) {
  let pick = currentPick(session);
  while (pick && (autoDraftOn || pick.teamId !== userTeamId)) {
    resolveCurrentPick(session, selectAIPick(pick.teamId, session.available));
    pick = currentPick(session);
  }
  return session;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weightedDrawWithoutReplacement: weightedDrawWithoutReplacement,
    lotteryWeight: lotteryWeight,
    playoffResultByTeam: playoffResultByTeam,
    playoffBracketIsComplete: playoffBracketIsComplete,
    getPlayoffFinishOrder: getPlayoffFinishOrder,
    buildDraftOrder: buildDraftOrder,
    remapForPickOwnership: remapForPickOwnership,
    selectAIPick: selectAIPick,
    rookieSalary: rookieSalary,
    rookieYears: rookieYears,
    executePick: executePick,
    runDraft: runDraft,
    startDraftSession: startDraftSession,
    currentPick: currentPick,
    addDraftedProspect: addDraftedProspect,
    resolveCurrentPick: resolveCurrentPick,
    advanceDraftUntilUserTurn: advanceDraftUntilUserTurn
  };
}
