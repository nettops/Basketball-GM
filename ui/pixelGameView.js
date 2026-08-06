// The "Watch Game" view: plays a choreographed keyframe timeline
// (ui/pixelChoreographer.js) on a pixel-art canvas (ui/pixelCourt.js,
// ui/pixelSprites.js). Playback state (including the event log) lives in this
// module, never in GameState — a watched game is already recorded via the
// normal applyGameResult path before this view ever opens, so navigating
// away, reloading, or saving mid-watch can't corrupt anything (spec:
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md).

let _watchSession = null;   // set by the Watch Next Game handler, cleared on exit
let _rafId = null;

// Procedural crowd audio — generated noise, zero assets. One AudioContext
// reused across watch sessions (suspended when the view closes). A filtered
// noise loop is the arena murmur; a bandpass branch of the same noise swells
// with crowd excitement on big plays. Math.random here is fine: audio is
// decoration and never touches the game rng.
let _audio = null;
function ensurePixelAudio() {
  if (_audio) return _audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const actx = new AC();
  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lowpass = actx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 480;
  const bedGain = actx.createGain();
  bedGain.gain.value = 0.05;
  const bandpass = actx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1100;
  bandpass.Q.value = 0.7;
  const swellGain = actx.createGain();
  swellGain.gain.value = 0;
  const master = actx.createGain();
  master.gain.value = 1;
  src.connect(lowpass);
  lowpass.connect(bedGain);
  bedGain.connect(master);
  src.connect(bandpass);
  bandpass.connect(swellGain);
  swellGain.connect(master);
  master.connect(actx.destination);
  src.start();
  _audio = { actx: actx, bedGain: bedGain, swellGain: swellGain, master: master, muted: false };
  return _audio;
}

// One-shot sound effects, synthesized on the shared context — no assets.
// Every voice is a short noise burst or oscillator shaped by a gain
// envelope; nothing is sampled, so this stays zero-dependency.
function sfxNoise(a, dur, type, freq, q, gain) {
  const frames = Math.max(1, Math.floor(a.actx.sampleRate * dur));
  const buf = a.actx.createBuffer(1, frames, a.actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = a.actx.createBufferSource();
  src.buffer = buf;
  const filt = a.actx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = a.actx.createGain();
  const now = a.actx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filt); filt.connect(g); g.connect(a.master);
  src.start(now);
  src.stop(now + dur);
}

function sfxTone(a, freq, dur, type, gain, endFreq) {
  const osc = a.actx.createOscillator();
  const g = a.actx.createGain();
  const now = a.actx.currentTime;
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g); g.connect(a.master);
  osc.start(now);
  osc.stop(now + dur);
}

function playPixelSfx(name) {
  const a = _audio;
  if (!a || a.muted || a.actx.state !== 'running') return;
  switch (name) {
    case 'swish':   sfxNoise(a, 0.16, 'highpass', 2600, 0.7, 0.16); break;
    case 'dunk':    sfxNoise(a, 0.22, 'bandpass', 900, 1.2, 0.22); sfxTone(a, 160, 0.18, 'square', 0.10, 70); break;
    case 'clang':   sfxTone(a, 780, 0.20, 'triangle', 0.13, 520); sfxNoise(a, 0.14, 'bandpass', 1800, 3, 0.10); break;
    case 'block':   sfxNoise(a, 0.13, 'lowpass', 700, 0.9, 0.24); break;
    case 'squeak':  sfxNoise(a, 0.10, 'highpass', 3200, 2.5, 0.09); break;
    case 'whistle': sfxTone(a, 2700, 0.28, 'square', 0.05, 2500); break;
    case 'buzzer':  sfxTone(a, 210, 0.75, 'square', 0.10); break;
    // quietest voice by far: it fires several times a second, so it sits
    // under the action rather than competing with it
    case 'dribble': sfxNoise(a, 0.05, 'lowpass', 380, 0.8, 0.06); break;
  }
}

function pixelAudioExcitement(level) {
  if (!_audio || _audio.muted) return;
  const now = _audio.actx.currentTime;
  _audio.swellGain.gain.setTargetAtTime(level * 0.28, now, 0.08);
  _audio.bedGain.gain.setTargetAtTime(0.05 + level * 0.06, now, 0.15);
}

