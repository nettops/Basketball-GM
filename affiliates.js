// The affiliate league. Thirty clubs, one per parent team, where two-way
// players and generated filler play a real schedule so a prospect can develop
// by playing instead of by sitting.
//
// It simulates itself rather than borrowing the main engine, and that is a
// deliberate boundary, not laziness. simulateBoxScoreGame reaches the roster
// through getTeamRoster and the club through getTeamById, both of which read
// TEAMS and PLAYERS_2026 — so reusing it would mean registering thirty
// affiliate clubs in TEAMS and their players in PLAYERS_2026. Every league-wide
// sweep in the game walks those two arrays: standings, stat leaders, awards,
// the draft, free agency, trades, the save file. Filtering affiliates out of
// each of them is a large change with a large blast radius, in exchange for
// scores that nobody watches possession by possession. A self-contained
// simulator is sixty lines and cannot perturb the parent league at all.
//
// Filler players live on the affiliate state, NOT in PLAYERS_2026, for the same
// reason. Two-way players are the one exception: they are real league players
// who can be called up, so they stay in the pool on the parent club with a
// twoWay marker.
var _AFFILIATES_DATA = (typeof require !== 'undefined')
  ? {
      teams: require('./teams.js'),
      league: require('./league.js'),
      prospects: require('./draftProspects.js'),
      freeAgency: require('./freeAgency.js')
    }
  : {
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      league: { getTeamRoster: getTeamRoster, getPlayerById: getPlayerById },
      prospects: { generateProspectClass: generateProspectClass },
      freeAgency: { MIN_SALARY: MIN_SALARY }
    };

const AFFILIATE_ROSTER_TARGET = 10;

// Thirty games, not eighty-two. The affiliate league exists to develop players
// and give the fringe of the roster somewhere to be, and every game it plays is
// time the user spends waiting for a day to advance. Long enough for form to
// mean something, short enough to stay free.
const AFFILIATE_GAMES_PER_TEAM = 30;

// A two-way player is paid a fixed share of the minimum and does not count
// against the fifteen while he is down.
const TWO_WAY_SALARY_SHARE = 0.5;

function affiliateIdFor(teamId) { return teamId + '-A'; }
function parentIdFor(affiliateId) { return affiliateId.replace(/-A$/, ''); }

// Named off the parent rather than given an invented city of its own. Thirty
// more club names is thirty more rows of data to keep consistent with teams.js,
// and the relationship is the useful thing to read on a scoreboard anyway.
function affiliateNameFor(team) { return team.name + ' Reserves'; }

// Each affiliate plays AFFILIATE_GAMES_PER_TEAM games against random opponents,
// one game per club per day, spread across the season.
//
// Not schedule.js's generateSeasonGames: that builds a division-weighted
// 82-game season and throws if it cannot fit every game inside SEASON_DAYS.
// The affiliate league has no divisions and does not need either property, and
// a full second 1230-game season would roughly double what simulating a day
// costs.
function buildAffiliateSchedule(rng, affiliateIds, seasonDays) {
  const games = [];
  const played = {};
  affiliateIds.forEach(function (id) { played[id] = 0; });
  let gid = 0;

  for (let day = 0; day < seasonDays; day++) {
    const busy = {};
    // Neediest first, so nobody is left short at the end of the season.
    const order = affiliateIds.slice().sort(function (a, b) { return played[a] - played[b]; });
    order.forEach(function (home) {
      if (busy[home] || played[home] >= AFFILIATE_GAMES_PER_TEAM) return;
      const opponents = order.filter(function (away) {
        return away !== home && !busy[away] && played[away] < AFFILIATE_GAMES_PER_TEAM;
      });
      if (opponents.length === 0) return;
      const away = opponents[Math.floor(rng() * opponents.length)];
      busy[home] = true;
      busy[away] = true;
      played[home] += 1;
      played[away] += 1;
      games.push({
        id: 'aff-' + (gid++), home: home, away: away, day: day,
        played: false, homeScore: null, awayScore: null, boxScore: null
      });
    });
  }
  return games;
}

function initAffiliateLeague(rng, leagueYear, seasonDays) {
  const teams = _AFFILIATES_DATA.teams.TEAMS;
  const affiliateIds = teams.map(function (t) { return affiliateIdFor(t.id); });

  // Reuses the prospect generator, which already builds complete players with
  // attributes, a derived overall and hidden data — exactly the fringe talent
  // level an affiliate roster is made of.
  const filler = [];
  teams.forEach(function (t) {
    const batch = _AFFILIATES_DATA.prospects.generateProspectClass(rng, AFFILIATE_ROSTER_TARGET, leagueYear);
    batch.forEach(function (p) {
      p.teamId = affiliateIdFor(t.id);
      p.contract = {
        salary: Math.round(_AFFILIATES_DATA.freeAgency.MIN_SALARY * TWO_WAY_SALARY_SHARE),
        yearsRemaining: 1, playerOption: false, teamOption: false
      };
      filler.push(p);
    });
  });

  const records = {};
  affiliateIds.forEach(function (id) { records[id] = { wins: 0, losses: 0 }; });

  return {
    filler: filler,
    games: buildAffiliateSchedule(rng, affiliateIds, seasonDays),
    records: records
  };
}

// Filler on this club plus any two-way player the parent has sent down.
function affiliateRoster(state, affiliateId, leaguePlayers) {
  const own = state.filler.filter(function (p) { return p.teamId === affiliateId; });
  const parentId = parentIdFor(affiliateId);
  const sentDown = (leaguePlayers || []).filter(function (p) {
    return p.twoWay && p.twoWay.down && p.teamId === parentId;
  });
  return own.concat(sentDown);
}

