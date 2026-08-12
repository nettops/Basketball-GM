// Family lines between players. Links are always written in both directions,
// so the invariants worth asserting are structural: both ends present, no
// self-links, no duplicates, and a timeline that is never absurd.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const relatives = require(path.join(ROOT, 'relatives.js'));
const rq = function (f) { return require(path.join(ROOT, f)); };

function mk(id, name) { return { id: id, name: name }; }

function checkLinksAreAlwaysBothWays() {
  const dad = mk('p1', 'Big Name'), kid = mk('p2', 'Small Name');
  relatives.link(dad, kid, 'father');
  assert.deepStrictEqual(dad.relatives, [{ type: 'son', playerId: 'p2', name: 'Small Name' }],
    'the father must record a son');
  assert.deepStrictEqual(kid.relatives, [{ type: 'father', playerId: 'p1', name: 'Big Name' }],
    'the son must record a father');

  const b1 = mk('p3', 'One'), b2 = mk('p4', 'Two');
  relatives.link(b1, b2, 'brother');
  assert.strictEqual(b1.relatives[0].type, 'brother');
  assert.strictEqual(b2.relatives[0].type, 'brother');
  assert.strictEqual(b1.relatives[0].playerId, 'p4');
  assert.strictEqual(b2.relatives[0].playerId, 'p3');
  console.log('checkLinksAreAlwaysBothWays: OK');
}

function checkNoSelfLinksAndNoDuplicates() {
  const p = mk('p5', 'Solo');
  relatives.link(p, p, 'brother');
  assert.deepStrictEqual(p.relatives || [], [], 'a player cannot be his own relative');

  const a = mk('p6', 'A'), b = mk('p7', 'B');
  relatives.link(a, b, 'brother');
  relatives.link(a, b, 'brother');
  assert.strictEqual(a.relatives.length, 1, 'linking twice must not duplicate');
  assert.strictEqual(b.relatives.length, 1, 'on either side');

  // The same pair CAN hold two different kinds of link without one erasing the
  // other; what must never happen is the same kind twice.
  relatives.link(a, b, 'father');
  assert.strictEqual(a.relatives.length, 2);
  assert.strictEqual(relatives.relativesOf(a).filter(function (r) { return r.type === 'brother'; }).length, 1);
  console.log('checkNoSelfLinksAndNoDuplicates: OK');
}

function checkRelativesOfIsSafeOnAnyone() {
  assert.deepStrictEqual(relatives.relativesOf(null), []);
  assert.deepStrictEqual(relatives.relativesOf(mk('p8', 'Nobody')), [],
    'a player with no family must return an empty list, not undefined');
  console.log('checkRelativesOfIsSafeOnAnyone: OK');
}

function makeRngSeq(values) {
  let i = 0;
  return function () { const v = values[i % values.length]; i++; return v; };
}

function checkSonInheritsSurnameAndRespectsTheTimeline() {
  const veteran = { id: 'v1', name: 'Marcus Threepwood', firstLeagueYear: 2026,
    attributes: { threePoint: 90, insideScoring: 30 }, teamId: 'BOS' };
  const tooNew = { id: 'v2', name: 'Kid Recent', firstLeagueYear: 2050,
    attributes: { threePoint: 90, insideScoring: 30 }, teamId: 'LAL' };
  const prospect = { id: 'q1', name: 'Andre Jones', attributes: { threePoint: 50, insideScoring: 50 } };

  // rng always 0 -> every roll fires, and Math.floor(0 * n) picks candidate
  // ZERO. The ineligible one is therefore listed FIRST on purpose: with the
  // eligible father first, deleting the gap check entirely still picked him and
  // the mutant survived. The test could not see the rule it was written for.
  const out = relatives.assignFamilies([prospect], [tooNew, veteran], 2050, makeRngSeq([0]));
  assert.strictEqual(out.sons, 1, 'a son should have been created');
  assert.ok(/Threepwood$/.test(prospect.name),
    'the son must inherit the surname, got ' + prospect.name);
  assert.ok(/^Andre /.test(prospect.name),
    'and keep his own first name, got ' + prospect.name);
  const link = relatives.relativesOf(prospect).find(function (r) { return r.type === 'father'; });
  assert.ok(link, 'the prospect must record his father');
  assert.notStrictEqual(link.playerId, 'v2',
    'a father who entered the league 0 seasons ago is not eligible');
  assert.strictEqual(link.playerId, 'v1');
  assert.ok(relatives.relativesOf(veteran).some(function (r) { return r.type === 'son' && r.playerId === 'q1'; }),
    'and the father must record the son');
  assert.ok(prospect.attributes.threePoint > 50,
    'the son must lean toward his father, got ' + prospect.attributes.threePoint);
  assert.ok(prospect.attributes.threePoint < 90,
    'but must not simply become his father, got ' + prospect.attributes.threePoint);
  assert.ok(prospect.attributes.insideScoring < 50,
    'inheritance works downward too — his father was worse at this, got ' + prospect.attributes.insideScoring);
  console.log('checkSonInheritsSurnameAndRespectsTheTimeline: OK');
}

