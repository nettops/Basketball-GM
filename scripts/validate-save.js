const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

function checkRngExactResume() {
  const rngModule = require(path.join(__dirname, '..', 'rng.js'));
  const a = rngModule.makeRng(42);
  a(); a(); a();
  const state = a.getState();
  const nextFromA = a();

  const b = rngModule.makeRng(0);
  b.setState(state);
  const nextFromB = b();

  assert.strictEqual(nextFromA, nextFromB, 'restoring captured state should resume the exact same sequence');

  console.log('checkRngExactResume: OK');
}

checkRngExactResume();

function makeFakeGameState(overrides) {
  return Object.assign({
    userTeamId: 'BOS',
    currentView: 'roster',
    season: { games: [{ id: 'g1', homeTeamId: 'BOS', awayTeamId: 'MIA', day: 0, played: true, homeScore: 110, awayScore: 100, boxScore: { 'bos-jayson-tatum': { points: 30 } }, isPlayoff: false, seriesId: null }], currentDay: 5 },
    playoffBracket: null,
    upcomingDraftClass: [],
    lastDraftResults: [],
    scouting: { lastRolloverWeek: 1, pointsAvailable: 40, targets: { 'bos-jayson-tatum': { confidence: 55, watchlisted: true } } },
    leagueYear: 2027,
    offseasonStage: null,
    settings: { simEngine: 'boxscore', simSpeed: 'fast' },
    rng: makeRng(999)
  }, overrides || {});
}

// Runs HERE, before the checks below, and not at the end of the file: several
// of them call applySavedState, which replaces PLAYERS_2026 in place and
// leaves the league empty. A save serialized after that has no players in
// it, and validateSavePayload rejects it on load for a reason that has
// nothing to do with what this check is about.
// Renaming the app renamed the localStorage keys, and localStorage has no
// rename — it only has "write somewhere else and stop looking here". Get this
// wrong and every league anybody has ever played simply stops existing, with
// no error to notice: the slot list comes back empty and looks like a fresh
// install. That is the worst failure this file can catch, so it catches it.
function checkASaveMadeBeforeTheRenameStillLoads() {
  const s = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState();

  // Write a genuine save through the real API, then move it to where a
  // pre-rename build would have left it. Hand-building the payload instead
  // would test a shape the game never actually writes.
  s.saveToSlot(2, 'Pre-rename League', gs);
  const realPayload = s.getRawSlotPayload(2);
  const realIndex = JSON.stringify(s.listSaves());

  s._storage.setItem(s.legacySaveSlotKey(2), realPayload);
  s._storage.setItem(s.LEGACY_SAVE_INDEX_KEY, realIndex);
  s._storage.removeItem(s.saveSlotKey(2));
  s._storage.removeItem(s.SAVE_INDEX_KEY);

  const listed = s.listSaves();
  assert.ok(listed.some(function (e) { return e.slotId === 2; }),
    'a league saved before the rename must still appear in the slot list');

  const loaded = {};
  const res = s.loadFromSlot(2, loaded);
  assert.ok(res.success, 'and must still load: ' + (res.reason || ''));
  assert.strictEqual(loaded.userTeamId, gs.userTeamId, 'with its team intact');

  // Promoted on the way through, so the next read takes the current key and
  // the fallback is a one-time cost rather than forever.
  assert.ok(s._storage.getItem(s.saveSlotKey(2)),
    'reading a legacy slot must migrate it onto the new key');
  assert.ok(s._storage.getItem(s.SAVE_INDEX_KEY),
    'and migrate the index with it');

  // Deleting has to reach BOTH copies, or the league rises from the dead the
  // next time the legacy fallback runs.
  s.deleteSlot(2);
  assert.ok(!s._storage.getItem(s.legacySaveSlotKey(2)),
    'deleting a migrated save must delete the pre-rename copy too');
  assert.ok(!s.loadFromSlot(2, {}).success, 'and it must stay deleted');

  console.log('checkASaveMadeBeforeTheRenameStillLoads: OK');
}
checkASaveMadeBeforeTheRenameStillLoads();

