// No two people in the league may share a name.
//
// This file exists because they did, in quantity. Three generators each drew a
// first name and a last name independently from a fifteen-by-fifteen list and
// never checked the result. Measured before the fix:
//
//   one draft class of 60 ......... 7 repeated names
//   twenty draft classes .......... 251 repeated names, 859 surplus copies
//                                   (twelve players named Andre Bell)
//
// The pool is bigger now, but pool size alone only makes a collision rarer. The
// assertions below are on the guarantee, not on the odds: after generating far
// more players than any real save will hold, EVERY name is still distinct.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const { makeRng } = rq('rng.js');
const names = rq('names.js');
const prospects = rq('draftProspects.js');
const coaches = rq('coaches.js');

function duplicatesIn(list) {
  const seen = {};
  const dupes = {};
  list.forEach(function (n) {
    const key = names.normalizeName(n);
    if (seen[key]) dupes[n] = (dupes[n] || 1) + 1;
    seen[key] = true;
  });
  return dupes;
}

function describe(dupes) {
  return Object.keys(dupes).slice(0, 6)
    .map(function (n) { return n + ' x' + dupes[n]; }).join(', ');
}

// The pools have to be big enough that names stay fresh, not merely unique —
// a save that has burned through the whole cross-product starts handing out
// numerals, which is the fallback working, not the system working.
function checkPoolsAreLargeEnough() {
  const playerCombos = names.PLAYER_FIRST_NAMES.length * names.PLAYER_LAST_NAMES.length;
  const coachCombos = names.COACH_FIRST_NAMES.length * names.COACH_LAST_NAMES.length;
  // Fifty seasons at sixty prospects is 3000 players, and the real league adds
  // 380. Ten thousand combinations leaves the pool a third used at worst.
  assert.ok(playerCombos >= 10000,
    'player name pool is ' + playerCombos + ' combinations, too small for a long save');
  assert.ok(coachCombos >= 1500,
    'coach name pool is ' + coachCombos + ' combinations, too small');
  assert.strictEqual(new Set(names.PLAYER_FIRST_NAMES).size, names.PLAYER_FIRST_NAMES.length,
    'the first-name pool itself contains a duplicate');
  assert.strictEqual(new Set(names.PLAYER_LAST_NAMES).size, names.PLAYER_LAST_NAMES.length,
    'the last-name pool itself contains a duplicate');
  assert.strictEqual(new Set(names.COACH_FIRST_NAMES).size, names.COACH_FIRST_NAMES.length,
    'the coach first-name pool contains a duplicate');
  assert.strictEqual(new Set(names.COACH_LAST_NAMES).size, names.COACH_LAST_NAMES.length,
    'the coach last-name pool contains a duplicate');
  console.log('checkPoolsAreLargeEnough: OK (' + playerCombos + ' player, ' + coachCombos + ' coach)');
}

function checkPickUniqueNameNeverRepeats() {
  const rng = makeRng(3);
  const taken = names.takenNameSet();
  const out = [];
  for (let i = 0; i < 2000; i++) out.push(names.pickUniqueName(rng, taken));
  const dupes = duplicatesIn(out);
  assert.strictEqual(Object.keys(dupes).length, 0,
    '2000 draws produced repeats: ' + describe(dupes));
  console.log('checkPickUniqueNameNeverRepeats: OK (2000 draws, all distinct)');
}

// The fallback is what makes the guarantee unconditional. Squeeze the pool to
// almost nothing and it must still return distinct names rather than looping
// forever or handing back a duplicate.
function checkExhaustedPoolStillProducesDistinctNames() {
  const tiny = { first: ['Ann', 'Bo'], last: ['Cole', 'Dey'] };
  const rng = makeRng(9);
  const taken = names.takenNameSet();
  const out = [];
  for (let i = 0; i < 12; i++) out.push(names.pickUniqueName(rng, taken, tiny));
  const dupes = duplicatesIn(out);
  assert.strictEqual(Object.keys(dupes).length, 0,
    'a four-name pool asked for twelve names repeated: ' + describe(dupes));
  assert.strictEqual(out.length, 12);
  console.log('checkExhaustedPoolStillProducesDistinctNames: OK (' + out.slice(4, 7).join(', ') + ' ...)');
}

