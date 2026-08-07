// Procedural player faces, ported from the approach used by facesjs
// (https://github.com/zengm-games/facesjs, the ZenGM project's face library).
// Unlike facesjs's browser build, this renders to a plain SVG markup STRING
// rather than manipulating a live DOM with getBBox() — that fits this
// project's "container.innerHTML = markup" UI pattern and lets face SVGs be
// generated in Node (validation scripts) with no DOM at all. Each feature's
// own position/rotation/scale pivots around its viewBox center (precomputed
// in faceSvgs.js by scripts/build-face-svgs.js) instead of a live bounding
// box — an approximation that's exact for symmetric, well-centered art like
// this curated set.
var _FACES_DATA = (typeof require !== 'undefined')
  ? { svgs: require('./faceSvgs.js'), rng: require('./rng.js') }
  : { svgs: { FACE_SVGS: FACE_SVGS }, rng: { makeRng: makeRng } };

var FACE_COLORS = {
  white: {
    skin: ['#f2d6cb', '#ddb7a0'],
    hair: ['#272421', '#3D2314', '#5A3825', '#CC9966', '#2C1608', '#B55239', '#e9c67b', '#D7BF91']
  },
  asian: {
    skin: ['#fedac7', '#f0c5a3', '#eab687'],
    hair: ['#272421', '#0f0902']
  },
  brown: {
    skin: ['#bb876f', '#aa816f', '#a67358'],
    hair: ['#272421', '#1c1008']
  },
  black: {
    skin: ['#ad6453', '#74453d', '#5c3937'],
    hair: ['#272421']
  }
};

// Rough real-world NBA demographic mix (public reporting puts the league
// around 70%+ Black, ~17% White, remainder Latino/Asian/multiracial) — not
// exact, just a plausible-feeling weighting for a cosmetic feature.
var RACE_WEIGHTS = [
  { race: 'black', weight: 0.71 },
  { race: 'white', weight: 0.17 },
  { race: 'brown', weight: 0.09 },
  { race: 'asian', weight: 0.03 }
];

function pickRace(rng) {
  var r = rng();
  var acc = 0;
  for (var i = 0; i < RACE_WEIGHTS.length; i++) {
    acc += RACE_WEIGHTS[i].weight;
    if (r <= acc) return RACE_WEIGHTS[i].race;
  }
  return RACE_WEIGHTS[RACE_WEIGHTS.length - 1].race;
}

function pickFrom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function pickKey(category, rng) {
  var keys = Object.keys(_FACES_DATA.svgs.FACE_SVGS[category]);
  return pickFrom(keys, rng);
}
function pickKeyExcluding(category, exclude, rng) {
  var keys = Object.keys(_FACES_DATA.svgs.FACE_SVGS[category]).filter(function (k) { return k !== exclude; });
  return pickFrom(keys, rng);
}
function uniform(rng, lo, hi) { return lo + rng() * (hi - lo); }
function round2(v) { return Math.round(v * 100) / 100; }

// Mirrors facesjs's generate() — male-only (NBA rosters), race-based palette,
// no gender branching. `rng` must be a deterministic per-player rng (see
// ensurePlayerFace below) so faces are stable across save/load.
function generateFace(rng, race) {
  race = race || pickRace(rng);
  var palette = FACE_COLORS[race] || FACE_COLORS.black;
  var skinColor = pickFrom(palette.skin, rng);
  var hairColor = pickFrom(palette.hair, rng);

  return {
    race: race,
    fatness: round2(uniform(rng, 0, 1)),
    teamColors: ['#7a1319', '#07364f', '#89bfd3'],
    hairBg: { id: rng() < 0.1 ? pickKey('hairBg', rng) : 'none' },
    body: { id: pickKey('body', rng), color: skinColor, size: round2(uniform(rng, 0.95, 1.05)) },
    jersey: { id: pickKey('jersey', rng) },
    ear: { id: pickKey('ear', rng), size: round2(uniform(rng, 0.5, 1.5)) },
    head: {
      id: pickKey('head', rng),
      shave: 'rgba(0,0,0,' + (rng() < 0.25 ? round2(uniform(rng, 0, 0.2)) : 0) + ')'
    },
    eyeLine: { id: rng() < 0.75 ? pickKey('eyeLine', rng) : 'none' },
    smileLine: { id: rng() < 0.75 ? pickKey('smileLine', rng) : 'none', size: round2(uniform(rng, 0.25, 2.25)) },
    miscLine: { id: rng() < 0.5 ? pickKey('miscLine', rng) : 'none' },
    facialHair: { id: rng() < 0.5 ? pickKey('facialHair', rng) : 'none' },
    eye: { id: pickKey('eye', rng), angle: Math.round(uniform(rng, -10, 15)) },
    eyebrow: { id: pickKey('eyebrow', rng), angle: Math.round(uniform(rng, -15, 20)) },
    hair: { id: pickKey('hair', rng), color: hairColor, flip: rng() < 0.5 },
    mouth: { id: pickKey('mouth', rng), flip: rng() < 0.5 },
    nose: { id: pickKey('nose', rng), flip: rng() < 0.5, size: round2(uniform(rng, 0.5, 1.25)) },
    glasses: { id: rng() < 0.1 ? pickKey('glasses', rng) : 'none' },
    accessories: { id: rng() < 0.2 ? pickKey('accessories', rng) : 'none' }
  };
}

