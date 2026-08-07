// Game-level state machine for the possession engine. simEnginePossession.js
// owns what happens WITHIN a possession; this file owns everything about the
// game around it — score, periods, and (from Task 5 onward) the on-court five,
// the clock, and overtime. Split out once the state machine was proven
// behaviour-identical, so it had room to grow without turning
// simEnginePossession.js into a grab bag.
var _GAMESIM_DATA = (typeof require !== 'undefined')
  ? { poss: require('./simEnginePossession.js'), simEngine: require('./simEngine.js'), composite: require('./compositeRatings.js') }
  : {
      poss: {
        POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
        simulatePossession: simulatePossession,
        eligibleRoster: eligibleRoster,
        initBoxLine: initBoxLine,
        simulateTeamMinutes: simulateTeamMinutes
      },
      simEngine: { registerEngine: registerEngine },
      composite: { computeTeamSynergy: computeTeamSynergy }
    };

// The game-level state machine. step() advances exactly one possession pair
// (home, then away) — the same unit the old for-loop body covered, so RNG
// consumption order is unchanged. simulatePossessionGame below is now just a
// loop over it, which means batch sims and (later) live-stepped watched games
// run through ONE code path and cannot drift apart.
function createGameSim(homeTeamId, awayTeamId, rng, options) {
  const homeRoster = _GAMESIM_DATA.poss.eligibleRoster(homeTeamId);
  const awayRoster = _GAMESIM_DATA.poss.eligibleRoster(awayTeamId);

  // teamId stamps which side each line belongs to — see simEngineBoxScore.js's
  // comment for why the player's current teamId isn't good enough.
  const homeBox = {};
  homeRoster.forEach(function (p) { homeBox[p.id] = Object.assign(_GAMESIM_DATA.poss.initBoxLine(), { teamId: homeTeamId }); });
  const awayBox = {};
  awayRoster.forEach(function (p) { awayBox[p.id] = Object.assign(_GAMESIM_DATA.poss.initBoxLine(), { teamId: awayTeamId }); });

  const homeMinutes = _GAMESIM_DATA.poss.simulateTeamMinutes(homeRoster);
  const awayMinutes = _GAMESIM_DATA.poss.simulateTeamMinutes(awayRoster);
  homeRoster.forEach(function (p) { homeBox[p.id].minutes = homeMinutes[p.id]; });
  awayRoster.forEach(function (p) { awayBox[p.id].minutes = awayMinutes[p.id]; });

  // Synergy depends only on roster composition, not anything that changes
  // possession-to-possession, so it's computed once per game.
  const homeSynergy = _GAMESIM_DATA.composite.computeTeamSynergy(homeRoster);
  const awaySynergy = _GAMESIM_DATA.composite.computeTeamSynergy(awayRoster);

  const playByPlay = [];
  const POSSESSIONS_PER_QUARTER = Math.ceil(_GAMESIM_DATA.poss.POSSESSIONS_PER_TEAM / 4);
  // Structured events for the pixel game view — only collected when the
  // caller asks (Watch Next Game passes { events: [] }); a normal season sim
  // never pays the allocation cost.
  const captureEvents = options && options.events ? options.events : null;

  const sim = {
    homeTeamId: homeTeamId,
    awayTeamId: awayTeamId,
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    homeBox: homeBox,
    awayBox: awayBox,
    homeScore: 0,
    awayScore: 0,
    possessionIndex: 0,
    quarter: 1,
    done: false,
    playByPlay: playByPlay
  };

  sim.step = function () {
    if (sim.done) return;
    const i = sim.possessionIndex;
    const quarter = Math.floor(i / POSSESSIONS_PER_QUARTER) + 1;
    sim.quarter = quarter;
    if (i % POSSESSIONS_PER_QUARTER === 0) {
      playByPlay.push('--- Q' + quarter + ' ---');
    }
    const homeCtx = captureEvents ? { events: captureEvents, team: 'home', quarter: quarter } : null;
    const awayCtx = captureEvents ? { events: captureEvents, team: 'away', quarter: quarter } : null;
    sim.homeScore += _GAMESIM_DATA.poss.simulatePossession(homeRoster, homeBox, awayRoster, awayBox, rng, { offense: homeSynergy, defense: awaySynergy }, playByPlay, homeCtx);
    sim.awayScore += _GAMESIM_DATA.poss.simulatePossession(awayRoster, awayBox, homeRoster, homeBox, rng, { offense: awaySynergy, defense: homeSynergy }, playByPlay, awayCtx);

    sim.possessionIndex += 1;
    if (sim.possessionIndex >= _GAMESIM_DATA.poss.POSSESSIONS_PER_TEAM) {
      resolveTie();
      sim.done = true;
    }
  };

  function resolveTie() {
    if (sim.homeScore !== sim.awayScore) return;
    // NBA games can't end in a tie — nudge whichever team had more makes.
    // (Task 7 replaces this with real overtime.)
    const homeMakes = Object.keys(homeBox).reduce(function (s, id) { return s + homeBox[id].fgm; }, 0);
    const awayMakes = Object.keys(awayBox).reduce(function (s, id) { return s + awayBox[id].fgm; }, 0);
    if (homeMakes >= awayMakes) {
      homeBox[homeRoster[0].id].points += 1; sim.homeScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'home', quarter: 4, playerId: homeRoster[0].id, points: 1 });
    } else {
      awayBox[awayRoster[0].id].points += 1; sim.awayScore += 1;
      if (captureEvents) captureEvents.push({ type: 'tiebreak', team: 'away', quarter: 4, playerId: awayRoster[0].id, points: 1 });
    }
  }

  sim.result = function () {
    return {
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
      boxScore: Object.assign({}, homeBox, awayBox),
      playByPlay: playByPlay
    };
  };

  return sim;
}

// Named distinctly from simEngineBoxScore.js's own simulateGame — see that
// file's comment on this same function name for why. Play-by-play is always
// generated (the string-building cost is negligible next to the possession
// math that already runs regardless) rather than gated behind a flag —
// storage is what's expensive, and that's pruned at save time the same way
// save.js already prunes box scores down to just the user's own games.
function simulatePossessionGame(homeTeamId, awayTeamId, rng, options) {
  const sim = createGameSim(homeTeamId, awayTeamId, rng, options);
  while (!sim.done) sim.step();
  return sim.result();
}

_GAMESIM_DATA.simEngine.registerEngine('possession', { simulateGame: simulatePossessionGame });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGameSim: createGameSim,
    simulateGame: simulatePossessionGame
  };
}
