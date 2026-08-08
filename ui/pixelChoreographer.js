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

// Which plays earn the comic-panel treatment (see ui/pixelImpact.js).
//
// Calibrated by target rate against the whole league, NOT by reading rating
// numbers — see the DUNK_LIFT_THRESHOLD comment above for why that fails here.
//
// Measured 2026-08-07 over 240 games across all 30 teams: poster fires
// 2.00/game and ankle 1.38/game, a tier-1 total of 3.38 against ~3.94 blocks.
// The two numbers differ because the rating spread for leaping finishers is
// wider than for handles — at a shared cutoff of 20, posters fire 3.67/game
// against ankle's 1.70, so one threshold for both would misfire on one of them.
//
// checkRateStaysInBand in scripts/validate-impactMoments.js holds these to
// 0.5-4/game so progression cannot silently turn them into confetti.
const IMPACT_THRESHOLDS = { poster: 24, ankle: 21 };

// How badly the finisher beat the man protecting the rim.
function posterEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.vertical * 2 + a.insideScoring) / 3 - d.interiorDefense;
}

// How badly the ball-handler beat the man in front of him.
function handleEdge(shooter, defender) {
  const a = shooter.attributes, d = defender.attributes;
  return (a.ballHandling * 2 + a.acceleration + a.speed) / 4 - d.perimeterDefense;
}