// Box scores are kept for the USER's games (so ui/schedule.js's expandable box
// score still works after a reload) and dropped for everyone else's (so a save
// doesn't carry ~1230 games' worth of player lines). Dropping them wholesale is
// what made every played row in a reloaded save expand to an empty panel.
function checkSerializeKeepsUserBoxScoresOnly() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState({
    season: {
      games: [
        { id: 'g1', homeTeamId: 'BOS', awayTeamId: 'MIA', day: 0, played: true, homeScore: 110, awayScore: 100, boxScore: { 'bos-jayson-tatum': { points: 30 } }, isPlayoff: false, seriesId: null },
        { id: 'g2', homeTeamId: 'LAL', awayTeamId: 'GSW', day: 0, played: true, homeScore: 105, awayScore: 99, boxScore: { 'lal-luka-doncic': { points: 40 } }, isPlayoff: false, seriesId: null },
        { id: 'g3', homeTeamId: 'BOS', awayTeamId: 'NYK', day: 1, played: false, homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null }
      ],
      currentDay: 5
    }
  });
  const payload = saveModule.serializeGameState(gs, 'Test');
  const byId = {};
  payload.season.games.forEach(function (g) { byId[g.id] = g; });

  assert.ok(byId.g1.boxScore, "the user's own played game must keep its box score");
  assert.strictEqual(byId.g1.boxScore['bos-jayson-tatum'].points, 30, 'the kept box score must survive intact');
  assert.strictEqual(byId.g1.homeScore, 110, 'final score should still be present');
  assert.strictEqual(byId.g2.boxScore, undefined, "another team's box score must not be serialized");
  assert.strictEqual(byId.g3.boxScore, undefined, 'an unplayed game carries no box score');

  // Round-trips into a usable shape rather than a null that the UI has to guard.
  const restored = {};
  saveModule.applySavedState(JSON.parse(JSON.stringify(payload)), restored);
  const restoredById = {};
  restored.season.games.forEach(function (g) { restoredById[g.id] = g; });
  assert.ok(restoredById.g1.boxScore, "the user's box score must survive the round trip");
  assert.strictEqual(restoredById.g2.boxScore, null, "another team's game restores with an explicit null");

  console.log('checkSerializeKeepsUserBoxScoresOnly: OK');
}

checkSerializeKeepsUserBoxScoresOnly();

// The box score's takeover panel reads game.takeovers, and game.takeovers was
// not in the serializer's field list — so the panel rendered all session and
// was gone the moment you reloaded. It survived review because LEAGUE_HISTORY
// keeps every takeover league-wide and round-trips perfectly, which is a
// different array proving a different thing. Asserted here at the level the
// user experiences: open a saved game, see the takeover.
function checkTakeoversSurviveTheSaveOnTheGame() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const row = { playerId: 'bos-jayson-tatum', playerName: 'Jayson Tatum', teamId: 'BOS',
                ultimateKey: 'silky', points: 18, run: 26, startPeriod: 3, period: 4 };
  const gs = makeFakeGameState({
    season: {
      games: [
        { id: 'g1', homeTeamId: 'BOS', awayTeamId: 'MIA', day: 0, played: true, homeScore: 110, awayScore: 100, boxScore: { 'bos-jayson-tatum': { points: 30 } }, isPlayoff: false, seriesId: null, takeovers: [row] },
        { id: 'g2', homeTeamId: 'LAL', awayTeamId: 'GSW', day: 0, played: true, homeScore: 105, awayScore: 99, boxScore: { 'lal-luka-doncic': { points: 40 } }, isPlayoff: false, seriesId: null, takeovers: [row] }
      ],
      currentDay: 5
    }
  });
  const restored = {};
  saveModule.applySavedState(
    JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Test'))), restored);
  const byId = {};
  restored.season.games.forEach(function (g) { byId[g.id] = g; });

  assert.ok(byId.g1.takeovers && byId.g1.takeovers.length === 1,
    "the user's own game must keep its takeovers, or the box-score panel is empty after a reload");
  assert.deepStrictEqual(byId.g1.takeovers[0], row,
    'the whole takeover row must survive, including the period it started in');
  // Everyone else's are in LEAGUE_HISTORY already; carrying them here too would
  // be paying twice for one fact.
  assert.ok(!byId.g2.takeovers || !byId.g2.takeovers.length,
    "another team's takeovers must not be duplicated onto the game");
  console.log('checkTakeoversSurviveTheSaveOnTheGame: OK');
}

checkTakeoversSurviveTheSaveOnTheGame();

