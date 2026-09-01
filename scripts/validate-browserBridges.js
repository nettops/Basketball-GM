// Every root module carries a dual bridge:
//
//   var _X_DATA = (typeof require !== 'undefined')
//     ? { ns: require('./ns.js'), ... }          // Node: the WHOLE module
//     : { ns: { fn: fn }, ... };                 // browser: a hand-written list
//
// The Node branch hands over the entire module, so it can never be missing
// anything. The browser branch is a list somebody has to remember to update.
// When those two disagree, every Node validator passes and the GAME crashes —
// the one combination no amount of unit testing catches, because the suite
// only ever takes the other branch.
//
// This happened for real. `defineOverall` was added to progression.js in
// ba0c3cd and used at line 294; the browser branch listed only
// `computeOverall`. Node saw the whole of ratings.js and was fine. In the
// browser, `generateNewSeason` — the function that starts a new season —
// threw every single time, so no save could ever begin a second season. The
// symptom reported was "can't move past free agency": Continue at that screen
// calls generateNewSeason, which died, and the run stopped.
//
// 40 root files carry this bridge. This asserts, statically, that every
// `_X_DATA.ns.member` the source actually references is present in the browser
// branch.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Walks from an opening brace to its match, ignoring braces inside strings,
// template literals, regexes and comments. A naive depth count gets this
// wrong the moment a module mentions '{' in a comment, and several do.
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; i += 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// The browser branch is the object literal after the ternary's `:`.
function browserBranch(src) {
  const m = /var\s+(_[A-Z0-9_]+)\s*=\s*\(typeof require !== 'undefined'\)/.exec(src);
  if (!m) return null;
  const qIdx = src.indexOf('?', m.index);
  if (qIdx < 0) return null;
  const nodeOpen = src.indexOf('{', qIdx);
  if (nodeOpen < 0) return null;
  const nodeClose = matchBrace(src, nodeOpen);
  if (nodeClose < 0) return null;
  const colon = src.indexOf(':', nodeClose);
  if (colon < 0) return null;
  const browserOpen = src.indexOf('{', colon);
  if (browserOpen < 0) return null;
  const browserClose = matchBrace(src, browserOpen);
  if (browserClose < 0) return null;
  return { name: m[1], text: src.slice(browserOpen, browserClose + 1) };
}

// `ns: { a: a, b: b }` -> { ns: Set{a, b} }. A namespace whose value is not an
// object literal (a bare identifier, a call) is recorded as null, meaning
// "cannot be checked statically" rather than "provides nothing".
function providedKeys(branchText) {
  const out = {};
  let i = 1;
  while (i < branchText.length - 1) {
    const rest = branchText.slice(i);
    const m = /^[\s,]*([A-Za-z_$][\w$]*)\s*:/.exec(rest);
    if (!m) { i += 1; continue; }
    const ns = m[1];
    let j = i + m[0].length;
    while (j < branchText.length && /\s/.test(branchText[j])) j += 1;
    if (branchText[j] !== '{') {
      out[ns] = null;                       // opaque value, not a literal
      const comma = branchText.indexOf(',', j);
      i = comma < 0 ? branchText.length : comma + 1;
      continue;
    }
    const close = matchBrace(branchText, j);
    const inner = branchText.slice(j + 1, close);
    const keys = new Set();
    inner.replace(/([A-Za-z_$][\w$]*)\s*:/g, function (_, k) { keys.add(k); return ''; });
    out[ns] = keys;
    i = close + 1;
  }
  return out;
}

// Root modules AND ui/. Only root was scanned for a long time, on the reasoning
// that view files have no dependencies to bridge — which stopped being true the
// moment one of them needed a root module. The gap is not hypothetical: a view
// file referencing a name that existed in Node and not in the browser is
// exactly how `selectSegment is not defined` reached a real page, with every
// Node validator green.
const files = fs.readdirSync(ROOT).filter(function (f) {
  return f.endsWith('.js') && fs.statSync(path.join(ROOT, f)).isFile();
}).concat(fs.readdirSync(path.join(ROOT, 'ui')).filter(function (f) {
  return f.endsWith('.js');
}).map(function (f) { return path.join('ui', f); }));

const failures = [];
let checkedFiles = 0, checkedRefs = 0;

