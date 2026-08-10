// Calibrates the chase-list by MEASURING it, never by picking values that sound
// right. A list where half the entries are unreachable discourages; one cleared
// by season eight is empty.
//
// "Competent play" is defined operationally: every team runs itself, the same
// automation an unattended team already gets. That is a deliberately AVERAGE
// baseline — a real player should clear milestones somewhat faster, so tuning
// against it errs toward the list being achievable rather than punishing.
//
// Every team is measured as the user in turn, so no milestone is calibrated
// against one lucky franchise.
//
// Targets:
//   - every non-hidden milestone fires for at least one of the 30 careers
//   - none fires in more than ~60% of seasons (an achievement, not a
//     participation award)
//   - hidden ones stay rare, roughly one per 20+ seasons each
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');
const gmMilestones = rq('gmMilestones.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 30);
const TEAM_LIMIT = Number(process.env.TEAM_LIMIT || TEAMS.length);

function buildGameState(seed, userTeamId) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
             played: false, homeScore: null, awayScore: null, boxScore: null,
             isPlayoff: false, seriesId: null };
  });
  return {
    userTeamId: userTeamId, leagueYear: 2026, rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: DRAFT_PROSPECTS_2026,
    settings: { leagueYear: 2026, simEngine: 'possession', lotteryFormat: undefined },
    gmCareer: null
  };
}

const firstFire = {};
const everUnlocked = {};
// How close each career got by the END of its run, for milestones that never
// fired. Without this the probe cannot tell "nobody can ever do this" from "the
// run was too short to find out" — an 8-season run reported ten_seasons,
// twenty_five_seasons, thousand_wins and playoff_decade as UNREACHABLE, which
// would have sent me lowering thresholds that were never tested.
const bestFraction = {};
gmMilestones.MILESTONES.forEach(function (m) {
  firstFire[m.id] = []; everUnlocked[m.id] = 0; bestFraction[m.id] = 0;
});
let totalSeasons = 0;
let careers = 0;

TEAMS.slice(0, TEAM_LIMIT).forEach(function (userTeam, teamIndex) {
  const gs = buildGameState(4242 + teamIndex, userTeam.id);
  global.GameState = gs;   // history.js reads the browser global at season end
  careers += 1;

  for (let s = 0; s < SEASONS; s++) {
    const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
    for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
    gs.season.currentDay = lastDay;
    gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
    let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
    while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

    const before = gs.gmCareer ? gs.gmCareer.milestones.length : 0;
    rollover.runOffseasonRollover(gs, {});
    totalSeasons += 1;

    if (gs.gmCareer) {
      gs.gmCareer.milestones.slice(before).forEach(function (u) {
        firstFire[u.id].push(s + 1);
        everUnlocked[u.id] += 1;
      });
    }
  }

  // End-of-career progress, for the never-fired verdict.
  if (gs.gmCareer) {
    const ctx = gmMilestones.buildContext(gs.gmCareer, history.LEAGUE_HISTORY,
      PLAYERS_2026, history.LEAGUE_HISTORY.retiredPlayers, rq('ratings.js').toDisplayRating);
    gmMilestones.MILESTONES.forEach(function (m) {
      if (!m.progress) return;
      const p = m.progress(ctx);
      if (!p || !p.target) return;
      bestFraction[m.id] = Math.max(bestFraction[m.id], p.current / p.target);
    });
  }
});

function median(arr) {
  if (arr.length === 0) return null;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

console.log('GM MILESTONE CALIBRATION — ' + SEASONS + ' seasons x ' + careers + ' teams-as-user');
console.log('  every team self-managed, so this is AVERAGE play, not skilled play.\n');
console.log('  id                       family      hid  careers  median season  verdict');
gmMilestones.MILESTONES.forEach(function (m) {
  const hits = everUnlocked[m.id];
  const med = median(firstFire[m.id]);
  const sharePerSeason = hits / totalSeasons;
  let verdict = 'ok';
  if (hits === 0) {
    const frac = bestFraction[m.id];
    if (m.hidden) verdict = 'never (hidden: fine if rare by design)';
    else if (m.progress && frac >= 0.5) {
      verdict = 'not reached, but got to ' + (100 * frac).toFixed(0) + '% — RUN TOO SHORT to judge';
    } else if (m.progress) {
      verdict = 'UNREACHABLE — best career reached only ' + (100 * frac).toFixed(0) + '%';
    } else {
      verdict = 'never fired (binary — no progress signal, needs a longer run)';
    }
  } else if (sharePerSeason > 0.6) verdict = 'TOO EASY — raise it';
  else if (m.hidden && sharePerSeason > 0.05) verdict = 'hidden but common — raise it';
  console.log('  ' + m.id.padEnd(24) + ' ' + m.family.padEnd(10) + '  ' +
    (m.hidden ? 'y' : 'n') + '    ' + String(hits).padStart(3) + '/' + careers +
    '      ' + String(med === null ? '-' : med).padStart(6) + '        ' + verdict);
});
console.log('\n  total career-seasons simulated: ' + totalSeasons);

// A milestone can read 0% because it is too hard OR because this harness never
// produces the thing it measures. archiveTrade is called ONLY from script.js —
// the trade-offer acceptance path and the weekly AI-to-AI generator — and
// neither runs headlessly, so LEAGUE_HISTORY.trades stays empty here however
// long the run is. Without this line, traded_for_a_star reads as UNREACHABLE
// and someone lowers a threshold that was never tested.
if (history.LEAGUE_HISTORY.trades.length === 0) {
  console.log('\n  NOTE: zero trades were archived. archiveTrade only fires from script.js');
  console.log('  (UI trade acceptance + weekly AI-to-AI generation), neither of which runs');
  console.log('  headlessly. Any trade-dependent milestone above is UNCALIBRATED, not broken —');
  console.log('  its query is covered by validate-gmCareer against a hand-built archive.');
}
