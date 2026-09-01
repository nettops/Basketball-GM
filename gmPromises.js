// The one thing in this game you can break.
//
// Every dialogue choice already MOVES something — owner happiness, morale,
// reputation — and every one of them settles the instant you click it. Say
// "I will get us under the tax line before the deadline" and the owner used to
// be four points happier before you had done a single thing about it, forever.
// That is not a decision, it is a button that pays.
//
// A promise is the same sentence with the payment deferred. It is written
// down, it names a date, and on that date the game looks at the league and
// decides whether you did it. Keeping your word pays a little. Breaking it
// costs more — see PROMISE_TUNING — because a promise you can make for free
// is the button again.
//
// NOT A PARALLEL NARRATIVE SYSTEM. There are no promise scenes, no promise
// screen and no promise generator. A promise is made by an existing
// dialogueScenes.js choice through an existing applyDialogueEffect channel,
// it is shown on the existing GM agenda, and it pays out through the existing
// owner-happiness, reputation, morale and chronicle channels. This file holds
// the ledger and the judging, and nothing else.
//
// PERFORMANCE. The ledger is capped at PROMISE_TUNING.maxOpen open items and
// the settled tail is trimmed, so settling is O(a handful) per game day. It
// never walks league history.
var _PROMISE_DATA = (typeof require !== 'undefined')
  ? {
      data: require('./data.js'),
      league: require('./league.js'),
      teams: require('./teams.js'),
      gmCareer: require('./gmCareer.js'),
      morale: require('./morale.js')
    }
  : {
      data: {
        getEffectiveLuxuryTaxLine: typeof getEffectiveLuxuryTaxLine !== 'undefined' ? getEffectiveLuxuryTaxLine : null,
        tradeDeadlineDay: typeof tradeDeadlineDay !== 'undefined' ? tradeDeadlineDay : null
      },
      league: {
        getActiveRoster: typeof getActiveRoster !== 'undefined' ? getActiveRoster : null,
        getTeamPayroll: typeof getTeamPayroll !== 'undefined' ? getTeamPayroll : null
      },
      teams: { getTeamById: typeof getTeamById !== 'undefined' ? getTeamById : null },
      gmCareer: {
        ensureGmCareer: typeof ensureGmCareer !== 'undefined' ? ensureGmCareer : null,
        addChronicle: typeof addChronicle !== 'undefined' ? addChronicle : null,
        clampReputation: typeof clampReputation !== 'undefined' ? clampReputation : null,
        CHRONICLE_KINDS: typeof CHRONICLE_KINDS !== 'undefined' ? CHRONICLE_KINDS : null
      },
      morale: { nudgeMorale: typeof nudgeMorale !== 'undefined' ? nudgeMorale : null }
    };

var PROMISE_TUNING = {
  // Four is already more than anyone tracks in their head, and the agenda
  // shows five items in total. Past this the oldest open promise is not
  // silently dropped — a new one simply is not taken.
  maxOpen: 4,
  // Settled promises kept for the record, so the agenda can say "you did what
  // you said you would" for a while afterwards and the chronicle is not the
  // only trace.
  keepSettled: 8,

  // "Watch the next month." A month of game days, not of games: the schedule
  // is the clock everything else in this file reads.
  runWindowDays: 30,
  // "We will get him help" is a trade-deadline-shaped promise, so it gets a
  // window long enough to actually make a move inside.
  helpWindowDays: 45,

  // How much the second-best man on the roster has to improve before that
  // counts as HELP.
  //
  // NOT a noise guard. probe-promises.js measured the drift across 12,600
  // club-windows of 45 game days and it is exactly 0.0 at every percentile:
  // ratings do not move during a season at all, they move at the rollover. So
  // any gain above zero already means somebody new walked in the door. The bar
  // is here to say what counts as HELP for a man carrying a team — a one-point
  // upgrade on your second best is a transaction, not an answer.
  helpRatingGain: 3,

  keptOwner: 3, keptReputation: 2, keptMorale: 1.5,
  brokenOwner: -6, brokenReputation: -4, brokenMorale: -3
};

function _num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

