// What the GM should care about right now, derived from the league as it
// actually stands.
//
// This is a READ. It rolls no dice, mutates nothing, and invents no events:
// every item below is a fact already true in game state, phrased as a problem
// and given a handle. That is deliberate. The audit
// (docs/ENGAGEMENT_OVERHAUL_AUDIT.md) measured roughly three narrative
// touchpoints across an 82-game season, capped by a constant rather than by
// anything the player did — while the state itself was full of unread
// situations: men on expiring deals, a payroll over the tax line, a rotation
// player whose morale had quietly fallen through the floor.
//
// So the fix is not more events. It is showing the ones already there.
//
// PERFORMANCE. Detectors see the user's roster and their own team's row, and
// nothing walks league history — the audit's rule. The whole pass is O(roster)
// plus O(teams) for the standings position, which is 15 and 30.
var _AGENDA_DATA = (typeof require !== 'undefined')
  ? {
      data: require('./data.js'),
      league: require('./league.js'),
      owner: require('./owner.js'),
      rivalries: require('./rivalries.js'),
      history: require('./history.js'),
      memory: require('./gmMemory.js'),
      teams: require('./teams.js')
    }
  : {
      data: {
        getEffectiveLuxuryTaxLine: typeof getEffectiveLuxuryTaxLine !== 'undefined' ? getEffectiveLuxuryTaxLine : null,
        getEffectiveSalaryCap: typeof getEffectiveSalaryCap !== 'undefined' ? getEffectiveSalaryCap : null
      },
      league: {
        getTeamRoster: typeof getTeamRoster !== 'undefined' ? getTeamRoster : null,
        getTeamPayroll: typeof getTeamPayroll !== 'undefined' ? getTeamPayroll : null,
        getActiveRoster: typeof getActiveRoster !== 'undefined' ? getActiveRoster : null
      },
      owner: { currentPatience: typeof currentPatience !== 'undefined' ? currentPatience : null,
               patienceLabel: typeof patienceLabel !== 'undefined' ? patienceLabel : null },
      rivalries: { rivalsOf: typeof rivalsOf !== 'undefined' ? rivalsOf : null },
      history: { LEAGUE_HISTORY: typeof LEAGUE_HISTORY !== 'undefined' ? LEAGUE_HISTORY : null },
      memory: {
        historyLineWith: typeof historyLineWith !== 'undefined' ? historyLineWith : null,
        hasHistoryWith: typeof hasHistoryWith !== 'undefined' ? hasHistoryWith : null
      },
      teams: { getTeamById: typeof getTeamById !== 'undefined' ? getTeamById : null }
    };

// Urgency is HOW SOON, category is WHAT KIND. The brief lists them in one
// list; they are two axes and collapsing them makes "CRITICAL" and
// "RELATIONSHIP" mutually exclusive, which they obviously are not — an angry
// franchise player is both.
var AGENDA_URGENCY = { CRITICAL: 'critical', DEVELOPING: 'developing', OPPORTUNITY: 'opportunity' };
var AGENDA_CATEGORY = { RELATIONSHIP: 'relationship', BASKETBALL: 'basketball', BUSINESS: 'business', LEAGUE: 'league' };

var URGENCY_RANK = { critical: 0, developing: 1, opportunity: 2 };

// Thresholds. Named, in one place, so they can be tuned against a measured
// distribution rather than argued about at each call site.
var AGENDA_TUNING = {
  unhappyMorale: 45,        // status.morale below this is a man with a grievance
  restlessMorale: 60,       // and below this he is not happy either
  keyPlayerOverall: 78,     // "losing him would matter"
  starOverall: 85,
  prospectPotential: 80,    // worth developing
  prospectAge: 24,
  veteranAge: 33,
  expiringYears: 1,         // final year of a deal
  longInjuryGames: 10,
  rosterMin: 13,
  rosterMax: 15,
  streakLength: 5,          // games in a row before it is a story
  // How far back down the trade archive to look. A TAIL read, not a scan: the
  // audit's rule is that nothing walks league history, and the archive grows
  // without bound across a twenty-season career.
  tradeLookback: 8
};

// Clubs are shown by name, never by id. The desk said "History with LAL",
// which is a database key wearing a team's coat.
function _teamName(id) {
  const get = _AGENDA_DATA.teams && _AGENDA_DATA.teams.getTeamById;
  if (!get) return id;
  try { const t = get(id); return (t && t.name) || id; } catch (e) { return id; }
}

