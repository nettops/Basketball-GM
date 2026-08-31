// players.js/teams.js don't require league.js back, so these are safe to load
// eagerly. feats.js requires nothing at all, so it is safer still — it is a
// pure leaf. history.js is NOT here for the opposite reason: it requires
// league.js back at its first line, so an eager require would hand it this
// file's still-empty exports. It lives in _historyDeps() below.
var _LEAGUE_DATA = (typeof require !== 'undefined')
  ? { players: require('./players-2026.js'), teams: require('./teams.js'), feats: require('./feats.js') }
  : {
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { getTeamById: getTeamById, TEAMS: TEAMS },
      feats: { detectFeats: detectFeats }
    };

// simEngine.js/fatigue.js/injuries.js all require league.js back (for getTeamRoster),
// so eagerly requiring them here at module-load time would deadlock on the cycle —
// whichever side loads first gets an incomplete, still-empty module.exports from the
// other. Resolving them lazily, only when simulateDate() actually runs, sidesteps the
// cycle entirely: by call time every module has finished loading.
function _simDeps() {
  return (typeof require !== 'undefined')
    ? { simEngine: require('./simEngine.js'), fatigue: require('./fatigue.js'), injuries: require('./injuries.js'), morale: require('./morale.js'), finances: require('./finances.js'), gameSim: require('./gameSim.js'), rng: require('./rng.js') }
    : {
        simEngine: { getActiveEngine: getActiveEngine },
        fatigue: { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest },
        injuries: { rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame, INJURY_SEVERITY_TIER: INJURY_SEVERITY_TIER, GAMES_TO_DAYS: GAMES_TO_DAYS },
        morale: { tickMoraleForTeamGame: tickMoraleForTeamGame },
        finances: { tickFinancesForTeamGame: tickFinancesForTeamGame },
        // gameSim.js requires simEnginePossession.js, which requires this
        // file back for getTeamRoster — so it belongs here in the LAZY block
        // for exactly the reason described above, not in _LEAGUE_DATA.
        gameSim: { createGameSim: createGameSim },
        rng: { makeRng: makeRng }
      };
}

function getTeamRoster(teamId) {
  return _LEAGUE_DATA.players.PLAYERS_2026.filter(function (p) { return p.teamId === teamId; });
}

// Salary owed to men who no longer play here. Waiving a player used to delete
// his contract outright, which made the single most expensive decision in the
// game free: measured on the opening league, every club cutting its two worst
// players cleared $32M each — 20.8% of the cap — at no cost. Every other
// financial rule was being negotiated against a number that could be deleted.
//
// It lives here rather than at each cap check because getTeamPayroll is the one
// question everything already asks: trade legality, free agent offers, the cap
// sheet and the AI's own affordability checks all route through it and inherit
// dead money without knowing it exists.
function getTeamDeadMoney(teamId) {
  const team = _LEAGUE_DATA.teams.getTeamById(teamId);
  if (!team || !team.deadMoney) return 0;
  return team.deadMoney.reduce(function (sum, d) { return sum + (d.salary || 0); }, 0);
}

// The roster for limit purposes: everyone except two-way players who are with
// the affiliate. That exemption IS the two-way contract — a club carries them
// beyond the fifteen precisely because they are not taking up a seat.
//
// Separate from getTeamRoster rather than replacing it: the sim, the depth
// chart and every stat sweep want the whole roster, including a two-way player
// the moment he is called up. Only the count is different, so only the count
// asks a different question.
function getActiveRoster(teamId) {
  return getTeamRoster(teamId).filter(function (p) { return !(p.twoWay && p.twoWay.down); });
}

function getTeamPayroll(teamId) {
  return getTeamRoster(teamId).reduce(function (sum, p) { return sum + p.contract.salary; }, 0)
    + getTeamDeadMoney(teamId);
}

function getPlayerById(playerId) {
  return _LEAGUE_DATA.players.PLAYERS_2026.find(function (p) { return p.id === playerId; });
}

