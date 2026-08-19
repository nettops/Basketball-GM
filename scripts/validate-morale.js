const assert = require('assert');
const path = require('path');

// Shared by the season-long checks at the bottom. The older checks above take
// their own local requires; these need the sim engines wired up as well, which
// is not worth repeating three times.
function req(name) { return require(path.join(__dirname, '..', name)); }
req('data.js');
const { makeRng } = req('rng.js');
const traits = req('traits.js');
req('scouting.js');
traits.ensureHiddenPlayerData(req('players-2026.js').PLAYERS_2026);
req('simEngine.js'); req('simEngineBoxScore.js'); req('simEnginePossession.js');
req('gameCoach.js'); req('gameSim.js');
const league = req('league.js');
const morale = req('morale.js');
const schedule = req('schedule.js');
const { TEAMS } = req('teams.js');

function makePlayer(overrides) {
  const p = Object.assign({
    id: 'test-player', name: 'Test Player', teamId: 'BOS', overall: 70,
    contract: { salary: 5000000, yearsRemaining: 3, playerOption: false, teamOption: false },
    status: { morale: 70, fatigue: 0, injury: null }
  }, overrides || {});
  // Consumers read rawOverall; these fixtures are plain objects with no getter,
  // so the two are kept in lockstep here.
  if (p.rawOverall === undefined) p.rawOverall = p.overall;
  return p;
}

function checkTickMoraleForTeamGame() {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'league.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'morale.js'))];
  const league = require(path.join(__dirname, '..', 'league.js'));
  const morale = require(path.join(__dirname, '..', 'morale.js'));

  // By role off the live roster, not by id — the 2K27 import reshuffles
  // rosters whenever it reruns, and hardcoded ids die with every shuffle.
  const bosRoster = league.getTeamRoster('BOS');
  const starter = bosRoster[0];
  const bench = bosRoster[bosRoster.length - 1];
  starter.status.morale = 50;
  bench.status.morale = 50;

  const minutesByPlayerId = {};
  league.getTeamRoster('BOS').forEach(function (p) { minutesByPlayerId[p.id] = p.id === starter.id ? 38 : 4; });

  morale.tickMoraleForTeamGame('BOS', true, minutesByPlayerId);
  assert.ok(starter.status.morale > 50, 'a heavy-minutes starter on a winning team should gain morale');
  assert.ok(bench.status.morale < starter.status.morale, 'a buried bench player should trail the starter after the same win');

  const before = starter.status.morale;
  for (let i = 0; i < 500; i++) morale.tickMoraleForTeamGame('BOS', false, minutesByPlayerId);
  assert.ok(starter.status.morale >= 0 && starter.status.morale <= 100, 'morale must stay clamped to [0, 100]');
  assert.ok(starter.status.morale < before, 'repeated losses should drive morale down');

  console.log('checkTickMoraleForTeamGame: OK');
}

checkTickMoraleForTeamGame();

function checkMoraleTier() {
  const morale = require(path.join(__dirname, '..', 'morale.js'));
  assert.strictEqual(morale.moraleTier(80), 'happy');
  assert.strictEqual(morale.moraleTier(55), 'neutral');
  assert.strictEqual(morale.moraleTier(10), 'unhappy');
  console.log('checkMoraleTier: OK');
}

checkMoraleTier();

