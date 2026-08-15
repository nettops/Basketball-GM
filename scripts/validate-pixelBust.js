// The dialogue portrait renderer.
//
// The interesting assertion here is checkEmotionChangesOnlyTheBrowAndMouth:
// an expression system that quietly redraws the head as well is not an
// expression system, it is four different people.
const assert = require('assert');
const path = require('path');
const bust = require(path.join(__dirname, '..', 'ui', 'pixelBust.js'));

// A recording stand-in for CanvasRenderingContext2D. The bust renderer only
// ever sets fillStyle and calls fillRect, so this captures the whole drawing.
function fakeCtx() {
  const calls = [];
  return {
    calls: calls,
    fillStyle: '#000000',
    fillRect: function (x, y, w, h) {
      calls.push({ x: x, y: y, w: w, h: h, color: this.fillStyle });
    }
  };
}

const COLORS = { skin: '#bb876f', hair: '#272421', jersey: '#007A33', trim: '#BA9653' };

function checkEveryEmotionHasBrowAndMouth() {
  // A scene naming an emotion with no entry would silently render a blank
  // face — the failure this check exists to make impossible.
  bust.BUST_EMOTIONS.forEach(function (e) {
    assert.ok(Array.isArray(bust.BROW[e]) && bust.BROW[e].length > 0, 'no brow for ' + e);
    assert.ok(Array.isArray(bust.MOUTH[e]) && bust.MOUTH[e].length > 0, 'no mouth for ' + e);
  });
  assert.deepStrictEqual(Object.keys(bust.BROW).sort(), bust.BUST_EMOTIONS.slice().sort(),
    'BROW keys match BUST_EMOTIONS exactly');
  assert.deepStrictEqual(Object.keys(bust.MOUTH).sort(), bust.BUST_EMOTIONS.slice().sort(),
    'MOUTH keys match BUST_EMOTIONS exactly');
  console.log('checkEveryEmotionHasBrowAndMouth: OK');
}
checkEveryEmotionHasBrowAndMouth();

function checkFeatureRectsStayInsideTheGrid() {
  [bust.BROW, bust.MOUTH].forEach(function (table) {
    Object.keys(table).forEach(function (emotion) {
      table[emotion].forEach(function (r) {
        assert.strictEqual(r.length, 4, emotion + ' rect is [x,y,w,h]');
        assert.ok(r[0] >= 0 && r[0] + r[2] <= bust.BUST.w, emotion + ' rect overflows width: ' + r);
        assert.ok(r[1] >= 0 && r[1] + r[3] <= bust.BUST.h, emotion + ' rect overflows height: ' + r);
        assert.ok(r[2] > 0 && r[3] > 0, emotion + ' rect has no area: ' + r);
      });
    });
  });
  console.log('checkFeatureRectsStayInsideTheGrid: OK');
}
checkFeatureRectsStayInsideTheGrid();

function checkScaleIsAlwaysAWholeNumber() {
  // Fractional scaling gives some pixels two screen pixels and their
  // neighbours three, which reads as a rendering bug at this size. Same
  // reasoning as spriteCardScale in ui/pixelSprites.js.
  [0, 1, 39, 40, 41, 80, 120, 121, 500].forEach(function (px) {
    const s = bust.bustScale(px);
    assert.strictEqual(s, Math.floor(s), px + 'px gave a fractional scale ' + s);
    assert.ok(s >= 1, px + 'px gave a scale below 1');
  });
  assert.strictEqual(bust.bustScale(120), 3, '120px tall fits three logical pixels per screen pixel');
  assert.strictEqual(bust.bustScale(40), 1, 'exactly one bust height is scale 1');
  console.log('checkScaleIsAlwaysAWholeNumber: OK');
}
checkScaleIsAlwaysAWholeNumber();

function checkEmotionChangesOnlyTheBrowAndMouth() {
  const drawn = {};
  bust.BUST_EMOTIONS.forEach(function (e) {
    const ctx = fakeCtx();
    bust.drawPixelBust(ctx, COLORS, e, { scale: 1 });
    drawn[e] = ctx.calls;
  });

  // Identity rects — those drawn in skin, hair, jersey or trim — must be
  // byte-identical across emotions. Only the dark feature rects may differ.
  function identityOf(calls) {
    return JSON.stringify(calls.filter(function (c) {
      return c.color === COLORS.skin || c.color === COLORS.hair ||
             c.color === COLORS.jersey || c.color === COLORS.trim;
    }));
  }
  const base = identityOf(drawn.neutral);
  bust.BUST_EMOTIONS.forEach(function (e) {
    assert.strictEqual(identityOf(drawn[e]), base, e + ' changed the identity, not just the expression');
  });

  // And the expressions must actually differ from each other, or the swap is
  // decorative and the whole mechanism is pointless.
  bust.BUST_EMOTIONS.forEach(function (a) {
    bust.BUST_EMOTIONS.forEach(function (b) {
      if (a >= b) return;
      assert.notStrictEqual(JSON.stringify(drawn[a]), JSON.stringify(drawn[b]),
        a + ' and ' + b + ' render identically');
    });
  });
  console.log('checkEmotionChangesOnlyTheBrowAndMouth: OK');
}
checkEmotionChangesOnlyTheBrowAndMouth();