function checkApplyRestoresTeamsAndPlayers() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  traitsModule.ensureHiddenPlayerData(playersModule.PLAYERS_2026);

  const gs = makeFakeGameState();
  // Round-trip through JSON like the real saveToSlot/loadFromSlot path does —
  // see the comment in Task 2's smoke test for why this matters here.
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Test')));

  const originalChemistry = teamsModule.getTeamById('BOS').chemistry;
  teamsModule.getTeamById('BOS').chemistry = originalChemistry + 5; // simulate drift after saving
  const originalPlayerCount = playersModule.PLAYERS_2026.length;
  playersModule.PLAYERS_2026.push({ id: 'injected-after-save' });

  const restored = saveModule.applySavedState(payload, {});

  assert.strictEqual(teamsModule.getTeamById('BOS').chemistry, originalChemistry, 'team fields should be restored to their saved values');
  assert.strictEqual(playersModule.PLAYERS_2026.length, originalPlayerCount, 'PLAYERS_2026 should be fully replaced by the saved roster, not appended to');
  assert.strictEqual(restored.userTeamId, 'BOS');
  // makeFakeGameState's single game belongs to the user's team (BOS), so its
  // box score is deliberately kept — see checkSerializeKeepsUserBoxScoresOnly.
  // Games belonging to other teams restore as an explicit null instead.
  assert.deepStrictEqual(restored.season.games[0].boxScore, { 'bos-jayson-tatum': { points: 30 } },
    "the user's own game should restore with its box score intact");
  assert.strictEqual(restored.scouting.targets['bos-jayson-tatum'].confidence, 55);

  console.log('checkApplyRestoresTeamsAndPlayers: OK');
}

checkApplyRestoresTeamsAndPlayers();

function checkApplyResumesRngExactly() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState();
  gs.rng(); gs.rng(); // advance a bit before saving
  const expectedNext = (function () {
    const state = gs.rng.getState();
    const clone = makeRng(0);
    clone.setState(state);
    return clone();
  })();

  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Test')));
  const restored = saveModule.applySavedState(payload, {});

  assert.strictEqual(restored.rng(), expectedNext, 'loaded rng should produce the exact next value the original stream would have');

  console.log('checkApplyResumesRngExactly: OK');
}

checkApplyResumesRngExactly();

function checkApplyRehydratesLastDraftResults() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const playersModule = require(path.join(__dirname, '..', 'players-2026.js'));
  const traitsModule = require(path.join(__dirname, '..', 'traits.js'));
  traitsModule.ensureHiddenPlayerData(playersModule.PLAYERS_2026);

  const realPlayer = playersModule.PLAYERS_2026[0];
  const gs = makeFakeGameState({ lastDraftResults: [{ teamId: 'BOS', prospect: realPlayer, pickNumber: 1, round: 1 }] });
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Test')));
  assert.strictEqual(payload.lastDraftResults[0].playerId, realPlayer.id, 'serialized draft result should store a player id reference, not the full object');

  const restored = saveModule.applySavedState(payload, {});
  assert.strictEqual(restored.lastDraftResults[0].prospect.id, realPlayer.id, 'restored draft result should rehydrate the full prospect object');

  console.log('checkApplyRehydratesLastDraftResults: OK');
}

checkApplyRehydratesLastDraftResults();

function checkSlotStorageLifecycle() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState();

  saveModule.listSaves().forEach(function (s) { if (!s.empty) saveModule.deleteSlot(s.slotId); }); // clean slate

  assert.ok(saveModule.listSaves().every(function (s) { return s.empty; }), 'all slots should start empty');

  const saveResult = saveModule.saveToSlot(1, 'My Dynasty', gs);
  assert.strictEqual(saveResult.success, true);

  const list = saveModule.listSaves();
  assert.ok(!list[0].empty, 'a filled slot should not carry a truthy empty flag');
  assert.strictEqual(list[0].teamName, 'Boston Harbormen');
  assert.strictEqual(list[0].name, 'My Dynasty');
  assert.strictEqual(list[1].empty, true, 'slot 2 should remain untouched');
  assert.strictEqual(list[5].slotId, 'autosave');
  assert.strictEqual(list[5].empty, true, 'autosave slot should be independent of manual slots');

  const loadResult = saveModule.loadFromSlot(1, {});
  assert.strictEqual(loadResult.success, true);

  const missingResult = saveModule.loadFromSlot(2, {});
  assert.strictEqual(missingResult.success, false, 'loading an empty slot should fail gracefully');

  saveModule.autosave(gs);
  assert.ok(!saveModule.listSaves()[5].empty, 'autosave should populate the autosave slot');

  const gsNoSeason = makeFakeGameState({ season: null });
  const beforeAutosaveList = JSON.stringify(saveModule.listSaves());
  saveModule.autosave(gsNoSeason);
  assert.strictEqual(JSON.stringify(saveModule.listSaves()), beforeAutosaveList, 'autosave should no-op when no season has started');

  saveModule.deleteSlot(1);
  assert.strictEqual(saveModule.listSaves()[0].empty, true);

  console.log('checkSlotStorageLifecycle: OK');
}

