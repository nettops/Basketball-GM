// Teams get first refusal on their own expiring players, and contract length
// tracks who the player is.
//
// Before this existed, decrementContracts cut a player loose the instant his
// deal hit zero, so his own team had no claim on him and was simply one of ~20
// bidders on the open market. Measured over 5 offseasons: 437 contracts signed,
// all 437 recorded as open-market signings, ZERO re-signings league-wide. Star
// re-sign rate 12.7%, star tenure 2.27 seasons, 36% of the league changing
// teams every year.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

rq('data.js'); rq('rng.js');
const { TEAMS, getTeamById } = rq('teams.js');
const traits = rq('traits.js');
rq('scouting.js');
const { PLAYERS_2026 } = rq('players-2026.js');
traits.ensureHiddenPlayerData(PLAYERS_2026);
const ratings = rq('ratings.js');
const league = rq('league.js');
const fa = rq('freeAgency.js');
const seasonTransition = rq('seasonTransition.js');
const { makeRng } = rq('rng.js');

global.GameState = { settings: { capLevel: 1, capDisabled: false }, leagueYear: 2026 };

function byId(id) { return PLAYERS_2026.find(function (p) { return p.id === id; }); }
const BANDS = ratings.RATING_BANDS;

// Length has to track quality, and it has to be read off the DISPLAY scale.
// The first cut banded on rawOverall — a different scale entirely (median 47
// against the display median of 75, one player league-wide above 85) — which
// filed all but one player under "fringe" and made every contract in the
// league SHORTER. The bug passed every existing test; only the measured mean
// caught it. This pins the scale.
function checkContractLengthTracksQuality() {
  const rng = makeRng(3);
  const sample = function (p) {
    let total = 0;
    for (let i = 0; i < 200; i++) total += fa.contractYearsFor(p, rng);
    return total / 200;
  };
  const star = PLAYERS_2026.filter(function (p) { return p.overall >= BANDS.star && p.age <= 30; })
    .sort(function (a, b) { return b.overall - a.overall; })[0];
  const fringe = PLAYERS_2026.filter(function (p) { return p.overall < BANDS.fringe && p.age <= 30; })
    .sort(function (a, b) { return a.overall - b.overall; })[0];
  assert.ok(star && fringe, 'need both a star and a fringe player under 30');

  const starYears = sample(star), fringeYears = sample(fringe);
  assert.ok(starYears >= 4, 'a star should average 4+ year deals, got ' + starYears.toFixed(2));
  assert.ok(fringeYears <= 2, 'a fringe player should average 2 years or less, got ' + fringeYears.toFixed(2));
  assert.ok(starYears > fringeYears + 1.5,
    'stars must sign clearly longer than fringe players: ' + starYears.toFixed(2) + ' vs ' + fringeYears.toFixed(2));

  // Nobody signs past the age horizon. A 37-year-old on a 5-year deal is how
  // the league fills with unwaivable 42-year-olds.
  const old = PLAYERS_2026.filter(function (p) { return p.age >= 36; })
    .sort(function (a, b) { return b.overall - a.overall; })[0];
  if (old) {
    for (let i = 0; i < 100; i++) {
      const y = fa.contractYearsFor(old, rng);
      assert.ok(old.age + y <= 42, 'a ' + old.age + '-year-old drew a ' + y + '-year deal');
    }
  }
  assert.ok(fa.contractYearsFor(star, rng) <= fa.MAX_CONTRACT_YEARS, 'nothing may exceed the maximum');
  console.log('checkContractLengthTracksQuality: OK (star ' + starYears.toFixed(2) +
    'y, fringe ' + fringeYears.toFixed(2) + 'y)');
}

