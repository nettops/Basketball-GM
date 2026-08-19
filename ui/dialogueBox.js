// The dialogue overlay. Knows nothing about basketball — its entire input is
// a scene object and a context object.
//
// It is a DOM overlay rather than a #view-content scene (the convention every
// other scene in ui/ follows) for one reason: halftime fires INSIDE the live
// pixel game view, on top of a canvas that is mid-playback. Rendering into
// #view-content would mean tearing that down, and the two moments would drift
// into two implementations.

var _DIALOGUE_BOX_DATA = (typeof require !== 'undefined')
  ? {
      bust: require('./pixelBust.js'),
      scenes: require('../dialogueScenes.js'),
      studio: require('../studioShow.js')
    }
  : { bust: {
        drawPixelBust: drawPixelBust, bustScale: bustScale,
        bustColorsFor: bustColorsFor, BUST: BUST
      },
      scenes: { interpolate: interpolate },
      studio: { crewMember: studioCrewMember, CREW: STUDIO_CREW } };

// A click mid-line completes it instantly, so this is a floor on comfort
// rather than a ceiling on reading speed.
const DIALOGUE_CHAR_MS = 28;
const DIALOGUE_BUST_PX = 120;

// Only one box at a time. A second scene arriving while one is up is refused
// here and dropped by the caller, not queued: two overlapping interviews is
// never what the player wanted.
let _openBox = null;

// A finished studio set, left on screen ONLY to pull back underneath the coach
// box that follows it. It is no longer interactive and owns no listeners — it
// is scenery being struck while the next thing walks on. Tracked separately so
// closeDialogueBox can sweep it if the user leaves mid-transition.
let _lingering = null;

function dialogueBoxIsOpen() {
  return _openBox !== null;
}

function _retireLingering() {
  if (_lingering && _lingering.parentNode) _lingering.parentNode.removeChild(_lingering);
  _lingering = null;
}

