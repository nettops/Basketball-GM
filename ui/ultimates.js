// The ultimate reference. Every ultimate in the game, what it actually does,
// and who in your league holds it.
//
// EVERYTHING IS READ FROM THE TAXONOMY, exactly like ui/badges.js. Nothing here
// restates an ultimate's effect in its own words: the name, the sentence, the
// dials and the holders all come from ultimates.js, so an ultimate that is
// retuned updates this page for free and one added without a description fails
// scripts/validate-ultimates.js rather than rendering a blank row.

const ULTIMATE_KIND_BLURB = {
  solo: 'One man takes the game over.',
  team: 'All five on the floor lift together. Deliberately smaller per player than a solo ultimate, because it is multiplied by five.'
};

// What each dial does, in the player's words. The reference reads these rather
// than printing raw dial names, and an unlabelled dial shows as nothing rather
// than as jargon.
const DIAL_LABELS = {
  shotShare: 'takes far more of his team’s shots',
  shotCeiling: null,          // mechanical companion to shotShare; not worth a line
  zoneBias: null,             // covered by the make lines below
  makeThree: 'threes drop more often',
  makeMid: 'mid-range drops more often',
  makeInside: 'shots at the rim drop more often',
  makeFt: 'makes more free throws',
  turnover: 'stops turning it over',
  block: 'blocks more shots',
  reboundShare: 'grabs far more rebounds',
  foulRate: 'draws fouls constantly',
  energyDrain: 'stops getting tired',
  matchupDrain: 'wears his man down',
  teamMake: 'every team-mate shoots better',
  teamTurnover: 'the team stops turning it over',
  oppMake: 'the other team stops making shots',
  oppTurnover: 'the other team coughs the ball up'
};

// Who holds what, computed live off the league rather than authored — the same
// reason ui/badges.js does it: an ultimate nobody holds is worth seeing as such,
// and that exact case was a real bug during development.
function ultimateHoldings() {
  const held = {};
  PLAYERS_2026.forEach(function (p) {
    if (!hasUltimate(p)) return;
    const u = ultimateFor(p);
    const entry = held[u.key] || (held[u.key] = { total: 0, examples: [] });
    entry.total += 1;
    if (entry.examples.length < 3) entry.examples.push({ name: p.name, overall: p.overall });
  });
  return held;
}

// This season's takeovers per ultimate, so the page shows what actually
// happened and not just who could.
function takeoverCounts() {
  const counts = {};
  const rows = (typeof LEAGUE_HISTORY !== 'undefined' && LEAGUE_HISTORY.takeovers) || [];
  rows.forEach(function (r) { counts[r.ultimateKey] = (counts[r.ultimateKey] || 0) + 1; });
  return counts;
}

function ultimateEffectHtml(key) {
  const eff = takeoverEffect(key, 1);
  const lines = Object.keys(eff)
    .map(function (dial) { return DIAL_LABELS[dial]; })
    .filter(function (label) { return !!label; });
  if (!lines.length) return '';
  return '<ul class="ult-ref-effects"><li>' + lines.map(escapeHtml).join('</li><li>') + '</li></ul>';
}

function ultimateHoldersHtml(entry) {
  if (!entry || !entry.total) {
    return '<span class="ult-ref-rarity ult-ref-rarity-none">Held by nobody in this league</span>';
  }
  const names = entry.examples
    .map(function (e) { return escapeHtml(e.name) + ' (' + e.overall + ')'; })
    .join(', ');
  // Only the first three are collected, so "5 holders" over three names reads
  // as a complete list that is missing two. Say what is not shown.
  const hidden = entry.total - entry.examples.length;
  return '<span class="ult-ref-rarity">' + entry.total +
    (entry.total === 1 ? ' holder' : ' holders') + '</span>' +
    '<span class="ult-ref-examples">' + names +
    (hidden > 0 ? ' and ' + hidden + ' more' : '') + '</span>';
}

function renderUltimatesReference(container) {
  const held = ultimateHoldings();
  const fired = takeoverCounts();
  const gate = currentGate();

  let html = '<div class="view-header"><h2>Ultimates</h2>' +
    '<span class="view-sub">A star who is playing well builds a meter. When it fills he takes the game over ' +
    'for about a quarter — or for whatever is left of the game, if there is less than that. ' +
    'Only the league’s best ' + ULTIMATE_TUNING.gateCount +
    ' players have one — currently everyone at ' + gate + ' overall and above.</span></div>';

  ['solo', 'team'].forEach(function (kind) {
    const group = ULTIMATE_TAXONOMY.filter(function (u) { return u.kind === kind; });
    html += '<div class="panel"><h3>' + (kind === 'solo' ? 'Solo' : 'Team') + '</h3>' +
      '<p class="kpi-sub">' + escapeHtml(ULTIMATE_KIND_BLURB[kind]) + '</p>';
    group.forEach(function (u) {
      html += '<div class="ult-ref-row ' +
        (u.side === 'defense' ? 'ult-ref-defense' : 'ult-ref-offense') + '">' +
        '<div class="ult-ref-head"><strong>' + escapeHtml(u.name) + '</strong>' +
        '<span class="pill pill-mute">' + (u.side === 'defense' ? 'Defensive' : 'Offensive') + '</span></div>' +
        '<div class="ult-ref-desc">' + escapeHtml(ULTIMATE_DESCRIPTIONS[u.key]) + '</div>' +
        ultimateEffectHtml(u.key) +
        '<div class="ult-ref-foot">' + ultimateHoldersHtml(held[u.key]) +
        (fired[u.key] ? '<span class="ult-ref-fired">' + fired[u.key] + ' this save</span>' : '') +
        '</div></div>';
    });
    html += '</div>';
  });

  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ULTIMATE_KIND_BLURB: ULTIMATE_KIND_BLURB,
    DIAL_LABELS: DIAL_LABELS,
    ultimateHoldings: ultimateHoldings,
    ultimateEffectHtml: ultimateEffectHtml,
    renderUltimatesReference: renderUltimatesReference
  };
}
