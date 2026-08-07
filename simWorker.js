// Web Worker entry point: runs ONE game's simulation off the main thread.
// Loads the exact same engine files the main thread uses (via importScripts,
// this project's no-build equivalent of a normal <script> tag) rather than
// duplicating any simulation logic — a Worker has no `module`/`require`, so
// these files take the same browser-global-functions branch they already use
// when loaded via <script> in index.html.
//
// The worker never sees the real PLAYERS_2026/TEAMS/GameState — only a
// per-call snapshot of the two involved teams' player data AND team data
// (chemistry/coach/strategy — simEngineBoxScore.js's computeTeamRating and
// simulateBoxScoreGame both read those off the real team object), posted in
// with each 'simulateGame' message. getTeamRoster/getTeamById below are
// worker-local shims over that snapshot; the main thread (simWorkerClient.js)
// is what applies the RETURNED result to the real, shared game state — this
// worker only computes, it never mutates anything persistent.
importScripts('data.js', 'rng.js', 'traits.js', 'compositeRatings.js', 'simEngine.js', 'simEngineBoxScore.js', 'simEnginePossession.js', 'gameCoach.js', 'gameSim.js');

var WORKER_PLAYERS = [];
var WORKER_TEAMS = [];

function getTeamRoster(teamId) {
  return WORKER_PLAYERS.filter(function (p) { return p.teamId === teamId; });
}

function getTeamById(teamId) {
  return WORKER_TEAMS.find(function (t) { return t.id === teamId; });
}

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type !== 'simulateGame') return;

  WORKER_PLAYERS = msg.players;
  WORKER_TEAMS = msg.teams;
  var rng = makeRng(msg.rngSeed);
  var engine = getActiveEngine(msg.settings);
  var result = engine.simulateGame(msg.homeTeamId, msg.awayTeamId, rng);

  self.postMessage({ requestId: msg.requestId, result: result, rngState: rng.getState() });
};
