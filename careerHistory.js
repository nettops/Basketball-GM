// league.js/teams.js don't require careerHistory.js back, so these are safe
// to require eagerly here. league.js DOES lazily require careerHistory.js
// (via its own _historyDeps(), mirroring _simDeps()) to avoid the reverse
// cycle — see league.js for that rationale.
var _CH_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js') }
  : {
      league: { SEASON_STAT_KEYS: SEASON_STAT_KEYS, getPlayerAverages: getPlayerAverages },
      teams: { getTeamById: getTeamById }
    };

function capitalize(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function makeEmptyCareerHighs() {
  return {
    singleGame: { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, minutesPlayed: 0 },
    singleSeason: { points: 0, rebounds: 0, assists: 0, ppg: 0, rpg: 0, apg: 0 }
  };
}

function ensureCareerHistory(player) {
  if (!player.careerHistory) {
    player.careerHistory = {
      seasonByYear: {},
      teamHistory: [],
      contractHistory: [],
      injuryHistory: [],
      careerHighs: makeEmptyCareerHighs(),
      trades: []
    };
  }
  return player.careerHistory;
}

function findOpenTeamHistoryEntry(player, teamId) {
  return ensureCareerHistory(player).teamHistory.find(function (t) { return t.teamId === teamId && t.endSeason === null; });
}

function makeTeamHistoryEntry(teamId, season) {
  const team = _CH_DATA.teams.getTeamById(teamId);
  const entry = { team: team ? team.name : null, teamId: teamId, startSeason: season, endSeason: null, seasons: 0, totalGames: 0 };
  _CH_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { entry['total' + capitalize(key)] = 0; });
  return entry;
}

// gameStats is a single-game box score line (same shape league.js's
// accumulateSeasonStats consumes): points/rebounds/assists/steals/blocks/
// fgm/fga/tpm/tpa/ftm/fta/minutes. Only the subset the spec's
// careerHighs.singleGame tracks is checked here; "minutes" maps to the
// spec's "minutesPlayed" key.
const SINGLE_GAME_HIGH_KEYS = { points: 'points', rebounds: 'rebounds', assists: 'assists', steals: 'steals', blocks: 'blocks', minutes: 'minutesPlayed' };

function checkAndUpdateCareerHighs(player, gameStats) {
  const highs = ensureCareerHistory(player).careerHighs.singleGame;
  const updated = {};
  Object.keys(SINGLE_GAME_HIGH_KEYS).forEach(function (statKey) {
    const highKey = SINGLE_GAME_HIGH_KEYS[statKey];
    const value = gameStats[statKey] || 0;
    if (value > highs[highKey]) {
      highs[highKey] = value;
      updated[highKey] = value;
    }
  });
  return updated;
}

function checkAndUpdateSeasonCareerHighs(player, seasonRecord) {
  const highs = ensureCareerHistory(player).careerHighs.singleSeason;
  const averages = _CH_DATA.league.getPlayerAverages(player);
  const updated = {};
  ['points', 'rebounds', 'assists'].forEach(function (key) {
    if (seasonRecord[key] > highs[key]) {
      highs[key] = seasonRecord[key];
      updated[key] = seasonRecord[key];
    }
  });
  [['ppg', averages.ppg], ['rpg', averages.rpg], ['apg', averages.apg]].forEach(function (pair) {
    if (pair[1] > highs[pair[0]]) {
      highs[pair[0]] = pair[1];
      updated[pair[0]] = pair[1];
    }
  });
  return updated;
}

// Called once per player at season end (from history.js's
// rollSeasonIntoCareerStats, before seasonTransition.js's generateNewSeason
// wipes player.seasonStats). No-ops for a player who didn't play this
// season, same guard rollSeasonIntoCareerStats already applies to careerStats.
function recordSeasonInHistory(player, season) {
  const history = ensureCareerHistory(player);
  const stats = player.seasonStats;
  if (!stats || !stats.gamesPlayed) return null;

  const teamId = player.teamId;
  const team = teamId ? _CH_DATA.teams.getTeamById(teamId) : null;
  const seasonRecord = { season: season, team: team ? team.name : null, teamId: teamId, gamesPlayed: stats.gamesPlayed };
  _CH_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { seasonRecord[key] = stats[key] || 0; });
  history.seasonByYear[season] = seasonRecord;

  if (teamId) {
    let entry = findOpenTeamHistoryEntry(player, teamId);
    if (!entry) {
      entry = makeTeamHistoryEntry(teamId, season);
      history.teamHistory.push(entry);
    }
    entry.seasons += 1;
    entry.totalGames += stats.gamesPlayed;
    // Seeds the accumulator as well as the addend, for the same reason
    // league.js's accumulateSeasonStats does: makeTeamHistoryEntry builds
    // total<Key> from the keys that existed when the tenure OPENED, so a key
    // added while a player is still on the same team lands on a field that
    // was never seeded. See validate-careerHistory.js's
    // checkNewStatKeyDoesNotCorruptAnOpenTenure.
    _CH_DATA.league.SEASON_STAT_KEYS.forEach(function (key) {
      const totalKey = 'total' + capitalize(key);
      entry[totalKey] = (entry[totalKey] || 0) + (stats[key] || 0);
    });
  }

  checkAndUpdateSeasonCareerHighs(player, seasonRecord);

  return seasonRecord;
}

