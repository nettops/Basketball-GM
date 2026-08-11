const assert = require('assert');
const path = require('path');
const sprites = require(path.join(__dirname, '..', 'ui', 'pixelSprites.js'));

function checkSpriteColors() {
  const player = { face: { body: { color: '#bb876f' }, hair: { color: '#272421' } }, jerseyNumber: 7 };
  const team = { colors: { primary: '#007A33', secondary: '#BA9653' } };
  const home = sprites.spriteColorsForPlayer(player, team, true);
  assert.strictEqual(home.skin, '#bb876f');
  assert.strictEqual(home.hair, '#272421');
  assert.strictEqual(home.jersey, '#007A33', 'home wears primary');
  assert.strictEqual(home.trim, '#BA9653');
  const away = sprites.spriteColorsForPlayer(player, team, false);
  assert.strictEqual(away.jersey, '#FFFFFF', 'away wears white');
  assert.strictEqual(away.trim, '#007A33', 'away trim is primary');
  console.log('checkSpriteColors: OK');
}
checkSpriteColors();

function checkSpriteColorsFallback() {
  // Players without a generated face (should not happen, but degrade gracefully).
  const player = { jerseyNumber: 12 };
  const team = { colors: { primary: '#000000', secondary: '#FFFFFF' } };
  const c = sprites.spriteColorsForPlayer(player, team, true);
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.skin), 'fallback skin is a hex color');
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.hair), 'fallback hair is a hex color');
  console.log('checkSpriteColorsFallback: OK');
}
checkSpriteColorsFallback();

function checkDigitFont() {
  for (let d = 0; d <= 9; d++) {
    const glyph = sprites.DIGIT_FONT[String(d)];
    assert.ok(Array.isArray(glyph) && glyph.length === 5, 'digit ' + d + ' is 5 rows');
    glyph.forEach(function (row) { assert.strictEqual(row.length, 3, 'rows are 3 cols'); });
  }
  console.log('checkDigitFont: OK');
}
checkDigitFont();

function checkLetterFont() {
  // The in-canvas scoreboard needs every letter of every team abbreviation
  // plus the clock separator, all on the same 3x5 grid as the digits.
  Object.keys(sprites.LETTER_FONT).forEach(function (ch) {
    const glyph = sprites.LETTER_FONT[ch];
    assert.ok(Array.isArray(glyph) && glyph.length === 5, 'glyph ' + ch + ' is 5 rows');
    glyph.forEach(function (row) {
      assert.strictEqual(row.length, 3, 'glyph ' + ch + ' rows are 3 cols');
      assert.ok(/^[01]{3}$/.test(row), 'glyph ' + ch + ' rows are bitmaps');
    });
  });
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) {
    assert.ok(sprites.LETTER_FONT[ch], 'missing letter ' + ch);
  });
  assert.ok(sprites.LETTER_FONT[':'], 'missing clock separator');
  console.log('checkLetterFont: OK');
}
checkLetterFont();

function checkPixelTextWidth() {
  // Width must match what drawPixelText actually paints, or the scoreboard
  // centering and right-alignment drift.
  assert.strictEqual(sprites.pixelTextWidth('BOS', 1), 11); // 3 glyphs: 3+1+3+1+3
  assert.strictEqual(sprites.pixelTextWidth('88', 2), 14);  // 2 glyphs at scale 2
  console.log('checkPixelTextWidth: OK');
}
checkPixelTextWidth();

