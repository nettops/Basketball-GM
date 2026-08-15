// What the NAMED dribble moves actually look like on screen.
//
// scripts/probe-dribbles.js counts how OFTEN each move fires. This one asks a
// different question: when a crossover fires, does anything on screen actually
// cross? The choreographer stamps `handle: { n, move }` on the first beat of
// every dribble string, so the strings are easy to find; what they DRAW is not,
// because the drawn ball comes out of ui/pixelMotion.js and the drawn body out
// of its spring. So this walks the string at 60fps through the same module the
// canvas uses -- nothing here re-implements any of it.
//
// Per move kind it reports:
//   body lat      how far across the floor the handler travels, drawn
//   ball lat      how far the ball gets from his own centre, drawn
//   switches      how many times the ball changes hands during the string
//   reversals     how many times the BODY changes lateral direction
//   kf ball off   how far the choreographer put the ball from the handler in
//                 the keyframe. Expected to be ZERO now and a regression guard
//                 that it stays so: a held ball is drawn at the hand plus the
//                 dribble's own offset and never reads its keyframe, so a
//                 non-zero figure here is a ball path being computed and
//                 thrown away. It read 12.2 for behind-the-back for months.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js');
const gameSim = rq('gameSim.js');
const league = rq('league.js');
const choreo = rq(path.join('ui', 'pixelChoreographer.js'));
const motion = rq(path.join('ui', 'pixelMotion.js'));

const GAMES = Number(process.env.GAMES || 12);
const FRAME_MS = 1000 / 60;

function timelineFor(seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed * 7 + 13) % TEAMS.length];
  if (home.id === away.id) return null;
  const events = [];
  const result = gameSim.simulateGame(home.id, away.id, makeRng(seed), { events: events });
  return choreo.buildTimeline({
    events: events,
    homeRoster: league.getTeamRoster(home.id),
    awayRoster: league.getTeamRoster(away.id),
    boxScore: result.boxScore
  }).keyframes;
}

// The handler's own lateral axis for a string: the direction he actually
// travels across the floor. Measured off the keyframes so it does not depend
// on the spring, then everything drawn is projected onto it.
function lateralAxis(kfs, from, to, id) {
  let dx = 0, dy = 0;
  for (let i = from; i < to && i + 1 < kfs.length; i++) {
    const a = kfs[i].pos[id], b = kfs[i + 1].pos[id];
    if (!a || !b) continue;
    dx += Math.abs(b[0] - a[0]);
    dy += Math.abs(b[1] - a[1]);
  }
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

// Walk [from, to) at 60fps exactly as the view does, and report what the
// handler and the ball did.
function walk(kfs, from, to, id) {
  const smooth = {};
  let dribbleU = 0, move = null;
  const ids = {};
  for (let i = Math.max(0, from - 2); i <= to && i < kfs.length; i++) {
    Object.keys(kfs[i].pos).forEach(function (p) { ids[p] = 1; });
  }
  const idList = Object.keys(ids);
  const ax = lateralAxis(kfs, from, to, id);

  const bodyLat = [], ballLat = [];
  const warm = Math.max(0, from - 2);
  for (let i = warm; i < to && i + 1 < kfs.length; i++) {
    const a = kfs[i], b = kfs[i + 1];
    const span = Math.max(1, b.t - a.t);
    const steps = Math.max(1, Math.round(span / FRAME_MS));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      idList.forEach(function (pid) {
        const pa = a.pos[pid], pb = b.pos[pid];
        if (!pa || !pb) return;
        const tx = pa[0] + (pb[0] - pa[0]) * f;
        const ty = pa[1] + (pb[1] - pa[1]) * f;
        let s = smooth[pid];
        if (!s) s = smooth[pid] = { x: tx, y: ty, vx: 0, vy: 0, omega: 15 + (pid.charCodeAt(0) % 5) * 0.9 };
        motion.stepSpring(s, tx, ty, FRAME_MS / 1000);
      });
      if (i < from) continue;
      const holder = a.ball.holder;
      const hand = (holder && smooth[holder]) || null;
      const mark = a.drib && holder ? a.drib : null;
      if (mark) {
        move = { move: mark.move, n: mark.n, u: mark.i + f };
      } else {
        if (move) dribbleU = motion.dribbleClockAfterMove(dribbleU, move.move, move.n);
        move = null;
        dribbleU = motion.stepDribbleClock(dribbleU, FRAME_MS,
          !!(hand && Math.hypot(hand.vx, hand.vy) > 6));
      }
      if (!hand || holder !== id) continue;
      const bp = motion.ballPosition({
        a: a, b: b, f: f, holder: holder, hand: hand, facing: 1,
        lifts: motion.resolveLifts(a, b, f, false),
        shotComing: false, reduceMotion: false,
        dribbleU: dribbleU, dribbleMove: move, launch: null, arrival: null
      });
      bodyLat.push(hand.x * ax[0] + hand.y * ax[1]);
      // the ball's offset from his OWN centre, along the same axis
      ballLat.push((bp.bx - hand.x) * ax[0] + (bp.groundY - hand.y) * ax[1]);
    }
  }
  return { bodyLat: bodyLat, ballLat: ballLat };
}

