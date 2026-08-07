// Main-thread side of simWorker.js. Opt-in (GameState.settings.useWorkerSim,
// default off — see ui/settings.js) and browser-only; Node's validate-*.js
// scripts never call this, so the existing synchronous simulateDate path
// they exercise is completely unaffected. When available, this offloads the
// actual game-simulation math (the CPU-heavy part, especially the possession
// engine) to a Worker thread one game at a time, which gives the main thread
// a natural yield point between every single game instead of only between
// whole seasons (see ui/simControls.js's existing `await delay(...)` between
// seasons) — the practical effect during a long multi-season fast-forward is
// a browser tab that stays responsive to input/repaints throughout, not just
// at season boundaries.
//
// Correctness note: rng is a single continuing deterministic stream shared
// across the whole save (mulberry32 — see rng.js). Games are dispatched to
// the worker ONE AT A TIME, awaited in strict order, and the worker's
// returned rngState is applied back to the real rng via setState() before
// the next call — so the sequence of random draws is bit-for-bit identical
// to running everything synchronously in-thread. No parallelism, by design;
// the goal here is UI responsiveness, not throughput.
var _simWorkerInstance = null;
var _simWorkerRequestId = 0;
var _simWorkerPending = {};

function isWorkerSimAvailable() {
  return typeof Worker !== 'undefined';
}

function getSimWorker() {
  if (!_simWorkerInstance) {
    _simWorkerInstance = new Worker('simWorker.js');
    _simWorkerInstance.onmessage = function (e) {
      const pending = _simWorkerPending[e.data.requestId];
      if (!pending) return;
      delete _simWorkerPending[e.data.requestId];
      pending.resolve(e.data);
    };
    _simWorkerInstance.onerror = function (err) {
      // Any in-flight request would otherwise hang forever waiting for a
      // message that's never coming — reject them all so callers fall back
      // rather than freezing on an await that never resolves.
      Object.keys(_simWorkerPending).forEach(function (id) {
        _simWorkerPending[id].reject(err);
      });
      _simWorkerPending = {};
    };
  }
  return _simWorkerInstance;
}

// Snapshot of just what simEngineBoxScore.js/simEnginePossession.js actually
// read off a team object (see simWorker.js's module comment) — not the full
// team record (no need to ship record/finances/draftPicks/etc. over
// postMessage for something the sim math never looks at).
function teamSnapshotForWorker(team) {
  return { id: team.id, chemistry: team.chemistry, coach: team.coach, strategy: team.strategy };
}

// Resolves with the same shape engine.simulateGame returns synchronously.
// getTeamRoster/getTeamById are passed in explicitly (rather than assumed
// global) so this stays testable and doesn't hardcode a dependency on
// league.js/teams.js being loaded first.
function simulateGameViaWorker(homeTeamId, awayTeamId, rng, settings, getTeamRosterFn, getTeamByIdFn) {
  return new Promise(function (resolve, reject) {
    const worker = getSimWorker();
    const requestId = ++_simWorkerRequestId;
    const players = getTeamRosterFn(homeTeamId).concat(getTeamRosterFn(awayTeamId));
    const teams = [teamSnapshotForWorker(getTeamByIdFn(homeTeamId)), teamSnapshotForWorker(getTeamByIdFn(awayTeamId))];

    _simWorkerPending[requestId] = {
      resolve: function (data) {
        rng.setState(data.rngState);
        resolve(data.result);
      },
      reject: reject
    };

    worker.postMessage({
      type: 'simulateGame',
      requestId: requestId,
      homeTeamId: homeTeamId,
      awayTeamId: awayTeamId,
      players: players,
      teams: teams,
      rngSeed: rng.getState(),
      settings: settings
    });
  });
}

function terminateSimWorker() {
  if (_simWorkerInstance) {
    _simWorkerInstance.terminate();
    _simWorkerInstance = null;
  }
  _simWorkerPending = {};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isWorkerSimAvailable: isWorkerSimAvailable,
    simulateGameViaWorker: simulateGameViaWorker,
    teamSnapshotForWorker: teamSnapshotForWorker,
    terminateSimWorker: terminateSimWorker
  };
}