files.forEach(function (file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const branch = browserBranch(src);
  if (!branch) return;
  checkedFiles += 1;
  const provided = providedKeys(branch.text);

  // Only count real references, not the bridge declaration itself.
  const body = src.slice(src.indexOf(branch.text) + branch.text.length);
  const re = new RegExp('\\' + branch.name.replace(/\$/g, '\\$') + '\\.(\\w+)\\.(\\w+)', 'g');
  let use;
  while ((use = re.exec(body)) !== null) {
    const ns = use[1], member = use[2];
    checkedRefs += 1;
    if (!(ns in provided)) {
      failures.push(file + ': uses ' + branch.name + '.' + ns + '.' + member +
        ' but the browser branch has no "' + ns + '" namespace');
      continue;
    }
    if (provided[ns] === null) continue;     // opaque, cannot check
    if (!provided[ns].has(member)) {
      failures.push(file + ': uses ' + branch.name + '.' + ns + '.' + member +
        ' but the browser branch only provides ' + ns + ': {' +
        Array.from(provided[ns]).join(', ') + '}');
    }
  }
});

// The SECOND bridge shape, and the one that let a real crash through.
//
// Some files resolve dependencies lazily through an accessor —
// `function _historyDeps() { return require ? {...} : {...}; }` — to break a
// require cycle or a browser load-order problem. Those carry exactly the same
// hand-written browser list as _X_DATA, and drift exactly the same way, but the
// scan above only knows the `var _X_DATA =` shape and skipped them entirely.
//
// This happened for real: recordTakeovers was added to history.js and called as
// `_historyDeps().history.recordTakeovers(...)`. The Node branch hands over the
// whole module, so all 61 validators passed. In the browser the accessor's list
// named only recordFeats, and EVERY finished game threw — the game was
// unplayable while the suite was green.
function lazyBranches(src) {
  const out = [];
  const re = /function\s+(_\w*Deps)\s*\(\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const bodyOpen = src.indexOf('{', m.index + m[0].length - 1);
    const qIdx = src.indexOf('?', bodyOpen);
    if (qIdx < 0) continue;
    const nodeOpen = src.indexOf('{', qIdx);
    if (nodeOpen < 0) continue;
    const nodeClose = matchBrace(src, nodeOpen);
    if (nodeClose < 0) continue;
    const colon = src.indexOf(':', nodeClose);
    if (colon < 0) continue;
    const browserOpen = src.indexOf('{', colon);
    if (browserOpen < 0) continue;
    const browserClose = matchBrace(src, browserOpen);
    if (browserClose < 0) continue;
    out.push({ name: m[1], text: src.slice(browserOpen, browserClose + 1) });
  }
  return out;
}

let checkedLazy = 0, checkedLazyRefs = 0;
files.forEach(function (file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  lazyBranches(src).forEach(function (branch) {
    checkedLazy += 1;
    const provided = providedKeys(branch.text);
    // `_historyDeps().history.recordFeats` — the call parens sit between the
    // accessor name and the namespace, which is the whole difference from the
    // eager shape above.
    const re = new RegExp(branch.name + '\\(\\)\\.(\\w+)\\.(\\w+)', 'g');
    let use;
    while ((use = re.exec(src)) !== null) {
      const ns = use[1], member = use[2];
      checkedLazyRefs += 1;
      if (!(ns in provided)) {
        failures.push(file + ': uses ' + branch.name + '().' + ns + '.' + member +
          ' but its browser branch has no "' + ns + '" namespace');
        continue;
      }
      if (provided[ns] === null) continue;
      if (!provided[ns].has(member)) {
        failures.push(file + ': uses ' + branch.name + '().' + ns + '.' + member +
          ' but the browser branch only provides ' + ns + ': {' +
          Array.from(provided[ns]).join(', ') + '}');
      }
    }
  });
});

if (failures.length) {
  console.error('Browser bridge is missing members the code actually calls.');
  console.error('Node takes the other branch, so the suite passes and the GAME breaks.\n');
  failures.forEach(function (f) { console.error('  ' + f); });
  assert.fail(failures.length + ' missing browser-bridge member(s)');
}