// The incumbent bonus is the concept scoreOffer did not have. Same team, same
// money — the only difference is whether he already plays there.
function checkIncumbentOfferScoresHigher() {
  const player = PLAYERS_2026.find(function (p) { return p.teamId === 'BOS' && p.overall >= BANDS.rotation; });
  const team = getTeamById('BOS');
  const base = { teamId: 'BOS', salary: 30000000, yearsRemaining: 3 };
  const inc = { teamId: 'BOS', salary: 30000000, yearsRemaining: 3, incumbent: true };
  const plain = fa.scoreOffer(player, team, base);
  const home = fa.scoreOffer(player, team, inc);
  assert.ok(home > plain,
    'an incumbent offer must score higher than the identical outside offer: ' + home + ' vs ' + plain);

  // ...but an unhappy player barely counts it. Without this a re-signing
  // window is a rubber stamp and morale means nothing.
  const originalMorale = player.status.morale;
  player.status.morale = 95;
  const happy = fa.scoreOffer(player, team, inc) - plain;
  player.status.morale = 20;
  const miserable = fa.scoreOffer(player, team, inc) - plain;
  player.status.morale = originalMorale;
  assert.ok(happy > miserable,
    'morale must change how much staying is worth: happy ' + happy.toFixed(4) + ' vs unhappy ' + miserable.toFixed(4));
  assert.ok(miserable < 0, 'a miserable player should be pushed AWAY, got ' + miserable.toFixed(4));
  console.log('checkIncumbentOfferScoresHigher: OK (+' + (home - plain).toFixed(4) +
    ', happy +' + happy.toFixed(4) + ', miserable ' + miserable.toFixed(4) + ')');
}

// The whole point: a team over the cap keeps its own star. Without this the
// good teams — which are the ones over the cap — still lose everyone they
// develop, which is the complaint that started all of it.
function checkOverCapTeamCanRetainItsOwnStar() {
  const team = TEAMS.find(function (t) {
    return 154000000 - league.getTeamPayroll(t.id) < 0;
  });
  assert.ok(team, 'need an over-the-cap team');
  const star = league.getTeamRoster(team.id).sort(function (a, b) { return b.overall - a.overall; })[0];
  const rng = makeRng(11);

  // Precondition: on the open market this same team could not sign him at all.
  // Years passed explicitly so this fails for the CAP reason under test, not
  // because an omitted argument tripped the contract-length check.
  const openMarket = fa.checkOffer(team, 20000000, 3);
  assert.ok(!openMarket.ok, 'precondition: an over-cap team must be barred from the open market');
  assert.ok(/cap space/i.test(openMarket.reason),
    'precondition must fail on cap space, not something else: ' + openMarket.reason);

  const originalContract = star.contract;
  star.contract = { salary: originalContract.salary, yearsRemaining: 0, playerOption: false, teamOption: false };
  const result = fa.runResigningWindow([star], rng, null);
  const kept = star.teamId === team.id && star.contract.yearsRemaining > 0;
  void result;
  assert.ok(kept || result.lost.length === 1,
    'the window must either retain him or explicitly lose him, never leave him in limbo');
  assert.ok(kept, 'an over-cap team must be able to re-sign its OWN star, over the cap');
  assert.ok(star.contract.salary > 0);
  star.contract = originalContract;
  console.log('checkOverCapTeamCanRetainItsOwnStar: OK (' + team.id + ' kept ' + star.name + ')');
}

// First refusal is a decision, not an obligation. A team that does not want a
// player has to be able to let him go, or every roster ossifies and nobody
// ever reaches the market. Deleting the interest bar survived this file until
// this case existed.
function checkTeamsCanDeclineToRetain() {
  const rng = makeRng(51);
  // Selected by the quantity the bar actually reads — adjustedPlayerValue on
  // his own team — not by overall. Picking "lowest overall" gave a player who
  // walked of his own accord, so the test passed for the wrong reason and
  // deleting the bar changed nothing.
  const tradeEvaluator = rq('tradeEvaluator.js');
  const dud = PLAYERS_2026.filter(function (p) { return p.teamId; })
    .sort(function (a, b) {
      return tradeEvaluator.adjustedPlayerValue(a, getTeamById(a.teamId)) -
        tradeEvaluator.adjustedPlayerValue(b, getTeamById(b.teamId));
    })[0];
  const team = getTeamById(dud.teamId);
  const original = dud.contract;
  const originalTeam = dud.teamId;
  const value = tradeEvaluator.adjustedPlayerValue(dud, team);
  assert.ok(value < fa.RESIGN_INTEREST_BAR,
    'precondition: need a player his own team does not want, value ' + value.toFixed(1));

  dud.contract = { salary: original.salary, yearsRemaining: 0, playerOption: false, teamOption: false };
  const result = fa.runResigningWindow([dud], rng, null);
  assert.strictEqual(result.resigned.length, 0,
    'a team must not be forced to re-sign a player it has no interest in (' + dud.name + ', ovr ' + dud.overall + ')');
  assert.strictEqual(result.lost.length, 1, 'and he must be reported as lost');
  // The REASON is the assertion that bites. He is refused by the interest bar,
  // not by his own preference: without checking which, deleting the bar
  // entirely changed no test result, because this player would have walked on
  // his own anyway.
  assert.strictEqual(result.lost[0].reason, 'declined',
    'he must be turned down by the team, not merely choose to leave');
  assert.strictEqual(dud.contract.yearsRemaining, 0, 'his expired contract must not have been replaced');

  dud.contract = original;
  dud.teamId = originalTeam;
  console.log('checkTeamsCanDeclineToRetain: OK (' + team.id + ' let ' + dud.name + ' go, value ' + value.toFixed(1) + ')');
}