// → 'poster' | 'ankle' | 'block' | null
//
// Zone is what keeps poster and ankle disjoint: inside makes can only ever be
// posters, outside makes only ever ankle breakers. There is no precedence rule
// to get wrong, and validate-impactMoments.js pins that as a property.
function classifyImpact(ev, shooter, defender) {
  if (!ev) return null;
  if (ev.type === 'block') return 'block';
  if (ev.type !== 'shot' || !ev.made) return null;
  // A shot whose shooter or defender could not be resolved is not a highlight.
  if (!shooter || !shooter.attributes || !defender || !defender.attributes) return null;

  if (ev.zone === 'inside') {
    if (!isDunker(shooter)) return null;
    return posterEdge(shooter, defender) >= IMPACT_THRESHOLDS.poster ? 'poster' : null;
  }
  if (ev.zone === 'mid' || ev.zone === 'three') {
    return handleEdge(shooter, defender) >= IMPACT_THRESHOLDS.ankle ? 'ankle' : null;
  }
  return null;
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

// Groups a flat event log into per-possession slices. A `possession` event
// opens one; everything until the next `possession` belongs to it.
function groupPossessions(events) {
  const slices = [];
  events.forEach(function (ev) {
    if (ev.type === 'possession') slices.push([ev]);
    else if (slices.length > 0) slices[slices.length - 1].push(ev);
  });
  return slices;
}

// The incremental choreographer. Playback needs to draw a possession while
// the ones after it have not been simulated yet, so every whole-game pass the
// old buildTimeline did has been made per-possession:
//
//   - the clock is now the engine's own instead of 720s divided by a
//     possession count that isn't known until the game ends;
//   - the on-court five is now the engine's own instead of being inferred by
//     sorting the final box score by minutes;
//   - the shot-clock pass only ever needed one possession's bounds, so it
//     runs at the end of each append;
//   - the line score accumulates at period boundaries and is closed by
//     finish().
//
// buildTimeline() below is a loop over this, so a replayed game and a live
// game cannot produce different timelines.
function createChoreographer(session) {
  const teamNames = { home: session.homeName || 'home side', away: session.awayName || 'road side' };
  const abbrs = { home: session.homeAbbr || 'HOME', away: session.awayAbbr || 'AWAY' };

  const nameById = {};
  const playerById = {};
  session.homeRoster.concat(session.awayRoster).forEach(function (p) {
    nameById[p.id] = p.name;
    playerById[p.id] = p;
  });
  function ln(pid) {
    return nameById[pid] ? nameById[pid].split(' ').pop() : 'the big man';
  }
  function teamOfPlayer(id) {
    return session.homeRoster.some(function (p) { return p.id === id; }) ? 'home' : 'away';
  }

  const keyframes = [];
  const snapshots = [];
  const lineScore = [];
  const runPts = {};
  const runFouls = {};
  const score = [0, 0];

  let t = 0;
  let possCounter = -1;
  let prevPoss = null;          // for fast-break detection
  let five = { home: [], away: [] };   // players (not ids) currently on court
  let linePeriod = null;        // period the line score is currently accruing
  let atPeriodStart = [0, 0];
  let finished = false;

  const timeline = {
    keyframes: keyframes,
    durationMs: 0,
    snapshots: snapshots,
    lineScore: lineScore,
    finalStats: { points: runPts, fouls: runFouls }
  };

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

  // `sfx` names the sound this beat should trigger (see ui/pixelAudio.js's
  // synth). Naming it here rather than sniffing the display text keeps the
  // audio honest: a miss and a make are different events even though both
  // end with the ball at the rim.
  function push(dt, pos, ball, period, quarter, clock, text, commentary, sfx, impact) {
    t += dt;
    // Every keyframe goes through the collision pass so sprites never stack;
    // the current ball holder is the protected (immovable) body.
    const resolved = separatePositions(pos, ball.holder);
    keyframes.push({
      t: t, pos: resolved, ball: ball, score: score.slice(),
      period: period, quarter: quarter,
      clock: Math.max(0, Math.round(clock)), text: text || '', commentary: commentary || '',
      sfx: sfx || '',
      // Structured highlight marker, or null. ui/pixelGameView.js reads this
      // field rather than matching on `text` — see classifyImpact above.
      impact: impact || null,
      // index into timeline.snapshots (running leaders / foul trouble) and
      // which possession this beat belongs to, used to derive a shot clock
      snap: snapshots.length - 1,
      possIdx: possCounter
    });
  }

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
  // toward its own half, about to flow in.
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

  // Shot clock for ONE possession: 24 at the inbound, ticking to 0 at the
  // terminal beat. Only ever needed this possession's own bounds, which is
  // why it can run per-append instead of as a whole-game post-pass.
  function applyShotClock(fromIndex) {
    const start = keyframes[fromIndex].t;
    const end = keyframes[keyframes.length - 1].t;
    const span = Math.max(1, end - start);
    for (let i = fromIndex; i < keyframes.length; i++) {
      keyframes[i].shotClock = Math.max(0, Math.round(24 - 24 * ((keyframes[i].t - start) / span)));
    }
  }

  function appendEvents(events) {
    if (finished) throw new Error('appendEvents after finish()');
    const head = events[0];
    if (!head || head.type !== 'possession') return;

    const pi = possCounter + 1;
    possCounter = pi;
    const firstKf = keyframes.length;

    const plays = events.slice(1);
    const period = head.period;
    const quarter = head.quarter;
    const clock = head.clock;

    // Close the previous period's line-score row the moment the period turns
    // over, so a live timeline always has every completed period's row.
    if (linePeriod === null) {
      linePeriod = period;
    } else if (period !== linePeriod) {
      lineScore.push({
        quarter: linePeriod,
        home: score[0] - atPeriodStart[0],
        away: score[1] - atPeriodStart[1]
      });
      atPeriodStart = score.slice();
      linePeriod = period;
    }

    // Real substitutions: the engine's five, not an inference from minutes.
    five = {
      home: head.lineups.home.map(function (id) { return playerById[id]; }).filter(Boolean),
      away: head.lineups.away.map(function (id) { return playerById[id]; }).filter(Boolean)
    };

    // A possession that begins right after the other team lost the ball live
    // — a steal or a defensive board — is a fast break: the defense has NOT
    // had time to set, so the transition beat plays differently.
    let fastBreak = false;
    if (prevPoss && prevPoss.team !== head.team && prevPoss.plays.length > 0) {
      const lastPlay = prevPoss.plays[prevPoss.plays.length - 1];
      fastBreak = (lastPlay.type === 'turnover' && !!lastPlay.defenderId) ||
                  (lastPlay.type === 'rebound' && !lastPlay.offensive);
    }
    prevPoss = { team: head.team, plays: plays };

    const poss = { team: head.team, quarter: quarter, period: period, handlerId: head.playerId, plays: plays, fastBreak: fastBreak };

    const pos = positionsFor(poss.team);
    const handlerPos = pos[poss.handlerId] || formationSpot(poss.team, 'PG', poss.team);
    const transPos = transitionFor(poss.team, poss.fastBreak);
    const transHandler = transPos[poss.handlerId] || handlerPos;

    // Broadcast color on the way up the floor: usually nothing (dead air is
    // realistic), sometimes a bring-up line, periodically the score.
    let transComment = '';
    if (pi % 9 === 4) {
      const mins = Math.floor(clock / 60);
      const secs = Math.round(clock % 60);
      transComment = abbrs.home + ' ' + score[0] + ', ' + abbrs.away + ' ' + score[1] +
        ' — ' + mins + ':' + (secs < 10 ? '0' : '') + secs + ' to go in ' +
        (period <= 4 ? 'Q' + period : 'OT' + (period - 4));
    } else if (pi % 4 === 1) {
      transComment = fillT(COMMENT.bringUp, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }
    if (poss.fastBreak) {
      transComment = transComment || fillT(COMMENT.fastBreak, pi, { h: ln(poss.handlerId), team: teamNames[poss.team] });
    }

    // Beat 1: transition. Half-court: the defense is already set and the
    // offense walks into it. Fast break: the offense is gone and the defense
    // is chasing — and it happens quicker.
    push(poss.fastBreak ? BEAT.fastBreak : BEAT.transition, transPos,
      { x: transHandler[0], y: transHandler[1], holder: poss.handlerId }, period, quarter, clock, '', transComment);
    // Beat 2: the offense flows into its set against the waiting defense.
    push(poss.fastBreak ? BEAT.fastBreak : BEAT.formation, pos,
      { x: handlerPos[0], y: handlerPos[1], holder: poss.handlerId }, period, quarter, clock, '');

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
          push(BEAT.release, cutPos, { x: handlerCut[0], y: handlerCut[1] - 6, holder: null }, period, quarter, clock, '');
          push(BEAT.pass, cutPos, { x: cutPos[stealer][0], y: cutPos[stealer][1], holder: stealer }, period, quarter, clock, 'Steal!',
            fillT(COMMENT.steal, pi + ei, { d: ln(stealer), h: ln(poss.handlerId) }), 'squeak');
        } else {
          push(BEAT.resolve, cutPos, { x: handlerCut[0], y: handlerCut[1], holder: null }, period, quarter, clock, 'Turnover',
            fillT(COMMENT.turnover, pi + ei, { h: ln(poss.handlerId) }));
        }
      } else if (ev.type === 'block') {
        const sp = shotSpot(poss.team, ev.zone, pi + ei);
        const shotPos = cutPositions(pos, ev.playerId, pi + ei);
        if (shotPos[ev.playerId]) shotPos[ev.playerId] = sp;
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shotPos[ev.playerId] ? ev.playerId : null }, period, quarter, clock, '');
        push(BEAT.release, shotPos, { x: sp[0], y: sp[1] - 10, holder: null }, period, quarter, clock, '');
        // swatted sideways, not through the net
        push(BEAT.resolve, shotPos, { x: sp[0] + (poss.team === 'home' ? -16 : 16), y: sp[1] - 4, holder: null }, period, quarter, clock, 'Blocked!',
          fillT(COMMENT.block, pi + ei, { d: ln(ev.defenderId), s: ln(ev.playerId) }), 'block',
          { kind: 'block', at: { x: sp[0], y: sp[1] }, byId: ev.defenderId, onId: ev.playerId });
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
          push(BEAT.release, shotPos, { x: from[0], y: from[1] - 8, holder: null }, period, quarter, clock, '');
          push(BEAT.pass, shotPos, { x: to[0], y: to[1] - 8, holder: chain[c + 1] }, period, quarter, clock, '');
        }
        // windup: shooter gathers, everyone else finishes their cuts
        push(BEAT.windup, shotPos, { x: sp[0], y: sp[1], holder: shooterOn ? ev.playerId : null }, period, quarter, clock, '');
        // inside shots drive to the rim before finishing
        let releasePos = shotPos;
        let relSpot = sp;
        if (ev.zone === 'inside' && shooterOn) {
          const rimSpot = clampToCourt(hoop.x + (poss.team === 'home' ? -8 : 8), hoop.y + cutJitter(pi + ei, 6));
          releasePos = Object.assign({}, shotPos);
          releasePos[ev.playerId] = rimSpot;
          relSpot = rimSpot;
          push(BEAT.drive, releasePos, { x: rimSpot[0], y: rimSpot[1], holder: ev.playerId }, period, quarter, clock, '');
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
        push(BEAT.release, releasePos, { x: relSpot[0], y: relSpot[1] - 12, holder: null }, period, quarter, clock, '');
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
        // Highlight classification. Only made shots qualify; the shooter and
        // the contesting defender both come straight off the event.
        const impactKind = ev.made
          ? classifyImpact(ev, playerById[ev.playerId], playerById[ev.defenderId])
          : null;
        // Posters resolve at the rim, ankle breakers where the shot went up.
        const impactAt = impactKind === 'poster'
          ? { x: hoop.x, y: hoop.y }
          : { x: relSpot[0], y: relSpot[1] };
        const impactMarker = impactKind
          ? { kind: impactKind, at: impactAt, byId: ev.playerId, onId: ev.defenderId }
          : null;
        push(flightBeat(ev.zone), crashPos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          ev.made ? madeLabel : '', shotComment,
          ev.made ? (dunking ? 'dunk' : 'swish') : 'clang',
          impactMarker);
        curPos = crashPos;
        // missed shots rattle off the rim before the board scramble
        if (!ev.made) {
          push(BEAT.bounce, crashPos, { x: hoop.x + (poss.team === 'home' ? -6 : 6), y: hoop.y - 8, holder: null }, period, quarter, clock, '');
        }
      } else if (ev.type === 'rebound') {
        const rp = clampToCourt(hoop.x + (poss.team === 'home' ? -22 : 22), hoop.y + ((pi % 2) ? 18 : -18));
        const rpos = Object.assign({}, curPos);
        if (rpos[ev.playerId]) rpos[ev.playerId] = rp;
        const rebComment = ev.offensive
          ? fillT(COMMENT.oreb, pi + ei, { r: ln(ev.playerId) })
          : (pi % 3 === 0 ? fillT(COMMENT.dreb, pi + ei, { r: ln(ev.playerId) }) : '');
        push(BEAT.resolve, rpos, { x: rp[0], y: rp[1], holder: rpos[ev.playerId] ? ev.playerId : null }, period, quarter, clock,
          ev.offensive ? 'Offensive board' : '', rebComment);
        curPos = rpos;
      } else if (ev.type === 'foul-ft') {
        const ftLine = clampToCourt(hoop.x + (poss.team === 'home' ? -58 : 58), hoop.y);
        const fpos = Object.assign({}, curPos);
        if (fpos[ev.playerId]) fpos[ev.playerId] = ftLine;
        if (ev.team === 'home') score[0] += ev.points; else score[1] += ev.points;
        addFoul(ev.defenderId);
        addPoints(ev.playerId, ev.points);
        push(BEAT.ft, fpos, { x: hoop.x, y: hoop.y, holder: null }, period, quarter, clock,
          'FTs: ' + ev.made + ' of ' + ev.attempts,
          fillT(COMMENT.ft, pi + ei, { s: ln(ev.playerId), made: ev.made, att: ev.attempts }), 'whistle');
        curPos = fpos;
      }
    });

    applyShotClock(firstKf);
    timeline.durationMs = t;
  }

  function finish() {
    if (finished) return timeline;
    finished = true;
    lineScore.push({
      quarter: linePeriod === null ? 1 : linePeriod,
      home: score[0] - atPeriodStart[0],
      away: score[1] - atPeriodStart[1]
    });
    timeline.durationMs = t;
    return timeline;
  }

  return {
    timeline: timeline,
    appendEvents: appendEvents,
    finish: finish
  };
}

// Whole-game entry point, retained for replaying a completed game from its
// stored event log. Implemented as a loop over the incremental API so the two
// paths cannot drift (scripts/validate-pixel-choreographer.js asserts they
// produce identical timelines).
function buildTimeline(session) {
  const choreo = createChoreographer(session);
  groupPossessions(session.events).forEach(function (slice) { choreo.appendEvents(slice); });
  return choreo.finish();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PIXEL_STAGE: PIXEL_STAGE,
    buildTimeline: buildTimeline,
    createChoreographer: createChoreographer,
    groupPossessions: groupPossessions,
    assignSlots: assignSlots,
    IMPACT_THRESHOLDS: IMPACT_THRESHOLDS,
    posterEdge: posterEdge,
    handleEdge: handleEdge,
    classifyImpact: classifyImpact
  };
}