function _teamName(id) {
  const get = _PROMISE_DATA.teams && _PROMISE_DATA.teams.getTeamById;
  if (!get || !id) return id || '';
  try { const t = get(id); return (t && t.name) || id; } catch (e) { return id; }
}

// The league as a promise needs to see it. Built once per settlement pass so
// four judges do not each re-read the payroll.
//
// `opts.day` overrides the schedule day. It has to: during a multi-day
// Continue run gameState.season.currentDay is still whatever it was when the
// run STARTED and does not move until the whole run finishes, so a promise
// judged off it would sit unsettled for the length of the run and then all of
// them would land at once. The day-complete callback knows the real day.
function promiseFacts(gameState, opts) {
  const gs = gameState || {};
  const o = opts || {};
  const teamId = gs.userTeamId || null;
  const team = teamId ? _teamName(teamId) : '';
  const L = _PROMISE_DATA.league;

  let roster = [];
  if (teamId && L.getActiveRoster) {
    try { roster = L.getActiveRoster(teamId) || []; } catch (e) { roster = []; }
  }
  let payroll = null;
  if (teamId && L.getTeamPayroll) {
    try { payroll = L.getTeamPayroll(teamId); } catch (e) { payroll = null; }
  }
  let taxLine = null;
  if (_PROMISE_DATA.data.getEffectiveLuxuryTaxLine) {
    // capLevel, NOT a year — the same mistake gmAgenda.js already made once.
    const capLevel = (gs.settings && gs.settings.capLevel) || 1;
    try { taxLine = _PROMISE_DATA.data.getEffectiveLuxuryTaxLine(capLevel); } catch (e) { taxLine = null; }
  }

  const games = (gs.season && gs.season.games) || [];
  let deadlineDay = null;
  if (_PROMISE_DATA.data.tradeDeadlineDay) {
    try { deadlineDay = _PROMISE_DATA.data.tradeDeadlineDay(games) || null; } catch (e) { deadlineDay = null; }
  }

  const record = (teamId && _PROMISE_DATA.teams.getTeamById)
    ? ((_PROMISE_DATA.teams.getTeamById(teamId) || {}).record || {}) : {};

  const byRating = roster.slice().sort(function (a, b) {
    return _num(b.rawOverall, 0) - _num(a.rawOverall, 0);
  });

  return {
    teamId: teamId,
    teamName: team,
    leagueYear: _num(gs.leagueYear, null),
    day: _num(o.day, _num(gs.season && gs.season.currentDay, 0)),
    deadlineDay: deadlineDay,
    roster: roster,
    payroll: _num(payroll, null),
    taxLine: _num(taxLine, null),
    wins: _num(record.wins, 0),
    losses: _num(record.losses, 0),
    // Second best, because the first is the man being promised help.
    secondBest: byRating.length > 1 ? _num(byRating[1].rawOverall, 0) : 0,
    onRoster: function (playerId) {
      return roster.some(function (p) { return p.id === playerId; });
    },
    playerNamed: function (playerId) {
      return roster.filter(function (p) { return p.id === playerId; })[0] || null;
    }
  };
}

// --- the kinds -------------------------------------------------------------
//
// Each one says when it is due, what it measures at the moment it is made, and
// how it is judged. `judge` returns 'kept', 'broken', or null for "not yet" —
// a promise can be KEPT early (get under the line in January and the owner
// notices in January) but can only be BROKEN at the date, because there is
// always time left to do it.