function checkEveryPoseDraws() {
  // Every pose branch must actually run. This exists because a refactor moved
  // the leg-bob locals inside one branch while the running-arms branch still
  // read them — a ReferenceError on the single most common pose in the game,
  // and this file passed anyway because it never called drawPlayerSprite.
  // A pose that is never invoked is a pose that is never checked.
  const colors = { skin: '#a', jersey: '#b', trim: '#c', hair: '#d' };
  const poses = [
    { moving: true, frame: 0 }, { moving: true, frame: 1 },
    { shooting: true }, { dunking: true, facing: 1 }, { dunking: true, facing: -1 },
    { highlight: true }, {}
  ];
  poses.forEach(function (opts) {
    let rects = 0;
    const ctx = { fillStyle: '', fillRect: function () { rects += 1; } };
    sprites.drawPlayerSprite(ctx, 50, 50, colors, '23', opts);
    assert.ok(rects > 10, 'pose ' + JSON.stringify(opts) + ' drew only ' + rects + ' rects');
  });
  // The dunk pose must be a DIFFERENT silhouette from the shot, or the leap
  // reads as an ordinary jumper no matter how high the view lifts it.
  function trace(opts) {
    const out = [];
    const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { out.push([x, y, w, h].join(',')); } };
    sprites.drawPlayerSprite(ctx, 50, 50, colors, '23', opts);
    return out.join(' ');
  }
  assert.notStrictEqual(trace({ dunking: true, facing: 1 }), trace({ shooting: true }),
    'dunking pose is identical to shooting pose');
  assert.notStrictEqual(trace({ dunking: true, facing: 1 }), trace({ dunking: true, facing: -1 }),
    'dunk arm does not switch sides with facing');
  console.log('checkEveryPoseDraws: OK');
}
checkEveryPoseDraws();

// Measures the drawn sprite rather than trusting the offsets: collects every
// rect and reports the real silhouette. An assertion that re-derived the
// geometry from the same constants the code uses would pass no matter what the
// sprite looked like.
function silhouette(opts) {
  const rects = [];
  const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { rects.push([x, y, w, h]); } };
  sprites.drawPlayerSprite(ctx, 100, 100, { skin: '#a', hair: '#b', jersey: '#c', trim: '#d' }, 7, opts);
  let minY = Infinity, maxY = -Infinity;
  rects.forEach(function (r) { minY = Math.min(minY, r[1]); maxY = Math.max(maxY, r[1] + r[3]); });
  // the legs are the two skin rects that reach the floor
  const legs = rects.filter(function (r) { return r[1] + r[3] === 100 && r[2] === 2; });
  return { minY: minY, maxY: maxY, height: maxY - minY, legLen: legs.length ? Math.max.apply(null, legs.map(function (r) { return r[3]; })) : 0 };
}

function checkSpriteHeightVariation() {
  // 72" to 91" is the real league range
  const short = sprites.spriteTallness(72), tallest = sprites.spriteTallness(91);
  assert.ok(tallest - short === 8, 'shortest to tallest spans 8px, got ' + (tallest - short));
  assert.ok(short < 0 && tallest > 0, 'the median body sits between them');

  // monotonic: an inch taller is never a shorter sprite
  let prev = -Infinity;
  for (let h = 60; h <= 100; h++) {
    const t = sprites.spriteTallness(h);
    assert.ok(t >= prev, 'height ' + h + '" must not shrink the sprite');
    prev = t;
  }
  // missing data must not throw or distort — plenty of code paths draw a
  // sprite with no player attached (the referee, a leaver mid-substitution)
  assert.strictEqual(sprites.spriteTallness(undefined), 0);
  assert.strictEqual(sprites.spriteTallness(null), 0);

  // The cap does not bind anywhere in the real league: the tallest player is
  // 91", which lands on 5.4 and rounds to the cap value anyway. It exists for
  // the tuning knob above it and for a future outlier, and mutation testing
  // showed that left it completely unexercised — removing it changed nothing
  // any other assertion could see. Tested directly so it is live code.
  assert.strictEqual(sprites.spriteTallness(120), 5, 'an absurd height is capped');
  assert.strictEqual(sprites.spriteTallness(40), -5, 'and so is an absurdly short one');

  // Feet on the floor. Every body grows UPWARD from y, so a seven-footer must
  // not sink through the court and a guard must not hover above it.
  [72, 79, 91].forEach(function (h) {
    const s = silhouette({ heightIn: h });
    assert.strictEqual(s.maxY, 100, h + '" stands on the floor, bottom at ' + s.maxY);
  });
  // and the drawn silhouette really is taller, not just the number
  const sShort = silhouette({ heightIn: 72 }), sTall = silhouette({ heightIn: 91 });
  assert.ok(sTall.height - sShort.height === 8,
    'drawn silhouette differs by 8px, got ' + (sTall.height - sShort.height));

  // THE STUBBY-GUARD GUARD. Legs are 6px on a standard body; taking the whole
  // difference out of them left a 6'0" guard on 3px stumps, reading as stubby
  // rather than as short. The split keeps every leg at 4px or more.
  for (let h = 72; h <= 91; h++) {
    const s = silhouette({ heightIn: h });
    assert.ok(s.legLen >= 4, h + '" must not stand on stumps, legs ' + s.legLen + 'px');
  }
  // ...and the legs must actually carry their share. A floor alone was not
  // enough: mutation testing showed that sending the WHOLE difference into the
  // torso passed every other assertion here, and that sprite is a seven-footer
  // with a guard's legs and an enormous chest.
  assert.ok(sTall.legLen > sShort.legLen + 2,
    'taller men have longer legs, got ' + sShort.legLen + 'px vs ' + sTall.legLen + 'px');
  console.log('checkSpriteHeightVariation: OK (legs ' +
    silhouette({ heightIn: 72 }).legLen + 'px at 6\'0" to ' +
    silhouette({ heightIn: 91 }).legLen + 'px at 7\'7")');
}
checkSpriteHeightVariation();

