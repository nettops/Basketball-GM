// mulberry32 — small, fast, deterministic given a seed. Every caller passes its
// own rng instance explicitly (never reads global randomness), which is what
// keeps schedule/sim/injury functions testable with a fixed seed.
function makeRng(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Attached to the function object (not a change to the calling convention) so
  // every existing rng() call site is unaffected; save.js is the only caller
  // that knows about these, to capture/restore the exact point in the sequence.
  fn.getState = function () { return a; };
  fn.setState = function (state) { a = state; };
  return fn;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRng: makeRng };
}
