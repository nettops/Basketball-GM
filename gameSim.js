// Game-level state machine for the possession engine. simEnginePossession.js
// owns what happens WITHIN a possession; this file owns everything about the
// game around it — score, periods, and (from Task 5 onward) the on-court five,
// the clock, and overtime. Split out once the state machine was proven
// behaviour-identical, so it had room to grow without turning
// simEnginePossession.js into a grab bag.
var _GAMESIM_DATA = (typeof require !== 'undefined')
  ? { poss: require('./simEnginePossession.js'), simEngine: require('./simEngine.js'), composite: require('./compositeRatings.js'), box: require('./simEngineBoxScore.js'), coach: require('./gameCoach.js'), teams: require('./teams.js'), ultimates: require('./ultimates.js') }
  : {
      poss: {
        POSSESSIONS_PER_TEAM: POSSESSIONS_PER_TEAM,
        simulatePossession: simulatePossession,
        eligibleRoster: eligibleRoster,
        initBoxLine: initBoxLine
      },
      ultimates: {
        ultimateFor: ultimateFor, badgeBoostFor: badgeBoostFor,
        chargeGain: chargeGain, situationMultiplier: situationMultiplier,
        chargeThreshold: chargeThreshold, takeoverLength: takeoverLength,
        takeoverRun: takeoverRun, takeoverEffect: takeoverEffect
      },
      simEngine: { registerEngine: registerEngine },
      composite: { computeTeamSynergy: computeTeamSynergy },
      teams: { getTeamById: getTeamById },
      box: { minutesWeight: minutesWeight },
      coach: { decideSubstitutions: decideSubstitutions, decideTimeout: decideTimeout, FOUL_OUT: FOUL_OUT }
    };

const REGULATION_PERIODS = 4;
const PERIOD_SECONDS = 12 * 60;
const OVERTIME_SECONDS = 5 * 60;

// How long a possession takes, which is the knob that sets league scoring.
//
// Was 16s: that gave 180 total possessions — 90 per team — matching the legacy
// POSSESSIONS_PER_TEAM exactly, so switching from a fixed possession count to a
// real clock did not re-scale scoring. It has now been moved deliberately.
//
// 12.5s puts a team at ~114 possessions and ~135 points a game, the middle of
// the 130-140 target. PACE is the right lever for a change this size and shot
// difficulty is the wrong one: measured across 3 seasons at each setting, from
// 16s down to 11s, points ran 105.8 -> 153.0 while points-per-possession never
// left 1.186-1.189 and FG% never left 48.1-48.2. The game just plays faster;
// every shot is exactly as hard as it was. Raising the shot bases instead would
// have had to lift FG% from 48% to about 61% to get here, which would also have
// pushed most shots into the SHOT_MAX 0.72 ceiling and flattened the gap
// between a great shooter and an average one.
//
// Known consequence, accepted: average margin goes 11.7 -> 13.3 points and
// games inside 5 drop from 29.3% to 27.6%, because five points is a smaller
// share of a bigger score.
const POSSESSION_BASE_SECONDS = 12.5;
const POSSESSION_VARIANCE_SECONDS = 5;

const TIMEOUTS_PER_GAME = 7;
const TIMEOUT_ENERGY_RESTORE = 0.12;

function possessionSeconds(rng) {
  const jitter = (rng() * 2 - 1) * POSSESSION_VARIANCE_SECONDS;
  return Math.max(4, POSSESSION_BASE_SECONDS + jitter);
}

// Roughly how many more possessions ONE side gets before the buzzer. Used only
// to decide how long a takeover starting now can run (ultimates.js takeoverRun).
//
// An estimate, deliberately: the real count depends on jitter that has not been
// rolled yet, and reading it exactly would mean drawing from the rng, which
// would move the seeded stream and both golden masters. The jitter is symmetric
// around POSSESSION_BASE_SECONDS and averages out across a run of twenty-odd
// possessions to well under one, so one possession of margin covers it.
//
// Overtime counts only the overtime on the clock — whether there will be
// another one is not knowable, and assuming one would hand out runs the game
// may never deliver.
function possessionsLeftForSide(period, clock) {
  let seconds = clock;
  if (period < REGULATION_PERIODS) seconds += (REGULATION_PERIODS - period) * PERIOD_SECONDS;
  return Math.floor(seconds / POSSESSION_BASE_SECONDS / 2) - 1;
}