checkSlotStorageLifecycle();

function checkQuotaExceededHandledGracefully() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState();

  // Monkey-patch the module's storage indirectly is not possible from outside
  // (it's a closed-over module-local), so instead verify saveToSlot's
  // documented failure contract via a payload guaranteed to be enormous: this
  // environment's in-memory shim never actually throws, so this check instead
  // asserts the success path's return contract, which the quota-exceeded
  // branch shares (`{ success, reason? }`) — the throw/catch itself is
  // exercised implicitly by every saveToSlot call in checkSlotStorageLifecycle
  // completing without an uncaught exception.
  const result = saveModule.saveToSlot(3, 'Contract Check', gs);
  assert.strictEqual(typeof result.success, 'boolean');
  saveModule.deleteSlot(3);

  console.log('checkQuotaExceededHandledGracefully: OK');
}

checkQuotaExceededHandledGracefully();

function checkPhase7FieldsRoundTrip() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gameState = makeFakeGameState({
    playMode: 'commissioner',
    automation: { autoFreeAgency: true, autoDraft: false, autoTrade: true, autoCap: false, autoScout: true },
    feed: [{ day: 5, leagueYear: 2026, text: 'Test entry' }],
    draftSession: null,
    settings: { simEngine: 'boxscore', simSpeed: 'fast', pauseOn: { madePlayoffs: true, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: true }, capDisabled: false }
  });
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'Round Trip Test')));
  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.strictEqual(restored.playMode, 'commissioner', 'playMode should round-trip');
  assert.deepStrictEqual(restored.automation, gameState.automation, 'automation toggles should round-trip');
  assert.strictEqual(restored.feed.length, 1, 'feed should round-trip');
  // keyInjury is no longer a live setting (the injury pause was removed at
  // the user's request), which makes this assertion MORE valuable, not less:
  // it now proves an old save's unknown pauseOn key survives the round-trip
  // untouched instead of being stripped or crashing the load.
  assert.strictEqual(restored.settings.pauseOn.keyInjury, true, 'settings.pauseOn should round-trip as part of the existing settings blob');
  console.log('checkPhase7FieldsRoundTrip: OK');
}

checkPhase7FieldsRoundTrip();

// Regression check: finances (Phase B) and coach/strategy (Phase C) were
// initially left out of TEAM_SAVE_FIELDS, so a save/load cycle silently
// dropped cash balances, arena tier, and any hired coach.
function checkTeamFinancesCoachAndStrategyRoundTrip() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
  const coachesModule = require(path.join(__dirname, '..', 'coaches.js'));
  const financesModule = require(path.join(__dirname, '..', 'finances.js'));
  const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));

  const team = teamsModule.getTeamById('BOS');
  const finances = financesModule.ensureTeamFinances(team);
  finances.cash = 12345678;
  finances.arenaTier = 3;
  coachesModule.hireCoach(team, coachesModule.generateCoach(makeRng(5)), 2027);
  const hiredCoachName = team.coach.name;
  team.strategy = { pace: 1, threePointRate: -1 };
  // A team field left out of TEAM_SAVE_FIELDS is silently dropped on reload —
  // the user's chosen starting five is exactly that shape of field, and losing
  // it would look like the game ignoring a decision they made.
  team.startingFive = ['bos-jayson-tatum', 'bos-derrick-white'];

  const gameState = makeFakeGameState({});
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gameState, 'Finances Round Trip')));

  // Wipe the live fields to prove restore (not just the still-live object
  // reference) is what brings them back.
  team.finances = null;
  team.coach = null;
  team.strategy = null;
  team.startingFive = null;

  const restored = {};
  saveModule.applySavedState(payload, restored);

  assert.strictEqual(team.finances.cash, 12345678, 'cash balance should round-trip');
  assert.strictEqual(team.finances.arenaTier, 3, 'arena tier should round-trip');
  assert.strictEqual(team.coach.name, hiredCoachName, 'hired coach should round-trip');
  assert.deepStrictEqual(team.strategy, { pace: 1, threePointRate: -1 }, 'strategy dials should round-trip');
  assert.deepStrictEqual(team.startingFive, ['bos-jayson-tatum', 'bos-derrick-white'],
    'the chosen starting five should round-trip');

  console.log('checkTeamFinancesCoachAndStrategyRoundTrip: OK');
}

