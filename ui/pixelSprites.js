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
// shooting (arms up), dunking (airborne: legs tucked, one arm extended
// over the head — overrides both the leg cycle and shooting),
// stumbling (beaten off the dribble: legs splayed, arms flung out for
// balance — overrides the leg cycle and shooting, but not dunking),
// following (jump-shot follow-through: shooting hand up and snapped over,
// guide hand dropped — held while the ball is in the air),
// highlight (ball-handler ring), facing (-1 left,
// 0 camera, 1 right — leans the head into the run direction), moving
// (enables the leg cycle and arm swing; still players stand planted),
// heightIn (real height in inches — drives how tall the sprite is drawn),
// tall (an explicit pixel delta, overriding heightIn; for previews and tests).

// How many pixels taller or shorter than the standard 24px body. Heights run
// 72"-91" (6'0" to 7'7") and the league median body is about 79", so the
// baseline is set there rather than at the midpoint of the range — otherwise
// the whole league would read as short, since there are far more guards than
// seven-footers.
//
// The spread is deliberately large — 8px between a 6'0" guard and a 7'7"
// centre, on a 24px body. Big men are supposed to tower.
const SPRITE_HEIGHT = { base: 79, perInch: 0.45, cap: 5 };

function spriteTallness(heightIn) {
  if (typeof heightIn !== 'number' || !heightIn) return 0;
  const d = (heightIn - SPRITE_HEIGHT.base) * SPRITE_HEIGHT.perInch;
  return Math.max(-SPRITE_HEIGHT.cap, Math.min(SPRITE_HEIGHT.cap, Math.round(d)));
}

// The difference is SPLIT between legs and torso rather than taken entirely
// out of the legs. Legs are only 6px to begin with, so putting the whole delta
// there left a 6'0" guard standing on 3px stumps — he read as stubby rather
// than as short, which is a different and much worse thing. Sixty/forty keeps
// the tall man leggy (which is true of tall people) without halving anybody.
function spriteLegDelta(tall) { return Math.round(tall * 0.6); }

// KNEE BEND, and why it is not the same thing as moving the sprite down.
//
// Anticipation used to be drawn by the view as `y - lift` with a negative lift,
// which slides the whole body — feet included — below the shadow. A man loading
// up for a shot does not sink into the court: his feet stay where they are, his
// knees fold, and everything above the knees comes down with them. That is what
// `crouch` does here, and it is the difference between the gather reading as
// effort and reading as a rendering fault.
//
// The bend is SPLIT between the knees and the waist, for the same reason
// spriteLegDelta splits height between legs and torso: legs are only 6px on a
// standard body and 4px on a short guard, so taking the whole bend out of them
// either eats the shins outright or leaves the players who take most of the
// shots with a 1px gather. A real gather folds at both joints anyway.
//
// Floors on each: 3px of shin and 5px of torso have to survive, or the
// silhouette stops reading as a person and starts reading as a drawing bug.
const CROUCH_MIN_LEG = 3;
const CROUCH_MIN_TORSO = 5;

// Returns { hip, head }: how far the hips drop (the knees folding) and how far
// the shoulders drop (the knees plus the waist). They differ, and that
// difference is what makes it a squat rather than the sprite shrinking.
function crouchSplit(crouch, legLen, torsoLen) {
  const c = typeof crouch === 'number' && crouch > 0 ? Math.round(crouch) : 0;
  if (!c) return { hip: 0, head: 0 };
  const hip = Math.min(c, Math.max(0, legLen - CROUCH_MIN_LEG));
  const waist = Math.min(c - hip, Math.max(0, torsoLen - CROUCH_MIN_TORSO));
  return { hip: hip, head: hip + waist };
}

