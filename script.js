const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
  // Set by clicking a team in Standings/Power Rankings to browse their
  // roster; null means "show my own team". Deliberately not persisted in
  // save.js (same as profilePlayerId) — it's per-session navigation state,
  // not save data. Cleared whenever the Roster nav item itself is clicked
  // (ui/nav.js), so the sidebar link always means "my roster".
  inspectTeamId: null,
  season: null,
  playoffBracket: null,
  playMode: 'gm', // 'gm' | 'commissioner' | 'spectator'
  automation: { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: false, autoScout: false },
  feed: [],
  draftSession: null,
  tradeOffers: [],
  pauseRequested: false,
  gameMode: null, // null (GM mode) | 'playerCareer'
  playerCareerController: null,
  narrativeSystem: null,
  controlledPlayerId: null,
  // Explicit, opt-in cheat/debug toolkit (godMode.js) — `enabled` gates the
  // UI panel itself, `autoWinEnabled` is the one flag with an always-on
  // background effect (checked from league.js/playoffs.js every game
  // simulated). Persisted like automation flags below, so a save remembers
  // it was on.
  godMode: { enabled: false, autoWinEnabled: false },
  settings: {
    simEngine: 'boxscore', simSpeed: 'normal',
    pauseOn: { madePlayoffs: false, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: false },
    capDisabled: false,
    capLevel: 1,
    injuryFrequency: 1,
    playInEnabled: false,
    autoExpansionEnabled: false,
    leagueYear: 2026
  }
};

// league.js's simulateDate reads the current season year off settings.leagueYear
// (league.js has no access to the GameState global), so every leagueYear
// write must go through this helper to keep the two in sync.
function setLeagueYear(year) {
  GameState.leagueYear = year;
  GameState.settings.leagueYear = year;
}

function pushToFeed(text, dayIndex) {
  // dayIndex is the day actually being processed by the onDayComplete
  // callback this was called from — GameState.season.currentDay isn't
  // updated until the ENTIRE simulateThroughDate call finishes, so during a
  // multi-day bulk sim it's still whatever it was before the run started.
  const day = dayIndex !== undefined ? dayIndex : (GameState.season ? GameState.season.currentDay : null);
  GameState.feed.push({ day: day, leagueYear: GameState.leagueYear || 2026, text: text });
  if (GameState.feed.length > 200) GameState.feed.shift();
}

