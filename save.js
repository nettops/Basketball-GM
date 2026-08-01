// This Node environment doesn't expose a global `localStorage` without the
// --localstorage-file flag, so the Node branch gets a tiny in-memory shim
// instead — same shape as the real Storage interface, swapped in only for
// testability. The browser branch uses the real thing.
function _makeMemoryStorage() {
  const store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
}

var _SAVE_DATA = (typeof require !== 'undefined')
  ? {
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      league: require('./league.js'),
      rng: require('./rng.js'),
      storage: _makeMemoryStorage()
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      league: { getPlayerById: getPlayerById },
      rng: { makeRng: makeRng },
      storage: localStorage
    };

const SAVE_SLOT_COUNT = 5;
const SAVE_FORMAT_VERSION = 1;
const SAVE_INDEX_KEY = 'nba-gm-save-index';

// Only mutable fields — id/name/conference/division/colors never change and
// don't need round-tripping through a save.
const TEAM_SAVE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'timeline', 'marketSize', 'record', 'draftPicks'];

function saveSlotKey(slotId) {
  return slotId === 'autosave' ? 'nba-gm-save-autosave' : 'nba-gm-save-' + slotId;
}

function serializeGameState(gameState, name) {
  const teamsOut = {};
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const out = {};
    TEAM_SAVE_FIELDS.forEach(function (key) { out[key] = t[key]; });
    teamsOut[t.id] = out;
  });

  // Per-game boxScore is intentionally dropped — season/career stat averages
  // are already accumulated separately per-player, and a full season's worth
  // of box scores would run several MB per slot (measured during design).
  const seasonOut = gameState.season ? {
    games: gameState.season.games.map(function (g) {
      return { id: g.id, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, day: g.day, played: g.played, homeScore: g.homeScore, awayScore: g.awayScore, isPlayoff: g.isPlayoff, seriesId: g.seriesId };
    }),
    currentDay: gameState.season.currentDay
  } : null;

  // Stored as an id reference, not the full prospect object — the object is
  // already fully present in `players` post-draft, so this avoids duplicating
  // up to 60 player records inside the save.
  const lastDraftResultsOut = (gameState.lastDraftResults || []).map(function (r) {
    return { teamId: r.teamId, playerId: r.prospect.id, pickNumber: r.pickNumber, round: r.round };
  });

  return {
    version: SAVE_FORMAT_VERSION,
    savedAt: Date.now(),
    name: name,
    players: _SAVE_DATA.players.PLAYERS_2026,
    teams: teamsOut,
    season: seasonOut,
    playoffBracket: gameState.playoffBracket,
    upcomingDraftClass: gameState.upcomingDraftClass || [],
    lastDraftResults: lastDraftResultsOut,
    scouting: gameState.scouting,
    userTeamId: gameState.userTeamId,
    currentView: gameState.currentView,
    leagueYear: gameState.leagueYear,
    offseasonStage: gameState.offseasonStage,
    settings: gameState.settings,
    rngState: gameState.rng ? gameState.rng.getState() : null
  };
}

function applySavedState(payload, gameState) {
  // TEAMS is a fixed 30-team array — restore mutable fields in place so any
  // code already holding a team object reference (e.g. via getTeamById)
  // sees the restored values rather than a stale object.
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const saved = payload.teams[t.id];
    if (!saved) return;
    TEAM_SAVE_FIELDS.forEach(function (key) { t[key] = saved[key]; });
  });

  // PLAYERS_2026 grows/shrinks over a save's lifetime (draft picks added,
  // retirements removed) — full replace rather than in-place field restore.
  _SAVE_DATA.players.PLAYERS_2026.length = 0;
  payload.players.forEach(function (p) { _SAVE_DATA.players.PLAYERS_2026.push(p); });

  gameState.season = payload.season ? {
    games: payload.season.games.map(function (g) {
      return { id: g.id, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, day: g.day, played: g.played, homeScore: g.homeScore, awayScore: g.awayScore, boxScore: null, isPlayoff: g.isPlayoff, seriesId: g.seriesId };
    }),
    currentDay: payload.season.currentDay
  } : null;
  gameState.playoffBracket = payload.playoffBracket;
  gameState.upcomingDraftClass = payload.upcomingDraftClass;
  gameState.scouting = payload.scouting;
  gameState.userTeamId = payload.userTeamId;
  gameState.currentView = payload.currentView || 'dashboard';
  gameState.leagueYear = payload.leagueYear;
  gameState.offseasonStage = payload.offseasonStage;
  gameState.settings = payload.settings;

  gameState.rng = _SAVE_DATA.rng.makeRng(0);
  if (payload.rngState !== null && payload.rngState !== undefined) {
    gameState.rng.setState(payload.rngState);
  }

  gameState.lastDraftResults = payload.lastDraftResults.map(function (r) {
    return { teamId: r.teamId, prospect: _SAVE_DATA.league.getPlayerById(r.playerId), pickNumber: r.pickNumber, round: r.round };
  });

  return gameState;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAVE_SLOT_COUNT: SAVE_SLOT_COUNT,
    SAVE_FORMAT_VERSION: SAVE_FORMAT_VERSION,
    TEAM_SAVE_FIELDS: TEAM_SAVE_FIELDS,
    saveSlotKey: saveSlotKey,
    serializeGameState: serializeGameState,
    applySavedState: applySavedState
  };
}
