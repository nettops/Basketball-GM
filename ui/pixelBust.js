// Shoulders-up pixel portraits for the dialogue box.
//
// Separate from ui/pixelSprites.js because that file draws 14x32 full-body
// court figures whose head is a featureless 4x5 block — legible at table size
// and meaningless at portrait size. This one draws a face.
//
// It deliberately does NOT join startPlayerSpriteAutoPaint. That observer is
// idempotent and skips an already-painted canvas, which is exactly wrong for a
// portrait that must repaint every time the emotion changes. The dialogue
// engine owns its canvas and repaints it directly.

var _BUST_DATA = (typeof require !== 'undefined')
  ? { sprites: require('./pixelSprites.js') }
  : { sprites: {
        spriteColorsForPlayer: spriteColorsForPlayer,
        safeSpriteColor: safeSpriteColor,
        SPRITE_CARD_NO_TEAM: SPRITE_CARD_NO_TEAM
      } };

// The logical grid. Everything below is in these units and multiplied by an
// integer scale at draw time.
const BUST = { w: 32, h: 40 };

const BUST_EMOTIONS = ['neutral', 'confident', 'angry', 'shaken'];

const BUST_FALLBACK_SKIN = '#bb876f';
const BUST_FALLBACK_HAIR = '#272421';
const BUST_FEATURE = '#1b1a19';            // eyes, brows, mouth — near-black
const BUST_SHADOW = 'rgba(0,0,0,0.18)';    // jaw and nose shading

const EYE_RECTS = [[11, 17, 3, 3], [18, 17, 3, 3]];
const NOSE_RECT = [15, 21, 2, 3];

// --- traits ---------------------------------------------------------------
// Traits let several people share this one renderer and still read as
// different men. At 32x40 that has to come from the OUTLINE: recolouring the
// same silhouette produces one man in four suits, which is what the studio
// panel needs not to be.

// Hair decides the shape above the brow, which is most of the outline.
const HAIR = {
  full:     [[7, 4, 18, 6], [7, 4, 2, 11], [23, 4, 2, 11]],
  short:    [[8, 5, 16, 4], [8, 5, 2, 8], [22, 5, 2, 8]],
  receding: [[9, 5, 14, 3], [7, 7, 2, 8], [23, 7, 2, 8]],
  bald:     []
};
// A bald head still needs its crown filled in, or the face floats.
const CROWN_RECT = [9, 4, 14, 4];

const FACIAL = {
  none:     [],
  goatee:   [[14, 27, 4, 2], [13, 26, 1, 1], [18, 26, 1, 1]],
  mustache: [[14, 23, 4, 1]]
};

// Build widens the shoulders and the jaw and lifts the head. Three sizes
// rather than two: bald+broad twice over gave two men with pixel-identical
// outlines, because a goatee only recolours cells the face already fills.
// `lift` raises everything above the shoulders, so a bigger man sits TALLER
// rather than merely wider — the shoulders stay on the desk line.
const BUILD = {
  normal: { shoulder: [5, 34, 22, 6], trim: [5, 34, 22, 1], jawPad: 0, lift: 0 },
  broad:  { shoulder: [2, 33, 28, 7], trim: [2, 33, 28, 1], jawPad: 1, lift: 0 },
  huge:   { shoulder: [0, 32, 32, 8], trim: [0, 32, 32, 1], jawPad: 2, lift: -2 }
};

const GLASSES_RECTS = [
  [10, 16, 5, 1], [17, 16, 5, 1],
  [10, 16, 1, 4], [14, 16, 1, 4], [17, 16, 1, 4], [21, 16, 1, 4],
  [15, 17, 2, 1]   // bridge
];

// Brows and mouths are the ONLY things emotion changes.
const BROW = {
  neutral:   [[11, 14, 3, 1], [18, 14, 3, 1]],                              // level
  confident: [[11, 13, 3, 1], [18, 13, 3, 1]],                              // both lifted
  angry:     [[11, 13, 2, 1], [13, 15, 2, 1], [17, 15, 2, 1], [19, 13, 2, 1]],  // inner ends driven down
  shaken:    [[11, 15, 2, 1], [13, 13, 2, 1], [17, 13, 2, 1], [19, 15, 2, 1]]   // inner ends lifted
};

