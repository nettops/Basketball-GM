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

// Beat durations at 1x (ms). Deliberately unhurried — a possession runs about
// three seconds so half-court sets read as basketball rather than pinball;
// viewers who want tempo have the 2x/4x/8x buttons.
//
// The `release` beat is load-bearing, not cosmetic: the view pins the ball to
// a keyframe's holder for that keyframe's whole span, so without a short
// holder-null keyframe at the moment the ball leaves the hands, a pass or
// shot never flies — it teleports to its destination at the next keyframe.
const BEAT = {
  transition: 700, formation: 650, fastBreak: 420, pass: 340, windup: 300, drive: 500,
  release: 60, flight3: 850, flightMid: 650, flightIn: 420,
  resolve: 600, bounce: 350, ft: 700
};

function flightBeat(zone) {
  return zone === 'three' ? BEAT.flight3 : (zone === 'mid' ? BEAT.flightMid : BEAT.flightIn);
}

// Deterministic per-possession jitter for off-ball cuts — same idea as
// shotSpot's jitter: variety without touching any rng.
function cutJitter(seed, spread) {
  return (((seed * 31) % (2 * spread + 1)) - spread);
}

// Off-ball movement: everyone except the ball handler/shooter drifts to a
// slightly different spot mid-possession (a cut, a relocation, a defensive
// shadow-step), so the floor is never a frozen diorama between events.
function cutPositions(pos, excludeId, seed) {
  const moved = {};
  let i = 0;
  Object.keys(pos).forEach(function (pid) {
    i += 1;
    if (pid === excludeId) { moved[pid] = pos[pid]; return; }
    moved[pid] = clampToCourt(
      pos[pid][0] + cutJitter(seed + i, 10),
      pos[pid][1] + cutJitter(seed + i * 7, 8)
    );
  });
  return moved;
}

// Finishing flavor for made inside shots. Explosive leapers dunk it, ground
// finishers lay it in — same information the sim already has (vertical,
// strength, height), just surfaced on screen.
const DUNK_FINISHES = ['Slams it home!', 'Throws it down!', 'Rises up and JAMS it!'];
const LAYUP_FINISHES = ['Lays it in!', 'Finishes inside!', 'Kisses it off the glass'];

// The threshold is calibrated against the ACTUAL player pool, not a 0-100
// scale: everyone in this league is elite, so an absolute cutoff picked off
// raw rating numbers marked ~95% of them as dunkers (30 dunks to 1 layup in
// a test game). 82 sits near the pool's 65th percentile, so roughly the top
// third of finishers throw it down and the rest lay it in.
const DUNK_LIFT_THRESHOLD = 82;

function dunkLift(player) {
  const a = player.attributes;
  return (a.vertical || 50) * 0.6 + (a.strength || 50) * 0.25 + ((player.heightIn || 78) - 72) * 2;
}

function isDunker(player) {
  if (!player || !player.attributes) return false;
  return dunkLift(player) >= DUNK_LIFT_THRESHOLD;
}

