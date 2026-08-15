// The single module that knows both the scene world and the game world.
//
// Reads game state into the flat fact object scenes are written against, and
// writes a chosen effect back out. Everything else in the dialogue system is
// deliberately ignorant of one side or the other; this is where that ignorance
// is paid for.

var _DIALOGUE_DATA = (typeof require !== 'undefined')
  ? {
      teams: require('./teams.js'),
      league: require('./league.js'),
      gmCareer: require('./gmCareer.js'),
      names: require('./names.js'),
      faces: require('./faces.js'),
      ultimates: require('./ultimates.js')
    }
  : {
      teams: { getTeamById: getTeamById, TEAMS: TEAMS },
      league: { getTeamRoster: getTeamRoster },
      gmCareer: {
        ensureGmCareer: ensureGmCareer,
        addChronicle: addChronicle,
        clampReputation: clampReputation,
        CHRONICLE_KINDS: CHRONICLE_KINDS
      },
      names: { pickUniqueName: pickUniqueName, takenNameSet: takenNameSet },
      faces: { generateFace: generateFace },
      ultimates: { hasUltimate: hasUltimate, chargeThreshold: chargeThreshold }
    };

const RECENT_SCENE_LIMIT = 8;

// --- the halftime hint ----------------------------------------------------
// A player has to have taken enough shots for a bad night to be a bad night
// rather than a small sample. 1-for-3 is three shots; calling it out would
// make the panel look like it was not watching.
const SLUMP_MIN_ATTEMPTS = 8;
const SLUMP_MAX_FG_PCT = 0.35;

// How much of a full meter acting on the hint is worth. Deliberately short of
// a full one: it makes a takeover likely, it does not hand one over. He still
// has to earn the rest in the second half.
const BOOST_CHARGE_FRACTION = 0.6;

// The fallback for a player below the ultimate gate, for whom charge would do
// literally nothing. Roughly twice what a timeout gives (gameSim.js's
// TIMEOUT_ENERGY_RESTORE is 0.12), so the hint always buys something real.
const BOOST_ENERGY_RESTORE = 0.25;

// Deliberately city-free. Team names are mutable — commissioner.js can rename
// a franchise and expansion teams appear mid-save — so an outlet built by
// parsing a team name would go stale or read wrong after a relocation.
const OUTLET_NAMES = [
  'The Beat', 'Courtside Daily', 'Hardwood Report', 'The Tipoff',
  'Baseline Weekly', 'The Press Row', 'Full Court', 'The Rundown',
  'Paint & Perimeter', 'The Second Unit'
];

// Player mode is signalled by the career controller actually holding a
// player — a controller with no controlledPlayerId is the GM path.
function currentRole(gameState) {
  const c = gameState && gameState.playerCareerController;
  return (c && c.controlledPlayerId) ? 'player' : 'gm';
}

function _rand(gameState) {
  return (gameState && gameState.rng) ? gameState.rng : Math.random;
}

function _teamIds(gameState) {
  const t = _DIALOGUE_DATA.teams;
  if (Array.isArray(t.TEAMS)) return t.TEAMS.map(function (x) { return x.id; });
  if (gameState && Array.isArray(gameState.teams)) return gameState.teams.map(function (x) { return x.id; });
  return [gameState && gameState.userTeamId].filter(Boolean);
}

// One reporter per team, generated once and cached on the save. The point of
// caching is characterisation: the writer covering your team is the same
// person every night rather than a new stranger each game.
//
// Reporters are NOT players. They never enter a roster, a draft class, or any
// league listing — they exist only to have a name and a face in a text box.
function ensureReporters(gameState) {
  if (gameState.reporters && typeof gameState.reporters === 'object') return gameState.reporters;
  const rng = _rand(gameState);
  const taken = _DIALOGUE_DATA.names.takenNameSet();
  const out = {};
  _teamIds(gameState).forEach(function (teamId) {
    out[teamId] = {
      id: 'reporter-' + teamId,
      teamId: teamId,
      name: _DIALOGUE_DATA.names.pickUniqueName(rng, taken),
      outlet: OUTLET_NAMES[Math.floor(rng() * OUTLET_NAMES.length)],
      face: _DIALOGUE_DATA.faces.generateFace(rng)
    };
  });
  gameState.reporters = out;
  return out;
}

function reporterForTeam(gameState, teamId) {
  const all = ensureReporters(gameState);
  // An id the cache predates (expansion, relocation) falls back to the user's
  // own beat rather than returning null and leaving the box nameless.
  return all[teamId] || all[gameState.userTeamId] || all[Object.keys(all)[0]] || null;
}

function _teamName(teamId) {
  const t = _DIALOGUE_DATA.teams.getTeamById ? _DIALOGUE_DATA.teams.getTeamById(teamId) : null;
  return (t && t.name) || teamId;
}

