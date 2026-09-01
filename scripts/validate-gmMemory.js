// The league already stored every trade with its participants, its players and
// which way each one moved. It never once mentioned any of it. These checks
// pin the queries that turn that archive into a sentence, and the rule that
// keeps the sentence from becoming wallpaper.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js'); rq('teams.js');
const history = rq('history.js');
const memory = rq('gmMemory.js');
const agenda = rq('gmAgenda.js');

function seed(rows) {
  history.LEAGUE_HISTORY.trades.length = 0;
  rows.forEach(function (r) { history.LEAGUE_HISTORY.trades.push(r); });
}
function trade(year, a, b, players) {
  return { leagueYear: year, participants: [a, b], players: players || [], picks: [] };
}
function moved(id, name, from, to) {
  return { playerId: id, playerName: name, fromTeamId: from, toTeamId: to };
}

function checkItFindsOnlyTradesBetweenTheseTwo() {
  seed([
    trade(2025, 'BOS', 'LAL', [moved('p1', 'Ray Alvarez', 'BOS', 'LAL')]),
    trade(2025, 'CHI', 'DEN', [moved('p2', 'Someone Else', 'CHI', 'DEN')]),
    trade(2024, 'BOS', 'CHI', [moved('p3', 'Third Man', 'BOS', 'CHI')])
  ]);
  const between = memory.tradesBetween('BOS', 'LAL', { leagueYear: 2026 });
  assert.strictEqual(between.length, 1, 'only the BOS-LAL trade counts');
  assert.strictEqual(memory.tradesBetween('BOS', 'BOS', { leagueYear: 2026 }).length, 0,
    'a club has no history with itself');
  assert.strictEqual(memory.tradesBetween('BOS', null, { leagueYear: 2026 }).length, 0,
    'a missing club must not throw');
  console.log('checkItFindsOnlyTradesBetweenTheseTwo: OK');
}

function checkItKnowsWhichWayEachManWent() {
  seed([trade(2025, 'BOS', 'LAL', [
    moved('p1', 'Ray Alvarez', 'BOS', 'LAL'),
    moved('p2', 'Dane Foster', 'LAL', 'BOS')
  ])]);
  const flow = memory.playerFlow('BOS', 'LAL', { leagueYear: 2026 });
  assert.deepStrictEqual(flow.sent.map(function (p) { return p.name; }), ['Ray Alvarez']);
  assert.deepStrictEqual(flow.received.map(function (p) { return p.name; }), ['Dane Foster']);
  // And from the other side it must be exactly reversed.
  const back = memory.playerFlow('LAL', 'BOS', { leagueYear: 2026 });
  assert.deepStrictEqual(back.sent.map(function (p) { return p.name; }), ['Dane Foster']);
  assert.deepStrictEqual(back.received.map(function (p) { return p.name; }), ['Ray Alvarez']);
  console.log('checkItKnowsWhichWayEachManWent: OK');
}

function checkTheSentenceLeadsWithTheMostRecentThing() {
  seed([
    trade(2021, 'BOS', 'LAL', [moved('p1', 'Old Business', 'BOS', 'LAL')]),
    trade(2025, 'BOS', 'LAL', [moved('p2', 'Dane Foster', 'LAL', 'BOS')])
  ]);
  const line = memory.historyLineWith('BOS', 'LAL', { leagueYear: 2026 });
  assert.ok(/Dane Foster/.test(line), 'the newest move leads: ' + line);
  assert.ok(/Last season/.test(line), 'and it is dated in seasons, not years: ' + line);
  assert.ok(/they sent you/.test(line), 'and the direction is right: ' + line);
  assert.ok(/2 players/.test(line), 'the total is mentioned when there is more than one: ' + line);
  console.log('checkTheSentenceLeadsWithTheMostRecentThing: OK');
}

function checkAGrudgeExpires() {
  // Beyond the horizon a roster has turned over twice and "you traded him
  // here" is about nobody still in the building.
  seed([trade(2010, 'BOS', 'LAL', [moved('p1', 'Ancient History', 'BOS', 'LAL')])]);
  assert.strictEqual(memory.historyLineWith('BOS', 'LAL', { leagueYear: 2026 }), null,
    'a sixteen-season-old trade is not news');
  assert.ok(memory.historyLineWith('BOS', 'LAL', { leagueYear: 2012 }),
    'but two seasons after it, it is');
  console.log('checkAGrudgeExpires: OK');
}

