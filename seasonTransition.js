var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js'), schedule: require('./schedule.js'), history: require('./history.js'), coaches: require('./coaches.js'), ratings: require('./ratings.js'), rosterMoves: require('./rosterMoves.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft, addDraftedProspect: addDraftedProspect },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass },
      schedule: { generateSeasonGames: generateSeasonGames },
      history: { archiveRetiree: archiveRetiree },
      coaches: { ensureAllTeamsHaveCoaches: ensureAllTeamsHaveCoaches },
      ratings: { RATING_BANDS: RATING_BANDS },
      rosterMoves: { decrementDeadMoney: decrementDeadMoney }
    };

// freeAgency.js loads AFTER this file in index.html (line 114 against line 77),
// and careerHistory.js — which freeAgency requires — requires this file back.
// Capturing runResigningWindow in the eager block above would therefore bind
// `undefined` in the browser and half a module under Node. Resolved lazily, at
// which point everything has finished loading. Same reasoning as league.js's
// _simDeps.
function _resignDeps() {
  return (typeof require !== 'undefined')
    ? { freeAgency: require('./freeAgency.js') }
    : { freeAgency: { runResigningWindow: runResigningWindow } };
}

// Retirement chance rises sharply after 33, further penalized for players whose
// production has fallen off. Full HOF/history tracking is Phase 8 — here a
// retired player just leaves the active player pool entirely.
// Split out of rollRetirement so it can be measured without rolling dice.
// The population this catches is the thing that rotted: written for the old
// authored 62-98 scale, it was meant for fringe players and now catches 94%
// of the league. scripts/validate-ratingBands.js asserts its share.
function hasRetirementPenalty(player) {
  return player.overall < _TRANSITION_DATA.ratings.RATING_BANDS.fringe;
}

// The age curve below only ever fired at 34+, which meant 100% of players
// survived to 33 — measured, not estimated. Nobody could leave the league for
// being not good enough, only for being old. That is why the free-agent pool
// grew without bound (496 unsigned against 370 rostered by season 12) and why
// the league went 380 -> 916 players in fifteen seasons.
//
// Real careers do not end in retirement announcements; they end when the phone
// stops ringing. `washoutSeasons` is that: go this many consecutive seasons
// without anyone signing you and you are out, at any age. It is the drain the
// league never had — the draft adds 60 a year and nothing removed more than a
// handful.
var RETIREMENT_TUNING = { minAge: 34, perYear: 0.08, fringePenalty: 0.15, cap: 0.9, washoutSeasons: 2 };

function rollRetirement(player, rng) {
  // Checked before the age gate, because washing out is not about age. Guarded
  // on the field existing so callers that build bare player literals (several
  // validate scripts do) keep their existing behaviour.
  if ((player.seasonsUnsigned || 0) >= RETIREMENT_TUNING.washoutSeasons) return true;
  if (player.age < RETIREMENT_TUNING.minAge) return false;
  const baseChance = (player.age - (RETIREMENT_TUNING.minAge - 1)) * RETIREMENT_TUNING.perYear;
  const overallPenalty = hasRetirementPenalty(player) ? RETIREMENT_TUNING.fringePenalty : 0;
  return rng() < Math.min(RETIREMENT_TUNING.cap, baseChance + overallPenalty);
}

// Contracts run out, and THEN their teams get first refusal. Before the
// re-signing window existed this function was the whole story: the deal hit
// zero and the player was cut loose on the spot, which is why no player in the
// league had ever re-signed where he already played.
//
// deferTeamId (the human's team) is not decided automatically. Those players
// keep their roster spot on an expired contract and carry resignRights until
// the user acts or the market opens — freeAgency.releaseUnexercisedResignRights
// is what finally lets them go, so the wipe below must leave them alone.
function decrementContracts(rng, deferTeamId) {
  const players = _TRANSITION_DATA.players.PLAYERS_2026;
  players.forEach(function (p) {
    if (!p.teamId) return;
    p.contract.yearsRemaining -= 1;
  });

  if (rng) {
    const expiring = players.filter(function (p) { return p.teamId && p.contract.yearsRemaining <= 0; });
    _resignDeps().freeAgency.runResigningWindow(expiring, rng, deferTeamId);
  }

  players.forEach(function (p) {
    if (!p.teamId) return;
    if (p.contract.yearsRemaining <= 0 && !p.resignRights) p.teamId = null;
  });

  // Alongside the live contracts, at the same rate — a debt that ages slower
  // than the deal it came from outlives it, and one that ages faster vanishes
  // while the cap sheet still says it is owed.
  _TRANSITION_DATA.rosterMoves.decrementDeadMoney(_TRANSITION_DATA.teams.TEAMS);
}

