var _HISTORY_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      players: require('./players-2026.js'),
      awards: require('./awards.js')
    }
  : {
      league: {
        SEASON_STAT_KEYS: SEASON_STAT_KEYS,
        getPlayerAverages: getPlayerAverages,
        getTeamRoster: getTeamRoster,
        getPlayerById: getPlayerById
      },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      players: { PLAYERS_2026: PLAYERS_2026 },
      awards: { computeSeasonAwards: computeSeasonAwards }
    };

const LEAGUE_HISTORY = {
  retiredPlayers: [],
  trades: [],
  draftClasses: [],
  awardsHistory: [],
  champions: []
};

const ZERO_AVERAGES = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };

function ensureCareerData(players) {
  players.forEach(function (p) {
    if (!p.careerStats) {
      p.careerStats = { gamesPlayed: 0, seasonsPlayed: 0 };
      _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { p.careerStats[key] = 0; });
    }
    if (!p.awardsWon) p.awardsWon = [];
    if (p.peakOverall === undefined) p.peakOverall = p.overall;
    if (p.championshipsWon === undefined) p.championshipsWon = 0;
    if (!p.teamsPlayedFor) p.teamsPlayedFor = p.teamId ? [p.teamId] : [];
    if (!p.bestSeasonTotals) p.bestSeasonTotals = { points: 0, rebounds: 0, assists: 0 };
    if (!p.lastSeasonAverages) p.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
  });
}

const MILESTONE_THRESHOLDS = {
  points: [10000, 20000, 30000],
  rebounds: [5000, 10000],
  assists: [5000, 10000]
};
const MILESTONE_STAT_LABELS = { points: 'career points', rebounds: 'career rebounds', assists: 'career assists' };

function checkMilestones(player, beforeTotals, feedSink) {
  Object.keys(MILESTONE_THRESHOLDS).forEach(function (statKey) {
    MILESTONE_THRESHOLDS[statKey].forEach(function (threshold) {
      if (beforeTotals[statKey] < threshold && player.careerStats[statKey] >= threshold) {
        feedSink(player.name + ' reaches ' + threshold.toLocaleString() + ' ' + MILESTONE_STAT_LABELS[statKey] + '.');
      }
    });
  });
}

function rollSeasonIntoCareerStats(player, feedSink) {
  const sink = feedSink || function () {};
  ensureCareerData([player]);
  player.peakOverall = Math.max(player.peakOverall, player.overall);
  if (player.teamId && player.teamsPlayedFor.indexOf(player.teamId) === -1) {
    player.teamsPlayedFor.push(player.teamId);
  }

  if (!player.seasonStats || player.seasonStats.gamesPlayed === 0) {
    player.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
    return;
  }

  player.lastSeasonAverages = _HISTORY_DATA.league.getPlayerAverages(player);

  ['points', 'rebounds', 'assists'].forEach(function (key) {
    if (player.seasonStats[key] > player.bestSeasonTotals[key]) {
      player.bestSeasonTotals[key] = player.seasonStats[key];
    }
  });

  const beforeTotals = { points: player.careerStats.points, rebounds: player.careerStats.rebounds, assists: player.careerStats.assists };
  player.careerStats.gamesPlayed += player.seasonStats.gamesPlayed;
  player.careerStats.seasonsPlayed += 1;
  _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) {
    player.careerStats[key] += player.seasonStats[key] || 0;
  });

  checkMilestones(player, beforeTotals, sink);
}

// Weighted career-value score: counting stats are worth a small fraction of a
// point each (roughly calibrated to what a decorated ~15-year career
// accumulates), awards/selections are flat bonuses — the same "mix scaled-
// stat and flat-bonus terms into one comparable score" approach
// tradeEvaluator.js's contractBurden/needMultiplier already use.
const HOF_THRESHOLD = 100;

function computeHofScore(player) {
  ensureCareerData([player]);
  const cs = player.careerStats;
  const mvpCount = player.awardsWon.filter(function (a) { return a.award === _HISTORY_DATA.awards.AWARD_KEYS.MVP; }).length;
  const dpoyCount = player.awardsWon.filter(function (a) { return a.award === _HISTORY_DATA.awards.AWARD_KEYS.DPOY; }).length;
  const allNbaCount = player.awardsWon.filter(function (a) {
    return a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_1
      || a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_2
      || a.award === _HISTORY_DATA.awards.AWARD_KEYS.ALL_NBA_3;
  }).length;
  return (
    cs.points / 250 +
    cs.rebounds / 100 +
    cs.assists / 60 +
    mvpCount * 25 +
    dpoyCount * 15 +
    allNbaCount * 8 +
    player.championshipsWon * 12 +
    Math.max(0, player.peakOverall - 75) * 2
  );
}

function archiveRetiree(player, leagueYear) {
  ensureCareerData([player]);
  const hofScore = computeHofScore(player);
  const record = {
    id: player.id,
    name: player.name,
    position: player.position,
    retiredYear: leagueYear,
    teamsPlayedFor: player.teamsPlayedFor.slice(),
    careerStats: Object.assign({}, player.careerStats),
    bestSeasonTotals: Object.assign({}, player.bestSeasonTotals),
    awardsWon: player.awardsWon.slice(),
    championshipsWon: player.championshipsWon,
    peakOverall: player.peakOverall,
    hofScore: hofScore,
    hallOfFame: hofScore >= HOF_THRESHOLD
  };
  LEAGUE_HISTORY.retiredPlayers.push(record);
  return record;
}

