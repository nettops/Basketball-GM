// A player's colouring: the skin tone and hair colour his sprite is drawn in.
//
// This file used to be a face RENDERER — a port of the facesjs approach that
// assembled 400x600 SVG portraits out of a bundled library of feature artwork
// (heads, noses, eyebrows, glasses), positioned and scaled around precomputed
// viewBox centres. All of that is gone, and the reason is that the game stopped
// using it: player likenesses are drawn by ui/pixelSprites.js now, and a sprite
// ten pixels across has no room for an eyebrow angle.
//
// What survived is what the sprites actually read, which across the whole
// codebase is exactly two values — `face.body.color` and `face.hair.color`.
// Everything else the old descriptor carried (nineteen feature ids, angles,
// flips, per-feature sizes, a fatness term, a hard-coded team palette) was
// generated on every player and read by nobody: the "computed and thrown away"
// shape this codebase keeps finding. Removing it deletes ~136KB of bundled
// third-party artwork and around 180 lines of renderer that no call site
// reached.
//
// The descriptor keeps its `body`/`hair` object shape rather than flattening to
// two strings, because saved games already hold it that way.
var _FACES_DATA = (typeof require !== 'undefined')
  ? { rng: require('./rng.js') }
  : { rng: { makeRng: makeRng } };

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

// Three rng draws, always in this order: race, then skin, then hair. It used to
// be about forty, which is why draft classes and reporter rosters move with
// this change — the seeded stream downstream of every generateFace call shifts.
// That is a one-time re-roll of cosmetic data, not a behaviour change, but it
// does move both golden fixtures.
//
// `rng` must be a deterministic per-player rng (see ensurePlayerFace) so a
// player's colouring is stable across save and load.
function generateFace(rng, race) {
  race = race || pickRace(rng);
  var palette = FACE_COLORS[race] || FACE_COLORS.black;
  return {
    race: race,
    body: { color: pickFrom(palette.skin, rng) },
    hair: { color: pickFrom(palette.hair, rng) }
  };
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
// a given player's colouring never changes across save/load or re-renders.
//
// Old saves keep the fat descriptor they were written with. Nothing reads the
// extra fields, and `body.color`/`hair.color` sit where they always did, so
// those players keep exactly the colouring they already had.
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
    ensurePlayerFace: ensurePlayerFace
  };
}
