// Builds the static pixel court scene once on an offscreen canvas: crowd
// strip, parquet floor, top-down court lines, team-colored keys, center logo.
// Redrawn only when a new watch session starts (or its logo finishes
// loading), then blitted every frame by ui/pixelGameView.js. Depends on
// PIXEL_STAGE (ui/pixelChoreographer.js).

// Tiny deterministic LCG just for crowd variety — NOT the game rng (the crowd
// is pure decoration and must never touch sim determinism).
function crowdRng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const CROWD_SKIN = ['#f2d6cb', '#eab687', '#bb876f', '#74453d'];
const CROWD_SHIRT = ['#3a4a5a', '#6b3f2e', '#4a6b3f', '#7a6a4a', '#5a3a6a', '#333333'];

function buildCourtCanvas(homeTeam, awayTeam, logoImg) {
  const canvas = document.createElement('canvas');
  canvas.width = PIXEL_STAGE.w;
  canvas.height = PIXEL_STAGE.h;
  const ctx = canvas.getContext('2d');
  const c = PIXEL_STAGE.court;

  // arena backdrop (the crowd itself is animated — drawn every frame by
  // drawCrowd below, on top of this dark band)
  ctx.fillStyle = '#1c2026';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // parquet floor (alternating tan tiles)
  for (let ty = c.y - 8; ty < c.y + c.h + 8; ty += 16) {
    for (let tx = c.x - 12; tx < c.x + c.w + 12; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? '#c9974f' : '#bd8a42';
      ctx.fillRect(tx, ty, 16, 16);
    }
  }

  // boundary + half-court
  ctx.strokeStyle = '#f4ead8';
  ctx.lineWidth = 1;
  ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w, c.h);
  const midX = c.x + c.w / 2;
  ctx.beginPath(); ctx.moveTo(midX + 0.5, c.y); ctx.lineTo(midX + 0.5, c.y + c.h); ctx.stroke();
  ctx.beginPath(); ctx.arc(midX, c.y + c.h / 2, 24, 0, Math.PI * 2); ctx.stroke();

  // keys (painted in home primary, both ends) + hoops + 3pt arcs
  [['left', 1], ['right', -1]].forEach(function (side) {
    const hoop = PIXEL_STAGE.hoops[side[0]];
    const dir = side[1]; // +1 = key extends rightward from the left baseline
    const keyW = 56, keyH = 64;
    const keyX = dir === 1 ? c.x : c.x + c.w - keyW;
    ctx.fillStyle = homeTeam.colors.primary;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(keyX, hoop.y - keyH / 2, keyW, keyH);
    ctx.globalAlpha = 1;
    ctx.strokeRect(keyX + 0.5, hoop.y - keyH / 2 + 0.5, keyW, keyH);
    ctx.beginPath();
    ctx.arc(keyX + (dir === 1 ? keyW : 0), hoop.y, 20, -Math.PI / 2, Math.PI / 2, dir !== 1);
    ctx.stroke();
    // 3pt arc
    const span = Math.PI / 2.4;
    ctx.beginPath();
    if (dir === 1) ctx.arc(hoop.x, hoop.y, 96, -span, span);
    else ctx.arc(hoop.x, hoop.y, 96, Math.PI - span, Math.PI + span);
    ctx.stroke();
    // hoop: backboard + rim
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(hoop.x + (dir === 1 ? -6 : 5), hoop.y - 7, 2, 14);
    ctx.fillStyle = '#e05a2b';
    ctx.fillRect(hoop.x - 2, hoop.y - 2, 5, 5);
    ctx.fillStyle = '#c9974f';
    ctx.fillRect(hoop.x - 1, hoop.y - 1, 3, 3);
  });

  // Benches and coaches along the baseline strip below the court. These are
  // static scenery drawn once into the court canvas (unlike the crowd, which
  // animates), so they cost nothing per frame.
  const benchY = c.y + c.h + 8;
  ctx.fillStyle = '#2a2f38';
  ctx.fillRect(c.x, benchY - 4, c.w, 14);
  [[homeTeam, c.x + 24, 1], [awayTeam, c.x + c.w - 96, -1]].forEach(function (side) {
    const team = side[0];
    const startX = side[1];
    for (let i = 0; i < 6; i++) {
      const bx = startX + i * 12;
      ctx.fillStyle = '#e2c4ae';            // head
      ctx.fillRect(bx + 1, benchY, 4, 4);
      ctx.fillStyle = team.colors.primary;   // warmups
      ctx.fillRect(bx, benchY + 4, 6, 6);
      ctx.fillStyle = team.colors.secondary;
      ctx.fillRect(bx, benchY + 4, 6, 1);
    }
    // coach in a dark suit at the end of the bench
    const cx2 = startX + (side[2] === 1 ? -14 : 78);
    ctx.fillStyle = '#e2c4ae';
    ctx.fillRect(cx2 + 1, benchY - 2, 4, 4);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(cx2, benchY + 2, 6, 9);
  });

  // center-court logo: existing team logo PNG, pixel-scaled, subtle
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(logoImg, midX - 20, c.y + c.h / 2 - 20, 40, 40);
    ctx.globalAlpha = 1;
  }

  return canvas;
}

