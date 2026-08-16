// Every ultimate is DERIVED, never authored and never rolled. These tests build
// synthetic players with a deliberately lopsided profile and assert the
// derivation picks the matching ultimate — which is also the only way to prove
// all twelve are reachable rather than four of them soaking up every player.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data.js'));
require(path.join(ROOT, 'rng.js'));
require(path.join(ROOT, 'ratings.js'));
const ult = require(path.join(ROOT, 'ultimates.js'));

const ATTRS = data.ATTRIBUTE_KEYS;

// A player who is exactly average everywhere, so a test can raise ONE thing and
// know the derivation responded to that and nothing else.
function flatPlayer(over) {
  const attributes = {};
  ATTRS.forEach(function (k) { attributes[k] = 50; });
  return Object.assign({
    id: 'test1', name: 'Test Player', overall: 95,
    attributes: attributes, hiddenTraits: []
  }, over || {});
}

function withAttrs(raised, over) {
  const p = flatPlayer(over);
  Object.keys(raised).forEach(function (k) { p.attributes[k] = raised[k]; });
  return p;
}

function checkGate() {
  const gate = ult.ULTIMATE_TUNING.gateOverall;
  assert.ok(ult.hasUltimate(flatPlayer({ overall: gate })), 'exactly at the gate qualifies');
  assert.ok(!ult.hasUltimate(flatPlayer({ overall: gate - 1 })), 'one under does not');
  assert.strictEqual(ult.ultimateFor(flatPlayer({ overall: gate - 1 })), null,
    'a non-star has no ultimate at all, not a default one');
  console.log('checkGate: OK (gate ' + gate + ')');
}

// The trap this guards: RATING_BANDS live on the DISPLAY scale. Gating on
// rawOverall would admit a wildly different set of players and the bug would be
// invisible — everything would still "work", just for the wrong 200 people.
function checkGateUsesDisplayOverall() {
  const p = flatPlayer({ overall: ult.ULTIMATE_TUNING.gateOverall, rawOverall: 1 });
  assert.ok(ult.hasUltimate(p), 'the gate reads overall, not rawOverall');
  console.log('checkGateUsesDisplayOverall: OK');
}

function checkEveryUltimateIsReachable() {
  // One lopsided profile per ultimate. If a taxonomy entry can never win the
  // derivation it is decorative, which is the failure this catches.
  const cases = {
    heatCheck: { threePoint: 99, basketballIQ: 90 },
    silky: { midRange: 99, basketballIQ: 90 },
    paintBeast: { insideScoring: 99, postScoring: 95, strength: 90 },
    downhill: { ballHandling: 99, passing: 80, speed: 95, acceleration: 95 },
    aboveTheRim: { vertical: 99, acceleration: 97 },
    andOne: { strength: 99, freeThrow: 97 },
    glassWrecker: { offReb: 99, defReb: 99, strength: 90, vertical: 90 },
    coldBlooded: { basketballIQ: 99 },
    clamps: { perimeterDefense: 99, steal: 95, speed: 90 },
    motorNeverStops: { workEthic: 99 },
    floorGeneral: { passing: 99, ballHandling: 85, basketballIQ: 88 },
    theWall: { interiorDefense: 99, block: 95, strength: 90 }
  };
  Object.keys(cases).forEach(function (key) {
    assert.ok(ult.ULTIMATE_BY_KEY[key], 'unknown ultimate in test: ' + key);
    const got = ult.ultimateFor(withAttrs(cases[key]));
    assert.ok(got, key + ': derivation returned null for a qualifying star');
    assert.strictEqual(got.key, key,
      key + ': expected ' + key + ', got ' + got.key);
  });
  assert.strictEqual(Object.keys(cases).length, ult.ULTIMATE_TAXONOMY.length,
    'every taxonomy entry needs a reachability case');
  console.log('checkEveryUltimateIsReachable: OK (' + ult.ULTIMATE_TAXONOMY.length + ' ultimates)');
}

function checkDerivationIsDeterministic() {
  const p = withAttrs({ threePoint: 99 });
  const a = ult.ultimateFor(p), b = ult.ultimateFor(p);
  assert.strictEqual(a.key, b.key, 'the same player must always derive the same ultimate');
  console.log('checkDerivationIsDeterministic: OK');
}

function checkBadgeBoost() {
  const plain = withAttrs({ threePoint: 99 });
  assert.strictEqual(ult.badgeBoostFor(plain, ult.ultimateFor(plain)), 1,
    'no matching badge means no boost');
  const legend = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'legendary' }] });
  assert.ok(ult.badgeBoostFor(legend, ult.ultimateFor(legend)) > 1,
    'a matching legendary badge boosts the takeover');
  const bronze = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'sharpshooter', tier: 'bronze' }] });
  assert.strictEqual(ult.badgeBoostFor(bronze, ult.ultimateFor(bronze)), 1,
    'only legendary and secret tiers boost — lower tiers do not');
  const wrong = withAttrs({ threePoint: 99 },
    { hiddenTraits: [{ key: 'rimProtector', tier: 'legendary' }] });
  assert.strictEqual(ult.badgeBoostFor(wrong, ult.ultimateFor(wrong)), 1,
    'a legendary badge that does not match the ultimate gives nothing');
  console.log('checkBadgeBoost: OK');
}

function checkTaxonomyShape() {
  const seen = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(!seen[u.key], 'duplicate ultimate key: ' + u.key);
    seen[u.key] = true;
    assert.ok(u.name && u.name.length, u.key + ' needs a display name');
    assert.ok(u.kind === 'solo' || u.kind === 'team', u.key + ' kind must be solo or team');
    assert.ok(u.side === 'offense' || u.side === 'defense', u.key + ' side must be offense or defense');
    assert.ok(u.derive && (u.derive.composite || u.derive.attributes),
      u.key + ' needs a derivation source');
  });
  const team = ult.ULTIMATE_TAXONOMY.filter(function (u) { return u.kind === 'team'; });
  assert.strictEqual(team.length, 2, 'exactly two team ultimates, one per end of the floor');
  assert.strictEqual(team.filter(function (u) { return u.side === 'offense'; }).length, 1);
  assert.strictEqual(team.filter(function (u) { return u.side === 'defense'; }).length, 1);
  console.log('checkTaxonomyShape: OK');
}

// The synthetic tests above prove each ultimate CAN be derived. They do not
// prove anybody actually gets one, and that is exactly the gap that hid a real
// defect: with the first three normalisers, Paint Beast was reachable in theory
// and held by NOBODY in the league, while Cold Blooded, And-One and Motor Never
// Stops captured every elite big. Reachability and holdership are different
// claims and both need asserting.
function leaguePlayers() {
  require(path.join(ROOT, 'teams.js'));
  const traits = require(path.join(ROOT, 'traits.js'));
  require(path.join(ROOT, 'scouting.js'));
  const players = require(path.join(ROOT, 'players-2026.js')).PLAYERS_2026;
  traits.ensureHiddenPlayerData(players);
  return players;
}

function holdingsByUltimate() {
  // The snapshot is part of the contract now: the game takes one at init,
  // load, and rollover, and the diversity pass that keeps every ultimate
  // held lives inside it. Checking without one checks a state the game is
  // never in.
  ult.setLeagueGate(leaguePlayers());
  const by = {};
  leaguePlayers().forEach(function (p) {
    if (!ult.hasUltimate(p)) return;
    const u = ult.ultimateFor(p);
    by[u.key] = (by[u.key] || 0) + 1;
  });
  return by;
}

