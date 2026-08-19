var _AWARDS_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerAverages: getPlayerAverages },
      teams: { TEAMS: TEAMS, getTeamById: getTeamById }
    };

const AWARD_KEYS = {
  MVP: 'mvp',
  DPOY: 'dpoy',
  ROY: 'roy',
  SIXTH_MOY: 'sixthMoy',
  MIP: 'mip',
  ALL_NBA_1: 'allNba1',
  ALL_NBA_2: 'allNba2',
  ALL_NBA_3: 'allNba3'
};

// Comfortably below a full season regardless of exact schedule length —
// keeps a short call-up or an injury-shortened season out of award races
// without hardcoding the schedule's exact game count anywhere in this file.
const MIN_GAMES_FOR_AWARDS = 50;

// Note on what "season" means here: finalizeSeasonHistory (history.js) calls
// computeSeasonAwards AFTER the playoffs have been simulated, and playoffs.js
// deliberately accumulates postseason production into player.seasonStats and
// team.record (see its comment above _seriesIdCounter). So every value below —
// per-game averages, teamWinPct, the MVP/DPOY/All-NBA races — is regular season
// plus postseason, by design, not regular season alone.
function eligiblePlayerEntries() {
  return _AWARDS_DATA.teams.TEAMS.reduce(function (all, team) {
    const roster = _AWARDS_DATA.league.getTeamRoster(team.id).map(function (p) { return { player: p, team: team }; });
    return all.concat(roster);
  }, []).filter(function (entry) {
    return entry.player.seasonStats && entry.player.seasonStats.gamesPlayed >= MIN_GAMES_FOR_AWARDS;
  });
}

function teamWinPct(team) {
  const gamesPlayed = team.record.wins + team.record.losses;
  return gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0;
}

// Blends per-game production with team success — the same "team context
// matters" idea tradeEvaluator.js's directionMultiplier already applies to
// trade value, reused here for award value instead of inventing a separate
// weighting philosophy.
function mvpValue(entry) {
  const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
  const production = avg.ppg + avg.rpg * 1.2 + avg.apg * 1.5 + avg.spg * 2 + avg.bpg * 2;
  return production * (0.6 + teamWinPct(entry.team) * 0.8);
}

function dpoyValue(entry) {
  const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
  const attrs = entry.player.attributes;
  return avg.spg * 3 + avg.bpg * 3 + (attrs.perimeterDefense + attrs.interiorDefense) / 20;
}

function bestByValue(entries, valueFn) {
  if (entries.length === 0) return null;
  let best = entries[0];
  let bestValue = valueFn(best);
  for (let i = 1; i < entries.length; i++) {
    const value = valueFn(entries[i]);
    if (value > bestValue) { best = entries[i]; bestValue = value; }
  }
  return best;
}

// Only players this save has actually simulated a season for, and that gate is
// deliberately stricter than "has lastSeasonAverages".
//
// Loosening it to the seeded averages was tried and measured. In the league's
// first year the seed carries real-life 2025-26 numbers, which come from a
// different distribution than this sim produces: league-wide "improvement" in
// 2026 runs mean +13.8 / median +9.0, against mean +1.2 / median +0.1 in every
// year after. That is not 400 players improving, it is a units mismatch, and
// it handed Most Improved to the same man who won MVP. Improvement is only
// measurable between two seasons the same engine played.
function computeMip(entries) {
  const withPriorSeason = entries.filter(function (entry) {
    return entry.player.careerStats && entry.player.careerStats.seasonsPlayed > 0;
  });
  return bestByValue(withPriorSeason, function (entry) {
    const avg = _AWARDS_DATA.league.getPlayerAverages(entry.player);
    const prior = entry.player.lastSeasonAverages || { ppg: 0, rpg: 0, apg: 0 };
    return (avg.ppg - prior.ppg) + (avg.rpg - prior.rpg) * 1.2 + (avg.apg - prior.apg) * 1.5;
  });
}

// No starter/bench flag exists anywhere in this sim engine — a player not in
// their own team's top 5 by minutes that season is the closest available
// proxy for "reserve."
function computeSixthMoy(entries) {
  const benchEntries = entries.filter(function (entry) {
    const teammates = entries.filter(function (e) { return e.team.id === entry.team.id; });
    const top5Ids = teammates.slice().sort(function (a, b) { return b.player.seasonStats.minutes - a.player.seasonStats.minutes; })
      .slice(0, 5).map(function (e) { return e.player.id; });
    return top5Ids.indexOf(entry.player.id) === -1;
  });
  return bestByValue(benchEntries, mvpValue);
}

