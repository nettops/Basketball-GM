// The chase-list: the answer to "what do I do next" without anything nagging
// you. Every milestone is a pure predicate over a context the CALLER builds, so
// this file imports neither history.js nor players-2026.js — history.js already
// requires gmCareer.js, and importing back would be a cycle. It also makes the
// whole catalogue testable against a hand-built archive.
//
// `progress` returns { current, target } and is used only for the Dashboard's
// "closest" hint. Binary achievements set it to NULL rather than reporting a
// fake fraction — a milestone you either have or do not have has no honest
// halfway point.
//
// THRESHOLDS HERE ARE CALIBRATED, NOT PICKED. scripts/probe-gm-milestones.js
// measures when each one actually fires across 50 seasons on all 30 teams;
// values move to hit the measured rate. Do not hand-tune them to taste.
var _GMMILESTONE_DATA = (typeof require !== 'undefined')
  ? { career: require('./gmCareer.js') }
  : { career: {
        careerTotals: careerTotals, titleYears: titleYears,
        longestTitleRun: longestTitleRun, longestPlayoffStreak: longestPlayoffStreak,
        userDraftPicks: userDraftPicks, playersAcquiredByTrade: playersAcquiredByTrade,
        addChronicle: addChronicle, seasonsAscending: seasonsAscending,
        tenureCovers: tenureCovers, SEASON_RESULT: SEASON_RESULT,
        CHRONICLE_KINDS: CHRONICLE_KINDS
      } };

const FAMILIES = ['winning', 'building', 'dealing', 'endurance', 'absurd'];

// DISPLAY-scale thresholds. peakOverall is stored RAW, so every comparison goes
// through ctx.toDisplay first. Display runs HIGHER than raw on this curve (raw
// 75 -> display 90), so a naive raw comparison would silently UNDER-fire: it
// would demand a display-97 all-time great and miss every ordinary 90 star.
const STAR_OVERALL = 90;
const SOLID_OVERALL = 85;

function buildContext(career, leagueHistory, players, retiredPlayers, toDisplayRating) {
  const C = _GMMILESTONE_DATA.career;
  const byId = {};
  (players || []).forEach(function (p) { byId[p.id] = p; });
  (retiredPlayers || []).forEach(function (r) { if (!byId[r.id]) byId[r.id] = r; });

  return {
    career: career,
    leagueHistory: leagueHistory || { champions: [], draftClasses: [], trades: [], awardsHistory: [] },
    players: players || [],
    retiredPlayers: retiredPlayers || [],
    playerById: function (id) { return byId[id] || null; },
    toDisplay: toDisplayRating || function (raw) { return raw; },
    totals: C.careerTotals(career),
    seasons: C.seasonsAscending(career),
    draftPicks: C.userDraftPicks(career, leagueHistory),
    acquired: C.playersAcquiredByTrade(career, leagueHistory)
  };
}

function peakDisplay(ctx, playerId) {
  const p = ctx.playerById(playerId);
  if (!p || typeof p.peakOverall !== 'number') return 0;
  return ctx.toDisplay(p.peakOverall);
}

function bestSeasonWins(ctx) {
  return ctx.seasons.reduce(function (m, s) { return Math.max(m, s.wins); }, 0);
}

// A player who was on one of your teams during a season you held it.
function playedForYouIn(ctx, playerId, leagueYear) {
  const p = ctx.playerById(playerId);
  if (!p) return false;
  const history = p.careerHistory;
  const record = history && history.seasonByYear ? history.seasonByYear[leagueYear] : null;
  if (!record || !record.teamId) return false;
  return _GMMILESTONE_DATA.career.tenureCovers(ctx.career, record.teamId, leagueYear);
}

function awardsWonUnderYou(ctx, awardKey) {
  const out = [];
  (ctx.leagueHistory.awardsHistory || []).forEach(function (season) {
    (season.winners || []).forEach(function (w) {
      if (w.award !== awardKey) return;
      if (!playedForYouIn(ctx, w.playerId, season.leagueYear)) return;
      out.push({ leagueYear: season.leagueYear, playerId: w.playerId });
    });
  });
  return out;
}

function atLeast(getter, target) {
  return {
    achieved: function (ctx) { return getter(ctx) >= target; },
    progress: function (ctx) { return { current: Math.min(getter(ctx), target), target: target }; }
  };
}

