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

console.log('All pixel sprite validations passed');