function checkHolderCountBand() {
  const holders = leaguePlayers().filter(function (p) { return ult.hasUltimate(p); });
  assert.ok(holders.length >= 30 && holders.length <= 60,
    'holders league-wide is ' + holders.length + ', outside the 30-60 band');
  console.log('checkHolderCountBand: OK (' + holders.length + ' holders)');
}

function checkEveryUltimateIsHeldInTheLeague() {
  const by = holdingsByUltimate();
  const unheld = ult.ULTIMATE_TAXONOMY
    .filter(function (u) { return !by[u.key]; })
    .map(function (u) { return u.key; });
  assert.strictEqual(unheld.length, 0,
    'nobody in the league holds: ' + unheld.join(', ') +
    ' — an ultimate the reference page prints and the league never grants');
  console.log('checkEveryUltimateIsHeldInTheLeague: OK (all 12 held)');
}

// One ultimate soaking up the elite is the same defect wearing a different hat:
// it means the derivation is measuring "is this player good" rather than "what
// is he best at".
function checkNoUltimateDominates() {
  const by = holdingsByUltimate();
  const total = Object.keys(by).reduce(function (s, k) { return s + by[k]; }, 0);
  const worst = Object.keys(by).reduce(function (m, k) { return by[k] > by[m] ? k : m; }, Object.keys(by)[0]);
  const share = by[worst] / total;
  assert.ok(share <= 0.40, worst + ' holds ' + (100 * share).toFixed(0) +
    '% of all ultimates — the derivation is measuring quality, not distinctiveness');
  console.log('checkNoUltimateDominates: OK (largest share ' + worst + ' at ' +
    (100 * share).toFixed(0) + '%)');
}

const CT = ult.CHARGE_TUNING;

function checkGainsAndDrains() {
  const flat = 1;   // neutral situation, so this tests the play values alone
  ult.PLAY_KINDS.forEach(function (kind) {
    const v = ult.chargeGain('heatCheck', kind, flat);
    assert.strictEqual(typeof v, 'number', kind + ' must produce a number');
    assert.ok(!isNaN(v), kind + ' produced NaN');
  });
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > 0, 'a made three fills');
  assert.ok(ult.chargeGain('heatCheck', 'turnover', flat) < 0, 'a turnover drains');
  assert.ok(ult.chargeGain('heatCheck', 'missedShot', flat) < 0, 'a miss drains');
  assert.ok(ult.chargeGain('heatCheck', 'foul', flat) < 0, 'a foul drains');
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', flat) > ult.chargeGain('heatCheck', 'madeTwo', flat),
    'a made three is worth more than a made two');
  assert.strictEqual(ult.chargeGain('heatCheck', 'notAPlayKind', flat), 0,
    'an unknown play kind earns nothing rather than throwing');
  console.log('checkGainsAndDrains: OK');
}

// A drain must not shrink in a blowout. If the situation scaled both sides, a
// star could pad his meter in garbage time at no risk, which is the opposite of
// what the multiplier is for.
function checkDrainsIgnoreTheSituation() {
  const close = ult.situationMultiplier('heatCheck', 0, 4);
  const blowout = ult.situationMultiplier('heatCheck', 30, 1);
  assert.ok(close > blowout, 'fixture is wrong: a close fourth must out-multiply a blowout');
  assert.strictEqual(ult.chargeGain('heatCheck', 'turnover', close),
    ult.chargeGain('heatCheck', 'turnover', blowout),
    'a turnover costs the same whatever the score');
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', close) >
    ult.chargeGain('heatCheck', 'madeThree', blowout),
    'but a made three is worth more in a close fourth');
  console.log('checkDrainsIgnoreTheSituation: OK');
}

function checkAffinity() {
  // The same play is worth more to the ultimate it belongs to. This is what
  // makes Glass Wrecker charge off boards instead of off scoring.
  assert.ok(ult.chargeGain('heatCheck', 'madeThree', 1) > ult.chargeGain('glassWrecker', 'madeThree', 1),
    'a three charges Heat Check faster than Glass Wrecker');
  assert.ok(ult.chargeGain('glassWrecker', 'rebound', 1) > ult.chargeGain('heatCheck', 'rebound', 1),
    'a board charges Glass Wrecker faster than Heat Check');
  // Every ultimate needs a currency, or it charges at the same flat rate as a
  // player with no ultimate at all.
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const aff = ult.CHARGE_AFFINITY[u.key];
    assert.ok(aff && aff.length, u.key + ' has no charge affinity — it would fill generically');
    aff.forEach(function (k) {
      assert.ok(ult.PLAY_KINDS.indexOf(k) !== -1, u.key + ' charges on unknown play kind ' + k);
      assert.ok(CT.gains[k] > 0, u.key + ' charges on ' + k + ', which is a DRAIN');
    });
  });
  console.log('checkAffinity: OK');
}

function checkSituation() {
  const level = ult.situationMultiplier('heatCheck', 0, 1);
  assert.ok(ult.situationMultiplier('heatCheck', 0, 4) > level, 'the fourth quarter is worth more');
  assert.ok(ult.situationMultiplier('heatCheck', 0, 5) > ult.situationMultiplier('heatCheck', 0, 4),
    'overtime is worth more than the fourth');
  // Compared at the SAME margin, so this tests trailing and not closeness.
  assert.ok(ult.situationMultiplier('heatCheck', -6, 1) > ult.situationMultiplier('heatCheck', 6, 1),
    'trailing by six is worth more than leading by six');
  assert.ok(ult.situationMultiplier('heatCheck', 30, 1) < level, 'a blowout is worth less');
  console.log('checkSituation: OK');
}

// Cold Blooded is the whole reason the situation multiplier takes the ultimate
// as an argument rather than just the game state.
function checkColdBloodedIgnoresEarlyGame() {
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 1), 0, 'Q1 earns nothing');
  assert.strictEqual(ult.situationMultiplier('coldBlooded', 0, 3), 0, 'Q3 earns nothing');
  assert.ok(ult.situationMultiplier('coldBlooded', 0, 4) > 0, 'the fourth earns');
  assert.ok(ult.situationMultiplier('coldBlooded', 25, 4) < ult.situationMultiplier('coldBlooded', 0, 4),
    'and only really when the game is close');
  // No other ultimate may be late-game-only by accident.
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    if (u.key === 'coldBlooded') return;
    assert.ok(ult.situationMultiplier(u.key, 0, 1) > 0, u.key + ' must charge in the first quarter');
  });
  console.log('checkColdBloodedIgnoresEarlyGame: OK');
}

function checkThresholdRises() {
  const first = ult.chargeThreshold(0);
  const second = ult.chargeThreshold(1);
  assert.strictEqual(first, CT.full, 'the first takeover costs a full meter');
  assert.ok(second > first, 'a second takeover must cost more than the first');
  assert.ok(ult.chargeThreshold(2) > second, 'and a third more than the second');
  console.log('checkThresholdRises: OK (' + first + ' then ' + second.toFixed(0) + ')');
}