function _num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
function _morale(p) { return _num(p && p.status && p.status.morale, 70); }
function _injury(p) { return (p && p.status && p.status.injury) || null; }
function _overall(p) { return _num(p && p.overall, 0); }

// Every item is this shape. `responses` are the moves the game can already
// make — an agenda that offers an action the UI cannot perform is a lie, so
// each one names a real view.
function makeItem(o) {
  return {
    id: o.id,
    urgency: o.urgency,
    category: o.category,
    source: o.source,
    entities: o.entities || [],
    headline: o.headline,
    explanation: o.explanation,
    responses: o.responses || [],
    consequence: o.consequence || null,
    expires: o.expires || null,
    weight: _num(o.weight, 0)
  };
}

// --- detectors -------------------------------------------------------------
// Each takes the assembled view and returns zero or more items. Kept separate
// and exported so a validator can construct one situation and assert that the
// one detector that should fire, fires.

function detectOwnerPatience(v) {
  if (!v.career || !v.teamId) return [];
  const fn = _AGENDA_DATA.owner.currentPatience;
  if (!fn) return [];
  const left = fn(v.career, v.teamId);
  if (left === undefined || left === null) return [];
  const label = _AGENDA_DATA.owner.patienceLabel ? _AGENDA_DATA.owner.patienceLabel(left) : null;
  if (left > 1) return [];
  return [makeItem({
    id: 'owner-patience',
    urgency: left <= 0 ? AGENDA_URGENCY.CRITICAL : AGENDA_URGENCY.DEVELOPING,
    category: AGENDA_CATEGORY.BUSINESS,
    source: 'owner',
    entities: [{ kind: 'team', id: v.teamId }],
    headline: left <= 0 ? 'Ownership has run out of patience' : 'Ownership has you on notice',
    explanation: left <= 0
      ? 'Another season like the last one and the job is gone.'
      : 'One more disappointing season and the seat gets very hot.',
    responses: [{ label: 'Review the owner\'s mandate', view: 'dashboard' }],
    consequence: 'Missing the mandate again ends your tenure here.',
    weight: left <= 0 ? 100 : 70
  })];
}

function detectUnhappyPlayers(v) {
  const out = [];
  v.roster.forEach(function (p) {
    const m = _morale(p);
    if (m >= AGENDA_TUNING.restlessMorale) return;
    const key = _overall(p) >= AGENDA_TUNING.keyPlayerOverall;
    const bad = m < AGENDA_TUNING.unhappyMorale;
    if (!bad && !key) return;   // a deep-bench man being mildly grumpy is not news
    out.push(makeItem({
      id: 'unhappy-' + p.id,
      urgency: (bad && key) ? AGENDA_URGENCY.CRITICAL : AGENDA_URGENCY.DEVELOPING,
      category: AGENDA_CATEGORY.RELATIONSHIP,
      source: 'player',
      entities: [{ kind: 'player', id: p.id, name: p.name }],
      headline: bad
        ? p.name + ' is unhappy here'
        : p.name + ' is becoming frustrated with his role',
      explanation: 'Morale ' + Math.round(m) + '. ' + (key
        ? 'He is good enough that losing him would cost you games.'
        : 'Left alone this gets worse, and he will remember it at contract time.'),
      responses: [
        { label: 'Look at his minutes', view: 'roster' },
        { label: 'Explore a trade', view: 'tradeCenter' }
      ],
      consequence: 'An unhappy player is harder to re-sign and cheaper to trade.',
      weight: (bad ? 60 : 30) + (key ? 25 : 0) + Math.max(0, 70 - m) / 4
    }));
  });
  return out;
}