function affiliateRating(roster) {
  if (roster.length === 0) return 45;
  const rotation = roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).slice(0, 8);
  return rotation.reduce(function (s, p) { return s + p.rawOverall; }, 0) / rotation.length;
}

// Scores from the rating gap plus noise, then hands the points out down the
// rotation. Enough to produce a plausible line for a prospect and a standings
// table; deliberately not a possession model.
function simulateAffiliateGame(homeRoster, awayRoster, rng) {
  const edge = affiliateRating(homeRoster) - affiliateRating(awayRoster) + 2.5; // home floor
  const base = 104;
  const homeScore = Math.max(70, Math.round(base + edge * 0.9 + (rng() * 24 - 12)));
  const awayScore = Math.max(70, Math.round(base - edge * 0.9 + (rng() * 24 - 12)));
  // A tie is not a result. The home side takes it, which is as arbitrary as any
  // other rule and at least never loops.
  const home = homeScore === awayScore ? homeScore + 1 : homeScore;

  function boxFor(roster, points) {
    const rotation = roster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; }).slice(0, 8);
    const weights = rotation.map(function (p, i) { return Math.max(1, p.rawOverall - 40) * (1 - i * 0.07); });
    const total = weights.reduce(function (s, w) { return s + w; }, 0) || 1;
    const lines = {};
    rotation.forEach(function (p, i) {
      const share = weights[i] / total;
      lines[p.id] = {
        points: Math.round(points * share),
        rebounds: Math.round(share * 42),
        assists: Math.round(share * 24),
        minutes: Math.round(share * 240)
      };
    });
    return lines;
  }

  return {
    homeScore: home,
    awayScore: awayScore,
    boxScore: Object.assign({}, boxFor(homeRoster, home), boxFor(awayRoster, awayScore))
  };
}

// Plays every affiliate game scheduled for this day. Takes its own rng so the
// affiliate league cannot shift the parent league's dice — the main season's
// determinism, and both golden fixtures, depend on that separation.
function simulateAffiliateDay(state, dayIndex, rng, leaguePlayers) {
  const results = [];
  state.games.forEach(function (g) {
    if (g.played || g.day !== dayIndex) return;
    const homeRoster = affiliateRoster(state, g.home, leaguePlayers);
    const awayRoster = affiliateRoster(state, g.away, leaguePlayers);
    const out = simulateAffiliateGame(homeRoster, awayRoster, rng);
    g.played = true;
    g.homeScore = out.homeScore;
    g.awayScore = out.awayScore;
    g.boxScore = out.boxScore;
    const homeWon = out.homeScore > out.awayScore;
    state.records[g.home][homeWon ? 'wins' : 'losses'] += 1;
    state.records[g.away][homeWon ? 'losses' : 'wins'] += 1;

    // Credit the two-way players who actually got on the floor. progression.js
    // reads this count in the offseason and it is what makes a season down here
    // worth more than a season on the parent bench — without it the whole
    // league is a cap trick with box scores attached.
    homeRoster.concat(awayRoster).forEach(function (p) {
      if (p.twoWay && out.boxScore[p.id]) {
        p.twoWay.gamesDown = (p.twoWay.gamesDown || 0) + 1;
      }
    });
    results.push(g);
  });
  return results;
}

// Signs a free agent to a two-way deal. He joins the parent club but does not
// count against the fifteen, which is the entire point of the contract.
function signTwoWay(player, teamId) {
  if (!player) return { success: false, reason: 'Unknown player.' };
  if (player.teamId) return { success: false, reason: player.name + ' is already under contract.' };
  if (player.waivers) return { success: false, reason: player.name + ' is still on waivers.' };
  player.teamId = teamId;
  player.contract = {
    salary: Math.round(_AFFILIATES_DATA.freeAgency.MIN_SALARY * TWO_WAY_SALARY_SHARE),
    yearsRemaining: 1, playerOption: false, teamOption: false
  };
  player.twoWay = { down: true };
  return { success: true };
}

function sendDown(player) {
  if (!player || !player.twoWay) return { success: false, reason: 'Only two-way players can be sent down.' };
  if (player.twoWay.down) return { success: false, reason: player.name + ' is already with the affiliate.' };
  player.twoWay.down = true;
  return { success: true };
}

function callUp(player) {
  if (!player || !player.twoWay) return { success: false, reason: 'Only two-way players can be called up.' };
  if (!player.twoWay.down) return { success: false, reason: player.name + ' is already with the parent club.' };
  player.twoWay.down = false;
  return { success: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    affiliateIdFor: affiliateIdFor,
    parentIdFor: parentIdFor,
    affiliateNameFor: affiliateNameFor,
    buildAffiliateSchedule: buildAffiliateSchedule,
    initAffiliateLeague: initAffiliateLeague,
    affiliateRoster: affiliateRoster,
    affiliateRating: affiliateRating,
    simulateAffiliateGame: simulateAffiliateGame,
    simulateAffiliateDay: simulateAffiliateDay,
    signTwoWay: signTwoWay,
    sendDown: sendDown,
    callUp: callUp,
    AFFILIATE_GAMES_PER_TEAM: AFFILIATE_GAMES_PER_TEAM,
    AFFILIATE_ROSTER_TARGET: AFFILIATE_ROSTER_TARGET,
    TWO_WAY_SALARY_SHARE: TWO_WAY_SALARY_SHARE
  };
}