function drawPlayerSprite(ctx, x, y, colors, number, opts) {
  opts = opts || {};
  const left = Math.round(x) - 5;
  const top = Math.round(y) - 24;
  // Feet stay on the floor at `y` and the extra height goes UPWARD, into the
  // legs and then the whole upper body. Growing downward would sink a tall man
  // through the court; growing from the middle would leave him hovering.
  const tall = typeof opts.tall === 'number' ? opts.tall : spriteTallness(opts.heightIn);
  const legT = spriteLegDelta(tall);      // added to leg length
  const bodyT = tall - legT;              // added to torso length
  // How far the hips and the shoulders drop with the feet planted.
  const bend = crouchSplit(opts.crouch, 6 + legT, 8 + bodyT);
  const hipDrop = bend.hip;
  const waist = bend.head - bend.hip;   // the fold at the waist, on top of the knees
  // Torso lean, in whole pixels so nothing lands between them. The legs do NOT
  // take it — a body leaning over planted feet is the whole point, and moving
  // both together is just the sprite sliding sideways.
  const lean = Math.round(opts.lean || 0);
  const topU = top - tall + bend.head;  // head and shoulders — everything above the torso
  const lx = left + lean;               // upper-body x, leaned off the planted feet
  const facing = opts.facing || 0;

  if (opts.highlight) {
    ctx.fillStyle = 'rgba(255, 235, 59, 0.9)';
    ctx.fillRect(left - 1, Math.round(y) - 1, 12, 2);
  }

  // legs: 2-frame stride while moving, planted when still. A dunker in the
  // air has nothing to stand on — the legs tuck and split, which is most of
  // what separates an airborne silhouette from a standing one at this size.
  ctx.fillStyle = colors.skin;
  // declared out here because the running-arms branch below swings opposite
  // these same values
  const bob = opts.moving && opts.frame ? 1 : 0;
  const bob2 = opts.moving ? 1 - bob : 0;
  // A player who is not running still shifts his weight. Without this a
  // standing sprite has ZERO moving pixels — the old ±0.7px positional sway
  // rounded away to nothing — and 64% of the floor is standing at any moment.
  // One pixel of alternating weight is enough to read as breathing.
  const idle = (!opts.moving && !opts.dunking && !opts.stumbling && opts.idleFrame) ? 1 : 0;
  if (opts.dunking) {
    ctx.fillRect(left + 1, topU + 18, 2, 4);  // trail leg, bent back
    ctx.fillRect(left + 6, topU + 17, 2, 3);  // lead knee driven up
  } else if (opts.layup) {
    // A dunker tucks BOTH legs under him; a layup drives ONE knee and lets the
    // other trail. That asymmetry is most of what separates the two
    // silhouettes in the air, and without it every finish at the rim read as
    // the same airborne shape at a different height.
    const lead = (opts.layup.side || 1) >= 0;
    ctx.fillRect(left + (lead ? 6 : 2), topU + 16, 2, 4);   // driven knee
    ctx.fillRect(left + (lead ? 2 : 6), topU + 19, 2, 5);   // trail leg hanging
  } else if (opts.stumbling) {
    // Legs splayed WIDE and buckling. The old pose was symmetric — both legs
    // the same length at the same height — which reads as a wide defensive
    // stance rather than as losing your feet. Now the trail leg skids out from
    // under him while the front leg collapses shorter and lower, so the two
    // sides disagree about where his weight is going.
    // Anchored to the FLOOR, not to the shoulder line. These used to hang off
    // `topU`, which moves with the player's height — so a 6'0" guard's splayed
    // legs punched 3px through the court and a 7'7" centre's floated 5px above
    // it. A man losing his feet is still standing on them; it is the same
    // defect the shooting gather had, in the one pose where the legs are the
    // whole point.
    const footY = top + 24;
    ctx.fillRect(left - 3, footY - 3, 4, 3);   // trail leg skidding out
    ctx.fillRect(left + 8, footY - 2, 4, 2);   // front leg collapsed under him
  } else {
    // idle shifts the weight onto one leg: that hip drops a pixel and the
    // other leg shortens, which is the smallest change that reads as alive.
    // `hipDrop` folds the knees on top of that, feet staying put.
    const legY = top + 18 - legT + hipDrop;
    const legH = 6 + legT - hipDrop;
    ctx.fillRect(left + 2, legY + bob + idle, 2, Math.max(1, legH - bob - idle));
    ctx.fillRect(left + 6, legY + bob2, 2, Math.max(1, legH - bob2 - idle));
  }
  // shorts — ride the hips, so they come down with the knees but not with the
  // extra fold at the waist
  ctx.fillStyle = colors.jersey;
  ctx.fillRect(lx + 1, top + 15 - legT + hipDrop, 8, 4);
  // torso / jersey. Shortened by the fold at the waist so the shoulders can
  // come down further than the hips without the chest stretching to meet them.
  ctx.fillRect(lx + 1, topU + 8, 8, Math.max(1, 8 + bodyT - waist));
  ctx.fillStyle = colors.trim;
  ctx.fillRect(lx + 1, topU + 8, 8, 1); // shoulder trim
  // arms: raised when shooting, swinging opposite the legs when running
  ctx.fillStyle = colors.skin;
  if (opts.dunking) {
    // One arm reaches ABOVE the head with the ball; the other trails. A
    // shooter's arms stop at the hairline, so the extended arm is what reads
    // as "going up at the rim" rather than "taking a jumper".
    const ballSide = (opts.facing || 0) >= 0;
    ctx.fillRect(lx + (ballSide ? 8 : 0), topU - 6, 2, 14);
    ctx.fillRect(lx + (ballSide ? 0 : 8), topU + 3, 2, 7);
  } else if (opts.layup) {
    // The finishing hand goes up on the side he is going up from, and the OFF
    // arm tucks across the chest rather than hanging — that tuck is the ball
    // protection the brief asks for, and it is also what stops the pose being
    // read as a dunk that fell short.
    //
    // `extend` (0..1) is how far through the reach he is, so the arm rises into
    // full extension over the rise and release beats instead of appearing at
    // full stretch on the frame the pose switches on.
    const lead = (opts.layup.side || 1) >= 0;
    const ext = Math.max(0, Math.min(1, opts.layup.extend === undefined ? 1 : opts.layup.extend));
    const reach = Math.round(ext * 5);            // 0 at the gather, 5 at full stretch
    ctx.fillRect(lx + (lead ? 8 : 0), topU + 3 - reach, 2, 7 + reach);
    // off arm across the body, held in tight
    ctx.fillRect(lx + (lead ? 3 : 5), topU + 10, 2, 2);
    ctx.fillRect(lx + (lead ? 1 : 7), topU + 9, 2, 4);
  } else if (opts.stumbling) {
    // Arms flung out ASYMMETRICALLY and further than before — lead arm thrown
    // up and out, trail arm dropped behind. Both arms at the same height reads
    // as a shrug; the mismatch is what reads as falling. Total reach widens
    // from 14px to 17px, which is what makes the silhouette carry at speed.
    ctx.fillRect(lx - 4, topU + 6, 4, 2);    // lead arm flung up and out
    ctx.fillRect(lx + 9, topU + 13, 4, 2);   // trail arm dropped behind
  } else if (opts.following) {
    // Follow-through: shooting hand still up and snapped over, guide hand
    // dropped away. Held while the ball is in the air — this is the pose that
    // actually says "jump shot" rather than "player with both arms up".
    const hand = (opts.facing || 0) >= 0;
    ctx.fillRect(lx + (hand ? 8 : 0), topU - 2, 2, 10);
    ctx.fillRect(lx + (hand ? 8 : 0) + (hand ? -1 : 1), topU - 3, 2, 1);   // snapped wrist
    ctx.fillRect(lx + (hand ? 0 : 8), topU + 10, 2, 5);
  } else if (opts.shooting) {
    ctx.fillRect(lx, topU + 2, 2, 7);
    ctx.fillRect(lx + 8, topU + 2, 2, 7);
  } else if (opts.dribbling) {
    // He is actually dribbling the ball. Before this the ball bounced beside a
    // man whose arms were doing the idle weight-shift — nobody's hand ever went
    // down to meet it, which is the single thing that made the default dribble
    // read as a bouncing prop rather than a player.
    //
    // The ball-side arm EXTENDS from a fixed shoulder rather than sliding down
    // whole: a shoulder that moves with the ball reads as a shrug. `side` is
    // screen-space (+1 = the sprite's right) and comes from the same
    // dribbleHand() the ball itself uses, so the hand cannot end up pumping on
    // the side the ball is not on.
    //
    // `crossing` is the one addition a named move makes to the pose: through a
    // crossover he gets BOTH arms down and out, because the ball is being
    // driven from one hand to the other and neither is idle. Without it, a
    // move that swings the ball 15px around him was drawn by a man standing
    // with one arm hanging.
    const reach = Math.round((1 - opts.dribbling.phase) * 3);
    const ballRight = opts.dribbling.side >= 0;
    const crossing = !!opts.dribbling.crossing;
    const offArmY = topU + 9 - (opts.moving ? bob2 : -idle);
    ctx.fillRect(lx + (ballRight ? 0 : 8), offArmY, 2, 6 + bodyT + (crossing ? reach : 0));
    ctx.fillRect(lx + (ballRight ? 8 : 0), topU + 9, 2, 6 + bodyT + reach);
  } else if (opts.moving) {
    ctx.fillRect(lx, topU + 9 - bob2, 2, 6 + bodyT);
    ctx.fillRect(lx + 8, topU + 9 - bob, 2, 6 + bodyT);
  } else {
    // the arms ride the weight shift too, opposite shoulders
    ctx.fillRect(lx, topU + 9 + idle, 2, 6 + bodyT);
    ctx.fillRect(lx + 8, topU + 9, 2, 6 + bodyT);
  }
  // head + hair, leaning 1px into the direction of travel
  ctx.fillRect(lx + 3 + facing, topU + 2, 4, 5);
  ctx.fillStyle = colors.hair;
  ctx.fillRect(lx + 2 + facing, topU, 6, 3);
  // jersey number (single digit centered, two digits offset)
  const numStr = String(number == null ? '' : number);
  if (numStr.length > 0) {
    const numX = lx + (numStr.length === 1 ? 4 : 2);
    drawPixelNumber(ctx, numX, topU + 10, numStr, colors.trim);
  }
}

