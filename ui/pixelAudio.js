// Procedural arena audio for the pixel game view: a filtered noise bed for
// the crowd murmur, a bandpass branch that swells on big plays, and one-shot
// synthesized effects. Zero assets, zero dependencies. Math.random here is
// fine: audio is decoration and never touches the game rng.
//
// Split out of ui/pixelGameView.js, which was carrying playback, motion,
// audio, HUD chrome, and rendering in one 982-line file.

// Procedural crowd audio — generated noise, zero assets. One AudioContext
// reused across watch sessions (suspended when the view closes). A filtered
// noise loop is the arena murmur; a bandpass branch of the same noise swells
// with crowd excitement on big plays. Math.random here is fine: audio is
// decoration and never touches the game rng.
let _audio = null;
function ensurePixelAudio() {
  if (_audio) return _audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const actx = new AC();
  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lowpass = actx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 480;
  const bedGain = actx.createGain();
  bedGain.gain.value = 0.05;
  const bandpass = actx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1100;
  bandpass.Q.value = 0.7;
  const swellGain = actx.createGain();
  swellGain.gain.value = 0;
  const master = actx.createGain();
  master.gain.value = 1;
  src.connect(lowpass);
  lowpass.connect(bedGain);
  bedGain.connect(master);
  src.connect(bandpass);
  bandpass.connect(swellGain);
  swellGain.connect(master);
  master.connect(actx.destination);
  src.start();
  _audio = { actx: actx, bedGain: bedGain, swellGain: swellGain, master: master, muted: false };
  return _audio;
}

// One-shot sound effects, synthesized on the shared context — no assets.
// Every voice is a short noise burst or oscillator shaped by a gain
// envelope; nothing is sampled, so this stays zero-dependency.
function sfxNoise(a, dur, type, freq, q, gain) {
  const frames = Math.max(1, Math.floor(a.actx.sampleRate * dur));
  const buf = a.actx.createBuffer(1, frames, a.actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = a.actx.createBufferSource();
  src.buffer = buf;
  const filt = a.actx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = a.actx.createGain();
  const now = a.actx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filt); filt.connect(g); g.connect(a.master);
  src.start(now);
  src.stop(now + dur);
}

function sfxTone(a, freq, dur, type, gain, endFreq) {
  const osc = a.actx.createOscillator();
  const g = a.actx.createGain();
  const now = a.actx.currentTime;
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g); g.connect(a.master);
  osc.start(now);
  osc.stop(now + dur);
}

function playPixelSfx(name) {
  const a = _audio;
  if (!a || a.muted || a.actx.state !== 'running') return;
  switch (name) {
    case 'swish':   sfxNoise(a, 0.16, 'highpass', 2600, 0.7, 0.16); break;
    case 'dunk':    sfxNoise(a, 0.22, 'bandpass', 900, 1.2, 0.22); sfxTone(a, 160, 0.18, 'square', 0.10, 70); break;
    case 'clang':   sfxTone(a, 780, 0.20, 'triangle', 0.13, 520); sfxNoise(a, 0.14, 'bandpass', 1800, 3, 0.10); break;
    case 'block':   sfxNoise(a, 0.13, 'lowpass', 700, 0.9, 0.24); break;
    case 'squeak':  sfxNoise(a, 0.10, 'highpass', 3200, 2.5, 0.09); break;
    case 'whistle': sfxTone(a, 2700, 0.28, 'square', 0.05, 2500); break;
    // A LOB LEAVING THE HAND, and the HANDS CLOSING ON IT at the other end.
    //
    // Passes had no voice at all, which was survivable while the ball simply
    // changed owner between two men standing still — and stopped being so the
    // moment an alley-oop put it in the air for a third of a second with
    // everybody watching it. Two sounds because they are two events: the throw
    // is soft and airy, the catch is a slap and it is the one that has to land
    // on the same frame as the hands.
    case 'lob':      sfxNoise(a, 0.13, 'bandpass', 700, 0.6, 0.05); break;
    case 'catch':    sfxNoise(a, 0.06, 'bandpass', 1500, 1.6, 0.11); break;
    case 'buzzer':  sfxTone(a, 210, 0.75, 'square', 0.10); break;
    // quietest voice by far: it fires several times a second, so it sits
    // under the action rather than competing with it
    case 'dribble': sfxNoise(a, 0.05, 'lowpass', 380, 0.8, 0.06); break;
    // Feet hitting the floor. Fired from the animation frame the descent
    // reports contact on, not from a keyframe, so it lands with the squash
    // rather than at the beat boundary near it. Two weights: a jumper coming
    // down off a pull-up and a dunker coming down off the rim are not the same
    // event, and one voice for both makes the dunk sound weightless.
    case 'land':     sfxNoise(a, 0.09, 'lowpass', 240, 0.9, 0.09); break;
    case 'landHard': sfxNoise(a, 0.15, 'lowpass', 170, 1.0, 0.17); sfxTone(a, 90, 0.12, 'square', 0.07, 55); break;
    // A hand on the iron. Distinct from 'dunk' (the ball going through) and
    // from 'clang' (a miss off the rim) — this is the metal being grabbed, and
    // it fires on the animation frame his hand reaches it rather than at the
    // beat boundary near it.
    case 'rim':      sfxTone(a, 430, 0.13, 'triangle', 0.09, 250); sfxNoise(a, 0.07, 'bandpass', 2400, 4, 0.07); break;
    // The dialogue typewriter. Fires every third character, so it is kept
    // short and quiet for the same reason 'dribble' is — anything longer
    // turns a line of text into a buzz.
    case 'blip':    sfxTone(a, 620, 0.03, 'square', 0.035); break;
  }
}

function pixelAudioExcitement(level) {
  if (!_audio || _audio.muted) return;
  const now = _audio.actx.currentTime;
  _audio.swellGain.gain.setTargetAtTime(level * 0.28, now, 0.08);
  _audio.bedGain.gain.setTargetAtTime(0.05 + level * 0.06, now, 0.15);
}

function suspendPixelAudio() {
  if (_audio && _audio.actx.state === 'running') _audio.actx.suspend();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensurePixelAudio: ensurePixelAudio,
    playPixelSfx: playPixelSfx,
    pixelAudioExcitement: pixelAudioExcitement,
    suspendPixelAudio: suspendPixelAudio
  };
}
