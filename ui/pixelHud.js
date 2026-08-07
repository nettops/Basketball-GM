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
      '</div>' +
      '<div class="pixel-ticker" id="pixel-ticker">&nbsp;</div>' +
      '<div class="pixel-infostrip" id="pixel-infostrip"></div>' +
      '<div class="pixel-commentary" id="pixel-commentary"></div>' +
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
    '</div>';
}

function pixelPushCommentary(feedEl, text) {
  const line = document.createElement('div');
  line.className = 'pixel-commentary-line';
  line.textContent = text;
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
  stripEl.innerHTML = '<span class="pixel-strip-label">Leaders</span>' + leadHtml +
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
  panelEl.innerHTML =
    '<div class="pixel-sub-col"><div class="pixel-sub-head">On the floor</div>' +
      data.onCourt.map(function (p) { return row(p, 'out'); }).join('') + '</div>' +
    '<div class="pixel-sub-col"><div class="pixel-sub-head">' +
      (data.selectedOutId ? 'Bring in for the selected player' : 'Bench') + '</div>' +
      data.bench.map(function (p) { return row(p, 'in'); }).join('') + '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pixelReplayListHtml: pixelReplayListHtml,
    pixelRenderSubPanel: pixelRenderSubPanel,
    pixelShellHtml: pixelShellHtml,
    pixelPushCommentary: pixelPushCommentary,
    pixelRenderInfoStrip: pixelRenderInfoStrip,
    pixelRenderFinalCard: pixelRenderFinalCard
  };
}
