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

function setWatchSession(session) { _watchSession = session; }

function stopPixelPlayback() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  suspendPixelAudio();
}

function pixelLerp(a, b, f) { return a + (b - a) * f; }

function renderPixelGame(container) {
  stopPixelPlayback();
  if (!_watchSession) {
    container.innerHTML = '<div class="view-header"><h2>Watch Game</h2></div>' +
      '<div class="empty-state">No game to watch. Use "Watch Next Game" in the sim dock.</div>';
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
      '<div class="pixel-scoreboard">' +
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

  // Bench run-ins/run-offs: a player newly appearing on court jogs in from
  // the near sideline (which also gives the opening tip a "teams take the
  // floor" moment); a swapped-out player jogs off before vanishing.
  const ENTRY_MS = 600;
  const EXIT_MS = 500;
  const sidelineY = PIXEL_STAGE.court.y + PIXEL_STAGE.court.h + 14;
  const entryById = {};         // pid -> playbackMs the run-in started
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

  function easeInOut(f) { return f * f * (3 - 2 * f); }
  function easeOut(f) { return 1 - (1 - f) * (1 - f); }

  function distToNearestHoop(pt) {
    const L = PIXEL_STAGE.hoops.left;
    const R = PIXEL_STAGE.hoops.right;
    return Math.min(Math.abs(pt.x - L.x) + Math.abs(pt.y - L.y), Math.abs(pt.x - R.x) + Math.abs(pt.y - R.y));
  }

  function setScore(elId, value, side) {
    const el = document.getElementById(elId);
    const v = String(value);
    if (lastScoreShown[side] === v) return;
    lastScoreShown[side] = v;
    el.textContent = v;
    el.classList.remove('pop');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('pop');
  }

  function draw() {
    const fr = currentFrame();
    const fP = easeInOut(fr.f); // players accelerate and decelerate
    const fB = easeOut(fr.f);   // loose balls zip out then settle

    // one-shot effects when a new keyframe becomes current
    if (fr.a.t !== lastEffectKfT) {
      if (BIG_PLAY_LABELS.indexOf(fr.a.text) !== -1) {
        excitementStartMs = playbackMs;
        lastBigPlayKfT = fr.a.t;
      }
      if (fr.a.text === 'Slams it home!' || fr.a.text === 'Blocked!') shakeStartMs = playbackMs;
      if (MAKE_LABELS.indexOf(fr.a.text) !== -1) {
        hitchMs = Math.max(hitchMs, 120);
        spawnNetSplash(fr.a.ball.x, fr.a.ball.y);
      }
      if (fr.a.quarter > lastQuarterSeen) {
        quarterCard = {
          text: 'END OF Q' + lastQuarterSeen,
          scoreLine: homeTeam.id + ' ' + fr.a.score[0] + ' — ' + awayTeam.id + ' ' + fr.a.score[1]
        };
        lastQuarterSeen = fr.a.quarter;
        hitchMs = Math.max(hitchMs, 1500);
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
    drawCrowd(ctx, playbackMs, excitement);
    pixelAudioExcitement(excitement);
    pushCommentary(fr.a);

    // is the current ball sequence a shot (heading to a rim) or a pass?
    const lookAhead = kfs[Math.min(kfIndex + 2, kfs.length - 1)];
    const shotComing = lookAhead.ball.holder === null && distToNearestHoop(lookAhead.ball) < 20;

    // players: eased lerp, sorted top-to-bottom for overlap
    const ids = Object.keys(fr.a.pos).filter(function (id) { return fr.b.pos[id]; });
    ids.sort(function (i1, i2) {
      return pixelLerp(fr.a.pos[i1][1], fr.b.pos[i1][1], fP) - pixelLerp(fr.a.pos[i2][1], fr.b.pos[i2][1], fP);
    });
    const span = Math.max(1, fr.b.t - fr.a.t);
    const onCourtNow = {};
    ids.forEach(function (pid) {
      const pa = fr.a.pos[pid];
      const pb = fr.b.pos[pid];
      let x = pixelLerp(pa[0], pb[0], fP);
      let y = pixelLerp(pa[1], pb[1], fP);
      const travel = Math.abs(pb[0] - pa[0]) + Math.abs(pb[1] - pa[1]);
      const speed = travel / span; // px per timeline-ms
      let moving = speed > 0.012;
      if (pb[0] - pa[0] > 2) facingById[pid] = 1;
      else if (pa[0] - pb[0] > 2) facingById[pid] = -1;

      // run-in from the sideline for players entering the game
      if (!onCourtPrev[pid] && !suppressEntries && entryById[pid] === undefined) entryById[pid] = playbackMs;
      if (entryById[pid] !== undefined) {
        const el = (playbackMs - entryById[pid]) / ENTRY_MS;
        if (el >= 0 && el < 1 && !suppressEntries) {
          y = pixelLerp(sidelineY, y, easeOut(el));
          moving = true;
        } else {
          delete entryById[pid];
        }
      }

      const phase = (pid.charCodeAt(0) * 131 + pid.length * 37) % 977;
      const stride = speed > 0.05 ? 110 : 170;
      const isHolder = fr.a.ball.holder === pid;
      const shooting = isHolder && fr.b.ball.holder === null && shotComing;
      const jumpLift = shooting ? Math.round(Math.sin(fr.f * Math.PI) * 4) : 0;
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
      onCourtNow[pid] = true;
      lastPosById[pid] = [x, y];
    });

    // players swapped out jog off to the sideline before disappearing
    if (!suppressEntries) {
      Object.keys(onCourtPrev).forEach(function (pid) {
        if (!onCourtNow[pid] && lastPosById[pid]) {
          leavers.push({ pid: pid, x: lastPosById[pid][0], y: lastPosById[pid][1], t0: playbackMs });
        }
      });
    }
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
    if (holder && fr.a.pos[holder]) {
      const ha = fr.a.pos[holder];
      const hb = fr.b.pos[holder] || ha;
      const hx = pixelLerp(ha[0], hb[0], fP);
      const hy = pixelLerp(ha[1], hb[1], fP);
      const holderShooting = fr.b.ball.holder === null && shotComing;
      if (holderShooting) {
        bx = hx;
        by = hy - 24; // gathered overhead for the release
      } else {
        const holderMoving = (Math.abs(hb[0] - ha[0]) + Math.abs(hb[1] - ha[1])) / span > 0.012;
        const bouncePeriod = holderMoving ? 95 : 140;
        bx = hx + (facingById[holder] || 1) * 6;
        by = hy - 1 - Math.abs(Math.sin(playbackMs / bouncePeriod)) * 10; // dribble: hand to floor
      }
      groundY = hy;
    } else {
      const flightDist = Math.abs(fr.b.ball.x - fr.a.ball.x) + Math.abs(fr.b.ball.y - fr.a.ball.y);
      const arcHeight = Math.max(4, Math.min(32, flightDist * 0.3));
      bx = pixelLerp(fr.a.ball.x, fr.b.ball.x, fB);
      by = pixelLerp(fr.a.ball.y, fr.b.ball.y, fB) - Math.sin(fB * Math.PI) * arcHeight;
      groundY = pixelLerp(fr.a.ball.y, fr.b.ball.y, fB);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx) - 1, Math.round(groundY), 3, 1);
    drawBall(ctx, bx, by);

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
    if (holder && playerById[holder] && fr.a.pos[holder]) {
      const hp = fr.a.pos[holder];
      const label = playerById[holder].name;
      ctx.font = '8px monospace';
      const w = ctx.measureText(label).width + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(hp[0] - w / 2, hp[1] + 3, w, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, hp[0] - w / 2 + 2, hp[1] + 11);
    }
    ctx.restore();

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
    draw();
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
    draw();
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
