// A promise is the only dialogue effect that does not settle when you click it,
// so almost every check here is about TIME: what is true before the date, what
// is true on it, and what happens to the owner's opinion of you either way.
//
// The failure this file exists to prevent: a promise that always resolves the
// same way. A ledger that can only be kept is the old free button with extra
// steps; one that can only be broken is a punishment for talking.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const data = rq('data.js'); rq('rng.js');
const { TEAMS, getTeamById } = rq('teams.js');
const traits = rq('traits.js'); rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
rq('ratings.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const league = rq('league.js');
const gmCareer = rq('gmCareer.js');
const promises = rq('gmPromises.js');
const scenes = rq('dialogueScenes.js');
const dctx = rq('dialogueContext.js');
const agenda = rq('gmAgenda.js');

const TAX_LINE = data.getEffectiveLuxuryTaxLine(1);

// A game state good enough to judge a promise, with the club's real roster —
// the judges read live player objects, so hand-built stand-ins would test a
// different function than the one that ships.
function state(over) {
  const gs = Object.assign({
    userTeamId: 'BOS',
    leagueYear: 2026,
    settings: { capLevel: 1 },
    season: { currentDay: 10, games: [] },
    gmPromises: []
  }, over || {});
  gmCareer.ensureGmCareer(gs);
  return gs;
}

function ownerHappiness() { return getTeamById('BOS').ownerHappiness || 0; }

function withSavedTeam(fn) {
  const t = getTeamById('BOS');
  const saved = { owner: t.ownerHappiness, wins: t.record.wins, losses: t.record.losses };
  try { return fn(t); } finally {
    t.ownerHappiness = saved.owner;
    t.record.wins = saved.wins;
    t.record.losses = saved.losses;
  }
}

function checkAPromiseIsWrittenDownRatherThanPaid() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const before = ownerHappiness();
    const made = promises.makePromise(gs, {
      kind: 'payroll-cut', sceneId: 'tax-bill-looming', text: 'said it'
    });
    assert.ok(made, 'the promise must be taken');
    assert.strictEqual(made.status, 'open');
    assert.strictEqual(promises.openPromises(gs).length, 1);
    // Making it moves NOTHING. The scene's own effect pays the small deposit;
    // this file pays the rest, later, or takes it back.
    assert.strictEqual(ownerHappiness(), before,
      'making a promise must not pay the owner by itself');
  });
  console.log('checkAPromiseIsWrittenDownRatherThanPaid: OK');
}

function checkTheSameWordIsNotGivenTwice() {
  const gs = state();
  assert.ok(promises.makePromise(gs, { kind: 'payroll-cut' }));
  assert.strictEqual(promises.makePromise(gs, { kind: 'payroll-cut' }), null,
    'promising the same thing again is one promise, not two');
  // Different subject, same kind: a genuinely different promise.
  assert.ok(promises.makePromise(gs, { kind: 'keep-him', subjectId: 'a', subjectName: 'A' }));
  assert.ok(promises.makePromise(gs, { kind: 'keep-him', subjectId: 'b', subjectName: 'B' }));
  assert.strictEqual(promises.makePromise(gs, { kind: 'keep-him', subjectId: 'a' }), null);
  // And the ledger has a ceiling.
  assert.ok(promises.makePromise(gs, { kind: 'get-him-help', subjectId: 'c', subjectName: 'C' }));
  assert.strictEqual(promises.openPromises(gs).length, promises.PROMISE_TUNING.maxOpen);
  assert.strictEqual(promises.makePromise(gs, { kind: 'mandate-run' }), null,
    'past the cap a new promise is refused rather than an old one dropped');
  console.log('checkTheSameWordIsNotGivenTwice: OK');
}

function checkAnUnknownKindIsRefused() {
  const gs = state();
  assert.strictEqual(promises.makePromise(gs, { kind: 'buy-the-club' }), null);
  assert.strictEqual(promises.makePromise(gs, null), null);
  assert.strictEqual(promises.makePromise(null, { kind: 'payroll-cut' }), null);
  console.log('checkAnUnknownKindIsRefused: OK');
}

function checkNothingSettlesBeforeItsDate() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state({ season: { currentDay: 10, games: scheduleTo(120) } });
    const made = promises.makePromise(gs, { kind: 'payroll-cut' });
    assert.ok(typeof made.dueDay === 'number' && made.dueDay > 10,
      'the deadline is a real day ahead, got ' + made.dueDay);
    // Payroll deliberately left over the line, so the only verdict available
    // is "broken" — and it must not be reached yet.
    const settled = promises.settlePromises(gs, { day: made.dueDay - 1 });
    assert.strictEqual(settled.length, 0, 'a promise with a day left is still open');
    assert.strictEqual(ownerHappiness(), 50, 'and nothing has been paid');
  });
  console.log('checkNothingSettlesBeforeItsDate: OK');
}