function checkTakeoverLength() {
  const normal = ult.takeoverLength('heatCheck');
  assert.strictEqual(normal, CT.takeoverPossessions);
  assert.ok(ult.takeoverLength('motorNeverStops') > normal * 2,
    'Motor Never Stops runs at least twice as long — attrition is its whole idea');
  console.log('checkTakeoverLength: OK');
}

// ---------------------------------------------------------------------------
// Season-level guards. These sim a real season through league.simulateDate, so
// they are the slow part of this file — but they are also the only assertions
// that can catch the two defects that actually happened during development: an
// ultimate nobody holds, and an ultimate that fires for nobody.
//
// Set SKIP_SEASON=1 to skip them while iterating on the pure tests.
// ---------------------------------------------------------------------------
const SKIP_SEASON = !!process.env.SKIP_SEASON;

let _season = null;
function simulatedSeason() {
  if (_season) return _season;
  const f = gameFixture();
  const league = require(path.join(ROOT, 'league.js'));
  const schedule = require(path.join(ROOT, 'schedule.js'));
  const teams = require(path.join(ROOT, 'teams.js')).TEAMS;
  const games = schedule.generateSeasonGames(f.makeRng(4242), teams).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day,
      played: false, homeScore: null, awayScore: null, boxScore: null,
      isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const rng = f.makeRng(4242);
  const lastDay = games.reduce(function (m, g) { return Math.max(m, g.day); }, 0);
  for (let d = 0; d <= lastDay; d++) {
    league.simulateDate(season, d, { leagueYear: 2026 }, rng, null, null);
  }
  const holderKey = {};
  f.players.forEach(function (p) {
    if (ult.hasUltimate(p)) holderKey[p.id] = ult.ultimateFor(p).key;
  });
  const stat = { played: 0, takeovers: 0, points: [], byUltimate: {}, teamPts: 0, teamGames: 0,
                 holderGames: {}, pointsByUltimate: {},
                 seasonPts: {}, seasonGp: {}, bestGame: 0, eightyPointGames: 0,
                 cutShortPoints: [], runLengths: [] };
  games.forEach(function (g) {
    if (!g.played || !g.boxScore) return;
    stat.played += 1;
    stat.teamPts += g.homeScore + g.awayScore;
    stat.teamGames += 2;
    // Points are read from the takeover LOG, not the box line, for two reasons:
    // a box line holds only the most recent takeover when a player had two, and
    // only the log knows whether the final buzzer cut one short.
    (g.takeovers || []).forEach(function (t) {
      if (t.cutShort) stat.cutShortPoints.push(t.points);
      else stat.points.push(t.points);
      stat.runLengths.push({ run: t.run, points: t.points, key: holderKey[t.playerId] });
    });
    Object.keys(g.boxScore).forEach(function (pid) {
      // Every player, not just holders — the scoring-leader guard has to see
      // the whole league.
      const pts = g.boxScore[pid].points || 0;
      stat.seasonPts[pid] = (stat.seasonPts[pid] || 0) + pts;
      stat.seasonGp[pid] = (stat.seasonGp[pid] || 0) + 1;
      if (pts > stat.bestGame) stat.bestGame = pts;
      if (pts >= 80) stat.eightyPointGames += 1;
      const k = holderKey[pid];
      const line = g.boxScore[pid];
      if (!k || !line || line.takeoversUsed === undefined) return;
      stat.takeovers += line.takeoversUsed;
      stat.byUltimate[k] = (stat.byUltimate[k] || 0) + line.takeoversUsed;
      stat.holderGames[k] = (stat.holderGames[k] || 0) + 1;
      if (line.takeoverPoints > 0) {
        (stat.pointsByUltimate[k] = stat.pointsByUltimate[k] || []).push(line.takeoverPoints);
      }
    });
  });
  const ppgs = Object.keys(stat.seasonPts)
    .filter(function (id) { return stat.seasonGp[id] >= 40; })
    .map(function (id) { return stat.seasonPts[id] / stat.seasonGp[id]; })
    .sort(function (a, b) { return b - a; });
  stat.leaderPpg = ppgs[0] || 0;
  stat.top5MeanPpg = ppgs.slice(0, 5).reduce(function (a, b) { return a + b; }, 0) /
    Math.max(1, Math.min(5, ppgs.length));
  _season = stat;
  return _season;
}

// The measured pre-ultimates figure, taken by raising gateOverall to 101 so
// nobody holds an ultimate at all. Five seeds on the 38-minute clock:
// 108.90 / 109.07 / 108.29 / 109.02 / 108.99, mean 108.85, spread 0.78. The
// same five with ultimates on run 109.63 / 109.66 / 109.53 / 110.35 / 109.49,
// mean 109.73.
//
// So the delta is +0.88, or 0.81% of the league. Worth recording that this is
// where it settled after wandering: it was +0.26 on 134.86 (0.19%) at the
// original pace, went to +1.06 (0.96%) when the 15.4s clock made each
// reassigned shot a bigger share of a shorter game, and came back to 0.81%
// here — and it came back while CHARGE_TUNING.full dropped 200 -> 160, which
// fires MORE takeovers. That is the constraint doing its job: a takeover
// hands its holder ~13 points and the league about one, so making them
// commoner moves who scores without moving how much gets scored.
//
// The tolerance clears that delta plus the run-to-run spread (0.88 + 0.78 =
// 1.66) rather than being carried over from a different league. The original
// 1.5 was fitted to a +0.26 delta and has no headroom for this one.
const LEAGUE_SCORING_BASELINE = 108.85;
const LEAGUE_SCORING_TOLERANCE = 2.0;

// THE GOVERNING CONSTRAINT. Takeovers redistribute scoring toward stars; they
// must not add scoring to the league. Every balance property already measured —
// a superstar worth ~10 wins alone but ~6 beside another star, champions
// ranking 2nd-3rd, league-best records at 68-76 wins — is measured against
// league scoring, so holding it still is what protects all of them.
//
// It needed NO rebalancing, and the reason is structural rather than lucky:
// POSSESSIONS_PER_TEAM is fixed at 90, so a takeover cannot manufacture extra
// shots. It reassigns shots the team was going to take anyway from team-mates
// to the holder. The holder gains 13 points a takeover, but almost all of those
// are points a team-mate would otherwise have scored; the team's net gain is
// only the holder's efficiency edge over the man he displaced, which is small.
//
// Measured, five seeds before against four after:
//   before  134.45 134.78 134.99 135.01 135.09   mean 134.86
//   after   134.53 135.10 135.33 135.52          mean 135.12
// A +0.26 difference against a 0.64-wide baseline spread.
//
// This is also the reason the constraint is worth asserting rather than
// assuming: it holds because possessions are capped. Any future change that
// lets a takeover extend a possession, draw an extra shot, or add a trip down
// the floor breaks it, and this is the test that would say so.
function checkLeagueScoringHeldFlat() {
  const s = simulatedSeason();
  const avg = s.teamPts / s.teamGames;
  assert.ok(Math.abs(avg - LEAGUE_SCORING_BASELINE) <= LEAGUE_SCORING_TOLERANCE,
    'league scoring is ' + avg.toFixed(2) + ', baseline ' + LEAGUE_SCORING_BASELINE +
    ' — takeovers must redistribute scoring, not add it');
  console.log('checkLeagueScoringHeldFlat: OK (' + avg.toFixed(2) + ')');
}