const MOUTH = {
  neutral:   [[14, 25, 4, 1]],
  confident: [[14, 25, 4, 1], [13, 24, 1, 1], [18, 24, 1, 1]],   // corners up
  angry:     [[14, 24, 4, 1], [13, 25, 1, 1], [18, 25, 1, 1]],   // corners down
  shaken:    [[15, 24, 2, 3]]                                     // small open O
};

// Sized on HEIGHT and floored to a whole number. See spriteCardScale in
// ui/pixelSprites.js for why a fractional scale is not an option here.
function bustScale(sizePx) {
  return Math.max(1, Math.floor((sizePx || BUST.h) / BUST.h));
}

// Colours come from the sprite system so a bust and that player's table
// sprite can never disagree about who he is.
function bustColorsFor(player, team) {
  const s = _BUST_DATA.sprites;
  const c = s.spriteColorsForPlayer(player || {}, team || s.SPRITE_CARD_NO_TEAM, true);
  return {
    skin: s.safeSpriteColor(c.skin, BUST_FALLBACK_SKIN),
    hair: s.safeSpriteColor(c.hair, BUST_FALLBACK_HAIR),
    jersey: s.safeSpriteColor(c.jersey, '#5b6673'),
    trim: s.safeSpriteColor(c.trim, '#c9d1d9')
  };
}

function drawPixelBust(ctx, colors, emotion, opts) {
  opts = opts || {};
  const s = opts.scale || 1;
  const ox = opts.x || 0;
  const oy = opts.y || 0;
  const e = BROW[emotion] ? emotion : 'neutral';

  const t = opts.traits || {};
  const hairId = HAIR[t.hair] ? t.hair : 'full';
  const build = BUILD[t.build] || BUILD.normal;
  const facial = FACIAL[t.facialHair] || FACIAL.none;
  const pad = build.jawPad;
  const dy = build.lift;

  // Shoulders sit on the desk line whatever the build.
  function rect(color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + r[0] * s, oy + r[1] * s, r[2] * s, r[3] * s);
  }
  // Everything from the neck up rides the build's lift.
  function head(color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + r[0] * s, oy + (r[1] + dy) * s, r[2] * s, r[3] * s);
  }

  rect(colors.jersey, build.shoulder);
  rect(colors.trim, build.trim);
  // Collar notch, so a suit reads as a suit rather than a jersey. Shortened by
  // the lift so it still meets the neck instead of overshooting the shoulders.
  rect(colors.trim, [14, 33 + dy, 4, 3 - dy]);
  head(colors.skin, [13, 29, 6, 6]);                      // neck
  head(colors.skin, [8 - pad, 6, 16 + pad * 2, 24]);      // head
  head(BUST_SHADOW, [8 - pad, 27, 16 + pad * 2, 3]);      // jaw shading
  if (hairId === 'bald') head(colors.skin, CROWN_RECT);
  HAIR[hairId].forEach(function (r) { head(colors.hair, r); });
  EYE_RECTS.forEach(function (r) { head(BUST_FEATURE, r); });
  head(BUST_SHADOW, NOSE_RECT);
  BROW[e].forEach(function (r) { head(BUST_FEATURE, r); });
  MOUTH[e].forEach(function (r) { head(BUST_FEATURE, r); });
  facial.forEach(function (r) { head(colors.hair, r); });
  if (t.glasses) {
    const g = colors.glasses || '#c9d1d9';
    GLASSES_RECTS.forEach(function (r) { head(g, r); });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUST: BUST,
    BUST_EMOTIONS: BUST_EMOTIONS,
    BROW: BROW,
    MOUTH: MOUTH,
    HAIR: HAIR,
    FACIAL: FACIAL,
    BUILD: BUILD,
    bustScale: bustScale,
    bustColorsFor: bustColorsFor,
    drawPixelBust: drawPixelBust
  };
}