function checkUnknownEmotionFallsBackRatherThanThrowing() {
  const ctx = fakeCtx();
  bust.drawPixelBust(ctx, COLORS, 'ecstatic', { scale: 1 });
  const neutralCtx = fakeCtx();
  bust.drawPixelBust(neutralCtx, COLORS, 'neutral', { scale: 1 });
  assert.deepStrictEqual(ctx.calls, neutralCtx.calls, 'an unknown emotion renders as neutral');

  const undef = fakeCtx();
  bust.drawPixelBust(undef, COLORS, undefined, { scale: 1 });
  assert.deepStrictEqual(undef.calls, neutralCtx.calls, 'a missing emotion renders as neutral');
  console.log('checkUnknownEmotionFallsBackRatherThanThrowing: OK');
}
checkUnknownEmotionFallsBackRatherThanThrowing();

function checkScaleMultipliesEveryRect() {
  const one = fakeCtx();
  const three = fakeCtx();
  bust.drawPixelBust(one, COLORS, 'neutral', { scale: 1 });
  bust.drawPixelBust(three, COLORS, 'neutral', { scale: 3 });
  assert.strictEqual(one.calls.length, three.calls.length, 'same rects at any scale');
  one.calls.forEach(function (c, i) {
    const t = three.calls[i];
    assert.strictEqual(t.x, c.x * 3, 'x scaled');
    assert.strictEqual(t.y, c.y * 3, 'y scaled');
    assert.strictEqual(t.w, c.w * 3, 'w scaled');
    assert.strictEqual(t.h, c.h * 3, 'h scaled');
  });
  console.log('checkScaleMultipliesEveryRect: OK');
}
checkScaleMultipliesEveryRect();

function checkNothingIsDrawnOutsideTheGrid() {
  // The canvas is sized exactly BUST.w x BUST.h times the scale, so anything
  // outside it is silently clipped rather than visibly wrong.
  const ctx = fakeCtx();
  bust.drawPixelBust(ctx, COLORS, 'neutral', { scale: 2 });
  ctx.calls.forEach(function (c) {
    assert.ok(c.x >= 0 && c.x + c.w <= bust.BUST.w * 2, 'rect outside width: ' + JSON.stringify(c));
    assert.ok(c.y >= 0 && c.y + c.h <= bust.BUST.h * 2, 'rect outside height: ' + JSON.stringify(c));
  });
  console.log('checkNothingIsDrawnOutsideTheGrid: OK');
}
checkNothingIsDrawnOutsideTheGrid();

function checkColorsComeFromTheSpriteSystem() {
  // A bust and that player's table sprite must never disagree about who he is.
  const player = { face: { body: { color: '#bb876f' }, hair: { color: '#272421' } }, jerseyNumber: 7 };
  const team = { id: 'BOS', colors: { primary: '#007A33', secondary: '#BA9653' } };
  const c = bust.bustColorsFor(player, team);
  assert.strictEqual(c.skin, '#bb876f');
  assert.strictEqual(c.hair, '#272421');
  assert.strictEqual(c.jersey, '#007A33');

  // A reporter has no team at all.
  const noTeam = bust.bustColorsFor({ face: { body: { color: '#8d5524' }, hair: { color: '#111111' } } }, null);
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(noTeam.jersey), 'a teamless speaker still gets a jersey colour');
  assert.strictEqual(noTeam.skin, '#8d5524', 'a teamless speaker keeps his own skin');

  // And nobody at all must not produce undefined.
  const bare = bust.bustColorsFor({}, null);
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(bare.skin), 'fallback skin is a colour');
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(bare.hair), 'fallback hair is a colour');

  const nothing = bust.bustColorsFor(null, null);
  assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(nothing.skin), 'a null speaker still draws');
  console.log('checkColorsComeFromTheSpriteSystem: OK');
}
checkColorsComeFromTheSpriteSystem();

// --- traits ---------------------------------------------------------------
// Traits exist so several people can share one renderer and still read as
// different men. The load-bearing assertion is the silhouette one: colour
// alone does not distinguish anybody at this size.

function silhouetteOf(traits, emotion) {
  // Which cells get painted at all, ignoring colour. Two men with the same
  // outline are the same man wearing a different suit.
  const grid = {};
  const ctx = {
    fillStyle: '#000',
    fillRect: function (x, y, w, h) {
      for (let px = x; px < x + w; px++) {
        for (let py = y; py < y + h; py++) grid[px + ',' + py] = 1;
      }
    }
  };
  bust.drawPixelBust(ctx, COLORS, emotion || 'neutral', { scale: 1, traits: traits });
  return Object.keys(grid).sort().join('|');
}

