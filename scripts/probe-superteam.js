// What happens when you put two superstars on one roster?
//
// Runs the REAL pipeline — full schedule, playoffs, awards, offseason rollover
// with free agency and the draft — exactly as scripts/probe-twenty-seasons.js
// does, and reports the pairing's career instead of league health.
//
// PAIR=1 swaps a target player onto the anchor's team on day one and RE-PAIRS
// them every offseason if free agency separates them (counted and reported,
// because "the league kept trying to break them up" is itself a finding).
// PAIR=0 runs the identical seed with no swap at all. The two runs are the
// treatment and the control; without the control there is no way to tell a
// superteam effect from the seed.
//
// PLAYERS_2026 is a module-level singleton, so treatment and control must run
// in SEPARATE processes. Do not try to run both in one.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS, getTeamById } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const { DRAFT_PROSPECTS_2026 } = rq('draftProspects.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
traits.ensureHiddenPlayerData(DRAFT_PROSPECTS_2026);
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
rq('gameCoach.js'); rq('gameSim.js');
const history = rq('history.js');
const awards = rq('awards.js');
const league = rq('league.js');
const schedule = rq('schedule.js');
const playoffs = rq('playoffs.js');
const draft = rq('draft.js');
const rollover = rq('seasonRollover.js');

history.ensureCareerData(PLAYERS_2026);

const SEASONS = Number(process.env.SEASONS || 10);
const SEED = Number(process.env.SEED || 4242);
const PAIR = process.env.PAIR !== '0';
const ANCHOR_ID = process.env.ANCHOR || 'mil-giannis-antetokounmpo';
const TARGET_ID = process.env.TARGET || 'sas-victor-wembanyama';
// The player sent back so both rosters keep their original size. Chosen for
// position parity (a centre for a centre), not for value parity — this is not
// a trade-fairness experiment.
const RETURN_ID = process.env.RETURN || 'mil-myles-turner';

function byId(id) { return PLAYERS_2026.find(function (p) { return p.id === id; }); }

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

// Move `mover` to `destTeamId`, sending the closest-overall player on that team
// back the other way so neither roster changes size. `protect` is never sent.
let repairs = 0;
function swapOnto(mover, destTeamId, protect) {
  const fromTeamId = mover.teamId;
  if (fromTeamId === destTeamId) return null;
  const candidates = league.getTeamRoster(destTeamId).filter(function (p) {
    return p.id !== protect.id && p.id !== mover.id;
  });
  if (candidates.length === 0) { mover.teamId = destTeamId; return null; }
  const back = candidates.sort(function (a, b) {
    return Math.abs(a.overall - mover.overall) - Math.abs(b.overall - mover.overall);
  })[0];
  mover.teamId = destTeamId;
  back.teamId = fromTeamId;
  return back;
}

const anchor0 = byId(ANCHOR_ID);
const target0 = byId(TARGET_ID);
const ret0 = byId(RETURN_ID);
if (!anchor0 || !target0) throw new Error('anchor/target not found');
const HOME_TEAM = anchor0.teamId;
const AWAY_TEAM = target0.teamId;

if (PAIR) {
  if (!ret0) throw new Error('return player not found');
  target0.teamId = HOME_TEAM;
  ret0.teamId = AWAY_TEAM;
  process.stderr.write('PAIRED: ' + target0.name + ' -> ' + HOME_TEAM +
    ', ' + ret0.name + ' -> ' + AWAY_TEAM + '\n');
} else {
  process.stderr.write('CONTROL: no swap\n');
}

// Where a team finished. Uses draft.js's playoffResultByTeam — the shipped
// classifier the draft order itself is built from — rather than a second
// reading of the bracket that could disagree with it. It returns the round a
// team was eliminated in: 0 = lost round 1 .. 3 = lost the Finals, 4 = won.
const ELIM_LABEL = ['lost R1', 'lost CSF', 'lost CF', 'lost Finals', 'CHAMPION'];
function playoffFinish(bracket, teamId) {
  if (!bracket || !bracket.finals[0]) return 'missed';
  const byTeam = draft.playoffResultByTeam(bracket);
  const r = byTeam[teamId];
  return r === undefined ? 'missed' : ELIM_LABEL[r];
}

