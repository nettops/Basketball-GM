// Renders real animations to a frame dump, for the preview page.
//
// This exists so a preview can never disagree with the game. It builds a real
// timeline from a real simulated game and walks it at 60fps through
// ui/pixelMotion.js -- the SAME module the canvas draws with, springs and all.
// Nothing here re-implements any of it.
//
// Run: node scripts/export-animation-frames.js > frames.json
//
// It is deliberately runnable at an older commit too (via git worktree), which
// is how the "before" side of a comparison is produced: the old code renders
// the old animation, rather than anyone describing what it used to look like.

const path = require('path');

const base = path.join(__dirname, '..');
require(path.join(base, 'data.js'));
require(path.join(base, 'rng.js'));
const { TEAMS } = require(path.join(base, 'teams.js'));
require(path.join(base, 'traits.js'));
require(path.join(base, 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(base, 'players-2026.js'));
require(path.join(base, 'traits.js')).ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(base, 'rng.js'));
require(path.join(base, 'simEngine.js'));
require(path.join(base, 'simEngineBoxScore.js'));
require(path.join(base, 'simEnginePossession.js'));
const gameSim = require(path.join(base, 'gameSim.js'));
const league = require(path.join(base, 'league.js'));
const choreo = require(path.join(base, 'ui', 'pixelChoreographer.js'));

// The motion module did not exist before the audit; at an older commit the
// numbers have to come from the view's source instead. Rather than
// re-implementing it (the exact mistake this file exists to prevent), the
// exporter simply refuses, and the caller uses a commit that has it.
let motion;
try {
  motion = require(path.join(base, 'ui', 'pixelMotion.js'));
} catch (e) {
  console.error('ui/pixelMotion.js not present at this commit -- cannot export faithfully.');
  process.exit(2);
}
const HAS_SPRING = typeof motion.stepSpring === 'function';
const HAS_LAUNCH = typeof motion.launchPoint === 'function';
const HAS_ARRIVAL = typeof motion.arrivalPoint === 'function';

const STAGE = choreo.PIXEL_STAGE;
const HOOPS = STAGE.hoops;
const FRAME_MS = 1000 / 60;

function timelineFor(seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed + 9) % TEAMS.length];
  const events = [];
  const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
  return choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster(home.id),
    awayRoster: league.getTeamRoster(away.id),
    boxScore: result.boxScore
  }).keyframes;
}

function shotComingAt(kfs, i) {
  const la = kfs[Math.min(i + 2, kfs.length - 1)];
  if (la.ball.holder !== null) return false;
  const d = Math.min(
    Math.abs(la.ball.x - HOOPS.left.x) + Math.abs(la.ball.y - HOOPS.left.y),
    Math.abs(la.ball.x - HOOPS.right.x) + Math.abs(la.ball.y - HOOPS.right.y));
  return d < 20;
}

// Mirrors the view exactly: the launch comes off the SMOOTHED thrower, and is
// computed once as the flight begins. Anchoring it to the keyframe instead
// puts the spring's lag back as a snap at the release.
function launchAt(kfs, i, smooth) {
  if (!HAS_LAUNCH) return null;
  const prev = i > 0 ? kfs[i - 1] : null;
  if (!prev || prev.ball.holder === null) return null;
  const hand = smooth[prev.ball.holder];
  if (!hand) return null;
  return motion.launchPoint({
    prev: prev, a: kfs[i], hand: hand,
    facing: 1, shotComing: shotComingAt(kfs, i - 1), reduceMotion: false
  });
}

// The arrival needs no freezing -- the catcher is still running, and the ball
// should home in on where he actually is. Recomputed every frame.
function arrivalAt(kfs, i, smooth) {
  if (!HAS_ARRIVAL) return null;
  const b = kfs[i + 1];
  if (!b || b.ball.holder === null) return null;
  const hand = smooth[b.ball.holder];
  if (!hand) return null;
  return motion.arrivalPoint({
    b: b, c: kfs[i + 2] || b, hand: hand,
    facing: 1, shotComing: shotComingAt(kfs, i + 1), reduceMotion: false
  });
}

// Which clip a keyframe range belongs to. One instance of each family is
// enough for a preview; the numbers on the page come from the probe, which
// covers whole games.
function clipKind(kfs, i) {
  const b = kfs[i + 1];
  if (!b) return null;
  if (b.dunk && b.dunk.phase === 'gather') return 'dunk';
  if (b.jump && b.jump.phase === 'gather') return b.jump.three ? 'three' : 'midrange';
  if (b.sfx === 'whistle') return 'freeThrow';
  return null;
}

// A layup is the shot that carries no phase marker at all -- which is exactly
// why it was the last one to get a real gather.
function isLayup(kfs, i) {
  const a = kfs[i], b = kfs[i + 1];
  if (!a || !b) return false;
  if (b.dunk || b.jump) return false;
  if (!(a.ball.holder !== null && b.ball.holder === null)) return false;
  const d = Math.min(
    Math.abs(b.ball.x - HOOPS.left.x) + Math.abs(b.ball.y - HOOPS.left.y),
    Math.abs(b.ball.x - HOOPS.right.x) + Math.abs(b.ball.y - HOOPS.right.y));
  return d < 24;
}