// Progression, retirement, contract expiration, and per-season status reset —
// everything the offseason needs BEFORE the draft. Split out from
// runOffseasonThroughDraft (which still calls this internally, so its own
// signature/behavior is unchanged) so the manual-draft path can run these
// steps once and then drive the draft itself via draft.js's session API,
// instead of duplicating this logic.
function runOffseasonPreDraft(rng, leagueYear, deferTeamId) {
  // Progression and retirement run over EVERY player, not just rostered ones.
  // progressPlayer is what increments age/yearsPro, so scoping this to
  // `p.teamId` meant a player whose contract expired was frozen at his current
  // age forever and could never roll retirement — the free-agent pool filled up
  // with permanently-27-year-olds that AI teams keep declining, and nothing
  // ever removed them. Free agents still get an empty `teammates` list, so the
  // Mentor bonus stays a roster-only effect.
  const allPlayers = _TRANSITION_DATA.players.PLAYERS_2026.slice();
  const rosterPlayers = allPlayers.filter(function (p) { return p.teamId; });
  // Secret badge evolutions are collected as they happen so the offseason can
  // report them. They are the rarest thing in the game — if one fires and
  // nothing tells the player, it may as well not have.
  const secretBadges = [];
  allPlayers.forEach(function (p) {
    const teammates = p.teamId
      ? rosterPlayers.filter(function (tp) { return tp.teamId === p.teamId && tp.id !== p.id; })
      : [];
    const evolved = _TRANSITION_DATA.progression.progressPlayer(p, rng, teammates);
    if (evolved) {
      secretBadges.push({
        playerId: p.id, playerName: p.name, teamId: p.teamId,
        key: evolved.key, name: evolved.name
      });
    }
  });

  // Counted BEFORE decrementContracts runs below, so `teamId` still reflects
  // the season just played: a player who was on a roster all year has his
  // counter cleared, and one who sat out free agency again has it advanced.
  allPlayers.forEach(function (p) {
    p.seasonsUnsigned = p.teamId ? 0 : (p.seasonsUnsigned || 0) + 1;
  });

  const retirees = allPlayers.filter(function (p) { return rollRetirement(p, rng); });
  // Captured BEFORE the splice below, because after it the player object is
  // gone from the league and nothing downstream can say who left.
  //
  // This used to return a bare count. A playtester watched a 95 OVR All-NBA
  // franchise cornerstone vanish between seasons with no headline, no tribute,
  // nothing — while the same offseason produced three separate conversations
  // about a bench player's minutes. The engine to mark it already existed; the
  // retirement simply never told anyone it had happened.
  const retiredSummaries = retirees.map(function (p) {
    return {
      id: p.id, name: p.name, teamId: p.teamId, age: p.age,
      overall: p.rawOverall || p.overall || 0,
      // yearsPro as the floor, not just careerStats.seasonsPlayed. The latter
      // counts only seasons THIS SAVE has simulated, so a veteran who retires
      // in the first or second year of a league reads as having played none —
      // "Kawhi Leonard calls it a career at 42 — a career that never got going"
      // was the actual output.
      seasons: Math.max((p.careerStats && p.careerStats.seasonsPlayed) || 0, p.yearsPro || 0),
      // Kept SEPARATE from `seasons` on purpose: points are only known for the
      // seasons this save actually simulated, so the two numbers have different
      // provenance and must never be quoted as one fact. See announceRetirements.
      simSeasons: (p.careerStats && p.careerStats.seasonsPlayed) || 0,
      points: (p.careerStats && p.careerStats.points) || 0,
      titles: p.championshipsWon || 0
    };
  });
  retirees.forEach(function (p) {
    _TRANSITION_DATA.history.archiveRetiree(p, leagueYear);
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  decrementContracts(rng, deferTeamId);

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  // A player who evolved a badge and then retired in the same offseason is
  // dropped: reporting a discovery for someone who has already left is noise.
  const stillActive = {};
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) { stillActive[p.id] = true; });
  return {
    retireeCount: retirees.length,
    retirees: retiredSummaries,
    secretBadges: secretBadges.filter(function (s) { return stillActive[s.playerId]; })
  };
}

