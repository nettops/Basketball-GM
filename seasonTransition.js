var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js'), schedule: require('./schedule.js'), history: require('./history.js'), coaches: require('./coaches.js'), ratings: require('./ratings.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass },
      schedule: { generateSeasonGames: generateSeasonGames },
      history: { archiveRetiree: archiveRetiree },
      coaches: { ensureAllTeamsHaveCoaches: ensureAllTeamsHaveCoaches },
      ratings: { RATING_BANDS: RATING_BANDS }
    };

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

function rollRetirement(player, rng) {
  if (player.age < 34) return false;
  const baseChance = (player.age - 33) * 0.08;
  const overallPenalty = hasRetirementPenalty(player) ? 0.15 : 0;
  return rng() < Math.min(0.9, baseChance + overallPenalty);
}

function decrementContracts() {
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    if (!p.teamId) return;
    p.contract.yearsRemaining -= 1;
    if (p.contract.yearsRemaining <= 0) {
      p.teamId = null;
    }
  });
}

// Progression, retirement, contract expiration, and per-season status reset —
// everything the offseason needs BEFORE the draft. Split out from
// runOffseasonThroughDraft (which still calls this internally, so its own
// signature/behavior is unchanged) so the manual-draft path can run these
// steps once and then drive the draft itself via draft.js's session API,
// instead of duplicating this logic.
function runOffseasonPreDraft(rng, leagueYear) {
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

  const retirees = allPlayers.filter(function (p) { return rollRetirement(p, rng); });
  retirees.forEach(function (p) {
    _TRANSITION_DATA.history.archiveRetiree(p, leagueYear);
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  decrementContracts();

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
    secretBadges: secretBadges.filter(function (s) { return stillActive[s.playerId]; })
  };
}

function runOffseasonThroughDraft(bracket, rng, upcomingDraftClass, leagueYear, lotteryFormat) {
  const pre = runOffseasonPreDraft(rng, leagueYear);

  // The prospect pool is generated by the caller ahead of time (real 2026
  // class for the first draft, or the class generateNewSeason produced at
  // the start of this season for every draft after) so it's watchlistable
  // via scouting all season, not just at the moment the draft happens.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng, lotteryFormat);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, upcomingDraftClass);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: pre.retireeCount, secretBadges: pre.secretBadges, draftResults: draftResults };
}

function generateNewSeason(rng) {
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
  const nextDraftClass = _TRANSITION_DATA.prospects.generateProspectClass(rng, _TRANSITION_DATA.teams.TEAMS.length * 2 + 4);

  return { games: games, nextDraftClass: nextDraftClass };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rollRetirement: rollRetirement, hasRetirementPenalty: hasRetirementPenalty, decrementContracts: decrementContracts, runOffseasonPreDraft: runOffseasonPreDraft, runOffseasonThroughDraft: runOffseasonThroughDraft, generateNewSeason: generateNewSeason };
}
