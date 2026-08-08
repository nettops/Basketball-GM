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

// Tuned against a captured highlight rather than guessed. At 0.7 the flash did
// not read as a punch, it read as the screen blanking — the whole court went
// near-white. And the lines used to start at age 0, which put their loudest
// moment underneath that wash, so their opening never showed at all.
const IMPACT_FLASH_ALPHA = 0.32;
// Lines wait for the flash to clear, then own the rest of the freeze.
const IMPACT_LINES_DELAY_MS = IMPACT_FLASH_MS;
const IMPACT_LINES_ALPHA = 0.8;

// startMs is null while only the lead-in zoom is armed — the camera has
// pushed in on the takeoff but the ball has not gone down yet.
let _impact = null;   // { kind, at, startMs, freezeMs, zoom, zoomStartMs }

// Safety valve for the lead-in. The slam normally supersedes it a couple of
// hundred ms later; this only matters if playback is torn down mid-leap.
const IMPACT_ZOOM_LEAD_MAX_MS = 900;

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

// Lead-in: push the camera in on the TAKEOFF rather than the landing. Armed
// at the rise beat, so the leap itself plays magnified; without it the dunk
// happened at full-court scale and the zoom only arrived once he was already
// hanging on the rim. No freeze, no flash, no lines — just the camera.
function armImpactZoom(marker, nowMs, opts) {
  const o = opts || {};
  if (!marker) return;
  if (o.reduceMotion || o.speed >= 8) return;
  if (marker.kind === 'block') return;   // blocks never zoom
  _impact = {
    kind: marker.kind,
    at: marker.at,
    startMs: null,
    freezeMs: 0,
    zoom: true,
    zoomStartMs: nowMs
  };
}

function startImpact(marker, nowMs, opts) {
  const o = opts || {};
  if (!marker) return;
  if (o.reduceMotion || o.speed >= 8) return;   // motion suppressed; caption still shows
  // The slam supersedes any lead-in outright. It does NOT need to carry the
  // lead-in's origin forward: the zoom is a snap at a fixed scale, not a
  // tween, so there is nothing part-way to preserve — and once startMs is set
  // impactZoom reads only that branch. (An earlier version stashed
  // zoomStartMs here; nothing ever read it.)
  _impact = {
    kind: marker.kind,
    at: marker.at,
    startMs: nowMs,
    freezeMs: impactFreezeMs(marker, o),
    // only the rare tier zooms — a block four times a game would be seasick
    zoom: marker.kind !== 'block',
    zoomStartMs: nowMs
  };
}

function resetImpact() { _impact = null; }

// stageW/stageH default to the pixel stage so existing callers and the smoke
// checks keep working without passing them.
function impactZoom(nowMs, stageW, stageH) {
  if (!_impact || !_impact.zoom) return null;
  if (_impact.startMs === null) {
    // lead-in: hold the push-in until the slam arms the full effect
    if (nowMs - _impact.zoomStartMs > IMPACT_ZOOM_LEAD_MAX_MS) return null;
  } else if (nowMs - _impact.startMs > _impact.freezeMs) {
    return null;
  }

  const w = stageW || 480, h = stageH || 270;
  // cx/cy is the point the view CENTRES on — the caller applies it as
  // translate(w/2, h/2) → scale → translate(-cx, -cy), not as a zoom about a
  // fixed point. That distinction matters: pinning the impact point in place
  // leaves it wherever it already was, and a poster resolves AT the rim, 14px
  // from the edge, so the dunk ended up jammed against the frame.
  //
  // Clamped to half a magnified viewport in from each edge, so the visible
  // window is always [0,w] of real court — never black bars, and the subject
  // stays on screen even when the play is in the corner.
  const halfW = w / (2 * IMPACT_ZOOM_SCALE);
  const halfH = h / (2 * IMPACT_ZOOM_SCALE);
  const cx = Math.min(Math.max(_impact.at.x, halfW), w - halfW);
  const cy = Math.min(Math.max(_impact.at.y, halfH), h - halfH);
  return { scale: IMPACT_ZOOM_SCALE, cx: cx, cy: cy };
}

// Radial speed lines from the point of impact. Drawn INSIDE the scene
// transform so they stay anchored to the action while it is zoomed.
function drawImpactLines(ctx, nowMs) {
  if (!_impact || _impact.startMs === null) return;   // lead-in zoom only
  const age = nowMs - _impact.startMs;
  // Hold off until the flash has cleared, or the lines spend their brightest
  // frames underneath a white wash and are never actually seen.
  if (age < IMPACT_LINES_DELAY_MS || age > IMPACT_LINES_MS) return;
  if (_impact.kind === 'block') return;   // tier 2 gets no lines

  const span = IMPACT_LINES_MS - IMPACT_LINES_DELAY_MS;
  const fade = 1 - (age - IMPACT_LINES_DELAY_MS) / span;
  const cx = _impact.at.x, cy = _impact.at.y;
  ctx.save();
  ctx.lineCap = 'butt';
  for (let i = 0; i < 12; i++) {
    const ang = (Math.PI * 2 / 12) * i;
    const inner = 18 + (1 - fade) * 10;
    const outer = inner + 26;
    const x1 = Math.round(cx + Math.cos(ang) * inner), y1 = Math.round(cy + Math.sin(ang) * inner);
    const x2 = Math.round(cx + Math.cos(ang) * outer), y2 = Math.round(cy + Math.sin(ang) * outer);
    // Dark pass first, one pixel proud on each side. White on tan hardwood is
    // barely a contrast step — without this the lines read as court markings.
    ctx.globalAlpha = 0.45 * fade;
    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    // then the line itself
    ctx.globalAlpha = IMPACT_LINES_ALPHA * fade;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

// Full-frame white flash. Drawn AFTER the scene transform so the zoom and the
// shake cannot skew or offset it.
function drawImpactFlash(ctx, nowMs, stageW, stageH) {
  if (!_impact || _impact.startMs === null) return;   // lead-in zoom only
  const age = nowMs - _impact.startMs;
  if (age < 0 || age > IMPACT_FLASH_MS) return;
  ctx.save();
  ctx.globalAlpha = IMPACT_FLASH_ALPHA * (1 - age / IMPACT_FLASH_MS);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, stageW, stageH);
  ctx.restore();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IMPACT_TIER1_FREEZE_MS: IMPACT_TIER1_FREEZE_MS,
    IMPACT_TIER2_FREEZE_MS: IMPACT_TIER2_FREEZE_MS,
    startImpact: startImpact,
    armImpactZoom: armImpactZoom,
    resetImpact: resetImpact,
    impactFreezeMs: impactFreezeMs,
    impactZoom: impactZoom,
    drawImpactLines: drawImpactLines,
    drawImpactFlash: drawImpactFlash
  };
}
