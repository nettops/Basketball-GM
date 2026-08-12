// History superlatives. Every toy is a standalone function returning a ranked
// array — no shared state, no rendering — so each can be tested against a
// constructed history with a known right answer, and adding one is an addition
// rather than a new branch in something that already works.
var _TOYS_DATA = (typeof require !== 'undefined')
  ? { history: require('./history.js'), players: require('./players-2026.js'), teams: require('./teams.js') }
  : {
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { getTeamById: getTeamById, TEAMS: TEAMS }
    };

// A plain counting proxy, chosen because it exists for every player including
// retirees. It is NOT a claim about value — a rebound is not a point — and the
// UI labels it "production" rather than implying otherwise.
function careerProduction(careerStats) {
  if (!careerStats) return 0;
  return (careerStats.points || 0) + (careerStats.rebounds || 0) + (careerStats.assists || 0);
}

const AWARD_MVP = 'mvp';

function countMvps(awardsWon) {
  return (awardsWon || []).filter(function (a) { return a.award === AWARD_MVP; }).length;
}

// Active players AND retirees. Retirees alone would leave every list empty for
// the first fifteen seasons of a save, which is most of the time anyone will
// look at them. Keyed by id so a player who is somehow in both is counted once.
function candidatePool() {
  const byId = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    byId[p.id] = {
      playerId: p.id,
      name: p.name,
      production: careerProduction(p.careerStats),
      championships: p.championshipsWon || 0,
      mvps: countMvps(p.awardsWon),
      hofScore: 0,
      hallOfFame: false,
      retired: false
    };
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    byId[r.id] = {
      playerId: r.id,
      name: r.name,
      production: careerProduction(r.careerStats),
      championships: r.championshipsWon || 0,
      mvps: countMvps(r.awardsWon),
      hofScore: r.hofScore || 0,
      hallOfFame: !!r.hallOfFame,
      retired: true
    };
  });
  return Object.keys(byId).map(function (id) { return byId[id]; });
}

// Where the line between a bust and a steal falls. A lottery-adjacent number
// rather than the lottery itself: being taken 11th is not an indictment.
const BUST_PICK_CUTOFF = 10;

// Every pick ever made, joined to that player's career.
function pickRows() {
  const pool = {};
  candidatePool().forEach(function (c) { pool[c.playerId] = c; });
  const rows = [];
  _TOYS_DATA.history.LEAGUE_HISTORY.draftClasses.forEach(function (cls) {
    (cls.picks || []).forEach(function (pick) {
      const c = pool[pick.playerId];
      rows.push({
        leagueYear: cls.leagueYear,
        pickNumber: pick.pickNumber,
        round: pick.round,
        teamId: pick.teamId,
        playerId: pick.playerId,
        name: pick.playerName,
        production: c ? c.production : 0
      });
    });
  });
  return rows;
}

function biggestBusts(limit) {
  return pickRows()
    .filter(function (r) { return r.pickNumber <= BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return a.production - b.production; })
    .slice(0, limit || 10);
}