function checkOneDraftClassHasNoRepeats() {
  const rng = makeRng(11);
  const cls = prospects.generateProspectClass(rng, 60, 2030);
  const dupes = duplicatesIn(cls.map(function (p) { return p.name; }));
  assert.strictEqual(Object.keys(dupes).length, 0,
    'one draft class repeated a name: ' + describe(dupes));
  console.log('checkOneDraftClassHasNoRepeats: OK (60 prospects)');
}

// The measurement that started this: twenty classes is an ordinary long save.
// It also has to hold against the REAL league and the retiree archive, not just
// within the class.
function checkTwentyClassesNeverRepeatAnyone() {
  const history = rq('history.js');
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  history.LEAGUE_HISTORY.retiredPlayers.push(
    { id: 'legend-1', name: 'Jaylen Turner', careerStats: {}, awardsWon: [], championshipsWon: 3 }
  );

  // Each class is added to the league before the next is generated, because
  // that is what the draft does — a prospect who is picked becomes a player,
  // and the following year's class has to see him. Generating twenty classes
  // without ever drafting anyone would test a flow the game does not have.
  const rng = makeRng(7);
  const generated = [];
  const realCount = PLAYERS_2026.length;
  for (let i = 0; i < 20; i++) {
    const cls = prospects.generateProspectClass(rng, 60, 2030 + i);
    generated.push.apply(generated, cls);
    cls.forEach(function (p) { PLAYERS_2026.push(p); });
  }
  assert.strictEqual(generated.length, 1200);

  const withinClasses = duplicatesIn(generated.map(function (p) { return p.name; }));
  assert.strictEqual(Object.keys(withinClasses).length, 0,
    'twenty draft classes repeated names: ' + describe(withinClasses));

  // PLAYERS_2026 already holds the generated players by now — they were drafted
  // into it above — so concatenating `generated` again would count every one of
  // them twice and report 1200 false duplicates.
  const everyone = PLAYERS_2026.map(function (p) { return p.name; })
    .concat(history.LEAGUE_HISTORY.retiredPlayers.map(function (r) { return r.name; }));
  assert.strictEqual(everyone.length, realCount + 1200 + 1,
    'the league should hold every real player plus all 1200 drafted, got ' + everyone.length);
  const all = duplicatesIn(everyone);
  assert.strictEqual(Object.keys(all).length, 0,
    'a generated player took the name of a real or retired player: ' + describe(all));
  console.log('checkTwentyClassesNeverRepeatAnyone: OK (1200 generated vs ' +
    realCount + ' real and 1 retired)');
  PLAYERS_2026.length = realCount;   // leave the league as it was found
}

function checkCoachesDoNotRepeat() {
  const rng = makeRng(5);
  // Seat a coach on every bench first. Without this the "must not collide with
  // a sitting coach" assertion below compares against an empty list and passes
  // for the wrong reason.
  coaches.ensureAllTeamsHaveCoaches(rng);
  // One shared set across the batch, which is what generateCoachCandidates
  // does. Without it each call would only exclude the coaches already on
  // benches and the batch could repeat itself.
  const taken = names.takenNameSet(TEAMS.map(function (t) { return t.coach; }));
  const generated = [];
  for (let i = 0; i < 300; i++) generated.push(coaches.generateCoach(rng, taken));
  const dupes = duplicatesIn(generated.map(function (c) { return c.name; }));
  assert.strictEqual(Object.keys(dupes).length, 0,
    '300 generated coaches repeated a name: ' + describe(dupes));

  // And a coach must not collide with the coaches already sitting on benches.
  const sitting = TEAMS.map(function (t) { return t.coach && t.coach.name; }).filter(Boolean);
  const together = duplicatesIn(generated.map(function (c) { return c.name; }).concat(sitting));
  assert.strictEqual(Object.keys(together).length, 0,
    'a new coach took a sitting coach\'s name: ' + describe(together));
  // The shortlist the game actually offers you must not show the same man
  // twice — that is the batch path, and it owns the shared set itself.
  const shortlist = coaches.generateCoachCandidates(makeRng(21), 8);
  const shortlistDupes = duplicatesIn(shortlist.map(function (c) { return c.name; }));
  assert.strictEqual(Object.keys(shortlistDupes).length, 0,
    'a coaching shortlist offered the same name twice: ' + describe(shortlistDupes));
  console.log('checkCoachesDoNotRepeat: OK (300 generated vs ' + sitting.length + ' sitting)');
}

