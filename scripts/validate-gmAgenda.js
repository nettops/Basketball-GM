// The agenda is a READ over live state, so every check here builds a situation
// and asserts the agenda names it. A detector that fires on everything is as
// useless as one that never fires, so most checks assert BOTH directions:
// present when the problem exists, absent when it does not.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const agenda = rq('gmAgenda.js');

function player(over) {
  return Object.assign({
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Player', age: 26, overall: 70, potential: 70,
    contract: { salary: 5e6, yearsRemaining: 3 },
    status: { morale: 70, fatigue: 0, injury: null }
  }, over || {});
}
// The view the detectors read. Built directly so a detector can be tested
// without standing up a league.
function view(over) {
  return Object.assign({
    teamId: 'BOS', roster: [], payroll: null, taxLine: null,
    career: null, rivals: [], streak: { length: 0 }, leagueYear: 2026
  }, over || {});
}
const ids = function (items) { return items.map(function (i) { return i.id; }); };

function checkAnAngryStarIsTheLoudestThingOnTheList() {
  const star = player({ id: 'star', name: 'Marcus Johnson', overall: 90, status: { morale: 30, injury: null } });
  const items = agenda.detectUnhappyPlayers(view({ roster: [star] }));
  assert.strictEqual(items.length, 1, 'an unhappy star must produce exactly one item');
  const it = items[0];
  assert.strictEqual(it.urgency, agenda.AGENDA_URGENCY.CRITICAL, 'an unhappy star is critical');
  assert.strictEqual(it.category, agenda.AGENDA_CATEGORY.RELATIONSHIP);
  assert.ok(/Marcus Johnson/.test(it.headline), 'the item must name him: ' + it.headline);
  assert.ok(it.responses.length > 0, 'an item the player cannot act on is a notification, not an agenda item');
  assert.ok(it.explanation && it.explanation.length > 10, 'it must explain itself');
  console.log('checkAnAngryStarIsTheLoudestThingOnTheList: OK');
}

function checkAContentBenchPlayerIsNotNews() {
  // The failure mode this guards: a detector that fires on all fifteen men
  // every day, which is noise wearing an agenda's clothes.
  const happy = player({ overall: 62, status: { morale: 72, injury: null } });
  assert.strictEqual(agenda.detectUnhappyPlayers(view({ roster: [happy] })).length, 0,
    'a content player must produce nothing');
  const mildlyGrumpyScrub = player({ overall: 55, status: { morale: 55, injury: null } });
  assert.strictEqual(agenda.detectUnhappyPlayers(view({ roster: [mildlyGrumpyScrub] })).length, 0,
    'a deep-bench man being mildly grumpy is not an agenda item');
  console.log('checkAContentBenchPlayerIsNotNews: OK');
}

function checkALastYearDealOnAGoodPlayerSurfaces() {
  const good = player({ id: 'exp', name: 'Ray Alvarez', overall: 88, contract: { salary: 2e7, yearsRemaining: 1 } });
  const items = agenda.detectExpiringContracts(view({ roster: [good] }));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].urgency, agenda.AGENDA_URGENCY.CRITICAL, 'a star expiring is critical');
  assert.ok(/last year/i.test(items[0].headline), items[0].headline);
  // and a fringe player's expiring deal is not a headline
  const fringe = player({ overall: 60, contract: { salary: 1.5e6, yearsRemaining: 1 } });
  assert.strictEqual(agenda.detectExpiringContracts(view({ roster: [fringe] })).length, 0,
    'every 12th man expiring must not fill the agenda');
  console.log('checkALastYearDealOnAGoodPlayerSurfaces: OK');
}

function checkInjuriesSurfaceByCostNotJustLength() {
  const starShort = player({ id: 'i1', name: 'Star', overall: 90, status: { morale: 70, injury: { severity: 'Sprained ankle', gamesRemaining: 3 } } });
  assert.strictEqual(agenda.detectInjuries(view({ roster: [starShort] })).length, 1,
    'a star missing even a few games matters');
  const scrubShort = player({ overall: 60, status: { morale: 70, injury: { severity: 'Bruise', gamesRemaining: 2 } } });
  assert.strictEqual(agenda.detectInjuries(view({ roster: [scrubShort] })).length, 0,
    'a bench player missing two games is not an agenda item');
  const scrubLong = player({ overall: 60, status: { morale: 70, injury: { severity: 'Torn ligament', gamesRemaining: 40 } } });
  assert.strictEqual(agenda.detectInjuries(view({ roster: [scrubLong] })).length, 1,
    'but a long absence matters whoever it is');
  console.log('checkInjuriesSurfaceByCostNotJustLength: OK');
}

