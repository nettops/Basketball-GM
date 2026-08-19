// Free agency's running outcome log.
//
// It used to be `const signingLog = []` inside renderFreeAgency, which meant it
// was destroyed every time the view re-rendered or the user navigated away —
// so the one line telling you a player had REFUSED you was gone the moment you
// looked anywhere else. On GameState it survives the offseason it belongs to,
// and seasonRollover clears it with everything else.
//
// Entries carry a kind, because "we re-signed him" and "he walked" are not the
// same news and must not look the same. A playtester lost an 88 OVR player to
// a refusal, saw no error, and only found out by inspecting game state.
function faLog(kind, text) {
  if (!Array.isArray(GameState.freeAgencyLog)) GameState.freeAgencyLog = [];
  GameState.freeAgencyLog.push({ kind: kind, text: text });
  while (GameState.freeAgencyLog.length > 40) GameState.freeAgencyLog.shift();
}

function renderFreeAgency(container, userTeamId) {
  // Kept as a name so the bidding panel's existing contract is unchanged; it
  // pushes plain strings, which faLogRender treats as ordinary signings.
  const signingLog = [];

  function draw() {
    if (GameState.playMode === 'spectator') {
      container.innerHTML = '<div class="view-header"><h2>Free Agency</h2></div>' +
        '<div class="empty-state">Spectator mode — teams manage themselves.</div>';
      return;
    }

    const pool = getFreeAgents().slice().sort(function (a, b) { return b.overall - a.overall; });
    // Your own expiring players, held back from the market so you get first
    // refusal. Every other team already made this call for itself during the
    // offseason; these are the ones nobody decided for you.
    const expiring = getTeamRoster(userTeamId)
      .filter(function (p) { return p.resignRights; })
      .sort(function (a, b) { return b.overall - a.overall; });

    let html = '<div class="view-header"><h2>Free Agency</h2><span class="view-sub">' + pool.length + ' available</span></div>';

    // AT THE TOP, not the bottom. This panel is the only place the game tells
    // you a re-signing was refused, and it used to sit under the whole free
    // agent pool where a player who had just clicked a button at the top of
    // the page would never see it.
    const entries = (GameState.freeAgencyLog || []).concat(
      signingLog.map(function (t) { return { kind: 'signed', text: t }; }));
    if (entries.length) {
      html += '<div class="panel"><div class="panel-header">What Just Happened</div>' +
        '<ul class="stack-list" id="signing-log">' +
        entries.slice(-15).reverse().map(function (e) {
          // The text is already escaped by its callers — these strings are
          // built with escapeHtml around every name. ui-safety: not-markup
          return '<li class="fa-log fa-log-' + (e.kind === 'lost' ? 'lost' : 'signed') + '">' +
            (e.kind === 'lost' ? '<span class="fa-log-flag">LOST</span> ' : '') + e.text + '</li>';
        }).join('') + '</ul></div>';
    }

    if (expiring.length) {
      html += '<div class="panel"><div class="panel-header">Your Expiring Contracts — ' +
        expiring.length + ' to decide</div>' +
        '<div class="kpi-sub" style="padding:0 14px 8px;">First refusal is yours. Anyone you do not re-sign walks when the market opens. ' +
        'Averages are from the season just finished.</div>' +
        '<table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
        '<th class="num">OVR</th><th class="num">GP</th><th class="num">PPG</th><th class="num">RPG</th>' +
        '<th class="num">APG</th><th class="num">Asking</th><th class="num">Action</th></tr></thead><tbody>';
      expiring.forEach(function (p) {
        // seasonStats still holds the season that just ended: it is wiped by
        // generateNewSeason (seasonTransition.js), which runs AFTER free
        // agency in the rollover. Deciding whether to pay a player without
        // seeing what he did last year was the gap here.
        const avg = getPlayerAverages(p);
        const gp = (p.seasonStats && p.seasonStats.gamesPlayed) || 0;
        // An injured or newly arrived player can reach this table with no
        // games at all. getPlayerAverages returns zeros for him, and printing
        // "0.0" would read as "played and was useless" rather than "did not
        // play" — a meaningful difference when you are deciding on a contract.
        const stat = function (v) { return gp ? v.toFixed(1) : '&mdash;'; };
        const sheet = p.resignRights.offerSheet;
        const sheetTeam = sheet ? getTeamById(sheet.teamId) : null;
        const sheetTeamName = sheetTeam ? sheetTeam.name : 'a rival';
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="num">' + (gp || '&mdash;') + '</td>' +
          '<td class="num">' + stat(avg.ppg) + '</td>' +
          '<td class="num">' + stat(avg.rpg) + '</td>' +
          '<td class="num">' + stat(avg.apg) + '</td>' +
          // A restricted player with a sheet against him is a different
          // decision, and has to READ as one: the terms are the rival's, the
          // price is above his asking price, and declining loses him to a named
          // club rather than to "the market".
          (sheet
            ? '<td class="num"><span class="stat-down">$' + sheet.salary.toLocaleString() + ' &times; ' +
              sheet.yearsRemaining + 'y</span><div class="kpi-sub">offer sheet &middot; ' +
              escapeHtml(sheetTeamName) + '</div></td>' +
              '<td class="actions"><button data-match-id="' + p.id + '">Match</button> ' +
              '<button data-declinesheet-id="' + p.id + '" class="btn-ghost">Let Him Go</button></td></tr>'
            : '<td class="num">$' + p.resignRights.salary.toLocaleString() + ' &times; ' +
              p.resignRights.yearsRemaining + 'y</td>' +
              '<td class="actions"><button data-resign-id="' + p.id + '">Re-Sign</button> ' +
              '<button data-letgo-id="' + p.id + '" class="btn-ghost">Let Go</button></td></tr>');
      });
      html += '</tbody></table></div>';
    }

    // Raiding. The rest of the league's restricted free agents are parked
    // rather than settled, precisely so this panel can exist — a GM can put a
    // price on somebody else's young player and make that club decide.
    const raidable = openRestrictedFreeAgents(userTeamId);
    if (raidable.length) {
      html += '<div class="panel"><div class="panel-header">Restricted Free Agents Around the League</div>' +
        '<div class="panel-body"><p class="kpi-sub">Write an offer sheet and his club must match it or lose him. ' +
        'He keeps whichever sheet he prefers, so a bigger number is not always enough.</p>' +
        '<table class="data-table"><thead><tr><th>Player</th><th>Team</th><th class="num">Age</th>' +
        '<th class="num">OVR</th><th class="num">Standing Sheet</th><th>Your Offer</th><th></th></tr></thead><tbody>';
      raidable.forEach(function (p) {
        const club = getTeamById(p.teamId);
        const standing = p.resignRights.offerSheet;
        const standingClub = standing ? getTeamById(standing.teamId) : null;
        const mine = standing && standing.teamId === userTeamId;
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td>' + escapeHtml(club ? club.name : '&mdash;') + '</td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="num">' + (standing ? '$' + standing.salary.toLocaleString() + ' &times; ' +
            standing.yearsRemaining + 'y<div class="kpi-sub">' +
            (mine ? '<span class="stat-up">yours</span>' : escapeHtml(standingClub ? standingClub.name : 'a rival')) +
            '</div>' : '&mdash;') + '</td>' +
          '<td><input type="number" class="sheet-salary" data-sheet-id="' + p.id + '" placeholder="salary" ' +
            'value="' + Math.round((standing ? standing.salary : 2000000) * 1.1) + '" step="500000"> ' +
            '<input type="number" class="sheet-years" data-sheet-years="' + p.id + '" value="' +
            (standing ? standing.yearsRemaining : 2) + '" min="1" max="5"></td>' +
          '<td class="actions"><button data-writesheet-id="' + p.id + '">Offer Sheet</button></td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // Nothing to resolve when the pool is empty. Disabled rather than removed
    // so the screen still says what it does, matching the dock's Watch/Undo.
    html += '<div class="toolbar"><button id="resolve-remaining-btn" class="btn-ghost"' +
      (pool.length === 0 ? ' disabled' : '') + '>Resolve Remaining Free Agents</button></div>';
    if (pool.length === 0) {
      // A header row over an empty tbody reads as a table that failed to load.
      // Spectator mode above already uses empty-state for exactly this reason.
      html += '<div class="empty-state">No free agents available — players reach free agency when their contracts expire in the offseason.</div>';
    } else {
      html += '<div class="panel"><table class="data-table"><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>' +
        '<th class="num">OVR</th><th class="num">Action</th></tr></thead><tbody>';
      pool.forEach(function (p) {
        html += '<tr><td class="col-name">' + escapeHtml(p.name) + '</td>' +
          '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
          '<td class="num">' + p.age + '</td>' +
          '<td class="num"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></td>' +
          '<td class="actions"><button data-offer-id="' + p.id + '">Make Offer</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    // No standing container for the bidding panel any more: it is injected as a
    // row directly beneath the player being bid on (see openBidUnder). It used
    // to live here, below the whole pool, which meant clicking Make Offer on
    // someone near the top scrolled the panel off-screen entirely — you were
    // bidding on a player you could no longer see.
    // Same stranded-header problem: this panel titled itself before there was
    // anything to list, so a mid-season visit showed "Recent Signings" over
    // blank space. It appears once there is a signing to report.

    container.innerHTML = html;

    document.getElementById('resolve-remaining-btn').addEventListener('click', function () {
      const rng = GameState.rng;
      const results = runFreeAgencySilently(rng);
      results.forEach(function (r) {
        // signingLog entries are rendered as raw <li> markup above, so the
        // player name needs escaping here just like the team name — and like
        // the two sibling pushes in renderBiddingPanel already do.
        signingLog.push(escapeHtml(getTeamById(r.teamId).name) + ' signed ' + escapeHtml(getPlayerById(r.playerId).name) + ' ($' + r.salary.toLocaleString() + ')');
      });
      draw();
    });

    // Opens the bidding panel in a row spliced in immediately below the player
    // it belongs to, so the name, rating and asking price you are weighing stay
    // on screen while you decide.
    function openBidUnder(row, playerId) {
      // One bid at a time. Without this, working down the list left a trail of
      // open panels, each holding its own independent bidding state.
      const open = container.querySelector('.bid-row');
      if (open) open.remove();

      const host = document.createElement('tr');
      host.className = 'bid-row';
      const cell = document.createElement('td');
      // Read off the row rather than hard-coded: this table has already gained
      // and lost columns, and a stale number would silently misalign the panel.
      cell.colSpan = row.children.length;
      host.appendChild(cell);
      row.after(host);
      renderBiddingPanel(cell, playerId, userTeamId, draw, signingLog);
    }

    container.querySelectorAll('button[data-offer-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBidUnder(btn.closest('tr'), btn.getAttribute('data-offer-id'));
      });
    });

    container.querySelectorAll('button[data-resign-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-resign-id'));
        const team = getTeamById(userTeamId);
        const ask = { salary: player.resignRights.salary, yearsRemaining: player.resignRights.yearsRemaining };
        // He can still say no — that is the point of a window rather than a
        // button. Rights are spent either way, so a refusal sends him to the
        // market exactly as letting him go would.
        const verdict = evaluateResign(player, team, ask, GameState.rng);
        if (verdict.accepted) {
          delete player.resignRights;
          applyResign(player, team, ask);
          faLog('signed', escapeHtml(team.name) + ' re-signed ' + escapeHtml(player.name) +
            ' ($' + ask.salary.toLocaleString() + '/yr, ' + ask.yearsRemaining + ' yr' +
            (ask.yearsRemaining === 1 ? '' : 's') + ')');
        } else {
          delete player.resignRights;
          player.teamId = null;
          faLog('lost', escapeHtml(player.name) + ' turned down your offer. He is a free agent now — ' +
            'you can still bid for him below, but so can everyone else.');
        }
        draw();
      });
    });

    // Matching is not a negotiation — the player has already agreed to these
    // terms by signing the sheet, so unlike Re-Sign there is no chance of him
    // saying no. That asymmetry is the mechanism, not an oversight.
    container.querySelectorAll('button[data-match-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-match-id'));
        const team = getTeamById(userTeamId);
        const sheet = player.resignRights.offerSheet;
        delete player.resignRights;
        applyResign(player, team, sheet);
        faLog('signed', escapeHtml(team.name) + ' matched the offer sheet for ' + escapeHtml(player.name) +
          ' ($' + sheet.salary.toLocaleString() + '/yr, ' + sheet.yearsRemaining + ' yr' +
          (sheet.yearsRemaining === 1 ? '' : 's') + ')');
        draw();
      });
    });

    // Declining hands him to the club that wrote the sheet, NOT to free
    // agency. He never reaches the market, which is what makes an offer sheet
    // different from letting a contract run out.
    container.querySelectorAll('button[data-declinesheet-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-declinesheet-id'));
        const sheet = player.resignRights.offerSheet;
        const rival = getTeamById(sheet.teamId);
        delete player.resignRights;
        signPlayer(player, sheet);
        faLog('lost', escapeHtml(player.name) + ' signs with ' + escapeHtml(rival ? rival.name : 'a rival') +
          ' on the offer sheet you declined to match');
        draw();
      });
    });

    container.querySelectorAll('button[data-writesheet-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-writesheet-id');
        const player = getPlayerById(id);
        const salary = Number(container.querySelector('input[data-sheet-id="' + id + '"]').value);
        const years = Number(container.querySelector('input[data-sheet-years="' + id + '"]').value);
        const res = writeOfferSheet(player, getTeamById(userTeamId), salary, years);
        if (!res.ok) {
          // The refusal is the interesting part — no cap space, or he simply
          // likes where he is being offered better — so it is shown rather
          // than swallowed.
          signingLog.push('Offer sheet for ' + escapeHtml(player.name) + ' rejected: ' + escapeHtml(res.reason));
          draw();
          return;
        }
        pushUndoSnapshot(GameState);
        const club = getTeamById(player.teamId);
        signingLog.push('Offer sheet written for ' + escapeHtml(player.name) + ' ($' +
          salary.toLocaleString() + '/yr, ' + years + ' yr' + (years === 1 ? '' : 's') + ') — ' +
          escapeHtml(club ? club.name : 'his club') + ' must match it or lose him');
        draw();
      });
    });

    container.querySelectorAll('button[data-letgo-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushUndoSnapshot(GameState);
        const player = getPlayerById(btn.getAttribute('data-letgo-id'));
        delete player.resignRights;
        player.teamId = null;
        signingLog.push(escapeHtml(player.name) + ' was let go and enters free agency');
        draw();
      });
    });
  }

  draw();
}

