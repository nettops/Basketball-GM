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
      ultimates: require('./ultimates.js'),
      morale: require('./morale.js'),
      rivalries: require('./rivalries.js'),
      owner: require('./owner.js'),
      data: require('./data.js')
    }
  : {
      teams: { getTeamById: getTeamById, TEAMS: TEAMS },
      league: { getTeamRoster: getTeamRoster, getTeamPayroll: getTeamPayroll },
      gmCareer: {
        ensureGmCareer: ensureGmCareer,
        addChronicle: addChronicle,
        clampReputation: clampReputation,
        CHRONICLE_KINDS: CHRONICLE_KINDS
      },
      names: { pickUniqueName: pickUniqueName, takenNameSet: takenNameSet },
      faces: { generateFace: generateFace },
      ultimates: { hasUltimate: hasUltimate, chargeThreshold: chargeThreshold },
      morale: { moraleTier: moraleTier },
      rivalries: { rivalsOf: rivalsOf },
      owner: { currentPatience: currentPatience },
      data: { getEffectiveLuxuryTaxLine: getEffectiveLuxuryTaxLine, tradeDeadlineDay: tradeDeadlineDay }
    };

const RECENT_SCENE_LIMIT = 8;

// Mid-season scenes remember by DAY, not by a recent-list, and that is a
// correctness fix rather than a style choice.
//
// A postgame scene is tied to a result that will not recur in the same shape,
// so a list of "the last eight" is right for it. A mid-season scene is tied to
// a SITUATION that recurs by nature: a club on a losing run in November is on
// another one in February, and that is a different conversation. Any
// list-of-N deadlocks the moment only one scene matches a given club — which
// is the common case, not the edge case. Measured on a 10-28 club: exactly one
// scene fired on day 10 and the system then sat silent for forty-five days
// with its one matching predicate permanently in the list.
//
// A per-scene day stamp cannot deadlock: the worst case is the same
// conversation every three weeks, which is what a club in a long slump would
// actually get.
const SEASON_SCENE_COOLDOWN_DAYS = 21;

// And a hard ceiling on how often ONE conversation can happen in a season.
//
// The cooldown alone was not enough. Twenty-one days into a hundred-and-thirty
// day season permits six repeats, and a playtester got exactly that: the owner
// asking about the tax bill FOUR TIMES, word for word, same three answers, in
// a single year. The system's best feature became its most tiring one inside
// one season — "the writing's strength curdles into its weakness".
//
// Twice is the most a season should hear any one of these. A recurring
// situation genuinely can come round again — a slump in November and another
// in February really are two conversations — but a third is the game running
// out of things to say and admitting it.
const SEASON_SCENE_MAX_PER_SEASON = 2;

// Ids that may not fire right now: either inside the cooldown, or already used
// up for the season. Handed to selectScene as its `recent`, so the engine needs
// no idea any of this exists.
function recentSeasonScenes(gameState) {
  const stamps = gameState.seasonSceneDays;
  if (!stamps) return [];
  const counts = gameState.seasonSceneCounts || {};
  const day = (gameState.season && gameState.season.currentDay) || 0;
  return Object.keys(stamps).filter(function (id) {
    if ((counts[id] || 0) >= SEASON_SCENE_MAX_PER_SEASON) return true;
    return day - stamps[id] < SEASON_SCENE_COOLDOWN_DAYS;
  });
}

function stampSeasonScene(gameState, sceneId) {
  if (!gameState.seasonSceneDays) gameState.seasonSceneDays = {};
  if (!gameState.seasonSceneCounts) gameState.seasonSceneCounts = {};
  gameState.seasonSceneDays[sceneId] = (gameState.season && gameState.season.currentDay) || 0;
  gameState.seasonSceneCounts[sceneId] = (gameState.seasonSceneCounts[sceneId] || 0) + 1;
  return gameState.seasonSceneDays;
}

// Unhappiness uses morale.js's OWN tier, not a number invented here.
//
// It briefly did use a local threshold, on the measurement that nothing in the
// league ever reached the 'unhappy' band. That measurement was taken 38 games
// into a season and was simply too early — but chasing it turned up the real
// bug, which was in the morale tick rather than the tier, and it is fixed. One
// definition of unhappy now serves the dashboard panel and these scenes alike.

// How many answers the press remembers. Bounded because it is saved, and
// because a reporter who can quote you from nine years ago is not a reporter,
// he is a database — the useful range is "the thing you said last month".
const PRESS_MEMORY_LIMIT = 12;