// The user's players are not decided for them.
function checkUserTeamIsDeferred() {
  const rng = makeRng(21);
  const roster = league.getTeamRoster('LAL');
  const player = roster.sort(function (a, b) { return b.overall - a.overall; })[0];
  const original = player.contract;
  player.contract = { salary: original.salary, yearsRemaining: 0, playerOption: false, teamOption: false };

  const result = fa.runResigningWindow([player], rng, 'LAL');
  assert.strictEqual(result.deferred.length, 1, 'the user\'s expiring player must be deferred');
  assert.strictEqual(result.resigned.length, 0, 'nothing may be decided for the user');
  assert.ok(player.resignRights, 'he must carry re-sign rights');
  assert.strictEqual(player.teamId, 'LAL', 'and stay on the roster while they are outstanding');
  assert.ok(player.resignRights.salary > 0 && player.resignRights.yearsRemaining > 0,
    'the rights must name a price and a term to show the user');

  // Letting the window close sends him to the market — a right must not
  // survive into the new season, or he sits rostered forever on a zero-year
  // deal that can never expire again.
  fa.releaseUnexercisedResignRights('LAL');
  assert.strictEqual(player.teamId, null, 'an unexercised right must release him');
  assert.ok(!player.resignRights, 'and must not survive');

  player.teamId = 'LAL';
  player.contract = original;
  console.log('checkUserTeamIsDeferred: OK');
}

// Delegating free agency must not quietly cost you your stars.
function checkAutoExerciseKeepsThem() {
  const rng = makeRng(31);
  const roster = league.getTeamRoster('DEN');
  const player = roster.sort(function (a, b) { return b.overall - a.overall; })[0];
  const original = player.contract;
  player.contract = { salary: original.salary, yearsRemaining: 0, playerOption: false, teamOption: false };
  fa.runResigningWindow([player], rng, 'DEN');
  assert.ok(player.resignRights, 'precondition: deferred');

  fa.autoExerciseResignRights('DEN', rng);
  assert.ok(!player.resignRights, 'rights must be spent either way');
  assert.strictEqual(player.teamId, 'DEN', 'his own team should have kept him');
  assert.ok(player.contract.yearsRemaining > 0, 'on a real contract, not the expired one');

  player.contract = original;
  console.log('checkAutoExerciseKeepsThem: OK');
}