function checkMoraleFactors() {
  const morale = require(path.join(__dirname, '..', 'morale.js'));
  // One above the rotation band, DERIVED from the table rather than a
  // literal 80 — the band moved twice during the 2K27 import re-anchors and
  // a hardcoded fixture rating goes stale with every move.
  const ratingBands = require(path.join(__dirname, '..', 'ratings.js')).RATING_BANDS;
  const player = makePlayer({
    overall: ratingBands.rotation + 1,
    contract: { salary: 5000000, yearsRemaining: 1, playerOption: false, teamOption: false },
    seasonStats: { gamesPlayed: 10, minutes: 100, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }
  });
  const badTeam = { record: { wins: 2, losses: 10 } };
  const reasons = morale.moraleFactors(player, badTeam);
  assert.ok(reasons.indexOf('Losing record') !== -1, 'a team well under .500 should surface as a reason');
  assert.ok(reasons.indexOf('Limited role') !== -1, '10 mpg for a rotation-band player should surface as a reason');
  assert.ok(reasons.indexOf('Contract expiring') !== -1, 'yearsRemaining <= 1 should surface as a reason');

  const contentPlayer = makePlayer({ overall: 60, contract: { salary: 5000000, yearsRemaining: 4, playerOption: false, teamOption: false } });
  const goodTeam = { record: { wins: 10, losses: 2 } };
  assert.deepStrictEqual(morale.moraleFactors(contentPlayer, goodTeam), [], 'a settled player on a winning team should have no flagged reasons');

  console.log('checkMoraleFactors: OK');
}

checkMoraleFactors();

function checkFreeAgencyMoraleSensitivity() {
  const freeAgency = require(path.join(__dirname, '..', 'freeAgency.js'));
  const happy = makePlayer({ overall: 75, status: { morale: 95, fatigue: 0, injury: null } });
  const unhappy = makePlayer({ overall: 75, status: { morale: 5, fatigue: 0, injury: null } });
  const happyFair = freeAgency.estimateFairSalary(happy);
  const unhappyFair = freeAgency.estimateFairSalary(unhappy);
  assert.ok(happyFair > unhappyFair, 'a happy player should command a higher fair-market salary than an unhappy one at the same overall');

  const roster = require(path.join(__dirname, '..', 'players-2026.js')).PLAYERS_2026;
  const player = roster.find(function (p) { return p.teamId === null; }) || roster[0];
  const beforeMorale = player.status.morale;
  freeAgency.signPlayer(player, { teamId: 'BOS', salary: 5000000, yearsRemaining: 2 });
  assert.ok(player.status.morale >= beforeMorale, 'signing a new contract should never lower morale');

  console.log('checkFreeAgencyMoraleSensitivity: OK');
}

checkFreeAgencyMoraleSensitivity();


// THE bug this file did not catch for a long time: a player who does not play
// was the ONE case the minutes rule skipped.
//
// The old tick read `if (minutes > 0) delta += ...`, so the five men out of
// the rotation — who get a hard zero from gameCoach.js and have more to be
// unhappy about than anybody — were the only players the rule never touched.
// A DNP is the complaint, not the absence of one.
function checkSittingOutCostsMorale() {
  const teamId = TEAMS[0].id;
  const roster = league.getTeamRoster(teamId);
  assert.ok(roster.length >= 6, 'need a real roster to judge this');

  roster.forEach(function (p) { p.status.morale = 60; p.contract.yearsRemaining = 3; });

  const minutes = {};
  roster.forEach(function (p, i) { minutes[p.id] = i < 5 ? 40 : 0; });
  morale.tickMoraleForTeamGame(teamId, true, minutes);

  const played = roster[0].status.morale;
  const satOut = roster[roster.length - 1].status.morale;
  assert.ok(played > 60, 'a starter is happier after a win (' + played.toFixed(2) + ')');
  // NOT "the DNP man is below where he started": a win is worth more than the
  // DNP penalty costs, so he still edges up on a night the team wins, which is
  // right — winning helps even from the bench. The claim that matters is that
  // the minutes term reaches him AT ALL, and the way to see that is the gap.
  assert.ok(satOut < played,
    'a man who did not get off the bench must finish below the men who played — ' +
    'he is on ' + satOut.toFixed(2) + ' against ' + played.toFixed(2));

  // And on a losing night, where nothing offsets it, sitting out has to hurt.
  roster.forEach(function (p) { p.status.morale = 60; });
  morale.tickMoraleForTeamGame(teamId, false, minutes);
  const lostAndSat = roster[roster.length - 1].status.morale;
  assert.ok(lostAndSat < 60 - 0.5,
    'losing AND not playing must cost real morale — he finished on ' + lostAndSat.toFixed(2));
  console.log('checkSittingOutCostsMorale: OK (win: starter ' + played.toFixed(2) +
    ' vs DNP ' + satOut.toFixed(2) + '; loss+DNP ' + lostAndSat.toFixed(2) + ')');
}
checkSittingOutCostsMorale();

