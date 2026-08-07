// Build script: extracts a curated subset of facesjs SVG templates and
// bundles them into faceSvgs.js for our no-build vanilla JS project.
// Run from the repo root: node scripts/build-face-svgs.js
// Requires reference/facesjs/ to be present (see reference/ README / plan doc).
const fs = require('fs');
const path = require('path');

const SVG_ROOT = path.join(__dirname, '..', 'reference', 'facesjs', 'svgs');
const OUT_FILE = path.join(__dirname, '..', 'faceSvgs.js');

// Curated selection — male-only (NBA rosters), enough variety per category
// to produce effectively unique faces across a few hundred players.
const SELECTION = {
  head: ['head1','head2','head3','head4','head5','head6','head7','head8'],
  eye: ['eye1','eye3','eye5','eye7','eye9','eye11','eye13','eye15'],
  eyebrow: ['eyebrow1','eyebrow3','eyebrow5','eyebrow7','eyebrow9','eyebrow11'],
  eyeLine: ['line1','line2','line3','none'],
  nose: ['nose1','nose3','nose5','nose7','nose9','nose11','small','honker'],
  mouth: ['mouth','mouth2','smile','smile2','smile3','straight','closed','angry'],
  ear: ['ear1','ear2','ear3'],
  facialHair: ['none','beard1','beard3','beard5','goatee1','goatee5','mustache1','sideburns1','sideburns3','muttonStache'],
  hair: ['hair','high','juice','messy','short','short2','short3','spike','spike2','curly','curly2','afro','afro2','cornrows','dreads','faux-hawk','parted','bald','crop','emo'],
  hairBg: ['none','shaggy','longHair'],
  body: ['body','body2','body3','body4','body5'],
  jersey: ['jersey','jersey2','jersey3','jersey4','jersey5'],
  glasses: ['none','glasses1-primary','glasses2-black'],
  accessories: ['none','eye-black','headband'],
  miscLine: ['none','blush','chin1','freckles1','forehead1'],
  smileLine: ['none','line1','line2']
};

const svgs = {};
let totalFiles = 0;
for (const category of Object.keys(SELECTION)) {
  svgs[category] = {};
  for (const key of SELECTION[category]) {
    const filePath = path.join(SVG_ROOT, category, key + '.svg');
    if (!fs.existsSync(filePath)) {
      console.error('MISSING: ' + filePath);
      continue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const vbMatch = raw.match(/viewBox="([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+)"/);
    const vb = vbMatch ? [parseFloat(vbMatch[1]), parseFloat(vbMatch[2]), parseFloat(vbMatch[3]), parseFloat(vbMatch[4])] : [0, 0, 400, 600];
    // Strip the outer <svg ...> and </svg> tags, keep inner content
    // (styles + paths), matching facesjs's own build tool approach.
    const inner = raw.replace(/[\s\S]*?<svg[^>]*>/, '').replace('</svg>', '').trim();
    // [innerContent, viewBoxCenterX, viewBoxCenterY] — center is precomputed
    // here so faces.js can position/rotate/scale features around their own
    // natural center using pure string transforms, with no DOM/getBBox needed.
    svgs[category][key] = [inner, vb[0] + vb[2] / 2, vb[1] + vb[3] / 2];
    totalFiles++;
  }
}

const header = '// Curated subset of facesjs (https://github.com/zengm-games/facesjs) SVG\n' +
  '// feature templates, bundled as inline JS data for this project\'s no-build\n' +
  '// vanilla setup. Male-only selection (NBA rosters). Source SVGs are\n' +
  '// Apache-2.0 licensed by the ZenGM project; see assets/faces/FACESJS_LICENSE.txt.\n' +
  '// Regenerate via scripts/build-face-svgs.js if the curated list changes.\n' +
  '// Each entry is [innerSvgMarkup, viewBoxCenterX, viewBoxCenterY].\n\n' +
  'var FACE_SVGS = ' + JSON.stringify(svgs, null, 0) + ';\n\n' +
  'if (typeof module !== \'undefined\' && module.exports) {\n' +
  '  module.exports = { FACE_SVGS: FACE_SVGS };\n' +
  '}\n';

fs.writeFileSync(OUT_FILE, header);
console.log('Wrote ' + OUT_FILE + ' with ' + totalFiles + ' SVG templates across ' + Object.keys(SELECTION).length + ' categories.');
console.log('File size: ' + (fs.statSync(OUT_FILE).size / 1024).toFixed(1) + ' KB');
