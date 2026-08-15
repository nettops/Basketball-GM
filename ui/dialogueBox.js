// The dialogue overlay. Knows nothing about basketball — its entire input is
// a scene object and a context object.
//
// It is a DOM overlay rather than a #view-content scene (the convention every
// other scene in ui/ follows) for one reason: halftime fires INSIDE the live
// pixel game view, on top of a canvas that is mid-playback. Rendering into
// #view-content would mean tearing that down, and the two moments would drift
// into two implementations.

var _DIALOGUE_BOX_DATA = (typeof require !== 'undefined')
  ? { bust: require('./pixelBust.js'), scenes: require('../dialogueScenes.js') }
  : { bust: {
        drawPixelBust: drawPixelBust, bustScale: bustScale,
        bustColorsFor: bustColorsFor, BUST: BUST
      },
      scenes: { interpolate: interpolate } };

// A click mid-line completes it instantly, so this is a floor on comfort
// rather than a ceiling on reading speed.
const DIALOGUE_CHAR_MS = 28;
const DIALOGUE_BUST_PX = 120;

// Only one box at a time. A second scene arriving while one is up is refused
// here and dropped by the caller, not queued: two overlapping interviews is
// never what the player wanted.
let _openBox = null;

function dialogueBoxIsOpen() {
  return _openBox !== null;
}

function closeDialogueBox() {
  if (!_openBox) return;
  if (_openBox.onKey && typeof document !== 'undefined') {
    document.removeEventListener('keydown', _openBox.onKey);
  }
  if (_openBox.timer) clearInterval(_openBox.timer);
  if (_openBox.root && _openBox.root.parentNode) {
    _openBox.root.parentNode.removeChild(_openBox.root);
  }
  _openBox = null;
}

function _speakerName(scene, ctx) {
  if (ctx && ctx.speakerName) return ctx.speakerName;
  const kind = (scene.speaker && scene.speaker.kind) || 'reporter';
  return kind === 'coach' ? 'Head Coach' : 'Beat Writer';
}

