// The "Watch Game" view: plays a choreographed keyframe timeline
// (ui/pixelChoreographer.js) on a pixel-art canvas (ui/pixelCourt.js,
// ui/pixelSprites.js). Playback state (including the event log) lives in this
// module, never in GameState — a watched game is already recorded via the
// normal applyGameResult path before this view ever opens, so navigating
// away, reloading, or saving mid-watch can't corrupt anything (spec:
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md).

let _watchSession = null;   // set by the Watch Next Game handler, cleared on exit
let _rafId = null;

// Set while a LIVE game is on screen: runs the remainder out under the
// auto-coach and records it. A live game is not in the save until it
// finishes, so abandoning one leaves a permanently unplayed game sitting on a
// past day in the schedule — which is what happened when the view was left by
// any route other than its own Exit button (the nav sidebar, or any redirect
// through renderView). script.js's renderView calls finishPendingPixelGame on
// the way out so every exit path completes the game.
let _pendingLiveRunOut = null;

// Where the user was heading when the leave-confirm interrupted them.
let _pendingLeaveTarget = null;

// The current coach's shutdown (ui/pixelCoach.js onGameOver), registered
// module-side for the same reason as _pendingLiveRunOut: the coach holds a
// document-level keydown listener, and only the watched-to-the-buzzer path
// went through showFinal() — leaving a live game early (Exit, sidebar, any
// renderView) leaked one keydown handler per abandoned game. It is
// idempotent, so the showFinal path calling it first costs nothing.
let _coachShutdown = null;

// Gate for every exit route. Returns true if leaving may proceed right now,
// false if the confirmation has been raised instead and the caller should
// stand down — the overlay's own buttons resume or cancel the navigation.
function confirmLeaveLiveGame(targetView) {
  if (!_pendingLiveRunOut) return true;        // nothing live to lose
  const overlay = document.getElementById('pixel-leave-confirm');
  if (!overlay) return true;                   // view is gone; don't trap the user
  _pendingLeaveTarget = targetView || 'dashboard';
  overlay.hidden = false;
  return false;
}

// True while a watched game is on screen and still unrecorded. The sim dock
// reads this to disable Continue: the dock stays visible during a watched
// game, and without the check it would sim days out from under a game the
// user is still looking at.
function isLiveWatchPending() { return _pendingLiveRunOut !== null; }

function finishPendingPixelGame() {
  const runOut = _pendingLiveRunOut;
  _pendingLiveRunOut = null;
  if (runOut) runOut();
  stopPixelPlayback();
}

const PIXEL_SPEEDS = [1, 2, 4, 8];

// Keyframe texts that mean "the ball just went in" — drives the rim flash.
// Must stay in sync with the made-shot labels in ui/pixelChoreographer.js.
// A made basket, read off the structured sfx field rather than the display
// string. The old hand-maintained MAKE_LABELS list had drifted out of sync
// with the choreographer's finish lines: 'Throws it down!', 'Rises up and
// JAMS it!' and 'Kisses it off the glass' were all missing, so two of the
// three dunk finishes and one of the three layups landed with no rim shake,
// no net splash and no freeze at all. Misses are 'clang', free throws
// 'whistle'; only these two are makes.
function isMakeKeyframe(kf) {
  return kf.sfx === 'swish' || kf.sfx === 'dunk';
}

// Airborne heights and ball positions live in ui/pixelMotion.js — pure, and
// reachable from Node, which this render closure is not. See that file's
// header for why.

// The subset of plays the crowd goes wild for.
const BIG_PLAY_LABELS = [
  'Three-pointer!', 'Blocked!', 'Steal!',
  'Slams it home!', 'Throws it down!', 'Rises up and JAMS it!'
];

// Referee sprite: monochrome stripes, no jersey number.
const REF_COLORS = { skin: '#d9b38c', hair: '#2b2b2b', jersey: '#e8e8e8', trim: '#222222' };

// Recently watched games, newest first, so a game can be replayed from the
// view's own controls. Memory-only and capped: event logs are big and
// playback-only, so they never enter GameState or a save file (see the
// module comment above).
const _replayHistory = [];
const REPLAY_LIMIT = 8;

// A live session is a game that has NOT happened yet: the view steps it while
// playing it back. It only enters the replay history once it is complete,
// because until then there is no result to replay.
function setLiveWatchSession(liveSession) {
  _watchSession = Object.assign({}, liveSession, { live: true, homeScore: 0, awayScore: 0 });
}

function getReplayHistory() { return _replayHistory; }

function stopPixelPlayback() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  suspendPixelAudio();
  // Module-level state in ui/pixelImpact.js, so a highlight still holding when
  // the view closes would zoom the first frame of the NEXT watched game.
  resetImpact();
  if (_coachShutdown) { const shutdown = _coachShutdown; _coachShutdown = null; shutdown(); }
  // Leaving the view mid-scene would otherwise leave a fixed overlay pinned
  // over the whole app with nothing left running to dismiss it.
  if (typeof closeDialogueBox === 'function') closeDialogueBox();
}

function pixelLerp(a, b, f) { return a + (b - a) * f; }