function checkNoEligibleFatherIsNotAFailure() {
  const prospect = { id: 'q2', name: 'Nobody Special', attributes: { threePoint: 50 } };
  const out = relatives.assignFamilies([prospect], [], 2027, makeRngSeq([0]));
  assert.strictEqual(out.sons, 0, 'no eligible father means no son, not a crash');
  assert.deepStrictEqual(relatives.relativesOf(prospect), []);
  assert.strictEqual(prospect.name, 'Nobody Special', 'and his name must be left alone');

  // The real 2026 players carry no firstLeagueYear at all and must never be
  // eligible: a fictional son writes a `son` entry onto his father, and that is
  // inventing a relationship for a real person.
  const real = { id: 'real-1', name: 'Actual Person', attributes: { threePoint: 80 } };
  const p3 = { id: 'q3', name: 'Someone Else', attributes: { threePoint: 50 } };
  const out2 = relatives.assignFamilies([p3], [real], 2099, makeRngSeq([0]));
  assert.strictEqual(out2.sons, 0, 'a player with no firstLeagueYear can never be a father');
  assert.deepStrictEqual(relatives.relativesOf(real), []);
  console.log('checkNoEligibleFatherIsNotAFailure: OK');
}

function checkBrothersShareASurnameAndAreLinkedOnce() {
  const prospects = [];
  for (let i = 0; i < 6; i++) prospects.push({ id: 'b' + i, name: 'First Last' + i, attributes: { threePoint: 50 } });

  // Drive the TUNING rather than counting rng draws. An earlier version of this
  // test fed a hand-built sequence and assumed the son loop consumed one roll
  // per prospect — it does not when there are no eligible fathers, it returns
  // first — so every value landed one position out and the brother roll never
  // fired. A test whose setup depends on how many times the code under test
  // calls its rng is a test that breaks when the code is refactored correctly.
  const saved = { son: relatives.RELATIVE_TUNING.sonChance, brother: relatives.RELATIVE_TUNING.brotherChance };
  relatives.RELATIVE_TUNING.sonChance = 0;      // rng() >= 0 always, so never fires
  relatives.RELATIVE_TUNING.brotherChance = 2;  // rng() >= 2 never, so always fires
  let out;
  try {
    out = relatives.assignFamilies(prospects, [], 2050, makeRngSeq([0.5]));
  } finally {
    relatives.RELATIVE_TUNING.sonChance = saved.son;
    relatives.RELATIVE_TUNING.brotherChance = saved.brother;
  }
  assert.strictEqual(out.sons, 0, 'the son chance was set to never fire');
  assert.strictEqual(out.brothers, 3, 'six prospects, always firing, is three pairs — got ' + out.brothers);
  const linked = prospects.filter(function (p) { return relatives.relativesOf(p).length > 0; });
  linked.forEach(function (p) {
    const kin = relatives.relativesOf(p);
    assert.strictEqual(kin.length, 1, 'a player belongs to at most one brother pair');
    assert.strictEqual(kin[0].type, 'brother');
    const other = prospects.find(function (q) { return q.id === kin[0].playerId; });
    assert.ok(other, 'the brother must be someone in the same class');
    assert.notStrictEqual(other.id, p.id, 'and must not be himself');
    const surname = function (n) { return n.split(' ').pop(); };
    assert.strictEqual(surname(p.name), surname(other.name),
      'brothers must share a surname: ' + p.name + ' / ' + other.name);
  });
  assert.strictEqual(linked.length, out.brothers * 2, 'every pair links exactly two players');
  console.log('checkBrothersShareASurnameAndAreLinkedOnce: OK');
}