// League scoring being flat says nothing about how it is DISTRIBUTED, and the
// first build of this feature proved it: the total was inside its band while
// the scoring leader ran to 51.4 ppg and one game reached 90 points. The engine
// caps any player at 50% of his team's shot weight specifically to stop
// 40-point seasons, and lifting that cap for a takeover undid it.
//
// THE FIRST VERSION OF THESE BARS WAS FITTED TO ONE SEED AND WAS ALREADY WRONG
// when it was written. It read "leader 44.5, best game 75" and set 47 and 82.
// Re-measured across four seeds, the very build those numbers came from
// produced a 46.8 ppg leader and an 86-point game — it would have failed its
// own guard on seed 7. A maximum over twenty-five thousand player-games is
// nearly all tail noise, and pinning a bar just above one sample of it
// guarantees a flaky test and an argument about whether the code regressed.
//
// Measured across seeds 4242 / 7 / 99 / 1234:
//
//                    leader ppg     top-5 mean ppg     games >= 80 points
//   ultimates off    41.2 - 43.4    39.6 - 40.1               0
//   before runway    44.7 - 46.8    42.6 - 43.8             0 - 1
//   after runway     44.8 - 46.8    42.6 - 43.8             0 - 1
//
// The two builds are indistinguishable at the top end, which is the point: the
// runway rule gives takeovers their full run without giving anyone a bigger
// night. The usage-led build these bars exist to catch produced a 51.4 leader
// and a 90-point game, and is still caught by all three.
//
// Note how much steadier the top-5 mean is than the leader — 1.2 points of
// spread against 2.1 — and the same for a count of 80-point games against the
// single best game. Both primary bars are therefore set on the steady
// statistic, with the noisy one kept only as a far-away backstop. A bar pinned
// just above one sample of a maximum is a coin flip wearing a lab coat.
// Tightened when PICK_CEILING.shooter dropped 0.50 -> 0.30 (user call: a
// ~50 ppg season leader is too much). Measured here at the new cap: top
// five average 36.8, leader 38.5, best game 83, one 80+ night. The bars sit
// far enough above those to absorb seed noise while failing if the old
// 49-ppg behavior ever creeps back.
const MAX_TOP5_MEAN_PPG = 42;
const MAX_EIGHTY_POINT_GAMES = 4;
const HARD_MAX_LEADER_PPG = 45;
const HARD_MAX_SINGLE_GAME = 90;

function checkScoringLeadersInBand() {
  const s = simulatedSeason();
  assert.ok(s.top5MeanPpg <= MAX_TOP5_MEAN_PPG,
    'the top five scorers average ' + s.top5MeanPpg.toFixed(1) + ' ppg, over the ' +
    MAX_TOP5_MEAN_PPG + ' ceiling — league TOTAL scoring cannot see this');
  assert.ok(s.eightyPointGames <= MAX_EIGHTY_POINT_GAMES,
    s.eightyPointGames + ' games of 80+ points in one season, over the ' +
    MAX_EIGHTY_POINT_GAMES + ' ceiling — a career night has stopped being rare');
  assert.ok(s.leaderPpg <= HARD_MAX_LEADER_PPG,
    'season scoring leader is ' + s.leaderPpg.toFixed(1) + ' ppg, past the ' +
    HARD_MAX_LEADER_PPG + ' point of no return');
  assert.ok(s.bestGame <= HARD_MAX_SINGLE_GAME,
    'best single game is ' + s.bestGame + ' points, past the ' +
    HARD_MAX_SINGLE_GAME + ' point of no return');
  console.log('checkScoringLeadersInBand: OK (top five average ' + s.top5MeanPpg.toFixed(1) +
    ' ppg, leader ' + s.leaderPpg.toFixed(1) + ', best game ' + s.bestGame +
    ', ' + s.eightyPointGames + ' games of 80+)');
}

function checkTakeoverRateBand() {
  const s = simulatedSeason();
  const perGame = s.takeovers / s.played;
  assert.ok(perGame >= 0.7 && perGame <= 1.4,
    'takeovers per game is ' + perGame.toFixed(3) + ', outside the 0.7-1.4 band');
  console.log('checkTakeoverRateBand: OK (' + perGame.toFixed(3) + ' per game)');
}

// The design asks for 10-15 points "over the stretch", so the band is measured
// over takeovers that GOT their stretch. About 45% are cut short by the final
// buzzer — not a defect but a consequence of the situation multiplier making
// charge accrue fastest in the fourth, so takeovers cluster late and many begin
// with less than twenty-six possessions left in the game.
//
// Both numbers are printed, and the cut-short mean has a floor of its own: if
// it ever collapsed toward zero it would mean takeovers were firing so late
// they did nothing at all, which the per-game rate alone would not reveal.
function checkPointsAddedBand() {
  const s = simulatedSeason();
  const mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  // EVERY takeover, not just the ones that survived. Averaging only the
  // survivors is what let this feature report 12.9 points while two thirds of
  // its takeovers were quietly worth six.
  const everyOne = s.points.concat(s.cutShortPoints);
  const all = mean(everyOne);
  assert.ok(all >= 10 && all <= 15,
    'the average takeover is worth ' + all.toFixed(1) + ' points, outside the 10-15 band');

  // The buzzer share is now the guard on the runway rule, and it is set near
  // zero because the runway rule is what holds it there. It was 63% before:
  // a takeover is 26 possessions, a quarter holds about 29 a side, so anything
  // firing inside the fourth was amputated by arithmetic. gameSim.js now
  // declares the run against the game remaining and refuses to start one that
  // has no room, so a takeover ending early means that rule has stopped working
  // — not that the timing drifted.
  const cutShare = s.cutShortPoints.length / everyOne.length;
  assert.ok(cutShare <= 0.05,
    (100 * cutShare).toFixed(0) + '% of takeovers are cut short by the buzzer — the ' +
    'runway rule in gameSim.js should be holding this near zero');

  // And a short run must still be a real one, or refusing to fire has just
  // moved the fizzle rather than removed it.
  // Against the ultimate's OWN full length, not the default 26 — Cold Blooded's
  // whole run is 12, and calling that clock-capped would mean every one of its
  // takeovers gets counted as a shortfall it never had.
  const shortRuns = s.runLengths.filter(function (r) {
    return r.key && r.run < ult.takeoverLength(r.key);
  });
  if (shortRuns.length) {
    const shortMean = mean(shortRuns.map(function (r) { return r.points; }));
    assert.ok(shortMean >= 5,
      'a clock-capped takeover is worth only ' + shortMean.toFixed(1) +
      ' points — minRunPossessions is too low to be worth firing');
  }
  console.log('checkPointsAddedBand: OK (' + all.toFixed(1) + ' points per takeover, ' +
    (100 * cutShare).toFixed(1) + '% cut short, ' +
    (100 * shortRuns.length / everyOne.length).toFixed(0) + '% clock-capped)');
}

