// The GM's career record.
//
// The design rule this file exists to enforce: NOTHING here is stored if it can
// be computed. LEAGUE_HISTORY already permanently archives champions, trades,
// draft classes, awards and retirees; the only fact missing was WHICH TEAM WAS
// THE USER'S IN WHICH YEARS. Add that and the whole career record becomes a
// query, which is why the trophy room can never disagree with the timeline —
// there is only one copy of the truth.
//
// Two things genuinely cannot be derived and so are stored:
//   1. The tenure log itself.
//   2. A per-season row. LEAGUE_HISTORY.champions keeps only the WINNER and
//      team.lastSeasonWins is overwritten every year, so how a past season
//      ended for a non-champion is otherwise unrecoverable.
//
// draft.js is resolved LAZILY (the same reason history.js resolves
// commissioner.js lazily): this file's <script> tag must load before
// history.js's, which is far above draft.js's, so referencing
// playoffResultByTeam at file-load time in the browser would throw a
// ReferenceError and abort the rest of this file.
function _gmCareerDraftDep() {
  return (typeof require !== 'undefined')
    ? require('./draft.js')
    : { playoffResultByTeam: playoffResultByTeam, playoffBracketIsComplete: playoffBracketIsComplete };
}

// -1 is ours; 0-4 are draft.js's elimination-round encoding, reused rather than
// redefined so "how the season ended" has one definition.
const SEASON_RESULT = {
  MISSED: -1,
  FIRST_ROUND: 0,
  CONF_SEMIS: 1,
  CONF_FINALS: 2,
  FINALS_LOSS: 3,
  CHAMPION: 4
};

const SEASON_RESULT_LABEL = {
  '-1': 'Missed the playoffs',
  '0': 'Lost in the first round',
  '1': 'Lost in the conference semifinals',
  '2': 'Lost in the conference finals',
  '3': 'Lost the Finals',
  '4': 'Won the championship'
};

// Reputation is written only by dialogue scenes and read only by the career
// view. It is deliberately NOT consumed by the simulation: it records how the
// press has been handled, and is not a rating that moves free agency.
const REPUTATION_DEFAULT = 50;

function clampReputation(value) {
  if (typeof value !== 'number' || !isFinite(value)) return REPUTATION_DEFAULT;
  return Math.max(0, Math.min(100, value));
}

// Banded rather than bare, so a 3-point swing reads as something and so the
// number is not mistaken for a rating the engine consumes.
function reputationBand(value) {
  const v = clampReputation(value);
  if (v < 25) return 'Stonewalled';
  if (v < 45) return 'Divisive';
  if (v < 65) return 'Known Quantity';
  if (v < 85) return 'Respected';
  return 'Institution';
}

function createGmCareer(name, teamId, startYear) {
  return {
    name: name || 'GM',
    reputation: REPUTATION_DEFAULT,
    // A LIST from day one. Shipping with a single stint, but multi-team careers
    // are a planned follow-up and this shape means they need no save migration.
    tenures: [{ teamId: teamId, startYear: startYear, endYear: null }],
    seasons: [],
    milestones: [],
    chronicle: []
  };
}

function ensureGmCareer(gameState) {
  if (!gameState) return null;
  if (!gameState.gmCareer) {
    // Deliberately starts at the CURRENT year. A career attached to an
    // in-progress save does not know what happened before it existed, and
    // inventing a record back to 2026 would be a lie the trophy room repeats.
    gameState.gmCareer = createGmCareer('GM', gameState.userTeamId, gameState.leagueYear || 2026);
  }
  const c = gameState.gmCareer;
  if (!Array.isArray(c.tenures)) c.tenures = [];
  if (!Array.isArray(c.seasons)) c.seasons = [];
  if (!Array.isArray(c.milestones)) c.milestones = [];
  if (!Array.isArray(c.chronicle)) c.chronicle = [];
  if (!c.name) c.name = 'GM';
  // Both backfills a save predating the field and repairs a corrupt one —
  // clampReputation returns the default for undefined and for a non-number.
  c.reputation = clampReputation(c.reputation);
  return c;
}

// Inclusive at BOTH ends: a tenure ending in 2030 includes the 2030 season,
// because endYear names the last season worked, not the first season away.
function tenureCovers(career, teamId, leagueYear) {
  if (!career || !career.tenures) return false;
  return career.tenures.some(function (t) {
    if (t.teamId !== teamId) return false;
    if (leagueYear < t.startYear) return false;
    return t.endYear === null || t.endYear === undefined || leagueYear <= t.endYear;
  });
}

