// Audits every animation family in the watched game for the three defect
// classes that were found by eye in the dunk.
//
//   A) FLOOR TELEPORT   — bodies covering a lot of ground in a short beat, so
//                         the eye is pulled off the thing the beat is for.
//                         Its mirror image is the FROZEN beat: everyone
//                         standing perfectly still for hundreds of ms.
//   B) BALL JUMP        — the ball's drawn position moving discontinuously
//                         between two consecutive frames. Every one of these
//                         is the ball teleporting on screen.
//   C) GEOMETRY         — the ball not being where the play says it is at the
//                         moment that defines the play.
//
// Run: node scripts/probe-animations.js [games]
//
// The ball is evaluated through ui/pixelMotion.js — the same function the view
// draws with — so this cannot drift from what is on screen.
//
// ONE HONEST CAVEAT on metric B. The view attaches a held ball to the
// SPRING-SMOOTHED body position; this probe attaches it to the keyframe
// position. That isolates the jump contributed by the ball formula itself from
// the body's own motion, which is what we are hunting: on the beats where a
// held ball changes formula the body is standing still anyway (a jump shot
// holds one position for its whole gather/rise/release), so on those the two
// agree exactly.

const path = require('path');
const assert = require('assert');

require(path.join(__dirname, '..', 'data.js'));
require(path.join(__dirname, '..', 'rng.js'));
const { TEAMS } = require(path.join(__dirname, '..', 'teams.js'));
require(path.join(__dirname, '..', 'traits.js'));
require(path.join(__dirname, '..', 'scouting.js'));
const { PLAYERS_2026 } = require(path.join(__dirname, '..', 'players-2026.js'));
const { ensureHiddenPlayerData } = require(path.join(__dirname, '..', 'traits.js'));
ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
require(path.join(__dirname, '..', 'simEngine.js'));
require(path.join(__dirname, '..', 'simEngineBoxScore.js'));
require(path.join(__dirname, '..', 'simEnginePossession.js'));
const gameSim = require(path.join(__dirname, '..', 'gameSim.js'));
const league = require(path.join(__dirname, '..', 'league.js'));
const choreo = require(path.join(__dirname, '..', 'ui', 'pixelChoreographer.js'));
const motion = require(path.join(__dirname, '..', 'ui', 'pixelMotion.js'));

const FRAME_MS = 1000 / 60;