// A prospect already carrying a link must not be handed a second one. With both
// rolls always firing, every prospect becomes a son first, and the brother pass
// must then find nobody free. Without this the guard in the brother loop was
// untested: pairs step two at a time, so they never overlap each other, and the
// only thing the guard actually prevents is a son also being made a brother.
function checkAPlayerIsNeverInTwoFamilies() {
  const fathers = [];
  for (let i = 0; i < 5; i++) {
    fathers.push({ id: 'f' + i, name: 'Dad Surname' + i, firstLeagueYear: 2026, attributes: { threePoint: 70 } });
  }
  const prospects = [];
  for (let i = 0; i < 8; i++) prospects.push({ id: 't' + i, name: 'First Last' + i, attributes: { threePoint: 50 } });

  const saved = { son: relatives.RELATIVE_TUNING.sonChance, brother: relatives.RELATIVE_TUNING.brotherChance };
  relatives.RELATIVE_TUNING.sonChance = 2;      // always fires
  relatives.RELATIVE_TUNING.brotherChance = 2;  // always fires
  let out;
  try {
    out = relatives.assignFamilies(prospects, fathers, 2050, makeRngSeq([0.5]));
  } finally {
    relatives.RELATIVE_TUNING.sonChance = saved.son;
    relatives.RELATIVE_TUNING.brotherChance = saved.brother;
  }
  assert.strictEqual(out.sons, 8, 'every prospect should have become a son');
  assert.strictEqual(out.brothers, 0,
    'nobody was left free to be a brother, got ' + out.brothers + ' pairs');
  prospects.forEach(function (p) {
    const kin = relatives.relativesOf(p);
    assert.strictEqual(kin.length, 1, p.name + ' ended up in ' + kin.length + ' families');
    assert.strictEqual(kin[0].type, 'father');
  });
  console.log('checkAPlayerIsNeverInTwoFamilies: OK');
}

// The one test that proves the whole chain: a class generated by the real
// generateProspectClass, against the real PLAYERS_2026, actually produces a son
// of a real league player. Everything else calls assignFamilies directly, so a
// mutant that passed it an EMPTY player list — families never seeing the league
// at all — survived every one of them.
function checkGeneratedClassesReallyProduceSons() {
  const rq = function (f) { return require(path.join(ROOT, f)); };
  rq('data.js'); rq('rng.js');
  const traits = rq('traits.js');
  rq('scouting.js');
  const PLAYERS = rq('players-2026.js').PLAYERS_2026;
  traits.ensureHiddenPlayerData(PLAYERS);
  const prospects = rq('draftProspects.js');
  const makeRng = rq('rng.js').makeRng;

  // Stand in for eighteen seasons of league play: give a handful of existing
  // players an entry year old enough to make them eligible fathers.
  const seeded = PLAYERS.slice(0, 5);
  seeded.forEach(function (p) { p.firstLeagueYear = 2026; });
  const savedSon = relatives.RELATIVE_TUNING.sonChance;
  relatives.RELATIVE_TUNING.sonChance = 2;   // always fires, so this cannot be flaky
  let cls;
  try {
    cls = prospects.generateProspectClass(makeRng(11), 20, 2050);
  } finally {
    relatives.RELATIVE_TUNING.sonChance = savedSon;
    seeded.forEach(function (p) { delete p.firstLeagueYear; });
  }

  const sons = cls.filter(function (p) {
    return relatives.relativesOf(p).some(function (r) { return r.type === 'father'; });
  });
  assert.strictEqual(sons.length, cls.length,
    'every prospect should be a son here, got ' + sons.length + ' of ' + cls.length);
  const surnames = seeded.map(function (p) { return relatives.surnameOf(p.name); });
  sons.forEach(function (s) {
    assert.ok(surnames.indexOf(relatives.surnameOf(s.name)) !== -1,
      'a generated son must carry a real league surname, got ' + s.name);
  });
  // Clean up the links written onto the real players, so later checks in this
  // file (and anything else sharing the singleton) see them as they were.
  seeded.forEach(function (p) { delete p.relatives; });
  console.log('checkGeneratedClassesReallyProduceSons: OK (' + sons.length + ' sons)');
}