// The fair-share bar is averaged over the men who DRESSED, not the whole
// roster. Dividing 240 minutes by fifteen gives a 16-minute bar that a
// ten-man rotation clears almost to a man, so "am I getting my minutes"
// stopped telling a starter apart from the last man off the bench.
function checkFairShareIsMeasuredAgainstWhoPlayed() {
  const teamId = TEAMS[1].id;
  const roster = league.getTeamRoster(teamId);
  roster.forEach(function (p) { p.status.morale = 60; p.contract.yearsRemaining = 3; });

  // A ten-man rotation: five on 34, five on 14. Averaged over the ten who
  // played the bar is 24, so the 14-minute men are BELOW it. Averaged over
  // all fifteen the bar would be 16 and they would clear it — which is the
  // bug this asserts against.
  const minutes = {};
  roster.forEach(function (p, i) { minutes[p.id] = i < 5 ? 34 : (i < 10 ? 14 : 0); });
  morale.tickMoraleForTeamGame(teamId, true, minutes);

  assert.ok(roster[9].status.morale < roster[0].status.morale,
    'a 14-minute man must not collect the same fair-share bonus as a 34-minute starter');
  console.log('checkFairShareIsMeasuredAgainstWhoPlayed: OK');
}
checkFairShareIsMeasuredAgainstWhoPlayed();

// Every tier has to be REACHABLE by playing the game. moraleTier names three
// bands; if a full season cannot put anybody in one of them, that band is
// decoration and everything keyed to it — the dashboard's unhappy list, the
// mid-season scenes — is dead code nobody will ever see fire.
function checkASeasonFillsEveryTier() {
  const rng = makeRng(4242);
  const games = schedule.generateSeasonGames(rng, TEAMS).map(function (g) {
    return { id: g.id, homeTeamId: g.home, awayTeamId: g.away, day: g.day, played: false,
      homeScore: null, awayScore: null, boxScore: null, isPlayoff: false, seriesId: null };
  });
  const season = { games: games, currentDay: -1 };
  const maxDay = games.reduce(function (m, g) { return g.day > m ? g.day : m; }, 0);
  for (let d = 0; d <= maxDay; d++) {
    league.simulateDate(season, d, { simEngine: 'possession', leagueYear: 2026 }, rng, function () {});
  }

  const tiers = { happy: 0, neutral: 0, unhappy: 0 };
  let all = [];
  TEAMS.forEach(function (t) {
    league.getTeamRoster(t.id).forEach(function (p) {
      tiers[morale.moraleTier(p.status.morale)] += 1;
      all.push(p.status.morale);
    });
  });
  all.sort(function (a, b) { return a - b; });

  Object.keys(tiers).forEach(function (k) {
    assert.ok(tiers[k] > 0, 'a full season put NOBODY in the "' + k + '" band — it is decoration');
  });
  // And not the other failure: a league where everybody is miserable is as
  // uninformative as one where nobody is.
  const unhappyShare = tiers.unhappy / all.length;
  assert.ok(unhappyShare > 0.02 && unhappyShare < 0.35,
    (100 * unhappyShare).toFixed(0) + '% of the league finished unhappy — outside the 2-35% band');
  console.log('checkASeasonFillsEveryTier: OK (happy ' + tiers.happy + ', neutral ' +
    tiers.neutral + ', unhappy ' + tiers.unhappy + '; median ' +
    all[Math.floor(all.length / 2)].toFixed(0) + ')');
}
checkASeasonFillsEveryTier();

console.log('All morale validations passed');
