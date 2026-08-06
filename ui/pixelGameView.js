// The "Watch Game" view: plays a choreographed keyframe timeline
// (ui/pixelChoreographer.js) on a pixel-art canvas (ui/pixelCourt.js,
// ui/pixelSprites.js). Playback state (including the event log) lives in this
// module, never in GameState — a watched game is already recorded via the
// normal applyGameResult path before this view ever opens, so navigating
// away, reloading, or saving mid-watch can't corrupt anything (spec:
// docs/superpowers/specs/2026-08-06-pixel-game-view-design.md).

let _watchSession = null;   // set by the Watch Next Game handler, cleared on exit
let _rafId = null;

const PIXEL_SPEEDS = [1, 2, 4, 8];

function setWatchSession(session) { _watchSession = session; }

function stopPixelPlayback() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
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
    boxScore: session.boxScore
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
      '<div class="pixel-controls">' +
        '<button id="pixel-play-pause">Pause</button>' +
        PIXEL_SPEEDS.map(function (s) {
          return '<button class="pixel-speed' + (s === 1 ? ' active' : '') + '" data-speed="' + s + '">' + s + '×</button>';
        }).join('') +
        '<button id="pixel-skip">Skip to Final</button>' +
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

  function draw() {
    const fr = currentFrame();
    ctx.drawImage(courtCanvas, 0, 0);

    // players: lerp positions between keyframes; draw top-to-bottom for overlap
    const ids = Object.keys(fr.a.pos).filter(function (id) { return fr.b.pos[id]; });
    ids.sort(function (i1, i2) {
      return pixelLerp(fr.a.pos[i1][1], fr.b.pos[i1][1], fr.f) - pixelLerp(fr.a.pos[i2][1], fr.b.pos[i2][1], fr.f);
    });
    const walkFrame = Math.floor(playbackMs / 180) % 2;
    ids.forEach(function (pid) {
      const x = pixelLerp(fr.a.pos[pid][0], fr.b.pos[pid][0], fr.f);
      const y = pixelLerp(fr.a.pos[pid][1], fr.b.pos[pid][1], fr.f);
      const isHolder = fr.a.ball.holder === pid;
      const p = playerById[pid];
      drawPlayerSprite(ctx, x, y, colorsById[pid], p ? p.jerseyNumber : '', {
        frame: walkFrame,
        shooting: fr.b.ball.holder === null && isHolder,
        highlight: isHolder
      });
    });

    // ball: follows holder, otherwise lerps with a small flight arc
    let bx, by;
    const holder = fr.a.ball.holder;
    if (holder && fr.a.pos[holder]) {
      const hb = fr.b.pos[holder] || fr.a.pos[holder];
      bx = pixelLerp(fr.a.pos[holder][0], hb[0], fr.f) + 6;
      by = pixelLerp(fr.a.pos[holder][1], hb[1], fr.f) - 10;
    } else {
      bx = pixelLerp(fr.a.ball.x, fr.b.ball.x, fr.f);
      by = pixelLerp(fr.a.ball.y, fr.b.ball.y, fr.f) - Math.sin(fr.f * Math.PI) * 18;
    }
    drawBall(ctx, bx, by);

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

    document.getElementById('pixel-score-home').textContent = fr.a.score[0];
    document.getElementById('pixel-score-away').textContent = fr.a.score[1];
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
    if (!paused) playbackMs += dt * speed;
    if (playbackMs >= timeline.durationMs) { showFinal(); _rafId = null; return; }
    draw();
    _rafId = requestAnimationFrame(tick);
  }

  document.getElementById('pixel-play-pause').addEventListener('click', function () {
    paused = !paused;
    this.textContent = paused ? 'Play' : 'Pause';
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
    showFinal();
  });
  document.getElementById('pixel-exit').addEventListener('click', function () {
    stopPixelPlayback();
    _watchSession = null;
    renderView('dashboard');
  });

  _rafId = requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setWatchSession: setWatchSession, renderPixelGame: renderPixelGame, stopPixelPlayback: stopPixelPlayback };
}