// --- the halftime hint ----------------------------------------------------
// A player has to have taken enough shots for a bad night to be a bad night
// rather than a small sample. 1-for-3 is three shots; calling it out would
// make the panel look like it was not watching.
const SLUMP_MIN_ATTEMPTS = 8;
const SLUMP_MAX_FG_PCT = 0.35;

// How much of a full meter acting on the hint is worth, and the ceiling it
// cannot push past.
//
// The ceiling is the load-bearing one. Without it the boost topped players out
// at 99% of the meter whenever they had already banked a little charge, and
// measured over 40 games that produced a takeover 6 times out of 6 — not a
// nudge but a guarantee. At 0.82 he still has to earn the last stretch, which
// is a couple of good possessions rather than a formality.
const BOOST_CHARGE_FRACTION = 0.6;
const BOOST_CHARGE_CEILING = 0.82;

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
  const base = {
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
  // Memory rides along with every other fact, so any scene's `when` can reach
  // it without dialogueScenes.js knowing memory exists.
  return Object.assign(base, pressMemoryFacts(gameState));
}

// Signed run of results: +4 is four straight wins, -4 four straight losses.
//
// Derived from the schedule rather than tracked on the team, for the reason
// ui/dashboard.js already gives about its own form strip — a separately stored
// streak is a second source of truth that drifts the first time a game is
// re-simmed or a save is loaded mid-run.
function _currentStreak(gameState, teamId) {
  const games = ((gameState.season && gameState.season.games) || [])
    .filter(function (g) {
      return g.played && (g.homeTeamId === teamId || g.awayTeamId === teamId);
    })
    .sort(function (a, b) { return a.day - b.day; });
  if (games.length === 0) return 0;
  const won = function (g) {
    return g.homeTeamId === teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore;
  };
  const lastWon = won(games[games.length - 1]);
  let run = 0;
  for (let i = games.length - 1; i >= 0 && won(games[i]) === lastWon; i--) run += 1;
  return lastWon ? run : -run;
}