// BALL DEFORMATION, on a ball three pixels across.
//
// There is exactly one honest move available at this size: drop a pixel off the
// axis being squashed and keep the other. A 3x3 ball travelling fast horizontally
// becomes 3 wide and 2 tall; one travelling fast vertically becomes 2 wide and
// 3 tall. Anything subtler is sub-pixel and would need smoothing, which is the
// one thing the whole sprite system refuses to do.
//
// So it is used sparingly and only where the eye is already reading speed: a
// hard pass, a shot on its way down, a dribble driven into the floor. `squash`
// is 0..1 and anything under half draws the round ball, because a deformation
// that flickers on and off between frames is worse than none.
const BALL_SQUASH_MIN = 0.5;

// Which axis to flatten, from the direction of travel. Returns { w, h } in
// pixels for the ball's body.
function ballShape(squash, vx, vy) {
  if (!(squash >= BALL_SQUASH_MIN)) return { w: 3, h: 3 };
  return Math.abs(vx || 0) >= Math.abs(vy || 0) ? { w: 3, h: 2 } : { w: 2, h: 3 };
}

// spin (radians) rotates the seam stripe so the ball visibly tumbles in
// flight instead of sliding through the air as a static blob.
//
// `deform` is optional { squash, vx, vy } — see ballShape. Omitted, the ball is
// round, which is what every caller that does not care about impact wants.
function drawBall(ctx, x, y, spin, deform) {
  const bx = Math.round(x);
  const by = Math.round(y);
  const shape = deform ? ballShape(deform.squash, deform.vx, deform.vy) : { w: 3, h: 3 };
  ctx.fillStyle = '#e8760e';
  // Kept centred on (bx, by) as it flattens, so a squashing ball does not drift
  // sideways — the deformation has to be free of positional consequence or it
  // becomes another thing that moves the ball without meaning to.
  const ox = shape.w === 3 ? -1 : 0;
  const oy = shape.h === 3 ? -1 : 0;
  ctx.fillRect(bx + ox, by + oy, shape.w, shape.h);
  ctx.fillStyle = '#8a4207';
  // A flattened ball has no room for a seam; drawing one fills it in solid and
  // it stops reading as a ball at all.
  if (shape.w !== 3 || shape.h !== 3) return;
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

// A single standing sprite drawn to a data URL, for the HTML views. The point
// is that a player's picture is LITERALLY the man you watch on the court — the
// same function drawing the same pixels — rather than a second illustration
// that can drift away from him. Height variation comes along for free: a
// seven-footer's picture is visibly taller than a guard's.
//
// The box is deliberately taller than the body. Sprites are anchored at the
// feet, so a short player sits lower in the frame and a tall one fills it,
// which is the whole point and would be destroyed by cropping to fit.
const SPRITE_CARD = { w: 14, h: 32, footY: 30 };

// Free agents have no team to take colours from.
const SPRITE_CARD_NO_TEAM = { colors: { primary: '#5b6673', secondary: '#c9d1d9' } };

// Integer scaling only — a fractional scale gives some pixels two screen
// pixels and their neighbours three, which at this size reads as a rendering
// bug rather than as pixel art. Sized on HEIGHT because the sprite is a much
// narrower shape than the face it replaces, and callers pass a face width.
function spriteCardScale(sizePx) {
  return Math.max(1, Math.floor(((sizePx || 80) * 1.5) / SPRITE_CARD.h));
}

// The picture is a real drawing surface in the page, painted directly. It used
// to be a PNG file embedded as text, and that conversion was 80% of the cost:
//
//   drawing the figure   0.0035ms      0.4%
//   allocating a canvas  0.0067ms      0.7%
//   encoding the PNG     0.7645ms     80%
//
// The conversion cost is also very nearly FIXED per call rather than per
// pixel — a 14x32 table sprite encodes in 0.60ms and a 56x128 profile picture
// in 0.44ms, so the small one is DEARER. Shrinking cannot help and neither can
// WebP (0.81ms). The only real fix is to stop converting. Measured over 400
// rows: 509ms of data URLs against 16ms of canvases, and the page HTML drops
// from 172KB to 32KB. The memoisation this replaces is gone with it — at
// 0.04ms a row there is nothing left worth remembering.
//
// Everything the paint needs rides on the element, so painting depends on no
// game state and can happen at any time, in any order, more than once.

// Colours reach the DOM as attributes, so they are pinned to a strict hex
// shape rather than trusted. Custom players can carry author-supplied colour
// values (see the commissioner's player editor), and an attribute is exactly
// where an unescaped one would matter.
function safeSpriteColor(value, fallback) {
  return (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)) ? value : fallback;
}