function detectExpiringContracts(v) {
  const out = [];
  v.roster.forEach(function (p) {
    const c = p.contract;
    if (!c || _num(c.yearsRemaining, 99) > AGENDA_TUNING.expiringYears) return;
    const ov = _overall(p);
    if (ov < AGENDA_TUNING.keyPlayerOverall) return;
    const star = ov >= AGENDA_TUNING.starOverall;
    out.push(makeItem({
      id: 'expiring-' + p.id,
      urgency: star ? AGENDA_URGENCY.CRITICAL : AGENDA_URGENCY.DEVELOPING,
      category: AGENDA_CATEGORY.BUSINESS,
      source: 'contract',
      entities: [{ kind: 'player', id: p.id, name: p.name }],
      headline: p.name + ' is in the last year of his deal',
      explanation: (star ? 'He is the kind of player a season is built around. ' : '') +
        'Decide whether to extend him, trade him, or let him reach the market.',
      responses: [
        { label: 'Open contract talks', view: 'freeAgency' },
        { label: 'Shop him', view: 'tradeCenter' }
      ],
      consequence: 'Let it run and he walks for nothing.',
      weight: (star ? 85 : 45) + Math.max(0, ov - 70)
    }));
  });
  return out;
}

function detectInjuries(v) {
  const out = [];
  v.roster.forEach(function (p) {
    const inj = _injury(p);
    if (!inj) return;
    const games = _num(inj.gamesRemaining, 0);
    const ov = _overall(p);
    if (games < AGENDA_TUNING.longInjuryGames && ov < AGENDA_TUNING.starOverall) return;
    out.push(makeItem({
      id: 'injury-' + p.id,
      urgency: ov >= AGENDA_TUNING.starOverall ? AGENDA_URGENCY.CRITICAL : AGENDA_URGENCY.DEVELOPING,
      category: AGENDA_CATEGORY.BASKETBALL,
      source: 'injury',
      entities: [{ kind: 'player', id: p.id, name: p.name }],
      headline: p.name + ' is out ' + games + ' games',
      explanation: (inj.severity ? inj.severity + '. ' : '') +
        'Somebody has to absorb his minutes while he is gone.',
      responses: [
        { label: 'Reshape the rotation', view: 'roster' },
        { label: 'Look for cover', view: 'freeAgency' }
      ],
      consequence: 'Rotation players asked to do too much wear down.',
      weight: 40 + Math.max(0, ov - 70) + Math.min(games, 40) / 2,
      expires: { kind: 'games', remaining: games }
    }));
  });
  return out;
}

function detectPayroll(v) {
  if (v.payroll === null || v.taxLine === null) return [];
  if (v.payroll <= v.taxLine) return [];
  const over = v.payroll - v.taxLine;
  return [makeItem({
    id: 'payroll-tax',
    urgency: AGENDA_URGENCY.DEVELOPING,
    category: AGENDA_CATEGORY.BUSINESS,
    source: 'finance',
    entities: [{ kind: 'team', id: v.teamId }],
    headline: 'Payroll is over the tax line',
    explanation: '$' + Math.round(over / 1e6) + 'M above the line. Ownership pays that bill, and notices.',
    responses: [
      { label: 'Look at the books', view: 'finances' },
      { label: 'Move salary', view: 'tradeCenter' }
    ],
    consequence: 'Staying over the line spends the owner\'s goodwill.',
    weight: 35 + Math.min(over / 1e6, 40)
  })];
}

function detectRosterSize(v) {
  const n = v.roster.length;
  if (n >= AGENDA_TUNING.rosterMin && n <= AGENDA_TUNING.rosterMax) return [];
  const short = n < AGENDA_TUNING.rosterMin;
  return [makeItem({
    id: 'roster-size',
    urgency: AGENDA_URGENCY.CRITICAL,
    category: AGENDA_CATEGORY.BASKETBALL,
    source: 'roster',
    entities: [{ kind: 'team', id: v.teamId }],
    headline: short ? 'You are below the roster minimum' : 'Your roster is over the limit',
    explanation: 'You are carrying ' + n + ' players. The league requires ' +
      AGENDA_TUNING.rosterMin + ' to ' + AGENDA_TUNING.rosterMax + '.',
    responses: [{ label: short ? 'Sign somebody' : 'Cut somebody', view: short ? 'freeAgency' : 'roster' }],
    consequence: 'The league will resolve this for you if you do not.',
    weight: 95
  })];
}