// Finalizes the outgoing team's open teamHistory entry and opens a new one
// for the incoming team. Called once per traded player from history.js's
// archiveTrade, which already fires from every trade.js/ui/tradeCenter.js/
// script.js call site via the existing historySink plumbing.
function recordTradeInHistory(player, fromTeamId, toTeamId, season, details) {
  const history = ensureCareerHistory(player);
  const fromEntry = findOpenTeamHistoryEntry(player, fromTeamId);
  if (fromEntry) fromEntry.endSeason = season;

  let toEntry = findOpenTeamHistoryEntry(player, toTeamId);
  if (!toEntry) {
    toEntry = makeTeamHistoryEntry(toTeamId, season);
    history.teamHistory.push(toEntry);
  }

  const record = { season: season, fromTeam: fromTeamId, toTeam: toTeamId, details: details || null };
  history.trades.push(record);
  return record;
}

function recordInjuryInHistory(player, injuryType, severity, estimatedRecoveryDays, season) {
  const history = ensureCareerHistory(player);
  const record = {
    season: season, type: injuryType, severity: severity,
    estimatedRecoveryDays: estimatedRecoveryDays, actualRecoveryDays: null,
    gamesOut: 0, returnDate: null
  };
  history.injuryHistory.push(record);
  return record;
}

// Closes the most recent still-open injury, regardless of which league year it
// was opened in. The old `i.season === season` filter meant an injury that ran
// past a season boundary (a season-ending one carries 999 games) could never be
// closed, so it sat in the career history as permanently unresolved.
function recordInjuryReturn(player, season, actualRecoveryDays) {
  const history = ensureCareerHistory(player);
  const openInjury = history.injuryHistory.filter(function (i) { return i.actualRecoveryDays === null; }).pop();
  if (!openInjury) return null;
  openInjury.actualRecoveryDays = actualRecoveryDays;
  return openInjury;
}

function recordContractInHistory(player, season, salary, yearsRemaining, teamId, contractType) {
  const history = ensureCareerHistory(player);
  const record = { season: season, salary: salary, yearsRemaining: yearsRemaining, teamId: teamId, type: contractType };
  history.contractHistory.push(record);
  return record;
}

function getTeamBreakdown(player, teamId) {
  return ensureCareerHistory(player).teamHistory.filter(function (t) { return t.teamId === teamId; });
}

function getCareerProgressionTrend(player) {
  const history = ensureCareerHistory(player);
  return Object.keys(history.seasonByYear)
    .map(function (year) { return history.seasonByYear[year]; })
    .sort(function (a, b) { return a.season - b.season; })
    .map(function (s) {
      const gp = s.gamesPlayed || 1;
      return { season: s.season, teamId: s.teamId, ppg: s.points / gp, rpg: s.rebounds / gp, apg: s.assists / gp, minutesPerGame: s.minutes / gp };
    });
}

// filters: { season, teamId, eventType } — all optional. teamId matches a
// contract's teamId or either side of a trade. Results are trade/contract/
// injury events tagged with eventType, sorted chronologically.
function queryHistoryByFilters(player, filters) {
  const f = filters || {};
  const history = ensureCareerHistory(player);
  let events = []
    .concat(history.trades.map(function (t) { return Object.assign({ eventType: 'trade' }, t); }))
    .concat(history.contractHistory.map(function (c) { return Object.assign({ eventType: 'contract' }, c); }))
    .concat(history.injuryHistory.map(function (i) { return Object.assign({ eventType: 'injury' }, i); }));

  if (f.season !== undefined) events = events.filter(function (e) { return e.season === f.season; });
  if (f.teamId !== undefined) events = events.filter(function (e) { return e.teamId === f.teamId || e.fromTeam === f.teamId || e.toTeam === f.teamId; });
  if (f.eventType !== undefined) events = events.filter(function (e) { return e.eventType === f.eventType; });

  return events.sort(function (a, b) { return a.season - b.season; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensureCareerHistory: ensureCareerHistory,
    recordSeasonInHistory: recordSeasonInHistory,
    recordTradeInHistory: recordTradeInHistory,
    recordInjuryInHistory: recordInjuryInHistory,
    recordInjuryReturn: recordInjuryReturn,
    recordContractInHistory: recordContractInHistory,
    checkAndUpdateCareerHighs: checkAndUpdateCareerHighs,
    getTeamBreakdown: getTeamBreakdown,
    getCareerProgressionTrend: getCareerProgressionTrend,
    queryHistoryByFilters: queryHistoryByFilters
  };
}