// oppFga/oppFgm accumulate across the season because DFG% is meaningless per
// game — five defended shots is noise. Season totals are what make it readable.
// This array is the stat spine: accumulateSeasonStats seeds and sums season
// lines from it, and careerHistory.js derives both its season records and its
// per-team total<Key> fields from it. Adding a key here carries a statistic
// from a single possession all the way to a career team-by-team split with no
// other accumulation code written.
//
// getPlayerAverages below is the exception — it is hand-written and does NOT
// iterate this array, so a new key needs its rate adding there deliberately.
// oreb/dreb are carried ALONGSIDE rebounds, which stays the total. Nothing
// that reads `rebounds` today — career milestones, triple-doubles, the awards
// race, the record book — needs to know the split exists.
const SEASON_STAT_KEYS = ['points', 'rebounds', 'oreb', 'dreb', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'minutes', 'oppFga', 'oppFgm',
  'insideFga', 'insideFgm', 'midFga', 'midFgm', 'plusMinus'];

// context carries { leagueYear, day } — the two things a feat record needs and
// the game object does not have. All three call sites pass it; the call-site
// guard in scripts/validate-feats.js asserts they do.
function recordGameResult(game, context) {
  const homeTeam = _LEAGUE_DATA.teams.getTeamById(game.homeTeamId);
  const awayTeam = _LEAGUE_DATA.teams.getTeamById(game.awayTeamId);
  homeTeam.record.pointsFor = (homeTeam.record.pointsFor || 0) + game.homeScore;
  homeTeam.record.pointsAgainst = (homeTeam.record.pointsAgainst || 0) + game.awayScore;
  awayTeam.record.pointsFor = (awayTeam.record.pointsFor || 0) + game.awayScore;
  awayTeam.record.pointsAgainst = (awayTeam.record.pointsAgainst || 0) + game.homeScore;
  if (game.homeScore > game.awayScore) {
    homeTeam.record.wins += 1;
    awayTeam.record.losses += 1;
  } else {
    awayTeam.record.wins += 1;
    homeTeam.record.losses += 1;
  }
  recordGameFeats(game, context);
  recordGameTakeovers(game, context);
  game.recap = composeGameRecap(game, homeTeam, awayTeam);
}

// How many five-man units a team keeps for a whole season.
//
// Measured over a real 82 games rather than guessed. A team fields 88 distinct
// fives across a season, and the tail is worthless: ranked by minutes, #1 plays
// 421, #10 plays 97, #20 plays 45, and #30 plays eight minutes across the whole
// year. Twenty keeps every unit a GM could have an opinion about.
//
// The stored row deliberately omits `key` — the object it hangs off is already
// keyed by it, and the key is five full player ids, 84 of the 191 bytes a naive
// row costs. Dropping it and rounding `seconds` off its 18 digits of float
// noise takes the league from ~250KB of save to ~110KB, against the ~150KB of
// box scores save.js already keeps.
const TEAM_LINEUP_KEEP = 20;

// Merges one game's units into each team's running season totals. The engine
// hands over only its busiest fives per game (gameSim.js caps that too), so a
// unit has to actually play to survive both filters.
//
// Only the possession engine produces lineups; under the box-score engine
// result.lineups is undefined and this no-ops, exactly like playByPlay.
function bankLineups(result) {
  if (!result.lineups || !result.lineups.length) return;
  const touched = {};
  result.lineups.forEach(function (row) {
    const team = _LEAGUE_DATA.teams.getTeamById(row.teamId);
    if (!team) return;
    if (!team.lineupStats) team.lineupStats = {};
    touched[row.teamId] = team;
    const existing = team.lineupStats[row.key];
    if (existing) {
      existing.seconds = Math.round((existing.seconds + row.seconds) * 10) / 10;
      existing.pointsFor += row.pointsFor;
      existing.pointsAgainst += row.pointsAgainst;
      existing.possessions += row.possessions;
      existing.games += 1;
    } else {
      team.lineupStats[row.key] = {
        seconds: Math.round(row.seconds * 10) / 10, pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst, possessions: row.possessions, games: 1
      };
    }
  });
  // Pruned after every game rather than at season end: the whole point of the
  // cap is that the object never grows without bound, and a cap applied only at
  // the end would let it do exactly that for 82 games first.
  Object.keys(touched).forEach(function (teamId) {
    const store = touched[teamId].lineupStats;
    const keys = Object.keys(store);
    if (keys.length <= TEAM_LINEUP_KEEP) return;
    keys.sort(function (a, b) { return store[b].seconds - store[a].seconds; })
      .slice(TEAM_LINEUP_KEEP)
      .forEach(function (k) { delete store[k]; });
  });
}

