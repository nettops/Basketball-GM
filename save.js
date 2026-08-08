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
      ratings: require('./ratings.js'),
      teams: require('./teams.js'),
      league: require('./league.js'),
      rng: require('./rng.js'),
      history: require('./history.js'),
      storage: _makeMemoryStorage()
    }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      ratings: { defineOverall: defineOverall },
      teams: { TEAMS: TEAMS },
      league: { getPlayerById: getPlayerById },
      rng: { makeRng: makeRng },
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY },
      storage: localStorage
    };

const SAVE_SLOT_COUNT = 5;
// v2 added the Phase 7-9 fields serializeGameState originally omitted (career
// mode, trade inbox, All-Star Weekend, season snapshots). v1 payloads still
// load — every v2-only field defaults in applySavedState below.
const SAVE_FORMAT_VERSION = 2;
const SAVE_INDEX_KEY = 'nba-gm-save-index';

// Only mutable fields — id/name/conference/division/colors never change and
// don't need round-tripping through a save.
const TEAM_SAVE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'timeline', 'marketSize', 'record', 'draftPicks', 'allTimeWins', 'allTimeLosses', 'lastSeasonWins', 'finances', 'coach', 'strategy', 'retiredNumbers'];

function saveSlotKey(slotId) {
  return slotId === 'autosave' ? 'nba-gm-save-autosave' : 'nba-gm-save-' + slotId;
}

// Only used by applySavedState below, for teams it doesn't already have a
// live object for (i.e. an expansion team created in a prior session).
// Original teams' identity fields are still never round-tripped onto an
// existing object — teams.js's hardcoded values remain authoritative there,
// same as before this fix.
const TEAM_IDENTITY_FIELDS = ['id', 'name', 'conference', 'division', 'colors'];

// The career-mode controllers are class instances (PlayerCareerController /
// NarrativeSystem / RandomEventSystem), so they can't round-trip through JSON.
// Their *state* is what matters — capture it here and rebuild the instances in
// applySavedState. Returns null in GM mode, and for the Node validation
// scripts, which never construct these.
function serializeCareerController(controller) {
  if (!controller) return null;
  return {
    controlledPlayerId: controller.controlledPlayerId,
    careerPhase: controller.careerPhase,
    careerEvents: controller.careerEvents || [],
    decisionHistory: controller.decisionHistory || [],
    randomEventHistory: controller.randomEventHistory || []
  };
}

