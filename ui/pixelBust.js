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

// Identity: drawn identically for every emotion, back to front. Anything that
// varies with emotion belongs in BROW or MOUTH, never here — see
// checkEmotionChangesOnlyTheBrowAndMouth.
const HEAD_RECTS = [
  ['jersey', [5, 34, 22, 6]],
  ['trim',   [5, 34, 22, 1]],
  ['skin',   [13, 29, 6, 6]],    // neck
  ['skin',   [8, 6, 16, 24]],    // head
  ['shadow', [8, 27, 16, 3]],    // jaw shading, so the chin reads
  ['hair',   [7, 4, 18, 6]],     // fringe
  ['hair',   [7, 4, 2, 11]],     // left sideburn
  ['hair',   [23, 4, 2, 11]]     // right sideburn
];

const EYE_RECTS = [[11, 17, 3, 3], [18, 17, 3, 3]];
const NOSE_RECT = [15, 21, 2, 3];

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

  function rect(color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + r[0] * s, oy + r[1] * s, r[2] * s, r[3] * s);
  }

  const palette = {
    skin: colors.skin, hair: colors.hair, jersey: colors.jersey,
    trim: colors.trim, shadow: BUST_SHADOW
  };
  HEAD_RECTS.forEach(function (pair) { rect(palette[pair[0]], pair[1]); });
  EYE_RECTS.forEach(function (r) { rect(BUST_FEATURE, r); });
  rect(BUST_SHADOW, NOSE_RECT);
  BROW[e].forEach(function (r) { rect(BUST_FEATURE, r); });
  MOUTH[e].forEach(function (r) { rect(BUST_FEATURE, r); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUST: BUST,
    BUST_EMOTIONS: BUST_EMOTIONS,
    BROW: BROW,
    MOUTH: MOUTH,
    bustScale: bustScale,
    bustColorsFor: bustColorsFor,
    drawPixelBust: drawPixelBust
  };
}