function detectBuriedProspect(v) {
  const out = [];
  v.roster.forEach(function (p) {
    if (_num(p.age, 99) > AGENDA_TUNING.prospectAge) return;
    if (_num(p.potential, 0) < AGENDA_TUNING.prospectPotential) return;
    if (_overall(p) >= AGENDA_TUNING.keyPlayerOverall) return;  // already playing well
    out.push(makeItem({
      id: 'prospect-' + p.id,
      urgency: AGENDA_URGENCY.OPPORTUNITY,
      category: AGENDA_CATEGORY.BASKETBALL,
      source: 'development',
      entities: [{ kind: 'player', id: p.id, name: p.name }],
      headline: p.name + ' has more in him than he is showing',
      explanation: 'He is ' + p.age + ' and the staff think he can be a lot better. ' +
        'Players develop by playing.',
      responses: [{ label: 'Give him minutes', view: 'roster' }],
      consequence: 'Bury him and somebody else develops him.',
      weight: 20 + Math.max(0, _num(p.potential, 0) - _overall(p))
    }));
  });
  return out;
}

function detectAgingCore(v) {
  const vets = v.roster.filter(function (p) {
    return _num(p.age, 0) >= AGENDA_TUNING.veteranAge && _overall(p) >= AGENDA_TUNING.keyPlayerOverall;
  });
  if (vets.length < 2) return [];
  return [makeItem({
    id: 'aging-core',
    urgency: AGENDA_URGENCY.DEVELOPING,
    category: AGENDA_CATEGORY.BASKETBALL,
    source: 'roster',
    entities: vets.map(function (p) { return { kind: 'player', id: p.id, name: p.name }; }),
    headline: 'Your best players are getting old together',
    explanation: vets.length + ' of your key men are ' + AGENDA_TUNING.veteranAge +
      ' or older. This window closes whether you plan for it or not.',
    responses: [
      { label: 'Look at the roster', view: 'roster' },
      { label: 'Trade for youth', view: 'tradeCenter' }
    ],
    consequence: 'A core that ages out together leaves nothing behind.',
    weight: 25 + vets.length * 6
  })];
}

function detectForm(v) {
  const s = v.streak;
  if (!s || Math.abs(s.length) < AGENDA_TUNING.streakLength) return [];
  const losing = s.length < 0;
  const n = Math.abs(s.length);
  return [makeItem({
    id: 'form-streak',
    urgency: losing ? AGENDA_URGENCY.DEVELOPING : AGENDA_URGENCY.OPPORTUNITY,
    category: AGENDA_CATEGORY.BASKETBALL,
    source: 'results',
    entities: [{ kind: 'team', id: v.teamId }],
    headline: losing ? 'You have lost ' + n + ' in a row' : 'You have won ' + n + ' in a row',
    explanation: losing
      ? 'Runs like this are where locker rooms come apart and owners start asking questions.'
      : 'The team is playing its best basketball. This is when a move is worth most.',
    responses: [{ label: 'Look at the schedule', view: 'schedule' }],
    consequence: losing ? 'Keep losing and morale follows the record down.' : null,
    weight: (losing ? 30 : 18) + n * 3
  })];
}

function detectRivalry(v) {
  if (!v.rivals || !v.rivals.length) return [];
  return [makeItem({
    id: 'rivalry',
    urgency: AGENDA_URGENCY.OPPORTUNITY,
    category: AGENDA_CATEGORY.LEAGUE,
    source: 'rivalry',
    entities: v.rivals.map(function (id) { return { kind: 'team', id: id }; }),
    headline: v.rivals.length === 1 ? 'A rivalry is running hot' : 'Rivalries are running hot',
    explanation: 'History with ' + v.rivals.map(_teamName).join(', ') +
      '. These games carry more than two points.',
    responses: [{ label: 'Check the standings', view: 'standings' }],
    weight: 15 + v.rivals.length * 5
  })];
}

// The league transacts around you and never tells you. ~30 AI trades execute
// in a season (see the corrected section of the audit) and the only trace is a
// line in the feed that scrolls away. A rival getting better is a fact about
// YOUR season, so it belongs on your desk.
function detectLeagueTrades(v) {
  const H = _AGENDA_DATA.history && _AGENDA_DATA.history.LEAGUE_HISTORY;
  if (!H || !Array.isArray(H.trades) || !H.trades.length) return [];
  const rivals = v.rivals || [];
  const recent = H.trades.slice(-AGENDA_TUNING.tradeLookback);
  const out = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i];
    if (v.leagueYear && t.leagueYear !== v.leagueYear) continue;
    const parts = t.participants || [];
    // Your own trades are not news to you.
    if (parts.indexOf(v.teamId) !== -1) continue;
    const rival = parts.filter(function (id) { return rivals.indexOf(id) !== -1; });
    if (!rival.length) continue;
    const names = (t.players || []).map(function (p) { return p.playerName; }).filter(Boolean);
    out.push(makeItem({
      id: 'league-trade-' + (t.leagueYear || '') + '-' + parts.join('-') + '-' + i,
      urgency: AGENDA_URGENCY.DEVELOPING,
      category: AGENDA_CATEGORY.LEAGUE,
      source: 'trade',
      entities: parts.map(function (id) { return { kind: 'team', id: id }; }),
      headline: rival.map(_teamName).join(' and ') + ' made a move',
      explanation: parts.map(_teamName).join(' and ') + ' traded' +
        (names.length ? ' ' + names.slice(0, 3).join(', ') : '') +
        '. A club you are measured against just changed shape.',
      responses: [{ label: 'Check the standings', view: 'standings' }],
      weight: 22
    }));
    break;   // one is a story, five is a ticker
  }
  return out;
}

