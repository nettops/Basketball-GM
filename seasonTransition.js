var _TRANSITION_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), players: require('./players-2026.js'), progression: require('./progression.js'), draft: require('./draft.js'), prospects: require('./draftProspects.js'), schedule: require('./schedule.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      teams: { TEAMS: TEAMS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      progression: { progressPlayer: progressPlayer },
      draft: { buildDraftOrder: buildDraftOrder, runDraft: runDraft },
      prospects: { DRAFT_PROSPECTS_2026: DRAFT_PROSPECTS_2026, generateProspectClass: generateProspectClass },
      schedule: { generateSeasonGames: generateSeasonGames }
    };

// Retirement chance rises sharply after 33, further penalized for players whose
// production has fallen off. Full HOF/history tracking is Phase 8 — here a
// retired player just leaves the active player pool entirely.
function rollRetirement(player, rng) {
  if (player.age < 34) return false;
  const baseChance = (player.age - 33) * 0.08;
  const overallPenalty = player.overall < 65 ? 0.15 : 0;
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

function runOffseasonThroughDraft(bracket, rng, isFirstDraft) {
  // 1. Progression — mutate in place, then filter out retirees.
  const rosterPlayers = _TRANSITION_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId; });
  rosterPlayers.forEach(function (p) { _TRANSITION_DATA.progression.progressPlayer(p, rng); });

  const retirees = rosterPlayers.filter(function (p) { return rollRetirement(p, rng); });
  retirees.forEach(function (p) {
    const idx = _TRANSITION_DATA.players.PLAYERS_2026.indexOf(p);
    if (idx !== -1) _TRANSITION_DATA.players.PLAYERS_2026.splice(idx, 1);
  });

  // 2. Contracts.
  decrementContracts();

  // 3. Reset per-season status for everyone still in the league.
  _TRANSITION_DATA.players.PLAYERS_2026.forEach(function (p) {
    p.status.fatigue = 0;
    p.status.injury = null;
  });

  // 4. Draft.
  const draftOrder = _TRANSITION_DATA.draft.buildDraftOrder(bracket, rng);
  const prospectPool = isFirstDraft ? _TRANSITION_DATA.prospects.DRAFT_PROSPECTS_2026 : _TRANSITION_DATA.prospects.generateProspectClass(rng, 60);
  const draftResults = _TRANSITION_DATA.draft.runDraft(draftOrder, prospectPool);
  draftResults.forEach(function (r) { _TRANSITION_DATA.players.PLAYERS_2026.push(r.prospect); });

  return { retireeCount: retirees.length, draftResults: draftResults };
}

function generateNewSeason(rng) {
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
  });

  const games = _TRANSITION_DATA.schedule.generateSeasonGames(rng, _TRANSITION_DATA.teams.TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return games;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rollRetirement: rollRetirement, decrementContracts: decrementContracts, runOffseasonThroughDraft: runOffseasonThroughDraft, generateNewSeason: generateNewSeason };
}
