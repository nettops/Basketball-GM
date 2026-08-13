function renderMilestoneScene(container, sceneType, context) {
  let html = '';

  if (sceneType === 'all_star') {
    html = renderAllStarScene(context);
  } else if (sceneType === 'playoff') {
    html = renderPlayoffScene(context);
  } else if (sceneType === 'retirement') {
    html = renderRetirementScene(context);
  }

  container.innerHTML = html;
}

function renderAllStarScene(context) {
  const { playerName, season } = context;
  return `
    <div class="view-header"><h2>All-Star Selection - Season ${season}</h2></div>
    <div class="panel" style="text-align: center; padding: 40px;">
      <p style="font-size: 18px; margin: 20px 0;">This year's All-Star selections are in...</p>
      <h2 style="font-size: 36px; color: #FFD700; margin: 30px 0;">${escapeHtml(playerName)}</h2>
      <p>You've been selected as an All-Star!</p>
      <p>Your career just reached a new level.</p>
      <p style="margin-top: 30px;">
        <button class="btn-primary" onclick="dismissNarrativeScene()">Continue</button>
      </p>
    </div>
  `;
}

function renderPlayoffScene(context) {
  const { playerName, season, opponent, round } = context;
  return `
    <div class="view-header"><h2>Playoff ${round} - Season ${season}</h2></div>
    <div class="panel" style="padding: 30px;">
      <p style="font-size: 18px;">Your team faces ${escapeHtml(opponent)} in ${escapeHtml(round)}.</p>
      <p style="margin: 20px 0;">This is your chance to prove yourself on the biggest stage.</p>
      <p style="margin-top: 30px;">
        <button class="btn-primary" onclick="dismissNarrativeScene()">Continue</button>
      </p>
    </div>
  `;
}

function renderRetirementScene(context) {
  const { playerName, careerStats, championshipsWon, hallOfFameEligible } = context;
  return `
    <div class="view-header"><h2>Retirement Ceremony</h2></div>
    <div class="panel" style="text-align: center; padding: 40px;">
      <h2 style="font-size: 32px;">${escapeHtml(playerName)}</h2>
      <p style="font-size: 18px; margin: 20px 0;">A career comes to an end</p>

      <div style="margin: 30px 0; text-align: left; display: inline-block;">
        <p><strong>Seasons Played:</strong> ${careerStats.seasonsPlayed}</p>
        <p><strong>Career Points:</strong> ${careerStats.points}</p>
        <p><strong>Career Rebounds:</strong> ${careerStats.rebounds}</p>
        <p><strong>Career Assists:</strong> ${careerStats.assists}</p>
        <p><strong>Championships:</strong> ${championshipsWon}</p>
      </div>

      ${hallOfFameEligible ? '<p style="font-size: 20px; color: #FFD700; margin-top: 20px;">Hall of Fame Eligible</p>' : ''}

      <p style="margin-top: 40px;">
        <button class="btn-primary" onclick="renderView('legacy')">View Legacy & Start GM Career</button>
      </p>
    </div>
  `;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMilestoneScene };
}
