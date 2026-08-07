// The coaching layer of the Watch Game view: the timeout button, the
// substitution panel, and the nudges — everything that reads live sim state
// and turns a click into a decision.
//
// Split out of ui/pixelGameView.js for the same reason pixelAudio.js and
// pixelHud.js were: that file is the playback loop and the motion model, and
// adding user agency to it had pushed it back past the size the split was
// meant to fix. This module owns no playback state; it borrows what it needs
// through the accessors in `opts`, so it cannot affect what is drawn.
//
// Everything here is OPTIONAL for the user. gameSim.js's auto-coach still
// runs the team; these controls let a human override it at a possession
// boundary, and an ignored nudge hands the decision straight back (see
// sim.userTeam in gameSim.js for why the timeout in particular has to be
// claimed rather than raced).

// How long a nudge stays up, measured on the PLAYBACK clock so it lasts the
// same number of possessions at 1x and 8x.
const PIXEL_NUDGE_LIFETIME_MS = 6000;

// Wall-clock backstop. The playback clock stops when the user pauses, and
// during the freeze-frames that hold the quarter-break card — so a nudge
// timed purely on playback could sit on screen forever. Pausing to read a
// nudge is the most natural thing to do with one, and doing so used to trap
// it permanently. Whichever limit is reached first retires the card.
const PIXEL_NUDGE_WALL_CEILING_MS = 15000;

