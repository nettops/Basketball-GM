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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    careerProduction: careerProduction,
    candidatePool: candidatePool,
    pickRows: pickRows,
    biggestBusts: biggestBusts,
    biggestSteals: biggestSteals,
    bestPlayerAtEveryPick: bestPlayerAtEveryPick,
    draftClassRankings: draftClassRankings,
    BUST_PICK_CUTOFF: BUST_PICK_CUTOFF
  };
}
