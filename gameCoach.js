// Shared decision-maker. Every team in every game runs through this, watched
// or not, so watching a game can never confer an advantage the rest of the
// league does not also get. Pure functions over sim state: no state of its
// own, which is what makes it testable in isolation and safe to call from
// both the batch loop and (later) the live-stepped view.
var _GAMECOACH_DATA = (typeof require !== 'undefined')
  ? { box: require('./simEngineBoxScore.js') }
  : { box: { minutesWeight: minutesWeight, lineupOrder: lineupOrder } };

const ENERGY_FLOOR = 0.55;          // below this, look for a rest
const ENERGY_EDGE = 0.15;           // a replacement must be at least this much fresher
const FOUL_TROUBLE = 4;             // 4+ fouls before Q4 means sit
const FOUL_OUT = 6;
const GARBAGE_MARGIN = 20;
const GARBAGE_SECONDS_LEFT = 5 * 60;
const MINUTES_OVER_TARGET = 1.10;   // 10% past the pro-rata target means sit
const REGULATION_SECONDS = 48 * 60;
const TEAM_MINUTES = 240;

function lineFor(sim, team, id) {
  return (team === 'home' ? sim.homeBox : sim.awayBox)[id];
}

function rosterFor(sim, team) {
  return team === 'home' ? sim.homeRoster : sim.awayRoster;
}

// Bench players who could legally come in. Sorted by whether they still have
// minutes budget left FIRST, then by freshness — picking purely on freshness
// sends a rested starter back out even when he is already over his night's
// allocation, which is how a 36-minute player ended up at 46 (timeouts top
// everyone up, so he kept coming back as the freshest body available).
function availableBench(sim, team, alreadyUsed) {
  return rosterFor(sim, team)
    .filter(function (p) {
      if (sim.onCourt[team].indexOf(p.id) !== -1) return false;
      if (alreadyUsed[p.id]) return false;
      return lineFor(sim, team, p.id).fouls < FOUL_OUT;
    })
    .sort(function (a, b) {
      const aOver = isOverMinutesPace(sim, team, a.id) ? 1 : 0;
      const bOver = isOverMinutesPace(sim, team, b.id) ? 1 : 0;
      if (aOver !== bOver) return aOver - bOver;   // under-budget players first
      return lineFor(sim, team, b.id).energy - lineFor(sim, team, a.id).energy;
    });
}

function isGarbageTime(sim) {
  const margin = Math.abs(sim.homeScore - sim.awayScore);
  const lateEnough = sim.period >= 4 && sim.clock <= GARBAGE_SECONDS_LEFT;
  return margin > GARBAGE_MARGIN && lateEnough;
}

// Target minutes come from a player's RANK in the rotation, not from his
// share of the roster's total weight. That distinction matters a lot:
// minutesWeight spans only about 2.7x from the best player in the league to
// the worst (78 to 29), so splitting 240 minutes proportionally hands the star
// ~25 and the 14th man ~13 — a flat rotation no real team plays. That was
// harmless while minutes were cosmetic, but rotations make minutes real, and a
// proportional split held a franchise player to 25 minutes and ~13 points a
// night.
//
// Because only the ORDER matters here, this is also where a minutesWeight bug
// does its damage: when the 0-100 rating rescale left the old `overall - 40`
// offset in place, 104 players collapsed onto an identical weight and their
// rank order became arbitrary. scripts/validate-ratings.js now pins the
// monotonicity this sort depends on.
//
// These are a conventional NBA rotation, summing to exactly 240 across ten
// players; anyone past tenth in the pecking order is a healthy scratch.
const ROTATION_MINUTES = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];

// Ranks are cached on the sim: roster composition cannot change mid-game, and
// this is called from inside a sort comparator that runs on every possession.
// Recomputing the sort each time cost ~12ms a game (a full season went from
// ~2s to ~18s) for an answer that never changes.
function rotationRanks(sim, team) {
  if (!sim._rotationRanks) sim._rotationRanks = {};
  if (sim._rotationRanks[team]) return sim._rotationRanks[team];
  const ranks = {};
  // Same ordering gameSim's pickStarters uses, which is the whole point: a
  // user-picked starter leads this list too, so targetMinutes hands him a
  // starter's 36/34/32/30/28 instead of a benchwarmer's zero.
  _GAMECOACH_DATA.box.lineupOrder(rosterFor(sim, team), sim[team + 'Team'])
    .forEach(function (p, i) { ranks[p.id] = i; });
  sim._rotationRanks[team] = ranks;
  return ranks;
}

function rotationRank(sim, team, id) {
  const ranks = rotationRanks(sim, team);
  return ranks[id] === undefined ? rosterFor(sim, team).length : ranks[id];
}

function targetMinutes(sim, team, id) {
  const rank = rotationRank(sim, team, id);
  if (rank < ROTATION_MINUTES.length) return ROTATION_MINUTES[rank];
  return 0; // out of the rotation; only plays if injuries or foul-outs force it
}