function checkTheDateArrivingBreaksIt() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state({ season: { currentDay: 10, games: scheduleTo(120) } });
    const made = promises.makePromise(gs, { kind: 'payroll-cut' });
    const payroll = league.getTeamPayroll('BOS');
    assert.ok(payroll > TAX_LINE,
      'this check needs BOS over the tax line to have anything to break ($' +
      Math.round(payroll / 1e6) + 'M vs $' + Math.round(TAX_LINE / 1e6) + 'M)');
    const settled = promises.settlePromises(gs, { day: made.dueDay });
    assert.strictEqual(settled.length, 1, 'the date arriving must force a verdict');
    assert.strictEqual(settled[0].verdict, 'broken');
    assert.strictEqual(made.status, 'broken');
    assert.strictEqual(ownerHappiness(), 50 + promises.PROMISE_TUNING.brokenOwner,
      'breaking your word must cost the owner meter');
    assert.ok(/deliver/.test(settled[0].line), 'the settlement says what happened: ' + settled[0].line);
    // And the chronicle carries it, so a career reads back with the broken
    // promises in it.
    const chron = gs.gmCareer.chronicle || [];
    assert.ok(chron.some(function (e) { return e.text === settled[0].line; }),
      'a settled promise goes in the chronicle');
  });
  console.log('checkTheDateArrivingBreaksIt: OK');
}

function checkKeepingItPaysEarly() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state({ season: { currentDay: 10, games: scheduleTo(120) } });
    const made = promises.makePromise(gs, { kind: 'payroll-cut' });
    // Do the thing: a cap level high enough that the real payroll is under the
    // line. The judge reads the live figures, so this is the same route the
    // game takes when a GM actually dumps salary.
    gs.settings.capLevel = 4;
    const settled = promises.settlePromises(gs, { day: made.dueDay - 20 });
    assert.strictEqual(settled.length, 1, 'doing it early settles it early');
    assert.strictEqual(settled[0].verdict, 'kept');
    assert.strictEqual(ownerHappiness(), 50 + promises.PROMISE_TUNING.keptOwner);
    // Asymmetry is the point: the risk has to outweigh the reward or the
    // promise is free again.
    assert.ok(Math.abs(promises.PROMISE_TUNING.brokenOwner) > promises.PROMISE_TUNING.keptOwner,
      'breaking a promise must cost more than keeping it pays');
  });
  console.log('checkKeepingItPaysEarly: OK');
}

function checkTradingTheManBreaksItAtOnce() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const roster = league.getActiveRoster('BOS');
    const star = roster[0];
    promises.makePromise(gs, { kind: 'keep-him', subjectId: star.id, subjectName: star.name });
    // Still here, still miserable: open, because there is a season to fix it in.
    const savedMorale = star.status.morale;
    star.status.morale = 20;
    assert.strictEqual(promises.settlePromises(gs, { day: 40 }).length, 0,
      'a man who is unhappy but still here has not been let down yet');
    star.status.morale = savedMorale;

    // Gone: broken the moment it happens, with no date to wait for. A
    // season-end promise has no dueDay at all, so this is the one verdict
    // that has to reach past the clock. Moved on the real player object,
    // because getActiveRoster reads teamId off PLAYERS_2026 — a stand-in
    // roster would test a different function than the one that ships.
    star.teamId = 'LAL';
    const settled = promises.settlePromises(gs, { day: 40 });
    star.teamId = 'BOS';
    assert.strictEqual(settled.length, 1, 'trading him away breaks it immediately');
    assert.strictEqual(settled[0].verdict, 'broken');
    assert.ok(/moved him anyway/.test(settled[0].line), settled[0].line);
  });
  console.log('checkTradingTheManBreaksItAtOnce: OK');
}