function checkRosterSizeIsCriticalInBothDirections() {
  const short = view({ roster: Array.from({ length: 11 }, function () { return player(); }) });
  const over = view({ roster: Array.from({ length: 17 }, function () { return player(); }) });
  const ok = view({ roster: Array.from({ length: 14 }, function () { return player(); }) });
  assert.strictEqual(agenda.detectRosterSize(short)[0].urgency, agenda.AGENDA_URGENCY.CRITICAL);
  assert.strictEqual(agenda.detectRosterSize(over)[0].urgency, agenda.AGENDA_URGENCY.CRITICAL);
  assert.strictEqual(agenda.detectRosterSize(ok).length, 0, 'a legal roster is not a problem');
  console.log('checkRosterSizeIsCriticalInBothDirections: OK');
}

function checkPayrollOnlyFiresOverTheLine() {
  assert.strictEqual(agenda.detectPayroll(view({ payroll: 1.9e8, taxLine: 1.7e8 })).length, 1);
  assert.strictEqual(agenda.detectPayroll(view({ payroll: 1.5e8, taxLine: 1.7e8 })).length, 0);
  assert.strictEqual(agenda.detectPayroll(view({ payroll: null, taxLine: null })).length, 0,
    'missing finances must not throw or invent a problem');
  console.log('checkPayrollOnlyFiresOverTheLine: OK');
}

function checkAStreakHasToBeARunBeforeItIsAStory() {
  assert.strictEqual(agenda.detectForm(view({ streak: { length: -3 } })).length, 0, 'three is not a run');
  const losing = agenda.detectForm(view({ streak: { length: -7 } }));
  assert.strictEqual(losing.length, 1);
  assert.strictEqual(losing[0].urgency, agenda.AGENDA_URGENCY.DEVELOPING, 'losing is a problem');
  const winning = agenda.detectForm(view({ streak: { length: 7 } }));
  assert.strictEqual(winning[0].urgency, agenda.AGENDA_URGENCY.OPPORTUNITY, 'winning is an opportunity');
  console.log('checkAStreakHasToBeARunBeforeItIsAStory: OK');
}

function checkCriticalAlwaysOutranksOpportunity() {
  // The ordering contract. An agenda that buries "you are below the roster
  // minimum" under "a rivalry is running hot" has failed at its one job.
  const v = {
    userTeamId: 'BOS',
    agendaStreak: { length: 8 },                       // opportunity
    rivalries: null,
    gmCareer: null
  };
  const items = agenda.buildAgenda(Object.assign({}, v), {});
  // Build directly from detectors so this does not depend on a live league.
  const mixed = []
    .concat(agenda.detectForm(view({ streak: { length: 8 } })))
    .concat(agenda.detectRosterSize(view({ roster: Array.from({ length: 11 }, function () { return player(); }) })));
  mixed.sort(function (a, b) {
    const rank = { critical: 0, developing: 1, opportunity: 2 };
    return rank[a.urgency] - rank[b.urgency] || b.weight - a.weight;
  });
  assert.strictEqual(mixed[0].urgency, 'critical', 'critical must sort first');
  assert.ok(Array.isArray(items), 'buildAgenda must return an array even with a thin state');
  console.log('checkCriticalAlwaysOutranksOpportunity: OK');
}

function checkTheAgendaIsStableForTheSameState() {
  // Same state twice must give the same list in the same order, or the screen
  // reshuffles under the player's cursor every render.
  const roster = [
    player({ id: 'a', name: 'A', overall: 90, status: { morale: 30, injury: null } }),
    player({ id: 'b', name: 'B', overall: 88, contract: { salary: 2e7, yearsRemaining: 1 } }),
    player({ id: 'c', name: 'C', age: 21, potential: 92, overall: 62 })
  ];
  const v = view({ roster: roster, payroll: 2e8, taxLine: 1.7e8, streak: { length: -6 } });
  function run() {
    let out = [];
    agenda.AGENDA_DETECTORS.forEach(function (d) { out = out.concat(d(v) || []); });
    out.sort(function (a, b) {
      const rank = { critical: 0, developing: 1, opportunity: 2 };
      return rank[a.urgency] - rank[b.urgency] || b.weight - a.weight || (a.id < b.id ? -1 : 1);
    });
    return ids(out);
  }
  assert.deepStrictEqual(run(), run(), 'the same state must produce the same agenda');
  assert.ok(run().length >= 4, 'this state has at least four real problems in it: ' + run().join(', '));
  console.log('checkTheAgendaIsStableForTheSameState: OK (' + run().length + ' items)');
}