// An ultimate that exists, is held, and never fires is as dead as one nobody
// holds. This is the assertion that caught the 29x rate spread.
function checkEveryUltimateFiresInASeason() {
  const s = simulatedSeason();
  const silent = ult.ULTIMATE_TAXONOMY
    .filter(function (u) { return !s.byUltimate[u.key]; })
    .map(function (u) { return u.key; });
  assert.strictEqual(silent.length, 0,
    'these ultimates never fired in a whole season: ' + silent.join(', '));
  console.log('checkEveryUltimateFiresInASeason: OK (all 12 fired)');
}

// League scoring is BLIND to a single overpowered ultimate. Measured: making
// Heat Check absurd (shot share 6.0, +45% on threes) left league scoring inside
// its band, because exactly one player in the 2026 league holds Heat Check and
// one man cannot move a 1,230-game average. These two guards are what actually
// catch that — they look at each ultimate on its own rather than at the league
// total.
//
// Shipped: worst per-ultimate mean is 21.3 (Paint Beast, one holder), spread
// 8.4x. Under the overpowered mutant: 27.8 and 21.7x.
const WORST_ULTIMATE_MEAN_POINTS = 24;
const MAX_RATE_SPREAD = 13;

function checkNoUltimateIsWildlyOverpowered() {
  const s = simulatedSeason();
  let worst = null, worstMean = 0;
  Object.keys(s.pointsByUltimate).forEach(function (k) {
    const arr = s.pointsByUltimate[k];
    const mean = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    if (mean > worstMean) { worstMean = mean; worst = k; }
  });
  assert.ok(worstMean <= WORST_ULTIMATE_MEAN_POINTS,
    worst + ' adds ' + worstMean.toFixed(1) + ' points a takeover, over the ' +
    WORST_ULTIMATE_MEAN_POINTS + ' ceiling — league scoring cannot see one ' +
    'overpowered ultimate, so this is the check that has to');
  console.log('checkNoUltimateIsWildlyOverpowered: OK (worst ' + worst + ' at ' +
    worstMean.toFixed(1) + ')');
}

// An ultimate that fires ten times more often than another is not "rarer", it
// is a different feature. Some spread is real and unavoidable — three ultimates
// have a single holder each, so their rate IS one player's rate.
function checkRateSpreadIsBounded() {
  const s = simulatedSeason();
  const rates = Object.keys(s.holderGames).map(function (k) {
    return (s.byUltimate[k] || 0) / s.holderGames[k];
  }).filter(function (r) { return r > 0; });
  const spread = Math.max.apply(null, rates) / Math.min.apply(null, rates);
  assert.ok(spread <= MAX_RATE_SPREAD,
    'takeover rate spans ' + spread.toFixed(1) + 'x across ultimates, over the ' +
    MAX_RATE_SPREAD + 'x ceiling');
  console.log('checkRateSpreadIsBounded: OK (' + spread.toFixed(1) + 'x)');
}

checkGate();
checkGateUsesDisplayOverall();
checkEveryUltimateIsReachable();
checkDerivationIsDeterministic();
checkBadgeBoost();
checkTaxonomyShape();
// The engine reports plays; ultimates.js prices them. If the engine ever
// reports a kind the pricing table does not know, that player's meter silently
// stops filling for the rest of the game — so the two lists are asserted to
// agree STATICALLY, by reading the engine's source, rather than by hoping a
// simulated game happens to hit every branch.
// Drives real games and asserts the meter machinery ran. Needs the whole engine
// stack, so it is loaded lazily — the pure tests above must keep working
// without a league.
let _fixture = null;
function gameFixture() {
  if (_fixture) return _fixture;
  require(path.join(ROOT, 'teams.js'));
  const traits = require(path.join(ROOT, 'traits.js'));
  require(path.join(ROOT, 'scouting.js'));
  const players = require(path.join(ROOT, 'players-2026.js'));
  traits.ensureHiddenPlayerData(players.PLAYERS_2026);
  require(path.join(ROOT, 'simEngine.js'));
  require(path.join(ROOT, 'simEngineBoxScore.js'));
  require(path.join(ROOT, 'simEnginePossession.js'));
  require(path.join(ROOT, 'gameCoach.js'));
  _fixture = {
    gameSim: require(path.join(ROOT, 'gameSim.js')),
    makeRng: require(path.join(ROOT, 'rng.js')).makeRng,
    players: players.PLAYERS_2026
  };
  return _fixture;
}

// A matchup with a genuine star on each side, so a test never fails merely
// because it drew two teams with nobody who qualifies.
const FIXTURE_HOME = 'DEN', FIXTURE_AWAY = 'MIL';

function checkTakeoversFireInARealGame() {
  const f = gameFixture();
  let starts = 0, ends = 0;
  for (let s = 0; s < 12; s++) {
    const events = [];
    f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(1000 + s), { events: events });
    events.forEach(function (e) {
      if (e.type === 'takeover-start') {
        starts += 1;
        assert.ok(e.playerId, 'a takeover-start must name the player');
        assert.ok(ult.ULTIMATE_BY_KEY[e.ultimateKey],
          'a takeover-start must name a real ultimate, got ' + e.ultimateKey);
        assert.ok(e.period >= 1, 'and must be stamped with the period it happened in');
      }
      if (e.type === 'takeover-end') ends += 1;
    });
  }
  assert.ok(starts > 0, 'no takeover fired in twelve games — the meter never reaches its threshold');
  // At most one can still be running per side when the buzzer goes.
  assert.ok(ends >= starts - 24, 'takeovers must end rather than leak past the final buzzer');
  console.log('checkTakeoversFireInARealGame: OK (' + starts + ' starts, ' + ends + ' ends)');
}

// A non-star must never charge, or the "top 30-60 players" gate is a lie the
// box score would eventually expose.
function checkOnlyStarsTakeOver() {
  const f = gameFixture();
  const byId = {};
  f.players.forEach(function (p) { byId[p.id] = p; });
  let checked = 0;
  for (let s = 0; s < 6; s++) {
    const events = [];
    f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(300 + s), { events: events });
    events.filter(function (e) { return e.type === 'takeover-start'; }).forEach(function (e) {
      checked += 1;
      assert.ok(ult.hasUltimate(byId[e.playerId]),
        (byId[e.playerId] || {}).name + ' took over without qualifying for an ultimate');
    });
  }
  assert.ok(checked > 0, 'no takeovers to check');
  console.log('checkOnlyStarsTakeOver: OK (' + checked + ' checked)');
}

// One side may not run two takeovers at once — their dials would stack on the
// same five players.
function checkOneTakeoverPerSideAtATime() {
  const f = gameFixture();
  for (let s = 0; s < 6; s++) {
    const events = [];
    f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(700 + s), { events: events });
    const live = { home: 0, away: 0 };
    events.forEach(function (e) {
      if (e.type === 'takeover-start') {
        live[e.team] += 1;
        assert.ok(live[e.team] <= 1, 'two takeovers running at once on ' + e.team);
      }
      if (e.type === 'takeover-end') live[e.team] -= 1;
    });
  }
  console.log('checkOneTakeoverPerSideAtATime: OK');
}