function initSeason() {
  // GameState.leagueYear was previously left implicitly undefined until the
  // first offseason transition (everything that reads it defensively falls
  // back to `|| 2026`) — but serializeGameState captures the raw value, so
  // any snapshot/save taken during a league's very first season persisted
  // leagueYear: undefined. Explicit init closes that gap at the source.
  setLeagueYear(GameState.leagueYear || 2026);
  GameState.rng = makeRng(Date.now());
  const games = generateSeasonGames(GameState.rng, TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  GameState.season = { games: games, currentDay: -1 };

  ensureHiddenPlayerData(PLAYERS_2026);
  ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
  ensurePlayerFace(PLAYERS_2026);
  ensurePlayerFace(DRAFT_PROSPECTS_2026);
  ensureCareerData(PLAYERS_2026);
  ensureAllTeamsHaveCoaches(GameState.rng);
  GameState.upcomingDraftClass = DRAFT_PROSPECTS_2026;
  GameState.scouting = initScoutingState();
}

// Ticked once per real day advanced (see league.js's onDayComplete hook,
// threaded through simulateNextDay/simulateThroughDate). Playoff series don't
// advance GameState.season.currentDay, so scouting doesn't tick during
// playoffs — a deliberate simplification, since rosters are effectively
// locked in by then anyway.
function tickScoutingForDay(dayIndex) {
  if (!GameState.scouting) return;
  const team = getTeamById(GameState.userTeamId);
  const ownRosterIds = getTeamRoster(GameState.userTeamId).map(function (p) { return p.id; });
  const todaysGames = GameState.season.games.filter(function (g) {
    return g.day === dayIndex && g.played && (g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId);
  });
  let playedOpponentIds = [];
  todaysGames.forEach(function (g) {
    const oppId = g.homeTeamId === GameState.userTeamId ? g.awayTeamId : g.homeTeamId;
    playedOpponentIds = playedOpponentIds.concat(getTeamRoster(oppId).map(function (p) { return p.id; }));
  });
  const prospectIds = (GameState.upcomingDraftClass || []).map(function (p) { return p.id; });
  const lastDay = GameState.season.games.reduce(function (max, g) { return Math.max(max, g.day); }, 0);
  const daysUntilDraft = lastDay - dayIndex;
  tickPassiveScouting(GameState.scouting, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft);
  if (GameState.automation.autoScout) {
    autoAllocateScoutPoints(GameState.scouting, ownRosterIds, prospectIds.filter(function (id) { return GameState.scouting.targets[id] && GameState.scouting.targets[id].watchlisted; }), playedOpponentIds.filter(function (id) { return GameState.scouting.targets[id] && GameState.scouting.targets[id].watchlisted; }));
  }
}

function pushGameResultsToFeed(dayIndex, todaysGames) {
  todaysGames.forEach(function (g) {
    if (!g.played) return;
    const isUserGame = g.homeTeamId === GameState.userTeamId || g.awayTeamId === GameState.userTeamId;
    if (GameState.playMode !== 'spectator' && !isUserGame) return;
    const home = getTeamById(g.homeTeamId);
    const away = getTeamById(g.awayTeamId);
    pushToFeed(away.name + ' ' + g.awayScore + ', ' + home.name + ' ' + g.homeScore, dayIndex);
  });
}

function pushInjuriesToFeed(newInjuries, dayIndex) {
  newInjuries.forEach(function (inj) {
    const player = getPlayerById(inj.playerId);
    const isUserPlayer = inj.teamId === GameState.userTeamId;
    if (GameState.playMode !== 'spectator' && !isUserPlayer && player.overall < 80) return;
    pushToFeed(player.name + ' (' + getTeamById(inj.teamId).name + ') injured: ' + inj.severity, dayIndex);
    if (isUserPlayer && player.overall >= 80 && GameState.settings.pauseOn.keyInjury) {
      GameState.pauseRequested = true;
    }
  });
}

// Weekly (not daily) trade-offer generation for the user's team only — AI-vs-AI
// trading isn't modeled in this batch (see the Phase 7A plan's Global
// Constraints for why).
function runWeeklyTradeGeneration(dayIndex) {
  if (GameState.playMode === 'spectator' || !GameState.userTeamId) return;
  const week = currentWeek(dayIndex);
  if (GameState.lastTradeGenWeek === week) return;
  GameState.lastTradeGenWeek = week;
  const team = getTeamById(GameState.userTeamId);
  const offer = generateTradeOffer(team, GameState.rng);
  if (!offer) return;
  if (GameState.automation.autoTrade) {
    executeTrade(offer.proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); }, dayIndex);
  } else {
    GameState.tradeOffers.push(offer);
    if (GameState.settings.pauseOn.tradeOfferReceived) GameState.pauseRequested = true;
  }
}

// Weekly, independent of play mode (including spectator, where
// runWeeklyTradeGeneration above is a no-op) — AI teams besides the user's
// own now propose and execute trades among themselves, using the same
// generateTradeOffer/evaluateTrade logic already used for AI-vs-user trades.
// The user's team is excluded from the partner search (see autoGM.js's
// generateTradeOffer excludeTeamId comment) since this pass auto-executes
// with no inbox/approval step.
function runWeeklyAIToAITradeGeneration(dayIndex) {
  const week = currentWeek(dayIndex);
  if (GameState.lastAIToAITradeWeek === week) return;
  GameState.lastAIToAITradeWeek = week;
  TEAMS.filter(function (t) { return t.id !== GameState.userTeamId; }).forEach(function (team) {
    const offer = generateTradeOffer(team, GameState.rng, GameState.userTeamId);
    if (!offer) return;
    executeTrade(offer.proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); }, dayIndex);
  });
}

