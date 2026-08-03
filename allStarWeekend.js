var _ASW_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), teams: require('./teams.js'), simEngineBoxScore: require('./simEngineBoxScore.js') }
  : {
      league: { getTeamRoster: getTeamRoster, getPlayerAverages: getPlayerAverages },
      teams: { TEAMS: TEAMS },
      simEngineBoxScore: { distributeInt: distributeInt }
    };

// Lower bar than awards.js's MIN_GAMES_FOR_AWARDS (50) since this is meant to
// fire mid-season, around the All-Star break, not at season's end.
const MIN_GAMES_FOR_ALL_STAR = 20;
const ALL_STAR_ROSTER_SIZE = 12;
const ALL_STAR_STARTERS = 5;

function allStarEligibleEntries(conference) {
  return _ASW_DATA.teams.TEAMS.filter(function (t) { return t.conference === conference; })
    .reduce(function (all, team) { return all.concat(_ASW_DATA.league.getTeamRoster(team.id)); }, [])
    .filter(function (p) { return p.seasonStats && p.seasonStats.gamesPlayed >= MIN_GAMES_FOR_ALL_STAR; });
}

function allStarValue(player) {
  const avg = _ASW_DATA.league.getPlayerAverages(player);
  return avg.ppg + avg.rpg * 1.2 + avg.apg * 1.5 + avg.spg * 2 + avg.bpg * 2;
}

// Returns { starters: [...5], reserves: [...7] }, both sorted best-to-worst
// by allStarValue — a fan-vote-style production ranking, not a real ballot.
function selectAllStars(conference) {
  const ranked = allStarEligibleEntries(conference).slice().sort(function (a, b) { return allStarValue(b) - allStarValue(a); }).slice(0, ALL_STAR_ROSTER_SIZE);
  return { starters: ranked.slice(0, ALL_STAR_STARTERS), reserves: ranked.slice(ALL_STAR_STARTERS) };
}

// A high-scoring, low-defense exhibition box score — reuses simEngineBoxScore's
// largest-remainder distributeInt helper rather than inventing a second one,
// weighted by allStarValue instead of the regular-season scoring/rebound/
// assist weight functions (this isn't a competitive game).
function simulateAllStarGame(eastRoster, westRoster, rng) {
  const EXHIBITION_TOTAL = 165;
  // A small rng-driven margin on top of the fixed exhibition total, applied
  // before distributing into the box score, so individual lines always sum
  // exactly to the reported team score.
  const margin = Math.round((rng() - 0.5) * 20);
  const eastTotal = EXHIBITION_TOTAL + Math.max(0, margin);
  const westTotal = EXHIBITION_TOTAL + Math.max(0, -margin);

  function teamBox(roster, total) {
    const weights = roster.map(allStarValue);
    const points = _ASW_DATA.simEngineBoxScore.distributeInt(total, weights);
    const rebounds = _ASW_DATA.simEngineBoxScore.distributeInt(40, weights);
    const assists = _ASW_DATA.simEngineBoxScore.distributeInt(38, weights);
    const box = {};
    roster.forEach(function (p, i) { box[p.id] = { points: points[i], rebounds: rebounds[i], assists: assists[i] }; });
    return { total: total, box: box };
  }
  const east = teamBox(eastRoster, eastTotal);
  const west = teamBox(westRoster, westTotal);
  return {
    eastScore: east.total, westScore: west.total,
    eastBox: east.box, westBox: west.box,
    mvpPlayerId: Object.keys(Object.assign({}, east.box, west.box)).reduce(function (bestId, id) {
      const line = east.box[id] || west.box[id];
      const bestLine = bestId ? (east.box[bestId] || west.box[bestId]) : null;
      return (!bestLine || line.points > bestLine.points) ? id : bestId;
    }, null)
  };
}

// contestants: array of players. Each takes 2 scored rounds; best single
// round wins. shootingAttr picks which rating drives make-probability.
function simulateThreePointContest(contestants, rng) {
  const results = contestants.map(function (player) {
    const skill = player.attributes.threePoint;
    const rounds = [1, 2].map(function () {
      let score = 0;
      for (let rack = 0; rack < 5; rack++) {
        for (let ball = 0; ball < 5; ball++) {
          const makeChance = Math.max(0.15, Math.min(0.75, skill / 130));
          if (rng() < makeChance) score += (ball === 4 ? 2 : 1); // 5th ball in each rack is a money ball worth 2
        }
      }
      return score;
    });
    return { playerId: player.id, playerName: player.name, bestRound: Math.max(rounds[0], rounds[1]), rounds: rounds };
  });
  results.sort(function (a, b) { return b.bestRound - a.bestRound; });
  return { results: results, winnerId: results[0] ? results[0].playerId : null };
}

// contestants get 2 dunk attempts, judged 0-50 (weighted by vertical/
// acceleration plus a random flourish); best single dunk wins.
function simulateDunkContest(contestants, rng) {
  const results = contestants.map(function (player) {
    const athleticism = (player.attributes.vertical + player.attributes.acceleration) / 2;
    const dunks = [1, 2].map(function () {
      const base = 25 + (athleticism - 50) * 0.4;
      return Math.max(20, Math.min(50, Math.round(base + (rng() - 0.5) * 20)));
    });
    return { playerId: player.id, playerName: player.name, bestDunk: Math.max(dunks[0], dunks[1]), dunks: dunks };
  });
  results.sort(function (a, b) { return b.bestDunk - a.bestDunk; });
  return { results: results, winnerId: results[0] ? results[0].playerId : null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MIN_GAMES_FOR_ALL_STAR: MIN_GAMES_FOR_ALL_STAR,
    allStarValue: allStarValue,
    selectAllStars: selectAllStars,
    simulateAllStarGame: simulateAllStarGame,
    simulateThreePointContest: simulateThreePointContest,
    simulateDunkContest: simulateDunkContest
  };
}