// decrementContracts must not release anyone still holding rights, and must
// still release everyone else.
function checkExpiryReleasesOnlyTheUndecided() {
  const rng = makeRng(41);
  const before = PLAYERS_2026.filter(function (p) { return p.teamId; }).length;
  seasonTransition.decrementContracts(rng, 'BOS');
  const stranded = PLAYERS_2026.filter(function (p) {
    return p.teamId && p.contract.yearsRemaining <= 0 && !p.resignRights;
  });
  assert.strictEqual(stranded.length, 0,
    stranded.length + ' players are rostered on an expired contract with no rights');
  const rights = PLAYERS_2026.filter(function (p) { return p.resignRights; });
  // Asserted BEFORE the per-player check below, which is vacuously true when
  // the list is empty — deleting the runResigningWindow call from
  // decrementContracts survived this test until this line existed.
  assert.ok(rights.length > 0,
    'the window must actually have run: no player anywhere holds re-sign rights');
  // Was `strictEqual(p.teamId, 'BOS')` — only the deferred team could hold
  // rights. Restricted free agency widened that: another club's young player
  // is now PARKED with rights too, so the GM has a window to write a competing
  // offer sheet before the incumbent answers. Those carry `open`, and
  // freeAgency.resolveLeagueRestrictedFA clears them when the market opens.
  //
  // The invariant that still has to hold — and the one this line was really
  // protecting — is that nobody holds rights by accident: a right is either
  // the user's own decision or an open restricted case, never a stray.
  rights.forEach(function (p) {
    if (p.teamId !== 'BOS') {
      assert.ok(p.resignRights.open,
        'a non-deferred team may only hold OPEN restricted rights, found a stray on ' + p.teamId);
      assert.ok(p.resignRights.offerSheet,
        'an open restricted right must carry the sheet the incumbent has to answer');
      return;
    }
  });
  // ...and it must have DECIDED for everyone else. Somebody, somewhere, has to
  // have been kept by his own team through this call.
  const resignedByAi = PLAYERS_2026.filter(function (p) {
    return p.teamId && p.teamId !== 'BOS' && p.contract.yearsRemaining > 0 &&
      (p.careerHistory && p.careerHistory.contractHistory || []).some(function (c) { return c.type === 're_signing'; });
  });
  assert.ok(resignedByAi.length > 0,
    'AI teams must have re-signed somebody — 437 contracts across 5 offseasons used to produce zero');
  assert.ok(PLAYERS_2026.filter(function (p) { return p.teamId; }).length < before,
    'somebody must have reached the market');
  console.log('checkExpiryReleasesOnlyTheUndecided: OK (' + rights.length + ' deferred to BOS, ' +
    resignedByAi.length + ' re-signed by AI teams)');
}

// There are TWO routes into the offseason — the automatic one through
// runOffseasonThroughDraft, and the manual-draft one in script.js that reaches
// runOffseasonPreDraft directly — and the user's team id has to travel down
// both. It did not: script.js's runInteractiveDraft omitted it, so a manual
// drafter got no re-signing window at all and every expiring player was
// released before they saw the screen. Node validators all passed; only
// opening the game caught it.
//
// Checked statically because the manual route lives in script.js, which Node
// cannot load. Same reasoning as validate-browserBridges.
function checkBothOffseasonRoutesPassTheUserTeam() {
  const fs = require('fs');
  function argsAt(src, callIdx, name) {
    const open = src.indexOf('(', callIdx + name.length - 1);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return '';
  }
  function callSites(file, name) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const out = [];
    let i = 0;
    while ((i = src.indexOf(name + '(', i)) !== -1) {
      // Skip the declaration itself.
      const before = src.slice(Math.max(0, i - 9), i);
      if (!/function\s*$/.test(before)) out.push({ file: file, args: argsAt(src, i, name) });
      i += name.length;
    }
    return out;
  }

  const preDraft = callSites('script.js', 'runOffseasonPreDraft')
    .concat(callSites('seasonTransition.js', 'runOffseasonPreDraft'));
  assert.ok(preDraft.length > 0, 'expected at least one runOffseasonPreDraft call site');
  preDraft.forEach(function (c) {
    const argc = c.args.split(',').length;
    assert.ok(argc >= 3,
      c.file + ' calls runOffseasonPreDraft with ' + argc + ' arguments — the third is the ' +
      'user team whose expiring players must be deferred, and without it that route has no ' +
      're-signing window at all. Got: (' + c.args.trim() + ')');
  });

  const throughDraft = callSites('seasonRollover.js', 'runOffseasonThroughDraft');
  assert.ok(throughDraft.length > 0, 'expected at least one runOffseasonThroughDraft call site');
  throughDraft.forEach(function (c) {
    const argc = c.args.split(',').length;
    assert.ok(argc >= 6,
      c.file + ' calls runOffseasonThroughDraft with ' + argc + ' arguments, needs 6 (the ' +
      'sixth is the deferred user team)');
  });
  console.log('checkBothOffseasonRoutesPassTheUserTeam: OK (' +
    (preDraft.length + throughDraft.length) + ' call sites)');
}

checkBothOffseasonRoutesPassTheUserTeam();
checkContractLengthTracksQuality();
checkIncumbentOfferScoresHigher();
checkOverCapTeamCanRetainItsOwnStar();
checkTeamsCanDeclineToRetain();
checkUserTeamIsDeferred();
checkAutoExerciseKeepsThem();
checkExpiryReleasesOnlyTheUndecided();

console.log('All re-signing validations passed');