// The top scorer on the USER's side, not in the game. A scene about your own
// roster should never name the opponent's best player.
function _topScorer(sim, userIsHome) {
  const box = userIsHome ? sim.homeBox : sim.awayBox;
  const roster = userIsHome ? sim.homeRoster : sim.awayRoster;
  let bestId = null;
  let best = -1;
  Object.keys(box || {}).forEach(function (id) {
    const pts = (box[id] && box[id].points) || 0;
    if (pts > best) { best = pts; bestId = id; }
  });
  const player = (roster || []).filter(function (p) { return p.id === bestId; })[0];
  return { name: (player && player.name) || 'Your best player', points: Math.max(0, best) };
}

function _baseContext(gameState, sim) {
  const userIsHome = sim.homeTeamId === gameState.userTeamId;
  const userScore = userIsHome ? sim.homeScore : sim.awayScore;
  const opponentScore = userIsHome ? sim.awayScore : sim.homeScore;
  const opponentId = userIsHome ? sim.awayTeamId : sim.homeTeamId;
  const top = _topScorer(sim, userIsHome);
  return {
    role: currentRole(gameState),
    userIsHome: userIsHome,
    teamId: gameState.userTeamId,
    teamName: _teamName(gameState.userTeamId),
    opponentId: opponentId,
    opponentName: _teamName(opponentId),
    userScore: userScore,
    opponentScore: opponentScore,
    margin: Math.abs(userScore - opponentScore),
    topScorerName: top.name,
    topScorerPoints: top.points,
    isPlayoff: !!gameState.playoffBracket,
    roster: _DIALOGUE_DATA.league.getTeamRoster
      ? _DIALOGUE_DATA.league.getTeamRoster(gameState.userTeamId)
      : []
  };
}

// The margin the user led by at the end of the third, if they led and then
// lost. Zero in every other case, including a sim with no period history —
// a batch sim, or a save written before period scores existed.
function _leadBlown(sim, userIsHome, userLost) {
  if (!userLost || !Array.isArray(sim.periodScores)) return 0;
  const third = sim.periodScores.filter(function (r) { return r.period === 3; })[0];
  if (!third) return 0;
  const userThird = userIsHome ? third.home : third.away;
  const oppThird = userIsHome ? third.away : third.home;
  return Math.max(0, userThird - oppThird);
}

function buildPostgameContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  const userWon = base.userScore > base.opponentScore;
  base.moment = 'postgame';
  base.userWon = userWon;
  base.userLost = !userWon;
  base.leadBlown = _leadBlown(sim, base.userIsHome, !userWon);
  base.streak = (gameState.season && gameState.season.streak) || 0;
  base.seasonWins = (gameState.season && gameState.season.wins) || 0;
  base.seasonLosses = (gameState.season && gameState.season.losses) || 0;
  return base;
}

// The man on YOUR side having the worst shooting night, if anyone qualifies.
// Only your own side: naming the opponent's cold shooter as your problem is
// nonsense, and it would aim the boost at the wrong team.
function _slumpingPlayer(sim, userIsHome) {
  const box = userIsHome ? sim.homeBox : sim.awayBox;
  const roster = userIsHome ? sim.homeRoster : sim.awayRoster;
  let worstId = null;
  let worstPct = 1;
  Object.keys(box || {}).forEach(function (id) {
    const line = box[id];
    if (!line || (line.fga || 0) < SLUMP_MIN_ATTEMPTS) return;
    const pct = (line.fgm || 0) / line.fga;
    if (pct > SLUMP_MAX_FG_PCT) return;
    if (pct < worstPct) { worstPct = pct; worstId = id; }
  });
  if (!worstId) return null;
  const player = (roster || []).filter(function (p) { return p.id === worstId; })[0];
  const line = box[worstId];
  return {
    id: worstId,
    name: (player && player.name) || 'your starter',
    fgm: line.fgm || 0,
    fga: line.fga,
    points: line.points || 0
  };
}

function buildHalftimeContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  base.moment = 'halftime';
  base.leading = base.userScore > base.opponentScore;
  base.trailing = base.userScore < base.opponentScore;

  // The hint the studio panel plants and one of the coach's instructions acts
  // on. Null when nobody is struggling, which is what keeps the panel honest.
  const slump = _slumpingPlayer(sim, base.userIsHome);
  base.slumpId = slump ? slump.id : null;
  base.slumpName = slump ? slump.name : null;
  base.slumpFgm = slump ? slump.fgm : null;
  base.slumpFga = slump ? slump.fga : null;
  base.slumpPoints = slump ? slump.points : null;
  return base;
}

function _nudgeMorale(player, delta) {
  if (!player || !player.status || typeof player.status.morale !== 'number') return;
  player.status.morale = Math.max(0, Math.min(100, player.status.morale + delta));
}

