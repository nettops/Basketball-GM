// Pre-draft odds table: exact probabilities (see draftLotteryFormats.js) for
// every lottery-eligible team to land each drawn pick, under whichever
// format is active in Settings. Only meaningful once the regular season (and
// playoffs, since standings/elimination order feed the same math
// buildDraftOrder uses) is fully resolved and the lottery hasn't run yet.
function renderLotteryOddsPanel(bracket) {
  const playoffTeamIds = new Set(getPlayoffFinishOrder(bracket));
  const lotteryTeams = TEAMS.filter(function (t) { return !playoffTeamIds.has(t.id); });
  const sortedWorstFirst = lotteryTeams.slice().sort(function (a, b) { return a.record.wins - b.record.wins; });
  const formatKey = (GameState.settings && GameState.settings.lotteryFormat) || DEFAULT_LOTTERY_FORMAT;
  const format = getLotteryFormat(formatKey);

  if (format.numLotteryPicks === 0 || sortedWorstFirst.length === 0) return '';

  const probs = computeLotteryProbabilities(sortedWorstFirst, format);
  let html = '<div class="panel"><div class="panel-header">Draft Lottery Odds — ' + escapeHtml(format.label) + '</div>' +
    '<div class="panel-body"><p class="kpi-sub">' + escapeHtml(format.description) + '</p></div>' +
    '<table class="data-table"><thead><tr><th>Team</th><th class="num">Wins</th>';
  for (let i = 0; i < format.numLotteryPicks; i++) html += '<th class="num">Pick ' + (i + 1) + '</th>';
  html += '</tr></thead><tbody>';
  sortedWorstFirst.forEach(function (t) {
    html += '<tr><td class="col-name">' + teamLogoImgHtml(t.id, 18) + ' ' + escapeHtml(t.name) + '</td><td class="num">' + t.record.wins + '</td>';
    probs[t.id].forEach(function (p) { html += '<td class="num">' + (p * 100).toFixed(1) + '%</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderDraftResults(container, draftResults) {
  let html = '<div class="view-header"><h2>Draft Results</h2><span class="view-sub">' + draftResults.length + ' picks</span></div>';
  if (draftResults.length === 0) {
    // A bracket that EXISTS is not a bracket that FINISHED. This read
    // playoffBracket alone, so opening this screen mid-playoffs threw on
    // finals[0].winner -- and since the advance loop re-renders the current
    // view every step, that also killed Continue for the rest of the session.
    const oddsPanel = (playoffBracketIsComplete(GameState.playoffBracket) && !GameState.draftSession)
      ? renderLotteryOddsPanel(GameState.playoffBracket) : '';
    container.innerHTML = html + (oddsPanel || '<div class="empty-state">No draft has been completed yet.</div>');
    return;
  }
  html += '<div class="panel"><table class="data-table"><thead><tr><th></th><th class="num">Pick</th><th class="num">Rd</th>' +
    '<th>Team</th><th>Player</th><th>College</th><th>Pos</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>';
  draftResults.forEach(function (r) {
    const team = getTeamById(r.teamId);
    html += '<tr><td>' + playerSpriteHtml(r.prospect, team, 32) + '</td><td class="num">' + r.pickNumber + '</td><td class="num">' + r.round + '</td>' +
      '<td class="col-name">' + teamLogoImgHtml(team.id, 18) + ' ' + escapeHtml(team.name) + '</td>' +
      '<td class="col-name">' + escapeHtml(r.prospect.name) + '</td>' +
      '<td>' + (r.prospect.college || '—') + '</td>' +
      '<td><span class="pill pill-pos">' + r.prospect.position + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.overall) + '">' + r.prospect.overall + '</span></td>' +
      '<td class="num"><span class="rating-chip ' + ratingTier(r.prospect.potentialDisplay) + '">' + r.prospect.potentialDisplay + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderDraftResults: renderDraftResults, renderLotteryOddsPanel: renderLotteryOddsPanel };
}
