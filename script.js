const GameState = {
  userTeamId: null,
  currentView: 'dashboard',
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
  settings: {
    simEngine: 'boxscore', simSpeed: 'normal',
    pauseOn: { madePlayoffs: false, missedPlayoffs: false, tradeOfferReceived: false, keyInjury: false },
    capDisabled: false
  }
};

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
  ensureCareerData(PLAYERS_2026);
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

function handleDayComplete(dayIndex, todaysGames, newInjuries) {
  tickScoutingForDay(dayIndex);
  pushGameResultsToFeed(dayIndex, todaysGames || []);
  pushInjuriesToFeed(newInjuries || [], dayIndex);
  runWeeklyTradeGeneration(dayIndex);
}

function switchPlayMode(newMode, teamId) {
  if (newMode === 'spectator') {
    Object.keys(GameState.automation).forEach(function (k) { GameState.automation[k] = true; });
  } else if (!GameState.userTeamId && teamId) {
    GameState.userTeamId = teamId;
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
  roster: renderRoster,
  standings: renderStandings,
  schedule: renderSchedule,
  playoffs: renderPlayoffs,
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
  news: renderLeagueNews,
  salarycap: renderSalaryCap,
  playerDashboard: function (container) {
    renderPlayerDashboard(container, GameState.controlledPlayerId);
  }
};

function isRegularSeasonAndPlayoffsComplete() {
  return GameState.season && GameState.season.games.every(function (g) { return g.played; })
    && GameState.playoffBracket && GameState.playoffBracket.finals.length > 0 && GameState.playoffBracket.finals[0].complete;
}

function handleAdvanceToOffseason() {
  // Runs BEFORE the leagueYear increment and before retirement, so
  // finalizeSeasonHistory's award/career-stat rollup reflects the season
  // that just finished, and retirees archived immediately after this see
  // their fully-updated careerStats/awardsWon.
  finalizeSeasonHistory(GameState.leagueYear || 2026, GameState.playoffBracket, function (text) { pushToFeed(text); });

  GameState.leagueYear = (GameState.leagueYear || 2026) + 1;
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;

  if (autoDraftEffective) {
    const result = runOffseasonThroughDraft(GameState.playoffBracket, GameState.rng, GameState.upcomingDraftClass, GameState.leagueYear);
    GameState.lastDraftResults = result.draftResults;
    GameState.draftSession = null;
    archiveDraftClass(GameState.leagueYear, result.draftResults);
  } else {
    runOffseasonPreDraft(GameState.rng, GameState.leagueYear);
    const draftOrder = buildDraftOrder(GameState.playoffBracket, GameState.rng);
    GameState.draftSession = startDraftSession(draftOrder, GameState.upcomingDraftClass);
    advanceDraftUntilUserTurn(GameState.draftSession, GameState.userTeamId, false);
    if (!currentPick(GameState.draftSession)) {
      GameState.lastDraftResults = GameState.draftSession.results;
      GameState.draftSession = null;
      archiveDraftClass(GameState.leagueYear, GameState.lastDraftResults);
    }
  }

  GameState.offseasonStage = 'draft';
  renderView('draft');
  autosave(GameState);
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
  const result = generateNewSeason(GameState.rng);
  GameState.season = { games: result.games, currentDay: -1 };
  GameState.upcomingDraftClass = result.nextDraftClass;
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
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
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView, GameState.playMode, GameState.gameMode);
  renderTopBar(document.getElementById('app-topbar'));
  if (GameState.season) {
    renderSimControls(document.getElementById('sim-controls'));
  }

  const simControlsEl = document.getElementById('sim-controls');
  if (isRegularSeasonAndPlayoffsComplete() && !GameState.offseasonStage) {
    simControlsEl.insertAdjacentHTML('beforeend', '<button id="advance-offseason-btn">Advance to Offseason</button>');
    document.getElementById('advance-offseason-btn').addEventListener('click', handleAdvanceToOffseason);
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
  GameState.leagueYear = GameState.leagueYear || 2026;

  document.getElementById('team-select-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';

  const container = document.getElementById('view-content');
  renderPlayerCreation(container, function (player) {
    GameState.playerCareerController.setControlledPlayer(player.id);
    GameState.controlledPlayerId = player.id;
    renderDraftPhase();
  });
}

function renderDraftPhase() {
  const container = document.getElementById('view-content');
  const team = TEAMS[Math.floor(Math.random() * TEAMS.length)];
  const player = getPlayerById(GameState.controlledPlayerId);
  player.teamId = team.id;

  container.innerHTML =
    '<div class="view-header"><h2>Draft Night</h2></div>' +
    '<div class="panel">' +
    '<p>You are selected by the ' + team.name + '...</p>' +
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

function init() {
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam, loadGame, spectateLeague, initPlayerCareerMode);
}

document.addEventListener('DOMContentLoaded', init);
