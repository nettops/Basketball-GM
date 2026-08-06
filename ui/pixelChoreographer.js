// Turns a possession-engine event log (see simEnginePossession.js's pushEvent
// and the spec's Event Log Format) into a keyframe timeline the pixel game
// view interpolates between. Pure data-in data-out — no canvas, no GameState —
// so scripts/validate-pixel-choreographer.js can exercise it in Node.

const PIXEL_STAGE = {
  w: 480, h: 270,
  court: { x: 20, y: 64, w: 440, h: 192 },
  hoops: { left: { x: 34, y: 160 }, right: { x: 446, y: 160 } }
};

// Home attacks right, away attacks left, all game — no halftime side switch.
// A watched game is theater; keeping one attack direction per team makes the
// flow readable at a glance and halves the formation math.
function attackingHoop(team) { return team === 'home' ? PIXEL_STAGE.hoops.right : PIXEL_STAGE.hoops.left; }

// Offensive formation offsets from the attacked hoop, keyed by position.
// dx is "toward half court" (sign-flipped for the left hoop); dy from hoop centerline.
const OFFENSE_SPOTS = {
  PG: { dx: 115, dy: 0 },
  SG: { dx: 85, dy: -58 },
  SF: { dx: 85, dy: 58 },
  PF: { dx: 32, dy: -40 },
  C: { dx: 32, dy: 40 }
};
const POSITION_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];

function clampToCourt(x, y) {
  const c = PIXEL_STAGE.court;
  return [
    Math.max(c.x, Math.min(c.x + c.w, Math.round(x))),
    Math.max(c.y, Math.min(c.y + c.h, Math.round(y)))
  ];
}

// Spot on court for the player filling `slotPosition` on `team`, when
// `offenseTeam` has the ball. Defenders sag 14px toward their own hoop.
function formationSpot(team, slotPosition, offenseTeam) {
  const onOffense = team === offenseTeam;
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1; // toward half court from the attacked hoop
  const spot = OFFENSE_SPOTS[slotPosition];
  const x = hoop.x + dir * spot.dx + (onOffense ? 0 : dir * -14);
  const y = hoop.y + spot.dy * (onOffense ? 1 : 0.8);
  return clampToCourt(x, y);
}

// Shot origin by zone, deterministic jitter from a counter so repeated shots
// don't overlap pixel-perfectly.
function shotSpot(offenseTeam, zone, jitterSeed) {
  const hoop = attackingHoop(offenseTeam);
  const dir = offenseTeam === 'home' ? -1 : 1;
  const jitter = ((jitterSeed * 37) % 5) - 2; // -2..2
  const dist = zone === 'three' ? 98 : (zone === 'mid' ? 55 : 14);
  const dy = zone === 'inside' ? jitter * 3 : jitter * 14;
  return clampToCourt(hoop.x + dir * dist, hoop.y + dy);
}

// The engine has no bench/rotation, so the view fields each team's five
// most-used players (by minutes) and swaps a sprite in whenever an event
// names someone not currently shown (swap out the lowest-minutes non-participant).
function startingFive(roster, boxScore) {
  return roster
    .filter(function (p) { return boxScore[p.id]; })
    .slice()
    .sort(function (a, b) { return boxScore[b.id].minutes - boxScore[a.id].minutes; })
    .slice(0, 5);
}

// Sort the current five into PG/SG/SF/PF/C display slots: exact position match
// first, remaining players fill leftover slots in order.
function assignSlots(five) {
  const slots = {};
  const unassigned = five.slice();
  POSITION_ORDER.forEach(function (posName) {
    const idx = unassigned.findIndex(function (p) { return p.position === posName; });
    if (idx !== -1) { slots[posName] = unassigned.splice(idx, 1)[0]; }
  });
  POSITION_ORDER.forEach(function (posName) {
    if (!slots[posName]) slots[posName] = unassigned.shift();
  });
  return slots; // { PG: player, SG: player, ... }
}

function ensureOnCourt(five, roster, boxScore, neededIds) {
  neededIds.forEach(function (pid) {
    if (!pid) return;
    if (five.some(function (p) { return p.id === pid; })) return;
    const sub = roster.find(function (p) { return p.id === pid; });
    if (!sub) return;
    // Swap out the lowest-minutes player not needed this possession.
    let outIdx = -1, outMin = Infinity;
    five.forEach(function (p, i) {
      if (neededIds.indexOf(p.id) !== -1) return;
      const m = boxScore[p.id] ? boxScore[p.id].minutes : 0;
      if (m < outMin) { outMin = m; outIdx = i; }
    });
    if (outIdx !== -1) five[outIdx] = sub;
  });
}

// Beat durations at 1x (ms). One possession pair ≈ 1.4s → a 90-pair game plays
// in roughly 4–5 minutes including free-throw pauses, matching the spec.
const BEAT = { formation: 550, action: 450, resolve: 400, ft: 500 };