// The leading scorer on one side, as { name, line } — or null if nobody on
// that side has a line, which happens for a forfeit-shaped box score.
function topScorerAmong(boxScore, playerIds) {
  let best = null;
  playerIds.forEach(function (id) {
    const line = boxScore[id];
    if (!line) return;
    if (!best || line.points > best.line.points) {
      const player = getPlayerById(id);
      if (player) best = { name: player.name, line: line };
    }
  });
  return best;
}

// One sentence about a game, composed WHEN IT IS PLAYED rather than on demand.
//
// That timing is the whole design. save.js prunes boxScore and playByPlay down
// to the user's own games, so a recap derived later would exist for one team
// out of thirty and the league news would be empty for everyone else — which
// is the single loudest complaint aimed at this genre. A sentence survives the
// pruning because it is text.
//
// Pure and at file scope so it can be tested without a season; returns null
// rather than a placeholder when there is nothing to describe, so callers can
// tell "no recap" from "a recap that says nothing".
function composeGameRecap(game, homeTeam, awayTeam) {
  if (!game.boxScore || !homeTeam || !awayTeam) return null;
  const homeIds = getTeamRoster(game.homeTeamId).map(function (p) { return p.id; });
  const awayIds = getTeamRoster(game.awayTeamId).map(function (p) { return p.id; });
  const homeWon = game.homeScore > game.awayScore;
  const winner = homeWon ? homeTeam : awayTeam;
  const loser = homeWon ? awayTeam : homeTeam;
  const margin = Math.abs(game.homeScore - game.awayScore);

  // "hold on for" a one-possession game, "beat" a normal one, "run away with"
  // a blowout — the verb is the only place the shape of the game shows up
  // without spending another clause on it.
  const verb = margin <= 3 ? 'edge' : (margin >= 20 ? 'rout' : 'beat');
  let text = winner.name + ' ' + verb + ' ' + loser.name + ' ' +
    Math.max(game.homeScore, game.awayScore) + '-' + Math.min(game.homeScore, game.awayScore) + '.';

  const winnerTop = topScorerAmong(game.boxScore, homeWon ? homeIds : awayIds);
  const loserTop = topScorerAmong(game.boxScore, homeWon ? awayIds : homeIds);
  if (winnerTop) {
    text += ' ' + winnerTop.name + ' led with ' + winnerTop.line.points + ' points';
    if (winnerTop.line.rebounds >= 10 || winnerTop.line.assists >= 10) {
      text += ' and ' + (winnerTop.line.rebounds >= winnerTop.line.assists
        ? winnerTop.line.rebounds + ' rebounds'
        : winnerTop.line.assists + ' assists');
    }
    text += '.';
  }
  if (loserTop && loserTop.line.points >= 30) {
    text += ' ' + loserTop.name + '\'s ' + loserTop.line.points + ' was not enough.';
  }
  // The one notable thing, if there was one. Takeovers already ride on the
  // finished game, so this costs nothing to read.
  if (game.takeovers && game.takeovers.length) {
    const biggest = game.takeovers.reduce(function (best, t) {
      return (!best || (t.points || 0) > (best.points || 0)) ? t : best;
    }, null);
    if (biggest && biggest.playerName && (biggest.points || 0) > 0) {
      // The man who took over is usually also the leading scorer, and naming
      // him twice in three sentences reads like a template rather than a
      // report.
      // Either side's named scorer counts — a losing star can be the one who
      // took over, and "Kawhi Leonard's 55 was not enough. Kawhi Leonard took
      // the game over" is the same repetition from the other direction.
      const namedWinner = winnerTop && winnerTop.name === biggest.playerName;
      const namedLoser = loserTop && loserTop.line.points >= 30 && loserTop.name === biggest.playerName;
      const alreadyNamed = namedWinner || namedLoser;
      text += (alreadyNamed ? ' He' : ' ' + biggest.playerName) +
        ' took the game over, ' + biggest.points + ' of them in the run.';
    }
  }
  return text;
}

