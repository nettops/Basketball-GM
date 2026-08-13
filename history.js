var _HISTORY_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      teams: require('./teams.js'),
      players: require('./players-2026.js'),
      awards: require('./awards.js'),
      careerHistory: require('./careerHistory.js'),
      finances: require('./finances.js'),
      coaches: require('./coaches.js'),
      ratings: require('./ratings.js'),
      gmCareer: require('./gmCareer.js'),
      gmMilestones: require('./gmMilestones.js')
    }
  : {
      league: {
        SEASON_STAT_KEYS: SEASON_STAT_KEYS,
        getPlayerAverages: getPlayerAverages,
        getTeamRoster: getTeamRoster,
        getPlayerById: getPlayerById,
        getTeamPayroll: getTeamPayroll
      },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      players: { PLAYERS_2026: PLAYERS_2026 },
      awards: { computeSeasonAwards: computeSeasonAwards, AWARD_KEYS: AWARD_KEYS },
      careerHistory: { ensureCareerHistory: ensureCareerHistory, recordTradeInHistory: recordTradeInHistory, recordSeasonInHistory: recordSeasonInHistory },
      finances: { applySeasonEndFinances: applySeasonEndFinances },
      coaches: { tickCoachTenure: tickCoachTenure },
      ratings: { toDisplayRating: toDisplayRating },
      gmMilestones: {
        buildContext: buildContext, evaluate: evaluate,
        nearestMilestone: nearestMilestone, isUnlocked: isUnlocked,
        MILESTONES: MILESTONES
      },
      // gmCareer.js's <script> tag loads immediately before this file's, so
      // these are safe to reference eagerly — unlike commissioner.js below.
      gmCareer: {
        ensureGmCareer: ensureGmCareer,
        recordSeason: recordSeason,
        recordSeasonChronicle: recordSeasonChronicle,
        addChronicle: addChronicle,
        CHRONICLE_KINDS: CHRONICLE_KINDS,
        regularSeasonRecord: regularSeasonRecord,
        careerTotals: careerTotals,
        seasonsAscending: seasonsAscending,
        titleYears: titleYears,
        longestTitleRun: longestTitleRun,
        longestPlayoffStreak: longestPlayoffStreak,
        userDraftPicks: userDraftPicks,
        userTrades: userTrades,
        playersAcquiredByTrade: playersAcquiredByTrade,
        tenureCovers: tenureCovers,
        SEASON_RESULT: SEASON_RESULT,
        SEASON_RESULT_LABEL: SEASON_RESULT_LABEL
      }
    };

// Lazily resolved (mirrors league.js's _historyDeps()/_simDeps() pattern) —
// commissioner.js's <script> tag loads AFTER history.js's in index.html (it
// needs trade.js/tradeEvaluator.js/draftProspects.js, which load after this
// file), so referencing checkAutoExpansion eagerly at file-load time in the
// browser-global fallback above would throw a ReferenceError before it's
// defined, aborting the rest of this file's evaluation (which is exactly
// what left ZERO_AVERAGES permanently in its temporal dead zone the one time
// this was tried).
function _commissionerDep() {
  return (typeof require !== 'undefined')
    ? require('./commissioner.js')
    : { checkAutoExpansion: checkAutoExpansion };
}

// Lazy for the same reason _commissionerDep() is: draft.js's <script> tag
// loads well after history.js's in index.html, so naming playoffResultByTeam
// in the browser-global fallback at file-load time would throw before it is
// defined and abort the rest of this file.
function _draftDep() {
  return (typeof require !== 'undefined')
    ? require('./draft.js')
    : { playoffResultByTeam: playoffResultByTeam };
}

const LEAGUE_HISTORY = {
  retiredPlayers: [],
  trades: [],
  draftClasses: [],
  awardsHistory: [],
  champions: [],
  // Single-game feats, league-wide, for the life of the save. They cannot be
  // recovered later: save.js prunes box scores to the user's own games, so a
  // 60-point night by another team is unrecoverable once written to disk.
  feats: [],
  // One row per team per completed season. Season snapshots are capped and
  // roll off the front, so they cannot back all-time team records.
  teamSeasons: [],
  // Every completed takeover, league-wide, for the same reason feats are here:
  // box scores are pruned to the user's own games at save time, so a takeover
  // by another team is unrecoverable once written to disk.
  takeovers: []
};