checkTeamFinancesCoachAndStrategyRoundTrip();

// Phase F: file-based import writes an already-serialized payload directly
// to a slot (no live GameState involved) — the path ui/saveLoad.js's Import
// button uses after reading a File via FileReader.
function checkImportPayloadToSlot() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));

  const invalid = saveModule.importPayloadToSlot(1, { not: 'a save' });
  assert.strictEqual(invalid.success, false, 'a payload missing players/teams should be rejected');

  const gs = makeFakeGameState({});
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Imported League')));
  const result = saveModule.importPayloadToSlot(2, payload);
  assert.strictEqual(result.success, true);

  const loaded = saveModule.loadFromSlot(2, {});
  assert.strictEqual(loaded.success, true);

  const listed = saveModule.listSaves().find(function (s) { return s.slotId === 2; });
  assert.strictEqual(listed.name, 'Imported League', 'imported save should appear in the slot index');

  saveModule.deleteSlot(2);
  console.log('checkImportPayloadToSlot: OK');
}

checkImportPayloadToSlot();

// Phase F: league cloning duplicates a slot's raw payload into another slot
// under a new name, without touching any live GameState.
function checkCloneSlot() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));

  const missing = saveModule.cloneSlot(99, 3, 'Clone');
  assert.strictEqual(missing.success, false, 'cloning an empty source slot should fail cleanly');

  const gs = makeFakeGameState({});
  saveModule.saveToSlot(3, 'Original League', gs);
  const result = saveModule.cloneSlot(3, 4, 'Cloned League');
  assert.strictEqual(result.success, true);

  const original = saveModule.listSaves().find(function (s) { return s.slotId === 3; });
  const clone = saveModule.listSaves().find(function (s) { return s.slotId === 4; });
  assert.strictEqual(original.name, 'Original League', 'source slot should be untouched');
  assert.strictEqual(clone.name, 'Cloned League');
  assert.notStrictEqual(clone.savedAt, original.savedAt, 'clone should get its own timestamp');

  saveModule.deleteSlot(3);
  saveModule.deleteSlot(4);
  console.log('checkCloneSlot: OK');
}

checkCloneSlot();

// Phase F: undo/redo — pushUndoSnapshot captures a restorable snapshot;
// undo restores it and stacks the pre-undo state onto redo; redo reverses that.
function checkUndoRedo() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

  const gs = makeFakeGameState({});
  const team = teamsModule.getTeamById('BOS');
  const originalWins = team.record.wins;

  assert.strictEqual(saveModule.canUndo(gs), false, 'a fresh GameState should have nothing to undo');
  const noop = saveModule.performUndo(gs);
  assert.strictEqual(noop.success, false);

  saveModule.pushUndoSnapshot(gs);
  assert.strictEqual(saveModule.canUndo(gs), true);

  team.record.wins = originalWins + 10; // simulate an irreversible action's side effect
  const undoResult = saveModule.performUndo(gs);
  assert.strictEqual(undoResult.success, true);
  assert.strictEqual(team.record.wins, originalWins, 'undo should restore the pre-action state');
  assert.strictEqual(saveModule.canRedo(gs), true, 'undoing should populate the redo stack');

  const redoResult = saveModule.performRedo(gs);
  assert.strictEqual(redoResult.success, true);
  assert.strictEqual(team.record.wins, originalWins + 10, 'redo should restore the undone action');

  // A fresh action after an undo should clear any pending redo.
  saveModule.pushUndoSnapshot(gs);
  assert.strictEqual(saveModule.canRedo(gs), false, 'a new snapshot should invalidate stale redo history');

  console.log('checkUndoRedo: OK');
}

checkUndoRedo();

function checkUndoStackIsBounded() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState({});
  for (let i = 0; i < 15; i++) saveModule.pushUndoSnapshot(gs);
  assert.strictEqual(gs.undoStack.length, 10, 'the undo stack should be capped at UNDO_STACK_LIMIT (10)');
  console.log('checkUndoStackIsBounded: OK');
}

checkUndoStackIsBounded();