// The league remembers. You face a club on Thursday, and three seasons ago you
// sent them the man who is now their best player — that is a fact the game has
// always stored in LEAGUE_HISTORY.trades and never once mentioned.
//
// Deliberately tied to the NEXT FIXTURE rather than firing whenever history
// exists. rivalry-heat taught that lesson: a scene keyed on a standing fact is
// permanently true and drowns out everything that just happened.
function detectOldFriend(v) {
  const M = _AGENDA_DATA.memory;
  const opp = v.nextOpponent;
  if (!opp || !opp.teamId || !M || !M.historyLineWith) return [];
  let line = null;
  try { line = M.historyLineWith(v.teamId, opp.teamId, { leagueYear: v.leagueYear }); }
  catch (e) { line = null; }
  if (!line) return [];
  return [makeItem({
    id: 'old-friend-' + opp.teamId,
    urgency: AGENDA_URGENCY.OPPORTUNITY,
    category: AGENDA_CATEGORY.LEAGUE,
    source: 'memory',
    entities: [{ kind: 'team', id: opp.teamId }],
    headline: 'You have history with your next opponent',
    explanation: line,
    responses: [{ label: 'Look at the schedule', view: 'schedule' }],
    weight: 12
  })];
}

var AGENDA_DETECTORS = [
  detectOwnerPatience, detectRosterSize, detectExpiringContracts, detectUnhappyPlayers,
  detectInjuries, detectPayroll, detectAgingCore, detectForm, detectBuriedProspect, detectRivalry, detectLeagueTrades, detectOldFriend
];

// Assembles the one view every detector reads, so the roster is walked once and
// each detector stays a pure function of plain data (which is what makes them
// testable without a league).
function agendaView(gameState) {
  const gs = gameState || {};
  const teamId = gs.userTeamId || null;
  const L = _AGENDA_DATA.league;
  let roster = [];
  if (teamId && L.getActiveRoster) {
    try { roster = L.getActiveRoster(teamId) || []; } catch (e) { roster = []; }
  }
  let payroll = null;
  if (teamId && L.getTeamPayroll) {
    try { payroll = L.getTeamPayroll(teamId); } catch (e) { payroll = null; }
  }
  let taxLine = null;
  if (_AGENDA_DATA.data.getEffectiveLuxuryTaxLine) {
    // capLevel, NOT a year. It is a settings multiplier defaulting to 1, so
    // passing the league year quietly multiplies the tax line by ~2026 and the
    // payroll detector can never fire. Caught by an integration check that was
    // reporting zero items and being believed.
    const capLevel = (gs.settings && gs.settings.capLevel) || 1;
    try { taxLine = _AGENDA_DATA.data.getEffectiveLuxuryTaxLine(capLevel); } catch (e) { taxLine = null; }
  }
  // rivalsOf returns [{ teamId, heat }], NOT ids. Normalised to plain ids here,
  // once, so no detector has to remember which it is getting.
  //
  // Both detectors that touch rivals got this wrong and neither test caught it,
  // because both tests fed hand-written strings. On screen it read "History
  // with [object Object]", and detectLeagueTrades silently never matched a
  // rival at all — indexOf on an object array finds nothing and returns no
  // items, which looks exactly like "no rival has traded".
  let rivals = [];
  if (gs.rivalries && _AGENDA_DATA.rivalries.rivalsOf && teamId) {
    try {
      rivals = (_AGENDA_DATA.rivalries.rivalsOf(gs.rivalries, teamId) || [])
        .map(function (r) { return (r && r.teamId) ? r.teamId : r; })
        .filter(function (id) { return typeof id === 'string'; });
    } catch (e) { rivals = []; }
  }
  return {
    teamId: teamId,
    roster: roster,
    payroll: typeof payroll === 'number' ? payroll : null,
    taxLine: typeof taxLine === 'number' ? taxLine : null,
    career: gs.gmCareer || null,
    rivals: rivals,
    streak: gs.agendaStreak || currentStreak(gs),
    nextOpponent: nextOpponent(gs),
    leagueYear: gs.leagueYear || null
  };
}