const PRESTIGE_CHAMPION_BUMP = 5;
const PRESTIGE_FINALS_BUMP = 2;
const PRESTIGE_PLAYOFF_BUMP = 1;
const PRESTIGE_BAD_SEASON_DECAY = 1;
const BAD_SEASON_WIN_PCT = 0.35;
const PRESTIGE_MIN = 20;
const PRESTIGE_MAX = 99;

function adjustPrestige(team, madeFinals, wonChampionship, madePlayoffs) {
  let delta = 0;
  if (wonChampionship) {
    delta = PRESTIGE_CHAMPION_BUMP;
  } else if (madeFinals) {
    delta = PRESTIGE_FINALS_BUMP;
  } else if (madePlayoffs) {
    delta = PRESTIGE_PLAYOFF_BUMP;
  } else {
    const gamesPlayed = team.record.wins + team.record.losses;
    const winPct = gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0.5;
    if (winPct < BAD_SEASON_WIN_PCT) delta = -PRESTIGE_BAD_SEASON_DECAY;
  }
  team.prestige = Math.max(PRESTIGE_MIN, Math.min(PRESTIGE_MAX, team.prestige + delta));
}

function archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, feedSink) {
  const sink = feedSink || function () {};
  if (!playoffBracket || playoffBracket.finals.length === 0 || !playoffBracket.finals[0].complete) return;

  const championId = playoffBracket.finals[0].winner;
  LEAGUE_HISTORY.champions.push({ leagueYear: leagueYear, teamId: championId });

  const playoffTeamIds = {};
  playoffBracket.first.forEach(function (s) { playoffTeamIds[s.higherSeed] = true; playoffTeamIds[s.lowerSeed] = true; });
  const finalsTeamIds = {};
  finalsTeamIds[playoffBracket.finals[0].higherSeed] = true;
  finalsTeamIds[playoffBracket.finals[0].lowerSeed] = true;

  _HISTORY_DATA.teams.TEAMS.forEach(function (team) {
    const madePlayoffs = !!playoffTeamIds[team.id];
    const madeFinals = !!finalsTeamIds[team.id];
    const wonChampionship = team.id === championId;
    adjustPrestige(team, madeFinals, wonChampionship, madePlayoffs);
  });

  const champRoster = _HISTORY_DATA.league.getTeamRoster(championId);
  champRoster.forEach(function (p) {
    ensureCareerData([p]);
    p.championshipsWon += 1;
  });

  const champTeam = _HISTORY_DATA.teams.getTeamById(championId);
  sink(champTeam.name + ' wins the ' + leagueYear + ' championship!');
}

function archiveTrade(proposal, leagueYear) {
  const record = {
    leagueYear: leagueYear,
    participants: proposal.participants.slice(),
    players: proposal.assignments.map(function (a) {
      const player = _HISTORY_DATA.league.getPlayerById(a.playerId);
      return { playerId: a.playerId, playerName: player ? player.name : 'Unknown', fromTeamId: a.fromTeamId, toTeamId: a.toTeamId };
    }),
    picks: (proposal.pickAssignments || []).map(function (pa) {
      return { round: pa.round, fromTeamId: pa.fromTeamId, toTeamId: pa.toTeamId };
    })
  };
  LEAGUE_HISTORY.trades.push(record);
  return record;
}

function archiveDraftClass(leagueYear, draftResults) {
  const record = {
    leagueYear: leagueYear,
    picks: draftResults.map(function (r) {
      return { round: r.round, pickNumber: r.pickNumber, teamId: r.teamId, playerId: r.prospect.id, playerName: r.prospect.name };
    })
  };
  LEAGUE_HISTORY.draftClasses.push(record);
  return record;
}

// The single season-end entry point script.js calls, once, at the top of
// handleAdvanceToOffseason — BEFORE retirement runs, so archiveRetiree (Task
// 5, wired into seasonTransition.js in Task 9) sees each retiree's fully
// updated careerStats/awardsWon for the season that just finished.
function finalizeSeasonHistory(leagueYear, playoffBracket, feedSink) {
  const sink = feedSink || function () {};
  const seasonAwards = _HISTORY_DATA.awards.computeSeasonAwards(leagueYear);

  seasonAwards.winners.forEach(function (w) {
    const player = _HISTORY_DATA.league.getPlayerById(w.playerId);
    if (!player) return;
    ensureCareerData([player]);
    player.awardsWon.push({ award: w.award, leagueYear: leagueYear });
    sink(player.name + ' wins ' + w.award + ' for ' + leagueYear + '.');
  });
  LEAGUE_HISTORY.awardsHistory.push(seasonAwards);

  _HISTORY_DATA.teams.TEAMS.forEach(function (team) {
    team.allTimeWins = (team.allTimeWins || 0) + team.record.wins;
    team.allTimeLosses = (team.allTimeLosses || 0) + team.record.losses;
    team.lastSeasonWins = team.record.wins;
  });

  archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, sink);

  _HISTORY_DATA.players.PLAYERS_2026.forEach(function (p) {
    rollSeasonIntoCareerStats(p, sink);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats,
    computeHofScore: computeHofScore,
    HOF_THRESHOLD: HOF_THRESHOLD,
    archiveRetiree: archiveRetiree,
    archiveChampionAndAdjustPrestige: archiveChampionAndAdjustPrestige,
    archiveTrade: archiveTrade,
    archiveDraftClass: archiveDraftClass,
    finalizeSeasonHistory: finalizeSeasonHistory
  };
}
