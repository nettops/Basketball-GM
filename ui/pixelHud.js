// DOM chrome for the pixel game view: everything rendered as HTML around the
// canvas — the recently-watched list, the control bar, the commentary feed,
// the broadcast info strip, and the post-game card. Kept apart from
// ui/pixelGameView.js so the playback loop and the motion model stay readable
// on their own, and so the live controls added on top of them have somewhere
// to live that isn't a 1,000-line file.
//
// Every function takes the elements and data it needs as parameters — none of
// it reads the view's playback state — so a change here can only ever affect
// what is on screen, never what happens in the game.

function pixelReplayListHtml(history, getTeamByIdFn) {
  if (history.length === 0) {
    return '<div class="empty-state">No game to watch. Use "Watch Next Game" in the sim dock.</div>';
  }
  return '<div class="panel"><div class="panel-header">Recently Watched</div><div class="panel-body">' +
    '<table class="data-table"><tbody>' + history.map(function (s, i) {
      const h = getTeamByIdFn(s.homeTeamId), a = getTeamByIdFn(s.awayTeamId);
      return '<tr><td class="col-name">' + escapeHtml(h.id) + ' ' + s.homeScore +
        ' — ' + escapeHtml(a.id) + ' ' + s.awayScore + '</td>' +
        '<td>' + (s.isPlayoff ? '<span class="pill pill-gold">Playoffs</span>' : '') + '</td>' +
        '<td><button class="pixel-replay-btn" data-idx="' + i + '">Replay</button></td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

function pixelShellHtml(homeTeam, awayTeam, stageW, stageH, speeds) {
  return '<div class="pixel-game">' +
      // The real scoreboard is drawn inside the canvas; this copy stays in
      // the DOM (visually hidden) so screen readers still get the score.
      '<div class="pixel-scoreboard pixel-sr-only">' +
        '<span class="pixel-score-team" style="border-color:' + homeTeam.colors.primary + '">' + escapeHtml(homeTeam.id) + ' <span id="pixel-score-home">0</span></span>' +
        '<span class="pixel-clock"><span id="pixel-quarter">Q1</span> <span id="pixel-clock">12:00</span></span>' +
        '<span class="pixel-score-team" style="border-color:' + awayTeam.colors.primary + '">' + escapeHtml(awayTeam.id) + ' <span id="pixel-score-away">0</span></span>' +
      '</div>' +
      // The nudge card and the substitution panel are overlays ON the court,
      // not blocks appended under it. Appended, they landed below
      // #view-content's scroll fold: clicking "Subs" rendered a correct panel
      // that the user could not see and had to go looking for, which is the
      // exact failure scripts/ui-smoke.js was written after. As overlays they
      // are always where the user is already looking, and they cost the page
      // no vertical space when hidden.
      '<div class="pixel-stage-wrap">' +
        '<div class="pixel-canvas-wrap"><canvas id="pixel-canvas" width="' + stageW + '" height="' + stageH + '"></canvas></div>' +
        '<div class="pixel-nudge-slot" id="pixel-nudge-slot"></div>' +
        '<div class="pixel-subpanel" id="pixel-subpanel" hidden></div>' +
        // Leaving a live game finishes it, which is not obvious and cannot be
        // undone — so it asks first. An in-view overlay rather than a native
        // confirm(): ui/commissioner.js records why this codebase avoids
        // those (invisible to browser automation, so neither the smoke suite
        // nor any verification pass could see it).
        '<div class="pixel-confirm" id="pixel-leave-confirm" hidden>' +
          '<div class="pixel-confirm-box">' +
            '<div class="pixel-confirm-title">Leave this game?</div>' +
            '<div class="pixel-confirm-text">Your assistant coach will simulate the rest of it. The final score counts, and you cannot come back to coach it.</div>' +
            '<div class="pixel-confirm-actions">' +
              '<button id="pixel-leave-stay">Keep watching</button>' +
              '<button id="pixel-leave-go">Leave &amp; sim the rest</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Controls sit directly under the court, ABOVE the ticker, info strip
      // and commentary feed. Last in the stack they were pushed past
      // #view-content's scroll fold on an ordinary window — present, correct,
      // and unclickable without scrolling. If anything has to fall below the
      // fold it should be the read-only feed, not the buttons.
      '<div class="pixel-controls">' +
        '<button id="pixel-play-pause">Pause</button>' +
        speeds.map(function (s) {
          return '<button class="pixel-speed' + (s === 1 ? ' active' : '') + '" data-speed="' + s + '">' + s + '×</button>';
        }).join('') +
        '<button id="pixel-timeout">Timeout</button>' +
        '<button id="pixel-subs">Subs</button>' +
        '<button id="pixel-skip">Skip to Final</button>' +
        '<button id="pixel-replay">Replay</button>' +
        '<button id="pixel-mute">Sound: On</button>' +
        '<button id="pixel-exit">Exit</button>' +
      '</div>' +
      '<div class="pixel-ticker" id="pixel-ticker">&nbsp;</div>' +
      '<div class="pixel-infostrip" id="pixel-infostrip"></div>' +
      '<div class="pixel-commentary" id="pixel-commentary"></div>' +
    '</div>';
}

// `check` is the skillCheck that produced this play, and it is present ONLY on
// impact moments — posters, ankle breakers and blocks, which
// validate-impactMoments gates to 2-7 a game. Ordinary possessions pass null on
// purpose: at ~91 possessions a side, a breakdown on every line would stop being
// read inside a quarter. The box score is where you audit every play
// (ui/schedule.js's playByPlayHtml); this is where the game shouts.
function pixelPushCommentary(feedEl, text, check) {
  const line = document.createElement('div');
  line.className = 'pixel-commentary-line';
  line.textContent = text;
  if (check) {
    const detail = document.createElement('div');
    detail.className = 'pixel-commentary-check';
    const parts = [];
    if (check.attack) parts.push(check.attack.label + ' ' + Math.round(check.attack.value));
    if (check.defend) parts.push('vs ' + check.defend.label + ' ' + Math.round(check.defend.value));
    (check.modifiers || []).forEach(function (m) {
      // Same 0.05pp floor the box-score breakdown uses: a +0.0001 synergy term
      // printing as "+0.0%" reads as a bug rather than as a small number.
      if (Math.abs(m.value) < 0.0005) return;
      parts.push(m.label + ' ' + (m.value >= 0 ? '+' : '−') + (Math.abs(m.value) * 100).toFixed(1) + '%');
    });
    parts.push((check.probability * 100).toFixed(0) + '% → ' + (check.roll * 100).toFixed(0) + '%');
    detail.textContent = parts.join('  ·  ');
    line.appendChild(detail);
  }
  feedEl.insertBefore(line, feedEl.firstChild);
  while (feedEl.children.length > 6) feedEl.removeChild(feedEl.lastChild);
}

function pixelRenderInfoStrip(stripEl, snap, playerById, teamColorFor) {
  const leadHtml = snap.leaders.map(function (l) {
    const p = playerById[l.id];
    return '<span class="pixel-leader"><i style="background:' + teamColorFor(l.team) + '"></i>' +
      escapeHtml(p ? p.name : l.id) + ' <b>' + l.pts + '</b></span>';
  }).join('');
  const troubleHtml = snap.foulTrouble.map(function (f) {
    const p = playerById[f.id];
    return '<span class="pixel-foul' + (f.fouls >= 6 ? ' is-out' : '') + '">' +
      escapeHtml(p ? p.name : f.id) + ' ' + f.fouls + (f.fouls >= 6 ? ' — FOULED OUT' : ' fouls') + '</span>';
  }).join('');
  // Both labels are conditional. Nobody has scored until the first basket
  // drops, so an unconditional "Leaders" left the label stranded over nothing
  // for the opening possessions of every game — which is exactly when a viewer
  // is looking at this strip. Foul trouble was already guarded this way.
  stripEl.innerHTML =
    (leadHtml ? '<span class="pixel-strip-label">Leaders</span>' + leadHtml : '') +
    (troubleHtml ? '<span class="pixel-strip-label">Foul trouble</span>' + troubleHtml : '');
}

function pixelRenderFinalCard(stripEl, d) {
  const homeWon = d.homeScore > d.awayScore;
  stripEl.innerHTML =
    '<div class="pixel-final">' +
      '<div class="pixel-final-head">' + escapeHtml(d.homeTeam.name) + ' ' + d.homeScore +
        ' — ' + escapeHtml(d.awayTeam.name) + ' ' + d.awayScore +
        ' <span class="pill ' + (homeWon ? 'pill-win' : 'pill-loss') + '">' +
        escapeHtml((homeWon ? d.homeTeam : d.awayTeam).id) + ' win</span></div>' +
      '<table class="data-table pixel-linescore"><thead><tr><th></th>' +
        d.lineScore.map(function (r) { return '<th class="num">' + (r.quarter <= 4 ? 'Q' + r.quarter : 'OT' + (r.quarter - 4)) + '</th>'; }).join('') +
        '<th class="num">F</th></tr></thead><tbody>' +
        '<tr><td class="col-name">' + escapeHtml(d.homeTeam.id) + '</td>' +
          d.lineScore.map(function (r) { return '<td class="num">' + r.home + '</td>'; }).join('') +
          '<td class="num"><b>' + d.homeScore + '</b></td></tr>' +
        '<tr><td class="col-name">' + escapeHtml(d.awayTeam.id) + '</td>' +
          d.lineScore.map(function (r) { return '<td class="num">' + r.away + '</td>'; }).join('') +
          '<td class="num"><b>' + d.awayScore + '</b></td></tr>' +
      '</tbody></table>' +
      '<div class="pixel-final-top">' + d.topScorers.map(function (t) {
        const p = d.playerById[t.id];
        return '<span class="pixel-leader">' + escapeHtml(p ? p.name : t.id) + ' <b>' + t.pts + '</b></span>';
      }).join('') + '</div>' +
    '</div>';
}

// The substitution panel. Two columns: who is on the floor, and who is
// available. Click a player on the floor, then a player on the bench, and the
// swap is queued. Minutes and fouls are shown because those are the only two
// numbers that actually drive the decision.
function pixelRenderSubPanel(panelEl, data) {
  function row(p, side) {
    const line = data.lineFor(p.id) || {};
    const mins = Math.round((line.secondsPlayed || 0) / 60);
    const selected = side === 'out' && p.id === data.selectedOutId;
    const fouledOut = (line.fouls || 0) >= 6;
    return '<button class="pixel-sub-' + side + (selected ? ' is-selected' : '') + '"' +
      (fouledOut ? ' disabled title="Fouled out"' : '') +
      ' data-pid="' + escapeHtml(p.id) + '">' +
      '<span class="pixel-sub-name">' + escapeHtml(p.name) + '</span>' +
      '<span class="pixel-sub-stat">' + mins + '′ · ' + (line.points || 0) + 'p · ' +
        (line.fouls || 0) + 'f</span>' +
      '</button>';
  }
  // The close button belongs to the PANEL, not just to the Subs toggle in the
  // control bar. The panel is an overlay and can be opened by a nudge without
  // the user ever touching that toggle — and the control bar can sit below
  // #view-content's scroll fold, which left the panel open with its only exit
  // off-screen. An overlay has to be closable from itself.
  panelEl.innerHTML =
    '<button id="pixel-sub-close" class="pixel-sub-x" title="Close" aria-label="Close substitutions">×</button>' +
    '<div class="pixel-sub-col"><div class="pixel-sub-head">On the floor</div>' +
      data.onCourt.map(function (p) { return row(p, 'out'); }).join('') + '</div>' +
    '<div class="pixel-sub-col"><div class="pixel-sub-head">' +
      (data.selectedOutId ? 'Bring in for the selected player' : 'Bench') + '</div>' +
      data.bench.map(function (p) { return row(p, 'in'); }).join('') + '</div>';
}

// A nudge is a suggestion, never a prompt: it renders over the court and
// playback keeps running behind it.
//
// It carries an explicit dismiss (×) as well as expiring on its own. The
// original design deliberately had no dismiss — "ignoring it IS dismissing
// it" — but that reasoning only holds while the thing reliably expires, and
// expiry runs on the PLAYBACK clock, which stops dead when the user pauses.
// Pausing to read a nudge is the single most likely thing to do with one, and
// it left the card stuck on screen with no way to get rid of it. Dismissing
// is treated exactly like ignoring, so it adds control without adding
// obligation.
function pixelRenderNudge(slotEl, nudge) {
  if (!nudge) { slotEl.innerHTML = ''; return; }
  slotEl.innerHTML =
    '<div class="pixel-nudge pixel-nudge-' + escapeHtml(nudge.kind) + '">' +
      '<span class="pixel-nudge-text">' + escapeHtml(nudge.text) + '</span>' +
      '<button id="pixel-nudge-action">' + escapeHtml(nudge.actionLabel) + '</button>' +
      '<button id="pixel-nudge-dismiss" class="pixel-nudge-x" title="Dismiss" aria-label="Dismiss">×</button>' +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pixelReplayListHtml: pixelReplayListHtml,
    pixelRenderSubPanel: pixelRenderSubPanel,
    pixelRenderNudge: pixelRenderNudge,
    pixelShellHtml: pixelShellHtml,
    pixelPushCommentary: pixelPushCommentary,
    pixelRenderInfoStrip: pixelRenderInfoStrip,
    pixelRenderFinalCard: pixelRenderFinalCard
  };
}