console.log('checkBrowserBridges: OK (' + checkedFiles + ' eager bridges, ' + checkedRefs + ' references)');
console.log('checkLazyBridges: OK (' + checkedLazy + ' lazy accessors, ' + checkedLazyRefs + ' references)');

// THE THIRD WAY A BRIDGE LIES, and the one the two checks above sail straight
// past: the browser branch names a global that is real, spelled right, and
// exported — but its <script> tag comes LATER in index.html than the file
// capturing it. Node has no such thing as load order (require pulls the module
// in on demand), so the Node branch is always fine and the whole suite stays
// green.
//
// This happened for real. save.js's browser branch was given
// `freeAgency: { MARKET_TUNING: MARKET_TUNING }` so a loaded save could
// re-apply its difficulty, but save.js was tagged at line 99 and freeAgency.js
// at line 142. save.js threw on load. Its function declarations still hoisted,
// so nothing looked obviously wrong — but every `const` in it stayed
// uninitialised, which took out the System tab (SAVE_SLOT_COUNT) and blocked
// the offseason entirely (pushSeasonSnapshot reads SEASON_SNAPSHOT_LIMIT, and
// runOffseasonRollover calls it first thing).
//
// A capture is a LOAD-TIME read. Anything a bridge names has to already exist.
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const loadOrder = {};
let tagIdx = 0;
indexHtml.replace(/<script src="([^"]+)"/g, function (_, src) {
  loadOrder[src] = tagIdx++;
  return '';
});

// Where every top-level global is declared. Column-zero only: that is what
// makes a name global in a classic script, and it is how every file here
// declares one.
const declaredIn = {};
files.forEach(function (file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let m;
  const re = /^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = re.exec(src)) !== null) {
    if (!declaredIn[m[1]]) declaredIn[m[1]] = [];
    declaredIn[m[1]].push(file.split(path.sep).join('/'));
  }
});

let checkedCaptures = 0;
files.forEach(function (file) {
  const key = file.split(path.sep).join('/');
  const here = loadOrder[key];
  if (here === undefined) return;            // not loaded by the page at all
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const branch = browserBranch(src);
  if (!branch) return;

  // Every identifier sitting on the right of a colon: `ns: { fn: fn }` reads
  // the second `fn`, and `storage: localStorage` reads localStorage.
  const seen = new Set();
  let m;
  const re = /:\s*([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(branch.text)) !== null) seen.add(m[1]);

  // And the guarded form, which this check used to miss entirely:
  //
  //     LEAGUE_HISTORY: typeof LEAGUE_HISTORY !== 'undefined' ? LEAGUE_HISTORY : null
  //
  // The regex above reads the identifier after the colon and gets `typeof`, so
  // the real name was never checked. That matters more than the plain form,
  // not less: an unguarded capture of a global that does not exist yet THROWS
  // and takes the file with it, which is loud and gets found in a minute. The
  // guarded one quietly captures null, the file loads, every Node test still
  // passes because require() ignores tag order, and the feature is simply dead
  // in the browser forever. gmMemory.js and gmAgenda.js both shipped that way
  // for exactly as long as it took to write this.
  const guarded = /typeof\s+([A-Za-z_$][\w$]*)\s*!==\s*['"]undefined['"]/g;
  while ((m = guarded.exec(branch.text)) !== null) seen.add(m[1]);

  seen.forEach(function (name) {
    const decls = declaredIn[name];
    if (!decls) return;                      // a builtin (localStorage, Math)
    if (decls.indexOf(key) !== -1) return;   // declared in this very file
    checkedCaptures += 1;
    const earliest = decls.reduce(function (best, d) {
      const at = loadOrder[d];
      if (at === undefined || at >= here) return best;
      return (best === null || at < best) ? at : best;
    }, null);
    if (earliest === null) {
      failures.push(key + ': its browser bridge captures ' + name + ' at LOAD time, but ' +
        decls.join(' / ') + ' is tagged AFTER it in index.html — the whole file throws on load');
    }
  });
});

if (failures.length) {
  console.error('A browser bridge captures a global that does not exist yet.\n');
  failures.forEach(function (f) { console.error('  ' + f); });
  assert.fail(failures.length + ' load-order violation(s)');
}

console.log('checkBridgeCapturesLoadFirst: OK (' + checkedCaptures + ' captured globals in load order)');
console.log('All browser bridge validations passed');