function line(p) {
  if (!p) return null;
  const s = p.seasonStats;
  if (!s || !s.gamesPlayed) return null;
  const g = s.gamesPlayed;
  return {
    gp: g, ovr: p.overall, age: p.age, team: p.teamId,
    ppg: s.points / g, rpg: s.rebounds / g, apg: s.assists / g,
    bpg: s.blocks / g, fgPct: s.fga ? 100 * s.fgm / s.fga : 0
  };
}

function fmt(l) {
  if (!l) return '     -                            ';
  return (l.team + ' ovr' + String(l.ovr).padStart(3) + ' a' + String(l.age).padStart(2) +
    ' ' + l.ppg.toFixed(1).padStart(5) + 'p' +
    l.rpg.toFixed(1).padStart(5) + 'r' +
    l.apg.toFixed(1).padStart(4) + 'a' +
    l.bpg.toFixed(1).padStart(4) + 'b');
}

const rows = [];
const gs = buildGameState(SEED);

for (let s = 0; s < SEASONS; s++) {
  const year = gs.leagueYear;
  const lastDay = gs.season.games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) league.simulateDate(gs.season, d, gs.settings, gs.rng, null, null);
  gs.season.currentDay = lastDay;

  const anchor = byId(ANCHOR_ID);
  const target = byId(TARGET_ID);
  // Read BEFORE the rollover: generateNewSeason clears seasonStats, and
  // finalizeSeasonHistory folds team.record into allTime and resets it.
  const aLine = line(anchor);
  const tLine = line(target);
  const pairTeamId = anchor ? anchor.teamId : (target ? target.teamId : null);
  const together = !!(anchor && target && anchor.teamId === target.teamId);
  const watchTeam = getTeamById(pairTeamId || HOME_TEAM);
  const record = watchTeam ? watchTeam.record.wins + '-' + watchTeam.record.losses : '--';
  const otherTeam = getTeamById(AWAY_TEAM);
  const otherRecord = otherTeam ? otherTeam.record.wins + '-' + otherTeam.record.losses : '--';

  // Every team's regular-season wins, read BEFORE the playoffs and before the
  // rollover folds record into allTime. Used to ask how often the best team in
  // the league actually wins it — a 63-win team losing in round one is one
  // story, but it only means something against the league-wide rate.
  const standings = TEAMS.map(function (t) { return { id: t.id, w: t.record.wins }; })
    .sort(function (a, b) { return b.w - a.w; });

  gs.playoffBracket = playoffs.generateBracket(gs.rng, gs.settings);
  let g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  while (g !== null) g = playoffs.simulateNextPlayoffGame(gs.playoffBracket, gs.settings, gs.rng);
  const finish = playoffFinish(gs.playoffBracket, pairTeamId || HOME_TEAM);
  const otherFinish = playoffFinish(gs.playoffBracket, AWAY_TEAM);
  const champId = gs.playoffBracket.finals[0] ? gs.playoffBracket.finals[0].winner : null;
  // The first cut of this probe read the wrong field names off the series and
  // silently reported "missed" for all 30 teams, champion included. A reader
  // that cannot see the champion cannot see anything — check it every season.
  assert.strictEqual(playoffFinish(gs.playoffBracket, champId), 'CHAMPION',
    'the champion must classify as CHAMPION in ' + year);
  assert.strictEqual(Object.keys(draft.playoffResultByTeam(gs.playoffBracket)).length, 16,
    'exactly 16 teams should have a playoff result in ' + year);

  rollover.runOffseasonRollover(gs, {});

  // Awards land during the rollover, in finalizeSeasonHistory.
  const ah = history.LEAGUE_HISTORY.awardsHistory;
  const thisYear = ah[ah.length - 1];
  function awardsFor(id) {
    if (!thisYear) return [];
    return thisYear.winners.filter(function (w) { return w.playerId === id; })
      .map(function (w) { return w.award; });
  }

  // Re-pair if the offseason split them (or if one changed teams).
  let repairedThisYear = false;
  if (PAIR) {
    const a2 = byId(ANCHOR_ID), t2 = byId(TARGET_ID);
    if (a2 && t2 && a2.teamId !== t2.teamId) {
      swapOnto(t2, a2.teamId, a2);
      repairs++;
      repairedThisYear = true;
    }
  }

  const champRank = standings.findIndex(function (t) { return t.id === champId; }) + 1;
  const bestWins = standings[0].w;
  const champWins = champRank ? standings[champRank - 1].w : 0;

  rows.push({
    champRank: champRank, bestWins: bestWins, champWins: champWins,
    standings: standings,
    year: year, record: record, finish: finish, together: together,
    otherRecord: otherRecord, otherFinish: otherFinish,
    champId: champId, anchor: aLine, target: tLine,
    anchorAwards: awardsFor(ANCHOR_ID), targetAwards: awardsFor(TARGET_ID),
    anchorGone: !byId(ANCHOR_ID), targetGone: !byId(TARGET_ID),
    repaired: repairedThisYear
  });
}