function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass, leagueYear, lotteryFormat, deferTeamId) {
  const pre = runOffseasonPreDraft(rng, leagueYear, deferTeamId);

  // The prospect pool is generated by the caller ahead of time (real 2026
  // class for the first draft, or the class generateNewSeason produced at
  // the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng, lotteryFormat);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
  // Through draft.js rather than pushing here, so both draft paths share one
  // duplicate guard — see addDraftedProspect.
  draftResults.forEach(function (r) { _TRANSITION_DATA.draft.addDraftedProspect(r.prospect); });

  return { retireeCount: pre.retireeCount, retirees: pre.retirees, secretBadges: pre.secretBadges, draftResults: draftResults };
}

// leagueYear is the season being started. It reaches generateProspectClass so
// the class it builds knows which draft it belongs to — without it no prospect
// carries an entry year, nobody is ever eligible to be a father, and the whole
// family feature is silently dead eighteen seasons from now with nothing to
// show that it went wrong.
function generateNewSeason(rng, leagueYear) {
  // Backstop for teams that joined the league after initSeason ran — that's
  // the only place ensureAllTeamsHaveCoaches was ever called, so an expansion
  // team created mid-save otherwise had no coach and no strategy dials for the
  // rest of the game (no coach bonus in computeTeamRating, pace/3PR pinned at
  // 0, nothing for the Coaching view to render). Existing coaches are left
  // alone — ensureTeamCoach only fills gaps.
  _TRANSITION_DATA.coaches.ensureAllTeamsHaveCoaches(rng);

  _TRANSITION_DATA.teams.TEAMS.forEach(function (t) {
    t.record = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    // This year's picks were just used in the draft; next year's slots reset
    // to their original owner, ready to be traded again before the next draft.
    t.draftPicks = [
      { round: 1, originalTeamId: t.id, currentOwnerId: t.id },
      { round: 2, originalTeamId: t.id, currentOwnerId: t.id }
    ];
    // Five-man units are a THIS-season question. Carrying them over would mix
    // last year's closing lineup with a roster that has since been drafted,
    // traded and signed into something else — and the players in a stale key
    // may not even be on the team any more.
    t.lineupStats = undefined;
  });

  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.seasonStats = undefined;
    // Paired with the write in history.js's rollSeasonIntoCareerStats: the
    // season that was banked is gone, so the next one to accumulate here is
    // unbanked again and careerTotalsToDate must start adding it back in.
    p.seasonStatsRolled = false;
  });

  const games = _TRANSITION_DATA.schedule.generateSeasonGames(rng, _TRANSITION_DATA.teams.TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });

  // Generated now (not at draft time) so it exists to be scouted all season.
  // Sized off the actual league (two rounds, one pick per team) rather than a
  // hardcoded 60 — an expansion team made the draft 62 picks deep against a
  // 60-prospect pool, which used to run selectAIPick off the end of the array.
  // The +4 cushion covers prospects pulled out of the pool early.
  const nextDraftClass = _TRANSITION_DATA.prospects.generateProspectClass(
    rng, _TRANSITION_DATA.teams.TEAMS.length * 2 + 4, leagueYear);

  return { games: games, nextDraftClass: nextDraftClass };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rollRetirement: rollRetirement, hasRetirementPenalty: hasRetirementPenalty, decrementContracts: decrementContracts, runOffseasonPreDraft: runOffseasonPreDraft, runOffseasonThroughDraft: runOffseasonThroughDraft, generateNewSeason: generateNewSeason, RETIREMENT_TUNING: RETIREMENT_TUNING };
}
