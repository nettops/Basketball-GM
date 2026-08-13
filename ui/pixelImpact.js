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
// Which kinds still earn a freeze at a given speed. The bar RISES with speed,
// which is the inverse of what this module used to do — it faded the emphasis
// out above 4x and killed it entirely at 8x, switching the effect off at exactly
// the speed where a highlight blurs past.
//
// Measured over 60 games: block 4.5/game, poster 2.0, ankle 1.7 — 8.3 total. At
// 8x a whole game plays in well under a minute, so freezing on all of them is a
// stutter every few seconds rather than emphasis. Blocks are simultaneously the
// most common and the least spectacular (they were already excluded from the
// camera push), so they drop out first. At 8x only a poster qualifies: ~2 a
// game, which is the "rip through the possessions and stop dead on the dunk"
// experience this exists to buy.
// 'takeover' is in every band. It is rarer than a poster — about one a game
// across both teams against roughly two posters — so if anything earns the stop
// at 8x, it does.
const IMPACT_SPEED_BAR = [
  { maxSpeed: 2, kinds: ['takeover', 'poster', 'ankle', 'block'] },
  { maxSpeed: 4, kinds: ['takeover', 'poster', 'ankle'] },
  { maxSpeed: Infinity, kinds: ['takeover', 'poster'] }
];

function impactQualifies(kind, speed) {
  const s = typeof speed === 'number' ? speed : 1;
  for (let i = 0; i < IMPACT_SPEED_BAR.length; i++) {
    if (s <= IMPACT_SPEED_BAR[i].maxSpeed) {
      return IMPACT_SPEED_BAR[i].kinds.indexOf(kind) !== -1;
    }
  }
  return false;
}

// A freeze is real milliseconds, but at 8x each real second consumes eight times
// the game, so the same freeze buys proportionally less emphasis. It therefore
// scales UP with speed — and is capped, because past roughly a second a frozen
// game stops reading as a moment and starts reading as a hang.
//
// The cap is on the RESULT, not on the multiplier. The design doc proposed
// capping the multiplier at 4, which for a 320ms base allows 1280ms — past the
// very line the cap exists to stay behind. Capping the duration directly is what
// that reasoning actually calls for.
const IMPACT_FREEZE_MAX_MS = 900;

function impactFreezeMs(marker, opts) {
  if (!marker) return 0;
  const o = opts || {};
  if (o.reduceMotion) return 0;
  const speed = typeof o.speed === 'number' ? o.speed : 1;
  if (!impactQualifies(marker.kind, speed)) return 0;
  const base = marker.kind === 'block' ? IMPACT_TIER2_FREEZE_MS : IMPACT_TIER1_FREEZE_MS;
  return Math.min(Math.round(base * speed), IMPACT_FREEZE_MAX_MS);
}

// Lead-in: push the camera in on the TAKEOFF rather than the landing. Armed
// at the rise beat, so the leap itself plays magnified; without it the dunk
// happened at full-court scale and the zoom only arrived once he was already
// hanging on the rim. No freeze, no flash, no lines — just the camera.
function armImpactZoom(marker, nowMs, opts) {
  const o = opts || {};
  if (!marker) return;
  // The 8x bail-out is gone deliberately. The camera push is what distinguishes
  // "this is a moment" from "the game froze", so it matters MORE at high speed,
  // not less. It now follows the same qualifying bar as the freeze.
  if (o.reduceMotion) return;
  if (!impactQualifies(marker.kind, typeof o.speed === 'number' ? o.speed : 1)) return;
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
  if (o.reduceMotion) return;                   // motion suppressed; caption still shows
  // `o.speed >= 8` used to sit on that line, and it was the whole bug.
  //
  // b9b0b2e set out to make big moments hit HARDEST at high speed -- at 1x you
  // can follow a dunk unaided, at 8x it is a smear -- and it removed the 8x
  // bail-out from armImpactZoom and rewrote impactFreezeMs to scale up. It did
  // not remove this one. So at 8x nothing was ever armed: no zoom, no flash,
  // no speed lines, no freeze. The feature was dead at exactly the speed it was
  // rebuilt for.
  //
  // It stayed hidden because impactFreezeMs answers 900ms when asked directly,
  // which is what the Node validator asks, while the game never got that far.
  // Same bar as armImpactZoom and impactFreezeMs now -- one rule, three places.
  if (!impactQualifies(marker.kind, typeof o.speed === 'number' ? o.speed : 1)) return;
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
    impactQualifies: impactQualifies,
    IMPACT_FREEZE_MAX_MS: IMPACT_FREEZE_MAX_MS,
    impactZoom: impactZoom,
    drawImpactLines: drawImpactLines,
    drawImpactFlash: drawImpactFlash
  };
}