// The next club on the schedule, so a memory can arrive at the moment it is
// about to matter rather than at a random time in March. Walks forward from
// today and stops at the first unplayed fixture, so it is O(games left) in the
// worst case and usually one step.
function nextOpponent(gameState) {
  const gs = gameState || {};
  const teamId = gs.userTeamId;
  if (!teamId || !gs.season || !Array.isArray(gs.season.games)) return null;
  const day = gs.season.currentDay || 0;
  let best = null;
  for (let i = 0; i < gs.season.games.length; i++) {
    const g = gs.season.games[i];
    if (g.played) continue;
    if ((g.day || 0) < day) continue;
    if (g.homeTeamId !== teamId && g.awayTeamId !== teamId) continue;
    if (best === null || (g.day || 0) < (best.day || 0)) {
      best = { day: g.day, teamId: g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId };
    }
  }
  return best;
}

// Current win/loss run, read off the season's played games. Positive is a
// winning run, negative a losing one. Walks backwards and stops at the first
// result that breaks the run, so it is O(streak) and not O(season).
function currentStreak(gameState) {
  const gs = gameState || {};
  const teamId = gs.userTeamId;
  if (!teamId || !gs.season || !Array.isArray(gs.season.games)) return { length: 0 };
  const mine = gs.season.games.filter(function (g) {
    return g.played && (g.homeTeamId === teamId || g.awayTeamId === teamId);
  });
  let run = 0, dir = null;
  for (let i = mine.length - 1; i >= 0; i--) {
    const g = mine[i];
    const home = g.homeTeamId === teamId;
    const won = home ? g.homeScore > g.awayScore : g.awayScore > g.homeScore;
    if (dir === null) dir = won;
    else if (won !== dir) break;
    run++;
  }
  return { length: dir ? run : -run };
}

// The agenda itself: every detector, ranked. Urgency first so a critical item
// can never sit under an opportunity, then weight inside the band.
function buildAgenda(gameState, opts) {
  const o = opts || {};
  const v = agendaView(gameState);
  if (!v.teamId) return [];
  let items = [];
  AGENDA_DETECTORS.forEach(function (d) {
    let got;
    try { got = d(v) || []; } catch (e) { got = []; }
    items = items.concat(got);
  });
  items.sort(function (a, b) {
    const ur = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (ur !== 0) return ur;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.id < b.id ? -1 : 1;      // stable, so the same state gives the same order
  });
  return o.limit ? items.slice(0, o.limit) : items;
}

function agendaCounts(items) {
  const out = { critical: 0, developing: 0, opportunity: 0, total: (items || []).length };
  (items || []).forEach(function (i) { if (out[i.urgency] !== undefined) out[i.urgency]++; });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AGENDA_URGENCY: AGENDA_URGENCY,
    AGENDA_CATEGORY: AGENDA_CATEGORY,
    AGENDA_TUNING: AGENDA_TUNING,
    AGENDA_DETECTORS: AGENDA_DETECTORS,
    makeItem: makeItem,
    agendaView: agendaView,
    currentStreak: currentStreak,
    buildAgenda: buildAgenda,
    agendaCounts: agendaCounts,
    detectOwnerPatience: detectOwnerPatience,
    detectUnhappyPlayers: detectUnhappyPlayers,
    detectExpiringContracts: detectExpiringContracts,
    detectInjuries: detectInjuries,
    detectPayroll: detectPayroll,
    detectRosterSize: detectRosterSize,
    detectBuriedProspect: detectBuriedProspect,
    detectAgingCore: detectAgingCore,
    detectForm: detectForm,
    detectRivalry: detectRivalry,
    detectLeagueTrades: detectLeagueTrades,
    detectOldFriend: detectOldFriend,
    nextOpponent: nextOpponent
  };
}