function closeDialogueBox() {
  _retireLingering();
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

  // On the BOX, not the overlay. The overlay covers the whole viewport, so
  // binding advance there made every click on the page an advance — a
  // playtester aiming for the Transactions tab hit the overlay instead and
  // burned a line of dialogue he had not read yet. The overlay still swallows
  // outside clicks (that is what a modal is for), it just no longer acts on
  // them, and the cursor changes at the box edge to say where the target is.
  //
  // The studio segment below keeps its whole-root binding on purpose: it is a
  // fullscreen cinematic with nothing else on screen to aim at.
  box.addEventListener('click', advance);

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

// ---------------------------------------------------------------------------
// The halftime studio show.
//
// Shares this module's overlay, typewriter cadence and teardown rather than
// living in its own file, so there is exactly one thing on screen at a time and
// exactly one Esc contract. It is a separate ENTRY POINT rather than a branch
// inside runDialogue because it answers a different question: runDialogue ends
// in a choice, this ends in a cut back to the game.
// ---------------------------------------------------------------------------

// Fullscreen, so the busts are drawn four times up rather than two: at 80px a
// face is a suggestion, and the whole point of the set is that you can see who
// is talking.
const STUDIO_SEAT_PX = 160;

// How long the set takes to pull back out of the way. Must match the transition
// on .studio-fs.studio-handoff in style.css — the timer is only a backstop for
// removing the node, but a shorter one would cut the movement off.
const STUDIO_HANDOFF_MS = 700;

function runStudioSegment(segment, ctx, onDone) {
  if (typeof document === 'undefined' || !document.body) return false;
  if (_openBox) return false;
  if (!segment || !Array.isArray(segment.beats) || segment.beats.length === 0) return false;

  const done = typeof onDone === 'function' ? onDone : function () {};
  const crew = _DIALOGUE_BOX_DATA.studio.CREW;

  // Its own root rather than .dlg-overlay: that class is a bottom-anchored
  // scrim for a box, and this fills the screen.
  const root = document.createElement('div');
  root.className = 'studio-fs';

  const set = document.createElement('div');
  set.className = 'studio-set';

  const crewEl = document.createElement('div');
  crewEl.className = 'studio-crew';

  const seatScale = _DIALOGUE_BOX_DATA.bust.bustScale(STUDIO_SEAT_PX);
  const seats = {};
  crew.forEach(function (member) {
    const seat = document.createElement('div');
    seat.className = 'studio-seat';
    const cv = document.createElement('canvas');
    cv.width = _DIALOGUE_BOX_DATA.bust.BUST.w * seatScale;
    cv.height = _DIALOGUE_BOX_DATA.bust.BUST.h * seatScale;
    const nm = document.createElement('div');
    nm.className = 'studio-seat-name';
    nm.textContent = member.name;
    seat.appendChild(cv);
    seat.appendChild(nm);
    crewEl.appendChild(seat);
    seats[member.key] = { seat: seat, canvas: cv };
  });

  const desk = document.createElement('div');
  desk.className = 'studio-desk';

  const body = document.createElement('div');
  body.className = 'studio-body';

  const plate = document.createElement('div');
  plate.className = 'studio-plate';

  const textEl = document.createElement('div');
  textEl.className = 'studio-text';

  const blinker = document.createElement('div');
  blinker.className = 'studio-blinker';
  blinker.textContent = '▼';
  blinker.style.visibility = 'hidden';

  // Fullscreen takes the whole screen away, so the way out has to be visible.
  const escHint = document.createElement('div');
  escHint.className = 'studio-esc';
  escHint.textContent = 'ESC TO SKIP';

  set.appendChild(crewEl);
  body.appendChild(escHint);
  body.appendChild(plate);
  body.appendChild(textEl);
  body.appendChild(blinker);
  // The desk is a sibling of the set, not a child: the set grows to fill the
  // screen and the desk is a fixed band across the bottom of it.
  root.appendChild(set);
  root.appendChild(desk);
  root.appendChild(body);
  document.body.appendChild(root);

  const reduceMotion = !!(typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const state = {
    root: root, beatIndex: 0, timer: null, onKey: null,
    fullText: '', complete: false, finished: false
  };
  _openBox = state;

  function paintSeat(member, emotion) {
    const cv = seats[member.key].canvas;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    _DIALOGUE_BOX_DATA.bust.drawPixelBust(g, member.colors, emotion, {
      scale: seatScale, traits: member.traits
    });
  }

  // Everybody starts neutral and dim.
  crew.forEach(function (m) { paintSeat(m, 'neutral'); });

  function finishLine() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    textEl.textContent = state.fullText;
    state.complete = true;
    blinker.style.visibility = 'visible';
  }

  function startBeat() {
    const beat = segment.beats[state.beatIndex];
    const speaker = _DIALOGUE_BOX_DATA.studio.crewMember(beat.who);
    // A beat naming somebody who is not on the desk would leave the panel dark
    // with text from nobody. Skip it rather than showing that.
    if (!speaker) { advance(); return; }

    crew.forEach(function (m) {
      seats[m.key].seat.classList.toggle('live', m.key === beat.who);
      paintSeat(m, m.key === beat.who ? beat.emotion : 'neutral');
    });

    plate.textContent = speaker.name;
    state.fullText = _DIALOGUE_BOX_DATA.scenes.interpolate(beat.text, ctx || {});
    state.complete = false;
    textEl.textContent = '';
    blinker.style.visibility = 'hidden';

    if (reduceMotion) { finishLine(); return; }

    let i = 0;
    state.timer = setInterval(function () {
      i++;
      textEl.textContent = state.fullText.slice(0, i);
      if (i % 3 === 0 && typeof playPixelSfx === 'function') playPixelSfx('blip');
      if (i >= state.fullText.length) finishLine();
    }, DIALOGUE_CHAR_MS);
  }

  // Hands the screen over rather than tearing it down.
  //
  // The coach box opens OVER this set while it pulls back and dims, so the two
  // read as one continuous movement instead of two separate popups. That means
  // the set has to outlive its own segment: it stops listening, gives up the
  // one-box slot so the next box can open, and is swept a beat later.
  //
  // Everything interactive is detached first. A lingering set that still had
  // its click handler would swallow clicks meant for the coach's choices.
  function finish(skipped) {
    if (state.finished) return;
    state.finished = true;

    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.onKey) document.removeEventListener('keydown', state.onKey);
    root.removeEventListener('click', advance);
    root.classList.add('studio-handoff');

    _openBox = null;
    _retireLingering();
    _lingering = root;
    const node = root;
    setTimeout(function () { if (_lingering === node) _retireLingering(); }, STUDIO_HANDOFF_MS);

    done({ segmentId: segment.id, skipped: !!skipped });
  }

  function advance() {
    if (!state.complete) { finishLine(); return; }
    if (state.beatIndex < segment.beats.length - 1) {
      state.beatIndex++;
      startBeat();
      return;
    }
    // Nothing to answer — the segment simply ends and the game resumes.
    finish(false);
  }

  root.addEventListener('click', advance);

  state.onKey = function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener('keydown', state.onKey);

  startBeat();
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIALOGUE_CHAR_MS: DIALOGUE_CHAR_MS,
    DIALOGUE_BUST_PX: DIALOGUE_BUST_PX,
    STUDIO_SEAT_PX: STUDIO_SEAT_PX,
    STUDIO_HANDOFF_MS: STUDIO_HANDOFF_MS,
    runDialogue: runDialogue,
    runStudioSegment: runStudioSegment,
    dialogueBoxIsOpen: dialogueBoxIsOpen,
    closeDialogueBox: closeDialogueBox
  };
}