// The game-level state machine. step() advances exactly one possession pair
// (home, then away) — the same unit the old for-loop body covered, so RNG
// consumption order is unchanged. simulatePossessionGame below is now just a
// loop over it, which means batch sims and (later) live-stepped watched games
// run through ONE code path and cannot drift apart.
// Which ultimate each qualifying player on a roster holds, and how much a
// matching legendary badge boosts it. Cached per game: deriving an ultimate
// walks twelve percentile tables, and redoing that for ten players on every
// possession would dominate the sim's cost for no benefit — a player's ultimate
// cannot change mid-game.
function buildUltimateIndex(roster) {
  const index = {};
  roster.forEach(function (p) {
    const u = _GAMESIM_DATA.ultimates.ultimateFor(p);
    if (u) index[p.id] = { ultimate: u, boost: _GAMESIM_DATA.ultimates.badgeBoostFor(p, u) };
  });
  return index;
}

// A takeover event belongs to the HOLDER's team, not to whoever has the ball —
// a defensive ultimate fires while the other side is on offense. Derived by
// copy-and-override from the live context so it keeps every stamped field
// (period, clock, quarter) rather than being rebuilt field by field; a
// hand-listed copy is exactly how rebound events once lost their clock.
function pushSimEvent(ctx, side, ev) {
  if (!ctx) return;
  const sideCtx = ctx.team === side ? ctx : Object.assign({}, ctx, { team: side });
  ev.team = sideCtx.team;
  ev.quarter = sideCtx.quarter;
  ev.period = sideCtx.period;
  ev.clock = sideCtx.clock;
  ctx.events.push(ev);
}

// The live takeover on a side, or null. Read by gameCoach.js so a coach does
// not bench a man mid-takeover, and by the pixel view for the on-court marker.
function activeTakeoverFor(sim, team) {
  return (sim.takeovers && sim.takeovers[team]) || null;
}