// [name, positions|null (null = already full 400x600 canvas art), hasAngle, hasFlip, hasSize, scaleFatness, isBodyLike]
var FEATURE_LAYOUT = [
  { name: 'hairBg', positions: null, scaleFatness: true },
  { name: 'body', positions: null, isBodyLike: true },
  { name: 'jersey', positions: null, isBodyLike: true },
  { name: 'ear', positions: [[55, 325], [345, 325]] },
  { name: 'head', positions: null, scaleFatness: true },
  { name: 'eyeLine', positions: null },
  { name: 'smileLine', positions: [[150, 435], [250, 435]], hasSize: true },
  { name: 'miscLine', positions: null },
  { name: 'facialHair', positions: null, scaleFatness: true },
  { name: 'eye', positions: [[140, 310], [260, 310]], hasAngle: true },
  { name: 'eyebrow', positions: [[140, 270], [260, 270]], hasAngle: true },
  { name: 'mouth', positions: [[200, 440]], hasFlip: true },
  { name: 'nose', positions: [[200, 370]], hasFlip: true, hasSize: true },
  { name: 'hair', positions: null, scaleFatness: true },
  { name: 'glasses', positions: null, scaleFatness: true },
  { name: 'accessories', positions: null, scaleFatness: true }
];

var FATNESS_ANCHOR = [200, 300];
var BODY_ANCHOR = [200, 560];

function fatScale(fatness) { return 0.8 + 0.2 * fatness; }

function substituteTokens(svg, face) {
  svg = svg.replace('$[faceShave]', face.head.shave).replace('$[headShave]', face.head.shave);
  svg = svg.replace(/\$\[skinColor\]/g, face.body.color);
  svg = svg.replace(/\$\[hairColor\]/g, face.hair.color);
  svg = svg.replace(/\$\[primary\]/g, face.teamColors[0]);
  svg = svg.replace(/\$\[secondary\]/g, face.teamColors[1]);
  svg = svg.replace(/\$\[accent\]/g, face.teamColors[2]);
  return svg;
}

// Wraps `inner` in a <g> that scales it by (sx,sy) around the point (cx,cy) —
// the same translate-compensation algebra facesjs's scaleCentered() uses,
// just computed from a known center instead of a live getBBox().
function scaleAround(inner, sx, sy, cx, cy) {
  var tx = round2((cx * (1 - sx)) / sx);
  var ty = round2((cy * (1 - sy)) / sy);
  return '<g transform="scale(' + sx + ' ' + sy + ') translate(' + tx + ' ' + ty + ')">' + inner + '</g>';
}