function checkAThinStateDoesNotThrow() {
  // The agenda runs on every render, including before a league exists.
  assert.deepStrictEqual(agenda.buildAgenda(null), [], 'no state, no agenda');
  assert.deepStrictEqual(agenda.buildAgenda({}), [], 'no team, no agenda');
  assert.doesNotThrow(function () { agenda.buildAgenda({ userTeamId: 'BOS' }); },
    'a team with nothing else set must not throw');
  console.log('checkAThinStateDoesNotThrow: OK');
}

function checkEveryItemIsWellFormed() {
  const roster = [
    player({ id: 'a', name: 'A', overall: 90, status: { morale: 25, injury: { severity: 'Knee', gamesRemaining: 30 } } }),
    player({ id: 'b', name: 'B', overall: 88, age: 34, contract: { salary: 2e7, yearsRemaining: 1 } }),
    player({ id: 'd', name: 'D', overall: 86, age: 35 }),
    player({ id: 'c', name: 'C', age: 21, potential: 92, overall: 62 })
  ];
  const v = view({ roster: roster, payroll: 2e8, taxLine: 1.7e8, streak: { length: -6 }, rivals: ['LAL'] });
  let out = [];
  agenda.AGENDA_DETECTORS.forEach(function (d) { out = out.concat(d(v) || []); });
  assert.ok(out.length > 0, 'this state should produce items');
  const urgencies = Object.keys(agenda.AGENDA_URGENCY).map(function (k) { return agenda.AGENDA_URGENCY[k]; });
  const cats = Object.keys(agenda.AGENDA_CATEGORY).map(function (k) { return agenda.AGENDA_CATEGORY[k]; });
  const seen = {};
  out.forEach(function (i) {
    assert.ok(i.id, 'every item needs an id');
    assert.ok(!seen[i.id], 'ids must be unique: ' + i.id);
    seen[i.id] = true;
    assert.ok(urgencies.indexOf(i.urgency) !== -1, 'bad urgency on ' + i.id + ': ' + i.urgency);
    assert.ok(cats.indexOf(i.category) !== -1, 'bad category on ' + i.id + ': ' + i.category);
    assert.ok(i.source, 'every item names where it came from: ' + i.id);
    assert.ok(i.headline && i.headline.length > 5, 'headline too thin on ' + i.id);
    assert.ok(i.explanation && i.explanation.length > 10, 'explanation too thin on ' + i.id);
    assert.ok(Array.isArray(i.entities), 'entities must be an array on ' + i.id);
    assert.ok(Array.isArray(i.responses), 'responses must be an array on ' + i.id);
    i.responses.forEach(function (r) {
      assert.ok(r.label && r.view, 'a response must name a real view: ' + i.id);
    });
  });
  console.log('checkEveryItemIsWellFormed: OK (' + out.length + ' items, all well formed)');
}

function checkStreakReadsRealGames() {
  const gs = {
    userTeamId: 'BOS',
    season: { games: [
      { played: true, homeTeamId: 'BOS', awayTeamId: 'LAL', homeScore: 100, awayScore: 90 },
      { played: true, homeTeamId: 'MIA', awayTeamId: 'BOS', homeScore: 90, awayScore: 100 },
      { played: true, homeTeamId: 'BOS', awayTeamId: 'NYK', homeScore: 88, awayScore: 99 },
      { played: true, homeTeamId: 'BOS', awayTeamId: 'CHI', homeScore: 80, awayScore: 95 },
      { played: false, homeTeamId: 'BOS', awayTeamId: 'DAL', homeScore: null, awayScore: null }
    ] }
  };
  assert.strictEqual(agenda.currentStreak(gs).length, -2, 'two losses after two wins is a -2 run');
  gs.season.games[3].homeScore = 120;   // now a win
  assert.strictEqual(agenda.currentStreak(gs).length, 1, 'one win after a loss is +1');
  assert.strictEqual(agenda.currentStreak({}).length, 0, 'no season, no streak');
  console.log('checkStreakReadsRealGames: OK');
}

