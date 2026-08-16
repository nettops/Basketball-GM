// Registry of available sim engines. Both slots are filled in by the engine
// files themselves as they load (simEngineBoxScore.js, gameSim.js).
const SIM_ENGINES = {
  boxscore: null,
  possession: null
};

function registerEngine(name, engine) {
  if (!(name in SIM_ENGINES)) {
    throw new Error('registerEngine: unknown engine name ' + name);
  }
  SIM_ENGINES[name] = engine;
}

function getActiveEngine(settings) {
  // The possession engine is the league default: it is the one that models an
  // on-court five, rotations, a clock, and coaching decisions, so making it
  // the default is what keeps unwatched games under the same rules as the
  // game the user is watching. `boxscore` remains selectable in settings and
  // is roughly 30x faster for anyone who wants raw fast-forward speed.
  const name = (settings && settings.simEngine) || 'possession';
  const engine = SIM_ENGINES[name];
  if (!engine) {
    throw new Error('getActiveEngine: engine "' + name + '" is not implemented yet');
  }
  return engine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIM_ENGINES: SIM_ENGINES, registerEngine: registerEngine, getActiveEngine: getActiveEngine };
}