function checkTraitTablesAreComplete() {
  Object.keys(bust.HAIR).forEach(function (k) {
    assert.ok(Array.isArray(bust.HAIR[k]), 'hair ' + k + ' is a rect list');
  });
  Object.keys(bust.FACIAL).forEach(function (k) {
    assert.ok(Array.isArray(bust.FACIAL[k]), 'facial ' + k + ' is a rect list');
  });
  Object.keys(bust.BUILD).forEach(function (k) {
    const b = bust.BUILD[k];
    assert.ok(Array.isArray(b.shoulder) && b.shoulder.length === 4, k + ' has a shoulder rect');
    assert.ok(Array.isArray(b.trim) && b.trim.length === 4, k + ' has a trim rect');
    assert.strictEqual(typeof b.jawPad, 'number', k + ' has a jaw pad');
    assert.strictEqual(typeof b.lift, 'number', k + ' has a lift');
  });
  assert.ok(bust.HAIR.bald && bust.HAIR.bald.length === 0, 'bald draws no hair');
  console.log('checkTraitTablesAreComplete: OK');
}
checkTraitTablesAreComplete();

function checkTraitsStayInsideTheGrid() {
  // Every combination, not just the ones the crew happens to use.
  Object.keys(bust.HAIR).forEach(function (hair) {
    Object.keys(bust.BUILD).forEach(function (build) {
      Object.keys(bust.FACIAL).forEach(function (facialHair) {
        [true, false].forEach(function (glasses) {
          const ctx = fakeCtx();
          bust.drawPixelBust(ctx, COLORS, 'neutral', {
            scale: 1, traits: { hair: hair, build: build, facialHair: facialHair, glasses: glasses }
          });
          ctx.calls.forEach(function (c) {
            const label = hair + '/' + build + '/' + facialHair + (glasses ? '/glasses' : '');
            assert.ok(c.x >= 0 && c.x + c.w <= bust.BUST.w, label + ' overflows width: ' + JSON.stringify(c));
            assert.ok(c.y >= 0 && c.y + c.h <= bust.BUST.h, label + ' overflows height: ' + JSON.stringify(c));
            assert.ok(c.w > 0 && c.h > 0, label + ' drew a rect with no area');
          });
        });
      });
    });
  });
  console.log('checkTraitsStayInsideTheGrid: OK');
}
checkTraitsStayInsideTheGrid();

function checkUnknownTraitsFallBack() {
  const weird = silhouetteOf({ hair: 'mohawk', build: 'enormous', facialHair: 'muttonchops' });
  const plain = silhouetteOf({ hair: 'full', build: 'normal', facialHair: 'none' });
  assert.strictEqual(weird, plain, 'unknown trait values fall back to the defaults');
  assert.doesNotThrow(function () { silhouetteOf(undefined); }, 'no traits at all is fine');
  console.log('checkUnknownTraitsFallBack: OK');
}
checkUnknownTraitsFallBack();

function checkBuildChangesTheOutline() {
  const normal = silhouetteOf({ build: 'normal' });
  const broad = silhouetteOf({ build: 'broad' });
  const huge = silhouetteOf({ build: 'huge' });
  assert.notStrictEqual(normal, broad, 'broad differs from normal');
  assert.notStrictEqual(broad, huge, 'huge differs from broad');
  assert.notStrictEqual(normal, huge, 'huge differs from normal');
  console.log('checkBuildChangesTheOutline: OK');
}
checkBuildChangesTheOutline();

function checkLiftMovesTheHeadAndNotTheShoulders() {
  // A bigger man should be TALLER in his seat, not floating off the desk. The
  // shoulder rect is the thing that sits on the desk line, so it must not move.
  Object.keys(bust.BUILD).forEach(function (k) {
    const b = bust.BUILD[k];
    const ctx = fakeCtx();
    bust.drawPixelBust(ctx, COLORS, 'neutral', { scale: 1, traits: { build: k } });
    const shoulder = ctx.calls.filter(function (c) {
      return c.color === COLORS.jersey && c.w === b.shoulder[2] && c.h === b.shoulder[3];
    })[0];
    assert.ok(shoulder, k + ': the shoulder rect was drawn');
    assert.strictEqual(shoulder.y, b.shoulder[1], k + ': the shoulders ignore lift');
  });
  console.log('checkLiftMovesTheHeadAndNotTheShoulders: OK');
}
checkLiftMovesTheHeadAndNotTheShoulders();

function checkEmotionStillOnlyChangesTheFace() {
  // The original guarantee has to survive the traits: swapping an expression
  // must not move a hairline or a shoulder.
  const traits = { hair: 'receding', build: 'broad', facialHair: 'goatee', glasses: true };
  function identityOf(emotion) {
    const ctx = fakeCtx();
    bust.drawPixelBust(ctx, COLORS, emotion, { scale: 1, traits: traits });
    return JSON.stringify(ctx.calls.filter(function (c) {
      return c.color === COLORS.skin || c.color === COLORS.hair ||
             c.color === COLORS.jersey || c.color === COLORS.trim;
    }));
  }
  const base = identityOf('neutral');
  bust.BUST_EMOTIONS.forEach(function (e) {
    assert.strictEqual(identityOf(e), base, e + ' moved something that is not the expression');
  });
  console.log('checkEmotionStillOnlyChangesTheFace: OK');
}
checkEmotionStillOnlyChangesTheFace();

console.log('All pixel bust validations passed');