function checkNoHistoryMeansNoSentence() {
  // A memory system that always has something to say is a caption, not a
  // memory.
  seed([trade(2025, 'CHI', 'DEN', [moved('p1', 'Nobody', 'CHI', 'DEN')])]);
  assert.strictEqual(memory.historyLineWith('BOS', 'LAL', { leagueYear: 2026 }), null,
    'two clubs that have never traded have nothing to remember');
  assert.strictEqual(memory.hasHistoryWith('BOS', 'LAL', { leagueYear: 2026 }), false);
  console.log('checkNoHistoryMeansNoSentence: OK');
}

function checkTheQueryIsBounded() {
  // A twenty-season career archives ~600 trades. The query must cap what it
  // returns however many there are.
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push(trade(2026, 'BOS', 'LAL', [moved('p' + i, 'Player ' + i, 'BOS', 'LAL')]));
  }
  seed(rows);
  const got = memory.tradesBetween('BOS', 'LAL', { leagueYear: 2026 });
  assert.ok(got.length <= memory.MEMORY_TUNING.maxResults,
    'the query must cap its results, got ' + got.length);
  console.log('checkTheQueryIsBounded: OK (' + got.length + ' of 400)');
}

function checkTheMemoryArrivesWhenYouFaceThem() {
  // Tied to the next FIXTURE, not to history merely existing — the lesson
  // rivalry-heat taught, where a scene keyed on a standing fact was
  // permanently true and drowned out everything that had just happened.
  seed([trade(2025, 'BOS', 'LAL', [moved('p1', 'Ray Alvarez', 'BOS', 'LAL')])]);
  // The shape agendaView produces, which is what every detector reads: the
  // club is `teamId`, not `userTeamId`. Passing the latter is how the first
  // draft of this check failed against working code.
  const base = {
    teamId: 'BOS', leagueYear: 2026, roster: [], payroll: null, taxLine: null,
    career: null, rivals: [], streak: { length: 0 }
  };

  const facing = agenda.detectOldFriend(Object.assign({}, base, {
    nextOpponent: { day: 12, teamId: 'LAL' } }));
  assert.strictEqual(facing.length, 1, 'facing them, the history surfaces');
  assert.ok(/Ray Alvarez/.test(facing[0].explanation), facing[0].explanation);
  assert.strictEqual(facing[0].category, agenda.AGENDA_CATEGORY.LEAGUE);

  const elsewhere = agenda.detectOldFriend(Object.assign({}, base, {
    nextOpponent: { day: 12, teamId: 'CHI' } }));
  assert.strictEqual(elsewhere.length, 0, 'facing somebody else, it stays quiet');

  const noGame = agenda.detectOldFriend(Object.assign({}, base, { nextOpponent: null }));
  assert.strictEqual(noGame.length, 0, 'no fixture, no memory');
  console.log('checkTheMemoryArrivesWhenYouFaceThem: OK');
}

function checkNextOpponentReadsTheSchedule() {
  const gs = { userTeamId: 'BOS', season: { currentDay: 10, games: [
    { day: 4, played: true, homeTeamId: 'BOS', awayTeamId: 'MIA' },
    { day: 14, played: false, homeTeamId: 'BOS', awayTeamId: 'LAL' },
    { day: 12, played: false, homeTeamId: 'CHI', awayTeamId: 'BOS' },
    { day: 16, played: false, homeTeamId: 'DEN', awayTeamId: 'NYK' }
  ] } };
  const next = agenda.nextOpponent(gs);
  assert.strictEqual(next.teamId, 'CHI', 'the soonest unplayed fixture wins, home or away');
  assert.strictEqual(next.day, 12);
  assert.strictEqual(agenda.nextOpponent({}), null, 'no season, no fixture');
  assert.strictEqual(agenda.nextOpponent({ userTeamId: 'BOS',
    season: { currentDay: 99, games: [] } }), null, 'season over, no fixture');
  console.log('checkNextOpponentReadsTheSchedule: OK');
}

checkItFindsOnlyTradesBetweenTheseTwo();
checkItKnowsWhichWayEachManWent();
checkTheSentenceLeadsWithTheMostRecentThing();
checkAGrudgeExpires();
checkNoHistoryMeansNoSentence();
checkTheQueryIsBounded();
checkTheMemoryArrivesWhenYouFaceThem();
checkNextOpponentReadsTheSchedule();

history.LEAGUE_HISTORY.trades.length = 0;
console.log('All gmMemory validations passed');