function runDialogue(scene, ctx, onDone) {
  if (typeof document === 'undefined' || !document.body) return false;
  if (_openBox) return false;
  if (!scene || !Array.isArray(scene.lines) || !Array.isArray(scene.choices)) return false;
  if (scene.lines.length === 0 || scene.choices.length === 0) return false;

  const done = typeof onDone === 'function' ? onDone : function () {};

  const root = document.createElement('div');
  root.className = 'dlg-overlay';

  const box = document.createElement('div');
  box.className = 'dlg-box';

  // The bezel. Bust and text live INSIDE it; the choice stack is a sibling
  // that continues the same rings downward.
  const frame = document.createElement('div');
  frame.className = 'dlg-frame';

  const bustWrap = document.createElement('div');
  bustWrap.className = 'dlg-bust';
  const scale = _DIALOGUE_BOX_DATA.bust.bustScale(DIALOGUE_BUST_PX);
  const canvas = document.createElement('canvas');
  canvas.width = _DIALOGUE_BOX_DATA.bust.BUST.w * scale;
  canvas.height = _DIALOGUE_BOX_DATA.bust.BUST.h * scale;
  bustWrap.appendChild(canvas);

  const body = document.createElement('div');
  body.className = 'dlg-body';

  const plate = document.createElement('div');
  plate.className = 'dlg-plate';
  // textContent, never innerHTML: this is a generated person's name.
  plate.textContent = _speakerName(scene, ctx);

  const textEl = document.createElement('div');
  textEl.className = 'dlg-text';

  const blinker = document.createElement('div');
  blinker.className = 'dlg-blinker';
  blinker.textContent = '▼';
  blinker.style.visibility = 'hidden';

  const choiceList = document.createElement('div');
  choiceList.className = 'dlg-choices';
  choiceList.style.display = 'none';

  body.appendChild(plate);
  body.appendChild(textEl);
  body.appendChild(blinker);
  frame.appendChild(bustWrap);
  frame.appendChild(body);
  box.appendChild(frame);
  box.appendChild(choiceList);
  root.appendChild(box);
  document.body.appendChild(root);

  const reduceMotion = !!(typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const state = {
    root: root, canvas: canvas, scale: scale,
    lineIndex: 0, charIndex: 0, timer: null, onKey: null,
    fullText: '', complete: false, finished: false
  };
  _openBox = state;

  const colors = _DIALOGUE_BOX_DATA.bust.bustColorsFor(
    (ctx && (ctx.speakerPlayer || ctx.speakerReporter)) || {},
    (ctx && ctx.speakerTeam) || null
  );

  function paintBust(emotion) {
    const c2d = canvas.getContext('2d');
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    _DIALOGUE_BOX_DATA.bust.drawPixelBust(c2d, colors, emotion, { scale: state.scale });
  }

  function finishLine() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    textEl.textContent = state.fullText;
    state.complete = true;
    blinker.style.visibility = 'visible';
  }

  function startLine() {
    const line = scene.lines[state.lineIndex];
    state.fullText = _DIALOGUE_BOX_DATA.scenes.interpolate(line.text, ctx || {});
    state.charIndex = 0;
    state.complete = false;
    textEl.textContent = '';
    blinker.style.visibility = 'hidden';
    paintBust(line.emotion);

    if (reduceMotion) { finishLine(); return; }

    state.timer = setInterval(function () {
      state.charIndex++;
      textEl.textContent = state.fullText.slice(0, state.charIndex);
      // Every third character, so it chirps rather than buzzes.
      if (state.charIndex % 3 === 0 && typeof playPixelSfx === 'function') playPixelSfx('blip');
      if (state.charIndex >= state.fullText.length) finishLine();
    }, DIALOGUE_CHAR_MS);
  }

  function finish(result) {
    if (state.finished) return;
    state.finished = true;
    closeDialogueBox();
    done(result);
  }

  function showChoices() {
    blinker.style.visibility = 'hidden';
    choiceList.style.display = '';
    scene.choices.forEach(function (choice, i) {
      const btn = document.createElement('button');
      btn.className = 'dlg-choice';
      btn.type = 'button';
      // textContent: choice text interpolates generated names too.
      btn.textContent = _DIALOGUE_BOX_DATA.scenes.interpolate(choice.text, ctx || {});
      btn.addEventListener('click', function (e) {
        // Without this the click also reaches the overlay's advance handler.
        e.stopPropagation();
        if (choice.emotion) paintBust(choice.emotion);
        finish({ sceneId: scene.id, choiceIndex: i, skipped: false });
      });
      choiceList.appendChild(btn);
    });
    const first = choiceList.querySelector('.dlg-choice');
    if (first && first.focus) first.focus();
  }

  // A click mid-line COMPLETES the line rather than advancing past it.
  // Skipping the rest of a sentence you have not read is the failure this
  // prevents, and it is the behaviour the reference is known for.
  function advance() {
    if (!state.complete) { finishLine(); return; }
    if (state.lineIndex < scene.lines.length - 1) {
      state.lineIndex++;
      startLine();
      return;
    }
    if (choiceList.style.display === 'none') showChoices();
  }

  root.addEventListener('click', advance);

  state.onKey = function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // A skipped scene applies NO effect. Silence is not a choice, and
      // auto-applying a default would punish the user for skipping.
      finish({ sceneId: scene.id, choiceIndex: null, skipped: true });
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      // Once the choices are up, Space and Enter belong to the focused
      // button — intercepting them here would make the list unusable.
      if (choiceList.style.display !== 'none') return;
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener('keydown', state.onKey);

  startLine();
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIALOGUE_CHAR_MS: DIALOGUE_CHAR_MS,
    DIALOGUE_BUST_PX: DIALOGUE_BUST_PX,
    runDialogue: runDialogue,
    dialogueBoxIsOpen: dialogueBoxIsOpen,
    closeDialogueBox: closeDialogueBox
  };
}
