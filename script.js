// Automation a NEW game starts with. The split is deliberate: automate the
// bookkeeping, never the decisions.
//
// autoCap and autoScout are chores with no drama in them. autoCap only fires
// when the roster is already illegal (over 15) — a state that must be
// resolved anyway — and takes the obvious option, the lowest-value player.
// autoScout spends a weekly point allowance across your own roster and
// anything you watchlisted. Neither is a choice a player would enjoy making
// forty times a season, and leaving them off just hands every new player a
// standing obligation before they have any idea the Settings page exists.
//
// The draft, free agency and trades stay manual because they ARE the game.
// Automating those by default would quietly play it for you. autoTrade in
// particular auto-EXECUTES incoming offers, so defaulting it on would change
// your roster without asking — the opposite of the point.
//
// Existing saves are unaffected: save.js restores whatever flags that save
// was played under.
function defaultAutomation() {
  return { autoFreeAgency: false, autoDraft: false, autoTrade: false, autoCap: true, autoScout: true };
}

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
  automation: defaultAutomation(),
  feed: [],
  // The GM's permanent career record — tenures, per-season rows, milestone
  // unlocks and the chronicle. See gmCareer.js for why almost nothing here is
  // stored. Created lazily by ensureGmCareer so a save from before it existed
  // repairs itself on load rather than crashing.
  gmCareer: null,
  draftSession: null,
  tradeOffers: [],
  pauseRequested: false,
  // Why the run stopped, for the dock's status line. pauseRequested alone is
  // a bare boolean: it can halt a fast-forward but cannot say what happened,
  // leaving the player to work out for themselves why the game stopped. Set
  // wherever pauseRequested is set, cleared wherever it is cleared.
  pauseReason: null,
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
    simEngine: 'possession', simSpeed: 'normal',
    // madePlayoffs/missedPlayoffs fire once a season and keyInjury is rare —
    // each is the game telling you something, so they default on. Continue
    // would otherwise sail past every notable moment in silence.
    //
    // tradeOfferReceived does NOT: offers generate weekly, so it would stop a
    // fast-forward roughly 26 times a season. Offers now expire on their own
    // with a visible countdown (trade.js), so the inbox no longer needs to
    // interrupt in order to be noticed.
    pauseOn: { madePlayoffs: true, missedPlayoffs: true, tradeOfferReceived: false, keyInjury: true },
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
  // Postseason state has to be cleared alongside the new schedule, the same
  // way the season rollover does it (seasonRollover.js,
  // handleAdvanceToNewSeason). Without this, starting a new game in a session
  // that already finished one inherited the OLD bracket: the dock read
  // "Playoffs" over a day -1 regular season, the Playoffs view showed the
  // previous league's series, and Watch Next Game took the playoff path.
  GameState.playoffBracket = null;
  GameState.offseasonStage = null;
  GameState.allStarWeekend = null;

  ensureHiddenPlayerData(PLAYERS_2026);
  ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
  ensurePlayerFace(PLAYERS_2026);
  ensurePlayerFace(DRAFT_PROSPECTS_2026);
  ensureCareerData(PLAYERS_2026);
  ensureAllTeamsHaveCoaches(GameState.rng);
  GameState.upcomingDraftClass = DRAFT_PROSPECTS_2026;
  GameState.scouting = initScoutingState();
  // The league snapshot the ultimate gate needs. Rollover takes one every
  // season (seasonRollover.js), but season ONE never did — it ran on the
  // fallback gate with no diversity pass, which left three ultimates unheld
  // until the first offseason. Same call a loaded save gets in loadGame.
  setLeagueGate(PLAYERS_2026);
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
    if (GameState.playMode !== 'spectator' && !isUserPlayer && player.overall < RATING_BANDS.star) return;
    pushToFeed(player.name + ' (' + getTeamById(inj.teamId).name + ') injured: ' + inj.severity, dayIndex);
    if (isUserPlayer && player.overall >= RATING_BANDS.star && GameState.settings.pauseOn.keyInjury) {
      GameState.pauseRequested = true;
      GameState.pauseReason = player.name + ' injured';
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
    // Same rule as accepting by hand: an offer that would leave a roster
    // outside 12-15 is refused rather than executed. Delegating trades must
    // not do something you could not do yourself.
    acceptTradeOffer(offer.proposal, function (p) { archiveTrade(p, GameState.leagueYear || 2026); }, dayIndex);
  } else {
    // Stamped so the offer can expire (trade.js) instead of sitting in the
    // inbox for the rest of the career.
    offer.dayReceived = dayIndex;
    GameState.tradeOffers.push(offer);
    if (GameState.settings.pauseOn.tradeOfferReceived) {
      GameState.pauseRequested = true;
      GameState.pauseReason = 'New trade offer';
    }
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
  // Retire offers whose window has closed. Silent by design: the Trade Center
  // shows each offer's remaining days, so letting one lapse is a decision the
  // player already made with the deadline in front of them — announcing it
  // afterwards would just be one more thing to read.
  pruneExpiredTradeOffers(GameState, dayIndex);
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
      // With no stash (started in spectator, then switched to GM) fall back to
      // the same defaults a new game gets, not to all-off — otherwise leaving
      // spectator silently handed the player back chores a new game would
      // have automated for them.
      const restored = GameState.automationBeforeSpectator || defaultAutomation();
      Object.keys(GameState.automation).forEach(function (k) {
        GameState.automation[k] = !!restored[k];
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
  feats: renderFeats,
  gmCareer: renderGmCareer,
  seasonSummary: renderSeasonSummary,
  frivolities: renderFrivolities,
  playerProfile: renderPlayerProfile,
  careerLedger: renderCareerLedger,
  badges: renderBadges,
  ultimates: renderUltimatesReference,
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

// Builds a draft the user picks in, instead of resolving every pick for them.
// Passed as runOffseasonRollover's onDraft by BOTH callers — this function and
// ui/simControls.js's advance loop — so Continue hands over the same draft the
// Season Recap route does. When only one of them passed it, Continue silently
// auto-drafted for every manual drafter.
function runInteractiveDraft(gs) {
  // gs.userTeamId is what holds YOUR expiring players back from the market for
  // you to decide on. The automatic route passes it through
  // runOffseasonThroughDraft; this is the manual-draft route, which reaches
  // runOffseasonPreDraft directly and so has to pass it itself. Omitting it
  // here left a manual drafter with no re-signing window at all — every one of
  // their expiring players was released before they ever saw the screen, which
  // is the exact behaviour the window was built to remove.
  const preDraft = runOffseasonPreDraft(gs.rng, gs.leagueYear, gs.userTeamId);
  announceSecretBadges(preDraft.secretBadges, function (text) { pushToFeed(text); });
  const draftOrder = buildDraftOrder(gs.playoffBracket, gs.rng, gs.settings.lotteryFormat);
  gs.draftSession = startDraftSession(draftOrder, gs.upcomingDraftClass);
  advanceDraftUntilUserTurn(gs.draftSession, gs.userTeamId, false);
  // The user's picks may all fall after the last AI pick, in which case the
  // session is already finished and there is nothing to hand them.
  if (!currentPick(gs.draftSession)) {
    gs.lastDraftResults = gs.draftSession.results;
    gs.draftSession = null;
    archiveDraftClass(gs.leagueYear, gs.lastDraftResults);
  }
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

  // Captured before the rollover's leagueYear increment — this is the season
  // whose champion/awards get archived, and what the season summary screen
  // (if shown) should display.
  const finishedLeagueYear = GameState.leagueYear || 2026;
  const autoDraftEffective = GameState.playMode === 'spectator' || GameState.automation.autoDraft;
  // Captured before runOffseasonRollover clears the bracket.
  const championId = GameState.playoffBracket && GameState.playoffBracket.finals[0]
    ? GameState.playoffBracket.finals[0].winner : null;

  // ONE implementation, shared with the fast-forward path (seasonRollover.js):
  // the snapshot, clearing pending offers, finalizeSeasonHistory and the year
  // bump all live there now. These were two independent bodies doing the same
  // work, which is how a fast-forward silently diverges from a manual advance.
  runOffseasonRollover(GameState, {
    stopAfterDraft: true,
    onFeed: function (text) { pushToFeed(text); },
    // Only when the user has NOT delegated the draft. Passing this overrides
    // the automatic pipeline with an interactive session they pick from;
    // omitting it lets the shared auto-draft run, exactly as before.
    onDraft: autoDraftEffective ? null : runInteractiveDraft
  });

  // The banner takes the screen ahead of the season summary or the draft; both
  // are still one click away behind the button.
  function afterBanner() {
    if (showSummary === true) {
      GameState.summarySeasonYear = finishedLeagueYear;
      renderView('seasonSummary');
    } else {
      renderView('draft');
    }
  }
  if (!maybeShowChampionshipScene(championId, finishedLeagueYear, afterBanner)) afterBanner();
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
// retirement ceremony or a pending random event). The advance loop
// (ui/simControls.js's runAdvance) uses that to stop rather than simming
// straight past it.
// `quiet` suppresses the fall-through renderView for callers driving a loop —
// re-rendering the whole app once per simulated season is both wasteful and
// visibly re-enables the sim dock mid-run.
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
  // Leaving the free agency stage closes the window on your own expiring
  // players. Anyone you never got round to walks — a re-sign right that
  // survived into the new season would leave him rostered forever on a
  // zero-year contract.
  releaseUnexercisedResignRights(GameState.userTeamId);

  // Unconditional, not gated on autoFreeAgency. That setting governs whether
  // the USER's free agency is automated, but AI teams have to start the season
  // with a legal roster either way — a user who clicks straight past the free
  // agency stage would otherwise begin the new season with most of the league
  // under the 12-man floor (measured: 26 of 30 teams, one down to 4 players),
  // which breaks roster-size validation for every trade and hands the remaining
  // players 30-plus minutes a night in the box-score engine.
  enforceRosterFloors();

  const result = generateNewSeason(GameState.rng, GameState.leagueYear);
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
  // A live watched game must never be abandoned half-played. Leaving the
  // Watch Game view by ANY route — the nav sidebar, a redirect, anything that
  // is not its own Exit button — runs the rest of it out under the auto-coach
  // and records it, exactly as Exit does. Without this, navigating away left
  // a permanently unplayed game sitting on a past day in the schedule.
  if (GameState.currentView === 'pixelGame' && viewName !== 'pixelGame') {
    // Ask before finishing a live game. Returning false means the confirm is
    // now on screen and this navigation is cancelled; the overlay's own
    // buttons either resume it or keep the user watching.
    if (!confirmLeaveLiveGame(viewName)) return;
    finishPendingPixelGame();
  }
  const previousView = GameState.currentView;
  GameState.currentView = viewName;
  const container = document.getElementById('view-content');
  const renderer = BUILT_VIEWS[viewName];
  if (renderer) {
    renderer(container, GameState.userTeamId);
  } else {
    renderPlaceholder(container);
  }
  // #view-content is the scroller, and it kept its offset across a view swap —
  // reading the standings to the bottom and then opening the roster dropped you
  // into the middle of the roster. Only on a real view CHANGE: views re-render
  // themselves in place for sorting and filtering (ui/roster.js's draw(), and
  // the Back to My Roster button, both land here with the same viewName), and
  // yanking the page to the top on every sort would be its own bug.
  if (previousView !== viewName) container.scrollTop = 0;
  renderNav(document.getElementById('nav-bar'), GameState.currentView, renderView, GameState.playMode, GameState.gameMode, !!GameState.playerLegacy);
  renderViewTabs(document.getElementById('view-tabs'), GameState.currentView, renderView, GameState.playMode, GameState.gameMode, !!GameState.playerLegacy);
  renderTopBar(document.getElementById('app-topbar'));
  if (GameState.season) {
    renderSimControls(document.getElementById('sim-controls'));
  }

  // The three ceremonial offseason buttons that used to be appended here —
  // "Advance to Offseason", "Go to Free Agency", "Start New Season" — are
  // gone. Continue does all three now (see continueLabel in
  // ui/simControls.js, which names the destination), and each of them was a
  // click the player had no choice about: there was never anything else to do
  // at those moments. handleAdvanceToOffseason survives for the Season Recap
  // route; stepOnce covers the rest.
}

// Repaint mid-run, once per simulated day, from runAdvance's loop.
//
// The loop advanced the league without repainting anything but the status
// line, so the record, day and standings on screen stayed frozen at whatever
// they were when Continue was pressed. Switching tabs was the only way to see
// the truth, by which point the run could be forty games further on.
//
// Deliberately NOT renderView: that rebuilds the dock, and replacing the Stop
// button under the cursor every step is how you make a run impossible to
// interrupt — the same reason the loop awaits even at ultra speed. The nav and
// tab strip are skipped too; neither changes while a run is in flight.
function refreshAdvanceFrame() {
  if (!GameState.season) return;
  // The watched game owns its own canvas and playback clock. Re-rendering it
  // from here would restart the game the user is in the middle of watching.
  if (GameState.currentView === 'pixelGame') return;

  const container = document.getElementById('view-content');
  const renderer = BUILT_VIEWS[GameState.currentView];
  if (container && renderer) {
    // Assigning innerHTML drops the scroll offset. Mid-run that reads as the
    // page yanking itself to the top once per day while you try to read it.
    const scrollTop = container.scrollTop;
    renderer(container, GameState.userTeamId);
    container.scrollTop = scrollTop;
  }
  renderTopBar(document.getElementById('app-topbar'));
}

function selectTeam(teamId, playMode) {
  GameState.userTeamId = teamId;
  GameState.playMode = playMode || 'gm';
  initSeason();

  // Read AFTER initSeason so leagueYear is settled — the tenure opens on the
  // year the career actually starts. Blank is fine and never blocks: the field
  // is a flourish, not a gate, and ensureGmCareer defaults the name to 'GM'.
  const nameInput = document.getElementById('gm-name-input');
  const typed = nameInput && nameInput.value ? nameInput.value.trim() : '';
  const career = ensureGmCareer(GameState);
  if (typed) career.name = typed;

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
  // The loaded league is a different population than whatever snapshot the
  // ultimate gate last took — same reason init takes one for season one.
  setLeagueGate(PLAYERS_2026);
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
  // The dock's two live actions. `n` was Next Day and `g` was Next Game;
  // neither control exists now, so both keys pointed at nothing. `n` is the
  // natural home for Continue (which is also Stop mid-run), and `g` keeps its
  // association with the user's own game by watching it.
  n: function () { const btn = document.getElementById('sim-continue'); if (btn && !btn.disabled) btn.click(); },
  g: function () { const btn = document.getElementById('sim-watch-game'); if (btn && !btn.disabled) btn.click(); },
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
  // Player Career is PARKED, not deleted — passing null here is the whole
  // switch, because teamSelect.js only renders the button when it is handed a
  // callback. Restoring the mode means putting initPlayerCareerMode back as the
  // fifth argument; nothing else needs to change.
  //
  // Parked because a created player is mechanically broken in two ways that
  // both trace to createCustomPlayer (playerCareerController.js:42-77):
  //   - hiddenTraits stays [] forever. ensureHiddenPlayerData already ran at
  //     league init (line 119 above) and is never called again, so the one
  //     player you control is the only one in the league with none of the 48
  //     traits the sim reads — while all 380 others average 3.27.
  //   - overall is assigned as a plain literal instead of ratings.js's derived
  //     getter, so it never recomputes. progression.js writes attributes only
  //     (see its comment at :178), which means a career player trains for years
  //     and their rating never moves. That is career mode's core loop.
  // Fix both before un-parking; the badges array is display-only and can be
  // folded into the trait roll at the same time.
  renderTeamSelect(document.getElementById('team-select-view'), selectTeam, loadGame, spectateLeague, null);
  document.addEventListener('keydown', handleKeyboardShortcut);
}

document.addEventListener('DOMContentLoaded', init);
