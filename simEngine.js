// Registry of available sim engines. Only `boxscore` is implemented this phase;
// `scoreonly` and `possession` are reserved slots for later phases — keeping them
// present (rather than omitted) is what lets ui/settings.js show them as disabled
// "coming later" options without special-casing missing keys.
const SIM_ENGINES = {
  boxscore: null,   // filled in by simEngineBoxScore.js once it loads
  scoreonly: null,
  possession: null
};

function registerEngine(name, engine) {
  if (!(name in SIM_ENGINES)) {
    throw new Error('registerEngine: unknown engine name ' + name);
  }
  SIM_ENGINES[name] = engine;
}

function getActiveEngine(settings) {
  const name = (settings && settings.simEngine) || 'boxscore';
  const engine = SIM_ENGINES[name];
  if (!engine) {
    throw new Error('getActiveEngine: engine "' + name + '" is not implemented yet');
  }
  return engine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIM_ENGINES: SIM_ENGINES, registerEngine: registerEngine, getActiveEngine: getActiveEngine };
}
