// God Mode — an explicit, opt-in cheat/debug toolkit for testing or just
// messing around. Every function here mutates the user's own team only
// (never touched by anything else in the game unless GameState.godMode.enabled
// is true and the user clicked a button for it), so it can't silently affect
// normal play. Kept in its own file rather than folded into commissioner.js —
// commissioner.js's sandbox tools model a plausible league-management power
// (relocate a team, run an expansion draft); these are flatly unrealistic
// (max out a whole roster in one click) and shouldn't be confused with that.
var _GODMODE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), data: require('./data.js'), finances: require('./finances.js') }
  : {
      league: { getTeamRoster: getTeamRoster },
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MAX: RATING_MAX },
      finances: { ensureTeamFinances: ensureTeamFinances, ARENA_MAX_TIER: ARENA_MAX_TIER }
    };

function maxOutRoster(teamId) {
  const roster = _GODMODE_DATA.league.getTeamRoster(teamId);
  roster.forEach(function (p) {
    // `overall` is derived, so maxing the attributes IS maxing the overall.
    // Assigning to it here would have thrown against the getter.
    p.potential = _GODMODE_DATA.data.RATING_MAX;
    _GODMODE_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
      p.attributes[key] = _GODMODE_DATA.data.RATING_MAX;
    });
  });
  return roster.length;
}

function healRoster(teamId) {
  const roster = _GODMODE_DATA.league.getTeamRoster(teamId);
  roster.forEach(function (p) {
    p.status.injury = null;
    p.status.fatigue = 0;
    p.status.morale = 100;
  });
  return roster.length;
}

function maxTeamVibes(team) {
  team.chemistry = 99;
  team.fanHappiness = 99;
  team.ownerHappiness = 99;
  team.prestige = 99;
}

// Cash goes to a very large but finite number (not Infinity/NaN-risk) —
// still a real number the rest of finances.js's math (luxury tax deduction,
// arena upgrade cost checks) can subtract from without producing NaN.
const GODMODE_CASH_GRANT = 999999999;

function grantUnlimitedMoney(team) {
  const finances = _GODMODE_DATA.finances.ensureTeamFinances(team);
  finances.cash = GODMODE_CASH_GRANT;
  finances.arenaTier = _GODMODE_DATA.finances.ARENA_MAX_TIER;
}

// Called from league.js's applyGameResult (regular season) and playoffs.js's
// simulateSeriesGame (playoffs) — the two places a game's final score becomes
// real — right after the engine returns `result` and before anything reads
// it, so every downstream consumer (win/loss records, box score header,
// history) sees a consistent, already-corrected score rather than patching
// records after the fact. Only touches the TEAM score, not individual box
// lines — a debug/cheat feature is allowed a small, disclosed inconsistency
// (the box score total may not exactly match the final score in a rescued
// game) rather than the real complexity of rewriting a plausible box line.
// `rng` is the same seeded stream the rest of the game simulation uses, so
// turning God Mode on doesn't break save/load determinism.
function applyAutoWin(homeTeamId, awayTeamId, result, rng) {
  if (typeof GameState === 'undefined' || !GameState.godMode || !GameState.godMode.autoWinEnabled) return;
  if (!GameState.userTeamId) return;
  const userIsHome = homeTeamId === GameState.userTeamId;
  const userIsAway = awayTeamId === GameState.userTeamId;
  if (!userIsHome && !userIsAway) return;

  const userScore = userIsHome ? result.homeScore : result.awayScore;
  const oppScore = userIsHome ? result.awayScore : result.homeScore;
  if (userScore > oppScore) return; // already winning, nothing to rescue

  const margin = 5 + Math.floor(rng() * 10);
  if (userIsHome) result.homeScore = oppScore + margin;
  else result.awayScore = oppScore + margin;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    maxOutRoster: maxOutRoster,
    healRoster: healRoster,
    maxTeamVibes: maxTeamVibes,
    grantUnlimitedMoney: grantUnlimitedMoney,
    GODMODE_CASH_GRANT: GODMODE_CASH_GRANT,
    applyAutoWin: applyAutoWin
  };
}