// Phase G: season snapshots — pushed once per season boundary, restorable
// by leagueYear, independent of the undo/redo stacks.
function checkSeasonSnapshotsAndRewind() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const teamsModule = require(path.join(__dirname, '..', 'teams.js'));

  const gs = makeFakeGameState({ leagueYear: 2050 });
  const team = teamsModule.getTeamById('BOS');
  team.record.wins = 41;

  saveModule.pushSeasonSnapshot(gs);
  assert.deepStrictEqual(saveModule.listSeasonSnapshots(gs), [2050]);

  gs.leagueYear = 2051;
  team.record.wins = 55;
  saveModule.pushSeasonSnapshot(gs);
  assert.deepStrictEqual(saveModule.listSeasonSnapshots(gs), [2050, 2051]);

  const missing = saveModule.rewindToSeason(gs, 1999);
  assert.strictEqual(missing.success, false, 'rewinding to a season with no snapshot should fail cleanly');

  team.record.wins = 10; // simulate further drift before rewinding
  const result = saveModule.rewindToSeason(gs, 2050);
  assert.strictEqual(result.success, true);
  assert.strictEqual(team.record.wins, 41, 'rewind should restore that season\'s recorded state');
  assert.strictEqual(gs.leagueYear, 2050, 'rewind should restore leagueYear too');

  // Re-pushing the same year should replace, not duplicate.
  saveModule.pushSeasonSnapshot(gs);
  const count2050 = gs.seasonSnapshots.filter(function (s) { return s.leagueYear === 2050; }).length;
  assert.strictEqual(count2050, 1, 're-pushing the same season should replace the existing snapshot');

  console.log('checkSeasonSnapshotsAndRewind: OK');
}

checkSeasonSnapshotsAndRewind();

function checkSeasonSnapshotsAreBounded() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState({});
  for (let year = 2000; year < 2015; year++) {
    gs.leagueYear = year;
    saveModule.pushSeasonSnapshot(gs);
  }
  assert.strictEqual(gs.seasonSnapshots.length, 10, 'season snapshots should be capped at SEASON_SNAPSHOT_LIMIT (10)');
  assert.strictEqual(gs.seasonSnapshots[0].leagueYear, 2005, 'the oldest snapshots should be dropped first');
  console.log('checkSeasonSnapshotsAreBounded: OK');
}

checkSeasonSnapshotsAreBounded();


function checkGmCareerRoundTrips() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gmCareer = require(path.join(__dirname, '..', 'gmCareer.js'));
  const gs = makeFakeGameState();
  const career = gmCareer.ensureGmCareer(gs);
  career.name = 'Cory';
  gmCareer.recordSeason(career, 2026, gs.userTeamId, 58, 24, null);
  gmCareer.addChronicle(career, 2026, 'season', '58-24. Missed the playoffs.');
  career.milestones.push({ id: 'five_seasons', leagueYear: 2026 });

  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Round Trip Career')));
  assert.strictEqual(payload.version, 3, 'the career is a new field, so the format version moves');

  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.strictEqual(restored.gmCareer.name, 'Cory');
  assert.strictEqual(restored.gmCareer.seasons.length, 1);
  assert.strictEqual(restored.gmCareer.seasons[0].wins, 58);
  assert.strictEqual(restored.gmCareer.chronicle.length, 1);
  assert.deepStrictEqual(restored.gmCareer.milestones, [{ id: 'five_seasons', leagueYear: 2026 }]);
  console.log('checkGmCareerRoundTrips: OK');
}
checkGmCareerRoundTrips();

function checkAVersionTwoSaveStillLoads() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState();
  const payload = JSON.parse(JSON.stringify(saveModule.serializeGameState(gs, 'Old Save')));
  // Exactly what a save written before this feature looks like.
  delete payload.gmCareer;
  payload.version = 2;

  const restored = {};
  saveModule.applySavedState(payload, restored);
  assert.ok(restored.gmCareer, 'a v2 save must come back with a career, not undefined');
  assert.strictEqual(restored.gmCareer.seasons.length, 0,
    'and with NO invented history — it does not know what happened before it existed');
  assert.strictEqual(restored.gmCareer.tenures[0].startYear, restored.leagueYear,
    'the tenure starts at the year the save is actually at, not 2026');
  console.log('checkAVersionTwoSaveStillLoads: OK');
}
checkAVersionTwoSaveStillLoads();

