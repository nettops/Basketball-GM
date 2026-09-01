// What the league remembers about you, and about the clubs you play.
//
// NOTHING NEW IS RECORDED HERE. history.js's archiveTrade has always written
// every trade with its participants, the players in it and which way each one
// moved, and gmCareer's chronicle has always kept a line for every season,
// award, draft and press answer. Both are saved. The gap the audit found was
// never storage — it was that nobody ever asked either of them a question.
//
// So this is a READ, like gmAgenda.js. It turns a pile of archived rows into
// the one sentence that matters when you are about to play somebody:
//
//     "Three years ago you sent them Ray Alvarez."
//
// PERFORMANCE. A twenty-season career archives roughly 600 trades — thirty a
// season — so a filter over that is well under a millisecond and an index
// would be a maintenance burden buying nothing. What it must NOT do is grow
// without bound in the OTHER direction, so every query takes a season horizon
// and a result cap.
var _MEMORY_DATA = (typeof require !== 'undefined')
  ? { history: require('./history.js'), teams: require('./teams.js') }
  : { history: { LEAGUE_HISTORY: typeof LEAGUE_HISTORY !== 'undefined' ? LEAGUE_HISTORY : null },
      teams: { getTeamById: typeof getTeamById !== 'undefined' ? getTeamById : null } };

var MEMORY_TUNING = {
  // How far back a grudge reaches. Beyond about eight seasons a roster has
  // turned over twice and "you traded him here" stops being about anyone still
  // in the building.
  horizonSeasons: 8,
  maxResults: 6
};

function _trades() {
  const H = _MEMORY_DATA.history && _MEMORY_DATA.history.LEAGUE_HISTORY;
  return (H && Array.isArray(H.trades)) ? H.trades : [];
}

// Every trade between two clubs, newest first, inside the horizon.
function tradesBetween(teamA, teamB, opts) {
  const o = opts || {};
  if (!teamA || !teamB || teamA === teamB) return [];
  const horizon = o.horizonSeasons || MEMORY_TUNING.horizonSeasons;
  const now = o.leagueYear;
  const cap = o.maxResults || MEMORY_TUNING.maxResults;
  const all = _trades();
  const out = [];
  // Backwards: newest first, and stop as soon as the cap is full.
  for (let i = all.length - 1; i >= 0 && out.length < cap; i--) {
    const t = all[i];
    const p = t.participants || [];
    if (p.indexOf(teamA) === -1 || p.indexOf(teamB) === -1) continue;
    if (typeof now === 'number' && typeof t.leagueYear === 'number' &&
        now - t.leagueYear > horizon) continue;
    out.push(t);
  }
  return out;
}

// The men you sent to a club, and the men they sent you, across those trades.
// `fromTeamId`/`toTeamId` are already on every archived player row, so this
// reads direction rather than inferring it.
function playerFlow(mineId, theirsId, opts) {
  const sent = [], received = [];
  tradesBetween(mineId, theirsId, opts).forEach(function (t) {
    (t.players || []).forEach(function (pl) {
      if (pl.fromTeamId === mineId && pl.toTeamId === theirsId) {
        sent.push({ name: pl.playerName, playerId: pl.playerId, leagueYear: t.leagueYear });
      } else if (pl.fromTeamId === theirsId && pl.toTeamId === mineId) {
        received.push({ name: pl.playerName, playerId: pl.playerId, leagueYear: t.leagueYear });
      }
    });
  });
  return { sent: sent, received: received };
}

function _seasonsAgo(then, now) {
  if (typeof then !== 'number' || typeof now !== 'number') return null;
  return Math.max(0, now - then);
}

function _agoPhrase(n) {
  if (n === null) return '';
  if (n <= 0) return 'this season';
  if (n === 1) return 'last season';
  return n + ' seasons ago';
}

// The sentence. Returns null when there is genuinely no history, because a
// memory system that always has something to say is just a caption.
function historyLineWith(mineId, theirsId, opts) {
  const flow = playerFlow(mineId, theirsId, opts);
  const o = opts || {};
  const them = (_MEMORY_DATA.teams.getTeamById && _MEMORY_DATA.teams.getTeamById(theirsId));
  const theirName = (them && them.name) || theirsId;
  // Lead with the most recent thing that happened, whichever direction it went.
  const newest = flow.sent.concat(flow.received)
    .sort(function (a, b) { return (b.leagueYear || 0) - (a.leagueYear || 0); })[0];
  if (!newest) return null;
  const ago = _agoPhrase(_seasonsAgo(newest.leagueYear, o.leagueYear));
  const wasSent = flow.sent.some(function (p) { return p.playerId === newest.playerId; });
  const verb = wasSent ? 'you sent them ' : 'they sent you ';
  let line = (ago ? ago.charAt(0).toUpperCase() + ago.slice(1) + ' ' : '') + verb + newest.name + '.';
  const total = flow.sent.length + flow.received.length;
  if (total > 1) line += ' ' + total + ' players have changed hands between you and the ' + theirName + '.';
  return line;
}

// Does this club have real history with mine, or have we simply both existed?
function hasHistoryWith(mineId, theirsId, opts) {
  return tradesBetween(mineId, theirsId, opts).length > 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MEMORY_TUNING: MEMORY_TUNING,
    tradesBetween: tradesBetween,
    playerFlow: playerFlow,
    historyLineWith: historyLineWith,
    hasHistoryWith: hasHistoryWith
  };
}