function biggestSteals(limit) {
  return pickRows()
    .filter(function (r) { return r.pickNumber > BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

function bestPlayerAtEveryPick() {
  const best = {};
  pickRows().forEach(function (r) {
    if (!best[r.pickNumber] || r.production > best[r.pickNumber].production) best[r.pickNumber] = r;
  });
  return Object.keys(best)
    .map(function (n) { return best[n]; })
    .sort(function (a, b) { return a.pickNumber - b.pickNumber; });
}

function draftClassRankings() {
  const byYear = {};
  pickRows().forEach(function (r) {
    if (!byYear[r.leagueYear]) byYear[r.leagueYear] = { leagueYear: r.leagueYear, production: 0, picks: 0 };
    byYear[r.leagueYear].production += r.production;
    byYear[r.leagueYear].picks += 1;
  });
  return Object.keys(byYear)
    .map(function (y) { return byYear[y]; })
    .sort(function (a, b) { return b.production - a.production; });
}

function bestWithoutARing(limit) {
  return candidatePool()
    .filter(function (c) { return c.championships === 0; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

function bestWithoutAnMvp(limit) {
  return candidatePool()
    .filter(function (c) { return c.mvps === 0; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

// The longest unbroken spell with one franchise, and the money. Both read
// careerHistory for an active player, and the two scalars archiveRetiree banks
// for a retired one — the retiree archive does not keep careerHistory, and
// without those scalars these two lists would forget a career the moment it
// ended, which is exactly backwards for a history toy.
function longestSpell(teamHistory) {
  let best = 0, bestTeam = null;
  (teamHistory || []).forEach(function (s) {
    const years = s.seasons || 0;
    if (years > best) { best = years; bestTeam = s.teamId; }
  });
  return { years: best, teamId: bestTeam };
}

function totalEarnings(contractHistory) {
  return (contractHistory || []).reduce(function (sum, c) {
    return sum + (c.salary || 0) * (c.yearsRemaining || 0);
  }, 0);
}

function mostYearsOneTeam(limit) {
  const byId = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const spell = longestSpell(p.careerHistory && p.careerHistory.teamHistory);
    if (spell.years > 0) byId[p.id] = { playerId: p.id, name: p.name, years: spell.years, teamId: spell.teamId };
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    if (!r.longestTenure) return;
    byId[r.id] = { playerId: r.id, name: r.name, years: r.longestTenure, teamId: r.longestTenureTeamId || null };
  });
  return Object.keys(byId).map(function (id) { return byId[id]; })
    .sort(function (a, b) { return b.years - a.years; }).slice(0, limit || 10);
}

function mostTeams(limit) {
  const byId = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const n = (p.teamsPlayedFor || []).length;
    if (n > 0) byId[p.id] = { playerId: p.id, name: p.name, teams: n };
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    const n = (r.teamsPlayedFor || []).length;
    if (n > 0) byId[r.id] = { playerId: r.id, name: r.name, teams: n };
  });
  return Object.keys(byId).map(function (id) { return byId[id]; })
    .sort(function (a, b) { return b.teams - a.teams; }).slice(0, limit || 10);
}

// Salary times years for every contract ever signed. Reads contractHistory
// rather than the current contract, so a career is summed and not a snapshot.
function careerEarnings(limit) {
  const byId = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const total = totalEarnings(p.careerHistory && p.careerHistory.contractHistory);
    if (total > 0) byId[p.id] = { playerId: p.id, name: p.name, earnings: total };
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    if (!r.careerEarnings) return;
    byId[r.id] = { playerId: r.id, name: r.name, earnings: r.careerEarnings };
  });
  return Object.keys(byId).map(function (id) { return byId[id]; })
    .sort(function (a, b) { return b.earnings - a.earnings; }).slice(0, limit || 10);
}

// Every family in league history, one row per pair.
//
// Active players AND retirees, for the same reason every other toy here reads
// both — and more sharply, because families take the better part of twenty
// seasons to appear, by which time half of any pair has usually retired.
// Reading only the active league showed one of the three families in a real
// twenty-season save and silently dropped the other two.
//
// Links are written on both players, so a pair would otherwise be listed twice;
// keyed on the sorted pair of ids.
function families() {
  const seen = {};
  const out = [];
  const all = _TOYS_DATA.players.PLAYERS_2026
    .concat(_TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers);
  all.forEach(function (p) {
    ((p && p.relatives) || []).forEach(function (r) {
      const key = [p.id, r.playerId].sort().join('|');
      if (seen[key]) return;
      seen[key] = true;
      out.push({ a: p.name, aId: p.id, b: r.name, bId: r.playerId, type: r.type });
    });
  });
  return out;
}

// The nearly-men: the highest Hall of Fame scores that fell short of induction.
// Retirees only, and necessarily so — an active player has no verdict yet.
function hallOfVeryGood(limit) {
  return _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers
    .filter(function (r) { return !r.hallOfFame; })
    .map(function (r) { return { playerId: r.id, name: r.name, hofScore: r.hofScore || 0 }; })
    .sort(function (a, b) { return b.hofScore - a.hofScore; })
    .slice(0, limit || 10);
}

// slice() every time: handing back the array LEAGUE_HISTORY holds would let a
// caller's sort silently reorder the stored history.
function teamSeasonRows() {
  return _TOYS_DATA.history.LEAGUE_HISTORY.teamSeasons.slice();
}

function bestTeams(limit) {
  return teamSeasonRows().sort(function (a, b) { return b.wins - a.wins; }).slice(0, limit || 10);
}

function worstTeams(limit) {
  return teamSeasonRows().sort(function (a, b) { return a.wins - b.wins; }).slice(0, limit || 10);
}

function bestToMissThePlayoffs(limit) {
  return teamSeasonRows()
    .filter(function (r) { return r.playoffResult === 'missed'; })
    .sort(function (a, b) { return b.wins - a.wins; })
    .slice(0, limit || 10);
}

function worstToWinIt(limit) {
  return teamSeasonRows()
    .filter(function (r) { return r.champion; })
    .sort(function (a, b) { return a.wins - b.wins; })
    .slice(0, limit || 10);
}

// A verdict on a trade needs time. Anything younger than this is not judged at
// all, rather than judged on partial evidence and then remembered wrongly.
const LOPSIDED_MIN_SEASONS = 3;

// Production a player recorded in seasons STRICTLY AFTER the trade year. What
// he did before the trade belongs to whoever had him then, not to the trade.
function productionAfter(playerId, afterYear) {
  const player = _TOYS_DATA.players.PLAYERS_2026.find(function (p) { return p.id === playerId; });
  const byYear = (player && player.careerHistory && player.careerHistory.seasonByYear) || {};
  return Object.keys(byYear).reduce(function (sum, year) {
    if (Number(year) <= afterYear) return sum;
    const s = byYear[year];
    return sum + (s.points || 0) + (s.rebounds || 0) + (s.assists || 0);
  }, 0);
}

// currentYear is passed rather than read from a global so the rule is testable.
function tradeVerdicts(currentYear) {
  return _TOYS_DATA.history.LEAGUE_HISTORY.trades
    .filter(function (t) { return currentYear - t.leagueYear >= LOPSIDED_MIN_SEASONS; })
    .map(function (t) {
      const bySide = {};
      (t.participants || []).forEach(function (teamId) { bySide[teamId] = 0; });
      (t.players || []).forEach(function (p) {
        if (bySide[p.toTeamId] === undefined) bySide[p.toTeamId] = 0;
        bySide[p.toTeamId] += productionAfter(p.playerId, t.leagueYear);
      });
      const totals = Object.keys(bySide).map(function (k) { return bySide[k]; });
      const combined = totals.reduce(function (a, b) { return a + b; }, 0);
      const difference = totals.length < 2
        ? 0
        : Math.abs(Math.max.apply(null, totals) - Math.min.apply(null, totals));
      return {
        trade: t, leagueYear: t.leagueYear, participants: (t.participants || []).slice(),
        bySide: bySide, combined: combined, difference: difference
      };
    });
}

function biggestTrades(limit, currentYear) {
  return tradeVerdicts(currentYear)
    .sort(function (a, b) { return b.combined - a.combined; })
    .slice(0, limit || 10);
}

function mostLopsidedTrades(limit, currentYear) {
  return tradeVerdicts(currentYear)
    .sort(function (a, b) { return b.difference - a.difference; })
    .slice(0, limit || 10);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    careerProduction: careerProduction,
    teamSeasonRows: teamSeasonRows,
    bestTeams: bestTeams,
    worstTeams: worstTeams,
    bestToMissThePlayoffs: bestToMissThePlayoffs,
    worstToWinIt: worstToWinIt,
    productionAfter: productionAfter,
    tradeVerdicts: tradeVerdicts,
    biggestTrades: biggestTrades,
    mostLopsidedTrades: mostLopsidedTrades,
    LOPSIDED_MIN_SEASONS: LOPSIDED_MIN_SEASONS,
    longestSpell: longestSpell,
    totalEarnings: totalEarnings,
    bestWithoutARing: bestWithoutARing,
    bestWithoutAnMvp: bestWithoutAnMvp,
    mostYearsOneTeam: mostYearsOneTeam,
    mostTeams: mostTeams,
    careerEarnings: careerEarnings,
    families: families,
    hallOfVeryGood: hallOfVeryGood,
    candidatePool: candidatePool,
    pickRows: pickRows,
    biggestBusts: biggestBusts,
    biggestSteals: biggestSteals,
    bestPlayerAtEveryPick: bestPlayerAtEveryPick,
    draftClassRankings: draftClassRankings,
    BUST_PICK_CUTOFF: BUST_PICK_CUTOFF
  };
}