function spriteCanvasAttrs(player, team, s) {
  const c = spriteColorsForPlayer(player, team || SPRITE_CARD_NO_TEAM, true);
  const num = player.jerseyNumber;
  return ' data-sprite="1"' +
    ' data-h="' + (typeof player.heightIn === 'number' ? Math.round(player.heightIn) : '') + '"' +
    ' data-n="' + (num == null ? '' : String(num).replace(/[^0-9]/g, '')) + '"' +
    ' data-jersey="' + safeSpriteColor(c.jersey, '#5b6673') + '"' +
    ' data-trim="' + safeSpriteColor(c.trim, '#c9d1d9') + '"' +
    ' data-skin="' + safeSpriteColor(c.skin, FALLBACK_SKIN) + '"' +
    ' data-hair="' + safeSpriteColor(c.hair, FALLBACK_HAIR) + '"' +
    ' data-scale="' + s + '"';
}

// Drop-in shape-alike for faces.js's playerFaceHtml, so a caller swaps one
// name for the other and nothing else. Returns markup only — no drawing
// happens here, and none can: the element does not exist yet.
function playerSpriteHtml(player, team, sizePx) {
  if (!player) return '';
  const s = spriteCardScale(sizePx);
  return '<canvas class="player-sprite" width="' + (SPRITE_CARD.w * s) +
    '" height="' + (SPRITE_CARD.h * s) + '"' + spriteCanvasAttrs(player, team, s) + '></canvas>';
}

