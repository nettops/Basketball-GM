// Regression test for the fast-forward / offseason-overlap bug: reported as
// "players duplicating on rosters, salary cap integer becomes weird, fast
// forward controls get hung and freezes up".
//
// Original root cause: ui/simControls.js's runMultiSeason was a second,
// independent season-rollover path alongside script.js's
// handleAdvanceToOffseason. handleAdvanceToOffseason had an idempotence guard
// (`if (GameState.offseasonStage) return;`); runMultiSeason had none. So a
// "Skip to Draft" click followed by a fast-forward click re-drafted the same
// GameState.upcomingDraftClass prospects a second time straight into
// PLAYERS_2026 — duplicate roster entries and salaries double-counted.
//
// runMultiSeason no longer exists. The protection is now structural rather
// than a bolted-on guard: runAdvance evaluates the stop policy BEFORE it
// steps, and an offseason stage the user has not delegated reports
// draftReady, so the loop halts having simulated nothing. This test follows
// the bug to the new entry point — the point of a regression test is the
// behaviour, not the function name that used to provide it.
const assert = require('assert');
const path = require('path');

// Resolved from this file's own location, the same way every other validator
// here does it. It used to be an absolute path off one machine's desktop,
// which meant this guard silently failed to load anywhere else — the one
// regression test for a data-corruption bug, never actually running.
function req(name) { return require(path.join(__dirname, '..', name)); }

// ui/simControls.js reads evaluateStop/STOP_REASONS as bare globals, exactly
// as it does in the browser where index.html loads simRunner.js first. They
// must exist before it is required or the module throws on first use.
const runner = req('simRunner.js');
global.evaluateStop = runner.evaluateStop;
global.STOP_REASONS = runner.STOP_REASONS;

// Minimal DOM stubs. renderSimControls runs at the top of runAdvance, so
// these need to survive an innerHTML write and a handful of addEventListener
// calls — enough for the loop to reach its first stop check.
function makeStubEl() {
  return {
    textContent: '', disabled: false, innerHTML: '',
    addEventListener: function () {},
    querySelectorAll: function () { return []; }
  };
}
global.document = { getElementById: function () { return makeStubEl(); } };
global.canUndo = function () { return false; };
global.canRedo = function () { return false; };
global.renderView = function () {};
global.autosave = function () {};
// Defined in script.js and called once per simulated step. Only reachable if
// the guard fails to halt the loop, so without this stub a broken guard would
// blow up here with a ReferenceError instead of failing the assertions below
// — the mutant would die, but for the wrong reason, and the assertions would
// never be shown to work at all.
global.refreshAdvanceFrame = function () {};

const playersModule = req('players-2026.js');

global.GameState = {
  offseasonStage: 'draft',            // an offseason is already under way
  // Mid-draft, with picks still waiting: the exact state the reported bug was
  // triggered from. A draft with no live session is finished and is meant to
  // be crossable, so it would not exercise this guard at all.
  draftSession: { results: [], available: [] },
  playMode: 'gm',
  settings: { simSpeed: 'ultra', pauseOn: {} },
  season: { games: [], currentDay: 0 },
  playoffBracket: null,
  upcomingDraftClass: req('draftProspects.js').DRAFT_PROSPECTS_2026,
  leagueYear: 2027,
  userTeamId: 'BOS',
  automation: {}                       // autoDraft off — the user drafts
};

const simControls = req('ui/simControls.js');

const playersBefore = playersModule.PLAYERS_2026.length;
const draftClassBefore = global.GameState.upcomingDraftClass.length;

// The multi-season fast-forward, the control that used to cause this.
simControls.runAdvance({ target: { kind: 'seasons', untilYear: 2030, label: '3 seasons' } })
  .then(function (result) {
    assert.strictEqual(result.steps, 0,
      'the loop must halt before simulating anything, not part-way through a rollover');
    assert.strictEqual(result.reason, runner.STOP_REASONS.DRAFT_READY,
      'and report the waiting draft as the reason');

    assert.strictEqual(playersModule.PLAYERS_2026.length, playersBefore,
      'a fast-forward must not touch PLAYERS_2026 while an offseason is already under way');
    assert.strictEqual(global.GameState.upcomingDraftClass.length, draftClassBefore,
      'and must not re-draft the pending upcomingDraftClass');
    assert.strictEqual(global.GameState.offseasonStage, 'draft',
      'nor silently complete the offseason instead of leaving it to the user');

    const idCounts = {};
    playersModule.PLAYERS_2026.forEach(function (p) { idCounts[p.id] = (idCounts[p.id] || 0) + 1; });
    const duplicates = Object.keys(idCounts).filter(function (id) { return idCounts[id] > 1; });
    assert.strictEqual(duplicates.length, 0,
      'no player should appear twice in PLAYERS_2026: ' + duplicates.slice(0, 5));

    console.log('checkFastForwardCannotReEnterAnOffseason: OK (0 steps taken, 0 duplicates, ' +
      playersModule.PLAYERS_2026.length + ' players unchanged)');
  })
  .catch(function (err) {
    console.error('checkFastForwardCannotReEnterAnOffseason: FAILED');
    console.error(err);
    process.exitCode = 1;
  });