// Takeovers are produced by gameSim.js and carried on the finished game, so
// unlike feats there is nothing to detect here — only to file. Filed from the
// same one function every finished game passes through, for the same reason:
// there are three call sites (regular season, playoff series, play-in) and a
// rule written inside one of them binds only that one.
function recordGameTakeovers(game, context) {
  if (!game.takeovers || !game.takeovers.length || !context) return;
  _historyDeps().history.recordTakeovers(game.takeovers, {
    leagueYear: context.leagueYear,
    day: context.day
  });
}

// Every finished game in the league passes through here — regular season,
// playoff series, play-in, and the game the user watches live — which is why
// detection hangs off this function rather than off any one caller.
function recordGameFeats(game, context) {
  if (!game.boxScore || !context) return;
  const homeIds = getTeamRoster(game.homeTeamId).map(function (p) { return p.id; });
  Object.keys(game.boxScore).forEach(function (playerId) {
    const player = getPlayerById(playerId);
    if (!player) return;
    const onHome = homeIds.indexOf(playerId) !== -1;
    const found = _LEAGUE_DATA.feats.detectFeats(game.boxScore[playerId], {
      leagueYear: context.leagueYear,
      day: context.day,
      playerId: playerId,
      playerName: player.name,
      teamId: onHome ? game.homeTeamId : game.awayTeamId,
      oppTeamId: onHome ? game.awayTeamId : game.homeTeamId
    });
    _historyDeps().history.recordFeats(found);
    // pushToFeed and featShortLabel are browser globals from script.js and
    // ui/feats.js — guarded because league.js also runs standalone under Node
    // in every validate script, where neither exists.
    if (typeof pushToFeed === 'function' && typeof featShortLabel === 'function') {
      found.forEach(function (f) {
        pushToFeed(f.playerName + ' — ' + featShortLabel(f.kind).toLowerCase() + ': ' +
          f.points + ' pts, ' + f.rebounds + ' reb, ' + f.assists + ' ast.', context.day);
      });
    }
  });
}

// Lazily required for the same reason _simDeps() is: careerHistory.js
// requires league.js back (for SEASON_STAT_KEYS/getPlayerAverages), so an
// eager require here would deadlock on the cycle at module-load time.
function _historyDeps() {
  return (typeof require !== 'undefined')
    ? { careerHistory: require('./careerHistory.js'), history: require('./history.js') }
    : {
        careerHistory: {
          checkAndUpdateCareerHighs: checkAndUpdateCareerHighs,
          recordInjuryInHistory: recordInjuryInHistory,
          recordInjuryReturn: recordInjuryReturn
        },
        history: { recordFeats: recordFeats, recordTakeovers: recordTakeovers }
      };
}

function accumulateSeasonStats(playerId, statLine) {
  const player = getPlayerById(playerId);
  if (!player.seasonStats) {
    player.seasonStats = { gamesPlayed: 0 };
    SEASON_STAT_KEYS.forEach(function (k) { player.seasonStats[k] = 0; });
    // A brand-new season's stats have not been banked into careerStats yet.
    // generateNewSeason clears this too; belt and braces, because whichever
    // runs first, a fresh stat line must never be treated as already counted.
    player.seasonStatsRolled = false;
  }
  player.seasonStats.gamesPlayed += 1;
  // Seeds the ACCUMULATOR as well as guarding the addend. The object is only
  // built from SEASON_STAT_KEYS when it is absent entirely, so a save made
  // before a key was added carries a seasonStats that is present but short
  // that field — and `undefined + 0` is NaN, which JSON then stores as null
  // and reads back as 0, silently resetting the stat on every load.
  SEASON_STAT_KEYS.forEach(function (k) {
    player.seasonStats[k] = (player.seasonStats[k] || 0) + (statLine[k] || 0);
  });
  _historyDeps().careerHistory.checkAndUpdateCareerHighs(player, statLine);
}

