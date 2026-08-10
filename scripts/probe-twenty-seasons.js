// Twenty seasons through the REAL pipeline — full schedule, playoffs, and
// runOffseasonRollover including free agency and roster enforcement. Same
// construction as gen-rollover-golden.js, which is the canonical multi-season
// harness; this one records league health instead of checksums.
//
// The question it exists to answer: does anything DRIFT? A league that reads
// well in 2026 and is unrecognisable by 2046 is a balance problem you only find
// by running it.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
const ratings = rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js');
const poss = rq('simEnginePossession.js');
// USAGE_CAP=n overrides PICK_CEILING.shooter for one run, so alternative
// settings can be measured without editing committed source — the shipped
// value stays whatever simEnginePossession.js says it is.
if (process.env.USAGE_CAP) {
  poss.PICK_CEILING.shooter = Number(process.env.USAGE_CAP);
  process.stderr.write('USAGE_CAP override: ' + poss.PICK_CEILING.shooter + '\n');
}
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const rollover = rq('seasonRollover.js');

history.ensureCareerData(PLAYERS_2026);
const SEASONS = Number(process.env.SEASONS || 20);

function buildGameState(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return {
      id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null
    };
  });
  return {
    userTeamId: 'BOS', leagueYear: 2026, rng: makeRng(seed),
    season: { games: games, currentDay: -1 },
    playoffBracket: null, offseasonStage: null, tradeOffers: [],
    upcomingDraftClass: DRAFT_PROSPECTS_2026,
    settings: { leagueYear: 2026, lotteryFormat: undefined }
  };
}

const everHit100 = new Set();

function pct(arr, q) {
  const s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Read BEFORE the rollover: generateNewSeason clears seasonStats.
function seasonReport(gs) {
  const ovr = PLAYERS_2026.map(function (p) { return p.overall; });
  const ages = PLAYERS_2026.map(function (p) { return p.age; });

  let fga = 0, fgm = 0, tpa = 0, tpm = 0, pts = 0, gp = 0;
  let bestPpg = 0, bestName = '', bestOvr = 0;
  PLAYERS_2026.forEach(function (p) {
    const s = p.seasonStats;
    if (!s || !s.gamesPlayed) return;
    fga += s.fga || 0; fgm += s.fgm || 0;
    tpa += s.tpa || 0; tpm += s.tpm || 0;
    pts += s.points || 0; gp += s.gamesPlayed;
    if (s.gamesPlayed >= 40) {
      const ppg = s.points / s.gamesPlayed;
      if (ppg > bestPpg) { bestPpg = ppg; bestName = p.name; bestOvr = p.overall; }
    }
  });

  // "max OVR is 100 again this season" is NOT the same claim as "another 100
  // was created this season" — a player who gets there holds the top of the
  // table for years afterwards. Reading the max alone made a handful of
  // all-time greats look like an annual event. So count both: how many are at
  // 100 right now, and how many DISTINCT players have ever reached it.
  PLAYERS_2026.forEach(function (p) { if (p.overall >= 100) everHit100.add(p); });
  const at100 = PLAYERS_2026.filter(function (p) { return p.overall >= 100; }).length;

  const secretHolders = PLAYERS_2026.filter(function (p) {
    return (p.hiddenTraits || []).some(function (t) { return t.tier === traits.SECRET_TIER; });
  });
  const traitCounts = PLAYERS_2026.map(function (p) { return (p.hiddenTraits || []).length; });

  // pts per team-game: total league points over total team-games played.
  const teamGames = gs.season.games.filter(function (g) { return g.played; }).length * 2;

  return {
    players: PLAYERS_2026.length,
    ovrMin: Math.min.apply(null, ovr),
    ovrMed: pct(ovr, 0.5),
    ovrMax: Math.max.apply(null, ovr),
    n90: ovr.filter(function (v) { return v >= 90; }).length,
    n85: ovr.filter(function (v) { return v >= 85; }).length,
    ageMean: ages.reduce(function (a, c) { return a + c; }, 0) / ages.length,
    old: ages.filter(function (a) { return a >= 34; }).length,
    rookies: ages.filter(function (a) { return a <= 21; }).length,
    fgPct: fga ? 100 * fgm / fga : 0,
    tpPct: tpa ? 100 * tpm / tpa : 0,
    tpaShare: fga ? 100 * tpa / fga : 0,
    ptsPerTeam: teamGames ? pts / teamGames : 0,
    topScorer: bestName, topPpg: bestPpg, topScorerOvr: bestOvr,
    at100: at100, ever100: everHit100.size,
    secret: secretHolders.length,
    traitsPerPlayer: traitCounts.reduce(function (a, c) { return a + c; }, 0) / traitCounts.length
  };
}

const gs = buildGameState(4242);
console.log('yr  players  OVR min/med/max  90+ 85+   age  34+  rook   FG%   3P%  3PA%  pts  @100 ever secret traits   top scorer');
for (let s = 0; s < SEASONS; s++) {
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;
  // Captured BEFORE the playoffs. seasonStats keep accumulating through the
  // postseason, so dividing those points by the REGULAR-season game count
  // inflates pts/team — my first cut read 110.5 where the true regular-season
  // figure is lower. Rates have to be read off the same games they came from.
  const regularSeasonReport = seasonReport(gs);
  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);

  const r = regularSeasonReport;
  console.log(
    String(gs.leagueYear).slice(2) + '  ' +
    String(r.players).padStart(5) + '   ' +
    String(r.ovrMin).padStart(3) + '/' + String(r.ovrMed).padStart(3) + '/' + String(r.ovrMax).padStart(3) + '  ' +
    String(r.n90).padStart(3) + ' ' + String(r.n85).padStart(3) + '  ' +
    r.ageMean.toFixed(1).padStart(4) + ' ' + String(r.old).padStart(3) + '  ' + String(r.rookies).padStart(4) + '  ' +
    r.fgPct.toFixed(1).padStart(5) + ' ' + r.tpPct.toFixed(1).padStart(5) + ' ' + r.tpaShare.toFixed(1).padStart(5) + ' ' +
    r.ptsPerTeam.toFixed(1).padStart(5) + '  ' +
    String(r.at100).padStart(4) + String(r.ever100).padStart(5) + '   ' +
    String(r.secret).padStart(3) + '   ' + r.traitsPerPlayer.toFixed(2) + '   ' +
    r.topScorer + ' ' + r.topPpg.toFixed(1) + ' (' + r.topScorerOvr + ')');

  rollover.runOffseasonRollover(gs, {});
}
