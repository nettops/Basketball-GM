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

const files = fs.readdirSync(ROOT).filter(function (f) {
  return f.endsWith('.js') && fs.statSync(path.join(ROOT, f)).isFile();
});

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

if (failures.length) {
  console.error('Browser bridge is missing members the code actually calls.');
  console.error('Node takes the other branch, so the suite passes and the GAME breaks.\n');
  failures.forEach(function (f) { console.error('  ' + f); });
  assert.fail(failures.length + ' missing browser-bridge member(s)');
}

console.log('checkBrowserBridges: OK (' + checkedFiles + ' bridges, ' + checkedRefs + ' references)');
console.log('All browser bridge validations passed');
