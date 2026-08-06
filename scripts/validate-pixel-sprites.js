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

console.log('All pixel sprite validations passed');