function checkGenerationRatesAreInBand() {
  const veterans = [];
  for (let i = 0; i < 40; i++) {
    veterans.push({ id: 'vet' + i, name: 'Vet Surname' + i, firstLeagueYear: 2026,
      attributes: { threePoint: 70 }, teamId: 'BOS' });
  }
  const makeRng = require(path.join(ROOT, 'rng.js')).makeRng;
  const rng = makeRng(99);
  let classesWithSon = 0, classesWithBrothers = 0;
  const TRIALS = 400;
  for (let c = 0; c < TRIALS; c++) {
    const prospects = [];
    for (let p = 0; p < 60; p++) {
      prospects.push({ id: 'c' + c + 'p' + p, name: 'First Last' + p, attributes: { threePoint: 50 } });
    }
    const out = relatives.assignFamilies(prospects, veterans, 2050, rng);
    if (out.sons > 0) classesWithSon++;
    if (out.brothers > 0) classesWithBrothers++;
  }
  const sonRate = 100 * classesWithSon / TRIALS;
  const brotherRate = 100 * classesWithBrothers / TRIALS;
  assert.ok(sonRate >= 15 && sonRate <= 35,
    'classes containing a son: ' + sonRate.toFixed(1) + '%, target 15-35%');
  assert.ok(brotherRate >= 5 && brotherRate <= 15,
    'classes containing brothers: ' + brotherRate.toFixed(1) + '%, target 5-15%');
  console.log('checkGenerationRatesAreInBand: OK (sons ' + sonRate.toFixed(1) +
    '%, brothers ' + brotherRate.toFixed(1) + '%)');
}

// The generated class must carry the year it belongs to, or nobody in it can
// ever be a father and the whole feature is dead eighteen seasons from now with
// nothing to show it went wrong.
function checkProspectsCarryTheirEntryYear() {
  const rq = function (f) { return require(path.join(ROOT, f)); };
  rq('data.js'); rq('rng.js');
  const traits = rq('traits.js');
  rq('scouting.js');
  const PLAYERS = rq('players-2026.js').PLAYERS_2026;
  traits.ensureHiddenPlayerData(PLAYERS);
  const prospects = rq('draftProspects.js');
  const makeRng = rq('rng.js').makeRng;

  const cls = prospects.generateProspectClass(makeRng(5), 60, 2044);
  assert.strictEqual(cls.length, 60);
  cls.forEach(function (p) {
    assert.strictEqual(p.firstLeagueYear, 2044,
      'every prospect must carry the year of the draft he is generated for');
  });
  assert.ok(PLAYERS.every(function (p) { return p.firstLeagueYear === undefined; }),
    'the real 2026 players must carry no entry year, so they can never be fathers');
  console.log('checkProspectsCarryTheirEntryYear: OK');
}

// There are TWO routes into a new season — script.js's manual advance and
// seasonRollover.js's fast-forward — and a rule reaching one and not the other
// is the defect this codebase keeps producing. If either drops the year, that
// path's draft classes carry no entry year, nobody from them can ever be a
// father, and nothing goes wrong for eighteen seasons.
function checkBothSeasonRoutesPassTheYear() {
  const fs = require('fs');
  const sites = [
    { file: 'script.js', call: 'generateNewSeason(' },
    { file: 'seasonRollover.js', call: 'seasonTransition.generateNewSeason(' },
    { file: 'seasonTransition.js', call: 'prospects.generateProspectClass(' }
  ];
  sites.forEach(function (s) {
    const src = fs.readFileSync(path.join(ROOT, s.file), 'utf8');
    const at = src.indexOf(s.call);
    assert.notStrictEqual(at, -1, 'expected a ' + s.call + ' call in ' + s.file);
    const open = at + s.call.length - 1;
    let depth = 0, args = null;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') { depth--; if (depth === 0) { args = src.slice(open + 1, j); break; } }
    }
    assert.ok(/leagueYear/.test(args),
      s.file + ' calls ' + s.call + ' without a leagueYear — every prospect it ' +
      'generates would carry no entry year: (' + String(args).replace(/\s+/g, ' ').trim() + ')');
  });
  console.log('checkBothSeasonRoutesPassTheYear: OK (' + sites.length + ' sites)');
}

