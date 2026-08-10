// What a secret badge is actually WORTH, measured rather than assumed.
//
// A/B on identical seeds: the same player, the same league, the same schedule,
// with one badge at `legendary` and then at `secret`. Anything that moves is
// the badge, because nothing else differs.
//
// Run: node scripts/measure-secret-badge.js  [GAMES=400]
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
const ratings = rq('ratings.js');
const { makeRng } = rq('rng.js');
rq('simEngine.js'); rq('simEngineBoxScore.js'); rq('simEnginePossession.js');
const gameSim = rq('gameSim.js');

PLAYERS_2026.forEach(function (p) { ratings.defineOverall(p); });
traits.ensureHiddenPlayerData(PLAYERS_2026);

const GAMES = Number(process.env.GAMES || 400);

function seasonFor(subjectId, seed) {
  const rng = makeRng(seed);
  const acc = { g: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fga: 0, fgm: 0, pm: 0 };
  const league = { games: 0, pts: 0, fga: 0, fgm: 0 };
  for (let i = 0; i < GAMES; i++) {
    const home = TEAMS[i % TEAMS.length];
    const away = TEAMS[(i + 7 + (i % 13)) % TEAMS.length];
    if (home.id === away.id) continue;
    const r = gameSim.simulateGame(home.id, away.id, rng);
    league.games += 2;
    league.pts += r.homeScore + r.awayScore;
    Object.keys(r.boxScore).forEach(function (id) {
      const l = r.boxScore[id];
      league.fga += l.fga; league.fgm += l.fgm;
      if (id !== subjectId || !l.minutes) return;
      acc.g += 1; acc.min += l.minutes; acc.pts += l.points;
      acc.reb += l.rebounds; acc.ast += l.assists;
      acc.stl += l.steals; acc.blk += l.blocks;
      acc.fga += l.fga; acc.fgm += l.fgm; acc.pm += (l.plusMinus || 0);
    });
  }
  return { acc: acc, league: league };
}

function line(label, r) {
  const a = r.acc;
  if (!a.g) return label + ': never played';
  return label +
    '  ' + (a.pts / a.g).toFixed(1).padStart(5) + ' ppg' +
    '  ' + (a.reb / a.g).toFixed(1).padStart(4) + ' rpg' +
    '  ' + (a.ast / a.g).toFixed(1).padStart(4) + ' apg' +
    '  ' + (a.blk / a.g).toFixed(1).padStart(4) + ' bpg' +
    '  ' + (a.stl / a.g).toFixed(1).padStart(4) + ' spg' +
    '  ' + (a.min / a.g).toFixed(1).padStart(4) + ' mpg' +
    '  FG% ' + (100 * a.fgm / Math.max(1, a.fga)).toFixed(1) +
    '  +/- ' + (a.pm / a.g).toFixed(1);
}

// One subject per category of effect, so the report covers a scoring badge, a
// defensive one and a playmaking one rather than generalising from scoring.
const WANTED = ['sharpshooter', 'rimProtector', 'playmaker', 'alphaDog'];
const subjects = [];
WANTED.forEach(function (key) {
  const holder = PLAYERS_2026.find(function (p) {
    return (p.hiddenTraits || []).some(function (t) {
      return t.key === key && t.tier === 'legendary';
    });
  });
  if (holder) subjects.push({ key: key, player: holder });
});

console.log('=== what a secret badge is worth (' + GAMES + ' games per arm, identical seed) ===\n');
subjects.forEach(function (s) {
  const entry = s.player.hiddenTraits.find(function (t) { return t.key === s.key; });
  const def = traits.TRAIT_TAXONOMY_BY_KEY[s.key];
  const secretName = traits.SECRET_FORMS[s.key].name;

  entry.tier = 'legendary';
  const before = seasonFor(s.player.id, 4242);
  entry.tier = traits.SECRET_TIER;
  const after = seasonFor(s.player.id, 4242);
  entry.tier = 'legendary';   // restore, so subjects do not contaminate each other

  console.log(s.player.name + '  —  ' + def.name + ' -> ' + secretName +
    '   (' + def.effect.system + '/' + def.effect.stat +
    ', ' + def.tierValues.legendary + ' -> ' + def.tierValues[traits.SECRET_TIER] + ')');
  console.log(line('  legendary', before));
  console.log(line('  SECRET   ', after));
  const dp = (after.acc.pts / Math.max(1, after.acc.g)) - (before.acc.pts / Math.max(1, before.acc.g));
  const db = (after.acc.blk / Math.max(1, after.acc.g)) - (before.acc.blk / Math.max(1, before.acc.g));
  const da = (after.acc.ast / Math.max(1, after.acc.g)) - (before.acc.ast / Math.max(1, before.acc.g));
  console.log('  delta      ' + (dp >= 0 ? '+' : '') + dp.toFixed(2) + ' ppg   ' +
    (db >= 0 ? '+' : '') + db.toFixed(2) + ' bpg   ' + (da >= 0 ? '+' : '') + da.toFixed(2) + ' apg');
  console.log('  league     pts/team ' + (before.league.pts / before.league.games).toFixed(1) +
    ' -> ' + (after.league.pts / after.league.games).toFixed(1) +
    '   FG% ' + (100 * before.league.fgm / before.league.fga).toFixed(1) +
    ' -> ' + (100 * after.league.fgm / after.league.fga).toFixed(1));
  console.log('');
});