function suspendPixelAudio() {
  if (_audio && _audio.actx.state === 'running') _audio.actx.suspend();
}

const PIXEL_SPEEDS = [1, 2, 4, 8];

// Keyframe texts that mean "the ball just went in" — drives the rim flash.
// Must stay in sync with the made-shot labels in ui/pixelChoreographer.js.
const MAKE_LABELS = ['It\'s good!', 'Three-pointer!', 'Slams it home!', 'Lays it in!', 'Finishes inside!'];

// The subset of plays the crowd goes wild for.
const BIG_PLAY_LABELS = ['Three-pointer!', 'Slams it home!', 'Blocked!', 'Steal!', 'Late free throw decides it!'];

// Recently watched games, newest first, so a game can be replayed from the
// view's own controls. Memory-only and capped: event logs are big and
// playback-only, so they never enter GameState or a save file (see the
// module comment above).
const _replayHistory = [];
const REPLAY_LIMIT = 8;

function setWatchSession(session) {
  _watchSession = session;
  if (session) {
    _replayHistory.unshift(session);
    if (_replayHistory.length > REPLAY_LIMIT) _replayHistory.length = REPLAY_LIMIT;
  }
}

function getReplayHistory() { return _replayHistory; }

function stopPixelPlayback() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  suspendPixelAudio();
}

function pixelLerp(a, b, f) { return a + (b - a) * f; }

