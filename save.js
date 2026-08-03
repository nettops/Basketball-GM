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
      history: require('./history.js'),
      storage: _makeMemoryStorage()
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      league: { getPlayerById: getPlayerById },
      rng: { makeRng: makeRng },
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY },
      storage: localStorage
    };

const SAVE_SLOT_COUNT = 5;
const SAVE_FORMAT_VERSION = 1;
const SAVE_INDEX_KEY = 'nba-gm-save-index';

// Only mutable fields — id/name/conference/division/colors never change and
// don't need round-tripping through a save.
const TEAM_SAVE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'timeline', 'marketSize', 'record', 'draftPicks', 'allTimeWins', 'allTimeLosses', 'lastSeasonWins', 'finances', 'coach', 'strategy'];

function saveSlotKey(slotId) {
  return slotId === 'autosave' ? 'nba-gm-save-autosave' : 'nba-gm-save-' + slotId;
}

// Only used by applySavedState below, for teams it doesn't already have a
// live object for (i.e. an expansion team created in a prior session).
// Original teams' identity fields are still never round-tripped onto an
// existing object — teams.js's hardcoded values remain authoritative there,
// same as before this fix.
const TEAM_IDENTITY_FIELDS = ['id', 'name', 'conference', 'division', 'colors'];

function serializeGameState(gameState, name) {
  const teamsOut = {};
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const out = {};
    TEAM_IDENTITY_FIELDS.concat(TEAM_SAVE_FIELDS).forEach(function (key) { out[key] = t[key]; });
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
    rngState: gameState.rng ? gameState.rng.getState() : null,
    playMode: gameState.playMode,
    automation: gameState.automation,
    feed: gameState.feed || [],
    draftSession: gameState.draftSession || null,
    leagueHistory: _SAVE_DATA.history.LEAGUE_HISTORY
  };
}

