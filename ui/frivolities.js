// Fun, low-stakes cross-league stats built entirely from data the game
// already records (LEAGUE_HISTORY, careerHistory, retiredNumbers) — nothing
// new tracked just for this page.

function computeTradeFrequencyByTeam() {
  const counts = {};
  LEAGUE_HISTORY.trades.forEach(function (t) {
    t.participants.forEach(function (teamId) { counts[teamId] = (counts[teamId] || 0) + 1; });
  });
  return TEAMS.map(function (t) { return { team: t, count: counts[t.id] || 0 }; })
    .sort(function (a, b) { return b.count - a.count; });
}

function computeMostTradedPlayers(n) {
  const counts = {};
  const names = {};
  LEAGUE_HISTORY.trades.forEach(function (t) {
    t.players.forEach(function (p) {
      counts[p.playerId] = (counts[p.playerId] || 0) + 1;
      names[p.playerId] = p.playerName;
    });
  });
  return Object.keys(counts)
    .map(function (id) { return { playerId: id, name: names[id], count: counts[id] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, n);
}

// "Hit" = ended up (or currently sits) at 75+ overall/peak — a rough "became
// a quality starter" bar, not a precise scouting grade.
const DRAFT_HIT_THRESHOLD = 75;

function computeDraftClassHitRates() {
  return LEAGUE_HISTORY.draftClasses.map(function (dc) {
    let hits = 0;
    let resolved = 0;
    dc.picks.forEach(function (pick) {
      const active = getPlayerById(pick.playerId);
      const retired = LEAGUE_HISTORY.retiredPlayers.find(function (r) { return r.id === pick.playerId; });
      const peak = active ? active.overall : (retired ? retired.peakOverall : null);
      if (peak === null) return; // no longer traceable (shouldn't normally happen)
      resolved += 1;
      if (peak >= DRAFT_HIT_THRESHOLD) hits += 1;
    });
    return { leagueYear: dc.leagueYear, hits: hits, resolved: resolved, total: dc.picks.length };
  }).sort(function (a, b) { return b.leagueYear - a.leagueYear; });
}

function computeJerseyNumberPopularity() {
  const counts = {};
  PLAYERS_2026.forEach(function (p) {
    if (p.jerseyNumber === null || p.jerseyNumber === undefined) return;
    counts[p.jerseyNumber] = (counts[p.jerseyNumber] || 0) + 1;
  });
  return Object.keys(counts).map(function (num) { return { number: Number(num), count: counts[num] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 10);
}

// Longest current tenure with one team, read off careerHistory's open
// (endSeason: null) teamHistory entries.
function computeLongestCurrentTenures(n) {
  const rows = [];
  PLAYERS_2026.forEach(function (p) {
    ensureCareerHistory(p);
    const openEntry = p.careerHistory.teamHistory.find(function (t) { return t.endSeason === null && t.teamId === p.teamId; });
    if (openEntry && openEntry.seasons > 0) rows.push({ player: p, seasons: openEntry.seasons, teamId: p.teamId });
  });
  return rows.sort(function (a, b) { return b.seasons - a.seasons; }).slice(0, n);
}

function computeTotalRetiredNumbers() {
  return TEAMS.reduce(function (sum, t) { return sum + ((t.retiredNumbers && t.retiredNumbers.length) || 0); }, 0);
}

// How many rows a ranked toy shows. bestPlayerAtEveryPick ignores it on
// purpose — "the best at each pick" is a complete list or it is nothing.
const TOY_ROW_LIMIT = 15;

function toyTeamName(teamId) {
  const team = getTeamById(teamId);
  return team ? escapeHtml(team.name) : escapeHtml(String(teamId));
}

function toySeasonRow(r) {
  return r.leagueYear + ' ' + toyTeamName(r.teamId) + ' — ' + r.wins + '-' + r.losses;
}

// These lists are ranked on career points + rebounds + assists added together,
// because it is the fairest cheap way to compare a guard with a centre. What
// they used to PRINT was that total under the invented unit "production" —
// "24,645 production" — which names no real statistic, cannot be checked
// against anything on the player's own page, and leaves an order that looks
// wrong impossible to understand.
//
// Now they print the three real stats the ranking is made of. The total is
// still the sort key; the components are what a reader can actually use.
//
// For totals summed across many players — a whole draft class, both sides of a
// trade — the three-way split is noise, but the unit still has to be named. One
// constant so the page cannot end up calling the same number two things.
const TOY_STAT_UNIT = 'pts+reb+ast';

function toyStatLine(r) {
  const p = r.parts || {};
  return (p.points || 0).toLocaleString() + ' pts · ' +
    (p.rebounds || 0).toLocaleString() + ' reb · ' +
    (p.assists || 0).toLocaleString() + ' ast';
}

function toyProductionRow(r) {
  return escapeHtml(r.name) + ' — ' + toyStatLine(r);
}

function toyPickRow(r) {
  return '#' + r.pickNumber + ' (' + r.leagueYear + ') ' + escapeHtml(r.name) +
    ' — ' + toyStatLine(r);
}

function toyTradeSides(r) {
  return (r.participants || []).map(function (id) {
    return toyTeamName(id) + ' ' + (r.bySide[id] || 0).toLocaleString();
  }).join(' vs ');
}

// currentYear for the trade toys. GameState is a browser global; the fallback
// keeps this file loadable under Node without one.
function toyCurrentYear() {
  return (typeof GameState !== 'undefined' && GameState && GameState.leagueYear) || 2026;
}

// The catalogue. Each entry names a toy, says what it is, and says how to
// render one row — nothing else. Adding a toy is one entry, not a new branch in
// a render function that already works.
//
// Every `run` but one is a straight call into historyToys.js. The exception is
// Relatives, which folds two-way links into one row per family and has no
// business in a module that knows nothing about rendering.
const TOY_CATALOGUE = [
  { id: 'busts', name: 'Biggest Busts', blurb: 'Top-10 picks with the fewest career pts+reb+ast.',
    run: function () { return biggestBusts(TOY_ROW_LIMIT); }, row: toyPickRow },
  { id: 'steals', name: 'Biggest Steals', blurb: 'Picks outside the top 10 with the most career pts+reb+ast.',
    run: function () { return biggestSteals(TOY_ROW_LIMIT); }, row: toyPickRow },
  { id: 'bestAtPick', name: 'Best at Every Pick', blurb: 'The most career pts+reb+ast ever taken at each slot.',
    run: function () { return bestPlayerAtEveryPick(); }, row: toyPickRow },
  { id: 'classes', name: 'Draft Class Rankings', blurb: 'Every class, by the career pts+reb+ast its picks went on to record.',
    run: function () { return draftClassRankings(); },
    row: function (r) {
      return r.leagueYear + ' — ' + r.production.toLocaleString() + ' ' + TOY_STAT_UNIT +
        ' from ' + r.picks + ' picks';
    } },
  { id: 'noRing', name: 'Best Without a Ring', blurb: 'The most career pts+reb+ast without a championship.',
    run: function () { return bestWithoutARing(TOY_ROW_LIMIT); }, row: toyProductionRow },
  { id: 'noMvp', name: 'Best Without an MVP', blurb: 'The most career pts+reb+ast without ever winning MVP.',
    run: function () { return bestWithoutAnMvp(TOY_ROW_LIMIT); }, row: toyProductionRow },
  { id: 'loyal', name: 'Most Years With One Team', blurb: 'The one-club players.',
    run: function () { return mostYearsOneTeam(TOY_ROW_LIMIT); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.years + ' seasons' + (r.teamId ? ' with ' + toyTeamName(r.teamId) : ''); } },
  { id: 'journeymen', name: 'Most Teams', blurb: 'The journeymen.',
    run: function () { return mostTeams(TOY_ROW_LIMIT); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.teams + ' teams'; } },
  { id: 'earnings', name: 'Career Earnings', blurb: 'Who got paid.',
    run: function () { return careerEarnings(TOY_ROW_LIMIT); },
    row: function (r) { return escapeHtml(r.name) + ' — $' + r.earnings.toLocaleString(); } },
  { id: 'veryGood', name: 'Hall of Very Good', blurb: 'The nearly-men who fell short of induction.',
    run: function () { return hallOfVeryGood(TOY_ROW_LIMIT); },
    row: function (r) { return escapeHtml(r.name) + ' — ' + r.hofScore.toFixed(0) + ' Hall of Fame score'; } },
  { id: 'bestTeams', name: 'Best Teams Ever', blurb: 'The greatest single seasons.',
    run: function () { return bestTeams(TOY_ROW_LIMIT); }, row: toySeasonRow },
  { id: 'worstTeams', name: 'Worst Teams Ever', blurb: 'The seasons nobody wants back.',
    run: function () { return worstTeams(TOY_ROW_LIMIT); }, row: toySeasonRow },
  { id: 'bestMiss', name: 'Best Team to Miss the Playoffs', blurb: 'Good, and not good enough.',
    run: function () { return bestToMissThePlayoffs(TOY_ROW_LIMIT); }, row: toySeasonRow },
  { id: 'worstChamp', name: 'Worst Team to Win It All', blurb: 'Got hot at the right time.',
    run: function () { return worstToWinIt(TOY_ROW_LIMIT); }, row: toySeasonRow },
  { id: 'bigTrades', name: 'Biggest Trades', blurb: 'The most player ever swapped in one deal, by the careers of everyone involved. Judged on the names, so it needs no waiting period.',
    run: function () { return biggestTrades(TOY_ROW_LIMIT); },
    row: function (r) {
      return r.leagueYear + ' — ' + r.combined.toLocaleString() + ' ' + TOY_STAT_UNIT +
        ' moved: ' + toyTradeSides(r);
    } },
  { id: 'lopsided', name: 'Most Lopsided Trades', blurb: 'Judged on what each side produced afterwards, and only after three seasons.',
    run: function () { return mostLopsidedTrades(TOY_ROW_LIMIT, toyCurrentYear()); },
    row: function (r) {
      return r.leagueYear + ' — ' + r.difference.toLocaleString() + ' ' + TOY_STAT_UNIT +
        ' apart: ' + toyTradeSides(r);
    } },
  { id: 'relatives', name: 'Relatives', blurb: 'Families in the league. Brothers arrive early; a son needs his father to have played thirteen seasons first, so the first one turns up around season fifteen.',
    // historyToys.families() reads retirees too. This used to walk PLAYERS_2026
    // alone, which showed one of the three families in a twenty-season league —
    // families take most of twenty seasons to appear, so by the time they exist
    // half of any pair has usually retired.
    run: function () { return families(); },
    row: function (r) {
      const verb = r.type === 'father' ? 'is the son of'
        : r.type === 'son' ? 'is the father of'
        : 'is the brother of';
      return escapeHtml(r.a) + ' ' + verb + ' ' + escapeHtml(r.b);
    } }
];

function renderToyIndex(selectedToyId) {
  let html = '<div class="panel"><div class="panel-header">Toys</div><div class="panel-body">' +
    '<div class="toolbar">' + TOY_CATALOGUE.map(function (t) {
      return '<button data-toy="' + t.id + '" class="' +
        (selectedToyId === t.id ? 'btn-primary' : 'btn-ghost') + '">' +
        escapeHtml(t.name) + '</button>';
    }).join(' ') + '</div>';

  const toy = TOY_CATALOGUE.find(function (t) { return t.id === selectedToyId; });
  if (toy) {
    let rows;
    try {
      rows = toy.run();
    } catch (e) {
      // One broken toy must not take the page down with it.
      return html + '<div class="empty-state">This one could not be worked out: ' +
        escapeHtml(e.message) + '</div></div></div>';
    }
    html += '<div class="kpi-sub">' + escapeHtml(toy.blurb) + '</div>';
    html += rows.length === 0
      ? '<div class="empty-state">Nothing here yet — this fills in as the league plays.</div>'
      : '<ol class="stack-list">' + rows.map(function (r) { return '<li>' + toy.row(r) + '</li>'; }).join('') + '</ol>';
  }
  return html + '</div></div>';
}

let _selectedToyId = TOY_CATALOGUE[0].id;

function renderFrivolities(container) {
  const tradeFrequency = computeTradeFrequencyByTeam().slice(0, 10);
  const mostTraded = computeMostTradedPlayers(10);
  const draftHitRates = computeDraftClassHitRates();
  const jerseyPopularity = computeJerseyNumberPopularity();
  const longestTenures = computeLongestCurrentTenures(10);

  let html = '<div class="view-header"><h2>Frivolities</h2><span class="view-sub">Fun, low-stakes stats built from the league\'s own history</span></div>';

  // The toy index sits ABOVE the glance panels: it is the reason to open this
  // page, and the six panels below are the league at a glance.
  html += renderToyIndex(_selectedToyId);

  html += '<div class="kpi-grid">' +
    '<div class="kpi-tile"><div class="kpi-label">Total Trades</div><div class="kpi-value">' + LEAGUE_HISTORY.trades.length + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Draft Classes</div><div class="kpi-value">' + LEAGUE_HISTORY.draftClasses.length + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Numbers Retired Leaguewide</div><div class="kpi-value">' + computeTotalRetiredNumbers() + '</div></div>' +
    '<div class="kpi-tile"><div class="kpi-label">Hall of Famers</div><div class="kpi-value">' + LEAGUE_HISTORY.retiredPlayers.filter(function (r) { return r.hallOfFame; }).length + '</div></div>' +
  '</div>';

  html += '<div class="panel"><div class="panel-header">Most Active Trade Partners</div><div class="panel-body">' +
    (tradeFrequency.every(function (r) { return r.count === 0; })
      ? '<div class="empty-state">No trades yet.</div>'
      : '<table class="data-table"><thead><tr><th>Team</th><th class="num">Trades</th></tr></thead><tbody>' +
        tradeFrequency.filter(function (r) { return r.count > 0; }).map(function (r) {
          return '<tr><td class="col-name">' + teamLogoImgHtml(r.team.id, 18) + ' ' + escapeHtml(r.team.name) + '</td><td class="num">' + r.count + '</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Most-Traded Players</div><div class="panel-body">' +
    (mostTraded.length === 0
      ? '<div class="empty-state">No trades yet.</div>'
      : '<table class="data-table"><thead><tr><th>Player</th><th class="num">Times Traded</th></tr></thead><tbody>' +
        mostTraded.map(function (r) { return '<tr><td class="col-name">' + escapeHtml(r.name) + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Draft Class Hit Rates <span class="kpi-sub">(' + DRAFT_HIT_THRESHOLD + '+ overall/peak)</span></div><div class="panel-body">' +
    (draftHitRates.length === 0
      ? '<div class="empty-state">No drafts completed yet.</div>'
      : '<table class="data-table"><thead><tr><th class="num">Class</th><th class="num">Hits</th><th class="num">Resolved</th><th class="num">Hit Rate</th></tr></thead><tbody>' +
        draftHitRates.map(function (r) {
          const pct = r.resolved > 0 ? Math.round((r.hits / r.resolved) * 100) : 0;
          return '<tr><td class="num">' + r.leagueYear + '</td><td class="num">' + r.hits + '</td><td class="num">' + r.resolved + ' / ' + r.total + '</td><td class="num">' + pct + '%</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Most Popular Jersey Numbers</div><div class="panel-body">' +
    '<table class="data-table"><thead><tr><th class="num">Number</th><th class="num">Players Wearing It</th></tr></thead><tbody>' +
    jerseyPopularity.map(function (r) { return '<tr><td class="num">#' + r.number + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>' +
  '</div></div>';

  html += '<div class="panel"><div class="panel-header">Longest Current Tenures</div><div class="panel-body">' +
    (longestTenures.length === 0
      ? '<div class="empty-state">No multi-season tenures yet.</div>'
      : '<table class="data-table"><thead><tr><th>Player</th><th>Team</th><th class="num">Seasons</th></tr></thead><tbody>' +
        longestTenures.map(function (r) {
          const team = getTeamById(r.teamId);
          return '<tr><td class="col-name">' + escapeHtml(r.player.name) + '</td><td>' + (team ? teamLogoImgHtml(team.id, 16) + ' ' + escapeHtml(team.name) : '—') + '</td><td class="num">' + r.seasons + '</td></tr>';
        }).join('') + '</tbody></table>') +
  '</div></div>';

  container.innerHTML = html;

  container.querySelectorAll('button[data-toy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _selectedToyId = btn.getAttribute('data-toy');
      renderFrivolities(container);
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TOY_CATALOGUE: TOY_CATALOGUE,
    renderToyIndex: renderToyIndex,
    computeTradeFrequencyByTeam: computeTradeFrequencyByTeam,
    computeMostTradedPlayers: computeMostTradedPlayers,
    computeDraftClassHitRates: computeDraftClassHitRates,
    computeJerseyNumberPopularity: computeJerseyNumberPopularity,
    computeLongestCurrentTenures: computeLongestCurrentTenures,
    computeTotalRetiredNumbers: computeTotalRetiredNumbers,
    renderFrivolities: renderFrivolities,
    DRAFT_HIT_THRESHOLD: DRAFT_HIT_THRESHOLD
  };
}