function checkSpriteCard() {
  // The box must fit the tallest body without clipping. A 7'7" sprite grows
  // 5px above the standard 24.
  const highest = sprites.SPRITE_CARD.footY - 24 - 5;
  assert.ok(highest >= 0, 'tallest body fits in the card, top at ' + highest);
  assert.ok(sprites.SPRITE_CARD.footY <= sprites.SPRITE_CARD.h, 'feet are inside the card');

  // Integer scales only. A fractional scale gives some pixels two screen
  // pixels and their neighbours three, which at this size reads as a broken
  // renderer rather than as pixel art.
  let prev = 0;
  [22, 24, 32, 90, 100].forEach(function (size) {
    const s = sprites.spriteCardScale(size);
    assert.ok(s === Math.floor(s) && s >= 1, 'scale for ' + size + ' is a whole number, got ' + s);
    assert.ok(sprites.SPRITE_CARD.h * s <= size * 1.5,
      'card at ' + size + ' is no taller than the face it replaces');
    assert.ok(s >= prev, 'scale must not shrink as the request grows');
    prev = s;
  });
  console.log('checkSpriteCard: OK (100px request -> scale ' +
    sprites.spriteCardScale(100) + ', ' + (sprites.SPRITE_CARD.w * sprites.spriteCardScale(100)) +
    'x' + (sprites.SPRITE_CARD.h * sprites.spriteCardScale(100)) + 'px)');
}
checkSpriteCard();

const HOSTILE = { id: 9, jerseyNumber: 7, heightIn: 84,
  face: { body: { color: '#c98a5a' }, hair: { color: '#272421' } } };
const TEAM = { id: 'BOS', colors: { primary: '#007A33', secondary: '#BA9653' } };