// A season in progress, with no game attached.
//
// Every other context in this file is built FROM a finished or half-finished
// sim. This one is not: mid-season scenes fire between games, during an
// unwatched Continue run, which is precisely the stretch that had nothing in
// it. Sixty games of clicking Continue was the single loudest finding of the
// playtest, and the reason was simple — every scene the game owned needed a
// `sim` to exist, and a batch-simmed day never produces one you are looking at.
//
// Reads only the league state that is already there. Nothing here is stored,
// so a save written before mid-season scenes existed builds this context fine.
function buildSeasonContext(gameState) {
  const teamId = gameState.userTeamId;
  const team = _DIALOGUE_DATA.teams.getTeamById(teamId);
  const roster = _DIALOGUE_DATA.league.getTeamRoster
    ? _DIALOGUE_DATA.league.getTeamRoster(teamId) : [];
  const record = (team && team.record) || { wins: 0, losses: 0 };
  const played = record.wins + record.losses;

  // The unhappiest man on the roster who is actually worth worrying about.
  // Sorting by morale alone hands you the fifteenth man every time; a rotation
  // player sulking is a story, the third-string centre is not.
  let unhappy = null;
  roster.forEach(function (p) {
    const morale = (p.status && p.status.morale);
    if (typeof morale !== 'number' || _DIALOGUE_DATA.morale.moraleTier(morale) !== 'unhappy') return;
    if (!unhappy || (p.rawOverall || 0) > (unhappy.rawOverall || 0)) unhappy = p;
  });

  const injured = roster.filter(function (p) { return p.status && p.status.injury; })
    .sort(function (a, b) { return (b.rawOverall || 0) - (a.rawOverall || 0); });

  // Where the club sits in its own conference, and whether that is a playoff
  // place. Counted off wins rather than through playoffs.js's seeding, which
  // wants a finished season — mid-February a club only needs to know if it is
  // in the eight, and by how much.
  const conf = (team && team.conference) || '';
  const rivalsInConf = _DIALOGUE_DATA.teams.TEAMS.filter(function (t) {
    return t.conference === conf;
  }).sort(function (a, b) { return (b.record.wins || 0) - (a.record.wins || 0); });
  let rank = rivalsInConf.length;
  for (let i = 0; i < rivalsInConf.length; i++) {
    if (rivalsInConf[i].id === teamId) { rank = i + 1; break; }
  }
  const PLAYOFF_PLACES = 8;
  const cutoff = rivalsInConf[Math.min(PLAYOFF_PLACES, rivalsInConf.length) - 1];
  const gamesFromCut = cutoff ? Math.abs((cutoff.record.wins || 0) - record.wins) : 0;

  // The season's leading scorer on this roster, if he has played enough for
  // the number to mean anything.
  let leader = null;
  roster.forEach(function (p) {
    const st = p.seasonStats;
    if (!st || !st.gamesPlayed || st.gamesPlayed < 10) return;
    if (!leader || (st.points / st.gamesPlayed) > (leader.seasonStats.points / leader.seasonStats.gamesPlayed)) {
      leader = p;
    }
  });
  const leaderPpg = leader ? leader.seasonStats.points / leader.seasonStats.gamesPlayed : 0;

  // The best young man actually in the rotation. A 20-year-old who never
  // dresses is not a rising core, he is a draft pick.
  let young = null;
  roster.forEach(function (p) {
    const st = p.seasonStats;
    if (!p.age || p.age > 23) return;
    if (!st || !st.gamesPlayed || (st.minutes / st.gamesPlayed) < 18) return;
    if (!young || (p.rawOverall || 0) > (young.rawOverall || 0)) young = p;
  });

  // The club this one actually hates, if any. rivalsOf already applies the
  // heat threshold, so anything it returns is a real rivalry rather than two
  // teams that happen to share a calendar.
  const rivals = (gameState.rivalries && _DIALOGUE_DATA.rivalries.rivalsOf)
    ? _DIALOGUE_DATA.rivalries.rivalsOf(gameState.rivalries, teamId) : [];
  const topRival = rivals.sort(function (a, b) { return b.heat - a.heat; })[0] || null;

  // Is the rivalry LIVE, or merely on the books?
  //
  // rivalry-heat used to fire on `!!rivalName` alone — a standing fact, not
  // something that just happened. Every other season scene keys off an event:
  // a losing run, an injury pileup, a career year. At priority 58 a scene that
  // is permanently true outranks everything below it whenever it has cap left,
  // and probe-sceneVolume.js measured the result: running-hot (priority 50,
  // needs a five-game winning run) never fired once across six seasons.
  //
  // A rivalry is topical when you have just played them or are about to. Nine
  // days each way is a little over the 8-day gap between scenes, so a fixture
  // against the rival gets exactly one conversation rather than none or three.
  const RIVAL_GAME_WINDOW_DAYS = 9;
  const rivalGameNear = (function () {
    if (!topRival) return false;
    const day = (gameState.season && gameState.season.currentDay) || 0;
    const list = (gameState.season && gameState.season.games) || [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      const involvesBoth =
        (g.homeTeamId === teamId && g.awayTeamId === topRival.teamId) ||
        (g.awayTeamId === teamId && g.homeTeamId === topRival.teamId);
      if (!involvesBoth) continue;
      if (Math.abs((g.day || 0) - day) <= RIVAL_GAME_WINDOW_DAYS) return true;
    }
    return false;
  })();

  const mandate = gameState.ownerMandate || null;
  const career = gameState.gmCareer;
  const patience = _DIALOGUE_DATA.owner.currentPatience(career, teamId);

  // Games left comes off the schedule rather than a constant, because the
  // schedule is what actually decides it and an expansion league would make a
  // hard-coded 82 a lie.
  const games = (gameState.season && gameState.season.games) || [];
  let mine = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g.homeTeamId === teamId || g.awayTeamId === teamId) mine += 1;
  }

  const base = {
    moment: 'season',
    role: currentRole(gameState),
    teamId: teamId,
    teamName: _teamName(teamId),
    roster: roster,
    seasonWins: record.wins,
    seasonLosses: record.losses,
    gamesPlayed: played,
    gamesLeft: Math.max(0, mine - played),
    streak: _currentStreak(gameState, teamId),
    unhappyName: unhappy ? unhappy.name : '',
    unhappyCount: roster.filter(function (p) {
      return p.status && typeof p.status.morale === 'number' &&
        _DIALOGUE_DATA.morale.moraleTier(p.status.morale) === 'unhappy';
    }).length,
    injuredCount: injured.length,
    injuredName: injured.length > 0 ? injured[0].name : '',
    conferenceRank: rank,
    inPlayoffSpot: rank <= PLAYOFF_PLACES,
    gamesFromCut: gamesFromCut,
    leaderName: leader ? leader.name : '',
    leaderPpg: Math.round(leaderPpg * 10) / 10,
    youngName: young ? young.name : '',
    rivalName: topRival ? _teamName(topRival.teamId) : '',
    rivalHeat: topRival ? Math.round(topRival.heat) : 0,
    rivalGameNear: rivalGameNear,
    // "Soon" is the fortnight before the deadline — the window where buy-or-sell
    // is still a live question. Measured in DAYS off the shared helper, because
    // measuring it in games played put this window a full seventeen days ahead
    // of the deadline the rest of the game observes.
    deadlineSoon: (function () {
      const deadline = _DIALOGUE_DATA.data.tradeDeadlineDay(
        gameState.season && gameState.season.games);
      if (!deadline) return false;
      const day = (gameState.season && gameState.season.currentDay) || 0;
      return day <= deadline && deadline - day <= 14;
    })(),
    mandateLabel: mandate ? mandate.label : '',
    mandateType: mandate ? mandate.type : '',
    // How many more wins the owner's number needs. Zero when the mandate is
    // not a win total, so a scene has to check mandateType before using it.
    winsNeeded: (mandate && mandate.type === 'wins' && typeof mandate.target === 'number')
      ? Math.max(0, mandate.target - record.wins) : 0,
    patience: patience,
    ownerHappiness: Math.round((team && team.ownerHappiness) || 0),
    overTaxLine: !!(team && _DIALOGUE_DATA.league.getTeamPayroll &&
      _DIALOGUE_DATA.league.getTeamPayroll(teamId) >
      _DIALOGUE_DATA.data.getEffectiveLuxuryTaxLine(
        gameState.settings && gameState.settings.capLevel))
  };
  return Object.assign(base, pressMemoryFacts(gameState));
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
//
// Only your own side: naming the opponent's cold shooter as your problem is
// nonsense, and it would aim the boost at the wrong team.
//
// Players who can actually TAKE OVER are preferred over those who cannot, even
// if a deeper bench player shot worse. Two reasons, and they point the same
// way: your star struggling is a far better halftime story than your eleventh
// man, and the payoff for acting on the hint is charge — which does nothing
// at all for a player below the ultimate gate. Measured in a real game before
// this rule existed, the panel picked a bench player 3-for-10 and the boost
// silently degraded to an energy bump nobody would notice.
function _slumpingPlayer(sim, userIsHome) {
  const box = userIsHome ? sim.homeBox : sim.awayBox;
  const roster = userIsHome ? sim.homeRoster : sim.awayRoster;
  const ults = _DIALOGUE_DATA.ultimates;

  const byId = {};
  (roster || []).forEach(function (p) { byId[p.id] = p; });

  let best = null;   // { id, pct, canTakeOver }
  Object.keys(box || {}).forEach(function (id) {
    const line = box[id];
    if (!line || (line.fga || 0) < SLUMP_MIN_ATTEMPTS) return;
    const pct = (line.fgm || 0) / line.fga;
    if (pct > SLUMP_MAX_FG_PCT) return;
    const canTakeOver = !!(ults.hasUltimate && ults.hasUltimate(byId[id]));
    if (!best) { best = { id: id, pct: pct, canTakeOver: canTakeOver }; return; }
    // A man who can take over outranks one who cannot, whatever the numbers.
    if (canTakeOver !== best.canTakeOver) {
      if (canTakeOver) best = { id: id, pct: pct, canTakeOver: canTakeOver };
      return;
    }
    if (pct < best.pct) best = { id: id, pct: pct, canTakeOver: canTakeOver };
  });

  if (!best) return null;
  const worstId = best.id;
  const player = byId[worstId];
  const line = box[worstId];
  return {
    id: worstId,
    name: (player && player.name) || 'your starter',
    fgm: line.fgm || 0,
    fga: line.fga,
    points: line.points || 0,
    canTakeOver: best.canTakeOver
  };
}