function renderBiddingPanel(container, playerId, userTeamId, redrawParent, signingLog) {
  const player = getPlayerById(playerId);
  const state = startBidding(playerId, userTeamId, GameState.rng);

  function draw(lastResult) {
    // The same function the model enforces with, so the ceiling shown here and
    // the ceiling applied at signing cannot drift apart.
    const limit = offerLimit(getTeamById(userTeamId));
    const canBid = !limit.reason;

    let html = '<div class="bid-panel"><h3>Bidding for ' + escapeHtml(player.name) + '</h3>';
    html += '<div class="kpi-sub">Competing offers: ' + state.aiOffers.length + '</div>';
    html += limit.capDisabled
      ? '<div class="kpi-sub">Salary cap disabled — offer anything.</div>'
      : '<div class="kpi-sub">Cap space: ' + capSpaceHtml(limit.capSpace) + '</div>';
    if (limit.reason) {
      html += '<p><span class="pill pill-loss">Cannot sign</span> ' + escapeHtml(limit.reason) + '</p>';
    }
    if (lastResult && lastResult.offerAccepted === false) {
      html += '<p><span class="pill pill-loss">Offer rejected</span> ' +
        escapeHtml(lastResult.rejectedReason) + '</p>';
    } else if (lastResult) {
      html += lastResult.userWinning
        ? '<p><span class="pill pill-win">Leading</span> Your offer is currently winning — you can sign him.</p>'
        : '<p><span class="pill pill-loss">Behind</span> A competing offer is ahead' +
          (lastResult.bestAIOffer ? ' ($' + lastResult.bestAIOffer.salary.toLocaleString() + ')' : '') +
          '. Raise your offer — he will not sign while he prefers someone else.</p>';
    }
    const startingBid = canBid ? Math.min(5000000, limit.max) : 0;
    html += '<div class="field-row"><label style="margin:0;">Salary $</label><input type="number" id="bid-salary" value="' +
      startingBid + '" step="100000" min="' + limit.min + '"' +
      (limit.capDisabled ? '' : ' max="' + limit.max + '"') +
      (canBid ? '' : ' disabled') + ' style="width:140px;"></div>';
    // Bounds read from the model rather than typed in here, so the box and the
    // rule it is checked against cannot drift apart — the salary box beside it
    // was hardened while this one silently accepted 99.
    html += '<div class="field-row"><label style="margin:0;">Years</label><input type="number" id="bid-years" value="2" min="1" max="' +
      MAX_CONTRACT_YEARS + '" step="1"' + (canBid ? '' : ' disabled') + ' style="width:70px;"></div>';
    // Only a WINNING bid can be closed. The button used to be live the moment
    // any legal offer had been submitted, which is how a superstar could be had
    // at the league minimum while the panel next to the button read "Behind".
    const canSign = canBid && !!(lastResult && lastResult.offerAccepted && lastResult.userWinning);
    html += '<div class="toolbar" style="margin:14px 0 0;">' +
      '<button id="submit-bid-btn"' + (canBid ? '' : ' disabled') + '>Submit Offer</button>' +
      '<button id="accept-bid-btn" class="btn-primary"' + (canSign ? '' : ' disabled') + '>Sign Player</button>' +
      '<button id="withdraw-bid-btn" class="btn-ghost">Withdraw</button></div>';
    html += '</div>';
    container.innerHTML = html;

    document.getElementById('submit-bid-btn').addEventListener('click', function () {
      const salary = Number(document.getElementById('bid-salary').value);
      const years = Number(document.getElementById('bid-years').value);
      const result = evaluateBiddingRound(state, salary, years);
      draw(result);
    });
    document.getElementById('accept-bid-btn').addEventListener('click', function () {
      pushUndoSnapshot(GameState);
      const outcome = finalizeBidding(state, true);
      // finalizeBidding re-checks the cap and can hand the player to the best
      // rival bid instead, so say which happened rather than implying you got him.
      if (outcome.signed) {
        signingLog.push(escapeHtml(getTeamById(outcome.teamId).name) + ' signed ' + escapeHtml(player.name) +
          (outcome.teamId === userTeamId ? '' : ' (your offer no longer fit under the cap)'));
      }
      if (outcome.signed && GameState.automation.autoCap) autoEnforceRosterSize(getTeamById(userTeamId));
      container.innerHTML = '';
      redrawParent();
    });
    document.getElementById('withdraw-bid-btn').addEventListener('click', function () {
      pushUndoSnapshot(GameState);
      const outcome = finalizeBidding(state, false);
      if (outcome.signed) signingLog.push(escapeHtml(getTeamById(outcome.teamId).name) + ' signed ' + escapeHtml(player.name) + ' (you withdrew)');
      container.innerHTML = '';
      redrawParent();
    });
  }

  draw(null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderFreeAgency: renderFreeAgency, renderBiddingPanel: renderBiddingPanel };
}
