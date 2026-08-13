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

// The three counting stats every player has, including retirees, added
// together. It is NOT a claim about value — a rebound is not a point — it is
// just the fairest cheap way to rank a guard against a centre.
//
// The UI shows the three components rather than this total under an invented
// unit. "24,645 production" tells a reader nothing and cannot be checked
// against anything; "18,200 pts · 4,100 reb · 2,345 ast" says exactly what the
// ranking is made of, so an order that looks odd can be understood on sight.
function careerProduction(careerStats) {
  if (!careerStats) return 0;
  return (careerStats.points || 0) + (careerStats.rebounds || 0) + (careerStats.assists || 0);
}

// The components behind that total, carried alongside it so no caller has to go
// back to the player to render a row.
const PRODUCTION_PARTS = ['points', 'rebounds', 'assists'];

function productionParts(careerStats) {
  const out = {};
  PRODUCTION_PARTS.forEach(function (k) { out[k] = (careerStats && careerStats[k]) || 0; });
  return out;
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
      parts: productionParts(p.careerStats),
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
      parts: productionParts(r.careerStats),
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

// A verdict on a draft pick needs time, exactly as a verdict on a trade does
// (see LOPSIDED_MIN_SEASONS below — same rule, same reason).
//
// Without it "Biggest Busts" is topped by whoever was drafted last week. On a
// real 25-season league, 11 of the 15 names on that page had a career of
// literally zero because 10 of them were drafted that summer and had not
// played a game. That is not a bust, it is a rookie, and calling him the
// biggest bust in league history is the page lying about what it knows.
const DRAFT_VERDICT_MIN_SEASONS = 3;

// "Now", for draft purposes, taken from the archive itself rather than from
// GameState — this module knows nothing about the running game, and a caller
// cannot forget to pass a year it derives for itself.
function latestDraftYear() {
  return _TOYS_DATA.history.LEAGUE_HISTORY.draftClasses.reduce(function (m, c) {
    return Math.max(m, c.leagueYear);
  }, -Infinity);
}

// Picks old enough to be judged. currentYear is overridable so the rule can be
// tested directly instead of by constructing decades of history.
function judgeablePickRows(currentYear) {
  const now = currentYear === undefined ? latestDraftYear() : currentYear;
  return pickRows().filter(function (r) {
    return now - r.leagueYear >= DRAFT_VERDICT_MIN_SEASONS;
  });
}

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
        production: c ? c.production : 0,
        parts: c ? c.parts : productionParts(null)
      });
    });
  });
  return rows;
}

function biggestBusts(limit, currentYear) {
  return judgeablePickRows(currentYear)
    .filter(function (r) { return r.pickNumber <= BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return a.production - b.production; })
    .slice(0, limit || 10);
}

function biggestSteals(limit, currentYear) {
  return judgeablePickRows(currentYear)
    .filter(function (r) { return r.pickNumber > BUST_PICK_CUTOFF; })
    .sort(function (a, b) { return b.production - a.production; })
    .slice(0, limit || 10);
}

function bestPlayerAtEveryPick(currentYear) {
  const best = {};
  judgeablePickRows(currentYear).forEach(function (r) {
    if (!best[r.pickNumber] || r.production > best[r.pickNumber].production) best[r.pickNumber] = r;
  });
  return Object.keys(best)
    .map(function (n) { return best[n]; })
    .sort(function (a, b) { return a.pickNumber - b.pickNumber; });
}