// Broadcast commentary templates. Picked deterministically by possession
// seed — variety without touching any rng. {s}=shooter, {h}=handler,
// {d}=defender, {r}=rebounder, {a}=assister, {team}=team name.
const COMMENT = {
  bringUp: [
    '{h} brings it up the floor',
    '{h} walks it up, surveying the defense',
    '{h} pushes the pace for the {team}',
    '{h} calls the set at the top of the key'
  ],
  threeMake: [
    '{s} drills the three! The bench loves it',
    '{s} lets it fly from deep... BANG!',
    '{s} splashes one from beyond the arc',
    'Kick-out to {s} — knocks down the triple'
  ],
  midMake: [
    '{s} pulls up from the elbow... good!',
    '{s} rises and fires — count it',
    'Smooth midrange jumper from {s}',
    '{s} with the pull-up, right in rhythm'
  ],
  insideMake: [
    '{s} muscles it in at the rim!',
    '{s} finishes strong through contact',
    '{s} with the slick finish inside',
    '{s} throws it DOWN!'
  ],
  miss: [
    "{s}'s shot rims out",
    '{s} misfires — no good',
    "Can't connect — {s} leaves it short",
    "{s}'s look rattles in and out"
  ],
  block: [
    '{d} says NOT TODAY — huge rejection!',
    '{d} swats it away!',
    '{s} gets stuffed by {d} at the summit',
    '{d} with the emphatic block'
  ],
  steal: [
    '{d} picks his pocket! Turnover',
    '{d} jumps the passing lane for the steal',
    'Careless from {h} — {d} takes it away',
    '{d} with the takeaway, going the other way'
  ],
  fastBreak: [
    '{h} pushes it in transition — numbers advantage!',
    'Out on the break, {h} leading it',
    '{h} is off to the races',
    'The {team} get out and run'
  ],
  turnover: [
    '{h} coughs it up',
    '{h} loses the handle — turnover',
    'Sloppy possession — they give it away'
  ],
  oreb: [
    '{r} crashes the glass — second chance!',
    '{r} keeps the possession alive',
    'Offensive board! {r} out-works everybody'
  ],
  dreb: [
    '{r} cleans the glass',
    '{r} boxes out and secures it',
    '{r} ends the possession with the board'
  ],
  ft: [
    '{s} knocks down {made} of {att} at the line',
    '{s} goes {made}-for-{att} from the stripe'
  ]
};

function fillT(arr, seed, vars) {
  let line = arr[((seed % arr.length) + arr.length) % arr.length];
  Object.keys(vars).forEach(function (k) {
    line = line.split('{' + k + '}').join(vars[k]);
  });
  return line;
}

// Minimum center-to-center spacing between sprites (~sprite width) — keeps
// drives and paint scrums from stacking players on the same pixels.
const MIN_PLAYER_DIST = 11;

// Collision pass run on every keyframe: pairs closer than MIN_PLAYER_DIST
// repel each other over a few relaxation iterations. The ball handler (or
// shooter) is immovable so a drive still arrives exactly at the rim — the
// defenders yield around him, which is also what real bodies do.
function separatePositions(pos, protectedId) {
  const out = {};
  const ids = Object.keys(pos);
  ids.forEach(function (pid) { out[pid] = [pos[pid][0], pos[pid][1]]; });
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = out[ids[i]];
        const b = out[ids[j]];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d >= MIN_PLAYER_DIST) continue;
        if (d < 0.01) { dx = ((i + j) % 2) ? 1 : -1; dy = ((i * 3 + j) % 2) ? 1 : -1; d = 1.4; }
        const need = (MIN_PLAYER_DIST - d) / d;
        const aShare = ids[i] === protectedId ? 0 : (ids[j] === protectedId ? 1 : 0.5);
        const bShare = ids[j] === protectedId ? 0 : (ids[i] === protectedId ? 1 : 0.5);
        a[0] -= dx * need * aShare; a[1] -= dy * need * aShare;
        b[0] += dx * need * bShare; b[1] += dy * need * bShare;
      }
    }
  }
  ids.forEach(function (pid) { out[pid] = clampToCourt(out[pid][0], out[pid][1]); });
  return out;
}

// While a shot is in the air nobody stands and watches: players near the
// paint crash hard toward the rim (boxing out / chasing the board), players
// farther out drift in a step. The shooter holds his follow-through.
function crashPositions(pos, shooterId, hoop, seed) {
  const out = {};
  let i = 0;
  Object.keys(pos).forEach(function (pid) {
    i += 1;
    if (pid === shooterId) { out[pid] = pos[pid]; return; }
    const dx = hoop.x - pos[pid][0];
    const dy = hoop.y - pos[pid][1];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = d < 130 ? Math.min(24, d * 0.3) : 8;
    out[pid] = clampToCourt(
      pos[pid][0] + (dx / d) * step + cutJitter(seed + i, 4),
      pos[pid][1] + (dy / d) * step + cutJitter(seed + i * 3, 4)
    );
  });
  return out;
}