// The recurring failure in this codebase is a value computed and then
// discarded. Twelve ultimates advertise a set of dials; this asserts, by
// reading the engine's source, that every dial some ultimate actually turns is
// READ somewhere in it. A dial nobody reads is a promise the box score will
// eventually contradict.
function checkEveryDialIsReadByTheEngine() {
  const fs = require('fs');
  const poss = require(path.join(ROOT, 'simEnginePossession.js'));
  const check = require(path.join(ROOT, 'skillCheck.js'));
  const src = fs.readFileSync(path.join(ROOT, 'simEnginePossession.js'), 'utf8');

  const turned = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    Object.keys(ult.takeoverEffect(u.key, 1)).forEach(function (d) { turned[d] = u.key; });
  });

  // Three of the make dials are read through a lookup table
  // (offDial[ZONE_MAKE_DIAL[zone]]), so a `.dialName` search cannot see them.
  // Those are proved FUNCTIONALLY below instead; the rest are proved by the
  // text search. Both are needed: a text search passes on a dial the engine
  // merely mentions, and a functional check needs a call path to exercise.
  const HOLDER = 'p-holder';
  const FUNCTIONAL = {};
  ['three', 'mid', 'inside'].forEach(function (zone) {
    const dial = poss.ZONE_MAKE_DIAL[zone];
    const eff = {}; eff[dial] = 0.5;
    const mods = poss.takeoverShotMods(HOLDER, zone, null, HOLDER, false, eff, {});
    const total = mods.reduce(function (s, m) { return s + m.value; }, 0);
    assert.ok(total > 0, dial + ' does not reach the shot spec for a ' + zone + ' shot');
    // And it must NOT apply to a shot by anyone else.
    const other = poss.takeoverShotMods('p-other', zone, null, HOLDER, false, eff, {});
    assert.strictEqual(other.reduce(function (s, m) { return s + m.value; }, 0), 0,
      dial + ' leaks onto a team-mate’s shot');
    FUNCTIONAL[dial] = true;
  });
  // The same treatment for the two cross-side dials, which also route through
  // a helper rather than being named at a use site.
  assert.ok(poss.takeoverShotMods('anyone', 'inside', null, null, false, {}, { oppMake: -0.05 })
    .some(function (m) { return m.value < 0; }), 'oppMake does not reach the shot spec');
  FUNCTIONAL.oppMake = true;
  assert.ok(poss.takeoverTurnoverMods('anyone', null, false, {}, { oppTurnover: 0.1 })
    .some(function (m) { return m.value > 0; }), 'oppTurnover does not reach the turnover spec');
  FUNCTIONAL.oppTurnover = true;
  assert.ok(poss.takeoverShotMods('anyone', 'three', null, null, true, { teamMake: 0.04 }, {})
    .some(function (m) { return m.value > 0; }), 'teamMake does not reach the shot spec');
  FUNCTIONAL.teamMake = true;
  assert.ok(poss.takeoverTurnoverMods('anyone', null, true, { teamTurnover: -0.02 }, {})
    .some(function (m) { return m.value < 0; }), 'teamTurnover does not reach the turnover spec');
  FUNCTIONAL.teamTurnover = true;
  assert.ok(poss.takeoverTurnoverMods(HOLDER, HOLDER, false, { turnover: -0.05 }, {})
    .some(function (m) { return m.value < 0; }), 'turnover does not reach the turnover spec');
  FUNCTIONAL.turnover = true;
  assert.ok(poss.takeoverBlockMods(HOLDER, { kind: 'solo', playerId: HOLDER }, { block: 0.05 }).length,
    'block does not reach the block spec');
  FUNCTIONAL.block = true;
  // energyDrain and matchupDrain: prove the scaled drain actually scales.
  const slow = { energy: 1 }, fast = { energy: 1 }, normal = { energy: 1 };
  // workEthic must be present: drainEnergy reads it, and an absent attribute
  // makes the whole drain NaN, which compares false against everything and
  // would look like the dial simply not working.
  const dummy = { id: HOLDER, attributes: { workEthic: 50 } };
  poss.drainEnergyScaled(normal, dummy, undefined);
  poss.drainEnergyScaled(slow, dummy, 0.15);
  poss.drainEnergyScaled(fast, dummy, 1.9);
  assert.ok(slow.energy > normal.energy, 'energyDrain below 1 must drain less');
  assert.ok(fast.energy < normal.energy, 'matchupDrain above 1 must drain more');
  FUNCTIONAL.energyDrain = true; FUNCTIONAL.matchupDrain = true;

  const missing = [];
  Object.keys(turned).forEach(function (dial) {
    if (FUNCTIONAL[dial]) return;
    if (!new RegExp('\\.' + dial + '\\b').test(src)) missing.push(dial + ' (' + turned[dial] + ')');
  });
  assert.strictEqual(missing.length, 0,
    'simEnginePossession.js never reads: ' + missing.join(', '));
  console.log('checkEveryDialIsReadByTheEngine: OK (' + Object.keys(turned).length +
    ' dials, ' + Object.keys(FUNCTIONAL).length + ' proved functionally)');
}

// A takeover must actually produce points, not merely fire. This is the
// difference between the feature existing and the feature working.
function checkATakeoverMovesTheBoxScore() {
  const f = gameFixture();
  let withPoints = 0, total = 0, sum = 0;
  for (let s = 0; s < 12; s++) {
    const events = [];
    f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(2000 + s), { events: events });
    events.filter(function (e) { return e.type === 'takeover-end'; }).forEach(function (e) {
      total += 1;
      sum += e.takeoverPoints;
      if (e.takeoverPoints > 0) withPoints += 1;
    });
  }
  assert.ok(total > 0, 'no takeover completed in twelve games');
  assert.ok(withPoints / total > 0.5,
    'most takeovers scored nothing (' + withPoints + '/' + total +
    ') — the dials are not reaching the engine');
  console.log('checkATakeoverMovesTheBoxScore: OK (' + withPoints + '/' + total +
    ' scored, mean ' + (sum / total).toFixed(1) + ' pts)');
}

// The defensive ultimates score nothing by design, so the points check above
// cannot see them. This asserts they change the OPPONENT instead.
function checkDefensiveTakeoversSuppressTheOpponent() {
  const poss = require(path.join(ROOT, 'simEnginePossession.js'));
  const check = require(path.join(ROOT, 'skillCheck.js'));
  const wall = ult.takeoverEffect('theWall', 1);
  const base = poss.shotSpec('inside', 70, 70, 1, 1, 1, 1, 0, 0, 0, 1);
  const under = poss.shotSpec('inside', 70, 70, 1, 1, 1, 1, 0, 0, 0, 1);
  under.modifiers = under.modifiers.concat([{ label: 'opponent takeover', value: wall.oppMake }]);
  assert.ok(check.skillCheckProbability(under).probability <
    check.skillCheckProbability(base).probability,
    'The Wall must lower the opponent’s make probability');
  const clamps = ult.takeoverEffect('clamps', 1);
  assert.ok(clamps.oppTurnover > 0, 'Clamps must raise the opponent’s turnover chance');
  console.log('checkDefensiveTakeoversSuppressTheOpponent: OK');
}