// He is going nowhere, and the season ended with him here. The one promise
// whose default at the season's end is KEPT rather than broken — see the
// seasonEndVerdict note in gmPromises.js, and probe-promises.js for the
// measurement that forced it.
function checkKeepingHimHereIsWhatIsJudged() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const star = league.getActiveRoster('BOS')[0];
    const saved = star.status.morale;
    // Still furious in April. That is no longer the GM's promise to keep: the
    // probe found no man below 40 ever recovers, because morale reads minutes
    // and the GM does not set them.
    star.status.morale = 12;
    promises.makePromise(gs, { kind: 'keep-him', subjectId: star.id, subjectName: star.name });
    assert.strictEqual(promises.settlePromises(gs, { day: 40 }).length, 0,
      'mid-season, with him still here, there is nothing to settle');
    const settled = promises.settlePromises(gs, { seasonEnd: true, day: 170 });
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].verdict, 'kept',
      'he is miserable, but he is here, and here is what was promised');
    assert.strictEqual(ownerHappiness(), 50 + promises.PROMISE_TUNING.keptOwner);
    star.status.morale = saved;
  });
  console.log('checkKeepingHimHereIsWhatIsJudged: OK');
}

function checkARunHasToBeAnActualRun() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    t.record.wins = 10; t.record.losses = 30;
    const gs = state();
    const made = promises.makePromise(gs, { kind: 'mandate-run' });
    assert.deepStrictEqual(made.baseline, { wins: 10, losses: 30 },
      'the record at the moment he said it is what he is judged against');

    // Two games in: too early to have shown anything either way.
    t.record.wins = 12; t.record.losses = 30;
    assert.strictEqual(promises.settlePromises(gs, { day: made.dueDay - 1 }).length, 0);

    // Winning month, judged before the date: kept.
    t.record.wins = 24; t.record.losses = 34;
    const settled = promises.settlePromises(gs, { day: made.dueDay - 1 });
    assert.strictEqual(settled.length, 1, '14-4 since he said it is a run');
    assert.strictEqual(settled[0].verdict, 'kept');
  });

  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    t.record.wins = 10; t.record.losses = 30;
    const gs = state();
    const made = promises.makePromise(gs, { kind: 'mandate-run' });
    t.record.wins = 14; t.record.losses = 44;   // 4-14: not a run
    const settled = promises.settlePromises(gs, { day: made.dueDay });
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].verdict, 'broken');
  });
  console.log('checkARunHasToBeAnActualRun: OK');
}

function checkHelpMeansSomebodyBetterArrived() {
  const ratings = rq('ratings.js');
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const roster = league.getActiveRoster('BOS');
    const star = roster.slice().sort(function (a, b) {
      return (b.rawOverall || 0) - (a.rawOverall || 0);
    })[0];
    const made = promises.makePromise(gs,
      { kind: 'get-him-help', subjectId: star.id, subjectName: star.name });
    const base = made.baseline.secondBest;
    assert.ok(base > 0, 'the baseline is the second best man on the roster, got ' + base);

    // Nobody came. The star himself getting better is NOT help, so raise him
    // through the only door ratings.js leaves open — the attributes — and
    // require the verdict to stay broken.
    const savedAttrs = Object.assign({}, star.attributes);
    ratings.scaleAttributesToOverall(star, Math.min(99, star.overall + 12));
    assert.ok(star.rawOverall > base, 'the star is now well clear of his second man');
    const settled = promises.settlePromises(gs, { day: made.dueDay });
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].verdict, 'broken',
      'the man you promised help getting better himself is not help');
    Object.assign(star.attributes, savedAttrs);
  });

  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const roster = league.getActiveRoster('BOS');
    const star = roster.slice().sort(function (a, b) {
      return (b.rawOverall || 0) - (a.rawOverall || 0);
    })[0];
    const made = promises.makePromise(gs,
      { kind: 'get-him-help', subjectId: star.id, subjectName: star.name });

    // Help ARRIVES: somebody better walks in the door. Done the way a trade
    // does it — a real player object changing teamId — so the judge is reading
    // the same roster the game would show.
    const incoming = PLAYERS_2026.filter(function (p) {
      return p.teamId && p.teamId !== 'BOS' &&
        p.rawOverall >= made.baseline.secondBest + promises.PROMISE_TUNING.helpRatingGain;
    })[0];
    assert.ok(incoming, 'the league must contain somebody better than the BOS second man');
    const from = incoming.teamId;
    incoming.teamId = 'BOS';
    const settled = promises.settlePromises(gs, { day: made.dueDay - 5 });
    incoming.teamId = from;
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].verdict, 'kept');
    assert.ok(/help/.test(settled[0].line), settled[0].line);
  });
  console.log('checkHelpMeansSomebodyBetterArrived: OK');
}