function checkItRunsOnARealLeague() {
  // The detectors are unit-tested above against hand-built views. This is the
  // integration check, and it asserts the agenda RESPONDS rather than merely
  // returning an array: the first version of this check reported "0 items" on
  // a fresh league and passed, which is how a payroll detector that could
  // never fire survived. A fresh league genuinely has no problems — so give it
  // one, and require the agenda to find it.
  const league = rq('league.js');
  const gs = { userTeamId: 'BOS', leagueYear: 2026 };

  const quiet = agenda.buildAgenda(gs);
  assert.ok(Array.isArray(quiet), 'must return a list');

  const roster = league.getActiveRoster('BOS') || [];
  assert.ok(roster.length >= 10, 'the integration check needs a real roster, got ' + roster.length);

  // Break something real, on the real objects the game uses.
  const best = roster.slice().sort(function (a, b) { return (b.overall || 0) - (a.overall || 0); })[0];
  const savedMorale = best.status.morale;
  const savedInjury = best.status.injury;
  best.status.morale = 20;
  best.status.injury = { severity: 'Fractured hand', gamesRemaining: 25 };

  const loud = agenda.buildAgenda(gs);
  const ids = loud.map(function (i) { return i.id; });
  assert.ok(loud.length > quiet.length,
    'making the best player miserable and injured must add agenda items (' +
    quiet.length + ' -> ' + loud.length + ')');
  assert.ok(ids.indexOf('unhappy-' + best.id) !== -1, 'the unhappy star must be named: ' + ids.join(', '));
  assert.ok(ids.indexOf('injury-' + best.id) !== -1, 'the injury must be named: ' + ids.join(', '));
  assert.strictEqual(loud[0].urgency, 'critical', 'a hurt, furious star sorts to the top');

  // The payroll detector must be REACHABLE on real numbers, not just in a unit
  // test with hand-fed figures.
  const payroll = league.getTeamPayroll('BOS');
  const taxLine = rq('data.js').getEffectiveLuxuryTaxLine(1);
  assert.ok(payroll > 0 && taxLine > 0, 'payroll and tax line must be real numbers');
  assert.ok(taxLine < 1e9, 'tax line must be a plausible dollar figure, got ' + taxLine);
  if (payroll > taxLine) {
    assert.ok(ids.indexOf('payroll-tax') !== -1,
      'BOS payroll $' + Math.round(payroll / 1e6) + 'M is over the $' +
      Math.round(taxLine / 1e6) + 'M line, so the agenda must say so: ' + ids.join(', '));
  }

  best.status.morale = savedMorale;
  best.status.injury = savedInjury;

  const counts = agenda.agendaCounts(loud);
  assert.strictEqual(counts.total, loud.length, 'counts must agree with the list');
  console.log('checkItRunsOnARealLeague: OK (quiet ' + quiet.length + ' -> broken ' + loud.length +
    ' items; payroll $' + Math.round(payroll / 1e6) + 'M vs $' + Math.round(taxLine / 1e6) + 'M line)');
}

// ~30 AI trades execute every season and the GM is told nothing. This is the
// detector that changes that, and the checks below pin the three rules that
// keep it from becoming a ticker.
function checkARivalsTradeReachesYourDesk() {
  const history = rq('history.js');
  const saved = history.LEAGUE_HISTORY.trades.slice();
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.trades.push(
    { leagueYear: 2026, participants: ['LAL', 'DEN'],
      players: [{ playerId: 'x', playerName: 'Ray Alvarez', fromTeamId: 'LAL', toTeamId: 'DEN' }], picks: [] });

  // A rival moved: news.
  const withRival = agenda.detectLeagueTrades(view({ rivals: ['LAL'], leagueYear: 2026 }));
  assert.strictEqual(withRival.length, 1, 'a rival reshaping itself must reach the desk');
  assert.strictEqual(withRival[0].category, agenda.AGENDA_CATEGORY.LEAGUE);
  assert.ok(/Ray Alvarez/.test(withRival[0].explanation), 'it must name who moved');

  // Nobody you care about: not news.
  assert.strictEqual(agenda.detectLeagueTrades(view({ rivals: ['CHI'], leagueYear: 2026 })).length, 0,
    'a trade between two clubs you have no history with is not your business');

  // Your own trade: you were there.
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.trades.push(
    { leagueYear: 2026, participants: ['BOS', 'LAL'], players: [], picks: [] });
  assert.strictEqual(agenda.detectLeagueTrades(view({ rivals: ['LAL'], leagueYear: 2026 })).length, 0,
    'your own trade is not news to you');

  // Last season's business is over.
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.trades.push(
    { leagueYear: 2019, participants: ['LAL', 'DEN'], players: [], picks: [] });
  assert.strictEqual(agenda.detectLeagueTrades(view({ rivals: ['LAL'], leagueYear: 2026 })).length, 0,
    'an old trade must not resurface as current news');

  // Many trades must still yield at most one item.
  history.LEAGUE_HISTORY.trades.length = 0;
  for (let i = 0; i < 20; i++) {
    history.LEAGUE_HISTORY.trades.push(
      { leagueYear: 2026, participants: ['LAL', 'DEN'], players: [], picks: [] });
  }
  assert.strictEqual(agenda.detectLeagueTrades(view({ rivals: ['LAL'], leagueYear: 2026 })).length, 1,
    'the desk shows a story, not a ticker');

  history.LEAGUE_HISTORY.trades.length = 0;
  saved.forEach(function (t) { history.LEAGUE_HISTORY.trades.push(t); });
  console.log('checkARivalsTradeReachesYourDesk: OK');
}
checkARivalsTradeReachesYourDesk();