// includeSnapshots is false for every in-memory snapshot path (undo/redo and
// pushSeasonSnapshot itself), for the same reason undoStack/redoStack are never
// serialized: a snapshot that embedded the snapshot list would nest its own
// history on every push and blow up exponentially. Only saveToSlot, which
// writes a terminal payload nobody snapshots again, passes true.
function serializeGameState(gameState, name, includeSnapshots) {
  const teamsOut = {};
  _SAVE_DATA.teams.TEAMS.forEach(function (t) {
    const out = {};
    TEAM_IDENTITY_FIELDS.concat(TEAM_SAVE_FIELDS).forEach(function (key) { out[key] = t[key]; });
    teamsOut[t.id] = out;
  });

  // Box scores for the WHOLE league would run several MB per slot (measured:
  // ~1230 games x ~26 player lines), so they were originally dropped wholesale.
  // But ui/schedule.js's expandable box score only ever shows the user's own
  // games, and dropping those made every played row in a reloaded save open to
  // nothing. Keeping just the user's games is ~150KB against a ~2.9MB save —
  // the feature works, and the size problem that motivated dropping them
  // doesn't come back. Everyone else's games still save as null and render the
  // "not stored" note in renderBoxScoreDetail.
  const BOX_SCORE_KEEP_LIMIT = 120; // a full 82-game season plus a deep playoff run
  const userGameIds = {};
  if (gameState.season && gameState.userTeamId) {
    gameState.season.games
      .filter(function (g) {
        return g.played && g.boxScore && (g.homeTeamId === gameState.userTeamId || g.awayTeamId === gameState.userTeamId);
      })
      .slice(-BOX_SCORE_KEEP_LIMIT)
      .forEach(function (g) { userGameIds[g.id] = true; });
  }

  const seasonOut = gameState.season ? {
    games: gameState.season.games.map(function (g) {
      const out = { id: g.id, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, day: g.day, played: g.played, homeScore: g.homeScore, awayScore: g.awayScore, isPlayoff: g.isPlayoff, seriesId: g.seriesId };
      if (userGameIds[g.id]) {
        out.boxScore = g.boxScore;
        // Same "user's own games only" pruning as boxScore above, and for the
        // same reason — a full season of possession-engine play-by-play
        // (~90 lines/team/game) would dwarf the save otherwise. Everyone
        // else's games save as null/absent, same as their box scores.
        out.playByPlay = g.playByPlay || null;
      }
      return out;
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
    leagueHistory: _SAVE_DATA.history.LEAGUE_HISTORY,

    // v2 fields. Everything below was live GameState that the original
    // payload never captured, so a reload silently dropped it: a career-mode
    // game reverted to GM mode, the trade inbox emptied, and All-Star results
    // and commissioner rewind snapshots vanished.
    tradeOffers: gameState.tradeOffers || [],
    allStarWeekend: gameState.allStarWeekend || null,
    automationBeforeSpectator: gameState.automationBeforeSpectator || null,
    lastTradeGenWeek: gameState.lastTradeGenWeek,
    lastAIToAITradeWeek: gameState.lastAIToAITradeWeek,
    gameMode: gameState.gameMode || null,
    controlledPlayerId: gameState.controlledPlayerId || null,
    playerLegacy: gameState.playerLegacy || null,
    pendingRandomEvent: gameState.pendingRandomEvent || null,
    careerController: serializeCareerController(gameState.playerCareerController),
    narrativeRelationships: gameState.narrativeSystem ? gameState.narrativeSystem.npcRelationships : null,
    seasonSnapshots: includeSnapshots ? (gameState.seasonSnapshots || []) : [],
    godMode: gameState.godMode || { enabled: false, autoWinEnabled: false }
  };
}

// Rebuilds the career-mode class instances from the flat state serializeCareerController
// captured. Guarded on `typeof` because save.js also runs standalone under Node in
// scripts/validate-save.js, where the career-mode files were never loaded.
function rehydrateCareerMode(payload, gameState) {
  // Cleared unconditionally first: loading a GM save over a live career-mode
  // session (or vice versa) must not leave the previous session's controllers
  // attached to the new one.
  gameState.playerCareerController = null;
  gameState.narrativeSystem = null;
  gameState.randomEventSystem = null;
  if (payload.gameMode !== 'playerCareer') return;

  if (typeof PlayerCareerController !== 'undefined') {
    const controller = new PlayerCareerController(gameState);
    const saved = payload.careerController || {};
    controller.controlledPlayerId = saved.controlledPlayerId !== undefined ? saved.controlledPlayerId : payload.controlledPlayerId;
    controller.careerPhase = saved.careerPhase || null;
    controller.careerEvents = saved.careerEvents || [];
    controller.decisionHistory = saved.decisionHistory || [];
    controller.randomEventHistory = saved.randomEventHistory || [];
    gameState.playerCareerController = controller;
  }
  if (typeof NarrativeSystem !== 'undefined') {
    gameState.narrativeSystem = new NarrativeSystem(gameState);
    gameState.narrativeSystem.npcRelationships = payload.narrativeRelationships || {};
  }
  if (typeof RandomEventSystem !== 'undefined') {
    gameState.randomEventSystem = new RandomEventSystem(gameState);
  }
}

// Shape check run BEFORE applySavedState touches anything. This matters because
// applySavedState empties PLAYERS_2026 partway through — a payload that throws
// after that point leaves the app with no players and no way back short of a
// page refresh. importPayloadToSlot's own check is deliberately looser (it
// guards the write side), so the read side needs its own.
function validateSavePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'That save file is not readable.';
  if (typeof payload.version === 'number' && payload.version > SAVE_FORMAT_VERSION) {
    return 'That save was made by a newer version of the game (format ' + payload.version + ').';
  }
  if (!Array.isArray(payload.players) || payload.players.length === 0) return 'That save has no player data.';
  if (!payload.teams || typeof payload.teams !== 'object') return 'That save has no team data.';
  if (!payload.settings || typeof payload.settings !== 'object') return 'That save has no settings data.';
  return null;
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
  // `overall` is a derived getter (ratings.js), and it is non-enumerable so it
  // is never serialised. That means a player coming back off a save has NO
  // overall at all until the getter is reinstalled here — every roster screen,
  // every trade valuation and the rotation weights would read undefined.
  _SAVE_DATA.players.PLAYERS_2026.length = 0;
  payload.players.forEach(function (p) {
    _SAVE_DATA.players.PLAYERS_2026.push(_SAVE_DATA.ratings.defineOverall(p));
  });

  gameState.season = payload.season ? {
    games: payload.season.games.map(function (g) {
      // boxScore/playByPlay are present only for the user's own games (see
      // serializeGameState); null for everyone else's, which
      // renderBoxScoreDetail renders as a note rather than treating as data.
      return { id: g.id, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, day: g.day, played: g.played, homeScore: g.homeScore, awayScore: g.awayScore, boxScore: g.boxScore || null, playByPlay: g.playByPlay || null, isPlayoff: g.isPlayoff, seriesId: g.seriesId };
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
  // The `|| 2026` matters for saves taken before initSeason started setting
  // leagueYear explicitly: without it, `undefined` propagates into settings and
  // every leagueYear stamped on feed/history entries for the rest of the
  // session falls back independently.
  if (!gameState.leagueYear) gameState.leagueYear = 2026;
  if (gameState.settings) gameState.settings.leagueYear = gameState.leagueYear;
  gameState.playMode = payload.playMode || 'gm';
  // Deliberately all-off, and deliberately NOT script.js's defaultAutomation().
  // This branch only runs for a payload predating the automation field, i.e. a
  // save played with nothing automated — so all-off reproduces how that game
  // actually ran. A new game's defaults are a different question, answered in
  // script.js.
  gameState.automation = payload.automation || { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false };
  gameState.feed = payload.feed || [];
  gameState.draftSession = payload.draftSession || null;

  gameState.rng = _SAVE_DATA.rng.makeRng(0);
  if (payload.rngState !== null && payload.rngState !== undefined) {
    gameState.rng.setState(payload.rngState);
  }

  // Defaulted and filtered: a v1 save predating this field has no array at all,
  // and a player referenced by a stored pick can since have been deleted
  // (commissioner) — either way ui/draft.js's renderDraftResults reads
  // r.prospect.name and would throw on the gap.
  gameState.lastDraftResults = (payload.lastDraftResults || [])
    .map(function (r) {
      return { teamId: r.teamId, prospect: _SAVE_DATA.league.getPlayerById(r.playerId), pickNumber: r.pickNumber, round: r.round };
    })
    .filter(function (r) { return !!r.prospect; });

  // v2 fields — all defaulted so a v1 payload restores to the same state it
  // would have produced before these were tracked.
  gameState.tradeOffers = payload.tradeOffers || [];
  gameState.allStarWeekend = payload.allStarWeekend || null;
  gameState.automationBeforeSpectator = payload.automationBeforeSpectator || null;
  gameState.lastTradeGenWeek = payload.lastTradeGenWeek;
  gameState.lastAIToAITradeWeek = payload.lastAIToAITradeWeek;
  gameState.gameMode = payload.gameMode || null;
  gameState.controlledPlayerId = payload.controlledPlayerId || null;
  gameState.playerLegacy = payload.playerLegacy || null;
  gameState.pendingRandomEvent = payload.pendingRandomEvent || null;
  gameState.godMode = payload.godMode || { enabled: false, autoWinEnabled: false };
  if (payload.seasonSnapshots) gameState.seasonSnapshots = payload.seasonSnapshots;
  rehydrateCareerMode(payload, gameState);

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

// Reads the team off the PAYLOAD, not the live TEAMS array. They're the same
// object for saveToSlot, but importPayloadToSlot and cloneSlot write a payload
// from another league entirely — sourcing the record from live TEAMS made an
// imported slot advertise the current session's name and W/L.
function slotMetadata(slotId, payload) {
  const savedTeam = payload.teams ? payload.teams[payload.userTeamId] : null;
  const record = (savedTeam && savedTeam.record) || { wins: 0, losses: 0 };
  return {
    slotId: slotId,
    name: payload.name,
    teamId: payload.userTeamId,
    teamName: savedTeam ? savedTeam.name : 'Unknown',
    leagueYear: payload.leagueYear,
    day: payload.season ? payload.season.currentDay : null,
    wins: record.wins || 0,
    losses: record.losses || 0,
    savedAt: payload.savedAt
  };
}

function saveToSlot(slotId, name, gameState) {
  const payload = serializeGameState(gameState, name, true);
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
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    return { success: false, reason: 'That save is corrupted and could not be read.' };
  }
  const invalid = validateSavePayload(payload);
  if (invalid) return { success: false, reason: invalid };
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
  const invalid = validateSavePayload(payload);
  if (invalid) return { success: false, reason: invalid };
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
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    return { success: false, reason: 'That save is corrupted and could not be read.' };
  }
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

const SEASON_SNAPSHOT_LIMIT = 10;

// Called once per season boundary — from seasonRollover.js, right before
// finalizeSeasonHistory runs — so "rewind to season N" restores the league
// exactly as that season's
// regular-season-plus-playoffs left it. Reuses the same snapshotGameState
// deep-clone save/load format Phase F's undo/redo already established —
// this is a commissioner-only convenience layered on top of it, not a
// separate persistence mechanism.
function pushSeasonSnapshot(gameState) {
  if (!gameState.seasonSnapshots) gameState.seasonSnapshots = [];
  const leagueYear = gameState.leagueYear || 2026;
  // Replace any existing snapshot for the same year (e.g. a re-simmed season)
  // rather than accumulating duplicates.
  gameState.seasonSnapshots = gameState.seasonSnapshots.filter(function (s) { return s.leagueYear !== leagueYear; });
  gameState.seasonSnapshots.push({ leagueYear: leagueYear, payload: snapshotGameState(gameState, 'season-' + leagueYear) });
  if (gameState.seasonSnapshots.length > SEASON_SNAPSHOT_LIMIT) gameState.seasonSnapshots.shift();
}

function listSeasonSnapshots(gameState) {
  return (gameState.seasonSnapshots || []).map(function (s) { return s.leagueYear; }).sort(function (a, b) { return a - b; });
}

function rewindToSeason(gameState, leagueYear) {
  const entry = (gameState.seasonSnapshots || []).find(function (s) { return s.leagueYear === leagueYear; });
  if (!entry) return { success: false, reason: 'No snapshot found for that season.' };
  applySavedState(entry.payload, gameState);
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
    validateSavePayload: validateSavePayload,
    serializeCareerController: serializeCareerController,
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
    performRedo: performRedo,
    pushSeasonSnapshot: pushSeasonSnapshot,
    listSeasonSnapshots: listSeasonSnapshots,
    rewindToSeason: rewindToSeason
  };
}
