// Generic seeding infrastructure for Phase 4 of the career history spec
// ("Basketball Reference 2026 Integration"). This module does not embed any
// real-player statistics itself — parsing a specific external source and
// building its datasetByPlayerId is a separate task; this is the mechanism
// that consumes whatever structured dataset that task produces.
var _CHI_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), careerHistory: require('./careerHistory.js') }
  : {
      league: { SEASON_STAT_KEYS: SEASON_STAT_KEYS },
      teams: { getTeamById: getTeamById },
      careerHistory: { ensureCareerHistory: ensureCareerHistory }
    };

function capitalizeImportKey(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// seasonData: { season, teamId, team (optional label), gamesPlayed, ...SEASON_STAT_KEYS }.
// Overwrites any existing entry for that season — imports are meant to seed
// a real player's pre-game-start baseline, not merge with sim-generated data.
function importSeasonRecord(player, seasonData) {
  const history = _CHI_DATA.careerHistory.ensureCareerHistory(player);
  const teamId = seasonData.teamId || null;
  const team = teamId ? _CHI_DATA.teams.getTeamById(teamId) : null;
  const record = { season: seasonData.season, team: seasonData.team || (team ? team.name : null), teamId: teamId, gamesPlayed: seasonData.gamesPlayed || 0 };
  _CHI_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { record[key] = seasonData[key] || 0; });
  history.seasonByYear[seasonData.season] = record;
  return record;
}

// Derives teamHistory tenures from whatever seasons are currently in
// seasonByYear, grouping consecutive same-team seasons into one entry. Called
// after importSeasonRecord for every season in an import batch, not per call,
// since a single season in isolation can't tell where a tenure starts/ends.
function rebuildTeamHistoryFromSeasons(player) {
  const history = _CHI_DATA.careerHistory.ensureCareerHistory(player);
  const seasons = Object.keys(history.seasonByYear).map(Number).sort(function (a, b) { return a - b; });
  const entries = [];
  seasons.forEach(function (year) {
    const s = history.seasonByYear[year];
    if (!s.teamId) return;
    let entry = entries[entries.length - 1];
    if (!entry || entry.teamId !== s.teamId) {
      const team = _CHI_DATA.teams.getTeamById(s.teamId);
      entry = { team: s.team || (team ? team.name : null), teamId: s.teamId, startSeason: year, endSeason: null, seasons: 0, totalGames: 0 };
      _CHI_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { entry['total' + capitalizeImportKey(key)] = 0; });
      entries.push(entry);
    }
    entry.endSeason = year;
    entry.seasons += 1;
    entry.totalGames += s.gamesPlayed;
    _CHI_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { entry['total' + capitalizeImportKey(key)] += s[key] || 0; });
  });
  // The most recent imported tenure is still active if it matches the
  // player's current live teamId; otherwise a trade/signing already closed
  // it out and endSeason stays at the last imported season.
  if (entries.length > 0 && entries[entries.length - 1].teamId === player.teamId) {
    entries[entries.length - 1].endSeason = null;
  }
  history.teamHistory = entries;
  return entries;
}

function importContractEntry(player, contractData) {
  const history = _CHI_DATA.careerHistory.ensureCareerHistory(player);
  history.contractHistory.push(contractData);
  return contractData;
}

function importInjuryEntry(player, injuryData) {
  const history = _CHI_DATA.careerHistory.ensureCareerHistory(player);
  const record = Object.assign({ actualRecoveryDays: null, gamesOut: 0, returnDate: null }, injuryData);
  history.injuryHistory.push(record);
  return record;
}

// Merges by max() rather than overwriting, so seeding a real player's
// verified career highs can never lower a value the sim has already
// (independently) produced for them.
function seedCareerHighsFromRealStats(player, highs) {
  const history = _CHI_DATA.careerHistory.ensureCareerHistory(player);
  if (highs.singleGame) {
    Object.keys(highs.singleGame).forEach(function (key) {
      history.careerHighs.singleGame[key] = Math.max(history.careerHighs.singleGame[key] || 0, highs.singleGame[key]);
    });
  }
  if (highs.singleSeason) {
    Object.keys(highs.singleSeason).forEach(function (key) {
      history.careerHighs.singleSeason[key] = Math.max(history.careerHighs.singleSeason[key] || 0, highs.singleSeason[key]);
    });
  }
  return history.careerHighs;
}

// data: { seasons: [...], contractHistory: [...], injuryHistory: [...], careerHighs: {...} }.
// Idempotent — re-importing the same player without force:true is a no-op,
// so re-running an import script can never double-seed a player's baseline
// on top of history the sim has since accumulated for them.
function importRealPlayerCareerHistory(player, data, force) {
  if (player.careerHistoryImported && !force) return null;
  _CHI_DATA.careerHistory.ensureCareerHistory(player);
  (data.seasons || []).forEach(function (s) { importSeasonRecord(player, s); });
  rebuildTeamHistoryFromSeasons(player);
  (data.contractHistory || []).forEach(function (c) { importContractEntry(player, c); });
  (data.injuryHistory || []).forEach(function (i) { importInjuryEntry(player, i); });
  if (data.careerHighs) seedCareerHighsFromRealStats(player, data.careerHighs);
  player.isRealPlayer = true;
  player.careerHistoryImported = true;
  return player.careerHistory;
}

// datasetByPlayerId: { [playerId]: importData }. Players with no matching
// entry are left untouched — this makes no claim about which portion of the
// roster is "real" beyond whatever the caller's dataset actually covers.
function bulkImportCareerHistory(players, datasetByPlayerId, force) {
  const imported = [];
  const skipped = [];
  players.forEach(function (p) {
    const data = datasetByPlayerId[p.id];
    if (!data) return;
    const result = importRealPlayerCareerHistory(p, data, force);
    if (result) imported.push(p.id); else skipped.push(p.id);
  });
  return { imported: imported, skipped: skipped };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    importSeasonRecord: importSeasonRecord,
    rebuildTeamHistoryFromSeasons: rebuildTeamHistoryFromSeasons,
    importContractEntry: importContractEntry,
    importInjuryEntry: importInjuryEntry,
    seedCareerHighsFromRealStats: seedCareerHighsFromRealStats,
    importRealPlayerCareerHistory: importRealPlayerCareerHistory,
    bulkImportCareerHistory: bulkImportCareerHistory
  };
}