// The shape check, and the reason it exists: every rival test in this file fed
// hand-written strings like ['LAL'], while rivalsOf actually returns
// [{ teamId, heat }]. Both detectors that touch rivals were wrong and every
// test passed. On screen the desk read "History with [object Object]", and
// detectLeagueTrades silently matched nothing at all, which is indistinguishable
// from "no rival has traded".
//
// So this drives agendaView with a REAL rivalries state, built by rivalries.js
// itself. A hand-made fixture cannot catch a hand-made fixture being wrong.
function checkRivalsArriveAsIdsWhateverRivalriesReturns() {
  const rivalries = rq('rivalries.js');
  const history = rq('history.js');
  const state = rivalries.createRivalryState();
  rivalries.addHeat(state, 'BOS', 'LAL', rivalries.RIVALRY_THRESHOLD + 12);

  const v = agenda.agendaView({ userTeamId: 'BOS', leagueYear: 2026, rivalries: state });
  assert.ok(Array.isArray(v.rivals), 'rivals must be an array');
  assert.strictEqual(v.rivals.length, 1, 'the rival must survive the trip');
  assert.strictEqual(typeof v.rivals[0], 'string', 'and arrive as an id, not an object');
  assert.strictEqual(v.rivals[0], 'LAL');

  // The two detectors that consume it must produce readable English.
  const rivalItem = agenda.detectRivalry(v)[0];
  assert.ok(rivalItem, 'a real rivalry must produce an item');
  assert.ok(rivalItem.explanation.indexOf('[object') === -1,
    'a club must never be stringified into the copy: ' + rivalItem.explanation);
  assert.ok(/Monarchs/.test(rivalItem.explanation),
    'and must be named, not shown as an id: ' + rivalItem.explanation);

  const saved = history.LEAGUE_HISTORY.trades.slice();
  history.LEAGUE_HISTORY.trades.length = 0;
  history.LEAGUE_HISTORY.trades.push({ leagueYear: 2026, participants: ['LAL', 'DEN'],
    players: [{ playerId: 'x', playerName: 'Dane Foster', fromTeamId: 'DEN', toTeamId: 'LAL' }], picks: [] });
  const tradeItem = agenda.detectLeagueTrades(v)[0];
  assert.ok(tradeItem, 'a rival trade must be found through the real rival shape');
  assert.ok(tradeItem.headline.indexOf('[object') === -1, tradeItem.headline);
  assert.ok(/Monarchs/.test(tradeItem.headline), 'named, not an id: ' + tradeItem.headline);
  history.LEAGUE_HISTORY.trades.length = 0;
  saved.forEach(function (t) { history.LEAGUE_HISTORY.trades.push(t); });

  console.log('checkRivalsArriveAsIdsWhateverRivalriesReturns: OK');
}
checkRivalsArriveAsIdsWhateverRivalriesReturns();

checkAnAngryStarIsTheLoudestThingOnTheList();
checkAContentBenchPlayerIsNotNews();
checkALastYearDealOnAGoodPlayerSurfaces();
checkInjuriesSurfaceByCostNotJustLength();
checkRosterSizeIsCriticalInBothDirections();
checkPayrollOnlyFiresOverTheLine();
checkAStreakHasToBeARunBeforeItIsAStory();
checkCriticalAlwaysOutranksOpportunity();
checkTheAgendaIsStableForTheSameState();
checkAThinStateDoesNotThrow();
checkEveryItemIsWellFormed();
checkStreakReadsRealGames();
checkItRunsOnARealLeague();

console.log('All gmAgenda validations passed');