// EVERY takeover that starts must be recorded, including one the final buzzer
// interrupts. Measured before this was fixed: 80 started, 42 logged, 38 lost —
// because the situation multiplier makes takeovers cluster late and one that
// begins with three minutes left never finishes its twenty-six possessions.
// Half the feature was invisible to history, the box score and the feed.
// The reference page must READ the taxonomy, never restate it. That is why a
// retuned ultimate updates its own documentation, and why one can never be
// described as doing something it does not do — the rule ui/badges.js follows.
function checkReferencePageRestatesNothing() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'ui', 'ultimates.js'), 'utf8');
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(src.indexOf("'" + u.name + "'") === -1 && src.indexOf('"' + u.name + '"') === -1,
      'ui/ultimates.js hard-codes the name "' + u.name + '" instead of reading the taxonomy');
    assert.ok(src.indexOf(ult.ULTIMATE_DESCRIPTIONS[u.key]) === -1,
      'ui/ultimates.js hard-codes ' + u.key + '’s description instead of reading it');
  });
  assert.ok(/ULTIMATE_TAXONOMY/.test(src), 'ui/ultimates.js must read ULTIMATE_TAXONOMY');
  assert.ok(/ULTIMATE_DESCRIPTIONS/.test(src), 'and ULTIMATE_DESCRIPTIONS');
  console.log('checkReferencePageRestatesNothing: OK');
}

// Every ultimate needs a sentence a player can read. A missing one must fail
// here rather than render a blank row on the reference page.
function checkEveryUltimateHasADescription() {
  const desc = ult.ULTIMATE_DESCRIPTIONS;
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    assert.ok(desc[u.key] && desc[u.key].length > 10,
      u.key + ' has no description — the reference page would render a blank row');
  });
  assert.strictEqual(Object.keys(desc).length, ult.ULTIMATE_TAXONOMY.length,
    'there is a description for an ultimate that does not exist');
  console.log('checkEveryUltimateHasADescription: OK');
}

// Every dial an ultimate turns must have a player-facing label, or the
// reference page silently omits part of what the ultimate does. shotCeiling and
// zoneBias are deliberately unlabelled — one is the mechanical companion to
// shotShare and the other is covered by the make lines — so they are allowed
// null, but a dial that is simply MISSING from the table is not.
// Read STATICALLY rather than by requiring the module. ui/ files are
// browser-only — they reach for PLAYERS_2026, escapeHtml and the ultimates
// globals directly, with no dual bridge, so Node cannot load them. Parsing the
// DIAL_LABELS table out of the source is what lets this check exist at all.
function checkEveryDialHasALabelOrIsDeliberatelySilent() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'ui', 'ultimates.js'), 'utf8');
  const block = src.match(/const DIAL_LABELS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'ui/ultimates.js has no DIAL_LABELS table');
  const labelled = {};
  (block[1].match(/^\s*([a-zA-Z]+)\s*:/gm) || []).forEach(function (m) {
    labelled[m.replace(/[\s:]/g, '')] = true;
  });

  const turned = {};
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    Object.keys(ult.takeoverEffect(u.key, 1)).forEach(function (d) { turned[d] = u.key; });
  });
  Object.keys(turned).forEach(function (dial) {
    assert.ok(labelled[dial],
      turned[dial] + ' turns "' + dial + '", which the reference page has no label for');
  });

  // And every ultimate must have at least one dial that produces a readable
  // line — otherwise its panel renders a name and nothing else.
  const silent = ['shotCeiling', 'zoneBias'];
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const speaking = Object.keys(ult.takeoverEffect(u.key, 1))
      .filter(function (d) { return silent.indexOf(d) === -1; });
    assert.ok(speaking.length > 0,
      u.key + ' turns only unlabelled dials — its panel would say nothing');
  });
  console.log('checkEveryDialHasALabelOrIsDeliberatelySilent: OK (' +
    Object.keys(turned).length + ' dials labelled)');
}

function checkEveryTakeoverIsRecorded() {
  const f = gameFixture();
  let started = 0, logged = 0, cutShort = 0;
  for (let s = 0; s < 40; s++) {
    const r = f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(5000 + s));
    Object.keys(r.boxScore).forEach(function (id) {
      started += (r.boxScore[id].takeoversUsed || 0);
    });
    logged += (r.takeovers || []).length;
    cutShort += (r.takeovers || []).filter(function (t) { return t.cutShort; }).length;
  }
  assert.ok(started > 0, 'no takeovers in the fixture');
  assert.strictEqual(logged, started,
    'takeovers started ' + started + ' but only ' + logged + ' were recorded — ' +
    (started - logged) + ' vanished at the final buzzer');

  // The half of this test that matters is the buzzer path, and it can no longer
  // be reached by accident. Before the runway rule, 63% of takeovers were cut
  // short and any sample hit it; now it is under 1%, and a test that waits for
  // one to turn up is a test that quietly stops running. So force it: a
  // takeover longer than a whole game, with no minimum run to refuse it, is
  // still live when the buzzer goes every single time.
  const savedRun = ult.CHARGE_TUNING.takeoverPossessions;
  const savedMin = ult.CHARGE_TUNING.minRunPossessions;
  const savedFull = ult.CHARGE_TUNING.full;
  let forcedStarted = 0, forcedLogged = 0, forcedCut = 0;
  try {
    ult.CHARGE_TUNING.takeoverPossessions = 500;
    ult.CHARGE_TUNING.minRunPossessions = 0;
    // Force the FIRE too, not just the length: whether anyone reaches a full
    // meter in these 40 fixture games depends on who is on the fixture
    // rosters, and the 2K27 import proved that dependency — the imported
    // teams' charge profiles left the meter short and this path silently
    // went unreached again. A near-empty meter requirement guarantees a
    // takeover fires, and 500 possessions guarantees the buzzer cuts it.
    ult.CHARGE_TUNING.full = 40;
    for (let s = 0; s < 40; s++) {
      const r = f.gameSim.simulateGame(FIXTURE_HOME, FIXTURE_AWAY, f.makeRng(5000 + s));
      Object.keys(r.boxScore).forEach(function (id) {
        forcedStarted += (r.boxScore[id].takeoversUsed || 0);
      });
      forcedLogged += (r.takeovers || []).length;
      forcedCut += (r.takeovers || []).filter(function (t) { return t.cutShort; }).length;
    }
  } finally {
    ult.CHARGE_TUNING.takeoverPossessions = savedRun;
    ult.CHARGE_TUNING.minRunPossessions = savedMin;
    ult.CHARGE_TUNING.full = savedFull;
  }
  assert.ok(forcedCut > 0,
    'a 500-possession takeover was not cut short by the buzzer — this test can no ' +
    'longer reach the flush path it exists to protect');
  assert.strictEqual(forcedLogged, forcedStarted,
    'with every takeover live at the buzzer, ' + forcedStarted + ' started but ' +
    forcedLogged + ' were recorded — the flush path is dropping them');
  console.log('checkEveryTakeoverIsRecorded: OK (' + logged + ' of ' + started +
    ' normally, ' + cutShort + ' cut short; ' + forcedLogged + ' of ' + forcedStarted +
    ' with the buzzer forced)');
}

function checkEngineReportsOnlyKnownPlayKinds() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'simEnginePossession.js'), 'utf8');
  const reported = [];
  const re = /reportPlay\([^,]+,\s*[^,]+,\s*'([a-zA-Z]+)'\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) { if (reported.indexOf(m[1]) === -1) reported.push(m[1]); }
  assert.ok(reported.length > 0, 'no reportPlay call sites found — the report is not wired in');
  reported.forEach(function (kind) {
    assert.ok(ult.PLAY_KINDS.indexOf(kind) !== -1,
      'the engine reports "' + kind + '", which ultimates.js prices at nothing');
  });
  // And the reverse: a priced kind nobody reports is dead tuning.
  ult.PLAY_KINDS.forEach(function (kind) {
    assert.ok(reported.indexOf(kind) !== -1,
      'ultimates.js prices "' + kind + '" but the engine never reports it');
  });
  console.log('checkEngineReportsOnlyKnownPlayKinds: OK (' + reported.length + ' kinds)');
}