function checkSpriteMarkupCarriesEverything() {
  // Markup only — no drawing, so this now works with no DOM at all. The old
  // data-URL version could not run in Node and was asserted only to return an
  // empty string, which tested nothing about what a user sees.
  const html = sprites.playerSpriteHtml(HOSTILE, TEAM, 100);
  const s = sprites.spriteCardScale(100);

  assert.ok(/^<canvas /.test(html), 'emits a canvas, got ' + html.slice(0, 40));
  assert.ok(html.indexOf('data:') === -1,
    'NO encoded image — the whole point is that nothing is converted');
  assert.ok(html.indexOf('width="' + (sprites.SPRITE_CARD.w * s) + '"') !== -1, 'carries its pixel width');
  assert.ok(html.indexOf('height="' + (sprites.SPRITE_CARD.h * s) + '"') !== -1, 'carries its pixel height');
  assert.ok(html.indexOf('data-scale="' + s + '"') !== -1, 'carries the scale the paint needs');
  assert.ok(html.indexOf('data-h="84"') !== -1, 'carries the height that makes a big man big');
  assert.ok(html.indexOf('data-n="7"') !== -1, 'carries the jersey number');
  assert.ok(html.indexOf('data-jersey="#007A33"') !== -1, "carries the team's colour");

  // A player with no team and no number must still render, not throw and not
  // emit `undefined` into an attribute. Draft prospects are exactly this.
  const bare = sprites.playerSpriteHtml({ id: 1, jerseyNumber: null, heightIn: null }, null, 32);
  assert.ok(/^<canvas /.test(bare), 'a prospect with no team still emits a canvas');
  assert.ok(bare.indexOf('undefined') === -1, 'no "undefined" leaks into an attribute');
  assert.ok(bare.indexOf('data-n=""') !== -1, 'absent number is empty, not "null"');
  assert.strictEqual(sprites.playerSpriteHtml(null, TEAM, 32), '', 'no player, no markup');
  console.log('checkSpriteMarkupCarriesEverything: OK');
}
checkSpriteMarkupCarriesEverything();

function checkSpriteColorsCannotBreakOutOfTheAttribute() {
  // Colours now travel through an HTML attribute. Custom players can carry
  // author-supplied colour values, so this is exactly where an unescaped one
  // would matter. Pinned to a hex shape rather than escaped, because a colour
  // that is not a colour has no business being drawn either.
  const attacks = ['" onload="alert(1)', "'><script>bad()</script>", 'red; }', '#fff"', 'javascript:x', ''];
  attacks.forEach(function (bad) {
    assert.strictEqual(sprites.safeSpriteColor(bad, '#123456'), '#123456',
      'rejects ' + JSON.stringify(bad));
  });
  ['#fff', '#007A33', '#12345678'].forEach(function (good) {
    assert.strictEqual(sprites.safeSpriteColor(good, '#000'), good, 'keeps ' + good);
  });

  const evil = { id: 2, jerseyNumber: '7" onerror="x', heightIn: 80,
    face: { body: { color: '" onload="alert(1)' }, hair: { color: '#272421' } } };
  const html = sprites.playerSpriteHtml(evil, { id: 'X', colors: { primary: '"><img src=x>', secondary: '#111' } }, 32);
  assert.ok(html.indexOf('onload') === -1 && html.indexOf('onerror') === -1,
    'no event handler survives into the markup: ' + html);
  assert.ok(html.indexOf('<img') === -1, 'no injected tag survives: ' + html);
  // The whole output must be ONE canvas tag whose attribute region contains no
  // angle brackets at all — a stricter statement than "no <script> survived",
  // and it does not depend on guessing which payload an attacker picks.
  assert.ok(/^<canvas [^<>]*><\/canvas>$/.test(html), 'output is one clean tag: ' + html);
  assert.ok(html.indexOf('data-jersey="#5b6673"') !== -1,
    'a colour that is not a colour falls back rather than reaching the DOM');
  assert.ok(html.indexOf('data-n="7"') !== -1, 'a jersey number is stripped to digits');
  console.log('checkSpriteColorsCannotBreakOutOfTheAttribute: OK');
}
checkSpriteColorsCannotBreakOutOfTheAttribute();

function checkPaintDegradesWithoutADom() {
  // ui/pixelSprites.js is required by six validators that have no DOM.
  assert.strictEqual(sprites.paintPlayerSprites(null), 0, 'no document, nothing painted, no throw');
  assert.strictEqual(sprites.paintPlayerSprite(null), false, 'no element, nothing painted');
  assert.strictEqual(sprites.startPlayerSpriteAutoPaint(), null, 'no observer without a DOM');
  console.log('checkPaintDegradesWithoutADom: OK');
}
checkPaintDegradesWithoutADom();

console.log('All pixel sprite validations passed');
