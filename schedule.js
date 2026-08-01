var _SCHED_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js') }
  : { data: { CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS }, teams: { TEAMS: TEAMS } };

function generateMatchupCounts(rng) {
  const TEAMS_LIST = _SCHED_DATA.teams.TEAMS;
  const CONFS = _SCHED_DATA.data.CONFERENCES;
  const DIVS = _SCHED_DATA.data.DIVISIONS;

  const gamesCount = {};
  TEAMS_LIST.forEach(function (t) { gamesCount[t.id] = {}; });

  function setGames(a, b, n) {
    gamesCount[a][b] = n;
    gamesCount[b][a] = n;
  }

  // 1. Division rivals: 4 games each.
  CONFS.forEach(function (conf) {
    DIVS[conf].forEach(function (div) {
      const divTeams = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === div; });
      for (let i = 0; i < divTeams.length; i++) {
        for (let j = i + 1; j < divTeams.length; j++) {
          setGames(divTeams[i].id, divTeams[j].id, 4);
        }
      }
    });
  });

  // 2. Non-division conference opponents: circulant construction per division-pair,
  // guaranteeing exactly 3 four-game + 2 three-game partners per team per other division
  // (6 four-game + 4 three-game total across both other divisions).
  CONFS.forEach(function (conf) {
    const divs = DIVS[conf];
    for (let d1 = 0; d1 < divs.length; d1++) {
      for (let d2 = d1 + 1; d2 < divs.length; d2++) {
        const teamsA = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d1]; });
        const teamsB = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d2]; });
        const r = Math.floor(rng() * 5);
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            const isFourGame = (b - a - r + 25) % 5 <= 2;
            setGames(teamsA[a].id, teamsB[b].id, isFourGame ? 4 : 3);
          }
        }
      }
    }
  });

  // 3. Inter-conference: 2 games each.
  TEAMS_LIST.forEach(function (a) {
    TEAMS_LIST.forEach(function (b) {
      if (a.conference !== b.conference && a.id < b.id) {
        setGames(a.id, b.id, 2);
      }
    });
  });

  return gamesCount;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateMatchupCounts: generateMatchupCounts };
}