function isPass(kfs, i) {
  const a = kfs[i], b = kfs[i + 1], c = kfs[i + 2];
  if (!a || !b || !c) return false;
  return a.ball.holder !== null && b.ball.holder === null && c.ball.holder !== null &&
    c.ball.holder !== a.ball.holder && !b.dunk && !b.jump;
}

// Render [from, to) of the timeline at 60fps, exactly as the view would.
function renderClip(kfs, from, to) {
  const smooth = {};
  // The dribble clock, advanced exactly as ui/pixelGameView.js advances it.
  let dribbleU = 0;
  const frames = [];
  const ids = {};
  for (let i = from; i < to; i++) Object.keys(kfs[i].pos).forEach(function (p) { ids[p] = 1; });
  const idList = Object.keys(ids);

  // Warm the springs up on the beat before the clip, or every body starts
  // frozen at its target and the first beat looks calmer than it is.
  const warm = Math.max(0, from - 2);

  for (let i = warm; i < to; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (!b) break;
    const span = Math.max(1, b.t - a.t);
    const steps = Math.max(1, Math.round(span / FRAME_MS));
    let launch = null, launchDone = false;
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const holder = a.ball.holder;
      const bodies = [];
      idList.forEach(function (pid) {
        const pa = a.pos[pid], pb = b.pos[pid];
        if (!pa || !pb) return;
        const tx = pa[0] + (pb[0] - pa[0]) * f;
        const ty = pa[1] + (pb[1] - pa[1]) * f;
        let s = smooth[pid];
        if (!s) s = smooth[pid] = { x: tx, y: ty, vx: 0, vy: 0, omega: 15 + (pid.charCodeAt(0) % 5) * 0.9 };
        if (HAS_SPRING) motion.stepSpring(s, tx, ty, FRAME_MS / 1000);
        else { s.x = tx; s.y = ty; }
        bodies.push({ id: pid, x: +s.x.toFixed(2), y: +s.y.toFixed(2) });
      });
      const holderHand = (holder && smooth[holder]) || null;
      dribbleU = motion.stepDribbleClock(dribbleU, FRAME_MS,
        !!(holderHand && Math.hypot(holderHand.vx, holderHand.vy) > 6));
      if (!launchDone) { launch = launchAt(kfs, i, smooth); launchDone = true; }
      const arrival = arrivalAt(kfs, i, smooth);
      const lifts = motion.resolveLifts(a, b, f, false);
      const hand = (holder && smooth[holder]) || null;
      const bp = motion.ballPosition({
        a: a, b: b, f: f, holder: holder, hand: hand, facing: 1,
        lifts: lifts, shotComing: shotComingAt(kfs, i), reduceMotion: false,
        dribbleU: dribbleU, launch: launch, arrival: arrival
      });
      // per-body lift, so the preview draws the leap the game draws
      const liftById = {};
      if (lifts.dunkerId) liftById[lifts.dunkerId] = lifts.dunkerLift;
      if (lifts.jumperId) liftById[lifts.jumperId] = lifts.jumperLift;
      if (!lifts.dunkerId && !lifts.jumperId && holder && b.ball.holder === null && shotComingAt(kfs, i)) {
        liftById[holder] = typeof motion.closeLift === 'function' ? motion.closeLift(f) : 0;
      }
      if (i >= from) {
        frames.push({
          t: Math.round(a.t + span * f),
          ball: { x: +bp.bx.toFixed(2), y: +bp.by.toFixed(2), g: +bp.groundY.toFixed(2) },
          holder: holder, bodies: bodies, lift: liftById,
          beat: b.dunk ? 'dunk.' + b.dunk.phase
              : b.jump ? 'jump.' + b.jump.phase
              : (b.ball.holder === null && a.ball.holder !== null) ? 'release'
              : (b.ball.holder !== null && a.ball.holder === null) ? 'catch' : 'play'
        });
      }
    }
  }
  return frames;
}

const clips = {};
outer:
for (let g = 0; g < 40; g++) {
  const kfs = timelineFor(2000 + g);
  for (let i = 1; i + 4 < kfs.length; i++) {
    const kind = clipKind(kfs, i);
    if (kind && !clips[kind]) clips[kind] = renderClip(kfs, i, Math.min(i + 6, kfs.length - 1));
    if (!clips.layup && isLayup(kfs, i)) clips.layup = renderClip(kfs, Math.max(1, i - 1), Math.min(i + 4, kfs.length - 1));
    if (!clips.pass && isPass(kfs, i)) clips.pass = renderClip(kfs, Math.max(1, i - 1), Math.min(i + 3, kfs.length - 1));
    if (clips.dunk && clips.three && clips.midrange && clips.layup && clips.pass && clips.freeThrow) break outer;
  }
}

process.stdout.write(JSON.stringify({
  stage: { w: STAGE.w, h: STAGE.h, court: STAGE.court, hoops: STAGE.hoops },
  hasSpring: HAS_SPRING, hasLaunch: HAS_LAUNCH, hasArrival: HAS_ARRIVAL,
  clips: clips
}));