function handleDayComplete(dayIndex, todaysGames, newInjuries) {
  tickScoutingForDay(dayIndex);
  pushGameResultsToFeed(dayIndex, todaysGames || []);
  pushInjuriesToFeed(newInjuries || [], dayIndex);
  runWeeklyTradeGeneration(dayIndex);
  runWeeklyAIToAITradeGeneration(dayIndex);
}

function switchPlayMode(newMode, teamId) {
  if (newMode === 'spectator') {
    // Spectator forces everything automatic, but the user's own toggles are
    // stashed first — previously they were overwritten with `true` and never
    // restored, so switching back to GM left auto free agency / auto draft /
    // auto trade permanently on with no way to tell that had happened.
    if (GameState.playMode !== 'spectator') {
      GameState.automationBeforeSpectator = Object.assign({}, GameState.automation);
    }
    Object.keys(GameState.automation).forEach(function (k) { GameState.automation[k] = true; });
  } else {
    if (!GameState.userTeamId && teamId) {
      GameState.userTeamId = teamId;
    }
    if (GameState.playMode === 'spectator') {
      const restored = GameState.automationBeforeSpectator;
      Object.keys(GameState.automation).forEach(function (k) {
        GameState.automation[k] = restored ? !!restored[k] : false;
      });
      GameState.automationBeforeSpectator = null;
    }
  }
  GameState.playMode = newMode;
  renderView(GameState.currentView);
}

function spectateLeague() {
  GameState.playMode = 'spectator';
  Object.keys(GameState.automation).forEach(function (k) { GameState.automation[k] = true; });
  // Purely cosmetic "camera" team for the feed/dashboard/standings to default
  // to — has zero gameplay effect, so Math.random() here (rather than the
  // seeded rng, which doesn't exist until initSeason() below creates it)
  // doesn't threaten save/load's exact-resume guarantee.
  GameState.userTeamId = TEAMS[Math.floor(Math.random() * TEAMS.length)].id;
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}

// Views with a real renderer this phase. Anything else in NAV_ITEMS (ui/nav.js)
// falls back to the placeholder view.
const BUILT_VIEWS = {
  dashboard: renderDashboard,
  roster: function (container) {
    renderRoster(container, GameState.inspectTeamId || GameState.userTeamId);
  },
  standings: renderStandings,
  powerRankings: renderPowerRankings,
  schedule: renderSchedule,
  playoffs: renderPlayoffs,
  allStarWeekend: renderAllStarWeekend,
  settings: renderSettings,
  trade: renderTradeCenter,
  freeagency: renderFreeAgency,
  draft: function (container) {
    if (GameState.draftSession && currentPick(GameState.draftSession)) {
      renderDraftPicker(container, GameState.draftSession, GameState.userTeamId, handleUserDraftPick);
    } else {
      renderDraftResults(container, GameState.lastDraftResults || []);
    }
  },
  scouting: renderScouting,
  saveload: renderSaveLoad,
  feed: renderLiveFeed,
  commissioner: renderCommissioner,
  awards: renderAwards,
  history: renderHistory,
  seasonSummary: renderSeasonSummary,
  frivolities: renderFrivolities,
  playerProfile: renderPlayerProfile,
  careerLedger: renderCareerLedger,
  playerComparison: renderPlayerComparison,
  news: renderLeagueNews,
  salarycap: renderSalaryCap,
  finances: renderTeamFinances,
  coaching: renderCoaching,
  playerDashboard: function (container) {
    renderPlayerDashboard(container, GameState.controlledPlayerId);
  },
  legacy: renderLegacyView,
  godMode: renderGodMode,
  pixelGame: renderPixelGame
};

