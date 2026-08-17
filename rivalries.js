// Rivalries. Not all sixty-eight losses are equal, and until now they were.
//
// A rivalry is a pair of clubs and a heat value. Heat rises when they meet,
// rises much harder when they meet in the playoffs, and decays when they stop
// mattering to each other — so a rivalry has to be maintained by actually
// playing, which is what stops the whole league slowly becoming everyone's
// rival.
//
// Pure and at file scope. Heat is arithmetic on a pair of ids and a number;
// none of it needs a league, and the one thing that would make it subtly wrong
// forever — a pair key that disagrees with itself depending on argument order —
// is exactly what a validator can catch.

// A regular-season meeting is worth little on its own; clubs meet two to four
// times a year by schedule alone and that is not a rivalry, it is a calendar.
const HEAT_PER_MEETING = 1.2;

// A close game between two good teams is what people remember.
const HEAT_CLOSE_GAME = 1.5;
const CLOSE_GAME_MARGIN = 5;

// A playoff series is where rivalries are actually made, and this value is set
// by the decay rather than chosen: it has to be high enough above the threshold
// to survive several years of it.
//
// The first cut was 12 against a threshold of 10, which meant one decay (x0.75)
// took it to 9 and a rivalry born in a seven-game series was over before the
// next season tipped off.
//
// At 40 a series clears the 35 bar on its own, which is the claim worth
// keeping: two clubs who have never met before and go seven games in May are
// rivals that summer, without needing a decade of scheduling behind them. In
// practice they also carry the ~25 the calendar has already given them, so a
// real playoff pair sits around 65 and stays above the bar for two or three
// seasons before fading. Change HEAT_DECAY or RIVALRY_THRESHOLD and this has to
// move with them.
const HEAT_PER_PLAYOFF_SERIES = 40;

// Yearly decay. At 0.75 a rivalry left alone falls under the threshold in about
// four seasons — long enough to survive a bad year, short enough that a
// rivalry from a decade ago does not still colour a game between two clubs who
// have both since rebuilt twice.
const HEAT_DECAY = 0.75;

// Below this a pair is just two teams playing. Above it, the game is worth
// more to everyone watching.
//
// Set ABOVE the equilibrium that routine scheduling produces, which is the
// whole difficulty here. Clubs meet about four times a season forever, so heat
// from meetings alone converges: h = h * HEAT_DECAY + perSeason, i.e.
// perSeason / (1 - HEAT_DECAY). At ~6.3 a season that is ~25, and the first cut
// of this file put the threshold at 10 — so after a few seasons every one of
// the 435 possible pairs in a thirty-club league was a "rivalry", which is the
// same as none of them being one. Measured in the browser: 435 pairs carrying
// heat and zero pairs anybody would call a rival.
//
// At 35, routine meetings never get there on their own and a playoff series
// (+32 on top of ~25) clears it comfortably. That is the intended shape: the
// playoffs make rivalries, the calendar does not.
const RIVALRY_THRESHOLD = 35;

const HEAT_MAX = 100;

// Order-independent by construction. A key that depends on which club was
// passed first gives one pair two entries that each decay separately, and the
// bug reads as "the rivalry keeps resetting" months later.
function pairKey(teamIdA, teamIdB) {
  return teamIdA < teamIdB ? teamIdA + '|' + teamIdB : teamIdB + '|' + teamIdA;
}

function getHeat(state, teamIdA, teamIdB) {
  if (!state || !state.heat) return 0;
  return state.heat[pairKey(teamIdA, teamIdB)] || 0;
}

function addHeat(state, teamIdA, teamIdB, amount) {
  if (!state.heat) state.heat = {};
  const key = pairKey(teamIdA, teamIdB);
  state.heat[key] = Math.min(HEAT_MAX, Math.max(0, (state.heat[key] || 0) + amount));
  return state.heat[key];
}

function areRivals(state, teamIdA, teamIdB) {
  return getHeat(state, teamIdA, teamIdB) >= RIVALRY_THRESHOLD;
}

// One completed game. Close games count for more, because a rivalry is built
// out of the ones that hurt rather than the ones that were over by halftime.
function recordGame(state, game) {
  const margin = Math.abs((game.homeScore || 0) - (game.awayScore || 0));
  let heat = HEAT_PER_MEETING;
  if (margin <= CLOSE_GAME_MARGIN) heat += HEAT_CLOSE_GAME;
  if (game.isPlayoff) heat += HEAT_PER_MEETING;
  return addHeat(state, game.homeTeamId, game.awayTeamId, heat);
}

// A whole playoff series, worth an order of magnitude more than a meeting.
// Called once per series rather than per game so a sweep and a seven-game war
// are not worth the same.
function recordPlayoffSeries(state, teamIdA, teamIdB) {
  return addHeat(state, teamIdA, teamIdB, HEAT_PER_PLAYOFF_SERIES);
}

// Yearly, at the rollover. Pairs that fall to nothing are deleted rather than
// left at zero — this object is saved, and thirty clubs is 435 possible pairs
// that would otherwise accumulate forever as dead rows.
function decayRivalries(state) {
  if (!state || !state.heat) return state;
  Object.keys(state.heat).forEach(function (key) {
    const next = state.heat[key] * HEAT_DECAY;
    if (next < 0.5) delete state.heat[key];
    else state.heat[key] = Math.round(next * 10) / 10;
  });
  return state;
}

// Everyone this club has history with, hottest first.
function rivalsOf(state, teamId) {
  if (!state || !state.heat) return [];
  return Object.keys(state.heat)
    .map(function (key) {
      const ids = key.split('|');
      if (ids[0] !== teamId && ids[1] !== teamId) return null;
      return { teamId: ids[0] === teamId ? ids[1] : ids[0], heat: state.heat[key] };
    })
    .filter(function (r) { return r && r.heat >= RIVALRY_THRESHOLD; })
    .sort(function (a, b) { return b.heat - a.heat; });
}

// What a rivalry game is worth, as a multiplier on the swing a result already
// produces. Deliberately a multiplier rather than a separate effect: fan
// happiness and morale already respond to winning and losing, and a rivalry
// should make that response bigger, not introduce a second unrelated one.
function rivalryMultiplier(state, teamIdA, teamIdB) {
  const heat = getHeat(state, teamIdA, teamIdB);
  if (heat < RIVALRY_THRESHOLD) return 1;
  return 1 + Math.min(1, (heat - RIVALRY_THRESHOLD) / (HEAT_MAX - RIVALRY_THRESHOLD));
}

function createRivalryState() {
  return { heat: {} };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pairKey: pairKey,
    getHeat: getHeat,
    addHeat: addHeat,
    areRivals: areRivals,
    recordGame: recordGame,
    recordPlayoffSeries: recordPlayoffSeries,
    decayRivalries: decayRivalries,
    rivalsOf: rivalsOf,
    rivalryMultiplier: rivalryMultiplier,
    createRivalryState: createRivalryState,
    RIVALRY_THRESHOLD: RIVALRY_THRESHOLD,
    HEAT_DECAY: HEAT_DECAY,
    HEAT_MAX: HEAT_MAX
  };
}