var PROMISE_KINDS = {
  // tax-bill-looming: "I will get us under it before the deadline."
  'payroll-cut': {
    summary: function (p) { return 'Get the payroll under the tax line'; },
    // The deadline is the date he named. With no schedule to read it off,
    // the promise stands until the season ends.
    dueDay: function (facts) { return facts.deadlineDay; },
    baseline: function () { return null; },
    judge: function (promise, facts) {
      if (facts.payroll === null || facts.taxLine === null) return null;
      return facts.payroll <= facts.taxLine ? 'kept' : null;
    },
    keptLine: function (p) { return 'Got the payroll under the tax line, as promised.'; },
    brokenLine: function (p) { return 'Promised the owner a payroll cut before the deadline and did not deliver one.'; },
    detail: function (p, facts) {
      if (facts.payroll === null || facts.taxLine === null) return '';
      const over = facts.payroll - facts.taxLine;
      return over > 0
        ? '$' + (Math.round(over / 100000) / 10) + 'M over the line still.'
        : 'Under the line by $' + (Math.round(-over / 100000) / 10) + 'M.';
    }
  },

  // mandate-slipping: "We will get there. Watch the next month."
  'mandate-run': {
    summary: function () { return 'Show the owner a run'; },
    dueDay: function (facts) { return facts.day + PROMISE_TUNING.runWindowDays; },
    baseline: function (facts) { return { wins: facts.wins, losses: facts.losses }; },
    // A run means winning more than you lose over the window. Judged on the
    // record either side of the promise rather than on the mandate itself:
    // the owner asked what happens NEXT, and a club already twenty games
    // under would otherwise be broken the moment it promised.
    judge: function (promise, facts) {
      const b = promise.baseline || { wins: 0, losses: 0 };
      const w = facts.wins - _num(b.wins, 0);
      const l = facts.losses - _num(b.losses, 0);
      if (w + l < 5) return null;              // too few games to have shown anything
      return w > l ? 'kept' : null;
    },
    keptLine: function () { return 'Promised the owner a run and delivered one.'; },
    brokenLine: function () { return 'Promised the owner a run and the month never came.'; },
    detail: function (p, facts) {
      const b = p.baseline || { wins: 0, losses: 0 };
      return (facts.wins - _num(b.wins, 0)) + '-' + (facts.losses - _num(b.losses, 0)) + ' since you said it.';
    }
  },

  // unhappy-star: "He is going nowhere. He finishes the season here."
  //
  // Judged on the roster and NOTHING ELSE, and that is a correction. The
  // choice used to end "I will fix what is bothering him", and this judge used
  // to require the man's morale back up out of the unhappy band by April.
  // probe-promises.js measured what actually happens to the 42 men who fall
  // below 40 in a season: the median finishes on 2 and the best of them on 37.
  // Not one recovers. A man below 40 is a man out of the rotation, and morale
  // reads minutes — which gameCoach.js allocates by rating, not by the GM.
  //
  // So the mood half was a promise the game gives you no way to keep. What the
  // GM does control is whether he is still here, and that is a real cost: it
  // means turning down every offer for a declining asset for a whole season,
  // which is exactly what the other choice in that scene is for.
  'keep-him': {
    summary: function (p) { return 'Keep ' + (p.subjectName || 'him'); },
    dueDay: function () { return null; },     // season end
    baseline: function (facts, o) {
      const p = facts.playerNamed(o.subjectId);
      return { morale: _num(p && p.status && p.status.morale, null) };
    },
    // Broken the moment he is gone, with no date to wait for — a trade is not
    // undone by the rest of the season. Kept only at the end, because until
    // then there is still time to move him.
    judge: function (promise, facts) {
      return facts.onRoster(promise.subjectId) ? null : 'broken';
    },
    seasonEndVerdict: 'kept',
    keptLine: function (p) { return 'Said ' + (p.subjectName || 'he') + ' was going nowhere, and he finished the season here.'; },
    brokenLine: function (p) { return 'Promised ' + (p.subjectName || 'him') + ' he was going nowhere, and moved him anyway.'; },
    detail: function (p, facts) {
      if (!facts.onRoster(p.subjectId)) return 'He is not on the roster any more.';
      const pl = facts.playerNamed(p.subjectId);
      const m = _num(pl && pl.status && pl.status.morale, null);
      return m === null ? 'Still here.' : 'Still here. Morale ' + Math.round(m) + '.';
    }
  },

  // star-carried-a-loss: "He deserves better. We will get him help."
  'get-him-help': {
    summary: function (p) { return 'Get ' + (p.subjectName || 'him') + ' help'; },
    dueDay: function (facts) { return facts.day + PROMISE_TUNING.helpWindowDays; },
    baseline: function (facts) { return { secondBest: facts.secondBest }; },
    // Help is the SECOND best man on the roster getting better, whether he
    // arrived in a trade, signed, or was already here and grew. What it is
    // not is the star himself having a good month.
    judge: function (promise, facts) {
      const b = _num(promise.baseline && promise.baseline.secondBest, null);
      if (b === null) return null;
      return facts.secondBest >= b + PROMISE_TUNING.helpRatingGain ? 'kept' : null;
    },
    keptLine: function (p) { return 'Said ' + (p.subjectName || 'his star') + ' deserved help, and went and got it.'; },
    brokenLine: function (p) { return 'Told the press ' + (p.subjectName || 'his star') + ' would get help. Nobody came.'; },
    detail: function (p, facts) {
      const b = _num(p.baseline && p.baseline.secondBest, null);
      if (b === null) return '';
      const gain = facts.secondBest - b;
      return gain > 0
        ? 'Your second man is up ' + Math.round(gain) + ' since.'
        : 'Your second man is no better than the day you said it.';
    }
  }
};

