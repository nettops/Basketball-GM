// How often does a GM who always gives his word actually keep it?
//
// A promise system has two failure modes and they look identical from the
// code: one where every promise is kept (the old free button, with a delay) and
// one where every promise is broken (a tax on talking). Both would pass every
// validator in scripts/validate-gmPromises.js, which only proves each verdict
// is REACHABLE. This measures which one the league actually produces.
//
// Also measures the number PROMISE_TUNING.helpRatingGain is set from: how much
// the second-best man on a roster moves over a 45-day window when nobody does
// anything about it. If that drift is at or above the bar, "we got him help"
// is kept by the calendar.
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
const ds = rq('dialogueScenes.js');
const owner = rq('owner.js');
const rivalries = rq('rivalries.js');
const gmCareer = rq('gmCareer.js');
const promises = rq('gmPromises.js');
const { makeRng } = rq('rng.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);

const MID_SEASON_SCENE_GAP_DAYS = 8;   // mirrors ui/simControls.js
const SEEDS = [4242, 555, 8888, 1717, 96];
const TEAM = process.env.TEAM || 'BOS';

function secondBest(teamId) {
  const r = league.getActiveRoster(teamId).slice().sort(function (a, b) {
    return (b.rawOverall || 0) - (a.rawOverall || 0);
  });
  return r.length > 1 ? (r[1].rawOverall || 0) : 0;
}

// The one choice in a scene that gives your word, if it has one.
function promisingChoice(scene, ctx) {
  for (let i = 0; i < scene.choices.length; i++) {
    const c = scene.choices[i];
    if (typeof c.effect !== 'function') continue;
    let d = null;
    try { d = c.effect(ctx); } catch (e) { continue; }
    if (d && d.promise) return c;
  }
  return null;
}


// A postgame sim, reconstructed from the recorded game. league.simulateDate
// hands back no per-game object, and the postgame scenes are half the promise
// surface — star-carried-a-loss is where "we will get him help" is said — so a
// probe that only ran the mid-season gate would report two of the four kinds
// as unreachable when they are simply unvisited.
function simFromGame(g) {
  const homeRoster = league.getTeamRoster(g.homeTeamId);
  const awayRoster = league.getTeamRoster(g.awayTeamId);
  const box = g.boxScore || {};
  const side = function (roster) {
    const o = {};
    roster.forEach(function (p) { if (box[p.id]) o[p.id] = box[p.id]; });
    return o;
  };
  return {
    homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
    homeScore: g.homeScore, awayScore: g.awayScore,
    homeBox: side(homeRoster), awayBox: side(awayRoster),
    homeRoster: homeRoster, awayRoster: awayRoster,
    periodScores: g.periodScores || null
  };
}

function runSeason(seed) {
  const games = schedule.generateSeasonGames(makeRng(seed), TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false,
      homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  TEAMS.forEach(function (t) { t.record = { wins: 0, losses: 0 }; });
  const team = TEAMS.filter(function (t) { return t.id === TEAM; })[0];
  team.ownerHappiness = 50;

  const gs = {
    userTeamId: TEAM,
    leagueYear: 2026,
    settings: { capLevel: 1, leagueYear: 2026 },
    season: { games: games, currentDay: -1 },
    rng: makeRng(seed),
    gmCareer: gmCareer.createGmCareer
      ? gmCareer.createGmCareer('Probe GM', TEAM, 2026) : { name: 'Probe GM' },
    gmPromises: [],
    seasonSceneDays: {}, seasonSceneCounts: {}, lastMidSeasonSceneDay: null,
    recentDialogueScenes: [],
    rivalries: rivalries.createRivalryState ? rivalries.createRivalryState() : {}
  };
  if (owner.setMandate) owner.setMandate(gs, team, league.getTeamRoster(TEAM), makeRng(seed), {});
  if (rivalries.addHeat) {
    rivalries.addHeat(gs.rivalries, TEAM, TEAM === 'LAL' ? 'BOS' : 'LAL', rivalries.RIVALRY_THRESHOLD + 5);
  }

  const simRng = makeRng(seed);
  const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  const ownerStart = team.ownerHappiness;
  const made = [];
  const settled = [];
  // Drift samples: the second-best rating today against 45 days ago, taken on
  // every club so one team's quiet season is not the whole finding.
  const driftWindow = promises.PROMISE_TUNING.helpWindowDays;
  const driftHistory = {};
  const drifts = [];
  const moodWatch = {};

  for (let d = 0; d <= lastDay; d++) {
    league.simulateDate(gs.season, d, gs.settings, simRng, null, null);
    gs.season.currentDay = d;

    TEAMS.forEach(function (t) {
      if (!driftHistory[t.id]) driftHistory[t.id] = [];
      driftHistory[t.id].push(secondBest(t.id));
      const h = driftHistory[t.id];
      if (h.length > driftWindow) drifts.push(h[h.length - 1] - h[h.length - 1 - driftWindow]);
    });

    // How a man who has fallen into the unhappy band actually recovers, if he
    // does. Sampled league-wide, because "keep him AND fix him" is only a real
    // promise if the fixing is reachable — and the one thing the probe GM
    // cannot do is trade for a better mood.
    league.getActiveRoster(TEAM).forEach(function (p) {
      const m = p.status && p.status.morale;
      if (typeof m !== 'number') return;
      if (m < 40 && moodWatch[p.id] === undefined) moodWatch[p.id] = { from: d, morale: m };
    });

    settled.push.apply(settled, promises.settlePromises(gs, { day: d }));

    // --- postgame, first: it is the moment the user would actually see ---
    gs.season.games.forEach(function (g) {
      if (g.day !== d || !g.played) return;
      if (g.homeTeamId !== TEAM && g.awayTeamId !== TEAM) return;
      const pctx = dc.buildPostgameContext(gs, simFromGame(g));
      const pscene = ds.selectScene(pctx, { recent: gs.recentDialogueScenes || [], rand: gs.rng });
      if (!pscene || pscene.id === ds.FALLBACK_SCENE_ID) return;
      dc.pushRecentScene(gs, pscene.id);
      const pchoice = promisingChoice(pscene, pctx);
      if (!pchoice) return;
      const n = promises.promises(gs).length;
      dc.applyDialogueEffect(gs, pchoice.effect(pctx), pctx);
      if (promises.promises(gs).length > n) {
        made.push({ day: d, kind: promises.promises(gs)[promises.promises(gs).length - 1].kind });
      }
    });

    const last = gs.lastMidSeasonSceneDay;
    if (last !== null && last !== undefined && d - last < MID_SEASON_SCENE_GAP_DAYS) continue;
    const ctx = dc.buildSeasonContext(gs);
    const scene = ds.selectScene(ctx, { recent: dc.recentSeasonScenes(gs), rand: gs.rng });
    if (!scene || scene.id === ds.FALLBACK_SCENE_ID) continue;
    dc.stampSeasonScene(gs, scene.id);
    gs.lastMidSeasonSceneDay = d;
    // A GM who says yes to everything: the upper bound on how much of this
    // system a player can possibly meet in one season.
    const choice = promisingChoice(scene, ctx);
    if (!choice) continue;
    const before = promises.promises(gs).length;
    dc.applyDialogueEffect(gs, choice.effect(ctx), ctx);
    if (promises.promises(gs).length > before) {
      made.push({ day: d, kind: promises.promises(gs)[promises.promises(gs).length - 1].kind });
    }
  }
  const atEnd = promises.settlePromises(gs, { seasonEnd: true, day: lastDay });
  settled.push.apply(settled, atEnd);

  const recoveries = Object.keys(moodWatch).map(function (id) {
    const p = league.getActiveRoster(TEAM).filter(function (x) { return x.id === id; })[0];
    if (!p) return null;
    return { days: lastDay - moodWatch[id].from, from: moodWatch[id].morale,
             to: p.status.morale };
  }).filter(function (r) { return r; });

  return {
    made: made, settled: settled, drifts: drifts, recoveries: recoveries,
    mandateType: gs.ownerMandate ? gs.ownerMandate.type : '(none)',
    ownerSwing: team.ownerHappiness - ownerStart,
    stillOpen: promises.openPromises(gs).length
  };
}

function pct(n, d) { return d ? (100 * n / d).toFixed(0) + '%' : '-'; }
function pctl(a, p) {
  if (!a.length) return 0;
  const s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

console.log('GM promises, team ' + TEAM + ', one regular season per seed,');
console.log('with a GM who takes every promising answer he is offered.\n');

const byKind = {};
let totalMade = 0, totalKept = 0, totalBroken = 0, swing = 0;
const allDrifts = [];
const allRecoveries = [];
let lastMandate = '(none)';

SEEDS.forEach(function (seed) {
  const r = runSeason(seed);
  totalMade += r.made.length;
  swing += r.ownerSwing;
  allDrifts.push.apply(allDrifts, r.drifts);
  allRecoveries.push.apply(allRecoveries, r.recoveries);
  lastMandate = r.mandateType;
  r.settled.forEach(function (s) {
    const k = s.promise.kind;
    if (!byKind[k]) byKind[k] = { kept: 0, broken: 0 };
    byKind[k][s.verdict]++;
    if (s.verdict === 'kept') totalKept++; else totalBroken++;
  });
  console.log('  seed ' + String(seed).padEnd(6) +
    ' [' + r.mandateType + '] made ' + String(r.made.length).padStart(2) +
    '  settled ' + String(r.settled.length).padStart(2) +
    '  owner ' + (r.ownerSwing >= 0 ? '+' : '') + r.ownerSwing +
    '  (' + (r.made.length
      ? r.made.map(function (m) { return 'd' + m.day + ':' + m.kind; }).join(' ')
      : 'gave his word to nobody') + ')');
});

console.log('\n  per season: ' + (totalMade / SEEDS.length).toFixed(1) + ' promises made, ' +
  ((totalKept + totalBroken) / SEEDS.length).toFixed(1) + ' settled');
console.log('  kept ' + totalKept + ' (' + pct(totalKept, totalKept + totalBroken) + '), ' +
  'broken ' + totalBroken + ' (' + pct(totalBroken, totalKept + totalBroken) + ')');
console.log('  mean owner swing across a season of promising: ' +
  (swing / SEEDS.length).toFixed(1) + ' points\n');

console.log('  by kind:');
Object.keys(byKind).sort().forEach(function (k) {
  const b = byKind[k];
  console.log('    ' + k.padEnd(14) + ' kept ' + String(b.kept).padStart(2) +
    '  broken ' + String(b.broken).padStart(2) + '   (' + pct(b.kept, b.kept + b.broken) + ' kept)');
});
const never = Object.keys(promises.PROMISE_KINDS).filter(function (k) { return !byKind[k]; });
if (never.length) {
  console.log('    never settled at all: ' + never.join(', '));
  // Not a defect in the ledger. mandate-run is only sayable in
  // mandate-slipping, and that scene is deliberately rare: it needs a WINS
  // mandate (8 of the 30 clubs draw one) AND a collapse — more wins still
  // needed than three quarters of the games left can give. Measured across
  // five seasons on a wins-mandate club, it did not fire once. Its judging is
  // covered directly in scripts/validate-gmPromises.js instead.
  if (never.indexOf('mandate-run') !== -1) {
    console.log('      mandate-run rides mandate-slipping, which needs a wins mandate AND a');
    console.log('      collapse. This club\'s last mandate: "' + lastMandate + '".');
  }
}

console.log('\n  second-best rating drift over a ' + promises.PROMISE_TUNING.helpWindowDays +
  '-day window, all 30 clubs, ' + allDrifts.length + ' samples:');
console.log('    p50 ' + pctl(allDrifts, 0.5).toFixed(1) +
  '   p90 ' + pctl(allDrifts, 0.9).toFixed(1) +
  '   p99 ' + pctl(allDrifts, 0.99).toFixed(1) +
  '   max ' + Math.max.apply(null, allDrifts.concat([0])).toFixed(1));
console.log('    PROMISE_TUNING.helpRatingGain = ' + promises.PROMISE_TUNING.helpRatingGain +
  ' — the bar "we got him help" has to clear.');

console.log('\n  men who fell into the unhappy band (<40) and where they finished,');
console.log('  with a GM who did nothing about it — ' + allRecoveries.length + ' samples:');
if (allRecoveries.length) {
  const ends = allRecoveries.map(function (r) { return r.to; });
  console.log('    end morale  p10 ' + pctl(ends, 0.1).toFixed(0) +
    '   p50 ' + pctl(ends, 0.5).toFixed(0) +
    '   p90 ' + pctl(ends, 0.9).toFixed(0) +
    '   max ' + Math.max.apply(null, ends).toFixed(0));
  // This is why 'keep-him' no longer judges the mood. Whatever bar you pick,
  // nobody clears it.
  [40, 45, 50, 55, 60].forEach(function (bar) {
    const n = ends.filter(function (m) { return m >= bar; }).length;
    console.log('      back above ' + String(bar).padStart(2) + ': ' + pct(n, ends.length));
  });
}
