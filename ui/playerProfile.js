function pctString(made, attempted) {
  return attempted > 0 ? ((made / attempted) * 100).toFixed(1) + '%' : '—';
}

function renderCurrentSeasonPanel(player) {
  const avg = getPlayerAverages(player);
  const team = player.teamId ? getTeamById(player.teamId) : null;
  let html = '<div class="panel"><div class="panel-header">Current Season</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Team</div><div class="kpi-value">' + (team ? escapeHtml(team.name) : 'Free Agent') + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">GP</div><div class="kpi-value">' + (player.seasonStats ? player.seasonStats.gamesPlayed : 0) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">PPG</div><div class="kpi-value">' + avg.ppg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">RPG</div><div class="kpi-value">' + avg.rpg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">APG</div><div class="kpi-value">' + avg.apg.toFixed(1) + '</div></div>';
  // What he allowed as the assigned shot defender, and what the scoreboard did
  // while he was on the floor. Both have been accumulating since oppFga/oppFgm
  // and plusMinus were added and neither has ever been shown — a defensive
  // badge that lowers the shooter's percentage was invisible in a box score
  // full of steals and blocks.
  const played = player.seasonStats && player.seasonStats.gamesPlayed > 0;
  html += '<div class="kpi-tile"><div class="kpi-label">DFG%</div><div class="kpi-value">' +
    (played && player.seasonStats.oppFga > 0 ? (avg.dfgPct * 100).toFixed(1) + '%' : '—') + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">+/- per game</div><div class="kpi-value">' +
    (played ? (avg.pmpg >= 0 ? '+' : '') + avg.pmpg.toFixed(1) : '—') + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Salary</div><div class="kpi-value">$' + player.contract.salary.toLocaleString() + '</div></div>';
  if (player.status && player.status.injury) {
    html += '<div class="kpi-tile"><div class="kpi-label">Injury</div><div class="kpi-value">' + injuryStatusHtml(player) + '</div></div>';
  }
  html += '</div></div>';
  html += shotChartPanelHtml('Shot Chart', player.seasonStats);
  return html;
}