function buildTimeline(session) {
  const events = session.events;
  const rosters = { home: session.homeRoster, away: session.awayRoster };
  const boxScore = session.boxScore;
  const five = {
    home: startingFive(session.homeRoster, boxScore),
    away: startingFive(session.awayRoster, boxScore)
  };

  // Group events into possessions: a 'possession' event opens one; terminal
  // events (turnover/block/shot) close it; rebound/foul-ft trail the terminal.
  const possessions = [];
  let current = null;
  events.forEach(function (ev) {
    if (ev.type === 'possession') {
      current = { team: ev.team, quarter: ev.quarter, handlerId: ev.playerId, plays: [] };
      possessions.push(current);
    } else if (ev.type === 'tiebreak') {
      possessions.push({ team: ev.team, quarter: 4, handlerId: ev.playerId, plays: [ev], tiebreak: true });
    } else if (current) {
      current.plays.push(ev);
    }
  });

  // Clock: divide each quarter's 720s evenly across its possessions.
  const perQuarter = {};
  possessions.forEach(function (p) { perQuarter[p.quarter] = (perQuarter[p.quarter] || 0) + 1; });

  const keyframes = [];
  let t = 0;
  const score = [0, 0];
  const quarterSeen = {};

  function positionsFor(offenseTeam) {
    const pos = {};
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        pos[p.id] = formationSpot(side, posName, offenseTeam);
      });
    });
    return pos;
  }

  function push(dt, pos, ball, quarter, clock, text) {
    t += dt;
    keyframes.push({ t: t, pos: pos, ball: ball, score: score.slice(), quarter: quarter, clock: Math.max(0, Math.round(clock)), text: text || '' });
  }

  possessions.forEach(function (poss, pi) {
    quarterSeen[poss.quarter] = (quarterSeen[poss.quarter] || 0) + 1;
    const clock = 720 - (quarterSeen[poss.quarter] / perQuarter[poss.quarter]) * 720;
    const clockStart = 720 - ((quarterSeen[poss.quarter] - 1) / perQuarter[poss.quarter]) * 720;

    if (poss.tiebreak) {
      const ev = poss.plays[0];
      score[ev.team === 'home' ? 0 : 1] += ev.points;
      const pos = positionsFor(ev.team);
      const hoop = attackingHoop(ev.team);
      push(BEAT.resolve, pos, { x: hoop.x, y: hoop.y, holder: null }, 4, 0, 'Late free throw decides it!');
      return;
    }

    const neededIds = [poss.handlerId];
    poss.plays.forEach(function (ev) {
      neededIds.push(ev.playerId);
      if (ev.defenderId) neededIds.push(ev.defenderId);
      if (ev.assistPlayerId) neededIds.push(ev.assistPlayerId);
    });
    ensureOnCourt(five[poss.team], rosters[poss.team], boxScore,
      neededIds.filter(function (id) { return rosters[poss.team].some(function (p) { return p.id === id; }); }));
    const defSide = poss.team === 'home' ? 'away' : 'home';
    ensureOnCourt(five[defSide], rosters[defSide], boxScore,
      neededIds.filter(function (id) { return rosters[defSide].some(function (p) { return p.id === id; }); }));

    const pos = positionsFor(poss.team);
    const handlerPos = pos[poss.handlerId] || formationSpot(poss.team, 'PG', poss.team);

    // Beat 1: formation — everyone at spots, handler has the ball.
    push(BEAT.formation, pos, { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, poss.quarter, clockStart, '');

    const hoop = attackingHoop(poss.team);

    poss.plays.forEach(function (ev, ei) {
      if (ev.type === 'turnover') {
        const stealerPos = ev.defenderId && pos[ev.defenderId] ? pos[ev.defenderId] : [hoop.x, hoop.y];
        push(BEAT.action, pos, { x: stealerPos[0], y: stealerPos[1], holder: ev.defenderId && pos[ev.defenderId] ? ev.defenderId : null }, poss.quarter, clock,
          ev.defenderId ? 'Steal!' : 'Turnover');
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = Object.assign({}, pos);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.action, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, poss.quarter, clock, '');
        push(BEAT.resolve, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, poss.quarter, clock, 'Blocked!');
      } else if (ev.type === 'shot') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = Object.assign({}, pos);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        // pass beat (only when someone else creates the shot)
        if (ev.assistPlayerId || ev.playerId !== poss.handlerId) {
          push(BEAT.action, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, poss.quarter, clock, '');
        }
        if (ev.made) score[ev.team === 'home' ? 0 : 1] += ev.points;
        // ball arcs to the hoop
        push(BEAT.resolve, shotPos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          ev.made ? (ev.points === 3 ? 'Three-pointer!' : 'It\'s good!') : '');
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, pos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        push(BEAT.resolve, rpos, { x: rp[0], y: rp[1], holder: rpos[ev.playerId] ? ev.playerId : null }, poss.quarter, clock,
          ev.offensive ? 'Offensive board' : '');
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, pos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts);
      }
    });
  });

  return { keyframes: keyframes, durationMs: t };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PIXEL_STAGE: PIXEL_STAGE, buildTimeline: buildTimeline, startingFive: startingFive, assignSlots: assignSlots };
}