const A = anchor0.name, T = target0.name;
console.log('=== ' + (PAIR ? 'PAIRED' : 'CONTROL') + '  seed ' + SEED + '  ' + SEASONS + ' seasons ===');
console.log(A + ' + ' + T + (PAIR ? ' on ' + HOME_TEAM : ' apart'));
console.log('');
console.log('year  team    record  postseason    | ' + A.split(' ').pop().padEnd(28) +
  '| ' + T.split(' ').pop().padEnd(28) + '| champ  awards');
rows.forEach(function (r) {
  const aw = r.anchorAwards.map(function (x) { return 'A:' + x; })
    .concat(r.targetAwards.map(function (x) { return 'T:' + x; })).join(' ');
  console.log(
    r.year + '  ' + String(r.anchor ? r.anchor.team : '--').padEnd(5) +
    ' ' + r.record.padStart(7) + '  ' + r.finish.padEnd(13) + ' | ' +
    fmt(r.anchor).padEnd(30) + '| ' + fmt(r.target).padEnd(30) + '| ' +
    String(r.champId || '--').padEnd(5) + '  ' + aw +
    (r.anchorGone ? '  [ANCHOR RETIRED]' : '') +
    (r.targetGone ? '  [TARGET RETIRED]' : '') +
    (r.repaired ? '  [re-paired]' : '') +
    (PAIR && !r.together && !r.anchorGone && !r.targetGone ? '  [SPLIT]' : ''));
});

const titles = rows.filter(function (r) { return r.finish === 'CHAMPION'; }).length;
const wins = rows.reduce(function (a, r) { return a + Number(r.record.split('-')[0]); }, 0);
const gamesPlayed = rows.reduce(function (a, r) {
  const p = r.record.split('-'); return a + Number(p[0]) + Number(p[1]);
}, 0);
console.log('');
console.log('pair team: ' + titles + ' titles, ' + wins + '-' + (gamesPlayed - wins) +
  ' (' + (100 * wins / Math.max(1, gamesPlayed)).toFixed(1) + '%) over ' + SEASONS + ' seasons');
console.log('other team (' + AWAY_TEAM + '): ' +
  rows.map(function (r) { return r.otherRecord + '/' + r.otherFinish; }).join('  '));
if (PAIR) console.log('offseason re-pairs needed: ' + repairs);

// How much does being the best regular-season team buy you? A league where the
// champion's seeding is uniform over the 16 playoff teams is a coin flip
// wearing a bracket; one where the 1-seed wins most years has no drama left.
console.log('');
console.log('champion league-wide rank (1 = best record):  ' +
  rows.map(function (r) { return r.champRank; }).join(' '));
const rank1 = rows.filter(function (r) { return r.champRank === 1; }).length;
const top3 = rows.filter(function (r) { return r.champRank <= 3; }).length;
console.log('  best record won it ' + rank1 + '/' + rows.length +
  ', a top-3 record won it ' + top3 + '/' + rows.length +
  ' (16 of 30 teams make the playoffs, so a pure coin flip is ' +
  (rows.length / 16).toFixed(1) + '/' + rows.length + ' for any one seed)');
console.log('  champion wins vs league-best wins: ' +
  rows.map(function (r) { return r.champWins + '/' + r.bestWins; }).join('  '));
// Did the league's best team even reach the Finals?
console.log('  mean champion rank ' +
  (rows.reduce(function (a, r) { return a + r.champRank; }, 0) / rows.length).toFixed(1) +
  ' (a coin flip among 16 playoff teams averages ~8.5)');