function buildTimeline(seed) {
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

// Which animation family a segment (kf[i] -> kf[i+1]) belongs to. Named off
// the keyframe the segment ENDS at, because a beat's phase marker rides its
// closing keyframe (the choreographer advances the clock, then records).
function nearHoop(pt, bar) {
  const d = Math.min(
    Math.abs(pt.x - HOOPS.left.x) + Math.abs(pt.y - HOOPS.left.y),
    Math.abs(pt.x - HOOPS.right.x) + Math.abs(pt.y - HOOPS.right.y));
  return d < (bar || 20);
}

function familyOf(a, b) {
  if (b.dunk) return 'dunk.' + b.dunk.phase;
  if (b.jump) return 'jump' + (b.jump.three ? '3' : 'M') + '.' + b.jump.phase;
  if (b.cross) return 'cross.' + b.cross.phase;
  // The layup, which had no phases to bucket by until it was given the same
  // gather/rise/release/land the other two finishes have. Checked BEFORE the
  // holder-transition rules below so its release lands in close.release rather
  // than being swept into the generic shotRelease bucket with free throws.
  if (b.close) return 'close.' + b.close.phase;
  if (a.dunk && a.dunk.phase === 'land') return 'dunk.after';
  if (a.jump && a.jump.phase === 'follow') return 'jump.after';
  if (a.close && a.close.phase === 'land') return 'close.after';
  if (b.sfx === 'whistle') return 'freeThrow';
  if (b.ball.holder === null && a.ball.holder !== null) {
    // A shot leaves for a rim; a pass leaves for a teammate. They are the same
    // branch in the ball code and very different animations, so never merge.
    return nearHoop(b.ball, 24) || b.sfx === 'swish' || b.sfx === 'clang'
      ? 'shotRelease' : 'passRelease';
  }
  if (b.ball.holder !== null && a.ball.holder === null) {
    return nearHoop(a.ball, 24) ? 'rebound' : 'catch';
  }
  if (b.ball.holder === null && a.ball.holder === null) {
    return (b.sfx === 'swish' || b.sfx === 'clang' || b.sfx === 'dunk') ? 'shotFlight' : 'loose';
  }
  return 'live';
}

// The ball's position on the last frame it was held, for the flight that
// follows. Same call the view makes.
function launchAt(kfs, i) {
  const prev = i > 0 ? kfs[i - 1] : null;
  if (!prev || prev.ball.holder === null) return null;
  const hp = kfs[i].pos[prev.ball.holder];
  if (!hp) return null;
  return motion.launchPoint({
    prev: prev, a: kfs[i],
    hand: { x: hp[0], y: hp[1], vx: 0, vy: 0 },
    facing: 1, shotComing: shotComingAt(kfs, i - 1), reduceMotion: false
  });
}

// Where the ball ends up once a hand closes on it. Same call the view makes.
function arrivalAt(kfs, i) {
  const b = kfs[i + 1];
  if (!b || b.ball.holder === null) return null;
  const hp = b.pos[b.ball.holder];
  if (!hp) return null;
  return motion.arrivalPoint({
    b: b, c: kfs[i + 2] || b,
    hand: { x: hp[0], y: hp[1], vx: 0, vy: 0 },
    facing: 1, shotComing: shotComingAt(kfs, i + 1), reduceMotion: false
  });
}

function stat() { return { n: 0, sum: 0, max: 0, maxAt: null, zero: 0 }; }
function add(s, v, at) {
  s.n++; s.sum += v;
  if (v > s.max) { s.max = v; s.maxAt = at; }
  if (v < 0.001) s.zero++;
}
function mean(s) { return s.n ? s.sum / s.n : 0; }

function lerp(a, b, f) { return a + (b - a) * f; }

function run(games) {
  const floorStats = {};   // family -> px/sec of body motion
  const ballStats = {};    // family -> px per frame of ball motion
  const modeSwitch = {};   // 'from->to' -> jump size at the switch
  const beatMs = {};       // family -> beat duration, so px/frame has context
  const geometry = { dunkBallToRim: stat(), releaseFromHand: stat(), releaseByKind: {},
                     catchIntoHand: stat(), catchByKind: {} };

  for (let g = 0; g < games; g++) {
    const kfs = buildTimeline(1000 + g);
    let prev = null, prevMode = null, prevHolder = null;   // carried across beat boundaries
    // The dribble clock. This probe builds its hands with vx/vy of zero, so the
    // holder never reads as moving and the clock runs at the standing tempo —
    // which is the tempo those still hands stand for.
    let dribbleU = 0;

    for (let i = 0; i + 1 < kfs.length; i++) {
      const a = kfs[i], b = kfs[i + 1];
      const span = Math.max(1, b.t - a.t);
      const fam = familyOf(a, b);

      // ---- A) floor motion, per player, in px PER FRAME over this beat.
      // Per frame rather than per second on purpose: px/sec makes a long
      // transition beat (everyone jogging back, perfectly legible) look worse
      // than a 60ms beat that jerks a body two widths sideways. What the eye
      // registers as teleporting is distance per frame.
      if (!floorStats[fam]) floorStats[fam] = stat();
      const frames = Math.max(1, span / FRAME_MS);
      Object.keys(a.pos).forEach(function (pid) {
        if (!b.pos[pid]) return;
        const dx = b.pos[pid][0] - a.pos[pid][0];
        const dy = b.pos[pid][1] - a.pos[pid][1];
        add(floorStats[fam], Math.sqrt(dx * dx + dy * dy) / frames, null);
      });
      if (!beatMs[fam]) beatMs[fam] = stat();
      add(beatMs[fam], span, null);

      // ---- B) ball motion, frame by frame, through the real formula.
      //
      // `prev` is deliberately carried ACROSS beat boundaries (it lives outside
      // this loop). The first pass reset it at every keyframe, which made the
      // probe structurally blind to exactly the defect it exists to find: the
      // ball snapping as a beat CHANGES is a boundary event, and resetting at
      // the boundary skips the one frame pair that would show it. That reported
      // a clean bill of health for a bug that was there.
      if (!ballStats[fam]) ballStats[fam] = stat();
      const steps = Math.max(2, Math.ceil(span / FRAME_MS));
      for (let k = (i === 0 ? 0 : 1); k <= steps; k++) {
        const f = Math.min(1, k / steps);
        const holder = a.ball.holder;
        const hand = holder && a.pos[holder] && b.pos[holder]
          ? {
              x: lerp(a.pos[holder][0], b.pos[holder][0], f),
              y: lerp(a.pos[holder][1], b.pos[holder][1], f),
              vx: 0, vy: 0
            }
          : null;
        const lifts = motion.resolveLifts(a, b, f, false);
        dribbleU = motion.stepDribbleClock(dribbleU, span / steps, false);
        const bp = motion.ballPosition({
          a: a, b: b, f: f, holder: holder, hand: hand, facing: 1,
          lifts: lifts, shotComing: shotComingAt(kfs, i),
          reduceMotion: false, dribbleU: dribbleU,
          launch: launchAt(kfs, i), arrival: arrivalAt(kfs, i)
        });
        if (prev) {
          const d = Math.hypot(bp.bx - prev.bx, bp.by - prev.by);
          add(ballStats[fam], d, fam);
          // A formula change only counts as a DEFECT if the ball stayed with
          // the same player. When the holder changes -- a catch, a steal, a
          // rebound -- the ball is supposed to move: it is on a different body
          // now. Counting those was inflating every bucket with correct
          // behaviour and hiding the real jumps underneath it.
          if (prevMode !== bp.mode && prevHolder === holder) {
            const key = prevMode + '->' + bp.mode;
            if (!modeSwitch[key]) modeSwitch[key] = stat();
            add(modeSwitch[key], d, fam);
          }
        }
        prev = bp; prevMode = bp.mode; prevHolder = holder;
      }

      // ---- C) geometry at the defining moment
      // The dunk apex: ball in the hand should be AT the rim.
      if (b.dunk && b.dunk.phase === 'rise') {
        const lifts = motion.resolveLifts(a, b, 1, false);
        const hp = b.pos[b.dunk.id];
        if (hp && a.ball.holder === b.dunk.id) {
          const bp = motion.ballPosition({
            a: a, b: b, f: 1, holder: a.ball.holder,
            hand: { x: hp[0], y: hp[1], vx: 0, vy: 0 }, facing: 1,
            lifts: lifts, shotComing: true, reduceMotion: false, dribbleU: dribbleU
          });
          add(geometry.dunkBallToRim, Math.hypot(bp.bx - b.ball.x, bp.by - b.ball.y), 'dunk');
        }
      }

      // THE CATCH, which is the release run backwards and had never been
      // measured at all. The ball's last airborne position should be the hand
      // that takes it, or it arrives by jumping the last stretch.
      if (a.ball.holder === null && b.ball.holder !== null) {
        const hp = b.pos[b.ball.holder];
        if (hp) {
          const flying = motion.ballPosition({
            a: a, b: b, f: 0.999, holder: null, hand: null, facing: 1,
            lifts: motion.resolveLifts(a, b, 1, false), shotComing: false,
            reduceMotion: false, dribbleU: dribbleU, launch: launchAt(kfs, i),
            arrival: arrivalAt(kfs, i)
          });
          const c2 = kfs[i + 2];
          if (c2) {
            const caught = motion.ballPosition({
              a: b, b: c2, f: 0, holder: b.ball.holder,
              hand: { x: hp[0], y: hp[1], vx: 0, vy: 0 }, facing: 1,
              lifts: motion.resolveLifts(b, c2, 0, false),
              shotComing: shotComingAt(kfs, i + 1), reduceMotion: false, dribbleU: dribbleU
            });
            const d = Math.hypot(caught.bx - flying.bx, caught.by - flying.by);
            if (!geometry.catchByKind[fam]) geometry.catchByKind[fam] = stat();
            add(geometry.catchByKind[fam], d, fam);
            add(geometry.catchIntoHand, d, fam);
          }
        }
      }

      // The release: the ball's first airborne position should be where the
      // hand just let go of it, not somewhere else.
      if (a.ball.holder !== null && b.ball.holder === null && !(b.dunk && b.dunk.phase === 'slam')) {
        // The hand at the END of the beat, not the start: by the last frame
        // before the ball leaves, the holder has arrived at b's position. (This
        // read a.pos at first, which mixed the old body with the new ball and
        // reported the position jump twice.)
        const hp = b.pos[a.ball.holder] || a.pos[a.ball.holder];
        if (hp) {
          const liftsEnd = motion.resolveLifts(a, b, 1, false);
          const held = motion.ballPosition({
            a: a, b: b, f: 0.999, holder: a.ball.holder,
            hand: { x: hp[0], y: hp[1], vx: 0, vy: 0 }, facing: 1,
            lifts: liftsEnd, shotComing: shotComingAt(kfs, i),
            reduceMotion: false, dribbleU: dribbleU
          });
          // first frame of the NEXT segment, where the ball is a projectile
          const c = kfs[i + 2];
          if (c) {
            const liftsNext = motion.resolveLifts(b, c, 0, false);
            const flown = motion.ballPosition({
              a: b, b: c, f: 0, holder: null, hand: null, facing: 1,
              lifts: liftsNext, shotComing: false, reduceMotion: false, dribbleU: dribbleU,
              launch: launchAt(kfs, i + 1), arrival: arrivalAt(kfs, i + 1)
            });
            if (!geometry.releaseByKind[fam]) geometry.releaseByKind[fam] = stat();
            add(geometry.releaseByKind[fam],
              Math.hypot(flown.bx - held.bx, flown.by - held.by), fam);
            add(geometry.releaseFromHand,
              Math.hypot(flown.bx - held.bx, flown.by - held.by), fam);
          }
        }
      }
    }
  }
  return { floorStats: floorStats, ballStats: ballStats, modeSwitch: modeSwitch,
           geometry: geometry, beatMs: beatMs };
}

// Mirrors the view's look-ahead: is the ball about to be a shot at a rim.
// Same Manhattan distance and same 20px bar as ui/pixelGameView.js.
const HOOPS = choreo.PIXEL_STAGE.hoops;
function shotComingAt(kfs, i) {
  const la = kfs[Math.min(i + 2, kfs.length - 1)];
  if (la.ball.holder !== null) return false;
  const d = Math.min(
    Math.abs(la.ball.x - HOOPS.left.x) + Math.abs(la.ball.y - HOOPS.left.y),
    Math.abs(la.ball.x - HOOPS.right.x) + Math.abs(la.ball.y - HOOPS.right.y));
  return d < 20;
}

function table(title, obj, unit, sortKey, ctx) {
  const rows = Object.keys(obj).map(function (k) {
    const s = obj[k];
    return { k: k, n: s.n, mean: mean(s), max: s.max, frozen: s.n ? s.zero / s.n : 0,
             ms: ctx && ctx[k] ? mean(ctx[k]) : null };
  }).filter(function (r) { return r.n > 0; });
  rows.sort(function (x, y) { return y[sortKey] - x[sortKey]; });
  console.log('\n' + title);
  console.log('  ' + 'family'.padEnd(22) + 'n'.padStart(8) + 'mean'.padStart(10) +
    'max'.padStart(10) + 'still%'.padStart(9) + (ctx ? 'beat ms'.padStart(10) : '') +
    '   ' + unit);
  rows.forEach(function (r) {
    console.log('  ' + r.k.padEnd(22) + String(r.n).padStart(8) +
      r.mean.toFixed(1).padStart(10) + r.max.toFixed(1).padStart(10) +
      (r.frozen * 100).toFixed(0).padStart(9) +
      (ctx ? (r.ms === null ? '-' : r.ms.toFixed(0)).padStart(10) : ''));
  });
  return rows;
}

const games = Number(process.argv[2] || 6);
const R = run(games);
console.log('=== animation audit over ' + games + ' games ===');
table('A) FLOOR MOTION per player-beat (px/frame)', R.floorStats, 'px/frame', 'max', R.beatMs);
table('B) BALL MOTION per frame (px/frame)', R.ballStats, 'px/frame', 'max');
table('B2) BALL JUMP at a formula change (px in one frame)', R.modeSwitch, 'px', 'max');
console.log('\nC) GEOMETRY');
Object.keys(R.geometry).filter(function (k) { return k !== 'releaseByKind' && k !== 'catchByKind'; }).forEach(function (k) {
  const s = R.geometry[k];
  console.log('  ' + k.padEnd(22) + 'n=' + String(s.n).padStart(5) +
    '  mean ' + mean(s).toFixed(1) + 'px  max ' + s.max.toFixed(1) + 'px');
});

table('C2) BALL JUMP AT THE RELEASE, by kind (px)', R.geometry.releaseByKind, 'px', 'mean');

table('C3) BALL JUMP AT THE CATCH, by kind (px)', R.geometry.catchByKind, 'px', 'mean');