function isRegularSeasonAndPlayoffsComplete() {
  return GameState.season && GameState.season.games.every(function (g) { return g.played; })
    && GameState.playoffBracket && GameState.playoffBracket.finals.length > 0 && GameState.playoffBracket.finals[0].complete;
}

// showSummary is true only from the manual "Advance to Offseason" button
// (script.js's renderView wiring) — the two "Skip to Draft/FA" dock shortcuts
// (ui/simControls.js) call this with no argument because the user explicitly
// asked to jump past the recap screen there, straight to the stage they named.
function handleAdvanceToOffseason(showSummary) {
  // Idempotence guard. The "Skip to Draft"/"Skip to Free Agency" controls
  // (ui/simControls.js) both call this unconditionally and stay clickable, so
  // without this a second click re-ran finalizeSeasonHistory for the same year:
  // duplicate entries in LEAGUE_HISTORY.awardsHistory and every winner's
  // awardsWon, allTimeWins/allTimeLosses counted twice, career stats rolled up
  // twice, and leagueYear bumped twice.
  if (GameState.offseasonStage) return;

  // Snapshot before anything about the season that just finished changes —
  // this is what a commissioner's "Rewind to Season N" (ui/commissioner.js)
  // restores.
  pushSeasonSnapshot(GameState);

  // Pending offers reference a roster that retirement, the draft, and free
  // agency are all about to reshape — carrying them into the new league year
  // would let the user accept a trade for a player who no longer exists.
  GameState.tradeOffers = [];

  // Captured before the leagueYear increment below — this is the season whose
  // champion/awards finalizeSeasonHistory is about to archive, and what the
  // season summary screen (if shown) should display.
  const finishedLeagueYear = GameState.leagueYear || 2026;

  // Runs BEFORE the leagueYear increment and before retirement, so
  // finalizeSeasonHistory's award/career-stat rollup reflects the season
  // that just finished, and retirees archived immediately after this see
  // their fully-updated careerStats/awardsWon.
  finalizeSeasonHistory(finishedLeagueYear, GameState.playoffBracket, function (text) { pushToFeed(text); });

  setLeagueYear(finishedLeagueYear + 1);
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;

  if (autoDraftEffective) {
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass, GameState.leagueYear, GameState.settings.lotteryFormat);
    GameState.lastDraftResults = result.draftResults;
    GameState.draftSession = null;
    archiveDraftClass(GameState.leagueYear, result.draftResults);
  } else {
    runOffseasonPreDraft(GameState.rng, GameState.leagueYear);
    const draftOrder = buildDraftOrder(GameState.playoffBracket, GameState.rng, GameState.settings.lotteryFormat);
    GameState.draftSession = startDraftSession(draftOrder, GameState.upcomingDraftClass);
    advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
    if (!currentPick(GameState.draftSession)) {
      GameState.lastDraftResults = GameState.draftSession.results;
      GameState.draftSession = null;
      archiveDraftClass(GameState.leagueYear, GameState.lastDraftResults);
    }
  }

  GameState.offseasonStage = 'draft';
  if (showSummary === true) {
    GameState.summarySeasonYear = finishedLeagueYear;
    renderView('seasonSummary');
  } else {
    renderView('draft');
  }
  autosave(GameState);

  if (GameState.gameMode === 'playerCareer') {
    handlePlayerCareerOffseasonFollowup();
  }
}