const ZERO_AVERAGES = { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0 };

function ensureCareerData(players) {
  players.forEach(function (p) {
    if (!p.careerStats) {
      p.careerStats = { gamesPlayed: 0, seasonsPlayed: 0 };
      _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { p.careerStats[key] = 0; });
    }
    if (!p.awardsWon) p.awardsWon = [];
    // Stored RAW, like every other persisted rating. The UI displays it through
    // toDisplayRating; storing the display value would freeze it against a curve
    // that can change, which is the stored-overall bug in a new coat.
    if (p.peakOverall === undefined) p.peakOverall = p.rawOverall;
    if (p.championshipsWon === undefined) p.championshipsWon = 0;
    if (!p.teamsPlayedFor) p.teamsPlayedFor = p.teamId ? [p.teamId] : [];
    if (!p.bestSeasonTotals) p.bestSeasonTotals = { points: 0, rebounds: 0, assists: 0 };
    if (!p.lastSeasonAverages) p.lastSeasonAverages = Object.assign({}, ZERO_AVERAGES);
    _HISTORY_DATA.careerHistory.ensureCareerHistory(p);
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

function rollSeasonIntoCareerStats(player, leagueYear, feedSink) {
  const sink = feedSink || function () {};
  ensureCareerData([player]);
  player.peakOverall = Math.max(player.peakOverall, player.rawOverall);
  if (player.teamId && player.teamsPlayedFor.indexOf(player.teamId) === -1) {
    player.teamsPlayedFor.push(player.teamId);
  }

  // Must run before the early-return below (a player with no games this
  // season has nothing to record) but also before seasonTransition.js's
  // generateNewSeason wipes player.seasonStats — this call happens well
  // before that, from finalizeSeasonHistory at the top of the offseason.
  _HISTORY_DATA.careerHistory.recordSeasonInHistory(player, leagueYear);

  // From here on, whatever is in seasonStats has been accounted for in
  // careerStats — set on BOTH paths below, including the zero-games early
  // return where "accounted for" means "there was nothing to account for".
  //
  // careerTotalsToDate needs this because seasonStats is NOT cleared here: the
  // manual rollover returns at the draft (seasonRollover.js:89) and only
  // generateNewSeason wipes it, so for the whole draft/free-agency stretch
  // both fields hold the same season. Without the flag, career totals shown
  // during the offseason would count that year twice.
  player.seasonStatsRolled = true;

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

// Career totals AS DISPLAYED: what careerStats holds, plus the season being
// played right now.
//
// careerStats is a bank that only takes a deposit at the top of the offseason,
// which is correct for the milestone/record machinery built on it — but wrong
// as an answer to "what has this player done in their career", which is what
// every Career Totals panel is asking. Five games into year one that read
// Games 0 / PPG 0.0 directly beneath a Current Season panel saying GP 5.
//
// Returns a NEW object. Callers must not write through it, and nothing here
// touches the stored record: checkMilestones diffs careerStats across the roll,
// so mutating it from a render path would fire milestones off a moved baseline.
function careerTotalsToDate(player) {
  ensureCareerData([player]);
  const stored = player.careerStats;
  const totals = { gamesPlayed: stored.gamesPlayed, seasonsPlayed: stored.seasonsPlayed };
  _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { totals[key] = stored[key] || 0; });

  const live = player.seasonStats;
  // seasonStatsRolled: already banked, so adding it again would double-count
  // the year for the entire draft/free-agency window. No games: an unplayed
  // season is not a season played, so it must not bump seasonsPlayed.
  if (!live || player.seasonStatsRolled || !live.gamesPlayed) return totals;

  totals.gamesPlayed += live.gamesPlayed;
  totals.seasonsPlayed += 1;
  _HISTORY_DATA.league.SEASON_STAT_KEYS.forEach(function (key) { totals[key] += live[key] || 0; });
  return totals;
}

// Best-season highs AS DISPLAYED, same story as careerTotalsToDate:
// careerHighs.singleSeason is only written by recordSeasonInHistory at season
// end, so a profile showed "Best Season PPG 0.0" directly beside a live 16.4 —
// while Single-Game Pts, which updates per game, read a correct 36.
//
// max() rather than addition, and a NEW object: writing a mid-season pace into
// the stored highs would make it permanent the moment the user looked at it.
function seasonHighsToDate(player) {
  ensureCareerData([player]);
  const stored = player.careerHistory.careerHighs.singleSeason;
  const highs = {
    points: stored.points, rebounds: stored.rebounds, assists: stored.assists,
    ppg: stored.ppg, rpg: stored.rpg, apg: stored.apg
  };

  // seasonStatsRolled is defensive here, unlike in careerTotalsToDate where it
  // is load-bearing: max() is idempotent, so once a season is banked into the
  // stored highs, re-considering it changes nothing. Kept for symmetry and
  // because a future switch from max() to accumulation would need it.
  const live = player.seasonStats;
  if (!live || player.seasonStatsRolled || !live.gamesPlayed) return highs;

  // Totals are compared raw, so a 5-game season cannot out-total a full one.
  // Rates are compared per game, so a genuinely career-best pace shows up
  // immediately rather than waiting for the offseason to be believed.
  const gp = live.gamesPlayed;
  highs.points = Math.max(highs.points, live.points || 0);
  highs.rebounds = Math.max(highs.rebounds, live.rebounds || 0);
  highs.assists = Math.max(highs.assists, live.assists || 0);
  highs.ppg = Math.max(highs.ppg, (live.points || 0) / gp);
  highs.rpg = Math.max(highs.rpg, (live.rebounds || 0) / gp);
  highs.apg = Math.max(highs.apg, (live.assists || 0) / gp);
  return highs;
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

// The two numbers the tenure and earnings toys need, banked as scalars rather
// than by copying the whole careerHistory into the archive. The archive is
// saved to disk for the life of the league, and seasonByYear alone would add a
// row per season per retiree forever; two numbers is what the lists actually
// read. Without them a career vanishes from both lists the moment it ends,
// which is exactly backwards for a history toy.
function longestTenureOf(player) {
  const spells = (player.careerHistory && player.careerHistory.teamHistory) || [];
  let years = 0, teamId = null;
  spells.forEach(function (s) {
    if ((s.seasons || 0) > years) { years = s.seasons || 0; teamId = s.teamId; }
  });
  return { years: years, teamId: teamId };
}

// One number per season played: points + rebounds + assists for that year.
//
// The trade toys ask "what did this player do AFTER the trade", which needs a
// per-season breakdown, not a career total. The full seasonByYear is twenty
// fields a season and would be a real weight on the save; this is one number,
// and it is the only thing that question needs.
//
// Without it a traded player's contribution silently became zero the moment he
// retired — and because a trade is only judged three seasons on, retirement is
// the NORMAL case. Measured: an even trade (2,600 against 2,900) read as
// 2,600 against 0 once one side retired, turning a fair swap into the most
// lopsided robbery in league history.
function productionByYearOf(player) {
  const byYear = (player.careerHistory && player.careerHistory.seasonByYear) || {};
  const out = {};
  Object.keys(byYear).forEach(function (year) {
    const s = byYear[year] || {};
    out[year] = (s.points || 0) + (s.rebounds || 0) + (s.assists || 0);
  });
  return out;
}

function careerEarningsOf(player) {
  const contracts = (player.careerHistory && player.careerHistory.contractHistory) || [];
  return contracts.reduce(function (sum, c) {
    return sum + (c.salary || 0) * (c.yearsRemaining || 0);
  }, 0);
}

function archiveRetiree(player, leagueYear) {
  ensureCareerData([player]);
  const hofScore = computeHofScore(player);
  const tenure = longestTenureOf(player);
  const record = {
    longestTenure: tenure.years,
    longestTenureTeamId: tenure.teamId,
    careerEarnings: careerEarningsOf(player),
    // Both of these are load-bearing for family trees and both were missing.
    //
    // firstLeagueYear is the ONLY thing that makes a player eligible to be
    // someone's father, and the gap required is eighteen seasons — longer than
    // almost anyone plays. So by the time a player qualifies he has usually
    // retired, and dropping this field here retired him out of fatherhood too.
    // Twenty seasons of a real league produced ZERO father-son pairs because
    // this line did not exist.
    //
    // relatives matters for the same reason in the other direction: a retired
    // brother who loses his side of the link vanishes from the Relatives toy
    // while his brother's profile still lists him. Copied, not aliased, like
    // every other array here.
    firstLeagueYear: player.firstLeagueYear,
    relatives: (player.relatives || []).slice(),
    productionByYear: productionByYearOf(player),
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
    hallOfFame: hofScore >= HOF_THRESHOLD,
    jerseyNumber: player.jerseyNumber,
    lastTeamId: player.teamId || null
  };
  LEAGUE_HISTORY.retiredPlayers.push(record);

  // A Hall-of-Fame-caliber career gets their number retired by whichever
  // team they were on when they retired — no attempt to guess which team
  // they're "most associated with" across a multi-team career.
  if (record.hallOfFame && player.teamId && player.jerseyNumber !== null && player.jerseyNumber !== undefined) {
    const team = _HISTORY_DATA.teams.getTeamById(player.teamId);
    if (team) {
      if (!team.retiredNumbers) team.retiredNumbers = [];
      if (team.retiredNumbers.indexOf(player.jerseyNumber) === -1) {
        team.retiredNumbers.push(player.jerseyNumber);
      }
    }
  }

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

// Grouped by conference and snapshotted at championship time — team.record
// gets zeroed out by seasonTransition.js's generateNewSeason before the user
// necessarily gets around to viewing a season recap, so "best record" has to
// be captured now rather than computed on demand later (same reasoning as
// LEAGUE_HISTORY.champions/awardsHistory being permanent archives, not live
// queries).
function computeBestRecordByConference() {
  const byConf = {};
  _HISTORY_DATA.teams.TEAMS.forEach(function (t) {
    const current = byConf[t.conference];
    const diff = (t.record.pointsFor || 0) - (t.record.pointsAgainst || 0);
    if (!current || t.record.wins > current.wins || (t.record.wins === current.wins && diff > current.diff)) {
      byConf[t.conference] = { teamId: t.id, wins: t.record.wins, losses: t.record.losses, diff: diff };
    }
  });
  return byConf;
}

function archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, feedSink) {
  const sink = feedSink || function () {};
  if (!playoffBracket || playoffBracket.finals.length === 0 || !playoffBracket.finals[0].complete) return;

  const championId = playoffBracket.finals[0].winner;
  LEAGUE_HISTORY.champions.push({ leagueYear: leagueYear, teamId: championId, bestRecordByConference: computeBestRecordByConference() });

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

// Appends detected feats. Separate from detection so feats.js stays pure and
// this file stays the only thing that owns LEAGUE_HISTORY.
function recordFeats(featRecords) {
  if (!featRecords || featRecords.length === 0) return [];
  featRecords.forEach(function (f) { LEAGUE_HISTORY.feats.push(f); });
  return featRecords;
}

// Appends completed takeovers, stamped with the season and day they happened.
//
// The player's NAME is stored beside his id deliberately. A takeover outlives
// the player: a row carrying only an id becomes unreadable the season he
// retires, which is exactly the failure the retiree archive already taught us
// — anything not explicitly copied is silently lost.
function recordTakeovers(rows, context) {
  if (!rows || !rows.length || !context) return [];
  const stored = rows.map(function (r) {
    return {
      leagueYear: context.leagueYear, day: context.day,
      playerId: r.playerId, playerName: r.playerName, teamId: r.teamId,
      ultimateKey: r.ultimateKey, points: r.points, period: r.period
    };
  });
  stored.forEach(function (r) { LEAGUE_HISTORY.takeovers.push(r); });
  return stored;
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

  proposal.assignments.forEach(function (a) {
    const player = _HISTORY_DATA.league.getPlayerById(a.playerId);
    if (!player) return;
    const fromTeam = _HISTORY_DATA.teams.getTeamById(a.fromTeamId);
    const toTeam = _HISTORY_DATA.teams.getTeamById(a.toTeamId);
    const details = (fromTeam ? fromTeam.name : a.fromTeamId) + ' trade ' + player.name + ' to ' + (toTeam ? toTeam.name : a.toTeamId) + '.';
    _HISTORY_DATA.careerHistory.recordTradeInHistory(player, a.fromTeamId, a.toTeamId, leagueYear, details);
  });

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
// Reuses draft.js's playoffResultByTeam — the same classifier the draft order
// is built from — rather than a second reading of the bracket that could
// disagree with it. Index 0 is "lost round 1" and 4 is "won it all"; a team
// absent from the bracket never played a playoff game.
const PLAYOFF_RESULT_LABELS = ['lostR1', 'lostCSF', 'lostCF', 'lostFinals', 'champion'];

function playoffResultLabel(bracket, teamId) {
  if (!bracket || !bracket.finals || !bracket.finals[0]) return 'missed';
  const byTeam = _draftDep().playoffResultByTeam(bracket);
  const r = byTeam[teamId];
  return r === undefined ? 'missed' : PLAYOFF_RESULT_LABELS[r];
}

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
  if (seasonAwards.coachOfTheYear) {
    const coach = seasonAwards.coachOfTheYear.coach;
    coach.awardsWon.push({ award: 'coachOfTheYear', leagueYear: leagueYear });
    sink(coach.name + ' (' + seasonAwards.coachOfTheYear.teamName + ') wins Coach of the Year for ' + leagueYear + '.');
  }
  LEAGUE_HISTORY.awardsHistory.push(seasonAwards);

  // GameState is a browser global from script.js — guarded since history.js
  // also runs standalone under Node in scripts/validate-*.js.
  const capLevel = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.capLevel : undefined;
  _HISTORY_DATA.teams.TEAMS.forEach(function (team) {
    // Recorded here because team.record is about to be folded into allTime and
    // then reset. Season snapshots are capped and roll off the front, so this
    // is the only durable per-season team record in the game — all-time team
    // superlatives have nothing else to stand on.
    LEAGUE_HISTORY.teamSeasons.push({
      leagueYear: leagueYear,
      teamId: team.id,
      wins: team.record.wins,
      losses: team.record.losses,
      playoffResult: playoffResultLabel(playoffBracket, team.id),
      champion: !!(playoffBracket && playoffBracket.finals && playoffBracket.finals[0] &&
        playoffBracket.finals[0].winner === team.id)
    });
    team.allTimeWins = (team.allTimeWins || 0) + team.record.wins;
    team.allTimeLosses = (team.allTimeLosses || 0) + team.record.losses;
    team.lastSeasonWins = team.record.wins;
    _HISTORY_DATA.finances.applySeasonEndFinances(team, _HISTORY_DATA.league.getTeamPayroll(team.id), capLevel);
    _HISTORY_DATA.coaches.tickCoachTenure(team);
  });

  archiveChampionAndAdjustPrestige(playoffBracket, leagueYear, sink);

  // The GM's own season row. Recorded here rather than at the two call sites
  // because this function is already the single shared season-end write point
  // for both the manual advance and the fast-forward; recording at the call
  // sites would give the two paths two chances to disagree.
  //
  // The record comes off the SCHEDULE, not off team.record — see
  // regularSeasonRecord for why (team.record silently includes the playoffs).
  // Guarded on GameState because history.js also runs standalone under Node in
  // scripts/validate-*.js.
  if (typeof GameState !== 'undefined' && GameState && GameState.userTeamId) {
    const career = _HISTORY_DATA.gmCareer.ensureGmCareer(GameState);
    const userTeam = _HISTORY_DATA.teams.getTeamById(GameState.userTeamId);
    if (userTeam) {
      const rs = _HISTORY_DATA.gmCareer.regularSeasonRecord(
        GameState.season ? GameState.season.games : [], userTeam.id);
      const row = _HISTORY_DATA.gmCareer.recordSeason(career, leagueYear, userTeam.id,
        rs.wins, rs.losses, playoffBracket);
      _HISTORY_DATA.gmCareer.recordSeasonChronicle(career, row, userTeam.name);

      // Milestones are evaluated AFTER the season row exists, because most of
      // them read it. Unlocks go to the feed as a LINE — never a modal. The
      // standing constraint is that nothing here adds a decision to make.
      const ctx = _HISTORY_DATA.gmMilestones.buildContext(career, LEAGUE_HISTORY,
        _HISTORY_DATA.players.PLAYERS_2026, LEAGUE_HISTORY.retiredPlayers,
        _HISTORY_DATA.ratings.toDisplayRating);
      _HISTORY_DATA.gmMilestones.evaluate(career, ctx).forEach(function (m) {
        sink('Career milestone: ' + m.label + ' — ' + m.description + '.');
      });
    }
  }

  _HISTORY_DATA.players.PLAYERS_2026.forEach(function (p) {
    rollSeasonIntoCareerStats(p, leagueYear, sink);
  });

  const autoExpansionEnabled = typeof GameState !== 'undefined' && GameState.settings && GameState.settings.autoExpansionEnabled;
  if (autoExpansionEnabled && typeof GameState !== 'undefined' && GameState.rng) {
    const expansionTeam = _commissionerDep().checkAutoExpansion(GameState.rng);
    if (expansionTeam) sink(expansionTeam.name + ' join the league as an expansion team, starting next season.');
  }
}

function careerLeaders(statKey, count) {
  const activeEntries = _HISTORY_DATA.players.PLAYERS_2026.map(function (p) {
    ensureCareerData([p]);
    // Career to date for actives, so this board agrees with the Career Totals
    // panels. Retirees below are read as stored: their last season was banked
    // when they retired and they have no live seasonStats to fold in.
    return { id: p.id, name: p.name, value: careerTotalsToDate(p)[statKey] };
  });
  const retiredEntries = LEAGUE_HISTORY.retiredPlayers.map(function (r) {
    return { id: r.id, name: r.name, value: r.careerStats[statKey] };
  });
  return activeEntries.concat(retiredEntries)
    .sort(function (a, b) { return b.value - a.value; })
    .slice(0, count);
}

function singleSeasonLeaders(statKey, count) {
  const activeEntries = _HISTORY_DATA.players.PLAYERS_2026.map(function (p) {
    ensureCareerData([p]);
    // bestSeasonTotals is written at season end like everything else here, so
    // an in-progress season has to be considered explicitly or this board sits
    // at zero for a league's whole first year.
    const live = (!p.seasonStats || p.seasonStatsRolled) ? 0 : (p.seasonStats[statKey] || 0);
    return { id: p.id, name: p.name, value: Math.max(p.bestSeasonTotals[statKey], live) };
  });
  const retiredEntries = LEAGUE_HISTORY.retiredPlayers.map(function (r) {
    return { id: r.id, name: r.name, value: r.bestSeasonTotals ? r.bestSeasonTotals[statKey] : 0 };
  });
  return activeEntries.concat(retiredEntries)
    .sort(function (a, b) { return b.value - a.value; })
    .slice(0, count);
}

function franchiseWinLeaders(count) {
  return _HISTORY_DATA.teams.TEAMS.slice()
    .map(function (t) { return { id: t.id, name: t.name, allTimeWins: t.allTimeWins || 0 }; })
    .sort(function (a, b) { return b.allTimeWins - a.allTimeWins; })
    .slice(0, count);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEAGUE_HISTORY: LEAGUE_HISTORY,
    ensureCareerData: ensureCareerData,
    rollSeasonIntoCareerStats: rollSeasonIntoCareerStats,
    careerTotalsToDate: careerTotalsToDate,
    seasonHighsToDate: seasonHighsToDate,
    computeHofScore: computeHofScore,
    HOF_THRESHOLD: HOF_THRESHOLD,
    archiveRetiree: archiveRetiree,
    archiveChampionAndAdjustPrestige: archiveChampionAndAdjustPrestige,
    computeBestRecordByConference: computeBestRecordByConference,
    archiveTrade: archiveTrade,
    recordFeats: recordFeats,
    recordTakeovers: recordTakeovers,
    archiveDraftClass: archiveDraftClass,
    finalizeSeasonHistory: finalizeSeasonHistory,
    careerLeaders: careerLeaders,
    singleSeasonLeaders: singleSeasonLeaders,
    franchiseWinLeaders: franchiseWinLeaders
  };
}