function renderPixelGame(container) {
  stopPixelPlayback();
  if (!_watchSession) {
    container.innerHTML = '<div class="view-header"><h2>Watch Game</h2></div>' +
      pixelReplayListHtml(_replayHistory, getTeamById);
    Array.prototype.forEach.call(container.querySelectorAll('.pixel-replay-btn'), function (btn) {
      btn.addEventListener('click', function () {
        _watchSession = _replayHistory[Number(btn.getAttribute('data-idx'))];
        renderPixelGame(container);
      });
    });
    return;
  }
  const session = _watchSession;
  const homeTeam = getTeamById(session.homeTeamId);
  const awayTeam = getTeamById(session.awayTeamId);

  // Live: the rosters come from the sim, which is the authority on who is
  // eligible tonight. Replay: rebuild them from the box score (teamId stamped
  // per line — see simEngineBoxScore.js) rather than live team rosters, so a
  // trade or injury after the fact can't desync the replay from what happened.
  const homeRoster = session.live
    ? session.sim.homeRoster
    : Object.keys(session.boxScore)
        .map(function (id) { return getPlayerById(id); })
        .filter(function (p) { return p && session.boxScore[p.id].teamId === session.homeTeamId; });
  const awayRoster = session.live
    ? session.sim.awayRoster
    : Object.keys(session.boxScore)
        .map(function (id) { return getPlayerById(id); })
        .filter(function (p) { return p && session.boxScore[p.id].teamId === session.awayTeamId; });

  const choreographer = createChoreographer({
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    homeName: homeTeam.name,
    awayName: awayTeam.name,
    homeAbbr: homeTeam.id,
    awayAbbr: awayTeam.id
  });

  // Replay feeds the whole stored log in immediately; live feeds it one
  // possession at a time from stepAhead() below.
  if (!session.live) {
    groupPossessions(session.events).forEach(function (slice) { choreographer.appendEvents(slice); });
    choreographer.finish();
  }
  const timeline = choreographer.timeline;

  const playerById = {};
  const colorsById = {};
  homeRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, homeTeam, true); });
  awayRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, awayTeam, false); });

  container.innerHTML = pixelShellHtml(homeTeam, awayTeam, PIXEL_STAGE.w, PIXEL_STAGE.h, PIXEL_SPEEDS);
  // Replaying a game that is still being played makes no sense.
  if (_watchSession.live) document.getElementById('pixel-replay').disabled = true;

  const canvas = document.getElementById('pixel-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Court background, with the home logo layered in once it loads.
  let courtCanvas = buildCourtCanvas(homeTeam, awayTeam, null);
  const logoImg = new Image();
  logoImg.onload = function () { courtCanvas = buildCourtCanvas(homeTeam, awayTeam, logoImg); };
  logoImg.src = getTeamLogoUrl(session.homeTeamId);

  let playbackMs = 0;
  // Impact effects run on a REAL-time clock, not playbackMs. They exist to
  // decorate the freeze — and the freeze works by holding playbackMs still,
  // so anything aged off playbackMs is frozen at age 0 for the whole hold.
  // That silenced the speed lines (gated to age >= 70ms) for the entire panel
  // and pinned the flash at full alpha, then played both AFTER the freeze
  // lifted, over resumed play, around a rim the players had already left.
  let impactRealMs = 0;
  let speed = 1;
  // Recent ball positions, newest last. Fixed length: the trail is a legibility
  // aid at speed, not a motion-blur effect, so it must not grow with frame rate.
  const ballTrail = [];
  const BALL_TRAIL_MAX = 10;
  let paused = false;
  let lastFrameTs = null;
  let kfIndex = 0;
  // The same array object throughout — appendEvents mutates it in place, so
  // this stays valid as the live timeline grows.
  const kfs = timeline.keyframes;
  // How tired everybody ended the game. The sim has tracked energy all along
  // and nothing had ever asked for it, so a man in his fortieth minute moved
  // exactly like one who had just checked in.
  const energyById = timeline.energyById || {};

  // --- Live stepping ------------------------------------------------------
  // How far ahead of the playhead the choreographed timeline is kept. Two
  // seconds is roughly three possessions of beats — enough that a slow frame
  // never starves playback, small enough that a decision made now still lands
  // within a few seconds of game time rather than a minute later.
  const STEP_AHEAD_MS = 2000;
  // A hard per-frame cap. Without it, a tab that was backgrounded (or a Skip
  // to Final on a game that has barely started) would try to choreograph the
  // entire remaining game inside one animation frame and drop the tab.
  const MAX_STEPS_PER_FRAME = 12;

  let liveFinished = false;

  // Which side the user coaches. A replayed game, and any game the user's
  // team is not in, is watch-only: the controls stay disabled rather than
  // being hidden, so the view has one layout instead of two.
  const userSide = session.live && session.userTeamId === session.homeTeamId ? 'home'
    : (session.live && session.userTeamId === session.awayTeamId ? 'away' : null);

  function stepAhead(budget) {
    if (!session.live) return;
    let steps = 0;
    while (!session.sim.done &&
           timeline.durationMs - playbackMs < STEP_AHEAD_MS &&
           steps < budget) {
      const before = session.events.length;
      session.sim.step();
      choreographer.appendEvents(session.events.slice(before));
      steps += 1;
      // A queued decision lands at the boundary this step just crossed, so
      // the controls have to re-read the sim here — otherwise the timeout
      // counter and the on-court five keep showing the pre-decision state
      // and the user cannot tell their click did anything.
      coach.refresh();
    }
    if (session.sim.done) finishLiveGame();
  }

  // Closes the game out exactly once: the choreographer is sealed, the
  // session becomes an ordinary completed session (so Replay works on it and
  // it joins the replay history), and the league records the result.
  function finishLiveGame() {
    if (liveFinished || !session.live) return;
    liveFinished = true;
    _pendingLiveRunOut = null;
    choreographer.finish();
    const result = session.sim.result();
    session.homeScore = result.homeScore;
    session.awayScore = result.awayScore;
    session.boxScore = result.boxScore;
    session.live = false;
    if (session.onFinish) session.onFinish();
    _replayHistory.unshift(session);
    if (_replayHistory.length > REPLAY_LIMIT) _replayHistory.length = REPLAY_LIMIT;
  }

  // Runs whatever is left under the auto-coach and choreographs it. Used by
  // Skip to Final and by Exit: the spec is explicit that a half-played game
  // is never recorded, so leaving the view completes the game rather than
  // discarding it.
  // Registered module-side so leaving the view by ANY route completes the
  // game (see finishPendingPixelGame at the top of this file).
  if (session.live) _pendingLiveRunOut = runOutLiveGame;

  function runOutLiveGame() {
    if (!session.live) return;
    // Hand the timeout decision back to the auto-coach. The view claimed it
    // (sim.userTeam) so the human got first refusal via a nudge — but nobody
    // is watching now, and leaving it claimed would run the entire remainder
    // with the user's team never calling a timeout at all, while every other
    // team managed theirs normally.
    session.sim.userTeam = null;
    while (!session.sim.done) {
      const before = session.events.length;
      session.sim.step();
      choreographer.appendEvents(session.events.slice(before));
    }
    finishLiveGame();
  }

  function periodLabel(period) {
    return period <= 4 ? 'Q' + period : 'OT' + (period - 4);
  }

  // The coaching layer (timeout button, sub panel, nudges) lives in
  // ui/pixelCoach.js. It borrows playback state through these accessors and
  // owns none of it, so it can never affect what is drawn.
  const coach = createPixelCoach({
    sim: session.sim,
    userSide: userSide,
    opponentName: (userSide === 'home' ? awayTeam : homeTeam).name,
    playbackMs: function () { return playbackMs; },
    isFinished: function () { return liveFinished; },
    commentaryEl: document.getElementById('pixel-commentary')
  });
  // Every exit route funnels through stopPixelPlayback, which runs this —
  // see the _coachShutdown comment at the top of the file.
  _coachShutdown = coach.onGameOver;

  function currentFrame() {
    while (kfIndex < kfs.length - 1 && kfs[kfIndex + 1].t <= playbackMs) kfIndex++;
    while (kfIndex > 0 && kfs[kfIndex].t > playbackMs) kfIndex--;
    const a = kfs[kfIndex];
    const b = kfs[Math.min(kfIndex + 1, kfs.length - 1)];
    const span = Math.max(1, b.t - a.t);
    const f = Math.max(0, Math.min(1, (playbackMs - a.t) / span));
    return { a: a, b: b, f: f };
  }

  function fmtClock(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Crowd excitement: spikes when a big-play keyframe starts, decays over
  // ~1.8s. Tracked by keyframe timestamp so pausing doesn't re-trigger it.
  let excitementStartMs = -Infinity;
  let lastBigPlayKfT = -1;

  // Broadcast feed: each keyframe's commentary line is appended once
  // (newest on top, last six kept). escapeHtml because the lines embed
  // player and team names, same as every other feed in the app.
  let lastCommentaryKfT = -1;
  function pushCommentary(kf) {
    if (!kf.commentary || kf.t === lastCommentaryKfT) return;
    lastCommentaryKfT = kf.t;
    // The keyframe's impact marker carries the skillCheck that produced the
    // highlight (ui/pixelChoreographer.js). Ordinary keyframes have no marker,
    // so they pass null and the feed line stays a plain caption.
    pixelPushCommentary(document.getElementById('pixel-commentary'), kf.commentary,
      kf.impact ? kf.impact.check : null);
  }

  // Motion-quality state: per-player facing persists so standing players
  // keep looking the way they last ran; shake/hitch/quarter-card timers
  // drive the impact feedback.
  const facingById = {};
  // When each leaper's feet last touched down, in playback ms, and off which
  // kind of leap. Keyed by player so two men can be landing at once, which
  // happens on every contested finish at the rim. Entries are left to go stale
  // rather than swept: landingSquash answers zero past its recovery window, so
  // a stale stamp costs one subtraction and draws nothing.
  const landedAt = {};
  // Each player's foot lift on the previous drawn frame, so a landing can be
  // caught as the transition it is.
  const prevFootById = {};
  // When each dunker last caught the rim, in playback ms.
  const rimHitAt = {};
  // When each player was last shoved by another body, and how hard.
  const contactAt = {};
  // When each player last kicked up dust, so a long skid makes one puff.
  const lastDustAt = {};
  let shakeStartMs = -Infinity;
  // A dunk landing gets its own, separate from the collision shake: see where
  // it is applied for why the two must not share a timer or an axis.
  let landShakeStartMs = -Infinity;
  const LAND_SHAKE_MS = 110;
  // The crossover's camera nudge — a directional drag, not a shake. See where
  // it is armed for why the two are different effects.
  let crossNudgeStartMs = -Infinity;
  let crossNudgeDir = 1;
  const CROSS_NUDGE_MS = 200;
  let hitchMs = 0;              // freeze-frame remaining (real ms, unscaled)
  let lastEffectKfT = -1;
  let lastQuarterSeen = 1;
  let quarterCard = null;       // { text, scoreLine } while a break card shows
  // The takeover announcement. Held for a beat after the freeze clears so the
  // name is readable, then dropped — endings are quiet, only beginnings get a
  // card, or neither would read as the moment.
  let takeoverBanner = null;    // { name, playerId }
  let takeoverBannerUntil = -Infinity;
  const TAKEOVER_BANNER_MS = 2200;

  // A TEAM ultimate lifts all five, so all five get the marker. Which of the
  // twelve are team ultimates is read from ULTIMATE_BY_KEY rather than
  // hard-coded here — the taxonomy is the one place that knows, and a list
  // copied into the view would silently rot the first time one changed.
  function isTeamTakeoverMate(pid, tkSide, teamOf) {
    const side = teamOf[pid];
    const tk = side && tkSide[side];
    if (!tk || tk.playerId === pid) return false;
    const def = typeof ULTIMATE_BY_KEY !== 'undefined' ? ULTIMATE_BY_KEY[tk.ultimateKey] : null;
    return !!(def && def.kind === 'team');
  }
  let lastScoreShown = ['', ''];
  const scorePopAt = [-Infinity, -Infinity]; // playbackMs of the last change

  // Bench run-ins/run-offs: a player newly appearing on court jogs in from
  // the near sideline (which also gives the opening tip a "teams take the
  // floor" moment); a swapped-out player jogs off before vanishing.
  const EXIT_MS = 500;
  const sidelineY = PIXEL_STAGE.court.y + PIXEL_STAGE.court.h + 14;
  const lastPosById = {};       // pid -> last drawn [x, y]
  let onCourtPrev = {};         // pids drawn last frame
  const leavers = [];           // { pid, x, y, t0 }
  let suppressEntries = false;  // set by Skip to Final — no run-ins on a jump

  // Net-splash particles spawned when a make keyframe starts.
  const particles = [];         // { x0, y0, vx, vy, t0, color }
  function spawnNetSplash(x, y) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        x0: x, y0: y + 2,
        vx: (i - 2) * 0.014,
        vy: 0.008 + (i % 3) * 0.01,
        t0: playbackMs,
        color: i % 2 ? '#f4ead8' : '#e8760e'
      });
    }
  }

  // FLOOR DUST, on the same particle system the net splash uses. A dunk landing
  // was the one impact in the game that moved the camera, made a noise and
  // compressed the body without disturbing a single pixel of the court under
  // him.
  //
  // Deliberately meaner than the net splash: three specks, low and flat, in the
  // hardwood's own colours rather than white — this is dust being kicked, not a
  // net snapping, and anything brighter turns a landing into a firework. Only
  // dunk landings and the hardest plants get it, which is the same discipline
  // that keeps blocks out of the zoom tier.
  function spawnFloorDust(x, y, dirX) {
    for (let i = 0; i < 3; i++) {
      particles.push({
        x0: x + (i - 1) * 2, y0: y,
        // Kicked out along the floor and barely up. `dirX` throws it the way
        // he was travelling, so a man landing out of a run drags it with him.
        vx: ((i - 1) * 0.018) + (dirX || 0) * 0.012,
        vy: -0.004 - (i % 2) * 0.003,
        t0: playbackMs,
        color: i % 2 ? '#c9a97a' : '#a8894f'
      });
    }
  }

  // Only the run-off animation eases now; everything on court is spring
  // driven and the ball is a projectile.
  function easeInOut(f) { return f * f * (3 - 2 * f); }

  // --- Continuous motion model -------------------------------------------
  // Interpolating each keyframe segment with its own ease curve made every
  // player decelerate to a dead stop and re-accelerate at EVERY beat — two
  // or three full stops a second, which is what read as "stiff". Instead the
  // drawn position chases the keyframe position through a critically damped
  // spring: velocity carries ACROSS keyframe boundaries, so a player only
  // stops when the play actually stops. Integrated in timeline-ms (not real
  // ms) so the feel is identical at 1x and 8x.
  const smooth = {};   // pid -> { x, y, vx, vy, omega }

  // A critically damped spring tracking a target moving at velocity v lags by
  // 2v/omega. Crossing the floor in transition is ~300px in 420-700ms, i.e.
  // 430-700 px/s, which at omega 15 is a 57-93px lag — so a low snap
  // threshold fired MID-RUN, teleporting players and zeroing their velocity
  // over and over. That was the choppiness in transition.
  //
  // The spring, its stiffness ramp and its speed ceiling live in
  // ui/pixelMotion.js now — see that file for why. MAX_SEPARATION_SHIFT_PX
  // stays here because it belongs to the collision pass below, not the spring.
  const MAX_SEPARATION_SHIFT_PX = 4;

  // Defenders keep continuous pressure on the ball rather than standing on
  // a fixed spot: a small live offset toward the ball, which also means
  // there is always motion on the floor between discrete events.
  const teamById = {};
  homeRoster.forEach(function (p) { teamById[p.id] = 'home'; });
  awayRoster.forEach(function (p) { teamById[p.id] = 'away'; });
  let lastOffenseTeam = 'home';
  let ballSpin = 0;             // accumulated tumble, advanced during flight
  // The flight's launch point, frozen for the duration of one flight.
  let launchCache = { idx: -1, value: null };
  let excitementIsHome = true;  // which side the arena is reacting for
  let lastBallActor = null;     // last player to hold the ball
  let lastBouncePhase = 1;      // for detecting dribble floor contact
  // The ball's drawn position last frame, for its own screen velocity. Reset
  // with the trail on a seek, so a jump does not read as a 4000px/s pass.
  let prevBallDraw = null;
  // The dribble clock, in bounces. Owned here rather than derived from
  // playbackMs because the tempo changes with the handler's speed, and a phase
  // derived from absolute time gets RETROACTIVELY rewritten every time it does
  // — 446 twelve-pixel hand-swaps a game. See stepDribbleClock.
  let dribbleU = 0;
  // The named move playing right now, or null. Read off the keyframe every
  // frame rather than remembered across them, so seeking lands correctly.
  let dribbleMove = null;
  let lastSnapRendered = null;  // avoids rebuilding the info strip every frame
  let refX = PIXEL_STAGE.w / 2;
  let refY = PIXEL_STAGE.court.y + PIXEL_STAGE.court.h - 12;

  // Respect the OS "reduce motion" setting: the impact effects (shake,
  // freeze-frames, net splash, crowd jumping, rim flex) are exactly the kind
  // of motion that setting exists to suppress. Play still runs; only the
  // punctuation is dropped.
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let rimShakeStart = -Infinity; // set when a shot goes through
  let rimShakeSide = 'right';
  let rimShakeHard = false;      // a dunk rattles it harder than a jumper

  function distToNearestHoop(pt) {
    const L = PIXEL_STAGE.hoops.left;
    const R = PIXEL_STAGE.hoops.right;
    return Math.min(Math.abs(pt.x - L.x) + Math.abs(pt.y - L.y), Math.abs(pt.x - R.x) + Math.abs(pt.y - R.y));
  }

  // Keeps the (visually hidden) DOM scoreboard in sync for screen readers,
  // and records when each side last scored so the canvas board can pop.
  function setScore(elId, value, side) {
    const el = document.getElementById(elId);
    const v = String(value);
    if (lastScoreShown[side] === v) return;
    const first = lastScoreShown[side] === '';
    lastScoreShown[side] = v;
    el.textContent = v;
    if (!first) scorePopAt[side] = playbackMs;
  }

  function draw(realDt) {
    // advances through the freeze, unlike playbackMs — see its declaration
    impactRealMs += realDt;
    const fr = currentFrame();
    // Linear target: the spring below supplies all the smoothing, so no
    // per-segment ease (that is what caused the stop-start stiffness).
    const fP = fr.f;

    // one-shot effects when a new keyframe becomes current
    if (fr.a.t !== lastEffectKfT) {
      if (BIG_PLAY_LABELS.indexOf(fr.a.text) !== -1) {
        excitementStartMs = playbackMs;
        lastBigPlayKfT = fr.a.t;
        // the building only erupts for the home team; a road basket draws a
        // pocket of travelling fans and silence from everyone else
        const actor = fr.a.ball.holder || lastBallActor;
        excitementIsHome = (fr.a.text === 'Blocked!' || fr.a.text === 'Steal!')
          ? (teamById[actor] !== lastOffenseTeam ? 'home' : 'away') === 'home'
          : lastOffenseTeam === 'home';
      }
      if (!reduceMotion && (BIG_PLAY_LABELS.indexOf(fr.a.text) !== -1 && fr.a.text !== 'Steal!' && fr.a.text !== 'Three-pointer!')) {
        shakeStartMs = playbackMs;
      }
      // RIM CONTACT. Keyframes sit at beat ENDS, so the slam beat runs from the
      // rise keyframe to the slam keyframe and the ball is through the net the
      // moment this one becomes current — which is also the moment his hand is
      // on the iron. Stamped here rather than in the sprite loop because it is
      // a keyframe crossing, not a per-frame transition like a landing.
      if (fr.a.dunk && fr.a.dunk.phase === 'slam' && fr.a.dunk.id && !reduceMotion) {
        rimHitAt[fr.a.dunk.id] = playbackMs;
        if (speed <= 4) playPixelSfx('rim');
      }
      // A HARD CROSSOVER nudges the camera the way he went. Not a shake — a
      // shake is a collision, and nothing collided; this is the picture being
      // dragged a pixel by the cut, which is why it is a single directional
      // push that decays rather than a ringing sine. Armed only on the cut beat
      // of an ankle breaker, which is ~1.7 a game, so it stays an accent.
      if (fr.a.cross && fr.a.cross.phase === 'cross' && !reduceMotion && speed < 8) {
        crossNudgeStartMs = playbackMs;
        // Which way he cut, from where the two men are standing: the handler
        // has just gone one way and left his man the other, so the sign of the
        // gap between them IS the direction of the move.
        const hp = fr.a.pos[fr.a.cross.by], vp = fr.a.pos[fr.a.cross.on];
        crossNudgeDir = (hp && vp) ? (hp[0] >= vp[0] ? 1 : -1) : 1;
      }
      if (isMakeKeyframe(fr.a)) {
        if (!reduceMotion) {
          hitchMs = Math.max(hitchMs, 120);
          spawnNetSplash(fr.a.ball.x, fr.a.ball.y);
          rimShakeStart = playbackMs;
          // a dunk rattles the rim harder and longer than a jumper dropping in
          rimShakeHard = fr.a.sfx === 'dunk';
          rimShakeSide = fr.a.ball.x > PIXEL_STAGE.w / 2 ? 'right' : 'left';
        }
      }
      // Highlight plays. Read off a structured field, never the label text.
      // hitchMs is REUSED rather than paired with a second freeze clock: a
      // poster is also a made shot, so both paths fire on the same frame and
      // Math.max lets the longer hold win instead of two timers disagreeing.
      // Camera lead-in on the takeoff, so the leap plays magnified instead of
      // the zoom arriving once he is already hanging on the rim.
      if (fr.a.dunk && fr.a.dunk.zoomTo) {
        armImpactZoom({ kind: 'poster', at: fr.a.dunk.zoomTo }, impactRealMs,
          { reduceMotion: reduceMotion, speed: speed });
      }
      if (fr.a.impact) {
        const impactOpts = { reduceMotion: reduceMotion, speed: speed };
        startImpact(fr.a.impact, impactRealMs, impactOpts);
        hitchMs = Math.max(hitchMs, impactFreezeMs(fr.a.impact, impactOpts));
        if (!reduceMotion && speed < 8) shakeStartMs = playbackMs;
      }
      // A takeover begins. Reuses the comic-panel treatment posters already get
      // — freeze, snap zoom, flash, speed lines — centred on the holder, plus a
      // banner naming the ultimate. A new effect here would fight the visual
      // language the game has already established for "this mattered".
      //
      // The freeze is taken from impactFreezeMs like any other kind, so
      // prefers-reduced-motion (which returns 0) degrades this to the banner
      // alone for free.
      if (fr.a.takeoverStart) {
        const tk = fr.a.takeoverStart;
        const at = fr.a.pos && fr.a.pos[tk.playerId]
          ? { x: fr.a.pos[tk.playerId][0], y: fr.a.pos[tk.playerId][1] }
          : { x: PIXEL_STAGE.w / 2, y: PIXEL_STAGE.h / 2 };
        const takeoverOpts = { reduceMotion: reduceMotion, speed: speed };
        const marker = { kind: 'takeover', at: at, byId: tk.playerId };
        startImpact(marker, impactRealMs, takeoverOpts);
        hitchMs = Math.max(hitchMs, impactFreezeMs(marker, takeoverOpts));
        takeoverBanner = { name: tk.ultimateName, playerId: tk.playerId };
        takeoverBannerUntil = playbackMs + TAKEOVER_BANNER_MS;
        playPixelSfx('buzzer');
      }
      // Event audio. Above 4x the beats blur together into a machine-gun
      // rattle, so the one-shots drop out and only the crowd bed remains.
      if (fr.a.sfx && speed <= 4) playPixelSfx(fr.a.sfx);
      if (fr.a.period > lastQuarterSeen) {
        // The quarter always advances and the horn always sounds; only the
        // card and the pause it forces are motion effects.
        if (!reduceMotion) {
          quarterCard = {
            text: 'END OF ' + periodLabel(lastQuarterSeen),
            scoreLine: homeTeam.id + ' ' + fr.a.score[0] + ' — ' + awayTeam.id + ' ' + fr.a.score[1]
          };
          hitchMs = Math.max(hitchMs, 1500);
        }
        lastQuarterSeen = fr.a.period;
        playPixelSfx('buzzer');
        // Halftime is the crossing INTO period 3 — the end of the second.
        // Guarded by lastQuarterSeen, which only ever advances, so this fires
        // once per game rather than on every frame of the boundary.
        if (lastQuarterSeen === 3) maybeRunHalftimeDialogue();
      }
      lastEffectKfT = fr.a.t;
    }

    // impact shake: everything on the canvas jolts for ~150ms
    let shakeX = 0, shakeY = 0;
    if (playbackMs - shakeStartMs < 150) {
      shakeX = Math.round(Math.sin(playbackMs / 9) * 2);
      shakeY = Math.round(Math.cos(playbackMs / 7));
    }
    // A LANDING IS A VERTICAL EVENT, and that is why it does not reuse the
    // shake above. The collision shake rattles both axes on a ringing sine,
    // which is right for two bodies meeting and wrong for one coming down: feet
    // hitting the floor drive the picture down once and let it settle. A half
    // sine does exactly that — it starts at zero, so it cannot pop on the frame
    // it arms, and returns to zero, so it cannot leave the camera offset.
    const landAge = playbackMs - landShakeStartMs;
    if (landAge >= 0 && landAge < LAND_SHAKE_MS) {
      shakeY += Math.round(Math.sin((landAge / LAND_SHAKE_MS) * Math.PI) * 2);
    }
    // The crossover's drag. Peaks immediately and eases back, so the picture
    // gets pulled by the cut and then recovers — the opposite shape to the
    // landing's half sine, because a landing is an arrival and this is a
    // departure.
    const crossAge = playbackMs - crossNudgeStartMs;
    if (crossAge >= 0 && crossAge < CROSS_NUDGE_MS) {
      shakeX += Math.round(crossNudgeDir * 2 * Math.pow(1 - crossAge / CROSS_NUDGE_MS, 2));
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);
    // Snap zoom on a highlight. Inside the shake transform and before the
    // sprites, so the court and players scale together; the in-canvas
    // scoreboard is painted after ctx.restore() below and is left untouched.
    const impactZoomNow = impactZoom(impactRealMs, PIXEL_STAGE.w, PIXEL_STAGE.h);
    if (impactZoomNow) {
      // Centre on cx/cy rather than pinning it in place. Zooming about a fixed
      // point leaves the subject wherever it already sat, which for a poster is
      // the rim — 14px from the edge — so it framed the dunk in the corner.
      ctx.translate(PIXEL_STAGE.w / 2, PIXEL_STAGE.h / 2);
      ctx.scale(impactZoomNow.scale, impactZoomNow.scale);
      ctx.translate(-impactZoomNow.cx, -impactZoomNow.cy);
    }
    ctx.drawImage(courtCanvas, 0, 0);

    const excitement = Math.max(0, 1 - (playbackMs - excitementStartMs) / 1800);
    drawCrowd(ctx, playbackMs, reduceMotion ? 0 : excitement, excitementIsHome ? 1 : 0);
    pixelAudioExcitement(excitement * (excitementIsHome ? 1 : 0.25));
    pushCommentary(fr.a);

    // is the current ball sequence a shot (heading to a rim) or a pass?
    const shotComingAt = function (idx) {
      const la = kfs[Math.min(idx + 2, kfs.length - 1)];
      return la.ball.holder === null && distToNearestHoop(la.ball) < 20;
    };
    const shotComing = shotComingAt(kfIndex);

    // Who is airborne, and how high. Resolved once per frame rather than per
    // sprite because the ball needs it too.
    const lifts = resolveLifts(fr.a, fr.b, fr.f, reduceMotion);
    const dunkerId = lifts.dunkerId, dunkerLift = lifts.dunkerLift;
    const jumperId = lifts.jumperId, jumperLift = lifts.jumperLift;
    const jumpFollow = lifts.jumpFollow;
    const closerId = lifts.closerId;
    // The layup's phase marker, for the finishing side. Read off whichever of
    // the two bracketing keyframes actually carries it, the same way the ids
    // above are resolved — on the release beat only `a` has it.
    const closeMark = (fr.a.close && fr.a.close.id ? fr.a.close : (fr.b.close || null));


    // Who just got crossed over. The stumble starts on the CUT — he is still
    // upright while he bites on the jab — and holds through the windup so he
    // is visibly beaten while the shot goes up, not just displaced.
    const crossA = fr.a.cross;
    const stumbleId = (crossA && (crossA.phase === 'cross' || crossA.phase === 'clear' || crossA.phase === 'recover'))
      ? crossA.on : null;
    // The handler leaves streaks through the cut, and the man he beat flashes
    // once as it lands. Both exist because the move is over in a few hundred
    // milliseconds and the displacement alone was not carrying it — see the
    // four treatments compared before this was chosen.
    const crossStreakId = (crossA && (crossA.phase === 'cross' || crossA.phase === 'clear'))
      ? crossA.by : null;
    const crossFlashId = (crossA && crossA.phase === 'clear') ? crossA.on : null;

    // Timeline milliseconds this frame is worth. Clamped so a backgrounded tab
    // does not fast-forward on return; shared by the dribble clock and the body
    // springs so the ball and the bodies can never disagree about how much time
    // passed.
    const dtMsTimeline = Math.min(140, realDt * speed);

    // The live dribble, for whoever has the ball. Resolved ONCE here and read by
    // both the ball and the sprite's pumping arm, so they can never disagree
    // about which hand has it. Computed before the sprite loop only because the
    // sprite loop runs first; the inputs are identical.
    //
    // `drib` is the choreographer's per-beat marker: which named move is
    // playing and how far through it we are. While one is playing the free
    // clock is HELD — the move IS the dribble, and a metronome running
    // underneath it would drag the ball's starting hand around mid-move — and
    // when the string ends the clock resumes an era on, in the hand the move
    // actually finished in.
    const dribbleHolder = fr.a.ball.holder;
    const dribbleSmooth = dribbleHolder && smooth[dribbleHolder];
    const dribMark = fr.a.drib && dribbleHolder ? fr.a.drib : null;
    if (dribMark) {
      dribbleMove = { move: dribMark.move, n: dribMark.n, u: dribMark.i + fr.f };
    } else {
      if (dribbleMove) dribbleU = dribbleClockAfterMove(dribbleU, dribbleMove.move, dribbleMove.n);
      dribbleMove = null;
      // ...at HIS tempo, in THIS situation. Every player used to pound it out
      // on the same metronome, which is the same tell the idle breathing
      // already avoids by giving each man his own period — and then every
      // player kept his own rhythm regardless of whether he was being picked
      // up full-court or walking it up alone.
      //
      // The nearest opponent is read off the smoothed bodies, which at this
      // point in the frame still hold last frame's positions. That is fine and
      // deliberate: a 16ms-old pressure reading cannot be seen, and moving the
      // clock step after the springs would change the order the ball and the
      // bodies are resolved in, which is a much larger thing to disturb.
      let pressure = 0;
      if (dribbleSmooth && dribbleHolder) {
        const myTeam = teamById[dribbleHolder];
        let nearest = Infinity;
        Object.keys(smooth).forEach(function (id) {
          if (id === dribbleHolder || teamById[id] === myTeam) return;
          const o = smooth[id];
          const d = Math.sqrt(Math.pow(o.x - dribbleSmooth.x, 2) +
                              Math.pow(o.y - dribbleSmooth.y, 2));
          if (d < nearest) nearest = d;
        });
        pressure = pressureFrom(nearest);
      }
      const holderAttrs = playerById[dribbleHolder] && playerById[dribbleHolder].attributes;
      dribbleU = stepDribbleClock(dribbleU, dtMsTimeline,
        !!(dribbleSmooth &&
           Math.sqrt(dribbleSmooth.vx * dribbleSmooth.vx + dribbleSmooth.vy * dribbleSmooth.vy) > 6),
        handlerTempo(dribbleHolder, holderAttrs && holderAttrs.ballHandling, pressure));
    }
    const dribbleState = dribbleSmooth ? dribbleNow(dribbleU, dribbleMove) : null;

    const ids = Object.keys(fr.a.pos).filter(function (id) { return fr.b.pos[id]; });
    const onCourtNow = {};

    // Track who is on offense so defenders know which way to pressure.
    if (fr.a.ball.holder && teamById[fr.a.ball.holder]) {
      lastOffenseTeam = teamById[fr.a.ball.holder];
      lastBallActor = fr.a.ball.holder;
    }
    // Live ball position from the previous frame drives defensive pressure.
    const ballRef = fr.a.ball.holder && smooth[fr.a.ball.holder]
      ? { x: smooth[fr.a.ball.holder].x, y: smooth[fr.a.ball.holder].y }
      : { x: fr.a.ball.x, y: fr.a.ball.y };

    // Advance every player's spring toward its keyframe target. Substepped
    // below so the clamp on dtMsTimeline doesn't distort the motion.
    const dtTimeline = dtMsTimeline / 1000;
    ids.forEach(function (pid) {
      const pa = fr.a.pos[pid];
      const pb = fr.b.pos[pid];
      let tx = pixelLerp(pa[0], pb[0], fP);
      let ty = pixelLerp(pa[1], pb[1], fP);

      // defenders shade toward the ball; the effect is small but constant,
      // so the weak side is never frozen between events
      if (teamById[pid] && teamById[pid] !== lastOffenseTeam) {
        const ddx = ballRef.x - tx;
        const ddy = ballRef.y - ty;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const pull = Math.min(7, dd * 0.09);
        tx += (ddx / dd) * pull;
        ty += (ddy / dd) * pull;
      }

      let s = smooth[pid];
      if (!s) {
        // new on court: start at the sideline so entering players jog on
        // (on the opening possession this is the whole team taking the floor)
        s = smooth[pid] = {
          x: tx, y: suppressEntries ? ty : sidelineY, vx: 0, vy: 0,
          omega: 15 + (pid.charCodeAt(0) % 5) * 0.9 // slight per-player variation
        };
      }
      // Acceleration, for the lean and the plant. Taken across the SAME step
      // the spring just integrated rather than between drawn frames, because
      // dtTimeline is what the spring actually moved through — at 8x a drawn
      // frame is eight times the timeline, and dividing by the wrong one scales
      // every player's lean by the playback speed.
      const preVx = s.vx, preVy = s.vy;
      stepSpring(s, tx, ty, dtTimeline);
      if (dtTimeline > 0) {
        s.ax = (s.vx - preVx) / dtTimeline;
        s.ay = (s.vy - preVy) / dtTimeline;
      }
      onCourtNow[pid] = true;
    });

    // The choreographer guarantees separation at keyframe positions, but the
    // springs interpolate independently and can pass bodies through each
    // other in between — so re-separate the DRAWN positions each frame.
    // Pushing s.x/s.y (not a copy) means the shove persists and players
    // actually jostle instead of snapping back.
    const holderId = fr.a.ball.holder;
    // Remember where the springs put everyone, so the shove below can be
    // bounded: relaxation is unbounded by nature (a tight cluster can throw a
    // body a long way in one frame), and an unbounded shove is a teleport no
    // matter how physically motivated it is.
    const preSep = {};
    ids.forEach(function (pid) { preSep[pid] = [smooth[pid].x, smooth[pid].y]; });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const A = smooth[ids[i]];
          const B = smooth[ids[j]];
          let dx = B.x - A.x;
          let dy = B.y - A.y;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d >= 11) continue;
          if (d < 0.01) { dx = 1; dy = ((i + j) % 2) ? 1 : -1; d = 1.4; }
          const need = (11 - d) / d * 0.5;
          const aShare = ids[i] === holderId ? 0 : (ids[j] === holderId ? 1 : 0.5);
          const bShare = ids[j] === holderId ? 0 : (ids[i] === holderId ? 1 : 0.5);
          A.x -= dx * need * aShare; A.y -= dy * need * aShare;
          B.x += dx * need * bShare; B.y += dy * need * bShare;
        }
      }
    }

    // Clamp each body's total separation shift for this frame.
    ids.forEach(function (pid) {
      const s = smooth[pid];
      const dx = s.x - preSep[pid][0];
      const dy = s.y - preSep[pid][1];
      const mag = Math.sqrt(dx * dx + dy * dy);
      const cap = MAX_SEPARATION_SHIFT_PX;
      if (mag > cap) {
        const k = cap / mag;
        s.x = preSep[pid][0] + dx * k;
        s.y = preSep[pid][1] + dy * k;
      }
    });

    // CONTACT. The shove above is a measurement of two bodies meeting that
    // nobody was reading — both were redrawn as though nothing had touched, so
    // a crowded drive was sprites sliding through each other. Stamped here,
    // after the clamp, so it reflects the shove actually applied.
    ids.forEach(function (pid) {
      const s = smooth[pid];
      const dx = s.x - preSep[pid][0], dy = s.y - preSep[pid][1];
      const strength = contactStrength(Math.sqrt(dx * dx + dy * dy));
      if (strength <= 0) return;
      const prev = contactAt[pid];
      // Keep the HARDER of an in-flight bump and a new one, rather than letting
      // a glancing touch reset a real collision's accent to almost nothing.
      if (prev && contactDecay(playbackMs - prev.at) * prev.strength > strength) return;
      contactAt[pid] = { at: playbackMs, strength: strength, dirX: dx >= 0 ? 1 : -1 };
    });

    // sorted top-to-bottom so nearer sprites overlap farther ones
    ids.sort(function (i1, i2) { return smooth[i1].y - smooth[i2].y; });

    ids.forEach(function (pid) {
      const s = smooth[pid];
      // real velocity drives the gait, so animation matches actual motion
      const vmag = Math.sqrt(s.vx * s.vx + s.vy * s.vy); // px per timeline-second
      const moving = vmag > 6;
      if (s.vx > 4) facingById[pid] = 1;
      else if (s.vx < -4) facingById[pid] = -1;

      const phase = (pid.charCodeAt(0) * 131 + pid.length * 37) % 977;
      const stride = Math.max(80, 260 - vmag * 1.6); // faster feet when moving faster
      // players are never perfectly still: a slow weight shift on an
      // individual period keeps standing bodies alive
      // Positional idle. Raised from 0.7px because drawPlayerSprite rounds x,
      // so anything under 1px rounded away and the "sway" was invisible. Two
      // axes on different periods so it drifts rather than sliding on a rail —
      // 64% of player-beats hold an IDENTICAL keyframe position, and this plus
      // the pose shift is what stops that reading as a freeze frame.
      const sway = moving ? 0 : Math.sin((playbackMs + phase * 3) / 900) * 1.5;
      const swayY = moving ? 0 : Math.cos((playbackMs + phase * 5) / 1240) * 0.9;
      const x = s.x + sway;
      const y = s.y + swayY;

      const isHolder = fr.a.ball.holder === pid;
      const isDunkerNow = pid === dunkerId;
      const isJumperNow = pid === jumperId;
      // The jump phases own the shooter outright now; the old 60ms-window
      // detection would otherwise fight them for the pose.
      const isCloserNow = pid === closerId;
      // An UNMARKED finish at the rim — a tip-in, a putback — still falls back
      // to the old heuristic. A marked layup owns the branch by identity.
      const shooting = !isDunkerNow && !isJumperNow && !isCloserNow &&
        isHolder && fr.b.ball.holder === null && shotComing;
      // A dunk owns the shooter's vertical outright: its arc is three times a
      // jumper's and runs past the release, so the two must not both apply.
      // anticipation: dip into the legs before rising into the shot
      const jumpLift = isDunkerNow
        ? dunkerLift
        : (isJumperNow ? jumperLift
          : (isCloserNow ? lifts.closerLift : (shooting ? closeLift(fr.f) : 0)));
      // FEET vs HIPS. A negative lift is a knee bend, and drawing it as `y -
      // lift` put the whole sprite — feet included — below its own shadow for
      // the whole anticipation of every shot in the game. `foot` is how far off
      // the floor he actually is; `crouch` is the bend, and the sprite absorbs
      // it by folding rather than sinking.
      const footLift = Math.max(0, jumpLift);

      // THE LANDING, caught as a transition between drawn frames rather than
      // read off the lift curve. See justLanded() for why: the window in which
      // a dunk's curve reports "down" is 3ms wide, and a renderer stepping
      // 16.7ms walks over it four times in five.
      const prevFoot = prevFootById[pid];
      prevFootById[pid] = footLift;
      if (justLanded(prevFoot, footLift)) {
        const kind = isDunkerNow ? 'dunk' : (isCloserNow ? 'close' : 'jump');
        landedAt[pid] = { at: playbackMs, kind: kind };
        // A landing is an ANIMATION event, so it is announced from the frame
        // the feet actually touch rather than from a keyframe's `sfx` field —
        // the beat boundary can be a tenth of a second away from the frame that
        // shows the contact.
        if (speed <= 4) playPixelSfx(kind === 'dunk' ? 'landHard' : 'land');
        // ...and the floor takes it. Only a dunk landing shakes the camera: a
        // pull-up coming down four times a possession would be seasick, which
        // is the same reasoning that keeps blocks out of the zoom tier.
        if (!reduceMotion && kind === 'dunk' && speed < 8) landShakeStartMs = playbackMs;
        // ...and the floor gives. Only the hardest landing kicks dust, so it
        // stays an accent rather than a puff under every pull-up.
        if (!reduceMotion && kind === 'dunk') {
          spawnFloorDust(x, y, s.vx > 20 ? 1 : (s.vx < -20 ? -1 : 0));
        }
      }
      // The squash outlives the beat it happened on, so it is added to whatever
      // bend the current phase already asks for.
      const land = landedAt[pid];
      // WHICH landing. ui/pixelDunks.js has been classifying every dunk into
      // stumble / heavy / light / balance since it was written and the answer
      // has been stamped on every keyframe of the string and read by nobody:
      // four landings computed, one landing drawn.
      // Read straight off the frame rather than through `dunkMark`, which is
      // not declared until seventy lines below this. `ui-smoke` and all 63
      // validators passed with the reference in place — the temporal dead zone
      // only bites when a dunk is actually on screen, which is a thing only the
      // running game does.
      const landMark = (fr.a.dunk && fr.a.dunk.id ? fr.a.dunk : (fr.b.dunk || null));
      const landStyle = (landMark && landMark.landing) || 'balance';
      const landSquash = land
        ? landingSquash(playbackMs - land.at, land.kind, landStyle) : 0;
      // ...and a stumble carries him sideways while he sorts his feet out. The
      // other three land under control and get nothing, which is the point of
      // having four.
      const landLean = land
        ? landingLean(playbackMs - land.at, land.kind, landStyle, s.vx || 0) : 0;
      // ...and the dunker's own half of the rim collision, which happens in the
      // air and so cannot ride the landing channel. Stamped once when the slam
      // phase opens, the same way the landing is stamped once on contact.
      const rimHit = (isDunkerNow && rimHitAt[pid])
        ? rimHitSquash(playbackMs - rimHitAt[pid]) : 0;
      // ...and the plant. A man stopping hard folds into it, which is what turns
      // a sprint that simply ends into a sprint that is BROUGHT to an end. Only
      // on the floor: a body in the air has nothing to plant against.
      const braking = footLift > 0 ? 0 : brakingRate(s.vx, s.vy, s.ax || 0, s.ay || 0);
      // A skid hard enough to fold him kicks the floor too. Rate limited per
      // player, because braking is a per-frame quantity and a man stopping over
      // six frames would otherwise spawn six puffs.
      if (!reduceMotion && braking > PLANT_ACCEL_FULL &&
          playbackMs - (lastDustAt[pid] || -Infinity) > 500) {
        lastDustAt[pid] = playbackMs;
        spawnFloorDust(x, y, s.vx >= 0 ? 1 : -1);
      }
      // The hesitation's coil. The ball's hold was only ever a ball behaviour,
      // so the man selling the fake stood bolt upright through it; this is his
      // half of the same beat, and it uncoils into the cut rather than
      // straightening on one frame (see `hesi` in moveDribble).
      const hesiCoil = (dribbleState && pid === dribbleHolder && footLift === 0)
        ? HESI_CROUCH_PX * (dribbleState.hesi || 0) : 0;
      // ...and the bump he just took. Only on the floor: two men colliding in
      // mid-air is a different animation the game does not have.
      const bump = contactAt[pid];
      const bumpAmt = (bump && footLift === 0)
        ? bump.strength * contactDecay(playbackMs - bump.at) : 0;
      // HOW TIRED HE IS and WHETHER HE JUST MISSED, both folded into the same
      // knee/waist channel the gather and the landing already use. A tired man
      // and a man who just watched one rim out have the same tell — the
      // shoulders go — and it is a fold at the waist, which is what `crouch`
      // draws.
      // Not while he is shooting or in the air: a tired man still extends
      // fully to shoot, and drooping the gather would be reading fatigue as
      // sloppiness rather than as posture.
      const energyNow = energyAt(energyById[pid],
        timeline.durationMs ? playbackMs / timeline.durationMs : 0);
      const droop = (jumpLift <= 0 && !shooting)
        ? fatigueLevel(energyNow) * FATIGUE_DROOP_PX : 0;
      // Read off the release marker rather than stamped: the marker already
      // carries the outcome and its own age, so there is no new state to keep
      // in sync and nothing to go stale on a seek.
      const jm = fr.a.jump;
      const missSlump = (jm && jm.phase === 'release' && jm.id === pid && !jm.made)
        ? shotSlump(fr.f * Math.max(1, fr.b.t - fr.a.t), false) : 0;
      const crouchPx = Math.max(0, -jumpLift) + landSquash + rimHit +
        plantCrouch(braking) + hesiCoil + CONTACT_CROUCH_PX * bumpAmt
        + droop + missSlump;
      // pose off actual height, not the beat name — he is still on the floor
      // during the gather, and the tucked legs would read as a bug there
      // Engaged as he LEAVES the floor, not 3px up. The pose is drawn at
      // `rising` now rather than at one end of it, so starting it early costs
      // nothing — at rising 0 it is the standing pose — and it is what removes
      // the snap between the two.
      // Engaged for the WHOLE dunk string, not from a lift threshold. The pose
      // is drawn at `rising` now, and at rising 0 that is the standing pose, so
      // there is nothing to switch on — which is the point.
      const dunkRising = lifts.dunkerRising || 0;
      const dunkPose = isDunkerNow && dunkRising > 0.01;
      // WHICH dunk, and where in its rotation he is. The marker rides every
      // phase of the string, so a seek into the middle of a 360 still knows it
      // is a 360.
      const dunkMark = (fr.a.dunk && fr.a.dunk.id ? fr.a.dunk : (fr.b.dunk || null));
      const theDunk = dunkMark && dunkMark.dunk ? dunkMark.dunk : null;
      // THE SPIN. A ten-pixel body cannot be drawn at an intermediate angle, so
      // a rotation is drawn as facing-right, back-to-camera, facing-left,
      // back-to-camera, facing-right. The back of the head is what sells the
      // quarter turn; without it a 360 is a sprite flipping, which reads as a
      // glitch rather than as a man turning.
      let spinFacing = 0, spinBack = false;
      if (theDunk && theDunk.spin && dunkPose && !reduceMotion) {
        const turns = (theDunk.spin / 360) * (lifts.dunkerRoute || 0);
        const q = (turns * 4) % 4;                 // quarter turns elapsed
        spinBack = (q >= 0.75 && q < 1.25) || (q >= 2.75 && q < 3.25);
        spinFacing = (q >= 1.25 && q < 2.75) ? -1 : 1;
      }
      // Same rule for the layup: the airborne pose starts once he is actually
      // airborne, so the gather is drawn as a man loading up rather than as a
      // man hanging with his knee up while his feet are on the floor.
      const layupPose = isCloserNow && jumpLift >= 3
        ? {
            side: (closeMark && closeMark.side) || 1,
            finish: (closeMark && closeMark.finish) || 'standard',
            // Full extension is reached at the top of the rise and held through
            // the release, so the arm arrives with the ball rather than after
            // it. Measured against THIS finish's apex — a floater tops out at
            // 6px and would otherwise never read as extended at all.
            extend: Math.max(0, Math.min(1,
              jumpLift / closeLiftTable(closeMark && closeMark.finish).rise))
          }
        : null;
      // THE APPROACH — the euro step and the spin, which happen on the floor
      // before any of the above. `approachLiftAt` returns null for every phase
      // that is not one of theirs, which is how a normal finish stays untouched.
      const apPhase = isCloserNow && closeMark && closeMark.approach ? closeMark.phase : null;
      const apKind = apPhase ? closeMark.approach : null;
      // How far through the WHOLE approach he is: each phase carries its own
      // share, so the two beats read as one continuous move rather than two.
      // Each phase owns half the move, so the two beats read as one turn
      // rather than two separate ones that both start from zero.
      const apU = apPhase
        ? Math.max(0, Math.min(1, ((closeMark.step || 0) - 0.5) + fr.f * 0.5))
        : 0;
      let turning = null, euroLean = 0;
      if (apKind === 'spin') {
        // Legs lead, torso follows — see spinTurn. Drawn as four states rather
        // than an angle, because a body ten px across has no intermediate one.
        const t = spinTurn(apU);
        const legs = turnFacing(t.legs, (closeMark && closeMark.side) || 1);
        const torso = turnFacing(t.torso, (closeMark && closeMark.side) || 1);
        turning = { legs: legs.facing };
        spinFacing = torso.facing;
        spinBack = torso.back;
      } else if (apKind === 'euro') {
        // The weight goes one way and then the other, and the torso is what
        // says so — a euro drawn with an upright body is a man sidestepping.
        euroLean = (apPhase === 'euroOne' ? -1 : 1) *
          ((closeMark && closeMark.side) || 1) * EURO_LEAN_PX;
      }
      // ground shadow stays planted even when the sprite lifts
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(Math.round(x) - 4, Math.round(y) - 1, 8, 2);
      const p = playerById[pid];
      // Mid-takeover marker: a ring under the man, drawn beneath the sprite so
      // it reads as court, not costume. A team ultimate marks all five of that
      // side, which is what makes a team run visible as a team run.
      const tkSide = fr.a.takeovers || {};
      const tkHere = (tkSide.home && tkSide.home.playerId === pid) ||
                     (tkSide.away && tkSide.away.playerId === pid) ||
                     isTeamTakeoverMate(pid, tkSide, teamById);
      if (tkHere) {
        const pulse = 0.45 + 0.25 * Math.sin(playbackMs / 180);
        ctx.strokeStyle = 'rgba(255, 208, 92, ' + pulse.toFixed(2) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(x), Math.round(y), 7, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Streaks trailing the handler through the cut. Drawn BEFORE the sprite
      // and behind him along the path he came from, so they read as motion he
      // left rather than as something attached to him. Suppressed under
      // reduced motion, where the whole point is fewer moving pixels.
      if (!reduceMotion && pid === crossStreakId && lastPosById[pid]) {
        const bx = lastPosById[pid][0] - x, by2 = lastPosById[pid][1] - y;
        const len = Math.sqrt(bx * bx + by2 * by2);
        if (len > 0.6) {
          ctx.fillStyle = 'rgba(255,255,255,0.30)';
          for (let s = 1; s <= 4; s++) {
            const k = s * 3.2 / len;
            ctx.fillRect(Math.round(x + bx * k) - 5, Math.round(y + by2 * k) - 12, 10, 1);
          }
        }
      }
      // And the beaten man flashes once as the cut lands.
      if (!reduceMotion && pid === crossFlashId) {
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fillRect(Math.round(x) - 7, Math.round(y) - 26, 14, 28);
      }
      // ONE decision about which pose he is in, resolved by posePriority
      // instead of by a pile of negations that every new pose had to be added
      // to. `handling` is the one non-pose question left: he can be dribbling
      // and running at once, and only the priority decides which the arms
      // belong to.
      const handling = !!(dribbleState && pid === dribbleHolder);
      // THE DEFENSIVE HALF OF EVERY POSSESSION, which was drawn with the idle
      // and running poses and nothing else. `lastOffenseTeam` and the live ball
      // position are already tracked up in the spring loop for the shading, so
      // everything this needs was on hand — it was simply never asked for.
      const onD = !!(teamById[pid] && lastOffenseTeam && teamById[pid] !== lastOffenseTeam);
      const dBall = onD
        ? Math.hypot(ballRef.x - (s.x || 0), ballRef.y - (s.y || 0)) : Infinity;
      // Something to contest: whoever has it is rising into a finish.
      const goingUp = !!(fr.a.jump || fr.a.dunk || fr.a.close);
      const stance = onD
        ? defenseStance(dBall, Math.hypot(s.vx || 0, s.vy || 0), goingUp)
        : { depth: 0, contest: 0 };
      const pose = posePriority({
        dunking: dunkPose,
        layup: !!layupPose,
        following: isJumperNow && jumpFollow,
        shooting: shooting || (isJumperNow && jumpLift > -1),
        stumbling: !reduceMotion && pid === stumbleId,
        dribbling: handling,
        defending: stance.depth > 0.05,
        moving: moving
      });
      drawPlayerSprite(ctx, x, y - footLift, colorsById[pid], p ? p.jerseyNumber : '', {
        heightIn: p ? p.heightIn : null,
        crouch: crouchPx,
        layup: pose === 'layup' ? layupPose : null,
        // TWO leans, added and then clamped.
        //
        // The handler's weight rides over the ball (only the man actually
        // dribbling — a ball-lean on a body with no ball beside it is just the
        // sprite standing crooked). Everyone on the floor also leans into his
        // own acceleration, which is where the stepback's fight against the
        // backward push comes from, and the body English through a hard change
        // of direction, and the plant at the end of a sprint.
        //
        // Clamped rather than summed freely: a handler crossing over while
        // braking hard can otherwise ask for 4px of lean on a 10px body, which
        // stops reading as weight and starts reading as a fall.
        lean: Math.max(-MOMENTUM_LEAN_PX, Math.min(MOMENTUM_LEAN_PX,
          (pose === 'dribbling' ? dribbleLean(dribbleState) * (facingById[pid] || 1) : 0)
          + (footLift > 0 ? 0 : momentumLean(s.ax || 0))
          // Knocked the way he was shoved: the upper body goes with the
          // contact while the feet stay where they were planted.
          + (bump ? CONTACT_LEAN_PX * bumpAmt * bump.dirX : 0)
          // ...and the euro's weight transfer, which IS the move.
          + euroLean + landLean)),
        turning: turning,
        frame: Math.floor((playbackMs + phase) / stride) % 2,
        // each player breathes on his own period, so ten sprites never pulse
        // in unison — the give-away that it is one global timer
        idleFrame: Math.floor((playbackMs + phase * 11) / (760 + (phase % 7) * 90)) % 2,
        // rising into the shot reads as arms-up; after the ball is gone he
        // holds the follow-through, which is what a jumper actually looks like
        shooting: pose === 'shooting',
        following: pose === 'following',
        defending: pose === 'defending'
          ? { depth: stance.depth, contest: stance.contest,
              // he shows his hands on the side the ball is
              side: ballRef.x >= (s.x || 0) ? 1 : -1 }
          : false,
        dunking: pose === 'dunking'
          ? (theDunk
              ? { hands: theDunk.hands, path: theDunk.path,
                  takeoff: theDunk.takeoff, reverse: !!theDunk.reverse,
                  // How far above his feet the RIM is, so the arm can stretch to
                  // meet it — not where the ball is this instant. Driven off the
                  // ball, a windmill's arm pumped up and down as the ball swung
                  // round beside him. His hand is going to the rim for the whole
                  // flight, and at the slam the two are the same place anyway.
                  ballUp: RIM_ABOVE_FLOOR - lifts.dunkerFoot,
                  rising: dunkRising, air: lifts.dunkerAir || 0,
                  // where his HAND is: the ball's running-maximum height, so the
                  // arm leaves the carry position exactly as the ball does
                  armUp: dunkArmHeight(theDunk.path, lifts.dunkerRoute || 0,
                    lifts.dunkerFoot) }
              : true)
          : false,
        backToCamera: pose === 'dunking' && spinBack,
        stumbling: pose === 'stumbling',
        // Only while he is actually handling it — a man gathering into a shot,
        // rising, or going up to dunk is not dribbling any more, and those
        // poses own the arms. The ball's own facing is applied here so `side`
        // reaches the sprite in screen space.
        dribbling: pose === 'dribbling'
          ? {
              phase: dribbleState.phase,
              side: dribbleState.sign * (facingById[pid] || 1),
              crossing: dribbleState.crossing,
              through: dribbleState.through
            }
          : null,
        highlight: isHolder,
        facing: (pose === 'dunking' && spinFacing)
          ? spinFacing * (facingById[pid] || 1)
          : (facingById[pid] || 0),
        moving: moving
      });
      lastPosById[pid] = [x, y];
    });

    // players swapped out jog off to the sideline before disappearing
    Object.keys(onCourtPrev).forEach(function (pid) {
      if (onCourtNow[pid]) return;
      if (!suppressEntries && lastPosById[pid]) {
        leavers.push({ pid: pid, x: lastPosById[pid][0], y: lastPosById[pid][1], t0: playbackMs });
      }
      delete smooth[pid]; // a later re-entry jogs back in from the sideline
    });
    onCourtPrev = onCourtNow;
    for (let i = leavers.length - 1; i >= 0; i--) {
      const L = leavers[i];
      const el = (playbackMs - L.t0) / EXIT_MS;
      if (el >= 1 || el < 0) { leavers.splice(i, 1); continue; }
      const ly = pixelLerp(L.y, sidelineY, easeInOut(el));
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(Math.round(L.x) - 4, Math.round(ly) - 1, 8, 2);
      const lp = playerById[L.pid];
      drawPlayerSprite(ctx, L.x, ly, colorsById[L.pid], lp ? lp.jerseyNumber : '', {
        heightIn: lp ? lp.heightIn : null,
        frame: Math.floor(playbackMs / 110) % 2,
        moving: true,
        facing: 0
      });
    }

    // ball: dribbled by the holder, held high when shooting, otherwise in
    // flight with a distance-scaled arc and its own ground shadow
    const holder = fr.a.ball.holder;
    // Where the ball left the hand, for a flight that has just begun. Null on
    // every other frame, and the ball's own path takes over.
    const prevKf = kfIndex > 0 ? kfs[kfIndex - 1] : null;
    const thrower = prevKf && prevKf.ball.holder;
    // The thrower's SMOOTHED position, computed once when the flight begins and
    // held for the rest of it.
    //
    // The first version used his keyframe position instead, reasoning that a
    // frozen point beats an exact one because the smoothed body keeps moving
    // after he lets go and the launch would crawl along behind him. Both
    // halves of that were right and the conclusion was still wrong: the HELD
    // ball hangs off the smoothed body, so anchoring the flight to the
    // keyframe reintroduced the spring's lag as a snap at the release —
    // measured on rendered frames at 18px on a free throw. Caching gets the
    // exactness and the frozen point at the same time.
    if (kfIndex !== launchCache.idx) {
      const throwerHand = thrower && smooth[thrower];
      launchCache = {
        idx: kfIndex,
        value: throwerHand ? launchPoint({
          prev: prevKf, a: fr.a,
          hand: throwerHand,
          facing: facingById[thrower] || 1,
          shotComing: shotComingAt(kfIndex - 1),
          reduceMotion: reduceMotion, dribbleU: dribbleU, dribbleMove: dribbleMove
        }) : null
      };
    }
    const launch = launchCache.value;
    // The arrival is the opposite case and needs NO freezing: the ball should
    // home in on where the catcher actually is, and he is still running. So it
    // is recomputed every frame off his smoothed position, which is the body
    // the ball has to end up in the hands of.
    const catcher = fr.b.ball.holder;
    const catcherHand = catcher && smooth[catcher];
    const arrival = catcherHand ? arrivalPoint({
      b: fr.b, c: kfs[Math.min(kfIndex + 2, kfs.length - 1)],
      hand: catcherHand,
      facing: facingById[catcher] || 1,
      shotComing: shotComingAt(kfIndex + 1),
      reduceMotion: reduceMotion, dribbleU: dribbleU, dribbleMove: dribbleMove
    }) : null;
    const bp = ballPosition({
      a: fr.a, b: fr.b, f: fr.f,
      holder: holder,
      hand: (holder && smooth[holder]) || null,
      facing: facingById[holder] || 1,
      lifts: lifts,
      shotComing: shotComing,
      dunkPath: dunkBallPath,
      reduceMotion: reduceMotion,
      dribbleU: dribbleU, dribbleMove: dribbleMove,
      launch: launch,
      arrival: arrival
    });
    const bx = bp.bx, by = bp.by, groundY = bp.groundY;
    // The ball's own screen velocity, for the deformation. Taken between drawn
    // frames rather than off the keyframes, because what deforms is the thing
    // on screen — a held ball riding a sprinting handler is genuinely moving
    // fast even though its keyframe barely changes.
    let ballVx = 0, ballVy = 0;
    if (prevBallDraw && realDt > 0) {
      ballVx = (bx - prevBallDraw.x) * 1000 / realDt;
      ballVy = (by - prevBallDraw.y) * 1000 / realDt;
    }
    prevBallDraw = { x: bx, y: by };
    // thud on the floor contact, keyed off the same phase the eye sees
    if (bp.bouncePhase !== null) {
      if (speed <= 2 && bp.bouncePhase < 0.12 && lastBouncePhase >= 0.12) playPixelSfx('dribble');
      lastBouncePhase = bp.bouncePhase;
    }
    // Flattened only when it has earned it: genuinely fast, or driven into the
    // floor as part of a named move. See ballSquash for why an ordinary dribble
    // bounce deliberately does not qualify.
    const hardBounce = !!(dribbleState && dribbleState.crossing);
    const ballDeform = reduceMotion ? null : {
      squash: ballSquash(ballVx, ballVy, hardBounce, bp.bouncePhase),
      vx: ballVx, vy: ballVy
    };
    if (bp.mode === 'flight') {
      ballSpin += (Math.abs(fr.b.ball.x - fr.a.ball.x) > 2 ? 0.6 : 0.25) * (fr.b.ball.x >= fr.a.ball.x ? 1 : -1);
    }
    // Legibility at speed. At 1x you can follow the ball unaided; at 8x it is a
    // smear, so the trail and the handler ring fade IN as speed rises rather
    // than being always-on clutter. Both are drawn BEFORE the ball and its
    // shadow, so they can never obscure the thing they exist to point at.
    //
    // Suppressed entirely under reduced motion, alongside the freezes and zooms
    // — a trail is exactly the kind of moving decoration that setting is for.
    if (!reduceMotion && speed > 1) {
      // 0 at 1x, 1 at 8x. Everything below scales off this one number so the
      // effect has a single intensity knob rather than three.
      const trailStrength = Math.min(1, (speed - 1) / 7);

      ballTrail.push({ x: bx, y: by });
      while (ballTrail.length > BALL_TRAIL_MAX) ballTrail.shift();

      for (let i = 0; i < ballTrail.length - 1; i++) {
        const age = (i + 1) / ballTrail.length;       // 0 oldest, 1 newest
        // WHITE, not the ball's own orange. Measured on the live canvas: the
        // court floor is (189,138,66) and a warm 255,190,90 trail blends to
        // (219,161,77) — thirty points of red from the floor it sits on, which
        // is invisible. White against a brown court moves ~113 points in blue,
        // and reads as a motion streak rather than as a second ball.
        ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * age * trailStrength).toFixed(3) + ')';
        const r = age < 0.6 ? 1 : 2;
        ctx.fillRect(Math.round(ballTrail[i].x) - (r >> 1), Math.round(ballTrail[i].y) - (r >> 1), r, r);
      }

      // A ring under whoever is holding it. Drawn on the FLOOR (groundY) rather
      // than at the ball, so it reads as "this player" and not as a second ball.
      if (holder) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * trailStrength).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(bx), Math.round(groundY) + 1, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (ballTrail.length) {
      // Dropping back to 1x (or into reduced motion) must clear the tail rather
      // than leave a frozen streak on the floor.
      ballTrail.length = 0;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx) - 1, Math.round(groundY), 3, 1);
    drawBall(ctx, bx, by, holder ? undefined : ballSpin, ballDeform);

    // Referee: trails the play along the baseline side, always a step behind
    // the ball, which is both what officials do and a cheap way to keep the
    // edge of the frame alive.
    refX += ((bx - 26) - refX) * Math.min(1, dtTimeline * 3);
    refY += ((PIXEL_STAGE.court.y + PIXEL_STAGE.court.h - 12) - refY) * Math.min(1, dtTimeline * 3);
    const refClamped = Math.max(PIXEL_STAGE.court.x + 4, Math.min(PIXEL_STAGE.court.x + PIXEL_STAGE.court.w - 4, refX));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(Math.round(refClamped) - 3, Math.round(refY) - 1, 6, 2);
    drawPlayerSprite(ctx, refClamped, refY, REF_COLORS, '', {
      frame: Math.floor(playbackMs / 200) % 2,
      moving: Math.abs((bx - 26) - refX) > 3,
      facing: 0
    });

    // Net splash: pixel flecks falling out of the net after a make.
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      const age = playbackMs - q.t0;
      if (age < 0 || age > 700) { particles.splice(i, 1); continue; }
      ctx.fillStyle = q.color;
      ctx.globalAlpha = Math.max(0, 1 - age / 700);
      ctx.fillRect(
        Math.round(q.x0 + q.vx * age),
        Math.round(q.y0 + q.vy * age + 0.00002 * age * age), // gravity
        1, 1
      );
      ctx.globalAlpha = 1;
    }

    // Rim flex: the hoop itself springs after a make (harder on a dunk),
    // redrawn over the static court art.
    // (the "harder on a dunk" part of that sentence was a comment describing
    // behaviour the code did not have — a jumper and a two-hand slam flexed
    // the rim by exactly the same 2px for exactly the same 340ms)
    const rimMs = rimShakeHard ? 470 : 340;
    const rimAmp = rimShakeHard ? 3.5 : 2;
    const rimAge = playbackMs - rimShakeStart;
    if (rimAge >= 0 && rimAge < rimMs) {
      const hoop = PIXEL_STAGE.hoops[rimShakeSide];
      const flex = Math.sin(rimAge / 34) * Math.max(0, 1 - rimAge / rimMs) * rimAmp;
      ctx.fillStyle = '#c9974f'; // clear the painted rim
      ctx.fillRect(hoop.x - 3, hoop.y - 3, 7, 7);
      ctx.fillStyle = '#e05a2b';
      ctx.fillRect(hoop.x - 2, hoop.y - 2 + flex, 5, 5);
      ctx.fillStyle = '#c9974f';
      ctx.fillRect(hoop.x - 1, hoop.y - 1 + flex, 3, 3);
      // net swaying under the rim
      ctx.fillStyle = 'rgba(244,234,216,0.75)';
      ctx.fillRect(Math.round(hoop.x - 1 + flex), hoop.y + 3, 1, 3);
      ctx.fillRect(Math.round(hoop.x + 1 + flex * 0.6), hoop.y + 3, 1, 2);
    }

    // Make flash: an expanding ring at the rim while a made-basket keyframe
    // is current (its ball position sits on the hoop).
    if (isMakeKeyframe(fr.a) && fr.f < 0.6) {
      const r = 3 + fr.f * 10;
      ctx.strokeStyle = 'rgba(255, 235, 59, ' + (1 - fr.f / 0.6).toFixed(2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(fr.a.ball.x, fr.a.ball.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ball-handler name label
    if (holder && playerById[holder] && smooth[holder]) {
      const hp = [smooth[holder].x, smooth[holder].y];
      const label = playerById[holder].name;
      ctx.font = '8px monospace';
      const w = ctx.measureText(label).width + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(hp[0] - w / 2, hp[1] + 3, w, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, hp[0] - w / 2 + 2, hp[1] + 11);
    }
    // Radial lines are anchored to the action, so they belong inside the zoom.
    drawImpactLines(ctx, impactRealMs);
    ctx.restore();

    // The flash is full-frame, so it goes outside the zoom and the shake —
    // inside them it would scale and slide with the court.
    drawImpactFlash(ctx, impactRealMs, PIXEL_STAGE.w, PIXEL_STAGE.h);

    // In-scene pixel scoreboard, drawn unshaken in the same pixel grid as
    // the court (an HTML bar above the canvas read as chrome bolted onto
    // the art rather than part of the arena).
    const boardW = 150, boardH = 26, boardX = Math.round((PIXEL_STAGE.w - boardW) / 2), boardY = 3;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.92)';
    ctx.fillRect(boardX, boardY, boardW, boardH);
    ctx.strokeStyle = '#4a5262';
    ctx.strokeRect(boardX + 0.5, boardY + 0.5, boardW - 1, boardH - 1);
    // team color chips either side
    ctx.fillStyle = homeTeam.colors.primary;
    ctx.fillRect(boardX + 3, boardY + 3, 3, boardH - 6);
    ctx.fillStyle = awayTeam.colors.primary;
    ctx.fillRect(boardX + boardW - 6, boardY + 3, 3, boardH - 6);

    drawPixelText(ctx, boardX + 10, boardY + 5, homeTeam.id, '#cfd6e4', 1);
    drawPixelText(ctx, boardX + boardW - 10 - pixelTextWidth(awayTeam.id, 1), boardY + 5, awayTeam.id, '#cfd6e4', 1);

    // scores pop (scale up briefly) when they change
    const homeScoreStr = String(fr.a.score[0]);
    const awayScoreStr = String(fr.a.score[1]);
    const popAgeH = playbackMs - scorePopAt[0];
    const popAgeA = playbackMs - scorePopAt[1];
    const hScale = popAgeH >= 0 && popAgeH < 320 ? 3 : 2;
    const aScale = popAgeA >= 0 && popAgeA < 320 ? 3 : 2;
    const hColor = hScale === 3 ? '#ffe45c' : '#ffffff';
    const aColor = aScale === 3 ? '#ffe45c' : '#ffffff';
    drawPixelText(ctx, boardX + 10, boardY + 12, homeScoreStr, hColor, hScale);
    drawPixelText(ctx, boardX + boardW - 10 - pixelTextWidth(awayScoreStr, aScale), boardY + 12, awayScoreStr, aColor, aScale);

    // quarter + clock down the middle
    const qText = periodLabel(fr.a.period);
    drawPixelText(ctx, boardX + (boardW - pixelTextWidth(qText, 1)) / 2, boardY + 4, qText, '#8fa0bd', 1);
    const clockText = fmtClock(fr.a.clock);
    drawPixelText(ctx, boardX + (boardW - pixelTextWidth(clockText, 2)) / 2, boardY + 12, clockText, '#cfd6e4', 2);
    // shot clock, small and amber, under the game clock; turns red late
    const scText = String(fr.a.shotClock === undefined ? '' : fr.a.shotClock);
    if (scText) {
      drawPixelText(ctx, boardX + (boardW - pixelTextWidth(scText, 1)) / 2, boardY + 20, scText,
        fr.a.shotClock <= 5 ? '#ff6b5c' : '#d8a13c', 1);
    }

    // Broadcast info strip: live scoring leaders and anyone in foul trouble.
    const snap = timeline.snapshots[fr.a.snap] || timeline.snapshots[0];
    if (snap && snap !== lastSnapRendered) {
      lastSnapRendered = snap;
      pixelRenderInfoStrip(document.getElementById('pixel-infostrip'), snap, playerById, function (side) {
        return getTeamById(side === 'home' ? session.homeTeamId : session.awayTeamId).colors.primary;
      });
    }

    // quarter-break card, drawn unshaken over everything
    // Takeover banner, over everything, for a couple of seconds after it fires.
    if (takeoverBanner && playbackMs < takeoverBannerUntil) {
      const label = takeoverBanner.name.toUpperCase();
      const who = (playerById[takeoverBanner.playerId] || {}).name || '';
      const w = Math.max(pixelTextWidth(label, 2), pixelTextWidth(who, 1)) + 24;
      const bx = Math.round((PIXEL_STAGE.w - w) / 2);
      ctx.fillStyle = 'rgba(12, 10, 6, 0.82)';
      ctx.fillRect(bx, 30, w, 34);
      ctx.strokeStyle = '#ffd05c';
      ctx.strokeRect(bx + 0.5, 30.5, w - 1, 33);
      drawPixelText(ctx, bx + (w - pixelTextWidth(label, 2)) / 2, 38, label, '#ffd05c', 2);
      drawPixelText(ctx, bx + (w - pixelTextWidth(who, 1)) / 2, 54, who, '#f4ead8', 1);
    } else if (takeoverBanner && playbackMs >= takeoverBannerUntil) {
      takeoverBanner = null;
    }

    if (quarterCard && hitchMs > 0) {
      ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
      ctx.fillRect(90, 100, PIXEL_STAGE.w - 180, 66);
      ctx.strokeStyle = '#f4ead8';
      ctx.strokeRect(90.5, 100.5, PIXEL_STAGE.w - 181, 65);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(quarterCard.text, PIXEL_STAGE.w / 2, 128);
      ctx.font = '11px monospace';
      ctx.fillText(quarterCard.scoreLine, PIXEL_STAGE.w / 2, 148);
      ctx.textAlign = 'start';
    } else if (quarterCard && hitchMs <= 0) {
      quarterCard = null;
    }

    setScore('pixel-score-home', fr.a.score[0], 0);
    setScore('pixel-score-away', fr.a.score[1], 1);
    document.getElementById('pixel-quarter').textContent = periodLabel(fr.a.period);
    document.getElementById('pixel-clock').textContent = fmtClock(fr.a.clock);
    if (fr.a.text) document.getElementById('pixel-ticker').textContent = fr.a.text;
  }

  function showFinal() {
    playbackMs = timeline.durationMs;
    // Drop the springs so the final frame is composed exactly, rather than
    // sprites drifting in from wherever playback happened to be.
    suppressEntries = true;
    Object.keys(smooth).forEach(function (pid) { delete smooth[pid]; });
    draw(16);
    document.getElementById('pixel-ticker').textContent =
      'FINAL: ' + homeTeam.id + ' ' + session.homeScore + ' — ' + awayTeam.id + ' ' + session.awayScore;
    document.getElementById('pixel-play-pause').disabled = true;
    coach.onGameOver();
    // A finished live game is an ordinary completed session now, so it can be
    // replayed from the top like any other.
    document.getElementById('pixel-replay').disabled = false;

    // Post-game card: line score plus the night's top performers, so the game
    // ends on a result rather than just stopping.
    const pts = timeline.finalStats.points;
    const top = Object.keys(pts)
      .map(function (id) { return { id: id, pts: pts[id] }; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 5);
    pixelRenderFinalCard(document.getElementById('pixel-infostrip'), {
      homeTeam: homeTeam, awayTeam: awayTeam,
      homeScore: session.homeScore, awayScore: session.awayScore,
      lineScore: timeline.lineScore, topScorers: top, playerById: playerById
    });
  }

  function tick(ts) {
    if (lastFrameTs === null) lastFrameTs = ts;
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;

    // Step BEFORE advancing the playhead, so the frame about to be drawn is
    // never past the end of the choreographed timeline.
    stepAhead(MAX_STEPS_PER_FRAME);
    coach.checkNudges();

    if (!paused) {
      // hitchMs freezes the whole scene (make freeze-frames, quarter cards)
      if (hitchMs > 0) hitchMs -= dt;
      else playbackMs += dt * speed;
    }
    // A live game is only over when the SIM is done and playback has caught
    // up to it. Checking durationMs alone would show the final card on the
    // very first frame, when the timeline is still empty.
    if (playbackMs >= timeline.durationMs && (!session.live || liveFinished)) {
      showFinal();
      _rafId = null;
      return;
    }
    // Playback outran the sim (very high speed, or a slow step): hold the
    // playhead at the end of what exists rather than interpolating past it.
    if (playbackMs > timeline.durationMs) playbackMs = timeline.durationMs;

    if (kfs.length === 0) { _rafId = requestAnimationFrame(tick); return; }
    draw(dt);
    _rafId = requestAnimationFrame(tick);
  }

  // The pause button owns both `paused` and its own label, so anything else
  // that pauses playback has to move them together or the button starts
  // lying about what it will do next.
  function setPaused(value) {
    paused = !!value;
    const btn = document.getElementById('pixel-play-pause');
    if (btn) btn.textContent = paused ? 'Play' : 'Pause';
  }

  document.getElementById('pixel-play-pause').addEventListener('click', function () {
    setPaused(!paused);
  });

  // Halftime: the studio show, then a word with your coach.
  //
  // Unlike the quarter-break card this is NOT a timed hitch — a dialogue
  // cannot be on a clock — so playback is held outright and restored to
  // whatever it was doing before. It restores the PREVIOUS state rather than
  // resuming unconditionally, because a user who had already paused to read
  // something should still be paused when the last box closes.
  //
  // The pause is taken ONCE, around the whole sequence, and released once at
  // the end. Pausing and resuming between the two boxes would let a frame of
  // basketball play in the gap.
  function maybeRunHalftimeDialogue() {
    if (GameState.settings && GameState.settings.dialogueScenes === false) return;
    if (typeof runDialogue !== 'function' || dialogueBoxIsOpen()) return;
    const sim = session.sim;
    if (!sim) return;
    if (sim.homeTeamId !== GameState.userTeamId && sim.awayTeamId !== GameState.userTeamId) return;

    const wasPaused = paused;
    setPaused(true);
    const ctx = buildHalftimeContext(GameState, sim);

    function release() { setPaused(wasPaused); }

    // Second half of the sequence: the coach asks you something.
    function runCoachTalk() {
      const scene = selectScene(ctx, {
        recent: GameState.recentDialogueScenes || [],
        rand: GameState.rng,
        fallbackLines: (GameState.narrativeSystem && GameState.narrativeSystem.dialogueLibrary)
          ? GameState.narrativeSystem.dialogueLibrary.media_standard
          : null
      });
      // The coach has no generated face of his own, so the bust falls back to
      // neutral colouring — but passing the team dresses him in YOUR jersey,
      // which is most of what makes him read as your coach and not a stranger.
      ctx.speakerName = 'Head Coach';
      ctx.speakerTeam = getTeamById(GameState.userTeamId);

      const opened = runDialogue(scene, ctx, function (result) {
        if (!result.skipped) {
          const choice = scene.choices[result.choiceIndex];
          if (choice && typeof choice.effect === 'function') {
            // What he said, before what it does — so a later scene can bring
            // it up.
            rememberAnswer(GameState, scene && scene.id, choice, GameState.leagueYear);
            // The sim goes through as an explicit capability rather than on
            // the context: this is the one moment a LIVE game exists to nudge,
            // and the post-game caller has nothing to pass. It is also what
            // keeps the context a flat bag of facts that a test can compare.
            applyDialogueEffect(GameState, choice.effect(ctx), ctx, { sim: sim });
          }
        }
        pushRecentScene(GameState, scene.id);
        release();
      });

      // If the box could not open, playback must not be left frozen.
      if (!opened) release();
    }

    // First half: the panel. Watch-only, so nothing is applied when it ends —
    // including when it is skipped with Esc, which drops straight to the coach
    // rather than abandoning halftime altogether.
    // studioSelectSegment, not selectSegment: the studio globals carry a
    // STUDIO_/studio prefix so they cannot collide in the one shared browser
    // scope. dialogueScenes.js owns the bare selectScene.
    const segment = (typeof studioSelectSegment === 'function')
      ? studioSelectSegment(ctx, {
          recent: GameState.recentDialogueScenes || [],
          rand: GameState.rng
        })
      : null;

    if (!segment || typeof runStudioSegment !== 'function') { runCoachTalk(); return; }

    const aired = runStudioSegment(segment, ctx, function (result) {
      pushRecentScene(GameState, result.segmentId);
      runCoachTalk();
    });

    if (!aired) runCoachTalk();
  }
  document.getElementById('pixel-mute').addEventListener('click', function () {
    const a = ensurePixelAudio();
    if (!a) { this.disabled = true; this.textContent = 'Sound: N/A'; return; }
    a.muted = !a.muted;
    a.master.gain.value = a.muted ? 0 : 1;
    if (!a.muted && a.actx.state === 'suspended') a.actx.resume();
    this.textContent = a.muted ? 'Sound: Off' : 'Sound: On';
  });
  Array.prototype.forEach.call(container.querySelectorAll('.pixel-speed'), function (btn) {
    btn.addEventListener('click', function () {
      speed = Number(btn.getAttribute('data-speed'));
      Array.prototype.forEach.call(container.querySelectorAll('.pixel-speed'), function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });
  document.getElementById('pixel-skip').addEventListener('click', function () {
    // Complete the game before showing the final: showFinal reads the line
    // score and final stats, which only exist once the timeline is closed.
    runOutLiveGame();
    stopPixelPlayback();
    hitchMs = 0;
    quarterCard = null;
    // Jumping to the end would otherwise stage a run-in for all ten players
    // (every sprite is "new" relative to the last drawn frame) and a swarm
    // of leavers; the final frame is a still, so suppress both.
    suppressEntries = true;
    particles.length = 0;
    prevBallDraw = null;
    leavers.length = 0;
    showFinal();
  });
  document.getElementById('pixel-leave-stay').addEventListener('click', function () {
    document.getElementById('pixel-leave-confirm').hidden = true;
    _pendingLeaveTarget = null;
  });
  document.getElementById('pixel-leave-go').addEventListener('click', function () {
    const target = _pendingLeaveTarget || 'dashboard';
    _pendingLeaveTarget = null;
    document.getElementById('pixel-leave-confirm').hidden = true;
    // Finishes and records the game, which also clears _pendingLiveRunOut —
    // so the renderView below sees nothing live and does not re-prompt.
    finishPendingPixelGame();
    _watchSession = null;
    renderView(target);
  });
  document.getElementById('pixel-replay').addEventListener('click', function () {
    if (session.live) return;   // nothing to replay yet — the game is still happening
    stopPixelPlayback();
    renderPixelGame(container); // same session, fresh from tip-off
  });
  document.getElementById('pixel-exit').addEventListener('click', function () {
    if (!confirmLeaveLiveGame('dashboard')) return;
    // Leaving mid-game still records a COMPLETE game (spec: a half-played
    // game is never recorded) — the rest is played out under the auto-coach.
    runOutLiveGame();
    stopPixelPlayback();
    _watchSession = null;
    renderView('dashboard');
  });

  // Browsers won't start an AudioContext without a user gesture. The click
  // that opened this view doesn't count (it happened in another view), so
  // arm the arena sound on the first interaction anywhere in the view and
  // reflect the real state on the button.
  function startAudioOnGesture() {
    const a = ensurePixelAudio();
    const btn = document.getElementById('pixel-mute');
    if (!a) { if (btn) { btn.disabled = true; btn.textContent = 'Sound: N/A'; } return; }
    if (a.actx.state === 'suspended') a.actx.resume();
  }
  container.addEventListener('click', startAudioOnGesture, { once: true });
  startAudioOnGesture();

  _rafId = requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setLiveWatchSession: setLiveWatchSession,
    finishPendingPixelGame: finishPendingPixelGame,
    isLiveWatchPending: isLiveWatchPending,
    confirmLeaveLiveGame: confirmLeaveLiveGame,
    renderPixelGame: renderPixelGame,
    stopPixelPlayback: stopPixelPlayback
  };
}