function getPlayerAverages(player) {
  const s = player.seasonStats;
  if (!s || s.gamesPlayed === 0) {
    return { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, tpPct: 0, ftPct: 0, mpg: 0,
      insideFgPct: 0, midFgPct: 0, insideRate: 0, midRate: 0, threeRate: 0, dfgPct: 0, pmpg: 0 };
  }
  // A player can have a season with no attempt from a zone — a rim-running
  // centre takes no threes all year — so every zone rate guards its own
  // denominator rather than leaning on the total.
  const fga = s.fga || 0;
  return {
    ppg: s.points / s.gamesPlayed,
    rpg: s.rebounds / s.gamesPlayed,
    // Both ends of the glass. `|| 0` because getPlayerAverages is hand-written
    // and does NOT iterate SEASON_STAT_KEYS, so a save written before the split
    // existed reaches here with the field simply absent.
    orpg: (s.oreb || 0) / s.gamesPlayed,
    drpg: (s.dreb || 0) / s.gamesPlayed,
    apg: s.assists / s.gamesPlayed,
    spg: s.steals / s.gamesPlayed,
    bpg: s.blocks / s.gamesPlayed,
    fgPct: s.fga > 0 ? s.fgm / s.fga : 0,
    tpPct: s.tpa > 0 ? s.tpm / s.tpa : 0,
    ftPct: s.fta > 0 ? s.ftm / s.fta : 0,
    mpg: s.minutes / s.gamesPlayed,
    // Shooting by zone. The three-point pair is tpm/tpa, already above as
    // tpPct — repeated here as a SHARE so the three zone rates sum to 1.
    insideFgPct: s.insideFga > 0 ? s.insideFgm / s.insideFga : 0,
    midFgPct: s.midFga > 0 ? s.midFgm / s.midFga : 0,
    insideRate: fga > 0 ? (s.insideFga || 0) / fga : 0,
    midRate: fga > 0 ? (s.midFga || 0) / fga : 0,
    threeRate: fga > 0 ? (s.tpa || 0) / fga : 0,
    // What he allowed as the assigned shot defender. Banked since oppFga/oppFgm
    // were added and never once displayed.
    dfgPct: s.oppFga > 0 ? s.oppFgm / s.oppFga : 0,
    pmpg: (s.plusMinus || 0) / s.gamesPlayed
  };
}

// godMode.js requires league.js back (getTeamRoster), so this is resolved
// lazily like _simDeps() to avoid a load-order deadlock.
function _godModeDeps() {
  return (typeof require !== 'undefined')
    ? require('./godMode.js')
    : { applyAutoWin: applyAutoWin };
}