// Twenty seasons of a real league produced ONE family link and ZERO father-son
// pairs. The cause was three omissions with one shape: the retiree archive is a
// whitelist of fields, and everything families need was missing from it.
//
// A father needs eighteen seasons of league service before his son can be
// drafted, and almost nobody plays eighteen seasons — so by the time anyone
// qualifies he has usually retired. If retirees cannot be fathers, essentially
// nobody can, and the feature is dead however correct its generation code is.
function checkRetireesCanStillBeFathers() {
  const history = rq('history.js');
  // A synthetic player, not a real one. An earlier draft of this test set
  // firstLeagueYear on PLAYERS_2026[0] and never put it back, which broke
  // checkProspectsCarryTheirEntryYear three tests later — the real 2026 roster
  // is shared mutable state and every test that touches it has to hand it back.
  const p = {
    id: 'retiring-father', name: 'Old Man Rivers', position: 'PG',
    rawOverall: 60, teamId: 'BOS', jerseyNumber: 7,
    firstLeagueYear: 2027,
    relatives: [{ type: 'brother', playerId: 'someone', name: 'Some One' }]
  };
  const retiredBefore = history.LEAGUE_HISTORY.retiredPlayers.length;
  const archived = history.archiveRetiree(p, 2045);
  history.LEAGUE_HISTORY.retiredPlayers.length = retiredBefore;

  assert.strictEqual(archived.firstLeagueYear, 2027,
    'the archive must keep firstLeagueYear — it is the ONLY thing that makes a ' +
    'player eligible to be a father, so dropping it retires him out of fatherhood');
  assert.deepStrictEqual(archived.relatives, p.relatives,
    'the archive must keep relatives — a retired brother who loses his side of ' +
    'the link disappears from the Relatives toy while his brother still lists him');
  assert.notStrictEqual(archived.relatives, p.relatives,
    'relatives must be COPIED, not aliased, like every other array in the archive');

  // And the eligibility filter must actually accept the archived record.
  const eligible = relatives.eligibleFathers([archived], 2045);
  assert.strictEqual(eligible.length, 1,
    'a retiree who entered in 2027 must be an eligible father in 2045');
  console.log('checkRetireesCanStillBeFathers: OK');
}

// The generator has to be GIVEN the retirees, not merely capable of using them.
// This was the other half of the same defect: draftProspects.js passed only the
// active league, so the eligibility filter never saw a retiree at all.
function checkProspectClassConsidersRetiredFathers() {
  const history = rq('history.js');
  const prospects = rq('draftProspects.js');
  const players = rq('players-2026.js').PLAYERS_2026;

  // Nobody active is old enough; the only possible father is retired.
  const activeBefore = players.map(function (p) { return p.firstLeagueYear; });
  players.forEach(function (p) { p.firstLeagueYear = 2060; });
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;
  for (let i = 0; i < 30; i++) {
    history.LEAGUE_HISTORY.retiredPlayers.push({
      id: 'oldtimer-' + i, name: 'Ancient Legend' + i, firstLeagueYear: 2030,
      attributes: { threePoint: 70 }, careerStats: {}, awardsWon: [], championshipsWon: 0
    });
  }

  const mkRng = rq('rng.js').makeRng;
  let sons = 0;
  for (let c = 0; c < 60; c++) {
    const cls = prospects.generateProspectClass(mkRng(500 + c), 60, 2060);
    cls.forEach(function (p) {
      if (relatives.relativesOf(p).some(function (r) { return r.type === 'father'; })) sons++;
    });
  }
  players.forEach(function (p, i) { p.firstLeagueYear = activeBefore[i]; });
  history.LEAGUE_HISTORY.retiredPlayers.length = 0;

  assert.ok(sons > 0,
    'sixty draft classes produced no sons at all when every eligible father was ' +
    'retired — the generator is only being shown the active league');
  console.log('checkProspectClassConsidersRetiredFathers: OK (' + sons + ' sons from retired fathers)');
}

checkRetireesCanStillBeFathers();
checkProspectClassConsidersRetiredFathers();
checkLinksAreAlwaysBothWays();
checkNoSelfLinksAndNoDuplicates();
checkBothSeasonRoutesPassTheYear();
checkRelativesOfIsSafeOnAnyone();
checkSonInheritsSurnameAndRespectsTheTimeline();
checkNoEligibleFatherIsNotAFailure();
checkBrothersShareASurnameAndAreLinkedOnce();
checkAPlayerIsNeverInTwoFamilies();
checkGenerationRatesAreInBand();
checkProspectsCarryTheirEntryYear();
checkGeneratedClassesReallyProduceSons();
console.log('All relatives validations passed');
