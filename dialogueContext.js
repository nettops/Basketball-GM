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
      faces: require('./faces.js')
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
      faces: { generateFace: generateFace }
    };

const RECENT_SCENE_LIMIT = 8;

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

function buildHalftimeContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  base.moment = 'halftime';
  base.leading = base.userScore > base.opponentScore;
  base.trailing = base.userScore < base.opponentScore;
  return base;
}

function _nudgeMorale(player, delta) {
  if (!player || !player.status || typeof player.status.morale !== 'number') return;
  player.status.morale = Math.max(0, Math.min(100, player.status.morale + delta));
}

// The single interpreter of an effect description. Scenes return these; only
// this function touches game state, which is what keeps the scene library
// testable with no game at all.
function applyDialogueEffect(gameState, desc, ctx) {
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