// How often the ball snaps sideways in a single frame, over the WHOLE game
// rather than just inside dribble strings. This is the real-game counterpart to
// checkChangingTempoDoesNotRewriteThePast: that one proves the formula is
// continuous, this one proves it stays continuous once a springy body is
// wobbling across the moving/standing threshold ~4000 times a game.
function countTeleports(kfs) {
  const smooth = {};
  let dribbleU = 0, prevSide = null, prevHolder = null, n = 0, biggest = 0, frames = 0;
  for (let i = 0; i + 1 < kfs.length; i++) {
    const a = kfs[i], b = kfs[i + 1];
    const span = Math.max(1, b.t - a.t);
    const steps = Math.max(1, Math.round(span / FRAME_MS));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      Object.keys(a.pos).forEach(function (pid) {
        const pa = a.pos[pid], pb = b.pos[pid];
        if (!pa || !pb) return;
        const tx = pa[0] + (pb[0] - pa[0]) * f, ty = pa[1] + (pb[1] - pa[1]) * f;
        let s = smooth[pid];
        if (!s) s = smooth[pid] = { x: tx, y: ty, vx: 0, vy: 0, omega: 15 + (pid.charCodeAt(0) % 5) * 0.9 };
        motion.stepSpring(s, tx, ty, FRAME_MS / 1000);
      });
      const h = a.ball.holder, hand = h && smooth[h];
      if (!hand) { prevSide = null; prevHolder = null; continue; }
      dribbleU = motion.stepDribbleClock(dribbleU, FRAME_MS, Math.hypot(hand.vx, hand.vy) > 6);
      const side = motion.dribbleBall(dribbleU).side;
      frames++;
      if (prevHolder === h && prevSide !== null) {
        const j = Math.abs(side - prevSide);
        if (j > 1.5) { n++; if (j > biggest) biggest = j; }
      }
      prevSide = side; prevHolder = h;
    }
  }
  return { n: n, biggest: biggest, frames: frames };
}

function spread(a) { return a.length ? Math.max.apply(null, a) - Math.min.apply(null, a) : 0; }
function maxAbs(a) { return a.length ? Math.max.apply(null, a.map(Math.abs)) : 0; }

// Sign changes with a deadband, so spring wobble is not counted as a move.
function flips(a, dead) {
  let n = 0, sign = 0;
  a.forEach(function (v) {
    const s = v > dead ? 1 : v < -dead ? -1 : 0;
    if (s && s !== sign) { if (sign) n++; sign = s; }
  });
  return n;
}
function reversals(a) {
  const d = [];
  for (let i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]);
  return flips(d, 0.05);
}

const acc = {};
function bucket(m) {
  if (!acc[m]) acc[m] = { n: 0, body: 0, ball: 0, sw: 0, rev: 0, kfOff: 0, kfOffMax: 0 };
  return acc[m];
}

let tele = { n: 0, biggest: 0, frames: 0 }, played = 0;

for (let g = 0; g < GAMES; g++) {
  const kfs = timelineFor(31000 + g);
  if (!kfs) continue;
  played++;
  const t = countTeleports(kfs);
  tele.n += t.n; tele.frames += t.frames;
  tele.biggest = Math.max(tele.biggest, t.biggest);
  for (let i = 0; i < kfs.length; i++) {
    const h = kfs[i].handle;
    if (!h || !h.n) continue;
    const id = kfs[i].ball.holder;
    if (!id) continue;
    // Beats, not dribbles — an ankle breaker counts four of the second and
    // choreographs three of the first.
    const beats = (kfs[i].drib && kfs[i].drib.n) || h.n;
    const to = Math.min(kfs.length - 1, i + beats);
    const w = walk(kfs, i, to, id);
    if (w.bodyLat.length < 4) continue;
    const b = bucket(h.move || 'none');
    b.n++;
    b.body += spread(w.bodyLat);
    b.ball += maxAbs(w.ballLat);
    b.sw += flips(w.ballLat, 1);
    b.rev += reversals(w.bodyLat);
    // What the choreographer ASKED for: how far it put the ball from the
    // handler's own keyframe position.
    let off = 0;
    for (let j = i; j < to; j++) {
      const p = kfs[j].pos[id];
      if (!p || kfs[j].ball.holder !== id) continue;
      off = Math.max(off, Math.hypot(kfs[j].ball.x - p[0], kfs[j].ball.y - p[1]));
    }
    b.kfOff += off;
    b.kfOffMax = Math.max(b.kfOffMax, off);
  }
}

console.log('games ' + GAMES + '   (all figures are means per string, drawn at 60fps)');
console.log('');
console.log('move        n     body lat   ball lat   switches   reversals   kf ball off (max)');
Object.keys(acc).sort(function (a, b) { return acc[b].n - acc[a].n; }).forEach(function (k) {
  const b = acc[k];
  console.log('  ' + k.padEnd(10) +
    String(b.n).padStart(4) +
    (b.body / b.n).toFixed(1).padStart(11) +
    (b.ball / b.n).toFixed(1).padStart(11) +
    (b.sw / b.n).toFixed(2).padStart(11) +
    (b.rev / b.n).toFixed(2).padStart(12) +
    ((b.kfOff / b.n).toFixed(1) + ' (' + b.kfOffMax.toFixed(0) + ')').padStart(19));
});
console.log('');
console.log('ball snapping sideways >1.5px in one frame, whole game: ' +
  (tele.n / played).toFixed(1) + '/game (biggest ' + tele.biggest.toFixed(1) + 'px) over ' +
  Math.round(tele.frames / played) + ' held frames a game');