// Crowd layout is deterministic (fixed seed) so the same fans sit in the
// same seats all game; only their pose changes frame to frame.
let _crowdPeople = null;
function crowdPeople(width) {
  if (_crowdPeople) return _crowdPeople;
  const rng = crowdRng(0xC0FFEE);
  _crowdPeople = [];
  for (let row = 0; row < 3; row++) {
    for (let cx = 4; cx < width - 4; cx += 10) {
      _crowdPeople.push({
        x: cx + Math.floor(rng() * 3),
        y: 8 + row * 16,
        shirt: CROWD_SHIRT[Math.floor(rng() * CROWD_SHIRT.length)],
        skin: CROWD_SKIN[Math.floor(rng() * CROWD_SKIN.length)],
        phase: rng() * Math.PI * 2,
        pep: 0.5 + rng() * 0.5 // some fans jump higher than others
      });
    }
  }
  return _crowdPeople;
}

// Animated crowd strip, drawn every frame. excitement is 0..1: at 0 the fans
// idle-sway; near 1 (right after a big play) they jump with arms up, each on
// their own phase so the wave ripples instead of pogoing in lockstep.
// homeBias 1 = the home team just did something good (full arena reaction),
// 0 = the visitors did (a scattered pocket of travelling fans, and the rest
// of the building sits on its hands).
function drawCrowd(ctx, tMs, excitement, homeBias) {
  const people = crowdPeople(PIXEL_STAGE.w);
  const bias = homeBias === undefined ? 1 : homeBias;
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const idleBob = Math.sin(tMs / 700 + p.phase) > 0.7 ? 1 : 0;
    // when the road team scores only the ~15% "away fans" react
    const reacts = bias > 0.5 || (i % 7 === 0);
    const localExcite = reacts ? excitement : excitement * 0.12;
    const jump = localExcite > 0.05
      ? Math.round(Math.max(0, Math.sin(tMs / 110 + p.phase)) * 3 * localExcite * p.pep)
      : 0;
    const y = p.y - jump + (jump === 0 ? idleBob : 0);
    ctx.fillStyle = p.shirt;
    ctx.fillRect(p.x, y + 4, 6, 8);
    ctx.fillStyle = p.skin;
    ctx.fillRect(p.x + 1, y, 4, 4);
    if (jump >= 2) { // arms up
      ctx.fillRect(p.x - 1, y + 3, 1, 3);
      ctx.fillRect(p.x + 6, y + 3, 1, 3);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCourtCanvas: buildCourtCanvas, drawCrowd: drawCrowd };
}