// Paints one placeholder. Idempotent — a canvas already painted is skipped, so
// a second sweep over the same subtree costs a marker check and nothing else.
function paintPlayerSprite(canvas) {
  if (!canvas || canvas.dataset.spritePainted === '1') return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const s = Math.max(1, parseInt(canvas.dataset.scale, 10) || 1);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(s, s);
  drawPlayerSprite(ctx, SPRITE_CARD.w / 2, SPRITE_CARD.footY, {
    jersey: canvas.dataset.jersey, trim: canvas.dataset.trim,
    skin: canvas.dataset.skin, hair: canvas.dataset.hair
  }, canvas.dataset.n === '' ? null : canvas.dataset.n,
    { heightIn: canvas.dataset.h === '' ? null : Number(canvas.dataset.h), idleFrame: 0 });
  ctx.restore();
  canvas.dataset.spritePainted = '1';
  return true;
}

function paintPlayerSprites(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || !scope.querySelectorAll) return 0;
  let n = 0;
  scope.querySelectorAll('canvas.player-sprite[data-sprite="1"]').forEach(function (c) {
    if (paintPlayerSprite(c)) n += 1;
  });
  return n;
}

// Nothing has to remember to call the paint. Every view in this app builds a
// string and assigns innerHTML, and a rule that says "and afterwards call
// paintPlayerSprites" is a rule somebody eventually forgets — the failure
// being a silently blank box, which looks like a bug in the sprite rather
// than a missing call. The observer watches for placeholders appearing and
// fills them in, so a view only has to emit the markup.
//
// MutationObserver callbacks run as microtasks, before the browser paints, so
// there is no flash of an empty box.
function startPlayerSpriteAutoPaint() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return null;
  const obs = new MutationObserver(function (records) {
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('canvas.player-sprite[data-sprite="1"]')) paintPlayerSprite(node);
        else if (node.querySelectorAll) paintPlayerSprites(node);
      }
    }
  });
  obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  paintPlayerSprites(document);   // anything already on the page
  return obs;
}

