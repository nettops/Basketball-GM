// Bio line only — attributes/traits reuse ui/playerProfile.js's
// renderAttributesTab/renderTraitsTab as-is, since a prospect object already
// carries the same .attributes/.hiddenTraits/.hiddenPersonality shape those
// expect. renderTraitsTab does its own scouting-confidence lookup off
// GameState.scouting.targets[p.id], the same source this file's Scouted pill
// already reads, so the two stay in sync without passing confidence through.
function prospectBioLineHtml(p) {
  const feet = Math.floor(p.heightIn / 12);
  const inches = p.heightIn % 12;
  // Wingspan tolerates absence: the fixed real-2026 class predates it.
  const ws = p.wingspanIn ? ' · ' + Math.floor(p.wingspanIn / 12) + '\'' + (p.wingspanIn % 12) + '" ws' : '';
  return p.position + ' · Age ' + p.age + ' · ' + feet + '\'' + inches + '" · ' + p.weightLb + ' lb' + ws +
    (p.college ? ' · ' + escapeHtml(p.college) : '');
}

function prospectProfileHtml(p) {
  let html = '<div class="box-score-detail">';
  html += '<div class="view-header" style="display:flex;align-items:center;gap:16px;">' +
    playerSpriteHtml(p, null, 90) +
    '<div><h3>' + escapeHtml(p.name) + '</h3><span class="view-sub">' + prospectBioLineHtml(p) + '</span></div></div>';
  html += '<div class="panel"><div class="panel-body kpi-grid">' +
    '<div class="kpi-tile"><div class="kpi-label">Overall</div><div class="kpi-value"><span class="rating-chip ' + ratingTier(p.overall) + '">' + p.overall + '</span></div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Potential</div><div class="kpi-value"><span class="rating-chip ' + ratingTier(p.potentialDisplay) + '">' + p.potentialDisplay + '</span></div></div>' +
    (p.nbaComparison ? '<div class="kpi-tile"><div class="kpi-label">Draft Comparison</div><div class="kpi-value">' + escapeHtml(p.nbaComparison) + '</div></div>' : '') +
    '</div></div>';
  html += renderAttributesTab(p);
  html += renderTraitsTab(p);
  return html + '</div>';
}

function renderDraftPicker(container, session, userTeamId, onPick) {
  const pick = currentPick(session);
  const team = getTeamById(userTeamId);
  // Sorted by what the club BELIEVES, not by the truth. Sorting the board by
  // p.overall meant the best prospect left was always the top row, which told
  // you everything scouting was supposed to cost you something to learn.
  const scoutRangeFor = function (p) {
    const target = GameState.scouting.targets[p.id];
    return scoutedOverallRange(p, target ? target.confidence : 0);
  };
  const sorted = session.available.slice().sort(function (a, b) {
    return scoutedOverallSortKey(scoutRangeFor(b)) - scoutedOverallSortKey(scoutRangeFor(a));
  });

  let expandedProspectId = null;

  function draw() {
    let html = '<div class="view-header"><h2>' + teamLogoImgHtml(team.id, 26) + ' Round ' + pick.round + ', Pick ' + pick.pickNumber + '</h2>' +
      '<span class="view-sub">' + session.results.length + ' picks made · ' + session.available.length + ' prospects left · click a prospect to view their profile</span></div>';
    html += '<div class="panel"><table class="data-table"><thead><tr><th></th><th>Player</th><th>Pos</th><th class="num">Age</th>' +
      '<th class="num">OVR</th><th>Scouted</th><th class="num"></th></tr></thead><tbody>';
    sorted.forEach(function (p) {
      const target = GameState.scouting.targets[p.id];
      const confidence = target ? target.confidence : 0;
      const revealed = getRevealedView(p, confidence);
      const ovr = scoutedOverallRange(p, confidence);
      const scoutPill = revealed.level === 'exact'
        ? '<span class="pill pill-win">Fully scouted</span>'
        : (revealed.level === 'fuzzy' ? '<span class="pill pill-gold">Partial</span>' : '<span class="pill pill-mute">Unscouted</span>');
      const isExpanded = p.id === expandedProspectId;
      html += '<tr class="is-clickable schedule-row' + (isExpanded ? ' is-expanded' : '') + '" data-prospect-row-id="' + p.id + '" title="Click to view profile">' +
        '<td>' + playerSpriteHtml(p, null, 32) + '</td>' +
        '<td class="col-name">' + escapeHtml(p.name) + ' <span class="schedule-chevron">' + (isExpanded ? '▾' : '▸') + '</span></td>' +
        '<td><span class="pill pill-pos">' + p.position + '</span></td>' +
        '<td class="num">' + p.age + '</td>' +
        '<td class="num"><span class="rating-chip ' + ratingTier(scoutedOverallSortKey(ovr)) +
          (ovr.exact === null ? ' is-estimate' : '') + '">' + scoutedOverallLabel(ovr) + '</span></td>' +
        '<td>' + scoutPill + '</td>' +
        '<td class="actions"><button class="btn-primary" data-prospect-id="' + p.id + '">Draft</button></td></tr>';
      if (isExpanded) {
        html += '<tr class="schedule-detail-row"><td colspan="7">' + prospectProfileHtml(p) + '</td></tr>';
      }
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-prospect-row-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        const id = row.getAttribute('data-prospect-row-id');
        expandedProspectId = expandedProspectId === id ? null : id;
        draw();
      });
    });
    // Draft button lives inside the clickable row — stop the click from also
    // toggling the profile open/closed out from under the confirm-worthy action.
    container.querySelectorAll('button[data-prospect-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        onPick(btn.getAttribute('data-prospect-id'));
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftPicker: renderDraftPicker, prospectProfileHtml: prospectProfileHtml };
}