// Runs after the standard offseason (progression + retirement rolls +
// auto-draft) completes for a player-career game. Checks whether the
// controlled player retired automatically (rollRetirement in
// seasonTransition.js applies to every rostered player, including a custom
// one) and shows the retirement scene if so; otherwise rolls a random
// narrative event for the season ahead. Overrides the 'draft' view
// handleAdvanceToOffseason already rendered, since a career-mode player
// doesn't need to see the league's rookie draft results.
// Returns true when it rendered a scene the user has to acknowledge (a
// retirement ceremony or a pending random event). runMultiSeason uses that to
// stop fast-forwarding rather than simming straight past it.
// `quiet` suppresses the fall-through renderView for callers driving a loop
// (runMultiSeason) — re-rendering the whole app once per simulated season is
// both wasteful and visibly re-enables the sim dock mid-run.
function handlePlayerCareerOffseasonFollowup(quiet) {
  const container = document.getElementById('view-content');
  const player = getPlayerById(GameState.controlledPlayerId);

  if (!player) {
    const record = LEAGUE_HISTORY.retiredPlayers.slice().reverse()
      .find(function (r) { return r.id === GameState.controlledPlayerId; });
    if (record) {
      GameState.playerLegacy = record;
      renderMilestoneScene(container, 'retirement', {
        playerName: record.name,
        careerStats: record.careerStats,
        championshipsWon: record.championshipsWon,
        hallOfFameEligible: record.hallOfFame
      });
      return true;
    }
    return false;
  }

  // An All-Star nod is the one in-career milestone the league already computes,
  // so it's what the all_star scene keys off. Checked before the random-event
  // roll so a standout season leads with the good news.
  if (wasNamedAllStar(player)) {
    renderMilestoneScene(container, 'all_star', { playerName: player.name, season: GameState.leagueYear });
    return true;
  }

  if (!GameState.randomEventSystem) {
    GameState.randomEventSystem = new RandomEventSystem(GameState);
  }
  const event = GameState.randomEventSystem.triggerRandomEvent(player.id, GameState.leagueYear);
  if (event) {
    GameState.pendingRandomEvent = event;
    renderRandomEventScene(container, event);
    return true;
  }
  if (!quiet) renderView('playerDashboard');
  return false;
}

// Fires once, at the moment the bracket is drawn, when the controlled player's
// team made the playoffs. This is what renderPlayoffScene (ui/narrativeScenes.js)
// exists for — it was written but never called, so the only milestone a career
// player ever saw was their own retirement. Returns true if a scene was shown.
function handlePlayerCareerPlayoffIntro() {
  if (GameState.gameMode !== 'playerCareer' || !GameState.playoffBracket) return false;
  const player = getPlayerById(GameState.controlledPlayerId);
  if (!player || !player.teamId) return false;

  const series = GameState.playoffBracket.first.find(function (s) {
    return s.higherSeed === player.teamId || s.lowerSeed === player.teamId;
  });
  if (!series) return false;

  const opponentId = series.higherSeed === player.teamId ? series.lowerSeed : series.higherSeed;
  const opponent = getTeamById(opponentId);
  renderMilestoneScene(document.getElementById('view-content'), 'playoff', {
    playerName: player.name,
    season: GameState.leagueYear || 2026,
    opponent: opponent ? opponent.name : opponentId,
    round: 'Round 1'
  });
  return true;
}

// allStarWeekend.js owns selection. GameState.allStarWeekend is only populated
// lazily when the user actually opens that view, so this recomputes the roster
// for the player's own conference rather than depending on the user having
// visited the page. selectAllStars returns { starters, reserves } — both are
// arrays of player objects directly, not { player, team } wrappers.
function wasNamedAllStar(player) {
  if (!player || !player.teamId) return false;
  const team = getTeamById(player.teamId);
  if (!team) return false;
  const roster = selectAllStars(team.conference);
  return roster.starters.concat(roster.reserves).some(function (p) {
    return p && p.id === player.id;
  });
}

function retireCareerPlayer() {
  const transition = new PlayerToGMTransition(GameState);
  const record = transition.retirePlayer(GameState.controlledPlayerId);
  // retirePlayer returns null if the player is already gone (e.g. the offseason
  // retirement roll got there first). GameState.playerLegacy would then be
  // stale or absent, and every field read below would throw.
  if (!record) {
    renderView('legacy');
    return;
  }
  const container = document.getElementById('view-content');
  renderMilestoneScene(container, 'retirement', {
    playerName: record.name,
    careerStats: record.careerStats,
    championshipsWon: record.championshipsWon,
    hallOfFameEligible: record.hallOfFame
  });
}