if (typeof document !== 'undefined') startPlayerSpriteAutoPaint();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPRITE_CARD: SPRITE_CARD,
    SPRITE_CARD_NO_TEAM: SPRITE_CARD_NO_TEAM,
    spriteCardScale: spriteCardScale,
    safeSpriteColor: safeSpriteColor,
    playerSpriteHtml: playerSpriteHtml,
    paintPlayerSprite: paintPlayerSprite,
    paintPlayerSprites: paintPlayerSprites,
    startPlayerSpriteAutoPaint: startPlayerSpriteAutoPaint,
    DIGIT_FONT: DIGIT_FONT,
    LETTER_FONT: LETTER_FONT,
    spriteColorsForPlayer: spriteColorsForPlayer,
    drawPixelNumber: drawPixelNumber,
    drawPixelText: drawPixelText,
    pixelTextWidth: pixelTextWidth,
    SPRITE_HEIGHT: SPRITE_HEIGHT,
    spriteTallness: spriteTallness,
    spriteLegDelta: spriteLegDelta,
    CROUCH_MIN_LEG: CROUCH_MIN_LEG,
    CROUCH_MIN_TORSO: CROUCH_MIN_TORSO,
    crouchSplit: crouchSplit,
    drawPlayerSprite: drawPlayerSprite,
    BALL_SQUASH_MIN: BALL_SQUASH_MIN,
    ballShape: ballShape,
    drawBall: drawBall
  };
}
