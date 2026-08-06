// Procedural pixel sprites for the game view — no image assets, matching the
// repo's zero-asset style. Drawing functions take a canvas 2d context; the
// color/font helpers are pure so scripts/validate-pixel-sprites.js can test
// them in Node.

// 3x5 bitmap digits for jersey numbers ('1' = filled pixel).
const DIGIT_FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
};

// 3x5 uppercase glyphs so the in-scene scoreboard is drawn in the same
// pixel grid as everything else (canvas fillText would anti-alias and break
// the aesthetic). Only the characters a scoreboard needs.
const LETTER_FONT = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '010', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000']
};

const FALLBACK_SKIN = '#bb876f';
const FALLBACK_HAIR = '#272421';

// Home wears primary; away wears white with primary trim (classic home-dark /
// away-white readability so the two sides never share a jersey color).
function spriteColorsForPlayer(player, team, isHome) {
  const face = player.face || {};
  return {
    skin: (face.body && face.body.color) || FALLBACK_SKIN,
    hair: (face.hair && face.hair.color) || FALLBACK_HAIR,
    jersey: isHome ? team.colors.primary : '#FFFFFF',
    trim: isHome ? team.colors.secondary : team.colors.primary
  };
}

function drawPixelNumber(ctx, x, y, number, color) {
  const digits = String(number);
  ctx.fillStyle = color;
  for (let d = 0; d < digits.length; d++) {
    const glyph = DIGIT_FONT[digits[d]];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] === '1') ctx.fillRect(x + d * 4 + col, y + row, 1, 1);
      }
    }
  }
}

// Draws text in the 3x5 pixel grid. scale>1 blocks up each pixel so the
// scoreboard can be bigger than a jersey number without going blurry.
// Returns the drawn width so callers can center or right-align.
function pixelTextWidth(text, scale) {
  const s = scale || 1;
  return text.length * 4 * s - s;
}

function drawPixelText(ctx, x, y, text, color, scale) {
  const s = scale || 1;
  const up = String(text).toUpperCase();
  ctx.fillStyle = color;
  for (let i = 0; i < up.length; i++) {
    const ch = up[i];
    const glyph = LETTER_FONT[ch] || DIGIT_FONT[ch];
    if (!glyph) continue;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] === '1') {
          ctx.fillRect(x + (i * 4 + col) * s, y + row * s, s, s);
        }
      }
    }
  }
  return pixelTextWidth(up, s);
}

// ~10 wide x 24 tall, anchored center-bottom at (x, y).
// opts: frame (0|1, leg/arm cycle — only meaningful while moving),
// shooting (arms up), highlight (ball-handler ring), facing (-1 left,
// 0 camera, 1 right — leans the head into the run direction), moving
// (enables the leg cycle and arm swing; still players stand planted).
function drawPlayerSprite(ctx, x, y, colors, number, opts) {
  opts = opts || {};
  const left = Math.round(x) - 5;
  const top = Math.round(y) - 24;
  const facing = opts.facing || 0;

  if (opts.highlight) {
    ctx.fillStyle = 'rgba(255, 235, 59, 0.9)';
    ctx.fillRect(left - 1, Math.round(y) - 1, 12, 2);
  }

  // legs: 2-frame stride while moving, planted when still
  ctx.fillStyle = colors.skin;
  const bob = opts.moving && opts.frame ? 1 : 0;
  const bob2 = opts.moving ? 1 - bob : 0;
  ctx.fillRect(left + 2, top + 18 + bob, 2, 6 - bob);
  ctx.fillRect(left + 6, top + 18 + bob2, 2, 6 - bob2);
  // shorts
  ctx.fillStyle = colors.jersey;
  ctx.fillRect(left + 1, top + 15, 8, 4);
  // torso / jersey
  ctx.fillRect(left + 1, top + 8, 8, 8);
  ctx.fillStyle = colors.trim;
  ctx.fillRect(left + 1, top + 8, 8, 1); // shoulder trim
  // arms: raised when shooting, swinging opposite the legs when running
  ctx.fillStyle = colors.skin;
  if (opts.shooting) {
    ctx.fillRect(left, top + 2, 2, 7);
    ctx.fillRect(left + 8, top + 2, 2, 7);
  } else if (opts.moving) {
    ctx.fillRect(left, top + 9 - bob2, 2, 6);
    ctx.fillRect(left + 8, top + 9 - bob, 2, 6);
  } else {
    ctx.fillRect(left, top + 9, 2, 6);
    ctx.fillRect(left + 8, top + 9, 2, 6);
  }
  // head + hair, leaning 1px into the direction of travel
  ctx.fillRect(left + 3 + facing, top + 2, 4, 5);
  ctx.fillStyle = colors.hair;
  ctx.fillRect(left + 2 + facing, top, 6, 3);
  // jersey number (single digit centered, two digits offset)
  const numStr = String(number == null ? '' : number);
  if (numStr.length > 0) {
    const numX = left + (numStr.length === 1 ? 4 : 2);
    drawPixelNumber(ctx, numX, top + 10, numStr, colors.trim);
  }
}

// spin (radians) rotates the seam stripe so the ball visibly tumbles in
// flight instead of sliding through the air as a static blob.
function drawBall(ctx, x, y, spin) {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.fillStyle = '#e8760e';
  ctx.fillRect(bx - 1, by - 1, 3, 3);
  ctx.fillStyle = '#8a4207';
  if (spin === undefined) {
    ctx.fillRect(bx, by - 1, 1, 3);
    return;
  }
  // four seam orientations across a half-turn: |, /, -, \
  const phase = ((Math.round(spin / (Math.PI / 4)) % 4) + 4) % 4;
  if (phase === 0) ctx.fillRect(bx, by - 1, 1, 3);
  else if (phase === 2) ctx.fillRect(bx - 1, by, 3, 1);
  else if (phase === 1) { ctx.fillRect(bx - 1, by + 1, 1, 1); ctx.fillRect(bx, by, 1, 1); ctx.fillRect(bx + 1, by - 1, 1, 1); }
  else { ctx.fillRect(bx - 1, by - 1, 1, 1); ctx.fillRect(bx, by, 1, 1); ctx.fillRect(bx + 1, by + 1, 1, 1); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIGIT_FONT: DIGIT_FONT,
    LETTER_FONT: LETTER_FONT,
    spriteColorsForPlayer: spriteColorsForPlayer,
    drawPixelNumber: drawPixelNumber,
    drawPixelText: drawPixelText,
    pixelTextWidth: pixelTextWidth,
    drawPlayerSprite: drawPlayerSprite,
    drawBall: drawBall
  };
}