function startGMModeFromLegacy() {
  const transition = new PlayerToGMTransition(GameState);
  transition.transitionToGMMode();
  renderView('dashboard');
}

function dismissNarrativeScene() {
  renderView('playerDashboard');
}

function handleUserDraftPick(prospectId) {
  const prospect = GameState.draftSession.available.find(function (p) { return p.id === prospectId; });
  resolveCurrentPick(GameState.draftSession, prospect);
  advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
  if (!currentPick(GameState.draftSession)) {
    GameState.lastDraftResults = GameState.draftSession.results;
    GameState.draftSession = null;
    archiveDraftClass(GameState.leagueYear, GameState.lastDraftResults);
  }
  renderView('draft');
  autosave(GameState);
}

function handleAdvanceToNewSeason() {
  // Unconditional, not gated on autoFreeAgency. That setting governs whether
  // the USER's free agency is automated, but AI teams have to start the season
  // with a legal roster either way — a user who clicks straight past the free
  // agency stage would otherwise begin the new season with most of the league
  // under the 12-man floor (measured: 26 of 30 teams, one down to 4 players),
  // which breaks roster-size validation for every trade and hands the remaining
  // players 30-plus minutes a night in the box-score engine.
  enforceRosterFloors();

  const result = generateNewSeason(GameState.rng);
  GameState.season = { games: result.games, currentDay: -1 };
  GameState.upcomingDraftClass = result.nextDraftClass;
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  GameState.allStarWeekend = null;
  renderView('dashboard');
  autosave(GameState);
}

function renderPlaceholder(container) {
  container.innerHTML = '<div class="placeholder-view">Coming in a later phase.</div>';
}

function renderView(viewName) {
  GameState.currentView = viewName;
  const container = document.getElementById('view-content');
  const renderer = BUILT_VIEWS[viewName];
  if (renderer) {
    renderer(container, GameState.userTeamId);
  } else {
    renderPlaceholder(container);
  }
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView, GameState.playMode, GameState.gameMode, !!GameState.playerLegacy);
  renderTopBar(document.getElementById('app-topbar'));
  if (GameState.season) {
    renderSimControls(document.getElementById('sim-controls'));
  }

  const simControlsEl = document.getElementById('sim-controls');
  if (isRegularSeasonAndPlayoffsComplete() && !GameState.offseasonStage) {
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="advance-offseason-btn">Advance to Offseason</button>');
    document.getElementById('advance-offseason-btn').addEventListener('click', function () { handleAdvanceToOffseason(true); });
  } else if (GameState.offseasonStage === 'draft') {
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="advance-to-fa-btn">Go to Free Agency</button>');
    document.getElementById('advance-to-fa-btn').addEventListener('click', function () {
      GameState.offseasonStage = 'freeagency';
      if (GameState.playMode === 'spectator' || GameState.automation.autoFreeAgency) {
        runFreeAgencySilently(GameState.rng);
        autoEnforceRosterSize(getTeamById(GameState.userTeamId));
      }
      renderView('freeagency');
      autosave(GameState);
    });
  } else if (GameState.offseasonStage === 'freeagency') {
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="start-new-season-btn">Start New Season</button>');
    document.getElementById('start-new-season-btn').addEventListener('click', handleAdvanceToNewSeason);
  }
}

function selectTeam(teamId, playMode) {
  GameState.userTeamId = teamId;
  GameState.playMode = playMode || 'gm';
  initSeason();
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView('dashboard');
}

function loadGame(slotId) {
  const result = loadFromSlot(slotId, GameState);
  if (!result.success) {
    alert(result.reason);
    return;
  }
  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  renderView(GameState.currentView || 'dashboard');
}