function seasonResultFor(teamId, bracket) {
  // An unresolved or absent bracket is NOT a title. finalizeSeasonHistory can
  // be reached with a null bracket (a save abandoned mid-season, a commissioner
  // rewind), and defaulting the champion case would hand out a ring for it.
  // One definition of "the playoffs are finished", shared with draft.js. This
  // guard was correct here and simply absent in the draft view; extracting it
  // is what stops the two from drifting again.
  if (!_gmCareerDraftDep().playoffBracketIsComplete(bracket)) {
    return SEASON_RESULT.MISSED;
  }
  const byTeam = _gmCareerDraftDep().playoffResultByTeam(bracket);
  return Object.prototype.hasOwnProperty.call(byTeam, teamId) ? byTeam[teamId] : SEASON_RESULT.MISSED;
}

// The team's REGULAR-SEASON record, counted off the schedule.
//
// team.record cannot be used: league.js's recordGameResult has no isPlayoff
// guard, so team.record accumulates postseason games too. Measured on a real
// 2026 season, Boston finished the regular season 73-9 and team.record read
// 86-14 by the time finalizeSeasonHistory ran. A career page showing 86-14, and
// a "60-win season" milestone counting playoff wins toward it, would both be
// measuring something no basketball fan would recognise.
//
// The !isPlayoff guard is belt-and-braces — postseason games live on the
// bracket, not in season.games — but it costs nothing and states the intent.
function regularSeasonRecord(seasonGames, teamId) {
  let wins = 0, losses = 0;
  (seasonGames || []).forEach(function (g) {
    if (!g.played || g.isPlayoff) return;
    const isHome = g.homeTeamId === teamId;
    const isAway = g.awayTeamId === teamId;
    if (!isHome && !isAway) return;
    const myScore = isHome ? g.homeScore : g.awayScore;
    const theirScore = isHome ? g.awayScore : g.homeScore;
    if (myScore > theirScore) wins += 1; else losses += 1;
  });
  return { wins: wins, losses: losses };
}

function recordSeason(career, leagueYear, teamId, wins, losses, bracket) {
  if (!career) return null;
  const existing = career.seasons.find(function (s) { return s.leagueYear === leagueYear; });
  if (existing) return existing;
  const row = {
    leagueYear: leagueYear,
    teamId: teamId,
    wins: wins,
    losses: losses,
    result: seasonResultFor(teamId, bracket)
  };
  career.seasons.push(row);
  return row;
}

// The permanent, SELECTIVE timeline. Not a copy of the news feed — the feed is
// noise, which is exactly why script.js caps it at 200 entries and discards the
// rest. This keeps only career-grade moments, so fifty seasons is a few hundred
// short strings.
const CHRONICLE_KINDS = { SEASON: 'season', MILESTONE: 'milestone', AWARD: 'award', DRAFT: 'draft', RECORD: 'record', PRESS: 'press' };

function addChronicle(career, leagueYear, kind, text) {
  if (!career) return null;
  if (!Array.isArray(career.chronicle)) career.chronicle = [];
  const entry = { leagueYear: leagueYear, kind: kind, text: text };
  career.chronicle.push(entry);
  return entry;
}

// Returns null when this year already has its season line, mirroring
// recordSeason's guard: the manual advance and the fast-forward both reach here.
//
// The text is FROZEN at write time rather than rendered lazily, which is the one
// deliberate exception to "never store what can be computed". The reason is
// specific: team names are mutable. commissioner.js can rename a franchise and
// expansion teams appear mid-save, so a line rendered later could claim you won
// the 2031 title with a team that did not exist until 2034.
function recordSeasonChronicle(career, row, teamName) {
  if (!career || !row) return null;
  const already = (career.chronicle || []).some(function (e) {
    return e.kind === CHRONICLE_KINDS.SEASON && e.leagueYear === row.leagueYear;
  });
  if (already) return null;
  const label = SEASON_RESULT_LABEL[String(row.result)] || 'Season complete';
  // teamName is accepted but not interpolated into the default line: the row
  // already carries teamId and the career page groups by team. It is a
  // parameter so a multi-team career can prefix the line later without
  // changing this signature.
  return addChronicle(career, row.leagueYear, CHRONICLE_KINDS.SEASON,
    row.wins + '-' + row.losses + '. ' + label + '.');
}