function milestone(id, family, label, description, hidden, spec) {
  return { id: id, family: family, label: label, description: description,
           hidden: hidden, achieved: spec.achieved, progress: spec.progress || null };
}

const MILESTONES = [
  // --- winning -------------------------------------------------------------
  milestone('first_title', 'winning', 'Ring',
    'Win your first championship', false,
    atLeast(function (ctx) { return ctx.totals.titles; }, 1)),

  milestone('back_to_back', 'winning', 'Back-to-Back',
    'Win the championship in consecutive seasons', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestTitleRun(ctx.career); }, 2)),

  milestone('three_peat', 'winning', 'Three-Peat',
    'Win three championships in a row', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestTitleRun(ctx.career); }, 3)),

  milestone('sixty_win_season', 'winning', 'Sixty',
    'Win 60 games in a season', false,
    atLeast(bestSeasonWins, 60)),

  milestone('first_finals', 'winning', 'On the Big Stage',
    'Reach the Finals', false,
    atLeast(function (ctx) { return ctx.totals.finalsAppearances; }, 1)),

  // --- building ------------------------------------------------------------
  milestone('drafted_a_star', 'building', 'Eye for Talent',
    'Draft a player who peaks at ' + STAR_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) { return peakDisplay(ctx, p.playerId) >= STAR_OVERALL; });
      },
      progress: function (ctx) {
        const best = ctx.draftPicks.reduce(function (m, p) { return Math.max(m, peakDisplay(ctx, p.playerId)); }, 0);
        return { current: Math.min(best, STAR_OVERALL), target: STAR_OVERALL };
      }
    }),

  milestone('drafted_a_hall_of_famer', 'building', 'Immortal',
    'Draft a player who retires Hall of Fame eligible', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) {
          const r = ctx.retiredPlayers.find(function (x) { return x.id === p.playerId; });
          return !!(r && r.hallOfFame);
        });
      },
      progress: null
    }),

  milestone('mvp_under_you', 'building', 'Most Valuable',
    'Have a player win MVP while on your team', false, {
      achieved: function (ctx) { return awardsWonUnderYou(ctx, 'mvp').length >= 1; },
      progress: null
    }),

  // --- dealing -------------------------------------------------------------
  milestone('traded_for_a_star', 'dealing', 'The Deal',
    'Acquire a player by trade who peaks at ' + STAR_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.acquired.some(function (a) { return peakDisplay(ctx, a.playerId) >= STAR_OVERALL; });
      },
      progress: function (ctx) {
        const best = ctx.acquired.reduce(function (m, a) { return Math.max(m, peakDisplay(ctx, a.playerId)); }, 0);
        return { current: Math.min(best, STAR_OVERALL), target: STAR_OVERALL };
      }
    }),

  milestone('second_round_steal', 'dealing', 'Steal',
    'Draft a player outside the first round who peaks at ' + SOLID_OVERALL + ' overall', false, {
      achieved: function (ctx) {
        return ctx.draftPicks.some(function (p) {
          return p.round > 1 && peakDisplay(ctx, p.playerId) >= SOLID_OVERALL;
        });
      },
      progress: null
    }),

  // --- endurance -----------------------------------------------------------
  milestone('five_seasons', 'endurance', 'Established',
    'Run a team for five seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 5)),

  milestone('ten_seasons', 'endurance', 'A Decade In',
    'Run a team for ten seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 10)),

  milestone('twenty_five_seasons', 'endurance', 'Institution',
    'Run a team for twenty-five seasons', false,
    atLeast(function (ctx) { return ctx.totals.seasons; }, 25)),

  milestone('five_hundred_wins', 'endurance', 'Five Hundred',
    'Win 500 games', false,
    atLeast(function (ctx) { return ctx.totals.wins; }, 500)),

  milestone('thousand_wins', 'endurance', 'A Thousand',
    'Win 1,000 games', false,
    atLeast(function (ctx) { return ctx.totals.wins; }, 1000)),

  milestone('playoff_decade', 'endurance', 'Perennial',
    'Reach the playoffs ten seasons in a row', false,
    atLeast(function (ctx) { return _GMMILESTONE_DATA.career.longestPlayoffStreak(ctx.career); }, 10)),

  // --- absurd (hidden) -----------------------------------------------------
  milestone('dynasty', 'absurd', 'Dynasty',
    'Win five championships', true,
    atLeast(function (ctx) { return ctx.totals.titles; }, 5)),

  milestone('seventy_win_season', 'absurd', 'Seventy',
    'Win 70 games in a season', true,
    atLeast(bestSeasonWins, 70)),

  milestone('underdog_title', 'absurd', 'No One Saw It Coming',
    'Win the championship with fewer than 50 regular-season wins', true, {
      achieved: function (ctx) {
        return ctx.seasons.some(function (s) {
          return s.result === _GMMILESTONE_DATA.career.SEASON_RESULT.CHAMPION && s.wins < 50;
        });
      },
      progress: null
    }),

  milestone('five_time_mvp', 'absurd', 'The Face of the League',
    'Have one player win MVP five times under you', true, {
      achieved: function (ctx) {
        const byPlayer = {};
        awardsWonUnderYou(ctx, 'mvp').forEach(function (w) {
          byPlayer[w.playerId] = (byPlayer[w.playerId] || 0) + 1;
        });
        return Object.keys(byPlayer).some(function (id) { return byPlayer[id] >= 5; });
      },
      progress: null
    })
];

function isUnlocked(career, id) {
  return ((career && career.milestones) || []).some(function (u) { return u.id === id; });
}

function latestSeasonYear(career) {
  const seasons = _GMMILESTONE_DATA.career.seasonsAscending(career);
  return seasons.length > 0 ? seasons[seasons.length - 1].leagueYear : null;
}

// Returns the milestones unlocked BY THIS CALL. Already-unlocked ones are never
// returned or re-recorded, and nothing is ever revoked: an achievement that a
// later rules change would no longer grant stays earned.
function evaluate(career, ctx) {
  if (!career) return [];
  if (!Array.isArray(career.milestones)) career.milestones = [];
  const year = latestSeasonYear(career);
  const unlocked = [];
  MILESTONES.forEach(function (m) {
    if (isUnlocked(career, m.id)) return;
    if (!m.achieved(ctx)) return;
    career.milestones.push({ id: m.id, leagueYear: year });
    _GMMILESTONE_DATA.career.addChronicle(career, year,
      _GMMILESTONE_DATA.career.CHRONICLE_KINDS.MILESTONE, m.label + ' — ' + m.description + '.');
    unlocked.push(m);
  });
  return unlocked;
}

// The Dashboard hint. Deterministic by construction: highest progress fraction
// wins, ties break toward the LOWER target, then by declaration order. Hidden
// and binary milestones are excluded — the first would spoil a surprise, the
// second has no honest fraction.
function nearestMilestone(career, ctx) {
  let best = null;
  MILESTONES.forEach(function (m, index) {
    if (m.hidden) return;
    if (m.progress === null) return;
    if (isUnlocked(career, m.id)) return;
    const p = m.progress(ctx);
    if (!p || !p.target) return;
    const fraction = p.current / p.target;
    // A milestone already SATISFIED but not yet recorded is not a goal. This is
    // reachable in normal play: evaluate() runs once at season end, so between
    // crossing a threshold and the rollover the condition is true while the
    // unlock row does not exist yet. Without this the Dashboard would offer
    // "Established 5 / 5" as the thing you are closest to achieving.
    if (fraction >= 1) return;
    const candidate = { milestone: m, current: p.current, target: p.target, fraction: fraction, index: index };
    if (best === null) { best = candidate; return; }
    if (candidate.fraction > best.fraction) { best = candidate; return; }
    if (candidate.fraction < best.fraction) return;
    if (candidate.target < best.target) { best = candidate; return; }
    if (candidate.target > best.target) return;
    if (candidate.index < best.index) best = candidate;
  });
  if (!best) return null;
  return { milestone: best.milestone, current: best.current, target: best.target, fraction: best.fraction };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAMILIES: FAMILIES,
    MILESTONES: MILESTONES,
    STAR_OVERALL: STAR_OVERALL,
    SOLID_OVERALL: SOLID_OVERALL,
    buildContext: buildContext,
    evaluate: evaluate,
    isUnlocked: isUnlocked,
    nearestMilestone: nearestMilestone
  };
}

// Browser-global aliases. The bare names are far too generic to sit in the
// global namespace every script tag shares — commissioner.js's clampRating
// already shadowed progression.js's once in this codebase.
if (typeof module === 'undefined' || !module.exports) {
  var GM_MILESTONES = MILESTONES;
  var gmMilestoneIsUnlocked = isUnlocked;
  var gmBuildMilestoneContext = buildContext;
  var gmNearestMilestone = nearestMilestone;
}