function initPlayerCareerMode() {
  GameState.playerCareerController = new PlayerCareerController(GameState);
  GameState.narrativeSystem = new NarrativeSystem(GameState);
  GameState.gameMode = 'playerCareer';
  setLeagueYear(GameState.leagueYear || 2026);

  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';

  const container = document.getElementById('view-content');
  renderPlayerCreation(container, function (player) {
    GameState.playerCareerController.setControlledPlayer(player.id);
    GameState.controlledPlayerId = player.id;
    renderDraftPhase();
  });
}

// The custom player enters the league through the same executePick path every
// drafted prospect uses. Setting only teamId (the original behavior) left him
// on createCustomPlayer's placeholder {salary: 0, yearsRemaining: 0} contract,
// so decrementContracts released him to free agency after his first season —
// and pushed his team to 16 players, which permanently failed trade.js's 12-15
// roster band for every trade that team tried to make.
function renderDraftPhase() {
  const container = document.getElementById('view-content');
  if (!GameState.rng) GameState.rng = makeRng(Date.now());
  const team = TEAMS[Math.floor(GameState.rng() * TEAMS.length)];
  const player = getPlayerById(GameState.controlledPlayerId);

  // Make room BEFORE the pick rather than trimming after: autoEnforceRosterSize
  // waives the lowest-value player on the roster, and a rookie on a rookie deal
  // can easily be that player — it would happily waive the career player the
  // moment he was added.
  const roster = getTeamRoster(team.id);
  if (roster.length >= 15) {
    const worst = roster.slice().sort(function (a, b) {
      return adjustedPlayerValue(a, team) - adjustedPlayerValue(b, team);
    })[0];
    waivePlayer(worst.id);
  }

  // Mid-first-round slot: a plausible landing spot that carries a real rookie
  // contract and a free jersey number rather than a hand-rolled stub.
  const pickNumber = 8 + Math.floor(GameState.rng() * 16);
  executePick(team.id, player, pickNumber, TEAMS.length);

  container.innerHTML =
    '<div class="view-header"><h2>Draft Night</h2></div>' +
    '<div class="panel">' +
    '<p>With pick #' + pickNumber + ', you are selected by the ' + escapeHtml(team.name) + '...</p>' +
    '<p class="kpi-sub">Rookie contract: $' + player.contract.salary.toLocaleString() + '/yr for ' + player.contract.yearsRemaining + ' years.</p>' +
    '<p style="margin-top: 20px;"><button class="btn btn-primary" onclick="startFirstSeason()">Accept Draft</button></p>' +
    '</div>';
}

function startFirstSeason() {
  const player = getPlayerById(GameState.controlledPlayerId);
  player.careerPhase = 'rookie';
  GameState.userTeamId = player.teamId;
  GameState.playMode = 'spectator';
  initSeason();
  renderView('playerDashboard');
}

// Single-key shortcuts for the most common actions — sim controls and a
// handful of nav jumps. Ignored while typing in any form field (including
// contenteditable) so they never hijack normal text entry, and while a
// modifier key is held (so browser/OS shortcuts like Ctrl+R still work).
const KEYBOARD_SHORTCUTS = {
  n: function () { const btn = document.getElementById('sim-next-day'); if (btn) btn.click(); },
  g: function () { const btn = document.getElementById('sim-next-game'); if (btn) btn.click(); },
  u: function () { const btn = document.getElementById('sim-undo-btn'); if (btn && !btn.disabled) btn.click(); },
  y: function () { const btn = document.getElementById('sim-redo-btn'); if (btn && !btn.disabled) btn.click(); },
  d: function () { renderView('dashboard'); },
  r: function () { renderView('roster'); },
  s: function () { renderView('standings'); },
  t: function () { renderView('trade'); }
};

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function handleKeyboardShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  if (!GameState.season || document.getElementById('app-view').style.display === 'none') return;
  const handler = KEYBOARD_SHORTCUTS[e.key.toLowerCase()];
  if (handler) handler();
}

function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam, loadGame, spectateLeague, initPlayerCareerMode);
  document.addEventListener('keydown', handleKeyboardShortcut);
}

document.addEventListener('DOMContentLoaded', init);