// --- the ledger ------------------------------------------------------------

function promises(gameState) {
  if (!gameState) return [];
  if (!Array.isArray(gameState.gmPromises)) gameState.gmPromises = [];
  return gameState.gmPromises;
}

function openPromises(gameState) {
  return promises(gameState).filter(function (p) { return p.status === 'open'; });
}

// Make one. Returns the record, or null if it was refused — a promise with no
// kind, a duplicate of one already open, or one too many.
//
// The duplicate rule is per kind AND subject: you can owe the owner a payroll
// cut and owe your star help at the same time, but promising the same man help
// twice is one promise, not two.
function makePromise(gameState, o) {
  if (!gameState || !o || !PROMISE_KINDS[o.kind]) return null;
  const list = promises(gameState);
  const open = list.filter(function (p) { return p.status === 'open'; });
  const dupe = open.some(function (p) {
    return p.kind === o.kind && (p.subjectId || null) === (o.subjectId || null);
  });
  if (dupe || open.length >= PROMISE_TUNING.maxOpen) return null;

  const kind = PROMISE_KINDS[o.kind];
  const facts = promiseFacts(gameState, o);
  const record = {
    kind: o.kind,
    sceneId: o.sceneId || null,
    subjectId: o.subjectId || null,
    subjectName: o.subjectName || null,
    text: o.text || kind.summary({ subjectName: o.subjectName }),
    madeYear: facts.leagueYear,
    madeDay: facts.day,
    dueDay: kind.dueDay(facts, o),
    baseline: kind.baseline(facts, o) || null,
    status: 'open',
    settledYear: null,
    settledDay: null
  };
  list.push(record);
  return record;
}

function _nudge(player, delta) {
  const fn = _PROMISE_DATA.morale && _PROMISE_DATA.morale.nudgeMorale;
  if (fn) fn(player, delta);
}

// Pay one out. Owner happiness, reputation, dressing-room morale and a line in
// the chronicle — every one of them a channel the dialogue system already
// moves, so a settled promise reads on screen exactly like an answer given.
function _payout(gameState, promise, verdict, facts) {
  const kept = verdict === 'kept';
  const T = PROMISE_TUNING;
  const applied = [];

  const team = _PROMISE_DATA.teams.getTeamById
    ? _PROMISE_DATA.teams.getTeamById(gameState.userTeamId) : null;
  if (team) {
    team.ownerHappiness = Math.max(0, Math.min(99,
      _num(team.ownerHappiness, 0) + (kept ? T.keptOwner : T.brokenOwner)));
    applied.push('ownerHappiness');
  }

  const career = _PROMISE_DATA.gmCareer.ensureGmCareer
    ? _PROMISE_DATA.gmCareer.ensureGmCareer(gameState) : null;
  if (career && _PROMISE_DATA.gmCareer.clampReputation) {
    career.reputation = _PROMISE_DATA.gmCareer.clampReputation(
      _num(career.reputation, 0) + (kept ? T.keptReputation : T.brokenReputation));
    applied.push('reputation');
  }

  const dm = kept ? T.keptMorale : T.brokenMorale;
  facts.roster.forEach(function (p) { _nudge(p, dm); });
  if (facts.roster.length) applied.push('teamMorale');

  const kind = PROMISE_KINDS[promise.kind];
  const line = kept ? kind.keptLine(promise, facts) : kind.brokenLine(promise, facts);
  if (career && _PROMISE_DATA.gmCareer.addChronicle && _PROMISE_DATA.gmCareer.CHRONICLE_KINDS) {
    _PROMISE_DATA.gmCareer.addChronicle(career, facts.leagueYear,
      _PROMISE_DATA.gmCareer.CHRONICLE_KINDS.PRESS, line);
    applied.push('chronicle');
  }
  return { line: line, applied: applied };
}