function buildTimeline(session) {
  const events = session.events;
  const rosters = { home: session.homeRoster, away: session.awayRoster };
  const boxScore = session.boxScore;
  const five = {
    home: startingFive(session.homeRoster, boxScore),
    away: startingFive(session.awayRoster, boxScore)
  };

  // Broadcast-feed name/team lookups (optional in session — Node validate
  // scripts don't pass them).
  const teamNames = { home: session.homeName || 'home side', away: session.awayName || 'road side' };
  const abbrs = { home: session.homeAbbr || 'HOME', away: session.awayAbbr || 'AWAY' };
  const nameById = {};
  const playerById = {};
  session.homeRoster.concat(session.awayRoster).forEach(function (p) { nameById[p.id] = p.name; playerById[p.id] = p; });
  function ln(pid) {
    return nameById[pid] ? nameById[pid].split(' ').pop() : 'the big man';
  }

  // Group events into possessions: a 'possession' event opens one; terminal
  // events (turnover/block/shot) close it; rebound/foul-ft trail the terminal.
  const possessions = [];
  let current = null;
  events.forEach(function (ev) {
    if (ev.type === 'possession') {
      // A possession that begins right after the other team lost the ball
      // live — a steal or a defensive board — is a fast break: the defense
      // has NOT had time to set, so the transition beat plays differently.
      const prev = possessions[possessions.length - 1];
      let fastBreak = false;
      if (prev && prev.team !== ev.team && prev.plays.length > 0) {
        const lastPlay = prev.plays[prev.plays.length - 1];
        fastBreak = (lastPlay.type === 'turnover' && !!lastPlay.defenderId) ||
                    (lastPlay.type === 'rebound' && !lastPlay.offensive);
      }
      current = { team: ev.team, quarter: ev.quarter, handlerId: ev.playerId, plays: [], fastBreak: fastBreak };
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

  // Possession-start snapshot: the DEFENSE is already back at its formation
  // spots (they hold those same spots through the formation beat, so they
  // read as a set defense waiting), while the offense is still strung out
  // toward its own half, about to flow in. This replaces the old single
  // formation keyframe that slid both entire teams across the floor in one
  // synchronized lerp.
  // On a fast break the roles invert: the OFFENSE is already streaking toward
  // the rim while the DEFENSE is the group scrambling back from the other
  // end, which is what makes a break read as a break rather than a walk-up.
  function transitionFor(offenseTeam, fastBreak) {
    const pos = {};
    const hoop = attackingHoop(offenseTeam);
    const dir = offenseTeam === 'home' ? -1 : 1;
    ['home', 'away'].forEach(function (side) {
      const slots = assignSlots(five[side]);
      POSITION_ORDER.forEach(function (posName) {
        const p = slots[posName];
        const spot = OFFENSE_SPOTS[posName];
        if (side === offenseTeam) {
          // half-court: strung out behind the ball. break: already ahead of it.
          const trail = fastBreak
            ? (posName === 'PG' ? 55 : 20)
            : (posName === 'PG' ? 140 : 95);
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + trail), hoop.y + spot.dy);
        } else if (fastBreak) {
          // scrambling back: still well behind their spots, and only the two
          // quickest are close enough to contest
          const behind = (posName === 'PG' || posName === 'SG') ? 40 : 105;
          pos[p.id] = clampToCourt(hoop.x + dir * (spot.dx + behind), hoop.y + spot.dy * 0.8);
        } else {
          pos[p.id] = formationSpot(side, posName, offenseTeam);
        }
      });
    });
    return pos;
  }

  // `sfx` names the sound this beat should trigger (see ui/pixelGameView.js's
  // synth). Naming it here rather than sniffing the display text keeps the
  // audio honest: a miss and a make are different events even though both
  // end with the ball at the rim.
  function push(dt, pos, ball, quarter, clock, text, commentary, sfx) {
    t += dt;
    // Every keyframe goes through the collision pass so sprites never stack;
    // the current ball holder is the protected (immovable) body.
    const resolved = separatePositions(pos, ball.holder);
    keyframes.push({
      t: t, pos: resolved, ball: ball, score: score.slice(), quarter: quarter,
      clock: Math.max(0, Math.round(clock)), text: text || '', commentary: commentary || '',
      sfx: sfx || '',
      // index into timeline.snapshots (running leaders / foul trouble) and
      // which possession this beat belongs to, used to derive a shot clock
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
  }

  // Running scoring and fouls. Snapshots are pushed only when something
  // changes (roughly 200 times a game) and keyframes point at the current
  // one, so per-keyframe stat data stays cheap.
  const runPts = {};
  const runFouls = {};
  const snapshots = [];
  let possCounter = -1;

  function snapshot() {
    const scorers = Object.keys(runPts)
      .map(function (id) { return { id: id, pts: runPts[id], team: teamOfPlayer(id) }; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 4);
    const trouble = Object.keys(runFouls)
      .filter(function (id) { return runFouls[id] >= 4; })
      .map(function (id) { return { id: id, fouls: runFouls[id] }; })
      .sort(function (a, b) { return b.fouls - a.fouls; });
    snapshots.push({ leaders: scorers, foulTrouble: trouble });
  }

  function teamOfPlayer(id) {
    return session.homeRoster.some(function (p) { return p.id === id; }) ? 'home' : 'away';
  }

  function addPoints(id, n) {
    if (!n) return;
    runPts[id] = (runPts[id] || 0) + n;
    snapshot();
  }

  function addFoul(id) {
    if (!id) return;
    runFouls[id] = (runFouls[id] || 0) + 1;
    if (runFouls[id] >= 4) snapshot();
  }

  snapshot(); // index 0: empty board at tip-off

  possessions.forEach(function (poss, pi) {
    possCounter = pi;
    quarterSeen[poss.quarter] = (quarterSeen[poss.quarter] || 0) + 1;
    const clock = 720 - (quarterSeen[poss.quarter] / perQuarter[poss.quarter]) * 720;
    const clockStart = 720 - ((quarterSeen[poss.quarter] - 1) / perQuarter[poss.quarter]) * 720;

    if (poss.tiebreak) {
      const ev = poss.plays[0];
      score[ev.team === 'home' ? 0 : 1] += ev.points;
      addPoints(ev.playerId, ev.points);
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
    const transPos = transitionFor(poss.team, poss.fastBreak);
    const transHandler = transPos[poss.handlerId] || handlerPos;

    // Broadcast color on the way up the floor: usually nothing (dead air is
    // realistic), sometimes a bring-up line, periodically the score.
    let transComment = '';
    if (pi % 9 === 4) {
      const mins = Math.floor(clockStart / 60);
      const secs = Math.round(clockStart % 60);
      transComment = abbrs.home + ' ' + score[0] + ', ' + abbrs.away + ' ' + score[1] +
        ' — ' + mins + ':' + (secs < 10 ? '0' : '') + secs + ' to go in Q' + poss.quarter;
    } else if (pi % 4 === 1) {
      transComment = fillT(COMMENT.bringUp, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }

    // Beat 1: transition. Half-court: the defense is already set and the
    // offense walks into it. Fast break: the offense is gone and the defense
    // is chasing — and it happens quicker.
    if (poss.fastBreak) {
      transComment = transComment || fillT(COMMENT.fastBreak, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }
    push(poss.fastBreak ? BEAT.fastBreak : BEAT.transition, transPos,
      { x: transHandler[0], y: transHandler[1], holder: poss.handlerId }, poss.quarter, clockStart, '', transComment);
    // Beat 2: the offense flows into its set against the waiting defense.
    push(poss.fastBreak ? BEAT.fastBreak : BEAT.formation, pos, { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, poss.quarter, clockStart, '');

    const hoop = attackingHoop(poss.team);

    // Positions carried between beats within this possession, so a rebound
    // scramble continues from the crashed-glass positions rather than
    // yanking everyone back to their formation spots.
    let curPos = pos;

    poss.plays.forEach(function (ev, ei) {
      if (ev.type === 'turnover') {
        const cutPos = cutPositions(pos, poss.handlerId, pi + ei);
        const handlerCut = cutPos[poss.handlerId] || handlerPos;
        const stealer = ev.defenderId && cutPos[ev.defenderId] ? ev.defenderId : null;
        if (stealer) {
          // pocket picked: ball pops loose, then the stealer collects it
          push(BEAT.release, cutPos, { x: handlerCut[0], y: handlerCut[1] - 6, holder: null }, poss.quarter, clock, '');
          push(BEAT.pass, cutPos, { x: cutPos[stealer][0], y: cutPos[stealer][1], holder: stealer }, poss.quarter, clock, 'Steal!',
            fillT(COMMENT.steal, pi + ei, { d: ln(stealer), h: ln(poss.handlerId) }), 'squeak');
        } else {
          push(BEAT.resolve, cutPos, { x: handlerCut[0], y: handlerCut[1], holder: null }, poss.quarter, clock, 'Turnover',
            fillT(COMMENT.turnover, pi + ei, { h: ln(poss.handlerId) }));
        }
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, poss.quarter, clock, '');
        push(BEAT.release, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, poss.quarter, clock, '');
        // swatted sideways, not through the net
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, poss.quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block');
      } else if (ev.type === 'shot') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        const shooterOn = !!shotPos[ev.playerId];
        // the shot defender closes out to contest — collision keeps him a
        // body's width off the shooter instead of inside him
        if (ev.defenderId && shotPos[ev.defenderId]) {
          const cdx = hoop.x - sp[0];
          const cdy = hoop.y - sp[1];
          const cd = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          shotPos[ev.defenderId] = clampToCourt(sp[0] + (cdx / cd) * 9, sp[1] + (cdy / cd) * 9);
        }
        // Ball movement: swing it around the perimeter before the look. The
        // chain runs handler -> 1-2 teammates -> (recorded assister) ->
        // shooter, so an assisted make's final pass always comes from the
        // player the box score credits.
        const offenseIds = five[poss.team].map(function (p) { return p.id; }).filter(function (id) { return shotPos[id]; });
        const chain = [poss.handlerId];
        const swings = 1 + ((pi + ei) % 2);
        for (let s = 0; s < swings; s++) {
          const cands = offenseIds.filter(function (id) {
            return id !== chain[chain.length - 1] && id !== ev.playerId && id !== ev.assistPlayerId;
          });
          if (cands.length === 0) break;
          chain.push(cands[(pi * 7 + ei * 3 + s * 5) % cands.length]);
        }
        if (ev.assistPlayerId && shotPos[ev.assistPlayerId] && chain[chain.length - 1] !== ev.assistPlayerId) {
          chain.push(ev.assistPlayerId);
        }
        if (shooterOn && chain[chain.length - 1] !== ev.playerId) {
          chain.push(ev.playerId);
        }
        for (let c = 0; c < chain.length - 1; c++) {
          const from = shotPos[chain[c]] || pos[chain[c]] || handlerPos;
          const to = shotPos[chain[c + 1]];
          if (!to) continue;
          push(BEAT.release, shotPos, { x: from[0], y: from[1] - 8, holder: null }, poss.quarter, clock, '');
          push(BEAT.pass, shotPos, { x: to[0], y: to[1] - 8, holder: chain[c + 1] }, poss.quarter, clock, '');
        }
        // windup: shooter gathers, everyone else finishes their cuts
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shooterOn ? ev.playerId : null }, poss.quarter, clock, '');
        // inside shots drive to the rim before finishing
        let releasePos = shotPos;
        let relSpot = sp;
        if (ev.zone === 'inside' && shooterOn) {
          const rimSpot = clampToCourt(hoop.x + (poss.team === 'home' ? -8 : 8), hoop.y + cutJitter(pi + ei, 6));
          releasePos = Object.assign({}, shotPos);
          releasePos[ev.playerId] = rimSpot;
          relSpot = rimSpot;
          push(BEAT.drive, releasePos, { x: rimSpot[0], y: rimSpot[1], holder: ev.playerId }, poss.quarter, clock, '');
        }
        if (ev.made) {
          score[ev.team === 'home' ? 0 : 1] += ev.points;
          addPoints(ev.playerId, ev.points);
        }
        const shooterPlayer = playerById[ev.playerId];
        const dunking = ev.zone === 'inside' && isDunker(shooterPlayer);
        const madeLabel = ev.zone === 'inside'
          ? (dunking
              ? DUNK_FINISHES[(pi + ei) % DUNK_FINISHES.length]
              : LAYUP_FINISHES[(pi + ei) % LAYUP_FINISHES.length])
          : (ev.points === 3 ? 'Three-pointer!' : 'It\'s good!');
        // release: ball leaves the hands...
        push(BEAT.release, releasePos, { x: relSpot[0], y: relSpot[1] - 12, holder: null }, poss.quarter, clock, '');
        // ...and flies to the rim while everyone crashes the glass — the
        // floor keeps moving for the whole flight instead of freezing
        const crashPos = crashPositions(releasePos, ev.playerId, hoop, pi + ei);
        const shotTemplates = ev.zone === 'three' ? COMMENT.threeMake : (ev.zone === 'mid' ? COMMENT.midMake : COMMENT.insideMake);
        let shotComment = ev.made
          ? fillT(shotTemplates, pi + ei, { s: ln(ev.playerId) })
          : fillT(COMMENT.miss, pi + ei, { s: ln(ev.playerId) });
        if (ev.made && ev.assistPlayerId && (pi + ei) % 2 === 0) {
          shotComment += ' (' + ln(ev.assistPlayerId) + ' with the dime)';
        }
        push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          ev.made ? madeLabel : '', shotComment,
          ev.made ? (dunking ? 'dunk' : 'swish') : 'clang');
        curPos = crashPos;
        // missed shots rattle off the rim before the board scramble
        if (!ev.made) {
          push(BEAT.bounce, crashPos, { x: hoop.x + (poss.team === 'home' ? -6 : 6), y: hoop.y - 8, holder: null }, poss.quarter, clock, '');
        }
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, curPos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        const rebComment = ev.offensive
          ? fillT(COMMENT.oreb, pi + ei, { r: ln(ev.playerId) })
          : (pi % 3 === 0 ? fillT(COMMENT.dreb, pi + ei, { r: ln(ev.playerId) }) : '');
        push(BEAT.resolve, rpos, { x: rp[0], y: rp[1], holder: rpos[ev.playerId] ? ev.playerId : null }, poss.quarter, clock,
          ev.offensive ? 'Offensive board' : '', rebComment);
        curPos = rpos;
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, curPos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        addFoul(ev.defenderId);
        addPoints(ev.playerId, ev.points);
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, poss.quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts,
          fillT(COMMENT.ft, pi + ei, { s: ln(ev.playerId), made: ev.made, att: ev.attempts }), 'whistle');
        curPos = fpos;
      }
    });
  });

  // Shot clock: the engine has no clock concept, so it's derived from how far
  // each possession has progressed — 24 at the inbound, ticking toward 0 at
  // the shot. Needs the possession's full span, so it's a post-pass.
  const possBounds = {};
  keyframes.forEach(function (kf) {
    const b = possBounds[kf.possIdx];
    if (!b) possBounds[kf.possIdx] = { start: kf.t, end: kf.t };
    else b.end = kf.t;
  });
  keyframes.forEach(function (kf) {
    const b = possBounds[kf.possIdx];
    const span = Math.max(1, b.end - b.start);
    kf.shotClock = Math.max(0, Math.round(24 - 24 * ((kf.t - b.start) / span)));
  });

  // Quarter-by-quarter line score, read off the running score at each break.
  const lineScore = [];
  let prevQuarter = 1;
  let atQuarterStart = [0, 0];
  keyframes.forEach(function (kf) {
    if (kf.quarter !== prevQuarter) {
      lineScore.push({ quarter: prevQuarter, home: kf.score[0] - atQuarterStart[0], away: kf.score[1] - atQuarterStart[1] });
      atQuarterStart = kf.score.slice();
      prevQuarter = kf.quarter;
    }
  });
  const finalScore = keyframes.length ? keyframes[keyframes.length - 1].score : [0, 0];
  lineScore.push({ quarter: prevQuarter, home: finalScore[0] - atQuarterStart[0], away: finalScore[1] - atQuarterStart[1] });

  return {
    keyframes: keyframes,
    durationMs: t,
    snapshots: snapshots,
    lineScore: lineScore,
    finalStats: { points: runPts, fouls: runFouls }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PIXEL_STAGE: PIXEL_STAGE, buildTimeline: buildTimeline, startingFive: startingFive, assignSlots: assignSlots };
}