function renderPixelGame(container) {
  stopPixelPlayback();
  if (!_watchSession) {
    container.innerHTML = '<div class="view-header"><h2>Watch Game</h2></div>' +
      (_replayHistory.length === 0
        ? '<div class="empty-state">No game to watch. Use "Watch Next Game" in the sim dock.</div>'
        : '<div class="panel"><div class="panel-header">Recently Watched</div><div class="panel-body">' +
          '<table class="data-table"><tbody>' + _replayHistory.map(function (s, i) {
            const h = getTeamById(s.homeTeamId), a = getTeamById(s.awayTeamId);
            return '<tr><td class="col-name">' + escapeHtml(h.id) + ' ' + s.homeScore +
              ' — ' + escapeHtml(a.id) + ' ' + s.awayScore + '</td>' +
              '<td>' + (s.isPlayoff ? '<span class="pill pill-gold">Playoffs</span>' : '') + '</td>' +
              '<td><button class="pixel-replay-btn" data-idx="' + i + '">Replay</button></td></tr>';
          }).join('') + '</tbody></table></div></div>');
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

  // Participant rosters rebuilt from the box score (teamId stamped per line —
  // see simEngineBoxScore.js) rather than live team rosters, so a mid-watch
  // trade or injury can't desync the replay from what actually happened.
  const homeRoster = Object.keys(session.boxScore)
    .map(function (id) { return getPlayerById(id); })
    .filter(function (p) { return p && session.boxScore[p.id].teamId === session.homeTeamId; });
  const awayRoster = Object.keys(session.boxScore)
    .map(function (id) { return getPlayerById(id); })
    .filter(function (p) { return p && session.boxScore[p.id].teamId === session.awayTeamId; });

  const timeline = buildTimeline({
    events: session.events,
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    boxScore: session.boxScore,
    homeName: homeTeam.name,
    awayName: awayTeam.name,
    homeAbbr: homeTeam.id,
    awayAbbr: awayTeam.id
  });

  const playerById = {};
  const colorsById = {};
  homeRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, homeTeam, true); });
  awayRoster.forEach(function (p) { playerById[p.id] = p; colorsById[p.id] = spriteColorsForPlayer(p, awayTeam, false); });

  container.innerHTML =
    '<div class="pixel-game">' +
      // The real scoreboard is drawn inside the canvas; this copy stays in
      // the DOM (visually hidden) so screen readers still get the score.
      '<div class="pixel-scoreboard pixel-sr-only">' +
        '<span class="pixel-score-team" style="border-color:' + homeTeam.colors.primary + '">' + escapeHtml(homeTeam.id) + ' <span id="pixel-score-home">0</span></span>' +
        '<span class="pixel-clock"><span id="pixel-quarter">Q1</span> <span id="pixel-clock">12:00</span></span>' +
        '<span class="pixel-score-team" style="border-color:' + awayTeam.colors.primary + '">' + escapeHtml(awayTeam.id) + ' <span id="pixel-score-away">0</span></span>' +
      '</div>' +
      '<div class="pixel-canvas-wrap"><canvas id="pixel-canvas" width="' + PIXEL_STAGE.w + '" height="' + PIXEL_STAGE.h + '"></canvas></div>' +
      '<div class="pixel-ticker" id="pixel-ticker">&nbsp;</div>' +
      '<div class="pixel-commentary" id="pixel-commentary"></div>' +
      '<div class="pixel-controls">' +
        '<button id="pixel-play-pause">Pause</button>' +
        PIXEL_SPEEDS.map(function (s) {
          return '<button class="pixel-speed' + (s === 1 ? ' active' : '') + '" data-speed="' + s + '">' + s + '×</button>';
        }).join('') +
        '<button id="pixel-skip">Skip to Final</button>' +
        '<button id="pixel-replay">Replay</button>' +
        '<button id="pixel-mute">Sound: On</button>' +
        '<button id="pixel-exit">Exit</button>' +
      '</div>' +
    '</div>';

  const canvas = document.getElementById('pixel-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Court background, with the home logo layered in once it loads.
  let courtCanvas = buildCourtCanvas(homeTeam, awayTeam, null);
  const logoImg = new Image();
  logoImg.onload = function () { courtCanvas = buildCourtCanvas(homeTeam, awayTeam, logoImg); };
  logoImg.src = getTeamLogoUrl(session.homeTeamId);

  let playbackMs = 0;
  let speed = 1;
  let paused = false;
  let lastFrameTs = null;
  let kfIndex = 0;
  const kfs = timeline.keyframes;

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
    const feed = document.getElementById('pixel-commentary');
    const line = document.createElement('div');
    line.className = 'pixel-commentary-line';
    line.textContent = kf.commentary;
    feed.insertBefore(line, feed.firstChild);
    while (feed.children.length > 6) feed.removeChild(feed.lastChild);
  }

  // Motion-quality state: per-player facing persists so standing players
  // keep looking the way they last ran; shake/hitch/quarter-card timers
  // drive the impact feedback.
  const facingById = {};
  let shakeStartMs = -Infinity;
  let hitchMs = 0;              // freeze-frame remaining (real ms, unscaled)
  let lastEffectKfT = -1;
  let lastQuarterSeen = 1;
  let quarterCard = null;       // { text, scoreLine } while a break card shows
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
  const SNAP_DIST = 70; // farther than this is a substitution, not a run

  function springAxis(x, v, target, omega, h) {
    const f = 1 + 2 * h * omega;
    const oo = omega * omega;
    const hoo = h * oo;
    const hhoo = h * hoo;
    const detInv = 1 / (f + hhoo);
    return [(f * x + h * v + hhoo * target) * detInv, (v + hoo * (target - x)) * detInv];
  }

  // Defenders keep continuous pressure on the ball rather than standing on
  // a fixed spot: a small live offset toward the ball, which also means
  // there is always motion on the floor between discrete events.
  const teamById = {};
  homeRoster.forEach(function (p) { teamById[p.id] = 'home'; });
  awayRoster.forEach(function (p) { teamById[p.id] = 'away'; });
  let lastOffenseTeam = 'home';
  let ballSpin = 0;             // accumulated tumble, advanced during flight
  let excitementIsHome = true;  // which side the arena is reacting for
  let lastBallActor = null;     // last player to hold the ball
  let lastBouncePhase = 1;      // for detecting dribble floor contact
  let rimShakeStart = -Infinity; // set when a shot goes through
  let rimShakeSide = 'right';

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
      if (fr.a.text === 'Slams it home!' || fr.a.text === 'Blocked!') shakeStartMs = playbackMs;
      if (MAKE_LABELS.indexOf(fr.a.text) !== -1) {
        hitchMs = Math.max(hitchMs, 120);
        spawnNetSplash(fr.a.ball.x, fr.a.ball.y);
        rimShakeStart = playbackMs;
        rimShakeSide = fr.a.ball.x > PIXEL_STAGE.w / 2 ? 'right' : 'left';
      }
      // Event audio. Above 4x the beats blur together into a machine-gun
      // rattle, so the one-shots drop out and only the crowd bed remains.
      if (fr.a.sfx && speed <= 4) playPixelSfx(fr.a.sfx);
      if (fr.a.quarter > lastQuarterSeen) {
        quarterCard = {
          text: 'END OF Q' + lastQuarterSeen,
          scoreLine: homeTeam.id + ' ' + fr.a.score[0] + ' — ' + awayTeam.id + ' ' + fr.a.score[1]
        };
        lastQuarterSeen = fr.a.quarter;
        hitchMs = Math.max(hitchMs, 1500);
        playPixelSfx('buzzer');
      }
      lastEffectKfT = fr.a.t;
    }

    // impact shake: everything on the canvas jolts for ~150ms
    let shakeX = 0, shakeY = 0;
    if (playbackMs - shakeStartMs < 150) {
      shakeX = Math.round(Math.sin(playbackMs / 9) * 2);
      shakeY = Math.round(Math.cos(playbackMs / 7));
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.drawImage(courtCanvas, 0, 0);

    const excitement = Math.max(0, 1 - (playbackMs - excitementStartMs) / 1800);
    drawCrowd(ctx, playbackMs, excitement, excitementIsHome ? 1 : 0);
    pixelAudioExcitement(excitement * (excitementIsHome ? 1 : 0.25));
    pushCommentary(fr.a);

    // is the current ball sequence a shot (heading to a rim) or a pass?
    const lookAhead = kfs[Math.min(kfIndex + 2, kfs.length - 1)];
    const shotComing = lookAhead.ball.holder === null && distToNearestHoop(lookAhead.ball) < 20;

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

    // Advance every player's spring toward its keyframe target.
    const dtTimeline = Math.min(80, realDt * speed) / 1000; // seconds, clamped for tab stalls
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
      if (Math.abs(tx - s.x) + Math.abs(ty - s.y) > SNAP_DIST) { s.x = tx; s.y = ty; s.vx = 0; s.vy = 0; }
      const rx = springAxis(s.x, s.vx, tx, s.omega, dtTimeline);
      const ry = springAxis(s.y, s.vy, ty, s.omega, dtTimeline);
      s.x = rx[0]; s.vx = rx[1];
      s.y = ry[0]; s.vy = ry[1];
      onCourtNow[pid] = true;
    });

    // The choreographer guarantees separation at keyframe positions, but the
    // springs interpolate independently and can pass bodies through each
    // other in between — so re-separate the DRAWN positions each frame.
    // Pushing s.x/s.y (not a copy) means the shove persists and players
    // actually jostle instead of snapping back.
    const holderId = fr.a.ball.holder;
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
      const sway = moving ? 0 : Math.sin((playbackMs + phase * 3) / 900) * 0.7;
      const x = s.x + sway;
      const y = s.y;

      const isHolder = fr.a.ball.holder === pid;
      const shooting = isHolder && fr.b.ball.holder === null && shotComing;
      // anticipation: dip into the legs before rising into the shot
      const jumpLift = shooting
        ? Math.round(fr.f < 0.18 ? -(fr.f / 0.18) * 1.5 : Math.sin(((fr.f - 0.18) / 0.82) * Math.PI) * 5)
        : 0;
      // ground shadow stays planted even when the sprite lifts
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(Math.round(x) - 4, Math.round(y) - 1, 8, 2);
      const p = playerById[pid];
      drawPlayerSprite(ctx, x, y - jumpLift, colorsById[pid], p ? p.jerseyNumber : '', {
        frame: Math.floor((playbackMs + phase) / stride) % 2,
        shooting: shooting,
        highlight: isHolder,
        facing: facingById[pid] || 0,
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
        frame: Math.floor(playbackMs / 110) % 2,
        moving: true,
        facing: 0
      });
    }

    // ball: dribbled by the holder, held high when shooting, otherwise in
    // flight with a distance-scaled arc and its own ground shadow
    let bx, by, groundY;
    const holder = fr.a.ball.holder;
    if (holder && smooth[holder]) {
      // attach to the SMOOTHED hand position, or the ball detaches from the
      // body it belongs to
      const hs = smooth[holder];
      const hx = hs.x;
      const hy = hs.y;
      const holderShooting = fr.b.ball.holder === null && shotComing;
      if (holderShooting) {
        bx = hx;
        by = hy - 24; // gathered overhead for the release
      } else {
        const holderMoving = Math.sqrt(hs.vx * hs.vx + hs.vy * hs.vy) > 6;
        const bouncePeriod = holderMoving ? 95 : 140;
        bx = hx + (facingById[holder] || 1) * 6;
        const bouncePhase = Math.abs(Math.sin(playbackMs / bouncePeriod));
        by = hy - 1 - bouncePhase * 10; // dribble: hand to floor
        // thud on the floor contact, keyed off the same phase the eye sees
        if (speed <= 2 && bouncePhase < 0.12 && lastBouncePhase >= 0.12) playPixelSfx('dribble');
        lastBouncePhase = bouncePhase;
      }
      groundY = hy;
    } else {
      // A released ball is a projectile: constant horizontal velocity with a
      // parabolic rise and fall. (Easing the horizontal axis made shots
      // visibly brake in mid-air.)
      const flightDist = Math.abs(fr.b.ball.x - fr.a.ball.x) + Math.abs(fr.b.ball.y - fr.a.ball.y);
      const arcHeight = Math.max(4, Math.min(32, flightDist * 0.3));
      bx = pixelLerp(fr.a.ball.x, fr.b.ball.x, fr.f);
      groundY = pixelLerp(fr.a.ball.y, fr.b.ball.y, fr.f);
      by = groundY - Math.sin(fr.f * Math.PI) * arcHeight;
      ballSpin += (Math.abs(fr.b.ball.x - fr.a.ball.x) > 2 ? 0.6 : 0.25) * (fr.b.ball.x >= fr.a.ball.x ? 1 : -1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx) - 1, Math.round(groundY), 3, 1);
    drawBall(ctx, bx, by, holder ? undefined : ballSpin);

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
    const rimAge = playbackMs - rimShakeStart;
    if (rimAge >= 0 && rimAge < 340) {
      const hoop = PIXEL_STAGE.hoops[rimShakeSide];
      const flex = Math.sin(rimAge / 34) * Math.max(0, 1 - rimAge / 340) * 2;
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
    if (MAKE_LABELS.indexOf(fr.a.text) !== -1 && fr.f < 0.6) {
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
    ctx.restore();

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
    const qText = 'Q' + fr.a.quarter;
    drawPixelText(ctx, boardX + (boardW - pixelTextWidth(qText, 1)) / 2, boardY + 4, qText, '#8fa0bd', 1);
    const clockText = fmtClock(fr.a.clock).replace(':', ':');
    drawPixelText(ctx, boardX + (boardW - pixelTextWidth(clockText, 2)) / 2, boardY + 13, clockText, '#cfd6e4', 2);

    // quarter-break card, drawn unshaken over everything
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
    document.getElementById('pixel-quarter').textContent = 'Q' + fr.a.quarter;
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
  }

  function tick(ts) {
    if (lastFrameTs === null) lastFrameTs = ts;
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;
    if (!paused) {
      // hitchMs freezes the whole scene (make freeze-frames, quarter cards)
      if (hitchMs > 0) hitchMs -= dt;
      else playbackMs += dt * speed;
    }
    if (playbackMs >= timeline.durationMs) { showFinal(); _rafId = null; return; }
    draw(dt);
    _rafId = requestAnimationFrame(tick);
  }

  document.getElementById('pixel-play-pause').addEventListener('click', function () {
    paused = !paused;
    this.textContent = paused ? 'Play' : 'Pause';
  });
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
    stopPixelPlayback();
    hitchMs = 0;
    quarterCard = null;
    // Jumping to the end would otherwise stage a run-in for all ten players
    // (every sprite is "new" relative to the last drawn frame) and a swarm
    // of leavers; the final frame is a still, so suppress both.
    suppressEntries = true;
    particles.length = 0;
    leavers.length = 0;
    showFinal();
  });
  document.getElementById('pixel-replay').addEventListener('click', function () {
    stopPixelPlayback();
    renderPixelGame(container); // same session, fresh from tip-off
  });
  document.getElementById('pixel-exit').addEventListener('click', function () {
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
  module.exports = { setWatchSession: setWatchSession, renderPixelGame: renderPixelGame, stopPixelPlayback: stopPixelPlayback };
}