// Position-agnostic top 15 split into three 5-man tiers by rank — matches the
// real NBA's current selection format, not the old 2G/2F/1C quota.
function computeAllNba(entries) {
  const ranked = entries.slice().sort(function (a, b) { return mvpValue(b) - mvpValue(a); });
  const top15 = ranked.slice(0, 15);
  return {
    allNba1: top15.slice(0, 5).map(function (e) { return e.player; }),
    allNba2: top15.slice(5, 10).map(function (e) { return e.player; }),
    allNba3: top15.slice(10, 15).map(function (e) { return e.player; })
  };
}

// Same win-improvement signal as computeMostImprovedTeam, but attached to
// the team's actual coach entity (coaches.js) now that one exists, plus a
// small nod to coach overall so an equally-improved team with the stronger
// coach edges out a weaker one.
function computeCoachOfTheYear() {
  let best = null;
  let bestScore = -Infinity;
  _AWARDS_DATA.teams.TEAMS.forEach(function (team) {
    if (!team.coach) return;
    const priorWins = team.lastSeasonWins || 0;
    const delta = team.record.wins - priorWins;
    const score = delta + team.coach.overall * 0.05;
    if (score > bestScore) { bestScore = score; best = team; }
  });
  return best ? { coach: best.coach, teamId: best.id, teamName: best.name } : null;
}

// Coach of the Year previously had no coach entity to attach to in this
// codebase — computeMostImprovedTeam (a team-level award) filled in for it.
// Both are kept: mostImprovedTeam is a genuinely different (team, not coach)
// stat, and existing history/awards UI already renders it.
function computeMostImprovedTeam() {
  let best = null;
  let bestDelta = -Infinity;
  _AWARDS_DATA.teams.TEAMS.forEach(function (team) {
    const priorWins = team.lastSeasonWins || 0;
    const delta = team.record.wins - priorWins;
    if (delta > bestDelta) { bestDelta = delta; best = team; }
  });
  return best;
}

function computeSeasonAwards(leagueYear) {
  const entries = eligiblePlayerEntries();
  const mvp = bestByValue(entries, mvpValue);
  const dpoy = bestByValue(entries, dpoyValue);
  const roy = bestByValue(entries.filter(function (e) { return e.player.yearsPro === 0; }), mvpValue);
  const mip = computeMip(entries);
  const sixthMoy = computeSixthMoy(entries);
  const allNba = computeAllNba(entries);
  const mostImprovedTeam = computeMostImprovedTeam();
  const coachOfTheYear = computeCoachOfTheYear();

  const winners = [];
  function recordWinner(award, player) {
    if (!player) return;
    winners.push({ award: award, playerId: player.id, playerName: player.name });
  }
  recordWinner(AWARD_KEYS.MVP, mvp ? mvp.player : null);
  recordWinner(AWARD_KEYS.DPOY, dpoy ? dpoy.player : null);
  recordWinner(AWARD_KEYS.ROY, roy ? roy.player : null);
  recordWinner(AWARD_KEYS.MIP, mip ? mip.player : null);
  recordWinner(AWARD_KEYS.SIXTH_MOY, sixthMoy ? sixthMoy.player : null);
  allNba.allNba1.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_1, p); });
  allNba.allNba2.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_2, p); });
  allNba.allNba3.forEach(function (p) { recordWinner(AWARD_KEYS.ALL_NBA_3, p); });

  return {
    leagueYear: leagueYear,
    winners: winners,
    mostImprovedTeam: mostImprovedTeam ? { teamId: mostImprovedTeam.id, teamName: mostImprovedTeam.name } : null,
    coachOfTheYear: coachOfTheYear
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AWARD_KEYS: AWARD_KEYS,
    MIN_GAMES_FOR_AWARDS: MIN_GAMES_FOR_AWARDS,
    computeSeasonAwards: computeSeasonAwards,
    computeMostImprovedTeam: computeMostImprovedTeam,
    computeCoachOfTheYear: computeCoachOfTheYear
  };
}
