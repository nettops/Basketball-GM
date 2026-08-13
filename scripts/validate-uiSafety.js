// Static safety scan of the ui/ layer.
//
// Every view in this app builds markup by string concatenation and assigns it
// with innerHTML. That's workable, but it makes two whole classes of defect
// invisible to `node --check` because the result is still valid JavaScript:
//
//   1. Unescaped user-controlled text (player names from career mode and the
//      commissioner tools, team names from relocation/expansion, save names)
//      interpolated straight into markup. A '<' corrupts the view; an
//      apostrophe inside an inline onclick breaks the handler outright.
//   2. Corruption from bulk/regex edits — `escapeHtml(` spliced into the middle
//      of an identifier (`slot.name` -> `sloescapeHtml(t.name)`) or wrapped
//      twice (`escapeHtml(escapeHtml(x))`). Both parse fine and both shipped
//      during an escaping sweep before this check existed.
//
// Fails loudly with file:line so these can't reach the browser again.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');
const uiFiles = fs.readdirSync(UI_DIR).filter(function (f) { return f.endsWith('.js'); });

function readLines(file) {
  return fs.readFileSync(path.join(UI_DIR, file), 'utf8').split('\n');
}

// A line is "building markup" if it concatenates into a string literal, uses a
// template literal, or assigns innerHTML. Logic-only lines are ignored.
const BUILDS_MARKUP = /(\+\s*['"]|['"]\s*\+|\$\{|innerHTML)/;

function isCommented(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

// Deliberate opt-out for lines that concatenate strings but aren't markup —
// building a save name, a filename, a comparison key. The heuristic below is
// intentionally broad (a value can reach innerHTML far from where it's built,
// as the free-agency signing log did), so the escape hatch is an explicit,
// reviewable marker at the site rather than a looser rule that lets real
// misses through.
const NOT_MARKUP_MARKER = 'ui-safety: not-markup';

// ---------------------------------------------------------------------------

function checkNoEscapeHtmlCorruption() {
  // `escapeHtml(` glued onto the tail of another identifier.
  const SPLICE = /[A-Za-z_$][\w$]*escapeHtml\(/;
  // `escapeHtml(` nested directly inside another `escapeHtml(`.
  const DOUBLE = /escapeHtml\([^()]*escapeHtml\(/;
  const problems = [];

  uiFiles.forEach(function (file) {
    readLines(file).forEach(function (line, i) {
      if (SPLICE.test(line)) problems.push(file + ':' + (i + 1) + ' escapeHtml spliced into an identifier -> ' + line.trim().slice(0, 100));
      if (DOUBLE.test(line)) problems.push(file + ':' + (i + 1) + ' escapeHtml applied twice -> ' + line.trim().slice(0, 100));
    });
  });

  assert.deepStrictEqual(problems, [], 'escapeHtml corruption:\n  ' + problems.join('\n  '));
  console.log('checkNoEscapeHtmlCorruption: OK (' + uiFiles.length + ' files)');
}

// ---------------------------------------------------------------------------

function checkUserTextIsEscapedInMarkup() {
  // Properties that can carry user-typed text. `.text` is feed copy, which is
  // assembled in the sim layer from player and team names.
  const RISKY = /\.(name|teamName|playerName|text|details|description)\b/;
  const problems = [];

  uiFiles.forEach(function (file) {
    const lines = readLines(file);
    lines.forEach(function (line, i) {
      if (isCommented(line)) return;
      // Marker may sit on the line itself or in the comment block directly
      // above it, which is this codebase's prevailing style.
      if (line.indexOf(NOT_MARKUP_MARKER) !== -1) return;
      if (lines.slice(Math.max(0, i - 4), i).some(function (prev) { return prev.indexOf(NOT_MARKUP_MARKER) !== -1; })) return;
      if (!BUILDS_MARKUP.test(line)) return;

      // Walk each risky property reference and require an escapeHtml( wrapper
      // opening somewhere before it on the line.
      let m;
      const re = new RegExp(RISKY.source, 'g');
      while ((m = re.exec(line)) !== null) {
        const before = line.slice(0, m.index);
        // Cheap containment test: more '(' than ')' after the last escapeHtml
        // means we're still inside its argument list.
        const lastEscape = before.lastIndexOf('escapeHtml(');
        if (lastEscape === -1) {
          problems.push(file + ':' + (i + 1) + ' unescaped ' + m[0] + ' -> ' + line.trim().slice(0, 100));
          continue;
        }
        const tail = before.slice(lastEscape + 'escapeHtml('.length);
        const open = (tail.match(/\(/g) || []).length;
        const close = (tail.match(/\)/g) || []).length;
        if (close > open) {
          problems.push(file + ':' + (i + 1) + ' unescaped ' + m[0] + ' -> ' + line.trim().slice(0, 100));
        }
      }
    });
  });

  assert.deepStrictEqual(problems, [], 'unescaped user-controlled text in markup:\n  ' + problems.join('\n  '));
  console.log('checkUserTextIsEscapedInMarkup: OK');
}

// ---------------------------------------------------------------------------

function checkNoInterpolatedInlineHandlers() {
  // An inline onclick with an interpolated VALUE is the pattern that broke on
  // an apostrophe. Interpolated ids are equally fragile; the codebase's own
  // convention elsewhere is a data-* attribute plus addEventListener.
  const problems = [];
  const INLINE_WITH_INTERP = /on(click|change|input|submit)\s*=\s*["'][^"']*(\$\{|'\s*\+|\+\s*')/;

  uiFiles.forEach(function (file) {
    readLines(file).forEach(function (line, i) {
      if (isCommented(line)) return;
      if (INLINE_WITH_INTERP.test(line)) {
        problems.push(file + ':' + (i + 1) + ' inline handler with interpolated data (use data-* + addEventListener) -> ' + line.trim().slice(0, 100));
      }
    });
  });

  assert.deepStrictEqual(problems, [], 'fragile inline event handlers:\n  ' + problems.join('\n  '));
  console.log('checkNoInterpolatedInlineHandlers: OK');
}

// ---------------------------------------------------------------------------

// Views are registered in script.js's BUILT_VIEWS and listed in ui/nav.js's
// NAV_ITEMS. A nav entry with no renderer silently falls through to the
// "Coming in a later phase" placeholder, which reads as a broken view.
function checkEveryNavItemHasARenderer() {
  const navSrc = fs.readFileSync(path.join(UI_DIR, 'nav.js'), 'utf8');
  const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

  const navIds = [];
  // Bounded by NAV_HUBS, not NAV_GROUP_ORDER: hubs are declared between the
  // two and their ids ('hub-league') are not views, so sweeping them in would
  // assert renderers that are not supposed to exist. A later task deletes
  // NAV_GROUP_ORDER entirely, which would have made indexOf return -1 and
  // silently widened this slice to the end of the file.
  const navBlock = navSrc.slice(navSrc.indexOf('const NAV_ITEMS'), navSrc.indexOf('const NAV_HUBS'));
  const idRe = /\{\s*id:\s*'([^']+)'/g;
  let m;
  while ((m = idRe.exec(navBlock)) !== null) navIds.push(m[1]);
  assert.ok(navIds.length > 10, 'should have parsed the NAV_ITEMS list, got ' + navIds.length);

  const builtBlock = scriptSrc.slice(scriptSrc.indexOf('const BUILT_VIEWS'), scriptSrc.indexOf('function isRegularSeasonAndPlayoffsComplete'));
  const missing = navIds.filter(function (id) {
    return !new RegExp('(^|[\\s{,])' + id + '\\s*:').test(builtBlock);
  });

  assert.deepStrictEqual(missing, [], 'nav items with no renderer in BUILT_VIEWS: ' + missing.join(', '));
  console.log('checkEveryNavItemHasARenderer: OK (' + navIds.length + ' views)');
}

// ---------------------------------------------------------------------------

// ui/util.js must load before anything that calls escapeHtml, and every ui/
// file on disk must actually be loaded by the page. A file present but not
// referenced is dead code that looks live.
function checkIndexHtmlLoadsEveryUiFile() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const missing = uiFiles.filter(function (f) { return html.indexOf('ui/' + f) === -1; });
  assert.deepStrictEqual(missing, [], 'ui files not loaded by index.html: ' + missing.join(', '));

  const utilPos = html.indexOf('ui/util.js');
  assert.ok(utilPos !== -1, 'index.html must load ui/util.js');
  uiFiles.forEach(function (f) {
    if (f === 'util.js') return;
    assert.ok(html.indexOf('ui/' + f) > utilPos, 'ui/util.js must load before ui/' + f + ' so escapeHtml is defined');
  });
  console.log('checkIndexHtmlLoadsEveryUiFile: OK (' + uiFiles.length + ' files)');
}

// A view that emits a class the stylesheet has no rule for renders as
// unstyled default text, and every other check still passes: the markup is
// there, the content is right, the view is reachable, nothing throws.
//
// The whole Ultimates feature shipped that way. All three of its surfaces —
// the reference page, the profile panel and the box-score summary — were
// written by copying ui/badges.js, class-name scheme and all (badge-ref-foot
// became ult-ref-foot), and the stylesheet half was never carried across. The
// reference page rendered twelve ultimates as one unbroken column of default
// text with "1 holder" and "Stephen Curry (88)" run together, and the Node
// suite and the 182-check browser smoke suite were both entirely green.
//
// Only literal class attributes are checked. A class assembled by string
// concatenation has no statically knowable value, and guessing at one would
// trade a real check for a noisy one.
//
// UNSTYLED_BY_DESIGN is for classes that exist only as a JS selector hook.
// Adding to it is a claim that nothing should style the class — not a way to
// silence this check, which is why each entry names the querySelector that
// reads it. The list started at seven; the other four were real:
//
//   btn             vestigial base class, always paired with btn-primary or
//                   btn-ghost and styling nothing. Removed from 13 elements.
//   btn-secondary   a fourth button variant that was never defined, so three
//                   real buttons fell back to the plain default. Mapped to the
//                   variants that do exist — btn-ghost for the two All-Star
//                   contest buttons, btn-danger for Fire Coach, which is what
//                   Waive and Delete Player already use.
//   form-group      the player-creation form had no rules at all. Career mode
//                   is parked so nobody could see it, which is exactly why it
//                   would have been found the hard way later.
//   trade-team-panel  written and never read: no rule styled it and no
//                   selector looked it up, along with a data-team-id on the
//                   same element that nothing reads either. Both deleted.
const UNSTYLED_BY_DESIGN = [
  'traitCheckbox',      // ui/playerCreation.js  querySelectorAll('.traitCheckbox')
  'pixel-replay-btn',   // ui/pixelGameView.js   querySelectorAll('.pixel-replay-btn')
  'schedule-watch-btn'  // ui/schedule.js        querySelectorAll('.schedule-watch-btn')
];

function checkEveryLiteralClassIsStyled() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const styled = {};
  let m;
  const selector = /\.([a-zA-Z][\w-]*)/g;
  while ((m = selector.exec(css)) !== null) styled[m[1]] = true;

  const orphans = [];
  uiFiles.forEach(function (f) {
    // Comments are stripped first. A comment explaining a class that was
    // REMOVED still contains the text class="..." and the first version of this
    // check happily reported it as live markup. Block comments go entirely;
    // for line comments only whole-line ones are dropped, so a trailing // in a
    // string (a URL, say) cannot truncate a line that also emits markup.
    const src = fs.readFileSync(path.join(__dirname, '..', 'ui', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter(function (line) { return !/^\s*\/\//.test(line); })
      .join('\n');
    const attr = /class="([^"]*)"/g;
    let a;
    while ((a = attr.exec(src)) !== null) {
      if (/['+$]/.test(a[1])) continue;   // spliced at runtime; not knowable here
      a[1].split(/\s+/).filter(Boolean).forEach(function (cls) {
        if (styled[cls] || UNSTYLED_BY_DESIGN.indexOf(cls) !== -1) return;
        const where = 'ui/' + f + ' .' + cls;
        if (orphans.indexOf(where) === -1) orphans.push(where);
      });
    }
  });
  assert.deepStrictEqual(orphans, [],
    'these classes are emitted but style.css has no rule for them, so they ' +
    'render as unstyled text: ' + orphans.join(', '));
  console.log('checkEveryLiteralClassIsStyled: OK (' +
    Object.keys(styled).length + ' styled classes, ' +
    UNSTYLED_BY_DESIGN.length + ' deliberately unstyled)');
}

checkNoEscapeHtmlCorruption();
checkUserTextIsEscapedInMarkup();
checkNoInterpolatedInlineHandlers();
checkEveryNavItemHasARenderer();
checkIndexHtmlLoadsEveryUiFile();
checkEveryLiteralClassIsStyled();

console.log('All UI safety validations passed');