function draftClassRankings(currentYear) {
  const byYear = {};
  judgeablePickRows(currentYear).forEach(function (r) {
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

// Every player's season-by-season production, active AND retired, keyed by id.
//
// Built once per query rather than searched per player per trade: a long save
// has hundreds of trades and a thousand retirees, and a scan inside the loop
// would be a scan inside a loop inside a loop.
//
// Retirees are the load-bearing half. A retired player is spliced out of
// PLAYERS_2026, so looking only there made his contribution silently zero —
// and since a trade is only judged three seasons on, retirement is the normal
// case, not the edge case. archiveRetiree banks productionByYear for exactly
// this.
function productionByYearIndex() {
  const index = {};
  _TOYS_DATA.players.PLAYERS_2026.forEach(function (p) {
    const byYear = (p.careerHistory && p.careerHistory.seasonByYear) || {};
    const out = {};
    Object.keys(byYear).forEach(function (year) {
      const s = byYear[year] || {};
      out[year] = (s.points || 0) + (s.rebounds || 0) + (s.assists || 0);
    });
    index[p.id] = out;
  });
  _TOYS_DATA.history.LEAGUE_HISTORY.retiredPlayers.forEach(function (r) {
    if (r.productionByYear) index[r.id] = r.productionByYear;
  });
  return index;
}

// Production a player recorded in seasons STRICTLY AFTER the trade year. What
// he did before the trade belongs to whoever had him then, not to the trade.
// The index is optional so this stays callable on its own.
function productionAfter(playerId, afterYear, index) {
  const byYear = (index || productionByYearIndex())[playerId] || {};
  return Object.keys(byYear).reduce(function (sum, year) {
    return Number(year) <= afterYear ? sum : sum + byYear[year];
  }, 0);
}

// currentYear is passed rather than read from a global so the rule is testable.
function tradeVerdicts(currentYear) {
  const index = productionByYearIndex();
  return _TOYS_DATA.history.LEAGUE_HISTORY.trades
    .filter(function (t) { return currentYear - t.leagueYear >= LOPSIDED_MIN_SEASONS; })
    .map(function (t) {
      const bySide = {};
      (t.participants || []).forEach(function (teamId) { bySide[teamId] = 0; });
      (t.players || []).forEach(function (p) {
        if (bySide[p.toTeamId] === undefined) bySide[p.toTeamId] = 0;
        bySide[p.toTeamId] += productionAfter(p.playerId, t.leagueYear, index);
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

// How big the NAMES were, measured on the players' whole careers — not on what
// happened next.
//
// This is a different question from the lopsided one and deliberately answered
// differently. "The biggest trade in league history" means the most player
// there has ever been in one deal, which is knowable the moment it happens; it
// needs no waiting period and fills in from a save's first trade. Judging who
// WON is the question that needs time, and mostLopsidedTrades below is the toy
// that waits for it.
function tradeStarPower(limit) {
  const pool = {};
  candidatePool().forEach(function (c) { pool[c.playerId] = c.production; });
  return _TOYS_DATA.history.LEAGUE_HISTORY.trades
    .map(function (t) {
      const bySide = {};
      (t.participants || []).forEach(function (teamId) { bySide[teamId] = 0; });
      (t.players || []).forEach(function (p) {
        if (bySide[p.toTeamId] === undefined) bySide[p.toTeamId] = 0;
        bySide[p.toTeamId] += pool[p.playerId] || 0;
      });
      const combined = Object.keys(bySide).reduce(function (a, k) { return a + bySide[k]; }, 0);
      return {
        trade: t, leagueYear: t.leagueYear, participants: (t.participants || []).slice(),
        bySide: bySide, combined: combined
      };
    })
    .sort(function (a, b) { return b.combined - a.combined; })
    .slice(0, limit || 10);
}

function biggestTrades(limit) {
  return tradeStarPower(limit);
}

function mostLopsidedTrades(limit, currentYear) {
  return tradeVerdicts(currentYear)
    .sort(function (a, b) { return b.difference - a.difference; })
    .slice(0, limit || 10);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    careerProduction: careerProduction,
    productionParts: productionParts,
    PRODUCTION_PARTS: PRODUCTION_PARTS,
    teamSeasonRows: teamSeasonRows,
    bestTeams: bestTeams,
    worstTeams: worstTeams,
    bestToMissThePlayoffs: bestToMissThePlayoffs,
    worstToWinIt: worstToWinIt,
    productionAfter: productionAfter,
    productionByYearIndex: productionByYearIndex,
    tradeStarPower: tradeStarPower,
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
    BUST_PICK_CUTOFF: BUST_PICK_CUTOFF,
    DRAFT_VERDICT_MIN_SEASONS: DRAFT_VERDICT_MIN_SEASONS,
    latestDraftYear: latestDraftYear,
    judgeablePickRows: judgeablePickRows,
    DRAFT_VERDICT_MIN_SEASONS: DRAFT_VERDICT_MIN_SEASONS,
    latestDraftYear: latestDraftYear,
    judgeablePickRows: judgeablePickRows
  };
}