// A taken-set that is not an object turns every lookup into undefined and the
// guarantee evaporates silently. That mistake was made writing this very file —
// a league year was passed where the set belongs — and the only symptom was
// repeated names, which is the bug it was meant to catch.
// Names arriving from outside the generators — a hand-edited save, an imported
// career, a created player — do not come pre-tidied. Comparing them raw would
// let "andre bell" and "Andre  Bell" both be handed out as different people,
// which is the same repeated name with extra steps.
function checkNamesCompareTidily() {
  const taken = names.takenNameSet(['Andre  Bell']);
  assert.ok(names.isNameTaken(taken, 'andre bell'), 'case and spacing must not hide a collision');
  assert.ok(names.isNameTaken(taken, '  Andre Bell  '), 'surrounding space must not hide a collision');
  assert.ok(!names.isNameTaken(taken, 'Andre Bells'), 'a different name must still be free');
  assert.strictEqual(names.normalizeName('  Andre   BELL '), 'andre bell');
  console.log('checkNamesCompareTidily: OK');
}

function checkABadTakenSetIsRefused() {
  assert.throws(function () { names.pickUniqueName(makeRng(1), 2030); }, /taken-name set/);
  assert.throws(function () { names.pickUniqueName(makeRng(1), null); }, /taken-name set/);
  console.log('checkABadTakenSetIsRefused: OK');
}

// Driven through fillRosterToTarget, the exported entry point the commissioner
// tools actually call, rather than through the private generator — the filler
// path is only reachable once free agents run out, and that is precisely the
// state where it fires dozens of times in a row.
function checkFringePlayersDoNotRepeat() {
  const commissioner = rq('commissioner.js');
  global.GameState = global.GameState ||
    { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };
  const rng = makeRng(13);
  const before = PLAYERS_2026.length;

  TEAMS.forEach(function (team) { commissioner.fillRosterToTarget(team, 18, rng); });
  const created = PLAYERS_2026.length - before;
  assert.ok(created > 50,
    'the filler path barely ran (' + created + ' players) — this proves nothing');

  const dupes = duplicatesIn(PLAYERS_2026.map(function (p) { return p.name; }));
  assert.strictEqual(Object.keys(dupes).length, 0,
    created + ' filler players repeated a name: ' + describe(dupes));
  console.log('checkFringePlayersDoNotRepeat: OK (' + created + ' filler players, ' +
    PLAYERS_2026.length + ' in the league, all distinct)');
}

// Suffix handling matters because the family system reads a surname off a name
// to give a son his father's. "Marcus Bell Jr." must yield Bell, not Jr.
function checkSurnameIgnoresSuffixes() {
  assert.strictEqual(names.surnameOfName('Marcus Bell'), 'Bell');
  assert.strictEqual(names.surnameOfName('Marcus Bell Jr.'), 'Bell');
  assert.strictEqual(names.surnameOfName('Marcus Bell III'), 'Bell');
  assert.strictEqual(names.surnameOfName('Cher'), 'Cher', 'a one-word name is its own surname');
  assert.strictEqual(names.firstNameOfName('Marcus Bell Jr.'), 'Marcus');
  console.log('checkSurnameIgnoresSuffixes: OK');
}

checkPoolsAreLargeEnough();
checkPickUniqueNameNeverRepeats();
checkExhaustedPoolStillProducesDistinctNames();
checkSurnameIgnoresSuffixes();
checkNamesCompareTidily();
checkABadTakenSetIsRefused();
checkOneDraftClassHasNoRepeats();
checkTwentyClassesNeverRepeatAnyone();
checkCoachesDoNotRepeat();
checkFringePlayersDoNotRepeat();
console.log('All name validations passed');