function checkSeasonEndForcesAVerdictOnEverything() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state({ season: { currentDay: 10, games: scheduleTo(120) } });
    promises.makePromise(gs, { kind: 'payroll-cut' });
    promises.makePromise(gs, { kind: 'mandate-run' });
    // Neither is anywhere near its date.
    assert.strictEqual(promises.settlePromises(gs, { day: 11 }).length, 0);
    const settled = promises.settlePromises(gs, { seasonEnd: true, day: 170 });
    assert.strictEqual(settled.length, 2, 'the season ending judges everything still open');
    assert.strictEqual(promises.openPromises(gs).length, 0);
  });
  console.log('checkSeasonEndForcesAVerdictOnEverything: OK');
}

function checkTheLedgerDoesNotGrowForever() {
  const gs = state();
  const keep = promises.PROMISE_TUNING.keepSettled;
  for (let i = 0; i < keep + 6; i++) {
    gs.gmPromises.push({ kind: 'payroll-cut', status: 'broken', settledYear: 2000 + i });
  }
  gs.gmPromises.push({ kind: 'keep-him', subjectId: 'live', status: 'open', dueDay: null });
  promises.settlePromises(gs, { day: 5 });
  const done = gs.gmPromises.filter(function (p) { return p.status !== 'open'; });
  assert.ok(done.length <= keep, 'settled promises are trimmed, got ' + done.length);
  assert.ok(gs.gmPromises.some(function (p) { return p.subjectId === 'live'; }),
    'trimming must never drop an open promise');
  console.log('checkTheLedgerDoesNotGrowForever: OK');
}

// The four scene choices that now make promises. The point of this check is
// that the WIRING is real: it is the effect descriptor the scene returns that
// carries the promise, not something the ledger invents for itself.
function checkTheScenesActuallyPromise() {
  const expected = {
    'tax-bill-looming': 'payroll-cut',
    'mandate-slipping': 'mandate-run',
    'unhappy-star': 'keep-him',
    'star-carried-a-loss': 'get-him-help'
  };
  const ctx = {
    unhappyName: 'Marcus Johnson', unhappyId: 'p1',
    topScorerName: 'Ray Alvarez', topScorerId: 'p2',
    opponentName: 'Denver Summit', teamName: 'Boston Shamrocks', margin: 6
  };
  Object.keys(expected).forEach(function (sceneId) {
    const scene = scenes.SCENES.filter(function (s) { return s.id === sceneId; })[0];
    assert.ok(scene, 'scene ' + sceneId + ' must still exist');
    const made = scene.choices
      .filter(function (c) { return typeof c.effect === 'function'; })
      .map(function (c) { return c.effect(ctx); })
      .filter(function (d) { return d && d.promise; });
    assert.strictEqual(made.length, 1,
      sceneId + ' must have exactly one choice that gives your word, got ' + made.length);
    assert.strictEqual(made[0].promise.kind, expected[sceneId]);
    assert.ok(promises.PROMISE_KINDS[made[0].promise.kind],
      sceneId + ' promises a kind that does not exist: ' + made[0].promise.kind);
    assert.ok(made[0].promise.text && made[0].promise.text.length > 10,
      sceneId + ' must record what was said');
    assert.strictEqual(scenes.tokensIn(made[0].promise.text).length, 0,
      sceneId + ': the recorded sentence has an uninterpolated token');
  });
  // And the two that name a man must name a REAL one.
  const unhappy = scenes.SCENES.filter(function (s) { return s.id === 'unhappy-star'; })[0];
  const d = unhappy.choices[0].effect(ctx);
  assert.strictEqual(d.promise.subjectId, 'p1', 'the promise holds the id, not just the name');
  console.log('checkTheScenesActuallyPromise: OK');
}

// The end-to-end path: a scene's effect, through applyDialogueEffect, into the
// ledger. Every unit check above calls makePromise directly, which would keep
// passing if the channel were never wired up.
function checkTheChannelReachesTheLedger() {
  withSavedTeam(function (t) {
    t.ownerHappiness = 50;
    const gs = state();
    const scene = scenes.SCENES.filter(function (s) { return s.id === 'tax-bill-looming'; })[0];
    const choice = scene.choices.filter(function (c) {
      return typeof c.effect === 'function' && c.effect({}).promise;
    })[0];
    const result = dctx.applyDialogueEffect(gs, choice.effect({}), { roster: [] });
    assert.ok(result.applied.indexOf('promise') !== -1,
      'the promise channel must be applied: ' + result.applied.join(', '));
    assert.strictEqual(promises.openPromises(gs).length, 1);
    assert.strictEqual(gs.gmPromises[0].kind, 'payroll-cut');
  });
  console.log('checkTheChannelReachesTheLedger: OK');
}

