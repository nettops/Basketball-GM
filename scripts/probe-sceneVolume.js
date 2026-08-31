// How many mid-season conversations does a GM actually get?
//
// The audit guessed three, from SEASON_SCENE_MAX_PER_SEASON = 2, and was wrong
// twice over: that cap is per SCENE ID, and the binding constraint is a
// different constant entirely (MID_SEASON_SCENE_GAP_DAYS = 8 in
// ui/simControls.js). This measures instead of guessing.
//
// It replicates maybeRunMidSeasonScene's gate exactly — the 8-day global gap,
// recentSeasonScenes for cooldown and per-scene cap, and the refusal of the
// fallback scene — without needing a DOM, because every piece of that gate is
// a plain function.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js'); rq('coaches.js'); rq('simEngine.js'); rq('simEngineBoxScore.js');
rq('simEnginePossession.js'); rq('gameCoach.js'); rq('gameSim.js');
const league = rq('league.js'); const schedule = rq('schedule.js');
const dc = rq('dialogueContext.js');
const owner = rq('owner.js');
const rivalries = rq('rivalries.js');
const ds = rq('dialogueScenes.js');
const gmCareer = rq('gmCareer.js');
const { makeRng } = rq('rng.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);

const MID_SEASON_SCENE_GAP_DAYS = 8;   // mirrors ui/simControls.js:200
const SEEDS = [4242, 555, 8888];
const TEAM = process.env.TEAM || 'BOS';

function runSeason(seed) {
  // Reset the per-season stamps the way script.js does at season start.
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false,
      homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  TEAMS.forEach(function (t) { t.record = { wins: 0, losses: 0 }; });
  const gs = {
    userTeamId: TEAM,
    leagueYear: 2026,
    season: { games: games, currentDay: -1 },
    rng: makeRng(seed),
    gmCareer: gmCareer.createGmCareer ? gmCareer.createGmCareer('Probe GM', TEAM, 2026) : { name: 'Probe GM' },
    seasonSceneDays: {},
    seasonSceneCounts: {},
    lastMidSeasonSceneDay: null,
    rivalries: rivalries.createRivalryState ? rivalries.createRivalryState() : {}
  };
  // The first run of this probe set neither of these and then reported five
  // scenes as "never fires". Three of the five gate on exactly them:
  // mandate-slipping and outside-looking-in need an owner mandate, rivalry-heat
  // needs a rival. A harness that omits half the state measures the harness.
  const team = TEAMS.filter(function (t) { return t.id === TEAM; })[0];
  if (owner.setMandate) {
    owner.setMandate(gs, team, league.getTeamRoster(TEAM), makeRng(seed), {});
  }
  if (rivalries.addHeat) {
    // A rivalry the way seasonRollover makes one: a playoff series behind you.
    rivalries.addHeat(gs.rivalries, TEAM, TEAM === 'LAL' ? 'BOS' : 'LAL', rivalries.RIVALRY_THRESHOLD + 5);
  }
  const simRng = makeRng(seed);
  const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);

  const fired = [];
  let eligibleDays = 0, matchedNothing = 0;
  for (let d = 0; d <= lastDay; d++) {
    league.simulateDate(gs.season, d, { leagueYear: 2026 }, simRng, null, null);
    gs.season.currentDay = d;

    // --- the gate, as maybeRunMidSeasonScene applies it ---
    const last = gs.lastMidSeasonSceneDay;
    if (last !== null && last !== undefined && d - last < MID_SEASON_SCENE_GAP_DAYS) continue;
    eligibleDays++;
    const ctx = dc.buildSeasonContext(gs);
    const scene = ds.selectScene(ctx, { recent: dc.recentSeasonScenes(gs), rand: gs.rng });
    if (!scene || scene.id === ds.FALLBACK_SCENE_ID) { matchedNothing++; continue; }
    dc.stampSeasonScene(gs, scene.id);
    gs.lastMidSeasonSceneDay = d;
    fired.push({ day: d, id: scene.id });
  }
  return { fired: fired, eligibleDays: eligibleDays, matchedNothing: matchedNothing, lastDay: lastDay };
}

console.log('Mid-season scene volume, team ' + TEAM + ', one regular season each\n');
let totalFired = 0;
const idCounts = {};
SEEDS.forEach(function (seed) {
  const r = runSeason(seed);
  totalFired += r.fired.length;
  r.fired.forEach(function (f) { idCounts[f.id] = (idCounts[f.id] || 0) + 1; });
  const ceiling = Math.floor(r.lastDay / MID_SEASON_SCENE_GAP_DAYS);
  console.log('  seed ' + String(seed).padEnd(6) +
    ' fired ' + String(r.fired.length).padStart(2) +
    '  of ~' + ceiling + ' the 8-day gap allows' +
    '   (checked on ' + r.eligibleDays + ' days, ' + r.matchedNothing + ' found nothing to say)');
  console.log('           ' + (r.fired.length
    ? r.fired.map(function (f) { return 'd' + f.day + ':' + f.id; }).join('  ')
    : '(silent all season)'));
});

console.log('\n  mean per season: ' + (totalFired / SEEDS.length).toFixed(1));
console.log('\n  which conversations actually happen:');
Object.keys(idCounts).sort(function (a, b) { return idCounts[b] - idCounts[a]; })
  .forEach(function (id) { console.log('    ' + String(idCounts[id]) + 'x  ' + id); });
const seasonScenes = ds.SCENES.filter(function (s) { return s.moment === 'season'; });
const unused = seasonScenes.filter(function (s) { return !idCounts[s.id]; });
console.log('\n  ' + (seasonScenes.length - unused.length) + ' of ' + seasonScenes.length +
  ' season scenes ever fired. Never seen:');
unused.forEach(function (s) { console.log('    ' + s.id); });
