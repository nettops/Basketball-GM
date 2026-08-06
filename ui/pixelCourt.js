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

  // arena backdrop + crowd strip (top band above the court)
  ctx.fillStyle = '#1c2026';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rng = crowdRng(0xC0FFEE);
  for (let row = 0; row < 3; row++) {
    for (let cx = 4; cx < canvas.width - 4; cx += 10) {
      const px = cx + Math.floor(rng() * 3);
      const py = 8 + row * 16;
      ctx.fillStyle = CROWD_SHIRT[Math.floor(rng() * CROWD_SHIRT.length)];
      ctx.fillRect(px, py + 4, 6, 8);
      ctx.fillStyle = CROWD_SKIN[Math.floor(rng() * CROWD_SKIN.length)];
      ctx.fillRect(px + 1, py, 4, 4);
    }
  }

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

  // center-court logo: existing team logo PNG, pixel-scaled, subtle
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(logoImg, midX - 20, c.y + c.h / 2 - 20, 40, 40);
    ctx.globalAlpha = 1;
  }

  return canvas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCourtCanvas: buildCourtCanvas };
}