function careerTotals(career) {
  const seasons = (career && career.seasons) || [];
  let wins = 0, losses = 0, playoffAppearances = 0, finalsAppearances = 0, titles = 0;
  seasons.forEach(function (s) {
    wins += s.wins;
    losses += s.losses;
    if (s.result >= SEASON_RESULT.FIRST_ROUND) playoffAppearances += 1;
    if (s.result >= SEASON_RESULT.FINALS_LOSS) finalsAppearances += 1;
    if (s.result === SEASON_RESULT.CHAMPION) titles += 1;
  });
  return {
    seasons: seasons.length,
    wins: wins,
    losses: losses,
    winPct: (wins + losses) > 0 ? wins / (wins + losses) : 0,
    playoffAppearances: playoffAppearances,
    finalsAppearances: finalsAppearances,
    titles: titles
  };
}

function seasonsAscending(career) {
  return ((career && career.seasons) || []).slice()
    .sort(function (a, b) { return a.leagueYear - b.leagueYear; });
}

function titleYears(career) {
  return seasonsAscending(career)
    .filter(function (s) { return s.result === SEASON_RESULT.CHAMPION; })
    .map(function (s) { return s.leagueYear; });
}

// Consecutive by YEAR, not by array position — a career with a gap in its
// season rows (possible after a commissioner rewind) must not count across it.
function longestRunWhere(career, predicate) {
  let best = 0, run = 0, prevYear = null;
  seasonsAscending(career).forEach(function (s) {
    const consecutive = prevYear !== null && s.leagueYear === prevYear + 1;
    if (predicate(s)) {
      run = consecutive ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prevYear = s.leagueYear;
  });
  return best;
}

function longestTitleRun(career) {
  return longestRunWhere(career, function (s) { return s.result === SEASON_RESULT.CHAMPION; });
}

function longestPlayoffStreak(career) {
  return longestRunWhere(career, function (s) { return s.result >= SEASON_RESULT.FIRST_ROUND; });
}

// leagueHistory is passed IN, never imported: history.js already requires this
// file, so importing it back would be a cycle — and passing it makes every
// query testable against a hand-built archive.
function userDraftPicks(career, leagueHistory) {
  const out = [];
  ((leagueHistory && leagueHistory.draftClasses) || []).forEach(function (cls) {
    (cls.picks || []).forEach(function (p) {
      if (!tenureCovers(career, p.teamId, cls.leagueYear)) return;
      out.push({ leagueYear: cls.leagueYear, round: p.round, pickNumber: p.pickNumber,
                 playerId: p.playerId, playerName: p.playerName });
    });
  });
  return out;
}

function userTrades(career, leagueHistory) {
  return ((leagueHistory && leagueHistory.trades) || []).filter(function (t) {
    return (t.participants || []).some(function (teamId) {
      return tenureCovers(career, teamId, t.leagueYear);
    });
  });
}

// Only ARRIVALS. A player leaving your team is part of the same trade record,
// and counting him would make every deal look like an acquisition.
function playersAcquiredByTrade(career, leagueHistory) {
  const out = [];
  userTrades(career, leagueHistory).forEach(function (t) {
    (t.players || []).forEach(function (p) {
      if (!tenureCovers(career, p.toTeamId, t.leagueYear)) return;
      out.push({ leagueYear: t.leagueYear, playerId: p.playerId, playerName: p.playerName });
    });
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEASON_RESULT: SEASON_RESULT,
    CHRONICLE_KINDS: CHRONICLE_KINDS,
    addChronicle: addChronicle,
    recordSeasonChronicle: recordSeasonChronicle,
    careerTotals: careerTotals,
    seasonsAscending: seasonsAscending,
    titleYears: titleYears,
    longestTitleRun: longestTitleRun,
    longestPlayoffStreak: longestPlayoffStreak,
    userDraftPicks: userDraftPicks,
    userTrades: userTrades,
    playersAcquiredByTrade: playersAcquiredByTrade,
    SEASON_RESULT_LABEL: SEASON_RESULT_LABEL,
    createGmCareer: createGmCareer,
    ensureGmCareer: ensureGmCareer,
    clampReputation: clampReputation,
    reputationBand: reputationBand,
    REPUTATION_DEFAULT: REPUTATION_DEFAULT,
    tenureCovers: tenureCovers,
    regularSeasonRecord: regularSeasonRecord,
    recordSeason: recordSeason
  };
}

// Browser-global aliases. The bare names (titleYears, careerTotals) are far too
// generic to sit in the global namespace every script tag shares —
// commissioner.js's clampRating already shadowed progression.js's once here.
if (typeof module === 'undefined' || !module.exports) {
  var gmCareerTitleYears = titleYears;
  var gmCareerTotals = careerTotals;
}