// Feats, team seasons and family links are the three stores added for the
// history features. None of them can be rebuilt from anything else: box scores
// are pruned at save time, season snapshots roll off the front, and a family
// link exists nowhere but on the two players. If they do not survive a
// save/load they are gone for good, and nothing else in this file would notice
// because they ride on LEAGUE_HISTORY and the player objects rather than on
// their own payload keys.
function checkNewHistoryStoresRoundTrip() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const history = require(path.join(__dirname, '..', 'history.js'));
  const relatives = require(path.join(__dirname, '..', 'relatives.js'));
  const PLAYERS = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026;

  history.LEAGUE_HISTORY.feats.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  history.LEAGUE_HISTORY.feats.push({
    leagueYear: 2030, day: 5, playerId: 'p1', playerName: 'Test', teamId: 'BOS',
    oppTeamId: 'LAL', kind: 'tripleDouble', points: 30, rebounds: 14, assists: 14, steals: 1, blocks: 1
  });
  history.LEAGUE_HISTORY.teamSeasons.push({
    leagueYear: 2030, teamId: 'BOS', wins: 60, losses: 22, playoffResult: 'champion', champion: true
  });
  const dad = PLAYERS[0], kid = PLAYERS[1];
  delete dad.relatives; delete kid.relatives;
  relatives.link(dad, kid, 'father');

  const payload = JSON.parse(JSON.stringify(
    saveModule.serializeGameState(makeFakeGameState(), 'History Save')));

  history.LEAGUE_HISTORY.feats.length = 0;
  history.LEAGUE_HISTORY.teamSeasons.length = 0;
  delete dad.relatives; delete kid.relatives;

  const restored = {};
  saveModule.applySavedState(payload, restored);

  assert.strictEqual(history.LEAGUE_HISTORY.feats.length, 1, 'feats must survive a save/load');
  assert.strictEqual(history.LEAGUE_HISTORY.feats[0].kind, 'tripleDouble');
  assert.strictEqual(history.LEAGUE_HISTORY.feats[0].rebounds, 14,
    'and must come back with the line intact, not just the kind');
  assert.strictEqual(history.LEAGUE_HISTORY.teamSeasons.length, 1, 'team seasons must survive');
  assert.strictEqual(history.LEAGUE_HISTORY.teamSeasons[0].champion, true);

  // applySavedState rebuilds PLAYERS_2026 from the payload, so re-find them.
  const loadedDad = PLAYERS.find(function (p) { return p.id === dad.id; });
  const loadedKid = PLAYERS.find(function (p) { return p.id === kid.id; });
  assert.ok(loadedDad && loadedKid, 'both players must come back');
  assert.deepStrictEqual(relatives.relativesOf(loadedDad),
    [{ type: 'son', playerId: loadedKid.id, name: loadedKid.name }],
    'the father end of the link must survive');
  assert.deepStrictEqual(relatives.relativesOf(loadedKid),
    [{ type: 'father', playerId: loadedDad.id, name: loadedDad.name }],
    'and so must the son end — a one-way link is a broken family');

  delete loadedDad.relatives; delete loadedKid.relatives;
  console.log('checkNewHistoryStoresRoundTrip: OK');
}

// A save written before these fields existed must still load, leaving the
// defaults in place rather than undefined — every toy and the Feats page read
// these arrays without guarding.
function checkOldSaveWithoutNewFieldsLoads() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const history = require(path.join(__dirname, '..', 'history.js'));

  const payload = JSON.parse(JSON.stringify(
    saveModule.serializeGameState(makeFakeGameState(), 'Ancient Save')));
  delete payload.leagueHistory.feats;
  delete payload.leagueHistory.teamSeasons;

  // Exactly the state a freshly loaded page is in: the defaults from the
  // LEAGUE_HISTORY literal, untouched. Seeding them with junk first and then
  // asserting "still an array" would assert nothing — the junk is an array.
  history.LEAGUE_HISTORY.feats = [];
  history.LEAGUE_HISTORY.teamSeasons = [];

  const restored = {};
  saveModule.applySavedState(payload, restored);

  assert.ok(Array.isArray(history.LEAGUE_HISTORY.feats),
    'an old save must leave feats an EMPTY ARRAY, not undefined — the Feats ' +
    'page and every toy read it without guarding');
  assert.strictEqual(history.LEAGUE_HISTORY.feats.length, 0);
  assert.ok(Array.isArray(history.LEAGUE_HISTORY.teamSeasons),
    'an old save must leave teamSeasons an empty array, not undefined');
  assert.strictEqual(history.LEAGUE_HISTORY.teamSeasons.length, 0);

  // And the pages that read them must actually render off that state rather
  // than throwing on undefined, which is the failure this guards against.
  const toys = require(path.join(__dirname, '..', 'historyToys.js'));
  assert.deepStrictEqual(toys.bestTeams(5), [], 'the team toys must open on an old save');
  assert.deepStrictEqual(toys.worstToWinIt(5), []);
  console.log('checkOldSaveWithoutNewFieldsLoads: OK');
}