// Everything AFTER a game's result is known: score recording, finances,
// season stats, fatigue, morale, injuries. Split out from simulateDate so the
// day loop reads as "get a result, then book it" rather than one long body.
function applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng) {
  _godModeDeps().applyAutoWin(game.homeTeamId, game.awayTeamId, result, rng);
  game.played = true;
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.boxScore = result.boxScore;
  // Only the possession engine produces this (simEngineBoxScore.js's
  // simulateGame result has no playByPlay field, so this is undefined —
  // and stays undefined — for games simmed under that engine).
  game.playByPlay = result.playByPlay || null;
  // Same story as playByPlay: only the possession engine produces takeovers, so
  // this is an empty list under the box-score engine. It has to be copied onto
  // the game BEFORE recordGameResult, which is what files it into league
  // history — the result object does not survive this function.
  game.takeovers = result.takeovers || [];
  // Five-man units go onto the TEAMS, not onto the game. A lineup is a
  // season-long question ("which five should be closing?") and putting it on
  // the game would send it through save.js's box-score pruning, which keeps
  // only the user's own games — twenty-nine teams would have no units at all.
  bankLineups(result);

  recordGameResult(game, { leagueYear: leagueYear, day: dayIndex });

  const homeWon = game.homeScore > game.awayScore;
  deps.finances.tickFinancesForTeamGame(game.homeTeamId, homeWon, _LEAGUE_DATA.teams.getTeamById);
  deps.finances.tickFinancesForTeamGame(game.awayTeamId, !homeWon, _LEAGUE_DATA.teams.getTeamById);

  if (result.boxScore) {
    Object.keys(result.boxScore).forEach(function (playerId) {
      accumulateSeasonStats(playerId, result.boxScore[playerId]);
    });
    const minutesByPlayerId = {};
    Object.keys(result.boxScore).forEach(function (playerId) { minutesByPlayerId[playerId] = result.boxScore[playerId].minutes; });
    const isBackToBackHome = season.games.some(function (g) { return g.played && (g.homeTeamId === game.homeTeamId || g.awayTeamId === game.homeTeamId) && g.day === dayIndex - 1; });
    const isBackToBackAway = season.games.some(function (g) { return g.played && (g.homeTeamId === game.awayTeamId || g.awayTeamId === game.awayTeamId) && g.day === dayIndex - 1; });
    deps.fatigue.applyFatigueForGame(game.homeTeamId, minutesByPlayerId, isBackToBackHome);
    deps.fatigue.applyFatigueForGame(game.awayTeamId, minutesByPlayerId, isBackToBackAway);
    deps.morale.tickMoraleForTeamGame(game.homeTeamId, homeWon, minutesByPlayerId);
    deps.morale.tickMoraleForTeamGame(game.awayTeamId, !homeWon, minutesByPlayerId);
  }

  [game.homeTeamId, game.awayTeamId].forEach(function (teamId) {
    const rosterBeforeDecrement = getTeamRoster(teamId).map(function (p) {
      return { player: p, injuryBefore: p.status.injury };
    });
    deps.injuries.decrementInjuriesForTeamGame(teamId);
    rosterBeforeDecrement.forEach(function (entry) {
      if (entry.injuryBefore && !entry.player.status.injury) {
        const actualRecoveryDays = entry.injuryBefore.gamesOut * deps.injuries.GAMES_TO_DAYS;
        _historyDeps().careerHistory.recordInjuryReturn(entry.player, leagueYear, actualRecoveryDays);
      }
    });
    getTeamRoster(teamId).forEach(function (p) {
      const wasInjured = !!p.status.injury;
      deps.injuries.rollInjury(p, rng);
      if (!wasInjured && p.status.injury) {
        newInjuries.push({ playerId: p.id, teamId: teamId, severity: p.status.injury.severity });
        const tier = deps.injuries.INJURY_SEVERITY_TIER[p.status.injury.severity] || 'minor';
        const estimatedRecoveryDays = p.status.injury.gamesOut >= 999 ? null : p.status.injury.gamesOut * deps.injuries.GAMES_TO_DAYS;
        const record = _historyDeps().careerHistory.recordInjuryInHistory(p, 'In-game injury', tier, estimatedRecoveryDays, leagueYear);
        if (record) record.gamesOut = p.status.injury.gamesOut;
      }
    });
    playingTeamIds[teamId] = true;
  });
}