// Seconds of game time elapsed so far, derived from the clock rather than
// tracked separately, so it cannot drift out of sync with it.
function elapsedSeconds(sim) {
  const completed = Math.min(sim.period - 1, 4) * 12 * 60 + Math.max(0, sim.period - 5) * 5 * 60;
  const periodLength = sim.period <= 4 ? 12 * 60 : 5 * 60;
  return completed + (periodLength - sim.clock);
}

// True when a player is running ahead of his minutes budget for this point in
// the game by more than the allowed margin.
function isOverMinutesPace(sim, team, id) {
  const elapsed = elapsedSeconds(sim);
  if (elapsed < 6 * 60) return false;           // too early to judge pace
  const played = (sim.secondsPlayed[id] || 0) / 60;
  const paceTarget = targetMinutes(sim, team, id) * (elapsed / REGULATION_SECONDS);
  return played > paceTarget * MINUTES_OVER_TARGET;
}

// Returns the swaps this team should make right now. Order of checks is
// deliberate: a fouled-out player MUST come off, so that runs before the
// discretionary reasons and claims the freshest replacement first.
function decideSubstitutions(sim, team) {
  const swaps = [];
  const used = {};
  const onFloor = sim.onCourt[team].slice();

  function trySwap(outId) {
    const bench = availableBench(sim, team, used);
    if (bench.length === 0) return;                    // never field fewer than five
    const inPlayer = bench[0];
    used[inPlayer.id] = true;
    swaps.push({ out: outId, in: inPlayer.id });
  }

  // 1. Fouled out — mandatory.
  onFloor.forEach(function (id) {
    if (lineFor(sim, team, id).fouls >= FOUL_OUT) trySwap(id);
  });

  const swappedOut = {};
  swaps.forEach(function (s) { swappedOut[s.out] = true; });

  // A man mid-takeover stays on the floor. Every ordinary reason to sit him —
  // foul trouble, garbage time, gassed, past his minutes budget — is suspended
  // for the duration, because a coach pulling a star in the middle of his
  // takeover is maddening to watch AND silently truncates the takeover's
  // measured value, which is the number the calibration is aimed at.
  //
  // Marked here rather than checked in each rule below so there is ONE place
  // this exemption lives. Deliberately AFTER rule 1: a foul-out is not a reason
  // to rest, it is a rule, so it has already run and this cannot override it.
  const takingOver = sim.takeovers && sim.takeovers[team] ? sim.takeovers[team].playerId : null;
  if (takingOver) swappedOut[takingOver] = true;

  // 2. Foul trouble before the fourth quarter — protective.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    const line = lineFor(sim, team, id);
    if (line.fouls >= FOUL_TROUBLE && sim.period < 4) {
      trySwap(id);
      swappedOut[id] = true;
    }
  });

  // 3. Garbage time — rest the best players once the result is decided.
  if (isGarbageTime(sim)) {
    rosterFor(sim, team).slice()
      .sort(function (a, b) { return _GAMECOACH_DATA.box.minutesWeight(b) - _GAMECOACH_DATA.box.minutesWeight(a); })
      .slice(0, 3)
      .forEach(function (p) {
        if (swappedOut[p.id]) return;
        if (sim.onCourt[team].indexOf(p.id) === -1) return;
        trySwap(p.id);
        swappedOut[p.id] = true;
      });
  }

  // 4. Fatigue — only if a meaningfully fresher body is on the bench.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    const line = lineFor(sim, team, id);
    if (line.energy >= ENERGY_FLOOR) return;
    const bench = availableBench(sim, team, used);
    if (bench.length === 0) return;
    if (lineFor(sim, team, bench[0].id).energy < line.energy + ENERGY_EDGE) return;
    trySwap(id);
    swappedOut[id] = true;
  });

  // 5. Minutes budget — the reason a healthy, un-tired starter still sits.
  onFloor.forEach(function (id) {
    if (swappedOut[id]) return;
    if (!isOverMinutesPace(sim, team, id)) return;
    trySwap(id);
    swappedOut[id] = true;
  });

  return swaps;
}

const RUN_TRIGGER_POINTS = 8;

// Call a timeout when the other side is running away with it and we still
// have one in hand. Deliberately simple: the human watching gets the same
// signal through a nudge, and can act sooner if they read it better.
function decideTimeout(sim, team) {
  if (sim.timeoutsLeft[team] <= 0) return false;
  const other = team === 'home' ? 'away' : 'home';
  if (sim.run.team !== other) return false;
  return sim.run.points >= RUN_TRIGGER_POINTS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decideSubstitutions: decideSubstitutions,
    decideTimeout: decideTimeout,
    RUN_TRIGGER_POINTS: RUN_TRIGGER_POINTS,
    ENERGY_FLOOR: ENERGY_FLOOR,
    FOUL_TROUBLE: FOUL_TROUBLE,
    FOUL_OUT: FOUL_OUT
  };
}