function buildHalftimeContext(gameState, sim) {
  const base = _baseContext(gameState, sim);
  base.moment = 'halftime';
  base.leading = base.userScore > base.opponentScore;
  base.trailing = base.userScore < base.opponentScore;

  // Two separate things, deliberately.
  //
  // `slump*` is a bad night by anyone on your side. The panel talks about it
  // whether or not anything can be done, because a panel that only ever
  // mentions your one star is a panel that is not watching the game.
  //
  // `boostId` is set ONLY when that man can actually take over, and it is what
  // gates the coach's payoff option. The measured reason: the ultimate gate is
  // 87, so roughly one player per roster qualifies. Offering the payoff for
  // anyone else meant it silently fell back to an energy bump — and for a
  // player already at full energy, to nothing whatsoever. A rare real payoff
  // beats a frequent hollow one.
  const slump = _slumpingPlayer(sim, base.userIsHome);
  base.slumpId = slump ? slump.id : null;
  base.slumpName = slump ? slump.name : null;
  base.slumpFgm = slump ? slump.fgm : null;
  base.slumpFga = slump ? slump.fga : null;
  base.slumpPoints = slump ? slump.points : null;
  base.boostId = (slump && slump.canTakeOver) ? slump.id : null;
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
    const current = line.charge || 0;
    // Never REDUCES. The ceiling caps how far the boost can carry him, not how
    // much charge he is allowed to hold — a player already past it earned that
    // himself, and clamping him down would make acting on the hint a penalty.
    // This was a live bug: Math.min alone made the boost a no-op or worse for
    // exactly the players it was meant to help.
    line.charge = Math.max(current,
      Math.min(threshold * BOOST_CHARGE_CEILING, current + threshold * BOOST_CHARGE_FRACTION));
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

  // The one channel that reaches job security. A mid-season answer that moves
  // the owner meter is what makes the dashboard strip worth glancing at — the
  // stakes it shows have to be something your decisions actually touch, or it
  // is a read-only sticker.
  if (typeof desc.ownerHappiness === 'number') {
    const t = _DIALOGUE_DATA.teams.getTeamById(gameState.userTeamId);
    if (t) {
      t.ownerHappiness = Math.max(0, Math.min(99, (t.ownerHappiness || 0) + desc.ownerHappiness));
      applied.push('ownerHappiness');
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

// What the GM actually SAID, as opposed to which scenes he has been shown.
// pushRecentScene below already stops a scene repeating; this is the other half
// — it lets a scene know it is talking to somebody with a history.
//
// Stored as ids and a tone rather than as prose: the text belongs to
// dialogueScenes.js and may be rewritten, but "he blamed the officials, twice"
// stays true either way.
function rememberAnswer(gameState, sceneId, choice, leagueYear) {
  if (!Array.isArray(gameState.pressMemory)) gameState.pressMemory = [];
  if (!choice || !choice.id) return gameState.pressMemory;
  gameState.pressMemory.push({
    sceneId: sceneId,
    choiceId: choice.id,
    tone: choice.tone || null,
    leagueYear: leagueYear === undefined ? null : leagueYear
  });
  while (gameState.pressMemory.length > PRESS_MEMORY_LIMIT) gameState.pressMemory.shift();
  return gameState.pressMemory;
}

// The memory, reduced to facts a scene's `when` predicate can read. Handed in
// with everything else so dialogueScenes.js stays exactly as pure as it is —
// memory arrives as more facts, never as a new import.
function pressMemoryFacts(gameState) {
  const log = Array.isArray(gameState.pressMemory) ? gameState.pressMemory : [];
  const saidCounts = {};
  const toneCounts = {};
  log.forEach(function (entry) {
    saidCounts[entry.choiceId] = (saidCounts[entry.choiceId] || 0) + 1;
    if (entry.tone) toneCounts[entry.tone] = (toneCounts[entry.tone] || 0) + 1;
  });

  const last = log.length ? log[log.length - 1] : null;
  // How many times in a row the most recent tone has been used. A GM who has
  // been defiant four straight times is a story; one who was defiant once is
  // not.
  let streak = 0;
  for (let i = log.length - 1; i >= 0 && last && log[i].tone === last.tone; i--) streak++;

  return {
    pressAnswers: log.length,
    pressSaidCounts: saidCounts,
    pressToneCounts: toneCounts,
    pressLastTone: last ? last.tone : null,
    pressLastChoiceId: last ? last.choiceId : null,
    pressToneStreak: streak,
    // The common question a scene wants to ask, as a function rather than a
    // key per choice id — a flat key for every possible answer would grow with
    // the scene library forever.
    pressHasSaid: function (choiceId) { return (saidCounts[choiceId] || 0) > 0; }
  };
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
    SEASON_SCENE_COOLDOWN_DAYS: SEASON_SCENE_COOLDOWN_DAYS,
    SEASON_SCENE_MAX_PER_SEASON: SEASON_SCENE_MAX_PER_SEASON,
    recentSeasonScenes: recentSeasonScenes,
    stampSeasonScene: stampSeasonScene,
    PRESS_MEMORY_LIMIT: PRESS_MEMORY_LIMIT,
    rememberAnswer: rememberAnswer,
    pressMemoryFacts: pressMemoryFacts,
    SLUMP_MIN_ATTEMPTS: SLUMP_MIN_ATTEMPTS,
    SLUMP_MAX_FG_PCT: SLUMP_MAX_FG_PCT,
    BOOST_CHARGE_FRACTION: BOOST_CHARGE_FRACTION,
    BOOST_CHARGE_CEILING: BOOST_CHARGE_CEILING,
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
    buildSeasonContext: buildSeasonContext,
    buildHalftimeContext: buildHalftimeContext,
    applyDialogueEffect: applyDialogueEffect,
    pushRecentScene: pushRecentScene
  };
}