// Acting on the halftime hint. Charge for a player who can actually take over,
// energy for one who cannot — below the ultimate gate charge does nothing at
// all, so without the fallback the hint would sometimes pay out nothing.
//
// Refuses anyone who is not on the user's own side. That is the most damaging
// bug this mechanic could have: buying the opponent a takeover.
function _applyHalftimeBoost(sim, playerId, userIsHome) {
  if (!sim || !playerId) return false;
  const box = userIsHome ? sim.homeBox : sim.awayBox;
  const roster = userIsHome ? sim.homeRoster : sim.awayRoster;
  const line = box && box[playerId];
  if (!line) return false;

  const player = (roster || []).filter(function (p) { return p.id === playerId; })[0];
  const ults = _DIALOGUE_DATA.ultimates;
  const canTakeOver = !!(player && ults.hasUltimate && ults.hasUltimate(player));

  if (canTakeOver && ults.chargeThreshold) {
    const threshold = ults.chargeThreshold(line.takeoversUsed || 0);
    line.charge = Math.min(threshold * 0.99, (line.charge || 0) + threshold * BOOST_CHARGE_FRACTION);
  } else {
    line.energy = Math.min(1, (line.energy || 0) + BOOST_ENERGY_RESTORE);
  }
  return true;
}

// The single interpreter of an effect description. Scenes return these; only
// this function touches game state, which is what keeps the scene library
// testable with no game at all.
//
// `opts.sim` is supplied only by the halftime caller, which is the one moment
// a live game exists to nudge. Every other caller passes nothing and the
// boost channel simply does not fire.
function applyDialogueEffect(gameState, desc, ctx, opts) {
  const applied = [];
  if (!desc || typeof desc !== 'object') return { applied: applied };
  const roster = (ctx && ctx.roster) || [];

  if (typeof desc.teamMorale === 'number') {
    roster.forEach(function (p) { _nudgeMorale(p, desc.teamMorale); });
    applied.push('teamMorale');
  }

  if (typeof desc.playerMorale === 'number') {
    const id = gameState.playerCareerController && gameState.playerCareerController.controlledPlayerId;
    const me = roster.filter(function (p) { return p.id === id; })[0];
    _nudgeMorale(me, desc.playerMorale);
    applied.push('playerMorale');
  }

  if (typeof desc.reputation === 'number') {
    const career = _DIALOGUE_DATA.gmCareer.ensureGmCareer(gameState);
    if (career) {
      career.reputation = _DIALOGUE_DATA.gmCareer.clampReputation(career.reputation + desc.reputation);
      applied.push('reputation');
    }
  }

  if (typeof desc.chronicle === 'string' && desc.chronicle.length > 0) {
    const career = _DIALOGUE_DATA.gmCareer.ensureGmCareer(gameState);
    if (career) {
      _DIALOGUE_DATA.gmCareer.addChronicle(career, gameState.leagueYear,
        _DIALOGUE_DATA.gmCareer.CHRONICLE_KINDS.PRESS, desc.chronicle);
      applied.push('chronicle');
    }
  }

  if (desc.boostPlayer && opts && opts.sim) {
    const userIsHome = ctx && typeof ctx.userIsHome === 'boolean'
      ? ctx.userIsHome
      : opts.sim.homeTeamId === gameState.userTeamId;
    if (_applyHalftimeBoost(opts.sim, desc.boostPlayer, userIsHome)) applied.push('boostPlayer');
  }

  if (desc.recordDecision) {
    const c = gameState.playerCareerController;
    if (c && typeof c.recordDecision === 'function') {
      c.recordDecision('dialogue', String(desc.recordDecision), 'resolved');
      applied.push('recordDecision');
    }
  }

  return { applied: applied };
}

function pushRecentScene(gameState, sceneId) {
  if (!Array.isArray(gameState.recentDialogueScenes)) gameState.recentDialogueScenes = [];
  gameState.recentDialogueScenes.push(sceneId);
  while (gameState.recentDialogueScenes.length > RECENT_SCENE_LIMIT) {
    gameState.recentDialogueScenes.shift();
  }
  return gameState.recentDialogueScenes;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RECENT_SCENE_LIMIT: RECENT_SCENE_LIMIT,
    SLUMP_MIN_ATTEMPTS: SLUMP_MIN_ATTEMPTS,
    SLUMP_MAX_FG_PCT: SLUMP_MAX_FG_PCT,
    BOOST_CHARGE_FRACTION: BOOST_CHARGE_FRACTION,
    BOOST_ENERGY_RESTORE: BOOST_ENERGY_RESTORE,
    // Re-exported so a test can assert "less than a free takeover" without
    // reaching into ultimates.js for the number.
    CHARGE_FULL: _DIALOGUE_DATA.ultimates.chargeThreshold
      ? _DIALOGUE_DATA.ultimates.chargeThreshold(0)
      : 200,
    OUTLET_NAMES: OUTLET_NAMES,
    currentRole: currentRole,
    ensureReporters: ensureReporters,
    reporterForTeam: reporterForTeam,
    buildPostgameContext: buildPostgameContext,
    buildHalftimeContext: buildHalftimeContext,
    applyDialogueEffect: applyDialogueEffect,
    pushRecentScene: pushRecentScene
  };
}