// opts:
//   sim            - the live GameSim
//   userSide       - 'home' | 'away' | null (null = watch-only)
//   opponentName   - display name of the side the user is NOT coaching
//   playbackMs     - () => current playback position, for nudge expiry
//   isFinished     - () => true once the game is over
//   commentaryEl   - the broadcast feed, for confirming a called timeout
function createPixelCoach(opts) {
  const sim = opts.sim;
  const userSide = opts.userSide;

  const timeoutBtn = document.getElementById('pixel-timeout');
  const subsBtn = document.getElementById('pixel-subs');
  const subPanel = document.getElementById('pixel-subpanel');
  const nudgeSlot = document.getElementById('pixel-nudge-slot');

  let selectedOutId = null;
  let onEscape = null;      // document-level listener, removed at game over
  let activeNudge = null;   // { kind, key, expiresAt, apply, onExpire }
  let lastNudgeKey = null;  // so one situation nudges once, not every frame

  function lineFor(pid) {
    const box = userSide === 'home' ? sim.homeBox : sim.awayBox;
    const line = box[pid];
    if (!line) return null;
    // secondsPlayed lives on the sim, not the box line (box `minutes` is only
    // written at result() time), so it is merged in for display here.
    return Object.assign({}, line, { secondsPlayed: sim.secondsPlayed[pid] || 0 });
  }

  function refreshTimeoutBtn() {
    if (!userSide) { timeoutBtn.disabled = true; timeoutBtn.textContent = 'Timeout'; return; }
    const left = sim.timeoutsLeft[userSide];
    timeoutBtn.textContent = 'Timeout (' + left + ')';
    timeoutBtn.disabled = left <= 0 || opts.isFinished();
  }

  function refreshSubPanel() {
    if (!userSide) return;
    const roster = userSide === 'home' ? sim.homeRoster : sim.awayRoster;
    const onIds = sim.onCourt[userSide];
    const byId = {};
    roster.forEach(function (p) { byId[p.id] = p; });
    pixelRenderSubPanel(subPanel, {
      onCourt: onIds.map(function (id) { return byId[id]; }).filter(Boolean),
      bench: roster.filter(function (p) { return onIds.indexOf(p.id) === -1; }),
      lineFor: lineFor,
      selectedOutId: selectedOutId
    });
  }

  function openSubs(preselectId) {
    subPanel.hidden = false;
    subsBtn.classList.add('active');
    if (preselectId) selectedOutId = preselectId;
    refreshSubPanel();
  }

  function closeSubs() {
    subPanel.hidden = true;
    subsBtn.classList.remove('active');
    selectedOutId = null;
  }

  function showNudge(nudge) {
    if (!nudge || nudge.key === lastNudgeKey) return;
    lastNudgeKey = nudge.key;
    activeNudge = nudge;
    activeNudge.expiresAt = opts.playbackMs() + PIXEL_NUDGE_LIFETIME_MS;
    activeNudge.wallDeadline = Date.now() + PIXEL_NUDGE_WALL_CEILING_MS;
    pixelRenderNudge(nudgeSlot, nudge);
    const btn = document.getElementById('pixel-nudge-action');
    if (btn) btn.addEventListener('click', function () {
      nudge.apply();
      clearNudge(false);
    });
    // Dismissing is treated exactly like letting it expire: the coach still
    // decides whatever the user chose not to.
    const x = document.getElementById('pixel-nudge-dismiss');
    if (x) x.addEventListener('click', function () { clearNudge(true); });
  }

  // `expired` distinguishes "the user ignored it" from "the user acted on
  // it". Ignoring must leave the game exactly where the auto-coach would have
  // put it, which is what onExpire does.
  function clearNudge(expired) {
    if (expired && activeNudge && activeNudge.onExpire) activeNudge.onExpire();
    activeNudge = null;
    pixelRenderNudge(nudgeSlot, null);
  }

  function checkNudges() {
    if (!userSide || opts.isFinished()) return;
    if (activeNudge) {
      if (opts.playbackMs() >= activeNudge.expiresAt ||
          Date.now() >= activeNudge.wallDeadline) clearNudge(true);
      return;
    }
    const other = userSide === 'home' ? 'away' : 'home';

    // 1. The opponent is on a run and we still have a timeout.
    if (sim.run.team === other && sim.run.points >= RUN_TRIGGER_POINTS && sim.timeoutsLeft[userSide] > 0) {
      showNudge({
        kind: 'run',
        key: 'run:' + other + ':' + sim.run.points,
        text: opts.opponentName + ' on a ' + sim.run.points + '-0 run',
        actionLabel: 'Call timeout',
        apply: function () {
          sim.applyDecision({ type: 'timeout', team: userSide });
          refreshTimeoutBtn();
        },
        onExpire: function () {
          // Ignored — so the coach decides exactly as it would have if the
          // user were not watching at all.
          if (decideTimeout(sim, userSide)) {
            sim.applyDecision({ type: 'timeout', team: userSide });
            refreshTimeoutBtn();
          }
        }
      });
      return;
    }

    // There is deliberately NO foul-trouble nudge. gameCoach.js already sits a
    // player at 4+ fouls before the fourth quarter, at the same possession
    // boundary such a nudge would fire — so in practice it almost never
    // appeared, and when it did it was asking the user to redo a decision
    // that had already been made for them. Prompting someone to re-make an
    // automatic decision is the definition of micromanagement, and the
    // broadcast info strip already shows who is in foul trouble.
    //
    // The timeout above is different in kind: it is a scarce one-shot
    // resource (7 a game), and gameSim.js hands that specific decision to
    // this view rather than the coach (sim.userTeam), so the nudge is the
    // only place it surfaces — and ignoring it hands it straight back.
  }

  if (!userSide) {
    timeoutBtn.disabled = true;
    subsBtn.disabled = true;
  } else {
    // Claim this team's timeout decision from the auto-coach (see gameSim.js).
    // The view offers it via a nudge and applies the coach's own decision if
    // the offer is ignored, so the outcome is unchanged for a hands-off
    // viewer — only the opportunity is added.
    sim.userTeam = userSide;
    refreshTimeoutBtn();

    timeoutBtn.addEventListener('click', function () {
      if (!sim.applyDecision({ type: 'timeout', team: userSide })) return;
      // Queued, not spent: it lands at the next possession boundary. Say so,
      // rather than decrementing a counter the engine has not decremented.
      timeoutBtn.textContent = 'Timeout called';
      timeoutBtn.disabled = true;
      pixelPushCommentary(opts.commentaryEl, 'You call timeout — the team gathers at the bench');
    });

    subsBtn.addEventListener('click', function () {
      if (subPanel.hidden) { openSubs(null); return; }
      closeSubs();
    });

    // Escape closes it too — the panel covers the court, and a keyboard exit
    // is the one that always works no matter where the page is scrolled.
    onEscape = function (e) { if (e.key === 'Escape' && !subPanel.hidden) closeSubs(); };
    document.addEventListener('keydown', onEscape);

    subPanel.addEventListener('click', function (e) {
      if (e.target.closest('#pixel-sub-close')) { closeSubs(); return; }
      const out = e.target.closest('.pixel-sub-out');
      if (out) { selectedOutId = out.getAttribute('data-pid'); refreshSubPanel(); return; }
      const inBtn = e.target.closest('.pixel-sub-in');
      if (!inBtn || !selectedOutId) return;
      sim.applyDecision({
        type: 'substitution',
        team: userSide,
        swaps: [{ out: selectedOutId, in: inBtn.getAttribute('data-pid') }]
      });
      selectedOutId = null;
      refreshSubPanel();
    });
  }

  return {
    // Called after each stepped possession: a queued decision lands at the
    // boundary just crossed, so the controls have to re-read the sim or the
    // user cannot tell their click did anything.
    refresh: function () {
      if (!userSide) return;
      refreshTimeoutBtn();
      if (!subPanel.hidden) refreshSubPanel();
    },
    checkNudges: checkNudges,
    // The coaching controls die with the game. Without this they keep their
    // last live labels ("Timeout (6)") and stay clickable after the final
    // buzzer — the engine correctly refuses the decision, so nothing breaks,
    // but a control that looks live and does nothing is its own bug.
    onGameOver: function () {
      timeoutBtn.disabled = true;
      subsBtn.disabled = true;
      subPanel.hidden = true;
      subsBtn.classList.remove('active');
      clearNudge(false);
      // The keydown listener is on `document`, so it outlives this view's DOM
      // and would pile up one handler per watched game without this.
      if (onEscape) { document.removeEventListener('keydown', onEscape); onEscape = null; }
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPixelCoach: createPixelCoach };
}
