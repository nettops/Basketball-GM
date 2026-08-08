// Comic-panel treatment for highlight plays — see
// docs/superpowers/specs/2026-08-07-impact-moments-design.md.
//
// Two tiers. Posters and ankle breakers are rare (~3.4/game combined) and get
// the full effect: snap zoom, flash, radial speed lines, long freeze. Blocks
// are ~4/game and unfilterable, so they get a short punch — flash and shake at
// the freeze the view already used for makes. Acknowledging every swat without
// stopping the game four times is what keeps the top tier feeling rare.

// Durations in real milliseconds, unscaled by playback speed.
const IMPACT_TIER1_FREEZE_MS = 320;
const IMPACT_TIER2_FREEZE_MS = 120;
const IMPACT_FLASH_MS = 70;
const IMPACT_LINES_MS = 320;
const IMPACT_ZOOM_SCALE = 2;

let _impact = null;   // { kind, at, startMs, freezeMs, zoom }

// The zoom SNAPS rather than tweens. An eased scale on a 480x270 canvas with
// imageSmoothingEnabled = false lands sprite edges on fractional pixels every
// frame, which shimmers. Snapping in, holding, and snapping back is truer to
// pixel art and reads as a harder cut.
function impactFreezeMs(marker, opts) {
  if (!marker) return 0;
  const o = opts || {};
  if (o.reduceMotion) return 0;
  if (o.speed >= 8) return 0;
  const base = marker.kind === 'block' ? IMPACT_TIER2_FREEZE_MS : IMPACT_TIER1_FREEZE_MS;
  if (o.speed >= 4) return Math.round(base / 2);
  return base;
}

function startImpact(marker, nowMs, opts) {
  const o = opts || {};
  if (!marker) return;
  if (o.reduceMotion || o.speed >= 8) return;   // motion suppressed; caption still shows
  _impact = {
    kind: marker.kind,
    at: marker.at,
    startMs: nowMs,
    freezeMs: impactFreezeMs(marker, o),
    // only the rare tier zooms — a block four times a game would be seasick
    zoom: marker.kind !== 'block'
  };
}

function resetImpact() { _impact = null; }

function impactZoom(nowMs) {
  if (!_impact || !_impact.zoom) return null;
  if (nowMs - _impact.startMs > _impact.freezeMs) return null;
  return { scale: IMPACT_ZOOM_SCALE, cx: _impact.at.x, cy: _impact.at.y };
}

// Radial speed lines from the point of impact. Drawn INSIDE the scene
// transform so they stay anchored to the action while it is zoomed.
function drawImpactLines(ctx, nowMs) {
  if (!_impact) return;
  const age = nowMs - _impact.startMs;
  if (age < 0 || age > IMPACT_LINES_MS) return;
  if (_impact.kind === 'block') return;   // tier 2 gets no lines

  const fade = 1 - age / IMPACT_LINES_MS;
  const cx = _impact.at.x, cy = _impact.at.y;
  ctx.save();
  ctx.globalAlpha = 0.55 * fade;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const ang = (Math.PI * 2 / 12) * i;
    const inner = 18 + (1 - fade) * 10;
    const outer = inner + 26;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx + Math.cos(ang) * inner), Math.round(cy + Math.sin(ang) * inner));
    ctx.lineTo(Math.round(cx + Math.cos(ang) * outer), Math.round(cy + Math.sin(ang) * outer));
    ctx.stroke();
  }
  ctx.restore();
}

// Full-frame white flash. Drawn AFTER the scene transform so the zoom and the
// shake cannot skew or offset it.
function drawImpactFlash(ctx, nowMs, stageW, stageH) {
  if (!_impact) return;
  const age = nowMs - _impact.startMs;
  if (age < 0 || age > IMPACT_FLASH_MS) return;
  ctx.save();
  ctx.globalAlpha = 0.7 * (1 - age / IMPACT_FLASH_MS);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, stageW, stageH);
  ctx.restore();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IMPACT_TIER1_FREEZE_MS: IMPACT_TIER1_FREEZE_MS,
    IMPACT_TIER2_FREEZE_MS: IMPACT_TIER2_FREEZE_MS,
    startImpact: startImpact,
    resetImpact: resetImpact,
    impactFreezeMs: impactFreezeMs,
    impactZoom: impactZoom,
    drawImpactLines: drawImpactLines,
    drawImpactFlash: drawImpactFlash
  };
}