function checkBoxLineCarriesMeterState() {
  const poss = require(path.join(ROOT, 'simEnginePossession.js'));
  const line = poss.initBoxLine();
  ['charge', 'takeoverLeft', 'takeoversUsed', 'takeoverPoints', 'takeoverPointsAt']
    .forEach(function (f) {
      assert.strictEqual(line[f], 0, 'a fresh box line must start with ' + f + ' at 0');
    });
  console.log('checkBoxLineCarriesMeterState: OK');
}

function checkEveryUltimateTurnsSomething() {
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    const dials = Object.keys(eff);
    assert.ok(dials.length > 0, u.key + ' turns no dials — its takeover would do nothing');
    dials.forEach(function (d) {
      assert.ok(ult.DIAL_NAMES.indexOf(d) !== -1,
        u.key + ' turns unknown dial "' + d + '" — the engine will never read it');
    });
  });
  console.log('checkEveryUltimateTurnsSomething: OK');
}

function checkBadgeBoostScalesTheEffect() {
  const plain = ult.takeoverEffect('heatCheck', 1);
  const boosted = ult.takeoverEffect('heatCheck', ult.ULTIMATE_TUNING.badgeBoost);
  assert.ok(boosted.makeThree > plain.makeThree, 'a matching badge makes the takeover stronger');
  assert.ok(boosted.shotShare > plain.shotShare, 'including the multiplier dials');
  // A multiplier must scale from 1, not from 0 — otherwise a 35% boost on a
  // 2.4x share becomes 3.24x, which is a 60% boost.
  assert.ok(boosted.shotShare < plain.shotShare * ult.ULTIMATE_TUNING.badgeBoost,
    'multiplier dials scale from 1, not from 0');
  // energyDrain is a fraction where LOWER is stronger; boosting it upward would
  // turn a legendary badge into a penalty.
  const motorPlain = ult.takeoverEffect('motorNeverStops', 1);
  const motorBoost = ult.takeoverEffect('motorNeverStops', ult.ULTIMATE_TUNING.badgeBoost);
  assert.ok(motorBoost.energyDrain <= motorPlain.energyDrain,
    'a badge must never make Motor Never Stops tire FASTER');
  console.log('checkBadgeBoostScalesTheEffect: OK');
}

// Team ultimates are multiplied by five, so their per-player magnitude must be
// smaller than any solo one.
function checkTeamEffectsAreSmallerPerPlayer() {
  const solo = ult.takeoverEffect('heatCheck', 1).makeThree;
  const team = ult.takeoverEffect('floorGeneral', 1).teamMake;
  assert.ok(team < solo, 'a team ultimate lifts each player less than a solo one lifts its holder');
  console.log('checkTeamEffectsAreSmallerPerPlayer: OK');
}

// Motor Never Stops earns its points by attrition. If it ever gains a shooting
// bonus it stops being the odd one out and becomes a twelfth accuracy boost.
function checkMotorTouchesNoShootingProbability() {
  const eff = ult.takeoverEffect('motorNeverStops', 1);
  ['makeThree', 'makeMid', 'makeInside', 'makeFt', 'teamMake', 'shotShare'].forEach(function (d) {
    assert.strictEqual(eff[d], undefined, 'Motor Never Stops must not turn ' + d);
  });
  assert.ok(eff.energyDrain !== undefined, 'Motor Never Stops must turn energyDrain');
  console.log('checkMotorTouchesNoShootingProbability: OK');
}

// weightedPick caps any one player at PICK_CEILING.shooter. A usage boost that
// does not lift that ceiling saturates silently and the points band is
// unreachable however the rest is tuned.
function checkUsageUltimatesLiftTheCeiling() {
  const ENGINE_CEILING = 0.50;
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    if (!eff.shotShare) return;
    assert.ok(eff.shotShare > 1, u.key + ' has a shotShare that does not raise anything');
    assert.ok(eff.shotCeiling > ENGINE_CEILING,
      u.key + ' raises shot share but not the ceiling — the boost would saturate');
  });
  console.log('checkUsageUltimatesLiftTheCeiling: OK');
}

// A zone bias on a shot the ultimate does not improve sends the holder to a
// spot he is no better from, which lowers his efficiency during his own
// takeover.
function checkZoneBiasMatchesTheMakeBonus() {
  const ZONE_DIAL = { three: 'makeThree', mid: 'makeMid', inside: 'makeInside' };
  ult.ULTIMATE_TAXONOMY.forEach(function (u) {
    const eff = ult.takeoverEffect(u.key, 1);
    if (!eff.zoneBias) return;
    Object.keys(eff.zoneBias).forEach(function (zone) {
      assert.ok(eff[ZONE_DIAL[zone]] > 0,
        u.key + ' biases shots to ' + zone + ' without improving ' + ZONE_DIAL[zone]);
    });
  });
  console.log('checkZoneBiasMatchesTheMakeBonus: OK');
}

function checkUnknownUltimateIsInert() {
  assert.deepStrictEqual(ult.takeoverEffect('notAnUltimate', 1), {},
    'an unknown key returns no dials rather than throwing');
  console.log('checkUnknownUltimateIsInert: OK');
}

checkGainsAndDrains();
checkDrainsIgnoreTheSituation();
checkAffinity();
checkSituation();
checkColdBloodedIgnoresEarlyGame();
checkThresholdRises();
checkTakeoverLength();
checkEveryDialIsReadByTheEngine();
checkATakeoverMovesTheBoxScore();
checkDefensiveTakeoversSuppressTheOpponent();
checkReferencePageRestatesNothing();
checkEveryUltimateHasADescription();
checkEveryDialHasALabelOrIsDeliberatelySilent();
checkEveryTakeoverIsRecorded();
checkEngineReportsOnlyKnownPlayKinds();
checkBoxLineCarriesMeterState();
checkTakeoversFireInARealGame();
checkOnlyStarsTakeOver();
checkOneTakeoverPerSideAtATime();
checkEveryUltimateTurnsSomething();
checkBadgeBoostScalesTheEffect();
checkTeamEffectsAreSmallerPerPlayer();
checkMotorTouchesNoShootingProbability();
checkUsageUltimatesLiftTheCeiling();
checkZoneBiasMatchesTheMakeBonus();
checkUnknownUltimateIsInert();
checkHolderCountBand();
checkEveryUltimateIsHeldInTheLeague();
checkNoUltimateDominates();
if (!SKIP_SEASON) {
  checkLeagueScoringHeldFlat();
  checkScoringLeadersInBand();
  checkTakeoverRateBand();
  checkPointsAddedBand();
  checkEveryUltimateFiresInASeason();
  checkNoUltimateIsWildlyOverpowered();
  checkRateSpreadIsBounded();
} else {
  console.log("(season guards skipped: SKIP_SEASON)");
}
console.log('validate-ultimates: ALL OK');