function applySavedState(payload, gameState) {
  // TEAMS starts as the fixed 30-team array from teams.js on every fresh
  // page load. Iterate the SAVED teams (not the live array) so an expansion
  // team (Phase 7B) that doesn't have a matching object yet gets created,
  // not silently dropped — then restore mutable fields in place either way,
  // so any code already holding a team object reference (e.g. via
  // getTeamById) sees the restored values rather than a stale object.
  Object.keys(payload.teams).forEach(function (teamId) {
    const saved = payload.teams[teamId];
    let t = _SAVE_DATA.teams.TEAMS.find(function (team) { return team.id === teamId; });
    if (!t) {
      t = { id: saved.id, name: saved.name, conference: saved.conference, division: saved.division, colors: saved.colors };
      _SAVE_DATA.teams.TEAMS.push(t);
    }
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
  // Guards against save files written before settings.leagueYear existed —
  // league.js's simulateDate reads the season year off settings, not GameState.
  if (gameState.settings) gameState.settings.leagueYear = gameState.leagueYear;
  gameState.playMode = payload.playMode || 'gm';
  gameState.automation = payload.automation || { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false };
  gameState.feed = payload.feed || [];
  gameState.draftSession = payload.draftSession || null;

  gameState.rng = _SAVE_DATA.rng.makeRng(0);
  if (payload.rngState !== null && payload.rngState !== undefined) {
    gameState.rng.setState(payload.rngState);
  }

  gameState.lastDraftResults = payload.lastDraftResults.map(function (r) {
    return { teamId: r.teamId, prospect: _SAVE_DATA.league.getPlayerById(r.playerId), pickNumber: r.pickNumber, round: r.round };
  });

  // Older saves (pre-Phase 8) won't have this field — leave LEAGUE_HISTORY at
  // its default empty-arrays state rather than crashing on a missing key.
  // Matches this phase's explicit "no retroactive backfill" scope decision.
  if (payload.leagueHistory) {
    Object.keys(payload.leagueHistory).forEach(function (key) {
      _SAVE_DATA.history.LEAGUE_HISTORY[key] = payload.leagueHistory[key];
    });
  }

  return gameState;
}

function readSaveIndex() {
  try {
    const raw = _SAVE_DATA.storage.getItem(SAVE_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeSaveIndex(index) {
  _SAVE_DATA.storage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
}

function slotMetadata(slotId, payload) {
  const team = _SAVE_DATA.teams.TEAMS.find(function (t) { return t.id === payload.userTeamId; });
  return {
    slotId: slotId,
    name: payload.name,
    teamId: payload.userTeamId,
    teamName: team ? team.name : 'Unknown',
    leagueYear: payload.leagueYear,
    day: payload.season ? payload.season.currentDay : null,
    wins: team ? team.record.wins : 0,
    losses: team ? team.record.losses : 0,
    savedAt: payload.savedAt
  };
}

function saveToSlot(slotId, name, gameState) {
  const payload = serializeGameState(gameState, name);
  try {
    _SAVE_DATA.storage.setItem(saveSlotKey(slotId), JSON.stringify(payload));
  } catch (e) {
    return { success: false, reason: 'Save failed: storage is full. Delete an old save and try again.' };
  }
  const index = readSaveIndex().filter(function (entry) { return entry.slotId !== slotId; });
  index.push(slotMetadata(slotId, payload));
  writeSaveIndex(index);
  return { success: true };
}

function loadFromSlot(slotId, gameState) {
  const raw = _SAVE_DATA.storage.getItem(saveSlotKey(slotId));
  if (!raw) return { success: false, reason: 'No save found in that slot.' };
  const payload = JSON.parse(raw);
  applySavedState(payload, gameState);
  return { success: true };
}

function deleteSlot(slotId) {
  _SAVE_DATA.storage.removeItem(saveSlotKey(slotId));
  const index = readSaveIndex().filter(function (entry) { return entry.slotId !== slotId; });
  writeSaveIndex(index);
}

// Raw JSON string for a slot — what ui/saveLoad.js's Export button hands to
// Blob/URL.createObjectURL for a file download (same pattern as
// ui/careerLedger.js's CSV export).
function getRawSlotPayload(slotId) {
  return _SAVE_DATA.storage.getItem(saveSlotKey(slotId));
}

// Writes an already-serialized payload directly to a slot — shared by
// file import (ui/saveLoad.js's Import button) and league cloning below,
// neither of which starts from a live GameState the way saveToSlot does.
function importPayloadToSlot(slotId, payload) {
  if (!payload || typeof payload !== 'object' || !payload.players || !payload.teams) {
    return { success: false, reason: 'That file does not look like a valid save.' };
  }
  try {
    _SAVE_DATA.storage.setItem(saveSlotKey(slotId), JSON.stringify(payload));
  } catch (e) {
    return { success: false, reason: 'Import failed: storage is full. Delete an old save and try again.' };
  }
  const index = readSaveIndex().filter(function (entry) { return entry.slotId !== slotId; });
  index.push(slotMetadata(slotId, payload));
  writeSaveIndex(index);
  return { success: true };
}

// Duplicates a save slot's raw payload into another slot under a new name —
// doesn't touch the live GameState at all, so cloning the slot you're
// currently playing doesn't affect your current session.
function cloneSlot(sourceSlotId, targetSlotId, newName) {
  const raw = _SAVE_DATA.storage.getItem(saveSlotKey(sourceSlotId));
  if (!raw) return { success: false, reason: 'No save found in that slot.' };
  const payload = JSON.parse(raw);
  payload.name = newName || (payload.name + ' (Copy)');
  payload.savedAt = Date.now();
  return importPayloadToSlot(targetSlotId, payload);
}

const UNDO_STACK_LIMIT = 10;

// serializeGameState copies nested fields (team.record, etc.) by reference,
// not by value — the real save/load path naturally gets an independent copy
// because it round-trips the payload through localStorage as a JSON string,
// but an in-memory undo/redo snapshot has no such round-trip by default. A
// snapshot that still shares objects with the live GameState isn't a
// snapshot at all: mutating "live" state after the fact would silently
// mutate the "saved" one too. JSON round-tripping in memory here is what
// actually decouples them.
function snapshotGameState(gameState, name) {
  return JSON.parse(JSON.stringify(serializeGameState(gameState, name)));
}

// Called right before a user-initiated irreversible action (trade execution,
// contract signing — see ui/tradeCenter.js and ui/freeAgency.js's call
// sites). Deliberately NOT wired into automated/bulk-sim paths (AI-to-AI
// trades, multi-season fast-forward): those can fire hundreds of times in a
// single click, and a full serializeGameState snapshot per action would be
// both slow and memory-heavy at that volume.
function pushUndoSnapshot(gameState) {
  if (!gameState.undoStack) gameState.undoStack = [];
  if (!gameState.redoStack) gameState.redoStack = [];
  gameState.undoStack.push(snapshotGameState(gameState, 'undo-snapshot'));
  if (gameState.undoStack.length > UNDO_STACK_LIMIT) gameState.undoStack.shift();
  gameState.redoStack.length = 0; // a fresh action invalidates any pending redo
}

function canUndo(gameState) { return !!(gameState.undoStack && gameState.undoStack.length > 0); }
function canRedo(gameState) { return !!(gameState.redoStack && gameState.redoStack.length > 0); }

function performUndo(gameState) {
  if (!canUndo(gameState)) return { success: false, reason: 'Nothing to undo.' };
  if (!gameState.redoStack) gameState.redoStack = [];
  gameState.redoStack.push(snapshotGameState(gameState, 'redo-snapshot'));
  const snapshot = gameState.undoStack.pop();
  applySavedState(snapshot, gameState);
  return { success: true };
}

function performRedo(gameState) {
  if (!canRedo(gameState)) return { success: false, reason: 'Nothing to redo.' };
  if (!gameState.undoStack) gameState.undoStack = [];
  gameState.undoStack.push(snapshotGameState(gameState, 'undo-snapshot'));
  const snapshot = gameState.redoStack.pop();
  applySavedState(snapshot, gameState);
  return { success: true };
}

function listSaves() {
  const bySlot = {};
  readSaveIndex().forEach(function (entry) { bySlot[entry.slotId] = entry; });
  const slots = [];
  for (let i = 1; i <= SAVE_SLOT_COUNT; i++) {
    slots.push(bySlot[i] || { slotId: i, empty: true });
  }
  slots.push(bySlot.autosave || { slotId: 'autosave', empty: true });
  return slots;
}

// Fires once per user-triggered sim action / offseason transition (wired up
// in the UI tasks below) — never once per individual simulated day inside a
// bulk sim, which would mean ~170 synchronous multi-hundred-KB writes during
// a single "Sim to End of Season" click.
function autosave(gameState) {
  if (!gameState.season) return;
  saveToSlot('autosave', 'Autosave', gameState);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAVE_SLOT_COUNT: SAVE_SLOT_COUNT,
    SAVE_FORMAT_VERSION: SAVE_FORMAT_VERSION,
    TEAM_SAVE_FIELDS: TEAM_SAVE_FIELDS,
    saveSlotKey: saveSlotKey,
    serializeGameState: serializeGameState,
    applySavedState: applySavedState,
    saveToSlot: saveToSlot,
    loadFromSlot: loadFromSlot,
    deleteSlot: deleteSlot,
    listSaves: listSaves,
    autosave: autosave,
    getRawSlotPayload: getRawSlotPayload,
    importPayloadToSlot: importPayloadToSlot,
    cloneSlot: cloneSlot,
    pushUndoSnapshot: pushUndoSnapshot,
    canUndo: canUndo,
    canRedo: canRedo,
    performUndo: performUndo,
    performRedo: performRedo
  };
}
