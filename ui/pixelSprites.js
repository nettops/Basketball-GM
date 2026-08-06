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

function drawBall(ctx, x, y) {
  ctx.fillStyle = '#e8760e';
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  ctx.fillStyle = '#8a4207';
  ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIGIT_FONT: DIGIT_FONT,
    spriteColorsForPlayer: spriteColorsForPlayer,
    drawPixelNumber: drawPixelNumber,
    drawPlayerSprite: drawPlayerSprite,
    drawBall: drawBall
  };
}
