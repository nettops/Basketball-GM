// mulberry32 — small, fast, deterministic given a seed. Every caller passes its
// own rng instance explicitly (never reads global randomness), which is what
// keeps schedule/sim/injury functions testable with a fixed seed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRng: makeRng };
}