// A promise nobody is reminded of is a trap. It has to be on the desk.
function checkAnOpenPromiseIsOnTheDesk() {
  const gs = state({ season: { currentDay: 10, games: scheduleTo(120) } });
  const before = agenda.buildAgenda(gs).length;
  const made = promises.makePromise(gs, { kind: 'payroll-cut' });
  const items = agenda.buildAgenda(gs);
  assert.ok(items.length > before, 'giving your word adds something to the agenda');
  const item = items.filter(function (i) { return i.source === 'promise'; })[0];
  assert.ok(item, 'the promise must be on the desk: ' + items.map(function (i) { return i.id; }).join(', '));
  assert.ok(/gave your word/.test(item.headline), item.headline);
  assert.ok(item.explanation.indexOf('left') !== -1 || item.explanation.indexOf('Due') !== -1,
    'it must say how long is left: ' + item.explanation);
  assert.strictEqual(item.urgency, agenda.AGENDA_URGENCY.DEVELOPING,
    'a promise with a month to run is not yet critical');

  // Close to the date, it moves up.
  made.dueDay = 12;
  const late = agenda.buildAgenda(gs).filter(function (i) { return i.source === 'promise'; })[0];
  assert.strictEqual(late.urgency, agenda.AGENDA_URGENCY.CRITICAL,
    'two days from the date it is the thing to be doing today');

  // Settled, it leaves.
  made.status = 'broken';
  assert.strictEqual(
    agenda.buildAgenda(gs).filter(function (i) { return i.source === 'promise'; }).length, 0,
    'a settled promise stops nagging');
  console.log('checkAnOpenPromiseIsOnTheDesk: OK');
}

function checkAThinStateDoesNotThrow() {
  assert.deepStrictEqual(promises.settlePromises({}, {}), []);
  assert.deepStrictEqual(promises.settlePromises(null, {}), []);
  assert.deepStrictEqual(promises.settlePromises({ userTeamId: 'BOS' }, {}), []);
  const facts = promises.promiseFacts({});
  assert.strictEqual(facts.teamId, null);
  assert.strictEqual(facts.day, 0);
  // An unknown kind sitting in an old save must not wedge the settler.
  const gs = state();
  gs.gmPromises.push({ kind: 'from-the-future', status: 'open' });
  const t = getTeamById('BOS');
  const ownerBefore = t.ownerHappiness;
  assert.doesNotThrow(function () { promises.settlePromises(gs, { day: 5 }); });
  assert.strictEqual(gs.gmPromises[0].status, 'void',
    'a kind this build cannot read is retired, not judged');
  assert.strictEqual(t.ownerHappiness, ownerBefore,
    'and it costs the GM nothing');
  console.log('checkAThinStateDoesNotThrow: OK');
}

// A schedule long enough to have a trade deadline in it. tradeDeadlineDay
// reads the last day off the games, so an empty season has no deadline and
// every deadline-shaped promise would quietly become a season-end one.
function scheduleTo(lastDay) {
  return [{ day: lastDay, homeTeamId: 'BOS', awayTeamId: 'LAL', played: false }];
}

function checkNoDeadlineMeansNoFalseDate() {
  const gs = state({ season: { currentDay: 10, games: [] } });
  const made = promises.makePromise(gs, { kind: 'payroll-cut' });
  assert.strictEqual(made.dueDay, null,
    'with no schedule to read a deadline off, the promise waits for the season to end');
  const line = promises.promiseStatusLine(made, promises.promiseFacts(gs));
  assert.ok(/end of the season/.test(line), line);
  console.log('checkNoDeadlineMeansNoFalseDate: OK');
}

checkAPromiseIsWrittenDownRatherThanPaid();
checkTheSameWordIsNotGivenTwice();
checkAnUnknownKindIsRefused();
checkNothingSettlesBeforeItsDate();
checkTheDateArrivingBreaksIt();
checkKeepingItPaysEarly();
checkTradingTheManBreaksItAtOnce();
checkKeepingHimHereIsWhatIsJudged();
checkARunHasToBeAnActualRun();
checkHelpMeansSomebodyBetterArrived();
checkSeasonEndForcesAVerdictOnEverything();
checkTheLedgerDoesNotGrowForever();
checkTheScenesActuallyPromise();
checkTheChannelReachesTheLedger();
checkAnOpenPromiseIsOnTheDesk();
checkNoDeadlineMeansNoFalseDate();
checkAThinStateDoesNotThrow();
console.log('All GM promise validations passed');