function renderCareerStatsTab(player) {
  ensureCareerData([player]);
  // Sits at the top of the first tab a reader lands on. It was originally put
  // beside the badges, which is thematically right and practically wrong: that
  // is a different tab, so the panel rendered only for someone who had already
  // gone looking for it.
  const ultimateHtml = ultimatePanelHtml(player);
  // Includes the season in progress — careerStats alone only gains a year at
  // the top of the offseason, so mid-season this panel read Games 0 / PPG 0.0
  // directly beneath a Current Season panel reporting real production.
  const cs = careerTotalsToDate(player);
  const gp = cs.gamesPlayed || 1;
  // singleGame highs update per game and are already live; singleSeason waits
  // for the offseason, which is why Best Season read 0 next to a real pace.
  const highs = { singleGame: player.careerHistory.careerHighs.singleGame, singleSeason: seasonHighsToDate(player) };
  let html = ultimateHtml + '<div class="panel"><div class="panel-header">Career Totals</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Seasons</div><div class="kpi-value">' + cs.seasonsPlayed + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Games</div><div class="kpi-value">' + cs.gamesPlayed + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">PPG</div><div class="kpi-value">' + (cs.points / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">RPG</div><div class="kpi-value">' + (cs.rebounds / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">APG</div><div class="kpi-value">' + (cs.assists / gp).toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Peak OVR</div><div class="kpi-value">' + player.peakOverall + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Titles</div><div class="kpi-value">' + player.championshipsWon + '</div></div>';
  html += '</div></div>';

  html += '<div class="panel"><div class="panel-header">Career Highs</div><div class="panel-body kpi-grid">';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Pts</div><div class="kpi-value">' + highs.singleGame.points + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Reb</div><div class="kpi-value">' + highs.singleGame.rebounds + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Single-Game Ast</div><div class="kpi-value">' + highs.singleGame.assists + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Best Season PPG</div><div class="kpi-value">' + highs.singleSeason.ppg.toFixed(1) + '</div></div>';
  html += '<div class="kpi-tile"><div class="kpi-label">Best Season Pts</div><div class="kpi-value">' + highs.singleSeason.points + '</div></div>';
  html += '</div></div>';

  if (player.awardsWon.length > 0) {
    // Grouped by award type (title + how many times, years underneath)
    // rather than one row per award instance — a long career racks up
    // enough MVPs/All-NBA nods that a flat list becomes an unreadable wall.
    const grouped = {};
    player.awardsWon.forEach(function (a) {
      if (!grouped[a.award]) grouped[a.award] = [];
      grouped[a.award].push(a.leagueYear);
    });
    const awardKeys = Object.keys(grouped).sort(function (a, b) { return grouped[b].length - grouped[a].length; });
    html += '<div class="panel"><div class="panel-header">Awards</div><div class="panel-body kpi-grid">';
    awardKeys.forEach(function (key) {
      const years = grouped[key].slice().sort(function (a, b) { return b - a; });
      const label = AWARD_LABELS[key] || key;
      html += '<div class="kpi-tile"><div class="kpi-label">' + escapeHtml(label) + '</div>' +
        '<div class="kpi-value">×' + years.length + '</div>' +
        '<div class="kpi-sub">' + years.join(', ') + '</div></div>';
    });
    html += '</div></div>';
  }
  return html;
}

const SEASON_BREAKDOWN_COLUMNS = [
  { key: 'season', label: 'Year' }, { key: 'team', label: 'Team' }, { key: 'gamesPlayed', label: 'GP' },
  { key: 'points', label: 'Points' }, { key: 'rebounds', label: 'Rebounds' }, { key: 'assists', label: 'Assists' },
  { key: 'fgPct', label: 'FG%' }, { key: 'tpPct', label: '3P%' }, { key: 'ftPct', label: 'FT%' }, { key: 'minutes', label: 'Minutes' }
];

function seasonRowsForPlayer(player) {
  ensureCareerHistory(player);
  return Object.keys(player.careerHistory.seasonByYear).map(function (y) {
    const s = player.careerHistory.seasonByYear[y];
    return Object.assign({}, s, { fgPct: s.fga > 0 ? s.fgm / s.fga : 0, tpPct: s.tpa > 0 ? s.tpm / s.tpa : 0, ftPct: s.fta > 0 ? s.ftm / s.fta : 0 });
  });
}

function renderSeasonBreakdownTab(player, sortKey, sortDir, onSort) {
  let rows = seasonRowsForPlayer(player);
  if (rows.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No completed seasons on record yet.</div></div></div>';
  rows.sort(function (a, b) { return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * sortDir; });
  const bestSeasonYear = rows.slice().sort(function (a, b) { return b.points - a.points; })[0].season;

  let html = '<div class="panel"><table class="data-table"><thead><tr>';
  SEASON_BREAKDOWN_COLUMNS.forEach(function (col) {
    const numeric = col.key !== 'team';
    html += '<th data-sort-key="' + col.key + '"' + (numeric ? ' class="num"' : '') + '>' + col.label +
      (sortKey === col.key ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function (s) {
    const rowClass = s.season === bestSeasonYear ? ' class="row-highlight"' : '';
    html += '<tr' + rowClass + '><td class="num">' + s.season + '</td><td>' + (s.team || '—') + '</td><td class="num">' + s.gamesPlayed +
      '</td><td class="num">' + s.points + '</td><td class="num">' + s.rebounds + '</td><td class="num">' + s.assists +
      '</td><td class="num">' + pctString(s.fgm, s.fga) + '</td><td class="num">' + pctString(s.tpm, s.tpa) +
      '</td><td class="num">' + pctString(s.ftm, s.fta) + '</td><td class="num">' + s.minutes + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderTeamHistoryTab(player) {
  ensureCareerHistory(player);
  const teams = player.careerHistory.teamHistory;
  if (teams.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No team history on record yet.</div></div></div>';

  let html = '<div class="panel"><div class="panel-header">Timeline</div><div class="panel-body">';
  html += '<div style="display:flex;height:24px;border-radius:var(--r-sm);overflow:hidden;">';
  const totalSeasons = teams.reduce(function (s, t) { return s + t.seasons; }, 0) || 1;
  teams.forEach(function (t) {
    const team = getTeamById(t.teamId);
    const color = team ? team.colors.primary : '#555';
    const width = (t.seasons / totalSeasons) * 100;
    html += '<div title="' + (t.team || t.teamId) + ' (' + t.startSeason + '-' + (t.endSeason || 'present') + ')" ' +
      'style="width:' + width + '%;background:' + color + ';"></div>';
  });
  html += '</div></div></div>';

  html += '<div class="panel"><table class="data-table"><thead><tr><th>Team</th><th class="num">Years</th>' +
    '<th class="num">Seasons</th><th class="num">Games</th><th class="num">Total Pts</th><th class="num">PPG</th>' +
    '<th class="num">RPG</th><th class="num">APG</th></tr></thead><tbody>';
  teams.forEach(function (t) {
    const gp = t.totalGames || 1;
    html += '<tr><td class="col-name">' + (t.team || t.teamId) + '</td><td class="num">' + t.startSeason + '–' + (t.endSeason || 'present') +
      '</td><td class="num">' + t.seasons + '</td><td class="num">' + t.totalGames + '</td><td class="num">' + t.totalPoints +
      '</td><td class="num">' + (t.totalPoints / gp).toFixed(1) + '</td><td class="num">' + (t.totalRebounds / gp).toFixed(1) +
      '</td><td class="num">' + (t.totalAssists / gp).toFixed(1) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

const SEVERITY_PILL = { minor: 'pill-mute', moderate: 'pill-pos', major: 'pill-loss', severe: 'pill-loss' };

function renderInjuryTimelineTab(player) {
  ensureCareerHistory(player);
  const injuries = player.careerHistory.injuryHistory;
  if (injuries.length === 0) return '<div class="panel"><div class="panel-body"><div class="empty-state">No injuries on record.</div></div></div>';

  let html = '<div class="panel"><table class="data-table"><thead><tr><th>Season</th><th>Type</th><th>Severity</th>' +
    '<th class="num">Est. Days</th><th class="num">Actual Days</th><th class="num">Games Out</th><th>Return</th><th>Notes</th></tr></thead><tbody>';
  injuries.slice().reverse().forEach(function (i) {
    const pillClass = SEVERITY_PILL[i.severity] || 'pill-mute';
    html += '<tr><td class="num">' + i.season + '</td><td>' + (i.type || '—') + '</td><td><span class="pill ' + pillClass + '">' + i.severity + '</span></td>' +
      '<td class="num">' + (i.estimatedRecoveryDays === null ? 'Season' : i.estimatedRecoveryDays) + '</td><td class="num">' + (i.actualRecoveryDays === null ? '—' : i.actualRecoveryDays) +
      '</td><td class="num">' + i.gamesOut + '</td><td>' + (i.returnDate || '—') + '</td><td>' + (i.notes || '') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

const PLAYER_PROFILE_TABS = [
  { id: 'attributes', label: 'Attributes' },
  // "Badges", not "Traits & Badges": they were always one thing. The internal
  // name `hiddenTraits` stays — renaming the data model would touch 48 traits,
  // the save format and every validator for zero player-visible gain.
  { id: 'traits', label: 'Badges' },
  { id: 'overview', label: 'Career Stats' },
  { id: 'seasons', label: 'Season Breakdown' },
  { id: 'teams', label: 'Team History' },
  { id: 'injuries', label: 'Injury Timeline' }
];

const TRAIT_CATEGORY_LABELS = {
  offensive: 'Offensive', defensive: 'Defensive', athletic: 'Athletic',
  mental: 'Mental', negative: 'Flaws', superstar: 'Superstar'
};
const TRAIT_CATEGORY_ORDER = ['superstar', 'offensive', 'defensive', 'athletic', 'mental', 'negative'];

const PERSONALITY_LABELS = {
  loyalty: 'Loyalty', ambition: 'Ambition', ego: 'Ego',
  coachability: 'Coachability', durabilityMindset: 'Durability Mindset'
};

function traitBadgeHtml(key, tier, category, rangeLabel) {
  const def = TRAIT_TAXONOMY_BY_KEY[key];
  // An evolved badge shows its SECRET NAME. The key never changes — every
  // routing and effect decision downstream still sees `sharpshooter` — so this
  // is the one place the evolution is visible, and it has to be, or the rarest
  // thing in the game looks like an ordinary badge with an odd tier on it.
  const name = (tier === SECRET_TIER && SECRET_FORMS[key])
    ? SECRET_FORMS[key].name
    : (def ? def.name : key);
  // tier is null for a fuzzy (partially-scouted) reveal — rangeLabel carries
  // the "silver-gold?" range text instead of a single confirmed tier, so
  // there's no real tier to color by yet.
  let tierClass;
  if (tier === null) tierClass = 'tier-fuzzy';
  else if (category === 'negative') tierClass = 'tier-negative';
  else tierClass = 'tier-' + tier;
  const tierLabel = rangeLabel ? rangeLabel : tier;
  return '<span class="trait-badge ' + tierClass + '">' + escapeHtml(name) +
    ' <span class="trait-badge-tier">' + escapeHtml(tierLabel) + '</span></span>';
}

// Same confidence-gated reveal the Scouting tab already uses (scouting.js's
// getRevealedView) — a player's hidden traits/personality aren't just lore,
// they're something your front office has to actually scout to learn, same
// as an opponent's. Own-roster players start scouted at 0% too (passive
// scouting ramps up over the season), which is intentional, not a bug: even
// your own front office doesn't have perfect Day 1 insight into makeup.
function renderTraitsTab(player) {
  const target = GameState.scouting ? GameState.scouting.targets[player.id] : null;
  const confidence = target ? target.confidence : 0;
  // A prospect is anyone not on an NBA roster. They keep the fuzz so draft
  // night stays a gamble; everyone signed shows their badges outright.
  const view = getRevealedView(player, confidence, !player.teamId);

  // The raw level is an internal token; "0% hidden" is not a sentence. The pill
  // describes what the SCOUTING has bought, which is what this panel is about —
  // badges no longer cost anything for a rostered player.
  const LEVEL_LABEL = { hidden: 'unscouted', fuzzy: 'partial', exact: 'full' };
  let html = '<div class="panel"><div class="panel-header">Scouting Confidence</div><div class="panel-body">' +
    '<div class="kpi-value">' + Math.round(confidence) + '% <span class="pill pill-mute">' +
    (LEVEL_LABEL[view.level] || view.level) + '</span></div>' +
    '<div class="meter" style="margin:8px 0 0;"><div class="meter-fill" style="width:' + Math.round(confidence) + '%"></div></div>' +
    '</div></div>';

  html += '<div class="panel"><div class="panel-header">Badges</div><div class="panel-body">';
  // Branches on traitsAreFuzzy, NOT on level: level is about personality and
  // says nothing about badges. Conflating them is what broke this once already.
  if (view.traits.length === 0) {
    html += '<p class="trait-lock-note">No notable badges.</p>';
  } else if (view.traitsAreFuzzy) {
    html += '<p class="trait-lock-note">Draft prospect — exact badge tiers are never shown before the pick.</p>';
    html += '<div class="trait-badge-grid">' + view.traits.map(function (t) {
      const def = TRAIT_TAXONOMY_BY_KEY[t.key];
      return traitBadgeHtml(t.key, null, def ? def.category : 'mental', t.rangeLabel + '?');
    }).join('') + '</div>';
  } else {
    TRAIT_CATEGORY_ORDER.forEach(function (cat) {
      const inCat = view.traits.filter(function (t) {
        const def = TRAIT_TAXONOMY_BY_KEY[t.key];
        return def && def.category === cat;
      });
      if (inCat.length === 0) return;
      html += '<div class="trait-badge-category-label">' + TRAIT_CATEGORY_LABELS[cat] + '</div>';
      html += '<div class="trait-badge-grid">' + inCat.map(function (t) {
        return traitBadgeHtml(t.key, t.tier, cat);
      }).join('') + '</div>';
    });
  }
  html += '</div></div>';

  html += '<div class="panel"><div class="panel-header">Personality</div><div class="panel-body">';
  if (view.level === 'hidden') {
    html += '<p class="trait-lock-note">Not scouted enough yet — personality is hidden until confidence reaches 30%.</p>';
  } else if (view.level === 'fuzzy') {
    html += '<div class="kpi-grid">' + Object.keys(view.personality).map(function (k) {
      return '<div class="kpi-tile"><div class="kpi-label">' + (PERSONALITY_LABELS[k] || k) + '</div>' +
        '<div class="kpi-value">' + view.personality[k] + '</div></div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="kpi-grid">' + Object.keys(view.personality).map(function (k) {
      const value = view.personality[k];
      return '<div class="kpi-tile"><div class="kpi-label">' + (PERSONALITY_LABELS[k] || k) + '</div>' +
        '<div class="kpi-value">' + value + '</div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + value + '%"></div></div></div>';
    }).join('') + '</div>';
  }
  html += '</div></div>';

  return html;
}

// Grouped for readability rather than one flat list of 20 — mirrors how a
// real scouting report is organized (data.js's ATTRIBUTE_KEYS order is
// unrelated, just declaration order).
const ATTRIBUTE_GROUPS = [
  { label: 'Scoring', keys: ['insideScoring', 'midRange', 'threePoint', 'freeThrow', 'postScoring'] },
  { label: 'Playmaking', keys: ['passing', 'ballHandling'] },
  { label: 'Defense', keys: ['perimeterDefense', 'interiorDefense', 'steal', 'block'] },
  { label: 'Rebounding', keys: ['offReb', 'defReb'] },
  { label: 'Athleticism', keys: ['speed', 'acceleration', 'strength', 'vertical'] },
  { label: 'Mental', keys: ['basketballIQ', 'leadership', 'workEthic'] }
];

const ATTRIBUTE_LABELS = {
  insideScoring: 'Inside Scoring', midRange: 'Mid-Range', threePoint: '3-Point', freeThrow: 'Free Throw',
  postScoring: 'Post Scoring', passing: 'Passing', ballHandling: 'Ball Handling',
  perimeterDefense: 'Perimeter D', interiorDefense: 'Interior D', steal: 'Steal', block: 'Block',
  offReb: 'Off. Rebound', defReb: 'Def. Rebound', speed: 'Speed', acceleration: 'Acceleration',
  strength: 'Strength', vertical: 'Vertical', basketballIQ: 'Basketball IQ', leadership: 'Leadership', workEthic: 'Work Ethic'
};

function renderAttributesTab(player) {
  let html = '';
  ATTRIBUTE_GROUPS.forEach(function (group) {
    html += '<div class="panel"><div class="panel-header">' + group.label + '</div><div class="panel-body kpi-grid">';
    group.keys.forEach(function (key) {
      const value = player.attributes[key];
      html += '<div class="kpi-tile"><div class="kpi-label">' + ATTRIBUTE_LABELS[key] + '</div>' +
        '<div class="kpi-value"><span class="rating-chip ' + ratingTier(value) + '">' + value + '</span></div>' +
        '<div class="meter"><div class="meter-fill" style="width:' + value + '%"></div></div></div>';
    });
    html += '</div></div>';
  });
  return html;
}

function openPlayerProfile(playerId) {
  GameState.profilePlayerId = playerId;
  renderView('playerProfile');
}

// Shown under every tab rather than inside one: a feat belongs to the player,
// not to a category of his statistics, and burying it behind a tab is how a
// thing nobody ever sees gets built.
const PROFILE_FEAT_LIMIT = 12;

const FAMILY_LABELS = { father: 'Son of', son: 'Father of', brother: 'Brother of' };

// A relative may be an active player or a retiree — the link stores the name
// alongside the id precisely so this never has to search the league to render.
// The name is only a link when the player is still findable.
function renderFamilyPanel(player) {
  const kin = relativesOf(player);
  if (!kin.length) return '';
  return '<div class="panel"><div class="panel-header">Family</div>' +
    '<div class="panel-body"><ul class="stack-list">' +
    kin.map(function (r) {
      const label = FAMILY_LABELS[r.type] || 'Related to';
      const known = !!getPlayerById(r.playerId);
      const name = known
        ? '<button class="player-link" data-profile-id="' + r.playerId + '">' + escapeHtml(r.name) + '</button>'
        : escapeHtml(r.name);
      return '<li>' + label + ' ' + name + '</li>';
    }).join('') + '</ul></div></div>';
}

function renderFeatsPanel(player) {
  const mine = featsForPlayer(player.id);
  if (!mine.length) return '';
  const recent = mine.slice().reverse().slice(0, PROFILE_FEAT_LIMIT);
  const more = mine.length - recent.length;
  return '<div class="panel"><div class="panel-header">Feats (' + mine.length + ')</div>' +
    '<div class="panel-body"><ul class="stack-list">' +
    recent.map(function (f) {
      return '<li><span class="pill pill-mute">' + f.leagueYear + '</span> ' +
        escapeHtml(featShortLabel(f.kind)) + ' — ' + escapeHtml(featStatLine(f)) + '</li>';
    }).join('') +
    '</ul>' + (more > 0 ? '<div class="kpi-sub">and ' + more + ' more</div>' : '') +
    '</div></div>';
}

function renderPlayerProfile(container) {
  const player = getPlayerById(GameState.profilePlayerId);
  if (!player) {
    container.innerHTML = '<div class="view-header"><h2>Player Profile</h2></div><div class="empty-state">No player selected. Pick one from the Roster or Career Ledger.</div>';
    return;
  }
  ensureCareerData([player]);

  let activeTab = 'overview';
  let sortKey = 'season';
  let sortDir = -1;

  function draw() {
    const team = player.teamId ? getTeamById(player.teamId) : null;
    // Physicals: real for 2K27-imported players, sampled for generated ones.
    // Wingspan tolerates absence — players from saves written before the
    // import carry none, and a dangling "· null" reads as a bug.
    const ht = player.heightIn ? Math.floor(player.heightIn / 12) + '\'' + (player.heightIn % 12) + '"' : null;
    const physicals = [ht, player.weightLb ? player.weightLb + ' lb' : null,
      player.wingspanIn ? Math.floor(player.wingspanIn / 12) + '\'' + (player.wingspanIn % 12) + '" wingspan' : null]
      .filter(function (x) { return x; }).join(' · ');
    let html = '<div class="view-header" style="display:flex;align-items:center;gap:16px;">' +
      playerSpriteHtml(player, team, 100) +
      '<div><h2>' + escapeHtml(player.name) + '</h2><span class="view-sub">' +
      player.position + ' · ' + archetypeLabel(player) + ' · Age ' + player.age +
      (team ? ' · ' + escapeHtml(team.name) : ' · Free Agent') +
      (physicals ? ' · ' + physicals : '') + '</span></div></div>';
    html += renderCurrentSeasonPanel(player);
    html += '<div class="tab-bar">';
    PLAYER_PROFILE_TABS.forEach(function (t) {
      html += '<button class="tab-btn' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    });
    html += '</div>';

    if (activeTab === 'attributes') html += renderAttributesTab(player);
    else if (activeTab === 'traits') html += renderTraitsTab(player);
    else if (activeTab === 'overview') html += renderCareerStatsTab(player);
    else if (activeTab === 'seasons') html += renderSeasonBreakdownTab(player, sortKey, sortDir);
    else if (activeTab === 'teams') html += renderTeamHistoryTab(player);
    else if (activeTab === 'injuries') html += renderInjuryTimelineTab(player);

    html += renderFamilyPanel(player);
    html += renderFeatsPanel(player);

    container.innerHTML = html;

    // The family panel links to relatives; the delegated handler every other
    // screen uses lives on its own render, so this one wires its own.
    container.querySelectorAll('button[data-profile-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPlayerProfile(btn.getAttribute('data-profile-id')); });
    });
    container.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.getAttribute('data-tab'); draw(); });
    });
    container.querySelectorAll('th[data-sort-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-sort-key');
        if (key === sortKey) { sortDir = -sortDir; } else { sortKey = key; sortDir = -1; }
        draw();
      });
    });
  }

  draw();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pctString: pctString,
    seasonRowsForPlayer: seasonRowsForPlayer,
    renderPlayerProfile: renderPlayerProfile,
    openPlayerProfile: openPlayerProfile
  };
}

// The player's ultimate, if he has one. Answers the question you actually have
// when you are looking at a trade target: does this guy take games over?
//
// Renders NOTHING for a player without one. An empty "no ultimate" box on the
// 400-odd players who do not qualify is noise, and the absence is already the
// answer.
function ultimatePanelHtml(player) {
  if (typeof hasUltimate !== 'function' || !hasUltimate(player)) return '';
  const u = ultimateFor(player);
  if (!u) return '';

  const rows = (typeof LEAGUE_HISTORY !== 'undefined' && LEAGUE_HISTORY.takeovers) || [];
  const mine = rows.filter(function (r) { return r.playerId === player.id; });
  const best = mine.reduce(function (m, r) { return r.points > m ? r.points : m; }, 0);
  const boost = badgeBoostFor(player, u);

  let body = '<div class="ult-profile-name"><strong>' + escapeHtml(u.name) + '</strong>' +
    '<span class="pill pill-mute">' + (u.kind === 'team' ? 'Lifts the team' : 'Solo') + '</span>' +
    (boost > 1 ? '<span class="pill">Badge-boosted</span>' : '') + '</div>' +
    '<p class="kpi-sub">' + escapeHtml(ULTIMATE_DESCRIPTIONS[u.key]) + '</p>';

  if (mine.length === 0) {
    body += '<p class="trait-lock-note">Hasn’t taken a game over yet.</p>';
  } else {
    body += '<div class="ult-profile-stats">' +
      '<span><strong>' + mine.length + '</strong> takeover' + (mine.length === 1 ? '' : 's') + '</span>' +
      '<span>best: <strong>' + best + '</strong> pts</span></div>';
  }
  return '<div class="panel"><div class="panel-header">Ultimate</div>' +
    '<div class="panel-body">' + body + '</div></div>';
}