// Builds the full player face as an SVG markup string (viewBox 0 0 400 600),
// ready to drop into any `container.innerHTML = '<svg...>' + faceSvgMarkup(...)`
// call site. `teamColors` is [primary, secondary, accent] hex strings.
function faceSvgMarkup(face, teamColors) {
  var f = face;
  if (teamColors) f = Object.assign({}, face, { teamColors: teamColors });

  var parts = [];
  FEATURE_LAYOUT.forEach(function (layout) {
    var feature = f[layout.name];
    if (!feature || feature.id === 'none') return;
    var category = _FACES_DATA.svgs.FACE_SVGS[layout.name];
    var entry = category && category[feature.id];
    if (!entry) return;

    var svgContent = substituteTokens(entry[0], f);
    var cx = entry[1], cy = entry[2];

    if (layout.positions === null) {
      // Full-canvas art (already 400x600) — no repositioning, just optional
      // fatness widening or body/jersey horizontal size scale, both pivoted
      // around a fixed anchor point since this art is always canvas-aligned.
      var g = svgContent;
      if (layout.isBodyLike && f.body.size !== undefined && f.body.size !== 1) {
        g = scaleAround(g, f.body.size, 1, BODY_ANCHOR[0], BODY_ANCHOR[1]);
      }
      if (layout.name === 'hair' && f.hair.flip) {
        g = scaleAround(g, -1, 1, FATNESS_ANCHOR[0], FATNESS_ANCHOR[1]);
      }
      if (layout.scaleFatness) {
        g = scaleAround(g, fatScale(f.fatness), 1, FATNESS_ANCHOR[0], FATNESS_ANCHOR[1]);
      }
      parts.push(g);
    } else {
      layout.positions.forEach(function (pos, i) {
        // Paired features (eye, eyebrow, ear, smileLine) always mirror their
        // second instance for left/right symmetry; single-position features
        // (mouth, nose) only flip when the face config explicitly asks for it.
        var flip = layout.positions.length === 2 ? i === 1 : !!feature.flip;
        var angle = layout.hasAngle ? (i === 0 ? 1 : -1) * (feature.angle || 0) : 0;
        var size = layout.hasSize ? (feature.size !== undefined ? feature.size : 1) : 1;

        var sx = flip ? -size : size;
        var sy = size;
        var g = '<g transform="translate(' + (-cx) + ' ' + (-cy) + ')">' + svgContent + '</g>';
        if (sx !== 1 || sy !== 1) g = '<g transform="scale(' + sx + ' ' + sy + ')">' + g + '</g>';
        if (angle) g = '<g transform="rotate(' + angle + ')">' + g + '</g>';
        g = '<g transform="translate(' + pos[0] + ' ' + pos[1] + ')">' + g + '</g>';
        parts.push(g);
      });
    }
  });

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" preserveAspectRatio="xMinYMin meet">' +
    parts.join('') + '</svg>';
}

// Our team objects only carry primary/secondary colors (teams.js), while
// faceSvgMarkup wants a 3-tuple [primary, secondary, accent] to match
// facesjs's jersey/glasses templates — reuse secondary as the accent.
function teamFaceColors(team) {
  if (!team) return ['#7a1319', '#07364f', '#89bfd3'];
  return [team.colors.primary, team.colors.secondary, team.colors.secondary];
}

// Convenience wrapper: renders a player's face sized to fit a container,
// wrapped so callers can drop it straight into an innerHTML template string.
function playerFaceHtml(player, team, sizePx) {
  var size = sizePx || 80;
  if (!player.face) return '';
  return '<span class="player-face" style="width:' + size + 'px;height:' + Math.round(size * 1.5) + 'px;display:inline-block;">' +
    faceSvgMarkup(player.face, teamFaceColors(team)) + '</span>';
}

function hashFaceSeed(id) {
  var h = 0;
  var s = id + ':face';
  for (var i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// Idempotent, same pattern as traits.js's ensureHiddenPlayerData: backfills
// `p.face` for any player that doesn't have one yet (new players, or saves
// from before faces existed), seeded deterministically from the player id so
// a given player's face never changes across save/load or re-renders.
function ensurePlayerFace(players) {
  players.forEach(function (p) {
    if (p.face) return;
    var faceRng = _FACES_DATA.rng.makeRng(hashFaceSeed(p.id));
    p.face = generateFace(faceRng);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FACE_COLORS: FACE_COLORS,
    generateFace: generateFace,
    faceSvgMarkup: faceSvgMarkup,
    ensurePlayerFace: ensurePlayerFace,
    teamFaceColors: teamFaceColors,
    playerFaceHtml: playerFaceHtml
  };
}
