const assert = require('assert');
const path = require('path');

const { makeRng } = require(path.join(__dirname, '..', 'rng.js'));
const autoGMModule = require(path.join(__dirname, '..', 'autoGM.js'));
const teamsModule = require(path.join(__dirname, '..', 'teams.js'));
const leagueModule = require(path.join(__dirname, '..', 'league.js'));
const tradeModule = require(path.join(__dirname, '..', 'trade.js'));
const tradeEvaluatorModule = require(path.join(__dirname, '..', 'tradeEvaluator.js'));

// Phase E: AI-to-AI trading. generateTradeOffer's new excludeTeamId param is
// what keeps the user's roster out of the autonomous AI-to-AI pass (which
// auto-executes with no inbox/approval step) — confirm it's actually honored.
function checkExcludeTeamIdKeepsPartnerOutOfSearch() {
  const rng = makeRng(1);
  let checkedAny = false;
  teamsModule.TEAMS.forEach(function (team) {
    // Try every other team as the "excluded" partner and confirm it's never
    // chosen — cheap enough at 30 teams, and removes any dependency on which
    // specific partner the unconstrained search would have picked.
    teamsModule.TEAMS.filter(function (t) { return t.id !== team.id; }).forEach(function (excluded) {
      const offer = autoGMModule.generateTradeOffer(team, makeRng(1), excluded.id);
      checkedAny = true;
      if (offer) {
        assert.notStrictEqual(offer.proposal.participants[1], excluded.id, excluded.id + ' should never be chosen as a partner when excluded');
      }
    });
  });
  assert.ok(checkedAny);
  console.log('checkExcludeTeamIdKeepsPartnerOutOfSearch: OK');
}

checkExcludeTeamIdKeepsPartnerOutOfSearch();

// End-to-end: a weekly AI-to-AI pass (mirroring script.js's
// runWeeklyAIToAITradeGeneration) should be able to actually execute trades
// among non-user teams, while never touching the excluded (user) team's roster.
function checkWeeklyAIToAIPassExecutesTradesExcludingUser() {
  const userTeamId = 'BOS';
  const userRosterIdsBefore = leagueModule.getTeamRoster(userTeamId).map(function (p) { return p.id; }).sort();

  const rng = makeRng(2024);
  let tradesExecuted = 0;
  teamsModule.TEAMS.filter(function (t) { return t.id !== userTeamId; }).forEach(function (team) {
    const offer = autoGMModule.generateTradeOffer(team, rng, userTeamId);
    if (!offer) return;
    assert.strictEqual(offer.proposal.participants.indexOf(userTeamId), -1, 'user team must never appear in an AI-to-AI proposal');
    tradeModule.executeTrade(offer.proposal, null);
    tradesExecuted += 1;
  });

  const userRosterIdsAfter = leagueModule.getTeamRoster(userTeamId).map(function (p) { return p.id; }).sort();
  assert.deepStrictEqual(userRosterIdsAfter, userRosterIdsBefore, "the user's roster must be completely unchanged by the AI-to-AI pass");

  console.log('checkWeeklyAIToAIPassExecutesTradesExcludingUser: OK (' + tradesExecuted + ' trades executed)');
}

checkWeeklyAIToAIPassExecutesTradesExcludingUser();

// Trading block: selectSurplusCandidate should prefer a flagged player over
// an unflagged one it would otherwise have picked. Deterministic (no partner
// search involved), unlike going through the full generateTradeOffer.
function checkTradeBlockBiasesCandidateSelection() {
  const team = teamsModule.getTeamById('CHA');
  const roster = leagueModule.getTeamRoster('CHA');
  roster.forEach(function (p) { p.onTradeBlock = false; });

  const baselinePick = autoGMModule.selectSurplusCandidate(team, roster);
  assert.ok(baselinePick, 'CHA should have at least one non-need surplus candidate under real roster data');

  // Flag a different eligible (non-need) player — the +0.5 bonus should be
  // enough to flip the selection to it, since surplus scores in practice
  // cluster well within 0.5 of each other across a 15-man roster.
  const alternate = roster.find(function (p) {
    return p.id !== baselinePick.id && tradeEvaluatorModule.needMultiplier(p.position, team) <= 1.0;
  });
  if (!alternate) { console.log('checkTradeBlockBiasesCandidateSelection: SKIPPED (no alternate eligible candidate on CHA)'); return; }

  alternate.onTradeBlock = true;
  const biasedPick = autoGMModule.selectSurplusCandidate(team, roster);
  assert.strictEqual(biasedPick.id, alternate.id, 'flagging a player onTradeBlock should make it the preferred outgoing piece');

  alternate.onTradeBlock = false;
  console.log('checkTradeBlockBiasesCandidateSelection: OK (baseline=' + baselinePick.name + ', flagged=' + alternate.name + ')');
}

checkTradeBlockBiasesCandidateSelection();

console.log('All AI-to-AI trading validations passed');