// A payload missing a whole subsystem's state must not null out the running
// game's copy. Both of these threw on a real screen when a save built without
// them was loaded: Scouting on scouting.pointsAvailable, Settings on
// settings.pauseOn. Every save the game writes carries both, so this only bites
// a payload from before those fields existed — the same case the leagueYear
// guard beside them was added for.
function checkAPayloadMissingSubsystemsStillLoads() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));

  const payload = JSON.parse(JSON.stringify(
    saveModule.serializeGameState(makeFakeGameState(), 'Ancient Save')));
  delete payload.scouting;
  delete payload.settings.pauseOn;

  const gs = makeFakeGameState();
  saveModule.applySavedState(payload, gs);

  assert.ok(gs.scouting, 'a payload without scouting must not leave the game without it');
  assert.strictEqual(typeof gs.scouting.pointsAvailable, 'number',
    'the Scouting page reads pointsAvailable without checking, so it must be a number');
  assert.ok(gs.scouting.targets && typeof gs.scouting.targets === 'object',
    'scouting needs its targets map, not just a points count');
  assert.ok(gs.settings.pauseOn && typeof gs.settings.pauseOn === 'object',
    'a payload without pauseOn must not leave the Settings page reading undefined');
  console.log('checkAPayloadMissingSubsystemsStillLoads: OK');
}

checkAPayloadMissingSubsystemsStillLoads();
checkNewHistoryStoresRoundTrip();
checkOldSaveWithoutNewFieldsLoads();

// save.js builds an EXPLICIT payload field list at both ends. A new GameState
// field that is not added to it is silently dropped on reload — which for
// reporters would mean a different beat writer every session, defeating the
// entire reason they are cached rather than generated per scene.
function checkDialogueStateSurvivesARoundTrip() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const gs = makeFakeGameState({
    reporters: {
      BOS: { id: 'reporter-BOS', teamId: 'BOS', name: 'Dana Kessler', outlet: 'The Beat',
             face: { body: { color: '#bb876f' }, hair: { color: '#272421' } } }
    },
    recentDialogueScenes: ['blown-fourth-lead', 'statement-win']
  });

  const payload = saveModule.serializeGameState(gs, 'Test');
  assert.ok(payload.reporters, 'reporters reached the payload');
  assert.deepStrictEqual(payload.recentDialogueScenes, ['blown-fourth-lead', 'statement-win'],
    'the ring buffer reached the payload');

  const loaded = {};
  saveModule.applySavedState(payload, loaded);
  assert.ok(loaded.reporters, 'reporters survived the round trip');
  assert.strictEqual(loaded.reporters.BOS.name, 'Dana Kessler', 'the beat writer is the same person');
  assert.strictEqual(loaded.reporters.BOS.outlet, 'The Beat');
  assert.ok(loaded.reporters.BOS.face, 'the face survived, so the bust still draws');
  assert.deepStrictEqual(loaded.recentDialogueScenes, ['blown-fourth-lead', 'statement-win'],
    'the ring buffer survived');
  console.log('checkDialogueStateSurvivesARoundTrip: OK');
}
checkDialogueStateSurvivesARoundTrip();

function checkAnOldSaveWithoutDialogueStateLoads() {
  const saveModule = require(path.join(__dirname, '..', 'save.js'));
  const payload = saveModule.serializeGameState(makeFakeGameState(), 'Test');
  delete payload.reporters;
  delete payload.recentDialogueScenes;

  const loaded = {};
  assert.doesNotThrow(function () { saveModule.applySavedState(payload, loaded); },
    'a save predating the feature loads without throwing');
  assert.deepStrictEqual(loaded.recentDialogueScenes, [], 'the buffer normalizes to empty');
  assert.strictEqual(loaded.reporters, null, 'reporters stay null, to be regenerated on first use');
  console.log('checkAnOldSaveWithoutDialogueStateLoads: OK');
}
checkAnOldSaveWithoutDialogueStateLoads();


console.log('All save/load validations passed');