function simulateDate(season, dayIndex, settings, rng, onDayComplete, watchOptions) {
  const deps = _simDeps();
  const leagueYear = (settings && settings.leagueYear) || 2026;
  const todaysGames = season.games.filter(function (g) { return g.day === dayIndex && !g.played; });
  const playingTeamIds = {};
  const newInjuries = [];

  todaysGames.forEach(function (game) {
    // The watched game (Watch Next Game — ui/pixelGameView.js) always sims
    // through the possession engine regardless of the active engine setting:
    // a game simmed without possessions can't be watched. Event capture is
    // proven drift-free by scripts/validate-pixel-events.js, so the recorded
    // result is a normal possession-engine result.
    let result;
    if (watchOptions && watchOptions.live && game.id === watchOptions.gameId) {
      // Live-watched: create the sim, do NOT step it, do NOT record anything.
      // The view steps it (under user decisions) and calls finish() below.
      //
      // Its own rng, seeded by ONE draw from the league rng: stepping happens
      // over minutes of wall clock, interleaved with autosaves, so a watched
      // game sharing the league rng would make the league's future depend on
      // when the user happened to click, and would let a mid-watch save
      // capture an rng state from inside a game that was never recorded.
      const watchRng = deps.rng.makeRng(Math.floor(rng() * 2147483647));
      const sim = deps.gameSim.createGameSim(game.homeTeamId, game.awayTeamId, watchRng,
        { events: watchOptions.events });
      let finished = false;
      watchOptions.liveGame = {
        sim: sim,
        game: game,
        finish: function () {
          if (finished) return false;
          finished = true;
          const lateInjuries = [];
          const latePlaying = {};
          applyGameResult(game, sim.result(), deps, season, dayIndex, leagueYear, latePlaying, lateInjuries, rng);
          // The day's other results already went to the feed when this
          // function's caller returned; this game's news lands when it is
          // actually decided, which is also when the user learns it.
          if (onDayComplete) onDayComplete(dayIndex, [game], lateInjuries);
          return true;
        }
      };
      playingTeamIds[game.homeTeamId] = true;
      playingTeamIds[game.awayTeamId] = true;
      return;
    }
    if (watchOptions && !watchOptions.live && game.id === watchOptions.gameId) {
      const watchEngine = deps.simEngine.getActiveEngine({ simEngine: 'possession' });
      result = watchEngine.simulateGame(game.homeTeamId, game.awayTeamId, rng, { events: watchOptions.events });
    } else {
      const engine = deps.simEngine.getActiveEngine(settings);
      result = engine.simulateGame(game.homeTeamId, game.awayTeamId, rng);
    }
    applyGameResult(game, result, deps, season, dayIndex, leagueYear, playingTeamIds, newInjuries, rng);
  });

  _LEAGUE_DATA.teams.TEAMS.forEach(function (team) {
    if (!playingTeamIds[team.id]) {
      deps.fatigue.decayFatigueForRest(team.id, 1);
    }
  });

  if (onDayComplete) onDayComplete(dayIndex, todaysGames, newInjuries);
  return todaysGames;
}

function getNextGameDay(season, teamId, afterDay) {
  const upcoming = season.games
    .filter(function (g) { return !g.played && g.day > afterDay && (g.homeTeamId === teamId || g.awayTeamId === teamId); })
    .sort(function (a, b) { return a.day - b.day; });
  return upcoming.length > 0 ? upcoming[0].day : null;
}

function simulateNextDay(season, currentDay, settings, rng, onDayComplete) {
  const nextDay = currentDay + 1;
  simulateDate(season, nextDay, settings, rng, onDayComplete);
  return nextDay;
}

function simulateThroughDate(season, currentDay, targetDay, settings, rng, onDayComplete) {
  let day = currentDay;
  while (day < targetDay) {
    day += 1;
    simulateDate(season, day, settings, rng, onDayComplete);
  }
  return day;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEASON_STAT_KEYS: SEASON_STAT_KEYS,
    getTeamRoster: getTeamRoster,
    getTeamPayroll: getTeamPayroll,
    getTeamDeadMoney: getTeamDeadMoney,
    getActiveRoster: getActiveRoster,
    getPlayerById: getPlayerById,
    recordGameResult: recordGameResult,
    bankLineups: bankLineups,
    TEAM_LINEUP_KEEP: TEAM_LINEUP_KEEP,
    accumulateSeasonStats: accumulateSeasonStats,
    getPlayerAverages: getPlayerAverages,
    simulateDate: simulateDate,
    getNextGameDay: getNextGameDay,
    simulateNextDay: simulateNextDay,
    simulateThroughDate: simulateThroughDate
  };
}