// Judge everything that can be judged. Called once a game day and again at the
// season's end, where `opts.seasonEnd` forces every open promise to a verdict:
// a season is over, so "there is still time" is no longer true of anything.
//
// Returns the settlements, so the caller can put them in the feed. It does NOT
// touch the feed itself — this file has no idea the game has a screen.
function settlePromises(gameState, opts) {
  const o = opts || {};
  if (!gameState || !gameState.userTeamId) return [];
  const list = promises(gameState);
  if (!list.length) return [];

  const facts = promiseFacts(gameState, o);
  const settled = [];

  list.forEach(function (p) {
    if (p.status !== 'open') return;
    const kind = PROMISE_KINDS[p.kind];
    // A kind this build does not have — a save written by a later version.
    // Retired rather than judged: calling it broken would put a penalty and a
    // chronicle line on a promise nobody here can read.
    if (!kind) { p.status = 'void'; return; }

    let verdict = null;
    try { verdict = kind.judge(p, facts); } catch (e) { verdict = null; }

    const due = o.seasonEnd === true ||
      (typeof p.dueDay === 'number' && facts.day >= p.dueDay);
    // A verdict either way lands the moment the judge is sure of it: keeping
    // your word early is worth knowing about, and so is the one way a promise
    // can be broken beyond repair — the man you swore was going nowhere is on
    // another club, and no amount of remaining season undoes that.
    //
    // null is the only "not yet". At the date it becomes broken, because the
    // date passing IS the failure.
    if (verdict === null) {
      if (!due) return;
      // The date passing is the failure — for every kind but the one whose
      // whole content is that nothing happened. "He is going nowhere" is kept
      // by the season ending with him still here, so its default is the other
      // way round.
      verdict = kind.seasonEndVerdict || 'broken';
    }

    p.status = verdict;
    p.settledYear = facts.leagueYear;
    p.settledDay = facts.day;
    const paid = _payout(gameState, p, verdict, facts);
    settled.push({ promise: p, verdict: verdict, line: paid.line, applied: paid.applied });
  });

  _trim(list);
  return settled;
}

// Keep every open promise and the last few settled ones. Without this a
// twenty-season career carries every promise ever made into every save file.
function _trim(list) {
  const done = list.filter(function (p) { return p.status !== 'open'; });
  const excess = done.length - PROMISE_TUNING.keepSettled;
  if (excess <= 0) return list;
  let dropped = 0;
  for (let i = 0; i < list.length && dropped < excess; i++) {
    if (list[i].status !== 'open') { list.splice(i, 1); i--; dropped++; }
  }
  return list;
}

// How a promise reads while it is still open: what was said, how it stands,
// and how long is left. Used by the agenda; kept here so the phrasing lives
// with the rule it describes.
function promiseStatusLine(promise, facts) {
  const kind = PROMISE_KINDS[promise.kind];
  if (!kind) return '';
  let detail = '';
  try { detail = kind.detail(promise, facts) || ''; } catch (e) { detail = ''; }
  let clock = '';
  if (typeof promise.dueDay === 'number' && typeof facts.day === 'number') {
    const left = promise.dueDay - facts.day;
    clock = left <= 0 ? 'Due now.' : left + ' day' + (left === 1 ? '' : 's') + ' left.';
  } else {
    clock = 'Judged at the end of the season.';
  }
  return [detail, clock].filter(function (s) { return s; }).join(' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROMISE_TUNING: PROMISE_TUNING,
    PROMISE_KINDS: PROMISE_KINDS,
    promiseFacts: promiseFacts,
    promises: promises,
    openPromises: openPromises,
    makePromise: makePromise,
    settlePromises: settlePromises,
    promiseStatusLine: promiseStatusLine
  };
}