function createGameSim(homeTeamId, awayTeamId, rng, options) {
  const homeRoster = _GAMESIM_DATA.poss.eligibleRoster(homeTeamId);
  const awayRoster = _GAMESIM_DATA.poss.eligibleRoster(awayTeamId);

  // teamId stamps which side each line belongs to — see simEngineBoxScore.js's
  // comment for why the player's current teamId isn't good enough.
  const homeBox = {};
  homeRoster.forEach(function (p) { homeBox[p.id] = Object.assign(_GAMESIM_DATA.poss.initBoxLine(), { teamId: homeTeamId }); });
  const awayBox = {};
  awayRoster.forEach(function (p) { awayBox[p.id] = Object.assign(_GAMESIM_DATA.poss.initBoxLine(), { teamId: awayTeamId }); });

  // Starters are the five highest by the same weighting that used to decide
  // minutes, so "who plays most" is unchanged in spirit — it is now expressed
  // by actually being on the floor rather than by a post-hoc number.
  function pickStarters(roster) {
    return roster.slice()
      .sort(function (a, b) { return _GAMESIM_DATA.box.minutesWeight(b) - _GAMESIM_DATA.box.minutesWeight(a); })
      .slice(0, 5)
      .map(function (p) { return p.id; });
  }

  const secondsPlayed = {};
  homeRoster.concat(awayRoster).forEach(function (p) { secondsPlayed[p.id] = 0; });

  const onCourt = { home: pickStarters(homeRoster), away: pickStarters(awayRoster) };
  const ultimateIndex = {
    home: buildUltimateIndex(homeRoster),
    away: buildUltimateIndex(awayRoster)
  };
  const byId = {};
  homeRoster.concat(awayRoster).forEach(function (p) { byId[p.id] = p; });

  function lineup(team) {
    return onCourt[team].map(function (id) { return byId[id]; });
  }

  // Synergy depends only on roster composition, not anything that changes
  // possession-to-possession, so it's computed once per game.
  const homeSynergy = _GAMESIM_DATA.composite.computeTeamSynergy(homeRoster, _GAMESIM_DATA.teams.getTeamById(homeTeamId));
  const awaySynergy = _GAMESIM_DATA.composite.computeTeamSynergy(awayRoster, _GAMESIM_DATA.teams.getTeamById(awayTeamId));

  const playByPlay = [];
  // Structured events for the pixel game view — only collected when the
  // caller asks (Watch Next Game passes { events: [] }); a normal season sim
  // never pays the allocation cost.
  const captureEvents = options && options.events ? options.events : null;

  const sim = {
    homeTeamId: homeTeamId,
    awayTeamId: awayTeamId,
    homeRoster: homeRoster,
    awayRoster: awayRoster,
    homeBox: homeBox,
    awayBox: awayBox,
    homeScore: 0,
    awayScore: 0,
    clock: PERIOD_SECONDS,
    period: 1,
    possessionsPlayed: 0,
    offenseTeam: 'home',
    quarter: 1,
    timeoutsLeft: { home: TIMEOUTS_PER_GAME, away: TIMEOUTS_PER_GAME },
    run: { team: null, points: 0 },
    // The live takeover on each side, or null. See activeTakeoverFor.
    takeovers: { home: null, away: null },
    // Every completed takeover this game, for league.js to file into history —
    // box scores are pruned at save time, so a takeover that lived only in one
    // would vanish for the other 29 teams.
    takeoverLog: [],
    // Set by a watching view to the side the human is coaching. Null for
    // every unwatched game, which is what keeps batch sims unchanged.
    userTeam: null,
    done: false,
    playByPlay: playByPlay,
    onCourt: onCourt,
    secondsPlayed: secondsPlayed,
    byId: byId
  };

  // External decisions (the user watching, or a test), queued and drained at
  // the top of the next step(). Never applied mid-possession: a substitution
  // landing halfway through would change who was on the floor for math that
  // had already run.
  const pendingDecisions = [];

  sim.applyDecision = function (decision) {
    if (sim.done) return false;                     // spec: ignored after the final buzzer
    if (!decision) return false;
    if (decision.type !== 'timeout' && decision.type !== 'substitution') return false;
    if (decision.team !== 'home' && decision.team !== 'away') return false;
    if (decision.type === 'timeout' && sim.timeoutsLeft[decision.team] <= 0) return false;
    pendingDecisions.push(decision);
    return true;
  };

  // Applies everything queued and reports which teams were decided for by a
  // caller rather than by the coach. The coach is then skipped for those
  // teams for THIS boundary only — otherwise it would evaluate the floor the
  // user just changed and swap the substitute straight back off, making user
  // agency look broken when it is actually being overwritten one line later.
  function drainDecisions() {
    const decided = {};
    while (pendingDecisions.length > 0) {
      const d = pendingDecisions.shift();
      if (d.type === 'timeout') {
        if (sim.callTimeout(d.team)) decided[d.team] = true;
      } else {
        sim.applySubstitutions(d.team, d.swaps);
        decided[d.team] = true;
      }
    }
    return decided;
  }

  sim.step = function () {
    if (sim.done) return;

    // Every team, every game — this is what makes watching a game no better
    // than not watching it, other than the decisions a human chooses to make.
    const userDecided = drainDecisions();
    ['home', 'away'].forEach(function (t) {
      if (userDecided[t]) return;
      sim.applySubstitutions(t, _GAMESIM_DATA.coach.decideSubstitutions(sim, t));
    });
    ['home', 'away'].forEach(function (t) {
      if (userDecided[t]) return;
      // The watched team's timeout is the human's call FIRST. The coach reacts
      // at the very boundary the run becomes qualifying — which is before the
      // view can render a frame, let alone a nudge — and calling it clears
      // sim.run, so the situation the user was meant to react to never
      // reached the screen. A watched team's timeout is therefore left to the
      // view, which offers it and then applies this same decision itself if
      // the user ignores the offer.
      if (sim.userTeam === t) return;
      if (_GAMESIM_DATA.coach.decideTimeout(sim, t)) sim.callTimeout(t);
    });

    const periodLength = sim.period <= REGULATION_PERIODS ? PERIOD_SECONDS : OVERTIME_SECONDS;
    if (sim.clock >= periodLength) {
      playByPlay.push('--- ' + (sim.period <= REGULATION_PERIODS
        ? 'Q' + sim.period
        : 'OT' + (sim.period - REGULATION_PERIODS)) + ' ---');
    }

    const team = sim.offenseTeam;
    const other = team === 'home' ? 'away' : 'home';
    sim.quarter = Math.min(sim.period, REGULATION_PERIODS);
    // .slice() is load-bearing: onCourt.home is mutated in place by
    // applySubstitutions, so storing the array itself would leave every
    // possession event pointing at one live array that reports the FINAL
    // lineup for the whole game.
    const ctx = captureEvents ? {
      events: captureEvents,
      team: team,
      quarter: sim.quarter,
      period: sim.period,
      clock: Math.round(sim.clock),
      lineups: { home: onCourt.home.slice(), away: onCourt.away.slice() }
    } : null;

    const offBox = team === 'home' ? homeBox : awayBox;
    const defBox = team === 'home' ? awayBox : homeBox;
    const offSyn = team === 'home' ? homeSynergy : awaySynergy;
    const defSyn = team === 'home' ? awaySynergy : homeSynergy;

    // A possession that starts off a live ball — a steal or a defensive board
    // — is a break, and the engine biases its shot mix toward the rim. Tracked
    // here rather than read back off the event log because a plain season sim
    // passes no event context at all.
    const outcome = {};
    // The scoreboard, from the SHOOTING team's point of view, so the engine can
    // react to it — a trailing team tightens up, a leading team eases off. See
    // URGENCY_TUNING in simEnginePossession.js. Without this every possession in
    // a 40-point blowout was played exactly like a tie game.
    const gameCtx = {
      scoreDiff: team === 'home' ? (sim.homeScore - sim.awayScore) : (sim.awayScore - sim.homeScore),
      period: sim.period,
      // Resolved from the SHOOTING team's point of view, matching scoreDiff:
      // `offense` is a takeover held by the side with the ball, `defense` one
      // held by the side defending. Either may be null. Resolving it here
      // rather than in the engine is what keeps ultimates.js out of
      // simEnginePossession.js's requires entirely.
      takeovers: {
        offense: sim.takeovers[team] && sim.takeovers[team].side === 'offense' ? sim.takeovers[team] : null,
        defense: sim.takeovers[other] && sim.takeovers[other].side === 'defense' ? sim.takeovers[other] : null
      }
    };

    const points = _GAMESIM_DATA.poss.simulatePossession(
      lineup(team), offBox, lineup(other), defBox, rng,
      { offense: offSyn, defense: defSyn }, playByPlay, ctx, sim.inTransition, outcome, gameCtx);
    sim.inTransition = !!outcome.liveBallToDefense;

    if (team === 'home') sim.homeScore += points; else sim.awayScore += points;

    // --- The ultimate meter (ultimates.js) --------------------------------
    // Applied AFTER the possession resolves, from what the engine reported,
    // and consuming no randomness. A takeover therefore fires because of a
    // night already going well, never because of a roll — which is also what
    // keeps the seeded stream, and both golden masters, untouched.
    const ults = _GAMESIM_DATA.ultimates;
    const plays = outcome.plays || [];
    for (let pi = 0; pi < plays.length; pi++) {
      const play = plays[pi];
      // A play's charge belongs to whoever made it, on whichever side he plays.
      const side = ultimateIndex.home[play.playerId] ? 'home'
                 : (ultimateIndex.away[play.playerId] ? 'away' : null);
      if (!side) continue;
      const box = side === 'home' ? homeBox : awayBox;
      const line = box[play.playerId];
      // Frozen on the bench: neither fills nor drains while off the floor.
      // Losing charge to a substitution would punish the player for a decision
      // he did not make.
      if (!line || onCourt[side].indexOf(play.playerId) === -1) continue;
      // A player spending his takeover does not EARN charge from it. Without
      // this, the takeover charged itself: its own dials (shotShare, And-One's
      // 2.2x foul rate) multiply exactly the plays its affinity rewards, and
      // the league's best charge profile refilled mid-run and fired again —
      // measured at 1.56 takeovers a game for the scoring leader, against a
      // design of ~1 per game for the whole league, and raising the second-
      // meter cost to 2.2x barely dented it (1.09/game) because the box-line
      // escalation resets every game while charge carries over.
      if (sim.takeovers[side] && sim.takeovers[side].playerId === play.playerId) continue;
      const key = ultimateIndex[side][play.playerId].ultimate.key;
      const diff = side === 'home' ? (sim.homeScore - sim.awayScore)
                                   : (sim.awayScore - sim.homeScore);
      const mult = ults.situationMultiplier(key, diff, sim.period);
      line.charge = Math.max(0, line.charge + ults.chargeGain(key, play.kind, mult));
    }
    outcome.plays = null;

    // Expire a running takeover. Counted in possessions of the side the
    // ultimate ACTS ON: a defensive ultimate ticks down on the other team's
    // possessions, which is where it does its work.
    ['home', 'away'].forEach(function (side) {
      const active = sim.takeovers[side];
      if (!active) return;
      const actsOn = active.side === 'defense' ? (side === 'home' ? 'away' : 'home') : side;
      if (actsOn !== team) return;
      active.left -= 1;
      const stillOn = onCourt[side].indexOf(active.playerId) !== -1;
      if (active.left > 0 && stillOn) return;
      const box = side === 'home' ? homeBox : awayBox;
      const line = box[active.playerId];
      // Snapshot-and-diff rather than accumulating per possession: the box line
      // already counts his points, so the difference is exact and cannot drift.
      if (line) line.takeoverPoints = line.points - (line.takeoverPointsAt || 0);
      sim.takeoverLog.push({
        playerId: active.playerId,
        playerName: (byId[active.playerId] || {}).name || active.playerId,
        teamId: side === 'home' ? homeTeamId : awayTeamId,
        ultimateKey: active.ultimateKey,
        points: line ? line.takeoverPoints : 0,
        run: active.declared,
        startPeriod: active.startPeriod,
        period: sim.period
      });
      // Deliberately NOT called `points`. On every other event that field means
      // "points scored on this play" and validate-pixel-events.js sums it
      // against the final score — reusing the name here would silently
      // double-count the whole takeover.
      pushSimEvent(ctx, side, { type: 'takeover-end', playerId: active.playerId,
        ultimateKey: active.ultimateKey, takeoverPoints: line ? line.takeoverPoints : 0 });
      sim.takeovers[side] = null;
    });

    // Fire a new one. Only for a player actually on the floor, and only one per
    // side at a time — two simultaneous takeovers on one team would stack their
    // dials on the same five players.
    ['home', 'away'].forEach(function (side) {
      if (sim.takeovers[side]) return;
      const box = side === 'home' ? homeBox : awayBox;
      const ids = onCourt[side];
      // Whoever is furthest PAST his own threshold goes, not whoever appears
      // first in the lineup array — deciding on merit rather than on array
      // position.
      //
      // Honest note: this was changed on the theory that lineup order starved
      // slower team-mates of the side's single slot. Measured, it does not —
      // lineup order gives a 7.8x spread in takeovers per holder-game against
      // 8.4x for this rule. The change is defensible on its own terms and fixes
      // nothing measurable, so do not credit it with the rate spread; that came
      // from CHARGE_RATE (see ultimates.js).
      let bestId = null, bestOver = 0, bestEntry = null, bestLine = null, bestRun = 0;
      const left = possessionsLeftForSide(sim.period, sim.clock);
      for (let i = 0; i < ids.length; i++) {
        const entry = ultimateIndex[side][ids[i]];
        const line = box[ids[i]];
        if (!entry || !line) continue;
        const over = line.charge / ults.chargeThreshold(line.takeoversUsed);
        if (over < 1 || over <= bestOver) continue;
        // Not enough game left for this to be a takeover. He stays loaded
        // rather than spending a full meter on four possessions — and if the
        // game goes to overtime, the clock resets and he goes off immediately.
        const run = ults.takeoverRun(entry.ultimate.key, left);
        if (run <= 0) continue;
        bestId = ids[i]; bestOver = over; bestEntry = entry; bestLine = line; bestRun = run;
      }
      if (!bestId) return;
      bestLine.charge = 0;
      bestLine.takeoversUsed += 1;
      bestLine.takeoverPointsAt = bestLine.points;
      sim.takeovers[side] = {
        playerId: bestId,
        ultimateKey: bestEntry.ultimate.key,
        ultimateName: bestEntry.ultimate.name,
        side: bestEntry.ultimate.side,
        kind: bestEntry.ultimate.kind,
        effect: ults.takeoverEffect(bestEntry.ultimate.key, bestEntry.boost),
        left: bestRun,
        // What a full run of this ultimate would have been, so the log can tell
        // a takeover that was declared short from one the buzzer amputated.
        declared: bestRun,
        fullRun: ults.takeoverLength(bestEntry.ultimate.key),
        // When it began, so the log can tell "took over from the third" from
        // "took over with two minutes left". Without this the only recorded
        // period is the one it ENDED in, which for a buzzer-cut takeover is
        // always the last one and says nothing about how much run it got.
        startPeriod: sim.period,
        startClock: Math.round(sim.clock)
      };
      pushSimEvent(ctx, side, { type: 'takeover-start', playerId: bestId,
        ultimateKey: bestEntry.ultimate.key, ultimateName: bestEntry.ultimate.name });
    });

    // Plus/minus, credited to the ten players who were actually on the floor
    // for THIS possession — before applySubstitutions runs below, or the
    // credit lands on the lineup that replaced them. Five players are on the
    // floor for every point, so each team's summed plus/minus comes to exactly
    // five times the final margin; scripts/validate-ratings.js asserts that
    // identity, which is what catches a wrong sign or a wrong lineup.
    //
    // This is the value signal scripts/fit-overall.js regresses the derived
    // `overall` against. It reads `points` after the possession has resolved
    // and draws no randomness, so the rng stream — and both golden masters —
    // are untouched by its presence.
    if (points !== 0) {
      onCourt[team].forEach(function (id) {
        if (offBox[id]) offBox[id].plusMinus += points;
      });
      onCourt[other].forEach(function (id) {
        if (defBox[id]) defBox[id].plusMinus -= points;
      });
    }

    if (points > 0) {
      if (sim.run.team === team) sim.run.points += points;
      else sim.run = { team: team, points: points };
    }

    const elapsed = Math.min(sim.clock, possessionSeconds(rng));
    sim.clock -= elapsed;
    onCourt.home.concat(onCourt.away).forEach(function (id) { secondsPlayed[id] += elapsed; });

    // Sitting down has to actually restore something, or rotations are a
    // one-way ratchet: simEnginePossession.js's drainEnergy only ever spends
    // energy, so without this every player decays past the coach's fatigue
    // floor and the whole roster gets cycled through. Recovery is slower than
    // drain, so heavy minutes still cost something over a game.
    recoverBenchEnergy();
    sim.possessionsPlayed += 1;
    sim.offenseTeam = other;

    if (sim.clock <= 0) endPeriod();
  };

  const BENCH_RECOVERY_PER_POSSESSION = 0.030;

  function recoverBenchEnergy() {
    [['home', homeRoster, homeBox], ['away', awayRoster, awayBox]].forEach(function (side) {
      const team = side[0], roster = side[1], box = side[2];
      roster.forEach(function (p) {
        if (onCourt[team].indexOf(p.id) !== -1) return;
        box[p.id].energy = Math.min(1, box[p.id].energy + BENCH_RECOVERY_PER_POSSESSION);
      });
    });
  }

  function endPeriod() {
    const regulationOver = sim.period >= REGULATION_PERIODS;
    if (!regulationOver) {
      sim.period += 1;
      sim.clock = PERIOD_SECONDS;
      return;
    }
    if (sim.homeScore === sim.awayScore) {
      // Real overtime, rather than awarding a phantom point. Each extra
      // period is a full five minutes and both teams keep playing.
      sim.period += 1;
      sim.clock = OVERTIME_SECONDS;
      return;
    }
    sim.done = true;
    flushRunningTakeovers();
  }

  // Close out any takeover still running when the buzzer goes.
  //
  // Without this HALF of them were never recorded. Measured over 40 games: 80
  // takeovers started, 42 logged, 38 lost. That is not a slip in the expiry
  // code — it is the situation multiplier doing exactly what it was designed to
  // do. Charge accrues far faster in the fourth quarter and overtime, so
  // takeovers cluster late, and a takeover that begins with three minutes left
  // never reaches the end of its twenty-six possessions.
  //
  // A takeover interrupted by the final buzzer still happened, and the points
  // it earned are still real, so it is logged with what it got.
  function flushRunningTakeovers() {
    ['home', 'away'].forEach(function (side) {
      const active = sim.takeovers[side];
      if (!active) return;
      const box = side === 'home' ? homeBox : awayBox;
      const line = box[active.playerId];
      if (line) line.takeoverPoints = line.points - (line.takeoverPointsAt || 0);
      sim.takeoverLog.push({
        playerId: active.playerId,
        playerName: (byId[active.playerId] || {}).name || active.playerId,
        teamId: side === 'home' ? homeTeamId : awayTeamId,
        ultimateKey: active.ultimateKey,
        points: line ? line.takeoverPoints : 0,
        run: active.declared,
        startPeriod: active.startPeriod,
        period: sim.period,
        // The one thing that distinguishes these from a takeover that ran its
        // course: the game ended underneath it.
        cutShort: true,
        // How much of its run it never got. Zero would mean the buzzer caught
        // it on its final possession, which is not really cut short at all.
        possessionsLost: active.left
      });
      sim.takeovers[side] = null;
    });
  }

  // Consumes no game clock: the stoppage is represented by its effects, not
  // by advancing time (see the design doc).
  sim.callTimeout = function (team) {
    if (sim.done) return false;
    if (sim.timeoutsLeft[team] <= 0) return false;
    sim.timeoutsLeft[team] -= 1;
    const box = team === 'home' ? homeBox : awayBox;
    onCourt[team].forEach(function (id) {
      box[id].energy = Math.min(1, box[id].energy + TIMEOUT_ENERGY_RESTORE);
    });
    // Whoever was running now isn't.
    sim.run = { team: null, points: 0 };
    return true;
  };

  sim.applySubstitutions = function (team, swaps) {
    if (!swaps || swaps.length === 0) return;
    const box = team === 'home' ? homeBox : awayBox;
    swaps.forEach(function (swap) {
      const idx = onCourt[team].indexOf(swap.out);
      if (idx === -1) return;                                  // not on the floor
      if (onCourt[team].indexOf(swap.in) !== -1) return;       // already on the floor
      if (!byId[swap.in]) return;                              // not on this roster
      // Fouled out is fouled out. gameCoach.js has always refused to field
      // these players and ui/pixelHud.js has always disabled their sub button
      // with the title "Fouled out" — but the model itself never checked, so
      // re-enabling that button put a disqualified player back on the floor.
      // Measured: 23 minutes and 113 of 226 possessions by a six-foul player
      // the game's own UI called FOULED OUT.
      const line = box[swap.in];
      if (line && line.fouls >= _GAMESIM_DATA.coach.FOUL_OUT) return;
      onCourt[team][idx] = swap.in;
    });
  };

  function writeMinutes() {
    Object.keys(secondsPlayed).forEach(function (id) {
      const line = homeBox[id] || awayBox[id];
      if (line) line.minutes = Math.round(secondsPlayed[id] / 60);
    });
  }

  sim.result = function () {
    writeMinutes();
    return {
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
      boxScore: Object.assign({}, homeBox, awayBox),
      playByPlay: playByPlay,
      // Every completed takeover, for league.js to file into league history.
      takeovers: sim.takeoverLog
    };
  };

  return sim;
}

// Named distinctly from simEngineBoxScore.js's own simulateGame — see that
// file's comment on this same function name for why. Play-by-play is always
// generated (the string-building cost is negligible next to the possession
// math that already runs regardless) rather than gated behind a flag —
// storage is what's expensive, and that's pruned at save time the same way
// save.js already prunes box scores down to just the user's own games.
function simulatePossessionGame(homeTeamId, awayTeamId, rng, options) {
  const sim = createGameSim(homeTeamId, awayTeamId, rng, options);
  while (!sim.done) sim.step();
  return sim.result();
}

_GAMESIM_DATA.simEngine.registerEngine('possession', { simulateGame: simulatePossessionGame });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGameSim: createGameSim,
    activeTakeoverFor: activeTakeoverFor,
    simulateGame: simulatePossessionGame
  };
}
